import { PRESENTATION_ALLOWED_BANDS, PRESENTATION_DEPTH_SCHEMA, normalizePresentationDepthConfig } from '../levels/presentation-depth.js';

export const PRESENTATION_DEPTH_SHARED_DRAFT_SCHEMA = 'rdr.presentation_depth_shared_draft.v1';
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

function assert(condition, message) { if (!condition) throw new Error(`Presentation depth class authoring: ${message}`); }
function editKey(row) { return `${String(row?.plane || '').toUpperCase()}:${Number(row?.globalTile)}`; }

export function normalizePresentationDepthClassEdits(rows = []) {
  const seen = new Set();
  return Object.freeze((Array.isArray(rows) ? rows : []).map((row, index) => {
    const plane=String(row?.plane || 'B').toUpperCase(), globalTile=Number(row?.globalTile), action=String(row?.action || 'set');
    assert(PRESENTATION_ALLOWED_BANDS[plane], `edit ${index} has invalid plane ${plane}`);
    assert(Number.isInteger(globalTile) && globalTile >= 0 && globalTile <= 0xffff, `edit ${index} has invalid global tile ${row?.globalTile}`);
    assert(['set','remove'].includes(action), `edit ${index} has invalid action ${action}`);
    const band=action==='set' ? String(row?.band || '') : null;
    if(action==='set')assert(PRESENTATION_ALLOWED_BANDS[plane].includes(band), `edit ${index} has invalid ${plane} band ${band}`);
    const key=`${plane}:${globalTile}`;assert(!seen.has(key),`duplicate edit for ${key}`);seen.add(key);
    return Object.freeze({id:String(row?.id || `depth-class-${plane}-${globalTile}`),plane,globalTile,action,...(band?{band}:{}),label:String(row?.label || `Plane ${plane} tile ${globalTile}`),provenance:row?.provenance?Object.freeze(clone(row.provenance)):null});
  }));
}

export function presentationDepthClassEditAt(rows, plane, globalTile) {
  const key=`${String(plane||'B').toUpperCase()}:${Number(globalTile)}`;
  return normalizePresentationDepthClassEdits(rows).find(row=>editKey(row)===key) || null;
}

export function applyPresentationDepthClassEdits(baseClasses = [], edits = []) {
  const normalizedEdits=normalizePresentationDepthClassEdits(edits),claimed=new Set(normalizedEdits.map(editKey)),out=[];
  for(const row of baseClasses || []){
    const remaining=(row.globalTiles||[]).map(Number).filter(tile=>!claimed.has(`${String(row.plane).toUpperCase()}:${tile}`));
    if(remaining.length)out.push({...clone(row),globalTiles:remaining});
  }
  for(const row of normalizedEdits){
    if(row.action!=='set')continue;
    out.push({id:row.id,plane:row.plane,band:row.band,globalTiles:[row.globalTile],label:row.label,provenance:row.provenance||{reason:'Level Editor shared presentation-depth correction'}});
  }
  const validated=normalizePresentationDepthConfig({schema:PRESENTATION_DEPTH_SCHEMA,version:2,planeDefaults:{A:'foreground',B:'midground'},classes:out});
  return validated.classes;
}

export function createPresentationDepthSharedDraft({model,edits=[]}={}) {
  assert(model && model.planeDefaults, 'resolved presentation-depth model is required');
  const normalizedEdits=normalizePresentationDepthClassEdits(edits),classes=applyPresentationDepthClassEdits(model.classes || [],normalizedEdits);
  return Object.freeze({
    schema:PRESENTATION_DEPTH_SHARED_DRAFT_SCHEMA,version:1,
    presentationDepth:Object.freeze({schema:PRESENTATION_DEPTH_SCHEMA,version:2,planeDefaults:Object.freeze({A:'foreground',B:'midground'}),classes}),
    edits:normalizedEdits
  });
}

export function exportPresentationDepthSharedDraftJson(options) { return JSON.stringify(createPresentationDepthSharedDraft(options),null,2); }
