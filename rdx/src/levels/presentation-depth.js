import { PixelBuffer } from '../render/pixel-buffer.js';
import { normalizePresentationDepthSeedBaseline, presentationDepthSeedBaselineAt, planeBVisiblePixelMaskAt } from './presentation-depth-seed.js';

export const PRESENTATION_DEPTH_SCHEMA = 'rdr.presentation_depth.v2';
export const PRESENTATION_DEPTH_RESOLVED_SCHEMA = 'rdr.presentation_depth_resolved.v2';
export const PRESENTATION_BANDS = Object.freeze(['backdrop', 'midground', 'foreground']);
export const PRESENTATION_PLANES = Object.freeze(['A', 'B']);
export const PRESENTATION_AUTHORABLE_PLANES = Object.freeze(['A', 'B']);
export const PRESENTATION_ALLOWED_BANDS = Object.freeze({ A:Object.freeze(['backdrop','midground','foreground']), B:Object.freeze(['backdrop','midground']) });

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const integer = value => value !== null && value !== undefined && Number.isInteger(Number(value));
const finite = value => value !== null && value !== undefined && Number.isFinite(Number(value));

function assert(condition, message) { if (!condition) throw new Error(`Presentation depth: ${message}`); }

export function normalizePresentationDepthConfig(input) {
  const source = clone(input || {});
  assert(source.schema === PRESENTATION_DEPTH_SCHEMA, `expected ${PRESENTATION_DEPTH_SCHEMA}`);
  const planeDefaults = { A:String(source?.planeDefaults?.A || 'foreground'), B:String(source?.planeDefaults?.B || 'midground') };
  for (const plane of PRESENTATION_PLANES) assert(PRESENTATION_ALLOWED_BANDS[plane].includes(planeDefaults[plane]), `invalid ${plane} default ${planeDefaults[plane]}`);
  assert(planeDefaults.A === 'foreground', 'Plane A default must remain foreground');
  assert(planeDefaults.B === 'midground', 'Plane B default must remain midground');
  const seenIds = new Set(), claimedTiles = new Map();
  const classes = (Array.isArray(source.classes) ? source.classes : []).map(row => {
    const id = String(row?.id || '').trim(), plane = String(row?.plane || '').toUpperCase(), band = String(row?.band || '');
    assert(id, 'class id is required'); assert(!seenIds.has(id), `duplicate class id ${id}`); seenIds.add(id);
    assert(PRESENTATION_AUTHORABLE_PLANES.includes(plane), `${id} has invalid plane ${plane}`);
    assert(PRESENTATION_ALLOWED_BANDS[plane].includes(band), `${id} has invalid ${plane} band ${band}`);
    const globalTiles = [...new Set((row?.globalTiles || []).map(Number))].sort((a,b)=>a-b);
    assert(globalTiles.length > 0, `${id} requires at least one global tile`);
    for (const tile of globalTiles) {
      assert(integer(tile) && tile >= 0 && tile <= 0xffff, `${id} has invalid global tile ${tile}`);
      const key=`${plane}:${tile}`,prior=claimedTiles.get(key);
      assert(!prior || prior.band===band, `${id} conflicts with ${prior?.id || 'another class'} for ${key}`);
      claimedTiles.set(key,{id,band});
    }
    return Object.freeze({ id, plane, band, globalTiles:Object.freeze(globalTiles), label:String(row?.label || id), provenance:row?.provenance ? Object.freeze(clone(row.provenance)) : null });
  });
  return Object.freeze({ schema:PRESENTATION_DEPTH_SCHEMA, version:Number(source.version || 2), bands:Object.freeze([...PRESENTATION_BANDS]), planeDefaults:Object.freeze(planeDefaults), classes:Object.freeze(classes) });
}

export function normalizePresentationDepthOverride(row) {
  const id=String(row?.id||'').trim(), plane=String(row?.plane||'A').toUpperCase(), band=String(row?.band||''), bounds=Array.isArray(row?.bounds)?row.bounds.slice(0,4).map(Number):[];
  assert(id,'override id is required'); assert(PRESENTATION_AUTHORABLE_PLANES.includes(plane),`${id} has invalid plane ${plane}`); assert(PRESENTATION_ALLOWED_BANDS[plane].includes(band),`${id} has invalid ${plane} band ${band}`); assert(bounds.length===4&&bounds.every(finite)&&bounds[2]>0&&bounds[3]>0,`${id} bounds must be [x,y,w,h] with positive size`);
  return Object.freeze({ id, plane, band, bounds:Object.freeze(bounds), source:String(row?.source||'reviewed-room'), provenance:row?.provenance?Object.freeze(clone(row.provenance)):null });
}

