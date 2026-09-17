function cloneValue(value) {
  if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function finitePoint(point) {
  return point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y));
}

function finiteBounds(bounds) {
  return bounds && ['left', 'top', 'right', 'bottom'].every(key => Number.isFinite(Number(bounds[key])));
}

export function normalizeAnnotationPoints(points, minimumSize = 4) {
  const out = [];
  for (const point of points || []) {
    if (!finitePoint(point)) continue;
    const next = { x: Math.round(Number(point.x)), y: Math.round(Number(point.y)) };
    const previous = out.at(-1);
    if (!previous || previous.x !== next.x || previous.y !== next.y) out.push(next);
  }
  if (out.length >= 3) return out;
  const p = out[0];
  const q = out[1] || p;
  if (!p) return [];
  const half = Math.max(2, Math.round(minimumSize / 2));
  const minX = Math.min(p.x, q.x) - half;
  const minY = Math.min(p.y, q.y) - half;
  const maxX = Math.max(p.x, q.x) + half;
  const maxY = Math.max(p.y, q.y) + half;
  return [
    { x: minX, y: minY }, { x: maxX, y: minY },
    { x: maxX, y: maxY }, { x: minX, y: maxY }
  ];
}

export function annotationBoundsFromPoints(points, minimumSize = 4) {
  const normalized = normalizeAnnotationPoints(points, minimumSize);
  if (!normalized.length) return null;
  const xs = normalized.map(point => point.x);
  const ys = normalized.map(point => point.y);
  return {
    left: Math.min(...xs), top: Math.min(...ys),
    right: Math.max(...xs), bottom: Math.max(...ys)
  };
}

export function annotationBoundsPoints(bounds) {
  if (!finiteBounds(bounds)) return [];
  const left = Math.round(Math.min(Number(bounds.left), Number(bounds.right)));
  const right = Math.round(Math.max(Number(bounds.left), Number(bounds.right)));
  const top = Math.round(Math.min(Number(bounds.top), Number(bounds.bottom)));
  const bottom = Math.round(Math.max(Number(bounds.top), Number(bounds.bottom)));
  return [
    { x: left, y: top }, { x: right, y: top },
    { x: right, y: bottom }, { x: left, y: bottom }
  ];
}

export function createAnnotationStore(onChange = () => {}) {
  const entries = [];
  const notify = () => onChange(entries.map(entry => cloneValue(entry)));
  return {
    add(entry) {
      if (!entry) return null;
      const bounds = finiteBounds(entry.worldBounds)
        ? annotationBoundsFromPoints(annotationBoundsPoints(entry.worldBounds))
        : annotationBoundsFromPoints(entry.worldPoints);
      if (!bounds) return null;
      const stored = cloneValue(entry);
      stored.worldBounds = bounds;
      delete stored.worldPoints;
      entries.push(stored);
      notify();
      return stored;
    },
    clear() { entries.length = 0; notify(); },
    list() { return entries.map(entry => cloneValue(entry)); },
    get length() { return entries.length; }
  };
}

export function buildAnnotationEntry({ id, note = '', snapshot, room, mapId, worldPoints, worldBounds, selectedElement = null, expectedAction = null, ignoreExplodableCollision = false }) {
  const bounds = finiteBounds(worldBounds) ? annotationBoundsFromPoints(annotationBoundsPoints(worldBounds)) : annotationBoundsFromPoints(worldPoints);
  if (!snapshot || !bounds) return null;
  return {
    id, note: String(note),
    submap: Number(snapshot.submap),
    submapName: room?.submapName || snapshot.submapName || null,
    mapId: Number(mapId),
    mapName: room?.mapName || snapshot.mapName || null,
    mapFrow: Number(snapshot.mapFrow),
    cameraY: Number(snapshot.cameraY),
    frame: Number(snapshot.frame ?? snapshot.frameSerial ?? 0),
    worldBounds: bounds,
    tile8Bounds: {
      left: Math.floor(bounds.left / 8), top: Math.floor(bounds.top / 8),
      right: Math.floor(bounds.right / 8), bottom: Math.floor(bounds.bottom / 8)
    },
    rdxCell16Bounds: {
      left: Math.floor(bounds.left / 16), top: Math.floor(bounds.top / 16),
      right: Math.floor(bounds.right / 16), bottom: Math.floor(bounds.bottom / 16)
    },
    selectedElement: selectedElement ? cloneValue(selectedElement) : null,
    expectedAction: expectedAction ? String(expectedAction) : null,
    player: cloneValue(snapshot.player || snapshot.collision?.native || {}),
    ignoreExplodableCollision: !!ignoreExplodableCollision
  };
}

export function commitAnnotationGesture({ store, id, note = '', snapshot, room, mapId, worldPoints, worldBounds, selectedElement = null, expectedAction = null, ignoreExplodableCollision = false }) {
  if (!store || typeof store.add !== 'function') throw new TypeError('annotation store is required');
  const entry = buildAnnotationEntry({ id, note, snapshot, room, mapId, worldPoints, worldBounds, selectedElement, expectedAction, ignoreExplodableCollision });
  if (!entry) throw new Error('annotation entry was rejected');
  const stored = store.add(entry);
  if (!stored) throw new Error('annotation store rejected entry');
  return stored;
}
