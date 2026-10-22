import { presentationOcclusionAt } from '../levels/presentation-occlusion.js';
import { composePreviewLayers } from '../preview/preview-render-primitives.js';
import { tileNibbleRows } from '../levels/authored-visual-assets.js';
import { requireArt } from './document.js';
import { sha256Hex } from '../core/hash.js';
import { collisionCells } from '../level-editor/domain/effective-collision.js';

export const MAP_SCENE_SCHEMA = 'rdr.map_scene_extract.v1';
export const MAP_SCENE_MAX_SIDE = 128;
const LAYERS = ['backdrop', 'embeddedActors', 'midground', 'actors', 'foreground', 'frontActors'];
const hasRect = rect => Array.isArray(rect) && rect.length === 4 && rect.every(Number.isInteger) && rect[2] > 0 && rect[3] > 0;
const overlaps = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];

export function sceneCrop(rect, dimensions) {
  requireArt(hasRect(rect), 'SCENE_BOUNDS', 'Expected integer world rectangle [x,y,width,height]');
  const inner = [...rect];
  const x0 = Math.max(0, Math.floor(rect[0] / 8) * 8);
  const y0 = Math.max(0, Math.floor(rect[1] / 8) * 8);
  const x1 = Math.min(dimensions.width, Math.ceil((rect[0] + rect[2]) / 8) * 8);
  const y1 = Math.min(dimensions.height, Math.ceil((rect[1] + rect[3]) / 8) * 8);
  requireArt(rect[0] >= 0 && rect[1] >= 0 && rect[0] + rect[2] <= dimensions.width && rect[1] + rect[3] <= dimensions.height &&
    x1 > x0 && y1 > y0 && x1 - x0 <= MAP_SCENE_MAX_SIDE && y1 - y0 <= MAP_SCENE_MAX_SIDE,
  'SCENE_BOUNDS', `Crop must be within the room and at most ${MAP_SCENE_MAX_SIDE}×${MAP_SCENE_MAX_SIDE} pixels`);
  return { requestedWorldRect:inner, cropWorld:[x0,y0,x1-x0,y1-y0], worldToCrop:[-x0,-y0], cropToWorld:[x0,y0] };
}

export function sceneLocation(room, { worldRect, stableEntityId, margin = 16 } = {}, selectables = []) {
  if (worldRect != null) return { worldRect, target:null };
  requireArt(typeof stableEntityId === 'string' && stableEntityId.length <= 160, 'SCENE_TARGET', 'Provide a worldRect or stable entity ID');
  const mark = String(stableEntityId).match(/(?:mark[:\-])([0-9]+)/i)?.[1];
  const objects = room?.layers?.semanticCorpus?.objects || [];
  const found = objects.find(o => [o.semanticId, o.sourceRecordId, o.sources?.classic?.ref, o.sources?.rdx?.ref].some(id => id === stableEntityId) ||
    (mark != null && Number(o.sources?.classic?.mark) === Number(mark)));
  requireArt(found, 'SCENE_TARGET', `Entity ${stableEntityId} not found in effective room`);
  // Native/editor selectables carry the effective drawable silhouette; an
  // origin/contact point alone is not the sprite's complete rendered bounds.
  const projected = selectables.find(row => [row.sourceKey, row.id, row.key].includes(`mark:${mark}`) ||
    [row.semanticId, row.sourceKey, row.id].includes(found.semanticId));
  const projectedBounds = projected?.opaqueBounds || projected?.bounds;
  const pos = projectedBounds || found.effective?.visualBounds || found.effective?.gameplayBounds || found.effective?.position;
  const bounds = Array.isArray(pos) && pos.length === 4 ? pos : Array.isArray(pos) && pos.length === 2 ? [pos[0],pos[1],16,16] :
    (pos && typeof pos === 'object' && Number.isFinite(pos.x) ? [pos.x,pos.y,pos.width ?? 16,pos.height ?? 16] : null);
  requireArt(bounds && bounds.every(Number.isFinite), 'SCENE_TARGET', `Cannot prove effective bounds for ${stableEntityId}`);
  requireArt(Number.isInteger(margin) && margin >= 0 && margin <= 48, 'SCENE_BOUNDS', 'Margin must be 0..48 pixels');
  return {worldRect:[Math.floor(bounds[0])-margin, Math.floor(bounds[1])-margin, Math.ceil(bounds[2])+2*margin, Math.ceil(bounds[3])+2*margin],
    target:{stableEntityId, semanticId:found.semanticId, effective:found.effective, sources:found.sources}};
}

function cropPixels(buffer, rect) {
  const [x,y,w,h] = rect;
  requireArt(buffer && buffer.width >= x + w && buffer.height >= y + h && buffer.data?.length === buffer.width * buffer.height * 4,
    'SCENE_RENDER', 'Canonical renderer returned an incomplete room band');
  return Array.from(buffer.crop(x,y,w,h).data);
}

