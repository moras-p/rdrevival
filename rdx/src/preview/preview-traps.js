import { rdxDirectionalMirrorX } from '../runtime/sprite-mapping.js';

function triangle01(t, halfPeriod) {
  const period = Math.max(2, halfPeriod * 2), phase = ((t % period) + period) % period;
  return phase <= halfPeriod ? phase / halfPeriod : (period - phase) / halfPeriod;
}
function actorInventory(inventory) {
  const map = new Map();
  for (const row of inventory?.rows || []) for (const actorId of row.actorIds || []) map.set(Number(actorId), row);
  return map;
}
function validAnimations(row) { return (row?.animations || []).filter(animation => Number.isFinite(Number(animation.pn))); }
function selectAnimation(row, phase, preferredActions = [], direction = 'neutral') {
  const animations = validAnimations(row); if (!animations.length) return null;
  for (const action of preferredActions) {
    const match = animations.find(animation => String(animation.action).includes(action) && (animation.direction === direction || animation.direction === 'neutral')) ||
      animations.find(animation => String(animation.action).includes(action));
    if (match) return match;
  }
  return animations.find(animation => animation.direction === direction) || animations[Math.floor(phase / 32) % animations.length];
}
function withAnimation(base, row, phase, preferredActions = [], direction = 'neutral') {
  const animation = selectAnimation(row, phase, preferredActions, direction);
  return animation ? { ...base, pn: Number(animation.pn), animationAction: animation.action, animationDirection: animation.direction || direction } : base;
}

/* PA actor variants carry shooter orientation while their body PN is neutral.
 * PN49 fires PN11 and PN50 fires PN12.  Do not infer travel from sprite shape
 * or alternate body facing every preview phase. */
const SHOOTER_PROJECTILE_BY_BODY = Object.freeze(new Map([[49, 11], [50, 12]]));

function projectileForEmitter(state, row, phase, direction) {
  const bodyPn = Number(state.pn);
  const projectileRow = validAnimations(row).find(animation => {
    if (bodyPn === 50) return String(animation.action) === 'projectile_variant';
    if (bodyPn === 49) return String(animation.action) === 'projectile';
    return /^projectile/.test(String(animation.action));
  });
  const fallbackProjectile = projectileRow || validAnimations(row).find(animation => /fire|shoot/.test(String(animation.action)));
  const projectilePn = SHOOTER_PROJECTILE_BY_BODY.get(bodyPn) ?? Number(fallbackProjectile?.pn);
  const productionEmitter = state.productionEmitter || state.actor.production?.emitter || null;
  const actualDirection = productionEmitter?.direction || direction;
  const sign = actualDirection === 'left' ? -1 : 1;
  const travel = (phase % 64) * 3;
  /* The production C scene manifest owns the shooter body draw point and
   * mouth contact. The previous preview launched from MA origin-8, which put
   * MD0005 arrows at the statue eye even when the body itself looked close. */
  const muzzleX = Number(productionEmitter?.muzzle?.[0]);
  const muzzleY = Number(productionEmitter?.muzzle?.[1]);
  const edgeX = Number(productionEmitter?.edgeX);
  const paBottom = Number(state.actorDef?.collisionOffsets?.bottom);
  const launchX = Number.isFinite(muzzleX) ? muzzleX :
    (Number.isFinite(edgeX) ? edgeX : state.x + sign * 8);
  /* Fixed wall emitters use PA +0x8D as their production contact row. The
   * former height*0.625 estimate put MD0005 arrows below the statue mouth.
   * This is the same ROM actor geometry consumed by the runtime renderer. */
  const launchY = Number.isFinite(muzzleY) ? muzzleY :
    (productionEmitter?.contactRule === 'pa-collision-bottom' && Number.isFinite(paBottom)
      ? state.y + paBottom : state.y - 4);
  const exactProjectilePn = Number(productionEmitter?.projectilePn);
  return {
    kind: 'projectile',
    actorId: state.actor.actorId,
    sourceIndex: state.actor.index,
    inventory: row,
    visible: true,
    independent: true,
    direction: actualDirection,
    x: launchX + sign * travel,
    y: launchY,
    pn: Number.isFinite(exactProjectilePn) ? exactProjectilePn : (Number.isFinite(projectilePn) ? projectilePn : null),
    mirrorX: rdxDirectionalMirrorX(actualDirection),
    width: 5,
    height: 3,
    bodyPn
  };
}

export class PreviewTrapSystem {
  constructor(inventory) { this.inventory = inventory; this.byActor = actorInventory(inventory); }
  rowForActor(actorId) { return this.byActor.get(Number(actorId)) || null; }
  effectFor(state, tick) {
    if (state.actor.set?.type === 'collectible' || state.actor.set?.type === 'player') return null;
    const row = this.rowForActor(state.actor.actorId); if (!row) return null;
    const phase = ((tick % 160) + 160) % 160;
    const direction = state.direction === 'left' ? 'left' : 'right';
    const base = { inventory: row, actorId: state.actor.actorId, sourceIndex: state.actor.index, visible: true, direction };
    const strategy = row.id === 'jungle_floor_plant_hazard' ? 'emitter-projectile-loop' : row.effectStrategy;
    switch (strategy) {
      case 'emitter-projectile-loop':
        return projectileForEmitter(state, row, phase, direction);
      case 'eject-retract-loop': {
        const amount = triangle01(phase, 32);
        return withAnimation({ ...base, kind: 'offset', dx: 0, dy: -Math.round(amount * 16) }, row, phase, ['active', 'eject', 'move'], direction);
      }
      case 'trajectory-loop': {
        const amount = triangle01(phase, 48), sign = direction === 'left' ? -1 : 1;
        return withAnimation({ ...base, kind: 'offset', dx: sign * Math.round((amount - .5) * 48), dy: 0 }, row, phase, ['roll', 'move', 'active'], direction);
      }
      case 'falling-drop-loop':
        /* Compatibility name only. ROM spike/dagger PA/PN rows encode visual
         * state, not a preview-side trajectory. Production C owns activation;
         * an active state remains fixed at its decoded wall/ceiling anchor. */
        return withAnimation({ ...base, kind: 'state-only', dx: 0, dy: 0, visible: true },
          row, phase, ['active', 'idle'], direction);
      case 'destroy-restore-loop':
        if (phase < 40) return withAnimation({ ...base, kind: 'normal' }, row, phase, ['idle'], direction);
        if (phase < 88) return withAnimation({ ...base, kind: 'displaced', dx: Math.round((phase - 40) * 1.5), dy: -Math.round((phase - 40) * .4), alpha: Math.max(0, 1 - (phase - 40) / 48) }, row, phase, ['destroy', 'explode', 'active', 'variant'], direction);
        return withAnimation({ ...base, kind: 'restoring', alpha: Math.min(1, (phase - 88) / 32) }, row, phase, ['idle'], direction);
      case 'diagnostic-pulse': case 'classic-fallback-frame':
        return withAnimation({ ...base, kind: 'diagnostic', pulse: .35 + .65 * triangle01(phase, 20) }, row, phase, [], direction);
      case 'activation-pulse':
        return withAnimation({ ...base, kind: 'pulse', pulse: .75 + .25 * triangle01(phase, 20) }, row, phase, ['active', 'fire', 'move'], direction);
      default: return withAnimation({ ...base, kind: 'state-animation' }, row, phase, [], direction);
    }
  }
  effectsAt(actorStates, tick) { return actorStates.map(state => this.effectFor(state, tick)).filter(Boolean); }
}
