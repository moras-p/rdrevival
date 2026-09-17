import { PixelBuffer, drawMegaDriveTile } from '../../render/pixel-buffer.js';
import { composePresentationDepthPlanes, splitPlaneByPresentationDepth } from '../../levels/presentation-depth.js';
import { effectiveMapDimensions } from '../../core/map-topology.js';
import { authoredVisualAssetById, resolveAuthoredVisualAsset } from '../../levels/authored-visual-assets.js';
import { revivalAmmoBoxFrame } from '../../runtime/revival-ammo-box.js';

const CELL = 8;
const COMPARE_GAP = 32;
const COLLISION_KIND = Object.freeze({ 0:'open', 1:'solid', 2:'one-way', 3:'ladder', 4:'lethal', 5:'exit' });

const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const rectFromArray = value => Array.isArray(value) && value.length >= 4 ? { x:number(value[0]), y:number(value[1]), width:number(value[2]), height:number(value[3]) } : null;
const pointFrom = value => Array.isArray(value) && value.length >= 2 ? { x:number(value[0]), y:number(value[1]) } : null;
const clampRect = (rect, width, height) => {
  const x = Math.max(0, Math.floor(rect.x)), y = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(width, Math.ceil(rect.x + rect.width)), y1 = Math.min(height, Math.ceil(rect.y + rect.height));
  return { x, y, width:Math.max(0, x1 - x), height:Math.max(0, y1 - y) };
};

function fillPixelRect(buffer, rect, color) {
  const bounded = clampRect(rect, buffer.width, buffer.height);
  for (let y = bounded.y; y < bounded.y + bounded.height; y += 1)
    for (let x = bounded.x; x < bounded.x + bounded.width; x += 1) buffer.setPixel(x, y, color);
}

function clearPixelRect(buffer, rect) { fillPixelRect(buffer, rect, [0, 0, 0, 0]); }

function resolvedPatchTileBytes(tile, mapDecoder, authoredVisualAssets, cache = new Map()) {
  const assetId = String(tile?.assetId || '').trim();
  if (!assetId) {
    const resolved = mapDecoder.resolveGlobalTile(Number(tile?.globalTile));
    return resolved?.tileBytes || null;
  }
  if (!cache.has(assetId)) {
    if (!authoredVisualAssets) return null;
    const asset = authoredVisualAssetById(authoredVisualAssets, assetId);
    cache.set(assetId, asset ? resolveAuthoredVisualAsset(asset, mapDecoder) : null);
  }
  return cache.get(assetId)?.tileBytes || null;
}

function applyTerrainHazardDetachments(room, mapDecoder, palette, background, foreground) {
  for (const hazard of room?.layers?.semanticCorpus?.terrainHazards || []) {
    const bounds = rectFromArray(hazard.sourceBounds);
    const detachment = hazard.sourceMapDetachment || null;
    const planes = Array.isArray(detachment?.planes)
      ? [...new Set(detachment.planes.map(value => String(value).toUpperCase()))].filter(value => value === 'A' || value === 'B')
      : [];
    if (!bounds || !planes.length) continue;
    if (planes.includes('B')) fillPixelRect(background, bounds, palette[0] || [0,0,0,255]);
    if (planes.includes('A')) clearPixelRect(foreground, bounds);
    const restore = detachment?.backgroundRestore || null;
    if (!planes.includes('B') || String(restore?.plane || '').toUpperCase() !== 'B') continue;
    for (const tile of restore?.tiles || []) {
      const offset = Array.isArray(tile?.offset) ? tile.offset.map(Number) : [];
      const resolved = mapDecoder.resolveGlobalTile(Number(tile?.globalTile));
      if (!resolved?.tileBytes || offset.length !== 2 || offset.some(value => !Number.isFinite(value))) continue;
      drawMegaDriveTile(background, resolved.tileBytes, bounds.x + offset[0], bounds.y + offset[1], palette, {
        paletteLine:number(tile.paletteLine), hFlip:tile.hFlip === true, vFlip:tile.vFlip === true, transparentZero:false
      });
    }
  }
}

function applyVisualCorrections(room, assets, mapDecoder, palette, background, foreground) {
  const operations = room?.layers?.structuralCorrections?.operations || [];
  const authoredVisualAssets = assets?.authoredVisualAssets || room?.layers?.source?.shared?.visualAssets || room?.authoredVisualAssets || null;
  const assetCache = new Map();
  for (const operation of operations) {
    if (operation.type !== 'visual-plane-patch') continue;
    const bounds = rectFromArray(operation.bounds);
    if (!bounds) continue;
    const layer = String(operation.layer || '').toUpperCase();
    const clearLayer = String(operation.clearLayer || '').toUpperCase();
    const clearTargets = clearLayer || (operation.action === 'suppress' ? layer : '');
    if (clearTargets.includes('B')) fillPixelRect(background, bounds, palette[0] || [0,0,0,255]);
    if (clearTargets.includes('A')) clearPixelRect(foreground, bounds);
    if (operation.action === 'overlay-color') {
      const target = layer === 'A' ? foreground : background;
      fillPixelRect(target, bounds, Array.isArray(operation.rgba) ? operation.rgba : [255,0,255,255]);
    } else if (operation.action === 'overlay-tiles') {
      for (const tile of operation.tiles || []) {
        const tileBytes = resolvedPatchTileBytes(tile, mapDecoder, authoredVisualAssets, assetCache);
        if (!tileBytes) continue;
        const target = String(tile.plane || 'A').toUpperCase() === 'B' ? background : foreground;
        const offset = Array.isArray(tile.offset) ? tile.offset : [0,0];
        drawMegaDriveTile(target, tileBytes, bounds.x + number(offset[0]), bounds.y + number(offset[1]), palette, {
          paletteLine:number(tile.paletteLine), hFlip:!!tile.hFlip, vFlip:!!tile.vFlip,
          transparentZero:String(tile.plane || 'A').toUpperCase() !== 'B'
        });
      }
    }
  }
}

