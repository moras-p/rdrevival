import { XrickLivePreview, LIVE_WIDTH, LIVE_HEIGHT, NATIVE_SFX_IDS } from '../juice/xrick-live-preview.js';

const CHECKPOINT_SLOTS = Object.freeze([0, 1, 2, 3, 4, 5, 6]);
const CHECKPOINT_INTERVAL_FRAMES = 6;
const DEFAULT_PREROLL_FRAMES = 24;
const DEFAULT_TAIL_FRAMES = 16;
const HISTORY_FRAMES = 256;
const GAME_FRAME_MS = 40;
const NATIVE_SFX_LOGICAL_IDS = Object.freeze([...new Set(Object.values(NATIVE_SFX_IDS))]);
const SOUNDLAB_GAME_JUICE_PRESET = 'amiga_palette_punch';

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function sampleActor(snapshot, target = {}) {
  if (!snapshot) return null;
  const entities = snapshot.entities || [];
  let entity = null;
  if (Number.isInteger(Number(target.slot))) entity = entities.find(row => Number(row.slot) === Number(target.slot));
  if (!entity && Number.isInteger(Number(target.mark))) entity = entities.find(row => Number(row.mark) === Number(target.mark));
  if (!entity) return null;
  const slot = Number(entity.slot);
  const audit = (snapshot.presentation || []).find(row => Number(row.slot) === slot && Number(row.visiblePixels || 0) > 0);
  const frameSerial = finite(snapshot.frameSerial, -1);
  if (audit) {
    const width = Math.max(1, finite(audit.width, entity.w || 1));
    const height = Math.max(1, finite(audit.height, entity.h || 1));
    const left = finite(audit.drawX);
    const top = finite(audit.drawY);
    return { frameSerial, slot, mark:Number(entity.mark), x:left + width / 2, y:top + height / 2, bottom:top + height, width, height };
  }
  const width = Math.max(1, finite(entity.w, 1));
  const height = Math.max(1, finite(entity.h, 1));
  return { frameSerial, slot, mark:Number(entity.mark), x:finite(entity.x) + 32 + width / 2, y:finite(entity.y) - 56 + height / 2, bottom:finite(entity.y) - 56 + height, width, height };
}

function motionFacts(path, proofFrame) {
  if (!path.length) return { fallPx:0, horizontalPx:0, bouncePx:0, bounceCount:0 };
  const pre = path.filter(row => row.frameSerial <= proofFrame);
  const post = path.filter(row => row.frameSerial >= proofFrame);
  const contact = path.reduce((best, row) => Math.abs(row.frameSerial - proofFrame) < Math.abs(best.frameSerial - proofFrame) ? row : best, path[0]);
  const start = pre[0] || path[0];
  const highestPre = pre.length ? Math.min(...pre.map(row => row.y)) : contact.y;
  const highestPost = post.length ? Math.min(...post.map(row => row.y)) : contact.y;
  const fallPx = Math.max(0, Math.round(contact.y - highestPre));
  const horizontalPx = Math.round(Math.abs(contact.x - start.x));
  const bouncePx = Math.max(0, Math.round(contact.y - highestPost));
  let bounceCount = 0;
  let previousDy = 0;
  for (let i = 1; i < post.length; i += 1) {
    const dy = post[i].y - post[i - 1].y;
    if (previousDy < -0.25 && dy > 0.25) bounceCount += 1;
    if (Math.abs(dy) > 0.25) previousDy = dy;
  }
  if (!bounceCount && bouncePx >= 2) bounceCount = 1;
  return { fallPx, horizontalPx, bouncePx, bounceCount };
}

function sceneSegments(path, proofFrame, facts, action = 'impact') {
  if (!path.length) return [];
  const first = path[0].frameSerial, last = path.at(-1).frameSerial;
  const contact = path.reduce((best, row) => Math.abs(row.frameSerial - proofFrame) < Math.abs(best.frameSerial - proofFrame) ? row : best, path[0]);
  const contactFrame = contact.frameSerial;
  const rows = [];
  if (first < contactFrame) rows.push({ id:'approach', label:'approach', startFrame:first, endFrame:contactFrame });
  if (['roll','slide','scrape','mechanism'].includes(String(action))) {
    if (contactFrame < last) rows.push({ id:String(action), label:String(action), startFrame:contactFrame, endFrame:last });
    return rows;
  }
  rows.push({ id:'contact', label:'contact', startFrame:contactFrame, endFrame:contactFrame });
  if (contactFrame < last) {
    const post = path.filter(row => row.frameSerial >= contactFrame);
    let apex = contact;
    if ((facts?.bouncePx || 0) >= 2) {
      for (const row of post) if (row.y < apex.y) apex = row;
    }
    if (apex.frameSerial > contactFrame) rows.push({ id:'rebound', label:'rebound', startFrame:contactFrame, endFrame:apex.frameSerial });
    const settleStart = Math.max(contactFrame, apex.frameSerial);
    if (settleStart < last) rows.push({ id:'settle', label:'settle', startFrame:settleStart, endFrame:last });
  }
  return rows;
}

