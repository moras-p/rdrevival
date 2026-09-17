/**
 * Apply the browser's explicit Classic <-> Revival presentation switch.
 *
 * This is deliberately presentation-only. The native Revival simulation stays
 * authoritative: camera, collision policy, Rick, entities and projectiles are
 * not translated or reset just because another visual source is selected.
 * The shift map is retained only as diagnostic evidence about any local
 * Classic/RDX correspondence residual at Rick's current position.
 */
export function switchLivePresentation({ bridge, shiftMap = null, targetClassic } = {}) {
  if (!bridge || typeof bridge.snapshot !== 'function' || typeof bridge.setClassicAssets !== 'function')
    throw new TypeError('A live xrick bridge is required');

  const classic = !!targetClassic;
  const before = bridge.snapshot();
  const correction = shiftMap?.correctionForPresentationSwitch?.(before, classic) || null;

  bridge.setClassicAssets(classic);
  return Object.freeze({
    classic,
    before,
    correction,
    residual: !!(correction && (correction.dxPx || correction.dyPx))
  });
}