function copyPixelCell(target, source, targetCell, sourceCell) {
  const tx=number(targetCell?.[0]) * CELL, ty=number(targetCell?.[1]) * CELL;
  const sx=number(sourceCell?.[0]) * CELL, sy=number(sourceCell?.[1]) * CELL;
  for (let y=0; y<CELL; y+=1) for (let x=0; x<CELL; x+=1) {
    if (tx+x < 0 || ty+y < 0 || tx+x >= target.width || ty+y >= target.height) continue;
    if (sx+x < 0 || sy+y < 0 || sx+x >= source.width || sy+y >= source.height) continue;
    const i=((sy+y)*source.width+(sx+x))*4;
    target.setPixel(tx+x,ty+y,source.data.subarray(i,i+4));
  }
}

function applyDraftVisualOperations(operations, assets, room, background, foreground) {
  if (!operations?.length) return;
  const cache=new Map();
  const sourcePlane=(mapId, plane) => {
    const normalized=String(plane || 'B').toUpperCase() === 'A' ? 'A' : 'B';
    const key=`${Number(mapId)}:${normalized}`;
    if (!cache.has(key)) {
      const dimensions=assets.mapDecoder.dimensions(Number(mapId));
      const palette=assets.palettes.forMap(Number(mapId)).rgba;
      cache.set(key, assets.mapDecoder.renderPlane(Number(mapId), palette, {plane:normalized,phase:0,viewport:{x:0,y:0,width:dimensions.width,height:dimensions.height}}).pixels);
    }
    return cache.get(key);
  };
  for (const operation of operations) {
    if (operation?.kind !== 'visual-map-cell-replacement') continue;
    const target=String(operation.layer || 'B').toUpperCase() === 'A' ? foreground : background;
    const source=sourcePlane(operation.sourceMapId ?? room.mapId, operation.sourceLayer ?? operation.layer ?? 'B');
    copyPixelCell(target,source,operation.visualCell,operation.sourceVisualCell);
  }
}

function classicRoomPixels(classicData, room) {
  if (!room) return null;
  const output = new PixelBuffer(number(room.widthTiles, 1) * CELL, number(room.heightTiles, 1) * CELL, [0,0,0,255]);
  const bank = classicData?.banks?.[String(room.bank)] || [];
  const palette = classicData?.palette || [];
  for (let tileY = 0; tileY < room.heightTiles; tileY += 1) for (let tileX = 0; tileX < room.widthTiles; tileX += 1) {
    const tile = bank[room.tiles[tileY * room.widthTiles + tileX]] || [];
    for (let y = 0; y < CELL; y += 1) for (let x = 0; x < CELL; x += 1)
      output.setPixel(tileX * CELL + x, tileY * CELL + y, palette[tile[y * CELL + x] || 0] || [255,0,255,255]);
  }
  return output;
}

function classicSprite(classicData, spriteId) {
  const source = classicData?.sprites?.[Number(spriteId) | 0];
  if (!source) return null;
  const width = number(classicData.spriteWidth, 32), height = number(classicData.spriteHeight, 21);
  const frame = new PixelBuffer(width, height, [0,0,0,0]);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const colorIndex = number(source[y * width + x]);
    if (colorIndex) frame.setPixel(x, y, classicData.palette[colorIndex] || [255,0,255,255]);
  }
  return frame;
}

function objectBounds(object) {
  const effective = object?.effective || {};
  return rectFromArray(effective.visualBounds) || rectFromArray(effective.gameplayBounds) || rectFromArray(effective.triggerBounds) || (() => {
    const point = pointFrom(effective.position || effective.presentationOrigin || effective.visualAnchor || object?.states?.snapshot?.draw || object?.states?.simulated?.draw);
    return point ? { x:point.x - 4, y:point.y - 4, width:8, height:8 } : null;
  })();
}

function sourceClassicBounds(object) {
  const source = object?.sourceEvidence?.classic;
  if (!source) return null;
  return rectFromArray(source.triggerBounds) || { x:number(source.x), y:number(source.y), width:number(source.w, 8), height:number(source.h, 8) };
}

function objectSourceKey(object) {
  return String(object?.sources?.rdx?.sourceKey || (object?.sources?.classic?.mark != null ? `mark:${number(object.sources.classic.mark)}` : object?.semanticId || ''));
}

function classicEntityForSemanticObject(object) {
  const value = object?.controller?.entity ?? object?.sourceEvidence?.classic?.entity ?? object?.sources?.classic?.entity;
  return Number.isFinite(Number(value)) ? (Number(value) & 0x7f) : -1;
}

