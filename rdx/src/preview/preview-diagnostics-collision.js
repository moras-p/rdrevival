import { PixelBuffer } from '../render/pixel-buffer.js';
import { MAP_EFLG, GAMEPLAY_MASK, classicCorrespondenceStatus, projectRdxDescriptor, projectCollisionPreset, projectRuntimeCollisionPatch, collisionSemantic, collisionSemanticName } from '../collision/descriptor-semantics.js';
import { drawRect } from './preview-render-primitives.js';
import { topologySourceY } from '../core/map-topology.js';

export function activatorOwnsCollisionCell(productionScene, selection, cell) {
  if (!productionScene || !selection || !cell?.bounds) return false;
  const room = (productionScene.rooms || []).find(row =>
    Number(row.submap) === Number(selection.submap) && Number(row.mapId) === Number(selection.mapId));
  if (!room) return false;
  const centerX = Number(cell.bounds.x || 0) + Number(cell.bounds.width || 8) / 2;
  const centerY = Number(cell.bounds.y || 0) + Number(cell.bounds.height || 8) / 2;
  return (room.activators || []).some(row => {
    const bounds = Array.isArray(row?.bounds) ? row.bounds.map(Number) : null;
    return bounds?.length === 4 && centerX >= bounds[0] && centerX <= bounds[2] &&
      centerY >= bounds[1] && centerY <= bounds[3];
  });
}

export function staticPhaseAtTick(tick) {
  if (!this.selection || this.selection.visualSource === 'classic') return 0;
  const count = Math.max(1, this.mapDecoder.phaseCount(this.selection.mapId));
  return Math.floor(Number(tick) / 5) % count;
}

export function _geometryCellId(visualSource, gridX, gridY) {
  return `MD${String(Number(this.selection?.mapId || 0)).padStart(4, '0')}#geometry#${visualSource}:g8:${Number(gridX)}:${Number(gridY)}`;
}

export function _classicComparisonForRdxGrid(gridX, gridY) {
  const room = this._classicRoom(this.selection.submap);
  const offset = this.selection.level?.pixelOffset || { dxPx:0, dyPx:0 };
  const rdxCenter = Object.freeze({ x:Number(gridX) * 8 + 4, y:Number(gridY) * 8 + 4 });
  const classicPxX = rdxCenter.x - Number(offset.dxPx || 0);
  const classicPxY = rdxCenter.y - Number(offset.dyPx || 0);
  const classicX = Math.floor(classicPxX / 8), classicY = Math.floor(classicPxY / 8);
  const inBounds = classicX >= 0 && classicY >= 0 && classicX < room.widthTiles && classicY < room.heightTiles;
  const flags = inBounds ? Number(room.flags[classicY * room.widthTiles + classicX] || 0) & 0xff : 0;
  return Object.freeze({
    inBounds, pixelOffset:Object.freeze({ dxPx:Number(offset.dxPx || 0), dyPx:Number(offset.dyPx || 0) }),
    rdxCenter, mappedPixel:Object.freeze({ x:classicPxX, y:classicPxY }),
    grid:Object.freeze({ x:classicX, y:classicY, size:8 }), flags,
    kind:collisionSemantic(flags), kindName:collisionSemanticName(flags)
  });
}

export function _classicActivatorMatchesForRdxDescriptor(descriptor) {
  const room = this._classicRoom(this.selection.submap);
  const offset = this.selection.level?.pixelOffset || { dxPx:0, dyPx:0 };
  const left = Number(descriptor.logicCellX) * 16 - Number(offset.dxPx || 0);
  const top = Number(descriptor.logicCellY) * 16 - Number(offset.dyPx || 0);
  const right = left + 15, bottom = top + 15;
  const matches = [];
  for (const entity of room?.entities || []) {
    const flags = Number(entity.flags || 0) & 0xff;
    const entityNo = Number(entity.entity ?? entity.n ?? 0) & 0x7f;
    if (!(flags & 0xf0) && entityNo !== 0x16 && entityNo !== 0x17) continue;
    const bounds = entity.triggerBounds;
    if (!Array.isArray(bounds) || bounds.length < 4) continue;
    const [x, y, width, height] = bounds.map(Number);
    if (width <= 0 || height <= 0) continue;
    if (left < x || right > x + width - 1 || top < y || bottom > y + height - 1) continue;
    matches.push(Object.freeze({
      mark:Number(entity.mark), flags, entity:entityNo,
      triggerBounds:Object.freeze([x, y, width, height])
    }));
  }
  return Object.freeze(matches);
}

