export const TERRAIN_RESOURCE_SCHEMA = 'rdr.level_editor.terrain_resources.v1';
export const VISUAL_CELL_SIZE = 16;
export const GAMEPLAY_CELL_SIZE = 8;

export const CARDINAL_DIRECTIONS = Object.freeze([
  Object.freeze({ id: 'n', dx: 0, dy: -1, bit: 1, opposite: 's', axis: 'vertical' }),
  Object.freeze({ id: 'e', dx: 1, dy: 0, bit: 2, opposite: 'w', axis: 'horizontal' }),
  Object.freeze({ id: 's', dx: 0, dy: 1, bit: 4, opposite: 'n', axis: 'vertical' }),
  Object.freeze({ id: 'w', dx: -1, dy: 0, bit: 8, opposite: 'e', axis: 'horizontal' })
]);

export const DIAGONAL_DIRECTIONS = Object.freeze([
  Object.freeze({ id: 'ne', dx: 1, dy: -1, bit: 1, sides: ['n', 'e'] }),
  Object.freeze({ id: 'se', dx: 1, dy: 1, bit: 2, sides: ['s', 'e'] }),
  Object.freeze({ id: 'sw', dx: -1, dy: 1, bit: 4, sides: ['s', 'w'] }),
  Object.freeze({ id: 'nw', dx: -1, dy: -1, bit: 8, sides: ['n', 'w'] })
]);

const AXES = new Set(['horizontal', 'vertical']);
const GAMEPLAY_MODES = new Set(['semantic', 'preserve']);
const VISUAL_MODES = new Set(['auto', 'pinned']);
const clone = value => value == null ? value : structuredClone(value);
const asInt = value => Number.isInteger(Number(value)) ? Number(value) : null;
const pair = (value, fallback = [0, 0]) => Array.isArray(value) && value.length >= 2 && value.slice(0, 2).every(v => asInt(v) !== null)
  ? value.slice(0, 2).map(Number)
  : [...fallback];

export function terrainKey(x, y) { return `${Number(x)},${Number(y)}`; }
export function parseTerrainKey(value) { return String(value).split(',').slice(0, 2).map(Number); }

