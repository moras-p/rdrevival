import { PixelBuffer } from '../render/pixel-buffer.js';

const CELL_PX = 8;

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function fallbackPoint(x, y, offset = null, sourceClassic = true) {
  const dx = finite(offset?.dxPx), dy = finite(offset?.dyPx);
  return sourceClassic
    ? Object.freeze({ x:finite(x) + dx, y:finite(y) + dy, sourceCell:null, fallback:true })
    : Object.freeze({ x:finite(x) - dx, y:finite(y) - dy, sourceCell:null, fallback:true });
}

/** Map one canonical Classic room point (the coordinate system used by source
 * entities/triggerBounds) into RDX editor coordinates. */
export function classicPresentationPointToRdx(shiftMap, submap, x, y, fallbackOffset = null) {
  return shiftMap?.mapPresentationPixel?.(submap, x, y, true) || fallbackPoint(x, y, fallbackOffset, true);
}

export function classicPresentationBoundsToRdx(shiftMap, submap, bounds, fallbackOffset = null) {
  if (!bounds) return null;
  const x = finite(bounds.x), y = finite(bounds.y);
  const width = Math.max(1, finite(bounds.width, 1)), height = Math.max(1, finite(bounds.height, 1));
  const cx = x + width / 2, cy = y + height / 2;
  const mapped = classicPresentationPointToRdx(shiftMap, submap, cx, cy, fallbackOffset);
  return Object.freeze({ x:x + mapped.x - cx, y:y + mapped.y - cy, width, height });
}

function copyCell(source, target, sx, sy, tx, ty) {
  const sourceX = Math.round(sx), sourceY = Math.round(sy);
  const targetX = Math.round(tx), targetY = Math.round(ty);
  if (sourceX >= source.width || sourceY >= source.height || targetX >= target.width || targetY >= target.height) return;
  if (sourceX + CELL_PX <= 0 || sourceY + CELL_PX <= 0 || targetX + CELL_PX <= 0 || targetY + CELL_PX <= 0) return;
  const sourceLeft = Math.max(0, sourceX), sourceTop = Math.max(0, sourceY);
  const targetLeft = Math.max(0, targetX), targetTop = Math.max(0, targetY);
  const clipLeft = Math.max(sourceLeft - sourceX, targetLeft - targetX);
  const clipTop = Math.max(sourceTop - sourceY, targetTop - targetY);
  const width = Math.min(CELL_PX - clipLeft, source.width - (sourceX + clipLeft), target.width - (targetX + clipLeft));
  const height = Math.min(CELL_PX - clipTop, source.height - (sourceY + clipTop), target.height - (targetY + clipTop));
  if (width <= 0 || height <= 0) return;
  for (let py = 0; py < height; py += 1) {
    const src = (((sourceY + clipTop + py) * source.width) + sourceX + clipLeft) * 4;
    const dst = (((targetY + clipTop + py) * target.width) + targetX + clipLeft) * 4;
    target.data.set(source.data.subarray(src, src + width * 4), dst);
  }
}

/**
 * Re-express a complete Classic preview buffer in RDX editor coordinates.
 * Iterate destination RDX cells and ask the shared shift map which Classic
 * preview cell corresponds to each one.  Destination-driven projection avoids
 * overlaps when different room sections have different vertical phases.
 */
export function projectClassicPreviewBufferToRdx(buffer, {
  shiftMap = null,
  submap = 0,
  targetWidth = buffer?.width,
  targetHeight = buffer?.height,
  fallbackOffset = null,
  disconnectedFill = null
} = {}) {
  const width = Math.max(1, Math.round(finite(targetWidth, buffer?.width || 1)));
  const height = Math.max(1, Math.round(finite(targetHeight, buffer?.height || 1)));
  const target = new PixelBuffer(width, height, Array.isArray(disconnectedFill) ? disconnectedFill : [0, 0, 0, 0]);
  if (!buffer?.data || !Number.isFinite(Number(buffer.width)) || !Number.isFinite(Number(buffer.height))) return target;

  const mappedRoom = shiftMap?.roomForSubmap?.(submap) || null;
  for (let ty = 0; ty < height; ty += CELL_PX) for (let tx = 0; tx < width; tx += CELL_PX) {
    if (!mappedRoom) {
      const mapped = fallbackPoint(tx, ty, fallbackOffset, false);
      copyCell(buffer, target, mapped.x, mapped.y, tx, ty);
      continue;
    }

    /* The displacement field can contain local phase changes where two RDX
     * destination cells would otherwise sample the same Classic cell.  That
     * is useful for camera/world correspondence but it is not a valid image
     * warp: repeating artwork invents Classic map area that never existed.
     * Keep only bijective cell pairs.  RDX-only space and phase seams remain
     * transparent (or use disconnectedFill on the background plane). */
    const mapped = shiftMap.mapPreviewPixel(submap, tx, ty, false);
    if (!mapped?.sourceCell || mapped.fallback) continue;
    const roundTrip = shiftMap.mapPreviewPixel(submap, mapped.x, mapped.y, true);
    if (!roundTrip?.sourceCell || roundTrip.fallback) continue;
    if (Math.floor(roundTrip.x / CELL_PX) !== Math.floor(tx / CELL_PX) ||
        Math.floor(roundTrip.y / CELL_PX) !== Math.floor(ty / CELL_PX)) continue;
    copyCell(buffer, target, mapped.x, mapped.y, tx, ty);
  }
  return target;
}
