import { analyze } from "./analysis.js";
import { composite, requireArt } from "./document.js";
import { maskBounds, maskComponents, resolveSelector } from "./selectors.js";

const jsonEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const rgba = (doc, index) => doc?.palette?.[index] ?? [0, 0, 0, 0];
const ids = (rows = []) => rows.map((row) => row.id);

function pixelIndex(doc, frameId, layerId, x, y) {
  if (!doc || x < 0 || y < 0 || x >= doc.width || y >= doc.height) return 0;
  const frame = doc.frames.find((row) => row.id === frameId), layer = doc.layers.find((row) => row.id === layerId);
  if (!frame || !layer) return 0;
  return frame.cels[layerId][y * doc.width + x] ?? 0;
}

function targetPixels(doc, frameId, layerId = null) {
  const frame = doc.frames.find((row) => row.id === frameId);
  requireArt(frame, "TARGET", `Unknown frame: ${frameId}`, { frameId, validFrameIds: doc.frames.map((row) => row.id) });
  if (!layerId) return composite(doc, frameId);
  const layer = doc.layers.find((row) => row.id === layerId);
  requireArt(layer, "TARGET", `Unknown layer: ${layerId}`, { layerId, validLayerIds: doc.layers.map((row) => row.id) });
  return frame.cels[layerId];
}

function frameLayerDelta(before, after, frameId, layerId) {
  const width = Math.max(before.width, after.width), height = Math.max(before.height, after.height);
  let changedPixels = 0, added = 0, removed = 0, recolored = 0, bounds = null;
  const transitions = new Map();
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const from = pixelIndex(before, frameId, layerId, x, y), to = pixelIndex(after, frameId, layerId, x, y), colorChanged = !jsonEqual(rgba(before, from), rgba(after, to));
    if (from === to && !colorChanged) continue;
    changedPixels++;
    if (from === 0 && to !== 0) added++;
    else if (from !== 0 && to === 0) removed++;
    else recolored++;
    bounds = bounds ? [Math.min(bounds[0], x), Math.min(bounds[1], y), Math.max(bounds[2], x), Math.max(bounds[3], y)] : [x, y, x, y];
    const key = `${from}:${to}:${colorChanged ? 1 : 0}`;
    transitions.set(key, (transitions.get(key) ?? 0) + 1);
  }
  return {
    changedPixels,
    bounds: bounds ? [bounds[0], bounds[1], bounds[2] - bounds[0] + 1, bounds[3] - bounds[1] + 1] : null,
    added,
    removed,
    recolored,
    paletteTransitions: [...transitions].map(([key, count]) => {
      const [from, to, colorChanged] = key.split(":").map(Number);
      return { from, to, rgbaChanged: colorChanged === 1, count };
    }).sort((a, b) => b.count - a.count || a.from - b.from || a.to - b.to),
  };
}

function structuralDelta(before, after) {
  const beforeFrames = ids(before.frames), afterFrames = ids(after.frames), beforeLayers = ids(before.layers), afterLayers = ids(after.layers);
  const sharedFrames = beforeFrames.filter((id) => afterFrames.includes(id));
  const paletteChanged = [];
  for (let i = 0; i < Math.max(before.palette.length, after.palette.length); i++) if (!jsonEqual(before.palette[i], after.palette[i])) paletteChanged.push(i);
  return {
    dimensions: before.width === after.width && before.height === after.height ? null : { before: [before.width, before.height], after: [after.width, after.height] },
    frames: {
      added: afterFrames.filter((id) => !beforeFrames.includes(id)),
      removed: beforeFrames.filter((id) => !afterFrames.includes(id)),
      reordered: jsonEqual(beforeFrames.filter((id) => afterFrames.includes(id)), afterFrames.filter((id) => beforeFrames.includes(id))) ? false : true,
    },
    layers: {
      added: afterLayers.filter((id) => !beforeLayers.includes(id)),
      removed: beforeLayers.filter((id) => !afterLayers.includes(id)),
      reordered: jsonEqual(beforeLayers.filter((id) => afterLayers.includes(id)), afterLayers.filter((id) => beforeLayers.includes(id))) ? false : true,
      metadataChanged: after.layers.filter((layer) => {
        const prior = before.layers.find((row) => row.id === layer.id);
        return prior && !jsonEqual(prior, layer);
      }).map((layer) => layer.id),
    },
    anchorsChanged: sharedFrames.filter((id) => !jsonEqual(before.frames.find((row) => row.id === id).anchor, after.frames.find((row) => row.id === id).anchor)),
    clipsChanged: !jsonEqual(before.clips, after.clips),
    layoutChanged: !jsonEqual(before.layout, after.layout),
    constraintsChanged: !jsonEqual(before.constraints, after.constraints),
    paletteChanged,
  };
}

