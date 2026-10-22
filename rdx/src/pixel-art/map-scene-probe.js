/** Audit-only movement of source-verified actors, visible-only fallbacks, or
 * independently decoded PN test sprites. Source edits stay independent. */
import { PixelBuffer } from '../render/pixel-buffer.js';
import { composePreviewLayers } from '../preview/preview-render-primitives.js';
import { validateMapScene } from './map-scene.js';
import { requireArt } from './document.js';

function bandsFor(scene,draft) {
  const [w,h]=scene.size;
  const bands=Object.fromEntries(scene.bandOrder.map(name=>{
    const b=new PixelBuffer(w,h);b.data.set(scene.bands[name]);return [name,b];
  }));
  if(draft) for(const {cell,rows} of draft.cells.values()) {
    if(rows.every((row,y)=>row.join('')===cell.tileRows[y]))continue;
    const b=bands[cell.editBand], left=cell.worldRect[0]-scene.cropWorld[0],top=cell.worldRect[1]-scene.cropWorld[1];
    for(let y=0;y<8;y++)for(let x=0;x<8;x++) {
      const index=Number.parseInt(rows[y][x],16);
      b.setPixel(left+x,top+y,index===0&&cell.transparentZero?[0,0,0,0]:scene.palette[cell.paletteLine*16+index]);
    }
  }
  return bands;
}

export function newSceneProbe(scene,id) {
  validateMapScene(scene);
  const source=[...(scene.actorProbes||[]),...(scene.testProbes||[])].find(row=>row.id===id);
  requireArt(source,'UNRESOLVED_ACTOR','No uniquely isolated canonical actor for this ID');
  return {source,dx:0,dy:0};
}

export function moveSceneProbe(probe,dx,dy) {
  requireArt(probe && Number.isInteger(dx) && Number.isInteger(dy) && Math.abs(dx)<=128 && Math.abs(dy)<=128,
    'PROBE_BOUNDS','Actor audit offset must be an integer within ±128 px');
  probe.dx=dx;probe.dy=dy;return probe;
}

/** Compose a source-bound draft with an isolated visible silhouette moved to a
 * new audit location. This is not a native collision or occlusion simulation:
 * the silhouette already lost any originally masked pixels. */
