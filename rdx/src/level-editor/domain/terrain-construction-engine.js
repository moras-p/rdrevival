import { createEditorCommand } from './command-history.js';
import {
  CARDINAL_DIRECTIONS,
  familyById,
  hash32,
  materialById,
  materialForRole,
  materialSupportsFamily,
  motifById,
  normalizeTerrainIntent,
  terrainKey
} from './terrain-model.js';
import { affectedTerrainKeys } from './terrain-topology.js';
import { transformMotifOffset } from './terrain-workspace.js';

const clone = value => value == null ? value : structuredClone(value);
const eq = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function point(value) {
  const out = Array.isArray(value) ? value.slice(0, 2).map(Number) : [NaN, NaN];
  if (!out.every(Number.isInteger)) throw new TypeError(`Expected integer terrain cell, received ${value}`);
  return out;
}

function lineCells(start, end) {
  let [x0, y0] = point(start), [x1, y1] = point(end);
  const cells = [], dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  while (true) {
    cells.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const twice = 2 * error;
    if (twice >= dy) { error += dy; x0 += sx; }
    if (twice <= dx) { error += dx; y0 += sy; }
  }
  return cells;
}

function uniqueCells(cells) {
  const byKey = new Map();
  for (const cell of cells || []) { const [x, y] = point(cell); byKey.set(terrainKey(x, y), [x, y]); }
  return [...byKey.values()];
}

function changeSet(label, cellChanges = [], gameplayExceptionChanges = [], motifChanges = [], metadata = {}) {
  const payload = { label, cellChanges, gameplayExceptionChanges, motifChanges, metadata };
  return Object.freeze({
    id: `terrain:${hash32(JSON.stringify(payload)).toString(16).padStart(8, '0')}`,
    label: String(label || 'Terrain edit'),
    cellChanges: Object.freeze(cellChanges.map(change => Object.freeze({ cell: Object.freeze([...change.cell]), before: clone(change.before), after: clone(change.after) }))),
    gameplayExceptionChanges: Object.freeze(gameplayExceptionChanges.map(change => Object.freeze({ cell: Object.freeze([...change.cell]), before: clone(change.before), after: clone(change.after) }))),
    motifChanges: Object.freeze(motifChanges.map(change => Object.freeze({ id: String(change.id), before: clone(change.before), after: clone(change.after) }))),
    metadata: Object.freeze({ ...metadata })
  });
}

function workspaceFrom(context) {
  if (context?.applyChangeSet && context?.cellAt) return context;
  const workspace = context?.terrainWorkspace || context?.terrain || null;
  if (!workspace?.applyChangeSet) throw new TypeError('Terrain command context requires terrainWorkspace');
  return workspace;
}

export function createTerrainCommand(change) {
  if (!change?.id) throw new TypeError('Terrain change set requires an id');
  return createEditorCommand({
    id: change.id,
    label: change.label,
    execute(context) { workspaceFrom(context).applyChangeSet(change, 'after'); },
    undo(context) { workspaceFrom(context).applyChangeSet(change, 'before'); }
  });
}

function intentFromOptions(workspace, [x, y], options, current = null) {
  const familyId = String(options?.familyId || current?.familyId || '');
  if (!familyById(workspace.catalog, familyId)) throw new Error(`Unknown terrain family '${familyId}'`);
  const familyChanged = !!current && current.familyId !== familyId;
  const hasMaterial = options && Object.prototype.hasOwnProperty.call(options, 'materialId');
  const hasVisual = options && Object.prototype.hasOwnProperty.call(options, 'visual');
  const hasGameplay = options && Object.prototype.hasOwnProperty.call(options, 'gameplay');
  return normalizeTerrainIntent({
    familyId,
    materialId: hasMaterial ? options.materialId : (familyChanged ? null : current?.materialId ?? null),
    materialRole: options?.materialRole,
    visual: hasVisual ? options.visual : (familyChanged ? undefined : current?.visual),
    gameplay: hasGameplay ? options.gameplay : (familyChanged ? undefined : current?.gameplay),
    motifOwner: options?.motifOwner ?? current?.motifOwner ?? null
  }, workspace.catalog, { group: workspace.group, x, y, preserveGameplay: options?.preserveGameplay === true || (!familyChanged && current?.gameplay?.mode === 'preserve') });
}

function planCellSet(workspace, cells, options, label, metadata = {}) {
  const changes = [];
  for (const [x, y] of uniqueCells(cells)) {
    workspace.assertInBounds(x, y);
    const before = workspace.cellAt(x, y), after = intentFromOptions(workspace, [x, y], options, before);
    if (!eq(before, after)) changes.push({ cell: [x, y], before, after });
  }
  return changeSet(label, changes, [], [], metadata);
}