export function validatePresentationDepthOverrides(rows) {
  const normalized=(rows||[]).map(normalizePresentationDepthOverride),seen=new Set();
  for(const row of normalized){assert(!seen.has(row.id),`duplicate override id ${row.id}`);seen.add(row.id);}
  for(let i=0;i<normalized.length;i++)for(let j=i+1;j<normalized.length;j++){
    const a=normalized[i],b=normalized[j];if(a.plane!==b.plane||a.band===b.band)continue;
    const[ax,ay,aw,ah]=a.bounds,[bx,by,bw,bh]=b.bounds,overlap=ax<bx+bw&&bx<ax+aw&&ay<by+bh&&by<ay+ah;
    if(overlap&&aw*ah===bw*bh)throw new Error(`Presentation depth: ambiguous equal-specificity overrides ${a.id} and ${b.id}`);
  }
  return Object.freeze(normalized);
}

export function resolvePresentationDepthModel(config, overrides=[], seedBaseline=null) {
  const shared=normalizePresentationDepthConfig(config),local=validatePresentationDepthOverrides(overrides),baseline=normalizePresentationDepthSeedBaseline(seedBaseline);
  return Object.freeze({schema:PRESENTATION_DEPTH_RESOLVED_SCHEMA,version:shared.version,planeDefaults:shared.planeDefaults,classes:shared.classes,overrides:local,...(baseline?{seedBaseline:baseline}:{})});
}

export function presentationDepthTileRuleMap(model,plane='A'){
  const normalizedPlane=String(plane).toUpperCase(),rules=new Map();
  for(const row of model?.classes||[]){if(row.plane!==normalizedPlane)continue;for(const tile of row.globalTiles||[])rules.set(Number(tile),row);}
  return rules;
}

function seedBandAt(model, normalizedPlane, x, y) {
  if(normalizedPlane!=='B'||!model?.seedBaseline||!finite(x)||!finite(y))return null;
  return presentationDepthSeedBaselineAt(model.seedBaseline,{x:Number(x),y:Number(y)});
}

export function presentationDepthAt(model,{plane='A',globalTile=null,x=null,y=null}={}){
  const normalizedPlane=String(plane).toUpperCase();
  let band=String(model?.planeDefaults?.[normalizedPlane]||(normalizedPlane==='A'?'foreground':'midground')),rule=null;
  const seed=seedBandAt(model,normalizedPlane,x,y);
  if(seed){band=seed.band;rule=Object.freeze({kind:'seed-baseline',id:String(model.seedBaseline.authority||'generated-open-close-seed-v2')});}
  if(integer(globalTile)){
    const tileRule=presentationDepthTileRuleMap(model,normalizedPlane).get(Number(globalTile))||null;
    if(tileRule){band=tileRule.band;rule=Object.freeze({kind:'class',id:tileRule.id});}
  }
  if(finite(x)&&finite(y)){
    let winner=null,winnerArea=Infinity;
    for(const candidate of model?.overrides||[]){
      if(candidate.plane!==normalizedPlane)continue;
      const[rx,ry,rw,rh]=candidate.bounds;
      if(Number(x)<rx||Number(y)<ry||Number(x)>=rx+rw||Number(y)>=ry+rh)continue;
      const area=rw*rh;
      if(area<winnerArea){winner=candidate;winnerArea=area;continue;}
      if(area===winnerArea&&winner&&winner.band!==candidate.band)throw new Error(`Presentation depth: ambiguous equal-specificity overrides ${winner.id} and ${candidate.id} at ${x},${y}`);
    }
    if(winner){band=winner.band;rule=Object.freeze({kind:'override',id:winner.id});}
  }
  return Object.freeze({band,rule});
}

function copyPixel(from,to,x,y){const i=(y*from.width+x)*4;if(!from.data[i+3])return;to.data[i]=from.data[i];to.data[i+1]=from.data[i+1];to.data[i+2]=from.data[i+2];to.data[i+3]=from.data[i+3];}

