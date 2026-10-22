/** Source-owned scene pixel drafts. No guessed RGB→index conversion, no filesystem
 * writes, and no source modification when a compositor band cannot be proven. */
import { renderSceneProbe } from './map-scene-probe.js';
import { validateMapScene } from './map-scene.js';
import { requireArt } from './document.js';

export const MAP_SCENE_PLAN_SCHEMA = 'rdr.map_scene_patch_plan.v1';
const keyOf = (plane,g8) => `${plane}:${g8[0]}:${g8[1]}`;
const nibble = (rows,x,y) => Number.parseInt(rows[y][x],16);

export function createSceneDraft(scene) {
  validateMapScene(scene);
  requireArt(Array.isArray(scene.palette) && scene.palette.length === 64 && scene.palette.every(c=>Array.isArray(c) && c.length===4 && c.every(n=>Number.isInteger(n)&&n>=0&&n<=255)),
    'SCENE_PALETTE','This scene has no exact source palette; re-extract with the current Level Editor');
  const cells = new Map();
  for(const cell of scene.cells) if(cell.exportStatus === 'editable-local-variant') {
    requireArt(cell.editBand && Array.isArray(cell.tileRows) && cell.tileRows.length===8 && cell.tileRows.every(row=>/^[0-9a-f]{8}$/i.test(row)),
      'UNRESOLVED_OWNER','Editable cell has no indexed source or canonical band');
    cells.set(keyOf(cell.plane,cell.g8), {cell, rows:cell.tileRows.map(row=>row.split(''))});
  }
  const coverCells=new Map();
  for(const row of scene.coverAuthoringCells||[])coverCells.set(keyOf(row.plane,row.cell),{
    cell:row.cell,plane:row.plane,sourceRows:row.sourceRows,scope:row.scope,
    editableRows:row.editableRows,
    rows:row.sourceRows.map(value=>Number.parseInt(value,16))
  });
  return {scene,cells,coverCells,revision:0,history:[],future:[]};
}

export function sceneDraftPixel(draft,{plane,worldX,worldY}) {
  const [x,y,w,h]=draft.scene.cropWorld;
  requireArt(Number.isInteger(worldX)&&Number.isInteger(worldY)&&worldX>=x&&worldX<x+w&&worldY>=y&&worldY<y+h,
    'SCENE_BOUNDS','Pixel outside the scene crop');
  const g8=[Math.floor(worldX/8),Math.floor(worldY/8)];
  const entry=draft.cells.get(keyOf(plane,g8));
  requireArt(entry,'UNRESOLVED_OWNER',`Plane ${plane} g8:${g8} cannot be edited without proven effective-band ownership`);
  return {entry, g8, x:worldX%8, y:worldY%8};
}

/** Apply a bounded atomic multi-pixel operation; rejected input changes nothing.
 * Expected revision guards old agent/browser strokes against silent rebases. */
export function applyScenePixels(draft,{plane,points,expectedRevision}) {
  requireArt(expectedRevision===draft.revision,'STALE_SCENE_REVISION','Scene draft revision changed');
  requireArt(['A','B'].includes(plane) && Array.isArray(points) && points.length>0 && points.length<=2048,
    'SCENE_OPERATION','Expected up to 2048 indexed source-plane pixels');
  const writes=[];
  for(const p of points) {
    requireArt(Number.isInteger(p?.index)&&p.index>=0&&p.index<=15,'SCENE_PALETTE','Native tile colors are 4-bit indices (0–15)');
    const {entry,x,y}=sceneDraftPixel(draft,{plane,worldX:p.worldX,worldY:p.worldY});
    const from=nibble(entry.rows.map(r=>r.join('')),x,y);
    writes.push({entry,x,y,from,to:p.index});
  }
  const old=new Map();
  for(const w of writes) {
    const k=`${keyOf(w.entry.cell.plane,w.entry.cell.g8)}:${w.x}:${w.y}`;
    if(!old.has(k)) old.set(k,{...w});
    w.entry.rows[w.y][w.x]=w.to.toString(16);
  }
  const changes=[...old.values()].map(w=>({...w, to:nibble(w.entry.rows.map(r=>r.join('')),w.x,w.y)})).filter(w=>w.from!==w.to);
  if(changes.length){draft.history.push(changes);draft.future=[];draft.revision++;}
  return {revision:draft.revision,changedPixels:changes.length};
}

/** Binary actor-cover edits are distinct from palette indices. Each edited
 * cell replaces its entire original normal-cover bitplane, including zeros. */
