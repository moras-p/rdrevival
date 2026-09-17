/**
 * Session-only projection helpers for native xrick stationary projectiles.
 *
 * The native type-3 entity is both the dormant shooter controller and the
 * active projectile controller. Layer E owns the reviewed RDX emitter body and
 * muzzle; xrick owns wake/re-arm cadence, displacement and destruction. These
 * helpers only combine those two authorities for the Level Editor display.
 */

const HOSTILE_PROJECTILE_FAMILIES = new Set([0x19, 0x1a, 0x39]);

function int(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export function isNativeProjectileEntity(entity) {
  return HOSTILE_PROJECTILE_FAMILIES.has(int(entity?.n) & 0x7f);
}

export function isNativeProjectileActive(state) {
  const entity = state?.nativeEntity || state;
  if (!isNativeProjectileEntity(entity)) return false;
  if (entity?.projectileActive != null) return !!entity.projectileActive;
  return int(entity?.c1) !== 0;
}

export function nativeProjectileInstanceKey(state, generation) {
  const sourceKey = String(state?.sourceKey || '');
  const slot = int(state?.slot ?? state?.nativeEntity?.slot, -1);
  return sourceKey && slot >= 0
    ? `runtime-projectile:${sourceKey}:slot:${slot}:generation:${Math.max(1, int(generation, 1))}`
    : null;
}

export function projectNativeProjectile(emitter, state) {
  if (!emitter || !state || !isNativeProjectileActive(state)) return null;
  const entity = state.nativeEntity || {};
  const mouth = Array.isArray(emitter.mouth) ? emitter.mouth : null;
  if (!mouth || mouth.length < 2) return null;
  const xsave = Number(entity.xsave), ysave = Number(entity.ysave);
  if (!Number.isFinite(xsave) || !Number.isFinite(ysave)) return null;
  const dx = int(entity.x) - int(xsave);
  const dy = int(entity.y) - int(ysave);
  const direction = String(emitter.direction || '').toLowerCase();
  if (direction !== 'left' && direction !== 'right') return null;
  const sourceKey = String(state.sourceKey || emitter.sourceKey || '');
  const parentSourceKey = String(emitter.bodySourceKey || emitter.sourceKey || sourceKey);
  const instanceKey = String(state.runtimeInstanceKey || '') || nativeProjectileInstanceKey(state, 1);
  return Object.freeze({
    kind: 'projectile',
    sourceKey,
    instanceKey,
    parentSourceKey,
    pn: int(emitter.projectilePn, -1),
    origin: Object.freeze([int(mouth[0]) + dx, int(mouth[1]) + dy]),
    direction,
    mirrorX: !!emitter.projectileMirrorX,
    mirrorY: !!emitter.projectileMirrorY,
    front: !!emitter.projectileFront,
    tick: int(state.tick),
    emitterAligned: true,
    emitterContact: Object.freeze([int(mouth[0]), int(mouth[1])]),
    emitterDirection: direction,
    nativeDisplacement: Object.freeze([dx, dy]),
    nativeSlot: int(state.slot ?? entity.slot, -1),
    nativeGeneration: int(state.runtimeGeneration, 1),
    runtimeLifecycle: 'active-projectile',
    authority: 'layer-e-reviewed-emitter+native-xrick-projectile-state'
  });
}