export function renderSceneProbe(scene,{draft=null,probe=null,diagnostic='none'}={}) {
  requireArt(scene?.schema === 'rdr.map_scene_extract.v1','SCENE_SCHEMA','Expected map-scene capture');
  requireArt(['none','ownership','occlusion','terrain','cover'].includes(diagnostic),'SCENE_DIAGNOSTIC','Unknown diagnostic mode');
  const bands=bandsFor(scene,draft), [ox,oy,w,h]=scene.cropWorld;
  const coverMasks=draft?.coverCells?.size ? {
    ...scene.coverMasks,normal:[...scene.coverMasks.normal]
  } : scene.coverMasks;
  if(draft?.coverCells?.size) for(const entry of draft.coverCells.values()) {
    const left=entry.cell[0]*8-ox,top=entry.cell[1]*8-oy;
    for(let y=0;y<8;y++)for(let x=0;x<8;x++)
      coverMasks.normal[(top+y)*w+left+x]=(entry.rows[y]>>>x)&1;
  }
  let covered=0,visible=0,clipped=0,localCover=0,actorOverlap=0;
  const overlaid=[];
  if(probe) {
    const {source,dx,dy}=probe,[x0,y0,pw,ph]=source.worldRect;
    requireArt([...(scene.actorProbes||[]),...(scene.testProbes||[])].includes(source),'UNRESOLVED_ACTOR','Probe must belong to this source scene');
    const band=bands[source.band];
    // Independent PN tests were never present in the captured room: they
    // overlay the scene without erasing real native actor pixels. Only a
    // verified existing isolated source can be lifted out and moved.
    if(source.kind!=='test-pn') for(let y=0;y<ph;y++)for(let x=0;x<pw;x++) {
      const si=(y*pw+x)*4;
      if(source.rgba[si+3])band.setPixel(x0+x-ox,y0+y-oy,[0,0,0,0]);
    }
    const sprite=source.sourceRgba || {worldRect:source.worldRect,rgba:source.rgba};
    const [sx,sy,sw,sh]=sprite.worldRect;
    const masks=(sprite.coverModes||[]).map(mode=>coverMasks?.[mode]);
    for(let y=0;y<sh;y++)for(let x=0;x<sw;x++) {
      const si=(y*sw+x)*4;if(!sprite.rgba[si+3])continue;
      const tx=sx+x+dx-ox,ty=sy+y+dy-oy;
      if(tx<0||ty<0||tx>=w||ty>=h){clipped++;continue;}
      const pixelIndex=ty*w+tx, destIndex=pixelIndex*4+3;
      if(source.kind==='test-pn' && band.data[destIndex]>0) actorOverlap++;
      const nativeStyleCover=masks.some(mask=>mask?.[pixelIndex]===1);
      const fore=bands.foreground.data[destIndex]>0;
      const front=bands.frontActors.data[destIndex]>0;
      const mid=source.band==='embeddedActors'&&bands.midground.data[destIndex]>0;
      if(nativeStyleCover){localCover++;covered++;}
      else if(fore||front||mid)covered++;else visible++;
      if(diagnostic==='occlusion' && (fore||front||mid||nativeStyleCover))overlaid.push([tx,ty]);
      if(!nativeStyleCover)band.setPixel(tx,ty,sprite.rgba.slice(si,si+4));
    }
  }
  const image=composePreviewLayers(bands.backdrop,bands.actors,bands.foreground,bands.frontActors,bands.embeddedActors,bands.midground);
  if(diagnostic==='terrain' && scene.terrain) {
    // Read-only semantic tint on top of the exact current scene composition.
    // Tint is deliberately diagnostic, never exported back to tile pixels.
    const colors={solid:[245,110,95], 'one-way':[245,204,90],ladder:[100,208,240],
      lethal:[230,70,195],exit:[135,236,118],unknown:[180,180,180]};
    for(const cell of scene.terrain) {
      const reviewedOpen=cell.effectiveKind==='open' && cell.overrideId && cell.rawKind!=='open';
      const color=reviewedOpen ? [65,245,206] : colors[cell.effectiveKind];if(!color)continue;
      const left=cell.g8[0]*8-ox,top=cell.g8[1]*8-oy;
      for(let y=top;y<top+8;y++)for(let x=left;x<left+8;x++){
        if(x<0||y<0||x>=w||y>=h)continue;
        const i=(y*w+x)*4, edge=x===left||y===top||x===left+7||y===top+7;
        for(let j=0;j<3;j++)image.data[i+j]=Math.round(image.data[i+j]*(edge?0.35:0.72)+color[j]*(edge?0.65:0.28));
        image.data[i+3]=255;
      }
    }
  }
  if(diagnostic==='cover' && coverMasks) {
    // An explicitly read-only overlay of the source renderer's sparse cover
    // decision; never synthesize opaque tiles from these mask bits.
    for(let i=0;i<w*h;i++) {
      const normal=coverMasks.normal[i],embedded=coverMasks.embedded[i];
      if(!normal&&!embedded)continue;
      const tint=normal&&embedded?[235,115,240]:normal?[255,87,125]:[105,185,255];
      const at=i*4;
      for(let j=0;j<3;j++)image.data[at+j]=Math.round(image.data[at+j]*0.45+tint[j]*0.55);
      image.data[at+3]=255;
    }
  }
  if(diagnostic==='ownership') {
    const colors={backdrop:[50,160,220],embeddedActors:[90,210,165],midground:[120,215,135],actors:[240,180,60],foreground:[240,105,80],frontActors:[205,120,240]};
    for(let i=0;i<w*h;i++){
      const order=['backdrop','embeddedActors','midground','actors','foreground','frontActors'];
      const winner=order.findLast(name=>bands[name].data[i*4+3]>0),c=colors[winner];if(!c)continue;
      const at=i*4;for(let j=0;j<3;j++)image.data[at+j]=Math.round(image.data[at+j]*0.65+c[j]*0.35);
    }
  } else if(diagnostic==='occlusion') {
    for(const [x,y] of overlaid){const i=(y*w+x)*4; image.data.set([255,60,110,255],i);}
  }
  return {pixels:Array.from(image.data),stats:{visible,covered,localCover,clipped,actorOverlap,testOnly:probe?.source.kind==='test-pn',sourcePixels:!!probe?.source.sourceRgba,authority:'preview-only; canonical sparse-cover projection, live native contact at moved position not established'}};
}
