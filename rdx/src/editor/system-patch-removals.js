export const SYSTEM_PATCH_REMOVAL_COLLECTION = 'reviewedMapVisualPatches';

const RETRACTABLE_ACTIONS = new Set(['suppress','copy','overlay-tiles','geometry-open','geometry-one-way']);
const PIXEL_RESTORE_ACTIONS = new Set(['suppress','copy','overlay-tiles']);

export function canRetractReviewedSystemPatch(patch) {
  return !!patch?.id && RETRACTABLE_ACTIONS.has(String(patch.action || ''));
}

export function systemPatchRemovalRestoresPixels(patch) {
  return !!patch?.id && PIXEL_RESTORE_ACTIONS.has(String(patch.action || ''));
}

const finite = value => Number.isFinite(Number(value));

export function normalizeSystemPatchRemoval(row = {}) {
  const patchId=String(row.patchId || '').trim();
  if (!patchId) return null;
  const bounds=Array.isArray(row.bounds) && row.bounds.length >= 4 && row.bounds.slice(0,4).every(finite)
    ? row.bounds.slice(0,4).map(Number) : null;
  const sourceKey=String(row.sourceKey || '');
  const action=String(row.action || '');
  const layer=String(row.layer || '').toUpperCase();
  return {
    id:String(row.id || `system-patch-removal:${patchId}`),
    operation:'remove',
    collection:SYSTEM_PATCH_REMOVAL_COLLECTION,
    patchId,
    ...(sourceKey ? { sourceKey } : {}),
    ...(action ? { action } : {}),
    ...(layer ? { layer } : {}),
    ...(bounds ? { bounds } : {})
  };
}

export function createSystemPatchRemoval(patch) {
  if (!patch?.id) throw new Error('A reviewed visual patch id is required');
  return normalizeSystemPatchRemoval({
    patchId:String(patch.id),
    sourceKey:String(patch.sourceKey || `map-visual:${patch.id}`),
    action:String(patch.action || ''),
    layer:String(patch.layer || ''),
    bounds:Array.isArray(patch.bounds) ? patch.bounds : null
  });
}

export function removedSystemPatchIds(document) {
  return new Set((document?.systemPatchRemovals || []).map(row=>String(row.patchId || '')).filter(Boolean));
}

export function systemPatchRemovalFor(document, patchId) {
  const id=String(patchId || '');
  return (document?.systemPatchRemovals || []).find(row=>String(row.patchId || '')===id) || null;
}

export function reviewedVisualPatchForRemoval(removal, reviewedPatches = []) {
  if (!removal) return null;
  return (Array.isArray(reviewedPatches) ? reviewedPatches : []).find(row=>String(row?.id || '')===String(removal.patchId || '')) || null;
}

/**
 * Static reviewed pixel patches are applied after the raw RDX planes are
 * decoded. A draft retraction can therefore neutralize them by copying the
 * exact decoded 8x8 cells back over every plane touched by the patch. This
 * covers both plain `suppress` rows and materialized `overlay-tiles` rows.
 *
 * Historical `geometry-open` / `geometry-one-way` rows deliberately produce no
 * pixel restoration here: they are legacy geometry research rows, not inputs to
 * the shared 8x8 Rick terrain provider. Their draft removal is still persisted
 * and exported so the authored source row can be retracted in code.
 */
export function systemPatchRestorationOverrides(document, reviewedPatches = []) {
  const d=document || {}, out=[];
  for (const removal of d.systemPatchRemovals || []) {
    const patch=reviewedVisualPatchForRemoval(removal,reviewedPatches);
    if (!patch || !systemPatchRemovalRestoresPixels(patch)) continue;
    if (Number(patch.submap) !== Number(d.base?.submap) || Number(patch.mapId) !== Number(d.base?.mapId)) continue;
    const bounds=Array.isArray(patch.bounds) ? patch.bounds.slice(0,4).map(Number) : null;
    if (!bounds || bounds.length < 4 || !bounds.every(finite)) continue;
    const [x,y,width,height]=bounds;
    if (x%8 || y%8 || width<=0 || height<=0 || width%8 || height%8) continue;
    const action=String(patch.action || '');
    const planes=new Set();
    if (action === 'suppress' || action === 'copy') {
      const layers=String(patch.layer || 'A').toUpperCase();
      for (const plane of ['B','A']) if (layers.includes(plane)) planes.add(plane);
    } else if (action === 'overlay-tiles') {
      const clearLayers=String(patch.clearLayer || '').toUpperCase();
      for (const plane of ['B','A']) if (clearLayers.includes(plane)) planes.add(plane);
      for (const tile of patch.tiles || []) {
        const plane=String(tile?.plane || '').toUpperCase();
        if (plane === 'A' || plane === 'B') planes.add(plane);
      }
    }
    for (const plane of planes) for (let gy=y/8;gy<(y+height)/8;gy+=1) for (let gx=x/8;gx<(x+width)/8;gx+=1) {
      out.push(Object.freeze({
        submap:Number(d.base.submap), mapId:Number(d.base.mapId),
        target:Object.freeze([gx,gy]), source:Object.freeze([gx,gy]), sourceMapId:Number(d.base.mapId),
        layer:plane, sourceLayer:plane, operation:'copy', authority:'system-patch-removal',
        systemPatchId:String(patch.id), sourceKey:String(patch.sourceKey || `map-visual:${patch.id}`)
      }));
    }
  }
  return Object.freeze(out);
}
