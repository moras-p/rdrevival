/** Shared Level Editor G8 terrain projection: decoded MT/ML + reviewed D overrides.
 * Inspection of resolved source semantics, not a native actor-contact callback. */
import { effectiveMapDimensions } from '../../core/map-topology.js';
const CELL = 8;
export const COLLISION_KIND = Object.freeze({ 0:'open', 1:'solid', 2:'one-way', 3:'ladder', 4:'lethal', 5:'exit' });

export function collisionCells(room, assets, paneOrigin, topology = null, { worldRect = null, includeOpen = false } = {}) {
  const rawDimensions = room?.layers?.source?.rdx?.dimensions || assets.mapDecoder.dimensions(room.mapId);
  const dimensions = effectiveMapDimensions(rawDimensions, topology);
  const viewport = worldRect ? { x:worldRect[0], y:worldRect[1], width:worldRect[2], height:worldRect[3] } : { x:0, y:0, width:dimensions.width, height:dimensions.height };
  const mask = assets.mapDecoder.geometryMask(room.mapId, viewport, { topology });
  const overrides = new Map();
  for (const operation of room?.layers?.structuralCorrections?.operations || []) {
    if (operation.type !== 'gameplay-cell-override' || !Array.isArray(operation.g8Bounds)) continue;
    const [gx, gy, width, height] = operation.g8Bounds.map(Number);
    for (let y = gy; y < gy + height; y += 1) for (let x = gx; x < gx + width; x += 1) overrides.set(`${x}:${y}`, operation);
  }
  const rows = [];
  for (let localY = 0; localY < mask.height; localY += 1) for (let localX = 0; localX < mask.width; localX += 1) {
    const x = viewport.x / CELL + localX, y = viewport.y / CELL + localY;
    const rawKind = mask.data[localY * mask.width + localX] || 0;
    const override = overrides.get(`${x}:${y}`) || null;
    let effectiveKind = rawKind;
    if (override?.action === 'open') effectiveKind = 0;
    else if (override?.action === 'one-way') effectiveKind = 2;
    else if (override?.action === 'climb-through') effectiveKind = 3;
    else if (override?.action === 'lethal') effectiveKind = 4;
    else if (override?.action === 'exit') effectiveKind = 5;
    if (!rawKind && !override && !includeOpen) continue;
    rows.push(Object.freeze({
      id:`collision:${x}:${y}`, kind:'collision-cell', gx:x, gy:y,
      rect:{ x:paneOrigin.x + x*CELL, y:paneOrigin.y + y*CELL, width:CELL, height:CELL },
      rawKind:mask.proven ? (COLLISION_KIND[rawKind] || `kind-${rawKind}`) : 'unknown',
      effectiveKind:!mask.proven && !override ? 'unknown' : COLLISION_KIND[effectiveKind] || `kind-${effectiveKind}`,
      override,
      exitAnchor:override?.action === 'exit' && Number(override?.g8Bounds?.[0]) === x && Number(override?.g8Bounds?.[1]) === y,
      exitBounds:override?.action === 'exit' && Array.isArray(override?.g8Bounds)
        ? { x:paneOrigin.x + Number(override.g8Bounds[0])*CELL, y:paneOrigin.y + Number(override.g8Bounds[1])*CELL,
            width:Number(override.g8Bounds[2])*CELL, height:Number(override.g8Bounds[3])*CELL }
        : null,
      sourceProven:mask.proven
    }));
  }
  return rows;
}
