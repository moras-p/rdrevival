/* SoundLab Studio Foley producer.
 *
 * Procedural Foley generation driven by the recorded scene (what moves,
 * what it is made of, what it hits or rolls on, how fast, for how long, in
 * which room), by a plain-language description, and optionally steered
 * toward a reference recording by fitting the generator's controls to the
 * reference's measured features. Everything is deterministic for a given
 * recipe and seed and pure (no DOM, no Web Audio), so it runs in the page,
 * in the renderer as a `foley` layer and under node --test.
 *
 * Models are small physically-informed recipes: modal resonances of the
 * material excited by strikes, friction or noise, plus the model-specific
 * parts (rotation lumps for rolling, stick-slip for scraping, ratchet clicks
 * for mechanisms, boom and debris for explosions, ...). */

import { Biquad, Resonator, TAU, clamp, hashSeed, onePole, rng } from './dsp.js';
import { SPEC_EDGES, analyze } from './analysis.js';
import { CATALOG_BY_ID, entityTypeInfo } from './catalog.js';

export const FOLEY_SCHEMA = 'soundlab.foley.v1';
export const FOLEY_RATE = 48000;
const MOTION_HZ = 25;
const SPEED_REF = 120; /* px/s that counts as "moving briskly" */

/* Modal recipes: base frequency, mode ratios, T60 per mode (ms), mode gains,
 * how sharp a strike is and how noisy the contact is. */
export const MATERIALS = Object.freeze({
  stone: { label: 'Stone', f0: 170, ratios: [1, 1.58, 2.37, 3.41, 4.6, 6.1], decays: [230, 180, 135, 100, 72, 52], gains: [1, 0.75, 0.6, 0.5, 0.42, 0.36], hardness: 0.7, roughness: 0.55 },
  sandstone: { label: 'Sandstone', f0: 210, ratios: [1, 1.62, 2.45, 3.6, 4.9], decays: [170, 130, 95, 70, 50], gains: [1, 0.7, 0.55, 0.42, 0.33], hardness: 0.55, roughness: 0.7 },
  masonry: { label: 'Masonry', f0: 150, ratios: [1, 1.6, 2.5, 3.9, 5.8], decays: [240, 200, 160, 115, 80], gains: [1, 0.76, 0.6, 0.5, 0.44], hardness: 0.6, roughness: 0.5 },
  concrete: { label: 'Concrete', f0: 120, ratios: [1, 1.64, 2.65, 4.07, 6.1, 9.1], decays: [280, 220, 170, 120, 82, 53], gains: [1, 0.76, 0.61, 0.51, 0.44, 0.38], hardness: 0.6, roughness: 0.45 },
  metal: { label: 'Metal', f0: 380, ratios: [1, 2.76, 5.4, 8.93, 13.34], decays: [1100, 820, 600, 420, 300], gains: [1, 0.8, 0.65, 0.5, 0.4], hardness: 0.9, roughness: 0.2 },
  wood: { label: 'Wood', f0: 240, ratios: [1, 2.08, 3.32, 4.95], decays: [140, 90, 60, 40], gains: [1, 0.6, 0.42, 0.3], hardness: 0.5, roughness: 0.4 },
  dirt: { label: 'Dirt / earth', f0: 85, ratios: [1, 1.9, 3.1], decays: [70, 45, 28], gains: [1, 0.5, 0.3], hardness: 0.2, roughness: 0.8 },
  gravel: { label: 'Gravel', f0: 900, ratios: [1, 1.37, 1.91, 2.6], decays: [40, 32, 25, 18], gains: [1, 0.9, 0.8, 0.7], hardness: 0.75, roughness: 0.95 },
  flesh: { label: 'Body / flesh', f0: 105, ratios: [1, 1.7, 2.6], decays: [75, 48, 30], gains: [1, 0.55, 0.3], hardness: 0.15, roughness: 0.3 },
  leather: { label: 'Leather / boot', f0: 320, ratios: [1, 1.9, 3.2], decays: [38, 25, 16], gains: [1, 0.5, 0.3], hardness: 0.35, roughness: 0.35 },
  glass: { label: 'Glass / ceramic', f0: 1200, ratios: [1, 2.32, 4.25, 6.63], decays: [700, 420, 260, 160], gains: [1, 0.7, 0.5, 0.35], hardness: 0.95, roughness: 0.1 }
});

export const FOLEY_MODELS = Object.freeze({
  impact: { label: 'Impact', continuous: false, help: 'A hit, drop or landing: material resonance, transient, bounces and debris' },
  roll: { label: 'Rolling', continuous: true, help: 'Rolling object: rotation lumps, surface micro-impacts and rumble, following recorded speed' },
  scrape: { label: 'Scrape / grind', continuous: true, help: 'Friction: stick-slip chatter and filtered noise through the material, following speed' },
  footsteps: { label: 'Footstep', continuous: false, help: 'Heel and toe strikes on the surface with a scuff' },
  mechanism: { label: 'Mechanism', continuous: true, help: 'Gears and ratchets: clicks whose rate follows speed, whine and motor hum, clunk on start' },
  explosion: { label: 'Explosion', continuous: false, help: 'Crack, pitch-dropping boom, filtered body and falling debris on the surface' },
  gunshot: { label: 'Gunshot', continuous: false, help: 'Mechanism click, crack, body and room tail' },
  whoosh: { label: 'Whoosh / swing', continuous: true, help: 'Air movement whose pitch and level follow speed' },
  fire: { label: 'Fire / jet', continuous: true, help: 'Flickering roar with crackles' },
  crumble: { label: 'Crumble / collapse', continuous: false, help: 'Initial crack then many falling fragments and dust' },
  creature: { label: 'Creature', continuous: false, help: 'Formant-filtered bark or growl' },
  chime: { label: 'Chime / pickup', continuous: false, help: 'Bell partials, one or two notes' }
});

/* name: [min, max, default, unit, label, help] */
export const FOLEY_PARAMS = Object.freeze({
  intensity: [0, 1, 0.7, '', 'Intensity', 'How hard or energetic the action is'],
  size: [0, 1, 0.5, '', 'Size', 'Object size: bigger is lower and longer'],
  weight: [0, 1, 0.5, '', 'Weight', 'Mass: low-end body, rumble and thump'],
  hardness: [0, 1, 0.5, '', 'Hardness', 'Contact sharpness: soft thud to hard click'],
  roughness: [0, 1, 0.4, '', 'Roughness', 'Grit, irregularity and crackle'],
  resonance: [0, 1, 0.5, '', 'Resonance', 'How long the material rings'],
  brightness: [0, 1, 0.5, '', 'Brightness', 'Spectral tilt: dark to bright'],
  density: [0, 1, 0.4, '', 'Density', 'Event rate: bumps, clicks, fragments, crackles'],
  bounce: [0, 1, 0, '', 'Bounces', 'Secondary bounces after an impact'],
  distance: [0, 1, 0, '', 'Distance', 'Microphone distance: far is quieter and duller'],
  speed: [0, 400, 80, 'px/s', 'Speed', 'Speed when no recorded motion is used'],
  durationMs: [30, 8000, 600, 'ms', 'Length', 'Length when no recorded motion is used'],
  seed: [0, 2147483647, 1, '', 'Seed', 'Random seed for this take']
});
export const FOLEY_NUMERIC = Object.freeze(Object.keys(FOLEY_PARAMS));
/* Match EQ: eight peaking bands (one per six analysis bins, 31 Hz-13 kHz)
 * that a reference fit sets to bend the generated spectrum toward the
 * reference. recipe.eq is an array of band gains in dB (absent = flat). */