function semanticRdxSprite(object, assets, mapId, stateOverride = null) {
  const state = stateOverride || object?.states?.snapshot || object?.states?.simulated || {};
  const pn = state.pn ?? object?.presentation?.pnByState?.snapshot ?? object?.presentation?.pnByState?.simulated ?? object?.components?.find(row => row.owner === 'rdx')?.pn;
  if (!Number.isFinite(Number(pn))) return null;
  const entity = classicEntityForSemanticObject(object);
  const replacement = [67,68].includes(Number(pn)) ? revivalAmmoBoxFrame(entity) : null;
  if (replacement) {
    /* ResolvedLevel stores both the captured RDX draw and the authoritative
     * actor origin. The Revival crate has a different cropped footprint, so
     * expose an origin-registered editor frame using the same foot anchor as
     * native production rather than reusing the old PN67/PN68 draw border. */
    const originX=number(replacement.footAnchorX),originY=number(replacement.footAnchorY);
    const frame=Object.freeze({ ...replacement, originX, originY });
    return Object.freeze({
      frame,pn:Number(pn),mirrorX:false,mirrorY:false,source:'revival-ammo-box',
      animation:Object.freeze({loopOffset:null,frames:Object.freeze([Object.freeze({pixels:frame.pixels,originX,originY,duration:0xffff})])})
    });
  }
  const palette = assets.palettes.forMap(mapId).rgba;
  try {
    const animation=assets.spriteDecoder.framesForPn(Number(pn), palette, { mirrorX:!!state.mirrorX, mirrorY:!!state.mirrorY });
    const frame=assets.spriteDecoder.frameForPn(Number(pn), 0, palette, { mirrorX:!!state.mirrorX, mirrorY:!!state.mirrorY });
    if(!frame)return null;
    return Object.freeze({
      frame,
      pn:Number(pn),
      mirrorX:!!state.mirrorX,
      mirrorY:!!state.mirrorY,
      source:'rdx',
      animation:Object.freeze({ loopOffset:Number.isInteger(animation?.pn?.loopOffset)?Number(animation.pn.loopOffset):null, frames:Object.freeze((animation?.frames || []).map(row=>Object.freeze({ pixels:row.pixels, originX:number(row.originX), originY:number(row.originY), duration:number(row?.pf?.duration,1) }))) })
    });
  } catch { return null; }
}


function semanticRdxSpriteVariants(object, assets, mapId) {
  if (object?.presentation?.owner !== 'rdx') return Object.freeze([]);
  const states = [object?.states?.snapshot, object?.states?.simulated].filter(Boolean);
  const pns = new Set();
  for (const state of states) if (Number.isFinite(Number(state?.pn))) pns.add(Number(state.pn));
  for (const value of Object.values(object?.presentation?.pnByState || {})) if (Number.isFinite(Number(value))) pns.add(Number(value));
  for (const component of object?.components || []) if (component?.owner === 'rdx' && Number.isFinite(Number(component?.pn))) pns.add(Number(component.pn));
  const variants = [];
  for (const pn of pns) for (const mirrorY of [false, true]) for (const mirrorX of [false, true]) {
    const presentation = semanticRdxSprite(object, assets, mapId, { pn, mirrorX, mirrorY });
    if (!presentation?.frame) continue;
    variants.push(Object.freeze({
      pn, mirrorX, mirrorY, frame:presentation.frame, animation:presentation.animation,
      presentation:Object.freeze({ pn, mirrorX, mirrorY, originX:number(presentation.frame.originX), originY:number(presentation.frame.originY) })
    }));
  }
  return Object.freeze(variants);
}

function trapVisualSprite(asset, assets, mapId) {
  if (asset?.kind === 'authored-visual-asset') {
    const authored = authoredVisualAssetById(assets.authoredVisualAssets, String(asset.assetId || ''));
    if (!authored) return null;
    const resolved = resolveAuthoredVisualAsset(authored, assets.mapDecoder);
    const pixels = new PixelBuffer(8, 8, [0,0,0,0]);
    drawMegaDriveTile(pixels, resolved.tileBytes, 0, 0, assets.palettes.forMap(mapId).rgba, {
      paletteLine:number(resolved.paletteLine) & 3,
      transparentZero:true
    });
    return pixels;
  }
  if (asset?.kind !== 'tile-pair') return null;
  const tileIndices = Array.isArray(asset.tileIndices) ? asset.tileIndices.slice(0, 2).map(Number) : [];
  if (tileIndices.length !== 2 || !tileIndices.every(Number.isInteger)) return null;
  const repeat = Array.isArray(asset.repeat) ? asset.repeat.map(Number) : [1,1];
  const repeatX = Math.max(1, Math.min(8, Math.trunc(repeat[0] || 1)));
  const repeatY = Math.max(1, Math.min(8, Math.trunc(repeat[1] || 1)));
  const verticalPair = asset.verticalPair === true;
  const width = repeatX * (verticalPair ? 8 : 16), height = repeatY * (verticalPair ? 16 : 8);
  const pixels = new PixelBuffer(width, height, [0,0,0,0]);
  const palette = assets.palettes.forMap(mapId).rgba;
  const resolved = tileIndices.map(index => assets.mapDecoder.resolveGlobalTile(index));
  if (resolved.some(row => !row?.tileBytes)) return null;
  const paletteLine = number(asset.paletteLine) & 3, mirrorX = asset.mirrorX === true, mirrorY = asset.mirrorY === true;
  for (let ry=0; ry<repeatY; ry+=1) for (let rx=0; rx<repeatX; rx+=1) {
    if (verticalPair) {
      const pair = new PixelBuffer(16, 8, [0,0,0,0]);
      drawMegaDriveTile(pair, resolved[0].tileBytes, 0, 0, palette, { paletteLine, transparentZero:true });
      drawMegaDriveTile(pair, resolved[1].tileBytes, 8, 0, palette, { paletteLine, transparentZero:true });
      for (let sy=0; sy<8; sy+=1) for (let sx=0; sx<16; sx+=1) {
        const si=(sy*16+sx)*4;
        if (!pair.data[si+3]) continue;
        let dx=rx*8+sy, dy=ry*16+(15-sx);
        if (mirrorX) dx=width-1-dx;
        if (mirrorY) dy=height-1-dy;
        pixels.setPixel(dx,dy,pair.data.subarray(si,si+4));
      }
    } else {
      for (let pairIndex=0; pairIndex<2; pairIndex+=1) {
        let dx=rx*16+pairIndex*8, dy=ry*8;
        if (mirrorX) dx=width-8-dx;
        if (mirrorY) dy=height-8-dy;
        drawMegaDriveTile(pixels, resolved[pairIndex].tileBytes, dx, dy, palette, { paletteLine, hFlip:mirrorX, vFlip:mirrorY, transparentZero:true });
      }
    }
  }
  return pixels;
}

