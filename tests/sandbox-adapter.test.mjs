import test from 'node:test';
import assert from 'node:assert/strict';
import { SandboxAdapter } from '../src/sandbox-adapter.js';
import { Explorer } from '../src/engine.js';

function setup(options = {}) {
  const listeners = new Map();
  const manual = { id: 'keyboard', active: false, command: new Float32Array([0.25, 0, 0]), isActive() { return this.active; } };
  const controller = {
    sources: [manual],
    addSource(source) { this.sources.push(source); },
    on(action, callback) {
      const callbacks = listeners.get(action) ?? new Set();
      callbacks.add(callback); listeners.set(action, callbacks);
      return () => callbacks.delete(callback);
    },
    dispatch(action) { for (const callback of listeners.get(action) ?? []) callback({ source: 'keyboard' }); },
    command() { return this.sources.find((source) => source.isActive())?.command ?? this.sources.at(-1).command; },
  };
  const state = { time: 10, epoch: 1, locked: false, recovery: null, mode: 'walk', variant: 'legs', headMode: false, scriptActive: false, switching: false };
  const headTarget = new Float32Array([0.1, -0.1, 0.2, -0.2]);
  const engine = options.engine ?? {
    ticks: [], actions: [], observations: [],
    start() { this.paused = false; },
    pause(reason) { this.paused = true; this.pauseReason = reason; this.actions = []; },
    observe(type) { this.observations.push(type); },
    tick(dt) { this.ticks.push(dt); return this.actions.splice(0); },
  };
  const port = { simulation: true, controller, headTarget, readState: () => ({ ...state }) };
  const adapter = new SandboxAdapter({ engine, port, ...options });
  function advance(seconds, step = 0.02) {
    const end = state.time + seconds;
    while (state.time < end - 1e-9) {
      state.time = Math.min(end, state.time + step);
      adapter.source.poll(999); // Host wall/render delta must be ignored.
    }
  }
  const move = (patch = {}) => engine.actions.push({ kind: 'move', speed: 0.033, turn: 0, duration: 1.4, ...patch });
  return { adapter, engine, port, state, headTarget, controller, manual, advance, move };
}

test('motion and engine timing follow simulation time, not render time', () => {
  const h = setup(); h.adapter.start(); h.move();
  h.adapter.source.poll(20);
  assert.equal(h.engine.ticks.length, 0);
  assert.deepEqual(h.adapter.snapshot().command, [0, 0, 0]);
  h.advance(0.02);
  assert.ok(Math.abs(h.engine.ticks[0] - 0.02) < 1e-9);
  assert.ok(Math.abs(h.adapter.source.command[0] - 0.033) < 1e-8);
  h.adapter.source.poll(50);
  assert.equal(h.engine.ticks.length, 1);
  h.advance(1.38);
  assert.equal(h.adapter.snapshot().moving, true);
  h.advance(0.04);
  assert.deepEqual(h.adapter.snapshot().command, [0, 0, 0]);
});

test('real Explorer runs without a simulator speed override by default', () => {
  const h = setup({ engine: new Explorer({ settings: { sounds: false } }) });
  assert.equal(h.adapter.start(), true);
  h.advance(3);
  const move = h.adapter.snapshot().events.find((event) => event.kind === 'move');
  assert.equal(move.requestedSpeed, 0.033);
  assert.equal(move.speed, 0.033);
  assert.equal(move.duration, 1.4);
});

test('physics-side arbitration expires commands even when render polling stops', () => {
  const h = setup(); h.adapter.start(); h.move({ duration: 0.1 }); h.advance(0.02);
  h.state.time += 0.12;
  assert.deepEqual(Array.from(h.controller.command()), [0, 0, 0]);
  assert.equal(h.adapter.snapshot().moving, false);
  assert.equal(h.adapter.snapshot().active, true);
  h.move(); h.advance(0.02);
  h.state.time += 0.3;
  assert.deepEqual(Array.from(h.controller.command()), [0, 0, 0]);
  assert.equal(h.adapter.snapshot().reason, 'simulator-clock-gap');
});