export const EQ_BANDS = Object.freeze(Array.from({ length: 8 }, (_, g) => Math.round(Math.sqrt(SPEC_EDGES[g * 6] * SPEC_EDGES[g * 6 + 6]))));
export const EQ_LIMIT_DB = 18;
/* Controls a reference fit may move (seed and timing stay with the scene). */
export const FIT_PARAMS = Object.freeze(['intensity', 'size', 'weight', 'hardness', 'roughness', 'resonance', 'brightness', 'density', 'bounce', 'durationMs']);

export function defaultFoley(overrides = {}) {
  const base = { schema: FOLEY_SCHEMA, model: 'impact', material: 'stone', surface: 'stone', followMotion: true };
  for (const [k, spec] of Object.entries(FOLEY_PARAMS)) base[k] = spec[2];
  return normalizeFoley({ ...base, ...overrides }).foley;
}

/* Bounded copy of a recipe plus a report, the same contract as design patches. */
export function normalizeFoley(input = {}, base = null) {
  const out = base ? { ...base } : { schema: FOLEY_SCHEMA, model: 'impact', material: 'stone', surface: 'stone', followMotion: true, ...Object.fromEntries(Object.entries(FOLEY_PARAMS).map(([k, s]) => [k, s[2]])) };
  const report = { applied: [], clamped: [], rejected: [] };
  for (const [k, v] of Object.entries(input)) {
    if (k === 'schema') continue;
    if (k === 'model') { if (FOLEY_MODELS[v]) { out.model = v; report.applied.push(k); } else report.rejected.push(k); continue; }
    if (k === 'material' || k === 'surface') { if (MATERIALS[v]) { out[k] = v; report.applied.push(k); } else report.rejected.push(k); continue; }
    if (k === 'followMotion') { out.followMotion = !!v; report.applied.push(k); continue; }
    if (k === 'eq') {
      if (v == null || (Array.isArray(v) && !v.length)) { delete out.eq; report.applied.push(k); continue; }
      if (!Array.isArray(v) || v.length !== EQ_BANDS.length || v.some(x => !Number.isFinite(Number(x)))) { report.rejected.push(k); continue; }
      const eq = v.map(x => Math.round(clamp(Number(x), -EQ_LIMIT_DB, EQ_LIMIT_DB) * 10) / 10);
      if (eq.some((x, i) => x !== Number(v[i]) && Math.abs(x - Number(v[i])) > 0.05)) report.clamped.push(k);
      if (eq.every(x => x === 0)) delete out.eq; else out.eq = eq;
      report.applied.push(k); continue;
    }
    const spec = FOLEY_PARAMS[k], n = Number(v);
    if (!spec || !Number.isFinite(n)) { report.rejected.push(k); continue; }
    let c = clamp(n, spec[0], spec[1]);
    if (k === 'seed') c = Math.round(c);
    out[k] = c; report.applied.push(k);
    if (c !== n) report.clamped.push(k);
  }
  return { foley: out, report };
}

/* ---------- rendering ---------- */

function modeBank(materialId, p, sr, random, { sizeScale = 1 } = {}) {
  const m = MATERIALS[materialId] || MATERIALS.stone;
  const size = clamp(p.size * sizeScale, 0, 1);
  const f0 = m.f0 * Math.pow(2, (0.5 - size) * 2.6);
  const decayScale = (0.3 + 1.4 * p.resonance) * (0.7 + 0.6 * size);
  const n = m.ratios.length;
  const modes = m.ratios.map((r, i) => ({
    freq: Math.min(sr * 0.45, f0 * r * (1 + (random() * 2 - 1) * 0.015)),
    t60: Math.max(8, m.decays[i] * decayScale),
    gain: m.gains[i] * Math.pow(2, (p.brightness - 0.5) * 3 * i / Math.max(1, n - 1)) * Math.pow(p.intensity + 0.2, i * 0.22)
  }));
  if (p.weight > 0.05) modes.unshift({ freq: f0 * 0.5, t60: m.decays[0] * decayScale * 1.3, gain: p.weight * 1.1 });
  return { modes, hardness: clamp((m.hardness + p.hardness) / 2, 0, 1), roughness: clamp((m.roughness + p.roughness) / 2, 0, 1) };
}

/* One strike: a short filtered-noise transient plus decaying modes. */
function strike(out, at, amp, bank, sr, random) {
  if (at >= out.length || amp <= 0) return;
  const h = bank.hardness;
  const tLen = Math.max(4, Math.round((1.5 + (1 - h) * 10) * sr / 1000));
  const a = onePole(1500 + h * 12000, sr);
  let lp = 0;
  for (let i = 0; i < tLen && at + i < out.length; i++) {
    lp = (1 - a) * (random() * 2 - 1) + a * lp;
    out[at + i] += lp * amp * (0.5 + h) * Math.exp(-5 * i / tLen);
  }
  for (const m of bank.modes) {
    const len = Math.min(out.length - at, Math.round(m.t60 * sr / 1000));
    const d = Math.exp(-Math.log(1000) / Math.max(1, m.t60 * sr / 1000));
    const w = TAU * m.freq / sr, cw = Math.cos(w), sw = Math.sin(w);
    const ph = random() * TAU;
    let c = Math.cos(ph), s = Math.sin(ph), env = amp * m.gain * 0.35;
    for (let i = 0; i < len; i++) {
      out[at + i] += s * env;
      const nc = c * cw - s * sw; s = c * sw + s * cw; c = nc; env *= d;
    }
  }
}

function resonate(exc, bank, sr, gain = 1) {
  const res = bank.modes.map(m => new Resonator(m.freq, m.t60, sr, m.gain));
  const out = new Float32Array(exc.length);
  for (let i = 0; i < exc.length; i++) {
    let y = 0; const x = exc[i];
    for (const r of res) y += r.run(x);
    out[i] = y * gain * 6;
  }
  return out;
}

function motionReader(p, motion, totalSec, { bell = false } = {}) {
  const use = p.followMotion && Array.isArray(motion) && motion.length > 1;
  return t => {
    if (use) {
      const f = clamp(t * MOTION_HZ, 0, motion.length - 1), k = Math.floor(f), fr = f - k;
      const a = Number(motion[k]) || 0, b = Number(motion[Math.min(motion.length - 1, k + 1)]) || 0;
      return (a + (b - a) * fr) / SPEED_REF;
    }
    const v = p.speed / SPEED_REF;
    return bell ? v * 1.3 * Math.pow(Math.sin(Math.PI * clamp(t / totalSec, 0, 1)), 1.5) : v;
  };
}

export function foleyLengthMs(p, motion) {
  const continuous = FOLEY_MODELS[p.model]?.continuous;
  if (continuous && p.followMotion && Array.isArray(motion) && motion.length > 1) return motion.length * 1000 / MOTION_HZ + 150;
  return p.durationMs;
}