export function documentDelta(before, after) {
  const frameIds = [...new Set([...ids(before.frames), ...ids(after.frames)])], layerIds = [...new Set([...ids(before.layers), ...ids(after.layers)])];
  const targets = []; let changedPixels = 0, added = 0, removed = 0, recolored = 0, globalBounds = null;
  const transitionMap = new Map();
  for (const frameId of frameIds) for (const layerId of layerIds) {
    const delta = frameLayerDelta(before, after, frameId, layerId);
    if (!delta.changedPixels) continue;
    targets.push({ frameId, layerId, changedPixels: delta.changedPixels, bounds: delta.bounds, added: delta.added, removed: delta.removed, recolored: delta.recolored });
    changedPixels += delta.changedPixels; added += delta.added; removed += delta.removed; recolored += delta.recolored;
    if (delta.bounds) {
      const [x, y, w, h] = delta.bounds, x2 = x + w - 1, y2 = y + h - 1;
      globalBounds = globalBounds ? [Math.min(globalBounds[0], x), Math.min(globalBounds[1], y), Math.max(globalBounds[2], x2), Math.max(globalBounds[3], y2)] : [x, y, x2, y2];
    }
    for (const transition of delta.paletteTransitions) {
      const key = `${transition.from}:${transition.to}:${transition.rgbaChanged ? 1 : 0}`;
      transitionMap.set(key, (transitionMap.get(key) ?? 0) + transition.count);
    }
  }
  const structural = structuralDelta(before, after);
  return {
    changedPixels,
    bounds: globalBounds ? [globalBounds[0], globalBounds[1], globalBounds[2] - globalBounds[0] + 1, globalBounds[3] - globalBounds[1] + 1] : null,
    added,
    removed,
    recolored,
    targets,
    paletteTransitions: [...transitionMap].map(([key, count]) => {
      const [from, to, colorChanged] = key.split(":").map(Number);
      return { from, to, rgbaChanged: colorChanged === 1, count };
    }).sort((a, b) => b.count - a.count || a.from - b.from || a.to - b.to),
    structural,
  };
}

function warningIdentity(warning) {
  return JSON.stringify({ code: warning.code, frameId: warning.frameId ?? null, ramp: warning.ramp ?? null });
}

export function warningDelta(before, after) {
  const beforeWarnings = analyze(before).warnings, afterWarnings = analyze(after).warnings;
  const beforeSet = new Set(beforeWarnings.map(warningIdentity)), afterSet = new Set(afterWarnings.map(warningIdentity));
  return {
    introduced: afterWarnings.filter((warning) => !beforeSet.has(warningIdentity(warning))),
    removed: beforeWarnings.filter((warning) => !afterSet.has(warningIdentity(warning))),
  };
}

function numericConstraint(actual, expected, name) {
  const valid = (value) => Number.isInteger(value) && value >= 0;
  if (typeof expected === "number") {
    requireArt(valid(expected), "ASSERTION", `${name} must use a non-negative integer constraint`);
    requireArt(actual === expected, "ASSERTION", `${name} must equal ${expected}`, { assertion: name, expected: { exact: expected }, actual });
  } else {
    requireArt(expected && typeof expected === "object" && ["exact", "min", "max"].some((key) => expected[key] !== undefined), "ASSERTION", `${name} requires exact/min/max`);
    for (const key of ["exact", "min", "max"]) if (expected[key] !== undefined) requireArt(valid(expected[key]), "ASSERTION", `${name}.${key} must be a non-negative integer`);
    if (expected.exact !== undefined) requireArt(actual === expected.exact, "ASSERTION", `${name} must equal ${expected.exact}`, { assertion: name, expected, actual });
    if (expected.min !== undefined) requireArt(actual >= expected.min, "ASSERTION", `${name} must be at least ${expected.min}`, { assertion: name, expected, actual });
    if (expected.max !== undefined) requireArt(actual <= expected.max, "ASSERTION", `${name} must be at most ${expected.max}`, { assertion: name, expected, actual });
  }
}

function validBounds(value) {
  return Array.isArray(value) && value.length === 4 && value.every(Number.isInteger) && value[0] >= 0 && value[1] >= 0 && value[2] > 0 && value[3] > 0;
}

function boundsWithin(inner, outer) {
  if (!inner) return true;
  return inner[0] >= outer[0] && inner[1] >= outer[1] && inner[0] + inner[2] <= outer[0] + outer[2] && inner[1] + inner[3] <= outer[1] + outer[3];
}

