import { CONTROL } from './xrick-live-preview.js';
import { discardNativeSceneCheckpoint, restoreNativeSceneCheckpoint, saveNativeSceneCheckpoint, stepNativeFrame } from '../runtime/native-scene-runner.js';

const dataUrl = path => new URL(`../../data/${path}`, import.meta.url);
async function fetchJson(path){const response=await fetch(dataUrl(path),{cache:'no-store'});if(!response.ok)throw new Error(`Native action preview ${path} HTTP ${response.status}`);return response.json();}
async function fetchBytes(path){const response=await fetch(dataUrl(path),{cache:'no-store'});if(!response.ok)throw new Error(`Native action preview ${path} HTTP ${response.status}`);return new Uint8Array(await response.arrayBuffer());}

const FRAME_MS = 40;
const DEFAULT_SUBMAP = 0x02;

function freezeScenario(actionId, spec = {}) {
  const id = String(actionId || '');
  const postEventFrames = Math.max(0, Number(spec.postEventFrames || 0) | 0);
  const loopFrames = Math.max(1, Number(spec.loopFrames || 120) | 0);
  const normalizePoint = value => Array.isArray(value) && value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))
    ? Object.freeze([Number(value[0]), Number(value[1])]) : null;
  const byDirection = spec.heroWorldByDirection && typeof spec.heroWorldByDirection === 'object'
    ? Object.freeze({
        left:normalizePoint(spec.heroWorldByDirection.left),
        right:normalizePoint(spec.heroWorldByDirection.right)
      })
    : null;
  const targetSourceKeys = Object.freeze(Array.isArray(spec.targetSourceKeys) ? spec.targetSourceKeys.map(String) : []);
  const submap = Number.isInteger(Number(spec.submap)) ? Number(spec.submap) : DEFAULT_SUBMAP;
  const heroWorld = normalizePoint(spec.heroWorld);
  const focus = String(spec.focus || 'hero');
  const heroScreenY = Number.isFinite(Number(spec.heroScreenY)) ? Number(spec.heroScreenY) : 150;
  const heroScreenYByDirection = spec.heroScreenYByDirection && typeof spec.heroScreenYByDirection === 'object'
    ? Object.freeze({
        left:Number.isFinite(Number(spec.heroScreenYByDirection.left)) ? Number(spec.heroScreenYByDirection.left) : null,
        right:Number.isFinite(Number(spec.heroScreenYByDirection.right)) ? Number(spec.heroScreenYByDirection.right) : null
      })
    : null;
  const locationId = String(spec.locationId || `sm${submap.toString(16).padStart(2,'0')}-${id.replace(/[^a-z0-9]+/gi,'-')}`);
  const proof = Object.freeze({ eventType:id, maxFrames:Math.max(1, Number(spec.maxFrames || loopFrames) | 0) });
  const camera = Object.freeze({ focus, heroScreenY, heroScreenYByDirection });
  const setup = Object.freeze({
    kind:String(spec.kind || 'wait'),
    heroWorld,
    heroWorldByDirection:byDirection,
    heroYOffset:Number(spec.heroYOffset || 0),
    heroSide:spec.heroSide || null,
    heroDistance:Math.max(8, Number(spec.heroDistance || 24)),
    heroAnchorY:spec.heroAnchorY || null,
    approachFrames:spec.approachFrames ?? null,
    scriptDirection:spec.scriptDirection ?? null,
    useRoomEntry:!!spec.useRoomEntry,
    plantFrame:Number.isFinite(Number(spec.plantFrame)) ? Math.max(0, Number(spec.plantFrame) | 0) : null
  });
  return Object.freeze({
    actionId:id,
    locationId,
    kind:setup.kind,
    submap,
    loopFrames,
    focus,
    preStageFrames:Math.max(0, Number(spec.preStageFrames ?? 12) | 0),
    postEventFrames,
    restartAfterPostEvent:spec.restartAfterPostEvent === undefined ? postEventFrames > 0 : !!spec.restartAfterPostEvent,
    targetSourceKeys,
    targetSize:Array.isArray(spec.targetSize) ? Object.freeze(spec.targetSize.map(Number)) : null,
    heroWorld,
    heroWorldByDirection:byDirection,
    heroYOffset:setup.heroYOffset,
    heroSide:setup.heroSide,
    heroDistance:setup.heroDistance,
    heroAnchorY:setup.heroAnchorY,
    approachFrames:setup.approachFrames,
    scriptDirection:setup.scriptDirection,
    useRoomEntry:setup.useRoomEntry,
    plantFrame:setup.plantFrame,
    setup,
    camera,
    proof
  });
}

/*
 * Native Action Preview scenarios are deliberately reviewed gameplay setups,
 * not sprite-storyboards. Each one chooses a room/location where xrick can
 * actually complete the action and then lets native simulation continue after
 * the selected semantic event so the inspector shows the real consequence
 * (bullet flight/impact, enemy death, jump descent/landing, explosion/crumble,
 * etc.). `postEventFrames` is therefore a replay delay, never a frame hold.
 */
