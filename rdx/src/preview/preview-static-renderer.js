import { PixelBuffer, drawMegaDriveTile } from '../render/pixel-buffer.js';
import { clearRect, fillRectColor } from './preview-render-primitives.js';
import { composePresentationDepthPlanes, splitPlaneByPresentationDepth } from '../levels/presentation-depth.js';
import { applyPresentationDepthClassEdits } from '../editor/presentation-depth-class-authoring.js';
import { authoredVisualAssetById, resolveAuthoredVisualAsset } from '../levels/authored-visual-assets.js';

export const RDX_ASSET_FLAG_SCENERY_ASSEMBLY = 0x08;

function resolvedPatchTileBytes(renderer, tile, cache = new Map()) {
  const assetId = String(tile?.assetId || '').trim();
  if (!assetId) {
    const resolved = renderer.mapDecoder.resolveGlobalTile(Number(tile?.globalTile));
    return resolved?.tileBytes || null;
  }
  if (!cache.has(assetId)) {
    if (!renderer.authoredVisualAssets) return null;
    const asset = authoredVisualAssetById(renderer.authoredVisualAssets, assetId);
    cache.set(assetId, asset ? resolveAuthoredVisualAsset(asset, renderer.mapDecoder) : null);
  }
  return cache.get(assetId)?.tileBytes || null;
}

export function sceneryAssemblyFrame(spriteDecoder, palette, state, context = {}) {
  if (state?.kind === 'authored-visual-asset') {
    const asset = authoredVisualAssetById(context?.authoredVisualAssets, String(state.assetId || ''));
    if (!asset || !context?.mapDecoder) return null;
    const resolved = resolveAuthoredVisualAsset(asset, context.mapDecoder);
    const pixels = new PixelBuffer(8, 8);
    drawMegaDriveTile(pixels, resolved.tileBytes, 0, 0, palette, {
      paletteLine:Number(resolved.paletteLine || 0) & 3,
      transparentZero:true
    });
    return Object.freeze({
      pixels,
      originX:0, originY:0,
      footAnchorX:0, footAnchorY:0,
      pn:Object.freeze({ count:1 }), frameIndex:0,
      sceneryAssembly:true, repeat:Object.freeze([1,1]), paletteLine:Number(resolved.paletteLine || 0) & 3,
      authoredVisualAsset:true, assetId:String(state.assetId || '')
    });
  }
  const flags = Number(state?.assetFlags || 0);
  if (!(flags & RDX_ASSET_FLAG_SCENERY_ASSEMBLY) && Number(state?.visualKind || 0) !== 1) return null;
  const tileIndices = Array.isArray(state?.tileIndices) ? state.tileIndices.map(Number) : [];
  const repeat = Array.isArray(state?.repeat) ? state.repeat.map(Number) : [];
  const repeatX = Math.max(1, Math.min(8, Math.trunc(repeat[0] || 1)));
  const repeatY = Math.max(1, Math.min(8, Math.trunc(repeat[1] || 1)));
  if (tileIndices.length < 2 || !tileIndices.every(Number.isInteger)) return null;
  let pp;
  try { pp = spriteDecoder?.rom?.payload('PP', 0xffff); } catch { return null; }
  const [tile0, tile1] = tileIndices;
  if (!pp || (Math.max(tile0, tile1) + 1) * 32 > pp.length) return null;
  const verticalPair = !!state.verticalPair;
  const width = repeatX * (verticalPair ? 8 : 16), height = repeatY * (verticalPair ? 16 : 8);
  const pixels = new PixelBuffer(width, height);
  const mirrorX = !!state.mirrorX, mirrorY = !!state.mirrorY;
  const paletteLine = Number(state.paletteLine || 0) & 3;
  for (let ry = 0; ry < repeatY; ry += 1) for (let rx = 0; rx < repeatX; rx += 1) {
    if (verticalPair) {
      /* The source family is one horizontal 16x8 two-tile blade.  Stacking
       * its halves vertically does not make a vertical blade: it produces the
       * exact orientation bug reported in MD0006/MD0008.  Rotate the complete
       * assembly 90 degrees counter-clockwise so the floor blade's upward
       * point becomes a right-wall blade pointing left. */
      const pairPixels = new PixelBuffer(16, 8);
      drawMegaDriveTile(pairPixels, pp.subarray(tile0 * 32, tile0 * 32 + 32), 0, 0, palette, {
        paletteLine, transparentZero: true
      });
      drawMegaDriveTile(pairPixels, pp.subarray(tile1 * 32, tile1 * 32 + 32), 8, 0, palette, {
        paletteLine, transparentZero: true
      });
      for (let sy = 0; sy < 8; sy += 1) for (let sx = 0; sx < 16; sx += 1) {
        const si = (sy * 16 + sx) * 4;
        if (!pairPixels.data[si + 3]) continue;
        let dx = rx * 8 + sy, dy = ry * 16 + (15 - sx);
        if (mirrorX) dx = width - 1 - dx;
        if (mirrorY) dy = height - 1 - dy;
        pixels.setPixel(dx, dy, pairPixels.data.subarray(si, si + 4));
      }
    } else {
      for (let pair = 0; pair < 2; pair += 1) {
        const tileIndex = pair ? tile1 : tile0;
        let dx = rx * 16 + pair * 8, dy = ry * 8;
        if (mirrorX) dx = width - 8 - dx;
        if (mirrorY) dy = height - 8 - dy;
        drawMegaDriveTile(pixels, pp.subarray(tileIndex * 32, tileIndex * 32 + 32), dx, dy, palette, {
          paletteLine, hFlip: mirrorX, vFlip: mirrorY, transparentZero: true
        });
      }
    }
  }
  const anchor = Array.isArray(state.productionAnchor) ? state.productionAnchor : [width / 2, height];
  return Object.freeze({
    pixels,
    originX: Number(anchor[0] || 0), originY: Number(anchor[1] || 0),
    footAnchorX: Number(anchor[0] || 0), footAnchorY: Number(anchor[1] || 0),
    pn: Object.freeze({ count: 1 }), frameIndex: 0,
    sceneryAssembly: true, tileIndices: Object.freeze([tile0, tile1]),
    repeat: Object.freeze([repeatX, repeatY]), paletteLine
  });
}

