export const NATIVE_SCENE_FRAME_MS = 40;

export function stepNativeFrame(bridge, controlMask = 0) {
  const before = Number(bridge?.snapshot?.().frameSerial ?? -1);
  bridge?.setDebugControl?.(Number(controlMask) >>> 0);
  bridge?.debugForceBrowserFrame?.();
  bridge?.setDebugControl?.(0);
  const after = Number(bridge?.snapshot?.().frameSerial ?? before);
  return { before, after, advanced: after !== before, mask: Number(controlMask) >>> 0 };
}

export function saveNativeSceneCheckpoint(preview, slot, runnerState = null) {
  const checkpointSlot = Number(slot) >>> 0;
  if (typeof preview?.bridge?.debugCheckpointSave !== 'function' || !preview.bridge.debugCheckpointSave(checkpointSlot)) {
    throw new Error(`Native scene could not save checkpoint slot ${checkpointSlot}`);
  }
  return {
    slot: checkpointSlot,
    runner: runnerState,
    tracking: preview.captureTrackingState?.() || null,
    frameSerial: Number(preview.bridge.snapshot?.().frameSerial ?? -1),
  };
}

export function restoreNativeSceneCheckpoint(preview, checkpoint) {
  if (!checkpoint || typeof checkpoint !== 'object') throw new Error('Native scene checkpoint is missing');
  const slot = Number(checkpoint.slot) >>> 0;
  if (typeof preview?.bridge?.debugCheckpointLoad !== 'function' || !preview.bridge.debugCheckpointLoad(slot)) {
    throw new Error(`Native scene could not restore checkpoint slot ${slot}`);
  }
  if (checkpoint.tracking && preview.restoreTrackingState) preview.restoreTrackingState(checkpoint.tracking);
  return checkpoint;
}

export function discardNativeSceneCheckpoint(preview, checkpoint) {
  if (checkpoint) preview?.bridge?.debugCheckpointDiscard?.(Number(checkpoint.slot) >>> 0);
}

export function nativeSceneEventMatches(event, proof = {}) {
  if (!event || !proof) return false;
  if (proof.event && String(event.event) !== String(proof.event)) return false;
  if (proof.eventId != null && Number(event.eventId) !== Number(proof.eventId)) return false;
  if (proof.submap != null && Number(event.submap) !== Number(proof.submap)) return false;
  if (proof.mark != null && Number(event.actor?.mark) !== Number(proof.mark)) return false;
  if (proof.actorFamily && String(event.actor?.family || '') !== String(proof.actorFamily)) return false;
  return true;
}

export function nativeSceneControlMask(scene, frame) {
  for (const row of scene?.controls || []) {
    const from = Math.max(0, Number(row.from || 0) | 0);
    const to = row.to == null ? from : Math.max(from, Number(row.to) | 0);
    if (frame >= from && frame <= to) return Number(row.mask) >>> 0;
  }
  return 0;
}

export class NativeSceneRunner {
  constructor(preview, { checkpointSlot = 7, onState = null } = {}) {
    if (!preview?.bridge) throw new Error('Native scene requires the live xrick preview');
    this.preview = preview;
    this.bridge = preview.bridge;
    this.checkpointSlot = Number(checkpointSlot) >>> 0;
    this.onState = onState;
    this.scene = null;
    this.baseline = null;
    this.active = false;
    this.paused = false;
    this.loopEnabled = true;
    this.frame = 0;
    this.phase = 'inactive';
    this.error = null;
    this.proofEvent = null;
    this.postEventRemaining = 0;
    this.windowStart = 0;
    this.windowEnd = null;
    this.knownProofFrame = null;
    this.baselineEventSerial = 0;
  }

  state() {
    return {
      active: this.active, paused: this.paused, loop: this.loopEnabled,
      frame: this.frame, phase: this.phase, error: this.error,
      sceneId: this.scene?.id || null, proofEvent: this.proofEvent ? { ...this.proofEvent } : null,
      postEventRemaining: this.postEventRemaining,
      window: this.windowState(),
    };
  }

  windowState() {
    const maxFrames = Math.max(1, Number(this.scene?.proof?.maxFrames || this.scene?.maxFrames || 180) | 0);
    const tail = Math.max(0, Number(this.scene?.postEventFrames || 0) | 0);
    const total = this.knownProofFrame == null ? maxFrames + tail : Math.max(1, this.knownProofFrame + tail);
    return { start: this.windowStart, end: Math.min(this.windowEnd ?? total, total), total, proofFrame: this.knownProofFrame, editable: this.knownProofFrame != null };
  }

  #publish() { const value = this.state(); this.onState?.(value); return value; }
  #fail(message) { this.error = String(message); this.phase = 'error'; this.active = false; this.bridge.setDebugControl?.(0); this.#publish(); return false; }

