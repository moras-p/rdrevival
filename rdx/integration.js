import { RdxRom } from './src/core/rom.js';
import { RdxMapDecoder } from './src/core/map.js';
import { RdxSpriteDecoder } from './src/core/sprite.js';
import { RdxMapping } from './src/runtime/mapping.js';
import { ClassicRdxCellShiftMap } from './src/runtime/classic-rdx-cell-shift-map.js';
import { switchLivePresentation } from './src/runtime/live-presentation-switch.js';
import { PaletteRegistry } from './src/data/palettes.js';
import { loadJsonResponse, loadJsonFallback } from './src/data/json-loader.js';
import { XrickWasmBridge, RDX_PLAYFIELD, renderClassicFramebuffer, validateRoomManifestParity } from './xrick-bridge.js';
import { RdxCollisionDataset, CollisionPolicyName } from './src/collision/dataset.js';
import { RdxCollisionRuntime } from './src/collision/runtime.js';
import { composeSpritePlacements, RdxSpriteMode, RdxSpriteRuntime } from './src/runtime/sprite-runtime.js';
import { annotationBoundsPoints, commitAnnotationGesture, createAnnotationStore, normalizeAnnotationPoints } from './src/runtime/annotations.js';
import { buildDebugOverlayModel, DebugPrimitiveFlag, primitiveVisible } from './src/debug/overlay-model.js';
import { createResolvedEditorProjection, nativeLevelParity } from './src/levels/resolved-level.js';
import { bindRuntimeOptions } from './src/runtime/options.js';
import { canConnectRdxRomDirectory, connectRdxRomDirectory, loadRememberedRdxRom, rememberRdxRom } from './src/runtime/rom-store.js';
import { XRICK_CONTROL } from './src/runtime/controls.js';
import { createAiPlaytestController } from './src/agent/ai-playtest-controller.js';
import { installGameplayWebMcp } from './src/agent/gameplay-webmcp.js';
import { collectWorkbenchElements } from './src/workbench/elements.js';
import { createMapEditorSession } from './src/workbench/map-editor-session.js';
import { createPreviewWorkspace } from './src/workbench/preview-workspace.js';

const workbenchElements = collectWorkbenchElements(document);
const { backgroundCanvas, spriteCanvas, classicCanvas, foregroundCanvas, frontSpriteCanvas, collisionOverlayCanvas, annotationCanvas, sourceCanvas, stage, status, detail, playtestPanel, playtestOpenButton, playtestDebugToggle, playtestDebug, fileInput, romFolderButton, assetToggleButton, soundToggleButton, audioQualitySelect, collisionPolicySelect, spriteModeSelect, bulletSourceSelect, dynamiteSourceSelect, fallbackModeSelect, mapSelect, mapPrevButton, mapNextButton, invulnerabilityWarning, resetLevelButton, resetTriggersButton, unpauseButton } = workbenchElements.runtime;
const { aiModeSelect, aiContinueToggle, aiRestartRunButton, aiRunButton, aiStopButton, aiStatus, aiCopyDebugButton, gaiRouteInspectorRoot } = workbenchElements.ai;
const { debugOverlayToggle, invulnerableToggle, movementFeelPreviewToggle, crawlFallToggle, enemyDeathModeToggle, collisionTraceButton, ignoreExplodableToggle, playthroughRecordButton, annotateButton, diagnosticsExportButton, annotationDataElement, annotationNoteInput, annotationClearButton, annotationCopyButton, annotationCountElement, selectElementButton, selectedElementLabel, expectedActionSelect, saveElementAnnotationButton, puzzleSelect, puzzlePrevButton, puzzleNextButton, puzzleStartButton, puzzleRecordButton, puzzleFinishButton, puzzleCopyButton, puzzleStatus, puzzleDataElement } = workbenchElements.diagnostics;
const controlGroupButtons = workbenchElements.controlGroups.buttons;
const controlGroupPanels = workbenchElements.controlGroups.panels;


const AUTO_ROM_PATH = './resources/Rick_Dangerous_DX_1.3.bin';
const AUTO_ROM_NAME = 'Rick_Dangerous_DX_1.3.bin';
const runtimeOptions = bindRuntimeOptions({
  root: document,
  onChange: ({ option, value }) => setStatus(`${option.label} set to ${value?.label || 'default'}.`, 'ok')
});

function setControlGroup(name = 'playtest', visible = true) {
  const active = ['playtest','ai','audio','collision','assets','diagnostics'].includes(name) ? name : 'playtest';
  const panel = controlGroupPanels.find(entry => entry.dataset.controlGroupPanel === active);
  const button = controlGroupButtons.find(entry => entry.dataset.controlGroup === active);
  if (panel) panel.hidden = !visible;
  if (button) button.setAttribute('aria-pressed', visible ? 'true' : 'false');
  return active;
}
function toggleControlGroup(name) {
  const panel = controlGroupPanels.find(entry => entry.dataset.controlGroupPanel === name);
  return setControlGroup(name, panel?.hidden !== false);
}

function applyModeCollisionDefault(classic, { resume = true } = {}) {
  const name = classic ? 'classic_only' : 'native_experimental';
  const policy = CollisionPolicyName[name];
  collisionPolicySelect.value = name;
  bridge?.setCollisionPolicy(policy);
  collisionRuntime?.setPolicy(policy);
  if (resume) bridge?.unpause();
  lastCollisionLogKey = '';
  return policy;
}

const backgroundContext = backgroundCanvas.getContext('2d');
const spriteContext = spriteCanvas.getContext('2d');
const classicContext = classicCanvas.getContext('2d');
const foregroundContext = foregroundCanvas.getContext('2d');
const frontSpriteContext = frontSpriteCanvas.getContext('2d');
const collisionOverlayContext = collisionOverlayCanvas.getContext('2d');
const annotationContext = annotationCanvas?.getContext('2d') || collisionOverlayCanvas.getContext('2d');
for (const context of [backgroundContext, spriteContext, classicContext, foregroundContext, frontSpriteContext, collisionOverlayContext, annotationContext]) {
  context.imageSmoothingEnabled = false;
}

const AUDIO_QUALITY_ID = Object.freeze({ low: 0, high: 2 });
const AUDIO_QUALITY_LABEL = Object.freeze({ high: 'High · Amiga Original MAX', low: 'Low · XRICK FAST' });
const audioQualityKey = value => Number(value) === 0 ? 'low' : 'high';
const applyBrowserAudioQuality = (bridgeRef, key) => {
  if (!bridgeRef) return;
  const resolved = key in AUDIO_QUALITY_ID ? key : 'high';
  bridgeRef.setSoundQuality(AUDIO_QUALITY_ID[resolved]);
  /* The browser has the same simple LOW/HIGH contract as the in-game menu.
   * HIGH always means the maximum-quality Amiga preset. */
  if (resolved === 'high') { bridgeRef.setSoundFilter(1); bridgeRef.setSoundSpatial(2); }
};

function setExpanded(button, expanded) {
  button?.setAttribute('aria-expanded', expanded ? 'true' : 'false');
}

let bridge = null;
/* Route helpers are module-level so their recording guard must not capture the
 * installation-local controller. */
let gameplayDebugController = null;
let renderer = null;
const debugOverlayAssetCache = new Map();
const PREVIEW_APP_VERSION = '2.1.99';
let lastGameProgressSerial = -1;
let lastGameProgressAt = performance.now();
let lastResumeRequestAt = 0;
let collisionRuntime = null;
let spriteRuntime = null;
let cellShiftMap = null;
let lastCollisionLogKey = '';
let lastFrameSerial = -1;
let lastMapKey = '';
let running = true;
let collisionTrace = [];
let collisionTraceActive = false;
let lastWouldDieCount = 0;
let lastSpriteStats = { mapped: 0, fallback: 0, suppressed: 0, decorations: 0, rick: 0, entities: 0, mappingVersion: 'unloaded' };
let playthroughRecording = false;
let playthroughFrames = [];
let playthroughStart = null;
let lastRecordedFrame = -1;
let annotationStore = null;
let annotationActive = false;
let annotationDraft = null;
let elementSelectionActive = false;
let selectedMapElement = null;
let lastSnapshot = null;
let logicPuzzleCatalog = { entries: [] };
let activePuzzle = null;
let pendingPuzzleStart = null;
let puzzleRecording = false;
let puzzleFrames = [];
let puzzleWalkthroughs = [];
let puzzleLastRecordedFrame = -1;

let runtimeRoomManifest = null;
let PLAYBACK_SUBMAPS = [];

let previewWorkspace = null;

const mapEditorSession = createMapEditorSession({
  appVersion: PREVIEW_APP_VERSION,
  elements: { ...workbenchElements.mapEditor, playtestPanel },
  runtime: {
    bridge: () => bridge,
    renderer: () => renderer
  },
  preview: {
    selectedRoom: () => previewWorkspace?.selectedRoom?.() || null,
    visibleControllers: () => previewWorkspace?.visibleControllers?.() || [],
    itemCategory: item => previewWorkspace?.itemCategory?.(item) || 'object',
    eachController: callback => previewWorkspace?.eachController?.(callback),
    rdxController: () => previewWorkspace?.rdxController?.() || null,
    primaryController: () => previewWorkspace?.primaryController?.() || null,
    selectedAsset: () => previewWorkspace?.selectedAsset?.() || null,
    workspaceMode: () => previewWorkspace?.mode?.() || 'preview'
  },
  actions: { setStatus, requestSubmap, smAssetName, mdAssetName, copyText }
});
const {
  loadDraft:loadMapEditorDraft,
  persistDraft:persistMapEditorDraft,
  roomDraft:mapEditorRoomDraft,
  updateStatus:updateMapEditorStatus,
  syncFields:syncMapEditorFields,
  updateOverlay:updateMapEditorOverlay,
  applyCellOverrides:applyMapEditorCellOverrides,
  autoPlaceHero:autoPlaceMapEditorHero,
  stopPlaytest:stopMapEditorPlaytest,
  renderPlaytest:renderMapEditorPlaytest,
  applyPendingStart:applyPendingMapEditorStart,
  setHero:setMapEditorHero,
  selectPiece:selectMapEditorPiece
} = mapEditorSession;

previewWorkspace = createPreviewWorkspace({
  appVersion: PREVIEW_APP_VERSION,
  elements: {
    ...workbenchElements.preview,
    mapSelect, fallbackModeSelect, bulletSourceSelect, dynamiteSourceSelect,
    playtestOpenButton, playtestPanel,
    mapEditorOpenButton:workbenchElements.mapEditor.mapEditorOpenButton,
    mapEditorTabButton:workbenchElements.mapEditor.mapEditorTabButton,
    mapEditorPanel:workbenchElements.mapEditor.mapEditorPanel
  },
  runtime: {
    roomManifest: () => runtimeRoomManifest,
    roomForSubmap
  },
  actions: { setExpanded, setStatus, mdAssetName, smAssetName, roomGroupLabel, downloadJson, copyText, resumeBrowserAudio },
  mapEditorSession
});

const aiPlaytestController = createAiPlaytestController({
  runtime: {
    get bridge() { return bridge; },
    get renderer() { return renderer; },
    get collisionRuntime() { return collisionRuntime; },
    get previewWorkspaceMode() { return previewWorkspace.mode(); },
    get mapEditorPlaytestActive() { return mapEditorSession.playtestActive(); },
    get gameplayDebugController() { return gameplayDebugController; }
  },
  elements: {
    aiModeSelect, aiContinueToggle, aiRestartRunButton, aiRunButton, aiStopButton, aiStatus, aiCopyDebugButton,
    collisionPolicySelect, invulnerableToggle, gaiRouteInspectorRoot
  },
  resourcesProvider: () => previewWorkspace.resources(),
  appVersion: PREVIEW_APP_VERSION
});

function mdAssetName(mapId) {
  return `MD${Number(mapId).toString(10).padStart(4, '0')}`;
}

function smAssetName(submap) {
  return `SM${Number(submap).toString(16).toUpperCase().padStart(2, '0')}`;
}

function roomGroupLabel(group) {
  return ({ south_america: 'Jungle', egypt: 'Egypt', castle: 'Castle', missile_base: 'Missile Base' })[group] || group || 'Mapped';
}

function installRoomManifest(manifest) {
  runtimeRoomManifest = manifest;
  const rooms = [...(manifest?.rooms || [])].sort((a, b) => a.submap - b.submap);
  PLAYBACK_SUBMAPS = rooms.map(room => Number(room.submap));
  const optionsFor = () => rooms.map(room => {
    const option = document.createElement('option');
    option.value = String(room.submap);
    option.textContent = `${room.submapName} · ${room.mapName || mdAssetName(room.mapId)} · ${roomGroupLabel(room.group)}`;
    return option;
  });
  if (mapSelect) mapSelect.replaceChildren(...optionsFor());
  previewWorkspace?.installRooms?.(rooms);
  return manifest;
}

function roomForSubmap(submap) {
  return runtimeRoomManifest?.rooms?.find(room => Number(room.submap) === Number(submap)) || null;
}
































































































