import { readBe16, readBe32, signed16 } from './binary.js';
import { RdxError } from './errors.js';
import { PixelBuffer, drawMegaDriveTile } from '../render/pixel-buffer.js';

const PN_RECORD_SIZE = 16;
const PF_RECORD_SIZE = 16;
const PI_BASE_SIZE = 24;
const PI_EXTRA_SIZE = 14;
const PA_RECORD_SIZE = 0xb4;
const MA_RECORD_SIZE = 0x1c;

const RICK_ALIGNMENT_OVERRIDES = Object.freeze(new Map([
  ['91:0:1', Object.freeze({ footAnchorX: 13, footAnchorY: 22 })],
  ['92:0:1', Object.freeze({ footAnchorX: 17, footAnchorY: 22 })],
  ['93:0:0', Object.freeze({ footAnchorX: 12, footAnchorY: 24 })],
  ['93:1:0', Object.freeze({ footAnchorX: 13, footAnchorY: 24 })],
  ['94:0:1', Object.freeze({ footAnchorX: 15, footAnchorY: 18 })],
  ['94:1:1', Object.freeze({ footAnchorX: 16, footAnchorY: 18 })],
  ['95:0:1', Object.freeze({ footAnchorX: 15, footAnchorY: 18 })],
  ['95:1:1', Object.freeze({ footAnchorX: 22, footAnchorY: 18 })],
  ['96:0:0', Object.freeze({ footAnchorX: 16, footAnchorY: 25 })],
  ['96:1:0', Object.freeze({ footAnchorX: 23, footAnchorY: 25 })],
  ['96:2:0', Object.freeze({ footAnchorX: 21, footAnchorY: 26 })],
  ['96:3:0', Object.freeze({ footAnchorX: 19, footAnchorY: 28 })],
  ['97:0:1', Object.freeze({ footAnchorX: 14, footAnchorY: 24 })],
  ['98:0:1', Object.freeze({ footAnchorX: 16, footAnchorY: 24 })],
  ['99:0:1', Object.freeze({ footAnchorX: 13, footAnchorY: 23 })],
  ['99:1:1', Object.freeze({ footAnchorX: 13, footAnchorY: 23 })],
  ['100:0:1', Object.freeze({ footAnchorX: 17, footAnchorY: 23 })],
  ['100:1:1', Object.freeze({ footAnchorX: 17, footAnchorY: 23 })],
  ['107:0:1', Object.freeze({ footAnchorX: 13, footAnchorY: 23 })],
  ['107:1:1', Object.freeze({ footAnchorX: 13, footAnchorY: 24 })],
  ['107:2:1', Object.freeze({ footAnchorX: 14, footAnchorY: 24 })],
  ['107:3:1', Object.freeze({ footAnchorX: 13, footAnchorY: 23 })],
  ['107:4:1', Object.freeze({ footAnchorX: 13, footAnchorY: 24 })],
  ['107:5:1', Object.freeze({ footAnchorX: 13, footAnchorY: 23 })],
  ['108:0:1', Object.freeze({ footAnchorX: 17, footAnchorY: 23 })],
  ['108:1:1', Object.freeze({ footAnchorX: 17, footAnchorY: 24 })],
  ['108:2:1', Object.freeze({ footAnchorX: 16, footAnchorY: 24 })],
  ['108:3:1', Object.freeze({ footAnchorX: 17, footAnchorY: 23 })],
  ['108:4:1', Object.freeze({ footAnchorX: 17, footAnchorY: 24 })],
  ['108:5:1', Object.freeze({ footAnchorX: 17, footAnchorY: 23 })]
]));

const RDX_ENEMY_FAMILY_BY_PN = Object.freeze(new Map([
  [3,1], [4,1], [5,1],
  [6,2], [7,2], [8,2],
  [15,3], [16,3],
  [9,4], [38,4], [39,4],
  [10,5], [44,5], [45,5],
  [31,6], [32,6], [33,6],
  [55,7], [56,7], [57,7],
  [58,8], [59,8], [60,8],
  [64,9], [65,9],
  [111,10], [112,10], [113,10]
]));

