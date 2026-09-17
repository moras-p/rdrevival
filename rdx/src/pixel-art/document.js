import { DIRECTION_FIELDS } from "./direction.js";
/** Indexed authoring authority. No DOM, gameplay, filesystem or network access. */
export const LIMITS = Object.freeze({
  width: 512,
  height: 512,
  frames: 128,
  layers: 8,
  palette: 256,
  celPixels: 16000000,
  ops: 2048,
  patchPixels: 262144,
  payloadBytes: 2000000,
  projectBytes: 40000000,
});
export const DEFAULT_PALETTE = [
  [0, 0, 0, 0],
  [24, 28, 39, 255],
  [55, 65, 82, 255],
  [94, 110, 118, 255],
  [171, 188, 178, 255],
  [244, 239, 211, 255],
  [66, 86, 53, 255],
  [106, 135, 70, 255],
  [181, 187, 95, 255],
  [102, 56, 48, 255],
  [172, 83, 54, 255],
  [226, 139, 73, 255],
  [249, 201, 111, 255],
  [62, 88, 130, 255],
  [104, 155, 177, 255],
  [173, 211, 215, 255],
];
export class ArtError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.code = code;
    if (details && typeof details === "object") this.details = details;
  }
}
export function requireArt(ok, code, message, details = null) {
  if (!ok) throw new ArtError(code, message, details);
}
export const clone = (value) => structuredClone(value);
const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const id = (v) =>
  typeof v === "string" &&
  /^[a-zA-Z0-9_-]{1,80}$/.test(v) &&
  !["__proto__", "constructor", "prototype"].includes(v);
