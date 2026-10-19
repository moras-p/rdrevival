import { XRICK_CONTROL as C } from './controls.js';

// Preserve the production keyboard mapping, including exit/pause shortcuts.
export const GAME_KEY_CODES = Object.freeze({
  ArrowUp: C.UP, KeyO: C.UP, ArrowDown: C.DOWN, KeyK: C.DOWN,
  ArrowLeft: C.LEFT, KeyZ: C.LEFT, ArrowRight: C.RIGHT, KeyX: C.RIGHT,
  Space: C.FIRE, KeyP: C.PAUSE, KeyE: C.END, Escape: C.EXIT
});

const CONTROL_BITS = [C.RIGHT, C.LEFT, C.DOWN, C.UP, C.FIRE, C.EXIT, C.END, C.PAUSE];
export const INPUT_OWNERS = Object.freeze(['page', 'game', 'interaction', 'modal', 'none']);
const buttons = (pad, index) => !!pad?.buttons?.[index]?.pressed;

/** A raw physical controller sample becomes the exact xrick control chord.
 *  No artificial input queue or frame-delay layer. CD32 face actions are
 *  mutually exclusive because e_rick interprets FIRE+direction as exact masks.
 */
export function mapGamepad(pad, profile = 'one-button', facing = C.RIGHT) {
  if (!pad || pad.connected === false) return 0;
  const axisX = Number(pad.axes?.[0] ?? 0);
  const axisY = Number(pad.axes?.[1] ?? 0);
  let direction = (buttons(pad, 15) || axisX > 0.5 ? C.RIGHT : 0) |
    (buttons(pad, 14) || axisX < -0.5 ? C.LEFT : 0) |
    (buttons(pad, 13) || axisY > 0.5 ? C.DOWN : 0) |
    (buttons(pad, 12) || axisY < -0.5 ? C.UP : 0);
  // Do not deliver impossible opposite-axis pairs from disagreeing controls.
  if ((direction & (C.LEFT | C.RIGHT)) === (C.LEFT | C.RIGHT)) direction &= ~(C.LEFT | C.RIGHT);
  if ((direction & (C.UP | C.DOWN)) === (C.UP | C.DOWN)) direction &= ~(C.UP | C.DOWN);
  if (profile === 'cd32') {
    if (buttons(pad, 0)) return (direction & (C.LEFT | C.RIGHT)) | C.UP;
    if (buttons(pad, 1)) return C.FIRE | C.UP;
    if (buttons(pad, 2)) return C.FIRE | C.DOWN;
    if (buttons(pad, 3)) return C.FIRE | (direction & (C.LEFT | C.RIGHT) || facing);
  }
  return direction | (buttons(pad, 0) && profile !== 'cd32' ? C.FIRE : 0) |
    (buttons(pad, 9) ? C.PAUSE : 0);
}

