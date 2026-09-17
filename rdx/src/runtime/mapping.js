import { RdxError } from '../core/errors.js';

function applyMatcherDiff(rows, diff) {
  if (!diff) return { rows: [...rows], missingFixed: [] };
  if (diff.schema !== 'rd.asset_matcher.diff.v4') {
    throw new RdxError('MATCHER_DIFF_SCHEMA', 'Expected rd.asset_matcher.diff.v4 matcher diff', { schema: diff.schema });
  }

  const overrides = diff.overrides || {};
  const manualById = new Map((diff.manualMatches || []).map(row => [row.id, row]));
  const effective = [];
  for (const source of rows) {
    const id = source.mappingId;
    if (overrides[id]?.status === 'rejected') continue;
    const manual = manualById.get(id);
    if (!manual || manual.status !== 'fixed') {
      effective.push(source);
      continue;
    }
    effective.push({
      ...source,
      combinedName: manual.combinedName || source.combinedName,
      visualDescription: manual.visualDescription || source.visualDescription,
      confidence: manual.confidence || source.confidence,
      actionPurpose: manual.actionPurpose || source.actionPurpose,
      portingNotes: manual.actionNotes || source.portingNotes,
      matcherNotes: manual.notes || '',
      matcherUpdatedAt: manual.updatedAt || manual.createdAt || null
    });
  }

  const present = new Set(effective.map(row => row.mappingId));
  const missingFixed = (diff.manualMatches || [])
    .filter(row => row.status === 'fixed' && overrides[row.id]?.status !== 'rejected' && !present.has(row.id))
    .map(row => row.id);
  return { rows: effective, missingFixed };
}

function resolvedLevelMappingBySubmap(resolvedLevels) {
  const rows = new Map();
  for (const room of resolvedLevels?.rooms || []) {
    const mapping = room?.effective?.mapping;
    if (!mapping || !Number.isInteger(Number(room?.submap))) continue;
    rows.set(Number(room.submap), { room, mapping });
  }
  return rows;
}

function canonicalLevelRow(legacy, resolved) {
  if (!resolved) return legacy;
  const { room, mapping } = resolved;
  const dxPx = Number(mapping.pixelOffset?.dxPx || 0);
  const dyPx = Number(mapping.pixelOffset?.dyPx || 0);
  return {
    ...legacy,
    xrickSubmap: Number(room.submap),
    rdxMd: Number(mapping.mapId ?? room.mapId),
    group: mapping.group ?? legacy.group,
    pixelOffset: { dxPx, dyPx },
    tileOffset: { dxTiles: dxPx / 8, dyTiles: dyPx / 8 },
    runtimeViewportBias: {
      dxPx: Number(mapping.runtimeViewportBias?.dxPx || 0),
      dyPx: Number(mapping.runtimeViewportBias?.dyPx || 0),
      authority: 'canonical-resolved-level'
    },
    effectiveRdxShapeTiles: Array.isArray(mapping.rdxTopology?.effectiveVisualSize)
      ? [Number(mapping.rdxTopology.effectiveVisualSize[1]) / 8, Number(mapping.rdxTopology.effectiveVisualSize[0]) / 8]
      : (mapping.effectiveRdxShapeTiles || legacy.effectiveRdxShapeTiles || null),
    rdxTopology: mapping.rdxTopology || null,
    alignmentScore: Number(room?.layers?.alignment?.regions?.[0]?.confidence ?? legacy.alignmentScore ?? 1),
    coordinateFormula: 'rdx_x_px = xrick_x_px + pixelOffset.dxPx; rdx_y_px = xrick_y_px + pixelOffset.dyPx',
    mappingAuthority: 'canonical-resolved-level'
  };
}

export class RdxMapping {
  constructor(data, matcherDiff = null, resolvedLevels = null) {
    if (!data || data.schema !== 'rd.asset_mapping.v1') {
      throw new RdxError('MAPPING_SCHEMA', 'Expected rd.asset_mapping.v1 mapping data', { schema: data?.schema });
    }
    this.data = data;
    this.matcherDiff = matcherDiff;
    this.levels = new Map();
    const resolvedBySubmap = resolvedLevelMappingBySubmap(resolvedLevels);
    for (const legacy of data.levelMapping || []) {
      const row = canonicalLevelRow(legacy, resolvedBySubmap.get(Number(legacy.xrickSubmap)));
      if (this.levels.has(row.xrickSubmap)) throw new RdxError('MAPPING_DUPLICATE', 'Duplicate xrick submap mapping', row);
      this.levels.set(row.xrickSubmap, row);
    }
    const effective = applyMatcherDiff(data.assetMappings || [], matcherDiff);
    this.assetRows = effective.rows;
    this.missingFixedMatcherRows = effective.missingFixed;
    this.byXrickKey = new Map();
    for (const row of this.assetRows) {
      const keys = new Set([row.xrick?.assetKey, ...(row.xrick?.bundleKeys || [])].filter(Boolean));
      for (const key of keys) {
        const list = this.byXrickKey.get(key) || [];
        list.push(row);
        this.byXrickKey.set(key, list);
      }
    }
  }

