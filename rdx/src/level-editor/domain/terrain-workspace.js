import {
  GAMEPLAY_CELL_SIZE,
  VISUAL_CELL_SIZE,
  familyById,
  hash32,
  materialById,
  materialForRole,
  materialSupportsFamily,
  motifById,
  normalizeTerrainIntent,
  sourceById,
  terrainKey
} from './terrain-model.js';
import { affectedTerrainKeys, analyzeTerrainTopology } from './terrain-topology.js';

const clone = value => value == null ? value : structuredClone(value);
const eq = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function chooseDeterministic(values, material) {
  if (!values?.length) return null;
  const index = hash32(material) % values.length;
  return values[index];
}

function orientationTurns(orientation) {
  return ({ north: 0, east: 1, south: 2, west: 3 }[String(orientation || 'north')] ?? 0);
}

export function transformMotifOffset(offset, orientation = 'north', mirrorX = false) {
  let [x, y] = offset.map(Number);
  if (mirrorX) x = -x;
  for (let turn = 0; turn < orientationTurns(orientation); turn += 1) [x, y] = [-y, x];
  return [x, y];
}

function materialForCell(catalog, group, cell) {
  const family = familyById(catalog, cell.familyId);
  const explicit = cell.materialId ? materialById(catalog, cell.materialId) : null;
  if (explicit && materialSupportsFamily(explicit, family?.id)) return explicit;
  return materialForRole(catalog, { group, role: family?.materialRole || '', familyId: family?.id || '' });
}

function sourceChoice(catalog, roomId, cell, topology, material) {
  if (cell.visual?.mode === 'pinned' && cell.visual?.sourceId) {
    const pinned = sourceById(catalog, cell.visual.sourceId);
    return { source: pinned, matchedRule: 'pinned', fallback: !pinned, fallbackReason: pinned ? null : 'missing-pinned-source' };
  }
  if (!material) return { source: null, matchedRule: null, fallback: true, fallbackReason: 'no-compatible-material' };
  for (const key of topology.variantKeys) {
    const ids = material.variants[key];
    if (!ids?.length) continue;
    const sourceId = chooseDeterministic(ids, `${roomId}:${cell.cell.join(',')}:${material.id}:${topology.key}:${key}`);
    return { source: sourceById(catalog, sourceId), matchedRule: key, fallback: key !== topology.key, fallbackReason: key === topology.key ? null : `topology-fallback:${key}` };
  }
  if (material.defaultVariants.length) {
    const sourceId = chooseDeterministic(material.defaultVariants, `${roomId}:${cell.cell.join(',')}:${material.id}:${topology.key}:default`);
    return { source: sourceById(catalog, sourceId), matchedRule: 'material-default', fallback: true, fallbackReason: 'material-default' };
  }
  return { source: null, matchedRule: null, fallback: true, fallbackReason: 'material-has-no-variant' };
}

function normalizeException(input) {
  if (!input) return null;
  const cell = Array.isArray(input.cell) ? input.cell.slice(0, 2).map(Number) : [NaN, NaN];
  if (!cell.every(Number.isInteger)) throw new Error('Gameplay exception requires an exact integer 8x8 cell');
  return Object.freeze({ cell: Object.freeze(cell), semantic: String(input.semantic || 'preserve'), reason: String(input.reason || '') });
}

function normalizePlacement(input) {
  if (!input) return null;
  return Object.freeze({
    id: String(input.id), motifId: String(input.motifId), origin: Object.freeze((input.origin || [0, 0]).slice(0, 2).map(Number)),
    orientation: String(input.orientation || 'north'), mirrorX: !!input.mirrorX, parameters: Object.freeze({ ...(input.parameters || {}) })
  });
}

export class TerrainWorkspace {
  constructor({ catalog, roomId = 'room', group = '', widthCells = 1, heightCells = 1, cells = [], gameplayExceptions = [], motifPlacements = [] } = {}) {
    if (!catalog) throw new TypeError('TerrainWorkspace requires normalized terrain resources');
    this.catalog = catalog;
    this.roomId = String(roomId || 'room');
    this.group = String(group || '');
    this.widthCells = Math.max(1, Number(widthCells) | 0);
    this.heightCells = Math.max(1, Number(heightCells) | 0);
    this.cells = new Map();
    this.resolved = new Map();
    this.gameplayExceptions = new Map();
    this.motifPlacements = new Map();
    for (const input of cells) {
      const [x, y] = input.cell || [];
      this.assertInBounds(x, y);
      this.cells.set(terrainKey(x, y), normalizeTerrainIntent(input, catalog, { group: this.group, x, y, preserveGameplay: input?.gameplay?.mode === 'preserve' }));
    }
    for (const input of gameplayExceptions) {
      const exception = normalizeException(input);
      this.gameplayExceptions.set(terrainKey(...exception.cell), exception);
    }
    for (const input of motifPlacements) {
      const placement = normalizePlacement(input);
      if (!motifById(catalog, placement.motifId)) throw new Error(`Unknown terrain motif '${placement.motifId}'`);
      this.motifPlacements.set(placement.id, placement);
    }
    this.recomputeAll();
  }

