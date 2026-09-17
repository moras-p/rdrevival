import { budget, clone, rect, requireArt } from './document.js';
import { componentBoundary } from './pixel-geometry.js';
import { resolveSelector } from './selectors.js';
import { paletteRampForIndex } from './style-profile.js';

const TRANSFORMS = new Set(['translate','copy-translate','mirror-horizontal','mirror-vertical','rotate-90','rotate-180','rotate-270','scale-integer','scale-nearest','clear','recolor','contour']);
const AGENT_TYPES = new Set([
  'transform_selection','shade_step','remap_ramp','delete_frame','duplicate_frames','bulk_anchor',
  'delete_layer','duplicate_layer','reorder_layers','merge_layers','flatten_visible','cel',
  'palette_add','palette_remove','palette_reorder','palette_ramp','trim_to_selection','pad_canvas',
]);
const integer = Number.isInteger;
const safeId = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value) && !['__proto__','constructor','prototype'].includes(value);

export const isAgentOperation = (op) => AGENT_TYPES.has(op?.type);

function frame(doc, id) {
  const value = doc.frames.find(row => row.id === id);
  requireArt(value, 'TARGET', `Unknown frame: ${id}`, { frameId: id, validFrameIds: doc.frames.map(row => row.id) });
  return value;
}
function layer(doc, id) {
  const value = doc.layers.find(row => row.id === id);
  requireArt(value, 'TARGET', `Unknown layer: ${id}`, { layerId: id, validLayerIds: doc.layers.map(row => row.id) });
  return value;
}
function assertEditable(doc, frameId, layerId) {
  const l = layer(doc, layerId);
  requireArt(!l.locked, 'LOCKED', 'Layer is locked');
  requireArt(!doc.constraints.frameIds || doc.constraints.frameIds.includes(frameId), 'SCOPE', 'Frame is outside edit scope');
  return frame(doc, frameId).cels[layerId];
}
function writePixel(doc, pixels, x, y, color) {
  requireArt(integer(x) && integer(y) && x >= 0 && y >= 0 && x < doc.width && y < doc.height, 'BOUNDS', 'Pixel is outside the frame', { coordinate: [x,y], dimensions: [doc.width,doc.height] });
  requireArt(integer(color) && color >= 0 && color < doc.palette.length, 'PALETTE', 'Invalid palette index', { paletteIndex: color });
  requireArt(!doc.constraints.allowedPalette || doc.constraints.allowedPalette.includes(color), 'PALETTE', 'Color is outside the allowed palette', { paletteIndex: color, allowedPalette: doc.constraints.allowedPalette });
  pixels[y * doc.width + x] = color;
}

export function resolveTargetSet(doc, op) {
  const target = op.targets ?? {};
  let frameIds;
  if (target.allFrames) frameIds = doc.frames.map(row => row.id);
  else if (target.clipId) {
    const clip = doc.clips.find(row => row.id === target.clipId);
    requireArt(clip, 'TARGET', `Unknown clip: ${target.clipId}`);
    const ids = target.preserveOccurrences ? clip.frameIds : [...new Set(clip.frameIds)];
    const start = target.start ?? 0, end = target.end ?? ids.length;
    requireArt(integer(start) && integer(end) && start >= 0 && end >= start && end <= ids.length, 'TARGET', 'Invalid clip target range');
    frameIds = ids.slice(start, end);
  } else if (Array.isArray(target.frameIds)) frameIds = target.frameIds;
  else frameIds = [op.frameId];
  requireArt(frameIds.length > 0 && frameIds.every(id => doc.frames.some(row => row.id === id)), 'TARGET', 'Target set contains an unknown frame', { frameIds });

  let layerIds;
  if (Array.isArray(target.layerIds)) layerIds = target.layerIds;
  else if (Array.isArray(target.layerRoles)) layerIds = doc.layers.filter(row => target.layerRoles.includes(row.role)).map(row => row.id);
  else layerIds = [op.layerId];
  requireArt(layerIds.length > 0 && layerIds.every(id => doc.layers.some(row => row.id === id)), 'TARGET', 'Target set contains an unknown layer', { layerIds });
  return [...new Set(frameIds)].flatMap(frameId => [...new Set(layerIds)].map(layerId => ({ frameId, layerId })));
}