function resumeBrowserLoop(reason = 'page-resume') {
  if (!bridge || document.hidden) return;
  const now = performance.now();
  if (now - lastResumeRequestAt < 500) return;
  lastResumeRequestAt = now;
  bridge.resumeBrowserLoop();
  bridge.forceBrowserFrame();
  lastGameProgressAt = now;
  console.debug(`xrick browser loop resumed: ${reason}`);
}

function installLogicPuzzles(catalog) {
  logicPuzzleCatalog = catalog?.entries ? catalog : { entries: [] };
  if (puzzleSelect) {
    puzzleSelect.replaceChildren(...logicPuzzleCatalog.entries.map(entry => {
      const option = document.createElement('option');
      option.value = entry.id;
      option.textContent = entry.title;
      return option;
    }));
  }
  renderPuzzleData();
  return logicPuzzleCatalog;
}

function selectedPuzzle() {
  return logicPuzzleCatalog.entries.find(entry => entry.id === puzzleSelect?.value) || logicPuzzleCatalog.entries[0] || null;
}

function pointInsideBounds(point, bounds) {
  return !!point && !!bounds && point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom;
}

function renderPuzzleData() {
  if (puzzleDataElement) puzzleDataElement.textContent = JSON.stringify(puzzleWalkthroughs, null, 2);
  if (puzzleCopyButton) puzzleCopyButton.disabled = puzzleWalkthroughs.length === 0;
  if (puzzleStatus) {
    if (puzzleRecording && activePuzzle) puzzleStatus.textContent = `Recording ${activePuzzle.title} · ${puzzleFrames.length} frames`;
    else if (activePuzzle) puzzleStatus.textContent = `Active: ${activePuzzle.title}`;
    else puzzleStatus.textContent = 'No puzzle active';
  }
}

function recordPuzzleFrame(snapshot) {
  if (!puzzleRecording || !activePuzzle || snapshot.frameSerial === puzzleLastRecordedFrame) return;
  puzzleLastRecordedFrame = snapshot.frameSerial;
  puzzleFrames.push(compactDiagnosticFrame(snapshot));
  if (puzzleFrames.length >= 18000) {
    puzzleRecording = false;
    if (puzzleRecordButton) puzzleRecordButton.textContent = 'Record walkthrough';
    setStatus('Logic-puzzle walkthrough reached the 18,000-frame limit.', 'warn');
  }
  renderPuzzleData();
}

function applyPendingPuzzleStart(snapshot) {
  if (!pendingPuzzleStart || !bridge || snapshot.submap !== pendingPuzzleStart.submap) return;
  if (!snapshot.collision?.native?.worldLoaded && !bridge.api.nativeWorldLoaded()) return;
  const puzzle = pendingPuzzleStart;
  bridge.setCameraFrow(puzzle.cameraFrow);
  if (!bridge.teleportWorld(puzzle.start.x, puzzle.start.y, !!puzzle.start.crawling)) return;
  pendingPuzzleStart = null;
  activePuzzle = puzzle;
  puzzleFrames = [];
  puzzleRecording = false;
  puzzleLastRecordedFrame = -1;
  if (puzzleRecordButton) puzzleRecordButton.textContent = 'Record walkthrough';
  if (puzzleFinishButton) puzzleFinishButton.disabled = false;
  setStatus(`Started ${puzzle.title}. ${puzzle.description}`, 'ok');
  renderPuzzleData();
}


function startPuzzle(puzzle = selectedPuzzle()) {
  if (!puzzle || !bridge) return false;
  activePuzzle = puzzle;
  pendingPuzzleStart = puzzle;
  requestSubmap(puzzle.submap);
  renderPuzzleData();
  setStatus(`Loading ${puzzle.title} at its recorded start point…`, 'neutral');
  return true;
}

function stepPuzzle(delta) {
  const entries = logicPuzzleCatalog.entries;
  if (!entries.length || !puzzleSelect) return;
  const current = Math.max(0, entries.findIndex(entry => entry.id === puzzleSelect.value));
  puzzleSelect.value = entries[(current + delta + entries.length) % entries.length].id;
  startPuzzle(selectedPuzzle());
}



function downloadJson(filename, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

async function copyText(text) {
  const value = String(text || '');
  if (!value) throw new Error('Nothing to copy');
  if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(value); return; }
  const area = document.createElement('textarea');
  area.value = value; area.setAttribute('readonly', ''); area.style.position = 'fixed'; area.style.opacity = '0';
  document.body.appendChild(area); area.select();
  const ok = document.execCommand?.('copy'); area.remove();
  if (!ok) throw new Error('clipboard API unavailable');
}

function activeViewport(snapshot) {
  if (!renderer || !snapshot) return null;
  return renderer.mapping.viewportForSubmap(snapshot.submap, {
    cameraX: RDX_PLAYFIELD.cameraOffsetX,
    cameraY: snapshot.cameraY,
    width: RDX_PLAYFIELD.width,
    height: RDX_PLAYFIELD.height
  });
}

function compactDiagnosticFrame(snapshot) {
  return {
    frame: snapshot.frame,
    submap: snapshot.submap,
    mapId: bridge?.mappedMdForSubmap(snapshot.submap) ?? 0xffff,
    mapFrow: snapshot.mapFrow,
    cameraY: snapshot.cameraY,
    control: snapshot.rick.control,
    rick: { ...snapshot.rick },
    player: { ...(snapshot.player || snapshot.collision?.native || {}) },
    bomb: { ...snapshot.bomb },
    settings: {
      collisionPolicy: snapshot.collision.policy,
      presentationMode: snapshot.presentationMode,
      classicAssets: snapshot.classicAssets,
      spriteMode: snapshot.spriteMode,
      ignoreExplodableCollision: bridge?.ignoreExplodableCollision() || false,
      speedMultiplier: snapshot.speedMultiplier || bridge?.speedMultiplier() || 1
    },
    entities: snapshot.entities.filter(entity => entity.n && entity.n !== 0xff).map(entity => ({
      slot: entity.slot, n: entity.n, x: entity.x, y: entity.y, w: entity.w, h: entity.h, sprite: entity.sprite,
      sprbase: entity.sprbase, offsy: entity.offsy, flags: entity.flags
    }))
  };
}

function recordPlaythroughFrame(snapshot) {
  if (!playthroughRecording || snapshot.frameSerial === lastRecordedFrame) return;
  lastRecordedFrame = snapshot.frameSerial;
  playthroughFrames.push(compactDiagnosticFrame(snapshot));
  if (playthroughFrames.length >= 18000) {
    playthroughRecording = false;
    playthroughRecordButton.textContent = 'Record broken-case playthrough';
    setStatus('Playthrough recording reached the 18,000-frame safety limit. Export it before starting another.', 'warn');
  }
  diagnosticsExportButton.disabled = !(playthroughFrames.length || annotationStore?.length || 0);
}

function annotationScreenPoint(event) {
  const rect = annotationCanvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(319, Math.round((event.clientX - rect.left) * 320 / rect.width))),
    y: Math.max(0, Math.min(199, Math.round((event.clientY - rect.top) * 200 / rect.height)))
  };
}

function worldPointForScreen(point, snapshot) {
  const viewport = activeViewport(snapshot);
  if (!viewport) return null;
  return {
    x: Math.round(viewport.x + point.x - RDX_PLAYFIELD.x),
    y: Math.round(viewport.y + point.y - RDX_PLAYFIELD.y)
  };
}

function entityScreenBounds(entity) {
  const width = Math.max(8, Number(entity.w) || 16);
  const height = Math.max(8, Number(entity.h) || 16);
  return {
    left: Number(entity.x), top: Number(entity.y) - 56,
    right: Number(entity.x) + width, bottom: Number(entity.y) - 56 + height
  };
}

function selectMapElement(point, snapshot) {
  const viewport = activeViewport(snapshot);
  const inside = (p, b, pad = 0) => p.x >= b.left-pad && p.x <= b.right+pad && p.y >= b.top-pad && p.y <= b.bottom+pad;

  /* Prefer the actual C presentation asset under the pointer.  This allows
   * selecting static and moving RDX mechanisms/rubble even when their classic
   * source entity is elsewhere or temporarily hidden. */
  const presentationCandidates = (snapshot.presentation || [])
    .filter(item => item.visiblePixels > 0 && item.width > 0 && item.height > 0)
    .map(item => ({ item, bounds: { left:item.drawX, top:item.drawY, right:item.drawX+item.width-1, bottom:item.drawY+item.height-1 } }))
    .filter(({bounds}) => inside(point, bounds, 2))
    .sort((a,b) => {
      const ad = a.item.slot === 255 ? 1 : 0, bd = b.item.slot === 255 ? 1 : 0;
      return ad-bd || ((a.bounds.right-a.bounds.left)*(a.bounds.bottom-a.bounds.top))-((b.bounds.right-b.bounds.left)*(b.bounds.bottom-b.bounds.top));
    });
  if (presentationCandidates.length && viewport) {
    const { item, bounds } = presentationCandidates[0];
    const a = worldPointForScreen({x:bounds.left,y:bounds.top}, snapshot);
    const b = worldPointForScreen({x:bounds.right,y:bounds.bottom}, snapshot);
    return {
      worldBounds:{left:Math.min(a.x,b.x),top:Math.min(a.y,b.y),right:Math.max(a.x,b.x),bottom:Math.max(a.y,b.y)},
      screenBounds:bounds,
      element:{kind:'rdx-actor',actorId:item.actorId,pn:item.pn,slot:item.slot,front:item.front,visiblePixels:item.visiblePixels}
    };
  }

  const candidates = (snapshot.entities || [])
    .filter(entity => entity.slot !== 1 && entity.n && entity.n !== 0xff)
    .map(entity => {
      const actor = entity.actorCollision;
      if (actor?.source === 2 && viewport) {
        return { entity, bounds:{
          left:RDX_PLAYFIELD.x+actor.left-viewport.x,
          top:RDX_PLAYFIELD.y+actor.top-viewport.y,
          right:RDX_PLAYFIELD.x+actor.right-viewport.x,
          bottom:RDX_PLAYFIELD.y+actor.bottom-viewport.y
        }};
      }
      return { entity, bounds: entityScreenBounds(entity) };
    })
    .filter(({ bounds }) => inside(point,bounds,6))
    .sort((a, b) => ((a.bounds.right-a.bounds.left)*(a.bounds.bottom-a.bounds.top)) - ((b.bounds.right-b.bounds.left)*(b.bounds.bottom-b.bounds.top)));
  if (candidates.length) {
    const { entity, bounds } = candidates[0];
    const a = worldPointForScreen({ x: bounds.left, y: bounds.top }, snapshot);
    const b = worldPointForScreen({ x: bounds.right, y: bounds.bottom }, snapshot);
    if (!a || !b) return null;
    return {
      worldBounds: { left: Math.min(a.x,b.x), top: Math.min(a.y,b.y), right: Math.max(a.x,b.x), bottom: Math.max(a.y,b.y) },
      screenBounds: bounds,
      element: {
        kind: 'entity', slot: entity.slot, entityType: entity.n, sprite: entity.sprite,
        mark: entity.mark, flags: entity.flags, width: entity.w, height: entity.h,
        actorId: entity.actorCollision?.actorId || 0
      }
    };
  }
  const world = worldPointForScreen(point, snapshot);
  if (!world) return null;
  const left = Math.floor(world.x / 16) * 16;
  const top = Math.floor(world.y / 16) * 16;
  return {
    worldBounds: { left, top, right: left + 15, bottom: top + 15 },
    screenBounds: {
      left: left - viewport.x + RDX_PLAYFIELD.x,
      top: top - viewport.y + RDX_PLAYFIELD.y,
      right: left + 15 - viewport.x + RDX_PLAYFIELD.x,
      bottom: top + 15 - viewport.y + RDX_PLAYFIELD.y
    },
    element: { kind: 'rdx-cell', cellX: Math.floor(world.x / 16), cellY: Math.floor(world.y / 16) }
  };
}

function updateSelectedElementLabel() {
  if (!selectedElementLabel) return;
  if (!selectedMapElement) {
    selectedElementLabel.textContent = 'No map element selected';
    if (saveElementAnnotationButton) saveElementAnnotationButton.disabled = true;
    return;
  }
  const e = selectedMapElement.element;
  selectedElementLabel.textContent = e.kind === 'entity'
    ? `Selected entity slot ${e.slot}, mark ${e.mark || 0}, type 0x${Number(e.entityType).toString(16).padStart(2,'0')}, sprite ${e.sprite}`
    : e.kind === 'rdx-actor'
      ? `Selected RDX asset actor 0x${Number(e.actorId).toString(16).padStart(2,'0')} / PN${String(e.pn).padStart(3,'0')}${e.slot === 255 ? ' (static)' : ` linked to slot ${e.slot}`}`
      : `Selected RDX cell ${e.cellX},${e.cellY}`;
  if (saveElementAnnotationButton) saveElementAnnotationButton.disabled = false;
}

function setElementSelectionActive(enabled) {
  elementSelectionActive = !!enabled;
  annotationCanvas.dataset.selecting = elementSelectionActive ? 'true' : 'false';
  if (selectElementButton) selectElementButton.textContent = elementSelectionActive ? 'Cancel element selection' : 'Select map element';
  if (elementSelectionActive) setAnnotationActive(false, false);
  setStatus(elementSelectionActive ? 'Click an entity, rubble pile, blockage, trap, or map cell to select it.' : 'Map-element selection disabled.', elementSelectionActive ? 'warn' : 'neutral');
}