function sourceCell(mapDecoder, mapId, gx, gy, tick, topology, corrections, palette, bands, cropWorld) {
  const inspected = mapDecoder.inspectGridCell(mapId,gx,gy,tick,{topology});
  const bounds = [gx*8,gy*8,8,8];
  const touched = corrections.filter(row => row?.type === 'visual-plane-patch' && Array.isArray(row.bounds) && overlaps(bounds,row.bounds));
  return ['A','B'].map(plane => {
    const visual = plane === 'A' ? inspected?.visual?.foreground : inspected?.visual?.background;
    const ownerPatches=touched.filter(patch => {
      const clear=String(patch.clearLayer||patch.layer||'').toUpperCase();
      return (!patch.action && !clear) || clear.includes(plane) || (patch.tiles||[]).some(t=>String(t.plane||'').toUpperCase()===plane &&
        Array.isArray(t.offset) && patch.bounds[0]+t.offset[0]===bounds[0] && patch.bounds[1]+t.offset[1]===bounds[1]);
    });
    // An existing reviewed overlay is source-owned by the tile's donor, NOT
    // by the destination's cleared plane. Resolve donors exactly at the same
    // G8 cell for now; cross-map/different-cell donors need an explicit source
    // reference, not an arbitrary first occurrence of the global pattern.
    let overlay = null, donor = null;
    if(ownerPatches.length===1 && ownerPatches[0].action==='overlay-tiles') {
      const patch=ownerPatches[0];
      const matches=(patch.tiles||[]).filter(t=>Array.isArray(t.offset) &&
        patch.bounds[0]+t.offset[0]===bounds[0] && patch.bounds[1]+t.offset[1]===bounds[1] && String(t.plane).toUpperCase()===plane);
      if(matches.length===1 && Number.isInteger(matches[0].globalTile) && !matches[0].assetId &&
        !matches[0].hFlip && !matches[0].vFlip) {
        const tile=matches[0];
        for(const p of ['A','B']) {
          const sourceVisual=p==='A'?inspected?.visual?.foreground:inspected?.visual?.background;
          if(sourceVisual?.resolution?.globalTile===tile.globalTile && !sourceVisual?.hFlip && !sourceVisual?.vFlip) {
            donor={plane:p,g8:[gx,gy],globalTile:tile.globalTile,paletteLine:sourceVisual.paletteLine};break;
          }
        }
        if(donor && donor.paletteLine===tile.paletteLine) overlay={correctionId:patch.id,offset:[...tile.offset],bounds:[...patch.bounds],plane,globalTile:tile.globalTile};
      }
    }
    const globalTile=overlay?.globalTile ?? visual?.resolution?.globalTile;
    const paletteLine=overlay ? ownerPatches[0].tiles.find(t=>t.offset[0]===overlay.offset[0] && t.offset[1]===overlay.offset[1] && t.plane===plane).paletteLine : visual?.paletteLine;
    const resolved=globalTile==null?null:mapDecoder.resolveGlobalTile(globalTile);
    const stable=Number.isInteger(globalTile) && resolved?.tileBytes?.length===32 &&
      (overlay ? !!donor : !visual?.hFlip && !visual?.vFlip && ownerPatches.length===0);
    let proof=null;
    if(stable && Array.isArray(palette) && palette.length===64) {
      const rows=tileNibbleRows(resolved.tileBytes), candidates=[];
      // Transparent-only 8x8 is no ownership proof; a blank band can match
      // hundreds of unrelated empty cells.
      if(rows.some(row=>/[^0]/.test(row))) for(const band of plane==='A'?['midground','foreground']:['backdrop','midground']) {
        for(const transparentZero of [plane==='A',plane!=='A']) {
          let matches=true;
          for(let y=0;y<8&&matches;y++)for(let x=0;x<8;x++) {
            const index=Number.parseInt(rows[y][x],16);
            const rgba=index===0&&transparentZero?[0,0,0,0]:palette[Number(paletteLine)*16+index];
            if(!rgba){matches=false;break;}
            const offset=(((gy*8+y)-cropWorld[1])*cropWorld[2]+gx*8+x-cropWorld[0])*4;
            for(let c=0;c<4;c++)if(bands[band][offset+c]!==rgba[c]){matches=false;break;}
            if(!matches)break;
          }
          if(matches && !candidates.some(candidate=>candidate.band===band))candidates.push({band,transparentZero});
        }
      }
      if(candidates.length===1)proof=candidates[0];
    }
    const representable=overlay || (plane==='A' && proof?.band==='foreground') || (plane==='B' && proof?.band==='backdrop');
    return {
      plane,g8:[gx,gy],worldRect:bounds,paletteLine:paletteLine??null,
      globalTile:globalTile??null,hFlip:visual?.hFlip??null,vFlip:visual?.vFlip??null,
      indexSource:visual?.indexSource??null,graphicsSource:visual?.graphicsSource??null,
      tileRows:resolved?.tileBytes?.length===32?tileNibbleRows(resolved.tileBytes):null,
      collision:{authority:'raw-descriptor-only',mt:inspected?.descriptor?.mt??null,ml:inspected?.descriptor?.ml??null},
      correctionIds:touched.map(o=>o.id),overlay,donor,
      editBand:proof?.band??null,transparentZero:proof?.transparentZero??null,
      exportStatus:proof && representable?'editable-local-variant':'preview-only',
      blockers:[!inspected&&'UNRESOLVED_OWNER',globalTile==null&&'UNRESOLVED_OWNER',
        (visual?.hFlip||visual?.vFlip)&&!overlay&&'FLIPPED_SOURCE',ownerPatches.length>0&&!overlay&&'REVIEWED_VISUAL_OVERRIDE',
        stable&&!proof&&'EFFECTIVE_BAND_UNPROVEN',proof&&!representable&&'MAP_DEPTH_CONFLICT'].filter(Boolean)
    };
  });
}

