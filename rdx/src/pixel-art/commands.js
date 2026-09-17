import {
  LIMITS,
  requireArt,
  clone,
  rect,
  budget,
  validate,
  changedPixels,
  createDocument,
  dimensions,
} from "./document.js";
import { exactCopyAllowed, normalizeReferenceMetadata, validateReferenceMetadata } from "./references.js";
import { normalizeStyleProfile, validateStyleProfile } from "./style-profile.js";
import { connectedComponent, componentBoundary, polygonPixels } from "./pixel-geometry.js";
import { assertTransaction, documentDelta, warningDelta } from "./diff.js";
import { agentOperationWork, applyAgentOperation, isAgentOperation } from "./agent-ops.js";
const integer = (v) => Number.isInteger(v);

const AUTHORING_STAGES = Object.freeze(["silhouette", "major-masses", "shading", "accents", "cleanup"]);
const LAYER_ROLES = Object.freeze(["generic", "silhouette/base", "shadow", "light", "accent", "temporary-guide"]);

function normalizeExtended(doc) {
  doc.styleProfile ??= null;
  doc.authoring ??= { stage: "silhouette", lockedStages: [], stageHistory: [] };
  doc.authoring.lockedStages ??= [];
  doc.authoring.stageHistory ??= [];
  for (const layer of doc.layers ?? []) layer.role ??= layer.id === "ink" ? "silhouette/base" : "generic";
  for (let i = 0; i < (doc.references ?? []).length; i++) doc.references[i] = normalizeReferenceMetadata(doc.references[i]);
  doc.handoff ??= { goal: "", baselineCheckpoint: null, acceptedRegions: [], unresolvedNotes: [], lastReviewCheckpoint: null, lastReviewRevision: null, nextAction: "" };
  doc.handoff.acceptedRegions ??= []; doc.handoff.unresolvedNotes ??= []; if (!("lastReviewCheckpoint" in doc.handoff)) doc.handoff.lastReviewCheckpoint = null;
  doc.provenance ??= { commands: [] };
  doc.provenance.referenceUsage ??= [];
  if (!("candidate" in doc.provenance)) doc.provenance.candidate = null;
  return doc;
}