  assertInBounds(x, y) {
    if (!Number.isInteger(Number(x)) || !Number.isInteger(Number(y)) || Number(x) < 0 || Number(y) < 0 || Number(x) >= this.widthCells || Number(y) >= this.heightCells) {
      throw new RangeError(`Terrain cell ${x},${y} is outside ${this.widthCells}x${this.heightCells}`);
    }
  }

  cellAt(x, y) { return this.cells.get(terrainKey(x, y)) || null; }
  resolvedAt(x, y) { return this.resolved.get(terrainKey(x, y)) || null; }
  gameplayExceptionAt(x, y) { return this.gameplayExceptions.get(terrainKey(x, y)) || null; }
  listCells() { return [...this.cells.values()].sort((a, b) => a.cell[1] - b.cell[1] || a.cell[0] - b.cell[0]); }
  listResolved() { return this.listCells().map(cell => this.resolvedAt(...cell.cell)).filter(Boolean); }
  listGameplayExceptions() { return [...this.gameplayExceptions.values()].sort((a, b) => a.cell[1] - b.cell[1] || a.cell[0] - b.cell[0]); }
  listMotifPlacements() { return [...this.motifPlacements.values()].sort((a, b) => a.id.localeCompare(b.id)); }

  resolveCell(cell) {
    if (!cell) return null;
    const topologyAnalysis = analyzeTerrainTopology(this.catalog, cell, (x, y) => this.cellAt(x, y));
    const material = materialForCell(this.catalog, this.group, cell);
    const choice = sourceChoice(this.catalog, this.roomId, cell, topologyAnalysis.normalized, material);
    const family = familyById(this.catalog, cell.familyId);
    return Object.freeze({
      cell,
      family,
      material,
      topology: topologyAnalysis.normalized,
      observedNeighbors: topologyAnalysis.observedNeighbors,
      source: choice.source,
      explanation: Object.freeze({
        familyId: family?.id || null,
        observedConnectors: topologyAnalysis.normalized.connected,
        normalizedTopology: topologyAnalysis.normalized.key,
        matchedRule: choice.matchedRule,
        selectedVisualVariant: choice.source?.id || null,
        fallback: choice.fallback,
        fallbackReason: choice.fallbackReason,
        gameplayOperation: cell.gameplay?.mode === 'semantic' ? String(cell.gameplay.semantic) : 'preserve'
      })
    });
  }

  recomputeAll() {
    this.resolved.clear();
    for (const cell of this.cells.values()) this.resolved.set(terrainKey(...cell.cell), this.resolveCell(cell));
  }

  recomputeNeighborhood(keys) {
    const touched = new Set(keys || []);
    for (const key of touched) {
      const cell = this.cells.get(key);
      if (cell) this.resolved.set(key, this.resolveCell(cell));
      else this.resolved.delete(key);
    }
    return Object.freeze([...touched].map(key => this.resolved.get(key)).filter(Boolean));
  }

  applyChangeSet(changeSet, direction = 'after') {
    if (!changeSet || !['before', 'after'].includes(direction)) throw new TypeError('Terrain change set and direction are required');
    const changedCells = [];
    for (const change of changeSet.cellChanges || []) {
      const value = change[direction] || null;
      const [x, y] = change.cell;
      this.assertInBounds(x, y);
      if (value) this.cells.set(terrainKey(x, y), normalizeTerrainIntent(value, this.catalog, { group: this.group, x, y, preserveGameplay: value?.gameplay?.mode === 'preserve' }));
      else this.cells.delete(terrainKey(x, y));
      changedCells.push({ cell: [x, y] });
    }
    for (const change of changeSet.gameplayExceptionChanges || []) {
      const value = change[direction] || null, [x, y] = change.cell;
      if (value) this.gameplayExceptions.set(terrainKey(x, y), normalizeException(value));
      else this.gameplayExceptions.delete(terrainKey(x, y));
    }
    for (const change of changeSet.motifChanges || []) {
      const value = change[direction] || null;
      if (value) this.motifPlacements.set(change.id, normalizePlacement(value));
      else this.motifPlacements.delete(change.id);
    }
    const affected = affectedTerrainKeys(changedCells);
    this.recomputeNeighborhood([...affected].filter(key => {
      const [x, y] = key.split(',').map(Number);
      return x >= 0 && y >= 0 && x < this.widthCells && y < this.heightCells;
    }));
    return changeSet;
  }