export function _classicMaskForRdxDescriptor(descriptor) {
  const baseGridX = Number(descriptor.logicCellX) * 2;
  const baseGridY = Number(descriptor.logicCellY) * 2;
  const comparisons = [];
  const mask = [];
  const activatorMatches = this._classicActivatorMatchesForRdxDescriptor(descriptor);
  for (let qy = 0; qy < 2; ++qy) {
    for (let qx = 0; qx < 2; ++qx) {
      const comparison = this._classicComparisonForRdxGrid(baseGridX + qx, baseGridY + qy);
      comparisons.push(comparison);
      if (!comparison.inBounds) return Object.freeze({
        status:'out-of-bounds', mask:null, comparisons:Object.freeze(comparisons), activatorMatches
      });
      mask.push(Number(comparison.flags || 0) & GAMEPLAY_MASK);
    }
  }
  const matchedActivator = activatorMatches.length > 0;
  return Object.freeze({
    status:classicCorrespondenceStatus(descriptor.ml, mask, { matchedActivator,
      requireFullLadderWidth:Number(this.selection?.submap) === 9 && Number(this.selection?.mapId) === 13 }),
    mask:Object.freeze(mask), comparisons:Object.freeze(comparisons), activatorMatches
  });
}

export function _rdxDescriptorAtGrid(gridX, gridY) {
  const logicCellX = Math.floor((Number(gridX) * 8 + 4) / 16);
  const logicCellY = Math.floor((Number(gridY) * 8 + 4) / 16);
  const qx = Number(gridX) & 1, qy = Number(gridY) & 1;
  const editorGeometry = this.mapGeometryOverrides.find(entry => Number(entry.mapId) === Number(this.selection?.mapId) &&
    Number(entry.submap) === Number(this.selection?.submap) && entry.logic?.[0] === logicCellX + 1 && entry.logic?.[1] === logicCellY + 1);
  const sourcePixelY = topologySourceY(this.selection?.topology || null, logicCellY * 16);
  const sourceLogicCellY = sourcePixelY == null ? -1 : Math.floor(sourcePixelY / 16);
  let mt = null, ml = null, logicX = logicCellX + 1, logicY = sourceLogicCellY + 1, logicIndex = null, logicWidth = 0, logicHeight = 0;
  try {
    const logic = this.mapDecoder.logicDimensions(this.selection.mapId);
    logicWidth = Number(logic.width || 0); logicHeight = Number(logic.height || 0);
    if (logicX >= 0 && logicY >= 0 && logicX < logicWidth && logicY < logicHeight) {
      logicIndex = logicY * logicWidth + logicX;
      mt = Number(this.mapDecoder.rom.payload('MT', this.selection.mapId)[logicIndex]);
      const mlAsset = this.mapDecoder.rom.getAsset?.('ML', this.selection.mapId);
      ml = mlAsset ? Number(this.mapDecoder.rom.payload('ML', this.selection.mapId)[logicIndex]) : 0;
      if (this.selection?.topology?.collisionPolicy === 'copy-source-descriptors-except-exits' && (mt & 0x80) && ml === 0x14) { mt = 0; ml = 0; }
    }
  } catch {}
  return Object.freeze({
    logicCellX, logicCellY, sourceLogicCellY, qx, qy, mt, ml, logicX, logicY, logicIndex, logicWidth, logicHeight,
    editorGeometry:editorGeometry || null
  });
}

