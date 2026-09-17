import { CARDINAL_DIRECTIONS, DIAGONAL_DIRECTIONS, familyById, terrainKey } from './terrain-model.js';

const DIRECTION_BY_ID = new Map(CARDINAL_DIRECTIONS.map(direction => [direction.id, direction]));
const ADJACENT_PAIRS = Object.freeze([
  Object.freeze({ id: 'ne', sides: ['n', 'e'], diagonalBit: 1 }),
  Object.freeze({ id: 'es', sides: ['e', 's'], diagonalBit: 2 }),
  Object.freeze({ id: 'sw', sides: ['s', 'w'], diagonalBit: 4 }),
  Object.freeze({ id: 'nw', sides: ['w', 'n'], diagonalBit: 8 })
]);

function allows(family, direction) { return !!family && family.connectorAxes.includes(direction.axis); }
function sameConnectorGroup(a, b) { return !!a && !!b && a.connectorGroup === b.connectorGroup; }

export function terrainCellsConnect(catalog, cellA, cellB, directionId) {
  const direction = DIRECTION_BY_ID.get(String(directionId));
  if (!direction || !cellA || !cellB) return false;
  const familyA = familyById(catalog, cellA.familyId), familyB = familyById(catalog, cellB.familyId);
  return sameConnectorGroup(familyA, familyB) && allows(familyA, direction) && allows(familyB, DIRECTION_BY_ID.get(direction.opposite));
}

function diagonalCompatible(catalog, cellA, cellB) {
  if (!cellA || !cellB) return false;
  return sameConnectorGroup(familyById(catalog, cellA.familyId), familyById(catalog, cellB.familyId));
}

function maskDirections(mask) { return CARDINAL_DIRECTIONS.filter(direction => (mask & direction.bit) !== 0).map(direction => direction.id); }
function missingDirections(mask) { return CARDINAL_DIRECTIONS.filter(direction => (mask & direction.bit) === 0).map(direction => direction.id); }

function surfaceLabels(mask) {
  const labels = [];
  if (!(mask & 1)) labels.push('floor');
  if (!(mask & 4)) labels.push('ceiling');
  if (!(mask & 8)) labels.push('vertical-edge:w');
  if (!(mask & 2)) labels.push('vertical-edge:e');
  return labels;
}

export function classifyTerrainTopology(cardinalMask, diagonalMask = 0) {
  const mask = Number(cardinalMask) & 15, diagonals = Number(diagonalMask) & 15;
  const connected = maskDirections(mask), missing = missingDirections(mask), degree = connected.length;
  const insideCorners = ADJACENT_PAIRS.filter(pair => pair.sides.every(side => connected.includes(side)) && !(diagonals & pair.diagonalBit)).map(pair => pair.id);
  let shape = 'junction', orientation = '';
  if (degree === 0) shape = 'isolated';
  else if (degree === 1) { shape = 'end'; [orientation] = connected; }
  else if (degree === 2) {
    if ((mask === 5) || (mask === 10)) shape = mask === 5 ? 'vertical-edge' : 'horizontal-edge';
    else {
      shape = 'outside-corner';
      orientation = ADJACENT_PAIRS.find(pair => pair.sides.every(side => connected.includes(side)))?.id || connected.join('');
    }
  } else if (degree === 3) {
    shape = 'tee';
    [orientation] = missing;
  } else if (degree === 4) {
    if (insideCorners.length) { shape = 'inside-corner'; orientation = insideCorners.join('+'); }
    else shape = 'filler';
  }
  const key = orientation ? `${shape}:${orientation}` : shape;
  const variantKeys = [key];
  if (shape !== key) variantKeys.push(shape);
  for (const label of surfaceLabels(mask)) if (!variantKeys.includes(label)) variantKeys.push(label);
  variantKeys.push('default');
  return Object.freeze({
    cardinalMask: mask,
    diagonalMask: diagonals,
    degree,
    connected: Object.freeze(connected),
    missing: Object.freeze(missing),
    shape,
    orientation,
    key,
    insideCorners: Object.freeze(insideCorners),
    surfaces: Object.freeze(surfaceLabels(mask)),
    variantKeys: Object.freeze(variantKeys)
  });
}

export function analyzeTerrainTopology(catalog, cell, cellAt) {
  if (!cell) return null;
  const [x, y] = cell.cell;
  let cardinalMask = 0, diagonalMask = 0;
  const observedNeighbors = {};
  for (const direction of CARDINAL_DIRECTIONS) {
    const neighbor = cellAt(x + direction.dx, y + direction.dy) || null;
    const connects = terrainCellsConnect(catalog, cell, neighbor, direction.id);
    if (connects) cardinalMask |= direction.bit;
    observedNeighbors[direction.id] = Object.freeze({
      cell: neighbor?.cell ? Object.freeze([...neighbor.cell]) : null,
      familyId: neighbor?.familyId || null,
      connectorGroup: neighbor ? familyById(catalog, neighbor.familyId)?.connectorGroup || null : null,
      connects
    });
  }
  for (const diagonal of DIAGONAL_DIRECTIONS) {
    const neighbor = cellAt(x + diagonal.dx, y + diagonal.dy) || null;
    if (diagonalCompatible(catalog, cell, neighbor)) diagonalMask |= diagonal.bit;
  }
  const normalized = classifyTerrainTopology(cardinalMask, diagonalMask);
  return Object.freeze({
    cell: Object.freeze([x, y]),
    familyId: cell.familyId,
    observedNeighbors: Object.freeze(observedNeighbors),
    normalized
  });
}

export function affectedTerrainKeys(cells) {
  const keys = new Set();
  for (const cell of cells || []) {
    if (!cell?.cell) continue;
    const [x, y] = cell.cell;
    keys.add(terrainKey(x, y));
    for (const direction of [...CARDINAL_DIRECTIONS, ...DIAGONAL_DIRECTIONS]) keys.add(terrainKey(x + direction.dx, y + direction.dy));
  }
  return keys;
}
