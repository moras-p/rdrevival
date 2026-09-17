import { composite, validate, rect, requireArt } from "./document.js";
import { opaqueComponents, componentBoundary } from "./pixel-geometry.js";
import { resolveSelector, selectionDescriptor, maskBounds, maskComponents, indicesToRuns } from "./selectors.js";

export function readRegion(
  doc,
  {
    frameId,
    layerId,
    region = [0, 0, doc.width, doc.height],
    offset = 0,
    limit = 1024,
  },
) {
  const [x, y, w, h] = rect(doc, region);
  requireArt(
    Number.isInteger(offset) &&
      offset >= 0 &&
      offset <= w * h &&
      Number.isInteger(limit) &&
      limit > 0 &&
      limit <= 4096,
    "LIMIT",
    "Read limit must be 1–4096 pixels",
  );
  const f = doc.frames.find((f) => f.id === frameId),
    pixels = layerId ? f?.cels[layerId] : composite(doc, frameId);
  requireArt(pixels, "TARGET", "Unknown target");
  const rows = [];
  let i = offset,
    end = Math.min(w * h, offset + limit);
  while (i < end) {
    const ry = Math.floor(i / w),
      rx = i % w,
      n = Math.min(w - rx, end - i);
    rows.push([
      y + ry,
      x + rx,
      pixels.slice(
        (y + ry) * doc.width + x + rx,
        (y + ry) * doc.width + x + rx + n,
      ),
    ]);
    i += n;
  }
  return {
    revision: doc.revision,
    rows,
    coverage: { offset, count: end - offset, total: w * h },
    continuation: end < w * h ? end : null,
  };
}

const luma = ([r, g, b]) => Math.round(r * 0.2126 + g * 0.7152 + b * 0.0722);