const SCENARIOS = Object.freeze({
  'player.step': freezeScenario('player.step', { kind:'walk', submap:0x02, loopFrames:96, focus:'hero', heroWorld:[144,155] }),
  'player.turn': freezeScenario('player.turn', { kind:'turn', submap:0x02, loopFrames:96, focus:'hero', heroWorld:[144,155], postEventFrames:22 }),

  /* SM00 has enough vertical clearance to show the complete takeoff/apex/land
   * arc. The two reviewed starts keep the selected direction away from the
   * nearest wall/ceiling instead of using SM02's low corridor. */
  'player.jump': freezeScenario('player.jump', { kind:'jump', submap:0x00, loopFrames:120, focus:'hero', heroWorldByDirection:{right:[135,255],left:[247,223]}, postEventFrames:48 }),
  'player.bounce_back': freezeScenario('player.bounce_back', { kind:'well-fall', submap:0x00, loopFrames:180, focus:'hero', heroWorld:[232,95], heroScreenY:103, scriptDirection:1, postEventFrames:28 }),
  'player.apex': freezeScenario('player.apex', { kind:'jump', submap:0x00, loopFrames:120, focus:'hero', heroWorldByDirection:{right:[135,255],left:[247,223]}, postEventFrames:28 }),
  'player.land': freezeScenario('player.land', { kind:'jump', submap:0x00, loopFrames:120, focus:'hero', heroWorldByDirection:{right:[135,255],left:[247,223]}, postEventFrames:24 }),

  /* The upper SM00 walkway naturally runs into the first well. Keeping RIGHT
   * held makes Rick walk off the lip and remain pressed against the well's
   * right wall during the real fall, which is exactly the wall-hug contract. */
  'player.wall_hug': freezeScenario('player.wall_hug', { kind:'well-fall', submap:0x00, loopFrames:120, focus:'hero', heroWorld:[232,95], heroScreenY:103, scriptDirection:1, postEventFrames:30 }),
  'player.staff_hold': freezeScenario('player.staff_hold', { kind:'staff', submap:0x02, loopFrames:88, focus:'hero', heroWorld:[144,155] }),

  /* SM00's upper corridor gives bullets room to travel while Rick keeps the
   * native SHOOT state alive with FIRE+UP. The non-automatic trigger prevents
   * a second bullet while the chord remains held. */
  'weapon.fire': freezeScenario('weapon.fire', { kind:'gun', submap:0x00, loopFrames:120, focus:'hero', heroWorldByDirection:{right:[100,95],left:[200,95]}, heroScreenY:103, postEventFrames:64 }),
  'ammo.deplete': freezeScenario('ammo.deplete', { kind:'gun', submap:0x00, loopFrames:120, focus:'hero', heroWorldByDirection:{right:[100,95],left:[200,95]}, heroScreenY:103, postEventFrames:48 }),

  /* These starts deliberately put the real bullet a short flight from actual
   * SM00 terrain. Focus follows the projectile until xrick emits wall_hit, then
   * stays on the native impact point while simulation continues. */
  'bullet.wall_hit': freezeScenario('bullet.wall_hit', { kind:'wall-gun', submap:0x00, loopFrames:100, focus:'projectile', heroWorldByDirection:{right:[205,223],left:[100,95]}, heroScreenYByDirection:{right:150,left:103}, postEventFrames:24 }),
  'bullet.target_hit': freezeScenario('bullet.target_hit', { kind:'target-gun', submap:0x03, loopFrames:150, focus:'target', targetSourceKeys:['mark:25'], targetSize:[32,21], useRoomEntry:true, heroScreenY:103, approachFrames:0, scriptDirection:1, postEventFrames:44 }),
  'enemy.stick_hit': freezeScenario('enemy.stick_hit', { kind:'target-staff', submap:0x03, loopFrames:120, focus:'target', targetSourceKeys:['mark:25'], targetSize:[32,21], heroSide:'left', heroDistance:24, heroAnchorY:'top', scriptDirection:1, postEventFrames:36 }),

  /* Projectile damage previews preserve each room's native entry/camera.
   * SM26 gives a clean castle-missile Hero hit from its authored start; SM12's
   * mark 216 projectile naturally passes the authored room start as a near miss,
   * so neither action needs a synthetic target-relative Hero teleport. */
  'player.projectile_hit': freezeScenario('player.projectile_hit', { kind:'wait', submap:0x26, loopFrames:120, focus:'hero', targetSourceKeys:['mark:416'], targetSize:[24,16], useRoomEntry:true, postEventFrames:32 }),
  'projectile.near_miss': freezeScenario('projectile.near_miss', { kind:'wait', submap:0x12, loopFrames:156, focus:'hero', targetSourceKeys:['mark:216'], targetSize:[24,10], useRoomEntry:true, postEventFrames:32 }),

  'dynamite.place': freezeScenario('dynamite.place', { kind:'bomb', submap:0x02, loopFrames:120, focus:'hero', heroWorld:[144,155], postEventFrames:30 }),
  'dynamite.fuse': freezeScenario('dynamite.fuse', { kind:'bomb', submap:0x02, loopFrames:130, focus:'hero', heroWorld:[144,155], postEventFrames:28 }),
  'dynamite.explode': freezeScenario('dynamite.explode', { kind:'bomb', submap:0x02, loopFrames:150, focus:'hero', heroWorld:[144,155], postEventFrames:30 }),

  /* SM03 mark 26 is the compact upper bullet-ammo box. Shooting the real box
   * gives a cleaner collectible-destruction preview than the former planted
   * bomb staging and keeps camera focus on the authored pickup itself. */
  'ammo.explode': freezeScenario('ammo.explode', { kind:'target-gun', submap:0x03, loopFrames:160, focus:'hero', targetSourceKeys:['mark:26'], targetSize:[32,21], heroWorld:[144,95], heroScreenY:103, scriptDirection:1, postEventFrames:30 }),
  'ammo.collect': freezeScenario('ammo.collect', { kind:'target-walk', submap:0x03, loopFrames:96, focus:'hero', targetSourceKeys:['mark:26'], targetSize:[32,21], heroWorld:[144,95], heroScreenY:103, scriptDirection:1, postEventFrames:26 }),

  'dynamite.target_hit': freezeScenario('dynamite.target_hit', { kind:'bomb', submap:0x07, loopFrames:190, focus:'hero', targetSourceKeys:['mark:76'], targetSize:[32,21], heroWorld:[96,347], plantFrame:50, postEventFrames:44 }),
  'player.explosion_hit': freezeScenario('player.explosion_hit', { kind:'bomb', submap:0x02, loopFrames:150, focus:'hero', heroWorld:[144,155], postEventFrames:30 }),
  'player.explosion_near_miss': freezeScenario('player.explosion_near_miss', { kind:'bomb-retreat', submap:0x02, loopFrames:150, focus:'hero', heroWorld:[144,155], postEventFrames:30 }),
  'player.suppressed_lethal_hit': freezeScenario('player.suppressed_lethal_hit', { kind:'wait', submap:0x07, loopFrames:150, focus:'hero', targetSourceKeys:['mark:76'], targetSize:[32,21], heroWorld:[96,347], postEventFrames:28 }),
  'pickup.collect': freezeScenario('pickup.collect', { kind:'target-walk', submap:0x02, loopFrames:120, focus:'target', targetSourceKeys:['mark:22'], targetSize:[32,21], heroDistance:42, postEventFrames:26 }),
  'points.collect': freezeScenario('points.collect', { kind:'target-gun', submap:0x03, loopFrames:170, focus:'hero', targetSourceKeys:['mark:25'], targetSize:[32,21], useRoomEntry:true, approachFrames:0, scriptDirection:1, postEventFrames:44 }),

  /* Normal MOVING and explosion RELEASED platforms are different native
   * mechanism states and must not share one preview. SM05 mark 55 is a real
   * TRIGRICK platform: placing Rick in its reviewed trigger wakes MOVING while
   * he keeps travelling right through the lane. SM10 mark 193 remains the real
   * bomb-release path for platform.release/platform.running. */
  'platform.start': freezeScenario('platform.start', { kind:'platform-presence', submap:0x05, loopFrames:560, focus:'hero', targetSourceKeys:['mark:55'], targetSize:[32,16], useRoomEntry:true, scriptDirection:1, postEventFrames:36 }),
  'platform.release': freezeScenario('platform.release', { kind:'target-bomb', submap:0x10, loopFrames:200, focus:'target', targetSourceKeys:['mark:193'], targetSize:[24,16], heroWorld:[232,111], heroScreenY:119, scriptDirection:1, postEventFrames:36 }),
  'platform.stop': freezeScenario('platform.stop', { kind:'platform-presence', submap:0x05, loopFrames:560, focus:'hero', targetSourceKeys:['mark:55'], targetSize:[32,16], useRoomEntry:true, scriptDirection:1, postEventFrames:28 }),
  'platform.moving': freezeScenario('platform.moving', { kind:'platform-presence', submap:0x05, loopFrames:560, focus:'hero', targetSourceKeys:['mark:55'], targetSize:[32,16], useRoomEntry:true, scriptDirection:1, postEventFrames:36 }),
  'platform.running': freezeScenario('platform.running', { kind:'target-bomb', submap:0x10, loopFrames:220, focus:'target', targetSourceKeys:['mark:193'], targetSize:[24,16], heroWorld:[232,111], heroScreenY:119, scriptDirection:1, postEventFrames:36 }),
  'blockage.crumble': freezeScenario('blockage.crumble', { locationId:'castle-sm1c-paired-blockage', kind:'target-bomb', submap:0x1c, loopFrames:240, focus:'hero', targetSourceKeys:['mark:317','mark:318'], targetSize:[16,42], useRoomEntry:true, approachFrames:48, scriptDirection:1, postEventFrames:44 })
});

