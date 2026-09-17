export const SELECT_REGION_MODES = Object.freeze(['object','background','foreground','all']);

export const SELECT_REGION_PRESENTATION = Object.freeze({
  object:Object.freeze({ label:'Select', icon:'↖', short:'objects' }),
  background:Object.freeze({ label:'Select BG', icon:'▧', short:'BG' }),
  foreground:Object.freeze({ label:'Select FG', icon:'▨', short:'FG' }),
  all:Object.freeze({ label:'Select All', icon:'▣', short:'ALL' })
});

const finite = value => Number.isFinite(Number(value));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function normalizeSelectRegionMode(mode) {
  return SELECT_REGION_MODES.includes(String(mode)) ? String(mode) : 'object';
}

export function cycleSelectRegionMode(mode) {
  const current = normalizeSelectRegionMode(mode);
  return SELECT_REGION_MODES[(SELECT_REGION_MODES.indexOf(current) + 1) % SELECT_REGION_MODES.length];
}

export function regionPlane(mode) {
  const normalized = normalizeSelectRegionMode(mode);
  return normalized === 'background' ? 'B' : normalized === 'foreground' ? 'A' : normalized === 'all' ? 'AB' : null;
}

export function regionSelectionFromPoints(start, end, mode, bounds, { grid = 8 } = {}) {
  const normalized = normalizeSelectRegionMode(mode);
  if (normalized === 'object' || !finite(start?.x) || !finite(start?.y) || !finite(end?.x) || !finite(end?.y)) return null;
  const width = Math.max(grid, Number(bounds?.width || grid)), height = Math.max(grid, Number(bounds?.height || grid));
  const cell = Math.max(1, Number(grid) || 8);
  const sx = clamp(Number(start.x), 0, width - 1), sy = clamp(Number(start.y), 0, height - 1);
  const ex = clamp(Number(end.x), 0, width - 1), ey = clamp(Number(end.y), 0, height - 1);
  const x0 = Math.floor(Math.min(sx, ex) / cell) * cell;
  const y0 = Math.floor(Math.min(sy, ey) / cell) * cell;
  const x1 = Math.min(width, Math.floor(Math.max(sx, ex) / cell) * cell + cell);
  const y1 = Math.min(height, Math.floor(Math.max(sy, ey) / cell) * cell + cell);
  const region = { x:x0, y:y0, width:Math.max(cell, x1-x0), height:Math.max(cell, y1-y0), mode:normalized };
  return Object.freeze({ kind:'region', id:`region:${normalized}:${region.x}:${region.y}:${region.width}:${region.height}`, ...region });
}

export function normalizeRawRdxRegion(region, bounds = null) {
  const mode = normalizeSelectRegionMode(region?.mode);
  if (mode === 'object' || !finite(region?.x) || !finite(region?.y) || !finite(region?.width) || !finite(region?.height)) return null;
  const maxWidth = Math.max(1, Number(bounds?.width || Number.MAX_SAFE_INTEGER));
  const maxHeight = Math.max(1, Number(bounds?.height || Number.MAX_SAFE_INTEGER));
  const x = clamp(Math.floor(Number(region.x)), 0, maxWidth - 1);
  const y = clamp(Math.floor(Number(region.y)), 0, maxHeight - 1);
  const width = clamp(Math.ceil(Number(region.width)), 1, maxWidth - x);
  const height = clamp(Math.ceil(Number(region.height)), 1, maxHeight - y);
  return Object.freeze({ x, y, width, height, mode });
}

export function rectIntersects(a, b) {
  if (!a || !b) return false;
  return Number(a.x) < Number(b.x) + Number(b.width) && Number(a.x) + Number(a.width) > Number(b.x) &&
    Number(a.y) < Number(b.y) + Number(b.height) && Number(a.y) + Number(a.height) > Number(b.y);
}

export function rectContainsRect(outer, inner) {
  if (!outer || !inner) return false;
  return Number(inner.x) >= Number(outer.x) && Number(inner.y) >= Number(outer.y) &&
    Number(inner.x) + Number(inner.width) <= Number(outer.x) + Number(outer.width) &&
    Number(inner.y) + Number(inner.height) <= Number(outer.y) + Number(outer.height);
}

export function rectContainsPoint(rect, point) {
  if (!rect || !point) return false;
  return Number(point.x) >= Number(rect.x) && Number(point.x) < Number(rect.x) + Number(rect.width) &&
    Number(point.y) >= Number(rect.y) && Number(point.y) < Number(rect.y) + Number(rect.height);
}

export function regionAffectsPlane(region, plane) {
  const mode = normalizeSelectRegionMode(region?.mode);
  const wanted = String(plane || '').toUpperCase();
  return mode === 'all' || (mode === 'background' && wanted === 'B') || (mode === 'foreground' && wanted === 'A');
}

export function dedupeRawRdxRegions(regions = [], bounds = null) {
  const out = [], seen = new Set();
  for (const raw of regions) {
    const region = normalizeRawRdxRegion(raw, bounds); if (!region) continue;
    const key = `${region.mode}:${region.x}:${region.y}:${region.width}:${region.height}`;
    if (seen.has(key)) continue; seen.add(key); out.push(region);
  }
  return out;
}