function selectorIndices(doc, snapshot, op, target, context) {
  const selectorMode = op.selectorMode ?? 'per-cell';
  requireArt(['per-cell','source'].includes(selectorMode), 'SELECTOR', 'selectorMode must be per-cell or source');
  const sourceScope = selectorMode === 'source'
    ? { frameId: op.sourceFrameId ?? op.frameId ?? target.frameId, layerId: op.sourceLayerId ?? op.layerId ?? target.layerId }
    : target;
  const sourceDoc = snapshot ?? doc;
  const indices = resolveSelector(sourceDoc, {
    ...sourceScope,
    selector: op.selector ?? { type: 'opaque' },
    checkpointResolver: context.checkpointResolver,
    handleResolver: context.handleResolver,
  });
  return indices;
}

function transformPoint(action, x, y, bounds, op) {
  const [bx, by, bw, bh] = bounds;
  if (action === 'translate' || action === 'copy-translate') return [x + op.dx, y + op.dy];
  if (action === 'mirror-horizontal') return [bx + bw - 1 - (x - bx), y];
  if (action === 'mirror-vertical') return [x, by + bh - 1 - (y - by)];
  if (action === 'rotate-180') return [bx + bw - 1 - (x - bx), by + bh - 1 - (y - by)];
  if (action === 'rotate-90') return [bx + bh - 1 - (y - by), by + (x - bx)];
  if (action === 'rotate-270') return [bx + (y - by), by + bw - 1 - (x - bx)];
  return [x,y];
}
function boundsOf(doc, indices) {
  requireArt(indices.length > 0, 'SELECTOR', 'Selection is empty');
  let minX=doc.width,minY=doc.height,maxX=-1,maxY=-1;
  for (const at of indices) { const x=at%doc.width,y=Math.floor(at/doc.width); minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y); }
  return [minX,minY,maxX-minX+1,maxY-minY+1];
}
function transformedSamples(doc, source, indices, op) {
  const action = op.action;
  requireArt(TRANSFORMS.has(action), 'OP', `Unknown selection transform: ${action}`);
  const bounds = boundsOf(doc, indices), out=[];
  if (action === 'scale-integer') {
    requireArt(integer(op.factor) && op.factor >= 2 && op.factor <= 8, 'OP', 'scale-integer factor must be 2–8');
    const [bx,by] = bounds;
    for (const at of indices) {
      const x=at%doc.width,y=Math.floor(at/doc.width), color=source[at];
      for (let sy=0;sy<op.factor;sy++) for (let sx=0;sx<op.factor;sx++) out.push({ source: at, x: bx + (x-bx)*op.factor + sx, y: by + (y-by)*op.factor + sy, color });
    }
  } else if (action === 'scale-nearest') {
    const numerator=op.numerator, denominator=op.denominator;
    requireArt(integer(numerator)&&integer(denominator)&&numerator>=1&&numerator<=8&&denominator>=1&&denominator<=8&&numerator!==denominator,'OP','scale-nearest requires numerator/denominator 1–8 with a non-1 ratio');
    const [bx,by,bw,bh]=bounds, dw=Math.max(1,Math.floor(bw*numerator/denominator)), dh=Math.max(1,Math.floor(bh*numerator/denominator)), selected=new Set(indices);
    for(let dy=0;dy<dh;dy++) for(let dx=0;dx<dw;dx++){
      const sx=Math.min(bw-1,Math.floor(dx*denominator/numerator)), sy=Math.min(bh-1,Math.floor(dy*denominator/numerator)), at=(by+sy)*doc.width+bx+sx;
      if(selected.has(at)) out.push({source:at,x:bx+dx,y:by+dy,color:source[at]});
    }
  } else if (action === 'contour') {
    requireArt(['inner','outer'].includes(op.contour ?? 'outer'), 'OP', 'Contour must be inner or outer');
    requireArt(integer(op.color), 'PALETTE', 'Contour requires a color index');
    for (const at of componentBoundary(doc, indices, op.contour ?? 'outer')) out.push({ source: at, x: at%doc.width, y: Math.floor(at/doc.width), color: op.color });
  } else if (action === 'clear') {
    for (const at of indices) out.push({ source: at, x: at%doc.width, y: Math.floor(at/doc.width), color: 0 });
  } else if (action === 'recolor') {
    requireArt(integer(op.color), 'PALETTE', 'Recolor requires a palette index');
    const from = op.from;
    for (const at of indices) if (from === undefined || source[at] === from) out.push({ source: at, x: at%doc.width, y: Math.floor(at/doc.width), color: op.color });
  } else {
    if (action === 'translate' || action === 'copy-translate') requireArt(integer(op.dx) && integer(op.dy), 'OP', 'Translate requires integer dx/dy');
    for (const at of indices) {
      const x=at%doc.width,y=Math.floor(at/doc.width), [tx,ty]=transformPoint(action,x,y,bounds,op);
      out.push({ source:at,x:tx,y:ty,color:source[at] });
    }
  }
  return { bounds, out };
}
function applySelectionTransform(doc, op, context) {
  const snapshot = context.snapshot ?? clone(doc), targets = resolveTargetSet(snapshot, op);
  for (const target of targets) {
    const current = assertEditable(doc,target.frameId,target.layerId), sourceFrame=frame(snapshot,target.frameId), source=sourceFrame.cels[target.layerId].slice();
    const indices = selectorIndices(doc,snapshot,op,target,context), sourceSet = new Set(indices);
    const { out } = transformedSamples(doc,source,indices,op), clipping = op.clipping ?? 'reject', collision = op.collision ?? 'overwrite';
    requireArt(['reject','crop'].includes(clipping), 'OP', 'clipping must be reject or crop');
    requireArt(['reject','overwrite-transparent-only','overwrite'].includes(collision), 'OP', 'collision must be reject, overwrite-transparent-only or overwrite');
    const moved = !['copy-translate','clear','recolor','contour'].includes(op.action);
    if (moved) for (const at of indices) current[at]=0;
    for (const sample of out) {
      if (sample.x < 0 || sample.y < 0 || sample.x >= doc.width || sample.y >= doc.height) {
        requireArt(clipping === 'crop', 'BOUNDS', 'Selection transform leaves the frame', { coordinate:[sample.x,sample.y] });
        continue;
      }
      const at=sample.y*doc.width+sample.x, existing=source[at];
      const overlapsSource=sourceSet.has(at);
      if (!overlapsSource && sample.color !== 0 && existing !== 0 && collision !== 'overwrite') requireArt(false,'COLLISION','Selection transform collides with opaque pixels',{ coordinate:[sample.x,sample.y], collision });
      writePixel(doc,current,sample.x,sample.y,sample.color);
    }
    if (op.anchorPolicy === 'move-with-content' && (op.action === 'translate' || op.action === 'copy-translate')) {
      const f=frame(doc,target.frameId); f.anchor=[f.anchor[0]+op.dx,f.anchor[1]+op.dy];
    } else requireArt(op.anchorPolicy === undefined || op.anchorPolicy === 'preserve', 'ANCHOR', 'anchorPolicy must be preserve or move-with-content');
  }
}

