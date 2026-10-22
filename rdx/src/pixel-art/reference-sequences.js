import { composite, requireArt } from './document.js';
import { sha256 } from './image-io.js';
import { normalizeAttachedReferenceMetadata } from './references.js';

/** Immutable display atlas for a trusted asset plugin's decoded indexed cels.
 * This is deliberately NOT a second editable document or a stamping grant.
 * It preserves each cel's index histogram/anchor and source provenance.
 */
export async function referenceSequenceFromDocument(doc, { id, name, role = 'pose', notes = '' } = {}) {
  requireArt(typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id), 'REFERENCE', 'Reference ID must be a stable identifier');
  requireArt(doc.frames.length >= 1 && doc.width * doc.frames.length <= 4096 && doc.height <= 4096, 'REFERENCE', 'Reference animation atlas exceeds supported bounds');
  const rgba = new Uint8Array(doc.width * doc.frames.length * doc.height * 4);
  const frames = [];
  for (let n = 0; n < doc.frames.length; n++) {
    const frame = doc.frames[n];
    const pixels = composite(doc, frame.id);
    const histogram = {};
    pixels.forEach(index => { histogram[index] = (histogram[index] ?? 0) + 1; });
    for (let y = 0; y < doc.height; y++) for (let x = 0; x < doc.width; x++) {
      const color = doc.palette[pixels[y * doc.width + x]];
      rgba.set(color, (y * doc.width * doc.frames.length + n * doc.width + x) * 4);
    }
    frames.push({ id: frame.id, index: n, anchor: [...frame.anchor], durationMs: doc.clips[0]?.durations[doc.clips[0].frameIds.indexOf(frame.id)] ?? null, paletteHistogram: histogram });
  }
  const hash = await sha256(rgba);
  const reference = normalizeAttachedReferenceMetadata({
    id, name: String(name ?? id).slice(0, 120), hash: `sha256:${hash}`,
    width: doc.width * doc.frames.length, height: doc.height, rgba: Array.from(rgba),
    palette: doc.palette.map(color => [...color]),
    sequence: { frameWidth: doc.width, frameHeight: doc.height, frames, phasePair: frames.slice(0, 2).map(f => f.id) },
    provenance: {
      sourceKind: 'rom-pn', mapId: doc.provenance.asset?.mapId ?? null,
      pn: doc.provenance.asset?.pn ?? null, sourceHash: doc.provenance.asset?.sourceHash ?? null,
      paletteSource: doc.palettePolicy?.source ?? null,
      paletteBanks: doc.provenance.asset?.paletteBanks ?? [],
      description: 'Decoded RDX ROM PN frames; not a runtime-synthesized climb animation',
    },
  }, { role, notes });
  // Authored cels may be used as inspiration, but importing a trusted plugin
  // is not itself a license to stamp any of its pixels into the active target.
  return reference;
}

/** Preserve *actual* native actor pixels, not the RDX ROM PN that happens to
 * dress the actor. This creates an inspect-only animation reference. The crop
 * registration is relative to native actor bounds, NOT a verified sprite anchor.
 */
