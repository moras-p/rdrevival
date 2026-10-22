import { requireArt } from './document.js';

const TYPE_2_CLIMBERS = new Set([0x06, 0x09, 0x0c, 0x0f]);

/** Native xrick TYPE_2 ladder phase, not a browser-side animation clock.
 * Matches classic_enemy_climb_sprite in revival/rev/src/rdx_present_animation.c.
 * c1 is authoritative while sprite latency may leave a walking cel visible.
 */
export function nativeType2LadderPhase(actor) {
  if (!actor || Number(actor.c1) !== 1 || !TYPE_2_CLIMBERS.has(Number(actor.n) & 0x7f)) return null;
  const sprite = Number(actor.sprite), base = Number(actor.sprbase);
  if (![actor.sprite, actor.sprbase, actor.x, actor.y].every(Number.isInteger)) return null;
  const x = actor.x, y = actor.y;
  const offset = ((sprite & 0xff) - ((base + 8) & 0xff) + 256) & 0xff;
  const fromSprite = offset === 0 || offset === 1;
  const phase = fromSprite ? offset : ((x ^ y) & 4) ? 1 : 0;
  return { phase, source: fromSprite ? 'native-ladder-sprite' : 'native-c1-xy-latency',
    c1: Number(actor.c1), sprite, sprbase: base, x, y, latency: Number(actor.latency ?? 0) };
}

/** Reproducible, bounded input timeline. The default is a neutral native replay.
 * The editor never invents a movement sequence to force the actor to climb. */
export function ladderReviewControlMask(controls, frame) {
  for (const row of controls ?? []) if (frame >= row.from && frame <= row.to) return row.mask;
  return 0;
}

export function validateLadderReview(descriptor, doc) {
  const frameIds = descriptor.frameIds;
  requireArt(doc.width === 32 && doc.height === 21, 'PREVIEW', 'Native TYPE_2 ladder cels require the production 32×21 canvas');
  requireArt(doc.frames.length >= 2 && doc.frames[0].anchor.every((n, i) => n === doc.frames[1].anchor[i]),
    'PREVIEW', 'Native TYPE_2 ladder cels require matching frame registrations');
  requireArt(Array.isArray(frameIds) && frameIds.length === 2 && new Set(frameIds).size === 2 &&
    frameIds.every(id => doc.frames.some(f => f.id === id)), 'PREVIEW', 'Native ladder review requires two distinct candidate cels');
  validateLadderReviewDescriptor(descriptor);
  return descriptor;
}

/** Shared bounds for native preview and capture-as-reference. Never scripts a
 * fake ladder state or silently guesses a path through the native room. */
export function validateLadderReviewDescriptor(descriptor) {
  requireArt(Number.isInteger(descriptor.submap) && descriptor.submap >= 0 && descriptor.submap <= 46 &&
    Number.isInteger(descriptor.mark) && descriptor.mark > 0, 'PREVIEW', 'Native ladder review requires a specific room and source mark');
  requireArt(Number.isInteger(descriptor.maxFrames) && descriptor.maxFrames >= 2 && descriptor.maxFrames <= 480,
    'PREVIEW', 'Native ladder review must run for 2–480 native frames');
  requireArt(Array.isArray(descriptor.controls) && descriptor.controls.length <= 32 && descriptor.controls.every(row =>
    Number.isInteger(row.from) && Number.isInteger(row.to) && row.from >= 0 && row.to >= row.from && row.to < descriptor.maxFrames &&
    Number.isInteger(row.mask) && row.mask >= 0 && (row.mask & ~31) === 0),
  'PREVIEW', 'Native ladder review has an invalid bounded control script');
  for (let n = 1; n < descriptor.controls.length; n++)
    requireArt(descriptor.controls[n].from > descriptor.controls[n - 1].to, 'PREVIEW', 'Native ladder controls must be ordered and non-overlapping');
  return descriptor;
}


/** Reject duplicate active mark ownership; slot is a runtime locator, not the
 * semantic actor key. A recycled slot is never allowed to certify a phase. */
export function findNativeLadderActor(snapshot, mark) {
  const actors = (snapshot?.entities ?? []).filter(row => Number(row.mark) === mark &&
    Number(row.n) > 0 && Number(row.n) <= 0xfe);
  requireArt(actors.length <= 1, 'PREVIEW', `Native source mark ${mark} is ambiguous`);
  return actors[0] ?? null;
}

export function ladderCaptureFacts(snapshot, actor, phase, bounds, scriptFrame) {
  return {
    submap: Number(snapshot.submap), frameSerial: Number(snapshot.frameSerial), scriptFrame,
    actor: { slot: Number(actor.slot), mark: Number(actor.mark), type: Number(actor.n) & 0x7f,
      x: Number(actor.x), y: Number(actor.y), sprite: Number(actor.sprite), sprbase: Number(actor.sprbase),
      c1: Number(actor.c1), latency: Number(actor.latency ?? 0) },
    phase, bounds: { left: Number(bounds.left), top: Number(bounds.top), right: Number(bounds.right), bottom: Number(bounds.bottom) },
  };
}