function boundsOf(doc, pixels) {
  let minX = doc.width, minY = doc.height, maxX = -1, maxY = -1;
  for (let at = 0; at < pixels.length; at++) if (pixels[at] !== 0) {
    const x = at % doc.width, y = Math.floor(at / doc.width);
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return maxX < 0 ? null : [minX, minY, maxX - minX + 1, maxY - minY + 1];
}

function centroidOf(doc, pixels) {
  let sx = 0, sy = 0, n = 0;
  for (let at = 0; at < pixels.length; at++) if (pixels[at] !== 0) {
    sx += at % doc.width; sy += Math.floor(at / doc.width); n += 1;
  }
  return n ? [Number((sx / n).toFixed(2)), Number((sy / n).toFixed(2))] : null;
}

function paletteHistogram(pixels) {
  const counts = new Map();
  for (const index of pixels) if (index !== 0) counts.set(index, (counts.get(index) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([index, count]) => ({ index, count }));
}

function localColorDensity(doc, pixels, limit) {
  if (!limit || doc.width < 2 || doc.height < 2) return null;
  const windowSize = Math.min(8, doc.width, doc.height);
  let worst = null;
  for (let y = 0; y <= doc.height - windowSize; y += Math.max(1, Math.floor(windowSize / 2))) {
    for (let x = 0; x <= doc.width - windowSize; x += Math.max(1, Math.floor(windowSize / 2))) {
      const colors = new Set();
      for (let py = y; py < y + windowSize; py++) for (let px = x; px < x + windowSize; px++) {
        const v = pixels[py * doc.width + px]; if (v) colors.add(v);
      }
      if (!worst || colors.size > worst.colors) worst = { region: [x, y, windowSize, windowSize], colors: colors.size };
    }
  }
  return worst && worst.colors > limit ? worst : null;
}

function enclosedTransparentHoles(doc, pixels, maxSize) {
  const seen = new Uint8Array(pixels.length), holes = [];
  for (let start = 0; start < pixels.length; start++) {
    if (seen[start] || pixels[start] !== 0) continue;
    const stack = [start], indices = []; seen[start] = 1; let touchesEdge = false;
    while (stack.length) {
      const at = stack.pop(), x = at % doc.width, y = Math.floor(at / doc.width); indices.push(at);
      if (x === 0 || y === 0 || x === doc.width - 1 || y === doc.height - 1) touchesEdge = true;
      for (const next of [x > 0 ? at - 1 : -1, x + 1 < doc.width ? at + 1 : -1, y > 0 ? at - doc.width : -1, y + 1 < doc.height ? at + doc.width : -1]) {
        if (next >= 0 && !seen[next] && pixels[next] === 0) { seen[next] = 1; stack.push(next); }
      }
    }
    if (!touchesEdge && indices.length <= maxSize) {
      const xs = indices.map(at => at % doc.width), ys = indices.map(at => Math.floor(at / doc.width));
      holes.push({ size: indices.length, bounds: [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs) + 1, Math.max(...ys) - Math.min(...ys) + 1] });
    }
  }
  return holes;
}

function adjacentMaskDelta(a, b) {
  if (!a || !b || a.length !== b.length) return null;
  let changed = 0, union = 0;
  for (let i = 0; i < a.length; i++) {
    const aa = a[i] !== 0, bb = b[i] !== 0;
    if (aa || bb) union += 1;
    if (aa !== bb) changed += 1;
  }
  return { changed, union, ratio: union ? Number((changed / union).toFixed(3)) : 0 };
}

function rampWarnings(doc, warnings) {
  for (const ramp of doc.styleProfile?.ramps ?? []) {
    const values = ramp.indices.map(index => luma(doc.palette[index] ?? [0, 0, 0, 0]));
    const ascending = values.every((value, i) => i === 0 || value >= values[i - 1]);
    const descending = values.every((value, i) => i === 0 || value <= values[i - 1]);
    if (!ascending && !descending) warnings.push({ code: "RAMP_VALUE_ORDER", ramp: ramp.name, indices: [...ramp.indices], luma: values });
  }
}

function referenceProvenance(doc) {
  const references = (doc.references ?? []).map(({ id, role, policy }) => ({ id, role, policy }));
  const exactCopies = (doc.provenance?.referenceUsage ?? []).filter(row => row.operation === "exact-stamp");
  const inspirationExactCopies = exactCopies.filter(row => !["production-source", "editable-source"].includes(row.role));
  return {
    references,
    exactCopyOperations: exactCopies.length,
    inspirationExactCopies: inspirationExactCopies.length,
    exactCopyReferences: [...new Set(exactCopies.map(row => row.referenceId))],
  };
}


const INSPECT_FACTS = new Set([
  "bounds", "centroid", "counts", "paletteHistogram", "components", "contour",
  "holes", "contacts", "occupancy", "symmetry", "anchorRelativeBounds",
  "layerContribution", "checkpointDelta", "neighborhood", "paletteSemantics",
]);

function selectionPixels(doc, frameId, layerId, indices) {
  const frame = doc.frames.find((row) => row.id === frameId);
  requireArt(frame, "TARGET", `Unknown frame: ${frameId}`);
  const pixels = layerId ? frame.cels[layerId] : composite(doc, frameId);
  requireArt(pixels, "TARGET", `Unknown layer: ${layerId}`);
  return pixels;
}

function selectedCentroid(doc, indices) {
  if (!indices.length) return null;
  let sx = 0, sy = 0;
  for (const at of indices) { sx += at % doc.width; sy += Math.floor(at / doc.width); }
  return [Number((sx / indices.length).toFixed(2)), Number((sy / indices.length).toFixed(2))];
}

function selectedHistogram(pixels, indices) {
  const counts = new Map();
  for (const at of indices) counts.set(pixels[at], (counts.get(pixels[at]) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([index, count]) => ({ index, count }));
}

function selectedHoles(doc, pixels, indices) {
  const mask = new Set(indices.filter((at) => pixels[at] !== 0)), bounds = maskBounds(doc, [...mask]);
  if (!bounds) return [];
  const [x, y, w, h] = bounds, seen = new Set(), holes = [];
  for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) {
    const start = py * doc.width + px;
    if (mask.has(start) || seen.has(start)) continue;
    const stack = [start], hole = []; seen.add(start); let open = false;
    while (stack.length) {
      const at = stack.pop(), hx = at % doc.width, hy = Math.floor(at / doc.width); hole.push(at);
      if (hx === x || hy === y || hx === x + w - 1 || hy === y + h - 1) open = true;
      for (const next of [hx > x ? at - 1 : -1, hx + 1 < x + w ? at + 1 : -1, hy > y ? at - doc.width : -1, hy + 1 < y + h ? at + doc.width : -1])
        if (next >= 0 && !mask.has(next) && !seen.has(next)) { seen.add(next); stack.push(next); }
    }
    if (!open) holes.push({ size: hole.length, bounds: maskBounds(doc, hole) });
  }
  return holes.sort((a, b) => a.size - b.size || a.bounds[1] - b.bounds[1] || a.bounds[0] - b.bounds[0]);
}

function contacts(doc, indices) {
  const bounds = maskBounds(doc, indices);
  if (!bounds) return { left: [], right: [], top: [], bottom: [] };
  const [x, y, w, h] = bounds, set = new Set(indices), left = [], right = [], top = [], bottom = [];
  for (let py = y; py < y + h; py++) {
    if (set.has(py * doc.width + x)) left.push(py);
    if (set.has(py * doc.width + x + w - 1)) right.push(py);
  }
  for (let px = x; px < x + w; px++) {
    if (set.has(y * doc.width + px)) top.push(px);
    if (set.has((y + h - 1) * doc.width + px)) bottom.push(px);
  }
  return { left, right, top, bottom };
}

function occupancy(doc, indices) {
  const rows = new Map(), columns = new Map();
  for (const at of indices) {
    const x = at % doc.width, y = Math.floor(at / doc.width);
    const row = rows.get(y) ?? [x, x]; row[0] = Math.min(row[0], x); row[1] = Math.max(row[1], x); rows.set(y, row);
    const column = columns.get(x) ?? [y, y]; column[0] = Math.min(column[0], y); column[1] = Math.max(column[1], y); columns.set(x, column);
  }
  return {
    rows: [...rows].sort((a, b) => a[0] - b[0]).map(([y, [minX, maxX]]) => [y, minX, maxX]),
    columns: [...columns].sort((a, b) => a[0] - b[0]).map(([x, [minY, maxY]]) => [x, minY, maxY]),
  };
}

function symmetry(doc, indices) {
  const bounds = maskBounds(doc, indices);
  if (!bounds) return { horizontal: { mismatched: 0, total: 0 }, vertical: { mismatched: 0, total: 0 } };
  const [x, y, w, h] = bounds, set = new Set(indices), compare = (axis) => {
    let mismatched = 0, total = 0;
    for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) {
      const mirrorX = axis === "horizontal" ? x + w - 1 - (px - x) : px;
      const mirrorY = axis === "vertical" ? y + h - 1 - (py - y) : py;
      if (set.has(py * doc.width + px) !== set.has(mirrorY * doc.width + mirrorX)) mismatched++;
      total++;
    }
    return { mismatched, total };
  };
  return { horizontal: compare("horizontal"), vertical: compare("vertical") };
}

