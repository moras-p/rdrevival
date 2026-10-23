/** Quest render settings, applied before WebXRManager.setSession() while the XR
 * framebuffer can still be sized. The baked room is unlit with few draw calls, so
 * Quest 3 can afford above-recommended resolution, 4x MSAA and no foveation
 * (fixed foveation blurs and shimmers the periphery). ?vr-scale=0.5..1.5 overrides. */
export function xrRenderSettings(search = '') {
  const raw = new URLSearchParams(search).get('vr-scale');
  const requested = raw === null || raw.trim() === '' ? NaN : Number(raw);
  return {
    scale: Number.isFinite(requested) ? Math.max(0.5, Math.min(1.5, requested)) : 1.2,
    foveation: 0,
    antialias: true
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
    this.nativeSteps = 0;
    this.canvasChanges = 0;
    this.lastNativeSerial = null;
    this.lastRevision = null;
    this.latest = null;
  }
  record(now, presentationMs, renderCpuMs, nativeSerial = null, revision = null) {
    if (this.start === null) this.start = now;
    this.frames++;
    this.presentationMs += presentationMs;
    this.renderCpuMs += renderCpuMs;
    if (nativeSerial !== null) {
      if (this.lastNativeSerial !== null) {
        const delta = (nativeSerial - this.lastNativeSerial) >>> 0;
        // Ignore level/session counter resets instead of reporting billions
        // of native frames per second in the headset debug overlay.
        if (delta < 1000) this.nativeSteps += delta;
      }
      this.lastNativeSerial = nativeSerial;
    }
    if (revision !== null) {
      if (this.lastRevision !== null && revision !== this.lastRevision)
        this.canvasChanges++;
      this.lastRevision = revision;
    }
    const elapsed = now - this.start;
    if (elapsed < this.windowMs || this.frames < 2) return null;
    const report = {
      fps: 1000 * (this.frames - 1) / Math.max(1, elapsed),
      presentationMs: this.presentationMs / this.frames,
      renderCpuMs: this.renderCpuMs / this.frames,
      nativeFps: 1000 * this.nativeSteps / Math.max(1, elapsed),
      canvasFps: 1000 * this.canvasChanges / Math.max(1, elapsed),
      frames: this.frames,
      windowMs: elapsed
    };
    this.reset();
    this.latest = report;
    return report;
  }
}