function validateExtended(doc) {
  requireArt(doc.authoring && AUTHORING_STAGES.includes(doc.authoring.stage) && Array.isArray(doc.authoring.lockedStages) && doc.authoring.lockedStages.every(stage => AUTHORING_STAGES.includes(stage)) && new Set(doc.authoring.lockedStages).size === doc.authoring.lockedStages.length && Array.isArray(doc.authoring.stageHistory) && doc.authoring.stageHistory.length <= 256, "AUTHORING", "Invalid shape-first authoring state");
  requireArt(doc.layers.every(layer => LAYER_ROLES.includes(layer.role)), "AUTHORING", "Invalid semantic layer role");
  doc.references.forEach(validateReferenceMetadata);
  if (doc.styleProfile) validateStyleProfile(doc.styleProfile, doc);
  requireArt(Array.isArray(doc.provenance.referenceUsage) && doc.provenance.referenceUsage.length <= 4096, "PROVENANCE", "Reference-use provenance exceeds budget");
  const h = doc.handoff;
  requireArt(h && typeof h === "object" && typeof (h.goal ?? "") === "string" && h.goal.length <= 2000 && (h.baselineCheckpoint === null || (typeof h.baselineCheckpoint === "string" && h.baselineCheckpoint.length <= 80)) && Array.isArray(h.acceptedRegions) && h.acceptedRegions.length <= 64 && h.acceptedRegions.every(r => r && typeof r.name === "string" && r.name.length <= 80 && r.selector && typeof r.selector === "object") && Array.isArray(h.unresolvedNotes) && h.unresolvedNotes.length <= 64 && h.unresolvedNotes.every(v => typeof v === "string" && v.length <= 1000) && (h.lastReviewCheckpoint === null || (typeof h.lastReviewCheckpoint === "string" && h.lastReviewCheckpoint.length <= 80)) && (h.lastReviewRevision === null || (Number.isInteger(h.lastReviewRevision) && h.lastReviewRevision >= 0)) && typeof (h.nextAction ?? "") === "string" && h.nextAction.length <= 1000, "HANDOFF", "Invalid bounded handoff state");
  return doc;
}
function target(doc, op) {
  const frame = doc.frames.find((f) => f.id === op.frameId),
    layer = doc.layers.find((l) => l.id === op.layerId);
  requireArt(
    frame && layer,
    "TARGET",
    "Explicit valid frameId and layerId required",
    { frameId: op.frameId, layerId: op.layerId, validFrameIds: doc.frames.map((row) => row.id), validLayerIds: doc.layers.map((row) => row.id) },
  );
  requireArt(!layer.locked, "LOCKED", "Layer is locked");
  requireArt(
    !doc.constraints.frameIds || doc.constraints.frameIds.includes(frame.id),
    "SCOPE",
    "Frame is outside edit scope",
  );
  return frame.cels[layer.id];
}
function writer(doc, op) {
  const pixels = target(doc, op);
  return (x, y, color) => {
    requireArt(
      integer(x) &&
        integer(y) &&
        x >= 0 &&
        y >= 0 &&
        x < doc.width &&
        y < doc.height,
      "BOUNDS",
      "Pixel is outside the frame",
      { coordinate: [x, y], dimensions: [doc.width, doc.height] },
    );
    requireArt(
      integer(color) && color >= 0 && color < doc.palette.length,
      "PALETTE",
      "Invalid palette index",
      { paletteIndex: color, paletteSize: doc.palette.length },
    );
    requireArt(
      !doc.constraints.allowedPalette ||
        doc.constraints.allowedPalette.includes(color),
      "PALETTE",
      "Color is outside the allowed palette",
      { paletteIndex: color, allowedPalette: doc.constraints.allowedPalette },
    );
    pixels[y * doc.width + x] = color;
  };
}
export function applyOperation(doc, op, context = {}) {
  requireArt(
    op && typeof op.type === "string",
    "OP",
    "Operation type is required",
  );
  if (isAgentOperation(op)) { applyAgentOperation(doc, op, context); return; }
  if (
    [
      "pixels",
      "line",
      "rectangle",
      "fill",
      "clear",
      "copy",
      "move",
      "mirror",
      "replace",
    ].includes(op.type)
  ) {
    const write = writer(doc, op),
      pixels = target(doc, op);
    if (op.type === "pixels") {
      requireArt(
        Array.isArray(op.rows) && op.rows.length <= LIMITS.patchPixels,
        "LIMIT",
        "Invalid row spans",
      );
      let total = 0;
      for (const row of op.rows) {
        requireArt(
          Array.isArray(row) && row.length === 3 && Array.isArray(row[2]),
          "PIXELS",
          "Rows are [y,startX,indices]",
        );
        total += row[2].length;
        requireArt(
          total <= LIMITS.patchPixels,
          "LIMIT",
          "Patch pixel budget exceeded",
        );
        row[2].forEach((p, i) => write(row[1] + i, row[0], p));
      }
    } else if (op.type === "line") {
      requireArt(
        [op.x1, op.y1, op.x2, op.y2].every(integer),
        "BOUNDS",
        "Line endpoints must be integers",
      );
      rect(doc, [op.x1, op.y1, 1, 1]);
      rect(doc, [op.x2, op.y2, 1, 1]);
      let x = op.x1,
        y = op.y1,
        dx = Math.abs(op.x2 - x),
        dy = -Math.abs(op.y2 - y),
        sx = x < op.x2 ? 1 : -1,
        sy = y < op.y2 ? 1 : -1,
        e = dx + dy;
      for (;;) {
        write(x, y, op.color);
        if (x === op.x2 && y === op.y2) break;
        const e2 = 2 * e;
        if (e2 >= dy) {
          e += dy;
          x += sx;
        }
        if (e2 <= dx) {
          e += dx;
          y += sy;
        }
      }
    } else if (op.type === "fill") {
      rect(doc, [op.x, op.y, 1, 1]);
      const old = pixels[op.y * doc.width + op.x],
        seen = new Set(),
        stack = [[op.x, op.y]];
      while (stack.length) {
        const [x, y] = stack.pop(),
          i = y * doc.width + x;
        if (seen.has(i) || pixels[i] !== old) continue;
        seen.add(i);
        write(x, y, op.color);
        if (x) stack.push([x - 1, y]);
        if (y) stack.push([x, y - 1]);
        if (x + 1 < doc.width) stack.push([x + 1, y]);
        if (y + 1 < doc.height) stack.push([x, y + 1]);
      }
    } else {
      const [x, y, w, h] = rect(doc, op.rect ?? [0, 0, doc.width, doc.height]);
      const source = pixels.slice();
      if (op.type === "copy" || op.type === "move") {
        rect(doc, [op.toX, op.toY, w, h]);
        if (op.type === "move")
          for (let j = 0; j < h; j++)
            for (let i = 0; i < w; i++) write(x + i, y + j, 0);
      }
      if (op.type === "mirror")
        requireArt(
          ["horizontal", "vertical"].includes(op.axis),
          "OP",
          "Mirror axis must be horizontal or vertical",
        );
      for (let j = 0; j < h; j++)
        for (let i = 0; i < w; i++) {
          if (op.type === "clear") write(x + i, y + j, 0);
          if (
            op.type === "rectangle" &&
            (op.filled || !i || !j || i === w - 1 || j === h - 1)
          )
            write(x + i, y + j, op.color);
          if (op.type === "copy" || op.type === "move")
            write(op.toX + i, op.toY + j, source[(y + j) * doc.width + x + i]);
          if (op.type === "mirror")
            write(
              x + i,
              y + j,
              source[
                (y + (op.axis === "vertical" ? h - j - 1 : j)) * doc.width +
                  x +
                  (op.axis === "horizontal" ? w - i - 1 : i)
              ],
            );
          if (
            op.type === "replace" &&
            source[(y + j) * doc.width + x + i] === op.from
          )
            write(x + i, y + j, op.color);
        }
    }
    return;
  }
  switch (op.type) {
    case "resize": {
      const size = dimensions(op);
      budget(size.width, size.height, doc.frames.length, doc.layers.length);
      requireArt(
        ["preserve", "nearest"].includes(op.fit),
        "FIT",
        "Resize requires preserve or nearest",
      );
      requireArt(
        doc.constraints.protected.length === 0 &&
          !doc.constraints.frameIds &&
          doc.layers.every((l) => !l.locked),
        "PROTECTED",
        "Clear protection and unlock layers before resizing",
      );
      requireArt(
        !doc.ratio || size.width * doc.ratio[1] === size.height * doc.ratio[0],
        "DIMENSIONS",
        "Resize conflicts with locked ratio",
      );
      requireArt(
        op.fit !== "preserve" ||
          op.allowCrop === true ||
          (size.width >= doc.width && size.height >= doc.height),
        "FIT",
        "Cropping requires allowCrop",
      );
      for (const f of doc.frames)
        for (const l of doc.layers) {
          const src = f.cels[l.id],
            out = Array(size.width * size.height).fill(0);
          for (let y = 0; y < size.height; y++)
            for (let x = 0; x < size.width; x++) {
              const sx =
                  op.fit === "nearest"
                    ? Math.floor((x * doc.width) / size.width)
                    : x,
                sy =
                  op.fit === "nearest"
                    ? Math.floor((y * doc.height) / size.height)
                    : y;
              if (sx < doc.width && sy < doc.height)
                out[y * size.width + x] = src[sy * doc.width + sx];
            }
          f.cels[l.id] = out;
        }
      Object.assign(doc, size);
      delete doc.provenance.atlas;
      break;
    }
    case "stamp": {
      const r = doc.references.find((r) => r.id === op.referenceId);
      requireArt(r, "REFERENCE", "Unknown reference");
      requireArt(exactCopyAllowed(r), "REFERENCE_POLICY", `Reference ${r.id} is ${r.role}/${r.policy}; exact stamping requires an explicit production/editable source`);
      rect(r, op.rect);
      rect(doc, [op.x, op.y, op.rect[2], op.rect[3]]);
      const write = writer(doc, op);
      for (let y = 0; y < op.rect[3]; y++)
        for (let x = 0; x < op.rect[2]; x++) {
          const at = ((op.rect[1] + y) * r.width + op.rect[0] + x) * 4,
            rgba = r.rgba.slice(at, at + 4);
          const index =
            rgba[3] === 0
              ? 0
              : doc.palette.findIndex((p, index) => (!doc.palettePolicy || doc.palettePolicy.allowedIndices.includes(index)) && (!doc.constraints.allowedPalette || doc.constraints.allowedPalette.includes(index)) && p.every((v, i) => v === rgba[i]));
          requireArt(
            index >= 0,
            "CONVERSION_REQUIRED",
            "Stamp requires exact palette-compatible source pixels",
          );
          write(op.x + x, op.y + y, index);
        }
      break;
    }
    case "component_move": {
      const pixels = target(doc, op), source = pixels.slice(), write = writer(doc, op);
      requireArt(integer(op.dx) && integer(op.dy) && Math.abs(op.dx) <= doc.width && Math.abs(op.dy) <= doc.height, "COMPONENT", "Component move requires bounded integer dx/dy");
      const component = connectedComponent(doc, source, { x: op.x, y: op.y, region: op.region ?? [0,0,doc.width,doc.height], mode: op.mode ?? "opaque" });
      for (const at of component.indices) { const x = at % doc.width + op.dx, y = Math.floor(at / doc.width) + op.dy; rect(doc, [x,y,1,1]); }
      for (const at of component.indices) write(at % doc.width, Math.floor(at / doc.width), 0);
      for (const at of component.indices) write(at % doc.width + op.dx, Math.floor(at / doc.width) + op.dy, source[at]);
      break;
    }
    case "component_recolor": {
      const pixels = target(doc, op), source = pixels.slice(), write = writer(doc, op);
      const component = connectedComponent(doc, source, { x: op.x, y: op.y, region: op.region ?? [0,0,doc.width,doc.height], mode: op.mode ?? "opaque" });
      requireArt(integer(op.from), "PALETTE", "component_recolor requires from palette index");
      for (const at of component.indices) if (source[at] === op.from) write(at % doc.width, Math.floor(at / doc.width), op.color);
      break;
    }
    case "component_contour": {
      const pixels = target(doc, op), source = pixels.slice(), write = writer(doc, op);
      const component = connectedComponent(doc, source, { x: op.x, y: op.y, region: op.region ?? [0,0,doc.width,doc.height], mode: op.componentMode ?? "opaque" });
      requireArt(["inner", "outer"].includes(op.contour), "COMPONENT", "Contour must be inner or outer");
      for (const at of componentBoundary(doc, component.indices, op.contour)) {
        if (op.contour === "outer" && source[at] !== 0 && op.overwrite !== true) continue;
        write(at % doc.width, Math.floor(at / doc.width), op.color);
      }
      break;
    }
    case "ramp_remap": {
      const pixels = target(doc, op), source = pixels.slice(), write = writer(doc, op);
      requireArt(Array.isArray(op.mapping) && op.mapping.length > 0 && op.mapping.length <= 64 && op.mapping.every(pair => Array.isArray(pair) && pair.length === 2 && pair.every(integer)), "PALETTE", "Ramp remap requires [from,to] palette pairs");
      const mapping = new Map(op.mapping), indices = op.x !== undefined && op.y !== undefined
        ? connectedComponent(doc, source, { x: op.x, y: op.y, region: op.region ?? [0,0,doc.width,doc.height], mode: op.mode ?? "opaque" }).indices
        : (() => { const [x,y,w,h] = rect(doc, op.region ?? [0,0,doc.width,doc.height]); const rows=[]; for(let py=y;py<y+h;py++)for(let px=x;px<x+w;px++)rows.push(py*doc.width+px); return rows; })();
      for (const at of indices) if (mapping.has(source[at])) write(at % doc.width, Math.floor(at / doc.width), mapping.get(source[at]));
      break;
    }
    case "polygon": {
      const write = writer(doc, op);
      for (const at of polygonPixels(doc, op.points)) write(at % doc.width, Math.floor(at / doc.width), op.color);
      break;
    }
    case "add_frame": {
      budget(doc.width, doc.height, doc.frames.length + 1, doc.layers.length);
      const source = op.sourceFrameId
        ? doc.frames.find((f) => f.id === op.sourceFrameId)
        : null;
      requireArt(!op.sourceFrameId || source, "TARGET", "Unknown source frame");
      const f = source
        ? clone(source)
        : {
            anchor: [Math.floor(doc.width / 2), doc.height - 1],
            cels: Object.fromEntries(
              doc.layers.map((l) => [
                l.id,
                Array(doc.width * doc.height).fill(0),
              ]),
            ),
          };
      f.id = op.id;
      const frameIndex = op.beforeFrameId ? doc.frames.findIndex(row => row.id === op.beforeFrameId) : op.afterFrameId ? doc.frames.findIndex(row => row.id === op.afterFrameId) + 1 : doc.frames.length;
      requireArt(frameIndex >= 0 && frameIndex <= doc.frames.length, "TARGET", "Unknown frame insertion point");
      doc.frames.splice(frameIndex, 0, f);
      const cellIndex = op.beforeFrameId ? doc.layout.cells.indexOf(op.beforeFrameId) : op.afterFrameId ? doc.layout.cells.indexOf(op.afterFrameId) + 1 : doc.layout.cells.length;
      requireArt(cellIndex >= 0 && cellIndex <= doc.layout.cells.length, "TARGET", "Unknown layout insertion point");
      doc.layout.cells.splice(cellIndex, 0, f.id);
      doc.kind = "sheet";
      break;
    }
    case "reorder_frames":
      requireArt(
        Array.isArray(op.frameIds) &&
          op.frameIds.length === doc.frames.length &&
          new Set(op.frameIds).size === doc.frames.length &&
          op.frameIds.every((id) => doc.frames.some((f) => f.id === id)),
        "TARGET",
        "Frame order must be a permutation",
      );
      doc.frames = op.frameIds.map((id) => doc.frames.find((f) => f.id === id));
      break;
    case "add_layer":
      requireArt(
        !["__proto__", "constructor", "prototype"].includes(op.id),
        "TARGET",
        "Reserved layer ID",
      );
      budget(doc.width, doc.height, doc.frames.length, doc.layers.length + 1);
      requireArt(
        !doc.layers.some((l) => l.id === op.id) &&
          /^[a-zA-Z0-9_-]{1,80}$/.test(op.id),
        "TARGET",
        "Unique layer ID required",
      );
      doc.layers.push({
        id: op.id,
        name: op.name ?? op.id,
        role: op.role ?? "generic",
        visible: true,
        locked: false,
      });
      doc.frames.forEach(
        (f) => (f.cels[op.id] = Array(doc.width * doc.height).fill(0)),
      );
      break;
    case "layer": {
      const l = doc.layers.find((l) => l.id === op.layerId);
      requireArt(l, "TARGET", "Unknown layer");
      for (const k of ["visible", "locked", "name", "role"])
        if (op[k] !== undefined) l[k] = op[k];
      break;
    }
    case "anchor": {
      const f = doc.frames.find((f) => f.id === op.frameId);
      requireArt(f, "TARGET", "Unknown frame");
      f.anchor = clone(op.anchor);
      break;
    }
    case "clip": {
      const i = doc.clips.findIndex((c) => c.id === op.clip.id);
      if (i < 0) doc.clips.push(clone(op.clip));
      else doc.clips[i] = clone(op.clip);
      break;
    }
    case "layout":
      doc.layout = clone(op.layout);
      break;
    case "constraints":
      doc.constraints = clone(op.constraints);
      break;
    case "palette":
      requireArt(
        !doc.paletteLocks.includes(op.index) &&
          op.index > 0 &&
          op.index < doc.palette.length,
        "LOCKED",
        "Palette entry is locked or invalid",
      );
      doc.palette[op.index] = clone(op.rgba);
      break;
    case "palette_locks":
      doc.paletteLocks = clone(op.indices);
      break;
    case "reference":
      requireArt(
        !doc.references.some((r) => r.id === op.reference.id),
        "REFERENCE",
        "Reference IDs are immutable",
      );
      const reference = normalizeReferenceMetadata(op.reference);
      validateReferenceMetadata(reference);
      doc.references.push(reference);
      break;
    case "style_profile":
      doc.styleProfile = normalizeStyleProfile(op.profile, doc);
      break;
    case "authoring_stage": {
      requireArt(AUTHORING_STAGES.includes(op.stage), "AUTHORING", "Unknown authoring stage");
      const current = AUTHORING_STAGES.indexOf(doc.authoring.stage), next = AUTHORING_STAGES.indexOf(op.stage);
      const lockedMax = Math.max(-1, ...doc.authoring.lockedStages.map(stage => AUTHORING_STAGES.indexOf(stage)));
      requireArt(next > lockedMax || op.stage === doc.authoring.stage, "AUTHORING", "A completed/locked authoring stage cannot be reopened in this candidate");
      doc.authoring.stage = op.stage;
      if (op.lockCompleted === true) for (let i = 0; i < next; i++) if (!doc.authoring.lockedStages.includes(AUTHORING_STAGES[i])) doc.authoring.lockedStages.push(AUTHORING_STAGES[i]);
      if (!doc.authoring.stageHistory.length || doc.authoring.stageHistory.at(-1) !== op.stage) doc.authoring.stageHistory.push(op.stage);
      break;
    }
    case "art_direction":
      doc.artDirection = clone(op.direction);
      break;
    case "palette_policy":
      requireArt(!doc.palettePolicy, "PALETTE_POLICY", "A fixed asset palette cannot be replaced in this draft; create a new document for a different palette");
      doc.palettePolicy = { ...clone(op.policy), colors: clone(doc.palette) };
      break;
    case "handoff": {
      const current = doc.handoff ?? {};
      doc.handoff = { ...current, ...clone(op.handoff ?? {}) };
      break;
    }
    case "brief":
      doc.brief = String(op.brief).slice(0, 20000);
      break;
    default:
      requireArt(false, "OP", `Unknown operation: ${op.type}`);
  }
}
function enforcePreservation(before, after) {
  if (before.palettePolicy) requireArt(
    JSON.stringify(before.palettePolicy) === JSON.stringify(after.palettePolicy),
    "PALETTE_POLICY", "Fixed asset palette contract cannot change during editing");
  for (const index of before.paletteLocks)
    requireArt(
      JSON.stringify(before.palette[index]) ===
        JSON.stringify(after.palette[index]),
      "LOCKED",
      "Palette entry was locked at transaction start",
    );
  for (const f of before.frames)
    for (const l of before.layers) {
      const b = f.cels[l.id],
        a = after.frames.find((x) => x.id === f.id)?.cels[l.id];
      const whole =
        l.locked ||
        (before.constraints.frameIds &&
          !before.constraints.frameIds.includes(f.id));
      const regions = before.constraints.protected.filter(
        (p) => p.frameId === f.id && p.layerId === l.id,
      );
      if (whole || regions.length) {
        requireArt(
          after.layers.find((layer) => layer.id === l.id)?.visible ===
            l.visible,
          "PROTECTED",
          "Transaction changes protected layer visibility",
        );
      }
      if (!whole && !regions.length) continue;
      for (let i = 0; i < b.length; i++) {
        const x = i % before.width,
          y = Math.floor(i / before.width);
        const protectedPixel =
          whole ||
          regions.some(
            (p) =>
              p.frameId === f.id &&
              p.layerId === l.id &&
              x >= p.rect[0] &&
              y >= p.rect[1] &&
              x < p.rect[0] + p.rect[2] &&
              y < p.rect[1] + p.rect[3],
          );
        if (protectedPixel) {
          const responsibleRegion = whole ? null : regions.find((p) => x >= p.rect[0] && y >= p.rect[1] && x < p.rect[0] + p.rect[2] && y < p.rect[1] + p.rect[3]);
          requireArt(
            a?.[i] === b[i] &&
              JSON.stringify(before.palette[b[i]]) ===
                JSON.stringify(after.palette[a[i]]),
            "PROTECTED",
            "Transaction changes protected pixels or their colors",
            { frameId: f.id, layerId: l.id, coordinate: [x, y], protectedRegion: responsibleRegion ? clone(responsibleRegion) : null, wholeLayerProtected: whole },
          );
        }
      }
    }
}

