import { createCanonicalLevelEditorPreviewRenderer } from '../level-editor/rendering/canonical-room-renderer.js';
import { geometryIdsClipboardText, compactGeometryIds } from '../preview/geometry-ids.js';
import { geometryProvenanceClipboard, geometryProvenanceViewModel } from '../preview/geometry-provenance.js';
import { LevelPreview } from '../preview/level-preview.js';
import { PreviewNotesStore, compatibleRdxAssetOverride, editablePreviewAsset, isSceneryAssemblyItem, overrideFromPreviewState, previewAssetKey } from '../preview/preview-editor.js';
import { PreviewPatchStore, patchTargetState } from '../preview/preview-patches.js';
import { INTEGRATED_PREVIEW_PATCH_BASELINE } from '../../data/preview/integrated-patches-v2135.js';

export function createPreviewWorkspace({ appVersion, elements, runtime, actions, mapEditorSession }) {
  const PREVIEW_APP_VERSION = String(appVersion || '');
  const {
    previewPanel, previewOpenButton, previewTabButton, previewWorkspaceTitle, previewCloseButton, previewMapSelect,
    previewVisualSourceSelect, previewSpriteSourceSelect, previewViewSelect, previewLayoutSelect, previewSpeedSelect, previewPhaseInput,
    previewZoomSelect, previewActivateAll, previewShowPatrol, previewDebugFilter, previewInstanceCategory, previewInstancePrev,
    previewInstanceNext, previewInstanceStatus, previewShowCollision, previewShowUnresolvedCollision, previewUnresolvedSummary, previewUnresolvedList,
    previewGeometryPanel, previewGeometryHover, previewGeometrySelected, previewGeometryProvenance, previewGeometryCopyId, previewGeometryCopyIds,
    previewGeometryCopyTrace, previewGeometryClear, previewGeometryNote, previewGeometryAddNote, previewGeometryNoteSummary, previewGeometryTooltip,
    previewRectangleSelect, previewRectangleGeometry, previewSelectionPanel, previewSelectionList, previewEntityTree, previewSelectionClear,
    previewPauseButton, previewResetButton, previewDisablePatches, previewStatus, previewBackgroundCanvas, previewActorCanvas,
    previewForegroundCanvas, previewFrontActorCanvas, previewPatrolCanvas, previewCollisionCanvas, previewUnresolvedCollisionCanvas, previewShiftCanvas,
    previewShiftLegend, previewShiftValues, previewEditorCanvas, previewEditToggle, previewEditorPanel, previewSelectedAssetLabel,
    previewSelectedPosition, previewSelectedDetails, previewSelectedId, previewCopyElementId, previewPlayActivatorSound, previewAudioSourceSelect,
    previewJumpParent, previewJumpChild, previewMapPair, previewPrimaryCaption, previewComparePane, previewCompareCaption,
    previewCompareBackgroundCanvas, previewCompareActorCanvas, previewCompareForegroundCanvas, previewCompareFrontActorCanvas, previewComparePatrolCanvas, previewCompareCollisionCanvas,
    previewCompareUnresolvedCollisionCanvas, previewCompareShiftCanvas, previewCompareEditorCanvas, previewTimeline, previewTimelineSummary, previewTimelineRange,
    previewTimelineTick, previewTimelineFirst, previewTimelinePrev, previewTimelineNext, previewTimelineLast, previewTimelineCapture,
    previewTimelineState, previewClearSelectionButton, previewAssetCategory, previewAssetNote, previewAddNoteButton, previewOperationName,
    previewCreateOperationButton, previewOperationSelect, previewStateLabel, previewStateOrder, previewStateX, previewStateY,
    previewStatePn, previewStateActor, previewStateDirection, previewStateVisible, previewStateMirror, previewStateMirrorY,
    previewStateRotation, previewStateFront, previewStateNote, previewCaptureStateButton, previewSaveStateButton, previewApplyStateButton,
    previewFindAssetButton, previewClearOverrideButton, previewOperationStates, previewNotesData, previewNotesDownload, previewNotesImport,
    previewAssetBrowser, previewAssetBrowserClose, previewAssetSearch, previewAssetFilter, previewAssetGrid, previewPatchesPanel,
    previewPatchEnabled, previewPatchBugged, previewPatchRevert, previewPatchesDownload, previewPatchesImport, previewPatchesData,
    previewPatchList, previewPatchCount, previewPatchSelected, previewPatchSelectedId, previewPatchCopyId, previewPatchClearSelection,
    previewPatchX, previewPatchY, previewPatchObserved, previewPatchDelta, previewPatchState, previewScroll,
    previewCompareScroll, previewNoOverlapPanel, previewNoOverlapSummary, previewNoOverlapList, previewNoOverlapRefresh, previewPlacementPanel,
    previewPlacementSummary, previewPlacementList, previewPlacementCategory, previewPlacementStatus, previewPlacementPrev, previewPlacementNext,
    previewPlacementQueue, mapSelect, fallbackModeSelect, bulletSourceSelect, dynamiteSourceSelect, playtestOpenButton, playtestPanel,
    mapEditorOpenButton, mapEditorTabButton, mapEditorPanel
  } = elements;

  let levelPreview = null;
  let compareLevelPreview = null;
  let previewResources = null;
  let previewScrollSyncing = false;
  let previewPaused = false;
  let previewEditEnabled = false;
  let previewViewMode = 'placement';
  let previewLayoutMode = 'side-by-side';
  let previewWorkspaceMode = 'preview';
  let previewSelectedAsset = null;
  let previewDrag = null;
  let previewRectangleDrag = null;
  let previewRectangleRecords = [];
  const previewEntityVisibility = new Map();
  let previewEntityTreeSignature = '';
  let previewHitCycle = null;
  let previewPatchApplyStatus = new Map();
  let previewPatchesDisabled = false;
  let previewGeometrySelection = new Map();
  let previewGeometryActiveId = '';
  let previewGeometryRoomKey = '';
  let previewPlacementCursor = 0;
  const PLACEMENT_ISSUE_STATUSES = new Set(['misaligned','room-phase-bias','low-confidence','hazard-fit-candidate','missing-rdx-hazard','native-rdx-hazard']);
  let previewPlacementCursorIdentity = '';
  let previewInstanceCursor = -1;
  let previewInstanceIdentity = '';
  let previewNotesStore = new PreviewNotesStore({
    appVersion: PREVIEW_APP_VERSION,
    storage: typeof localStorage === 'undefined' ? null : localStorage,
    onChange: () => refreshPreviewNotesUi()
  });
  let previewPatchStore = new PreviewPatchStore({
    appVersion: PREVIEW_APP_VERSION,
    storage: typeof localStorage === 'undefined' ? null : localStorage,
    integratedBaseline: INTEGRATED_PREVIEW_PATCH_BASELINE,
    onChange: () => refreshPreviewPatchesUi()
  });

  function selectedPreviewRoom() {
    const submap = Number(previewMapSelect?.value ?? mapSelect?.value ?? 0);
    return runtime.roomForSubmap(submap) || runtime.roomManifest()?.rooms?.[0] || null;
  }

  function renderPreviewUnresolvedCounts() {
    if (!previewUnresolvedSummary || !previewUnresolvedList) return;
    const audit = previewResources?.unresolvedCollisionAudit;
    const rows = [...(audit?.rooms || [])];
    if (!rows.length) {
      previewUnresolvedSummary.textContent = 'Unresolved RDX collision · audit unavailable';
      previewUnresolvedList.replaceChildren();
      return;
    }
    const room = selectedPreviewRoom();
    const current = rows.find(row => Number(row.submap) === Number(room?.submap) && Number(row.mapId) === Number(room?.mapId));
    const total = Number(audit?.summary?.unresolved8pxCells || rows.reduce((sum, row) => sum + Number(row.unresolved8pxCells || 0), 0));
    const currentCount = Number(current?.unresolved8pxCells || 0);
    const primarySource = previewVisualSourceSelect?.value || 'rdx';
    const rdxController = primarySource === 'rdx'
      ? levelPreview
      : (previewLayoutMode === 'side-by-side' ? compareLevelPreview : null);
    const visibleCount = rdxController ? Number(rdxController.unresolvedCollisionCount?.() || 0) : null;
    previewUnresolvedSummary.textContent = visibleCount == null
      ? `Unresolved RDX collision · ${currentCount} raw in ${room?.submapName || 'current map'} · ${total} raw total`
      : `Unresolved RDX collision · ${visibleCount} visible / ${currentCount} raw in ${room?.submapName || 'current map'} · ${total} raw total`;
    previewUnresolvedList.replaceChildren(...rows.map(row => {
      const item = document.createElement('button');
      item.type = 'button';
      const count = Number(row.unresolved8pxCells || 0);
      const isCurrent = Number(row.submap) === Number(room?.submap) && Number(row.mapId) === Number(room?.mapId);
      item.className = `preview-unresolved-count${count ? ' has-unresolved' : ''}${isCurrent ? ' is-current' : ''}`;
      item.dataset.submap = String(row.submap);
      item.title = Object.entries(row.unresolvedDescriptors || {}).map(([key,value]) => `${key}: ${value}`).join(' · ') || 'No unresolved collision cells';
      item.addEventListener('click', () => {
        if (!previewMapSelect) return;
        previewMapSelect.value = String(row.submap);
        updatePreviewSelection();
      });
      const label = document.createElement('span');
      label.textContent = `${row.submapName} · ${row.mapName}`;
      const value = document.createElement('strong');
      value.textContent = `${count} raw ${count === 1 ? 'cell' : 'cells'}`;
      item.append(label, value);
      return item;
    }));
    if (previewShowUnresolvedCollision) {
      previewShowUnresolvedCollision.title = `${total} raw fallback 8×8 RDX collision cells across ${rows.length} mapped rooms; known Classic activator-owned cells are omitted from the visible RDX overlay.`;
    }
  }

  function previewOppositeSource(source) { return source === 'classic' ? 'rdx' : 'classic'; }

  function eachLevelPreview(callback) { for (const controller of [levelPreview, compareLevelPreview]) if (controller) callback(controller); }

  function applyPreviewControllerSettings(controller) {
    if (!controller) return;
    controller.setSpeed(Number(previewSpeedSelect?.value || 1));
    controller.setZoom(Number(previewZoomSelect?.value || 1));
    controller.setActivateAllTraps(!!previewActivateAll?.checked);
    controller.setShowPatrol(!!previewShowPatrol?.checked);
    controller.setDebugFilter(previewDebugFilter?.value || 'all');
    controller.setShowCollision(!!previewShowCollision?.checked);
    controller.setShowUnresolvedCollision(!!previewShowUnresolvedCollision?.checked);
    controller.setShowShift?.(previewViewMode === 'shift');
    controller.setBulletSource(bulletSourceSelect?.value || 'revival');
    controller.setDynamiteSource(dynamiteSourceSelect?.value || 'revival');
    controller.setPatchMode(previewViewMode === 'patches');
    controller.setNoOverlapMode(previewViewMode === 'no-overlap');
    controller.setPlacementMode?.(previewViewMode === 'placement');
    /* No-overlap and Placement are static audit overlays. Do not force the full
     * editor layer every animation frame; a list/canvas selection enables it on demand. */
    controller.setEditorEnabled(previewViewMode === 'patches' || previewEditEnabled);
    controller.setVisible(true);
  }

  function createCompareLevelPreview() {
    if (compareLevelPreview || !previewResources || !previewCompareBackgroundCanvas) return compareLevelPreview;
    compareLevelPreview = new LevelPreview({
      renderer: createCanonicalLevelEditorPreviewRenderer(previewResources),
      backgroundCanvas: previewCompareBackgroundCanvas,
      actorCanvas: previewCompareActorCanvas,
      foregroundCanvas: previewCompareForegroundCanvas,
      frontActorCanvas: previewCompareFrontActorCanvas,
      patrolCanvas: previewComparePatrolCanvas,
      collisionCanvas: previewCompareCollisionCanvas,
      unresolvedCollisionCanvas: previewCompareUnresolvedCollisionCanvas,
      shiftCanvas: previewCompareShiftCanvas,
      shiftMap: previewResources.cellShiftMap,
      editorCanvas: previewCompareEditorCanvas,
      statusElement: null,
      onElementSelect(item) {
        if (!item) return;
        if (previewViewMode !== 'patches') setPreviewEditorEnabled(true);
        selectPreviewAsset(item);
      }
    });
    applyPreviewControllerSettings(compareLevelPreview);
    if (!previewPaused) compareLevelPreview.start();
    return compareLevelPreview;
  }

  function previewControllerForScroll(scroll) {
    if (scroll === previewScroll) return levelPreview;
    if (scroll === previewCompareScroll) return compareLevelPreview;
    return null;
  }

  function previewStackOrigin(scroll) {
    const space = scroll?.querySelector?.('.level-preview-scroll-space');
    const stack = scroll?.querySelector?.('.level-preview-stack');
    return {
      x: Number(space?.offsetLeft || 0) + Number(stack?.offsetLeft || 0),
      y: Number(space?.offsetTop || 0) + Number(stack?.offsetTop || 0)
    };
  }

  function applyPreviewScrollSpace(scroll, controller, layout = null) {
    if (!scroll || !controller?.selection) return;
    const space = scroll.querySelector?.('.level-preview-scroll-space');
    const stack = scroll.querySelector?.('.level-preview-stack');
    if (!space || !stack) return;
    const zoom = Math.max(1, Number(controller.zoom || 1));
    const dimensions = controller.selection.dimensions || {};
    const side = layout?.[controller.selection.visualSource] || null;
    const originX = Number(side?.originX || 0), originY = Number(side?.originY || 0);
    const width = Math.max(Number(layout?.width || 0), originX + Number(dimensions.width || 1));
    const height = Math.max(Number(layout?.height || 0), originY + Number(dimensions.height || 1));
    space.style.width = `${Math.max(1, Math.ceil(width * zoom))}px`;
    space.style.height = `${Math.max(1, Math.ceil(height * zoom))}px`;
    stack.style.left = `${Math.round(originX * zoom)}px`;
    stack.style.top = `${Math.round(originY * zoom)}px`;
  }

  function updatePreviewScrollSpaces() {
    const submap = Number(levelPreview?.selection?.submap ?? -1);
    const layout = previewLayoutMode === 'side-by-side' && submap >= 0
      ? previewResources?.cellShiftMap?.previewSyncLayout?.(submap) || null
      : null;
    applyPreviewScrollSpace(previewScroll, levelPreview, layout);
    applyPreviewScrollSpace(previewCompareScroll, compareLevelPreview, layout);
  }

  function previewScrollMapCenter(scroll, controller) {
    if (!scroll || !controller?.selection) return null;
    const zoom = Math.max(1, Number(controller.zoom || 1));
    const origin = previewStackOrigin(scroll);
    /* Do not clamp to the local map rectangle. Side-by-side mode deliberately
     * creates blank virtual space before/after the shorter presentation, and a
     * center in that blank area still has a meaningful coordinate in the other
     * presentation. Clamping here was the reason panes drifted at map ends. */
    return {
      x: (Number(scroll.scrollLeft || 0) + Number(scroll.clientWidth || 0) / 2 - origin.x) / zoom,
      y: (Number(scroll.scrollTop || 0) + Number(scroll.clientHeight || 0) / 2 - origin.y) / zoom
    };
  }

  function scrollPreviewToMapCenter(scroll, controller, point) {
    if (!scroll || !controller?.selection || !point) return;
    const zoom = Math.max(1, Number(controller.zoom || 1));
    const origin = previewStackOrigin(scroll);
    scroll.scrollLeft = origin.x + Number(point.x || 0) * zoom - Number(scroll.clientWidth || 0) / 2;
    scroll.scrollTop = origin.y + Number(point.y || 0) * zoom - Number(scroll.clientHeight || 0) / 2;
  }

  function mappedPreviewCenter(sourceController, targetController, point) {
    const sourceSelection = sourceController?.selection, targetSelection = targetController?.selection;
    if (!sourceSelection || !targetSelection || !point) return null;
    if (sourceSelection.visualSource === targetSelection.visualSource) return point;
    const submap = Number(sourceSelection.submap);
    const sourceClassic = sourceSelection.visualSource === 'classic';
    const mapped = previewResources?.cellShiftMap?.mapPreviewPixel?.(submap, point.x, point.y, sourceClassic);
    if (mapped) return mapped;
    /* Outside the proven per-cell overlap, use the visual/topological base (not
     * the runtime viewport phase). This path exists only for scroll alignment. */
    const room = previewResources?.cellShiftMap?.runtime.roomForSubmap?.(submap);
    if (!room) return null;
    const base = room.visualBaseOffset || room.runtimeOffset;
    const previewY = Number(room.classicPreviewYOffsetPx || 0);
    return sourceClassic
      ? { x: point.x + base.dxPx, y: point.y - previewY + base.dyPx }
      : { x: point.x - base.dxPx, y: point.y - base.dyPx + previewY };
  }

  function syncPreviewScroll(source, target) {
    if (previewLayoutMode !== 'side-by-side' || previewScrollSyncing || !source || !target) return;
    previewScrollSyncing = true;
    const sourceController = previewControllerForScroll(source), targetController = previewControllerForScroll(target);
    const sourcePoint = previewScrollMapCenter(source, sourceController);
    const mappedPoint = mappedPreviewCenter(sourceController, targetController, sourcePoint);
    if (mappedPoint) {
      scrollPreviewToMapCenter(target, targetController, mappedPoint);
    } else {
      const sx = Math.max(0, source.scrollWidth - source.clientWidth), sy = Math.max(0, source.scrollHeight - source.clientHeight);
      const tx = Math.max(0, target.scrollWidth - target.clientWidth), ty = Math.max(0, target.scrollHeight - target.clientHeight);
      target.scrollLeft = sx > 0 ? (source.scrollLeft / sx) * tx : 0;
      target.scrollTop = sy > 0 ? (source.scrollTop / sy) * ty : 0;
    }
    const release = () => { previewScrollSyncing = false; };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(release);
    else release();
  }

  function schedulePreviewScrollSync(source = previewScroll, target = previewCompareScroll) {
    if (previewLayoutMode !== 'side-by-side' || !source || !target) return;
    const run = () => syncPreviewScroll(source, target);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else run();
  }

  function updatePreviewLayout() {
    previewLayoutMode = previewLayoutSelect?.value === 'side-by-side' ? 'side-by-side' : 'single';
    previewRectangleRecords = [];
    previewEntityTreeSignature = '';
    if (previewComparePane) previewComparePane.hidden = previewLayoutMode !== 'side-by-side';
    previewMapPair?.classList.toggle('is-side-by-side', previewLayoutMode === 'side-by-side');
    if (previewLayoutMode === 'side-by-side' && levelPreview) createCompareLevelPreview();
    updatePreviewSelection();
  }

  function updatePreviewSelection() {
    if (!levelPreview) return;
    const room = selectedPreviewRoom();
    if (!room) return;
    const roomKey = `${Number(room.submap)}:${Number(room.mapId)}`;
    if (previewGeometryRoomKey && previewGeometryRoomKey !== roomKey) { previewGeometrySelection.clear(); previewGeometryActiveId = ''; }
    previewGeometryRoomKey = roomKey;
    const visualSource = previewVisualSourceSelect?.value || 'rdx';
    const spriteSource = visualSource === 'classic' ? 'classic' : 'rdx';
    if (previewSpriteSourceSelect) {
      previewSpriteSourceSelect.value = spriteSource;
      previewSpriteSourceSelect.disabled = true;
    }
    const selectController = (controller, source) => {
      if (!controller) return;
      controller.select({
        submap: Number(room.submap),
        mapId: Number(room.mapId),
        visualSource: source,
        spriteSource: source === 'classic' ? 'classic' : 'rdx',
        missingPolicy: fallbackModeSelect?.value || 'red'
      });
      applyPreviewControllerSettings(controller);
      const noteOverrides = source === 'rdx' ? storedPreviewOverridesForRoom() : [];
      const roomDraft = mapEditorSession.roomDraft(false);
      const editorOverrides = previewWorkspaceMode === 'editor'
        ? Object.entries(roomDraft?.entityOverrides || {})
            .filter(([, entry]) => !entry?.port || String(entry.port) === String(source))
            .map(([overrideKey, entry]) => ({ ...entry, overrideKey }))
        : [];
      controller.replaceManualOverrides([...noteOverrides, ...editorOverrides]);
    };
    selectController(levelPreview, visualSource);
    if (previewPrimaryCaption) previewPrimaryCaption.textContent = visualSource === 'classic' ? 'Classic' : 'RDX';
    if (previewLayoutMode === 'side-by-side') {
      const compare = createCompareLevelPreview();
      const compareSource = previewOppositeSource(visualSource);
      selectController(compare, compareSource);
      if (previewCompareCaption) previewCompareCaption.textContent = compareSource === 'classic' ? 'Classic' : 'RDX';
    }
    clearPreviewEditorSelection();
    applyRoomPatches();
    syncPreviewGeometrySelection();
    setPreviewViewMode(previewViewMode);
    updatePreviewScrollSpaces();
    schedulePreviewScrollSync();
    updatePreviewInstanceStatus();
    renderPreviewUnresolvedCounts();
    previewRectangleRecords = [];
    mapEditorSession.applyCellOverrides();
    mapEditorSession.syncFields();
    if (previewWorkspaceMode === 'editor') mapEditorSession.autoPlaceHero();
    mapEditorSession.updateOverlay();
    renderPreviewSelectionList();
    renderPreviewEntityTree(true);
  }

  function previewNoteContext() {
    const room = selectedPreviewRoom() || {};
    return {
      submap: Number(room.submap ?? 0),
      submapName: room.submapName || actions.smAssetName(room.submap ?? 0),
      mapId: Number(room.mapId ?? 0),
      mapName: room.mapName || actions.mdAssetName(room.mapId ?? 0),
      world: actions.roomGroupLabel(room.group),
      visualSource: previewVisualSourceSelect?.value || 'rdx'
    };
  }

  function currentPreviewRoomKey() {
    const room = selectedPreviewRoom();
    return room ? `${Number(room.submap)}:${Number(room.mapId)}` : '';
  }

  function setPreviewWorkspaceMode(mode = 'preview', { scroll = false } = {}) {
    previewWorkspaceMode = mode === 'editor' ? 'editor' : 'preview';
    const editing = previewWorkspaceMode === 'editor';
    document.body.classList.toggle('rdx-map-editor', editing);
    if (mapEditorPanel) mapEditorPanel.hidden = !editing;
    previewTabButton?.setAttribute('aria-selected', editing ? 'false' : 'true');
    mapEditorTabButton?.setAttribute('aria-selected', editing ? 'true' : 'false');
    if (previewWorkspaceTitle) previewWorkspaceTitle.textContent = editing ? 'Map editor' : 'Whole-map level preview';
    actions.setExpanded(previewOpenButton, !editing && !previewPanel?.hidden);
    actions.setExpanded(mapEditorOpenButton, editing && !previewPanel?.hidden);
    if (editing) {
      setPreviewEditorEnabled(true);
      /* Map Editor opens into one production RDX runtime map with no diagnostics. */
      if (previewVisualSourceSelect) previewVisualSourceSelect.value='rdx';
      if (previewViewSelect) previewViewSelect.value='runtime';
      if (previewLayoutSelect) previewLayoutSelect.value='single';
      previewLayoutMode='single'; previewViewMode='runtime';
      if (previewShowPatrol) previewShowPatrol.checked=false;
      if (previewShowCollision) previewShowCollision.checked=false;
      updatePreviewLayout(); updatePreviewSelection();
    }
    if (playtestOpenButton) { playtestOpenButton.disabled = editing; playtestOpenButton.hidden = editing; }
    mapEditorSession.onWorkspaceModeChanged(editing);
    if (scroll) previewPanel?.scrollIntoView?.({ block:'start', behavior:'smooth' });
    return previewWorkspaceMode;
  }

  function geometrySelectionIds() { return [...previewGeometrySelection.keys()]; }

  function geometryCellSummary(cell) {
    if (!cell) return '';
    const grid = cell.grid ? `g8 ${cell.grid.x},${cell.grid.y}` : 'grid unavailable';
    const logic = cell.provenance?.coordinate?.romLogic
      ? ` · ROM logic ${cell.provenance.coordinate.romLogic.x},${cell.provenance.coordinate.romLogic.y}`
      : cell.logicCell ? ` · visual16 ${cell.logicCell.x},${cell.logicCell.y}` : '';
    const projection = cell.provenance?.projection?.source ? ` · ${cell.provenance.projection.source}` : '';
    return `${cell.id} · ${cell.kindName || cell.kind || 'open'} · ${grid}${logic}${projection} · ${cell.description || ''}`;
  }

  function geometryToneClass(tone = '') {
    return ['suspect','result','compare'].includes(tone) ? ` is-${tone}` : '';
  }

  function appendGeometryFlow(container, nodes = []) {
    const list = document.createElement('ol');
    list.className = 'preview-geometry-flow';
    for (const node of nodes) {
      const item = document.createElement('li');
      item.className = `preview-geometry-flow-node${geometryToneClass(node.tone)}`;
      const head = document.createElement('div'); head.className = 'preview-geometry-flow-head';
      const label = document.createElement('span'); label.className = 'preview-geometry-flow-label'; label.textContent = node.label || '';
      const value = document.createElement('strong'); value.textContent = node.value || '—';
      head.append(label, value); item.append(head);
      if (node.detail) { const detail=document.createElement('span'); detail.className='preview-geometry-flow-detail'; detail.textContent=node.detail; item.append(detail); }
      if (node.sources?.length) {
        const details=document.createElement('details'); details.className='preview-geometry-node-details';
        const summary=document.createElement('summary'); summary.textContent='Source records'; details.append(summary);
        for (const source of node.sources) {
          const row=document.createElement('div'); row.className='preview-geometry-source-row';
          const key=document.createElement('strong'); key.textContent=source.label || 'Source';
          const text=document.createElement('span'); text.textContent=source.detail || source.value || 'unavailable';
          row.append(key,text); details.append(row);
        }
        item.append(details);
      }
      list.append(item);
    }
    container.append(list);
  }

  function renderGeometrySelectionList(cells) {
    if (!previewGeometrySelected) return;
    previewGeometrySelected.replaceChildren();
    if (!cells.length) {
      const empty=document.createElement('span'); empty.className='preview-muted'; empty.textContent='No geometry cells selected.'; previewGeometrySelected.append(empty); return;
    }
    for (const cell of cells) {
      const model=geometryProvenanceViewModel(cell);
      const button=document.createElement('button'); button.type='button'; button.className='preview-geometry-selected-cell'; button.dataset.geometryId=cell.id;
      button.classList.toggle('is-active', cell.id === previewGeometryActiveId);
      button.classList.toggle('is-divergent', !!model?.divergent);
      const id=document.createElement('span'); id.className='preview-geometry-selected-id'; id.textContent=cell.id;
      const state=document.createElement('strong'); state.textContent=model?.headline?.badge === 'DIVERGENCE' ? model.headline.title : `${String(cell.kindName || cell.kind || 'open').toUpperCase()} · ${model?.headline?.badge || 'CELL'}`;
      button.append(id,state);
      button.addEventListener('click',()=>{ previewGeometryActiveId=cell.id; refreshPreviewGeometryUi(); });
      previewGeometrySelected.append(button);
    }
  }

  function renderGeometryProvenance(cell) {
    if (!previewGeometryProvenance) return;
    previewGeometryProvenance.replaceChildren();
    if (!cell) {
      const empty=document.createElement('div'); empty.className='preview-geometry-empty'; empty.textContent='Select any 8×8 cell to inspect its collision decision tree and visual source path.'; previewGeometryProvenance.append(empty); return;
    }
    const model=geometryProvenanceViewModel(cell);
    if (!model) return;

    const summary=document.createElement('section'); summary.className=`preview-geometry-discrepancy ${model.divergent ? 'is-divergent' : 'is-match'}`;
    const badge=document.createElement('span'); badge.className='preview-geometry-discrepancy-badge'; badge.textContent=model.headline.badge;
    const title=document.createElement('strong'); title.textContent=model.headline.title;
    const detail=document.createElement('span'); detail.textContent=model.headline.detail;
    summary.append(badge,title,detail);
    if (model.headline.suspect) { const suspect=document.createElement('p'); suspect.className='preview-geometry-suspect'; suspect.textContent=`Likely discrepancy point: ${model.headline.suspect}`; summary.append(suspect); }
    previewGeometryProvenance.append(summary);

    const grid=document.createElement('div'); grid.className='preview-geometry-path-grid';
    const rdx=document.createElement('section'); rdx.className='preview-geometry-path';
    const rdxTitle=document.createElement('h4'); rdxTitle.textContent=model.source === 'classic' ? 'Classic collision authority' : 'RDX collision authority'; rdx.append(rdxTitle); appendGeometryFlow(rdx, model.collision); grid.append(rdx);
    if (model.classic?.length) {
      const classic=document.createElement('section'); classic.className='preview-geometry-path preview-geometry-classic-path';
      const classicTitle=document.createElement('h4'); classicTitle.textContent='Classic comparison'; classic.append(classicTitle); appendGeometryFlow(classic, model.classic); grid.append(classic);
    }
    previewGeometryProvenance.append(grid);

    if (model.visual) {
      const visual=document.createElement('details'); visual.className='preview-geometry-secondary';
      const visualSummary=document.createElement('summary');
      const visualTitle=document.createElement('strong'); visualTitle.textContent='Visual source path';
      const visualMeta=document.createElement('span'); visualMeta.textContent=`${model.visual.summary} · ${model.visual.note}`;
      visualSummary.append(visualTitle,visualMeta); visual.append(visualSummary);
      const body=document.createElement('div'); body.className='preview-geometry-secondary-body'; appendGeometryFlow(body,model.visual.nodes); visual.append(body); previewGeometryProvenance.append(visual);
    }

    if (model.editorOverride) {
      const override=document.createElement('div'); override.className='preview-geometry-editor-override'; override.textContent=`Map Editor draft override: ${JSON.stringify(model.editorOverride)}`; previewGeometryProvenance.append(override);
    }

    const raw=document.createElement('details'); raw.className='preview-geometry-secondary preview-geometry-raw';
    const rawSummary=document.createElement('summary'); rawSummary.textContent='Raw provenance trace'; raw.append(rawSummary);
    const pre=document.createElement('pre'); pre.textContent=model.raw || ''; raw.append(pre); previewGeometryProvenance.append(raw);
  }

  function refreshPreviewGeometryUi() {
    const shown = !!previewShowCollision?.checked;
    if (previewGeometryPanel) previewGeometryPanel.hidden = !shown;
    const cells = [...previewGeometrySelection.values()];
    const ids = cells.map(cell => cell.id);
    if (!ids.includes(previewGeometryActiveId)) {
      const preferred=cells.find(cell=>geometryProvenanceViewModel(cell)?.divergent) || cells.at(-1) || null;
      previewGeometryActiveId=preferred?.id || '';
    }
    renderGeometrySelectionList(cells);
    renderGeometryProvenance(previewGeometrySelection.get(previewGeometryActiveId) || null);
    if (previewGeometryCopyId) previewGeometryCopyId.disabled = ids.length !== 1;
    if (previewGeometryCopyIds) previewGeometryCopyIds.disabled = ids.length === 0;
    if (previewGeometryCopyTrace) previewGeometryCopyTrace.disabled = ids.length === 0;
    if (previewGeometryClear) previewGeometryClear.disabled = ids.length === 0;
    if (previewGeometryAddNote) previewGeometryAddNote.disabled = ids.length === 0 || !(previewGeometryNote?.value?.trim());
    if (previewGeometryNoteSummary) {
      const notes = previewNotesStore?.geometryNotes?.(previewNoteContext()) || [];
      previewGeometryNoteSummary.textContent = `${notes.length} geometry audit note(s) in this room · notes.json stores stable geometryIds plus the selected cell metadata.`;
    }
  }

  function syncPreviewGeometrySelection() {
    const ids = geometrySelectionIds();
    eachLevelPreview(controller => controller.setGeometrySelection?.(ids));
    refreshPreviewGeometryUi();
  }

  function clearPreviewGeometrySelection({ statusMessage = false } = {}) {
    previewGeometrySelection.clear();
    previewGeometryActiveId = '';
    syncPreviewGeometrySelection();
    if (statusMessage) actions.setStatus('Cleared selected geometry cells.', 'neutral');
  }

  function geometryPointerPoint(canvas, event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x:(event.clientX - rect.left) * canvas.width / Math.max(1, rect.width),
      y:(event.clientY - rect.top) * canvas.height / Math.max(1, rect.height)
    };
  }

  function setGeometryHover(cell, event = null) {
    const text = cell ? geometryCellSummary(cell) : 'Hover any 8×8 cell to inspect collision semantics. Click cells to compare RDX vs Classic and pin the decision tree.';
    if (previewGeometryHover) previewGeometryHover.textContent = text;
    if (!previewGeometryTooltip) return;
    if (!cell || !event) { previewGeometryTooltip.hidden = true; return; }
    previewGeometryTooltip.textContent = text;
    previewGeometryTooltip.hidden = false;
    const margin = 14;
    const maxLeft = Math.max(4, window.innerWidth - 480);
    const maxTop = Math.max(4, window.innerHeight - 110);
    previewGeometryTooltip.style.left = `${Math.max(4, Math.min(maxLeft, event.clientX + margin))}px`;
    previewGeometryTooltip.style.top = `${Math.max(4, Math.min(maxTop, event.clientY + margin))}px`;
  }

  function bindGeometryCanvas(canvas, controllerGetter) {
    if (!canvas) return;
    canvas.addEventListener('pointermove', event => {
      if (!previewShowCollision?.checked) return setGeometryHover(null);
      const controller = controllerGetter();
      const point = geometryPointerPoint(canvas, event);
      setGeometryHover(controller?.geometryCellAt?.(point.x, point.y, { includeOpen:true }) || null, event);
    });
    canvas.addEventListener('pointerleave', () => setGeometryHover(null));
    canvas.addEventListener('click', event => {
      if (!previewShowCollision?.checked) return;
      const controller = controllerGetter();
      const point = geometryPointerPoint(canvas, event);
      const cell = controller?.geometryCellAt?.(point.x, point.y, { includeOpen:true }) || null;
      if (!cell) return;
      if (previewGeometrySelection.has(cell.id)) {
        previewGeometrySelection.delete(cell.id);
        if (previewGeometryActiveId === cell.id) previewGeometryActiveId = '';
      } else {
        previewGeometrySelection.set(cell.id, cell);
        previewGeometryActiveId = cell.id;
      }
      syncPreviewGeometrySelection();
      setGeometryHover(cell, event);
      actions.setStatus(`${previewGeometrySelection.has(cell.id) ? 'Selected' : 'Unselected'} geometry ${cell.id}.`, 'neutral');
      event.preventDefault();
      event.stopPropagation();
    });
  }

  function storedPreviewOverridesForRoom() {
    const context = previewNoteContext();
    const document = previewNotesStore?.snapshot?.();
    const room = document?.rooms?.find(entry => Number(entry.submap) === context.submap && Number(entry.mapId) === context.mapId);
    return (room?.assets || []).filter(asset => asset.assetKey && asset.rdxAssetOverride?.pn != null).map(asset => ({
      overrideKey: asset.assetKey,
      assetKey: asset.assetKey,
      sourceKey: asset.sourceKey,
      pn: Number(asset.rdxAssetOverride.pn),
      actorId: asset.rdxAssetOverride.actorId ?? asset.observed?.actorId ?? 0,
      x: Number(asset.observed?.x || 0),
      y: Number(asset.observed?.y || 0),
      visible: true,
      mirrorX: !!asset.rdxAssetOverride.mirrorX,
      mirrorY: !!asset.rdxAssetOverride.mirrorY,
      quarterTurns: Number(asset.rdxAssetOverride.quarterTurns || 0) & 3,
      direction: asset.rdxAssetOverride.direction || 'neutral',
      front: !!asset.observed?.front,
      category: asset.category || 'object',
      authority: 'preview-note-override'
    }));
  }

  function refreshPreviewNotesUi() {
    const document = previewNotesStore?.snapshot?.() || {};
    if (previewNotesData) previewNotesData.textContent = JSON.stringify(document, null, 2);
    const assetCount = (document.rooms || []).reduce((sum, room) => sum + (room.assets?.length || 0), 0);
    const geometryNoteCount = (document.rooms || []).reduce((sum, room) => sum + (room.geometryNotes?.length || 0), 0);
    if (previewNotesDownload) previewNotesDownload.disabled = assetCount + geometryNoteCount === 0;
    refreshPreviewGeometryUi();
    refreshPreviewOperationUi();
  }

  function selectedPreviewPatch() {
    if (!previewSelectedAsset) return null;
    return previewPatchStore.patch(previewNoteContext(), previewSelectedAsset, false);
  }

  function patchHasPositionIntent(patch) {
    return Number(patch?.change?.dx || 0) !== 0 || Number(patch?.change?.dy || 0) !== 0;
  }

  function patchHasVisibilityIntent(patch) {
    return (patch?.observed?.visible !== false) !== (patch?.change?.enabled !== false);
  }

  function patchOverrideForItem(item, patch) {
    const target = patchTargetState(patch);
    /* A bug-note-only patch must not freeze the coordinates that happened to be
     * visible when the note was written.  This matters for mark:94: its v2.1.32
     * note was authored while the preview itself was at a synthetic x=240. */
    const move = patchHasPositionIntent(patch);
    return {
      overrideKey: previewAssetKey(item),
      sourceKey: item.sourceKey || null,
      instanceKey: item.instanceKey || null,
      traceCollection: item.traceCollection || null,
      x: move ? target.x : Number(item.x || 0),
      y: move ? target.y : Number(item.y || 0),
      visible: patchHasVisibilityIntent(patch) ? target.enabled : item.visible !== false,
      authority: 'patch-workbench'
    };
  }

  function applyPatchToPreview(item, patch, { render = true } = {}) {
    if (!levelPreview || !item || !patch) return;
    const target = patchTargetState(patch);
    if (item.debugOnly) {
      const move = patchHasPositionIntent(patch);
      levelPreview.setDebugElementPatch(item.elementId, {
        targetX: move ? target.x : Number(item.x || 0), targetY: move ? target.y : Number(item.y || 0),
        enabled: patchHasVisibilityIntent(patch) ? target.enabled : item.visible !== false, bugged: target.bugged
      });
    } else if (item.sourceKey) {
      levelPreview.renderer?.setPatchOverride?.(previewAssetKey(item), patchOverrideForItem(item, patch));
      if (render) levelPreview.render(true);
    }
  }

  function patchResolvedItem(patch) {
    if (!levelPreview || !patch) return null;
    return levelPreview.elementForPatch?.(patch, true) || levelPreview.elementById?.(patch.elementId, true) || null;
  }

  function patchMatchesProduction(item, patch) {
    const target = patchTargetState(patch);
    if (!item) return patchHasVisibilityIntent(patch) && target.enabled === false;
    const samePosition = !patchHasPositionIntent(patch) ||
      (Math.round(Number(item.x || 0)) === Math.round(target.x) && Math.round(Number(item.y || 0)) === Math.round(target.y));
    const sameVisibility = !patchHasVisibilityIntent(patch) || (item.visible !== false) === (target.enabled !== false);
    return samePosition && sameVisibility;
  }

  function patchFallbackItem(patch) {
    const observedBounds = patch.observed?.bounds || [patch.observed?.x || 0, patch.observed?.y || 0, 1, 1];
    return {
      elementId: patch.elementId, elementKind: patch.elementKind, sourceKey: patch.sourceKey, instanceKey: patch.instanceKey || null, traceCollection: patch.traceCollection || null,
      port: patch.port || 'preview', kind: patch.elementKind || 'element', category: patch.category || 'unclassified',
      debugOnly: !!patch.debugOnly, x: Number(patch.observed?.x || 0), y: Number(patch.observed?.y || 0),
      visible: patch.observed?.visible !== false,
      bounds: { x: Number(observedBounds[0] || 0), y: Number(observedBounds[1] || 0), width: Number(observedBounds[2] || 1), height: Number(observedBounds[3] || 1) },
      authority: patch.observed?.authority || 'patch-workbench-observed'
    };
  }

  function applyRoomPatches() {
    if (!levelPreview) return;
    levelPreview.renderer?.clearPatchOverrides?.();
    levelPreview.clearDebugElementPatches?.();
    levelPreview.render(true);

    /* Export history and desired visual state are intentionally separate.
     * A patch that was already downloaded/imported is still a desired-state
     * overlay until production itself matches its absolute target.  v2.1.31
     * incorrectly used diff-baseline status as an instruction to stop applying
     * the patch, which made moved entities snap back after download/reload. */
    previewPatchApplyStatus = new Map();
    const entries = previewPatchStore.entriesForRoom(previewNoteContext());
    if (previewPatchesDisabled) {
      for (const patch of entries) previewPatchApplyStatus.set(patch.elementId, 'disabled');
      levelPreview?.setPatchGuide?.(null);
      return;
    }
    let needsFinalRender = false;
    for (const patch of entries) {
      const resolved = patchResolvedItem(patch);
      const integrated = patchMatchesProduction(resolved, patch);
      const status = resolved ? (integrated ? 'integrated' : 'overlay') : (patchTargetState(patch).enabled === false ? 'integrated' : 'unresolved');
      previewPatchApplyStatus.set(patch.elementId, status);
      if (integrated) continue;
      const item = resolved || patchFallbackItem(patch);
      if (!item) continue;
      applyPatchToPreview(item, patch, { render: false });
      needsFinalRender = true;
    }
    if (needsFinalRender) levelPreview.render(true);
    else levelPreview?.setPatchGuide?.(null);
  }

  function patchIsMeaningful(patch) {
    return !!patch && (Number(patch.change?.dx || 0) !== 0 || Number(patch.change?.dy || 0) !== 0 ||
      patch.change?.enabled === false || !!String(patch.change?.bugged || '').trim());
  }

  function transientPreviewPatch(item, changes = {}) {
    const existing = previewPatchStore.patch(previewNoteContext(), item, false);
    const bounds = item?.bounds || { x: Number(item?.x || 0), y: Number(item?.y || 0), width: 1, height: 1 };
    const observed = existing?.observed || {
      x: Number(item?.x || 0), y: Number(item?.y || 0),
      bounds: [Number(bounds.x || 0), Number(bounds.y || 0), Math.max(1, Number(bounds.width || 1)), Math.max(1, Number(bounds.height || 1))],
      visible: item?.visible !== false, authority: item?.authority || null
    };
    const change = {
      dx: Number(existing?.change?.dx || 0), dy: Number(existing?.change?.dy || 0),
      enabled: existing?.change?.enabled !== false, bugged: String(existing?.change?.bugged || ''), ...changes
    };
    const tx = changes.x != null ? Number(changes.x) : Number(observed.x || 0) + Number(change.dx || 0);
    const ty = changes.y != null ? Number(changes.y) : Number(observed.y || 0) + Number(change.dy || 0);
    const ob = observed.bounds || [observed.x || 0, observed.y || 0, 1, 1];
    const ddx = tx - Number(observed.x || 0), ddy = ty - Number(observed.y || 0);
    return {
      elementId: item.elementId, sourceKey: item.sourceKey || null, observed,
      target: { x:tx, y:ty, bounds:[Number(ob[0] || 0)+ddx, Number(ob[1] || 0)+ddy, Number(ob[2] || 1), Number(ob[3] || 1)], visible:change.enabled !== false },
      change: { ...change, dx:ddx, dy:ddy }
    };
  }

  function refreshSelectedPatchControls() {
    const patch = selectedPreviewPatch();
    const selected = !!previewSelectedAsset;
    const target = patch ? patchTargetState(patch) : { x:Number(previewSelectedAsset?.x || 0), y:Number(previewSelectedAsset?.y || 0), enabled:previewSelectedAsset?.visible !== false, bugged:'', dx:0, dy:0 };
    const observed = patch?.observed || (selected ? { x:Number(previewSelectedAsset.x || 0), y:Number(previewSelectedAsset.y || 0), bounds:[previewSelectedAsset.bounds?.x || previewSelectedAsset.x || 0, previewSelectedAsset.bounds?.y || previewSelectedAsset.y || 0, previewSelectedAsset.bounds?.width || 1, previewSelectedAsset.bounds?.height || 1] } : null);

    if (previewPatchSelected) previewPatchSelected.textContent = selected ? `${String(previewSelectedAsset.category || previewSelectedAsset.kind || 'element').toUpperCase()} · ${previewSelectedAsset.sourceKey || previewSelectedAsset.elementId}` : 'Click an outlined element or sprite on the map.';
    if (previewPatchSelectedId) previewPatchSelectedId.textContent = selected ? (previewSelectedAsset.elementId || '') : '';
    if (previewPatchCopyId) previewPatchCopyId.disabled = !selected || !previewSelectedAsset?.elementId;
    if (previewPatchX) { previewPatchX.disabled = !selected; previewPatchX.value = selected ? String(Math.round(target.x)) : ''; }
    if (previewPatchY) { previewPatchY.disabled = !selected; previewPatchY.value = selected ? String(Math.round(target.y)) : ''; }
    if (previewPatchObserved) previewPatchObserved.textContent = observed ? `${Math.round(Number(observed.x || 0))}, ${Math.round(Number(observed.y || 0))}` : '—';
    if (previewPatchDelta) previewPatchDelta.textContent = patch ? `${target.dx >= 0 ? '+' : ''}${target.dx}, ${target.dy >= 0 ? '+' : ''}${target.dy}` : '0, 0';
    if (previewPatchEnabled) { previewPatchEnabled.disabled = !selected; previewPatchEnabled.checked = target.enabled !== false; }
    if (previewPatchBugged) { previewPatchBugged.disabled = !selected; previewPatchBugged.value = target.bugged || ''; }
    if (previewPatchRevert) previewPatchRevert.disabled = !selected || !patch;

    const state = patch ? (previewPatchApplyStatus.get(patch.elementId) || (previewPatchStore.isPatchDirty(previewNoteContext(), patch) ? 'overlay' : 'saved')) : (selected ? 'ready' : 'none');
    if (previewPatchState) {
      previewPatchState.className = `preview-patch-state${state === 'overlay' ? ' is-overlay' : state === 'integrated' ? ' is-integrated' : state === 'unresolved' ? ' is-unresolved' : ''}`;
      previewPatchState.textContent = ({
        integrated:'Production matches this target', overlay:'Desired target active as preview overlay', unresolved:'Target source not resolved in this build', disabled:'Patch overlay disabled for audit', saved:'Saved review target', ready:'Drag or type X/Y to create a patch', none:'No patch selected'
      })[state] || state;
    }

    if (patch && observed) {
      const ob = Array.isArray(observed.bounds) ? observed.bounds : [observed.x || 0, observed.y || 0, 1, 1];
      const tb = Array.isArray(patch.target?.bounds) ? patch.target.bounds : [Number(ob[0] || 0)+target.dx, Number(ob[1] || 0)+target.dy, Number(ob[2] || 1), Number(ob[3] || 1)];
      levelPreview?.setPatchGuide?.({
        fromBounds:{x:Number(ob[0] || 0),y:Number(ob[1] || 0),width:Number(ob[2] || 1),height:Number(ob[3] || 1)},
        toBounds:{x:Number(tb[0] || 0),y:Number(tb[1] || 0),width:Number(tb[2] || 1),height:Number(tb[3] || 1)}
      });
    } else levelPreview?.setPatchGuide?.(null);
  }

  function scrollPreviewToItem(item) { scrollPreviewControllerToItem(levelPreview, item); }

  function selectPatchById(elementId) {
    if (!levelPreview) return;
    let item = levelPreview.elementById(elementId, true);
    if (!item) {
      const patch = previewPatchStore.entriesForRoom(previewNoteContext()).find(row => row.elementId === elementId);
      if (patch) {
        const target = patchTargetState(patch);
        const observedBounds = patch.observed?.bounds || [target.x, target.y, 1, 1];
        item = {
          elementId: patch.elementId, elementKind: patch.elementKind, sourceKey: patch.sourceKey, instanceKey: patch.instanceKey || null, traceCollection: patch.traceCollection || null,
          port: patch.port || 'preview', kind: patch.elementKind || 'element', category: patch.category || 'unclassified',
          debugOnly: !!patch.debugOnly, x: target.x, y: target.y, visible: target.enabled,
          bounds: { x: Number(observedBounds[0]) + target.dx, y: Number(observedBounds[1]) + target.dy,
            width: Number(observedBounds[2] || 1), height: Number(observedBounds[3] || 1) },
          authority: 'patch-workbench-disabled-element'
        };
      }
    }
    if (item) {
      selectPreviewAsset(item);
      scrollPreviewToItem(item);
    }
  }

  function refreshPreviewPatchesUi() {
    const context = previewNoteContext();
    const patchDocument = previewPatchStore?.diffSnapshot?.() || {};
    if (previewPatchesData) previewPatchesData.textContent = JSON.stringify(patchDocument, null, 2);
    const diffCount = (patchDocument.rooms || []).reduce((sum, room) => sum + (room.patches?.length || 0), 0);
    if (previewPatchesDownload) {
      previewPatchesDownload.disabled = diffCount === 0;
      previewPatchesDownload.textContent = diffCount ? `Download pending diff (${diffCount})` : 'Download pending diff';
    }
    const allEntries = previewPatchStore.entriesForRoom(context).filter(patchIsMeaningful);
    if (previewPatchCount) previewPatchCount.textContent = `${allEntries.length} room ${allEntries.length === 1 ? 'change' : 'changes'} · ${diffCount} pending integration`;

    if (previewPatchList) {
      previewPatchList.replaceChildren();
      if (!allEntries.length) previewPatchList.textContent = 'No patches in this room.';
      for (const patch of allEntries) {
        const dirty = previewPatchStore.isPatchDirty(context, patch);
        const target = patchTargetState(patch);
        const status = previewPatchApplyStatus.get(patch.elementId) || (dirty ? 'overlay' : 'saved');
        const row = document.createElement('div');
        row.className = `preview-patch-row${patch.change?.enabled === false ? ' is-disabled' : ''}${patch.change?.bugged ? ' is-bugged' : ''}${dirty ? ' is-diff' : ' is-baseline'}`;

        const main = document.createElement('div');
        main.className = 'preview-patch-row-main';
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = patch.elementId;
        button.title = 'Select this patch and scroll the map to its exact target';
        button.addEventListener('click', () => selectPatchById(patch.elementId));
        const summary = document.createElement('span');
        summary.className = 'preview-patch-row-meta';
        const delta = `Δ ${target.dx >= 0 ? '+' : ''}${target.dx},${target.dy >= 0 ? '+' : ''}${target.dy}`;
        summary.textContent = [`target ${Math.round(target.x)},${Math.round(target.y)}`, delta, patch.change?.enabled === false ? 'disabled' : 'enabled', `introduced v${patch.introducedInVersion || 'unknown'}`, dirty ? 'new diff' : 'saved'].join(' · ');
        main.append(button, summary);
        if (patch.change?.bugged) {
          const note = document.createElement('span');
          note.className = 'preview-patch-row-note';
          note.textContent = String(patch.change.bugged);
          main.append(note);
        }

        const actions = document.createElement('div');
        actions.className = 'preview-patch-row-actions';
        const badge = document.createElement('span');
        badge.className = `preview-patch-row-badge${status === 'overlay' ? ' is-overlay' : status === 'integrated' ? ' is-integrated' : status === 'unresolved' ? ' is-unresolved' : ''}`;
        badge.textContent = ({integrated:'integrated',overlay:'preview overlay',unresolved:'unresolved',saved:'saved'})[status] || status;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'preview-patch-remove';
        remove.textContent = 'Remove';
        remove.title = 'Remove this review patch entry';
        remove.addEventListener('click', event => {
          event.stopPropagation();
          previewPatchStore.remove(context, patch.elementId);
          applyRoomPatches();
          refreshPreviewPatchesUi();
          if (previewSelectedAsset?.elementId === patch.elementId) clearPreviewEditorSelection();
          actions.setStatus(`Removed ${patch.elementId} from the patch workbench.`, 'neutral');
        });
        actions.append(badge, remove);
        row.append(main, actions);
        previewPatchList.append(row);
      }
    }
    refreshSelectedPatchControls();
  }

  function renderPreviewShiftLegend() {
    if (!previewShiftLegend || !previewShiftValues) return;
    previewShiftLegend.hidden = previewViewMode !== 'shift';
    if (previewViewMode !== 'shift') return;
    const room = selectedPreviewRoom();
    const shifts = previewResources?.cellShiftMap;
    const entries = shifts?.shiftEntries?.(room?.submap) || [];
    const shiftRoom = shifts?.runtime.roomForSubmap?.(room?.submap) || null;
    const corrections = (shifts?.correctionEntries?.(room?.submap) || []).filter(entry => entry.dxPx || entry.dyPx);
    if (!entries.length) {
      previewShiftValues.textContent = 'Shift table unavailable for this room.';
      return;
    }
    const format = entry => {
      const axes = [
        `X ${entry.dxPx >= 0 ? '+' : ''}${entry.dxPx}px`,
        `Y ${entry.dyPx >= 0 ? '+' : ''}${entry.dyPx}px`
      ].join(', ');
      return `${axes} · ${entry.count} cells`;
    };
    const mapText = entries.map(format).join(' · ');
    const correctionText = corrections.length
      ? `Live-switch runtime-relative correction: ${corrections.map(format).join(' · ')}`
      : 'Live-switch runtime-relative correction: none (visual correspondence matches the native runtime projection).';
    const alignmentText = shiftRoom && (shiftRoom.canonicalOffset?.dxPx !== shiftRoom.runtimeOffset?.dxPx || shiftRoom.canonicalOffset?.dyPx !== shiftRoom.runtimeOffset?.dyPx)
      ? ` Alignment basis: ${shiftRoom.visualBaseBasis === 'runtime-static-overlap' ? 'runtime phase selected by stronger static-map overlap' : 'canonical topology; runtime viewport phase kept separate'}.`
      : '';
    previewShiftValues.textContent = `Classic→RDX map displacement: ${mapText}. ${correctionText}${alignmentText}`;
  }

  function setPreviewViewMode(mode) {
    previewViewMode = ['patches', 'no-overlap', 'placement', 'shift'].includes(mode) ? mode : 'runtime';
    if (previewViewSelect) previewViewSelect.value = previewViewMode;
    document.body.classList.toggle('rdx-preview-patches', previewViewMode === 'patches');
    document.body.classList.toggle('rdx-preview-no-overlap', previewViewMode === 'no-overlap');
    document.body.classList.toggle('rdx-preview-placement', previewViewMode === 'placement');
    if (previewPatchesPanel) previewPatchesPanel.hidden = previewViewMode !== 'patches';
    if (previewNoOverlapPanel) previewNoOverlapPanel.hidden = previewViewMode !== 'no-overlap';
    if (previewPlacementPanel) previewPlacementPanel.hidden = previewViewMode !== 'placement';
    levelPreview?.setPatchMode?.(previewViewMode === 'patches');
    compareLevelPreview?.setPatchMode?.(previewViewMode === 'patches');
    levelPreview?.setNoOverlapMode?.(previewViewMode === 'no-overlap');
    compareLevelPreview?.setNoOverlapMode?.(previewViewMode === 'no-overlap');
    levelPreview?.setPlacementMode?.(previewViewMode === 'placement');
    compareLevelPreview?.setPlacementMode?.(previewViewMode === 'placement');
    levelPreview?.setShowShift?.(previewViewMode === 'shift');
    compareLevelPreview?.setShowShift?.(previewViewMode === 'shift');
    if (['patches', 'no-overlap', 'placement'].includes(previewViewMode)) {
      if (previewShowPatrol) previewShowPatrol.checked = true;
      levelPreview?.setShowPatrol(true); compareLevelPreview?.setShowPatrol(true);
      const filter = previewViewMode === 'no-overlap' ? 'no-overlap' : previewViewMode === 'placement' ? 'placement' : (previewDebugFilter?.value || 'all');
      if (previewViewMode !== 'patches' && previewDebugFilter) previewDebugFilter.value = filter;
      levelPreview?.setDebugFilter?.(filter); compareLevelPreview?.setDebugFilter?.(filter);
    } else {
      levelPreview?.setShowPatrol(!!previewShowPatrol?.checked); compareLevelPreview?.setShowPatrol(!!previewShowPatrol?.checked);
      if (['no-overlap','placement'].includes(previewDebugFilter?.value)) previewDebugFilter.value = 'all';
      levelPreview?.setDebugFilter?.(previewDebugFilter?.value || 'all'); compareLevelPreview?.setDebugFilter?.(previewDebugFilter?.value || 'all');
    }
    setPreviewEditorEnabled(previewEditEnabled);
    refreshPreviewPatchesUi();
    if (previewViewMode === 'no-overlap') refreshNoOverlapUi();
    if (previewViewMode === 'placement') refreshPlacementUi();
    renderPreviewShiftLegend();
  }

  function refreshNoOverlapUi() {
    if (!previewNoOverlapList || !levelPreview) return;
    const items = levelPreview.selectionCandidates?.(true)?.filter(item =>
      item?.category === 'no-overlap' || String(item?.classification || '').includes('missing') ||
      String(item?.classification || '').includes('without-visible') || String(item?.classification || '').startsWith('candidate-') ||
      String(item?.elementId || '').includes('missing-rdx')) || [];
    previewNoOverlapList.replaceChildren();
    const context = previewNoteContext();
    const classifications = new Map();
    for (const item of items) classifications.set(item.classification || 'missing-rdx-entity', (classifications.get(item.classification || 'missing-rdx-entity') || 0) + 1);
    const classSummary = [...classifications.entries()].map(([name,count]) => `${count} ${name}`).join(' · ');
    if (previewNoOverlapSummary) previewNoOverlapSummary.textContent = items.length
      ? `${items.length} Classic↔RDX presence diagnostic(s) in ${context.submapName} / ${context.mapName}${classSummary ? ` · ${classSummary}` : ''}. Active Classic hazards require an RDX gameplay/visual counterpart; click a row for exact evidence.`
      : `No unresolved Classic↔RDX presence diagnostics remain in ${context.submapName} / ${context.mapName}.`;
    for (const item of items) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'preview-no-overlap-item';
      const main = document.createElement('span');
      const strong = document.createElement('strong'); strong.textContent = item.sourceKey || item.elementId || 'unmatched element';
      const detail = document.createElement('span');
      const classification = item.classification || 'missing-rdx-entity';
      detail.textContent = `${item.subjectCategory || item.kind || 'gameplay'} · ${classification}${item.assetFamily ? ` · ${item.assetFamily}` : ''} · ${item.bounds ? `[${item.bounds.x},${item.bounds.y},${item.bounds.width},${item.bounds.height}]` : 'bounds unavailable'}`;
      main.append(strong, detail);
      const badge = document.createElement('span'); badge.className = 'preview-no-overlap-badge';
      badge.textContent = classification === 'missing-rdx-hazard-effect' ? 'missing hazard'
        : classification === 'rdx-hazard-effect-without-visible-entity' ? 'missing visual'
        : classification === 'candidate-rdx-hazard-entity-unlinked' ? 'review hazard link'
        : classification === 'candidate-rdx-hazard-visual-unclassified' ? 'review visual'
        : 'missing entity';
      button.append(main, badge);
      button.addEventListener('click', () => { setPreviewEditorEnabled(true); selectPreviewAsset(item); });
      previewNoOverlapList.append(button);
    }
  }

  function placementRowMatchesFilters(row) {
    const category = previewPlacementCategory?.value || 'all';
    const status = previewPlacementStatus?.value || 'issues';
    const subject = String(row?.subjectCategory || '');
    if (category !== 'all' && subject !== category && !(category === 'actor' && ['actor','projectile'].includes(subject))) return false;
    const rowStatus = String(row?.status || '');
    if (status === 'issues') return PLACEMENT_ISSUE_STATUSES.has(rowStatus);
    if (status === 'reviewed') return ['reviewed','missing, accepted','intentional-entry-spawn'].includes(rowStatus);
    if (status !== 'all') return rowStatus === status;
    return true;
  }

  function placementRowIdentity(room, row) {
    return `${Number(room?.submap)}:${Number(room?.mapId)}:${String(row?.id || row?.sourceKey || '')}:${String(row?.subjectCategory || '')}`;
  }

  function placementRowsForCurrentRoom() {
    const room = selectedPreviewRoom();
    if (!room) return [];
    const auditRoom = (previewResources?.placementAudit?.rooms || []).find(row =>
      Number(row.submap) === Number(room.submap) && Number(row.mapId) === Number(room.mapId));
    return [...(auditRoom?.items || [])].filter(placementRowMatchesFilters);
  }

  function placementRowsGlobal() {
    const out = [];
    for (const auditRoom of previewResources?.placementAudit?.rooms || []) {
      for (const row of auditRoom?.items || []) if (placementRowMatchesFilters(row)) out.push({ auditRoom, row });
    }
    out.sort((a,b) => Number(a.auditRoom.submap)-Number(b.auditRoom.submap) || Number(a.auditRoom.mapId)-Number(b.auditRoom.mapId) ||
      String(a.row.sourceKey || a.row.id || '').localeCompare(String(b.row.sourceKey || b.row.id || '')) ||
      String(a.row.subjectCategory || '').localeCompare(String(b.row.subjectCategory || '')));
    return out;
  }

  function rdxPreviewController() {
    return [levelPreview, compareLevelPreview].find(controller => controller?.selection?.visualSource === 'rdx') || null;
  }

  function placementCandidate(row) {
    const controller = rdxPreviewController();
    if (!controller || !row) return null;
    return controller.selectionCandidates?.(true)?.find(item => item.debugOnly && item.category === 'placement' &&
      String(item.sourceKey || '') === String(row.sourceKey || '') &&
      String(item.subjectCategory || item.debugRow?.subjectCategory || '') === String(row.subjectCategory || '')) || null;
  }

  function previewScrollForController(controller) {
    return controller === compareLevelPreview ? previewCompareScroll : previewScroll;
  }

  function scrollPreviewControllerToBounds(controller, bounds, behavior = 'smooth') {
    const scroll = previewScrollForController(controller);
    if (!scroll || !controller || !bounds) return;
    const zoom = Number(controller.zoom || 1);
    const origin = previewStackOrigin(scroll);
    const centerX = origin.x + (Number(bounds.x || 0) + Number(bounds.width || 1) / 2) * zoom;
    const centerY = origin.y + (Number(bounds.y || 0) + Number(bounds.height || 1) / 2) * zoom;
    scroll.scrollTo({
      left:Math.max(0, Math.round(centerX - scroll.clientWidth / 2)),
      top:Math.max(0, Math.round(centerY - scroll.clientHeight / 2)),
      behavior
    });
  }

  function scrollPreviewControllerToItem(controller, item, behavior = 'smooth') {
    scrollPreviewControllerToBounds(controller, item?.bounds, behavior);
  }

  function visiblePreviewControllers() {
    const out = [];
    if (levelPreview) out.push(['primary', levelPreview]);
    /* A compare controller may stay alive after the user returns to Single.
     * Selection/tree/rectangle inspection must describe what is actually on
     * screen, not every controller object that happens to be cached. */
    if (previewLayoutMode === 'side-by-side' && compareLevelPreview) out.push(['compare', compareLevelPreview]);
    return out;
  }

  function previewControllerRecords() {
    const out = [];
    for (const [side, controller] of visiblePreviewControllers()) {
      for (const item of controller.selectionCandidates?.(true) || []) out.push({ side, controller, item });
    }
    return out;
  }

  function previewItemCategory(item = {}) {
    const raw = String(item.category || item.subjectCategory || item.kind || item.policy?.family || 'actor').toLowerCase();
    if (raw.includes('moving-platform') || raw === 'platform') return 'platform';
    if (raw.includes('projectile-shooter') || raw === 'shooter') return 'projectile-shooter';
    if (raw.includes('projectile')) return 'projectile';
    if (raw.includes('enemy')) return 'enemy';
    if (raw.includes('collectible')) return 'collectible';
    if (raw.includes('activator')) return 'activator';
    if (raw.includes('hazard') || raw.includes('trap')) return 'trap';
    if (raw.includes('block')) return 'blockage';
    return 'actor';
  }

  function previewRecordKey(record) {
    return `${record?.side || 'primary'}|${record?.item?.elementId || record?.item?.id || previewAssetKey(record?.item)}`;
  }

  function setPreviewRecordVisible(record, visible) {
    if (!record?.controller || !record?.item) return;
    const key = previewRecordKey(record);
    previewEntityVisibility.set(key, !!visible);
    const item = record.item;
    if (item.debugOnly) {
      record.controller.setDebugElementPatch?.(item.elementId, visible ? null : { enabled:false });
    } else {
      const overrideKey = previewAssetKey(item);
      record.controller.setManualOverride?.(overrideKey, visible ? null : { visible:false });
    }
    renderPreviewSelectionList();
    renderPreviewEntityTree(true);
  }

  function previewRecordVisible(record) { return previewEntityVisibility.get(previewRecordKey(record)) !== false; }

  function jumpToPreviewRecord(record) {
    if (!record?.controller || !record?.item) return;
    const { controller, item } = record;
    if (previewViewMode !== 'patches') setPreviewEditorEnabled(true);
    selectPreviewAsset(item);
    controller.setEditorSelection?.(item.elementId || item.id || null);
    scrollPreviewControllerToItem(controller, item);
  }

  function jumpToPreviewCounterpart(record) {
    const other = record?.controller === levelPreview ? compareLevelPreview : levelPreview;
    if (!other || !record?.item) return;
    const sourceKey = String(record.item.sourceKey || record.item.parentSourceKey || '');
    if (!sourceKey) return;
    const candidate = (other.selectionCandidates?.(true) || []).find(item => String(item.sourceKey || item.parentSourceKey || '') === sourceKey);
    if (!candidate) { actions.setStatus(`No opposite-presentation counterpart found for ${sourceKey}.`, 'warn'); return; }
    jumpToPreviewRecord({ side: other === compareLevelPreview ? 'compare' : 'primary', controller:other, item:candidate });
  }

  function createPreviewEntityRow(record) {
    const row = document.createElement('div');
    const category = previewItemCategory(record.item);
    row.className = `preview-entity-row preview-entity-${category}`;
    if (record.item.patchedPlacement || record.item.patchBugged || String(record.item.policy?.family || '') === 'patch') row.classList.add('is-patched');
    const show = document.createElement('input'); show.type='checkbox'; show.checked=previewRecordVisible(record); show.title='Show/hide this preview entity';
    show.addEventListener('change', () => setPreviewRecordVisible(record, show.checked));
    const label = document.createElement('button'); label.type='button'; label.className='preview-entity-jump';
    label.textContent = `${String(record.item.port || record.controller.selection?.visualSource || '').toUpperCase()} · ${record.item.sourceKey || record.item.elementId || record.item.id} · ${category}${record.item.activatorType ? ` · activation ${record.item.activatorType}` : ''}`;
    label.title = record.item.elementId || ''; label.addEventListener('click', () => jumpToPreviewRecord(record));
    const cross = document.createElement('button'); cross.type='button'; cross.className='preview-entity-cross'; cross.textContent='↔'; cross.title='Jump to Classic/RDX counterpart';
    cross.addEventListener('click', () => jumpToPreviewCounterpart(record));
    row.append(show,label,cross);
    return row;
  }

  function renderPreviewSelectionList() {
    if (!previewSelectionList) return;
    previewSelectionList.replaceChildren();
    if (!previewRectangleRecords.length) { const m=document.createElement('span');m.className='preview-muted';m.textContent='No rectangle selection.';previewSelectionList.append(m); return; }
    for (const record of previewRectangleRecords) previewSelectionList.append(createPreviewEntityRow(record));
  }

  function renderPreviewEntityTree(force = false) {
    if (!previewEntityTree) return;
    const records = previewControllerRecords();
    const signature = records.map(r=>`${previewRecordKey(r)}:${previewRecordVisible(r)?1:0}:${r.item.patchedPlacement?1:0}`).join('|');
    if (!force && signature === previewEntityTreeSignature) return;
    previewEntityTreeSignature = signature;
    previewEntityTree.replaceChildren();
    const grouped = new Map();
    for (const record of records) { const category=previewItemCategory(record.item); if(!grouped.has(category))grouped.set(category,[]); grouped.get(category).push(record); }
    const order=['enemy','platform','projectile-shooter','projectile','trap','collectible','activator','blockage','actor'];
    for (const category of order) {
      const rows=grouped.get(category); if(!rows?.length) continue;
      const details=document.createElement('details'); details.open=['platform','trap'].includes(category);
      const summary=document.createElement('summary'); summary.textContent=`${category.replaceAll('-',' ')} (${rows.length})`; details.append(summary);
      const list=document.createElement('div'); list.className='preview-entity-list';
      for(const record of rows.sort((a,b)=>String(a.item.sourceKey||a.item.elementId||'').localeCompare(String(b.item.sourceKey||b.item.elementId||'')))) list.append(createPreviewEntityRow(record));
      details.append(list); previewEntityTree.append(details);
    }
  }

  function normalizeSelectionRect(start, end) {
    const x=Math.min(start.x,end.x), y=Math.min(start.y,end.y);
    return { x, y, width:Math.max(1,Math.abs(end.x-start.x)), height:Math.max(1,Math.abs(end.y-start.y)) };
  }

  function finishPreviewRectangleSelection(rect) {
    previewRectangleRecords = [];
    for (const [side, controller] of visiblePreviewControllers()) {
      for (const item of controller.elementsInRect?.(rect,true) || []) previewRectangleRecords.push({side,controller,item});
    }
    const seen=new Set(); previewRectangleRecords=previewRectangleRecords.filter(r=>{const k=previewRecordKey(r);if(seen.has(k))return false;seen.add(k);return true;});
    if (previewRectangleGeometry?.checked) {
      const cells=[];
      for (const [, controller] of visiblePreviewControllers()) cells.push(...(controller.geometryCellsInRect?.(rect)||[]));
      for (const cell of cells) previewGeometrySelection.set(cell.id, cell);
      if (!previewGeometryActiveId && cells.length) previewGeometryActiveId = cells[0].id;
      syncPreviewGeometrySelection();
    }
    renderPreviewSelectionList(); renderPreviewEntityTree(true);
    if (previewRectangleRecords.length) actions.setStatus(`Rectangle selected ${previewRectangleRecords.length} entity/diagnostic item(s)${previewRectangleGeometry?.checked ? ' plus geometry cells' : ''}.`, 'ok');
    else actions.setStatus('Rectangle contains no selectable entities.', 'neutral');
  }

  function previewInstanceRecordCategory(record, collection = '') {
    const role = String(record?.role || record?.kind || '').toLowerCase();
    const pn = Number(record?.pn ?? record?.auditSamples?.[0]?.pn ?? record?.samples?.[0]?.pn ?? -1);
    const sourceKey = String(record?.sourceKey || record?.triggerSourceKey || '');
    if (collection === 'activators') return 'activator';
    /* PN24/PN66 identify the reviewed moving-platform controllers in the
     * resolved presentation projection. Keep this classification at the
     * presentation/catalog boundary so mark:117 is never mislabeled as generic
     * walk-through scenery. */
    if (collection === 'actors' && sourceKey.startsWith('mark:') && (pn === 24 || pn === 66)) return 'platform';
    if (role === 'enemy') return 'enemy';
    if (role === 'shooter' || role === 'projectile-shooter') return 'projectile-shooter';
    if (role === 'projectile') return 'projectile';
    if (role === 'collectible') return 'collectible';
    if (role === 'trap' || role === 'hazard' || /mechanism/.test(role)) return 'trap';
    if (/block|rubble|wall|door|explod|destroy/.test(role)) return 'blockage';
    return '';
  }

  function previewInstanceBounds(record, collection = '') {
    if (collection === 'activators' && Array.isArray(record?.bounds) && record.bounds.length >= 4) {
      const [x0,y0,x1,y1] = record.bounds.map(Number);
      return { x:x0, y:y0, width:Math.max(1,x1-x0+1), height:Math.max(1,y1-y0+1) };
    }
    const sample = (record?.auditSamples || []).find(row => row?.visible !== false && (Array.isArray(row?.draw) || Array.isArray(row?.origin))) ||
      (record?.samples || []).find(row => row?.visible !== false && (Array.isArray(row?.draw) || Array.isArray(row?.origin))) || record;
    const size = Array.isArray(sample?.size) ? sample.size.map(Number) : Array.isArray(record?.size) ? record.size.map(Number) : [16,16];
    if (Array.isArray(sample?.draw)) return { x:Number(sample.draw[0]), y:Number(sample.draw[1]), width:Math.max(1,size[0]||16), height:Math.max(1,size[1]||16) };
    if (Array.isArray(sample?.origin)) return { x:Number(sample.origin[0]) - Math.max(1,size[0]||16)/2, y:Number(sample.origin[1]) - Math.max(1,size[1]||16), width:Math.max(1,size[0]||16), height:Math.max(1,size[1]||16) };
    return null;
  }

  function previewActivatorTypeFromFlags(flags) {
    const value = Number(flags || 0);
    if (value & 0x10) return 'explosion';
    if (value & 0x80) return 'hero-presence';
    if (value & 0x20) return 'projectile';
    if (value & 0x40) return 'hero-stop';
    return '';
  }

  function previewInstanceActivatorType(room, sourceKey) {
    const row = (room?.activators || []).find(item => String(item?.sourceKey || '') === String(sourceKey || ''));
    return previewActivatorTypeFromFlags(row?.flags);
  }

  function previewInstanceCatalog(category = previewInstanceCategory?.value || 'platform') {
    const scene = previewResources?.productionScene;
    if (!scene?.rooms?.length) return [];
    const output = [], seen = new Set();
    const collections = ['actors','fallbacks','children','activators','classicActors'];
    for (const room of scene.rooms) for (const collection of collections) for (const record of room?.[collection] || []) {
      const actual = previewInstanceRecordCategory(record, collection);
      if (actual !== category) continue;
      const sourceKey = String(record?.sourceKey || record?.triggerSourceKey || `${collection}:${output.length}`);
      /* RDX actor/fallback/child records are preferred over Classic duplicates.
       * The source key remains the navigation identity so both panes can center
       * on the same gameplay object after the room switch. */
      const key = `${Number(room.submap)}:${Number(room.mapId)}:${category}:${sourceKey}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const activatorType = category === 'platform' ? previewInstanceActivatorType(room, sourceKey) : '';
      output.push(Object.freeze({ room, record, collection, category, sourceKey, key, bounds:previewInstanceBounds(record,collection), ...(activatorType ? { activatorType } : {}) }));
    }
    output.sort((a,b) => Number(a.room.submap)-Number(b.room.submap) || Number(a.room.mapId)-Number(b.room.mapId) ||
      Number((/^mark:(\d+)$/.exec(a.sourceKey)||[])[1] || 1e9)-Number((/^mark:(\d+)$/.exec(b.sourceKey)||[])[1] || 1e9) || a.sourceKey.localeCompare(b.sourceKey));
    return output;
  }

  function updatePreviewInstanceStatus(target = null, index = -1, total = null) {
    if (!previewInstanceStatus) return;
    const category = previewInstanceCategory?.value || 'platform';
    const rows = total == null ? previewInstanceCatalog(category) : null;
    const count = total == null ? rows.length : total;
    const label = category.replaceAll('-', ' ');
    previewInstanceStatus.textContent = target && index >= 0
      ? `${index + 1} / ${count} ${label} · ${target.room?.submapName || actions.smAssetName(target.room?.submap || 0)} · ${target.sourceKey}${target.activatorType ? ` · activation ${target.activatorType}` : ''}`
      : `${count} ${label}${count === 1 ? '' : 's'} across all maps`;
    if (previewInstancePrev) previewInstancePrev.disabled = count === 0;
    if (previewInstanceNext) previewInstanceNext.disabled = count === 0;
  }

  function findPreviewInstanceCandidate(target) {
    const controllers = [rdxPreviewController(), levelPreview, compareLevelPreview].filter((value,index,array) => value && array.indexOf(value) === index);
    for (const controller of controllers) {
      const candidates = controller.selectionCandidates?.(true) || [];
      const exact = candidates.find(item => String(item?.sourceKey || item?.debugRow?.sourceKey || '') === target.sourceKey &&
        String(item?.category || item?.subjectCategory || item?.kind || '') === target.category);
      if (exact) return { controller, candidate:exact };
      const bySource = candidates.find(item => String(item?.sourceKey || item?.debugRow?.sourceKey || '') === target.sourceKey &&
        (target.category !== 'platform' || !!item?.movingPlatform));
      if (bySource) return { controller, candidate:bySource };
    }
    return null;
  }

  function focusPreviewInstance(target, index, total) {
    if (!target) return;
    if (previewMapSelect && Number(previewMapSelect.value) !== Number(target.room.submap)) {
      previewMapSelect.value = String(Number(target.room.submap));
      updatePreviewSelection();
    }
    const resolved = findPreviewInstanceCandidate(target);
    setPreviewEditorEnabled(true);
    if (resolved?.candidate) selectPreviewAsset(resolved.candidate);
    else clearPreviewEditorSelection();
    const bounds = resolved?.candidate?.bounds || target.bounds;
    if (bounds) {
      scrollPreviewControllerToBounds(levelPreview, bounds);
      if (previewLayoutMode === 'side-by-side') scrollPreviewControllerToBounds(compareLevelPreview, bounds);
    }
    previewInstanceCursor = index;
    previewInstanceIdentity = target.key;
    updatePreviewInstanceStatus(target, index, total);
    actions.setStatus(`${target.category.replaceAll('-', ' ')} ${target.sourceKey} · ${target.room.submapName || actions.smAssetName(target.room.submap)} / ${target.room.mapName || actions.mdAssetName(target.room.mapId)}${resolved ? '' : ' · centered from resolved static data; no selectable runtime item on this phase'}.`, resolved ? 'ok' : 'warn');
  }

  function navigatePreviewInstance(delta) {
    const category = previewInstanceCategory?.value || 'platform';
    const rows = previewInstanceCatalog(category);
    if (!rows.length) { updatePreviewInstanceStatus(null,-1,0); return; }
    let index = rows.findIndex(row => row.key === previewInstanceIdentity);
    if (index < 0) index = previewInstanceCursor >= 0 && previewInstanceCursor < rows.length ? previewInstanceCursor : (delta < 0 ? 0 : -1);
    index = (index + delta + rows.length) % rows.length;
    focusPreviewInstance(rows[index], index, rows.length);
  }

  function placementFocusBounds(row, candidate = null) {
    if (candidate?.bounds) return candidate.bounds;
    const auditedBounds = Array.isArray(row?.fittedBounds) ? row.fittedBounds
      : Array.isArray(row?.currentBounds) ? row.currentBounds : null;
    if (auditedBounds) return {
      x:Number(auditedBounds[0] || 0), y:Number(auditedBounds[1] || 0),
      width:Math.max(1, Number(auditedBounds[2] || 8)), height:Math.max(1, Number(auditedBounds[3] || 8))
    };
    const fitted = Array.isArray(row?.fittedOrigin) ? row.fittedOrigin : null;
    const current = Array.isArray(row?.currentOrigin) ? row.currentOrigin : null;
    const origin = fitted || current;
    return origin ? { x:Number(origin[0] || 0) - 4, y:Number(origin[1] || 0) - 4, width:8, height:8 } : null;
  }

  function centerPlacementInMapPreview(row, candidate = null) {
    const bounds = placementFocusBounds(row, candidate);
    if (!bounds) return;
    /* Center every visible pane explicitly.  Programmatic scroll events are not
     * guaranteed to arrive before a room switch/re-render, so relying on scroll
     * synchronisation alone made Previous/Next occasionally leave Classic on the
     * old viewport.  Placement navigation is a world-space operation. */
    scrollPreviewControllerToBounds(levelPreview, bounds);
    if (previewLayoutMode === 'side-by-side') scrollPreviewControllerToBounds(compareLevelPreview, bounds);
  }

  function selectPlacementRow(row, auditRoom = null) {
    if (!row) return;
    const targetRoom = auditRoom || (previewResources?.placementAudit?.rooms || []).find(room =>
      (room?.items || []).includes(row)) || null;
    if (targetRoom && Number(previewMapSelect?.value) !== Number(targetRoom.submap)) {
      previewMapSelect.value = String(Number(targetRoom.submap));
      updatePreviewSelection();
    }
    if (previewLayoutMode !== 'side-by-side' && previewVisualSourceSelect?.value === 'classic') {
      previewVisualSourceSelect.value = 'rdx';
      updatePreviewSelection();
    }
    const candidate = placementCandidate(row);
    const currentAuditRoom = targetRoom || selectedPreviewRoom();
    previewPlacementCursorIdentity = placementRowIdentity(currentAuditRoom, row);
    setPreviewEditorEnabled(true);
    if (candidate) selectPreviewAsset(candidate);
    else clearPreviewEditorSelection();
    centerPlacementInMapPreview(row, candidate);
    previewPlacementList?.querySelectorAll?.('[data-placement-identity]').forEach(button =>
      button.classList.toggle('is-selected', button.dataset.placementIdentity === previewPlacementCursorIdentity));
    actions.setStatus(`Placement ${row.sourceKey}: ${currentAuditRoom?.submapName || actions.smAssetName(currentAuditRoom?.submap || 0)} / ${currentAuditRoom?.mapName || actions.mdAssetName(currentAuditRoom?.mapId || 0)} · current ${row.currentOrigin?.join(',')} → fitted ${row.fittedOrigin?.join(',')} (${row.status})${candidate ? '' : ' · centered from audit coordinates; no selectable RDX debug actor'}.`, candidate ? 'neutral' : 'warn');
  }

  function refreshPlacementUi() {
    if (!previewPlacementList) return;
    const room = selectedPreviewRoom();
    const auditRoom = (previewResources?.placementAudit?.rooms || []).find(row => room && Number(row.submap) === Number(room.submap) && Number(row.mapId) === Number(room.mapId));
    const all = auditRoom?.items || [];
    const rows = placementRowsForCurrentRoom();
    const globalRows = placementRowsGlobal();
    previewPlacementCursor = Math.min(previewPlacementCursor, Math.max(0, rows.length - 1));
    const issueCount = all.filter(row => PLACEMENT_ISSUE_STATUSES.has(String(row.status || ''))).length;
    if (previewPlacementSummary) previewPlacementSummary.textContent = `${all.length} source placement records · ${issueCount} review item(s) in ${room?.submapName || ''} / ${room?.mapName || ''} · ${globalRows.length} row(s) match the current filters across all maps. Previous/Next traverses that global set and centers the target in Map Preview.`;
    previewPlacementList.replaceChildren();
    for (const [index,row] of rows.entries()) {
      const button=document.createElement('button'); button.type='button'; button.className='preview-no-overlap-item'; button.dataset.placementIndex=String(index);
      button.dataset.placementIdentity=placementRowIdentity(auditRoom || room,row);
      if (button.dataset.placementIdentity === previewPlacementCursorIdentity) button.classList.add('is-selected');
      const main=document.createElement('span'); const strong=document.createElement('strong'); strong.textContent=`${row.sourceKey} · ${row.subjectCategory}${row.activatorType ? ` · activation ${row.activatorType}` : ''}`;
      const detail=document.createElement('span'); const drift=row.drift || [0,0]; detail.textContent=`${row.status} · current ${row.currentOrigin?.join(',')} → fitted ${row.fittedOrigin?.join(',')} · drift ${drift[0]},${drift[1]} · ${row.reason || ''}`;
      main.append(strong,detail); const badge=document.createElement('span'); badge.className='preview-no-overlap-badge'; badge.textContent=row.preferFitted?'prefer fitted':row.status;
      button.append(main,badge); button.addEventListener('click',()=>{ previewPlacementCursor=index; selectPlacementRow(row,auditRoom); }); previewPlacementList.append(button);
    }
    if (!rows.length) previewPlacementList.textContent='No placement rows match the current filters in this room. Previous/Next can still jump to matching rows on other maps.';
    if (previewPlacementPrev) previewPlacementPrev.disabled=!globalRows.length;
    if (previewPlacementNext) previewPlacementNext.disabled=!globalRows.length;
    if (previewPlacementQueue) previewPlacementQueue.disabled=!rows.some(row => row.preferFitted && row.confidence === 'high' && !['activator','player'].includes(row.subjectCategory));
  }

  function stepPlacementIssue(delta) {
    const rows=placementRowsGlobal();
    if (!rows.length) return;
    let index=rows.findIndex(({auditRoom,row})=>placementRowIdentity(auditRoom,row)===previewPlacementCursorIdentity);
    if (index < 0) {
      const current=selectedPreviewRoom();
      index=rows.findIndex(({auditRoom})=>Number(auditRoom.submap)===Number(current?.submap));
      if (index < 0) index=0;
      else if (delta < 0) index=(index-1+rows.length)%rows.length;
    } else index=(index+delta+rows.length)%rows.length;
    const target=rows[index];
    previewPlacementCursorIdentity=placementRowIdentity(target.auditRoom,target.row);
    selectPlacementRow(target.row,target.auditRoom);
    refreshPlacementUi();
  }

  function queueVisiblePlacementFits() {
    const controller=rdxPreviewController(); if (!controller) { actions.setStatus('Open an RDX Placement pane first.', 'warn'); return; }
    const rows=placementRowsForCurrentRoom().filter(row => row.preferFitted && row.confidence === 'high' && !['activator','player'].includes(row.subjectCategory));
    let queued=0, skipped=0;
    for (const row of rows) {
      const live=controller.selectionCandidates?.(true)?.find(item => !item.debugOnly && item.port === 'rdx' && String(item.sourceKey || '') === String(row.sourceKey || ''));
      if (!live || !Array.isArray(row.fittedOrigin)) { skipped++; continue; }
      previewPatchStore.update(previewNoteContext(), live, { x:Math.round(Number(row.fittedOrigin[0])), y:Math.round(Number(row.fittedOrigin[1])), bugged:`Placement audit ${row.status}: topology-fitted Classic source geometry (${row.reason || 'review placement'})` });
      queued++;
    }
    applyRoomPatches(); refreshPreviewPatchesUi();
    actions.setStatus(`Queued ${queued} high-confidence fitted placement patch(es)${skipped ? `; ${skipped} skipped without a live RDX source.` : '.'}`, queued ? 'ok' : 'warn');
  }

  function selectedNotesAsset() {
    if (!previewSelectedAsset) return null;
    return previewNotesStore.findAsset(previewNoteContext(), previewSelectedAsset) || null;
  }

  function setPreviewEditorEnabled(enabled) {
    previewEditEnabled = !!enabled;
    const effective = previewViewMode === 'patches' || previewEditEnabled;
    if (previewEditorPanel) previewEditorPanel.hidden = !effective || previewViewMode === 'patches';
    if (previewEditToggle) {
      previewEditToggle.setAttribute('aria-pressed', effective ? 'true' : 'false');
      previewEditToggle.textContent = previewViewMode === 'patches' ? 'Patch selection active' : (previewEditEnabled ? 'Finish element editing' : 'Select / operate elements');
      previewEditToggle.disabled = previewViewMode === 'patches';
    }
    levelPreview?.setEditorEnabled(effective);
    compareLevelPreview?.setEditorEnabled(effective);
    if (!effective) previewDrag = null;
  }

  function selectedPreviewTimeline() {
    return previewSelectedAsset ? levelPreview?.timelineFor?.(previewSelectedAsset) || null : null;
  }

  function refreshPreviewTimelineUi() {
    if (!previewTimeline) return;
    const timeline = selectedPreviewTimeline();
    if (!timeline) {
      previewTimeline.hidden = true;
      if (previewTimelineState) previewTimelineState.textContent = 'No captured timeline is available for this sprite.';
      return;
    }
    previewTimeline.hidden = false;
    const period = Math.max(1, Number(timeline.period || 1));
    const globalTick = Math.max(0, Number(levelPreview?.currentTick?.() || 0));
    const tick = ((globalTick % period) + period) % period;
    for (const input of [previewTimelineRange, previewTimelineTick]) {
      if (!input) continue;
      input.min = '0'; input.max = String(period - 1); input.value = String(tick);
    }
    const sample = timeline.sampleAt?.(tick) || {};
    if (previewTimelineSummary) previewTimelineSummary.textContent = `${timeline.sourceKind} · ${period} frames · ${timeline.authority}`;
    if (previewTimelineState) {
      const position = sample.origin || sample.draw || null;
      previewTimelineState.textContent = [
        `frame ${tick}/${period - 1}`,
        sample.visible === false ? 'hidden' : 'visible',
        Number.isFinite(Number(sample.pn)) ? `PN${Number(sample.pn)}` : null,
        Number.isFinite(Number(sample.sprite)) ? `sprite ${Number(sample.sprite)}` : null,
        position ? `position (${Math.round(Number(position[0]))}, ${Math.round(Number(position[1]))})` : null,
        Number.isFinite(Number(sample.duration)) ? `run ${Number(sample.duration)} frame(s)` : null
      ].filter(Boolean).join(' · ');
    }
  }

  function selectedTimelineState() {
    const timeline = selectedPreviewTimeline();
    if (!timeline || !previewSelectedAsset) return previewSelectedAsset;
    const period = Math.max(1, Number(timeline.period || 1));
    const tick = ((Number(levelPreview?.currentTick?.() || 0) % period) + period) % period;
    const sample = timeline.sampleAt?.(tick) || {};
    const draw = Array.isArray(sample.draw) ? sample.draw : previewSelectedAsset.draw;
    const origin = Array.isArray(sample.origin) ? sample.origin : null;
    const classic = timeline.sourceKind === 'classic';
    return {
      ...previewSelectedAsset,
      x: origin ? Number(origin[0]) : (classic && draw ? Number(draw[0]) + 16 : previewSelectedAsset.x),
      y: origin ? Number(origin[1]) : (classic && draw ? Number(draw[1]) + 20 : previewSelectedAsset.y),
      draw: draw || previewSelectedAsset.draw,
      pn: Number.isFinite(Number(sample.pn)) ? Number(sample.pn) : previewSelectedAsset.pn,
      sprite: Number.isFinite(Number(sample.sprite)) ? Number(sample.sprite) : previewSelectedAsset.sprite,
      visible: sample.visible !== false,
      mirrorX: sample.mirrorX == null ? previewSelectedAsset.mirrorX : !!sample.mirrorX,
      mirrorY: sample.mirrorY == null ? previewSelectedAsset.mirrorY : !!sample.mirrorY,
      front: sample.front == null ? previewSelectedAsset.front : !!sample.front,
      animationTick: Number.isFinite(Number(sample.tick)) ? Number(sample.tick) : tick,
      timelineTick: tick
    };
  }

  function scrubPreviewTimeline(tick) {
    const timeline = selectedPreviewTimeline();
    if (!timeline) return;
    const bounded = Math.max(0, Math.min(Number(timeline.lastTick || 0), Number(tick) | 0));
    previewPaused = true;
    levelPreview?.setPaused(true);
    if (previewPauseButton) previewPauseButton.textContent = 'Resume preview';
    levelPreview?.setTick(bounded);
    refreshPreviewTimelineUi();
  }

  function clearPreviewEditorSelection() {
    previewSelectedAsset = null;
    previewDrag = null;
    previewHitCycle = null;
    levelPreview?.setEditorSelection(null);
    compareLevelPreview?.setEditorSelection(null);
    if (previewSelectedAssetLabel) previewSelectedAssetLabel.textContent = 'Click any outlined map element or sprite.';
    if (previewSelectedId) previewSelectedId.textContent = '';
    if (previewCopyElementId) previewCopyElementId.disabled = true;
    if (previewSelectedPosition) previewSelectedPosition.textContent = '';
    if (previewSelectedDetails) previewSelectedDetails.textContent = 'No sprite selected.';
    if (previewPlayActivatorSound) { previewPlayActivatorSound.hidden = true; previewPlayActivatorSound.disabled = true; previewPlayActivatorSound.textContent = '▶ Play entity sound'; }
    if (previewJumpParent) { previewJumpParent.hidden = true; previewJumpParent.disabled = true; }
    if (previewJumpChild) { previewJumpChild.hidden = true; previewJumpChild.disabled = true; }
    if (previewTimeline) previewTimeline.hidden = true;
    for (const button of [previewAddNoteButton, previewCreateOperationButton, previewCaptureStateButton, previewSaveStateButton, previewApplyStateButton, previewFindAssetButton, previewClearOverrideButton]) {
      if (button) button.disabled = true;
    }
    refreshPreviewOperationUi();
    refreshSelectedPatchControls();
  }

  function previewItemSummary(item) {
    return {
      elementId: item.elementId || null,
      elementKind: item.elementKind || null,
      debugOnly: !!item.debugOnly,
      sourceKey: item.sourceKey || null,
      instanceKey: item.instanceKey || null,
      traceCollection: item.traceCollection || null,
      category: item.category || item.kind || 'unclassified',
      port: item.port || 'preview',
      fallback: !!item.fallback,
      authority: item.authority || null,
      patch: item.patchProvenance || (item.patchedPlacement ? { kind: 'patch' } : null),
      role: item.role || item.kind || null,
      activatorType: item.activatorType || null,
      actorId: Number.isFinite(Number(item.actorId)) ? Number(item.actorId) : null,
      entity: Number.isFinite(Number(item.entity)) ? Number(item.entity) : null,
      pn: Number.isFinite(Number(item.pn)) ? Number(item.pn) : null,
      classicSprite: Number.isFinite(Number(item.sprite)) ? Number(item.sprite) : null,
      setId: item.setId || null,
      action: item.action || null,
      originContact: { x: Number(item.x || 0), y: Number(item.y || 0) },
      draw: item.draw || null,
      bounds: item.bounds || null,
      mirrorX: !!item.mirrorX,
      mirrorY: !!item.mirrorY,
      quarterTurns: Number(item.quarterTurns || 0) & 3,
      front: !!item.front,
      parentSourceKey: item.parentSourceKey || null,
      triggerSound: item.triggerSound || null
    };
  }

  function fillPreviewStateFields(item = previewSelectedAsset, label = null) {
    if (!item) return;
    if (previewStateLabel && label != null) previewStateLabel.value = label;
    if (previewStateX) previewStateX.value = String(Math.round(Number(item.x || 0)));
    if (previewStateY) previewStateY.value = String(Math.round(Number(item.y || 0)));
    if (previewStatePn) previewStatePn.value = Number.isFinite(Number(item.pn)) && Number(item.pn) >= 0 && Number(item.pn) < 0xff ? String(Number(item.pn)) : '';
    if (previewStateActor) previewStateActor.value = Number.isFinite(Number(item.actorId)) ? String(Number(item.actorId)) : '';
    if (previewStateDirection) previewStateDirection.value = ['left','right','up','down','neutral'].includes(item.direction) ? item.direction : (item.mirrorX ? 'left' : 'neutral');
    if (previewStateVisible) previewStateVisible.checked = item.visible !== false;
    if (previewStateMirror) previewStateMirror.checked = !!item.mirrorX;
    if (previewStateMirrorY) previewStateMirrorY.checked = !!item.mirrorY;
    if (previewStateRotation) previewStateRotation.value = String(Number(item.quarterTurns || 0) & 3);
    if (previewStateFront) previewStateFront.checked = !!item.front;
  }

  function selectionIdentityForController(controller, item) {
    if (!controller || !item) return null;
    const candidates = controller.selectionCandidates?.(true) || [];
    if (item.elementId) {
      const exact = candidates.find(candidate => String(candidate.elementId || '') === String(item.elementId));
      if (exact) return exact.elementId || exact.id;
    }
    if (item.id) {
      const exact = candidates.find(candidate => String(candidate.id || '') === String(item.id));
      if (exact) return exact.elementId || exact.id;
    }
    const sourceKeys = new Set([item.sourceKey, item.parentSourceKey].filter(Boolean).map(String));
    let related = candidates.filter(candidate =>
      sourceKeys.has(String(candidate.sourceKey || '')) || sourceKeys.has(String(candidate.parentSourceKey || '')));
    const category = String(item.category || item.kind || '');
    const categoryMatches = related.filter(candidate => String(candidate.category || candidate.kind || '') === category);
    if (categoryMatches.length) related = categoryMatches;
    const subjectCategory = String(item.subjectCategory || item.debugRow?.subjectCategory || '');
    if (subjectCategory) {
      const subjectMatches = related.filter(candidate =>
        String(candidate.subjectCategory || candidate.debugRow?.subjectCategory || '') === subjectCategory);
      if (subjectMatches.length) related = subjectMatches;
    }
    /* Prefer a real presentation object over a diagnostic sibling when jumping
     * between Classic/RDX, but never discard category/subject compatibility. */
    const real = related.filter(candidate => !candidate.debugOnly);
    if (real.length === 1) related = real;
    if (related.length !== 1) return null;
    return related[0].elementId || related[0].id || null;
  }

  function syncPreviewEditorSelections(item) {
    for (const controller of [levelPreview, compareLevelPreview]) {
      if (!controller) continue;
      controller.setEditorSelection(selectionIdentityForController(controller, item));
    }
  }

  function editablePreviewSelection(item = previewSelectedAsset) {
    return editablePreviewAsset(item, previewControllerRecords().map(record => record.item));
  }

  function ensureEditablePreviewSelection() {
    const editable = editablePreviewSelection();
    if (!editable) return null;
    if (previewSelectedAsset?.debugOnly) selectPreviewAsset(editable);
    return previewSelectedAsset;
  }

  function selectPreviewAsset(item) {
    if (!item) { clearPreviewEditorSelection(); return; }
    previewSelectedAsset = { ...item };
    const storedAsset = previewNotesStore.asset(previewNoteContext(), previewSelectedAsset);
    const sceneryAssembly = isSceneryAssemblyItem(previewSelectedAsset);
    if (sceneryAssembly && storedAsset?.rdxAssetOverride?.pn != null) {
      /* Old notes from PN-based MD0008 revisions may still contain PN82/PN255.
       * Remove that stale replacement when the current source is a decoded tile
       * assembly, otherwise the first drag converts it into an unrelated sprite. */
      previewNotesStore.clearRdxAssetOverride(previewNoteContext(), previewSelectedAsset);
    }
    const compatibleStoredOverride = compatibleRdxAssetOverride(previewSelectedAsset, storedAsset?.rdxAssetOverride);
    if (compatibleStoredOverride?.pn != null && previewSelectedAsset.sourceKey) {
      const saved = compatibleStoredOverride;
      previewSelectedAsset = {
        ...previewSelectedAsset,
        pn: Number(saved.pn),
        actorId: saved.actorId ?? previewSelectedAsset.actorId,
        direction: saved.direction || previewSelectedAsset.direction,
        mirrorX: saved.mirrorX == null ? previewSelectedAsset.mirrorX : !!saved.mirrorX,
        mirrorY: saved.mirrorY == null ? previewSelectedAsset.mirrorY : !!saved.mirrorY,
        quarterTurns: saved.quarterTurns == null ? Number(previewSelectedAsset.quarterTurns || 0) & 3 : Number(saved.quarterTurns || 0) & 3,
        setId: saved.setId || previewSelectedAsset.setId
      };
      levelPreview?.setManualOverride(previewAssetKey(previewSelectedAsset), overrideFromPreviewState(previewSelectedAsset, previewSelectedAsset));
    }
    syncPreviewEditorSelections(item);
    if (previewSelectedAssetLabel) {
      const identity = item.sourceKey || item.id || previewAssetKey(item);
      previewSelectedAssetLabel.textContent = `${String(item.category || item.kind || 'asset').toUpperCase()} · ${identity}`;
    }
    if (previewSelectedId) previewSelectedId.textContent = item.elementId || '';
    if (previewCopyElementId) previewCopyElementId.disabled = !item.elementId;
    if (previewPlayActivatorSound) {
      previewPlayActivatorSound.hidden = !item.triggerSound?.sample;
      previewPlayActivatorSound.disabled = !item.triggerSound?.sample;
      previewPlayActivatorSound.textContent = item.triggerSound?.sample ? `▶ Play sound · ${item.triggerSound.sample}` : '▶ Play entity sound';
    }
    if (previewJumpParent) {
      const canJump = (item.port === 'rdx' || item.port === 'debug' || item.parentSourceKey) && !!(item.parentSourceKey || item.sourceKey);
      previewJumpParent.hidden = !canJump;
      previewJumpParent.disabled = !canJump;
    }
    if (previewJumpChild) {
      const canJump = (item.port === 'classic' || item.port === 'debug' || item.parentSourceKey) && !!(item.sourceKey || item.parentSourceKey);
      previewJumpChild.hidden = !canJump;
      previewJumpChild.disabled = !canJump;
    }
    if (previewSelectedPosition) previewSelectedPosition.textContent = `origin/contact (${Math.round(item.x)}, ${Math.round(item.y)}) · draw ${item.draw ? `(${item.draw[0]}, ${item.draw[1]})` : 'unavailable'}`;
    if (previewSelectedDetails) previewSelectedDetails.textContent = JSON.stringify(previewItemSummary(item), null, 2);
    if (previewAssetCategory) previewAssetCategory.value = [...previewAssetCategory.options].some(option => option.value === item.category) ? item.category : 'unclassified';
    fillPreviewStateFields(item);
    for (const button of [previewAddNoteButton, previewCreateOperationButton]) if (button) button.disabled = false;
    const spriteEditable = !!editablePreviewSelection(item);
    for (const button of [previewCaptureStateButton, previewSaveStateButton, previewApplyStateButton, previewFindAssetButton, previewClearOverrideButton]) {
      if (button) button.disabled = !spriteEditable;
    }
    refreshPreviewOperationUi();
    refreshPreviewTimelineUi();
    refreshSelectedPatchControls();
    mapEditorSession.updateStatus();
  }

  function previewStateFromFields() {
    if (!previewSelectedAsset) throw new Error('Select a sprite first');
    const numberOrNull = element => {
      const value = element?.value?.trim();
      if (value === '' || value == null) return null;
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    };
    return {
      label: previewStateLabel?.value?.trim() || 'state',
      order: Number(previewStateOrder?.value || 0),
      tick: levelPreview?.currentTick?.() || 0,
      x: Number(previewStateX?.value || previewSelectedAsset.x || 0),
      y: Number(previewStateY?.value || previewSelectedAsset.y || 0),
      visible: !!previewStateVisible?.checked,
      pn: numberOrNull(previewStatePn),
      actorId: numberOrNull(previewStateActor),
      animationTick: Number(previewSelectedAsset.animationTick || 0),
      direction: previewStateDirection?.value || 'neutral',
      mirrorX: !!previewStateMirror?.checked,
      mirrorY: !!previewStateMirrorY?.checked,
      quarterTurns: Number(previewStateRotation?.value || 0) & 3,
      front: !!previewStateFront?.checked,
      note: previewStateNote?.value?.trim() || '',
      coordinatePolicy: 'world-origin-contact'
    };
  }

  function applyPreviewState(state) {
    if (!previewSelectedAsset?.sourceKey) throw new Error('The selected sprite has no stable sourceKey');
    const overrideKey = previewAssetKey(previewSelectedAsset);
    const override = overrideFromPreviewState(state, previewSelectedAsset);
    if (isSceneryAssemblyItem(previewSelectedAsset)) delete override.pn;
    override.category = previewAssetCategory?.value || previewSelectedAsset.category || 'object';
    /* In side-by-side mode the selected object may belong to either pane. Do
     * not mutate the hidden/opposite presentation just because it happens to be
     * the primary controller. */
    let applied = false;
    for (const [, controller] of visiblePreviewControllers()) {
      if (String(controller.selection?.visualSource || '') !== String(previewSelectedAsset.port || '')) continue;
      controller.setManualOverride(overrideKey, override); applied = true;
    }
    if (!applied) levelPreview?.setManualOverride(overrideKey, override);
    previewSelectedAsset = { ...previewSelectedAsset, ...override, pn: override.pn ?? previewSelectedAsset.pn };
    if (previewWorkspaceMode === 'editor') {
      mapEditorSession.setEntityOverride(overrideKey, {
        elementId:previewSelectedAsset.elementId || null,
        port:previewSelectedAsset.port || null,
        sourceKey:previewSelectedAsset.sourceKey || null,
        ...override
      });
    }
    fillPreviewStateFields(previewSelectedAsset, state.label);
    return override;
  }

  function refreshPreviewOperationUi() {
    if (!previewOperationSelect || !previewOperationStates) return;
    const asset = selectedNotesAsset();
    const previous = previewOperationSelect.value;
    const options = [Object.assign(document.createElement('option'), { value: '', textContent: 'No operation' })];
    for (const operation of asset?.operations || []) {
      options.push(Object.assign(document.createElement('option'), { value: operation.id, textContent: `${operation.name} · ${operation.states.length} states` }));
    }
    previewOperationSelect.replaceChildren(...options);
    if ([...previewOperationSelect.options].some(option => option.value === previous)) previewOperationSelect.value = previous;
    else if (asset?.operations?.length) previewOperationSelect.value = asset.operations[0].id;
    const operation = asset?.operations?.find(entry => entry.id === previewOperationSelect.value);
    previewOperationStates.replaceChildren();
    if (!operation?.states?.length) {
      previewOperationStates.textContent = operation ? 'No states yet. Capture the current sprite, adjust it by eye, then save initial/final/active/hidden states.' : 'Create or select an operation to collect states.';
      return;
    }
    for (const state of operation.states) {
      const card = document.createElement('div');
      card.className = 'preview-state-card';
      const title = document.createElement('strong'); title.textContent = `${state.order}. ${state.label}`;
      const details = document.createElement('span');
      details.textContent = `(${state.x}, ${state.y}) · ${state.visible ? 'visible' : 'hidden'}${state.pn == null ? '' : ` · PN${state.pn}`}${state.mirrorX ? ' · mirrored' : ''}${state.front ? ' · front' : ''}`;
      const note = document.createElement('span'); note.textContent = state.note || '';
      const actions = document.createElement('div'); actions.className = 'preview-state-actions';
      const apply = document.createElement('button'); apply.type = 'button'; apply.textContent = 'Apply';
      apply.addEventListener('click', () => { applyPreviewState(state); selectPreviewAsset({ ...previewSelectedAsset, ...state, id: previewSelectedAsset.id }); });
      const load = document.createElement('button'); load.type = 'button'; load.textContent = 'Load fields';
      load.addEventListener('click', () => {
        fillPreviewStateFields({ ...previewSelectedAsset, ...state }, state.label);
        if (previewStateOrder) previewStateOrder.value = String(state.order || 0);
        if (previewStateNote) previewStateNote.value = state.note || '';
      });
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Delete';
      remove.addEventListener('click', () => previewNotesStore.removeState(previewNoteContext(), previewSelectedAsset, operation.id, state.id));
      actions.append(apply, load, remove); card.append(title, details, note, actions); previewOperationStates.append(card);
    }
  }

  function previewPointerPoint(event) {
    const rect = previewEditorCanvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * previewEditorCanvas.width / Math.max(1, rect.width),
      y: (event.clientY - rect.top) * previewEditorCanvas.height / Math.max(1, rect.height)
    };
  }

  function rdxAssetCatalogue() {
    const sidecar = previewResources?.spriteAnims || {};
    const rows = new Map();
    for (const catalog of sidecar.catalog?.pn || []) {
      const pn = Number(catalog.pn);
      if (Number.isFinite(pn)) rows.set(pn, { pn, catalog, set: null, animation: null });
    }
    for (const set of sidecar.sets || []) for (const animation of set.animations || []) {
      const pn = Number(animation.pn);
      if (!Number.isFinite(pn)) continue;
      const existing = rows.get(pn) || { pn, catalog: null };
      if (!existing.set || set.type !== 'utility') rows.set(pn, { ...existing, set, animation });
    }
    return [...rows.values()].sort((a, b) => a.pn - b.pn);
  }

  function drawRdxAssetThumbnail(canvas, item) {
    const room = selectedPreviewRoom();
    const palette = previewResources?.paletteRegistry?.forMap(Number(room?.mapId || 3))?.rgba;
    const frame = previewResources?.spriteDecoder?.frameForPn(item.pn, 0, palette);
    /* PN direction is metadata about the authored ROM animation, not an implicit
     * transform. PN52 is already left-facing; mirroring it here made PN51/PN52
     * both appear right-facing in the asset browser. */
    const context = canvas.getContext('2d'); context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!frame?.pixels) return;
    const image = new ImageData(frame.pixels.data, frame.pixels.width, frame.pixels.height);
    const temporary = document.createElement('canvas'); temporary.width = frame.pixels.width; temporary.height = frame.pixels.height;
    temporary.getContext('2d').putImageData(image, 0, 0);
    const scale = Math.max(1, Math.min(3, Math.floor(Math.min((canvas.width - 8) / frame.pixels.width, (canvas.height - 8) / frame.pixels.height))));
    const width = frame.pixels.width * scale, height = frame.pixels.height * scale;
    context.drawImage(temporary, Math.floor((canvas.width - width) / 2), Math.floor((canvas.height - height) / 2), width, height);
  }

  function renderRdxAssetBrowser() {
    if (!previewAssetGrid) return;
    const query = (previewAssetSearch?.value || '').trim().toLowerCase();
    const type = previewAssetFilter?.value || '';
    const items = rdxAssetCatalogue().filter(item => {
      const haystack = [item.pn, item.set?.displayName, item.set?.setId, item.set?.type, item.animation?.action, item.animation?.label,
        ...(item.set?.actorIds || []), ...(item.catalog?.spawnLinkedMaps || [])].join(' ').toLowerCase();
      return (!query || haystack.includes(query)) && (!type || item.set?.type === type);
    });
    previewAssetGrid.replaceChildren();
    for (const item of items) {
      const card = document.createElement('button'); card.type = 'button'; card.className = 'preview-asset-card';
      const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 96;
      const title = document.createElement('strong'); title.textContent = `PN${item.pn} · ${item.animation?.label || item.animation?.action || item.catalog?.hint || 'unclassified'}`;
      const meta = document.createElement('span'); meta.textContent = `${item.set?.displayName || item.set?.setId || 'PN catalogue'} · ${item.set?.type || 'unknown'} · ${item.animation?.direction || item.catalog?.direction || 'neutral'}`;
      card.append(canvas, title, meta);
      card.addEventListener('click', () => {
        if (!previewSelectedAsset) return;
        const context = previewNoteContext();
        previewNotesStore.setRdxAssetOverride(context, previewSelectedAsset, {
          pn: item.pn,
          actorId: previewStateActor?.value || previewSelectedAsset.actorId,
          setId: item.set?.setId || '',
          action: item.animation?.action || '',
          direction: item.animation?.direction || 'neutral',
          mirrorX: false,
          source: 'whole-map-rdx-asset-browser'
        });
        if (previewStatePn) previewStatePn.value = String(item.pn);
        if (previewStateDirection) previewStateDirection.value = item.animation?.direction || 'neutral';
        if (previewStateMirror) previewStateMirror.checked = false;
        applyPreviewState(previewStateFromFields());
        actions.setStatus(`Applied PN${item.pn} to ${previewSelectedAsset.sourceKey}. The note is saved as review evidence; resolved production presentation remains unchanged until reviewed changes are promoted and regenerated.`, 'ok');
      });
      previewAssetGrid.append(card);
      drawRdxAssetThumbnail(canvas, item);
    }
    if (!items.length) previewAssetGrid.textContent = 'No RDX assets match this filter.';
  }

  function createLevelPreview() {
    if (levelPreview || !previewResources) return levelPreview;
    const previewRenderer = createCanonicalLevelEditorPreviewRenderer(previewResources);
    levelPreview = new LevelPreview({
      renderer: previewRenderer,
      backgroundCanvas: previewBackgroundCanvas,
      actorCanvas: previewActorCanvas,
      foregroundCanvas: previewForegroundCanvas,
      frontActorCanvas: previewFrontActorCanvas,
      patrolCanvas: previewPatrolCanvas,
      collisionCanvas: previewCollisionCanvas,
      unresolvedCollisionCanvas: previewUnresolvedCollisionCanvas,
      shiftCanvas: previewShiftCanvas,
      shiftMap: previewResources.cellShiftMap,
      editorCanvas: previewEditorCanvas,
      statusElement: previewStatus,
      onElementSelect(item) { if (item) { if (previewViewMode !== 'patches') setPreviewEditorEnabled(true); selectPreviewAsset(item); } },
      onDynamicFrame(dynamic) {
        /* Keep the current-room entity tree truthful while Simulate changes
         * visibility/state. The signature guard makes this effectively free when
         * identity/visibility has not changed. */
        renderPreviewEntityTree();
        if (!previewSelectedAsset) return;
        const selectedKey = previewAssetKey(previewSelectedAsset);
        const current = levelPreview?.elementById?.(previewSelectedAsset.elementId, true) ||
          (dynamic.selectables || []).find(item => item.id === previewSelectedAsset.id) ||
          (dynamic.selectables || []).find(item => previewAssetKey(item) === selectedKey) ||
          (dynamic.selectables || []).find(item => item.sourceKey && item.sourceKey === previewSelectedAsset.sourceKey);
        if (!current) return;
        previewSelectedAsset = { ...previewSelectedAsset, ...current };
        levelPreview?.setEditorSelection(current.elementId || current.id || current.sourceKey);
        if (previewSelectedPosition) previewSelectedPosition.textContent = `origin/contact (${Math.round(current.x)}, ${Math.round(current.y)}) · draw ${current.draw ? `(${current.draw[0]}, ${current.draw[1]})` : 'unavailable'}`;
        if (previewSelectedDetails) previewSelectedDetails.textContent = JSON.stringify(previewItemSummary(current), null, 2);
        refreshPreviewTimelineUi();
      }
    });
    levelPreview.setSpeed(Number(previewSpeedSelect?.value || 1));
    levelPreview.setZoom(Number(previewZoomSelect?.value || 1));
    levelPreview.setActivateAllTraps(!!previewActivateAll?.checked);
    levelPreview.setShowPatrol(!!previewShowPatrol?.checked);
    levelPreview.setDebugFilter(previewDebugFilter?.value || 'all');
    levelPreview.setShowCollision(!!previewShowCollision?.checked);
    levelPreview.setVisible(true);
    levelPreview.setPatchMode(previewViewMode === 'patches');
    levelPreview.setEditorEnabled(previewViewMode === 'patches' || previewEditEnabled);
    /* Apply the selected layout on first construction as well as on change.
     * The compare pane starts hidden in HTML; calling only updatePreviewSelection
     * created its controller but left that pane hidden until the user toggled
     * single -> side-by-side. */
    updatePreviewLayout();
    return levelPreview;
  }

  async function openLevelPreview(mode = 'preview') {
    if (!previewPanel) return false;

    /* The launcher must always visibly respond. Open and focus the panel first;
     * initialization can then report progress or a ROM/data requirement in the
     * panel itself instead of making a valid click look dead. */
    previewPanel.hidden = false;
    if (playtestPanel) playtestPanel.hidden = true;
    actions.setExpanded(playtestOpenButton, false);
    setPreviewWorkspaceMode(mode, { scroll:false });
    previewPanel.scrollIntoView({ block: 'start', behavior: 'smooth' });

    if (!previewResources) {
      if (previewStatus) previewStatus.textContent = 'Load the verified RDX 1.3x ROM to initialize the whole-map preview.';
      actions.setStatus('Load the verified RDX ROM before initializing the whole-map preview.', 'warn');
      return false;
    }

    if (previewStatus && !previewResources.productionScene)
      previewStatus.textContent = 'ResolvedLevel projection is unavailable.';
    if (!previewResources.productionScene) {
      actions.setStatus('Unable to initialize the whole-map preview from the resolved level projection.', 'error');
      return false;
    }
    const preview = createLevelPreview();
    previewPaused = false;
    if (previewPauseButton) previewPauseButton.textContent = 'Pause preview';
    preview?.setPaused(false);
    preview?.start();
    setPreviewWorkspaceMode(mode, { scroll:false });
    return true;
  }

  function closeLevelPreview() {
    if (mapEditorSession.playtestActive()) mapEditorSession.stopPlaytest();
    levelPreview?.stop();
    compareLevelPreview?.stop();
    levelPreview = null;
    compareLevelPreview = null;
    previewPaused = false;
    if (previewPanel) previewPanel.hidden = true;
    if (playtestPanel) playtestPanel.hidden = false;
    if (playtestOpenButton) { playtestOpenButton.hidden = false; playtestOpenButton.disabled = false; }
    actions.setExpanded(playtestOpenButton, true);
    actions.setExpanded(previewOpenButton, false);
    actions.setExpanded(mapEditorOpenButton, false);
  }


  function installRooms(rooms = []) {
    if (!previewMapSelect) return;
    const options = [...rooms].map(room => {
      const option = document.createElement('option');
      option.value = String(room.submap);
      option.textContent = `${room.submapName} · ${room.mapName || actions.mdAssetName(room.mapId)} · ${actions.roomGroupLabel(room.group)}`;
      return option;
    });
    previewMapSelect.replaceChildren(...options);
  }

  function setGameMetadata(metadata) {
    previewNotesStore.setGameMetadata(metadata);
    previewPatchStore.setGameMetadata(metadata);
  }
  function setResources(resources) {
    previewResources = resources || null;
    renderPreviewUnresolvedCounts();
    if (previewOpenButton) previewOpenButton.disabled = false;
    if (previewStatus) previewStatus.textContent = previewResources
      ? 'Press Map preview to initialize the ResolvedLevel whole-room viewer.'
      : 'Load the verified RDX 1.3x ROM to initialize the whole-map preview.';
    return previewResources;
  }
  function clearResources() { closeLevelPreview(); previewResources = null; }
  function stopControllers() { levelPreview?.stop(); compareLevelPreview?.stop(); }

  function install() {
    refreshPreviewNotesUi();
    refreshPreviewPatchesUi();
    if (previewOpenButton) previewOpenButton.disabled = false;
    if (mapEditorOpenButton) mapEditorOpenButton.disabled = false;
    actions.setExpanded(previewOpenButton, !previewPanel?.hidden);
    actions.setExpanded(mapEditorOpenButton, false);
    mapEditorSession.loadDraft();
    function previewSoundRoutes(sample, source = previewAudioSourceSelect?.value || 'cd32') {
      const safeSample = String(sample || '').replace(/[^a-zA-Z0-9_.-]/g, '');
      if (source === 'classic') return [`./audio/classic/${safeSample}`, `../data/sounds/${safeSample}`];
      return [`./audio/cd32/runtime/${safeSample}`, `../data/audio/cd32/runtime/${safeSample}`];
    }

    previewPlayActivatorSound?.addEventListener('click', async () => {
      const sound = previewSelectedAsset?.triggerSound;
      if (!sound?.sample) return;
      actions.resumeBrowserAudio();
      const source = previewAudioSourceSelect?.value === 'classic' ? 'classic' : 'cd32';
      let lastError = null;
      for (const route of previewSoundRoutes(sound.sample, source)) {
        const audio = new Audio(route);
        audio.preload = 'auto';
        audio.volume = 0.7;
        try {
          await audio.play();
          actions.setStatus(`Playing ${source === 'classic' ? 'Classic' : 'HG / CD32'} ${sound.sample} for ${previewSelectedAsset?.sourceKey || 'selected entity'}.`, 'ok');
          return;
        } catch (error) { lastError = error; }
      }
      actions.setStatus(`Could not audition ${source === 'classic' ? 'Classic' : 'HG / CD32'} ${sound.sample}: ${lastError?.message || 'no playable route'}. The selected source must contain that direct sample in the published web audio assets or package-local data path.`, 'error');
    });

    previewJumpParent?.addEventListener('click', () => {
      const targetSourceKey = previewSelectedAsset?.parentSourceKey || previewSelectedAsset?.sourceKey;
      if (!targetSourceKey) return;
      let classicController = null;
      if (previewLayoutMode === 'side-by-side') {
        classicController = [levelPreview, compareLevelPreview].find(controller => controller?.selection?.visualSource === 'classic') || null;
      } else {
        if (previewVisualSourceSelect) previewVisualSourceSelect.value = 'classic';
        updatePreviewSelection();
        classicController = levelPreview;
      }
      if (!classicController) return;
      classicController.setShowPatrol(true);
      classicController.setDebugFilter('all');
      const candidate = classicController.selectionCandidates?.(true)?.find(item =>
        String(item.sourceKey || '') === String(targetSourceKey) || String(item.debugRow?.sourceKey || '') === String(targetSourceKey));
      if (!candidate) {
        actions.setStatus(`Classic parent ${targetSourceKey} is not selectable in this room capture.`, 'warn');
        return;
      }
      selectPreviewAsset(candidate);
      classicController.setEditorSelection(candidate.elementId || candidate.id || null);
      const scroll = classicController === compareLevelPreview ? previewCompareScroll : previewScroll;
      scroll?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      actions.setStatus(`Jumped to Classic parent ${targetSourceKey}.`, 'ok');
    });

    previewJumpChild?.addEventListener('click', () => {
      const targetSourceKey = previewSelectedAsset?.parentSourceKey || previewSelectedAsset?.sourceKey;
      if (!targetSourceKey) return;
      let controller = null;
      if (previewLayoutMode === 'side-by-side') controller = rdxPreviewController();
      else {
        if (previewVisualSourceSelect) previewVisualSourceSelect.value = 'rdx';
        updatePreviewSelection(); controller = levelPreview;
      }
      if (!controller) return;
      controller.setShowPatrol(true);
      const candidates = controller.selectionCandidates?.(true) || [];
      const candidate = candidates.find(item => !item.debugOnly && item.port === 'rdx' && String(item.sourceKey || '') === String(targetSourceKey)) ||
        candidates.find(item => String(item.parentSourceKey || '') === String(targetSourceKey) || String(item.sourceKey || '') === String(targetSourceKey));
      if (!candidate) { actions.setStatus(`RDX child for ${targetSourceKey} is not selectable in this room capture.`, 'warn'); return; }
      selectPreviewAsset(candidate); controller.setEditorSelection(candidate.elementId || candidate.id || null);
      const scroll = controller === compareLevelPreview ? previewCompareScroll : previewScroll;
      scroll?.scrollIntoView?.({ block:'nearest', behavior:'smooth' });
      actions.setStatus(`Jumped to RDX child ${candidate.sourceKey || candidate.elementId}.`, 'ok');
    });


    previewNoOverlapRefresh?.addEventListener('click', refreshNoOverlapUi);
    previewPlacementCategory?.addEventListener('change', refreshPlacementUi);
    previewPlacementStatus?.addEventListener('change', refreshPlacementUi);
    previewPlacementPrev?.addEventListener('click', () => stepPlacementIssue(-1));
    previewPlacementNext?.addEventListener('click', () => stepPlacementIssue(1));
    previewPlacementQueue?.addEventListener('click', queueVisiblePlacementFits);
    if (previewOpenButton) previewOpenButton.disabled = false;
    if (mapEditorOpenButton) mapEditorOpenButton.disabled = false;
    actions.setExpanded(previewOpenButton, !previewPanel?.hidden);
    actions.setExpanded(mapEditorOpenButton, false);
    mapEditorSession.loadDraft();
    previewOpenButton?.addEventListener('click', () => openLevelPreview('preview'));
    if (mapEditorOpenButton?.addEventListener && mapEditorOpenButton.tagName !== 'A') mapEditorOpenButton.addEventListener('click', () => openLevelPreview('editor'));
    previewTabButton?.addEventListener('click', () => setPreviewWorkspaceMode('preview'));
    mapEditorTabButton?.addEventListener('click', () => setPreviewWorkspaceMode('editor'));
    previewCloseButton?.addEventListener('click', closeLevelPreview);
    playtestOpenButton?.addEventListener('click', () => {
      if (previewWorkspaceMode === 'editor') {
        actions.setStatus('Standard Playtest is unavailable in Map Editor; use Playtest this window.', 'neutral');
        return;
      }
      levelPreview?.stop(); compareLevelPreview?.stop();
      if (previewPanel) previewPanel.hidden = true;
      if (playtestPanel) playtestPanel.hidden = false;
      actions.setExpanded(previewOpenButton, false); actions.setExpanded(mapEditorOpenButton, false); actions.setExpanded(playtestOpenButton, true);
      playtestPanel?.scrollIntoView?.({ block:'start', behavior:'smooth' });
    });

    previewMapSelect?.addEventListener('change', updatePreviewSelection);
    previewVisualSourceSelect?.addEventListener('change', updatePreviewSelection);
    previewLayoutSelect?.addEventListener('change', updatePreviewLayout);
    previewScroll?.addEventListener('scroll', () => syncPreviewScroll(previewScroll, previewCompareScroll), { passive: true });
    previewCompareScroll?.addEventListener('scroll', () => syncPreviewScroll(previewCompareScroll, previewScroll), { passive: true });
    previewViewSelect?.addEventListener('change', () => setPreviewViewMode(previewViewSelect.value));
    previewSpeedSelect?.addEventListener('change', () => eachLevelPreview(controller => controller.setSpeed(Number(previewSpeedSelect.value || 1))));
    previewZoomSelect?.addEventListener('change', () => { eachLevelPreview(controller => controller.setZoom(Number(previewZoomSelect.value || 1))); updatePreviewScrollSpaces(); schedulePreviewScrollSync(); });
    previewPhaseInput?.addEventListener('change', () => eachLevelPreview(controller => controller.setPhase(Number(previewPhaseInput.value || 0))));
    previewActivateAll?.addEventListener('change', () => eachLevelPreview(controller => controller.setActivateAllTraps(previewActivateAll.checked)));
    previewDisablePatches?.addEventListener('change', () => { previewPatchesDisabled = !!previewDisablePatches.checked; applyRoomPatches(); refreshPreviewPatchesUi(); actions.setStatus(previewPatchesDisabled ? 'Patch Workbench overlays disabled; integrated placement/behaviour authorities remain active.' : 'Patch Workbench overlays enabled.', 'neutral'); });
    previewShowPatrol?.addEventListener('change', () => {
      if (previewViewMode === 'patches' && !previewShowPatrol.checked) previewShowPatrol.checked = true;
      eachLevelPreview(controller => controller.setShowPatrol(previewShowPatrol.checked));
    });
    previewDebugFilter?.addEventListener('change', () => { eachLevelPreview(controller => controller.setDebugFilter(previewDebugFilter.value || 'all')); if (previewViewMode === 'no-overlap') refreshNoOverlapUi(); });
    previewInstanceCategory?.addEventListener('change', () => { previewInstanceCursor = -1; previewInstanceIdentity = ''; updatePreviewInstanceStatus(); });
    previewInstancePrev?.addEventListener('click', () => navigatePreviewInstance(-1));
    previewInstanceNext?.addEventListener('click', () => navigatePreviewInstance(1));
    previewShowCollision?.addEventListener('change', () => {
      eachLevelPreview(controller => controller.setShowCollision(previewShowCollision.checked));
      if (!previewShowCollision.checked) setGeometryHover(null);
      refreshPreviewGeometryUi();
    });
    previewShowUnresolvedCollision?.addEventListener('change', () => {
      eachLevelPreview(controller => controller.setShowUnresolvedCollision(previewShowUnresolvedCollision.checked));
      renderPreviewUnresolvedCounts();
    });
    bindGeometryCanvas(previewCollisionCanvas, () => levelPreview);
    bindGeometryCanvas(previewCompareCollisionCanvas, () => compareLevelPreview);
    previewGeometryCopyId?.addEventListener('click', async () => {
      const ids=geometrySelectionIds(); if (ids.length !== 1) return;
      try { await actions.copyText(ids[0]); actions.setStatus(`Copied geometry ID ${ids[0]}.`, 'ok'); }
      catch (error) { actions.setStatus(`Could not copy geometry ID: ${error?.message || error}`, 'error'); }
    });
    previewGeometryCopyIds?.addEventListener('click', async () => {
      const ids=geometrySelectionIds(); if (!ids.length) return;
      try { const compact=compactGeometryIds(ids); await actions.copyText(geometryIdsClipboardText(ids)); actions.setStatus(`Copied ${ids.length} geometry cell(s) as ${compact.length} compact selector(s).`, 'ok'); }
      catch (error) { actions.setStatus(`Could not copy geometry IDs: ${error?.message || error}`, 'error'); }
    });
    previewGeometryCopyTrace?.addEventListener('click', async () => {
      const cells=[...previewGeometrySelection.values()]; if (!cells.length) return;
      try { await actions.copyText(geometryProvenanceClipboard(cells, previewNoteContext())); actions.setStatus(`Copied provenance trace for ${cells.length} geometry cell(s).`, 'ok'); }
      catch (error) { actions.setStatus(`Could not copy geometry trace: ${error?.message || error}`, 'error'); }
    });
    previewGeometryClear?.addEventListener('click', () => clearPreviewGeometrySelection({ statusMessage:true }));
    previewGeometryNote?.addEventListener('input', refreshPreviewGeometryUi);
    previewGeometryAddNote?.addEventListener('click', () => {
      try {
        const cells=[...previewGeometrySelection.values()];
        const note=previewGeometryNote?.value?.trim() || '';
        const entry=previewNotesStore.addGeometryNote(previewNoteContext(), cells, note);
        if (previewGeometryNote) previewGeometryNote.value='';
        refreshPreviewGeometryUi();
        actions.setStatus(`Added geometry audit note ${entry.id} for ${entry.geometryIds.length} cell(s).`, 'ok');
      } catch (error) { actions.setStatus(error?.message || String(error), 'error'); }
    });
    previewPauseButton?.addEventListener('click', () => {
      previewPaused = !previewPaused;
      eachLevelPreview(controller => controller.setPaused(previewPaused));
      previewPauseButton.textContent = previewPaused ? 'Resume preview' : 'Pause preview';
    });
    previewResetButton?.addEventListener('click', () => {
      if (previewPhaseInput) previewPhaseInput.value = '0';
      eachLevelPreview(controller => controller.setPhase(0));
    });


    previewEditToggle?.addEventListener('click', () => setPreviewEditorEnabled(!previewEditEnabled));
    previewClearSelectionButton?.addEventListener('click', clearPreviewEditorSelection);

    previewCopyElementId?.addEventListener('click', async () => {
      try {
        await actions.copyText(previewSelectedAsset?.elementId || '');
        actions.setStatus(`Copied element ID ${previewSelectedAsset?.elementId}.`, 'ok');
      } catch (error) { actions.setStatus(`Could not copy element ID: ${error.message}`, 'error'); }
    });
    previewPatchEnabled?.addEventListener('change', () => {
      if (!previewSelectedAsset) return;
      previewPatchStore.update(previewNoteContext(), previewSelectedAsset, { enabled: previewPatchEnabled.checked });
      applyRoomPatches(); refreshPreviewPatchesUi();
      actions.setStatus(`${previewSelectedAsset.elementId} is ${previewPatchEnabled.checked ? 'enabled' : 'disabled'} in the desired patch state.`, 'warn');
    });
    previewPatchBugged?.addEventListener('change', () => {
      if (!previewSelectedAsset) return;
      previewPatchStore.update(previewNoteContext(), previewSelectedAsset, { bugged: previewPatchBugged.value });
      applyRoomPatches(); refreshPreviewPatchesUi();
      actions.setStatus(`Updated bug note for ${previewSelectedAsset.elementId}.`, 'warn');
    });
    function commitSelectedPatchCoordinates() {
      if (!previewSelectedAsset) return;
      const x = Number(previewPatchX?.value), y = Number(previewPatchY?.value);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const id = previewSelectedAsset.elementId;
      const patch = previewPatchStore.update(previewNoteContext(), previewSelectedAsset, { x:Math.round(x), y:Math.round(y) });
      applyRoomPatches(); refreshPreviewPatchesUi();
      const moved = levelPreview?.elementById?.(id, true);
      if (moved) selectPreviewAsset(moved);
      actions.setStatus(`Patched ${id} to absolute map position (${Math.round(patch.target.x)}, ${Math.round(patch.target.y)}).`, 'warn');
    }
    previewPatchX?.addEventListener('change', commitSelectedPatchCoordinates);
    previewPatchY?.addEventListener('change', commitSelectedPatchCoordinates);
    previewPatchCopyId?.addEventListener('click', async () => {
      try { await actions.copyText(previewSelectedAsset?.elementId || ''); actions.setStatus(`Copied element ID ${previewSelectedAsset?.elementId}.`, 'ok'); }
      catch (error) { actions.setStatus(`Could not copy element ID: ${error.message}`, 'error'); }
    });
    previewPatchClearSelection?.addEventListener('click', clearPreviewEditorSelection);
    previewPatchRevert?.addEventListener('click', () => {
      if (!previewSelectedAsset) return;
      const id = previewSelectedAsset.elementId;
      previewPatchStore.remove(previewNoteContext(), previewSelectedAsset);
      applyRoomPatches();
      const restored = levelPreview?.elementById?.(id, true);
      if (restored) selectPreviewAsset(restored); else clearPreviewEditorSelection();
      actions.setStatus(`Reverted review patch for ${id}.`, 'neutral');
    });
    previewPatchesDownload?.addEventListener('click', () => {
      const diff = previewPatchStore.diffSnapshot();
      actions.downloadJson('patches.json', diff);
      const count = (diff.rooms || []).reduce((sum, room) => sum + (room.patches?.length || 0), 0);
      /* Downloading is delivery, not integration. Keep the integration baseline
       * unchanged so every later export from this same build still includes all
       * pending corrections. A position edit can therefore not disappear merely
       * because the user downloaded it before adding another bug note. */
      applyRoomPatches(); refreshPreviewPatchesUi();
      actions.setStatus(`Downloaded ${count} pending patch ${count === 1 ? 'entry' : 'entries'}. Pending corrections stay in subsequent exports until a newer integrated build or explicit baseline import.`, 'ok');
    });
    previewPatchesImport?.addEventListener('change', async event => {
      const [file] = event.target.files || [];
      if (!file) return;
      try {
        previewPatchStore.import(JSON.parse(await file.text()));
        applyRoomPatches(); refreshPreviewPatchesUi();
        actions.setStatus(`Imported ${file.name}. Its desired positions/visibility are active immediately and the import is the explicit integration baseline; later edits are exported as pending changes.`, 'ok');
      } catch (error) { actions.setStatus(`Could not import patches.json: ${error.message}`, 'error'); }
      event.target.value = '';
    });
    previewAssetCategory?.addEventListener('change', () => {
      if (!previewSelectedAsset) return;
      previewSelectedAsset.category = previewAssetCategory.value;
      previewNotesStore.setCategory(previewNoteContext(), previewSelectedAsset, previewAssetCategory.value);
      /* In Map Editor the semantic role is part of the live draft too. This is
       * intentionally presentation metadata until integrated: changing a label
       * here never silently changes descriptor-backed collision/lethality. */
      if (previewWorkspaceMode === 'editor' && !previewSelectedAsset.debugOnly) {
        try { applyPreviewState(previewStateFromFields()); } catch (error) { actions.setStatus(error.message, 'error'); }
      }
    });
    previewAddNoteButton?.addEventListener('click', () => {
      try {
        const note = previewAssetNote?.value?.trim() || '';
        previewNotesStore.addNote(previewNoteContext(), previewSelectedAsset, note, {
          tick: levelPreview?.currentTick?.() || 0,
          x: previewSelectedAsset?.x,
          y: previewSelectedAsset?.y,
          category: previewAssetCategory?.value
        });
        if (previewAssetNote) previewAssetNote.value = '';
        actions.setStatus('Added the selected sprite note to notes.json.', 'ok');
      } catch (error) { actions.setStatus(error.message, 'error'); }
    });
    previewCreateOperationButton?.addEventListener('click', () => {
      try {
        const operation = previewNotesStore.ensureOperation(previewNoteContext(), previewSelectedAsset, {
          name: previewOperationName?.value?.trim() || 'asset operation'
        });
        refreshPreviewOperationUi();
        previewOperationSelect.value = operation.id;
        refreshPreviewOperationUi();
        if (previewOperationName) previewOperationName.value = '';
        actions.setStatus(`Created operation '${operation.name}'.`, 'ok');
      } catch (error) { actions.setStatus(error.message, 'error'); }
    });
    previewOperationSelect?.addEventListener('change', refreshPreviewOperationUi);
    previewTimelineRange?.addEventListener('input', event => scrubPreviewTimeline(event.target.value));
    previewTimelineTick?.addEventListener('change', event => scrubPreviewTimeline(event.target.value));
    previewTimelineFirst?.addEventListener('click', () => scrubPreviewTimeline(0));
    previewTimelinePrev?.addEventListener('click', () => scrubPreviewTimeline(Number(previewTimelineRange?.value || 0) - 1));
    previewTimelineNext?.addEventListener('click', () => scrubPreviewTimeline(Number(previewTimelineRange?.value || 0) + 1));
    previewTimelineLast?.addEventListener('click', () => scrubPreviewTimeline(selectedPreviewTimeline()?.lastTick || 0));
    previewTimelineCapture?.addEventListener('click', () => {
      if (!previewSelectedAsset) return;
      const tick = Number(previewTimelineRange?.value || 0);
      fillPreviewStateFields(selectedTimelineState(), `frame ${tick}`);
      if (previewStateNote && !previewStateNote.value) previewStateNote.value = `Captured from selected sprite timeline frame ${tick}.`;
      actions.setStatus(`Captured selected sprite timeline frame ${tick} into the operation state fields.`, 'neutral');
    });
    previewCaptureStateButton?.addEventListener('click', () => {
      if (!ensureEditablePreviewSelection()) return;
      fillPreviewStateFields(previewSelectedAsset, previewStateLabel?.value || 'state');
      if (previewStateOrder) {
        const asset = selectedNotesAsset();
        const operation = asset?.operations?.find(entry => entry.id === previewOperationSelect?.value);
        previewStateOrder.value = String(operation?.states?.length || 0);
      }
      actions.setStatus('Captured current rendered origin, asset, visibility, flip, and layer into the state fields.', 'neutral');
    });
    previewSaveStateButton?.addEventListener('click', () => {
      try {
        if (!ensureEditablePreviewSelection()) throw new Error('Select an editable sprite first');
        if (!previewOperationSelect?.value) throw new Error('Create or select an operation first');
        const state = previewNotesStore.addState(previewNoteContext(), previewSelectedAsset, previewOperationSelect.value, previewStateFromFields());
        applyPreviewState(state);
        actions.setStatus(`Saved and applied state '${state.label}'.`, 'ok');
      } catch (error) { actions.setStatus(error.message, 'error'); }
    });
    previewApplyStateButton?.addEventListener('click', () => {
      try {
        if (!ensureEditablePreviewSelection()) throw new Error('Select an editable sprite first');
        applyPreviewState(previewStateFromFields());
        actions.setStatus('Applied the state fields immediately to the whole-map preview.', 'ok');
      } catch (error) { actions.setStatus(error.message, 'error'); }
    });
    previewClearOverrideButton?.addEventListener('click', () => {
      if (!ensureEditablePreviewSelection()?.sourceKey) return;
      const key = previewAssetKey(previewSelectedAsset);
      for (const [, controller] of visiblePreviewControllers()) controller.setManualOverride(key, null);
      if (previewWorkspaceMode === 'editor') {
        mapEditorSession.clearEntityOverride(key);
      }
      actions.setStatus('Cleared the preview-only override; production preview data is visible again.', 'neutral');
    });

    /* Map Editor is intentionally live: property changes update the selected
     * presentation immediately, while Map Preview retains the explicit Apply
     * button workflow used for audit notes. */
    for (const input of [previewStateX,previewStateY,previewStatePn,previewStateActor,previewStateDirection,previewStateVisible,previewStateMirror,previewStateMirrorY,previewStateRotation,previewStateFront]) {
      input?.addEventListener('change', () => {
        if (previewWorkspaceMode !== 'editor' || !previewSelectedAsset || previewSelectedAsset.debugOnly) return;
        try { applyPreviewState(previewStateFromFields()); } catch (error) { actions.setStatus(error.message, 'error'); }
      });
    }
    mapEditorSession.install();
    previewFindAssetButton?.addEventListener('click', () => {
      if (!ensureEditablePreviewSelection()) return;
      if (previewAssetBrowser) previewAssetBrowser.hidden = false;
      renderRdxAssetBrowser();
      previewAssetBrowser?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    previewAssetBrowserClose?.addEventListener('click', () => { if (previewAssetBrowser) previewAssetBrowser.hidden = true; });
    previewAssetSearch?.addEventListener('input', renderRdxAssetBrowser);
    previewAssetFilter?.addEventListener('change', renderRdxAssetBrowser);
    previewNotesDownload?.addEventListener('click', () => {
      actions.downloadJson('notes.json', previewNotesStore.snapshot());
      actions.setStatus('Downloaded whole-map sprite annotations and operation states as notes.json.', 'ok');
    });
    previewNotesImport?.addEventListener('change', async event => {
      const [file] = event.target.files || [];
      if (!file) return;
      try {
        previewNotesStore.import(JSON.parse(await file.text()));
        actions.setStatus(`Imported ${file.name}.`, 'ok');
      } catch (error) { actions.setStatus(`Could not import notes.json: ${error.message}`, 'error'); }
      event.target.value = '';
    });

    function previewPatchPointerTarget(point, event) {
      const hits = levelPreview?.hitTestCandidates?.(point.x, point.y) || [];
      if (!hits.length) return null;
      const signature = hits.map(item => item.elementId).join('|');
      let index = 0;
      if (previewViewMode === 'patches' && event?.shiftKey && hits.length > 1) {
        index = previewHitCycle?.signature === signature ? (previewHitCycle.index + 1) % hits.length : 1;
      }
      previewHitCycle = { signature, index };
      if (previewViewMode === 'patches' && hits.length > 1) {
        const hint = index === 0
          ? `${hits.length} selectable elements overlap here; dragging moves ${hits[0].elementId}. Shift-click cycles the others.`
          : `Overlap ${index + 1}/${hits.length}: ${hits[index].elementId}. Drag to patch this exact element.`;
        actions.setStatus(hint, 'neutral');
      }
      return hits[index] || hits[0];
    }

    previewEditorCanvas?.addEventListener('pointerdown', event => {
      if (previewWorkspaceMode === 'editor' && levelPreview) {
        const point = previewPointerPoint(event);
        if (mapEditorSession.beginHeroDrag(event.pointerId, point)) {
          previewEditorCanvas.setPointerCapture(event.pointerId);
          event.preventDefault(); return;
        }
        if (mapEditorSession.targetMode() === 'pieces') {
          mapEditorSession.selectPiece(Math.floor(point.x/8),Math.floor(point.y/8),{source:!!event.shiftKey});
          actions.setStatus(event.shiftKey ? 'Map Editor source piece selected.' : 'Map Editor target piece selected. Shift-click another piece to use it as the visual source.', 'neutral');
          event.preventDefault(); return;
        }
      }
      if (previewRectangleSelect?.checked && levelPreview) {
        const point = previewPointerPoint(event);
        previewRectangleDrag = { pointerId:event.pointerId, start:point, current:point };
        levelPreview.setSelectionBox?.({ x:point.x, y:point.y, width:1, height:1 });
        compareLevelPreview?.setSelectionBox?.({ x:point.x, y:point.y, width:1, height:1 });
        previewEditorCanvas.setPointerCapture(event.pointerId);
        event.preventDefault(); return;
      }
      if (!(previewEditEnabled || previewViewMode === 'patches') || !levelPreview) return;
      const point = previewPointerPoint(event);
      const item = previewViewMode === 'patches' ? previewPatchPointerTarget(point, event) : levelPreview.hitTest(point.x, point.y);
      if (!item) { clearPreviewEditorSelection(); return; }
      selectPreviewAsset(item);
      const existingPatch = previewPatchStore.patch(previewNoteContext(), item, false);
      const target = existingPatch ? patchTargetState(existingPatch) : { x: Number(item.x || 0), y: Number(item.y || 0), dx: 0, dy: 0, enabled: item.visible !== false, bugged: '' };
      const observed = existingPatch?.observed || { x: Number(item.x || 0), y: Number(item.y || 0) };
      previewDrag = {
        pointerId: event.pointerId, start: point,
        x: Number(target.x), y: Number(target.y),
        observedX: Number(observed.x || 0), observedY: Number(observed.y || 0),
        baselineItem: { ...item, x: Number(observed.x || 0), y: Number(observed.y || 0) },
        enabled: target.enabled !== false, bugged: target.bugged || '', moved: false,
        pendingDx: Number(target.dx || 0), pendingDy: Number(target.dy || 0)
      };
      previewEditorCanvas.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    previewEditorCanvas?.addEventListener('pointermove', event => {
      if (mapEditorSession.moveHeroDrag(event.pointerId, previewPointerPoint(event))) {
        event.preventDefault(); return;
      }
      if (previewRectangleDrag && previewRectangleDrag.pointerId === event.pointerId) {
        const point=previewPointerPoint(event); previewRectangleDrag.current=point;
        const rect=normalizeSelectionRect(previewRectangleDrag.start,point);
        levelPreview?.setSelectionBox?.(rect); compareLevelPreview?.setSelectionBox?.(rect);
        event.preventDefault(); return;
      }
      if (!previewDrag || previewDrag.pointerId !== event.pointerId || !previewSelectedAsset) return;
      const point = previewPointerPoint(event);
      const dx = point.x - previewDrag.start.x, dy = point.y - previewDrag.start.y;
      if (Math.abs(dx) + Math.abs(dy) < 1) return;
      previewDrag.moved = true;
      const targetX = Math.round(previewDrag.x + dx), targetY = Math.round(previewDrag.y + dy);
      if (previewViewMode === 'patches') {
        previewDrag.pendingDx = targetX - previewDrag.observedX;
        previewDrag.pendingDy = targetY - previewDrag.observedY;
        const transient = transientPreviewPatch(previewDrag.baselineItem, {
          x: targetX, y: targetY, dx: previewDrag.pendingDx, dy: previewDrag.pendingDy,
          enabled: previewDrag.enabled, bugged: previewDrag.bugged
        });
        applyPatchToPreview(previewSelectedAsset, transient);
        if (previewSelectedPosition) previewSelectedPosition.textContent = `patched origin/contact (${targetX}, ${targetY}) · Δ (${previewDrag.pendingDx}, ${previewDrag.pendingDy})`;
      } else if (!previewSelectedAsset.debugOnly) {
        if (previewStateX) previewStateX.value = String(targetX);
        if (previewStateY) previewStateY.value = String(targetY);
        try { applyPreviewState(previewStateFromFields()); } catch {}
      }
      event.preventDefault();
    });
    previewEditorCanvas?.addEventListener('pointerup', event => {
      if (mapEditorSession.endHeroDrag(event.pointerId)) {
        try { previewEditorCanvas.releasePointerCapture(event.pointerId); } catch {}
        event.preventDefault(); return;
      }
      if (previewRectangleDrag && previewRectangleDrag.pointerId === event.pointerId) {
        const point=previewPointerPoint(event); const rect=normalizeSelectionRect(previewRectangleDrag.start,point);
        try { previewEditorCanvas.releasePointerCapture(event.pointerId); } catch {}
        previewRectangleDrag=null; levelPreview?.setSelectionBox?.(null); compareLevelPreview?.setSelectionBox?.(null);
        finishPreviewRectangleSelection(rect); event.preventDefault(); return;
      }
      if (!previewDrag || previewDrag.pointerId !== event.pointerId) return;
      try { previewEditorCanvas.releasePointerCapture(event.pointerId); } catch {}
      if (previewDrag.moved && previewViewMode === 'patches') {
        const patch = previewPatchStore.update(previewNoteContext(), previewDrag.baselineItem, {
          x: previewDrag.observedX + previewDrag.pendingDx, y: previewDrag.observedY + previewDrag.pendingDy,
          enabled: previewDrag.enabled, bugged: previewDrag.bugged
        });
        const id = previewDrag.baselineItem.elementId;
        applyRoomPatches();
        const moved = levelPreview?.elementById?.(id, true);
        if (moved) selectPreviewAsset(moved);
        actions.setStatus(`Patched ${id}: Δ (${patch.change.dx}, ${patch.change.dy}). Export patches.json when the room is reviewed.`, 'warn');
      } else if (previewDrag.moved) {
        actions.setStatus('Moved the selected sprite by eye. Save this as an operation state to retain it in notes.json.', 'warn');
      }
      previewDrag = null;
    });
    previewEditorCanvas?.addEventListener('pointercancel', () => { previewDrag = null; mapEditorSession.cancelHeroDrag(); previewRectangleDrag=null; levelPreview?.setSelectionBox?.(null); compareLevelPreview?.setSelectionBox?.(null); });


    previewRectangleSelect?.addEventListener('change', () => {
      const enabled=!!previewRectangleSelect.checked;
      document.body.classList.toggle('rdx-preview-rectangle-select', enabled);
      if (enabled) {
        /* Rectangle selection owns pointer input even while Show geometry is on.
         * Geometry is still collected through the same world-space rectangle when
         * Include geometry is checked; the collision canvas must not steal the drag. */
        levelPreview?.setEditorEnabled?.(true); compareLevelPreview?.setEditorEnabled?.(true);
      } else {
        levelPreview?.setSelectionBox?.(null); compareLevelPreview?.setSelectionBox?.(null);
        levelPreview?.setEditorEnabled?.(previewEditEnabled || previewViewMode==='patches');
        compareLevelPreview?.setEditorEnabled?.(previewEditEnabled || previewViewMode==='patches');
      }
    });
    previewSelectionClear?.addEventListener('click', () => { previewRectangleRecords=[]; levelPreview?.setSelectionBox?.(null); compareLevelPreview?.setSelectionBox?.(null); renderPreviewSelectionList(); });

  }

  return {
    install,
    installRooms,
    setGameMetadata,
    setResources,
    clearResources,
    resources:()=>previewResources,
    renderUnresolvedCounts:renderPreviewUnresolvedCounts,
    open:openLevelPreview,
    close:closeLevelPreview,
    mode:()=>previewWorkspaceMode,
    setMode:setPreviewWorkspaceMode,
    selectedRoom:selectedPreviewRoom,
    primaryController:()=>levelPreview,
    compareController:()=>compareLevelPreview,
    rdxController:rdxPreviewController,
    visibleControllers:visiblePreviewControllers,
    eachController:eachLevelPreview,
    itemCategory:previewItemCategory,
    selectedAsset:()=>previewSelectedAsset,
    updateSelection:updatePreviewSelection,
    stopControllers
  };
}
