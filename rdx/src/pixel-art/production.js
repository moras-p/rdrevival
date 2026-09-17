import { createDocument, requireArt, composite } from "./document.js";
import { sha256 } from "./image-io.js";
export const BOILING_CROWN = {
  source: "revival/data/graphics/dynamite_revival_blast_pixels.txt",
  generator: "tools/rdx/generate_revival_dynamite.py",
  width: 56,
  height: 32,
  anchor: [28, 24],
  holds: [1, 1, 1, 1, 1, 2, 2],
  codes: { ".": 0, W: 2, Y: 15, O: 4, R: 10, r: 11, d: 12, G: 6, g: 7, D: 13 },
  palette: [
    [0, 0, 0, 0],
    [0, 109, 0, 255],
    [255, 255, 255, 255],
    [219, 219, 219, 255],
    [255, 109, 0, 255],
    [255, 146, 109, 255],
    [146, 146, 146, 255],
    [109, 109, 109, 255],
    [182, 109, 73, 255],
    [146, 73, 36, 255],
    [182, 73, 0, 255],
    [146, 73, 0, 255],
    [73, 36, 0, 255],
    [36, 36, 36, 255],
    [0, 0, 0, 255],
    [255, 182, 36, 255],
  ],
};
export async function importProduction(text) {
  const c = BOILING_CROWN,
    lines = text.split("\n"),
    frames = [],
    rowLines = [];
  let active = -1;
  lines.forEach((line, n) => {
    if (/^FRAME [1-7]$/.test(line)) {
      requireArt(
        Number(line.slice(6)) === frames.length + 1,
        "ADAPTER",
        "Expected seven ordered FRAME sections",
      );
      active = frames.length;
      frames.push([]);
    } else if (line && !line.startsWith("#")) {
      requireArt(
        active >= 0 &&
          line.length === c.width &&
          [...line].every((p) => p in c.codes),
        "ADAPTER",
        "Invalid authored grid",
      );
      frames[active].push(...[...line].map((p) => c.codes[p]));
      rowLines.push(n);
    }
  });
  requireArt(
    frames.length === 7 && frames.every((p) => p.length === c.width * c.height),
    "ADAPTER",
    "Expected seven 56×32 cels",
  );
  const doc = createDocument({
    id: "boiling-crown",
    width: 56,
    height: 32,
    frameCount: 7,
    columns: 7,
    anchor: c.anchor,
    palette: c.palette,
    profile: "boiling-crown-v1",
  });
  frames.forEach((p, i) => (doc.frames[i].cels.ink = p));
  doc.clips[0].durations = c.holds.map((n) => n * 40);
  doc.clips[0].loop = "once";
  doc.palettePolicy = { name: "Boiling Crown", source: c.source, colors: structuredClone(c.palette), allowedIndices: Object.values(c.codes), maxColors: Object.keys(c.codes).length - 1 };
  doc.paletteLocks = doc.palette.map((_, i) => i);
  doc.constraints.allowedPalette = Object.values(c.codes);
  doc.provenance.binding = {
    adapter: "boiling-crown-v1",
    source: c.source,
    sourceHash: await sha256(text),
    sourceText: text,
    rowLines,
    frameIds: doc.frames.map((f) => f.id),
    nativeHolds: c.holds,
    authoringTickMs: 40,
    productionPreview: "native-action:dynamite.explode",
  };
  return doc;
}
export async function exportProduction(doc) {
  const c = BOILING_CROWN,
    b = doc.provenance.binding;
  requireArt(
    b?.adapter === "boiling-crown-v1",
    "MISSING_ADAPTER",
    "Generic art: no verified production binding",
  );
  requireArt(
    (await sha256(b.sourceText)) === b.sourceHash,
    "ADAPTER",
    "Source hash mismatch",
  );
  requireArt(
    doc.width === 56 &&
      doc.height === 32 &&
      doc.frames.length === 7 &&
      JSON.stringify(doc.palette) === JSON.stringify(c.palette),
    "ADAPTER",
    "Production dimensions, frame count and palette must be unchanged",
  );
  requireArt(
    doc.frames.every(
      (f, i) =>
        f.id === b.frameIds[i] &&
        JSON.stringify(f.anchor) === JSON.stringify(c.anchor),
    ),
    "ADAPTER",
    "Frame order and anchors must be unchanged",
  );
  requireArt(
    doc.clips.length === 1 &&
      JSON.stringify(doc.clips[0].frameIds) === JSON.stringify(b.frameIds) &&
      JSON.stringify(doc.clips[0].durations) ===
        JSON.stringify(c.holds.map((n) => n * 40)) &&
      doc.clips[0].direction === "forward" &&
      doc.clips[0].loop === "once",
    "ADAPTER",
    "Native holds must remain [1,1,1,1,1,2,2]; timing conversion is not supported",
  );
  const original = await importProduction(b.sourceText),
    lines = b.sourceText.split("\n"),
    inverse = Object.fromEntries(
      Object.entries(c.codes).map(([k, v]) => [v, k]),
    ),
    changedFrames = [];
  let row = 0;
  for (const f of doc.frames) {
    const p = composite(doc, f.id),
      old = composite(original, f.id);
    requireArt(
      p.some((index) => index !== 0),
      "ADAPTER",
      "Production cels must not be empty",
    );
    requireArt(
      p.every((v) => v in inverse),
      "ADAPTER",
      "Pixel color has no authored source code",
    );
    if (p.some((v, i) => v !== old[i]))
      changedFrames.push({ id: f.id, hash: await sha256(Uint8Array.from(p)) });
    for (let y = 0; y < 32; y++)
      lines[original.provenance.binding.rowLines[row++]] = p
        .slice(y * 56, (y + 1) * 56)
        .map((v) => inverse[v])
        .join("");
  }
  const text = lines.join("\n");
  return {
    text,
    manifest: {
      adapter: b.adapter,
      documentId: doc.id,
      revision: doc.revision,
      source: c.source,
      sourceHash: b.sourceHash,
      targetHash: await sha256(text),
      changedFrames,
      nativeHolds: c.holds,
      generator: c.generator,
      status: "reviewable-source-candidate",
      productionPreview: "native-action:dynamite.explode",
      repositoryWritten: false,
    },
  };
}