function directionMask(direction) { return Number(direction) < 0 ? CONTROL.LEFT : CONTROL.RIGHT; }
function oppositeMask(direction) { return Number(direction) < 0 ? CONTROL.RIGHT : CONTROL.LEFT; }

export function nativeActionPreviewFixture(actionId) {
  return SCENARIOS[actionId] || null;
}

export function nativeActionPreviewScenario(actionId) {
  return nativeActionPreviewFixture(actionId) || freezeScenario(actionId, { kind:'wait', submap:DEFAULT_SUBMAP, loopFrames:120, focus:'hero' });
}

export function nativeActionPreviewMapSelection(actionId, manualSubmapByAction = {}) {
  const fixture = nativeActionPreviewScenario(actionId);
  const raw = manualSubmapByAction && Object.prototype.hasOwnProperty.call(manualSubmapByAction, actionId)
    ? Number(manualSubmapByAction[actionId]) : null;
  const manual = Number.isInteger(raw) && raw >= 0 && raw <= 0x2e;
  return Object.freeze({
    actionId:String(actionId || ''),
    fixtureSubmap:Number(fixture.submap) >>> 0,
    effectiveSubmap:manual ? raw : Number(fixture.submap) >>> 0,
    manual,
    manualSubmap:manual ? raw : null,
    locationId:fixture.locationId
  });
}