function validateCandidate(before, next, input) {
  normalizeExtended(next);
  validate(next);
  validateExtended(next);
  if (
    ![
      "create", "open", "import-new-image", "import-sheet", "production-import",
      "import-rdx-sprite", "asset-import", "undo", "redo", "restore",
    ].includes(input.action)
  ) enforcePreservation(before, next);
}

function applyOpsToDocument(doc, input, context = {}) {
  requireArt(Array.isArray(input.ops) && input.ops.length > 0 && input.ops.length <= LIMITS.ops, "LIMIT", "Invalid operation count");
  requireArt(input.label === undefined || (typeof input.label === "string" && input.label.length > 0 && input.label.length <= 80), "OP", "Transaction label must be 1–80 characters");
  let work = 0;
  for (let index = 0; index < input.ops.length; index++) {
    const op = input.ops[index];
    work += isAgentOperation(op) ? agentOperationWork(context.snapshot ?? doc, op) : op.type === "pixels"
      ? (op.rows?.reduce((n, row) => n + (row[2]?.length ?? 0), 0) ?? 0)
      : ["fill", "clear", "mirror", "replace", "copy", "move", "rectangle", "stamp", "component_move", "component_recolor", "component_contour", "ramp_remap", "polygon"].includes(op.type)
        ? (op.rect?.[2] ?? doc.width) * (op.rect?.[3] ?? doc.height)
        : op.type === "resize"
          ? op.width * op.height * doc.frames.length * doc.layers.length
          : 0;
    requireArt(work <= 1048576, "LIMIT", "Transaction exceeds decoded work-pixel budget", { operationIndex: index, operationType: op.type });
    try {
      applyOperation(doc, op, context);
    } catch (error) {
      error.details = { ...(error.details ?? {}), operationIndex: index, operationType: op.type };
      throw error;
    }
  }
}

