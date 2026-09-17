import { readBe16 } from './binary.js';
import { RdxError } from './errors.js';
import { PixelBuffer, drawMegaDriveTile } from '../render/pixel-buffer.js';
import { effectiveMapDimensions, topologySourceY, topologyTargetYs } from './map-topology.js';

const QUADRANT_NAMES = Object.freeze(['top-left', 'top-right', 'bottom-left', 'bottom-right']);

function assetPayloadSource(rom, tag, id, payloadIndex = null) {
  const asset = rom.getAsset?.(tag, id) || null;
  if (!asset) return null;
  const index = payloadIndex == null ? null : Number(payloadIndex);
  return Object.freeze({
    tag, id:Number(id), name:asset.name || `${tag}${Number(id).toString(16).padStart(4, '0')}`,
    ordinal:Number(asset.ordinal), flags:Number(asset.flags), romOffset:Number(asset.offset),
    storedLength:Number(asset.storedLength), decodedLength:Number(asset.decodedLength), payloadIndex:index,
    absoluteRomOffset:index != null && Number(asset.flags) === 0 ? Number(asset.offset) + index : null
  });
}

function resolvedPatternMetadata(resolved) {
  if (!resolved) return null;
  const { tileBytes, ...metadata } = resolved;
  return Object.freeze({ ...metadata });
}

export class RdxMapDecoder {
  constructor(rom) {
    this.rom = rom;
    this.ppCache = new Map();
    this.miCache = new Map();
  }

  ppList(id) {
    if (this.ppCache.has(id)) return this.ppCache.get(id);
    const data = this.rom.payload('PP', id);
    const count = data.length % 3 === 1 ? (data.length - 1) / 3 : Math.floor(data.length / 3);
    const list = [];
    for (let i = 0; i < count; i += 1) list.push(readBe16(data, i * 3 + 1));
    this.ppCache.set(id, list);
    return list;
  }

  dimensions(mapId) {
    const md = this.rom.payload('MD', mapId);
    const mh = this.rom.payload('MH', mapId);
    const cells = Math.floor(md.length / 2);
    if (mh.length >= 0x308) {
      const cellWidth = readBe16(mh, 0x304);
      const cellHeight = readBe16(mh, 0x306);
      if (cellWidth > 0 && cellHeight > 0 && cellWidth * cellHeight === cells) {
        return { cellWidth, cellHeight, width: cellWidth * 16, height: cellHeight * 16, source: 'MH+0x304/+0x306' };
      }
    }
    if (mh.length >= 0x322) {
      const pixelWidth = readBe16(mh, 0x320) || 320;
      const cellWidth = Math.max(1, Math.floor(pixelWidth / 16));
      const cellHeight = Math.ceil(cells / cellWidth);
      return { cellWidth, cellHeight, width: cellWidth * 16, height: cellHeight * 16, source: 'MH+0x320 fallback' };
    }
    const cellWidth = 20;
    const cellHeight = Math.ceil(cells / cellWidth);
    return { cellWidth, cellHeight, width: 320, height: cellHeight * 16, source: '20-cell fallback' };
  }

  inlinePatternCount(mapId) {
    const mh = this.rom.payload('MH', mapId);
    return mh.length >= 0x33c ? readBe16(mh, 0x33a) : 0;
  }

  miRecordCount(mapId) {
    const mh = this.rom.payload('MH', mapId);
    return mh.length >= 0x326 ? readBe16(mh, 0x324) : 0;
  }

  parseMiAnimations(mapId) {
    if (this.miCache.has(mapId)) return this.miCache.get(mapId);
    const asset = this.rom.getAsset('MI', mapId);
    if (!asset) {
      this.miCache.set(mapId, []);
      return [];
    }
    const data = this.rom.payload('MI', mapId);
    const count = this.miRecordCount(mapId);
    const records = [];
    let pointer = 0;
    for (let recordIndex = 0; recordIndex < count; recordIndex += 1) {
      if (pointer + 4 > data.length) break;
      const target = readBe16(data, pointer);
      const auxWords = readBe16(data, pointer + 2);
      let framePointer = pointer + 4 + auxWords * 2;
      const frames = [];
      let guard = 0;
      while (framePointer + 0x84 <= data.length && guard < 4096) {
        const delay = readBe16(data, framePointer);
        const flags = readBe16(data, framePointer + 2);
        frames.push({
          offset: framePointer,
          delay,
          flags,
          last: !!(flags & 0x00ff),
          data: data.slice(framePointer + 4, framePointer + 0x84)
        });
        framePointer += 0x84;
        guard += 1;
        if (flags & 0x00ff) break;
      }
      records.push({ recordIndex, offset: pointer, target, auxWords, frames });
      pointer = framePointer;
    }
    this.miCache.set(mapId, records);
    return records;
  }