test('calibration is explicit and bounded; one request cannot hold motion indefinitely', () => {
  const h = setup({ mapSpeed: () => 99 }); h.adapter.start();
  h.move({ turn: -99, duration: 999 }); h.advance(0.02);
  assert.deepEqual(h.adapter.snapshot().command, [0.25, 0, -1]);
  const move = h.adapter.snapshot().events.find((event) => event.kind === 'move');
  assert.equal(move.requestedSpeed, 0.033);
  assert.equal(move.duration, 2);
  h.advance(2.02);
  assert.deepEqual(h.adapter.snapshot().command, [0, 0, 0]);
});

test('manual input owns commands immediately and persona stays paused after release', () => {
  const h = setup(); h.adapter.start(); h.move(); h.advance(0.02);
  assert.equal(h.controller.sources.at(-1), h.adapter.source);
  h.manual.active = true;
  assert.equal(h.controller.command(), h.manual.command);
  h.adapter.poll();
  assert.equal(h.adapter.snapshot().reason, 'owner_control');
  assert.deepEqual(h.adapter.snapshot().command, [0, 0, 0]);
  h.manual.active = false; h.advance(0.2);
  assert.equal(h.adapter.snapshot().active, false);
  assert.equal(h.adapter.resume(), true);
});

test('discrete owner actions pause without waiting for physics progress', () => {
  for (const action of ['kickL', 'headToggle', 'locoToggle', 'reset', 'quack']) {
    const h = setup(); h.adapter.start(); h.move(); h.advance(0.02);
    h.controller.dispatch(action);
    assert.equal(h.adapter.snapshot().active, false, action);
    assert.deepEqual(h.adapter.snapshot().command, [0, 0, 0]);
    assert.equal(h.adapter.snapshot().reason, action === 'reset' ? 'simulator-reset' : 'owner_control');
  }
});

test('obstacle observation and operator pause clear motion even with a stalled clock', () => {
  const h = setup(); h.adapter.start(); h.move(); h.advance(0.02);
  h.adapter.observe('obstacle');
  assert.deepEqual(h.adapter.snapshot().command, [0, 0, 0]);
  assert.deepEqual(h.engine.observations, ['obstacle']);
  h.move(); h.advance(0.02); h.adapter.pause();
  assert.deepEqual(h.adapter.snapshot().command, [0, 0, 0]);
  h.adapter.observe('greeting'); h.advance(0.2);
  assert.equal(h.adapter.snapshot().active, false);
  assert.deepEqual(h.engine.observations, ['obstacle']);
});

test('invalid clock, epoch reset, backward time and long polling gaps stop the adapter', () => {
  for (const [change, expected] of [
    [() => ({ time: NaN }), 'invalid-simulator-clock'],
    [() => ({ time: Infinity }), 'invalid-simulator-clock'],
    [() => ({ time: 0 }), 'simulator-reset'],
    [() => ({ epoch: 2 }), 'simulator-reset'],
    [(state) => ({ time: state.time + 2 }), 'simulator-clock-gap'],
  ]) {
    const h = setup(); h.adapter.start(); h.move(); h.advance(0.02);
    Object.assign(h.state, change(h.state)); h.adapter.poll();
    assert.equal(h.adapter.snapshot().reason, expected);
    assert.deepEqual(h.adapter.snapshot().command, [0, 0, 0]);
  }
});

test('unsafe or unknown host modes refuse start and interrupt an active movement', () => {
  for (const patch of [
    { locked: true }, { locked: undefined }, { recovery: 'recovering' },
    { mode: 'sitstand' }, { variant: 'rollers' }, { switching: true },
    { headMode: true }, { scriptActive: true },
  ]) {
    const h = setup(); h.adapter.start(); h.move(); h.advance(0.02);
    Object.assign(h.state, patch); h.adapter.poll();
    assert.equal(h.adapter.snapshot().active, false, JSON.stringify(patch));
    assert.deepEqual(h.adapter.snapshot().command, [0, 0, 0]);
    assert.equal(h.adapter.resume(), false);
  }
});