function scopePixelsEqual(before, after, { frameId, layerId = null, selector }, context) {
  requireArt(before.width === after.width && before.height === after.height, "ASSERTION", "unchanged selector cannot span a canvas resize");
  const indices = resolveSelector(before, { frameId, layerId, selector: selector ?? { type: "opaque" }, checkpoint: context.checkpoint, checkpointResolver: context.checkpointResolver, handleResolver: context.handleResolver });
  const a = targetPixels(before, frameId, layerId), b = targetPixels(after, frameId, layerId);
  for (const at of indices) if (a[at] !== b[at] || !jsonEqual(before.palette[a[at]], after.palette[b[at]])) return { ok: false, index: at, coordinate: [at % before.width, Math.floor(at / before.width)] };
  return { ok: true, count: indices.length };
}

function targetSelection(doc, target, context) {
  const frameId = target.frameId, layerId = target.layerId ?? null, pixels = targetPixels(doc, frameId, layerId);
  const indices = resolveSelector(doc, { frameId, layerId, selector: target.selector ?? { type: "opaque" }, checkpoint: context.checkpoint, checkpointResolver: context.checkpointResolver, handleResolver: context.handleResolver });
  return { frameId, layerId, pixels, indices };
}

export function assertTransaction(before, after, assertions, { checkpoints = new Map(), handleResolver = null, delta = null, warnings = null } = {}) {
  if (!assertions) return;
  requireArt(assertions && typeof assertions === "object" && !Array.isArray(assertions), "ASSERTION", "Assertions must be an object");
  const allowedKeys = new Set(["changedPixels", "changedBoundsWithin", "unchanged", "paletteUnchanged", "anchorsUnchanged", "clipsUnchanged", "structureUnchanged", "opaqueBounds", "componentCount", "colorsUsed", "noNewWarnings", "checkpointDeltaWithin"]);
  const unknown = Object.keys(assertions).filter((key) => !allowedKeys.has(key));
  requireArt(unknown.length === 0, "ASSERTION", "Unknown assertion", { unknown });
  for (const key of ["unchanged", "opaqueBounds", "componentCount", "colorsUsed"]) if (assertions[key] !== undefined) requireArt(Array.isArray(assertions[key]), "ASSERTION", `${key} must be an array`);
  if (assertions.changedBoundsWithin !== undefined) requireArt(validBounds(assertions.changedBoundsWithin), "ASSERTION", "changedBoundsWithin must be [x,y,width,height]");
  if (assertions.noNewWarnings !== undefined) requireArt(assertions.noNewWarnings === true || assertions.noNewWarnings === "all" || (Array.isArray(assertions.noNewWarnings) && assertions.noNewWarnings.every((code) => typeof code === "string")), "ASSERTION", "noNewWarnings must be true, all, or warning-code strings");
  delta ??= documentDelta(before, after);
  const context = { handleResolver, checkpoint: null, checkpointResolver: (name) => checkpoints.get(name) ?? null };
  if (assertions.changedPixels !== undefined) numericConstraint(delta.changedPixels, assertions.changedPixels, "changedPixels");
  if (assertions.changedBoundsWithin) requireArt(boundsWithin(delta.bounds, assertions.changedBoundsWithin), "ASSERTION", "Changed bounds exceed changedBoundsWithin", { assertion: "changedBoundsWithin", expected: assertions.changedBoundsWithin, actual: delta.bounds });
  if (assertions.paletteUnchanged) requireArt(jsonEqual(before.palette, after.palette), "ASSERTION", "Palette changed", { assertion: "paletteUnchanged", actual: delta.structural.paletteChanged });
  if (assertions.anchorsUnchanged) requireArt(delta.structural.anchorsChanged.length === 0, "ASSERTION", "Anchors changed", { assertion: "anchorsUnchanged", actual: delta.structural.anchorsChanged });
  if (assertions.clipsUnchanged) requireArt(!delta.structural.clipsChanged, "ASSERTION", "Clips changed", { assertion: "clipsUnchanged" });
  if (assertions.structureUnchanged) {
    const s = delta.structural;
    const changed = !!s.dimensions || s.frames.added.length || s.frames.removed.length || s.frames.reordered || s.layers.added.length || s.layers.removed.length || s.layers.reordered || s.layers.metadataChanged.length || s.layoutChanged;
    requireArt(!changed, "ASSERTION", "Document structure changed", { assertion: "structureUnchanged", actual: s });
  }
  for (const target of assertions.unchanged ?? []) {
    const result = scopePixelsEqual(before, after, target, context);
    requireArt(result.ok, "ASSERTION", "Selected pixels changed", { assertion: "unchanged", target, ...result });
  }
  for (const expected of assertions.opaqueBounds ?? []) {
    requireArt(expected && (expected.exact !== undefined || expected.within !== undefined), "ASSERTION", "opaqueBounds entry requires exact or within");
    const { pixels, indices } = targetSelection(after, expected, context), opaque = indices.filter((at) => pixels[at] !== 0), actual = maskBounds(after, opaque);
    if (expected.exact) {
      requireArt(validBounds(expected.exact), "ASSERTION", "opaqueBounds.exact must be [x,y,width,height]");
      requireArt(jsonEqual(actual, expected.exact), "ASSERTION", "Opaque bounds differ from expected", { assertion: "opaqueBounds", expected: expected.exact, actual });
    }
    if (expected.within) {
      requireArt(validBounds(expected.within), "ASSERTION", "opaqueBounds.within must be [x,y,width,height]");
      requireArt(boundsWithin(actual, expected.within), "ASSERTION", "Opaque bounds exceed expected region", { assertion: "opaqueBounds", expected: expected.within, actual });
    }
  }
  for (const expected of assertions.componentCount ?? []) {
    const { pixels, indices } = targetSelection(after, expected, context), opaque = indices.filter((at) => pixels[at] !== 0), actual = maskComponents(after, opaque).length;
    numericConstraint(actual, expected.count ?? expected, "componentCount");
  }
  for (const expected of assertions.colorsUsed ?? []) {
    requireArt(expected && (expected.subset !== undefined || expected.exact !== undefined || expected.maxCount !== undefined), "ASSERTION", "colorsUsed entry requires subset, exact or maxCount");
    const { pixels, indices } = targetSelection(after, expected, context), actual = [...new Set(indices.map((at) => pixels[at]).filter((index) => index !== 0))].sort((a, b) => a - b);
    if (expected.subset !== undefined) {
      requireArt(Array.isArray(expected.subset) && expected.subset.every((index) => Number.isInteger(index) && index >= 0 && index < after.palette.length), "ASSERTION", "colorsUsed.subset must contain valid palette indices");
      requireArt(actual.every((index) => expected.subset.includes(index)), "ASSERTION", "Selection uses colors outside subset", { assertion: "colorsUsed", expected: expected.subset, actual });
    }
    if (expected.exact !== undefined) {
      requireArt(Array.isArray(expected.exact) && expected.exact.every((index) => Number.isInteger(index) && index >= 0 && index < after.palette.length), "ASSERTION", "colorsUsed.exact must contain valid palette indices"); requireArt(jsonEqual(actual, [...new Set(expected.exact)].sort((a, b) => a - b)), "ASSERTION", "Selection color set differs", { assertion: "colorsUsed", expected: expected.exact, actual });
    }
    if (expected.maxCount !== undefined) {
      requireArt(Number.isInteger(expected.maxCount) && expected.maxCount >= 0, "ASSERTION", "colorsUsed.maxCount must be a non-negative integer"); requireArt(actual.length <= expected.maxCount, "ASSERTION", "Selection uses too many colors", { assertion: "colorsUsed", expected: { maxCount: expected.maxCount }, actual });
    }
  }
  if (assertions.noNewWarnings) {
    warnings ??= warningDelta(before, after);
    const selectedCodes = assertions.noNewWarnings === true || assertions.noNewWarnings === "all" ? null : new Set(assertions.noNewWarnings);
    const introduced = selectedCodes ? warnings.introduced.filter((warning) => selectedCodes.has(warning.code)) : warnings.introduced;
    requireArt(introduced.length === 0, "ASSERTION", "Transaction introduced prohibited warnings", { assertion: "noNewWarnings", actual: introduced });
  }
  if (assertions.checkpointDeltaWithin) {
    const expected = assertions.checkpointDeltaWithin, baseline = checkpoints.get(expected.checkpoint);
    requireArt(baseline, "HISTORY", "Unknown assertion checkpoint", { checkpoint: expected.checkpoint });
    const checkpointDelta = documentDelta(baseline, after);
    if (expected.maxChangedPixels !== undefined) {
      requireArt(Number.isInteger(expected.maxChangedPixels) && expected.maxChangedPixels >= 0, "ASSERTION", "checkpointDeltaWithin.maxChangedPixels must be non-negative");
      requireArt(checkpointDelta.changedPixels <= expected.maxChangedPixels, "ASSERTION", "Checkpoint drift exceeds maxChangedPixels", { assertion: "checkpointDeltaWithin", expected, actual: checkpointDelta.changedPixels });
    }
    if (expected.changedBoundsWithin) {
      requireArt(validBounds(expected.changedBoundsWithin), "ASSERTION", "checkpointDeltaWithin.changedBoundsWithin must be [x,y,width,height]");
      requireArt(boundsWithin(checkpointDelta.bounds, expected.changedBoundsWithin), "ASSERTION", "Checkpoint drift exceeds changedBoundsWithin", { assertion: "checkpointDeltaWithin", expected, actual: checkpointDelta.bounds });
    }
  }
}