function descriptorTrapSceneryVisualFor(trap, visualKey) {
  const visual = trap?.visuals?.[visualKey] || null;
  const asset = visual?.asset || null;
  if (!visual?.visible || !['tile-pair', 'authored-visual-asset'].includes(asset?.kind)) return null;
  const position = (Array.isArray(visual.position) ? visual.position : trap.position || []).map(Number);
  const size = (Array.isArray(visual.size) ? visual.size : []).map(Number);
  if (position.length < 2 || !position.slice(0, 2).every(Number.isFinite)) return null;
  const state = asset.kind === 'authored-visual-asset'
    ? { kind:'authored-visual-asset', assetId:String(asset.assetId || ''), front:!!asset.front }
    : {
      assetFlags:Number(asset.assetFlags ?? RDX_ASSET_FLAG_SCENERY_ASSEMBLY),
      visualKind:1,
      tileIndices:Array.isArray(asset.tileIndices) ? asset.tileIndices.slice(0, 2).map(Number) : [],
      repeat:Array.isArray(asset.repeat) ? asset.repeat.slice(0, 2).map(Number) : [1, 1],
      paletteLine:Number(asset.paletteLine || 0),
      mirrorX:!!asset.mirrorX,
      mirrorY:!!asset.mirrorY,
      front:!!asset.front,
      verticalPair:!!asset.verticalPair
    };
  return Object.freeze({
    position:Object.freeze(position.slice(0, 2)),
    size:Object.freeze(size.length >= 2 && size.slice(0, 2).every(Number.isFinite) ? size.slice(0, 2) : [8, 8]),
    state:Object.freeze(state)
  });
}

export function staticTrapSceneryVisual(trap) {
  if (!trap || String(trap.state || '') !== 'static') return null;
  return descriptorTrapSceneryVisualFor(trap, 'static');
}

