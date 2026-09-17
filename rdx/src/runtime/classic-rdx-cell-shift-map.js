import { normalizeMapTopology, topologySourceY } from '../core/map-topology.js';

/**
 * Dense Classic <-> RDX presentation displacement field.
 *
 * Each mapped RDX 8x8 cell exposes the complete Classic->RDX coordinate
 * displacement. Canonical topology is the normal visual seed; a distinct
 * runtime viewport phase may replace it only when static-map overlap is
 * decisively stronger (the tall SM0C room is the current case). Remaining
 * local floor phase comes from stable support runs. Live switching stores the
 * difference between that visual correspondence and the native runtime phase,
 * because native RDX collision/presentation already applies the latter.
 *
 * Nearby cells inherit trusted local phase anchors conservatively so mapping
 * remains usable while Rick is standing, jumping or climbing. Ambiguous local
 * evidence fails closed to zero correction without discarding the known room
 * transform. This is presentation-coordinate data only, not a collision
 * override and not a second gameplay solver.
 */
const CLASSIC_SUPPORT_FLAGS = 0x50; // MAP_EFLG_SOLID | MAP_EFLG_WAYUP
const CELL_PX = 8;
const MAX_MATCH_DELTA_CELLS = 4;
const SKIP_COST = 1.25;
const NONZERO_MATCH_BIAS = 0.15;
const DELTA_MATCH_COST = 0.45;
const MIN_ZERO_RUN = 2;
const MIN_NONZERO_RUN = 3;
const FIELD_NEIGHBOURS = 7;
const NONZERO_MIN_RATIO = 0.58;
const NONZERO_MAX_DISTANCE = 8;
const RUNTIME_ALIGNMENT_SCORE_MARGIN = 0.12;
// Keep these constants in lockstep with the native Rick world-sync formula.
const E_RICK_SLOT = 1;
const ENTITY_ORIGIN_X = 11;
const ENTITY_WORLD_Y_DELTA = -44;