function errorResult(error, revision) {
  return {
    wouldSucceed: false,
    revision,
    error: { code: error.code ?? "INVALID_INPUT", message: error.message, ...(error.details ? { details: clone(error.details) } : {}) },
  };
}

/** Transaction retries are kept for the lifetime of this store, including undo/restore. */
export class ArtStore {
  constructor(doc = createDocument({ width: 24, height: 32 })) {
    this._doc = clone(doc);
    normalizeExtended(this._doc);
    validate(this._doc);
    validateExtended(this._doc);
    this.undoStack = [];
    this.redoStack = [];
    this.checkpoints = new Map();
    this.requests = new Map();
    this.listeners = new Set();
    this.metrics = {
      calls: 0,
      inputBytes: 0,
      mutations: 0,
      retries: 0,
      failures: 0,
      undos: 0,
      views: 0,
      startedAt: Date.now(),
      modelUsage: null,
    };
  }
  get document() {
    return clone(this._doc);
  }
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  transact(input, change, afterValidate = null) {
    this.metrics.calls++;
    const signature = JSON.stringify(input);
    this.metrics.inputBytes += new TextEncoder().encode(signature).length;
    requireArt(
      new TextEncoder().encode(signature).length <= LIMITS.payloadBytes,
      "LIMIT",
      "Request exceeds payload budget",
    );
    requireArt(
      typeof input.requestId === "string" &&
        input.requestId.length > 0 &&
        input.requestId.length <= 100,
      "REQUEST",
      "requestId required",
    );
    const key = `${input.documentId}:${input.requestId}`,
      old = this.requests.get(key);
    if (old) {
      requireArt(
        old.signature === signature,
        "REQUEST_REUSED",
        "Request ID reused with a different payload",
      );
      this.metrics.retries++;
      return clone(old.result);
    }
    requireArt(
      input.documentId === this._doc.id,
      "DOCUMENT",
      "Wrong document ID",
      { documentId: input.documentId, currentDocumentId: this._doc.id },
    );
    requireArt(
      input.expectedRevision === this._doc.revision,
      "STALE_REVISION",
      `Current revision is ${this._doc.revision}`,
      { expectedRevision: input.expectedRevision, currentRevision: this._doc.revision },
    );
    const before = this._doc,
      next = clone(before);
    let transactionDetails = null;
    try {
      change(next);
      validateCandidate(before, next, input);
      transactionDetails = afterValidate ? afterValidate(before, next) : null;
    } catch (e) {
      this.metrics.failures++;
      throw e;
    }
    next.revision = before.revision + 1;
    for (const op of input.ops ?? []) if (op.type === "stamp") {
      const reference = next.references.find(row => row.id === op.referenceId);
      next.provenance.referenceUsage.push({ revision: next.revision, requestId: input.requestId, referenceId: op.referenceId, role: reference?.role ?? null, policy: reference?.policy ?? null, operation: "exact-stamp", sourceRect: clone(op.rect), target: [op.x, op.y] });
    }
    next.provenance.commands.push({
      revision: next.revision,
      requestId: input.requestId,
      kind: input.action ?? "apply_ops",
      label: input.label ?? null,
      ops: input.ops ?? null,
    });
    // Bound snapshot history by both count and decoded storage; projects retain the command log.
    this.undoStack.push(before);
    const weight = (d) =>
      d.width * d.height * d.frames.length * d.layers.length +
      d.references.reduce((n, r) => n + r.rgba.length, 0);
    while (
      this.undoStack.length > 30 ||
      this.undoStack.reduce((n, d) => n + weight(d), 0) > 32000000
    )
      this.undoStack.shift();
    this.redoStack = [];
    this._doc = next;
    this.metrics.mutations++;
    const legacyDelta = changedPixels(before, next),
      summary = transactionDetails?.delta
        ? { changedPixels: transactionDetails.delta.changedPixels, bounds: transactionDetails.delta.bounds }
        : legacyDelta;
    const result = {
      documentId: next.id,
      revision: next.revision,
      ...summary,
      ...(transactionDetails ?? {}),
    };
    this.requests.set(key, { signature, result });
    this.listeners.forEach((fn) => fn(result));
    return clone(result);
  }
  apply(input, { handleResolver = null } = {}) {
    requireArt(input.action === undefined, "OP", "Drawing transactions cannot override lifecycle actions");
    return this.transact(
      input,
      (doc) => applyOpsToDocument(doc, input, { snapshot: this._doc, checkpointResolver: (name) => this.checkpoints.get(name) ?? null, handleResolver }),
      (before, next) => {
        const delta = documentDelta(before, next);
        const warnings = input.assertions?.noNewWarnings ? warningDelta(before, next) : null;
        assertTransaction(before, next, input.assertions, { checkpoints: this.checkpoints, handleResolver, delta, warnings });
        return { delta, ...(warnings ? { warnings } : {}) };
      },
    );
  }
  simulate(input, { handleResolver = null } = {}) {
    const before = this._doc;
    try {
      const signature = JSON.stringify(input);
      requireArt(new TextEncoder().encode(signature).length <= LIMITS.payloadBytes, "LIMIT", "Request exceeds payload budget");
      requireArt(input.action === undefined, "OP", "Simulation accepts drawing operations only");
      requireArt(input.documentId === before.id, "DOCUMENT", "Wrong document ID", { documentId: input.documentId, currentDocumentId: before.id });
      requireArt(input.expectedRevision === before.revision, "STALE_REVISION", `Current revision is ${before.revision}`, { currentRevision: before.revision, expectedRevision: input.expectedRevision });
      const next = clone(before);
      applyOpsToDocument(next, input, { snapshot: before, checkpointResolver: (name) => this.checkpoints.get(name) ?? null, handleResolver });
      validateCandidate(before, next, input);
      const delta = documentDelta(before, next), warnings = warningDelta(before, next);
      assertTransaction(before, next, input.assertions, { checkpoints: this.checkpoints, handleResolver, delta, warnings });
      return {
        wouldSucceed: true,
        documentId: before.id,
        revision: before.revision,
        prospectiveRevision: before.revision + 1,
        changedPixels: delta.changedPixels,
        bounds: delta.bounds,
        delta,
        warnings,
      };
    } catch (error) {
      return errorResult(error, before.revision);
    }
  }
  history(input) {
    if (input.action === "checkpoint")
      return this.transact(input, (d) => {
        requireArt(
          typeof input.name === "string" &&
            input.name.length > 0 &&
            input.name.length <= 80,
          "HISTORY",
          "Checkpoint name required",
        );
        requireArt(
          this.checkpoints.size < 8 || this.checkpoints.has(input.name),
          "LIMIT",
          "Maximum eight checkpoints",
        );
      });
    const key = `${input.documentId}:${input.requestId}`;
    if (this.requests.has(key)) return this.transact(input, () => {});
    const source =
      input.action === "undo"
        ? this.undoStack
        : input.action === "redo"
          ? this.redoStack
          : null;
    const saved =
      input.action === "restore"
        ? this.checkpoints.get(input.name)
        : source?.at(-1);
    requireArt(saved, "HISTORY", "Nothing available to undo, redo or restore");
    const before = this._doc,
      undo = this.undoStack.slice(),
      redo = this.redoStack.slice();
    const result = this.transact(input, (d) => {
      Object.assign(d, clone(saved), {
        id: before.id,
        revision: before.revision,
      });
    });
    if (input.action === "undo") {
      this.undoStack = undo.slice(0, -1);
      this.redoStack = [...redo, before];
      this.metrics.undos++;
    }
    if (input.action === "redo") {
      this.undoStack = [...undo, before];
      this.redoStack = redo.slice(0, -1);
    }
    return result;
  }
  checkpoint(input) {
    const retry = this.requests.has(`${input.documentId}:${input.requestId}`);
    const result = this.history({ ...input, action: "checkpoint" });
    if (!retry) this.checkpoints.set(input.name, clone(this._doc));
    return result;
  }
}