export function statefulTrapSceneryVisual(trap, nativeRuntimeStates = new Map(), override = null) {
  if (!trap || String(trap.state || '') !== 'active' || Number(trap.sourceMark || 0) <= 0) return null;
  if (override?.visible === false) return null;
  const states = nativeRuntimeStates instanceof Map ? nativeRuntimeStates : new Map();
  const live = states.get(`mark:${Number(trap.sourceMark)}`) || null;
  /* Native descriptor scenery uses RDX_SCENERY_VISIBLE_WHILE_ASLEEP.  Once the
   * source mark has been activated/deactivated, the mapped Classic mechanism
   * drops out of the resolved projection and both scenery + contact disappear. */
  if (live && Number(live?.nativeEntity?.mapped) === 0) return null;
  return descriptorTrapSceneryVisualFor(trap, 'active');
}

export function reviewedRdxTraps(registry, submap, mapId) {
  const room = (registry?.rooms || []).find(row => Number(row.submap) === Number(submap)
    && Number(row.mapId) === Number(mapId));
  return room ? (room.traps || []).map(row => ({ ...row, authority: row.authority || room.authority })) : [];
}

export function reviewedAbsentClassicHazards(registry, submap, mapId) {
  const room = (registry?.rooms || []).find(row => Number(row.submap) === Number(submap)
    && Number(row.mapId) === Number(mapId));
  return room ? (room.absentClassicHazards || []).map(row => ({ ...row })) : [];
}

export function statefulEmbeddedMapArtSuppressions(registry, submap, mapId, nativeRuntimeStates = new Map()) {
  const states = nativeRuntimeStates instanceof Map ? nativeRuntimeStates : new Map();
  const out = [];
  for (const trap of reviewedRdxTraps(registry, submap, mapId)) {
    if (String(trap.mounting || '') !== 'embedded-map-art') continue;
    const state = String(trap.state || 'static');
    if (state === 'static') continue;
    const sourceMark = Number(trap.sourceMark || 0);
    const live = sourceMark > 0 ? states.get(`mark:${sourceMark}`) : null;
    /* Stateful map art starts in its authored state. Native xrick remains the
     * lifecycle authority once Simulate/Playtest supplies a source mark. A
     * deactivated Classic mechanism remains allocated but drops out of the
     * mapped room projection, so `mapped == 0` is a stronger signal than its
     * presentation visibility (which may itself be deliberately suppressed). */
    const inactive = state === 'inactive' || (state === 'active' && live && Number(live?.nativeEntity?.mapped) === 0);
    if (!inactive) continue;
    const activeVisual = trap.visuals?.active || null;
    const bounds = activeVisual?.position && activeVisual?.size
      ? [...activeVisual.position.slice(0, 2).map(Number), ...activeVisual.size.slice(0, 2).map(Number)]
      : Array.isArray(trap.contact?.bounds) ? trap.contact.bounds.slice(0, 4).map(Number) : null;
    if (!bounds || bounds.length !== 4 || bounds.some(value => !Number.isFinite(value)) || bounds[2] <= 0 || bounds[3] <= 0) continue;
    const planes = Array.isArray(activeVisual?.planes)
      ? [...new Set(activeVisual.planes.map(value => String(value).toUpperCase()))].filter(value => value === 'A' || value === 'B') : [];
    for (const plane of planes) out.push(Object.freeze({
      trapId:String(trap.id || ''), sourceMark, x:bounds[0], y:bounds[1], width:bounds[2], height:bounds[3], plane
    }));
  }
  return Object.freeze(out);
}

export function statefulEmbeddedMapArtSignature(registry, submap, mapId, nativeRuntimeStates = new Map()) {
  return statefulEmbeddedMapArtSuppressions(registry, submap, mapId, nativeRuntimeStates)
    .map(row => `${row.trapId}:${row.sourceMark}:${row.x},${row.y},${row.width},${row.height}`).join('|');
}

