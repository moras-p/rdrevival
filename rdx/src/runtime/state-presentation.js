const finiteInt=value=>Number.isInteger(Number(value));
const point=value=>Array.isArray(value)&&value.length>=2&&Number.isFinite(Number(value[0]))&&Number.isFinite(Number(value[1]))
  ? [Number(value[0]),Number(value[1])] : null;

export function normalizeStatePresentationEntry(row,{fallbackSourceKey=null,fallbackStateKey=null,fallbackSourcePn=null}={}){
  if(!row||typeof row!=='object')return null;
  const sourceKey=String(row.sourceKey||fallbackSourceKey||'');
  const stateKey=String(row.stateKey||fallbackStateKey||'');
  const sourcePn=Number(row.sourcePn??fallbackSourcePn);
  if(!sourceKey||!stateKey||!Number.isInteger(sourcePn)||sourcePn<0||sourcePn>254)return null;
  const pn=Number(row.pn),offset=point(row.offset)||[0,0];
  const out={sourceKey,stateKey,sourcePn};
  if(Number.isInteger(pn)&&pn>=0&&pn<=254)out.pn=pn;
  if(offset[0]||offset[1])out.offset=[Math.round(offset[0]),Math.round(offset[1])];
  return out;
}

export function normalizeStatePresentationOverrides(sourceOverride){
  const mark=Number(sourceOverride?.mark),fallbackSourceKey=Number.isInteger(mark)&&mark>=0?`mark:${mark}`:null;
  const out=[];
  for(const row of Array.isArray(sourceOverride?.statePresentationOverrides)?sourceOverride.statePresentationOverrides:[]){
    const normalized=normalizeStatePresentationEntry(row,{fallbackSourceKey});if(normalized)out.push(normalized);
  }
  /* Migrate drafts from the first PN-keyed state-registration implementation.
   * These rows were presentation-only deltas and are safe to reinterpret as a
   * source-PN fallback until the user next edits that state explicitly. */
  for(const [key,value] of Object.entries(sourceOverride?.stateVisualOffsetsByPn||{})){
    const sourcePn=Number(key),offset=point(value);if(!fallbackSourceKey||!Number.isInteger(sourcePn)||sourcePn<0||sourcePn>254||!offset)continue;
    if(out.some(row=>row.sourceKey===fallbackSourceKey&&row.sourcePn===sourcePn))continue;
    const normalized=normalizeStatePresentationEntry({sourceKey:fallbackSourceKey,stateKey:`pn:${sourcePn}`,sourcePn,offset});if(normalized)out.push(normalized);
  }
  return out;
}

export function normalizeCanonicalStatePresentations(presentation){
  const out=[];
  for(const row of Array.isArray(presentation?.statePresentations)?presentation.statePresentations:[]){const normalized=normalizeStatePresentationEntry(row);if(normalized)out.push(normalized);}
  return out;
}

export function statePresentationMatch(entries,state){
  const rows=Array.isArray(entries)?entries:[];
  const sourceKey=String(state?.sourceKey||''),stateKey=String(state?.stateKey||''),sourcePn=Number(state?.sourcePn);
  return rows.find(row=>row.sourceKey===sourceKey&&row.stateKey===stateKey) ||
    rows.find(row=>row.sourceKey===sourceKey&&row.stateKey===`pn:${sourcePn}`&&row.sourcePn===sourcePn) ||
    rows.find(row=>row.sourceKey===sourceKey&&row.sourcePn===sourcePn) || null;
}

export function resolvedStatePresentation({presentation=null,override=null,state=null}={}){
  const canonical=statePresentationMatch(normalizeCanonicalStatePresentations(presentation),state);
  const draft=statePresentationMatch(Array.isArray(override)?override:normalizeStatePresentationOverrides(override),state);
  const canonicalOffset=point(canonical?.offset)||[0,0],draftOffset=point(draft?.offset)||[0,0];
  const sourcePn=Number(state?.sourcePn);
  const canonicalPn=finiteInt(canonical?.pn)&&Number(canonical.pn)>=0&&Number(canonical.pn)<=254?Number(canonical.pn):sourcePn;
  const pn=finiteInt(draft?.pn)&&Number(draft.pn)>=0&&Number(draft.pn)<=254?Number(draft.pn):canonicalPn;
  return Object.freeze({sourcePn,canonicalPn,pn,canonicalOffset:Object.freeze(canonicalOffset),draftOffset:Object.freeze(draftOffset),offset:Object.freeze([canonicalOffset[0]+draftOffset[0],canonicalOffset[1]+draftOffset[1]]),authored:!!draft});
}