export function applySceneCoverPixels(draft,{points,expectedRevision}) {
  requireArt(expectedRevision===draft.revision,'STALE_SCENE_REVISION','Scene draft revision changed');
  requireArt(Array.isArray(points)&&points.length>0&&points.length<=2048,
    'SCENE_OPERATION','Expected 1..2048 binary normal-cover pixels');
  const [ox,oy,w,h]=draft.scene.cropWorld,writes=[];
  for(const p of points) {
    requireArt(p && (p.cover===0||p.cover===1),'SCENE_COVER','Cover must be binary 0 or 1');
    const {worldX:x,worldY:y}=p;
    requireArt(Number.isInteger(x)&&Number.isInteger(y)&&x>=ox&&y>=oy&&x<ox+w&&y<oy+h,
      'SCENE_BOUNDS','Cover pixel outside crop');
    const cell=draft.coverCells.get(keyOf('A',[Math.floor(x/8),Math.floor(y/8)]));
    requireArt(cell,'UNRESOLVED_OWNER',`World ${x},${y} has no proven normal-actor cover source`);
    const px=x&7,py=y&7,from=(cell.rows[py]>>>px)&1;
    requireArt(!cell.editableRows || (Number.parseInt(cell.editableRows[py],16)&(1<<px))!==0,
      'UNRESOLVED_OWNER',`World ${x},${y} is outside the reviewed source actor silhouette`);
    writes.push({kind:'cover',entry:cell,x:px,y:py,from,to:p.cover});
  }
  const unique=new Map();
  for(const write of writes) {
    const key=`${write.entry.cell}:${write.x}:${write.y}`;
    if(!unique.has(key))unique.set(key,{...write});
    write.entry.rows[write.y]=(write.entry.rows[write.y]&~(1<<write.x))|(write.to<<write.x);
  }
  const changes=[...unique.values()].map(row=>({...row,to:(row.entry.rows[row.y]>>>row.x)&1})).filter(row=>row.from!==row.to);
  if(changes.length){draft.history.push(changes);draft.future=[];draft.revision++;}
  return {revision:draft.revision,changedPixels:changes.length};
}

export function sceneDraftHistory(draft,direction='undo') {
  const from=direction==='undo'?draft.history:draft.future, to=direction==='undo'?draft.future:draft.history;
  const changes=from.pop();if(!changes)return false;
  for(const w of changes) {
    const value=direction==='undo'?w.from:w.to;
    if(w.kind==='cover') w.entry.rows[w.y]=(w.entry.rows[w.y]&~(1<<w.x))|(value<<w.x);
    else w.entry.rows[w.y][w.x]=value.toString(16);
  }
  to.push(changes);draft.revision++;return true;
}

export function sceneDraftPreview(draft) {
  return renderSceneProbe(draft.scene,{draft}).pixels;
}

/** A semantic DRY-RUN only. The trusted CLI must independently verify the
 * exact ROM source tile and source manifest before touching authored files. */
export function sceneDraftPlan(draft) {
  const scene=draft.scene;
  const assets=[];
  for(const entry of draft.cells.values()) {
    const {cell,rows}=entry;
    const pixelEdits=rows.map((row,y)=>row.map((n,x)=>n===cell.tileRows[y][x]?'.':n).join(''));
    if(pixelEdits.every(row=>row==='........'))continue;
    const assetId=`scene-${scene.room.id.toLowerCase()}-${cell.plane.toLowerCase()}-${cell.g8.join('-')}`;
    assets.push({
      id:assetId,kind:'rdx-tile8-pixel-edit',size:[8,8],
      source:{mapId:scene.room.mapId,g8:cell.donor?.g8??cell.g8,plane:cell.donor?.plane??cell.plane,phase:scene.tick,expectedGlobalTile:cell.globalTile,
        expectedPaletteLine:cell.paletteLine,expectedHFlip:false,expectedVFlip:false},
      sourceRows:cell.tileRows, pixelEdits, worldRect:cell.worldRect, destinationPlane:cell.plane,
      target:cell.overlay?{kind:'reviewed-overlay-tile',correctionId:cell.overlay.correctionId,offset:cell.overlay.offset,
        bounds:cell.overlay.bounds,globalTile:cell.overlay.globalTile}: {kind:'new-local-overlay'},editBand:cell.editBand,
      transparentZero:cell.transparentZero,
      changedPixels:pixelEdits.join('').replaceAll('.','').length
    });
  }
  const covers=[...draft.coverCells.values()].flatMap(cell=>{
    const rows=cell.rows.map(n=>n.toString(16).padStart(2,'0'));
    const count=rows.reduce((total,row,y)=>{
      const difference=Number.parseInt(row,16)^Number.parseInt(cell.sourceRows[y],16);
      let n=difference,bits=0;while(n){bits+=n&1;n>>>=1;}return total+bits;
    },0);
    return count?[{id:`scene-${scene.room.id.toLowerCase()}-normal-a-${cell.cell.join('-')}`,
      plane:'A',cell:cell.cell,sourceRows:cell.sourceRows,rows,changedPixels:count,
      ...(cell.scope?{scope:cell.scope,editableRows:cell.editableRows}:{})}]:[];
  });
  return {schema:MAP_SCENE_PLAN_SCHEMA,sourceCommit:scene.sourceCommit,sourceFingerprint:scene.sourceFingerprint,
    sourceRomHash:scene.sourceRomHash,room:scene.room,tick:scene.tick,cropWorld:scene.cropWorld,
    revision:draft.revision,scope:'selected-occurrences-only',applyStatus:'requires-trusted-local-validation',
    assets,changedCells:assets.length,changedPixels:assets.reduce((n,a)=>n+a.changedPixels,0),
    covers,changedCoverCells:covers.length,changedCoverPixels:covers.reduce((n,c)=>n+c.changedPixels,0)};
}
