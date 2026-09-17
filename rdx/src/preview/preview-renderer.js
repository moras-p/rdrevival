import { PixelBuffer } from '../render/pixel-buffer.js';
import { effectiveMapDimensions } from '../core/map-topology.js';
import { PreviewActorSystem } from './preview-actors.js';
import { PreviewTrapSystem } from './preview-traps.js';
import { RdxSemanticSpriteMapper } from '../runtime/sprite-mapping.js';
import * as productionState from './preview-production-state.js';
import * as placementDiagnostics from './preview-diagnostics-placement.js';
import * as enemyDiagnostics from './preview-diagnostics-enemies.js';
import * as collisionDiagnostics from './preview-diagnostics-collision.js';
import * as staticRenderer from './preview-static-renderer.js';
import * as dynamicRenderer from './preview-dynamic-renderer.js';
import { normalizePresentationDepthClassEdits } from '../editor/presentation-depth-class-authoring.js';

export { cloneBuffer, composePreviewLayers, unionBounds, clipBounds } from './preview-render-primitives.js';
export { activationEffectStatus } from './preview-diagnostics-enemies.js';
export { productionProjectileCadenceSample, productionDrawPoint, classicEnemySpriteAt, classicScriptedActiveSpriteAt } from './preview-production-state.js';
export { reviewedRdxTraps, reviewedAbsentClassicHazards, descriptorSourceDetachmentRects, descriptorStaticSceneryVisuals, classicTerrainHazardRects,
  staticTrapSceneryVisual, statefulTrapSceneryVisual, statefulEmbeddedMapArtSuppressions, statefulEmbeddedMapArtSignature } from './preview-static-renderer.js';
export { egyptProjectileAnimationTick } from './preview-dynamic-renderer.js';

/* Resolved-level projections keep collision edits in authored g8Bounds rectangles,
 * while the compatibility preview index stores one row per 8x8 cell. Normalize
 * both inputs here so editor diagnostics and production preview consume one shape. */
function expandedRuntimeCollisionPatches(data) {
  const rows=Array.isArray(data?.patches) ? data.patches : [];
  const out=[];
  for(const row of rows){
    if(Array.isArray(row?.g8) && row.g8.length>=2){ out.push(row); continue; }
    const bounds=Array.isArray(row?.g8Bounds) ? row.g8Bounds.slice(0,4).map(Number) : null;
    if(!bounds || bounds.length<4 || !bounds.every(Number.isFinite) || bounds[2]<=0 || bounds[3]<=0) continue;
    for(let y=bounds[1];y<bounds[1]+bounds[3];y++) for(let x=bounds[0];x<bounds[0]+bounds[2];x++)
      out.push(Object.freeze({...row,g8:Object.freeze([x,y])}));
  }
  return out;
}

/* Stable public renderer façade. Focused modules own projection, rendering and diagnostics;
 * this class owns long-lived state and preserves the existing consumer API. */

