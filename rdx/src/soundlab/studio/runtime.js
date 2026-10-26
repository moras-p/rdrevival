/* SoundLab Studio native runtime.
 *
 * Owns the 25 Hz gameplay clock while the studio is open: the Emscripten
 * frontend loop is paused and every frame is advanced explicitly with the
 * held control mask, then recorded. That makes the recording frame-exact and
 * the input log replayable from the same start room. */

import { CONTROL, LIVE_HEIGHT, LIVE_WIDTH, XrickLivePreview } from '../../juice/xrick-live-preview.js';
import { stepNativeFrame } from '../../runtime/native-scene-runner.js';
import { RDX_ROM_FILENAME, loadRememberedRdxRom, rememberRdxRom, validateRdxRomBytes } from '../../runtime/rom-store.js';
import { FRAME_HZ, StudioSession, frameRecord } from './session.js';

export const FRAME_MS = 1000 / FRAME_HZ;
const GAME_JUICE_PRESET = 'amiga_palette_punch';
const MAX_FRAMES = 15000; /* 10 minutes at 25 Hz */
const BUNDLED_ROM = 'rdx/data/editor/Rick_Dangerous_DX_1.3x.bin';

const KEY_BITS = Object.freeze({
  ArrowLeft: CONTROL.LEFT, KeyA: CONTROL.LEFT,
  ArrowRight: CONTROL.RIGHT, KeyD: CONTROL.RIGHT,
  ArrowUp: CONTROL.UP, KeyW: CONTROL.UP,
  ArrowDown: CONTROL.DOWN, KeyS: CONTROL.DOWN,
  Space: CONTROL.FIRE
});

export function maskForKeys(keys) {
  if (keys.has('KeyX')) return CONTROL.FIRE | CONTROL.UP;   /* gun */
  if (keys.has('KeyC')) return CONTROL.FIRE | CONTROL.DOWN; /* dynamite */
  let mask = 0;
  for (const code of keys) mask |= KEY_BITS[code] || 0;
  return mask;
}

export class StudioRuntime {
  constructor({ onFrame = () => {}, onStatus = () => {}, onState = () => {} } = {}) {
    this.onFrame = onFrame;
    this.onStatus = onStatus;
    this.onState = onState;
    this.preview = null;
    this.session = new StudioSession();
    this.images = new Map(); /* frame -> Blob (webp) */
    this.keys = new Set();
    this.heldMask = 0;
    this.playing = false;
    this.speed = 1;
    this.replay = null;
    this.raf = 0;
    this.lastTick = 0;
    this.accumulator = 0;
    this.lastSfxSerial = 0;
    this.lastCueSerial = 0;
    this.pendingSounds = [];
    this.romName = '';
  }

  get bridge() { return this.preview?.bridge || null; }
  get ready() { return !!this.preview?.rdxLoaded; }

  async init({ rom = null } = {}) {
    if (!this.preview) {
      this.onStatus('Starting the game runtime…');
      this.preview = await XrickLivePreview.create(() => {}, sound => this.pendingSounds.push(sound));
    }
    const source = rom ? { bytes: rom, name: RDX_ROM_FILENAME } : await this.#resolveRom();
    await this.preview.loadRdxRom(source.bytes);
    this.romName = source.name;
    this.preview.setPresentation('rdx');
    this.bridge.setFrontendPaused?.(true);
    this.#applyDefaults();
    this.onStatus(`Ready · ${source.name}`);
    this.#publish();
  }

  async loadRomFile(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const validated = await validateRdxRomBytes(bytes);
    await rememberRdxRom(validated.bytes, { name: file.name || RDX_ROM_FILENAME });
    await this.init({ rom: validated.bytes });
  }

