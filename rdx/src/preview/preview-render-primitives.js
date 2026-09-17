import { PixelBuffer } from '../render/pixel-buffer.js';

export function cloneBuffer(source) {
  const output = new PixelBuffer(source.width, source.height);
  output.data.set(source.data);
  return output;
}

export function rotateSpriteFrame(frame, quarterTurns = 0) {
  const turns = ((Number(quarterTurns) % 4) + 4) % 4;
  if (!frame || turns === 0) return frame;
  let current = frame;
  for (let turn = 0; turn < turns; turn += 1) {
    const src = current.pixels;
    const pixels = new PixelBuffer(src.height, src.width, [0,0,0,0]);
    for (let sy = 0; sy < src.height; sy += 1) for (let sx = 0; sx < src.width; sx += 1) {
      const si = (sy * src.width + sx) * 4;
      if (!src.data[si + 3]) continue;
      pixels.setPixel(src.height - 1 - sy, sx, src.data.subarray(si, si + 4));
    }
    const originX = src.height - Number(current.originY || 0);
    const originY = Number(current.originX || 0);
    const footAnchorX = src.height - Number(current.footAnchorY ?? current.originY ?? 0);
    const footAnchorY = Number(current.footAnchorX ?? current.originX ?? 0);
    current = { ...current, pixels, originX, originY, footAnchorX, footAnchorY, quarterTurns:(Number(current.quarterTurns || 0)+1)%4 };
  }
  return current;
}

export function composePreviewLayers(background, actors, foreground, frontActors = null, embeddedActors = null, midground = null) {
  const output = cloneBuffer(background);
  if (embeddedActors) output.blit(embeddedActors, 0, 0);
  if (midground) output.blit(midground, 0, 0);
  output.blit(actors, 0, 0);
  output.blit(foreground, 0, 0);
  if (frontActors) output.blit(frontActors, 0, 0);
  return output;
}

export function unionBounds(a, b) {
  if (!a) return b ? { ...b } : null;
  if (!b) return { ...a };
  const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.width, b.x + b.width), y1 = Math.max(a.y + a.height, b.y + b.height);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export function clipBounds(bounds, width, height) {
  if (!bounds) return null;
  const x0 = Math.max(0, Math.floor(bounds.x)), y0 = Math.max(0, Math.floor(bounds.y));
  const x1 = Math.min(width, Math.ceil(bounds.x + bounds.width)), y1 = Math.min(height, Math.ceil(bounds.y + bounds.height));
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

export function opaqueDrawBounds(pixels, drawX, drawY, clip = null, blackKey = false) {
  if (!pixels) return null;
  const top = Math.max(0, Math.min(pixels.height, Number(clip?.top || 0)));
  const bottom = Math.max(0, Math.min(pixels.height - top, Number(clip?.bottom || 0)));
  const left = Math.max(0, Math.min(pixels.width, Number(clip?.left || 0)));
  const right = Math.max(0, Math.min(pixels.width - left, Number(clip?.right || 0)));
  let minX = pixels.width, minY = pixels.height, maxX = -1, maxY = -1;
  for (let y = top; y < pixels.height - bottom; y += 1) for (let x = left; x < pixels.width - right; x += 1) {
    const index = (y * pixels.width + x) * 4;
    if (pixels.data[index + 3] === 0) continue;
    if (blackKey && pixels.data[index] === 0 && pixels.data[index + 1] === 0 && pixels.data[index + 2] === 0) continue;
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return maxX < minX ? null : Object.freeze({
    x: Math.round(drawX + minX), y: Math.round(drawY + minY),
    width: maxX - minX + 1, height: maxY - minY + 1
  });
}

export function clearRect(buffer, bounds) {
  const clipped = clipBounds(bounds, buffer.width, buffer.height);
  if (!clipped) return;
  for (let y = clipped.y; y < clipped.y + clipped.height; y += 1) {
    const start = (y * buffer.width + clipped.x) * 4;
    buffer.data.fill(0, start, start + clipped.width * 4);
  }
}

export function fillRectColor(buffer, bounds, color) {
  const clipped = clipBounds(bounds, buffer.width, buffer.height);
  if (!clipped) return;
  for (let y = clipped.y; y < clipped.y + clipped.height; y += 1) for (let x = clipped.x; x < clipped.x + clipped.width; x += 1) buffer.setPixel(x, y, color);
}

export function drawRect(buffer, x, y, width, height, color, filled = false) {
  if (filled) {
    for (let py = y; py < y + height; py += 1) for (let px = x; px < x + width; px += 1) buffer.blendPixel(px, py, color);
    return;
  }
  for (let px = x; px < x + width; px += 1) { buffer.setPixel(px, y, color); buffer.setPixel(px, y + height - 1, color); }
  for (let py = y; py < y + height; py += 1) { buffer.setPixel(x, py, color); buffer.setPixel(x + width - 1, py, color); }
}

export function blitOpacity(target, source, dx, dy, alpha = 1, clip = null, blackKey = false) {
  const opacity = Math.max(0, Math.min(1, Number(alpha)));
  const top = Math.max(0, Math.min(source.height, Number(clip?.top || 0)));
  const bottom = Math.max(0, Math.min(source.height - top, Number(clip?.bottom || 0)));
  const left = Math.max(0, Math.min(source.width, Number(clip?.left || 0)));
  const right = Math.max(0, Math.min(source.width - left, Number(clip?.right || 0)));
  if (opacity >= .999 && !top && !bottom && !left && !right && !blackKey) { target.blit(source, Math.round(dx), Math.round(dy)); return; }
  const yEnd = source.height - bottom, xEnd = source.width - right;
  for (let y = top; y < yEnd; y += 1) for (let x = left; x < xEnd; x += 1) {
    const index = (y * source.width + x) * 4;
    const a = Math.round(source.data[index + 3] * opacity);
    if (!a) continue;
    if (blackKey && source.data[index] === 0 && source.data[index + 1] === 0 && source.data[index + 2] === 0) continue;
    target.blendPixel(Math.round(dx) + x, Math.round(dy) + y, [source.data[index], source.data[index + 1], source.data[index + 2], a]);
  }
}
