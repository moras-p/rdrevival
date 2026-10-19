/** Quest-oriented render budget. Applied before WebXRManager.setSession(), when
 * the XR framebuffer resolution can still be changed. Does not affect 2D. */
export function xrRenderSettings(search = '') {
  const raw = new URLSearchParams(search).get('vr-scale');
  const requested = raw === null || raw.trim() === '' ? NaN : Number(raw);
  return {
    scale: Number.isFinite(requested) ? Math.max(0.5, Math.min(1, requested)) : 0.7,
    foveation: 1
  };
}

/** CPU timings are not GPU timings; the observed submission rate also includes
 * browser scheduling, native ticks, compositor stalls, and GPU backpressure. */
export class VRFrameDiagnostics {
  constructor(windowMs = 2000) {
    this.windowMs = windowMs;
    this.reset();
  }
  reset() {
    this.start = null;
    this.frames = 0;
    this.presentationMs = 0;
    this.renderCpuMs = 0;
    this.latest = null;
  }
  record(now, presentationMs, renderCpuMs) {
    if (this.start === null) this.start = now;
    this.frames++;
    this.presentationMs += presentationMs;
    this.renderCpuMs += renderCpuMs;
    const elapsed = now - this.start;
    if (elapsed < this.windowMs || this.frames < 2) return null;
    const report = {
      fps: 1000 * (this.frames - 1) / Math.max(1, elapsed),
      presentationMs: this.presentationMs / this.frames,
      renderCpuMs: this.renderCpuMs / this.frames,
      frames: this.frames,
      windowMs: elapsed
    };
    this.reset();
    this.latest = report;
    return report;
  }
}
