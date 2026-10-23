import test from 'node:test';
import assert from 'node:assert/strict';
import { Explorer, DEFAULT_SETTINGS, PREVIEW_SKILLS } from '../web/engine.js';

const clock = () => new Date('2026-10-23T14:00:00.000Z');
const makeExplorer = (options = {}) => new Explorer({ clock, ...options });
const advance = (explorer, seconds) => Array.from({ length: seconds }, () => explorer.tick(1)).flat();

test('the persona preserves the owner inventory throughout its lifecycle', () => {
  const explorer = makeExplorer();
  const installed = explorer.snapshot().skills;
  explorer.setAllowedSkills(['polite-bow']);
  explorer.start();
  explorer.observe('greeting');
  const actions = explorer.tick();
  assert.ok(actions.some((action) => action.kind === 'skill' && action.skillId === 'polite-bow'));
  advance(explorer, 30);
  explorer.pause();
  explorer.resetMemory();
  assert.deepEqual(explorer.snapshot().skills, installed);
  assert.equal(PREVIEW_SKILLS[0].id, 'custom-gait');
  assert.equal(explorer.installSkill, undefined);
  assert.equal(explorer.removeSkill, undefined);
});

test('paused behavior produces no commands and does not resume on new observations', () => {
  const explorer = makeExplorer();
  assert.deepEqual(explorer.tick(), []);
  explorer.start();
  explorer.observe('object');
  explorer.pause();
  explorer.observe('movement');
  explorer.observe('greeting');
  const before = explorer.snapshot();
  assert.deepEqual(advance(explorer, 100), []);
  assert.deepEqual(explorer.snapshot(), before);
  assert.equal(before.action, null);
  explorer.start();
  assert.deepEqual(explorer.tick().map((action) => action.kind), ['look']);
});

test('owner control immediately cancels pending requests and requires manual resume', () => {
  const explorer = makeExplorer();
  explorer.setAllowedSkills(['polite-bow']);
  explorer.start();
  explorer.observe('greeting');
  explorer.observe('owner_control');
  assert.equal(explorer.snapshot().mode, 'paused');
  assert.deepEqual(advance(explorer, 20), []);
  assert.match(explorer.snapshot().focus.text, /controls/);
});

test('skills require explicit permission, must exist, and may never replace a gait', () => {
  const explorer = makeExplorer();
  explorer.start();
  explorer.observe('greeting');
  assert.ok(explorer.tick().every((action) => action.kind !== 'skill'));
  explorer.setAllowedSkills(['missing', 'custom-gait', 'polite-bow', 'polite-bow']);
  assert.deepEqual(explorer.snapshot().allowedSkills, ['polite-bow']);
  explorer.observe('greeting');
  explorer.setAllowedSkills([]);
  assert.ok(explorer.tick().every((action) => action.kind !== 'skill'));
});

test('a read-only inventory refresh prunes stale consent and pending skill requests', () => {
  const explorer = makeExplorer();
  const capabilities = [{ id: 'bow', name: 'Friendly bow', kind: 'skill', role: 'greeting' }];
  explorer.setSkills(capabilities);
  explorer.setAllowedSkills(['bow']);
  explorer.start();
  explorer.observe('greeting');
  explorer.setSkills([]);
  assert.deepEqual(explorer.snapshot().allowedSkills, []);
  assert.ok(explorer.tick().every((action) => action.kind !== 'skill'));
  assert.deepEqual(capabilities, [{ id: 'bow', name: 'Friendly bow', kind: 'skill', role: 'greeting' }]);
});

test('an obstacle interrupts a movement and holds still for a rest', () => {
  const explorer = makeExplorer();
  explorer.start();
  advance(explorer, 4);
  explorer.observe('obstacle');
  const position = explorer.snapshot().position;
  assert.equal(explorer.snapshot().mode, 'resting');
  const actions = explorer.tick();
  assert.deepEqual(actions, [{ kind: 'stop', reason: 'obstacle' }]);
  advance(explorer, 3);
  assert.deepEqual(explorer.snapshot().position, position);
  assert.equal(explorer.snapshot().mode, 'resting');
});