export class RdrSoundLabRuntime {
  constructor({
    canvas,
    onEvent,
    onScene,
    onFrame,
    onReplay,
    onStatus,
    previewFactory = XrickLivePreview,
    fetcher = globalThis.fetch?.bind(globalThis),
    requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
    cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
    now = () => globalThis.performance?.now?.() ?? Date.now()
  } = {}) {
    this.canvas = canvas;
    this.ctx = canvas?.getContext('2d');
    this.onEvent = onEvent;
    this.onScene = onScene;
    this.onFrame = onFrame;
    this.onReplay = onReplay;
    this.onStatus = onStatus;
    this.previewFactory = previewFactory;
    this.fetcher = fetcher;
    this.requestFrame = requestFrame || (() => 0);
    this.cancelFrame = cancelFrame || (() => {});
    this.now = now;
    this.preview = null;
    this.lastSerial = 0;
    this.running = false;
    this.raf = 0;
    this.target = {};
    this.checkpoints = [];
    this.checkpointCursor = 0;
    this.lastCheckpointFrame = -1;
    this.history = [];
    this.scene = null;
    this.pendingScene = null;
    this.scenePlayback = null;
    this.keyDown = event => this.preview?.keyDown(event.code);
    this.keyUp = event => this.preview?.keyUp(event.code);
  }

  async start({ submap = 0, event = '', match = {}, action = 'impact', durationMs = 0, playback = '' } = {}) {
    if (this.preview) return;
    this.target = { event:String(event || ''), mark:Number(match?.mark), actorFamily:String(match?.actorFamily || ''), action:String(action || 'impact'), playback:String(playback || ''), tailFrames:Math.max(DEFAULT_TAIL_FRAMES, Math.ceil(Math.max(0, finite(durationMs, 0)) / GAME_FRAME_MS)) };
    this.onStatus?.('Starting native runtime…');
    this.preview = await this.previewFactory.create(() => {}, () => {});
    if (!this.fetcher) throw new Error('Native runtime fetch is unavailable');
    const response = await this.fetcher('rdx/data/editor/Rick_Dangerous_DX_1.3x.bin', { cache:'no-store' });
    if (!response.ok) throw new Error(`RDX ROM load failed (${response.status})`);
    await this.preview.loadRdxRom(new Uint8Array(await response.arrayBuffer()));
    this.preview.setPresentation('rdx');
    if (!this.preview.selectSubmap(submap)) throw new Error(`Native runtime could not select submap ${submap}`);
    await this.preview.resetLevelForPlaytest();
    this.#applySoundLabPresentationDefaults();
    this.lastSerial = this.preview.bridge.soundLabEventSerial?.() || 0;
    this.#resetSceneState();
    this.running = true;
    this.canvas?.addEventListener('keydown', this.keyDown);
    this.canvas?.addEventListener('keyup', this.keyUp);
    this.#loop();
    this.onStatus?.('Native RDX simulation · authoritative timing');
  }

  reset() {
    if (!this.preview) return;
    this.#releaseSceneHold();
    this.preview.resetLevel();
    this.#applySoundLabPresentationDefaults();
    this.lastSerial = this.preview.bridge.soundLabEventSerial?.() || 0;
    this.#resetSceneState();
    this.preview.bridge.resumeBrowserLoop?.();
    this.onStatus?.('Native RDX simulation · authoritative timing');
  }

  stop() {
    this.running = false;
    if (this.raf) this.cancelFrame(this.raf);
    this.canvas?.removeEventListener('keydown', this.keyDown);
    this.canvas?.removeEventListener('keyup', this.keyUp);
    this.preview?.clearKeys();
    this.#releaseSceneHold();
    this.#discardCheckpoints();
  }