function drawAnnotationPath(points, alpha = 1) {
  if (!points?.length) return;
  annotationContext.save();
  annotationContext.strokeStyle = `rgba(255,32,32,${alpha})`;
  annotationContext.fillStyle = `rgba(255,32,32,${Math.min(.18, alpha * .18)})`;
  annotationContext.lineWidth = 2;
  annotationContext.beginPath();
  annotationContext.moveTo(points[0].x + .5, points[0].y + .5);
  for (const point of points.slice(1)) annotationContext.lineTo(point.x + .5, point.y + .5);
  if (points.length > 2) annotationContext.closePath();
  annotationContext.fill(); annotationContext.stroke(); annotationContext.restore();
}

function redrawAnnotations(snapshot = lastSnapshot) {
  annotationContext.clearRect(0, 0, 320, 200);
  if (!snapshot) return;
  for (const annotation of annotationStore?.list() || []) {
    if (annotation.submap !== snapshot.submap) continue;
    const viewport = activeViewport(snapshot);
    if (!viewport) continue;
    const points = annotationBoundsPoints(annotation.worldBounds).map(point => ({
      x: point.x - viewport.x + RDX_PLAYFIELD.x,
      y: point.y - viewport.y + RDX_PLAYFIELD.y
    }));
    drawAnnotationPath(points, .9);
  }
  if (selectedMapElement?.worldBounds) {
    const viewport = activeViewport(snapshot);
    const w = selectedMapElement.worldBounds;
    const b = viewport ? {
      left: w.left - viewport.x + RDX_PLAYFIELD.x,
      top: w.top - viewport.y + RDX_PLAYFIELD.y,
      right: w.right - viewport.x + RDX_PLAYFIELD.x,
      bottom: w.bottom - viewport.y + RDX_PLAYFIELD.y
    } : selectedMapElement.screenBounds;
    annotationContext.save();
    annotationContext.strokeStyle = 'rgba(255,215,64,.98)';
    annotationContext.fillStyle = 'rgba(255,215,64,.14)';
    annotationContext.lineWidth = 2;
    annotationContext.fillRect(b.left, b.top, b.right-b.left, b.bottom-b.top);
    annotationContext.strokeRect(b.left+.5, b.top+.5, b.right-b.left, b.bottom-b.top);
    annotationContext.restore();
  }
  if (annotationDraft?.screenPoints) drawAnnotationPath(annotationDraft.screenPoints, 1);
}

function annotationPublicData() {
  return (annotationStore?.list() || []).map(annotation => ({
    id: annotation.id,
    note: annotation.note,
    room: {
      submap: annotation.submap,
      submapName: annotation.submapName,
      mapId: annotation.mapId,
      mapName: annotation.mapName,
      mapFrow: annotation.mapFrow,
      cameraY: annotation.cameraY
    },
    frame: annotation.frame,
    worldBounds: annotation.worldBounds,
    tile8Bounds: annotation.tile8Bounds,
    rdxCell16Bounds: annotation.rdxCell16Bounds,
    selectedElement: annotation.selectedElement || null,
    expectedAction: annotation.expectedAction || null
  }));
}

function renderAnnotationData() {
  const data = annotationPublicData();
  if (annotationDataElement) annotationDataElement.textContent = JSON.stringify(data, null, 2);
  if (annotationCountElement) annotationCountElement.textContent = `${data.length} annotation${data.length === 1 ? '' : 's'}`;
  if (annotationCopyButton) annotationCopyButton.disabled = data.length === 0;
}

annotationStore = createAnnotationStore(() => {
  renderAnnotationData();
  if (diagnosticsExportButton) diagnosticsExportButton.disabled = !(playthroughFrames.length || annotationStore.length);
});

/* Page lifecycle listeners must be installed eagerly. A previous insertion
 * accidentally nested them inside the annotation-store change callback, so
 * they did not exist until the user created an annotation. That left a
 * throttled/backgrounded Emscripten main loop permanently stalled on load;
 * opening Chrome's Performance recorder happened to wake it by changing the
 * page lifecycle/timing. */
for (const eventName of ['pageshow', 'focus']) {
  window.addEventListener?.(eventName, () => resumeBrowserLoop(eventName));
}
document.addEventListener?.('visibilitychange', () => {
  if (!document.hidden) resumeBrowserLoop('visibilitychange');
});
/* Do not make recovery depend on requestAnimationFrame itself. Chrome can
 * lose the initial RAF callback while the page is being activated; a small
 * independent timer observes the C frame serial and drives one cooperative
 * frame only after a genuine stall. */
const stallWatchdogTimer = window.setInterval?.(() => {
  if (!bridge || !running || document.hidden || bridge.frontendPaused?.()) return;
  const snapshot = bridge.snapshot();
  const now = performance.now();
  if (snapshot.frameSerial !== lastGameProgressSerial) {
    lastGameProgressSerial = snapshot.frameSerial;
    lastGameProgressAt = now;
  } else if (now - lastGameProgressAt > 1200 && now - lastResumeRequestAt > 1000) {
    resumeBrowserLoop('independent-stall-watchdog');
  }
}, 500);
stallWatchdogTimer?.unref?.();

function diagnosticsPayload() {
  return {
    schema: 'rdx.broken_case.v1',
    version: '0.14.9',
    createdAt: new Date().toISOString(),
    romSha256: renderer?.rom?.hash || null,
    roomManifestVersion: runtimeRoomManifest?.version || null,
    start: playthroughStart,
    frames: playthroughFrames,
    annotations: annotationPublicData(),
    logicPuzzleWalkthroughs: puzzleWalkthroughs,
    current: lastSnapshot ? compactDiagnosticFrame(lastSnapshot) : null
  };
}