function shadeStep(doc, op, context) {
  requireArt(doc.styleProfile, 'STYLE_PROFILE', 'shade_step requires a style profile');
  requireArt(integer(op.step) && op.step !== 0 && Math.abs(op.step) <= 8, 'PALETTE', 'shade_step requires step -8..8 excluding zero');
  const targets=resolveTargetSet(context.snapshot ?? doc,op), snapshot=context.snapshot ?? clone(doc);
  for (const target of targets) {
    const pixels=assertEditable(doc,target.frameId,target.layerId), source=frame(snapshot,target.frameId).cels[target.layerId], indices=selectorIndices(doc,snapshot,op,target,context);
    for (const at of indices) {
      const index=source[at], ramp = op.ramp ? doc.styleProfile.ramps.find(r=>r.name===op.ramp) : paletteRampForIndex(doc.styleProfile,index);
      requireArt(ramp, 'PALETTE', `No palette ramp for index ${index}`);
      const pos=ramp.indices.indexOf(index); requireArt(pos>=0,'PALETTE',`Index ${index} is outside ramp ${ramp.name}`);
      let next=pos+op.step;
      if (op.fallback === 'clamp') next=Math.max(0,Math.min(ramp.indices.length-1,next));
      else requireArt(next>=0 && next<ramp.indices.length,'PALETTE',`shade_step leaves ramp ${ramp.name}`);
      writePixel(doc,pixels,at%doc.width,Math.floor(at/doc.width),ramp.indices[next]);
    }
  }
}
function remapRamp(doc, op, context) {
  requireArt(doc.styleProfile,'STYLE_PROFILE','remap_ramp requires a style profile');
  const from=doc.styleProfile.ramps.find(r=>r.name===op.fromRamp), to=doc.styleProfile.ramps.find(r=>r.name===op.toRamp);
  requireArt(from && to,'PALETTE','Unknown source or destination ramp');
  requireArt(from.indices.length===to.indices.length || op.lengthPolicy==='clamp','PALETTE','Ramp lengths differ; set lengthPolicy=clamp explicitly');
  const mapping=new Map(from.indices.map((idx,pos)=>[idx,to.indices[Math.min(pos,to.indices.length-1)]]));
  const targets=resolveTargetSet(context.snapshot ?? doc,op), snapshot=context.snapshot ?? clone(doc);
  for(const target of targets){const pixels=assertEditable(doc,target.frameId,target.layerId), source=frame(snapshot,target.frameId).cels[target.layerId], indices=selectorIndices(doc,snapshot,op,target,context); for(const at of indices) if(mapping.has(source[at])) writePixel(doc,pixels,at%doc.width,Math.floor(at/doc.width),mapping.get(source[at]));}
}