export class PreviewRenderer {
  constructor(options) {
    this.mapDecoder = options.mapDecoder;
    this.spriteDecoder = options.spriteDecoder;
    this.paletteRegistry = options.paletteRegistry;
    this.mapping = options.mapping;
    this.semanticMapper = typeof options.mapping?.rowsForXrickAsset === 'function'
      ? new RdxSemanticSpriteMapper(options.mapping) : null;
    this.classicData = options.classicData;
    this.actionVisualBindings = Array.isArray(options.actionVisualBindings?.bindings) ? options.actionVisualBindings.bindings : [];
    this.classicScriptedPaths = options.classicScriptedPaths || { entities: {} };
    this.activatorSounds = options.activatorSounds || { entities: {} };
    this.noOverlapPresence = options.noOverlapPresence || { rooms: [] };
    this.placementAudit = options.placementAudit || { rooms: [] };
    this.productionOverrides = options.productionOverrides || { tables: { markActorOverrides: [] } };
    this.trapRegistry = options.trapRegistry || { classic: { excludedTiles: [] }, rooms: [] };
    this.authoredVisualAssets = options.authoredVisualAssets || null;
    this.reviewedMapVisualPatches = Array.isArray(options.reviewedMapVisualPatches?.patches) ? options.reviewedMapVisualPatches.patches : [];
    this.runtimeCollisionPatches = expandedRuntimeCollisionPatches(options.runtimeCollisionPatches);
    this.runtimeCollisionPatchByCell = new Map(this.runtimeCollisionPatches.map(row => [`${Number(row.submap)}:${Number(row.mapId)}:${Number(row.g8?.[0])}:${Number(row.g8?.[1])}`, row]));
    this.productionScene = options.productionScene || null;
    this.systemModificationsEnabled = true;
    this.strictTrace = options.productionScene?.schema === 'rdx.production_presentation_trace.v1';
    this.resolvedProjection = options.productionScene?.schema === 'rdr.resolved_editor_projection.v1';
    this.actorSystem = new PreviewActorSystem(
      this.spriteDecoder, options.spriteAnims, this.mapDecoder, options.productionScene || null, this.classicScriptedPaths, options.visualPlacementCorrections || null,
      this.productionOverrides, options.reviewedMapVisualPatches || null, options.productionMappings || null
    );
    this.nativeRuntimeStates = new Map();
    this.trapSystem = new PreviewTrapSystem(options.trapInventory);
    this.staticCache = new Map();
    this.classicSpriteCache = new Map();
    this.selection = null;
    this.dynamicBehindMidground = null;
    this.dynamic = null;
    this.dynamicFront = null;
    this.previousBehindMidgroundDirty = null;
    this.previousDirty = null;
    this.previousFrontDirty = null;
    this.activateAllTraps = ['rdx.production_preview_scene.v3', 'rdx.production_presentation_trace.v1'].includes(options.productionScene?.schema) ||
      (this.resolvedProjection && options.productionScene?.runtimeEvidence?.compatible === true);
    this.manualOverrides = new Map();
    this.patchOverrides = new Map();
    /* Map Editor draft replacements are deliberately a third authority:
     * canonical reviewed patches remain immutable, Patch Workbench can be
     * disabled independently, and editor cell replacements are explicit
     * room-local drafts layered last over the decoded static map. */
    this.mapCellOverrides = [];
    this.mapGeometryOverrides = [];
    this.presentationDepthOverrides = [];
    this.presentationDepthClassEdits = [];
    this.bulletSource = ['classic', 'revival'].includes(options.bulletSource) ? options.bulletSource : 'revival';
    this.dynamiteSource = ['classic', 'revival'].includes(options.dynamiteSource) ? options.dynamiteSource : 'revival';
    this.ammoBoxSource = ['rdx', 'revival'].includes(options.ammoBoxSource) ? options.ammoBoxSource : 'revival';
  }

  setBulletSource(source) { this.bulletSource = ['classic', 'revival'].includes(source) ? source : 'revival'; return this.bulletSource; }
  setDynamiteSource(source) { this.dynamiteSource = ['classic', 'revival'].includes(source) ? source : 'revival'; return this.dynamiteSource; }
  setAmmoBoxSource(source) { this.ammoBoxSource = ['rdx', 'revival'].includes(source) ? source : 'revival'; return this.ammoBoxSource; }
  _frameForPn(pn, tick, palette, options = {}) { return productionState._frameForPn.call(this, pn, tick, palette, options); }

  _productionEnemyAnchor(state, frame, palette) { return productionState._productionEnemyAnchor.call(this, state, frame, palette); }