export function descriptorSourceDetachmentRects(registry, submap, mapId) {
  const families = new Map((registry?.rdxAssetFamilies || []).map(row => [String(row.id), row]));
  const seen = new Set(), out = [];
  for (const trap of reviewedRdxTraps(registry, submap, mapId)) {
    const family = families.get(String(trap.family || '')) || null;
    const bounds = Array.isArray(trap.sourceBounds) ? trap.sourceBounds.map(Number) : [];
    const detachment = trap.sourceMapDetachment || null;
    const planes = Array.isArray(detachment?.planes)
      ? [...new Set(detachment.planes.map(value => String(value).toUpperCase()))].filter(value => value === 'A' || value === 'B')
      : [];
    if (family?.runtimePresentation !== 'descriptor-reusable-scenery' || !detachment || bounds.length !== 4 || !planes.length)
      continue;
    if (bounds.some(value => !Number.isInteger(value)) || bounds[2] <= 0 || bounds[3] <= 0) continue;
    const restore = detachment.backgroundRestore || null;
    const restoreTiles = Array.isArray(restore?.tiles) ? restore.tiles.map(tile => Object.freeze({
      offset:Object.freeze(Array.isArray(tile?.offset) ? tile.offset.map(Number) : []),
      globalTile:Number(tile?.globalTile), paletteLine:Number(tile?.paletteLine || 0),
      hFlip:tile?.hFlip === true, vFlip:tile?.vFlip === true
    })) : [];
    const backgroundRestore = String(restore?.plane || '').toUpperCase() === 'B' && restoreTiles.length
      ? Object.freeze({ tiles:Object.freeze(restoreTiles) }) : null;
    const restoreKey = restoreTiles.map(tile => `${tile.offset.join(',')}:${tile.globalTile}:${tile.paletteLine}:${tile.hFlip?1:0}:${tile.vFlip?1:0}`).join(';');
    const key = `${bounds.join(':')}:${planes.join('')}:${restoreKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(Object.freeze({ x:bounds[0], y:bounds[1], width:bounds[2], height:bounds[3],
      planes:Object.freeze(planes), backgroundRestore, trapId:trap.id }));
  }
  return out;
}

export function descriptorStaticSceneryVisuals(registry, submap, mapId) {
  return reviewedRdxTraps(registry, submap, mapId).flatMap(trap => {
    if (trap.state !== 'static') return [];
    const visual = trap.visuals?.static || null;
    const asset = visual?.asset || null;
    if (visual?.visible !== true || asset?.kind !== 'tile-pair') return [];
    const position = Array.isArray(visual.position) ? visual.position.map(Number) : [];
    const contact = Array.isArray(trap.contact?.bounds) ? trap.contact.bounds.map(Number) : [];
    if (position.length !== 2 || contact.length !== 4) return [];
    return [Object.freeze({ trap, visual, asset, position:Object.freeze(position), contact:Object.freeze(contact) })];
  });
}

export function classicTerrainHazardRects(room, registry) {
  if (!room) return [];
  const excluded = new Set((registry?.classic?.excludedTiles || []).map(row => `${Number(row.bank)}:${Number(row.tile)}`));
  const width = Number(room.widthTiles), height = Number(room.heightTiles);
  const lethal = (x, y) => {
    const index = y * width + x;
    const tile = Number(room.tiles[index]);
    return !!(Number(room.flags[index] || 0) & 0x04) && !excluded.has(`${Number(room.bank)}:${tile}`);
  };
  const seen = new Set(), groups = [];
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const key = `${x}:${y}`;
    if (seen.has(key) || !lethal(x, y)) continue;
    const stack = [[x, y]], cells = []; seen.add(key);
    while (stack.length) {
      const [cx, cy] = stack.pop(); cells.push([cx, cy]);
      for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]]) {
        const nk = `${nx}:${ny}`;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || seen.has(nk) || !lethal(nx, ny)) continue;
        seen.add(nk); stack.push([nx, ny]);
      }
    }
    const xs = cells.map(cell => cell[0]), ys = cells.map(cell => cell[1]);
    const minX = Math.min(...xs), minY = Math.min(...ys), maxX = Math.max(...xs), maxY = Math.max(...ys);
    groups.push(Object.freeze({
      bounds: Object.freeze({ x: minX * 8, y: minY * 8, width: (maxX - minX + 1) * 8, height: (maxY - minY + 1) * 8 }),
      tiles: Object.freeze([...new Set(cells.map(([cx, cy]) => Number(room.tiles[cy * width + cx])))].sort((a, b) => a - b)),
      cells: Object.freeze(cells.map(cell => Object.freeze(cell)))
    }));
  }
  return Object.freeze(groups);
}

export function staticLayers(phase = 0) {
  if (!this.selection) throw new Error('PreviewRenderer.select() must be called first');
  const { submap, mapId, visualSource } = this.selection;
  if (visualSource === 'classic') return this._classicPlane(submap);
  const phaseCount = Math.max(1, this.mapDecoder.phaseCount(mapId));
  const normalized = ((Number(phase) % phaseCount) + phaseCount) % phaseCount;
  const palette = this.paletteRegistry.forMap(mapId).rgba;
  const lifecycleSuppressions = this.systemModificationsEnabled
    ? statefulEmbeddedMapArtSuppressions(this.trapRegistry, submap, mapId, this.nativeRuntimeStates) : [];
  const lifecycleKey = lifecycleSuppressions.map(row => `${row.trapId}:${row.sourceMark}`).join(',');
  const depthDrafts = this.presentationDepthOverrides.filter(row => Number(row.submap) === Number(submap) && Number(row.mapId) === Number(mapId));
  const depthClassEdits = this.presentationDepthClassEdits || [];
  const depthKey = `${depthClassEdits.map(row=>`${row.id}:${row.plane}:${row.globalTile}:${row.action}:${row.band||''}`).join(';')}|${depthDrafts.map(row => `${row.id}:${row.plane}:${row.band}:${row.bounds.join(',')}`).join(';')}`;
  const topology = this.selection.topology || null;
  const topologyKey = topology ? `${topology.id}:${topology.effectiveVisualSize?.join('x') || ''}` : 'raw';
  const key = `rdx:${mapId}:${normalized}:${this.paletteRegistry.forMap(mapId).palette}:topology:${topologyKey}:state:${lifecycleKey}:depth:${depthKey}`;
  if (this.staticCache.has(key)) return this.staticCache.get(key);
  const dimensions = this.selection.dimensions;
  const viewport = { x: 0, y: 0, width: dimensions.width, height: dimensions.height };
  const background = this.mapDecoder.renderPlane(mapId, palette, { plane: 'B', phase: normalized, viewport, topology });
  const foreground = this.mapDecoder.renderPlane(mapId, palette, { plane: 'A', phase: normalized, viewport, topology });
  const backgroundPixels = background.pixels || background;
  const foregroundPixels = foreground.pixels || foreground;
  /* Map Editor visual replacements deliberately source the raw decoded ROM
   * piece, then override the final reviewed production picture at the target.
   * Native local playtest uses the same order. This keeps every final tile
   * editable, including targets normally suppressed/relocated by a reviewed
   * production patch, without chained editor edits becoming implicit sources. */
  const rawDimensions = this.mapDecoder.dimensions(mapId);
  const rawViewport = { x:0, y:0, width:rawDimensions.width, height:rawDimensions.height };
  const editorSourceBackground = this.mapDecoder.renderPlane(mapId, palette, { plane:'B', phase:normalized, viewport:rawViewport }).pixels;
  const editorSourceForeground = this.mapDecoder.renderPlane(mapId, palette, { plane:'A', phase:normalized, viewport:rawViewport }).pixels;
  const editorSourceCache = new Map([
    [`${mapId}:B`, editorSourceBackground], [`${mapId}:A`, editorSourceForeground]
  ]);
  const editorSourceFor = (sourceMapId, sourceLayer) => {
    const sourceId = Number(sourceMapId);
    const sourcePlane = sourceLayer === 'B' ? 'B' : 'A';
    const cacheKey = `${sourceId}:${sourcePlane}`;
    if (editorSourceCache.has(cacheKey)) return editorSourceCache.get(cacheKey);
    const sourceDimensions = this.mapDecoder.dimensions(sourceId);
    const sourceViewport = { x:0, y:0, width:sourceDimensions.width, height:sourceDimensions.height };
    /* Match native v2.1.73 Level Editor semantics: decode the source map's
     * tile/pattern topology, but display it through the destination room's
     * palette. Cross-map assets therefore look exactly the same in Preview
     * and the authoritative native playtest. */
    const sourceRender = this.mapDecoder.renderPlane(sourceId, palette, { plane:sourcePlane, phase:normalized, viewport:sourceViewport });
    const pixels = sourceRender.pixels || sourceRender;
    editorSourceCache.set(cacheKey, pixels);
    return pixels;
  };
  if (this.systemModificationsEnabled) {
  /* Reusable descriptor scenery detaches only the map planes that actually
   * contain its embedded source representation. Some RDX cells bake a trap
   * underlay into Plane B, so removing that underlay must restore reviewed
   * clean background pixels rather than leaving a palette-zero hole. */
  for (const detachment of descriptorSourceDetachmentRects(this.trapRegistry, submap, mapId)) {
    const local = { x:detachment.x - viewport.x, y:detachment.y - viewport.y, width:detachment.width, height:detachment.height };
    if (detachment.planes.includes('B')) fillRectColor(backgroundPixels, local, palette[0] || [0,0,0,255]);
    if (detachment.planes.includes('A')) clearRect(foregroundPixels, local);
    if (detachment.planes.includes('B')) for (const tile of detachment.backgroundRestore?.tiles || []) {
      const resolved = this.mapDecoder.resolveGlobalTile(tile.globalTile);
      if (!resolved?.tileBytes || tile.offset.length !== 2) continue;
      drawMegaDriveTile(backgroundPixels, resolved.tileBytes, detachment.x + tile.offset[0], detachment.y + tile.offset[1], palette, {
        paletteLine:tile.paletteLine, hFlip:tile.hFlip, vFlip:tile.vFlip, transparentZero:false
      });
    }
  }
  for (const patch of this.reviewedMapVisualPatches) {
    if (Number(patch.mapId) !== Number(mapId) || patch.action !== 'suppress') continue;
    const bounds = Array.isArray(patch.bounds) ? patch.bounds.map(Number) : null;
    if (!bounds || bounds.length < 4) continue;
    const local = { x:bounds[0] - viewport.x, y:bounds[1] - viewport.y, width:bounds[2], height:bounds[3] };
    const layers = String(patch.layer || 'A').toUpperCase();
    if (layers.includes('B')) fillRectColor(backgroundPixels, local, palette[0] || [0,0,0,255]);
    if (layers.includes('A')) clearRect(foregroundPixels, local);
  }
  const reviewedAssetCache = new Map();
  for (const patch of this.reviewedMapVisualPatches) {
    if (Number(patch.mapId) !== Number(mapId) || Number(patch.submap) !== Number(submap) || patch.action !== 'overlay-tiles') continue;
    const bounds = Array.isArray(patch.bounds) ? patch.bounds.map(Number) : null;
    const tiles = Array.isArray(patch.tiles) ? patch.tiles : [];
    if (!bounds || bounds.length < 4 || !tiles.length) continue;
    const local = { x:bounds[0] - viewport.x, y:bounds[1] - viewport.y, width:bounds[2], height:bounds[3] };
    const clearLayers = String(patch.clearLayer || '').toUpperCase();
    if (clearLayers.includes('B')) fillRectColor(backgroundPixels, local, palette[0] || [0,0,0,255]);
    if (clearLayers.includes('A')) clearRect(foregroundPixels, local);
    for (const tile of tiles) {
      const offset = Array.isArray(tile.offset) ? tile.offset.map(Number) : null;
      const tileBytes = resolvedPatchTileBytes(this, tile, reviewedAssetCache);
      if (!offset || offset.length < 2 || !tileBytes) continue;
      const plane = String(tile.plane || '').toUpperCase();
      const target = plane === 'A' ? foregroundPixels : plane === 'B' ? backgroundPixels : null;
      if (!target) continue;
      drawMegaDriveTile(target, tileBytes, bounds[0] + offset[0], bounds[1] + offset[1], palette, {
        paletteLine:Number(tile.paletteLine || 0), hFlip:!!tile.hFlip, vFlip:!!tile.vFlip, transparentZero:plane === 'A'
      });
    }
  }
  for (const patch of this.reviewedMapVisualPatches) {
    if (Number(patch.mapId) !== Number(mapId) || Number(patch.submap) !== Number(submap) || patch.action !== 'overlay-color') continue;
    const bounds = Array.isArray(patch.bounds) ? patch.bounds.map(Number) : null;
    const rgba = Array.isArray(patch.rgba) ? patch.rgba.map(Number) : null;
    const layer = String(patch.layer || '').toUpperCase();
    if (!bounds || bounds.length < 4 || !rgba || rgba.length < 4 || !['A','B'].includes(layer)) continue;
    fillRectColor(layer === 'A' ? foregroundPixels : backgroundPixels,
      {x:bounds[0], y:bounds[1], width:bounds[2], height:bounds[3]}, rgba);
  }
  for (const patch of this.reviewedMapVisualPatches) {
    if (Number(patch.mapId) !== Number(mapId) || patch.action !== 'relocate') continue;
    const source = Array.isArray(patch.sourceBounds) ? patch.sourceBounds.map(Number) : null;
    const target = Array.isArray(patch.bounds) ? patch.bounds.map(Number) : null;
    if (!source || !target || source.length < 4 || target.length < 4 || source[2] !== target[2] || source[3] !== target[3]) continue;
    const layers = String(patch.layer || 'A').toUpperCase();
    const relocate = (buffer, clearColor) => {
      const crop = buffer.crop(source[0], source[1], source[2], source[3]);
      const sourceRect={x:source[0],y:source[1],width:source[2],height:source[3]}, targetRect={x:target[0],y:target[1],width:target[2],height:target[3]};
      if (clearColor) { fillRectColor(buffer, sourceRect, clearColor); fillRectColor(buffer, targetRect, clearColor); }
      else { clearRect(buffer, sourceRect); clearRect(buffer, targetRect); }
      buffer.blit(crop, target[0], target[1], { useAlpha:true });
    };
    if (layers.includes('B')) relocate(backgroundPixels, palette[0] || [0,0,0,255]);
    if (layers.includes('A')) relocate(foregroundPixels, null);
  }
  for (const patch of this.reviewedMapVisualPatches) {
    if (Number(patch.mapId) !== Number(mapId) || patch.action !== 'copy') continue;
    const source=Array.isArray(patch.sourceBounds)?patch.sourceBounds.map(Number):null;
    const target=Array.isArray(patch.bounds)?patch.bounds.map(Number):null;
    if (!source||!target||source.length<4||target.length<4||source[2]!==target[2]||source[3]!==target[3]) continue;
    const layers=String(patch.layer||'A').toUpperCase();
    const copy=(buffer,clearColor)=>{ const crop=buffer.crop(source[0],source[1],source[2],source[3]); const tr={x:target[0],y:target[1],width:target[2],height:target[3]}; if(clearColor) fillRectColor(buffer,tr,clearColor); else clearRect(buffer,tr); buffer.blit(crop,target[0],target[1],{useAlpha:true}); };
    if(layers.includes('B')) copy(backgroundPixels,palette[0]||[0,0,0,255]);
    if(layers.includes('A')) copy(foregroundPixels,null);
  }
  /* Draft map edits are applied after production state. Hide the complete
   * descriptor-owned embedded source rectangle when its native mechanism has
   * deactivated; this mirrors the generated C map-visual suppression and
   * avoids leaving only the actor-covered subset retracted in the editor. */
  for (const suppression of lifecycleSuppressions) {
    const local = { x:suppression.x - viewport.x, y:suppression.y - viewport.y,
      width:suppression.width, height:suppression.height };
    if (suppression.plane === 'B') fillRectColor(backgroundPixels, local, palette[0] || [0,0,0,255]);
    if (suppression.plane === 'A') clearRect(foregroundPixels, local);
  }
  }
  for (const edit of this.mapCellOverrides) {
    if (Number(edit.mapId) !== Number(mapId) || Number(edit.submap) !== Number(submap)) continue;
    const [targetGx, targetGy] = edit.target || [];
    const [sourceGx, sourceGy] = edit.source || [];
    if (![targetGx,targetGy].every(Number.isFinite)) continue;
    const target = { x:Math.round(targetGx)*8, y:Math.round(targetGy)*8, width:8, height:8 };
    const layers = String(edit.layer || 'A').toUpperCase();
    const operation = edit.operation === 'clear' ? 'clear' : 'copy';
    const copyCell = (targetBuffer, clearColor, targetLayer) => {
      if (clearColor) fillRectColor(targetBuffer, target, clearColor); else clearRect(targetBuffer, target);
      if (operation === 'clear' || ![sourceGx,sourceGy].every(Number.isFinite)) return;
      const sourceLayer = edit.sourceLayer || targetLayer;
      const sourceBuffer = editorSourceFor(edit.sourceMapId ?? mapId, sourceLayer);
      const crop = sourceBuffer.crop(Math.round(sourceGx)*8, Math.round(sourceGy)*8, 8, 8);
      targetBuffer.blit(crop, target.x, target.y, { useAlpha:true, mirrorX:!!edit.mirrorX });
    };
    if (layers.includes('B')) copyCell(backgroundPixels, palette[0] || [0,0,0,255], 'B');
    if (layers.includes('A')) copyCell(foregroundPixels, null, 'A');
  }
  const productionRoom = this._productionRoom?.() || null;
  const baseDepth = productionRoom?.presentationDepth || Object.freeze({
    planeDefaults:Object.freeze({ A:'foreground', B:'midground' }), classes:Object.freeze([]), overrides:Object.freeze([])
  });
  const sameRegion = (a, b) => a?.plane === b?.plane && Array.isArray(a?.bounds) && Array.isArray(b?.bounds) &&
    a.bounds.length === 4 && b.bounds.length === 4 && a.bounds.every((value, index) => Number(value) === Number(b.bounds[index]));
  const reviewedOverrides = (baseDepth.overrides || []).filter(row => !depthDrafts.some(draft => sameRegion(row, draft)));
  const effectiveClasses = applyPresentationDepthClassEdits(baseDepth.classes || [], depthClassEdits);
  const effectiveDepth = Object.freeze({ ...baseDepth, classes:effectiveClasses, overrides:Object.freeze([...reviewedOverrides, ...depthDrafts]) });
  const splitB = splitPlaneByPresentationDepth({ source:backgroundPixels, model:effectiveDepth, mapDecoder:this.mapDecoder,
    mapId, plane:'B', phase:normalized, topology, viewport, cropToVisibleSource:true });
  const splitA = splitPlaneByPresentationDepth({ source:foregroundPixels, model:effectiveDepth, mapDecoder:this.mapDecoder,
    mapId, plane:'A', phase:normalized, topology, viewport });
  const composedDepth = composePresentationDepthPlanes(splitB, splitA);
  const result = Object.freeze({
    backdrop: composedDepth.backdrop,
    midground: composedDepth.midground,
    foreground: composedDepth.foreground,
    sourcePlaneB: backgroundPixels,
    sourcePlaneA: foregroundPixels,
    /* Legacy PreviewRenderer consumers treat background as the complete source Plane B.
     * New presentation-aware surfaces consume backdrop/midground explicitly. */
    background: backgroundPixels,
    foregroundBehindActors: composedDepth.midground,
    presentationDepth: effectiveDepth,
    metrics: { visualSource: 'rdx', background: background.metrics, foreground: foreground.metrics, phase: normalized }
  });
  this.staticCache.set(key, result);
  return result;
}
