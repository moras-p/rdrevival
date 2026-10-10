export const PRESENTATION_OCCLUSION_SCHEMA = 'rdr.presentation_occlusion.v1';
export const PRESENTATION_OCCLUSION_RESOLVED_SCHEMA = 'rdr.presentation_occlusion_resolved.v1';
export const PRESENTATION_OCCLUSION_CLASSES = Object.freeze(['none','embedded']);
export const PRESENTATION_OCCLUSION_PLANES = Object.freeze(['A','B']);

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const integer = value => value !== null && value !== undefined && Number.isInteger(Number(value));
const finite = value => value !== null && value !== undefined && Number.isFinite(Number(value));
function assert(condition, message) { if (!condition) throw new Error(`Presentation occlusion: ${message}`); }

// Matches the generated C row (S16 origin, U16 extents), including the
// representable exclusive right/bottom edge. Reject lossy JS→C conversion.
function nativeWorldRect(bounds) {
  return bounds.length === 4 && bounds.every(Number.isInteger) &&
    bounds[0] >= -32768 && bounds[0] <= 32767 &&
    bounds[1] >= -32768 && bounds[1] <= 32767 &&
    bounds[2] > 0 && bounds[2] <= 65535 &&
    bounds[3] > 0 && bounds[3] <= 65535 &&
    bounds[0] + bounds[2] <= 32767 && bounds[1] + bounds[3] <= 32767;
}

export function normalizePresentationOcclusionConfig(input) {
  const source = clone(input || {});
  assert(source.schema === PRESENTATION_OCCLUSION_SCHEMA, `expected ${PRESENTATION_OCCLUSION_SCHEMA}`);
  const seenIds = new Set(), claimedTiles = new Map();
  const classes = (Array.isArray(source.classes) ? source.classes : []).map(row => {
    const id=String(row?.id||'').trim(),plane=String(row?.plane||'').toUpperCase(),cover=String(row?.cover||'');
    assert(id,'class id is required'); assert(!seenIds.has(id),`duplicate class id ${id}`); seenIds.add(id);
    assert(PRESENTATION_OCCLUSION_PLANES.includes(plane),`${id} has invalid plane ${plane}`);
    assert(cover === 'embedded',`${id} shared class cover must be embedded`);
    const globalTiles=[...new Set((row?.globalTiles||[]).map(Number))].sort((a,b)=>a-b);
    assert(globalTiles.length>0,`${id} requires at least one global tile`);
    for(const tile of globalTiles){
      assert(integer(tile)&&tile>=0&&tile<=0xffff,`${id} has invalid global tile ${tile}`);
      const key=`${plane}:${tile}`,prior=claimedTiles.get(key);
      assert(!prior||prior.cover===cover,`${id} conflicts with ${prior?.id||'another class'} for ${key}`);
      claimedTiles.set(key,{id,cover});
    }
    return Object.freeze({id,plane,cover,globalTiles:Object.freeze(globalTiles),label:String(row?.label||id),provenance:row?.provenance?Object.freeze(clone(row.provenance)):null});
  });
  const overrides=(Array.isArray(source.overrides)?source.overrides:[]).map(row=>{
    const id=String(row?.id||'').trim(),plane=String(row?.plane||'').toUpperCase(),cover=String(row?.cover||''),bounds=Array.isArray(row?.bounds)?row.bounds.slice(0,4).map(Number):[];
    const submap=Number(row?.submap),mapId=Number(row?.mapId);
    assert(id,'override id is required'); assert(!seenIds.has(id),`duplicate id ${id}`); seenIds.add(id);
    assert(integer(submap)&&submap>=0&&submap<=255,`${id} has invalid submap`);
    assert(integer(mapId)&&mapId>=0&&mapId<=65535,`${id} has invalid mapId`);
    assert(PRESENTATION_OCCLUSION_PLANES.includes(plane),`${id} has invalid plane ${plane}`);
    assert(PRESENTATION_OCCLUSION_CLASSES.includes(cover),`${id} has invalid cover ${cover}`);
    assert(nativeWorldRect(bounds),`${id} bounds must be integral [x,y,width,height] in native world-coordinate range`);
    return Object.freeze({id,submap,mapId,plane,cover,bounds:Object.freeze(bounds),source:String(row?.source||'reviewed-room'),provenance:row?.provenance?Object.freeze(clone(row.provenance)):null});
  });
  const claimedClips = new Set();
  const clipWindows = (Array.isArray(source.clipWindows) ? source.clipWindows : []).map(row => {
    const id=String(row?.id||'').trim(),submap=Number(row?.submap),mapId=Number(row?.mapId),mark=Number(row?.mark);
    const bounds=Array.isArray(row?.bounds)?row.bounds.map(Number):[];
    assert(id && !seenIds.has(id),`duplicate or missing clip window id ${id}`); seenIds.add(id);
    assert(integer(submap)&&submap>=0&&submap<=255,`${id} has invalid submap`);
    assert(integer(mapId)&&mapId>=0&&mapId<=65535,`${id} has invalid mapId`);
    assert(integer(mark)&&mark>0&&mark<=65535,`${id} has invalid source mark`);
    assert(nativeWorldRect(bounds),
      `${id} bounds must be [x,y,width,height] in supported world pixels`);
    const key=`${submap}:${mapId}:${mark}`;
    assert(!claimedClips.has(key),`${id} duplicates a source mark visibility window`); claimedClips.add(key);
    return Object.freeze({id,submap,mapId,mark,bounds:Object.freeze(bounds),source:String(row?.source||'reviewed-room'),provenance:row?.provenance?Object.freeze(clone(row.provenance)):null});
  });
  for(let i=0;i<overrides.length;i++)for(let j=i+1;j<overrides.length;j++){
    const a=overrides[i],b=overrides[j];
    if(a.submap!==b.submap||a.mapId!==b.mapId||a.plane!==b.plane||a.cover===b.cover)continue;
    const[ax,ay,aw,ah]=a.bounds,[bx,by,bw,bh]=b.bounds,overlap=ax<bx+bw&&bx<ax+aw&&ay<by+bh&&by<ay+ah;
    if(overlap&&aw*ah===bw*bh)throw new Error(`Presentation occlusion: ambiguous equal-specificity overrides ${a.id} and ${b.id}`);
  }
  return Object.freeze({schema:PRESENTATION_OCCLUSION_SCHEMA,version:Number(source.version||1),classes:Object.freeze(classes),overrides:Object.freeze(overrides),clipWindows:Object.freeze(clipWindows)});
}

