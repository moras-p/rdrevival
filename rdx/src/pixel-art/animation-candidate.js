import { clone, composite, createDocument, requireArt, validate } from './document.js';
import { sha256 } from './image-io.js';
import { animationReviewState, inspectAnimationPair } from './animation-review.js';

export const ANIMATION_PACKAGE_SCHEMA = 'rdr.pixel_art.production_sprite.v1';
const stableId = v => typeof v === 'string' && /^[a-z0-9][a-z0-9-]{1,79}$/.test(v);

/** A source-controlled candidate, never an installed native gameplay asset.
 * A separate guarded host and a reviewed generator own installation. */
export async function exportAnimationCandidate(doc, { assetId, owner, poseReferenceId, identityReferenceId, expectedSourceHash } = {}) {
  validate(doc);
  requireArt(stableId(assetId), 'BINDING', 'A stable lowercase asset ID is required');
  requireArt(owner && /^SM[0-9A-F]{2}$/.test(owner.room) && Number.isInteger(owner.submap) && owner.submap >= 0 && owner.submap <= 46 &&
    Number.parseInt(owner.room.slice(2), 16) === owner.submap && Number.isInteger(owner.mapId) && owner.mapId >= 1 && owner.mapId <= 54 &&
    Number.isInteger(owner.mark) && owner.mark >= 0 && owner.mark <= 65535 &&
    Array.isArray(owner.pnFamily) && owner.pnFamily.length > 0 && owner.pnFamily.every(pn => Number.isInteger(pn) && pn >= 0 && pn <= 255),
  'BINDING', 'Explicit consistent room, submap, map ID, mark and PN family required');
  requireArt(doc.frames.length === 2 && doc.frames.every(f => f.anchor.join(',') === doc.frames[0].anchor.join(',')),
    'ANIMATION', 'Two registered cels with identical anchors required');
  const identity = doc.references.find(ref => ref.id === identityReferenceId), pose = doc.references.find(ref => ref.id === poseReferenceId);
  requireArt(identity?.sequence && pose?.sequence && identity.role === 'subject' && pose.role === 'pose', 'REFERENCE', 'Explicit subject and pose animation references required');
  requireArt(identity.provenance?.sourceKind === 'rom-pn' && identity.provenance.mapId === owner.mapId && owner.pnFamily.includes(identity.provenance.pn),
    'SOURCE_CHANGED', 'Identity reference does not match bound ROM map / PN family');
  requireArt(typeof expectedSourceHash === 'string' && identity.provenance.sourceHash === expectedSourceHash,
    'SOURCE_CHANGED', 'Reference ROM/source hash does not match expected export guard');
  requireArt(doc.palettePolicy && doc.palettePolicy.source === identity.provenance.paletteSource && JSON.stringify(doc.palette) === JSON.stringify(identity.palette),
    'PALETTE', 'Candidate must use the authoritative indexed identity/map palette');
  const permitted = new Set(doc.palettePolicy.allowedIndices ?? []);
  const frames = doc.frames.map(frame => {
    const indices = composite(doc, frame.id);
    requireArt(indices.every(index => permitted.has(index)), 'PALETTE', `Unpermitted color in ${frame.id}`);
    return { id: frame.id, anchor: [...frame.anchor], indices };
  });
  const diagnostics = inspectAnimationPair(doc);
  const reviewFrames = await animationReviewState(doc);
  const acceptedFrameIds = reviewFrames.filter(r => r.status === 'accepted').map(r => r.frameId);
  const reviewed = acceptedFrameIds.length === 2;
  const source = {
    schema: ANIMATION_PACKAGE_SCHEMA, assetId,
    canvas: { width: doc.width, height: doc.height, origin: [...doc.frames[0].anchor] },
    palette: clone(doc.palette), paletteSource: doc.palettePolicy.source,
    frames,
  };
  const framesText = `${JSON.stringify(source, null, 2)}\n`;
  const framesHash = `sha256:${await sha256(framesText)}`;
  const manifest = {
    schema: ANIMATION_PACKAGE_SCHEMA, assetId, owner: clone(owner), role: 'ladder-climb',
    frameIds: frames.map(f => f.id), canvas: source.canvas,
    phaseAuthority: 'native-classic-type2', paletteSource: source.paletteSource,
    sourceRevision: doc.revision, sourceHash: expectedSourceHash,
    referenceIds: [pose.id, identity.id],
    references: [{ id: pose.id, hash: pose.hash, provenance: pose.provenance, phasePair: pose.sequence.phasePair },
      { id: identity.id, hash: identity.hash, provenance: identity.provenance, phasePair: identity.sequence.phasePair }],
    // Approval fingerprints include ALL pose/subject references, not only the
    // two chosen for phase pairing. Preserve that complete input contract for
    // local-host recomputation when an artist has additional named references.
    reviewFingerprintReferences: doc.references.filter(ref => ref.sequence && ['pose', 'subject'].includes(ref.role))
      .map(ref => ({ id: ref.id, hash: ref.hash, ...(ref.provenance?.sourceHash === undefined ? {} : { sourceHash: ref.provenance.sourceHash }),
        phasePair: ref.sequence.phasePair })).sort((a, b) => a.id.localeCompare(b.id)),
    framesHash,
    review: { status: reviewed ? 'frames-accepted' : 'candidate', acceptedFrameIds, frames: reviewFrames.map(({ frameId, fingerprint, status, stale, note }) => ({ frameId, fingerprint, status, stale, note })), productionVerified: false },
    diagnostics: { ...diagnostics, warnings: diagnostics.warnings },
    integration: { status: 'not-installed', native: false, browser: false, note: 'Requires explicit frame acceptance, generator, native scenario and verified host patch' },
  };
  return { framesText, manifest, files: [
    { name: 'frames.json', text: framesText },
    { name: 'animation.json', text: `${JSON.stringify(manifest, null, 2)}\n` },
  ] };
}

/** Lossless indexed reimport of the flattened production candidate cels. */
export async function importAnimationCandidate(framesText, manifest) {
  const source = JSON.parse(framesText);
  requireArt(source?.schema === ANIMATION_PACKAGE_SCHEMA && manifest?.schema === ANIMATION_PACKAGE_SCHEMA && source.assetId === manifest.assetId, 'ANIMATION', 'Candidate schema/identity mismatch');
  requireArt(`sha256:${await sha256(framesText)}` === manifest.framesHash, 'SOURCE_CHANGED', 'Candidate frame bytes do not match manifest');
  requireArt(Array.isArray(source.frames) && source.frames.length === 2 && JSON.stringify(source.frames.map(f => f.id)) === JSON.stringify(manifest.frameIds), 'ANIMATION', 'Two matching candidate frame IDs required');
  const doc = createDocument({ id: source.assetId, width: source.canvas.width, height: source.canvas.height, frameCount: 2, palette: source.palette });
  for (let i = 0; i < 2; i++) {
    const frame = source.frames[i];
    requireArt(Array.isArray(frame.indices) && frame.indices.length === doc.width * doc.height &&
      JSON.stringify(frame.anchor) === JSON.stringify(source.canvas.origin), 'ANIMATION', 'Invalid candidate indexed geometry/registration');
    doc.frames[i].id = frame.id; doc.frames[i].anchor = [...frame.anchor]; doc.frames[i].cels.ink = [...frame.indices];
  }
  doc.layout.cells = doc.frames.map(f => f.id);
  doc.clips[0].frameIds = doc.frames.map(f => f.id);
  return validate(doc);
}
