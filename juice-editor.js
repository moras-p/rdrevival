import {
  ACTIONS,
  DEFAULT_PROFILE,
  JUICE_SCHEMA,
  MAX_POSE_EMITTER_BINDINGS,
  JUICE_STORAGE_KEY,
  PERFORMANCE_PRESETS,
  cloneProfile,
  estimateActionCost,
  normalizeProfile,
  profileWorstCaseCost
} from './rdx/src/juice/juice-protocol.js';
import { JUICE_SIM_FRAME_SECONDS, JuiceRuntime, entityAudioCategory, particleEmitterDimensions, particleEmitterSpawnOffset, poseEmitterParticleDirection, poseEmitterCadenceSeconds, poseEmitterParticleSample, restoreAboveActorDepth } from './rdx/src/juice/juice-runtime.js';
import { PRESENTATION_LAYERS, PRESENTATION_LAYER_BITS, PRESENTATION_LAYER_MASK_PRESETS, normalizePresentationLayerSelection } from './rdx/src/juice/presentation-layer-mask.js';
import { copyActionClipboardPayload, copyLiveEffectClipboardPayload, parseActionClipboardText, pasteActionClipboardPayload, pasteEffectClipboardPayload } from './rdx/src/juice/juice-clipboard.js';
import {
  ACTION_TEMPLATES,
  EFFECT_TEMPLATES,
  GAME_STYLE_TEMPLATES,
  applyActionTemplate,
  applyEffectTemplate,
  applyGameStyleTemplate
} from './rdx/src/juice/juice-templates.js';
import { actionCompatibility, compatibilityBadge, compatibilitySummary, effectCompatibility, motionTrailCompatibility, profileCompatibility } from './rdx/src/juice/juice-compatibility.js';
import { XrickLivePreview, LIVE_WIDTH, LIVE_HEIGHT, NATIVE_SFX_IDS, CONTROL } from './rdx/src/juice/xrick-live-preview.js';
import { drawMapTransitionMask, transitionPerformanceImpact } from './rdx/src/juice/map-transition.js';
import { CLASSIC_HERO_FRAME_META, classicHeroFrameCanvas } from './rdx/src/juice/hero-frames.js';
import { actionPreviewClassicFrames, actionPreviewRdxPn, actionPreviewFrameMs, actionPreviewEventOffset, actionPreviewStoryboard, actionPreviewTriggerMoments, actionPreviewLoopMs, actionPreviewPoseEmitterBurstMoments, actionPreviewIsolatedProfile } from './rdx/src/juice/action-preview.js';
import { classicPreviewSpriteCanvas, CLASSIC_PREVIEW_SPRITES } from './rdx/src/juice/classic-preview-sprites.js';
import { buildPoseEmitterActionExport, importPoseEmitterActionPayload } from './rdx/src/juice/pose-emitter-io.js';
import { RdxRom } from './rdx/src/core/rom.js';
import { RdxSpriteDecoder } from './rdx/src/core/sprite.js';
import { PaletteRegistry } from './rdx/src/data/palettes.js';
import { cd32AugmentedRdxFrame } from './rdx/src/runtime/cd32-augmentation.js';
import { loadRememberedRdxRom, rememberRdxRom, RDX_ROM_FILENAME } from './rdx/src/runtime/rom-store.js';
import { revivalBulletFrame } from './rdx/src/runtime/revival-bullet.js';
import { revivalDynamiteFrame } from './rdx/src/runtime/revival-dynamite.js';
import { REVIVAL_DYNAMITE_EXPLOSION_VARIANT_COUNT, REVIVAL_DYNAMITE_ROLLING_VARIANT_COUNT, revivalRollingExplosionFrame } from './rdx/src/runtime/revival-dynamite.js';
import { EXPLOSION_PREVIEW_DEFAULT_PATH, EXPLOSION_PREVIEW_RENDER_PLANES, EXPLOSION_PREVIEW_SEQUENCE_FAMILIES, EXPLOSION_PREVIEW_SPAWN_MODES, EXPLOSION_PREVIEW_VARIANT_POLICIES, explosionPreviewDiagnostics, explosionPreviewTimeline, normalizeExplosionPreviewConfig } from './rdx/src/juice/explosion-path-preview.js';
import { installWebMcpTools } from './rdx/src/agent/webmcp.js';
import { DEFAULT_PLATFORM_CURVE, normalizePlatformCurveTuning, platformCurveControls, platformCurveModeValue, platformCurveProgress } from './rdx/src/juice/platform-motion-curve.js';
import { NativeActionPreviewSceneCatalog, NativeActionPreviewScenarioRunner, NATIVE_ACTION_PREVIEW_FRAME_MS, nativeActionPreviewHeroScreenPoint, nativeActionPreviewMapSelection, nativeActionPreviewScenario } from './rdx/src/juice/native-action-preview.js';
import { GAME_JUICE_EFFECT_KEYS, actionEffectSchemas, actionRecipeRevision, actionRecipeSummary, compactActionRecipeDelta, diffActionRecipes, filterActionRecipe, normalizeActionWebMcpPatch } from './rdx/src/juice/juice-webmcp.js';
import { buildProductionPresetPatch, capturePresetProvenance, productionChangedActionIds, productionEditorBaselineRecipe, productionPresetDescriptor, productionPresetForEditorStyle } from './rdx/src/juice/juice-production-export.js';

const $ = (id) => document.getElementById(id);
const AUTO_RDX_ROM_NAME = RDX_ROM_FILENAME;
const AUTO_RDX_ROM_PATHS = Object.freeze([`./resources/${AUTO_RDX_ROM_NAME}`, `../resources/${AUTO_RDX_ROM_NAME}`]);
const canvasA = $('arena-a'), canvasB = $('arena-b');
const ctxA = canvasA.getContext('2d', { alpha: false, desynchronized: true });
const ctxB = canvasB.getContext('2d', { alpha: false, desynchronized: true });
ctxA.imageSmoothingEnabled = ctxB.imageSmoothingEnabled = false;

const saved = (() => { try { return JSON.parse(localStorage.getItem(JUICE_STORAGE_KEY) || 'null'); } catch { return null; } })();
const JUICE_EDITOR_STATE_VERSION = 7;
const savedGameplayTuning = saved?.appVersion === '2.1.79' && Number(saved?.gameplayTuning?.groundSnap) === 1
  ? { ...saved.gameplayTuning, groundSnap: 0 }
  : saved?.gameplayTuning;
/* v2.1.70 and older editor state can contain accidental zero/null gains from
 * stale browser drafts. Zero is not the mute authority (the Enabled switch is),
 * so migrate those legacy values once. State version 2 preserves deliberate
 * zero gain edits made from this release onward. */
function migrateLegacyAudioGains(raw) {
  if (!raw || typeof raw !== 'object' || Number(saved?.stateVersion || 0) >= JUICE_EDITOR_STATE_VERSION) return raw;
  const next = cloneProfile(raw);
  for (const action of ACTIONS) {
    const audio = next.actions?.[action.id]?.audio;
    if (!audio) continue;
    const gain = Number(audio.gain);
    if (!Number.isFinite(gain) || gain <= 0) audio.gain = Number(DEFAULT_PROFILE.actions[action.id]?.audio?.gain ?? 1);
    /* v2.1.71 still inherited the old “extra juice accent” meaning of the
     * audio.enabled bit, leaving some real game SFX (gun/explosion) disabled.
     * Audible Effects now owns those native logical voices, so migrate them on
     * once; v2.1.72+ preserves an explicit user disable. */
    if (['player.step','player.jump','player.land','weapon.fire','bullet.wall_hit','dynamite.place','dynamite.explode','pickup.collect','ammo.collect','points.collect'].includes(action.id)) audio.enabled = true;
  }
  return next;
}
const DEFAULT_GAMEPLAY_TUNING = Object.freeze({
  walkSpeed: 2, coyoteFrames: 3, jumpBufferFrames: 0, ladderTopEntryTolerance: 1, jumpTakeoff: 5.5,
  gravity: 0.5, apexGravityPercent: 100, jumpReleasePercent: 100,
  maxFall: 8, ceilingCorrection: 0, groundSnap: 0, fallBounceMinHeight: 48,
  explosionNearBounceLift: 1.5, ...DEFAULT_PLATFORM_CURVE
});
function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}
function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}
let gameplayTuning = {
  walkSpeed: clampInteger(savedGameplayTuning?.walkSpeed, 1, 4, DEFAULT_GAMEPLAY_TUNING.walkSpeed),
  coyoteFrames: clampInteger(savedGameplayTuning?.coyoteFrames, 0, 8, DEFAULT_GAMEPLAY_TUNING.coyoteFrames),
  jumpBufferFrames: clampInteger(savedGameplayTuning?.jumpBufferFrames, 0, 8, DEFAULT_GAMEPLAY_TUNING.jumpBufferFrames),
  ladderTopEntryTolerance: clampInteger(savedGameplayTuning?.ladderTopEntryTolerance, 0, 6, DEFAULT_GAMEPLAY_TUNING.ladderTopEntryTolerance),
  jumpTakeoff: clampNumber(savedGameplayTuning?.jumpTakeoff, 2, 8, DEFAULT_GAMEPLAY_TUNING.jumpTakeoff),
  gravity: clampNumber(savedGameplayTuning?.gravity, 0.125, 2, DEFAULT_GAMEPLAY_TUNING.gravity),
  apexGravityPercent: clampInteger(savedGameplayTuning?.apexGravityPercent, 25, 150, DEFAULT_GAMEPLAY_TUNING.apexGravityPercent),
  jumpReleasePercent: clampInteger(savedGameplayTuning?.jumpReleasePercent, 25, 100, DEFAULT_GAMEPLAY_TUNING.jumpReleasePercent),
  maxFall: clampNumber(savedGameplayTuning?.maxFall, 2, 16, DEFAULT_GAMEPLAY_TUNING.maxFall),
  ceilingCorrection: clampInteger(savedGameplayTuning?.ceilingCorrection, 0, 6, DEFAULT_GAMEPLAY_TUNING.ceilingCorrection),
  groundSnap: clampInteger(savedGameplayTuning?.groundSnap, 0, 4, DEFAULT_GAMEPLAY_TUNING.groundSnap),
  fallBounceMinHeight: clampInteger(savedGameplayTuning?.fallBounceMinHeight, 0, 192, DEFAULT_GAMEPLAY_TUNING.fallBounceMinHeight),
  explosionNearBounceLift: clampNumber(savedGameplayTuning?.explosionNearBounceLift, .25, 5, DEFAULT_GAMEPLAY_TUNING.explosionNearBounceLift),
  ...normalizePlatformCurveTuning(savedGameplayTuning || DEFAULT_GAMEPLAY_TUNING)
};
let profile = normalizeProfile(migrateLegacyAudioGains(saved?.profileB || saved?.profile) || DEFAULT_PROFILE); // B is always the live editable profile.
// v2 editor workflow: old saved A profiles do not silently become the baseline. A starts raw/juice-off unless this build explicitly saved an accepted baseline.
let baselineMode = saved?.baselineMode === 'accepted' ? 'accepted' : 'raw';
let profileA = normalizeProfile(migrateLegacyAudioGains(saved?.profileA) || DEFAULT_PROFILE);
let profileB = normalizeProfile(migrateLegacyAudioGains(saved?.profileB) || profile);
let customPresets = Array.isArray(saved?.customPresets) ? saved.customPresets.filter(item=>item&&typeof item==='object'&&item.id&&item.profile).map(item=>{const { gameplayFeel:_legacyGameplayFeel, ...rest }=item;return { ...rest, profile:normalizeProfile(item.profile) };}) : [];
let activeCustomPresetId = typeof saved?.activeCustomPresetId === 'string' ? saved.activeCustomPresetId : '';
let selectedGameStyleKey = typeof saved?.selectedGameStyleKey === 'string' ? saved.selectedGameStyleKey : '';
let activePresetProvenance = saved?.activePresetProvenance && typeof saved.activePresetProvenance === 'object' ? cloneProfile(saved.activePresetProvenance) : null;
if(!activePresetProvenance){
  const [kind,id]=String(selectedGameStyleKey||'').split(':'),preset=kind==='builtin'?productionPresetForEditorStyle(id):null;
  const presetMatches=!!preset&&ACTIONS.every(action=>{const baseline=productionEditorBaselineRecipe(preset.key,action.id);return baseline&&actionRecipeRevision(profile.actions[action.id])===actionRecipeRevision(baseline);});
  activePresetProvenance=capturePresetProvenance({source:kind==='custom'?'custom':presetMatches?'builtin':kind==='builtin'?'legacy':'default',editorStyleId:presetMatches?preset.editorStyleId:null,productionKey:presetMatches?preset.key:null,libretroValue:presetMatches?preset.libretroValue:null,label:presetMatches?preset.label:null,profile});
}
let effectClipboard = null;
let actionClipboard = null;
let selectedAction = saved?.selectedAction && ACTIONS.some(a => a.id === saved.selectedAction) ? saved.selectedAction : 'player.land';
let actionPreviewDirection = Number(saved?.actionPreviewDirection) < 0 ? -1 : 1;
const ACTION_PREVIEW_SOURCE_VALUES = Object.freeze(['live','synthetic']);
const ACTION_PREVIEW_MAX_SUBMAP = 0x2e;
const ACTION_PREVIEW_LIVE_ZOOM_VALUES = Object.freeze([1,2,4]);
const ACTION_PREVIEW_LIVE_DEFAULT_CROP_SCALE = 1;
let actionPreviewSource = saved?.actionPreviewSource === 'synthetic' ? 'synthetic' : 'live';
let tuningActionPreviewSource = saved?.tuningActionPreviewSource === 'synthetic' ? 'synthetic' : actionPreviewSource;
let actionsWorkflow = saved?.actionsWorkflow === 'playtest' ? 'playtest' : saved?.actionsWorkflow === 'tune' ? 'tune' : (actionPreviewSource === 'live' ? 'tune' : 'playtest');
if (actionsWorkflow === 'playtest' && actionPreviewSource === 'live') actionPreviewSource = 'synthetic';
let actionPreviewManualSubmapByAction = Object.fromEntries(Object.entries(saved?.actionPreviewManualSubmapByAction || {}).filter(([actionId,value])=>ACTIONS.some(action=>action.id===actionId)&&Number.isInteger(Number(value))&&Number(value)>=0&&Number(value)<=ACTION_PREVIEW_MAX_SUBMAP).map(([actionId,value])=>[actionId,Number(value)]));
/* Migrate the former shared map value only when it differs from this action's
 * reviewed fixture. Equal values were the old auto-synced default, not a user
 * override. */
if(!Object.prototype.hasOwnProperty.call(actionPreviewManualSubmapByAction,selectedAction)&&Number.isInteger(Number(saved?.actionPreviewLiveSubmap))){const legacy=Math.max(0,Math.min(ACTION_PREVIEW_MAX_SUBMAP,Number(saved.actionPreviewLiveSubmap))),fixture=Number(nativeActionPreviewScenario(selectedAction)?.submap??0x02);if(legacy!==fixture)actionPreviewManualSubmapByAction[selectedAction]=legacy;}
let actionPreviewLiveZoom = ACTION_PREVIEW_LIVE_ZOOM_VALUES.includes(Number(saved?.actionPreviewLiveZoom)) ? Number(saved.actionPreviewLiveZoom) : ACTION_PREVIEW_LIVE_DEFAULT_CROP_SCALE;
const normalizeActionPreviewWeaponSource = value => value === 'classic' ? 'classic' : 'revival';
let actionPreviewBulletSource = normalizeActionPreviewWeaponSource(saved?.actionPreviewBulletSource);
let actionPreviewDynamiteSource = normalizeActionPreviewWeaponSource(saved?.actionPreviewDynamiteSource);
let actionPreviewNearMissAnchor = { x:clampInteger(saved?.actionPreviewNearMissAnchor?.x,0,31,16), y:clampInteger(saved?.actionPreviewNearMissAnchor?.y,0,20,8) };
let explosionPreviewConfig = normalizeExplosionPreviewConfig(saved?.explosionPreviewConfig);
let actionPreviewGeneration = 0;
let selectedAudioAction = saved?.selectedAudioAction && ACTIONS.some(a => a.id === saved.selectedAudioAction) ? saved.selectedAudioAction : selectedAction;
let selectedAudioSource = saved?.selectedAudioSource === 'classic' ? 'classic' : 'cd32';
let audioAffectsLiveEdits = saved?.audioAffectsLiveEdits !== false;
let editorMuted = saved?.editorMuted === true;
let autoReviveSameSpot = saved?.autoReviveSameSpot !== false;
let selectedEntityAudioType = typeof saved?.selectedEntityAudioType === 'string' && !/^\d+$/.test(saved.selectedEntityAudioType) ? saved.selectedEntityAudioType : 'collectible';
let entitySoundMapping = {};
let selectedScreen = ['actions','audio','entity-audio','transitions','resources','movement'].includes(saved?.selectedScreen) ? saved.selectedScreen : 'actions';
const JUICE_LAYOUT_STORAGE_KEY = `${JUICE_STORAGE_KEY}.workspace-layout.v1`;
const savedWorkspaceLayout = (() => { try { return JSON.parse(localStorage.getItem(JUICE_LAYOUT_STORAGE_KEY) || '{}'); } catch { return {}; } })();
let transitionAnimationFrame = 0;
let transitionEntryPreviewArmed = false;
let resourcePreviewState = { bullets: 6, dynamite: 6, score: 0 };
let resourceFillTimers = [];
let audioAuditionTimer = 0;
let audioReferenceTimer = 0;
let audioReferenceElement = null;
let audioRouteGeneration = 0;
let audioRouteArmedAction = '';
let gameplayAudioUnlocked = false;
let gameplayAudioUnlockPromise = null;
let runtimeA = new JuiceRuntime(profileA);
let runtimeB = new JuiceRuntime(profile);
let hudPreviewRuntime = new JuiceRuntime(profile);
hudPreviewRuntime.setAudioEnabled(false);
let preview = null;
let slowMoEnabled = false;
let latestSnapshot = null;
let controlActive = false;
let lastTime = performance.now();
let lastMetricsUpdate = 0;
let lastSave = 0;
let eventRows = [];
let benchmark = null;
let lastCapturedSerial = -1;
let captureInProgress = false;
let pendingCaptureEvents = [];
let effectClockMs = 0;
let holdASnapshot = null, holdBSnapshot = null;
let latestForegroundMask = null;
let latestPresentationLayers = null;
let actionPreviewPresentationSolo = '';
let nativeActionPreviewSceneCatalog = null;
let nativeActionPreviewRunner = null;
let nativeActionPreviewCaptured = null;
let nativeActionPreviewRuntime = null;
let nativeActionPreviewRuntimeAction = '';
let nativeActionPreviewLastEvent = null;
let nativeActionPreviewStepElapsedMs = 0;
let nativeActionPreviewWebMcpPaused = false;
let suppressCaptureEventLog = false;
const ACTION_VARIANT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,39}$/;
const normalizeStoredActionVariants = raw => Object.fromEntries(Object.entries(raw || {}).filter(([actionId,variants])=>ACTIONS.some(action=>action.id===actionId)&&variants&&typeof variants==='object'&&!Array.isArray(variants)).map(([actionId,variants])=>[actionId,Object.fromEntries(Object.entries(variants).filter(([name,value])=>ACTION_VARIANT_NAME_RE.test(name)&&value?.recipe&&typeof value.recipe==='object').map(([name,value])=>{const candidate=cloneProfile(profile);candidate.actions[actionId]=value.recipe;const recipe=normalizeProfile(candidate).actions[actionId];return [name,{recipe,recipeRevision:actionRecipeRevision(recipe)}];}))]));
let actionVariantsByAction = normalizeStoredActionVariants(saved?.actionVariantsByAction);
const actionUndoByAction = new Map();
let gameplayPreviewSubmap = Number.isInteger(Number(saved?.gameplayPreviewSubmap)) ? Number(saved.gameplayPreviewSubmap) : null;
let gameplayPreviewPresentation = saved?.gameplayPreviewPresentation === 'rdx' ? 'rdx' : 'classic';
function actionPreviewMapChoice(actionId=selectedAction){return nativeActionPreviewMapSelection(actionId,actionPreviewManualSubmapByAction);}
function actionPreviewRecommendedLiveSubmap(actionId=selectedAction){return actionPreviewMapChoice(actionId).fixtureSubmap;}
function actionPreviewEffectiveLiveSubmap(actionId=selectedAction){return actionPreviewMapChoice(actionId).effectiveSubmap;}
function actionPreviewSetManualLiveSubmap(actionId,submap){const value=Math.max(0,Math.min(ACTION_PREVIEW_MAX_SUBMAP,Number(submap)));if(!Number.isInteger(value))return false;actionPreviewManualSubmapByAction={...actionPreviewManualSubmapByAction,[actionId]:value};return true;}
function actionPreviewResetManualLiveSubmap(actionId=selectedAction){if(!Object.prototype.hasOwnProperty.call(actionPreviewManualSubmapByAction,actionId))return false;const next={...actionPreviewManualSubmapByAction};delete next[actionId];actionPreviewManualSubmapByAction=next;return true;}
function actionPreviewScenarioTargetBounds(actionId=selectedAction,submap=actionPreviewEffectiveLiveSubmap(actionId)){return nativeActionPreviewSceneCatalog?.targetBounds(actionId,submap)||null;}
function actionPreviewLiveCropScale(_actionId=selectedAction){return ACTION_PREVIEW_LIVE_ZOOM_VALUES.includes(Number(actionPreviewLiveZoom))?Number(actionPreviewLiveZoom):ACTION_PREVIEW_LIVE_DEFAULT_CROP_SCALE;}
function actionPreviewLiveCropWindow(actionId=selectedAction,focus={x:LIVE_WIDTH/2,y:LIVE_HEIGHT/2},scaleOverride=null){
  const scale=ACTION_PREVIEW_LIVE_ZOOM_VALUES.includes(Number(scaleOverride))?Number(scaleOverride):actionPreviewLiveCropScale(actionId),cropWidth=Math.max(1,Math.floor(LIVE_WIDTH/scale)),cropHeight=Math.max(1,Math.floor(LIVE_HEIGHT/scale));
  return {scale,cropWidth,cropHeight,left:Math.max(0,Math.min(LIVE_WIDTH-cropWidth,Math.round(Number(focus.x||0)-cropWidth/2))),top:Math.max(0,Math.min(LIVE_HEIGHT-cropHeight,Math.round(Number(focus.y||0)-cropHeight/2)))};
}
function nativeActionPreviewOwned(){return actionPreviewSource==='live'&&!!nativeActionPreviewRunner?.active;}
function syncNativePreviewOwnershipUi(){
  const owned=nativeActionPreviewOwned(),arena=$('arena-frame'),notice=$('native-preview-owner-note');
  document.body.classList.toggle('native-action-preview-active',owned);
  if(arena)arena.hidden=owned;
  if(notice){notice.hidden=!owned;notice.textContent=owned?'Native runtime is driving the selected Live map action. Use Playtest A/B above to return to gameplay.':'';}
}
function startNativeActionPreviewScenario({restart=true}={}){
  if(!preview||actionPreviewSource!=='live')return false;
  setControlActive(false);
  if(!nativeActionPreviewRunner?.active)gameplayPreviewPresentation=preview.presentation==='rdx'?'rdx':'classic';
  if(preview.rdxLoaded&&preview.presentation!=='rdx'){preview.setPresentation('rdx',{forceFrame:false});const presentationSelect=$('presentation-source');if(presentationSelect)presentationSelect.value='rdx';}
  if(!nativeActionPreviewRunner)nativeActionPreviewRunner=new NativeActionPreviewScenarioRunner(preview);
  const mapChoice=actionPreviewMapChoice(selectedAction),targetBounds=actionPreviewScenarioTargetBounds(selectedAction,mapChoice.effectiveSubmap);
  nativeActionPreviewCaptured=null;nativeActionPreviewLastEvent=null;nativeActionPreviewStepElapsedMs=0;
  if(restart||!nativeActionPreviewRunner.active||nativeActionPreviewRunner.actionId!==selectedAction||Number(nativeActionPreviewRunner.submap)!==Number(mapChoice.effectiveSubmap)){
    try{nativeActionPreviewRunner.activate({actionId:selectedAction,direction:actionPreviewDirection,submap:mapChoice.effectiveSubmap,targetBounds});}
    catch(error){const status=$('engine-live-status');if(status)status.textContent=`Action preview error · ${error.message}`;console.error(error);syncNativePreviewOwnershipUi();return false;}
  }
  syncNativePreviewOwnershipUi();
  return !!nativeActionPreviewRunner.ready;
}
function resetGameplayPreviewAfterLive(){
  if(!preview)return;
  nativeActionPreviewRunner?.deactivate();nativeActionPreviewCaptured=null;nativeActionPreviewLastEvent=null;nativeActionPreviewRuntime=null;nativeActionPreviewRuntimeAction='';nativeActionPreviewStepElapsedMs=0;nativeActionPreviewWebMcpPaused=false;
  preview.clearKeys();preview.bridge.setDebugControl?.(0);
  const target=Number.isInteger(Number(gameplayPreviewSubmap))?Number(gameplayPreviewSubmap):Number($('level-select')?.value ?? preview.bridge.submap());
  gameplayPreviewSubmap=target;
  preview.selectSubmap(target);preview.resetLevel();preview.setInvincible($('invincible')?.checked!==false);preview.setEditorAutoRefill($('infinite-resources')?.checked!==false);preview.setEditorAutoRevive(autoReviveSameSpot);if(gameplayPreviewPresentation==='classic'||preview.rdxLoaded)preview.setPresentation(gameplayPreviewPresentation,{forceFrame:false});const presentationSelect=$('presentation-source');if(presentationSelect)presentationSelect.value=gameplayPreviewPresentation;preview.bridge.setFrontendPaused?.(false);preview.bridge.resumeBrowserLoop?.();preview.bridge.forceBrowserFrame?.();
  runtimeA.resetTransient();runtimeB.resetTransient();lastCapturedSerial=-1;holdASnapshot=null;holdBSnapshot=null;
  syncNativePreviewOwnershipUi();
}
function setActionPreviewSource(source,{rebuild=true,resetGameplay=true,liveSubmap=null}={}){
  const next=source==='synthetic'?'synthetic':'live',wasLive=actionPreviewSource==='live',explicitLiveSubmap=liveSubmap!==null&&liveSubmap!==undefined&&Number.isInteger(Number(liveSubmap))?Number(liveSubmap):null;
  if(next===actionPreviewSource&&!(next==='live'&&(!nativeActionPreviewRunner?.active||explicitLiveSubmap!==null)))return false;
  actionPreviewSource=next;
  if(next==='live'){tuningActionPreviewSource='live';actionsWorkflow='tune';}
  else if(actionsWorkflow==='tune')tuningActionPreviewSource='synthetic';
  if(next==='live'){
    if(explicitLiveSubmap!==null)actionPreviewSetManualLiveSubmap(selectedAction,explicitLiveSubmap);
    startNativeActionPreviewScenario({restart:true});
  }else if(wasLive&&resetGameplay)resetGameplayPreviewAfterLive();
  else syncNativePreviewOwnershipUi();
  syncActionsWorkflowUi();
  if(rebuild)buildInspector();saveLocal(true);updateLiveDocs();return true;
}
const toolDrawerState = new Map(); // only chevron buttons mutate drawer state; default is collapsed.

const holdA = document.createElement('canvas'), holdB = document.createElement('canvas');
holdA.width = holdB.width = LIVE_WIDTH; holdA.height = holdB.height = LIVE_HEIGHT;
const holdACtx = holdA.getContext('2d', { alpha: false }), holdBCtx = holdB.getContext('2d', { alpha: false });
holdACtx.imageSmoothingEnabled = holdBCtx.imageSmoothingEnabled = false;

const RDX_HERO_PN_SPECS = Object.freeze([
  { pn:0x5b, label:'Shoot right', direction:'right' }, { pn:0x5c, label:'Shoot left', direction:'left' },
  { pn:0x5d, label:'Ladder / neutral', direction:'neutral' },
  { pn:0x5e, label:'Crawl right', direction:'right' }, { pn:0x5f, label:'Crawl left', direction:'left' },
  { pn:0x60, label:'Death / fall', direction:'neutral' },
  { pn:0x61, label:'Jump right', direction:'right' }, { pn:0x62, label:'Jump left', direction:'left' },
  { pn:0x63, label:'Stand right', direction:'right' }, { pn:0x64, label:'Stand left', direction:'left' },
  { pn:0x6b, label:'Walk right', direction:'right' }, { pn:0x6c, label:'Walk left', direction:'left' }
]);
let rdxPoseAuthoring = { decoder:null, palettes:null, cache:new Map(), utilityCache:new Map() };
const rdxFramePlacementByCanvas = new WeakMap();
const actionPreviewAssetCanvasCache = new Map();
const actionPreviewOpaqueBoundsCache = new WeakMap();
const ACTION_PREVIEW_ZOOM = 2;
async function prepareRdxPoseAuthoring(bytes){
  const [rom,paletteData]=await Promise.all([
    RdxRom.from(bytes,{strictHash:true}),
    fetch('./rdx/data/palettes.json').then(response=>{if(!response.ok)throw new Error(`RDX palettes HTTP ${response.status}`);return response.json();})
  ]);
  rdxPoseAuthoring={decoder:new RdxSpriteDecoder(rom),palettes:new PaletteRegistry(paletteData),cache:new Map(),utilityCache:new Map()};
}
async function activateEditorRdxRom(romBytes,name=AUTO_RDX_ROM_NAME,{automatic=false,remember=true,directoryHandle=null}={}){
  if(!preview)throw new Error('xrick preview is not ready');
  const resumeNativeActionPreview=nativeActionPreviewOwned();
  if(resumeNativeActionPreview){
    /* resetLevelForPlaytest() deliberately follows the interactive Emscripten
     * loop. Live-map scenarios pause that loop and single-step it through the
     * debug bridge, so temporarily release ownership while the new ROM is
     * installed. The selected action is restarted from its reviewed native
     * scenario immediately after the production RDX reset completes. */
    nativeActionPreviewRunner?.deactivate();
    preview.bridge.setFrontendPaused?.(false);
    preview.bridge.resumeBrowserLoop?.();
  }
  await preview.loadRdxRom(romBytes);await prepareRdxPoseAuthoring(romBytes);
  if(remember)await rememberRdxRom(romBytes,{name:name||AUTO_RDX_ROM_NAME,directoryHandle});
  const option=$('presentation-source')?.querySelector('option[value="rdx"]');if(option){option.disabled=false;option.textContent='RDX production compositor';}
  if($('presentation-source'))$('presentation-source').value='rdx';preview.setPresentation('rdx',{forceFrame:false});
  /* Loading the DX presentation over an already-running Classic SM00 leaves
   * Rick at a Classic-derived pose that intersects MD0003 descriptor terrain.
   * First let the scheduled Emscripten game loop finish its startup frame,
   * then queue the exact production reset used by the toolbar. Wait until the
   * ROM-derived RDX entry anchor survives two native frames before exposing the
   * playtest. Forced/debug restart paths are not equivalent to the interactive
   * Emscripten reset lifecycle. */
  latestSnapshot=await preview.resetLevelForPlaytest();
  if(resumeNativeActionPreview){gameplayPreviewPresentation='rdx';startNativeActionPreviewScenario({restart:true});}
  buildInspector();buildResourceFeedbackScreen();updateGameplayFeelUi();updateLiveDocs();
  $('save-status').textContent=`${automatic?'Auto-loaded':'Loaded'} ${name} · ${romBytes.length.toLocaleString()} bytes. RDX production compositor and exact ROM weapon frames are active.`;
}
async function autoLoadEditorRdxRom(){
  const remembered=await loadRememberedRdxRom();
  if(remembered){
    await activateEditorRdxRom(remembered.bytes,remembered.name||AUTO_RDX_ROM_NAME,{automatic:true,remember:false,directoryHandle:remembered.directoryHandle||null});
    return true;
  }
  for(const path of AUTO_RDX_ROM_PATHS){
    let response;try{response=await fetch(path,{cache:'no-store'});}catch{continue;}
    if(response.status===404)continue;
    if(!response.ok)throw new Error(`RDX ROM HTTP ${response.status} at ${path}`);
    const bytes=new Uint8Array(await response.arrayBuffer());if(!bytes.length)continue;
    await activateEditorRdxRom(bytes,AUTO_RDX_ROM_NAME,{automatic:true});return true;
  }
  return false;
}
function pixelBufferCanvas(buffer){
  if(!buffer || typeof document==='undefined') return null;
  const canvas=document.createElement('canvas'); canvas.width=buffer.width; canvas.height=buffer.height;
  const ctx=canvas.getContext('2d'); if(!ctx)return null; ctx.imageSmoothingEnabled=false;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(buffer.data),buffer.width,buffer.height),0,0); return canvas;
}
function rdxHeroFrameCatalog(mapId){
  const key=Number(mapId)||3; if(rdxPoseAuthoring.cache.has(key))return rdxPoseAuthoring.cache.get(key);
  const decoder=rdxPoseAuthoring.decoder,palettes=rdxPoseAuthoring.palettes;if(!decoder||!palettes)return [];
  const palette=palettes.forMap(key).rgba, rows=[];
  for(const spec of RDX_HERO_PN_SPECS){
    const animation=decoder.framesForPn(spec.pn,palette,{mirrorX:spec.direction!=='neutral'});
    animation.frames.forEach((rawFrame,index)=>{
      /* Use the exact production augmentation used by PreviewRenderer.  All
       * six ROM frames retain one stable sequence foot anchor for PN107/PN108,
       * with the Classic one-pixel high-stride presentation bob layered on top. */
      const frame=cd32AugmentedRdxFrame({...rawFrame,frameIndex:index},spec.pn);
      const canvas=pixelBufferCanvas(frame.pixels);
      const sourceTicks=Math.max(1,Number(rawFrame.pf?.duration)||1),durationMs=(spec.pn===0x6b||spec.pn===0x6c)?100:sourceTicks*20;
      if(canvas) rdxFramePlacementByCanvas.set(canvas,{anchorX:Number(frame.footAnchorX ?? frame.originX ?? frame.pixels.width/2),anchorY:Number(frame.footAnchorY ?? frame.originY ?? frame.pixels.height),role:'hero',pn:spec.pn,frameIndex:index,pfIndex:Number(rawFrame.pf?.index??-1),durationTicks:sourceTicks,durationMs});
      rows.push({pn:spec.pn,frameIndex:index,label:`PN${spec.pn.toString(16).toUpperCase().padStart(2,'0')} · ${spec.label} · frame ${index+1}/${animation.frames.length}`,direction:spec.direction,durationMs,canvas});
    });
  }
  rdxPoseAuthoring.cache.set(key,rows);return rows;
}
function rdxPreviewFramesForPn(pn,mapId,{mirrorX=false,role='object'}={}){
  const mapKey=Number(mapId)||3,key=`${mapKey}:${Number(pn)}:${mirrorX?1:0}:${role}`;
  if(rdxPoseAuthoring.utilityCache?.has(key))return rdxPoseAuthoring.utilityCache.get(key);
  const decoder=rdxPoseAuthoring.decoder,palettes=rdxPoseAuthoring.palettes;if(!decoder||!palettes)return [];
  const palette=palettes.forMap(mapKey).rgba,animation=decoder.framesForPn(Number(pn),palette,{mirrorX}),rows=[];
  animation.frames.forEach((frame,index)=>{
    const canvas=pixelBufferCanvas(frame.pixels);if(!canvas)return;
    const anchor=role==='projectile'?{x:Number(frame.originX ?? 0),y:Number(frame.originY ?? 0)}:{x:Number(frame.footAnchorX ?? frame.originX ?? frame.pixels.width/2),y:Number(frame.footAnchorY ?? frame.originY ?? frame.pixels.height)};
    rdxFramePlacementByCanvas.set(canvas,{anchorX:anchor.x,anchorY:anchor.y,role,pn:Number(pn),frameIndex:index,pfIndex:Number(frame.pf?.index??-1),durationTicks:Math.max(1,Number(frame.pf?.duration)||1)});rows.push(canvas);
  });
  rdxPoseAuthoring.utilityCache?.set(key,rows);return rows;
}
function fitSpriteIntoCanvas(source,width=96,height=63){
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.fillStyle='#081018';ctx.fillRect(0,0,width,height);
  if(source){const scale=Math.min(width/source.width,height/source.height);const dw=Math.max(1,Math.round(source.width*scale)),dh=Math.max(1,Math.round(source.height*scale));ctx.drawImage(source,Math.round((width-dw)/2),Math.round(height-dh),dw,dh);}return canvas;
}
function cropLayerCanvas(source,bounds){
  if(!source?.width||!source?.height||!bounds)return null;
  const left=Math.max(0,Math.floor(bounds.left)),top=Math.max(0,Math.floor(bounds.top)),right=Math.min(source.width,Math.ceil(bounds.right)),bottom=Math.min(source.height,Math.ceil(bounds.bottom));
  const width=Math.max(1,right-left),height=Math.max(1,bottom-top),out=document.createElement('canvas');out.width=width;out.height=height;out.getContext('2d').drawImage(source,left,top,width,height,0,0,width,height);return out;
}
function currentHeroPoseCanvas(){
  try{
    const layer=preview?.actorLayer?.(1,latestSnapshot),out=cropLayerCanvas(layer?.canvas,layer?.bounds);if(out)return out;
  }catch{}
  return null;
}

function currentEnemyPoseCanvas(){
  try{
    const enemy=(latestSnapshot?.entities||[]).find(entity=>{const n=Number(entity?.n||0)&0x7f;return Number(entity?.slot)>3&&n>=0x04&&n<=0x0f;});
    if(!enemy)return null;const layer=preview?.actorLayer?.(Number(enemy.slot),latestSnapshot),b=layer?.bounds;if(!layer?.canvas||!b)return null;
    return cropLayerCanvas(layer.canvas,b);
  }catch{return null;}
}

function currentMovingPlatformPoseCanvas(){
  try{
    const platform=(latestSnapshot?.entities||[]).find(entity=>Number(entity?.movingPlatformState||0)!==0);
    if(!platform)return null;
    const layer=preview?.actorLayer?.(Number(platform.slot),latestSnapshot);return cropLayerCanvas(layer?.canvas,layer?.bounds);
  }catch{return null;}
}

function poseBindingFrameCanvas(binding,presentation=preview?.presentation||'classic'){
  if(presentation==='rdx'){
    if(binding?.rdxFrameSource==='frame') return rdxHeroFrameCatalog(latestSnapshot?.map).find(row=>row.pn===Number(binding.rdxPn)&&row.frameIndex===Number(binding.rdxFrameIndex))?.canvas||currentHeroPoseCanvas();
    return currentHeroPoseCanvas();
  }
  if(binding?.classicFrameSource==='frame') return classicHeroFrameCanvas(Number(binding.classicFrameId)||1);
  return currentHeroPoseCanvas()||classicHeroFrameCanvas(Number(latestSnapshot?.entities?.find(entity=>Number(entity.slot)===1)?.sprite)||11);
}

function classicHeroFrameDirection(frameId){
  /* xrick game_dir contract: LEFT=1 selects Classic 0x0D..0x17, RIGHT=0 selects 0x01..0x0B. */
  const id=Number(frameId)||0;
  if(id>=1 && id<=11) return 1;
  if(id>=13 && id<=23) return -1;
  return 0;
}
function currentHeroDirection(){ return latestSnapshot?.rick?.direction ? -1 : 1; }
function poseBindingReferenceDirection(binding,presentation=preview?.presentation||'classic'){
  if(presentation==='rdx' && binding?.rdxFrameSource==='frame'){
    const row=rdxHeroFrameCatalog(latestSnapshot?.map).find(item=>item.pn===Number(binding.rdxPn)&&item.frameIndex===Number(binding.rdxFrameIndex));
    return row?.direction==='left'?-1:row?.direction==='right'?1:0;
  }
  if(presentation!=='rdx' && binding?.classicFrameSource==='frame') return classicHeroFrameDirection(binding.classicFrameId);
  return currentHeroDirection();
}
function poseFitRect(source,width=32,height=21){
  if(!source?.width || !source?.height) return {x:0,y:0,w:width,h:height};
  const fit=Math.min(width/source.width,height/source.height),w=Math.max(1,Math.round(source.width*fit)),h=Math.max(1,Math.round(source.height*fit));
  return {x:Math.round((width-w)/2),y:Math.round(height-h),w,h};
}
function syncPoseEmitterReference(binding,poseSource,presentation=preview?.presentation||'classic'){
  if(!binding?.emitter) return;
  const rect=poseFitRect(poseSource,32,21);
  binding.referenceDirection=poseBindingReferenceDirection(binding,presentation);
  binding.emitter.refX=rect.x; binding.emitter.refY=rect.y; binding.emitter.refW=rect.w; binding.emitter.refH=rect.h;
}

const metrics = {
  frame: [], juice: [],
  push(name, value) { const list = this[name]; list.push(value); if (list.length > 180) list.shift(); },
  mean(name) { const list = this[name]; return list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0; },
  percentile(name, p) { const list = [...this[name]].sort((a, b) => a - b); return list.length ? list[Math.min(list.length - 1, Math.floor(list.length * p))] : 0; },
  reset() { this.frame.length = this.juice.length = 0; }
};

const EFFECT_META = {
  particles: { label: 'Particles', cost: 'pooled · capped', period: 'CD32-safe · short-lived opaque blitter/sprite particles', fallback: 'Preallocated BOB/sprite pool', fields: [
    ['count', 'Count', 0, 64, 1], ['speed', 'Speed', 0, 160, 1], ['lifeMs', 'Life ms', 10, 2000, 10], ['gravity', 'Gravity', -200, 300, 5], ['size', 'Start BOB size px', 1, 16, 1], ['spawnRadius', 'Spawn radius px', 0, 24, 1], ['emitterWidth', 'Emitter width px', 1, 64, 1], ['emitterHeight', 'Emitter height px', 1, 64, 1]
  ] },
  camera: { label: 'Camera impulse', cost: 'math only', period: 'CD32-safe · integer viewport/register offset sequence', fallback: 'Viewport offset', fields: [
    ['amplitude', 'Maximum amplitude px', 0, 12, .1], ['durationMs', 'Duration ms', 0, 1200, 5], ['frequency', 'Frequency', 1, 80, 1], ['impactMinScale', 'Impact minimum ×', 0, 1, .05], ['impactExponent', 'Impact response', .25, 4, .05]
  ] },
  flash: { label: 'Contact flash (area)', cost: '1 rect', period: 'CD32-safe at opacity 1.00 · palette/blitter flash', fallback: 'Palette or blitter fill', fields: [
    ['alpha', 'Opacity (1 = opaque)', 0, 1, .01], ['durationMs', 'Duration ms', 0, 800, 5], ['radius', 'Size px', 1, 80, 1]
  ] },
  actorFlash: { label: 'Target sprite flash', cost: 'palette/sprite tint', period: 'CD32-safe at strength 1.00 · alternate sprite/palette', fallback: 'Alternate sprite or palette words', fields: [['frames', 'Frames @25Hz', 0, 5, 1], ['alpha', 'Strength', 0, 1, .05]] },
  worldFlash: { label: 'Presentation-layer block flash / ripple', period: 'CD32-safe at opaque strengths · block/blitter effect', fallback: 'Blitter block copy/fill', cost: '8px blocks · bounded', fields: [
    ['frames', 'Frames @25Hz', 0, 5, 1], ['foregroundDelayFrames', 'Foreground delay frames', 0, 8, 1], ['backgroundDelayFrames', 'Background delay frames', 0, 8, 1], ['backgroundAlphaScale', 'Background opacity × (1 = opaque)', 0, 1, .05], ['alpha', 'Opacity (1 = opaque)', 0, 1, .05], ['radius', 'Radius px', 8, 160, 4], ['ringWidth', 'Ring width px', 4, 64, 2], ['blockSize', 'Block size px', 4, 16, 4]
  ] },
  hitStop: { label: 'Stop-the-world / freeze-frame', cost: 'impact-frame hold in A/B', period: 'CD32-safe · hold/repeat the current frame', fallback: 'Skip simulation/display updates for fixed ticks', fields: [['frames', 'Frames @25Hz', 0, 5, 1]] },
  spriteImpulse: { label: 'Actor deformation / recoil', cost: '1 actor blit', period: 'CD32-safe in 1:1 blitter-band/translation modes', fallback: 'Blitter strip copy / row omission at 1:1 pixels', fields: [
    ['x', 'Kick X', -12, 12, .5], ['y', 'Kick Y', -12, 12, .5], ['squash', 'Squash strength', -.35, .35, .01], ['bands', 'Blitter bands', 2, 8, 1], ['deformationPixels', 'Max band displacement px', 0, 8, 1], ['degradationPx', 'Dropped rows / band', 0, 4, 1], ['durationMs', 'Duration ms', 0, 800, 5]
  ] },
  foregroundDust: { label: 'Foreground blast dust', cost: 'bounded BOB pool', period: 'CD32-safe · opaque foreground-block/BOB debris', fallback: 'Bounded sprite/BOB debris list', fields: [
    ['radius', 'Blocky blast radius px', 8, 160, 4], ['blockSize', 'Foreground sample block px', 4, 16, 4], ['density', 'Dust density', 0, 1, .05], ['speed', 'Outward speed', 0, 180, 2], ['lifeMs', 'Life ms', 40, 1200, 10], ['gravity', 'Gravity', -100, 300, 5], ['size', 'Particle size', 1, 4, 1]
  ] },
  knockback: { period: 'CD32-safe presentation technique · coordinate displacement', fallback: 'Sprite/BOB position change', label: 'Hit knockback / push-back', cost: '1 actor blit', fields: [
    ['distance', 'Push distance px', 0, 16, 1], ['lift', 'Vertical lift px', -8, 8, 1], ['frames', 'Recovery frames @25Hz', 0, 8, 1]
  ] },
  hudImpulse: { period: 'CD32-safe at opacity 1.00 · palette/blitter HUD feedback', fallback: 'Blitter/palette HUD update', label: 'HUD inventory feedback', cost: '1 × 8px tile', fields: [
    ['frames', 'Frames @25Hz', 0, 6, 1], ['alpha', 'Flash opacity (1 = opaque)', 0, 1, .05], ['jitter', 'Jitter px', 0, 3, 1], ['staggerFrames', 'Sequence stagger frames', 0, 4, 1]
  ] },
  poseEmitter: { period: 'Event-bound sprite generator · presentation-specific pose reference', fallback: 'Sprite/BOB-relative bounded particle emitter', label: 'Pose-attached particle generators', cost: 'pooled · capped', fields: [] },
  audio: { period: 'Authoring preview · bake filters/envelopes for Amiga', fallback: 'Pre-render processed sample / software mixer', label: 'Extra audio accent', cost: 'optional decoded sample · capped', fields: [
    ['gain', 'Gain', 0, 1.5, .01], ['pitchVariance', 'Pitch jitter', 0, .2, .005], ['rate', 'Playback rate', .5, 2, .01], ['pan', 'Fixed pan', -1, 1, .05]
  ] }
};
/* HUD inventory feedback has its own isolated authoring screen. Keeping the
 * protocol field on event recipes preserves runtime/export compatibility, but
 * presenting it beside every world/action effect falsely implied that every
 * action had a meaningful HUD target. */
const ACTION_INSPECTOR_EFFECT_KEYS = Object.freeze(Object.keys(EFFECT_META).filter(key=>key!=='hudImpulse'));
const GAME_SAMPLES = ['walk.wav','crawl.wav','jump.wav','stick.wav','bullet.wav','bombshht.wav','explode.wav','box.wav','bonus.wav','sbonus1.wav','sbonus2.wav','pad.wav','die.wav','ent0.wav','ent1.wav','ent2.wav','ent3.wav','ent4.wav','ent5.wav','ent6.wav','ent7.wav','ent8.wav','stick_hit.wav'];
const NATIVE_ACTION_SFX = Object.freeze({ 'player.step':'walk.wav', 'player.jump':'jump.wav', 'player.land':'stick.wav', 'weapon.fire':'bullet.wav', 'bullet.wall_hit':'box.wav', 'dynamite.place':'bombshht.wav', 'dynamite.explode':'explode.wav', 'pickup.collect':'bonus.wav', 'ammo.collect':'bonus.wav', 'points.collect':'bonus.wav' });

function cloneRecipe(recipe) { return JSON.parse(JSON.stringify(recipe)); }
function saveLocal(immediate = false) {
  const now = performance.now(); if (!immediate && now - lastSave < 250) return; lastSave = now;
  profileB = normalizeProfile(profile);
  localStorage.setItem(JUICE_STORAGE_KEY, JSON.stringify({ stateVersion:JUICE_EDITOR_STATE_VERSION, appVersion:'2.1.99', profile: profileB, profileA, profileB, baselineMode, selectedAction, actionPreviewDirection, actionPreviewSource, tuningActionPreviewSource, actionsWorkflow, actionPreviewManualSubmapByAction, actionPreviewLiveSubmap:actionPreviewEffectiveLiveSubmap(selectedAction), actionPreviewLiveZoom, gameplayPreviewSubmap, gameplayPreviewPresentation, actionPreviewBulletSource, actionPreviewDynamiteSource, actionPreviewNearMissAnchor, explosionPreviewConfig, selectedAudioAction, selectedAudioSource, audioAffectsLiveEdits, editorMuted, autoReviveSameSpot, selectedEntityAudioType, selectedScreen, gameplayTuning, customPresets, activeCustomPresetId, selectedGameStyleKey, activePresetProvenance, actionVariantsByAction }));
  $('save-status').textContent = `Draft saved locally · ${new Date().toLocaleTimeString()}`;
}
function syncProfiles() {
  runtimeA.setProfile(profileA); runtimeB.setProfile(profile);
  hudPreviewRuntime.setProfile(profile); hudPreviewRuntime.setEnabled(true); hudPreviewRuntime.setAudioEnabled(false);
  const mode = $('compare-mode').value;
  // A is raw xrick by default. It only gains a juice layer after the user explicitly accepts B as a new baseline.
  runtimeA.setEnabled(mode !== 'off' && baselineMode === 'accepted');
  runtimeB.setEnabled(mode !== 'off');
  syncAudioAudition();
  updateComparisonLabels();
  updateLiveDocs();
}
function syncAudioAudition() {
  const audition = $('audio-audition')?.value || 'b';
  const mode = $('compare-mode')?.value || 'side';
  const aVisible = mode === 'side' || mode === 'a';
  const bVisible = mode === 'side' || mode === 'b';
  const liveB = !editorMuted && audioAffectsLiveEdits && bVisible && (audition === 'b' || audition === 'both');
  preview?.bridge?.setSoundMuted?.(editorMuted);
  runtimeA.setAudioEnabled(!editorMuted && aVisible && baselineMode === 'accepted' && (audition === 'a' || audition === 'both'));
  runtimeA.setAudioIndependent?.(false);
  runtimeA.setAudioEventFilter?.(selectedAudioAction);
  runtimeB.setAudioEnabled(liveB);
  runtimeB.setAudioIndependent?.(liveB);
  /* The Audible Effects panel is an isolated monitor: only the selected event
   * is authored into the gameplay pane. Every other game sound stays native,
   * which makes changing jump→crawl or gain/pitch immediately unambiguous. */
  runtimeB.setAudioEventFilter?.(liveB ? selectedAudioAction : '');

  /* Never silence native xrick until the exact replacement has decoded. A
   * failed fetch/AudioContext resume therefore degrades to native SFX instead
   * of producing the silent gameplay regression reported in v2.1.71. */
  const routeGeneration = ++audioRouteGeneration;
  audioRouteArmedAction = '';
  preview?.clearNativeSfxSuppressions?.();
  const status = $('audio-live-route-status');
  const nativeSample = NATIVE_ACTION_SFX[selectedAudioAction];
  const selectedRecipe = profile.actions?.[selectedAudioAction];
  const audible = selectedRecipe?.audio?.enabled &&
    (Number(selectedRecipe.audio.gain || 0) > 0 || (!!selectedRecipe.audio.layerSample && Number(selectedRecipe.audio.layerGain || 0) > 0));
  if (editorMuted) { if(status)status.textContent='Editor audio is muted from the header.'; return; }
  if (!liveB) { if(status)status.textContent='Live audio route: off.'; return; }
  if (!audible) { if(status)status.textContent=`Live audio route: ${selectedAudioAction} has no audible authored voice; native SFX kept.`; return; }
  if(status)status.textContent=`Live audio route: preparing ${selectedAudioAction}…`;
  void runtimeB.prepareAudioAction?.(selectedAudioAction).then(ready => {
    if (routeGeneration !== audioRouteGeneration) return;
    if (ready && nativeSample) preview?.setNativeSfxSuppressed?.(nativeSample, true);
    if (ready && nativeSample) audioRouteArmedAction = selectedAudioAction;
    if(status)status.textContent=ready
      ? `Live audio route: armed · ${selectedAudioAction} → ${selectedRecipe.audio.sample || 'sample'}${nativeSample ? ' (native replacement active)' : ''}.`
      : `Live audio route: replacement unavailable; native ${nativeSample || 'SFX'} kept audible.`;
  }).catch(() => { if(routeGeneration===audioRouteGeneration){audioRouteArmedAction='';if(status)status.textContent='Live audio route: replacement failed to load; native SFX kept audible.';} });
}
function unlockGameplayAudio() {
  try { globalThis.xrickResumeAudio?.(); } catch { /* native audio resumes best-effort */ }
  if (gameplayAudioUnlocked || gameplayAudioUnlockPromise) return gameplayAudioUnlockPromise;
  const a=runtimeA.unlockAudio?.(), b=runtimeB.unlockAudio?.();
  /* Re-arm exactly once after the first real user gesture. Re-running this on
   * every gameplay key would briefly clear native suppression each time and
   * make the selected authored voice race the original SFX. */
  gameplayAudioUnlockPromise = Promise.allSettled([a,b]).then(results => {
    gameplayAudioUnlocked = results.some(row => row.status === 'fulfilled' && row.value === true);
    gameplayAudioUnlockPromise = null;
    syncAudioAudition();
    return gameplayAudioUnlocked;
  });
  return gameplayAudioUnlockPromise;
}

function syncGlobalAudioMute({save=false}={}) {
  const button = $('global-audio-mute');
  if (button) {
    button.classList.toggle('is-muted', editorMuted);
    button.setAttribute('aria-pressed', String(editorMuted));
    button.title = editorMuted ? 'Unmute editor audio' : 'Mute editor audio';
    button.setAttribute('aria-label', button.title);
  }
  if (editorMuted) { stopAudioAuditionLoop(); stopAudioReference(); }
  syncAudioAudition();
  if (save) saveLocal(true);
}

function saveWorkspaceLayout() {
  const windows = {};
  document.querySelectorAll('[data-editor-window]').forEach(panel => {
    windows[panel.dataset.editorWindow] = { collapsed: panel.classList.contains('is-collapsed') };
  });
  try { localStorage.setItem(JUICE_LAYOUT_STORAGE_KEY, JSON.stringify({ windows })); } catch { /* optional UI preference */ }
}

function windowControlIcon(kind) {
  if (kind === 'expand') return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4"></path></svg>';
  if (kind === 'restore') return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 5h8v8H5zM3 11V3h8"></path></svg>';
  return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 6 5 5 5-5"></path></svg>';
}

function setWindowExpanded(panel, expanded) {
  document.querySelectorAll('[data-editor-window].is-expanded').forEach(other => {
    if (other !== panel) {
      other.classList.remove('is-expanded');
      const button = other.querySelector('[data-window-action="expand"]');
      if (button) { button.innerHTML = windowControlIcon('expand'); button.title = 'Expand window'; button.setAttribute('aria-label', 'Expand window'); button.setAttribute('aria-pressed', 'false'); }
    }
  });
  panel.classList.toggle('is-expanded', expanded);
  if (expanded) panel.classList.remove('is-collapsed');
  document.body.classList.toggle('window-expanded', !!document.querySelector('[data-editor-window].is-expanded'));
  const expandButton = panel.querySelector('[data-window-action="expand"]');
  if (expandButton) {
    expandButton.innerHTML = windowControlIcon(expanded ? 'restore' : 'expand');
    expandButton.title = expanded ? 'Restore window' : 'Expand window';
    expandButton.setAttribute('aria-label', expandButton.title);
    expandButton.setAttribute('aria-pressed', String(expanded));
  }
  const collapseButton = panel.querySelector('[data-window-action="collapse"]');
  if (collapseButton) {
    const collapsed = panel.classList.contains('is-collapsed');
    collapseButton.classList.toggle('open', !collapsed);
    collapseButton.setAttribute('aria-expanded', String(!collapsed));
    collapseButton.title = collapsed ? 'Expand window contents' : 'Collapse window';
    collapseButton.setAttribute('aria-label', collapseButton.title);
  }
  if (panel.dataset.editorWindow === 'action-inspector') requestAnimationFrame(fitActionFeedbackWorkspace);
}

function setWindowCollapsed(panel, collapsed) {
  if (panel.dataset.editorWindow === 'action-inspector' && collapsed) return;
  if (collapsed && panel.classList.contains('is-expanded')) setWindowExpanded(panel, false);
  panel.classList.toggle('is-collapsed', collapsed);
  const button = panel.querySelector('[data-window-action="collapse"]');
  if (button) {
    button.classList.toggle('open', !collapsed);
    button.setAttribute('aria-expanded', String(!collapsed));
    button.title = collapsed ? 'Expand window contents' : 'Collapse window';
    button.setAttribute('aria-label', button.title);
  }
  saveWorkspaceLayout();
  if (panel.dataset.editorWindow === 'action-inspector' && !collapsed) requestAnimationFrame(fitActionFeedbackWorkspace);
}

function revealWorkspaceWindow(windowId) {
  const panel = document.querySelector(`[data-editor-window="${windowId}"]`);
  if (panel) setWindowCollapsed(panel, false);
}

function fitActionFeedbackWorkspace() {
  const actionsScreen = document.querySelector('.actions-screen');
  const panel = document.querySelector('[data-editor-window="action-inspector"]');
  const body = panel?.querySelector(':scope > .window-body');
  const canvas = $('action-preview-host')?.querySelector('.action-preview-canvas');
  const figure = canvas?.closest('.action-preview-card');
  if (!actionsScreen || !panel || !body || !figure || !canvas || actionsWorkflow !== 'tune' || selectedScreen !== 'actions' || panel.classList.contains('is-collapsed')) return;

  const heading = panel.querySelector(':scope > .panel-heading');
  const panelTop = Math.max(0, panel.getBoundingClientRect().top);
  const viewportGap = 12;
  const bodyHeight = Math.max(220, Math.floor(window.innerHeight - panelTop - viewportGap - (heading?.getBoundingClientRect().height || 0)));
  panel.style.setProperty('--action-feedback-body-height', `${bodyHeight}px`);

  const master = body.querySelector('.action-master-row');
  const caption = figure.querySelector('figcaption');
  const toolbar = figure.querySelector('.action-preview-toolbar');
  const host = $('action-preview-host');
  const hostStyle = host ? getComputedStyle(host) : null;
  const hostMargins = hostStyle ? (parseFloat(hostStyle.marginTop) || 0) + (parseFloat(hostStyle.marginBottom) || 0) : 0;
  const fixedHeight = (master?.getBoundingClientRect().height || 0)
    + (caption?.getBoundingClientRect().height || 0)
    + (toolbar?.getBoundingClientRect().height || 0)
    + hostMargins + 8;
  const editorReserve = Math.min(120, Math.max(92, Math.floor(bodyHeight * .16)));
  const canvasMaxHeight = Math.max(96, bodyHeight - fixedHeight - editorReserve);
  const ratio = Math.max(.1, Number(canvas.width) / Math.max(1, Number(canvas.height)));
  const canvasMaxWidth = Math.max(1, figure.clientWidth - 2);
  const fittedWidth = Math.min(canvasMaxWidth, canvasMaxHeight * ratio);
  canvas.style.width = `${Math.max(1, Math.floor(fittedWidth))}px`;
}

function syncActionsWorkflowUi() {
  const actionsScreen = document.querySelector('.actions-screen');
  if (actionsScreen) actionsScreen.dataset.actionsWorkflow = actionsWorkflow;
  document.querySelectorAll('[data-actions-workflow]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.actionsWorkflow === actionsWorkflow));
  });
  const livePanel = document.querySelector('[data-editor-window="live-preview"]');
  const tuning = actionsWorkflow === 'tune';
  if (livePanel) {
    if (tuning && livePanel.classList.contains('is-expanded')) setWindowExpanded(livePanel, false);
    livePanel.hidden = tuning;
  }
  const status = $('actions-workflow-status');
  if (status) status.textContent = tuning
    ? `Tuning ${ACTIONS.find(action=>action.id===selectedAction)?.label || selectedAction} · ${actionPreviewSource === 'live' ? 'Live map owns xrick' : 'Synthetic preview'}`
    : 'Playable A/B owns xrick · action preview is parked.';
  if (tuning) requestAnimationFrame(fitActionFeedbackWorkspace);
}

function setActionsWorkflow(mode,{save=true}={}) {
  const next = mode === 'playtest' ? 'playtest' : 'tune';
  const changed = next !== actionsWorkflow;
  actionsWorkflow = next;
  if (next === 'playtest') {
    if (actionPreviewSource === 'live') setActionPreviewSource('synthetic',{rebuild:true,resetGameplay:true});
  } else if (actionPreviewSource !== tuningActionPreviewSource) {
    setActionPreviewSource(tuningActionPreviewSource,{rebuild:true,resetGameplay:true});
  } else if (actionPreviewSource === 'live' && preview && !nativeActionPreviewRunner?.active) {
    startNativeActionPreviewScenario({restart:true});
  }
  syncActionsWorkflowUi();
  if (save) saveLocal(true);
  return changed;
}

function installWorkspaceWindows() {
  document.querySelectorAll('[data-editor-window]').forEach(panel => {
    const heading = panel.querySelector(':scope > .panel-heading');
    if (!heading || heading.querySelector('.window-controls')) return;
    const windowId = panel.dataset.editorWindow;
    const controls = document.createElement('span'); controls.className = 'window-controls';
    const collapse = document.createElement('button'); collapse.type = 'button'; collapse.className = 'window-control'; collapse.dataset.windowAction = 'collapse'; collapse.innerHTML = windowControlIcon('collapse');
    const expand = document.createElement('button'); expand.type = 'button'; expand.className = 'window-control'; expand.dataset.windowAction = 'expand'; expand.innerHTML = windowControlIcon('expand'); expand.title = 'Expand window'; expand.setAttribute('aria-label', 'Expand window'); expand.setAttribute('aria-pressed', 'false');
    collapse.addEventListener('click', () => setWindowCollapsed(panel, !panel.classList.contains('is-collapsed')));
    expand.addEventListener('click', () => setWindowExpanded(panel, !panel.classList.contains('is-expanded')));
    if (windowId !== 'action-inspector') controls.appendChild(collapse);
    controls.appendChild(expand); heading.appendChild(controls);
    const stored = savedWorkspaceLayout?.windows?.[windowId];
    const defaultCollapsed = panel.dataset.defaultCollapsed === 'true';
    setWindowCollapsed(panel, windowId === 'action-inspector' ? false : (typeof stored?.collapsed === 'boolean' ? stored.collapsed : defaultCollapsed));
  });
  window.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const expanded = document.querySelector('[data-editor-window].is-expanded');
    if (expanded) { event.preventDefault(); setWindowExpanded(expanded, false); }
  });
  window.addEventListener('resize', () => requestAnimationFrame(fitActionFeedbackWorkspace));
}

function setJuiceScreen(name, { save = true, toggle = false, scroll = false } = {}) {
  const requested = ['actions','audio','entity-audio','transitions','resources','movement'].includes(name) ? name : 'actions';
  selectedScreen = toggle && requested !== 'actions' && selectedScreen === requested ? 'actions' : requested;
  document.querySelectorAll('[data-juice-screen]').forEach(button => {
    const active = button.dataset.juiceScreen === selectedScreen;
    button.setAttribute('aria-selected', active ? 'true' : 'false');
    button.classList.toggle('active', active);
  });
  document.querySelectorAll('[data-juice-screen-panel]').forEach(panel => { panel.hidden = panel.dataset.juiceScreenPanel !== selectedScreen; });
  if (selectedScreen === 'audio') syncAudioScreen();
  if (selectedScreen === 'entity-audio') syncEntityAudioScreen();
  if (selectedScreen === 'transitions') { if(selectedTransitionHook()==='mapEntry'){transitionEntryPreviewArmed=false;if($('transition-phase'))$('transition-phase').value='0';} syncTransitionScreen(); renderTransitionPreview(Number($('transition-phase')?.value || 0) / 100); }
  if (selectedScreen === 'resources') { buildResourceFeedbackScreen(); resetResourcePreview(false); }
  if (selectedScreen === 'movement') updateGameplayFeelUi();
  if (selectedScreen === 'actions' && actionsWorkflow === 'tune') requestAnimationFrame(fitActionFeedbackWorkspace);
  if (scroll) document.querySelector(`[data-juice-screen-panel="${selectedScreen}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  if (save) saveLocal();
}

function syncAudioScreen() {
  const select = $('audio-screen-action');
  if (!select) return;
  if (!select.options.length) {
    for (const action of ACTIONS) { const option = document.createElement('option'); option.value = action.id; option.textContent = `${action.group} · ${action.label}`; select.appendChild(option); }
  }
  if (!ACTIONS.some(action => action.id === selectedAudioAction)) selectedAudioAction = selectedAction;
  select.value = selectedAudioAction;
  if ($('audio-screen-source')) $('audio-screen-source').value = selectedAudioSource;
  runtimeB.audio.setSource(selectedAudioSource);
  const audio = profile.actions[selectedAudioAction].audio;
  $('audio-screen-enabled').checked = !!audio.enabled;
  const sampleSelect = $('audio-screen-sample');
  if (sampleSelect && !sampleSelect.options.length) for (const sample of GAME_SAMPLES) { const option = document.createElement('option'); option.value = sample; option.textContent = sample; sampleSelect.appendChild(option); }
  sampleSelect.value = audio.sample || 'walk.wav';
  $('audio-screen-gain').value = audio.gain;
  $('audio-screen-pitch').value = audio.pitchVariance;
  $('audio-screen-rate').value = audio.rate;
  $('audio-screen-pan').value = audio.pan;
  $('audio-screen-event-pan').checked = !!audio.panFromEvent;
  $('audio-screen-attack').value = audio.attackMs ?? 0;
  $('audio-screen-release').value = audio.releaseMs ?? 0;
  $('audio-screen-filter').value = audio.filterType || 'none';
  $('audio-screen-filter-hz').value = audio.filterHz ?? 4200;
  const layerSelect=$('audio-screen-layer-sample');
  if(layerSelect && layerSelect.options.length===1) for(const sample of GAME_SAMPLES){const option=document.createElement('option');option.value=sample;option.textContent=sample;layerSelect.appendChild(option);}
  if(layerSelect) layerSelect.value=audio.layerSample || '';
  $('audio-screen-layer-gain').value = audio.layerGain ?? 0;
  $('audio-screen-layer-rate').value = audio.layerRate ?? 1;
}

function updateAudioScreenRecipe() {
  const audio = profile.actions[selectedAudioAction]?.audio;
  if (!audio) return;
  audio.enabled = $('audio-screen-enabled').checked;
  audio.sample = $('audio-screen-sample').value;
  audio.gain = Number($('audio-screen-gain').value);
  audio.pitchVariance = Number($('audio-screen-pitch').value);
  audio.rate = Number($('audio-screen-rate').value);
  audio.pan = Number($('audio-screen-pan').value);
  audio.panFromEvent = $('audio-screen-event-pan').checked;
  audio.attackMs = Number($('audio-screen-attack').value);
  audio.releaseMs = Number($('audio-screen-release').value);
  audio.filterType = $('audio-screen-filter').value;
  audio.filterHz = Number($('audio-screen-filter-hz').value);
  audio.layerSample = $('audio-screen-layer-sample').value;
  audio.layerGain = Number($('audio-screen-layer-gain').value);
  audio.layerRate = Number($('audio-screen-layer-rate').value);
  profile = normalizeProfile(profile);
  syncProfiles();
  buildActionList();
  if (selectedAction === selectedAudioAction) buildInspector();
  saveLocal();
  syncAudioScreen();
}

const ENTITY_AUDIO_CATEGORIES = Object.freeze([
  ['collectible','Collectible / bonus'], ['breakable-block','Breakable block / rubble'],
  ['projectile-shooter','Projectile shooter'], ['projectile','Projectile in flight'],
  ['moving-platform','Moving platform / moving block'], ['trap-mechanism','Trap / mechanism'],
  ['other-mechanism','Other mechanism']
]);
async function loadEntitySoundMapping() {
  try {
    const response = await fetch('./rdx/data/preview/classic_activator_sounds.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Entity sound mapping load failed (${response.status})`);
    const data = await response.json();
    entitySoundMapping = data?.entities && typeof data.entities === 'object' ? data.entities : {};
    if (!ENTITY_AUDIO_CATEGORIES.some(([id])=>id===selectedEntityAudioType)) selectedEntityAudioType='collectible';
    syncEntityAudioScreen();
  } catch (error) {
    entitySoundMapping = {};
    if ($('entity-audio-status')) $('entity-audio-status').textContent = error.message;
  }
}
function entityCategoryRows(category=selectedEntityAudioType) {
  return Object.entries(entitySoundMapping).map(([key,row])=>({type:Number(key),...row})).filter(row=>Number.isFinite(row.type) && entityAudioCategory(row.type)===category);
}
function entityAudioKey(type = selectedEntityAudioType) { return `category:${String(type)}`; }
function entityAudioBaseline(type = selectedEntityAudioType) {
  const rows=entityCategoryRows(type), counts=new Map();
  for(const row of rows){const sample=row.sample||'ent0.wav';counts.set(sample,(counts.get(sample)||0)+1);}
  const sample=[...counts.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0] || (type==='collectible'?'bonus.wav':'ent0.wav');
  return { enabled:true, sample, gain:1, pitchVariance:0, rate:1, pan:0, panFromEvent:true, attackMs:0, releaseMs:0, filterType:'none', filterHz:4200, layerSample:'', layerGain:0, layerRate:1 };
}
function entityAudioRecipe(type = selectedEntityAudioType) {
  const key=entityAudioKey(type), override=profile.entityAudio?.[key];
  return override ? { ...entityAudioBaseline(type), ...override } : entityAudioBaseline(type);
}
function syncEntityAudioScreen() {
  const select=$('entity-audio-type'); if(!select)return;
  if(!select.options.length) for(const [id,label] of ENTITY_AUDIO_CATEGORIES){const option=document.createElement('option');option.value=id;option.textContent=label;select.appendChild(option);}
  if(!ENTITY_AUDIO_CATEGORIES.some(([id])=>id===selectedEntityAudioType)) selectedEntityAudioType='collectible';
  select.value=selectedEntityAudioType;
  if($('entity-audio-source')) $('entity-audio-source').value=selectedAudioSource;
  const rows=entityCategoryRows(), key=entityAudioKey(), override=profile.entityAudio?.[key], recipe=entityAudioRecipe();
  $('entity-audio-enabled').checked=!!override?.enabled;
  const sampleSelect=$('entity-audio-sample');
  if(sampleSelect && !sampleSelect.options.length) for(const sample of GAME_SAMPLES){const option=document.createElement('option');option.value=sample;option.textContent=sample;sampleSelect.appendChild(option);}
  if(sampleSelect && recipe.sample && !Array.from(sampleSelect.options).some(o=>o.value===recipe.sample)){const option=document.createElement('option');option.value=recipe.sample;option.textContent=recipe.sample;sampleSelect.appendChild(option);}
  if(sampleSelect) sampleSelect.value=recipe.sample;
  $('entity-audio-gain').value=recipe.gain;$('entity-audio-pitch').value=recipe.pitchVariance;$('entity-audio-rate').value=recipe.rate;$('entity-audio-pan').value=recipe.pan;$('entity-audio-event-pan').checked=recipe.panFromEvent!==false;
  $('entity-audio-attack').value=recipe.attackMs??0;$('entity-audio-release').value=recipe.releaseMs??0;$('entity-audio-filter').value=recipe.filterType||'none';$('entity-audio-filter-hz').value=recipe.filterHz??4200;
  const layerSelect=$('entity-audio-layer-sample');if(layerSelect&&layerSelect.options.length===1)for(const sample of GAME_SAMPLES){const option=document.createElement('option');option.value=sample;option.textContent=sample;layerSelect.appendChild(option);}if(layerSelect)layerSelect.value=recipe.layerSample||'';
  $('entity-audio-layer-gain').value=recipe.layerGain??0;$('entity-audio-layer-rate').value=recipe.layerRate??1;
  const label=ENTITY_AUDIO_CATEGORIES.find(([id])=>id===selectedEntityAudioType)?.[1]||selectedEntityAudioType;
  const samples=[...new Set(rows.map(r=>r.sample).filter(Boolean))];
  if($('entity-audio-provenance')) $('entity-audio-provenance').textContent=`${label} · ${rows.length} mapped source types · source samples ${samples.join(', ')||'none mapped'}`;
  if($('entity-audio-status')) $('entity-audio-status').textContent=override?.enabled?`Category override active for ${label}.`:`Using source/default properties for ${label}.`;
}
function updateEntityAudioRecipe() {
  const key=entityAudioKey(), enabled=$('entity-audio-enabled').checked;profile.entityAudio||={};
  if(!enabled) delete profile.entityAudio[key]; else profile.entityAudio[key]={enabled:true,sample:$('entity-audio-sample').value,gain:Number($('entity-audio-gain').value),pitchVariance:Number($('entity-audio-pitch').value),rate:Number($('entity-audio-rate').value),pan:Number($('entity-audio-pan').value),panFromEvent:$('entity-audio-event-pan').checked,attackMs:Number($('entity-audio-attack').value),releaseMs:Number($('entity-audio-release').value),filterType:$('entity-audio-filter').value,filterHz:Number($('entity-audio-filter-hz').value),layerSample:$('entity-audio-layer-sample').value,layerGain:Number($('entity-audio-layer-gain').value),layerRate:Number($('entity-audio-layer-rate').value)};
  profile=normalizeProfile(profile);syncProfiles();saveLocal();syncEntityAudioScreen();
}
async function auditionEntityAudio() {
  const status=$('entity-audio-status');
  if(editorMuted){if(status)status.textContent='Editor audio is muted from the header.';return false;}
  const recipe=entityAudioRecipe();runtimeB.audio.setSource(selectedAudioSource);const label=ENTITY_AUDIO_CATEGORIES.find(([id])=>id===selectedEntityAudioType)?.[1]||selectedEntityAudioType;
  if(status)status.textContent=`Loading ${selectedAudioSource==='classic'?'Classic':'HG / CD32'} ${recipe.sample}…`;
  const ok=await runtimeB.audio.audition(recipe,1,{audioPan:recipe.panFromEvent?.5:0,audioRate:1});if(status)status.textContent=ok?`Playing ${label} · ${recipe.sample} · gain ${Number(recipe.gain).toFixed(2)}×`:`Could not play ${recipe.sample} from ${selectedAudioSource==='classic'?'Classic':'HG / CD32'} source.`;
  return ok;
}

function selectedTransitionHook() {
  const value=$('transition-hook')?.value;
  return value==='mapEntry' || value==='playerDeath' ? value : 'mapExit';
}
function transitionConfig() { return profile.transitions[selectedTransitionHook()]; }
function transitionDirection(transition = transitionConfig()) {
  const configured = transition?.direction || 'auto';
  if (configured === 'left' || configured === 'right') return configured;
  return latestSnapshot?.rick?.direction ? 'right' : 'left';
}
function transitionOriginPoint(transition = transitionConfig()) {
  if (transition?.origin === 'custom') return { x:Number(transition.originX || 160), y:Number(transition.originY || 100) };
  if (transition?.origin === 'center') return { x:LIVE_WIDTH / 2, y:LIVE_HEIGHT / 2 };
  const bounds = preview && latestSnapshot ? preview.entityBounds(latestSnapshot, 1) : null;
  return bounds ? { x:(bounds.left + bounds.right) / 2, y:(bounds.top + bounds.bottom) / 2 } : { x:LIVE_WIDTH / 2, y:LIVE_HEIGHT / 2 };
}
function syncTransitionScreen() {
  const transition = transitionConfig();
  if ($('transition-preset')) $('transition-preset').value = transition.preset;
  if ($('transition-duration')) $('transition-duration').value = transition.durationFrames;
  if ($('transition-direction')) $('transition-direction').value = transition.direction;
  if ($('transition-origin')) $('transition-origin').value = transition.origin;
  if ($('transition-origin-x')) $('transition-origin-x').value = transition.originX;
  if ($('transition-origin-y')) $('transition-origin-y').value = transition.originY;
  const hook = selectedTransitionHook(), entry = hook === 'mapEntry';
  const flow = entry ? 'IN' : 'OUT';
  const label = hook === 'playerDeath' ? 'Hero death' : entry ? 'Entry' : 'Exit';
  if ($('transition-preview-title')) $('transition-preview-title').textContent = `${label} / ${flow} composition preview`;
  if ($('transition-phase')) $('transition-phase').disabled = entry && !transitionEntryPreviewArmed;
  const perf = transitionPerformanceImpact(transition.preset);
  if ($('transition-performance-score')) $('transition-performance-score').textContent = `${perf.score}/5 · ${perf.grade} · ${perf.family}`;
}
function commitTransitionScreen() {
  const transition = transitionConfig();
  transition.preset = $('transition-preset').value;
  transition.durationFrames = Number($('transition-duration').value);
  transition.direction = $('transition-direction').value;
  transition.origin = $('transition-origin').value;
  transition.originX = Number($('transition-origin-x').value);
  transition.originY = Number($('transition-origin-y').value);
  profile = normalizeProfile(profile); syncProfiles(); syncTransitionScreen(); renderTransitionPreview(Number($('transition-phase').value || 0) / 100); saveLocal();
}
function renderTransitionPreview(phase = 0) {
  const canvas=$('transition-preview'); if(!canvas) return; const ctx=canvas.getContext('2d',{alpha:false}); ctx.imageSmoothingEnabled=false; ctx.fillStyle='#000';ctx.fillRect(0,0,LIVE_WIDTH,LIVE_HEIGHT);
  const hook=selectedTransitionHook(), entry=hook==='mapEntry';
  if(entry && !transitionEntryPreviewArmed){
    if($('transition-phase')) $('transition-phase').value='0';
    if($('transition-phase-output')) $('transition-phase-output').textContent='0%';
    if($('transition-preview-status')) $('transition-preview-status').textContent='Entry / IN is closed to black. Press Play transition to reveal the map.';
    return;
  }
  if(!preview||!latestSnapshot){ if($('transition-preview-status')) $('transition-preview-status').textContent='Waiting for live xrick frame…'; return; }
  /* holdB is the production-composited C frame captured by XrickLivePreview.
   * Do not rebuild the map from actor/background extraction here: that path
   * bypasses the active collision solver, placement patches and screen-space
   * transform used by every other preview surface. */
  ctx.drawImage(holdB,0,0);
  const transition=transitionConfig(), direction=transitionDirection(transition), flow=entry?'in':'out';
  const origin=transitionOriginPoint(transition); drawMapTransitionMask(ctx,transition.preset,phase,direction,origin,flow,LIVE_WIDTH,LIVE_HEIGHT);
  if($('transition-phase-output')) $('transition-phase-output').textContent=`${Math.round(phase*100)}%`;
  if($('transition-preview-status')) $('transition-preview-status').textContent=`${transition.preset} · ${transition.durationFrames}f · ${flow.toUpperCase()} · origin ${transition.origin} (${Math.round(origin.x)},${Math.round(origin.y)})`;
}
function playTransitionPreview() {
  if(transitionAnimationFrame) cancelAnimationFrame(transitionAnimationFrame);
  if(selectedTransitionHook()==='mapEntry') transitionEntryPreviewArmed=true;
  syncTransitionScreen();
  if($('transition-phase')) $('transition-phase').value='0';
  const durationMs=Math.max(4,Number(transitionConfig().durationFrames||10))*40, started=performance.now();
  const step=now=>{ const phase=Math.max(0,Math.min(1,(now-started)/durationMs)); $('transition-phase').value=String(Math.round(phase*100)); renderTransitionPreview(phase); if(phase<1) transitionAnimationFrame=requestAnimationFrame(step); else transitionAnimationFrame=0; }; transitionAnimationFrame=requestAnimationFrame(step);
}


const HUD_FEEDBACK_ENTRIES = Object.freeze([
  Object.freeze({ id:'ammo-use', actionId:'ammo.deplete', label:'Ammo used', note:'Flash/jitter the consumed inventory lane. The preview type selector chooses bullets or dynamite.', kind:'selected' }),
  Object.freeze({ id:'ammo-collect', actionId:'ammo.collect', label:'Ammo refill', note:'Animate collected ammo tokens. The preview type selector chooses bullets or dynamite.', kind:'selected' }),
  Object.freeze({ id:'points-collect', actionId:'points.collect', label:'Score gained', note:'Pulse the score digits when points are awarded.', kind:'points' })
]);
function selectedAmmoKind(){ return $('resource-ammo-kind')?.value==='dynamite'?'dynamite':'bullets'; }
function ammoDisplayName(kind=selectedAmmoKind()){ return kind==='dynamite'?'dynamite':'bullets'; }
function resourceHudBounds(kind,index){ const base=kind==='dynamite'?168:104, x=base+Math.max(0,Math.min(5,index))*8; return {left:x,top:0,right:x+8,bottom:8,resource:kind==='dynamite'?'dynamite':'bullet',index}; }
function hudFeedbackEffect(actionId){ return profile.actions?.[actionId]?.hudImpulse || null; }
function hudFeedbackCompatibilityText(actionId){ const compatibility=effectCompatibility('hudImpulse',hudFeedbackEffect(actionId));return `${compatibilityBadge(compatibility)} · ${compatibilitySummary(compatibility)}`; }
function renderResourcePreview(){
  const canvas=$('resource-preview'); if(!canvas) return;
  const base=document.createElement('canvas'); base.width=320;base.height=64; const bctx=base.getContext('2d',{alpha:false}); bctx.imageSmoothingEnabled=false; bctx.fillStyle='#000';bctx.fillRect(0,0,320,64);
  if(holdB) bctx.drawImage(holdB,0,0,320,16,0,0,320,16);
  bctx.fillStyle='#000';bctx.fillRect(100,0,52,10);bctx.fillRect(164,0,52,10);bctx.fillRect(0,18,320,46);
  const drawAmmo=(kind,count)=>{ const xbase=kind==='dynamite'?168:104; for(let i=0;i<count;i++){ if(holdB) bctx.drawImage(holdB,xbase,0,8,8,xbase+i*8,0,8,8); else {bctx.fillStyle=kind==='dynamite'?'#e94d43':'#ff9a35';bctx.fillRect(xbase+2+i*8,1,4,6);} } };
  drawAmmo('bullets',resourcePreviewState.bullets);drawAmmo('dynamite',resourcePreviewState.dynamite);
  bctx.fillStyle='#dfe9f3';bctx.font='bold 12px ui-monospace,monospace';bctx.fillText(`BULLETS ${resourcePreviewState.bullets}/6`,12,38);bctx.fillText(`DYNAMITE ${resourcePreviewState.dynamite}/6`,116,38);bctx.fillText(`SCORE ${String(Math.max(0,resourcePreviewState.score)).padStart(6,'0')}`,12,56);
  const ctx=canvas.getContext('2d',{alpha:false}); ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,320,64);ctx.drawImage(base,0,0);hudPreviewRuntime.renderHudEffects(ctx,base);
  if($('resource-preview-status')) $('resource-preview-status').textContent=`HUD-only runtime · refill preview ${ammoDisplayName()} · no world/action effects are dispatched.`;
  if($('resource-preview-values')) $('resource-preview-values').textContent=`Bullets ${resourcePreviewState.bullets}/6 · Dynamite ${resourcePreviewState.dynamite}/6 · Score ${resourcePreviewState.score}`;
}
function resetResourcePreview(render=true){ for(const timer of resourceFillTimers) clearTimeout(timer); resourceFillTimers=[];hudPreviewRuntime.resetTransient();resourcePreviewState={ bullets:Math.max(0,Math.min(6,Number(latestSnapshot?.inventory?.bullets ?? 6))), dynamite:Math.max(0,Math.min(6,Number(latestSnapshot?.inventory?.dynamite ?? 6))), score:Number(latestSnapshot?.score||0) }; if(render) renderResourcePreview(); }
function emitResourcePreview(actionId, extra={}){ const bounds=latestSnapshot&&preview?preview.entityBounds(latestSnapshot,1):null; const x=bounds?(bounds.left+bounds.right)/2:160,y=bounds?(bounds.top+bounds.bottom)/2:100; hudPreviewRuntime.trigger({id:Date.now(),type:actionId,x,y,direction:latestSnapshot?.rick?.direction?1:-1,magnitude:1,targetSlot:1,targetBounds:bounds,frameSerial:Number(latestSnapshot?.frameSerial||0),manual:true,...extra}); }
function runResourcePreview(entryId){
  for(const timer of resourceFillTimers) clearTimeout(timer); resourceFillTimers=[];hudPreviewRuntime.resetTransient();
  const entry=HUD_FEEDBACK_ENTRIES.find(item=>item.id===entryId);if(!entry)return;
  if(entry.id==='ammo-use'){
    const kind=selectedAmmoKind(),resource=kind==='dynamite'?'dynamite':'bullet',current=resourcePreviewState[kind];
    if(current<=0){renderResourcePreview();return;}
    const after=current-1,visibleIndex=Math.max(0,after-1);
    resourcePreviewState[kind]=after;
    emitResourcePreview(entry.actionId,{resource,resourceBefore:current,resourceAfter:after,hudBounds:resourceHudBounds(kind,visibleIndex),hudSequence:[resourceHudBounds(kind,visibleIndex)]});renderResourcePreview();return;
  }
  if(entry.id==='ammo-collect'){
    const kind=selectedAmmoKind(),resource=kind==='dynamite'?'dynamite':'bullet';resourcePreviewState[kind]=0;renderResourcePreview();
    const seq=Array.from({length:6},(_,i)=>resourceHudBounds(kind,i));emitResourcePreview(entry.actionId,{resource,resourceBefore:0,resourceAfter:6,hudBounds:seq.at(-1),hudSequence:seq});
    const stagger=Math.max(1,Number(hudFeedbackEffect(entry.actionId)?.staggerFrames||1))*40;seq.forEach((_,i)=>resourceFillTimers.push(setTimeout(()=>{resourcePreviewState[kind]=i+1;renderResourcePreview();},i*stagger)));return;
  }
  const gain=500;resourcePreviewState.score+=gain;emitResourcePreview(entry.actionId,{points:gain,resource:'points',hudBounds:{left:12,top:44,right:108,bottom:60,resource:'points'},hudSequence:[{left:12,top:44,right:108,bottom:60,resource:'points'}]});renderResourcePreview();
}
function refreshHudFeedbackCompatibility(actionId){const effect=hudFeedbackEffect(actionId),compat=effectCompatibility('hudImpulse',effect);for(const marker of document.querySelectorAll('[data-hud-feedback-action]'))if(marker.dataset.hudFeedbackAction===actionId){marker.dataset.period=compat.compatible?'period':'enhanced';marker.textContent=hudFeedbackCompatibilityText(actionId);}}
function commitHudFeedback(actionId,mutate){ const effect=hudFeedbackEffect(actionId);if(!effect)return;mutate(effect);effect.resourceScope='event';profile=normalizeProfile(profile);syncProfiles();buildActionList();refreshHudFeedbackCompatibility(actionId);saveLocal();updateCostOnly(); }
function hudSelect(values,current,onChange){const select=document.createElement('select');for(const [value,label] of values){const option=document.createElement('option');option.value=value;option.textContent=label;select.appendChild(option);}select.value=current;select.addEventListener('change',()=>onChange(select.value));return select;}
function hudNumber(value,min,max,step,onChange){const input=document.createElement('input');input.type='number';input.min=String(min);input.max=String(max);input.step=String(step);input.value=String(value);input.addEventListener('input',()=>onChange(Number(input.value)));return input;}
function buildResourceFeedbackScreen(){
  const host=$('resource-feedback-grid');if(!host)return;host.textContent='';const refillKind=selectedAmmoKind()==='dynamite'?'dynamite':'bullet';
  for(const entry of HUD_FEEDBACK_ENTRIES){
    const effect=hudFeedbackEffect(entry.actionId);if(!effect)continue;const card=document.createElement('article');card.className='resource-feedback-card';
    const head=document.createElement('div');head.className='resource-feedback-head';const title=document.createElement('h3');title.textContent=entry.label;const compatibility=document.createElement('span');const compat=effectCompatibility('hudImpulse',effect);compatibility.className='period-accuracy compact';compatibility.dataset.period=compat.compatible?'period':'enhanced';compatibility.dataset.hudFeedbackAction=entry.actionId;compatibility.textContent=hudFeedbackCompatibilityText(entry.actionId);head.append(title,compatibility);
    const note=document.createElement('p');note.textContent=entry.note;
    const presetRow=document.createElement('div');presetRow.className='resource-card-actions';const preset=hudSelect(EFFECT_TEMPLATES.hudImpulse.map(item=>[item.id,`${item.label} · ${compatibilityBadge(effectCompatibility('hudImpulse',{...effect,...item.values}))}`]),'',value=>{if(!value)return;applyEffectTemplate(profile.actions[entry.actionId],'hudImpulse',value);profile=normalizeProfile(profile);syncProfiles();buildResourceFeedbackScreen();buildActionList();saveLocal();updateCostOnly();});const presetPrompt=document.createElement('option');presetPrompt.value='';presetPrompt.textContent='HUD piece preset…';preset.insertBefore(presetPrompt,preset.firstChild);preset.value='';presetRow.appendChild(preset);
    const grid=document.createElement('div');grid.className='resource-feedback-controls';
    const enabled=document.createElement('label');enabled.className='toggle';const check=document.createElement('input');check.type='checkbox';check.checked=!!effect.enabled;check.addEventListener('change',()=>commitHudFeedback(entry.actionId,live=>{live.enabled=check.checked;}));enabled.append(check,document.createTextNode(' Enabled'));grid.appendChild(enabled);
    const add=(label,control)=>{const row=document.createElement('label');row.textContent=label;row.appendChild(control);grid.appendChild(row);};
    add('Color',hudSelect([['white','White'],['gray','Gray'],['red','Red']],effect.color||'white',value=>commitHudFeedback(entry.actionId,live=>{live.color=value;})));
    add('Mask',hudSelect([['sprite','Token / digit pixels'],['square','Whole HUD rectangle']],effect.mask==='square'?'square':'sprite',value=>commitHudFeedback(entry.actionId,live=>{live.mask=value;})));
    add('Pattern',hudSelect([['tint','Tint'],['strobe','Strobe'],['spark','Pixel sparkle'],['cross','Spent cross'],['scan','Raster scan'],['hop','Token hop']],effect.pattern||'tint',value=>commitHudFeedback(entry.actionId,live=>{live.pattern=value;})));
    add('Frames',hudNumber(effect.frames,1,8,1,value=>commitHudFeedback(entry.actionId,live=>{live.frames=value;})));
    add('Opacity (1 = opaque)',hudNumber(effect.alpha,0.05,1,0.05,value=>commitHudFeedback(entry.actionId,live=>{live.alpha=value;})));
    add('Jitter px',hudNumber(effect.jitter,0,4,1,value=>commitHudFeedback(entry.actionId,live=>{live.jitter=value;})));
    if(entry.id==='ammo-collect')add('Token stagger frames',hudNumber(effect.staggerFrames,0,8,1,value=>commitHudFeedback(entry.actionId,live=>{live.staggerFrames=value;})));
    const actions=document.createElement('div');actions.className='resource-card-actions';const previewButton=document.createElement('button');previewButton.type='button';previewButton.textContent=entry.id==='ammo-collect'?`▶ Empty → full ${refillKind}`:entry.id==='points-collect'?'▶ Add 500 points':`▶ Use 1 ${refillKind==='dynamite'?'dynamite':'bullet'}`;previewButton.addEventListener('click',()=>runResourcePreview(entry.id));actions.appendChild(previewButton);
    card.append(head,note,presetRow,grid,actions);host.appendChild(card);
  }
  renderResourcePreview();
}

function stopAudioAuditionLoop(){ if(audioAuditionTimer){clearInterval(audioAuditionTimer);audioAuditionTimer=0;} if($('audio-screen-audition')) $('audio-screen-audition').textContent='▶ Audition effect'; }
async function auditionSelectedAudio(){if(editorMuted)return false;const audio=profile.actions[selectedAudioAction]?.audio;if(!audio)return false;runtimeB.audio.setSource(selectedAudioSource);return runtimeB.audio.audition(audio,1,{audioPan:audio.panFromEvent?.75:0,audioRate:1});}
function stopAudioReference(){if(audioReferenceTimer){clearInterval(audioReferenceTimer);audioReferenceTimer=0;}if(audioReferenceElement){try{audioReferenceElement.pause();audioReferenceElement.currentTime=0;}catch{}audioReferenceElement=null;}runtimeB.audio.setSource(selectedAudioSource);if($('audio-reference-play'))$('audio-reference-play').textContent='▶ Play reference';}
async function playAudioReference(){
  if(editorMuted){const status=$('audio-screen-status');if(status)status.textContent='Editor audio is muted from the header.';return false;}
  if(audioReferenceTimer||audioReferenceElement){stopAudioReference();return;}
  const kind=$('audio-reference-kind')?.value||'projectile', loop=!!$('audio-reference-loop')?.checked;
  if(kind==='startup' && typeof Audio!=='undefined'){
    runtimeB.audio.setSource('classic');
    for(const path of runtimeB.audio.paths('tune0.wav')){try{const a=new Audio(path);a.preload='auto';a.loop=loop;await a.play();audioReferenceElement=a;$('audio-reference-play').textContent='■ Stop reference';return;}catch{}}
  }
  runtimeB.audio.setSource(selectedAudioSource);const sample=kind==='walk'?'walk.wav':'ent4.wav', cadence=kind==='walk'?160:640;
  const fire=()=>runtimeB.audio.audition({enabled:true,sample,gain:kind==='walk'?.55:.5,pitchVariance:0,rate:1,pan:0,panFromEvent:false},1,null);
  await fire();if(loop){audioReferenceTimer=setInterval(fire,cadence);$('audio-reference-play').textContent='■ Stop reference';}
}

function bindToolScreens(){
  document.querySelectorAll('[data-juice-screen]').forEach(button=>button.addEventListener('click',()=>setJuiceScreen(button.dataset.juiceScreen,{toggle:true,scroll:true})));
  $('audio-screen-action')?.addEventListener('change',event=>{stopAudioAuditionLoop();selectedAudioAction=event.target.value;syncAudioScreen();syncAudioAudition();saveLocal();});
  $('audio-screen-source')?.addEventListener('change',event=>{stopAudioAuditionLoop();stopAudioReference();selectedAudioSource=event.target.value==='classic'?'classic':'cd32';runtimeB.audio.setSource(selectedAudioSource);const status=$('audio-screen-status');if(status)status.textContent=`Audition source: ${selectedAudioSource==='classic'?'Classic':'HG / CD32'}.`;saveLocal(true);});
  for(const id of ['audio-screen-enabled','audio-screen-sample','audio-screen-gain','audio-screen-pitch','audio-screen-rate','audio-screen-pan','audio-screen-event-pan','audio-screen-attack','audio-screen-release','audio-screen-filter','audio-screen-filter-hz','audio-screen-layer-sample','audio-screen-layer-gain','audio-screen-layer-rate']) $(id)?.addEventListener(id.includes('gain')||id.includes('pitch')||id.includes('rate')||id.includes('pan')||id.includes('attack')||id.includes('release')||id.includes('hz')?'input':'change',updateAudioScreenRecipe);
  $('audio-screen-audition')?.addEventListener('click',async()=>{const audio=profile.actions[selectedAudioAction]?.audio;if(!audio)return;const status=$('audio-screen-status');if(audioAuditionTimer){stopAudioAuditionLoop();if(status)status.textContent='Loop audition stopped.';return;}const ok=await auditionSelectedAudio();if($('audio-screen-loop')?.checked&&ok){const cadence=Math.max(60,Number($('audio-screen-loop-ms')?.value||240));audioAuditionTimer=setInterval(auditionSelectedAudio,cadence);$('audio-screen-audition').textContent='■ Stop loop';}if(status)status.textContent=ok?`Playing ${audio.sample} · gain ${Number(audio.gain).toFixed(2)}× · rate ${Number(audio.rate).toFixed(2)}×${audio.filterType!=='none'?` · ${audio.filterType} ${audio.filterHz}Hz`:''}${audio.layerSample?` + ${audio.layerSample}`:''}`:`Could not play ${audio.sample}.`;});
  $('audio-reference-play')?.addEventListener('click',playAudioReference);
  $('entity-audio-type')?.addEventListener('change',event=>{selectedEntityAudioType=event.target.value;syncEntityAudioScreen();saveLocal(true);});
  $('entity-audio-source')?.addEventListener('change',event=>{selectedAudioSource=event.target.value==='classic'?'classic':'cd32';runtimeB.audio.setSource(selectedAudioSource);syncEntityAudioScreen();saveLocal(true);});
  $('entity-audio-enabled')?.addEventListener('change',updateEntityAudioRecipe);
  for(const id of ['entity-audio-sample','entity-audio-gain','entity-audio-pitch','entity-audio-rate','entity-audio-pan','entity-audio-event-pan','entity-audio-attack','entity-audio-release','entity-audio-filter','entity-audio-filter-hz','entity-audio-layer-sample','entity-audio-layer-gain','entity-audio-layer-rate']) $(id)?.addEventListener(id.includes('gain')||id.includes('pitch')||id.includes('rate')||id.includes('pan')||id.includes('attack')||id.includes('release')||id.includes('hz')?'input':'change',()=>{if(!$('entity-audio-enabled').checked)$('entity-audio-enabled').checked=true;updateEntityAudioRecipe();});
  $('entity-audio-audition')?.addEventListener('click',auditionEntityAudio);
  $('transition-hook')?.addEventListener('change',()=>{if(transitionAnimationFrame)cancelAnimationFrame(transitionAnimationFrame);transitionAnimationFrame=0;transitionEntryPreviewArmed=selectedTransitionHook()!=='mapEntry';if($('transition-phase'))$('transition-phase').value='0';syncTransitionScreen();renderTransitionPreview(0);});
  for(const id of ['transition-preset','transition-duration','transition-direction','transition-origin','transition-origin-x','transition-origin-y']) $(id)?.addEventListener('change',commitTransitionScreen);
  $('transition-phase')?.addEventListener('input',event=>renderTransitionPreview(Number(event.target.value||0)/100)); $('transition-play')?.addEventListener('click',playTransitionPreview); $('resource-preview-reset')?.addEventListener('click',()=>resetResourcePreview(true)); $('resource-ammo-kind')?.addEventListener('change',()=>buildResourceFeedbackScreen()); setJuiceScreen(selectedScreen,{save:false});
}

function buildPresetSelect() {
  const select = $('perf-preset');
  for (const preset of Object.values(PERFORMANCE_PRESETS)) { const option = document.createElement('option'); option.value = preset.id; option.textContent = preset.label; select.appendChild(option); }
  select.value = profile.performancePreset;
}
function selectAction(actionId,{reveal=true,save=true}={}) {
  if (!ACTIONS.some(action => action.id === actionId)) return false;
  selectedAction = actionId;
  buildActionList();
  buildInspector();
  if (reveal) revealWorkspaceWindow('action-inspector');
  if (save) saveLocal();
  syncActionsWorkflowUi();
  return true;
}
function buildActionQuickSelect() {
  const select = $('action-quick-select'); if (!select) return;
  select.textContent = '';
  let group = '', optgroup = null;
  for (const action of ACTIONS) {
    if (action.group !== group) { group = action.group; optgroup = document.createElement('optgroup'); optgroup.label = group; select.appendChild(optgroup); }
    const option = document.createElement('option'); option.value = action.id; option.textContent = action.label; optgroup.appendChild(option);
  }
  select.value = selectedAction;
  select.addEventListener('change', () => selectAction(select.value));
}
function buildActionList() {
  const host = $('action-list'); host.textContent = ''; let group = '';
  for (const action of ACTIONS) {
    if (action.group !== group) { group = action.group; const heading = document.createElement('div'); heading.className = 'action-group'; heading.textContent = group; host.appendChild(heading); }
    const button = document.createElement('button'); button.type = 'button'; button.className = `action-button${action.id === selectedAction ? ' active' : ''}`; button.dataset.action = action.id;
    const cost = estimateActionCost(profile.actions[action.id]), compatibility = actionCompatibility(profile.actions[action.id]); button.innerHTML = `<span>${action.label}</span><small class="compat-inline ${compatibility.compatible ? 'compatible' : 'enhanced'}">${compatibilityBadge(compatibility)} · ${cost.points.toFixed(1)}</small>`;
    button.addEventListener('click', () => selectAction(action.id)); host.appendChild(button);
  }
  if ($('action-quick-select')) $('action-quick-select').value = selectedAction;
}
function gameStylePreview(templateId) {
  const scratch = normalizeProfile(cloneProfile(profile));
  if (!applyGameStyleTemplate(scratch, templateId)) return { cost:0, compatibility:profileCompatibility(scratch) };
  const normalized = normalizeProfile(scratch);
  return { cost:profileWorstCaseCost(normalized).totalPoints, compatibility:profileCompatibility(normalized) };
}
function downloadJson(filename,payload){const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function createCustomPreset(){
  const name=(prompt('Name this custom Juice preset','My custom preset')||'').trim(); if(!name)return;
  const id=`custom-${Date.now().toString(36)}`;
  const blank=normalizeProfile(cloneProfile(profile));
  applyGameStyleTemplate(blank,'reset-all');
  const item={schema:'rick-dangerous-revival.juice-custom-preset.v1',id,name,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),productionBase:null,profile:normalizeProfile(blank)};
  customPresets.push(item); activeCustomPresetId=id; selectedGameStyleKey=`custom:${id}`;
  profile=normalizeProfile(cloneProfile(item.profile));
  activePresetProvenance=capturePresetProvenance({source:'custom',label:item.name,profile});
  syncProfiles(); buildActionList(); buildInspector(); saveLocal(true); buildGameStylePicker();
  $('save-status').textContent=`Created blank custom preset “${name}”. Browse built-in styles/actions, copy pieces you like, return to this preset, paste, customize, then Save current.`;
}
function saveActiveCustomPreset(){const item=customPresets.find(p=>p.id===activeCustomPresetId);if(!item){alert('Create or select a custom preset first.');return;}const descriptor=productionPresetDescriptor({provenance:activePresetProvenance,profile});item.profile=normalizeProfile(cloneProfile(profile));item.productionBase=descriptor.productionKey?{key:descriptor.productionKey,editorStyleId:descriptor.editorStyleId,libretroValue:descriptor.libretroValue,label:descriptor.productionLabel||descriptor.label}:null;item.updatedAt=new Date().toISOString();if(selectedGameStyleKey===`custom:${item.id}`){activePresetProvenance=capturePresetProvenance({source:'custom',editorStyleId:item.productionBase?.editorStyleId||null,productionKey:item.productionBase?.key||null,libretroValue:item.productionBase?.libretroValue||null,label:item.name,profile});}saveLocal(true);buildGameStylePicker();$('save-status').textContent=`Saved current B feedback into custom preset “${item.name}”. Movement Feel is unchanged.`;}
function exportActiveCustomPreset(){const item=customPresets.find(p=>p.id===activeCustomPresetId);const payload=item?{...item,profile:normalizeProfile(cloneProfile(item.profile))}:{schema:'rick-dangerous-revival.juice-custom-preset.v1',id:'unsaved-current',name:profile.name||'Current B',exportedAt:new Date().toISOString(),profile:normalizeProfile(cloneProfile(profile))};downloadJson(`rick-dangerous-revival-juice-preset-${String(payload.name).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'custom'}.json`,payload);}

function buildGameStylePicker() {
  const host = $('game-style-picker'); if (!host) return; host.textContent = '';
  const box = document.createElement('section'); box.className = 'action-template-card game-style-card deluxe-game-style-card';
  const heading = document.createElement('div'); heading.className = 'template-heading'; heading.innerHTML = '<div><strong>Whole-game styles</strong><small>full editable B profiles · curated built-ins + your custom saved constructions</small></div>'; box.appendChild(heading);

  const selectLabel = document.createElement('label'); selectLabel.className = 'game-style-select-label';
  const selectTitle = document.createElement('span'); selectTitle.textContent = 'Preset library';
  const select = document.createElement('select');
  const empty = document.createElement('option'); empty.value = ''; empty.textContent = 'Choose whole-game style…'; select.appendChild(empty);
  const builtins=document.createElement('optgroup'); builtins.label='Built-in styles';
  for (const item of GAME_STYLE_TEMPLATES) { const option = document.createElement('option'); option.value = `builtin:${item.id}`; const preview=gameStylePreview(item.id); option.textContent = `${item.label} · ${compatibilityBadge(preview.compatibility)} · ${preview.cost.toFixed(1)} pts`; builtins.appendChild(option); }
  select.appendChild(builtins);
  if(customPresets.length){const custom=document.createElement('optgroup');custom.label='My custom presets';for(const item of customPresets){const option=document.createElement('option');option.value=`custom:${item.id}`;const compatibility=profileCompatibility(item.profile);option.textContent=`${item.name} · ${compatibilityBadge(compatibility)}${item.id===activeCustomPresetId?' · active destination':''}`;custom.appendChild(option);}select.appendChild(custom);}
  const validValues=new Set(Array.from(select.options).map(option=>option.value));
  if(selectedGameStyleKey && validValues.has(selectedGameStyleKey)) select.value=selectedGameStyleKey;
  else if(activeCustomPresetId && validValues.has(`custom:${activeCustomPresetId}`)) select.value=`custom:${activeCustomPresetId}`;
  else select.value='';
  selectedGameStyleKey = select.value || '';
  select.addEventListener('change',()=>{selectedGameStyleKey=select.value||'';updateSummary();saveLocal(true);});
  selectLabel.append(selectTitle,select); box.appendChild(selectLabel);

  const primary=document.createElement('div'); primary.className='game-style-primary-actions';
  const load=document.createElement('button'); load.type='button'; load.className='primary'; setIconButton(load,'load','Load selected style into editable B'); load.disabled=!select.value;
  const create=document.createElement('button'); create.type='button'; setIconButton(create,'add','Create new blank custom preset'); create.addEventListener('click',createCustomPreset);
  primary.append(load,create); box.appendChild(primary);

  const secondary=document.createElement('div'); secondary.className='game-style-secondary-actions';
  const save=document.createElement('button'); save.type='button'; setIconButton(save,'save','Save current B into active custom preset'); save.disabled=!activeCustomPresetId; save.addEventListener('click',saveActiveCustomPreset);
  const exportBtn=document.createElement('button'); exportBtn.type='button'; setIconButton(exportBtn,'export','Export active custom preset as JSON'); exportBtn.addEventListener('click',exportActiveCustomPreset);
  secondary.append(save,exportBtn); box.appendChild(secondary);

  const summary=document.createElement('div'); summary.className='game-style-summary';
  const title=document.createElement('strong');
  const body=document.createElement('p');
  const active=document.createElement('p'); active.className='game-style-active';
  summary.append(title,body,active); box.appendChild(summary);

  function updateSummary(){
    const [kind,id]=String(select.value||'').split(':'); load.disabled=!select.value;
    if(kind==='builtin'){
      const item=GAME_STYLE_TEMPLATES.find(candidate=>candidate.id===id);
      title.textContent=item?item.label:'Built-in style';
      if(item){const preview=gameStylePreview(item.id);body.textContent=`${compatibilityBadge(preview.compatibility)} · ${compatibilitySummary(preview.compatibility)} ${item.summary} Loading changes feedback B only; Movement Feel is unchanged.`;}else body.textContent='Choose a built-in style.';
    } else if(kind==='custom'){
      const item=customPresets.find(candidate=>candidate.id===id);
      title.textContent=item?`Custom preset · ${item.name}`:'Custom preset';
      if(item){const compatibility=profileCompatibility(item.profile);body.textContent=`${compatibilityBadge(compatibility)} · ${compatibilitySummary(compatibility)} Loads saved feedback into editable B only; Movement Feel is unchanged.`;}else body.textContent='Choose a custom preset.';
    } else {
      title.textContent='No style selected';
      body.textContent='Built-in styles replace the whole editable B feedback profile. Custom presets start blank and are feedback-only construction snapshots; Movement Feel is separate.';
    }
    const activePreset=customPresets.find(item=>item.id===activeCustomPresetId);
    active.textContent=activePreset?`Active custom destination: ${activePreset.name}`:'No active custom destination yet. Create one to start building your own style.';
  }
  updateSummary();

  load.addEventListener('click', () => {
    const [kind,id]=String(select.value||'').split(':'); if(!kind||!id)return;
    if(kind==='builtin'){
      const item=GAME_STYLE_TEMPLATES.find(candidate=>candidate.id===id); if(!item)return;
      const performancePreset=profile.performancePreset,adaptiveBudget=profile.adaptiveBudget;
      if(!applyGameStyleTemplate(profile,id))return;
      profile.performancePreset=performancePreset; profile.adaptiveBudget=adaptiveBudget; profile=normalizeProfile(profile);
      const productionPreset=productionPresetForEditorStyle(item.id);activePresetProvenance=capturePresetProvenance({source:'builtin',editorStyleId:item.id,productionKey:productionPreset?.key||null,libretroValue:productionPreset?.libretroValue||null,label:productionPreset?.label||item.label,profile});
      $('save-status').textContent=`Loaded built-in ${item.label} into B. Active custom destination remains ${customPresets.find(candidate=>candidate.id===activeCustomPresetId)?.name || 'unchanged'} until you press Save current B.`;
    } else if(kind==='custom'){
      const item=customPresets.find(candidate=>candidate.id===id); if(!item)return;
      activeCustomPresetId=item.id; selectedGameStyleKey=`custom:${item.id}`; profile=normalizeProfile(cloneProfile(item.profile));
      activePresetProvenance=capturePresetProvenance({source:'custom',editorStyleId:item.productionBase?.editorStyleId||null,productionKey:item.productionBase?.key||null,libretroValue:item.productionBase?.libretroValue||null,label:item.name,profile});
      $('save-status').textContent=`Loaded custom preset “${item.name}” into B.`;
    }
    syncProfiles(); buildActionList(); buildInspector(); saveLocal(true); buildGameStylePicker();
  });

  makeEffectCardCollapsible(box, heading, 'whole-game-styles');
  host.appendChild(box);
}

function actionTemplatePreview(actionId, templateId) {
  const scratch = cloneRecipe(profile.actions[actionId]);
  applyActionTemplate(scratch, actionId, templateId);
  return { cost:estimateActionCost(scratch), compatibility:actionCompatibility(scratch) };
}
function effectTemplatePreview(effectKey, templateId) {
  const scratch = cloneRecipe(profile.actions[selectedAction]);
  applyEffectTemplate(scratch, effectKey, templateId);
  return { cost:estimateActionCost(scratch), compatibility:effectCompatibility(effectKey, scratch[effectKey]) };
}
function appendTemplateOption(select, item, suffix = '') { const option = document.createElement('option'); option.value = item.id; option.textContent = `${item.label}${suffix}`; select.appendChild(option); }

function buildActionTemplatePicker(host) {
  const templates = ACTION_TEMPLATES[selectedAction] || []; if (!templates.length) return;
  const box = document.createElement('section'); box.className = 'action-template-card';
  const heading = document.createElement('div'); heading.className = 'template-heading'; heading.innerHTML = '<div><strong>Action feedback bundles</strong><small>multi-effect starting points for this action only</small></div>'; box.appendChild(heading);
  const controls = document.createElement('div'); controls.className = 'template-controls'; const select = document.createElement('select');
  const empty = document.createElement('option'); empty.value = ''; empty.textContent = 'Choose action feedback bundle…'; select.appendChild(empty);
  const resetOption=document.createElement('option'); resetOption.value='__reset_all'; resetOption.textContent='Reset all · CD32 ✓ · JUICE OFF for this action'; select.appendChild(resetOption);
  for (const item of templates) {
    const preview = actionTemplatePreview(selectedAction, item.id);
    appendTemplateOption(select, item, ` · ${compatibilityBadge(preview.compatibility)} · ${preview.cost.grade} ${preview.cost.points.toFixed(1)}`);
  }
  const apply = document.createElement('button'); apply.type = 'button'; apply.textContent = 'Apply bundle'; apply.disabled = true;
  const note = document.createElement('p'); note.className = 'template-note'; note.textContent = 'Bundles affect only this action; every effect remains independently editable.';
  select.addEventListener('change', () => {
    const item = templates.find(candidate => candidate.id === select.value), reset=select.value==='__reset_all';
    apply.disabled = !item && !reset;
    if (reset) note.textContent = 'CD32 ✓ · Disable every authored feedback piece for this action; native game behavior/audio remains available.';
    else if (item) { const preview=actionTemplatePreview(selectedAction,item.id); note.textContent=`${compatibilityBadge(preview.compatibility)} · ${compatibilitySummary(preview.compatibility)} ${item.summary}`; }
    else note.textContent = 'Bundles affect only this action; every effect remains independently editable.';
  });
  apply.addEventListener('click', () => {
    if (!select.value) return;
    if (select.value==='__reset_all') { for(const piece of Object.keys(EFFECT_TEMPLATES)) if(piece!=='hudImpulse')applyEffectTemplate(profile.actions[selectedAction],piece,'off'); profile.actions[selectedAction].enabled=true; }
    else applyActionTemplate(profile.actions[selectedAction], selectedAction, select.value);
    profile = normalizeProfile(profile); syncProfiles(); buildActionList(); buildInspector(); saveLocal(true);
  });
  controls.append(select, apply); box.append(controls, note); makeEffectCardCollapsible(box, heading, `action:${selectedAction}:feedback-bundles`); host.appendChild(box);
}
function buildEffectTemplatePicker(card, effectKey) {
  const templates = EFFECT_TEMPLATES[effectKey] || []; if (!templates.length) return;
  const recommended = templates.filter(item => item.recommendedFor.includes(selectedAction)); const others = templates.filter(item => !item.recommendedFor.includes(selectedAction));
  const row = document.createElement('div'); row.className = 'piece-template-row'; const select = document.createElement('select');
  const empty = document.createElement('option'); empty.value = ''; empty.textContent = 'Piece template…'; select.appendChild(empty);
  const addGroup = (label, items) => {
    if (!items.length) return;
    const group = document.createElement('optgroup'); group.label = label;
    for (const item of items) {
      const option = document.createElement('option'); option.value = item.id; const preview = effectTemplatePreview(effectKey, item.id);
      option.textContent = `${item.label} · ${compatibilityBadge(preview.compatibility)} · ${item.cost} · action ${preview.cost.points.toFixed(1)}`; group.appendChild(option);
    }
    select.appendChild(group);
  };
  addGroup('Recommended here', recommended); addGroup('Other options', others);
  const apply = document.createElement('button'); apply.type = 'button'; apply.textContent = 'Apply'; apply.disabled = true; const note = document.createElement('span'); note.className = 'piece-template-note'; note.textContent = 'Select a curated option.';
  select.addEventListener('change', () => {
    const item = templates.find(candidate => candidate.id === select.value); apply.disabled = !item;
    if (!item) note.textContent = 'Select a curated option.';
    else { const preview=effectTemplatePreview(effectKey,item.id); note.textContent = `${compatibilityBadge(preview.compatibility)} · ${compatibilitySummary(preview.compatibility)} ${item.summary} Cost class: ${item.cost}.`; }
  });
  apply.addEventListener('click', () => { if (!select.value) return; applyEffectTemplate(profile.actions[selectedAction], effectKey, select.value); profile = normalizeProfile(profile); syncProfiles(); buildActionList(); buildInspector(); saveLocal(); });
  row.append(select, apply); card.append(row, note);
}
function explosionPreviewVariantCount(config=explosionPreviewConfig){return config.sequenceFamily==='rolling'?REVIVAL_DYNAMITE_ROLLING_VARIANT_COUNT:REVIVAL_DYNAMITE_EXPLOSION_VARIANT_COUNT;}
function explosionPreviewSprite(instance,config){
  const frame=config.sequenceFamily==='rolling'?revivalRollingExplosionFrame(instance.age,instance.variant):revivalDynamiteFrame('explosion',Math.max(1,9-instance.age),instance.variant);
  return frame?{canvas:authoredWeaponPreviewCanvas(frame,'dynamite'),anchorX:Number(frame.footAnchorX??frame.originX??0),anchorY:Number(frame.footAnchorY??frame.originY??0),cel:Number(frame.frameIndex??0)-(config.sequenceFamily==='rolling'?0:17)}:null;
}
function renderExplosionFamilyPreview(canvas,frame,config,path,diagnostics){
  const ctx=canvas.getContext('2d',{alpha:false});if(!ctx)return;canvas.width=320;canvas.height=120;ctx.imageSmoothingEnabled=false;
  ctx.fillStyle='#081018';ctx.fillRect(0,0,320,120);
  ctx.fillStyle='#172330';ctx.fillRect(0,84,320,36);ctx.fillStyle='#233241';for(let x=0;x<320;x+=16)ctx.fillRect(x,84+(x/16%2?8:0),12,4);
  const drawInstances=()=>{for(const instance of frame.instances){const sprite=explosionPreviewSprite(instance,config);if(!sprite?.canvas)continue;ctx.drawImage(sprite.canvas,Math.round(instance.x-sprite.anchorX),Math.round(instance.y-sprite.anchorY));}};
  const drawMidground=()=>{ctx.fillStyle='#3c5562';ctx.fillRect(20,69,280,7);ctx.fillStyle='#a45b20';for(const x of [24,88,152,216,280])ctx.fillRect(x,65,7,15);};
  const drawActors=()=>{const hero=classicHeroFrameCanvas(11);if(hero)ctx.drawImage(hero,144,55,32,21);else{ctx.fillStyle='#d4c263';ctx.fillRect(150,57,16,24);}};
  const drawForeground=()=>{ctx.fillStyle='#5a4637';ctx.fillRect(184,28,18,70);ctx.fillStyle='#8c6d4f';ctx.fillRect(188,28,4,70);ctx.fillStyle='#2c211b';ctx.fillRect(202,28,6,70);};
  if(config.renderPlane==='backdrop')drawInstances();drawMidground();if(config.renderPlane==='midground')drawInstances();drawActors();if(config.renderPlane==='actors')drawInstances();if(config.renderPlane==='foreground')drawInstances();drawForeground();if(config.renderPlane==='frontActors')drawInstances();
  ctx.save();ctx.strokeStyle='rgba(114,199,255,.72)';ctx.lineWidth=1;ctx.setLineDash([3,3]);ctx.beginPath();path.forEach((point,index)=>{if(index===0)ctx.moveTo(point.x+.5,point.y+.5);else ctx.lineTo(point.x+.5,point.y+.5);});ctx.stroke();ctx.setLineDash([]);
  for(const point of frame.spawned){ctx.fillStyle='#78c7ff';ctx.fillRect(point.x-1,point.y-1,3,3);}if(frame.source){ctx.strokeStyle='#fff2a3';ctx.strokeRect(frame.source.x-2.5,frame.source.y-2.5,5,5);}ctx.restore();
  ctx.fillStyle='#d7e0e6';ctx.font='10px ui-monospace,monospace';ctx.fillText(`tick ${frame.tick} · active ${frame.instances.length}/${config.maxActiveInstances} · emitted ${diagnostics.spawnCount}`,7,14);
  ctx.fillStyle='#90a6b5';ctx.fillText(`age/cel ${frame.instances.map(item=>{const sprite=explosionPreviewSprite(item,config);return `${item.age}/${sprite?.cel??'—'}`;}).join(',')||'—'} · plane ${config.renderPlane}`,7,28);
}
function buildExplosionFamilyPreviewCard(host){
  if(!['dynamite.explode','ammo.explode'].includes(selectedAction))return;
  const card=document.createElement('section');card.className='effect-card explosion-family-preview-card';
  const title=document.createElement('div');title.className='effect-title';title.innerHTML='<div><strong>Explosion family · flipbook / path instancing</strong><small>authoring preview · gameplay source remains native</small></div>';
  const note=document.createElement('p');note.className='template-note';note.textContent='Inspect a single authored burst or a bounded world-anchored trail. The dashed line is the representative preview source path; blue marks are new emission points and the yellow square is the current source position.';
  const canvas=document.createElement('canvas');canvas.className='explosion-family-preview-canvas';canvas.setAttribute('aria-label','Explosion path-instancing preview');
  const toolbar=document.createElement('div');toolbar.className='explosion-family-preview-toolbar';const play=document.createElement('button');play.type='button';play.textContent='Pause';const scrub=document.createElement('input');scrub.type='range';scrub.min='0';scrub.step='1';scrub.setAttribute('aria-label','Explosion preview logical tick');const status=document.createElement('span');status.className='attached-emitter-pose-status';toolbar.append(play,scrub,status);
  const fields=document.createElement('div');fields.className='effect-fields explosion-family-preview-fields';
  const selectField=(label,key,values,labels={})=>{const select=document.createElement('select');for(const value of values){const option=document.createElement('option');option.value=value;option.textContent=labels[value]||value;select.appendChild(option);}select.value=explosionPreviewConfig[key];select.addEventListener('change',()=>update({[key]:select.value}));const row=document.createElement('label');row.textContent=label;row.appendChild(select);fields.appendChild(row);return select;};
  const numberField=(label,key,min,max,step=1)=>{const input=document.createElement('input');input.type='number';input.min=String(min);input.max=String(max);input.step=String(step);input.value=String(explosionPreviewConfig[key]);input.addEventListener('input',()=>update({[key]:Number(input.value)}));const row=document.createElement('label');row.textContent=label;row.appendChild(input);fields.appendChild(row);return input;};
  let timeline=[],diagnostics={},tick=0,playing=true,lastAdvance=performance.now(),variantInput;
  const path=EXPLOSION_PREVIEW_DEFAULT_PATH;
  const refresh=()=>{const count=explosionPreviewVariantCount(explosionPreviewConfig);explosionPreviewConfig=normalizeExplosionPreviewConfig({...explosionPreviewConfig,variantCount:count,completeVariant:Math.min(explosionPreviewConfig.completeVariant,count-1)});timeline=explosionPreviewTimeline(path,explosionPreviewConfig);diagnostics=explosionPreviewDiagnostics(path,explosionPreviewConfig);scrub.max=String(Math.max(0,timeline.length-1));tick=Math.max(0,Math.min(tick,timeline.length-1));scrub.value=String(tick);if(variantInput){variantInput.max=String(Math.max(0,count-1));variantInput.value=String(explosionPreviewConfig.completeVariant);variantInput.disabled=count<=1;}const frame=timeline[tick]||{tick:0,instances:[],spawned:[],source:null};renderExplosionFamilyPreview(canvas,frame,explosionPreviewConfig,path,diagnostics);status.textContent=`${explosionPreviewConfig.spawnMode} · ${explosionPreviewConfig.spacingPx}px · max ${diagnostics.maxActive} active · ${diagnostics.spacingMin||0}–${diagnostics.spacingMax||0}px emitted spacing`;};
  const update=patch=>{explosionPreviewConfig=normalizeExplosionPreviewConfig({...explosionPreviewConfig,...patch,variantCount:explosionPreviewVariantCount({...explosionPreviewConfig,...patch})});saveLocal(true);tick=0;refresh();};
  selectField('Sequence family','sequenceFamily',EXPLOSION_PREVIEW_SEQUENCE_FAMILIES,{large:'Large · Boiling Crown',rolling:'Compact · Rolling Cells'});variantInput=numberField('Complete variant','completeVariant',0,31);selectField('Spawn mode','spawnMode',EXPLOSION_PREVIEW_SPAWN_MODES,{once:'Once', 'source-step':'Source step',distance:'Distance'});numberField('Spacing px','spacingPx',1,32);numberField('Max active instances','maxActiveInstances',1,8);selectField('Variant policy','variantPolicy',EXPLOSION_PREVIEW_VARIANT_POLICIES,{fixed:'Fixed complete variant',cycle:'Deterministic cycle',seed:'Stable seed'});numberField('Variant seed','variantSeed',0,2147483647);selectField('Render plane','renderPlane',EXPLOSION_PREVIEW_RENDER_PLANES,{backdrop:'Backdrop',midground:'Midground',actors:'Actors',foreground:'Foreground',frontActors:'Front actors'});
  scrub.addEventListener('input',()=>{tick=Number(scrub.value)||0;playing=false;play.textContent='Play';refresh();});play.addEventListener('click',()=>{playing=!playing;play.textContent=playing?'Pause':'Play';lastAdvance=performance.now();});
  card.append(title,note,canvas,toolbar,fields);makeEffectCardCollapsible(card,title,`action:${selectedAction}:explosion-family-preview`);host.appendChild(card);refresh();
  const animate=now=>{if(!canvas.isConnected)return;if(playing&&timeline.length&&now-lastAdvance>=40){const steps=Math.max(1,Math.floor((now-lastAdvance)/40));lastAdvance+=steps*40;tick=(tick+steps)%timeline.length;refresh();}requestAnimationFrame(animate);};requestAnimationFrame(animate);
}

function buildExplosionNearMissGameplayCard(host) {
  if (selectedAction !== 'player.explosion_near_miss') return;
  const card=document.createElement('section');card.className='effect-card';
  const title=document.createElement('div');title.className='effect-title';title.innerHTML='<div><strong>Gameplay response · explosion shockwave</strong><small>authoritative shared xrick collision</small></div>';
  const note=document.createElement('p');note.className='template-note';note.textContent='Shockwave reach is owned by the Dynamite bounce radius runtime option. Game Juice may tune only the upward lift applied after the simple signed-distance gameplay check.';
  const fields=document.createElement('div');fields.className='effect-fields';
  const specs=[
    ['explosionNearBounceLift','Upward lift px/frame',.25,5,.25]
  ];
  for(const [key,label,min,max,step] of specs){const field=document.createElement('label');field.textContent=label;const input=document.createElement('input');input.type='number';input.min=min;input.max=max;input.step=step;input.value=gameplayTuning[key];input.addEventListener('input',()=>{gameplayTuning[key]=Number(input.value);applyGameplayTuning();});field.appendChild(input);fields.appendChild(field);}
  const reset=document.createElement('button');reset.type='button';reset.textContent='Reset shockwave lift';reset.addEventListener('click',()=>{gameplayTuning.explosionNearBounceLift=DEFAULT_GAMEPLAY_TUNING.explosionNearBounceLift;applyGameplayTuning();buildInspector();});
  card.append(title,note,fields,reset);makeEffectCardCollapsible(card,title,`action:${selectedAction}:explosion-near-miss`);host.appendChild(card);
}

function setIconButton(button, kind, label) {
  const icons = {
    copy:'<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="7" y="6" width="9" height="10" rx="1.5"></rect><path d="M5 13H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1"></path></svg>',
    paste:'<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 4.5h6"></path><path d="M8 2.5h4a1 1 0 0 1 1 1v2H7v-2a1 1 0 0 1 1-1Z"></path><rect x="4" y="5" width="12" height="13" rx="2"></rect></svg>',
    load:'<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2v10"></path><path d="m6.5 8.5 3.5 3.5 3.5-3.5"></path><path d="M3 14v3h14v-3"></path></svg>',
    add:'<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12"></path></svg>',
    save:'<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 3h11l3 3v11H3Z"></path><path d="M6 3v5h7V3M6 17v-5h8v5"></path></svg>',
    export:'<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 13V3"></path><path d="m6.5 6.5 3.5-3.5 3.5 3.5"></path><path d="M4 10v7h12v-7"></path></svg>',
    import:'<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v10"></path><path d="m6.5 9.5 3.5 3.5 3.5-3.5"></path><path d="M4 10v7h12v-7"></path></svg>'
  };
  button.classList.add('icon-button'); button.innerHTML = icons[kind] || ''; button.title = label; button.setAttribute('aria-label', label);
}

function addEffectClipboardControls(title,effectKey,effect){
  const tools=document.createElement('span');tools.className='effect-clipboard-tools';
  const copy=document.createElement('button');copy.type='button';setIconButton(copy,'copy',`Copy complete ${EFFECT_META[effectKey]?.label || effectKey} settings`);
  const paste=document.createElement('button');paste.type='button';setIconButton(paste,'paste',`Paste complete ${EFFECT_META[effectKey]?.label || effectKey} settings`);paste.disabled=effectClipboard?.effectKey!==effectKey;
  copy.addEventListener('click',()=>{effectClipboard=copyLiveEffectClipboardPayload(profile,selectedAction,effectKey);$('save-status').textContent=`Copied complete ${EFFECT_META[effectKey]?.label || effectKey} settings from ${ACTIONS.find(a=>a.id===selectedAction)?.label || selectedAction}.`;buildInspector();});
  paste.addEventListener('click',()=>{if(effectClipboard?.effectKey!==effectKey)return;const pasted=pasteEffectClipboardPayload(profile,selectedAction,effectClipboard);if(!pasted)return;profile=pasted;syncProfiles();buildActionList();buildInspector();saveLocal(true);$('save-status').textContent=`Pasted complete ${EFFECT_META[effectKey]?.label || effectKey} settings from ${ACTIONS.find(a=>a.id===effectClipboard.sourceAction)?.label || effectClipboard.sourceAction}.`;});
  tools.append(copy,paste);title.appendChild(tools);
}

function refreshActionClipboardControls(){
  const paste=$('action-paste');
  // External JSON is available even before this editor has copied an action.
  if(paste)paste.disabled=false;
}

function openActionClipboardDialog(mode, text, message, targetAction=selectedAction){
  const dialog=$('action-clipboard-dialog');
  dialog.dataset.targetAction=targetAction;
  const copying=mode==='copy';
  $('action-clipboard-title').textContent=copying?'Copy action JSON':`Paste action into ${ACTIONS.find(action=>action.id===targetAction)?.label||targetAction}`;
  $('action-clipboard-message').textContent=message;
  $('action-clipboard-text').value=text;
  $('action-clipboard-text').readOnly=copying;
  $('action-clipboard-apply').hidden=copying;
  $('action-clipboard-close').textContent=copying?'Done':'Cancel';
  dialog.showModal();
  $('action-clipboard-text').focus();
  if(copying)$('action-clipboard-text').select();
}

async function copySelectedActionConfiguration(){
  actionClipboard=copyActionClipboardPayload(profile,gameplayTuning,selectedAction);
  if(!actionClipboard)return;
  const text=JSON.stringify(actionClipboard,null,2);
  refreshActionClipboardControls();
  const source=ACTIONS.find(action=>action.id===selectedAction)?.label||selectedAction;
  try{
    await navigator.clipboard.writeText(text);
    $('save-status').textContent=`Copied ${source} action JSON to the clipboard. HUD feedback stays separate.`;
  }catch{
    openActionClipboardDialog('copy',text,'Clipboard access is unavailable. Copy the selected JSON with ⌘C / Ctrl+C.');
    $('save-status').textContent=`${source} action JSON is ready to copy.`;
  }
}

function applyActionClipboardText(text,targetAction){
  const payload=parseActionClipboardText(text);
  const result=pasteActionClipboardPayload(profile,gameplayTuning,targetAction,payload);
  if(!result)throw new Error('This action configuration could not be pasted.');
  actionClipboard=payload;
  profile=result.profile;gameplayTuning=result.gameplayTuning;
  if(result.appliedGameplayFields.length)applyGameplayTuning({save:false});
  syncProfiles();buildActionList();buildInspector();saveLocal(true);
  const source=ACTIONS.find(action=>action.id===payload.sourceAction)?.label||payload.sourceAction;
  const target=ACTIONS.find(action=>action.id===targetAction)?.label||targetAction;
  const gameplayNote=result.appliedGameplayFields.length?` Action-specific gameplay copied too (${result.appliedGameplayFields.length} fields).`:'';
  $('save-status').textContent=`Pasted complete action configuration ${source} → ${target}.${gameplayNote}`;
}

async function pasteSelectedActionConfiguration(){
  // A permission prompt must not redirect the paste if selection changes meanwhile.
  const targetAction=selectedAction;
  let text;
  try{ text=await navigator.clipboard.readText(); }
  catch{
    openActionClipboardDialog('paste',actionClipboard?JSON.stringify(actionClipboard,null,2):'',
      'Clipboard access is unavailable. Paste action JSON here. Any prefilled text is the last action copied in this editor.',targetAction);
    return;
  }
  if(!text.trim()){
    openActionClipboardDialog('paste',actionClipboard?JSON.stringify(actionClipboard,null,2):'',
      actionClipboard?'The clipboard is empty. Review the last action copied in this editor, or paste different action JSON.':'The clipboard is empty. Paste action JSON here.',targetAction);
    return;
  }
  try{ applyActionClipboardText(text,targetAction); }
  catch(error){ openActionClipboardDialog('paste',text,error.message,targetAction); }
}


function actionPreviewPresentation(){return preview?.presentation||$('presentation-source')?.value||'classic';}
const ACTION_PREVIEW_BULLET_ACTIONS=new Set(['weapon.fire','bullet.wall_hit','bullet.target_hit','projectile.near_miss','player.projectile_hit']);
const ACTION_PREVIEW_DYNAMITE_ACTIONS=new Set(['dynamite.place','dynamite.fuse','dynamite.explode','ammo.explode','dynamite.target_hit','player.explosion_hit','player.explosion_near_miss','blockage.crumble']);
const ACTION_PREVIEW_FOOT_ACTIONS=new Set(['player.step','player.turn','player.jump','player.bounce_back','player.land']);
function actionPreviewFrames(actionId,direction){
  const presentation=actionPreviewPresentation();
  if(presentation==='rdx'){
    const pn=actionPreviewRdxPn(actionId,direction),rows=rdxHeroFrameCatalog(latestSnapshot?.map).filter(row=>row.pn===pn && row.canvas);
    if(rows.length)return rows.map(row=>({canvas:row.canvas,label:row.label,presentation:'rdx',durationMs:row.durationMs}));
    const fallback=currentHeroPoseCanvas();if(fallback)return [{canvas:fallback,label:`RDX live Hero · PN${pn.toString(16).toUpperCase()}`,presentation:'rdx'}];
  }
  return actionPreviewClassicFrames(actionId,direction).map(frameId=>({canvas:classicHeroFrameCanvas(frameId),label:CLASSIC_HERO_FRAME_META.find(row=>row.id===frameId)?.label||`Classic frame ${frameId}`,presentation:'classic'})).filter(row=>row.canvas);
}
function actionPreviewEnabledEffects(recipe){
  const names=[];
  for(const key of ACTION_INSPECTOR_EFFECT_KEYS){const meta=EFFECT_META[key];if(recipe?.[key]?.enabled && key!=='audio')names.push(meta.label);}
  if(profile.motionTrail?.enabled)names.push('Motion trail');
  return names;
}
function actionPreviewRuntimeProfile(sourceProfile,actionId){
  /* Keep the authored recipe numerically identical to gameplay. The mini stage
   * is a 2x visualization, so JuiceRuntime applies ACTION_PREVIEW_ZOOM through
   * setSpatialScale(); mutating emitter size/anchor fields here caused clamping
   * back to 1..4 and 32x21 and was the source of the v2.1.95/96 mismatch. */
  const isolated=actionPreviewIsolatedProfile(sourceProfile,actionId);
  /* HUD reactions are authored and previewed only in the dedicated HUD tool.
   * The action mini-stage therefore cannot make an unrelated action look as
   * though it owns inventory feedback. */
  if(isolated.actions?.[actionId]?.hudImpulse)isolated.actions[actionId].hudImpulse.enabled=false;
  return isolated;
}
function actionPreviewProfileSignature(actionId){
  return JSON.stringify({action:profile.actions?.[actionId]||null,motionTrail:profile.motionTrail||null,performancePreset:profile.performancePreset,adaptiveBudget:profile.adaptiveBudget,nearMissAnchor:actionId==='projectile.near_miss'?actionPreviewNearMissAnchor:null});
}
function actionPreviewTintCanvas(source,color='white'){
  const out=document.createElement('canvas');out.width=source.width;out.height=source.height;const ctx=out.getContext('2d');if(!ctx)return source;
  const tones={red:'#ff5050',gray:'#8d9aa3','off-white':'#eadca8','faint-white':'#b6bec2',white:'#ffffff'};
  ctx.drawImage(source,0,0);ctx.globalCompositeOperation='source-in';ctx.fillStyle=tones[color]||tones.white;ctx.fillRect(0,0,out.width,out.height);ctx.globalCompositeOperation='source-over';return out;
}
function actionPreviewSpriteRect(source,centerX,bottom,presentation=actionPreviewPresentation(),forcedScale=null){
  if(!source?.width||!source?.height)return {left:centerX-16,top:bottom-21,right:centerX+16,bottom};
  /* RDX PI frames contain deliberate transparent container padding. The live
   * compositor places them by the recovered PI/foot anchor, not by the 32x32
   * canvas bottom. Earlier LA-preview code bottom-aligned that container,
   * making the visible 20x20 Rick float ~8 source pixels above the floor and
   * look much smaller than Classic. Use the same recovered anchor metadata and
   * the same 3x visible-pixel authoring zoom as Classic. */
  const placement=rdxFramePlacementByCanvas.get(source),scale=forcedScale??ACTION_PREVIEW_ZOOM;
  if(presentation!=='classic'&&placement){
    const left=Math.round(centerX-placement.anchorX*scale),top=Math.round(bottom-placement.anchorY*scale);
    return {left,top,right:left+source.width*scale,bottom:top+source.height*scale,scale,anchorX:placement.anchorX,anchorY:placement.anchorY};
  }
  const dw=source.width*scale,dh=source.height*scale;
  return {left:Math.round(centerX-dw/2),top:Math.round(bottom-dh),right:Math.round(centerX-dw/2+dw),bottom:Math.round(bottom),scale};
}
function drawActionPreviewSprite(ctx,source,centerX,bottom,{presentation='classic',scale=null}={}){
  if(!source)return null;const rect=actionPreviewSpriteRect(source,centerX,bottom,presentation,scale);
  ctx.drawImage(source,0,0,source.width,source.height,rect.left,rect.top,rect.right-rect.left,rect.bottom-rect.top);return rect;
}
function actionPreviewOpaqueBounds(source){
  if(!source?.width||!source?.height)return null;if(actionPreviewOpaqueBoundsCache.has(source))return actionPreviewOpaqueBoundsCache.get(source);
  let out=null;try{const data=source.getContext('2d',{willReadFrequently:true})?.getImageData(0,0,source.width,source.height)?.data;let minX=source.width,minY=source.height,maxX=-1,maxY=-1;if(data)for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++)if(data[(y*source.width+x)*4+3]){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}if(maxX>=minX&&maxY>=minY)out={minX,minY,maxX,maxY};}catch{}actionPreviewOpaqueBoundsCache.set(source,out);return out;
}
function drawActionPreviewCenteredProp(ctx,source,centerX,centerY,{scale=ACTION_PREVIEW_ZOOM}={}){
  if(!source)return null;const opaque=actionPreviewOpaqueBounds(source)||{minX:0,minY:0,maxX:source.width-1,maxY:source.height-1},cx=(opaque.minX+opaque.maxX+1)/2,cy=(opaque.minY+opaque.maxY+1)/2,left=Math.round(centerX-cx*scale),top=Math.round(centerY-cy*scale);ctx.drawImage(source,left,top,source.width*scale,source.height*scale);return {left:left+opaque.minX*scale,top:top+opaque.minY*scale,right:left+(opaque.maxX+1)*scale,bottom:top+(opaque.maxY+1)*scale};
}
function drawActionPreviewGroundedProp(ctx,source,centerX,floorY,{scale=ACTION_PREVIEW_ZOOM}={}){
  if(!source)return null;const opaque=actionPreviewOpaqueBounds(source)||{minX:0,minY:0,maxX:source.width-1,maxY:source.height-1},cx=(opaque.minX+opaque.maxX+1)/2,left=Math.round(centerX-cx*scale),top=Math.round(floorY-(opaque.maxY+1)*scale);ctx.drawImage(source,left,top,source.width*scale,source.height*scale);return {left:left+opaque.minX*scale,top:top+opaque.minY*scale,right:left+(opaque.maxX+1)*scale,bottom:floorY};
}

function authoredWeaponPreviewCanvas(frame,role){
  if(!frame?.pixels)return null;const canvas=pixelBufferCanvas(frame.pixels);if(!canvas)return null;
  const anchor=role==='projectile'?{x:Number(frame.originX??0),y:Number(frame.originY??0)}:{x:Number(frame.footAnchorX??frame.originX??frame.pixels.width/2),y:Number(frame.footAnchorY??frame.originY??frame.pixels.height)};
  rdxFramePlacementByCanvas.set(canvas,{anchorX:anchor.x,anchorY:anchor.y,role,pn:Number(frame.pn?.index??0xff),frameIndex:Number(frame.frameIndex||0),pfIndex:Number(frame.pfIndex??0xffff),durationTicks:1});
  return canvas;
}
function actionPreviewBombTicker(bomb){
  const progress=Math.max(0,Math.min(1,Number(bomb?.progress)||0));
  if(bomb?.phase==='explode')return Math.max(1,Math.min(9,Math.round(9-progress*8)));
  if(bomb?.phase==='fuse')return Math.max(10,Math.min(45,Math.round(45-progress*35)));
  return 45;
}

function actionPreviewBulletSprite(story){
  const direction=Number(story?.bullet?.direction||story?.direction)<0?-1:1;
  if(actionPreviewBulletSource==='revival'){
    const canvas=authoredWeaponPreviewCanvas(revivalBulletFrame(0,direction<0),'projectile');
    if(canvas)return {canvas,presentation:'revival',scale:2};
  }
  return {canvas:classicPreviewSpriteCanvas(direction<0?CLASSIC_PREVIEW_SPRITES.bulletLeft:CLASSIC_PREVIEW_SPRITES.bulletRight),presentation:'classic',scale:2};
}
function actionPreviewBombSprite(story){
  const bomb=story?.dynamite;if(!bomb?.visible)return null;
  if(actionPreviewDynamiteSource==='revival'){
    const role=bomb.phase==='explode'?'explosion':'fuse',ticker=actionPreviewBombTicker(bomb);
    const canvas=authoredWeaponPreviewCanvas(revivalDynamiteFrame(role,ticker),'dynamite');
    if(canvas)return {canvas,presentation:'revival',scale:2};
  }
  if(bomb.phase==='explode'){
    const seq=CLASSIC_PREVIEW_SPRITES.bombExplosion,index=Math.min(seq.length-1,Math.floor(Math.max(0,Math.min(.999,bomb.progress||0))*seq.length));return {canvas:classicPreviewSpriteCanvas(seq[index]),presentation:'classic',scale:2};
  }
  if(bomb.phase==='plant')return {canvas:classicPreviewSpriteCanvas(CLASSIC_PREVIEW_SPRITES.bombA),presentation:'classic',scale:2};
  const seq=CLASSIC_PREVIEW_SPRITES.bombFuse,index=Math.min(seq.length-1,Math.floor(Math.max(0,Math.min(.999,bomb.progress||0))*seq.length));return {canvas:classicPreviewSpriteCanvas(seq[index]),presentation:'classic',scale:2};
}
function actionPreviewPlatformSprite(){
  const live=currentMovingPlatformPoseCanvas();
  if(live)return {canvas:live,presentation:actionPreviewPresentation(),scale:1};
  if(actionPreviewPresentation()==='rdx'){
    const frame=rdxPreviewFramesForPn(24,latestSnapshot?.map,{role:'moving-platform',mark:'preview-platform'})[0]?.canvas;
    if(frame)return {canvas:frame,presentation:'rdx',scale:2};
  }
  return null;
}
function actionPreviewAssetCanvas(key,draw){
  if(actionPreviewAssetCanvasCache.has(key))return actionPreviewAssetCanvasCache.get(key);
  const canvas=document.createElement('canvas');canvas.width=8;canvas.height=8;const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;draw(ctx);actionPreviewAssetCanvasCache.set(key,canvas);return canvas;
}
const ACTION_PREVIEW_CLASSIC_PALETTE=Object.freeze([[0,0,0],[216,0,0],[176,108,104],[248,144,104],[32,36,32],[0,72,176],[0,108,216],[32,72,0],[72,108,32],[72,36,0],[144,72,0],[216,108,0],[72,72,72],[104,108,104],[144,144,144],[176,180,176]]);
const ACTION_PREVIEW_CLASSIC_HUD=Object.freeze({
  bullet:Object.freeze(['000cdc00','000dfd00','000dfd00','000dfd00','000dfd00','000cec00','000dfd00','00000000']),
  dynamite:Object.freeze(['000cd000','0091b190','00ab3ba0','0091b190','0091b190','00ab3ba0','0091b190','00000000']),
  life:Object.freeze(['009aba90','0aaaaaaa','003afa30','09a333a9','0a9cdc9a','039a9a93','0ced0dec','00000000'])
});
const ACTION_PREVIEW_RDX_HUD=Object.freeze({
  jungle:Object.freeze({paletteLine:3,blank:0xb,bullet:Object.freeze([0xba,0x19,0x3a,0xbb,0xb1,0x93,0xa1,0xbb,0xb3,0x93,0xa3,0xbb,0xb3,0x93,0xa3,0xbb,0xb5,0x45,0x57,0xbb,0xb5,0x25,0x76,0xbb,0xb2,0x24,0x67,0xbb,0xbb,0xbb,0xbb,0xbb]),dynamite:Object.freeze([0xbb,0xbb,0xbb,0xa2,0xbb,0xbb,0xa7,0x22,0xbb,0xba,0x74,0x56,0xbb,0xa7,0x45,0x76,0xba,0x74,0x77,0x6b,0xa7,0x57,0x76,0xbb,0xa8,0x77,0x6b,0xbb,0xba,0xaa,0xbb,0xbb]),life:Object.freeze([0xbb,0xac,0xaa,0xbb,0xba,0xc5,0x58,0xcb,0xba,0x65,0x65,0xab,0xc6,0xc8,0x39,0xab,0x66,0x8c,0x14,0x56,0xa8,0x65,0x45,0x6b,0xbc,0x88,0x6c,0xab,0xbb,0xcc,0xaa,0xbb])}),
  castle:Object.freeze({paletteLine:0,blank:0xf,bullet:Object.freeze([0xf3,0x61,0x67,0xff,0xf6,0x16,0x76,0xff,0xf6,0x16,0x76,0xff,0xf6,0x16,0x76,0xff,0xfd,0x8d,0x8a,0xff,0xfd,0xcd,0xa8,0xff,0xfc,0xcd,0x8a,0xff,0xff,0xff,0xff,0xff]),dynamite:Object.freeze([0xff,0xff,0xff,0x3c,0xff,0xff,0x7a,0xcc,0xff,0xf7,0xac,0xda,0xff,0x7a,0xcd,0xa8,0xf7,0xac,0xaa,0x8f,0x7a,0xda,0xa8,0xff,0x75,0xaa,0x8f,0xff,0xf7,0x77,0xff,0xff]),life:Object.freeze([0xff,0x77,0x77,0xff,0xf7,0x7d,0xd7,0x7f,0xf7,0x8d,0x8d,0x7f,0x78,0x67,0x61,0x7f,0x88,0x77,0x6e,0xd8,0x77,0x8d,0xcd,0x8f,0xf7,0x77,0x87,0x7f,0xff,0x77,0x77,0xff])}),
  missile:Object.freeze({paletteLine:3,blank:0xf,bullet:Object.freeze([0xfd,0x81,0x8d,0x0f,0xf7,0x17,0xb7,0x0f,0xf8,0x97,0xb8,0x0f,0xf8,0x97,0xb8,0x0f,0xf3,0x33,0x36,0x0f,0xf3,0x23,0x64,0x0f,0xf2,0x22,0x46,0x0f,0xff,0xff,0xff,0xff]),dynamite:Object.freeze([0xff,0xff,0xfd,0x20,0xff,0xff,0x62,0x20,0xff,0xfd,0x23,0x40,0xff,0xd6,0x36,0x40,0xfd,0x62,0x64,0xf0,0xd6,0x36,0x4f,0xf0,0xdd,0x66,0xff,0xf0,0xfd,0xdd,0xff,0xf0]),life:Object.freeze([0xff,0xdd,0xdd,0xff,0xfd,0xd3,0x35,0xff,0xfd,0x43,0x43,0xdf,0xd5,0xd5,0x79,0xdf,0x44,0x5d,0x82,0x34,0xd4,0x43,0x23,0x4f,0xfd,0x44,0x45,0xdf,0xff,0xdd,0xdd,0xff])})
});
function actionPreviewRdxHudFamily(mapId){const id=Number(mapId)||3;if(id>=25&&id<=44)return ACTION_PREVIEW_RDX_HUD.castle;if(id>=46)return ACTION_PREVIEW_RDX_HUD.missile;return ACTION_PREVIEW_RDX_HUD.jungle;}
function actionPreviewClassicHudIcon(kind){
  const rows=ACTION_PREVIEW_CLASSIC_HUD[kind]||ACTION_PREVIEW_CLASSIC_HUD.life;return actionPreviewAssetCanvas(`classic-hud-${kind}`,ctx=>{const image=ctx.createImageData(8,8);for(let y=0;y<8;y++)for(let x=0;x<8;x++){const index=parseInt(rows[y][x],16)||0,o=(y*8+x)*4;if(index===0)continue;const rgb=ACTION_PREVIEW_CLASSIC_PALETTE[index];image.data[o]=rgb[0];image.data[o+1]=rgb[1];image.data[o+2]=rgb[2];image.data[o+3]=255;}ctx.putImageData(image,0,0);});
}
function actionPreviewRdxHudIcon(kind,mapId){
  const family=actionPreviewRdxHudFamily(mapId),palette=rdxPoseAuthoring.palettes?.forMap(Number(mapId)||3)?.rgba;if(!palette)return null;const tile=family[kind]||family.life,key=`rdx-hud-${Number(mapId)||3}-${kind}`;return actionPreviewAssetCanvas(key,ctx=>{const image=ctx.createImageData(8,8);for(let y=0;y<8;y++)for(let x=0;x<8;x++){const byte=tile[y*4+(x>>1)],index=(x&1)?(byte&15):(byte>>4);if(index===family.blank)continue;const rgb=palette[family.paletteLine*16+index]||[255,255,255,255],o=(y*8+x)*4;image.data[o]=rgb[0];image.data[o+1]=rgb[1];image.data[o+2]=rgb[2];image.data[o+3]=255;}ctx.putImageData(image,0,0);});
}
function actionPreviewHudIcon(kind){return actionPreviewPresentation()==='rdx'?(actionPreviewRdxHudIcon(kind,latestSnapshot?.map)||actionPreviewClassicHudIcon(kind)):actionPreviewClassicHudIcon(kind);}
function actionPreviewCollectibleSprite(){
  if(actionPreviewPresentation()==='rdx'){const seq=rdxPreviewFramesForPn(0x1b,latestSnapshot?.map,{mirrorX:false,role:'collectible'});if(seq.length)return {canvas:seq[0],presentation:'rdx'};}
  return {canvas:classicPreviewSpriteCanvas(CLASSIC_PREVIEW_SPRITES.collectible),presentation:'classic'};
}
function actionPreviewTargetSprite(direction=1){
  const live=currentEnemyPoseCanvas();if(live)return {canvas:live,presentation:actionPreviewPresentation()};
  const key=`preview-target-${direction<0?'left':'right'}`;
  const canvas=actionPreviewAssetCanvas(key,ctx=>{
    ctx.canvas.width=16;ctx.canvas.height=21;ctx.clearRect(0,0,16,21);
    const px=(x,y,w=1,h=1,c='#000')=>{ctx.fillStyle=c;ctx.fillRect(x,y,w,h);};
    px(6,0,4,2,'#b07a4b'); px(4,2,8,2,'#c79a5a'); px(5,4,6,2,'#e1c594');
    px(4,6,8,7,'#3f6f8e'); px(3,8,2,5,'#c6d5df'); px(11,8,2,5,'#c6d5df');
    px(5,13,2,7,'#775745'); px(9,13,2,7,'#775745'); px(4,20,4,1,'#d9d9d9'); px(8,20,4,1,'#d9d9d9');
    if(direction<0){const copy=document.createElement('canvas');copy.width=16;copy.height=21;copy.getContext('2d').drawImage(ctx.canvas,0,0);ctx.clearRect(0,0,16,21);ctx.save();ctx.scale(-1,1);ctx.drawImage(copy,-16,0);ctx.restore();}
  });
  return {canvas,presentation:'classic'};
}
function drawHudIconStrip(ctx,x,count,key,hudBounds){
  const icon=actionPreviewHudIcon(key),scale=2,step=16;let focusRect={left:x,top:47,right:x+16,bottom:63};
  for(let i=0;i<6;i+=1){const left=x+i*step,top=47;if(i<count&&icon){ctx.drawImage(icon,left,top,8*scale,8*scale);focusRect={left,top,right:left+16,bottom:top+16};}}
  Object.assign(hudBounds[key],focusRect);
}
function drawActionPreviewHud(ctx,story,hudBounds){
  const hud=story?.hud;if(!hud)return;
  ctx.fillStyle='#020508';ctx.fillRect(0,28,320,52);ctx.strokeStyle='#52616b';ctx.strokeRect(.5,28.5,319,51);
  let bullets=6,dynamite=6,lives=3,score=12500;
  if(hud.kind==='ammo-deplete')bullets=story.t>=700?5:6;
  if(hud.kind==='ammo-collect')bullets=Math.max(0,Math.min(6,Math.floor((hud.progress||0)*7)));
  if(hud.kind==='points')score=12500+(story.t>=700?500:Math.round(500*(hud.progress||0)));
  drawHudIconStrip(ctx,8,bullets,'bullet',hudBounds);drawHudIconStrip(ctx,112,dynamite,'dynamite',hudBounds);drawHudIconStrip(ctx,224,lives,'life',hudBounds);
  ctx.fillStyle='#f1d58a';ctx.font='bold 14px ui-monospace,monospace';ctx.fillText(String(score).padStart(6,'0'),126,75);Object.assign(hudBounds.points,{left:122,top:62,right:180,bottom:78});
}
function actionPreviewBlockageSprite(stage=null){
  const canvas=document.createElement('canvas');canvas.width=32;canvas.height=21;const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;
  const index=stage===null?null:Math.max(0,Math.min(2,Math.round(Number(stage)||0)));
  const top=classicPreviewSpriteCanvas(index===null?CLASSIC_PREVIEW_SPRITES.blockageTop:CLASSIC_PREVIEW_SPRITES.blockageCrumbleTop[index]);
  const bottom=classicPreviewSpriteCanvas(index===null?CLASSIC_PREVIEW_SPRITES.blockageBottom:CLASSIC_PREVIEW_SPRITES.blockageCrumbleBottom[index]);
  if(top)ctx.drawImage(top,0,0);if(bottom)ctx.drawImage(bottom,3,0);
  return {canvas,stage:index};
}
function actionPreviewScene(frameCanvas,direction=1,actionId=selectedAction,story=actionPreviewStoryboard(actionId,0,direction,gameplayTuning)){
  const width=320,height=136,baseBottom=112,presentation=actionPreviewPresentation(),z=ACTION_PREVIEW_ZOOM,heroCenter=160+Number(story?.heroX||0)*z,heroBottom=baseBottom+Number(story?.heroY||0)*z;
  const background=document.createElement('canvas');background.width=width;background.height=height;const bg=background.getContext('2d');bg.imageSmoothingEnabled=false;
  bg.fillStyle='#081018';bg.fillRect(0,0,width,height);bg.fillStyle='#0d1b25';for(let y=0;y<baseBottom;y+=8)for(let x=(y/8%2)*8;x<width;x+=16)bg.fillRect(x,y,8,8);
  bg.fillStyle='#26333d';bg.fillRect(0,baseBottom,width,height-baseBottom);bg.fillStyle='#4d5c65';for(let x=0;x<width;x+=16)bg.fillRect(x,baseBottom,8,3);
  if(actionId==='blockage.crumble'){
    bg.fillStyle='#100819';bg.fillRect(0,0,width,baseBottom);
    bg.fillStyle='#17102a';for(let y=8;y<baseBottom;y+=16)for(let x=((y/16)%2)*16;x<width;x+=32)bg.fillRect(x,y,28,12);
    bg.fillStyle='#aaa88b';for(const [x,y,w,h] of [[0,0,70,25],[0,74,76,38],[246,0,74,32],[260,32,60,80],[92,84,52,28]])bg.fillRect(x,y,w,h);
    bg.fillStyle='#6e6b5b';for(const [x,y,w,h] of [[0,23,70,3],[0,109,76,3],[246,29,74,3],[260,60,60,3],[92,109,52,3]])bg.fillRect(x,y,w,h);
    bg.fillStyle='#9d5520';bg.fillRect(130,baseBottom-8,130,8);bg.fillStyle='#4f2512';for(let x=132;x<258;x+=12)bg.fillRect(x,baseBottom-6,8,3);
  }
  const hudBounds={bullet:{left:8,top:47,right:24,bottom:63},dynamite:{left:112,top:47,right:128,bottom:63},life:{left:224,top:47,right:240,bottom:63},points:{left:122,top:62,right:180,bottom:78}};
  drawActionPreviewHud(bg,story,hudBounds);
  /* Production classifies dynamic entity pixels separately from scenery before
   * applying a presentation-layer mask. The isolated preview still draws its
   * utility props into the background canvas for the established visual order,
   * so mirror only those opaque pixels into a transparent classification canvas.
   * Without this, the delayed backdrop ripple can reinterpret the RDX dynamite
   * sprite as scenery and replace it with gray/white blocks. */
  const propActor=document.createElement('canvas');propActor.width=width;propActor.height=height;const pc=propActor.getContext('2d');pc.imageSmoothingEnabled=false;
  const actor=document.createElement('canvas');actor.width=width;actor.height=height;const ac=actor.getContext('2d');ac.imageSmoothingEnabled=false;
  let bounds={left:heroCenter-16*z,top:heroBottom-21*z,right:heroCenter+16*z,bottom:heroBottom},heroVisibleBounds=bounds;
  if(story?.heroVisible!==false&&frameCanvas){
    bounds=drawActionPreviewSprite(ac,frameCanvas,heroCenter,heroBottom,{presentation})||bounds;
    const opaque=actionPreviewOpaqueBounds(frameCanvas),scale=Number(bounds.scale||z);
    if(opaque)heroVisibleBounds={left:bounds.left+opaque.minX*scale,top:bounds.top+opaque.minY*scale,right:bounds.left+(opaque.maxX+1)*scale,bottom:bounds.top+(opaque.maxY+1)*scale};
  }
  if(story?.wall){bg.fillStyle='#53636d';const wx=story.direction>0?278:26;bg.fillRect(wx,30,16,baseBottom-30);bg.fillStyle='#768791';for(let y=34;y<baseBottom;y+=16)bg.fillRect(wx+(y%32?0:8),y,8,3);}
  const propPositions={};
  if(story?.bullet){
    const bullet=actionPreviewBulletSprite(story),d=Number(story.bullet.direction||story.direction)<0?-1:1;
    let cx,cy;
    if(actionId==='projectile.near_miss'){
      cx=heroCenter+Number(story.bullet.x||0)*z;cy=heroBottom+Number(story.bullet.y||0)*z;
    }else if(actionId==='player.projectile_hit'){
      const p=Math.max(0,Math.min(1,Number(story.bullet.progress||0))),heroImpactX=(heroVisibleBounds.left+heroVisibleBounds.right)/2,heroImpactY=heroVisibleBounds.top+(heroVisibleBounds.bottom-heroVisibleBounds.top)*.45,startX=d>0?24:296;
      cx=startX+(heroImpactX-startX)*p;cy=heroImpactY;
      if(story.bullet.impact){cx=heroImpactX;cy=heroImpactY;}
    }else{
      /* xrick e_bullet_init() launches at Rick y+6 and the collision centre is
       * y+11 in the 21px Classic pose. Use the visible shoot-pose midpoint,
       * not the transparent sprite-container bottom. */
      const muzzleX=d>0?heroVisibleBounds.right+2:heroVisibleBounds.left-2,muzzleY=heroVisibleBounds.top+(heroVisibleBounds.bottom-heroVisibleBounds.top)*11/21,p=Math.max(0,Math.min(1,Number(story.bullet.progress??0)));
      cx=muzzleX;cy=muzzleY;
      if(actionId==='bullet.wall_hit'){
        const wallFace=d>0?278:42,endX=wallFace-d*3;cx=muzzleX+(endX-muzzleX)*p;if(story.bullet.impact)cx=endX;
      }else if(actionId==='bullet.target_hit'&&story.target?.visible){
        const targetX=160+Number(story.target.x||0)*z,endX=targetX-d*8,endY=baseBottom-21;cx=muzzleX+(endX-muzzleX)*p;cy=muzzleY+(endY-muzzleY)*p;if(story.bullet.impact){cx=endX;cy=endY;}
      }else{
        const travel=Math.max(0,Math.abs(Number(story.bullet.x||0))-27)*z;cx=muzzleX+d*travel;
      }
    }
    if(story.bullet.visible){
      const rect=drawActionPreviewCenteredProp(bg,bullet.canvas,cx,cy,{scale:z});
      drawActionPreviewCenteredProp(pc,bullet.canvas,cx,cy,{scale:z});
      propPositions.bullet=rect?{x:(rect.left+rect.right)/2,y:(rect.top+rect.bottom)/2}:{x:cx,y:cy};
    }else{
      propPositions.bullet={x:cx,y:cy};
    }
  }
  if(story?.blockage?.visible){
    const blockage=actionPreviewBlockageSprite(story.blockage.crumbling?story.blockage.stage:null),cx=160+Number(story.blockage.x||0)*z,bottom=baseBottom+Number(story.blockage.y||0)*z;
    const rect=drawActionPreviewGroundedProp(bg,blockage.canvas,cx,bottom,{scale:z});
    drawActionPreviewGroundedProp(pc,blockage.canvas,cx,bottom,{scale:z});
    propPositions.blockage=rect?{x:(rect.left+rect.right)/2,y:(rect.top+rect.bottom)/2}:{x:cx,y:bottom-10*z};
  }
  if(story?.dynamite?.visible){
    const bomb=actionPreviewBombSprite(story),distance=Number(story.dynamite.distancePx),cx=Number.isFinite(distance)?(story.direction>0?heroVisibleBounds.right+18+distance*z:heroVisibleBounds.left-18-distance*z):heroCenter+Number(story.dynamite.x||0)*z,anchorY=baseBottom;
    const rect=bomb?drawActionPreviewGroundedProp(bg,bomb.canvas,cx,anchorY,{scale:z}):null;
    if(bomb)drawActionPreviewGroundedProp(pc,bomb.canvas,cx,anchorY,{scale:z});
    propPositions.dynamite=rect?{x:(rect.left+rect.right)/2,y:(rect.top+rect.bottom)/2}:{x:cx,y:anchorY-18*z};
    if(Number.isFinite(distance)){bg.fillStyle='#9cb0be';bg.font='10px ui-monospace,monospace';bg.fillText(`${Math.round(distance)} px`,Math.min(270,Math.max(8,(heroCenter+cx)/2-14)),baseBottom-4);}
  }
  if(story?.collectible?.visible){
    const collectible=actionPreviewCollectibleSprite(),cx=160+Number(story.collectible.x||0)*z,bottom=baseBottom,rect=drawActionPreviewGroundedProp(bg,collectible.canvas,cx,bottom,{scale:z});
    drawActionPreviewGroundedProp(pc,collectible.canvas,cx,bottom,{scale:z});
    propPositions.collectible=rect?{x:(rect.left+rect.right)/2,y:(rect.top+rect.bottom)/2}:{x:cx,y:bottom-8*z};
  }
  const targetActor=document.createElement('canvas');targetActor.width=width;targetActor.height=height;const tc=targetActor.getContext('2d');tc.imageSmoothingEnabled=false;let targetBounds=null;
  if(story?.target?.visible){
    const target=actionPreviewTargetSprite(story.direction),cx=160+Number(story.target.x||0)*z,bottom=baseBottom+Number(story.target.y||0)*z;targetBounds=drawActionPreviewGroundedProp(tc,target.canvas,cx,bottom,{scale:z});
    propPositions.target=targetBounds?{x:(targetBounds.left+targetBounds.right)/2,y:(targetBounds.top+targetBounds.bottom)/2}:{x:cx,y:bottom-10*z};
  }
  if(story?.platform?.visible){
    const cx=160+Number(story.platform.x||0)*z,bottom=baseBottom-8+Number(story.platform.y||0)*z,platform=actionPreviewPlatformSprite();
    if(platform?.canvas){
      targetBounds=drawActionPreviewGroundedProp(tc,platform.canvas,cx,bottom,{scale:Number(platform.scale)||z});
    }
    if(!targetBounds){
      const w=32*z,h=12*z,left=Math.round(cx-w/2),top=Math.round(bottom-h);
      tc.fillStyle=story.platform.running?'#a87642':'#697985';tc.fillRect(left,top,w,h);tc.fillStyle='#d0b46d';for(let x=left+4;x<left+w;x+=12)tc.fillRect(x,top+3,7,3);tc.fillStyle='#202a31';tc.fillRect(left,top+h-3,w,3);
      targetBounds={left,top,right:left+w,bottom:top+h};
    }
    propPositions.platform={x:cx,y:(targetBounds.top+targetBounds.bottom)/2};
  }
  const targetBackground=document.createElement('canvas');targetBackground.width=width;targetBackground.height=height;const tbc=targetBackground.getContext('2d');tbc.imageSmoothingEnabled=false;tbc.drawImage(background,0,0);tbc.drawImage(actor,0,0);
  const composite=document.createElement('canvas');composite.width=width;composite.height=height;const cc=composite.getContext('2d');cc.imageSmoothingEnabled=false;cc.drawImage(targetBackground,0,0);cc.drawImage(targetActor,0,0);
  /* Match the production compositor's foreground-aware effect path. The mini
   * stage has no native Plane-A buffer, so expose a deterministic synthetic
   * mask for its actual foreground geometry (floor + optional wall). This is
   * what makes contact-flash scope, world ripple and foreground dust controls
   * visibly respond in LA-preview instead of silently falling back to area. */
  const foregroundMask=new Uint8Array(320*200);for(let y=baseBottom;y<200;y++)foregroundMask.fill(1,y*320,(y+1)*320);
  if(story?.wall){const wx=story.direction>0?278:26;for(let y=30;y<baseBottom;y++)foregroundMask.fill(1,y*320+wx,y*320+Math.min(320,wx+16));}
  const presentationLayers=new Uint8Array(320*200);
  presentationLayers.fill(PRESENTATION_LAYER_BITS.backdrop,8*320);
  for(let y=Math.max(8,baseBottom-32);y<baseBottom;y++)presentationLayers.fill(PRESENTATION_LAYER_BITS.midground,y*320,(y+1)*320);
  const markCanvasLayer=(canvas,bit)=>{try{const data=canvas.getContext('2d').getImageData(0,0,width,height).data;for(let y=8;y<height;y++)for(let x=0;x<width;x++)if(data[(y*width+x)*4+3])presentationLayers[y*320+x]=bit;}catch{}};
  markCanvasLayer(propActor,PRESENTATION_LAYER_BITS.actors);markCanvasLayer(actor,PRESENTATION_LAYER_BITS.actors);markCanvasLayer(targetActor,PRESENTATION_LAYER_BITS.actors);
  for(let i=8*320;i<foregroundMask.length;i++)if(foregroundMask[i])presentationLayers[i]=PRESENTATION_LAYER_BITS.foreground;
  presentationLayers.fill(PRESENTATION_LAYER_BITS.hud,0,8*320);
  const actorLayer={bounds,canvas:actor,backgroundCanvas:background,tintCanvas:color=>actionPreviewTintCanvas(actor,color)};
  const targetLayer=targetBounds?{bounds:targetBounds,canvas:targetActor,backgroundCanvas:targetBackground,tintCanvas:color=>actionPreviewTintCanvas(targetActor,color)}:null;
  return {width,height,background,propActor,actor,targetActor,composite,bounds,heroVisibleBounds,targetBounds,hudBounds,actorLayer,targetLayer,foregroundMask,presentationLayers,direction:Number(direction)<0?-1:1,propPositions,story,heroCenter,heroBottom,spatialScale:ACTION_PREVIEW_ZOOM};
}
function actionPreviewEvent(actionId,scene,direction,frameSerial=0){
  const offset=actionPreviewEventOffset(actionId,direction),centerX=(scene.bounds.left+scene.bounds.right)/2,centerY=(scene.bounds.top+scene.bounds.bottom)/2,inventory=scene.hudBounds,z=Number(scene.spatialScale)||ACTION_PREVIEW_ZOOM;
  /* actionPreviewEventOffset() is expressed in native gameplay pixels. The
   * isolated stage draws actors/props at z×, so generic event origins must be
   * scaled by the same factor. Prop-bound events below replace these values
   * with exact rendered centers and therefore must not be multiplied again. */
  let x=centerX+offset.x*z,y=centerY+offset.y*z,hudBounds=inventory.bullet;
  /* Live gameplay emits movement-contact feedback from the visible Hero foot
   * line. Use that same semantic anchor here instead of the padded actor box
   * centre so dust remains attached in Classic and RDX previews. */
  if(ACTION_PREVIEW_FOOT_ACTIONS.has(actionId)&&scene.heroVisibleBounds){x=(scene.heroVisibleBounds.left+scene.heroVisibleBounds.right)/2;y=scene.heroVisibleBounds.bottom-1;}
  if(scene.propPositions?.bullet&&(actionId==='weapon.fire'||actionId==='bullet.wall_hit'||actionId==='bullet.target_hit'||actionId==='player.projectile_hit'||actionId==='projectile.near_miss')){x=scene.propPositions.bullet.x;y=scene.propPositions.bullet.y;}
  if(scene.propPositions?.dynamite&&actionId.startsWith('dynamite.')){x=scene.propPositions.dynamite.x;y=scene.propPositions.dynamite.y;hudBounds=inventory.dynamite;}
  if(scene.propPositions?.dynamite&&['ammo.explode','player.explosion_hit','player.explosion_near_miss'].includes(actionId)){x=scene.propPositions.dynamite.x;y=scene.propPositions.dynamite.y;}
  if(scene.propPositions?.collectible&&actionId==='pickup.collect'){x=scene.propPositions.collectible.x;y=scene.propPositions.collectible.y;}
  if(scene.propPositions?.blockage&&actionId==='blockage.crumble'){x=scene.propPositions.blockage.x;y=scene.propPositions.blockage.y;}
  if(scene.propPositions?.target&&actionId==='bullet.target_hit'){x=scene.propPositions.target.x;y=scene.propPositions.target.y;}
  /* Explosion target-hit keeps the blast origin on the dynamite while targetSlot/targetBounds identify the enemy. Moving x/y to the enemy made particles and world flashes detach from the explosion. */
  if(actionId==='player.projectile_hit'||actionId==='player.explosion_hit')hudBounds=inventory.life;
  if(actionId==='points.collect')hudBounds=inventory.points;
  const nearStrength=Math.max(.01,Math.min(1,Number(scene.story?.dynamite?.strengthPercent??100)/100));
  const representativeMagnitude=actionId==='bullet.wall_hit'?0.75:actionId==='player.explosion_near_miss'?nearStrength:actionId==='dynamite.fuse'?Math.max(.25,Math.min(1,.25+.75*Number(scene.story?.dynamite?.progress||0))):1;
  const extra=actionId==='player.explosion_near_miss'?{explosionDistancePx:Number(scene.story?.dynamite?.distancePx||0),explosionStrengthPercent:Number(scene.story?.dynamite?.strengthPercent||0)}:{};
  const platformTarget=actionId.startsWith('platform.')&&scene.targetBounds;
  if(platformTarget&&scene.propPositions?.platform){x=scene.propPositions.platform.x;y=scene.propPositions.platform.y;}
  const targetHit=(['bullet.target_hit','enemy.stick_hit','dynamite.target_hit'].includes(actionId)||platformTarget)&&scene.targetBounds;
  return {id:`inspector-preview-${actionId}-${frameSerial}`,type:actionId,magnitude:representativeMagnitude,x,y,direction:Number(direction)<0?-1:1,targetSlot:targetHit?Number(scene.targetSlot??4):1,targetBounds:{...(targetHit?scene.targetBounds:scene.bounds)},frameSerial,hudBounds:{...hudBounds},hudSequence:[{...hudBounds}],hudInventoryBounds:{bullet:{...inventory.bullet},dynamite:{...inventory.dynamite},life:{...inventory.life}},...extra};
}
function recordActionPreviewTrail(trailState,scene){
  if(!trailState||scene.story?.heroVisible===false)return;const current={x:scene.heroCenter,y:scene.heroBottom,actorCanvas:scene.actor};const last=trailState.history.at(-1);if(!last||Math.hypot(current.x-last.x,current.y-last.y)>=.5){trailState.history.push(current);while(trailState.history.length>12)trailState.history.shift();}
}
function renderActionPreviewMotionTrail(ctx,scene,runtime,trailState){
  const trail=profile.motionTrail;if(!trail?.enabled||!trailState?.history?.length||scene.story?.heroVisible===false)return;
  const copies=Math.max(0,Math.min(8,Number(trail.copies)||0)),cap=Math.max(0,Number(runtime.preset.maxTrails)||0);if(!copies||!cap)return;
  const older=trailState.history.slice(Math.max(0,trailState.history.length-copies-1),-1).slice(-cap);
  for(let i=0;i<older.length;i++){const point=older[i],age=older.length-i,ageFade=1-(age-1)/Math.max(1,copies+1),tinted=actionPreviewTintCanvas(point.actorCanvas||scene.actor,trail.color);ctx.save();const opacity=Number(trail.alpha ?? 1);ctx.globalAlpha=opacity>=.999?1:Math.max(.03,opacity*ageFade);ctx.drawImage(tinted,Math.round(point.x-scene.heroCenter),Math.round(point.y-scene.heroBottom));ctx.restore();}
}
function actionPreviewSoloSurface(scene){
  if(!actionPreviewPresentationSolo)return {canvas:scene.composite,layers:scene.presentationLayers};
  const bit=PRESENTATION_LAYER_BITS[actionPreviewPresentationSolo]||0,canvas=document.createElement('canvas');canvas.width=scene.width;canvas.height=scene.height;const ctx=canvas.getContext('2d');if(!ctx)return {canvas:scene.composite,layers:scene.presentationLayers};
  const source=scene.composite.getContext('2d').getImageData(0,0,scene.width,scene.height),out=ctx.createImageData(scene.width,scene.height),layers=new Uint8Array(scene.presentationLayers.length);
  for(let y=0;y<scene.height;y++)for(let x=0;x<scene.width;x++){const i=y*320+x;if(!(scene.presentationLayers[i]&bit))continue;layers[i]=scene.presentationLayers[i];const p=(y*scene.width+x)*4;out.data[p]=source.data[p];out.data[p+1]=source.data[p+1];out.data[p+2]=source.data[p+2];out.data[p+3]=source.data[p+3];}
  ctx.putImageData(out,0,0);return {canvas,layers};
}
function renderActionPreviewCanvas(canvas,runtime,frameCanvas,direction,actionId,story,trailState=null){
  const scene=actionPreviewScene(frameCanvas,direction,actionId,story),ctx=canvas.getContext('2d',{alpha:false});if(!ctx)return scene;
  canvas.width=scene.width;canvas.height=scene.height;ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,scene.width,scene.height);const renderCtx=ctx;
  const solo=actionPreviewSoloSurface(scene),soloActors=!actionPreviewPresentationSolo||['actors','frontActors'].includes(actionPreviewPresentationSolo),soloHud=!actionPreviewPresentationSolo||actionPreviewPresentationSolo==='hud';
  recordActionPreviewTrail(trailState,scene);const camera=runtime.cameraOffset();renderCtx.save();renderCtx.translate(Math.round(camera.x),Math.round(camera.y));renderCtx.drawImage(solo.canvas,0,0);if(soloActors)renderActionPreviewMotionTrail(renderCtx,scene,runtime,trailState);
  const actorResolver=scene.actorResolver||(slot=>Number(slot)===1&&story?.heroVisible!==false?scene.actorLayer:Number(slot)===Number(scene.targetSlot??4)?scene.targetLayer:null),actorSlots=scene.actorSlots||[...(story?.heroVisible===false?[]:[1]),...(scene.targetLayer?[Number(scene.targetSlot??4)]:[])];
  /* Keep this pass order identical to renderPane(): prepare authored source-band
   * emissions, draw actor-depth feedback, restore foreground/front actors, then
   * apply explicit presentation-band modifiers and screen-anchored HUD. */
  runtime.prepareWorldEffects(solo.layers,scene.foregroundMask);
  if(soloActors)runtime.renderActorEffects(renderCtx,actorResolver,{fireHeld:actionId==='weapon.fire',actionHeld:['player.staff_hold','dynamite.place','dynamite.fuse'].includes(actionId),presentation:actionPreviewPresentation()});
  if(soloActors)runtime.renderActorDepthEffects(renderCtx,{foregroundMask:scene.foregroundMask,actorResolver,actorSlots});
  restoreAboveActorDepth(renderCtx,solo.canvas,solo.layers,scene.width,scene.height);
  runtime.renderWorldEffects(renderCtx,solo.layers,scene.foregroundMask,{prepare:false});
  runtime.renderPresentationEffects(renderCtx,{foregroundMask:scene.foregroundMask,actorResolver,actorSlots});renderCtx.restore();if(soloHud)runtime.renderHudEffects(renderCtx,solo.canvas);
  return scene;
}
function nativeActionPreviewFocusPoint(actionId,captured){
  const snapshot=captured?.snapshot;if(!snapshot)return {x:LIVE_WIDTH/2,y:LIVE_HEIGHT/2};
  const heroAnchor=nativeActionPreviewHeroScreenPoint(snapshot);
  const focus=nativeActionPreviewScenario(actionId)?.focus||'hero';
  if(focus==='hero'&&heroAnchor)return heroAnchor;
  if(focus==='target'){
    /* A semantic event is only one instant. Enemy death, moving platforms,
     * pickups and destructibles can keep moving/changing for many real native
     * frames afterward. Follow the authored native entity while its mark still
     * owns an active slot; only fall back to the event point once that entity
     * has actually disappeared. This keeps 2x/4x crops on the consequence of
     * the action rather than pinning them to a stale hit coordinate. */
    const slot=nativeActionPreviewRunner?.targetEntitySlot(snapshot);
    if(Number.isInteger(slot)){
      const liveTarget=preview?.entityBounds(snapshot,slot,'rdx')||preview?.entityBounds(snapshot,slot,'classic');
      if(liveTarget)return {x:(liveTarget.left+liveTarget.right)/2,y:(liveTarget.top+liveTarget.bottom)/2};
    }
    const target=nativeActionPreviewRunner?.targetScreenPoint(snapshot);if(target)return target;
  }
  if(focus==='bomb'){
    const bomb=preview?.entityBounds(snapshot,3);if(bomb)return {x:(bomb.left+bomb.right)/2,y:(bomb.top+bomb.bottom)/2};
  }
  if(focus==='projectile'){
    const bullet=preview?.entityBounds(snapshot,2);if(bullet)return {x:(bullet.left+bullet.right)/2,y:(bullet.top+bullet.bottom)/2};
  }
  if(nativeActionPreviewLastEvent?.type===actionId)return {x:Number(nativeActionPreviewLastEvent.x)||LIVE_WIDTH/2,y:Number(nativeActionPreviewLastEvent.y)||LIVE_HEIGHT/2};
  if(heroAnchor)return heroAnchor;
  const hero=preview?.entityBounds(snapshot,1,'rdx')||preview?.entityBounds(snapshot,1,'classic');
  return hero?{x:(hero.left+hero.right)/2,y:(hero.top+hero.bottom)/2}:{x:LIVE_WIDTH/2,y:LIVE_HEIGHT/2};
}
function nativeActionPreviewSourceCanvas(captured){
  if(!actionPreviewPresentationSolo||!captured?.canvas||!latestPresentationLayers)return captured?.canvas||null;
  const bit=PRESENTATION_LAYER_BITS[actionPreviewPresentationSolo]||0,canvas=document.createElement('canvas');canvas.width=LIVE_WIDTH;canvas.height=LIVE_HEIGHT;const ctx=canvas.getContext('2d');if(!ctx)return captured.canvas;
  const src=captured.canvas.getContext('2d').getImageData(0,0,LIVE_WIDTH,LIVE_HEIGHT),out=ctx.createImageData(LIVE_WIDTH,LIVE_HEIGHT);
  for(let i=0;i<latestPresentationLayers.length;i++){if(!(latestPresentationLayers[i]&bit))continue;const p=i*4;out.data[p]=src.data[p];out.data[p+1]=src.data[p+1];out.data[p+2]=src.data[p+2];out.data[p+3]=src.data[p+3];}
  ctx.putImageData(out,0,0);return canvas;
}
function renderNativeActionPreviewCanvas(canvas,runtime,captured,actionId,fullCanvas,{zoom=null}={}){
  if(!captured?.canvas||!captured?.snapshot)return false;
  fullCanvas.width=LIVE_WIDTH;fullCanvas.height=LIVE_HEIGHT;const fullCtx=fullCanvas.getContext('2d',{alpha:false});if(!fullCtx)return false;fullCtx.imageSmoothingEnabled=false;
  const source=nativeActionPreviewSourceCanvas(captured);renderPane(fullCtx,runtime,source,captured.snapshot,true,{transitions:false});
  const focus=nativeActionPreviewFocusPoint(actionId,captured),crop=actionPreviewLiveCropWindow(actionId,focus,zoom);
  const ctx=canvas.getContext('2d',{alpha:false});if(!ctx)return false;canvas.width=LIVE_WIDTH;canvas.height=LIVE_HEIGHT;ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,LIVE_WIDTH,LIVE_HEIGHT);ctx.drawImage(fullCanvas,crop.left,crop.top,crop.cropWidth,crop.cropHeight,0,0,LIVE_WIDTH,LIVE_HEIGHT);return true;
}
function buildActionPreview(){
  const host=$('action-preview-host');if(!host)return;const generation=++actionPreviewGeneration;host.textContent='';
  const action=ACTIONS.find(item=>item.id===selectedAction),actionId=selectedAction;
  const figure=document.createElement('figure');figure.className='action-preview-card';
  const caption=document.createElement('figcaption');const captionTitle=document.createElement('strong');captionTitle.textContent='Action preview';const captionNote=document.createElement('span');caption.append(captionTitle,captionNote);
  const canvas=document.createElement('canvas');canvas.className='action-preview-canvas';canvas.width=320;canvas.height=actionPreviewSource==='live'?200:136;canvas.setAttribute('aria-label',`${action?.label||actionId} Game Juice preview`);
  const toolbar=document.createElement('div');toolbar.className='action-preview-toolbar';
  const sourceGroup=document.createElement('span');sourceGroup.className='action-preview-source';sourceGroup.setAttribute('role','group');sourceGroup.setAttribute('aria-label','Action preview source');
  const sourceButtons=new Map();for(const [value,label] of [['live','Live map'],['synthetic','Synthetic']]){const button=document.createElement('button');button.type='button';button.textContent=label;button.dataset.actionPreviewSource=value;sourceButtons.set(value,button);sourceGroup.appendChild(button);}toolbar.appendChild(sourceGroup);
  const mapLabel=document.createElement('label');mapLabel.className='action-preview-map';const mapText=document.createElement('span');mapText.textContent='Map';const mapSelect=document.createElement('select');mapSelect.setAttribute('aria-label','Live action preview map');
  const resetMap=document.createElement('button');resetMap.type='button';resetMap.className='action-preview-map-reset';resetMap.textContent='Reset map';resetMap.title='Return this action to its reviewed default fixture';
  const globalLevelSelect=$('level-select');if(globalLevelSelect)for(const child of globalLevelSelect.children)mapSelect.appendChild(child.cloneNode(true));mapSelect.value=String(actionPreviewEffectiveLiveSubmap(actionId));mapLabel.append(mapText,mapSelect);toolbar.append(mapLabel,resetMap);
  const zoomGroup=document.createElement('span');zoomGroup.className='action-preview-zoom';zoomGroup.setAttribute('role','group');zoomGroup.setAttribute('aria-label','Live action preview zoom');
  const zoomText=document.createElement('span');zoomText.textContent='Zoom';zoomGroup.appendChild(zoomText);
  const zoomButtons=new Map();for(const value of ACTION_PREVIEW_LIVE_ZOOM_VALUES){const button=document.createElement('button');button.type='button';button.textContent=`${value}×`;button.dataset.actionPreviewZoom=String(value);zoomButtons.set(value,button);zoomGroup.appendChild(button);}toolbar.appendChild(zoomGroup);
  const directionGroup=document.createElement('span');directionGroup.className='action-preview-direction';
  const left=document.createElement('button');left.type='button';left.textContent='← Left';const right=document.createElement('button');right.type='button';right.textContent='Right →';const replay=document.createElement('button');replay.type='button';replay.textContent='↻ Replay';const summary=document.createElement('span');summary.className='action-preview-effects';directionGroup.append(left,right);toolbar.append(directionGroup,replay);
  const assetGroup=document.createElement('span');assetGroup.className='action-preview-assets';
  const addAssetSelect=(labelText,currentValue,onChange)=>{const label=document.createElement('label');const text=document.createElement('span');text.textContent=labelText;const select=document.createElement('select');for(const value of ['classic','revival']){const opt=document.createElement('option');opt.value=value;opt.textContent=value==='classic'?'Classic':'Revival';select.appendChild(opt);}select.value=normalizeActionPreviewWeaponSource(currentValue);select.addEventListener('change',()=>onChange(select.value));label.append(text,select);assetGroup.appendChild(label);};
  if(ACTION_PREVIEW_BULLET_ACTIONS.has(actionId))addAssetSelect('Bullet art',actionPreviewBulletSource,value=>{actionPreviewBulletSource=value;saveLocal(true);reset();});
  if(ACTION_PREVIEW_DYNAMITE_ACTIONS.has(actionId))addAssetSelect('Dynamite art',actionPreviewDynamiteSource,value=>{actionPreviewDynamiteSource=value;saveLocal(true);reset();});
  if(assetGroup.children.length)toolbar.appendChild(assetGroup);toolbar.appendChild(summary);figure.append(caption,canvas,toolbar);host.appendChild(figure);requestAnimationFrame(fitActionFeedbackWorkspace);
  let runtime=null,timelineMs=0,last=performance.now(),serial=1,serialElapsedMs=0,lastSignature='',frameIndex=0,frameElapsed=0,frames=[],lastHeroKey='',triggerMoments=actionPreviewTriggerMoments(actionId),nextTriggerIndex=0,trailState={history:[]};const nativeFullCanvas=document.createElement('canvas');nativeFullCanvas.width=LIVE_WIDTH;nativeFullCanvas.height=LIVE_HEIGHT;
  const liveRoomName=()=>mapSelect.selectedOptions?.[0]?.textContent?.split(' · ')[0]||`SM${Number(actionPreviewEffectiveLiveSubmap(actionId)).toString(16).toUpperCase().padStart(2,'0')}`;
  const updateSourceControls=()=>{for(const [value,button] of sourceButtons){const active=value===actionPreviewSource;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));}const choice=actionPreviewMapChoice(actionId);mapLabel.hidden=actionPreviewSource!=='live';resetMap.hidden=actionPreviewSource!=='live'||!choice.manual;mapSelect.value=String(choice.effectiveSubmap);zoomGroup.hidden=actionPreviewSource!=='live';assetGroup.hidden=actionPreviewSource==='live';canvas.classList.toggle('live-map',actionPreviewSource==='live');};
  const makeRuntime=()=>{const next=new JuiceRuntime(actionPreviewRuntimeProfile(profile,actionId));next.setSpatialScale(actionPreviewSource==='live'?1:ACTION_PREVIEW_ZOOM);next.setEnabled(true);next.setAudioEnabled(false);return next;};runtime=makeRuntime();
  const updateDirectionButtons=()=>{left.classList.toggle('active',actionPreviewDirection<0);right.classList.toggle('active',actionPreviewDirection>0);left.setAttribute('aria-pressed',String(actionPreviewDirection<0));right.setAttribute('aria-pressed',String(actionPreviewDirection>0));};
  const updateZoomButtons=()=>{for(const [value,button] of zoomButtons){const active=Number(value)===Number(actionPreviewLiveZoom);button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));}};
  const storyAt=ms=>actionPreviewStoryboard(actionId,ms,actionPreviewDirection,gameplayTuning,{projectileNearMissAnchor:actionPreviewNearMissAnchor});
  const refreshCaption=()=>{if(actionPreviewSource==='live'){const choice=actionPreviewMapChoice(actionId),state=nativeActionPreviewRunner?.state?.();const mapMode=choice.manual?'manual':'reviewed default',ready=state?.actionId===actionId?(state.ready?(state.warning?'ready · warning':'ready'):state.error?'ERROR':state.phase||'staging'):'staging';captionNote.textContent=`${action?.label||actionId} · ${liveRoomName()} · ${mapMode} · ${ready} · ${actionPreviewLiveCropScale(actionId)}×`;captionNote.title=state?.warning||state?.error||'';return;}captionNote.title='';captionNote.textContent=`${action?.label||actionId} · synthetic ${actionPreviewPresentation().toUpperCase()} · ${frames.length||1} frame${frames.length===1?'':'s'}`;};
  const refreshFrames=story=>{if(actionPreviewSource==='live'){refreshCaption();return;}const key=`${story.heroAction}:${story.direction}:${actionPreviewPresentation()}`;if(key===lastHeroKey&&frames.length)return;frames=actionPreviewFrames(story.heroAction,story.direction);frameIndex=0;frameElapsed=0;lastHeroKey=key;refreshCaption();};
  const currentFrame=()=>frames[frameIndex%Math.max(1,frames.length)]?.canvas||currentHeroPoseCanvas()||classicHeroFrameCanvas(actionPreviewDirection<0?23:11);
  const sceneForStory=story=>actionPreviewScene(currentFrame(),story.direction,actionId,story);
  const triggerAt=ms=>{const story=storyAt(ms);refreshFrames(story);const scene=sceneForStory(story);runtime.trigger(actionPreviewEvent(actionId,scene,story.direction,serial));};
  const reset=()=>{runtime=makeRuntime();timelineMs=0;serial=1;serialElapsedMs=0;frameIndex=0;frameElapsed=0;lastHeroKey='';nextTriggerIndex=0;trailState={history:[]};lastSignature=actionPreviewProfileSignature(actionId);const enabled=actionPreviewEnabledEffects(profile.actions?.[actionId]);summary.textContent=profile.actions?.[actionId]?.enabled===false?'Action disabled · native action still runs':enabled.length?`${enabled.length} visual effect${enabled.length===1?'':'s'} · ${enabled.join(' · ')}`:'No visual effects enabled';updateDirectionButtons();updateZoomButtons();updateSourceControls();refreshCaption();if(actionPreviewSource==='live'){nativeActionPreviewRuntime=runtime;nativeActionPreviewRuntimeAction=actionId;nativeActionPreviewLastEvent=null;startNativeActionPreviewScenario({restart:true});if(nativeActionPreviewCaptured)renderNativeActionPreviewCanvas(canvas,runtime,nativeActionPreviewCaptured,actionId,nativeFullCanvas);return;}const story=storyAt(0);refreshFrames(story);if(triggerMoments[0]===0){triggerAt(0);nextTriggerIndex=1;}renderActionPreviewCanvas(canvas,runtime,currentFrame(),story.direction,actionId,story,trailState);};
  for(const [value,button] of sourceButtons)button.addEventListener('click',()=>{if(!ACTION_PREVIEW_SOURCE_VALUES.includes(value)||value===actionPreviewSource)return;setActionPreviewSource(value,{rebuild:true,resetGameplay:true});});
  mapSelect.addEventListener('change',()=>{actionPreviewSetManualLiveSubmap(actionId,Number(mapSelect.value));saveLocal(true);if(actionPreviewSource==='live'){startNativeActionPreviewScenario({restart:true});nativeActionPreviewLastEvent=null;}updateSourceControls();refreshCaption();updateLiveDocs();});
  resetMap.addEventListener('click',()=>{if(!actionPreviewResetManualLiveSubmap(actionId))return;mapSelect.value=String(actionPreviewRecommendedLiveSubmap(actionId));saveLocal(true);if(actionPreviewSource==='live'){startNativeActionPreviewScenario({restart:true});nativeActionPreviewLastEvent=null;}updateSourceControls();refreshCaption();updateLiveDocs();});
  for(const [value,button] of zoomButtons)button.addEventListener('click',()=>{const next=Number(value);if(!ACTION_PREVIEW_LIVE_ZOOM_VALUES.includes(next)||next===actionPreviewLiveZoom)return;actionPreviewLiveZoom=next;updateZoomButtons();refreshCaption();saveLocal(true);});
  left.addEventListener('click',()=>{actionPreviewDirection=-1;saveLocal(true);reset();});right.addEventListener('click',()=>{actionPreviewDirection=1;saveLocal(true);reset();});replay.addEventListener('click',reset);reset();
  const animate=now=>{if(generation!==actionPreviewGeneration||!canvas.isConnected)return;const dt=Math.min(.05,Math.max(0,(now-last)/1000));last=now;const signature=actionPreviewProfileSignature(actionId);if(signature!==lastSignature){reset();last=now;requestAnimationFrame(animate);return;}if(actionPreviewSource==='live'){refreshCaption();if(nativeActionPreviewCaptured&&nativeActionPreviewRunner?.ready)renderNativeActionPreviewCanvas(canvas,runtime,nativeActionPreviewCaptured,actionId,nativeFullCanvas);requestAnimationFrame(animate);return;}serialElapsedMs+=dt*1000;const simFrameMs=JUICE_SIM_FRAME_SECONDS*1000;while(serialElapsedMs>=simFrameMs){serialElapsedMs-=simFrameMs;serial++;runtime.update(JUICE_SIM_FRAME_SECONDS);}const loopMs=actionPreviewLoopMs(actionId),oldTimeline=timelineMs;timelineMs+=dt*1000;let wrapped=false;if(timelineMs>=loopMs){timelineMs%=loopMs;wrapped=true;nextTriggerIndex=0;lastHeroKey='';trailState.history.length=0;if(triggerMoments[0]===0){triggerAt(0);nextTriggerIndex=1;}}
    if(!wrapped){while(nextTriggerIndex<triggerMoments.length&&oldTimeline<triggerMoments[nextTriggerIndex]&&timelineMs>=triggerMoments[nextTriggerIndex]){triggerAt(triggerMoments[nextTriggerIndex]);nextTriggerIndex++;}}
    const story=storyAt(timelineMs);refreshFrames(story);const held=runtime.shouldHoldFrame(serial);if(actionPreviewSource!=='live'&&!held&&story.heroVisible!==false){frameElapsed+=dt*1000;let guard=0;while(frames.length&&guard++<frames.length+2){const frameMs=Math.max(20,Number(frames[frameIndex%frames.length]?.durationMs)||actionPreviewFrameMs(story.heroAction));if(frameElapsed<frameMs)break;frameElapsed-=frameMs;frameIndex=(frameIndex+1)%frames.length;}}
    renderActionPreviewCanvas(canvas,runtime,currentFrame(),story.direction,actionId,story,trailState);requestAnimationFrame(animate);};requestAnimationFrame(animate);
}
function canvasPngDataUrl(canvas){try{return canvas?.toDataURL?.('image/png')||'';}catch{return '';}}
function portablePoseSpriteCanvas(binding,presentation){
  if(presentation==='classic'){
    if(binding?.classicFrameSource==='frame')return classicHeroFrameCanvas(Number(binding.classicFrameId)||1);
    const direction=Number(binding?.referenceDirection)||1;return classicHeroFrameCanvas(actionPreviewClassicFrames(binding?.event||selectedAction,direction)[0]||23);
  }
  if(binding?.rdxFrameSource==='frame')return rdxHeroFrameCatalog(latestSnapshot?.map).find(row=>row.pn===Number(binding.rdxPn)&&row.frameIndex===Number(binding.rdxFrameIndex))?.canvas||null;
  const direction=Number(binding?.referenceDirection)||1,pn=actionPreviewRdxPn(binding?.event||selectedAction,direction);return rdxHeroFrameCatalog(latestSnapshot?.map).find(row=>row.pn===pn)?.canvas||null;
}
function poseEmitterPortableSprites(effect){
  const presentation=preview?.presentation||$('presentation-source')?.value||'classic';return (effect?.bindings||[]).map(binding=>{const classic=portablePoseSpriteCanvas(binding,'classic'),rdx=portablePoseSpriteCanvas(binding,'rdx'),previewCanvas=presentation==='rdx'?(rdx||classic):(classic||rdx);return {bindingId:String(binding.id||''),event:String(binding.event||selectedAction),referenceDirection:Number(binding.referenceDirection||0),width:Number(previewCanvas?.width||32),height:Number(previewCanvas?.height||21),previewPngDataUrl:canvasPngDataUrl(previewCanvas),classicPngDataUrl:canvasPngDataUrl(classic),rdxPngDataUrl:canvasPngDataUrl(rdx),capturedPoseDataUrl:typeof binding.capturedPose==='string'?binding.capturedPose:''};});
}
function exportPoseEmitterAction(){
  const effect=profile.actions?.[selectedAction]?.poseEmitter;if(!effect)return;const action=ACTIONS.find(item=>item.id===selectedAction),presentation=preview?.presentation||$('presentation-source')?.value||'classic';const payload=buildPoseEmitterActionExport({actionId:selectedAction,actionLabel:action?.label||selectedAction,presentation,poseEmitter:effect,sprites:poseEmitterPortableSprites(effect)});
  const blob=new Blob([`${JSON.stringify(payload,null,2)}\n`],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`rick-dangerous-pose-generators-${selectedAction.replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').toLowerCase()}.json`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),0);$('save-status').textContent=`Exported ${effect.bindings?.length||0} pose-attached generator(s) for ${action?.label||selectedAction} as self-contained JSON with embedded PNG sprite references.`;
}
async function importPoseEmitterActionFile(file){
  if(!file)return;try{const payload=JSON.parse(await file.text()),imported=importPoseEmitterActionPayload(profile,selectedAction,payload);if(!imported)throw new Error('This JSON does not contain a compatible pose-attached generator action payload.');profile=imported;syncProfiles();buildActionList();buildInspector();saveLocal(true);const count=profile.actions?.[selectedAction]?.poseEmitter?.bindings?.length||0;$('save-status').textContent=`Imported pose-attached animation parameters into ${ACTIONS.find(item=>item.id===selectedAction)?.label||selectedAction}: ${count} generator(s). Embedded sprites are retained as authoring fallbacks; game presentation frames remain authoritative.`;}catch(error){alert(`Pose generator import failed: ${error.message}`);}
}

function emitterPreviewToneColor(tone){
  if(tone==='spark') return '#fff4c2';
  if(tone==='smoke') return '#c7c7c0';
  return '#f2d28b';
}
function poseEmitterRegion(emitter={}){
  const anchorX=Math.max(0,Math.min(31,Number(emitter.anchorX)||0)),anchorY=Math.max(0,Math.min(20,Number(emitter.anchorY)||0)),{width,height}=particleEmitterDimensions(emitter);
  return {x:anchorX-(width-1)/2,y:anchorY-(height-1)/2,width,height};
}
function particlePreviewCell(canvas,event){
  const rect=canvas.getBoundingClientRect();
  return {x:Math.max(0,Math.min(31,Math.floor((event.clientX-rect.left)/rect.width*32))),y:Math.max(0,Math.min(20,Math.floor((event.clientY-rect.top)/rect.height*21)))};
}
function particleEmitterSizeToPointer(canvas,event,anchorX=16,anchorY=10){
  const point=particlePreviewCell(canvas,event);
  return {width:Math.max(1,Math.min(32,Math.abs(point.x-anchorX)*2+1)),height:Math.max(1,Math.min(21,Math.abs(point.y-anchorY)*2+1))};
}
function spawnPoseEmitterPreviewParticles(binding,particles,direction=1){
  const emitter=binding?.emitter||{};
  if(emitter.enabled===false)return;
  const count=Math.max(0,Math.min(32,Math.round(Number(emitter.count)||0)));
  const ax=Math.max(0,Math.min(31,Number(emitter.anchorX)||0)), ay=Math.max(0,Math.min(20,Number(emitter.anchorY)||0));
  const particleDirection=poseEmitterParticleDirection(binding,direction);
  for(let i=0;i<count;i+=1){
    const sample=poseEmitterParticleSample(emitter,particleDirection);
    const offset=particleEmitterSpawnOffset(emitter);
    const life=sample.lifeMs/1000;
    particles.push({x:ax+offset.x,y:ay+offset.y,vx:sample.vx,vy:sample.vy,gravity:sample.gravity,size:sample.size,tone:sample.tone,life,maxLife:life});
  }
}
function dataUrlImage(url,onload){if(!url)return null;const img=new Image();if(onload)img.onload=()=>onload(img);img.src=url;return img;}
function renderPoseEmitterPreview(canvas,binding,poseSource,particles=[]){
  const ctx=canvas.getContext('2d');if(!ctx)return;const scale=5,w=32,h=21;canvas.width=w*scale;canvas.height=h*scale;ctx.imageSmoothingEnabled=false;
  ctx.fillStyle='#081018';ctx.fillRect(0,0,canvas.width,canvas.height);
  if(poseSource){
    const rect=poseFitRect(poseSource,w,h);
    ctx.drawImage(poseSource,rect.x*scale,rect.y*scale,rect.w*scale,rect.h*scale);
  }
  ctx.strokeStyle='rgba(255,255,255,.07)';ctx.lineWidth=1;
  for(let x=0;x<=w;x+=4){ctx.beginPath();ctx.moveTo(x*scale+.5,0);ctx.lineTo(x*scale+.5,canvas.height);ctx.stroke();}
  for(let y=0;y<=h;y+=4){ctx.beginPath();ctx.moveTo(0,y*scale+.5);ctx.lineTo(canvas.width,y*scale+.5);ctx.stroke();}
  const region=poseEmitterRegion(binding?.emitter);ctx.save();ctx.fillStyle='rgba(120,199,255,.14)';ctx.fillRect(region.x*scale,region.y*scale,region.width*scale,region.height*scale);ctx.setLineDash([5,3]);ctx.strokeStyle='rgba(120,199,255,.82)';ctx.lineWidth=2;ctx.strokeRect(region.x*scale+1,region.y*scale+1,Math.max(1,region.width*scale-2),Math.max(1,region.height*scale-2));ctx.restore();
  for(const particle of particles){if(particle.life<=0)continue;ctx.fillStyle=emitterPreviewToneColor(particle.tone);const size=Math.max(1,particle.size)*scale;ctx.fillRect(Math.round(particle.x*scale),Math.round(particle.y*scale),size,size);}
  const emitter=binding.emitter||{},ax=Math.max(0,Math.min(31,Number(emitter.anchorX)||0)),ay=Math.max(0,Math.min(20,Number(emitter.anchorY)||0));
  ctx.strokeStyle='#ffde75';ctx.lineWidth=2;ctx.strokeRect(ax*scale+.5,ay*scale+.5,scale-1,scale-1);ctx.beginPath();ctx.moveTo(ax*scale+scale/2,ay*scale);ctx.lineTo(ax*scale+scale/2,ay*scale+scale);ctx.moveTo(ax*scale,ay*scale+scale/2);ctx.lineTo(ax*scale+scale,ay*scale+scale/2);ctx.stroke();
}
function particleEffectPreviewSource(actionId=selectedAction){
  if(actionId.startsWith('platform.'))return actionPreviewPlatformSprite()?.canvas||null;
  if(actionId==='blockage.crumble')return actionPreviewBlockageSprite(null).canvas;
  if(['bullet.target_hit','enemy.stick_hit','dynamite.target_hit'].includes(actionId))return actionPreviewTargetSprite(actionPreviewDirection)?.canvas||null;
  return actionPreviewFrames(actionId,actionPreviewDirection)[0]?.canvas||currentHeroPoseCanvas()||classicHeroFrameCanvas(actionPreviewDirection<0?23:11);
}
function genericParticlePreviewBinding(effect={}){
  return {emitter:{...effect,anchorX:16,anchorY:10,mirrorX:false,flipH:false,flipV:false,emitterWidth:effect.emitterWidth??1,emitterHeight:effect.emitterHeight??1}};
}
function spawnGenericParticlePreview(effect,particles,direction=1){
  if(effect?.enabled===false)return;
  const count=Math.max(0,Math.min(64,Math.round(Number(effect?.count)||0))),radius=Math.max(0,Number(effect?.spawnRadius)||0),anchorX=16,anchorY=10;
  const stencil=[[-1,-.375],[-.375,-1],[.625,-.75],[1,.125],[.5,1],[-.5,1],[-1,.5],[0,0]];
  for(let i=0;i<count;i+=1){
    const sample=poseEmitterParticleSample(effect,direction),offset=particleEmitterSpawnOffset(effect),s=stencil[i%stencil.length],life=sample.lifeMs/1000;
    particles.push({x:anchorX+offset.x+s[0]*radius*(direction<0?-1:1),y:anchorY+offset.y+s[1]*radius,vx:sample.vx,vy:sample.vy,gravity:sample.gravity,size:Math.max(1,Math.min(8,Math.round(Number(effect?.size)||sample.size))),tone:effect?.tone||sample.tone,life,maxLife:life});
  }
}
function addParticleEmitterPreview(card,liveEffect,commitEffect){
  const previewBox=document.createElement('div');previewBox.className='pose-emitter-preview-box particle-effect-preview-box';
  const canvas=document.createElement('canvas');canvas.className='attached-emitter-pose-canvas attached-emitter-live-preview';canvas.setAttribute('aria-label','Particle emitter size preview');
  const toolbar=document.createElement('div');toolbar.className='attached-emitter-pose-toolbar';const burst=document.createElement('button');burst.type='button';burst.textContent='Preview burst';const constantLabel=document.createElement('label');constantLabel.className='toggle pose-emitter-constant-preview';const constant=document.createElement('input');constant.type='checkbox';constant.checked=true;constantLabel.append(constant,document.createTextNode(' Constant preview'));const status=document.createElement('span');status.className='attached-emitter-pose-status';toolbar.append(burst,constantLabel);previewBox.append(canvas,toolbar,status);card.appendChild(previewBox);
  const particles=[],source=particleEffectPreviewSource(selectedAction);let last=performance.now(),nextBurstAt=0;
  const emit=()=>{spawnGenericParticlePreview(liveEffect(),particles,actionPreviewDirection);nextBurstAt=performance.now()+600;};
  const reset=()=>{particles.length=0;if(constant.checked)emit();renderPoseEmitterPreview(canvas,genericParticlePreviewBinding(liveEffect()),source,particles);};
  burst.addEventListener('click',()=>{particles.length=0;emit();});constant.addEventListener('change',reset);reset();
  let resizing=false;
  const resizeEmitter=event=>{const size=particleEmitterSizeToPointer(canvas,event,16,10);commitEffect(live=>{live.emitterWidth=size.width;live.emitterHeight=size.height;},{cost:true,list:true});const widthInput=card.querySelector('input[data-effect-key="particles"][data-field-key="emitterWidth"]'),heightInput=card.querySelector('input[data-effect-key="particles"][data-field-key="emitterHeight"]');if(widthInput)widthInput.value=String(size.width);if(heightInput)heightInput.value=String(size.height);renderPoseEmitterPreview(canvas,genericParticlePreviewBinding(liveEffect()),source,particles);};
  canvas.style.cursor='nwse-resize';canvas.title='Drag from the event origin to resize the emitter area';
  canvas.addEventListener('pointerdown',event=>{resizing=true;canvas.setPointerCapture?.(event.pointerId);resizeEmitter(event);});
  canvas.addEventListener('pointermove',event=>{if(resizing)resizeEmitter(event);});
  canvas.addEventListener('pointerup',()=>{resizing=false;});canvas.addEventListener('pointercancel',()=>{resizing=false;});
  const animate=now=>{if(!canvas.isConnected)return;const dt=Math.min(.05,Math.max(0,(now-last)/1000));last=now;for(const p of particles){p.life-=dt;if(p.life>0){p.vy+=p.gravity*dt;p.x+=p.vx*dt;p.y+=p.vy*dt;}}for(let i=particles.length-1;i>=0;i--)if(particles[i].life<=0)particles.splice(i,1);const effect=liveEffect();if(constant.checked&&effect?.enabled!==false&&now>=nextBurstAt)emit();renderPoseEmitterPreview(canvas,genericParticlePreviewBinding(effect),source,particles);const size=particleEmitterDimensions(effect);status.textContent=`Emitter ${size.width}×${size.height}px · drag preview to resize · spawn radius ${Math.max(0,Math.round(Number(effect?.spawnRadius)||0))}px · anchor at event origin`;requestAnimationFrame(animate);};requestAnimationFrame(animate);
}
function poseSourceForBinding(binding,onload=null){
  const presentation=preview?.presentation||$('presentation-source')?.value||'classic';
  const exact=poseBindingFrameCanvas(binding,presentation);if(exact)return exact;
  if(binding?.capturedPose)return dataUrlImage(binding.capturedPose,onload);
  return currentHeroPoseCanvas();
}
function makeField(labelText,input){const label=document.createElement('label');label.textContent=labelText;label.appendChild(input);return label;}
function makePoseSliderControl({value,min,max,step,onChange}){
  const root=document.createElement('div');root.className='pose-slider-control';
  const range=document.createElement('input');range.type='range';range.min=String(min);range.max=String(max);range.step=String(step);
  const valueButton=document.createElement('button');valueButton.type='button';valueButton.className='pose-slider-value';valueButton.title='Click to type an exact value';
  const editor=document.createElement('input');editor.type='number';editor.className='pose-slider-editor';editor.min=String(min);editor.max=String(max);editor.step=String(step);editor.hidden=true;
  const decimals=String(step).includes('.')?String(step).split('.')[1].length:0;
  const clampValue=raw=>{const n=Number(raw);const finite=Number.isFinite(n)?n:Number(value)||0;return Math.min(Number(max),Math.max(Number(min),finite));};
  const formatValue=raw=>{const n=clampValue(raw);return decimals?Number(n.toFixed(decimals)).toString():String(Math.round(n));};
  const setValue=(raw,{commit=false}={})=>{const n=clampValue(raw);range.value=String(n);editor.value=String(n);valueButton.textContent=formatValue(n);if(commit)onChange?.(n);};
  const closeEditor=apply=>{if(editor.hidden)return;if(apply)setValue(editor.value,{commit:true});else editor.value=range.value;editor.hidden=true;valueButton.hidden=false;};
  range.addEventListener('input',()=>setValue(range.value,{commit:true}));
  valueButton.addEventListener('click',()=>{if(valueButton.disabled)return;valueButton.hidden=true;editor.hidden=false;editor.value=range.value;editor.focus();editor.select();});
  editor.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();closeEditor(true);}else if(event.key==='Escape'){event.preventDefault();closeEditor(false);}});
  editor.addEventListener('blur',()=>closeEditor(true));
  root.append(range,valueButton,editor);setValue(value);
  return {element:root,range,editor,valueButton,setValue:value=>setValue(value),setDisabled(disabled){range.disabled=!!disabled;valueButton.disabled=!!disabled;editor.disabled=!!disabled;if(disabled&& !editor.hidden)closeEditor(false);root.classList.toggle('disabled',!!disabled);}};
}
function addPoseEmitterControls(card,effect){
  const intro=document.createElement('p');intro.className='template-note';intro.textContent='Each generator listens to one gameplay event and uses that presentation’s Hero pose only as the anchor-authoring reference. Multiple generators may listen to the same event and combine into one effect. The game keeps its natural animation; particles emit independently from each configured point.';card.appendChild(intro);
  const ioToolbar=document.createElement('div');ioToolbar.className='pose-emitter-io-toolbar';
  const exportButton=document.createElement('button');exportButton.type='button';setIconButton(exportButton,'export','Export this action pose generators');const exportText=document.createElement('span');exportText.textContent='Export action';exportButton.appendChild(exportText);exportButton.addEventListener('click',()=>exportPoseEmitterAction());
  const importButton=document.createElement('button');importButton.type='button';setIconButton(importButton,'import','Import pose generator animation parameters into this action');const importText=document.createElement('span');importText.textContent='Import action';importButton.appendChild(importText);
  const importInput=document.createElement('input');importInput.type='file';importInput.accept='application/json,.json';importInput.hidden=true;importButton.addEventListener('click',()=>importInput.click());importInput.addEventListener('change',async()=>{const file=importInput.files?.[0];importInput.value='';if(file)await importPoseEmitterActionFile(file);});ioToolbar.append(exportButton,importButton,importInput);card.appendChild(ioToolbar);
  const list=document.createElement('div');list.className='hero-pose-list pose-emitter-list';card.appendChild(list);
  const currentEffect=()=>profile.actions?.[selectedAction]?.poseEmitter||effect;
  const bindingById=id=>currentEffect()?.bindings?.find(item=>item.id===id);
  const previewRefreshers=new Map();
  const commit=(id,mutate,{rebuild=false,refresh=true}={})=>{const live=bindingById(id);if(!live)return;mutate(live);profile=normalizeProfile(profile);syncProfiles();saveLocal(true);if(rebuild)buildInspector();else if(refresh)previewRefreshers.get(id)?.();};
  const bindings=Array.isArray(effect.bindings)?effect.bindings:[];
  bindings.forEach((binding,index)=>{
    const id=binding.id,row=document.createElement('div');row.className='hero-pose-binding pose-emitter-binding';
    const head=document.createElement('div');head.className='hero-pose-binding-head';const label=document.createElement('strong');label.textContent=`Generator ${index+1} · ${ACTIONS.find(a=>a.id===binding.event)?.label||binding.event}`;
    const remove=document.createElement('button');remove.type='button';remove.className='icon-button';remove.title='Remove generator';remove.setAttribute('aria-label','Remove generator');remove.innerHTML='<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5 5 15"></path></svg>';remove.addEventListener('click',()=>{const live=currentEffect();const at=live.bindings.findIndex(item=>item.id===id);if(at>=0)live.bindings.splice(at,1);profile=normalizeProfile(profile);syncProfiles();buildInspector();saveLocal(true);});head.append(label,remove);row.appendChild(head);
    const body=document.createElement('div');body.className='pose-emitter-binding-layout';
    const previewBox=document.createElement('div');previewBox.className='pose-emitter-preview-box';const canvas=document.createElement('canvas');canvas.className='attached-emitter-pose-canvas attached-emitter-live-preview';canvas.setAttribute('aria-label','Pose attached generator preview');
    const previewActions=document.createElement('div');previewActions.className='attached-emitter-pose-toolbar';const capture=document.createElement('button');capture.type='button';capture.textContent='Capture 3·2·1';const burst=document.createElement('button');burst.type='button';burst.textContent='Preview burst';const constantLabel=document.createElement('label');constantLabel.className='toggle pose-emitter-constant-preview';const constantPreview=document.createElement('input');constantPreview.type='checkbox';constantPreview.checked=true;constantLabel.append(constantPreview,document.createTextNode(' Constant preview'));const status=document.createElement('span');status.className='attached-emitter-pose-status';previewActions.append(capture,burst,constantLabel);previewBox.append(canvas,previewActions,status);
    const controls=document.createElement('div');controls.className='hero-pose-binding-controls pose-emitter-controls';
    const eventSelect=document.createElement('select');eventSelect.dataset.poseEventId=id;
    for(const action of ACTIONS){const opt=document.createElement('option');opt.value=action.id;opt.textContent=`${action.label} · ${action.id}`;eventSelect.appendChild(opt);}eventSelect.value=binding.event;
    eventSelect.addEventListener('change',()=>{commit(id,live=>{live.event=eventSelect.value;label.textContent=`Generator ${index+1} · ${ACTIONS.find(a=>a.id===live.event)?.label||live.event}`;});});controls.appendChild(makeField('Trigger event',eventSelect));
    const frameSelect=document.createElement('select');const current=document.createElement('option');current.value='event';current.textContent='Current RDX frame at event';frameSelect.appendChild(current);
    const presentation=preview?.presentation||$('presentation-source')?.value||'classic';
    if(presentation==='rdx'){
      const catalog=rdxHeroFrameCatalog(latestSnapshot?.map);if(catalog.length){for(const frame of catalog){const opt=document.createElement('option');opt.value=`rdx:${frame.pn}:${frame.frameIndex}`;opt.textContent=frame.label;frameSelect.appendChild(opt);}frameSelect.value=binding.rdxFrameSource==='frame'?`rdx:${binding.rdxPn}:${binding.rdxFrameIndex}`:'event';}
      else {const opt=document.createElement('option');opt.value='unavailable';opt.disabled=true;opt.textContent='Load RDX ROM to browse RDX Hero frames';frameSelect.appendChild(opt);frameSelect.value='event';}
    } else {
      current.textContent='Current Classic frame at event';for(const meta of CLASSIC_HERO_FRAME_META){const opt=document.createElement('option');opt.value=`classic:${meta.id}`;opt.textContent=`${meta.hex} · ${meta.label}`;frameSelect.appendChild(opt);}frameSelect.value=binding.classicFrameSource==='frame'?`classic:${binding.classicFrameId}`:'event';
    }
    frameSelect.addEventListener('change',()=>commit(id,live=>{const value=frameSelect.value;if(presentation==='rdx'){if(value==='event')live.rdxFrameSource='event';else{const [,pn,fi]=value.split(':');live.rdxFrameSource='frame';live.rdxPn=Number(pn);live.rdxFrameIndex=Number(fi);}}else{if(value==='event')live.classicFrameSource='event';else{live.classicFrameSource='frame';live.classicFrameId=Number(value.split(':')[1]);}}}));controls.appendChild(makeField(presentation==='rdx'?'RDX Hero frame':'Classic Hero frame',frameSelect));
    const holdSelect=document.createElement('select');for(const [value,text] of [['frames','Fixed simulation frames'],['while-fire','While FIRE is held'],['while-action','While action/STOP is held']]){const opt=document.createElement('option');opt.value=value;opt.textContent=text;holdSelect.appendChild(opt);}holdSelect.value=binding.holdMode||'frames';controls.appendChild(makeField('Generator active',holdSelect));
    const frames=makePoseSliderControl({value:binding.frames||2,min:1,max:60,step:1,onChange:value=>commit(id,live=>{live.frames=value;})});frames.setDisabled((binding.holdMode||'frames')!=='frames');controls.appendChild(makeField('Fixed active frames',frames.element));
    holdSelect.addEventListener('change',()=>{frames.setDisabled(holdSelect.value!=='frames');commit(id,live=>{live.holdMode=holdSelect.value;});});
    const emitter=binding.emitter||{};
    const enabledLabel=document.createElement('label');enabledLabel.className='toggle audio-event-pan pose-emitter-enabled';const enabledCheck=document.createElement('input');enabledCheck.type='checkbox';enabledCheck.checked=emitter.enabled!==false;enabledLabel.append(enabledCheck,document.createTextNode(' Generator enabled'));
    enabledCheck.addEventListener('change',()=>commit(id,live=>{live.emitter.enabled=enabledCheck.checked;}));controls.appendChild(enabledLabel);
    const tone=document.createElement('select');for(const value of ['smoke','spark','dust']){const opt=document.createElement('option');opt.value=value;opt.textContent=value[0].toUpperCase()+value.slice(1);tone.appendChild(opt);}tone.value=emitter.tone||'smoke';tone.addEventListener('change',()=>commit(id,live=>{live.emitter.tone=tone.value;}));controls.appendChild(makeField('Particle appearance',tone));
    const playback=document.createElement('select');for(const [value,text] of [['one-shot','One-shot · one burst per event'],['loop','Loop · repeat while event is active']]){const opt=document.createElement('option');opt.value=value;opt.textContent=text;playback.appendChild(opt);}playback.value=emitter.playbackMode==='one-shot'?'one-shot':'loop';controls.appendChild(makeField('Playback',playback));
    const numeric=[['anchorX','Anchor X',0,31,1],['anchorY','Anchor Y',0,20,1],['count','Burst count',0,32,1],['cadenceFrames','Loop cadence frames',1,30,1],['speed','Speed',0,160,1],['lifeMs','Life ms',10,2000,10],['spread','Spread',0,2,.05],['gravity','Gravity',-200,300,5],['size','Pixel size',1,4,1]];
    const inputMap={};for(const [key,text,min,max,step] of numeric){const slider=makePoseSliderControl({value:emitter[key],min,max,step,onChange:value=>commit(id,live=>{live.emitter[key]=value;})});inputMap[key]=slider;controls.appendChild(makeField(text,slider.element));}
    const emitterSize=particleEmitterDimensions(emitter);
    const regionWidth=makePoseSliderControl({value:emitterSize.width,min:1,max:32,step:1,onChange:value=>commit(id,live=>{live.emitter.emitterWidth=Math.max(1,Math.min(32,Math.round(value)));})});
    const regionHeight=makePoseSliderControl({value:emitterSize.height,min:1,max:21,step:1,onChange:value=>commit(id,live=>{live.emitter.emitterHeight=Math.max(1,Math.min(21,Math.round(value)));})});
    inputMap.emitterWidth=regionWidth;inputMap.emitterHeight=regionHeight;controls.appendChild(makeField('Emitter width',regionWidth.element));controls.appendChild(makeField('Emitter height',regionHeight.element));
    inputMap.cadenceFrames.setDisabled(playback.value==='one-shot');
    playback.addEventListener('change',()=>{inputMap.cadenceFrames.setDisabled(playback.value==='one-shot');commit(id,live=>{live.emitter.playbackMode=playback.value;});});
    const mirrorLabel=document.createElement('label');mirrorLabel.className='toggle audio-event-pan pose-emitter-mirror';const mirror=document.createElement('input');mirror.type='checkbox';mirror.checked=emitter.mirrorX!==false;mirror.addEventListener('change',()=>commit(id,live=>{live.emitter.mirrorX=mirror.checked;}));mirrorLabel.append(mirror,document.createTextNode(' Mirror anchor when live facing differs from reference pose'));controls.appendChild(mirrorLabel);
    const flipRow=document.createElement('div');flipRow.className='pose-emitter-flip-row';
    const flipH=document.createElement('button');flipH.type='button';flipH.className='pose-flip-button';flipH.innerHTML='<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 10h14M6 7l-3 3 3 3M14 7l3 3-3 3"></path></svg><span>Flip H</span>';flipH.title='Flip particle direction horizontally';flipH.setAttribute('aria-pressed',String(!!emitter.flipH));flipH.classList.toggle('active',!!emitter.flipH);
    const flipV=document.createElement('button');flipV.type='button';flipV.className='pose-flip-button';flipV.innerHTML='<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v14M7 6l3-3 3 3M7 14l3 3 3-3"></path></svg><span>Flip V</span>';flipV.title='Flip particle direction vertically';flipV.setAttribute('aria-pressed',String(!!emitter.flipV));flipV.classList.toggle('active',!!emitter.flipV);
    flipH.addEventListener('click',()=>commit(id,live=>{live.emitter.flipH=!live.emitter.flipH;flipH.classList.toggle('active',live.emitter.flipH);flipH.setAttribute('aria-pressed',String(live.emitter.flipH));}));
    flipV.addEventListener('click',()=>commit(id,live=>{live.emitter.flipV=!live.emitter.flipV;flipV.classList.toggle('active',live.emitter.flipV);flipV.setAttribute('aria-pressed',String(live.emitter.flipV));}));
    flipRow.append(flipH,flipV);controls.appendChild(flipRow);
    body.append(previewBox,controls);row.appendChild(body);list.appendChild(row);

    let poseSource=poseSourceForBinding(binding,img=>{poseSource=img;syncPoseEmitterReference(liveBinding(),poseSource,presentation);});const particles=[];let nextBurstAt=0,last=performance.now(),timelineMs=0,nextFiniteBurstIndex=0;
    const liveBinding=()=>bindingById(id)||binding;const refreshSource=()=>{poseSource=poseSourceForBinding(liveBinding(),img=>{poseSource=img;syncPoseEmitterReference(liveBinding(),poseSource,presentation);});syncPoseEmitterReference(liveBinding(),poseSource,presentation);};
    const emitBurst=()=>{const live=liveBinding();const previewDirection=poseBindingReferenceDirection(live,presentation)||currentHeroDirection();spawnPoseEmitterPreviewParticles(live,particles,previewDirection);};
    const emitConstant=()=>{const live=liveBinding();emitBurst();nextBurstAt=live.emitter?.playbackMode==='one-shot'?Number.POSITIVE_INFINITY:performance.now()+poseEmitterCadenceSeconds(live)*1000;};
    const resetPreview=()=>{particles.length=0;timelineMs=0;nextFiniteBurstIndex=0;refreshSource();if(constantPreview.checked)emitConstant();else{const moments=actionPreviewPoseEmitterBurstMoments(liveBinding().event,liveBinding());while(nextFiniteBurstIndex<moments.length&&moments[nextFiniteBurstIndex]===0){emitBurst();nextFiniteBurstIndex++;}}renderPoseEmitterPreview(canvas,liveBinding(),poseSource,particles);};
    previewRefreshers.set(id,resetPreview);
    constantPreview.addEventListener('change',resetPreview);
    const animate=now=>{if(!canvas.isConnected){previewRefreshers.delete(id);return;}const dt=Math.min(.05,Math.max(0,(now-last)/1000));last=now;for(const p of particles){p.life-=dt;if(p.life>0){p.vy+=p.gravity*dt;p.x+=p.vx*dt;p.y+=p.vy*dt;}}for(let i=particles.length-1;i>=0;i--)if(particles[i].life<=0)particles.splice(i,1);const live=liveBinding();if(constantPreview.checked){if(live.emitter?.enabled!==false&&live.emitter?.playbackMode!=='one-shot'&&now>=nextBurstAt)emitConstant();}else{const loopMs=actionPreviewLoopMs(live.event),oldTimeline=timelineMs;timelineMs+=dt*1000;let wrapped=false;if(timelineMs>=loopMs){timelineMs%=loopMs;wrapped=true;particles.length=0;nextFiniteBurstIndex=0;}const moments=actionPreviewPoseEmitterBurstMoments(live.event,live);if(wrapped){while(nextFiniteBurstIndex<moments.length&&moments[nextFiniteBurstIndex]<=timelineMs){emitBurst();nextFiniteBurstIndex++;}}else{while(nextFiniteBurstIndex<moments.length&&moments[nextFiniteBurstIndex]>oldTimeline&&moments[nextFiniteBurstIndex]<=timelineMs){emitBurst();nextFiniteBurstIndex++;}}}const region=poseEmitterRegion(live.emitter),size=particleEmitterDimensions(live.emitter);inputMap.emitterWidth.setValue(size.width);inputMap.emitterHeight.setValue(size.height);renderPoseEmitterPreview(canvas,live,poseSource,particles);const facing=poseBindingReferenceDirection(live,presentation);const playbackLabel=live.emitter?.playbackMode==='one-shot'?'one-shot':`loop ${Math.round(poseEmitterCadenceSeconds(live)*1000)}ms`;const previewLabel=constantPreview.checked?'constant preview':`${Math.max(1,Math.round(Number(live.frames)||2))} fixed frames · ${actionPreviewLoopMs(live.event)}ms action loop`;status.textContent=`${presentation.toUpperCase()} pose · ${facing<0?'faces left':facing>0?'faces right':'neutral'} · ${playbackLabel} · ${previewLabel} · anchor (${live.emitter.anchorX}, ${live.emitter.anchorY}) · emitter ${size.width}×${size.height}`;requestAnimationFrame(animate);};resetPreview();requestAnimationFrame(animate);
    burst.addEventListener('click',()=>{particles.length=0;refreshSource();emitBurst();});
    let dragMode='';const setAnchor=e=>{const point=particlePreviewCell(canvas,e),x=point.x,y=point.y;inputMap.anchorX.setValue(x);inputMap.anchorY.setValue(y);commit(id,live=>{live.emitter.anchorX=x;live.emitter.anchorY=y;},{refresh:false});renderPoseEmitterPreview(canvas,liveBinding(),poseSource,particles);};const resizeRegion=e=>{const live=liveBinding(),ax=Math.max(0,Math.min(31,Number(live.emitter?.anchorX)||0)),ay=Math.max(0,Math.min(20,Number(live.emitter?.anchorY)||0)),size=particleEmitterSizeToPointer(canvas,e,ax,ay);inputMap.emitterWidth.setValue(size.width);inputMap.emitterHeight.setValue(size.height);commit(id,row=>{row.emitter.emitterWidth=size.width;row.emitter.emitterHeight=size.height;},{refresh:false});renderPoseEmitterPreview(canvas,liveBinding(),poseSource,particles);};canvas.title='Drag the yellow marker to move the anchor; drag elsewhere to resize the emitter';canvas.addEventListener('pointerdown',e=>{const point=particlePreviewCell(canvas,e),live=liveBinding(),ax=Math.max(0,Math.min(31,Number(live.emitter?.anchorX)||0)),ay=Math.max(0,Math.min(20,Number(live.emitter?.anchorY)||0));dragMode=Math.abs(point.x-ax)<=1&&Math.abs(point.y-ay)<=1?'anchor':'resize';canvas.setPointerCapture?.(e.pointerId);if(dragMode==='anchor')setAnchor(e);else resizeRegion(e);});canvas.addEventListener('pointermove',e=>{if(dragMode==='anchor')setAnchor(e);else if(dragMode==='resize')resizeRegion(e);});canvas.addEventListener('pointerup',()=>{dragMode='';});canvas.addEventListener('pointercancel',()=>{dragMode='';});
    capture.addEventListener('click',async()=>{capture.disabled=true;for(const n of [3,2,1]){capture.textContent=String(n);status.textContent=`Capture in ${n}…`;await new Promise(resolve=>setTimeout(resolve,1000));}const captured=currentHeroPoseCanvas();capture.textContent='Capture 3·2·1';capture.disabled=false;if(!captured){status.textContent='Hero pose unavailable.';return;}const logical=fitSpriteIntoCanvas(captured,32,21);commit(id,live=>{live.capturedPose=logical.toDataURL('image/png');});poseSource=logical;resetPreview();});
  });
  const add=document.createElement('button');add.type='button';add.className='hero-pose-add';add.textContent='＋ Add event generator';add.disabled=(currentEffect()?.bindings?.length||0)>=MAX_POSE_EMITTER_BINDINGS;add.title=add.disabled?`This tool is capped at ${MAX_POSE_EMITTER_BINDINGS} generators.`:'Add another event-bound generator; generators may share the same event';add.addEventListener('click',()=>{const live=currentEffect();live.enabled=true;if(!Array.isArray(live.bindings))live.bindings=[];if(live.bindings.length>=MAX_POSE_EMITTER_BINDINGS)return;const event=selectedAction;live.bindings.push({id:`posegen-${Date.now().toString(36)}-${live.bindings.length+1}`,event,holdMode:event==='weapon.fire'?'while-fire':event==='player.staff_hold'?'while-action':'frames',frames:2,classicFrameSource:'event',classicFrameId:11,rdxFrameSource:'event',rdxPn:0x63,rdxFrameIndex:0,emitter:{enabled:true,anchorX:25,anchorY:9,mirrorX:true,flipH:false,flipV:false,refX:0,refY:0,refW:32,refH:21,count:3,playbackMode:'loop',cadenceFrames:3,speed:18,lifeMs:260,spread:.35,gravity:-6,size:1,tone:'smoke'}});profile=normalizeProfile(profile);syncProfiles();buildInspector();saveLocal(true);});card.appendChild(add);
}

/* Default closed state remains equivalent to the old body.hidden=true behavior. Legacy calls were makeEffectCardCollapsible(card,title) and makeEffectCardCollapsible(box, heading); v2.1.87 adds stable drawer keys so only the chevron mutates state. */
function makeEffectCardCollapsible(card,title,drawerKey=''){
  const key=drawerKey||`drawer:${selectedAction}:${title.textContent.trim()}`;
  const toggle=document.createElement('button');toggle.type='button';toggle.className='icon-button effect-collapse-toggle';toggle.innerHTML='<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7 5 6 5-6"></path></svg>';
  const body=document.createElement('div');body.className='effect-card-body';while(card.children.length>1)body.appendChild(card.children[1]);card.appendChild(body);
  const open=toolDrawerState.get(key)===true;body.hidden=!open;card.classList.toggle('collapsed',!open);toggle.classList.toggle('open',open);toggle.title=open?'Collapse tool':'Expand tool';toggle.setAttribute('aria-label',toggle.title);
  const tools=title.querySelector('.effect-title-tools')||document.createElement('span');if(!tools.classList.contains('effect-title-tools')){tools.className='effect-title-tools';title.appendChild(tools);}tools.appendChild(toggle);
  toggle.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();const nextOpen=body.hidden;body.hidden=!nextOpen;toolDrawerState.set(key,nextOpen);card.classList.toggle('collapsed',!nextOpen);toggle.classList.toggle('open',nextOpen);toggle.title=nextOpen?'Collapse tool':'Expand tool';toggle.setAttribute('aria-label',toggle.title);});
}


function buildProjectileNearMissAnchorCard(host){
  if(selectedAction!=='projectile.near_miss')return;
  const card=document.createElement('section');card.className='effect-card projectile-near-miss-anchor-card';
  const title=document.createElement('div');title.className='effect-title';title.innerHTML='<div><strong>Projectile near-miss sprite anchor</strong><small>32×21 Hero reference · drag the marker</small></div>';
  const note=document.createElement('p');note.className='template-note';note.textContent='Defines the closest-pass point relative to the crawling Hero for the isolated LA-preview. The bullet crosses this anchor horizontally; Left/Right and Classic/Revival weapon art use the same normalized reference point.';
  const body=document.createElement('div');body.className='pose-emitter-body';
  const previewBox=document.createElement('div');previewBox.className='pose-emitter-preview-box';
  const canvas=document.createElement('canvas');canvas.className='attached-emitter-pose-canvas attached-emitter-live-preview';canvas.width=160;canvas.height=105;canvas.setAttribute('aria-label','Projectile near-miss Hero anchor preview');
  const status=document.createElement('small');status.className='attached-emitter-pose-status';
  previewBox.append(canvas,status);
  const controls=document.createElement('div');controls.className='pose-emitter-controls';
  const xControl=makePoseSliderControl({value:actionPreviewNearMissAnchor.x,min:0,max:31,step:1,onChange:value=>{actionPreviewNearMissAnchor.x=Math.round(value);saveLocal(true);render();}});
  const yControl=makePoseSliderControl({value:actionPreviewNearMissAnchor.y,min:0,max:20,step:1,onChange:value=>{actionPreviewNearMissAnchor.y=Math.round(value);saveLocal(true);render();}});
  controls.append(makeField('Anchor X',xControl.element),makeField('Anchor Y',yControl.element));
  const reset=document.createElement('button');reset.type='button';reset.textContent='Reset to hat';reset.addEventListener('click',()=>{actionPreviewNearMissAnchor={x:16,y:8};xControl.setValue(16);yControl.setValue(8);saveLocal(true);render();});controls.appendChild(reset);
  body.append(previewBox,controls);card.append(title,note,body);host.appendChild(card);
  const render=()=>{
    const ctx=canvas.getContext('2d');if(!ctx)return;const scale=5,w=32,h=21;ctx.imageSmoothingEnabled=false;ctx.fillStyle='#081018';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.strokeStyle='rgba(255,255,255,.07)';ctx.lineWidth=1;for(let x=0;x<=w;x+=4){ctx.beginPath();ctx.moveTo(x*scale+.5,0);ctx.lineTo(x*scale+.5,canvas.height);ctx.stroke();}for(let y=0;y<=h;y+=4){ctx.beginPath();ctx.moveTo(0,y*scale+.5);ctx.lineTo(canvas.width,y*scale+.5);ctx.stroke();}
    const presentation=actionPreviewPresentation(),frame=actionPreviewFrames('preview.crawl',actionPreviewDirection)[0]?.canvas||classicHeroFrameCanvas(actionPreviewDirection<0?19:7);
    if(frame){const rect=poseFitRect(frame,w,h);ctx.drawImage(frame,rect.x*scale,rect.y*scale,rect.w*scale,rect.h*scale);}
    const ax=actionPreviewNearMissAnchor.x,ay=actionPreviewNearMissAnchor.y,bullet=actionPreviewBulletSprite({direction:actionPreviewDirection,bullet:{direction:actionPreviewDirection}});
    ctx.save();ctx.globalAlpha=.28;ctx.fillStyle='#78c7ff';ctx.fillRect(0,Math.round(ay*scale+scale/2),canvas.width,1);ctx.restore();
    if(bullet?.canvas)drawActionPreviewCenteredProp(ctx,bullet.canvas,ax*scale+scale/2,ay*scale+scale/2,{scale});
    ctx.strokeStyle='#ffde75';ctx.lineWidth=2;ctx.strokeRect(ax*scale+.5,ay*scale+.5,scale-1,scale-1);ctx.beginPath();ctx.moveTo(ax*scale+scale/2,0);ctx.lineTo(ax*scale+scale/2,canvas.height);ctx.stroke();
    status.textContent=`${presentation.toUpperCase()} crawl · ${actionPreviewDirection<0?'left':'right'} · closest pass (${ax}, ${ay})`;
  };
  let dragging=false;const setAnchor=e=>{const rect=canvas.getBoundingClientRect(),x=Math.max(0,Math.min(31,Math.floor((e.clientX-rect.left)/rect.width*32))),y=Math.max(0,Math.min(20,Math.floor((e.clientY-rect.top)/rect.height*21)));actionPreviewNearMissAnchor={x,y};xControl.setValue(x);yControl.setValue(y);saveLocal(true);render();};
  canvas.addEventListener('pointerdown',e=>{dragging=true;canvas.setPointerCapture?.(e.pointerId);setAnchor(e);});canvas.addEventListener('pointermove',e=>{if(dragging)setAnchor(e);});canvas.addEventListener('pointerup',()=>{dragging=false;});canvas.addEventListener('pointercancel',()=>{dragging=false;});render();
}

function renderEffectCompatibility(marker,effectKey,effect,meta){
  const compatibility=effectCompatibility(effectKey,effect);
  marker.dataset.period=compatibility.compatible?'period':'enhanced';
  marker.textContent=compatibility.compatible
    ? `${compatibilityBadge(compatibility)} · ${meta.period || 'CD32-safe authoring technique'} · fallback: ${meta.fallback || 'native implementation'}`
    : `${compatibilityBadge(compatibility)} · ${compatibilitySummary(compatibility)} · CD32 fallback: ${meta.fallback || 'opaque/masked alternative'}`;
}

function appendPresentationLayerMaskEditor(card,effect,commitEffect){
  const group=document.createElement('div');group.className='effect-fields presentation-layer-mask-editor';
  const presetRow=document.createElement('label');presetRow.className='sample-row';presetRow.textContent='Presentation layers';
  const preset=document.createElement('select');
  const presets=[['allGameplay','All gameplay'],['worldOnly','World only'],['behindActors','Behind actors'],['inFrontOfActors','In front of actors'],['everythingButMidground','Everything but midground'],['sceneryWithoutMidground','Backdrop + decorations']];
  const current=normalizePresentationLayerSelection(effect.layerMask,PRESENTATION_LAYER_MASK_PRESETS.allGameplay);
  const currentKey=presets.find(([key])=>{const value=PRESENTATION_LAYER_MASK_PRESETS[key];return value.length===current.length&&value.every((layer,index)=>layer===current[index]);})?.[0]||'custom';
  for(const [value,label] of [...presets,['custom','Custom']]){const option=document.createElement('option');option.value=value;option.textContent=label;preset.appendChild(option);}preset.value=currentKey;
  preset.addEventListener('change',()=>{if(preset.value==='custom')return;commitEffect(live=>{live.layerMask=[...PRESENTATION_LAYER_MASK_PRESETS[preset.value]];},{rebuild:true});});presetRow.appendChild(preset);group.appendChild(presetRow);
  const checks=document.createElement('div');checks.className='presentation-layer-mask-checks';
  const selected=new Set(current);
  for(const layer of PRESENTATION_LAYERS){const row=document.createElement('label');row.className='toggle';const check=document.createElement('input');check.type='checkbox';check.checked=selected.has(layer);row.append(check,document.createTextNode(` ${layer}`));check.addEventListener('change',()=>commitEffect(live=>{const next=new Set(normalizePresentationLayerSelection(live.layerMask,PRESENTATION_LAYER_MASK_PRESETS.allGameplay));if(check.checked)next.add(layer);else next.delete(layer);live.layerMask=PRESENTATION_LAYERS.filter(item=>next.has(item));},{rebuild:true}));const solo=document.createElement('button');solo.type='button';solo.className='small-button';solo.textContent=actionPreviewPresentationSolo===layer?'Solo ✓':'Solo';solo.title=`Preview only the ${layer} presentation band`;solo.addEventListener('click',e=>{e.preventDefault();actionPreviewPresentationSolo=actionPreviewPresentationSolo===layer?'':layer;buildInspector();});row.appendChild(solo);checks.appendChild(row);}group.appendChild(checks);
  if(actionPreviewPresentationSolo){const clear=document.createElement('button');clear.type='button';clear.className='small-button';clear.textContent='Preview all layers';clear.addEventListener('click',()=>{actionPreviewPresentationSolo='';buildInspector();});group.appendChild(clear);}
  const help=document.createElement('small');help.className='effect-help';help.textContent=`Affected: ${current.length?current.join(', '):'none'}. Only selected presentation bands receive this effect.${actionPreviewPresentationSolo?` Preview solo: ${actionPreviewPresentationSolo}.`:''}`;group.appendChild(help);card.appendChild(group);
}

function buildInspector() {
  const action = ACTIONS.find(a => a.id === selectedAction), recipe = profile.actions[selectedAction];
  $('inspector-title').textContent = action.label; $('inspector-subtitle').textContent = `${action.id} · editing B`; $('action-enabled').checked = recipe.enabled;
  refreshActionClipboardControls();
  const cost = estimateActionCost(recipe), badge = $('action-cost-badge'); badge.textContent = `${cost.grade} · ${cost.points.toFixed(2)}`; badge.dataset.grade = cost.grade;
  buildActionPreview();
  const host = $('effect-editor'); host.textContent = ''; buildProjectileNearMissAnchorCard(host); buildActionTemplatePicker(host); buildExplosionFamilyPreviewCard(host); buildExplosionNearMissGameplayCard(host);
  for (const effectKey of ACTION_INSPECTOR_EFFECT_KEYS) {
    const meta=EFFECT_META[effectKey];
    const effect = recipe[effectKey], card = document.createElement('section'); card.className = 'effect-card';
    /* normalizeProfile() replaces nested effect objects. Never mutate the
     * object captured when this card was built: after the first edit it may be
     * stale, which previously made subsequent LA-preview/clipboard edits look
     * ignored or revert to old values. Resolve the currently normalized
     * selected-action effect at interaction time, exactly as clipboard copy
     * now does. */
    const liveEffect=()=>profile.actions?.[selectedAction]?.[effectKey]||effect;
    let refreshEffectCompatibility=()=>{};
    const commitEffect=(mutate,{rebuild=false,list=false,cost=false}={})=>{const live=liveEffect();if(!live)return;mutate(live);profile=normalizeProfile(profile);syncProfiles();if(list)buildActionList();if(cost)updateCostOnly();saveLocal();if(rebuild)buildInspector();else refreshEffectCompatibility();};
    const title = document.createElement('div'); title.className = 'effect-title'; title.innerHTML = `<label class="toggle"><input type="checkbox" ${effect.enabled ? 'checked' : ''}> <strong>${meta.label}</strong></label><small>${meta.cost}</small>`;
    addEffectClipboardControls(title,effectKey,effect);
    title.querySelector('input').addEventListener('change', e => commitEffect(live=>{live.enabled=e.target.checked;},{list:true,cost:true})); card.appendChild(title);
    const accuracy=document.createElement('div'); accuracy.className='period-accuracy';
    refreshEffectCompatibility=()=>renderEffectCompatibility(accuracy,effectKey,liveEffect(),meta);
    refreshEffectCompatibility();
    card.appendChild(accuracy);
    buildEffectTemplatePicker(card, effectKey);
    if (effectKey === 'poseEmitter') addPoseEmitterControls(card,effect);
    if (['actorFlash','worldFlash'].includes(effectKey)) {
      const colorRow = document.createElement('label'); colorRow.className = 'sample-row'; colorRow.textContent = effectKey === 'actorFlash' ? 'Flash color' : 'Color';
      const colorSelect = document.createElement('select');
      const colors = effectKey === 'actorFlash' ? ['white','red'] : ['white','gray','red'];
      for (const color of colors) { const opt = document.createElement('option'); opt.value = color; opt.textContent = color[0].toUpperCase() + color.slice(1); colorSelect.appendChild(opt); }
      colorSelect.value = colors.includes(effect.color) ? effect.color : 'white';
      colorSelect.addEventListener('change', () => commitEffect(live=>{live.color=colorSelect.value;}));
      colorRow.appendChild(colorSelect); card.appendChild(colorRow);
    }
    if (effectKey === 'particles') {
      addParticleEmitterPreview(card,liveEffect,commitEffect);
      const toneRow=document.createElement('label'); toneRow.className='sample-row'; toneRow.textContent='Particle appearance';
      const toneSelect=document.createElement('select');
      for(const value of ['dust','smoke','spark']){const opt=document.createElement('option');opt.value=value;opt.textContent=value[0].toUpperCase()+value.slice(1);toneSelect.appendChild(opt);}
      toneSelect.value=effect.tone||'dust'; toneSelect.addEventListener('change',()=>commitEffect(live=>{live.tone=toneSelect.value;})); toneRow.appendChild(toneSelect); card.appendChild(toneRow);
      const shapeRow=document.createElement('label'); shapeRow.className='sample-row'; shapeRow.textContent='Particle mask';
      const shapeSelect=document.createElement('select');
      for(const [value,label] of [['block','Block'],['puff','Masked puff']]){const opt=document.createElement('option');opt.value=value;opt.textContent=label;shapeSelect.appendChild(opt);}
      shapeSelect.value=effect.shape||'block'; shapeSelect.addEventListener('change',()=>commitEffect(live=>{live.shape=shapeSelect.value;})); shapeRow.appendChild(shapeSelect); card.appendChild(shapeRow);
      const shrinkRow=document.createElement('label'); shrinkRow.className='toggle audio-event-pan'; const shrinkCheck=document.createElement('input'); shrinkCheck.type='checkbox'; shrinkCheck.checked=!!effect.shrink;
      shrinkRow.append(shrinkCheck,document.createTextNode(' Dissipate via fixed large → medium → 1px BOB stages'));
      shrinkCheck.addEventListener('change',()=>commitEffect(live=>{live.shrink=shrinkCheck.checked;})); card.appendChild(shrinkRow);
    }
    if (effectKey === 'flash') {
      const scopeRow=document.createElement('label'); scopeRow.className='sample-row'; scopeRow.textContent='Affected presentation';
      const scopeSelect=document.createElement('select');
      for(const [value,label] of [['area','Area · all presentation'],['foreground','Foreground tiles only'],['background','Background tiles only'],['nearby-actors','Nearby sprites'],['target-actor','Selected / target sprite']]) { const opt=document.createElement('option');opt.value=value;opt.textContent=label;scopeSelect.appendChild(opt); }
      scopeSelect.value=effect.targetMode||'area'; scopeSelect.addEventListener('change',()=>commitEffect(live=>{live.targetMode=scopeSelect.value;})); scopeRow.appendChild(scopeSelect); card.appendChild(scopeRow);
    }
    if (effectKey === 'worldFlash') {
      const backgroundRow = document.createElement('label'); backgroundRow.className = 'sample-row'; backgroundRow.textContent = 'Background tone';
      const backgroundSelect = document.createElement('select');
      for (const tone of ['white','off-white','faint-white','gray','red']) { const opt=document.createElement('option'); opt.value=tone; opt.textContent=tone.replace('-', ' '); backgroundSelect.appendChild(opt); }
      backgroundSelect.value = effect.backgroundColor || 'off-white'; backgroundSelect.addEventListener('change',()=>commitEffect(live=>{live.backgroundColor=backgroundSelect.value;})); backgroundRow.appendChild(backgroundSelect); card.appendChild(backgroundRow);
      appendPresentationLayerMaskEditor(card,effect,commitEffect);
    }
    if (effectKey === 'foregroundDust') appendPresentationLayerMaskEditor(card,effect,commitEffect);
    if (effectKey === 'camera') {
      const impactRow=document.createElement('label'); impactRow.className='toggle audio-event-pan'; const impactCheck=document.createElement('input'); impactCheck.type='checkbox'; impactCheck.checked=!!effect.impactLinked;
      impactRow.append(impactCheck, document.createTextNode(' Scale amplitude from event impact (fall height / hit strength)'));
      impactCheck.addEventListener('change',()=>commitEffect(live=>{live.impactLinked=impactCheck.checked;})); card.appendChild(impactRow);
    }
    if (effectKey === 'spriteImpulse') {
      const modeRow=document.createElement('label'); modeRow.className='sample-row'; modeRow.textContent='Deformation technique';
      const modeSelect=document.createElement('select');
      for(const [value,label] of [['blitter-bands','Blitter band displacement · period-accurate'],['translate','Translation only · period-accurate'],['scale','Real-time scale · enhanced / not period-accurate']]) { const opt=document.createElement('option');opt.value=value;opt.textContent=label;modeSelect.appendChild(opt); }
      modeSelect.value=effect.deformationMode || 'blitter-bands';
      modeSelect.addEventListener('change',()=>commitEffect(live=>{live.deformationMode=modeSelect.value;},{rebuild:true}));
      modeRow.appendChild(modeSelect); card.appendChild(modeRow);
      const degradeRow=document.createElement('label'); degradeRow.className='toggle audio-event-pan'; const degradeCheck=document.createElement('input'); degradeCheck.type='checkbox'; degradeCheck.checked=!!effect.degradeSprite;
      degradeRow.append(degradeCheck, document.createTextNode(' Allow sprite degradation (drop scan rows during squash)'));
      degradeCheck.addEventListener('change',()=>commitEffect(live=>{live.degradeSprite=degradeCheck.checked;})); card.appendChild(degradeRow);
    }
    if (effectKey === 'audio') {
      const sampleRow = document.createElement('label'); sampleRow.className = 'sample-row'; sampleRow.textContent = 'Sample';
      const sampleSelect = document.createElement('select'); for (const sample of GAME_SAMPLES) { const opt = document.createElement('option'); opt.value = sample; opt.textContent = sample; sampleSelect.appendChild(opt); }
      sampleSelect.value = effect.sample || 'walk.wav'; sampleSelect.addEventListener('change', () => commitEffect(live=>{live.sample=sampleSelect.value;})); sampleRow.appendChild(sampleSelect); card.appendChild(sampleRow);
      const panRow = document.createElement('label'); panRow.className = 'toggle audio-event-pan'; const panCheck = document.createElement('input'); panCheck.type = 'checkbox'; panCheck.checked = !!effect.panFromEvent; panRow.append(panCheck, document.createTextNode(' Pan from event / projectile side')); panCheck.addEventListener('change', () => commitEffect(live=>{live.panFromEvent=panCheck.checked;})); card.appendChild(panRow);
    }
    const fields = document.createElement('div'); fields.className = 'effect-fields';
    for (const [key, label, min, max, step] of meta.fields) {
      const field = document.createElement('label'); field.textContent = label; const input = document.createElement('input'); input.type = 'number'; input.min = min; input.max = max; input.step = step; input.value = effect[key]; input.dataset.effectKey = effectKey; input.dataset.fieldKey = key;
      input.addEventListener('input', () => commitEffect(live=>{live[key]=Number(input.value);},{cost:true,list:true})); field.appendChild(input); fields.appendChild(field);
    }
    card.appendChild(fields); makeEffectCardCollapsible(card,title,`action:${selectedAction}:effect:${effectKey}`); host.appendChild(card);
  }
  updateLiveDocs();
}
function updateCostOnly() {
  const cost = estimateActionCost(profile.actions[selectedAction]), badge = $('action-cost-badge'); badge.textContent = `${cost.grade} · ${cost.points.toFixed(2)}`; badge.dataset.grade = cost.grade;
  $('metric-profile-cost').textContent = `${profileWorstCaseCost(profile).totalPoints.toFixed(1)} pts`;
  const era=profileCompatibility(profile), eraMetric=$('metric-era-fit');
  if(eraMetric){eraMetric.textContent=compatibilityBadge(era);eraMetric.dataset.period=era.compatible?'period':'enhanced';const detail=$('metric-era-detail');if(detail)detail.textContent=compatibilitySummary(era);}
  updateLiveDocs();
}

function syncPoseEmitterReferencesForEvent(eventType){
  const presentation=preview?.presentation||$('presentation-source')?.value||'classic';
  for(const action of Object.values(profile.actions||{})){
    if(!action?.poseEmitter?.enabled)continue;
    for(const binding of action.poseEmitter.bindings||[]){
      if(binding?.event!==eventType)continue;
      const source=poseBindingFrameCanvas(binding,presentation);
      syncPoseEmitterReference(binding,source,presentation);
    }
  }
}

function dispatchJuiceEvent(event) {
  syncPoseEmitterReferencesForEvent(event.type);
  nativeActionPreviewRunner?.noteEvent(event);
  if(actionPreviewSource==='live'&&nativeActionPreviewRuntime&&nativeActionPreviewRuntimeAction===event.type){nativeActionPreviewRuntime.trigger(event);nativeActionPreviewLastEvent={...event};}
  runtimeA.trigger(event);
  const exactNativeAudio = audioAffectsLiveEdits && audioRouteArmedAction === event.type && event.type === selectedAudioAction && !!NATIVE_ACTION_SFX[event.type];
  runtimeB.trigger(exactNativeAudio ? { ...event, skipAuthoredAudio:true } : event);
  if (audioAffectsLiveEdits && event.type === selectedAudioAction) {
    const status=$('audio-live-route-status'), audio=profile.actions?.[event.type]?.audio;
    if(status&&audio?.enabled)status.textContent=`Live audio route: heard event ${event.type} · authored ${audio.sample || 'sample'} · gain ${Number(audio.gain ?? 0).toFixed(2)}.`;
  }
}
function handleEvent(event) {
  /* Native capture owns event ordering. Queue effects emitted during capture so
   * existing effects age for that xrick tick before the new event starts at
   * full strength. Manual editor triggers still dispatch immediately. */
  if (captureInProgress) pendingCaptureEvents.push(event); else dispatchJuiceEvent(event);
  if (suppressCaptureEventLog) return;
  const line = { id: event.id, type: event.type, magnitude: Number(event.magnitude ?? 1), frame: event.frameSerial };
  eventRows.unshift(line); if (eventRows.length > 12) eventRows.length = 12;
  $('last-event').textContent = `${event.type} · m=${line.magnitude.toFixed(2)} · frame ${line.frame ?? 'manual'}`;
  $('event-log-list').innerHTML = eventRows.map(row => `<div class="event-row"><span>#${row.id}</span><strong>${row.type}</strong><span>m=${row.magnitude.toFixed(2)}</span></div>`).join('');
}
function handleNativeSfxEvent(event) {
  const audition = $('audio-audition')?.value || 'b';
  const mode = $('compare-mode')?.value || 'side';
  const bVisible = mode === 'side' || mode === 'b';
  const liveB = audioAffectsLiveEdits && bVisible && (audition === 'b' || audition === 'both');
  if (!liveB) return;
  const nativeSample = NATIVE_ACTION_SFX[selectedAudioAction];
  const expectedId = NATIVE_SFX_IDS[nativeSample];
  if (!Number.isInteger(expectedId) || Number(event?.logicalId) !== expectedId) return;
  const pan = Math.max(-1, Math.min(1, (Number(event?.screenX ?? 160) - 160) / 160));
  const heard = runtimeB.triggerAudioOnly({
    id:`native-sfx:${event.serial}`, type:selectedAudioAction, magnitude:1,
    audioPan:pan, audioRate:1, frameSerial:event.frameSerial, nativeSfxSerial:event.serial
  });
  const status = $('audio-live-route-status');
  if (heard) {
    if (status) status.textContent = `Live audio route: native ${nativeSample} #${event.serial} → authored ${profile.actions?.[selectedAudioAction]?.audio?.sample || 'sample'}${event.suppressed ? ' · native suppressed' : ' · native retained until route is armed'}.`;
  } else {
    /* Recover immediately for the next native request if WebAudio becomes
     * suspended or a transformed voice fails after it was armed. Never leave
     * an action permanently silent after a failed accent audition. */
    audioRouteArmedAction = '';
    preview?.clearNativeSfxSuppressions?.();
    if (status) status.textContent = `Live audio route: authored playback failed; native ${nativeSample} restored.`;
  }
}

function triggerActionTest(actionId = selectedAction) {
  if (!preview || !latestSnapshot) return;
  if(actionPreviewSource==='live'){
    if(actionId!==selectedAction){selectedAction=actionId;buildActionList();buildInspector();}
    startNativeActionPreviewScenario({restart:true});
    if($('save-status'))$('save-status').textContent=`Replaying ${ACTIONS.find(item=>item.id===selectedAction)?.label||selectedAction} through the real native xrick simulation.`;
    return;
  }
  let slot = actionId.startsWith('dynamite.') ? 3 : actionId.startsWith('bullet.') ? 2 : 1;
  if (actionId.startsWith('platform.')) {
    const platform = (latestSnapshot.entities || []).find(entity => Number(entity.movingPlatformState || 0) !== 0);
    if (!platform) {
      if ($('save-status')) $('save-status').textContent = 'No native-classified moving platform is present in this room; use the isolated Live Action preview to audition this effect.';
      return;
    }
    slot = platform.slot;
  }
  if (actionId === 'bullet.target_hit' || actionId === 'enemy.stick_hit' || actionId === 'dynamite.target_hit') {
    const enemy = (latestSnapshot.entities || []).find(entity => { const n = Number(entity.n) & 0x7f; return entity.slot > 3 && n >= 0x04 && n <= 0x0f; });
    slot = enemy?.slot ?? 4;
  }
  if (actionId === 'player.projectile_hit' || actionId === 'player.explosion_hit') slot = 1;
  const bounds = preview.entityBounds(latestSnapshot, slot) || preview.entityBounds(latestSnapshot, 1);
  const x = bounds ? (bounds.left + bounds.right) / 2 : 160, y = bounds ? (bounds.top + bounds.bottom) / 2 : 100;
  let hudBounds = null;
  if (actionId === 'weapon.fire' || actionId === 'ammo.deplete') { const i = Math.max(0, Math.min(5, Number(latestSnapshot.inventory?.bullets || 1) - 1)); hudBounds = { left:104+i*8,top:0,right:112+i*8,bottom:8,resource:'bullet',index:i }; }
  if (actionId === 'dynamite.place') { const i = Math.max(0, Math.min(5, Number(latestSnapshot.inventory?.dynamite || 1) - 1)); hudBounds = { left:168+i*8,top:0,right:176+i*8,bottom:8,resource:'dynamite',index:i }; }
  handleEvent({ id: ++preview.eventSerial, type: actionId, x, y, direction: latestSnapshot.rick.direction ? -1 : 1, magnitude: actionId === 'player.land' ? .85 : 1, targetSlot: slot, targetBounds: bounds, frameSerial: latestSnapshot.frameSerial, hudBounds, hudInventoryBounds: preview.hudInventoryBounds(latestSnapshot), audioPan: actionId === 'projectile.near_miss' ? .75 : 0, audioRate: actionId === 'projectile.near_miss' ? 1.1 : 1, manual: true });
}
function triggerSelectedTest() { triggerActionTest(selectedAction); }

function setControlActive(active) {
  controlActive = !!active; $('arena-frame').classList.toggle('control-active', controlActive);
  if (!controlActive) preview?.clearKeys();
}
function bindControls() {
  /* Action clipboard authoring is independent of the native live preview.
   * Bind it during the synchronous editor setup so copy/paste remains usable
   * while WASM/room data is still loading, or if preview initialization fails. */
  setIconButton($('action-copy'),'copy','Copy entire action configuration');
  setIconButton($('action-paste'),'paste','Paste entire action configuration');
  $('action-copy').addEventListener('click',copySelectedActionConfiguration);
  $('action-paste').addEventListener('click',pasteSelectedActionConfiguration);
  $('action-clipboard-apply').addEventListener('click',()=>{
    try{
      applyActionClipboardText($('action-clipboard-text').value,$('action-clipboard-dialog').dataset.targetAction);
      $('action-clipboard-dialog').close();
    }catch(error){$('action-clipboard-message').textContent=error.message;}
  });
  refreshActionClipboardControls();

  /* Any editor interaction is a valid user gesture to unlock both native
   * SDL/Paula audio and the authored WebAudio monitor before gameplay events. */
  document.addEventListener('pointerdown', unlockGameplayAudio, { capture:true });
  document.addEventListener('keydown', unlockGameplayAudio, { capture:true });
  $('arena-frame').addEventListener('pointerdown', () => { unlockGameplayAudio(); setControlActive(true); $('arena-frame').focus(); });
  $('arena-frame').addEventListener('focus', () => setControlActive(true)); $('arena-frame').addEventListener('blur', () => setControlActive(false));
  window.addEventListener('keydown', event => {
    if (!controlActive || nativeActionPreviewOwned() || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLButtonElement) return;
    unlockGameplayAudio();
    const keys = ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','KeyA','KeyD','KeyS','KeyZ','KeyX','KeyC','Space'];
    if (keys.includes(event.code)) { event.preventDefault(); preview?.keyDown(event.code); }
  }, true);
  window.addEventListener('keyup', event => { if (controlActive && !nativeActionPreviewOwned()) preview?.keyUp(event.code); }, true);
  window.addEventListener('blur', () => setControlActive(false));
}

async function buildLevelSelect() {
  const response = await fetch('./rdx/data/rdx_runtime_room_manifest.json', { cache: 'no-store' }); if (!response.ok) throw new Error(`Room manifest load failed (${response.status})`);
  const manifest = await response.json(); const select = $('level-select'); select.textContent = '';
  const groupLabel = { south_america: 'Jungle / South America', egypt: 'Egypt', castle: 'Castle', missile: 'Missile base' };
  let lastGroup = null, optgroup = null;
  for (const room of manifest.rooms || []) {
    if (room.group !== lastGroup) { lastGroup = room.group; optgroup = document.createElement('optgroup'); optgroup.label = groupLabel[room.group] || room.group; select.appendChild(optgroup); }
    const opt = document.createElement('option'); opt.value = room.submap; opt.textContent = `${room.submapName} · ${room.mapName}`; optgroup.appendChild(opt);
  }
  return manifest;
}

function updateComparisonLabels() {
  const accepted = baselineMode === 'accepted';
  const aStatus = accepted ? 'ACCEPTED JUICE BASELINE' : 'JUICE OFF';
  const aDetail = accepted ? 'frozen accepted B profile' : 'raw xrick presentation';
  $('pane-a-status').textContent = aStatus;
  $('baseline-banner-status').textContent = `${aStatus} · ${aDetail}`;
  $('baseline-toolbar-status').textContent = accepted ? 'A = accepted juice baseline' : 'A = raw xrick / JUICE OFF';
  $('reset-baseline').disabled = !accepted;
}
function updateGameplayFeelUi() {
  const values = {
    'movement-walk-speed': gameplayTuning.walkSpeed,
    'movement-coyote-frames': gameplayTuning.coyoteFrames,
    'movement-jump-buffer-frames': gameplayTuning.jumpBufferFrames,
    'movement-ladder-top-entry-tolerance': gameplayTuning.ladderTopEntryTolerance,
    'movement-jump-takeoff': gameplayTuning.jumpTakeoff,
    'movement-gravity': gameplayTuning.gravity,
    'movement-apex-gravity': gameplayTuning.apexGravityPercent,
    'movement-jump-release': gameplayTuning.jumpReleasePercent,
    'movement-max-fall': gameplayTuning.maxFall,
    'movement-fall-bounce-min-height': gameplayTuning.fallBounceMinHeight,
    'movement-platform-curve': gameplayTuning.platformCurveMode,
    'movement-platform-curve-x1': gameplayTuning.platformCurveX1, 'movement-platform-curve-y1': gameplayTuning.platformCurveY1,
    'movement-platform-curve-x2': gameplayTuning.platformCurveX2, 'movement-platform-curve-y2': gameplayTuning.platformCurveY2
  };
  for (const [id, value] of Object.entries(values)) if ($(id)) $(id).value = String(value);
  const custom=gameplayTuning.platformCurveMode==='custom';if($('movement-platform-custom'))$('movement-platform-custom').dataset.disabled=String(!custom);for(const id of ['movement-platform-curve-x1','movement-platform-curve-y1','movement-platform-curve-x2','movement-platform-curve-y2'])if($(id))$(id).disabled=!custom;drawPlatformCurvePreview();
  if ($('movement-toolbar-summary')) $('movement-toolbar-summary').textContent = `Coyote ${gameplayTuning.coyoteFrames}f · buffer ${gameplayTuning.jumpBufferFrames}f · ladder +${gameplayTuning.ladderTopEntryTolerance}px · jump ${gameplayTuning.jumpTakeoff.toFixed(2)} · gravity ${gameplayTuning.gravity.toFixed(3)} · platform ${gameplayTuning.platformCurveMode}`;
  if ($('movement-status')) $('movement-status').textContent = `Walk ${gameplayTuning.walkSpeed}px/f · coyote ${gameplayTuning.coyoteFrames}f · buffer ${gameplayTuning.jumpBufferFrames}f · ladder +${gameplayTuning.ladderTopEntryTolerance}px · platform ${gameplayTuning.platformCurveMode} · shared 8×8 collision`;
  const solver = preview?.collisionMode?.() || (($('presentation-source')?.value || 'classic') === 'rdx' ? 'RDX descriptors + xrick' : 'Classic xrick');
  if ($('collision-solver-status')) $('collision-solver-status').textContent = solver;
}

function drawPlatformCurvePreview() {
  const canvas=$('movement-platform-curve-preview'),ctx=canvas?.getContext('2d');if(!ctx)return;
  const w=canvas.width,h=canvas.height,pad=12,yMin=-.4,yMax=1.4,mapY=value=>pad+(yMax-value)/(yMax-yMin)*(h-pad*2);ctx.clearRect(0,0,w,h);ctx.fillStyle='#081018';ctx.fillRect(0,0,w,h);
  ctx.strokeStyle='#263846';ctx.lineWidth=1;for(let i=0;i<=4;i++){const x=pad+(w-pad*2)*i/4;ctx.beginPath();ctx.moveTo(x,pad);ctx.lineTo(x,h-pad);ctx.stroke();}
  for(const value of [0,.5,1]){const y=mapY(value);ctx.beginPath();ctx.moveTo(pad,y);ctx.lineTo(w-pad,y);ctx.stroke();}
  ctx.strokeStyle='#6f7c84';ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(pad,mapY(0));ctx.lineTo(w-pad,mapY(1));ctx.stroke();ctx.setLineDash([]);
  ctx.strokeStyle='#ead078';ctx.lineWidth=2;ctx.beginPath();for(let i=0;i<=64;i++){const xNorm=i/64,yNorm=platformCurveProgress(xNorm,gameplayTuning),x=pad+xNorm*(w-pad*2),y=mapY(yNorm);if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.stroke();
}

function applyGameplayTuning({ save = true } = {}) {
  gameplayTuning.walkSpeed = clampInteger(gameplayTuning.walkSpeed, 1, 4, DEFAULT_GAMEPLAY_TUNING.walkSpeed);
  gameplayTuning.coyoteFrames = clampInteger(gameplayTuning.coyoteFrames, 0, 8, DEFAULT_GAMEPLAY_TUNING.coyoteFrames);
  gameplayTuning.jumpBufferFrames = clampInteger(gameplayTuning.jumpBufferFrames, 0, 8, DEFAULT_GAMEPLAY_TUNING.jumpBufferFrames);
  gameplayTuning.ladderTopEntryTolerance = clampInteger(gameplayTuning.ladderTopEntryTolerance, 0, 6, DEFAULT_GAMEPLAY_TUNING.ladderTopEntryTolerance);
  gameplayTuning.jumpTakeoff = clampNumber(gameplayTuning.jumpTakeoff, 2, 8, DEFAULT_GAMEPLAY_TUNING.jumpTakeoff);
  gameplayTuning.gravity = clampNumber(gameplayTuning.gravity, 0.125, 2, DEFAULT_GAMEPLAY_TUNING.gravity);
  gameplayTuning.apexGravityPercent = clampInteger(gameplayTuning.apexGravityPercent, 25, 150, DEFAULT_GAMEPLAY_TUNING.apexGravityPercent);
  gameplayTuning.jumpReleasePercent = clampInteger(gameplayTuning.jumpReleasePercent, 25, 100, DEFAULT_GAMEPLAY_TUNING.jumpReleasePercent);
  gameplayTuning.maxFall = clampNumber(gameplayTuning.maxFall, 2, 16, DEFAULT_GAMEPLAY_TUNING.maxFall);
  /* Legacy native-solver correction fields can exist in saved presets, but
   * the unified xrick solver deliberately does not consume them. */
  gameplayTuning.ceilingCorrection = 0;
  gameplayTuning.groundSnap = 0;
  gameplayTuning.fallBounceMinHeight = clampInteger(gameplayTuning.fallBounceMinHeight, 0, 192, DEFAULT_GAMEPLAY_TUNING.fallBounceMinHeight);
  gameplayTuning.explosionNearBounceLift = clampNumber(gameplayTuning.explosionNearBounceLift, .25, 5, DEFAULT_GAMEPLAY_TUNING.explosionNearBounceLift);
  Object.assign(gameplayTuning, normalizePlatformCurveTuning(gameplayTuning));
  if (preview) {
    gameplayTuning.walkSpeed = preview.setWalkSpeed(gameplayTuning.walkSpeed);
    gameplayTuning.coyoteFrames = preview.setCoyoteFrames(gameplayTuning.coyoteFrames);
    gameplayTuning.jumpBufferFrames = preview.setJumpBufferFrames(gameplayTuning.jumpBufferFrames);
    gameplayTuning.ladderTopEntryTolerance = preview.setLadderTopEntryTolerance(gameplayTuning.ladderTopEntryTolerance);
    gameplayTuning.jumpTakeoff = preview.setJumpTakeoff(gameplayTuning.jumpTakeoff);
    gameplayTuning.gravity = preview.setGravity(gameplayTuning.gravity);
    gameplayTuning.apexGravityPercent = preview.setApexGravityPercent(gameplayTuning.apexGravityPercent);
    gameplayTuning.jumpReleasePercent = preview.setJumpReleasePercent(gameplayTuning.jumpReleasePercent);
    gameplayTuning.maxFall = preview.setMaxFall(gameplayTuning.maxFall);
    gameplayTuning.fallBounceMinHeight = preview.setFallBounceMinHeight(gameplayTuning.fallBounceMinHeight);
    gameplayTuning.explosionNearBounceLift=preview.setExplosionNearBounceLift(Math.round(gameplayTuning.explosionNearBounceLift*256))/256;
    const controls=platformCurveControls(gameplayTuning);preview.setPlatformCurveCustom({x1:controls[0],y1:controls[1],x2:controls[2],y2:controls[3]});preview.setPlatformCurveMode(platformCurveModeValue(gameplayTuning.platformCurveMode));
  }
  updateGameplayFeelUi();
  updateLiveDocs();
  if (save) saveLocal();
}

function updateLiveDocs() {
  const action = ACTIONS.find(item => item.id === selectedAction);
  const preset = PERFORMANCE_PRESETS[profile.performancePreset] || PERFORMANCE_PRESETS.potato25;
  const level = $('level-select')?.selectedOptions?.[0]?.textContent || 'Loading…';
  const presentation = $('presentation-source')?.selectedOptions?.[0]?.textContent || 'Classic xrick';
  const audioQuality = $('audio-quality')?.selectedOptions?.[0]?.textContent || 'HIGH';
  const audioFilter = $('audio-filter')?.selectedOptions?.[0]?.textContent || 'A500';
  const audioSpatial = $('audio-spatial')?.selectedOptions?.[0]?.textContent || 'Headphones';
  const audition = $('audio-audition')?.selectedOptions?.[0]?.textContent || 'Native audio only';
  $('doc-baseline-status').textContent = baselineMode === 'accepted' ? 'A accepted baseline → B editable' : 'A JUICE OFF → B editable';
  $('doc-presentation').textContent = presentation;
  $('doc-level').textContent = level;
  $('doc-action').textContent = action ? `${action.label} · ${estimateActionCost(profile.actions[selectedAction]).points.toFixed(1)} pts` : selectedAction;
  $('doc-performance').textContent = preset.label;
  $('doc-audio').textContent = `${audioQuality} · ${audioFilter} · ${audioSpatial} · ${audition}`;
  const collision = preview?.collisionMode?.() || (($('presentation-source')?.value || 'classic') === 'rdx' ? 'RDX descriptors + xrick' : 'Classic xrick');
  if ($('doc-collision')) $('doc-collision').textContent = collision;
  if ($('doc-gameplay-feel')) $('doc-gameplay-feel').textContent = `Walk ${gameplayTuning.walkSpeed}px/f · coyote ${gameplayTuning.coyoteFrames}f · buffer ${gameplayTuning.jumpBufferFrames}f · ladder +${gameplayTuning.ladderTopEntryTolerance}px · jump ${gameplayTuning.jumpTakeoff.toFixed(2)} · gravity ${gameplayTuning.gravity.toFixed(3)} · platform ${gameplayTuning.platformCurveMode}`;
  if ($('collision-solver-status')) $('collision-solver-status').textContent = collision;
}
function acceptEditableAsBaseline() {
  profileA = normalizeProfile(profile);
  baselineMode = 'accepted';
  runtimeA.setProfile(profileA);
  runtimeA.resetTransient();
  syncProfiles();
  saveLocal(true);
  $('save-status').textContent = 'Accepted: A is now a frozen copy of B. Continue editing B for the next comparison.';
}
function resetBaselineToRaw() {
  baselineMode = 'raw';
  runtimeA.resetTransient();
  syncProfiles();
  saveLocal(true);
  $('save-status').textContent = 'A baseline reset to raw xrick with JUICE OFF.';
}
function syncCompareModeButtons(mode) {
  document.querySelectorAll('[data-compare-view]').forEach(button => {
    const active = button.dataset.compareView === mode;
    button.setAttribute('aria-pressed', String(active));
  });
}
function setCompareMode(mode) {
  const select = $('compare-mode');
  if (!select || !['side','a','b','off'].includes(mode)) return;
  const leftLive=actionPreviewSource==='live';
  actionsWorkflow='playtest';
  if(leftLive)setActionPreviewSource('synthetic',{rebuild:false,resetGameplay:true});
  syncActionsWorkflowUi();
  select.value = mode;
  applyCompareLayout();
  if(leftLive)buildInspector();
  saveLocal(true);
}
function applyCompareLayout() {
  const mode = $('compare-mode').value;
  $('arena-frame').dataset.mode = mode;
  $('pane-a').hidden = mode === 'b' || mode === 'off'; $('pane-b').hidden = mode === 'a';
  $('pane-b-status').textContent = mode === 'off' ? 'ALL JUICE OFF' : 'LIVE EDITS';
  if (mode === 'off') $('pane-b').hidden = false;
  syncCompareModeButtons(mode);
  syncProfiles(); metrics.reset(); updateLiveDocs();
}
const gameplayTransitionStates = new WeakMap();
const RICK_STATE_DEAD_EDITOR = 0x20;
function gameplayTransitionState(runtime) {
  if (!gameplayTransitionStates.has(runtime)) gameplayTransitionStates.set(runtime, { active:null, lastSubmap:null, lastDead:false });
  return gameplayTransitionStates.get(runtime);
}
function gameplayTransitionOrigin(config, snapshot) {
  if (config?.origin === 'custom') return { x:Number(config.originX ?? 160), y:Number(config.originY ?? 100) };
  if (config?.origin === 'center') return { x:LIVE_WIDTH/2, y:LIVE_HEIGHT/2 };
  const bounds = preview && snapshot ? preview.entityBounds(snapshot,1) : null;
  return bounds ? { x:(bounds.left+bounds.right)/2, y:(bounds.top+bounds.bottom)/2 } : { x:LIVE_WIDTH/2, y:LIVE_HEIGHT/2 };
}
function updateGameplayTransition(runtime, snapshot, enabled, nowMs = performance.now()) {
  const state = gameplayTransitionState(runtime);
  if (!enabled || !snapshot) { state.active=null; state.lastSubmap=snapshot?.submap ?? state.lastSubmap; state.lastDead=false; return state; }
  const transitions = runtime.profile?.transitions || {};
  const dead = !!(Number(snapshot.rick?.state || 0) & RICK_STATE_DEAD_EDITOR);
  const walk = snapshot.rick?.exitWalk;
  const changedRoom = state.lastSubmap != null && Number(snapshot.submap) !== Number(state.lastSubmap);

  if (changedRoom) {
    const config = { ...(transitions.mapEntry || {}) };
    state.active = { mode:'entry', config, started:nowMs, direction:config.direction === 'left' || config.direction === 'right' ? config.direction : 'right', origin:gameplayTransitionOrigin(config,snapshot) };
  } else if (dead && !state.lastDead) {
    const config = { ...(transitions.playerDeath || {}) };
    state.active = { mode:'death-out', config, started:nowMs,
      direction:config.direction === 'left' || config.direction === 'right' ? config.direction : (snapshot.rick?.direction ? 'right':'left'),
      origin:gameplayTransitionOrigin(config,snapshot) };
  } else if (!dead && state.lastDead && state.active?.mode === 'death-out') {
    const config = { ...(transitions.playerDeath || {}) };
    state.active = { mode:'death-entry', config, started:nowMs, direction:state.active.direction, origin:gameplayTransitionOrigin(config,snapshot) };
  } else if (!dead && walk?.active) {
    const config = { ...(transitions.mapExit || {}) };
    if (state.active?.mode !== 'exit') state.active = { mode:'exit', config, started:nowMs,
      direction:Number(walk.direction || 1) < 0 ? 'left':'right', origin:gameplayTransitionOrigin(config,snapshot) };
  } else if (state.active?.mode === 'exit' && !walk?.active && !changedRoom) {
    state.active = null;
  }
  state.lastSubmap = Number(snapshot.submap);
  state.lastDead = dead;
  return state;
}
function renderGameplayTransition(ctx, runtime, snapshot, enabled, nowMs = effectClockMs) {
  const now = nowMs, state = updateGameplayTransition(runtime,snapshot,enabled,now), active = state.active;
  if (!enabled || !active) return;
  const config = active.config || {}, durationFrames = Math.max(4,Number(config.durationFrames || 10));
  let phase=0, flow='out';
  if (active.mode === 'exit') {
    const walk=snapshot?.rick?.exitWalk, total=Math.max(1,Number(walk?.totalFrames||1)), frameNo=Math.max(0,Number(walk?.frame||0));
    const duration=Math.min(total,durationFrames), start=Math.max(0,total-duration);
    phase=Math.max(0,Math.min(1,(frameNo-start)/Math.max(1,duration)));
  } else {
    phase=Math.max(0,Math.min(1,(now-active.started)/(durationFrames*40)));
    flow=(active.mode === 'entry' || active.mode === 'death-entry') ? 'in':'out';
  }
  drawMapTransitionMask(ctx,config.preset || 'tile-iris',phase,active.direction,active.origin,flow,LIVE_WIDTH,LIVE_HEIGHT);
  if (phase >= 1 && ['entry','death-entry','death-out'].includes(active.mode)) {
    if (active.mode !== 'death-out' || !state.lastDead) state.active=null;
  }
}

function renderMotionTrails(ctx, runtime) {
  const trail = runtime.profile?.motionTrail;
  if (!trail?.enabled || !preview) return;
  const copies = Math.max(0, Math.min(8, Number(trail.copies) || 0));
  const maxLayers = Math.max(0, Number(runtime.preset.maxTrails) || 0);
  if (copies <= 0 || maxLayers <= 0) return;
  const layers = preview.motionTrailLayers(copies, maxLayers);
  for (const item of layers) {
    const ageFade = 1 - (item.age - 1) / Math.max(1, copies + 1);
    ctx.save();
    const opacity = Number(trail.alpha ?? 1);
    ctx.globalAlpha = opacity >= .999 ? 1 : Math.max(0.03, opacity * ageFade);
    ctx.drawImage(item.layer.tintCanvas(trail.color), Math.round(item.dx || 0), Math.round(item.dy || 0));
    ctx.restore();
  }
}

function renderPane(ctx, runtime, sourceCanvas, snapshot, enabled = true, { transitions = true } = {}) {
  const camera = enabled ? runtime.cameraOffset() : { x: 0, y: 0 };
  ctx.save(); ctx.clearRect(0, 0, LIVE_WIDTH, LIVE_HEIGHT); ctx.translate(Math.round(camera.x), Math.round(camera.y)); ctx.drawImage(sourceCanvas, 0, 0);
  if (enabled) {
    const actorResolver=slot=>preview?.actorLayer(slot,snapshot||latestSnapshot);
    const actorSlots=(snapshot?.entities||[]).map(entity=>Number(entity.slot)).filter(Number.isFinite);
    runtime.prepareWorldEffects(latestPresentationLayers,latestForegroundMask);
    renderMotionTrails(ctx, runtime);
    runtime.renderActorEffects(ctx, actorResolver, { fireHeld:!!(Number((snapshot||latestSnapshot)?.rick?.control||0)&CONTROL.FIRE), actionHeld:!!(Number((snapshot||latestSnapshot)?.rick?.state||0)&0x01), presentation:preview?.presentation || 'classic' });
    runtime.renderActorDepthEffects(ctx,{ foregroundMask:latestForegroundMask, actorResolver, actorSlots });
    restoreAboveActorDepth(ctx,sourceCanvas,latestPresentationLayers,LIVE_WIDTH,LIVE_HEIGHT);
    runtime.renderWorldEffects(ctx, latestPresentationLayers, latestForegroundMask,{prepare:false});
    runtime.renderPresentationEffects(ctx,{ foregroundMask:latestForegroundMask, actorResolver, actorSlots });
  }
  ctx.restore();
  /* HUD feedback stays screen-anchored even when the playfield receives a
   * camera impulse. Restore its base pixels before applying HUD-only Juice. */
  ctx.drawImage(sourceCanvas,0,0,LIVE_WIDTH,8,0,0,LIVE_WIDTH,8);
  if (enabled) runtime.renderHudEffects(ctx, sourceCanvas);
  /* Transitions are the first whole-screen Game Juice element. They are drawn
   * after HUD/world feedback in the same A/B gameplay windows, so edits to
   * duration/origin/preset are visible during actual traversal rather than
   * only in the isolated transition card. */
  /* Retained signature contract: renderGameplayTransition(ctx, runtime, snapshot, enabled) uses the simulation clock by default. */
  if(transitions)renderGameplayTransition(ctx, runtime, snapshot, enabled, effectClockMs);
}
function avgP95Text(name) { return `${metrics.mean(name).toFixed(2)} / ${metrics.percentile(name, .95).toFixed(2)} ms`; }
function updateMetrics() {
  const preset = runtimeB.preset; $('metric-frame').textContent = avgP95Text('frame'); $('metric-frame-budget').textContent = `avg / p95 · ${preset.frameBudgetMs.toFixed(1)} ms`;
  $('metric-juice').textContent = avgP95Text('juice'); const juiceAvg = metrics.mean('juice'), utilization = preset.juiceBudgetMs ? juiceAvg / preset.juiceBudgetMs * 100 : 0;
  $('metric-juice-budget').textContent = `${utilization.toFixed(0)}% of ${preset.juiceBudgetMs.toFixed(1)} ms B budget`;
  $('metric-quality').textContent = `${Math.round(runtimeB.quality * 100)}%`; $('metric-particles').textContent = `${runtimeB.particles.active}`; $('metric-particle-cap').textContent = `${runtimeB.preset.maxParticles} pooled max`;
  $('metric-dropped').textContent = `${runtimeB.stats.droppedParticles + runtimeB.stats.droppedAudio}`; updateCostOnly();
  $('metric-juice').style.color = utilization > 115 ? '#d66d62' : utilization > 85 ? '#d5a85c' : '#8ec77a';
}
function benchmarkSample(frameMs, juiceMs) {
  if (!benchmark) return; benchmark[benchmark.phase].push(benchmark.phase === 'off' ? frameMs : juiceMs); benchmark.remaining -= 1; if (benchmark.remaining > 0) return;
  if (benchmark.phase === 'off') { benchmark.phase = 'on'; benchmark.remaining = 120; runtimeB.setEnabled(true); $('benchmark-toggle').textContent = 'Benchmark: B juice'; }
  else { const mean = arr => arr.reduce((a,b) => a+b,0)/Math.max(1,arr.length); $('benchmark-toggle').textContent = `B juice: ${mean(benchmark.on).toFixed(2)} ms avg`; $('benchmark-toggle').classList.remove('benchmark-active'); benchmark = null; syncProfiles(); }
}
function startBenchmark() { benchmark = { phase: 'off', remaining: 120, off: [], on: [] }; runtimeB.resetTransient(); runtimeB.setEnabled(false); $('benchmark-toggle').textContent = 'Benchmark: raw base'; $('benchmark-toggle').classList.add('benchmark-active'); }

function loop(now) {
  const frameStart = performance.now(); const dt = Math.min(.05, Math.max(0, (now - lastTime) / 1000)); lastTime = now;
  if (preview) {
    try {
      const nativePreviewActive=nativeActionPreviewOwned();
      if(nativePreviewActive&&!nativeActionPreviewWebMcpPaused){
        nativeActionPreviewStepElapsedMs+=dt*1000;
        let guard=0;while(nativeActionPreviewStepElapsedMs>=NATIVE_ACTION_PREVIEW_FRAME_MS&&guard++<2){nativeActionPreviewStepElapsedMs-=NATIVE_ACTION_PREVIEW_FRAME_MS;const step=nativeActionPreviewRunner.step();if(step.wrapped){nativeActionPreviewLastEvent=null;nativeActionPreviewRuntime?.resetTransient();}}
      }
      pendingCaptureEvents = [];
      captureInProgress = true;
      let captured;
      try { captured = preview.capture(); } finally { captureInProgress = false; }
      latestSnapshot = captured.snapshot;
      if(nativePreviewActive)nativeActionPreviewCaptured=nativeActionPreviewRunner?.ready?captured:null;
      $('engine-live-status').textContent = `${captured.presentation.toUpperCase()} · ${preview.collisionMode()} collision · SM${captured.snapshot.submap.toString(16).toUpperCase().padStart(2,'0')} · xrick frame ${captured.snapshot.frameSerial}`;
      const previousCapturedSerial = lastCapturedSerial;
      const newGameFrame = captured.snapshot.frameSerial !== previousCapturedSerial;
      const gameFrameDelta = previousCapturedSerial < 0 ? 0 : Math.max(0, Number(captured.snapshot.frameSerial) - Number(previousCapturedSerial));
      if (newGameFrame) {
        lastCapturedSerial = captured.snapshot.frameSerial;
        /* Capture the impact frame itself, then hold that exact image for the
         * requested following xrick frames. This reads as stop-the-world in B
         * without making the A baseline lose synchronization. */
        if (!runtimeA.shouldHoldFrame(captured.snapshot.frameSerial)) { holdACtx.clearRect(0,0,LIVE_WIDTH,LIVE_HEIGHT); holdACtx.drawImage(captured.canvas,0,0); holdASnapshot = captured.snapshot; }
        if (!runtimeB.shouldHoldFrame(captured.snapshot.frameSerial)) { holdBCtx.clearRect(0,0,LIVE_WIDTH,LIVE_HEIGHT); holdBCtx.drawImage(captured.canvas,0,0); holdBSnapshot = captured.snapshot; }
        if (selectedScreen === 'transitions' && !transitionAnimationFrame) renderTransitionPreview(Number($('transition-phase')?.value || 0) / 100);
        if (selectedScreen === 'resources') renderResourcePreview();
      }
      /* Juice lifetime is owned by xrick's 25 Hz simulation clock in every
       * editor mode. Browser RAF only redraws. Events emitted by capture() are
       * queued until after this update, so older effects age on the tick while
       * newly emitted effects begin that tick at full strength. */
      const effectDt = newGameFrame ? gameFrameDelta * JUICE_SIM_FRAME_SECONDS : 0;
      if (effectDt > 0) { runtimeA.update(effectDt); runtimeB.update(effectDt); hudPreviewRuntime.update(effectDt); if(nativePreviewActive&&nativeActionPreviewRuntime)nativeActionPreviewRuntime.update(effectDt); effectClockMs += effectDt * 1000; }
      for (const event of pendingCaptureEvents) dispatchJuiceEvent(event);
      pendingCaptureEvents = [];
      latestPresentationLayers = preview?.presentation === 'rdx' ? preview.presentationLayerMask() : null;
      latestForegroundMask = nativePreviewActive ? preview.foregroundMask() : (runtimeA.flashes?.some(f=>['foreground','background'].includes(f.targetMode)) || runtimeB.flashes?.some(f=>['foreground','background'].includes(f.targetMode))) ? preview.foregroundMask() : null;
      const mode = $('compare-mode').value;
      if (!nativePreviewActive&&(mode === 'side' || mode === 'a')) renderPane(ctxA, runtimeA, holdA, holdASnapshot, baselineMode === 'accepted');
      const juiceStart = performance.now();
      if (!nativePreviewActive&&mode === 'off') renderPane(ctxB, runtimeB, captured.canvas, captured.snapshot, false);
      else if (!nativePreviewActive&&(mode === 'side' || mode === 'b')) renderPane(ctxB, runtimeB, holdB, holdBSnapshot, true);
      const juiceMs = performance.now() - juiceStart; runtimeB.setMeasuredJuiceMs(juiceMs); runtimeA.setMeasuredJuiceMs(juiceMs);
      const frameMs = performance.now() - frameStart; metrics.push('frame', frameMs); metrics.push('juice', juiceMs); benchmarkSample(frameMs, juiceMs);
    } catch (error) { $('engine-live-status').textContent = error.message; console.error(error); }
  }
  if (now - lastMetricsUpdate > 250) { lastMetricsUpdate = now; updateMetrics(); }
  requestAnimationFrame(loop);
}

const WEBMCP_LIVE_CURRENT_CHECKPOINT_SLOT = 4;
const WEBMCP_LIVE_BASELINE_CHECKPOINT_SLOT = 5;
const WEBMCP_DEFAULT_EVENT_OFFSETS = Object.freeze([-1,0,1,2,4]);

function assertGameJuiceActionId(actionId=selectedAction) {
  const id=String(actionId || '');
  if(!ACTIONS.some(action=>action.id===id))throw new Error(`Unknown Game Juice action '${id}'`);
  return id;
}
function cloneValue(value){return value===undefined?undefined:JSON.parse(JSON.stringify(value));}
function actionUndoStack(actionId){if(!actionUndoByAction.has(actionId))actionUndoByAction.set(actionId,[]);return actionUndoByAction.get(actionId);}
function actionVariantMap(actionId){return actionVariantsByAction[actionId] || {};}
function ensureOriginalActionVariant(actionId,recipe){
  if(actionVariantMap(actionId).original)return;
  actionVariantsByAction={...actionVariantsByAction,[actionId]:{...actionVariantMap(actionId),original:{recipe:cloneValue(recipe),recipeRevision:actionRecipeRevision(recipe)}}};
}
function pushActionUndo(actionId,recipe,reason='edit'){
  const stack=actionUndoStack(actionId);stack.push({recipe:cloneValue(recipe),reason,recipeRevision:actionRecipeRevision(recipe)});if(stack.length>20)stack.splice(0,stack.length-20);
}
function updateActionEditorAfterWebMcp(actionId){
  selectedAction=actionId;syncProfiles();buildActionList();buildInspector();revealWorkspaceWindow('action-inspector');saveLocal(true);
}
function applyActionRecipeFromWebMcp(actionId,recipe,{reason='variant'}={}){
  actionId=assertGameJuiceActionId(actionId);const before=cloneValue(profile.actions[actionId]);ensureOriginalActionVariant(actionId,before);pushActionUndo(actionId,before,reason);
  const draft=cloneProfile(profile);draft.actions[actionId]=cloneValue(recipe);profile=normalizeProfile(draft);updateActionEditorAfterWebMcp(actionId);
  return {actionId,...actionRecipeSummary(profile.actions[actionId]),changes:diffActionRecipes(before,profile.actions[actionId]),undoDepth:actionUndoStack(actionId).length};
}
function compactNativeSnapshot(snapshot){
  const native=snapshot?.collision?.native||{};
  return {
    frameSerial:Number(snapshot?.frameSerial ?? -1),map:Number(snapshot?.map ?? native.mapId ?? 0),submap:Number(snapshot?.submap ?? 0),
    rick:cloneValue(snapshot?.rick||{}),inventory:cloneValue(snapshot?.inventory||{}),score:Number(snapshot?.score||0),
    native:{worldReady:!!native.worldReady,playerActive:!!native.playerActive,playerWorldX:Number(native.playerWorldX||0),playerWorldY:Number(native.playerWorldY||0),playerScreenX:Number(native.playerScreenX||0),playerScreenY:Number(native.playerScreenY||0),playerVelocityX:Number(native.playerVelocityX||0),playerVelocityY:Number(native.playerVelocityY||0),playerGrounded:!!native.playerGrounded,playerClimbing:!!native.playerClimbing,playerCrawling:!!native.playerCrawling}
  };
}
function compactNativeScenarioState(){
  const state=nativeActionPreviewRunner?.state?.();if(!state)return null;
  return {active:!!state.active,ready:!!state.ready,phase:state.phase,error:state.error,warning:state.warning,warningCode:state.warningCode,actionId:state.actionId,direction:state.direction,submap:state.submap,frame:state.frame,readyFrameSerial:state.readyFrameSerial,lastEvent:state.lastEvent?{type:state.lastEvent.type,frameSerial:state.lastEvent.frameSerial,scenarioFrame:state.lastEvent.scenarioFrame}:null,postEventFramesRemaining:state.postEventFramesRemaining,restartPending:!!state.restartPending,frameMs:state.frameMs};
}
function gameJuiceWebMcpState({actionId=selectedAction,fields=[],native='none'}={}) {
  if (!preview) throw new Error('Game Juice live preview is not ready');
  actionId=assertGameJuiceActionId(actionId);const recipe=profile.actions[actionId],choice=actionPreviewMapChoice(actionId),variants=actionVariantMap(actionId);
  const result={
    selectedScreen,selectedAction,actionsWorkflow,audioMuted: editorMuted,presentation:$('presentation-source')?.value||'classic',previewView: $('compare-mode')?.value || 'side',preset:productionPresetDescriptor({provenance:activePresetProvenance,profile}),
    action:{actionId,label:ACTIONS.find(action=>action.id===actionId)?.label||actionId,recipe:Array.isArray(fields)&&fields.length?filterActionRecipe(recipe,fields):{enabled:!!recipe.enabled,solo:!!recipe.solo},...actionRecipeSummary(recipe),variants:Object.entries(variants).map(([name,value])=>({name,recipeRevision:value.recipeRevision||actionRecipeRevision(value.recipe)})),undoDepth:actionUndoStack(actionId).length},
    actionPreview:{source:actionPreviewSource,direction:actionPreviewDirection<0?'left':'right',submap:Number(choice.effectiveSubmap),fixtureSubmap:Number(choice.fixtureSubmap),manualOverride:choice.manual?Number(choice.effectiveSubmap):null,mapSource:choice.manual?'manual':'reviewed-default',zoom:Number(actionPreviewLiveZoom),nativeOwner:nativeActionPreviewOwned(),paused:!!nativeActionPreviewWebMcpPaused,nativeScenario:compactNativeScenarioState()},
    submap:Number(gameplayPreviewSubmap ?? $('level-select')?.value ?? preview.bridge.submap())
  };
  if(native==='summary')result.native=compactNativeSnapshot(preview.bridge.snapshot());
  else if(native==='full')result.snapshot=preview.bridge.snapshot();
  return result;
}

function patchActionFromWebMcp(actionId,patch){
  actionId=assertGameJuiceActionId(actionId);const before=cloneValue(profile.actions[actionId]);const result=normalizeActionWebMcpPatch(profile,actionId,patch);
  if(result.changes.length){ensureOriginalActionVariant(actionId,before);pushActionUndo(actionId,before,'patch');profile=result.profile;updateActionEditorAfterWebMcp(actionId);}
  else selectedAction=actionId;
  return {actionId,recipeRevision:result.recipeRevision,changed:result.changed,changes:result.changes,clamped:result.clamped,rejected:result.rejected,compatibility:result.compatibility,cost:result.cost,undoDepth:actionUndoStack(actionId).length};
}

function selectLiveActionForWebMcp(actionId,{submap=null}={}){
  actionId=assertGameJuiceActionId(actionId);selectedAction=actionId;setJuiceScreen('actions');
  if(Number.isInteger(Number(submap)))actionPreviewSetManualLiveSubmap(actionId,Number(submap));
  if(actionPreviewSource!=='live')setActionPreviewSource('live',{rebuild:false,resetGameplay:true,liveSubmap:Number.isInteger(Number(submap))?Number(submap):null});
  if(!startNativeActionPreviewScenario({restart:nativeActionPreviewRunner?.actionId!==actionId||Number(nativeActionPreviewRunner?.submap)!==Number(actionPreviewEffectiveLiveSubmap(actionId))||Number(nativeActionPreviewRunner?.direction)!==Number(actionPreviewDirection)}))throw new Error(`Native Live map scenario for ${actionId} is not ready`);
  nativeActionPreviewWebMcpPaused=true;nativeActionPreviewStepElapsedMs=0;buildActionList();buildInspector();saveLocal(true);return nativeActionPreviewRunner.state();
}

function captureNativePreviewRaw(){
  const oldPending=pendingCaptureEvents,oldCapture=captureInProgress,oldSuppress=suppressCaptureEventLog;pendingCaptureEvents=[];captureInProgress=true;suppressCaptureEventLog=true;
  let captured;
  try{captured=preview.capture();}
  finally{captureInProgress=oldCapture;suppressCaptureEventLog=oldSuppress;}
  const events=pendingCaptureEvents.slice();pendingCaptureEvents=oldPending;latestSnapshot=captured.snapshot;latestPresentationLayers=preview?.presentation==='rdx'?preview.presentationLayerMask():null;latestForegroundMask=preview.foregroundMask();return {captured,events};
}

function processWebMcpSingleNativeStep(actionId){
  selectLiveActionForWebMcp(actionId);const step=nativeActionPreviewRunner.step();if(step.wrapped){nativeActionPreviewLastEvent=null;nativeActionPreviewRuntime?.resetTransient();}
  const oldPending=pendingCaptureEvents;pendingCaptureEvents=[];captureInProgress=true;let captured;
  try{captured=preview.capture();}finally{captureInProgress=false;}
  latestSnapshot=captured.snapshot;nativeActionPreviewCaptured=nativeActionPreviewRunner?.ready?captured:null;
  const previousCapturedSerial=lastCapturedSerial,newGameFrame=captured.snapshot.frameSerial!==previousCapturedSerial,gameFrameDelta=previousCapturedSerial<0?0:Math.max(0,Number(captured.snapshot.frameSerial)-Number(previousCapturedSerial));
  if(newGameFrame)lastCapturedSerial=captured.snapshot.frameSerial;const effectDt=newGameFrame?gameFrameDelta*JUICE_SIM_FRAME_SECONDS:0;
  if(effectDt>0){runtimeA.update(effectDt);runtimeB.update(effectDt);hudPreviewRuntime.update(effectDt);if(nativeActionPreviewRuntime)nativeActionPreviewRuntime.update(effectDt);effectClockMs+=effectDt*1000;}
  const events=pendingCaptureEvents.slice();for(const event of events)dispatchJuiceEvent(event);pendingCaptureEvents=oldPending;
  latestPresentationLayers=preview?.presentation==='rdx'?preview.presentationLayerMask():null;latestForegroundMask=preview.foregroundMask();
  return {actionId,paused:true,step,frameSerial:Number(captured.snapshot.frameSerial),scenarioFrame:Number(nativeActionPreviewRunner.frame),event:events.find(event=>event.type===actionId)?cloneValue(events.find(event=>event.type===actionId)):null,recipeRevision:actionRecipeRevision(profile.actions[actionId]),zoom:Number(actionPreviewLiveZoom)};
}

function isolatedRuntimeForRecipe(actionId,recipe){
  const candidate=cloneProfile(profile);candidate.actions[actionId]=cloneValue(recipe);const runtime=new JuiceRuntime(actionPreviewRuntimeProfile(candidate,actionId));runtime.setSpatialScale(1);runtime.setEnabled(true);runtime.setAudioEnabled(false);return runtime;
}
function percentile(values,p=.95){if(!values.length)return 0;const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.max(0,Math.ceil(sorted.length*p)-1))];}
function cloneCanvas(source){const canvas=document.createElement('canvas');canvas.width=source.width;canvas.height=source.height;const ctx=canvas.getContext('2d',{alpha:false});ctx.imageSmoothingEnabled=false;ctx.drawImage(source,0,0);return canvas;}
function renderWebMcpNativeSample(runtime,captured,actionId,zoom){
  const canvas=document.createElement('canvas');canvas.width=LIVE_WIDTH;canvas.height=LIVE_HEIGHT;const full=document.createElement('canvas');full.width=LIVE_WIDTH;full.height=LIVE_HEIGHT;const start=performance.now();renderNativeActionPreviewCanvas(canvas,runtime,captured,actionId,full,{zoom});return {canvas:cloneCanvas(canvas),renderMs:performance.now()-start,frameSerial:Number(captured.snapshot.frameSerial),scenarioFrame:Number(nativeActionPreviewRunner.frame)};
}
function buildWebMcpFilmstrip({title,revision,zoom,frames}){
  const thumbW=160,thumbH=100,headerH=24,footerH=22,width=Math.max(thumbW,thumbW*frames.length),height=headerH+thumbH+footerH,canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d',{alpha:false});ctx.imageSmoothingEnabled=false;ctx.fillStyle='#111';ctx.fillRect(0,0,width,height);ctx.fillStyle='#fff';ctx.font='12px sans-serif';ctx.fillText(`${title} · ${zoom}× · ${revision}`,6,16);
  frames.forEach((frame,index)=>{const x=index*thumbW;ctx.drawImage(frame.canvas,0,0,LIVE_WIDTH,LIVE_HEIGHT,x,headerH,thumbW,thumbH);ctx.fillStyle='#111';ctx.fillRect(x,headerH+thumbH,thumbW,footerH);ctx.fillStyle='#fff';ctx.fillText(`${frame.label?`${frame.label} · `:''}${frame.offset>=0?'+':''}${frame.offset} · F${frame.frameSerial}`,x+5,headerH+thumbH+15);});
  return {mimeType:'image/png',width,height,dataUrl:canvas.toDataURL('image/png')};
}
function buildWebMcpComparisonGrid({title,zoom,offsets,rows}){
  const labelW=120,thumbW=160,thumbH=100,headerH=28,footerH=22,rowH=thumbH+footerH,width=labelW+thumbW*offsets.length,height=headerH+rowH*rows.length,canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d',{alpha:false});ctx.imageSmoothingEnabled=false;ctx.fillStyle='#111';ctx.fillRect(0,0,width,height);ctx.fillStyle='#fff';ctx.font='12px sans-serif';ctx.fillText(`${title} · ${zoom}×`,6,18);
  offsets.forEach((offset,index)=>{ctx.fillText(`${offset>=0?'+':''}${offset}`,labelW+index*thumbW+6,18);});
  rows.forEach((row,rowIndex)=>{const y=headerH+rowIndex*rowH;ctx.fillStyle='#161d24';ctx.fillRect(0,y,labelW,rowH);ctx.fillStyle='#fff';ctx.fillText(row.label,6,y+18);ctx.fillStyle='#aebdca';ctx.font='10px sans-serif';ctx.fillText(row.revision,6,y+34);ctx.font='12px sans-serif';row.frames.forEach((frame,column)=>{const x=labelW+column*thumbW;ctx.drawImage(frame.canvas,0,0,LIVE_WIDTH,LIVE_HEIGHT,x,y,thumbW,thumbH);ctx.fillStyle='#111';ctx.fillRect(x,y+thumbH,thumbW,footerH);ctx.fillStyle='#fff';ctx.fillText(`${frame.offset>=0?'+':''}${frame.offset} · F${frame.frameSerial}`,x+5,y+thumbH+15);});});
  return {mimeType:'image/png',width,height,dataUrl:canvas.toDataURL('image/png')};
}
function ensureGameJuiceWebMcpFilmstripPreview(){
  let panel=document.getElementById('rdr-game-juice-webmcp-filmstrip');if(panel)return panel;panel=document.createElement('aside');panel.id='rdr-game-juice-webmcp-filmstrip';panel.setAttribute('aria-label','Game Juice WebMCP filmstrip');panel.style.cssText='position:fixed;right:10px;bottom:10px;z-index:9999;max-width:min(900px,calc(100vw - 20px));padding:7px;background:#111a;border:1px solid #64727e;border-radius:7px;box-shadow:0 10px 34px #0009;color:#fff;font:10px monospace;display:none';
  const head=document.createElement('div');head.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:5px';const title=document.createElement('strong');title.dataset.role='title';title.textContent='Game Juice WebMCP filmstrip';const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','Close Game Juice WebMCP filmstrip');close.style.cssText='width:22px;height:20px;padding:0;border:1px solid #596875;background:#18212a;color:#fff;border-radius:4px;cursor:pointer';close.addEventListener('click',()=>{panel.style.display='none';});head.append(title,close);
  const body=document.createElement('div');body.dataset.role='body';body.style.cssText='overflow:auto;max-width:100%';const legend=document.createElement('div');legend.dataset.role='legend';legend.style.cssText='margin-top:5px;color:#aebdca;line-height:1.35;white-space:pre-wrap';panel.append(head,body,legend);document.body.append(panel);return panel;
}
function showGameJuiceWebMcpFilmstrip({title,filmstrip,legend=''}){
  const panel=ensureGameJuiceWebMcpFilmstripPreview();panel.querySelector('[data-role="title"]').textContent=title;const body=panel.querySelector('[data-role="body"]');body.replaceChildren();const img=document.createElement('img');img.alt=title;img.src=filmstrip.dataUrl;img.width=filmstrip.width;img.height=filmstrip.height;img.style.cssText=`display:block;width:${filmstrip.width}px;height:${filmstrip.height}px;image-rendering:pixelated;background:#000`;body.append(img);panel.querySelector('[data-role="legend"]').textContent=legend;panel.style.display='block';return {elementId:panel.id,visible:true,mimeType:filmstrip.mimeType,width:filmstrip.width,height:filmstrip.height};
}
function normalizeWebMcpDirection(direction){if(direction===undefined||direction===null||direction==='')return actionPreviewDirection<0?-1:1;if(direction==='left'||Number(direction)<0)return -1;if(direction==='right'||Number(direction)>0)return 1;throw new Error("Direction must be 'left' or 'right'");}
function normalizeEventOffsets(offsets){
  const raw=Array.isArray(offsets)&&offsets.length?offsets:WEBMCP_DEFAULT_EVENT_OFFSETS;const normalized=[...new Set(raw.map(Number).filter(Number.isInteger).map(value=>Math.max(-8,Math.min(16,value))))].sort((a,b)=>a-b);if(!normalized.length)throw new Error('Event-relative capture needs at least one integer offset');if(normalized.length>9)throw new Error('Event-relative capture supports at most 9 frame offsets');return normalized;
}
function captureRecipeFromBaseline({actionId,recipe,baseline,offsets,zoom}){
  nativeActionPreviewRunner.restoreCheckpoint(baseline);nativeActionPreviewLastEvent=null;const runtime=isolatedRuntimeForRecipe(actionId,recipe),renderTimes=[],maxNegative=Math.abs(Math.min(0,...offsets)),maxPositive=Math.max(0,...offsets),preRing=[],selected=new Map();let eventFrame=null,event=null,lastSerial=Number(preview.bridge.snapshot()?.frameSerial ?? -1);
  const addPre=sample=>{preRing.push(sample);while(preRing.length>maxNegative+1)preRing.shift();};
  let raw=captureNativePreviewRaw(),sample=renderWebMcpNativeSample(runtime,raw.captured,actionId,zoom);renderTimes.push(sample.renderMs);if(maxNegative)addPre(sample);
  const scenario=nativeActionPreviewRunner.scenario,limit=Math.max(Number(scenario.loopFrames||120),Number(scenario.proof?.maxFrames||120))+maxPositive+4;
  for(let guard=0;guard<limit;guard+=1){
    const step=nativeActionPreviewRunner.step();if(step.wrapped&&eventFrame===null)break;raw=captureNativePreviewRaw();const serial=Number(raw.captured.snapshot.frameSerial);const delta=lastSerial<0?0:Math.max(0,serial-lastSerial);lastSerial=serial;if(delta>0)runtime.update(delta*JUICE_SIM_FRAME_SECONDS);
    for(const candidate of raw.events){nativeActionPreviewRunner.noteEvent(candidate);if(candidate.type===actionId&&!event){event=cloneValue(candidate);eventFrame=Number(nativeActionPreviewRunner.frame);runtime.trigger(candidate);nativeActionPreviewLastEvent={...candidate};}}
    sample=renderWebMcpNativeSample(runtime,raw.captured,actionId,zoom);renderTimes.push(sample.renderMs);
    if(eventFrame===null){if(maxNegative)addPre(sample);continue;}
    const offset=Number(nativeActionPreviewRunner.frame)-eventFrame;if(offset===0){for(const wanted of offsets.filter(value=>value<0)){const prior=preRing.find(item=>item.scenarioFrame===eventFrame+wanted);if(prior)selected.set(wanted,prior);}if(offsets.includes(0))selected.set(0,sample);}
    else if(offsets.includes(offset))selected.set(offset,sample);
    if(offset>=maxPositive)break;
  }
  if(eventFrame===null)throw new Error(`Native scenario did not emit ${actionId} before replay`);
  const missing=offsets.filter(offset=>!selected.has(offset));if(missing.length)throw new Error(`Native scenario could not capture ${actionId} offsets ${missing.join(', ')}`);
  const frames=offsets.map(offset=>({offset,...selected.get(offset)}));
  return {actionId,eventType:actionId,eventFrame,checkpointFrameSerial:Number(baseline.frameSerial),recipeRevision:actionRecipeRevision(recipe),zoom,frames,compatibility:actionCompatibility(recipe),cost:estimateActionCost(recipe),measuredCost:{renderMsAvg:renderTimes.reduce((sum,value)=>sum+value,0)/Math.max(1,renderTimes.length),renderMsP95:percentile(renderTimes),renderSamples:renderTimes.length}};
}
function withNativeCaptureBaseline(actionId,callback,{submap=null,direction=null}={}){
  const oldPaused=nativeActionPreviewWebMcpPaused,oldLastEvent=nativeActionPreviewLastEvent;actionPreviewDirection=normalizeWebMcpDirection(direction);selectLiveActionForWebMcp(actionId,{submap});nativeActionPreviewWebMcpPaused=true;let current=null,baseline=null;
  try{current=nativeActionPreviewRunner.saveCheckpoint(WEBMCP_LIVE_CURRENT_CHECKPOINT_SLOT);nativeActionPreviewRunner.restart();captureNativePreviewRaw();baseline=nativeActionPreviewRunner.saveCheckpoint(WEBMCP_LIVE_BASELINE_CHECKPOINT_SLOT);return callback(baseline);}
  finally{try{if(current)nativeActionPreviewRunner.restoreCheckpoint(current);}finally{if(baseline)nativeActionPreviewRunner.discardCheckpoint(baseline);if(current)nativeActionPreviewRunner.discardCheckpoint(current);nativeActionPreviewLastEvent=oldLastEvent;nativeActionPreviewWebMcpPaused=oldPaused;nativeActionPreviewStepElapsedMs=0;nativeActionPreviewCaptured=null;}}
}
function captureActionEventFrames({actionId=selectedAction,offsets=WEBMCP_DEFAULT_EVENT_OFFSETS,direction=null,zoom=actionPreviewLiveZoom,submap=null}={}){
  actionId=assertGameJuiceActionId(actionId);offsets=normalizeEventOffsets(offsets);const facing=normalizeWebMcpDirection(direction);zoom=ACTION_PREVIEW_LIVE_ZOOM_VALUES.includes(Number(zoom))?Number(zoom):Number(actionPreviewLiveZoom);
  const result=withNativeCaptureBaseline(actionId,baseline=>captureRecipeFromBaseline({actionId,recipe:profile.actions[actionId],baseline,offsets,zoom}),{submap,direction:facing});
  const image=buildWebMcpFilmstrip({title:`${actionId} · ${facing<0?'left':'right'}`,revision:result.recipeRevision,zoom,frames:result.frames});
  const filmstrip=showGameJuiceWebMcpFilmstrip({title:`${actionId} event frames`,filmstrip:image,legend:`${facing<0?'left':'right'} · ${zoom}× · ${result.recipeRevision} · ${offsets.map(value=>`${value>=0?'+':''}${value}`).join(' / ')}`});
  return {...result,direction:facing<0?'left':'right',frames:result.frames.map(({canvas,...frame})=>frame),image,filmstrip};
}
function resolveActionVariant(actionId,name){
  if(name==='current')return {name:'current',recipe:cloneValue(profile.actions[actionId]),recipeRevision:actionRecipeRevision(profile.actions[actionId])};
  const value=actionVariantMap(actionId)[name];if(!value)throw new Error(`Unknown ${actionId} variant '${name}'`);return {name,recipe:cloneValue(value.recipe),recipeRevision:value.recipeRevision||actionRecipeRevision(value.recipe)};
}
function compareActionVariants({actionId=selectedAction,variants,offsets=WEBMCP_DEFAULT_EVENT_OFFSETS,direction=null,zoom=actionPreviewLiveZoom,submap=null}={}){
  actionId=assertGameJuiceActionId(actionId);if(!Array.isArray(variants)||variants.length<2||variants.length>4)throw new Error('Compare 2–4 named action variants');const names=[...new Set(variants.map(String))];if(names.length<2)throw new Error('Compare at least two distinct action variants');offsets=normalizeEventOffsets(offsets);if(names.length*offsets.length>20)throw new Error('Variant comparison supports at most 20 total image cells');const facing=normalizeWebMcpDirection(direction);zoom=ACTION_PREVIEW_LIVE_ZOOM_VALUES.includes(Number(zoom))?Number(zoom):Number(actionPreviewLiveZoom);const resolved=names.map(name=>resolveActionVariant(actionId,name));
  const captures=withNativeCaptureBaseline(actionId,baseline=>resolved.map(variant=>({variant,...captureRecipeFromBaseline({actionId,recipe:variant.recipe,baseline,offsets,zoom})})),{submap,direction:facing});const reference=resolved[0].recipe,eventFrames=[...new Set(captures.map(item=>item.eventFrame))];
  const rows=captures.map(item=>({label:item.variant.name,revision:item.recipeRevision,frames:item.frames}));const revision=resolved.map(item=>`${item.name}:${item.recipeRevision}`).join(' | ');const image=buildWebMcpComparisonGrid({title:`${actionId} variants · ${facing<0?'left':'right'}`,zoom,offsets,rows});const filmstrip=showGameJuiceWebMcpFilmstrip({title:`${actionId} variant comparison`,filmstrip:image,legend:`${facing<0?'left':'right'} · ${zoom}× · ${offsets.map(value=>`${value>=0?'+':''}${value}`).join(' / ')} · ${revision}`});
  return {actionId,offsets,direction:facing<0?'left':'right',zoom,checkpointFrameSerial:captures[0]?.checkpointFrameSerial??null,sameScenarioCheckpoint:eventFrames.length===1&&captures.every(item=>item.checkpointFrameSerial===captures[0]?.checkpointFrameSerial),eventFrame:eventFrames[0]??null,variants:captures.map(item=>({name:item.variant.name,recipeRevision:item.recipeRevision,diffFromReference:diffActionRecipes(reference,item.variant.recipe),compatibility:item.compatibility,cost:item.cost,measuredCost:item.measuredCost,frames:item.frames.map(({canvas,...frame})=>frame)})),image,filmstrip};
}
async function installGameJuiceWebMcp() {
  const actionIdSchema={type:'string',enum:ACTIONS.map(action=>action.id),description:'Stable Game Juice action id.'};
  const optionalActionId={...actionIdSchema};
  const effectIdSchema={type:'string',enum:GAME_JUICE_EFFECT_KEYS,description:'One action feedback/effect channel.'};
  return installWebMcpTools({
    namespace: 'rdr.game_juice',
    tools: [
      {
        name:'get_state', title:'Read compact Game Juice state', readOnly:true,
        description:'Read compact Game Juice authoring state. By default the action recipe is reduced to enabled/solo and native entity state is omitted. Pass dotted action field filters for exact parameters, or native=summary/full when native state is explicitly needed.',
        inputSchema:{type:'object',properties:{actionId:optionalActionId,fields:{type:'array',maxItems:32,uniqueItems:true,items:{type:'string',minLength:1,maxLength:80},description:'Dotted action-recipe paths such as particles.count, camera.amplitude or worldFlash.layerMask.'},native:{type:'string',enum:['none','summary','full'],description:'Native state detail. none is the default and omits native entity state; summary is compact; full returns the complete snapshot.'}},additionalProperties:false},
        execute:input=>gameJuiceWebMcpState(input)
      },
      {
        name:'select_action', title:'Select Game Juice action',
        description:'Select a Game Juice action by stable id and open its Actions & feedback inspector.',
        inputSchema:{type:'object',properties:{actionId:actionIdSchema},required:['actionId'],additionalProperties:false},
        execute:({actionId})=>{actionId=assertGameJuiceActionId(actionId);selectedAction=actionId;setJuiceScreen('actions');buildActionList();buildInspector();revealWorkspaceWindow('action-inspector');saveLocal(true);return gameJuiceWebMcpState({actionId});}
      },
      {
        name:'get_effect_schema', title:'Read Game Juice effect controls', readOnly:true,
        description:'Return only the requested effect-channel schemas and current values. Use this before patch_effect so tool discovery stays compact instead of publishing every unrelated Game Juice control.',
        inputSchema:{type:'object',properties:{actionId:optionalActionId,effects:{type:'array',minItems:1,maxItems:6,uniqueItems:true,items:effectIdSchema}},required:['effects'],additionalProperties:false},
        execute:({actionId=selectedAction,effects})=>{actionId=assertGameJuiceActionId(actionId);return {actionId,recipeRevision:actionRecipeRevision(profile.actions[actionId]),effects:[...effects],values:filterActionRecipe(profile.actions[actionId],effects),schema:actionEffectSchemas(effects)};}
      },
      {
        name:'patch_effect', title:'Edit one Game Juice effect',
        description:'Patch one effect channel through the existing strict action normalizer. Call get_effect_schema first for the channel-specific fields, ranges and CD32 constraints. Unknown fields are rejected and numeric clamps are reported.',
        inputSchema:{type:'object',properties:{actionId:actionIdSchema,effect:effectIdSchema,patch:{type:'object',minProperties:1,description:'Partial effect patch matching the schema returned by get_effect_schema.'}},required:['actionId','effect','patch'],additionalProperties:false},
        execute:({actionId,effect,patch})=>patchActionFromWebMcp(actionId,{[effect]:patch})
      },
      {
        name:'set_action_enabled', title:'Enable Game Juice action',
        description:'Enable or disable one action through the same strict patch/undo path.',
        inputSchema:{type:'object',properties:{actionId:actionIdSchema,enabled:{type:'boolean'}},required:['actionId','enabled'],additionalProperties:false},
        execute:({actionId,enabled})=>patchActionFromWebMcp(actionId,{enabled})
      },
      {
        name:'set_action_solo', title:'Solo Game Juice action',
        description:'Enable or disable the editor-only solo flag through the same strict patch/undo path.',
        inputSchema:{type:'object',properties:{actionId:actionIdSchema,solo:{type:'boolean'}},required:['actionId','solo'],additionalProperties:false},
        execute:({actionId,solo})=>patchActionFromWebMcp(actionId,{solo})
      },
      {
        name:'preview_action', title:'Preview Game Juice action',
        description:'Trigger the existing isolated preview/test event for a Game Juice action.',
        inputSchema:{type:'object',properties:{actionId:actionIdSchema},required:['actionId'],additionalProperties:false},
        execute:({actionId})=>{actionId=assertGameJuiceActionId(actionId);selectedAction=actionId;triggerActionTest(actionId);buildActionList();buildInspector();return {actionId,triggered:true,recipeRevision:actionRecipeRevision(profile.actions[actionId])};}
      },
      {
        name:'set_live_playback', title:'Pause or resume Live map action',
        description:'Pause or resume normal 25 Hz playback of the selected native Live map scenario. Resume keeps ordinary motion playback for judging movement; pause makes deterministic single-step/frame inspection stable.',
        inputSchema:{type:'object',properties:{actionId:optionalActionId,paused:{type:'boolean'},submap:{type:'integer',minimum:0,maximum:46}},required:['paused'],additionalProperties:false},
        execute:({actionId=selectedAction,paused,submap=null})=>{actionId=assertGameJuiceActionId(actionId);selectLiveActionForWebMcp(actionId,{submap});nativeActionPreviewWebMcpPaused=!!paused;nativeActionPreviewStepElapsedMs=0;return gameJuiceWebMcpState({actionId});}
      },
      {
        name:'step_live_scenario', title:'Single-step Live map action',
        description:'Pause and advance the existing native Live map scenario by exactly one xrick simulation frame. Returns native/scenario frame ids and the matching action recipe revision.',
        inputSchema:{type:'object',properties:{actionId:optionalActionId,submap:{type:'integer',minimum:0,maximum:46}},additionalProperties:false},
        execute:({actionId=selectedAction,submap=null})=>{selectLiveActionForWebMcp(actionId,{submap});return processWebMcpSingleNativeStep(actionId);}
      },
      {
        name:'capture_event_frames', title:'Capture event-relative Live frames',
        description:'Replay the existing deterministic native Live-map checkpoint and capture an event-relative filmstrip. Defaults to -1/0/+1/+2/+4 frames and returns native frame ids, selected zoom, recipe revision, action compatibility and measured render cost without screenshot timing or CDP.',
        inputSchema:{type:'object',properties:{actionId:optionalActionId,offsets:{type:'array',minItems:1,maxItems:9,uniqueItems:true,items:{type:'integer',minimum:-8,maximum:16},description:'Native-frame offsets relative to the selected semantic event; 0 is the event frame.'},direction:{type:'string',enum:['left','right']},zoom:{type:'integer',enum:[1,2,4]},submap:{type:'integer',minimum:0,maximum:46}},additionalProperties:false},
        execute:input=>captureActionEventFrames(input)
      },
      {
        name:'save_action_variant', title:'Save named action variant',
        description:'Save the current normalized action recipe under a compact name such as original, tighter or actors-included. Variants are action-scoped and persisted with the editor draft.',
        inputSchema:{type:'object',properties:{actionId:optionalActionId,name:{type:'string',minLength:1,maxLength:40,pattern:'^[A-Za-z0-9][A-Za-z0-9 _.-]{0,39}$'}},required:['name'],additionalProperties:false},
        execute:({actionId=selectedAction,name})=>{actionId=assertGameJuiceActionId(actionId);name=String(name);if(name==='current')throw new Error("'current' is reserved for the unsaved live recipe");const recipe=cloneValue(profile.actions[actionId]),existingOriginal=actionVariantMap(actionId).original?.recipe;actionVariantsByAction={...actionVariantsByAction,[actionId]:{...actionVariantMap(actionId),[name]:{recipe,recipeRevision:actionRecipeRevision(recipe)}}};saveLocal(true);return {actionId,name,...actionRecipeSummary(recipe),diffFromOriginal:existingOriginal?diffActionRecipes(existingOriginal,recipe):[]};}
      },
      {
        name:'apply_action_variant', title:'Apply named action variant',
        description:'Apply a saved action variant to the editable recipe and push the previous recipe onto the action undo stack. Returns the normalized parameter diff, compatibility and estimated cost.',
        inputSchema:{type:'object',properties:{actionId:optionalActionId,name:{type:'string',minLength:1,maxLength:40}},required:['name'],additionalProperties:false},
        execute:({actionId=selectedAction,name})=>{actionId=assertGameJuiceActionId(actionId);const variant=resolveActionVariant(actionId,String(name));if(variant.name==='current')throw new Error("'current' already names the live recipe");return {...applyActionRecipeFromWebMcp(actionId,variant.recipe,{reason:`variant:${variant.name}`}),variant:variant.name};}
      },
      {
        name:'undo_action', title:'Undo action edit',
        description:'Undo the most recent WebMCP action patch or variant application for one action. Undo is action-scoped and does not replace the whole profile.',
        inputSchema:{type:'object',properties:{actionId:optionalActionId},additionalProperties:false},
        execute:({actionId=selectedAction})=>{actionId=assertGameJuiceActionId(actionId);const stack=actionUndoStack(actionId);const entry=stack.pop();if(!entry)throw new Error(`No WebMCP action undo is available for ${actionId}`);const before=cloneValue(profile.actions[actionId]),draft=cloneProfile(profile);draft.actions[actionId]=entry.recipe;profile=normalizeProfile(draft);updateActionEditorAfterWebMcp(actionId);return {actionId,undone:entry.reason,recipeRevision:actionRecipeRevision(profile.actions[actionId]),changes:diffActionRecipes(before,profile.actions[actionId]),compatibility:actionCompatibility(profile.actions[actionId]),cost:estimateActionCost(profile.actions[actionId]),undoDepth:stack.length};}
      },
      {
        name:'compare_action_variants', title:'Compare action variants on one checkpoint',
        description:'Replay 2–4 named variants (or current) from the exact same native Live-map checkpoint across multiple event-relative frames and an explicit facing direction. Returns the comparison PNG directly plus compact frame metadata, parameter diffs, compatibility and measured render cost.',
        inputSchema:{type:'object',properties:{actionId:optionalActionId,variants:{type:'array',minItems:2,maxItems:4,uniqueItems:true,items:{type:'string',minLength:1,maxLength:40}},offsets:{type:'array',minItems:1,maxItems:9,uniqueItems:true,items:{type:'integer',minimum:-8,maximum:16}},direction:{type:'string',enum:['left','right']},zoom:{type:'integer',enum:[1,2,4]},submap:{type:'integer',minimum:0,maximum:46}},required:['variants'],additionalProperties:false},
        execute:input=>compareActionVariants(input)
      },
      {
        name:'export_action_json', title:'Export compact action JSON', readOnly:true,
        description:'Export a compact preset-relative action delta by default. Request format=clipboard only when the full existing Copy action interchange payload is required; optional effects restrict compact output to named channels.',
        inputSchema:{type:'object',properties:{actionId:optionalActionId,variant:{type:'string',minLength:1,maxLength:40},format:{type:'string',enum:['compact','clipboard']},effects:{type:'array',minItems:1,maxItems:8,uniqueItems:true,items:effectIdSchema}},additionalProperties:false},
        execute:({actionId=selectedAction,variant='current',format='compact',effects=[]})=>{actionId=assertGameJuiceActionId(actionId);const resolved=resolveActionVariant(actionId,String(variant)),preset=productionPresetDescriptor({provenance:activePresetProvenance,profile});if(format==='clipboard'){const candidate=cloneProfile(profile);candidate.actions[actionId]=resolved.recipe;const payload=copyActionClipboardPayload(candidate,gameplayTuning,actionId);return {actionId,variant:resolved.name,format,recipeRevision:resolved.recipeRevision,preset,compatibility:actionCompatibility(resolved.recipe),cost:estimateActionCost(resolved.recipe),payload,json:JSON.stringify(payload,null,2)};}const baseline=preset.productionKey?productionEditorBaselineRecipe(preset.productionKey,actionId):DEFAULT_PROFILE.actions[actionId];const payload={schema:'rdr.game-juice-action-compact.v1',actionId,variant:resolved.name,preset,recipeRevision:resolved.recipeRevision,recipe:compactActionRecipeDelta(resolved.recipe,baseline||{},effects)};return {actionId,variant:resolved.name,format,preset,recipeRevision:resolved.recipeRevision,compatibility:actionCompatibility(resolved.recipe),cost:estimateActionCost(resolved.recipe),payload,json:JSON.stringify(payload,null,2)};}
      },
      {
        name:'export_production_patch', title:'Export production Game Juice patch', readOnly:true,
        description:'Translate live editor actions changed from the active production base (or explicit actionIds) into the authoritative production preset manifest and return a reviewable JSON operation set plus unified diff. Unsupported editor-only changes fail closed as blockers; this tool never writes repository files.',
        inputSchema:{type:'object',properties:{actionIds:{type:'array',minItems:1,maxItems:30,uniqueItems:true,items:actionIdSchema},presetKey:{type:'string',minLength:1,maxLength:64}},additionalProperties:false},
        execute:({actionIds=null,presetKey=null})=>{const sourcePreset=productionPresetDescriptor({provenance:activePresetProvenance,profile});const targetKey=presetKey||sourcePreset.productionKey;if(!targetKey)throw new Error('No production preset is associated with the active editor preset; pass presetKey explicitly');const targetActions=Array.isArray(actionIds)&&actionIds.length?actionIds:productionChangedActionIds(profile,targetKey);return {...buildProductionPresetPatch({profile,actionIds:targetActions.length?targetActions:[selectedAction],presetKey:targetKey}),sourcePreset,autoSelectedActions:!Array.isArray(actionIds)||!actionIds.length};}
      },
      {
        name:'set_presentation', title:'Set Game Juice presentation',
        description:'Switch the live Game Juice preview between Classic and RDX presentation using the existing shared xrick preview.',
        inputSchema:{type:'object',properties:{presentation:{type:'string',enum:['classic','rdx']}},required:['presentation'],additionalProperties:false},
        execute:({presentation})=>{if(actionPreviewSource==='live')throw new Error('Live map owns the native RDX preview. Switch to the A/B game or Synthetic preview before changing presentation.');const select=$('presentation-source');if(presentation==='rdx'&&select?.querySelector('option[value="rdx"]')?.disabled)throw new Error('RDX presentation is unavailable until the ROM is loaded');preview.setPresentation(presentation);gameplayPreviewPresentation=presentation;if(select)select.value=presentation;buildInspector();saveLocal(true);updateGameplayFeelUi();updateLiveDocs();return gameJuiceWebMcpState();}
      },
      {
        name:'set_preview_view', title:'Set Game Juice preview view',
        description:'Enter Playtest A/B and switch to the playable A/B, A, B or raw game view. This parks native action-preview ownership when necessary.',
        inputSchema:{type:'object',properties:{view:{type:'string',enum:['side','a','b','off']}},required:['view'],additionalProperties:false},
        execute:({view})=>{setCompareMode(view);return gameJuiceWebMcpState();}
      },
      {
        name:'set_action_preview_source', title:'Set action preview source',
        description:'Switch selected-action inspection between the existing native xrick Live map scenario and the synthetic mini-stage. Live-map mode reuses the current reviewed fixture/zoom path.',
        inputSchema:{type:'object',properties:{source:{type:'string',enum:['live','synthetic']},submap:{type:'integer',minimum:0,maximum:46}},required:['source'],additionalProperties:false},
        execute:({source,submap})=>{setActionPreviewSource(source,{rebuild:true,resetGameplay:true,liveSubmap:Number.isInteger(submap)?Number(submap):null});saveLocal(true);updateLiveDocs();return gameJuiceWebMcpState();}
      },
      {
        name:'select_submap', title:'Open Game Juice submap',
        description:'Select a zero-based gameplay submap in the live Game Juice preview.',
        inputSchema:{type:'object',properties:{submap:{type:'integer',minimum:0,maximum:46}},required:['submap'],additionalProperties:false},
        execute:({submap})=>{gameplayPreviewSubmap=Number(submap);const select=$('level-select');if(select)select.value=String(submap);if(actionPreviewSource==='live')setActionPreviewSource('synthetic',{rebuild:true,resetGameplay:true});else{preview.selectSubmap(Number(submap));runtimeA.resetTransient();runtimeB.resetTransient();latestSnapshot=preview.bridge.snapshot();}saveLocal(true);updateLiveDocs();return gameJuiceWebMcpState();}
      },
      {
        name:'update_movement', title:'Tune Game Juice movement',
        description:'Patch movement-feel controls and apply them through the authoritative xrick live-preview setters.',
        inputSchema:{type:'object',properties:{patch:{type:'object',minProperties:1,additionalProperties:false,properties:{walkSpeed:{type:'integer',minimum:1,maximum:4},coyoteFrames:{type:'integer',minimum:0,maximum:8},jumpBufferFrames:{type:'integer',minimum:0,maximum:8},ladderTopEntryTolerance:{type:'integer',minimum:0,maximum:6},jumpTakeoff:{type:'number',minimum:2,maximum:8},gravity:{type:'number',minimum:0.125,maximum:2},apexGravityPercent:{type:'integer',minimum:25,maximum:150},jumpReleasePercent:{type:'integer',minimum:25,maximum:100},maxFall:{type:'number',minimum:2,maximum:16},ceilingCorrection:{type:'integer',minimum:0,maximum:6},groundSnap:{type:'integer',minimum:0,maximum:4},fallBounceMinHeight:{type:'integer',minimum:0,maximum:192},explosionNearBounceLift:{type:'number',minimum:0.25,maximum:5},platformCurveMode:{type:'string',enum:['linear','ease-in','ease-out','ease-in-out','overshoot','anticipate','custom']},platformCurveX1:{type:'number',minimum:0,maximum:1},platformCurveY1:{type:'number',minimum:-1,maximum:2},platformCurveX2:{type:'number',minimum:0,maximum:1},platformCurveY2:{type:'number',minimum:-1,maximum:2}}}},required:['patch'],additionalProperties:false},
        execute:({patch})=>{const allowed=new Set(Object.keys(DEFAULT_GAMEPLAY_TUNING));for(const [key,value] of Object.entries(patch||{})){if(!allowed.has(key))throw new Error(`Unknown movement tuning field '${key}'`);gameplayTuning[key]=value;}applyGameplayTuning();return {gameplayTuning:{...gameplayTuning},native:compactNativeSnapshot(preview.bridge.snapshot())};}
      },
      {
        name:'reset_profile', title:'Reset Game Juice B profile',
        description:'Reset the editable B profile to the built-in default while leaving the A comparison baseline unchanged.',
        execute:()=>{$('profile-reset').click();return gameJuiceWebMcpState();}
      }
    ]
  });
}

function exportProfile() {
  const payload = { ...profile, schema: JUICE_SCHEMA, exportedAt: new Date().toISOString(), editor: 'Rick Dangerous Revival Game Juice Editor', comparison: { baselineMode, A: baselineMode === 'accepted' ? profileA.name : 'JUICE OFF', B: profile.name } };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'rick-dangerous-revival-juice-profile.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function importProfile(file) { const data = JSON.parse(await file.text()); if (data.schema !== JUICE_SCHEMA) throw new Error(`Unsupported schema: ${data.schema || 'missing'}`); profile = normalizeProfile(data); activePresetProvenance=capturePresetProvenance({source:'imported',profile}); $('perf-preset').value = profile.performancePreset; $('adaptive-budget').checked = profile.adaptiveBudget; syncProfiles(); buildActionList(); buildInspector(); saveLocal(true); }

async function init() {
  installWorkspaceWindows();
  document.querySelectorAll('[data-compare-view]').forEach(button => button.addEventListener('click', () => setCompareMode(button.dataset.compareView)));
  document.querySelectorAll('[data-actions-workflow]').forEach(button => button.addEventListener('click', () => setActionsWorkflow(button.dataset.actionsWorkflow)));
  $('global-audio-mute')?.addEventListener('click',()=>{editorMuted=!editorMuted;syncGlobalAudioMute({save:true});});
  buildPresetSelect(); buildGameStylePicker(); buildActionQuickSelect(); buildActionList(); buildInspector(); bindControls(); bindToolScreens(); applyCompareLayout(); syncActionsWorkflowUi();
  $('adaptive-budget').checked = profile.adaptiveBudget; await Promise.all([buildLevelSelect(), loadEntitySoundMapping(), (async()=>{nativeActionPreviewSceneCatalog=await NativeActionPreviewSceneCatalog.create();})()]);buildInspector();
  preview = await XrickLivePreview.create(handleEvent, handleNativeSfxEvent); preview.setInvincible(true); preview.setEditorAutoRefill(true); preview.setEditorAutoRevive(autoReviveSameSpot); preview.setHighQualityAmigaAudio(); runtimeA.setAudioSource('classic'); runtimeB.setAudioSource(selectedAudioSource);
  syncGlobalAudioMute();
  applyGameplayTuning({ save: false });
  try { await autoLoadEditorRdxRom(); } catch (error) { console.warn('Game Juice DX ROM auto-load failed:', error); $('save-status').textContent=`DX ROM auto-load failed: ${error.message}. Manual ROM loading remains available.`; }
  if(!Number.isInteger(Number(gameplayPreviewSubmap)))gameplayPreviewSubmap=Number(preview.bridge.submap());
  if(Number(preview.bridge.submap())!==Number(gameplayPreviewSubmap))preview.selectSubmap(gameplayPreviewSubmap);
  const savedGameplayPresentation=saved?.gameplayPreviewPresentation;
  if(savedGameplayPresentation==='classic'||(savedGameplayPresentation==='rdx'&&preview.rdxLoaded)){gameplayPreviewPresentation=savedGameplayPresentation;preview.setPresentation(gameplayPreviewPresentation,{forceFrame:false});}
  else gameplayPreviewPresentation=preview.presentation==='rdx'?'rdx':'classic';
  if(actionsWorkflow==='tune'&&actionPreviewSource==='live'){startNativeActionPreviewScenario({restart:true});}
  else {preview.bridge.setFrontendPaused?.(false);preview.bridge.resumeBrowserLoop?.();syncNativePreviewOwnershipUi();}
  syncActionsWorkflowUi();

  const infiniteResourcesSupported = preview.bridge.supportsEditorResourceLoop();
  if (!infiniteResourcesSupported) {
    $('infinite-resources').checked = false;
    $('infinite-resources').disabled = true;
    $('infinite-resources').closest('label').title = 'Rebuild xrick.js/xrick.wasm from this source package to enable editor auto-refill for bullets, dynamite and lives.';
  }
  $('level-select').value = String(gameplayPreviewSubmap); latestSnapshot = preview.bridge.snapshot(); buildInspector();

  $('motion-trail-enabled').checked = !!profile.motionTrail?.enabled;
  if ($('audio-affect-live')) $('audio-affect-live').checked = audioAffectsLiveEdits;
  $('motion-trail-copies').value = String(profile.motionTrail?.copies || 3);
  $('motion-trail-color').value = profile.motionTrail?.color || 'off-white';
  $('motion-trail-alpha').value = String(profile.motionTrail?.alpha ?? 1);
  $('slowmo-toggle').addEventListener('click', () => {
    slowMoEnabled = !slowMoEnabled;
    preview.setAnalysisFps(slowMoEnabled ? 1 : 0);
    $('slowmo-toggle').setAttribute('aria-pressed', String(slowMoEnabled));
    $('slowmo-toggle').classList.toggle('primary', slowMoEnabled);
    $('slowmo-toggle').textContent = slowMoEnabled ? 'Slow-mo ON · 1 FPS' : 'Slow-mo · 1 FPS';
  });
  const updateTrailCompatibility = () => {
    const compatibility=motionTrailCompatibility(profile.motionTrail), marker=$('motion-trail-compat');
    if(marker){marker.dataset.period=compatibility.compatible?'period':'enhanced';marker.textContent=`${compatibilityBadge(compatibility)} · ${compatibilitySummary(compatibility)}`;}
  };
  updateTrailCompatibility();
  const syncTrailControls = () => {
    profile.motionTrail = {
      enabled: $('motion-trail-enabled').checked,
      copies: Number($('motion-trail-copies').value || 3),
      color: $('motion-trail-color').value,
      alpha: Number($('motion-trail-alpha').value || 1)
    };
    profile = normalizeProfile(profile); syncProfiles(); saveLocal(); updateCostOnly(); updateTrailCompatibility();
  };
  for (const id of ['motion-trail-enabled','motion-trail-copies','motion-trail-color','motion-trail-alpha']) {
    $(id).addEventListener(id === 'motion-trail-copies' || id === 'motion-trail-alpha' ? 'input' : 'change', syncTrailControls);
  }

  $('perf-preset').addEventListener('change', e => { profile.performancePreset = e.target.value; profileA.performancePreset = e.target.value; profile = normalizeProfile(profile); profileA = normalizeProfile(profileA); syncProfiles(); saveLocal(); updateMetrics(); });
  $('adaptive-budget').addEventListener('change', e => { profile.adaptiveBudget = e.target.checked; profileA.adaptiveBudget = e.target.checked; profile = normalizeProfile(profile); profileA = normalizeProfile(profileA); syncProfiles(); saveLocal(); });
  $('compare-mode').addEventListener('change', applyCompareLayout);
  $('presentation-source').addEventListener('change', e => { if(actionPreviewSource==='live'){e.target.value='rdx';return;} try { preview.setPresentation(e.target.value); gameplayPreviewPresentation=e.target.value==='rdx'?'rdx':'classic'; } catch (error) { e.target.value = 'classic'; preview.setPresentation('classic'); gameplayPreviewPresentation='classic'; alert(error.message); } buildInspector(); saveLocal(true); updateGameplayFeelUi(); updateLiveDocs(); });
  $('rdx-rom').addEventListener('change', async e => { const file = e.target.files?.[0]; if (!file) return; try { await activateEditorRdxRom(new Uint8Array(await file.arrayBuffer()),file.name); } catch (error) { alert(error.message); } finally { e.target.value=''; } });
  $('level-select').addEventListener('change', e => { const submap=Number(e.target.value);gameplayPreviewSubmap=submap;if(actionPreviewSource==='live')setActionPreviewSource('synthetic',{rebuild:true,resetGameplay:true});else{preview.selectSubmap(submap);runtimeA.resetTransient();runtimeB.resetTransient();latestSnapshot=preview.bridge.snapshot();}saveLocal(true);updateLiveDocs(); });
  $('reset-level').addEventListener('click', () => { if(actionPreviewSource==='live')setActionPreviewSource('synthetic',{rebuild:true,resetGameplay:true});else{preview.resetLevel();runtimeA.resetTransient();runtimeB.resetTransient();} });
  $('invincible').addEventListener('change', e => preview.setInvincible(e.target.checked));
  $('infinite-resources').addEventListener('change', e => preview.setEditorAutoRefill(e.target.checked));
  $('auto-revive').checked = autoReviveSameSpot;
  $('auto-revive').addEventListener('change', e => { autoReviveSameSpot = e.target.checked; preview.setEditorAutoRevive(autoReviveSameSpot); saveLocal(true); });
  const movementBindings = {
    'movement-walk-speed':'walkSpeed', 'movement-coyote-frames':'coyoteFrames', 'movement-jump-buffer-frames':'jumpBufferFrames',
    'movement-ladder-top-entry-tolerance':'ladderTopEntryTolerance', 'movement-jump-takeoff':'jumpTakeoff', 'movement-gravity':'gravity', 'movement-apex-gravity':'apexGravityPercent',
    'movement-jump-release':'jumpReleasePercent', 'movement-max-fall':'maxFall',
    'movement-fall-bounce-min-height':'fallBounceMinHeight', 'movement-platform-curve':'platformCurveMode',
    'movement-platform-curve-x1':'platformCurveX1','movement-platform-curve-y1':'platformCurveY1',
    'movement-platform-curve-x2':'platformCurveX2','movement-platform-curve-y2':'platformCurveY2'
  };
  for (const [id, key] of Object.entries(movementBindings)) $(id)?.addEventListener('change', e => { gameplayTuning[key] = e.target.value; applyGameplayTuning(); });
  $('movement-reset')?.addEventListener('click', () => { gameplayTuning = { ...DEFAULT_GAMEPLAY_TUNING }; applyGameplayTuning(); $('save-status').textContent = 'Movement feel reset to neutral defaults.'; });
  $('open-movement-settings')?.addEventListener('click', () => setJuiceScreen('movement', { scroll:true }));
  $('audio-quality').addEventListener('change', e => { preview.setAudioQuality(e.target.value); updateLiveDocs(); });
  $('audio-filter').addEventListener('change', e => { preview.setAudioFilter(e.target.value); updateLiveDocs(); });
  $('audio-spatial').addEventListener('change', e => { preview.setAudioSpatial(e.target.value); updateLiveDocs(); });
  $('audio-audition').addEventListener('change', () => { syncAudioAudition(); updateLiveDocs(); });
  $('audio-affect-live')?.addEventListener('change', e => { audioAffectsLiveEdits = e.target.checked; syncAudioAudition(); saveLocal(true); updateLiveDocs(); });
  $('accept-baseline').addEventListener('click', acceptEditableAsBaseline);
  $('accept-baseline-toolbar').addEventListener('click', acceptEditableAsBaseline);
  $('reset-baseline').addEventListener('click', resetBaselineToRaw);
  $('save-b').addEventListener('click', () => { profileB = normalizeProfile(profile); saveLocal(true); $('save-status').textContent = 'B draft checkpoint saved locally.'; });
  $('profile-reset').addEventListener('click', () => { profile = cloneProfile(DEFAULT_PROFILE); activePresetProvenance=capturePresetProvenance({source:'default',profile}); $('perf-preset').value = profile.performancePreset; $('adaptive-budget').checked = profile.adaptiveBudget; $('motion-trail-enabled').checked=!!profile.motionTrail.enabled; $('motion-trail-copies').value=String(profile.motionTrail.copies); $('motion-trail-color').value=profile.motionTrail.color; $('motion-trail-alpha').value=String(profile.motionTrail.alpha); syncProfiles(); buildActionList(); buildInspector(); saveLocal(true); $('save-status').textContent = 'B reset to default juice profile. A baseline was left unchanged.'; });
  $('action-enabled').addEventListener('change', e => { profile.actions[selectedAction].enabled = e.target.checked; syncProfiles(); buildActionList(); updateCostOnly(); saveLocal(); });
  $('action-test').addEventListener('click', triggerSelectedTest);
  $('profile-export').addEventListener('click', exportProfile);
  $('profile-import').addEventListener('change', async e => { const file = e.target.files?.[0]; if (!file) return; try { await importProfile(file); } catch (error) { alert(error.message); } finally { e.target.value = ''; } });
  $('benchmark-toggle').addEventListener('click', () => { if (!benchmark) startBenchmark(); });
  syncAudioAudition(); updateComparisonLabels(); updateGameplayFeelUi(); updateLiveDocs(); updateMetrics(); void installGameJuiceWebMcp(); requestAnimationFrame(loop);
}

init().catch(error => { console.error(error); $('engine-live-status').textContent = error.message; $('save-status').textContent = `Initialization failed: ${error.message}`; });