function insertFrame(doc, newFrame, position) {
  const index = position?.beforeFrameId ? doc.frames.findIndex(f=>f.id===position.beforeFrameId) : position?.afterFrameId ? doc.frames.findIndex(f=>f.id===position.afterFrameId)+1 : doc.frames.length;
  requireArt(index>=0 && index<=doc.frames.length,'TARGET','Invalid frame insertion point');
  doc.frames.splice(index,0,newFrame);
  const cellIndex = position?.beforeFrameId ? doc.layout.cells.indexOf(position.beforeFrameId) : position?.afterFrameId ? doc.layout.cells.indexOf(position.afterFrameId)+1 : doc.layout.cells.length;
  doc.layout.cells.splice(Math.max(0,cellIndex),0,newFrame.id);
}
function deleteFrame(doc, op) {
  const ids=[...(op.frameIds ?? [op.frameId])]; requireArt(ids.length>0 && ids.length<doc.frames.length,'TARGET','Frame deletion must leave at least one frame');
  requireArt(ids.every(id=>doc.frames.some(f=>f.id===id)),'TARGET','Unknown frame in delete_frame');
  const set=new Set(ids);
  for(const clip of doc.clips){const nextIds=[],dur=[]; clip.frameIds.forEach((id,n)=>{if(!set.has(id)){nextIds.push(id);dur.push(clip.durations[n]);}}); requireArt(nextIds.length>0,'CLIP',`Deleting frames would empty clip ${clip.id}`); clip.frameIds=nextIds;clip.durations=dur;}
  doc.frames=doc.frames.filter(f=>!set.has(f.id)); doc.layout.cells=doc.layout.cells.filter(id=>!set.has(id));
  doc.constraints.protected=doc.constraints.protected.filter(p=>!set.has(p.frameId)); if(doc.constraints.frameIds) doc.constraints.frameIds=doc.constraints.frameIds.filter(id=>!set.has(id));
  if(doc.constraints.frameIds?.length===0) doc.constraints.frameIds=[];
}
function duplicateFrames(doc, op) {
  const ids=op.frameIds ?? [op.frameId]; requireArt(ids.length>0 && ids.every(id=>doc.frames.some(f=>f.id===id)),'TARGET','Unknown source frame');
  requireArt(Array.isArray(op.ids) && op.ids.length===ids.length && op.ids.every(safeId) && new Set(op.ids).size===op.ids.length && op.ids.every(id=>!doc.frames.some(f=>f.id===id)),'TARGET','duplicate_frames requires unique destination ids');
  budget(doc.width,doc.height,doc.frames.length+ids.length,doc.layers.length);
  ids.forEach((sourceId,n)=>{const copy=clone(frame(doc,sourceId));copy.id=op.ids[n];insertFrame(doc,copy,n===0?{beforeFrameId:op.beforeFrameId,afterFrameId:op.afterFrameId}:{afterFrameId:op.ids[n-1]});});
  if(op.addToClips){for(const clip of doc.clips){const sourceToNew=new Map(ids.map((id,n)=>[id,op.ids[n]]));const f=[],d=[];clip.frameIds.forEach((id,n)=>{f.push(id);d.push(clip.durations[n]);if(sourceToNew.has(id)){f.push(sourceToNew.get(id));d.push(clip.durations[n]);}});clip.frameIds=f;clip.durations=d;}}
  doc.kind='sheet';
}
function deleteLayer(doc,op){const ids=op.layerIds??[op.layerId];requireArt(ids.length>0&&ids.length<doc.layers.length,'TARGET','Layer deletion must leave at least one layer');const set=new Set(ids);requireArt(ids.every(id=>doc.layers.some(l=>l.id===id)),'TARGET','Unknown layer');for(const l of doc.layers) if(set.has(l.id)) requireArt(!l.locked,'LOCKED','Cannot delete a locked layer');doc.layers=doc.layers.filter(l=>!set.has(l.id));for(const f of doc.frames) for(const id of ids) delete f.cels[id];doc.constraints.protected=doc.constraints.protected.filter(p=>!set.has(p.layerId));}
function duplicateLayer(doc,op){const src=layer(doc,op.layerId);requireArt(safeId(op.id)&&!doc.layers.some(l=>l.id===op.id),'TARGET','Unique destination layer id required');budget(doc.width,doc.height,doc.frames.length,doc.layers.length+1);const copy={...clone(src),id:op.id,name:op.name??`${src.name} copy`,locked:false};const at=op.afterLayerId?doc.layers.findIndex(l=>l.id===op.afterLayerId)+1:doc.layers.length;requireArt(at>0,'TARGET','Unknown layer insertion point');doc.layers.splice(at,0,copy);for(const f of doc.frames)f.cels[op.id]=f.cels[src.id].slice();}
function reorderLayers(doc,op){requireArt(Array.isArray(op.layerIds)&&op.layerIds.length===doc.layers.length&&new Set(op.layerIds).size===doc.layers.length&&op.layerIds.every(id=>doc.layers.some(l=>l.id===id)),'TARGET','Layer order must be a permutation');doc.layers=op.layerIds.map(id=>doc.layers.find(l=>l.id===id));}
function celOp(doc,op){
  requireArt(['copy','move','swap','clear'].includes(op.action),'OP','Unknown cel action');
  const sf=frame(doc,op.sourceFrameId??op.frameId),sl=layer(doc,op.sourceLayerId??op.layerId),source=sf.cels[sl.id].slice();
  const targets=op.targets ? resolveTargetSet(doc,{...op,frameId:op.targetFrameId??op.frameId,layerId:op.targetLayerId??op.layerId}) : [{frameId:op.targetFrameId??op.frameId,layerId:op.targetLayerId??op.layerId}];
  if(op.action==='swap') requireArt(targets.length===1,'OP','cel swap requires exactly one target');
  if(op.action==='move') {requireArt(!sl.locked,'LOCKED','Source layer is locked');requireArt(!targets.some(t=>t.frameId===sf.id&&t.layerId===sl.id),'OP','cel move target set cannot include source cel');}
  for(const target of targets){const df=frame(doc,target.frameId),dl=layer(doc,target.layerId),dest=assertEditable(doc,df.id,dl.id);if(op.action==='clear'){dest.fill(0);continue;}if(op.action==='copy'||op.action==='move')df.cels[dl.id]=source.slice();else{const targetCopy=dest.slice();df.cels[dl.id]=source.slice();sf.cels[sl.id]=targetCopy;}}
  if(op.action==='move') sf.cels[sl.id].fill(0);
}
function mergeLayers(doc,op){const ids=op.layerIds;requireArt(Array.isArray(ids)&&ids.length>=2&&ids.every(id=>doc.layers.some(l=>l.id===id)),'TARGET','merge_layers requires existing layers');const targetId=op.targetLayerId??ids.at(-1);requireArt(ids.includes(targetId),'TARGET','Merge target must be selected');const targetLayer=layer(doc,targetId);requireArt(!targetLayer.locked,'LOCKED','Merge target is locked');for(const f of doc.frames){const out=f.cels[targetId].slice();for(const id of ids){if(id===targetId)continue;const src=f.cels[id];for(let i=0;i<out.length;i++)if(src[i]!==0)out[i]=src[i];}f.cels[targetId]=out;}deleteLayer(doc,{layerIds:ids.filter(id=>id!==targetId)});}
function flattenVisible(doc,op){const visible=doc.layers.filter(l=>l.visible).map(l=>l.id);requireArt(visible.length>0,'TARGET','No visible layers to flatten');const id=op.id??'flattened';requireArt(safeId(id)&&(!doc.layers.some(l=>l.id===id)||visible.includes(id)),'TARGET','Invalid flattened layer id');const frames=doc.frames.map(f=>{const out=Array(doc.width*doc.height).fill(0);for(const lid of visible)for(let i=0;i<out.length;i++)if(f.cels[lid][i]!==0)out[i]=f.cels[lid][i];return out;});const keep=doc.layers.filter(l=>!visible.includes(l.id));doc.layers=[...keep,{id,name:op.name??'Flattened',role:op.role??'generic',visible:true,locked:false}];doc.frames.forEach((f,n)=>{for(const lid of visible)delete f.cels[lid];f.cels[id]=frames[n];});doc.constraints.protected=doc.constraints.protected.filter(p=>!visible.includes(p.layerId));}