  setActivateAllTraps(active) { this.activateAllTraps = !!active; }
  _actorStatesAt(tick) { return productionState._actorStatesAt.call(this, tick); }
  setNativeRuntimeStates(states) {
    this.nativeRuntimeStates = states instanceof Map ? states : new Map();
    this.actorSystem.setNativeRuntimeStates?.(this.nativeRuntimeStates);
    return this.nativeRuntimeStates;
  }
  staticLifecycleSignature(states = this.nativeRuntimeStates) {
    if (!this.selection || this.selection.visualSource === 'classic') return '';
    return staticRenderer.statefulEmbeddedMapArtSignature(this.trapRegistry, this.selection.submap, this.selection.mapId, states);
  }
  setSystemModificationsEnabled(enabled) {
    const next = enabled !== false;
    if (next === this.systemModificationsEnabled) return next;
    this.systemModificationsEnabled = next;
    this.actorSystem.setSystemModificationsEnabled?.(next);
    this.staticCache.clear();
    return next;
  }
  setMapCellOverrides(entries = []) {
    this.mapCellOverrides = (Array.isArray(entries) ? entries : []).map(entry => Object.freeze({
      ...entry,
      submap: Number(entry?.submap ?? -1),
      mapId: Number(entry?.mapId ?? -1),
      target: Array.isArray(entry?.target) ? entry.target.slice(0, 2).map(Number) : null,
      source: Array.isArray(entry?.source) ? entry.source.slice(0, 2).map(Number) : null,
      sourceMapId: Number(entry?.sourceMapId ?? entry?.mapId ?? -1),
      layer: ['A', 'B', 'AB'].includes(String(entry?.layer || '').toUpperCase()) ? String(entry.layer).toUpperCase() : 'A',
      sourceLayer: ['A','B'].includes(String(entry?.sourceLayer || '').toUpperCase()) ? String(entry.sourceLayer).toUpperCase() : null,
      operation: String(entry?.operation || 'copy') === 'clear' ? 'clear' : 'copy'
    })).filter(entry => entry.target?.length === 2 && entry.target.every(Number.isFinite) &&
      (entry.operation === 'clear' || (entry.source?.length === 2 && entry.source.every(Number.isFinite))));
    this.staticCache.clear();
    return this.mapCellOverrides.length;
  }
  setPresentationDepthOverrides(entries = []) {
    this.presentationDepthOverrides = (Array.isArray(entries) ? entries : []).map(entry => Object.freeze({
      ...entry,
      id:String(entry?.id || ''),
      submap:Number(entry?.submap ?? -1),
      mapId:Number(entry?.mapId ?? -1),
      plane:['A','B'].includes(String(entry?.plane || '').toUpperCase()) ? String(entry.plane).toUpperCase() : 'A',
      band:['backdrop','midground','foreground'].includes(String(entry?.band || '')) ? String(entry.band) : (String(entry?.plane || '').toUpperCase() === 'B' ? 'midground' : 'foreground'),
      bounds:Array.isArray(entry?.bounds) ? entry.bounds.slice(0,4).map(Number) : null,
      source:String(entry?.source || 'editor-draft')
    })).filter(entry => entry.id && entry.bounds?.length === 4 && entry.bounds.every(Number.isFinite) && entry.bounds[2] > 0 && entry.bounds[3] > 0);
    this.staticCache.clear();
    return this.presentationDepthOverrides.length;
  }
  setPresentationDepthClassEdits(entries = []) {
    this.presentationDepthClassEdits = [...normalizePresentationDepthClassEdits(entries)];
    this.staticCache.clear();
    return this.presentationDepthClassEdits.length;
  }
  setGeometryOverrides(entries = []) {
    this.mapGeometryOverrides = (Array.isArray(entries) ? entries : []).map(entry => Object.freeze({
      ...entry, submap:Number(entry?.submap ?? -1), mapId:Number(entry?.mapId ?? -1),
      logic:Array.isArray(entry?.logic) ? entry.logic.slice(0,2).map(Number) : null,
      g8:Array.isArray(entry?.g8) ? entry.g8.slice(0,2).map(Number) : null,
      collision:['original','pass-through','solid','one-way','climb-through','lethal','exit'].includes(String(entry?.collision || '')) ? String(entry.collision) : 'original',
      action:['open','one-way','climb-through','lethal'].includes(String(entry?.action || '')) ? String(entry.action) : null
    })).filter(entry => (entry.logic?.length === 2 && entry.logic.every(Number.isInteger)) ||
      (entry.g8?.length === 2 && entry.g8.every(Number.isInteger) && entry.action));
    return this.mapGeometryOverrides.length;
  }
  setManualOverride(overrideKey, override = null) {
    const key = String(overrideKey || '');
    if (!key) throw new Error('A stable asset override key is required');
    if (!override) this.manualOverrides.delete(key);
    else this.manualOverrides.set(key, Object.freeze({ ...override, overrideKey: key }));
    return this.manualOverrides.get(key) || null;
  }
  clearManualOverrides() { this.manualOverrides.clear(); }
  setPatchOverride(overrideKey, override = null) {
    const key = String(overrideKey || '');
    if (!key) throw new Error('A stable patch override key is required');
    if (!override) this.patchOverrides.delete(key);
    else this.patchOverrides.set(key, Object.freeze({ ...override, overrideKey: key, authority: override.authority || 'patch-workbench' }));
    return this.patchOverrides.get(key) || null;
  }
  clearPatchOverrides() { this.patchOverrides.clear(); }
  replacePatchOverrides(entries = []) {
    this.patchOverrides.clear();
    for (const entry of entries) {
      const key = String(entry?.overrideKey || entry?.assetKey || (entry?.sourceKey ? `source:${entry.sourceKey}` : ''));
      if (key) this.patchOverrides.set(key, Object.freeze({ ...entry, overrideKey: key, authority: entry.authority || 'patch-workbench' }));
    }
    return this.patchOverrides.size;
  }
  replaceManualOverrides(entries = []) {
    this.manualOverrides.clear();
    for (const entry of entries) {
      const key = String(entry?.overrideKey || entry?.assetKey || (entry?.sourceKey ? `source:${entry.sourceKey}` : ''));
      if (key) this.manualOverrides.set(key, Object.freeze({ ...entry, overrideKey: key }));
    }
    return this.manualOverrides.size;
  }
  manualOverride(overrideKey) { return this.manualOverrides.get(String(overrideKey || '')) || null; }
  _overrideFor(port, sourceKey) { return productionState._overrideFor.call(this, port, sourceKey); }
  _overrideForInstance(port, sourceKey, instanceKey = null) { return productionState._overrideForInstance.call(this, port, sourceKey, instanceKey); }