const MODELS = {
  impact(out, p, sr, random) {
    const obj = modeBank(p.material, p, sr, random), surf = modeBank(p.surface, p, sr, random, { sizeScale: 1.4 });
    strike(out, 0, p.intensity, obj, sr, random);
    if (p.surface !== p.material) strike(out, 0, p.intensity * 0.45, surf, sr, random);
    thump(out, 0, p.weight * p.intensity, 45 + 50 * (1 - p.size), 60 + 160 * p.weight, sr);
    let t = 0, gap = 0.09 + 0.18 * p.size;
    for (let k = 1; k <= Math.round(p.bounce * 5); k++) {
      t += gap; gap *= 0.62;
      strike(out, Math.round(t * sr), p.intensity * Math.pow(0.45, k), obj, sr, random);
    }
    debris(out, p, surf, sr, random, Math.round(p.roughness * p.intensity * 14), 0.02, 0.35);
  },
  roll(out, p, sr, random) {
    const total = out.length / sr, read = motionReader(p, this.motion, total);
    const obj = modeBank(p.material, p, sr, random), surf = modeBank(p.surface, p, sr, random, { sizeScale: 0.6 });
    const exc = new Float32Array(out.length), rumble = new Float32Array(out.length);
    const diam = 8 + p.size * 40;
    let brown = 0, phase = 0, lp = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / sr, v = Math.max(0, read(t));
      const rate = (5 + p.density * 70) * v;
      if (random() < rate / sr) exc[i] += Math.pow(v, 0.8) * (0.4 + 0.6 * random()) * (0.5 + obj.roughness);
      const w = random() * 2 - 1;
      brown = (brown + 0.02 * w) / 1.02;
      exc[i] += w * obj.roughness * 0.05 * v;
      phase += (v * SPEED_REF) / (Math.PI * diam) * 3 / sr;
      const lump = 1 + p.roughness * 0.6 * Math.sin(TAU * phase);
      const a = onePole(70 + 160 * Math.min(2, v), sr);
      lp = (1 - a) * brown * 3.5 + a * lp;
      rumble[i] = lp * (0.3 + p.weight) * Math.pow(Math.min(2, v), 0.7) * lump * 4;
    }
    const body = resonate(exc, obj, sr), grit = resonate(exc, surf, sr, 0.5);
    for (let i = 0; i < out.length; i++) out[i] += body[i] + grit[i] + rumble[i];
  },
  scrape(out, p, sr, random) {
    const total = out.length / sr, read = motionReader(p, this.motion, total);
    const bank = modeBank(p.material, p, sr, random, { sizeScale: 0.8 });
    const bp = new Biquad(); bp.set('bandpass', 400 + 3000 * p.brightness, 0.8, 0, sr);
    const exc = new Float32Array(out.length);
    let next = 0;
    for (let i = 0; i < out.length; i++) {
      const v = Math.max(0, read(i / sr));
      exc[i] = bp.run(random() * 2 - 1) * v * (0.4 + bank.roughness);
      if (i >= next) {
        exc[i] += v * (0.3 + 0.7 * random()) * bank.hardness;
        const rate = 15 + 180 * Math.min(2, v) * (0.2 + p.density);
        next = i + Math.round(sr / rate * (0.6 + 0.8 * random()));
      }
    }
    const body = resonate(exc, bank, sr, 0.7);
    for (let i = 0; i < out.length; i++) out[i] += body[i] + exc[i] * 0.35;
  },
  footsteps(out, p, sr, random) {
    const surf = modeBank(p.surface, { ...p, size: 0.2 + p.size * 0.3 }, sr, random);
    const shoe = modeBank(p.material, { ...p, size: 0.3 }, sr, random);
    strike(out, 0, p.intensity, surf, sr, random);
    strike(out, 0, p.intensity * 0.4, shoe, sr, random);
    thump(out, 0, p.weight * p.intensity * 0.6, 70, 50, sr);
    const toe = Math.round((0.045 + 0.04 * random()) * sr);
    strike(out, toe, p.intensity * 0.5, surf, sr, random);
    const bp = new Biquad(); bp.set('bandpass', 1500 + 2500 * p.brightness, 0.9, 0, sr);
    const len = Math.round((0.03 + 0.04 * p.roughness) * sr);
    for (let i = 0; i < len && toe + i < out.length; i++) out[toe + i] += bp.run(random() * 2 - 1) * p.roughness * 0.5 * (1 - i / len);
  },
  mechanism(out, p, sr, random) {
    const total = out.length / sr, read = motionReader(p, this.motion, total);
    const bank = modeBank(p.material, { ...p, size: p.size * 0.5 }, sr, random);
    const clunk = modeBank(p.material, p, sr, random);
    strike(out, 0, p.intensity * 0.8, clunk, sr, random);
    thump(out, 0, p.weight * p.intensity * 0.7, 60, 90, sr);
    let ph = 0, whine = 0, hum = 0, lp = 0;
    const humAmp = p.weight * 0.12, whineAmp = 0.04 + p.brightness * 0.06;
    for (let i = 0; i < out.length; i++) {
      const v = Math.min(2, Math.max(0, read(i / sr)));
      ph += (3 + p.density * 25) * (0.3 + 0.7 * v) / sr;
      if (ph >= 1 && v > 0.02) { ph -= 1; strike(out, i, (0.35 + 0.4 * random()) * p.intensity * Math.min(1, v + 0.2), bank, sr, random); }
      whine += (60 + 500 * v * (0.5 + p.brightness)) / sr; whine -= Math.floor(whine);
      hum += (45 + 30 * p.size) / sr; hum -= Math.floor(hum);
      const a = onePole(900, sr);
      lp = (1 - a) * (2 * whine - 1) + a * lp;
      out[i] += (lp * whineAmp + Math.sin(TAU * hum) * humAmp) * v + (random() * 2 - 1) * p.roughness * 0.03 * v;
    }
  },
  explosion(out, p, sr, random) {
    const total = out.length / sr;
    const crack = Math.round(0.004 * sr);
    for (let i = 0; i < crack; i++) out[i] += (random() * 2 - 1) * p.intensity * (1 - i / crack) * (0.5 + p.hardness);
    const f0 = 30 + 45 * (1 - p.size);
    let ph = 0;
    const tau = 0.15 + 0.45 * p.weight;
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      ph += f0 * (1 + 1.5 * Math.exp(-t / 0.05)) / sr;
      out[i] += Math.sin(TAU * ph) * Math.exp(-t / tau) * (0.4 + p.weight) * p.intensity;
    }
    const lp = new Biquad();
    let brown = 0;
    const tb = Math.max(0.08, total / 4);
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      if (i % 64 === 0) lp.set('lowpass', 150 + (3000 + 4000 * p.brightness) * Math.exp(-t / (total * 0.3 + 0.01)), 0.7, 0, sr);
      brown = (brown + 0.04 * (random() * 2 - 1)) / 1.04;
      out[i] += lp.run((random() * 2 - 1) * 0.5 + brown * 3) * Math.exp(-t / tb) * p.intensity * 0.8;
    }
    debris(out, p, modeBank(p.surface, p, sr, random, { sizeScale: 0.4 }), sr, random, Math.round(p.density * 40), 0.08, Math.max(0.2, total * 0.8));
  },
  gunshot(out, p, sr, random) {
    strike(out, 0, 0.25 * p.intensity, modeBank('metal', { ...p, size: 0.15 }, sr, random), sr, random);
    const crack = Math.round(0.0015 * sr);
    for (let i = 0; i < crack; i++) out[i] += (random() * 2 - 1) * p.intensity;
    const bp = new Biquad(); bp.set('bandpass', 500 + 1500 * p.brightness, 1.2, 0, sr);
    const lp = new Biquad(); lp.set('lowpass', 1200, 0.7, 0, sr);
    const tBody = (25 + 40 * p.size) / 1000, tTail = (80 + 300 * p.resonance) / 1000;
    for (let i = 0; i < out.length; i++) {
      const t = i / sr, w = random() * 2 - 1;
      out[i] += bp.run(w) * Math.exp(-t / tBody) * p.intensity * 1.6 + lp.run(w) * Math.exp(-t / tTail) * 0.25 * p.intensity;
    }
    thump(out, 0, p.weight * p.intensity * 0.8, 120, 40, sr);
  },
  whoosh(out, p, sr, random) {
    const total = out.length / sr, read = motionReader(p, this.motion, total, { bell: true });
    const bp = new Biquad(), lp = new Biquad();
    lp.set('lowpass', 300, 0.7, 0, sr);
    for (let i = 0; i < out.length; i++) {
      const v = Math.min(2.5, Math.max(0, read(i / sr)));
      if (i % 32 === 0) bp.set('bandpass', 250 + 3000 * v * (0.4 + p.brightness), 1.2 + p.roughness, 0, sr);
      const w = random() * 2 - 1;
      out[i] += (bp.run(w) * 1.5 + lp.run(w) * p.weight) * Math.pow(v, 1.6) * p.intensity;
    }
  },
  fire(out, p, sr, random) {
    const total = out.length / sr, read = motionReader(p, this.motion, total);
    const lp = new Biquad(); lp.set('lowpass', 300 + 1500 * p.brightness, 0.7, 0, sr);
    const lo = new Biquad(); lo.set('lowpass', 150, 0.7, 0, sr);
    let flick = 0, target = 1, b0 = 0;
    const fa = onePole(8, sr);
    for (let i = 0; i < out.length; i++) {
      if (i % Math.round(sr / 12) === 0) target = 1 - p.roughness * random();
      flick = (1 - fa) * target + fa * flick;
      const v = Math.min(2, Math.max(0.15, read(i / sr) || 1));
      const w = random() * 2 - 1;
      b0 = 0.98 * b0 + w * 0.2;
      out[i] += (lp.run(w) * 0.8 + lo.run(b0) * p.weight * 2) * flick * v * p.intensity;
      if (random() < (p.density * 40) / sr) {
        const n = Math.round((0.0008 + 0.002 * random()) * sr);
        for (let k = 0; k < n && i + k < out.length; k++) out[i + k] += (random() * 2 - 1) * (0.3 + 0.5 * p.brightness) * (1 - k / n) * p.intensity;
      }
    }
  },
  crumble(out, p, sr, random) {
    const total = out.length / sr;
    const big = modeBank(p.material, p, sr, random);
    strike(out, 0, p.intensity, big, sr, random);
    const banks = [0.15, 0.3, 0.5].map(s => modeBank(p.material, { ...p, size: s * (0.5 + p.size) }, sr, random));
    const count = Math.round(20 + p.density * 120);
    for (let k = 0; k < count; k++) {
      const t = -Math.log(1 - random() * 0.98) * total / 4;
      if (t >= total) continue;
      strike(out, Math.round(t * sr), p.intensity * (0.15 + 0.4 * random()) * Math.exp(-t / total), banks[k % 3], sr, random);
    }
    const lp = new Biquad(); lp.set('lowpass', 1200 + 2500 * p.brightness, 0.7, 0, sr);
    for (let i = 0; i < out.length; i++) out[i] += lp.run(random() * 2 - 1) * p.roughness * 0.25 * Math.exp(-i / sr / (total / 3 + 0.01)) * p.intensity;
  },
  creature(out, p, sr, random) {
    const barks = 1 + Math.round(p.density * 2);
    const formants = [500, 1400, 2600].map(f => { const b = new Biquad(); b.set('bandpass', f * (1.4 - p.size * 0.6), 4, 0, sr); return b; });
    for (let k = 0; k < barks; k++) {
      const at = Math.round(k * (0.22 + 0.1 * random()) * sr), len = Math.round((0.12 + 0.08 * p.resonance) * sr);
      const f0 = (300 - 220 * p.size) * (1 + 0.1 * random());
      let ph = 0;
      for (let i = 0; i < len && at + i < out.length; i++) {
        const t = i / len;
        ph += f0 * (1 - 0.3 * t) / sr; ph -= Math.floor(ph);
        const src = (2 * ph - 1) * (1 - p.roughness * 0.5) + (random() * 2 - 1) * p.roughness;
        const env = Math.min(1, t * 12) * Math.pow(1 - t, 1.5);
        let y = 0; for (const f of formants) y += f.run(src);
        out[at + i] += y * env * p.intensity * 2;
      }
    }
  },
  chime(out, p, sr, random) {
    const base = (500 + 1800 * (1 - p.size)) * (1 + (random() * 2 - 1) * 0.02), t60 = 300 + 1500 * p.resonance;
    const notes = p.density > 0.5 ? [[0, 1], [0.08 + random() * 0.03, 1.5]] : [[0, 1]];
    for (const [at, mul] of notes) {
      [1, 2.0, 2.76, 4.07, 5.4].forEach((r, i) => {
        const f = base * mul * r * (1 + (random() * 2 - 1) * 0.006); if (f > sr * 0.45) return;
        const start = Math.round(at * sr), len = Math.min(out.length - start, Math.round(t60 / (1 + i * 0.6) * sr / 1000));
        const d = Math.exp(-Math.log(1000) / Math.max(1, len));
        let env = p.intensity * 0.3 / (1 + i * (1.2 - p.brightness));
        for (let k = 0; k < len; k++) { out[start + k] += Math.sin(TAU * f * k / sr) * env; env *= d; }
      });
    }
  }
};

