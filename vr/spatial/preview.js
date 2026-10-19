import { SM00_SPATIAL_REPLAY } from './fixture.js';

// Reference origins come from recorded native SM00 evidence, not from pixels
// sampled out of the CRT canvas. Only live events can move these anchors.
export const SOURCE_KINDS = Object.freeze([
  {kind:'footstep', name:'Footsteps', short:'Steps', color:0x6ee5d5,
    volume:{x:0.32,y:0.18,z:0.22}},
  {kind:'impact', name:'Boulder impact', short:'Boulder', color:0xf5be67,
    volume:{x:0.36,y:0.22,z:0.26}},
  {kind:'death', name:'Enemy death', short:'Enemy', color:0xff8194,
    volume:{x:0.28,y:0.34,z:0.2}}
]);
const nativeKind = {footstep:'player.footstep',impact:'world.boulder.impact',death:'enemy.died'};

export function projectReferenceSources(projector) {
  return SOURCE_KINDS.flatMap(config => {
    const native=SM00_SPATIAL_REPLAY.find(item=>item.kind===nativeKind[config.kind]);
    const rdx=native && {x:native.x,y:native.y};
    const room=rdx && projector?.project(rdx);
    return room ? [{...config,rdx,room,origin:'reference'}] : [];
  });
}

/** The side-elevation uses the same metre coordinates as the WebAudio panners.
 * Include the CRT reference and safe padding so out-of-room cues remain visible. */
export function sideElevation(sources,crt={x:0,y:1.4}) {
  const extents=sources.flatMap(item=>[
    {x:item.room.x-item.volume.x/2,y:item.room.y-item.volume.y/2},
    {x:item.room.x+item.volume.x/2,y:item.room.y+item.volume.y/2}
  ]);
  const bounds=[crt,...extents];
  const xs=bounds.map(point=>point.x),ys=bounds.map(point=>point.y);
  const minX=Math.min(...xs)-0.6,maxX=Math.max(...xs)+0.6;
  const minY=Math.min(...ys)-0.6,maxY=Math.max(...ys)+0.6;
  const position=point=>({left:100*(point.x-minX)/(maxX-minX),
    top:100*(maxY-point.y)/(maxY-minY)});
  return {crt:position(crt),sources:sources.map(item=>{
    const min=position({x:item.room.x-item.volume.x/2,y:item.room.y+item.volume.y/2});
    const max=position({x:item.room.x+item.volume.x/2,y:item.room.y-item.volume.y/2});
    return {...item,plot:{
      left:100*(item.room.x-minX)/(maxX-minX),
      top:100*(maxY-item.room.y)/(maxY-minY),
      width:Math.max(8,max.left-min.left),
      height:Math.max(8,max.top-min.top)
    }};
  })};
}

export function replaceObservedSource(sources,observation,origin='live') {
  return sources.map(item=>item.kind===observation.kind ?
    {...item,rdx:{...observation.rdx},room:{...observation.room},origin} : item);
}