  async #resolveRom() {
    const remembered = await loadRememberedRdxRom().catch(() => null);
    if (remembered?.bytes?.length) return { bytes: remembered.bytes, name: remembered.name || RDX_ROM_FILENAME };
    const response = await fetch(BUNDLED_ROM, { cache: 'no-store' });
    if (!response.ok) {
      const error = new Error('Load the RDX ROM (Rick_Dangerous_DX_1.3.bin) once; SoundLab remembers it in this browser.');
      error.code = 'ROM_REQUIRED';
      throw error;
    }
    return { bytes: new Uint8Array(await response.arrayBuffer()), name: RDX_ROM_FILENAME };
  }

  #applyDefaults() {
    /* Judge sounds with the production default visual feedback. */
    this.bridge.setRuntimeOption?.('game_juice_preset', GAME_JUICE_PRESET);
  }

  options() {
    return {
      invincible: !!this.bridge?.api?.debugGetInvincible?.(),
      speed: this.speed
    };
  }

  setInvincible(on) { this.preview?.setInvincible(!!on); this.#publish(); }
  setSpeed(speed) { this.speed = Math.max(0.1, Math.min(2, Number(speed) || 1)); this.#publish(); }

  /* Start a fresh session in a room. Recording starts at the room's restart
   * pose so a saved input log replays from the same state. */
  async startSession({ submap = 0 } = {}) {
    if (!this.ready) throw new Error('Game runtime is not ready');
    this.pause();
    this.replay = null;
    this.bridge.setFrontendPaused?.(false);
    if (!this.preview.selectSubmap(Number(submap) >>> 0)) throw new Error(`Room ${submap} is not available`);
    await this.preview.resetLevelForPlaytest();
    this.bridge.setFrontendPaused?.(true);
    this.#applyDefaults();
    this.#resetRecording({ submap: Number(submap) >>> 0 });
    this.#recordFrame(0);
    this.#publish();
    return this.state();
  }

  /* Re-run a saved session's input log from its start room. */
  async replaySession(json) {
    const saved = StudioSession.fromJSON(json);
    await this.startSession({ submap: saved.start.submap });
    this.replay = { masks: saved.frames.slice(1).map(f => f.mask), cursor: 0, source: saved };
    this.play();
    return this.state();
  }

  #resetRecording(start) {
    this.session = new StudioSession({ start: { ...start, presentation: 'rdx', rom: this.romName, createdAt: new Date().toISOString() } });
    this.images.clear();
    this.pendingSounds.length = 0;
    this.lastCueSerial = this.bridge.soundLabEventSerial?.() || 0;
  }

  play() {
    if (!this.ready || this.playing) return;
    this.playing = true;
    this.lastTick = performance.now();
    this.accumulator = 0;
    this.raf = requestAnimationFrame(t => this.#tick(t));
    this.#publish();
  }

  pause() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.bridge?.setDebugControl?.(0);
    this.#publish();
  }

  step(count = 1) {
    if (!this.ready) return;
    this.pause();
    for (let i = 0; i < Math.max(1, count | 0); i += 1) this.#advance();
    this.#publish();
  }

  /* Advance N frames as fast as possible, e.g. for an agent. */
  run(frames, mask = 0) {
    if (!this.ready) return this.state();
    this.pause();
    const n = Math.max(1, Math.min(3000, Number(frames) | 0));
    for (let i = 0; i < n; i += 1) this.#advance(Number(mask) >>> 0);
    this.#publish();
    return this.state();
  }

  keyDown(code) { this.keys.add(code); this.heldMask = maskForKeys(this.keys); }
  keyUp(code) { this.keys.delete(code); this.heldMask = maskForKeys(this.keys); }
  clearKeys() { this.keys.clear(); this.heldMask = 0; }

  #tick(now) {
    if (!this.playing) return;
    this.accumulator += Math.min(250, now - this.lastTick) * this.speed;
    this.lastTick = now;
    let steps = 0;
    while (this.accumulator >= FRAME_MS && steps < 4) {
      this.accumulator -= FRAME_MS;
      steps += 1;
      if (!this.#advance()) break;
    }
    if (steps) this.#publish();
    if (this.playing) this.raf = requestAnimationFrame(t => this.#tick(t));
  }

  #advance(forcedMask = null) {
    if (this.session.length >= MAX_FRAMES) { this.pause(); this.onStatus('Session is full (10 minutes). Start a new session.'); return false; }
    let mask = forcedMask ?? this.heldMask;
    if (this.replay) {
      if (this.replay.cursor >= this.replay.masks.length) { this.replay = null; this.pause(); this.onStatus('Replay finished'); return false; }
      mask = this.replay.masks[this.replay.cursor++];
    }
    stepNativeFrame(this.bridge, mask);
    this.#recordFrame(mask);
    return true;
  }

  #recordFrame(mask) {
    const frame = this.preview.capture();
    const snapshot = frame.snapshot;
    const bounds = new Map();
    for (const e of snapshot.entities || []) {
      const n = Number(e.n) >>> 0;
      if (!n || n === 0xff) continue;
      const b = this.preview.entityBounds(snapshot, e.slot);
      if (b) bounds.set(Number(e.slot), b);
    }
    const sounds = this.pendingSounds.splice(0);
    const cues = (this.bridge.soundLabEventsSince?.(this.lastCueSerial, 64) || []).map(c => {
      this.lastCueSerial = c.serial;
      return {
        serial: c.serial, name: c.event, slot: c.actor.slot, mark: c.actor.mark,
        x: c.world[0], y: c.world[1], dx: c.frameDelta[0], dy: c.frameDelta[1],
        nx: c.normal[0], ny: c.normal[1], dir: c.direction, screenX: c.screenX
      };
    });
    const record = frameRecord({ snapshot, mask, sounds, cues, bounds });
    this.session.add(record);
    frame.canvas.toBlob(blob => { if (blob) this.images.set(record.frame, blob); }, 'image/webp', 0.85);
    this.onFrame({ record, canvas: frame.canvas, live: true });
  }

  async imageFor(frame) {
    const blob = this.images.get(Number(frame));
    return blob ? createImageBitmap(blob) : null;
  }

  state() {
    return {
      ready: this.ready,
      playing: this.playing,
      replaying: !!this.replay,
      speed: this.speed,
      invincible: !!this.bridge?.api?.debugGetInvincible?.(),
      session: { start: this.session.start, frames: this.session.length, firstFrame: this.session.firstFrame, lastFrame: this.session.lastFrame }
    };
  }

  #publish() { this.onState(this.state()); }
}

export { LIVE_WIDTH, LIVE_HEIGHT };