  canReplayEvent(serial) {
    return !!this.scene && (Number(this.scene.serial) >>> 0) === (Number(serial) >>> 0);
  }

  replayEvent(serial) {
    if (!this.scene || (Number(this.scene.serial) >>> 0) !== (Number(serial) >>> 0)) return false;
    return this.replayScene(serial, { startFrame:this.scene.startFrame, endFrame:this.scene.endFrame });
  }

  replayScene(serial, { startFrame, endFrame } = {}, { suppressSoundLab = false } = {}) {
    if (!this.preview || !this.scene || (Number(this.scene.serial) >>> 0) !== (Number(serial) >>> 0)) return false;
    const scene = this.scene;
    const start = Math.max(scene.minFrame, Math.min(scene.proofFrame, Math.round(finite(startFrame, scene.startFrame))));
    const end = Math.min(scene.maxFrame, Math.max(scene.proofFrame, Math.round(finite(endFrame, scene.endFrame))));
    const checkpoint = scene.checkpoint;
    this.#holdForSeek();
    if (!this.preview.bridge.debugCheckpointLoad?.(checkpoint.slot)) {
      this.#releaseSceneHold();
      return false;
    }
    if (checkpoint.tracking) this.preview.restoreTrackingState?.(checkpoint.tracking);
    this.lastSerial = checkpoint.lastSerial;
    this.#suppressNativeSfx(true);
    this.#setSoundLabRuntimeSuppressed(true);
    this.preview.bridge.setAiAudioHold?.(true);

    const seekTarget = Math.max(checkpoint.frameSerial, start - 1);
    let frame = this.preview.capture();
    let frameSerial = finite(frame?.snapshot?.frameSerial, checkpoint.frameSerial);
    while (frameSerial < seekTarget) {
      this.preview.bridge.debugForceBrowserFrame?.();
      frame = this.preview.capture();
      frameSerial = finite(frame?.snapshot?.frameSerial, frameSerial + 1);
    }
    this.#drawFrame(frame);

    /* Seeking is intentionally silent. Clear every logical native SFX suppression
     * only when the selected scene window begins, so trap activation, earlier
     * impacts and other pre-window requests cannot burst out at the start handle. */
    this.#suppressNativeSfx(false);
    this.#setSoundLabRuntimeSuppressed(!!suppressSoundLab);
    this.preview.bridge.setAiAudioHold?.(false);
    this.scenePlayback = { serial:Number(serial) >>> 0, startFrame:start, endFrame:end, frameSerial, lastStep:this.now() - GAME_FRAME_MS, suppressSoundLab:!!suppressSoundLab, proofNotified:false };
    this.onFrame?.({ frame, scene:{ ...scene, startFrame:start, endFrame:end }, replay:true });
    this.onReplay?.({ phase:'start', serial:Number(serial) >>> 0, startFrame:start, endFrame:end, proofFrame:scene.proofFrame, frameSerial, draft:!!suppressSoundLab });
    this.onStatus?.(`Playing scene window · ${start}–${end}f`);
    return true;
  }