export function _squareHoleClearanceAtGrid(gridX, gridY, descriptor, classicFlags, classicInBounds) {
  const ordinaryMode = (value, mode) => value?.mt != null && !(Number(value.mt) & 0x80) &&
    (Number(value.mt) & 0x03) === mode;
  if (!classicInBounds || Number(descriptor?.qx) !== 1 || Number(descriptor?.qy) !== 1 ||
      (Number(classicFlags) & GAMEPLAY_MASK)) return false;
  if (!ordinaryMode(descriptor, 1)) return false;
  const hole = this._rdxDescriptorAtGrid(gridX + 1, gridY);
  const above = this._rdxDescriptorAtGrid(gridX + 1, gridY - 2);
  const right = this._rdxDescriptorAtGrid(gridX + 3, gridY);
  const below = this._rdxDescriptorAtGrid(gridX + 1, gridY + 2);
  return ordinaryMode(hole, 0) && ordinaryMode(above, 1) && ordinaryMode(right, 1) && ordinaryMode(below, 0);
}

export function geometryCellAt(x, y, options = {}) {
  if (!this.selection) return null;
  const includeOpen = !!options.includeOpen;
  const includeProvenance = options.includeProvenance !== false;
  const phase = Math.max(0, Number(options.phase ?? 0) | 0);
  const px = Math.floor(Number(x));
  const py = Math.floor(Number(y));
  const { width, height } = this.selection.dimensions;
  if (!Number.isFinite(px) || !Number.isFinite(py) || px < 0 || py < 0 || px >= width || py >= height) return null;
  const gridX = Math.floor(px / 8), gridY = Math.floor(py / 8);
  const bounds = Object.freeze({ x:gridX * 8, y:gridY * 8, width:8, height:8 });
  const grid = Object.freeze({ size:8, x:gridX, y:gridY });
  const source = this.selection.visualSource === 'classic' ? 'classic' : 'rdx';
  const id = this._geometryCellId(source, gridX, gridY);

  if (source === 'classic') {
    const room = this._classicPreviewRoom(this.selection.submap);
    if (gridX < 0 || gridY < 0 || gridX >= room.widthTiles || gridY >= room.heightTiles) return null;
    const index = gridY * room.widthTiles + gridX;
    const flags = Number(room.flags[index] || 0) & 0xff;
    if (!(flags & GAMEPLAY_MASK) && !includeOpen) return null;
    const provenance = includeProvenance ? Object.freeze({
      authority:'Classic xrick map flags',
      coordinate:Object.freeze({ grid8:grid, pixelCenter:Object.freeze({ x:gridX * 8 + 4, y:gridY * 8 + 4 }) }),
      classic:Object.freeze({ index, flags, kind:collisionSemantic(flags), kindName:collisionSemanticName(flags) })
    }) : null;
    return Object.freeze({
      id, visualSource:source, submap:Number(this.selection.submap), mapId:Number(this.selection.mapId),
      grid, bounds, kind:collisionSemantic(flags), kindName:collisionSemanticName(flags), kindCode:flags & GAMEPLAY_MASK, flags,
      description:`Classic xrick collision: ${collisionSemanticName(flags)}. MAP_EFLG=0x${flags.toString(16).padStart(2,'0')}.`,
      raw:Object.freeze({ mapEflg:flags }), ...(provenance ? { provenance } : {})
    });
  }

  const descriptor = this._rdxDescriptorAtGrid(gridX, gridY);
  if (descriptor.mt == null || descriptor.ml == null) return null;
  const classicComparison = this._classicComparisonForRdxGrid(gridX, gridY);
  const classicFlags = classicComparison.flags;
  const correspondence = this._classicMaskForRdxDescriptor(descriptor);
  const runtimePatch = this.runtimeCollisionPatchByCell.get(`${Number(this.selection.submap)}:${Number(this.selection.mapId)}:${gridX}:${gridY}`) || null;
  const exactEditorOverride = this.mapGeometryOverrides.find(entry => Number(entry.mapId) === Number(this.selection?.mapId) &&
    Number(entry.submap) === Number(this.selection?.submap) && entry.g8?.[0] === gridX && entry.g8?.[1] === gridY && entry.action) || null;
  const descriptorOverride = descriptor.editorGeometry?.collision && descriptor.editorGeometry.collision !== 'original'
    ? projectCollisionPreset(descriptor.editorGeometry.collision, descriptor.qy, classicFlags)
    : null;
  const override = exactEditorOverride ? projectRuntimeCollisionPatch(exactEditorOverride.action, classicFlags) : descriptorOverride;
  const appliedRuntimePatch = this.systemModificationsEnabled ? runtimePatch : null;
  const projected = override || (!this.systemModificationsEnabled
    ? projectRdxDescriptor(descriptor.mt, descriptor.ml, descriptor.qy)
    : appliedRuntimePatch
      ? projectRuntimeCollisionPatch(appliedRuntimePatch.action, classicFlags)
      : projectRdxDescriptor(descriptor.mt, descriptor.ml, descriptor.qy, classicFlags, {
        qx:descriptor.qx,
        squareHoleClearance:this._squareHoleClearanceAtGrid(gridX, gridY, descriptor, classicFlags, classicComparison.inBounds),
        correspondenceMask:correspondence.status === 'confident' ? correspondence.mask : null,
        matchedActivator:correspondence.activatorMatches?.length > 0,
        requireFullLadderWidth:Number(this.selection?.submap) === 9 && Number(this.selection?.mapId) === 13
      }));
  const flags = Number(projected.flags || 0) & 0xff;
  const kind = collisionSemantic(flags);
  const rawDetail = `MT=0x${descriptor.mt.toString(16).padStart(2,'0')}, ML=0x${descriptor.ml.toString(16).padStart(2,'0')}`;
  if (!(flags & GAMEPLAY_MASK) && projected.known && !descriptor.editorGeometry && !exactEditorOverride && !includeOpen) return null;
  const authority = exactEditorOverride ? 'Map Editor exact G8 correction'
    : descriptor.editorGeometry ? 'Map Editor draft descriptor'
    : appliedRuntimePatch ? 'Reviewed shared RDX collision patch'
    : !this.systemModificationsEnabled ? 'Raw decoded RDX descriptor projection'
    : projected.source === 'classic-correspondence' ? 'RDX feature/state + Classic 8×8 correspondence'
    : projected.source === 'classic-square-hole-clearance' ? 'RDX square-hole topology + Classic clearance'
    : projected.known ? 'RDX descriptor projection' : 'Classic fallback for unresolved RDX descriptor';
  const description = `${authority}: ${collisionSemanticName(flags)} at xrick 8×8 resolution. ${rawDetail}; projection=${projected.source}.`;
  let provenance = null;
  if (includeProvenance) {
    let trace = null;
    try { trace = this.mapDecoder.inspectGridCell?.(this.selection.mapId, gridX, gridY, phase, { topology:this.selection?.topology || null }) || null; } catch {}
    const coordinate = trace?.coordinate || Object.freeze({
      grid8:grid, pixelCenter:Object.freeze({ x:gridX * 8 + 4, y:gridY * 8 + 4 }),
      visual16:Object.freeze({ x:descriptor.logicCellX, y:descriptor.logicCellY }),
      quadrant:Object.freeze({ x:descriptor.qx, y:descriptor.qy, index:descriptor.qx + descriptor.qy * 2 }),
      romLogic:Object.freeze({ x:descriptor.logicX, y:descriptor.logicY, index:descriptor.logicIndex, width:descriptor.logicWidth, height:descriptor.logicHeight })
    });
    provenance = Object.freeze({
      authority, coordinate,
      descriptor:Object.freeze({
        mt:descriptor.mt, ml:descriptor.ml,
        mtSource:trace?.descriptor?.mtSource || null, mlSource:trace?.descriptor?.mlSource || null
      }),
      projection:Object.freeze({
        source:projected.source, known:!!projected.known, flags, kind, kindName:collisionSemanticName(flags),
        correspondenceStatus:correspondence.status,
        correspondenceMask:correspondence.mask,
        classicActivatorMatches:correspondence.activatorMatches
      }),
      classicComparison, visual:trace?.visual || null, editorOverride:exactEditorOverride || descriptor.editorGeometry, runtimePatch
    });
  }
  return Object.freeze({
    id, visualSource:source, submap:Number(this.selection.submap), mapId:Number(this.selection.mapId),
    grid, logicCell:Object.freeze({ x:descriptor.logicCellX, y:descriptor.logicCellY }),
    bounds, kind, kindCode:flags & GAMEPLAY_MASK, kindName:collisionSemanticName(flags), flags,
    description, descriptorKnown:!!projected.known, fallback:!projected.known,
    editorOverride:exactEditorOverride || descriptor.editorGeometry, runtimePatch, raw:Object.freeze({ mt:descriptor.mt, ml:descriptor.ml, classicFlags, projection:projected.source }),
    ...(provenance ? { provenance } : {})
  });
}

