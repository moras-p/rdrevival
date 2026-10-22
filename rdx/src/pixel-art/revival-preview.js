import { requireArt } from './document.js';
import { rgbaPixels, imageCanvas, sha256 } from './image-io.js';
import { animationFrameFingerprint } from './animation-review.js';
import { nativeLadderReferenceFromCaptures } from './reference-sequences.js';
import { nativeType2LadderPhase, ladderReviewControlMask, validateLadderReview, validateLadderReviewDescriptor, findNativeLadderActor, ladderCaptureFacts } from './native-ladder-review.js';
import { stepNativeFrame } from '../runtime/native-scene-runner.js';
import { XrickLivePreview } from '../juice/xrick-live-preview.js';
import { NativeActionPreviewSceneCatalog, NativeActionPreviewScenarioRunner } from '../juice/native-action-preview.js';
import { PRESENTATION_LAYER_BITS } from '../juice/presentation-layer-mask.js';
import { loadRememberedRdxRom } from '../runtime/rom-store.js';
import { ensurePixelArtNativeRuntime } from './native-runtime.js';

const LIVE_WIDTH = 320, LIVE_HEIGHT = 200;
const FRONT_BITS = PRESENTATION_LAYER_BITS.foreground | PRESENTATION_LAYER_BITS.frontActors | PRESENTATION_LAYER_BITS.hud;

function cloneCanvas(source) {
  const out = document.createElement('canvas'); out.width = source.width; out.height = source.height;
  const ctx = out.getContext('2d', { alpha: true }); ctx.imageSmoothingEnabled = false; ctx.drawImage(source, 0, 0); return out;
}

function frameIndex(doc, frameId) {
  const index = doc.frames.findIndex(frame => frame.id === frameId);
  requireArt(index >= 0, 'TARGET', 'Production preview frame does not exist');
  return index;
}

function findActorByMark(snapshot, mark) {
  return (snapshot?.entities ?? []).find(entity => Number(entity.mark) === Number(mark) && Number(entity.n) > 0 && Number(entity.n) <= 0xfe) ?? null;
}

function compositeDraft({ preview, captured, actorLayer, draftCanvas, drawX, drawY }) {
  requireArt(actorLayer?.backgroundCanvas && actorLayer?.bounds, 'PREVIEW', 'Native actor ownership/background diagnostics are unavailable for this frame');
  const output = cloneCanvas(captured.canvas), ctx = output.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = false;
  /* This is the same per-actor background surface Game Juice uses when it
   * deforms or flashes an actor. It removes exactly the production actor while
   * retaining the real native map frame underneath. */
  ctx.drawImage(actorLayer.backgroundCanvas, 0, 0);
  ctx.drawImage(draftCanvas, Math.round(drawX), Math.round(drawY));

  /* A draft replacement is an actor. Re-apply the real compositor's layers
   * that are in front of actors so a sprite cannot incorrectly paint over a
   * Plane-A wall, front actor, or HUD merely because this is an editor overlay. */
  const mask = preview.presentationLayerMask();
  if (mask?.length === LIVE_WIDTH * LIVE_HEIGHT) {
    const original = captured.canvas.getContext('2d').getImageData(0, 0, LIVE_WIDTH, LIVE_HEIGHT).data;
    const image = ctx.getImageData(0, 0, LIVE_WIDTH, LIVE_HEIGHT);
    for (let at = 0; at < mask.length; at++) if (mask[at] & FRONT_BITS) {
      const p = at * 4; image.data[p] = original[p]; image.data[p + 1] = original[p + 1]; image.data[p + 2] = original[p + 2]; image.data[p + 3] = original[p + 3];
    }
    ctx.putImageData(image, 0, 0);
  }
  return output;
}

/**
 * Pixel Art Editor production-context backend. It deliberately owns no map or
 * gameplay renderer: native xrick/WASM + the same Game Juice live-preview
 * surfaces stage, render, and identify the actor that is replaced.
 */
export class RevivalPixelArtMapPreview {
  constructor({ onStatus = null } = {}) {
    this.catalog = null;
    this.preview = null;
    this.runner = null;
    this.ready = null;
    this.nativeRomHash = null;
    this.onStatus = typeof onStatus === 'function' ? onStatus : null;
    this.runtimeState = Object.freeze({ phase: 'not-loaded', message: 'Native Live-map preview available · runtime not loaded' });
  }

