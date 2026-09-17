function int(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? Math.trunc(n) : fallback; }
function pointFor(actor) {
  const bounds = actor?.worldGeometry?.bounds;
  if (!bounds) return null;
  return Object.freeze([bounds.x + Math.floor(bounds.width / 2), bounds.y + Math.floor(bounds.height / 2)]);
}

export class NativeObservationTimeline {
  constructor({ maxSamples = 300 } = {}) {
    this.maxSamples = Math.max(32, int(maxSamples, 300));
    this.reset();
  }
  reset() { this.samples = []; this.cursor = -1; }
  get length() { return this.samples.length; }
  isLive() { return this.cursor < 0 || this.cursor === this.samples.length - 1; }
  current() { return this.cursor >= 0 ? this.samples[this.cursor] || null : this.samples.at(-1) || null; }
  live() { this.cursor = this.samples.length ? this.samples.length - 1 : -1; return this.current(); }
  record(sample) {
    if (!sample) return this.current();
    if (this.samples.at(-1)?.frameSerial === sample.frameSerial) return this.samples.at(-1);
    this.samples.push(sample);
    if (this.samples.length > this.maxSamples) this.samples.splice(0, this.samples.length - this.maxSamples);
    this.cursor = this.samples.length - 1;
    return sample;
  }
  scrub(index) {
    if (!this.samples.length) { this.cursor = -1; return null; }
    this.cursor = Math.max(0, Math.min(this.samples.length - 1, int(index)));
    return this.current();
  }
  move(delta) { return this.scrub((this.cursor < 0 ? this.samples.length - 1 : this.cursor) + int(delta)); }
  traces({ sourceKey = null, classes = null } = {}) {
    const allowed = classes ? new Set(classes) : null;
    const traces = new Map();
    for (const sample of this.samples) {
      for (const actor of sample.actors || []) {
        if (sourceKey && actor.sourceKey !== String(sourceKey)) continue;
        if (allowed && !allowed.has(actor.class) && !allowed.has(actor.family)) continue;
        const point = pointFor(actor);
        if (!point) continue;
        if (!traces.has(actor.sourceKey)) traces.set(actor.sourceKey, []);
        const points = traces.get(actor.sourceKey);
        if (!points.length || points.at(-1)[0] !== point[0] || points.at(-1)[1] !== point[1]) points.push(point);
      }
    }
    return new Map([...traces].map(([key, points]) => [key, Object.freeze(points.slice())]));
  }
  events() { return Object.freeze(this.samples.flatMap(sample => sample.events || [])); }
  snapshot() { return Object.freeze({ length: this.length, cursor: this.cursor, maxSamples: this.maxSamples, live: this.isLive(), currentFrame: this.current()?.frameSerial ?? null }); }
}