function terrainHazardEntities(room, assets, paneOrigin) {
  const registryRoom = (assets.trapRegistry?.rooms || []).find(row => Number(row.submap) === Number(room.submap) && Number(row.mapId) === Number(room.mapId));
  const registryById = new Map((registryRoom?.traps || []).map(row => [String(row.id), row]));
  const rows = [];
  for (const hazard of room?.layers?.semanticCorpus?.terrainHazards || []) {
    const state = String(hazard.state || 'static');
    const registryHazard = registryById.get(String(hazard.id)) || null;
    const authoredVisual = hazard?.visuals?.[state] || hazard?.visuals?.static || null;
    const registryVisual = registryHazard?.visuals?.[state] || registryHazard?.visuals?.static || null;
    const visual = authoredVisual?.asset ? authoredVisual : registryVisual || authoredVisual || null;
    const effective = hazard.effective || {};
    const rect = rectFromArray(effective.visualBounds) || rectFromArray(hazard?.contact?.bounds) || (() => {
      const p=pointFrom(visual?.position || effective.position || hazard.position), size=pointFrom(visual?.size);
      return p ? { x:p.x, y:p.y, width:size?.x || 8, height:size?.y || 8 } : null;
    })();
    if (!rect) continue;
    const sprite = visual?.visible === false ? null : trapVisualSprite(visual?.asset, assets, room.mapId);
    rows.push(Object.freeze({
      id:String(hazard.semanticId || hazard.id), kind:'terrain-hazard', class:'trap', family:hazard.family,
      rect:{ ...rect, x:rect.x+paneOrigin.x, y:rect.y+paneOrigin.y },
      sprite, spriteDraw:sprite ? { x:paneOrigin.x+number(visual?.position?.[0], rect.x), y:paneOrigin.y+number(visual?.position?.[1], rect.y) } : null,
      actorDepth:'behind-midground', front:false, visible:visual?.visible !== false, hazard, sourceMode:'effective'
    }));
  }
  return rows;
}

function rawRdxActors(room, assets, paneOrigin) {
  const palette = assets.palettes.forMap(room.mapId).rgba;
  return (room?.layers?.source?.rdx?.actors || []).map(actor => {
    const definition = assets.spriteDecoder.parseActorDef(number(actor.actorId));
    const preferred = definition?.pnSlots?.find(slot => slot.slot === definition.fallbackSlot)?.pn ?? definition?.pnUnique?.[0];
    let sprite = null;
    try { if (Number.isFinite(Number(preferred))) sprite = assets.spriteDecoder.frameForPn(Number(preferred), 0, palette); } catch {}
    const origin = { x:paneOrigin.x + number(actor.x), y:paneOrigin.y + number(actor.y) };
    const rect = sprite ? { x:origin.x - sprite.originX, y:origin.y - sprite.originY, width:sprite.pixels.width, height:sprite.pixels.height }
      : { x:origin.x - 4, y:origin.y - 4, width:8, height:8 };
    return Object.freeze({ id:String(actor.sourceRef || `rdx:${room.mapName}:spawn:${actor.index}`), kind:'source', sourceKind:'rdx-actor', class:'source-actor', rect, origin, sprite:sprite?.pixels || null, spriteOrigin:sprite ? { x:sprite.originX, y:sprite.originY } : null, actorId:number(actor.actorId), spawnIndex:number(actor.index), source:actor });
  });
}

function classicDisplayRoom(room) {
  if (!room?.preview) return { room, yOffset:0 };
  const preview = { ...room, ...room.preview, bank:room.bank };
  return { room:preview, yOffset:(number(room.startRow) - number(preview.startRow)) * CELL };
}

function semanticActorDepth(object, state = null) {
  const depth=String(state?.actorDepth || state?.depth || object?.presentation?.layer || '');
  if (depth === 'behind-midground' || depth === 'normal' || depth === 'front') return depth;
  return state?.front === true ? 'front' : 'normal';
}

