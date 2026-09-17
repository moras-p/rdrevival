import {
  LIMITS,
  requireArt,
  createDocument,
  validate,
  composite,
  sheetGeometry,
  rect,
} from "./document.js";
export async function sha256(bytes) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes,
  );
  return [...new Uint8Array(hash)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
export function rgbaPixels(doc, frameId) {
  return Uint8ClampedArray.from(
    composite(doc, frameId).flatMap((p) => doc.palette[p]),
  );
}
/** Explicit nearest-neighbor fit; exact mode rejects any incompatible color. */
export function convertImage(
  image,
  {
    width,
    height,
    palette,
    fit = "preserve",
    quantize = false,
    allowedIndices,
    offsetX = 0,
    offsetY = 0,
  },
) {
  requireArt(
    ["preserve", "contain", "cover", "stretch"].includes(fit),
    "FIT",
    "Explicit valid fit policy required",
  );
  requireArt(
    Number.isInteger(offsetX) && Number.isInteger(offsetY),
    "FIT",
    "Offsets must be integers",
  );
  const allowed = allowedIndices ?? palette.map((_, i) => i);
  requireArt(allowed.includes(0) && allowed.some(i => i > 0) && allowed.every(i => Number.isInteger(i) && palette[i]), "PALETTE", "Conversion requires valid allowed indices and an opaque color");
  const sw = image.width,
    sh = image.height;
  requireArt(
    sw > 0 &&
      sh > 0 &&
      sw * sh <= LIMITS.celPixels &&
      image.rgba.length === sw * sh * 4,
    "IMAGE",
    "Invalid source pixels",
  );
  let rw = width,
    rh = height;
  if (fit === "preserve") {
    rw = sw;
    rh = sh;
    requireArt(
      offsetX >= 0 &&
        offsetY >= 0 &&
        offsetX + sw <= width &&
        offsetY + sh <= height,
      "FIT",
      "Preserve mode cannot crop source pixels",
    );
  }
  if (fit === "contain" || fit === "cover") {
    const scale = (fit === "contain" ? Math.min : Math.max)(
      width / sw,
      height / sh,
    );
    rw = Math.max(1, Math.round(sw * scale));
    rh = Math.max(1, Math.round(sh * scale));
  }
  const ox =
      fit === "preserve" ? offsetX : Math.floor((width - rw) / 2) + offsetX,
    oy = fit === "preserve" ? offsetY : Math.floor((height - rh) / 2) + offsetY;
  const pixels = Array(width * height).fill(0),
    cache = new Map();
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (x < ox || y < oy || x >= ox + rw || y >= oy + rh) continue;
      const sx = Math.min(sw - 1, Math.floor(((x - ox) * sw) / rw)),
        sy = Math.min(sh - 1, Math.floor(((y - oy) * sh) / rh));
      const rgba = image.rgba.slice((sy * sw + sx) * 4, (sy * sw + sx) * 4 + 4),
        key = rgba.join(",");
      let index = cache.get(key);
      if (index === undefined) {
        index =
          rgba[3] === 0
            ? 0
            : palette.findIndex((p, index) => allowed.includes(index) && p.every((v, i) => v === rgba[i]));
        if (index < 0) {
          requireArt(
            quantize,
            "CONVERSION_REQUIRED",
            "Source color is outside palette; choose explicit quantization or reference-only",
          );
          index =
            rgba[3] < 128
              ? 0
              : palette.reduce(
                  (best, p, i) =>
                    i === 0 || !allowed.includes(i)
                      ? best
                      : rgba
                            .slice(0, 3)
                            .reduce((s, v, k) => s + (v - p[k]) ** 2, 0) <
                          rgba
                            .slice(0, 3)
                            .reduce(
                              (s, v, k) => s + (v - palette[best][k]) ** 2,
                              0,
                            )
                        ? i
                        : best,
                  allowed.find(i => i > 0),
                );
        }
        cache.set(key, index);
      }
      pixels[y * width + x] = index;
    }
  return {
    pixels,
    transform: {
      fit,
      quantize,
      offsetX: ox,
      offsetY: oy,
      renderWidth: rw,
      renderHeight: rh,
      sourceWidth: sw,
      sourceHeight: sh,
    },
  };
}
export function sliceSheet(image, options) {
  const { width, height } = options;
  const palette = options.palette;
  let layout = options.layout,
    rectangles = options.rectangles;
  requireArt(
    layout || rectangles,
    "SLICING_REQUIRED",
    "Provide occupied cells or explicit frame rectangles",
  );
  if (!rectangles) {
    requireArt(
      layout && Array.isArray(layout.cells),
      "LAYOUT",
      "Explicit cells including blanks required",
    );
    const columns = layout.columns;
    rectangles = layout.cells.flatMap((id, n) =>
      id === null
        ? []
        : [
            {
              id,
              rect: [
                layout.marginX + (n % columns) * (width + layout.gapX),
                layout.marginY +
                  Math.floor(n / columns) * (height + layout.gapY),
                width,
                height,
              ],
            },
          ],
    );
  }
  requireArt(
    rectangles.length > 0 && rectangles.length <= 128,
    "LIMIT",
    "Invalid slice count",
  );
  for (let i = 0; i < rectangles.length; i++) {
    rect({ width: image.width, height: image.height }, rectangles[i].rect);
    const a = rectangles[i].rect;
    for (let j = 0; j < i; j++) {
      const b = rectangles[j].rect;
      requireArt(
        a[0] + a[2] <= b[0] ||
          b[0] + b[2] <= a[0] ||
          a[1] + a[3] <= b[1] ||
          b[1] + b[3] <= a[1],
        "LAYOUT",
        "Frame rectangles must not overlap",
      );
    }
  }
  const d = createDocument({
    ...options,
    frameCount: rectangles.length,
    palette,
  });
  const imageRect = { width: image.width, height: image.height };
  d.frames = rectangles.map((r, n) => {
    rect(imageRect, r.rect);
    requireArt(
      r.rect[2] === width && r.rect[3] === height,
      "SLICING",
      "Frames must share exact dimensions",
    );
    const rgba = [];
    for (let y = 0; y < height; y++)
      rgba.push(
        ...image.rgba.slice(
          ((r.rect[1] + y) * image.width + r.rect[0]) * 4,
          ((r.rect[1] + y) * image.width + r.rect[0] + width) * 4,
        ),
      );
    return {
      id: r.id,
      anchor: r.anchor ?? [Math.floor(width / 2), height - 1],
      cels: {
        ink: convertImage(
          { width, height, rgba },
          {
            width,
            height,
            palette: d.palette,
            allowedIndices: options.allowedIndices,
            quantize: options.quantize === true,
          },
        ).pixels,
      },
    };
  });
  d.layout = layout ?? {
    columns: d.frames.length,
    marginX: 0,
    marginY: 0,
    gapX: 0,
    gapY: 0,
    cells: d.frames.map((f) => f.id),
  };
  if (layout) {
    const size = sheetGeometry(d);
    requireArt(
      size.width === image.width && size.height === image.height,
      "LAYOUT",
      "Slicing layout does not cover the exact source sheet",
    );
  }
  d.clips = options.clips ?? [
    {
      id: "default",
      frameIds: d.frames.map((f) => f.id),
      durations: d.frames.map(() => 100),
      direction: "forward",
      loop: "loop",
    },
  ];
  d.provenance.sourceRectangles = rectangles;
  const sourceIndices = convertImage(image, {
    width: image.width,
    height: image.height,
    palette: d.palette,
            allowedIndices: options.allowedIndices,
    fit: "preserve",
    quantize: options.quantize === true,
  }).pixels;
  d.provenance.atlas = {
    width: image.width,
    height: image.height,
    rectangles,
    rgba: sourceIndices.flatMap((index) => d.palette[index]),
    layout: JSON.stringify(d.layout),
  };
  return validate(d);
}
export function exportSheet(doc) {
  const atlas =
      doc.provenance.atlas?.layout === JSON.stringify(doc.layout)
        ? doc.provenance.atlas
        : null,
    geometry = atlas ?? sheetGeometry(doc),
    { width, height } = geometry;
  requireArt(
    width * height <= LIMITS.celPixels,
    "LIMIT",
    "Export exceeds pixel budget",
  );
  const rgba = atlas?.rgba
      ? new Uint8ClampedArray(atlas.rgba)
      : new Uint8ClampedArray(width * height * 4),
    frames = [];
  for (const f of doc.frames) {
    const n = doc.layout.cells.indexOf(f.id),
      l = doc.layout;
    const r = atlas?.rectangles.find((r) => r.id === f.id)?.rect ?? [
      l.marginX + (n % l.columns) * (doc.width + l.gapX),
      l.marginY + Math.floor(n / l.columns) * (doc.height + l.gapY),
      doc.width,
      doc.height,
    ];
    const pixels = rgbaPixels(doc, f.id);
    for (let y = 0; y < doc.height; y++)
      rgba.set(
        pixels.subarray(y * doc.width * 4, (y + 1) * doc.width * 4),
        ((r[1] + y) * width + r[0]) * 4,
      );
    frames.push({ id: f.id, rect: r, anchor: f.anchor });
  }
  return {
    width,
    height,
    rgba,
    metadata: {
      schemaVersion: 1,
      documentId: doc.id,
      revision: doc.revision,
      width,
      height,
      frameWidth: doc.width,
      frameHeight: doc.height,
      frames,
      layout: doc.layout,
      clips: doc.clips,
      palette: doc.palette,
      palettePolicy: doc.palettePolicy ?? null,
      artDirection: doc.artDirection ?? {},
      provenance: doc.provenance.asset ?? null,
    },
  };
}
export async function readImageFile(file) {
  requireArt(file.size <= 20000000, "LIMIT", "Image file exceeds 20 MB");
  const bytes = await file.arrayBuffer(),
    bitmap = await createImageBitmap(new Blob([bytes], { type: file.type }));
  try {
    requireArt(
      bitmap.width <= 4096 &&
        bitmap.height <= 4096 &&
        bitmap.width * bitmap.height <= LIMITS.celPixels,
      "LIMIT",
      "Image dimensions exceed import limits",
    );
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    return {
      width: bitmap.width,
      height: bitmap.height,
      rgba: Array.from(
        ctx.getImageData(0, 0, bitmap.width, bitmap.height).data,
      ),
      hash: await sha256(bytes),
      name: file.name,
    };
  } finally {
    bitmap.close();
  }
}
export function imageCanvas(width, height, rgba) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas
    .getContext("2d")
    .putImageData(
      new ImageData(new Uint8ClampedArray(rgba), width, height),
      0,
      0,
    );
  return canvas;
}
export async function pngBlob(width, height, rgba) {
  return new Promise((resolve, reject) =>
    imageCanvas(width, height, rgba).toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("PNG encoding failed")),
      "image/png",
    ),
  );
}

export function paletteFromImage(image) {
  const palette = [[0, 0, 0, 0]],
    seen = new Set(["0,0,0,0"]);
  for (let n = 0; n < image.rgba.length; n += 4) {
    const p = image.rgba.slice(n, n + 4);
    if (p[3] === 0) continue;
    requireArt(
      p[3] === 255,
      "CONVERSION_REQUIRED",
      "Source palette requires binary alpha; use explicit quantization for partial alpha",
    );
    const key = p.join(",");
    if (!seen.has(key)) {
      requireArt(
        palette.length < 256,
        "CONVERSION_REQUIRED",
        "Source has more than 255 opaque colors",
      );
      seen.add(key);
      palette.push(p);
    }
  }
  if (palette.length === 1) palette.push([0, 0, 0, 255]);
  return palette;
}