export function hash32(value) {
  let hash = 2166136261 >>> 0;
  for (const ch of String(value)) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function normalizeFamily(input, index) {
  const axes = [...new Set((Array.isArray(input?.connectorAxes) ? input.connectorAxes : ['horizontal', 'vertical']).map(String).filter(axis => AXES.has(axis)))];
  if (!axes.length) throw new Error(`Terrain family ${input?.id || index} has no connector axes`);
  return Object.freeze({
    id: String(input?.id || `family-${index}`),
    label: String(input?.label || input?.id || `Family ${index + 1}`),
    connectorGroup: String(input?.connectorGroup || input?.id || `family-${index}`),
    connectorAxes: Object.freeze(axes),
    gameplaySemantic: String(input?.gameplaySemantic || 'preserve'),
    materialRole: String(input?.materialRole || input?.id || `family-${index}`),
    topologyMode: String(input?.topologyMode || 'surface'),
    description: String(input?.description || '')
  });
}

function normalizeSource(input, index) {
  const outputs = (Array.isArray(input?.outputs) ? input.outputs : []).map((output, outputIndex) => {
    const sourceMapId = asInt(output?.sourceMapId);
    const sourceCell = pair(output?.sourceCell, [NaN, NaN]);
    if (sourceMapId === null || sourceCell.some(value => !Number.isInteger(value))) throw new Error(`Terrain source ${input?.id || index} output ${outputIndex} has invalid source coordinates`);
    const sourceLayer = ['A', 'B'].includes(String(output?.sourceLayer || output?.layer || 'B').toUpperCase()) ? String(output?.sourceLayer || output?.layer || 'B').toUpperCase() : 'B';
    const layer = ['A', 'B'].includes(String(output?.layer || sourceLayer).toUpperCase()) ? String(output?.layer || sourceLayer).toUpperCase() : sourceLayer;
    return Object.freeze({ sourceMapId, sourceCell: Object.freeze(sourceCell), sourceLayer, layer, targetOffset: Object.freeze(pair(output?.targetOffset)) });
  });
  if (!outputs.length) throw new Error(`Terrain source ${input?.id || index} requires at least one output`);
  return Object.freeze({ id: String(input?.id || `source-${index}`), outputs: Object.freeze(outputs), provenance: String(input?.provenance || '') });
}

function normalizeMaterial(input, index) {
  const familyIds = Object.freeze((Array.isArray(input?.familyIds) ? input.familyIds : []).map(String));
  const variants = {};
  for (const [topology, ids] of Object.entries(input?.variants || {})) {
    const refs = (Array.isArray(ids) ? ids : [ids]).filter(Boolean).map(String);
    if (refs.length) variants[String(topology)] = Object.freeze(refs);
  }
  const defaults = (Array.isArray(input?.defaultVariants) ? input.defaultVariants : []).filter(Boolean).map(String);
  return Object.freeze({
    id: String(input?.id || `material-${index}`),
    label: String(input?.label || input?.id || `Material ${index + 1}`),
    group: String(input?.group || ''),
    role: String(input?.role || ''),
    familyIds,
    variants: Object.freeze(variants),
    defaultVariants: Object.freeze(defaults),
    legacySetId: input?.legacySetId ? String(input.legacySetId) : null,
    description: String(input?.description || '')
  });
}

function normalizeMotifComponent(component, motifId, index) {
  const kind = String(component?.kind || 'terrain-cell');
  if (kind === 'terrain-cell') {
    return Object.freeze({ kind, offset: Object.freeze(pair(component?.offset)), familyId: String(component?.familyId || ''), materialId: component?.materialId ? String(component.materialId) : null, materialRole: component?.materialRole ? String(component.materialRole) : null });
  }
  if (kind === 'terrain-run') {
    const axis = String(component?.axis || 'horizontal');
    if (!AXES.has(axis)) throw new Error(`Motif ${motifId} component ${index} has invalid run axis`);
    return Object.freeze({ kind, offset: Object.freeze(pair(component?.offset)), axis, familyId: String(component?.familyId || ''), materialId: component?.materialId ? String(component.materialId) : null, materialRole: component?.materialRole ? String(component.materialRole) : null, lengthParameter: String(component?.lengthParameter || 'length'), defaultLength: Math.max(1, asInt(component?.defaultLength) ?? 1) });
  }
  if (kind === 'source-region') {
    const sourceMapId = asInt(component?.sourceMapId);
    if (sourceMapId === null) throw new Error(`Motif ${motifId} component ${index} has invalid source map`);
    return Object.freeze({ kind, offset: Object.freeze(pair(component?.offset)), sourceMapId, originCell: Object.freeze(pair(component?.originCell)), sizeCells: Object.freeze(pair(component?.sizeCells, [1, 1]).map(value => Math.max(1, value))), planes: Object.freeze((Array.isArray(component?.planes) ? component.planes : ['B']).map(value => String(value).toUpperCase()).filter(value => ['A', 'B'].includes(value))) });
  }
  throw new Error(`Motif ${motifId} has unsupported component kind '${kind}'`);
}

function normalizeMotif(input, index) {
  const id = String(input?.id || `motif-${index}`);
  const parameters = {};
  for (const [name, spec] of Object.entries(input?.parameters || {})) {
    parameters[name] = Object.freeze({ min: Math.max(1, asInt(spec?.min) ?? 1), max: Math.max(1, asInt(spec?.max) ?? 64), default: Math.max(1, asInt(spec?.default) ?? 1) });
  }
  return Object.freeze({
    id,
    label: String(input?.label || id),
    group: String(input?.group || ''),
    category: String(input?.category || 'terrain'),
    description: String(input?.description || ''),
    parameters: Object.freeze(parameters),
    components: Object.freeze((Array.isArray(input?.components) ? input.components : []).map((component, componentIndex) => normalizeMotifComponent(component, id, componentIndex)))
  });
}

function uniqueById(rows, label) {
  const ids = new Set();
  for (const row of rows) {
    if (ids.has(row.id)) throw new Error(`Duplicate ${label} id '${row.id}'`);
    ids.add(row.id);
  }
}

export function normalizeTerrainResources(input) {
  const source = clone(input || {});
  if (source.schema !== TERRAIN_RESOURCE_SCHEMA) throw new Error(`Unsupported terrain resource schema ${source.schema || 'missing'}`);
  const families = (Array.isArray(source.families) ? source.families : []).map(normalizeFamily);
  const sources = (Array.isArray(source.sources) ? source.sources : []).map(normalizeSource);
  const materials = (Array.isArray(source.materials) ? source.materials : []).map(normalizeMaterial);
  const motifs = (Array.isArray(source.motifs) ? source.motifs : []).map(normalizeMotif);
  uniqueById(families, 'terrain family'); uniqueById(sources, 'terrain source'); uniqueById(materials, 'terrain material'); uniqueById(motifs, 'terrain motif');
  const familyIds = new Set(families.map(row => row.id)), sourceIds = new Set(sources.map(row => row.id));
  for (const material of materials) {
    for (const familyId of material.familyIds) if (!familyIds.has(familyId)) throw new Error(`Material '${material.id}' references unknown family '${familyId}'`);
    for (const ids of [...Object.values(material.variants), material.defaultVariants]) for (const sourceId of ids) if (!sourceIds.has(sourceId)) throw new Error(`Material '${material.id}' references unknown source '${sourceId}'`);
  }
  for (const motif of motifs) for (const component of motif.components) if (component.familyId && !familyIds.has(component.familyId)) throw new Error(`Motif '${motif.id}' references unknown family '${component.familyId}'`);
  return Object.freeze({
    schema: TERRAIN_RESOURCE_SCHEMA,
    revision: String(source.revision || ''),
    coordinateModel: Object.freeze({ visualCellPx: VISUAL_CELL_SIZE, gameplayCellPx: GAMEPLAY_CELL_SIZE, ...(source.coordinateModel || {}) }),
    families: Object.freeze(families), sources: Object.freeze(sources), materials: Object.freeze(materials), motifs: Object.freeze(motifs)
  });
}

export function familyById(catalog, id) { return catalog?.families?.find(row => row.id === String(id)) || null; }
export function sourceById(catalog, id) { return catalog?.sources?.find(row => row.id === String(id)) || null; }
export function materialById(catalog, id) { return catalog?.materials?.find(row => row.id === String(id)) || null; }
export function motifById(catalog, id) { return catalog?.motifs?.find(row => row.id === String(id)) || null; }
export function materialsForGroup(catalog, group) { return (catalog?.materials || []).filter(row => !row.group || row.group === String(group || '')); }
export function motifsForGroup(catalog, group) { return (catalog?.motifs || []).filter(row => !row.group || row.group === String(group || '')); }

export function materialSupportsFamily(material, familyId) { return !!material && (!material.familyIds.length || material.familyIds.includes(String(familyId))); }
export function materialForRole(catalog, { group = '', role = '', familyId = '' } = {}) {
  return materialsForGroup(catalog, group).find(material => material.role === String(role) && materialSupportsFamily(material, familyId))
    || materialsForGroup(catalog, group).find(material => materialSupportsFamily(material, familyId))
    || null;
}

export function normalizeTerrainIntent(input, catalog, { group = '', x = 0, y = 0, preserveGameplay = false } = {}) {
  const family = familyById(catalog, input?.familyId);
  if (!family) throw new Error(`Unknown terrain family '${input?.familyId}'`);
  let material = input?.materialId ? materialById(catalog, input.materialId) : null;
  if (material && !materialSupportsFamily(material, family.id)) throw new Error(`Material '${material.id}' does not support terrain family '${family.id}'`);
  if (!material) material = materialForRole(catalog, { group, role: input?.materialRole || family.materialRole, familyId: family.id });
  const visualMode = VISUAL_MODES.has(String(input?.visual?.mode)) ? String(input.visual.mode) : (input?.sourceId ? 'pinned' : 'auto');
  const pinnedSourceId = input?.visual?.sourceId || input?.sourceId || null;
  if (pinnedSourceId && !sourceById(catalog, pinnedSourceId)) throw new Error(`Unknown terrain source '${pinnedSourceId}'`);
  const requestedGameplayMode = preserveGameplay ? 'preserve' : String(input?.gameplay?.mode || 'semantic');
  const gameplayMode = GAMEPLAY_MODES.has(requestedGameplayMode) ? requestedGameplayMode : 'semantic';
  return Object.freeze({
    cell: Object.freeze([Number(x), Number(y)]),
    familyId: family.id,
    materialId: material?.id || null,
    visual: Object.freeze({ mode: visualMode, sourceId: pinnedSourceId ? String(pinnedSourceId) : null }),
    gameplay: Object.freeze({ mode: gameplayMode, semantic: gameplayMode === 'preserve' ? 'preserve' : String(input?.gameplay?.semantic || family.gameplaySemantic) }),
    motifOwner: input?.motifOwner ? String(input.motifOwner) : null
  });
}
