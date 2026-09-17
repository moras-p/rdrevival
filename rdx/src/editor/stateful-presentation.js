import {
  normalizeCanonicalStatePresentations, normalizeStatePresentationEntry, normalizeStatePresentationOverrides,
  resolvedStatePresentation
} from '../runtime/state-presentation.js';

export { normalizeCanonicalStatePresentations, normalizeStatePresentationOverrides, statePresentationMatch } from '../runtime/state-presentation.js';

const finiteInt=value=>Number.isInteger(Number(value));
const point=value=>Array.isArray(value)&&value.length>=2&&Number.isFinite(Number(value[0]))&&Number.isFinite(Number(value[1]))
  ? [Number(value[0]),Number(value[1])] : null;

function markSourceKey(semantic){
  const mark=Number(semantic?.sources?.classic?.mark);
  return Number.isInteger(mark)&&mark>=0?`mark:${mark}`:String(semantic?.semanticId||'source');
}
function stateOriginForPn(semantic,pn){
  for(const state of Object.values(semantic?.states||{}))if(Number(state?.pn)===Number(pn)&&point(state?.origin))return point(state.origin);
  for(const state of Object.values(semantic?.states||{}))if(point(state?.origin))return point(state.origin);
  return point(semantic?.effective?.presentationOrigin)||point(semantic?.alignedBaseline?.origin)||[0,0];
}
function stateDrawForPn(semantic,pn){
  for(const state of Object.values(semantic?.states||{}))if(Number(state?.pn)===Number(pn)&&point(state?.draw))return point(state.draw);
  for(const state of Object.values(semantic?.states||{}))if(point(state?.draw))return point(state.draw);
  return point(semantic?.effective?.visualAnchor)||null;
}
function stateRow({sourceKey,stateKey,sourcePn,label,owner,baseOrigin,baseDraw,componentKey=null,phase=null,aliases=[]}){
  return Object.freeze({sourceKey:String(sourceKey),stateKey:String(stateKey),sourcePn:Number(sourcePn),label:String(label||stateKey),owner:String(owner||'Main'),baseOrigin:Object.freeze((baseOrigin||[0,0]).map(Number)),baseDraw:baseDraw?Object.freeze(baseDraw.map(Number)):null,componentKey:componentKey==null?null:String(componentKey),phase:phase==null?null:Number(phase),aliases:Object.freeze(aliases.map(String))});
}
function presentationIdentity(row){const origin=point(row?.baseOrigin)||[0,0],draw=point(row?.baseDraw);return `${Number(row?.sourcePn)}|${origin[0]},${origin[1]}|${draw?draw.join(','):'none'}`;}
function collapseEquivalentStates(rows){const byIdentity=new Map();for(const row of rows){const id=presentationIdentity(row),prior=byIdentity.get(id);if(!prior){byIdentity.set(id,row);continue;}byIdentity.set(id,stateRow({...prior,aliases:[...(prior.aliases||[]),prior.stateKey,...(row.aliases||[]),row.stateKey]}));}return [...byIdentity.values()];}

/* The semantic state cycle is authoritative when it exists. Actors without an
 * explicit cycle may expose authored animation states from sprite_anims.json;
 * these are presentation states only and do not invent browser gameplay. */
