function text(value, fallback = '') { return String(value ?? fallback).trim(); }

export function previewMapLabel(mapId) {
  const value = Math.max(0, Number(mapId) | 0);
  return `MD${String(value).padStart(4, '0')}`;
}

export function previewElementKind(item = {}, diagnostic = false) {
  if (diagnostic || item.debugId || item.overlayType) {
    const overlay = text(item.overlayType || item.policy?.family || item.category || 'debug')
      .toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    return `debug-${overlay || 'debug'}`;
  }
  const port = text(item.port || 'preview').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  const role = text(item.category || item.kind || item.role || 'element').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  return `${port}-${role || 'element'}`;
}

/** Stable, copy-friendly identity for a single whole-map element.
 *
 * Examples:
 *   MD0011#rdx-trap#static:53:47:888:front:0
 *   MD0011#debug-activator#activator:mark:93
 *
 * The map prefix makes the id safe to quote in future bug/fix requests; the
 * kind keeps a sprite and one of its debug/collision boxes distinct even when
 * both are sourced by the same classic mark.
 */
export function previewElementId(item = {}, context = {}, diagnostic = false) {
  if (item.elementId) return text(item.elementId);
  const map = previewMapLabel(context.mapId ?? item.mapId ?? 0);
  const kind = previewElementKind(item, diagnostic);
  const identity = diagnostic
    ? text(item.debugId || item.sourceKey || item.id || 'unknown')
    : text(item.instanceKey || item.sourceKey || item.id || item.assetKey || 'unknown');
  return `${map}#${kind}#${identity || 'unknown'}`;
}

export function decoratePreviewElement(item, context = {}, diagnostic = false) {
  if (!item) return null;
  return Object.freeze({
    ...item,
    elementId: previewElementId(item, context, diagnostic),
    elementKind: previewElementKind(item, diagnostic),
    debugOnly: diagnostic,
    mapId: Number(context.mapId ?? item.mapId ?? 0),
    submap: Number(context.submap ?? item.submap ?? -1)
  });
}

export function diagnosticSelectable(row, context = {}) {
  if (!row) return null;
  const pathPoints=Array.isArray(row.pathPoints)?row.pathPoints:[];
  const xs=pathPoints.map(point=>Number(point?.[0])).filter(Number.isFinite), ys=pathPoints.map(point=>Number(point?.[1])).filter(Number.isFinite);
  const pathTolerance=Math.max(1,Number(row.hitPathTolerance||0));
  const pointRadius=Math.max(1,Number(row.hitPointRadius||0));
  const hitPoint=Array.isArray(row.hitPoint)?row.hitPoint:null;
  const sourceBounds = row.bounds || (pathTolerance&&xs.length&&ys.length ? {
    x:Math.min(...xs)-pathTolerance,y:Math.min(...ys)-pathTolerance,
    width:Math.max(1,Math.max(...xs)-Math.min(...xs)+pathTolerance*2),height:Math.max(1,Math.max(...ys)-Math.min(...ys)+pathTolerance*2)
  } : hitPoint ? {x:Number(hitPoint[0])-pointRadius,y:Number(hitPoint[1])-pointRadius,width:pointRadius*2,height:pointRadius*2} : (row.envelope ? {
    x: Number(row.envelope.minX || 0) - 4, y: Number(row.envelope.minY || 0) - 8,
    width: Math.max(8, Number(row.envelope.width || 0) + 8), height: Math.max(16, Number(row.envelope.height || 0) + 16)
  } : null));
  if (!sourceBounds) return null;
  const bounds = {
    x: Number(sourceBounds.x || 0), y: Number(sourceBounds.y || 0),
    width: Math.max(1, Number(sourceBounds.width || 1)), height: Math.max(1, Number(sourceBounds.height || 1))
  };
  const current = Array.isArray(row.current) ? row.current : [bounds.x + bounds.width / 2, bounds.y + bounds.height / 2];
  return decoratePreviewElement({
    id: row.debugId,
    debugId: row.debugId,
    sourceKey: row.sourceKey || null,
    traceCollection: row.traceCollection || (row.overlayType === 'activator' ? 'activators' : null),
    port: 'debug',
    kind: row.overlayType || row.policy?.family || 'debug',
    category: row.category || row.policy?.family || 'debug',
    role: row.policy?.label || row.overlayType || 'debug',
    x: Number(current[0] || 0), y: Number(current[1] || 0),
    draw: [bounds.x, bounds.y], bounds: Object.freeze(bounds),
    visible: true,
    authority: row.authority || row.effectAuthority || row.policy?.label || 'debug-overlay',
    ...(row.triggerSound ? { triggerSound: row.triggerSound } : {}),
    ...(row.parentSourceKey ? { parentSourceKey: row.parentSourceKey } : {}),
    ...(row.rdxSourceKey ? { rdxSourceKey: row.rdxSourceKey } : {}),
    ...(row.assetFamily ? { assetFamily: row.assetFamily } : {}),
    ...(row.classification ? { classification: row.classification } : {}),
    ...(row.counterpartState ? { counterpartState: row.counterpartState } : {}),
    ...(row.subjectCategory ? { subjectCategory: row.subjectCategory } : {}),
    ...(row.geometrySemantic ? { geometrySemantic:row.geometrySemantic } : {}),
    selectionOnlyBounds:!row.bounds,
    debugRow: row
  }, context, true);
}
