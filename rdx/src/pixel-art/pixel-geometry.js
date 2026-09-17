import { rect, requireArt } from './document.js';

export function connectedComponent(doc, pixels, { x, y, region = [0, 0, doc.width, doc.height], mode = 'opaque' }) {
  const [rx, ry, rw, rh] = rect(doc, region);
  requireArt(Number.isInteger(x) && Number.isInteger(y) && x >= rx && y >= ry && x < rx + rw && y < ry + rh, 'BOUNDS', 'Component seed must be inside the selected region');
  const seed = pixels[y * doc.width + x];
  requireArt(seed !== 0, 'COMPONENT', 'Component seed must select an opaque pixel');
  requireArt(['opaque', 'same-color'].includes(mode), 'COMPONENT', 'Component mode must be opaque or same-color');
  const matches = index => pixels[index] !== 0 && (mode === 'opaque' || pixels[index] === seed);
  const seen = new Set(), stack = [y * doc.width + x], indices = [];
  while (stack.length) {
    const at = stack.pop();
    if (seen.has(at) || !matches(at)) continue;
    const px = at % doc.width, py = Math.floor(at / doc.width);
    if (px < rx || py < ry || px >= rx + rw || py >= ry + rh) continue;
    seen.add(at); indices.push(at);
    if (px > rx) stack.push(at - 1);
    if (px + 1 < rx + rw) stack.push(at + 1);
    if (py > ry) stack.push(at - doc.width);
    if (py + 1 < ry + rh) stack.push(at + doc.width);
  }
  let minX = doc.width, minY = doc.height, maxX = -1, maxY = -1;
  for (const at of indices) { const px = at % doc.width, py = Math.floor(at / doc.width); minX = Math.min(minX, px); minY = Math.min(minY, py); maxX = Math.max(maxX, px); maxY = Math.max(maxY, py); }
  return { seedColor: seed, indices, bounds: [minX, minY, maxX - minX + 1, maxY - minY + 1] };
}

export function opaqueComponents(doc, pixels, region = [0, 0, doc.width, doc.height]) {
  const [rx, ry, rw, rh] = rect(doc, region), seen = new Uint8Array(doc.width * doc.height), out = [];
  for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) {
    const start = y * doc.width + x;
    if (seen[start] || pixels[start] === 0) continue;
    const stack = [start], indices = []; seen[start] = 1;
    while (stack.length) {
      const at = stack.pop(), px = at % doc.width, py = Math.floor(at / doc.width); indices.push(at);
      for (const next of [px > rx ? at - 1 : -1, px + 1 < rx + rw ? at + 1 : -1, py > ry ? at - doc.width : -1, py + 1 < ry + rh ? at + doc.width : -1])
        if (next >= 0 && !seen[next] && pixels[next] !== 0) { seen[next] = 1; stack.push(next); }
    }
    let minX = doc.width, minY = doc.height, maxX = -1, maxY = -1;
    for (const at of indices) { const px = at % doc.width, py = Math.floor(at / doc.width); minX = Math.min(minX, px); minY = Math.min(minY, py); maxX = Math.max(maxX, px); maxY = Math.max(maxY, py); }
    out.push({ id: `component-${out.length + 1}`, size: indices.length, bounds: [minX, minY, maxX - minX + 1, maxY - minY + 1], indices });
  }
  return out.sort((a,b) => b.size - a.size || a.bounds[1] - b.bounds[1] || a.bounds[0] - b.bounds[0]).map((item, n) => ({ ...item, id: `component-${n + 1}` }));
}

export function componentBoundary(doc, indices, mode = 'inner') {
  const set = new Set(indices), out = new Set();
  for (const at of indices) {
    const x = at % doc.width, y = Math.floor(at / doc.width);
    const neighbors = [x > 0 ? at - 1 : -1, x + 1 < doc.width ? at + 1 : -1, y > 0 ? at - doc.width : -1, y + 1 < doc.height ? at + doc.width : -1];
    if (mode === 'inner') {
      if (neighbors.some(next => next < 0 || !set.has(next))) out.add(at);
    } else {
      for (const next of neighbors) if (next >= 0 && !set.has(next)) out.add(next);
    }
  }
  return [...out];
}

export function polygonPixels(doc, points) {
  requireArt(Array.isArray(points) && points.length >= 3 && points.length <= 256 && points.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isInteger)), 'POLYGON', 'Polygon requires 3–256 integer points');
  for (const [x,y] of points) rect(doc, [x,y,1,1]);
  const minY = Math.min(...points.map(p => p[1])), maxY = Math.max(...points.map(p => p[1])), out = [];
  for (let y = minY; y <= maxY; y++) {
    const scanY = y + 0.5, crossings = [];
    for (let i = 0; i < points.length; i++) {
      const [x1,y1] = points[i], [x2,y2] = points[(i + 1) % points.length];
      if ((y1 <= scanY && y2 > scanY) || (y2 <= scanY && y1 > scanY)) crossings.push(x1 + (scanY - y1) * (x2 - x1) / (y2 - y1));
    }
    crossings.sort((a,b) => a-b);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const start = Math.max(0, Math.ceil(crossings[i] - 0.5)), end = Math.min(doc.width - 1, Math.floor(crossings[i + 1] - 0.5));
      for (let x = start; x <= end; x++) out.push(y * doc.width + x);
    }
  }
  return [...new Set(out)];
}
