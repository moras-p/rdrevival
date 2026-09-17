import { PRESENTATION_LAYER_BITS, presentationLayerMaskBits } from './presentation-layer-mask.js';

/*
 * Game Juice authoring compatibility checks.
 *
 * These checks describe whether the visible effect can be promoted using the
 * deliberately restricted Revival Amiga/CD32 vocabulary requested by the
 * project: opaque/masked pixels and sprites, palette/tile changes, integer
 * displacement and fixed-frame timing. They are an authoring constraint, not
 * a claim that the JavaScript preview literally runs on period hardware.
 */

const OPAQUE_EPSILON = 0.999;

function result(reasons = []) {
  const unique = [...new Set(reasons.filter(Boolean))];
  return Object.freeze({ compatible: unique.length === 0, reasons: Object.freeze(unique) });
}

function opacityReason(value, label) {
  const opacity = Number(value);
  if (!Number.isFinite(opacity) || opacity >= OPAQUE_EPSILON) return '';
  return `${label} uses alpha blending (${Math.max(0, opacity).toFixed(2)})`;
}

export function effectCompatibility(effectKey, effect) {
  if (!effect?.enabled) return result();
  const reasons = [];
  switch (effectKey) {
    case 'flash':
      reasons.push(opacityReason(effect.alpha, 'contact flash'));
      break;
    case 'actorFlash':
      reasons.push(opacityReason(effect.alpha, 'actor flash'));
      break;
    case 'worldFlash': {
      reasons.push(opacityReason(effect.alpha, 'world flash'));
      const mask=presentationLayerMaskBits(effect.layerMask);
      const behind=PRESENTATION_LAYER_BITS.backdrop|PRESENTATION_LAYER_BITS.midground|PRESENTATION_LAYER_BITS.actors;
      if (mask & behind) reasons.push(opacityReason(effect.backgroundAlphaScale, 'behind-actors world-flash strength'));
      break;
    }
    case 'hudImpulse':
      reasons.push(opacityReason(effect.alpha, 'HUD flash'));
      break;
    case 'spriteImpulse':
      if (effect.deformationMode === 'scale') reasons.push('actor deformation uses real-time sprite scaling');
      break;
    default:
      break;
  }
  return result(reasons);
}

export function motionTrailCompatibility(trail) {
  if (!trail?.enabled) return result();
  return result([opacityReason(trail.alpha, 'motion trail')]);
}

export function actionCompatibility(recipe) {
  if (!recipe?.enabled) return result();
  const reasons = [];
  for (const [key, effect] of Object.entries(recipe)) {
    if (!effect || typeof effect !== 'object' || Array.isArray(effect)) continue;
    reasons.push(...effectCompatibility(key, effect).reasons);
  }
  return result(reasons);
}

export function profileCompatibility(profile) {
  const reasons = [...motionTrailCompatibility(profile?.motionTrail).reasons];
  for (const [actionId, recipe] of Object.entries(profile?.actions || {})) {
    for (const reason of actionCompatibility(recipe).reasons) reasons.push(`${actionId}: ${reason}`);
  }
  return result(reasons);
}

export function compatibilityBadge(compatibility) {
  return compatibility?.compatible ? 'CD32 ✓' : 'ENHANCED ⚠';
}

export function compatibilitySummary(compatibility) {
  if (compatibility?.compatible) return 'Uses only the current opaque/masked CD32-safe authoring vocabulary.';
  return compatibility?.reasons?.[0] || 'Uses an enhanced-only authoring technique.';
}
