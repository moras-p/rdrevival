import { composite, rect, requireArt, ArtError } from "./document.js";
import { componentBoundary, connectedComponent } from "./pixel-geometry.js";

const LAYER_ROLES = new Set(["generic", "silhouette/base", "shadow", "light", "accent", "temporary-guide"]);
const asSet = (indices) => new Set(indices);
const sorted = (indices) => [...indices].sort((a, b) => a - b);

function selectorFailure(error, path) {
  if (error instanceof ArtError) {
    error.details = { ...(error.details ?? {}), selectorPath: error.details?.selectorPath ?? path };
    throw error;
  }
  throw error;
}

function source(doc, frameId, layerId = null) {
  const frame = doc.frames.find((row) => row.id === frameId);
  requireArt(frame, "TARGET", `Unknown frame: ${frameId}`, { frameId, validFrameIds: doc.frames.map((row) => row.id) });
  if (!layerId) return composite(doc, frameId);
  const layer = doc.layers.find((row) => row.id === layerId);
  requireArt(layer, "TARGET", `Unknown layer: ${layerId}`, { layerId, validLayerIds: doc.layers.map((row) => row.id) });
  return frame.cels[layerId];
}

function rectIndices(doc, region) {
  const [x, y, w, h] = rect(doc, region), out = [];
  for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) out.push(py * doc.width + px);
  return out;
}

function changedAgainst(doc, baseline, frameId, layerId, kinds) {
  requireArt(baseline && baseline.width === doc.width && baseline.height === doc.height, "SELECTOR", "Checkpoint dimensions must match the active document");
  const current = source(doc, frameId, layerId), prior = source(baseline, frameId, layerId), wanted = new Set(kinds?.length ? kinds : ["added", "removed", "recolored"]), out = [];
  requireArt([...wanted].every((kind) => ["added", "removed", "recolored"].includes(kind)), "SELECTOR", "checkpoint-delta kinds must be added, removed or recolored");
  for (let i = 0; i < current.length; i++) {
    const a = prior[i], b = current[i], rgbaChanged = JSON.stringify(baseline.palette[a]) !== JSON.stringify(doc.palette[b]);
    const kind = a === 0 && b !== 0 ? "added" : a !== 0 && b === 0 ? "removed" : (a !== b || rgbaChanged) ? "recolored" : null;
    if (kind && wanted.has(kind)) out.push(i);
  }
  return out;
}

function layerRoleIndices(doc, frameId, role) {
  requireArt(LAYER_ROLES.has(role), "SELECTOR", `Unknown layer role: ${role}`);
  const frame = doc.frames.find((row) => row.id === frameId);
  requireArt(frame, "TARGET", `Unknown frame: ${frameId}`);
  const out = new Set();
  for (const layer of doc.layers) if (layer.role === role)
    frame.cels[layer.id].forEach((value, index) => { if (value !== 0) out.add(index); });
  return sorted(out);
}

export function maskBounds(doc, indices) {
  if (!indices.length) return null;
  let minX = doc.width, minY = doc.height, maxX = -1, maxY = -1;
  for (const at of indices) {
    const x = at % doc.width, y = Math.floor(at / doc.width);
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return [minX, minY, maxX - minX + 1, maxY - minY + 1];
}

export function maskHash({ documentId, revision, frameId, layerId = null, indices }) {
  let hash = 0x811c9dc5;
  const add = (value) => {
    const text = String(value);
    for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; }
    hash ^= 0xff; hash = Math.imul(hash, 0x01000193) >>> 0;
  };
  add("rdr-selection-v1"); add(documentId); add(revision); add(frameId); add(layerId ?? "composite");
  for (const index of indices) add(index);
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
}

export function maskComponents(doc, indices) {
  const remaining = asSet(indices), out = [];
  while (remaining.size) {
    const first = remaining.values().next().value, stack = [first], component = [];
    remaining.delete(first);
    while (stack.length) {
      const at = stack.pop(), x = at % doc.width, y = Math.floor(at / doc.width);
      component.push(at);
      for (const next of [x > 0 ? at - 1 : -1, x + 1 < doc.width ? at + 1 : -1, y > 0 ? at - doc.width : -1, y + 1 < doc.height ? at + doc.width : -1])
        if (next >= 0 && remaining.delete(next)) stack.push(next);
    }
    const ordered = sorted(component);
    out.push({ indices: ordered, size: ordered.length, bounds: maskBounds(doc, ordered), seed: [ordered[0] % doc.width, Math.floor(ordered[0] / doc.width)] });
  }
  return out.sort((a, b) => b.size - a.size || a.bounds[1] - b.bounds[1] || a.bounds[0] - b.bounds[0]);
}

export function indicesToRuns(doc, indices) {
  const ordered = sorted(indices), rows = [];
  let current = null;
  for (const at of ordered) {
    const x = at % doc.width, y = Math.floor(at / doc.width);
    if (current && current[0] === y && current[1] + current[2] === x) current[2] += 1;
    else { current = [y, x, 1]; rows.push(current); }
  }
  return rows;
}

