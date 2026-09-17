/** Deterministic fixed-step contract used by Level Editor Simulate/Preview. */
export const PREVIEW_STEP_MS = 40;
export const PREVIEW_TICKS_PER_SECOND = 1000 / PREVIEW_STEP_MS;

export function previewTicksForSeconds(seconds) {
  return Math.max(1, Math.round(Math.max(0, Number(seconds) || 0) * PREVIEW_TICKS_PER_SECOND));
}

/** Deterministic fixed-step clock used only by the non-interactive preview. */
export class PreviewClock {
  constructor(options = {}) {
    this.stepMs = Math.max(1, Number(options.stepMs ?? PREVIEW_STEP_MS));
    this.maxCatchUpSteps = Math.max(1, Number(options.maxCatchUpSteps ?? 5) | 0);
    this.speed = Math.max(0, Number(options.speed ?? 1));
    this.tick = Math.max(0, Number(options.tick ?? 0) | 0);
    this.accumulatorMs = 0;
    this.lastTimeMs = null;
    this.paused = !!options.paused;
  }
  reset(tick = 0) {
    this.tick = Math.max(0, Number(tick) | 0);
    this.accumulatorMs = 0;
    this.lastTimeMs = null;
  }
  setPaused(paused) { this.paused = !!paused; this.lastTimeMs = null; }
  setSpeed(speed) { this.speed = Math.max(0, Number(speed) || 0); }
  advanceSteps(steps = 1) {
    const count = Math.max(0, Number(steps) | 0);
    this.tick += count;
    return count;
  }
  advanceTime(deltaMs) {
    if (this.paused || this.speed <= 0) return 0;
    this.accumulatorMs += Math.max(0, Number(deltaMs) || 0) * this.speed;
    const available = Math.floor(this.accumulatorMs / this.stepMs);
    const steps = Math.min(available, this.maxCatchUpSteps);
    if (steps > 0) {
      /* Never carry an unbounded hidden-tab backlog into future frames. */
      this.accumulatorMs = available > this.maxCatchUpSteps
        ? this.accumulatorMs % this.stepMs
        : this.accumulatorMs - steps * this.stepMs;
      this.tick += steps;
    }
    return steps;
  }
  update(nowMs) {
    const now = Number(nowMs);
    if (!Number.isFinite(now)) return 0;
    if (this.lastTimeMs == null) { this.lastTimeMs = now; return 0; }
    const delta = Math.min(250, Math.max(0, now - this.lastTimeMs));
    this.lastTimeMs = now;
    return this.advanceTime(delta);
  }
  snapshot() { return Object.freeze({ tick: this.tick, stepMs: this.stepMs, speed: this.speed, paused: this.paused }); }
}