export function composePresentationDepthPlanes(splitB,splitA){
  const reference=splitB?.midground||splitB?.backdrop||splitA?.foreground||splitA?.midground||splitA?.backdrop;
  if(!reference)throw new Error('Presentation depth: plane split composition requires at least one buffer');
  const sameSize=buffer=>!buffer||(buffer.width===reference.width&&buffer.height===reference.height);
  for(const buffer of [splitB?.backdrop,splitB?.midground,splitA?.backdrop,splitA?.midground,splitA?.foreground])
    if(!sameSize(buffer))throw new Error('Presentation depth: plane split buffers must have identical dimensions');
  const backdrop=new PixelBuffer(reference.width,reference.height,[0,0,0,0]);
  if(splitB?.backdrop)backdrop.blit(splitB.backdrop,0,0,{useAlpha:true});
  if(splitA?.backdrop)backdrop.blit(splitA.backdrop,0,0,{useAlpha:true});
  const midground=new PixelBuffer(reference.width,reference.height,[0,0,0,0]);
  if(splitB?.midground)midground.blit(splitB.midground,0,0,{useAlpha:true});
  if(splitA?.midground)midground.blit(splitA.midground,0,0,{useAlpha:true});
  const foreground=splitA?.foreground||new PixelBuffer(reference.width,reference.height,[0,0,0,0]);
  return Object.freeze({backdrop,midground,foreground});
}

export function splitPlaneByPresentationDepth({source,model,mapDecoder,mapId,plane='A',phase=0,topology=null,viewport={x:0,y:0,width:source.width,height:source.height},cropToVisibleSource=false,uncroppedCells=null}){
  const outputs=Object.fromEntries(PRESENTATION_BANDS.map(band=>[band,new PixelBuffer(source.width,source.height,[0,0,0,0])]));
  const normalizedPlane=String(plane).toUpperCase(),tileRules=presentationDepthTileRuleMap(model,normalizedPlane);
  const uncropped = uncroppedCells instanceof Set ? uncroppedCells : new Set(uncroppedCells || []);
  const vx=Number(viewport.x||0),vy=Number(viewport.y||0),gx0=Math.floor(vx/8),gy0=Math.floor(vy/8),gx1=Math.ceil((vx+source.width)/8),gy1=Math.ceil((vy+source.height)/8);
  for(let gy=gy0;gy<gy1;gy++)for(let gx=gx0;gx<gx1;gx++){
    const visibleMask = cropToVisibleSource && normalizedPlane === 'B' && !uncropped.has(`${gx},${gy}`)
      ? planeBVisiblePixelMaskAt({ mapDecoder, mapId, gx, gy, phase, topology })?.mask || null
      : null;
    const cell=mapDecoder?.inspectGridCell?.(Number(mapId),gx,gy,phase,{topology}),visual=normalizedPlane==='A'?cell?.visual?.foreground:cell?.visual?.background,globalTile=Number(visual?.resolution?.globalTile),classRule=Number.isInteger(globalTile)?tileRules.get(globalTile):null;
    const seed=seedBandAt(model,normalizedPlane,gx*8+4,gy*8+4);
    const defaultBand=classRule?.band||seed?.band||model?.planeDefaults?.[normalizedPlane]||(normalizedPlane==='A'?'foreground':'midground');
    for(let py=0;py<8;py++)for(let px=0;px<8;px++){
      if (visibleMask && !visibleMask[py * 8 + px]) continue;
      const sx=gx*8+px-vx,sy=gy*8+py-vy;if(sx<0||sy<0||sx>=source.width||sy>=source.height)continue;
      const wx=gx*8+px,wy=gy*8+py;let band=defaultBand,winner=null,winnerArea=Infinity;
      for(const candidate of model?.overrides||[]){
        if(candidate.plane!==normalizedPlane)continue;const[rx,ry,rw,rh]=candidate.bounds;if(wx<rx||wy<ry||wx>=rx+rw||wy>=ry+rh)continue;
        const area=rw*rh;if(area<winnerArea){winner=candidate;winnerArea=area;}else if(area===winnerArea&&winner&&winner.band!==candidate.band)throw new Error(`Presentation depth: ambiguous equal-specificity overrides ${winner.id} and ${candidate.id}`);
      }
      if(winner)band=winner.band;copyPixel(source,outputs[band],sx,sy);
    }
  }
  return Object.freeze(outputs);
}