function layerContribution(doc, frameId) {
  const frame = doc.frames.find((row) => row.id === frameId);
  requireArt(frame, "TARGET", `Unknown frame: ${frameId}`);
  const owner = Array(doc.width * doc.height).fill(null);
  for (const layer of doc.layers) if (layer.visible)
    frame.cels[layer.id].forEach((value, index) => { if (value !== 0) owner[index] = layer.id; });
  return doc.layers.map((layer) => ({ layerId: layer.id, role: layer.role, visible: layer.visible, pixels: owner.filter((id) => id === layer.id).length }));
}

function checkpointSummary(doc, baseline, frameId, layerId) {
  requireArt(baseline, "HISTORY", "checkpointDelta fact requires checkpoint");
  requireArt(baseline.width === doc.width && baseline.height === doc.height, "HISTORY", "Checkpoint dimensions differ from the active document");
  const current = selectionPixels(doc, frameId, layerId, []), prior = selectionPixels(baseline, frameId, layerId, []);
  let added = 0, removed = 0, recolored = 0; const changed = [];
  for (let i = 0; i < current.length; i++) {
    const a = prior[i], b = current[i], rgbaChanged = JSON.stringify(baseline.palette[a]) !== JSON.stringify(doc.palette[b]);
    if (a === 0 && b !== 0) { added++; changed.push(i); }
    else if (a !== 0 && b === 0) { removed++; changed.push(i); }
    else if (a !== b || rgbaChanged) { recolored++; changed.push(i); }
  }
  return { changedPixels: changed.length, bounds: maskBounds(doc, changed), added, removed, recolored };
}