  visualOperations() {
    const out = [];
    for (const resolved of this.listResolved()) {
      if (!resolved.source) continue;
      const [x, y] = resolved.cell.cell;
      for (const output of resolved.source.outputs) {
        const [ox, oy] = output.targetOffset || [0, 0], [sx, sy] = output.sourceCell;
        for (let qy = 0; qy < 2; qy += 1) for (let qx = 0; qx < 2; qx += 1) out.push(Object.freeze({
          kind: 'visual-map-cell-replacement',
          visualCell: Object.freeze([(x + ox) * 2 + qx, (y + oy) * 2 + qy]),
          sourceVisualCell: Object.freeze([sx * 2 + qx, sy * 2 + qy]),
          sourceMapId: output.sourceMapId, layer: output.layer, sourceLayer: output.sourceLayer,
          familyId: resolved.family.id, materialId: resolved.material?.id || null, sourceId: resolved.source.id,
          topology: resolved.topology.key
        }));
      }
    }
    for (const placement of this.motifPlacements.values()) out.push(...this.motifVisualOperations(placement));
    return Object.freeze(out);
  }

  motifVisualOperations(placement) {
    const motif = motifById(this.catalog, placement.motifId);
    if (!motif) return [];
    const out = [];
    for (const component of motif.components) {
      if (component.kind !== 'source-region') continue;
      const [dx, dy] = transformMotifOffset(component.offset, placement.orientation, placement.mirrorX);
      for (let ry = 0; ry < component.sizeCells[1]; ry += 1) for (let rx = 0; rx < component.sizeCells[0]; rx += 1) {
        const targetX = placement.origin[0] + dx + rx, targetY = placement.origin[1] + dy + ry;
        const sourceX = component.originCell[0] + (placement.mirrorX ? component.sizeCells[0] - 1 - rx : rx), sourceY = component.originCell[1] + ry;
        for (const plane of component.planes) for (let qy = 0; qy < 2; qy += 1) for (let qx = 0; qx < 2; qx += 1) out.push(Object.freeze({
          kind: 'visual-map-cell-replacement', authority: 'terrain-motif', motifPlacementId: placement.id, motifId: placement.motifId,
          visualCell: Object.freeze([targetX * 2 + qx, targetY * 2 + qy]), sourceVisualCell: Object.freeze([sourceX * 2 + qx, sourceY * 2 + qy]),
          sourceMapId: component.sourceMapId, layer: plane, sourceLayer: plane
        }));
      }
    }
    return out;
  }

  gameplayOperations() {
    const out = [];
    for (const cell of this.listCells()) if (cell.gameplay.mode === 'semantic' && cell.gameplay.semantic !== 'preserve') out.push(Object.freeze({
      kind: 'terrain-semantic-change',
      logicCell16: Object.freeze([cell.cell[0] + 1, cell.cell[1] + 1]),
      visualCell16: cell.cell,
      semantic: cell.gameplay.semantic,
      familyId: cell.familyId
    }));
    for (const exception of this.gameplayExceptions.values()) out.push(Object.freeze({
      kind: 'gameplay-cell-exception', gameplayCell8: exception.cell, semantic: exception.semantic, reason: exception.reason
    }));
    return Object.freeze(out);
  }

  explanationAt(x, y) { return this.resolvedAt(x, y)?.explanation || null; }

  dimensions() { return Object.freeze({ visualCellPx: VISUAL_CELL_SIZE, gameplayCellPx: GAMEPLAY_CELL_SIZE, widthCells: this.widthCells, heightCells: this.heightCells }); }
}

export function reviewedTerrainOperations(changeSet, workspace) {
  const out = [];
  for (const change of changeSet?.cellChanges || []) {
    const before = change.before || null, after = change.after || null;
    if (eq(before, after)) continue;
    const semanticChanged = !eq(before?.gameplay, after?.gameplay) || before?.familyId !== after?.familyId;
    const visualChanged = before?.materialId !== after?.materialId || !eq(before?.visual, after?.visual) || before?.familyId !== after?.familyId;
    const resolved = after ? workspace.resolvedAt(...change.cell) : null;
    if (visualChanged) out.push(Object.freeze({
      kind: semanticChanged ? 'structural-map-cell-replacement' : 'visual-map-cell-replacement',
      cell16: Object.freeze([...change.cell]), familyId: after?.familyId || null, materialId: after?.materialId || null, sourceId: resolved?.source?.id || after?.visual?.sourceId || null
    }));
    if (semanticChanged) out.push(Object.freeze({
      kind: 'terrain-semantic-change', logicCell16: Object.freeze([change.cell[0] + 1, change.cell[1] + 1]), semantic: after?.gameplay?.semantic || 'preserve', familyId: after?.familyId || null
    }));
  }
  for (const change of changeSet?.gameplayExceptionChanges || []) {
    const after = change.after || null;
    out.push(Object.freeze({ kind: 'gameplay-cell-exception', gameplayCell8: Object.freeze([...change.cell]), semantic: after?.semantic || 'preserve', reason: after?.reason || '', operation: after ? 'set' : 'remove' }));
  }
  return Object.freeze(out);
}