  #applySoundLabPresentationDefaults() {
    const applied = this.preview?.bridge?.setRuntimeOption?.('game_juice_preset', SOUNDLAB_GAME_JUICE_PRESET);
    if (applied != null && applied !== SOUNDLAB_GAME_JUICE_PRESET)
      throw new Error(`SoundLab native preview could not enable ${SOUNDLAB_GAME_JUICE_PRESET} Game Juice`);
  }

  #resetSceneState() {
    this.#discardCheckpoints();
    this.checkpoints = [];
    this.checkpointCursor = 0;
    this.lastCheckpointFrame = -1;
    this.history = [];
    this.scene = null;
    this.pendingScene = null;
    this.scenePlayback = null;
  }

  #discardCheckpoints() {
    if (this.preview?.bridge?.debugCheckpointDiscard) for (const slot of CHECKPOINT_SLOTS) this.preview.bridge.debugCheckpointDiscard(slot);
  }

  #releaseSceneHold() {
    if (!this.preview?.bridge) return;
    this.preview.bridge.setAiAudioHold?.(false);
    this.#suppressNativeSfx(false);
    this.#setSoundLabRuntimeSuppressed(false);
    this.preview.bridge.setAiTransitionHold?.(false);
    this.scenePlayback = null;
  }

  #holdForSeek() {
    if (!this.preview?.bridge) return;
    this.preview.bridge.setAiTransitionHold?.(true);
    this.preview.bridge.setAiAudioHold?.(true);
  }

  #suppressNativeSfx(suppressed) {
    const bridge = this.preview?.bridge;
    if (!bridge) return;
    if (!suppressed) {
      bridge.clearSoundSfxSuppressions?.();
      return;
    }
    bridge.clearSoundSfxSuppressions?.();
    for (const logicalId of NATIVE_SFX_LOGICAL_IDS) bridge.setSoundSfxSuppressed?.(logicalId, true);
  }

  #setSoundLabRuntimeSuppressed(suppressed) {
    this.preview?.bridge?.setSoundLabRuntimeSuppressed?.(!!suppressed);
  }

  #saveCheckpoint(frameSerial) {
    if (!this.preview?.bridge?.debugCheckpointSave || this.pendingScene || this.scene) return;
    if (this.lastCheckpointFrame >= 0 && frameSerial - this.lastCheckpointFrame < CHECKPOINT_INTERVAL_FRAMES) return;
    const slot = CHECKPOINT_SLOTS[this.checkpointCursor++ % CHECKPOINT_SLOTS.length];
    if (!this.preview.bridge.debugCheckpointSave(slot)) return;
    const checkpoint = {
      slot,
      tracking:this.preview.captureTrackingState?.() || null,
      lastSerial:this.lastSerial,
      frameSerial
    };
    this.checkpoints = this.checkpoints.filter(row => row.slot !== slot);
    this.checkpoints.push(checkpoint);
    this.checkpoints.sort((a, b) => a.frameSerial - b.frameSerial);
    this.lastCheckpointFrame = frameSerial;
  }

  #checkpointForProof(proofFrame) {
    if (!this.checkpoints.length) return null;
    const desired = proofFrame - DEFAULT_PREROLL_FRAMES;
    const eligible = this.checkpoints.filter(row => row.frameSerial <= desired);
    return eligible.at(-1) || this.checkpoints[0];
  }

  #recordHistory(snapshot, target = this.target) {
    const sample = sampleActor(snapshot, target);
    if (!sample || sample.frameSerial < 0) return;
    const previous = this.history.at(-1);
    if (previous?.frameSerial === sample.frameSerial) this.history[this.history.length - 1] = sample;
    else this.history.push(sample);
    if (this.history.length > HISTORY_FRAMES) this.history.splice(0, this.history.length - HISTORY_FRAMES);
  }

  #beginScene(event, snapshot, frameSerial) {
    if (this.scene || this.pendingScene) return null;
    if (this.target.event && event.event !== this.target.event) return null;
    const checkpoint = this.#checkpointForProof(frameSerial);
    if (!checkpoint) return null;
    const target = { ...this.target, slot:Number(event.actor?.slot), mark:Number(event.actor?.mark ?? this.target.mark) };
    this.#recordHistory(snapshot, target);
    this.pendingScene = { event, target, checkpoint, proofFrame:frameSerial, maxFrame:frameSerial + target.tailFrames };
    return checkpoint;
  }

  #finishScene(snapshot) {
    const pending = this.pendingScene;
    if (!pending) return;
    const frameSerial = finite(snapshot?.frameSerial, -1);
    if (frameSerial < pending.maxFrame) return;
    this.preview.bridge.setAiTransitionHold?.(true);
    const path = this.history.filter(row => row.frameSerial >= pending.checkpoint.frameSerial && row.frameSerial <= frameSerial);
    const facts = motionFacts(path, pending.proofFrame);
    this.scene = {
      serial:Number(pending.event.serial) >>> 0,
      event:pending.event,
      target:pending.target,
      checkpoint:pending.checkpoint,
      proofFrame:pending.proofFrame,
      minFrame:pending.checkpoint.frameSerial,
      maxFrame:frameSerial,
      startFrame:Math.max(pending.checkpoint.frameSerial, pending.proofFrame - DEFAULT_PREROLL_FRAMES),
      endFrame:frameSerial,
      path,
      contact:path.reduce((best, row) => !best || Math.abs(row.frameSerial - pending.proofFrame) < Math.abs(best.frameSerial - pending.proofFrame) ? row : best, null),
      facts,
      segments:sceneSegments(path, pending.proofFrame, facts, pending.target.action),
      viewport:{ width:LIVE_WIDTH, height:LIVE_HEIGHT }
    };
    this.pendingScene = null;
    this.onScene?.(this.scene);
    this.onStatus?.('Scene ready · drag the window handles to audition');
  }

  #drawFrame(frame) {
    if (this.ctx && frame?.canvas) {
      this.ctx.imageSmoothingEnabled = false;
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.drawImage(frame.canvas, 0, 0, LIVE_WIDTH, LIVE_HEIGHT, 0, 0, this.canvas.width, this.canvas.height);
    }
  }

  #captureNormalFrame() {
    const frame = this.preview.capture();
    this.#drawFrame(frame);
    const frameSerial = finite(frame?.snapshot?.frameSerial, -1);
    this.#recordHistory(frame?.snapshot, this.pendingScene?.target || this.target);
    const events = this.preview.bridge.soundLabEventsSince?.(this.lastSerial, 64) || [];
    for (const event of events) {
      this.lastSerial = event.serial;
      const checkpoint = this.#beginScene(event, frame.snapshot, frameSerial);
      const enriched = {
        ...event,
        actor:{ ...event.actor, family:this.target.actorFamily || undefined },
        replayable:!!checkpoint,
        preRollFrames:checkpoint ? Math.max(0, frameSerial - checkpoint.frameSerial) : 0
      };
      this.onEvent?.(enriched, frame.snapshot);
    }
    if (frameSerial >= 0) this.#saveCheckpoint(frameSerial);
    this.#finishScene(frame?.snapshot);
    this.onFrame?.({ frame, scene:this.scene, replay:false });
  }

  #captureReplayFrame() {
    const playback = this.scenePlayback;
    if (!playback) return;
    const now = this.now();
    if (now - playback.lastStep < GAME_FRAME_MS) return;
    playback.lastStep = now;
    const previousFrame = playback.frameSerial;
    const entersProof = playback.suppressSoundLab && !playback.proofNotified &&
      previousFrame < this.scene.proofFrame && previousFrame + 1 >= this.scene.proofFrame;
    if (entersProof) {
      /* A draft audition owns the selected contact and its tail. Stop any
       * pre-contact native SFX still ringing, then suppress new native SFX
       * through the authored end frame. This prevents trigger/bounce voices or
       * a promoted variant from coloring/doubling the deterministic draft.
       * Music is not stopped by the native SFX flush. */
      this.preview.bridge.setAiAudioHold?.(true);
      this.#suppressNativeSfx(true);
      this.preview.bridge.setAiAudioHold?.(false);
    }
    this.preview.bridge.debugForceBrowserFrame?.();
    const frame = this.preview.capture();
    playback.frameSerial = finite(frame?.snapshot?.frameSerial, playback.frameSerial + 1);
    this.#drawFrame(frame);
    if (!playback.proofNotified && previousFrame < this.scene.proofFrame && playback.frameSerial >= this.scene.proofFrame) {
      playback.proofNotified = true;
      this.onReplay?.({ phase:'proof', serial:playback.serial, startFrame:playback.startFrame, endFrame:playback.endFrame, proofFrame:this.scene.proofFrame, frameSerial:playback.frameSerial, draft:playback.suppressSoundLab });
    }
    this.onFrame?.({ frame, scene:{ ...this.scene, startFrame:playback.startFrame, endFrame:playback.endFrame }, replay:true });
    if (playback.frameSerial >= playback.endFrame) {
      /* Stop any cue that would extend beyond the authored window, but keep the
       * gameplay timeline frozen so the next replay always starts from the same
       * deterministic checkpoint. */
      this.preview.bridge.setAiAudioHold?.(true);
      this.preview.bridge.setAiAudioHold?.(false);
      this.#suppressNativeSfx(false);
      this.#setSoundLabRuntimeSuppressed(false);
      this.scenePlayback = null;
      this.onReplay?.({ phase:'end', serial:playback.serial, startFrame:playback.startFrame, endFrame:playback.endFrame, proofFrame:this.scene.proofFrame, frameSerial:playback.frameSerial, draft:playback.suppressSoundLab });
      this.onStatus?.('Scene window complete');
    }
  }

  #loop() {
    if (!this.running) return;
    if (this.scenePlayback) this.#captureReplayFrame();
    else if (!this.scene) this.#captureNormalFrame();
    this.raf = this.requestFrame(() => this.#loop());
  }
}

export { RdrSoundLabRuntime as SoundLabRuntime };