function cellMatches(cell, match) {
  if (typeof match === 'function') return !!match(cell);
  if (match === null) return cell === null;
  if (!match || typeof match !== 'object') return false;
  if (match.empty === true && cell) return false;
  if (match.empty === false && !cell) return false;
  if (match.familyId != null && cell?.familyId !== String(match.familyId)) return false;
  if (match.materialId != null && cell?.materialId !== String(match.materialId)) return false;
  if (match.gameplaySemantic != null && cell?.gameplay?.semantic !== String(match.gameplaySemantic)) return false;
  return true;
}

function boundedCells(workspace, bounds = null) {
  const x0 = Math.max(0, Number(bounds?.x ?? 0) | 0), y0 = Math.max(0, Number(bounds?.y ?? 0) | 0);
  const x1 = Math.min(workspace.widthCells - 1, Number(bounds?.x2 ?? (bounds?.width != null ? x0 + Number(bounds.width) - 1 : workspace.widthCells - 1)) | 0);
  const y1 = Math.min(workspace.heightCells - 1, Number(bounds?.y2 ?? (bounds?.height != null ? y0 + Number(bounds.height) - 1 : workspace.heightCells - 1)) | 0);
  const cells = [];
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) cells.push([x, y]);
  return cells;
}

function motifParameter(motif, name, requested) {
  const spec = motif.parameters?.[name];
  if (!spec) return Math.max(1, Number(requested ?? 1) | 0);
  const value = Number(requested ?? spec.default) | 0;
  return Math.min(spec.max, Math.max(spec.min, value));
}

function motifTerrainCells(workspace, motif, origin, { orientation = 'north', mirrorX = false, parameters = {}, placementId } = {}) {
  const out = [];
  for (const component of motif.components) {
    if (component.kind === 'terrain-cell') {
      const [dx, dy] = transformMotifOffset(component.offset, orientation, mirrorX);
      out.push({ cell: [origin[0] + dx, origin[1] + dy], component });
    } else if (component.kind === 'terrain-run') {
      const length = motifParameter(motif, component.lengthParameter, parameters[component.lengthParameter] ?? component.defaultLength);
      for (let index = 0; index < length; index += 1) {
        const local = [component.offset[0] + (component.axis === 'horizontal' ? index : 0), component.offset[1] + (component.axis === 'vertical' ? index : 0)];
        const [dx, dy] = transformMotifOffset(local, orientation, mirrorX);
        out.push({ cell: [origin[0] + dx, origin[1] + dy], component });
      }
    }
  }
  return out.map(row => {
    const family = familyById(workspace.catalog, row.component.familyId);
    let materialId = row.component.materialId || null;
    if (!materialId && row.component.materialRole) materialId = materialForRole(workspace.catalog, { group: workspace.group, role: row.component.materialRole, familyId: family.id })?.id || null;
    return { cell: row.cell, options: { familyId: family.id, materialId, materialRole: row.component.materialRole, motifOwner: placementId } };
  });
}

export class TerrainConstructionEngine {
  smartPaint(workspace, cell, options) { return planCellSet(workspace, [point(cell)], options, 'Smart terrain paint', { operation: 'paint' }); }

  line(workspace, start, end, options) { return planCellSet(workspace, lineCells(start, end), options, 'Terrain line', { operation: 'line' }); }

  path(workspace, points, options) {
    const rows = (points || []).map(point);
    if (!rows.length) return changeSet('Terrain path', [], [], [], { operation: 'path' });
    const cells = [rows[0]];
    for (let index = 1; index < rows.length; index += 1) cells.push(...lineCells(rows[index - 1], rows[index]).slice(1));
    return planCellSet(workspace, cells, options, 'Terrain path', { operation: 'path' });
  }

