/**
 * Curious Explorer — simulation-only input adapter.
 *
 * Connects semantic requests to the official browser sandbox's existing
 * controller. It does not install, select, replace, or edit policies. The port
 * must explicitly identify itself as a simulation; this is not a robot driver.
 *
 * port = { simulation: true, controller, headTarget, readState() }
 * readState returns { time, epoch, locked, recovery, mode, variant, headMode,
 *                    scriptActive, switching }. Time is simulated seconds;
 * epoch is a stable identity that changes when the host resets/replaces a world.
 * A backward clock and the controller's reset action also detect resets.
 * The controller must provide addSource(), sources, and on(action, callback).
 * Hosts must forward any additional manual actions through manualAction().
 */

export const SANDBOX_MANUAL_ACTIONS = Object.freeze([
  'roll', 'groundPick', 'kickL', 'kickR', 'alternateKick', 'spawnBall',
  'headToggle', 'sitToggle', 'locoToggle', 'chaseToggle', 'reset', 'walk',
  'quack',
]);

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

export class SandboxAdapter {
  constructor({ engine, port, mapSpeed = (speed) => speed, onEvent,
    maxMoveDuration = 2, maxTimeDelta = 0.25, maxForwardSpeed = 0.25,
    maxBackwardSpeed = 0.2, maxAngularSpeed = 1 } = {}) {
    if (!engine || !['start', 'pause', 'observe', 'tick'].every((key) => typeof engine[key] === 'function')) {
      throw new TypeError('An Explorer engine is required.');
    }
    if (port?.simulation !== true || typeof port.readState !== 'function'
      || typeof port.controller?.addSource !== 'function'
      || typeof port.controller?.on !== 'function'
      || !Array.isArray(port.controller.sources)
      || !port.headTarget || port.headTarget.length < 4) {
      throw new TypeError('An explicit simulation port with controller and head targets is required.');
    }
    if (typeof mapSpeed !== 'function' || (onEvent !== undefined && typeof onEvent !== 'function')) {
      throw new TypeError('Callbacks must be functions.');
    }
    const limits = { maxMoveDuration, maxTimeDelta, maxForwardSpeed, maxBackwardSpeed, maxAngularSpeed };
    if (Object.values(limits).some((value) => !finite(value) || value <= 0)
      || maxMoveDuration > 5 || maxTimeDelta > 1 || maxForwardSpeed > 0.25
      || maxBackwardSpeed > 0.2 || maxAngularSpeed > 1) {
      throw new RangeError('Limits must stay within the walking sandbox envelope.');
    }
    this.engine = engine;
    this.port = port;
    this._mapSpeed = mapSpeed;
    this._onEvent = onEvent;
    this._limits = limits;
    this._active = false;
    this._disposed = false;
    this._reason = 'not-started';
    this._time = null;
    this._epoch = null;
    this._moveUntil = null;
    this._lookUntil = null;
    this._headWrites = new Map();
    this._events = [];
    this.source = {
      id: 'curious-explorer-sandbox', connected: true,
      command: new Float32Array(3), axes: {}, pressed: {},
      isActive: () => {
        // The policy queries this between render frames. Expire the command
        // here too: Controller falls back to the last source's array even
        // when isActive() is false, so the array itself must be cleared.
        this._enforceDeadline();
        return this._active && this._moveUntil !== null;
      },
      // Render-frame duration is deliberately ignored.
      poll: () => this.poll(),
    };
    port.controller.addSource(this.source);
    this._unsubscribers = SANDBOX_MANUAL_ACTIONS.map((action) =>
      port.controller.on(action, (meta) => {
        if (meta?.source !== this.source.id) this.manualAction(action);
      }));
  }

  _emit(event) {
    const entry = { time: this._time, ...event };
    this._events.push(entry);
    this._events = this._events.slice(-64);
    // A reporting callback must not interrupt a safety stop.
    try { this._onEvent?.({ ...entry }); } catch { /* Reporting is advisory. */ }
  }

  _readState() {
    try { return this.port.readState(); } catch { return null; }
  }

  _unavailable(state, checkOtherInputs = true) {
    if (!state || !finite(state.time) || state.time < 0 || state.epoch == null) return 'invalid-simulator-clock';
    if (state.locked !== false) return 'sandbox-locked';
    if (state.recovery !== null && state.recovery !== false) return 'sandbox-recovery';
    if (state.mode !== 'walk' || state.variant !== 'legs' || state.switching !== false) return 'incompatible-sandbox-mode';
    if (state.headMode !== false || state.scriptActive !== false) return 'sandbox-command-owned';
    if (this.port.controller.sources.at(-1) !== this.source) return 'source-priority-changed';
    if (checkOtherInputs && this.port.controller.sources.some((source) => source !== this.source && source.isActive())) return 'owner_control';
    return null;
  }

  _enforceDeadline() {
    if (!this._active || this._disposed) return;
    const state = this._readState();
    // Do not inspect other sources from isActive(): doing so could recurse
    // through another source's own arbitration checks.
    const reason = this._unavailable(state, false);
    if (reason) { this.pause(reason); return; }
    const dt = state.time - this._time;
    if (state.epoch !== this._epoch || dt < 0) { this.pause('simulator-reset'); return; }
    if (dt > this._limits.maxTimeDelta) { this.pause('simulator-clock-gap'); return; }
    if (this._moveUntil !== null && state.time >= this._moveUntil) {
      this._moveUntil = null;
      this.source.command.fill(0);
    }
  }

