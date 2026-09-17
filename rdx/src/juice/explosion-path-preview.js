export const EXPLOSION_PREVIEW_SPAWN_MODES = Object.freeze(['once','source-step','distance']);
export const EXPLOSION_PREVIEW_SEQUENCE_FAMILIES = Object.freeze(['large','rolling']);
export const EXPLOSION_PREVIEW_VARIANT_POLICIES = Object.freeze(['fixed','cycle','seed']);
export const EXPLOSION_PREVIEW_RENDER_PLANES = Object.freeze(['backdrop','midground','actors','foreground','frontActors']);
export const EXPLOSION_PREVIEW_DEFAULT_PATH = Object.freeze([
  Object.freeze({x:48,y:62}), Object.freeze({x:54,y:62}), Object.freeze({x:61,y:61}),
  Object.freeze({x:69,y:60}), Object.freeze({x:78,y:58}), Object.freeze({x:88,y:56}),
  Object.freeze({x:99,y:54}), Object.freeze({x:111,y:52}), Object.freeze({x:123,y:50}),
  Object.freeze({x:136,y:48}), Object.freeze({x:149,y:47}), Object.freeze({x:162,y:47}),
  Object.freeze({x:175,y:48}), Object.freeze({x:188,y:50}), Object.freeze({x:201,y:52}),
  Object.freeze({x:214,y:54}), Object.freeze({x:227,y:56}), Object.freeze({x:240,y:58}),
  Object.freeze({x:253,y:60}), Object.freeze({x:266,y:61})
]);

const clampInt=(value,min,max,fallback)=>{
  const n=Number(value); return Number.isFinite(n)?Math.min(max,Math.max(min,Math.round(n))):fallback;
};
const enumValue=(value,values,fallback)=>values.includes(String(value))?String(value):fallback;

export function normalizeExplosionPreviewConfig(value={}){
  return Object.freeze({
    sequenceFamily:enumValue(value.sequenceFamily,EXPLOSION_PREVIEW_SEQUENCE_FAMILIES,'rolling'),
    completeVariant:clampInt(value.completeVariant,0,31,0),
    spawnMode:enumValue(value.spawnMode,EXPLOSION_PREVIEW_SPAWN_MODES,'distance'),
    spacingPx:clampInt(value.spacingPx,1,32,8),
    maxActiveInstances:clampInt(value.maxActiveInstances,1,8,8),
    variantPolicy:enumValue(value.variantPolicy,EXPLOSION_PREVIEW_VARIANT_POLICIES,'fixed'),
    variantSeed:clampInt(value.variantSeed,0,0x7fffffff,0),
    renderPlane:enumValue(value.renderPlane,EXPLOSION_PREVIEW_RENDER_PLANES,'actors'),
    variantCount:clampInt(value.variantCount,1,32,1),
    discontinuityPx:clampInt(value.discontinuityPx,8,256,24)
  });
}

export function explosionPreviewSegmentDistance(a,b){
  if(!a||!b)return 0;
  return Math.max(Math.abs(Math.round(Number(b.x)||0)-Math.round(Number(a.x)||0)),Math.abs(Math.round(Number(b.y)||0)-Math.round(Number(a.y)||0)));
}

/* Integer Chebyshev-distance sampler matching rdx_revival_explosion_path_sample().
 * The accumulator stores already-travelled pixels since the previous spawn. */
export function explosionPreviewSampleSegment(a,b,spacingPx,accumulator=0,maxPoints=64){
  const x0=Math.round(Number(a?.x)||0),y0=Math.round(Number(a?.y)||0),x1=Math.round(Number(b?.x)||0),y1=Math.round(Number(b?.y)||0);
  const spacing=Math.max(1,Math.round(Number(spacingPx)||1)),distance=explosionPreviewSegmentDistance({x:x0,y:y0},{x:x1,y:y1});
  let carry=Math.max(0,Math.round(Number(accumulator)||0))%spacing;
  if(distance===0)return {points:[],accumulator:carry};
  const dx=x1-x0,dy=y1-y0,points=[];
  let next=spacing-carry;
  while(next<=distance&&points.length<Math.max(0,Math.round(Number(maxPoints)||0))){
    points.push(Object.freeze({
      x:x0+Math.trunc((dx*next+(dx>=0?distance/2:-distance/2))/distance),
      y:y0+Math.trunc((dy*next+(dy>=0?distance/2:-distance/2))/distance)
    }));
    next+=spacing;
  }
  return {points,accumulator:(carry+distance)%spacing};
}