function thump(out, at, amp, freq, tauMs, sr) {
  if (amp <= 0.01) return;
  const len = Math.min(out.length - at, Math.round(tauMs * 5 * sr / 1000));
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    ph += freq * (1 + Math.exp(-t / 0.02)) / sr;
    out[at + i] += Math.sin(TAU * ph) * amp * 0.8 * Math.exp(-t * 1000 / tauMs);
  }
}

function debris(out, p, bank, sr, random, count, fromSec, spanSec) {
  for (let k = 0; k < count; k++) {
    const t = fromSec + Math.pow(random(), 1.6) * spanSec;
    strike(out, Math.round(t * sr), p.intensity * (0.08 + 0.25 * random()) * (1 - (t - fromSec) / (spanSec + fromSec)), bank, sr, random);
  }
}

/* Render a recipe to mono. `motion` is the recorded speed trace (px/s per
 * 25 Hz frame) for continuous models when followMotion is on. */
export function renderFoley(recipe, { sr = FOLEY_RATE, motion = null } = {}) {
  const p = normalizeFoley(recipe).foley;
  const lengthMs = foleyLengthMs(p, motion);
  const out = new Float32Array(Math.max(1, Math.round(lengthMs * sr / 1000)));
  const random = rng(hashSeed(p.seed, `${p.model}:${p.material}:${p.surface}`));
  MODELS[p.model].call({ motion: p.followMotion ? motion : null }, out, p, sr, random);
  return finish(out, p, sr);
}