/** Resolve a selector to a deterministic sorted pixel-index mask. */
export function resolveSelector(doc, { frameId, layerId = null, selector = { type: "opaque" }, checkpoint = null, checkpointResolver = null, handleResolver = null }, path = "selector") {
  try {
    requireArt(selector && typeof selector.type === "string", "SELECTOR", "Selector type is required", { selectorPath: path });
    const pixels = source(doc, frameId, layerId);
    switch (selector.type) {
      case "rect": return rectIndices(doc, selector.rect);
      case "opaque": return pixels.flatMap((value, index) => value !== 0 ? [index] : []);
      case "color": {
        requireArt(Array.isArray(selector.indices) && selector.indices.length > 0 && selector.indices.length <= 256 && selector.indices.every((v) => Number.isInteger(v) && v >= 0 && v < doc.palette.length), "SELECTOR", "color selector requires valid palette indices");
        const allowed = new Set(selector.indices), within = selector.within ? asSet(resolveSelector(doc, { frameId, layerId, selector: selector.within, checkpoint, checkpointResolver, handleResolver }, `${path}.within`)) : null;
        return pixels.flatMap((value, index) => allowed.has(value) && (!within || within.has(index)) ? [index] : []);
      }
      case "component": {
        const component = connectedComponent(doc, pixels, { x: selector.x, y: selector.y, region: selector.region ?? [0, 0, doc.width, doc.height], mode: selector.mode ?? "opaque" });
        return sorted(component.indices);
      }
      case "handle":
      case "component-id": {
        requireArt(typeof selector.handle === "string" && handleResolver, "SELECTOR", "Selection handle cannot be resolved in this context");
        const resolved = handleResolver(selector.handle, { doc, frameId, layerId });
        requireArt(resolved, "STALE_SELECTION", "Unknown or stale selection handle", { handle: selector.handle });
        if (selector.maskHash) requireArt(selector.maskHash === resolved.maskHash, "STALE_SELECTION", "Selection mask hash does not match the handle", { handle: selector.handle, expectedMaskHash: resolved.maskHash, suppliedMaskHash: selector.maskHash });
        return resolved.indices.slice();
      }
      case "checkpoint-delta": {
        const baseline = selector.checkpoint && checkpointResolver ? checkpointResolver(selector.checkpoint) : checkpoint;
        requireArt(baseline, "HISTORY", "checkpoint-delta requires a valid checkpoint", { checkpoint: selector.checkpoint ?? null });
        return changedAgainst(doc, baseline, frameId, layerId, selector.kinds);
      }
      case "layer-role":
        requireArt(!layerId, "SELECTOR", "layer-role selector requires composite scope");
        return layerRoleIndices(doc, frameId, selector.role);
      case "bounds": {
        const within = new Set(rectIndices(doc, selector.rect));
        return pixels.flatMap((value, index) => value !== 0 && within.has(index) ? [index] : []);
      }
      case "contour": {
        const inner = resolveSelector(doc, { frameId, layerId, selector: selector.selector, checkpoint, checkpointResolver, handleResolver }, `${path}.selector`);
        requireArt(["inner", "outer"].includes(selector.mode ?? "inner"), "SELECTOR", "Contour mode must be inner or outer");
        return sorted(componentBoundary(doc, inner, selector.mode ?? "inner"));
      }
      case "union": {
        requireArt(Array.isArray(selector.selectors) && selector.selectors.length >= 2 && selector.selectors.length <= 32, "SELECTOR", "union requires 2–32 selectors");
        const out = new Set();
        selector.selectors.forEach((child, index) => resolveSelector(doc, { frameId, layerId, selector: child, checkpoint, checkpointResolver, handleResolver }, `${path}.selectors[${index}]`).forEach((at) => out.add(at)));
        return sorted(out);
      }
      case "intersect": {
        requireArt(Array.isArray(selector.selectors) && selector.selectors.length >= 2 && selector.selectors.length <= 32, "SELECTOR", "intersect requires 2–32 selectors");
        let out = null;
        selector.selectors.forEach((child, index) => {
          const mask = new Set(resolveSelector(doc, { frameId, layerId, selector: child, checkpoint, checkpointResolver, handleResolver }, `${path}.selectors[${index}]`));
          out = out === null ? mask : new Set([...out].filter((at) => mask.has(at)));
        });
        return sorted(out ?? []);
      }
      case "subtract": {
        const left = new Set(resolveSelector(doc, { frameId, layerId, selector: selector.base, checkpoint, checkpointResolver, handleResolver }, `${path}.base`));
        resolveSelector(doc, { frameId, layerId, selector: selector.subtract, checkpoint, checkpointResolver, handleResolver }, `${path}.subtract`).forEach((at) => left.delete(at));
        return sorted(left);
      }
      case "invert-within-region": {
        const region = new Set(rectIndices(doc, selector.region));
        resolveSelector(doc, { frameId, layerId, selector: selector.selector, checkpoint, checkpointResolver, handleResolver }, `${path}.selector`).forEach((at) => region.delete(at));
        return sorted(region);
      }
      default: requireArt(false, "SELECTOR", `Unknown selector type: ${selector.type}`, { selectorPath: path, selectorType: selector.type });
    }
  } catch (error) {
    selectorFailure(error, path);
  }
}

export function selectionDescriptor(doc, { frameId, layerId = null, indices }) {
  return {
    documentId: doc.id,
    revision: doc.revision,
    frameId,
    layerId,
    source: layerId ? "layer" : "composite",
    dimensions: [doc.width, doc.height],
    pixelCount: indices.length,
    bounds: maskBounds(doc, indices),
    maskHash: maskHash({ documentId: doc.id, revision: doc.revision, frameId, layerId, indices }),
  };
}