export function rdxEnemyAnimationFamily(pn) {
  return RDX_ENEMY_FAMILY_BY_PN.get(Number(pn)) || 0;
}

const CLASSIC_TYPE2_CLIMB = Object.freeze(new Map([
  [0x06, Object.freeze({ liveBase:0x37, sourceBase:0x3f })],
  [0x09, Object.freeze({ liveBase:0x3f, sourceBase:0x3f })],
  [0x0c, Object.freeze({ liveBase:0x49, sourceBase:0x49 })],
  [0x0f, Object.freeze({ liveBase:0x53, sourceBase:0x53 })]
]));

// Directional PN pairs share one back-facing synthesized ladder style. Jungle
// PN4 and the one-off missile mechanic PN59 keep their regular presentation.
const RDX_ENEMY_CLIMB_STYLE_BY_PN = Object.freeze(new Map([
  [38,38], [39,38],
  [56,56], [57,56],
  [112,112], [113,112]
]));

export function rdxEnemyClimbStylePn(pn) {
  return RDX_ENEMY_CLIMB_STYLE_BY_PN.get(Number(pn)) ?? null;
}

const RDX_ENEMY_CLIMB_COLORS = Object.freeze(new Map([
  [38, Object.freeze({
    1:[0x49,0x00,0x00,0xff], 2:[0x49,0x00,0x00,0xff], 4:[0x00,0x00,0x00,0xff],
    9:[0x49,0x00,0x00,0xff], 10:[0xb6,0x49,0x00,0xff], 11:[0xff,0xb6,0x24,0xff],
    12:[0x00,0x00,0x00,0xff], 13:[0xdb,0x6d,0x00,0xff],
    14:[0xff,0xff,0xff,0xff], 15:[0xff,0xff,0xff,0xff]
  })],
  [56, Object.freeze({
    4:[0x00,0x00,0x00,0xff], 7:[0x00,0x49,0x00,0xff], 8:[0x00,0x49,0x00,0xff],
    12:[0x49,0x49,0x49,0xff], 13:[0x49,0x49,0x49,0xff],
    14:[0xdb,0xdb,0xdb,0xff], 15:[0xdb,0xdb,0xdb,0xff]
  })],
  [112, Object.freeze({
    4:[0x00,0x00,0x00,0xff], 7:[0x00,0x49,0x00,0xff], 8:[0x00,0x49,0x00,0xff],
    12:[0x49,0x49,0x49,0xff], 13:[0x49,0x49,0x49,0xff],
    14:[0xb6,0xb6,0xb6,0xff], 15:[0xdb,0xdb,0xdb,0xff]
  })]
]));

function rdxEnemyClimbColor(pn, classicIndex, y, colors) {
  if (Number(pn) === 38 && y >= 2 && y <= 6) {
    if (classicIndex === 0x0c) return [0x49,0x6d,0xff,0xff];
    if (classicIndex === 0x0d) return [0x92,0xdb,0xff,0xff];
  }
  return colors[classicIndex] || null;
}

function rdxEnemyClimbKeepsPixel(pn, phase, x, y) {
  if (Number(pn) !== 56 && Number(pn) !== 112) return true;
  const center = Number(phase) ? 11 : 12;
  const dx = Math.abs(Number(x) - center);
  if (y === 0) return dx <= 3;
  if (y === 1) return dx <= 5;
  if (y === 2) return dx <= 6;
  return true;
}

