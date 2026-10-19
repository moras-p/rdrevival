import { validateRdxRomBytes, loadRememberedRdxRom, rememberRdxRom } from './rom-store.js';
import { readGameEvents, GameEventDispatcher } from './game-events.js';

/** Player-facing logical facade over an existing, unique WASM instance.
 * No frame loop, input listeners, sound mixer, separate renderer or worker.
 * The 2D player owns the scheduler and remains the default consumer.
 */
export class GameSession {
  constructor({ bridge, input, module = bridge?.module } = {}) {
    if (!bridge || !module) throw new TypeError('Existing native game bridge required');
    this.bridge = bridge;
    this.module = module;
    this.input = Object.freeze({
      write: (device, mask) => input?.write(device, mask) ?? false,
      clear: () => input?.clear(),
      setOwner: owner => input?.setOwner(owner),
      handoff: device => input?.handoff(device)
    });
    this.inputRouter = input;
    this.dispatcher = new GameEventDispatcher(bridge);
    this.events = Object.freeze({
      readAfter: (cursor, max) => readGameEvents(bridge, cursor, max),
      subscribe: fn => this.dispatcher.subscribe(fn),
      poll: max => this.dispatcher.poll(max)
    });
    this.state = 'uninitialized';
    this.listeners = new Set();
    this.rom = null;
    this.mode = null;
    this.disposed = false;
    this.resumeInputOwner = null;
  }
  #publish(state, error = null) {
    this.state = state;
    const data = Object.freeze({ state, experience: this.mode, romReady: !!this.rom, error });
    for (const fn of [...this.listeners]) fn(data);
    return data;
  }
  subscribeState(fn) {
    if (typeof fn !== 'function') throw new TypeError('State listener must be a function');
    this.listeners.add(fn);
    fn({ state: this.state, experience: this.mode, romReady: !!this.rom, error: null });
    return () => this.listeners.delete(fn);
  }
  initialize() {
    if (this.disposed) throw new Error('Session is disposed');
    if (this.state !== 'uninitialized' && this.mode !== null) return this.state;
    this.mode = this.bridge.api.getEnabled() ? 'revival' : 'classic';
    // Attach to the already-running C engine; never instantiate another one.
    this.#publish(this.state === 'uninitialized' ? 'playing' : this.state);
    return this.state;
  }
  async loadRom(file) {
    if (this.disposed) throw new Error('Session is disposed');
    if (!file || typeof file.arrayBuffer !== 'function') throw new TypeError('File required');
    const validated = await this.#validateRom(new Uint8Array(await file.arrayBuffer()));
    // Reuse the existing origin-scoped, validated ROM store. Storage denial is
    // nonfatal, and never affects the running Classic instance.
    await rememberRdxRom(this.rom.bytes, { name: file.name || 'Rick_Dangerous_DX_1.3.bin' });
    return validated;
  }
  async #validateRom(bytes) {
    const previous = this.state;
    if (previous !== 'playing' && previous !== 'paused') this.#publish('rom-loading');
    try {
      const validated = await validateRdxRomBytes(bytes);
      this.rom = validated; // preflight only: do not silently switch the active mode
      if (previous !== 'playing' && previous !== 'paused')
        this.#publish(this.mode === 'revival' ? 'ready-revival' : 'ready-classic');
      return { sha256: validated.sha256, bytes: validated.bytes.length };
    } catch (error) {
      this.#publish(previous === 'rom-loading' ? 'ready-classic' : previous, error);
      throw error;
    }
  }
  async loadRememberedRom() {
    const found = await loadRememberedRdxRom();
    if (!found) return null;
    return this.#validateRom(found.bytes);
  }
  syncExperience() {
    // The legacy 2D ROM auto-loader may select the native experience outside
    // this facade. Reconcile before a VR transition; C remains authoritative.
    const actual = this.bridge.api.getEnabled() ? 'revival' : 'classic';
    if (this.mode !== actual && this.state !== 'uninitialized') {
      this.inputRouter?.clear();
      this.dispatcher.reset();
      this.mode = actual;
      this.#publish(this.state);
    }
    return actual;
  }
  selectExperience(mode) {
    this.syncExperience();
    if (this.disposed || this.state === 'uninitialized') throw new Error('Initialize session first');
    if (!['classic', 'revival'].includes(mode)) throw new RangeError('Experience must be classic or revival');
    if (mode === 'revival' && !this.rom && !this.bridge.presentationReady())
      throw new Error('A validated RDX ROM is required for Revival');
    if (this.mode === mode && this.state !== 'error') return this.state;
    this.stop(); // stop/clear old controls, invalidate reader and hold frontend
    this.#publish('switching');
    try {
      if (mode === 'revival' && this.rom)
        this.bridge.preparePresentationRom(this.rom.bytes); // does NOT select mode
      this.bridge.selectExperience(mode);
      if (mode === 'revival' && !this.bridge.presentationReady())
        throw new Error('Native Revival presentation is unavailable');
      this.mode = mode;
      // Reset the old room's native actors at their owning lifecycle boundary.
      this.bridge.resetCurrentLevel();
      this.dispatcher.reset();
      return this.#publish(mode === 'classic' ? 'ready-classic' : 'ready-revival').state;
    } catch (error) {
      this.mode = this.bridge.api.getEnabled() ? 'revival' : 'classic';
      this.dispatcher.reset();
      this.#publish('error', error);
      throw error;
    }
  }
  start() {
    if (!['ready-classic', 'ready-revival', 'paused', 'stopped'].includes(this.state))
      throw new Error(`Cannot start from ${this.state}`);
    if (this.mode === 'revival' && !this.bridge.presentationReady())
      throw new Error('Revival ROM not ready');
    this.bridge.setFrontendPaused(false);
    this.bridge.resumeBrowserLoop();
    if (this.inputRouter?.owner === 'none' && this.resumeInputOwner)
      this.inputRouter.setOwner(this.resumeInputOwner);
    this.dispatcher.resume({ skipStale: true });
    this.#publish('playing');
    return true;
  }
  #releaseInput() {
    // Pause -> stop -> switch is a valid sequence. Do not overwrite the
    // original handoff owner with the 'none' state established by pause.
    if (this.inputRouter && this.inputRouter.owner !== 'none')
      this.resumeInputOwner = this.inputRouter.owner;
    if (this.inputRouter) this.inputRouter.setOwner('none');
    else this.input.clear();
  }
  pause() {
    if (this.state !== 'playing') return false;
    this.#releaseInput();
    this.bridge.setFrontendPaused(true);
    this.dispatcher.suspend();
    this.#publish('paused');
    return true;
  }
  resume() { return this.state === 'paused' ? this.start() : false; }
  stop() {
    if (this.state === 'uninitialized' || this.disposed) return false;
    this.#releaseInput();
    this.bridge.setFrontendPaused(true);
    this.dispatcher.suspend();
    this.dispatcher.reset();
    this.#publish('stopped');
    return true;
  }
  getVideoSurface() {
    const serial = this.bridge.api.getFrameSerial() >>> 0;
    const mode = this.bridge.api.getEnabled() ? 'revival' : 'classic';
    const generation = this.bridge.api.gameEventsGeneration() >>> 0;
    const assertFresh = () => {
      if ((this.bridge.api.gameEventsGeneration() >>> 0) !== generation ||
          (this.bridge.api.getFrameSerial() >>> 0) !== serial)
        throw new Error('Video surface is stale; acquire a new snapshot');
    };
    return Object.freeze({ generation, kind: mode === 'classic' ? 'native-indexed' : 'native-rgba',
      width: 320, height: 200, serial, mode,
      // Read only when requested; true Classic uses native indices/palette, not the RDX ROM.
      pixels: () => {
        assertFresh();
        return mode === 'classic' ? this.bridge.framebuffer() : this.bridge.presentationFramebuffer();
      },
      palette: mode === 'classic' ? index => { assertFresh(); return this.bridge.palette(index); } : null });
  }
  getAudioEndpoint() {
    return Object.freeze({ type: 'existing-sdl', module: this.module,
      available: () => this.bridge.soundAvailable(),
      muted: () => this.bridge.soundMuted(),
      setMuted: muted => this.bridge.setSoundMuted(muted) });
  }
  dispose() {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    this.listeners.clear();
    this.dispatcher.listeners.clear();
    this.rom = null;
    this.#publish('uninitialized');
  }
}
