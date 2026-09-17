import { XrickWasmBridge, XRICK_WIDTH, XRICK_HEIGHT, renderClassicFramebuffer } from '../../xrick-bridge.js';
import { PRESENTATION_LAYER_BITS } from './presentation-layer-mask.js';

export const LIVE_WIDTH = XRICK_WIDTH;
export const LIVE_HEIGHT = XRICK_HEIGHT;
export const CONTROL = Object.freeze({ RIGHT: 0x01, LEFT: 0x02, DOWN: 0x04, UP: 0x08, FIRE: 0x10 });
export const NATIVE_SFX_IDS = Object.freeze({ 'walk.wav':0, 'crawl.wav':1, 'jump.wav':2, 'stick.wav':3, 'bullet.wav':4, 'bombshht.wav':5, 'explode.wav':6, 'box.wav':7, 'bonus.wav':8, 'sbonus1.wav':9, 'sbonus2.wav':10, 'pad.wav':11, 'die.wav':12, 'ent0.wav':13, 'ent1.wav':14, 'ent2.wav':15, 'ent3.wav':16, 'ent4.wav':17, 'ent5.wav':18, 'ent6.wav':19, 'ent7.wav':20, 'ent8.wav':21, 'stick_hit.wav':22 });
const RICK = Object.freeze({ STOP: 0x01, SHOOT: 0x02, CLIMB: 0x04, JUMP: 0x08, ZOMBIE: 0x10, DEAD: 0x20, CRAWL: 0x40 });
const COLLISION_CLASSIC_ONLY = 2;
const COLLISION_RDX_DESCRIPTOR = 3; // RDX MT/ML terrain projected through the shared xrick solver
const ACTIVE_ENTITY_MAX = 0xfe;
const EDITOR_REFILL = Object.freeze({ BULLETS:0x01, DYNAMITE:0x02, LIVES:0x04 });
const CLASSIC_FRAMEBUFFER_X = 32;
const CLASSIC_FRAMEBUFFER_Y = 56; // MAPS_FB_Y (64) minus GFXST playfield/status offset (8)

function signed16(value) { return (Number(value) << 16) >> 16; }

export function classicToScreen(x, y) {
  /* ent_t.x is U16 storage for a signed xrick screen coordinate. Preserve the
   * native (S16) interpretation at the room edges instead of treating -3 as
   * 65533 and throwing Live-preview event geometry off-screen. */
  return { x: signed16(x) + CLASSIC_FRAMEBUFFER_X, y: Number(y) - CLASSIC_FRAMEBUFFER_Y };
}

export function heroMovementJuicePoint(snapshot, actionId, presentation = 'classic') {
  const entity = (snapshot?.entities || []).find(item => item.slot === 1 && activeEntity(item));
  if (!entity) return null;
  const origin = classicToScreen(entity.x, entity.y);
  /* Keep Live Edits B on the native revival_juice_observe_gameplay() contract.
   * Native movement dust is attached to Rick's authoritative xrick origin, not
   * to the bottom edge of the current RDX sprite rectangle: turn uses y+20,
   * while step/jump/land use y+18. Fluid-v2 contributes only its sub-row
   * presentation remainder, exactly as revival_juice_trigger_world() does. */
  const yOffset = actionId === 'player.turn' ? 20 : 18;
  const scrollRemainder = presentation === 'rdx'
    ? Number(snapshot?.cameraOffsetPx || 0) - Number(snapshot?.cameraDeltaRows || 0) * 8
    : 0;
  return { x: origin.x + 12, y: origin.y + yOffset - scrollRemainder };
}

function activeEntity(entity) {
  return !!entity && entity.n > 0 && entity.n <= ACTIVE_ENTITY_MAX;
}
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function center(bounds) { return bounds ? { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 } : { x: 160, y: 100 }; }
function distance2(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }
function pointRectDistance2(point, bounds) {
  if (!bounds) return Infinity;
  const dx = point.x < bounds.left ? bounds.left - point.x : point.x > bounds.right ? point.x - bounds.right : 0;
  const dy = point.y < bounds.top ? bounds.top - point.y : point.y > bounds.bottom ? point.y - bounds.bottom : 0;
  return dx * dx + dy * dy;
}
function overlap(a, b) { return !!a && !!b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top; }
export function closestPointOnSegment(point, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y, wx = point.x - a.x, wy = point.y - a.y;
  const len2 = vx * vx + vy * vy;
  const rawT = len2 > 0 ? (wx * vx + wy * vy) / len2 : 0;
  const t = clamp(rawT, 0, 1);
  const closest = { x: a.x + vx * t, y: a.y + vy * t };
  return { ...closest, t, rawT, distance2: distance2(point, closest) };
}

export function wallContactSurface(bounds, side) {
  if (!bounds || (side !== 'left' && side !== 'right')) return null;
  const height = Math.max(1, bounds.bottom - bounds.top);
  const y = bounds.top + Math.min(10, Math.max(4, height * 0.42));
  const x = side === 'left' ? bounds.left - 1 : bounds.right;
  return { x, y, bounds: { left: x - 1, top: y - 4, right: x + 2, bottom: y + 5 } };
}
function entityKind(entity) { return entity ? (Number(entity.n) & 0x7f) : 0; }
function isLivingEnemy(entity) { const n = entityKind(entity); return activeEntity(entity) && n >= 0x04 && n <= 0x0f; }
function isHostileProjectile(entity) {
  const n = entityKind(entity);
  return activeEntity(entity) && (n === 0x39 || ((n === 0x19 || n === 0x1a) && Number(entity.c1) !== 0));
}

export function nativeHeroContactBounds(snapshot) {
  const native = snapshot?.collision?.native;
  if (!native?.playerActive) return null;
  const x = Number(native.playerScreenX), y = Number(native.playerScreenY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  /* rdx_actor_collision_xrick_box(slot=1): x+4..x+18 and y..y+20
   * (y+8..y+20 while crawling). native playerScreenX is x+11+32 and
   * playerScreenY is Rick's y+20 screen anchor, so this is the same native
   * contact rectangle expressed as ordinary half-open browser bounds. */
  return {
    left: x - 7, top: y - (native.playerCrawling ? 12 : 20),
    right: x + 8, bottom: y + 1, slot: 1
  };
}

export function classicHostileProjectileContactBounds(entity) {
  if (!isHostileProjectile(entity)) return null;
  /* Native hostile-projectile fallback collision is a deliberately tiny 5x3
   * core centered at x+12,y+6. Live near-miss classification must compare that
   * gameplay core, not the much wider sprite/cell rectangle. */
  const origin = classicToScreen(entity.x, entity.y);
  const x = origin.x + 12, y = origin.y + 6;
  return { left: x - 2, top: y - 1, right: x + 3, bottom: y + 2, slot: Number(entity.slot) };
}
export function sweptNearMiss(hero, a, b, margin = 10) {
  if (!hero) return null;
  const expanded={left:hero.left-margin,top:hero.top-margin,right:hero.right+margin,bottom:hero.bottom+margin};
  const dx=b.x-a.x, dy=b.y-a.y; let t0=0,t1=1;
  const clip=(p,q)=>{ if(Math.abs(p)<1e-9) return q>=0; const r=q/p; if(p<0){if(r>t1)return false;if(r>t0)t0=r;}else{if(r<t0)return false;if(r<t1)t1=r;} return true; };
  if(!clip(-dx,a.x-expanded.left)||!clip(dx,expanded.right-a.x)||!clip(-dy,a.y-expanded.top)||!clip(dy,expanded.bottom-a.y)) return null;
  if(t0<0||t0>1) return null;
  const cx=(hero.left+hero.right)/2, cy=(hero.top+hero.bottom)/2;
  const denom=dx*dx+dy*dy; const tc=denom>0?clamp(((cx-a.x)*dx+(cy-a.y)*dy)/denom,t0,t1):t0;
  const p={x:a.x+dx*tc,y:a.y+dy*tc};
  const d2=pointRectDistance2(p,hero);
  return {t:tc,entryT:t0,x:p.x,y:p.y,distance2:d2};
}


function nextBrowserFrame() {
  return new Promise(resolve => {
    if (typeof globalThis.requestAnimationFrame === 'function') globalThis.requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

function waitForModule() {
  if (globalThis.Module?.rdxRuntimeReady && typeof globalThis.Module.cwrap === 'function') return Promise.resolve(globalThis.Module);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('xrick WebAssembly runtime did not initialize')), 30000);
    window.addEventListener('xrick-runtime-ready', () => {
      clearTimeout(timeout);
      resolve(globalThis.Module);
    }, { once: true });
  });
}

export class XrickLivePreview {
  static async create(onEvent, onNativeSfx = null) {
    const module = await waitForModule();
    const preview = new XrickLivePreview(new XrickWasmBridge(module), onEvent, onNativeSfx);
    preview.bridge.resumeBrowserLoop();
    /* Exact per-actor ownership/hashes are editor diagnostics. Production
     * gameplay leaves them off; the Juice editor opts in because actor masks
     * are part of its authoring workflow. */
    if (!preview.bridge.setPresentationDiagnostics(true))
      throw new Error('Unable to enable RDX presentation diagnostics for Game Juice editor');
    if (preview.bridge.setRuntimeOption('game_juice_preset', 'off') !== 'off')
      throw new Error('Game Juice editor could not disable the native Game Juice preset');
    preview.bridge.forceBrowserFrame();
    preview.bridge.setSpeedMultiplier(1);
    preview.bridge.setDebugInvincible(true);
    preview.bridge.setInfiniteResources(false);
    preview.setEditorAutoRefill(true);
    preview.setPresentation('classic');
    return preview;
  }