function installDebugApi() {
  let sequenceToken = 0;
  const waitFrames = (mask, frameCount) => new Promise((resolve, reject) => {
    const token = ++sequenceToken;
    const start = bridge.snapshot().frameSerial;
    bridge.setDebugControl(mask);
    const poll = () => {
      if (token !== sequenceToken) {
        reject(new Error('RDX debug input sequence was cancelled'));
        return;
      }
      const snapshot = bridge.snapshot();
      if (((snapshot.frameSerial - start) >>> 0) >= frameCount) {
        bridge.setDebugControl(0);
        resolve(snapshot);
        return;
      }
      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  });

  globalThis.rdxDebug = Object.freeze({
    CONTROL: XRICK_CONTROL,
    snapshot: () => bridge.snapshot(),
    setControl: mask => bridge.setDebugControl(mask),
    stop: () => {
      sequenceToken += 1;
      bridge.setDebugControl(0);
    },
    setInvincible: enabled => bridge.setDebugInvincible(enabled),
    setIgnoreExplodableCollision: enabled => bridge.setIgnoreExplodableCollision(enabled),
    startBrokenCaseRecording() {
      playthroughFrames = []; playthroughStart = compactDiagnosticFrame(bridge.snapshot());
      playthroughRecording = true; lastRecordedFrame = -1; return true;
    },
    stopBrokenCaseRecording() { playthroughRecording = false; return diagnosticsPayload(); },
    exportBrokenCase() { const data = diagnosticsPayload(); downloadJson(`rdx-broken-case-${Date.now()}.json`, data); return data; },
    annotations: () => annotationPublicData(),
    logicPuzzles: () => logicPuzzleCatalog.entries.slice(),
    logicPuzzleWalkthroughs: () => puzzleWalkthroughs.slice(),
    startLogicPuzzle: id => startPuzzle(logicPuzzleCatalog.entries.find(entry => entry.id === id)),
    selectSubmap: submap => requestSubmap(submap),
    resetCurrentLevel: () => { bridge.resetCurrentLevel(); return true; },
    unpause: () => { bridge.unpause(); return true; },
    collision: () => bridge.snapshot().collision,
    startCollisionTrace() { collisionTrace = []; collisionTraceActive = true; return true; },
    stopCollisionTrace() { collisionTraceActive = false; return collisionTrace.slice(); },
    exportCollisionTrace() {
      downloadJson(`rdx-collision-trace-${Date.now()}.json`, {
        schema: 'rdx.native_collision_trace.v1',
        frames: collisionTrace
      });
      return collisionTrace.length;
    },
    setCollisionPolicy(name) {
      const policy = CollisionPolicyName[name];
      if (policy == null) throw new Error(`Unknown collision policy '${name}'`);
      collisionPolicySelect.value = name;
      collisionRuntime?.setPolicy(policy);
      bridge.setCollisionPolicy(policy);
      bridge.unpause();
      return bridge.snapshot().collision;
    },
    setSpeed(multiplier) {
      return Number(runtimeOptions.apply('gameplay_speed', multiplier));
    },
    setCameraMode(mode) {
      return runtimeOptions.apply('camera_mode', mode);
    },
    hold: (mask, frames = 600) => waitFrames(mask, Math.max(1, Number(frames) | 0)),
    async sequence(steps) {
      let result = bridge.snapshot();
      for (const step of steps) {
        result = await waitFrames(Number(step.mask) & 0xff, Math.max(1, Number(step.frames) | 0));
      }
      return result;
    }
  });
}

function resumeBrowserAudio() {
  try { globalThis.xrickResumeAudio?.(); } catch (error) { console.warn('[xrick/audio] resume failed', error); }
}

function updateSoundControl() {
  if (!soundToggleButton || !bridge) return;
  const available = bridge.soundAvailable();
  const muted = bridge.soundMuted();
  const qualityKey = audioQualityKey(bridge.soundQuality());
  if (audioQualitySelect) audioQualitySelect.value = qualityKey;
  soundToggleButton.disabled = !available;
  soundToggleButton.textContent = !available || muted ? '🔇' : '🔊';
  soundToggleButton.setAttribute('aria-label', !available ? 'Sound unavailable' : (muted ? 'Enable sound' : 'Mute sound'));
  soundToggleButton.title = !available ? `${AUDIO_QUALITY_LABEL[qualityKey]} audio unavailable` : (muted ? 'Sound off' : 'Sound on');
  soundToggleButton.setAttribute('aria-pressed', muted ? 'true' : 'false');
}

function requestSubmap(value) {
  const submap = Number(value) | 0;
  if (!bridge || !PLAYBACK_SUBMAPS.includes(submap)) return false;
  if (!bridge.selectSubmap(submap)) return false;
  if (mapSelect) mapSelect.value = String(submap);
  bridge.unpause();
  lastMapKey = '';
  lastCollisionLogKey = '';
  const room = roomForSubmap(submap);
  setStatus(`Starting ${smAssetName(submap)} → ${room?.mapName || 'mapped RDX room'} from a cold ${roomGroupLabel(room?.group)} entry…`, 'neutral');
  return true;
}

function stepPlaybackMap(delta) {
  const current = Number(mapSelect?.value ?? bridge?.snapshot().submap ?? 0) | 0;
  const index = Math.max(0, PLAYBACK_SUBMAPS.indexOf(current));
  const next = PLAYBACK_SUBMAPS[(index + delta + PLAYBACK_SUBMAPS.length) % PLAYBACK_SUBMAPS.length];
  return requestSubmap(next);
}

function updateDebugControls(snapshot) {
  if (mapSelect && PLAYBACK_SUBMAPS.includes(snapshot.submap) && mapSelect.value !== String(snapshot.submap)) {
    mapSelect.value = String(snapshot.submap);
  }
  if (!mapEditorSession.playtestActive() && invulnerableToggle && invulnerableToggle.checked !== snapshot.debug.invincible) {
    invulnerableToggle.checked = snapshot.debug.invincible;
  }
  if (ignoreExplodableToggle && ignoreExplodableToggle.checked !== snapshot.debug.ignoreExplodableCollision) {
    ignoreExplodableToggle.checked = snapshot.debug.ignoreExplodableCollision;
  }
  if (movementFeelPreviewToggle && bridge) {
    const enabled = bridge.runtimeOption('movement_feel_preview') === 'on';
    if (movementFeelPreviewToggle.checked !== enabled) movementFeelPreviewToggle.checked = enabled;
  }
  if (crawlFallToggle && bridge && crawlFallToggle.checked !== bridge.crawlFallPose()) crawlFallToggle.checked = bridge.crawlFallPose();
  if (enemyDeathModeToggle && bridge && enemyDeathModeToggle.checked !== bridge.directionalEnemyDeath()) enemyDeathModeToggle.checked = bridge.directionalEnemyDeath();
  if (!invulnerabilityWarning) return;
  const age = (snapshot.frameSerial - snapshot.debug.wouldDieFrame) >>> 0;
  const visible = snapshot.debug.invincible && snapshot.debug.wouldDieCount > 0 && age < 90;
  invulnerabilityWarning.hidden = !visible;
  if (snapshot.debug.wouldDieCount !== lastWouldDieCount) {
    invulnerabilityWarning.dataset.active = visible ? 'true' : 'false';
    lastWouldDieCount = snapshot.debug.wouldDieCount;
  }
}

function setStatus(message, kind = 'neutral') {
  status.textContent = message;
  status.dataset.kind = kind;
}

async function loadJson(path, fetchOptions = undefined) {
  return loadJsonResponse(path, fetchOptions);
}

async function loadJsonOptional(path) {
  try {
    return await loadJson(path);
  } catch (error) {
    console.warn('[RDX_COLLISION] Collision dataset unavailable; using explicit classic fallback', error);
    return null;
  }
}

function unavailableCollisionData(mapping, mapDecoder, romHash) {
  const rooms = {};
  for (const level of mapping.levels.values()) {
    const key = `MD${String(level.rdxMd).padStart(4, '0')}`; // legacy decimal dataset key
    if (rooms[key]) continue;
    const dimensions = mapDecoder.dimensions(level.rdxMd);
    rooms[key] = {
      widthPx: dimensions.width,
      heightPx: dimensions.height,
      availability: 'unavailable',
      staticGrid: { width: dimensions.width / 8, height: dimensions.height / 8, cells: [] },
      verifiedClasses: [],
      unresolvedClasses: ['solid', 'climb', 'oneWay', 'lethal', 'triggers'],
      dynamicContacts: [],
      evidence: [],
      notes: 'Generated at runtime because the collision dataset could not be loaded. No RDX collision semantics are active.'
    };
  }
  return {
    schema: 'rdx.collision.v1',
    version: 'missing-dataset-runtime-fallback',
    romSha256: romHash,
    coordinateUnitPx: 8,
    rooms
  };
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

function putPixelBuffer(context, pixelBuffer, dx, dy) {
  const image = new ImageData(pixelBuffer.data, pixelBuffer.width, pixelBuffer.height);
  context.putImageData(image, dx, dy);
}

function clearRdxLayers() {
  backgroundContext.clearRect(0, 0, backgroundCanvas.width, backgroundCanvas.height);
  spriteContext.clearRect(0, 0, spriteCanvas.width, spriteCanvas.height);
  foregroundContext.clearRect(0, 0, foregroundCanvas.width, foregroundCanvas.height);
  frontSpriteContext.clearRect(0, 0, frontSpriteCanvas.width, frontSpriteCanvas.height);
  collisionOverlayContext.clearRect(0, 0, collisionOverlayCanvas.width, collisionOverlayCanvas.height);
}


function debugOverlayEntity(snapshot, primitive) {
  const source = Number(primitive?.sourceId ?? -1);
  return (snapshot?.entities || []).find(entity => Number(entity?.mark ?? -2) === source) || null;
}

function debugOverlayClassicAsset(entity) {
  const data = previewWorkspace.resources()?.classicData;
  const sprite = Number(entity?.sprite ?? -1);
  const pixels = data?.sprites?.[sprite];
  const palette = data?.palette;
  if (!Array.isArray(pixels) || !Array.isArray(palette)) return null;
  const width = Number(data.spriteWidth || 32);
  const height = Number(data.spriteHeight || 21);
  const key = `classic:${sprite}`;
  if (debugOverlayAssetCache.has(key)) return debugOverlayAssetCache.get(key);
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const colorIndex = Number(pixels[i] || 0);
    const color = palette[colorIndex] || [0, 0, 0, 0];
    const offset = i * 4;
    rgba[offset] = Number(color[0] || 0); rgba[offset + 1] = Number(color[1] || 0);
    rgba[offset + 2] = Number(color[2] || 0); rgba[offset + 3] = colorIndex === 0 ? 0 : Number(color[3] ?? 255);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  canvas.getContext('2d').putImageData(new ImageData(rgba, width, height), 0, 0);
  debugOverlayAssetCache.set(key, canvas);
  return canvas;
}

function debugOverlayRdxAsset(snapshot, entity) {
  if (!renderer?.spriteDecoder || !renderer?.palettes || !spriteRuntime?.mapper) return null;
  const mapping = spriteRuntime.mapper.resolveEntity(entity, { direction:'right', dx:0, dy:0 });
  if (mapping?.status !== 'mapped' || !Number.isInteger(mapping.pn)) return null;
  const level = renderer.mapping?.levelForSubmap(snapshot?.submap);
  const mapId = Number(level?.rdxMd || 3);
  const palette = renderer.palettes.forMap(mapId)?.rgba;
  if (!palette) return null;
  const key = `rdx:${mapId}:${mapping.pn}:${mapping.mirrorX ? 1 : 0}`;
  if (debugOverlayAssetCache.has(key)) return debugOverlayAssetCache.get(key);
  const frame = renderer.spriteDecoder.frameForPn(mapping.pn, 0, palette, { mirrorX:mapping.mirrorX === true });
  if (!frame?.pixels) return null;
  const canvas = document.createElement('canvas');
  canvas.width = frame.pixels.width; canvas.height = frame.pixels.height;
  canvas.getContext('2d').putImageData(new ImageData(frame.pixels.data, frame.pixels.width, frame.pixels.height), 0, 0);
  debugOverlayAssetCache.set(key, canvas);
  return canvas;
}

function debugOverlayActivationAsset(snapshot, primitive, mode) {
  const entity = debugOverlayEntity(snapshot, primitive);
  if (!entity) return null;
  return mode === 'rdx' ? (debugOverlayRdxAsset(snapshot, entity) || debugOverlayClassicAsset(entity))
    : debugOverlayClassicAsset(entity);
}

function renderCollisionOverlay(snapshot) {
  collisionOverlayContext.clearRect(0, 0, collisionOverlayCanvas.width, collisionOverlayCanvas.height);
  if (!debugOverlayToggle?.checked) return;
  const model = buildDebugOverlayModel(snapshot, bridge, renderer?.mapping);
  if (!model) return;

  const context = collisionOverlayContext;
  const drawLine = (primitive, color, dash = []) => {
    if (!primitiveVisible(model.viewport, primitive)) return;
    context.setLineDash(dash);
    context.strokeStyle = color;
    context.beginPath();
    context.moveTo(primitive.screenX0 + .5, primitive.screenY0 + .5);
    context.lineTo(primitive.screenX1 + .5, primitive.screenY1 + .5);
    context.stroke();
  };
  const drawBox = (primitive, color, dash = [], label = '') => {
    if (!primitive || !primitiveVisible(model.viewport, primitive)) return;
    const x = Math.min(primitive.screenX0, primitive.screenX1);
    const y = Math.min(primitive.screenY0, primitive.screenY1);
    const width = Math.max(1, Math.abs(primitive.screenX1 - primitive.screenX0) + 1);
    const height = Math.max(1, Math.abs(primitive.screenY1 - primitive.screenY0) + 1);
    context.setLineDash(dash);
    context.strokeStyle = color;
    context.strokeRect(x + .5, y + .5, Math.max(1, width - 1), Math.max(1, height - 1));
    if (label) {
      context.fillStyle = color;
      context.fillText(label, x + 1, Math.max(model.viewport.screenY + 6, y - 2));
    }
  };

  context.save();
  context.lineWidth = 1;
  context.font = '6px monospace';

  /* Keep terrain diagnostics readable over dense RDX artwork. Only exposed
   * collision faces are emitted by C, and they use translucent one-pixel
   * strokes. Surface endpoint ticks and per-object labels are deliberately
   * omitted: they obscured crawl openings and made dense rooms look gridded. */
  for (const wall of model.impenetrableWalls) {
    const oneWay = !!(wall.flags & DebugPrimitiveFlag.ONE_WAY);
    drawLine(wall, oneWay ? 'rgba(255,112,200,.52)' : 'rgba(255,48,80,.74)',
      oneWay ? [2, 2] : []);
  }
  for (const surface of model.walkableSurfaces) {
    const oneWay = !!(surface.flags & DebugPrimitiveFlag.ONE_WAY);
    drawLine(surface,
      oneWay ? 'rgba(255,208,64,.48)' : 'rgba(64,255,112,.34)',
      oneWay ? [3, 3] : [6, 4]);
  }
  for (const ladder of model.ladders) drawLine(ladder, 'rgba(56,168,255,.42)', [3, 3]);
  for (const lethal of model.lethalSurfaces) drawBox(lethal, 'rgba(255,64,40,.68)', [1, 2]);
  for (const hazard of model.hazards || []) drawBox(hazard, 'rgba(255,64,40,.84)', [2, 2], 'hazard');
  for (const trigger of model.triggers) {
    const color = trigger.flags & DebugPrimitiveFlag.TRIGGER_DYNAMITE ? 'rgba(255,156,255,.66)' :
      trigger.flags & DebugPrimitiveFlag.TRIGGER_BULLET ? 'rgba(255,156,64,.66)' : 'rgba(80,224,208,.56)';
    drawBox(trigger, color, [3, 3]);
  }
  const actorClassColor = primitive => {
    switch (primitive.flags & DebugPrimitiveFlag.CLASS_MASK) {
      case DebugPrimitiveFlag.CLASS_T1A: return 'rgba(255,208,48,.82)';
      case DebugPrimitiveFlag.CLASS_T1B: return 'rgba(255,128,32,.82)';
      case DebugPrimitiveFlag.CLASS_T2: return 'rgba(200,88,255,.82)';
      case DebugPrimitiveFlag.CLASS_T3: return 'rgba(104,208,255,.76)';
      case DebugPrimitiveFlag.CLASS_PLATFORM: return 'rgba(48,236,255,.88)';
      case DebugPrimitiveFlag.CLASS_PROJECTILE: return 'rgba(255,255,255,.86)';
      case DebugPrimitiveFlag.CLASS_ONOFF: return 'rgba(255,88,176,.86)';
      default: return null;
    }
  };
  for (const path of model.paths) drawLine(path, actorClassColor(path) || 'rgba(255,255,255,.72)');
  for (const patrol of model.patrols) {
    const color = actorClassColor(patrol) || 'rgba(255,208,48,.82)';
    drawLine(patrol, color);
    if (!primitiveVisible(model.viewport, patrol)) continue;
    context.strokeStyle = color; context.setLineDash([]);
    for (const [x, y] of [[patrol.screenX0, patrol.screenY0], [patrol.screenX1, patrol.screenY1]]) {
      context.beginPath(); context.moveTo(x + .5, y - 2.5); context.lineTo(x + .5, y + 3.5); context.stroke();
    }
  }
  for (const emitter of model.emitters) {
    const color = 'rgba(255,72,40,.94)';
    drawLine(emitter, color);
    if (!primitiveVisible(model.viewport, emitter)) continue;
    context.fillStyle = color; context.fillRect(Math.round(emitter.screenX0) - 1, Math.round(emitter.screenY0) - 1, 3, 3);
  }
  for (const body of model.platformBodies) drawBox(body, actorClassColor(body) || 'rgba(48,236,255,.88)', [], 'platform');
  for (const actor of model.actorBoxes) {
    const inactive = !!(actor.flags & DebugPrimitiveFlag.INACTIVE);
    const color = actor.flags & DebugPrimitiveFlag.EXPLODABLE ? 'rgba(255,80,255,.72)' :
      actorClassColor(actor) || (actor.flags & DebugPrimitiveFlag.SHOOTER ? 'rgba(255,106,48,.72)' :
      inactive ? 'rgba(144,144,144,.42)' : 'rgba(255,176,32,.58)');
    drawBox(actor, color, inactive ? [2, 3] : []);
  }
  for (const origin of model.activationOrigins) {
    if (!primitiveVisible(model.viewport, origin)) continue;
    const color = actorClassColor(origin) || 'rgba(192,192,192,.72)';
    drawBox(origin, color, [2, 2]);
    const asset = debugOverlayActivationAsset(snapshot, origin, model.mode);
    if (asset?.width && asset?.height) {
      const cx = (origin.screenX0 + origin.screenX1) / 2;
      const cy = (origin.screenY0 + origin.screenY1) / 2;
      const scale = Math.min(.5, 12 / asset.width, 10 / asset.height);
      const width = Math.max(1, Math.round(asset.width * scale));
      const height = Math.max(1, Math.round(asset.height * scale));
      context.save(); context.imageSmoothingEnabled = false; context.globalAlpha = .78;
      context.drawImage(asset, Math.round(cx - width / 2), Math.round(cy - height / 2), width, height);
      context.restore();
    }
    if ((origin.flags & DebugPrimitiveFlag.CLASS_MASK) === DebugPrimitiveFlag.CLASS_ONOFF) {
      const x = Math.round(Math.min(origin.screenX0, origin.screenX1));
      const y = Math.round(Math.min(origin.screenY0, origin.screenY1));
      const active = !!(origin.flags & DebugPrimitiveFlag.ACTIVE);
      context.setLineDash([]); context.strokeStyle = color; context.fillStyle = color;
      context.strokeRect(x + .5, y + .5, 5, 5);
      if (active) context.fillRect(x + 2, y + 2, 3, 3);
      else { context.beginPath(); context.moveTo(x + 2, y + 3.5); context.lineTo(x + 4, y + 3.5); context.stroke(); }
    }
  }
  for (const item of model.collectibles) drawBox(item, 'rgba(128,255,176,.58)');
  for (const projectile of model.projectiles) drawBox(projectile, actorClassColor(projectile) || 'rgba(255,255,255,.74)');
  drawBox(model.playerBox, '#00ffff', [], 'Rick');
  const probeColor = primitive => {
    switch (primitive.flags & DebugPrimitiveFlag.CLASS_MASK) {
      case DebugPrimitiveFlag.PROBE_LEFT:
      case DebugPrimitiveFlag.PROBE_RIGHT: return 'rgba(255,176,64,.34)';
      case DebugPrimitiveFlag.PROBE_TOP: return 'rgba(255,96,224,.34)';
      case DebugPrimitiveFlag.PROBE_BOTTOM: return 'rgba(96,255,128,.34)';
      case DebugPrimitiveFlag.PROBE_CLIMB_TOP:
      case DebugPrimitiveFlag.PROBE_CLIMB_BOTTOM: return 'rgba(120,168,255,.42)';
      default: return 'rgba(255,255,255,.24)';
    }
  };
  for (const probe of model.playerProbes || []) {
    const climbProbe = (probe.flags & DebugPrimitiveFlag.CLASS_MASK) >= DebugPrimitiveFlag.PROBE_CLIMB_TOP;
    drawLine(probe, probeColor(probe), climbProbe ? [2, 2] : []);
  }

  /* The live debug overlay intentionally has no legend/header frame. At the
   * native 320x200 resolution that text is unreadable and obscures gameplay;
   * Map Preview remains the descriptive/audit surface for primitive meaning. */
  context.setLineDash([]);
  context.restore();
}
function recordCollisionTrace(snapshot) {
  if (!collisionTraceActive) return;
  const native = snapshot.collision?.native;
  if (!native?.worldLoaded) return;
  collisionTrace.push({
    frame: snapshot.frame,
    frameSerial: snapshot.frameSerial,
    submap: snapshot.submap,
    mapFrow: snapshot.mapFrow,
    cameraY: snapshot.cameraY,
    cameraOffsetPx: snapshot.cameraOffsetPx,
    native: { ...native }
  });
  if (collisionTrace.length > 3600) collisionTrace.shift();
}

function updateCollisionRuntime(snapshot) {
  if (!collisionRuntime || !renderer || !snapshot.enabled || (snapshot.presentationMode && !snapshot.classicAssets)) {
    lastCollisionLogKey = '';
    return;
  }
  collisionRuntime.activate(snapshot);
  const current = bridge.snapshot();
  const message = collisionRuntime.status(current);
  const logKey = `${current.submap}:${current.collision.availability}:${current.collision.verifiedClasses}:${current.collision.unresolvedClasses}:${current.collision.policy}`;
  if (message.visible && logKey !== lastCollisionLogKey) {
    console.warn('[RDX_COLLISION]', {
      headline: message.headline,
      detail: message.detail,
      dataset: collisionRuntime.dataset.version,
      runtime: current.collision
    });
  }
  lastCollisionLogKey = logKey;
}

function renderRdxLayers(snapshot) {
  if (!renderer || !snapshot.enabled || snapshot.presentationMode) {
    clearRdxLayers();
    return;
  }
  const level = renderer.mapping.levelForSubmap(snapshot.submap);
  if (!level) {
    clearRdxLayers();
    setStatus(`No RDX room mapping for xrick submap ${snapshot.submap}`, 'warn');
    return;
  }
  const mapId = level.rdxMd;
  const phaseCount = Math.max(1, renderer.mapDecoder.phaseCount(mapId));
  const phase = Math.floor(snapshot.frameSerial / 5) % phaseCount;
  const viewport = renderer.mapping.viewportForSubmap(snapshot.submap, {
    cameraX: RDX_PLAYFIELD.cameraOffsetX,
    cameraY: snapshot.cameraY,
    width: RDX_PLAYFIELD.width,
    height: RDX_PLAYFIELD.height
  });
  const mapKey = `${mapId}:${viewport.x}:${viewport.y}:${phase}`;
  if (mapKey === lastMapKey) return;
  lastMapKey = mapKey;

  const palette = renderer.palettes.forMap(mapId).rgba;
  const topology = level.rdxTopology || null;
  const back = renderer.mapDecoder.renderPlane(mapId, palette, { plane: 'B', phase, viewport, topology });
  const front = renderer.mapDecoder.renderPlane(mapId, palette, { plane: 'A', phase, viewport, topology });
  clearRdxLayers();
  putPixelBuffer(backgroundContext, back.pixels, RDX_PLAYFIELD.x, RDX_PLAYFIELD.y);
  putPixelBuffer(foregroundContext, front.pixels, RDX_PLAYFIELD.x, RDX_PLAYFIELD.y);

  setStatus(`RDX enabled · ${smAssetName(snapshot.submap)} → ${mdAssetName(mapId)}`, 'ok');
  detail.textContent = [
    `xrick map/submap: ${snapshot.map}/${snapshot.submap}`,
    `map_frow: ${snapshot.mapFrow}`,
    `camera delta: effective top ${snapshot.reachableStartRow + snapshot.cameraDeltaRows} - ${snapshot.reachableStartRow} = ${snapshot.cameraDeltaRows} tiles (${snapshot.cameraY}px; packed top ${snapshot.visibleTopRow})`,
    `RDX viewport: ${viewport.x},${viewport.y} ${viewport.width}x${viewport.height}`,
    'viewport transform: canonical dx/dy plus signed live camera delta',
    `MI phase: ${phase}/${phaseCount - 1}`,
    `Plane B tiles: ${back.metrics.tilesDrawn}, unresolved: ${back.metrics.unresolved}`,
    'presentation: centered 320px RDX viewport; 32px extensions on both sides of the native xrick corridor',
    'map pixels: direct ROM decode; negative camera regions remain unsynthesized',
    `collision descriptor world: loaded=${snapshot.collision.native.worldLoaded} complete=${snapshot.collision.native.worldReady} ${mdAssetName(snapshot.collision.native.mapId)} capabilities=0x${snapshot.collision.native.capabilities.toString(16)}`,
    `Rick diagnostics mirror: active=${snapshot.collision.native.playerActive} world=${snapshot.collision.native.playerWorldX},${snapshot.collision.native.playerWorldY} screen=${snapshot.collision.native.playerScreenX},${snapshot.collision.native.playerScreenY} grounded=${snapshot.collision.native.playerGrounded} climbing=${snapshot.collision.native.playerClimbing} crawling=${snapshot.collision.native.playerCrawling}`,
    `legacy entry diagnostics: spawnValid=${snapshot.collision.native.playerSpawnValid} anchor=${snapshot.collision.native.playerAnchorUsed ? 'verified' : 'derived'} evidence=0x${snapshot.collision.native.playerAnchorEvidenceId.toString(16)}`,
    `sprites: ${snapshot.spriteMode === RdxSpriteMode.rdx ? `RDX v27 semantic mappings (${lastSpriteStats.mapped} mapped, ${lastSpriteStats.fallback} fallback, ${lastSpriteStats.suppressed || 0} embedded proxies)` : 'classic xrick'} presentation=${snapshot.presentationMode ? 'classic transition' : 'layered gameplay'}`,
    `sprite mapping: ${lastSpriteStats.mappingVersion} mask=0x${snapshot.spriteReplacementMask.toString(16)}`,
    `debug: invulnerable=${snapshot.debug.invincible} preventedDeaths=${snapshot.debug.wouldDieCount}`,
    `descriptor diagnostics: legacyInvalidSpawn=${snapshot.collision.native.invalidSpawn} unsupported=${snapshot.collision.native.unsupportedContacts} last MT=0x${snapshot.collision.native.lastUnsupportedMt.toString(16)} ML=0x${snapshot.collision.native.lastUnsupportedMl.toString(16)} cell=${snapshot.collision.native.lastUnsupportedX},${snapshot.collision.native.lastUnsupportedY}`,
    `descriptor lifecycle: mutations=${snapshot.collision.native.mutationCount} mechanisms=${snapshot.collision.native.mechanismCount} last ML=0x${snapshot.collision.native.lastMechanismMl.toString(16)} cell=${snapshot.collision.native.lastMechanismX},${snapshot.collision.native.lastMechanismY} latch=${snapshot.collision.native.mechanismLatch}`,
    `legacy dataset: availability=${snapshot.collision.availability} verified=0x${snapshot.collision.verifiedClasses.toString(16)} unresolved=0x${snapshot.collision.unresolvedClasses.toString(16)}`,
    `terrain queries: verified=${snapshot.collision.verifiedQueries} fallback=${snapshot.collision.fallbackQueries} out-of-bounds=${snapshot.collision.outOfBoundsQueries}`,
    `actor queries: verified=${snapshot.collision.actorVerifiedQueries} xrick-fallback=${snapshot.collision.actorFallbackQueries}`,
    'collision rule: mapped RDX rooms project live MT/ML descriptors into the shared xrick 8×8 solver; unresolved special callbacks fall back explicitly to Classic semantics while mechanisms remain descriptor-owned',
    `Plane A tiles: ${front.metrics.tilesDrawn}, unresolved: ${front.metrics.unresolved}`,
    `Classic active entities: ${snapshot.entities.filter(entity => entity.n && entity.n !== 0xff).length}`
  ].join('\n');
}

function renderRdxSprites(snapshot) {
  spriteContext.clearRect(0, 0, spriteCanvas.width, spriteCanvas.height);
  frontSpriteContext.clearRect(0, 0, frontSpriteCanvas.width, frontSpriteCanvas.height);
  if (!renderer || !spriteRuntime || !snapshot.enabled || snapshot.presentationMode ||
      snapshot.spriteMode !== RdxSpriteMode.rdx) {
    bridge?.setSpriteReplacementMask(0);
    lastSpriteStats = { mapped: 0, fallback: 0, suppressed: 0, decorations: 0, rick: 0, entities: 0, mappingVersion: renderer?.mapping?.data?.version || 'unloaded' };
    return;
  }

  const level = renderer.mapping.levelForSubmap(snapshot.submap);
  if (!level) {
    bridge.setSpriteReplacementMask(0);
    return;
  }
  const viewport = renderer.mapping.viewportForSubmap(snapshot.submap, {
    cameraX: RDX_PLAYFIELD.cameraOffsetX,
    cameraY: snapshot.cameraY,
    width: RDX_PLAYFIELD.width,
    height: RDX_PLAYFIELD.height
  });
  if (!viewport) {
    bridge.setSpriteReplacementMask(0);
    return;
  }
  const palette = renderer.palettes.forMap(level.rdxMd).rgba;
  const plan = spriteRuntime.renderPlan(snapshot, palette, viewport);
  bridge.setSpriteReplacementMask(plan.replacementMask);
  lastSpriteStats = plan.stats;
  const normalPlacements = plan.placements.filter(placement => placement.presentationLayer !== 'front');
  const frontPlacements = plan.placements.filter(placement => placement.presentationLayer === 'front');
  const spriteLayer = composeSpritePlacements(spriteCanvas.width, spriteCanvas.height, normalPlacements);
  const frontSpriteLayer = composeSpritePlacements(frontSpriteCanvas.width, frontSpriteCanvas.height, frontPlacements);
  putPixelBuffer(spriteContext, spriteLayer, 0, 0);
  putPixelBuffer(frontSpriteContext, frontSpriteLayer, 0, 0);
}

function renderCPresentation(snapshot) {
  const pixels = bridge.presentationFramebuffer();
  const image = new ImageData(pixels, 320, 200);
  classicContext.putImageData(image, 0, 0);
  backgroundContext.clearRect(0, 0, backgroundCanvas.width, backgroundCanvas.height);
  spriteContext.clearRect(0, 0, spriteCanvas.width, spriteCanvas.height);
  foregroundContext.clearRect(0, 0, foregroundCanvas.width, foregroundCanvas.height);
  frontSpriteContext.clearRect(0, 0, frontSpriteCanvas.width, frontSpriteCanvas.height);
  const stats = bridge.presentationStats();
  lastSpriteStats = { ...stats, rick: 0, entities: stats.mapped, mappingVersion: renderer?.mapping?.data?.version || 'C embedded v27' };

  const nativeMapId = bridge.mappedMdForSubmap(snapshot.submap);
  const room = roomForSubmap(snapshot.submap);
  if (room && Number(room.mapId) !== nativeMapId) {
    throw new Error(`Active room mapping diverged for ${room.submapName}: manifest ${room.mapName} but C reports ${mdAssetName(nativeMapId)}. Rebuild the JavaScript and WASM together.`);
  }
  const mapId = nativeMapId !== 0xffff ? nativeMapId : (snapshot.collision?.native?.mapId ?? 0);
  setStatus(`C RDX baseline · ${smAssetName(snapshot.submap)} → ${room?.mapName || mdAssetName(mapId)}`, 'ok');
  detail.textContent = [
    `presentation authority: C core (ROM map/sprite decode, semantic mapping, animation, placement, alpha/depth composition)`,
    `mapping data: ${lastSpriteStats.mappingVersion}`,
    `C presentation: mapped=${stats.mapped} fallback=${stats.fallback} suppressed=${stats.suppressed} decorations=${stats.decorations}`,
    `gameplay authority: shared xrick Rick solver + live RDX descriptor projection${room?.nativeReady ? '' : ' (special callbacks may use Classic fallback)'}`,
    `unresolved room descriptors: ${(room?.unresolvedMl || []).length ? room.unresolvedMl.map(value => `ML${value}`).join(', ') : 'none in static player domain'}`,
    `audio: ${AUDIO_QUALITY_LABEL[audioQualityKey(bridge.soundQuality())]} ${bridge.soundAvailable() ? (bridge.soundMuted() ? 'muted' : 'active') : 'unavailable'}`,
    `sprite mode: ${snapshot.spriteMode === RdxSpriteMode.rdx ? 'RDX' : 'classic'}`,
    `xrick map/submap: ${snapshot.map}/${snapshot.submap}`,
    `frame serial: ${snapshot.frameSerial}`,
    `game speed: ${aiPlaytestController.speedModeLabel(snapshot.speedMultiplier || 1)}`,
    `camera delta: ${snapshot.cameraDeltaRows} tiles (${snapshot.cameraY}px)`,
    `replacement mask: 0x${snapshot.spriteReplacementMask.toString(16)}`,
    `collision descriptor world: loaded=${snapshot.collision.native.worldLoaded} complete=${snapshot.collision.native.worldReady} MD=${snapshot.collision.native.mapId} capabilities=0x${snapshot.collision.native.capabilities.toString(16)}`,
    `Rick diagnostics mirror: world=${snapshot.collision.native.playerWorldX},${snapshot.collision.native.playerWorldY} screen=${snapshot.collision.native.playerScreenX},${snapshot.collision.native.playerScreenY}`,
    `debug: invulnerable=${snapshot.debug.invincible} preventedDeaths=${snapshot.debug.wouldDieCount}`
  ].join('\n');
}





function frame() {
  if (!running || !bridge) return;
  try {
    const snapshot = bridge.snapshot();
    const now = performance.now();
    const frontendPaused = !!bridge.frontendPaused?.();
    if (frontendPaused) {
      /* An external-agent coaching hold is intentional, not a stalled native
       * loop. Keep the browser deadline fresh without asking C to resume. */
      lastGameProgressSerial = snapshot.frameSerial;
      lastGameProgressAt = now;
    } else if (snapshot.frameSerial !== lastGameProgressSerial) {
      lastGameProgressSerial = snapshot.frameSerial;
      lastGameProgressAt = now;
    } else if (!document.hidden && now - lastGameProgressAt > 1200 && now - lastResumeRequestAt > 1000) {
      resumeBrowserLoop('stalled-frame-watchdog');
    }
    lastSnapshot = snapshot;
    applyPendingPuzzleStart(snapshot);
    applyPendingMapEditorStart(snapshot);
    recordPlaythroughFrame(snapshot);
    recordPuzzleFrame(snapshot);
    updateDebugControls(snapshot);
    const simulationAdvanced = snapshot.frameSerial !== lastFrameSerial;
    /* WebMCP coaching deliberately freezes native simulation between tool calls.
     * Keep repainting the already-composited production frame on every browser
     * animation frame while frozen so the held state stays visible without
     * advancing game time. */
    /* Revival presentation has its own serial/cadence between authoritative
     * gameplay ticks. Copy the C compositor on every browser RAF while live so
     * 50/60/100/120 Hz camera frames are not discarded merely because the
     * gameplay frameSerial stayed unchanged. The C copy cache makes repeated
     * RAF reads cheap when the selected rate is below the physical display. */
    const liveRevivalPresentation = snapshot.enabled && !snapshot.presentationMode && bridge.presentationReady();
    const redraw = frontendPaused || snapshot.presentationMode || liveRevivalPresentation || simulationAdvanced;
    if (redraw) {
      lastFrameSerial = snapshot.frameSerial;
      updateSoundControl();
      if (assetToggleButton) {
        assetToggleButton.disabled = !renderer;
        const assetLabel = snapshot.classicAssets ? 'Use RDX assets' : 'Use classic assets';
        assetToggleButton.setAttribute('aria-label', assetLabel); assetToggleButton.title = assetLabel; assetToggleButton.dataset.classic = snapshot.classicAssets ? 'true' : 'false';
        assetToggleButton.setAttribute('aria-pressed', snapshot.classicAssets ? 'true' : 'false');
      }
      if (snapshot.enabled && bridge.presentationReady()) {
        /* The copied C surface is the actual Revival presentation for both
         * RDX and Classic-assets modes and now includes native Game Juice. */
        renderCPresentation(snapshot);
      } else {
        renderClassicFramebuffer(bridge, classicContext, {
          transparentZero: false,
          playfieldShiftX: 0,
          playfieldTop: RDX_PLAYFIELD.y
        });
        backgroundContext.clearRect(0, 0, backgroundCanvas.width, backgroundCanvas.height);
        spriteContext.clearRect(0, 0, spriteCanvas.width, spriteCanvas.height);
        foregroundContext.clearRect(0, 0, foregroundCanvas.width, foregroundCanvas.height);
        frontSpriteContext.clearRect(0, 0, frontSpriteCanvas.width, frontSpriteCanvas.height);
      }
      renderCollisionOverlay(snapshot);
      if (snapshot.presentationMode || simulationAdvanced) recordCollisionTrace(snapshot);
      redrawAnnotations(snapshot);
      renderMapEditorPlaytest(snapshot);
    }
    updateCollisionRuntime(snapshot);
    const aiSnapshot = bridge.snapshot();
    aiPlaytestController.tickFrame(aiSnapshot);
  } catch (error) {
    console.error(error);
    bridge?.setSpriteReplacementMask(0);
    setStatus(error.message, 'error');
  }
  requestAnimationFrame(frame);
}

async function loadRomBytes(bytes, displayName = 'RDX ROM', { remember = true, directoryHandle = null } = {}) {
  setStatus(`Loading ${displayName}…`);
  const [mappingData, matcherDiffData, paletteData, collisionData, roomManifest, spriteAnims, classicPreviewData, resolvedLevels] = await Promise.all([
    loadJson('./rdx/data/rd_asset_mapping_v1.json'),
    loadJson('./rdx/data/rd_asset_matcher_diff_sourcefix_v27_curated.json'),
    loadJson('./rdx/data/palettes.json'),
    loadJsonOptional('./rdx/data/collision/rdx_collision_runtime.json'),
    runtimeRoomManifest ? Promise.resolve(runtimeRoomManifest) : loadJson('./rdx/data/rdx_runtime_room_manifest.json').then(installRoomManifest),
    loadJson('./rdx/data/sprite_anims.json'),
    loadJson('./rdx/data/preview/classic_level_preview.json'),
    loadJson('./rdx/data/levels/resolved/levels.json')
  ]);
  const previewDataErrors = [];
  const previewJson = (path, fallback) => loadJsonFallback(path, fallback, {
    onError(error) {
      previewDataErrors.push({ path, error });
      console.error('[rdx/preview-data] optional development metadata unavailable', error);
    }
  });
  const [trapInventory, actionVisualBindings, classicScriptedPaths, trapRegistry, reviewedMapVisualPatches, productionOverrides, runtimeCollisionPatches, activatorSounds, noOverlapPresence, placementAudit, visualPlacementCorrections, unresolvedCollisionAudit] = await Promise.all([
    previewJson('./rdx/data/preview/trap_action_inventory.json', { rows: [] }),
    previewJson('./rdx/data/preview/action_visual_bindings.json', { bindings: [] }),
    previewJson('./rdx/data/preview/classic_scripted_paths.json', { entities: {} }),
    previewJson('./rdx/data/preview/trap_registry.json', { classic: { excludedTiles: [] }, rooms: [] }),
    previewJson('./rdx/data/preview/reviewed_map_visual_patches.json', { patches: [] }),
    previewJson('./rdx/data/preview/runtime_presentation_overrides.json', { tables: { markActorOverrides: [], gameplayMarkPositionDeltas: [], triggerSemantics: [] } }),
    previewJson('./rdx/data/preview/runtime_collision_patches.json', { patches: [] }),
    previewJson('./rdx/data/preview/classic_activator_sounds.json', { entities: {} }),
    previewJson('./rdx/data/preview/no_overlap_presence.json', { rooms: [] }),
    previewJson('./rdx/data/preview/placement_audit.json', { rooms: [] }),
    previewJson('./rdx/data/preview/visual_placement_corrections.json', { rows: [] }),
    previewJson('./rdx/data/preview/unresolved_collision_audit.json', { rooms: [] })
  ]);
  const rom = await RdxRom.from(bytes, { strictHash: true });
  if (!rom.validation.ok) throw new Error(rom.validation.errors.join('; '));
  previewWorkspace.setGameMetadata({ appVersion: PREVIEW_APP_VERSION, romSha256: rom.hash });
  const mapping = new RdxMapping(mappingData, matcherDiffData, resolvedLevels);
  const mappingValidation = mapping.validate();
  if (!mappingValidation.ok) throw new Error(mappingValidation.errors.join('; '));
  const mapDecoder = new RdxMapDecoder(rom);
  const spriteDecoder = new RdxSpriteDecoder(rom);
  const effectiveCollisionData = collisionData || unavailableCollisionData(mapping, mapDecoder, rom.hash);
  const collisionDataset = new RdxCollisionDataset(effectiveCollisionData, { romSha256: rom.hash, strictRomHash: true });
  cellShiftMap = new ClassicRdxCellShiftMap({ classicData: classicPreviewData, mapping, collisionData: effectiveCollisionData });
  validateRoomManifestParity(bridge, roomManifest);
  const levelParity = nativeLevelParity(resolvedLevels, bridge);
  if (!levelParity.compatible) {
    throw new Error(`Resolved level/native runtime mismatch: ${levelParity.reason}. Rebuild the WASM runtime and regenerated level bundle.`);
  }
  bridge.loadPresentationRom(bytes);
  if (!bridge.presentationReady()) {
    throw new Error('The C RDX compositor did not accept the ROM. JavaScript rendering is not a production fallback; rebuild the C/WASM core and frontend together.');
  }
  const palettes = new PaletteRegistry(paletteData);
  renderer = { rom, mapping, palettes, mapDecoder, spriteDecoder };
  previewWorkspace.close();
  previewWorkspace.setResources({
    mapDecoder,
    spriteDecoder,
    paletteRegistry: palettes,
    mapping,
    spriteAnims,
    trapInventory,
    classicData: classicPreviewData,
    actionVisualBindings,
    classicScriptedPaths,
    activatorSounds,
    noOverlapPresence,
    placementAudit,
    visualPlacementCorrections,
    unresolvedCollisionAudit,
    cellShiftMap,
    trapRegistry,
    reviewedMapVisualPatches,
    productionOverrides,
    runtimeCollisionPatches,
    /* Retained production traces are development evidence only. The live
     * browser workbench uses the same static ResolvedLevel projection as the
     * Level Editor and relies on native state for mutable execution. */
    productionScene: createResolvedEditorProjection(resolvedLevels),
    bulletSource: bulletSourceSelect?.value || 'revival',
    dynamiteSource: dynamiteSourceSelect?.value || 'revival'
  });
  /* Production pickup placement is compiled from
   * config/rdx-presentation/collectible_placements.json into the C
   * presentation tables.  Do not run a camera/foreground-dependent support
   * solver here: that would allow the same collectible to move at runtime. */
  spriteRuntime = new RdxSpriteRuntime(spriteDecoder, mapping);
  collisionRuntime = new RdxCollisionRuntime(bridge, collisionDataset, mapping, mapDecoder, roomManifest);
  applyModeCollisionDefault(false);
  lastMapKey = '';
  lastCollisionLogKey = '';
  bridge.setEnabled(true);
  bridge.setClassicAssets(false);
  bridge.setSpriteMode(RdxSpriteMode[spriteModeSelect?.value] ?? RdxSpriteMode.rdx);
  runtimeOptions.applyAll();
  bridge.setDynamiteSource(dynamiteSourceSelect?.value || 'revival');
  applyBrowserAudioQuality(bridge, audioQualitySelect?.value || 'high');
  bridge.setFallbackMode(({ classic: 0, red: 1, hidden: 2 })[fallbackModeSelect?.value] ?? 1);
  aiPlaytestController.updateButtons();
  aiPlaytestController.setPlayStatus(bridge.aiBackendAvailable() ? 'AI ready · current live state' : 'AI unavailable · rebuild WASM with GAI', bridge.aiBackendAvailable() ? 'ok' : 'error');
  if (remember) await rememberRdxRom(bytes, { name: displayName, directoryHandle });
  if (previewDataErrors.length) {
    const failed = previewDataErrors.map(({ path }) => path.split('/').pop()).join(', ');
    setStatus(`RDX ROM validated; Revival gameplay is available. Development preview metadata failed to load: ${failed}. See console for exact JSON errors.`, 'warn');
  } else {
    setStatus('RDX ROM validated and remembered for this browser; all 47 v27-mapped rooms are available. Amiga Original audio is the default; XRICK FAST remains the low-cost fallback.', 'ok');
  }
}

async function loadRom(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return loadRomBytes(bytes, file.name || 'RDX ROM');
}

function resetRomAfterLoadFailure(error) {
  aiPlaytestController.stopAutoplay('AI unavailable because ROM loading failed.', 'error', { resetRuntime: true });
  renderer = null;
  previewWorkspace.clearResources();
  spriteRuntime = null;
  collisionRuntime = null;
  cellShiftMap = null;
  bridge.setSpriteReplacementMask(0);
  bridge.unloadPresentationRom();
  bridge.resetCollision();
  bridge.setEnabled(false);
  setStatus(error.message, 'error');
}

async function autoLoadRom() {
  const remembered = await loadRememberedRdxRom();
  if (remembered) {
    try {
      await loadRomBytes(remembered.bytes, remembered.name || AUTO_ROM_NAME, { directoryHandle: remembered.directoryHandle });
      return true;
    } catch (error) {
      console.error('[rdx/rom] remembered ROM auto-load failed', error);
      resetRomAfterLoadFailure(error);
    }
  }

  let response;
  try {
    response = await fetch(AUTO_ROM_PATH, { cache: 'no-store' });
  } catch (error) {
    console.warn(`[rdx/rom] optional bundled ROM lookup failed: ${error?.message || error}`);
    return false;
  }
  if (response.status === 404) return false;
  if (!response.ok) {
    console.warn(`[rdx/rom] optional bundled ROM returned HTTP ${response.status}`);
    return false;
  }
  try {
    const bytes = new Uint8Array(await response.arrayBuffer());
    await loadRomBytes(bytes, AUTO_ROM_NAME);
    return true;
  } catch (error) {
    console.error('[rdx/rom] bundled ROM auto-load failed', error);
    resetRomAfterLoadFailure(error);
    return false;
  }
}

fileInput.addEventListener('change', async event => {
  const [file] = event.target.files;
  if (!file) return;
  try {
    await loadRom(file);
  } catch (error) {
    console.error(error);
    resetRomAfterLoadFailure(error);
  }
});

if (romFolderButton) {
  romFolderButton.hidden = !canConnectRdxRomDirectory();
  romFolderButton.addEventListener('click', async () => {
    try {
      const linked = await connectRdxRomDirectory();
      await loadRomBytes(linked.bytes, linked.name || AUTO_ROM_NAME, { directoryHandle: linked.directoryHandle });
    } catch (error) {
      if (error?.name === 'AbortError') return;
      console.error(error);
      resetRomAfterLoadFailure(error);
    }
  });
}

assetToggleButton.addEventListener('click', () => {
  if (!bridge || !renderer || !bridge.presentationReady()) return;
  const classic = !bridge.classicAssets();
  const transition = switchLivePresentation({ bridge, shiftMap: cellShiftMap, targetClassic: classic });
  const { correction, residual } = transition;
  lastFrameSerial = -1;
  const assetLabel = classic ? 'Use RDX assets' : 'Use classic assets';
  assetToggleButton.setAttribute('aria-label', assetLabel); assetToggleButton.title = assetLabel; assetToggleButton.dataset.classic = classic ? 'true' : 'false';
  const residualDetail = residual
    ? ` Local Classic↔RDX correspondence reports a (${correction.dxPx >= 0 ? '+' : ''}${correction.dxPx}, ${correction.dyPx >= 0 ? '+' : ''}${correction.dyPx}) px residual; gameplay coordinates are intentionally not mutated by the visual switch.`
    : '';
  setStatus(classic ?
    `Classic assets enabled; camera, collision policy, Rick, actors and gameplay state retained.${residualDetail}` :
    `RDX assets restored without reloading, changing collision policy or resetting gameplay.${residualDetail}`, residual ? 'warn' : 'neutral');
});


window.addEventListener('xrick-toggle-visual-mode', () => {
  if (!assetToggleButton || assetToggleButton.disabled) return;
  assetToggleButton.click();
});

movementFeelPreviewToggle?.addEventListener('change', () => {
  const enabled = movementFeelPreviewToggle.checked;
  bridge?.setRuntimeOption('movement_feel_preview', enabled ? 'on' : 'off');
  lastFrameSerial = -1;
  setStatus(enabled ?
    'Movement feel preview enabled: buffered ladder intent and render-only Rick interpolation are active.' :
    'Movement feel preview disabled; current Revival movement and stepped Rick presentation restored.', 'neutral');
});

crawlFallToggle?.addEventListener('change', () => {
  bridge?.setCrawlFallPose(crawlFallToggle.checked);
  setStatus(crawlFallToggle.checked ?
    'Crawl → air pose enabled; crawl-sized clearance is retained until standing is safe.' :
    'Classic crawl-fall posture enabled for maximum traversal compatibility.', 'neutral');
});

enemyDeathModeToggle?.addEventListener('change', () => {
  bridge?.setDirectionalEnemyDeath(enemyDeathModeToggle.checked);
  setStatus(enemyDeathModeToggle.checked ?
    'Directional enemy death flight enabled; right-side hits mirror only the X coordinates of the Classic fall curve.' :
    'Classic enemy death flight enabled; every kill follows the original +2 px/tick rightward X curve regardless of hit side.', 'neutral');
});

invulnerableToggle?.addEventListener('change', () => {
  bridge?.setDebugInvincible(invulnerableToggle.checked);
  if (aiPlaytestController.busy())
    aiPlaytestController.stopAutoplay('AI stopped because Invulnerable mode changed. Start AI again to replan with the new route-safety contract.', 'warn', { resetRuntime:true });
  lastWouldDieCount = 0;
  if (invulnerabilityWarning) invulnerabilityWarning.hidden = true;
  setStatus(invulnerableToggle.checked ?
    'Invulnerability enabled; lethal contacts will be reported without killing Rick.' :
    'Invulnerability disabled.', invulnerableToggle.checked ? 'warn' : 'neutral');
});

spriteModeSelect?.addEventListener('change', () => {
  const mode = RdxSpriteMode[spriteModeSelect.value] ?? RdxSpriteMode.rdx;
  bridge?.setSpriteMode(mode);
  spriteRuntime?.reset();
  /* Whole-map preview source is controlled by its map-art mode: classic
   * always uses classic sprites; RDX always uses RDX plus classic fallback. */
  bridge.setSpriteReplacementMask(0);
  lastFrameSerial = -1;
  setStatus(mode === RdxSpriteMode.rdx ?
    'RDX sourcefix-v27 sprites enabled with curated overrides, corrected direction, and visual-foot placement; unresolved actions remain classic fallbacks.' :
    'Classic xrick sprites enabled.', 'neutral');
});

bulletSourceSelect?.addEventListener('change', () => {
  const source = ['classic', 'revival'].includes(bulletSourceSelect.value) ? bulletSourceSelect.value : 'revival';
  previewWorkspace.eachController(controller => controller.setBulletSource(source));
  lastFrameSerial = -1;
  setStatus(source === 'classic' ?
    'Classic player bullet art enabled.' :
    'Revival authored player bullet art enabled; ROM PN13/PN14 are not used for the player weapon.', 'neutral');
});

dynamiteSourceSelect?.addEventListener('change', () => {
  const source = ['classic', 'revival'].includes(dynamiteSourceSelect.value) ? dynamiteSourceSelect.value : 'revival';
  bridge?.setDynamiteSource(source);
  previewWorkspace.eachController(controller => controller.setDynamiteSource(source));
  lastFrameSerial = -1;
  setStatus(source === 'classic' ?
    'Classic planted dynamite enabled; the presentation-native explosion remains unchanged.' :
    'Revival 22-frame planted dynamite enabled with the authored fuse/spark progression and pixel-authored volumetric blast.', 'neutral');
});

fallbackModeSelect?.addEventListener('change', () => {
  const mode = ({ classic: 0, red: 1, hidden: 2 })[fallbackModeSelect.value] ?? 1;
  bridge?.setFallbackMode(mode);
  previewWorkspace.updateSelection();
  lastFrameSerial = -1;
  setStatus(mode === 1 ?
    'Classic fallback assets are outlined in red for mapping audits.' :
    mode === 2 ? 'Missing RDX assets are hidden.' : 'Classic fallback assets are shown normally.', 'neutral');
});

audioQualitySelect?.addEventListener('change', () => {
  if (!bridge) return;
  const key = audioQualitySelect.value in AUDIO_QUALITY_ID ? audioQualitySelect.value : 'high';
  resumeBrowserAudio();
  applyBrowserAudioQuality(bridge, key);
  updateSoundControl();
  setStatus(`Audio quality changed to ${AUDIO_QUALITY_LABEL[key]}.`, 'ok');
});

soundToggleButton?.addEventListener('click', () => {
  if (!bridge?.soundAvailable()) {
    updateSoundControl();
    return;
  }
  resumeBrowserAudio();
  bridge.setSoundMuted(!bridge.soundMuted());
  updateSoundControl();
  setStatus(bridge.soundMuted() ? 'Classic xrick sound muted.' : 'Classic xrick sound enabled.', 'neutral');
});

mapSelect?.addEventListener('change', () => {
  if (aiPlaytestController.busy()) aiPlaytestController.stopAutoplay('AI stopped because a room was selected manually.', 'warn', { resetRuntime: true });
  requestSubmap(mapSelect.value);
});
mapPrevButton?.addEventListener('click', () => {
  if (aiPlaytestController.busy()) aiPlaytestController.stopAutoplay('AI stopped because the room changed manually.', 'warn', { resetRuntime: true });
  stepPlaybackMap(-1);
});
mapNextButton?.addEventListener('click', () => {
  if (aiPlaytestController.busy()) aiPlaytestController.stopAutoplay('AI stopped because the room changed manually.', 'warn', { resetRuntime: true });
  stepPlaybackMap(1);
});
aiRestartRunButton?.addEventListener('click', () => aiPlaytestController.startRestartAutoplay());
aiRunButton?.addEventListener('click', () => aiPlaytestController.startAutoplay());
aiStopButton?.addEventListener('click', () => {
  aiPlaytestController.stopAutoplay('AI stopped by user.', 'neutral', { resetRuntime: true });
  aiPlaytestController.setCoachControlled(false);
  bridge?.setFrontendPaused(false);
});
aiCopyDebugButton?.addEventListener('click', () => { void aiPlaytestController.copyPlannerDebug(); });
window.addEventListener('xrick-keyboard-owner-changed', event => {
  if ((aiPlaytestController.busy()) && event?.detail?.owner === 'game')
    aiPlaytestController.stopAutoplay('AI stopped; manual keyboard control took over.', 'neutral', { resetRuntime: true });
});
setControlGroup('playtest', false);
for (const button of controlGroupButtons) button.addEventListener('click', () => toggleControlGroup(button.dataset.controlGroup));
previewWorkspace.install();
playtestDebugToggle?.addEventListener('click', () => {
  if (!playtestDebug) return;
  playtestDebug.hidden = !playtestDebug.hidden;
  playtestDebugToggle.textContent = playtestDebug.hidden ? 'Show debug info' : 'Hide debug info';
  playtestDebugToggle.setAttribute('aria-expanded', playtestDebug.hidden ? 'false' : 'true');
});
resetLevelButton?.addEventListener('click', () => {
  if (aiPlaytestController.busy()) aiPlaytestController.stopAutoplay('AI stopped because the room was reset.', 'warn', { resetRuntime: true });
  bridge?.resetCurrentLevel();
  bridge?.unpause();
  lastCollisionLogKey = '';
  setStatus('Resetting current xrick submap and native RDX entry state…', 'neutral');
});

resetTriggersButton?.addEventListener('click', () => {
  if (aiPlaytestController.busy())
    aiPlaytestController.stopAutoplay('AI stopped because native trigger state was reset.', 'warn', { resetRuntime: true });
  const count = bridge?.resetCurrentRoomTriggers?.() ?? 0;
  lastCollisionLogKey = '';
  setStatus(`Reset ${count} native trigger/mechanism source${count === 1 ? '' : 's'} in the current room.`,
    count ? 'ok' : 'neutral');
});

unpauseButton?.addEventListener('click', () => {
  bridge?.unpause();
  lastCollisionLogKey = '';
  setStatus('Gameplay unpause requested', 'neutral');
});

collisionTraceButton?.addEventListener('click', () => {
  if (!collisionTraceActive) {
    collisionTrace = [];
    collisionTraceActive = true;
    collisionTraceButton.textContent = 'Stop + export collision trace';
  } else {
    collisionTraceActive = false;
    globalThis.rdxDebug?.exportCollisionTrace();
    collisionTraceButton.textContent = 'Record collision trace';
  }
});

ignoreExplodableToggle?.addEventListener('change', () => {
  if (aiPlaytestController.busy()) aiPlaytestController.stopAutoplay('AI stopped because collision semantics changed.', 'warn', { resetRuntime: true });
  bridge?.setIgnoreExplodableCollision(ignoreExplodableToggle.checked);
  bridge?.unpause();
  setStatus(ignoreExplodableToggle.checked ?
    'Explodeable ML17 collision is ignored for broken-case recording. Graphics and annotations remain unchanged.' :
    'Explodeable-piece collision restored.', ignoreExplodableToggle.checked ? 'warn' : 'neutral');
});

playthroughRecordButton?.addEventListener('click', () => {
  if (!playthroughRecording) {
    playthroughFrames = [];
    playthroughStart = lastSnapshot ? compactDiagnosticFrame(lastSnapshot) : null;
    lastRecordedFrame = -1;
    playthroughRecording = true;
    playthroughRecordButton.textContent = 'Stop playthrough recording';
    diagnosticsExportButton.disabled = false;
    setStatus('Recording controls, descriptor collision state, entities and room/camera coordinates for a broken case…', 'warn');
  } else {
    playthroughRecording = false;
    playthroughRecordButton.textContent = 'Record broken-case playthrough';
    setStatus(`Recorded ${playthroughFrames.length} gameplay frames. Add annotations or export the diagnostics JSON.`, 'neutral');
  }
});

function setAnnotationActive(enabled, announce = true) {
  annotationActive = !!enabled;
  if (annotationActive && elementSelectionActive) {
    elementSelectionActive = false;
    annotationCanvas.dataset.selecting = 'false';
    if (selectElementButton) selectElementButton.textContent = 'Select map element';
  }
  annotationCanvas.dataset.active = annotationActive ? 'true' : 'false';
  annotateButton.textContent = annotationActive ? 'Finish annotating' : 'Annotate broken scenery';
  if (!annotationActive) annotationDraft = null;
  redrawAnnotations();
  if (announce) setStatus(annotationActive ?
    'Drag around broken scenery. The saved annotation is reduced to one world-coordinate rectangle.' :
    'Annotation mode disabled.', annotationActive ? 'warn' : 'neutral');
}

annotateButton?.addEventListener('click', () => setAnnotationActive(!annotationActive));
selectElementButton?.addEventListener('click', () => setElementSelectionActive(!elementSelectionActive));

saveElementAnnotationButton?.addEventListener('click', () => {
  if (!selectedMapElement || !lastSnapshot || !bridge) return;
  try {
    const snapshot = compactDiagnosticFrame(lastSnapshot);
    const mapId = snapshot.mapId ?? bridge.mappedMdForSubmap(snapshot.submap);
    const room = roomForSubmap(snapshot.submap);
    const typedNote = annotationNoteInput?.value?.trim() || '';
    const expectedAction = expectedActionSelect?.value || 'other';
    commitAnnotationGesture({
      store: annotationStore,
      id: `annotation-${Date.now()}-${annotationStore?.length || 0}`,
      note: typedNote,
      snapshot, room, mapId,
      worldBounds: selectedMapElement.worldBounds,
      selectedElement: selectedMapElement.element,
      expectedAction,
      ignoreExplodableCollision: bridge.ignoreExplodableCollision()
    });
    if (annotationNoteInput) annotationNoteInput.value = '';
    selectedMapElement = null;
    updateSelectedElementLabel();
    diagnosticsExportButton.disabled = false;
    renderAnnotationData();
    redrawAnnotations();
    setStatus(`Saved selected-element annotation with expected action '${expectedAction}'.`, 'ok');
  } catch (error) {
    console.error('[rdx/annotation] selected element save failed', error);
    setStatus(`Selected-element annotation was not saved: ${error?.message || error}`, 'error');
  }
});

annotationClearButton?.addEventListener('click', () => {
  annotationStore?.clear();
  redrawAnnotations();
  setStatus('Cleared all map annotations.', 'neutral');
});

annotationCopyButton?.addEventListener('click', async () => {
  const text = JSON.stringify(annotationPublicData(), null, 2);
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      if (!document.execCommand?.('copy')) throw new Error('clipboard API unavailable');
      area.remove();
    }
    setStatus(`Copied ${annotationStore?.length || 0} annotations as JSON.`, 'ok');
  } catch (error) {
    console.error('[rdx/annotation] copy failed', error);
    setStatus(`Could not copy annotations: ${error?.message || error}`, 'error');
  }
});