export function rdxEnemyClimbFrame(spriteDecoder, classicData, pn, classicEntity, classicSprite, palette, classicState = null) {
  const type = CLASSIC_TYPE2_CLIMB.get(Number(classicEntity) & 0x7f);
  const stylePn = rdxEnemyClimbStylePn(pn);
  const colors = RDX_ENEMY_CLIMB_COLORS.get(stylePn);
  const liveSprite = Number(classicSprite);
  const stateC1 = Number(classicState?.c1);
  const hasSemanticState = classicState != null && Number.isFinite(stateC1);
  if (!type || stylePn == null || !colors) return null;
  if (hasSemanticState && stateC1 === 0) return null;
  let phase = liveSprite - type.liveBase;
  if (phase !== 0 && phase !== 1) {
    const x = Number(classicState?.x), y = Number(classicState?.y);
    if (!hasSemanticState || stateC1 === 0 || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    phase = ((Math.trunc(x) ^ Math.trunc(y)) & 0x04) ? 1 : 0;
  }
  const source = classicData?.sprites?.[type.sourceBase + phase];
  if (!source) return null;
  const animation = spriteDecoder?.framesForPn?.(Number(pn), palette, { mirrorX:false, mirrorY:false });
  const base = animation?.frames?.[0];
  if (!base) return null;
  const width = Number(classicData?.spriteWidth || 32), height = Number(classicData?.spriteHeight || 21);
  if (width !== 32 || height !== 21) return null;
  const pixels = new PixelBuffer(width, height, [0,0,0,0]);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const index = Number(source[y * width + x] || 0);
    if (!index) continue;
    if (!rdxEnemyClimbKeepsPixel(stylePn, phase, x, y)) continue;
    const color = rdxEnemyClimbColor(stylePn, index, y, colors);
    if (color) pixels.setPixel(x, y, color);
  }
  return {
    ...base,
    pixels,
    bounds:pixels.opaqueBounds(),
    originX:16,
    originY:21,
    footAnchorX:16,
    footAnchorY:21,
    enemyFamily:rdxEnemyAnimationFamily(pn),
    enemyAnchorX:16,
    enemyAnchorY:21,
    mirrored:false,
    mirroredY:false,
    pn:animation.pn,
    frameIndex:phase,
    visualVariant:'enemy-climb',
    enemyClimbStylePn:stylePn
  };
}

export function rdxEnemyUsesSourceCadence(pn) {
  const family = rdxEnemyAnimationFamily(pn);
  return family !== 0 && family !== 3;
}

const RDX_ENEMY_SPATIAL_PHASE_PNS = new Set([
  4,5,7,8,31,32,38,39,44,45,56,57,59,60,64,65,112,113
]);

export function rdxEnemyUsesSpatialPhase(pn) {
  return RDX_ENEMY_SPATIAL_PHASE_PNS.has(Number(pn));
}