function variantForSpawn(config,spawnOrdinal){
  const count=Math.max(1,config.variantCount);
  if(config.variantPolicy==='cycle')return (config.completeVariant+spawnOrdinal)%count;
  if(config.variantPolicy==='seed'){
    let value=(config.variantSeed^Math.imul(spawnOrdinal+1,0x45d9f3b))>>>0;
    value=(value^(value>>>16))>>>0; value=Math.imul(value,0x7feb352d)>>>0; value=(value^(value>>>15))>>>0;
    return value%count;
  }
  return config.completeVariant%count;
}

function smokeStart(config){return config.sequenceFamily==='rolling'?4:5;}
export function explosionPreviewLifetime(configValue={}){return normalizeExplosionPreviewConfig(configValue).sequenceFamily==='rolling'?6:9;}

function retireSlot(instances,config){
  if(instances.length<config.maxActiveInstances)return -1;
  const smoke=smokeStart(config);
  let best=0;
  for(let i=1;i<instances.length;i+=1){
    const candidate=instances[i],current=instances[best],candidateSmoke=candidate.age>=smoke,currentSmoke=current.age>=smoke;
    if((candidateSmoke&&!currentSmoke)||(candidateSmoke===currentSmoke&&candidate.age>current.age))best=i;
  }
  return best;
}

function spawn(instances,point,config,ordinal){
  const next=Object.freeze({x:point.x,y:point.y,age:0,variant:variantForSpawn(config,ordinal),spawnOrdinal:ordinal});
  const slot=retireSlot(instances,config);
  if(slot<0)instances.push(next);else instances.splice(slot,1,next);
}

export function explosionPreviewTimeline(pathValue=EXPLOSION_PREVIEW_DEFAULT_PATH,configValue={}){
  const config=normalizeExplosionPreviewConfig(configValue),path=Array.from(pathValue||[],p=>Object.freeze({x:Math.round(Number(p?.x)||0),y:Math.round(Number(p?.y)||0)}));
  const lifetime=explosionPreviewLifetime(config),frames=[],instances=[]; let accumulator=0,previous=null,spawnOrdinal=0;
  const totalTicks=path.length+lifetime;
  for(let tick=0;tick<totalTicks;tick+=1){
    for(let i=instances.length-1;i>=0;i-=1){
      const aged={...instances[i],age:instances[i].age+1};
      if(aged.age>=lifetime)instances.splice(i,1);else instances[i]=Object.freeze(aged);
    }
    const source=tick<path.length?path[tick]:null,spawned=[];
    if(source){
      if(previous===null){spawn(instances,source,config,spawnOrdinal++);spawned.push(source);}
      else if(config.spawnMode==='source-step'){
        if(explosionPreviewSegmentDistance(previous,source)>0){spawn(instances,source,config,spawnOrdinal++);spawned.push(source);}
      }else if(config.spawnMode==='distance'){
        const distance=explosionPreviewSegmentDistance(previous,source);
        if(distance>config.discontinuityPx){
          accumulator=0;spawn(instances,source,config,spawnOrdinal++);spawned.push(source);
        }else{
          const sampled=explosionPreviewSampleSegment(previous,source,config.spacingPx,accumulator,64);accumulator=sampled.accumulator;
          for(const point of sampled.points){spawn(instances,point,config,spawnOrdinal++);spawned.push(point);}
        }
      }
      previous=source;
    }
    frames.push(Object.freeze({tick,source,spawned:Object.freeze(spawned.map(p=>Object.freeze({...p}))),instances:Object.freeze(instances.map(item=>Object.freeze({...item})))}));
  }
  return Object.freeze(frames);
}

export function explosionPreviewDiagnostics(pathValue=EXPLOSION_PREVIEW_DEFAULT_PATH,configValue={}){
  const frames=explosionPreviewTimeline(pathValue,configValue),spawnPoints=frames.flatMap(frame=>frame.spawned),spacings=[];
  for(let i=1;i<spawnPoints.length;i+=1)spacings.push(explosionPreviewSegmentDistance(spawnPoints[i-1],spawnPoints[i]));
  return Object.freeze({
    spawnCount:spawnPoints.length,
    maxActive:frames.reduce((max,frame)=>Math.max(max,frame.instances.length),0),
    spacingMin:spacings.length?Math.min(...spacings):0,
    spacingMax:spacings.length?Math.max(...spacings):0,
    timelineTicks:frames.length
  });
}