function integer(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function decodeStaticOccupancy(room) {
  const grid = room?.staticGrid;
  const width = integer(grid?.width), height = integer(grid?.height);
  if (width <= 0 || height <= 0) return null;
  const solid = new Uint8Array(width * height);
  for (const run of grid.runs || []) {
    const y = integer(run.y), x0 = integer(run.x), length = integer(run.length);
    if (y < 0 || y >= height || length <= 0 || !(run.contacts || []).length) continue;
    const start = Math.max(0, x0), end = Math.min(width, x0 + length);
    for (let x = start; x < end; x += 1) solid[y * width + x] = 1;
  }
  return { width, height, solid };
}

function projectRdxOccupancy(raw, topologyValue) {
  const topology = normalizeMapTopology(topologyValue);
  if (!raw || !topology) return raw;
  if (raw.width * CELL_PX !== topology.rawVisualSize[0] || raw.height * CELL_PX !== topology.rawVisualSize[1])
    throw new Error(`RDX occupancy ${raw.width}x${raw.height} disagrees with topology ${topology.rawVisualSize.join('x')}`);
  const height = topology.effectiveVisualSize[1] / CELL_PX;
  if (!Number.isInteger(height)) throw new Error('RDX topology effective height must be 8px aligned for correspondence');
  const solid = new Uint8Array(raw.width * height);
  for (let y = 0; y < height; y += 1) {
    const sourceY = topologySourceY(topology, y * CELL_PX);
    if (!Number.isInteger(sourceY) || sourceY % CELL_PX) throw new Error(`RDX topology correspondence row ${y} is not 8px aligned`);
    const sourceRow = sourceY / CELL_PX;
    solid.set(raw.solid.subarray(sourceRow * raw.width, (sourceRow + 1) * raw.width), y * raw.width);
  }
  return { width:raw.width, height, solid };
}

function decodeClassicOccupancy(room) {
  const width = integer(room?.widthTiles), height = integer(room?.heightTiles);
  if (width <= 0 || height <= 0 || !Array.isArray(room?.flags) || room.flags.length < width * height) return null;
  const solid = new Uint8Array(width * height);
  for (let i = 0; i < solid.length; i += 1) solid[i] = (integer(room.flags[i]) & CLASSIC_SUPPORT_FLAGS) ? 1 : 0;
  return { width, height, solid };
}

function supportRows(grid, x) {
  if (!grid || x < 0 || x >= grid.width) return [];
  const rows = [];
  for (let y = 0; y < grid.height; y += 1) {
    if (!grid.solid[y * grid.width + x]) continue;
    if (y > 0 && grid.solid[(y - 1) * grid.width + x]) continue;
    rows.push(y);
  }
  return rows;
}

function occupancyAlignmentScore(classic, rdx, dxCells, dyCells) {
  if (!classic || !rdx || !Number.isInteger(dxCells) || !Number.isInteger(dyCells)) return 0;
  let eligible = 0, matches = 0;
  for (let classicY = 0; classicY < classic.height; classicY += 1) {
    const rdxY = classicY + dyCells;
    if (rdxY < 0 || rdxY >= rdx.height) continue;
    for (let classicX = 0; classicX < classic.width; classicX += 1) {
      if (!classic.solid[classicY * classic.width + classicX]) continue;
      const rdxX = classicX + dxCells;
      if (rdxX < 0 || rdxX >= rdx.width) continue;
      eligible += 1;
      if (rdx.solid[rdxY * rdx.width + rdxX]) matches += 1;
    }
  }
  return eligible ? matches / eligible : 0;
}

function chooseVisualBase(classic, rdx, canonical, runtime) {
  const canonicalXCells = integer(canonical?.dxPx) / CELL_PX;
  const canonicalYCells = integer(canonical?.dyPx) / CELL_PX;
  const runtimeXCells = integer(runtime?.dxPx) / CELL_PX;
  const runtimeYCells = integer(runtime?.dyPx) / CELL_PX;
  if (![canonicalXCells, canonicalYCells, runtimeXCells, runtimeYCells].every(Number.isInteger)) return null;
  const canonicalScore = occupancyAlignmentScore(classic, rdx, canonicalXCells, canonicalYCells);
  const runtimeScore = occupancyAlignmentScore(classic, rdx, runtimeXCells, runtimeYCells);
  const useRuntime = (runtimeXCells !== canonicalXCells || runtimeYCells !== canonicalYCells) &&
    runtimeScore > canonicalScore + RUNTIME_ALIGNMENT_SCORE_MARGIN;
  return Object.freeze({
    dxCells: useRuntime ? runtimeXCells : canonicalXCells,
    dyCells: useRuntime ? runtimeYCells : canonicalYCells,
    basis: useRuntime ? 'runtime-static-overlap' : 'canonical-topology',
    canonicalScore, runtimeScore
  });
}

function alignSupports(classicRows, rdxRows, baseYCells) {
  const n = classicRows.length, m = rdxRows.length;
  if (!n || !m) return [];
  const width = m + 1;
  const dp = new Float64Array((n + 1) * width);
  const action = new Int8Array((n + 1) * width);
  dp.fill(Number.POSITIVE_INFINITY);
  dp[0] = 0;
  for (let i = 0; i <= n; i += 1) for (let j = 0; j <= m; j += 1) {
    if (i === 0 && j === 0) continue;
    const at = i * width + j;
    if (i > 0) {
      const cost = dp[(i - 1) * width + j] + SKIP_COST;
      if (cost < dp[at]) { dp[at] = cost; action[at] = 1; }
    }
    if (j > 0) {
      const cost = dp[i * width + (j - 1)] + SKIP_COST;
      if (cost < dp[at]) { dp[at] = cost; action[at] = 2; }
    }
    if (i > 0 && j > 0) {
      const delta = rdxRows[j - 1] - (classicRows[i - 1] + baseYCells);
      if (Math.abs(delta) <= MAX_MATCH_DELTA_CELLS) {
        const cost = dp[(i - 1) * width + (j - 1)] + Math.abs(delta) * DELTA_MATCH_COST + (delta ? NONZERO_MATCH_BIAS : 0);
        if (cost <= dp[at]) { dp[at] = cost; action[at] = 3; }
      }
    }
  }
  const out = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const op = action[i * width + j];
    if (op === 3) {
      const classicY = classicRows[i - 1], rdxY = rdxRows[j - 1];
      out.push({ classicY, rdxY, deltaCells: rdxY - (classicY + baseYCells) });
      i -= 1; j -= 1;
    } else if (op === 1) i -= 1;
    else if (op === 2) j -= 1;
    else break;
  }
  return out.reverse();
}