/** Isolate visible actor pixels only when the canonical band and selectable
 * agree on a unique, non-overlapping source footprint. This is a bounded
 * *visible* silhouette, not a reconstructed PN sprite: pixels already cut by
 * native cover/clip cannot be recovered by moving the probe. */
export function captureSceneActorProbes(selectables = [], bands, cropWorld, coverMasks = null) {
  const [ox,oy,w,h] = cropWorld;
  const parsed = (selectables || []).filter(Boolean).map(row => {
    const band = row.actorDepth === 'front' ? 'frontActors' : row.actorDepth === 'behind-midground' ? 'embeddedActors' : 'actors';
    const raw = row.opaqueBounds || row.bounds;
    const rect = Array.isArray(raw) ? raw : raw && [raw.x,raw.y,raw.width,raw.height];
    return {row,band,rect};
  }).filter(({row,rect,band}) => row.visible !== false && ['actors','embeddedActors','frontActors'].includes(band) &&
    typeof row.sourceKey === 'string' && row.sourceKey.length > 0 && row.sourceKey.length <= 160 &&
    Array.isArray(row.draw) && row.draw.length === 2 && row.draw.every(Number.isInteger) &&
    Array.isArray(rect) && rect.length===4 && rect.every(Number.isInteger) && rect[2]>0 && rect[3]>0);
  const output=[];
  for (const item of parsed) {
    if (output.length>=16) break;
    const {rect,band,row}=item;
    if (rect[0]<ox || rect[1]<oy || rect[0]+rect[2]>ox+w || rect[1]+rect[3]>oy+h || rect[2]>64 || rect[3]>64) continue;
    // Other visible actors can pollute the band (and a duplicate selectable
    // makes the source itself ambiguous). Never cut their pixels into a proxy.
    if (parsed.some(other=>other!==item &&
      (other.row.sourceKey===row.sourceKey || (other.band===band && (overlaps(rect,other.rect) ||
        (Array.isArray(row.sceneSourceSprite?.worldRect) && overlaps(row.sceneSourceSprite.worldRect,other.rect))))))) continue;
    const pixels=[];
    let opaque=0;
    for(let y=rect[1];y<rect[1]+rect[3];y++)for(let x=rect[0];x<rect[0]+rect[2];x++) {
      const i=((y-oy)*w+x-ox)*4, rgba=bands[band].slice(i,i+4);
      if(rgba[3]) opaque++;
      pixels.push(...rgba);
    }
    if(!opaque)continue;
    const capture=row.sceneSourceSprite;
    // Admit decoded source pixels only when every source pixel reproduces the
    // actual composited actor band at the native registration and mask phase.
    // A partial/overlapping/unverified sprite falls back to visible-only pixels.
    let sourceRgba=null;
    if (capture && coverMasks && Array.isArray(row.sceneCoverModes) &&
        row.sceneCoverModes.every(mode=>['normal','embedded'].includes(mode)) &&
        Array.isArray(capture.rgba) &&
        capture.worldRect?.length===4 && capture.rgba.length===capture.worldRect[2]*capture.worldRect[3]*4 &&
        capture.worldRect[0]>=ox && capture.worldRect[1]>=oy &&
        capture.worldRect[0]+capture.worldRect[2]<=ox+w && capture.worldRect[1]+capture.worldRect[3]<=oy+h &&
        capture.worldRect[2]<=64 && capture.worldRect[3]<=64 &&
        capture.rgba.every(v=>Number.isInteger(v)&&v>=0&&v<=255)) {
      const [sx,sy,sw,sh]=capture.worldRect;
      const covers=row.sceneCoverModes.map(mode=>coverMasks[mode]);
      let matches=true;
      for(let y=0;y<sh&&matches;y++)for(let x=0;x<sw;x++) {
        const i=(y*sw+x)*4, dest=((sy+y-oy)*w+(sx+x-ox));
        const hidden=covers.some(mask=>mask?.[dest]===1);
        const actual=bands[band].slice(dest*4,dest*4+4);
        const expected=hidden || capture.rgba[i+3]===0 ? [0,0,0,0] : capture.rgba.slice(i,i+4);
        if(expected.some((v,k)=>v!==actual[k])){matches=false;break;}
      }
      // Bounds can differ from the visible silhouette when covered: keep the
      // exact registered source rectangle only after full-band proof.
      if(matches)sourceRgba={worldRect:[...capture.worldRect],rgba:[...capture.rgba],coverModes:[...row.sceneCoverModes]};
    }
    output.push({id:row.sourceKey,band,worldRect:rect,draw:[...row.draw],
      foot:Number.isFinite(row.x)&&Number.isFinite(row.y)?[row.x,row.y]:null,
      category:String(row.category||'actor'),rgba:pixels,opaquePixels:opaque,
      ...(sourceRgba?{sourceRgba}:{}),
      authority:sourceRgba?'canonical-decoded-actor-source with verified baseline local cover; audit-only':
        'canonical-visible-actor-band; audit-only, clipped sprite pixels unavailable'});
  }
  return output;
}

/** Independent audit sprite from the same ROM PN decoder as the canonical
 * room renderer. The test actor is NOT a captured native entity: its position
 * and collision are never source authoring or native gameplay evidence. */
