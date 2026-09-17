export const MAP_TRANSITION_PRESETS = Object.freeze([
  'checker-wipe',
  'blitter-bars',
  'tile-iris',
  'copper-curtain',
  'raster-shutters',
  'mosaic-collapse',
  'tunnel-iris',
  'pixel-dissolve',
  'scanline-squeeze'
]);

export const MAP_TRANSITION_PERFORMANCE = Object.freeze({
  /* Score is an absolute 60 Hz frame-budget impact class, not a ranking
   * against RDX's current uncapped frame time. Release thresholds are:
   * 1 <0.10%, 2 0.10-<0.25%, 3 0.25-<0.50%, 4 0.50-<1%, 5 >=1%.
   * This prevents a temporarily slow gameplay baseline from making a tiny
   * transient overlay look expensive. */
  'scanline-squeeze': Object.freeze({ score:1, grade:'minimal', family:'2 rectangles' }),
  'copper-curtain': Object.freeze({ score:1, grade:'minimal', family:'~34 raster bands' }),
  'blitter-bars': Object.freeze({ score:1, grade:'minimal', family:'~25 horizontal bars' }),
  'raster-shutters': Object.freeze({ score:1, grade:'minimal', family:'~50 narrow bars' }),
  'checker-wipe': Object.freeze({ score:1, grade:'minimal', family:'8px tile scan + merged runs' }),
  'tile-iris': Object.freeze({ score:1, grade:'minimal', family:'8px tile scan + merged runs' }),
  'tunnel-iris': Object.freeze({ score:1, grade:'minimal', family:'8px radial scan + merged runs' }),
  'mosaic-collapse': Object.freeze({ score:1, grade:'minimal', family:'8px radial+dither scan + merged runs' }),
  'pixel-dissolve': Object.freeze({ score:2, grade:'very low', family:'4px cached-dither scan + merged runs' })
});

export function transitionPerformanceImpact(preset) {
  return MAP_TRANSITION_PERFORMANCE[preset] || MAP_TRANSITION_PERFORMANCE['tile-iris'];
}

function fillTileRuns(ctx, cols, rows, tileWidth, tileHeight, yOffset, predicate) {
  for (let row = 0; row < rows; row += 1) {
    let run = -1;
    for (let col = 0; col <= cols; col += 1) {
      const filled = col < cols && predicate(col, row);
      if (filled && run < 0) run = col;
      if ((!filled || col === cols) && run >= 0) {
        ctx.fillRect(run * tileWidth, yOffset + row * tileHeight, (col - run) * tileWidth, tileHeight);
        run = -1;
      }
    }
  }
}

function hashCellU32(x, y) {
  let n = ((x + 17) * 73856093) ^ ((y + 31) * 19349663);
  n ^= n >>> 13;
  return n >>> 0;
}

/* Deterministic dissolve noise is immutable. Computing the integer hash for
 * every 4px cell on every transition frame was the largest real transition
 * hot path. Cache it per grid shape; drawing then becomes comparisons + merged
 * fill runs with no per-cell hashing or allocation. */
const dissolveHashCache = new Map();
function dissolveHashes(cols, rows, rowSeed = 2) {
  const key = `${cols}:${rows}:${rowSeed}`;
  let values = dissolveHashCache.get(key);
  if (values) return values;
  values = new Uint32Array(cols * rows);
  let i = 0;
  for (let row = 0; row < rows; row += 1)
    for (let col = 0; col < cols; col += 1)
      values[i++] = hashCellU32(col, row + rowSeed);
  dissolveHashCache.set(key, values);
  return values;
}

function fillHashedTileRuns(ctx, cols, rows, tileWidth, tileHeight, yOffset, hashes, q) {
  const limit = q * 0xffffffff;
  let index = 0;
  for (let row = 0; row < rows; row += 1) {
    let run = -1;
    for (let col = 0; col <= cols; col += 1) {
      const filled = col < cols && hashes[index] < limit;
      if (col < cols) index += 1;
      if (filled && run < 0) run = col;
      if (!filled && run >= 0) {
        ctx.fillRect(run * tileWidth, yOffset + row * tileHeight, (col - run) * tileWidth, tileHeight);
        run = -1;
      }
    }
  }
}

function hashCell(x, y) {
  return hashCellU32(x, y) / 0xffffffff;
}

export function randomMapTransitionPreset(random = Math.random) {
  const index = Math.min(MAP_TRANSITION_PRESETS.length - 1,
    Math.max(0, Math.floor(Number(random()) * MAP_TRANSITION_PRESETS.length)));
  return MAP_TRANSITION_PRESETS[index];
}