function stableAnchors(raw) {
  const byKey = new Map();
  for (const anchor of raw) {
    const key = `${anchor.rdxY}:${anchor.deltaCells}`;
    const list = byKey.get(key) || [];
    list.push(anchor);
    byKey.set(key, list);
  }
  const out = [];
  for (const list of byKey.values()) {
    list.sort((a, b) => a.x - b.x);
    let start = 0;
    while (start < list.length) {
      let end = start + 1;
      while (end < list.length && list[end].x === list[end - 1].x + 1) end += 1;
      const delta = list[start].deltaCells;
      const minRun = delta === 0 ? MIN_ZERO_RUN : MIN_NONZERO_RUN;
      if (end - start >= minRun) out.push(...list.slice(start, end));
      start = end;
    }
  }
  return out;
}

function buildField(width, height, anchors, mappedX0 = 0, mappedX1 = width, mappedY0 = 0, mappedY1 = height) {
  const dyCells = new Int8Array(width * height);
  const confidence = new Uint8Array(width * height);
  const coverage = new Uint8Array(width * height);
  const inMappedRange = (x, y) => x >= mappedX0 && x < mappedX1 && y >= mappedY0 && y < mappedY1;
  if (!anchors.some(anchor => anchor.deltaCells !== 0)) {
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      if (!inMappedRange(x, y)) continue;
      const index = y * width + x;
      coverage[index] = 1;
      confidence[index] = 255;
    }
    return { dyCells, confidence, coverage };
  }
  const distances = new Int16Array(FIELD_NEIGHBOURS);
  const deltas = new Int8Array(FIELD_NEIGHBOURS);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const index = y * width + x;
    if (!inMappedRange(x, y)) continue;
    coverage[index] = 1;
    distances.fill(32767);
    deltas.fill(0);
    for (const anchor of anchors) {
      const distance = Math.abs(y - anchor.rdxY) + 2 * Math.abs(x - anchor.x);
      let slot = FIELD_NEIGHBOURS - 1;
      if (distance > distances[slot]) continue;
      while (slot > 0 && (distance < distances[slot - 1] ||
        (distance === distances[slot - 1] && Math.abs(anchor.deltaCells) < Math.abs(deltas[slot - 1])))) {
        distances[slot] = distances[slot - 1];
        deltas[slot] = deltas[slot - 1];
        slot -= 1;
      }
      distances[slot] = distance;
      deltas[slot] = anchor.deltaCells;
    }
    const scores = new Map();
    for (let k = 0; k < FIELD_NEIGHBOURS && distances[k] < 32767; k += 1)
      scores.set(deltas[k], (scores.get(deltas[k]) || 0) + 1 / (1 + distances[k]));
    let bestDelta = 0, bestScore = -1, total = 0;
    for (const [delta, score] of scores) {
      total += score;
      if (score > bestScore || (score === bestScore && Math.abs(delta) < Math.abs(bestDelta))) { bestDelta = delta; bestScore = score; }
    }
    const ratio = total > 0 ? bestScore / total : 0;
    let nearestBest = 32767;
    for (let k = 0; k < FIELD_NEIGHBOURS && distances[k] < 32767; k += 1) if (deltas[k] === bestDelta) { nearestBest = distances[k]; break; }
    if (bestDelta !== 0 && (ratio < NONZERO_MIN_RATIO || nearestBest > NONZERO_MAX_DISTANCE)) bestDelta = 0;
    dyCells[index] = bestDelta;
    confidence[index] = Math.max(0, Math.min(255, Math.round(ratio * 255)));
  }
  return { dyCells, confidence, coverage };
}