export function collisionLayer(selectedGeometryIds = []) {
  if (!this.selection) throw new Error('PreviewRenderer.select() must be called first');
  const selected = new Set(selectedGeometryIds || []);
  const { width, height } = this.selection.dimensions;
  const output = new PixelBuffer(width, height, [0, 0, 0, 0]);
  const outlineCell = (x, y, color) => drawRect(output, x, y, 8, 8, color, false);
  const outlineSelected = (source, x, y) => {
    const gridX = Math.floor(x / 8), gridY = Math.floor(y / 8);
    if (selected.has(this._geometryCellId(source, gridX, gridY))) outlineCell(x, y, [255, 255, 255, 255]);
  };
  const source = this.selection.visualSource === 'classic' ? 'classic' : 'rdx';
  const gridWidth = Math.floor(width / 8), gridHeight = Math.floor(height / 8);
  for (let y = 0; y < gridHeight; y += 1) for (let x = 0; x < gridWidth; x += 1) {
    const selectedHere = selected.has(this._geometryCellId(source, x, y));
    const cell = this.geometryCellAt(x * 8 + 4, y * 8 + 4, { includeOpen:selectedHere, includeProvenance:false });
    if (!cell) continue;
    const flags = Number(cell.flags || 0);
    if (cell.fallback) outlineCell(x * 8, y * 8, [80, 230, 210, 190]);
    else if (flags & MAP_EFLG.LETHAL) outlineCell(x * 8, y * 8, [255, 70, 220, 185]);
    else if (flags & (MAP_EFLG.SOLID | MAP_EFLG.SPAD)) outlineCell(x * 8, y * 8, [255, 50, 70, 150]);
    else if (flags & MAP_EFLG.WAYUP) outlineCell(x * 8, y * 8, [50, 160, 255, 165]);
    else if (flags & (MAP_EFLG.CLIMB | MAP_EFLG.VERT)) outlineCell(x * 8, y * 8, [255, 160, 40, 170]);
    outlineSelected(source, x * 8, y * 8);
  }
  return output;
}