diagnosticsExportButton?.addEventListener('click', () => {
  const payload = diagnosticsPayload();
  downloadJson(`rdx-broken-case-${Date.now()}.json`, payload);
  setStatus(`Exported ${payload.frames.length} playthrough frames and ${payload.annotations?.length || 0} map annotations.`, 'ok');
});

annotationCanvas?.addEventListener('pointerdown', event => {
  if ((!annotationActive && !elementSelectionActive) || !lastSnapshot || !renderer) return;
  event.preventDefault();
  const point = annotationScreenPoint(event);
  if (elementSelectionActive) {
    selectedMapElement = selectMapElement(point, lastSnapshot);
    updateSelectedElementLabel();
    setElementSelectionActive(false);
    redrawAnnotations();
    setStatus(selectedMapElement ? 'Map element selected. Choose the expected action, add a note, and save the annotation.' : 'No selectable element was found at that point.', selectedMapElement ? 'ok' : 'warn');
    return;
  }
  annotationCanvas.setPointerCapture(event.pointerId);
  annotationDraft = { screenPoints: [point], snapshot: compactDiagnosticFrame(lastSnapshot) };
  redrawAnnotations();
});
annotationCanvas?.addEventListener('pointermove', event => {
  if (!annotationDraft || !annotationCanvas.hasPointerCapture(event.pointerId)) return;
  event.preventDefault();
  for (const sample of event.getCoalescedEvents?.() || [event]) {
    const point = annotationScreenPoint(sample);
    const previous = annotationDraft.screenPoints.at(-1);
    if (!previous || Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y) >= 2)
      annotationDraft.screenPoints.push(point);
  }
  redrawAnnotations();
});
annotationCanvas?.addEventListener('pointerup', event => {
  if (!annotationDraft) return;
  event.preventDefault();
  try {
    const coalesced = event.getCoalescedEvents?.();
    for (const sample of coalesced?.length ? coalesced : [event])
      annotationDraft.screenPoints.push(annotationScreenPoint(sample));
    try { annotationCanvas.releasePointerCapture(event.pointerId); } catch {}
    const draft = annotationDraft; annotationDraft = null;
    draft.screenPoints = normalizeAnnotationPoints(draft.screenPoints);
    if (draft.screenPoints.length < 3) { redrawAnnotations(); return; }
    const typedNote = annotationNoteInput?.value?.trim() || '';
    const note = typedNote || (globalThis.prompt?.('Describe what is broken at this map location:', '') ?? '');
    const snapshot = draft.snapshot;
    const worldPoints = draft.screenPoints.map(point => worldPointForScreen(point, snapshot)).filter(Boolean);
    if (!worldPoints.length) { redrawAnnotations(); return; }
    const mapId = snapshot.mapId ?? bridge.mappedMdForSubmap(snapshot.submap);
    const room = roomForSubmap(snapshot.submap);
    commitAnnotationGesture({
      store: annotationStore,
      id: `annotation-${Date.now()}-${annotationStore?.length || 0}`,
      note, snapshot, room, mapId, worldPoints,
      expectedAction: expectedActionSelect?.value || 'other',
      ignoreExplodableCollision: bridge.ignoreExplodableCollision()
    });
    if (annotationNoteInput) annotationNoteInput.value = '';
    diagnosticsExportButton.disabled = false;
    renderAnnotationData();
    setAnnotationActive(false, false);
    setStatus(`Added annotation ${annotationStore?.length || 0} at ${smAssetName(snapshot.submap)} / ${mdAssetName(mapId)} and finished annotation mode.`, 'ok');
  } catch (error) {
    annotationDraft = null;
    redrawAnnotations();
    console.error('[rdx/annotation] commit failed', error);
    setStatus(`Annotation was not saved: ${error?.message || error}`, 'error');
  }
});
annotationCanvas?.addEventListener('pointercancel', () => { annotationDraft = null; redrawAnnotations(); });
annotationCanvas?.addEventListener('lostpointercapture', () => {
  if (annotationDraft?.screenPoints?.length < 2) { annotationDraft = null; redrawAnnotations(); }
});