function enforceBidirectionalConsistency(forward, reverse, width, height, reverseWidth, reverseHeight, reverseOriginX, reverseOriginY) {
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const index = y * width + x;
    const delta = forward.dyCells[index];
    if (!delta) continue;
    const classicX = x - reverseOriginX, classicY = y - delta - reverseOriginY;
    if (classicX < 0 || classicY < 0 || classicX >= reverseWidth || classicY >= reverseHeight ||
        reverse.dyCells[classicY * reverseWidth + classicX] !== delta) {
      forward.dyCells[index] = 0;
      forward.confidence[index] = 0;
    }
  }
  for (let y = 0; y < reverseHeight; y += 1) for (let x = 0; x < reverseWidth; x += 1) {
    const index = y * reverseWidth + x;
    const delta = reverse.dyCells[index];
    if (!delta) continue;
    const rdxX = x + reverseOriginX, rdxY = y + reverseOriginY + delta;
    if (rdxX < 0 || rdxY < 0 || rdxX >= width || rdxY >= height ||
        forward.dyCells[rdxY * width + rdxX] !== delta) {
      reverse.dyCells[index] = 0;
      reverse.confidence[index] = 0;
    }
  }
}

function roomKey(mapId) { return `MD${String(integer(mapId)).padStart(4, '0')}`; }