function semanticEntities(room, assets, paneOrigin, mode, classicPreview = null) {
  const out = [];
  for (const object of room?.layers?.semanticCorpus?.objects || []) {
    if (object.class === 'player') continue;
    if (mode === 'classic') {
      const source = object?.sourceEvidence?.classic;
      if (!source) continue;
      const sprite = classicSprite(assets.classicPreview, source.sprite);
      const rect = sourceClassicBounds(object);
      if (!rect) continue;
      const { yOffset } = classicDisplayRoom(classicPreview);
      out.push(Object.freeze({ id:String(object.semanticId), sourceKey:objectSourceKey(object), kind:'semantic-object', class:object.class, family:object.family, rect:{ ...rect, x:rect.x + paneOrigin.x, y:rect.y + paneOrigin.y + yOffset }, sprite, spriteDraw:sprite ? { x:paneOrigin.x + number(source.x), y:paneOrigin.y + number(source.y) + yOffset } : null, presentationPoint:sprite ? { x:paneOrigin.x + number(source.x), y:paneOrigin.y + number(source.y) + yOffset } : null, object, visible:true, front:false, sourceMode:'classic' }));
      continue;
    }
    const rect = objectBounds(object);
    if (!rect) continue;
    const snapshotState=object?.states?.snapshot || object?.states?.simulated || {},simulatedState=object?.states?.simulated || snapshotState;
    const spritePresentation = object?.presentation?.owner === 'rdx' ? semanticRdxSprite(object, assets, room.mapId, snapshotState) : null;
    const runtimeSpritePresentation = object?.presentation?.owner === 'rdx' ? semanticRdxSprite(object, assets, room.mapId, simulatedState) : null;
    const runtimeSpriteVariants = semanticRdxSpriteVariants(object, assets, room.mapId);
    const spriteFrame=spritePresentation?.frame || null,runtimeSpriteFrame=runtimeSpritePresentation?.frame || spriteFrame;
    const revivalAmmo=spritePresentation?.source === 'revival-ammo-box';
    const runtimeRevivalAmmo=runtimeSpritePresentation?.source === 'revival-ammo-box';
    const draw = pointFrom((revivalAmmo ? snapshotState?.origin : snapshotState?.draw) || object?.effective?.presentationOrigin || object?.effective?.position);
    const runtimeDraw=pointFrom((runtimeRevivalAmmo ? simulatedState?.origin : simulatedState?.draw) || draw);
    const gameplayRect=rectFromArray(object?.effective?.gameplayBounds);
    const runtimeBodyLocal=gameplayRect ? {x:gameplayRect.x,y:gameplayRect.y} : pointFrom(object?.effective?.position || object?.alignedBaseline?.origin);
    out.push(Object.freeze({
      id:String(object.semanticId), sourceKey:objectSourceKey(object), kind:'semantic-object', class:object.class, family:object.family,
      rect:{ ...rect, x:rect.x + paneOrigin.x, y:rect.y + paneOrigin.y },
      sprite:spriteFrame?.pixels || null,
      spriteDraw:spriteFrame && draw ? { x:paneOrigin.x + Math.round(draw.x - spriteFrame.originX), y:paneOrigin.y + Math.round(draw.y - spriteFrame.originY) } : null,
      presentationPoint:draw ? { x:paneOrigin.x + draw.x, y:paneOrigin.y + draw.y } : null,
      spriteAnimation:spritePresentation?.animation || null,
      spritePresentation:spritePresentation ? Object.freeze({ pn:spritePresentation.pn, mirrorX:spritePresentation.mirrorX, mirrorY:spritePresentation.mirrorY, originX:number(spriteFrame?.originX), originY:number(spriteFrame?.originY) }) : null,
      runtimeSprite:runtimeSpriteFrame?.pixels || spriteFrame?.pixels || null,
      runtimePresentationPoint:runtimeDraw ? { x:paneOrigin.x + runtimeDraw.x, y:paneOrigin.y + runtimeDraw.y } : (draw ? {x:paneOrigin.x+draw.x,y:paneOrigin.y+draw.y}:null),
      runtimeSpriteAnimation:runtimeSpritePresentation?.animation || spritePresentation?.animation || null,
      runtimeSpritePresentation:runtimeSpritePresentation ? Object.freeze({pn:runtimeSpritePresentation.pn,mirrorX:runtimeSpritePresentation.mirrorX,mirrorY:runtimeSpritePresentation.mirrorY,originX:number(runtimeSpriteFrame?.originX),originY:number(runtimeSpriteFrame?.originY)}):null,
      runtimeSpriteVariants,
      runtimeBodyPoint:runtimeBodyLocal ? Object.freeze({x:paneOrigin.x+runtimeBodyLocal.x,y:paneOrigin.y+runtimeBodyLocal.y}) : null,
      runtimeVisible:simulatedState.visible !== false,runtimeActorDepth:semanticActorDepth(object, simulatedState),runtimeFront:semanticActorDepth(object, simulatedState) === 'front',
      object, visible:snapshotState.visible !== false, actorDepth:semanticActorDepth(object, snapshotState), front:semanticActorDepth(object, snapshotState) === 'front', sourceMode:'effective'
    }));
  }
  return out;
}