puzzleSelect?.addEventListener('change', () => {
  const puzzle = selectedPuzzle();
  if (puzzleStatus && puzzle) puzzleStatus.textContent = `${puzzle.title} · ${puzzle.description}`;
});
puzzlePrevButton?.addEventListener('click', () => stepPuzzle(-1));
puzzleNextButton?.addEventListener('click', () => stepPuzzle(1));
puzzleStartButton?.addEventListener('click', () => startPuzzle());
puzzleRecordButton?.addEventListener('click', () => {
  if (!activePuzzle) startPuzzle();
  if (!activePuzzle) return;
  puzzleRecording = !puzzleRecording;
  if (puzzleRecording) {
    puzzleFrames = [];
    puzzleLastRecordedFrame = -1;
    puzzleRecordButton.textContent = 'Pause walkthrough recording';
    if (puzzleFinishButton) puzzleFinishButton.disabled = false;
    setStatus(`Recording trigger order for ${activePuzzle.title}.`, 'warn');
  } else {
    puzzleRecordButton.textContent = 'Resume walkthrough recording';
    setStatus(`Paused puzzle recording after ${puzzleFrames.length} frames.`, 'neutral');
  }
  renderPuzzleData();
});
puzzleFinishButton?.addEventListener('click', () => {
  if (!activePuzzle || !lastSnapshot) return;
  puzzleRecording = false;
  const native = lastSnapshot.collision?.native;
  const current = native?.playerActive ? { x: native.playerWorldX, y: native.playerWorldY } : null;
  const completed = pointInsideBounds(current, activePuzzle.endBounds);
  puzzleWalkthroughs.push({
    schema: 'rdx.logic_puzzle_walkthrough.v1',
    puzzleId: activePuzzle.id,
    title: activePuzzle.title,
    start: activePuzzle.start,
    endBounds: activePuzzle.endBounds,
    completed,
    finalPlayer: current,
    frames: puzzleFrames.slice(),
    annotations: annotationPublicData().filter(entry => entry.room?.submap === activePuzzle.submap)
  });
  puzzleFrames = [];
  puzzleRecordButton.textContent = 'Record walkthrough';
  puzzleFinishButton.disabled = true;
  setStatus(completed ? `Completed and recorded ${activePuzzle.title}.` : `Recorded ${activePuzzle.title}, but Rick is outside the expected end area.`, completed ? 'ok' : 'warn');
  renderPuzzleData();
});
puzzleCopyButton?.addEventListener('click', async () => {
  const text = JSON.stringify(puzzleWalkthroughs, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    setStatus(`Copied ${puzzleWalkthroughs.length} logic-puzzle walkthroughs.`, 'ok');
  } catch (error) {
    setStatus(`Could not copy puzzle walkthroughs: ${error?.message || error}`, 'error');
  }
});