  phaseCount(mapId) {
    return this.parseMiAnimations(mapId).reduce((max, record) => Math.max(max, record.frames.length), 0);
  }

  resolveMiAnimationTile(mapId, rawIndex, phase = 0) {
    for (const record of this.parseMiAnimations(mapId)) {
      if (rawIndex < record.target || rawIndex >= record.target + 4 || record.frames.length === 0) continue;
      const frameIndex = ((phase % record.frames.length) + record.frames.length) % record.frames.length;
      const offset = (rawIndex - record.target) * 32;
      return {
        tileBytes: record.frames[frameIndex].data.slice(offset, offset + 32),
        kind: 'mi-animation',
        recordIndex: record.recordIndex,
        frameIndex
      };
    }
    return null;
  }

  resolvePattern(mapId, rawIndex, phase = 0) {
    const animated = this.resolveMiAnimationTile(mapId, rawIndex, phase);
    if (animated) return animated;
    const shared = this.ppList(0);
    const local = this.ppList(mapId);
    const inlineCount = this.inlinePatternCount(mapId);
    if (rawIndex < shared.length) return this.#globalTile(shared[rawIndex], 'pp-shared');
    if (rawIndex < shared.length + inlineCount) {
      const mi = this.rom.getAsset('MI', mapId) ? this.rom.payload('MI', mapId) : new Uint8Array();
      const localIndex = rawIndex - shared.length;
      const offset = localIndex * 32;
      if (offset + 32 <= mi.length) return { tileBytes: mi.slice(offset, offset + 32), kind: 'mi-inline', localIndex };
      return { tileBytes: null, kind: 'mi-inline-missing', localIndex };
    }
    const localIndex = rawIndex - shared.length - inlineCount;
    if (localIndex >= 0 && localIndex < local.length) return this.#globalTile(local[localIndex], 'pp-local');
    return { tileBytes: null, kind: 'unresolved', localIndex };
  }

  resolveGlobalTile(globalTile) {
    return this.#globalTile(Number(globalTile), 'pp-global');
  }

