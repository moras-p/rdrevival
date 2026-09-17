export function pixelBufferToPpm(pixels) {
  const header = new TextEncoder().encode(`P6\n${pixels.width} ${pixels.height}\n255\n`);
  const rgb = new Uint8Array(pixels.width * pixels.height * 3);
  for (let src = 0, dst = 0; src < pixels.data.length; src += 4, dst += 3) {
    const alpha = pixels.data[src + 3] / 255;
    rgb[dst] = Math.round(pixels.data[src] * alpha);
    rgb[dst + 1] = Math.round(pixels.data[src + 1] * alpha);
    rgb[dst + 2] = Math.round(pixels.data[src + 2] * alpha);
  }
  const out = new Uint8Array(header.length + rgb.length);
  out.set(header, 0);
  out.set(rgb, header.length);
  return out;
}