collisionPolicySelect.addEventListener('change', () => {
  if (aiPlaytestController.busy()) aiPlaytestController.stopAutoplay('AI stopped because collision policy changed.', 'warn', { resetRuntime: true });
  const policy = CollisionPolicyName[collisionPolicySelect.value];
  if (policy == null) return;
  bridge?.setCollisionPolicy(policy);
  collisionRuntime?.setPolicy(policy);
  bridge?.unpause();
  lastCollisionLogKey = '';
});

renderAnnotationData();

try {
  const [module] = await Promise.all([
    waitForModule(),
    loadJson('./rdx/data/rdx_runtime_room_manifest.json').then(installRoomManifest),
    loadJson('./rdx/data/logic_puzzles.json').then(installLogicPuzzles)
  ]);
  bridge = new XrickWasmBridge(module);
  runtimeOptions.attachBridge(bridge);
  aiPlaytestController.updateButtons();
  aiPlaytestController.setPlayStatus(bridge.aiBackendAvailable() ? 'Load RDX ROM to enable AI play' : 'GAI backend missing from WASM', bridge.aiBackendAvailable() ? 'neutral' : 'error');
  bridge.setFrontendPaused(false);
  /* Bootstrap both simulation and presentation synchronously. The previous
   * startup still depended on Chrome delivering two independent initial RAF
   * callbacks (Emscripten and this renderer); Performance recording happened
   * to wake both. One explicit cooperative C frame plus one direct JS render
   * removes that final scheduler dependency. */
  bridge.resumeBrowserLoop();
  bridge.forceBrowserFrame();
  validateRoomManifestParity(bridge, runtimeRoomManifest);
  bridge.setSpriteMode(RdxSpriteMode[spriteModeSelect?.value] ?? RdxSpriteMode.rdx);
  bridge.setDynamiteSource(dynamiteSourceSelect?.value || 'revival');
  applyBrowserAudioQuality(bridge, audioQualitySelect?.value || 'high');
  bridge.setFallbackMode(({ classic: 0, red: 1, hidden: 2 })[fallbackModeSelect?.value] ?? 1);
  applyModeCollisionDefault(true);
  installDebugApi();
  void installGameplayWebMcp({
    runtime:{
      get bridge(){ return bridge; },
      get running(){ return running; },
      setGameplayDebugController(value){ gameplayDebugController = value; }
    },
    aiController:aiPlaytestController,
    elements:{ assetToggleButton, resetLevelButton, invulnerableToggle },
    actions:{ requestSubmap }
  });
  updateSoundControl();
  sourceCanvas.setAttribute('aria-hidden', 'true');
  setStatus('xrick is running. Loading a remembered or bundled RDX ROM when available; manual Load ROM remains available.');
  frame();
  void autoLoadRom().then(loaded => {
    if (!loaded && !renderer && status.dataset.kind !== 'error')
      setStatus('xrick is running. No remembered or bundled RDX ROM was found; use Load ROM once to enable remastered visuals on future visits too.');
  });
} catch (error) {
  running = false;
  console.error(error);
  setStatus(error.message, 'error');
}