  _classicEntityForSourceKey(sourceKey) { return productionState._classicEntityForSourceKey.call(this, sourceKey); }

  _lethalityForSelectable(item) { return productionState._lethalityForSelectable.call(this, item); }

  _hazardPotentialForSelectable(item, lethality = this._lethalityForSelectable(item)) { return productionState._hazardPotentialForSelectable.call(this, item, lethality); }

  _hazardBoundsForSelectable(item, lethality = this._lethalityForSelectable(item)) { return productionState._hazardBoundsForSelectable.call(this, item, lethality); }

  _decorateDynamic(selectables, diagnostics) { return productionState._decorateDynamic.call(this, selectables, diagnostics); }

  select({ submap, mapId, visualSource = 'rdx', spriteSource = 'rdx', missingPolicy = 'red' }) {
    const level = this.mapping.levelForSubmap(submap);
    const effectiveMap = Number(mapId ?? level?.rdxMd);
    const topology = visualSource === 'rdx' && this.resolvedProjection ? (level?.rdxTopology || null) : null;
    const rawDimensions = this.mapDecoder.dimensions(effectiveMap);
    const dimensions = visualSource === 'classic' ? this._classicDimensions(submap) : effectiveMapDimensions(rawDimensions, topology);
    this.selection = Object.freeze({ submap: Number(submap), mapId: effectiveMap, visualSource, spriteSource, missingPolicy, dimensions, level, topology });
    this.actorSystem.load(effectiveMap, dimensions, Number(submap), topology);
    this.dynamicBehindMidground = new PixelBuffer(dimensions.width, dimensions.height, [0, 0, 0, 0]);
    this.dynamic = new PixelBuffer(dimensions.width, dimensions.height, [0, 0, 0, 0]);
    this.dynamicFront = new PixelBuffer(dimensions.width, dimensions.height, [0, 0, 0, 0]);
    this.previousBehindMidgroundDirty = { x: 0, y: 0, width: dimensions.width, height: dimensions.height };
    this.previousDirty = { x: 0, y: 0, width: dimensions.width, height: dimensions.height };
    this.previousFrontDirty = { x: 0, y: 0, width: dimensions.width, height: dimensions.height };
    return this.selection;
  }

  _classicRoom(submap) { return productionState._classicRoom.call(this, submap); }
  _classicPreviewRoom(submap) { return productionState._classicPreviewRoom.call(this, submap); }
  _classicPreviewYOffset(submap = this.selection?.submap) { return productionState._classicPreviewYOffset.call(this, submap); }
  _classicPreviewBounds(bounds) { return productionState._classicPreviewBounds.call(this, bounds); }
  _classicDimensions(submap) { return productionState._classicDimensions.call(this, submap); }
  _classicPlane(submap) { return productionState._classicPlane.call(this, submap); }

  _classicSprite(spriteId) { return productionState._classicSprite.call(this, spriteId); }

