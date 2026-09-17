import { projectAuthoritativeControllerDescriptors } from '../runtime/controller-descriptors.js';
import { sampleNativeRuntime } from '../runtime/runtime-sample.js';
import { NativeObservationTimeline } from '../runtime/runtime-timeline.js';

export class NativeRuntimeService {
  constructor({ adapter, timeline = null, scriptedPaths = null } = {}) {
    if (!adapter) throw new TypeError('NativeRuntimeService requires a NativeRuntimeAdapter');
    this.adapter = adapter;
    this.timeline = timeline || new NativeObservationTimeline();
    this.scriptedPaths = scriptedPaths;
    this.listeners = new Set();
    this.state = { mode: 'idle', running: false, loading: false, room: null, loadToken: null, descriptors: Object.freeze([]), sample: null, error: null, simulationTick:0 };
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit(reason) { const value = this.snapshot(); for (const listener of this.listeners) listener(value, reason); }
  snapshot() { return Object.freeze({ ...this.state, timeline: this.timeline.snapshot() }); }
  setScriptedPaths(paths) { this.scriptedPaths = paths; if (this.state.room) this.state.descriptors = projectAuthoritativeControllerDescriptors(this.state.room, paths); }

  startSimulate({ room, draft = null, presentation = 'rdx' } = {}) {
    return this.start({ mode: 'simulate', room, draft, presentation, invincible: true, infiniteResources: true, soundMuted: true });
  }
  startPlaytest({ room, draft = null, presentation = 'rdx', invincible = false, infiniteResources = false, soundMuted = false } = {}) {
    return this.start({ mode: 'playtest', room, draft, presentation, invincible, infiniteResources, soundMuted });
  }
  start({ mode, room, draft, presentation, invincible, infiniteResources, soundMuted }) {
    if (!room) throw new Error('Native runtime needs a ResolvedLevel room');
    if (this.state.mode !== 'idle') this.stop();
    this.timeline.reset();
    this.adapter.beginEditorRuntime({ mode, presentation, invincible, infiniteResources, soundMuted });
    this.adapter.clearDevelopmentDraft();
    const loadToken = this.adapter.loadRoom(room.submap);
    if (!loadToken?.selected) {
      this.adapter.restoreEditorRuntime();
      throw new Error(`Native runtime rejected ${room.id || `submap ${room.submap}`}`);
    }
    this.state = { mode, running: true, loading: true, room, loadToken, descriptors: projectAuthoritativeControllerDescriptors(room, this.scriptedPaths), sample: null, error: null, pendingDraft: draft, simulationTick:0 };
    this.emit('start');
    return this.snapshot();
  }
  finishLoad() {
    if (!this.state.loading || !this.adapter.roomReady(this.state.loadToken)) return false;
    const draft = this.state.pendingDraft;
    this.adapter.pause();
    if (draft) this.adapter.applyDevelopmentDraft(draft);
    this.adapter.setSimulateAllTriggers(this.state.mode === 'simulate');
    this.adapter.setEditorProjectileHitsNonlethal(this.state.mode === 'simulate');
    this.state.pendingDraft = null;
    this.state.loading = false;
    this.adapter.run();
    this.capture();
    this.emit('ready');
    return true;
  }
  capture() {
    if (this.state.mode === 'idle') return null;
    const snapshot = this.adapter.snapshot();
    const debugGeometry = this.adapter.runtimeDebugGeometry('rdx');
    const previous = this.timeline.samples.at(-1) || null;
    const sample = sampleNativeRuntime({ room: this.state.room, snapshot, debugGeometry, descriptors: this.state.descriptors, previous, simulationTick:this.state.simulationTick });
    this.state.simulationTick += 1;
    this.timeline.record(sample);
    this.state.sample = sample;
    this.emit('sample');
    return sample;
  }
  tick() {
    if (this.state.mode === 'idle') return null;
    if (this.state.loading) { this.finishLoad(); return this.state.sample; }
    if (this.state.running) return this.capture();
    return this.timeline.current() || this.state.sample;
  }
  pause() { if (this.state.mode === 'idle') return false; this.adapter.pause(); this.state.running = false; this.emit('pause'); return true; }
  run() { if (this.state.mode === 'idle') return false; this.timeline.live(); this.adapter.run(); this.state.running = true; this.emit('run'); return true; }
  stepFrame() {
    if (this.state.mode === 'idle' || this.state.loading) return null;
    this.adapter.pause(); this.state.running = false; this.adapter.stepFrame(); const sample = this.capture(); this.emit('step'); return sample;
  }
  scrub(index) { if (this.state.mode === 'idle') return null; this.pause(); const sample = this.timeline.scrub(index); this.state.sample = sample; this.emit('scrub'); return sample; }
  sendInput(mask) { if (this.state.mode !== 'playtest') return 0; return this.adapter.sendInput(mask); }
  framebuffer(presentation = 'rdx') { return this.adapter.framebuffer({ presentation }); }
  applyDraft(draft) {
    if (this.state.mode === 'idle') throw new Error('Start Simulate or Playtest before applying a development draft');
    const wasRunning = this.state.running;
    this.adapter.pause();
    this.state.running = false;
    this.adapter.applyDevelopmentDraft(draft);
    this.timeline.reset();
    const sample = this.capture();
    if (wasRunning) { this.adapter.run(); this.state.running = true; }
    this.emit('draft');
    return sample;
  }
  reset() { if (this.state.mode === 'idle') return false; this.adapter.setEditorProjectileHitsNonlethal(false); this.adapter.reset(); this.adapter.setEditorProjectileHitsNonlethal(this.state.mode === 'simulate'); this.timeline.reset(); this.state.loading = false; this.state.simulationTick = 0; this.capture(); this.emit('reset'); return true; }
  stop() {
    if (this.state.mode === 'idle') return false;
    this.adapter.sendInput(0);
    this.adapter.restoreEditorRuntime();
    this.timeline.reset();
    this.state = { mode: 'idle', running: false, loading: false, room: null, loadToken: null, descriptors: Object.freeze([]), sample: null, error: null, simulationTick:0 };
    this.emit('stop');
    return true;
  }
}