  status() { return this.runtimeState; }

  #setStatus(phase, message) {
    this.runtimeState = Object.freeze({ phase, message });
    this.onStatus?.(this.runtimeState);
  }

  async #initialize() {
    if (this.ready) return this.ready;
    const attempt = (async () => {
      this.#setStatus('starting', 'Starting native preview…');
      const remembered = await loadRememberedRdxRom();
      if (!remembered?.bytes) {
        const error = new Error('Real map preview requires the RDX ROM. Load it once in Workbench, Level Editor, or SoundLab, then retry.');
        error.code = 'RDX_ROM_REQUIRED';
        throw error;
      }
      this.nativeRomHash = `sha256:${await sha256(remembered.bytes)}`;
      await ensurePixelArtNativeRuntime();
      this.catalog = await NativeActionPreviewSceneCatalog.create();
      this.preview = await XrickLivePreview.create(event => this.runner?.noteEvent(event));
      await this.preview.loadRdxRom(remembered.bytes);
      this.preview.setPresentation('rdx', { forceFrame: false });
      this.preview.bridge.setFrontendPaused?.(true);
      this.runner = new NativeActionPreviewScenarioRunner(this.preview);
      this.#setStatus('ready', 'Native preview ready · sound disabled');
      return this;
    })();
    this.ready = attempt;
    try {
      return await attempt;
    } catch (error) {
      this.ready = null;
      this.nativeRomHash = null;
      this.catalog = null;
      this.preview = null;
      this.runner = null;
      if (error?.code === 'RDX_ROM_REQUIRED') this.#setStatus('rom-required', 'RDX ROM required');
      else this.#setStatus('unavailable', `Native preview unavailable: ${error?.message || error}`);
      throw error;
    }
  }

  async #actionCapture(descriptor) {
    const targetBounds = this.catalog.targetBounds(descriptor.actionId, descriptor.submap ?? undefined);
    this.runner.activate({ actionId: descriptor.actionId, direction: descriptor.direction ?? 1, submap: descriptor.submap, targetBounds });
    let captured = this.preview.capture();
    const max = Math.max(1, Number(descriptor.maxFrames ?? this.runner.scenario?.proof?.maxFrames ?? 180));
    for (let i = 0; i < max && !this.runner.eventSeen; i++) {
      this.runner.step(); captured = this.preview.capture();
    }
    requireArt(this.runner.eventSeen, 'PREVIEW', `Real-map scenario did not reach ${descriptor.actionId}`);
    const offset = Math.max(0, Math.min(60, Number(descriptor.postEventFrames ?? 0) | 0));
    for (let i = 0; i < offset; i++) { this.runner.step(); captured = this.preview.capture(); }
    const slot = Number(descriptor.slot ?? this.runner.lastEvent?.targetSlot ?? 0);
    requireArt(Number.isInteger(slot) && slot > 0, 'PREVIEW', 'Production action preview did not identify a native actor slot');
    return { captured, slot, actor: (captured.snapshot?.entities ?? []).find(row => Number(row.slot) === slot) ?? null };
  }

  async #roomCapture(descriptor) {
    this.runner.deactivate();
    this.preview.setPresentation('rdx', { forceFrame: false });
    this.preview.bridge.setFrontendPaused?.(true);
    requireArt(this.preview.selectSubmap(Number(descriptor.submap)), 'PREVIEW', `Unable to select SM${Number(descriptor.submap).toString(16).toUpperCase()}`);
    if (typeof this.preview.bridge.restartCurrentLevelNow === 'function') this.preview.bridge.restartCurrentLevelNow();
    else this.preview.resetLevel();
    let captured = null, actor = null;
    const frames = Math.max(2, Math.min(120, Number(descriptor.warmupFrames ?? 12) | 0));
    for (let i = 0; i < frames; i++) {
      this.preview.bridge.setDebugControl?.(0); this.preview.bridge.debugForceBrowserFrame?.(); captured = this.preview.capture();
      actor = findActorByMark(captured.snapshot, descriptor.mark);
      if (actor && i >= 1) break;
    }
    requireArt(actor, 'PREVIEW', `Native room did not expose source mark ${descriptor.mark}; choose a context where that actor is active`);
    return { captured, slot: Number(actor.slot), actor };
  }

  async #captureLadderNativePhases(descriptor, onPhase) {
    this.runner.deactivate();
    this.preview.setPresentation('rdx', { forceFrame: false });
    this.preview.bridge.setFrontendPaused?.(true);
    requireArt(this.preview.selectSubmap(descriptor.submap), 'PREVIEW', 'Native room selection failed');
    if (typeof this.preview.bridge.restartCurrentLevelNow === 'function') this.preview.bridge.restartCurrentLevelNow();
    else this.preview.resetLevel();
    const captures = new Map(), visited = new Set(), stepLog = [];
    try {
      for (let frame = 0; frame < descriptor.maxFrames && captures.size < 2; frame++) {
        const mask = ladderReviewControlMask(descriptor.controls, frame);
        const step = stepNativeFrame(this.preview.bridge, mask);
        requireArt(step.advanced, 'PREVIEW', `Native replay did not advance at scripted frame ${frame}`);
        const captured = this.preview.capture();
        requireArt(Number(captured.snapshot?.submap) === descriptor.submap, 'PREVIEW',
          `Native replay left SM${descriptor.submap.toString(16)} at scripted frame ${frame}`);
        const actor = findNativeLadderActor(captured.snapshot, descriptor.mark);
        if (!actor) continue;
        requireArt(!(descriptor.mark === 433 && (Number(actor.n) & 0x7f) !== 0x0c), 'PREVIEW',
          'M433 capture resolved a different native actor type');
        const resolved = nativeType2LadderPhase(actor);
        if (!resolved) continue;
        visited.add(resolved.phase);
        if (captures.has(resolved.phase)) continue;
        const layer = this.preview.actorLayer(Number(actor.slot), captured.snapshot);
        requireArt(layer?.backgroundCanvas && layer?.bounds && layer?.canvas, 'PREVIEW', 'Native actor pixels/registration unavailable');
        captures.set(resolved.phase, await onPhase({ captured, actor, resolved, layer, frame, mask }));
        stepLog.push({ frame, mask, phase: resolved.phase, frameSerial: Number(captured.snapshot.frameSerial) });
      }
    } finally {
      this.preview.bridge.setDebugControl?.(0);
    }
    requireArt(captures.size === 2, 'PREVIEW',
      `Native ${descriptor.mark} ladder capture found phases ${[...visited].sort().join(',') || 'none'}; both actual native phases are required (scripted ${descriptor.maxFrames} frames)`);
    const pair = [captures.get(0), captures.get(1)];
    requireArt(pair[0].facts.frameSerial !== pair[1].facts.frameSerial, 'PREVIEW', 'Ladder phases must come from different native frames');
    return { pair, stepLog };
  }

  /** Capture *resolved native actor pixels*, independent of any imported ROM PN.
   * No editable pixels are written: the caller attaches this as an inspect-only
   * reference after the guarded document revision has been rechecked. */
  async captureLadderReference(options = {}) {
    const descriptor = validateLadderReviewDescriptor(options);
    await this.#initialize();
    const { pair } = await this.#captureLadderNativePhases(descriptor, ({ captured, actor, resolved, layer, frame }) => {
      const b = layer.bounds;
      requireArt([b.left, b.top, b.right, b.bottom].every(Number.isInteger), 'PREVIEW',
        'Native sprite bounds must be exact integer production pixels');
      const left = b.left, top = b.top, width = b.right - b.left, height = b.bottom - b.top;
      requireArt(width > 0 && width <= 64 && height > 0 && height <= 64 &&
        left >= 0 && top >= 8 && left + width <= LIVE_WIDTH && top + height <= LIVE_HEIGHT,
      'PREVIEW', 'Native reference actor is partially offscreen; cannot capture production pixels');
      const rgba = layer.canvas.getContext('2d').getImageData(left, top, width, height).data;
      return { phase: resolved.phase, width, height, rgba: Array.from(rgba),
        facts: ladderCaptureFacts(captured.snapshot, actor, resolved, b, frame) };
    });
    return nativeLadderReferenceFromCaptures(pair, descriptor, { ...options, romHash: this.nativeRomHash });
  }

  async #ladderReview(doc, descriptor) {
    validateLadderReview(descriptor, doc);
    const { pair, stepLog } = await this.#captureLadderNativePhases(descriptor, async ({ captured, actor, resolved, layer, frame, mask }) => {
        const frameId = descriptor.frameIds[resolved.phase];
        const original = cloneCanvas(captured.canvas);
        const draft = imageCanvas(doc.width, doc.height, rgbaPixels(doc, frameId));
        const candidate = compositeDraft({ preview: this.preview, captured, actorLayer: layer, draftCanvas: draft,
          drawX: layer.bounds.left, drawY: layer.bounds.top });
        const rawOriginal = original.getContext('2d').getImageData(0, 0, LIVE_WIDTH, LIVE_HEIGHT).data;
        const rawCandidate = candidate.getContext('2d').getImageData(0, 0, LIVE_WIDTH, LIVE_HEIGHT).data;
      return {
          installed: original, candidate,
          facts: { ...ladderCaptureFacts(captured.snapshot, actor, resolved, layer.bounds, frame),
            controlMask: mask, installedHash: `sha256:${await sha256(rawOriginal)}`,
            candidateHash: `sha256:${await sha256(rawCandidate)}`,
            candidateFrameId: frameId, candidateFingerprint: await animationFrameFingerprint(doc, frameId) },
      };
    });
    return {
      canvas: pair[0].candidate,
      panels: [
        { label: 'Phase A · installed native', canvas: pair[0].installed },
        { label: 'Phase A · candidate overlay', canvas: pair[0].candidate },
        { label: 'Phase B · installed native', canvas: pair[1].installed },
        { label: 'Phase B · candidate overlay', canvas: pair[1].candidate },
      ],
      context: { renderer: 'native-xrick-wasm/game-juice-live-preview', action: 'ladder-climb',
        proof: 'two-real-native-phases', productionVerified: false, installed: false,
        submap: descriptor.submap, mark: descriptor.mark, nativeRomHash: this.nativeRomHash, script: { controls: descriptor.controls, maxFrames: descriptor.maxFrames },
        captures: pair.map(row => row.facts), captureTrace: stepLog },
    };
  }

  async render(doc, descriptor) {
    await this.#initialize();
    if (descriptor.kind === 'native-ladder-actor-review-v1') return this.#ladderReview(doc, descriptor);
    this.preview.setPresentation('rdx', { forceFrame: false });
    const staged = descriptor.kind === 'native-action-actor-replacement-v1'
      ? await this.#actionCapture(descriptor)
      : descriptor.kind === 'native-room-actor-replacement-v1'
        ? await this.#roomCapture(descriptor)
        : requireArt(false, 'PREVIEW', `Unsupported production preview kind: ${descriptor.kind}`);
    const actorLayer = this.preview.actorLayer(staged.slot, staged.captured.snapshot);
    requireArt(actorLayer?.bounds, 'PREVIEW', 'Production compositor did not report actor bounds');
    const draft = imageCanvas(doc.width, doc.height, rgbaPixels(doc, descriptor.frameId));
    const drawX = actorLayer.bounds.left + Number(descriptor.offsetX ?? 0), drawY = actorLayer.bounds.top + Number(descriptor.offsetY ?? 0);
    const canvas = compositeDraft({ preview: this.preview, captured: staged.captured, actorLayer, draftCanvas: draft, drawX, drawY });
    return {
      canvas,
      context: {
        renderer: 'native-xrick-wasm/game-juice-live-preview',
        presentation: 'rdx',
        submap: Number(staged.captured.snapshot?.submap),
        frameSerial: Number(staged.captured.snapshot?.frameSerial),
        actor: { slot: staged.slot, mark: staged.actor?.mark ?? null, bounds: { ...actorLayer.bounds } },
        draft: { frameId: descriptor.frameId, draw: [Math.round(drawX), Math.round(drawY)], size: [doc.width, doc.height] },
        actionId: descriptor.actionId ?? null,
        event: this.runner?.lastEvent ? { ...this.runner.lastEvent } : null,
      },
    };
  }
}