export function unresolvedCollisionCells() {
  if (!this.selection || this.selection.visualSource === 'classic') return Object.freeze([]);
  const { width, height } = this.selection.dimensions;
  const gridWidth = Math.floor(width / 8), gridHeight = Math.floor(height / 8);
  const cells = [];
  for (let y = 0; y < gridHeight; y += 1) for (let x = 0; x < gridWidth; x += 1) {
    const cell = this.geometryCellAt(x * 8 + 4, y * 8 + 4, { includeOpen:true, includeProvenance:false });
    const collisionOverride = String(cell?.editorOverride?.collision || 'original');
    /* Raw MT/ML audit fallback is not an unresolved gameplay cell when a
     * production Classic activator already owns that exact 8x8 position.
     * SM05 is the canonical case: its 12 raw fallback quadrants are the three
     * 32x32 type-3 activator/deactivator regions. Keep the descriptor audit
     * raw, but do not present those source-backed dynamic triggers as missing
     * RDX collision semantics. */
    if (cell?.fallback && collisionOverride === 'original' &&
        !activatorOwnsCollisionCell(this.productionScene, this.selection, cell)) cells.push(cell);
  }
  return Object.freeze(cells);
}

export function unresolvedCollisionLayer() {
  if (!this.selection) throw new Error('PreviewRenderer.select() must be called first');
  const { width, height } = this.selection.dimensions;
  const output = new PixelBuffer(width, height, [0, 0, 0, 0]);
  for (const cell of this.unresolvedCollisionCells()) {
    const x = Number(cell.bounds?.x || 0), y = Number(cell.bounds?.y || 0);
    drawRect(output, x, y, 8, 8, [255, 210, 40, 54], true);
    drawRect(output, x, y, 8, 8, [255, 225, 70, 255], false);
    for (let i = 1; i < 7; i += 1) {
      output.setPixel(x + i, y + i, [255, 70, 90, 255]);
      output.setPixel(x + 7 - i, y + i, [255, 70, 90, 255]);
    }
  }
  return output;
}
