import { normalizeStatePresentationOverrides } from './stateful-presentation.js';
import { enemyPatrolAnchorOffset } from './enemy-authoring.js';
const finite = value => Number.isFinite(Number(value));
const integer = value => Number.isInteger(Number(value));

export function sourcePlacementOffset(row) {
  return {
    dx: integer(row?.placementDx) ? Number(row.placementDx) : 0,
    dy: integer(row?.placementDy) ? Number(row.placementDy) : 0
  };
}

export function sourceAlignmentDraftOffset(mark, document, resolvedRoom) {
  if (!document || !resolvedRoom) return { dx:0, dy:0 };
  const semantic=(resolvedRoom?.layers?.semanticCorpus?.objects || []).find(
    row => Number(row?.sources?.classic?.mark) === Number(mark)
  );
  const regionId=String(semantic?.alignedBaseline?.authority || '');
  if (!regionId) return { dx:0, dy:0 };
  const canonical=(resolvedRoom?.layers?.alignment?.regions || []).find(
    region => String(region?.id || '') === regionId
  );
  const override=(document.alignmentOverrides || []).find(
    region => String(region?.id || '') === regionId
  );
  if (!canonical || !override || String(canonical?.transform?.type || 'translate') !== 'translate' ||
      String(override?.transform?.type || 'translate') !== 'translate') return { dx:0, dy:0 };
  return {
    dx:Number(override.transform?.dxPx || 0) - Number(canonical.transform?.dxPx || 0),
    dy:Number(override.transform?.dyPx || 0) - Number(canonical.transform?.dyPx || 0)
  };
}

/**
 * Compose the authored source/body translation in the one coordinate basis
 * shared by Scene preview and native draft compilation. Layer-C alignment and
 * Layer-F source placement are deltas around the same canonical ResolvedLevel
 * source; neither consumer is allowed to rebase from rendered bounds.
 */
export function effectiveSourcePlacementOffset(mark, row, { document = null, resolvedRoom = null } = {}) {
  const placement=sourcePlacementOffset(row);
  const alignment=sourceAlignmentDraftOffset(mark,document,resolvedRoom);
  const semantic=(resolvedRoom?.layers?.semanticCorpus?.objects || []).find(
    object => Number(object?.sources?.classic?.mark) === Number(mark)
  );
  const patrol=row?.patrol ? enemyPatrolAnchorOffset(semantic || null,row.patrol) : {dx:0,dy:0,baseStart:null,editedStart:null};
  return {
    dx:placement.dx + alignment.dx + Number(patrol.dx || 0),
    dy:placement.dy + alignment.dy + Number(patrol.dy || 0),
    placement,
    alignment
  };
}

export function sourceStateVisualOffsets(row) {
  const out={};
  for (const [key,value] of Object.entries(row?.stateVisualOffsetsByPn || {})) {
    const pn=Number(key), dx=Number(value?.[0] || 0), dy=Number(value?.[1] || 0);
    if (!Number.isInteger(pn) || pn < 0 || pn > 254 || !Number.isInteger(dx) || !Number.isInteger(dy) || (!dx && !dy)) continue;
    out[pn]=[dx,dy];
  }
  return out;
}

export function sourceOcclusionLayer(row) {
  return ['behind-midground','normal','front'].includes(String(row?.occlusionLayer || '')) ? String(row.occlusionLayer) : null;
}

export function sourceOverrideHasAuthoredChange(row) {
  if (!row) return false;
  const { dx, dy } = sourcePlacementOffset(row);
  return !!row.suppressed || row.presentationPn != null || row.controllerEntity != null || String(row.enemyKindSetId || '').trim() !== '' || !!row.patrol || dx !== 0 || dy !== 0 ||
    sourceOcclusionLayer(row) != null || Object.keys(sourceStateVisualOffsets(row)).length > 0 || normalizeStatePresentationOverrides(row).length > 0 ||
    !!row.projectileShooterPresentation || Array.isArray(row.projectileEmitterOrigin) || ['left','right'].includes(String(row.projectileLaneDirection || '')) ||
    ['left','right'].includes(String(row.movingPlatformDirection || ''));
}

function snappedAxis(start, size, delta, grid) {
  const raw = Math.round(Number(delta) || 0);
  const g = Math.max(1, Math.round(Number(grid) || 8));
  const a = finite(start) ? Number(start) : 0;
  const b = a + (finite(size) ? Number(size) : 0);
  const candidates = [
    0,
    Math.round((a + raw) / g) * g - a,
    Math.round((b + raw) / g) * g - b
  ].map(Math.round);
  return candidates.reduce((best, value) => Math.abs(value - raw) < Math.abs(best - raw) ? value : best, candidates[0]);
}

/**
 * Translate a visible source actor while snapping one of its opaque edges to
 * the current editor grid on each moved axis. The contact/origin point is not
 * used as the snap target; sprite artwork edges are what the author sees.
 */
export function snapSourceOpaqueTranslation(bounds, dx, dy, { grid = 8 } = {}) {
  if (!bounds || !finite(bounds.x) || !finite(bounds.y)) return { dx:Math.round(Number(dx)||0), dy:Math.round(Number(dy)||0) };
  return {
    dx: snappedAxis(bounds.x, bounds.width, dx, grid),
    dy: snappedAxis(bounds.y, bounds.height, dy, grid)
  };
}
