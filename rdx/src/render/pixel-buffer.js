export class PixelBuffer {
  constructor(width, height, fill = [0, 0, 0, 0]) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new RangeError(`Invalid PixelBuffer size ${width}x${height}`);
    }
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
    this.clear(fill);
  }

  clear(color = [0, 0, 0, 0]) {
    const [r = 0, g = 0, b = 0, a = 0] = color;
    for (let i = 0; i < this.data.length; i += 4) {
      this.data[i] = r;
      this.data[i + 1] = g;
      this.data[i + 2] = b;
      this.data[i + 3] = a;
    }
    return this;
  }

  setPixel(x, y, color) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    this.data[i] = color[0] ?? 0;
    this.data[i + 1] = color[1] ?? 0;
    this.data[i + 2] = color[2] ?? 0;
    this.data[i + 3] = color[3] ?? 255;
  }

  blendPixel(x, y, color) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const sa = (color[3] ?? 255) / 255;
    if (sa <= 0) return;
    const i = (y * this.width + x) * 4;
    if (sa >= 1) {
      this.data[i] = color[0] ?? 0;
      this.data[i + 1] = color[1] ?? 0;
      this.data[i + 2] = color[2] ?? 0;
      this.data[i + 3] = 255;
      return;
    }
    const da = this.data[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (oa <= 0) return;
    this.data[i] = Math.round(((color[0] ?? 0) * sa + this.data[i] * da * (1 - sa)) / oa);
    this.data[i + 1] = Math.round(((color[1] ?? 0) * sa + this.data[i + 1] * da * (1 - sa)) / oa);
    this.data[i + 2] = Math.round(((color[2] ?? 0) * sa + this.data[i + 2] * da * (1 - sa)) / oa);
    this.data[i + 3] = Math.round(oa * 255);
  }

  blit(source, dx, dy, options = {}) {
    const mirrorX = !!options.mirrorX;
    const mirrorY = !!options.mirrorY;
    const useAlpha = options.useAlpha ?? true;
    for (let sy = 0; sy < source.height; sy += 1) {
      const ty = dy + (mirrorY ? source.height - 1 - sy : sy);
      if (ty < 0 || ty >= this.height) continue;
      for (let sx = 0; sx < source.width; sx += 1) {
        const tx = dx + (mirrorX ? source.width - 1 - sx : sx);
        if (tx < 0 || tx >= this.width) continue;
        const si = (sy * source.width + sx) * 4;
        const color = [source.data[si], source.data[si + 1], source.data[si + 2], source.data[si + 3]];
        if (useAlpha) this.blendPixel(tx, ty, color);
        else this.setPixel(tx, ty, color);
      }
    }
    return this;
  }

  crop(x, y, width, height, fill = [0, 0, 0, 0]) {
    const out = new PixelBuffer(width, height, fill);
    for (let py = 0; py < height; py += 1) {
      for (let px = 0; px < width; px += 1) {
        const sx = x + px;
        const sy = y + py;
        if (sx < 0 || sy < 0 || sx >= this.width || sy >= this.height) continue;
        const si = (sy * this.width + sx) * 4;
        out.setPixel(px, py, [this.data[si], this.data[si + 1], this.data[si + 2], this.data[si + 3]]);
      }
    }
    return out;
  }

  opaqueBounds() {
    let minX = this.width;
    let minY = this.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        if (this.data[(y * this.width + x) * 4 + 3] === 0) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    return maxX < minX ? null : { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
  }
}

export function drawMegaDriveTile(target, tileBytes, dx, dy, palette, options = {}) {
  const paletteLine = options.paletteLine ?? 0;
  const hFlip = !!options.hFlip;
  const vFlip = !!options.vFlip;
  const transparentZero = !!options.transparentZero;
  for (let y = 0; y < 8; y += 1) {
    const sy = vFlip ? 7 - y : y;
    for (let x = 0; x < 8; x += 1) {
      const sx = hFlip ? 7 - x : x;
      const byte = tileBytes[sy * 4 + (sx >> 1)] ?? 0;
      const index = (sx & 1) ? (byte & 0x0f) : (byte >> 4);
      if (transparentZero && index === 0) continue;
      const color = palette[paletteLine * 16 + index] || [255, 0, 255, 255];
      target.setPixel(dx + x, dy + y, color);
    }
  }
}
