import { previewTicksForSeconds } from './preview-clock.js';

/** Mechanism helpers are deliberately visual-only. They never mutate the C game. */
export function mechanismTransform(effect) {
  if (!effect) return Object.freeze({ dx: 0, dy: 0, alpha: 1, visible: true });
  return Object.freeze({
    dx: Number(effect.dx || 0),
    dy: Number(effect.dy || 0),
    alpha: effect.alpha == null ? 1 : Math.max(0, Math.min(1, Number(effect.alpha))),
    visible: effect.visible !== false
  });
}
export function mechanismDirtyBounds(x, y, width, height, transform = {}) {
  const x0 = Math.floor(Math.min(x, x + Number(transform.dx || 0))) - 2;
  const y0 = Math.floor(Math.min(y, y + Number(transform.dy || 0))) - 2;
  const x1 = Math.ceil(Math.max(x + width, x + Number(transform.dx || 0) + width)) + 2;
  const y1 = Math.ceil(Math.max(y + height, y + Number(transform.dy || 0) + height)) + 2;
  return Object.freeze({ x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) });
}


/** Sample an explicitly presentation-only editor inspection cycle.
 *
 * `inspectionStateSeconds` is wall-time intent, but sampling is performed only
 * in deterministic PreviewClock ticks. The cycle never mutates native/runtime
 * gameplay state.
 */
export function editorInspectionCycleSample(cycle, tick) {
  const samples = Array.isArray(cycle?.samples) ? cycle.samples : [];
  if (!samples.length) return null;
  const seconds = Number(cycle?.inspectionStateSeconds);
  if (Number.isFinite(seconds) && seconds > 0) {
    const duration = previewTicksForSeconds(seconds);
    const period = duration * samples.length;
    const phase = ((Math.floor(Number(tick) || 0) % period) + period) % period;
    const index = Math.min(samples.length - 1, Math.floor(phase / duration));
    return Object.freeze({
      ...samples[index], phase: index * duration, duration,
      inspectionPhase: phase, inspectionPeriod: period, presentationOnlyInspection: true
    });
  }
  const period = Math.max(1, Number(cycle?.period || 1));
  const phase = ((Math.floor(Number(tick) || 0) % period) + period) % period;
  let selected = samples[0];
  for (const sample of samples) {
    if (Number(sample.phase || 0) > phase) break;
    selected = sample;
    if (phase < Number(sample.phase || 0) + Math.max(1, Number(sample.duration || 1))) break;
  }
  return Object.freeze({
    ...selected, inspectionPhase: phase, inspectionPeriod: period, presentationOnlyInspection: true
  });
}