test('new controller sources cannot silently demote the owner below Explorer', () => {
  const h = setup(); h.adapter.start(); h.move(); h.advance(0.02);
  h.controller.addSource({ id: 'new-owner-source', isActive: () => false });
  h.adapter.poll();
  assert.equal(h.adapter.snapshot().reason, 'source-priority-changed');
  assert.equal(h.adapter.resume(), false);
});

test('head poses expire and restore previous settings without changing untouched axes', () => {
  const h = setup(); const original = Array.from(h.headTarget);
  h.adapter.start(); h.engine.actions.push({ kind: 'look', pitch: 0.04, yaw: 0.42, duration: 0.1 });
  h.advance(0.02);
  assert.notEqual(h.headTarget[1], original[1]);
  assert.equal(h.headTarget[0], original[0]);
  assert.equal(h.headTarget[3], original[3]);
  h.advance(0.12);
  assert.deepEqual(Array.from(h.headTarget), original);
});

test('pause restores only head values still owned by Explorer', () => {
  const h = setup(); const original = Array.from(h.headTarget);
  h.adapter.start(); h.engine.actions.push({ kind: 'look', pitch: 0.04, yaw: 0.42, duration: 1 }); h.advance(0.02);
  h.headTarget[2] = -0.5; // A newer owner value must survive restoration.
  h.adapter.poll();
  assert.equal(h.adapter.snapshot().reason, 'owner_control');
  assert.deepEqual(Array.from(h.headTarget), [original[0], original[1], -0.5, original[3]]);
});

test('skill requests are explicitly unsupported and never pretend to execute', () => {
  const h = setup(); h.adapter.start(); h.move(); h.advance(0.02);
  h.engine.actions.push({ kind: 'skill', skillId: 'owners-bow' }); h.advance(0.02);
  assert.equal(h.adapter.snapshot().reason, 'unsupported-action');
  assert.ok(h.adapter.snapshot().events.some((event) => event.type === 'unsupported-action' && event.skillId === 'owners-bow'));
  assert.deepEqual(h.adapter.snapshot().command, [0, 0, 0]);
  assert.equal(h.port.installSkill, undefined);
});

test('malformed movement and mapping results fail closed', () => {
  for (const options of [{ mapSpeed: () => NaN }, { mapSpeed: () => { throw new Error('mapper failed'); } }]) {
    const h = setup(options); h.adapter.start(); h.move(); h.advance(0.02);
    assert.equal(h.adapter.snapshot().active, false);
    assert.deepEqual(h.adapter.snapshot().command, [0, 0, 0]);
  }
  const h = setup(); h.adapter.start(); h.move({ duration: Infinity }); h.advance(0.02);
  assert.equal(h.adapter.snapshot().reason, 'invalid-action');
});

test('disposal releases commands and head ownership, then prevents restart', () => {
  const h = setup(); const original = Array.from(h.headTarget);
  h.adapter.start(); h.engine.actions.push({ kind: 'look', pitch: 0.04, yaw: 0.42, duration: 1 }); h.move(); h.advance(0.02);
  h.adapter.dispose(); h.controller.dispatch('quack'); h.adapter.poll();
  assert.equal(h.adapter.snapshot().disposed, true);
  assert.equal(h.adapter.snapshot().reason, 'disposed');
  assert.deepEqual(h.adapter.snapshot().command, [0, 0, 0]);
  assert.deepEqual(Array.from(h.headTarget), original);
  assert.equal(h.adapter.start(), false);
});

test('physical or incomplete ports and unsafe envelopes are rejected', () => {
  const h = setup();
  assert.throws(() => new SandboxAdapter({ engine: h.engine, port: { ...h.port, simulation: false } }), TypeError);
  assert.throws(() => new SandboxAdapter({ engine: h.engine, port: h.port, maxForwardSpeed: 0.6 }), RangeError);
  assert.throws(() => new SandboxAdapter({ engine: h.engine, port: h.port, maxMoveDuration: Infinity }), RangeError);
});