export function semanticPresentationStates(semantic,{animationStates=[]}={}){
  if(!semantic)return [];
  const rows=[],sourceKey=markSourceKey(semantic),cycle=semantic.previewStateCycle;
  if(Array.isArray(cycle?.samples)&&cycle.samples.length){
    const seen=new Set();
    for(const sample of cycle.samples){
      const sourcePn=Number(sample?.pn);if(!Number.isInteger(sourcePn)||sourcePn<0||sourcePn>254)continue;
      const label=String(sample?.visualState||`PN ${sourcePn}`),stateKey=String(sample?.visualState||`phase:${Number(sample?.phase||0)}`),id=`${sourceKey}|${stateKey}|${sourcePn}`;if(seen.has(id))continue;seen.add(id);
      rows.push(stateRow({sourceKey,stateKey,sourcePn,label,owner:'Main',baseOrigin:stateOriginForPn(semantic,sourcePn),baseDraw:stateDrawForPn(semantic,sourcePn),phase:sample?.phase}));
    }
  }else if(Array.isArray(animationStates)&&animationStates.length>1){
    const seen=new Set();
    for(const animation of animationStates){
      const sourcePn=Number(animation?.pn),action=String(animation?.action||animation?.label||`pn-${sourcePn}`);if(!Number.isInteger(sourcePn)||sourcePn<0||sourcePn>254)continue;
      const stateKey=`animation:${action}`,id=`${stateKey}|${sourcePn}`;if(seen.has(id))continue;seen.add(id);
      rows.push(stateRow({sourceKey,stateKey,sourcePn,label:String(animation?.label||animation?.action||`PN ${sourcePn}`),owner:'Main',baseOrigin:stateOriginForPn(semantic,sourcePn),baseDraw:stateDrawForPn(semantic,sourcePn),aliases:[action]}));
    }
  }else{
    const fallback=[];
    for(const [key,state] of Object.entries(semantic?.states||{})){
      const sourcePn=Number(state?.pn);if(!Number.isInteger(sourcePn)||sourcePn<0||sourcePn>254)continue;
      fallback.push(stateRow({sourceKey,stateKey:String(state?.visualState||key),sourcePn,label:String(state?.visualState||key),owner:'Main',baseOrigin:point(state?.origin)||stateOriginForPn(semantic,sourcePn),baseDraw:point(state?.draw)||stateDrawForPn(semantic,sourcePn),aliases:[key]}));
    }
    const evidenceOnly=fallback.length>0&&fallback.every(row=>{
      const names=[row.stateKey,...(row.aliases||[])].map(value=>String(value).toLowerCase());
      return names.every(value=>value==='snapshot'||value==='simulated');
    });
    if(evidenceOnly){
      // `states.snapshot` and `states.simulated` are alternate projection evidence,
      // not authored lifecycle states. Keep one presentation row even when runtime
      // motion causes their draw/origin evidence to differ. Prefer the reviewed
      // snapshot anchor and retain both aliases for legacy draft matching.
      const preferred=fallback.find(row=>String(row.stateKey).toLowerCase()==='snapshot')||fallback[0];
      rows.push(stateRow({...preferred,aliases:[...new Set(fallback.flatMap(row=>[row.stateKey,...(row.aliases||[])]))]}));
    }else rows.push(...collapseEquivalentStates(fallback));
  }
  let componentIndex=0;
  for(const [componentKey,component] of Object.entries(semantic?.componentStateCycles||{})){
    componentIndex+=1;const samples=component?.cycle?.samples||[],baseOrigin=point(component?.snapshot?.origin)||[0,0],baseDraw=point(component?.snapshot?.draw);
    const seen=new Set();
    for(const sample of samples){
      const sourcePn=Number(sample?.pn);if(!Number.isInteger(sourcePn)||sourcePn<0||sourcePn>254)continue;
      const stateKey=String(sample?.visualState||`phase:${Number(sample?.phase||0)}`),id=`${componentKey}|${stateKey}|${sourcePn}`;if(seen.has(id))continue;seen.add(id);
      rows.push(stateRow({sourceKey:componentKey,stateKey,sourcePn,label:String(sample?.visualState||`PN ${sourcePn}`),owner:`Component ${componentIndex}`,baseOrigin,baseDraw,componentKey,phase:sample?.phase}));
    }
  }
  const runtimeCounts=new Map();for(const row of rows){const key=`${row.sourceKey}|${row.sourcePn}`;runtimeCounts.set(key,(runtimeCounts.get(key)||0)+1);}
  return rows.map(row=>Object.freeze({...row,sharedRuntimeIdentity:(runtimeCounts.get(`${row.sourceKey}|${row.sourcePn}`)||0)>1}));
}

export function statePresentationDraftMatches(row,state){
  const normalized=normalizeStatePresentationEntry(row);if(!normalized||!state)return false;
  if(normalized.sourceKey!==String(state.sourceKey)||normalized.sourcePn!==Number(state.sourcePn))return false;
  return normalized.stateKey===String(state.stateKey)||normalized.stateKey===`pn:${Number(state.sourcePn)}`;
}

export function effectiveStatePresentation(semantic,sourceOverride,state){
  const resolved=resolvedStatePresentation({presentation:semantic?.presentation,override:sourceOverride,state});
  return Object.freeze({
    sourceKey:state.sourceKey,stateKey:state.stateKey,sourcePn:Number(state.sourcePn),pn:resolved.pn,
    canonicalPn:resolved.canonicalPn,canonicalOffset:resolved.canonicalOffset,draftOffset:resolved.draftOffset,offset:resolved.offset,
    origin:Object.freeze([Number(state.baseOrigin?.[0]||0)+resolved.offset[0],Number(state.baseOrigin?.[1]||0)+resolved.offset[1]]),
    canonicalOrigin:Object.freeze([Number(state.baseOrigin?.[0]||0)+resolved.canonicalOffset[0],Number(state.baseOrigin?.[1]||0)+resolved.canonicalOffset[1]]),
    authored:resolved.authored
  });
}

export function mergeCanonicalStatePresentations(presentation,draftOverrides){
  const base=normalizeCanonicalStatePresentations(presentation),draft=Array.isArray(draftOverrides)?draftOverrides:[];
  const byKey=new Map(base.map(row=>[`${row.sourceKey}|${row.stateKey}`,{...row,offset:point(row.offset)||[0,0]}]));
  for(const row of draft){
    const normalized=normalizeStatePresentationEntry(row);if(!normalized)continue;const key=`${normalized.sourceKey}|${normalized.stateKey}`;
    const prior=byKey.get(key)||{sourceKey:normalized.sourceKey,stateKey:normalized.stateKey,sourcePn:normalized.sourcePn,pn:normalized.sourcePn,offset:[0,0]};
    const priorOffset=point(prior.offset)||[0,0],delta=point(normalized.offset)||[0,0];
    const next={...prior,sourcePn:normalized.sourcePn,pn:finiteInt(normalized.pn)?Number(normalized.pn):Number(prior.pn??normalized.sourcePn),offset:[priorOffset[0]+delta[0],priorOffset[1]+delta[1]]};
    if(next.pn===next.sourcePn&&!next.offset[0]&&!next.offset[1])byKey.delete(key);else byKey.set(key,next);
  }
  return [...byKey.values()].sort((a,b)=>a.sourceKey.localeCompare(b.sourceKey)||a.stateKey.localeCompare(b.stateKey)||a.sourcePn-b.sourcePn);
}