function boundsForEntity(entity) {
  const rows = [];
  if (entity.hazard) {
    const hazard=entity.hazard, effective=hazard.effective || {};
    for (const [kind,value] of [['visual',effective.visualBounds],['gameplay',effective.gameplayBounds || hazard?.contact?.bounds]]) {
      const rect=rectFromArray(value);
      if (rect) rows.push(Object.freeze({ id:`${entity.id}:${kind}`, entityId:entity.id, kind, rect:{ ...rect, x:rect.x + (entity.rect.x - (rectFromArray(effective.visualBounds) || rect).x), y:rect.y + (entity.rect.y - (rectFromArray(effective.visualBounds) || rect).y) } }));
    }
    return rows;
  }
  const object = entity.object;
  const effective = object?.effective || {};
  const base=objectBounds(object);
  if (!base) return rows;
  for (const [kind, value] of [['visual', effective.visualBounds], ['gameplay', effective.gameplayBounds], ['trigger', effective.triggerBounds], ['support', effective.supportBounds]]) {
    const rect = rectFromArray(value);
    if (rect) rows.push(Object.freeze({ id:`${entity.id}:${kind}`, entityId:entity.id, kind, rect:{ ...rect, x:rect.x + (entity.rect.x - base.x), y:rect.y + (entity.rect.y - base.y) } }));
  }
  return rows;
}

function correspondenceCells(submap, assets, pane, mode) {
  const room = assets.correspondence.roomForSubmap(submap);
  if (!room) return [];
  const out = [];
  if (mode === 'classic') {
    const yOffsetCells = number(room.classicPreviewYOffsetPx) / CELL;
    for (let y = 0; y < room.classicPreviewHeight; y += 1) for (let x = 0; x < room.classicPreviewWidth; x += 1) {
      const classicY = y - yOffsetCells;
      const cell = Number.isInteger(classicY) ? assets.correspondence.classicCell(submap, x, classicY) : null;
      out.push(Object.freeze({ id:`classic:${x}:${y}`, kind:'correspondence-cell', side:'classic', x, y, classicX:x, classicY, rect:{ x:pane.x + x*CELL, y:pane.y + y*CELL, width:CELL, height:CELL }, mapped:!!cell, ...(cell || {}) }));
    }
  } else {
    for (let y = 0; y < room.height; y += 1) for (let x = 0; x < room.width; x += 1) {
      const cell = assets.correspondence.cell(submap, x, y);
      out.push(Object.freeze({ id:`rdx:${x}:${y}`, kind:'correspondence-cell', side:'rdx', x, y, rect:{ x:pane.x + x*CELL, y:pane.y + y*CELL, width:CELL, height:CELL }, mapped:!!cell, ...(cell || {}) }));
    }
  }
  return out;
}

function collisionCells(room, assets, paneOrigin, topology = null) {
  const rawDimensions = room?.layers?.source?.rdx?.dimensions || assets.mapDecoder.dimensions(room.mapId);
  const dimensions = effectiveMapDimensions(rawDimensions, topology);
  const mask = assets.mapDecoder.geometryMask(room.mapId, { x:0, y:0, width:dimensions.width, height:dimensions.height }, { topology });
  const overrides = new Map();
  for (const operation of room?.layers?.structuralCorrections?.operations || []) {
    if (operation.type !== 'gameplay-cell-override' || !Array.isArray(operation.g8Bounds)) continue;
    const [gx, gy, width, height] = operation.g8Bounds.map(Number);
    for (let y = gy; y < gy + height; y += 1) for (let x = gx; x < gx + width; x += 1) overrides.set(`${x}:${y}`, operation);
  }
  const rows = [];
  for (let y = 0; y < mask.height; y += 1) for (let x = 0; x < mask.width; x += 1) {
    const rawKind = mask.data[y * mask.width + x] || 0;
    const override = overrides.get(`${x}:${y}`) || null;
    let effectiveKind = rawKind;
    if (override?.action === 'open') effectiveKind = 0;
    else if (override?.action === 'one-way') effectiveKind = 2;
    else if (override?.action === 'climb-through') effectiveKind = 3;
    else if (override?.action === 'lethal') effectiveKind = 4;
    else if (override?.action === 'exit') effectiveKind = 5;
    if (!rawKind && !override) continue;
    rows.push(Object.freeze({
      id:`collision:${x}:${y}`, kind:'collision-cell', gx:x, gy:y,
      rect:{ x:paneOrigin.x + x*CELL, y:paneOrigin.y + y*CELL, width:CELL, height:CELL },
      rawKind:COLLISION_KIND[rawKind] || `kind-${rawKind}`, effectiveKind:COLLISION_KIND[effectiveKind] || `kind-${effectiveKind}`,
      override,
      exitAnchor:override?.action === 'exit' && Number(override?.g8Bounds?.[0]) === x && Number(override?.g8Bounds?.[1]) === y,
      exitBounds:override?.action === 'exit' && Array.isArray(override?.g8Bounds)
        ? { x:paneOrigin.x + Number(override.g8Bounds[0])*CELL, y:paneOrigin.y + Number(override.g8Bounds[1])*CELL,
            width:Number(override.g8Bounds[2])*CELL, height:Number(override.g8Bounds[3])*CELL }
        : null,
      sourceProven:mask.proven
    }));
  }
  return rows;
}