function shiftSelector(selector, dx, dy) {
  if (!selector || typeof selector !== 'object') return selector;
  const next=clone(selector), shiftRect=r=>[r[0]+dx,r[1]+dy,r[2],r[3]];
  if (next.rect) next.rect=shiftRect(next.rect);
  if (next.region) next.region=shiftRect(next.region);
  if (integer(next.x)) next.x+=dx; if (integer(next.y)) next.y+=dy;
  if (next.within) next.within=shiftSelector(next.within,dx,dy);
  if (next.selector) next.selector=shiftSelector(next.selector,dx,dy);
  if (Array.isArray(next.selectors)) next.selectors=next.selectors.map(v=>shiftSelector(v,dx,dy));
  if (next.base) next.base=shiftSelector(next.base,dx,dy); if (next.subtract) next.subtract=shiftSelector(next.subtract,dx,dy);
  return next;
}
function rewriteCanvas(doc,{x=0,y=0,width,height}) {
  budget(width,height,doc.frames.length,doc.layers.length);
  requireArt(doc.layers.every(l=>!l.locked),'LOCKED','Unlock layers before changing canvas bounds');
  requireArt(!doc.ratio || width*doc.ratio[1]===height*doc.ratio[0],'DIMENSIONS','Canvas bounds conflict with locked ratio');
  for(const f of doc.frames){
    for(const l of doc.layers){const src=f.cels[l.id],out=Array(width*height).fill(0);for(let ny=0;ny<height;ny++)for(let nx=0;nx<width;nx++){const sx=nx+x,sy=ny+y;if(sx>=0&&sy>=0&&sx<doc.width&&sy<doc.height)out[ny*width+nx]=src[sy*doc.width+sx];}f.cels[l.id]=out;}
    f.anchor=[f.anchor[0]-x,f.anchor[1]-y];
  }
  const oldW=doc.width,oldH=doc.height; doc.width=width;doc.height=height;
  const shifted=[];for(const p of doc.constraints.protected){const [px,py,pw,ph]=p.rect,nx=px-x,ny=py-y;requireArt(nx>=0&&ny>=0&&nx+pw<=width&&ny+ph<=height,'PROTECTED','Canvas change would crop a protected region',{protectedRegion:p,oldDimensions:[oldW,oldH],newDimensions:[width,height]});shifted.push({...p,rect:[nx,ny,pw,ph]});}doc.constraints.protected=shifted;
  if(doc.handoff?.acceptedRegions) doc.handoff.acceptedRegions=doc.handoff.acceptedRegions.map(r=>({...r,selector:shiftSelector(r.selector,-x,-y)}));
}
function trimToSelection(doc,op,context){
  const snapshot=context.snapshot??clone(doc),scope={frameId:op.frameId??snapshot.frames[0].id,layerId:op.layerId??null},indices=resolveSelector(snapshot,{...scope,selector:op.selector??{type:'opaque'},checkpointResolver:context.checkpointResolver,handleResolver:context.handleResolver});
  const bounds=boundsOf(snapshot,indices);rewriteCanvas(doc,{x:bounds[0],y:bounds[1],width:bounds[2],height:bounds[3]});
}
function padCanvas(doc,op){
  for(const key of ['left','right','top','bottom']) requireArt(integer(op[key]??0)&&(op[key]??0)>=0&&(op[key]??0)<=512,'DIMENSIONS',`pad_canvas ${key} must be 0–512`);
  const left=op.left??0,right=op.right??0,top=op.top??0,bottom=op.bottom??0;requireArt(left+right+top+bottom>0,'DIMENSIONS','pad_canvas requires non-zero padding');
  rewriteCanvas(doc,{x:-left,y:-top,width:doc.width+left+right,height:doc.height+top+bottom});
}