  _classicCoordinates(localX, localY, toRdx, previewLocal = false) { return productionState._classicCoordinates.call(this, localX, localY, toRdx, previewLocal); }

  _classicGeneratedEntityState(entity, tick, toRdx = false, previewLocal = false) { return productionState._classicGeneratedEntityState.call(this, entity, tick, toRdx, previewLocal); }

  _classicStates(tick, toRdx = false, includeInvisible = false) { return productionState._classicStates.call(this, tick, toRdx, includeInvisible); }

  _classicProjectileStates(tick) { return productionState._classicProjectileStates.call(this, tick); }

  _drawClassicState(state, redFrame = false) { return productionState._drawClassicState.call(this, state, redFrame); }

  _classicDynamiteState(tick, sourceKey = '') { return productionState._classicDynamiteState.call(this, tick, sourceKey); }

  _drawClassicFallback(state) { return productionState._drawClassicFallback.call(this, state); }

  _productionRoom() { return productionState._productionRoom.call(this); }

  _productionFallbacks(tick) { return productionState._productionFallbacks.call(this, tick); }

  _classicFallbacks(tick, rdxStates) { return productionState._classicFallbacks.call(this, tick, rdxStates); }

  timelineForAsset(item) { return productionState.timelineForAsset.call(this, item); }

  systemModificationDiagnostics() { return placementDiagnostics.systemModificationDiagnostics.call(this); }

  placementDiagnostics() { return placementDiagnostics.placementDiagnostics.call(this); }

  noOverlapDiagnostics(tick = 0, selectables = []) { return placementDiagnostics.noOverlapDiagnostics.call(this, tick, selectables); }

  enemyBehaviorDiagnostics(tick, selectables = []) { return enemyDiagnostics.enemyBehaviorDiagnostics.call(this, tick, selectables); }

  _reviewedMapVisualPatchDiagnostics() { return enemyDiagnostics._reviewedMapVisualPatchDiagnostics.call(this); }

  _terrainHazardDiagnostics(tick = 0, selectables = []) { return enemyDiagnostics._terrainHazardDiagnostics.call(this, tick, selectables); }

  _roomActionBindings() { return enemyDiagnostics._roomActionBindings.call(this); }

  staticPhaseAtTick(tick) { return collisionDiagnostics.staticPhaseAtTick.call(this, tick); }

  _geometryCellId(visualSource, gridX, gridY) { return collisionDiagnostics._geometryCellId.call(this, visualSource, gridX, gridY); }

  _classicComparisonForRdxGrid(gridX, gridY) { return collisionDiagnostics._classicComparisonForRdxGrid.call(this, gridX, gridY); }

  _classicActivatorMatchesForRdxDescriptor(descriptor) { return collisionDiagnostics._classicActivatorMatchesForRdxDescriptor.call(this, descriptor); }

  _classicMaskForRdxDescriptor(descriptor) { return collisionDiagnostics._classicMaskForRdxDescriptor.call(this, descriptor); }

  _rdxDescriptorAtGrid(gridX, gridY) { return collisionDiagnostics._rdxDescriptorAtGrid.call(this, gridX, gridY); }

  _squareHoleClearanceAtGrid(gridX, gridY, descriptor, classicFlags, classicInBounds) { return collisionDiagnostics._squareHoleClearanceAtGrid.call(this, gridX, gridY, descriptor, classicFlags, classicInBounds); }

  geometryCellAt(x, y, options = {}) { return collisionDiagnostics.geometryCellAt.call(this, x, y, options); }

  collisionLayer(selectedGeometryIds = []) { return collisionDiagnostics.collisionLayer.call(this, selectedGeometryIds); }

  unresolvedCollisionCells() { return collisionDiagnostics.unresolvedCollisionCells.call(this); }

  unresolvedCollisionLayer() { return collisionDiagnostics.unresolvedCollisionLayer.call(this); }

  staticLayers(phase = 0) { return staticRenderer.staticLayers.call(this, phase); }

  _previewCoordinates(state) { return dynamicRenderer._previewCoordinates.call(this, state); }

  _placeholder(x, y, actorId, policy, diagnostic = false, target = this.dynamic) { return dynamicRenderer._placeholder.call(this, x, y, actorId, policy, diagnostic, target); }

  dynamicFrame(tick) { return dynamicRenderer.dynamicFrame.call(this, tick); }
}
