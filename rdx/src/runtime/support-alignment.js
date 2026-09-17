function floorDiv16(value) {
  return Math.floor(Number(value) / 16);
}

function supportCell(mt, ml) {
  const type = Number(mt) & 0xff;
  const logic = Number(ml) & 0xff;
  if (type & 0x80) return logic === 0x11 || logic === 0x13;
  const mode = type & 0x03;
  return mode === 1 || mode === 3;
}

function fullSolidCell(mt, ml) {
  const type = Number(mt) & 0xff;
  const logic = Number(ml) & 0xff;
  if (type & 0x80) return logic === 0x11;
  return (type & 0x03) === 1;
}

function logicAssets(mapDecoder, mapId) {
  const logic = mapDecoder.logicDimensions(mapId);
  const mt = mapDecoder.rom.payload('MT', mapId);
  let ml;
  try { ml = mapDecoder.rom.payload('ML', mapId); } catch { ml = new Uint8Array(mt.length); }
  return { logic, mt, ml };
}

function cellAt(assets, worldX, worldY) {
  const vx = floorDiv16(worldX), vy = floorDiv16(worldY);
  const lx = vx + 1, ly = vy + 1;
  if (lx < 0 || ly < 0 || lx >= assets.logic.width || ly >= assets.logic.height) return null;
  const index = ly * assets.logic.width + lx;
  return { mt: assets.mt[index], ml: assets.ml[index], vx, vy };
}

function supportPixels(assets, originX, originY, span) {
  const left = originX - Math.floor(span / 2);
  let count = 0;
  for (let offset = 0; offset < span; offset += 1) {
    const cell = cellAt(assets, left + offset, originY);
    if (!cell || cell.vy * 16 !== originY) continue;
    if (supportCell(cell.mt, cell.ml)) count += 1;
  }
  return count;
}

function bodyIsClear(assets, originX, originY, span, height) {
  const left = originX - Math.floor(span / 2);
  const right = left + span - 1;
  const top = originY - height;
  /* One sample inside every crossed 16 px cell is enough because native RDX
   * terrain occupancy is cell-wide. Include both visual edges so a placement
   * can never hide a collectible inside the adjacent wall/walkway. */
  for (let y = top; y < originY; y = Math.min(originY, (floorDiv16(y) + 1) * 16)) {
    const sampleY = Math.min(originY - 1, y);
    for (let x = left; x <= right; x = Math.min(right + 1, (floorDiv16(x) + 1) * 16)) {
      const sampleX = Math.min(right, x);
      const cell = cellAt(assets, sampleX, sampleY);
      if (cell && fullSolidCell(cell.mt, cell.ml)) return false;
    }
  }
  return true;
}

/**
 * Align a presentation-only object foot anchor to an exposed native RDX
 * support. This never mutates xrick entity coordinates or gameplay terrain.
 */
export function alignOriginToRdxSupport(mapDecoder, mapId, originX, originY, options = {}) {
  const span = Math.max(1, Number(options.span || 16) | 0);
  const height = Math.max(1, Number(options.height || 16) | 0);
  const minimumSupport = Math.max(1, Math.min(span,
    Number(options.minimumSupport ?? Math.ceil(span * 0.75)) | 0));
  const searchX = Math.max(0, Number(options.searchX ?? 16) | 0);
  const searchY = Math.max(0, Number(options.searchY ?? 24) | 0);
  const assets = logicAssets(mapDecoder, mapId);
  const current = supportPixels(assets, originX, originY, span);
  const currentClear = bodyIsClear(assets, originX, originY, span, height);
  let best = currentClear ? current : 0;
  let bestDx = 0, bestDy = 0;
  let bestCost = Infinity;

  for (let dy = -searchY; dy <= searchY; dy += 1) {
    for (let dx = -searchX; dx <= searchX; dx += 1) {
      const x = originX + dx, y = originY + dy;
      if (!bodyIsClear(assets, x, y, span, height)) continue;
      const score = supportPixels(assets, x, y, span);
      /* Correct a bad vertical foot anchor before moving an item sideways.
       * Horizontal shifts remain available for a spawn exactly inside a wall. */
      const cost = Math.abs(dx) * 4 + Math.abs(dy);
      if (score > best || (score === best && score >= minimumSupport && cost < bestCost)) {
        best = score; bestDx = dx; bestDy = dy; bestCost = cost;
      }
    }
  }
  const shifted = best >= minimumSupport &&
    (!currentClear || best > current || (best === current && (bestDx !== 0 || bestDy !== 0) && bestCost < Infinity));
  return {
    x: shifted ? originX + bestDx : originX,
    y: shifted ? originY + bestDy : originY,
    currentSupportPixels: current,
    supportPixels: best,
    supportSpanPixels: span,
    bodyClear: shifted ? true : currentClear,
    shifted
  };
}

export function alignAmmoOriginToRdxSupport(mapDecoder, mapId, originX, originY) {
  return alignOriginToRdxSupport(mapDecoder, mapId, originX, originY, {
    span: 28,
    height: 18,
    minimumSupport: 21,
    searchX: 16,
    searchY: 24
  });
}
