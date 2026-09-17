import { RDX_PLAYFIELD, renderClassicFramebuffer } from '../../xrick-bridge.js';
import { XRICK_MAP_EDITOR_CONTROL_BY_CODE } from '../runtime/controls.js';
import { COLLISION_PRESETS as MAP_EDITOR_COLLISION_PRESETS } from '../collision/descriptor-semantics.js';

const MAP_EDITOR_STORAGE_KEY = 'rdx.map_editor_draft.v1';
const RDX_STANDING_PLAYER_BODY = Object.freeze({ left:7, right:7, height:20 });

export function createMapEditorSession({ appVersion, elements, runtime, preview, actions }) {
  const PREVIEW_APP_VERSION = String(appVersion || '');
  const {
    mapEditorCopyDraft, mapEditorAdvanced, mapEditorWindowX, mapEditorWindowY,
    mapEditorHeroX, mapEditorHeroY, mapEditorUseSelection, mapEditorPlaytest,
    mapEditorStopPlaytest, mapEditorPlaytestWindow, mapEditorPlaytestCanvas,
    mapEditorPlaytestStatus, mapEditorInvulnerable, mapEditorTargetX,
    mapEditorTargetY, mapEditorSourceX, mapEditorSourceY, mapEditorLayer,
    mapEditorTargetMode, mapEditorOperation, mapEditorSourceLayer,
    mapEditorCollision, mapEditorPieceId, mapEditorLogicId, mapEditorCopyCell,
    mapEditorApplyCell, mapEditorClearCells, mapEditorRevertCell, mapEditorUndo,
    mapEditorRedo, mapEditorStatus, mapEditorSelectedId, playtestPanel
  } = elements;
  const mapEditorPlaytestContext = mapEditorPlaytestCanvas?.getContext?.('2d', { alpha:false, desynchronized:true }) || null;
  if (mapEditorPlaytestContext) mapEditorPlaytestContext.imageSmoothingEnabled = false;

  let mapEditorDraft = { schema:'rdx.map_editor_draft.v2', version:PREVIEW_APP_VERSION, rooms:{} };
  let mapEditorPlaytestActive = false;
  let mapEditorPlaytestCaptured = false;
  let mapEditorPlaytestControlMask = 0;
  let mapEditorPlaytestRestoreInvulnerable = false;
  let mapEditorPlaytestFault = '';
  let mapEditorCellOverrides = [];
  let mapEditorGeometryOverrides = [];
  let mapEditorHistory = [];
  let mapEditorRedoHistory = [];
  let mapEditorPieceSelection = null;
  let pendingMapEditorStart = null;
  let heroDrag = null;

  function loadMapEditorDraft() {
    try {
      const stored = globalThis.localStorage?.getItem?.(MAP_EDITOR_STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored);
      if (['rdx.map_editor_draft.v1','rdx.map_editor_draft.v2'].includes(parsed?.schema) && parsed?.rooms && typeof parsed.rooms === 'object') {
        mapEditorDraft = { ...parsed, schema:'rdx.map_editor_draft.v2', version:PREVIEW_APP_VERSION };
        for (const room of Object.values(mapEditorDraft.rooms)) {
          room.cellReplacements ||= [];
          room.geometryOverrides ||= [];
        }
      }
    } catch {}
  }

  function persistMapEditorDraft() {
    mapEditorDraft.version = PREVIEW_APP_VERSION;
    try { globalThis.localStorage?.setItem?.(MAP_EDITOR_STORAGE_KEY, JSON.stringify(mapEditorDraft)); } catch {}
  }

  function mapEditorRoomDraft(create = true) {
    const room = preview.selectedRoom();
    if (!room) return null;
    const key = `${Number(room.submap)}:${Number(room.mapId)}`;
    if (!mapEditorDraft.rooms[key] && create) {
      let hero = null;
      for (const [, controller] of preview.visibleControllers()) {
        hero = (controller.selectionCandidates?.(true) || []).find(item => preview.itemCategory(item) === 'hero');
        if (hero) break;
      }
      mapEditorDraft.rooms[key] = {
        submap:Number(room.submap), mapId:Number(room.mapId),
        entityOverrides:{}, cellReplacements:[], geometryOverrides:[],
        window:{ x:0, y:Math.max(0, Number(room.runtimeDyPx || 0)), width:320, height:192 },
        heroStart:{ x:Number(hero?.x ?? 32), y:Number(hero?.y ?? (Number(room.runtimeDyPx || 0) + 64)) },
        heroPlacement:'auto-pending'
      };
    }
    return mapEditorDraft.rooms[key] || null;
  }

  function mapEditorRoomSummary() {
    const draft = mapEditorRoomDraft(false);
    if (!draft) return 'No map-editor draft changes.';
    const entities = Object.keys(draft.entityOverrides || {}).length;
    const cells = (draft.cellReplacements || []).length;
    const geometry = (draft.geometryOverrides || []).length;
    return `${entities} entity override${entities === 1 ? '' : 's'} · ${cells} visual map edit${cells === 1 ? '' : 's'} · ${geometry} collision edit${geometry === 1 ? '' : 's'} · hero (${Math.round(draft.heroStart?.x || 0)}, ${Math.round(draft.heroStart?.y || 0)})`;
  }

  function updateMapEditorStatus() {
    if (mapEditorStatus) mapEditorStatus.textContent = mapEditorRoomSummary();
    if (mapEditorSelectedId) mapEditorSelectedId.textContent = preview.selectedAsset()?.elementId || preview.selectedAsset()?.sourceKey || 'Select an entity to edit its X/Y, PN, rotation, visibility and layer in the Element editor below.';
  }

  function syncMapEditorFields() {
    if (preview.workspaceMode() !== 'editor') return;
    const draft = mapEditorRoomDraft(true); if (!draft) return;
    const w = draft.window || { x:0,y:0,width:320,height:192 };
    const h = draft.heroStart || { x:32,y:64 };
    if (mapEditorWindowX) mapEditorWindowX.value = String(Math.round(w.x || 0));
    if (mapEditorWindowY) mapEditorWindowY.value = String(Math.round(w.y || 0));
    if (mapEditorHeroX) mapEditorHeroX.value = String(Math.round(h.x || 0));
    if (mapEditorHeroY) mapEditorHeroY.value = String(Math.round(h.y || 0));
    updateMapEditorStatus();
  }

  function updateMapEditorOverlay() {
    const draft = preview.workspaceMode() === 'editor' ? mapEditorRoomDraft(true) : null;
    const overlay = draft ? { window:{ ...(draft.window || {}), width:320, height:192 }, hero:{ ...(draft.heroStart || {}) },
      targetCell: mapEditorPieceSelection?.target ? { x:mapEditorPieceSelection.target[0], y:mapEditorPieceSelection.target[1] } : null,
      sourceCell: mapEditorPieceSelection?.source ? { x:mapEditorPieceSelection.source[0], y:mapEditorPieceSelection.source[1] } : null } : null;
    preview.eachController(controller => controller.setMapEditorOverlay?.(overlay));
  }

  function applyMapEditorCellOverrides() {
    const draft = mapEditorRoomDraft(false);
    mapEditorCellOverrides = Array.isArray(draft?.cellReplacements) ? draft.cellReplacements : [];
    mapEditorGeometryOverrides = Array.isArray(draft?.geometryOverrides) ? draft.geometryOverrides : [];
    for (const [, controller] of preview.visibleControllers()) {
      const isRdx = controller.selection?.visualSource === 'rdx';
      controller.setMapCellOverrides?.(isRdx ? mapEditorCellOverrides : []);
      controller.setGeometryOverrides?.(isRdx ? mapEditorGeometryOverrides : []);
    }
    updateMapEditorStatus();
  }

  function mapEditorController() { return preview.rdxController() || preview.primaryController(); }

  function mapEditorDimensions(controller = mapEditorController()) {
    return {
      width:Number(controller?.selection?.dimensions?.width || 320),
      height:Number(controller?.selection?.dimensions?.height || 192)
    };
  }

  function mapEditorClampHero(x, y, controller = mapEditorController()) {
    const { width, height } = mapEditorDimensions(controller);
    const body = RDX_STANDING_PLAYER_BODY;
    return {
      x:Math.max(body.left, Math.min(Math.max(body.left,width-1-body.right), Math.round(Number(x || 0)))),
      y:Math.max(body.height, Math.min(Math.max(body.height,height-1), Math.round(Number(y || 0))))
    };
  }

  function setMapEditorHero(x, y, { placement = 'manual', persist = true } = {}) {
    const draft = mapEditorRoomDraft(true); if (!draft) return null;
    const hero = mapEditorClampHero(x, y);
    draft.heroStart = hero;
    draft.heroPlacement = placement;
    if (mapEditorHeroX) mapEditorHeroX.value = String(hero.x);
    if (mapEditorHeroY) mapEditorHeroY.value = String(hero.y);
    if (persist) persistMapEditorDraft();
    updateMapEditorOverlay(); updateMapEditorStatus();
    return hero;
  }

  function mapEditorHeroBodyFree(controller, x, y, windowRect) {
    if (!controller) return true;
    const collider = RDX_STANDING_PLAYER_BODY;
    const body = { x:x-collider.left, y:y-collider.height, width:collider.left+collider.right+1, height:collider.height };
    const right = Number(windowRect.x || 0) + Number(windowRect.width || 320);
    const bottom = Number(windowRect.y || 0) + Number(windowRect.height || 192);
    if (body.x < Number(windowRect.x || 0) || body.y < Number(windowRect.y || 0) || body.x + body.width > right || y >= bottom) return false;
    /* Native spawn_position_is_clear() rejects full-solid overlap only.
     * Explicit Map Editor pass-through/one-way/climb/lethal cells must therefore
     * not be treated as a blocked spawn merely because geometryCellAt() exposes
     * them for editing/diagnostics. */
    return !(controller.geometryCellsInRect?.(body) || []).some(cell =>
      Number(cell?.kindCode) === 1 || String(cell?.kind || '') === 'solid');
  }

  function firstAvailableMapEditorHero(windowRect, controller = mapEditorController()) {
    const w = windowRect || { x:0,y:0,width:320,height:192 };
    const minGX = Math.ceil((Number(w.x || 0) + RDX_STANDING_PLAYER_BODY.left) / 8);
    const maxGX = Math.floor((Number(w.x || 0) + Number(w.width || 320) - 1 - RDX_STANDING_PLAYER_BODY.right) / 8);
    const minGY = Math.ceil((Number(w.y || 0) + 21) / 8);
    const maxGY = Math.floor((Number(w.y || 0) + Number(w.height || 192) - 1) / 8);
    let fallback = null;
    /* Prefer a body-clear point immediately above a safe support cell so local
     * playtest starts stable instead of dropping Rick from the top of the view. */
    for (let gy=minGY; gy<=maxGY; gy+=1) for (let gx=minGX; gx<=maxGX; gx+=1) {
      const x=gx*8+4, supportY=gy*8+4, y=gy*8-1;
      if (!mapEditorHeroBodyFree(controller,x,y,w)) continue;
      if (!fallback) fallback={x,y};
      const support=controller?.geometryCellAt?.(x,supportY) || null;
      if (support && ['solid','one-way-support','super-pad'].includes(String(support.kind || ''))) return {x,y};
    }
    if (fallback) return fallback;
    for (let y=Math.round(Number(w.y || 0))+20; y<Number(w.y || 0)+Number(w.height || 192); y+=4) {
      for (let x=Math.round(Number(w.x || 0))+RDX_STANDING_PLAYER_BODY.left; x<Number(w.x || 0)+Number(w.width || 320)-RDX_STANDING_PLAYER_BODY.right; x+=8) {
        if (mapEditorHeroBodyFree(controller,x,y,w)) return {x,y};
      }
    }
    return mapEditorClampHero(Number(w.x || 0)+16, Number(w.y || 0)+32, controller);
  }

  function autoPlaceMapEditorHero({ force = false } = {}) {
    const draft = mapEditorRoomDraft(true); if (!draft) return null;
    if (!force && draft.heroPlacement !== 'auto-pending') return draft.heroStart;
    const hero = firstAvailableMapEditorHero(draft.window, mapEditorController());
    return setMapEditorHero(hero.x, hero.y, { placement:'auto', persist:true });
  }

  function saveMapEditorWindowFields({ autoPlaceHero = true } = {}) {
    const draft = mapEditorRoomDraft(true); if (!draft) return;
    const { width, height } = mapEditorDimensions();
    const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, Number(value || 0)));
    draft.window = {
      x:clamp(mapEditorWindowX?.value, 0, Math.max(0,width-320)),
      y:clamp(mapEditorWindowY?.value, 0, Math.max(0,height-192)), width:320, height:192
    };
    persistMapEditorDraft();
    if (autoPlaceHero) autoPlaceMapEditorHero({ force:true });
    else { updateMapEditorOverlay(); updateMapEditorStatus(); }
  }

  function saveMapEditorHeroFields() {
    setMapEditorHero(mapEditorHeroX?.value, mapEditorHeroY?.value, { placement:'manual', persist:true });
  }

  function saveMapEditorViewportFields() {
    saveMapEditorWindowFields({ autoPlaceHero:false });
    saveMapEditorHeroFields();
  }

  function centerMapEditorWindowOnSelection() {
    if (!preview.selectedAsset()?.bounds) throw new Error('Select an entity first');
    const draft = mapEditorRoomDraft(true); if (!draft) throw new Error('No map selected');
    const controller = preview.rdxController() || preview.primaryController();
    const width = Number(controller?.selection?.dimensions?.width || 320);
    const height = Number(controller?.selection?.dimensions?.height || 192);
    const b = preview.selectedAsset().bounds;
    const cx = Number(b.x || 0) + Number(b.width || 1) / 2;
    const cy = Number(b.y || 0) + Number(b.height || 1) / 2;
    draft.window = {
      x:Math.max(0,Math.min(Math.max(0,width-320),Math.round(cx-160))),
      y:Math.max(0,Math.min(Math.max(0,height-192),Math.round(cy-96))), width:320,height:192
    };
    /* For explicit Rick selections, make the selected origin the proposed
     * start. For ordinary entities only move the viewport; the user can edit
     * Rick independently. */
    if (preview.itemCategory(preview.selectedAsset()) === 'hero') {
      draft.heroStart = { x:Number(preview.selectedAsset().x||0), y:Number(preview.selectedAsset().y||0) };
      draft.heroPlacement = 'manual';
      persistMapEditorDraft();
    } else {
      draft.heroPlacement = 'auto-pending';
      persistMapEditorDraft();
      autoPlaceMapEditorHero({ force:true });
    }
    syncMapEditorFields(); updateMapEditorOverlay();
  }

  function mapEditorSnapshotRoom() {
    const draft=mapEditorRoomDraft(false); return draft ? JSON.parse(JSON.stringify(draft)) : null;
  }

  function mapEditorPushHistory() {
    const before=mapEditorSnapshotRoom(); if (!before) return;
    mapEditorHistory.push(before); if (mapEditorHistory.length>50) mapEditorHistory.shift();
    mapEditorRedoHistory.length=0; updateMapEditorHistoryButtons();
  }

  function mapEditorRestoreRoomSnapshot(snapshot) {
    const room=preview.selectedRoom(); if (!room || !snapshot) return false;
    const key=`${Number(room.submap)}:${Number(room.mapId)}`;
    mapEditorDraft.rooms[key]=JSON.parse(JSON.stringify(snapshot)); persistMapEditorDraft();
    applyMapEditorCellOverrides(); syncMapEditorFields(); updateMapEditorPieceReadout(); updateMapEditorOverlay(); return true;
  }

  function updateMapEditorHistoryButtons() {
    if (mapEditorUndo) mapEditorUndo.disabled=!mapEditorHistory.length;
    if (mapEditorRedo) mapEditorRedo.disabled=!mapEditorRedoHistory.length;
  }

  function mapEditorLogicForG8(gx,gy) { return [Math.floor(Number(gx)/2),Math.floor(Number(gy)/2)]; }

  function selectMapEditorPiece(gx,gy,{source=false}={}) {
    const dims=mapEditorDimensions(); const maxX=Math.max(0,Math.ceil(dims.width/8)-1), maxY=Math.max(0,Math.ceil(dims.height/8)-1);
    gx=Math.max(0,Math.min(maxX,Math.floor(Number(gx)||0))); gy=Math.max(0,Math.min(maxY,Math.floor(Number(gy)||0)));
    mapEditorPieceSelection ||= {};
    if (source) {
      mapEditorPieceSelection.source=[gx,gy]; if(mapEditorSourceX)mapEditorSourceX.value=String(gx); if(mapEditorSourceY)mapEditorSourceY.value=String(gy);
    } else {
      mapEditorPieceSelection.target=[gx,gy]; if(mapEditorTargetX)mapEditorTargetX.value=String(gx); if(mapEditorTargetY)mapEditorTargetY.value=String(gy);
      if (!mapEditorPieceSelection.source) { mapEditorPieceSelection.source=[gx,gy]; if(mapEditorSourceX)mapEditorSourceX.value=String(gx); if(mapEditorSourceY)mapEditorSourceY.value=String(gy); }
      const draft=mapEditorRoomDraft(false); const [lx,ly]=mapEditorLogicForG8(gx,gy);
      const collision=(draft?.geometryOverrides||[]).find(row=>row.logic?.[0]===lx&&row.logic?.[1]===ly)?.collision || 'original';
      if(mapEditorCollision)mapEditorCollision.value=collision;
    }
    updateMapEditorPieceReadout(); updateMapEditorOverlay(); return [gx,gy];
  }

  function updateMapEditorPieceReadout() {
    const room=preview.selectedRoom(); const target=mapEditorPieceSelection?.target;
    if (!room || !target) { if(mapEditorPieceId)mapEditorPieceId.textContent='Click any map piece.'; if(mapEditorLogicId)mapEditorLogicId.textContent='Collision cell: —'; return; }
    const [gx,gy]=target, [lx,ly]=mapEditorLogicForG8(gx,gy);
    if(mapEditorPieceId)mapEditorPieceId.textContent=`${actions.mdAssetName(room.mapId)}#map-edit#g8:${gx}:${gy}`;
    const cell=mapEditorController()?.geometryCellAt?.(gx*8+4,gy*8+4);
    if(mapEditorLogicId)mapEditorLogicId.textContent=`RDX descriptor logic ${lx},${ly} (g8 ${lx*2}-${lx*2+1} × ${ly*2}-${ly*2+1}) · ${cell?.kindName || 'open / no collision'}`;
  }

  function mapEditorRemoveVisualTarget(draft,tx,ty,layers='AB') {
    draft.cellReplacements=(draft.cellReplacements||[]).filter(row=>!(row.target?.[0]===tx&&row.target?.[1]===ty&&String(layers).includes(String(row.layer||'A'))));
  }

  function applyMapEditorDraftEdit() {
    const room=preview.selectedRoom(), draft=mapEditorRoomDraft(true); if(!room||!draft) throw new Error('No map selected');
    const tx=Number(mapEditorTargetX?.value),ty=Number(mapEditorTargetY?.value),sx=Number(mapEditorSourceX?.value),sy=Number(mapEditorSourceY?.value);
    const dims=mapEditorDimensions(), maxGX=Math.max(0,Math.ceil(dims.width/8)-1), maxGY=Math.max(0,Math.ceil(dims.height/8)-1);
    if(![tx,ty].every(Number.isInteger)||tx<0||ty<0||tx>maxGX||ty>maxGY) throw new Error(`Target g8 coordinates must be within 0..${maxGX}, 0..${maxGY}`);
    const operation=String(mapEditorOperation?.value||'copy'), layers=String(mapEditorLayer?.value||'A').toUpperCase(), sourceLayer=String(mapEditorSourceLayer?.value||'A').toUpperCase();
    if(operation==='copy'&&(![sx,sy].every(Number.isInteger)||sx<0||sy<0||sx>maxGX||sy>maxGY)) throw new Error(`Source g8 coordinates must be within 0..${maxGX}, 0..${maxGY}`);
    mapEditorPushHistory(); draft.cellReplacements ||= []; draft.geometryOverrides ||= [];
    if(operation!=='keep') {
      for(const layer of (layers==='AB'?['A','B']:[layers])) {
        mapEditorRemoveVisualTarget(draft,tx,ty,layer);
        draft.cellReplacements.push({ id:`${actions.mdAssetName(room.mapId)}#map-edit#g8:${tx}:${ty}:${layer}`, submap:Number(room.submap),mapId:Number(room.mapId),target:[tx,ty],source:operation==='clear'?null:[sx,sy],layer,sourceLayer,operation:operation==='clear'?'clear':'copy',authority:'map-editor-draft' });
      }
    }
    const [lx,ly]=mapEditorLogicForG8(tx,ty), collision=String(mapEditorCollision?.value||'original');
    draft.geometryOverrides=draft.geometryOverrides.filter(row=>!(row.logic?.[0]===lx&&row.logic?.[1]===ly));
    if(collision!=='original') {
      const preset=MAP_EDITOR_COLLISION_PRESETS[collision]; if(!preset) throw new Error(`Unsupported collision type ${collision}`);
      draft.geometryOverrides.push({ id:`${actions.mdAssetName(room.mapId)}#map-edit#logic:${lx}:${ly}`,submap:Number(room.submap),mapId:Number(room.mapId),logic:[lx,ly],collision,mt:preset.mt,ml:preset.ml,authority:'map-editor-draft' });
    }
    persistMapEditorDraft(); applyMapEditorCellOverrides(); selectMapEditorPiece(tx,ty); updateMapEditorHistoryButtons();
    actions.setStatus(`Map Editor applied ${actions.mdAssetName(room.mapId)} g8 ${tx},${ty}; collision ${collision}. Local playtest will consume this same draft.`, 'ok');
  }

  function revertMapEditorTarget() {
    const draft=mapEditorRoomDraft(false), target=mapEditorPieceSelection?.target; if(!draft||!target)return;
    mapEditorPushHistory(); const [tx,ty]=target,[lx,ly]=mapEditorLogicForG8(tx,ty);
    draft.cellReplacements=(draft.cellReplacements||[]).filter(row=>!(row.target?.[0]===tx&&row.target?.[1]===ty));
    draft.geometryOverrides=(draft.geometryOverrides||[]).filter(row=>!(row.logic?.[0]===lx&&row.logic?.[1]===ly));
    persistMapEditorDraft(); applyMapEditorCellOverrides(); if(mapEditorCollision)mapEditorCollision.value='original'; updateMapEditorPieceReadout(); updateMapEditorHistoryButtons();
  }

  function applyMapEditorRuntimeDraft(start) {
    const draft=mapEditorRoomDraft(false); if(!runtime.bridge()||!draft)return true;
    runtime.bridge().clearMapEditorVisualOverrides?.();
    for(const edit of draft.cellReplacements||[]) {
      const [tx,ty]=edit.target||[]; const [sx,sy]=edit.source||[-1,-1];
      const targetPlane=edit.layer==='B'?0:1, sourcePlane=edit.sourceLayer==='B'?0:1;
      if(!runtime.bridge().addMapEditorVisualOverride?.(start.mapId,tx,ty,sx??-1,sy??-1,targetPlane,sourcePlane,edit.operation==='clear')) return false;
    }
    runtime.bridge().restoreNativeWorldOriginal?.();
    for(const edit of draft.geometryOverrides||[]) {
      const [lx,ly]=edit.logic||[]; const preset=MAP_EDITOR_COLLISION_PRESETS[edit.collision]; if(!preset)continue;
      /* The live RDX descriptor world retains the ROM one-cell border. */
      if(!runtime.bridge().setNativeWorldCell?.(lx+1,ly+1,preset.mt,preset.ml)) return false;
    }
    return true;
  }

  function applyMapEditorCellReplacement() {
    const room = preview.selectedRoom(); const draft = mapEditorRoomDraft(true);
    if (!room || !draft) throw new Error('No map selected');
    const values = [mapEditorTargetX?.value,mapEditorTargetY?.value,mapEditorSourceX?.value,mapEditorSourceY?.value].map(Number);
    if (!values.every(Number.isInteger) || values.some(value => value < 0)) throw new Error('Map-piece grid coordinates must be non-negative integers');
    const [tx,ty,sx,sy] = values, layer = String(mapEditorLayer?.value || 'A').toUpperCase();
    const entry = {
      id:`${actions.mdAssetName(room.mapId)}#map-edit#g8:${tx}:${ty}:${layer}`,
      submap:Number(room.submap), mapId:Number(room.mapId), target:[tx,ty], source:[sx,sy], layer,
      authority:'map-editor-draft'
    };
    draft.cellReplacements ||= [];
    const key = row => `${row.target?.[0]}:${row.target?.[1]}:${row.layer}`;
    const at = draft.cellReplacements.findIndex(row => key(row) === key(entry));
    if (at >= 0) draft.cellReplacements.splice(at,1,entry); else draft.cellReplacements.push(entry);
    persistMapEditorDraft(); applyMapEditorCellOverrides();
    actions.setStatus(`Map Editor copied g8 ${sx},${sy} → ${tx},${ty} on layer ${layer}.`, 'ok');
    return entry;
  }

  function stopMapEditorPlaytest() {
    clearMapEditorPlaytestControls();
    mapEditorPlaytestActive = false;
    mapEditorPlaytestCaptured = false;
    pendingMapEditorStart = null;
    mapEditorPlaytestFault = '';
    runtime.bridge()?.setDebugInvincible?.(mapEditorPlaytestRestoreInvulnerable);
    runtime.bridge()?.clearMapEditorVisualOverrides?.();
    runtime.bridge()?.restoreNativeWorldOriginal?.();
    runtime.bridge()?.forceBrowserFrame?.();
    if (mapEditorPlaytestWindow) mapEditorPlaytestWindow.hidden = true;
    if (mapEditorStopPlaytest) mapEditorStopPlaytest.hidden = true;
    if (mapEditorPlaytest) mapEditorPlaytest.textContent = '▶ Playtest this window';
    if (mapEditorPlaytestStatus) mapEditorPlaytestStatus.textContent = 'Stopped.';
  }

  function renderMapEditorPlaytest(snapshot) {
    if (!mapEditorPlaytestActive || preview.workspaceMode() !== 'editor' || !mapEditorPlaytestContext || !runtime.bridge()) return;
    try {
      if (snapshot.enabled && runtime.bridge().presentationReady() && !snapshot.presentationMode) {
        const pixels = runtime.bridge().presentationFramebuffer();
        mapEditorPlaytestContext.putImageData(new ImageData(pixels, 320, 200), 0, 0);
      } else {
        renderClassicFramebuffer(runtime.bridge(), mapEditorPlaytestContext, {
          transparentZero:false, playfieldShiftX:0, playfieldTop:RDX_PLAYFIELD.y
        });
      }
      if (mapEditorPlaytestStatus && !pendingMapEditorStart) {
        mapEditorPlaytestStatus.textContent = mapEditorPlaytestFault || `${actions.smAssetName(snapshot.submap)} · frame ${snapshot.frameSerial} · ${mapEditorPlaytestCaptured ? 'input captured · arrows/space control Rick' : 'click the local playtest to capture input'}`;
      }
    } catch (error) {
      if (mapEditorPlaytestStatus) mapEditorPlaytestStatus.textContent = `Render error: ${error.message}`;
    }
  }

  function startMapEditorPlaytest() {
    const room = preview.selectedRoom(); const draft = mapEditorRoomDraft(true);
    if (!room || !draft || !runtime.bridge()) return false;
    /* Restart is a real cold local-playtest attempt, not a continuation of the
     * previous attempt. This makes repeated Stop/Restart cycles consume the most
     * recently dragged/typed Hero position deterministically. */
    if (mapEditorPlaytestActive) {
      clearMapEditorPlaytestControls();
      pendingMapEditorStart = null;
      runtime.bridge().clearMapEditorVisualOverrides?.();
      runtime.bridge().restoreNativeWorldOriginal?.();
      runtime.bridge().forceBrowserFrame?.();
    }
    saveMapEditorViewportFields();
    const runtimeOffset = runtime.renderer()?.mapping?.runtimeOffsetForSubmap?.(room.submap) || { dyPx:Number(room.runtimeDyPx || 0) };
    const localWindowY = Number(draft.window?.y || 0) - Number(runtimeOffset?.dyPx || 0);
    const cameraFrow = Math.max(0, Number(room.classicStartRow || 0) + Math.floor(localWindowY / 8));
    const previousWorldGeneration = runtime.bridge().nativeWorldGeneration?.() ?? runtime.bridge().snapshot()?.collision?.native?.worldGeneration ?? 0;
    pendingMapEditorStart = { submap:Number(room.submap), mapId:Number(room.mapId), cameraFrow, hero:{ ...draft.heroStart }, previousWorldGeneration };
    mapEditorPlaytestFault = '';
    mapEditorPlaytestRestoreInvulnerable = !!runtime.bridge().snapshot()?.debug?.invincible;
    mapEditorPlaytestActive = true;
    mapEditorPlaytestCaptured = true;
    runtime.bridge().setDebugInvincible(!!mapEditorInvulnerable?.checked);
    runtime.bridge().clearMapEditorVisualOverrides?.();
    clearMapEditorPlaytestControls();
    if (mapEditorPlaytestWindow) mapEditorPlaytestWindow.hidden = false;
    if (mapEditorStopPlaytest) mapEditorStopPlaytest.hidden = false;
    if (mapEditorPlaytest) mapEditorPlaytest.textContent = '↻ Restart this window';
    if (mapEditorPlaytestStatus) mapEditorPlaytestStatus.textContent = `Loading ${actions.smAssetName(room.submap)} at Rick (${Math.round(draft.heroStart.x)}, ${Math.round(draft.heroStart.y)})…`;
    /* Map Editor owns its local playtest. Never navigate to or reveal the global
     * Playtest panel; the whole-map editor and its selection/fields remain live. */
    if (playtestPanel) playtestPanel.hidden = true;
    if (!actions.requestSubmap(room.submap)) { stopMapEditorPlaytest(); return false; }
    runtime.bridge().forceBrowserFrame();
    mapEditorPlaytestCanvas?.focus?.({ preventScroll:true });
    return true;
  }

  function applyPendingMapEditorStart(snapshot) {
    if (!pendingMapEditorStart || !runtime.bridge() || snapshot.submap !== pendingMapEditorStart.submap) return;
    if (!snapshot.collision?.native?.worldLoaded && !runtime.bridge().api.nativeWorldLoaded()) return;
    const start = pendingMapEditorStart;
    const generation = snapshot.collision?.native?.worldGeneration ?? runtime.bridge().nativeWorldGeneration?.() ?? 0;
    /* A same-room restart used to teleport into the OLD world and then have the
     * cold-entry reset overwrite Rick. Wait for the requested room generation. */
    if (Number(generation) === Number(start.previousWorldGeneration)) return;
    if (!applyMapEditorRuntimeDraft(start)) {
      pendingMapEditorStart=null; mapEditorPlaytestFault='Could not apply Map Editor draft to the native runtime; parity gate stopped playtest.';
      runtime.bridge().clearMapEditorVisualOverrides?.(); runtime.bridge().restoreNativeWorldOriginal?.();
      if(mapEditorPlaytestStatus)mapEditorPlaytestStatus.textContent=mapEditorPlaytestFault; return;
    }
    runtime.bridge().setCameraFrow(start.cameraFrow);
    if (!runtime.bridge().teleportWorld(start.hero.x, start.hero.y, false)) {
      pendingMapEditorStart = null;
      mapEditorPlaytestFault = `Shared Rick checkpoint rejected RDX world coordinate (${Math.round(start.hero.x)}, ${Math.round(start.hero.y)}). Check the room transform and Hero marker bounds, then restart.`;
      mapEditorPlaytestCaptured = false;
      clearMapEditorPlaytestControls();
      runtime.bridge().clearMapEditorVisualOverrides?.(); runtime.bridge().restoreNativeWorldOriginal?.();
      if (mapEditorPlaytestStatus) mapEditorPlaytestStatus.textContent = `Shared Rick checkpoint rejected RDX world coordinate (${Math.round(start.hero.x)}, ${Math.round(start.hero.y)}). Check the room transform and Hero marker bounds, then restart.`;
      actions.setStatus('Map Editor local playtest could not install the requested RDX-world Rick checkpoint into the shared xrick solver.', 'warn');
      return;
    }
    const verified = runtime.bridge().snapshot()?.collision?.native;
    const exact = Number(verified?.playerWorldX) === Math.round(Number(start.hero.x)) && Number(verified?.playerWorldY) === Math.round(Number(start.hero.y));
    if (!exact) {
      pendingMapEditorStart = null;
      mapEditorPlaytestFault = `Parity error: shared Rick diagnostics resolved to (${verified?.playerWorldX ?? '?'}, ${verified?.playerWorldY ?? '?'}) instead of (${Math.round(start.hero.x)}, ${Math.round(start.hero.y)}).`;
      mapEditorPlaytestCaptured = false;
      if (mapEditorPlaytestStatus) mapEditorPlaytestStatus.textContent = `Parity error: shared Rick diagnostics resolved to (${verified?.playerWorldX ?? '?'}, ${verified?.playerWorldY ?? '?'}) instead of (${Math.round(start.hero.x)}, ${Math.round(start.hero.y)}).`;
      actions.setStatus('Map Editor/local-playtest spawn parity failed; playtest input was stopped.', 'error');
      clearMapEditorPlaytestControls();
      runtime.bridge().clearMapEditorVisualOverrides?.(); runtime.bridge().restoreNativeWorldOriginal?.();
      return;
    }
    pendingMapEditorStart = null;
    runtime.bridge().forceBrowserFrame();
    if (mapEditorPlaytestStatus) mapEditorPlaytestStatus.textContent = `Live · ${actions.smAssetName(start.submap)} · Rick (${Math.round(start.hero.x)}, ${Math.round(start.hero.y)}) · input captured`;
    actions.setStatus(`Map Editor local playtest started exactly from Rick (${Math.round(start.hero.x)}, ${Math.round(start.hero.y)}).`, 'ok');
  }

  function clearMapEditorPlaytestControls() {
    mapEditorPlaytestControlMask = 0;
    runtime.bridge()?.setDebugControl?.(0);
  }

  function setMapEditorPlaytestKey(code, pressed) {
    const bit = XRICK_MAP_EDITOR_CONTROL_BY_CODE[code];
    if (!bit) return false;
    mapEditorPlaytestControlMask = pressed ? (mapEditorPlaytestControlMask | bit) : (mapEditorPlaytestControlMask & ~bit);
    runtime.bridge()?.setDebugControl?.(mapEditorPlaytestControlMask);
    return true;
  }

  function captureMapEditorPlaytestInput() {
    if (!mapEditorPlaytestActive || !mapEditorPlaytestCanvas) return false;
    mapEditorPlaytestCaptured = true;
    mapEditorPlaytestCanvas.focus?.({ preventScroll:true });
    if (mapEditorPlaytestStatus && !pendingMapEditorStart) mapEditorPlaytestStatus.textContent = 'Input captured · arrows / O K Z X + Space control Rick';
    return true;
  }

  function releaseMapEditorPlaytestInput() {
    mapEditorPlaytestCaptured = false;
    clearMapEditorPlaytestControls();
    if (mapEditorPlaytestStatus && mapEditorPlaytestActive && !pendingMapEditorStart) mapEditorPlaytestStatus.textContent = 'Click the local playtest to capture input.';
  }


  function setEntityOverride(key, value) {
    const draft = mapEditorRoomDraft(true);
    if (!draft || !key) return false;
    draft.entityOverrides ||= {};
    draft.entityOverrides[key] = value;
    persistMapEditorDraft(); updateMapEditorStatus(); return true;
  }
  function clearEntityOverride(key) {
    const draft = mapEditorRoomDraft(false);
    if (!draft?.entityOverrides || !key) return false;
    const existed = Object.hasOwn(draft.entityOverrides, key);
    delete draft.entityOverrides[key];
    if (existed) persistMapEditorDraft();
    updateMapEditorStatus(); return existed;
  }
  function beginHeroDrag(pointerId, point) {
    if (preview.workspaceMode() !== 'editor') return false;
    const hero = mapEditorRoomDraft(false)?.heroStart;
    if (!hero || point.x < hero.x - 10 || point.x > hero.x + 10 || point.y < hero.y - 24 || point.y > hero.y + 6) return false;
    heroDrag = { pointerId, offsetX:point.x - hero.x, offsetY:point.y - hero.y }; return true;
  }
  function moveHeroDrag(pointerId, point) {
    if (!heroDrag || heroDrag.pointerId !== pointerId) return false;
    setMapEditorHero(point.x - heroDrag.offsetX, point.y - heroDrag.offsetY, { placement:'manual', persist:false }); return true;
  }
  function endHeroDrag(pointerId) {
    if (!heroDrag || heroDrag.pointerId !== pointerId) return false;
    heroDrag = null; persistMapEditorDraft(); updateMapEditorOverlay(); updateMapEditorStatus(); return true;
  }
  function cancelHeroDrag() { heroDrag = null; }


  function onWorkspaceModeChanged(editing) {
    if (editing) {
      document.body.classList.remove('rdx-map-editor-advanced');
      if (mapEditorAdvanced) { mapEditorAdvanced.setAttribute('aria-pressed','false'); mapEditorAdvanced.textContent='Show advanced tools'; }
      if (playtestPanel) playtestPanel.hidden = true;
    }
    syncMapEditorFields();
    if (editing) autoPlaceMapEditorHero();
    applyMapEditorCellOverrides();
    updateMapEditorOverlay();
    if (!editing && mapEditorPlaytestActive) stopMapEditorPlaytest();
  }

  function install() {
    for (const input of [mapEditorWindowX,mapEditorWindowY]) {
      input?.addEventListener('input', () => saveMapEditorWindowFields({ autoPlaceHero:true }));
      input?.addEventListener('change', () => saveMapEditorWindowFields({ autoPlaceHero:true }));
    }
    for (const input of [mapEditorHeroX,mapEditorHeroY]) {
      input?.addEventListener('input', saveMapEditorHeroFields);
      input?.addEventListener('change', saveMapEditorHeroFields);
    }
    mapEditorAdvanced?.addEventListener('click', () => {
      const advanced=!document.body.classList.contains('rdx-map-editor-advanced');
      document.body.classList.toggle('rdx-map-editor-advanced', advanced);
      mapEditorAdvanced.setAttribute('aria-pressed', advanced?'true':'false');
      mapEditorAdvanced.textContent=advanced?'Hide advanced tools':'Show advanced tools';
    });
    mapEditorUseSelection?.addEventListener('click', () => { try { centerMapEditorWindowOnSelection(); } catch (error) { actions.setStatus(error.message,'error'); } });
    mapEditorPlaytest?.addEventListener('click', () => { if (!startMapEditorPlaytest()) actions.setStatus('Load the RDX ROM before playtesting a Map Editor window.', 'warn'); });
    mapEditorStopPlaytest?.addEventListener('click', stopMapEditorPlaytest);
    mapEditorInvulnerable?.addEventListener('change', () => { if (mapEditorPlaytestActive) runtime.bridge()?.setDebugInvincible?.(mapEditorInvulnerable.checked); });
    mapEditorPlaytestCanvas?.addEventListener('pointerdown', () => captureMapEditorPlaytestInput());
    mapEditorPlaytestCanvas?.addEventListener('focus', () => { if (mapEditorPlaytestActive) mapEditorPlaytestCaptured = true; });
    mapEditorPlaytestCanvas?.addEventListener('blur', () => { if (mapEditorPlaytestActive) releaseMapEditorPlaytestInput(); });
    window.addEventListener('keydown', event => {
      if (!mapEditorPlaytestActive || !mapEditorPlaytestCaptured || document.activeElement !== mapEditorPlaytestCanvas) return;
      if (setMapEditorPlaytestKey(event.code, true)) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    window.addEventListener('keyup', event => {
      if (!mapEditorPlaytestActive || !mapEditorPlaytestCaptured) return;
      if (setMapEditorPlaytestKey(event.code, false)) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    window.addEventListener('blur', () => { if (mapEditorPlaytestActive) releaseMapEditorPlaytestInput(); });
    mapEditorCopyCell?.addEventListener('click', () => {
      const target=mapEditorPieceSelection?.target;
      if (!target) { actions.setStatus('Click any RDX map piece first.', 'warn'); return; }
      selectMapEditorPiece(target[0],target[1]);
      if(mapEditorPieceSelection?.source){ if(mapEditorSourceX)mapEditorSourceX.value=String(mapEditorPieceSelection.source[0]); if(mapEditorSourceY)mapEditorSourceY.value=String(mapEditorPieceSelection.source[1]); }
    });
    mapEditorApplyCell?.addEventListener('click', () => { try { applyMapEditorDraftEdit(); } catch (error) { actions.setStatus(error.message,'error'); } });
    mapEditorRevertCell?.addEventListener('click', () => { revertMapEditorTarget(); actions.setStatus('Reverted the selected visual/collision target to production data.','neutral'); });
    mapEditorUndo?.addEventListener('click',()=>{ const prior=mapEditorHistory.pop(); if(!prior)return; const current=mapEditorSnapshotRoom(); if(current)mapEditorRedoHistory.push(current); mapEditorRestoreRoomSnapshot(prior); updateMapEditorHistoryButtons(); });
    mapEditorRedo?.addEventListener('click',()=>{ const next=mapEditorRedoHistory.pop(); if(!next)return; const current=mapEditorSnapshotRoom(); if(current)mapEditorHistory.push(current); mapEditorRestoreRoomSnapshot(next); updateMapEditorHistoryButtons(); });
    mapEditorClearCells?.addEventListener('click', () => {
      const draft = mapEditorRoomDraft(false); if (!draft) return;
      mapEditorPushHistory(); draft.cellReplacements = []; draft.geometryOverrides=[]; persistMapEditorDraft(); applyMapEditorCellOverrides();
      actions.setStatus('Cleared Map Editor visual and collision edits for this room.', 'neutral'); updateMapEditorHistoryButtons(); updateMapEditorPieceReadout();
    });
    for(const input of [mapEditorTargetX,mapEditorTargetY]) input?.addEventListener('change',()=>selectMapEditorPiece(mapEditorTargetX.value,mapEditorTargetY.value));
    for(const input of [mapEditorSourceX,mapEditorSourceY]) input?.addEventListener('change',()=>selectMapEditorPiece(mapEditorSourceX.value,mapEditorSourceY.value,{source:true}));
    mapEditorCopyDraft?.addEventListener('click', async () => {
      try { await actions.copyText(JSON.stringify(mapEditorDraft,null,2)); actions.setStatus('Copied Map Editor draft JSON.', 'ok'); }
      catch (error) { actions.setStatus(error.message,'error'); }
    });
  }

  return {
    install, loadDraft:loadMapEditorDraft, persistDraft:persistMapEditorDraft,
    roomDraft:mapEditorRoomDraft, roomSummary:mapEditorRoomSummary,
    updateStatus:updateMapEditorStatus, syncFields:syncMapEditorFields,
    updateOverlay:updateMapEditorOverlay, applyCellOverrides:applyMapEditorCellOverrides,
    autoPlaceHero:autoPlaceMapEditorHero, saveViewportFields:saveMapEditorViewportFields,
    setHero:setMapEditorHero, selectPiece:selectMapEditorPiece,
    startPlaytest:startMapEditorPlaytest, stopPlaytest:stopMapEditorPlaytest,
    renderPlaytest:renderMapEditorPlaytest, applyPendingStart:applyPendingMapEditorStart,
    playtestActive:()=>mapEditorPlaytestActive, playtestCaptured:()=>mapEditorPlaytestCaptured,
    setEntityOverride, clearEntityOverride, beginHeroDrag, moveHeroDrag, endHeroDrag, cancelHeroDrag,
    targetMode:()=>mapEditorTargetMode?.value || 'pieces', onWorkspaceModeChanged, draftSnapshot:()=>structuredClone(mapEditorDraft)
  };
}