export function rdxEnemySpatialPhaseTick(pn, worldX, worldY, frames) {
  if (!rdxEnemyUsesSpatialPhase(pn) || !Array.isArray(frames) || frames.length <= 1) return 0;
  const x = Number(worldX), y = Number(worldY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
  const phaseCell = Math.floor(x / 8) + Math.floor(y / 8);
  const frameIndex = ((phaseCell % frames.length) + frames.length) % frames.length;
  let tick = 0;
  for (let index = 0; index < frameIndex; index += 1) {
    const raw = Number(frames[index]?.pf?.duration ?? 1) & 0xffff;
    if (raw === 0xffff) break;
    tick += raw === 0 ? 1 : raw;
  }
  return tick;
}

export function rdxEnemyPresentationTick(pn, gameplayTick, classicSprite = null, spatialPhaseTick = 0) {
  const pnIndex = Number(pn);
  const tick = Math.max(0, Math.floor(Number(gameplayTick) || 0));
  if (rdxEnemyAnimationFamily(pnIndex) === 6) {
    const sprite = Number(classicSprite);
    if (sprite === 0x6d || sprite === 0x6e) return 0;
    if (sprite === 0x6f) return 5;
    if (sprite === 0x70) return 10;
  }
  if (pnIndex === 16 && rdxEnemyAnimationFamily(pnIndex) === 3) {
    const sprite = Number(classicSprite);
    if (sprite === 0x62) return 0;
    if (sprite === 0x63) return 5;
    return (Math.floor(tick / 2) & 1) ? 5 : 0;
  }
  if (!rdxEnemyUsesSourceCadence(pnIndex)) return tick;
  const sourceTick = Math.floor(tick * 12 / 5);
  const phaseTick = rdxEnemyUsesSpatialPhase(pnIndex)
    ? Math.max(0, Math.floor(Number(spatialPhaseTick) || 0)) : 0;
  return sourceTick + phaseTick;
}

export function rdxEnemyUsesGroundContact(pn) {
  const family = rdxEnemyAnimationFamily(pn);
  return family !== 0 && family !== 3;
}

function sizeFromWord(word) {
  return { tilesX: ((word >> 2) & 3) + 1, tilesY: (word & 3) + 1 };
}

function signed8(value) { return value & 0x80 ? value - 0x100 : value; }

function directionFromSpeed(speed) {
  const high = (speed >> 8) & 0xff;
  if (high === 0x10) return 'right';
  if (high === 0x20) return 'left';
  return 'neutral';
}

function castleDogClassicBounds(sprite) {
  switch (Number(sprite)) {
    case 0x6d: return { minX:0, minY:6, maxX:25, maxY:20 };
    case 0x6e: return { minX:0, minY:3, maxX:25, maxY:20 };
    case 0x6f: return { minX:0, minY:3, maxX:25, maxY:20 };
    case 0x70: return { minX:0, minY:2, maxX:26, maxY:20 };
    default: return null;
  }
}

export function frameIndexForTimeline(frames, loopOffset, tick) {
  if (!Array.isArray(frames) || frames.length === 0) return 0;
  let remaining = Math.max(0, Math.floor(Number(tick) || 0));
  const durations = frames.map(frame => {
    const raw = Number(frame?.pf?.duration ?? 1) & 0xffff;
    return raw === 0 ? 1 : raw;
  });
  const loop = Number.isInteger(loopOffset) && loopOffset >= 0 && loopOffset < frames.length
    ? loopOffset : null;

  const consume = (start, end) => {
    for (let index = start; index < end; index += 1) {
      const duration = durations[index];
      if (duration === 0xffff || remaining < duration) return index;
      remaining -= duration;
    }
    return null;
  };

  const introEnd = loop == null ? frames.length : loop;
  const intro = consume(0, introEnd);
  if (intro != null) return intro;
  if (loop == null) return frames.length - 1;

  const loopDuration = durations.slice(loop).reduce((sum, duration) =>
    duration === 0xffff ? Number.POSITIVE_INFINITY : sum + duration, 0);
  if (Number.isFinite(loopDuration) && loopDuration > 0) remaining %= loopDuration;
  const repeated = consume(loop, frames.length);
  return repeated == null ? frames.length - 1 : repeated;
}

export class RdxSpriteDecoder {
  constructor(rom) {
    this.rom = rom;
    this.pnCache = null;
  }

  parsePnCatalog() {
    if (this.pnCache) return this.pnCache;
    const pn = this.rom.payload('PN', 0);
    const pf = this.rom.payload('PF', 0);
    const pfAsset = this.rom.requireAsset('PF', 0);
    const rows = [];
    for (let index = 0; index < Math.floor(pn.length / PN_RECORD_SIZE); index += 1) {
      const offset = index * PN_RECORD_SIZE;
      const startPointer = readBe32(pn, offset);
      const loopPointer = readBe32(pn, offset + 8);
      const start = startPointer >= pfAsset.offset && startPointer < pfAsset.offset + pf.length && (startPointer - pfAsset.offset) % PF_RECORD_SIZE === 0
        ? (startPointer - pfAsset.offset) / PF_RECORD_SIZE : null;
      const loop = loopPointer >= pfAsset.offset && loopPointer < pfAsset.offset + pf.length && (loopPointer - pfAsset.offset) % PF_RECORD_SIZE === 0
        ? (loopPointer - pfAsset.offset) / PF_RECORD_SIZE : null;
      const flags = readBe16(pn, offset + 12);
      const speed = readBe16(pn, offset + 14);
      rows.push({ index, startPointer, loopPointer, start, loop, flags, speed, direction: directionFromSpeed(speed) });
    }
    const ordered = rows.filter(row => row.start != null).sort((a, b) => a.start - b.start);
    for (let i = 0; i < ordered.length; i += 1) {
      const row = ordered[i];
      row.end = i + 1 < ordered.length ? ordered[i + 1].start : Math.floor(pf.length / PF_RECORD_SIZE);
      row.count = row.end - row.start;
      row.loopOffset = row.loop == null ? null : row.loop - row.start;
    }
    this.pnCache = rows;
    return rows;
  }

  parsePf(index) {
    const data = this.rom.payload('PF', 0);
    const offset = index * PF_RECORD_SIZE;
    if (offset < 0 || offset + PF_RECORD_SIZE > data.length) return null;
    return {
      index,
      pointer: this.rom.requireAsset('PF', 0).offset + offset,
      piPointer: readBe32(data, offset),
      duration: readBe16(data, offset + 4),
      endFlags: readBe16(data, offset + 6)
    };
  }

  parsePi(pointer) {
    const data = this.rom.payload('PI', 0);
    const base = this.rom.requireAsset('PI', 0).offset;
    const offset = pointer - base;
    if (offset < 0 || offset + PI_BASE_SIZE > data.length) return null;
    return {
      pointer,
      offset,
      width: readBe16(data, offset),
      height: readBe16(data, offset + 2),
      pieceCount: (readBe16(data, offset + 8) >> 8) & 0xff,
      originXRaw: readBe16(data, offset + 10),
      originYRaw: readBe16(data, offset + 12),
      attr: readBe16(data, offset + 14),
      size: readBe16(data, offset + 16),
      gfxPointer: readBe32(data, offset + 20)
    };
  }

  parsePiExtra(pointer, pieceIndex) {
    const data = this.rom.payload('PI', 0);
    const base = this.rom.requireAsset('PI', 0).offset;
    const offset = pointer - base + PI_BASE_SIZE + (pieceIndex - 1) * PI_EXTRA_SIZE;
    if (pieceIndex < 1 || offset < 0 || offset + PI_EXTRA_SIZE > data.length) return null;
    return {
      x: signed16(readBe16(data, offset) - 0x80),
      y: signed16(readBe16(data, offset + 2) - 0x80),
      attr: readBe16(data, offset + 4),
      size: readBe16(data, offset + 6),
      gfxPointer: readBe32(data, offset + 10)
    };
  }

  pieces(pi) {
    const pieces = [{
      x: pi.originXRaw - 0x80,
      y: pi.originYRaw - 0x80,
      attr: pi.attr,
      size: pi.size,
      gfxPointer: pi.gfxPointer
    }];
    for (let i = 1; i < pi.pieceCount; i += 1) {
      const extra = this.parsePiExtra(pi.pointer, i);
      if (extra) pieces.push(extra);
    }
    return pieces;
  }

  clearRickCrawlGroundBaseline(pixels) {
    let bottom = -1;
    let opaque = 0;
    let nonblack = 0;
    for (let y = pixels.height - 1; y >= 0; y -= 1) {
      opaque = 0;
      nonblack = 0;
      for (let x = 0; x < pixels.width; x += 1) {
        const offset = (y * pixels.width + x) * 4;
        if (pixels.data[offset + 3] === 0) continue;
        opaque += 1;
        if (pixels.data[offset] !== 0 || pixels.data[offset + 1] !== 0 || pixels.data[offset + 2] !== 0) nonblack += 1;
      }
      if (opaque > 0) { bottom = y; break; }
    }
    /* PN94/95 contain one all-black source scanline below the audited crawl
     * contact anchor. It is an out-of-silhouette ground baseline, not a body
     * pixel; preserving it as opaque makes it overwrite bright terrain. */
    if (bottom < 0 || opaque < 16 || nonblack !== 0) return pixels;
    for (let x = 0; x < pixels.width; x += 1) {
      const offset = (bottom * pixels.width + x) * 4;
      if (pixels.data[offset + 3] === 0) continue;
      pixels.data[offset] = 0;
      pixels.data[offset + 1] = 0;
      pixels.data[offset + 2] = 0;
      pixels.data[offset + 3] = 0;
    }
    return pixels;
  }

  renderPi(pi, palette, options = {}) {
    const pieces = this.pieces(pi);
    let minX = 0;
    let minY = 0;
    let maxX = pi.width < 512 ? pi.width : 0;
    let maxY = pi.height < 512 ? pi.height : 0;
    for (const piece of pieces) {
      const size = sizeFromWord(piece.size);
      minX = Math.min(minX, piece.x);
      minY = Math.min(minY, piece.y);
      maxX = Math.max(maxX, piece.x + size.tilesX * 8);
      maxY = Math.max(maxY, piece.y + size.tilesY * 8);
    }
    const width = Math.max(1, maxX - minX + 8);
    const height = Math.max(1, maxY - minY + 8);
    let output = new PixelBuffer(width, height, [0, 0, 0, 0]);
    for (const piece of pieces) {
      const size = sizeFromWord(piece.size);
      const pieceH = !!(piece.attr & 0x0800);
      const pieceV = !!(piece.attr & 0x1000);
      const paletteLine = (piece.attr >> 13) & 3;
      let tileIndex = 0;
      for (let tx = 0; tx < size.tilesX; tx += 1) {
        for (let ty = 0; ty < size.tilesY; ty += 1) {
          const tileX = pieceH ? size.tilesX - 1 - tx : tx;
          const tileY = pieceV ? size.tilesY - 1 - ty : ty;
          const gfxOffset = piece.gfxPointer + tileIndex * 32;
          if (gfxOffset + 32 <= this.rom.bytes.length) {
            drawMegaDriveTile(output, this.rom.absoluteSlice(gfxOffset, 32),
              piece.x - minX + 4 + tileX * 8,
              piece.y - minY + 4 + tileY * 8,
              palette, {
                paletteLine,
                hFlip: pieceH,
                vFlip: pieceV,
                transparentZero: true
              });
          }
          tileIndex += 1;
        }
      }
    }
    if (options.clearCrawlBaseline) this.clearRickCrawlGroundBaseline(output);
    let originX = -minX + 4;
    let originY = -minY + 4;
    if (options.mirrorX || options.mirrorY) {
      const mirrored = new PixelBuffer(output.width, output.height, [0, 0, 0, 0]);
      mirrored.blit(output, 0, 0, { mirrorX: !!options.mirrorX, mirrorY: !!options.mirrorY });
      output = mirrored;
      if (options.mirrorX) originX = output.width - originX;
      if (options.mirrorY) originY = output.height - originY;
    }
    const foot = this.deriveFootAnchor(output, originX, originY);
    return {
      pixels: output,
      originX,
      originY,
      originUnscaledX: originX,
      originUnscaledY: originY,
      footAnchorX: foot.x,
      footAnchorY: foot.y,
      bounds: { minX, minY, maxX, maxY },
      mirrored: !!options.mirrorX,
      mirroredY: !!options.mirrorY,
      pieces
    };
  }

  deriveFootAnchor(pixels, fallbackX, fallbackY) {
    const bounds = pixels.opaqueBounds();
    if (!bounds) return { x: fallbackX, y: fallbackY };
    const bandTop = Math.max(bounds.minY, bounds.maxY - Math.max(1, Math.round(pixels.height * 0.14)));
    let sumX = 0;
    let count = 0;
    for (let y = bandTop; y <= bounds.maxY; y += 1) {
      for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
        if (pixels.data[(y * pixels.width + x) * 4 + 3] > 0) {
          sumX += x;
          count += 1;
        }
      }
    }
    return { x: count ? sumX / count : (bounds.minX + bounds.maxX) / 2, y: bounds.maxY + 1 };
  }

  applyRickAlignment(frame, pnIndex, frameIndex, mirrorX) {
    const override = RICK_ALIGNMENT_OVERRIDES.get(`${pnIndex}:${frameIndex}:${mirrorX ? 1 : 0}`);
    return override ? { ...frame, ...override } : frame;
  }

  framesForPn(pnIndex, palette, options = {}) {
    const pn = this.parsePnCatalog()[pnIndex];
    if (!pn || pn.start == null || pn.end == null) return { pn, frames: [] };
    /* PN left/right rows already contain their final orientation. Mirroring is
     * explicit-only and is reserved for a deliberate right-only fallback. */
    const mirrorX = options.mirrorX === true;
    const mirrorY = options.mirrorY === true;
    const frames = [];
    for (let index = pn.start; index < pn.end; index += 1) {
      const pf = this.parsePf(index);
      const pi = pf ? this.parsePi(pf.piPointer) : null;
      if (!pf || !pi) continue;
      const frame = { pf, pi, ...this.renderPi(pi, palette, {
        mirrorX, mirrorY, clearCrawlBaseline: pnIndex === 0x5e || pnIndex === 0x5f
      }) };
      frames.push(this.applyRickAlignment(frame, pnIndex, frames.length, mirrorX));
    }
    const enemyFamily = rdxEnemyAnimationFamily(pnIndex);
    if (enemyFamily && frames.length) {
      const first = frames[0];
      const offsetX = Number(first.footAnchorX) - Number(first.originX);
      const offsetY = Number(first.footAnchorY) - Number(first.originY);
      const grounded = rdxEnemyUsesGroundContact(pnIndex);
      for (let index = 0; index < frames.length; index += 1) {
        const frame = frames[index];
        frames[index] = {
          ...frame,
          enemyFamily,
          /* Enemy X is registered once for the animation so a changing foot
           * centroid cannot slide the whole body. Grounded Y deliberately
           * follows the current opaque bottom: the feet stay planted while
           * RDX's changing silhouette produces its authored head/body bob. */
          enemyAnchorX: Number(frame.originX) + offsetX,
          enemyAnchorY: grounded ? Number(frame.footAnchorY) : Number(frame.originY) + offsetY
        };
      }
    }
    return { pn, frames };
  }

  frameForPn(pnIndex, tick, palette, options = {}) {
    const animation = this.framesForPn(pnIndex, palette, options);
    if (!animation.frames.length) return null;
    const index = frameIndexForTimeline(animation.frames, animation.pn?.loopOffset, tick);
    return { ...animation.frames[index], pn: animation.pn, frameIndex: index };
  }

  parseActorDef(actorId) {
    const pa = this.rom.payload('PA', 0);
    const offset = actorId * PA_RECORD_SIZE;
    if (offset < 0 || offset + PA_RECORD_SIZE > pa.length) return null;
    const pnAsset = this.rom.requireAsset('PN', 0);
    const pnData = this.rom.payload('PN', 0);
    const slots = [];
    const unique = new Set();
    for (let slot = 0; slot < 16; slot += 1) {
      const pointer = readBe32(pa, offset + 0x40 + slot * 4);
      const pn = pointer >= pnAsset.offset && pointer < pnAsset.offset + pnData.length && (pointer - pnAsset.offset) % PN_RECORD_SIZE === 0
        ? (pointer - pnAsset.offset) / PN_RECORD_SIZE : null;
      if (pn != null) unique.add(pn);
      if (pointer || pn != null) slots.push({ slot, pointer, pn });
    }
    const hooks = {
      p98: readBe32(pa, offset + 0x98),
      p9c: readBe32(pa, offset + 0x9c),
      pA0: readBe32(pa, offset + 0xa0),
      pB0: readBe32(pa, offset + 0xb0)
    };
    const b0Words = [];
    if (hooks.pB0 && hooks.pB0 + 18 <= this.rom.bytes.length) {
      for (let i = 0; i < 9; i += 1) b0Words.push(readBe16(this.rom.bytes, hooks.pB0 + i * 2));
    }
    return {
      actorId,
      offset: this.rom.requireAsset('PA', 0).offset + offset,
      flags0: readBe16(pa, offset),
      fallbackSlot: pa[offset + 0x0f] || 0,
      pnSlots: slots,
      pnUnique: [...unique].sort((a, b) => a - b),
      hooks,
      b0Words,
      collisionOffsets: {
        left: signed8(pa[offset + 0x8a]),
        top: signed8(pa[offset + 0x8b]),
        right: signed8(pa[offset + 0x8c]),
        bottom: signed8(pa[offset + 0x8d])
      }
    };
  }

  parseMaSpawns(mapId) {
    const asset = this.rom.getAsset('MA', mapId);
    if (!asset) return [];
    const data = this.rom.payload('MA', mapId);
    const rows = [];
    for (let offset = 0, index = 0; offset + MA_RECORD_SIZE <= data.length; offset += MA_RECORD_SIZE, index += 1) {
      rows.push({
        mapId,
        index,
        offset,
        actorId: readBe16(data, offset),
        x: readBe16(data, offset + 16),
        y: readBe16(data, offset + 18),
        raw: data.slice(offset, offset + MA_RECORD_SIZE)
      });
    }
    return rows;
  }

  actorFrame(actorId, tick, palette, options = {}) {
    const actor = this.parseActorDef(actorId);
    if (!actor || actor.pnUnique.length === 0) return null;
    const pnIndex = actor.pnUnique[Math.abs(Math.floor(tick)) % actor.pnUnique.length];
    const frame = this.frameForPn(pnIndex, tick, palette, options);
    return frame ? { ...frame, actor } : null;
  }

  placementAnchor(frame, actorId, options = {}) {
    const id = Number(actorId) | 0;
    const role = String(options.role || '');
    if (role === 'enemy' && Number.isFinite(frame?.enemyAnchorX) && Number.isFinite(frame?.enemyAnchorY)) {
      const family = Number(frame?.enemyFamily || rdxEnemyAnimationFamily(frame?.pn?.index));
      const classic = family === 6 ? castleDogClassicBounds(options.classicSprite) : null;
      const opaque = classic && frame?.pixels?.opaqueBounds?.();
      if (classic && opaque) {
        const classicCenterX = (classic.minX + classic.maxX) / 2;
        const rdxCenterX = (opaque.minX + opaque.maxX) / 2;
        return {
          x:rdxCenterX + 16 - classicCenterX,
          y:opaque.maxY + 21 - classic.maxY,
          mode:'enemy-classic-source-phase'
        };
      }
      return {
        x: frame.enemyAnchorX,
        y: frame.enemyAnchorY,
        mode: rdxEnemyUsesGroundContact(frame?.pn?.index) ? 'enemy-family-x-ground-y' : 'enemy-family-pi-origin'
      };
    }
    /* MA X/Y is the runtime actor origin for flying actors and detached
     * projectiles. Foot anchoring these records shifted the MD0006 bat and
     * falling-dagger bank up/left by most of a frame. */
    const originAnchoredActors = new Set([0x0c, 0x55]);
    if (role === 'projectile' || originAnchoredActors.has(id)) {
      return { x: frame.originX, y: frame.originY, mode: 'pi-origin' };
    }

    /* Keep this list byte-for-byte aligned with native
     * rdx_present_plan.c::actor_uses_template_bottom(). Only these MA actor
     * families store their gameplay bottom contact in PA+0xB0 word 8. Jungle
     * wall shooters 0x33..0x36 are ordinary decoded-PN foot registrations;
     * treating them as template-bottom moves the editor body 6-7 px below the
     * native compositor. */
    const templateBottomActors = new Set([0x50, 0x51, 0x53, 0x72]);
    if (templateBottomActors.has(id) && frame.actor?.b0Words?.length >= 9) {
      const templateBottom = signed16(frame.actor.b0Words[8]);
      if (templateBottom > 0 && templateBottom < 64) {
        return {
          x: frame.footAnchorX ?? frame.originX,
          y: frame.originY + templateBottom,
          mode: 'template-bottom',
          templateBottom
        };
      }
    }
    return { x: frame.footAnchorX ?? frame.originX, y: frame.footAnchorY ?? frame.originY, mode: 'derived-foot' };
  }
}