  constructor(bridge, onEvent, onNativeSfx = null) {
    this.bridge = bridge;
    this.onEvent = onEvent;
    this.onNativeSfx = onNativeSfx;
    this.lastNativeSfxSerial = Number(this.bridge.soundSfxEventSerial?.() || 0) >>> 0;
    this.presentation = 'classic';
    this.rdxLoaded = false;
    this.keys = new Set();
    this.controlMask = 0;
    this.previous = null;
    this.lastSerial = -1;
    this.eventSerial = 0;
    this.stepDistance = 0;
    this.lastHeroX = null;
    this.lastHeroY = null;
    this.lastHeroDy = 0;
    this.lastBulletBounds = null;
    this.wallHugFrames = 0;
    this.nearMissActive = new Uint8Array(64);
    this.platformPulse = new Uint8Array(64);
    this.projectileSeen = new Uint8Array(64);
    this.blastHitSeen = new Uint8Array(64);
    this.blastSerial = -1;
    this.blastPointClassic = null;
    this.baseCanvas = document.createElement('canvas');
    this.baseCanvas.width = LIVE_WIDTH; this.baseCanvas.height = LIVE_HEIGHT;
    this.baseContext = this.baseCanvas.getContext('2d', { alpha: false, desynchronized: true });
    this.baseContext.imageSmoothingEnabled = false;
    this.rdxImage = this.baseContext.createImageData(LIVE_WIDTH, LIVE_HEIGHT);
    this.actorLayers = new Map();
    this.motionTrailHistory = new Map();
    this.motionTrailPositions = new Map();
    this.effectMaskCache = { frameSerial: -1, presentation: '', mask: null };
    this.editorAutoRefill = true;
    this.editorRefillSuppressMask = 0;
    this.editorDeathLoop = !!this.bridge.agentDebugBuildEnabled?.();
    this.editorDeathOrigin = null;
  }

  setPresentation(mode, { forceFrame = true } = {}) {
    const next = mode === 'rdx' ? 'rdx' : 'classic';
    if (next === 'rdx' && !this.rdxLoaded) throw new Error('Load the RDX 1.3x ROM before selecting RDX presentation.');
    /* Game Juice editor A/B owns the authored feedback layer. Keep the native
     * production preset off in the captured framebuffer or the B runtime would
     * stack a second particle/flash pass over already-juiced gameplay. Re-arm
     * this after presentation/ROM changes because native option state can reset. */
    if (this.bridge.setRuntimeOption('game_juice_preset', 'off') !== 'off')
      throw new Error('Game Juice editor could not disable the native Game Juice preset');
    this.presentation = next;
    if (next === 'rdx') {
      /* Defensive re-arm: loading/unloading RDX content clears diagnostics in C. */
      if (!this.bridge.setPresentationDiagnostics(true))
        throw new Error('RDX actor diagnostics are unavailable; rebuild the presentation runtime');
      this.bridge.setEnabled(true);
      /* RDX presentation owns RDX collision too. The native solver uses the
       * compiled MT/ML room tables and falls back explicitly only when a room
       * is not native-ready; Classic presentation keeps xrick collision. */
      this.bridge.setCollisionPolicy(COLLISION_RDX_DESCRIPTOR);
      this.bridge.setClassicAssets(false);
      this.bridge.setSpriteMode(1);
      /* The authoring preview must inspect the same shared Revival explosion
       * family used by production. Forcing Classic here made dynamite, ammo,
       * Egypt fireballs and scripted explosion paths look stale even when the
       * RDX presentation itself was selected. */
      this.bridge.setDynamiteSource('revival');
    } else {
      this.bridge.setEnabled(false);
      this.bridge.setCollisionPolicy(COLLISION_CLASSIC_ONLY);
    }
    if (forceFrame) this.bridge.forceBrowserFrame();
    this.previous = null;
    this.blastSerial = -1; this.blastPointClassic = null; this.blastHitSeen.fill(0);
    this.actorLayers.clear();
    this.motionTrailHistory.clear(); this.motionTrailPositions.clear();
    this.effectMaskCache = { frameSerial: -1, presentation: '', mask: null };
  }

  async loadRdxRom(fileOrBytes) {
    const bytes = fileOrBytes instanceof Uint8Array ? fileOrBytes : new Uint8Array(await fileOrBytes.arrayBuffer());
    const requestedPresentation = this.presentation;
    this.bridge.loadPresentationRom(bytes);
    this.rdxLoaded = true;
    /* ROM load resets the presentation state structure, including diagnostic
     * ownership masks. Game Juice requires those per-actor layers in both
     * Classic and RDX, so restore diagnostics after every content load. */
    if (!this.bridge.setPresentationDiagnostics(true))
      throw new Error('RDX ROM loaded, but Game Juice actor diagnostics could not be restored');
    /* Loading content selects the DX experience inside C. Do not advance even
     * one browser frame in that transient state: the current Classic cold-start
     * pose may already intersect RDX descriptor-solid terrain. Restore the
     * editor's requested presentation/collision contract first; setPresentation
     * performs the first safe frame only after the contract is restored. */
    this.setPresentation(requestedPresentation);
    return bytes.length;
  }

  /* v2.1.48 native Amiga audio. Source 0 is the reconstructed CD32/Paula
   * runtime; LOW quality explicitly selects the XRICK fast fallback. */
  setAudioQuality(quality) { this.bridge.setSoundSource(0); return this.bridge.setSoundQuality(Number(quality) >>> 0); }
  setAudioFilter(mode) { return this.bridge.setSoundFilter(Number(mode) >>> 0); }
  setAudioSpatial(mode) { return this.bridge.setSoundSpatial(Number(mode) >>> 0); }
  clearNativeSfxSuppressions() { this.bridge.clearSoundSfxSuppressions(); }
  setNativeSfxSuppressed(sampleName, suppressed = true) {
    const logicalId = NATIVE_SFX_IDS[String(sampleName || '')];
    if (!Number.isInteger(logicalId)) return false;
    return this.bridge.setSoundSfxSuppressed(logicalId, !!suppressed);
  }
  setHighQualityAmigaAudio() {
    this.bridge.setSoundMuted(false);
    this.bridge.setSoundSource(0);
    this.bridge.setSoundQuality(2);      // HIGH / native Amiga MAX
    this.bridge.setSoundFilter(1);       // A500
    this.bridge.setSoundSpatial(2);      // headphones
  }

  setInvincible(enabled) { this.bridge.setDebugInvincible(enabled); }
  setInfiniteResources(enabled) { this.bridge.setInfiniteResources(enabled); }
  setEditorAutoRefill(enabled) {
    this.editorAutoRefill = !!enabled;
    /* Ammo/dynamite must still deplete so HUD/action feedback can be inspected.
     * Lives use the engine's cyclic infinite-life mode so the completed death
     * state always restarts instead of reaching GAME OVER. */
    this.bridge.setInfiniteResources(false);
    if (this.bridge.agentDebugBuildEnabled?.()) this.bridge.setInfiniteLives?.(this.editorAutoRefill);
    else this.bridge.setInfiniteLives?.(false);
    return this.editorAutoRefill;
  }
  editorAutoRefillEnabled() { return !!this.editorAutoRefill; }
  setEditorAutoRevive(enabled) {
    this.editorDeathLoop = !!enabled && !!this.bridge.agentDebugBuildEnabled?.();
    if (!this.editorDeathLoop) { this.editorDeathOrigin = null; this.bridge.clearDeathRestartPose?.(); }
    return this.editorDeathLoop;
  }
  editorAutoReviveEnabled() { return !!this.editorDeathLoop; }