function paletteSemantics(doc, pixels, indices, input, checkpoint) {
  const used = [...new Set(indices.map(at => pixels[at]).filter(index => index !== 0))].sort((a,b)=>a-b);
  const permitted = doc.palettePolicy?.allowedIndices ?? doc.constraints.allowedPalette ?? doc.palette.map((_,index)=>index);
  const unusedPermitted = permitted.filter(index => index !== 0 && !used.includes(index));
  const luma = index => {
    const [r,g,b] = doc.palette[index]; return Math.round(r * 0.2126 + g * 0.7152 + b * 0.0722);
  };
  const lumaOrder = used.map(index => ({ index, luma: luma(index) })).sort((a,b)=>a.luma-b.luma || a.index-b.index);
  const rampMembership = used.map(index => ({ index, ramps: (doc.styleProfile?.ramps ?? []).filter(r => r.indices.includes(index)).map(r => ({ name:r.name, role:r.role, position:r.indices.indexOf(index), length:r.indices.length })) }));
  const duplicateRgb = [];
  const byRgb = new Map();
  doc.palette.forEach((rgba,index)=>{ if(index===0)return; const key=rgba.slice(0,3).join(','); const list=byRgb.get(key)??[]; list.push(index); byRgb.set(key,list); });
  for (const [rgb, slots] of byRgb) if (slots.length > 1) duplicateRgb.push({ rgb: rgb.split(',').map(Number), indices: slots });
  let nearestPermitted = null;
  if (input.rgb !== undefined) {
    requireArt(Array.isArray(input.rgb) && input.rgb.length === 3 && input.rgb.every(v => Number.isInteger(v) && v >= 0 && v <= 255), "INSPECT", "paletteSemantics rgb must be [r,g,b]");
    nearestPermitted = permitted.filter(i=>i!==0).map(index => {
      const p=doc.palette[index], distanceSquared=(p[0]-input.rgb[0])**2+(p[1]-input.rgb[1])**2+(p[2]-input.rgb[2])**2;
      return { index, distanceSquared };
    }).sort((a,b)=>a.distanceSquared-b.distanceSquared || a.index-b.index)[0] ?? null;
  }
  let checkpointTransitions = null;
  if (checkpoint && checkpoint.width === doc.width && checkpoint.height === doc.height) {
    const priorFrame=checkpoint.frames.find(f=>f.id===input.frameId), prior=priorFrame ? (input.layerId ? priorFrame.cels[input.layerId] : composite(checkpoint,input.frameId)) : null;
    if (prior) {
      const transitions=new Map();
      for (const at of indices) { const from=prior[at],to=pixels[at]; if(from===to)continue; const key=`${from}->${to}`;transitions.set(key,(transitions.get(key)??0)+1); }
      checkpointTransitions=[...transitions].map(([transition,count])=>({transition,count})).sort((a,b)=>b.count-a.count || a.transition.localeCompare(b.transition));
    }
  }
  return { usedIndices: used, unusedPermittedIndices: unusedPermitted, lumaOrder, rampMembership, duplicateRgb, nearestPermitted, checkpointTransitions };
}

function neighborhood(doc, pixels, point, radius = 2) {
  requireArt(Array.isArray(point) && point.length === 2 && point.every(Number.isInteger), "INSPECT", "neighborhood requires integer point [x,y]");
  requireArt(Number.isInteger(radius) && radius >= 0 && radius <= 8, "INSPECT", "neighborhood radius must be 0–8");
  const [px, py] = point;
  rect(doc, [px, py, 1, 1]);
  const x = Math.max(0, px - radius), y = Math.max(0, py - radius), x2 = Math.min(doc.width, px + radius + 1), y2 = Math.min(doc.height, py + radius + 1), rows = [];
  for (let yy = y; yy < y2; yy++) rows.push([yy, x, pixels.slice(yy * doc.width + x, yy * doc.width + x2)]);
  return { region: [x, y, x2 - x, y2 - y], rows };
}

