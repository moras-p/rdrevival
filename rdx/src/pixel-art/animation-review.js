import { composite, requireArt } from './document.js';
import { sha256 } from './image-io.js';

const STATUSES = ['draft', 'ready-for-review', 'accepted', 'rejected'];

/** Review evidence depends on pixels, registration, palette and reference identity/phase.
 * A document revision alone is too broad: notes do not change the reviewed image.
 */
export async function animationFrameFingerprint(doc, frameId) {
  const frame = doc.frames.find(row => row.id === frameId);
  requireArt(frame, 'TARGET', 'Unknown animation frame');
  const refs = doc.references.filter(r => r.sequence && ['pose', 'subject'].includes(r.role))
    .map(r => ({ id: r.id, hash: r.hash, sourceHash: r.provenance?.sourceHash, phasePair: r.sequence.phasePair }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return `sha256:${await sha256(JSON.stringify({
    width: doc.width, height: doc.height, frameId, anchor: frame.anchor,
    palette: doc.palette, paletteSource: doc.palettePolicy?.source ?? null,
    pixels: composite(doc, frameId), references: refs,
  }))}`;
}

export async function animationReviewState(doc) {
  const frames = [];
  for (const frame of doc.frames) {
    const fingerprint = await animationFrameFingerprint(doc, frame.id);
    const record = doc.animationReview?.[frame.id] ?? null;
    frames.push({ frameId: frame.id, fingerprint, status: record?.fingerprint === fingerprint ? record.status : 'draft',
      stale: !!record && record.fingerprint !== fingerprint, note: record?.note ?? '', recordedStatus: record?.status ?? null });
  }
  return frames;
}

/** Geometry facts, not an aesthetic quality score. Uses the same indexed cels as export. */
export function inspectAnimationPair(doc, frameIds = doc.frames.slice(0, 2).map(f => f.id)) {
  requireArt(frameIds.length === 2 && frameIds.every(id => doc.frames.some(f => f.id === id)), 'ANIMATION', 'Choose two existing animation frames');
  const permitted = doc.palettePolicy?.allowedIndices ?? doc.palette.map((_, i) => i);
  const frames = frameIds.map(id => {
    const pixels = composite(doc, id), frame = doc.frames.find(f => f.id === id);
    let minX = doc.width, minY = doc.height, maxX = -1, maxY = -1, sx = 0, sy = 0, opaque = 0;
    const histogram = {}, violations = new Set(), edgeContact = [];
    for (let y = 0; y < doc.height; y++) for (let x = 0; x < doc.width; x++) {
      const index = pixels[y * doc.width + x];
      histogram[index] = (histogram[index] ?? 0) + 1;
      if (!permitted.includes(index)) violations.add(index);
      if (doc.palette[index]?.[3] === 0) continue;
      opaque++; sx += x; sy += y;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      if (x === 0 || y === 0 || x === doc.width - 1 || y === doc.height - 1) edgeContact.push([x, y]);
    }
    return { frameId: id, anchor: [...frame.anchor], pixels, opaque, bounds: opaque ? [minX, minY, maxX - minX + 1, maxY - minY + 1] : null,
      centroid: opaque ? [sx / opaque, sy / opaque] : null,
      anchorRelativeBounds: opaque ? [minX - frame.anchor[0], minY - frame.anchor[1], maxX - minX + 1, maxY - minY + 1] : null,
      paletteHistogram: histogram, paletteViolations: [...violations].sort((a, b) => a - b), edgeContactCount: edgeContact.length };
  });
  let changedPixels = 0, silhouetteChangedPixels = 0;
  for (let i = 0; i < frames[0].pixels.length; i++) {
    if (frames[0].pixels[i] !== frames[1].pixels[i]) changedPixels++;
    if ((doc.palette[frames[0].pixels[i]]?.[3] !== 0) !== (doc.palette[frames[1].pixels[i]]?.[3] !== 0)) silhouetteChangedPixels++;
  }
  const [a, b] = frames;
  return {
    frames: frames.map(({ pixels, ...facts }) => facts),
    anchorDelta: [b.anchor[0] - a.anchor[0], b.anchor[1] - a.anchor[1]],
    centroidDelta: a.centroid && b.centroid ? b.centroid.map((v, n) => Number((v - a.centroid[n]).toFixed(2))) : null,
    changedPixels, silhouetteChangedPixels,
    warnings: [
      ...(a.anchor[0] !== b.anchor[0] || a.anchor[1] !== b.anchor[1] ? ['ANCHOR_DRIFT'] : []),
      ...(frames.some(f => f.paletteViolations.length) ? ['PALETTE_BANK'] : []),
      ...(frames.some(f => f.edgeContactCount) ? ['CANVAS_EDGE_CONTACT'] : []),
      ...(changedPixels === 0 ? ['IDENTICAL_PHASES'] : []),
    ],
  };
}