export class GameInputRouter {
  /** writeBit and clearNative MUST invoke the native export synchronously. */
  constructor({ writeBit, clearNative, now = () => globalThis.performance?.now?.() ?? 0,
                trace = false } = {}) {
    if (typeof writeBit !== 'function' || typeof clearNative !== 'function')
      throw new TypeError('Synchronous native input exports are required');
    this.writeBit = writeBit;
    this.clearNative = clearNative;
    this.now = now;
    this.trace = trace;
    this.owner = 'page';
    this.device = null;
    this.mask = 0;
    this.keyboardCodes = new Set();
    this.rearm = new Set();
    this.deviceMasks = new Map();
    this.profiles = new Map();
    this.inputId = 0;
    this.diagnostics = [];
    this.pendingEdges = new Map();
    this.awaitingDisplay = new Set();
    this.awaitingTexture = new Set();
    this.awaitingXR = new Set();
  }
  #write(mask, physicalAt = null) {
    const previous = this.mask;
    mask &= 0xff;
    if (previous === mask) return false;
    for (const bit of CONTROL_BITS) {
      if (!!(previous & bit) === !!(mask & bit)) continue;
      const id = ++this.inputId;
      const before = this.trace ? (Number.isFinite(physicalAt) ? physicalAt : this.now()) : 0;
      this.writeBit(bit, !!(mask & bit)); // no await, Promise, RAF or timer
      if (this.trace) {
        const previousEdge = this.pendingEdges.get(bit);
        if (previousEdge) previousEdge.superseded = true;
        const record = { id, device: this.device, bit, pressed: !!(mask & bit),
          physicalAt: before, nativeWriteAt: this.now(), nativeTick: null,
          nativeFrameSerial: null, submittedAt: null, submittedFrameSerial: null };
        this.diagnostics.push(record);
        this.pendingEdges.set(bit, record);
        if (this.diagnostics.length > 512) {
          const evicted = this.diagnostics.shift();
          if (this.pendingEdges.get(evicted.bit) === evicted) this.pendingEdges.delete(evicted.bit);
          this.awaitingDisplay.delete(evicted);
          this.awaitingTexture.delete(evicted);
          this.awaitingXR.delete(evicted);
        }
      }
    }
    this.mask = mask;
    return true;
  }
  clear() {
    if (this.trace) {
      for (const record of this.pendingEdges.values()) record.superseded = true;
      this.pendingEdges.clear();
      // Mode/focus handoff is an identity boundary: never attribute later
      // presentation frames to controls from the previous owner.
      this.awaitingDisplay.clear();
      this.awaitingTexture.clear();
      this.awaitingXR.clear();
    }
    this.clearNative();
    this.mask = 0;
    this.device = null;
    this.deviceMasks.clear();
    this.rearm = new Set(this.keyboardCodes);
  }
  setOwner(owner) {
    if (!INPUT_OWNERS.includes(owner)) throw new RangeError(`Unknown input owner ${owner}`);
    if (this.owner === owner) return;
    const previous = this.owner;
    this.clear();
    this.owner = owner;
    if (previous === 'page' && owner === 'game') {
      // Current physical held keys become eligible on an explicit page -> game handoff.
      this.rearm.clear();
      const mask = [...this.keyboardCodes].reduce((held, code) => held | GAME_KEY_CODES[code], 0);
      if (mask) { this.device = 'keyboard'; this.#write(mask); }
    }
  }
  keyboard(code, pressed, physicalAt = null) {
    const bit = GAME_KEY_CODES[code];
    if (!bit) return false;
    if (pressed) this.keyboardCodes.add(code);
    else { this.keyboardCodes.delete(code); this.rearm.delete(code); }
    if (this.owner !== 'game') return true;
    // An immersive session exclusively owns gameplay controls. Do not let
    // browser keyboard events steal the XR controller's device slot.
    if (this.xrSampler) return true;
    if (this.rearm.has(code)) return true;
    if (this.device !== null && this.device !== 'keyboard') return true;
    const mask = [...this.keyboardCodes].reduce((acc, key) =>
      acc | (this.rearm.has(key) ? 0 : GAME_KEY_CODES[key]), 0);
    this.device = mask ? 'keyboard' : null;
    this.#write(mask, physicalAt);
    return true;
  }
  /** Explicit handoff prevents accidental multi-controller mask aggregation. */
  handoff(device) {
    if (this.owner !== 'game') return false;
    this.clear();
    this.device = device;
    return true;
  }
  write(device, mask, physicalAt = null) {
    if (this.owner !== 'game' || !device) return false;
    if (this.device === null) this.device = device;
    if (this.device !== device) return false;
    this.deviceMasks.set(device, mask & 0xff);
    this.#write(mask, physicalAt);
    if (!mask) this.device = null;
    return true;
  }
  disconnect(device) {
    if (this.device === device) this.clear();
    this.deviceMasks.delete(device);
    this.profiles.delete(device);
  }
  setProfile(device, profile) {
    if (!['one-button', 'cd32', 'standard'].includes(profile)) throw new RangeError('Unknown controller profile');
    if (this.profiles.get(device) !== profile) {
      if (this.device === device) this.clear();
      this.profiles.set(device, profile);
    }
  }
  /** Called at the native input-sampling boundary, not a separate RAF. */
  pollGamepads(gamepads = globalThis.navigator?.getGamepads?.() || [], facing = C.RIGHT) {
    // The existing native pre-actor boundary samples XR before standard pads;
    // XR never introduces a scheduler, worker or frame-queued input buffer.
    this.xrSampler?.sample();
    // WebXR inputs can also appear in the ordinary Gamepad API. Sampling
    // them again would race the exclusive XR device, particularly at neutral.
    if (this.xrSampler) return;
    const known = new Set();
    for (const pad of gamepads || []) {
      if (!pad || pad.connected === false) continue;
      const id = `gamepad:${pad.index}`;
      known.add(id);
      const mask = mapGamepad(pad, this.profiles.get(id) || 'standard', facing);
      // Do not steal authority from a held keyboard/device; claim only if free.
      if (this.device === null || this.device === id) this.write(id, mask, this.trace ? this.now() : null);
    }
    if (this.device?.startsWith('gamepad:') && !known.has(this.device)) this.disconnect(this.device);
  }
  /** Invoked by the existing native pre-actor input hook, after polling gamepads.
   * A superseded press/release is never misreported as consumed by gameplay. */
  noteNativeTick(tick, frameSerial) {
    if (!this.trace) return;
    const now = this.now();
    for (const [bit, record] of this.pendingEdges) {
      if (!!(this.mask & bit) !== record.pressed) continue;
      record.nativeTick = tick >>> 0;
      record.nativeFrameSerial = frameSerial >>> 0;
      record.nativeAt = now;
      this.awaitingDisplay.add(record);
      this.pendingEdges.delete(bit);
    }
  }
  /** Marks the browser canvas submission, not actual display scanout/photons. */
  noteFrameSubmission(frameSerial) {
    if (!this.trace || !this.awaitingDisplay.size) return;
    const serial = frameSerial >>> 0;
    const now = this.now();
    for (const record of this.awaitingDisplay) {
      // Submission of the previous C frame is not a response to the new action.
      if (record.nativeFrameSerial === serial) continue;
      record.submittedAt = now;
      record.submittedFrameSerial = serial;
      this.awaitingDisplay.delete(record);
      this.awaitingTexture.add(record);
    }
  }
  // Called *after* the WebGL draw that first consumes a new canvas revision;
  // timestamps describe JS submissions, not GPU completion or photon output.
  noteTextureSubmission(revision, frameSerial) {
    if (!this.trace) return;
    for (const record of this.awaitingTexture) {
      if (((frameSerial - record.submittedFrameSerial) >>> 0) >= 0x80000000) continue;
      record.textureAt = this.now();
      record.textureRevision = revision;
      this.awaitingTexture.delete(record);
      this.awaitingXR.add(record);
    }
  }
  noteXRSubmission(revision) {
    if (!this.trace) return;
    for (const record of this.awaitingXR) {
      if (record.textureRevision > revision) continue;
      record.xrSubmittedAt = this.now();
      record.xrRevision = revision;
      this.awaitingXR.delete(record);
    }
  }
  diagnosticVR() {
    const percentile = (values, q) => values.length ? values.sort((a,b)=>a-b)[Math.ceil(values.length*q)-1] : null;
    const stats = key => {
      const values = this.diagnostics.filter(r => r[key] !== undefined)
        .map(r => r[key]-r.physicalAt).filter(v => Number.isFinite(v) && v >= 0);
      return { samples: values.length, p50: percentile(values,0.5),
        p95: percentile(values,0.95), p99: percentile(values,0.99) };
    };
    return { receiptToTextureSubmissionMs: stats('textureAt'),
      receiptToXRSubmissionMs: stats('xrSubmittedAt'),
      note: 'JS/WebGL submissions only; no hardware actuation, GPU completion or photon timestamps' };
  }
  diagnosticTrace() { return this.diagnostics.map(record => ({ ...record })); }
  diagnosticSummary() {
    const percentile = (values, fraction) => {
      if (!values.length) return null;
      values.sort((a, b) => a - b);
      return values[Math.ceil(values.length * fraction) - 1];
    };
    const durations = key => this.diagnostics.filter(r => r[key] !== null && r[key] !== undefined)
      .map(r => r[key] - r.physicalAt).filter(value => Number.isFinite(value) && value >= 0);
    const nativeWrites = durations('nativeWriteAt');
    const consumed = durations('nativeAt');
    const submitted = durations('submittedAt');
    return { observed: this.diagnostics.length, consumed: consumed.length,
      submitted: submitted.length, superseded: this.diagnostics.filter(r => r.superseded).length,
      // These are browser monotonic-clock intervals, not physical input or photon latency.
      receiptToWriteMs: [0.5, 0.95, 0.99].map(q => percentile(nativeWrites, q)),
      receiptToNativeMs: [0.5, 0.95, 0.99].map(q => percentile(consumed, q)),
      receiptToSubmissionMs: [0.5, 0.95, 0.99].map(q => percentile(submitted, q)) };
  }
}