function finish(out, p, sr) {
  const hs = new Biquad(); hs.set('highshelf', 3000, 0.7, (p.brightness - 0.5) * 12, sr);
  const ls = new Biquad(); ls.set('lowshelf', 150, 0.7, (p.weight - 0.5) * 8, sr);
  const hp = new Biquad(); hp.set('highpass', 25, 0.7, 0, sr);
  const far = p.distance > 0.01 ? new Biquad() : null;
  if (far) far.set('lowpass', 18000 * (1 - p.distance * 0.85), 0.7, 0, sr);
  const eq = (p.eq || []).map((g, i) => {
    if (!g || EQ_BANDS[i] >= sr * 0.45) return null;
    const f = new Biquad(); f.set('peak', EQ_BANDS[i], 1.1, g, sr); return f;
  }).filter(Boolean);
  let peak = 0;
  for (let i = 0; i < out.length; i++) {
    let x = hp.run(ls.run(hs.run(out[i])));
    for (const f of eq) x = f.run(x);
    if (far) x = far.run(x);
    if (!Number.isFinite(x)) x = 0;
    out[i] = x; peak = Math.max(peak, Math.abs(x));
  }
  const target = 0.89 * (0.3 + 0.7 * p.intensity) * (1 - p.distance * 0.6);
  const g = peak > 1e-9 ? target / peak : 0;
  const fade = Math.min(out.length, Math.round(0.006 * sr));
  for (let i = 0; i < out.length; i++) out[i] *= g;
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade;
  return out;
}

/* ---------- description ---------- */

const MATERIAL_WORDS = {
  stone: ['stone', 'rock', 'boulder', 'granite', 'marble', 'temple'], sandstone: ['sandstone', 'sand'], masonry: ['brick', 'masonry', 'castle'],
  concrete: ['concrete', 'bunker'], metal: ['metal', 'metallic', 'iron', 'steel', 'tin', 'chain'], wood: ['wood', 'wooden', 'barrel', 'crate', 'plank', 'log'],
  dirt: ['dirt', 'earth', 'mud', 'soil'], gravel: ['gravel', 'pebble', 'pebbles', 'grit'], flesh: ['flesh', 'body', 'meat', 'creature'],
  leather: ['leather', 'boot', 'boots', 'shoe'], glass: ['glass', 'ceramic', 'pottery', 'crystal']
};
const MODEL_WORDS = {
  roll: ['roll', 'rolling', 'rolls', 'tumble', 'tumbling'], scrape: ['scrape', 'scraping', 'grind', 'grinding', 'drag', 'dragging', 'slide', 'sliding'],
  footsteps: ['step', 'steps', 'footstep', 'footsteps', 'walk', 'walking'], mechanism: ['mechanism', 'gear', 'gears', 'ratchet', 'cog', 'machine', 'motor', 'clockwork', 'winch'],
  explosion: ['explosion', 'explode', 'blast', 'boom', 'detonation'], gunshot: ['gun', 'gunshot', 'shot', 'pistol', 'bullet'],
  whoosh: ['whoosh', 'swing', 'swish', 'swoosh', 'swipe'], fire: ['fire', 'flame', 'flames', 'burning', 'jet', 'torch', 'fuse'],
  crumble: ['crumble', 'crumbling', 'collapse', 'collapsing', 'rubble', 'debris'], creature: ['bark', 'barking', 'growl', 'dog', 'snarl'],
  chime: ['chime', 'pickup', 'bling', 'coin', 'jingle', 'sparkle'], impact: ['impact', 'hit', 'thud', 'slam', 'land', 'landing', 'drop', 'crash', 'knock', 'smash']
};
/* word: [{param: delta}] or {param: ['*', factor]} */
const ADJECTIVES = {
  heavy: { size: 0.2, weight: 0.3 }, huge: { size: 0.3, weight: 0.3 }, massive: { size: 0.3, weight: 0.35 }, big: { size: 0.25, weight: 0.15 }, large: { size: 0.25, weight: 0.15 },
  light: { size: -0.2, weight: -0.25 }, small: { size: -0.25, weight: -0.15 }, tiny: { size: -0.35, weight: -0.3 }, little: { size: -0.2, weight: -0.15 },
  sharp: { hardness: 0.3 }, crisp: { hardness: 0.25, brightness: 0.15 }, snappy: { hardness: 0.3, resonance: -0.15 }, hard: { hardness: 0.25 },
  soft: { hardness: -0.3, intensity: -0.1 }, muffled: { brightness: -0.3, hardness: -0.2 }, dull: { brightness: -0.25, resonance: -0.15 }, padded: { hardness: -0.35 },
  bright: { brightness: 0.3 }, airy: { brightness: 0.25 }, sizzling: { brightness: 0.3, roughness: 0.2 }, dark: { brightness: -0.3 }, warm: { brightness: -0.15, weight: 0.1 },
  deep: { brightness: -0.2, weight: 0.25, size: 0.1 }, low: { brightness: -0.15, weight: 0.15 }, boomy: { weight: 0.3, resonance: 0.15 },
  gritty: { roughness: 0.3 }, rough: { roughness: 0.3 }, crunchy: { roughness: 0.35, hardness: 0.1 }, grainy: { roughness: 0.25 }, rocky: { roughness: 0.25 }, rumbling: { weight: 0.25, roughness: 0.15 },
  smooth: { roughness: -0.3 }, clean: { roughness: -0.25 },
  ringing: { resonance: 0.35 }, resonant: { resonance: 0.3 }, hollow: { resonance: 0.25, weight: -0.1 }, metallic: { resonance: 0.2, brightness: 0.15 },
  dry: { resonance: -0.25 }, dead: { resonance: -0.35 }, tight: { resonance: -0.25, durationMs: ['*', 0.7] }, short: { durationMs: ['*', 0.6], resonance: -0.1 },
  long: { durationMs: ['*', 1.6], resonance: 0.15 }, sustained: { durationMs: ['*', 1.8] }, lingering: { durationMs: ['*', 1.5], resonance: 0.2 },
  distant: { distance: 0.5 }, far: { distance: 0.5 }, faraway: { distance: 0.6 }, close: { distance: -1 }, near: { distance: -1 }, intimate: { distance: -1 },
  loud: { intensity: 0.2 }, powerful: { intensity: 0.25, weight: 0.1 }, violent: { intensity: 0.3, roughness: 0.15 }, strong: { intensity: 0.2 }, forceful: { intensity: 0.25 },
  quiet: { intensity: -0.25 }, gentle: { intensity: -0.25, hardness: -0.1 }, subtle: { intensity: -0.2 }, faint: { intensity: -0.3, distance: 0.2 },
  fast: { speed: ['*', 1.5], density: 0.15 }, quick: { speed: ['*', 1.4], durationMs: ['*', 0.8] }, rapid: { speed: ['*', 1.5], density: 0.25 },
  slow: { speed: ['*', 0.6], density: -0.15 }, lazy: { speed: ['*', 0.5] }, sluggish: { speed: ['*', 0.6] },
  bouncing: { bounce: 0.5 }, bouncy: { bounce: 0.5 }, bounces: { bounce: 0.5 }, dense: { density: 0.3 }, busy: { density: 0.3 }, sparse: { density: -0.3 },
  wet: { brightness: -0.1, roughness: 0.15 }, crackling: { roughness: 0.3, density: 0.25 }, cartoony: { resonance: 0.15, brightness: 0.1 }
};
const INTENSIFIERS = { very: 1.5, extremely: 2, really: 1.4, super: 1.6, slightly: 0.5, somewhat: 0.6, bit: 0.5, little: 0.5, quite: 1.2 };
const PREPOSITIONS = new Set(['on', 'over', 'across', 'against', 'onto', 'into', 'along']);

/* Plain-language description to recipe changes. Deterministic keyword
 * reading: the controlling agent can always set exact values instead. */
