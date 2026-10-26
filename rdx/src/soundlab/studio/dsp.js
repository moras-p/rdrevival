/* Shared DSP building blocks for the Studio renderer and Foley producer. */

export const TAU = Math.PI * 2;
export const dbToGain = db => Math.pow(10, db / 20);
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* Mulberry32: tiny seeded PRNG so variants are reproducible. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* RBJ cookbook biquad, transposed direct form II. */
export class Biquad {
  constructor() { this.z1 = 0; this.z2 = 0; this.set('allpass', 1000, 0.7, 0, 48000); }
  set(type, freq, q, gainDb, sr) {
    const f = Math.max(10, Math.min(sr * 0.45, freq));
    const w = TAU * f / sr, cos = Math.cos(w), sin = Math.sin(w), alpha = sin / (2 * Math.max(0.05, q));
    const A = Math.pow(10, gainDb / 40);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'lowpass') { b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = b0; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; }
    else if (type === 'highpass') { b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = b0; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; }
    else if (type === 'bandpass') { b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; }
    else if (type === 'peak') { b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A; }
    else if (type === 'lowshelf' || type === 'highshelf') {
      const s = 2 * Math.sqrt(A) * alpha, sign = type === 'lowshelf' ? 1 : -1;
      b0 = A * ((A + 1) - sign * (A - 1) * cos + s); b1 = sign * 2 * A * ((A - 1) - sign * (A + 1) * cos); b2 = A * ((A + 1) - sign * (A - 1) * cos - s);
      a0 = (A + 1) + sign * (A - 1) * cos + s; a1 = -sign * 2 * ((A - 1) + sign * (A + 1) * cos); a2 = (A + 1) + sign * (A - 1) * cos - s;
    } else { b0 = 1; b1 = 0; b2 = 0; a0 = 1; a1 = 0; a2 = 0; }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
  }
  run(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}


/* Stable 32-bit seed from a seed and a tag. */
export function hashSeed(seed, tag) {
  let h = 2166136261 >>> 0;
  for (const ch of String(tag)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return (Number(seed) ^ h) >>> 0;
}

export function mixInto(target, src, offset, gain = 1) {
  const start = Math.max(0, -offset), stop = Math.min(src.length, target.length - offset);
  for (let i = start; i < stop; i++) target[offset + i] += src[i] * gain;
}

/* Two-pole resonator tuned to a frequency and a T60 decay. */
export class Resonator {
  constructor(freq, t60Ms, sr, gain = 1) {
    const r = Math.pow(10, -3 / Math.max(1, t60Ms * sr / 1000));
    this.a1 = 2 * r * Math.cos(TAU * Math.min(freq, sr * 0.45) / sr); this.a2 = -r * r;
    this.g = gain * (1 - r); this.y1 = 0; this.y2 = 0;
  }
  run(x) { const y = x * this.g + this.a1 * this.y1 + this.a2 * this.y2; this.y2 = this.y1; this.y1 = y; return y; }
}

/* One-pole smoothing of a control signal (e.g. a speed trace). */
export function onePole(cutoffHz, sr) { return Math.exp(-TAU * cutoffHz / sr); }
