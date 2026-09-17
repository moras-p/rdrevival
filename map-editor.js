import { RdxRom } from './rdx/src/core/rom.js';
import { RdxMapDecoder } from './rdx/src/core/map.js';
import { effectiveMapDimensions } from './rdx/src/core/map-topology.js';
import { RdxSpriteDecoder, rdxEnemyClimbFrame, rdxEnemyPresentationTick, rdxEnemySpatialPhaseTick } from './rdx/src/core/sprite.js';
import { RdxMapping } from './rdx/src/runtime/mapping.js';
import { ClassicRdxCellShiftMap } from './rdx/src/runtime/classic-rdx-cell-shift-map.js';
import { canConnectRdxRomDirectory, connectRdxRomDirectory, loadRememberedRdxRom, rememberRdxRom, RDX_ROM_FILENAME } from './rdx/src/runtime/rom-store.js';
import { classicPresentationBoundsToRdx, classicPresentationPointToRdx, projectClassicPreviewBufferToRdx } from './rdx/src/editor/presentation-alignment.js';
import { PaletteRegistry } from './rdx/src/data/palettes.js';
import { createCanonicalLevelEditorPreviewRenderer, createDecodedRdxPreviewRenderer } from './rdx/src/level-editor/rendering/canonical-room-renderer.js';
import { geometryIdsClipboardText } from './rdx/src/preview/geometry-ids.js';
import { buildDebugOverlayModel, DebugPrimitiveFlag, DebugPrimitiveType, primitiveVisible } from './rdx/src/debug/overlay-model.js';
import { geometryProvenanceViewModel, geometryProvenanceClipboard } from './rdx/src/preview/geometry-provenance.js';
import {
  editorDiagnosticRows, editorDiagnosticCandidates, editorInstanceCandidates, hitDiagnosticCandidate,
  diagnosticItemId, diagnosticBounds, diagnosticDisplayName, drawEditorDiagnosticRows, editorHoverCellInspection, editorDebugFilterMatches,
  editorClassicRdxShiftInspection, drawEditorClassicRdxShift, mergeEditorNativeMotionGeometry
} from './rdx/src/editor/diagnostics.js';
import { MAP_EFLG, projectRdxDescriptor } from './rdx/src/collision/descriptor-semantics.js';
import { XrickWasmBridge, RDX_PLAYFIELD, renderClassicFramebuffer, validateRoomManifestParity } from './rdx/xrick-bridge.js';
import {
  LEVEL_EDITOR_SCHEMA, LEVEL_EDITOR_VERSION, COLLISION_PRESETS, ENTITY_FLAGS,
  createLevelDocument, LevelDocumentStore, normalizeLevelDocument,
  validateLevelDocument, exportLevelJson
} from './rdx/src/editor/level-document.js';
import {
  normalizeAutotileCatalog, terrainSetsForGroup, terrainSetById, resolveTerrainVisualOverrides, resolveTerrainCollisionOverrides, resolveTerrainCell, autotileDebugRows, rankSupportPrototypes
} from './rdx/src/editor/autotile.js';
import { normalizeStampCatalog, stampElementById, stampElementsForGroup, stampById, stampFamilyById, stampFamiliesForGroup, familyForStamp, variantsForFamily, rankStampVariants, chooseStampStage, chooseStampVariantForPlacement, resolveStampVisualOverrides, terrainFootprintForPlacement } from './rdx/src/editor/stamps.js';
import { PREVIEW_STEP_MS, PreviewClock } from './rdx/src/preview/preview-clock.js';
import { installWebMcpTools } from './rdx/src/agent/webmcp.js';
import { createNativeDraftPlan, applyNativeDraftPlan } from './rdx/src/editor/native-draft-plan.js';
import {
  LEVEL_EDITOR_IMPLEMENTATION_SCHEMA, LEVEL_EDITOR_CHANGES_SCHEMA, exportImplementationJson, exportChangesJson, implementationEditorDocument
} from './rdx/src/editor/implementation-export.js';
import { canRetractReviewedSystemPatch, createSystemPatchRemoval, systemPatchRemovalFor, systemPatchRemovalRestoresPixels, systemPatchRestorationOverrides } from './rdx/src/editor/system-patch-removals.js';
import { editorEntitySourceMotion, editorEntityDrawPosition, editorEntityPlacementSnapshot, resolvedConvertedSourcePlacement, resolvedEntityBaselineContext, recoverConvertedSourceProvenanceFromResolved } from './rdx/src/editor/entity-preview.js';
import { sourceTimelineModel, sourceTimelineTick } from './rdx/src/editor/source-timeline.js';
import { NativeRuntimeTimeline } from './rdx/src/editor/native-runtime-timeline.js';
import { NativeProjectileCaptureTimeline, captureNativeProjectileLifecycles } from './rdx/src/editor/native-projectile-capture.js';
import { NativeDogInspectionLoop } from './rdx/src/editor/native-dog-inspection.js';
import { isNativeProjectileActive } from './rdx/src/editor/runtime-projectiles.js';
import { composeWholeRoomSimulationStates, configuredBoundedPatrolRecord, scriptedLifecycleRecord } from './rdx/src/editor/whole-room-simulation.js';
import { LEVEL_LAYER_DRAFT_SCHEMA, exportLayeredDraftJson } from './rdx/src/editor/layered-draft.js';
import { createReviewedFixPlan, exportReviewedFixesJson } from './rdx/src/editor/reviewed-fix-plan.js';
import { REVIEWED_CORRECTIONS_SCHEMA } from './rdx/src/level-editor/domain/reviewed-corrections.js';
import { createResolvedEditorProjection, nativeLevelParity } from './rdx/src/levels/resolved-level.js';
import { PRESENTATION_BANDS, PRESENTATION_ALLOWED_BANDS, presentationDepthAt } from './rdx/src/levels/presentation-depth.js';
import { generatePresentationDepthSeed, presentationVisualIdentity, presentationDepthSeedAt } from './rdx/src/levels/presentation-depth-seed.js';
import { presentationDepthClassEditAt } from './rdx/src/editor/presentation-depth-class-authoring.js';
import { productionHeroStart } from './rdx/src/editor/hero-start.js';
import { entityTypeOptionLabel, entityAssignmentSummary, assignNativeEntityType } from './rdx/src/editor/entity-assignment.js';
import { ENEMY_TYPES, applyEnemyKindToSimulationState, defaultEnemyPatrolForSource, effectiveEnemyEntity, effectiveEnemyKind, enemyControllerParts, enemyEntityFor, enemyKindStateOverrides, enemyKindsForLevel, enemyLevelLabel, enemyPatrolEditorGeometry, enemyTypeForEntity, isClassicEnemyEntity, normalizeEnemyPatrol, resizeEnemyPatrolEdge, sourceEnemyPatrol, sourceRdxEnemyKind } from './rdx/src/editor/enemy-authoring.js';
import { effectiveSourcePlacementOffset, sourceOcclusionLayer, sourcePlacementOffset, sourceOverrideHasAuthoredChange, sourceStateVisualOffsets, snapSourceOpaqueTranslation } from './rdx/src/editor/source-placement.js';
import { effectiveStatePresentation, normalizeStatePresentationOverrides, semanticPresentationStates, statePresentationDraftMatches } from './rdx/src/editor/stateful-presentation.js';
import { StatefulComponentInspectionState, statefulComponentIdentity, statefulPresentationComponents, statefulPresentationStateIdentity } from './rdx/src/editor/stateful-component-inspection.js';
import { beginViewportBackgroundClick, isGenuineViewportBackgroundClick } from './rdx/src/editor/canvas-interaction.js';
import { SmartScissorsMatcher, smartScissorsBoundsFromPoints, smartScissorsMoveTargetOverrides, smartScissorsPastePlan, smartScissorsRetainUnaffectedTileRows, smartScissorsTilePlan, smartScissorsTransferPlanesForPresentation, smartScissorsVoidRects, intersectingReviewedVisualPatches } from './rdx/src/editor/smart-scissors.js';
import {
  SELECT_REGION_PRESENTATION, cycleSelectRegionMode, regionSelectionFromPoints,
  regionAffectsPlane, rectContainsRect, rectContainsPoint, dedupeRawRdxRegions
} from './rdx/src/editor/region-selection.js';

const $ = id => document.getElementById(id);
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const sm = n => `SM${Number(n).toString(16).toUpperCase().padStart(2,'0')}`;
const md = n => `MD${Math.max(0,Number(n)|0).toString().padStart(4,'0')}`;
const deepClone = value => JSON.parse(JSON.stringify(value));
const AUTOSAVE_KEY = 'rdr.levelEditor.autosave.v2181';
const DEBUG_NOTES_KEY = 'rdr.levelEditor.entityDebugNotes.v2178';
const ZOOMS = [.5,.75,1,1.5,2,3,4];
const COLLISION_RDX_DESCRIPTOR = 3; // RDX descriptor terrain + shared xrick Rick solver
const EDITOR_BUNDLED_ROM_PATH = './rdx/data/editor/Rick_Dangerous_DX_1.3x.bin';

const ui = Object.fromEntries([
  'editor-app','level-name','save-state','new-level','previous-room','open-room','next-room','reset-rdx','import-level','export-control','export-level','export-menu','validate-level','play-level','import-file',
  'undo','redo','tool-buttons','simulate-toggle','presentation-view-toggle','snap-toggle','grid-toggle','system-modifications-toggle','zoom-out','zoom-label','zoom-in','frame-width','frame-height','authority-label','cursor-readout',
  'scene-tab','library-tab','diagnostics-tab','scene-tree','scene-summary','changes-panel','changes-count','changes-list','host-room-label','level-size-label','hero-label','level-settings-button',
  'library-search','tile-library','entity-library','terrain-library-pane','stamp-library-pane','raw-tile-library-pane','terrain-collision-mode','terrain-catalog','selected-terrain-label','autotile-debug-toggle','terrain-assist-ambiguity','stamp-categories','stamp-catalog','selected-stamp-label','tile-source-map','tile-source-plane','tile-palette','tile-palette-selection','selected-tile-label','tile-rotation-variants','entity-categories','entity-catalog',
  'diagnostics-count','diagnostics-views','diagnostics-shift-mode-section','diagnostics-shift-modes','diagnostics-layer-stage-section','diagnostics-layer-stages','diagnostics-layer-stage-caption','diagnostics-layer-stage-help','diagnostics-filters','diagnostics-clear-selection','diagnostics-geometry-toggle','diagnostics-unresolved-toggle','diagnostics-trajectory-toggle','diagnostics-trajectory-legend','diagnostics-geometry-legend','diagnostics-instance-type','diagnostics-prev','diagnostics-next','diagnostics-instance-status','diagnostics-queue-caption','diagnostics-queue',
  'level-breadcrumb','room-breadcrumb','depth-preview-mode','depth-view-toggle','collision-overlay-toggle','viewport-shell','viewport-scroll','scene-stage','background-canvas','embedded-actors-canvas','foreground-behind-canvas','actors-canvas','foreground-canvas','front-actors-canvas','editor-canvas','tool-hint','selection-count','navigator-canvas','navigator-window','toast-stack','entity-debug-dock','debug-note-entity','debug-note-meta','debug-note-kind','debug-note-input','save-debug-note','download-debug-notes','debug-note-count',
  'playtest-dock','playtest-status','playtest-sound','playtest-invulnerable','playtest-resources','playtest-debug','playtest-scale','playtest-canvas-wrap','restart-playtest','stop-playtest','playtest-canvas',
  'inspector-tab','level-tab','validation-tab','copy-selection-id','diagnostics-inspector-tab','diagnostics-inspector','inspector-content','level-settings','validation-badge','run-checks','validation-list',
  'engine-status','parity-status','rdx-rom-load','rdx-rom-file','rdx-rom-folder','doc-stats','terrain-choice-dialog','terrain-choice-summary','terrain-choice-options','terrain-choice-dont-ask','new-level-dialog','new-name','new-mode','new-host','new-width','new-height','create-level',
  'smart-scissors-dialog','smart-scissors-summary','smart-scissors-options','smart-scissors-apply','smart-scissors-seed-control','smart-scissors-seed-toggle','smart-scissors-seed-label',
  'open-room-dialog','room-search','room-grid'
].map(id=>[id.replaceAll('-','_'),$(id)]));

const ctx = {
  background:ui.background_canvas.getContext('2d'), embeddedActors:ui.embedded_actors_canvas.getContext('2d'), foregroundBehind:ui.foreground_behind_canvas.getContext('2d'), actors:ui.actors_canvas.getContext('2d'),
  foreground:ui.foreground_canvas.getContext('2d'), frontActors:ui.front_actors_canvas.getContext('2d'),
  editor:ui.editor_canvas.getContext('2d'), navigator:ui.navigator_canvas.getContext('2d'),
  palette:ui.tile_palette.getContext('2d'), playtest:ui.playtest_canvas.getContext('2d')
};
for (const context of Object.values(ctx)) if (context) context.imageSmoothingEnabled=false;

let resources=null, bridge=null, store=null, room=null, runtimeFailure=null;
let tool='select', selectMode='object', activeLayer='background', activeCollision='open', collisionMode='select', collisionAuthoring='gameplay', zoom=1, spaceHeld=false;
let selectedTile=null, selectedTerrainSet=null, selectedStamp=null, selectedStampElement=null, tileAuthoringMode='terrain', autotileDebug=false, selectedEntityType=null, entityCategory='All', stampCategory='All', librarySearch='', entityPlacementArmed=false, draggedEntityType=null;
let rendererAuthorityKey='', previewPresentation='rdx', systemModificationsEnabled=true, depthView=false, depthPreviewMode='full', lastStaticLayers=null, lastPresentationSeed=null;
let presentationVisibility={backdrop:true,embeddedActors:true,midground:true,foreground:true,actors:true,frontActors:true};
let selection=[], sourceSelectables=[], customHitboxes=[], nativeTransitionHitboxes=[], lastDynamic=null, lastDynamicRenderer=null, lastPreviewTick=0, lastDynamicClassicProjection='none', hoverCell=null;
let diagnostics={active:false,view:'runtime',shiftMode:'heatmap',layerStage:'F',filter:'all',geometry:false,unresolved:false,trajectories:false,alignmentCell:null,selectedId:'',selectedItem:null,geometryCells:[],instanceType:'enemy',instanceIndex:-1};
let gesture=null, viewportBackgroundClick=null, renderPending=false, tick=0, timelineScrub=null, forcedPresentationState=null;
const componentInspection=new StatefulComponentInspectionState();
const simulationClock=new PreviewClock({stepMs:PREVIEW_STEP_MS,maxCatchUpSteps:4});
let playtest={active:false,pending:null,captured:false,mask:0,restoreInvincible:false,restoreResources:false,restoreSoundMuted:false,restoreCollisionPolicy:COLLISION_RDX_DESCRIPTOR,lastSerial:-1,lastProgressSerial:-1,lastProgressAt:0,lastKickAt:0,fault:''};
const nativeSimulation={active:false,pending:null,timeline:new NativeRuntimeTimeline(),projectileTimeline:new NativeProjectileCaptureTimeline(),dogInspection:new NativeDogInspectionLoop({holdTicks:Math.max(1,Math.round(2000/PREVIEW_STEP_MS))}),displayStates:new Map(),geometry:null,lastSerial:-1,tick:0,restoreInvincible:false,restoreResources:false,restoreSoundMuted:false,restoreCollisionPolicy:COLLISION_RDX_DESCRIPTOR};
let savedHash='', clipboardEntities=[], debugNotes=[];
let smartScissorsMatcher=null, smartScissorsSession=null, smartScissorsMode='repair', smartScissorsTransferSelection=null;
const tileVariantIndexCache=new Map();
const autotileVisualRenderCache=new Map();
const rawCellInfoCache=new Map();

const TOOL_HINTS={
  select:'Select · click an object, Shift-click to add, drag a marquee, drag a production actor, or resize selected bounded-patrol edges', hand:'Pan · drag the canvas',
  brush:'Brush · paint the selected 8×8 tile into the active presentation layer', rectangle:'Rectangle · drag to stamp a tile region',
  scissors:'Smart Scissors · drag an 8×8-aligned rectangle; click Scissors again to cycle Cut + Move and Cut + Paste',
  fill:'Fill · click to flood a connected region · drag a frame to fill the entire selected rectangle', eyedropper:'Pick · sample an existing presentation tile',
  collision:'Collision · exact 8×8 gameplay corrections; Advanced Descriptor edits raw 16×16 MT/ML', entity:'Entity · select/edit actors; choose or drag an entity from Library to place it',
  hero:'Hero · click to set the exact RDX descriptor-world playtest start', erase:'Erase · remove draft content or suppress a source actor'
};

const DIAGNOSTIC_LAYER_STAGES=Object.freeze({
  A:Object.freeze({caption:'A · raw decoded RDX',help:'Bare RDX map decode. Reviewed alignment, structure, semantics, placement and editor draft changes are withheld.'}),
  B:Object.freeze({caption:'B · Classic / xrick source',help:'Complete generated Classic source at its preview origin. Canonical source coordinates remain unchanged; RDX registration begins in Layer C.'}),
  C:Object.freeze({caption:'C · Classic aligned to RDX',help:'Complete Layer-B Classic preview registered into RDX space with the reviewed Layer-C regional/cell correspondence.'}),
  D:Object.freeze({caption:'D · structural RDX',help:'Decoded RDX with reviewed structural/map corrections. Semantic actor replacements and Layer-F placement residuals are withheld.'}),
  E:Object.freeze({caption:'E · semantic presentation',help:'Layer-D map plus semantic RDX actor/presentation ownership before Layer-F effective placement/bounds corrections.'}),
  F:Object.freeze({caption:'F · effective A–F',help:'Canonical production result through Layer F. Draft edits are withheld in Layers view so production-stage effects can be isolated.'})
});
function diagnosticLayerStage(){return diagnostics.active&&diagnostics.view==='layers'?String(diagnostics.layerStage||'F').toUpperCase():null;}
function diagnosticLayerStageInfo(stage=diagnosticLayerStage()){return DIAGNOSTIC_LAYER_STAGES[String(stage||'F').toUpperCase()]||DIAGNOSTIC_LAYER_STAGES.F;}

async function json(path){ const r=await fetch(path); if(!r.ok) throw new Error(`${path}: HTTP ${r.status}`); return r.json(); }
async function bytes(path){ const r=await fetch(path); if(!r.ok) throw new Error(`${path}: HTTP ${r.status}`); return new Uint8Array(await r.arrayBuffer()); }
function waitForModule(timeoutMs=30000){
  if(globalThis.Module?.rdxRuntimeReady && typeof globalThis.Module.cwrap==='function') return Promise.resolve(globalThis.Module);
  return new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('xrick WebAssembly runtime did not initialize within 30 seconds. Rebuild and serve the complete out/html5 bundle.')),timeoutMs);addEventListener('xrick-runtime-ready',()=>{clearTimeout(t);resolve(globalThis.Module)},{once:true});});
}
function toast(message,kind='ok',duration=2600){ const n=document.createElement('div');n.className=`toast ${kind}`;n.textContent=message;ui.toast_stack.append(n);setTimeout(()=>n.remove(),duration); }
function setEngine(text,kind='loading'){ui.engine_status.textContent=text;ui.engine_status.className=`status-chip ${kind}`;}
function setParity(text,kind=''){ui.parity_status.textContent=text;ui.parity_status.className=`status-chip ${kind}`;}
function hashDoc(d){return JSON.stringify(d);}
function markDirty(){const dirty=hashDoc(store.document)!==savedHash;ui.save_state.textContent=dirty?'Unsaved changes':'Saved locally';ui.save_state.className=`save-state ${dirty?'dirty':'saved'}`;}
function saveLocal(){try{localStorage.setItem(AUTOSAVE_KEY,exportLevelJson(store.document));ui.save_state.textContent='Autosaved';ui.save_state.className='save-state saved';}catch{} }
function download(name,text){const blob=new Blob([text],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),100);}

function roomForSubmap(submap){return resources.manifest.rooms.find(r=>Number(r.submap)===Number(submap))||null;}
function classicRoom(submap){return resources.classic.rooms.find(r=>Number(r.submap)===Number(submap))||null;}
function resolvedRoomFor(submap=store?.document?.base?.submap,mapId=store?.document?.base?.mapId){return resources?.resolvedLevels?.rooms?.find(r=>Number(r.submap)===Number(submap)&&Number(r.mapId)===Number(mapId))||null;}
function productionRoom(){return resources?.productionScene?.rooms?.find(r=>Number(r.submap)===Number(store?.document?.base?.submap)&&Number(r.mapId)===Number(store?.document?.base?.mapId))||null;}
function productionActorForSource(sourceKey){return productionRoom()?.actors?.find(row=>String(row?.sourceKey||'')===String(sourceKey||''))||null;}
function classicRoomForCurrentSubmap(){const submap=store?.document?.base?.submap;if(!Number.isFinite(Number(submap)))return null;return resources?.classic?.rooms?.find(row=>Number(row.submap)===Number(submap))||null;}
function productionSourceTimeline(sourceKey){const key=String(sourceKey||''),actor=productionActorForSource(key),record=scriptedLifecycleRecord(actor,resources?.classicScriptedPaths)||configuredBoundedPatrolRecord(actor,classicRoomForCurrentSubmap())||nativeSimulation.timeline.sourceRecord(key)||nativeSimulation.projectileTimeline.sourceRecord(key);return sourceTimelineModel(record);}
function nativeHorizontalMotionObserved(sourceKey){const samples=nativeSimulation.timeline.sourceRecord(sourceKey)?.samples||[];let first=null;for(const sample of samples){const x=Number(sample?.classicDraw?.[0]??sample?.nativeEntity?.x);if(!Number.isFinite(x))continue;if(first==null)first=x;else if(x!==first)return true;}return false;}
function composeNativeSimulationStates(primaryStates,tickValue=nativeSimulation.tick){
  const merged=nativeSimulation.projectileTimeline.statesAt(tickValue);
  for(const [key,state] of primaryStates||[]){
    const captured=merged.get(key);
    /* The isolated projectile timeline exists specifically to make every
     * reviewed shooter camera-independent in whole-room Simulate. A dormant
     * camera-resident type-3 slot must not erase an active captured flight for
     * the same source. Conversely, an active resident projectile is stronger
     * live evidence and replaces the isolated sample. Non-projectile sources
     * retain the primary native state unconditionally. */
    if(captured&&isNativeProjectileActive(captured)&&!isNativeProjectileActive(state))continue;
    const motionObserved=nativeHorizontalMotionObserved(key);
    merged.set(key,motionObserved?state:Object.freeze({...state,wholeRoomHorizontalMotionObserved:false}));
  }
  const supportPatrolBySource=new Map((resources?.preview?.actorSystem?.actors||[]).filter(actor=>actor?.production?.sourceKey).map(actor=>[String(actor.production.sourceKey),actor.auditPatrol||null]));
  const composed=composeWholeRoomSimulationStates({resolvedActors:productionRoom()?.actors||[],classicScriptedPaths:resources?.classicScriptedPaths,primaryStates:merged,tick:tickValue,classicRoom:classicRoomForCurrentSubmap(),supportPatrolBySource});
  return applyDraftEnemyKindsToSimulationStates(composed);
}
function simulationStatesAt(tickValue,{pinSourceKey=null}={}){const phase=Math.max(0,Number(tickValue)||0);if(!pinSourceKey)return composeNativeSimulationStates(nativeSimulation.timeline.statesAt(phase),phase);const key=String(pinSourceKey),primary=new Map(nativeSimulation.timeline.currentStates()),pinned=nativeSimulation.timeline.sourceStateAt(key,phase);if(pinned)primary.set(key,pinned);const candidate=composeNativeSimulationStates(primary,phase),states=new Map(nativeSimulation.displayStates);if(candidate.has(key))states.set(key,candidate.get(key));return states;}
function applyNativeRuntimeStates(states){
  const renderers=[resources?.preview,resources?.previewE,resources?.classicPreview,resources?.rawPreview].filter(Boolean),before=renderers.map(renderer=>renderer.staticLifecycleSignature?.()||'').join('|');
  nativeSimulation.displayStates=states instanceof Map?states:new Map(states||[]);
  for(const renderer of renderers)renderer.setNativeRuntimeStates?.(nativeSimulation.displayStates);
  const after=renderers.map(renderer=>renderer.staticLifecycleSignature?.()||'').join('|');
  return before!==after;
}
function previewMotionEnabled(){return !!store?.document?.settings?.simulatePreview||!!timelineScrub;}
function effectivePreviewTick(){return timelineScrub?Number(timelineScrub.tick||0):(store?.document?.settings?.simulatePreview?Math.max(0,nativeSimulation.tick-(nativeSimulation.active?1:0)):0);}
function clearTimelineScrub(){if(!timelineScrub)return;timelineScrub=null;applyNativeRuntimeStates(nativeSimulation.active?composeNativeSimulationStates(nativeSimulation.timeline.currentStates(),nativeSimulation.tick):new Map());simulationClock.reset(nativeSimulation.tick);simulationClock.setPaused(true);}
function hostDimensions(r=room){return resources.mapDecoder.dimensions(Number(r.mapId));}
function productionDimensions(r=room){const raw=hostDimensions(r),mapping=resources?.mapping?.levelForSubmap?.(Number(r?.submap));return effectiveMapDimensions(raw,mapping?.rdxTopology||null);}
function docBounds(){return store.document.bounds;}
function displayBounds(){
  const bounds=docBounds(),stage=diagnosticLayerStage();
  if(stage!=='B')return bounds;
  const source=classicRoomForCurrentSubmap(),preview=source?.preview||source;
  return {width:Math.max(Number(bounds.width)||1,Number(preview?.widthTiles||0)*8),height:Math.max(Number(bounds.height)||1,Number(preview?.heightTiles||0)*8)};
}
function rawRdxRegions(){return dedupeRawRdxRegions(store?.document?.settings?.rawRdxRegions||[],docBounds());}
function hasRawRdxRegions(){return rawRdxRegions().length>0;}
function selectedLayerPlane(){return activeLayer==='foreground'?'A':'B';}
function currentPalette(){return resources.palettes.forMap(store.document.base.mapId).rgba;}
function rawSourceMode(){return String(ui.tile_source_plane?.value||'SMART');}
function rawCellMode(mode=rawSourceMode()){return ['SMART','COMPOSITE','SAFE_B','SAFE_A'].includes(String(mode));}
function selectedRawGrid(){return selectedTile?.kind==='cell16'?16:8;}
function selectedTileTargetLayers(tile=selectedTile){
  if(tile?.kind==='cell16')return ['B','A'];
  if(tile?.kind==='element8')return [...new Set((tile.outputs||[]).map(output=>String(output.layer||output.sourceLayer||'B').toUpperCase()).filter(layer=>layer==='A'||layer==='B'))];
  const layer=String(tile?.targetLayer||tile?.sourceLayer||selectedLayerPlane()).toUpperCase();return ['A','B'].includes(layer)?[layer]:[];
}
function selectedTileLayersLocked(tile=selectedTile){return selectedTileTargetLayers(tile).some(layer=>store.document.layers[layer==='A'?'foreground':'background']?.locked);}
function pixelRegionHasContent(buffer,x0,y0,w=16,h=16){
  if(!buffer)return false;
  const x1=Math.min(buffer.width,x0+w),y1=Math.min(buffer.height,y0+h);
  for(let y=Math.max(0,y0);y<y1;y++)for(let x=Math.max(0,x0);x<x1;x++){
    const o=(y*buffer.width+x)*4;
    if((buffer.data[o+3]||0)>0&&((buffer.data[o]||0)+(buffer.data[o+1]||0)+(buffer.data[o+2]||0)>0))return true;
  }
  return false;
}
function rawCellInfo(mapId){
  const id=Number(mapId),cached=rawCellInfoCache.get(id);if(cached)return cached;
  const dim=resources.mapDecoder.dimensions(id),pal=resources.palettes.forMap(id).rgba,
    A=resources.mapDecoder.renderPlane(id,pal,{plane:'A',viewport:{x:0,y:0,width:dim.width,height:dim.height}}).pixels,
    B=resources.mapDecoder.renderPlane(id,pal,{plane:'B',viewport:{x:0,y:0,width:dim.width,height:dim.height}}).pixels,
    composite=resources.mapDecoder.renderComposite(id,pal,{viewport:{x:0,y:0,width:dim.width,height:dim.height}}).pixels;
  const cells=new Map();
  for(let cy=0;cy<dim.cellHeight;cy++)for(let cx=0;cx<dim.cellWidth;cx++){
    const hasA=pixelRegionHasContent(A,cx*16,cy*16),hasB=pixelRegionHasContent(B,cx*16,cy*16);
    cells.set(`${cx},${cy}`,{hasA,hasB,type:hasA&&hasB?'COMPOSITE':hasB?'SAFE_B':hasA?'SAFE_A':'EMPTY'});
  }
  const out={dim,A,B,composite,cells};rawCellInfoCache.set(id,out);return out;
}
function rawCellAllowed(info,mode){if(!info||info.type==='EMPTY')return false;if(mode==='SMART')return true;return info.type===mode;}
function rawCellDisplayLabel(info){return info?.type==='COMPOSITE'?'A+B composite':info?.type==='SAFE_B'?'B-only standalone':info?.type==='SAFE_A'?'A-only standalone':'empty';}
function rawSmartSelection(mapId,cx,cy,mode=rawSourceMode()){
  const pack=rawCellInfo(mapId),info=pack.cells.get(`${cx},${cy}`);if(!rawCellAllowed(info,mode))return null;
  return {kind:'cell16',sourceMapId:Number(mapId),sourceMode:mode,cell:[Number(cx),Number(cy)],classification:info.type};
}
function presentationCellIdentity(cx,cy){
  let h=2166136261>>>0;
  for(const canvas of [ui.background_canvas,ui.foreground_canvas]){
    const c=canvas?.getContext?.('2d');if(!c)continue;
    const data=c.getImageData(cx*16,cy*16,Math.min(16,canvas.width-cx*16),Math.min(16,canvas.height-cy*16)).data;
    for(let i=0;i<data.length;i++){h^=data[i];h=Math.imul(h,16777619)>>>0;}
  }
  return h.toString(16);
}
function paintRawSelectionAt(p,targetStore=store){
  if(!selectedTile)return false;
  if(selectedTile.kind==='element8'){
    const gx=Math.floor(p.x/8),gy=Math.floor(p.y/8);for(const output of selectedTile.outputs||[])targetStore.paintTile(gx,gy,{layer:output.layer,sourceMapId:output.sourceMapId,sourceX:output.sourceCell[0],sourceY:output.sourceCell[1],sourceLayer:output.sourceLayer});return true;
  }
  if(selectedTile.kind!=='cell16'){
    const gx=Math.floor(p.x/8),gy=Math.floor(p.y/8),layer=selectedTile.targetLayer||selectedTile.sourceLayer||selectedLayerPlane();
    targetStore.paintTile(gx,gy,{layer,sourceMapId:selectedTile.sourceMapId,sourceX:selectedTile.x,sourceY:selectedTile.y,sourceLayer:selectedTile.sourceLayer});return true;
  }
  const tx=Math.floor(p.x/16),ty=Math.floor(p.y/16),[sx,sy]=selectedTile.cell,info=rawCellInfo(selectedTile.sourceMapId).cells.get(`${sx},${sy}`);if(!info)return false;
  for(const plane of ['B','A'])for(let qy=0;qy<2;qy++)for(let qx=0;qx<2;qx++){
    const targetGx=tx*2+qx,targetGy=ty*2+qy,has=plane==='A'?info.hasA:info.hasB;
    if(has)targetStore.paintTile(targetGx,targetGy,{layer:plane,sourceMapId:selectedTile.sourceMapId,sourceX:sx*2+qx,sourceY:sy*2+qy,sourceLayer:plane});
    else targetStore.paintTile(targetGx,targetGy,{layer:plane,operation:'clear'});
  }
  return true;
}

function ensureSmartScissorsMatcher(){
  if(!smartScissorsMatcher)smartScissorsMatcher=new SmartScissorsMatcher({mapDecoder:resources.mapDecoder,rooms:resources.manifest.rooms,resolvedRooms:resources.resolvedLevels?.rooms||[]});
  return smartScissorsMatcher;
}
function smartScissorsBoundsArray(bounds){return [Number(bounds.x),Number(bounds.y),Number(bounds.width),Number(bounds.height)]}
function smartScissorsGridLabel(bounds){return `g8:${bounds.x/8}:${bounds.y/8} · ${bounds.width/8}×${bounds.height/8}`}
function smartScissorsRectContains(bounds,gx,gy){return gx*8>=bounds.x&&gy*8>=bounds.y&&gx*8<bounds.x+bounds.width&&gy*8<bounds.y+bounds.height}
function smartScissorsPlaneLabel(planes){const normalized=(planes||['B','A']).map(plane=>String(plane).toUpperCase());return normalized.length===1?`Plane ${normalized[0]}`:'Planes A+B'}
function smartScissorsUnionBounds(rects,pad=16){
  const rows=(rects||[]).filter(Boolean);if(!rows.length)return null;const d=docBounds(),x0=Math.max(0,Math.min(...rows.map(r=>r.x))-pad),y0=Math.max(0,Math.min(...rows.map(r=>r.y))-pad),x1=Math.min(d.width,Math.max(...rows.map(r=>r.x+r.width))+pad),y1=Math.min(d.height,Math.max(...rows.map(r=>r.y+r.height))+pad);return{x:x0,y:y0,width:Math.max(1,x1-x0),height:Math.max(1,y1-y0)};
}
function selectedSmartScissorsSeed(bounds,point){
  if(selectedTile?.kind!=='raw8'||!point)return null;const target=[Math.floor(point.x/8),Math.floor(point.y/8)];if(!smartScissorsRectContains(bounds,target[0],target[1]))return null;return Object.freeze({target:Object.freeze(target),sourceMapId:Number(selectedTile.sourceMapId),source:Object.freeze([Number(selectedTile.x),Number(selectedTile.y)]),plane:String(selectedTile.sourceLayer||selectedLayerPlane()).toUpperCase()});
}
function smartScissorsPatchPlanes(patch){const planes=new Set();for(const value of [patch?.layer,patch?.clearLayer]){const plane=String(value||'').toUpperCase();if(plane==='A'||plane==='B')planes.add(plane)}for(const tile of patch?.tiles||[]){const plane=String(tile?.plane||'').toUpperCase();if(plane==='A'||plane==='B')planes.add(plane)}return planes;}
function smartScissorsOverlaps(rects,{planes=null}={}){
  const selected=planes?.length?new Set(planes.map(plane=>String(plane).toUpperCase())):null,byId=new Map();for(const bounds of rects||[])for(const patch of intersectingReviewedVisualPatches(resources.reviewedMapVisualPatches,{submap:store.document.base.submap,mapId:store.document.base.mapId,bounds:smartScissorsBoundsArray(bounds)}).filter(canRetractReviewedSystemPatch)){if(selected){const patchPlanes=smartScissorsPatchPlanes(patch);if(!patchPlanes.size||[...patchPlanes].some(plane=>!selected.has(plane)))continue;}byId.set(String(patch.id),patch)}return [...byId.values()];
}
function smartScissorsSubCandidate(candidate,targetBounds,containerBounds){
  const dx=targetBounds.x-containerBounds.x,dy=targetBounds.y-containerBounds.y,[sx,sy]=candidate.sourceBounds.map(Number),sourceBounds=[sx+dx,sy+dy,targetBounds.width,targetBounds.height];return{...candidate,targetBounds:smartScissorsBoundsArray(targetBounds),sourceBounds,sourceG8:[sourceBounds[0]/8,sourceBounds[1]/8,sourceBounds[2]/8,sourceBounds[3]/8]};
}
function smartScissorsRowsForSession(session,candidate){
  if(session.kind==='repair')return smartScissorsTilePlan(candidate,{targetBounds:smartScissorsBoundsArray(session.bounds),mapDecoder:resources.mapDecoder}).rows;
  const source=session.sourceBounds,destination=session.destinationBounds,currentMapId=Number(store.document.base.mapId),rows=[...smartScissorsPastePlan(source,destination,{mapId:currentMapId,group:room.group,mapDecoder:resources.mapDecoder,planes:session.kind==='paste'?session.planes:null}).rows];
  if(session.kind==='paste')return rows;
  const repairs=Array.isArray(candidate?.repairs)&&candidate.repairs.length?candidate.repairs:session.voidRects.map(voidRect=>smartScissorsSubCandidate(candidate,voidRect,source));for(const repair of repairs)rows.push(...smartScissorsTilePlan(repair,{mapDecoder:resources.mapDecoder}).rows);
  return rows;
}
function smartScissorsAffectedRects(session){if(session.kind==='move')return[session.sourceBounds,session.destinationBounds];if(session.kind==='paste')return[session.destinationBounds];return[session.bounds]}
function smartScissorsPreviewRects(session){return session.kind==='repair'?[session.bounds]:[session.sourceBounds,session.destinationBounds]}
function applySmartScissorsRowsToDocument(d,session,candidate){
  const affected=smartScissorsAffectedRects(session),rows=smartScissorsRowsForSession(session,candidate);d.tiles=smartScissorsRetainUnaffectedTileRows(d.tiles,affected,rows);
  const removalIds=new Set((d.systemPatchRemovals||[]).map(row=>String(row.patchId||'')));for(const patch of session.overlaps||[])if(!removalIds.has(String(patch.id))){d.systemPatchRemovals.push(createSystemPatchRemoval(patch));removalIds.add(String(patch.id))}
  const temp=new LevelDocumentStore(d);for(const row of rows)temp.paintTile(row.target[0],row.target[1],{layer:row.layer,operation:row.operation,sourceMapId:row.sourceMapId,sourceX:row.source?.[0],sourceY:row.source?.[1],sourceLayer:row.sourceLayer,smartScissors:row.smartScissors});d.tiles=temp.document.tiles;return rows;
}
function smartScissorsLayerCanvas(buffer){const canvas=document.createElement('canvas');canvas.width=buffer.width;canvas.height=buffer.height;canvas.getContext('2d').putImageData(new ImageData(buffer.data,buffer.width,buffer.height),0,0);return canvas}
function smartScissorsPostEditCanvas(session,candidate){
  const previewDocument=deepClone(store.document);applySmartScissorsRowsToDocument(previewDocument,session,candidate);configureRenderer();const renderer=resources.preview,restore=effectiveTileOverrides(store.document),crop=smartScissorsUnionBounds(smartScissorsPreviewRects(session),16);if(!crop)return null;
  let layers=null,dynamic=null;try{renderer.setMapCellOverrides(effectiveTileOverrides(previewDocument));const phase=renderer.staticPhaseAtTick(effectivePreviewTick());layers=renderer.staticLayers(phase);dynamic=renderer.dynamicFrame(effectivePreviewTick());}finally{renderer.setMapCellOverrides(restore)}
  const canvas=document.createElement('canvas');canvas.width=crop.width;canvas.height=crop.height;const c=canvas.getContext('2d');c.imageSmoothingEnabled=false;const ordered=[layers.backdrop||layers.background,dynamic?.behindMidgroundPixels,layers.midground||layers.foregroundBehindActors,dynamic?.pixels,layers.foreground,dynamic?.frontPixels].filter(Boolean);for(const buffer of ordered){const layerCanvas=smartScissorsLayerCanvas(buffer);c.drawImage(layerCanvas,crop.x,crop.y,crop.width,crop.height,0,0,crop.width,crop.height)}
  c.save();c.lineWidth=1;c.setLineDash([3,2]);if(session.kind!=='repair'){c.strokeStyle='#70ddd5';c.strokeRect(session.sourceBounds.x-crop.x+.5,session.sourceBounds.y-crop.y+.5,session.sourceBounds.width-1,session.sourceBounds.height-1);c.strokeStyle='#8cdb92';c.strokeRect(session.destinationBounds.x-crop.x+.5,session.destinationBounds.y-crop.y+.5,session.destinationBounds.width-1,session.destinationBounds.height-1);if(session.kind==='move'){c.strokeStyle='#f0bd68';c.setLineDash([2,2]);for(const row of session.voidRects)c.strokeRect(row.x-crop.x+.5,row.y-crop.y+.5,row.width-1,row.height-1);}}else{c.strokeStyle='#70ddd5';c.strokeRect(session.bounds.x-crop.x+.5,session.bounds.y-crop.y+.5,session.bounds.width-1,session.bounds.height-1)}c.restore();return canvas;
}
function rankSmartScissorsSession(session){
  const matcher=ensureSmartScissorsMatcher(),common={targetMapId:Number(store.document.base.mapId),group:room.group,maxCandidates:8};if(session.kind==='move')return [...matcher.rankMove({...common,sourceBounds:session.sourceBounds,destinationBounds:session.destinationBounds,voidRects:session.voidRects,excludeMarginCells:1,targetOverrides:session.targetOverrides})];return [...matcher.rank({...common,targetBounds:session.bounds,seed:session.useSeed?session.seed:null})];
}
function renderSmartScissorsDialog(){
  const session=smartScissorsSession;if(!session||!ui.smart_scissors_options)return;const candidates=session.candidates||[],move=session.kind==='move',paste=session.kind==='paste',transfer=move||paste;
  if(ui.smart_scissors_seed_control)ui.smart_scissors_seed_control.hidden=transfer;if(ui.smart_scissors_seed_toggle){ui.smart_scissors_seed_toggle.disabled=transfer||!session.seed;ui.smart_scissors_seed_toggle.checked=!transfer&&!!session.seed&&session.useSeed}if(ui.smart_scissors_seed_label&&!transfer)ui.smart_scissors_seed_label.textContent=session.seed?`Anchor ${session.seed.plane} ${md(session.seed.sourceMapId)} g8 ${session.seed.source[0]},${session.seed.source[1]} at target g8 ${session.seed.target[0]},${session.seed.target[1]}`:'Select one raw 8×8 tile before using Scissors to anchor the suggestion';
  if(move){const voidCells=session.voidRects.reduce((sum,row)=>sum+(row.width/8)*(row.height/8),0);ui.smart_scissors_summary.textContent=`Cut + Move · ${smartScissorsGridLabel(session.sourceBounds)} → g8:${session.destinationBounds.x/8}:${session.destinationBounds.y/8} · ${voidCells} vacated cell${voidCells===1?'':'s'} inferred from the post-move surroundings.`;ui.smart_scissors_apply.textContent='Apply move';}
  else if(paste){ui.smart_scissors_summary.textContent=`Cut + Paste · ${smartScissorsPlaneLabel(session.planes)} · ${smartScissorsGridLabel(session.sourceBounds)} → g8:${session.destinationBounds.x/8}:${session.destinationBounds.y/8} · source tiles stay unchanged; the other raw plane at the destination is preserved.`;ui.smart_scissors_apply.textContent='Apply paste';}
  else{const seedText=session.seed&&session.useSeed?` Raw ${session.seed.plane} seed is required.`:'';ui.smart_scissors_summary.textContent=`${smartScissorsGridLabel(session.bounds)} · ${candidates.length} post-edit option${candidates.length===1?'':'s'} from ${room.group}.${seedText} ${session.overlaps.length?`${session.overlaps.length} overlapping reviewed visual patch${session.overlaps.length===1?'':'es'} will be replaced.`:'No existing reviewed visual patches overlap the selection.'}`;ui.smart_scissors_apply.textContent='Apply donor';}
  ui.smart_scissors_options.innerHTML=candidates.map((row,index)=>{const repairs=move?(row.repairs||[]):[],first=repairs[0]||row,donorLabel=paste?`Exact source copy · ${md(first.mapId)} · ${sm(first.submap)}`:move&&repairs.length>1?`${repairs.length} contextual donors`:`${md(first.mapId)} · ${sm(first.submap)}`,sourceLabel=paste?`source g8 ${first.sourceG8[0]},${first.sourceG8[1]} · ${first.sourceG8[2]}×${first.sourceG8[3]} · ${smartScissorsPlaneLabel(session.planes)}`:move&&repairs.length>1?repairs.map(r=>`${md(r.mapId)} g8 ${r.sourceG8[0]},${r.sourceG8[1]} ${r.sourceG8[2]}×${r.sourceG8[3]}`).join(' · '):`donor g8 ${first.sourceG8[0]},${first.sourceG8[1]} · ${first.sourceG8[2]}×${first.sourceG8[3]}${first.sameMap?' · same room':' · same level theme'}`,motif=move?(row.foregroundCells?`${row.foregroundCells} foreground cell${row.foregroundCells===1?'':'s'}`:'empty foreground'):'',motifLabel=move?(row.foregroundCells?'foreground motif':'empty foreground'):'';return `<button type="button" class="smart-scissors-candidate ${index===session.selectedIndex?'selected':''}" data-smart-scissors-candidate="${index}"><span class="smart-scissors-preview" data-smart-scissors-preview="${index}"></span><span><strong>${paste?'':index===0?'Recommended · ':''}${move?`${motifLabel} · `:''}${donorLabel}</strong><small>${sourceLabel}</small>${paste?'<small>Source footprint remains untouched; only the selected raw plane is replaced at the destination.</small>':`<small>score ${row.score.toFixed(2)} · seams ${row.seamScore.toFixed(2)} · context ${row.contextScore.toFixed(2)}${move?` · ${motif}`:''}</small>`}${paste?'<b>post-paste scenery preview</b>':move&&row.supportCount>1?`<small>${row.supportCount} matching exemplar${row.supportCount===1?'':'s'} · deduplicated result</small>`:row.specialPenalty?`<small>semantic penalty ${row.specialPenalty.toFixed(0)}</small>`:'<b>post-edit scenery preview</b>'}</span></button>`}).join('');
  requestAnimationFrame(()=>{for(const host of ui.smart_scissors_options.querySelectorAll('[data-smart-scissors-preview]')){const row=candidates[Number(host.dataset.smartScissorsPreview)],canvas=row?smartScissorsPostEditCanvas(session,row):null;if(canvas)host.replaceChildren(canvas)}});ui.smart_scissors_apply.disabled=!candidates.length;
}
function openSmartScissors(bounds,{seedPoint=null}={}){
  if(!bounds)return;try{const seed=selectedSmartScissorsSeed(bounds,seedPoint),overlaps=smartScissorsOverlaps([bounds]);smartScissorsSession={kind:'repair',bounds,seed,useSeed:!!seed,candidates:[],selectedIndex:0,overlaps};smartScissorsSession.candidates=rankSmartScissorsSession(smartScissorsSession);renderSmartScissorsDialog();ui.smart_scissors_dialog.showModal();}catch(error){toast(error.message,'error',5200)}
}
function smartScissorsMovedBounds(source,start,current){
  const d=docBounds(),rawDx=Math.round((current.x-start.x)/8)*8,rawDy=Math.round((current.y-start.y)/8)*8,x=clamp(source.x+rawDx,0,Math.max(0,d.width-source.width)),y=clamp(source.y+rawDy,0,Math.max(0,d.height-source.height));return{x,y,width:source.width,height:source.height};
}
function openSmartScissorsMove(sourceBounds,destinationBounds){
  if(!sourceBounds||!destinationBounds||(sourceBounds.x===destinationBounds.x&&sourceBounds.y===destinationBounds.y)){toast('Drag the selected cut to a different 8×8 cell position.','warn');return}
  try{const voidRects=[...smartScissorsVoidRects(sourceBounds,destinationBounds)],targetOverrides=smartScissorsMoveTargetOverrides(sourceBounds,destinationBounds,{mapId:Number(store.document.base.mapId)}),overlaps=smartScissorsOverlaps([sourceBounds,destinationBounds]);smartScissorsSession={kind:'move',bounds:sourceBounds,sourceBounds,destinationBounds,voidRects,targetOverrides,seed:null,useSeed:false,candidates:[],selectedIndex:0,overlaps};smartScissorsSession.candidates=rankSmartScissorsSession(smartScissorsSession);renderSmartScissorsDialog();ui.smart_scissors_dialog.showModal();}catch(error){toast(error.message,'error',5200)}
}
function openSmartScissorsPaste(sourceBounds,destinationBounds){
  if(!sourceBounds||!destinationBounds||(sourceBounds.x===destinationBounds.x&&sourceBounds.y===destinationBounds.y)){toast('Drag the selected cut to a different 8×8 cell position.','warn');return}
  try{const mapId=Number(store.document.base.mapId),planes=(sourceBounds.planes?.length?sourceBounds.planes:smartScissorsTransferPlanesForPresentation(depthPreviewMode)).map(String),source=smartScissorsBoundsArray(sourceBounds),destination=smartScissorsBoundsArray(destinationBounds),candidate={mapId,submap:Number(room.submap),group:String(room.group||''),sameMap:true,sourceBounds:source,targetBounds:destination,sourceG8:[sourceBounds.x/8,sourceBounds.y/8,sourceBounds.width/8,sourceBounds.height/8],score:0,seamScore:0,contextScore:0,specialPenalty:0};smartScissorsPastePlan(sourceBounds,destinationBounds,{mapId,group:room.group,mapDecoder:resources.mapDecoder,planes});smartScissorsSession={kind:'paste',bounds:sourceBounds,sourceBounds,destinationBounds,planes,seed:null,useSeed:false,candidates:[candidate],selectedIndex:0,overlaps:smartScissorsOverlaps([destinationBounds],{planes})};renderSmartScissorsDialog();ui.smart_scissors_dialog.showModal();}catch(error){toast(error.message,'error',5200)}
}
function applySmartScissors(){
  const session=smartScissorsSession,candidate=session?.candidates?.[session.selectedIndex];if(!session||!candidate)return;const action=session.kind==='move'?'smart-scissors-cut-move':session.kind==='paste'?'smart-scissors-cut-paste':'smart-scissors';store.transact(action,d=>{applySmartScissorsRowsToDocument(d,session,candidate)});ui.smart_scissors_dialog.close();smartScissorsSession=null;if(session.kind!=='repair')smartScissorsTransferSelection=null;rendererAuthorityKey='';scheduleRender();renderInspector();if(session.kind==='move')toast(`Cut + Move pasted ${session.sourceBounds.width/8}×${session.sourceBounds.height/8} cells and context-filled ${session.voidRects.reduce((sum,row)=>sum+(row.width/8)*(row.height/8),0)} vacated cell${session.voidRects.reduce((sum,row)=>sum+(row.width/8)*(row.height/8),0)===1?'':'s'}.`,'ok',4800);else if(session.kind==='paste')toast(`Cut + Paste copied ${smartScissorsPlaneLabel(session.planes)} across ${session.sourceBounds.width/8}×${session.sourceBounds.height/8} cells without changing the source or destination's other raw plane.`,'ok',4400);else toast(`Smart Scissors applied the full post-edit ${session.bounds.width/8}×${session.bounds.height/8} preview from ${md(candidate.mapId)} g8:${candidate.sourceG8[0]}:${candidate.sourceG8[1]}.`,'ok',4200);
}

function sourceEntityRows(){return classicRoom(store.document.base.submap)?.entities||[];}
/* A source mark's controller remains Classic-owned, but its selected editor
 * artwork comes from the matching Layer-E resolved presentation when present.
 * Do not infer this from the current native audit: SM05 mark 55's controller
 * reports PN 18 while Layer E deliberately presents PN 66 on that path. */
function sourceLayerEPresentationForMark(mark){
  const key=`mark:${Number(mark)}`,room=productionRoom(),rows=[...(room?.actors||[]),...(room?.children||[])],direct=rows.find(row=>String(row?.sourceKey||'')===key&&((Number(row?.assetFlags||0)&0x08)===0));
  if(direct)return direct;
  return rows.find(row=>String(row?.parentSourceKey||'')===key&&((Number(row?.assetFlags||0)&0x08)===0))||null;
}
function reviewedSceneryRows(){
  if(!store||!resources)return [];
  const d=store.document;
  const resolved=(productionRoom()?.actors||[]).filter(row=>(Number(row?.assetFlags||0)&0x08)!==0||Number(row?.visualKind||0)===1).map(row=>({
    id:`resolved:${String(row.semanticId||row.sourceKey||'scenery')}`,
    sourceKey:String(row.sourceKey||''),pn:Number(row.pn??-1),actorId:Number(row.actorId||0),
    origin:Array.isArray(row.origin)?row.origin.map(Number):[0,0],mirrorX:!!row.mirrorX,mirrorY:!!row.mirrorY,front:!!row.front,
    role:'scenery',category:'scenery',authority:'layer-e-semantic-presentation'
  }));
  const sourceKeys=new Set(resolved.map(row=>row.sourceKey));
  const legacy=(resources.reviewedMapVisualPatches||[]).filter(row=>row?.action==='overlay-pn'&&Number(row.submap)===Number(d.base.submap)&&Number(row.mapId)===Number(d.base.mapId)&&!sourceKeys.has(String(row.sourceKey||'')));
  return [...resolved,...legacy];
}
function reviewedVisualPatchById(patchId){return resources?.reviewedMapVisualPatches?.find(row=>String(row?.id||'')===String(patchId||''))||null;}
function reviewedVisualPatchForDiagnostic(row){
  if(!row||row.traceCollection!=='reviewedMapVisualPatches')return null;
  const debugId=String(row.debugId||'');
  for(const patch of resources?.reviewedMapVisualPatches||[])if(debugId===`system-visual:${patch.id}`||debugId===`terrain-hazard:${patch.id}`)return patch;
  return null;
}
function systemPatchRemovalForPatch(patch){return patch?systemPatchRemovalFor(store?.document,patch.id):null;}
function isReviewedScenerySelectable(row){return reviewedSceneryRows().some(p=>String(p.sourceKey||`map-visual:${p.id}`)===String(row?.sourceKey));}
function effectiveScenery(row){
  return {sourceKey:String(row.sourceKey||`map-visual:${row.id}`),patchId:String(row.id||''),basePn:Number(row.pn),baseActorId:Number(row.actorId||0),baseOrigin:(row.origin||[0,0]).map(Number),pn:Number(row.pn),actorId:Number(row.actorId||0),origin:(row.origin||[0,0]).map(Number),mirrorX:!!row.mirrorX,mirrorY:!!row.mirrorY,front:!!row.front,frameIndex:-1,enabled:true,role:String(row.role||'scenery'),category:String(row.category||row.role||'scenery')};
}
function reviewedScenerySpecialCaseNote(row){
  const patchId=String(row?.id||row?.patchId||'');
  if(patchId==='md0021-sm11-stick-slot-3-25')return 'Special case: the aligned Classic cue lands inside the moving-platform trigger volume, but the reviewed Layer-F host is the empty black 16×16 box at g8 6,24. This reviewed patch adds PN20 there; the adjacent sandstone is a user-reviewed Smart Scissors blend so the slot connects cleanly into the wall.';
  if(patchId==='md0034-sm1b-castle-stick-slot')return 'Castle special case: Layer C still proves the stick cue, while Layer F lost the slot artwork. PN118 is added back on the reviewed host at g8 16,14 so the final room visibly retains the cue.';
  if(patchId==='md0013-sm09-stick-slot-19-53'||patchId==='md0022-sm12-stick-slot-19-53')return 'This stick cue uses the actual reviewed masonry slot artwork (PN20) rather than a synthetic black overlay, because the Revival host is a replaceable brick face.';
  return '';
}
function sourceOverride(mark){return store.document.sourceEntityOverrides.find(x=>Number(x.mark)===Number(mark))||null;}
function sourcePlacement(mark,document=store?.document){return sourcePlacementOffset(document?.sourceEntityOverrides?.find(x=>Number(x.mark)===Number(mark)));}
function ensureSourceOverrideInDocument(d,mark){const m=Number(mark);let row=d.sourceEntityOverrides.find(x=>Number(x.mark)===m);if(!row){row={mark:m,suppressed:false};d.sourceEntityOverrides.push(row)}return row;}
function pruneSourceOverrideInDocument(d,row){if(!sourceOverrideHasAuthoredChange(row))d.sourceEntityOverrides=d.sourceEntityOverrides.filter(x=>x!==row);}
function setSourcePlacementInDocument(d,mark,dx,dy){const row=ensureSourceOverrideInDocument(d,mark),x=Math.round(Number(dx)||0),y=Math.round(Number(dy)||0);if(x)row.placementDx=x;else delete row.placementDx;if(y)row.placementDy=y;else delete row.placementDy;pruneSourceOverrideInDocument(d,row);}
function sourceEnemyAuthoring(mark,document=store?.document){
  const source=sourceEntityRows().find(row=>Number(row.mark)===Number(mark));if(!source||!isClassicEnemyEntity(source.entity))return null;
  const semantic=resolvedSemanticForMark(mark),override=document?.sourceEntityOverrides?.find(row=>Number(row.mark)===Number(mark))||null,effectiveEntity=effectiveEnemyEntity(source,override),parts=enemyControllerParts(effectiveEntity),sourceKind=sourceRdxEnemyKind(semantic,resources?.spriteAnims),kinds=enemyKindsForLevel({spriteAnims:resources?.spriteAnims,resolvedLevels:resources?.resolvedLevels,manifest:resources?.manifest,submap:document?.base?.submap}),kind=effectiveEnemyKind({semantic,override,spriteAnims:resources?.spriteAnims});
  const patrol=sourceEnemyPatrol(source,override,semantic)||(parts?.typeId==='bounded-patrol'?defaultEnemyPatrolForSource({source,classicData:resources?.classic,manifest:resources?.manifest,submap:document?.base?.submap,kindBaseEntity:parts?.kindBaseEntity}):null);
  return {source,semantic,override,effectiveEntity,parts,type:enemyTypeForEntity(effectiveEntity),sourceKind,kind,kinds,patrol};
}
function selectedSourceEnemyPatrolGeometry(document=store?.document){
  const selected=selection.find(item=>item.kind==='source'&&String(item.id||'').startsWith('mark:'));if(!selected)return null;
  const mark=Number(String(selected.id).replace('mark:','')),model=sourceEnemyAuthoring(mark,document);
  if(!model||model.type?.id!=='bounded-patrol'||!model.patrol)return null;
  const geometry=enemyPatrolEditorGeometry({source:model.source,semantic:model.semantic,override:model.override});
  return geometry?{...geometry,mark,model}:null;
}
function sourceEnemyPatrolHandleAt(point){
  const geometry=selectedSourceEnemyPatrolGeometry();if(!geometry)return null;const tolerance=8,top=Number(geometry.sweepBounds?.y ?? (Number(geometry.left[1])-8)),bottom=top+Number(geometry.sweepBounds?.height ?? 16);
  for(const edge of ['left','right']){const p=geometry[edge],px=Number(p[0]);if(Math.abs(Number(point.x)-px)<=tolerance&&Number(point.y)>=top-6&&Number(point.y)<=bottom+6)return {mark:geometry.mark,edge,geometry};}
  return null;
}
function drawSelectedSourceEnemyPatrol(c){
  const g=selectedSourceEnemyPatrolGeometry();if(!g)return;
  drawEditorDiagnosticRows(c,[g.overlayRow],'',{showTrajectories:true});
  const top=Number(g.sweepBounds?.y ?? 0),bottom=top+Number(g.sweepBounds?.height ?? 0);
  c.save();
  for(const edge of ['left','right']){
    const x=Math.round(Number(g[edge][0]))+0.5,active=gesture?.type==='enemy-patrol-resize'&&gesture.edge===edge&&Number(gesture.mark)===Number(g.mark);
    c.strokeStyle=active?'rgba(212,255,228,.98)':'rgba(8,18,24,.9)';
    c.lineWidth=active?2:1.5;
    c.beginPath();c.moveTo(x,top-0.5);c.lineTo(x,bottom+0.5);c.stroke();
    c.strokeStyle=active?'rgba(120,255,176,.98)':'rgba(112,221,213,.98)';
    c.lineWidth=1;
    c.beginPath();c.moveTo(x,top+1);c.lineTo(x,bottom-1);c.stroke();
    c.fillStyle=active?'rgba(212,255,228,.98)':'rgba(217,255,251,.96)';
    c.fillRect(x-2,top-2,4,2);c.fillRect(x-2,bottom,4,2);
  }
  c.restore();
}
function applyDraftEnemyKindsToSimulationStates(states){
  const out=new Map(states||[]);for(const row of store?.document?.sourceEntityOverrides||[]){if(!row.enemyKindSetId)continue;const key=`mark:${Number(row.mark)}`,state=out.get(key);if(!state)continue;out.set(key,applyEnemyKindToSimulationState({state,override:row,spriteAnims:resources?.spriteAnims}));}return out;
}
function setSourceEnemyEntityInDocument(d,mark,entityN){const source=sourceEntityRows().find(row=>Number(row.mark)===Number(mark));if(!source)return;const row=ensureSourceOverrideInDocument(d,mark),next=Number(entityN);if(next===Number(source.entity))delete row.controllerEntity;else row.controllerEntity=next;const type=enemyTypeForEntity(next);if(type?.id!=='bounded-patrol')delete row.patrol;else if(!normalizeEnemyPatrol(row.patrol)&&!normalizeEnemyPatrol(source?.controller?.patrol))row.patrol=defaultEnemyPatrolForSource({source,classicData:resources?.classic,manifest:resources?.manifest,submap:d.base.submap,kindBaseEntity:enemyControllerParts(next)?.kindBaseEntity});pruneSourceOverrideInDocument(d,row);}
function setSourceEnemyPatrolInDocument(d,mark,patrol){const row=ensureSourceOverrideInDocument(d,mark),normalized=normalizeEnemyPatrol(patrol);if(normalized)row.patrol=normalized;else delete row.patrol;pruneSourceOverrideInDocument(d,row);}
function setSourceEnemyKindInDocument(d,mark,setId){
  const semantic=resolvedSemanticForMark(mark),sourceKind=sourceRdxEnemyKind(semantic,resources?.spriteAnims),canonicalKind=effectiveEnemyKind({semantic,override:null,spriteAnims:resources?.spriteAnims});if(!semantic||!sourceKind||!canonicalKind)return;
  const row=ensureSourceOverrideInDocument(d,mark),sourceKey=String(semantic?.sources?.rdx?.sourceKey||`mark:${Number(mark)}`),sourcePns=new Set(sourceKind.animations.map(state=>Number(state.pn))),existing=normalizeStatePresentationOverrides(row),preserved=existing.filter(state=>String(state.sourceKey)!==sourceKey||!sourcePns.has(Number(state.sourcePn)));
  if(String(setId)===String(canonicalKind.setId)){delete row.enemyKindSetId;if(preserved.length)row.statePresentationOverrides=preserved;else delete row.statePresentationOverrides;pruneSourceOverrideInDocument(d,row);return;}
  const mapped=enemyKindStateOverrides({semantic,targetSetId:setId,spriteAnims:resources?.spriteAnims,existing});if(!mapped.length)return;
  row.enemyKindSetId=String(setId);row.statePresentationOverrides=[...preserved,...mapped];pruneSourceOverrideInDocument(d,row);
}
function revertSourceEnemyAuthoringInDocument(d,mark){const row=d.sourceEntityOverrides.find(candidate=>Number(candidate.mark)===Number(mark));if(!row)return;const semantic=resolvedSemanticForMark(mark),sourceKind=sourceRdxEnemyKind(semantic,resources?.spriteAnims),sourceKey=String(semantic?.sources?.rdx?.sourceKey||`mark:${Number(mark)}`),sourcePns=new Set((sourceKind?.animations||[]).map(state=>Number(state.pn)));delete row.controllerEntity;delete row.patrol;delete row.enemyKindSetId;if(sourcePns.size){const kept=normalizeStatePresentationOverrides(row).filter(state=>String(state.sourceKey)!==sourceKey||!sourcePns.has(Number(state.sourcePn)));if(kept.length)row.statePresentationOverrides=kept;else delete row.statePresentationOverrides;}pruneSourceOverrideInDocument(d,row);}
function sourceEnemyInspectorHtml(mark){const model=sourceEnemyAuthoring(mark);if(!model)return '';const type=model.type,kinds=model.kinds,currentKind=model.kind,hasDraft=model.override?.controllerEntity!=null||!!model.override?.patrol||!!model.override?.enemyKindSetId,kp=model.patrol,levelLabel=enemyLevelLabel({manifest:resources?.manifest,submap:store.document.base.submap});
  const typeOptions=ENEMY_TYPES.map(row=>`<option value="${row.id}" ${row.id===type?.id?'selected':''}>${escapeHtml(row.label)}</option>`).join(''),kindOptions=kinds.map(row=>`<option value="${escapeHtml(row.setId)}" ${String(row.setId)===String(currentKind?.setId)?'selected':''}>${escapeHtml(row.label)}</option>`).join('');
  const patrolHtml=type?.id==='bounded-patrol'&&kp?`<div class="presentation-subgroup"><div class="presentation-subhead"><span>Bounded patrol</span><small>Layer B · Classic/xrick coordinates</small></div><div class="field-grid">${inspectorField('Start X','enemyPatrolStartX',kp.start[0],'number','step="2"')}${inspectorField('End X','enemyPatrolEndX',kp.end[0],'number','step="2"')}${inspectorField('Y','enemyPatrolY',kp.start[1])}${inspectorField('Startup delay','enemyPatrolLatency',kp.startupLatencyTicks,'number','min="0" max="255"')}</div><p class="property-help">These are the authoritative Classic/xrick patrol bounds. Layer C projects them into RDX; xrick may still reverse earlier when static collision blocks a step. Native step remains 2 px.</p></div>`:'';
  return `<div class="inspector-group enemy-authoring-card"><div class="presentation-heading"><div><h3>Enemy</h3><p>Type is Classic/xrick behavior. Kind is the RDX sprite and directional animation family.</p></div><span class="presentation-pn">TYPE · CLASSIC<br>KIND · RDX</span></div><label>Type<select data-source-enemy-type>${typeOptions}</select></label><label>Kind<select data-source-enemy-kind>${kindOptions}</select></label><div class="inspector-row"><span>RDX source kind</span><span class="value">${model.sourceKind?escapeHtml(model.sourceKind.label):'unresolved'}</span></div><p class="property-help">Kind options are restricted to walking enemy families actually present in the raw ${escapeHtml(levelLabel)} RDX maps. The Castle dog is deliberately excluded because it is trap semantics and belongs in a future Trap Kind selector.</p>${patrolHtml}${hasDraft?'<button type="button" data-action="revert-source-enemy">Use production enemy settings</button>':''}</div>`;
}
function setSourceStateVisualOffsetInDocument(d,mark,pn,dx,dy){const row=ensureSourceOverrideInDocument(d,mark),statePn=Math.round(Number(pn)||0),x=Math.round(Number(dx)||0),y=Math.round(Number(dy)||0),table={...(row.stateVisualOffsetsByPn||{})};if(statePn<0||statePn>254)return;if(x||y)table[statePn]=[x,y];else delete table[statePn];if(Object.keys(table).length)row.stateVisualOffsetsByPn=table;else delete row.stateVisualOffsetsByPn;pruneSourceOverrideInDocument(d,row);}
function setSourceOcclusionInDocument(d,mark,layer){const row=ensureSourceOverrideInDocument(d,mark),next=['behind-midground','normal','front'].includes(String(layer||''))?String(layer):null;if(next)row.occlusionLayer=next;else delete row.occlusionLayer;pruneSourceOverrideInDocument(d,row);}
function sourceSuppressed(mark){return !!store.document.base.blank || !!sourceOverride(mark)?.suppressed;}
function sourcePresentationPn(mark,fallback=-1){
  const value=Number(sourceOverride(mark)?.presentationPn);if(Number.isInteger(value)&&value>=0&&value<255)return value;
  const presentation=sourceLayerEPresentationForMark(mark),pn=Number(presentation?.simulation?.pn??presentation?.pn);
  if(Number.isInteger(pn)&&pn>=0&&pn<255)return pn;
  const live=sourceSelectables.find(row=>String(row?.sourceKey||'')===`mark:${Number(mark)}`&&!/fallback/i.test(String(row?.authority||'')));
  const livePn=Number(live?.pn);
  return Number.isInteger(livePn)&&livePn>=0&&livePn<255?livePn:Number(fallback);
}
function sourceProductionLayer(mark){const semantic=resolvedSemanticForMark(mark),layer=String(semantic?.presentation?.layer||'normal');return ['behind-midground','normal','front'].includes(layer)?layer:'normal';}
function sourceEffectiveLayer(mark){return sourceOcclusionLayer(sourceOverride(mark))||sourceProductionLayer(mark);}
function actorIdNumber(value){if(typeof value==='string'&&/^0x/i.test(value))return Number.parseInt(value,16);return Number(value);}
function sourceAnimationStates(mark){
  const semantic=resolvedSemanticForMark(mark),actorId=Number(semantic?.presentation?.actorId);
  if(!Number.isInteger(actorId)||!resources?.spriteAnims?.sets)return [];
  const set=resources.spriteAnims.sets.find(row=>(row.actorIds||[]).some(value=>actorIdNumber(value)===actorId));
  return Array.isArray(set?.animations)?set.animations:[];
}
function sourcePresentationStates(mark){const semantic=resolvedSemanticForMark(mark);return semanticPresentationStates(semantic,{animationStates:sourceAnimationStates(mark)});}
function statePresentationIdentity(state,semantic=null){return semantic?statefulPresentationStateIdentity(semantic,state):`${String(state?.sourceKey||'')}|${String(state?.stateKey||'')}|${Number(state?.sourcePn)}`;}
function sourcePresentationState(mark,sourceKey,stateKey,sourcePn){return sourcePresentationStates(mark).find(row=>String(row.sourceKey)===String(sourceKey)&&String(row.stateKey)===String(stateKey)&&Number(row.sourcePn)===Number(sourcePn))||null;}
function setSourceStatePresentationInDocument(d,mark,state,{pn=null,origin=null}={}){
  if(!state)return;
  const semantic=resolvedSemanticForMark(mark),row=ensureSourceOverrideInDocument(d,mark),canonical=effectiveStatePresentation(semantic,null,state),current=effectiveStatePresentation(semantic,row,state);
  const targetPn=pn!=null&&Number.isInteger(Number(pn))?Number(pn):Number(current.pn),targetOrigin=Array.isArray(origin)?origin.map(Number):current.origin.slice();
  const offset=[Math.round(Number(targetOrigin[0])-Number(canonical.origin[0])),Math.round(Number(targetOrigin[1])-Number(canonical.origin[1]))];
  const rows=normalizeStatePresentationOverrides(row).filter(item=>!statePresentationDraftMatches(item,state));
  if(targetPn!==Number(canonical.pn)||offset[0]||offset[1])rows.push({sourceKey:String(state.sourceKey),stateKey:String(state.stateKey),sourcePn:Number(state.sourcePn),...(targetPn!==Number(canonical.pn)?{pn:targetPn}:{}),...(offset[0]||offset[1]?{offset}:{})});
  if(rows.length)row.statePresentationOverrides=rows;else delete row.statePresentationOverrides;
  if(row.stateVisualOffsetsByPn){delete row.stateVisualOffsetsByPn[String(state.sourcePn)];delete row.stateVisualOffsetsByPn[Number(state.sourcePn)];if(!Object.keys(row.stateVisualOffsetsByPn).length)delete row.stateVisualOffsetsByPn;}
  pruneSourceOverrideInDocument(d,row);
}
function revertSourceStatePresentationInDocument(d,mark,state){
  const row=d.sourceEntityOverrides.find(x=>Number(x.mark)===Number(mark));if(!row||!state)return;
  const rows=normalizeStatePresentationOverrides(row).filter(item=>!statePresentationDraftMatches(item,state));
  if(rows.length)row.statePresentationOverrides=rows;else delete row.statePresentationOverrides;
  if(row.stateVisualOffsetsByPn){delete row.stateVisualOffsetsByPn[String(state.sourcePn)];delete row.stateVisualOffsetsByPn[Number(state.sourcePn)];if(!Object.keys(row.stateVisualOffsetsByPn).length)delete row.stateVisualOffsetsByPn;}
  pruneSourceOverrideInDocument(d,row);
}
function currentStatefulComponentSelectable(sourceKey){
  const dynamic=lastDynamicRenderer===resources?.preview?lastDynamic:null;
  return (dynamic?.selectables||[]).find(row=>row?.port==='rdx'&&String(row.sourceKey||'')===String(sourceKey))||null;
}
function boundsOverlap(a,b){return !!a&&!!b&&a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;}
function sourceStatePresentationInspectorHtml(mark,{activator=false}={}){
  const semantic=resolvedSemanticForMark(mark),rows=sourcePresentationStates(mark);if(rows.length<2)return '';
  const sourceDraft=sourceOverride(mark),components=statefulPresentationComponents(semantic,rows),multiComponent=components.length>1;
  const forcedComponentId=forcedPresentationState&&Number(forcedPresentationState.mark)===Number(mark)?statefulComponentIdentity(semantic,forcedPresentationState.sourceKey):null;
  const currentById=new Map(components.map(component=>[component.id,currentStatefulComponentSelectable(component.sourceKey)]));
  const cards=components.map(component=>{
    const explicitHidden=componentInspection.isHidden(component.id),soloed=componentInspection.isSoloed(component.id),visible=componentInspection.visible(component.id,{forcedId:forcedComponentId}),current=currentById.get(component.id);
    const overlaps=components.filter(other=>other.id!==component.id&&boundsOverlap(current?.bounds,currentById.get(other.id)?.bounds)).map(other=>other.label);
    const status=current?`current PN ${Number(current.pn)}`:(visible?'not present at this preview tick':'hidden');
    const controls=multiComponent?`<div class="component-inspection-actions"><button type="button" data-action="toggle-state-component" data-component-source-key="${escapeHtml(component.sourceKey)}">${explicitHidden?'Show':'Hide'}</button><button type="button" data-action="solo-state-component" data-component-source-key="${escapeHtml(component.sourceKey)}">${soloed?'Unsolo':'Solo'}</button></div>`:'';
    return `<div class="presentation-subgroup" data-component-id="${escapeHtml(component.id)}"><div class="presentation-subhead component-presentation-head"><span>${escapeHtml(component.label)}</span><small>${escapeHtml(component.sourceKey)} · ${escapeHtml(status)}</small></div>${controls}${overlaps.length?`<p class="property-help component-overlap-warning">Visible overlap with ${escapeHtml(overlaps.join(', '))}.</p>`:''}${component.states.map(state=>{const eff=effectiveStatePresentation(semantic,sourceDraft,state),forced=forcedPresentationState&&Number(forcedPresentationState.mark)===Number(mark)&&statePresentationIdentity(forcedPresentationState,semantic)===statePresentationIdentity(state,semantic),recommended=[state.sourcePn,...sourceAnimationStates(mark).map(row=>Number(row.pn)).filter(Number.isInteger)];return `<div class="state-presentation-card" data-state-card="${escapeHtml(statePresentationIdentity(state,semantic))}"><div class="presentation-subhead"><span>${escapeHtml(state.label)}</span><small>source PN ${state.sourcePn} · effective PN ${eff.pn}${eff.authored?' · draft':''}</small></div><div class="sprite-assignment-field"><span class="sprite-field-label">Sprite / animation</span>${pnPickerHtml(eff.pn,recommended,{sourceMark:mark,pickerKind:'source-state',allowUnassigned:false,state})}</div><div class="field-grid"><label>Origin X<input type="number" data-source-state-axis="x" data-state-source-key="${escapeHtml(state.sourceKey)}" data-state-key="${escapeHtml(state.stateKey)}" data-state-source-pn="${state.sourcePn}" value="${Math.round(eff.origin[0])}"></label><label>Origin Y<input type="number" data-source-state-axis="y" data-state-source-key="${escapeHtml(state.sourceKey)}" data-state-key="${escapeHtml(state.stateKey)}" data-state-source-pn="${state.sourcePn}" value="${Math.round(eff.origin[1])}"></label></div><div class="inspector-row"><span>Production origin</span><span class="value">${Math.round(eff.canonicalOrigin[0])}, ${Math.round(eff.canonicalOrigin[1])}${eff.draftOffset[0]||eff.draftOffset[1]?` · Δ ${eff.draftOffset[0]},${eff.draftOffset[1]}`:''}</span></div>${forced?`<p class="property-help state-preview-active">Previewing ${escapeHtml(component.label)} · ${escapeHtml(state.label)} only; sibling components are temporarily isolated.</p>`:''}${state.sharedRuntimeIdentity?'<p class="property-help state-runtime-warning">This lifecycle state shares its native PN identity with another state. Editor preview can pin it independently; native Playtest can only distinguish state-specific overrides when the production runtime exposes a distinct PN.</p>':''}<div class="inspector-actions"><button type="button" data-action="${forced?'resume-state-preview':'preview-source-state'}" data-state-source-key="${escapeHtml(state.sourceKey)}" data-state-key="${escapeHtml(state.stateKey)}" data-state-source-pn="${state.sourcePn}">${forced?'Resume live state':`Preview ${escapeHtml(component.label)} · ${escapeHtml(state.label)}`}</button>${eff.authored?`<button type="button" data-action="revert-source-state" data-state-source-key="${escapeHtml(state.sourceKey)}" data-state-key="${escapeHtml(state.stateKey)}" data-state-source-pn="${state.sourcePn}">Use production state</button>`:''}</div></div>`;}).join('')}</div>`;
  }).join('');
  return `<div class="inspector-group state-presentation-editor"><h3>State presentation <span>${activator?'connected lifecycle':'production states'}</span></h3><p class="property-help">Edit each authored presentation state without changing native lifecycle authority. Preview isolates the selected component so overlapping sibling visuals cannot mask it. ${multiComponent?'Hide/Show and Solo are session-only inspection controls; they immediately affect the canvas and are never exported to Reviewed Fixes. ':''}State sprite/origin drafts still apply to native Playtest and Reviewed Fixes.</p>${cards}</div>`;
}
function sourceOcclusionInspectorHtml(mark){const layer=sourceEffectiveLayer(mark),draft=sourceOcclusionLayer(sourceOverride(mark)),label=layer==='behind-midground'?'Embedded · behind Midground':layer==='front'?'Front · above Foreground':'Normal · above Midground';return `<div class="inspector-group"><h3>Occlusion <span>${draft?'draft':'production'}</span></h3><div class="inspector-row"><span>Actor depth</span><span class="value">${label}</span></div><div class="segmented"><button type="button" class="${layer==='behind-midground'?'active':''}" data-action="source-occlusion-behind">Behind Midground</button><button type="button" class="${layer==='normal'?'active':''}" data-action="source-occlusion-normal">Normal</button><button type="button" class="${layer==='front'?'active':''}" data-action="source-occlusion-front">Front</button></div><p class="property-help">Behind Midground is for sprites embedded in terrain, such as traps. Normal actors cover Midground but remain behind Foreground; Front actors cover Foreground. This changes presentation only, never collision.</p>${draft?'<button type="button" data-action="revert-source-occlusion">Use production occlusion</button>':''}</div>`;}
function resolvedSemanticForMark(mark,room=resolvedRoomFor()){return (room?.layers?.semanticCorpus?.objects||[]).find(row=>Number(row?.sources?.classic?.mark)===Number(mark))||null;}
function nativeAutotileConnects(set,cx,cy){
  const d=store?.document;if(!d||d.base.blank||!set?.nativeNeighborCollision)return false;
  if(set.group&&String(room?.group||'')!==String(set.group))return false;
  const lx=Number(cx)+1,ly=Number(cy)+1,manual=collisionOverrideAt(lx,ly);
  const behavior=manual?.collision||descriptorCollisionBase(lx,ly);
  return behavior===set.nativeNeighborCollision;
}
function nativeAutotileCollisionAt(cx,cy){
  const d=store?.document;if(!d||d.base.blank)return 'pass-through';
  const lx=Number(cx)+1,ly=Number(cy)+1,manual=collisionOverrideAt(lx,ly);
  return manual?.collision||descriptorCollisionBase(lx,ly);
}
function nativeAutotileVisualAt(cx,cy,layer='B'){
  const d=store?.document;if(!d||d.base.blank||!resources)return null;const mapId=Number(d.base.mapId),plane=layer==='A'?'A':'B',dim=resources.mapDecoder.dimensions(mapId),x=Number(cx),y=Number(cy);if(x<0||y<0||x>=dim.cellWidth||y>=dim.cellHeight)return null;const k=`${mapId}:${plane}`,pal=resources.palettes.forMap(mapId).rgba;let buffer=autotileVisualRenderCache.get(k);if(!buffer){buffer=resources.mapDecoder.renderPlane(mapId,pal,{plane,viewport:{x:0,y:0,width:dim.width,height:dim.height}}).pixels;autotileVisualRenderCache.set(k,buffer);}let h=2166136261>>>0;for(let py=0;py<16;py++)for(let px=0;px<16;px++){const off=(((y*16+py)*buffer.width)+(x*16+px))*4;for(let c=0;c<4;c++){h^=buffer.data[off+c]||0;h=Math.imul(h,16777619)>>>0;}}return h.toString(16).padStart(8,'0');
}
function effectiveTileOverrides(document=store.document){
  const d=document, out=[];
  if(d.base.blank){
    const dim=hostDimensions(), gw=Math.ceil(dim.width/8), gh=Math.ceil(dim.height/8);
    for(let gy=0;gy<gh;gy++) for(let gx=0;gx<gw;gx++) for(const layer of ['B','A'])
      out.push({submap:d.base.submap,mapId:d.base.mapId,target:[gx,gy],layer,operation:'clear'});
  }
  if(!d.base.blank)out.push(...systemPatchRestorationOverrides(d,resources.reviewedMapVisualPatches));
  out.push(...resolveTerrainVisualOverrides(d,resources.autotileCatalog,{nativeConnects:nativeAutotileConnects,collisionAt:nativeAutotileCollisionAt,visualAt:nativeAutotileVisualAt}));
  out.push(...resolveStampVisualOverrides(d,resources.stampCatalog));
  for(const t of d.tiles) out.push({submap:d.base.submap,mapId:d.base.mapId,target:t.target,source:t.source,sourceMapId:t.sourceMapId??d.base.mapId,layer:t.layer,sourceLayer:t.sourceLayer||t.layer,operation:t.operation||'copy',authority:'manual'});
  return out;
}
function effectiveCollisionOverrides(){
  const d=store.document,byCell=new Map(),put=row=>byCell.set(`${row.logic[0]},${row.logic[1]}`,row);
  if(d.base.blank){
    const dim=resources.mapDecoder.logicDimensions(d.base.mapId);
    for(let y=0;y<dim.height;y++) for(let x=0;x<dim.width;x++) put({submap:d.base.submap,mapId:d.base.mapId,logic:[x,y],collision:'pass-through',authority:'blank'});
  }
  for(const c of resolveTerrainCollisionOverrides(d,resources.autotileCatalog,{nativeConnects:nativeAutotileConnects,collisionAt:nativeAutotileCollisionAt,visualAt:nativeAutotileVisualAt}))put(c);
  for(const c of d.collision) put({submap:d.base.submap,mapId:d.base.mapId,logic:c.logic,collision:c.collision,authority:'manual'});
  const out=[...byCell.values()];
  for(const c of d.gameplayCollision||[]) out.push({submap:d.base.submap,mapId:d.base.mapId,g8:c.g8,action:c.action,authority:'manual-g8'});
  return out;
}

function configureRenderer(){
  const d=store.document,stage=diagnosticLayerStage(),layerInspection=!!stage;
  const documentAuthorityKey=JSON.stringify([d.base,d.terrain,d.terrainRelations,d.stamps,d.tiles,d.collision,d.gameplayCollision,d.presentationDepthOverrides,d.presentationDepthClassEdits,d.alignmentOverrides,d.sourceEntityOverrides,d.systemPatchRemovals]);
  const authorityKey=JSON.stringify([systemModificationsEnabled,stage,diagnostics.unresolved,documentAuthorityKey,forcedPresentationState,componentInspection.snapshot()]);
  if(authorityKey===rendererAuthorityKey && resources.preview.selection?.submap===Number(d.base.submap) && resources.classicPreview?.selection?.submap===Number(d.base.submap)) return;
  rendererAuthorityKey=authorityKey;
  const configureRdx=(renderer,{systemMods=true,applyDraft=false}={})=>{
    if(!renderer)return;
    renderer.setSystemModificationsEnabled(systemMods);
    renderer.select({submap:d.base.submap,mapId:d.base.mapId,visualSource:'rdx',spriteSource:'rdx',missingPolicy:'red'});
    renderer.setActivateAllTraps(previewMotionEnabled());renderer.clearManualOverrides();
    if(applyDraft){
      for(const e of sourceEntityRows()){
        const o=sourceOverride(e.mark),placement=effectiveSourcePlacementOffset(e.mark,o,{document:d,resolvedRoom:resolvedRoomFor()}),dx=placement.dx,dy=placement.dy,override={authority:'level-editor'},statePresentations=normalizeStatePresentationOverrides(o),layer=sourceOcclusionLayer(o),sourceKeys=[...new Set(sourcePresentationStates(e.mark).map(row=>String(row.sourceKey)))];
        if(!sourceKeys.includes(`mark:${e.mark}`))sourceKeys.unshift(`mark:${e.mark}`);
        if(sourceSuppressed(e.mark))override.visible=false;
        if(Number.isInteger(Number(o?.presentationPn))&&Number(o.presentationPn)>=0&&Number(o.presentationPn)<255)override.pn=Number(o.presentationPn);
        if(o?.projectileShooterPresentation){override.pn=Number(o.projectileShooterPresentation.pn);override.actorId=Number(o.projectileShooterPresentation.actorId);override.x=Number(o.projectileShooterPresentation.origin?.[0]);override.y=Number(o.projectileShooterPresentation.origin?.[1]);}
        if(Array.isArray(o?.projectileEmitterOrigin))override.projectileEmitterOrigin=o.projectileEmitterOrigin.map(Number);
        if(['left','right'].includes(String(o?.projectileLaneDirection||'')))override.projectileLaneDirection=String(o.projectileLaneDirection);
        if(dx)override.translateX=dx;if(dy)override.translateY=dy;if(statePresentations.length)override.statePresentationOverrides=statePresentations;if(layer){override.actorDepth=layer;override.front=layer==='front';}
        const hasBaseOverride=override.visible===false||override.pn!=null||override.actorId!=null||override.x!=null||override.y!=null||dx||dy||override.statePresentationOverrides||layer||override.projectileEmitterOrigin||override.projectileLaneDirection;
        const semantic=resolvedSemanticForMark(e.mark),forcedComponentId=forcedPresentationState&&Number(forcedPresentationState.mark)===Number(e.mark)?statefulComponentIdentity(semantic,forcedPresentationState.sourceKey):null;
        for(const sourceKey of sourceKeys){
          const componentId=statefulComponentIdentity(semantic,sourceKey),inspectionVisible=componentInspection.visible(componentId,{forcedId:forcedComponentId});
          let sourceOverrideValue=hasBaseOverride?{...override}:null;
          if(!inspectionVisible)sourceOverrideValue={...(sourceOverrideValue||{authority:'level-editor-inspection'}),visible:false};
          if(forcedPresentationState&&Number(forcedPresentationState.mark)===Number(e.mark)&&String(forcedPresentationState.sourceKey)===sourceKey){
            const state=sourcePresentationState(e.mark,forcedPresentationState.sourceKey,forcedPresentationState.stateKey,forcedPresentationState.sourcePn),eff=state?effectiveStatePresentation(resolvedSemanticForMark(e.mark),o,state):null;
            if(state&&eff)sourceOverrideValue={...(sourceOverrideValue||{authority:'level-editor'}),pn:eff.pn,x:eff.origin[0]+dx,y:eff.origin[1]+dy,statePresentationOverrides:[]};
          }
          if(sourceOverrideValue)renderer.setManualOverride(`rdx:${sourceKey}`,sourceOverrideValue);
        }
      }
      renderer.setMapCellOverrides(effectiveTileOverrides());renderer.setGeometryOverrides(effectiveCollisionOverrides());renderer.setPresentationDepthClassEdits(d.presentationDepthClassEdits||[]);renderer.setPresentationDepthOverrides(d.presentationDepthOverrides.map(row=>({...row,submap:d.base.submap,mapId:d.base.mapId})));
    }else{renderer.setMapCellOverrides([]);renderer.setGeometryOverrides([]);renderer.setPresentationDepthClassEdits([]);renderer.setPresentationDepthOverrides([]);}
  };
  configureRdx(resources.preview,{systemMods:layerInspection?true:systemModificationsEnabled,applyDraft:!layerInspection});
  configureRdx(resources.previewE,{systemMods:true,applyDraft:false});
  const classicMissingPolicy=diagnostics.active&&diagnostics.unresolved?'red':'hidden';
  resources.classicPreview?.select({submap:d.base.submap,mapId:d.base.mapId,visualSource:'classic',spriteSource:'classic',missingPolicy:classicMissingPolicy});
  resources.classicPreview?.setActivateAllTraps(previewMotionEnabled());
  configureRawPreview();
}
function configureRawPreview(){
  const raw=resources?.rawPreview,d=store?.document;if(!raw||!d)return;
  raw.setSystemModificationsEnabled(false);
  const selected=raw.selection;
  if(Number(selected?.submap)!==Number(d.base.submap)||Number(selected?.mapId)!==Number(d.base.mapId)){
    raw.select({submap:d.base.submap,mapId:d.base.mapId,visualSource:'rdx',spriteSource:'rdx',missingPolicy:'red'});
    raw.clearManualOverrides();raw.setMapCellOverrides([]);raw.setGeometryOverrides([]);raw.setPresentationDepthOverrides([]);
  }
  raw.setActivateAllTraps(previewMotionEnabled());
}
function bufferToCanvas(buffer,context,w=buffer.width,h=buffer.height,offsetX=0,offsetY=0){
  const image=new ImageData(buffer.data,buffer.width,buffer.height);
  context.clearRect(0,0,context.canvas.width,context.canvas.height);
  context.putImageData(image,Math.round(offsetX),Math.round(offsetY),0,0,Math.min(w,buffer.width),Math.min(h,buffer.height));
}
function classicViewOffset(){
  const d=store.document,level=resources.mapping.levelForSubmap(d.base.submap),classic=classicRoom(d.base.submap),preview=classic?.preview||classic;
  const previewYOffset=Math.max(0,(Number(classic?.startRow||0)-Number(preview?.startRow||classic?.startRow||0))*8);
  return {x:Number(level?.pixelOffset?.dxPx||0),y:Number(level?.pixelOffset?.dyPx||0)-previewYOffset};
}
function classicAlignmentOptions(){
  const d=store.document,offset=classicViewOffset();
  return {shiftMap:resources?.cellShiftMap,submap:Number(d.base.submap),targetWidth:docBounds().width,targetHeight:docBounds().height,fallbackOffset:{dxPx:offset.x,dyPx:offset.y}};
}
function classicPresentationFallbackOffset(){
  const level=resources.mapping.levelForSubmap(store.document.base.submap);
  return {dxPx:Number(level?.pixelOffset?.dxPx||0),dyPx:Number(level?.pixelOffset?.dyPx||0)};
}
const CLASSIC_DISCONNECTED_PANEL=[47,52,58,255];
function registeredClassicBuffer(buffer){return projectClassicPreviewBufferToRdx(buffer,{...classicAlignmentOptions(),shiftMap:null});}
function alignedClassicBuffer(buffer,{showDisconnected=false}={}){return projectClassicPreviewBufferToRdx(buffer,{...classicAlignmentOptions(),disconnectedFill:showDisconnected?CLASSIC_DISCONNECTED_PANEL:null});}
function registeredClassicBounds(bounds){const o=classicAlignmentOptions();return classicPresentationBoundsToRdx(null,o.submap,bounds,classicPresentationFallbackOffset());}
function alignedClassicBounds(bounds){const o=classicAlignmentOptions();return classicPresentationBoundsToRdx(o.shiftMap,o.submap,bounds,classicPresentationFallbackOffset());}
function registeredClassicPoint(x,y){const o=classicAlignmentOptions();return classicPresentationPointToRdx(null,o.submap,x,y,classicPresentationFallbackOffset());}
function alignedClassicPoint(x,y){const o=classicAlignmentOptions();return classicPresentationPointToRdx(o.shiftMap,o.submap,x,y,classicPresentationFallbackOffset());}
function projectClassicSelectable(item,projection='dense'){
  if(!item)return item;const point=projection==='base'?registeredClassicPoint:alignedClassicPoint,bounds=projection==='base'?registeredClassicBounds:alignedClassicBounds,p=point(Number(item.x||0),Number(item.y||0)),draw=Array.isArray(item.draw)?point(Number(item.draw[0]||0),Number(item.draw[1]||0)):null;
  return Object.freeze({...item,x:p.x,y:p.y,...(draw?{draw:Object.freeze([draw.x,draw.y])}:{}),
    ...(item.bounds?{bounds:Object.freeze(bounds(item.bounds))}:{}),
    ...(item.opaqueBounds?{opaqueBounds:Object.freeze(bounds(item.opaqueBounds))}:{}),
    ...(item.collisionBounds?{collisionBounds:Object.freeze(bounds(item.collisionBounds))}:{})});
}
function alignedClassicSelectable(item){return projectClassicSelectable(item,'dense');}
function registeredClassicSelectable(item){return projectClassicSelectable(item,'base');}
function classicSelectableProjection(item,projection='none'){return projection==='base'?registeredClassicSelectable(item):projection==='dense'?alignedClassicSelectable(item):item;}
function classicBufferProjection(buffer,projection='none',options={}){return projection==='base'?registeredClassicBuffer(buffer):projection==='dense'?alignedClassicBuffer(buffer,options):buffer;}
function pathEnvelope(points=[]){if(!points.length)return null;const xs=points.map(p=>Number(p[0])),ys=points.map(p=>Number(p[1])),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);return Object.freeze({minX,maxX,minY,maxY,width:Math.max(1,maxX-minX),height:Math.max(1,maxY-minY),sampleCount:points.length});}
function projectClassicDiagnosticRow(row,projection='dense'){
  if(!row)return row;const point=projection==='base'?registeredClassicPoint:alignedClassicPoint,bounds=projection==='base'?registeredClassicBounds:alignedClassicBounds,mapPoint=p=>{const q=point(Number(p?.[0]||0),Number(p?.[1]||0));return Object.freeze([q.x,q.y])},pathPoints=Array.isArray(row.pathPoints)?row.pathPoints.map(mapPoint):null,pathSegments=Array.isArray(row.pathSegments)?row.pathSegments.map(s=>{const a=mapPoint([s[0],s[1]]),b=mapPoint([s[2],s[3]]);return Object.freeze([a[0],a[1],b[0],b[1]])}):null,current=Array.isArray(row.current)?mapPoint(row.current):null;
  const nested=row.nativeGeometry?projectClassicDiagnosticRow(row.nativeGeometry,projection):null;
  return Object.freeze({...row,
    ...(row.bounds?{bounds:Object.freeze(bounds(row.bounds))}:{}),
    ...(row.currentBounds?{currentBounds:Object.freeze(bounds(row.currentBounds))}:{}),
    ...(row.fittedBounds?{fittedBounds:Object.freeze(bounds(row.fittedBounds))}:{}),
    ...(row.preAdjustedBounds?{preAdjustedBounds:Object.freeze(bounds(row.preAdjustedBounds))}:{}),
    ...(row.productionBounds?{productionBounds:Object.freeze(bounds(row.productionBounds))}:{}),
    ...(current?{current}:{}),...(pathPoints?{pathPoints:Object.freeze(pathPoints),envelope:pathEnvelope(pathPoints)}:{}),
    ...(pathSegments?{pathSegments:Object.freeze(pathSegments)}:{}),...(nested?{nativeGeometry:nested}:{})});
}
function alignedClassicDiagnosticRow(row){return projectClassicDiagnosticRow(row,'dense');}
function registeredClassicDiagnosticRow(row){return projectClassicDiagnosticRow(row,'base');}
function classicDiagnosticProjection(row,projection='none'){return projection==='base'?registeredClassicDiagnosticRow(row):projection==='dense'?alignedClassicDiagnosticRow(row):row;}
function bufferRegionToCanvas(buffer,context,region){
  if(!buffer||!context||!region)return;const x=Math.max(0,Math.floor(region.x)),y=Math.max(0,Math.floor(region.y)),w=Math.min(Math.ceil(region.width),buffer.width-x),h=Math.min(Math.ceil(region.height),buffer.height-y);if(w<=0||h<=0)return;
  context.putImageData(new ImageData(buffer.data,buffer.width,buffer.height),0,0,x,y,w,h);
}
function applyRawRdxStaticRegions(rawLayers){
  if(!rawLayers)return;for(const region of rawRdxRegions()){if(regionAffectsPlane(region,'B')&&store.document.layers.background.visible)bufferRegionToCanvas(rawLayers.background,ctx.background,region);if(regionAffectsPlane(region,'A')&&store.document.layers.foreground.visible){ctx.foregroundBehind.clearRect(region.x,region.y,region.width,region.height);bufferRegionToCanvas(rawLayers.foreground,ctx.foreground,region);}}
}
function applyRawRdxActorRegions(rawDynamic){
  if(!rawDynamic||!store.document.layers.entities.visible)return;for(const region of rawRdxRegions().filter(r=>r.mode==='all')){if(rawDynamic.behindMidgroundPixels)bufferRegionToCanvas(rawDynamic.behindMidgroundPixels,ctx.embeddedActors,region);bufferRegionToCanvas(rawDynamic.pixels,ctx.actors,region);bufferRegionToCanvas(rawDynamic.frontPixels,ctx.frontActors,region);}
}
function applyRawRdxCollisionRegions(){
  const regions=rawRdxRegions().filter(r=>r.mode==='all');if(!regions.length||!resources?.rawPreview)return;const raw=resources.rawPreview.collisionLayer([]);for(const region of regions)bufferRegionToCanvas(raw,ctx.editor,region);
}
function sizeStage(){
  const {width,height}=displayBounds();
  for(const c of [ui.background_canvas,ui.embedded_actors_canvas,ui.foreground_behind_canvas,ui.actors_canvas,ui.foreground_canvas,ui.front_actors_canvas,ui.editor_canvas]){
    if(c.width!==width)c.width=width;if(c.height!==height)c.height=height;
    c.style.width=`${width*zoom}px`;c.style.height=`${height*zoom}px`;
  }
  ui.scene_stage.style.width=`${width*zoom}px`;ui.scene_stage.style.height=`${height*zoom}px`;
  ui.zoom_label.textContent=`${Math.round(zoom*100)}%`;
}

const spriteCanvasCache=new Map();
function drawDiagnosticShiftOverlay(context){
  if(!diagnostics.active||diagnostics.view!=='shift')return;
  const submap=Number(store?.document?.base?.submap);
  if(diagnostics.shiftMode==='vectors'){
    drawEditorClassicRdxShift(context,{shiftMap:resources?.cellShiftMap,submap,selected:diagnostics.alignmentCell});
    return;
  }
  const overlay=resources?.cellShiftMap?.overlayForSubmap?.(submap);
  if(!overlay)return;
  context.putImageData(new ImageData(overlay.data,overlay.width,overlay.height),0,0,0,0,Math.min(overlay.width,docBounds().width),Math.min(overlay.height,docBounds().height));
  if(diagnostics.alignmentCell)drawEditorClassicRdxShift(context,{shiftMap:resources?.cellShiftMap,submap,selected:diagnostics.alignmentCell,selectionOnly:true});
}
function frameCanvas(frame,pn){ const variant=String(frame?.visualVariant||'sprite'),style=frame?.enemyClimbStylePn??'',paletteKey=Number(store?.document?.base?.mapId??-1),key=`${paletteKey}:${pn}:${variant}:${style}:${frame?.frameIndex??0}:${frame?.pixels?.width}x${frame?.pixels?.height}:${frame?.mirrored?'mx':''}:${frame?.mirroredY?'my':''}`; let c=spriteCanvasCache.get(key); if(!c){c=document.createElement('canvas');c.width=frame.pixels.width;c.height=frame.pixels.height;c.getContext('2d').putImageData(new ImageData(frame.pixels.data,frame.pixels.width,frame.pixels.height),0,0);spriteCanvasCache.set(key,c)} return c;}
function entityFrame(entity,frameTick=tick,motion=null){
  const pn=Number(entity.pn);
  if(!Number.isFinite(pn)||pn<0) return null;
  const options={mirrorX:!!entity.mirrorX,mirrorY:!!entity.mirrorY};
  let frame;
  if(Number.isInteger(Number(entity.frameIndex))&&Number(entity.frameIndex)>=0){
    const animation=resources.spriteDecoder.framesForPn(pn,currentPalette(),options),index=clamp(Number(entity.frameIndex),0,Math.max(0,animation.frames.length-1));
    frame=animation.frames[index]?{...animation.frames[index],pn:animation.pn,frameIndex:index}:null;
  }else{
    frame=rdxEnemyClimbFrame(resources.spriteDecoder,resources.classic,pn,Number(entity.entity||0),motion?.sprite,currentPalette(),{c1:motion?.c1,x:motion?.classicX,y:motion?.classicY});
    if(!frame){const animation=resources.spriteDecoder.framesForPn(pn,currentPalette(),options),phaseTick=rdxEnemySpatialPhaseTick(pn,entity.x,entity.y,animation.frames),sourceTick=rdxEnemyPresentationTick(pn,frameTick,motion?.sprite,phaseTick);frame=resources.spriteDecoder.frameForPn(pn,sourceTick,currentPalette(),options);}
  }
  if(!frame) return null;
  const nativeHeight=Number(entityCatalogRow(entity.entity)?.defaultHeight||21);
  const placementAnchor=String(entity.category||'')==='enemy'
    ? resources.spriteDecoder.placementAnchor(frame,Number(entity.entity||0),{role:'enemy',classicSprite:motion?.sprite})
    : null;
  const draw=editorEntityDrawPosition(frame,entity,nativeHeight,motion,placementAnchor);
  return {frame,pn,drawX:draw.x,drawY:draw.y,origin:draw.origin};
}
function drawCustomEntities(dynamic=null,frameTick=effectivePreviewTick()){
  customHitboxes=[];
  const normal=ctx.actors,front=ctx.frontActors,motionEnabled=previewMotionEnabled();
  for(const e of store.document.entities){
    if(e.enabled===false) continue;
    const motion=motionEnabled?editorEntitySourceMotion(e,dynamic?.states||[]):null;
    const f=entityFrame(e,frameTick,motion);
    let b;
    if(f){ b={x:f.drawX,y:f.drawY,width:f.frame.pixels.width,height:f.frame.pixels.height};if(motion?.visible!==false){const target=e.front?front:normal;target.drawImage(frameCanvas(f.frame,f.pn),f.drawX,f.drawY);} }
    else { const dx=Number(motion?.dx||0),dy=Number(motion?.dy||0),target=e.front?front:normal;target.save();target.strokeStyle='#e66d79';target.strokeRect(Math.round(e.x+dx)+.5,Math.round(e.y+dy)+.5,24,21);target.fillStyle='rgba(230,109,121,.8)';target.font='8px monospace';target.fillText(`0x${Number(e.entity).toString(16)}`,e.x+dx+2,e.y+dy+10);target.restore();b={x:e.x+dx,y:e.y+dy,width:24,height:21}; }
    customHitboxes.push({kind:'entity',id:e.id,bounds:b,entity:e});
  }
}
function drawNativeSuperPadGeometry(c){
  if(!diagnostics.active||!diagnostics.geometry)return;
  const geometry=nativeSimulation.geometry;if(!geometry?.primitives)return;
  const pads=geometry.primitives.filter(row=>Number(row.type)===DebugPrimitiveType.SUPER_PAD);if(!pads.length)return;
  c.save();c.lineWidth=2;c.strokeStyle='#55e6ff';c.fillStyle='rgba(85,230,255,.10)';c.setLineDash([5,2]);
  for(const pad of pads){const x=Number(pad.x0),y=Number(pad.y0),w=Number(pad.x1)-x+1,h=Number(pad.y1)-y+1;c.fillRect(x,y,w,h);c.strokeRect(x+.5,y+.5,Math.max(1,w-1),Math.max(1,h-1));}
  c.restore();
}

function nativeTransitionRows(){
  const room=resolvedRoomFor(),width=Number(store?.document?.bounds?.width||320),height=Number(store?.document?.bounds?.height||224),startRow=Number(room?.layers?.source?.classic?.startRow||0),rows=[];
  const position=(row,side,fallbackRow)=>{const p=row?.rdxPosition;if(Array.isArray(p)&&p.length>=2&&p.every(Number.isFinite))return [Number(p[0]),Number(p[1])];return [side==='left'?8:width-8,clamp((Number(fallbackRow)-startRow)*8,8,Math.max(8,height-8))];};
  /* Mirror xrick's map_connect[] model: each current-room connector is one
   * physical transition object. rowin belongs to that connector; it is not a
   * separate destination-entry object. */
  for(const row of room?.transitions?.connectors||[]){const side=String(row.direction||'right'),p=position(row,side,row.rowout);rows.push({id:`native-transition:${row.connectorId||row.connectorIndex}`,kind:'connector',side,position:p,status:String(row.status||'unresolved'),contactSource:String(row.contactSource||'unresolved'),connectorId:String(row.connectorId||''),connectorIndex:Number(row.connectorIndex),sourceSubmap:Number(room.submap),rowout:Number(row.rowout),targetSubmap:Number(row.targetSubmap),rowin:Number(row.rowin),sourceRef:row.sourceRef||null});}
  return rows;
}
function transitionRoomLabel(submap){return Number(submap)===0xff?'NEXT':`SM${Number(submap).toString(16).padStart(2,'0').toUpperCase()}`;}
function drawNativeTransitionOverlay(c){
  nativeTransitionHitboxes=[];const selected=new Set(selection.filter(s=>s.kind==='native-transition').map(s=>String(s.id)));c.save();c.lineWidth=1.5;
  for(const row of nativeTransitionRows()){
    const [x,y]=row.position,dir=row.side==='right'?1:-1,active=selected.has(String(row.id)),unresolved=row.status==='unresolved';
    c.strokeStyle=active?'#fff0aa':unresolved?'#ff8e8e':'#70ddd5';c.fillStyle=c.strokeStyle;c.beginPath();c.moveTo(x-dir*8,y);c.lineTo(x+dir*7,y);c.stroke();c.beginPath();c.moveTo(x+dir*7,y);c.lineTo(x+dir*2,y-4);c.lineTo(x+dir*2,y+4);c.closePath();c.fill();
    /* Keep the map itself spatial. Route names, rows and provenance belong in
     * the scene tree/Inspector where they stay readable without covering level
     * artwork. The generous invisible hit target keeps the arrow easy to pick. */
    nativeTransitionHitboxes.push({...row,bounds:{x:x-10,y:y-8,width:20,height:16}});
  }
  c.restore();
}
function nativeTransitionHitAt(p){for(let i=nativeTransitionHitboxes.length-1;i>=0;i--){const h=nativeTransitionHitboxes[i],b=h.bounds;if(p.x>=b.x&&p.y>=b.y&&p.x<=b.x+b.width&&p.y<=b.y+b.height)return{kind:'native-transition',id:h.id};}return null;}
function selectedNativeTransition(){const s=primarySelection();return s?.kind==='native-transition'?nativeTransitionRows().find(row=>String(row.id)===String(s.id))||null:null;}

function resolvedPresentationDepth(){return lastStaticLayers?.presentationDepth||resolvedRoomFor()?.layers?.presentationDepth||null;}
function presentationDepthRows(){
  const model=resolvedRoomFor()?.layers?.presentationDepth,rows=[];
  for(const row of model?.overrides||[])rows.push({...row,selectionId:`reviewed:${row.id}`,origin:'reviewed'});
  for(const row of store?.document?.presentationDepthOverrides||[])rows.push({...row,selectionId:`draft:${row.id}`,origin:'draft'});
  return rows;
}
function presentationDepthRowForSelection(item){return item?.kind==='presentation-depth'?presentationDepthRows().find(row=>row.selectionId===item.id)||null:null;}
function presentationDepthSelectionBounds(){
  const out=[],seen=new Set(),push=(plane,bounds)=>{const normalized=String(plane||'').toUpperCase(),b=bounds?.map(Number);if(!PRESENTATION_ALLOWED_BANDS[normalized]||!b||b.length<4||b[2]<=0||b[3]<=0)return;const key=`${normalized}:${b.join(',')}`;if(seen.has(key))return;seen.add(key);out.push({plane:normalized,bounds:b});};
  for(const item of selection){
    if(item.kind==='region'){
      if(item.mode==='background'||item.mode==='all')push('B',[item.x,item.y,item.width,item.height]);
      if(item.mode==='foreground'||item.mode==='all')push('A',[item.x,item.y,item.width,item.height]);
    } else if(item.kind==='cell')push(String(item.layer||selectedLayerPlane()).toUpperCase(),[Number(item.gx)*8,Number(item.gy)*8,8,8]);
    else if(item.kind==='presentation-depth'){const row=presentationDepthRowForSelection(item);if(row)push(row.plane,row.bounds);}
  }
  return out;
}
function presentationDepthDraftId(plane,bounds){return `depth-${String(plane).toUpperCase()}-${bounds.map(v=>Math.round(Number(v))).join('-')}`;}
function setSelectedPresentationDepth(band){
  if(!PRESENTATION_BANDS.includes(band))return;const targets=presentationDepthSelectionBounds().filter(target=>PRESENTATION_ALLOWED_BANDS[target.plane]?.includes(band));
  if(!targets.length){toast(`Selected source planes cannot be assigned to ${band}. Plane B supports backdrop/midground; Plane A supports backdrop/midground/foreground.`,'warn');return;}
  const reviewed=resolvedRoomFor()?.layers?.presentationDepth?.overrides||[];
  store.transact(`presentation-depth-${band}`,d=>{for(const target of targets){const key=target.bounds.join(','),plane=target.plane,existing=reviewed.find(row=>String(row.plane).toUpperCase()===plane&&row.bounds?.map(Number).join(',')===key),id=existing?.id||presentationDepthDraftId(plane,target.bounds);d.presentationDepthOverrides=(d.presentationDepthOverrides||[]).filter(row=>!(String(row.plane).toUpperCase()===plane&&row.bounds?.map(Number).join(',')===key));d.presentationDepthOverrides.push({id,plane,band,bounds:[...target.bounds],source:'editor-draft',provenance:{reason:'Level Editor presentation-depth authoring'}});}});
  rendererAuthorityKey='';refreshNativeDraftRuntime();scheduleRender();
}
function revertSelectedPresentationDepth(){
  const draftIds=new Set(selection.filter(item=>item.kind==='presentation-depth'&&String(item.id).startsWith('draft:')).map(item=>String(item.id).slice(6))),targets=presentationDepthSelectionBounds();
  const keys=new Set(targets.map(row=>`${row.plane}:${row.bounds.join(',')}`));
  store.transact('presentation-depth-revert',d=>{d.presentationDepthOverrides=(d.presentationDepthOverrides||[]).filter(row=>!draftIds.has(String(row.id))&&!keys.has(`${String(row.plane).toUpperCase()}:${row.bounds?.map(Number).join(',')}`));});
  rendererAuthorityKey='';refreshNativeDraftRuntime();setSelection([]);scheduleRender();
}
function presentationDepthSelectionHasDraft(){
  const draftRows=store?.document?.presentationDepthOverrides||[],draftIds=new Set(selection.filter(item=>item.kind==='presentation-depth'&&String(item.id).startsWith('draft:')).map(item=>String(item.id).slice(6)));
  if(draftRows.some(row=>draftIds.has(String(row.id))))return true;
  const keys=new Set(presentationDepthSelectionBounds().map(row=>`${row.plane}:${row.bounds.join(',')}`));
  return draftRows.some(row=>keys.has(`${String(row.plane).toUpperCase()}:${row.bounds?.map(Number).join(',')}`));
}
function presentationDepthActionsHtml(){
  const planes=[...new Set(presentationDepthSelectionBounds().map(row=>row.plane))],allowed=planes.length?PRESENTATION_BANDS.filter(band=>planes.every(plane=>PRESENTATION_ALLOWED_BANDS[plane]?.includes(band))):[];
  const buttons=allowed.map(band=>`<button data-action="depth-${band}" ${band==='midground'?'class="primary"':''}>Set ${band[0].toUpperCase()+band.slice(1)}</button>`).join('');
  const remove=presentationDepthSelectionHasDraft()?'<button data-action="depth-revert">Revert local override</button>':'';
  return `<div class="inspector-group"><h3>Presentation depth <span>visual only</span></h3><p class="property-help">Plane B can be Backdrop or Midground. Plane A can be Midground or Foreground. Runtime uses only resolved presentation depth, including the generated Plane-B seed baseline; collision and source-plane identity stay unchanged.</p></div><div class="inspector-actions">${buttons}${remove}</div>`;
}
function currentPresentationSeed(){
  const source=lastStaticLayers?.sourcePlaneB;if(!source||!resources?.mapDecoder||!store)return null;
  if(lastPresentationSeed?.source===source)return lastPresentationSeed.seed;
  const topology=resolvedRoomFor()?.layers?.structuralCorrections?.topology||resolvedRoomFor()?.effective?.mapping?.rdxTopology||null;
  const classificationBaseline=resolvedPresentationDepth()?.seedBaseline||null;
  const seed=generatePresentationDepthSeed({source,mapDecoder:resources.mapDecoder,mapId:store.document.base.mapId,phase:resources.preview.staticPhaseAtTick(effectivePreviewTick()),topology,viewport:{x:0,y:0},classificationBaseline});
  lastPresentationSeed={source,seed};return seed;
}
const presentationOccurrenceCache=new Map();
function presentationIdentityOccurrenceCount(identity,plane){
  const key=`${plane}:${identity}`;if(presentationOccurrenceCache.has(key))return presentationOccurrenceCache.get(key);
  let count=0;const seenMaps=new Set();for(const roomRow of resources?.manifest?.rooms||[]){const mapId=Number(roomRow.mapId);if(seenMaps.has(mapId))continue;seenMaps.add(mapId);let dim;try{dim=resources.mapDecoder.dimensions(mapId)}catch{continue}const gxMax=Math.ceil(dim.width/8),gyMax=Math.ceil(dim.height/8);for(let gy=0;gy<gyMax;gy++)for(let gx=0;gx<gxMax;gx++){let cell;try{cell=resources.mapDecoder.inspectGridCell(mapId,gx,gy,0)}catch{continue}if(presentationVisualIdentity(cell,plane)===identity)count++;}}
  presentationOccurrenceCache.set(key,count);return count;
}
function presentationCellInspection(plane,gx,gy){
  const normalized=String(plane||'B').toUpperCase();if(!PRESENTATION_ALLOWED_BANDS[normalized])return null;
  let cell=null;try{cell=resources?.mapDecoder?.inspectGridCell?.(Number(store.document.base.mapId),Number(gx),Number(gy),0,{topology:resolvedRoomFor()?.layers?.structuralCorrections?.topology||null})||null}catch{}
  const visual=normalized==='A'?cell?.visual?.foreground:cell?.visual?.background,globalTile=Number(visual?.resolution?.globalTile),stableGlobalTile=Number.isInteger(globalTile)?globalTile:null,identity=presentationVisualIdentity(cell,normalized),depth=presentationDepthAt(resolvedPresentationDepth(),{plane:normalized,globalTile:stableGlobalTile,x:Number(gx)*8+4,y:Number(gy)*8+4}),origin=depth.rule?.kind||'default',seed=normalized==='B'?presentationDepthSeedAt(currentPresentationSeed(),{gx:Number(gx),gy:Number(gy)}):null;
  return {plane:normalized,globalTile:stableGlobalTile,band:depth.band,origin,ruleId:depth.rule?.id||null,visualIdentity:identity,occurrences:presentationIdentityOccurrenceCount(identity,normalized),seed,classEdit:stableGlobalTile==null?null:presentationDepthClassEditAt(store.document.presentationDepthClassEdits||[],normalized,stableGlobalTile)};
}
function selectedPresentationClassInspection(){const s=primarySelection();return s?.kind==='cell'?presentationCellInspection(s.layer||selectedLayerPlane(),s.gx,s.gy):null;}
function setSelectedPresentationDepthClass(band){
  const info=selectedPresentationClassInspection();if(!info||info.globalTile==null){toast('This cell has no stable global-tile identity; use a local depth override instead.','warn');return;}if(!PRESENTATION_ALLOWED_BANDS[info.plane]?.includes(band)){toast(`Plane ${info.plane} cannot be assigned to ${band}.`,'warn');return;}
  store.transact(`presentation-depth-class-${band}`,d=>{const rows=d.presentationDepthClassEdits||[],key=`${info.plane}:${info.globalTile}`;d.presentationDepthClassEdits=rows.filter(row=>`${String(row.plane).toUpperCase()}:${Number(row.globalTile)}`!==key);d.presentationDepthClassEdits.push({id:`depth-class-${info.plane}-${info.globalTile}`,plane:info.plane,globalTile:info.globalTile,action:'set',band,label:info.visualIdentity||`Plane ${info.plane} tile ${info.globalTile}`,provenance:{reason:'Level Editor shared presentation-depth correction'}});});
  rendererAuthorityKey='';refreshNativeDraftRuntime();scheduleRender();renderInspector();
}
function revertSelectedPresentationDepthClass(){
  const info=selectedPresentationClassInspection();if(!info||info.globalTile==null)return;const base=resolvedRoomFor()?.layers?.presentationDepth,baseRule=(base?.classes||[]).find(row=>String(row.plane).toUpperCase()===info.plane&&(row.globalTiles||[]).map(Number).includes(info.globalTile));
  store.transact('presentation-depth-class-inherit',d=>{const key=`${info.plane}:${info.globalTile}`;d.presentationDepthClassEdits=(d.presentationDepthClassEdits||[]).filter(row=>`${String(row.plane).toUpperCase()}:${Number(row.globalTile)}`!==key);if(baseRule)d.presentationDepthClassEdits.push({id:`depth-class-${info.plane}-${info.globalTile}`,plane:info.plane,globalTile:info.globalTile,action:'remove',label:info.visualIdentity||`Plane ${info.plane} tile ${info.globalTile}`,provenance:{reason:'Level Editor shared presentation-depth reversion to plane default'}});});
  rendererAuthorityKey='';refreshNativeDraftRuntime();scheduleRender();renderInspector();
}
function matchingPresentationCells(info){
  if(!info||info.globalTile==null)return [];const out=[],topology=resolvedRoomFor()?.layers?.structuralCorrections?.topology||null,gxMax=Math.ceil(Number(store.document.bounds.width)/8),gyMax=Math.ceil(Number(store.document.bounds.height)/8);
  for(let gy=0;gy<gyMax;gy++)for(let gx=0;gx<gxMax;gx++){let cell;try{cell=resources?.mapDecoder?.inspectGridCell?.(Number(store.document.base.mapId),gx,gy,0,{topology})}catch{continue}const visual=info.plane==='A'?cell?.visual?.foreground:cell?.visual?.background;if(Number(visual?.resolution?.globalTile)===info.globalTile)out.push({kind:'cell',id:`${info.plane}:${gx}:${gy}`,gx,gy,layer:info.plane});}
  return out;
}
function selectMatchingPresentationCells({announce=false}={}){const info=selectedPresentationClassInspection();if(!info||info.globalTile==null){toast('This cell has no stable global-tile identity.','warn');return;}const items=matchingPresentationCells(info);setSelection(items);if(announce)toast(`${info.visualIdentity} occurs ${info.occurrences} time${info.occurrences===1?'':'s'} across mapped source maps; ${items.length} occurrence${items.length===1?'':'s'} in this room.`);}
function presentationDepthClassActionsHtml(depth){
  if(!depth||depth.globalTile==null)return '<div class="inspector-group"><h3>Shared classification <span>unavailable</span></h3><p class="property-help">This visual has no stable global-tile identity. Use the local presentation-depth controls for this occurrence.</p></div>';
  const buttons=(PRESENTATION_ALLOWED_BANDS[depth.plane]||[]).map(band=>`<button data-action="depth-class-${band}" ${band===depth.band?'class="primary"':''}>Set ${band[0].toUpperCase()+band.slice(1)} for all matching</button>`).join('');
  const revert=depth.classEdit||depth.origin==='class'?'<button data-action="depth-class-inherit">Use inherited/default</button>':'';
  return `<div class="inspector-group"><h3>Shared classification <span>${escapeHtml(depth.plane)} · global tile ${depth.globalTile}</span></h3><p class="property-help">Apply one reviewed depth decision to every occurrence of this stable source-art identity. Local overrides still win for room-specific exceptions.</p></div><div class="inspector-actions">${buttons}${revert}<button data-action="depth-select-matching">Select matching in room</button><button data-action="depth-show-occurrences">Show occurrences</button></div>`;
}
function drawPresentationDepthOverlay(c){
  if(!lastStaticLayers)return;
  if(depthPreviewMode==='seed'){
    const seed=currentPresentationSeed();if(!seed)return;c.save();for(const row of seed.cells||[]){const [x,y,w,h]=row.bounds,alpha=.14+.28*Number(row.confidence||0);c.fillStyle=row.classification==='open'?`rgba(65,220,235,${alpha})`:`rgba(246,177,71,${alpha})`;c.fillRect(x,y,w,h);if(Number(row.confidence||0)<.2){c.strokeStyle='rgba(255,255,255,.28)';c.strokeRect(x+.5,y+.5,w-1,h-1);}}c.restore();return;
  }
  if(depthPreviewMode!=='split'&&!depthView)return;
  const backdrop=lastStaticLayers.backdrop||lastStaticLayers.background,midground=lastStaticLayers.midground||lastStaticLayers.foregroundBehindActors,foreground=lastStaticLayers.foreground;if(!backdrop||!midground||!foreground)return;
  const width=Math.min(c.canvas.width,backdrop.width,midground.width,foreground.width),height=Math.min(c.canvas.height,backdrop.height,midground.height,foreground.height),data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const dst=(y*width+x)*4,bi=(y*backdrop.width+x)*4,mi=(y*midground.width+x)*4,fi=(y*foreground.width+x)*4;if(backdrop.data[bi+3]){data[dst]=137;data[dst+1]=105;data[dst+2]=225;data[dst+3]=112}else if(midground.data[mi+3]){data[dst]=72;data[dst+1]=205;data[dst+2]=224;data[dst+3]=96}else if(foreground.data[fi+3]){data[dst]=247;data[dst+1]=191;data[dst+2]=79;data[dst+3]=72}}
  c.putImageData(new ImageData(data,width,height),0,0);
}
function renderEditorOverlay(){
  const c=ctx.editor,d=store.document;c.clearRect(0,0,c.canvas.width,c.canvas.height);drawPresentationDepthOverlay(c);
  if(ui.grid_toggle.checked){ c.save();c.strokeStyle='rgba(140,161,181,.13)';c.lineWidth=1;for(let x=0;x<d.bounds.width;x+=8){c.beginPath();c.moveTo(x+.5,0);c.lineTo(x+.5,d.bounds.height);c.stroke()}for(let y=0;y<d.bounds.height;y+=8){c.beginPath();c.moveTo(0,y+.5);c.lineTo(d.bounds.width,y+.5);c.stroke()}c.restore(); }
  drawDiagnosticShiftOverlay(c);
  if(ui.collision_overlay_toggle.classList.contains('active')){
    const mask=resources.preview.collisionLayer([]); c.globalAlpha=.72;c.putImageData(new ImageData(mask.data,mask.width,mask.height),0,0,0,0,Math.min(mask.width,d.bounds.width),Math.min(mask.height,d.bounds.height));c.globalAlpha=1;
    if(hasRawRdxRegions()){configureRawPreview();c.globalAlpha=.72;applyRawRdxCollisionRegions();c.globalAlpha=1;}
  }
  if(diagnostics.active&&diagnostics.geometry){
    const ids=diagnostics.geometryCells.map(cell=>cell.id);const mask=resources.preview.collisionLayer(ids);c.globalAlpha=.68;c.putImageData(new ImageData(mask.data,mask.width,mask.height),0,0,0,0,Math.min(mask.width,d.bounds.width),Math.min(mask.height,d.bounds.height));c.globalAlpha=1;drawNativeSuperPadGeometry(c);
  }
  if(diagnostics.active&&diagnostics.unresolved){
    const mask=resources.preview.unresolvedCollisionLayer?.();if(mask){c.globalAlpha=.82;c.putImageData(new ImageData(mask.data,mask.width,mask.height),0,0,0,0,Math.min(mask.width,d.bounds.width),Math.min(mask.height,d.bounds.height));c.globalAlpha=1;}
  }
  if(diagnostics.active){
    if(diagnostics.trajectories)drawFullTrajectoryOverlay(c);const rows=currentDiagnosticRows(),selectedDebug=diagnostics.selectedItem?.debugRow?.debugId||diagnostics.selectedItem?.debugId||diagnostics.selectedId,targetRows=(lastDynamic?.enemyBehaviors||[]).map(row=>classicDiagnosticProjection(row,lastDynamicClassicProjection));drawEditorDiagnosticRows(c,rows,selectedDebug,{targetRows,sourceSelectables:diagnosticSourceSelectables(),showTrajectories:diagnostics.trajectories});const selected=diagnostics.selectedItem,b=diagnosticBounds(selected);if(b&&!selected?.debugRow){c.save();c.strokeStyle='#ffe36e';c.fillStyle='rgba(255,227,110,.06)';c.lineWidth=2;c.setLineDash([5,2]);c.fillRect(b.x,b.y,b.width,b.height);c.strokeRect(b.x+.5,b.y+.5,b.width,b.height);c.setLineDash([]);c.restore();}
  }
  else {const projectileRows=sceneProjectileTopologyRows();if(projectileRows.length)drawEditorDiagnosticRows(c,projectileRows,'',{targetRows:[],sourceSelectables:diagnosticSourceSelectables(),showTrajectories:false});}
  drawNativeTransitionOverlay(c);
  /* Collision is authored on the native 16x16 MT/ML grid. Always expose that
   * real 2x2-g8 ownership while the Collision tool is active so no 8x8
   * presentation tile can be mistaken for an independently editable collider. */
  if(tool==='collision'){
    c.save();c.lineWidth=1;c.strokeStyle='rgba(85,199,192,.32)';c.setLineDash([2,2]);
    for(let x=0;x<d.bounds.width;x+=16)for(let y=0;y<d.bounds.height;y+=16)c.strokeRect(x+.5,y+.5,15,15);
    c.setLineDash([]);c.restore();
  }
  if((terrainPaintMode()||stampPaintMode())&&['brush','rectangle','fill','eyedropper','erase'].includes(tool)){
    c.save();c.lineWidth=1;c.strokeStyle='rgba(229,189,71,.22)';c.setLineDash([2,3]);for(let x=0;x<d.bounds.width;x+=16)for(let y=0;y<d.bounds.height;y+=16)c.strokeRect(x+.5,y+.5,15,15);c.setLineDash([]);c.restore();
  }
  if(tool==='collision'){const grid=collisionSelectionGrid();c.save();c.lineWidth=1;c.strokeStyle='rgba(112,221,213,.18)';c.setLineDash([2,3]);for(let x=0;x<d.bounds.width;x+=grid)for(let y=0;y<d.bounds.height;y+=grid)c.strokeRect(x+.5,y+.5,grid-1,grid-1);c.setLineDash([]);c.restore();}
  if(autotileDebug&&d.terrain?.length){
    c.save();c.font='7px monospace';c.textBaseline='top';for(const row of autotileDebugRows(d,resources.autotileCatalog,{nativeConnects:nativeAutotileConnects,collisionAt:nativeAutotileCollisionAt,visualAt:nativeAutotileVisualAt})){const x=row.cell[0]*16,y=row.cell[1]*16;c.fillStyle='rgba(5,13,18,.82)';c.fillRect(x+1,y+1,15,8);c.fillStyle='#d9fffb';c.fillText(`m${row.mask.toString(16).toUpperCase()} d${row.diagonalMask.toString(16).toUpperCase()}`,x+2,y+2);}c.restore();
  }
  if(terrainPaintMode()&&d.terrainRelations?.length){const selectedRelationIds=new Set(selection.filter(s=>s.kind==='terrain-relation').map(s=>s.id));c.save();c.strokeStyle='rgba(112,221,213,.72)';c.fillStyle='rgba(112,221,213,.85)';c.lineWidth=1;c.setLineDash([3,2]);for(const r of d.terrainRelations){if(r.type!=='support')continue;const live=gesture?.type==='brush'&&gesture.supportRelationId===r.id,selected=selectedRelationIds.has(r.id);if(!live&&!selected&&!autotileDebug)continue;const x=r.anchor[0]*16+8,y0=r.anchor[1]*16+8,y1=r.end[1]*16+8;c.beginPath();c.moveTo(x,y0);c.lineTo(x,y1);c.stroke();c.fillRect(x-2,y0-2,4,4);}c.setLineDash([]);c.restore();}
  const hero=d.heroStart,showHeroMarker=tool==='hero'||selection.some(s=>s.kind==='hero');if(showHeroMarker){c.save();c.strokeStyle='#f2d368';c.fillStyle='rgba(242,211,104,.2)';c.lineWidth=1;c.beginPath();c.arc(hero.x,hero.y,7,0,Math.PI*2);c.fill();c.stroke();c.beginPath();c.moveTo(hero.x-11,hero.y);c.lineTo(hero.x+11,hero.y);c.moveTo(hero.x,hero.y-11);c.lineTo(hero.x,hero.y+11);c.stroke();c.fillStyle='#fff0aa';c.font='8px monospace';c.fillText('RICK',hero.x+8,hero.y-8);c.restore();}
  const resetRegions=rawRdxRegions();if(resetRegions.length){c.save();c.font='7px monospace';c.textBaseline='top';c.setLineDash([5,3]);for(const r of resetRegions){c.strokeStyle='rgba(112,221,213,.72)';c.fillStyle='rgba(112,221,213,.045)';c.fillRect(r.x,r.y,r.width,r.height);c.strokeRect(r.x+.5,r.y+.5,r.width-1,r.height-1);c.fillStyle='rgba(5,13,18,.82)';const label=`RAW ${SELECT_REGION_PRESENTATION[r.mode]?.short||r.mode.toUpperCase()}`;const tw=Math.max(34,c.measureText(label).width+5);c.fillRect(r.x+2,r.y+2,tw,10);c.fillStyle='#d9fffb';c.fillText(label,r.x+4,r.y+4);}c.restore();}
  const selectedIds=new Set(selection.map(s=>`${s.kind}:${s.id}`));
  c.save();c.strokeStyle='#f4d45c';c.fillStyle='rgba(244,212,92,.08)';c.lineWidth=1;
  for(const s of selection) if(s.kind==='region'){c.save();c.setLineDash([4,2]);c.strokeStyle='#f4d45c';c.fillStyle='rgba(244,212,92,.10)';c.fillRect(s.x,s.y,s.width,s.height);c.strokeRect(s.x+.5,s.y+.5,s.width-1,s.height-1);c.fillStyle='#fff0aa';c.font='7px monospace';c.fillText(SELECT_REGION_PRESENTATION[s.mode]?.label||'Region',s.x+4,s.y+4);c.restore();}
  for(const s of selection) if(s.kind==='cell'){ const x=s.gx*8,y=s.gy*8;c.fillStyle='rgba(244,212,92,.10)';c.fillRect(x,y,8,8);c.strokeRect(x+.5,y+.5,7,7);}
  for(const s of selection) if(s.kind==='presentation-depth'){const row=presentationDepthRowForSelection(s),b=row?.bounds;if(b){c.save();c.strokeStyle=row.band==='backdrop'?'#8f7be6':row.band==='midground'?'#48cde0':'#f7bf4f';c.fillStyle=row.band==='backdrop'?'rgba(143,123,230,.12)':row.band==='midground'?'rgba(72,205,224,.12)':'rgba(247,191,79,.10)';c.setLineDash([4,2]);c.fillRect(b[0],b[1],b[2],b[3]);c.strokeRect(b[0]+.5,b[1]+.5,b[2]-1,b[3]-1);c.restore();}}
  for(const s of selection) if(s.kind==='terrain'){ const x=s.cx*16,y=s.cy*16;c.fillStyle='rgba(244,212,92,.12)';c.fillRect(x,y,16,16);c.strokeStyle='#f4d45c';c.lineWidth=1.5;c.strokeRect(x+.75,y+.75,14.5,14.5);}
  for(const s of selection) if(s.kind==='stamp'){const placement=d.stamps?.find(x=>x.id===s.id),b=placement?stampBounds(placement):null;if(b){c.fillStyle='rgba(135,212,143,.10)';c.strokeStyle='#87d48f';c.lineWidth=1.5;c.fillRect(b.x,b.y,b.width,b.height);c.strokeRect(b.x+.75,b.y+.75,b.width-1.5,b.height-1.5);c.fillStyle='#d9fffb';c.strokeStyle='#132a2a';for(const h of stampResizeHandlesForBounds(b)){c.fillRect(h.x-3,h.y-3,6,6);c.strokeRect(h.x-3.5,h.y-3.5,7,7);}}}
  for(const s of collisionSelections()){
    const gameplay=s.kind==='gameplay-collision',size=gameplay?8:16,x=gameplay?s.g8[0]*8:(s.logic[0]-1)*16,y=gameplay?s.g8[1]*8:(s.logic[1]-1)*16;c.fillStyle='rgba(85,199,192,.14)';c.strokeStyle='#70ddd5';c.lineWidth=1.5;c.fillRect(x,y,size,size);c.strokeRect(x+.75,y+.75,size-1.5,size-1.5);if(!gameplay){c.fillStyle='#d9fffb';c.font='7px monospace';c.fillText(`${s.logic[0]},${s.logic[1]}`,x+2,y+9);}
  }
  c.strokeStyle='#f4d45c';c.fillStyle='rgba(244,212,92,.08)';c.lineWidth=1;
  if(tool==='entity'){
    c.save();c.strokeStyle='rgba(112,221,213,.45)';c.setLineDash([2,2]);
    for(const hit of customHitboxes){const b=hit.bounds;c.strokeRect(b.x-.5,b.y-.5,b.width+1,b.height+1)}
    for(const src of sourceSelectables){const b=src.bounds;if(b&&(String(src.sourceKey).startsWith('mark:')||isReviewedScenerySelectable(src)))c.strokeRect(b.x-.5,b.y-.5,b.width+1,b.height+1)}
    c.restore();
  }
  for(const src of sourceSelectables) if(src.runtimeSuppressed===true&&src.bounds){const b=src.bounds;c.save();c.strokeStyle='rgba(244,212,92,.92)';c.fillStyle='rgba(244,212,92,.08)';c.lineWidth=1.5;c.setLineDash([4,2]);c.fillRect(b.x-.5,b.y-.5,b.width+1,b.height+1);c.strokeRect(b.x-.5,b.y-.5,b.width+1,b.height+1);c.setLineDash([]);c.fillStyle='#fff0aa';c.font='7px monospace';c.fillText('SUPPRESSED',b.x,b.y-4);c.restore()}
  for(const hit of customHitboxes) if(selectedIds.has(`entity:${hit.id}`)){const b=hit.bounds;c.fillRect(b.x-.5,b.y-.5,b.width+1,b.height+1);c.strokeRect(b.x-.5,b.y-.5,b.width+1,b.height+1);handles(c,b)}
  for(const hit of customHitboxes){const e=hit.entity,actorSelected=selectedIds.has(`entity:${hit.id}`),activatorSelected=selectedIds.has(`activator:${hit.id}`),show=entityHasActivator(e);if(!show&&!actorSelected&&!activatorSelected)continue;const px=Number(e.patrolX??e.x),py=Number(e.patrolY??e.y),tx=Number(e.triggerX??e.x),ty=Number(e.triggerY??e.y),b=hit.bounds,ax=b.x+b.width/2,ay=b.y+b.height/2;c.save();c.font='7px monospace';c.lineWidth=activatorSelected?1.5:1;c.setLineDash([3,2]);c.strokeStyle=activatorSelected||actorSelected?'rgba(242,211,104,.95)':'rgba(242,211,104,.28)';c.beginPath();c.moveTo(ax,ay);c.lineTo(tx,ty);c.stroke();c.setLineDash([]);c.beginPath();c.arc(tx,ty,activatorSelected?5:3,0,Math.PI*2);c.stroke();if(activatorSelected){c.fillStyle='rgba(242,211,104,.16)';c.beginPath();c.arc(tx,ty,8,0,Math.PI*2);c.fill();c.fillStyle='#fff0aa';c.fillText('ACTIVATOR',tx+8,ty+3)}if(actorSelected){c.strokeStyle='rgba(112,221,213,.9)';c.setLineDash([3,2]);c.beginPath();c.moveTo(e.x,e.y);c.lineTo(px,py);c.stroke();c.setLineDash([]);c.strokeRect(px-3.5,py-3.5,7,7);c.fillStyle='#d9fffb';c.fillText('PATROL',px+5,py-5)}c.restore()}
  for(const src of sourceSelectables) if(selectedIds.has(`source:${src.sourceKey}`)){const b=src.bounds;if(b){c.strokeRect(b.x-.5,b.y-.5,b.width+1,b.height+1);handles(c,b)}}
  drawSelectedSourceEnemyPatrol(c);
  for(const src of sourceSelectables) if(selectedIds.has(`scenery:${src.sourceKey}`)){const b=src.bounds;if(b){c.fillStyle='rgba(244,212,92,.08)';c.fillRect(b.x-.5,b.y-.5,b.width+1,b.height+1);c.strokeRect(b.x-.5,b.y-.5,b.width+1,b.height+1);handles(c,b)}}
  for(const item of selection)if(item.kind==='source-activator'){const mark=Number(String(item.id).split(':')[1]),p=sourceWorldPoint(mark,{trigger:true}),b=p.bounds,actor=sourceWorldPoint(mark);if(b){c.save();c.strokeStyle='rgba(242,211,104,.95)';c.fillStyle='rgba(242,211,104,.08)';c.setLineDash([3,2]);c.beginPath();c.moveTo(actor.x,actor.y);c.lineTo(p.x,p.y);c.stroke();c.setLineDash([]);c.fillRect(b.x,b.y,b.width,b.height);c.strokeRect(b.x+.5,b.y+.5,b.width-1,b.height-1);c.fillStyle='#fff0aa';c.font='7px monospace';c.fillText(`MARK ${mark} ACTIVATOR`,b.x+3,b.y-4);c.restore()}}
  if(selectedIds.has('hero:hero')){c.strokeRect(hero.x-8.5,hero.y-20.5,17,21);handles(c,{x:hero.x-8,y:hero.y-20,width:16,height:20})}
  if(gesture?.type==='marquee'){const x=Math.min(gesture.start.x,gesture.current.x),y=Math.min(gesture.start.y,gesture.current.y),w=Math.abs(gesture.current.x-gesture.start.x),h=Math.abs(gesture.current.y-gesture.start.y);c.setLineDash([3,2]);c.fillStyle='rgba(229,189,71,.08)';c.fillRect(x,y,w,h);c.strokeRect(x+.5,y+.5,w,h)}
  if(gesture?.type==='region-select'){const r=regionSelectionFromPoints(gesture.start,gesture.current,gesture.mode,docBounds());if(r){c.setLineDash([4,2]);c.fillStyle='rgba(229,189,71,.10)';c.fillRect(r.x,r.y,r.width,r.height);c.strokeRect(r.x+.5,r.y+.5,r.width-1,r.height-1);}}
  if(tool==='scissors'&&smartScissorsMode!=='repair'&&smartScissorsTransferSelection){const b=smartScissorsTransferSelection;c.save();c.setLineDash([4,2]);c.strokeStyle='#70ddd5';c.fillStyle='rgba(112,221,213,.08)';c.fillRect(b.x,b.y,b.width,b.height);c.strokeRect(b.x+.5,b.y+.5,b.width-1,b.height-1);c.restore();}
  if(gesture?.type==='rectangle'||gesture?.type==='fill-frame'||gesture?.type==='smart-scissors'||gesture?.type==='smart-scissors-cut-select'){const scissors=gesture?.type==='smart-scissors'||gesture?.type==='smart-scissors-cut-select',grid=scissors?8:((terrainPaintMode()||stampPaintMode())?16:selectedRawGrid()),x0=Math.floor(Math.min(gesture.start.x,gesture.current.x)/grid)*grid,y0=Math.floor(Math.min(gesture.start.y,gesture.current.y)/grid)*grid,x1=Math.floor(Math.max(gesture.start.x,gesture.current.x)/grid)*grid+grid,y1=Math.floor(Math.max(gesture.start.y,gesture.current.y)/grid)*grid+grid;c.setLineDash(gesture?.type==='fill-frame'?[4,2]:scissors?[2,2]:[3,2]);c.strokeStyle=scissors?'#70ddd5':'#f4d45c';c.fillStyle=scissors?'rgba(112,221,213,.10)':'rgba(229,189,71,.08)';c.fillRect(x0,y0,x1-x0,y1-y0);c.strokeRect(x0+.5,y0+.5,x1-x0,y1-y0)}
  if(gesture?.type==='smart-scissors-cut-transfer'){const source=gesture.sourceBounds,destination=gesture.destination||source;c.save();c.setLineDash([4,2]);c.strokeStyle='#8cdb92';c.fillStyle='rgba(140,219,146,.10)';c.fillRect(destination.x,destination.y,destination.width,destination.height);c.strokeRect(destination.x+.5,destination.y+.5,destination.width-1,destination.height-1);if(gesture.mode==='move'){const voidRects=smartScissorsVoidRects(source,destination);c.setLineDash([2,2]);c.strokeStyle='#f0bd68';c.fillStyle='rgba(240,189,104,.09)';for(const row of voidRects){c.fillRect(row.x,row.y,row.width,row.height);c.strokeRect(row.x+.5,row.y+.5,row.width-1,row.height-1)}}c.restore();}
  if(gesture?.type==='collision-select'){
    const grid=collisionSelectionGrid(),x0=Math.floor(Math.min(gesture.start.x,gesture.current.x)/grid)*grid,y0=Math.floor(Math.min(gesture.start.y,gesture.current.y)/grid)*grid,x1=Math.floor(Math.max(gesture.start.x,gesture.current.x)/grid)*grid+grid,y1=Math.floor(Math.max(gesture.start.y,gesture.current.y)/grid)*grid+grid;c.setLineDash([4,2]);c.strokeStyle='#70ddd5';c.fillStyle='rgba(85,199,192,.11)';c.fillRect(x0,y0,x1-x0,y1-y0);c.strokeRect(x0+.5,y0+.5,x1-x0,y1-y0);
  }
  c.restore();
}
function handles(c,b){for(const [x,y] of [[b.x,b.y],[b.x+b.width,b.y],[b.x,b.y+b.height],[b.x+b.width,b.y+b.height]]){c.fillStyle='#111';c.fillRect(x-2,y-2,5,5);c.strokeRect(x-2.5,y-2.5,5,5)}}

function renderNavigator(){
  const nav=ctx.navigator,src=ui.background_canvas,behind=ui.foreground_behind_canvas,fg=ui.foreground_canvas;nav.clearRect(0,0,160,100);nav.fillStyle='#020305';nav.fillRect(0,0,160,100);
  const scale=Math.min(160/src.width,100/src.height);const w=src.width*scale,h=src.height*scale,x=(160-w)/2,y=(100-h)/2;nav.imageSmoothingEnabled=false;nav.globalAlpha=.85;nav.drawImage(src,0,0,src.width,src.height,x,y,w,h);nav.drawImage(behind,0,0,behind.width,behind.height,x,y,w,h);nav.drawImage(fg,0,0,fg.width,fg.height,x,y,w,h);nav.globalAlpha=1;
  const scroll=ui.viewport_scroll;const sw=Math.min(w,scroll.clientWidth/(src.width*zoom)*w),sh=Math.min(h,scroll.clientHeight/(src.height*zoom)*h);const sx=x+(scroll.scrollLeft/(src.width*zoom))*w,sy=y+(scroll.scrollTop/(src.height*zoom))*h;ui.navigator_window.style.left=`${sx+1}px`;ui.navigator_window.style.top=`${sy+1}px`;ui.navigator_window.style.width=`${Math.max(4,sw)}px`;ui.navigator_window.style.height=`${Math.max(4,sh)}px`;
}

function layerStageRenderPlan(stage=diagnosticLayerStage()){
  switch(String(stage||'')){
    case 'A': return {staticRenderer:resources.rawPreview,actorRenderer:resources.rawPreview,classicStatic:false,classicActors:false};
    case 'B': return {staticRenderer:resources.classicPreview,actorRenderer:resources.classicPreview,classicStatic:true,classicActors:true,classicProjection:'none'};
    case 'C': return {staticRenderer:resources.classicPreview,actorRenderer:resources.classicPreview,classicStatic:true,classicActors:true,classicProjection:'dense'};
    case 'D': return {staticRenderer:resources.preview,actorRenderer:resources.classicPreview,classicStatic:false,classicActors:true,classicProjection:'dense'};
    case 'E': return {staticRenderer:resources.previewE||resources.preview,actorRenderer:resources.previewE||resources.preview,classicStatic:false,classicActors:false};
    case 'F': return {staticRenderer:resources.preview,actorRenderer:resources.preview,classicStatic:false,classicActors:false};
    default:return null;
  }
}

function depthPreviewLayerVisible(layer){
  const mode=depthPreviewMode;
  if(mode==='full'||mode==='split'||mode==='seed')return presentationVisibility[layer]!==false;
  if(mode==='actors')return (layer==='embeddedActors'||layer==='actors'||layer==='frontActors')&&presentationVisibility[layer]!==false;
  if(mode==='behind')return (layer==='backdrop'||layer==='midground')&&presentationVisibility[layer]!==false;
  return mode===layer&&presentationVisibility[layer]!==false;
}
function renderActorsOnly(){
  if(!resources||!store) return;
  const previewTick=effectivePreviewTick(),simulate=previewMotionEnabled();
  resources.preview.setActivateAllTraps(simulate);resources.previewE?.setActivateAllTraps(simulate);resources.classicPreview?.setActivateAllTraps(simulate);resources.rawPreview?.setActivateAllTraps(simulate);
  const stage=diagnosticLayerStage(),plan=layerStageRenderPlan(stage),classic=plan?.classicActors?resources.classicPreview:(previewPresentation==='classic'&&resources.classicPreview),rdxDynamic=resources.preview.dynamicFrame(previewTick),activeRenderer=plan?.actorRenderer||(classic?resources.classicPreview:resources.preview),dynamic=activeRenderer?.dynamicFrame(previewTick)||null,classicProjection=classic?(plan?.classicProjection||'dense'):'none';lastDynamic=dynamic;lastDynamicRenderer=activeRenderer||resources.preview;lastPreviewTick=previewTick;lastDynamicClassicProjection=classicProjection;sourceSelectables=(dynamic?.selectables||[]).map(item=>classicSelectableProjection(item,classicProjection));
  ctx.embeddedActors.clearRect(0,0,ctx.embeddedActors.canvas.width,ctx.embeddedActors.canvas.height);ctx.actors.clearRect(0,0,ctx.actors.canvas.width,ctx.actors.canvas.height);ctx.frontActors.clearRect(0,0,ctx.frontActors.canvas.width,ctx.frontActors.canvas.height);
  const semanticPreview=!stage&&previewPresentation==='rdx',showEmbeddedActors=!semanticPreview||depthPreviewLayerVisible('embeddedActors'),showActors=!semanticPreview||depthPreviewLayerVisible('actors'),showFrontActors=!semanticPreview||depthPreviewLayerVisible('frontActors');
  if(store.document.layers.entities.visible&&dynamic){const behindPixels=classicBufferProjection(dynamic.behindMidgroundPixels,classicProjection),pixels=classicBufferProjection(dynamic.pixels,classicProjection),frontPixels=classicBufferProjection(dynamic.frontPixels,classicProjection),bounds=displayBounds();if(showEmbeddedActors&&behindPixels)bufferToCanvas(behindPixels,ctx.embeddedActors,bounds.width,bounds.height);if(showActors)bufferToCanvas(pixels,ctx.actors,bounds.width,bounds.height);if(showFrontActors)bufferToCanvas(frontPixels,ctx.frontActors,bounds.width,bounds.height);if(!stage&&showActors)drawCustomEntities(rdxDynamic,previewTick);}
  if(!stage&&(showEmbeddedActors||showActors||showFrontActors)&&rawRdxRegions().some(region=>region.mode==='all')){configureRawPreview();applyRawRdxActorRegions(resources.rawPreview.dynamicFrame(previewTick));}
  renderEditorOverlay();
}
function renderScene(){
  if(!resources||!store) return; configureRenderer();sizeStage();
  const previewTick=effectivePreviewTick();
  const stage=diagnosticLayerStage(),plan=layerStageRenderPlan(stage),classic=plan?.classicStatic?resources.classicPreview:(previewPresentation==='classic'&&resources.classicPreview),renderer=plan?.staticRenderer||(classic?resources.classicPreview:resources.preview),layers=renderer.staticLayers(renderer.staticPhaseAtTick(previewTick)),classicProjection=classic?(plan?.classicProjection||'dense'):'none';
  const bounds=displayBounds(),semanticPreview=!stage&&!classic;lastStaticLayers=layers;lastPresentationSeed=null;
  const backdrop=layers.backdrop||layers.background,midground=layers.midground||layers.foregroundBehindActors,foreground=layers.foreground;
  const showBackdrop=!semanticPreview||depthPreviewLayerVisible('backdrop'),showMidground=!semanticPreview||depthPreviewLayerVisible('midground'),showForeground=!semanticPreview||depthPreviewLayerVisible('foreground');
  if(showBackdrop&&store.document.layers.background.visible&&backdrop)bufferToCanvas(classicBufferProjection(backdrop,classicProjection,{showDisconnected:true}),ctx.background,bounds.width,bounds.height);else ctx.background.clearRect(0,0,ctx.background.canvas.width,ctx.background.canvas.height);
  if(showMidground&&(store.document.layers.background.visible||store.document.layers.foreground.visible)&&midground)bufferToCanvas(classicBufferProjection(midground,classicProjection),ctx.foregroundBehind,bounds.width,bounds.height);else ctx.foregroundBehind.clearRect(0,0,ctx.foregroundBehind.canvas.width,ctx.foregroundBehind.canvas.height);
  renderActorsOnly();
  if(showForeground&&store.document.layers.foreground.visible&&foreground)bufferToCanvas(classicBufferProjection(foreground,classicProjection),ctx.foreground,bounds.width,bounds.height);else ctx.foreground.clearRect(0,0,ctx.foreground.canvas.width,ctx.foreground.canvas.height);
  if(!stage&&hasRawRdxRegions()){configureRawPreview();applyRawRdxStaticRegions(resources.rawPreview.staticLayers(resources.rawPreview.staticPhaseAtTick(previewTick)));}
  renderEditorOverlay();renderNavigator();renderChrome();
}
function scheduleRender(){if(renderPending)return;renderPending=true;requestAnimationFrame(()=>{renderPending=false;renderScene()});}
function animate(now){if(playtest.active)renderPlaytest();else if(resources&&store&&store.document.settings.simulatePreview)updateNativeSimulation();else simulationClock.setPaused(true);requestAnimationFrame(animate)}

function renderChrome(){
  const d=store.document,stage=diagnosticLayerStage(),stageInfo=diagnosticLayerStageInfo(stage),edits=d.terrain.length+(d.terrainRelations?.length||0)+(d.stamps?.length||0)+d.tiles.length+d.collision.length+(d.gameplayCollision?.length||0)+(d.presentationDepthOverrides?.length||0)+d.sourceEntityOverrides.length+(d.systemPatchRemovals?.length||0),rawRegions=rawRdxRegions(),mixed=!stage&&systemModificationsEnabled&&rawRegions.length>0;
  ui.system_modifications_toggle.checked=stage?stage!=='A':mixed?false:systemModificationsEnabled;ui.system_modifications_toggle.indeterminate=mixed;ui.system_modifications_toggle.disabled=!!stage;
  const classicDisconnected=previewPresentation==='classic'?' · grey = no 1:1 Classic correspondence':'';
  ui.authority_label.textContent=stage?`Layers inspection · ${stageInfo.caption}`:(mixed?`View = raw RDX in ${rawRegions.length} reset region${rawRegions.length===1?'':'s'} · effective elsewhere + draft`:systemModificationsEnabled?'View = effective A–F layers + draft':'View = raw decoded RDX + draft')+classicDisconnected;
  ui.authority_label.title=stage?stageInfo.help:(mixed?'Selected reset regions are decoded-RDX inspection windows; effective A–F layers remain applied elsewhere.':systemModificationsEnabled?'Resolved alignment, structure, semantics, placement and bounds are applied.':'Effective layers are withheld so the viewport exposes the decoded RDX baseline.')+(previewPresentation==='classic'?' Grey panels mark RDX editor cells with no bijective Classic 8×8 counterpart; Classic artwork is never duplicated to fill them.':'');
  ui.scene_summary.textContent=`${d.entities.length+sourceEntityRows().filter(e=>!sourceSuppressed(e.mark)).length} actors · ${reviewedSceneryRows().length} RDX scenery · ${d.terrain.length} terrain · ${d.terrainRelations?.length||0} smart links · ${d.stamps?.length||0} stamps · ${d.tiles.length} raw tile edits`;
  ui.host_room_label.textContent=`${sm(d.base.submap)} · ${md(d.base.mapId)}${d.base.blank?' · blank':''}`;ui.level_size_label.textContent=`${d.bounds.width} × ${d.bounds.height}`;ui.hero_label.textContent=`${Math.round(d.heroStart.x)}, ${Math.round(d.heroStart.y)}`;
  ui.level_breadcrumb.textContent=d.name;ui.room_breadcrumb.textContent=`${sm(d.base.submap)} → ${md(d.base.mapId)}`;ui.doc_stats.textContent=`${edits} edits · ${d.entities.length} custom entities`;
  const orderedRooms=resources.manifest.rooms||[],roomIndex=orderedRooms.findIndex(row=>Number(row.submap)===Number(d.base.submap));if(ui.previous_room)ui.previous_room.disabled=roomIndex<=0;if(ui.next_room)ui.next_room.disabled=roomIndex<0||roomIndex>=orderedRooms.length-1;
  ui.simulate_toggle.checked=!!d.settings.simulatePreview;if(ui.depth_preview_mode){ui.depth_preview_mode.value=depthPreviewMode;ui.depth_preview_mode.disabled=!!stage||previewPresentation==='classic';}if(ui.depth_view_toggle){const depthActive=depthPreviewMode==='split'||depthPreviewMode==='seed'||depthView;ui.depth_view_toggle.classList.toggle('active',depthActive);ui.depth_view_toggle.setAttribute('aria-pressed',depthActive?'true':'false');ui.depth_view_toggle.title=depthActive?'Return to full presentation preview':'Show presentation band tint';}if(ui.presentation_view_toggle){const classic=previewPresentation==='classic';ui.presentation_view_toggle.disabled=!!stage;ui.presentation_view_toggle.classList.toggle('active',classic);ui.presentation_view_toggle.setAttribute('aria-pressed',classic?'true':'false');ui.presentation_view_toggle.title=stage?'Presentation toggle is fixed while inspecting a production layer stage.':classic?'Show aligned RDX presentation':'Show aligned Classic presentation';ui.presentation_view_toggle.setAttribute('aria-label',ui.presentation_view_toggle.title)}ui.snap_toggle.checked=!!d.settings.snap;ui.undo.disabled=!store.canUndo();ui.redo.disabled=!store.canRedo();markDirty();renderSceneTree();renderChanges();renderInspector();renderDebugNoteDock();
  // Diagnostics is an auxiliary review surface. Keep it out of the normal
  // editor render path so a diagnostics regression cannot disable scene/entity
  // authoring, changes, or the inspector. It refreshes on entry and while active.
  if(diagnostics.active)renderDiagnosticsWorkspace();
}
function entityHasActivator(e){const n=Number(e?.entity??e?.n??0)&0x7f;return !!(Number(e?.flags||0)&0xf0)||n===0x16||n===0x17||Number(e?.triggerX)!==Number(e?.x)||Number(e?.triggerY)!==Number(e?.y);}
function triggerFlagLabel(flags){const out=[];if(flags&ENTITY_FLAGS.triggerBomb)out.push('bomb');if(flags&ENTITY_FLAGS.triggerBullet)out.push('bullet');if(flags&ENTITY_FLAGS.triggerStop)out.push('stop');if(flags&ENTITY_FLAGS.triggerRick)out.push('Rick');return out.join(' + ')||'no trigger flag';}
function renderSceneTree(){
  const d=store.document,src=sourceEntityRows(),custom=d.entities,scenery=reviewedSceneryRows(),html=[];
  const depthModel=resolvedPresentationDepth(),depthRows=presentationDepthRows(),depthClasses=depthModel?.classes||[];
  const visibilityButton=key=>`<button class="scene-action" data-presentation-visible="${key}" title="Toggle ${key} visibility">${presentationVisibility[key]!==false?'◉':'○'}</button><button class="scene-action" data-presentation-solo="${key}" title="Solo ${key}">S</button>`;
  const appendDepthGroup=(band,icon,label)=>{const classes=depthClasses.filter(row=>row.band===band),overrides=depthRows.filter(row=>row.band===band),defaults=[];if(depthModel?.planeDefaults?.B===band)defaults.push('B default');if(depthModel?.planeDefaults?.A===band)defaults.push('A default');const count=classes.length+overrides.length;html.push(`<div class="tree-section"><div class="scene-row" data-scene-kind="depth-group" data-scene-id="${band}"><span class="disclosure">⌄</span><span class="layer-icon">${icon}</span><span class="scene-name">${label}</span><span class="count">${count||escapeHtml(defaults.join(' · ')||'empty')}</span>${visibilityButton(band)}</div>`);for(const rule of classes){const sid=`class:${rule.id}`,sel=selection.some(s=>s.kind==='presentation-depth-class'&&s.id===sid);html.push(`<div class="tree-child"><div class="scene-row ${sel?'selected':''}" data-scene-kind="presentation-depth-class" data-scene-id="${escapeHtml(sid)}"><span class="disclosure">·</span><span class="layer-icon">◆</span><span class="scene-name">${escapeHtml(rule.label||rule.id)}</span><span class="count">${escapeHtml(String(rule.plane).toUpperCase())} · global</span></div></div>`)}for(const row of overrides){const sel=selection.some(s=>s.kind==='presentation-depth'&&s.id===row.selectionId),b=row.bounds;html.push(`<div class="tree-child"><div class="scene-row ${sel?'selected':''}" data-scene-kind="presentation-depth" data-scene-id="${escapeHtml(row.selectionId)}"><span class="disclosure">·</span><span class="layer-icon">${row.origin==='draft'?'✎':'✓'}</span><span class="scene-name">${escapeHtml(row.id)}</span><span class="count">${escapeHtml(String(row.plane).toUpperCase())} · ${b[0]},${b[1]} ${b[2]}×${b[3]}</span></div></div>`)}html.push('</div>');};
  appendDepthGroup('backdrop','▧','Background — Backdrop');
  const embeddedCustom=[],normalCustom=custom.filter(e=>!e.front),frontCustom=custom.filter(e=>e.front),embeddedSource=src.filter(e=>!sourceSuppressed(e.mark)&&sourceEffectiveLayer(e.mark)==='behind-midground'),normalSource=src.filter(e=>!sourceSuppressed(e.mark)&&sourceEffectiveLayer(e.mark)==='normal'),frontSource=src.filter(e=>!sourceSuppressed(e.mark)&&sourceEffectiveLayer(e.mark)==='front');
  const appendActorGroup=(key,label,rowsCustom,rowsSource)=>{html.push(`<div class="tree-section"><div class="scene-row" data-scene-kind="actor-group" data-scene-id="${key}"><span class="disclosure">⌄</span><span class="layer-icon">♟</span><span class="scene-name">${label}</span><span class="count">${rowsCustom.length+rowsSource.length}</span>${visibilityButton(key)}</div>`);for(const e of rowsCustom){const sel=selection.some(s=>s.kind==='entity'&&s.id===e.id),asel=selection.some(s=>s.kind==='activator'&&s.id===e.id);html.push(`<div class="tree-child entity-branch"><div class="scene-row ${sel?'selected':''}" data-scene-kind="entity" data-scene-id="${e.id}"><span class="disclosure">${entityHasActivator(e)?'⌄':''}</span><span class="layer-icon">◇</span><span class="scene-name">${escapeHtml(e.name)}</span><span class="count">draft</span></div>${entityHasActivator(e)?`<div class="tree-grandchild"><div class="scene-row activator-row ${asel?'selected':''}" data-scene-kind="activator" data-scene-id="${e.id}"><span class="disclosure">↳</span><span class="layer-icon">◎</span><span class="scene-name">Connected activator</span><span class="count">${escapeHtml(triggerFlagLabel(e.flags))}</span></div></div>`:''}</div>`)}for(const e of rowsSource){const keyId=`mark:${e.mark}`,sel=selection.some(s=>s.kind==='source'&&s.id===keyId),asel=selection.some(s=>s.kind==='source-activator'&&s.id===keyId),has=entityHasActivator(e);html.push(`<div class="tree-child entity-branch"><div class="scene-row ${sel?'selected':''}" data-scene-kind="source" data-scene-id="${keyId}"><span class="disclosure">${has?'⌄':''}</span><span class="layer-icon">◈</span><span class="scene-name">Source mark ${e.mark} · 0x${Number(e.entity).toString(16).padStart(2,'0')}</span><span class="count">ROM</span></div>${has?`<div class="tree-grandchild"><div class="scene-row activator-row ${asel?'selected':''}" data-scene-kind="source-activator" data-scene-id="${keyId}"><span class="disclosure">↳</span><span class="layer-icon">◎</span><span class="scene-name">Connected activator</span><span class="count">${escapeHtml(triggerFlagLabel(Number(e.flags||0)))}</span></div></div>`:''}</div>`)}html.push('</div>');};
  appendActorGroup('embeddedActors','Embedded actors',embeddedCustom,embeddedSource);
  appendDepthGroup('midground','◫','Background — Midground');
  const gameplay=d.layers.gameplay,gameplaySelected=selection.some(s=>s.kind==='layer'&&s.id==='gameplay');html.push(`<div class="scene-row ${gameplaySelected?'selected':''}" data-scene-kind="layer" data-scene-id="gameplay"><span class="disclosure">·</span><span class="layer-icon">▦</span><span class="scene-name">Gameplay collision</span><button class="scene-action" data-layer-visible="gameplay" title="Visibility">${gameplay.visible?'◉':'○'}</button><button class="scene-action" data-layer-lock="gameplay" title="Lock">${gameplay.locked?'🔒':'·'}</button></div>`);
  appendActorGroup('actors','Actors',normalCustom,normalSource);
  appendDepthGroup('foreground','▨','Foreground');
  appendActorGroup('frontActors','Front actors',frontCustom,frontSource);
  const transitions=nativeTransitionRows();
  if(transitions.length){html.push(`<div class="tree-section"><div class="scene-row" data-scene-kind="group" data-scene-id="native-transitions"><span class="disclosure">⌄</span><span class="layer-icon">⇄</span><span class="scene-name">Transitions</span><span class="count">${transitions.length}</span></div>`);for(const row of transitions){const sel=selection.some(s=>s.kind==='native-transition'&&String(s.id)===String(row.id)),route=transitionRoomLabel(row.targetSubmap),arrow=row.side==='left'?'←':'→',name=`${arrow} row 0x${row.rowout.toString(16).padStart(2,'0')} → ${route}`,detail=`in 0x${row.rowin.toString(16).padStart(2,'0')}`;html.push(`<div class="tree-child"><div class="scene-row ${sel?'selected':''}" data-scene-kind="native-transition" data-scene-id="${escapeHtml(row.id)}"><span class="disclosure">·</span><span class="layer-icon">${arrow}</span><span class="scene-name">${name}</span><span class="count">${detail}</span></div></div>`)}html.push('</div>');}
  if(scenery.length){html.push(`<div class="tree-section"><div class="scene-row" data-scene-kind="group" data-scene-id="scenery"><span class="disclosure">⌄</span><span class="layer-icon">▤</span><span class="scene-name">RDX scenery</span><span class="count">${scenery.length}</span></div>`);for(const row of scenery){const key=String(row.sourceKey||`map-visual:${row.id}`),eff=effectiveScenery(row),sel=selection.some(s=>s.kind==='scenery'&&s.id===key);html.push(`<div class="tree-child"><div class="scene-row ${sel?'selected':''}" data-scene-kind="scenery" data-scene-id="${escapeHtml(key)}"><span class="disclosure">·</span><span class="layer-icon">▧</span><span class="scene-name">${escapeHtml(key)}</span><span class="count">PN ${eff.pn}</span></div></div>`)}html.push('</div>')}
  const hsel=selection.some(s=>s.kind==='hero');html.push(`<div class="scene-row ${hsel?'selected':''}" data-scene-kind="hero" data-scene-id="hero"><span class="disclosure">·</span><span class="layer-icon">◆</span><span class="scene-name">Hero start</span><span class="count">${Math.round(d.heroStart.x)},${Math.round(d.heroStart.y)}</span></div>`);
  ui.scene_tree.innerHTML=html.join('');
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

function entityCatalogRow(entityN){return resources?.entityCatalog?.entities?.find(e=>Number(e.entity)===Number(entityN))||null;}
function entityTypeOptions(selected){return (resources?.entityCatalog?.entities||[]).map(e=>`<option value="${e.entity}" ${Number(selected)===Number(e.entity)?'selected':''}>${escapeHtml(entityTypeOptionLabel(e))}</option>`).join('');}
function pnCatalogRows(){return (resources?.spriteDecoder?.parsePnCatalog?.()||[]).filter(r=>r.start!=null);}
function pnRowLabel(row,recommended=new Set()){
  if(!row)return 'Unassigned / native mapping';
  return `PN ${row.index}${recommended.has(Number(row.index))?' · recommended':''}`;
}
function pnRowMeta(row){return row?`${row.count||0} frame${row.count===1?'':'s'} · ${row.direction}`:'Use the production/native mapping until a PN is assigned.';}
function pnPickerHtml(selected,recommended=[],{sourceMark=null,pickerKind=null,allowUnassigned=true,state=null}={}){
  const rec=new Set((recommended||[]).map(Number)),rows=pnCatalogRows(),pn=Number(selected),current=rows.find(r=>Number(r.index)===pn)||null,currentPn=current?Number(current.index):-1;
  const options=(allowUnassigned?[`<button type="button" class="sprite-picker-option ${currentPn<0?'selected':''}" data-pn-choice="-1"><span class="sprite-picker-thumb empty" data-pn-thumb="-1">—</span><span><strong>Unassigned / native mapping</strong><small>Use the production/native mapping.</small></span></button>`]:[]).concat(rows.map(r=>`<button type="button" class="sprite-picker-option ${currentPn===Number(r.index)?'selected':''}" data-pn-choice="${r.index}"><span class="sprite-picker-thumb" data-pn-thumb="${r.index}"></span><span><strong>${pnRowLabel(r,rec)}</strong><small>${pnRowMeta(r)}</small></span></button>`)).join('');
  const hidden=sourceMark==null?'':`<input type="hidden" id="source-sprite-select" data-source-sprite="${sourceMark}" value="${currentPn}">`;
  const stateAttrs=state?` data-state-source-key="${escapeHtml(state.sourceKey)}" data-state-key="${escapeHtml(state.stateKey)}" data-state-source-pn="${Number(state.sourcePn)}"`:'';
  return `<div class="sprite-picker" data-sprite-picker="${pickerKind|| (sourceMark==null?'entity':'source')}"${stateAttrs}>${hidden}<button type="button" class="sprite-picker-current" data-sprite-picker-toggle aria-expanded="false"><span class="sprite-picker-thumb ${currentPn<0?'empty':''}" data-pn-thumb="${currentPn}">${currentPn<0?'—':''}</span><span class="sprite-picker-current-copy"><strong>${pnRowLabel(current,rec)}</strong><small>${pnRowMeta(current)}</small></span><span class="sprite-picker-chevron">⌄</span></button><div class="sprite-picker-menu" hidden>${options}</div></div>`;
}
function renderPnThumbs(root=ui.inspector_content){
  if(!root||!resources?.spriteDecoder||!store)return;
  for(const host of root.querySelectorAll('[data-pn-thumb]:not([data-pn-thumb-ready])')){
    const pn=Number(host.dataset.pnThumb);host.dataset.pnThumbReady='1';if(pn<0)continue;
    const f=resources.spriteDecoder.frameForPn(pn,0,currentPalette());if(!f)continue;
    const c=document.createElement('canvas');c.width=f.pixels.width;c.height=f.pixels.height;c.getContext('2d').putImageData(new ImageData(f.pixels.data,f.pixels.width,f.pixels.height),0,0);host.replaceChildren(c);
  }
}
function entityFramePickerHtml(entity){
  const pn=Number(entity.pn),row=pnCatalogRows().find(r=>Number(r.index)===pn),count=Number(row?.count||0),selected=Number(entity.frameIndex??-1);if(pn<0||count<=1)return '';
  const buttons=[`<button type="button" class="frame-choice ${selected<0?'selected':''}" data-frame-choice="-1"><span class="frame-auto">↻</span><small>Auto</small></button>`];
  for(let i=0;i<count;i++)buttons.push(`<button type="button" class="frame-choice ${selected===i?'selected':''}" data-frame-choice="${i}"><span class="frame-thumb" data-frame-thumb="${i}" data-frame-pn="${pn}"></span><small>${i+1}</small></button>`);
  return `<div class="presentation-subgroup"><div class="presentation-subhead"><span>Animation frame</span><small>${selected<0?'Timeline':'Pinned frame '+(selected+1)}</small></div><div class="frame-strip">${buttons.join('')}</div><p class="property-help">Auto follows the PN timeline. Pin a frame for binary/on-off presentation states or exact authored poses.</p></div>`;
}
function renderEntityFrameThumbs(root=ui.inspector_content){
  const s=primarySelection();let entity=s?.kind==='entity'?store.document.entities.find(x=>x.id===s.id):null;
  if(s?.kind==='scenery'){const base=reviewedSceneryRows().find(row=>String(row.sourceKey||`map-visual:${row.id}`)===String(s.id));if(base)entity=effectiveScenery(base)}
  if(!entity||!root)return;
  const animation=resources.spriteDecoder.framesForPn(Number(entity.pn),currentPalette(),{mirrorX:!!entity.mirrorX,mirrorY:!!entity.mirrorY});
  for(const host of root.querySelectorAll('[data-frame-thumb]:not([data-frame-thumb-ready])')){const i=Number(host.dataset.frameThumb),f=animation.frames[i];host.dataset.frameThumbReady='1';if(!f)continue;const c=document.createElement('canvas');c.width=f.pixels.width;c.height=f.pixels.height;c.getContext('2d').putImageData(new ImageData(f.pixels.data,f.pixels.width,f.pixels.height),0,0);host.replaceChildren(c)}
}
function setSourceSpritePickerValue(picker,pn){
  const rows=pnCatalogRows(),row=rows.find(r=>Number(r.index)===Number(pn))||null,value=row?Number(row.index):-1,input=picker.querySelector('#source-sprite-select'),current=picker.querySelector('.sprite-picker-current'),menu=picker.querySelector('.sprite-picker-menu');
  if(input)input.value=String(value);picker.querySelectorAll('[data-pn-choice]').forEach(b=>b.classList.toggle('selected',Number(b.dataset.pnChoice)===value));
  const selected=picker.querySelector(`[data-pn-choice="${value}"]`),thumb=current?.querySelector('[data-pn-thumb]'),copy=current?.querySelector('.sprite-picker-current-copy');if(thumb){thumb.dataset.pnThumb=String(value);thumb.classList.toggle('empty',value<0);thumb.replaceChildren();delete thumb.dataset.pnThumbReady;if(value<0)thumb.textContent='—';renderPnThumbs(current)}if(copy){copy.querySelector('strong').textContent=selected?.querySelector('strong')?.textContent||pnRowLabel(row);copy.querySelector('small').textContent=selected?.querySelector('small')?.textContent||pnRowMeta(row)}if(menu)menu.hidden=true;if(current)current.setAttribute('aria-expanded','false');
}
function descriptorCollisionBase(logicX,logicY){
  if(!resources||!store)return 'pass-through';
  const mapId=store.document.base.mapId,dim=resources.mapDecoder.logicDimensions(mapId),mt=resources.rom.payload('MT',mapId),ml=resources.rom.payload('ML',mapId);
  const x=Number(logicX),y=Number(logicY);if(x<0||y<0||x>=dim.width||y>=dim.height)return 'pass-through';
  const i=y*dim.width+x,m=mt[i]||0,l=ml[i]||0;
  if((m&0x80)&&l===0x14)return 'exit';
  const top=projectRdxDescriptor(m,l,0).flags,bottom=projectRdxDescriptor(m,l,1).flags,combined=top|bottom;
  if(combined&MAP_EFLG.LETHAL)return 'lethal';
  if(combined&(MAP_EFLG.CLIMB|MAP_EFLG.VERT))return 'climb-through';
  if(combined&MAP_EFLG.SOLID)return 'solid';
  if(combined&MAP_EFLG.WAYUP)return 'one-way';
  return 'pass-through';
}
function collisionOverrideAt(logicX,logicY){return store.document.collision.find(c=>Number(c.logic?.[0])===Number(logicX)&&Number(c.logic?.[1])===Number(logicY))||null;}
function gameplayCollisionOverrideAt(g8X,g8Y){return (store.document.gameplayCollision||[]).find(c=>Number(c.g8?.[0])===Number(g8X)&&Number(c.g8?.[1])===Number(g8Y))||null;}
function terrainCollisionAt(logicX,logicY){const cell=store.document.terrain?.find(t=>Number(t.cell?.[0])===Number(logicX)-1&&Number(t.cell?.[1])===Number(logicY)-1);if(!cell||cell.collisionMode!=='catalog')return null;const set=terrainSetById(resources?.autotileCatalog,cell.terrainSet);return set&&set.collision&&set.collision!=='preserve'?set.collision:null;}
function collisionEffective(logicX,logicY){return collisionOverrideAt(logicX,logicY)?.collision||terrainCollisionAt(logicX,logicY)||descriptorCollisionBase(logicX,logicY);}
function gameplayCollisionEffective(g8X,g8Y){const own=gameplayCollisionOverrideAt(g8X,g8Y);if(own)return own.action;const cell=resources?.preview?.geometryCellAt?.(Number(g8X)*8+4,Number(g8Y)*8+4,{includeOpen:true,includeProvenance:false});return cell?.kindName||'open';}
function collisionSelectionItem(logicX,logicY){const lx=Number(logicX),ly=Number(logicY);return {kind:'collision',id:`logic:${lx}:${ly}`,logic:[lx,ly]};}
function gameplayCollisionSelectionItem(g8X,g8Y){const gx=Number(g8X),gy=Number(g8Y);return {kind:'gameplay-collision',id:`g8:${gx}:${gy}`,g8:[gx,gy]};}
function collisionSelections(){return selection.filter(s=>s.kind==='collision'||s.kind==='gameplay-collision');}
function collisionSelectionGrid(){return collisionAuthoring==='gameplay'?8:16;}
function centerOnLogical(x,y){const sc=ui.viewport_scroll;sc.scrollLeft=Math.max(0,x*zoom-sc.clientWidth/2);sc.scrollTop=Math.max(0,y*zoom-sc.clientHeight/2);renderNavigator();}
function sourceWorldPoint(mark,{trigger=false}={}){
  const key=`mark:${Number(mark)}`,row=sourceEntityRows().find(e=>Number(e.mark)===Number(mark));
  if(trigger&&Array.isArray(row?.triggerBounds)){const b=row.triggerBounds,bounds=alignedClassicBounds({x:Number(b[0]),y:Number(b[1]),width:Number(b[2]||0),height:Number(b[3]||0)});return {x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2,bounds};}
  const sel=sourceSelectables.find(x=>x.sourceKey===key),b=sel?.bounds;if(b)return {x:b.x+b.width/2,y:b.y+b.height/2,bounds:b};
  const p=alignedClassicPoint(Number(row?.x||0),Number(row?.y||0));return {x:p.x,y:p.y};
}
function centerSelectionItem(item){if(!item)return;if(item.kind==='entity'){const e=store.document.entities.find(x=>x.id===item.id);if(e)centerOnLogical(e.x,e.y);}else if(item.kind==='activator'){const e=store.document.entities.find(x=>x.id===item.id);if(e)centerOnLogical(e.triggerX,e.triggerY);}else if(item.kind==='source'||item.kind==='source-activator'){const p=sourceWorldPoint(Number(String(item.id).split(':')[1]),{trigger:item.kind==='source-activator'});centerOnLogical(p.x,p.y);}else if(item.kind==='scenery'){const row=reviewedSceneryRows().find(r=>String(r.sourceKey||`map-visual:${r.id}`)===String(item.id)),eff=row?effectiveScenery(row):null;if(eff)centerOnLogical(eff.origin[0],eff.origin[1]);}else if(item.kind==='native-transition'){const row=nativeTransitionRows().find(r=>String(r.id)===String(item.id));if(row)centerOnLogical(row.position[0],row.position[1]);}else if(item.kind==='presentation-depth'){const row=presentationDepthRowForSelection(item),b=row?.bounds;if(b)centerOnLogical(Number(b[0])+Number(b[2])/2,Number(b[1])+Number(b[3])/2);}else if(item.kind==='hero')centerOnLogical(store.document.heroStart.x,store.document.heroStart.y);}
function renderChanges(){
  if(!ui.changes_list||!store)return;const d=store.document,rows=[];
  for(const t of d.terrain)rows.push({group:'Terrain',kind:'terrain',id:t.id,cx:t.cell[0],cy:t.cell[1],label:`Terrain ${t.cell[0]}, ${t.cell[1]}`,detail:`${t.terrainSet} · ${t.collisionMode}`,icon:'▩'});
  for(const r of d.terrainRelations||[])if(r.type==='support')rows.push({group:'Construction',kind:'terrain-relation',id:r.id,cx:r.anchor[0],cy:r.anchor[1],label:`Support ${r.anchor[0]}, ${r.anchor[1]}`,detail:`${r.terrainSet} · down ${r.end[1]-r.anchor[1]} cells${r.prototypeId?` · ${r.prototypeId.split('.').slice(-1)[0]}`:''}`,icon:'│'});
  for(const p of d.stamps||[]){const stamp=stampById(resources?.stampCatalog,p.stampId);rows.push({group:'Stamps',kind:'stamp',id:p.id,cx:p.cell[0],cy:p.cell[1],label:stamp?.label||p.stampId,detail:`${p.cell.join(', ')} · ${stamp?.sizeCells?.join('×')||'?'} cells · terrain-aware`,icon:'▧'});}
  for(const c of d.collision)rows.push({group:'Collision',kind:'collision',id:`logic:${c.logic[0]}:${c.logic[1]}`,docId:c.id,logic:c.logic,label:`Logic ${c.logic[0]}, ${c.logic[1]}`,detail:`→ ${c.collision}`,icon:'▦'});
  for(const c of d.gameplayCollision||[])rows.push({group:'Collision',kind:'gameplay-collision',id:`g8:${c.g8[0]}:${c.g8[1]}`,docId:c.id,gx:c.g8[0],gy:c.g8[1],layer:'G8',label:`G8 ${c.g8[0]}, ${c.g8[1]}`,detail:`→ ${c.action}`,icon:'▦'});
  for(const t of d.tiles)rows.push({group:'Presentation',kind:'cell',id:`${t.layer}:${t.target[0]}:${t.target[1]}`,docId:t.id,gx:t.target[0],gy:t.target[1],layer:t.layer,label:`${t.layer} tile ${t.target[0]}, ${t.target[1]}`,detail:t.operation==='clear'?'cleared':`← ${md(t.sourceMapId)} ${t.sourceLayer} ${t.source?.join(',')}`,icon:t.layer==='A'?'▨':'▧'});
  for(const row of d.presentationDepthClassEdits||[]){const label=row.action==='remove'?'Inherit/default':`${row.band[0].toUpperCase()+row.band.slice(1)} for all matching`;rows.push({group:'Presentation depth',kind:'presentation-depth-class-edit',id:row.id,docId:row.id,globalTile:Number(row.globalTile),plane:String(row.plane).toUpperCase(),label,detail:`Plane ${row.plane} · global tile ${row.globalTile} · ${row.label||'shared identity'}`,icon:'◆'});}
  for(const row of d.presentationDepthOverrides||[]){const b=row.bounds||[0,0,0,0],meta={backdrop:['Backdrop','▧'],midground:['Midground','◫'],foreground:['Foreground','▨']}[row.band]||[row.band,'◇'];rows.push({group:'Presentation depth',kind:'presentation-depth',id:`draft:${row.id}`,docId:row.id,bounds:b,label:meta[0],detail:`Plane ${row.plane} · ${b[0]},${b[1]} ${b[2]}×${b[3]}`,icon:meta[1]});}
  for(const e of d.entities)rows.push({group:'Entities',kind:'entity',id:e.id,label:e.name,detail:`0x${Number(e.entity).toString(16).padStart(2,'0')} · ${Math.round(e.x)},${Math.round(e.y)}`,icon:'◇'});
  for(const o of d.sourceEntityOverrides){const placement=sourcePlacementOffset(o),stateOffsets=sourceStateVisualOffsets(o),statePresentations=normalizeStatePresentationOverrides(o),layer=sourceOcclusionLayer(o);if(sourceOverrideHasAuthoredChange(o))rows.push({group:'Entities',kind:'source',id:`mark:${o.mark}`,label:`Source mark ${o.mark}`,detail:[o.suppressed?'suppressed/converted':null,o.controllerEntity!=null?`enemy type → 0x${Number(o.controllerEntity).toString(16).toUpperCase().padStart(2,'0')}`:null,o.enemyKindSetId?`enemy kind → ${String(o.enemyKindSetId)}`:null,o.patrol?`patrol → ${o.patrol.start?.[0]}..${o.patrol.end?.[0]} @ ${o.patrol.start?.[1]}`:null,o.movingPlatformDirection?`controller → ${o.movingPlatformDirection}`:null,o.presentationPn!=null?`presentation → PN ${o.presentationPn}`:null,placement.dx||placement.dy?`trajectory → ${placement.dx>=0?'+':''}${placement.dx}, ${placement.dy>=0?'+':''}${placement.dy}px`:null,statePresentations.length?`${statePresentations.length} state presentation${statePresentations.length===1?'':'s'}`:Object.keys(stateOffsets).length?`${Object.keys(stateOffsets).length} state registration${Object.keys(stateOffsets).length===1?'':'s'}`:null,layer?`occlusion → ${layer}`:null].filter(Boolean).join(' · '),icon:'◈'});}
  for(const o of d.systemPatchRemovals||[])rows.push({group:'System retractions',kind:'system-patch-removal',id:o.id,docId:o.id,patchId:o.patchId,label:`Remove ${o.sourceKey||o.patchId}`,detail:`reviewed ${o.layer||'map'} visual ${o.action||'patch'} · ${o.patchId}`,icon:'⊘'});
  for(const t of d.transitions)rows.push({group:'Transitions',kind:'transition',id:t.id,label:`${t.side} exit`,detail:`row ${Number(t.contactRow).toString(16).padStart(2,'0')} → ${sm(t.targetSubmap)} · in ${Number(t.rowIn).toString(16).padStart(2,'0')} @ ${t.entryX},${t.entryY}`,icon:'⇢'});
  ui.changes_count.textContent=String(rows.length);if(!rows.length){ui.changes_list.innerHTML='<div class="empty-mini">No authored changes yet.</div>';return;}
  let group='';const html=[];for(const r of rows){if(r.group!==group){group=r.group;html.push(`<div class="change-group">${group}</div>`)}const data=[`data-change-kind="${r.kind}"`,`data-change-id="${escapeHtml(r.id)}"`,...(r.docId?[`data-change-doc-id="${escapeHtml(r.docId)}"`]:[]),...(r.patchId?[`data-change-patch-id="${escapeHtml(r.patchId)}"`]:[])];if(r.logic)data.push(`data-change-lx="${r.logic[0]}" data-change-ly="${r.logic[1]}"`);if(r.gx!=null)data.push(`data-change-gx="${r.gx}" data-change-gy="${r.gy}" data-change-layer="${r.layer}"`);if(r.globalTile!=null)data.push(`data-change-global-tile="${r.globalTile}" data-change-layer="${r.plane}"`);if(r.cx!=null)data.push(`data-change-cx="${r.cx}" data-change-cy="${r.cy}"`);if(r.bounds)data.push(`data-change-x="${r.bounds[0]}" data-change-y="${r.bounds[1]}" data-change-width="${r.bounds[2]}" data-change-height="${r.bounds[3]}"`);const selected=selection.some(s=>s.kind===r.kind&&s.id===r.id);html.push(`<div class="change-row-wrap ${selected?'selected':''}" ${data.join(' ')}><button type="button" class="change-row" ${data.join(' ')} title="Select and reveal ${escapeHtml(r.label)}"><span class="change-icon">${r.icon}</span><span class="change-copy"><strong>${escapeHtml(r.label)}</strong><small>${escapeHtml(r.detail)}</small></span></button><button type="button" class="change-delete" data-delete-change title="Delete this change · undo available" aria-label="Delete ${escapeHtml(r.label)}">×</button></div>`)}ui.changes_list.innerHTML=html.join('');
}
function debugContext(){
  const s=primarySelection();if(s?.kind==='entity'){const e=store.document.entities.find(x=>x.id===s.id),cat=entityCatalogRow(e?.entity);if(e)return {kind:'editable-entity',key:e.id,submap:store.document.base.submap,mapId:store.document.base.mapId,id:e.id,entity:e.entity,name:e.name,x:e.x,y:e.y,pn:e.pn,mappingId:cat?.mappingId||null,category:e.category};}
  if(s?.kind==='source'){const mark=Number(String(s.id).replace('mark:','')),e=sourceEntityRows().find(x=>Number(x.mark)===mark),sel=sourceSelectables.find(x=>x.sourceKey===`mark:${mark}`),cat=entityCatalogRow(e?.entity);return {kind:'source-entity',key:`${store.document.base.submap}:mark:${mark}`,submap:store.document.base.submap,mapId:store.document.base.mapId,mark,entity:Number(e?.entity??-1),name:cat?.name||`Source mark ${mark}`,x:e?.x,y:e?.y,pn:sourcePresentationPn(mark,Number(sel?.pn??cat?.pn??-1)),mappingId:cat?.mappingId||null,category:cat?.category||sel?.category||'unknown'};}
  if(selectedEntityType)return {kind:'library-entity',key:`catalog:${selectedEntityType.entity}`,submap:store?.document?.base?.submap??null,mapId:store?.document?.base?.mapId??null,entity:selectedEntityType.entity,name:selectedEntityType.name,pn:selectedEntityType.pn,mappingId:selectedEntityType.mappingId||null,category:selectedEntityType.category};
  return null;
}
function renderDebugNoteDock(){
  if(!ui.entity_debug_dock)return;const c=debugContext();ui.entity_debug_dock.hidden=!c;ui.debug_note_count.textContent=String(debugNotes.length);if(!c)return;ui.debug_note_entity.textContent=c.name||`Entity 0x${Number(c.entity).toString(16)}`;const bits=[c.kind,c.mark!=null?`mark ${c.mark}`:null,c.entity>=0?`type 0x${Number(c.entity).toString(16).padStart(2,'0')}`:null,c.pn>=0?`PN ${c.pn}`:'PN unassigned'].filter(Boolean);ui.debug_note_meta.textContent=bits.join(' · ');
}
function loadDebugNotes(){try{const d=JSON.parse(localStorage.getItem(DEBUG_NOTES_KEY)||'[]');debugNotes=Array.isArray(d)?d:[]}catch{debugNotes=[]}}
function persistDebugNotes(){try{localStorage.setItem(DEBUG_NOTES_KEY,JSON.stringify(debugNotes))}catch{}ui.debug_note_count.textContent=String(debugNotes.length)}
function addDebugNote(){const c=debugContext(),text=ui.debug_note_input.value.trim();if(!c||!text)return;debugNotes.push({id:`note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`,createdAt:new Date().toISOString(),issue:ui.debug_note_kind.value,text,context:deepClone(c)});ui.debug_note_input.value='';persistDebugNotes();toast('Debug note added.');}
function downloadDebugNotes(){const payload={schema:'rdx.level_editor_entity_debug_notes.v1',version:'2.1.78',exportedAt:new Date().toISOString(),notes:debugNotes};download(`rdr-entity-debug-notes-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(payload,null,2));}


function diagnosticSourceSelectables(){const byKey=new Map(sourceSelectables.filter(row=>row?.sourceKey).map(row=>[String(row.sourceKey),row])),projectBounds=lastDynamicClassicProjection==='base'?registeredClassicBounds:alignedClassicBounds;for(const src of sourceEntityRows()){const key=`mark:${src.mark}`;if(byKey.has(key))continue;const cat=entityCatalogRow(src.entity),bounds=projectBounds({x:Number(src.x||0),y:Number(src.y||0),width:Math.max(8,Number(src.w||16)),height:Math.max(8,Number(src.h||16))});byKey.set(key,{sourceKey:key,category:cat?.category||'actor',bounds});}return [...byKey.values()];}
function layerRowsAtDisplayedStage(rows){
  if(diagnostics.view!=='layers')return rows;const bySource=new Map(sourceSelectables.filter(row=>row?.sourceKey&&row?.bounds).map(row=>[String(row.sourceKey),row]));
  return rows.map(row=>{const displayedStage=diagnosticLayerStage()||'F',family=String(row?.policy?.family||''),geometrySemantic=String(row?.geometrySemantic||''),ownGeometry=['activator','projectile-emitter','projectile-lane'].includes(family)||['emitter','crawl-clearance'].includes(geometrySemantic);if(ownGeometry)return Object.freeze({...row,displayedStage,displayedAuthority:row.authority||lastDynamicRenderer?.authority||null});const live=bySource.get(String(row?.sourceKey||''));if(!live?.bounds)return Object.freeze({...row,bounds:null,current:null,displayedStage,displayedAbsent:true});const b=live.bounds;return Object.freeze({...row,bounds:b,current:Object.freeze([b.x+b.width/2,b.y+b.height/2]),displayedStage,displayedAuthority:live.authority||lastDynamicRenderer?.authority||null});});
}
function currentDiagnosticRows(){
  if(!lastDynamicRenderer||!store||!lastDynamic)return [];
  const previewTick=Number.isFinite(lastPreviewTick)?lastPreviewTick:effectivePreviewTick();
  let rows=editorDiagnosticRows({renderer:lastDynamicRenderer,dynamic:lastDynamic,tick:previewTick,view:diagnostics.view,filter:diagnostics.filter,document:store.document,sourceSelectables:diagnosticSourceSelectables(),stampBoundsFor:stampBounds,resolvedRoom:resolvedRoomFor(),nativeStates:nativeSimulation.displayStates,nativeGeometry:nativeSimulation.geometry,cellShiftMap:resources?.cellShiftMap});
  rows=rows.map(row=>classicDiagnosticProjection(row,lastDynamicClassicProjection));
  rows=layerRowsAtDisplayedStage(rows);
  return rows.map(row=>{const patch=reviewedVisualPatchForDiagnostic(row),removal=systemPatchRemovalForPatch(patch);if(!removal)return row;return Object.freeze({...row,removedByDraft:true,applied:false,notes:Object.freeze([...(row.notes||[]),'Removed by the current Level Editor draft; export marks the reviewed system patch for code retraction.'])});});
}
function currentDiagnosticCandidates(){
  return editorDiagnosticCandidates({renderer:lastDynamicRenderer||resources?.preview,dynamic:lastDynamic,rows:currentDiagnosticRows(),filter:diagnostics.filter});
}
function sceneProjectileTopologyRows(){
  if(diagnostics.active||!lastDynamicRenderer||!lastDynamic)return [];
  const selected=primarySelection();
  if(!selected||!['source','source-activator'].includes(selected.kind))return [];
  const sourceKey=String(selected.sourceKey||selected.id||'');
  return currentDiagnosticRows().filter(row=>String(row?.sourceKey||'')===sourceKey&&['shooter-body','projectile-emitter','projectile-lane'].includes(diagnosticFamily(row)));
}
function sceneProjectileTopologyCandidates(){
  const rows=sceneProjectileTopologyRows();
  return rows.length?editorDiagnosticCandidates({renderer:lastDynamicRenderer||resources?.preview,dynamic:lastDynamic,rows,filter:'all'}):[];
}
function beginSceneProjectileDrag(point){
  if(diagnostics.active||tool!=='select'||selectMode!=='object')return false;
  const hit=hitDiagnosticCandidate(sceneProjectileTopologyCandidates(),point);
  const row=hit?.debugRow||hit,family=diagnosticFamily(row),sourceKey=String(row?.sourceKey||'');
  if(!/^mark:\d+$/.test(sourceKey)||!['shooter-body','projectile-emitter'].includes(family))return false;
  const mark=Number(sourceKey.split(':')[1]),draft=sourceOverride(mark)||{},emitter=resolvedRoomFor()?.layers?.semanticCorpus?.objects?.find(o=>Number(o?.sources?.classic?.mark)===mark)?.projectileTopologyResolved?.emitter||null;
  const topology=resolvedRoomFor()?.layers?.semanticCorpus?.objects?.find(o=>Number(o?.sources?.classic?.mark)===mark)?.projectileTopologyResolved||null;
  const origin=family==='shooter-body'?(draft.projectileShooterPresentation?.origin||topology?.shooter?.origin||emitter?.origin):(draft.projectileEmitterOrigin||emitter?.origin);
  if(!Array.isArray(origin)||origin.length<2)return false;
  gesture={type:'projectile-topology-move',before:store.snapshot(),start:point,mark,family,origin:origin.slice(0,2).map(Number)};
  ui.scene_stage.dataset.dragging='true';
  return true;
}
function trajectoryRuntimeRows(renderer,dynamic,previewTick,{classicProjection='none',nativeGeometry=null}={}){
  if(!renderer||!dynamic)return [];let rows=editorDiagnosticRows({renderer,dynamic,tick:previewTick,view:'runtime',filter:'all',document:store.document,sourceSelectables:(dynamic.selectables||[]).map(item=>classicSelectableProjection(item,classicProjection)),stampBoundsFor:stampBounds,resolvedRoom:resolvedRoomFor(),nativeStates:nativeSimulation.displayStates,nativeGeometry,cellShiftMap:resources?.cellShiftMap});
  return rows.map(row=>classicDiagnosticProjection(row,classicProjection));
}
function fullTrajectoryOverlayRows(){
  if(!diagnostics.active||!diagnostics.trajectories||!resources||!lastDynamicRenderer||!lastDynamic)return [];
  const previewTick=Number.isFinite(lastPreviewTick)?lastPreviewTick:effectivePreviewTick(),stage=diagnosticLayerStage(),out=[];
  const add=(source,rows,{nativeOnly=false}={})=>{for(const row of rows||[]){const candidate=nativeOnly?row?.nativeGeometry:row;if(!candidate||!Array.isArray(candidate.pathPoints)||candidate.pathPoints.length<2)continue;if(diagnostics.filter!=='all'&&!editorDebugFilterMatches(row,diagnostics.filter))continue;out.push(Object.freeze({source,sourceKey:String(row.sourceKey||candidate.sourceKey||''),points:candidate.pathPoints,authority:String(candidate.authority||row.authority||''),family:String(row?.policy?.family||row?.category||'path')}));}};
  add('stage',trajectoryRuntimeRows(lastDynamicRenderer,lastDynamic,previewTick,{classicProjection:lastDynamicClassicProjection,nativeGeometry:null}));
  const classicDynamic=resources.classicPreview?.dynamicFrame(previewTick),classicProjection=stage==='B'?'base':'dense';
  add('classic',trajectoryRuntimeRows(resources.classicPreview,classicDynamic,previewTick,{classicProjection,nativeGeometry:null}));
  const effectiveDynamic=resources.preview?.dynamicFrame(previewTick),effectiveRows=trajectoryRuntimeRows(resources.preview,effectiveDynamic,previewTick,{nativeGeometry:nativeSimulation.geometry});
  add('effective',effectiveRows);add('native',effectiveRows,{nativeOnly:true});
  const seen=new Set();return out.filter(row=>{const key=`${row.source}:${row.sourceKey}:${row.points.map(point=>`${Math.round(point[0])},${Math.round(point[1])}`).join(';')}`;if(seen.has(key))return false;seen.add(key);return true;});
}
const TRAJECTORY_STYLES=Object.freeze({
  stage:Object.freeze({stroke:'rgba(97,200,255,.96)',dash:[],label:'STAGE'}),
  classic:Object.freeze({stroke:'rgba(255,173,85,.94)',dash:[7,3],label:'B'}),
  effective:Object.freeze({stroke:'rgba(255,101,211,.94)',dash:[3,2],label:'F'}),
  native:Object.freeze({stroke:'rgba(131,230,127,.94)',dash:[9,3],label:'NATIVE'})
});
function drawFullTrajectoryOverlay(context){
  const rows=fullTrajectoryOverlayRows();if(!rows.length)return;context.save();context.font='7px ui-monospace, monospace';context.textBaseline='bottom';
  for(const row of rows){const style=TRAJECTORY_STYLES[row.source]||TRAJECTORY_STYLES.stage,points=row.points;if(points.length<2)continue;context.strokeStyle=style.stroke;context.fillStyle=style.stroke;context.lineWidth=row.source==='stage'?2.25:1.6;context.setLineDash(style.dash);context.beginPath();context.moveTo(Number(points[0][0]),Number(points[0][1]));for(const point of points.slice(1))context.lineTo(Number(point[0]),Number(point[1]));context.stroke();context.setLineDash([]);context.fillRect(Number(points[0][0])-2,Number(points[0][1])-2,4,4);const label=`${style.label} ${row.sourceKey}`;context.fillStyle='rgba(5,10,18,.82)';const w=Math.ceil(context.measureText(label).width)+5;context.fillRect(Number(points[0][0])+4,Number(points[0][1])-11,w,10);context.fillStyle=style.stroke;context.fillText(label,Number(points[0][0])+6,Number(points[0][1])-3);}
  context.restore();
}
function diagnosticFamily(row){return String(row?.policy?.family||row?.category||'debug');}
function diagnosticDetail(item){
  const row=item?.debugRow||item||{};const bits=[row.sourceKey||item?.sourceKey||null,row.classification||null,row.placementStatus||null,row.subjectCategory||item?.category||null].filter(Boolean);return bits.join(' · ');
}
function diagnosticIndexItems(){return editorInstanceCandidates(currentDiagnosticCandidates(),diagnostics.instanceType);}
function findDiagnosticById(id){const wanted=String(id||'');return currentDiagnosticCandidates().find(item=>diagnosticItemId(item)===wanted||String(item?.debugRow?.debugId||item?.debugId||'')===wanted)||null;}
function setDiagnosticsActive(active=true){diagnostics.active=!!active;ui.scene_stage.dataset.diagnostics=diagnostics.active?'true':'false';if(diagnostics.active)entityPlacementArmed=false;rendererAuthorityKey='';updateToolHint();scheduleRender();renderDiagnosticsWorkspace();}
function switchLeftTab(tab){
  document.querySelectorAll('[data-left-tab]').forEach(b=>b.classList.toggle('active',b.dataset.leftTab===tab));
  ui.scene_tab.classList.toggle('active',tab==='scene');ui.library_tab.classList.toggle('active',tab==='library');ui.diagnostics_tab.classList.toggle('active',tab==='diagnostics');
  if(tab==='diagnostics')switchInspector('diagnostics');else if(ui.diagnostics_inspector_tab.classList.contains('active'))switchInspector('inspector');else setDiagnosticsActive(false);
}
function geometryCellKey(cell){return String(cell?.id||'');}
function selectGeometryCellAt(point,{add=false}={}){
  const cell=resources?.preview?.geometryCellAt?.(point.x,point.y,{includeOpen:true,includeProvenance:true});if(!cell)return false;
  if(add){const key=geometryCellKey(cell),existing=diagnostics.geometryCells.findIndex(row=>geometryCellKey(row)===key);if(existing>=0)diagnostics.geometryCells.splice(existing,1);else diagnostics.geometryCells.push(cell);}else diagnostics.geometryCells=[cell];
  diagnostics.alignmentCell=null;diagnostics.selectedId='';diagnostics.selectedItem=null;diagnostics.geometry=true;ui.diagnostics_geometry_toggle.checked=true;switchInspector('diagnostics');renderDiagnosticsWorkspace();renderEditorOverlay();return true;
}
function selectShiftCellAt(point){
  const cell=editorClassicRdxShiftInspection({shiftMap:resources?.cellShiftMap,submap:Number(store?.document?.base?.submap),point});if(!cell)return false;
  diagnostics.alignmentCell=cell;diagnostics.selectedId='';diagnostics.selectedItem=null;diagnostics.geometryCells=[];switchInspector('diagnostics');renderDiagnosticsWorkspace();renderEditorOverlay();return true;
}
function selectDiagnosticItem(item,{center=false}={}){
  diagnostics.selectedItem=item||null;diagnostics.selectedId=item?diagnosticItemId(item):'';if(item){diagnostics.alignmentCell=null;diagnostics.geometryCells=[];if(center){const b=diagnosticBounds(item);if(b)centerOnLogical(b.x+b.width/2,b.y+b.height/2);}switchInspector('diagnostics');}
  renderDiagnosticsWorkspace();renderEditorOverlay();
}
function clearDiagnosticSelection(){diagnostics.selectedId='';diagnostics.selectedItem=null;diagnostics.geometryCells=[];diagnostics.alignmentCell=null;diagnostics.instanceIndex=-1;renderDiagnosticsWorkspace();renderEditorOverlay();}
function navigateDiagnosticInstance(delta){
  const items=diagnosticIndexItems();if(!items.length){diagnostics.instanceIndex=-1;renderDiagnosticsWorkspace();return;}
  const selectedIndex=items.findIndex(item=>diagnosticItemId(item)===diagnostics.selectedId);let index=selectedIndex>=0?selectedIndex:diagnostics.instanceIndex;if(index<0)index=delta<0?0:-1;index=(index+delta+items.length)%items.length;diagnostics.instanceIndex=index;selectDiagnosticItem(items[index],{center:true});
}
function provenanceStepsHtml(title,steps=[]){if(!steps.length)return '';return `<div class="diagnostics-summary-card"><header><div><h3>${escapeHtml(title)}</h3></div></header>${steps.map(step=>`<div class="provenance-step"><b>${escapeHtml(step.label||'Step')}</b><span>${escapeHtml(step.value||'—')}</span>${step.detail?`<small>${escapeHtml(step.detail)}</small>`:''}</div>`).join('')}</div>`;}
function geometryInspectorHtml(){
  const cells=diagnostics.geometryCells;if(!cells.length)return '';
  const cell=cells[cells.length-1],vm=geometryProvenanceViewModel(cell);if(!vm)return '';
  return `<div class="diagnostics-summary-card"><header><div><h3>Geometry discrepancy inspector</h3><small>${escapeHtml(cell.id)}</small></div><span class="diagnostics-badge ${vm.divergent?'divergent':''}">${escapeHtml(vm.headline.badge)}</span></header><div class="provenance-headline"><strong>${escapeHtml(vm.headline.title)}</strong><p>${escapeHtml(vm.headline.detail)}${vm.headline.suspect?` ${escapeHtml(vm.headline.suspect)}`:''}</p></div><div class="diagnostic-workbench-actions"><button type="button" data-diagnostic-action="edit-geometry">Edit 16×16 descriptor</button><button type="button" data-diagnostic-action="copy-geometry-id">Copy ID${cells.length>1?'s':''}</button><button type="button" class="full" data-diagnostic-action="copy-geometry-trace">Copy provenance JSON</button></div></div>${provenanceStepsHtml('RDX collision authority',vm.collision)}${provenanceStepsHtml('Classic comparison',vm.classic)}${vm.visual?`<div class="diagnostics-summary-card"><header><div><h3>Visual reference path</h3><small>${escapeHtml(vm.visual.note||'Reference only')}</small></div></header>${(vm.visual.nodes||[]).map(step=>`<div class="provenance-step"><b>${escapeHtml(step.label||'Visual')}</b><span>${escapeHtml(step.value||'—')}</span>${step.detail?`<small>${escapeHtml(step.detail)}</small>`:''}</div>`).join('')}</div>`:''}<details class="diagnostics-summary-card"><summary>Raw provenance</summary><pre class="provenance-raw">${escapeHtml(vm.raw||'')}</pre></details>`;
}
function signedNumber(value){const n=Number(value||0);return n>0?`+${n}`:String(n)}
function shiftInspectorHtml(){
  const cell=diagnostics.alignmentCell;if(!cell)return '';
  const pair=([x,y])=>`${Number(x)}, ${Number(y)}`;
  const shift=`${signedNumber(cell.shift.dxPx)}, ${signedNumber(cell.shift.dyPx)} px`, correction=`${signedNumber(cell.runtimeCorrection.dxPx)}, ${signedNumber(cell.runtimeCorrection.dyPx)} px`;
  const confidence=`${Math.round(Number(cell.confidence||0)*100)}%`;
  return `<div class="diagnostics-summary-card"><header><div><h3>Classic ↔ RDX alignment</h3><small>${escapeHtml(cell.id)}</small></div><span class="diagnostics-badge">Δ ${escapeHtml(shift)}</span></header><div class="provenance-headline"><strong>One cell, both coordinate spaces</strong><p>The viewport stays in Level Editor coordinates. This is diagnostic correspondence evidence: it shows the Classic source cell associated with the selected RDX 8×8 cell, while canonical authored alignment remains Layer C.</p></div><dl class="diagnostic-kv"><div><dt>RDX target</dt><dd>g8 ${escapeHtml(pair(cell.rdx.cell))} · px ${escapeHtml(pair(cell.rdx.pixel))}</dd></div><div><dt>Classic source</dt><dd>g8 ${escapeHtml(pair(cell.classic.cell))} · px ${escapeHtml(pair(cell.classic.pixel))}</dd></div><div><dt>Classic → RDX</dt><dd>${escapeHtml(shift)}</dd></div><div><dt>Runtime correction</dt><dd>${escapeHtml(correction)}</dd></div><div><dt>Confidence</dt><dd>${confidence}</dd></div></dl><div class="diagnostic-workbench-actions"><button type="button" class="full" data-diagnostic-action="copy-shift-comparison">Copy alignment comparison</button></div></div>`;
}
function alignmentDraftEditorHtml(layered){
  const canonical=layered?.alignment?.region;if(!canonical?.id)return '';
  const override=(store?.document?.alignmentOverrides||[]).find(row=>String(row.id)===String(canonical.id))||null,effective=override||canonical;
  const c=effective.classicBoundsPx||canonical.classicBoundsPx||[0,0,16,16],r=effective.rdxBoundsPx||canonical.rdxBoundsPx||[0,0,16,16],t=effective.transform||canonical.transform||{dxPx:0,dyPx:0};
  const input=(field,value)=>`<input type="number" data-alignment-field="${field}" value="${Number(value)}">`;
  return `<div class="diagnostics-summary-card layer-alignment-editor"><header><div><h3>Layer C · regional alignment editor</h3><small>${escapeHtml(String(canonical.id))}${override?' · draft override':''}</small></div><span class="diagnostics-badge ${override?'patch':''}">${override?'draft':'canonical'}</span></header><div class="alignment-editor-grid"><label>Classic X ${input('classic.0',c[0])}</label><label>Classic Y ${input('classic.1',c[1])}</label><label>Classic W ${input('classic.2',c[2])}</label><label>Classic H ${input('classic.3',c[3])}</label><label>RDX X ${input('rdx.0',r[0])}</label><label>RDX Y ${input('rdx.1',r[1])}</label><label>RDX W ${input('rdx.2',r[2])}</label><label>RDX H ${input('rdx.3',r[3])}</label><label>Translate X ${input('transform.dxPx',t.dxPx||0)}</label><label>Translate Y ${input('transform.dyPx',t.dyPx||0)}</label></div><p class="property-help">This edits the reviewed local Classic/xrick → RDX correspondence for every semantic object governed by this region. Object-specific residuals remain Layer F and are applied afterward.</p><div class="diagnostic-workbench-actions"><button type="button" class="primary" data-diagnostic-action="apply-alignment">Apply Layer C draft</button>${override?'<button type="button" data-diagnostic-action="revert-alignment">Revert Layer C draft</button>':''}</div></div>`;
}
function diagnosticLayerInspectorHtml(layered){
  if(!layered)return '';
  const sections=[['Layer A · RDX source',layered.rdxSource],['Layer B · Classic/xrick source',layered.classicSource],['Layer C · Alignment',layered.alignment],['Layer D · Structural corrections',layered.structuralCorrections],['Layer E · Semantic corpus',layered.semantic],['Layer F · Placement / bounds adjustments',layered.adjustments],['Effective resolved object',layered.effective],['Live native runtime',layered.runtime]];
  return `${diagnostics.view==='layers'?alignmentDraftEditorHtml(layered):''}${sections.map(([title,value])=>{const empty=value==null||(Array.isArray(value)&&!value.length)||(typeof value==='object'&&!Array.isArray(value)&&!Object.keys(value).length);const body=empty?'No data in this layer.':JSON.stringify(value,null,2);return `<details class="diagnostics-summary-card layer-provenance-card"${title.startsWith('Effective')||title.startsWith('Live')?' open':''}><summary>${escapeHtml(title)}${empty?' · empty':''}</summary><pre class="provenance-raw">${escapeHtml(body)}</pre></details>`}).join('')}`;
}
function diagnosticInspectorHtml(){
  const item=diagnostics.selectedItem;if(!item)return geometryInspectorHtml()||shiftInspectorHtml()||'<div class="empty-inspector"><span>⌖</span><strong>Inspect production truth</strong><p>Choose a view, navigate an instance, or enable an overlay and click the map.</p></div>';
  const row=item.debugRow||item,b=diagnosticBounds(item),family=diagnosticFamily(row),notes=row.notes||[],sourceKey=String(row.sourceKey||item.sourceKey||''),isMark=/^mark:\d+$/.test(sourceKey),isPlacement=family==='placement',isEditorPatch=family==='editor-patch'&&row.editorSelection,reviewedPatch=reviewedVisualPatchForDiagnostic(row),patchRemoval=systemPatchRemovalForPatch(reviewedPatch),canRetractReviewedPatch=canRetractReviewedSystemPatch(reviewedPatch);
  const kv=[['Stable ID',diagnosticItemId(item)],['Source',sourceKey||'—'],['Family',family],['Category',row.subjectCategory||item.category||row.category||'—'],['Authority',row.authority||item.authority||'—'],['Bounds',b?`${Math.round(b.x)},${Math.round(b.y)} · ${Math.round(b.width)}×${Math.round(b.height)}`:'—']];
  if(row.removedByDraft)kv.push(['State',systemPatchRemovalRestoresPixels(reviewedPatch)?'removed by draft · decoded RDX pixels restored':'removed by draft · reviewed patch withheld']);else if(typeof row.applied==='boolean')kv.push(['State',row.applied?'applied':'withheld · raw RDX']);
  if(isPlacement)kv.push(['Drift',`${Number(row.drift?.[0]||0)}, ${Number(row.drift?.[1]||0)}`],['Confidence',row.confidence||'—']);
  const emitter=row.emitter||item.emitter||null;
  if(emitter){
    kv.push(['Emitter link',emitter.linked?'reviewed explicit':'unlinked']);
    if(emitter.actorId!=null)kv.push(['Emitter actor',`${Number(emitter.actorId)}${emitter.spawnIndex!=null?` · spawn ${Number(emitter.spawnIndex)}`:''}`]);
    if(Array.isArray(emitter.origin))kv.push(['Emitter position',`${Number(emitter.origin[0])}, ${Number(emitter.origin[1])}`]);
    if(Array.isArray(emitter.mouth))kv.push(['Mouth / spawn contact',`${Number(emitter.mouth[0])}, ${Number(emitter.mouth[1])}`]);
    if(Array.isArray(emitter.mouthOffset))kv.push(['Mouth correction',`${signedNumber(emitter.mouthOffset[0])}, ${signedNumber(emitter.mouthOffset[1])}`]);
    if(emitter.direction)kv.push(['Direction',String(emitter.direction)]);
    const cadence=emitter.cadence||{};
    if(Number(cadence.speedPxPerUpdate||0))kv.push(['Projectile cadence',`${Number(cadence.speedPxPerUpdate)} px/update${Number(cadence.capturedTrackPeriod||0)?` · ${Number(cadence.capturedTrackPeriod)} frame capture`:''}`]);
    if(cadence.activationMode)kv.push(['Activation',String(cadence.activationMode)]);
    if(cadence.authority)kv.push(['Cadence authority',String(cadence.authority)]);
    if(Array.isArray(emitter.corrections)&&emitter.corrections.length)kv.push(['Corrections',emitter.corrections.join(' → ')]);
    if(emitter.nativeDisplacementPreserved)kv.push(['Native displacement','preserved']);
  }
  const actions=[];
  let topologyEditor='';
  if(isMark&&['shooter-body','projectile-emitter','projectile-lane'].includes(family)){
    const mark=Number(sourceKey.split(':')[1]),draft=sourceOverride(mark)||{};
    if(family==='shooter-body'){
      const value=draft.projectileShooterPresentation||{actorId:emitter?.bodyActorId??emitter?.actorId,pn:emitter?.bodyPn,origin:emitter?.bodyOrigin||emitter?.origin||[0,0]},origin=Array.isArray(value.origin)?value.origin:[0,0];
      topologyEditor=`<div class="diagnostics-summary-card"><header><div><h3>Shooter presentation</h3><small>Layer F reviewed topology draft</small></div></header><div class="alignment-editor-grid"><label>Actor ID<input type="number" min="0" max="255" data-projectile-field="shooter.actorId" value="${Number(value.actorId??0)}"></label><label>PN<input type="number" min="0" max="254" data-projectile-field="shooter.pn" value="${Number(value.pn??0)}"></label><label>Origin X<input type="number" data-projectile-field="shooter.x" value="${Number(origin[0]||0)}"></label><label>Origin Y<input type="number" data-projectile-field="shooter.y" value="${Number(origin[1]||0)}"></label></div><p class="property-help">Presentation-only: changing the visible actor/PN or body origin does not move the emitter or lane origin.</p><div class="diagnostic-workbench-actions"><button type="button" class="primary full" data-diagnostic-action="apply-projectile-topology">Apply shooter draft</button></div></div>`;
    }else if(family==='projectile-emitter'){
      const origin=Array.isArray(draft.projectileEmitterOrigin)?draft.projectileEmitterOrigin:(emitter?.origin||[0,0]);
      topologyEditor=`<div class="diagnostics-summary-card"><header><div><h3>Projectile emitter</h3><small>Layer F reviewed topology draft</small></div></header><div class="alignment-editor-grid"><label>Emitter X<input type="number" data-projectile-field="emitter.x" value="${Number(origin[0]||0)}"></label><label>Emitter Y<input type="number" data-projectile-field="emitter.y" value="${Number(origin[1]||0)}"></label></div><p class="property-help">Gameplay muzzle origin. It may be spatially independent from the visible shooter body; native xrick still owns projectile displacement.</p><div class="diagnostic-workbench-actions"><button type="button" class="primary full" data-diagnostic-action="apply-projectile-topology">Apply emitter draft</button></div></div>`;
    }else{
      const direction=String(draft.projectileLaneDirection||emitter?.direction||'right');
      topologyEditor=`<div class="diagnostics-summary-card"><header><div><h3>Projectile lane</h3><small>Layer F reviewed topology draft</small></div></header><label>Direction<select data-projectile-field="lane.direction"><option value="left"${direction==='left'?' selected':''}>Left</option><option value="right"${direction!=='left'?' selected':''}>Right</option></select></label><p class="property-help">The lane always originates at the emitter. Direction is authored; projectile size, speed and per-tick motion remain native xrick semantics.</p><div class="diagnostic-workbench-actions"><button type="button" class="primary full" data-diagnostic-action="apply-projectile-topology">Apply lane draft</button></div></div>`;
    }
  }
  if(isEditorPatch)actions.push('<button type="button" data-diagnostic-action="edit-patch">Edit authored change</button>','<button type="button" class="danger" data-diagnostic-action="revert-patch">Revert this change</button>');
  else if(isPlacement&&isMark&&row.preferFitted)actions.push('<button type="button" class="primary full" data-diagnostic-action="apply-placement">Apply fitted placement to draft</button>');
  if(canRetractReviewedPatch)actions.push(patchRemoval?'<button type="button" data-diagnostic-action="restore-system-patch">Restore reviewed patch</button>':'<button type="button" class="danger full" data-diagnostic-action="remove-system-patch">Remove reviewed patch</button>');
  if(isMark&&!isEditorPatch)actions.push('<button type="button" data-diagnostic-action="convert-source">Convert source to editable draft</button>');
  actions.push('<button type="button" data-diagnostic-action="copy-diagnostic-id">Copy stable ID</button>');
  return `<div class="diagnostics-summary-card"><header><div><h3>${escapeHtml(diagnosticDisplayName(item))}</h3><small>${escapeHtml(diagnosticDetail(item)||'Selected diagnostic element')}</small></div><span class="diagnostics-badge ${isEditorPatch?'patch':''}">${escapeHtml(family)}</span></header><dl class="diagnostic-kv">${kv.map(([k,v])=>`<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl>${notes.length?`<ul class="diagnostic-notes">${notes.map(n=>`<li>${escapeHtml(n)}</li>`).join('')}</ul>`:''}<div class="diagnostic-workbench-actions">${actions.join('')}</div></div>${topologyEditor}${diagnosticLayerInspectorHtml(row.layered||item.layered||null)}`;
}
function renderDiagnosticsWorkspace(){
  if(!ui.diagnostics_queue||!resources||!store)return;const rows=currentDiagnosticRows();if(diagnostics.selectedId){const refreshed=findDiagnosticById(diagnostics.selectedId);if(refreshed)diagnostics.selectedItem=refreshed;}const items=diagnosticIndexItems();
  ui.diagnostics_count.textContent=String(rows.length);ui.diagnostics_queue_caption.textContent=`${diagnostics.view.replace('-',' ')} · ${diagnostics.filter}`;
  document.querySelectorAll('[data-diagnostic-view]').forEach(b=>b.classList.toggle('active',b.dataset.diagnosticView===diagnostics.view));document.querySelectorAll('[data-diagnostic-filter]').forEach(b=>b.classList.toggle('active',b.dataset.diagnosticFilter===diagnostics.filter));
  const layerView=diagnostics.view==='layers',shiftView=diagnostics.view==='shift',layerInfo=diagnosticLayerStageInfo(diagnostics.layerStage);if(ui.diagnostics_layer_stage_section)ui.diagnostics_layer_stage_section.hidden=!layerView;if(ui.diagnostics_shift_mode_section)ui.diagnostics_shift_mode_section.hidden=!shiftView;if(ui.diagnostics_layer_stage_caption)ui.diagnostics_layer_stage_caption.textContent=layerInfo.caption;if(ui.diagnostics_layer_stage_help)ui.diagnostics_layer_stage_help.textContent=layerInfo.help;ui.diagnostics_layer_stages?.querySelectorAll('[data-layer-stage]').forEach(button=>button.classList.toggle('active',button.dataset.layerStage===diagnostics.layerStage));ui.diagnostics_shift_modes?.querySelectorAll('[data-shift-mode]').forEach(button=>button.classList.toggle('active',button.dataset.shiftMode===diagnostics.shiftMode));
  ui.diagnostics_geometry_toggle.checked=diagnostics.geometry;ui.diagnostics_unresolved_toggle.checked=diagnostics.unresolved;ui.diagnostics_trajectory_toggle.checked=diagnostics.trajectories;ui.diagnostics_trajectory_legend.hidden=!diagnostics.trajectories;if(ui.diagnostics_geometry_legend)ui.diagnostics_geometry_legend.hidden=!diagnostics.geometry;ui.diagnostics_instance_type.value=diagnostics.instanceType;
  const current=items.findIndex(item=>diagnosticItemId(item)===diagnostics.selectedId);ui.diagnostics_instance_status.textContent=items.length?`${(current>=0?current:0)+1} / ${items.length}`:'0 / 0';ui.diagnostics_prev.disabled=!items.length;ui.diagnostics_next.disabled=!items.length;
  const rowItems=editorDiagnosticCandidates({renderer:resources.preview,dynamic:{selectables:[]},rows,filter:diagnostics.filter});
  if(!rowItems.length)ui.diagnostics_queue.innerHTML='<div class="empty-mini">No diagnostic rows in this view.</div>';else ui.diagnostics_queue.innerHTML=rowItems.slice(0,250).map(item=>{const row=item.debugRow||item,family=diagnosticFamily(row),id=diagnosticItemId(item),selected=id===diagnostics.selectedId,removed=!!row.removedByDraft;return `<button type="button" class="diagnostic-row ${selected?'selected ':''}${removed?'removed-by-draft':''}" data-diagnostic-id="${escapeHtml(id)}" data-family="${escapeHtml(family)}"${removed?' data-review-state="removed"':''}><span class="diagnostic-row-dot"></span><span><span class="diagnostic-row-title"><strong>${escapeHtml(diagnosticDisplayName(item))}</strong>${removed?'<em class="diagnostic-row-state">removed</em>':''}</span><small>${escapeHtml(diagnosticDetail(item)||id)}</small></span></button>`}).join('');
  ui.diagnostics_inspector.innerHTML=diagnosticInspectorHtml();
}
function copyDiagnosticText(text,label='Copied'){const value=String(text||'');if(!value)return;const done=()=>toast(`${label}.`);if(navigator.clipboard?.writeText)navigator.clipboard.writeText(value).then(done).catch(()=>fallback());else fallback();function fallback(){const ta=document.createElement('textarea');ta.value=value;ta.style.position='fixed';ta.style.opacity='0';document.body.append(ta);ta.select();try{document.execCommand('copy');done()}finally{ta.remove()}}}
function focusDiagnosticEditorSelection(sel){
  if(!sel)return;if(sel.kind==='collision'){collisionAuthoring='descriptor';setTool('collision');collisionMode='select';setSelection([sel]);centerOnLogical((sel.logic[0]-1)*16+8,(sel.logic[1]-1)*16+8);}else if(sel.kind==='gameplay-collision'){collisionAuthoring='gameplay';setTool('collision');collisionMode='select';setSelection([sel]);centerOnLogical(sel.g8[0]*8+4,sel.g8[1]*8+4);}else if(sel.kind==='cell'){setTool('select');setActiveLayer(sel.layer==='A'?'foreground':'background');setSelection([sel]);centerOnLogical(sel.gx*8+4,sel.gy*8+4);}else if(sel.kind==='terrain'){setTileAuthoringMode('terrain');setTool('select');setSelection([sel]);centerOnLogical(sel.cx*16+8,sel.cy*16+8);}else if(sel.kind==='entity'){const e=store.document.entities.find(row=>row.id===sel.id);setTool('select');setSelection([sel]);if(e)centerOnLogical(e.x,e.y);}else{setTool('select');setSelection([sel]);}switchLeftTab('scene');switchInspector('inspector');
}
function revertSelectedEditorPatch(){
  const row=diagnostics.selectedItem?.debugRow;if(!row?.editorSelection)return;const sel=row.editorSelection;
  store.transact('diagnostics-revert-patch',d=>{if(sel.kind==='entity')d.entities=d.entities.filter(e=>e.id!==sel.id);else if(sel.kind==='collision')d.collision=d.collision.filter(c=>!(Number(c.logic?.[0])===Number(sel.logic?.[0])&&Number(c.logic?.[1])===Number(sel.logic?.[1])));else if(sel.kind==='gameplay-collision')d.gameplayCollision=(d.gameplayCollision||[]).filter(c=>!(Number(c.g8?.[0])===Number(sel.g8?.[0])&&Number(c.g8?.[1])===Number(sel.g8?.[1])));else if(sel.kind==='cell')d.tiles=d.tiles.filter(t=>!(String(t.layer)===String(sel.layer)&&Number(t.target?.[0])===Number(sel.gx)&&Number(t.target?.[1])===Number(sel.gy)));else if(sel.kind==='terrain')d.terrain=d.terrain.filter(t=>t.id!==sel.id);else if(sel.kind==='terrain-relation')d.terrainRelations=d.terrainRelations.filter(r=>r.id!==sel.id);else if(sel.kind==='stamp'){const temp=new LevelDocumentStore(d);temp.removeStamp(sel.id);d.stamps=temp.document.stamps;d.terrain=temp.document.terrain}else if(sel.kind==='source'){const mark=Number(String(sel.id).replace('mark:',''));d.sourceEntityOverrides=d.sourceEntityOverrides.filter(o=>Number(o.mark)!==mark);}});diagnostics.selectedId='';diagnostics.selectedItem=null;rendererAuthorityKey='';scheduleRender();toast('Draft change reverted. Undo restores it.');
}
function applySelectedPlacementFix(){
  const row=diagnostics.selectedItem?.debugRow;if(!row||diagnosticFamily(row)!=='placement'||!/^mark:\d+$/.test(String(row.sourceKey||'')))return;const mark=Number(String(row.sourceKey).split(':')[1]),dx=Number(row.drift?.[0]||0),dy=Number(row.drift?.[1]||0),id=convertSource(mark,{silent:true});if(!id)return;
  if(dx||dy)store.transact('apply-placement-audit',d=>{const e=d.entities.find(x=>x.id===id);if(!e)return;e.x+=dx;e.y+=dy;e.patrolX=(e.patrolX??e.x-dx)+dx;e.patrolY=(e.patrolY??e.y-dy)+dy;e.triggerX+=dx;e.triggerY+=dy;});
  diagnostics.selectedId='';diagnostics.selectedItem=null;rendererAuthorityKey='';scheduleRender();setSelection([{kind:'entity',id}]);switchLeftTab('scene');switchInspector('inspector');toast(`Applied placement audit drift ${dx},${dy} as an undoable editable entity change.`);
}
function setReviewedSystemPatchRemoved(patch,removed){
  if(!canRetractReviewedSystemPatch(patch))return;
  store.transact(removed?'remove-reviewed-system-patch':'restore-reviewed-system-patch',d=>{d.systemPatchRemovals=Array.isArray(d.systemPatchRemovals)?d.systemPatchRemovals:[];d.systemPatchRemovals=d.systemPatchRemovals.filter(row=>String(row.patchId)!==String(patch.id));if(removed)d.systemPatchRemovals.push(createSystemPatchRemoval(patch));});
  rendererAuthorityKey='';scheduleRender();renderDiagnosticsWorkspace();
  toast(removed?`Reviewed patch ${patch.id} removed from this draft. Export Changes will mark it for code retraction.`:`Reviewed patch ${patch.id} restored.`,'ok',5200);
}

function handleDiagnosticAction(button){
  if(!button)return;const action=button.dataset.diagnosticAction,item=diagnostics.selectedItem,row=item?.debugRow||item;
  if(action==='copy-diagnostic-id'){copyDiagnosticText(diagnosticItemId(item),'Stable diagnostic ID copied');return}
  if(action==='apply-projectile-topology'){
    const source=String(row?.sourceKey||item?.sourceKey||'');if(!/^mark:\d+$/.test(source))return;const mark=Number(source.split(':')[1]),family=diagnosticFamily(row),fields=Object.fromEntries([...ui.diagnostics_inspector.querySelectorAll('[data-projectile-field]')].map(input=>[input.dataset.projectileField,input.value]));
    store.transact(`projectile-${family}-draft`,d=>{const override=ensureSourceOverrideInDocument(d,mark);if(family==='shooter-body')override.projectileShooterPresentation={actorId:Number(fields['shooter.actorId']),pn:Number(fields['shooter.pn']),origin:[Number(fields['shooter.x']),Number(fields['shooter.y'])]};else if(family==='projectile-emitter')override.projectileEmitterOrigin=[Number(fields['emitter.x']),Number(fields['emitter.y'])];else if(family==='projectile-lane')override.projectileLaneDirection=String(fields['lane.direction']||'right')==='left'?'left':'right';});
    rendererAuthorityKey='';scheduleRender();renderDiagnosticsWorkspace();updateDraftAuthorityStatus();toast(`${diagnosticDisplayName(item)} staged as a typed reviewed correction. Export Reviewed Fixes, promote and rebuild to exercise it in native Playtest.`,'ok',6500);return;
  }
  if(action==='convert-source'){const source=String(row?.sourceKey||item?.sourceKey||'');if(/^mark:\d+$/.test(source)){const id=convertSource(Number(source.split(':')[1]));if(id){diagnostics.selectedId='';diagnostics.selectedItem=null;switchLeftTab('scene');switchInspector('inspector')}}return}
  if(action==='apply-placement'){applySelectedPlacementFix();return}
  if(action==='remove-system-patch'){setReviewedSystemPatchRemoved(reviewedVisualPatchForDiagnostic(row),true);return}
  if(action==='restore-system-patch'){setReviewedSystemPatchRemoved(reviewedVisualPatchForDiagnostic(row),false);return}
  if(action==='edit-patch'){focusDiagnosticEditorSelection(row?.editorSelection);return}
  if(action==='revert-patch'){revertSelectedEditorPatch();return}
  if(action==='apply-alignment'){const canonical=(row?.layered||item?.layered)?.alignment?.region;if(!canonical?.id)return;const values={};for(const input of ui.diagnostics_inspector.querySelectorAll('[data-alignment-field]'))values[input.dataset.alignmentField]=Number(input.value);const next={...deepClone(canonical),classicBoundsPx:[0,1,2,3].map(i=>values[`classic.${i}`]),rdxBoundsPx:[0,1,2,3].map(i=>values[`rdx.${i}`]),transform:{type:'translate',dxPx:values['transform.dxPx'],dyPx:values['transform.dyPx']},status:'reviewed',authority:'level-editor-draft'};store.transact('layer-c-alignment',d=>{d.alignmentOverrides=(d.alignmentOverrides||[]).filter(v=>String(v.id)!==String(next.id));d.alignmentOverrides.push(next)});rendererAuthorityKey='';if(nativeSimulation.active)startNativeSimulation({preserveHistory:false});renderDiagnosticsWorkspace();toast(`Layer C ${next.id} updated. Export Layer Draft to promote it.`,'ok',4500);return}
  if(action==='revert-alignment'){const canonical=(row?.layered||item?.layered)?.alignment?.region;if(!canonical?.id)return;store.transact('revert-layer-c-alignment',d=>d.alignmentOverrides=(d.alignmentOverrides||[]).filter(v=>String(v.id)!==String(canonical.id)));rendererAuthorityKey='';if(nativeSimulation.active)startNativeSimulation({preserveHistory:false});renderDiagnosticsWorkspace();toast(`Layer C ${canonical.id} draft reverted.`);return}
  if(action==='copy-shift-comparison'&&diagnostics.alignmentCell){copyDiagnosticText(JSON.stringify(diagnostics.alignmentCell,null,2),'Classic/RDX alignment copied');return}
  if(action==='edit-geometry'){const cell=diagnostics.geometryCells.at(-1),g=cell?.provenance?.coordinate?.grid8;if(!g)return;const gx=Number(g.x),gy=Number(g.y);collisionAuthoring='gameplay';setTool('collision');collisionMode='select';setSelection([gameplayCollisionSelectionItem(gx,gy)]);centerOnLogical(gx*8+4,gy*8+4);switchLeftTab('scene');switchInspector('inspector');return}
  if(action==='copy-geometry-id'){copyDiagnosticText(diagnostics.geometryCells.map(cell=>cell.id).join('\n'),diagnostics.geometryCells.length>1?'Geometry IDs copied':'Geometry ID copied');return}
  if(action==='copy-geometry-trace'){copyDiagnosticText(geometryProvenanceClipboard(diagnostics.geometryCells,{submap:store.document.base.submap,mapId:store.document.base.mapId,name:store.document.name}),'Geometry provenance JSON copied');return}
}
function diagnosticPointerDown(event,point){
  if(!diagnostics.active)return false;
  if(diagnostics.view==='shift'){if(selectShiftCellAt(point))return true;clearDiagnosticSelection();return true}
  const hit=hitDiagnosticCandidate(currentDiagnosticCandidates(),point);if(hit){selectDiagnosticItem(hit);return true}
  if(diagnostics.geometry)return selectGeometryCellAt(point,{add:event.shiftKey});
  clearDiagnosticSelection();return true;
}

function selectionStatusText(){const regions=selection.filter(s=>s.kind==='region');if(regions.length===1&&selection.length===1){const r=regions[0];return `${SELECT_REGION_PRESENTATION[r.mode]?.label||'Region'} · ${Math.round(r.width)}×${Math.round(r.height)}`;}return selection.length?`${selection.length} selected`:'No selection';}
function setSelection(items,{add=false}={}){selection=add?[...selection,...items.filter(n=>!selection.some(s=>s.kind===n.kind&&s.id===n.id))]:items;if(timelineScrub&&!selection.some(s=>s.kind==='source'&&String(s.id)===String(timelineScrub.sourceKey)))clearTimelineScrub();if(forcedPresentationState&&!selection.some(s=>(s.kind==='source'||s.kind==='source-activator')&&Number(String(s.id).replace('mark:',''))===Number(forcedPresentationState.mark))){forcedPresentationState=null;rendererAuthorityKey='';}renderEditorOverlay();renderInspector();renderDebugNoteDock();ui.selection_count.textContent=selectionStatusText();}
function clearAllEditorSelection(){setSelection([]);clearDiagnosticSelection();}
function viewportBackgroundPointerDown(e){if(e.button!==0||e.target!==ui.viewport_scroll)return;viewportBackgroundClick=beginViewportBackgroundClick(e,ui.viewport_scroll);}
function finishViewportBackgroundClick(e){const pending=viewportBackgroundClick;if(!pending||Number(e.pointerId)!==Number(pending.pointerId))return false;viewportBackgroundClick=null;if(!isGenuineViewportBackgroundClick(pending,e,ui.viewport_scroll))return false;clearAllEditorSelection();return true;}
function primarySelection(){return selection[selection.length-1]||null;}
function mapReferencePrefix(){return `MD${Math.max(0,Number(store?.document?.base?.mapId)||0).toString().padStart(4,'0')}`;}
function collisionGeometryIds(s){
  const gx=(Number(s.logic?.[0]||1)-1)*2,gy=(Number(s.logic?.[1]||1)-1)*2,p=mapReferencePrefix();
  return [`${p}#geometry#rdx:g8:${gx}:${gy}`,`${p}#geometry#rdx:g8:${gx+1}:${gy}`,`${p}#geometry#rdx:g8:${gx}:${gy+1}`,`${p}#geometry#rdx:g8:${gx+1}:${gy+1}`];
}
function selectionReferenceIds(){
  const p=mapReferencePrefix(),out=[];
  for(const s of selection){
    if(s.kind==='source'){
      const live=sourceSelectables.find(x=>String(x.sourceKey||'')===String(s.sourceKey||s.id));
      out.push(live?.elementId||`${p}#source#${String(s.sourceKey||s.id)}`);
    }else if(s.kind==='collision') out.push(...collisionGeometryIds(s));
    else if(s.kind==='gameplay-collision') out.push(`${p}#geometry#rdx:g8:${Number(s.g8?.[0])}:${Number(s.g8?.[1])}`);
    else if(s.kind==='cell') out.push(`${p}#presentation#rdx:g8:${Number(s.gx)}:${Number(s.gy)}:${String(s.layer||selectedLayerPlane())}`);
    else if(s.kind==='terrain') out.push(`${p}#editor-terrain#c16:${Number(s.cx)}:${Number(s.cy)}:${String(s.id)}`);
    else if(s.kind==='terrain-relation') out.push(`${p}#editor-construction#${String(s.id)}`);
    else if(s.kind==='stamp') out.push(`${p}#editor-stamp#${String(s.id)}`);
    else if(s.kind==='entity') out.push(`${p}#editor-entity#${String(s.id)}`);
    else if(s.kind==='hero') out.push(`${p}#editor-hero#start`);
    else if(s.kind==='native-transition') out.push(`${p}#native-transition#${String(s.id)}`);
    else if(s.kind==='region'){const gx0=Math.floor(Number(s.x)/8),gy0=Math.floor(Number(s.y)/8),gx1=Math.ceil((Number(s.x)+Number(s.width))/8)-1,gy1=Math.ceil((Number(s.y)+Number(s.height))/8)-1,plane=s.mode==='background'?'B':s.mode==='foreground'?'A':'ALL';out.push(`${p}#editor-region#rdx:g8:{${gx0},${gx1}}:{${gy0},${gy1}}:${plane}`);}
    else if(s.kind==='layer') out.push(`${p}#editor-layer#${String(s.id)}`);
    else if(s.kind==='tile') out.push(`${p}#editor-tile#${String(s.id)}`);
    else out.push(`${p}#editor-${String(s.kind||'selection')}#${String(s.id||'unknown')}`);
  }
  return [...new Set(out)];
}
async function copyText(text){
  if(navigator.clipboard?.writeText){try{await navigator.clipboard.writeText(text);return true}catch{}}
  const area=document.createElement('textarea');area.value=text;area.setAttribute('readonly','');area.style.position='fixed';area.style.opacity='0';document.body.append(area);area.select();let ok=false;try{ok=document.execCommand('copy')}catch{}area.remove();return ok;
}
async function copySelectionReference(){
  const ids=selectionReferenceIds();if(!ids.length){toast('Select an entity, cell, collider, stamp, terrain item or hero start first.','warn');return;}
  const onlyGeometry=selection.length>0&&selection.every(s=>s.kind==='collision'||s.kind==='gameplay-collision');
  const text=onlyGeometry?geometryIdsClipboardText(ids):(ids.length===1?ids[0]:JSON.stringify(ids,null,2));
  const ok=await copyText(text);toast(ok?`Copied ${ids.length===1?'ID':`${ids.length} IDs`}.`:'Could not access the clipboard.',ok?'ok':'warn');
}

function inspectorField(label,key,value,type='number',opts=''){return `<label>${label}<input data-inspector-key="${key}" type="${type}" value="${escapeHtml(value)}" ${opts}></label>`;}
function descriptorCollisionOptions(value='original',base='pass-through',mixed=false){
  const opts=[];if(mixed)opts.push('<option value="" selected disabled>Mixed behaviors</option>');
  opts.push(`<option value="original" ${!mixed&&value==='original'?'selected':''}>Original · ${escapeHtml(base)}</option>`);
  for(const k of Object.keys(COLLISION_PRESETS).filter(k=>k!=='original'))opts.push(`<option value="${k}" ${!mixed&&value===k?'selected':''}>${k}</option>`);return opts.join('');
}
function gameplayCollisionOptions(value='original',base='open',mixed=false){const opts=[];if(mixed)opts.push('<option value="" selected disabled>Mixed behaviors</option>');opts.push(`<option value="original" ${!mixed&&value==='original'?'selected':''}>Original · ${escapeHtml(base)}</option>`);for(const k of ['open','one-way','climb-through','lethal'])opts.push(`<option value="${k}" ${!mixed&&value===k?'selected':''}>${k}</option>`);return opts.join('');}
function collisionAuthoringSwitch(){return `<div class="collision-mode-switch"><button type="button" data-collision-authoring="gameplay" class="${collisionAuthoring==='gameplay'?'active':''}">Gameplay 8×8</button><button type="button" data-collision-authoring="descriptor" class="${collisionAuthoring==='descriptor'?'active':''}">Advanced Descriptor 16×16</button></div>`;}
function collisionInteractionSwitch(){return `<div class="collision-mode-switch"><button type="button" data-collision-mode="select" class="${collisionMode==='select'?'active':''}">Select cells</button><button type="button" data-collision-mode="paint" class="${collisionMode==='paint'?'active':''}">Paint</button></div>`;}
function collisionSelectionInspector(items){
  const gameplay=items.every(s=>s.kind==='gameplay-collision');
  if(gameplay){const behaviors=items.map(s=>gameplayCollisionOverrideAt(...s.g8)?.action||'original'),effective=items.map(s=>gameplayCollisionEffective(...s.g8)),same=behaviors.every(x=>x===behaviors[0]),sameBase=effective.every((x,_,a)=>x===a[0]),base=sameBase?effective[0]:'mixed';return `<div class="inspector-group"><h3>Collision selection <span>${items.length} cell${items.length===1?'':'s'} · 8×8</span></h3>${collisionAuthoringSwitch()}${collisionInteractionSwitch()}<label>Behavior<select data-collision-selection="gameplay">${gameplayCollisionOptions(same?behaviors[0]:'',base,!same)}</select></label><p class="property-help">Gameplay corrections target exact xrick 8×8 cells and promote directly to canonical collision patches. They do not rewrite the underlying 16×16 RDX descriptor.</p><div class="collision-selection-list">${items.slice(0,24).map(s=>`<div><span>${s.g8[0]}, ${s.g8[1]}</span><span>${gameplayCollisionEffective(...s.g8)}${gameplayCollisionOverrideAt(...s.g8)?' · override':' · production'}</span></div>`).join('')}</div></div><div class="inspector-actions"><button data-action="revert-collision-selection">Revert selected</button></div>`;}
  const behaviors=items.map(s=>collisionOverrideAt(...s.logic)?.collision||'original'),effective=items.map(s=>collisionEffective(...s.logic)),same=behaviors.every(x=>x===behaviors[0]),generatedBase=items.map(s=>terrainCollisionAt(...s.logic)||descriptorCollisionBase(...s.logic)),sameBase=generatedBase.every((x,_,a)=>x===a[0]),base=sameBase?generatedBase[0]:'mixed';
  return `<div class="inspector-group"><h3>Collision selection <span>${items.length} cell${items.length===1?'':'s'} · 16×16 descriptor</span></h3>${collisionAuthoringSwitch()}${collisionInteractionSwitch()}<label>Behavior<select data-collision-selection="descriptor">${descriptorCollisionOptions(same?behaviors[0]:'',base,!same)}</select></label><p class="property-help">Advanced Descriptor edits raw MT/ML semantics. These edits can project differently into the four 8×8 quadrants and therefore remain blocked from Reviewed Fix promotion.</p><div class="collision-selection-list">${items.slice(0,24).map(s=>`<div><span>${s.logic[0]}, ${s.logic[1]}</span><span>${collisionEffective(...s.logic)}${collisionOverrideAt(...s.logic)?' · override':' · native'}</span></div>`).join('')}</div></div><div class="inspector-actions"><button data-action="revert-collision-selection">Revert selected</button></div>`;
}
function hoverCellAt(point){
  if(!resources?.preview||!store||!point)return null;
  return editorHoverCellInspection({renderer:resources.preview,document:store.document,point,collisionBase:descriptorCollisionBase,collisionEffective,collisionOverride:collisionOverrideAt});
}
function hoverCellInspectorHtml(inspection=hoverCell?.inspection){
  if(!inspection)return '';
  const p=inspection.presentation,g=inspection.gameplay,cell=inspection.cell,vm=geometryProvenanceViewModel(cell),planes=p.planes||[],mods=p.editorModifications||[];
  const hex=value=>value==null?'—':`0x${Number(value).toString(16).toUpperCase().padStart(2,'0')}`;
  const planeRows=planes.map(row=>`<div class="inspector-row"><span>Plane ${escapeHtml(row.plane)}</span><span class="value">${escapeHtml(row.state)}<small>${escapeHtml(row.id)}</small></span></div>`).join('');
  const modText=mods.length?mods.map(row=>row.type==='terrain'?`terrain ${row.terrainSet}${row.collisionMode?` · ${row.collisionMode}`:''}`:`${row.layer} ${row.operation}${row.source?` ← ${md(row.sourceMapId)} ${row.sourceLayer} ${row.source.join(',')}`:''}`).join(' · '):'none';
  const visualProvenance=vm?.visual?`<div class="diagnostics-summary-card"><header><div><h3>RDX presentation provenance</h3><small>${escapeHtml(vm.visual.summary||vm.visual.note||'Visual reference path')}</small></div></header>${(vm.visual.nodes||[]).map(step=>`<div class="provenance-step"><b>${escapeHtml(step.label||'Visual')}</b><span>${escapeHtml(step.value||'—')}</span>${step.detail?`<small>${escapeHtml(step.detail)}</small>`:''}</div>`).join('')}</div>`:'';
  const provenance=vm?`${visualProvenance}${provenanceStepsHtml('RDX collision provenance',vm.collision)}${provenanceStepsHtml('Classic correspondence',vm.classic)}`:'';
  return `<div class="inspector-group hover-cell-inspector"><h3>Hover cell <span>g8 ${p.coordinate.x}, ${p.coordinate.y}</span></h3><div class="inspector-row"><span>Stable geometry ID</span><span class="value"><small>${escapeHtml(inspection.id)}</small></span></div>${planeRows}<div class="inspector-row"><span>Editor presentation</span><span class="value">${escapeHtml(modText)}</span></div></div><div class="inspector-group"><h3>Gameplay <span>logic ${g.coordinate.x}, ${g.coordinate.y}</span></h3><div class="inspector-row"><span>MT / ML</span><span class="value">${hex(g.mt)} / ${hex(g.ml)}</span></div><div class="inspector-row"><span>8×8 effective</span><span class="value">${escapeHtml(g.effective8x8.kind)} · flags ${hex(g.effective8x8.flags)}${g.effective8x8.projection?` · ${escapeHtml(g.effective8x8.projection)}`:''}</span></div><div class="inspector-row"><span>Descriptor behavior</span><span class="value">base ${escapeHtml(g.base||'—')} · effective ${escapeHtml(g.effective||'—')}</span></div><div class="inspector-row"><span>Override</span><span class="value">${g.override?escapeHtml(`${g.override.collision} · MT ${hex(g.override.mt)} ML ${hex(g.override.ml)}`):'none'}</span></div></div>${provenance}`;
}
function setHoverCell(point){
  const gx=Math.floor(Number(point.x)/8),gy=Math.floor(Number(point.y)/8),gridKey=`${gx}:${gy}`;
  if(hoverCell?.gridKey===gridKey){hoverCell={...hoverCell,point:{x:Number(point.x),y:Number(point.y)}};return;}
  const inspection=hoverCellAt(point),key=inspection?.id||'';
  if(!inspection){if(hoverCell){hoverCell=null;if(!selection.length)renderInspector();}return;}
  hoverCell={gridKey,key,point:{x:Number(point.x),y:Number(point.y)},inspection};if(!selection.length)renderInspector();
}
function clearHoverCell(){if(!hoverCell)return;hoverCell=null;if(!selection.length)renderInspector();}
function sourceTimelineInspectorHtml(sourceKey){
  const model=productionSourceTimeline(sourceKey);if(!model)return '';
  const raw=timelineScrub&&String(timelineScrub.sourceKey)===String(sourceKey)?Number(timelineScrub.tick||0):effectivePreviewTick();
  const phase=sourceTimelineTick(model,raw);
  const live=sourceSelectables.find(row=>String(row.sourceKey||'')===String(sourceKey||'')),position=live&&Number.isFinite(Number(live.x))&&Number.isFinite(Number(live.y))?`${Math.round(Number(live.x))}, ${Math.round(Number(live.y))}`:'—';
  const mark=Number(String(sourceKey||'').replace('mark:','')),placement=sourcePlacement(mark),shiftedOrigin=stop=>[Number(stop.origin[0])+placement.dx,Number(stop.origin[1])+placement.dy];
  const max=Math.max(1,Number(model.maxTick||model.period||1)),markers=model.stops.map((stop,index)=>{const left=clamp(Number(stop.tick)/max*100,0,100),origin=shiftedOrigin(stop);return `<button type="button" class="path-stop-marker" data-path-stop-tick="${stop.tick}" style="--stop-left:${left}%" title="Stop ${index+1} · tick ${stop.tick} · ${origin[0]}, ${origin[1]}"><span></span></button>`}).join('');
  const stopList=model.stops.map((stop,index)=>{const origin=shiftedOrigin(stop);return `<button type="button" data-path-stop-tick="${stop.tick}">${index+1}<small>${origin[0]},${origin[1]}</small></button>`}).join('');
  const pinned=timelineScrub&&String(timelineScrub.sourceKey)===String(sourceKey);
  return `<div class="inspector-group path-timeline-card"><div class="presentation-heading"><div><h3>Path timeline</h3><p>Scrub this session's live native runtime capture. Markers are stationary stop points.</p></div><span class="presentation-pn">${pinned?'SCRUB':'LIVE'}</span></div><div class="path-timeline-meta"><span>tick <b data-path-timeline-tick>${phase}</b> / ${model.period}</span><span>origin <b data-path-timeline-origin>${position}</b></span></div><div class="path-timeline-track"><input type="range" min="0" max="${max}" step="1" value="${sourceTimelineTick(model,phase)}" data-path-timeline="${escapeHtml(sourceKey)}" aria-label="Entity path timeline">${markers}</div><div class="path-stop-list">${stopList}</div>${pinned?'<button type="button" class="path-timeline-live" data-action="resume-source-timeline">Resume live simulation</button>':''}</div>`;
}

function renderInspector(){
  const s=primarySelection(),d=store.document,cs=collisionSelections();
  if(!s&&hoverCell?.point){hoverCell={...hoverCell,inspection:hoverCellAt(hoverCell.point)};if(hoverCell.inspection){ui.inspector_content.innerHTML=hoverCellInspectorHtml(hoverCell.inspection);return;}}

  if(cs.length&&cs.length===selection.length){ui.inspector_content.innerHTML=collisionSelectionInspector(cs);return;}
  if(s?.kind==='region'){const regions=selection.filter(row=>row.kind==='region'),cells=regions.reduce((sum,row)=>sum+Math.ceil(row.width/8)*Math.ceil(row.height/8),0),canDepth=regions.some(row=>row.mode==='background'||row.mode==='foreground'||row.mode==='all');ui.inspector_content.innerHTML=`<div class="inspector-group"><h3>${escapeHtml(SELECT_REGION_PRESENTATION[s.mode]?.label||'Region selection')} <span>${regions.length} region${regions.length===1?'':'s'}</span></h3><dl class="diagnostic-kv"><div><dt>Bounds</dt><dd>${Math.round(s.x)}, ${Math.round(s.y)} · ${Math.round(s.width)}×${Math.round(s.height)}</dd></div><div><dt>Grid</dt><dd>${cells} × 8px cells selected</dd></div><div><dt>Reset scope</dt><dd>${s.mode==='background'?'Plane B':s.mode==='foreground'?'Plane A':'all rendered layers + collision/actors'}</dd></div></dl><p class="property-help">Reset returns this rectangle to decoded RDX without altering modifications outside it. Effective A–F layers remain active outside reset regions.</p></div>${canDepth?presentationDepthActionsHtml():''}`;return;}
  if(!s){ if(tool==='collision'){ui.inspector_content.innerHTML=collisionToolInspector();return;} if(tool==='brush'||tool==='rectangle'){ui.inspector_content.innerHTML=tileToolInspector();return;} ui.inspector_content.innerHTML='<div class="empty-inspector"><span>◇</span><strong>Nothing selected</strong><p>Select a tile, collision cell, actor or hero start to edit it.</p></div>';return; }
  if(s.kind==='native-transition'){const row=selectedNativeTransition();if(!row){ui.inspector_content.innerHTML='<div class="empty-inspector">Transition marker unavailable.</div>';return;}ui.inspector_content.innerHTML=`<div class="inspector-group"><h3>xrick map connector <span>${escapeHtml(row.connectorId||String(row.connectorIndex))}</span></h3><dl class="diagnostic-kv"><div><dt>Current room</dt><dd>${transitionRoomLabel(row.sourceSubmap)}</dd></div><div><dt>Direction</dt><dd>${escapeHtml(row.side)}</dd></div><div><dt>rowout</dt><dd>0x${row.rowout.toString(16).padStart(2,'0')}</dd></div><div><dt>Destination</dt><dd>${transitionRoomLabel(row.targetSubmap)}</dd></div><div><dt>rowin</dt><dd>0x${row.rowin.toString(16).padStart(2,'0')}</dd></div><div><dt>RDX contact</dt><dd>${escapeHtml(row.contactSource)} · ${escapeHtml(row.status)}</dd></div><div><dt>Position</dt><dd>${Math.round(row.position[0])}, ${Math.round(row.position[1])}</dd></div></dl><p class="property-help">This is one native <code>map_connect[]</code> record selected from the current room by direction and rowout. Its rowin aligns the destination; xrick does not define a separate entry object.</p></div>`;return;}
  if(s.kind==='presentation-depth'){const row=presentationDepthRowForSelection(s);if(!row){ui.inspector_content.innerHTML='<div class="empty-inspector">Presentation-depth rule unavailable.</div>';return;}const b=row.bounds;ui.inspector_content.innerHTML=`<div class="inspector-group"><h3>Presentation depth <span>${escapeHtml(row.origin)}</span></h3><dl class="diagnostic-kv"><div><dt>Plane</dt><dd>${escapeHtml(row.plane)}</dd></div><div><dt>Band</dt><dd>${escapeHtml(row.band)}</dd></div><div><dt>Bounds</dt><dd>${b[0]}, ${b[1]} · ${b[2]}×${b[3]}</dd></div><div><dt>Rule</dt><dd>${escapeHtml(row.id)}</dd></div></dl><p class="property-help">This changes only compositing order. It does not move artwork, alter collision, or change the RDX source plane.</p></div>${presentationDepthActionsHtml()}`;return;}
  if(s.kind==='presentation-depth-class'){const id=String(s.id).replace(/^class:/,''),row=(resolvedPresentationDepth()?.classes||[]).find(rule=>String(rule.id)===id);ui.inspector_content.innerHTML=row?`<div class="inspector-group"><h3>${escapeHtml(row.label||row.id)} <span>global depth class</span></h3><dl class="diagnostic-kv"><div><dt>Plane</dt><dd>${escapeHtml(row.plane)}</dd></div><div><dt>Band</dt><dd>${escapeHtml(row.band)}</dd></div><div><dt>Exact source tiles</dt><dd>${row.globalTiles?.length||0}</dd></div></dl><p class="property-help">Shared depth classes apply to every occurrence of their reviewed source-art identities. Select an occurrence in the room to author or revert a shared classification; local overrides remain available for exceptions.</p></div>`:'';return;}
  if(s.kind==='entity'){
    const e=d.entities.find(x=>x.id===s.id);if(!e)return;const cat=entityCatalogRow(e.entity),assignment=entityAssignmentSummary(e,resources?.entityCatalog),recommended=cat?.pnOptions?.length?cat.pnOptions:(cat?.pn>=0?[cat.pn]:[]),isShooter=/shoot|projectile|dart|rocket|gun/i.test(`${e.name} ${e.category} ${cat?.description||''}`),gameplayFlags=Object.entries(ENTITY_FLAGS).filter(([k])=>!k.startsWith('trigger'));
    ui.inspector_content.innerHTML=`<div class="inspector-group"><h3>Native entity <span>0x${e.entity.toString(16).padStart(2,'0')}</span></h3><label>Native behavior<select data-entity-key="entity">${entityTypeOptions(e.entity)}</select></label><div class="inspector-row" style="margin-top:7px"><span>Assigned behavior</span><span class="value">${escapeHtml(assignment.behavior)} · ${escapeHtml(assignment.category)}</span></div><div class="inspector-row"><span>Presentation mapping</span><span class="value">${escapeHtml(assignment.presentationStatus)}</span></div>${assignment.description?`<p class="property-help">${escapeHtml(assignment.description)}</p>`:''}<div class="field-grid" style="margin-top:7px"><label class="full">Instance name<input data-entity-key="name" value="${escapeHtml(e.name)}"></label>${inspectorField('X','x',e.x)}${inspectorField('Y','y',e.y)}${inspectorField('Patrol/reset X','patrolX',e.patrolX)}${inspectorField('Patrol/reset Y','patrolY',e.patrolY)}${inspectorField('Initial delay','latency',e.latency,'number','min="0" max="255"')}${inspectorField(isShooter?'Projectile cadence':'Action cadence','actionPeriod',e.actionPeriod??1,'number','min="1" max="255"')}</div><p class="property-help">Changing Native behavior changes the xrick controller. Catalog-owned names and sprite mappings follow the new behavior automatically; deliberately customized names or PN assignments are preserved. Position is the live spawn. Patrol/reset is the native xsave/ysave loop origin.</p><button type="button" class="linked-editor-button" data-action="edit-activator"><span>◎</span><span><strong>Connected activator</strong><small>${Math.round(e.triggerX)}, ${Math.round(e.triggerY)} · ${escapeHtml(triggerFlagLabel(e.flags))}</small></span><span>›</span></button></div>
    <div class="inspector-group presentation-card"><div class="presentation-heading"><div><h3>RDX presentation</h3><p>Visual-only sprite, pose, transform and depth.</p></div><span class="presentation-pn">${e.pn>=0?`PN ${e.pn}`:'native'}</span></div><div class="presentation-preview"><span class="presentation-preview-art ${e.pn<0?'empty':''}" data-pn-thumb="${e.pn}">${e.pn<0?'—':''}</span><div><strong>${e.pn>=0?`PN ${e.pn}`:'Native mapping'}</strong><small>${e.pn>=0?pnRowMeta(pnCatalogRows().find(r=>Number(r.index)===Number(e.pn))):'No presentation override'}</small></div></div><div class="sprite-assignment"><div class="sprite-assignment-field"><span class="sprite-field-label">Sprite / animation</span>${pnPickerHtml(e.pn,recommended)}</div><button type="button" data-action="use-mapped-sprite" ${cat?.pn>=0?'':'disabled'}>Mapped</button></div>${entityFramePickerHtml(e)}<div class="presentation-subgroup"><div class="presentation-subhead"><span>Transform</span><small>around RDX origin</small></div><div class="transform-grid"><label class="toggle-tile"><span>Mirror X</span><small>Horizontal flip</small><input data-entity-bool="mirrorX" type="checkbox" ${e.mirrorX?'checked':''}></label><label class="toggle-tile"><span>Mirror Y</span><small>Vertical flip</small><input data-entity-bool="mirrorY" type="checkbox" ${e.mirrorY?'checked':''}></label></div></div><div class="presentation-subgroup"><label class="presentation-select"><span>Occlusion</span><select data-entity-occlusion><option value="world" ${e.front?'':'selected'}>World · behind foreground</option><option value="front" ${e.front?'selected':''}>Front · above foreground</option></select></label><p class="property-help">World actors can be covered by Plane A scenery. Front actors render after Plane A. Use Front only for presentation that must occlude foreground scenery.</p></div><label class="toggle-tile enabled-tile"><span>Enabled</span><small>Include this instance in preview and native playtest</small><input data-entity-bool="enabled" type="checkbox" ${e.enabled!==false?'checked':''}></label></div>
    <div class="inspector-group"><h3>Gameplay flags</h3><div class="flag-grid">${gameplayFlags.map(([k,b])=>`<label><input data-entity-flag="${b}" type="checkbox" ${(e.flags&b)?'checked':''}>${escapeHtml(k)}</label>`).join('')}</div></div><div class="inspector-actions"><button data-action="duplicate-entity">Duplicate</button><button class="danger" data-action="delete-entity">Delete</button></div>`;requestAnimationFrame(()=>{renderPnThumbs(ui.inspector_content);renderEntityFrameThumbs(ui.inspector_content)});
  } else if(s.kind==='activator'){
    const e=d.entities.find(x=>x.id===s.id);if(!e)return;const triggers=Object.entries(ENTITY_FLAGS).filter(([k])=>k.startsWith('trigger'));
    ui.inspector_content.innerHTML=`<div class="inspector-group activator-card"><div class="presentation-heading"><div><h3>Connected activator</h3><p>Native trigger connected to ${escapeHtml(e.name)}.</p></div><span class="presentation-pn">◎</span></div><button type="button" class="linked-editor-button" data-action="select-connected-entity"><span>◇</span><span><strong>${escapeHtml(e.name)}</strong><small>Actor at ${Math.round(e.x)}, ${Math.round(e.y)}</small></span><span>›</span></button><div class="field-grid" style="margin-top:9px">${inspectorField('Trigger X','triggerX',e.triggerX)}${inspectorField('Trigger Y','triggerY',e.triggerY)}</div><div class="presentation-subhead"><span>Activation</span><small>${escapeHtml(triggerFlagLabel(e.flags))}</small></div><div class="flag-grid">${triggers.map(([k,b])=>`<label><input data-entity-flag="${b}" type="checkbox" ${(e.flags&b)?'checked':''}>${escapeHtml(k.replace('trigger',''))}</label>`).join('')}</div><p class="property-help">The dashed Scene connection is the actor → activator relationship. Trigger coordinates are stored in the same RDX world space as the actor and are passed directly to the native editor entity.</p></div>`;
  } else if(s.kind==='scenery'){
    const base=reviewedSceneryRows().find(row=>String(row.sourceKey||`map-visual:${row.id}`)===String(s.id));if(!base)return;const e=effectiveScenery(base),specialNote=reviewedScenerySpecialCaseNote(base);
    ui.inspector_content.innerHTML=`<div class="inspector-group"><h3>RDX scenery <span>${escapeHtml(e.sourceKey)}</span></h3><div class="inspector-row"><span>Origin</span><span class="value">${Math.round(e.origin[0])}, ${Math.round(e.origin[1])}</span></div><div class="inspector-row"><span>Presentation</span><span class="value">PN ${e.pn}</span></div><p class="property-help">This is canonical reviewed scenery from the layered production graph. Arbitrary editor-only presentation overrides were removed; change scenery through a typed layered correction instead.</p>${specialNote?`<p class="property-help">${escapeHtml(specialNote)}</p>`:''}</div>`;
  } else if(s.kind==='source'){
    const mark=Number(String(s.id).replace('mark:','')),e=sourceEntityRows().find(x=>Number(x.mark)===mark),sel=sourceSelectables.find(x=>x.sourceKey===`mark:${mark}`),enemy=sourceEnemyAuthoring(mark),semantic=resolvedSemanticForMark(mark),cat=entityCatalogRow(enemy?.effectiveEntity??e?.entity),nativePn=Number(cat?.pn??-1),effectivePn=Number(sel?.pn??nativePn),layerEPresentation=sourceLayerEPresentationForMark(mark),pn=sourcePresentationPn(mark,effectivePn),overridden=sourceOverride(mark)?.presentationPn!=null,placement=sourcePlacement(mark),placementOverridden=placement.dx!==0||placement.dy!==0,recommended=cat?.pnOptions?.length?cat.pnOptions:(cat?.pn>=0?[cat.pn]:[]),stateful=sourcePresentationStates(mark).length>1,runtimeSuppressed=sel?.runtimeSuppressed===true,suppressionReason=String(sel?.suppression?.reason||''),suppressionHtml=runtimeSuppressed?`<div class="inspector-row"><span>Production disposition</span><span class="value">Suppressed in gameplay · editor evidence only</span></div><p class="property-help">${escapeHtml(suppressionReason||'Reviewed semantic suppression remains authoritative for runtime projection.')}</p>`:'',movingPlatform=semantic?.family==='moving-platform',draftDirection=String(sourceOverride(mark)?.movingPlatformDirection||''),productionDirection=String(semantic?.controller?.reviewedParameters?.direction||semantic?.controller?.parameters?.direction||''),movingPlatformDirection=['left','right'].includes(draftDirection)?draftDirection:(['left','right'].includes(productionDirection)?productionDirection:'right'),movingPlatformHtml=movingPlatform?`<div class="inspector-group"><h3>Moving-platform controller <span>${draftDirection?'draft':'production'}</span></h3><label>Release direction<select data-source-moving-platform-direction><option value="left" ${movingPlatformDirection==='left'?'selected':''}>Left</option><option value="right" ${movingPlatformDirection==='right'?'selected':''}>Right</option></select></label><p class="property-help">This authors the native controller direction through the reviewed-correction pipeline. Preview does not mirror or fake native motion; promote/reload the reviewed correction before production playtest.</p>${draftDirection?'<button type="button" data-action="revert-source-moving-platform-direction">Use production controller direction</button>':''}</div>`:'';
    ui.inspector_content.innerHTML=`<div class="inspector-group"><h3>Production source <span>mark ${mark}</span></h3>${suppressionHtml}<div class="inspector-row"><span>Classic source entity</span><span class="value">0x${Number(e?.entity||0).toString(16).padStart(2,'0')} · Layer B authority</span></div><div class="inspector-row"><span>Native default mapping</span><span class="value">${nativePn>=0?`PN ${nativePn}`:'unassigned'}</span></div><div class="inspector-row"><span>${layerEPresentation?'Layer E presentation':'Draft presentation'}</span><span class="value">${pn>=0?`PN ${pn}`:'native mapping'}${overridden?' · overridden':''}</span></div><div class="inspector-row"><span>Mapping id</span><span class="value">${escapeHtml(cat?.mappingId||'none')}</span></div><p class="property-help">Classic/xrick remains source authority. Enemy Type, Kind and bounded patrol can be reviewed directly below; Convert is still required for arbitrary flags, trigger geometry or other synthetic native state.</p></div>${enemy?sourceEnemyInspectorHtml(mark):''}${movingPlatformHtml}${sourceTimelineInspectorHtml(`mark:${mark}`)}<div class="inspector-group"><h3>Trajectory placement <span>${placementOverridden?'reviewed offset':'production'}</span></h3><div class="field-grid">${inspectorField('Offset X','sourcePlacementX',placement.dx)}${inspectorField('Offset Y','sourcePlacementY',placement.dy)}</div><p class="property-help">Drag this source actor in Select mode or use the arrow keys for 1 px nudges. The Layer-F offset translates the source/body around its canonical ResolvedLevel placement without changing path shape, period, controller or PN. Scene and native Playtest compose that offset with any Layer-C alignment delta exactly once. With Snap enabled, dragging uses the actor's opaque sprite edges only to choose the delta on the current ${Number(d.settings.gridSize||8)} px grid; the chosen delta is never recomputed from shifted bounds.</p>${placementOverridden?'<button type="button" data-action="revert-source-placement">Revert trajectory placement</button>':''}</div>${stateful?sourceStatePresentationInspectorHtml(mark):''}${sourceOcclusionInspectorHtml(mark)}${stateful?'':`<div class="inspector-group"><h3>Assign RDX sprite</h3><div class="sprite-assignment-field"><span class="sprite-field-label">Replacement / assignment</span>${pnPickerHtml(pn,recommended,{sourceMark:mark})}</div><p class="property-help">Choose a PN for Layer-E RDX presentation. The source keeps its resolved presentation registration point; changing artwork does not recenter from opaque pixels or move gameplay. This never selects the enemy Kind; Kind is the RDX animation-family selector above.</p></div>`}<div class="inspector-actions">${overridden?'<button data-action="revert-source-sprite">Use production mapping</button>':''}<button data-action="convert-source">Convert gameplay / native state</button><button data-action="suppress-source" class="danger">Suppress</button></div>`;requestAnimationFrame(()=>renderPnThumbs(ui.inspector_content.querySelector('.sprite-picker-current')));
  } else if(s.kind==='source-activator'){
    const mark=Number(String(s.id).replace('mark:','')),e=sourceEntityRows().find(x=>Number(x.mark)===mark),p=sourceWorldPoint(mark,{trigger:true}),cat=entityCatalogRow(e?.entity);
    ui.inspector_content.innerHTML=`<div class="inspector-group activator-card"><div class="presentation-heading"><div><h3>Production activator</h3><p>Connected to source mark ${mark} · ${escapeHtml(cat?.name||`0x${Number(e?.entity||0).toString(16)}`)}.</p></div><span class="presentation-pn">ROM</span></div><div class="field-grid">${inspectorField('RDX X','readonlyTriggerX',Math.round(p.x),'number','readonly')}${inspectorField('RDX Y','readonlyTriggerY',Math.round(p.y),'number','readonly')}</div><div class="inspector-row"><span>Activation</span><span class="value">${escapeHtml(triggerFlagLabel(Number(e?.flags||0)))}</span></div><p class="property-help">Production trigger geometry is immutable in a draft. Presentation states below are the visual outputs connected to this native lifecycle.</p></div>${sourceStatePresentationInspectorHtml(mark,{activator:true})}<div class="inspector-actions"><button data-action="select-source-actor">Select actor</button><button data-action="convert-source-activator" class="primary">Convert & edit gameplay</button></div>`;requestAnimationFrame(()=>renderPnThumbs(ui.inspector_content));
  } else if(s.kind==='hero'){
    const baseline=productionDocument(roomForSubmap(d.base.submap)).heroStart,changed=heroStartChangedFromProduction();
    ui.inspector_content.innerHTML=`<div class="inspector-group"><h3>Hero start <span>RDX descriptor world</span></h3><div class="field-grid">${inspectorField('X','heroX',d.heroStart.x)}${inspectorField('Y','heroY',d.heroStart.y)}</div><p class="property-help">This exact RDX world coordinate is installed into the shared xrick Rick solver after the draft MT/ML descriptors are applied. A coordinate mismatch is a bridge/parity failure. Use it as a temporary playtest checkpoint, then reset it before exporting reviewed corrections.</p><div class="inspector-row"><span>Production start</span><span class="value">${Math.round(Number(baseline?.x||0))}, ${Math.round(Number(baseline?.y||0))}</span></div>${changed?'<button type="button" data-action="reset-hero-start">Use production start</button>':''}</div>`;
  } else if(s.kind==='layer'){
    const l=d.layers[s.id];ui.inspector_content.innerHTML=`<div class="inspector-group"><h3>${escapeHtml(s.id)} layer</h3><div class="inspector-row"><span>Visible</span><input data-layer-bool="visible" type="checkbox" ${l.visible?'checked':''}></div><div class="inspector-row"><span>Locked</span><input data-layer-bool="locked" type="checkbox" ${l.locked?'checked':''}></div>${s.id==='background'||s.id==='foreground'?'<p class="property-help">Selecting this layer makes it the active tile-paint target.</p>':''}</div>`;
  } else if(s.kind==='stamp'){
    const placement=d.stamps?.find(x=>x.id===s.id),stamp=stampById(resources.stampCatalog,placement?.variantId||placement?.stampId),family=stampFamilyById(resources.stampCatalog,placement?.familyId)||familyForStamp(resources.stampCatalog,stamp?.id);if(!placement||!stamp)return;ui.inspector_content.innerHTML=`<div class="inspector-group"><h3>Smart stamp <span>${placement.cell.join(', ')}</span></h3><div class="inspector-row"><span>Family</span><span class="value">${escapeHtml(family?.label||stamp.label)}</span></div><div class="inspector-row"><span>Chosen variant</span><span class="value">${escapeHtml(stamp.label)}${placement.mirrorX?' · mirrored':''}</span></div><div class="inspector-row"><span>Size</span><span class="value">${stamp.sizeCells.join(' × ')} cells</span></div><div class="inspector-row"><span>Sampled</span><span class="value">${stamp.repeatCount} occurrence${stamp.repeatCount===1?'':'s'} · ${stamp.mapCount} map${stamp.mapCount===1?'':'s'}</span></div><div class="inspector-row"><span>Source</span><span class="value">${md(stamp.sourceMapId)} · c16 ${stamp.originCell.join(',')}</span></div><p class="property-help">A smart stamp stores the motif family plus the chosen production variant. Click starts with the smallest context-fitting fragment; dragging expands the same motif family. Variant choices are ranked against the surrounding area.</p></div><div class="inspector-actions"><button data-action="stamp-alternatives">Choose variant</button><button data-action="select-stamp">Use this family</button><button class="danger" data-action="remove-stamp">Remove stamp</button></div>`;
  } else if(s.kind==='terrain-relation'){
    const relation=d.terrainRelations?.find(r=>r.id===s.id);if(!relation)return;const set=terrainSetById(resources.autotileCatalog,relation.terrainSet),ranked=rankSupportPrototypes(d,resources.autotileCatalog,relation,{collisionAt:nativeAutotileCollisionAt,visualAt:nativeAutotileVisualAt}),chosen=set?.supportPrototypes?.find(p=>p.id===relation.prototypeId)||ranked[0]?.prototype;
    ui.inspector_content.innerHTML=`<div class="inspector-group"><h3>Smart support <span>${relation.anchor.join(',')}</span></h3><div class="inspector-row"><span>Terrain family</span><span class="value">${escapeHtml(set?.label||relation.terrainSet)}</span></div><div class="inspector-row"><span>Gesture</span><span class="value">walkway ↓ ${relation.end[1]-relation.anchor[1]} cells</span></div><div class="inspector-row"><span>Production match</span><span class="value">${escapeHtml(chosen?.id||'unresolved')}</span></div><div class="inspector-row"><span>Alternatives</span><span class="value">${ranked.length}</span></div><p class="property-help">This pole exists because it was explicitly drawn downward from the walkway. Horizontal ledge extension never creates a support relation. Rendering stops before blocking terrain.</p></div><div class="inspector-actions"><button data-action="support-alternatives">Choose alternative</button><button class="danger" data-action="remove-support">Remove support</button></div>`;
  } else if(s.kind==='terrain'){
    const cell=d.terrain.find(t=>t.id===s.id);if(!cell)return;const set=terrainSetById(resources.autotileCatalog,cell.terrainSet),resolved=resolveTerrainCell(d,resources.autotileCatalog,cell,{nativeConnects:nativeAutotileConnects,collisionAt:nativeAutotileCollisionAt,visualAt:nativeAutotileVisualAt});const rawOverrides=d.tiles.filter(t=>Math.floor(t.target[0]/2)===cell.cell[0]&&Math.floor(t.target[1]/2)===cell.cell[1]).length,manualCollision=collisionOverrideAt(cell.cell[0]+1,cell.cell[1]+1);
    ui.inspector_content.innerHTML=`<div class="inspector-group"><h3>Auto-tile terrain <span>${cell.cell[0]}, ${cell.cell[1]}</span></h3><div class="inspector-row"><span>Set</span><span class="value">${escapeHtml(set?.label||cell.terrainSet)}</span></div><div class="inspector-row"><span>Cardinal mask</span><span class="value">${resolved?`0x${resolved.mask.toString(16).toUpperCase()}`:'unresolved'}</span></div><div class="inspector-row"><span>Diagonal mask</span><span class="value">${resolved?`0x${resolved.diagonalMask.toString(16).toUpperCase()}`:'—'}</span></div>${resolved?.pathRole?`<div class="inspector-row"><span>Path solve</span><span class="value">${escapeHtml(resolved.pathRole)} · ${escapeHtml(resolved.pathPrototypeId||'prototype')}${resolved.junctionOutputCount?` · repairs ${resolved.junctionOutputCount} junction outputs`:''}</span></div>`:''}${resolved?.attachmentContext?`<div class="inspector-row"><span>Attachments</span><span class="value">N ${escapeHtml(resolved.attachmentContext.N)} · E ${escapeHtml(resolved.attachmentContext.E)} · S ${escapeHtml(resolved.attachmentContext.S)} · W ${escapeHtml(resolved.attachmentContext.W)}</span></div>`:''}<div class="inspector-row"><span>Rendered outputs</span><span class="value">${resolved?(resolved.variant.outputs||[{layer:'B',sourceMapId:resolved.variant.sourceMapId,sourceCell:resolved.variant.sourceCell}]).map(o=>`${o.layer}←${md(o.sourceMapId)} ${o.sourceCell.join(',')}`).join(' · '):'—'}</span></div><div class="inspector-row"><span>Gameplay</span><span class="value">${cell.collisionMode==='catalog'?(set?.collision||'preserve'):cell.collisionMode}${manualCollision?' · manual override':''}</span></div><div class="inspector-row"><span>Manual presentation</span><span class="value">${rawOverrides} raw 8×8 override${rawOverrides===1?'':'s'}</span></div><p class="property-help">Neighbor changes re-resolve this cell automatically. Raw presentation and explicit collision edits remain layered above this generated result.</p></div><div class="inspector-actions"><button data-action="shuffle-terrain">Shuffle variation</button><button data-action="select-terrain-set">Use this set</button><button class="danger" data-action="remove-terrain">Remove terrain</button></div>`;
  } else if(s.kind==='cell'){
    const gx=Number(s.gx),gy=Number(s.gy),layer=s.layer||selectedLayerPlane(),t=d.tiles.find(x=>x.target?.[0]===gx&&x.target?.[1]===gy&&x.layer===layer),lx=Math.floor(gx/2)+1,ly=Math.floor(gy/2)+1,co=collisionOverrideAt(lx,ly),base=descriptorCollisionBase(lx,ly);
    const depth=presentationCellInspection(layer,gx,gy),seed=depth?.seed,seedText=seed?`${seed.classification} · ${Math.round(Number(seed.confidence||0)*100)}% confidence`:'—';
    ui.inspector_content.innerHTML=`<div class="inspector-group"><h3>Map piece <span>${layer} · g8 ${gx},${gy}</span></h3><div class="inspector-row"><span>Visual</span><span class="value">${t?(t.operation==='clear'?'cleared':`${md(t.sourceMapId)} ${t.sourceLayer} ${t.source?.join(',')}`):'production base'}</span></div><div class="inspector-row"><span>Source plane</span><span class="value">${escapeHtml(depth?.plane||layer)}</span></div><div class="inspector-row"><span>Presentation band</span><span class="value">${escapeHtml(depth?.band||'—')} · ${escapeHtml(depth?.origin||'default')}${depth?.ruleId?` · ${escapeHtml(depth.ruleId)}`:''}</span></div><div class="inspector-row"><span>Visual identity</span><span class="value"><small>${escapeHtml(depth?.visualIdentity||'—')}</small></span></div><div class="inspector-row"><span>Occurrences</span><span class="value">${depth?.occurrences??'—'} across mapped source maps</span></div>${layer==='B'?`<div class="inspector-row"><span>Open/close seed</span><span class="value">${escapeHtml(seedText)}</span></div>`:''}<div class="inspector-row"><span>Collision owner</span><span class="value">logic ${lx}, ${ly} · 16×16</span></div><div class="inspector-row"><span>Effective collision</span><span class="value">${collisionEffective(lx,ly)}${co?' · override':' · descriptor base'}</span></div><label>Collision override<select data-cell-collision="${lx},${ly}">${collisionOptions(co?.collision||'original',base)}</select></label><p class="property-help">Presentation depth changes only compositing order. Collision remains owned by the native 16×16 MT/ML descriptor.</p></div><div class="inspector-actions"><button data-action="replace-cell" class="primary">Use selected tile</button><button data-action="clear-cell">Clear visual</button><button data-action="revert-cell">Revert visual</button></div>${presentationDepthClassActionsHtml(depth)}${presentationDepthActionsHtml()}`;
  } else if(s.kind==='tile'){
    const t=d.tiles.find(x=>x.id===s.id);ui.inspector_content.innerHTML=t?`<div class="inspector-group"><h3>Presentation tile <span>${t.layer} ${t.target.join(',')}</span></h3><div class="inspector-row"><span>Operation</span><span class="value">${t.operation}</span></div><div class="inspector-row"><span>Source</span><span class="value">${t.source?`${md(t.sourceMapId)} ${t.sourceLayer} ${t.source.join(',')}`:'clear'}</span></div></div><div class="inspector-actions"><button data-action="revert-tile" class="danger">Revert to base</button></div>`:'';
  }
}
function tileToolInspector(){if(stampElementPaintMode()){const element=selectedStampElement;return `<div class="inspector-group"><h3>Exact presentation element <span>8 × 8</span></h3><div class="inspector-row"><span>Element</span><span class="value">${escapeHtml(element?.label||'pick from Library')}</span></div><div class="inspector-row"><span>Sources</span><span class="value">${element?escapeHtml(stampElementSourcesLabel(element)):'—'}</span></div><p class="property-help">This is an exact production 8×8 presentation element exposed beside smart stamps. Brush, Rectangle and Fill paint all authored presentation outputs together; gameplay collision remains separate.</p></div>`;}if(stampPaintMode()){const family=selectedStamp,variants=family?variantsForFamily(resources?.stampCatalog,family):[],weighted=family?.variantPolicy==='weighted-common';return `<div class="inspector-group"><h3>Smart stamp <span>${weighted?'weighted variation':'progressive motif'}</span></h3><div class="inspector-row"><span>Family</span><span class="value">${escapeHtml(family?.label||'pick from Library')}</span></div><div class="inspector-row"><span>Production variants</span><span class="value">${variants.length||'—'}</span></div><p class="property-help">${weighted?'Paint or drag across cells to place stable production-frequency-weighted variants. The same map cell resolves to the same authored variant, while larger painted areas naturally mix the common examples.':'Click places the smallest valid production fragment for this motif family. Drag farther to expand it using larger production examples. Dragging left-to-right or right-to-left is supported; right-to-left placements mirror the chosen production motif. The recommended variant is ranked from the surrounding terrain and visual context; the popup exposes the best distinct examples rather than near-duplicate samples.'}</p></div>`;}if(terrainPaintMode()){const set=selectedTerrainSet,pathHelp=set?.kind==='path'?' Path strokes are continuous and re-solve the connected component: a floor-supported bottom stays anchored, former endpoints become middle pieces, and repainting across the path repairs it as one structure.':'';const relationHelp=set?' Adjacent semantic structures are attachment constraints: ladders, ledges, floors and walls can repair each other using production-mined junctions. Edge brushes are gesture-aware: horizontal strokes extend a walkway; dragging downward from a walkway explicitly grows a sampled support pole and stops at blocking terrain. When several production-valid continuations exist, the smart-construction chooser recommends the option that best matches the local context.':'';return `<div class="inspector-group"><h3>Auto-tile terrain <span>16 × 16</span></h3><div class="inspector-row"><span>Terrain set</span><span class="value">${escapeHtml(set?.label||'pick from Library')}</span></div><div class="inspector-row"><span>Rule type</span><span class="value">${escapeHtml(set?.kind||'—')}${set?.pathAxis?` · ${escapeHtml(set.pathAxis)}`:''}</span></div><div class="inspector-row"><span>Behavior</span><span class="value">${escapeHtml(store.document.settings.terrainCollisionMode||'catalog')}</span></div><p class="property-help">Terrain is authored semantically on the RDX source 16×16 cell grid. Each cell resolves to existing RDX 8×8 source tiles.${pathHelp}${relationHelp} Explicit raw-tile and collision edits are layered afterward and therefore win.</p></div>`;}return `<div class="inspector-group"><h3>Raw presentation paint <span>${selectedTile?.kind==='cell16'?'16 × 16':'8 × 8'}</span></h3><div class="inspector-row"><span>Source mode</span><span class="value">${escapeHtml(rawSourceMode())}</span></div><div class="inspector-row"><span>Source</span><span class="value">${selectedTile?(selectedTile.kind==='cell16'?`${md(selectedTile.sourceMapId)} · c16 ${selectedTile.cell.join(',')} · ${escapeHtml(selectedTile.classification||'presentation')}`:`${md(selectedTile.sourceMapId)} ${selectedTile.sourceLayer} · g8 ${selectedTile.x},${selectedTile.y}`):'pick from Library'}</span></div><p style="font-size:10px;color:var(--muted)">Smart 16×16 cells reproduce the complete RDX presentation: B-only and A-only sources clear the unused plane, while composite sources copy both A+B. Exact 8×8 modes remain available for surgical per-plane edits.</p></div>`;}
function collisionToolInspector(){const gameplay=collisionAuthoring==='gameplay',values=gameplay?['open','one-way','climb-through','lethal']:Object.keys(COLLISION_PRESETS).filter(k=>k!=='original');if(gameplay&&!values.includes(activeCollision))activeCollision='open';return `<div class="inspector-group"><h3>Collision <span>${gameplay?'Gameplay · 8×8':'Advanced Descriptor · 16×16'}</span></h3>${collisionAuthoringSwitch()}${collisionInteractionSwitch()}<label>Paint behavior<select id="collision-brush-select">${values.map(k=>`<option ${k===activeCollision?'selected':''}>${k}</option>`).join('')}</select></label><p class="property-help">${gameplay?'Select or paint exact 8×8 gameplay cells. These corrections are canonical and safe for Reviewed Fix promotion and native Playtest.':'Advanced mode edits raw 16×16 MT/ML descriptors. Because descriptor quadrants may have different 8×8 semantics, these edits cannot be promoted automatically.'}</p></div>`;}

function transitionTargetOptions(selected){
  return resources.manifest.rooms.map(r=>`<option value="${r.submap}" ${Number(selected)===Number(r.submap)?'selected':''}>${sm(r.submap)} · ${md(r.mapId)} · ${escapeHtml(String(r.group||'room').replaceAll('_',' '))}</option>`).join('');
}
function renderLevelSettings(){
  const d=store.document;
  const transitions=d.transitions.map((t,i)=>`<div class="transition-card">
    <div class="transition-card-head"><strong>${t.side==='left'?'← Left exit':'Right exit →'}</strong><button data-remove-transition="${i}" class="danger icon-button" title="Remove transition">×</button></div>
    <div class="field-grid">
      <label>Exit side<select data-transition-index="${i}" data-transition-key="side"><option value="right" ${t.side==='right'?'selected':''}>Right</option><option value="left" ${t.side==='left'?'selected':''}>Left</option></select></label>
      <label>Contact row<input type="number" data-transition-index="${i}" data-transition-key="contactRow" value="${Number(t.contactRow)}" min="0" max="255" step="1"></label>
      <label>Target room<select data-transition-index="${i}" data-transition-key="targetSubmap">${transitionTargetOptions(t.targetSubmap)}</select></label>
      <label>Target row<input type="number" data-transition-index="${i}" data-transition-key="rowIn" value="${Number(t.rowIn)}" min="0" max="255" step="1"></label>
      <label>Entry X<input type="number" data-transition-index="${i}" data-transition-key="entryX" value="${Number(t.entryX)}" step="1"></label>
      <label>Entry Y<input type="number" data-transition-index="${i}" data-transition-key="entryY" value="${Number(t.entryY)}" step="1"></label>
      <label class="full">Camera row<input type="number" data-transition-index="${i}" data-transition-key="entryFrow" value="${Number(t.entryFrow)}" min="0" max="255" step="1"></label>
    </div>
  </div>`).join('');
  ui.level_settings.innerHTML=`<div class="inspector-group"><h3>Level document <span>${LEVEL_EDITOR_VERSION}</span></h3><div class="field-grid"><label class="full">Name<input data-level-key="name" value="${escapeHtml(d.name)}"></label>${inspectorField('Width','width',d.bounds.width,'number','step="16" min="16" max="320"')}${inspectorField('Height','height',d.bounds.height,'number','step="16" min="16"')}</div><div class="inspector-row"><span>Blank base</span><span class="value">${d.base.blank?'yes':'production room'}</span></div><div class="inspector-row"><span>Host</span><span class="value">${sm(d.base.submap)} / ${md(d.base.mapId)}</span></div></div>
  <div class="inspector-group"><h3>Authoring</h3><label>Grid size<select data-setting="gridSize"><option value="8" ${d.settings.gridSize===8?'selected':''}>8 px</option><option value="16" ${d.settings.gridSize===16?'selected':''}>16 px</option></select></label><div class="inspector-row"><span>Snap</span><input data-setting-bool="snap" type="checkbox" ${d.settings.snap?'checked':''}></div></div>
  <div class="inspector-group"><h3>Metadata</h3><label>Music<select data-meta="music"><option ${d.metadata.music==='inherit'?'selected':''}>inherit</option><option ${d.metadata.music==='none'?'selected':''}>none</option></select></label><label style="margin-top:8px">Notes<textarea data-meta="notes">${escapeHtml(d.metadata.notes||'')}</textarea></label></div>
  <div class="inspector-group"><h3>RDX exits <span>${d.transitions.length}</span></h3><p class="inspector-note">Paint <b>exit</b> descriptor cells at the left/right edge, then route that direction here. Local playtest uses this exact transient descriptor topology and destination entry.</p><button data-action="add-transition">＋ Add RDX exit</button>${transitions||'<div class="empty-mini">No custom exit routes. Host topology remains active.</div>'}</div>`;
}
function renderValidation(issues=validateCurrent()){
  const errors=issues.filter(i=>i.severity==='error').length,warns=issues.filter(i=>i.severity==='warning').length;ui.validation_badge.textContent=String(errors+warns);ui.validation_badge.style.color=errors?'var(--error)':warns?'var(--warn)':'';
  if(!issues.length){ui.validation_list.innerHTML='<div class="validation-empty">✓ No document issues found.</div>';return;}
  ui.validation_list.innerHTML=issues.map(i=>`<div class="validation-item ${i.severity}"><span class="severity-icon">${i.severity==='error'?'!':i.severity==='warning'?'△':'i'}</span><div><strong>${escapeHtml(i.code)}</strong><p>${escapeHtml(i.message)}</p></div></div>`).join('');
}
function validateCurrent(){const dim=hostDimensions();const issues=validateLevelDocument(store.document,{hostWidth:dim.width,hostHeight:dim.height});
  if(!resources.roomBySubmap.has(store.document.base.submap))issues.push({severity:'error',code:'HOST_ROOM',message:'Native host room is missing from the runtime manifest.'});
  if(store.document.entities.some(e=>Number(e.pn)<0))issues.push({severity:'warning',code:'UNASSIGNED_PN',message:'One or more custom entities use native behavior without an explicit RDX PN. Runtime behavior remains valid but presentation can fall back.'});
  for(const cell of store.document.terrain){const set=terrainSetById(resources.autotileCatalog,cell.terrainSet);if(!set)issues.push({severity:'error',code:'AUTOTILE_SET',message:`Terrain cell ${cell.cell.join(',')} references unknown set ${cell.terrainSet}.`});else if(set.group&&set.group!==room?.group)issues.push({severity:'warning',code:'AUTOTILE_THEME',message:`${set.label} belongs to ${set.group}, while this room belongs to ${room?.group||'unknown'}.`});}
  for(const placement of store.document.stamps||[]){const stamp=stampById(resources.stampCatalog,placement.stampId);if(!stamp)issues.push({severity:'error',code:'STAMP_SET',message:`Stamp placement ${placement.id} references unknown stamp ${placement.stampId}.`});else if(stamp.group&&stamp.group!==room?.group)issues.push({severity:'warning',code:'STAMP_THEME',message:`${stamp.label} belongs to ${stamp.group}, while this room belongs to ${room?.group||'unknown'}.`});}
  for(const removal of store.document.systemPatchRemovals||[]){const patch=reviewedVisualPatchById(removal.patchId);if(!patch)issues.push({severity:'error',code:'SYSTEM_PATCH_REMOVAL_TARGET',message:`Reviewed visual patch ${removal.patchId} no longer exists in production data.`});else if(!canRetractReviewedSystemPatch(patch))issues.push({severity:'error',code:'SYSTEM_PATCH_REMOVAL_ACTION',message:`Reviewed visual patch ${removal.patchId} uses action ${patch.action||'unknown'}, which the Level Editor cannot yet neutralize locally.`});}
  for(const t of store.document.transitions)if(!resources.roomBySubmap.has(Number(t.targetSubmap)))issues.push({severity:'error',code:'TRANSITION_TARGET',message:`Native exit target ${t.targetSubmap} is not a mapped RDX room.`});
  if(!store.document.base.blank)issues.push(...currentReviewedFixPlan().issues);
  return issues;}
function switchInspector(tab){document.querySelectorAll('[data-inspector-tab]').forEach(b=>b.classList.toggle('active',b.dataset.inspectorTab===tab));ui.inspector_tab.classList.toggle('active',tab==='inspector');ui.level_tab.classList.toggle('active',tab==='level');ui.validation_tab.classList.toggle('active',tab==='validation');ui.diagnostics_inspector_tab.classList.toggle('active',tab==='diagnostics');if(tab==='level')renderLevelSettings();if(tab==='validation')renderValidation();if(tab==='diagnostics')renderDiagnosticsWorkspace();setDiagnosticsActive(tab==='diagnostics'||document.querySelector('[data-left-tab="diagnostics"]')?.classList.contains('active'));}

function roomLabel(r){return `${sm(r.submap)} · ${md(r.mapId)} · ${String(r.group||'room').replaceAll('_',' ')}`;}
function renderRoomGrid(filter=''){
  const q=filter.trim().toLowerCase();ui.room_grid.innerHTML=resources.manifest.rooms.filter(r=>!q||roomLabel(r).toLowerCase().includes(q)).map(r=>{const world=String(r.group||'room').replace(/[^a-z0-9_-]/gi,'-').toLowerCase();return `<button type="button" class="room-card world-${world}" data-room-world="${escapeHtml(world)}" data-open-submap="${r.submap}"><strong>${sm(r.submap)} → ${md(r.mapId)}</strong><span>${escapeHtml(String(r.group||'').replaceAll('_',' '))}</span><b>${r.nativeReady?'descriptor complete':'descriptor fallback'}</b></button>`}).join('');
}
function currentTerrainSets(){return terrainSetsForGroup(resources?.autotileCatalog,String(room?.group||''));}
function currentStampFamilies(){return stampFamiliesForGroup(resources?.stampCatalog,String(room?.group||''));}
function currentStampElements(){return stampElementsForGroup(resources?.stampCatalog,String(room?.group||''));}
function stampElementPaintMode(){return tileAuthoringMode==='stamp'&&!!selectedStampElement;}
function stampPaintMode(){return tileAuthoringMode==='stamp'&&!selectedStampElement;}
function setTileAuthoringMode(mode){
  tileAuthoringMode=['terrain','stamp','raw'].includes(mode)?mode:'terrain';
  document.querySelectorAll('[data-tile-authoring]').forEach(b=>b.classList.toggle('active',b.dataset.tileAuthoring===tileAuthoringMode));
  ui.terrain_library_pane.hidden=tileAuthoringMode!=='terrain';ui.stamp_library_pane.hidden=tileAuthoringMode!=='stamp';ui.raw_tile_library_pane.hidden=tileAuthoringMode!=='raw';
  if(tileAuthoringMode==='stamp'&&selectedStampElement)setActiveLayer(selectedStampElement.layer==='A'?'foreground':'background');
  else if((tileAuthoringMode==='terrain'||tileAuthoringMode==='stamp')&&activeLayer!=='background')setActiveLayer('background');
  updateToolHint();renderInspector();renderEditorOverlay();
}
function cellCanvas(mapId,plane,cx,cy){
  const dim=resources.mapDecoder.dimensions(mapId),pal=resources.palettes.forMap(mapId).rgba,render=resources.mapDecoder.renderPlane(mapId,pal,{plane,viewport:{x:0,y:0,width:dim.width,height:dim.height}}).pixels;
  const c=document.createElement('canvas');c.width=c.height=16;const data=new Uint8ClampedArray(16*16*4);
  for(let y=0;y<16;y++)for(let x=0;x<16;x++){const so=(((cy*16+y)*render.width)+(cx*16+x))*4,doff=(y*16+x)*4;data.set(render.data.subarray(so,so+4),doff)}c.getContext('2d').putImageData(new ImageData(data,16,16),0,0);return c;
}
function terrainPreviewCanvas(set){
  if(set.kind==='path'&&set.pathPrototypes?.length){
    const prototype=set.pathPrototypes.find(p=>p.junctionOutputs?.length)||set.pathPrototypes[0],c=document.createElement('canvas');c.width=48;c.height=48;const g=c.getContext('2d');g.imageSmoothingEnabled=false;
    const drawCell=(mapId,plane,cell,dx,dy)=>g.drawImage(cellCanvas(Number(mapId),plane,cell[0],cell[1]),dx*16,dy*16);
    drawCell(prototype.sourceMapId,'B',prototype.topCell,1,0);for(const o of prototype.junctionOutputs||[]){const [ox,oy]=o.targetOffset||[0,0];if(ox>=-1&&ox<=1&&oy>=0&&oy<=1)drawCell(o.sourceMapId,o.sourceLayer||o.layer||'B',o.sourceCell,1+ox,oy)}
    const mid=prototype.middleCells?.[0]||prototype.bottomCell;drawCell(prototype.sourceMapId,'B',mid,1,1);drawCell(prototype.sourceMapId,'B',prototype.bottomCell,1,2);return c;
  }
  if(set.kind==='edge'&&set.supportPrototypes?.length){
    const prototype=set.supportPrototypes[0],c=document.createElement('canvas');c.width=32;c.height=48;const g=c.getContext('2d');g.imageSmoothingEnabled=false;
    g.drawImage(cellCanvas(prototype.sourceMapId,'B',prototype.platformCell[0],prototype.platformCell[1]),8,0);g.drawImage(cellCanvas(prototype.sourceMapId,'A',prototype.platformCell[0],prototype.platformCell[1]),8,0);for(let i=0;i<2;i++){const cell=prototype.stemCells[i%prototype.stemCells.length];if(cell)g.drawImage(cellCanvas(prototype.sourceMapId,'A',cell[0],cell[1]),8,(i+1)*16)}return c;
  }
  const previewMask=set.kind==='edge'?10:set.kind==='path'?5:15,rule=set.rules.find(r=>r.mask===previewMask)||set.rules.find(r=>r.mask===15)||set.rules[0],variant=rule?.variants?.find(v=>v.outputs?.length>1)||rule?.variants?.[0];if(!variant)return null;
  const c=document.createElement('canvas');c.width=c.height=16;const g=c.getContext('2d');g.imageSmoothingEnabled=false;
  const outputs=variant.outputs?.length?variant.outputs:[{sourceMapId:variant.sourceMapId,sourceCell:variant.sourceCell,sourceLayer:variant.sourceLayer||set.sourceLayer||'B',layer:'B'}];
  for(const output of outputs){const [cx,cy]=output.sourceCell;g.drawImage(cellCanvas(Number(output.sourceMapId),output.sourceLayer||output.layer||'B',cx,cy),0,0)}
  return c;
}
function renderTerrainLibrary(){
  if(!resources?.autotileCatalog||!ui.terrain_catalog)return;const sets=currentTerrainSets(),q=librarySearch.trim().toLowerCase();
  if(!selectedTerrainSet||!sets.some(s=>s.id===selectedTerrainSet.id))selectedTerrainSet=sets[0]||null;
  const filtered=sets.filter(s=>!q||`${s.label} ${s.description} ${s.id} ${s.kind}`.toLowerCase().includes(q));
  ui.terrain_catalog.innerHTML=filtered.length?filtered.map(s=>{const compound=s.rules.some(r=>r.variants.some(v=>(v.outputs||[]).some(o=>o.layer==='A')&&(v.outputs||[]).some(o=>o.layer==='B'))),relations=(s.pathPrototypes?.some(p=>p.junctionOutputs?.length)||s.rules.some(r=>r.variants.some(v=>v.neighborContexts?.some(c=>Object.values(c).includes('climb-through'))))),supports=s.supportPrototypes?.length||0;return `<button type="button" class="terrain-card ${selectedTerrainSet?.id===s.id?'selected':''}" data-terrain-set="${escapeHtml(s.id)}"><span class="terrain-thumb" data-terrain-thumb="${escapeHtml(s.id)}"></span><span><strong>${escapeHtml(s.label)}</strong><span>${escapeHtml(s.kind)} · 16×16 · ${escapeHtml(s.collision||'visual')}${compound?' · B+A':''}${relations?' · junction-aware':''}${supports?` · ${supports} support styles`:''}</span><p>${escapeHtml(s.description||'RDX terrain rule set')}</p></span></button>`}).join(''):'<div class="empty-mini">No terrain sets match this room/search.</div>';
  ui.selected_terrain_label.textContent=selectedTerrainSet?`${selectedTerrainSet.label} · ${selectedTerrainSet.kind} · ${selectedTerrainSet.collision}`:'No terrain selected';
  ui.terrain_collision_mode.value=store?.document?.settings?.terrainCollisionMode||'catalog';if(ui.terrain_assist_ambiguity)ui.terrain_assist_ambiguity.checked=store?.document?.settings?.terrainAssistAmbiguity!==false;
  requestAnimationFrame(()=>{for(const host of ui.terrain_catalog.querySelectorAll('[data-terrain-thumb]')){const set=terrainSetById(resources.autotileCatalog,host.dataset.terrainThumb),c=set?terrainPreviewCanvas(set):null;if(c)host.replaceChildren(c);}});
}
function stampPreviewCanvas(stamp,{mirrorX=false}={}){
  const mapId=Number(stamp.sourceMapId),dim=resources.mapDecoder.dimensions(mapId),pal=resources.palettes.forMap(mapId).rgba,[cx,cy]=stamp.originCell,[w,h]=stamp.sizeCells,c=document.createElement('canvas');c.width=w*16;c.height=h*16;const g=c.getContext('2d');g.imageSmoothingEnabled=false;
  if(mirrorX){g.translate(c.width,0);g.scale(-1,1);}
  for(const plane of stamp.planes){const render=resources.mapDecoder.renderPlane(mapId,pal,{plane,viewport:{x:0,y:0,width:dim.width,height:dim.height}}).pixels,tmp=document.createElement('canvas');tmp.width=render.width;tmp.height=render.height;tmp.getContext('2d').putImageData(new ImageData(render.data,render.width,render.height),0,0);g.drawImage(tmp,cx*16,cy*16,w*16,h*16,0,0,w*16,h*16)}return c;
}
function familyPreviewStamp(family){return stampById(resources?.stampCatalog,family?.defaultVariantId)||variantsForFamily(resources?.stampCatalog,family)[0]||null;}
function stampElementOutputs(element){return Array.isArray(element?.outputs)&&element.outputs.length?element.outputs:[element].filter(Boolean);}
function stampElementLayersLabel(element){return stampElementOutputs(element).map(output=>`${output.sourceLayer}→${output.layer}`).join(' + ');}
function stampElementSourcesLabel(element){return stampElementOutputs(element).map(output=>`${md(output.sourceMapId)} · ${output.sourceLayer} g8 ${output.sourceCell.join(',')} → ${output.layer}`).join(' + ');}
function stampElementPreviewCanvas(element){
  const c=document.createElement('canvas');c.width=c.height=8;const g=c.getContext('2d');g.imageSmoothingEnabled=false;
  const outputs=stampElementOutputs(element).slice().sort((a,b)=>String(a.layer).localeCompare(String(b.layer))*-1);
  for(const output of outputs){const mapId=Number(output.sourceMapId),dim=resources.mapDecoder.dimensions(mapId),pal=resources.palettes.forMap(mapId).rgba,render=resources.mapDecoder.renderPlane(mapId,pal,{plane:output.sourceLayer,viewport:{x:0,y:0,width:dim.width,height:dim.height}}).pixels;g.drawImage(tileVariantCanvas(render,Number(output.sourceCell[0]),Number(output.sourceCell[1])),0,0)}
  return c;
}
function renderStampLibrary(){
  if(!resources?.stampCatalog||!ui.stamp_catalog)return;
  const families=currentStampFamilies(),elements=currentStampElements(),q=librarySearch.trim().toLowerCase(),categories=['All',...new Set([...families.map(f=>f.category||'decor'),...elements.map(element=>element.category||'tile')])];
  if(!categories.includes(stampCategory))stampCategory='All';
  if(ui.stamp_categories)ui.stamp_categories.innerHTML=categories.map(c=>`<button type="button" class="${c===stampCategory?'active':''}" data-stamp-category="${escapeHtml(c)}">${escapeHtml(c.replaceAll('-',' '))}</button>`).join('');
  if(selectedStampElement&&!elements.some(element=>element.id===selectedStampElement.id))selectedStampElement=null;
  if(!selectedStampElement&&(!selectedStamp||!families.some(f=>f.id===selectedStamp.id)))selectedStamp=families[0]||null;
  const familyRows=families.filter(f=>(stampCategory==='All'||(f.category||'decor')===stampCategory)&&(!q||`${f.label} ${f.description} ${f.category} ${f.id}`.toLowerCase().includes(q)));
  const elementRows=elements.filter(element=>(stampCategory==='All'||(element.category||'tile')===stampCategory)&&(!q||`${element.label} ${element.description} ${element.category} ${element.id} ${stampElementSourcesLabel(element)}`.toLowerCase().includes(q)));
  const elementHtml=elementRows.map(element=>`<button type="button" class="stamp-card ${selectedStampElement?.id===element.id?'selected':''}" data-stamp-element="${escapeHtml(element.id)}"><span class="stamp-thumb" data-stamp-element-thumb="${escapeHtml(element.id)}"></span><span><strong>${escapeHtml(element.label)}</strong><span>exact element · 8×8 · ${escapeHtml(stampElementLayersLabel(element))} · ${element.repeatCount} production occurrence${element.repeatCount===1?'':'s'}</span><p>${escapeHtml(element.description||'Exact production presentation tile.')}</p></span></button>`).join('');
  const familyHtml=familyRows.map(f=>{const variants=variantsForFamily(resources.stampCatalog,f),min=variants.slice().sort((a,b)=>a.sizeCells[0]*a.sizeCells[1]-b.sizeCells[0]*b.sizeCells[1])[0],max=variants.slice().sort((a,b)=>b.sizeCells[0]*b.sizeCells[1]-a.sizeCells[0]*a.sizeCells[1])[0],policy=f.variantPolicy==='weighted-common'?'frequency-weighted variation':`${min?.sizeCells?.join('×')||'?'} → ${max?.sizeCells?.join('×')||'?'}`;return `<button type="button" class="stamp-card ${!selectedStampElement&&selectedStamp?.id===f.id?'selected':''}" data-stamp-family="${escapeHtml(f.id)}"><span class="stamp-thumb" data-stamp-family-thumb="${escapeHtml(f.id)}"></span><span><strong>${escapeHtml(f.label)}</strong><span>${variants.length} production variant${variants.length===1?'':'s'} · ${policy}</span><p>${escapeHtml(f.description||'Smart production motif family. Click for the smallest fitting fragment; drag to expand.')}</p></span></button>`}).join('');
  ui.stamp_catalog.innerHTML=(elementHtml||familyHtml)?elementHtml+familyHtml:'<div class="empty-mini">No stamp families or exact 8×8 elements match this room/search.</div>';
  if(selectedStampElement)ui.selected_stamp_label.textContent=`${selectedStampElement.label} · exact 8×8 ${stampElementLayersLabel(selectedStampElement)} · ${stampElementSourcesLabel(selectedStampElement)}`;
  else if(selectedStamp){const variants=variantsForFamily(resources.stampCatalog,selectedStamp),min=variants.slice().sort((a,b)=>a.sizeCells[0]*a.sizeCells[1]-b.sizeCells[0]*b.sizeCells[1])[0],max=variants.slice().sort((a,b)=>b.sizeCells[0]*b.sizeCells[1]-a.sizeCells[0]*a.sizeCells[1])[0];ui.selected_stamp_label.textContent=selectedStamp.variantPolicy==='weighted-common'?`${selectedStamp.label} · ${variants.length} variants · stable frequency-weighted brush`:`${selectedStamp.label} · ${variants.length} variants · progressive ${min?.sizeCells?.join('×')||'?'} → ${max?.sizeCells?.join('×')||'?'}`;}else ui.selected_stamp_label.textContent='No stamp family or element selected';
  requestAnimationFrame(()=>{
    for(const host of ui.stamp_catalog.querySelectorAll('[data-stamp-element-thumb]')){const element=stampElementById(resources.stampCatalog,host.dataset.stampElementThumb),c=element?stampElementPreviewCanvas(element):null;if(c)host.replaceChildren(c);}
    for(const host of ui.stamp_catalog.querySelectorAll('[data-stamp-family-thumb]')){const family=stampFamilyById(resources.stampCatalog,host.dataset.stampFamilyThumb),stamp=family?familyPreviewStamp(family):null,c=stamp?stampPreviewCanvas(stamp):null;if(c)host.replaceChildren(c);}
  });
}
function setTilePaletteMapOptions(){const seen=new Map();for(const r of resources.manifest.rooms)seen.set(Number(r.mapId),r);ui.tile_source_map.replaceChildren(...[...seen].sort((a,b)=>a[0]-b[0]).map(([id,r])=>{const o=document.createElement('option');o.value=String(id);o.textContent=`${md(id)} · ${String(r.group||'').replaceAll('_',' ')}`;return o}));ui.tile_source_map.value=String(store.document.base.mapId);renderTilePalette();}
function tileHash(pixels,width,gx,gy,rotation=0){
  let h=2166136261>>>0;for(let y=0;y<8;y++)for(let x=0;x<8;x++){let sx=x,sy=y;if(rotation===90){sx=y;sy=7-x}else if(rotation===180){sx=7-x;sy=7-y}else if(rotation===270){sx=7-y;sy=x}const o=(((gy*8+sy)*width)+(gx*8+sx))*4;for(let k=0;k<4;k++){h^=pixels[o+k]||0;h=Math.imul(h,16777619)>>>0}}return h>>>0;
}
function tileIndexFor(render,mapId,plane){
  const key=`${mapId}:${plane}`;let cached=tileVariantIndexCache.get(key);if(cached&&cached.width===render.width&&cached.height===render.height)return cached;const byHash=new Map(),gw=Math.floor(render.width/8),gh=Math.floor(render.height/8);for(let gy=0;gy<gh;gy++)for(let gx=0;gx<gw;gx++){const h=tileHash(render.data,render.width,gx,gy,0),arr=byHash.get(h)||[];arr.push([gx,gy]);byHash.set(h,arr)}cached={width:render.width,height:render.height,byHash};tileVariantIndexCache.set(key,cached);return cached;
}
function tileVariantCanvas(render,gx,gy){const c=document.createElement('canvas');c.width=c.height=8;const data=new Uint8ClampedArray(8*8*4);for(let y=0;y<8;y++)for(let x=0;x<8;x++){const so=(((gy*8+y)*render.width)+(gx*8+x))*4,doff=(y*8+x)*4;data.set(render.data.subarray(so,so+4),doff)}c.getContext('2d').putImageData(new ImageData(data,8,8),0,0);return c;}
function renderTileRotationVariants(render,mapId,plane){
  const host=ui.tile_rotation_variants;if(!host||!selectedTile||selectedTile.sourceMapId!==mapId||selectedTile.sourceLayer!==plane){if(host)host.hidden=true;return}const index=tileIndexFor(render,mapId,plane),variants=[];for(const rotation of [0,90,180,270]){const hash=tileHash(render.data,render.width,selectedTile.x,selectedTile.y,rotation),matches=index.byHash.get(hash)||[];if(!matches.length)continue;const [x,y]=matches[0];if(!variants.some(v=>v.x===x&&v.y===y))variants.push({rotation,x,y,count:matches.length})}host.hidden=false;host.innerHTML=`<span>Rotation family · engine stores orientation as map variants, so the editor groups detected equivalents instead of inventing a browser-only rotation.</span><div class="tile-variant-row">${variants.map(v=>`<button type="button" class="tile-variant ${v.x===selectedTile.x&&v.y===selectedTile.y?'active':''}" data-tile-variant-x="${v.x}" data-tile-variant-y="${v.y}" data-tile-variant-rotation="${v.rotation}"><span>${v.rotation}°${v.count>1?` · ${v.count} matches`:''}</span></button>`).join('')}</div>`;requestAnimationFrame(()=>{for(const b of host.querySelectorAll('[data-tile-variant-x]')){const x=Number(b.dataset.tileVariantX),y=Number(b.dataset.tileVariantY);b.prepend(tileVariantCanvas(render,x,y))}});
}
function renderTilePalette(){
  if(!resources)return;
  const mapId=Number(ui.tile_source_map.value||store?.document.base.mapId||3),mode=rawSourceMode(),cellMode=rawCellMode(mode),pack=rawCellInfo(mapId),dim=pack.dim;
  const render=cellMode?(mode==='SAFE_A'?pack.A:mode==='SAFE_B'?pack.B:pack.composite):resources.mapDecoder.renderPlane(mapId,resources.palettes.forMap(mapId).rgba,{plane:mode,viewport:{x:0,y:0,width:dim.width,height:dim.height}}).pixels;
  ui.tile_palette.width=dim.width;ui.tile_palette.height=dim.height;ctx.palette.putImageData(new ImageData(render.data,render.width,render.height),0,0);ui.tile_palette.style.width=`${Math.max(240,dim.width)}px`;
  if(cellMode){
    ctx.palette.save();
    for(let cy=0;cy<dim.cellHeight;cy++)for(let cx=0;cx<dim.cellWidth;cx++){
      const info=pack.cells.get(`${cx},${cy}`);if(rawCellAllowed(info,mode))continue;
      ctx.palette.fillStyle='rgba(2,5,8,.72)';ctx.palette.fillRect(cx*16,cy*16,16,16);
    }
    ctx.palette.strokeStyle='rgba(122,145,166,.18)';ctx.palette.lineWidth=1;
    for(let x=0;x<=dim.width;x+=16){ctx.palette.beginPath();ctx.palette.moveTo(x+.5,0);ctx.palette.lineTo(x+.5,dim.height);ctx.palette.stroke();}
    for(let y=0;y<=dim.height;y+=16){ctx.palette.beginPath();ctx.palette.moveTo(0,y+.5);ctx.palette.lineTo(dim.width,y+.5);ctx.palette.stroke();}
    ctx.palette.restore();
  }
  let selected=false,left=0,top=0,size=10;
  if(selectedTile?.sourceMapId===mapId){
    if(cellMode&&selectedTile.kind==='cell16'){selected=true;left=selectedTile.cell[0]*16-1;top=selectedTile.cell[1]*16-1;size=18;}
    else if(!cellMode&&selectedTile.kind!=='cell16'&&selectedTile.sourceLayer===mode){selected=true;left=selectedTile.x*8-1;top=selectedTile.y*8-1;size=10;}
  }
  ui.tile_palette_selection.style.display=selected?'block':'none';ui.tile_palette_selection.style.left=`${left}px`;ui.tile_palette_selection.style.top=`${top}px`;ui.tile_palette_selection.style.width=`${size}px`;ui.tile_palette_selection.style.height=`${size}px`;
  if(cellMode){ui.tile_rotation_variants.hidden=true;ui.tile_rotation_variants.innerHTML='';}else renderTileRotationVariants(render,mapId,mode);
}

function migrateConvertedSourceProvenance(document){
  const d=normalizeLevelDocument(document);
  if(!d.base.blank){
    const baseRoom=roomForSubmap(d.base.submap);
    if(baseRoom&&Number(baseRoom.mapId)===Number(d.base.mapId)){
      const raw=hostDimensions(baseRoom),effective=productionDimensions(baseRoom);
      // Older production drafts were stored at the raw decoder bounds. Promote only
      // that exact legacy shape so authored blank/custom document sizes stay intact.
      if(Number(d.bounds.width)===Number(raw.width)&&Number(d.bounds.height)===Number(raw.height)&&(effective.width!==raw.width||effective.height!==raw.height))
        d.bounds={...d.bounds,width:effective.width,height:effective.height};
    }
  }
  return recoverConvertedSourceProvenanceFromResolved(d,resolvedRoomFor(d.base.submap,d.base.mapId));
}

function classicEntityThumbCanvas(spriteId){
  const classic=resources?.classic,source=classic?.sprites?.[Number(spriteId)];if(!source)return null;
  const width=Number(classic.spriteWidth||32),height=Number(classic.spriteHeight||21),rgba=new Uint8ClampedArray(width*height*4);
  for(let i=0;i<width*height;i++){const colorIndex=Number(source[i]||0);if(!colorIndex)continue;const color=classic.palette?.[colorIndex];if(!color)continue;rgba.set(color,i*4);}
  const c=document.createElement('canvas');c.width=width;c.height=height;c.getContext('2d').putImageData(new ImageData(rgba,width,height),0,0);return c;
}
function entityLibraryThumbCanvas(e){
  if(Number(e?.pn)>=0){const f=resources.spriteDecoder.frameForPn(Number(e.pn),0,currentPalette());if(f){const c=document.createElement('canvas');c.width=f.pixels.width;c.height=f.pixels.height;c.getContext('2d').putImageData(new ImageData(f.pixels.data,f.pixels.width,f.pixels.height),0,0);return c;}}
  return classicEntityThumbCanvas(e?.sampleSprite);
}
function renderEntityLibrary(){
  const entities=resources.entityCatalog.entities,cats=['All',...new Set(entities.map(e=>e.category))];ui.entity_categories.innerHTML=cats.map(c=>`<button type="button" class="${c===entityCategory?'active':''}" data-entity-category="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('');
  const q=librarySearch.toLowerCase();
  const filtered=entities.filter(e=>{
    if(entityCategory!=='All'&&e.category!==entityCategory)return false;
    if(!q)return true;
    const searchText=`${e.name} ${e.description} ${e.hex} ${e.category} ${e.pn>=0?`pn${e.pn} pn ${e.pn}`:''} ${(e.pnOptions||[]).map(pn=>`pn${pn} pn ${pn}`).join(' ')}`.toLowerCase();
    return searchText.includes(q);
  });
  ui.entity_catalog.innerHTML=filtered.map(e=>`<div class="asset-card ${selectedEntityType?.entity===e.entity?'selected':''} ${entityPlacementArmed&&selectedEntityType?.entity===e.entity?'placing':''}" draggable="true" data-entity-type="${e.entity}" title="${escapeHtml(e.description)} · Drag onto the map to place"><div class="entity-thumb" data-thumb="${e.entity}"><span>${e.category==='enemy'?'☠':e.category==='trap'?'▲':e.category==='platform'?'▰':e.category==='projectile'?'➶':e.category==='pickup'?'◆':'◇'}</span></div><div><strong>${escapeHtml(e.name)}</strong><span>${e.hex} · ${escapeHtml(e.category)}${e.pn>=0?` · PN ${e.pn}`:''}</span></div></div>`).join('');
  requestAnimationFrame(()=>{for(const host of ui.entity_catalog.querySelectorAll('[data-thumb]')){const e=entities.find(x=>x.entity===Number(host.dataset.thumb));if(!e)continue;const c=entityLibraryThumbCanvas(e);if(c)host.replaceChildren(c);}});
}

function openDocument(doc,{resetSaved=false}={}){
  stopPlaytest();stopNativeSimulation({keepHistory:false,restart:false});systemModificationsEnabled=true;resources?.preview?.setSystemModificationsEnabled(true);rendererAuthorityKey='';store=new LevelDocumentStore(migrateConvertedSourceProvenance(doc),{historyLimit:150});room=roomForSubmap(store.document.base.submap);if(!room)throw new Error(`No native host ${sm(store.document.base.submap)}`);
  store.subscribe((_d,reason)=>{selection=selection.filter(s=>['source','source-activator','scenery','hero','layer','collision','gameplay-collision','cell','region','presentation-depth','presentation-depth-class'].includes(s.kind)||store.document.entities.some(e=>e.id===s.id)||store.document.tiles.some(t=>t.id===s.id)||store.document.terrain.some(t=>t.id===s.id)||store.document.terrainRelations?.some(r=>r.id===s.id)||store.document.stamps?.some(t=>t.id===s.id));try{localStorage.setItem(AUTOSAVE_KEY,exportLevelJson(store.document))}catch{}scheduleRender();renderValidation();renderDebugNoteDock();updateDraftAuthorityStatus();if(reason!=='undo'&&reason!=='redo')ui.save_state.textContent='Autosaved draft';});
  ui.level_name.value=store.document.name;ui.simulate_toggle.checked=!!store.document.settings.simulatePreview;ui.playtest_sound.checked=store.document.settings.soundPlaytest!==false;ui.playtest_invulnerable.checked=store.document.settings.invulnerablePlaytest!==false;ui.playtest_resources.checked=store.document.settings.infiniteResources!==false;ui.playtest_scale.value=String([1,2,4].includes(Number(store.document.settings.renderScale))?Number(store.document.settings.renderScale):2);applyPlaytestScale();
  activeLayer='background';entityPlacementArmed=false;hoverCell=null;timelineScrub=null;tick=0;simulationClock.reset(0);simulationClock.setPaused(true);setSelection([]);setTilePaletteMapOptions();renderTerrainLibrary();renderStampLibrary();setTileAuthoringMode(tileAuthoringMode);renderEntityLibrary();savedHash=resetSaved?hashDoc(store.document):'';configureRenderer();sizeStage();frameAll();scheduleRender();renderLevelSettings();renderValidation();if(store.document.settings.simulatePreview)queueMicrotask(()=>startNativeSimulation());
}

function setSystemModificationsEnabled(enabled,{notify=false}={}){
  const next=enabled!==false;
  if(next===systemModificationsEnabled){
    if(ui.system_modifications_toggle)ui.system_modifications_toggle.checked=next;
    return;
  }
  if(!next){stopPlaytest();stopNativeSimulation({keepHistory:true,restart:false});}
  systemModificationsEnabled=next;
  rendererAuthorityKey='';
  resources?.preview?.setSystemModificationsEnabled(next);
  if(ui.system_modifications_toggle)ui.system_modifications_toggle.checked=next;
  if(ui.authority_label){
    ui.authority_label.textContent=next?'View = effective A–F layers + draft':'View = raw decoded RDX + draft';
    ui.authority_label.title=next?'Resolved alignment, structure, semantics, placement and bounds are applied.':'Effective layers are withheld so the viewport exposes the decoded RDX baseline.';
  }
  scheduleRender();
  if(diagnostics.active)renderDiagnosticsWorkspace();
  if(notify)toast(next?'System corrections applied on top of the RDX baseline.':'System corrections withheld. Viewport now shows the raw decoded RDX baseline.',next?'ok':'warn',4200);
}

function fullMapRegion(mode){const b=docBounds();return {kind:'region',id:`region:${mode}:0:0:${b.width}:${b.height}`,x:0,y:0,width:b.width,height:b.height,mode};}
function resetRegionsFromSelection(items=selection){const out=[];for(const s of items){if(s.kind==='region')out.push(s);else if(s.kind==='layer'&&s.id==='background')out.push(fullMapRegion('background'));else if(s.kind==='layer'&&s.id==='foreground')out.push(fullMapRegion('foreground'));}return dedupeRawRdxRegions(out,docBounds());}
function containedByAny(bounds,regions){return !!bounds&&regions.some(region=>rectContainsRect(region,bounds));}
function pointInAny(point,regions){return regions.some(region=>rectContainsPoint(region,point));}
function allResetRegions(regions){return regions.filter(region=>region.mode==='all');}
function terrainRelationBounds(row){if(row?.type!=='support')return null;const x=Number(row.anchor?.[0]||0)*16,y=Number(row.anchor?.[1]||0)*16,h=Math.max(16,(Number(row.end?.[1]||row.anchor?.[1]||0)-Number(row.anchor?.[1]||0)+1)*16);return{x,y,width:16,height:h};}
function resetSelectedDraft(document,items,regions,baseRoom){
  const allRegions=allResetRegions(regions),direct=new Map();for(const s of items)direct.set(`${s.kind}:${s.id}`,s);
  const directStampIds=new Set(items.filter(s=>s.kind==='stamp').map(s=>s.id));
  for(const p of document.stamps||[])if(containedByAny(stampBounds(p),allRegions))directStampIds.add(p.id);
  if(directStampIds.size){const temp=new LevelDocumentStore(document);for(const id of directStampIds)temp.removeStamp(id);document.stamps=temp.document.stamps;document.terrain=temp.document.terrain;}
  document.tiles=(document.tiles||[]).filter(t=>{
    if(direct.has(`tile:${t.id}`)||direct.has(`cell:${t.layer}:${t.target?.[0]}:${t.target?.[1]}`))return false;
    const b={x:Number(t.target?.[0]||0)*8,y:Number(t.target?.[1]||0)*8,width:8,height:8};return !regions.some(region=>regionAffectsPlane(region,t.layer)&&rectContainsRect(region,b));
  });
  document.terrain=(document.terrain||[]).filter(t=>!direct.has(`terrain:${t.id}`)&&!containedByAny({x:Number(t.cell?.[0]||0)*16,y:Number(t.cell?.[1]||0)*16,width:16,height:16},allRegions));
  document.terrainRelations=(document.terrainRelations||[]).filter(r=>!direct.has(`terrain-relation:${r.id}`)&&!containedByAny(terrainRelationBounds(r),allRegions));
  document.collision=(document.collision||[]).filter(c=>{const id=`logic:${c.logic?.[0]}:${c.logic?.[1]}`;return !direct.has(`collision:${id}`)&&!containedByAny({x:(Number(c.logic?.[0]||1)-1)*16,y:(Number(c.logic?.[1]||1)-1)*16,width:16,height:16},allRegions);});
  document.gameplayCollision=(document.gameplayCollision||[]).filter(c=>{const id=`g8:${c.g8?.[0]}:${c.g8?.[1]}`;return !direct.has(`gameplay-collision:${id}`)&&!containedByAny({x:Number(c.g8?.[0]||0)*8,y:Number(c.g8?.[1]||0)*8,width:8,height:8},allRegions);});
  const entityBounds=new Map(customHitboxes.map(row=>[String(row.id),row.bounds]));document.entities=(document.entities||[]).filter(e=>!direct.has(`entity:${e.id}`)&&!containedByAny(entityBounds.get(String(e.id))||{x:Number(e.x||0),y:Number(e.y||0),width:24,height:21},allRegions));
  const sourceBounds=new Map(diagnosticSourceSelectables().map(row=>[String(row.sourceKey),row.bounds]));document.sourceEntityOverrides=(document.sourceEntityOverrides||[]).filter(o=>{const id=`mark:${Number(o.mark)}`;return !direct.has(`source:${id}`)&&!containedByAny(sourceBounds.get(id),allRegions);});
  document.systemPatchRemovals=(document.systemPatchRemovals||[]).filter(removal=>{const patch=reviewedVisualPatchById(removal.patchId),b=patch?.bounds||removal.bounds;if(!Array.isArray(b)||b.length<4)return true;const bounds={x:Number(b[0]),y:Number(b[1]),width:Number(b[2]),height:Number(b[3])},layer=String(patch?.layer||removal.layer||'A').toUpperCase();return !regions.some(region=>{const affects=layer==='AB'?(regionAffectsPlane(region,'A')||regionAffectsPlane(region,'B')):regionAffectsPlane(region,layer);return affects&&rectContainsRect(region,bounds);});});
  const resetHero=items.some(s=>s.kind==='hero')||pointInAny(document.heroStart,allRegions);if(resetHero)document.heroStart=deepClone(productionDocument(baseRoom).heroStart);
}
function resetSelectionOrMap(){
  if(!store||!resources)return;const baseRoom=roomForSubmap(store.document.base.submap);if(!baseRoom){toast(`No RDX room exists for ${sm(store.document.base.submap)}.`,'error');return;}stopPlaytest();
  if(!selection.length){const editorSettings=deepClone(store.document.settings),baseline=productionDocument(baseRoom);editorSettings.rawRdxRegions=[];baseline.settings={...baseline.settings,...editorSettings,rawRdxRegions:[]};store.replace(baseline,'reset-to-production');room=baseRoom;ui.level_name.value=store.document.name;selection=[];rendererAuthorityKey='';setSystemModificationsEnabled(true);refreshNativeDraftRuntime();renderLevelSettings();renderValidation();scheduleRender();toast('Whole map draft cleared. Scene and native Playtest are back on the canonical production placement.','warn',5200);return;}
  const regions=resetRegionsFromSelection(),beforeCount=rawRdxRegions().length,sourcePlacementReset=selection.some(item=>item.kind==='source');store.transact('reset-selection-to-decoded-rdx',d=>{resetSelectedDraft(d,selection,regions,baseRoom);if(regions.length)d.settings.rawRdxRegions=dedupeRawRdxRegions([...(d.settings.rawRdxRegions||[]),...regions],d.bounds);});rendererAuthorityKey='';if(sourcePlacementReset)refreshNativeDraftRuntime();renderValidation();scheduleRender();const regionCount=rawRdxRegions().length-beforeCount;toast(regions.length?`Reset ${regions.length} selected region${regions.length===1?'':'s'} to decoded RDX${regionCount>0?' and withheld effective layers inside it':''}. Outside content is unchanged.`:'Reset selected authored item(s) to their decoded RDX/base state.','warn',5200);
}

function scorpionDefaultStart(r){return productionHeroStart({room:r,bridge,resolvedRoom:resolvedRoomFor(r.submap,r.mapId)});}
function productionDocument(r){const dim=productionDimensions(r),hero=scorpionDefaultStart(r);return createLevelDocument({name:`${sm(r.submap)} · ${String(r.group||'room').replaceAll('_',' ')}`,submap:r.submap,mapId:r.mapId,width:dim.width,height:dim.height,blank:false,heroStart:hero});}
function createBlankDocument(r,name,width,height){const dim=resources.mapDecoder.dimensions(r.mapId);return createLevelDocument({name,submap:r.submap,mapId:r.mapId,width:clamp(Math.floor(width/16)*16,16,dim.width),height:clamp(Math.floor(height/16)*16,16,dim.height),blank:true,heroStart:scorpionDefaultStart(r)});}

function renderSelectToolButton(){const b=ui.tool_buttons.querySelector('[data-tool="select"]'),view=SELECT_REGION_PRESENTATION[selectMode]||SELECT_REGION_PRESENTATION.object;if(!b)return;b.dataset.selectMode=selectMode;b.querySelector('span').textContent=view.icon;b.querySelector('small').textContent=view.label;b.setAttribute('aria-label',view.label);b.title=selectMode==='object'?'Select objects · click again to Select BG · V returns here':`${view.label} · drag an 8px-aligned rectangle · click again to cycle`;}
function renderSmartScissorsToolButton(){const b=ui.tool_buttons.querySelector('[data-tool="scissors"]');if(!b)return;const view=smartScissorsMode==='move'?{icon:'✂↔',label:'Cut+Move',title:'Cut + Move · drag source, then drag the selected rectangle · click again for Cut + Paste'}:smartScissorsMode==='paste'?{icon:'✂⧉',label:'Cut+Paste',title:'Cut + Paste · drag source, then drag the selected rectangle · source stays unchanged · click again for Smart Scissors'}:{icon:'✂',label:'Scissors',title:'Smart Scissors · drag repair area · click again for Cut + Move'};b.dataset.scissorsMode=smartScissorsMode;b.querySelector('span').textContent=view.icon;b.querySelector('small').textContent=view.label;b.title=view.title;b.setAttribute('aria-label',view.title);}
function setSelectMode(mode){selectMode=SELECT_REGION_PRESENTATION[mode]?mode:'object';renderSelectToolButton();ui.scene_stage.dataset.selectMode=selectMode;updateToolHint();renderEditorOverlay();renderInspector();}
function cycleSelectToolMode(){setSelectMode(cycleSelectRegionMode(selectMode));}
function updateToolHint(){let diagnosticHint=diagnostics.view==='shift'?'Diagnostics · Classic ↔ RDX shift · click an 8×8 cell to inspect correspondence · Space-drag to pan':'Diagnostics · click a debug element; enable Geometry to inspect 8×8 collision provenance · Space-drag to pan';let hint=diagnostics.active?diagnosticHint:(TOOL_HINTS[tool]||tool);if(tool==='select'&&selectMode!=='object')hint=`${SELECT_REGION_PRESENTATION[selectMode].label} · drag a rectangle to select ${selectMode==='background'?'Plane B background':selectMode==='foreground'?'Plane A foreground':'all visual, actor and collision'} content · Reset affects only that region`;if(tool==='scissors'){if(smartScissorsMode==='move')hint=smartScissorsTransferSelection?`Cut + Move · ${smartScissorsGridLabel(smartScissorsTransferSelection)} selected · drag inside it to the destination; vacated cells are inferred from the post-move neighborhood`:'Cut + Move · drag an 8×8-aligned rectangle to cut; then drag the selection to its destination';else if(smartScissorsMode==='paste')hint=smartScissorsTransferSelection?`Cut + Paste · ${smartScissorsPlaneLabel(smartScissorsTransferSelection.planes)} · ${smartScissorsGridLabel(smartScissorsTransferSelection)} selected · drag inside it to the destination; source and the other raw plane stay unchanged`:'Cut + Paste · drag an 8×8-aligned source rectangle; Solo Foreground copies only Plane A and Solo Backdrop/Midground only Plane B';else{const seed=selectedTile?.kind==='raw8'?` · selected raw ${String(selectedTile.sourceLayer||selectedLayerPlane()).toUpperCase()} tile will anchor the drag-start cell`:'';hint=`Smart Scissors · drag the full repair area; each candidate previews the target after application${seed} · click Scissors again for Cut + Move`;}}if(terrainPaintMode()&&['brush','rectangle','fill','eyedropper','erase'].includes(tool))hint=`${tool[0].toUpperCase()+tool.slice(1)} · semantic 16×16 terrain · neighbors resolve automatically · manual 8×8 edits remain authoritative${tool==='fill'?' · drag a frame to fill its entire rectangle':''}`;if(stampElementPaintMode()&&['brush','rectangle','fill','eyedropper','erase'].includes(tool))hint=`${tool[0].toUpperCase()+tool.slice(1)} · exact 8×8 ${selectedStampElement?.label||'presentation element'} · ${selectedStampElement?stampElementLayersLabel(selectedStampElement):'?'} · presentation only`;if(stampPaintMode()&&['brush','rectangle','fill','eyedropper','erase'].includes(tool))hint=selectedStamp?.variantPolicy==='weighted-common'?`${tool[0].toUpperCase()+tool.slice(1)} · production 1×1 stamp family · common authored variants are selected stably per map cell`:`${tool[0].toUpperCase()+tool.slice(1)} · production multi-cell stamp · sampled terrain footprint adapts and re-autotiles underneath`;if(tool==='entity'&&entityPlacementArmed&&selectedEntityType)hint=`Entity · placing ${selectedEntityType.name} · click empty map or drag from Library · click an actor to edit`;ui.tool_hint.textContent=hint;ui.scene_stage.dataset.entityPlacement=tool==='entity'&&entityPlacementArmed?'true':'false';ui.scene_stage.dataset.selectMode=selectMode;}
function cycleSmartScissorsMode(){smartScissorsMode=smartScissorsMode==='repair'?'move':smartScissorsMode==='move'?'paste':'repair';smartScissorsTransferSelection=null;smartScissorsSession=null;renderSmartScissorsToolButton();updateToolHint();renderEditorOverlay();const message=smartScissorsMode==='move'?'Cut + Move · drag the source rectangle, then drag it to the destination.':smartScissorsMode==='paste'?'Cut + Paste · drag the source rectangle, then drag it to the destination; source tiles remain unchanged.':'Smart Scissors · drag a repair rectangle to rank post-edit scenery previews.';toast(message,'ok',3000);}
function setTool(next,{editSelection=false}={}){if(diagnostics.active)switchLeftTab('scene');const prior=primarySelection(),previousTool=tool;if(next==='scissors'&&previousTool!=='scissors'){smartScissorsMode='repair';smartScissorsTransferSelection=null;}else if(next!=='scissors')smartScissorsTransferSelection=null;tool=next;ui.scene_stage.dataset.tool=tool;document.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===tool));renderSelectToolButton();renderSmartScissorsToolButton();if(tool==='collision'){entityPlacementArmed=false;if(prior?.kind==='cell'){collisionAuthoring='gameplay';setSelection([gameplayCollisionSelectionItem(prior.gx,prior.gy)])}else if(prior?.kind==='gameplay-collision'){collisionAuthoring='gameplay'}else if(prior?.kind==='collision'){collisionAuthoring='descriptor'}else if(!selection.every(s=>s.kind==='collision'||s.kind==='gameplay-collision'))setSelection([]);}else if(tool==='brush'||tool==='rectangle'||tool==='scissors'){entityPlacementArmed=false;setSelection([]);}else if(tool==='entity'&&editSelection&&prior?.kind==='source'){entityPlacementArmed=false;const id=convertSource(Number(prior.id.split(':')[1]),{silent:true});if(id){setSelection([{kind:'entity',id}]);switchInspector('inspector');toast('Production entity converted to an editable draft instance. Undo restores the source actor.');}}else if(tool!=='entity')entityPlacementArmed=false;updateToolHint();renderEntityLibrary();renderEditorOverlay();renderInspector();}
function setActiveLayer(key){activeLayer=key;if(['background','foreground'].includes(key))document.querySelectorAll('[data-quick-layer]').forEach(b=>b.classList.toggle('target',b.dataset.quickLayer===key));}
function stageClientInside(event){const r=ui.scene_stage.getBoundingClientRect();return event.clientX>=r.left&&event.clientX<r.right&&event.clientY>=r.top&&event.clientY<r.bottom;}
function stagePoint(event){const r=ui.scene_stage.getBoundingClientRect();return{x:clamp((event.clientX-r.left)/zoom,0,docBounds().width-1),y:clamp((event.clientY-r.top)/zoom,0,docBounds().height-1)};}
function snapPoint(p,grid=store.document.settings.gridSize||8){if(!store.document.settings.snap)return{x:Math.round(p.x),y:Math.round(p.y)};return{x:Math.round(p.x/grid)*grid,y:Math.round(p.y/grid)*grid};}
function stampBounds(placement){const stamp=stampById(resources?.stampCatalog,placement?.stampId);if(!stamp)return null;return{x:Number(placement.cell[0])*16,y:Number(placement.cell[1])*16,width:Number(stamp.sizeCells[0])*16,height:Number(stamp.sizeCells[1])*16,stamp};}
function stampResizeHandlesForBounds(b){return[{name:'nw',x:b.x,y:b.y,fixed:[(b.x+b.width)/16,(b.y+b.height)/16]},{name:'ne',x:b.x+b.width,y:b.y,fixed:[b.x/16,(b.y+b.height)/16]},{name:'sw',x:b.x,y:b.y+b.height,fixed:[(b.x+b.width)/16,b.y/16]},{name:'se',x:b.x+b.width,y:b.y+b.height,fixed:[b.x/16,b.y/16]}];}
function stampResizeHandleAt(p){const s=primarySelection();if(s?.kind!=='stamp')return null;const placement=store.document.stamps?.find(v=>v.id===s.id),b=placement?stampBounds(placement):null;if(!b)return null;for(const h of stampResizeHandlesForBounds(b))if(Math.abs(p.x-h.x)<=6&&Math.abs(p.y-h.y)<=6)return{...h,placementId:placement.id,mirrorX:!!placement.mirrorX};return null;}
function hitAt(p){
  const hero=store.document.heroStart;if(tool==='hero'&&Math.abs(p.x-hero.x)<=9&&p.y>=hero.y-22&&p.y<=hero.y+4)return{kind:'hero',id:'hero'};
  for(let i=customHitboxes.length-1;i>=0;i--){const h=customHitboxes[i],b=h.bounds;if(p.x>=b.x&&p.y>=b.y&&p.x<=b.x+b.width&&p.y<=b.y+b.height)return{kind:'entity',id:h.id};}
  for(let i=(store.document.stamps?.length||0)-1;i>=0;i--){const placement=store.document.stamps[i],b=stampBounds(placement);if(b&&p.x>=b.x&&p.y>=b.y&&p.x<=b.x+b.width&&p.y<=b.y+b.height)return{kind:'stamp',id:placement.id};}
  for(let i=(store.document.terrainRelations?.length||0)-1;i>=0;i--){const r=store.document.terrainRelations[i];if(r.type!=='support')continue;const x=r.anchor[0]*16+8,y0=r.anchor[1]*16+8,y1=r.end[1]*16+8;if(Math.abs(p.x-x)<=5&&p.y>=y0&&p.y<=y1)return{kind:'terrain-relation',id:r.id};}
  for(let i=sourceSelectables.length-1;i>=0;i--){const src=sourceSelectables[i],b=src.bounds;if(!b)continue;if(p.x>=b.x&&p.y>=b.y&&p.x<=b.x+b.width&&p.y<=b.y+b.height){if(String(src.sourceKey).startsWith('mark:'))return{kind:'source',id:src.sourceKey,sourceKey:src.sourceKey};if(isReviewedScenerySelectable(src))return{kind:'scenery',id:src.sourceKey,sourceKey:src.sourceKey};}}
  return null;
}
function terrainPaintMode(){return tileAuthoringMode==='terrain';}
function semanticTerrainCollisionAt(cx,cy){
  const cell=store?.terrainAt?.(cx,cy),set=cell?terrainSetById(resources?.autotileCatalog,cell.terrainSet):null;
  return set?.collision||nativeAutotileCollisionAt(cx,cy);
}
function edgeAnchorCompatible(set,cx,cy){return !!set&&String(semanticTerrainCollisionAt(cx,cy))===String(set.collision);}
function supportRelationCovering(cx,cy){return (store?.document?.terrainRelations||[]).find(r=>r.type==='support'&&r.anchor?.[0]===cx&&cy>r.anchor?.[1]&&cy<=r.end?.[1])||null;}
function supportPrototypeCanvas(prototype){
  const c=document.createElement('canvas');c.width=32;c.height=64;const g=c.getContext('2d');g.imageSmoothingEnabled=false;
  const capB=cellCanvas(prototype.sourceMapId,'B',prototype.platformCell[0],prototype.platformCell[1]),capA=cellCanvas(prototype.sourceMapId,'A',prototype.platformCell[0],prototype.platformCell[1]);g.drawImage(capB,8,0);g.drawImage(capA,8,0);
  for(let i=0;i<3;i++){const cell=prototype.stemCells?.[i%Math.max(1,prototype.stemCells?.length||1)];if(cell)g.drawImage(cellCanvas(prototype.sourceMapId,'A',cell[0],cell[1]),8,(i+1)*16);}return c;
}
function finalizeSupportRelation(relationId,{offerChoices=true}={}){
  const relation=store.document.terrainRelations?.find(r=>r.id===relationId);if(!relation)return;
  const ranked=rankSupportPrototypes(store.document,resources.autotileCatalog,relation,{collisionAt:nativeAutotileCollisionAt,visualAt:nativeAutotileVisualAt});if(!ranked.length)return;
  if(!relation.prototypeId)relation.prototypeId=ranked[0].prototype.id;
  const close=ranked.filter(row=>row.score<=ranked[0].score+1.15).slice(0,4);if(!offerChoices||!store.document.settings.terrainAssistAmbiguity||close.length<2||!ui.terrain_choice_dialog)return;
  ui.terrain_choice_dialog.dataset.relationId=relationId;ui.terrain_choice_summary.textContent=`${close.length} production constructions fit this support. The first is recommended from the surrounding ledge, wall and floor context.`;
  ui.terrain_choice_options.innerHTML=close.map((row,i)=>`<button type="button" class="terrain-choice-card ${i===0?'recommended':''}" data-support-prototype="${escapeHtml(row.prototype.id)}"><span class="terrain-choice-preview" data-support-preview="${escapeHtml(row.prototype.id)}"></span><span><strong>${i===0?'Recommended · ':''}${md(row.prototype.sourceMapId)}</strong><small>${row.role} · learned length ${row.prototype.sourceLength} · score ${row.score.toFixed(2)}</small></span></button>`).join('');
  requestAnimationFrame(()=>{const set=terrainSetById(resources.autotileCatalog,relation.terrainSet);for(const host of ui.terrain_choice_options.querySelectorAll('[data-support-preview]')){const p=set?.supportPrototypes?.find(v=>v.id===host.dataset.supportPreview);if(p)host.replaceChildren(supportPrototypeCanvas(p));}});ui.terrain_choice_dialog.showModal();
}
function clearStampTerrainAdaptation(targetStore,placement){
  if(!placement)return;const owned=new Set(targetStore.document.terrain.filter(t=>t.stampOwner===placement.id).map(t=>`${t.cell[0]},${t.cell[1]}`));targetStore.document.terrain=targetStore.document.terrain.filter(t=>t.stampOwner!==placement.id);
  for(const restore of placement.terrainRestore||[]){const k=`${restore.cell[0]},${restore.cell[1]}`;if(!owned.has(k)||!restore.terrain)continue;if(restore.terrain.stampOwner&&!targetStore.document.stamps.some(s=>s.id===restore.terrain.stampOwner))continue;targetStore.document.terrain=targetStore.document.terrain.filter(t=>!(t.cell[0]===restore.cell[0]&&t.cell[1]===restore.cell[1]));targetStore.document.terrain.push(deepClone(restore.terrain));}
  placement.terrainRestore=[];
}
function applyStampVariant(targetStore,placement,stamp){
  if(!placement||!stamp)return false;const maxX=Math.ceil(targetStore.document.bounds.width/16),maxY=Math.ceil(targetStore.document.bounds.height/16),[cx,cy]=placement.cell;if(cx<0||cy<0||cx+stamp.sizeCells[0]>maxX||cy+stamp.sizeCells[1]>maxY)return false;
  clearStampTerrainAdaptation(targetStore,placement);placement.stampId=stamp.id;placement.variantId=stamp.id;placement.familyId=placement.familyId||stamp.familyId||'';
  if(placement.terrainMode!=='visual-only')for(const row of terrainFootprintForPlacement(stamp,[cx,cy],{mirrorX:!!placement.mirrorX})){const existing=targetStore.terrainAt(row.cell[0],row.cell[1]);placement.terrainRestore.push({cell:row.cell.slice(),terrain:existing?deepClone(existing):null});targetStore.paintTerrain(row.cell[0],row.cell[1],{terrainSet:row.terrainSet,collisionMode:targetStore.document.settings.terrainCollisionMode,stampOwner:placement.id});}
  return true;
}
function rankedStampFamilyAt(family,cx,cy,targetSize=null,targetStore=store){return rankStampVariants(targetStore.document,resources.stampCatalog,family,[cx,cy],{collisionAt:nativeAutotileCollisionAt,visualAt:nativeAutotileVisualAt,targetSize,currentMapId:targetStore.document.base.mapId});}

function canonicalStampChoiceKey(stamp){
  const w=Number(stamp?.sizeCells?.[0]||1),h=Number(stamp?.sizeCells?.[1]||1);
  return `${stamp?.familyId||''}:${Math.min(w,h)}x${Math.max(w,h)}:${(stamp?.planes||[]).join('')}:${stamp?.category||''}`;
}
function dedupeStampChoices(rows,limit=6){
  const out=[],seen=new Set();
  for(const row of rows){
    const k=canonicalStampChoiceKey(row.stamp);
    if(seen.has(k))continue;
    seen.add(k);out.push(row);
    if(out.length>=limit)break;
  }
  return out;
}
function placeStampAt(p,targetStore=store,{targetSize=[1,1],family=selectedStamp,originCell=null,mirrorX=false}={}){
  if(!family){toast('Pick a smart stamp family from Library first.','warn');return null}if(targetStore.document.layers.foreground.locked&&variantsForFamily(resources.stampCatalog,family).some(s=>s.planes.includes('A'))){toast('Foreground presentation layer is locked.','warn');return null}if(targetStore.document.layers.background.locked&&variantsForFamily(resources.stampCatalog,family).some(s=>s.planes.includes('B'))){toast('Background presentation layer is locked.','warn');return null}
  const [cx,cy]=(originCell||[Math.floor(p.x/16),Math.floor(p.y/16)]).map(Number),ranked=rankedStampFamilyAt(family,cx,cy,targetSize,targetStore);if(!ranked.length)return null;
  const stage=chooseStampStage(resources.stampCatalog,family,targetSize),stageArea=stage?stage.sizeCells[0]*stage.sizeCells[1]:null,candidates=stageArea==null?ranked:ranked.filter(r=>Math.abs(r.stamp.sizeCells[0]*r.stamp.sizeCells[1]-stageArea)<=Math.max(1,stageArea*.35)),pool=candidates.length?candidates:ranked,chosen=chooseStampVariantForPlacement(resources.stampCatalog,family,pool,[cx,cy],{currentMapId:targetStore.document.base.mapId})||pool[0].stamp;
  const maxX=Math.ceil(targetStore.document.bounds.width/16),maxY=Math.ceil(targetStore.document.bounds.height/16);if(cx<0||cy<0||cx+chosen.sizeCells[0]>maxX||cy+chosen.sizeCells[1]>maxY){toast('Smart stamp would extend outside the level bounds.','warn');return null}
  const placement=targetStore.addStamp(chosen.id,cx,cy,{terrainMode:'adapt',familyId:family.id,variantId:chosen.id,mirrorX,contextCell:[Math.floor(p.x/16),Math.floor(p.y/16)]});applyStampVariant(targetStore,placement,chosen);return placement;
}
function updateSmartStampPlacement(placementId,targetSize,targetStore=store,{originCell=null,mirrorX=null}={}){
  const placement=targetStore.document.stamps?.find(s=>s.id===placementId);if(!placement)return null;const family=stampFamilyById(resources.stampCatalog,placement.familyId)||familyForStamp(resources.stampCatalog,placement.variantId||placement.stampId);if(!family)return null;
  if(originCell)placement.cell=originCell.slice(0,2).map(Number);
  if(mirrorX!=null)placement.mirrorX=!!mirrorX;
  const context=placement.contextCell||placement.cell,ranked=rankedStampFamilyAt(family,context[0],context[1],targetSize,targetStore);if(!ranked.length)return null;const stage=chooseStampStage(resources.stampCatalog,family,targetSize),stageArea=stage?stage.sizeCells[0]*stage.sizeCells[1]:null,candidates=stageArea==null?ranked:ranked.filter(r=>Math.abs(r.stamp.sizeCells[0]*r.stamp.sizeCells[1]-stageArea)<=Math.max(1,stageArea*.35));for(const row of candidates.length?candidates:ranked){if(applyStampVariant(targetStore,placement,row.stamp))return row.stamp;}return null;
}
function finalizeStampPlacement(placementId,{offerChoices=true}={}){
  const placement=store.document.stamps?.find(s=>s.id===placementId);if(!placement)return;const family=stampFamilyById(resources.stampCatalog,placement.familyId)||familyForStamp(resources.stampCatalog,placement.variantId||placement.stampId);if(!family)return;const current=stampById(resources.stampCatalog,placement.variantId||placement.stampId),targetSize=current?.sizeCells||[1,1],context=placement.contextCell||placement.cell,ranked=rankedStampFamilyAt(family,context[0],context[1],targetSize,store);if(!ranked.length)return;
  const currentArea=(current?.sizeCells?.[0]||1)*(current?.sizeCells?.[1]||1),sameStage=ranked.filter(r=>Math.abs(r.stamp.sizeCells[0]*r.stamp.sizeCells[1]-currentArea)<=Math.max(1,currentArea*.35)),pool=(sameStage.length?sameStage:ranked),best=pool[0];if(best&&best.stamp.id!==current?.id)applyStampVariant(store,placement,best.stamp);
  const close=dedupeStampChoices(pool.filter(row=>row.score<=pool[0].score+1.35),6);if(!offerChoices||!store.document.settings.terrainAssistAmbiguity||close.length<2||!ui.terrain_choice_dialog)return;
  ui.terrain_choice_dialog.dataset.stampPlacementId=placementId;ui.terrain_choice_dialog.dataset.stampFamilyId=family.id;ui.terrain_choice_summary.textContent=`${close.length} production ${family.label} examples fit this area. The first is recommended from nearby terrain and map context.`;
  ui.terrain_choice_options.innerHTML=close.map((row,i)=>`<button type="button" class="terrain-choice-card ${i===0?'recommended':''}" data-stamp-variant="${escapeHtml(row.stamp.id)}"><span class="terrain-choice-preview" data-stamp-preview="${escapeHtml(row.stamp.id)}"></span><span><strong>${i===0?'Recommended · ':''}${escapeHtml(row.stamp.label)}</strong><small>${row.stamp.sizeCells.join('×')} · ${md(row.stamp.sourceMapId)} · score ${row.score.toFixed(2)}</small></span></button>`).join('');
  requestAnimationFrame(()=>{for(const host of ui.terrain_choice_options.querySelectorAll('[data-stamp-preview]')){const s=stampById(resources.stampCatalog,host.dataset.stampPreview),c=s?stampPreviewCanvas(s,{mirrorX:!!placement.mirrorX}):null;if(c)host.replaceChildren(c);}});ui.terrain_choice_dialog.showModal();
}
function paintTileAt(p){
  if(stampPaintMode()){placeStampAt(p);return}
  if(terrainPaintMode()){
    if(store.document.layers.background.locked){toast('The background presentation layer is locked.','warn');return}
    if(!selectedTerrainSet){toast('Pick a terrain set in Library first.','warn');return}
    const cx=Math.floor(p.x/16),cy=Math.floor(p.y/16);store.paintTerrain(cx,cy,{terrainSet:selectedTerrainSet.id,collisionMode:store.document.settings.terrainCollisionMode});return;
  }
  if(!selectedTile){toast('Pick a source cell/tile in Library first.','warn');return;}
  if(selectedTileLayersLocked()){toast(selectedTile.kind==='cell16'?'Smart presentation cells require both presentation layers unlocked so A/B can be reproduced exactly.':selectedTile.kind==='element8'?'This exact presentation element requires all of its target planes unlocked.':'The active presentation layer is locked.','warn');return;}
  paintRawSelectionAt(p,store);
}
function gridPathCells(from,to){
  let [x0,y0]=from.map(Number),[x1,y1]=to.map(Number),dx=Math.abs(x1-x0),dy=Math.abs(y1-y0),sx=x0<x1?1:-1,sy=y0<y1?1:-1,err=dx-dy,out=[];
  for(;;){out.push([x0,y0]);if(x0===x1&&y0===y1)break;const e2=2*err;if(e2>-dy){err-=dy;x0+=sx}if(e2<dx){err+=dx;y0+=sy}}
  return out;
}
function constrainedPathCell(p,anchor=null){
  let cx=Math.floor(p.x/16),cy=Math.floor(p.y/16);const axis=selectedTerrainSet?.pathAxis||'';
  if(anchor&&axis==='vertical')cx=anchor[0];else if(anchor&&axis==='horizontal')cy=anchor[1];
  return [cx,cy];
}
function paintCollisionAt(p){if(store.document.layers.gameplay.locked){toast('Gameplay collision is locked.','warn');return}if(collisionAuthoring==='gameplay'){const gx=Math.floor(p.x/8),gy=Math.floor(p.y/8);store.setGameplayCollision(gx,gy,activeCollision);setSelection([gameplayCollisionSelectionItem(gx,gy)]);}else{const lx=Math.floor(p.x/16)+1,ly=Math.floor(p.y/16)+1;store.setCollision(lx,ly,activeCollision);setSelection([collisionSelectionItem(lx,ly)]);}}
function eyedropAt(p){
  if(stampPaintMode()){const hit=hitAt(p);if(hit?.kind==='stamp'){const placement=store.document.stamps.find(s=>s.id===hit.id),family=stampFamilyById(resources.stampCatalog,placement?.familyId)||familyForStamp(resources.stampCatalog,placement?.variantId||placement?.stampId);if(family){selectedStamp=family;renderStampLibrary();setTool('brush');toast(`Picked ${family.label}.`)}}else toast('No smart stamp at this position.','warn');return;}
  if(terrainPaintMode()){
    const cx=Math.floor(p.x/16),cy=Math.floor(p.y/16),cell=store.terrainAt(cx,cy);let set=cell?terrainSetById(resources.autotileCatalog,cell.terrainSet):null;
    if(!set&&descriptorCollisionBase(cx+1,cy+1)==='solid')set=currentTerrainSets().find(s=>s.nativeNeighborCollision==='solid')||null;
    if(set){selectedTerrainSet=set;renderTerrainLibrary();setTool('brush');toast(`Picked ${set.label}.`)}else toast('No semantic terrain at this cell.','warn');return;
  }
  if(rawCellMode()){const cx=Math.floor(p.x/16),cy=Math.floor(p.y/16),mapId=store.document.base.mapId,info=rawCellInfo(mapId).cells.get(`${cx},${cy}`);selectedTile=info&&info.type!=='EMPTY'?{kind:'cell16',sourceMapId:mapId,sourceMode:'SMART',cell:[cx,cy],classification:info.type}:null;if(selectedTile){ui.tile_source_map.value=String(mapId);ui.tile_source_plane.value='SMART';ui.selected_tile_label.textContent=`${md(mapId)} · c16 ${cx},${cy} · ${rawCellDisplayLabel(info)}`;renderTilePalette();setTool('brush');}else toast('No presentation cell at this position.','warn');return;}
  const gx=Math.floor(p.x/8),gy=Math.floor(p.y/8),layer=selectedLayerPlane(),t=store.tileAt(gx,gy,layer);selectedTile=t&&t.operation!=='clear'?{kind:'raw8',sourceMapId:t.sourceMapId,sourceLayer:t.sourceLayer,x:t.source[0],y:t.source[1]}:{kind:'raw8',sourceMapId:store.document.base.mapId,sourceLayer:layer,x:gx,y:gy};ui.tile_source_map.value=String(selectedTile.sourceMapId);ui.tile_source_plane.value=selectedTile.sourceLayer;renderTilePalette();ui.selected_tile_label.textContent=`${md(selectedTile.sourceMapId)} · ${selectedTile.sourceLayer} · g8 ${selectedTile.x},${selectedTile.y}`;setTool('brush');
}
function eraseAt(p){const hit=hitAt(p);if(hit?.kind==='entity'&&store.document.layers.entities.locked){toast('Entity layer is locked.','warn');return}if(hit?.kind==='entity'){store.removeEntity(hit.id);setSelection([]);return}if(hit?.kind==='stamp'){store.removeStamp(hit.id);setSelection([]);return}if(hit?.kind==='source'){const mark=Number(hit.id.split(':')[1]);store.sourceEntityOverride(mark,{suppressed:true});setSelection([]);return}if(hit?.kind==='scenery'){toast('Canonical scenery is read-only here; author a typed layered correction.','warn');return}if(stampPaintMode())return;if(!hit&&store.document.layers[activeLayer]?.locked){toast('The active presentation layer is locked.','warn');return}if(terrainPaintMode()){const cx=Math.floor(p.x/16),cy=Math.floor(p.y/16),relation=supportRelationCovering(cx,cy);if(relation){store.removeTerrainRelation(relation.id);toast('Removed smart support.');}else store.eraseTerrain(cx,cy);return}if(selectedTile?.kind==='element8'){const gx=Math.floor(p.x/8),gy=Math.floor(p.y/8);for(const layer of selectedTileTargetLayers())store.eraseTile(gx,gy,layer);return}if(selectedTile?.kind==='cell16'||rawCellMode()){const cx=Math.floor(p.x/16),cy=Math.floor(p.y/16);for(const plane of ['A','B'])for(let qy=0;qy<2;qy++)for(let qx=0;qx<2;qx++)store.eraseTile(cx*2+qx,cy*2+qy,plane);return}const gx=Math.floor(p.x/8),gy=Math.floor(p.y/8),layer=selectedLayerPlane();store.eraseTile(gx,gy,layer);}
function addEntityAt(p,type=selectedEntityType,{keepPlacement=false}={}){if(store.document.layers.entities.locked){toast('Entity layer is locked.','warn');return null}if(!type){toast('Choose an entity from Library first.','warn');return null;}const q=snapPoint(p);let created;store.transact('add-entity',d=>{const temp=new LevelDocumentStore(d);created=temp.addEntity({...type,x:q.x,y:q.y,patrolX:q.x,patrolY:q.y,triggerX:q.x,triggerY:q.y,actionPeriod:1,pn:type.pn??-1,flags:type.defaultFlags??0,name:type.name,category:type.category});d.entities.push(created)});selectedEntityType=type;entityPlacementArmed=!!keepPlacement;setSelection([{kind:'entity',id:created.id}]);switchInspector('inspector');updateToolHint();renderEntityLibrary();return created;}
function beginEntityEditAt(p,e){const hit=hitAt(p);if(!hit){if(entityPlacementArmed&&selectedEntityType)addEntityAt(p,selectedEntityType,{keepPlacement:true});else toast('Choose or drag an entity from Library to place it.','warn');return;}entityPlacementArmed=false;renderEntityLibrary();updateToolHint();if(hit.kind==='entity'){setSelection([hit],{add:e.shiftKey});gesture={type:'move',start:p,current:p,selection:deepClone(selection),before:store.snapshot()};switchInspector('inspector');return;}if(hit.kind==='source'){const id=convertSource(Number(hit.id.split(':')[1]),{silent:true});if(id){setSelection([{kind:'entity',id}]);switchInspector('inspector');toast('Production entity converted to an editable draft instance. Undo restores the source actor.');}return;}setSelection([hit],{add:e.shiftKey});switchInspector('inspector');}
function setHeroAt(p){const q=snapPoint(p);store.transact('hero-start',d=>{d.heroStart={x:q.x,y:q.y}});setSelection([{kind:'hero',id:'hero'}]);}
function rectPaint(a,b){
  if(stampPaintMode()){if(!selectedStamp)return;const x0=Math.floor(Math.min(a.x,b.x)/16),x1=Math.floor(Math.max(a.x,b.x)/16),y0=Math.floor(Math.min(a.y,b.y)/16),y1=Math.floor(Math.max(a.y,b.y)/16),stage=chooseStampStage(resources.stampCatalog,selectedStamp,[1,1])||familyPreviewStamp(selectedStamp),sx=Math.max(1,Number(stage?.sizeCells?.[0])||1),sy=Math.max(1,Number(stage?.sizeCells?.[1])||1);store.transact('rectangle-stamps',d=>{const temp=new LevelDocumentStore(d);for(let y=y0;y<=y1;y+=sy)for(let x=x0;x<=x1;x+=sx)placeStampAt({x:x*16,y:y*16},temp,{targetSize:[sx,sy],family:selectedStamp});d.stamps=temp.document.stamps;d.terrain=temp.document.terrain});return;}
  if(terrainPaintMode()){
    if(store.document.layers.background.locked||!selectedTerrainSet)return;const x0=Math.floor(Math.min(a.x,b.x)/16),x1=Math.floor(Math.max(a.x,b.x)/16),y0=Math.floor(Math.min(a.y,b.y)/16),y1=Math.floor(Math.max(a.y,b.y)/16);
    store.transact('rectangle-terrain',d=>{const temp=new LevelDocumentStore(d);for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)temp.paintTerrain(x,y,{terrainSet:selectedTerrainSet.id,collisionMode:d.settings.terrainCollisionMode});d.terrain=temp.document.terrain});return;
  }
  if(!selectedTile)return;const grid=selectedRawGrid();if(selectedTileLayersLocked()){toast(selectedTile.kind==='cell16'?'Smart presentation cells require both presentation layers unlocked.':selectedTile.kind==='element8'?'This exact presentation element requires all of its target planes unlocked.':'The active presentation layer is locked.','warn');return;}const x0=Math.floor(Math.min(a.x,b.x)/grid),x1=Math.floor(Math.max(a.x,b.x)/grid),y0=Math.floor(Math.min(a.y,b.y)/grid),y1=Math.floor(Math.max(a.y,b.y)/grid);store.transact('rectangle-paint',d=>{const temp=new LevelDocumentStore(d);for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)paintRawSelectionAt({x:x*grid,y:y*grid},temp);d.tiles=temp.document.tiles});
}
function terrainIdentity(x,y){const t=store.terrainAt(x,y);if(t)return `terrain:${t.terrainSet}`;if(store.document.base.blank)return 'blank';return `native:${descriptorCollisionBase(x+1,y+1)}`;}
function floodFill(p){
  if(stampPaintMode()){const before=store.snapshot();placeStampAt(p);store.undoStack.push(before);store.redoStack=[];store.emit('stamp');return;}
  if(terrainPaintMode()){
    if(!selectedTerrainSet)return;const sx=Math.floor(p.x/16),sy=Math.floor(p.y/16),maxX=Math.ceil(docBounds().width/16),maxY=Math.ceil(docBounds().height/16),seed=terrainIdentity(sx,sy),seen=new Set(),queue=[[sx,sy]],cells=[];
    while(queue.length&&cells.length<6000){const [x,y]=queue.shift(),k=`${x},${y}`;if(seen.has(k)||x<0||y<0||x>=maxX||y>=maxY)continue;seen.add(k);if(terrainIdentity(x,y)!==seed)continue;cells.push([x,y]);queue.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);}
    store.transact('terrain-fill',d=>{const temp=new LevelDocumentStore(d);for(const [x,y] of cells)temp.paintTerrain(x,y,{terrainSet:selectedTerrainSet.id,collisionMode:d.settings.terrainCollisionMode});d.terrain=temp.document.terrain});toast(`Filled ${cells.length} terrain cell${cells.length===1?'':'s'}.`);return;
  }
  if(!selectedTile)return;
  if(selectedTile.kind==='element8'){if(selectedTileLayersLocked()){toast('This exact presentation element requires all of its target planes unlocked.','warn');return;}const layers=selectedTileTargetLayers(),sx=Math.floor(p.x/8),sy=Math.floor(p.y/8),maxX=Math.ceil(docBounds().width/8),maxY=Math.ceil(docBounds().height/8),identity=(x,y)=>layers.map(layer=>tileIdentity(x,y,layer)).join('|'),seed=identity(sx,sy),seen=new Set(),queue=[[sx,sy]],cells=[];while(queue.length&&cells.length<6000){const [x,y]=queue.shift(),k=`${x},${y}`;if(seen.has(k)||x<0||y<0||x>=maxX||y>=maxY)continue;seen.add(k);if(identity(x,y)!==seed)continue;cells.push([x,y]);queue.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);}store.transact('presentation-element-fill',d=>{const temp=new LevelDocumentStore(d);for(const [x,y] of cells)paintRawSelectionAt({x:x*8,y:y*8},temp);d.tiles=temp.document.tiles});toast(`Filled ${cells.length} presentation element cell${cells.length===1?'':'s'}.`);return;}
  if(selectedTile.kind==='cell16'){if(store.document.layers.background.locked||store.document.layers.foreground.locked){toast('Smart presentation cells require both presentation layers unlocked.','warn');return;}const sx=Math.floor(p.x/16),sy=Math.floor(p.y/16),maxX=Math.ceil(docBounds().width/16),maxY=Math.ceil(docBounds().height/16),seed=presentationCellIdentity(sx,sy),seen=new Set(),queue=[[sx,sy]],cells=[];while(queue.length&&cells.length<6000){const [x,y]=queue.shift(),k=`${x},${y}`;if(seen.has(k)||x<0||y<0||x>=maxX||y>=maxY)continue;seen.add(k);if(presentationCellIdentity(x,y)!==seed)continue;cells.push([x,y]);queue.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);}store.transact('presentation-cell-fill',d=>{const temp=new LevelDocumentStore(d);for(const [x,y] of cells)paintRawSelectionAt({x:x*16,y:y*16},temp);d.tiles=temp.document.tiles});toast(`Filled ${cells.length} presentation cell${cells.length===1?'':'s'}.`);return;}
  if(store.document.layers[activeLayer]?.locked){toast('The active presentation layer is locked.','warn');return}const layer=selectedTile.sourceLayer||selectedLayerPlane(),sx=Math.floor(p.x/8),sy=Math.floor(p.y/8),maxX=Math.ceil(docBounds().width/8),maxY=Math.ceil(docBounds().height/8),seed=tileIdentity(sx,sy,layer),seen=new Set(),queue=[[sx,sy]],cells=[];while(queue.length&&cells.length<6000){const [x,y]=queue.shift(),k=`${x},${y}`;if(seen.has(k)||x<0||y<0||x>=maxX||y>=maxY)continue;seen.add(k);if(tileIdentity(x,y,layer)!==seed)continue;cells.push([x,y]);queue.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);}store.transact('flood-fill',d=>{const temp=new LevelDocumentStore(d);for(const [x,y] of cells)temp.paintTile(x,y,{layer,sourceMapId:selectedTile.sourceMapId,sourceX:selectedTile.x,sourceY:selectedTile.y,sourceLayer:selectedTile.sourceLayer});d.tiles=temp.document.tiles});toast(`Filled ${cells.length} tile${cells.length===1?'':'s'}.`);
}
function tileIdentity(x,y,layer){const t=store.tileAt(x,y,layer);if(t)return t.operation==='clear'?'clear':`${t.sourceMapId}:${t.sourceLayer}:${t.source?.join(',')}`;return store.document.base.blank?'blank':`base:${store.document.base.mapId}:${layer}:${x},${y}`;}

function stagePointerDown(e){if(e.button!==0&&e.button!==1)return;ui.scene_stage.focus();ui.scene_stage.setPointerCapture?.(e.pointerId);const p=stagePoint(e);if(e.button===1||tool==='hand'||spaceHeld){gesture={type:'pan',client:{x:e.clientX,y:e.clientY},scroll:{x:ui.viewport_scroll.scrollLeft,y:ui.viewport_scroll.scrollTop}};ui.scene_stage.dataset.dragging='true';e.preventDefault();return}
  if(diagnosticPointerDown(e,p)){e.preventDefault();return}
  if(beginSceneProjectileDrag(p)){e.preventDefault();return}
  if(tool==='select'){const transitionHit=nativeTransitionHitAt(p);if(transitionHit){setSelection([transitionHit],{add:e.shiftKey});switchInspector('inspector');e.preventDefault();return;}}
  if(tool==='select'){if(selectMode!=='object'){if(!e.shiftKey)setSelection([]);gesture={type:'region-select',mode:selectMode,start:p,current:p,add:e.shiftKey};ui.scene_stage.dataset.marquee='true';}else{const patrolHandle=sourceEnemyPatrolHandleAt(p);if(patrolHandle){gesture={type:'enemy-patrol-resize',before:store.snapshot(),mark:patrolHandle.mark,edge:patrolHandle.edge,geometry:patrolHandle.geometry};ui.scene_stage.dataset.dragging='true';e.preventDefault();return;}const resize=stampResizeHandleAt(p);if(resize){gesture={type:'stamp-resize',before:store.snapshot(),placementId:resize.placementId,fixedCorner:resize.fixed.slice(),mirrorX:resize.mirrorX};return;}const hit=hitAt(p);if(hit){setSelection([hit],{add:e.shiftKey});const moveSelection=deepClone(selection),sourceSnapBounds={};for(const item of moveSelection)if(item.kind==='source'){const selectable=sourceSelectables.find(row=>String(row.sourceKey)===String(item.id));if(selectable)sourceSnapBounds[item.id]=deepClone(selectable.opaqueBounds||selectable.bounds);}gesture={type:'move',start:p,current:p,selection:moveSelection,before:store.snapshot(),sourceSnapBounds};}else{if(!e.shiftKey)setSelection([]);gesture={type:'marquee',start:p,current:p};ui.scene_stage.dataset.marquee='true';}} }
  else if(tool==='brush'){const missing=terrainPaintMode()?!selectedTerrainSet:stampPaintMode()?!selectedStamp:!selectedTile;if(missing){toast(terrainPaintMode()?'Pick terrain from Library.':stampPaintMode()?'Pick a smart stamp family from Library.':'Pick a tile from Library.','warn');return}const before=store.snapshot(),grid=(terrainPaintMode()||stampPaintMode())?16:selectedRawGrid();if(stampPaintMode()){const anchor=[Math.floor(p.x/16),Math.floor(p.y/16)],placement=placeStampAt(p,store,{targetSize:[1,1],family:selectedStamp,originCell:anchor,mirrorX:false});if(!placement)return;scheduleRender();gesture=selectedStamp.variantPolicy==='weighted-common'?{type:'brush',grid:16,mode:'stamp',last:`${anchor[0]},${anchor[1]}`,before}:{type:'stamp-progressive',before,placementId:placement.id,familyId:selectedStamp.id,anchorCell:anchor.slice(),originCell:anchor.slice(),mirrorX:false,lastTargetSize:[1,1]};}else if(terrainPaintMode()&&selectedTerrainSet?.kind==='edge'){const anchor=[Math.floor(p.x/16),Math.floor(p.y/16)],compatible=edgeAnchorCompatible(selectedTerrainSet,anchor[0],anchor[1]);if(!compatible)store.paintTerrain(anchor[0],anchor[1],{terrainSet:selectedTerrainSet.id,collisionMode:store.document.settings.terrainCollisionMode});scheduleRender();gesture={type:'brush',grid:16,mode:'terrain',edgeSmart:true,anchorCell:anchor.slice(),lastCell:anchor.slice(),last:`${anchor[0]},${anchor[1]}`,before,anchorCompatible:compatible,axis:null,edgeTouched:compatible?[]:[anchor.slice()]};}else{paintTileAt(p);scheduleRender();const pathCell=terrainPaintMode()&&selectedTerrainSet?.kind==='path'?constrainedPathCell(p):null;gesture={type:'brush',grid,mode:tileAuthoringMode,last:`${Math.floor(p.x/grid)},${Math.floor(p.y/grid)}`,before,...(pathCell?{anchorCell:pathCell.slice(),lastCell:pathCell.slice(),pathTouched:[pathCell.slice()]}:{})};}}
  else if(tool==='rectangle')gesture={type:'rectangle',start:p,current:p};
  else if(tool==='scissors'){if(smartScissorsMode==='repair')gesture={type:'smart-scissors',start:p,current:p};else if(smartScissorsTransferSelection&&p.x>=smartScissorsTransferSelection.x&&p.x<smartScissorsTransferSelection.x+smartScissorsTransferSelection.width&&p.y>=smartScissorsTransferSelection.y&&p.y<smartScissorsTransferSelection.y+smartScissorsTransferSelection.height)gesture={type:'smart-scissors-cut-transfer',mode:smartScissorsMode,start:p,current:p,sourceBounds:deepClone(smartScissorsTransferSelection),destination:deepClone(smartScissorsTransferSelection)};else{smartScissorsTransferSelection=null;gesture={type:'smart-scissors-cut-select',mode:smartScissorsMode,start:p,current:p};updateToolHint();renderEditorOverlay();}}
  else if(tool==='collision'){
    if(collisionMode==='select'){gesture={type:'collision-select',start:p,current:p,add:e.shiftKey};renderEditorOverlay();}
    else{const before=store.snapshot();paintCollisionAt(p);scheduleRender();gesture={type:'collision',last:`${Math.floor(p.x/16)},${Math.floor(p.y/16)}`,before};}
  }
  else if(tool==='entity')beginEntityEditAt(p,e);else if(tool==='hero')setHeroAt(p);else if(tool==='erase')eraseAt(p);else if(tool==='eyedropper')eyedropAt(p);else if(tool==='fill')gesture={type:'fill-frame',start:p,current:p};e.preventDefault();}
function stagePointerMove(e){const inside=stageClientInside(e),p=stagePoint(e),lx=Math.floor(p.x/16)+1,ly=Math.floor(p.y/16)+1;if(inside){setHoverCell(p);ui.cursor_readout.textContent=tool==='collision'?`x ${Math.round(p.x)} · y ${Math.round(p.y)} · logic ${lx},${ly} · ${collisionEffective(lx,ly)}`:stampPaintMode()?`x ${Math.round(p.x)} · y ${Math.round(p.y)} · stamp ${Math.floor(p.x/16)},${Math.floor(p.y/16)}`:terrainPaintMode()?`x ${Math.round(p.x)} · y ${Math.round(p.y)} · terrain ${Math.floor(p.x/16)},${Math.floor(p.y/16)}`:`x ${Math.round(p.x)} · y ${Math.round(p.y)} · g8 ${Math.floor(p.x/8)},${Math.floor(p.y/8)}`;if(!gesture)ui.scene_stage.style.cursor=tool==='scissors'&&smartScissorsMode!=='repair'&&smartScissorsTransferSelection&&p.x>=smartScissorsTransferSelection.x&&p.x<smartScissorsTransferSelection.x+smartScissorsTransferSelection.width&&p.y>=smartScissorsTransferSelection.y&&p.y<smartScissorsTransferSelection.y+smartScissorsTransferSelection.height?'move':tool==='select'&&selectMode==='object'&&sourceEnemyPatrolHandleAt(p)?'ew-resize':'';}else if(!gesture){clearHoverCell();ui.cursor_readout.textContent='x — · y —';ui.scene_stage.style.cursor='';return;}if(!gesture)return;
  if(gesture.type==='pan'){ui.viewport_scroll.scrollLeft=gesture.scroll.x-(e.clientX-gesture.client.x);ui.viewport_scroll.scrollTop=gesture.scroll.y-(e.clientY-gesture.client.y);renderNavigator();return}
  if(gesture.type==='marquee'||gesture.type==='region-select'||gesture.type==='rectangle'||gesture.type==='smart-scissors'||gesture.type==='smart-scissors-cut-select'||gesture.type==='collision-select'||gesture.type==='fill-frame'){gesture.current=p;renderEditorOverlay();return}
  if(gesture.type==='smart-scissors-cut-transfer'){gesture.current=p;gesture.destination=smartScissorsMovedBounds(gesture.sourceBounds,gesture.start,p);renderEditorOverlay();return}
  if(gesture.type==='projectile-topology-move'){const dx=Math.round(p.x-gesture.start.x),dy=Math.round(p.y-gesture.start.y);store.document=deepClone(gesture.before);const override=ensureSourceOverrideInDocument(store.document,gesture.mark),next=[gesture.origin[0]+dx,gesture.origin[1]+dy];if(gesture.family==='projectile-emitter')override.projectileEmitterOrigin=next;else{const semantic=resolvedSemanticForMark(gesture.mark),topology=semantic?.projectileTopologyResolved||{},shooter=topology?.shooter||{},prior=override.projectileShooterPresentation||{};override.projectileShooterPresentation={actorId:Number(prior.actorId??shooter.actorId??topology?.emitter?.actorId??0),pn:Number(prior.pn??shooter.pn??0),origin:next};}rendererAuthorityKey='';scheduleRender();return}
  if(gesture.type==='enemy-patrol-resize'){const base=gesture.geometry,editorX=clamp(Number(p.x),0,docBounds().width),classicX=editorX-Number(base.sourceOffset?.[0]||0),next=resizeEnemyPatrolEdge(base.patrol,gesture.edge,classicX);if(next){store.document=deepClone(gesture.before);setSourceEnemyPatrolInDocument(store.document,gesture.mark,next);scheduleRender();}return}
  if(gesture.type==='stamp-resize'){const moving=[Math.round(p.x/16),Math.round(p.y/16)],fixed=gesture.fixedCorner,x0=Math.max(0,Math.min(fixed[0],moving[0])),y0=Math.max(0,Math.min(fixed[1],moving[1])),x1=Math.min(Math.ceil(store.document.bounds.width/16),Math.max(fixed[0],moving[0])),y1=Math.min(Math.ceil(store.document.bounds.height/16),Math.max(fixed[1],moving[1])),targetSize=[Math.max(1,x1-x0),Math.max(1,y1-y0)];store.document=deepClone(gesture.before);const changed=updateSmartStampPlacement(gesture.placementId,targetSize,store,{originCell:[x0,y0],mirrorX:gesture.mirrorX});if(changed){scheduleRender();renderEditorOverlay();}return}
  if(gesture.type==='stamp-progressive'){const target=[Math.floor(p.x/16),Math.floor(p.y/16)],dx=Math.abs(target[0]-gesture.anchorCell[0])+1,dy=Math.abs(target[1]-gesture.anchorCell[1])+1,targetSize=[dx,dy],origin=[Math.min(target[0],gesture.anchorCell[0]),Math.min(target[1],gesture.anchorCell[1])],mirrorX=target[0]<gesture.anchorCell[0];if(targetSize[0]!==gesture.lastTargetSize?.[0]||targetSize[1]!==gesture.lastTargetSize?.[1]||mirrorX!==gesture.mirrorX||origin[0]!==gesture.originCell?.[0]||origin[1]!==gesture.originCell?.[1]){const changed=updateSmartStampPlacement(gesture.placementId,targetSize,store,{originCell:origin,mirrorX});if(changed){gesture.lastTargetSize=targetSize;gesture.originCell=origin;gesture.mirrorX=mirrorX;scheduleRender();}}return}
  if(gesture.type==='brush'){const grid=gesture.grid||8;if(gesture.edgeSmart){const target=[Math.floor(p.x/16),Math.floor(p.y/16)],k=`${target[0]},${target[1]}`;if(k===gesture.last)return;const [ax,ay]=gesture.anchorCell,dx=target[0]-ax,dy=target[1]-ay;if(!gesture.axis){if(dy>0&&Math.abs(dy)>=Math.abs(dx))gesture.axis='support';else if(Math.abs(dx)>0)gesture.axis='horizontal';else if(dy<0){gesture.axis='blocked-up';toast('One-way ledge supports are drawn downward from the walkway. Drag horizontally to extend the walkway.','warn');}}const temp=new LevelDocumentStore(store.document);if(gesture.axis==='support'){const relation=temp.upsertTerrainSupport(ax,ay,{terrainSet:selectedTerrainSet.id,endY:target[1]});store.document.terrainRelations=temp.document.terrainRelations;gesture.supportRelationId=relation?.id||gesture.supportRelationId;}else if(gesture.axis==='horizontal'){const horizontalTarget=[target[0],ay];for(const [cx,cy] of gridPathCells(gesture.lastCell||gesture.anchorCell,horizontalTarget)){if(gesture.anchorCompatible&&cx===ax&&cy===ay)continue;temp.paintTerrain(cx,cy,{terrainSet:selectedTerrainSet.id,collisionMode:store.document.settings.terrainCollisionMode});gesture.edgeTouched?.push([cx,cy]);}store.document.terrain=temp.document.terrain;gesture.lastCell=horizontalTarget.slice();}gesture.last=k;scheduleRender();return}const pathMode=gesture.mode==='terrain'&&selectedTerrainSet?.kind==='path',targetCell=pathMode?constrainedPathCell(p,gesture.anchorCell):null,k=pathMode?`${targetCell[0]},${targetCell[1]}`:`${Math.floor(p.x/grid)},${Math.floor(p.y/grid)}`;if(k!==gesture.last){const temp=new LevelDocumentStore(store.document);if(gesture.mode==='stamp'&&stampPaintMode()){placeStampAt(p,temp);store.document.stamps=temp.document.stamps;store.document.terrain=temp.document.terrain}else if(gesture.mode==='stamp'&&stampElementPaintMode()){paintRawSelectionAt(p,temp);store.document.tiles=temp.document.tiles}else if(pathMode){for(const [cx,cy] of gridPathCells(gesture.lastCell||targetCell,targetCell)){temp.paintTerrain(cx,cy,{terrainSet:selectedTerrainSet.id,collisionMode:store.document.settings.terrainCollisionMode});gesture.pathTouched?.push([cx,cy])}store.document.terrain=temp.document.terrain;gesture.lastCell=targetCell.slice()}else if(gesture.mode==='terrain'){temp.paintTerrain(Math.floor(p.x/16),Math.floor(p.y/16),{terrainSet:selectedTerrainSet.id,collisionMode:store.document.settings.terrainCollisionMode});store.document.terrain=temp.document.terrain}else if(gesture.mode==='raw'&&selectedTile?.kind==='cell16'){paintRawSelectionAt(p,temp);store.document.tiles=temp.document.tiles}else{paintRawSelectionAt(p,temp);store.document.tiles=temp.document.tiles}gesture.last=k;scheduleRender()}return}
  if(gesture.type==='collision'){const grid=collisionSelectionGrid(),k=`${Math.floor(p.x/grid)},${Math.floor(p.y/grid)}`;if(k!==gesture.last){gesture.last=k;const temp=new LevelDocumentStore(store.document);if(collisionAuthoring==='gameplay'){const gx=Math.floor(p.x/8),gy=Math.floor(p.y/8);temp.setGameplayCollision(gx,gy,activeCollision);store.document.gameplayCollision=temp.document.gameplayCollision;setSelection([gameplayCollisionSelectionItem(gx,gy)]);}else{const cx=Math.floor(p.x/16)+1,cy=Math.floor(p.y/16)+1;temp.setCollision(cx,cy,activeCollision);store.document.collision=temp.document.collision;setSelection([collisionSelectionItem(cx,cy)]);}scheduleRender()}return}
  if(gesture.type==='move'){const dx=p.x-gesture.start.x,dy=p.y-gesture.start.y,sourceItem=gesture.selection.find(item=>item.kind==='source'),sourceBounds=sourceItem?gesture.sourceSnapBounds?.[sourceItem.id]:null,sourceSnap=store.document.settings.snap&&sourceBounds?snapSourceOpaqueTranslation(sourceBounds,dx,dy,{grid:store.document.settings.gridSize||8}):null,qdx=sourceSnap?sourceSnap.dx:(store.document.settings.snap?Math.round(dx/(store.document.settings.gridSize||8))*(store.document.settings.gridSize||8):Math.round(dx)),qdy=sourceSnap?sourceSnap.dy:(store.document.settings.snap?Math.round(dy/(store.document.settings.gridSize||8))*(store.document.settings.gridSize||8):Math.round(dy)),dcx=Math.round(qdx/16),dcy=Math.round(qdy/16);store.document=deepClone(gesture.before);for(const s of gesture.selection){if(s.kind==='entity'){const e0=gesture.before.entities.find(x=>x.id===s.id),e1=store.document.entities.find(x=>x.id===s.id);if(e0&&e1){e1.x=e0.x+qdx;e1.y=e0.y+qdy;e1.patrolX=(e0.patrolX??e0.x)+qdx;e1.patrolY=(e0.patrolY??e0.y)+qdy;e1.triggerX=e0.triggerX+qdx;e1.triggerY=e0.triggerY+qdy}}else if(s.kind==='hero'){store.document.heroStart={x:gesture.before.heroStart.x+qdx,y:gesture.before.heroStart.y+qdy}}else if(s.kind==='source'){const mark=Number(String(s.id).replace('mark:','')),before=sourcePlacement(mark,gesture.before);setSourcePlacementInDocument(store.document,mark,before.dx+qdx,before.dy+qdy)}else if(s.kind==='stamp'){const p0=gesture.before.stamps?.find(x=>x.id===s.id),p1=store.document.stamps?.find(x=>x.id===s.id);if(p0&&p1&&(dcx||dcy)){p1.cell=[p0.cell[0]+dcx,p0.cell[1]+dcy];for(const t of store.document.terrain.filter(t=>t.stampOwner===s.id))t.cell=[t.cell[0]+dcx,t.cell[1]+dcy];for(const r of p1.terrainRestore||[]){r.cell=[r.cell[0]+dcx,r.cell[1]+dcy];if(r.terrain?.cell)r.terrain.cell=[r.terrain.cell[0]+dcx,r.terrain.cell[1]+dcy];}}}}scheduleRender();}
}
function stagePointerUp(e){if(finishViewportBackgroundClick(e))return;if(!gesture)return;ui.scene_stage.releasePointerCapture?.(e.pointerId);const g=gesture,p=stagePoint(e);gesture=null;ui.scene_stage.style.cursor='';delete ui.scene_stage.dataset.dragging;delete ui.scene_stage.dataset.marquee;
  if(g.type==='marquee'){const x0=Math.min(g.start.x,p.x),y0=Math.min(g.start.y,p.y),x1=Math.max(g.start.x,p.x),y1=Math.max(g.start.y,p.y),items=[];if(Math.abs(p.x-g.start.x)<3&&Math.abs(p.y-g.start.y)<3){const cx=Math.floor(p.x/16),cy=Math.floor(p.y/16),terrain=store.terrainAt(cx,cy);if(terrain){setSelection([{kind:'terrain',id:terrain.id,cx,cy}]);renderEditorOverlay();return}const gx=Math.floor(p.x/8),gy=Math.floor(p.y/8),layer=selectedLayerPlane();setSelection([{kind:'cell',id:`${layer}:${gx}:${gy}`,gx,gy,layer}]);renderEditorOverlay();return}for(const h of customHitboxes){const b=h.bounds;if(b.x+b.width>=x0&&b.y+b.height>=y0&&b.x<=x1&&b.y<=y1)items.push({kind:'entity',id:h.id})}for(const s of sourceSelectables){const b=s.bounds;if(!b||b.x+b.width<x0||b.y+b.height<y0||b.x>x1||b.y>y1)continue;if(String(s.sourceKey).startsWith('mark:'))items.push({kind:'source',id:s.sourceKey,sourceKey:s.sourceKey});else if(isReviewedScenerySelectable(s))items.push({kind:'scenery',id:s.sourceKey,sourceKey:s.sourceKey})}setSelection(items,{add:e.shiftKey});}
  else if(g.type==='region-select'){const region=regionSelectionFromPoints(g.start,p,g.mode,docBounds());if(region)setSelection([region],{add:g.add});}
  else if(g.type==='collision-select'){const grid=collisionSelectionGrid(),x0=Math.floor(Math.min(g.start.x,p.x)/grid),x1=Math.floor(Math.max(g.start.x,p.x)/grid),y0=Math.floor(Math.min(g.start.y,p.y)/grid),y1=Math.floor(Math.max(g.start.y,p.y)/grid),items=[];for(let cy=y0;cy<=y1;cy++)for(let cx=x0;cx<=x1;cx++)items.push(collisionAuthoring==='gameplay'?gameplayCollisionSelectionItem(cx,cy):collisionSelectionItem(cx+1,cy+1));setSelection(items,{add:g.add});}
  else if(g.type==='rectangle')rectPaint(g.start,p);
  else if(g.type==='smart-scissors'){const bounds=smartScissorsBoundsFromPoints(g.start,p,docBounds());if(bounds)openSmartScissors(bounds,{seedPoint:g.start});}
  else if(g.type==='smart-scissors-cut-select'){const bounds=smartScissorsBoundsFromPoints(g.start,p,docBounds());if(bounds){const planes=g.mode==='paste'?[...smartScissorsTransferPlanesForPresentation(depthPreviewMode)]:['B','A'];smartScissorsTransferSelection={...bounds,planes};updateToolHint();toast(`Cut selected · ${bounds.width/8}×${bounds.height/8} cells · ${smartScissorsPlaneLabel(planes)}. Drag inside the selection to ${g.mode==='paste'?'paste':'move'} it.`,'ok',3000);}}
  else if(g.type==='smart-scissors-cut-transfer'){const destination=smartScissorsMovedBounds(g.sourceBounds,g.start,p);smartScissorsTransferSelection=g.sourceBounds;if(g.mode==='paste')openSmartScissorsPaste(g.sourceBounds,destination);else openSmartScissorsMove(g.sourceBounds,destination);}
  else if(g.type==='fill-frame'){const dx=Math.abs(g.current.x-g.start.x),dy=Math.abs(g.current.y-g.start.y);if(dx<4&&dy<4)floodFill(g.start);else rectPaint(g.start,g.current);}
  else if(g.type==='projectile-topology-move'){store.undoStack.push(g.before);if(store.undoStack.length>store.historyLimit)store.undoStack.shift();store.redoStack=[];store.emit('projectile-topology-move');rendererAuthorityKey='';scheduleRender();}
  else if(g.type==='enemy-patrol-resize'){store.undoStack.push(g.before);if(store.undoStack.length>store.historyLimit)store.undoStack.shift();store.redoStack=[];store.emit('source-enemy-patrol-resize');refreshNativeDraftRuntime();renderInspector();}
  else if(g.type==='stamp-progressive'||g.type==='stamp-resize'){setSelection([{kind:'stamp',id:g.placementId}]);store.undoStack.push(g.before);if(store.undoStack.length>store.historyLimit)store.undoStack.shift();store.redoStack=[];store.emit(g.type==='stamp-resize'?'smart-stamp-resize':'smart-stamp');queueMicrotask(()=>finalizeStampPlacement(g.placementId,{offerChoices:true}));}
  else if(['brush','collision','move'].includes(g.type)){if(g.type==='brush'&&g.supportRelationId)finalizeSupportRelation(g.supportRelationId,{offerChoices:false});store.undoStack.push(g.before);if(store.undoStack.length>store.historyLimit)store.undoStack.shift();store.redoStack=[];store.emit(g.type==='brush'&&g.pathTouched?.length?'path-repair':g.type);if(g.type==='move'&&g.selection?.some(item=>item.kind==='source'))refreshNativeDraftRuntime();if(g.type==='brush'&&g.supportRelationId)queueMicrotask(()=>finalizeSupportRelation(g.supportRelationId,{offerChoices:true}));}
  renderEditorOverlay();}

function deleteSelection(){if(!selection.length)return;store.transact('delete-selection',d=>{for(const s of selection){if(s.kind==='entity')d.entities=d.entities.filter(e=>e.id!==s.id);else if(s.kind==='source'){const mark=Number(s.id.split(':')[1]);let row=d.sourceEntityOverrides.find(x=>x.mark===mark);if(!row){row={mark,suppressed:true};d.sourceEntityOverrides.push(row)}row.suppressed=true}else if(s.kind==='tile')d.tiles=d.tiles.filter(t=>t.id!==s.id);else if(s.kind==='terrain')d.terrain=d.terrain.filter(t=>t.id!==s.id);else if(s.kind==='terrain-relation')d.terrainRelations=d.terrainRelations.filter(r=>r.id!==s.id);else if(s.kind==='stamp'){const temp=new LevelDocumentStore(d);temp.removeStamp(s.id);d.stamps=temp.document.stamps;d.terrain=temp.document.terrain}else if(s.kind==='collision')d.collision=d.collision.filter(c=>!(Number(c.logic?.[0])===Number(s.logic?.[0])&&Number(c.logic?.[1])===Number(s.logic?.[1])));else if(s.kind==='gameplay-collision')d.gameplayCollision=(d.gameplayCollision||[]).filter(c=>!(Number(c.g8?.[0])===Number(s.g8?.[0])&&Number(c.g8?.[1])===Number(s.g8?.[1])))}});setSelection([]);}
function duplicateSelection(){const entities=selection.filter(s=>s.kind==='entity').map(s=>store.document.entities.find(e=>e.id===s.id)).filter(Boolean);if(!entities.length)return;let ids=[];store.transact('duplicate',d=>{for(const src of entities){const temp=new LevelDocumentStore(d);const n=temp.addEntity({...src,sourceMark:null,x:src.x+8,y:src.y+8,patrolX:(src.patrolX??src.x)+8,patrolY:(src.patrolY??src.y)+8,triggerX:src.triggerX+8,triggerY:src.triggerY+8,name:`${src.name} copy`});d.entities.push(n);ids.push(n.id)}});setSelection(ids.map(id=>({kind:'entity',id})));}
function copySelection(){clipboardEntities=selection.filter(s=>s.kind==='entity').map(s=>deepClone(store.document.entities.find(e=>e.id===s.id))).filter(Boolean);if(clipboardEntities.length)toast(`Copied ${clipboardEntities.length} entit${clipboardEntities.length===1?'y':'ies'}.`);}
function pasteSelection(){if(!clipboardEntities.length)return;let ids=[];store.transact('paste',d=>{for(const src of clipboardEntities){const temp=new LevelDocumentStore(d);const n=temp.addEntity({...src,sourceMark:null,x:src.x+16,y:src.y+16,patrolX:(src.patrolX??src.x)+16,patrolY:(src.patrolY??src.y)+16,triggerX:src.triggerX+16,triggerY:src.triggerY+16,name:`${src.name} copy`});d.entities.push(n);ids.push(n.id)}});setSelection(ids.map(id=>({kind:'entity',id})));}
function nudgeSelection(dx,dy){if(!selection.length)return;store.transact('nudge',d=>{for(const s of selection){if(s.kind==='entity'){const e=d.entities.find(x=>x.id===s.id);if(e){e.x+=dx;e.y+=dy;e.patrolX=(e.patrolX??e.x-dx)+dx;e.patrolY=(e.patrolY??e.y-dy)+dy;e.triggerX+=dx;e.triggerY+=dy}}else if(s.kind==='hero'){d.heroStart.x+=dx;d.heroStart.y+=dy}else if(s.kind==='source'){const mark=Number(String(s.id).replace('mark:','')),placement=sourcePlacement(mark,d);setSourcePlacementInDocument(d,mark,placement.dx+dx,placement.dy+dy)}else if(s.kind==='stamp'){const dcx=Math.round(dx/16),dcy=Math.round(dy/16),p=d.stamps?.find(x=>x.id===s.id);if(p&&(dcx||dcy)){p.cell=[p.cell[0]+dcx,p.cell[1]+dcy];for(const t of d.terrain.filter(t=>t.stampOwner===s.id))t.cell=[t.cell[0]+dcx,t.cell[1]+dcy];for(const r of p.terrainRestore||[]){r.cell=[r.cell[0]+dcx,r.cell[1]+dcy];if(r.terrain?.cell)r.terrain.cell=[r.terrain.cell[0]+dcx,r.terrain.cell[1]+dcy];}}}}});if(selection.some(s=>s.kind==='source'))refreshNativeDraftRuntime();}

function frameView(mode='all'){if(!store)return;const shell=ui.viewport_scroll,pad=120,bounds=displayBounds(),widthZoom=(shell.clientWidth-pad)/bounds.width,heightZoom=(shell.clientHeight-pad)/bounds.height,target=mode==='width'?widthZoom:mode==='height'?heightZoom:Math.min(widthZoom,heightZoom),z=Math.min(ZOOMS.at(-1),Math.max(ZOOMS[0],target)),fits=ZOOMS.filter(value=>value<=z+1e-6);zoom=fits.at(-1)||ZOOMS[0];sizeStage();requestAnimationFrame(()=>{ui.viewport_scroll.scrollLeft=Math.max(0,(ui.scene_stage.offsetWidth-shell.clientWidth)/2);ui.viewport_scroll.scrollTop=Math.max(0,(ui.scene_stage.offsetHeight-shell.clientHeight)/2);renderNavigator()});}
function frameAll(){frameView('all');}
function frameWidth(){frameView('width');}
function frameHeight(){frameView('height');}
function changeZoom(dir){const i=ZOOMS.indexOf(zoom),next=ZOOMS[clamp(i+dir,0,ZOOMS.length-1)];if(next===zoom)return;const s=ui.viewport_scroll,cx=s.scrollLeft+s.clientWidth/2,cy=s.scrollTop+s.clientHeight/2,logicalX=cx/zoom,logicalY=cy/zoom;zoom=next;sizeStage();s.scrollLeft=logicalX*zoom-s.clientWidth/2;s.scrollTop=logicalY*zoom-s.clientHeight/2;scheduleRender();renderNavigator();}

function hasProjectileTopologyDraft(){return (store?.document?.sourceEntityOverrides||[]).some(row=>!!row.projectileShooterPresentation||Array.isArray(row.projectileEmitterOrigin)||['left','right'].includes(String(row.projectileLaneDirection||'')));}
function currentReviewedFixPlan(){
  return createReviewedFixPlan(store.document,{
    resolvedRoom:resolvedRoomFor(), mapDecoder:resources?.mapDecoder, stampCatalog:resources?.stampCatalog,
    heroStartChanged:heroStartChangedFromProduction()
  });
}
function updateDraftAuthorityStatus(){
  if(playtest.active||nativeSimulation.active||!store||store.document.base.blank)return;
  const plan=currentReviewedFixPlan(),blocked=plan.issues.find(issue=>issue.blocking);
  if(blocked)setParity(`Draft blocked · ${blocked.code}`,'error');
  else if(plan.corrections.length)setParity(`${plan.corrections.length} unsaved reviewed fix${plan.corrections.length===1?'':'es'} · native Playtest represented`,'ok');
  else setParity('ResolvedLevel linked · Simulate uses live xrick runtime','ok');
}
function currentNativeDraftPlan(){
  const d=store.document,logicDimensions=resources.mapDecoder.logicDimensions(d.base.mapId),mapping=resources.mapping.levelForSubmap(d.base.submap);
  return createNativeDraftPlan(d,{
    visualCellOverrides:effectiveTileOverrides(),
    collisionOverrides:effectiveCollisionOverrides(),
    sourceMarks:sourceEntityRows().map(row=>Number(row.mark)),
    logicDimensions,
    mapping,
    resolvedRoom:resolvedRoomFor(),
    mapDecoder:resources.mapDecoder
  });
}
function applyNativeDraft(){ return applyNativeDraftPlan(currentNativeDraftPlan(),bridge); }
function refreshNativeDraftRuntime(){rendererAuthorityKey='';if(playtest.active){stopPlaytest();return;}if(nativeSimulation.active)startNativeSimulation({preserveHistory:false});}
function cameraForHero(){const r=roomForSubmap(store.document.base.submap),runtime=resources.mapping.runtimeOffsetForSubmap(r.submap)||{dyPx:Number(r.runtimeDyPx||0)},reachable=bridge?.reachableStartRow?.(r.submap);if(!Number.isFinite(reachable))return Math.max(0,Number(r.classicStartRow||0));const cameraDelta=Math.round((Number(store.document.heroStart.y)-Number(runtime.dyPx||0)-96)/8);return clamp(Math.round(Number(reachable)-8+cameraDelta),0,255);}
function cameraForClassicWholeRoomY(y){const r=roomForSubmap(store.document.base.submap);return clamp(Math.round(Number(r?.classicStartRow||0)+(Number(y)-96)/8),0,255);}
function captureNativeSimulationProjectiles(){return captureNativeProjectileLifecycles({bridge,emitters:productionRoom()?.projectileEmitters||[],classicActors:productionRoom()?.classicActors||[],timeline:nativeSimulation.projectileTimeline,cameraFrowForClassicY:cameraForClassicWholeRoomY,applyDraft:applyNativeDraft,snapshot:nativeSimulationSnapshot,maxFrames:300});}
function nativeProjectileCaptureFailureSummary(result){const failures=result?.failed||[];if(!failures.length)return '';const shown=failures.slice(0,3).map(row=>`${row.bodySourceKey||row.sourceKey||'unknown'} carrier ${row.carrierSourceKey||'unknown'} ${row.reason}`);return `${shown.join('; ')}${failures.length>shown.length?`; +${failures.length-shown.length} more`:''}`;}
function applyPlaytestScale(){const scale=[1,2,4].includes(Number(ui.playtest_scale?.value))?Number(ui.playtest_scale.value):2;if(ui.playtest_canvas_wrap)ui.playtest_canvas_wrap.dataset.scale=String(scale);if(store?.document?.settings)store.document.settings.renderScale=scale;}
function setPlaytestCapture(captured){playtest.captured=!!captured;ui.playtest_canvas.classList.toggle('captured',playtest.captured);if(playtest.captured)ui.playtest_canvas.focus({preventScroll:true});}
function kickPlaytestLoop(reason='watchdog'){if(!bridge||!playtest.active)return;const now=performance.now();if(now-playtest.lastKickAt<250)return;playtest.lastKickAt=now;bridge.setFrontendPaused(false);bridge.resumeBrowserLoop();bridge.forceBrowserFrame();if(playtest.pending)ui.playtest_status.textContent=`Loading ${sm(playtest.pending.submap)} · ${reason}…`;}
function stopNativeSimulation({keepHistory=true,restart=false}={}){
  if(!nativeSimulation.active){nativeSimulation.geometry=null;bridge?.setEditorProjectileHitsNonlethal(false);if(!playtest.active)bridge?.setFrontendPaused(true);if(!keepHistory){nativeSimulation.timeline.reset();nativeSimulation.projectileTimeline.reset();}if(!timelineScrub)applyNativeRuntimeStates(new Map());return;}
  nativeSimulation.active=false;nativeSimulation.pending=null;nativeSimulation.geometry=null;nativeSimulation.lastSerial=-1;nativeSimulation.dogInspection.stop();bridge?.setFrontendPaused(true);bridge?.setSimulateAllTriggers(false);bridge?.setEditorProjectileHitsNonlethal(false);bridge?.setDebugControl(0);bridge?.setDebugInvincible(nativeSimulation.restoreInvincible);bridge?.setInfiniteResources(nativeSimulation.restoreResources);bridge?.setSoundMuted(nativeSimulation.restoreSoundMuted);bridge?.setCollisionPolicy(nativeSimulation.restoreCollisionPolicy);bridge?.clearMapEditorCollisionOverrides?.();bridge?.clearMapEditorVisualOverrides();bridge?.clearMapEditorEntities();bridge?.clearMapEditorTransitions();bridge?.restoreNativeWorldOriginal();bridge?.forceBrowserFrame();if(!keepHistory){nativeSimulation.timeline.reset();nativeSimulation.projectileTimeline.reset();}if(!timelineScrub)applyNativeRuntimeStates(new Map());if(restart&&store?.document?.settings?.simulatePreview)queueMicrotask(()=>startNativeSimulation({preserveHistory:keepHistory}));
}
function startNativeSimulation({preserveHistory=false}={}){
  if(!store?.document?.settings?.simulatePreview||playtest.active)return false;
  if(hasProjectileTopologyDraft()){store.document.settings.simulatePreview=false;if(ui.simulate_toggle)ui.simulate_toggle.checked=false;setParity('Projectile topology draft requires canonical promotion','error');toast('Projectile shooter/emitter/lane drafts are previewed independently in the editor, but xrick stays authoritative. Export Reviewed Fixes, promote and rebuild before native Simulate.','warn',7000);return false;}
  const authorityIssues=store.document.base.blank?[]:currentReviewedFixPlan().issues.filter(issue=>issue.blocking);
  if(authorityIssues.length){store.document.settings.simulatePreview=false;if(ui.simulate_toggle)ui.simulate_toggle.checked=false;switchInspector('validation');setParity('Draft is not representable in authoritative native Playtest','error');toast(authorityIssues[0].message,'error',6500);return false;}
  if(!bridge){store.document.settings.simulatePreview=false;if(ui.simulate_toggle)ui.simulate_toggle.checked=false;toast(runtimeFailure?.message||'Native xrick runtime is required for Simulate.','error',5000);return false;}
  if(!systemModificationsEnabled||hasRawRdxRegions()){store.document.settings.simulatePreview=false;if(ui.simulate_toggle)ui.simulate_toggle.checked=false;toast('Simulate uses effective ResolvedLevel data. Re-enable Effective layers before starting native simulation.','warn',5500);return false;}
  if(nativeSimulation.active)stopNativeSimulation({keepHistory:preserveHistory,restart:false});
  else nativeSimulation.dogInspection.stop();
  const snap=bridge.snapshot(),hero=deepClone(store.document.heroStart);nativeSimulation.restoreInvincible=!!snap.debug.invincible;nativeSimulation.restoreResources=!!snap.debug.infiniteResources;nativeSimulation.restoreSoundMuted=bridge.soundMuted();nativeSimulation.restoreCollisionPolicy=Number(snap.collision?.policy??COLLISION_RDX_DESCRIPTOR);nativeSimulation.active=true;nativeSimulation.pending={submap:Number(store.document.base.submap),generation:bridge.nativeWorldGeneration(),hero,camera:cameraForHero()};nativeSimulation.geometry=null;nativeSimulation.lastSerial=-1;nativeSimulation.tick=0;nativeSimulation.displayStates=new Map();if(!preserveHistory)nativeSimulation.timeline.reset();const runtimeSession=nativeSimulation.timeline.beginSession();nativeSimulation.projectileTimeline.beginSession(runtimeSession);
  nativeSimulation.timeline.setPhaseZeroAnchors(productionRoom()?.actors||[],{playerContact:hero,classicActors:productionRoom()?.classicActors||[]});bridge.setFrontendPaused(false);bridge.setEnabled(true);bridge.setClassicAssets(false);bridge.setCollisionPolicy(COLLISION_RDX_DESCRIPTOR);bridge.setSimulateAllTriggers(false);bridge.setEditorProjectileHitsNonlethal(false);bridge.setDebugControl(0);bridge.setDebugInvincible(true);bridge.setInfiniteResources(true);bridge.setSoundMuted(true);bridge.clearMapEditorCollisionOverrides?.();bridge.clearMapEditorVisualOverrides();bridge.clearMapEditorEntities();bridge.clearMapEditorTransitions();bridge.restoreNativeWorldOriginal();
  if(!bridge.selectSubmap(store.document.base.submap)){stopNativeSimulation({keepHistory:false,restart:false});toast(`Native simulation could not load ${sm(store.document.base.submap)}.`, 'error',5000);return false;}
  bridge.unpause();bridge.resumeBrowserLoop();bridge.forceBrowserFrame();setParity('Native simulation loading…','loading');return true;
}
function processPendingNativeSimulation(snap){
  const p=nativeSimulation.pending;if(!p||Number(snap.submap)!==Number(p.submap)||!snap.collision?.native?.worldLoaded)return false;const generation=bridge.nativeWorldGeneration();if(generation===p.generation)return false;
  bridge.setCollisionPolicy(COLLISION_RDX_DESCRIPTOR);
  if(!bridge.setCameraFrow(p.camera))throw new Error(`Native simulation camera rejected row ${p.camera}.`);
  applyNativeDraft();bridge.setCollisionPolicy(COLLISION_RDX_DESCRIPTOR);
  if(!bridge.teleportWorld(p.hero.x,p.hero.y,false))throw new Error(`Native simulation rejected editor hero start (${p.hero.x}, ${p.hero.y}).`);
  const v=bridge.snapshot().collision?.native||{};
  if(Number(v.playerWorldX)!==Math.round(p.hero.x)||Number(v.playerWorldY)!==Math.round(p.hero.y))throw new Error(`Native simulation hero parity failed: requested ${Math.round(p.hero.x)},${Math.round(p.hero.y)}; diagnostics mirror resolved ${v.playerWorldX},${v.playerWorldY}.`);
  bridge.setDebugControl(0);
  const projectileCapture=captureNativeSimulationProjectiles(),projectileWarning=nativeProjectileCaptureFailureSummary(projectileCapture);
  /* Off-bank projectile capture is supplemental whole-room evidence. The live
   * camera-resident xrick simulation remains authoritative, so one isolated
   * capture miss must not tear down Simulate or make an unrelated selection
   * look faulty. Checkpoint transaction failures still throw from the capture
   * helper because those can compromise restoration of the visible session. */
  const dogLoop=nativeSimulation.dogInspection.begin({bridge,actors:productionRoom()?.actors||[]});
  if(!dogLoop)bridge.setSimulateAllTriggers(true);
  bridge.setEditorProjectileHitsNonlethal(true);bridge.setFrontendPaused(false);bridge.forceBrowserFrame();
  nativeSimulation.geometry=mergeEditorNativeMotionGeometry(nativeSimulation.geometry,bridge.debugGeometry(1));nativeSimulation.pending=null;nativeSimulation.lastSerial=-1;
  setParity(`ResolvedLevel + live xrick simulation · ${projectileWarning?'off-bank projectile capture partial':'native projectile lifecycle'} + Layer-B whole-room motion projected${dogLoop?' · Castle dog sleep/run inspection loop':''}`,projectileWarning?'warn':'ok');
  if(projectileWarning)toast(`Native Simulate continued; off-bank projectile capture skipped: ${projectileWarning}.`,'warn',6500);
  return true;
}
/* The runtime fills its per-slot presentation audit during composition, not
 * during the gameplay tick. Simulate consumes that audit for the exact RDX
 * PN/origin, so materialize it before every sampled native frame. */
function nativeSimulationSnapshot(){if(bridge?.presentationReady())bridge.presentationFramebuffer();return bridge?.snapshot();}
function updateNativeSimulation(){
  if(!nativeSimulation.active||!bridge||playtest.active)return;
  try{let snap=nativeSimulationSnapshot();processPendingNativeSimulation(snap);if(nativeSimulation.pending)return;snap=nativeSimulationSnapshot();if(Number(snap.submap)!==Number(store.document.base.submap))return;if(snap.frameSerial===nativeSimulation.lastSerial)return;nativeSimulation.lastSerial=snap.frameSerial;nativeSimulation.geometry=mergeEditorNativeMotionGeometry(nativeSimulation.geometry,bridge.debugGeometry(1));const primaryStates=nativeSimulation.timeline.record(snap,snap.presentation),states=composeNativeSimulationStates(primaryStates,nativeSimulation.tick);const dogCycle=nativeSimulation.dogInspection.observe(primaryStates);if(dogCycle.restored)nativeSimulation.lastSerial=-1;nativeSimulation.tick+=1;tick=nativeSimulation.tick;const staticChanged=!timelineScrub&&applyNativeRuntimeStates(states);if(!gesture)(staticChanged?renderScene():renderActorsOnly());}
  catch(err){stopNativeSimulation({keepHistory:true,restart:false});store.document.settings.simulatePreview=false;if(ui.simulate_toggle)ui.simulate_toggle.checked=false;setParity('Native simulation error','error');toast(err.message,'error',6000);}
}
function startPlaytest(){
  if(nativeSimulation.active&&!playtest.active)stopNativeSimulation({keepHistory:true,restart:false});
  if(hasProjectileTopologyDraft()){toast('Projectile topology draft is not emulated in JavaScript or patched into xrick. Export Reviewed Fixes, promote and rebuild so Playtest uses the canonical native emitter/body topology.','warn',7000);return;}
  if(!systemModificationsEnabled){toast('Raw RDX mode is an inspection baseline. Enable Effective layers before playtest so the native runtime and editor use the same resolved authority.','warn',6000);return}
  if(hasRawRdxRegions()){toast('Raw RDX reset regions are inspection-only. Reapply Effective layers everywhere before playtest so the native runtime and editor use the same authority.','warn',6500);return}
  if(!bridge){toast(runtimeFailure?.message||'RDX descriptor/xrick WebAssembly runtime is not ready. Rebuild and serve the complete out/html5 bundle.','error',6000);return}
  const issues=validateCurrent().filter(i=>i.severity==='error');if(issues.length){switchInspector('validation');toast('Fix validation errors before RDX descriptor playtest.','error');return}
  stopPlaytest();
  const snap=bridge.snapshot();
  playtest.restoreInvincible=!!snap.debug.invincible;playtest.restoreResources=!!snap.debug.infiniteResources;playtest.restoreSoundMuted=bridge.soundMuted();playtest.restoreCollisionPolicy=Number(snap.collision?.policy??COLLISION_RDX_DESCRIPTOR);
  playtest.active=true;playtest.fault='';playtest.mask=0;playtest.lastSerial=-1;playtest.lastProgressSerial=snap.frameSerial;playtest.lastProgressAt=performance.now();playtest.lastKickAt=0;
  const hero=deepClone(store.document.heroStart);
  playtest.pending={submap:store.document.base.submap,generation:bridge.nativeWorldGeneration(),hero,camera:cameraForHero()};
  if(store.document.settings.simulatePreview){nativeSimulation.timeline.beginSession();nativeSimulation.timeline.setPhaseZeroAnchors(productionRoom()?.actors||[],{playerContact:hero,classicActors:productionRoom()?.classicActors||[]});nativeSimulation.lastSerial=-1;}
  ui.playtest_dock.hidden=false;setPlaytestCapture(true);applyPlaytestScale();
  bridge.setFrontendPaused(false);bridge.setEnabled(true);bridge.setClassicAssets(false);bridge.setCollisionPolicy(COLLISION_RDX_DESCRIPTOR);bridge.setSimulateAllTriggers(false);bridge.setEditorProjectileHitsNonlethal(false);bridge.setDebugControl(0);
  bridge.setDebugInvincible(ui.playtest_invulnerable.checked);bridge.setInfiniteResources(ui.playtest_resources.checked);bridge.setSoundMuted(!ui.playtest_sound.checked);if(ui.playtest_sound.checked)globalThis.xrickResumeAudio?.();
  bridge.clearMapEditorCollisionOverrides?.();bridge.clearMapEditorVisualOverrides();bridge.clearMapEditorEntities();bridge.clearMapEditorTransitions();bridge.restoreNativeWorldOriginal();
  if(!bridge.selectSubmap(store.document.base.submap)){playtest.fault=`RDX room ${sm(store.document.base.submap)} is unavailable.`;ui.playtest_status.textContent=playtest.fault;toast(playtest.fault,'error',5000);return}
  bridge.setCollisionPolicy(COLLISION_RDX_DESCRIPTOR);bridge.unpause();bridge.resumeBrowserLoop();bridge.forceBrowserFrame();
  ui.playtest_status.textContent=`Loading ${sm(store.document.base.submap)} with shared xrick solver + RDX descriptors…`;
}
function stopPlaytest(){if(!playtest.active)return;playtest.active=false;playtest.pending=null;playtest.mask=0;setPlaytestCapture(false);bridge?.setFrontendPaused(true);bridge?.setEditorProjectileHitsNonlethal(false);bridge?.setDebugControl(0);bridge?.setDebugInvincible(playtest.restoreInvincible);bridge?.setInfiniteResources(playtest.restoreResources);bridge?.setSoundMuted(playtest.restoreSoundMuted);bridge?.setCollisionPolicy(playtest.restoreCollisionPolicy);bridge?.clearMapEditorCollisionOverrides?.();bridge?.clearMapEditorVisualOverrides();bridge?.clearMapEditorEntities();bridge?.clearMapEditorTransitions();bridge?.restoreNativeWorldOriginal();bridge?.forceBrowserFrame();ui.playtest_dock.hidden=true;if(store?.document?.settings?.simulatePreview)queueMicrotask(()=>startNativeSimulation({preserveHistory:true}));}
function processPendingPlaytest(snap){
  if(!playtest.pending||snap.submap!==playtest.pending.submap||!snap.collision?.native?.worldLoaded)return;
  const generation=bridge.nativeWorldGeneration();if(generation===playtest.pending.generation)return;
  const p=playtest.pending;
  try{
    bridge.setCollisionPolicy(COLLISION_RDX_DESCRIPTOR);
    if(!bridge.setCameraFrow(p.camera))throw new Error(`RDX playtest camera rejected row ${p.camera}.`);
    applyNativeDraft();
    bridge.setCollisionPolicy(COLLISION_RDX_DESCRIPTOR);
    if(!bridge.teleportWorld(p.hero.x,p.hero.y,false))throw new Error(`Shared Rick checkpoint rejected RDX world start (${p.hero.x}, ${p.hero.y}). Check the room transform and Hero marker bounds.`);
    const v=bridge.snapshot().collision.native;
    if(Number(v.playerWorldX)!==Math.round(p.hero.x)||Number(v.playerWorldY)!==Math.round(p.hero.y))throw new Error(`Shared Rick checkpoint parity failed: requested ${Math.round(p.hero.x)},${Math.round(p.hero.y)}; diagnostics mirror resolved ${v.playerWorldX},${v.playerWorldY}.`);
    bridge.forceBrowserFrame();
    playtest.pending=null;playtest.lastProgressAt=performance.now();playtest.lastProgressSerial=bridge.snapshot().frameSerial;setPlaytestCapture(true);bridge.setDebugControl(playtest.mask);bridge.resumeBrowserLoop();
    ui.playtest_status.textContent=`Live · RDX descriptors + xrick · exact start ${p.hero.x}, ${p.hero.y} · controls captured`;setParity('Descriptor/xrick draft parity live','ok');
  }catch(err){playtest.pending=null;playtest.fault=err.message;playtest.mask=0;bridge.setDebugControl(0);setPlaytestCapture(false);ui.playtest_status.textContent=err.message;setParity('Parity/playtest error','error');toast(err.message,'error',5000)}
}
function renderPlaytestDebugOverlay(snapshot){
  if(!ui.playtest_debug?.checked)return;
  const model=buildDebugOverlayModel(snapshot,bridge,resources?.mapping);if(!model)return;
  const context=ctx.playtest;
  const line=(primitive,color,dash=[])=>{if(!primitive||!primitiveVisible(model.viewport,primitive))return;context.setLineDash(dash);context.strokeStyle=color;context.beginPath();context.moveTo(primitive.screenX0+.5,primitive.screenY0+.5);context.lineTo(primitive.screenX1+.5,primitive.screenY1+.5);context.stroke();};
  const box=(primitive,color,dash=[],label='')=>{if(!primitive||!primitiveVisible(model.viewport,primitive))return;const x=Math.min(primitive.screenX0,primitive.screenX1),y=Math.min(primitive.screenY0,primitive.screenY1),w=Math.max(1,Math.abs(primitive.screenX1-primitive.screenX0)+1),h=Math.max(1,Math.abs(primitive.screenY1-primitive.screenY0)+1);context.setLineDash(dash);context.strokeStyle=color;context.strokeRect(x+.5,y+.5,Math.max(1,w-1),Math.max(1,h-1));if(label){context.fillStyle='rgba(3,8,12,.82)';const tw=Math.ceil(context.measureText(label).width)+4;context.fillRect(x,Math.max(model.viewport.screenY,y-8),tw,8);context.fillStyle=color;context.fillText(label,x+2,Math.max(model.viewport.screenY+6,y-2));}};
  const actorColor=primitive=>{switch(primitive.flags&DebugPrimitiveFlag.CLASS_MASK){case DebugPrimitiveFlag.CLASS_T1A:return 'rgba(255,208,48,.92)';case DebugPrimitiveFlag.CLASS_T1B:return 'rgba(255,128,32,.92)';case DebugPrimitiveFlag.CLASS_T2:return 'rgba(200,88,255,.92)';case DebugPrimitiveFlag.CLASS_T3:return 'rgba(104,208,255,.9)';case DebugPrimitiveFlag.CLASS_PLATFORM:return 'rgba(48,236,255,.96)';case DebugPrimitiveFlag.CLASS_PROJECTILE:return 'rgba(255,255,255,.94)';case DebugPrimitiveFlag.CLASS_ONOFF:return 'rgba(255,88,176,.94)';default:return null;}};
  context.save();context.lineWidth=1;context.font='6px ui-monospace, monospace';context.textBaseline='alphabetic';
  for(const primitive of model.impenetrableWalls){const oneWay=!!(primitive.flags&DebugPrimitiveFlag.ONE_WAY);line(primitive,oneWay?'rgba(255,112,200,.72)':'rgba(255,48,80,.88)',oneWay?[2,2]:[]);}
  for(const primitive of model.walkableSurfaces){const oneWay=!!(primitive.flags&DebugPrimitiveFlag.ONE_WAY);line(primitive,oneWay?'rgba(255,208,64,.7)':'rgba(64,255,112,.62)',oneWay?[3,3]:[6,4]);}
  for(const primitive of model.superPadSurfaces||[])box(primitive,'rgba(85,230,255,.96)',[5,2],'super pad');
  for(const primitive of model.ladders)line(primitive,'rgba(56,168,255,.7)',[3,3]);
  for(const primitive of model.lethalSurfaces)box(primitive,'rgba(255,64,40,.86)',[1,2]);
  for(const primitive of model.hazards||[])box(primitive,'rgba(255,64,40,.96)',[2,2]);
  for(const primitive of model.triggers){const color=primitive.flags&DebugPrimitiveFlag.TRIGGER_DYNAMITE?'rgba(255,156,255,.9)':primitive.flags&DebugPrimitiveFlag.TRIGGER_BULLET?'rgba(255,156,64,.9)':'rgba(80,224,208,.84)';box(primitive,color,[3,3]);}
  for(const primitive of model.paths)line(primitive,actorColor(primitive)||'rgba(255,255,255,.86)');
  for(const primitive of model.patrols){const color=actorColor(primitive)||'rgba(255,208,48,.92)';line(primitive,color);if(primitiveVisible(model.viewport,primitive)){context.strokeStyle=color;context.setLineDash([]);for(const [x,y] of [[primitive.screenX0,primitive.screenY0],[primitive.screenX1,primitive.screenY1]]){context.beginPath();context.moveTo(x+.5,y-2.5);context.lineTo(x+.5,y+3.5);context.stroke();}}}
  for(const primitive of model.emitters){line(primitive,'rgba(255,72,40,.98)');if(primitiveVisible(model.viewport,primitive)){context.fillStyle='rgba(255,72,40,.98)';context.fillRect(Math.round(primitive.screenX0)-1,Math.round(primitive.screenY0)-1,3,3);}}
  for(const primitive of model.platformBodies)box(primitive,actorColor(primitive)||'rgba(48,236,255,.96)',[],'platform');
  for(const primitive of model.actorBoxes){const inactive=!!(primitive.flags&DebugPrimitiveFlag.INACTIVE),color=primitive.flags&DebugPrimitiveFlag.EXPLODABLE?'rgba(255,80,255,.9)':actorColor(primitive)||(primitive.flags&DebugPrimitiveFlag.SHOOTER?'rgba(255,106,48,.9)':inactive?'rgba(176,176,176,.65)':'rgba(255,176,32,.82)');box(primitive,color,inactive?[2,3]:[]);}
  for(const primitive of model.activationOrigins)box(primitive,actorColor(primitive)||'rgba(210,210,210,.86)',[2,2]);
  for(const primitive of model.collectibles)box(primitive,'rgba(128,255,176,.86)');
  for(const primitive of model.projectiles)box(primitive,actorColor(primitive)||'rgba(255,255,255,.92)');
  box(model.playerBox,'#00ffff',[],'Rick');
  const probeColor=primitive=>{switch(primitive.flags&DebugPrimitiveFlag.CLASS_MASK){case DebugPrimitiveFlag.PROBE_LEFT:case DebugPrimitiveFlag.PROBE_RIGHT:return 'rgba(255,176,64,.4)';case DebugPrimitiveFlag.PROBE_TOP:return 'rgba(255,96,224,.4)';case DebugPrimitiveFlag.PROBE_BOTTOM:return 'rgba(96,255,128,.4)';case DebugPrimitiveFlag.PROBE_CLIMB_TOP:case DebugPrimitiveFlag.PROBE_CLIMB_BOTTOM:return 'rgba(120,168,255,.48)';default:return 'rgba(255,255,255,.28)';}};
  for(const primitive of model.playerProbes||[]){const climb=(primitive.flags&DebugPrimitiveFlag.CLASS_MASK)>=DebugPrimitiveFlag.PROBE_CLIMB_TOP;line(primitive,probeColor(primitive),climb?[2,2]:[]);}
  context.setLineDash([]);context.restore();
}
function renderPlaytest(){if(!playtest.active||!bridge)return;try{let snap=bridge.snapshot();const now=performance.now();if(snap.frameSerial!==playtest.lastProgressSerial){playtest.lastProgressSerial=snap.frameSerial;playtest.lastProgressAt=now}else if(now-playtest.lastProgressAt>500){kickPlaytestLoop('runtime watchdog');snap=bridge.snapshot()}processPendingPlaytest(snap);if(playtest.pending)return;snap=bridge.snapshot();if(store?.document?.settings?.simulatePreview&&snap.frameSerial!==nativeSimulation.lastSerial){nativeSimulation.lastSerial=snap.frameSerial;const primaryStates=nativeSimulation.timeline.record(snap,snap.presentation),states=composeNativeSimulationStates(primaryStates,nativeSimulation.tick);nativeSimulation.tick=Math.max(0,nativeSimulation.tick+1);const staticChanged=!timelineScrub&&applyNativeRuntimeStates(states);if(!gesture)(staticChanged?renderScene():renderActorsOnly());}if(snap.frameSerial!==playtest.lastSerial){playtest.lastSerial=snap.frameSerial;if(snap.enabled&&bridge.presentationReady()&&!snap.presentationMode)ctx.playtest.putImageData(new ImageData(bridge.presentationFramebuffer(),320,200),0,0);else renderClassicFramebuffer(bridge,ctx.playtest,{transparentZero:false,playfieldShiftX:0,playfieldTop:RDX_PLAYFIELD.y});renderPlaytestDebugOverlay(snap);}}catch(err){ui.playtest_status.textContent=err.message}}
const CONTROL={RIGHT:1,LEFT:2,DOWN:4,UP:8,FIRE:16};const CONTROL_KEY={ArrowUp:8,ArrowDown:4,ArrowLeft:2,ArrowRight:1,Space:16,KeyO:8,KeyK:4,KeyZ:2,KeyX:1};
function playKey(code,down){const bit=CONTROL_KEY[code];if(!bit||!playtest.active||!playtest.captured)return false;playtest.mask=down?(playtest.mask|bit):(playtest.mask&~bit);bridge.setDebugControl(playtest.mask);if(down)kickPlaytestLoop('input');return true;}

function applySourceTimelineScrub(sourceKey,value,{refreshInspector=false}={}){
  const model=productionSourceTimeline(sourceKey);if(!model)return;const next=sourceTimelineTick(model,Number(value));timelineScrub={sourceKey,tick:next};tick=next;simulationClock.reset(next);simulationClock.setPaused(true);applyNativeRuntimeStates(simulationStatesAt(next,{pinSourceKey:sourceKey}));resources.preview.setActivateAllTraps(true);resources.previewE?.setActivateAllTraps(true);resources.classicPreview?.setActivateAllTraps(true);resources.rawPreview?.setActivateAllTraps(true);
  /* Keep the native range element alive while its thumb owns the pointer. A full
   * render would rebuild Inspector on every input event, terminating the browser's
   * native drag after the first tick. Dynamic actor rendering is sufficient for a
   * source trajectory scrub; rebuild Inspector only on the final change event. */
  renderActorsOnly();
  const tickLabel=ui.inspector_content.querySelector('[data-path-timeline-tick]'),originLabel=ui.inspector_content.querySelector('[data-path-timeline-origin]'),live=sourceSelectables.find(row=>String(row.sourceKey||'')===String(sourceKey));
  if(tickLabel)tickLabel.textContent=String(next);if(originLabel&&live&&Number.isFinite(Number(live.x))&&Number.isFinite(Number(live.y)))originLabel.textContent=`${Math.round(Number(live.x))}, ${Math.round(Number(live.y))}`;
  if(refreshInspector)renderInspector();
}
function convertSource(mark,{pnOverride=null,silent=false}={}){const src=sourceEntityRows().find(e=>Number(e.mark)===Number(mark)),sel=sourceSelectables.find(s=>s.sourceKey===`mark:${mark}`),semantic=resolvedSemanticForMark(mark);if(!src||!semantic)return;const placement=resolvedConvertedSourcePlacement(semantic),catalog=entityCatalogRow(src.entity),fallbackPn=Number(placement?.pn??sel?.pn??catalog?.pn??-1),assignedPn=pnOverride==null?sourcePresentationPn(mark,fallbackPn):Number(pnOverride),front=placement?.front==null?!!sel?.front:!!placement.front;let id;store.transact('convert-source',d=>{let o=d.sourceEntityOverrides.find(x=>x.mark===mark);if(!o){o={mark,suppressed:true};d.sourceEntityOverrides.push(o)}o.suppressed=true;const temp=new LevelDocumentStore(d),n=temp.addEntity({entity:src.entity,name:catalog?.name||`Mark ${mark}`,category:sel?.category||catalog?.category||'actor',x:Number(placement?.x),y:Number(placement?.y),patrolX:Number(placement?.x),patrolY:Number(placement?.y),triggerX:Number(placement?.triggerX),triggerY:Number(placement?.triggerY),flags:src.flags||catalog?.defaultFlags||0,latency:Number(src.latency??0),actionPeriod:1,pn:assignedPn,front,mirrorX:!!placement?.mirrorX,mirrorY:!!placement?.mirrorY,sourceMark:Number(mark)});d.entities.push(n);id=n.id});refreshNativeDraftRuntime();setSelection([{kind:'entity',id}]);if(!silent)toast(`Mark ${mark} is now an editable native instance at resolved contact ${placement?.x},${placement?.y}${assignedPn>=0?` using PN ${assignedPn}`:''}.`);return id;}
function inspectorChange(e){
  if(e.target.dataset.pathTimeline){applySourceTimelineScrub(String(e.target.dataset.pathTimeline),e.target.value,{refreshInspector:e.type==='change'});return;}
  if(e.target.id==='collision-brush-select'){activeCollision=e.target.value;return;}
  if(e.target.dataset.cellCollision){const [lx,ly]=e.target.dataset.cellCollision.split(',').map(Number);store.transact('cell-collision-property',d=>{const temp=new LevelDocumentStore(d);temp.setCollision(lx,ly,e.target.value);d.collision=temp.document.collision});renderInspector();return;}
  if(e.target.dataset.collisionSelection){const items=collisionSelections();store.transact('collision-selection-property',d=>{const temp=new LevelDocumentStore(d);for(const s of items){if(s.kind==='gameplay-collision')temp.setGameplayCollision(s.g8[0],s.g8[1],e.target.value);else temp.setCollision(s.logic[0],s.logic[1],e.target.value);}d.gameplayCollision=temp.document.gameplayCollision;d.collision=temp.document.collision});renderInspector();return;}
  const s=primarySelection();if(!s)return;
  const stateAxis=e.target.dataset.sourceStateAxis;
  if(stateAxis&&(s.kind==='source'||s.kind==='source-activator')){const mark=Number(String(s.id).replace('mark:','')),sourceKey=String(e.target.dataset.stateSourceKey||''),stateKey=String(e.target.dataset.stateKey||''),sourcePn=Number(e.target.dataset.stateSourcePn),state=sourcePresentationState(mark,sourceKey,stateKey,sourcePn);if(!state)return;const eff=effectiveStatePresentation(resolvedSemanticForMark(mark),sourceOverride(mark),state),origin=eff.origin.slice();origin[stateAxis==='x'?0:1]=Number(e.target.value);store.transact('source-state-presentation-origin',d=>setSourceStatePresentationInDocument(d,mark,state,{origin}));rendererAuthorityKey='';renderInspector();return;}
  if(s.kind==='entity'||s.kind==='activator'){
    const key=e.target.dataset.entityKey,bkey=e.target.dataset.entityBool,flag=e.target.dataset.entityFlag,occlusion=e.target.dataset.entityOcclusion;let assignmentChange=null;store.transact('entity-property',d=>{const ent=d.entities.find(x=>x.id===s.id);if(!ent)return;if(key){if(key==='name')ent[key]=e.target.value;else if(key==='entity')assignmentChange=assignNativeEntityType(ent,Number(e.target.value),resources?.entityCatalog);else{ent[key]=Number(e.target.value);if(key==='actionPeriod')ent[key]=clamp(Math.round(ent[key]||1),1,255);if(key==='latency')ent[key]=clamp(Math.round(ent[key]||0),0,255);}}if(bkey)ent[bkey]=e.target.checked;if(occlusion!=null)ent.front=e.target.value==='front';if(flag){const bit=Number(flag);ent.flags=e.target.checked?(ent.flags|bit):(ent.flags&~bit)}});if(assignmentChange?.nextRow){toast(`${assignmentChange.nextRow.hex} · ${assignmentChange.nextRow.name}${assignmentChange.remappedPn?` · mapped PN ${assignmentChange.newPn}`:` · custom PN ${assignmentChange.newPn} preserved`}.`)}renderDebugNoteDock();
  }else if(s.kind==='source'){
    const mark=Number(String(s.id).replace('mark:','')),key=e.target.dataset.inspectorKey,model=sourceEnemyAuthoring(mark);
    if(e.target.dataset.sourceEnemyType!==undefined&&model){const next=enemyEntityFor(model.parts?.kindBaseEntity??model.classicKind?.kindBaseEntity,e.target.value);if(next!=null)store.transact('source-enemy-type',d=>setSourceEnemyEntityInDocument(d,mark,next));refreshNativeDraftRuntime();rendererAuthorityKey='';renderInspector();return;}
    if(e.target.dataset.sourceEnemyKind!==undefined&&model){store.transact('source-enemy-kind',d=>setSourceEnemyKindInDocument(d,mark,e.target.value));refreshNativeDraftRuntime();rendererAuthorityKey='';renderInspector();return;}
    if(e.target.dataset.sourceMovingPlatformDirection!==undefined){const direction=String(e.target.value).toLowerCase();if(!['left','right'].includes(direction))return;store.transact('source-moving-platform-direction',d=>{const row=ensureSourceOverrideInDocument(d,mark);row.movingPlatformDirection=direction;pruneSourceOverrideInDocument(d,row)});rendererAuthorityKey='';renderInspector();return;}
    if(key&&key.startsWith('enemyPatrol')&&model){const patrol=deepClone(model.patrol||defaultEnemyPatrolForSource({source:model.source,classicData:resources.classic,manifest:resources.manifest,submap:d.base.submap,kindBaseEntity:model.parts?.kindBaseEntity}));if(!patrol)return;const value=Math.round(Number(e.target.value)||0);if(key==='enemyPatrolStartX')patrol.start[0]=value;else if(key==='enemyPatrolEndX')patrol.end[0]=value;else if(key==='enemyPatrolY'){patrol.start[1]=value;patrol.end[1]=value}else if(key==='enemyPatrolLatency')patrol.startupLatencyTicks=clamp(value,0,255);let normalized=normalizeEnemyPatrol(patrol);if(!normalized&&['enemyPatrolStartX','enemyPatrolEndX'].includes(key)){const direction=patrol.end[0]<patrol.start[0]?-1:1,span=Math.max(2,Math.round(Math.abs(patrol.end[0]-patrol.start[0])/2)*2);patrol.end[0]=patrol.start[0]+direction*span;normalized=normalizeEnemyPatrol(patrol);}if(!normalized){toast('Bounded patrol must be horizontal with a positive even-pixel span.','warn');renderInspector();return;}store.transact('source-enemy-patrol',d=>setSourceEnemyPatrolInDocument(d,mark,normalized));refreshNativeDraftRuntime();rendererAuthorityKey='';renderInspector();return;}
    if(key==='sourcePlacementX'||key==='sourcePlacementY'){const placement=sourcePlacement(mark);store.transact('source-placement-property',d=>setSourcePlacementInDocument(d,mark,key==='sourcePlacementX'?Number(e.target.value):placement.dx,key==='sourcePlacementY'?Number(e.target.value):placement.dy));refreshNativeDraftRuntime();renderInspector();}
  }
  else if(s.kind==='hero'){const key=e.target.dataset.inspectorKey;if(key==='heroX'||key==='heroY')store.transact('hero-property',d=>d.heroStart[key==='heroX'?'x':'y']=Number(e.target.value))}
  else if(s.kind==='layer'){const key=e.target.dataset.layerBool;if(key)store.transact('layer-property',d=>d.layers[s.id][key]=e.target.checked)}
}
function inspectorClick(e){
  const pathStop=e.target.closest('[data-path-stop-tick]');if(pathStop){const s=primarySelection();if(s?.kind!=='source')return;applySourceTimelineScrub(String(s.id),Number(pathStop.dataset.pathStopTick),{refreshInspector:true});return;}
  const mode=e.target.closest('[data-collision-mode]');if(mode){collisionMode=mode.dataset.collisionMode;renderInspector();return;}
  const authoring=e.target.closest('[data-collision-authoring]');if(authoring){collisionAuthoring=authoring.dataset.collisionAuthoring==='descriptor'?'descriptor':'gameplay';activeCollision=collisionAuthoring==='gameplay'?'open':'solid';setSelection([]);renderEditorOverlay();renderInspector();updateToolHint();return;}
  const spriteToggle=e.target.closest('[data-sprite-picker-toggle]');if(spriteToggle){const picker=spriteToggle.closest('[data-sprite-picker]'),menu=picker?.querySelector('.sprite-picker-menu'),opening=!!menu?.hidden;if(menu)menu.hidden=!opening;spriteToggle.setAttribute('aria-expanded',opening?'true':'false');if(opening)requestAnimationFrame(()=>renderPnThumbs(menu));return;}
  const pnChoice=e.target.closest('[data-pn-choice]');if(pnChoice){const picker=pnChoice.closest('[data-sprite-picker]'),pn=Number(pnChoice.dataset.pnChoice),s=primarySelection();if(picker?.dataset.spritePicker==='source-state'&&(s?.kind==='source'||s?.kind==='source-activator')){const mark=Number(String(s.id).replace('mark:','')),sourceKey=String(picker.dataset.stateSourceKey||''),stateKey=String(picker.dataset.stateKey||''),sourcePn=Number(picker.dataset.stateSourcePn),state=sourcePresentationState(mark,sourceKey,stateKey,sourcePn);if(state){store.transact('source-state-presentation-sprite',d=>setSourceStatePresentationInDocument(d,mark,state,{pn}));refreshNativeDraftRuntime()}rendererAuthorityKey='';renderInspector()}else if(picker?.dataset.spritePicker==='source'&&s?.kind==='source'){const mark=Number(String(s.id).replace('mark:',''));store.transact('source-sprite-property',d=>{let o=d.sourceEntityOverrides.find(x=>Number(x.mark)===mark);if(pn>=0){if(!o){o={mark,suppressed:false};d.sourceEntityOverrides.push(o)}o.presentationPn=pn}else if(o){delete o.presentationPn;pruneSourceOverrideInDocument(d,o)}});refreshNativeDraftRuntime();rendererAuthorityKey='';renderInspector()}else if(picker?.dataset.spritePicker==='entity'&&s?.kind==='entity'){store.transact('entity-sprite-property',d=>{const ent=d.entities.find(x=>x.id===s.id);if(ent){ent.pn=pn;ent.frameIndex=-1}});refreshNativeDraftRuntime();renderInspector()}return;}
  const frameChoice=e.target.closest('[data-frame-choice]');if(frameChoice){const s=primarySelection(),frameIndex=Number(frameChoice.dataset.frameChoice);if(s?.kind==='entity')store.transact('entity-frame-property',d=>{const ent=d.entities.find(x=>x.id===s.id);if(ent)ent.frameIndex=frameIndex});renderInspector();return;}
  const a=e.target.closest('[data-action]');if(a){const s=primarySelection();if(a.dataset.action==='depth-backdrop'){setSelectedPresentationDepth('backdrop');return}else if(a.dataset.action==='depth-midground'){setSelectedPresentationDepth('midground');return}else if(a.dataset.action==='depth-foreground'){setSelectedPresentationDepth('foreground');return}else if(a.dataset.action==='depth-revert'){revertSelectedPresentationDepth();return}else if(a.dataset.action==='depth-class-backdrop'){setSelectedPresentationDepthClass('backdrop');return}else if(a.dataset.action==='depth-class-midground'){setSelectedPresentationDepthClass('midground');return}else if(a.dataset.action==='depth-class-foreground'){setSelectedPresentationDepthClass('foreground');return}else if(a.dataset.action==='depth-class-inherit'){revertSelectedPresentationDepthClass();return}else if(a.dataset.action==='depth-select-matching'){selectMatchingPresentationCells();return}else if(a.dataset.action==='depth-show-occurrences'){selectMatchingPresentationCells({announce:true});return}else if(['toggle-state-component','solo-state-component'].includes(a.dataset.action)&&(s?.kind==='source'||s?.kind==='source-activator')){const mark=Number(String(s.id).replace('mark:','')),semantic=resolvedSemanticForMark(mark),sourceKey=String(a.dataset.componentSourceKey||''),componentId=statefulComponentIdentity(semantic,sourceKey);forcedPresentationState=null;if(a.dataset.action==='toggle-state-component')componentInspection.toggle(componentId);else componentInspection.solo(componentId);rendererAuthorityKey='';scheduleRender();renderInspector();return}else if(['preview-source-state','revert-source-state'].includes(a.dataset.action)&&(s?.kind==='source'||s?.kind==='source-activator')){const mark=Number(String(s.id).replace('mark:','')),sourceKey=String(a.dataset.stateSourceKey||''),stateKey=String(a.dataset.stateKey||''),sourcePn=Number(a.dataset.stateSourcePn),state=sourcePresentationState(mark,sourceKey,stateKey,sourcePn);if(state&&a.dataset.action==='preview-source-state'){forcedPresentationState={mark,...state};rendererAuthorityKey='';scheduleRender();renderInspector()}else if(state){store.transact('revert-source-state',d=>revertSourceStatePresentationInDocument(d,mark,state));refreshNativeDraftRuntime();rendererAuthorityKey='';scheduleRender();renderInspector()}return}else if(a.dataset.action==='resume-state-preview'){forcedPresentationState=null;rendererAuthorityKey='';scheduleRender();renderInspector();return}else if(a.dataset.action==='resume-source-timeline'){clearTimelineScrub();scheduleRender();renderInspector();return}else if(a.dataset.action==='edit-activator'&&s?.kind==='entity'){setSelection([{kind:'activator',id:s.id}]);centerSelectionItem({kind:'activator',id:s.id});return}else if(a.dataset.action==='select-connected-entity'&&s?.kind==='activator'){setSelection([{kind:'entity',id:s.id}]);centerSelectionItem({kind:'entity',id:s.id});return}else if(a.dataset.action==='select-source-actor'&&s?.kind==='source-activator'){const item={kind:'source',id:s.id,sourceKey:s.id};setSelection([item]);centerSelectionItem(item);return}else if(a.dataset.action==='convert-source-activator'&&s?.kind==='source-activator'){const id=convertSource(Number(s.id.split(':')[1]),{silent:true});if(id){const item={kind:'activator',id};setSelection([item]);centerSelectionItem(item);toast(`Mark ${s.id.split(':')[1]} converted; activator is editable.`)}return}else if(a.dataset.action==='revert-source-enemy'&&s?.kind==='source'){const mark=Number(s.id.split(':')[1]);store.transact('revert-source-enemy',d=>revertSourceEnemyAuthoringInDocument(d,mark));refreshNativeDraftRuntime();rendererAuthorityKey='';renderInspector();return}else if(a.dataset.action==='reset-hero-start'&&s?.kind==='hero'){store.transact('reset-hero-start',d=>{const baseline=productionDocument(roomForSubmap(d.base.submap)).heroStart;d.heroStart={x:Number(baseline?.x||0),y:Number(baseline?.y||0)}});renderInspector();return}else if((a.dataset.action==='source-occlusion-behind')&&s?.kind==='source'){const mark=Number(s.id.split(':')[1]);store.transact('source-occlusion-behind',d=>setSourceOcclusionInDocument(d,mark,'behind-midground'));renderInspector();return}else if((a.dataset.action==='source-occlusion-normal'||a.dataset.action==='source-occlusion-down')&&s?.kind==='source'){const mark=Number(s.id.split(':')[1]);store.transact('source-occlusion-normal',d=>setSourceOcclusionInDocument(d,mark,'normal'));renderInspector();return}else if((a.dataset.action==='source-occlusion-front'||a.dataset.action==='source-occlusion-up')&&s?.kind==='source'){const mark=Number(s.id.split(':')[1]);store.transact('source-occlusion-front',d=>setSourceOcclusionInDocument(d,mark,'front'));renderInspector();return}else if(a.dataset.action==='revert-source-occlusion'&&s?.kind==='source'){const mark=Number(s.id.split(':')[1]);store.transact('revert-source-occlusion',d=>setSourceOcclusionInDocument(d,mark,null));renderInspector();return}else if(s?.kind==='terrain-relation'&&a.dataset.action==='remove-support'){store.transact('remove-support',d=>d.terrainRelations=d.terrainRelations.filter(r=>r.id!==s.id));setSelection([]);return}else if(s?.kind==='terrain-relation'&&a.dataset.action==='support-alternatives'){finalizeSupportRelation(s.id,{offerChoices:true});return}else if(s?.kind==='stamp'&&a.dataset.action==='stamp-alternatives'){finalizeStampPlacement(s.id,{offerChoices:true});return}else if(s?.kind==='stamp'&&a.dataset.action==='select-stamp'){const placement=store.document.stamps.find(t=>t.id===s.id),family=stampFamilyById(resources.stampCatalog,placement?.familyId)||familyForStamp(resources.stampCatalog,placement?.variantId||placement?.stampId);if(family){selectedStamp=family;setTileAuthoringMode('stamp');renderStampLibrary();setTool('brush')}return}else if(s?.kind==='stamp'&&a.dataset.action==='remove-stamp'){store.transact('remove-stamp',d=>{const temp=new LevelDocumentStore(d);temp.removeStamp(s.id);d.stamps=temp.document.stamps;d.terrain=temp.document.terrain});setSelection([]);return}else if(s?.kind==='terrain'&&a.dataset.action==='shuffle-terrain'){store.transact('shuffle-terrain',d=>{const cell=d.terrain.find(t=>t.id===s.id);if(cell)cell.seed=(Number(cell.seed||0)+1)>>>0});renderInspector();return}else if(s?.kind==='terrain'&&a.dataset.action==='select-terrain-set'){const cell=store.document.terrain.find(t=>t.id===s.id),set=terrainSetById(resources.autotileCatalog,cell?.terrainSet);if(set){selectedTerrainSet=set;setTileAuthoringMode('terrain');renderTerrainLibrary();setTool('brush')}return}else if(s?.kind==='terrain'&&a.dataset.action==='remove-terrain'){store.transact('remove-terrain',d=>d.terrain=d.terrain.filter(t=>t.id!==s.id));setSelection([]);return}else if(a.dataset.action==='delete-entity')deleteSelection();else if(a.dataset.action==='duplicate-entity')duplicateSelection();else if(a.dataset.action==='use-mapped-sprite'&&s?.kind==='entity'){const ent=store.document.entities.find(x=>x.id===s.id),cat=entityCatalogRow(ent?.entity);if(cat?.pn>=0){store.transact('entity-mapped-sprite',d=>{const row=d.entities.find(x=>x.id===s.id);if(row){row.pn=cat.pn;row.frameIndex=-1}});refreshNativeDraftRuntime()}}else if(a.dataset.action==='convert-source'&&s?.kind==='source')convertSource(Number(s.id.split(':')[1]));else if(a.dataset.action==='revert-source-sprite'&&s?.kind==='source'){const mark=Number(s.id.split(':')[1]);store.transact('revert-source-sprite',d=>{const o=d.sourceEntityOverrides.find(x=>Number(x.mark)===mark);if(o){delete o.presentationPn;pruneSourceOverrideInDocument(d,o)}});refreshNativeDraftRuntime();renderInspector()}else if(a.dataset.action==='revert-source-placement'&&s?.kind==='source'){const mark=Number(s.id.split(':')[1]);store.transact('revert-source-placement',d=>setSourcePlacementInDocument(d,mark,0,0));refreshNativeDraftRuntime();renderInspector()}else if(a.dataset.action==='revert-source-moving-platform-direction'&&s?.kind==='source'){const mark=Number(s.id.split(':')[1]);store.transact('revert-source-moving-platform-direction',d=>{const row=d.sourceEntityOverrides.find(x=>Number(x.mark)===mark);if(row){delete row.movingPlatformDirection;pruneSourceOverrideInDocument(d,row)}});rendererAuthorityKey='';renderInspector()}else if(a.dataset.action==='suppress-source'&&s?.kind==='source'){store.transact('suppress-source',d=>{const mark=Number(s.id.split(':')[1]);let r=d.sourceEntityOverrides.find(x=>x.mark===mark);if(!r){r={mark,suppressed:true};d.sourceEntityOverrides.push(r)}r.suppressed=true});setSelection([])}else if(a.dataset.action==='revert-tile'&&s?.kind==='tile'){store.transact('revert-tile',d=>d.tiles=d.tiles.filter(t=>t.id!==s.id));setSelection([])}else if(a.dataset.action==='revert-collision-selection'){const items=collisionSelections();store.transact('revert-collision-selection',d=>{const temp=new LevelDocumentStore(d);for(const row of items){if(row.kind==='gameplay-collision')temp.setGameplayCollision(row.g8[0],row.g8[1],'original');else temp.setCollision(row.logic[0],row.logic[1],'original');}d.gameplayCollision=temp.document.gameplayCollision;d.collision=temp.document.collision});renderInspector()}else if(s?.kind==='cell'&&['replace-cell','clear-cell','revert-cell'].includes(a.dataset.action)){const layer=s.layer||selectedLayerPlane();if(a.dataset.action==='replace-cell'&&!selectedTile){toast('Choose a source tile in Library first.','warn');return}store.transact(a.dataset.action,d=>{const temp=new LevelDocumentStore(d);if(a.dataset.action==='revert-cell')temp.eraseTile(s.gx,s.gy,layer);else if(a.dataset.action==='clear-cell')temp.paintTile(s.gx,s.gy,{layer,operation:'clear'});else temp.paintTile(s.gx,s.gy,{layer,sourceMapId:selectedTile.sourceMapId,sourceX:selectedTile.x,sourceY:selectedTile.y,sourceLayer:selectedTile.sourceLayer});d.tiles=temp.document.tiles})}else if(a.dataset.action==='add-transition'){const rooms=resources.manifest.rooms,target=rooms.find(r=>Number(r.submap)>Number(store.document.base.submap))||rooms[0]||roomForSubmap(store.document.base.submap);store.transact('add-transition',d=>d.transitions.push({id:`transition-${Date.now().toString(36)}`,side:'right',contactRow:Number(roomForSubmap(d.base.submap)?.classicStartRow||0)+0x10,targetSubmap:Number(target.submap),rowIn:Number(target.classicStartRow||0)+0x10,entryX:4,entryY:128,entryFrow:Number(target.classicStartRow||0)}));renderLevelSettings()}}
  const r=e.target.closest('[data-remove-transition]');if(r){const i=Number(r.dataset.removeTransition);store.transact('remove-transition',d=>d.transitions.splice(i,1));renderLevelSettings()}}

function levelSettingChange(e){
  const key=e.target.dataset.levelKey,setting=e.target.dataset.setting,sbool=e.target.dataset.settingBool,meta=e.target.dataset.meta;
  const ti=e.target.dataset.transitionIndex,tk=e.target.dataset.transitionKey;
  if(ti!==undefined&&tk){store.transact('transition-property',d=>{const t=d.transitions[Number(ti)];if(!t)return;t[tk]=tk==='side'?e.target.value:Number(e.target.value);if(tk==='side'&&t[tk]==='left'&&Number(t.entryX)===4)t.entryX=226;if(tk==='side'&&t[tk]==='right'&&Number(t.entryX)===226)t.entryX=4;});renderLevelSettings();return;}
  if(key)store.transact('level-property',d=>{if(key==='name'){d.name=e.target.value;ui.level_name.value=d.name}else d.bounds[key]=Math.max(16,Math.floor(Number(e.target.value)/16)*16)});
  else if(setting)store.transact('setting',d=>d.settings[setting]=Number(e.target.value));
  else if(sbool)store.transact('setting',d=>d.settings[sbool]=e.target.checked);
  else if(meta)store.transact('metadata',d=>d.metadata[meta]=e.target.value);
}


function deleteChangeRow(button){
  if(!button)return;const row=button.closest('[data-change-kind]'),kind=row?.dataset.changeKind,id=row?.dataset.changeId,docId=row?.dataset.changeDocId; if(!kind)return;
  store.transact('delete-change',d=>{if(kind==='terrain')d.terrain=d.terrain.filter(x=>x.id!==id);else if(kind==='terrain-relation')d.terrainRelations=d.terrainRelations.filter(x=>x.id!==id);else if(kind==='stamp'){const temp=new LevelDocumentStore(d);temp.removeStamp(id);d.stamps=temp.document.stamps;d.terrain=temp.document.terrain}else if(kind==='collision')d.collision=d.collision.filter(x=>docId?x.id!==docId:!(Number(x.logic?.[0])===Number(row.dataset.changeLx)&&Number(x.logic?.[1])===Number(row.dataset.changeLy)));else if(kind==='gameplay-collision')d.gameplayCollision=(d.gameplayCollision||[]).filter(x=>docId?x.id!==docId:!(Number(x.g8?.[0])===Number(row.dataset.changeGx)&&Number(x.g8?.[1])===Number(row.dataset.changeGy)));else if(kind==='cell')d.tiles=d.tiles.filter(x=>docId?x.id!==docId:!(x.layer===(row.dataset.changeLayer||'B')&&Number(x.target?.[0])===Number(row.dataset.changeGx)&&Number(x.target?.[1])===Number(row.dataset.changeGy)));else if(kind==='presentation-depth')d.presentationDepthOverrides=(d.presentationDepthOverrides||[]).filter(x=>x.id!==docId);else if(kind==='presentation-depth-class-edit')d.presentationDepthClassEdits=(d.presentationDepthClassEdits||[]).filter(x=>x.id!==docId);else if(kind==='entity')d.entities=d.entities.filter(x=>x.id!==id);else if(kind==='source'){const mark=Number(String(id).split(':')[1]);d.sourceEntityOverrides=d.sourceEntityOverrides.filter(x=>Number(x.mark)!==mark)}else if(kind==='system-patch-removal')d.systemPatchRemovals=d.systemPatchRemovals.filter(x=>docId?x.id!==docId:x.id!==id);else if(kind==='transition')d.transitions=d.transitions.filter(x=>x.id!==id)});
  if(selection.some(s=>s.kind===kind&&s.id===id))setSelection([]);toast('Change deleted. Undo is available.');
}
function focusChangeRow(button){
  if(!button)return;const kind=button.dataset.changeKind;
  if(kind==='collision'){const lx=Number(button.dataset.changeLx),ly=Number(button.dataset.changeLy);setTool('collision');collisionMode='select';setSelection([collisionSelectionItem(lx,ly)]);centerOnLogical((lx-1)*16+8,(ly-1)*16+8);return;}
  if(kind==='gameplay-collision'){const gx=Number(button.dataset.changeGx),gy=Number(button.dataset.changeGy);collisionAuthoring='gameplay';setTool('collision');collisionMode='select';setSelection([gameplayCollisionSelectionItem(gx,gy)]);centerOnLogical(gx*8+4,gy*8+4);return;}
  if(kind==='terrain'){const cx=Number(button.dataset.changeCx),cy=Number(button.dataset.changeCy),cell=store.terrainAt(cx,cy);if(cell){setTileAuthoringMode('terrain');setTool('select');setSelection([{kind:'terrain',id:cell.id,cx,cy}]);centerOnLogical(cx*16+8,cy*16+8)}return;}if(kind==='terrain-relation'){const r=store.document.terrainRelations?.find(x=>x.id===button.dataset.changeId);if(r){setTileAuthoringMode('terrain');setTool('select');setSelection([{kind:'terrain-relation',id:r.id}]);centerOnLogical(r.anchor[0]*16+8,r.anchor[1]*16+8)}return;}if(kind==='stamp'){const placement=store.document.stamps?.find(x=>x.id===button.dataset.changeId);if(placement){setTileAuthoringMode('stamp');setTool('select');setSelection([{kind:'stamp',id:placement.id}]);centerOnLogical(placement.cell[0]*16+8,placement.cell[1]*16+8)}return;}
  if(kind==='cell'){const gx=Number(button.dataset.changeGx),gy=Number(button.dataset.changeGy),layer=button.dataset.changeLayer||'B';setTool('select');setActiveLayer(layer==='A'?'foreground':'background');setSelection([{kind:'cell',id:`${layer}:${gx}:${gy}`,gx,gy,layer}]);centerOnLogical(gx*8+4,gy*8+4);return;}
  if(kind==='presentation-depth'){const id=button.dataset.changeId,item={kind:'presentation-depth',id};setTool('select');setSelectMode('foreground');setSelection([item]);centerSelectionItem(item);return;}
  if(kind==='presentation-depth-class-edit'){const plane=String(button.dataset.changeLayer||'B').toUpperCase(),globalTile=Number(button.dataset.changeGlobalTile),items=matchingPresentationCells({plane,globalTile});if(items.length){setTool('select');setActiveLayer(plane==='A'?'foreground':'background');setSelection(items);centerOnLogical(items[0].gx*8+4,items[0].gy*8+4)}else toast(`No Plane ${plane} occurrences of global tile ${globalTile} in this room.`,'warn');return;}
  if(kind==='entity'){const e=store.document.entities.find(x=>x.id===button.dataset.changeId);if(e){setTool('select');setSelection([{kind:'entity',id:e.id}]);centerOnLogical(e.x,e.y)}return;}
  if(kind==='source'){const id=button.dataset.changeId,item={kind:'source',id,sourceKey:id};setTool('select');setSelection([item]);centerSelectionItem(item);return;}
  if(kind==='scenery'){const id=button.dataset.changeId,item={kind:'scenery',id,sourceKey:id};setTool('select');setSelection([item]);centerSelectionItem(item);return;}
  if(kind==='system-patch-removal'){const patch=reviewedVisualPatchById(button.dataset.changePatchId);if(patch?.bounds){switchLeftTab('diagnostics');diagnostics.view='draft';diagnostics.filter='all';const rows=currentDiagnosticRows(),target=rows.find(row=>String(row.debugId||'')===`editor-patch:system-patch-removal:${patch.id}`);if(target)selectDiagnosticItem({debugRow:target,elementId:target.debugId,sourceKey:target.sourceKey,bounds:target.bounds},{center:true});else centerOnLogical(Number(patch.bounds[0])+Number(patch.bounds[2])/2,Number(patch.bounds[1])+Number(patch.bounds[3])/2);}return;}
  if(kind==='transition'){switchInspector('level');return;}
}
function selectTileVariant(button){
  if(!button||!selectedTile)return;selectedTile={...selectedTile,x:Number(button.dataset.tileVariantX),y:Number(button.dataset.tileVariantY)};ui.selected_tile_label.textContent=`${md(selectedTile.sourceMapId)} · ${selectedTile.sourceLayer} · g8 ${selectedTile.x},${selectedTile.y} · detected ${button.dataset.tileVariantRotation||0}° variant`;renderTilePalette();
}
function exportStem(){return store.document.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'rdx-level';}
function heroStartChangedFromProduction(){const baseline=productionDocument(roomForSubmap(store.document.base.submap)).heroStart,current=store.document.heroStart;return Number(current.x)!==Number(baseline.x)||Number(current.y)!==Number(baseline.y);}
function changesEntityContexts(){
  const contexts={};
  for(const entity of store.document.entities || []){
    const nativeHeight=Number(entityCatalogRow(entity.entity)?.defaultHeight||21),rendered=entityFrame(entity,0,null);
    const reviewedPlacement=editorEntityPlacementSnapshot(entity,rendered,nativeHeight);
    let productionBaseline=null;
    if(entity.sourceMark!=null){
      productionBaseline=resolvedEntityBaselineContext(resolvedSemanticForMark(entity.sourceMark));
    }
    const delta=productionBaseline?{
      contact:[Number(entity.x)-Number(productionBaseline.contact[0]),Number(entity.y)-Number(productionBaseline.contact[1])],
      trigger:[Number(entity.triggerX)-Number(productionBaseline.trigger[0]),Number(entity.triggerY)-Number(productionBaseline.trigger[1])],
      pn:Number(entity.pn)-Number(productionBaseline.presentation?.pn ?? entity.pn)
    }:null;
    contexts[String(entity.id)]={
      ...(entity.sourceMark!=null?{sourceMark:Number(entity.sourceMark)}:{}),
      ...(productionBaseline?{productionBaseline}:{}),
      reviewedPlacement,
      ...(delta?{deltaFromProduction:delta}:{})
    };
  }
  return contexts;
}
function closeExportMenu(){if(!ui.export_menu)return;ui.export_menu.hidden=true;ui.export_level?.setAttribute('aria-expanded','false');}
function toggleExportMenu(){if(!ui.export_menu)return;const open=ui.export_menu.hidden;ui.export_menu.hidden=!open;ui.export_level?.setAttribute('aria-expanded',open?'true':'false');if(open)ui.export_menu.querySelector('[data-export-mode]')?.focus();}
function exportEditorArtifact(mode='implementation'){
  if(!store)return;const stem=exportStem();
  if(mode==='changes'){download(`${stem}-changes.json`,exportChangesJson(store.document,{heroStartChanged:heroStartChangedFromProduction(),entityContexts:changesEntityContexts()}));toast('Compact manual changes exported for code implementation.','ok');}
  else if(mode==='reviewed-fixes'){
    const plan=currentReviewedFixPlan();
    if(!plan.nativePlaytestSupported){closeExportMenu();switchInspector('validation');toast(plan.issues.find(issue=>issue.blocking)?.message||'Draft cannot be promoted as reviewed fixes.','error',6500);return;}
    download(`${stem}-reviewed-fixes.json`,exportReviewedFixesJson(store.document,{resolvedRoom:resolvedRoomFor(),mapDecoder:resources.mapDecoder,stampCatalog:resources.stampCatalog,heroStartChanged:heroStartChangedFromProduction()}));
    toast(`Reviewed fixes exported (${plan.corrections.length} new). Promote with npm run level:promote -- <file>.`,'ok',5200);
  }
  else if(mode==='layer-draft'){download(`${stem}-layer-draft.json`,exportLayeredDraftJson(store.document,{resolvedRoom:resolvedRoomFor()}));toast('Advanced C-F layer draft exported. Use only for production-only edits that cannot be hot-applied.','ok',4500);}
  else{download(`${stem}-implementation.json`,exportImplementationJson(store.document,{nativeDraftPlan:currentNativeDraftPlan()}));savedHash=hashDoc(store.document);markDirty();toast('Current implementation exported with the editor document and exact native draft plan.','ok');}
  closeExportMenu();
}
function importEditorArtifact(payload){
  if(payload?.schema===LEVEL_EDITOR_IMPLEMENTATION_SCHEMA)return implementationEditorDocument(payload);
  if(payload?.schema===LEVEL_EDITOR_CHANGES_SCHEMA)throw new Error('Changes-only exports are compact implementation handoffs, not complete Level Editor documents. Import the Current implementation export instead.');
  if(payload?.schema===REVIEWED_CORRECTIONS_SCHEMA)throw new Error('Reviewed-fix exports are canonical promotion handoffs, not complete Level Editor documents.');
  if(payload?.schema===LEVEL_LAYER_DRAFT_SCHEMA)throw new Error('Layer drafts are canonical D-F promotion handoffs, not complete Level Editor documents.');
  return payload;
}

function bindUI(){
  ui.level_name.addEventListener('change',()=>store.transact('rename',d=>d.name=ui.level_name.value.trim()||'Untitled level'));
  const openAdjacentRoom=delta=>{const rooms=resources.manifest.rooms||[],index=rooms.findIndex(row=>Number(row.submap)===Number(store.document.base.submap)),next=rooms[index+Number(delta)];if(!next)return;openDocument(productionDocument(next));toast(`Opened ${sm(next.submap)} · ${md(next.mapId)}.`);};
  ui.new_level.addEventListener('click',()=>ui.new_level_dialog.showModal());ui.previous_room?.addEventListener('click',()=>openAdjacentRoom(-1));ui.open_room.addEventListener('click',()=>{renderRoomGrid();ui.open_room_dialog.showModal()});ui.next_room?.addEventListener('click',()=>openAdjacentRoom(1));ui.reset_rdx.addEventListener('click',resetSelectionOrMap);
  ui.import_level.addEventListener('click',()=>ui.import_file.click());ui.import_file.addEventListener('change',async()=>{const f=ui.import_file.files?.[0];if(!f)return;try{openDocument(importEditorArtifact(JSON.parse(await f.text())));toast(`Imported ${f.name}.`)}catch(err){toast(err.message,'error',5000)}finally{ui.import_file.value=''}});
  ui.export_level.addEventListener('click',e=>{e.stopPropagation();toggleExportMenu();});ui.export_menu.addEventListener('click',e=>{const b=e.target.closest('[data-export-mode]');if(!b)return;e.preventDefault();e.stopPropagation();exportEditorArtifact(b.dataset.exportMode);});document.addEventListener('click',e=>{if(!ui.export_control.contains(e.target))closeExportMenu();});
  ui.validate_level.addEventListener('click',()=>{renderValidation();switchInspector('validation');const e=validateCurrent().filter(x=>x.severity==='error').length;toast(e?`${e} blocking document/host issue${e===1?'':'s'} found.`:'Document + host checks complete. Use Simulate/Diagnostics for gameplay and visual parity. ',e?'error':'ok',4200)});ui.run_checks.addEventListener('click',()=>{renderValidation();toast('Document + host checks refreshed.','ok',2200)});
  ui.play_level.addEventListener('click',startPlaytest);ui.restart_playtest.addEventListener('click',startPlaytest);ui.stop_playtest.addEventListener('click',stopPlaytest);
  ui.playtest_sound.addEventListener('change',()=>{store.document.settings.soundPlaytest=ui.playtest_sound.checked;if(playtest.active){bridge.setSoundMuted(!ui.playtest_sound.checked);if(ui.playtest_sound.checked)globalThis.xrickResumeAudio?.()}});ui.playtest_debug.addEventListener('change',()=>{if(playtest.active){playtest.lastSerial=-1;renderPlaytest();}});ui.playtest_invulnerable.addEventListener('change',()=>{store.document.settings.invulnerablePlaytest=ui.playtest_invulnerable.checked;if(playtest.active)bridge.setDebugInvincible(ui.playtest_invulnerable.checked)});ui.playtest_resources.addEventListener('change',()=>{store.document.settings.infiniteResources=ui.playtest_resources.checked;if(playtest.active)bridge.setInfiniteResources(ui.playtest_resources.checked)});ui.playtest_scale.addEventListener('change',()=>{applyPlaytestScale();saveLocal()});
  ui.playtest_canvas.addEventListener('pointerdown',()=>{if(playtest.active){setPlaytestCapture(true);if(ui.playtest_sound.checked)globalThis.xrickResumeAudio?.();kickPlaytestLoop('canvas focus')}});
  ui.tool_buttons.addEventListener('click',e=>{const b=e.target.closest('[data-tool]');if(!b)return;if(b.dataset.tool==='select'&&tool==='select'){cycleSelectToolMode();return}if(b.dataset.tool==='scissors'&&tool==='scissors'){cycleSmartScissorsMode();return}setTool(b.dataset.tool,{editSelection:b.dataset.tool==='entity'});});ui.undo.addEventListener('click',()=>store.undo());ui.redo.addEventListener('click',()=>store.redo());
  ui.simulate_toggle.addEventListener('change',()=>{timelineScrub=null;store.transact('simulate-preview',d=>d.settings.simulatePreview=ui.simulate_toggle.checked);resources.preview.setActivateAllTraps(ui.simulate_toggle.checked);resources.previewE?.setActivateAllTraps(ui.simulate_toggle.checked);resources.classicPreview?.setActivateAllTraps(ui.simulate_toggle.checked);resources.rawPreview?.setActivateAllTraps(ui.simulate_toggle.checked);simulationClock.setPaused(true);if(ui.simulate_toggle.checked)startNativeSimulation();else stopNativeSimulation({keepHistory:true,restart:false});scheduleRender();});ui.presentation_view_toggle?.addEventListener('click',()=>{if(diagnosticLayerStage())return;previewPresentation=previewPresentation==='rdx'?'classic':'rdx';scheduleRender();});
  ui.snap_toggle.addEventListener('change',()=>store.transact('snap',d=>d.settings.snap=ui.snap_toggle.checked));ui.grid_toggle.addEventListener('change',renderEditorOverlay);ui.system_modifications_toggle.addEventListener('change',()=>{if(ui.system_modifications_toggle.checked&&hasRawRdxRegions())store.transact('reapply-system-changes',d=>d.settings.rawRdxRegions=[]);setSystemModificationsEnabled(ui.system_modifications_toggle.checked,{notify:true});});ui.zoom_in.addEventListener('click',()=>changeZoom(1));ui.zoom_out.addEventListener('click',()=>changeZoom(-1));ui.frame_width.addEventListener('click',frameWidth);ui.frame_height.addEventListener('click',frameHeight);
  document.querySelectorAll('[data-quick-layer]').forEach(b=>b.addEventListener('click',()=>{const key=b.dataset.quickLayer,l=store.document.layers[key];if(!l)return;if(key==='background'||key==='foreground')setActiveLayer(key);store.transact('layer-visibility',d=>d.layers[key].visible=!d.layers[key].visible);b.classList.toggle('active',store.document.layers[key].visible)}));
  ui.depth_preview_mode?.addEventListener('change',()=>{depthPreviewMode=ui.depth_preview_mode.value||'full';depthView=depthPreviewMode==='split';if(depthPreviewMode==='seed'){setTool('select');setSelectMode('background')}scheduleRender();renderChrome();});
  ui.depth_view_toggle?.addEventListener('click',()=>{const active=depthPreviewMode==='split'||depthPreviewMode==='seed'||depthView;depthPreviewMode=active?'full':'split';depthView=!active;if(!active){setTool('select');setSelectMode('all')}scheduleRender();renderChrome();});
  ui.collision_overlay_toggle.addEventListener('click',()=>{ui.collision_overlay_toggle.classList.toggle('active');renderEditorOverlay()});
  document.querySelectorAll('[data-left-tab]').forEach(b=>b.addEventListener('click',()=>switchLeftTab(b.dataset.leftTab)));
  ui.diagnostics_views.addEventListener('click',e=>{const b=e.target.closest('[data-diagnostic-view]');if(!b)return;diagnostics.view=b.dataset.diagnosticView;if(diagnostics.view==='shift')diagnostics.shiftMode='heatmap';diagnostics.selectedId='';diagnostics.selectedItem=null;diagnostics.alignmentCell=null;diagnostics.instanceIndex=-1;rendererAuthorityKey='';updateToolHint();scheduleRender();renderDiagnosticsWorkspace()});
  ui.diagnostics_shift_modes?.addEventListener('click',e=>{const b=e.target.closest('[data-shift-mode]');if(!b)return;diagnostics.shiftMode=b.dataset.shiftMode==='vectors'?'vectors':'heatmap';scheduleRender();renderDiagnosticsWorkspace();});
  ui.diagnostics_layer_stages?.addEventListener('click',e=>{const b=e.target.closest('[data-layer-stage]');if(!b||!DIAGNOSTIC_LAYER_STAGES[b.dataset.layerStage])return;diagnostics.layerStage=b.dataset.layerStage;rendererAuthorityKey='';scheduleRender();renderDiagnosticsWorkspace();});
  ui.diagnostics_filters.addEventListener('click',e=>{const b=e.target.closest('[data-diagnostic-filter]');if(!b)return;diagnostics.filter=b.dataset.diagnosticFilter;diagnostics.selectedId='';diagnostics.selectedItem=null;diagnostics.instanceIndex=-1;renderDiagnosticsWorkspace();renderEditorOverlay()});
  ui.diagnostics_geometry_toggle.addEventListener('change',()=>{diagnostics.geometry=ui.diagnostics_geometry_toggle.checked;renderDiagnosticsWorkspace();renderEditorOverlay()});
  ui.diagnostics_unresolved_toggle.addEventListener('change',()=>{diagnostics.unresolved=ui.diagnostics_unresolved_toggle.checked;rendererAuthorityKey='';scheduleRender();renderDiagnosticsWorkspace()});
  ui.diagnostics_trajectory_toggle.addEventListener('change',()=>{diagnostics.trajectories=ui.diagnostics_trajectory_toggle.checked;renderDiagnosticsWorkspace();renderEditorOverlay()});
  ui.diagnostics_clear_selection.addEventListener('click',clearDiagnosticSelection);ui.diagnostics_instance_type.addEventListener('change',()=>{diagnostics.instanceType=ui.diagnostics_instance_type.value;diagnostics.instanceIndex=-1;diagnostics.selectedId='';diagnostics.selectedItem=null;renderDiagnosticsWorkspace();renderEditorOverlay()});
  ui.diagnostics_prev.addEventListener('click',()=>navigateDiagnosticInstance(-1));ui.diagnostics_next.addEventListener('click',()=>navigateDiagnosticInstance(1));
  ui.diagnostics_queue.addEventListener('click',e=>{const b=e.target.closest('[data-diagnostic-id]');if(!b)return;const item=findDiagnosticById(b.dataset.diagnosticId);if(item)selectDiagnosticItem(item,{center:true})});ui.diagnostics_inspector.addEventListener('click',e=>handleDiagnosticAction(e.target.closest('[data-diagnostic-action]')));
  document.querySelectorAll('[data-library-tab]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-library-tab]').forEach(x=>x.classList.toggle('active',x===b));ui.tile_library.classList.toggle('active',b.dataset.libraryTab==='tiles');ui.entity_library.classList.toggle('active',b.dataset.libraryTab==='entities')}));
  document.querySelectorAll('[data-inspector-tab]').forEach(b=>b.addEventListener('click',()=>b.dataset.inspectorTab==='diagnostics'?switchLeftTab('diagnostics'):switchInspector(b.dataset.inspectorTab)));ui.level_settings_button.addEventListener('click',()=>switchInspector('level'));
  ui.library_search.addEventListener('input',()=>{librarySearch=ui.library_search.value;renderEntityLibrary();renderTerrainLibrary();renderStampLibrary()});document.querySelectorAll('[data-tile-authoring]').forEach(b=>b.addEventListener('click',()=>setTileAuthoringMode(b.dataset.tileAuthoring)));ui.terrain_catalog.addEventListener('click',e=>{const card=e.target.closest('[data-terrain-set]');if(!card)return;selectedTerrainSet=terrainSetById(resources.autotileCatalog,card.dataset.terrainSet);setTileAuthoringMode('terrain');renderTerrainLibrary();setTool('brush')});ui.stamp_categories?.addEventListener('click',e=>{const b=e.target.closest('[data-stamp-category]');if(!b)return;stampCategory=b.dataset.stampCategory;renderStampLibrary();});ui.stamp_catalog.addEventListener('click',e=>{const elementCard=e.target.closest('[data-stamp-element]');if(elementCard){const element=stampElementById(resources.stampCatalog,elementCard.dataset.stampElement);if(!element)return;selectedStampElement=element;selectedTile={kind:'element8',elementId:element.id,outputs:stampElementOutputs(element).map(output=>({...output,sourceCell:output.sourceCell.slice()}))};setTileAuthoringMode('stamp');setActiveLayer(stampElementOutputs(element).some(output=>output.layer==='A')?'foreground':'background');renderStampLibrary();setTool('brush');return}const card=e.target.closest('[data-stamp-family]');if(!card)return;selectedStampElement=null;selectedStamp=stampFamilyById(resources.stampCatalog,card.dataset.stampFamily);setTileAuthoringMode('stamp');renderStampLibrary();setTool('brush')});ui.terrain_collision_mode.addEventListener('change',()=>store.transact('terrain-behavior',d=>d.settings.terrainCollisionMode=ui.terrain_collision_mode.value));ui.terrain_assist_ambiguity?.addEventListener('change',()=>store.transact('terrain-assistant',d=>d.settings.terrainAssistAmbiguity=ui.terrain_assist_ambiguity.checked));ui.autotile_debug_toggle.addEventListener('change',()=>{autotileDebug=ui.autotile_debug_toggle.checked;renderEditorOverlay()});ui.tile_source_map.addEventListener('change',renderTilePalette);ui.tile_source_plane.addEventListener('change',()=>{selectedTile=null;ui.selected_tile_label.textContent='No source selected';renderTilePalette();renderInspector();});ui.terrain_choice_options?.addEventListener('click',e=>{const support=e.target.closest('[data-support-prototype]'),stampButton=e.target.closest('[data-stamp-variant]');if(support){const relationId=ui.terrain_choice_dialog.dataset.relationId,prototypeId=support.dataset.supportPrototype;if(!relationId||!prototypeId)return;store.transact('choose-support-construction',d=>{const r=d.terrainRelations?.find(v=>v.id===relationId);if(r)r.prototypeId=prototypeId});setSelection([{kind:'terrain-relation',id:relationId}]);rendererAuthorityKey='';scheduleRender();renderInspector();ui.terrain_choice_dialog.close();return}if(stampButton){const placementId=ui.terrain_choice_dialog.dataset.stampPlacementId,variantId=stampButton.dataset.stampVariant;if(!placementId||!variantId)return;store.transact('choose-stamp-variant',d=>{const temp=new LevelDocumentStore(d),placement=temp.document.stamps.find(v=>v.id===placementId),variant=stampById(resources.stampCatalog,variantId);if(placement&&variant)applyStampVariant(temp,placement,variant);d.stamps=temp.document.stamps;d.terrain=temp.document.terrain});setSelection([{kind:'stamp',id:placementId}]);rendererAuthorityKey='';scheduleRender();renderInspector();ui.terrain_choice_dialog.close();}});ui.terrain_choice_dialog?.addEventListener('close',()=>{if(ui.terrain_choice_dont_ask?.checked&&store.document.settings.terrainAssistAmbiguity!==false){store.transact('terrain-assistant',d=>d.settings.terrainAssistAmbiguity=false);ui.terrain_assist_ambiguity.checked=false;}ui.terrain_choice_dont_ask.checked=false;delete ui.terrain_choice_dialog.dataset.relationId;delete ui.terrain_choice_dialog.dataset.stampPlacementId;delete ui.terrain_choice_dialog.dataset.stampFamilyId;});
  ui.tile_palette.addEventListener('pointerdown',e=>{const r=ui.tile_palette.getBoundingClientRect(),sx=ui.tile_palette.width/r.width,sy=ui.tile_palette.height/r.height,px=(e.clientX-r.left)*sx,py=(e.clientY-r.top)*sy,mapId=Number(ui.tile_source_map.value),mode=rawSourceMode(),keepScissors=tool==='scissors'&&smartScissorsMode==='repair'&&!rawCellMode(mode);if(rawCellMode(mode)){const cx=Math.floor(px/16),cy=Math.floor(py/16),sel=rawSmartSelection(mapId,cx,cy,mode);if(!sel){toast(`That source cell is not ${mode==='COMPOSITE'?'an A+B composite':mode==='SAFE_B'?'B-only':mode==='SAFE_A'?'A-only':'a visible presentation cell'}.`,'warn');return;}selectedTile=sel;const info=rawCellInfo(mapId).cells.get(`${cx},${cy}`);ui.selected_tile_label.textContent=`${md(mapId)} · c16 ${cx},${cy} · ${rawCellDisplayLabel(info)}`;}else{const x=Math.floor(px/8),y=Math.floor(py/8);selectedTile={kind:'raw8',sourceMapId:mapId,sourceLayer:mode,x,y};setActiveLayer(mode==='A'?'foreground':'background');ui.selected_tile_label.textContent=`${md(mapId)} · ${mode} · g8 ${x},${y}`;}setTileAuthoringMode('raw');renderTilePalette();if(keepScissors){updateToolHint();renderEditorOverlay();}else setTool('brush')});
  ui.smart_scissors_options?.addEventListener('click',e=>{const button=e.target.closest('[data-smart-scissors-candidate]');if(!button||!smartScissorsSession)return;smartScissorsSession.selectedIndex=Number(button.dataset.smartScissorsCandidate)||0;renderSmartScissorsDialog();});
  ui.smart_scissors_seed_toggle?.addEventListener('change',()=>{if(!smartScissorsSession||smartScissorsSession.kind==='move')return;smartScissorsSession.useSeed=!!smartScissorsSession.seed&&ui.smart_scissors_seed_toggle.checked;try{smartScissorsSession.candidates=rankSmartScissorsSession(smartScissorsSession);smartScissorsSession.selectedIndex=0;renderSmartScissorsDialog();}catch(error){toast(error.message,'error',4200)}});
  ui.smart_scissors_apply?.addEventListener('click',applySmartScissors);
  ui.smart_scissors_dialog?.addEventListener('close',()=>{smartScissorsSession=null;});
  ui.tile_rotation_variants.addEventListener('click',e=>selectTileVariant(e.target.closest('[data-tile-variant-x]')));
  ui.entity_categories.addEventListener('click',e=>{const b=e.target.closest('[data-entity-category]');if(b){entityCategory=b.dataset.entityCategory;renderEntityLibrary()}});ui.entity_catalog.addEventListener('click',e=>{const c=e.target.closest('[data-entity-type]');if(!c)return;selectedEntityType=resources.entityCatalog.entities.find(x=>x.entity===Number(c.dataset.entityType));entityPlacementArmed=true;renderDebugNoteDock();setTool('entity');renderEntityLibrary()});
  ui.entity_catalog.addEventListener('dragstart',e=>{const c=e.target.closest('[data-entity-type]');if(!c)return;draggedEntityType=resources.entityCatalog.entities.find(x=>x.entity===Number(c.dataset.entityType))||null;if(!draggedEntityType)return;selectedEntityType=draggedEntityType;entityPlacementArmed=false;e.dataTransfer?.setData('application/x-rdr-entity',String(draggedEntityType.entity));e.dataTransfer?.setData('text/plain',`rdr-entity:${draggedEntityType.entity}`);if(e.dataTransfer)e.dataTransfer.effectAllowed='copy';ui.scene_stage.dataset.droppable='true';renderEntityLibrary();});
  ui.entity_catalog.addEventListener('dragend',()=>{draggedEntityType=null;delete ui.scene_stage.dataset.droppable;});
  ui.scene_stage.addEventListener('dragenter',e=>{if(draggedEntityType||e.dataTransfer?.types?.includes('application/x-rdr-entity')){e.preventDefault();ui.scene_stage.dataset.droppable='true';}});
  ui.scene_stage.addEventListener('dragover',e=>{if(draggedEntityType||e.dataTransfer?.types?.includes('application/x-rdr-entity')){e.preventDefault();if(e.dataTransfer)e.dataTransfer.dropEffect='copy';ui.scene_stage.dataset.droppable='true';}});
  ui.scene_stage.addEventListener('dragleave',e=>{if(!ui.scene_stage.contains(e.relatedTarget))delete ui.scene_stage.dataset.droppable;});
  ui.scene_stage.addEventListener('drop',e=>{e.preventDefault();const raw=e.dataTransfer?.getData('application/x-rdr-entity')||e.dataTransfer?.getData('text/plain')||'';const n=draggedEntityType?.entity??Number(String(raw).replace('rdr-entity:',''));const type=resources.entityCatalog.entities.find(x=>x.entity===Number(n));draggedEntityType=null;delete ui.scene_stage.dataset.droppable;if(!type)return;setTool('entity');entityPlacementArmed=false;addEntityAt(stagePoint(e),type,{keepPlacement:false});});
  ui.copy_selection_id?.addEventListener('click',copySelectionReference);
  ui.scene_tree.addEventListener('click',e=>{const pvis=e.target.closest('[data-presentation-visible]');if(pvis){const k=pvis.dataset.presentationVisible;if(k in presentationVisibility){presentationVisibility[k]=presentationVisibility[k]===false;scheduleRender();renderSceneTree()}return}const solo=e.target.closest('[data-presentation-solo]');if(solo){const k=solo.dataset.presentationSolo;if(k==='actors'){depthPreviewMode='actors';presentationVisibility.embeddedActors=true;presentationVisibility.actors=true;presentationVisibility.frontActors=true}else{depthPreviewMode=k;presentationVisibility[k]=true}depthView=false;scheduleRender();renderChrome();return}const vis=e.target.closest('[data-layer-visible]');if(vis){const k=vis.dataset.layerVisible;store.transact('visibility',d=>d.layers[k].visible=!d.layers[k].visible);return}const lock=e.target.closest('[data-layer-lock]');if(lock){const k=lock.dataset.layerLock;store.transact('lock',d=>d.layers[k].locked=!d.layers[k].locked);return}const row=e.target.closest('[data-scene-kind]');if(!row)return;const kind=row.dataset.sceneKind,id=row.dataset.sceneId;let item=null;if(kind==='layer'){item={kind,id};setSelection([item]);if(id==='background'||id==='foreground')setActiveLayer(id)}else if(kind==='depth-group'){depthPreviewMode=id;depthView=false;scheduleRender();renderChrome();return}else if(kind==='actor-group'){depthPreviewMode=id==='embeddedActors'?'embeddedActors':id==='actors'?'actors':'frontActors';depthView=false;scheduleRender();renderChrome();return}else if(kind==='entity'||kind==='activator'){item={kind,id};setSelection([item])}else if(kind==='source'||kind==='source-activator'||kind==='scenery'){item={kind,id,sourceKey:id};setSelection([item])}else if(kind==='native-transition'){item={kind,id};setSelection([item])}else if(kind==='presentation-depth'){item={kind,id};setSelection([item]);setTool('select');const depthRow=presentationDepthRowForSelection(item);setSelectMode(depthRow?.plane==='B'?'background':'foreground')}else if(kind==='presentation-depth-class'){item={kind,id};setSelection([item])}else if(kind==='hero'){item={kind:'hero',id:'hero'};setSelection([item])}if(item&&kind!=='layer')centerSelectionItem(item)});
  ui.changes_list.addEventListener('click',e=>{const del=e.target.closest('[data-delete-change]');if(del){e.preventDefault();e.stopPropagation();deleteChangeRow(del);return}focusChangeRow(e.target.closest('[data-change-kind]'))});
  ui.save_debug_note.addEventListener('click',addDebugNote);ui.download_debug_notes.addEventListener('click',downloadDebugNotes);ui.debug_note_input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();addDebugNote()}});
  ui.inspector_content.addEventListener('input',e=>{if(e.target.dataset.pathTimeline)inspectorChange(e)});ui.inspector_content.addEventListener('change',inspectorChange);ui.inspector_content.addEventListener('click',inspectorClick);ui.level_settings.addEventListener('change',levelSettingChange);ui.level_settings.addEventListener('click',inspectorClick);
  ui.viewport_scroll.addEventListener('scroll',renderNavigator);ui.viewport_scroll.addEventListener('wheel',e=>{if(!(e.ctrlKey||e.metaKey))return;e.preventDefault();changeZoom(e.deltaY<0?1:-1)},{passive:false});ui.viewport_scroll.addEventListener('pointerdown',viewportBackgroundPointerDown);ui.scene_stage.addEventListener('pointerdown',stagePointerDown);ui.scene_stage.addEventListener('pointerleave',()=>{ui.scene_stage.style.cursor='';if(!gesture){clearHoverCell();ui.cursor_readout.textContent='x — · y —';}});addEventListener('pointermove',stagePointerMove);addEventListener('pointerup',stagePointerUp);addEventListener('pointercancel',()=>{viewportBackgroundClick=null;ui.scene_stage.style.cursor='';});
  ui.new_host.addEventListener('change',()=>{const r=roomForSubmap(Number(ui.new_host.value)),dim=resources.mapDecoder.dimensions(r.mapId);ui.new_width.value=String(dim.width);ui.new_height.value=String(dim.height)});
  ui.create_level.addEventListener('click',e=>{e.preventDefault();const r=roomForSubmap(Number(ui.new_host.value));const doc=ui.new_mode.value==='blank'?createBlankDocument(r,ui.new_name.value||'New level',Number(ui.new_width.value),Number(ui.new_height.value)):productionDocument(r);if(ui.new_mode.value!=='blank')doc.name=ui.new_name.value||doc.name;openDocument(doc);ui.new_level_dialog.close();toast('New level created.')});
  ui.room_search.addEventListener('input',()=>renderRoomGrid(ui.room_search.value));ui.room_grid.addEventListener('click',e=>{const b=e.target.closest('[data-open-submap]');if(!b)return;openDocument(productionDocument(roomForSubmap(Number(b.dataset.openSubmap))));ui.open_room_dialog.close();toast('Production room opened as a non-destructive draft.')});
}

function bindKeyboard(){addEventListener('keydown',e=>{if(playKey(e.code,true)){e.preventDefault();return}if(e.code==='Escape'&&!ui.export_menu.hidden){e.preventDefault();closeExportMenu();ui.export_level.focus();return}if(e.code==='Escape'&&tool==='scissors'&&smartScissorsMode!=='repair'&&smartScissorsTransferSelection){e.preventDefault();smartScissorsTransferSelection=null;updateToolHint();renderEditorOverlay();return}if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;if(e.code==='Space'){spaceHeld=true;ui.scene_stage.dataset.spacePan='true';e.preventDefault();return}const mod=e.ctrlKey||e.metaKey;if(mod&&e.code==='KeyZ'){e.preventDefault();e.shiftKey?store.redo():store.undo();return}if(mod&&e.code==='KeyY'){e.preventDefault();store.redo();return}if(mod&&e.code==='KeyS'){e.preventDefault();exportEditorArtifact('implementation');return}if(mod&&e.code==='KeyC'){e.preventDefault();if(diagnostics.active){if(diagnostics.geometryCells.length)copyDiagnosticText(diagnostics.geometryCells.map(cell=>cell.id).join('\n'),'Geometry ID copied');else if(diagnostics.selectedItem)copyDiagnosticText(diagnosticItemId(diagnostics.selectedItem),'Stable diagnostic ID copied');}else copySelection();return}if(mod&&e.code==='KeyV'){e.preventDefault();if(!diagnostics.active)pasteSelection();return}if(mod&&e.code==='KeyD'){e.preventDefault();if(!diagnostics.active)duplicateSelection();return}if(mod&&e.code==='KeyN'){e.preventDefault();ui.new_level.click();return}if(e.code==='Delete'||e.code==='Backspace'){e.preventDefault();diagnostics.active?clearDiagnosticSelection():deleteSelection();return}if(e.code==='KeyP'){e.preventDefault();startPlaytest();return}const tools={KeyV:'select',KeyH:'hand',KeyB:'brush',KeyR:'rectangle',KeyS:'scissors',KeyG:'fill',KeyI:'eyedropper',KeyC:'collision',KeyE:'entity',KeyX:'erase'};if(tools[e.code]){if(e.code==='KeyV')setSelectMode('object');if(e.code==='KeyS'&&tool==='scissors')cycleSmartScissorsMode();else setTool(tools[e.code],{editSelection:tools[e.code]==='entity'});return}if(e.code==='KeyF'){frameAll();return}if(diagnostics.active){if(e.code==='ArrowLeft')navigateDiagnosticInstance(-1);else if(e.code==='ArrowRight')navigateDiagnosticInstance(1);return}const sourceSelected=selection.some(item=>item.kind==='source'),step=sourceSelected?1:(store.document.settings.snap?(store.document.settings.gridSize||8):1);if(e.code==='ArrowLeft')nudgeSelection(-step,0);else if(e.code==='ArrowRight')nudgeSelection(step,0);else if(e.code==='ArrowUp')nudgeSelection(0,-step);else if(e.code==='ArrowDown')nudgeSelection(0,step)});addEventListener('keyup',e=>{if(playKey(e.code,false)){e.preventDefault();return}if(e.code==='Space'){spaceHeld=false;delete ui.scene_stage.dataset.spacePan;e.preventDefault()}});addEventListener('blur',()=>{spaceHeld=false;delete ui.scene_stage.dataset.spacePan;if(playtest.active){playtest.mask=0;bridge?.setDebugControl(0)}});}

function levelEditorWebMcpState() {
  if (!store) throw new Error('Level Editor is not ready');
  return {
    document: store.snapshot(),
    selection: deepClone(selection),
    tool,
    selectMode,
    activeLayer,
    previewPresentation,
    systemModificationsEnabled,
    diagnostics: {
      active: diagnostics.active,
      view: diagnostics.view,
      filter: diagnostics.filter,
      selectedId: diagnostics.selectedId || null,
      classicRdxShift: diagnostics.view === 'shift',
      shiftCellId: diagnostics.alignmentCell?.id || null
    },
    playtestActive: !!playtest.active
  };
}

function updateEditorEntity(entityId, patch) {
  if (!store) throw new Error('Level Editor is not ready');
  const numericFields = new Set(['entity','x','y','patrolX','patrolY','triggerX','triggerY','flags','latency','actionPeriod','pn','frameIndex']);
  const booleanFields = new Set(['front','mirrorX','mirrorY','enabled']);
  const allowed = new Set([...numericFields, ...booleanFields, 'name', 'category']);
  let updated = null;
  store.transact('webmcp-entity-edit', d => {
    const entity = d.entities.find(row => row.id === entityId);
    if (!entity) throw new Error(`Editable entity '${entityId}' was not found`);
    for (const [key, value] of Object.entries(patch || {})) {
      if (!allowed.has(key)) throw new Error(`Entity field '${key}' is not editable through WebMCP`);
      if (numericFields.has(key)) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) throw new Error(`Entity field '${key}' requires a finite number`);
        entity[key] = numeric;
      } else if (booleanFields.has(key)) entity[key] = !!value;
      else entity[key] = String(value);
    }
    entity.flags = Number(entity.flags) & 0xff;
    entity.latency = Number(entity.latency) & 0xff;
    entity.actionPeriod = clamp(Math.round(Number(entity.actionPeriod) || 1), 1, 255);
    updated = deepClone(entity);
  });
  setSelection([{ kind:'entity', id:entityId }]);
  return updated;
}

async function installLevelEditorWebMcp() {
  return installWebMcpTools({
    namespace: 'rdr.level_editor',
    tools: [
      {
        name:'get_state', title:'Read Level Editor state', readOnly:true,
        description:'Read the complete current Level Editor draft, selection, presentation mode, diagnostics mode and playtest state.',
        execute: () => levelEditorWebMcpState()
      },
      {
        name:'open_room', title:'Open room in Level Editor',
        description:'Open a production RDX room as a new non-destructive Level Editor draft by zero-based SM number.',
        inputSchema:{ type:'object', properties:{ submap:{ type:'integer', minimum:0, maximum:46 } }, required:['submap'], additionalProperties:false },
        execute:({submap})=>{const target=roomForSubmap(submap);if(!target)throw new Error(`No room exists for ${sm(submap)}`);openDocument(productionDocument(target));return levelEditorWebMcpState();}
      },
      {
        name:'select_entity', title:'Select editor entity',
        description:'Select and center an editable Level Editor entity by its draft entity id.',
        inputSchema:{ type:'object', properties:{ entityId:{ type:'string', minLength:1 } }, required:['entityId'], additionalProperties:false },
        execute:({entityId})=>{const entity=store?.document.entities.find(row=>row.id===entityId);if(!entity)throw new Error(`Editable entity '${entityId}' was not found`);setTool('select');setSelection([{kind:'entity',id:entityId}]);centerOnLogical(entity.x,entity.y);return {entity:deepClone(entity),selection:deepClone(selection)};}
      },
      {
        name:'convert_source_entity', title:'Convert Classic source entity',
        description:'Convert a Classic source mark into an editable native Level Editor entity, optionally overriding its RDX presentation PN.',
        inputSchema:{ type:'object', properties:{ mark:{type:'integer',minimum:0}, pn:{type:'integer',minimum:-1} }, required:['mark'], additionalProperties:false },
        execute:({mark,pn})=>{const entityId=convertSource(mark,{pnOverride:pn===undefined?null:pn,silent:true});if(!entityId)throw new Error(`Classic mark ${mark} could not be converted`);return {entity:deepClone(store.document.entities.find(row=>row.id===entityId)),selection:deepClone(selection)};}
      },
      {
        name:'update_entity', title:'Edit Level Editor entity',
        description:'Patch position, trigger/patrol position, native entity type, PN/frame, flags, latency, depth, mirroring, enabled state, name or category of an editable entity.',
        inputSchema:{ type:'object', properties:{ entityId:{type:'string',minLength:1}, patch:{type:'object',minProperties:1,additionalProperties:false,properties:{entity:{type:'integer'},x:{type:'number'},y:{type:'number'},patrolX:{type:'number'},patrolY:{type:'number'},triggerX:{type:'number'},triggerY:{type:'number'},flags:{type:'integer',minimum:0,maximum:255},latency:{type:'integer',minimum:0,maximum:255},actionPeriod:{type:'integer',minimum:1,maximum:255},pn:{type:'integer',minimum:-1},frameIndex:{type:'integer',minimum:-1},front:{type:'boolean'},mirrorX:{type:'boolean'},mirrorY:{type:'boolean'},enabled:{type:'boolean'},name:{type:'string'},category:{type:'string'}}} }, required:['entityId','patch'], additionalProperties:false },
        execute:({entityId,patch})=>({entity:updateEditorEntity(entityId,patch),selection:deepClone(selection)})
      },
      {
        name:'set_collision', title:'Set Level Editor gameplay collision',
        description:'Set one exact canonical 8x8 gameplay collision correction by zero-based RDX G8 coordinate.',
        inputSchema:{ type:'object', properties:{ g8X:{type:'integer',minimum:0},g8Y:{type:'integer',minimum:0},action:{type:'string',enum:['original','open','one-way','climb-through','lethal']} }, required:['g8X','g8Y','action'], additionalProperties:false },
        execute:({g8X,g8Y,action})=>{store.transact('webmcp-collision-edit',d=>{const temp=new LevelDocumentStore(d);temp.setGameplayCollision(g8X,g8Y,action);d.gameplayCollision=temp.document.gameplayCollision;});collisionAuthoring='gameplay';setSelection([gameplayCollisionSelectionItem(g8X,g8Y)]);return levelEditorWebMcpState();}
      },
      {
        name:'set_descriptor_collision', title:'Set advanced descriptor collision',
        description:'Advanced: edit one native one-based 16x16 MT/ML descriptor. Descriptor edits are not canonical reviewed collision corrections.',
        inputSchema:{ type:'object', properties:{ logicX:{type:'integer',minimum:1},logicY:{type:'integer',minimum:1},collision:{type:'string',enum:['original','pass-through','solid','one-way','climb-through','lethal']} }, required:['logicX','logicY','collision'], additionalProperties:false },
        execute:({logicX,logicY,collision})=>{store.transact('webmcp-descriptor-collision-edit',d=>{const temp=new LevelDocumentStore(d);temp.setCollision(logicX,logicY,collision);d.collision=temp.document.collision;});collisionAuthoring='descriptor';setSelection([collisionSelectionItem(logicX,logicY)]);return levelEditorWebMcpState();}
      },
      {
        name:'set_presentation_tile', title:'Set Level Editor presentation tile',
        description:'Replace, clear or revert one 8x8 presentation tile on plane A or B using an explicit RDX source tile.',
        inputSchema:{
          type:'object', properties:{ targetX:{type:'integer',minimum:0},targetY:{type:'integer',minimum:0},layer:{type:'string',enum:['A','B']},operation:{type:'string',enum:['copy','clear','revert']},sourceMapId:{type:'integer',minimum:0},sourceX:{type:'integer',minimum:0},sourceY:{type:'integer',minimum:0},sourceLayer:{type:'string',enum:['A','B']} },
          required:['targetX','targetY','layer','operation'], additionalProperties:false
        },
        execute:({targetX,targetY,layer,operation,sourceMapId,sourceX,sourceY,sourceLayer})=>{store.transact('webmcp-presentation-edit',d=>{const temp=new LevelDocumentStore(d);if(operation==='revert')temp.eraseTile(targetX,targetY,layer);else temp.paintTile(targetX,targetY,{layer,operation,sourceMapId:sourceMapId??d.base.mapId,sourceX:sourceX??targetX,sourceY:sourceY??targetY,sourceLayer:sourceLayer||layer});d.tiles=temp.document.tiles;});setSelection([{kind:'cell',id:`${layer}:${targetX}:${targetY}`,gx:targetX,gy:targetY,layer}]);return levelEditorWebMcpState();}
      },
      {
        name:'history', title:'Undo or redo Level Editor edit',
        description:'Undo or redo one Level Editor draft transaction.',
        inputSchema:{type:'object',properties:{direction:{type:'string',enum:['undo','redo']}},required:['direction'],additionalProperties:false},
        execute:({direction})=>({changed:direction==='undo'?store.undo():store.redo(),state:levelEditorWebMcpState()})
      },
      {
        name:'reset_to_rdx', title:'Reset Level Editor content to RDX',
        description:'Reset the whole map, or the current selection, to decoded RDX/base state using the same Level Editor reset command as the UI.',
        inputSchema:{type:'object',properties:{scope:{type:'string',enum:['map','selection']}},required:['scope'],additionalProperties:false},
        execute:({scope})=>{if(scope==='map')setSelection([]);else if(!selection.length)throw new Error('No Level Editor selection exists');resetSelectionOrMap();return levelEditorWebMcpState();}
      },
      {
        name:'export_changes', title:'Read compact editor changes', readOnly:true,
        description:'Return the same compact manual change payload as Export Changes without downloading a file.',
        execute:()=>JSON.parse(exportChangesJson(store.document,{heroStartChanged:heroStartChangedFromProduction()}))
      }
    ]
  });
}

async function resolveEditorRomSource(){
  const remembered=await loadRememberedRdxRom();
  if(remembered)return remembered;
  try{return {bytes:await bytes(EDITOR_BUNDLED_ROM_PATH),name:RDX_ROM_FILENAME,source:'bundled-editor-rom',directoryHandle:null};}
  catch(error){
    if(String(error?.message||error).includes('HTTP 404'))throw new Error('RDX ROM is not available in this browser. Use Load ROM once; it will be remembered locally and auto-loaded on later visits.');
    throw error;
  }
}

async function validateAndRememberEditorRom(source){
  const rom=await RdxRom.from(source.bytes,{strictHash:true});
  if(!rom.validation.ok)throw new Error(rom.validation.errors.join('; '));
  await rememberRdxRom(source.bytes,{name:source.name||RDX_ROM_FILENAME,directoryHandle:source.directoryHandle||null});
  return rom;
}

function bindRomSourceControls(){
  if(ui.rdx_rom_load&&ui.rdx_rom_file)ui.rdx_rom_load.addEventListener('click',()=>ui.rdx_rom_file.click());
  if(ui.rdx_rom_file)ui.rdx_rom_file.addEventListener('change',async event=>{
    const file=event.target.files?.[0];if(!file)return;
    try{
      const source={bytes:new Uint8Array(await file.arrayBuffer()),name:file.name||RDX_ROM_FILENAME,directoryHandle:null};
      await validateAndRememberEditorRom(source);
      location.reload();
    }catch(error){console.error(error);toast(error.message||String(error),'error',10000);}
    finally{event.target.value='';}
  });
  if(ui.rdx_rom_folder){
    ui.rdx_rom_folder.hidden=!canConnectRdxRomDirectory();
    ui.rdx_rom_folder.addEventListener('click',async()=>{
      try{const source=await connectRdxRomDirectory();await validateAndRememberEditorRom(source);location.reload();}
      catch(error){if(error?.name==='AbortError')return;console.error(error);toast(error.message||String(error),'error',10000);}
    });
  }
}

async function boot(){
  setEngine('Loading editor resources…','loading');
  try{
    const [romSource,mappingData,matcher,paletteData,visualAssets,collisionData,manifest,spriteAnims,trapInventory,classic,actionVisualBindings,classicScriptedPaths,trapRegistry,activatorSounds,resolvedLevels,entityCatalog,autotileCatalogRaw,stampCatalogRaw,module] = await Promise.all([
      resolveEditorRomSource(),json('./rdx/data/rd_asset_mapping_v1.json'),json('./rdx/data/rd_asset_matcher_diff_sourcefix_v27_curated.json'),json('./rdx/data/palettes.json'),json('./rdx/data/editor/visual-assets.json'),json('./rdx/data/collision/rdx_collision_runtime.json'),json('./rdx/data/rdx_runtime_room_manifest.json'),json('./rdx/data/sprite_anims.json'),json('./rdx/data/preview/trap_action_inventory.json'),json('./rdx/data/preview/classic_level_preview.json'),json('./rdx/data/preview/action_visual_bindings.json'),json('./rdx/data/preview/classic_scripted_paths.json'),json('./rdx/data/preview/trap_registry.json'),json('./rdx/data/preview/classic_activator_sounds.json'),json('./rdx/data/levels/resolved/levels.json'),json('./rdx/data/editor/entity_catalog.json'),json('./rdx/data/editor/autotile_catalog.json'),json('./rdx/data/editor/stamp_catalog.json'),waitForModule().catch(error=>{runtimeFailure=error;return null})
    ]);
    const romBytes=romSource.bytes,rom=await validateAndRememberEditorRom(romSource);const mapping=new RdxMapping(mappingData,matcher,resolvedLevels),mv=mapping.validate();if(!mv.ok)throw new Error(mv.errors.join('; '));const mapDecoder=new RdxMapDecoder(rom),spriteDecoder=new RdxSpriteDecoder(rom),palettes=new PaletteRegistry(paletteData);
    const autotileCatalog=normalizeAutotileCatalog(autotileCatalogRaw);if(autotileCatalog.version!==LEVEL_EDITOR_VERSION)throw new Error(`Autotile catalog ${autotileCatalog.version||'unversioned'} does not match Level Editor ${LEVEL_EDITOR_VERSION}. Run npm run autotile:catalog.`);const stampCatalog=normalizeStampCatalog(stampCatalogRaw);if(stampCatalog.version!==LEVEL_EDITOR_VERSION)throw new Error(`Stamp catalog ${stampCatalog.version||'unversioned'} does not match Level Editor ${LEVEL_EDITOR_VERSION}. Run npm run stamps:catalog.`);const productionScene=createResolvedEditorProjection(resolvedLevels),productionSceneE=createResolvedEditorProjection(resolvedLevels,{throughLayer:'E'}),derived=resolvedLevels.derived||{},reviewedMapVisualPatches=derived.reviewedMapVisualPatches||{patches:[]},productionMappings=derived.productionMappings||{},runtimeCollisionPatches=derived.runtimeCollisionPatches||{patches:[]},visualPlacementCorrections=derived.visualPlacementCorrections||{rows:[]};resources={rom,romBytes,mapping,mapDecoder,spriteDecoder,palettes,visualAssets,manifest,classic,classicScriptedPaths,cellShiftMap:new ClassicRdxCellShiftMap({classicData:classic,mapping,collisionData}),resolvedLevels,runtimeEvidenceStatus:productionScene.runtimeEvidence,reviewedMapVisualPatches:Array.isArray(reviewedMapVisualPatches?.patches)?reviewedMapVisualPatches.patches:[],productionMappings,productionScene,productionSceneE,spriteAnims,entityCatalog,autotileCatalog,stampCatalog,roomBySubmap:new Map(manifest.rooms.map(r=>[Number(r.submap),r]))};
    const previewOptions={mapDecoder,spriteDecoder,paletteRegistry:palettes,mapping,spriteAnims,trapInventory,classicData:classic,actionVisualBindings,classicScriptedPaths,trapRegistry,authoredVisualAssets:visualAssets,reviewedMapVisualPatches,runtimeCollisionPatches,activatorSounds,noOverlapPresence:{rooms:[]},placementAudit:{rooms:[]},visualPlacementCorrections,productionScene,productionMappings};resources.preview=createCanonicalLevelEditorPreviewRenderer({...previewOptions,dynamiteSource:'revival'});resources.previewE=createCanonicalLevelEditorPreviewRenderer({...previewOptions,productionScene:productionSceneE,dynamiteSource:'revival'});resources.classicPreview=createCanonicalLevelEditorPreviewRenderer({...previewOptions,dynamiteSource:'classic'});resources.rawPreview=createDecodedRdxPreviewRenderer({mapDecoder,spriteDecoder,paletteRegistry:palettes,mapping,spriteAnims,dynamiteSource:'revival'});
    if(module){bridge=new XrickWasmBridge(module);validateRoomManifestParity(bridge,manifest);const levelParity=nativeLevelParity(resolvedLevels,bridge);if(!levelParity.compatible)throw new Error(`Resolved level/native runtime mismatch: ${levelParity.reason}. Rebuild the WASM runtime and regenerated level bundle.`);bridge.loadPresentationRom(romBytes);bridge.setEnabled(true);bridge.setCollisionPolicy(COLLISION_RDX_DESCRIPTOR);bridge.setClassicAssets(false);bridge.setFrontendPaused(true);bridge.forceBrowserFrame();setEngine('ResolvedLevel/xrick runtime ready','ok');setParity('ResolvedLevel linked · Simulate uses live xrick runtime','ok')}else{setEngine('Editor ready · RDX/xrick WASM unavailable','error');setParity(runtimeFailure?.message||'Resolved-level editing available · playtest unavailable','error')}
    ui.new_host.replaceChildren(...manifest.rooms.map(r=>{const o=document.createElement('option');o.value=String(r.submap);o.textContent=roomLabel(r);return o}));renderRoomGrid();
    let initial=null;try{const saved=localStorage.getItem(AUTOSAVE_KEY);if(saved)initial=JSON.parse(saved)}catch{}if(!initial)initial=productionDocument(manifest.rooms[0]);openDocument(initial,{resetSaved:true});selectedEntityType=entityCatalog.entities.find(e=>e.pn>=0)||entityCatalog.entities[0];loadDebugNotes();renderEntityLibrary();renderDebugNoteDock();bindUI();bindKeyboard();ui.editor_app.dataset.ready='true';void installLevelEditorWebMcp();toast('Level Editor ready. Game and editor share one layered ResolvedLevel; playtest remains native xrick authority.');requestAnimationFrame(animate);
  }catch(err){console.error(err);setEngine('Editor failed to initialize','error');setParity(err.message,'error');ui.save_state.textContent=err.message;toast(err.message,'error',10000)}
}
bindRomSourceControls();
boot();