function paletteAdd(doc,op){requireArt(!doc.palettePolicy,'PALETTE_POLICY','Fixed palette cannot add colors');requireArt(doc.palette.length<256,'LIMIT','Palette is full');requireArt(Array.isArray(op.rgba)&&op.rgba.length===4&&op.rgba.slice(0,3).every(v=>integer(v)&&v>=0&&v<=255)&&op.rgba[3]===255,'PALETTE','Opaque RGBA required');const at=op.index??doc.palette.length;requireArt(integer(at)&&at>0&&at<=doc.palette.length,'PALETTE','Invalid insertion index');doc.palette.splice(at,0,clone(op.rgba));for(const f of doc.frames)for(const l of doc.layers)f.cels[l.id]=f.cels[l.id].map(v=>v>=at?v+1:v);doc.paletteLocks=doc.paletteLocks.map(v=>v>=at?v+1:v);if(doc.constraints.allowedPalette)doc.constraints.allowedPalette=doc.constraints.allowedPalette.map(v=>v>=at?v+1:v);for(const ramp of doc.styleProfile?.ramps??[])ramp.indices=ramp.indices.map(v=>v>=at?v+1:v);}
function paletteRemove(doc,op){requireArt(!doc.palettePolicy,'PALETTE_POLICY','Fixed palette cannot remove colors');requireArt(integer(op.index)&&op.index>0&&op.index<doc.palette.length,'PALETTE','Invalid removable palette index');for(const f of doc.frames)for(const l of doc.layers)requireArt(!f.cels[l.id].includes(op.index),'PALETTE','Cannot remove a palette index still used by pixels');doc.palette.splice(op.index,1);for(const f of doc.frames)for(const l of doc.layers)f.cels[l.id]=f.cels[l.id].map(v=>v>op.index?v-1:v);doc.paletteLocks=doc.paletteLocks.filter(v=>v!==op.index).map(v=>v>op.index?v-1:v);if(doc.constraints.allowedPalette)doc.constraints.allowedPalette=doc.constraints.allowedPalette.filter(v=>v!==op.index).map(v=>v>op.index?v-1:v);for(const ramp of doc.styleProfile?.ramps??[])ramp.indices=ramp.indices.filter(v=>v!==op.index).map(v=>v>op.index?v-1:v);}
function paletteReorder(doc,op){requireArt(!doc.palettePolicy,'PALETTE_POLICY','Fixed palette cannot reorder colors');requireArt(Array.isArray(op.indices)&&op.indices.length===doc.palette.length&&op.indices[0]===0&&new Set(op.indices).size===doc.palette.length&&op.indices.every(v=>integer(v)&&v>=0&&v<doc.palette.length),'PALETTE','Palette order must be a permutation preserving transparent index zero');const inverse=new Map(op.indices.map((oldIndex,newIndex)=>[oldIndex,newIndex]));doc.palette=op.indices.map(i=>doc.palette[i]);for(const f of doc.frames)for(const l of doc.layers)f.cels[l.id]=f.cels[l.id].map(v=>inverse.get(v));doc.paletteLocks=doc.paletteLocks.map(v=>inverse.get(v));if(doc.constraints.allowedPalette)doc.constraints.allowedPalette=doc.constraints.allowedPalette.map(v=>inverse.get(v));for(const ramp of doc.styleProfile?.ramps??[])ramp.indices=ramp.indices.map(v=>inverse.get(v));}
function paletteRamp(doc,op){requireArt(!doc.palettePolicy,'PALETTE_POLICY','Fixed palette cannot generate colors');requireArt(Array.isArray(op.from)&&Array.isArray(op.to)&&op.from.length>=3&&op.to.length>=3&&integer(op.steps)&&op.steps>=2&&op.steps<=32,'PALETTE','palette_ramp requires from/to RGB and 2–32 steps');requireArt(doc.palette.length+op.steps<=256,'LIMIT','Palette ramp exceeds 256 colors');for(let n=0;n<op.steps;n++){const t=n/(op.steps-1),rgb=[0,1,2].map(i=>Math.round(op.from[i]+(op.to[i]-op.from[i])*t));doc.palette.push([...rgb,255]);}}