  start() {
    if (this._disposed) return false;
    if (this._active) return true;
    const state = this._readState();
    const reason = this._unavailable(state);
    if (reason) { this.pause(reason); return false; }
    this._time = state.time;
    this._epoch = state.epoch;
    this._moveUntil = null;
    this.source.command.fill(0);
    this.engine.start();
    this._active = true;
    this._reason = null;
    this._emit({ type: 'started' });
    return true;
  }

  resume() { return this.start(); }

  _restoreHead() {
    for (const [index, write] of this._headWrites) {
      // Never undo a newer value written by the owner or another input source.
      if (Object.is(this.port.headTarget[index], write.last)) this.port.headTarget[index] = write.before;
    }
    this._headWrites.clear();
    this._lookUntil = null;
  }

  pause(reason = 'owner') {
    this._active = false;
    this._reason = reason;
    this._moveUntil = null;
    this.source.command.fill(0);
    this._restoreHead();
    this.engine.pause(reason);
    this._emit({ type: 'paused', reason });
    return this.snapshot();
  }

  manualAction(action = 'manual-action') {
    if (this._active) this.pause(action === 'reset' ? 'simulator-reset' : 'owner_control');
  }

  observe(type, payload) {
    if (type === 'owner_control') return this.pause('owner_control');
    if (!this._active) return this.snapshot();
    // Stop immediately on a host observation, even if simulation is stalled.
    if (['obstacle', 'quiet', 'movement', 'object', 'greeting'].includes(type)) {
      this._moveUntil = null;
      this.source.command.fill(0);
    }
    this.engine.observe(type, payload);
    return this.snapshot();
  }

  poll() {
    if (!this._active || this._disposed) return;
    const state = this._readState();
    const reason = this._unavailable(state);
    if (reason) { this.pause(reason); return; }
    const dt = state.time - this._time;
    if (state.epoch !== this._epoch || dt < 0) { this.pause('simulator-reset'); return; }
    if (dt > this._limits.maxTimeDelta) { this.pause('simulator-clock-gap'); return; }
    if ([...this._headWrites].some(([index, write]) => !Object.is(this.port.headTarget[index], write.last))) {
      this.pause('owner_control'); return;
    }
    this._time = state.time;
    if (this._moveUntil !== null && this._time >= this._moveUntil) {
      this._moveUntil = null;
      this.source.command.fill(0);
    }
    if (this._lookUntil !== null && this._time >= this._lookUntil) this._restoreHead();
    if (dt === 0) return;
    try {
      for (const action of this.engine.tick(dt)) {
        if (!this._apply(action)) break;
      }
    } catch {
      this.pause('engine-error');
    }
  }

  _apply(action) {
    if (!action || typeof action !== 'object') { this.pause('invalid-action'); return false; }
    if (action.kind === 'stop') {
      this._moveUntil = null;
      this.source.command.fill(0);
      this._restoreHead();
      this._emit({ type: 'action', kind: 'stop', reason: action.reason });
      return true;
    }
    if (action.kind === 'move') {
      if (![action.speed, action.turn, action.duration].every(finite) || action.duration <= 0) {
        this.pause('invalid-action'); return false;
      }
      const mapped = this._mapSpeed(action.speed, { ...action });
      if (!finite(mapped)) { this.pause('invalid-speed-mapping'); return false; }
      const speed = clamp(mapped, -this._limits.maxBackwardSpeed, this._limits.maxForwardSpeed);
      const turn = clamp(action.turn, -this._limits.maxAngularSpeed, this._limits.maxAngularSpeed);
      const duration = Math.min(action.duration, this._limits.maxMoveDuration);
      this.source.command[0] = speed;
      this.source.command[1] = 0;
      this.source.command[2] = turn;
      this._moveUntil = this._time + duration;
      this._emit({ type: 'action', kind: 'move', requestedSpeed: action.speed, speed, turn, duration });
      return true;
    }
    if (action.kind === 'look') {
      if (![action.pitch, action.yaw, action.duration].every(finite) || action.duration <= 0) {
        this.pause('invalid-action'); return false;
      }
      for (const [index, value] of [[1, clamp(action.pitch, -0.3, 0.3)], [2, clamp(action.yaw, -0.65, 0.65)]]) {
        const before = this._headWrites.get(index)?.before ?? this.port.headTarget[index];
        if (!finite(before)) { this.pause('invalid-head-target'); return false; }
        this.port.headTarget[index] = value;
        // Store the actual TypedArray-rounded value for ownership checks.
        this._headWrites.set(index, { before, last: this.port.headTarget[index] });
      }
      this._lookUntil = this._time + Math.min(action.duration, this._limits.maxMoveDuration);
      this._emit({ type: 'action', kind: 'look', pitch: action.pitch, yaw: action.yaw });
      return true;
    }
    this._emit({ type: 'unsupported-action', kind: action.kind, skillId: action.skillId });
    this.pause('unsupported-action');
    return false;
  }

  snapshot() {
    return {
      active: this._active, reason: this._reason, simulatorTime: this._time,
      command: Array.from(this.source.command), moving: this._moveUntil !== null,
      disposed: this._disposed, events: this._events.map((entry) => ({ ...entry })),
    };
  }

  dispose() {
    if (this._disposed) return;
    this.pause('disposed');
    this._disposed = true;
    for (const unsubscribe of this._unsubscribers) unsubscribe?.();
    this.source.connected = false;
    // Controller has no removal API. Leave an inert, zero-command source;
    // mutating the owner's source list would violate its read-only contract.
  }
}