  start(scene) {
    if (!scene || !Number.isInteger(Number(scene.submap))) throw new Error('Native scene requires a submap');
    this.stop({ discard: true });
    this.scene = scene;
    this.loopEnabled = scene.loop !== false;
    this.phase = 'staging';
    this.error = null;
    this.frame = 0;
    this.proofEvent = null;
    this.postEventRemaining = 0;
    this.windowStart = 0;
    this.windowEnd = null;
    this.knownProofFrame = null;
    this.bridge.setFrontendPaused?.(true);
    this.preview.clearKeys?.();
    if (!this.preview.selectSubmap(Number(scene.submap))) throw new Error(`Native scene could not select submap ${scene.submap}`);
    if (typeof this.bridge.restartCurrentLevelNow === 'function') {
      if (!this.bridge.restartCurrentLevelNow()) { this.bridge.resetCurrentLevel?.(); this.bridge.debugForceBrowserFrame?.(); }
    } else {
      this.preview.resetLevel?.();
      this.bridge.debugForceBrowserFrame?.();
    }
    this.bridge.setFrontendPaused?.(true);
    this.bridge.setDebugInvincible?.(true);
    this.preview.setEditorAutoRefill?.(true);
    for (let i = 0, n = Math.max(0, Number(scene.preStageFrames || 0) | 0); i < n; i += 1) stepNativeFrame(this.bridge, 0);
    this.baselineEventSerial = Number(this.bridge.soundLabEventSerial?.() || 0) >>> 0;
    this.baseline = saveNativeSceneCheckpoint(this.preview, this.checkpointSlot, { eventSerial: this.baselineEventSerial });
    this.active = true;
    this.paused = false;
    this.phase = 'running';
    return this.#publish();
  }

  setPaused(paused) { this.paused = !!paused; this.bridge.setDebugControl?.(0); return this.#publish(); }
  setLoop(loop) { this.loopEnabled = !!loop; return this.#publish(); }
  setWindow(start, end) {
    if (this.knownProofFrame == null) return this.#publish();
    const { total } = this.windowState();
    const proof = Math.max(1, Number(this.knownProofFrame) | 0);
    const nextStart = Math.max(0, Math.min(proof - 1, Number(start) | 0));
    const nextEnd = Math.max(proof + 1, Math.min(total, Number(end) | 0));
    this.windowStart = Math.min(nextStart, nextEnd - 1);
    this.windowEnd = Math.max(this.windowStart + 1, nextEnd);
    this.restart();
    return this.#publish();
  }

  restart() {
    if (!this.baseline) return false;
    restoreNativeSceneCheckpoint(this.preview, this.baseline);
    this.frame = 0; this.proofEvent = null; this.postEventRemaining = 0; this.phase = this.paused ? 'paused' : 'running'; this.error = null;
    this.bridge.setDebugControl?.(0);
    /* Once the proof frame is known, an author can trim quiet pre-roll.  The
     * selected start is constrained to remain before the proof event, so this
     * deterministic fast-forward cannot skip the event that validates the
     * fixture. */
    while (this.frame < this.windowStart) {
      stepNativeFrame(this.bridge, nativeSceneControlMask(this.scene, this.frame));
      this.frame += 1;
    }
    this.#publish();
    return true;
  }

  noteEvent(event) {
    if (!this.active || this.proofEvent || !nativeSceneEventMatches(event, this.scene?.proof || {})) return false;
    this.proofEvent = { ...event, sceneFrame: this.frame };
    this.knownProofFrame = this.frame;
    this.postEventRemaining = Math.max(0, Number(this.scene?.postEventFrames || 0) | 0);
    this.phase = this.postEventRemaining ? 'post-event' : 'event';
    this.#publish();
    return true;
  }

  step() {
    if (!this.active || this.paused || this.error) return { ...this.state(), advanced: false, wrapped: false };
    if (this.windowEnd != null && this.frame >= this.windowEnd) {
      if (this.loopEnabled) { this.restart(); return { ...this.state(), advanced: false, wrapped: true }; }
      this.paused = true; this.phase = 'paused'; this.#publish(); return { ...this.state(), advanced: false, wrapped: false };
    }
    const maxFrames = Math.max(1, Number(this.scene?.proof?.maxFrames || this.scene?.maxFrames || 180) | 0);
    if (!this.proofEvent && this.frame >= maxFrames) {
      this.#fail(`Scene ${this.scene?.id || 'fixture'} did not emit ${this.scene?.proof?.event || 'its proof event'} within ${maxFrames} frames.`);
      return { ...this.state(), advanced: false, wrapped: false };
    }
    if (this.proofEvent && this.postEventRemaining <= 0) {
      if (this.loopEnabled) { this.restart(); return { ...this.state(), advanced: false, wrapped: true }; }
      this.paused = true; this.phase = 'paused'; this.#publish(); return { ...this.state(), advanced: false, wrapped: false };
    }
    const result = stepNativeFrame(this.bridge, nativeSceneControlMask(this.scene, this.frame));
    this.frame += 1;
    if (this.proofEvent && this.postEventRemaining > 0) {
      this.postEventRemaining -= 1;
      if (this.postEventRemaining === 0) this.phase = 'restart';
    }
    this.#publish();
    return { ...this.state(), ...result, wrapped: false };
  }

  stop({ discard = false } = {}) {
    this.bridge?.setDebugControl?.(0);
    this.active = false; this.paused = true; this.phase = 'inactive'; this.error = null; this.proofEvent = null; this.postEventRemaining = 0;
    if (discard && this.baseline) { discardNativeSceneCheckpoint(this.preview, this.baseline); this.baseline = null; }
    return this.#publish();
  }
}