export function inspect(doc, input = {}, { checkpoint = null, checkpointResolver = null, handleResolver = null, createHandle = null } = {}) {
  const frameId = input.frameId, layerId = input.layerId ?? null;
  requireArt(typeof frameId === "string", "TARGET", "inspect requires frameId");
  const facts = input.facts?.length ? input.facts : ["bounds", "centroid", "counts", "paletteHistogram", "components"];
  requireArt(Array.isArray(facts) && facts.length <= INSPECT_FACTS.size && facts.every((fact) => INSPECT_FACTS.has(fact)), "INSPECT", "Unknown or excessive inspect fact request", { supportedFacts: [...INSPECT_FACTS] });
  const indices = resolveSelector(doc, { frameId, layerId, selector: input.selector ?? { type: "opaque" }, checkpoint, checkpointResolver, handleResolver });
  const pixels = selectionPixels(doc, frameId, layerId, indices), descriptor = selectionDescriptor(doc, { frameId, layerId, indices });
  const result = { revision: doc.revision, selection: { ...descriptor, handle: createHandle ? createHandle({ ...descriptor, indices }) : null }, facts: {} };
  const selectedOpaque = indices.filter((at) => pixels[at] !== 0);
  for (const fact of facts) {
    if (fact === "bounds") result.facts.bounds = maskBounds(doc, indices);
    if (fact === "centroid") result.facts.centroid = selectedCentroid(doc, indices);
    if (fact === "counts") result.facts.counts = { selected: indices.length, opaque: selectedOpaque.length, transparent: indices.length - selectedOpaque.length };
    if (fact === "paletteHistogram") result.facts.paletteHistogram = selectedHistogram(pixels, indices);
    if (fact === "components") result.facts.components = maskComponents(doc, selectedOpaque).slice(0, 128).map((component, index) => {
      const componentDescriptor = selectionDescriptor(doc, { frameId, layerId, indices: component.indices });
      return { id: `component-${index + 1}`, size: component.size, bounds: component.bounds, seed: component.seed, maskHash: componentDescriptor.maskHash, handle: createHandle ? createHandle({ ...componentDescriptor, indices: component.indices }) : null };
    });
    if (fact === "contour") result.facts.contour = { innerRuns: indicesToRuns(doc, componentBoundary(doc, indices, "inner")), outerRuns: indicesToRuns(doc, componentBoundary(doc, indices, "outer")) };
    if (fact === "holes") result.facts.holes = selectedHoles(doc, pixels, indices).slice(0, 128);
    if (fact === "contacts") result.facts.contacts = contacts(doc, indices);
    if (fact === "occupancy") result.facts.occupancy = occupancy(doc, indices);
    if (fact === "symmetry") result.facts.symmetry = symmetry(doc, indices);
    if (fact === "anchorRelativeBounds") {
      const bounds = maskBounds(doc, indices), frame = doc.frames.find((row) => row.id === frameId);
      result.facts.anchorRelativeBounds = bounds ? [bounds[0] - frame.anchor[0], bounds[1] - frame.anchor[1], bounds[2], bounds[3]] : null;
    }
    if (fact === "layerContribution") result.facts.layerContribution = layerContribution(doc, frameId);
    if (fact === "checkpointDelta") result.facts.checkpointDelta = checkpointSummary(doc, checkpoint, frameId, layerId);
    if (fact === "neighborhood") result.facts.neighborhood = neighborhood(doc, pixels, input.point, input.radius ?? 2);
    if (fact === "paletteSemantics") result.facts.paletteSemantics = paletteSemantics(doc, pixels, indices, { ...input, frameId, layerId }, checkpoint);
  }
  return result;
}