export function resolvePresentationOcclusionModel(config,{submap=null,mapId=null}={}){
  const shared=normalizePresentationOcclusionConfig(config);
  const local=shared.overrides.filter(row=>(submap==null||row.submap===Number(submap))&&(mapId==null||row.mapId===Number(mapId)));
  return Object.freeze({schema:PRESENTATION_OCCLUSION_RESOLVED_SCHEMA,version:shared.version,classes:shared.classes,overrides:Object.freeze(local),clipWindows:Object.freeze(shared.clipWindows.filter(row=>(submap==null||row.submap===Number(submap))&&(mapId==null||row.mapId===Number(mapId))))});
}

export function presentationOcclusionTileRuleMap(model,plane='B'){
  const p=String(plane).toUpperCase(),rules=new Map();
  for(const row of model?.classes||[]){if(row.plane!==p)continue;for(const tile of row.globalTiles||[])rules.set(Number(tile),row);}
  return rules;
}

export function presentationOcclusionAt(model,{plane='B',globalTile=null,x=null,y=null}={}){
  const p=String(plane).toUpperCase();
  let cover='none',rule=null;
  if(integer(globalTile)){
    const tileRule=presentationOcclusionTileRuleMap(model,p).get(Number(globalTile))||null;
    if(tileRule){cover=tileRule.cover;rule=Object.freeze({kind:'class',id:tileRule.id});}
  }
  if(finite(x)&&finite(y)){
    let winner=null,winnerArea=Infinity;
    for(const candidate of model?.overrides||[]){
      if(candidate.plane!==p)continue;
      const[rx,ry,rw,rh]=candidate.bounds;
      if(Number(x)<rx||Number(y)<ry||Number(x)>=rx+rw||Number(y)>=ry+rh)continue;
      const area=rw*rh;
      if(area<winnerArea){winner=candidate;winnerArea=area;continue;}
      if(area===winnerArea&&winner&&winner.cover!==candidate.cover)throw new Error(`Presentation occlusion: ambiguous equal-specificity overrides ${winner.id} and ${candidate.id}`);
    }
    if(winner){cover=winner.cover;rule=Object.freeze({kind:'override',id:winner.id});}
  }
  return Object.freeze({cover,rule});
}