export async function nativeLadderReferenceFromCaptures(captures, descriptor, { id, name, role = 'pose', notes = '', romHash } = {}) {
  requireArt(typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id), 'REFERENCE', 'Reference ID must be stable');
  requireArt(/^sha256:[0-9a-f]{64}$/.test(romHash ?? ''), 'REFERENCE', 'Runtime reference needs the exact source ROM SHA-256');
  requireArt(Array.isArray(captures) && captures.length === 2 && captures[0]?.phase === 0 && captures[1]?.phase === 1,
    'REFERENCE', 'Both real native climbing phases must be captured');
  const { width, height } = captures[0];
  requireArt(Number.isInteger(width) && Number.isInteger(height) && width > 0 && width <= 64 && height > 0 && height <= 64,
    'REFERENCE', 'Native actor crop must be a bounded, visible sprite');
  const frames = [], atlas = new Uint8Array(width * 2 * height * 4);
  for (const [n, capture] of captures.entries()) {
    requireArt(capture.width === width && capture.height === height && capture.rgba?.length === width * height * 4,
      'REFERENCE', 'Native ladder captures must have identical canvas geometry');
    const rgba = Uint8Array.from(capture.rgba);
    const histogram = {}, opaque = { left: width, top: height, right: 0, bottom: 0 };
    let opaqueCount = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4, alpha = rgba[at + 3];
      const color = [...rgba.subarray(at, at + 4)].map(v => v.toString(16).padStart(2, '0')).join('');
      histogram[color] = (histogram[color] ?? 0) + 1;
      if (alpha) {
        opaqueCount++;
        opaque.left = Math.min(opaque.left, x); opaque.top = Math.min(opaque.top, y);
        opaque.right = Math.max(opaque.right, x + 1); opaque.bottom = Math.max(opaque.bottom, y + 1);
      }
    }
    requireArt(opaqueCount > 0, 'REFERENCE', 'Native climbing actor capture is fully transparent');
    for (let y = 0; y < height; y++) atlas.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), (y * width * 2 + n * width) * 4);
    requireArt(capture.facts?.phase?.phase === n && capture.facts.actor.mark === descriptor.mark &&
      capture.facts.submap === descriptor.submap && Number.isInteger(capture.facts.frameSerial),
      'REFERENCE', 'Native phase/actor provenance mismatch');
    frames.push({ id: `native-climb-${n ? 'b' : 'a'}`, index: n,
      anchor: [0, 0], durationMs: null, // Capture-local origin. Native timing remains authoritative.
      rgbaHash: `sha256:${await sha256(rgba)}`, rgbaHistogram: histogram,
      opaqueBounds: [opaque.left, opaque.top, opaque.right - opaque.left, opaque.bottom - opaque.top],
      nativeState: capture.facts });
  }
  requireArt(frames[0].nativeState.frameSerial !== frames[1].nativeState.frameSerial,
    'REFERENCE', 'Both native phases must originate from distinct runtime frames');
  requireArt(frames[0].rgbaHash !== frames[1].rgbaHash, 'REFERENCE', 'Both native phases have identical captured pixels');
  return normalizeAttachedReferenceMetadata({
    id, name: String(name ?? id).slice(0, 120), hash: `sha256:${await sha256(atlas)}`,
    width: width * 2, height, rgba: Array.from(atlas),
    sequence: { frameWidth: width, frameHeight: height, frames, phasePair: frames.map(f => f.id) },
    provenance: { sourceKind: 'runtime-resolved-climb', sourceHash: romHash,
      room: `SM${descriptor.submap.toString(16).toUpperCase().padStart(2, '0')}`,
      submap: descriptor.submap, mark: descriptor.mark, action: 'ladder-climb',
      renderer: 'native-xrick-wasm/game-juice-live-preview',
      registration: 'native-actor-bounds-crop',
      registrationNote: 'Frame anchor [0,0] is crop-local; it is NOT a verified game sprite registration.',
      animationAuthority: 'native-type2-c1-sprite-xy',
      pixelAuthority: 'native-rgba-mask (not independently decoded palette indices)',
      captureScript: { controls: descriptor.controls, maxFrames: descriptor.maxFrames },
      description: 'Captured synthesized/native-resolved gameplay pixels, NOT original RDX ROM climb cels.',
    },
  }, { role, notes });
}

export function referenceFrame(reference, frameId) {
  const sequence = reference.sequence;
  if (!sequence) {
    requireArt(!frameId, 'REFERENCE', 'Still image reference has no frame IDs');
    return { rect: [0, 0, reference.width, reference.height], frame: null };
  }
  const frame = sequence.frames.find(f => f.id === (frameId ?? sequence.phasePair[0]));
  requireArt(frame, 'REFERENCE', 'Unknown reference animation frame');
  return { rect: [frame.index * sequence.frameWidth, 0, sequence.frameWidth, sequence.frameHeight], frame };
}

export function referenceState(doc) {
  return doc.references.map(({ rgba, ...reference }) => ({ ...reference, pixelBytes: rgba.length, frames: reference.sequence?.frames.length ?? 1 }));
}