test('the practice field stays bounded and activity alternates with rest', () => {
  const explorer = makeExplorer({ settings: { curiosity: 100, energy: 100 } });
  explorer.start();
  let hasRested = false;
  let hasMoved = false;
  for (let index = 0; index < 2400; index += 1) {
    const actions = explorer.tick();
    const state = explorer.snapshot();
    hasRested ||= state.mode === 'resting';
    hasMoved ||= actions.some((action) => action.kind === 'move');
    assert.ok(state.energy >= 0 && state.energy <= 100);
    assert.ok(state.position.x >= 0.08 && state.position.x <= 0.92);
    assert.ok(state.position.y >= 0.08 && state.position.y <= 0.92);
    for (const action of actions.filter((action) => action.kind === 'move')) {
      assert.ok(action.speed > 0 && action.speed <= 0.04);
      assert.ok(action.duration <= 1.4);
    }
  }
  assert.ok(hasMoved);
  assert.ok(hasRested);
});

test('clearing memory keeps settings, inventory, and permission choices intact', () => {
  const explorer = makeExplorer({ settings: { name: 'Pebble', curiosity: 82, sounds: false } });
  explorer.setAllowedSkills(['polite-bow']);
  explorer.start();
  explorer.observe('object');
  explorer.observe('greeting');
  assert.equal(explorer.snapshot().memory.encounters, 2);
  const before = explorer.snapshot();
  explorer.resetMemory();
  const after = explorer.snapshot();
  assert.deepEqual(after.settings, before.settings);
  assert.deepEqual(after.skills, before.skills);
  assert.deepEqual(after.allowedSkills, before.allowedSkills);
  assert.equal(after.memory.encounters, 0);
  assert.equal(after.memory.sessions, 0);
  assert.deepEqual(after.memory.notes, []);
  assert.equal(after.journal.length, 1);
});

test('disabling sounds cancels pending sounds while preserving visual reactions', () => {
  const explorer = makeExplorer();
  explorer.start();
  explorer.observe('object');
  explorer.setSettings({ sounds: false });
  const actions = explorer.tick();
  assert.ok(actions.some((action) => action.kind === 'look'));
  assert.ok(actions.every((action) => action.kind !== 'sound'));
});

test('snapshots are detached, numeric settings bounded, and progress deterministic', () => {
  const one = makeExplorer({ settings: { curiosity: 900, energy: -4, name: '' } });
  const two = makeExplorer({ settings: { curiosity: 900, energy: -4, name: '' } });
  assert.equal(one.snapshot().settings.curiosity, 100);
  assert.equal(one.snapshot().settings.energy, 0);
  assert.equal(one.snapshot().settings.name, DEFAULT_SETTINGS.name);
  const copy = one.snapshot();
  copy.skills.length = 0;
  copy.settings.name = 'Changed outside';
  assert.equal(one.snapshot().skills.length, 2);
  assert.equal(one.snapshot().settings.name, DEFAULT_SETTINGS.name);
  one.start();
  two.start();
  assert.deepEqual(advance(one, 50), advance(two, 50));
  assert.deepEqual(one.snapshot(), two.snapshot());
  assert.deepEqual(one.tick(Number.NaN), []);
  assert.deepEqual(one.tick(-10), []);
});

test('memory restore accepts only simple nonpersonal counters and known notes', () => {
  const explorer = makeExplorer({ memory: {
    encounters: 3,
    observations: { object: 2, greeting: -50 },
    notes: ['Private arbitrary content', 'Received a greeting.'],
    sessions: 1,
    personName: 'Unwanted field',
  } });
  assert.deepEqual(explorer.snapshot().memory, {
    encounters: 3,
    observations: { movement: 0, object: 2, greeting: 0, obstacle: 0 },
    distance: 0,
    sessions: 1,
    notes: ['Received a greeting.'],
  });
});