export function dimensions({ width, height, ratio }) {
  if (ratio) {
    requireArt(
      Array.isArray(ratio) &&
        ratio.length === 2 &&
        ratio.every((v) => int(v, 1, 512)),
      "DIMENSIONS",
      "Ratio requires two positive integers",
    );
    if (width === undefined && height !== undefined)
      width = (height * ratio[0]) / ratio[1];
    if (height === undefined && width !== undefined)
      height = (width * ratio[1]) / ratio[0];
    requireArt(
      width * ratio[1] === height * ratio[0],
      "DIMENSIONS",
      "Exact dimensions conflict with aspect ratio",
    );
  }
  requireArt(
    int(width, 1, LIMITS.width) && int(height, 1, LIMITS.height),
    "DIMENSIONS",
    "Frame dimensions must be integers from 1 to 512",
  );
  return { width, height };
}
export function budget(width, height, frames, layers) {
  requireArt(
    int(frames, 1, LIMITS.frames) &&
      int(layers, 1, LIMITS.layers) &&
      width * height * frames * layers <= LIMITS.celPixels,
    "LIMIT",
    "Document exceeds frame, layer or cel-pixel budget",
  );
}
export function createDocument(options = {}) {
  const { width, height } = dimensions(options),
    count = options.frameCount ?? 1;
  budget(width, height, count, 1);
  const palette = clone(options.palette ?? DEFAULT_PALETTE),
    transparentIndex = 0;
  const doc = {
    schemaVersion: 1,
    id: options.id ?? "art",
    revision: 0,
    kind: count === 1 ? "image" : "sheet",
    width,
    height,
    ratio: options.ratio ?? null,
    brief: options.brief ?? "",
    artDirection: clone(options.artDirection ?? {}),
    styleProfile: clone(options.styleProfile ?? null),
    authoring: clone(options.authoring ?? { stage: "silhouette", lockedStages: [], stageHistory: [] }),
    palettePolicy: clone(options.palettePolicy ?? null),
    profile: options.profile ?? "indexed-mask-v1",
    palette,
    transparentIndex,
    paletteLocks: [],
    layers: [{ id: "ink", name: "Ink", role: "silhouette/base", visible: true, locked: false }],
    frames: [],
    clips: [],
    references: [],
    constraints: { protected: [], frameIds: null, allowedPalette: null },
    layout: {
      columns: options.columns ?? count,
      marginX: 0,
      marginY: 0,
      gapX: 0,
      gapY: 0,
      cells: [],
    },
    provenance: { commands: [], binding: null, referenceUsage: [], candidate: null },
  };
  for (let n = 0; n < count; n++) {
    const frameId = `frame-${n + 1}`;
    doc.frames.push({
      id: frameId,
      anchor: clone(options.anchor ?? [Math.floor(width / 2), height - 1]),
      cels: {
        ink: Array(width * height).fill(
          options.background === "opaque" ? 1 : 0,
        ),
      },
    });
    doc.layout.cells.push(frameId);
  }
  doc.clips = [
    {
      id: "default",
      frameIds: doc.frames.map((f) => f.id),
      durations: doc.frames.map(() => 100),
      direction: "forward",
      loop: "loop",
    },
  ];
  validate(doc);
  return doc;
}
export function rect(doc, r) {
  requireArt(
    Array.isArray(r) &&
      r.length === 4 &&
      r.every(Number.isInteger) &&
      r[0] >= 0 &&
      r[1] >= 0 &&
      r[2] > 0 &&
      r[3] > 0 &&
      r[0] + r[2] <= doc.width &&
      r[1] + r[3] <= doc.height,
    "BOUNDS",
    "Rectangle must be within the frame",
  );
  return r;
}
export function sheetGeometry(doc) {
  const l = doc.layout,
    rows = Math.ceil(l.cells.length / l.columns);
  return {
    width: 2 * l.marginX + l.columns * doc.width + (l.columns - 1) * l.gapX,
    height: 2 * l.marginY + rows * doc.height + (rows - 1) * l.gapY,
    rows,
  };
}
export function validate(doc) {
  requireArt(
    doc?.schemaVersion === 1 &&
      id(doc.id) &&
      int(doc.revision, 0, Number.MAX_SAFE_INTEGER),
    "PROJECT",
    "Invalid document identity/version/revision",
  );
  validateDirection(doc.artDirection ?? {});
  dimensions(doc);
  budget(doc.width, doc.height, doc.frames?.length, doc.layers?.length);
  requireArt(
    Array.isArray(doc.palette) &&
      int(doc.palette.length, 2, 256) &&
      doc.transparentIndex === 0,
    "PALETTE",
    "Expected 2–256 colors and transparent index zero",
  );
  doc.palette.forEach((p, i) =>
    requireArt(
      Array.isArray(p) &&
        p.length === 4 &&
        p.slice(0, 3).every((v) => int(v, 0, 255)) &&
        p[3] === (i === 0 ? 0 : 255),
      "PALETTE",
      "Masked profile requires transparent zero and opaque RGB entries",
    ),
  );
  if (doc.palettePolicy) {
    const p = doc.palettePolicy;
    requireArt(typeof p.name === "string" && p.name.length <= 200 &&
      typeof p.source === "string" && p.source.length <= 1000 &&
      int(p.maxColors, 1, 256) && Array.isArray(p.allowedIndices) &&
      p.allowedIndices.includes(0) && p.allowedIndices.every(v => int(v, 0, doc.palette.length - 1)) &&
      new Set(p.allowedIndices).size === p.allowedIndices.length &&
      JSON.stringify(p.colors) === JSON.stringify(doc.palette),
      "PALETTE_POLICY", "Fixed palette contract must retain exact colors and valid allowed indices (including transparency)");
    for (const f of doc.frames) {
      const used = new Set();
      for (const cel of Object.values(f.cels)) for (const v of cel) {
        requireArt(p.allowedIndices.includes(v), "PALETTE_POLICY", "Pixel is outside the asset palette contract");
        used.add(v);
      }
      used.delete(0);
      requireArt(used.size <= p.maxColors, "PALETTE_POLICY", "Frame exceeds opaque color budget");
    }
  }
  for (const entries of [doc.frames, doc.layers])
    requireArt(
      entries.every((x) => id(x.id)) &&
        new Set(entries.map((x) => x.id)).size === entries.length,
      "PROJECT",
      "IDs must be unique",
    );
  requireArt(
    Array.isArray(doc.paletteLocks) &&
      doc.paletteLocks.every((v) => int(v, 0, doc.palette.length - 1)),
    "PALETTE",
    "Invalid palette locks",
  );
  doc.layers.forEach((l) =>
    requireArt(
      typeof l.visible === "boolean" && typeof l.locked === "boolean",
      "PROJECT",
      "Invalid layer flags",
    ),
  );
  doc.frames.forEach((f) => {
    requireArt(
      Array.isArray(f.anchor) &&
        f.anchor.length === 2 &&
        f.anchor.every((v) => int(v, -4096, 4096)),
      "ANCHOR",
      "Invalid integer anchor",
    );
    requireArt(
      f.cels && Object.keys(f.cels).length === doc.layers.length,
      "PROJECT",
      "Cel/layer mismatch",
    );
    doc.layers.forEach((l) =>
      requireArt(
        Array.isArray(f.cels[l.id]) &&
          f.cels[l.id].length === doc.width * doc.height &&
          f.cels[l.id].every((v) => int(v, 0, doc.palette.length - 1)),
        "PIXELS",
        "Invalid cel pixels",
      ),
    );
  });
  const frameIds = new Set(doc.frames.map((f) => f.id)),
    l = doc.layout;
  requireArt(
    l &&
      int(l.columns, 1, 128) &&
      ["marginX", "marginY", "gapX", "gapY"].every((k) => int(l[k], 0, 512)) &&
      Array.isArray(l.cells) &&
      int(l.cells.length, 1, 16384) &&
      l.cells.every((v) => v === null || frameIds.has(v)),
    "LAYOUT",
    "Malformed sheet layout",
  );
  const occupied = l.cells.filter((v) => v !== null);
  requireArt(
    occupied.length === frameIds.size &&
      new Set(occupied).size === frameIds.size,
    "LAYOUT",
    "Every frame must appear exactly once; blank cells use null",
  );
  const size = sheetGeometry(doc);
  requireArt(
    size.width * size.height <= LIMITS.celPixels &&
      size.width <= 16384 &&
      size.height <= 16384,
    "LIMIT",
    "Sheet exceeds export budget",
  );
  requireArt(
    Array.isArray(doc.clips) && doc.clips.length <= 128,
    "CLIP",
    "Invalid clips",
  );
  const clipIds = new Set();
  doc.clips.forEach((c) => {
    requireArt(
      id(c.id) &&
        !clipIds.has(c.id) &&
        Array.isArray(c.frameIds) &&
        int(c.frameIds.length, 1, 1024) &&
        c.frameIds.every((v) => frameIds.has(v)) &&
        Array.isArray(c.durations) &&
        c.durations.length === c.frameIds.length &&
        c.durations.every((v) => int(v, 1, 60000)) &&
        ["forward", "reverse", "ping-pong"].includes(c.direction) &&
        ["loop", "once"].includes(c.loop),
      "CLIP",
      "Invalid clip IDs, order or timing",
    );
    clipIds.add(c.id);
  });
  const c = doc.constraints;
  requireArt(
    c && Array.isArray(c.protected) && c.protected.length <= 1024,
    "CONSTRAINT",
    "Invalid protected regions",
  );
  requireArt(
    c.frameIds === null ||
      (Array.isArray(c.frameIds) && c.frameIds.every((f) => frameIds.has(f))),
    "CONSTRAINT",
    "Invalid scoped frames",
  );
  requireArt(
    c.allowedPalette === null ||
      (Array.isArray(c.allowedPalette) &&
        c.allowedPalette.every((v) => int(v, 0, doc.palette.length - 1))),
    "CONSTRAINT",
    "Invalid allowed palette",
  );
  c.protected.forEach((p) => {
    requireArt(
      frameIds.has(p.frameId) && doc.layers.some((l) => l.id === p.layerId),
      "CONSTRAINT",
      "Invalid protected target",
    );
    rect(doc, p.rect);
  });
  requireArt(
    Array.isArray(doc.references) &&
      doc.references.length <= 16 &&
      doc.references.every(
        (r) =>
          id(r.id) &&
          typeof r.hash === "string" &&
          Array.isArray(r.rgba) &&
          int(r.width, 1, 4096) &&
          int(r.height, 1, 4096) &&
          r.width * r.height <= LIMITS.celPixels &&
          r.rgba.length === r.width * r.height * 4 &&
          r.rgba.every((v) => int(v, 0, 255)),
      ),
    "REFERENCE",
    "Invalid reference",
  );
  requireArt(
    doc.references.reduce((n, r) => n + r.width * r.height, 0) <=
      LIMITS.celPixels,
    "LIMIT",
    "Reference budget exceeded",
  );
  requireArt(
    new Set(doc.references.map((r) => r.id)).size === doc.references.length,
    "REFERENCE",
    "Reference IDs must be unique",
  );
  const atlas = doc.provenance?.atlas;
  if (atlas) {
    requireArt(
      int(atlas.width, 1, 4096) &&
        int(atlas.height, 1, 4096) &&
        atlas.width * atlas.height <= LIMITS.celPixels &&
        Array.isArray(atlas.rgba) &&
        atlas.rgba.length === atlas.width * atlas.height * 4 &&
        atlas.rgba.every((v) => int(v, 0, 255)) &&
        Array.isArray(atlas.rectangles) &&
        atlas.rectangles.length <= 128,
      "LAYOUT",
      "Invalid preserved atlas",
    );
    atlas.rectangles.forEach((r) => rect(atlas, r.rect));
  }
  requireArt(
    doc.provenance && Array.isArray(doc.provenance.commands),
    "PROJECT",
    "Missing provenance",
  );
  return doc;
}
export function composite(doc, frameId) {
  const f = doc.frames.find((f) => f.id === frameId);
  requireArt(f, "TARGET", "Unknown frame");
  const pixels = Array(doc.width * doc.height).fill(0);
  for (const l of doc.layers)
    if (l.visible)
      f.cels[l.id].forEach((p, i) => {
        if (p !== 0) pixels[i] = p;
      });
  return pixels;
}
export function changedPixels(before, after) {
  let count = 0,
    bounds = null;
  for (const f of after.frames)
    for (const l of after.layers) {
      const a = before.frames.find((x) => x.id === f.id)?.cels[l.id],
        b = f.cels[l.id];
      b.forEach((p, i) => {
        const oldIndex = a?.[i] ?? 0;
        if (
          p !== oldIndex ||
          JSON.stringify(before.palette[oldIndex]) !==
            JSON.stringify(after.palette[p])
        ) {
          count++;
          const x = i % after.width,
            y = Math.floor(i / after.width);
          bounds = bounds
            ? [
                Math.min(bounds[0], x),
                Math.min(bounds[1], y),
                Math.max(bounds[2], x),
                Math.max(bounds[3], y),
              ]
            : [x, y, x, y];
        }
      });
    }
  return {
    changedPixels: count,
    bounds: bounds
      ? [
          bounds[0],
          bounds[1],
          bounds[2] - bounds[0] + 1,
          bounds[3] - bounds[1] + 1,
        ]
      : null,
  };
}
export function encodeProject(doc) {
  const copy = clone(doc);
  for (const f of copy.frames)
    for (const l of copy.layers) {
      const src = f.cels[l.id],
        runs = [];
      for (const p of src) {
        if (runs.length && runs.at(-1)[0] === p) runs.at(-1)[1]++;
        else runs.push([p, 1]);
      }
      f.cels[l.id] = { rle: runs };
    }
  return JSON.stringify(copy);
}
export function decodeProject(text) {
  requireArt(
    typeof text === "string" && text.length <= LIMITS.projectBytes,
    "LIMIT",
    "Project is too large",
  );
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new ArtError("PROJECT", "Invalid JSON");
  }
  dimensions(doc);
  budget(doc.width, doc.height, doc.frames?.length, doc.layers?.length);
  for (const f of doc.frames)
    for (const l of doc.layers) {
      const runs = f.cels?.[l.id]?.rle;
      requireArt(
        Array.isArray(runs) && runs.length <= doc.width * doc.height,
        "PROJECT",
        "Missing bounded RLE",
      );
      let n = 0;
      for (const r of runs) {
        requireArt(
          Array.isArray(r) &&
            r.length === 2 &&
            int(r[0], 0, 255) &&
            int(r[1], 1, doc.width * doc.height),
          "PROJECT",
          "Invalid run",
        );
        n += r[1];
      }
      requireArt(n === doc.width * doc.height, "PROJECT", "RLE size mismatch");
      f.cels[l.id] = runs.flatMap(([p, n]) => Array(n).fill(p));
    }
  return validate(doc);
}

export function validateDirection(direction) {
  requireArt(direction && typeof direction === 'object' && !Array.isArray(direction) &&
    Object.keys(direction).every(k => DIRECTION_FIELDS.includes(k)) &&
    Object.values(direction).every(v => typeof v === 'string' && v.length <= 4000),
  'DIRECTION', 'Art direction requires bounded text fields: target, intent, preserve, referenceNotes, acceptance');
}