function provenanceRegions(room, paneOrigin) {
  const rows = [];
  for (const operation of room?.layers?.structuralCorrections?.operations || []) {
    let rect = rectFromArray(operation.bounds);
    if (!rect && Array.isArray(operation.g8Bounds)) rect = { x:number(operation.g8Bounds[0])*CELL, y:number(operation.g8Bounds[1])*CELL, width:number(operation.g8Bounds[2])*CELL, height:number(operation.g8Bounds[3])*CELL };
    if (!rect) continue;
    rows.push(Object.freeze({ id:operation.id, kind:'provenance-region', layer:'D', rect:{ ...rect, x:rect.x + paneOrigin.x, y:rect.y + paneOrigin.y }, reason:operation.reason || operation.provenance || '', authority:operation.authority || null, operation }));
  }
  for (const operation of room?.layers?.adjustments?.operations || []) {
    const rect = rectFromArray(operation?.operation?.rect);
    if (!rect) continue;
    rows.push(Object.freeze({ id:operation.id, kind:'provenance-region', layer:'F', rect:{ ...rect, x:rect.x + paneOrigin.x, y:rect.y + paneOrigin.y }, reason:operation.provenance || '', authority:operation.authority || null, operation }));
  }
  return rows;
}

function relationshipLines(graph, entities, paneOrigin) {
  const centers = new Map(entities.map(entity => [entity.id, { x:entity.rect.x + entity.rect.width/2, y:entity.rect.y + entity.rect.height/2 }]));
  for (const node of graph.nodes || []) if (!centers.has(node.id) && Array.isArray(node.position)) centers.set(node.id, { x:paneOrigin.x + number(node.position[0]), y:paneOrigin.y + number(node.position[1]) });
  return (graph.edges || []).map(edge => {
    const from = centers.get(edge.from), to = centers.get(edge.to);
    return from && to ? Object.freeze({ ...edge, kind:'relationship', fromPoint:from, toPoint:to }) : null;
  }).filter(Boolean);
}

export class StaticRoomProjector {
  constructor() { this.cache = new WeakMap(); }

  project(inspection, { presentation = 'rdx', sourceView = 'effective', draftVisualOperations = [] } = {}) {
    const { room, assets, classicPreview, collision, provenance, relationships, geometryProvenance } = inspection;
    const rawMapDimensions = room?.layers?.source?.rdx?.dimensions || assets.mapDecoder.dimensions(room.mapId);
    const topology = sourceView === 'effective'
      ? (room?.layers?.structuralCorrections?.topology || room?.effective?.mapping?.rdxTopology || null)
      : null;
    const mapDimensions = effectiveMapDimensions(rawMapDimensions, topology);
    const classicDisplay = classicDisplayRoom(classicPreview);
    const classicWidth = number(classicDisplay.room?.widthTiles, 32) * CELL;
    const classicHeight = number(classicDisplay.room?.heightTiles, 0) * CELL;
    const panes = [];
    const includeClassic = presentation === 'classic' || presentation === 'compare';
    const includeRdx = presentation === 'rdx' || presentation === 'compare';
    const classicOrigin = { x:0, y:0 };
    const rdxOrigin = presentation === 'compare' ? { x:classicWidth + COMPARE_GAP, y:0 } : { x:0, y:0 };
    if (includeClassic) panes.push(Object.freeze({ id:'classic', x:classicOrigin.x, y:classicOrigin.y, width:classicWidth, height:classicHeight, pixels:classicRoomPixels(assets.classicPreview, classicDisplay.room), authority:'RDR-generated Layer-B Classic normalization', sourceRef:room?.layers?.source?.classic?.ref || null, sourceStartRow:number(classicPreview?.startRow), displayStartRow:number(classicDisplay.room?.startRow), yOffset:classicDisplay.yOffset }));
    let rdxBackdrop = null, rdxMidground = null, rdxForeground = null, rdxPlaneB = null, rdxPlaneA = null;
    if (includeRdx) {
      const palette = assets.palettes.forMap(room.mapId).rgba;
      const viewport = { x:0, y:0, width:mapDimensions.width, height:mapDimensions.height };
      rdxPlaneB = assets.mapDecoder.renderPlane(room.mapId, palette, { plane:'B', phase:0, viewport, topology }).pixels;
      rdxPlaneA = assets.mapDecoder.renderPlane(room.mapId, palette, { plane:'A', phase:0, viewport, topology }).pixels;
      if (sourceView === 'effective') {
        applyTerrainHazardDetachments(room, assets.mapDecoder, palette, rdxPlaneB, rdxPlaneA);
        applyVisualCorrections(room, assets, assets.mapDecoder, palette, rdxPlaneB, rdxPlaneA);
        applyDraftVisualOperations(draftVisualOperations, assets, room, rdxPlaneB, rdxPlaneA);
        const uncroppedDraftB=new Set((draftVisualOperations || [])
          .filter(operation => operation?.kind === 'visual-map-cell-replacement' && String(operation.layer || 'B').toUpperCase() === 'B')
          .map(operation => `${number(operation.visualCell?.[0])},${number(operation.visualCell?.[1])}`));
        const splitB=splitPlaneByPresentationDepth({ source:rdxPlaneB, model:room?.layers?.presentationDepth, mapDecoder:assets.mapDecoder, mapId:room.mapId, plane:'B', phase:0, topology, viewport, cropToVisibleSource:true, uncroppedCells:uncroppedDraftB });
        const splitA=splitPlaneByPresentationDepth({ source:rdxPlaneA, model:room?.layers?.presentationDepth, mapDecoder:assets.mapDecoder, mapId:room.mapId, plane:'A', phase:0, topology, viewport });
        const composedDepth=composePresentationDepthPlanes(splitB,splitA);
        rdxBackdrop=composedDepth.backdrop;
        rdxMidground=composedDepth.midground;
        rdxForeground=composedDepth.foreground;
      } else {
        rdxBackdrop=new PixelBuffer(mapDimensions.width,mapDimensions.height,[0,0,0,0]);
        rdxMidground=rdxPlaneB;
        rdxForeground=rdxPlaneA;
      }
      panes.push(Object.freeze({ id:'rdx', x:rdxOrigin.x, y:rdxOrigin.y, width:mapDimensions.width, height:mapDimensions.height,
        backdrop:rdxBackdrop, midground:rdxMidground, foreground:rdxForeground, sourcePlaneB:rdxPlaneB, sourcePlaneA:rdxPlaneA,
        background:rdxBackdrop, foregroundBehindActors:rdxMidground,
        authority:sourceView === 'effective' ? 'ResolvedLevel presentation-depth composition' : 'decoded RDX source planes', sourceRef:room?.layers?.source?.rdx?.ref || null }));
    }
    const width = presentation === 'compare' ? classicWidth + COMPARE_GAP + mapDimensions.width : includeClassic ? classicWidth : mapDimensions.width;
    const height = Math.max(includeClassic ? classicHeight : 0, includeRdx ? mapDimensions.height : 0, 1);

    const entities = [];
    if (includeClassic) entities.push(...semanticEntities(room, assets, classicOrigin, 'classic', classicPreview));
    if (includeRdx) {
      if (sourceView === 'raw-rdx') entities.push(...rawRdxActors(room, assets, rdxOrigin));
      else {
        entities.push(...semanticEntities(room, assets, rdxOrigin, 'rdx'));
        entities.push(...terrainHazardEntities(room, assets, rdxOrigin));
      }
    }
    const bounds = entities.flatMap(boundsForEntity);
    const correspondence = [];
    if (includeClassic) correspondence.push(...correspondenceCells(room.submap, assets, classicOrigin, 'classic'));
    if (includeRdx) correspondence.push(...correspondenceCells(room.submap, assets, rdxOrigin, 'rdx'));
    const collisionCellsProjected = includeRdx ? collisionCells(room, assets, rdxOrigin, topology) : [];
    const provenanceRegionsProjected = includeRdx ? provenanceRegions(room, rdxOrigin) : [];
    const relationshipProjected = relationshipLines(relationships, entities.filter(row => row.sourceMode !== 'classic'), rdxOrigin);

    return Object.freeze({
      room, presentation, sourceView, bounds:{ x:0, y:0, width, height }, panes:Object.freeze(panes),
      entities:Object.freeze(entities), boundsOverlay:Object.freeze(bounds),
      correspondence:Object.freeze(correspondence), collision:Object.freeze(collisionCellsProjected),
      provenanceRegions:Object.freeze(provenanceRegionsProjected), relationships:Object.freeze(relationshipProjected),
      provenance, geometryProvenance, collisionSummary:collision ? Object.freeze({ availability:collision.availability, coverage:collision.coverage, verifiedClasses:collision.verifiedClasses || [], unresolvedClasses:collision.unresolvedClasses || [], notes:collision.notes || '' }) : null,
      correspondenceSummary:assets.correspondence.summary(room.submap),
      alignment:room?.layers?.alignment || null
    });
  }