  setCoyoteFrames(frames) { return this.bridge.setCoyoteFrames(frames); }
  coyoteFrames() { return this.bridge.coyoteFrames(); }
  setJumpBufferFrames(frames) { return this.bridge.setJumpBufferFrames(frames); }
  jumpBufferFrames() { return this.bridge.jumpBufferFrames(); }
  setJumpTakeoff(value) { return this.bridge.setJumpTakeoff(value); }
  jumpTakeoff() { return this.bridge.jumpTakeoff(); }
  setGravity(value) { return this.bridge.setGravity(value); }
  gravity() { return this.bridge.gravity(); }
  setApexGravityPercent(value) { return this.bridge.setApexGravityPercent(value); }
  apexGravityPercent() { return this.bridge.apexGravityPercent(); }
  setJumpReleasePercent(value) { return this.bridge.setJumpReleasePercent(value); }
  jumpReleasePercent() { return this.bridge.jumpReleasePercent(); }
  setMaxFall(value) { return this.bridge.setMaxFall(value); }
  maxFall() { return this.bridge.maxFall(); }
  /* Legacy Scorpion-only collision corrections are intentionally disabled in
   * the production live preview. Keep these methods as import/API shims so an
   * old preset cannot silently re-enable a second collision behavior. */
  setCeilingCorrection(_value) { this.bridge.setCeilingCorrection?.(0); return 0; }
  ceilingCorrection() { return 0; }
  setGroundSnap(_value) { this.bridge.setGroundSnap?.(0); return 0; }
  groundSnap() { return 0; }
  setWalkSpeed(value) { return this.bridge.setWalkSpeed(value); }
  walkSpeed() { return this.bridge.walkSpeed(); }
  setLadderTopEntryTolerance(pixels) {
    return Number(this.bridge.setRuntimeOption('ladder_top_entry_tolerance', Number(pixels)));
  }
  ladderTopEntryTolerance() {
    return Number(this.bridge.runtimeOption('ladder_top_entry_tolerance'));
  }
  setFallBounceMinHeight(pixels) { return this.bridge.setFallBounceMinHeight(pixels); }
  fallBounceMinHeight() { return this.bridge.fallBounceMinHeight(); }
  setPlatformCurveMode(mode) { return this.bridge.setPlatformCurveMode(mode); }
  platformCurveMode() { return this.bridge.platformCurveMode(); }
  setPlatformCurveCustom(curve) { return this.bridge.setPlatformCurveCustom(curve); }
  platformCurveCustom() { return this.bridge.platformCurveCustom(); }
  setExplosionNearBounceLift(liftFp) { return this.bridge.setExplosionNearBounceLift(liftFp); }
  explosionNearBounceLift() { return this.bridge.explosionNearBounceLift(); }
  collisionMode() { return this.presentation === 'rdx' ? 'RDX descriptors + xrick' : 'Classic xrick'; }
  #clearRoomTracking() {
    this.previous = null; this.lastSerial = -1; this.stepDistance = 0; this.wallHugFrames = 0;
    this.nearMissActive.fill(0); this.platformPulse.fill(0); this.blastSerial = -1; this.blastPointClassic = null; this.blastHitSeen.fill(0);
    this.actorLayers.clear(); this.motionTrailHistory.clear(); this.motionTrailPositions.clear();
    this.editorDeathOrigin = null; this.bridge.clearDeathRestartPose?.(); this.editorRefillSuppressMask = 0;
  }
  captureTrackingState() {
    const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
    return {
      previous:clone(this.previous), lastSerial:this.lastSerial, eventSerial:this.eventSerial, stepDistance:this.stepDistance,
      lastHeroX:this.lastHeroX, lastHeroY:this.lastHeroY, lastHeroDy:this.lastHeroDy, lastBulletBounds:clone(this.lastBulletBounds),
      wallHugFrames:this.wallHugFrames, nearMissActive:Array.from(this.nearMissActive), platformPulse:Array.from(this.platformPulse),
      projectileSeen:Array.from(this.projectileSeen), blastHitSeen:Array.from(this.blastHitSeen), blastSerial:this.blastSerial,
      blastPointClassic:clone(this.blastPointClassic), lastNativeSfxSerial:this.lastNativeSfxSerial,
      editorRefillSuppressMask:this.editorRefillSuppressMask, editorDeathOrigin:clone(this.editorDeathOrigin)
    };
  }
  restoreTrackingState(state) {
    if (!state || typeof state !== 'object') throw new Error('Game Juice live-preview tracking checkpoint is invalid');
    const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
    this.previous=clone(state.previous); this.lastSerial=Number(state.lastSerial ?? -1); this.eventSerial=Number(state.eventSerial ?? 0);
    this.stepDistance=Number(state.stepDistance ?? 0); this.lastHeroX=state.lastHeroX ?? null; this.lastHeroY=state.lastHeroY ?? null; this.lastHeroDy=Number(state.lastHeroDy ?? 0);
    this.lastBulletBounds=clone(state.lastBulletBounds); this.wallHugFrames=Number(state.wallHugFrames ?? 0);
    for (const [target, source] of [[this.nearMissActive,state.nearMissActive],[this.platformPulse,state.platformPulse],[this.projectileSeen,state.projectileSeen],[this.blastHitSeen,state.blastHitSeen]]) {
      target.fill(0); if(Array.isArray(source))target.set(source.slice(0,target.length));
    }
    this.blastSerial=Number(state.blastSerial ?? -1); this.blastPointClassic=clone(state.blastPointClassic);
    this.lastNativeSfxSerial=Number(state.lastNativeSfxSerial ?? this.lastNativeSfxSerial) >>> 0;
    this.editorRefillSuppressMask=Number(state.editorRefillSuppressMask ?? 0) >>> 0; this.editorDeathOrigin=clone(state.editorDeathOrigin);
    /* Actor and effect-mask caches contain compositor-owned surfaces from the
     * previous native timeline. Rebuild them after restore rather than pairing
     * stale pixels with the restored serial. */
    this.actorLayers.clear(); this.motionTrailHistory.clear(); this.motionTrailPositions.clear();
    this.effectMaskCache={ frameSerial:-1, presentation:'', mask:null };
    return true;
  }
  selectSubmap(submap) {
    const ok = this.bridge.selectSubmap(Number(submap) >>> 0);
    if (ok) {
      this.bridge.setCollisionPolicy(this.presentation === 'rdx' ? COLLISION_RDX_DESCRIPTOR : COLLISION_CLASSIC_ONLY);
      this.bridge.setDebugControl(0); this.#clearRoomTracking(); this.bridge.forceBrowserFrame();
    }
    return ok;
  }
  #isRdxEntryReady(snapshot) {
    if (this.presentation !== 'rdx') return true;
    const native = snapshot?.collision?.native;
    if (!native?.worldReady || !native?.playerActive) return false;
    const anchor = this.bridge.scorpionEntryAnchor?.(Number(native.mapId) >>> 0, Number(snapshot?.submap) >>> 0);
    if (!anchor) return true;
    /* The authored restart anchor is Rick's placement point. The first normal
     * grounded action may settle Y by one pixel, but X must match exactly.
     * SM00's broken autoload pose is x=51 while the MD0003 restart anchor is
     * x=56, so accepting merely an active player would preserve the wall trap. */
    return Number(native.playerWorldX) === Number(anchor.x) &&
      Math.abs(Number(native.playerWorldY) - Number(anchor.y)) <= 2;
  }
  async resetLevelForPlaytest(maxBrowserFrames = 24) {
    /* Autoload runs before the editor starts its own RAF redraw loop. First
     * prove that Emscripten's scheduled game loop has executed a real native
     * frame. A reset requested before that startup frame can be overwritten by
     * the ordinary -ingame INIT/INIT_MAP path; this was the remaining reason
     * autoload showed SM00 at x=51 while pressing Reset later produced x=56. */
    this.clearKeys();
    this.bridge.resumeBrowserLoop?.();
    const budget = Math.max(4, Number(maxBrowserFrames) || 4);
    let snapshot = this.bridge.snapshot();
    let serial = Number(snapshot?.frameSerial ?? -1);
    let schedulerReady = false;
    for (let frame = 0; frame < budget; frame += 1) {
      await nextBrowserFrame();
      snapshot = this.bridge.snapshot();
      const nextSerial = Number(snapshot?.frameSerial ?? -1);
      if (nextSerial !== serial) { schedulerReady = true; serial = nextSerial; break; }
    }
    if (!schedulerReady) throw new Error('RDX autoload could not observe the scheduled xrick browser loop before Reset');

    /* Now use the exact reset request owned by the visible Reset button. Do
     * not call game_web_force_frame() and do not route editor startup through
     * a debug/AI restart. Require the ROM-derived entry anchor on two
     * consecutive native frames so a transient reset state cannot be accepted
     * before a later startup transition overwrites it. */
    this.resetLevel();
    let readyFrames = 0;
    for (let frame = 0; frame < budget; frame += 1) {
      await nextBrowserFrame();
      snapshot = this.bridge.snapshot();
      const nextSerial = Number(snapshot?.frameSerial ?? -1);
      if (nextSerial === serial) continue;
      serial = nextSerial;
      if (this.#isRdxEntryReady(snapshot)) {
        readyFrames += 1;
        if (readyFrames >= 2) return snapshot;
      } else readyFrames = 0;
    }
    const native = snapshot?.collision?.native || {};
    const anchor = this.bridge.scorpionEntryAnchor?.(Number(native.mapId) >>> 0, Number(snapshot?.submap) >>> 0);
    const expected = anchor ? ` expected (${anchor.x},${anchor.y})` : '';
    throw new Error(`RDX reset did not stabilize at a playable entry anchor after ROM load:${expected} got (${native.playerWorldX ?? '?'},${native.playerWorldY ?? '?'})`);
  }
  resetLevel() { this.bridge.resetCurrentLevel(); this.bridge.setCollisionPolicy(this.presentation === 'rdx' ? COLLISION_RDX_DESCRIPTOR : COLLISION_CLASSIC_ONLY); this.#clearRoomTracking(); this.setEditorAutoRefill(this.editorAutoRefill); }

  keyDown(code) { this.keys.add(code); this.#syncControl(); }
  keyUp(code) { this.keys.delete(code); this.#syncControl(); }
  clearKeys() { this.keys.clear(); this.controlMask = 0; this.bridge.setDebugControl(0); }

  #syncControl() {
    let mask = 0;
    if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) mask |= CONTROL.LEFT;
    if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) mask |= CONTROL.RIGHT;
    if (this.keys.has('ArrowUp') || this.keys.has('KeyZ')) mask |= CONTROL.UP;
    if (this.keys.has('ArrowDown') || this.keys.has('KeyS')) mask |= CONTROL.DOWN;
    if (this.keys.has('Space')) mask |= CONTROL.FIRE;
    /* Editor conveniences produce the exact production xrick chords. */
    if (this.keys.has('KeyX')) mask = CONTROL.FIRE | CONTROL.UP;      // gun
    if (this.keys.has('KeyC')) mask = CONTROL.FIRE | CONTROL.DOWN;   // dynamite
    if (mask !== this.controlMask) {
      this.controlMask = mask;
      this.bridge.setDebugControl(mask);
    }
  }

  #deathPose(snapshot) {
    const hero = (snapshot?.entities || []).find(entity => Number(entity.slot) === 1);
    const native = snapshot?.collision?.native || {};
    return {
      submap:Number(snapshot?.submap ?? -1), mapFrow:Number(snapshot?.mapFrow ?? 0),
      entityX:Number(hero?.x ?? 0), entityY:Number(hero?.y ?? 0),
      worldX:Number(native.playerWorldX ?? 0), worldY:Number(native.playerWorldY ?? 0),
      nativeValid:!!native.playerActive && !!native.playerSpawnValid,
      crawling:!!native.playerCrawling
    };
  }

  #applyEditorDeathLoop(snapshot, before) {
    if (!this.editorDeathLoop || !this.bridge.agentDebugBuildEnabled?.() || !before) return false;
    const state = Number(snapshot.rick?.state || 0);
    const wasDying = !!(Number(before.rick?.state || 0) & (RICK.ZOMBIE | RICK.DEAD));
    const isDying = !!(state & (RICK.ZOMBIE | RICK.DEAD));
    if (!wasDying && isDying) {
      /* Capture and ARM the last living pose before the death sequence. The
       * production restart boundary now owns restoration, which avoids the old
       * browser teleport/camera resync race. Nothing here interrupts the
       * complete zombie/fall/dead animation. */
      this.editorDeathOrigin = this.#deathPose(before);
      this.bridge.clearDeathRestartPose?.();
    }
    /* Game Juice owns an explicit editor restart once the complete zombie /
     * sprite-fall animation has reached STDEAD. Do not wait for the normal
     * production transition/restart, because that can change camera/room
     * state before the editor has restored the saved inspection pose. */
    if (!(state & RICK.DEAD) || !this.editorDeathOrigin) return false;
    if (this.bridge.deathTransitionHold?.()) this.bridge.setDeathTransitionHold(false);
    const origin = this.editorDeathOrigin;
    this.editorDeathOrigin = null;
    if (Number(snapshot.submap) !== origin.submap) return false;

    /* resetCurrentLevel() queues the same production reset used by the toolbar's
     * Reset level button. Execute one production frame so that queued reset is
     * actually consumed BEFORE applying camera and Rick position. v2.1.82
     * teleported too early, then the queued reset overwrote the teleport. */
    this.bridge.clearDeathRestartPose?.();
    this.bridge.resetCurrentLevel();
    this.bridge.forceBrowserFrame?.();
    this.bridge.setCollisionPolicy(this.presentation === 'rdx' ? COLLISION_RDX_DESCRIPTOR : COLLISION_CLASSIC_ONLY);
    if (!this.bridge.setCameraFrow?.(origin.mapFrow))
      console.warn('Game Juice auto-revive could not restore camera row', origin);
    const restored = origin.nativeValid
      ? !!this.bridge.teleportWorld?.(origin.worldX, origin.worldY, origin.crawling)
      : !!this.bridge.teleportClassic?.(origin.entityX, origin.entityY);
    /* Never call setCameraFrow after teleport: that API intentionally forces a
     * camera/Rick resync and would overwrite the just-restored Hero pose. */
    this.bridge.forceBrowserFrame?.();
    this.previous = null; this.lastSerial = -1; this.wallHugFrames = 0;
    this.nearMissActive.fill(0); this.platformPulse.fill(0); this.blastSerial = -1; this.blastPointClassic = null; this.blastHitSeen.fill(0);
    this.actorLayers.clear(); this.motionTrailHistory.clear(); this.motionTrailPositions.clear();
    if (!restored) console.warn('Game Juice auto-revive failed to restore pre-death pose', { origin });
    return true;
  }

  #autoRefillAfterSnapshot(snapshot) {
    if (!this.editorAutoRefill || !this.bridge.supportsEditorResourceLoop?.()) return;
    let mask = 0;
    if (Number(snapshot?.inventory?.bullets || 0) <= 0) mask |= EDITOR_REFILL.BULLETS;
    if (Number(snapshot?.inventory?.dynamite || 0) <= 0) mask |= EDITOR_REFILL.DYNAMITE;
    /* Infinite-lives mode cycles at the native DEAD -> restart boundary. This
     * final guard also repairs an externally imported zero-life state. */
    if (this.bridge.agentDebugBuildEnabled?.() && Number(snapshot?.inventory?.lives || 0) <= 0)
      mask |= EDITOR_REFILL.LIVES;
    if (!mask) return;
    const applied = this.bridge.refillResources(mask);
    this.editorRefillSuppressMask |= applied;
  }

  capture() {
    /* RDX actor diagnostics are produced by the production compositor itself.
     * Compose the selected RDX frame BEFORE reading snapshot.presentation;
     * v2.1.79 read the audit first, pairing a new gameplay serial with stale
     * actor coordinates and starving Motion Trail of real movement. */
    let rdxPixels = null;
    if (this.presentation === 'rdx' && this.rdxLoaded) rdxPixels = this.bridge.presentationFramebuffer();
    let snapshot = this.bridge.snapshot();
    if (this.#applyEditorDeathLoop(snapshot, this.previous)) {
      if (this.presentation === 'rdx' && this.rdxLoaded) rdxPixels = this.bridge.presentationFramebuffer();
      snapshot = this.bridge.snapshot();
    }
    /* Audio replacement follows the exact native logical SFX request stream.
     * The C ring records events before suppression, so a selected authored
     * replacement still receives the event that it intentionally silenced. */
    for (const event of this.bridge.soundSfxEventsSince?.(this.lastNativeSfxSerial, 32) || []) {
      this.lastNativeSfxSerial = Number(event.serial) >>> 0;
      this.onNativeSfx?.({ ...event, frameSerial:snapshot.frameSerial });
    }
    if (snapshot.frameSerial !== this.lastSerial) {
      /* Keep a few already-extracted actor layers so a B-side freeze frame can
       * continue to deform/flash the exact impact-frame sprite while xrick and
       * the A baseline advance. Old layers are bounded aggressively. */
      const minSerial = Number(snapshot.frameSerial) - 6;
      for (const key of this.actorLayers.keys()) {
        const serial = Number(String(key).split(':', 1)[0]);
        if (Number.isFinite(serial) && serial < minSerial) this.actorLayers.delete(key);
      }
      this.#deriveEvents(snapshot, this.previous);
      this.previous = snapshot;
      this.lastSerial = snapshot.frameSerial;
    }
    this.#autoRefillAfterSnapshot(snapshot);
    if (rdxPixels) {
      this.rdxImage.data.set(rdxPixels);
      this.baseContext.putImageData(this.rdxImage, 0, 0);
    } else {
      renderClassicFramebuffer(this.bridge, this.baseContext, { transparentZero: false });
    }
    if (snapshot.frameSerial === this.lastSerial) this.#captureMotionTrails(snapshot);
    return { canvas: this.baseCanvas, snapshot, presentation: this.presentation };
  }

  #captureMotionTrails(snapshot) {
    /* Store presentation-space positions, not historical full-frame actor
     * bitmaps.  At render time the current selected-compositor actor layer is
     * echoed back to these prior positions.  This makes the effect work on
     * the first movement frame and avoids depending on stale RDX ownership
     * surfaces from an earlier composition. */
    const activeSlots = new Set();
    const movers = [];
    for (const entity of snapshot?.entities || []) {
      if (!activeEntity(entity)) continue;
      const bounds = this.entityBounds(snapshot, entity.slot, this.presentation);
      if (!bounds || bounds.right <= 0 || bounds.left >= LIVE_WIDTH || bounds.bottom <= 0 || bounds.top >= LIVE_HEIGHT) continue;
      activeSlots.add(entity.slot);
      const c = center(bounds);
      const before = this.motionTrailPositions.get(entity.slot);
      const current = { x:c.x, y:c.y, frameSerial:Number(snapshot.frameSerial) };
      this.motionTrailPositions.set(entity.slot, current);
      if (!before || before.frameSerial === current.frameSerial) continue;
      const speed = Math.hypot(c.x - before.x, c.y - before.y);
      if (speed < 0.5) continue;
      movers.push({ entity, before, current, speed });
    }

    movers.sort((a,b)=>b.speed-a.speed);
    for (const {entity,before,current,speed} of movers.slice(0,8)) {
      const history = this.motionTrailHistory.get(entity.slot) || [];
      if (!history.length || history.at(-1).frameSerial !== before.frameSerial) history.push({ ...before, speed });
      history.push({ ...current, speed });
      while (history.length > 10) history.shift();
      this.motionTrailHistory.set(entity.slot, history);
    }
    for (const slot of [...this.motionTrailHistory.keys()]) if (!activeSlots.has(slot)) this.motionTrailHistory.delete(slot);
    for (const slot of [...this.motionTrailPositions.keys()]) if (!activeSlots.has(slot)) this.motionTrailPositions.delete(slot);
  }

  motionTrailLayers(copies = 3, maxLayers = 24) {
    const perActor = Math.max(0, Math.min(8, Number(copies) || 0));
    const cap = Math.max(0, Math.min(64, Number(maxLayers) || 0));
    const out = [];
    for (const [slot, history] of this.motionTrailHistory.entries()) {
      const current = this.motionTrailPositions.get(slot);
      if (!current || history.length < 2) continue;
      const layer = this.actorLayer(slot, this.previous);
      if (!layer) continue;
      const older = history.slice(Math.max(0, history.length - perActor - 1), -1);
      for (let i=0;i<older.length;i+=1) {
        const point=older[i];
        out.push({ layer, slot, frameSerial:point.frameSerial, speed:point.speed || 0, age:older.length-i, dx:point.x-current.x, dy:point.y-current.y });
      }
    }
    out.sort((a,b)=>(b.frameSerial-a.frameSerial)||(b.speed-a.speed)||(a.age-b.age));
    return cap ? out.slice(0,cap) : [];
  }

  setAnalysisFps(fps = 0) { return this.bridge.setTargetFpsOverride(Number(fps) >>> 0); }
  analysisFps() { return this.bridge.targetFpsOverride(); }

  entityBounds(snapshot, slot, mode = this.presentation) {
    if (!snapshot) return null;
    if (mode === 'rdx') {
      const candidates = (snapshot.presentation || []).filter(item => item.slot === slot && item.visiblePixels > 0 && item.width && item.height);
      if (candidates.length) {
        const item = candidates.sort((a, b) => b.visiblePixels - a.visiblePixels)[0];
        return { left: item.drawX, top: item.drawY, right: item.drawX + item.width, bottom: item.drawY + item.height, slot };
      }
    }
    const entity = (snapshot.entities || []).find(item => item.slot === slot && activeEntity(item));
    if (!entity) return null;
    const origin = classicToScreen(entity.x, entity.y);
    const scrollRemainder = mode === 'rdx' ? (Number(snapshot.cameraOffsetPx || 0) - Number(snapshot.cameraDeltaRows || 0) * 8) : 0;
    origin.y -= scrollRemainder;
    const width = Math.max(8, Number(entity.w) || (slot === 2 || slot === 3 ? 32 : 16));
    const height = Math.max(8, Number(entity.h) || (slot === 2 || slot === 3 ? 21 : 16));
    return { left: origin.x, top: origin.y, right: origin.x + width, bottom: origin.y + height, slot };
  }

  actorBounds(snapshot, slot) {
    if (this.presentation === 'rdx') {
      const mapped = this.entityBounds(snapshot, slot, 'rdx');
      const candidates = (snapshot?.presentation || []).filter(item => item.slot === slot && item.visiblePixels > 0 && item.width && item.height);
      if (candidates.length) return mapped;
    }
    const entity = (snapshot?.entities || []).find(item => item.slot === slot && activeEntity(item));
    if (!entity) return null;
    const origin = classicToScreen(entity.x, entity.y);
    if (this.presentation === 'rdx') origin.y -= Number(snapshot.cameraOffsetPx || 0) - Number(snapshot.cameraDeltaRows || 0) * 8;
    return { left: origin.x, top: origin.y, right: origin.x + 32, bottom: origin.y + 21, slot };
  }

  actorLayer(slot, snapshot = this.previous) {
    if (!snapshot) return null;
    const key = `${snapshot.frameSerial}:${this.presentation}:${slot}`;
    const cached = this.actorLayers.get(key);
    if (cached) return cached;
    const pixels = this.bridge.entityRgba(slot);
    const backgroundPixels = this.bridge.entityBackgroundRgba(slot);
    const canvas = document.createElement('canvas');
    const backgroundCanvas = document.createElement('canvas');
    canvas.width = backgroundCanvas.width = LIVE_WIDTH;
    canvas.height = backgroundCanvas.height = LIVE_HEIGHT;
    const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
    const bgctx = backgroundCanvas.getContext('2d', { alpha: true, desynchronized: true });
    ctx.imageSmoothingEnabled = bgctx.imageSmoothingEnabled = false;
    const image = ctx.createImageData(LIVE_WIDTH, LIVE_HEIGHT);
    const backgroundImage = bgctx.createImageData(LIVE_WIDTH, LIVE_HEIGHT);
    image.data.set(pixels); backgroundImage.data.set(backgroundPixels);
    ctx.putImageData(image, 0, 0); bgctx.putImageData(backgroundImage, 0, 0);
    const tintCache = new Map();
    const layer = {
      canvas, backgroundCanvas, bounds: this.actorBounds(snapshot, slot), slot, frameSerial: snapshot.frameSerial,
      tintCanvas(color) {
        const palette = { red: '#ff3030', white: '#ffffff', 'off-white': '#f2eddc', 'faint-white': '#d6d4cc', gray: '#929292' };
        const key = Object.prototype.hasOwnProperty.call(palette, color) ? color : 'white';
        if (tintCache.has(key)) return tintCache.get(key);
        const tinted = document.createElement('canvas');
        tinted.width = LIVE_WIDTH; tinted.height = LIVE_HEIGHT;
        const tctx = tinted.getContext('2d', { alpha: true, desynchronized: true });
        tctx.imageSmoothingEnabled = false;
        tctx.drawImage(canvas, 0, 0);
        tctx.globalCompositeOperation = 'source-in';
        tctx.fillStyle = palette[key];
        tctx.fillRect(0, 0, LIVE_WIDTH, LIVE_HEIGHT);
        tctx.globalCompositeOperation = 'source-over';
        tintCache.set(key, tinted);
        return tinted;
      }
    };
    this.actorLayers.set(key, layer);
    return layer;
  }

  presentationLayerMask() {
    if (this.presentation === 'rdx' && this.rdxLoaded && typeof this.bridge.presentationLayerMask === 'function') return this.bridge.presentationLayerMask();
    const foreground=this.foregroundMask();
    const layers=new Uint8Array(LIVE_WIDTH*LIVE_HEIGHT);
    layers.fill(PRESENTATION_LAYER_BITS.actors,8*LIVE_WIDTH);
    for(let i=8*LIVE_WIDTH;i<foreground.length;i++)if(foreground[i])layers[i]=PRESENTATION_LAYER_BITS.foreground;
    layers.fill(PRESENTATION_LAYER_BITS.hud,0,8*LIVE_WIDTH);
    return layers;
  }

  foregroundMask() {
    /* Game Juice must not lose an effect merely because the user changes the
     * presentation selector. RDX has a true Plane-A mask from the native
     * compositor. Classic xrick has no equivalent split surface, so build a
     * conservative visual-surface mask from the currently selected Classic
     * framebuffer (non-black visible pixels). This keeps foreground flashes
     * and debris authorable in both presentations without pretending Classic
     * suddenly acquired RDX plane semantics. */
    if (this.presentation === 'rdx' && this.rdxLoaded) return this.bridge.foregroundMask();
    const serial = Number(this.previous?.frameSerial ?? -1);
    const cached = this.effectMaskCache;
    if (cached?.frameSerial === serial && cached.presentation === this.presentation && cached.mask) return cached.mask;
    const mask = new Uint8Array(LIVE_WIDTH * LIVE_HEIGHT);
    try {
      const data = this.baseContext.getImageData(0, 0, LIVE_WIDTH, LIVE_HEIGHT).data;
      for (let y = 8; y < LIVE_HEIGHT; y += 1) for (let x = 0; x < LIVE_WIDTH; x += 1) {
        const p = (y * LIVE_WIDTH + x) * 4;
        if (data[p + 3] && data[p] + data[p + 1] + data[p + 2] > 12) mask[y * LIVE_WIDTH + x] = 1;
      }
    } catch {
      /* Canvas readback can be unavailable in unusual test/sandbox contexts.
       * Use a full playfield mask so the authored effect is still visible. */
      mask.fill(1, 8 * LIVE_WIDTH);
    }
    this.effectMaskCache = { frameSerial: serial, presentation: this.presentation, mask };
    return mask;
  }

  #hudBounds(resource, count) {
    const starts = { bullet: 104, dynamite: 168, life: 240 };
    const base = starts[resource];
    if (base === undefined) return null;
    const index = Math.max(0, Math.min(5, Number(count || 0) - 1));
    const x = base + index * 8;
    return { left: x, top: 0, right: x + 8, bottom: 8, resource, index };
  }

  hudInventoryBounds(snapshot = null) {
    const inv = snapshot?.inventory || {};
    return {
      bullet: this.#hudBounds('bullet', inv.bullets),
      dynamite: this.#hudBounds('dynamite', inv.dynamite),
      life: this.#hudBounds('life', inv.lives)
    };
  }

  #emit(type, snapshot, slot = 1, magnitude = 1, extra = {}) {
    const bounds = extra.bounds || this.entityBounds(snapshot, slot);
    const point = center(bounds);
    const targetEntity=(snapshot?.entities || []).find(entity=>Number(entity.slot)===Number(slot));
    this.onEvent?.({
      id: ++this.eventSerial, type, x: point.x, y: point.y, magnitude: clamp(Number(magnitude) || 0, 0, 1),
      direction: snapshot?.rick?.direction ? -1 : 1, targetSlot: slot, targetBounds: bounds, frameSerial: snapshot?.frameSerial,
      entityType: Number(extra.entityType ?? (targetEntity ? entityKind(targetEntity) : -1)),
      heroSprite: Number(extra.heroSprite ?? ((snapshot?.entities || []).find(entity=>Number(entity.slot)===1)?.sprite ?? -1)),
      hudInventoryBounds: extra.hudInventoryBounds || this.hudInventoryBounds(snapshot), ...extra
    });
  }

  #deriveEvents(now, before) {
    if (!before || now.submap !== before.submap) {
      const hero = nativeHeroContactBounds(now) || this.entityBounds(now, 1, 'classic');
      this.lastHeroX = hero ? center(hero).x : null; this.lastHeroY = hero ? center(hero).y : null; this.lastHeroDy = 0; this.wallHugFrames = 0; this.nearMissActive.fill(0);
      return;
    }
    const nowHero = nativeHeroContactBounds(now) || this.entityBounds(now, 1, 'classic');
    const oldHero = nativeHeroContactBounds(before) || this.entityBounds(before, 1, 'classic');
    const hp = center(nowHero), oldHp = center(oldHero);
    const dx = nowHero && oldHero ? hp.x - oldHp.x : 0;
    const dy = nowHero && oldHero ? hp.y - oldHp.y : 0;
    const nowState = now.rick.state >>> 0, oldState = before.rick.state >>> 0;
    const nowJump = !!(nowState & RICK.JUMP), oldJump = !!(oldState & RICK.JUMP);

    const visualHeroNow = this.entityBounds(now, 1, this.presentation) || nowHero;
    const heroFoot = visualHeroNow ? { x: (visualHeroNow.left + visualHeroNow.right) * 0.5, y: visualHeroNow.bottom - 1 } : hp;
    const movementPoint = actionId => heroMovementJuicePoint(now, actionId, this.presentation) || heroFoot;
    const bulletsNow = Number(now.inventory?.bullets || 0), bulletsBefore = Number(before.inventory?.bullets || 0);
    if (bulletsNow < bulletsBefore) this.#emit('ammo.deplete', now, 1, Math.min(1, bulletsBefore - bulletsNow), { bounds: visualHeroNow, x: heroFoot.x, y: heroFoot.y, resource: 'bullet', resourceBefore: bulletsBefore, resourceAfter: bulletsNow, hudBounds: this.#hudBounds('bullet', bulletsBefore) });
    else if (bulletsNow > bulletsBefore) {
      const editorRefill = !!(this.editorRefillSuppressMask & EDITOR_REFILL.BULLETS);
      this.editorRefillSuppressMask &= ~EDITOR_REFILL.BULLETS;
      if (!editorRefill) {
        const hudSequence = [];
        for (let count = bulletsBefore + 1; count <= bulletsNow; count += 1) hudSequence.push(this.#hudBounds('bullet', count));
        this.#emit('ammo.collect', now, 1, Math.min(1, (bulletsNow - bulletsBefore) / 2), { bounds: visualHeroNow, x: heroFoot.x, y: heroFoot.y, resource: 'bullet', resourceBefore: bulletsBefore, resourceAfter: bulletsNow, hudBounds: this.#hudBounds('bullet', bulletsNow), hudSequence });
      }
    }
    const dynamiteNow = Number(now.inventory?.dynamite || 0), dynamiteBefore = Number(before.inventory?.dynamite || 0);
    if (dynamiteNow < dynamiteBefore) this.#emit('ammo.deplete', now, 1, Math.min(1, dynamiteBefore - dynamiteNow), { bounds: visualHeroNow, x: heroFoot.x, y: heroFoot.y, resource: 'dynamite', resourceBefore: dynamiteBefore, resourceAfter: dynamiteNow, hudBounds: this.#hudBounds('dynamite', dynamiteBefore) });
    else if (dynamiteNow > dynamiteBefore) {
      const editorRefill = !!(this.editorRefillSuppressMask & EDITOR_REFILL.DYNAMITE);
      this.editorRefillSuppressMask &= ~EDITOR_REFILL.DYNAMITE;
      if (!editorRefill) {
        const hudSequence = [];
        for (let count = dynamiteBefore + 1; count <= dynamiteNow; count += 1) hudSequence.push(this.#hudBounds('dynamite', count));
        this.#emit('ammo.collect', now, 1, Math.min(1, (dynamiteNow - dynamiteBefore) / 2), { bounds: visualHeroNow, x: heroFoot.x, y: heroFoot.y, resource: 'dynamite', resourceBefore: dynamiteBefore, resourceAfter: dynamiteNow, hudBounds: this.#hudBounds('dynamite', dynamiteNow), hudSequence });
      }
    }
    const scoreDelta = Math.max(0, Number(now.score || 0) - Number(before.score || 0));
    if (scoreDelta > 0) this.#emit('points.collect', now, 1, clamp(scoreDelta / 500, .2, 1), { bounds: visualHeroNow, x: heroFoot.x, y: Math.max(12, heroFoot.y - 12), points: scoreDelta });
    /* Mirror e_box.c/e_bonus.c's real pickup boundary. Ammo boxes (0x10/11)
     * disappear immediately when Rick collects them; ordinary bonuses
     * (0x12..0x15) enter their upward collection sequence. Live-map action
     * authoring needs the generic pickup.collect event from that same native
     * transition rather than a synthetic collectible storyboard. */
    for (const oldEntity of before.entities || []) {
      const kind = entityKind(oldEntity);
      if (oldEntity.slot <= 3 || kind < 0x10 || kind > 0x15) continue;
      const nextEntity = (now.entities || []).find(entity => Number(entity.slot) === Number(oldEntity.slot) && Number(entity.mark) === Number(oldEntity.mark));
      const collectedBox = (kind === 0x10 || kind === 0x11) && !activeEntity(nextEntity);
      const collectedBonus = kind >= 0x12 && kind <= 0x15 && Number(oldEntity.c1 || 0) === 0 && Number(nextEntity?.c1 || 0) > 0;
      if (!collectedBox && !collectedBonus) continue;
      const bounds = this.entityBounds(before, oldEntity.slot, this.presentation) || this.entityBounds(before, oldEntity.slot, 'classic');
      const p = center(bounds);
      this.#emit('pickup.collect', now, oldEntity.slot, 1, { bounds, x:p.x, y:p.y, collectedEntityType:kind });
    }
    const heroCenter = center(visualHeroNow);
    if (!(nowState & RICK.JUMP) && now.rick.direction !== before.rick.direction && Math.abs(dx) > 0) this.#emit('player.turn', now, 1, clamp(Math.abs(dx) / 4, .25, 1), { bounds: visualHeroNow, ...movementPoint('player.turn') });
    if (Math.abs(dx) > 0 && !(nowState & (RICK.JUMP | RICK.CLIMB | RICK.CRAWL | RICK.ZOMBIE | RICK.DEAD))) {
      this.stepDistance += Math.abs(dx);
      if (this.stepDistance >= 12) { this.stepDistance %= 12; this.#emit('player.step', now, 1, clamp(Math.abs(dx) / 3, .35, 1), { bounds: visualHeroNow, ...movementPoint('player.step') }); }
    }
    const nowVelocity = Number(now.collision?.native?.playerVelocityY || 0);
    const oldVelocity = Number(before.collision?.native?.playerVelocityY || 0);
    const bombBounce = Number(now.bomb?.nearMissSerial || 0) !== Number(before.bomb?.nearMissSerial || 0);
    if (bombBounce) {
      this.#emit('player.bounce_back', now, 1, 1, { bounds: visualHeroNow, ...movementPoint('player.bounce_back') });
    } else if (nowJump && !oldJump && nowVelocity < 0) {
      /* Native gameplay owns jump vs rebound dispatch. The browser snapshot
       * has no event queue, so mirror that semantic from current source facts:
       * an upward fresh airborne transition is a jump; unsupported falls are not. */
      this.#emit('player.jump', now, 1, 1, { bounds: visualHeroNow, ...movementPoint('player.jump') });
    } else if (nowJump && oldJump && oldVelocity > 0 && nowVelocity < 0) {
      this.#emit('player.bounce_back', now, 1, 1, { bounds: visualHeroNow, ...movementPoint('player.bounce_back') });
    }
    if (nowJump && oldJump && this.lastHeroDy < -0.1 && dy >= -0.1) this.#emit('player.apex', now, 1, clamp(Math.abs(this.lastHeroDy) / 4, .4, 1), { bounds: visualHeroNow, x: heroCenter.x, y: heroCenter.y });
    if (!nowJump && oldJump && !(nowState & (RICK.CLIMB | RICK.ZOMBIE | RICK.DEAD))) this.#emit('player.land', now, 1, clamp(Math.abs(this.lastHeroDy) / 8, .35, 1), { bounds: visualHeroNow, ...movementPoint('player.land') });
    const heroEntityNow=(now.entities||[]).find(e=>Number(e.slot)===1), heroEntityBefore=(before.entities||[]).find(e=>Number(e.slot)===1);
    const staffFrame=[0x0b,0x17].includes(Number(heroEntityNow?.sprite));
    const staffFrameBefore=[0x0b,0x17].includes(Number(heroEntityBefore?.sprite));
    if (staffFrame && (!staffFrameBefore || (Number(now.frameSerial) % 4) === 0)) { const p=center(visualHeroNow); this.#emit('player.staff_hold',now,1,1,{bounds:visualHeroNow,x:p.x,y:p.y,heroSprite:Number(heroEntityNow?.sprite ?? -1)}); }
    if (staffFrame) {
      for (const enemy of now.entities || []) {
        if (Number(enemy.slot) <= 3 || !isLivingEnemy(enemy) || Number(enemy.latency) !== 0x14) continue;
        const oldEnemy=(before.entities||[]).find(row=>Number(row.slot)===Number(enemy.slot)&&Number(row.mark)===Number(enemy.mark));
        if (oldEnemy && Number(oldEnemy.latency) === 0x14) continue;
        const bounds=this.entityBounds(now,enemy.slot,this.presentation)||this.entityBounds(before,enemy.slot,this.presentation);
        if (!bounds) continue;
        const p=center(bounds);
        this.#emit('enemy.stick_hit',now,enemy.slot,1,{bounds,x:p.x,y:p.y,direction:p.x>=heroCenter.x?1:-1,heroSprite:Number(heroEntityNow?.sprite ?? -1)});
      }
    }

    for (const platform of now.entities || []) {
      const slot = Number(platform.slot);
      const state = Number(platform.movingPlatformState || 0);
      if (slot < 0 || slot >= this.platformPulse.length || !state) continue;
      const old = (before.entities || []).find(entity => Number(entity.slot) === slot);
      const sameActor = old && Number(old.mark) === Number(platform.mark);
      const oldState = sameActor ? Number(old.movingPlatformState || 0) : 0;
      const bounds = this.entityBounds(now, slot, this.presentation) || this.entityBounds(now, slot, 'classic');
      const point = center(bounds);
      const oldBounds = sameActor ? (this.entityBounds(before, slot, this.presentation) || this.entityBounds(before, slot, 'classic')) : null;
      const oldPoint = center(oldBounds);
      const platformDirection = oldBounds && Math.abs(point.x - oldPoint.x) > .1 ? (point.x > oldPoint.x ? 1 : -1) : 1;
      if (oldState === 1 && state === 2)
        this.#emit('platform.start', now, slot, 1, { bounds, x: point.x, y: point.y, direction: platformDirection });
      if (oldState === 1 && state === 3)
        this.#emit('platform.release', now, slot, 1, { bounds, x: point.x, y: point.y, direction: platformDirection });
      if (oldState === 2 && state === 1)
        this.#emit('platform.stop', now, slot, 1, { bounds, x: point.x, y: point.y, direction: platformDirection });
      if (state === 2 || state === 3) {
        let pulse = sameActor && (oldState === 2 || oldState === 3) ? this.platformPulse[slot] + 1 : 1;
        if (pulse >= 4) {
          pulse = 0;
          this.#emit(state === 2 ? 'platform.moving' : 'platform.running', now, slot, 1, { bounds, x: point.x, y: point.y, direction: platformDirection });
        }
        this.platformPulse[slot] = pulse;
      } else this.platformPulse[slot] = 0;
    }
    for (let slot = 0; slot < this.platformPulse.length; slot += 1) {
      const entity = (now.entities || []).find(candidate => Number(candidate.slot) === slot);
      if (!entity || !Number(entity.movingPlatformState || 0)) this.platformPulse[slot] = 0;
    }

    /* Castle's paired 0x36/0x37 bomb blockage is one physical mechanism but
     * occupies two native entities. Emit one semantic crumble event from the
     * first real type-3 crumble tick and use the union of both production
     * presentation bounds. This keeps Live-map authoring on native mechanism
     * state instead of replaying the old JavaScript crumble storyboard. */
    const crumblingBlockage=[];
    for(const oldEntity of before.entities||[]){
      const kind=entityKind(oldEntity);if(kind!==0x36&&kind!==0x37)continue;
      const nextEntity=(now.entities||[]).find(entity=>Number(entity.slot)===Number(oldEntity.slot)&&Number(entity.mark)===Number(oldEntity.mark));
      if(!nextEntity||Number(oldEntity.c2||0)>0||Number(nextEntity.c2||0)<=0)continue;
      const bounds=this.entityBounds(now,nextEntity.slot,this.presentation)||this.entityBounds(before,oldEntity.slot,this.presentation);if(bounds)crumblingBlockage.push({slot:nextEntity.slot,bounds});
    }
    if(crumblingBlockage.length){
      const related=(now.entities||[]).filter(entity=>{const kind=entityKind(entity);return kind===0x36||kind===0x37;}).map(entity=>({slot:entity.slot,bounds:this.entityBounds(now,entity.slot,this.presentation)})).filter(row=>row.bounds);
      const rows=related.length?related:crumblingBlockage,bounds={left:Math.min(...rows.map(row=>row.bounds.left)),top:Math.min(...rows.map(row=>row.bounds.top)),right:Math.max(...rows.map(row=>row.bounds.right)),bottom:Math.max(...rows.map(row=>row.bounds.bottom))},p=center(bounds);
      this.#emit('blockage.crumble',now,crumblingBlockage[0].slot,1,{bounds,x:p.x,y:p.y,blockageSlots:rows.map(row=>row.slot)});
    }

    /* Derive wall contact from xrick's own result: while falling, a held
     * horizontal input asks for the normal 2 px move; if xrick leaves X
     * unchanged, its classic collision solver blocked the step. No second
     * collision pass or framebuffer scan is needed. */
    const wallSide = (this.controlMask & CONTROL.LEFT) ? 'left' : ((this.controlMask & CONTROL.RIGHT) ? 'right' : null);
    const wallHug = !!nowHero && nowJump && dy > 0.1 && wallSide && Math.abs(dx) < 0.25 && !(nowState & (RICK.CLIMB | RICK.CRAWL | RICK.ZOMBIE | RICK.DEAD));
    if (wallHug) {
      this.wallHugFrames += 1;
      if (this.wallHugFrames === 2 || (this.wallHugFrames > 2 && (this.wallHugFrames - 2) % 3 === 0)) {
        const visualHero = this.entityBounds(now, 1, this.presentation) || nowHero;
        const contact = wallContactSurface(visualHero, wallSide);
        this.#emit('player.wall_hug', now, 1, clamp(dy / 7, .35, 1), {
          bounds: contact?.bounds || visualHero, actorBounds: visualHero, x: contact?.x, y: contact?.y, wallSide,
          direction: wallSide === 'left' ? 1 : -1, audioPan: wallSide === 'left' ? -0.75 : 0.75
        });
      }
    } else this.wallHugFrames = 0;

    const bulletNow = (now.entities || []).find(e => e.slot === 2);
    const bulletOld = (before.entities || []).find(e => e.slot === 2);
    const bulletActive = activeEntity(bulletNow), bulletWasActive = activeEntity(bulletOld);
    if (bulletActive && !bulletWasActive) {
      const visualHero = this.entityBounds(now, 1, this.presentation);
      const visualBullet = this.entityBounds(now, 2, this.presentation);
      const muzzle = visualBullet ? center(visualBullet) : center(visualHero);
      this.#emit('weapon.fire', now, 1, 1, { bounds: visualHero, x: muzzle.x, y: muzzle.y, hudBounds: this.#hudBounds('bullet', now.inventory?.bullets) });
      this.lastBulletBounds = this.entityBounds(now, 2, 'classic');
    } else if (bulletActive) {
      this.lastBulletBounds = this.entityBounds(now, 2, 'classic');
    }
    if (!bulletActive && bulletWasActive) {
      const oldBulletBounds = this.entityBounds(before, 2, 'classic') || this.lastBulletBounds;
      /* e_them.c tests the projectile's leading point: x for leftward shots,
       * x+0x18 for rightward shots. Use that same contact geometry rather than
       * the visual sprite centre, which caused real enemy hits to be mistaken
       * for wall impacts. */
      const shotRight = Number(bulletOld?.sprite) === 0x20 || (Number(bulletOld?.sprite) !== 0x21 && now.rick.direction !== 0);
      const bulletPoint = bulletOld ? classicToScreen(Number(bulletOld.x) + (shotRight ? 0x18 : 0), Number(bulletOld.y)) : center(oldBulletBounds);
      let hit = null;
      for (const oldEntity of before.entities || []) {
        if (oldEntity.slot <= 3 || !isLivingEnemy(oldEntity)) continue;
        const newEntity = (now.entities || []).find(e => e.slot === oldEntity.slot);
        const becameZombie = entityKind(newEntity) === 0x47;
        const vanished = !activeEntity(newEntity);
        if (!becameZombie && !vanished) continue;
        const bounds = this.entityBounds(before, oldEntity.slot, 'classic');
        if (!bounds) continue;
        const d2 = pointRectDistance2(bulletPoint, bounds);
        if (d2 <= 24 * 24 && (!hit || d2 < hit.d2)) hit = { slot: oldEntity.slot, bounds, d2 };
      }
      if (hit) {
        const visualTarget = this.entityBounds(before, hit.slot, this.presentation) || hit.bounds;
        let visualPoint = bulletPoint;
        if (this.presentation === 'rdx') {
          const visualBullet = this.entityBounds(before, 2, 'rdx');
          if (visualBullet) visualPoint = { x: shotRight ? visualBullet.right : visualBullet.left, y: (visualBullet.top + visualBullet.bottom) * 0.5 };
          else if (visualTarget && hit.bounds) {
            const nx = clamp((bulletPoint.x - hit.bounds.left) / Math.max(1, hit.bounds.right - hit.bounds.left), 0, 1);
            const ny = clamp((bulletPoint.y - hit.bounds.top) / Math.max(1, hit.bounds.bottom - hit.bounds.top), 0, 1);
            visualPoint = { x: visualTarget.left + nx * (visualTarget.right - visualTarget.left), y: visualTarget.top + ny * (visualTarget.bottom - visualTarget.top) };
          }
        }
        this.#emit('bullet.target_hit', now, hit.slot, 1, { bounds: visualTarget, x: visualPoint.x, y: visualPoint.y, direction: shotRight ? 1 : -1, confirmedEnemyKill: true });
      } else {
        const explodingAmmoBox = (before.entities || []).some(oldEntity => {
          const kind = entityKind(oldEntity);
          if (oldEntity.slot <= 3 || (kind !== 0x10 && kind !== 0x11) || (Number(oldEntity.n) & 0x80)) return false;
          const nextEntity = (now.entities || []).find(e => e.slot === oldEntity.slot);
          return !!nextEntity && !!(Number(nextEntity.n) & 0x80) && entityKind(nextEntity) === kind;
        });
        if (!explodingAmmoBox) {
          const visualBullet = this.entityBounds(before, 2, this.presentation) || oldBulletBounds;
          const visualPoint = visualBullet ? { x: shotRight ? visualBullet.right : visualBullet.left, y: (visualBullet.top + visualBullet.bottom) * 0.5 } : bulletPoint;
          this.#emit('bullet.wall_hit', now, 2, .75, { bounds: visualBullet, x: visualPoint.x, y: visualPoint.y });
        }
      }
      this.lastBulletBounds = null;
    }

    /* Invincible editor traversal records kill attempts without mutating Rick.
     * Classify the new attempt from already-present native state: lethal bomb
     * proximity wins, otherwise use the nearest active hostile projectile. */
    const wouldDie = Number(now.debug?.wouldDieCount || 0) > Number(before.debug?.wouldDieCount || 0);
    const becameDead = !(oldState & (RICK.ZOMBIE | RICK.DEAD)) && !!(nowState & (RICK.ZOMBIE | RICK.DEAD));
    if (wouldDie && nowHero) {
      const visualHero = this.entityBounds(now, 1, this.presentation) || nowHero;
      const p = center(visualHero);
      this.#emit('player.suppressed_lethal_hit', now, 1, 1, { bounds:visualHero, x:p.x, y:p.y, suppressedByInvincibility:true });
    }
    if ((wouldDie || becameDead) && nowHero) {
      const visualHero = this.entityBounds(now, 1, this.presentation) || nowHero;
      const heroPoint = center(visualHero);
      const activeBomb = (now.entities || []).find(e => e.slot === 3 && activeEntity(e));
      const oldBomb = (before.entities || []).find(e => e.slot === 3 && activeEntity(e));
      const bombBounds = this.entityBounds(now, 3, 'classic') || this.entityBounds(before, 3, 'classic');
      const bombPoint = center(bombBounds);
      const bombDanger = (now.bomb.lethal || before.bomb.lethal) && bombBounds && distance2(center(nowHero), bombPoint) <= 52 * 52;
      if (bombDanger) {
        const visualBomb = this.entityBounds(now, 3, this.presentation) || this.entityBounds(before, 3, this.presentation);
        const vp = center(visualBomb);
        const direction = heroPoint.x >= vp.x ? 1 : -1;
        this.#emit('player.explosion_hit', now, 1, 1, { bounds: visualHero, x: heroPoint.x, y: heroPoint.y, direction });
      } else {
        let nearest = null;
        for (const projectile of now.entities || []) {
          if (projectile.slot <= 3 || !isHostileProjectile(projectile)) continue;
          const pb = classicHostileProjectileContactBounds(projectile) || this.entityBounds(now, projectile.slot, 'classic');
          if (!pb) continue;
          const d2 = pointRectDistance2(center(nowHero), pb);
          if (d2 <= 24 * 24 && (!nearest || d2 < nearest.d2)) nearest = { projectile, bounds: pb, d2 };
        }
        if (nearest) {
          const beforeProjectile = (before.entities || []).find(e => e.slot === nearest.projectile.slot);
          const oldPb = classicHostileProjectileContactBounds(beforeProjectile) || this.entityBounds(before, nearest.projectile.slot, 'classic');
          const vx = oldPb ? center(nearest.bounds).x - center(oldPb).x : (nearest.projectile.x - Number(beforeProjectile?.x || nearest.projectile.x));
          const direction = vx < 0 ? -1 : vx > 0 ? 1 : (center(nearest.bounds).x < center(nowHero).x ? 1 : -1);
          this.#emit('player.projectile_hit', now, 1, 1, { bounds: visualHero, x: heroPoint.x, y: heroPoint.y, direction, projectileSlot: nearest.projectile.slot });
        }
      }
    }

    /* One cheap swept-distance check per active hostile projectile. The
     * classifier mirrors ents.c: flying 0x39, or active 0x19/0x1a type-3
     * projectile families. This is intentionally implementable with integer
     * math on a CD32 target. */
    if (nowHero && !(nowState & (RICK.ZOMBIE | RICK.DEAD))) {
      this.projectileSeen.fill(0);
      for (const projectile of now.entities || []) {
        if (projectile.slot <= 3 || projectile.slot >= this.projectileSeen.length || !isHostileProjectile(projectile)) continue;
        this.projectileSeen[projectile.slot] = 1;
        /* Detection runs in Classic gameplay coordinates; RDX visual geometry
         * is used only after the exact swept contact time is known. */
        const bounds = classicHostileProjectileContactBounds(projectile) || this.entityBounds(now, projectile.slot, 'classic');
        const oldProjectile = (before.entities || []).find(entity => Number(entity.slot) === Number(projectile.slot));
        const oldBounds = classicHostileProjectileContactBounds(oldProjectile) || this.entityBounds(before, projectile.slot, 'classic');
        if (!bounds || !oldBounds || overlap(bounds, nowHero)) { this.nearMissActive[projectile.slot] = 0; continue; }
        const a = center(oldBounds), b = center(bounds), vx = b.x - a.x, vy = b.y - a.y;
        const speed2 = vx * vx + vy * vy, contact = sweptNearMiss(nowHero, a, b, 10), d2 = contact?.distance2 ?? Infinity;
        /* Trigger from the projectile's swept segment against Rick's expanded
         * body, not a single head point.  The head-point test could wait until
         * a diagonal projectile was far past Rick before becoming closest. */
        const near = speed2 >= 1 && !!contact && !overlap(bounds, nowHero);
        if (near && !this.nearMissActive[projectile.slot]) {
          this.nearMissActive[projectile.slot] = 1;
          const distance = Math.sqrt(d2), speed = Math.sqrt(speed2);
          const magnitude = clamp(1 - Math.max(0, distance - 2) / 12, .4, 1);
          let audioPan = clamp((contact.x - ((nowHero.left+nowHero.right)/2)) / 18, -1, 1);
          if (Math.abs(audioPan) < .2 && Math.abs(vx) > .1) audioPan = vx > 0 ? -.65 : .65;
          const visualOld = this.entityBounds(before, projectile.slot, this.presentation) || oldBounds;
          const visualNow = this.entityBounds(now, projectile.slot, this.presentation) || bounds;
          const va = center(visualOld), vb = center(visualNow);
          const flyBy = { x: va.x + (vb.x - va.x) * contact.t, y: va.y + (vb.y - va.y) * contact.t };
          const visualHero = this.entityBounds(now, 1, this.presentation) || nowHero;
          const flyByBounds = { left: flyBy.x - 2, top: flyBy.y - 2, right: flyBy.x + 3, bottom: flyBy.y + 3 };
          this.#emit('projectile.near_miss', now, 1, magnitude, {
            bounds: flyByBounds, actorBounds: visualHero, x: flyBy.x, y: flyBy.y, projectileSlot: projectile.slot,
            projectileSpeed: speed, audioPan, audioRate: clamp(.9 + speed * .025, .9, 1.25),
            direction: vx < 0 ? -1 : 1, entityType: entityKind(projectile)
          });
        } else if (!near && d2 > 24 * 24) this.nearMissActive[projectile.slot] = 0;
      }
      for (let slot = 0; slot < this.nearMissActive.length; slot++) {
        if (this.nearMissActive[slot] && !this.projectileSeen[slot]) this.nearMissActive[slot] = 0;
      }
    } else this.nearMissActive.fill(0);


    /* Ammo crates/collectibles (0x10 bombs, 0x11 bullets) use e_box.c's real
     * explosion path when shot, stick-hit or caught by dynamite. Detect the
     * nonlethal -> ENT_LETHAL transition directly so Game Juice treats this
     * as an explosion source rather than a generic bullet-wall impact. */
    for (const oldEntity of before.entities || []) {
      const kind = entityKind(oldEntity);
      if (oldEntity.slot <= 3 || (kind !== 0x10 && kind !== 0x11) || (Number(oldEntity.n) & 0x80)) continue;
      const nextEntity = (now.entities || []).find(e => e.slot === oldEntity.slot);
      if (!nextEntity || !(Number(nextEntity.n) & 0x80) || entityKind(nextEntity) !== kind) continue;
      const visualBox = this.entityBounds(now, oldEntity.slot, this.presentation) || this.entityBounds(before, oldEntity.slot, this.presentation);
      const p = center(visualBox);
      this.#emit('ammo.explode', now, oldEntity.slot, 1, { bounds: visualBox, x: p.x, y: p.y, resource: kind === 0x10 ? 'dynamite' : 'bullet', explosionSource: 'ammo-collectible' });
    }


    const bombNow = (now.entities || []).find(e => e.slot === 3);
    const bombOld = (before.entities || []).find(e => e.slot === 3);
    const bombActive = activeEntity(bombNow), bombWasActive = activeEntity(bombOld);
    if (bombActive && !bombWasActive) {
      const visualBomb = this.entityBounds(now, 3, this.presentation);
      const p = center(visualBomb);
      this.#emit('dynamite.place', now, 3, 1, { bounds: visualBomb, x: p.x, y: p.y, hudBounds: this.#hudBounds('dynamite', now.inventory?.dynamite) });
    }
    /* Mirror e_bomb.c's native fuse-pulse cadence exactly. */
    if (bombActive && now.bomb.ticker !== before.bomb.ticker && now.bomb.ticker >= 0x0a && (now.bomb.ticker & 0x03) === 0x02) {
      const visualBomb = this.entityBounds(now, 3, this.presentation);
      const p = visualBomb ? { x: (visualBomb.left + visualBomb.right) * 0.5, y: visualBomb.top + 3 } : center(visualBomb);
      this.#emit('dynamite.fuse', now, 3, clamp(1 - now.bomb.ticker / 45, .25, 1), { bounds: visualBomb, x: p.x, y: p.y });
    }
    if (now.bomb.lethal && !before.bomb.lethal) {
      const visualBlast = this.entityBounds(now, 3, this.presentation);
      const classicBlast = this.entityBounds(now, 3, 'classic') || this.entityBounds(before, 3, 'classic');
      const p = center(visualBlast);
      this.blastSerial = Number(now.frameSerial);
      this.blastPointClassic = center(classicBlast);
      this.blastHitSeen.fill(0);
      this.#emit('dynamite.explode', now, 3, 1, { bounds: visualBlast, x: p.x, y: p.y });
    }
    if (Number(now.bomb?.nearMissSerial || 0) !== Number(before.bomb?.nearMissSerial || 0)) {
      const visualHero=this.entityBounds(now,1,this.presentation)||nowHero;
      const visualBomb=this.entityBounds(now,3,this.presentation)||this.entityBounds(before,3,this.presentation);
      const hpv=center(visualHero), bpv=center(visualBomb);
      this.#emit('player.explosion_near_miss',now,1,Math.max(.01,Math.min(1,Number(now.bomb?.nearMissStrengthPercent||100)/100)),{bounds:visualHero,x:hpv.x,y:hpv.y,direction:hpv.x>=bpv.x?1:-1,explosionDistancePx:Number(now.bomb?.nearMissDistancePx||0),explosionStrengthPercent:Number(now.bomb?.nearMissStrengthPercent||0)});
    }
    if (this.blastSerial >= 0 && Number(now.frameSerial) - this.blastSerial <= 3 && this.blastPointClassic) {
      for (const oldEntity of before.entities || []) {
        if (oldEntity.slot <= 3 || oldEntity.slot >= this.blastHitSeen.length || this.blastHitSeen[oldEntity.slot] || !isLivingEnemy(oldEntity)) continue;
        const nextEntity = (now.entities || []).find(e => e.slot === oldEntity.slot);
        if (entityKind(nextEntity) !== 0x47 && activeEntity(nextEntity)) continue;
        const oldBounds = this.entityBounds(before, oldEntity.slot, 'classic');
        if (!oldBounds || distance2(center(oldBounds), this.blastPointClassic) > 64 * 64) continue;
        this.blastHitSeen[oldEntity.slot] = 1;
        const visualTarget = this.entityBounds(before, oldEntity.slot, this.presentation) || oldBounds;
        const visualBlast = this.entityBounds(now, 3, this.presentation) || this.entityBounds(before, 3, this.presentation);
        const tp = center(visualTarget), bp = center(visualBlast);
        this.#emit('dynamite.target_hit', now, oldEntity.slot, 1, { bounds: visualTarget, x: tp.x, y: tp.y, direction: tp.x >= bp.x ? 1 : -1 });
      }
    }
    if (this.blastSerial >= 0 && Number(now.frameSerial) - this.blastSerial > 3) {
      this.blastSerial = -1; this.blastPointClassic = null; this.blastHitSeen.fill(0);
    }

    this.lastHeroDy = dy;
    this.lastHeroX = hp.x; this.lastHeroY = hp.y;
  }
}