export function applyAgentOperation(doc, op, context = {}) {
  switch(op.type){
    case 'transform_selection': return applySelectionTransform(doc,op,context);
    case 'shade_step': return shadeStep(doc,op,context);
    case 'remap_ramp': return remapRamp(doc,op,context);
    case 'delete_frame': return deleteFrame(doc,op);
    case 'duplicate_frames': return duplicateFrames(doc,op);
    case 'bulk_anchor': {const ids=op.frameIds??doc.frames.map(f=>f.id);requireArt(Array.isArray(op.anchor)&&op.anchor.length===2&&op.anchor.every(integer),'ANCHOR','bulk_anchor requires integer anchor');for(const id of ids)frame(doc,id).anchor=clone(op.anchor);return;}
    case 'delete_layer': return deleteLayer(doc,op);
    case 'duplicate_layer': return duplicateLayer(doc,op);
    case 'reorder_layers': return reorderLayers(doc,op);
    case 'merge_layers': return mergeLayers(doc,op);
    case 'flatten_visible': return flattenVisible(doc,op);
    case 'cel': return celOp(doc,op);
    case 'palette_add': return paletteAdd(doc,op);
    case 'palette_remove': return paletteRemove(doc,op);
    case 'palette_reorder': return paletteReorder(doc,op);
    case 'palette_ramp': return paletteRamp(doc,op);
    case 'trim_to_selection': return trimToSelection(doc,op,context);
    case 'pad_canvas': return padCanvas(doc,op);
    default: requireArt(false,'OP',`Unknown agent operation: ${op.type}`);
  }
}

export function agentOperationWork(doc, op) {
  if (['transform_selection','shade_step','remap_ramp'].includes(op.type)) return doc.width*doc.height*Math.max(1, resolveTargetSet(doc,op).length);
  if (['merge_layers','flatten_visible','cel','trim_to_selection','pad_canvas'].includes(op.type)) return doc.width*doc.height*doc.frames.length*doc.layers.length;
  return 0;
}