  hit(frame, world, visibility = {}) {
    const within = rect => world.x >= rect.x && world.x < rect.x + rect.width && world.y >= rect.y && world.y < rect.y + rect.height;
    if (visibility.entities !== false) {
      for (let i = frame.entities.length - 1; i >= 0; i -= 1) if (within(frame.entities[i].rect)) return frame.entities[i];
    }
    if (visibility.correspondence) {
      for (let i = frame.correspondence.length - 1; i >= 0; i -= 1) if (within(frame.correspondence[i].rect)) return frame.correspondence[i];
    }
    if (visibility.collision) {
      for (let i = frame.collision.length - 1; i >= 0; i -= 1) if (within(frame.collision[i].rect)) return frame.collision[i];
    }
    if (visibility.provenance) {
      for (let i = frame.provenanceRegions.length - 1; i >= 0; i -= 1) if (within(frame.provenanceRegions[i].rect)) return frame.provenanceRegions[i];
    }
    return null;
  }

  inspect(frame, selection) {
    if (!selection) return null;
    const id = String(selection.id);
    const entity = frame.entities.find(row => row.id === id);
    if (entity) return Object.freeze({ kind:entity.kind, id, entity, object:entity.object || null, hazard:entity.hazard || null });
    const correspondence = frame.correspondence.find(row => row.id === id);
    if (correspondence) return Object.freeze({ kind:'correspondence-cell', id, correspondence, alignment:frame.alignment });
    const collision = frame.collision.find(row => row.id === id);
    if (collision) return Object.freeze({ kind:'collision-cell', id, collision });
    const provenance = frame.provenanceRegions.find(row => row.id === id);
    if (provenance) return Object.freeze({ kind:'provenance-region', id, provenance });
    const node = frame.relationships.find(row => row.id === id);
    if (node) return Object.freeze({ kind:'relationship', id, relationship:node });
    return null;
  }
}

export { COLLISION_KIND, COMPARE_GAP, CELL };