  validate() {
    const errors = [];
    const warnings = [];
    if (this.levels.size !== 47) errors.push(`Expected 47 level mappings, found ${this.levels.size}`);
    if (this.missingFixedMatcherRows.length) {
      errors.push(`Matcher diff contains ${this.missingFixedMatcherRows.length} fixed rows missing from normalized mapping: ${this.missingFixedMatcherRows.join(', ')}`);
    }
    const transitionIds = new Set([12, 24, 45]);
    for (const row of this.levels.values()) {
      if (transitionIds.has(row.rdxMd)) errors.push(`${row.xrickSubmapHex} maps to excluded transition ${row.rdxMdName}`);
      if (!Number.isFinite(row.pixelOffset?.dxPx) || !Number.isFinite(row.pixelOffset?.dyPx)) errors.push(`${row.xrickSubmapHex} lacks pixel offsets`);
      if ((row.visualOffset?.dxPx ?? 0) !== 0 || (row.visualOffset?.dyPx ?? 0) !== 0) errors.push(`${row.xrickSubmapHex} must not apply a second visual transform`);
      if ((row.alignmentScore ?? 1) < 0.8) warnings.push(`${row.xrickSubmapHex} -> ${row.rdxMdName} low score ${row.alignmentScore.toFixed(3)}`);
    }
    return {
      ok: errors.length === 0,
      errors,
      warnings,
      levels: this.levels.size,
      assets: this.assetRows.length,
      version: this.data.version,
      matcherDiffVersion: this.matcherDiff?.version || null
    };
  }

  levelForSubmap(submap) {
    return this.levels.get(Number(submap)) || null;
  }

  transformContact(submap, x, y) {
    const row = this.levelForSubmap(submap);
    if (!row) return null;
    return {
      mapId: row.rdxMd,
      x: x + row.pixelOffset.dxPx,
      y: y + row.pixelOffset.dyPx,
      mapping: row
    };
  }

  runtimeOffsetForSubmap(submap) {
    const row = this.levelForSubmap(submap);
    if (!row) return null;
    const bias = row.runtimeViewportBias || {};
    return {
      dxPx: row.pixelOffset.dxPx + Number(bias.dxPx || 0),
      dyPx: row.pixelOffset.dyPx + Number(bias.dyPx || 0),
      mapping: row
    };
  }

  viewportForSubmap(submap, options = {}) {
    const row = this.levelForSubmap(submap);
    if (!row) return null;
    const cameraX = options.cameraX ?? options.canonicalX ?? 0;
    const cameraY = options.cameraY ?? options.canonicalY ?? 0;
    const runtime = this.runtimeOffsetForSubmap(submap);
    return {
      mapId: row.rdxMd,
      x: runtime.dxPx + cameraX,
      y: runtime.dyPx + cameraY,
      width: options.width ?? 256,
      height: options.height ?? 192,
      mapping: row
    };
  }

  rowsForXrickAsset(assetKey) {
    return this.byXrickKey.get(assetKey) || [];
  }

  resolveAction(assetKey, actionRole) {
    const rows = this.rowsForXrickAsset(assetKey);
    for (const row of rows) {
      const actions = row.rdx?.actions || [];
      const exact = actions.find(action => action.action === actionRole);
      if (exact) return { status: 'mapped', row, action: exact };
    }
    if (rows.length) {
      return {
        status: 'fallback',
        reason: `No verified RDX action '${actionRole}' for ${assetKey}`,
        row: rows[0],
        action: null
      };
    }
    return { status: 'fallback', reason: `No semantic mapping for ${assetKey}`, row: null, action: null };
  }

  lowConfidenceLevels(threshold = 0.8) {
    return [...this.levels.values()].filter(row => (row.alignmentScore ?? 1) < threshold);
  }
}