export function parseDescription(text = '') {
  const words = String(text).toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean);
  const out = { model: null, material: null, surface: null, deltas: {}, factors: {}, terms: [] };
  let scale = 1, negate = false, surfaceNext = false;
  const findIn = (table, w) => Object.keys(table).find(k => table[k].includes(w));
  for (let i = 0; i < words.length; i++) {
    let w = words[i];
    if (w.endsWith('ly') && ADJECTIVES[w.slice(0, -2)]) w = w.slice(0, -2);
    else if (w.endsWith('ily') && ADJECTIVES[`${w.slice(0, -3)}y`]) w = `${w.slice(0, -3)}y`;
    if (INTENSIFIERS[w] && !(w === 'little' && ADJECTIVES[words[i + 1]] == null)) { scale = INTENSIFIERS[w]; continue; }
    if (w === 'not' || w === 'no' || w === 'without' || w === 'less') { negate = true; continue; }
    if (PREPOSITIONS.has(w)) { surfaceNext = true; continue; }
    const material = findIn(MATERIAL_WORDS, w);
    const model = findIn(MODEL_WORDS, w);
    if (material && surfaceNext) { out.surface = material; out.terms.push(`surface: ${w}`); surfaceNext = false; }
    else if (material && !out.material) { out.material = material; out.terms.push(`material: ${w}`); }
    if (model && !out.model) { out.model = model; out.terms.push(`model: ${w}`); }
    const adj = ADJECTIVES[w];
    if (adj) {
      for (const [k, v] of Object.entries(adj)) {
        if (Array.isArray(v)) out.factors[k] = (out.factors[k] || 1) * (negate ? 1 / v[1] : Math.pow(v[1], scale));
        else out.deltas[k] = (out.deltas[k] || 0) + v * scale * (negate ? -1 : 1);
      }
      out.terms.push(`${negate ? 'not ' : ''}${scale !== 1 ? `${scale}× ` : ''}${w}`);
    }
    if (adj || material || model) { scale = 1; negate = false; }
    if (!material && !adj && !INTENSIFIERS[w] && !['a', 'an', 'the', 'and'].includes(w)) surfaceNext = false;
  }
  return out;
}

export function applyDescription(recipe, parsed) {
  const next = { ...recipe };
  if (parsed.model) next.model = parsed.model;
  if (parsed.material) next.material = parsed.material;
  if (parsed.surface) next.surface = parsed.surface;
  for (const [k, d] of Object.entries(parsed.deltas)) next[k] = (next[k] ?? FOLEY_PARAMS[k][2]) + d;
  for (const [k, f] of Object.entries(parsed.factors)) next[k] = (next[k] ?? FOLEY_PARAMS[k][2]) * f;
  return normalizeFoley(next).foley;
}

/* ---------- scene ---------- */

/* Default model and source material per catalog event. */
export const EVENT_FOLEY = Object.freeze({
  'rick.step': { model: 'footsteps', material: 'leather', size: 0.35, intensity: 0.5 },
  'rick.crawl': { model: 'scrape', material: 'leather', size: 0.3, intensity: 0.4, durationMs: 250 },
  'rick.jump': { model: 'whoosh', material: 'flesh', intensity: 0.4, durationMs: 220, speed: 140 },
  'rick.land': { model: 'impact', material: 'flesh', size: 0.4, hardness: 0.3 },
  'rick.pad': { model: 'impact', material: 'wood', bounce: 0.4, resonance: 0.6 },
  'rick.stick': { model: 'whoosh', material: 'wood', intensity: 0.5, durationMs: 200, speed: 180 },
  'rick.stick-hit': { model: 'impact', material: 'wood', hardness: 0.7, size: 0.3 },
  'rick.death': { model: 'impact', material: 'flesh', intensity: 0.8, durationMs: 700 },
  'weapon.gunfire': { model: 'gunshot', material: 'metal', size: 0.3, durationMs: 450 },
  'weapon.impact': { model: 'impact', material: 'metal', size: 0.1, hardness: 0.85, durationMs: 300 },
  'enemy.hit': { model: 'impact', material: 'flesh', size: 0.4 },
  'enemy.death': { model: 'impact', material: 'flesh', intensity: 0.75, bounce: 0.3 },
  'dynamite.fuse': { model: 'fire', material: 'wood', size: 0.1, brightness: 0.8, density: 0.6, durationMs: 600 },
  'dynamite.fuse-loop': { model: 'fire', material: 'wood', size: 0.1, brightness: 0.8, density: 0.6, durationMs: 1500 },
  'explosion.dynamite': { model: 'explosion', size: 0.5, durationMs: 1400 },
  'explosion.box': { model: 'explosion', material: 'wood', size: 0.4, durationMs: 1100 },
  'trap.boulder.trigger': { model: 'scrape', material: 'stone', size: 0.7, durationMs: 500, speed: 40 },
  'trap.boulder.impact': { model: 'impact', material: 'stone', size: 0.8, weight: 0.8, durationMs: 900 },
  'trap.boulder.roll': { model: 'roll', material: 'stone', size: 0.75, weight: 0.75, followMotion: true },
  'trap.boulder.rolling-loop': { model: 'roll', material: 'stone', size: 0.75, weight: 0.75 },
  'trap.boulder.stop': { model: 'impact', material: 'stone', size: 0.75, weight: 0.8, intensity: 0.5 },
  'trap.dog.trigger': { model: 'creature', material: 'flesh', size: 0.5, durationMs: 700 },
  'trap.barrel.trigger': { model: 'roll', material: 'wood', size: 0.5, resonance: 0.6 },
  'trap.pipe-fire': { model: 'fire', material: 'metal', size: 0.4, intensity: 0.8, durationMs: 900 },
  'trap.pipe-fire.sustain': { model: 'fire', material: 'metal', size: 0.4, intensity: 0.8, durationMs: 2000 },
  'trap.blockage': { model: 'crumble', size: 0.6, durationMs: 1500 },
  'trap.other.trigger': { model: 'mechanism', material: 'metal', size: 0.3, durationMs: 400, speed: 60 },
  'platform.mechanism': { model: 'mechanism', size: 0.5, durationMs: 400 },
  'platform.start': { model: 'mechanism', size: 0.6, durationMs: 500, speed: 40 },
  'platform.move': { model: 'mechanism', size: 0.6 },
  'platform.stop': { model: 'impact', size: 0.6, bounce: 0.2, durationMs: 600 },
  'platform.release': { model: 'crumble', size: 0.6, durationMs: 1200 },
  'pickup.bonus': { model: 'chime', size: 0.4, durationMs: 700 },
  'pickup.box': { model: 'impact', material: 'wood', size: 0.3, durationMs: 300 },
  'pickup.special-start': { model: 'chime', size: 0.5, density: 0.7, durationMs: 900 },
  'pickup.special-complete': { model: 'chime', size: 0.3, density: 0.8, resonance: 0.8, durationMs: 1400 }
});

const SURFACE_OF = { 'temple-stone': 'stone', sandstone: 'sandstone', masonry: 'masonry', concrete: 'concrete' };
const REGION_SURFACE = { 'south-america': 'stone', egypt: 'sandstone', castle: 'masonry', 'missile-base': 'concrete' };
const FAMILY_MATERIAL = { boulder: 'stone', barrel: 'wood', dog: 'flesh', 'pipe-fire': 'metal', blockage: 'masonry', enemy: 'flesh', rick: 'leather', bullet: 'metal', dynamite: 'wood' };

/* Everything the scene tells us, as a starting recipe plus human-readable
 * facts. `inspect` is StudioSession.inspect data; `span` an optional
 * recorded motion/platform span with its speed trace. */