  #globalTile(globalTile, kind) {
    const graphics = this.rom.payload('PP', 0xffff);
    const offset = globalTile * 32;
    if (offset + 32 > graphics.length) return { tileBytes: null, kind: `${kind}-out-of-range`, globalTile };
    return { tileBytes: graphics.slice(offset, offset + 32), kind, globalTile };
  }

  logicDimensions(mapId) {
    const mh = this.rom.payload('MH', mapId);
    if (mh.length < 0x31c) return { width: 0, height: 0 };
    return { width: readBe16(mh, 0x318), height: readBe16(mh, 0x31a) };
  }

  /** Diagnostic-only provenance for one visible 8x8 RDX cell.
   * This follows the same MD -> bordered MT/ML -> NT -> pattern path used by
   * the production decoder, but returns metadata instead of pixels. */
  inspectGridCell(mapId, gridXValue, gridYValue, phase = 0, options = {}) {
    const gridX = Math.floor(Number(gridXValue));
    const gridY = Math.floor(Number(gridYValue));
    const rawDimensions = this.dimensions(mapId);
    const topology = options.topology || null;
    const dimensions = effectiveMapDimensions(rawDimensions, topology);
    const gridWidth = Math.floor(dimensions.width / 8);
    const gridHeight = Math.floor(dimensions.height / 8);
    if (!Number.isFinite(gridX) || !Number.isFinite(gridY) || gridX < 0 || gridY < 0 || gridX >= gridWidth || gridY >= gridHeight) return null;
    const targetPixelY = gridY * 8;
    const sourcePixelY = topologySourceY(topology, targetPixelY);
    if (sourcePixelY == null || sourcePixelY % 8) return null;
    const sourceGridY = sourcePixelY / 8;
    const visualX = Math.floor(gridX / 2);
    const visualY = Math.floor(sourceGridY / 2);
    const qx = gridX & 1, qy = gridY & 1, quadrant = qx + qy * 2;
    const cellIndex = visualY * rawDimensions.cellWidth + visualX;
    const md = this.rom.payload('MD', mapId);
    const mdPayloadIndex = cellIndex * 2;
    if (mdPayloadIndex + 2 > md.length) return null;
    const baseRecord = readBe16(md, mdPayloadIndex);

    const logic = this.logicDimensions(mapId);
    const logicX = visualX + 1, logicY = visualY + 1;
    const logicIndex = logicY * logic.width + logicX;
    const mt = this.rom.payload('MT', mapId);
    const mlAsset = this.rom.getAsset?.('ML', mapId) || null;
    const ml = mlAsset ? this.rom.payload('ML', mapId) : null;
    const descriptorInBounds = logic.width > 0 && logic.height > 0 && logicX >= 0 && logicY >= 0 && logicX < logic.width && logicY < logic.height && logicIndex < mt.length;
    const mtValue = descriptorInBounds ? Number(mt[logicIndex]) : null;
    const mlValue = descriptorInBounds && ml && logicIndex < ml.length ? Number(ml[logicIndex]) : (descriptorInBounds ? 0 : null);

    const nt = this.rom.payload('NT', 0);
    const inspectRecord = (recordIndex, allowed, reason = null) => {
      if (!allowed) return Object.freeze({ allowed:false, reason, recordIndex:Number(recordIndex), quadrant });
      const payloadIndex = Number(recordIndex) * 8 + quadrant * 2;
      if (payloadIndex < 0 || payloadIndex + 2 > nt.length) {
        return Object.freeze({ allowed:true, recordIndex:Number(recordIndex), quadrant, word:null, unresolved:true,
          asset:assetPayloadSource(this.rom, 'NT', 0, payloadIndex) });
      }
      const word = readBe16(nt, payloadIndex);
      const rawIndex = word & 0x07ff;
      const resolved = this.resolvePattern(mapId, rawIndex, phase);
      let resolution = resolvedPatternMetadata(resolved);
      let indexSource = null, graphicsSource = null, patternSource = null;
      if (resolution?.kind === 'pp-shared') {
        indexSource = assetPayloadSource(this.rom, 'PP', 0, rawIndex * 3 + 1);
        graphicsSource = assetPayloadSource(this.rom, 'PP', 0xffff, Number(resolution.globalTile) * 32);
      } else if (resolution?.kind === 'pp-local') {
        const localIndex = rawIndex - this.ppList(0).length - this.inlinePatternCount(mapId);
        resolution = Object.freeze({ ...resolution, localIndex });
        indexSource = assetPayloadSource(this.rom, 'PP', mapId, localIndex * 3 + 1);
        graphicsSource = assetPayloadSource(this.rom, 'PP', 0xffff, Number(resolution.globalTile) * 32);
      } else if (resolution?.kind === 'mi-inline' || resolution?.kind === 'mi-inline-missing') {
        patternSource = assetPayloadSource(this.rom, 'MI', mapId, Number(resolution.localIndex) * 32);
      } else if (resolution?.kind === 'mi-animation') {
        const record = this.parseMiAnimations(mapId).find(row => Number(row.recordIndex) === Number(resolution.recordIndex));
        const frame = record?.frames?.[Number(resolution.frameIndex)] || null;
        if (frame) patternSource = assetPayloadSource(this.rom, 'MI', mapId, Number(frame.offset) + 4 + (rawIndex - Number(record.target)) * 32);
      }
      return Object.freeze({
        allowed:true, recordIndex:Number(recordIndex), quadrant, word, rawIndex,
        paletteLine:(word >> 13) & 3, hFlip:!!(word & 0x0800), vFlip:!!(word & 0x1000),
        transparent:word === 0, asset:assetPayloadSource(this.rom, 'NT', 0, payloadIndex),
        resolution, indexSource, patternSource, graphicsSource
      });
    };

    const overlay = this.overlayAllowed(mapId, cellIndex, rawDimensions.cellWidth);
    return Object.freeze({
      mapId:Number(mapId), phase:Number(phase),
      coordinate:Object.freeze({
        grid8:Object.freeze({ x:gridX, y:gridY, size:8 }),
        pixelCenter:Object.freeze({ x:gridX * 8 + 4, y:gridY * 8 + 4 }),
        sourceGrid8:Object.freeze({ x:gridX, y:sourceGridY, size:8 }),
        visual16:Object.freeze({ x:visualX, y:visualY, index:cellIndex, width:rawDimensions.cellWidth, height:rawDimensions.cellHeight }),
        quadrant:Object.freeze({ x:qx, y:qy, index:quadrant, label:QUADRANT_NAMES[quadrant] }),
        romLogic:Object.freeze({ x:logicX, y:logicY, index:logicIndex, width:logic.width, height:logic.height, borderOffset:Object.freeze({ x:1, y:1 }) })
      }),
      descriptor:Object.freeze({
        mt:mtValue, ml:mlValue,
        mtSource:assetPayloadSource(this.rom, 'MT', mapId, descriptorInBounds ? logicIndex : null),
        mlSource:assetPayloadSource(this.rom, 'ML', mapId, descriptorInBounds && mlAsset ? logicIndex : null)
      }),
      visual:Object.freeze({
        phase:Number(phase), cellIndex, baseRecord, overlayAllowed:!!overlay.allowed, overlayRuleProven:!!overlay.proven,
        mdSource:assetPayloadSource(this.rom, 'MD', mapId, mdPayloadIndex),
        background:inspectRecord(baseRecord, true),
        foreground:inspectRecord(baseRecord + 1, !!overlay.allowed, overlay.allowed ? null : 'MT overlay bit 0x20 is clear')
      })
    });
  }

  overlayAllowed(mapId, cellIndex, cellWidth) {
    const mtAsset = this.rom.getAsset('MT', mapId);
    if (!mtAsset) return { allowed: true, proven: false };
    const mt = this.rom.payload('MT', mapId);
    const logic = this.logicDimensions(mapId);
    if (logic.width <= 0 || logic.height <= 0 || logic.width * logic.height !== mt.length) return { allowed: true, proven: false };
    const x = cellIndex % cellWidth;
    const y = Math.floor(cellIndex / cellWidth);
    const logicX = x + 1;
    const logicY = y + 1;
    if (logicX < 0 || logicY < 0 || logicX >= logic.width || logicY >= logic.height) return { allowed: false, proven: true };
    return { allowed: !!(mt[logicY * logic.width + logicX] & 0x20), proven: true };
  }

  geometryMask(mapId, viewport, options = {}) {
    const width = Math.ceil(viewport.width / 8);
    const height = Math.ceil(viewport.height / 8);
    const data = new Uint8Array(width * height);
    const mtAsset = this.rom.getAsset('MT', mapId);
    const mlAsset = this.rom.getAsset('ML', mapId);
    if (!mtAsset || !mlAsset) return { width, height, data, proven: false };
    const mt = this.rom.payload('MT', mapId);
    const ml = this.rom.payload('ML', mapId);
    const logic = this.logicDimensions(mapId);
    if (logic.width <= 0 || logic.height <= 0 || logic.width * logic.height !== mt.length || ml.length !== mt.length) {
      return { width, height, data, proven: false };
    }
    for (let tileY = 0; tileY < height; tileY += 1) {
      for (let tileX = 0; tileX < width; tileX += 1) {
        const mapPixelX = viewport.x + tileX * 8 + 4;
        const mapPixelY = viewport.y + tileY * 8 + 4;
        const sourcePixelY = topologySourceY(options.topology || null, mapPixelY);
        if (sourcePixelY == null) continue;
        const cellX = Math.floor(mapPixelX / 16), cellY = Math.floor(sourcePixelY / 16);
        const logicX = cellX + 1, logicY = cellY + 1;
        if (logicX < 0 || logicY < 0 || logicX >= logic.width || logicY >= logic.height) continue;
        const index = logicY * logic.width + logicX, m = mt[index], l = ml[index];
        let kind = 0;
        if ((m & 0x80) && (l === 0x07 || l === 0x1c || l === 0x1d)) kind = 4; // lethal
        else if ((m & 0x80) && (l === 0x12 || l === 0x13)) kind = 3; // ladder / climb-through
        else if ((m & 0x80) ? l === 0x11 : ((m & 0x03) === 1)) kind = 1; // full solid
        else if ((m & 0x80) ? l === 0x13 : ((m & 0x03) === 3)) kind = 2; // one-way support
        data[tileY * width + tileX] = kind;
      }
    }
    return { width, height, data, proven: true };
  }

  solidMask(mapId, viewport, options = {}) {
    const width = Math.ceil(viewport.width / 8);
    const height = Math.ceil(viewport.height / 8);
    const data = new Uint8Array(width * height);
    const mtAsset = this.rom.getAsset('MT', mapId);
    if (!mtAsset) return { width, height, data, proven: false };
    const mt = this.rom.payload('MT', mapId);
    const logic = this.logicDimensions(mapId);
    if (logic.width <= 0 || logic.height <= 0 || logic.width * logic.height !== mt.length) {
      return { width, height, data, proven: false };
    }

    for (let tileY = 0; tileY < height; tileY += 1) {
      for (let tileX = 0; tileX < width; tileX += 1) {
        const mapPixelX = viewport.x + tileX * 8 + 4;
        const mapPixelY = viewport.y + tileY * 8 + 4;
        const sourcePixelY = topologySourceY(options.topology || null, mapPixelY);
        if (sourcePixelY == null) continue;
        const cellX = Math.floor(mapPixelX / 16);
        const cellY = Math.floor(sourcePixelY / 16);
        const logicX = cellX + 1;
        const logicY = cellY + 1;
        if (logicX < 0 || logicY < 0 || logicX >= logic.width || logicY >= logic.height) continue;
        data[tileY * width + tileX] = mt[logicY * logic.width + logicX] & 0x01 ? 1 : 0;
      }
    }
    return { width, height, data, proven: true };
  }

  renderPlane(mapId, palette, options = {}) {
    const plane = options.plane || 'B';
    if (plane !== 'A' && plane !== 'B') throw new RdxError('PLANE', `Unknown map plane ${plane}`);
    const phase = options.phase ?? 0;
    const rawDimensions = this.dimensions(mapId);
    const topology = options.topology || null;
    const dimensions = effectiveMapDimensions(rawDimensions, topology);
    const viewport = options.viewport || { x: 0, y: 0, width: dimensions.width, height: dimensions.height };
    const background = plane === 'B' ? (palette[0] || [0, 0, 0, 255]) : [0, 0, 0, 0];
    const output = new PixelBuffer(viewport.width, viewport.height, background);
    const md = this.rom.payload('MD', mapId);
    const nt = this.rom.payload('NT', 0);
    const metrics = {
      mapId, plane, phase, ...dimensions,
      viewport: { ...viewport }, cells: md.length / 2,
      tilesDrawn: 0, unresolved: 0, miAnimated: 0, miInline: 0,
      overlayCells: 0, overlayRuleProven: true
    };

    const drawRecord = (recordIndex, cellIndex, transparent) => {
      const recordOffset = recordIndex * 8;
      if (recordOffset + 8 > nt.length) {
        metrics.unresolved += 4;
        return;
      }
      const cellX = (cellIndex % rawDimensions.cellWidth) * 16;
      const sourceCellY = Math.floor(cellIndex / rawDimensions.cellWidth) * 16;
      const targetCellYs = topologyTargetYs(topology, sourceCellY);
      for (const cellY of targetCellYs) for (let quadrant = 0; quadrant < 4; quadrant += 1) {
        const word = readBe16(nt, recordOffset + quadrant * 2);
        if (transparent && word === 0) continue;
        const resolved = this.resolvePattern(mapId, word & 0x07ff, phase);
        if (!resolved.tileBytes) {
          metrics.unresolved += 1;
          continue;
        }
        if (resolved.kind === 'mi-animation') metrics.miAnimated += 1;
        if (resolved.kind === 'mi-inline') metrics.miInline += 1;
        const x = cellX + (quadrant & 1 ? 8 : 0) - viewport.x;
        const y = cellY + (quadrant & 2 ? 8 : 0) - viewport.y;
        if (x <= -8 || y <= -8 || x >= viewport.width || y >= viewport.height) continue;
        drawMegaDriveTile(output, resolved.tileBytes, x, y, palette, {
          paletteLine: (word >> 13) & 3,
          hFlip: !!(word & 0x0800),
          vFlip: !!(word & 0x1000),
          transparentZero: transparent
        });
        metrics.tilesDrawn += 1;
      }
    };

    const cellCount = Math.floor(md.length / 2);
    for (let cell = 0; cell < cellCount; cell += 1) {
      const base = readBe16(md, cell * 2);
      if (plane === 'B') drawRecord(base, cell, false);
      else {
        const rule = this.overlayAllowed(mapId, cell, rawDimensions.cellWidth);
        metrics.overlayRuleProven &&= rule.proven;
        if (rule.allowed) {
          metrics.overlayCells += 1;
          drawRecord(base + 1, cell, true);
        }
      }
    }
    return { pixels: output, metrics };
  }

  renderComposite(mapId, palette, options = {}) {
    const back = this.renderPlane(mapId, palette, { ...options, plane: 'B' });
    const front = this.renderPlane(mapId, palette, { ...options, plane: 'A' });
    back.pixels.blit(front.pixels, 0, 0);
    return {
      pixels: back.pixels,
      metrics: { background: back.metrics, foreground: front.metrics }
    };
  }
}
