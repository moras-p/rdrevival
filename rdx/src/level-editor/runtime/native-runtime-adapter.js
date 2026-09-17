const RDX_DEBUG_MODE = 1;
const CLASSIC_DEBUG_MODE = 0;
const RDX_COLLISION_POLICY = 3;
const DRAFT_SCHEMA = 'rdr.level_editor.runtime_draft.v1';

function required(bridge, name, message = `Native runtime does not expose ${name}`) {
  const fn = bridge?.[name];
  if (typeof fn !== 'function') throw new Error(message);
  return fn.bind(bridge);
}

function optional(bridge, name, ...args) {
  const fn = bridge?.[name];
  return typeof fn === 'function' ? fn.apply(bridge, args) : undefined;
}

function bool(value) { return !!value; }
function int(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

export class NativeRuntimeAdapter {
  constructor({ bridge = null } = {}) {
    this.bridge = bridge;
    this.initialized = false;
    this.savedOptions = null;
  }

  attach(bridge) { this.bridge = bridge; this.initialized = false; return this; }
  detach() { this.bridge = null; this.initialized = false; this.savedOptions = null; }
  isReady() { return !!this.bridge; }

  requireBridge() {
    if (!this.bridge) throw new Error('Native xrick/Revival runtime is not attached');
    return this.bridge;
  }

  initialize({ romBytes = null, presentation = 'rdx' } = {}) {
    const bridge = this.requireBridge();
    if (romBytes != null) required(bridge, 'loadPresentationRom', 'Native runtime cannot load the RDX presentation ROM')(romBytes);
    optional(bridge, 'setEnabled', true);
    optional(bridge, 'setClassicAssets', String(presentation) === 'classic');
    this.initialized = true;
    return this.snapshot();
  }

  captureOptions() {
    const bridge = this.requireBridge();
    const snapshot = this.snapshot();
    return Object.freeze({
      frontendPaused: typeof bridge.frontendPaused === 'function' ? bool(bridge.frontendPaused()) : false,
      enabled: snapshot?.enabled == null ? null : bool(snapshot.enabled),
      collisionPolicy: typeof bridge.collisionPolicy === 'function' ? int(bridge.collisionPolicy()) : null,
      invincible: bool(snapshot?.debug?.invincible),
      infiniteResources: bool(snapshot?.debug?.infiniteResources),
      soundMuted: typeof bridge.soundMuted === 'function' ? bool(bridge.soundMuted()) : null,
      simulateAllTriggers: typeof bridge.simulateAllTriggers === 'function' ? bool(bridge.simulateAllTriggers()) : null,
      debugControl: typeof bridge.debugControl === 'function' ? int(bridge.debugControl()) : 0,
      classicAssets: snapshot?.classicAssets == null ? null : bool(snapshot.classicAssets)
    });
  }

  beginEditorRuntime({ mode = 'simulate', presentation = 'rdx', invincible = false, infiniteResources = false, soundMuted = false } = {}) {
    const bridge = this.requireBridge();
    if (!this.savedOptions) this.savedOptions = this.captureOptions();
    optional(bridge, 'setEnabled', true);
    optional(bridge, 'setClassicAssets', String(presentation) === 'classic');
    optional(bridge, 'setCollisionPolicy', RDX_COLLISION_POLICY);
    /* Room selection resumes the native loop. Keep trigger forcing off until the
     * requested room and development draft are both installed. */
    optional(bridge, 'setSimulateAllTriggers', false);
    optional(bridge, 'setEditorProjectileHitsNonlethal', false);
    optional(bridge, 'setDebugInvincible', bool(invincible));
    optional(bridge, 'setInfiniteResources', bool(infiniteResources));
    optional(bridge, 'setSoundMuted', bool(soundMuted));
    optional(bridge, 'setDebugControl', 0);
    return true;
  }

  restoreEditorRuntime() {
    const bridge = this.requireBridge();
    const saved = this.savedOptions;
    optional(bridge, 'setDebugControl', 0);
    /* Stop frame ownership while native draft registries/world mutations are
     * removed, then restore the caller's prior frontend state last. */
    optional(bridge, 'setFrontendPaused', true);
    optional(bridge, 'setEditorProjectileHitsNonlethal', false);
    this.clearDevelopmentDraft();
    if (saved) {
      if (saved.enabled != null) optional(bridge, 'setEnabled', saved.enabled);
      if (saved.collisionPolicy != null) optional(bridge, 'setCollisionPolicy', saved.collisionPolicy);
      optional(bridge, 'setDebugInvincible', saved.invincible);
      optional(bridge, 'setInfiniteResources', saved.infiniteResources);
      if (saved.soundMuted != null) optional(bridge, 'setSoundMuted', saved.soundMuted);
      if (saved.simulateAllTriggers != null) optional(bridge, 'setSimulateAllTriggers', saved.simulateAllTriggers);
      if (saved.classicAssets != null) optional(bridge, 'setClassicAssets', saved.classicAssets);
      optional(bridge, 'setFrontendPaused', saved.frontendPaused);
      if (!saved.frontendPaused) optional(bridge, 'resumeBrowserLoop');
    }
    this.savedOptions = null;
    return true;
  }

  openRoom(submap) { return !!this.loadRoom(submap).selected; }

  loadRoom(submap) {
    const bridge = this.requireBridge();
    const beforeGeneration = typeof bridge.nativeWorldGeneration === 'function' ? int(bridge.nativeWorldGeneration()) : null;
    const selected = required(bridge, 'selectSubmap', 'Native runtime does not expose room selection')(int(submap));
    if (!selected) return Object.freeze({ selected: false, beforeGeneration, submap: int(submap) });
    optional(bridge, 'unpause');
    optional(bridge, 'setFrontendPaused', false);
    optional(bridge, 'resumeBrowserLoop');
    optional(bridge, 'forceBrowserFrame');
    return Object.freeze({ selected: true, beforeGeneration, submap: int(submap) });
  }

  roomReady(loadToken = null) {
    const snapshot = this.snapshot();
    const native = snapshot?.collision?.native || {};
    const generation = int(native.worldGeneration, typeof this.bridge?.nativeWorldGeneration === 'function' ? this.bridge.nativeWorldGeneration() : 0);
    const worldReady = bool(native.worldLoaded) && (native.worldReady == null || bool(native.worldReady));
    return worldReady && (!loadToken || loadToken.beforeGeneration == null || generation !== int(loadToken.beforeGeneration));
  }

  reset() {
    const bridge = this.requireBridge();
    required(bridge, 'resetCurrentLevel', 'Native runtime does not expose level reset')();
    optional(bridge, 'unpause');
    optional(bridge, 'forceBrowserFrame');
    return true;
  }

  run() {
    const bridge = this.requireBridge();
    optional(bridge, 'setFrontendPaused', false);
    optional(bridge, 'resumeBrowserLoop');
    return true;
  }

  pause() { optional(this.requireBridge(), 'setFrontendPaused', true); return true; }

  stepFrame() {
    const bridge = this.requireBridge();
    optional(bridge, 'setFrontendPaused', true);
    if (typeof bridge.debugForceBrowserFrame === 'function') bridge.debugForceBrowserFrame();
    else required(bridge, 'forceBrowserFrame', 'Native runtime cannot advance one debug frame')();
    return this.snapshot();
  }

  sendInput(mask) { optional(this.requireBridge(), 'setDebugControl', int(mask) & 0xff); return int(mask) & 0xff; }
  setSimulateAllTriggers(enabled) { optional(this.requireBridge(), 'setSimulateAllTriggers', bool(enabled)); return bool(enabled); }
  setEditorProjectileHitsNonlethal(enabled) { optional(this.requireBridge(), 'setEditorProjectileHitsNonlethal', bool(enabled)); return bool(enabled); }

  snapshot() {
    const bridge = this.requireBridge();
    return required(bridge, 'snapshot', 'Native runtime does not expose state snapshots')();
  }

  playerState(snapshot = null) {
    const sample = snapshot || this.snapshot();
    const native = sample?.collision?.native || {};
    return Object.freeze({
      frameSerial: int(sample?.frameSerial),
      world: Object.freeze([int(native.playerWorldX), int(native.playerWorldY)]),
      screen: Object.freeze([int(native.playerScreenX), int(native.playerScreenY)]),
      grounded: bool(native.grounded), climbing: bool(native.climbing), crawling: bool(native.crawling),
      state: int(sample?.rick?.state), direction: int(sample?.rick?.direction), control: int(sample?.rick?.control)
    });
  }

  actorStates(snapshot = null) { return Object.freeze([...(snapshot || this.snapshot())?.entities || []]); }
  trapProjectilePlatformStates(snapshot = null) { return this.actorStates(snapshot); }

  debugGeometry(mode = 'rdx') {
    const bridge = this.requireBridge();
    const geometry = required(bridge, 'debugGeometry', 'Native runtime does not expose debug geometry')(mode === 'rdx' ? RDX_DEBUG_MODE : CLASSIC_DEBUG_MODE);
    return geometry;
  }

  runtimeDebugGeometry(mode = 'rdx') { return this.debugGeometry(mode); }

  framebuffer({ presentation = 'rdx' } = {}) {
    const bridge = this.requireBridge();
    if (presentation === 'rdx' && typeof bridge.presentationFramebuffer === 'function') {
      const frame = bridge.presentationFramebuffer();
      if (frame) return frame;
    }
    return required(bridge, 'framebuffer', 'Native runtime does not expose framebuffer capture')();
  }

  framebufferRgba({ presentation = 'rdx' } = {}) {
    const bridge = this.requireBridge();
    if (presentation === 'rdx' && typeof bridge.presentationFramebuffer === 'function') {
      const frame = bridge.presentationFramebuffer();
      if (frame instanceof Uint8ClampedArray && frame.length === 320 * 200 * 4) return frame;
    }
    const indexed = required(bridge, 'framebuffer', 'Native runtime does not expose framebuffer capture')();
    if (!(indexed instanceof Uint8Array) || indexed.length !== 320 * 200) return null;
    if (typeof bridge.palette !== 'function') return null;
    const rgba = new Uint8ClampedArray(320 * 200 * 4);
    for (let i = 0; i < indexed.length; i += 1) {
      const color = bridge.palette(indexed[i]);
      const o = i * 4;
      rgba[o] = color[0]; rgba[o + 1] = color[1]; rgba[o + 2] = color[2]; rgba[o + 3] = color[3];
    }
    return rgba;
  }

  setCameraFrow(frow) { return bool(optional(this.requireBridge(), 'setCameraFrow', int(frow))); }
  teleportPlayer({ x, y, crawling = false }) { return bool(optional(this.requireBridge(), 'teleportWorld', int(x), int(y), bool(crawling))); }

  clearDevelopmentDraft() {
    const bridge = this.requireBridge();
    optional(bridge, 'clearMapEditorVisualOverrides');
    optional(bridge, 'clearMapEditorEntities');
    optional(bridge, 'clearMapEditorTransitions');
    optional(bridge, 'restoreNativeWorldOriginal');
    return true;
  }

  applyDevelopmentDraft(draft) {
    if (draft == null) return this.clearDevelopmentDraft();
    if (draft?.schema !== DRAFT_SCHEMA) throw new Error(`Expected ${DRAFT_SCHEMA}, received ${draft?.schema || 'missing schema'}`);
    const bridge = this.requireBridge();
    this.clearDevelopmentDraft();

    for (const cell of draft.worldCells || []) required(bridge, 'setNativeWorldCell')(int(cell.x), int(cell.y), int(cell.mt), int(cell.ml));
    for (const row of draft.sourceSuppressions || []) required(bridge, 'suppressMapEditorMark')(int(row.submap), int(row.mark));
    for (const row of draft.sourceTranslations || []) required(bridge, 'translateMapEditorSource')(int(row.submap), int(row.mark), int(row.dx), int(row.dy));
    for (const row of draft.sourceEntityOverrides || []) required(bridge, 'overrideMapEditorSourceEntity')(int(row.submap), int(row.mark), int(row.entityN));
    for (const row of draft.sourcePatrolOverrides || []) required(bridge, 'overrideMapEditorSourcePatrol')(int(row.submap), int(row.mark), int(row.distancePx), int(row.initialDx), int(row.startupLatencyTicks));
    for (const row of draft.sourceVisualOffsets || []) required(bridge, 'overrideMapEditorSourceVisualOffset')(int(row.submap), int(row.mark), int(row.dx), int(row.dy));
    for (const row of draft.sourcePresentation || []) required(bridge, 'overrideMapEditorSourcePn')(int(row.submap), int(row.mark), int(row.pn));
    for (const row of draft.visualOverrides || []) {
      required(bridge, 'addMapEditorVisualOverride')(
        int(row.mapId), int(row.targetX), int(row.targetY), int(row.sourceX), int(row.sourceY), int(row.targetPlane), int(row.sourcePlane),
        bool(row.clear), int(row.sourceMapId, int(row.mapId)), bool(row.mirrorX));
    }
    for (const row of draft.entities || []) {
      required(bridge, 'addMapEditorEntity')(
        int(row.submap), int(row.entity), int(row.flags), int(row.x), int(row.y), int(row.patrolX, int(row.x)), int(row.patrolY, int(row.y)),
        int(row.triggerX, int(row.x)), int(row.triggerY, int(row.y)), int(row.latency), Math.max(1, int(row.actionPeriod, 1)), bool(row.front),
        int(row.pn, -1), bool(row.mirrorX), bool(row.mirrorY), int(row.presentationFrame, -1));
    }
    for (const row of draft.transitions || []) {
      required(bridge, 'addMapEditorTransition')(int(row.submap), int(row.direction), int(row.contactRow), int(row.targetSubmap), int(row.rowIn), int(row.entryX), int(row.entryY), int(row.entryFrow));
    }
    if (draft.cameraFrow != null) this.setCameraFrow(draft.cameraFrow);
    if (draft.heroStart) this.teleportPlayer(draft.heroStart);
    return true;
  }
}

export { DRAFT_SCHEMA, RDX_COLLISION_POLICY };