export function sceneProfile({ eventId, inspect = null, span = null, environments = null } = {}) {
  const event = CATALOG_BY_ID[eventId];
  const defaults = EVENT_FOLEY[eventId] || { model: 'impact' };
  const facts = [];
  const room = inspect?.room;
  const surfaceId = room ? (environments?.submaps?.[String(room.submap)]?.surface || environments?.defaults?.[room.region]) : null;
  const surface = SURFACE_OF[surfaceId] || REGION_SURFACE[room?.region] || 'stone';
  const family = inspect?.source?.family;
  const material = defaults.material || FAMILY_MATERIAL[family] || surface;
  /* Continuous events follow the recorded motion; one-shots keep their own length. */
  const recipe = { followMotion: event?.status === 'needs-hook' || !!defaults.followMotion, ...defaults, material, surface };
  if (event) facts.push(['Event', `${event.label} (${event.family})`]);
  if (inspect?.source) facts.push(['Source', `${inspect.source.label}${inspect.actor ? ` · ${inspect.actor.size.w}×${inspect.actor.size.h} px` : ''}`]);
  facts.push(['Material', MATERIALS[material].label]);
  facts.push(['Surface', `${MATERIALS[surface].label}${room ? ` · ${room.id}${room.region ? ` · ${room.region}` : ''}` : ''}`]);
  const a = inspect?.actor;
  if (a && inspect.source?.slot !== 1 && defaults.size == null) recipe.size = clamp(Math.sqrt(a.size.w * a.size.h) / 48, 0.1, 1);
  if (a) {
    facts.push(['Speed', `${a.speed} px/s ${a.direction}`]);
    if (a.speed > 1) recipe.speed = a.speed;
    const accel = Math.hypot(a.acceleration.x, a.acceleration.y);
    if (accel > 1) facts.push(['Acceleration', `${Math.round(accel)} px/s²`]);
    if (defaults.model === 'impact' && Math.abs(a.velocity.y) > 1) recipe.intensity = clamp(0.35 + Math.abs(a.velocity.y) / 400, 0.2, 1);
  }
  let motion = null;
  if (span?.speed?.length > 1) {
    motion = speedTrace(span);
    const max = Math.max(...motion), mean = motion.reduce((s, v) => s + v, 0) / motion.length;
    facts.push(['Motion', `${span.label}: ${motion.length} frames (${(motion.length / MOTION_HZ).toFixed(1)} s), ${Math.round(mean)} px/s average, ${Math.round(max)} peak`]);
    if (!defaults.speed) recipe.speed = Math.round(mean);
  }
  if (inspect?.listener?.distancePx != null) { facts.push(['Distance to Rick', `${inspect.listener.distancePx} px`]); recipe.distance = clamp(inspect.listener.distancePx / 320 * 0.5, 0, 0.6); }
  if (inspect?.nearby?.length) facts.push(['Also playing', `${inspect.nearby.length} sound(s) within 0.5 s`]);
  if (inspect?.platform) facts.push(['Platform', inspect.platform.state]);
  return { foley: normalizeFoley(recipe, defaultFoley()).foley, facts, motion };
}

/* Per-frame speeds of a span (holes filled with the previous value). */
export function speedTrace(span) {
  const out = [];
  const byFrame = new Map(span.speed.map(([f, v]) => [f, v]));
  let last = span.speed[0]?.[1] ?? 0;
  for (let f = span.start; f <= span.end; f++) { if (byFrame.has(f)) last = byFrame.get(f); out.push(last); }
  return out;
}

/* ---------- reference steering ---------- */

/* What we match against: level-normalised average spectrum, envelope
 * shape, length, attack, brightness and noisiness. */
export function referenceFeatures(buf) {
  const a = analyze(buf, { waveformPoints: 64 });
  if (a.silent) return { silent: true };
  const mono = buf.left, sr = buf.sampleRate;
  const hop = Math.max(1, Math.round(sr * 0.01));
  const env = [];
  for (let i = 0; i < mono.length; i += hop) {
    let s = 0; const end = Math.min(mono.length, i + hop);
    for (let k = i; k < end; k++) s += mono[k] * mono[k];
    env.push(Math.sqrt(s / Math.max(1, end - i)));
  }
  const peak = Math.max(...env, 1e-9);
  const spectrum = a.spectrum, sp = Math.max(...spectrum);
  /* spectral flatness from the average spectrum (geometric / arithmetic) */
  const lin = spectrum.filter((_, i) => SPEC_EDGES[i + 1] <= Math.min(sr / 2, 11025)).map(db => Math.pow(10, db / 20) + 1e-9);
  const flat = Math.exp(lin.reduce((s, v) => s + Math.log(v), 0) / lin.length) / (lin.reduce((s, v) => s + v, 0) / lin.length);
  return {
    silent: false, durationMs: a.durationMs, onsetMs: a.onsetMs, attackMs: a.attackMs, decayMs: a.decayMs, centroidHz: a.centroidHz,
    nyquist: sr / 2, flatness: Math.round(flat * 1000) / 1000, envelope: env.map(v => v / peak), spectrum: spectrum.map(v => Math.max(v - sp, -60))
  };
}

export function matchDistance(fa, fb) {
  if (!fa || !fb || fa.silent || fb.silent) return { total: Infinity, parts: {} };
  let ds = 0, used = 0;
  const nyq = Math.min(fa.nyquist || 24000, fb.nyquist || 24000, 16000);
  for (let i = 0; i < fa.spectrum.length; i++) {
    if (SPEC_EDGES[i + 1] > nyq) break;
    if (fa.spectrum[i] <= -60 && fb.spectrum[i] <= -60) continue;
    ds += Math.abs(fa.spectrum[i] - fb.spectrum[i]); used++;
  }
  const spectrum = used ? ds / used / 20 : 0;
  const n = 48, la = fa.envelope.length, lb = fb.envelope.length, L = Math.max(la, lb);
  let de = 0;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1) * (L - 1);
    const va = t < la ? fa.envelope[Math.floor(t)] : 0, vb = t < lb ? fb.envelope[Math.floor(t)] : 0;
    de += Math.abs(Math.sqrt(va) - Math.sqrt(vb));
  }
  const parts = {
    spectrum, envelope: de / n,
    length: Math.abs(Math.log((fa.durationMs + 5) / (fb.durationMs + 5))),
    brightness: Math.abs(Math.log((fa.centroidHz + 50) / (fb.centroidHz + 50))),
    noisiness: Math.abs(fa.flatness - fb.flatness),
    attack: Math.abs(Math.log((fa.attackMs + 2) / (fb.attackMs + 2))) * 0.5
  };
  const total = parts.spectrum + parts.envelope * 1.5 + parts.length * 0.5 + parts.brightness * 0.6 + parts.noisiness * 0.8 + parts.attack * 0.3;
  for (const k of Object.keys(parts)) parts[k] = Math.round(parts[k] * 1000) / 1000;
  return { total: Math.round(total * 1000) / 1000, parts };
}

export const matchScore = d => (Number.isFinite(d) ? Math.round(Math.exp(-d / 1.5) * 1000) / 1000 : 0);

function featuresOf(recipe, motion, sr) {
  const data = renderFoley(recipe, { sr, motion });
  return referenceFeatures({ left: data, right: data, sampleRate: sr });
}

/* A first guess read straight off the reference's measurements. */
export function guessFromReference(recipe, ref) {
  const g = { ...recipe };
  g.durationMs = clamp(ref.onsetMs + ref.durationMs, 30, 8000);
  g.brightness = clamp(Math.log(Math.max(100, ref.centroidHz) / 200) / Math.log(30), 0, 1);
  g.hardness = clamp(1 - Math.log((ref.attackMs + 1) / 1) / Math.log(60), 0, 1);
  g.roughness = clamp(ref.flatness * 1.6, 0, 1);
  g.resonance = clamp(ref.decayMs / Math.max(1, ref.durationMs) * 1.2, 0, 1);
  return normalizeFoley(g).foley;
}