export function captureSceneTestPn(resources, sceneRect, {pn, foot, mapId, sourceTick = 0, mirrorX = false, mirrorY = false} = {}) {
  const [ox,oy,w,h]=sceneRect;
  requireArt(Number.isInteger(pn) && pn>=0 && pn<=255, 'TEST_PN', 'Test PN must be 0..255');
  requireArt(Array.isArray(foot) && foot.length===2 && foot.every(Number.isInteger), 'TEST_PN', 'Test PN needs an integer world contact');
  requireArt(Number.isInteger(sourceTick) && sourceTick>=0 && sourceTick<=1024,'TEST_PN','Test PN source tick must be 0..1024');
  requireArt(typeof mirrorX==='boolean' && typeof mirrorY==='boolean','TEST_PN','Test PN mirror flags must be boolean');
  const decoder=resources?.spriteDecoder;
  const palette=resources?.palettes?.forMap?.(mapId)?.rgba;
  if(!decoder?.frameForPn || !decoder?.placementAnchor || !palette) return null;
  // Decode the exact source-timeline tick; the native state remains authoritative.
  // This is one static source pose, not a simulated animation.
  const frame=decoder.frameForPn(pn,sourceTick,palette,{mirrorX,mirrorY});
  if(!frame?.pixels?.data || frame.pixels.width<1 || frame.pixels.height<1 ||
    frame.pixels.width>64 || frame.pixels.height>64) return null;
  const anchor=decoder.placementAnchor(frame,0,{role:pn>=91&&pn<=110?'player':'actor'});
  if(!Number.isFinite(anchor?.x)||!Number.isFinite(anchor?.y))return null;
  const x=foot[0]-Math.round(anchor.x),y=foot[1]-Math.round(anchor.y);
  const sw=frame.pixels.width,sh=frame.pixels.height;
  // No silent clip/reposition of a source sprite. The caller can enlarge the
  // requested crop to obtain a full-frame test probe if needed.
  if(x<ox||y<oy||x+sw>ox+w||y+sh>oy+h)return null;
  const rgba=Array.from(frame.pixels.data);
  if(!rgba.some((v,i)=>i%4===3&&v>0))return null;
  return {
    id:`test-pn:${pn}:${sourceTick===0?'f0':`t${sourceTick}`}`,kind:'test-pn',pn,sourceTick,frameIndex:frame.frameIndex??0,mirrorX,mirrorY,band:'actors',
    worldRect:[x,y,sw,sh],draw:[x,y],foot:[...foot],category:pn>=91&&pn<=110?'Rick test':'PN test',
    rgba,opaquePixels:rgba.filter((v,i)=>i%4===3&&v>0).length,
    sourceRgba:{worldRect:[x,y,sw,sh],rgba:[...rgba],coverModes:['normal']},
    authority:`decoded RDX PN ${pn} source tick ${sourceTick} (mirrorX=${mirrorX}, mirrorY=${mirrorY}); derived-foot registration; audit-only, not a native entity`
  };
}

/** Acquisition is exclusively from the maintained canonical room renderer. The
 * accompanying ROM cell inspection is provenance, NEVER a replacement render. */