export function drawMapTransitionMask(ctx, preset, phase, direction = 'right', origin = { x: 160, y: 100 }, flow = 'out', width = 320, height = 200) {
  const p = Math.max(0, Math.min(1, Number(phase) || 0));
  const q = flow === 'in' ? 1 - p : p;
  if (q <= 0) return;
  ctx.save();
  ctx.fillStyle = '#000';
  if (preset === 'checker-wipe') {
    const tile = 8, cols = Math.ceil(width / tile), rows = Math.ceil(height / tile), reach = q * (cols + rows + 1);
    fillTileRuns(ctx, cols, rows, tile, tile, 0, (col,row) => {
      const dc = direction === 'left' ? cols - 1 - col : col;
      return dc + row + ((row + col) & 1) * .65 <= reach;
    });
  } else if (preset === 'blitter-bars' || preset === 'raster-shutters') {
    const bar = preset === 'raster-shutters' ? 4 : 8, rows = Math.ceil(height / bar);
    for (let row = 0; row < rows; row += 1) {
      const stagger = (row % (preset === 'raster-shutters' ? 8 : 4)) * .035;
      const rp = Math.max(0, Math.min(1, (q - stagger) / Math.max(.01, 1 - stagger)));
      const w = Math.round(width * rp);
      const fromLeft = preset === 'raster-shutters' ? (row & 1) === 0 : direction !== 'left';
      ctx.fillRect(fromLeft ? 0 : width - w, row * bar, w, bar);
    }
  } else if (preset === 'copper-curtain') {
    const band = 6, rows = Math.ceil(height / band), reach = q * (rows + 5);
    for (let row = 0; row < rows; row += 1) {
      const wave = (Math.sin(row * .9) + 1) * 1.5;
      if (row + wave <= reach) ctx.fillRect(0, row * band, width, band);
    }
  } else if (preset === 'scanline-squeeze') {
    const h = Math.round((height / 2) * q);
    ctx.fillRect(0, 0, width, h);
    ctx.fillRect(0, height - h, width, h);
  } else if (preset === 'pixel-dissolve') {
    const tile = 4, cols = Math.ceil(width / tile), rows = Math.ceil(Math.max(0, height - 8) / tile);
    fillHashedTileRuns(ctx, cols, rows, tile, tile, 8, dissolveHashes(cols, rows, 2), q);
  } else if (preset === 'mosaic-collapse') {
    const tile = 8, cols = Math.ceil(width / tile), rows = Math.ceil(Math.max(0, height - 8) / tile);
    const maxDx = Math.max(origin.x, width - origin.x), maxDy = Math.max(origin.y, height - origin.y);
    const maxD = Math.max(1, Math.hypot(maxDx, maxDy));
    fillTileRuns(ctx, cols, rows, tile, tile, 8, (col,row) => {
      const dx = col * tile + 4 - origin.x, dy = 8 + row * tile + 4 - origin.y;
      const threshold = q * 1.18 - hashCell(col, row + 1) * .18;
      if (threshold <= 0) return false;
      const limit = threshold * maxD;
      return dx * dx + dy * dy < limit * limit;
    });
  } else if (preset === 'tunnel-iris') {
    const tile = 8, cols = Math.ceil(width / tile), rows = Math.ceil(Math.max(0, height - 8) / tile);
    const maxDx = Math.max(origin.x, width - origin.x), maxDy = Math.max(origin.y, height - origin.y);
    const maxD = Math.max(1, Math.hypot(maxDx, maxDy)), radius2 = (maxD * (1 - q)) ** 2;
    fillTileRuns(ctx, cols, rows, tile, tile, 8, (col,row) => {
      const dx = col * tile + 4 - origin.x, dy = 8 + row * tile + 4 - origin.y;
      return dx * dx + dy * dy > radius2;
    });
  } else {
    /* tile-iris is also the compatibility fallback for profiles from newer
     * builds that name a transition this renderer does not yet know. */
    const tile = 8, cols = Math.ceil(width / tile), rows = Math.ceil(height / tile), maxDepth = Math.ceil(Math.min(cols, rows) / 2), reach = q * (maxDepth + .5);
    fillTileRuns(ctx, cols, rows, tile, tile, 0, (col,row) => Math.min(col, cols - 1 - col, row, rows - 1 - row) < reach);
  }
  ctx.restore();
}