export class ClassicRdxCellShiftMap {
  constructor({ classicData, mapping, collisionData } = {}) {
    this.rooms = new Map();
    this.overlayCache = new Map();
    for (const classicRoom of classicData?.rooms || []) {
      const submap = integer(classicRoom.submap, -1);
      const level = mapping?.levelForSubmap?.(submap);
      if (!level) continue;
      const rdxRoom = collisionData?.rooms?.[roomKey(level.rdxMd)];
      const classic = decodeClassicOccupancy(classicRoom);
      const classicPreviewRoom = classicRoom.preview || classicRoom;
      const classicPreview = decodeClassicOccupancy(classicPreviewRoom);
      const rdx = projectRdxOccupancy(decodeStaticOccupancy(rdxRoom), level.rdxTopology);
      if (!classic || !classicPreview || !rdx) continue;
      const canonicalContact = mapping.transformContact(submap, 0, 0);
      const canonical = canonicalContact ? { dxPx: canonicalContact.x, dyPx: canonicalContact.y } : null;
      const runtime = mapping.runtimeOffsetForSubmap(submap);
      const visualBase = chooseVisualBase(classic, rdx, canonical, runtime);
      if (!visualBase) continue;
      const baseXCells = visualBase.dxCells;
      const baseYCells = visualBase.dyCells;
      const classicPreviewYOffsetCells = Math.max(0,
        integer(classicRoom.startRow) - integer(classicPreviewRoom.startRow, integer(classicRoom.startRow)));
      const previewBaseYCells = baseYCells - classicPreviewYOffsetCells;
      const runtimeXCells = integer(runtime?.dxPx) / CELL_PX;
      const runtimeYCells = integer(runtime?.dyPx) / CELL_PX;
      if (!Number.isInteger(runtimeXCells) || !Number.isInteger(runtimeYCells)) continue;
      const raw = [];
      /* The dense visual field owns the complete generated Classic preview,
       * not only the canonical camera slice.  Preview rows above startRow are
       * expressed in the same world phase by subtracting their prepended row
       * count from the canonical Classic->RDX seed.  This keeps Layer C and
       * the Classic<->RDX shift inspector from clipping the exact source area
       * that Layer B deliberately exposes. */
      for (let rdxX = 0; rdxX < rdx.width; rdxX += 1) {
        const classicX = rdxX - baseXCells;
        if (!Number.isInteger(classicX) || classicX < 0 || classicX >= classicPreview.width) continue;
        for (const match of alignSupports(supportRows(classicPreview, classicX), supportRows(rdx, rdxX), previewBaseYCells)) {
          if (match.rdxY <= 1 || match.classicY + previewBaseYCells <= 1) continue;
          raw.push({ x: rdxX, ...match });
        }
      }
      const anchors = stableAnchors(raw);
      const minResidualY = Math.min(0, ...anchors.map(anchor => anchor.deltaCells));
      const maxResidualY = Math.max(0, ...anchors.map(anchor => anchor.deltaCells));
      const mappedX0 = Math.max(0, baseXCells);
      const mappedX1 = Math.min(rdx.width, baseXCells + classicPreview.width);
      const mappedY0 = Math.max(0, previewBaseYCells + minResidualY);
      const mappedY1 = Math.min(rdx.height, previewBaseYCells + classicPreview.height + maxResidualY);
      const field = buildField(rdx.width, rdx.height, anchors, mappedX0, mappedX1, mappedY0, mappedY1);
      const reverseOriginX = Math.min(0, baseXCells);
      const reverseOriginY = Math.min(0, previewBaseYCells);
      const reverseWidth = Math.max(rdx.width, baseXCells + classicPreview.width) - reverseOriginX;
      const reverseHeight = Math.max(rdx.height, previewBaseYCells + classicPreview.height) - reverseOriginY;
      const reverseAnchors = anchors.map(anchor => ({
        ...anchor,
        x: anchor.x - reverseOriginX,
        rdxY: anchor.classicY + previewBaseYCells - reverseOriginY
      }));
      const reverseField = buildField(
        reverseWidth, reverseHeight, reverseAnchors,
        Math.max(0, baseXCells - reverseOriginX),
        Math.min(reverseWidth, baseXCells + classicPreview.width - reverseOriginX),
        Math.max(0, previewBaseYCells - reverseOriginY),
        Math.min(reverseHeight, previewBaseYCells + classicPreview.height - reverseOriginY)
      );
      enforceBidirectionalConsistency(
        field, reverseField, rdx.width, rdx.height, reverseWidth, reverseHeight, reverseOriginX, reverseOriginY
      );

      const totalDxCells = new Int16Array(rdx.width * rdx.height);
      const totalDyCells = new Int16Array(rdx.width * rdx.height);
      const correctionDxCells = new Int16Array(rdx.width * rdx.height);
      const correctionDyCells = new Int16Array(rdx.width * rdx.height);
      const counts = new Map();
      const correctionCounts = new Map();
      let mappedCellCount = 0;
      for (let i = 0; i < field.coverage.length; i += 1) {
        if (!field.coverage[i]) continue;
        mappedCellCount += 1;
        const totalDx = baseXCells;
        const totalDy = baseYCells + field.dyCells[i];
        totalDxCells[i] = totalDx;
        totalDyCells[i] = totalDy;
        const correctionDx = totalDx - runtimeXCells;
        const correctionDy = totalDy - runtimeYCells;
        correctionDxCells[i] = correctionDx;
        correctionDyCells[i] = correctionDy;
        const totalKey = `${totalDx * CELL_PX},${totalDy * CELL_PX}`;
        counts.set(totalKey, (counts.get(totalKey) || 0) + 1);
        const correctionKey = `${correctionDx * CELL_PX},${correctionDy * CELL_PX}`;
        correctionCounts.set(correctionKey, (correctionCounts.get(correctionKey) || 0) + 1);
      }
      const vectors = [...counts.entries()].map(([key, count]) => {
        const [dxPx, dyPx] = key.split(',').map(Number);
        return Object.freeze({ dxPx, dyPx, count });
      }).sort((a, b) => Math.max(Math.abs(a.dxPx), Math.abs(a.dyPx)) - Math.max(Math.abs(b.dxPx), Math.abs(b.dyPx)) ||
        a.dyPx - b.dyPx || a.dxPx - b.dxPx);
      const correctionVectors = [...correctionCounts.entries()].map(([key, count]) => {
        const [dxPx, dyPx] = key.split(',').map(Number);
        return Object.freeze({ dxPx, dyPx, count });
      }).sort((a, b) => Math.max(Math.abs(a.dxPx), Math.abs(a.dyPx)) - Math.max(Math.abs(b.dxPx), Math.abs(b.dyPx)) ||
        a.dyPx - b.dyPx || a.dxPx - b.dxPx);
      const classicPreviewYOffsetPx = classicPreviewYOffsetCells * CELL_PX;
      const classicPreviewWidth = Math.max(1, integer(classicPreviewRoom.widthTiles, classicPreview.width));
      const classicPreviewHeight = Math.max(1, integer(classicPreviewRoom.heightTiles, classicPreview.height));
      this.rooms.set(submap, Object.freeze({
        submap, mapId: integer(level.rdxMd), width: rdx.width, height: rdx.height,
        classicWidth: classic.width, classicHeight: classic.height,
        classicPreviewWidth, classicPreviewHeight, classicPreviewYOffsetPx,
        canonicalOffset: Object.freeze({ dxPx: integer(canonical.dxPx), dyPx: integer(canonical.dyPx) }),
        runtimeOffset: Object.freeze({ dxPx: integer(runtime.dxPx), dyPx: integer(runtime.dyPx) }),
        visualBaseOffset: Object.freeze({ dxPx: baseXCells * CELL_PX, dyPx: baseYCells * CELL_PX }),
        visualBaseBasis: visualBase.basis,
        canonicalAlignmentScore: visualBase.canonicalScore, runtimeAlignmentScore: visualBase.runtimeScore,
        totalDxCells, totalDyCells, correctionDxCells, correctionDyCells,
        localDxCells: new Int8Array(rdx.width * rdx.height), localDyCells: field.dyCells,
        confidence: field.confidence, coverage: field.coverage,
        reverseOriginX, reverseOriginY, reverseWidth, reverseHeight,
        reverseDxCells: new Int8Array(reverseWidth * reverseHeight), reverseDyCells: reverseField.dyCells,
        reverseConfidence: reverseField.confidence, reverseCoverage: reverseField.coverage,
        anchors: Object.freeze(anchors.map(anchor => Object.freeze({ x: anchor.x, y: anchor.rdxY, classicY: anchor.classicY + previewBaseYCells, dyPx: anchor.deltaCells * CELL_PX }))),
        mappedCellCount,
        shiftVectors: Object.freeze(vectors),
        correctionVectors: Object.freeze(correctionVectors)
      }));
    }
  }
  roomForSubmap(submap) { return this.rooms.get(integer(submap)) || null; }
  cell(submap, x, y) {
    const room = this.roomForSubmap(submap);
    const gx = integer(x, -1), gy = integer(y, -1);
    if (!room || gx < 0 || gy < 0 || gx >= room.width || gy >= room.height) return null;
    const i = gy * room.width + gx;
    if (!room.coverage[i]) return null;
    return Object.freeze({
      x: gx, y: gy, mapped: true,
      dxPx: room.totalDxCells[i] * CELL_PX, dyPx: room.totalDyCells[i] * CELL_PX,
      correctionDxPx: room.correctionDxCells[i] * CELL_PX, correctionDyPx: room.correctionDyCells[i] * CELL_PX,
      confidence: room.confidence[i] / 255
    });
  }
  atRdxPixel(submap, x, y) { return this.cell(submap, Math.floor(Number(x) / CELL_PX), Math.floor(Number(y) / CELL_PX)); }
  classicCell(submap, x, y) {
    const room = this.roomForSubmap(submap);
    if (!room) return null;
    const classicX = integer(x, -1), classicY = integer(y, Number.MIN_SAFE_INTEGER);
    const previewYOffsetCells = room.classicPreviewYOffsetPx / CELL_PX;
    const previewMinY = -previewYOffsetCells;
    const previewMaxY = previewMinY + room.classicPreviewHeight;
    if (classicX < 0 || classicX >= room.classicPreviewWidth || classicY < previewMinY || classicY >= previewMaxY) return null;
    const projectedX = classicX + room.runtimeOffset.dxPx / CELL_PX;
    const projectedY = classicY + room.runtimeOffset.dyPx / CELL_PX;
    const gx = projectedX - room.reverseOriginX, gy = projectedY - room.reverseOriginY;
    if (!Number.isInteger(gx) || !Number.isInteger(gy) || gx < 0 || gy < 0 || gx >= room.reverseWidth || gy >= room.reverseHeight) return null;
    const i = gy * room.reverseWidth + gx;
    if (!room.reverseCoverage[i]) return null;
    const localDxPx = room.reverseDxCells[i] * CELL_PX;
    const localDyPx = room.reverseDyCells[i] * CELL_PX;
    const dxPx = room.visualBaseOffset.dxPx + localDxPx;
    const dyPx = room.visualBaseOffset.dyPx + localDyPx;
    const correctionDxPx = dxPx - room.runtimeOffset.dxPx;
    const correctionDyPx = dyPx - room.runtimeOffset.dyPx;
    return Object.freeze({
      x: classicX, y: classicY, mapped: true,
      dxPx, dyPx, correctionDxPx, correctionDyPx,
      confidence: room.reverseConfidence[i] / 255
    });
  }
  atClassicPixel(submap, x, y) { return this.classicCell(submap, Math.floor(Number(x) / CELL_PX), Math.floor(Number(y) / CELL_PX)); }
  summary(submap) {
    const room = this.roomForSubmap(submap);
    if (!room) return Object.freeze({ mappedCells: 0, totalCells: 0, vectors: Object.freeze([]) });
    return Object.freeze({ mappedCells: room.mappedCellCount, totalCells: room.width * room.height, vectors: room.shiftVectors });
  }
  shiftEntries(submap) { return this.roomForSubmap(submap)?.shiftVectors || Object.freeze([]); }
  correctionEntries(submap) { return this.roomForSubmap(submap)?.correctionVectors || Object.freeze([]); }
  mapPresentationPixel(submap, x, y, sourceClassic) {
    const px = Number(x), py = Number(y);
    if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
    if (sourceClassic) {
      const sourceCell = this.atClassicPixel(submap, px, py);
      if (!sourceCell) return null;
      return Object.freeze({ x: px + sourceCell.dxPx, y: py + sourceCell.dyPx, sourceCell });
    }
    const sourceCell = this.atRdxPixel(submap, px, py);
    if (!sourceCell) return null;
    return Object.freeze({ x: px - sourceCell.dxPx, y: py - sourceCell.dyPx, sourceCell });
  }
  mapPreviewPixel(submap, x, y, sourceClassic) {
    const room = this.roomForSubmap(submap);
    const px = Number(x), py = Number(y);
    if (!room || !Number.isFinite(px) || !Number.isFinite(py)) return null;
    if (sourceClassic) {
      const canonicalY = py - room.classicPreviewYOffsetPx;
      const sourceCell = this.atClassicPixel(submap, px, canonicalY);
      const dxPx = sourceCell?.dxPx ?? room.visualBaseOffset.dxPx;
      const dyPx = sourceCell?.dyPx ?? room.visualBaseOffset.dyPx;
      return Object.freeze({
        x: px + dxPx, y: canonicalY + dyPx,
        sourceCell: sourceCell || null, fallback: !sourceCell
      });
    }
    const sourceCell = this.atRdxPixel(submap, px, py);
    const dxPx = sourceCell?.dxPx ?? room.visualBaseOffset.dxPx;
    const dyPx = sourceCell?.dyPx ?? room.visualBaseOffset.dyPx;
    return Object.freeze({
      x: px - dxPx, y: py - dyPx + room.classicPreviewYOffsetPx,
      sourceCell: sourceCell || null, fallback: !sourceCell
    });
  }
  previewSyncLayout(submap) {
    const room = this.roomForSubmap(submap);
    if (!room) return null;
    const classicWidthPx = room.classicPreviewWidth * CELL_PX;
    const classicHeightPx = room.classicPreviewHeight * CELL_PX;
    const rdxWidthPx = room.width * CELL_PX;
    const rdxHeightPx = room.height * CELL_PX;
    const rdxOriginX = -room.visualBaseOffset.dxPx;
    const rdxOriginY = room.classicPreviewYOffsetPx - room.visualBaseOffset.dyPx;
    let minX = Math.min(0, rdxOriginX);
    let minY = Math.min(0, rdxOriginY);
    let maxX = Math.max(classicWidthPx, rdxOriginX + rdxWidthPx);
    let maxY = Math.max(classicHeightPx, rdxOriginY + rdxHeightPx);
    for (let gy = 0; gy < room.height; gy += 1) for (let gx = 0; gx < room.width; gx += 1) {
      const index = gy * room.width + gx;
      if (!room.coverage[index]) continue;
      const mappedX = gx * CELL_PX - room.totalDxCells[index] * CELL_PX;
      const mappedY = gy * CELL_PX - room.totalDyCells[index] * CELL_PX + room.classicPreviewYOffsetPx;
      minX = Math.min(minX, mappedX);
      minY = Math.min(minY, mappedY);
      maxX = Math.max(maxX, mappedX + CELL_PX);
      maxY = Math.max(maxY, mappedY + CELL_PX);
    }
    const width = Math.max(1, Math.ceil(maxX - minX));
    const height = Math.max(1, Math.ceil(maxY - minY));
    return Object.freeze({
      width, height,
      bounds: Object.freeze({ minX, minY, maxX, maxY }),
      classic: Object.freeze({ originX: -minX, originY: -minY, width: classicWidthPx, height: classicHeightPx }),
      rdx: Object.freeze({ originX: rdxOriginX - minX, originY: rdxOriginY - minY, width: rdxWidthPx, height: rdxHeightPx })
    });
  }
  overlayForSubmap(submap) {
    const key = integer(submap, -1);
    if (this.overlayCache.has(key)) return this.overlayCache.get(key);
    const room = this.roomForSubmap(key);
    if (!room) return null;
    const width = room.width * CELL_PX, height = room.height * CELL_PX;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let gy = 0; gy < room.height; gy += 1) for (let gx = 0; gx < room.width; gx += 1) {
      const index = gy * room.width + gx;
      if (!room.coverage[index]) continue;
      const dxPx = room.totalDxCells[index] * CELL_PX, dyPx = room.totalDyCells[index] * CELL_PX;
      if (!dxPx && !dyPx) continue;
      const localDxPx = room.localDxCells[index] * CELL_PX, localDyPx = room.localDyCells[index] * CELL_PX;
      const magnitude = Math.max(Math.abs(dxPx), Math.abs(dyPx));
      const localMagnitude = Math.max(Math.abs(localDxPx), Math.abs(localDyPx));
      const rgba = dyPx < 0 ? [244, 88, 60] : dyPx > 0 ? [65, 150, 245] : [188, 92, 220];
      const alphaBase = localMagnitude ? 70 : 38;
      const alpha = Math.min(localMagnitude ? 136 : 88, alphaBase + Math.round(Math.min(48, magnitude) * (localMagnitude ? 1.35 : 0.9)));
      for (let py = 0; py < CELL_PX; py += 1) for (let px = 0; px < CELL_PX; px += 1) {
        const at = ((gy * CELL_PX + py) * width + gx * CELL_PX + px) * 4;
        data[at] = rgba[0]; data[at + 1] = rgba[1]; data[at + 2] = rgba[2];
        data[at + 3] = (px === 0 || py === 0) ? Math.min(160, alpha + 18) : alpha;
      }
    }
    const overlay = Object.freeze({ data, width, height });
    this.overlayCache.set(key, overlay);
    return overlay;
  }
  correctionForPresentationSwitch(snapshot, targetClassic) {
    const submap = integer(snapshot?.submap, -1);
    const room = this.roomForSubmap(submap);
    const rick = (snapshot?.entities || []).find(entity => integer(entity?.slot, -1) === E_RICK_SLOT);
    if (!room || !rick) return null;
    const classicX = integer(rick.x) + ENTITY_ORIGIN_X;
    const classicY = integer(snapshot?.cameraDeltaRows) * CELL_PX + integer(rick.y) + ENTITY_WORLD_Y_DELTA;
    if (targetClassic) {
      const rdxX = room.runtimeOffset.dxPx + classicX;
      const rdxY = room.runtimeOffset.dyPx + classicY;
      const sourceCell = this.atRdxPixel(submap, rdxX, rdxY);
      if (!sourceCell) return null;
      return Object.freeze({
        submap, sourceCell, worldX: rdxX, worldY: rdxY,
        dxPx: sourceCell.correctionDxPx ? -sourceCell.correctionDxPx : 0,
        dyPx: sourceCell.correctionDyPx ? -sourceCell.correctionDyPx : 0
      });
    }
    const sourceCell = this.atClassicPixel(submap, classicX, classicY);
    return sourceCell ? Object.freeze({
      submap, sourceCell, worldX: classicX, worldY: classicY,
      dxPx: sourceCell.correctionDxPx, dyPx: sourceCell.correctionDyPx
    }) : null;
  }
}