export async function extractMapScene({ roomRenderer, resources, submap, mapId = null, tick = 0, worldRect,
  stableEntityId, margin = 16, testPn = 91, testSourceTick = 0, testMirrorX = false, testMirrorY = false, sourceCommit = null, nativeCapture = null } = {}) {
  requireArt(roomRenderer?.frameForSubmap && resources?.mapDecoder, 'SCENE_SOURCE', 'Canonical room renderer and decoded ROM resources required');
  const frame = roomRenderer.frameForSubmap(submap,{mapId,tick,captureActorSources:true});
  const resolvedRoom=(resources.resolvedLevels?.rooms || []).find(row => Number(row.submap) === Number(submap));
  requireArt(resolvedRoom, 'SCENE_SOURCE', 'ResolvedLevel room provenance required; production projection alone has no authored layer ledger');
  const location = sceneLocation(resolvedRoom,{worldRect,stableEntityId,margin},frame.selectables);
  // Entity-centered discovery may legitimately reach beyond a room edge;
  // clip its inspection margin, but reject invalid explicit worldRect input.
  if (stableEntityId && !worldRect) {
    const [x,y,w,h] = location.worldRect;
    const x0=Math.max(0,x), y0=Math.max(0,y);
    location.worldRect=[x0,y0,Math.min(frame.dimensions.width,x+w)-x0,Math.min(frame.dimensions.height,y+h)-y0];
  }
  const crop = sceneCrop(location.worldRect,frame.dimensions);
  const rect = crop.cropWorld;
  const buffers = Object.fromEntries(LAYERS.map(id=>[id,frame[id]]));
  const merged = composePreviewLayers(frame.backdrop,frame.actors,frame.foreground,frame.frontActors,frame.embeddedActors,frame.midground);
  const bands = Object.fromEntries([...LAYERS.map(id=>[id,cropPixels(buffers[id],rect)]), ['composite',cropPixels(merged,rect)]]);
  const [x0,y0,width,height] = rect;
  const owner = Array(width*height).fill(0);
  // The visible winning band, not a guess from an RGBA screenshot.
  for (let i=0;i<owner.length;i++) for(let layer=LAYERS.length-1;layer>=0;layer--)
    if (bands[LAYERS[layer]][i*4+3] !== 0) {owner[i]=layer+1;break;}
  const corrections=resolvedRoom?.layers?.structuralCorrections?.operations || [];
  const palette=resources.palettes?.forMap?.(frame.mapId)?.rgba || null;
  const cells=[];
  const topology=frame.topology ?? null;
  for(let y=y0;y<y0+height;y+=8)for(let x=x0;x<x0+width;x+=8)
    cells.push(...sourceCell(resources.mapDecoder,frame.mapId,x/8,y/8,frame.tick,topology,corrections,palette,bands,rect));
  // Use exactly the same decoded/resolved G8 semantics as the Level Editor
  // collision overlay, including reviewed Layer-D overrides. This is a source
  // projection, not a claim about live native actor-contact rules.
  const terrain = collisionCells(resolvedRoom,{mapDecoder:resources.mapDecoder},{x:0,y:0},topology,
    {worldRect:rect,includeOpen:true}).map(row=>({
      g8:[row.gx,row.gy],rawKind:row.rawKind,effectiveKind:row.effectiveKind,
      sourceProven:row.sourceProven,overrideId:row.override?.id || null,
      overrideAction:row.override?.action || null
    }));
  // The canonical sparse-cover projection stays immutable; only proven
  // reviewed normal-cover cells may become separate binary draft input.
  const coverMasks=typeof frame.localCoverAt==='function' ? {normal:[],embedded:[]} : null;
  if(coverMasks) for(let y=y0;y<y0+height;y++)for(let x=x0;x<x0+width;x++) {
    coverMasks.normal.push(frame.localCoverAt(x,y,'normal')?1:0);
    coverMasks.embedded.push(frame.localCoverAt(x,y,'embedded')?1:0);
  }
  const actorProbes=captureSceneActorProbes(frame.selectables,bands,rect,coverMasks);
  // Author only normal-actor mask cells demonstrably owned by a reviewed
  // Plane-A cover. Other masks and unknown source/depth are read-only.
  const coverAuthoringCells=[];
  const canonicalModel=frame.localCoverModel || frame.productionRoom?.presentationOcclusion || resolvedRoom?.layers?.presentationOcclusion;
  const model=canonicalModel && {...canonicalModel,
    coverAuthoringScopes:resolvedRoom?.coverAuthoringScopes || resolvedRoom?.layers?.presentationOcclusion?.coverAuthoringScopes || []};
  if(coverMasks && model?.overrides) for(let y=y0;y<y0+height;y+=8)for(let x=x0;x<x0+width;x+=8) {
    const gx=x/8,gy=y/8;
    const owned=model.overrides.some(row=>row.plane==='A' && row.cover==='normal' && (row.submap==null||row.submap===Number(submap)) && (row.mapId==null||row.mapId===frame.mapId) &&
      x<row.bounds[0]+row.bounds[2] && x+8>row.bounds[0] &&
      y<row.bounds[1]+row.bounds[3] && y+8>row.bounds[1]) ||
      model.pixelMasks?.some(row=>row.plane==='A' && (row.submap==null||row.submap===Number(submap)) && (row.mapId==null||row.mapId===frame.mapId) && row.cell[0]===gx && row.cell[1]===gy);
    // New normal-cover cells require a reviewed room-specific source-actor
    // authoring grant AND an independently verified decoded actor silhouette.
    // The grant is not an active cover mask and cannot hide production actors.
    const pixelMask=model.pixelMasks?.find(row=>row.plane==='A' && row.cell[0]===gx && row.cell[1]===gy);
    const scope=model.coverAuthoringScopes?.find(scope=>{
      if(pixelMask && pixelMask.authoringScopeId!==scope.id)return false;
      const probe=actorProbes.find(p=>p.id===scope.sourceKey);
      return scope.plane==='A' && scope.submap===Number(submap) && scope.mapId===frame.mapId &&
        probe?.band==='actors' && probe.sourceRgba &&
        JSON.stringify(probe.sourceRgba.worldRect)===JSON.stringify(scope.bounds) &&
        JSON.stringify(probe.draw)===JSON.stringify(scope.probeDraw) &&
        x<scope.bounds[0]+scope.bounds[2]&&x+8>scope.bounds[0] &&
        y<scope.bounds[1]+scope.bounds[3]&&y+8>scope.bounds[1];
    });
    if(!owned&&!scope)continue;
    const sourceRows=[],editableRows=[];let verified=true;
    for(let py=0;py<8;py++) {
      let bits=0;
      for(let px=0;px<8;px++) {
        const wx=x+px,wy=y+py,i=(wy-y0)*width+wx-x0;
        const a=presentationOcclusionAt(model,{plane:'A',x:wx,y:wy});
        const b=presentationOcclusionAt(model,{plane:'B',x:wx,y:wy});
        // Both-plane normal cover would make replacement ambiguous.
        if(b.cover==='normal' || coverMasks.normal[i]!==Number(a.cover==='normal'))verified=false;
        if(coverMasks.normal[i])bits|=1<<px;
      }
      sourceRows.push(bits.toString(16).padStart(2,'0'));
      if(scope){
        let allowed=0;
        const sprite=actorProbes.find(p=>p.id===scope.sourceKey).sourceRgba;
        const [sx,sy,sw,sh]=sprite.worldRect;
        for(let px=0;px<8;px++){
          const wx=x+px,wy=y+py;
          if(wx>=sx&&wx<sx+sw&&wy>=sy&&wy<sy+sh&&
            sprite.rgba[((wy-sy)*sw+wx-sx)*4+3]>0)allowed|=1<<px;
        }
        editableRows.push(allowed.toString(16).padStart(2,'0'));
      }
    }
    if(verified && (!scope || editableRows.some(row=>row!=='00')))
      coverAuthoringCells.push({plane:'A',cell:[gx,gy],sourceRows,
        ...(scope?{scope:{id:scope.id,sourceKey:scope.sourceKey,bounds:[...scope.bounds],visualAnchor:[...scope.visualAnchor],probeDraw:[...scope.probeDraw]},editableRows}:{})});
  }
  requireArt(testPn==null || Number.isInteger(testPn) && testPn>=0 && testPn<=255,
    'TEST_PN', 'Test PN must be 0..255');
  requireArt(Number.isInteger(testSourceTick) && testSourceTick>=0 && testSourceTick<=1024 && (testPn!=null || testSourceTick===0),
    'TEST_PN','Test PN source tick must be 0..1024 and requires a selected PN');
  requireArt(typeof testMirrorX==='boolean' && typeof testMirrorY==='boolean' &&
    (testPn!=null || !testMirrorX && !testMirrorY), 'TEST_PN','Test PN mirror requires a selected PN');
  // Prefer the actual effective contact for an entity-centered inspection.
  // For a manual rectangle use its center; either case is just a test anchor.
  const matching=actorProbes.find(p=>p.id===location.target?.stableEntityId);
  const testFoot=matching?.foot?.every(Number.isInteger) ? matching.foot :
    [Math.floor(x0+width/2),Math.floor(y0+height/2)];
  const testProbe=testPn==null||!coverMasks?null:captureSceneTestPn(
    resources,rect,{pn:testPn,foot:testFoot,mapId:frame.mapId,sourceTick:testSourceTick,mirrorX:testMirrorX,mirrorY:testMirrorY});
  const sourceRoomFingerprint = `sha256:${await sha256Hex(new TextEncoder().encode(JSON.stringify({sourceCommit,rom:resources.rom?.hash,room:resolvedRoom,tick:frame.tick})))}`;
  const fingerprint = await sha256Hex(new TextEncoder().encode(JSON.stringify({sourceCommit, rom:resources.rom?.hash,room:resolvedRoom,rect,tick:frame.tick})));
  return {
    schema:MAP_SCENE_SCHEMA, authority:frame.authority, sourceCommit, sourceFingerprint:`sha256:${fingerprint}`, sourceRoomFingerprint,
    sourceRomHash:resources.rom?.hash || null, room:{id:`SM${Number(submap).toString(16).toUpperCase().padStart(2,'0')}`,submap:Number(submap),mapId:frame.mapId},
    target:location.target, tick:frame.tick, nativeCapture, ...crop,
    size:[width,height], bands, bandOrder:LAYERS, owner, cells, terrain, palette,
    ...(coverMasks?{coverMasks,coverAuthoringCells}:{}),
    actorProbes, ...(testProbe?{testProbes:[testProbe]}:{}),
    collisionAuthority:'Level Editor resolved G8 source geometry (MT/ML + reviewed Layer-D overrides); live native actor contact not measured',
    exportStatus:'inspection-only; source edits require trusted promotion and effective ownership proof'
  };
}