  rectangle(workspace, start, end, options, { fill = false } = {}) {
    const [ax, ay] = point(start), [bx, by] = point(end), x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by), cells = [];
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) if (fill || x === x0 || x === x1 || y === y0 || y === y1) cells.push([x, y]);
    return planCellSet(workspace, cells, options, fill ? 'Filled terrain rectangle' : 'Terrain rectangle', { operation: fill ? 'rectangle-fill' : 'rectangle-outline' });
  }

  floodFill(workspace, start, options, { match = undefined } = {}) {
    const [sx, sy] = point(start); workspace.assertInBounds(sx, sy);
    const seed = workspace.cellAt(sx, sy);
    const matcher = match === undefined ? (cell => cell?.familyId === seed?.familyId && cell?.materialId === seed?.materialId && (!!cell === !!seed)) : (cell => cellMatches(cell, match));
    const queue = [[sx, sy]], seen = new Set([terrainKey(sx, sy)]), cells = [];
    while (queue.length) {
      const [x, y] = queue.shift(), current = workspace.cellAt(x, y);
      if (!matcher(current)) continue;
      cells.push([x, y]);
      for (const direction of CARDINAL_DIRECTIONS) {
        const nx = x + direction.dx, ny = y + direction.dy, key = terrainKey(nx, ny);
        if (nx < 0 || ny < 0 || nx >= workspace.widthCells || ny >= workspace.heightCells || seen.has(key)) continue;
        seen.add(key); queue.push([nx, ny]);
      }
    }
    return planCellSet(workspace, cells, options, 'Terrain flood fill', { operation: 'flood-fill', sourceCell: [sx, sy] });
  }

  replace(workspace, match, options, { bounds = null } = {}) {
    const cells = boundedCells(workspace, bounds).filter(([x, y]) => cellMatches(workspace.cellAt(x, y), match));
    return planCellSet(workspace, cells, options, 'Replace terrain', { operation: 'replace' });
  }

  visualReplacement(workspace, cell, { materialId = null, sourceId = null } = {}) {
    const [x, y] = point(cell), before = workspace.cellAt(x, y);
    if (!before) throw new Error(`Cannot change presentation of empty terrain cell ${x},${y}`);
    if (materialId) {
      const material = materialById(workspace.catalog, materialId);
      if (!material || !materialSupportsFamily(material, before.familyId)) throw new Error(`Material '${materialId}' does not support '${before.familyId}'`);
    }
    const after = intentFromOptions(workspace, [x, y], {
      familyId: before.familyId,
      materialId: materialId ?? before.materialId,
      visual: sourceId ? { mode: 'pinned', sourceId } : { mode: 'auto', sourceId: null },
      gameplay: before.gameplay,
      preserveGameplay: before.gameplay.mode === 'preserve'
    }, before);
    return changeSet('Terrain visual replacement', eq(before, after) ? [] : [{ cell: [x, y], before, after }], [], [], { operation: 'visual-replacement' });
  }

  semanticChange(workspace, cell, options) { return planCellSet(workspace, [point(cell)], options, 'Terrain semantic change', { operation: 'semantic-change' }); }

  gameplayException(workspace, gameplayCell8, semantic, { reason = '' } = {}) {
    return this.gameplayExceptions(workspace, [gameplayCell8], semantic, { reason });
  }

  gameplayExceptions(workspace, gameplayCells8, semantic, { reason = '' } = {}) {
    const seen = new Set(), changes = [];
    for (const item of gameplayCells8 || []) {
      const [x, y] = point(item), key = `${x},${y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const before = workspace.gameplayExceptionAt(x, y), after = semantic == null ? null : { cell:[x, y], semantic:String(semantic), reason:String(reason) };
      if (!eq(before, after)) changes.push({ cell:[x, y], before, after });
    }
    return changeSet('Exact 8x8 gameplay exceptions', [], changes, [], { operation:'gameplay-exception' });
  }

  erase(workspace, cell) { return this.eraseCells(workspace, [cell]); }

  eraseCells(workspace, cells) {
    const seen = new Set(), changes = [];
    for (const item of cells || []) {
      const [x, y] = point(item), key = `${x},${y}`;
      if (seen.has(key)) continue;
      seen.add(key); workspace.assertInBounds(x, y);
      const before = workspace.cellAt(x, y);
      if (before) changes.push({ cell:[x, y], before, after:null });
    }
    return changeSet('Erase terrain', changes, [], [], { operation:'erase' });
  }

  repair(workspace, { familyId = null, materialId = null, bounds = null } = {}) {
    const candidates = boundedCells(workspace, bounds), repairs = new Map();
    for (const [x, y] of candidates) {
      const cell = workspace.cellAt(x, y); if (!cell) continue;
      if (familyId && cell.familyId !== String(familyId)) continue;
      if (materialId && cell.materialId !== String(materialId)) continue;
      const family = familyById(workspace.catalog, cell.familyId);
      for (const direction of CARDINAL_DIRECTIONS) {
        if (!family.connectorAxes.includes(direction.axis)) continue;
        const mx = x + direction.dx, my = y + direction.dy, tx = x + direction.dx * 2, ty = y + direction.dy * 2;
        if (mx < 0 || my < 0 || tx < 0 || ty < 0 || mx >= workspace.widthCells || my >= workspace.heightCells || tx >= workspace.widthCells || ty >= workspace.heightCells) continue;
        if (workspace.cellAt(mx, my)) continue;
        const target = workspace.cellAt(tx, ty), targetFamily = target ? familyById(workspace.catalog, target.familyId) : null;
        if (!target || targetFamily?.connectorGroup !== family.connectorGroup) continue;
        repairs.set(terrainKey(mx, my), { cell: [mx, my], source: cell });
      }
    }
    const changes = [];
    for (const { cell: [x, y], source } of repairs.values()) {
      const after = intentFromOptions(workspace, [x, y], { familyId: source.familyId, materialId: source.materialId, gameplay: source.gameplay, visual: { mode: 'auto', sourceId: null } }, null);
      changes.push({ cell: [x, y], before: null, after });
    }
    return changeSet('Repair terrain connectors', changes, [], [], { operation: 'repair', repairedCells: changes.map(change => change.cell) });
  }

  motif(workspace, motifId, origin, { orientation = 'north', mirrorX = false, parameters = {} } = {}) {
    const motif = motifById(workspace.catalog, motifId); if (!motif) throw new Error(`Unknown terrain motif '${motifId}'`);
    const base = point(origin), placementId = `motif:${hash32(`${workspace.roomId}:${motif.id}:${base.join(',')}:${orientation}:${mirrorX}:${JSON.stringify(parameters)}`).toString(16).padStart(8, '0')}`;
    const rows = motifTerrainCells(workspace, motif, base, { orientation, mirrorX, parameters, placementId }), byKey = new Map();
    for (const row of rows) {
      workspace.assertInBounds(...row.cell);
      byKey.set(terrainKey(...row.cell), row);
    }
    const cellChanges = [];
    for (const row of byKey.values()) {
      const before = workspace.cellAt(...row.cell), after = intentFromOptions(workspace, row.cell, row.options, before);
      if (!eq(before, after)) cellChanges.push({ cell: row.cell, before, after });
    }
    const placement = { id: placementId, motifId: motif.id, origin: base, orientation: String(orientation), mirrorX: !!mirrorX, parameters: { ...parameters } };
    return changeSet(`Apply motif: ${motif.label}`, cellChanges, [], [{ id: placementId, before: workspace.motifPlacements.get(placementId) || null, after: placement }], { operation: 'motif', motifId: motif.id });
  }

  recompute(workspace, cells) {
    const inputs = uniqueCells(cells).map(([x, y]) => ({ cell: [x, y] }));
    const keys = [...affectedTerrainKeys(inputs)].filter(key => {
      const [x, y] = key.split(',').map(Number);
      return x >= 0 && y >= 0 && x < workspace.widthCells && y < workspace.heightCells;
    });
    workspace.recomputeNeighborhood(keys);
    return Object.freeze(keys.map(key => workspace.resolved.get(key)?.explanation).filter(Boolean));
  }

  validateConnectors(workspace) {
    const issues = [];
    for (const cell of workspace.listCells()) {
      const family = familyById(workspace.catalog, cell.familyId), material = cell.materialId ? materialById(workspace.catalog, cell.materialId) : null, resolved = workspace.resolvedAt(...cell.cell);
      if (material && !materialSupportsFamily(material, family.id)) issues.push(Object.freeze({ severity: 'error', code: 'MATERIAL_FAMILY', cell: cell.cell, message: `Material '${material.id}' does not support '${family.id}'.` }));
      for (const direction of CARDINAL_DIRECTIONS) {
        const neighbor = workspace.cellAt(cell.cell[0] + direction.dx, cell.cell[1] + direction.dy); if (!neighbor) continue;
        const neighborFamily = familyById(workspace.catalog, neighbor.familyId);
        if (neighborFamily.connectorGroup === family.connectorGroup && (!family.connectorAxes.includes(direction.axis) || !neighborFamily.connectorAxes.includes(direction.axis))) issues.push(Object.freeze({ severity: 'warning', code: 'AXIS_CONNECTOR_MISMATCH', cell: cell.cell, neighbor: neighbor.cell, direction: direction.id, message: `${family.id} touches compatible ${neighborFamily.id} on disallowed ${direction.axis} axis.` }));
      }
      if (family.topologyMode === 'path' && resolved?.topology.degree > 2) issues.push(Object.freeze({ severity: 'warning', code: 'PATH_BRANCH', cell: cell.cell, topology: resolved.topology.key, message: `${family.id} forms a branching path (${resolved.topology.key}).` }));
      if (family.topologyMode === 'path' && resolved?.topology.degree < 2) issues.push(Object.freeze({ severity: 'info', code: 'PATH_ENDPOINT', cell: cell.cell, topology: resolved.topology.key, message: `${family.id} has an open endpoint.` }));
    }
    return Object.freeze(issues);
  }
}

export { lineCells };
