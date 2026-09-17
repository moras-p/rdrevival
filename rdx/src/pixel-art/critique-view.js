import { composite, requireArt } from './document.js';

function alphaPixel(rgba, at, color) {
  const out = at * 4;
  rgba[out] = color[0]; rgba[out + 1] = color[1]; rgba[out + 2] = color[2]; rgba[out + 3] = color[3];
}

export function silhouetteRgba(doc, frameId) {
  const pixels = composite(doc, frameId), out = new Uint8ClampedArray(pixels.length * 4);
  for (let at = 0; at < pixels.length; at++) if (pixels[at] !== 0) alphaPixel(out, at, [255, 255, 255, 255]);
  return [...out];
}

export function valueRgba(doc, frameId) {
  const pixels = composite(doc, frameId), out = new Uint8ClampedArray(pixels.length * 4);
  for (let at = 0; at < pixels.length; at++) {
    const color = doc.palette[pixels[at]] ?? [0, 0, 0, 0];
    if (!color[3]) continue;
    const y = Math.round(color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722);
    alphaPixel(out, at, [y, y, y, 255]);
  }
  return [...out];
}

const REVIEW_COLORS = [
  [247, 84, 92, 255], [79, 180, 255, 255], [255, 205, 84, 255], [118, 220, 146, 255],
  [191, 122, 255, 255], [255, 137, 75, 255], [82, 222, 219, 255], [230, 105, 194, 255],
];

export function paletteRoleRgba(doc, frameId) {
  const pixels = composite(doc, frameId), out = new Uint8ClampedArray(pixels.length * 4), ramps = doc.styleProfile?.ramps ?? [];
  const byIndex = new Map();
  ramps.forEach((ramp, n) => ramp.indices.forEach(index => byIndex.set(index, REVIEW_COLORS[n % REVIEW_COLORS.length])));
  for (let at = 0; at < pixels.length; at++) {
    const index = pixels[at]; if (!index) continue;
    alphaPixel(out, at, byIndex.get(index) ?? [150, 150, 150, 255]);
  }
  return [...out];
}

export function frameDeltaRgba(doc, frameId, otherFrameId) {
  requireArt(doc.frames.some(frame => frame.id === otherFrameId), 'TARGET', 'Unknown comparison frame');
  const a = composite(doc, frameId), b = composite(doc, otherFrameId), out = new Uint8ClampedArray(a.length * 4);
  for (let at = 0; at < a.length; at++) {
    const aa = a[at] !== 0, bb = b[at] !== 0;
    if (aa && !bb) alphaPixel(out, at, [255, 80, 150, 255]);
    else if (!aa && bb) alphaPixel(out, at, [80, 210, 255, 255]);
    else if (aa && bb && a[at] !== b[at]) alphaPixel(out, at, [255, 235, 100, 255]);
  }
  return [...out];
}

export function checkpointDeltaRgba(doc, frameId, baseline) {
  requireArt(baseline && baseline.width === doc.width && baseline.height === doc.height, 'HISTORY', 'Compatible checkpoint required');
  const a = composite(doc, frameId), old = baseline.frames.find(frame => frame.id === frameId);
  requireArt(old, 'HISTORY', 'Checkpoint does not contain this frame');
  const b = composite(baseline, frameId), out = new Uint8ClampedArray(a.length * 4);
  for (let at = 0; at < a.length; at++) {
    const current = doc.palette[a[at]] ?? [0,0,0,0], before = baseline.palette[b[at]] ?? [0,0,0,0];
    if (current.some((value, i) => value !== before[i])) alphaPixel(out, at, [255, 80, 150, 255]);
  }
  return [...out];
}