export function inspectScenePixel(scene,worldX,worldY) {
  requireArt(scene?.schema === MAP_SCENE_SCHEMA, 'SCENE_SCHEMA', 'Expected map scene extraction');
  const [x,y,w,h]=scene.cropWorld;
  requireArt(Number.isInteger(worldX) && Number.isInteger(worldY) && worldX>=x && worldX<x+w && worldY>=y && worldY<y+h,
    'SCENE_BOUNDS','Pixel outside inspected crop');
  const offset=(worldY-y)*w+worldX-x, cell=scene.cells.filter(row=>row.g8[0]===Math.floor(worldX/8)&&row.g8[1]===Math.floor(worldY/8));
  const ownerId=scene.owner[offset], layer=ownerId ? scene.bandOrder[ownerId-1] : 'transparent';
  const g8=[Math.floor(worldX/8),Math.floor(worldY/8)];
  const terrain=scene.terrain?.find(row=>row.g8[0]===g8[0]&&row.g8[1]===g8[1]) || null;
  return {world:[worldX,worldY],crop:[worldX-x,worldY-y],owner:layer,
    color:scene.bands.composite.slice(offset*4,offset*4+4),cells:cell,
    collision:{...cell[0]?.collision,...(terrain || {})},
    actorCover:scene.coverMasks ? {
      normal:scene.coverMasks.normal[offset]===1,
      embedded:scene.coverMasks.embedded[offset]===1,
      authority:'canonical renderer local cover projection; not native contact'
    } : null};
}

/** Validate untrusted portable captures before allocating a browser document.
 * A source capture is an *inspection* artifact; validation cannot authorize
 * production edits even when its tile identities happen to look plausible. */
