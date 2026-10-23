/** Presentation-only damped pendulum. Event identity belongs to the C stream. */
export class DampedLamp {
  constructor() { this.reset(); }
  reset() { this.angle = 0; this.velocity = 0; this.lastTime = null; this.impulses = 0; }
  impulse(strength = 1) {
    this.velocity = Math.max(-2.2, Math.min(2.2, this.velocity + strength * 0.48));
    this.impulses += 1;
  }
  step(timeSeconds, enabled = true) {
    if (!Number.isFinite(timeSeconds)) return this.angle;
    if (this.lastTime === null || !enabled) { this.lastTime = timeSeconds; return this.angle; }
    let remaining = Math.max(0, Math.min(timeSeconds - this.lastTime, 0.05));
    this.lastTime = timeSeconds;
    while (remaining > 0) {
      const dt = Math.min(remaining, 1 / 120);
      const acceleration = -14 * Math.sin(this.angle) - 2.8 * this.velocity;
      this.velocity += acceleration * dt;
      this.angle = Math.max(-0.35, Math.min(0.35, this.angle + this.velocity * dt));
      if (Math.abs(this.angle) >= 0.35) this.velocity *= 0.4;
      remaining -= dt;
    }
    if (Math.abs(this.angle) < 0.0004 && Math.abs(this.velocity) < 0.004) {
      this.angle = this.velocity = 0;
    }
    return this.angle;
  }
}

export class LampEventBridge {
  constructor(lamp, {projector = null, preserveMotion = false} = {}) {
    this.lamp = lamp; this.projector = projector; this.preserveMotion = preserveMotion;
    this.seen = new Set(); this.generation = null;
  }
  setProjector(projector) { this.projector = projector; }
  receive(message) {
    if (message.type === 'reset' || message.type === 'gap') { this.reset(); return; }
    const event = message.event;
    if (!event) return;
    if (this.generation !== event.generation) { this.reset(); this.generation = event.generation; }
    const boulder = event.kind === 'world.boulder.impact' &&
      event.supportedContact && event.coordinateSpace === 'rdx-world' &&
      event.submap === 0 && this.projector?.selected?.calibration;
    if (event.kind !== 'item.dynamite.exploded' && !boulder) return;
    const key = `${event.generation}:${event.serial}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    if (this.seen.size > 256) this.seen.delete(this.seen.values().next().value);
    // Where it happened in the room (when the spatial profile maps it), so nearer props react more.
    const point = event.world && this.projector?.selected?.calibration ? this.projector.project(event.world) : null;
    if (boulder) {
      if (!point) return;
      const side = point.x < 0.7 ? -1 : 1;
      this.lamp.impulse(side*this.projector.selected.calibration.lampImpact, point);
    } else this.lamp.impulse(1, point);
  }
  reset() {
    this.seen.clear(); this.generation = null;
    if (!this.preserveMotion) this.lamp.reset();
  }
}