export function analyze(doc, baseline = null) {
  const errors = [], warnings = [], frames = [];
  try {
    validate(doc);
  } catch (e) {
    errors.push({ code: e.code, message: e.message });
    return { errors, warnings, metrics: {}, provenance: referenceProvenance(doc) };
  }
  rampWarnings(doc, warnings);
  let previous = null;
  for (const f of doc.frames) {
    const p = composite(doc, f.id), used = new Set(p), opaque = p.filter((v) => v !== 0).length;
    let isolated = 0, edge = 0, changed = 0;
    for (let i = 0; i < p.length; i++) if (p[i]) {
      const x = i % doc.width, y = Math.floor(i / doc.width);
      if (x === 0 || y === 0 || x === doc.width - 1 || y === doc.height - 1) edge++;
      if (![[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some(([a, b]) => a >= 0 && b >= 0 && a < doc.width && b < doc.height && p[b * doc.width + a])) isolated++;
    }
    const components = opaqueComponents(doc, p);
    const minFeature = doc.styleProfile?.minFeaturePixels ?? 1;
    const small = components.filter(component => component.size < minFeature);
    if (isolated) warnings.push({ code: "ISOLATED", frameId: f.id, count: isolated });
    if (small.length) warnings.push({ code: "SMALL_CLUSTER", frameId: f.id, threshold: minFeature, count: small.length, examples: small.slice(0, 8).map(({ size, bounds }) => ({ size, bounds })) });
    if (edge) warnings.push({ code: "EDGE_CONTACT", frameId: f.id, count: edge });
    if (!opaque) warnings.push({ code: "EMPTY", frameId: f.id });
    if (previous && p.every((v, i) => v === previous[i])) warnings.push({ code: "DUPLICATE_POSE", frameId: f.id });
    const histogram = paletteHistogram(p), rare = histogram.filter(row => row.count <= 2);
    if (rare.length >= 3) warnings.push({ code: "RARE_COLOR_NOISE", frameId: f.id, colors: rare.slice(0, 12) });
    const dense = localColorDensity(doc, p, doc.styleProfile?.maxLocalColors ?? 0);
    if (dense) warnings.push({ code: "LOCAL_COLOR_DENSITY", frameId: f.id, limit: doc.styleProfile.maxLocalColors, ...dense });
    const holes = enclosedTransparentHoles(doc, p, Math.max(1, Math.min(4, minFeature)));
    if (holes.length) warnings.push({ code: "TINY_SILHOUETTE_HOLE", frameId: f.id, count: holes.length, examples: holes.slice(0, 8) });
    const maskDelta = adjacentMaskDelta(previous, p);
    if (maskDelta && maskDelta.union >= 8 && maskDelta.ratio > 0.45) warnings.push({ code: "FRAME_OUTLINE_DELTA", frameId: f.id, ...maskDelta });
    if (baseline) {
      const old = baseline.frames.find((x) => x.id === f.id);
      if (old && baseline.width === doc.width && baseline.height === doc.height) {
        const q = composite(baseline, f.id);
        changed = p.filter((v, i) => JSON.stringify(doc.palette[v]) !== JSON.stringify(baseline.palette[q[i]])).length;
      } else changed = p.length;
    }
    frames.push({
      id: f.id,
      opaque,
      colors: Math.max(0, used.size - (used.has(0) ? 1 : 0)),
      changedPixels: baseline ? changed : null,
      bounds: boundsOf(doc, p),
      centroid: centroidOf(doc, p),
      components: components.map(({ id, size, bounds }) => ({ id, size, bounds })),
      paletteHistogram: histogram,
      adjacentSilhouetteDelta: maskDelta,
      anchor: [...f.anchor],
    });
    previous = p;
  }
  if (doc.frames.some((f) => f.anchor.join() !== doc.frames[0].anchor.join())) warnings.push({ code: "ANCHOR_DRIFT" });
  return {
    errors,
    warnings,
    metrics: {
      frames,
      authoring: doc.authoring ?? null,
      styleProfile: doc.styleProfile ? { schema: doc.styleProfile.schema, assetFamily: doc.styleProfile.assetFamily, referenceIds: [...doc.styleProfile.referenceIds] } : null,
      artApproval: "requires visual review at native scale and production context",
    },
    provenance: referenceProvenance(doc),
  };
}