export function validateMapScene(scene) {
  const size=scene?.size, rect=scene?.cropWorld;
  // Older portable scene bundles remain readable. New room-wide provenance
  // must be a real SHA-256 digest, never a raw ROM hash or arbitrary label.
  if(scene?.sourceRoomFingerprint != null)
    requireArt(/^sha256:[0-9a-f]{64}$/.test(scene.sourceRoomFingerprint),
      'SCENE_SCHEMA','Malformed crop-independent source room fingerprint');
  requireArt(scene?.schema === MAP_SCENE_SCHEMA && Array.isArray(size) && size.length===2 &&
    size.every(n=>Number.isInteger(n) && n>0 && n<=MAP_SCENE_MAX_SIDE) &&
    hasRect(rect) && rect[2]===size[0] && rect[3]===size[1] &&
    rect[0]>=0 && rect[1]>=0 && rect[0]%8===0 && rect[1]%8===0 &&
    size[0]%8===0 && size[1]%8===0 &&
    (scene.palette == null || (Array.isArray(scene.palette) && scene.palette.length===64 && scene.palette.every(c=>Array.isArray(c) && c.length===4 && c.every(n=>Number.isInteger(n) && n>=0 && n<=255)))) &&
    typeof scene?.room?.id==='string' && Number.isInteger(scene.room.submap) &&
    Array.isArray(scene.bandOrder) && scene.bandOrder.length===LAYERS.length &&
    scene.bandOrder.every((layer,i)=>layer===LAYERS[i]),
  'SCENE_SCHEMA','Invalid canonical map scene dimensions or source identity');
  const pixels=size[0]*size[1];
  requireArt(Array.isArray(scene.owner) && scene.owner.length===pixels &&
    scene.owner.every(owner=>Number.isInteger(owner) && owner>=0 && owner<=LAYERS.length) &&
    scene.bands && [...LAYERS,'composite'].every(key=>Array.isArray(scene.bands[key]) &&
      scene.bands[key].length===pixels*4 && scene.bands[key].every(value=>Number.isInteger(value) && value>=0 && value<=255)),
  'SCENE_SCHEMA','Malformed scene band or pixel owner data');
  requireArt(Array.isArray(scene.cells) && scene.cells.length===pixels/64*2 &&
    scene.cells.every(cell=>['A','B'].includes(cell?.plane) && Array.isArray(cell?.g8) && cell.g8.length===2 &&
      cell.g8.every(Number.isInteger) && cell.g8[0]>=rect[0]/8 && cell.g8[0]<(rect[0]+rect[2])/8 &&
      cell.g8[1]>=rect[1]/8 && cell.g8[1]<(rect[1]+rect[3])/8),
  'SCENE_SCHEMA','Malformed map scene tile coordinates');
  if(scene.terrain != null) {
    const allowed=new Set(['open','solid','one-way','ladder','lethal','exit','unknown']);
    const keys=new Set();
    requireArt(Array.isArray(scene.terrain) && scene.terrain.length===pixels/64 && scene.terrain.every(row=>{
      const [gx,gy]=row?.g8 || [];
      const key=`${gx}:${gy}`;
      if(keys.has(key))return false;
      keys.add(key);
      return Number.isInteger(gx)&&Number.isInteger(gy)&&gx>=rect[0]/8&&gy>=rect[1]/8&&
        gx<(rect[0]+rect[2])/8&&gy<(rect[1]+rect[3])/8&&
        allowed.has(row.rawKind)&&allowed.has(row.effectiveKind)&&typeof row.sourceProven==='boolean'&&
        (row.sourceProven||row.rawKind==='unknown')&&
        (row.overrideId===null||typeof row.overrideId==='string'&&row.overrideId.length<=160)&&
        (row.overrideAction===null||['open','solid','one-way','climb-through','lethal','exit'].includes(row.overrideAction));
    }), 'SCENE_SCHEMA','Malformed resolved G8 terrain; re-extract scene');
  }
  if(scene.coverMasks != null) {
    requireArt(['normal','embedded'].every(kind=>Array.isArray(scene.coverMasks[kind]) &&
      scene.coverMasks[kind].length===pixels && scene.coverMasks[kind].every(v=>v===0||v===1)),
    'SCENE_SCHEMA','Malformed source-owned actor cover masks; re-extract scene');
  }
  if(scene.coverAuthoringCells != null) {
    const [x,y,w,h]=rect, seen=new Set();
    requireArt(Array.isArray(scene.coverAuthoringCells) && scene.coverMasks &&
      scene.coverAuthoringCells.every(row=>{
        const cell=row?.cell;
        if(row.plane!=='A' || !Array.isArray(cell) || cell.length!==2 || !cell.every(Number.isInteger) ||
          cell[0]*8<x || cell[0]*8>=x+w || cell[1]*8<y || cell[1]*8>=y+h ||
          !Array.isArray(row.sourceRows) || row.sourceRows.length!==8 ||
          !row.sourceRows.every(r=>typeof r==='string'&&/^[0-9a-f]{2}$/.test(r)))return false;
        const key=cell.join(':'); if(seen.has(key))return false;seen.add(key);
        if(row.scope){
          const scope=row.scope;
          const probe=scene.actorProbes?.find(p=>p.id===scope.sourceKey && p.band==='actors' && p.sourceRgba);
          if(typeof scope.id!=='string'||!/^mark:[1-9]\d*$/.test(scope.sourceKey||'') ||
            !Array.isArray(scope.bounds)||!Array.isArray(scope.visualAnchor) ||
            JSON.stringify(probe?.sourceRgba?.worldRect)!==JSON.stringify(scope.bounds) ||
            JSON.stringify(probe?.draw)!==JSON.stringify(scope.probeDraw) ||
            !Array.isArray(row.editableRows)||row.editableRows.length!==8 ||
            !row.editableRows.every((bits,dy)=>{
              if(typeof bits!=='string'||!/^[0-9a-f]{2}$/.test(bits))return false;
              const [sx,sy,sw,sh]=probe.sourceRgba.worldRect;
              let expected=0;
              for(let dx=0;dx<8;dx++){
                const wx=cell[0]*8+dx,wy=cell[1]*8+dy;
                if(wx>=sx&&wx<sx+sw&&wy>=sy&&wy<sy+sh&&
                  probe.sourceRgba.rgba[((wy-sy)*sw+wx-sx)*4+3]>0)expected|=1<<dx;
              }
              return Number.parseInt(bits,16)===expected;
            }))return false;
        } else if(row.editableRows!==undefined)return false;
        return row.sourceRows.every((bits,dy)=>{
          const raw=Number.parseInt(bits,16);
          for(let dx=0;dx<8;dx++) {
            const i=(cell[1]*8+dy-y)*w+cell[0]*8+dx-x;
            if(((raw>>>dx)&1)!==scene.coverMasks.normal[i])return false;
          }
          return true;
        });
      }), 'SCENE_SCHEMA','Malformed or mismatched cover authoring evidence');
  }
  if(scene.testProbes != null) {
    requireArt(Array.isArray(scene.testProbes) && scene.testProbes.length<=4 && scene.testProbes.every(p=>{
      const b=p?.worldRect,src=p?.sourceRgba;
      return p.kind==='test-pn' && Number.isInteger(p.pn) && p.pn>=0 && p.pn<=255 &&
        Number.isInteger(p.sourceTick??0) && (p.sourceTick??0)>=0 && (p.sourceTick??0)<=1024 &&
        p.id===`test-pn:${p.pn}:${(p.sourceTick??0)===0?'f0':`t${p.sourceTick}`}` && Number.isInteger(p.frameIndex) && p.frameIndex>=0 && p.band==='actors' &&
        (p.mirrorX===undefined || typeof p.mirrorX==='boolean') &&
        (p.mirrorY===undefined || typeof p.mirrorY==='boolean') &&
        hasRect(b) && b[0]>=rect[0] && b[1]>=rect[1] &&
        b[0]+b[2]<=rect[0]+rect[2] && b[1]+b[3]<=rect[1]+rect[3] &&
        b[2]<=64 && b[3]<=64 && Array.isArray(p.draw) && p.draw.length===2 && p.draw.every(Number.isInteger) &&
        Array.isArray(p.foot) && p.foot.length===2 && p.foot.every(Number.isInteger) &&
        p.draw[0]===b[0] && p.draw[1]===b[1] &&
        Array.isArray(p.rgba) && p.rgba.length===b[2]*b[3]*4 &&
        p.rgba.every(v=>Number.isInteger(v)&&v>=0&&v<=255) &&
        src && scene.coverMasks && Array.isArray(src.coverModes) &&
        src.coverModes.length===1 && src.coverModes[0]==='normal' &&
        JSON.stringify(src.worldRect)===JSON.stringify(b) &&
        Array.isArray(src.rgba) && src.rgba.length===p.rgba.length && src.rgba.every((v,i)=>v===p.rgba[i]);
    }) && new Set(scene.testProbes.map(p=>p.id)).size===scene.testProbes.length,
    'SCENE_SCHEMA','Malformed independent PN test probe; re-extract scene');
  }
  if(scene.actorProbes != null) {
    requireArt(Array.isArray(scene.actorProbes) && scene.actorProbes.length<=16 && scene.actorProbes.every(probe=>{
      const b=probe?.worldRect;
      return typeof probe.id==='string' && probe.id.length>0 && probe.id.length<=160 &&
        ['actors','embeddedActors','frontActors'].includes(probe.band) && hasRect(b) &&
        b[0]>=rect[0] && b[1]>=rect[1] && b[0]+b[2]<=rect[0]+rect[2] && b[1]+b[3]<=rect[1]+rect[3] &&
        b[2]<=64 && b[3]<=64 && Array.isArray(probe.draw) && probe.draw.length===2 && probe.draw.every(Number.isInteger) &&
        Array.isArray(probe.rgba) && probe.rgba.length===b[2]*b[3]*4 && probe.rgba.every(v=>Number.isInteger(v)&&v>=0&&v<=255) &&
        (probe.sourceRgba == null || (scene.coverMasks && hasRect(probe.sourceRgba.worldRect) &&
          probe.sourceRgba.worldRect[0]>=rect[0] && probe.sourceRgba.worldRect[1]>=rect[1] &&
          probe.sourceRgba.worldRect[0]+probe.sourceRgba.worldRect[2]<=rect[0]+rect[2] &&
          probe.sourceRgba.worldRect[1]+probe.sourceRgba.worldRect[3]<=rect[1]+rect[3] &&
          probe.sourceRgba.worldRect[2]<=64 && probe.sourceRgba.worldRect[3]<=64 &&
          Array.isArray(probe.sourceRgba.coverModes) &&
          probe.sourceRgba.coverModes.every(mode=>['normal','embedded'].includes(mode)) &&
          new Set(probe.sourceRgba.coverModes).size===probe.sourceRgba.coverModes.length &&
          Array.isArray(probe.sourceRgba.rgba) &&
          probe.sourceRgba.rgba.length===probe.sourceRgba.worldRect[2]*probe.sourceRgba.worldRect[3]*4 &&
          probe.sourceRgba.rgba.every(v=>Number.isInteger(v)&&v>=0&&v<=255)));
    }) && new Set(scene.actorProbes.map(p=>p.id)).size===scene.actorProbes.length,
    'SCENE_SCHEMA','Malformed isolated actor preview; re-extract the scene');
  }
  return scene;
}