/* Band gains (dB) that move `features` toward `ref`, from their
 * peak-normalised average spectra. */
export function eqToward(features, ref, { current = null, strength = 1 } = {}) {
  const nyq = Math.min(features.nyquist || 24000, ref.nyquist || 24000, 16000);
  return EQ_BANDS.map((_, g) => {
    let sum = 0, n = 0;
    for (let i = g * 6; i < g * 6 + 6; i++) {
      if (SPEC_EDGES[i + 1] > nyq) break;
      const a = features.spectrum[i], b = ref.spectrum[i];
      if (a <= -60 && b <= -60) continue;
      sum += b - a; n++;
    }
    const was = current?.[g] || 0;
    return Math.round(clamp(was + (n ? sum / n : 0) * strength, -EQ_LIMIT_DB, EQ_LIMIT_DB) * 10) / 10;
  });
}

/* Fit a recipe toward a reference in three steps: (1) unless locked, try
 * every model and material with the controls read off the reference,
 * (2) coordinate search over the continuous controls with shrinking
 * steps, (3) unless 'eq' is locked, a match EQ toward the reference
 * spectrum. The objective balances matching the reference
 * (referenceWeight) against staying close to the scene/description recipe
 * (control drift, and a cost for changing model or material), so the scene
 * still shapes the result. Deterministic; yields between batches. */
export async function fitToReference(base, ref, { iterations = 48, referenceWeight = 0.7, motion = null, sr = 22050, lock = [], onProgress = null } = {}) {
  if (!ref || ref.silent) throw new Error('Reference is silent or missing');
  base = normalizeFoley(base).foley;
  const free = FIT_PARAMS.filter(k => !lock.includes(k));
  const norm = (k, v) => (v - FOLEY_PARAMS[k][0]) / (FOLEY_PARAMS[k][1] - FOLEY_PARAMS[k][0]);
  const denorm = (k, x) => FOLEY_PARAMS[k][0] + clamp(x, 0, 1) * (FOLEY_PARAMS[k][1] - FOLEY_PARAMS[k][0]);
  const anchor = Object.fromEntries(free.map(k => [k, norm(k, base[k])]));
  const w = clamp(referenceWeight, 0, 1);
  const total = Math.round(iterations * 1.5) + (lock.includes('model') ? 0 : Object.keys(FOLEY_MODELS).length) + (lock.includes('material') ? 0 : Object.keys(MATERIALS).length) + (lock.includes('eq') ? 0 : 3);
  let evaluations = 0;
  const progress = async best => { onProgress?.({ iteration: Math.min(evaluations, total), of: total, score: matchScore(best.distance) }); await new Promise(res => setTimeout(res, 0)); };
  const evaluate = recipe => {
    evaluations++;
    const features = featuresOf(recipe, motion, sr);
    const d = matchDistance(features, ref).total;
    const drift = free.length ? free.reduce((s, k) => s + Math.abs(norm(k, recipe[k]) - anchor[k]), 0) / free.length : 0;
    const change = (recipe.model !== base.model ? 0.5 : 0) + (recipe.material !== base.material ? 0.25 : 0);
    return { recipe, features, distance: d, objective: w * d + (1 - w) * (drift * 2 + change) };
  };
  const with_ = (recipe, patch) => normalizeFoley(patch, recipe).foley;
  const guessed = r => with_(r, Object.fromEntries(free.map(k => [k, guessFromReference(r, ref)[k]])));
  let best = evaluate(base);
  const consider = r => { if (r.objective < best.objective) best = r; };
  consider(evaluate(guessed(base)));
  const own = best; /* best start that keeps the scene's model and material */
  /* 1. discrete: model, then material */
  if (!lock.includes('model')) {
    for (const model of Object.keys(FOLEY_MODELS)) if (model !== base.model) consider(evaluate(guessed(with_(base, { model }))));
    await progress(best);
  }
  if (!lock.includes('material')) {
    for (const material of Object.keys(MATERIALS)) if (material !== best.recipe.material) consider(evaluate(with_(best.recipe, { material })));
    await progress(best);
  }
  /* 2. coordinate search and 3. match EQ, from the best start and (when the
   * discrete step moved away from it) from the scene's own model too */
  const refine = async (start, budget) => {
    let cur = start;
    const step = Object.fromEntries(free.map(k => [k, 0.2]));
    while (budget > 0 && free.some(k => step[k] > 0.01)) {
      for (const k of free) {
        if (budget <= 0 || step[k] <= 0.01) continue;
        let moved = false;
        for (const dir of [1, -1]) {
          if (budget <= 0) break;
          budget--;
          const r = evaluate(with_(cur.recipe, { [k]: denorm(k, norm(k, cur.recipe[k]) + dir * step[k]) }));
          if (r.objective < cur.objective) { cur = r; moved = true; break; }
        }
        step[k] = moved ? Math.min(0.3, step[k] * 1.2) : step[k] * 0.5;
      }
      await progress(cur.objective < best.objective ? cur : best);
    }
    if (!lock.includes('eq')) {
      for (let round = 0; round < 3; round++) {
        const eq = eqToward(cur.features, ref, { current: cur.recipe.eq, strength: w * 0.8 });
        const r = evaluate(with_(cur.recipe, { eq }));
        if (r.objective < cur.objective - 1e-6) cur = r; else break;
      }
    }
    return cur;
  };
  const starts = best === own ? [best] : [best, own];
  const results = [];
  for (const start of starts) results.push(await refine(start, Math.round(iterations / starts.length * (starts.length > 1 ? 1.5 : 1))));
  best = results.reduce((a, b) => (b.objective < a.objective ? b : a));
  await progress(best);
  return { foley: best.recipe, distance: best.distance, score: matchScore(best.distance), evaluations };
}

/* A small set of distinct takes around a recipe. Take 0 is the recipe
 * itself; the others vary the continuous controls by `spread` and the seed.
 * With reference features each take carries its match and takes are
 * sorted best first. */
export function generateTakes(base, { count = 4, spread = 0.15, seed = 1, motion = null, reference = null, sr = FOLEY_RATE } = {}) {
  const random = rng(hashSeed(seed, 'takes'));
  const takes = [];
  for (let i = 0; i < count; i++) {
    const recipe = { ...base, seed: (base.seed + i * 7919) % 2147483647 };
    if (i > 0) for (const k of FIT_PARAMS) {
      if (k === 'durationMs') continue;
      recipe[k] = recipe[k] + (random() * 2 - 1) * spread * (FOLEY_PARAMS[k][1] - FOLEY_PARAMS[k][0]);
    }
    const foley = normalizeFoley(recipe, base).foley;
    const data = renderFoley(foley, { sr, motion });
    const buf = { left: data, right: data, sampleRate: sr };
    const take = { index: i, foley, buffer: buf };
    if (reference && !reference.silent) {
      const d = matchDistance(referenceFeatures(buf), reference);
      take.distance = d.total; take.match = matchScore(d.total); take.parts = d.parts;
    }
    takes.push(take);
  }
  if (reference && !reference.silent) takes.sort((a, b) => a.distance - b.distance);
  return takes;
}

/* Default motion source for continuous events: the span of the audition
 * target, else of the source actor around its occurrence. */
export function spanFamily(span) { return entityTypeInfo(span?.source?.type ?? 0).family; }