export function nativeActionPreviewHeroScreenPoint(snapshot) {
  const native = snapshot?.collision?.native;
  if (!native?.playerActive) return null;
  const x = Number(native.playerScreenX);
  const y = Number(native.playerScreenY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  /* This is the same authoritative origin consumed by rdx_present_plan_rick().
   * Use it for crop tracking instead of the actor/event projection, which can
   * be absent for the first frame(s) after a scenario reset/teleport. The +1 X
   * keeps the inspector centred on the same physical Rick anchor formerly used
   * by heroMovementJuicePoint(), without inheriting its activation latency. */
  return { x:x + 1, y };
}

export function nativeActionPreviewControlMask(actionId, frame, direction = 1) {
  const scenario = nativeActionPreviewScenario(actionId), f = Math.max(0, Number(frame) | 0), scriptedDirection=Number(scenario.scriptDirection)<0?-1:Number(scenario.scriptDirection)>0?1:(Number(direction)<0?-1:1),move = directionMask(scriptedDirection);
  const approachFrames = scenario.approachFrames === null || scenario.approachFrames === undefined
    ? null
    : (Number.isFinite(Number(scenario.approachFrames)) ? Math.max(0, Number(scenario.approachFrames) | 0) : null);
  switch (scenario.kind) {
    case 'walk': return f < 54 ? move : 0;
    case 'turn': return f < 8 ? oppositeMask(direction) : f < 12 ? 0 : f < 20 ? move : 0;
    case 'jump': return f >= 8 && f < 14 ? (CONTROL.UP | move) : f < 42 ? move : 0;
    case 'well-fall': return f < 72 ? CONTROL.RIGHT : 0;
    case 'platform-presence': return f >= 2 && f < (approachFrames ?? 94) ? move : 0;
    case 'staff': return f >= 8 && f < 28 ? (CONTROL.FIRE | move) : 0;
    case 'gun': return f < 4 ? move : f >= 10 && f < 74 ? (CONTROL.FIRE | CONTROL.UP) : 0;
    case 'wall-gun': return f < 4 ? move : f >= 8 && f < 60 ? (CONTROL.FIRE | CONTROL.UP) : 0;
    case 'target-staff': {
      const walkFrames = approachFrames ?? 4;
      const fireStart = walkFrames + 2;
      const fireEnd = fireStart + 46;
      return f < walkFrames ? move : f >= fireStart && f < fireEnd ? (CONTROL.FIRE | move) : 0;
    }
    case 'target-gun': {
      const walkFrames = approachFrames ?? 4;
      const fireStart = walkFrames + 4;
      const fireEnd = fireStart + 62;
      return f < walkFrames ? move : f >= fireStart && f < fireEnd ? (CONTROL.FIRE | CONTROL.UP) : 0;
    }
    case 'crawl-approach': return f < 14 ? move : f >= 14 && f < 110 ? (CONTROL.DOWN | move) : 0;
    case 'bomb': return f === (scenario.plantFrame ?? 10) ? (CONTROL.FIRE | CONTROL.DOWN) : 0;
    case 'bomb-retreat': {
      const plantFrame = scenario.plantFrame ?? 10;
      return f === plantFrame ? (CONTROL.FIRE | CONTROL.DOWN) : f >= plantFrame + 4 && f < plantFrame + 34 ? move : 0;
    }
    case 'target-bomb': {
      const walkFrames = approachFrames ?? 4;
      const plantFrame = scenario.plantFrame ?? (walkFrames + 8);
      return f < walkFrames ? move : f === plantFrame ? (CONTROL.FIRE | CONTROL.DOWN) : 0;
    }
    case 'target-walk': {
      const walkStart = 4;
      const walkEnd = approachFrames === null ? 94 : Math.max(walkStart, approachFrames);
      return f >= walkStart && f < walkEnd ? move : 0;
    }
    default: return 0;
  }
}



function sourceKeyForObject(object) {
  const direct=object?.sources?.rdx?.sourceKey;if(direct)return String(direct);
  const component=(object?.components||[]).find(row=>row?.sourceKey);return component?.sourceKey?String(component.sourceKey):'';
}
function numericPair(value){return Array.isArray(value)&&value.length>=2&&Number.isFinite(Number(value[0]))&&Number.isFinite(Number(value[1]))?[Number(value[0]),Number(value[1])]:null;}
function explicitBounds(value){
  if(Array.isArray(value)&&value.length>=4)return {left:Number(value[0]),top:Number(value[1]),right:Number(value[0])+Number(value[2]),bottom:Number(value[1])+Number(value[3])};
  if(value&&typeof value==='object'){
    const left=Number(value.left??value.x),top=Number(value.top??value.y),width=Number(value.width),height=Number(value.height),right=Number(value.right),bottom=Number(value.bottom);
    if(Number.isFinite(left)&&Number.isFinite(top)&&Number.isFinite(right)&&Number.isFinite(bottom))return {left,top,right,bottom};
    if(Number.isFinite(left)&&Number.isFinite(top)&&Number.isFinite(width)&&Number.isFinite(height))return {left,top,right:left+width,bottom:top+height};
  }
  return null;
}
function objectBounds(object,scenario){
  const authored=explicitBounds(object?.effective?.visualBounds)||explicitBounds(object?.effective?.gameplayBounds);if(authored)return authored;
  const draw=numericPair(object?.states?.snapshot?.draw)||numericPair(object?.states?.simulated?.draw)||numericPair(object?.effective?.visualAnchor)||numericPair(object?.effective?.position);if(!draw)return null;
  const size=numericPair(scenario?.targetSize)||[32,21];return {left:draw[0],top:draw[1],right:draw[0]+Math.max(1,size[0]),bottom:draw[1]+Math.max(1,size[1])};
}
function unionBounds(rows){
  const valid=(rows||[]).filter(Boolean);if(!valid.length)return null;
  return {left:Math.min(...valid.map(row=>row.left)),top:Math.min(...valid.map(row=>row.top)),right:Math.max(...valid.map(row=>row.right)),bottom:Math.max(...valid.map(row=>row.bottom))};
}

/* Live-map actions need only reviewed world-space setup metadata from
 * ResolvedLevel. Rendering remains entirely native: this catalog deliberately
 * does not instantiate any editor rendering pipeline. */
export class NativeActionPreviewSceneCatalog {
  static async create(){
    const [romBytes,levels,manifest]=await Promise.all([fetchBytes('editor/Rick_Dangerous_DX_1.3x.bin'),fetchJson('levels/resolved/levels.json'),fetchJson('rdx_runtime_room_manifest.json')]);
    return new NativeActionPreviewSceneCatalog({romBytes,levels,manifest});
  }
  constructor({romBytes,levels,manifest}){this.romBytes=romBytes;this.levels=levels;this.manifest=manifest;}
  roomName(submap){return (this.manifest?.rooms||[]).find(row=>Number(row.submap)===Number(submap))?.submapName||`SM${Number(submap).toString(16).toUpperCase().padStart(2,'0')}`;}
  targetAudit(actionId,submap){
    const scenario=nativeActionPreviewScenario(actionId),keys=Array.isArray(scenario.targetSourceKeys)?scenario.targetSourceKeys:[];
    const room=(this.levels?.rooms||[]).find(row=>Number(row.submap)===Number(submap));
    if(!keys.length)return {required:false,roomFound:!!room,sourceKeys:[],missingSourceKeys:[],bounds:null};
    if(!room)return {required:true,roomFound:false,sourceKeys:[...keys],missingSourceKeys:[...keys],bounds:null};
    const objects=room?.layers?.semanticCorpus?.objects||[],byKey=new Map(objects.map(object=>[sourceKeyForObject(object),object]));
    const rows=keys.map(key=>({key:String(key),bounds:objectBounds(byKey.get(String(key)),scenario)}));
    const missingSourceKeys=rows.filter(row=>!row.bounds).map(row=>row.key);
    return {required:true,roomFound:true,sourceKeys:[...keys],missingSourceKeys,bounds:missingSourceKeys.length?null:unionBounds(rows.map(row=>row.bounds))};
  }
  targetBounds(actionId,submap){return this.targetAudit(actionId,submap).bounds;}
}

function targetUnion(bounds) {
  if (!Array.isArray(bounds) || !bounds.length) return null;
  const valid = bounds.filter(row => row && Number.isFinite(Number(row.left)) && Number.isFinite(Number(row.top)) && Number.isFinite(Number(row.right)) && Number.isFinite(Number(row.bottom)));
  if (!valid.length) return null;
  return {
    left:Math.min(...valid.map(row=>Number(row.left))), top:Math.min(...valid.map(row=>Number(row.top))),
    right:Math.max(...valid.map(row=>Number(row.right))), bottom:Math.max(...valid.map(row=>Number(row.bottom)))
  };
}

export class NativeActionPreviewScenarioRunner {
  constructor(preview) {
    if (!preview?.bridge) throw new Error('Native action preview requires the live xrick preview');
    this.preview = preview;
    this.bridge = preview.bridge;
    this.active = false;
    this.ready = false;
    this.phase = 'inactive';
    this.error = null;
    this.warning = null;
    this.warningCode = null;
    this.proofMisses = 0;
    this.proofMissReported = false;
    this.actionId = '';
    this.direction = 1;
    this.submap = DEFAULT_SUBMAP;
    this.frame = 0;
    this.lastEvent = null;
    this.targetBounds = null;
    this.stagedPose = null;
    this.readyFrameSerial = null;
    this.postEventFramesRemaining = 0;
    this.restartAfterPostEvent = false;
    this.restartPending = false;
    this.eventSeen = false;
    this.scenario = nativeActionPreviewScenario('');
  }

  activate({ actionId, direction = 1, submap = null, targetBounds = null } = {}) {
    this.actionId = String(actionId || '');
    this.direction = Number(direction) < 0 ? -1 : 1;
    this.scenario = nativeActionPreviewScenario(this.actionId);
    this.submap = submap !== null && submap !== undefined && Number.isInteger(Number(submap)) ? Number(submap) : Number(this.scenario.submap);
    this.targetBounds = targetBounds ? targetUnion([targetBounds]) : null;
    this.warning = null;
    this.warningCode = null;
    this.proofMisses = 0;
    this.proofMissReported = false;
    this.active = true;
    this.restart();
    return this.state();
  }

  deactivate() {
    this.active = false;
    this.ready = false;
    this.phase = 'inactive';
    this.error = null;
    this.warning = null;
    this.warningCode = null;
    this.proofMisses = 0;
    this.proofMissReported = false;
    this.preview.clearKeys?.();
    this.bridge.setDebugControl?.(0);
    return this.state();
  }

  #fail(message) {
    this.ready = false;
    this.phase = 'error';
    this.error = String(message || 'Native action preview setup failed');
    this.bridge.setDebugControl?.(0);
    throw new Error(this.error);
  }

  #warn(code, message) {
    this.warningCode = String(code || 'fixture-warning');
    this.warning = String(message || 'Native action preview fixture warning');
    return this.warning;
  }

  #nativeEntryPose(snapshot) {
    const native=snapshot?.collision?.native;
    const x=Number(native?.playerWorldX), y=Number(native?.playerWorldY);
    if(!native?.playerActive||!Number.isFinite(x)||!Number.isFinite(y))return null;
    const screenY=Number(native.playerScreenY);
    return {x:Math.round(x),y:Math.round(y),crawling:!!native.playerCrawling,screenY:Number.isFinite(screenY)?Math.round(screenY):null};
  }

  #resolveStagedPose(snapshot, { preferEntry = false } = {}) {
    const entry=this.#nativeEntryPose(snapshot);
    if((preferEntry||this.scenario.useRoomEntry)&&entry)return entry;
    const directional=this.direction<0?this.scenario.heroWorldByDirection?.left:this.scenario.heroWorldByDirection?.right;
    const reviewed=directional||this.scenario.heroWorld;
    if (reviewed) return {x:Math.round(Number(reviewed[0])),y:Math.round(Number(reviewed[1])),crawling:false};
    if (!this.targetBounds) return entry;
    const targetY=(this.targetBounds.top+this.targetBounds.bottom)*0.5;
    const distance=Math.max(8,Number(this.scenario.heroDistance||24));
    const side=this.scenario.heroSide==='left'?-1:this.scenario.heroSide==='right'?1:(this.direction<0?1:-1);
    const x=side<0?this.targetBounds.left-distance:this.targetBounds.right+distance;
    const anchorY=this.scenario.heroAnchorY==='top'?this.targetBounds.top:this.scenario.heroAnchorY==='center'?targetY:this.targetBounds.bottom;
    return {x:Math.round(x),y:Math.round(anchorY+Number(this.scenario.heroYOffset||0)),crawling:false};
  }

  #stagePose() {
    const snapshot=this.bridge.snapshot?.();
    const missingTarget=!!(this.scenario.targetSourceKeys?.length&&!this.targetBounds);
    if (missingTarget)
      this.#warn('missing-target', `Native action preview fixture ${this.scenario.locationId} is missing target ${this.scenario.targetSourceKeys.join(', ')} in SM${this.submap.toString(16).toUpperCase().padStart(2,'0')}; continuing from the native room entry`);
    const preserveNativeEntry=!!(missingTarget||this.scenario.useRoomEntry);
    const pose=this.#resolveStagedPose(snapshot,{preferEntry:missingTarget});
    if(!pose)this.#fail(`Native action preview fixture ${this.scenario.locationId} has no usable Hero pose or native room entry`);
    if(preserveNativeEntry){
      const desiredScreenY=Number.isFinite(Number(pose.screenY))?Math.round(Number(pose.screenY)):Math.round(Number(snapshot?.collision?.native?.playerScreenY));
      if(!Number.isFinite(desiredScreenY))this.#fail(`Native action preview fixture ${this.scenario.locationId} has no usable native entry camera anchor`);
      this.stagedPose={x:pose.x,y:pose.y,crawling:pose.crawling,desiredScreenY,preservedEntry:true};
      return this.stagedPose;
    }
    const directionalScreenY=this.direction<0?this.scenario.camera?.heroScreenYByDirection?.left:this.scenario.camera?.heroScreenYByDirection?.right;
    const desiredScreenY=Math.round(Number(directionalScreenY ?? this.scenario.camera?.heroScreenY ?? 150));
    if(typeof this.bridge.placePreviewPose!=='function')this.#fail('Native action preview requires the atomic native preview-pose ABI');
    if(!this.bridge.placePreviewPose(pose.x,pose.y,pose.crawling,desiredScreenY))
      this.#fail(`Native action preview native pose staging failed for ${this.actionId} in SM${this.submap.toString(16).toUpperCase().padStart(2,'0')} at ${pose.x},${pose.y}`);
    this.stagedPose={x:pose.x,y:pose.y,crawling:pose.crawling,desiredScreenY,preservedEntry:false};
    return this.stagedPose;
  }

  #validateReady(snapshot) {
    if(Number(snapshot?.submap)!==Number(this.submap))
      this.#fail(`Native action preview fixture ${this.scenario.locationId} loaded SM${Number(snapshot?.submap).toString(16).toUpperCase()} instead of SM${this.submap.toString(16).toUpperCase()}`);
    const native=snapshot?.collision?.native;
    if(!native?.playerActive)this.#fail(`Native action preview fixture ${this.scenario.locationId} has no active Hero`);
    const tolerance=4, x=Number(native.playerWorldX), y=Number(native.playerWorldY), screenY=Number(native.playerScreenY);
    if(!Number.isFinite(x)||!Number.isFinite(y)||Math.abs(x-this.stagedPose.x)>tolerance||Math.abs(y-this.stagedPose.y)>tolerance)
      this.#fail(`Native action preview fixture ${this.scenario.locationId} Hero staging drifted from ${this.stagedPose.x},${this.stagedPose.y} to ${x},${y}`);
    if(!Number.isFinite(screenY)||Math.abs(screenY-this.stagedPose.desiredScreenY)>tolerance)
      this.#fail(`Native action preview fixture ${this.scenario.locationId} camera staged Hero at screen Y ${screenY}, expected ${this.stagedPose.desiredScreenY}`);
    this.readyFrameSerial=Number(snapshot?.frameSerial ?? -1);
    this.ready=true;
    this.phase='ready';
    this.error=null;
    return true;
  }

  restart() {
    if (!this.active) return false;
    this.ready=false;this.phase='staging';this.error=null;this.readyFrameSerial=null;this.stagedPose=null;
    this.preview.clearKeys?.();
    this.bridge.setDebugControl?.(0);
    this.bridge.setFrontendPaused?.(true);
    if (!this.preview.selectSubmap(this.submap)) this.#fail(`Native action preview could not open SM${this.submap.toString(16).toUpperCase().padStart(2,'0')}`);
    this.bridge.setFrontendPaused?.(true);
    if (typeof this.bridge.restartCurrentLevelNow === 'function' && !this.bridge.restartCurrentLevelNow()) {
      this.bridge.resetCurrentLevel?.();
      this.bridge.debugForceBrowserFrame?.();
    }
    this.bridge.setDebugInvincible?.(true);
    this.preview.setEditorAutoRefill?.(true);
    /* Entry transitions and authored room setup are allowed to finish while the
     * preview is hidden. Staging happens afterwards, so none of these frames
     * can leak an old-room camera position into the inspector. */
    for(let i=0,n=Math.max(0,Number(this.scenario.preStageFrames||0)|0);i<n;i+=1){this.bridge.setDebugControl?.(0);this.bridge.debugForceBrowserFrame?.();}
    this.#stagePose();
    this.bridge.setDebugControl?.(0);
    this.bridge.debugForceBrowserFrame?.();
    this.#validateReady(this.bridge.snapshot?.());
    this.frame = 0;
    this.lastEvent = null;
    this.postEventFramesRemaining = 0;
    this.restartAfterPostEvent = false;
    this.restartPending = false;
    this.eventSeen = false;
    this.proofMissReported = false;
    return true;
  }

  step() {
    if (!this.active || !this.ready) return { advanced:false, wrapped:false, frame:this.frame, ready:this.ready, phase:this.phase, error:this.error, warning:this.warning };
    if (this.restartPending) {
      this.restart();
      return { advanced:false, wrapped:true, frame:this.frame, ready:this.ready, phase:this.phase };
    }
    const maxFrames=Math.max(1,Number(this.scenario.proof?.maxFrames||this.scenario.loopFrames||120)|0);
    if (this.frame >= maxFrames && !this.eventSeen && !this.proofMissReported) {
      this.proofMissReported = true;
      this.proofMisses += 1;
      this.#warn('proof-timeout', `Native action preview fixture ${this.scenario.locationId} did not emit ${this.scenario.proof?.eventType||this.actionId} within ${maxFrames} frames; preview will continue and replay`);
    }
    if (this.frame >= Number(this.scenario.loopFrames || maxFrames)) {
      this.restart();
      return { advanced:true, wrapped:true, frame:this.frame, ready:this.ready, phase:this.phase };
    }
    const mask = nativeActionPreviewControlMask(this.actionId, this.frame, this.direction);
    const stepped = stepNativeFrame(this.bridge, mask);
    const before = stepped.before, after = stepped.after;
    this.frame += 1;
    if(this.phase==='ready')this.phase='running';
    if (this.postEventFramesRemaining > 0) {
      this.postEventFramesRemaining -= 1;
      if (this.postEventFramesRemaining <= 0 && this.restartAfterPostEvent) {this.restartPending = true;this.phase='restart';}
    }
    return { advanced:after !== before, wrapped:false, frame:this.frame, mask, ready:this.ready, phase:this.phase, postEventFramesRemaining:this.postEventFramesRemaining };
  }

  noteEvent(event) {
    if (event?.type !== this.scenario.proof?.eventType) return;
    if(this.warningCode==='proof-timeout'){this.warning=null;this.warningCode=null;}
    this.lastEvent = { ...event, scenarioFrame:this.frame };
    if (!this.eventSeen) {
      this.eventSeen = true;
      this.phase='post-event';
      if (Number(this.scenario.postEventFrames || 0) > 0) {
        this.postEventFramesRemaining = Number(this.scenario.postEventFrames || 0) | 0;
        this.restartAfterPostEvent = !!this.scenario.restartAfterPostEvent;
      }
    }
  }

  captureState() {
    return {
      active:this.active, ready:this.ready, phase:this.phase, error:this.error, warning:this.warning, warningCode:this.warningCode,
      proofMisses:this.proofMisses, proofMissReported:this.proofMissReported, actionId:this.actionId, direction:this.direction, submap:this.submap,
      frame:this.frame, lastEvent:this.lastEvent ? { ...this.lastEvent } : null, targetBounds:this.targetBounds ? { ...this.targetBounds } : null,
      stagedPose:this.stagedPose ? { ...this.stagedPose } : null, readyFrameSerial:this.readyFrameSerial, postEventFramesRemaining:this.postEventFramesRemaining,
      restartAfterPostEvent:this.restartAfterPostEvent, restartPending:this.restartPending, eventSeen:this.eventSeen
    };
  }

  restoreState(saved) {
    if (!saved || typeof saved !== 'object') throw new Error('Native action preview runner checkpoint is invalid');
    this.active=!!saved.active; this.ready=!!saved.ready; this.phase=String(saved.phase || 'inactive'); this.error=saved.error == null ? null : String(saved.error);
    this.warning=saved.warning == null ? null : String(saved.warning); this.warningCode=saved.warningCode == null ? null : String(saved.warningCode);
    this.proofMisses=Number(saved.proofMisses || 0) | 0; this.proofMissReported=!!saved.proofMissReported; this.actionId=String(saved.actionId || '');
    this.direction=Number(saved.direction)<0?-1:1; this.submap=Number(saved.submap ?? DEFAULT_SUBMAP) >>> 0; this.scenario=nativeActionPreviewScenario(this.actionId);
    this.frame=Number(saved.frame || 0) | 0; this.lastEvent=saved.lastEvent ? { ...saved.lastEvent } : null; this.targetBounds=saved.targetBounds ? { ...saved.targetBounds } : null;
    this.stagedPose=saved.stagedPose ? { ...saved.stagedPose } : null; this.readyFrameSerial=saved.readyFrameSerial ?? null;
    this.postEventFramesRemaining=Number(saved.postEventFramesRemaining || 0) | 0; this.restartAfterPostEvent=!!saved.restartAfterPostEvent;
    this.restartPending=!!saved.restartPending; this.eventSeen=!!saved.eventSeen; this.bridge.setDebugControl?.(0); this.bridge.setFrontendPaused?.(true);
    return this.state();
  }

  saveCheckpoint(slot) {
    return saveNativeSceneCheckpoint(this.preview, slot, this.captureState());
  }

  restoreCheckpoint(checkpoint) {
    restoreNativeSceneCheckpoint(this.preview, checkpoint);
    this.restoreState(checkpoint.runner);
    return this.state();
  }

  discardCheckpoint(checkpoint) {
    discardNativeSceneCheckpoint(this.preview, checkpoint);
  }

  targetScreenPoint(snapshot) {
    if (!this.targetBounds) return null;
    const native = snapshot?.collision?.native;
    if (!native?.playerActive) return null;
    const dx = Number(native.playerScreenX) - Number(native.playerWorldX);
    const dy = Number(native.playerScreenY) - Number(native.playerWorldY);
    return {
      x:(this.targetBounds.left + this.targetBounds.right) * 0.5 + dx,
      y:(this.targetBounds.top + this.targetBounds.bottom) * 0.5 + dy
    };
  }

  targetEntitySlot(snapshot) {
    const marks=(this.scenario?.targetSourceKeys||[]).map(key=>/^mark:(\d+)$/.exec(String(key))?.[1]).filter(Boolean).map(Number);
    if(!marks.length)return null;
    const entity=(snapshot?.entities||[]).find(row=>marks.includes(Number(row.mark))&&Number(row.n)>0&&Number(row.n)<=0xfe);
    return entity ? Number(entity.slot) : null;
  }

  state() {
    return {
      active:this.active, ready:this.ready, phase:this.phase, error:this.error, warning:this.warning, warningCode:this.warningCode, proofMisses:this.proofMisses,
      actionId:this.actionId, direction:this.direction, submap:this.submap,
      frame:this.frame, scenario:{ ...this.scenario }, targetBounds:this.targetBounds ? { ...this.targetBounds } : null,
      stagedPose:this.stagedPose ? { ...this.stagedPose } : null, readyFrameSerial:this.readyFrameSerial,
      lastEvent:this.lastEvent ? { ...this.lastEvent } : null, postEventFramesRemaining:this.postEventFramesRemaining,
      restartPending:this.restartPending, frameMs:FRAME_MS
    };
  }
}

export const NATIVE_ACTION_PREVIEW_FRAME_MS = FRAME_MS;
