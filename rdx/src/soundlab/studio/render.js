/* SoundLab Studio offline renderer.
 *
 * Deterministic, dependency-free DSP: the same design, context, variant and
 * sample data always produce the same samples, in the browser and under
 * node --test. The UI plays the rendered buffers through Web Audio; the
 * renderer itself never touches an AudioContext. */

import { FRAME_HZ } from './session.js';
import { movementOf, resolveDesign, transitionsOf } from './design.js';
import { Biquad, TAU, dbToGain, mixInto, rng } from './dsp.js';
import { FOLEY_MODELS, normalizeFoley, renderFoley } from './foley.js';

export { rng };
export const RENDER_RATE = 48000;

function envelopeAt(layer, tMs, lengthMs) {
  const { attack, hold, decay, sustain, release } = layer;
  let v;
  if (tMs < attack) v = attack > 0 ? tMs / attack : 1;
  else if (tMs < attack + hold) v = 1;
  else if (tMs < attack + hold + decay) { const p = (tMs - attack - hold) / decay; v = sustain + (1 - sustain) * Math.pow(1 - p, 2); }
  else v = sustain;
  const toEnd = lengthMs - tMs;
  if (toEnd < release) v *= Math.max(0, toEnd / release);
  return v;
}

/* Generated Foley is cached per recipe, motion and rate: the same layer is
 * heard many times while auditioning in context. */
const foleyCache = new Map();
export function foleySample(recipe, { sr = RENDER_RATE, motion = null } = {}) {
  const key = `${sr}|${JSON.stringify(recipe)}|${motion ? motion.join(',') : ''}`;
  let hit = foleyCache.get(key);
  if (!hit) {
    hit = { data: renderFoley(recipe, { sr, motion }), sampleRate: sr };
    foleyCache.set(key, hit);
    if (foleyCache.size > 48) foleyCache.delete(foleyCache.keys().next().value);
  } else { foleyCache.delete(key); foleyCache.set(key, hit); }
  return hit;
}

function layerLengthMs(layer, sample, pitchRatio) {
  if (layer.kind !== 'sample' && layer.kind !== 'foley') return layer.duration;
  if (!sample) return 0;
  const available = sample.data.length * (1 - layer.start) / sample.sampleRate * 1000 / pitchRatio;
  return Math.min(layer.duration, available);
}

/* Render one layer to a mono Float32Array at `sr`. `vary` holds the
 * variant's offsets (semitones, dB, ms, filter semitones). */
export function renderLayer(layer, { sr = RENDER_RATE, samples, masterPitch = 0, vary = {}, seed = 1, lengthOverrideMs = null, motion = null, variant = 0 } = {}) {
  let sample = layer.kind === 'sample' ? samples?.get(sampleKey(layer.source)) : null;
  if (layer.kind === 'foley') {
    const recipe = { ...layer.foley, seed: (layer.foley.seed + variant * 7919) % 2147483647 };
    if (lengthOverrideMs != null) Object.assign(recipe, { durationMs: Math.min(8000, Math.max(30, lengthOverrideMs)), followMotion: false });
    sample = foleySample(normalizeFoley(recipe).foley, { sr, motion: recipe.followMotion ? motion : null });
  }
  const basePitch = layer.pitch + masterPitch + (vary.pitch || 0);
  const lengthMs = lengthOverrideMs ?? layerLengthMs(layer, sample, Math.pow(2, basePitch / 12));
  const n = Math.max(0, Math.round(lengthMs * sr / 1000));
  const out = new Float32Array(n);
  if (!n || (layer.kind === 'sample' && !sample)) return out;
  const random = rng(seed);
  const filter = layer.filter && layer.filter !== 'off' ? new Biquad() : null;
  const eqs = [['lowshelf', 200, layer.eqLow], ['peak', 1000, layer.eqMid], ['highshelf', 5000, layer.eqHigh]]
    .filter(([, , g]) => g).map(([type, f, g]) => { const b = new Biquad(); b.set(type, f, 0.7, g, sr); return b; });
  const drive = layer.drive > 0 ? 1 + layer.drive * 12 : 0, driveNorm = drive ? Math.tanh(drive) : 1;
  const gain = dbToGain(layer.gain + (vary.gain || 0));
  const filterShift = vary.filter || 0;
  let phase = 0, pos = sample ? layer.start * (sample.data.length - 1) : 0;
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, brown = 0;
  const BLOCK = 32;
  for (let i = 0; i < n; i++) {
    const tMs = i * 1000 / sr;
    const sweep = Math.max(0, 1 - tMs / layer.pitchEnvTime);
    const env = envelopeAt(layer, tMs, lengthMs);
    if (filter && i % BLOCK === 0) filter.set(layer.filter, layer.filterFreq * Math.pow(2, (layer.filterEnv * sweep + filterShift) / 12), layer.filterQ, 0, sr);
    const ratio = Math.pow(2, (basePitch + layer.pitchEnv * sweep) / 12);
    let x = 0;
    if (layer.kind === 'tone') {
      const f = layer.freq * ratio;
      phase += f / sr; phase -= Math.floor(phase);
      if (layer.waveform === 'sine') x = Math.sin(TAU * phase);
      else if (layer.waveform === 'square') x = phase < 0.5 ? 0.8 : -0.8;
      else if (layer.waveform === 'saw') x = 2 * phase - 1;
      else x = 1 - 4 * Math.abs(phase - 0.5);
    } else if (layer.kind === 'noise') {
      const w = random() * 2 - 1;
      if (layer.color === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        x = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      } else if (layer.color === 'brown') { brown = (brown + 0.02 * w) / 1.02; x = brown * 3.5; }
      else x = w;
    } else {
      const d = sample.data, idx = layer.reverse ? d.length - 1 - pos : pos;
      const k = Math.floor(idx), frac = idx - k;
      x = k >= 0 && k + 1 < d.length ? d[k] + (d[k + 1] - d[k]) * frac : 0;
      pos += ratio * sample.sampleRate / sr;
      if (pos >= d.length - 1) { out.fill(0, i); break; }
    }
    if (filter) x = filter.run(x);
    for (const eq of eqs) x = eq.run(x);
    if (drive) x = Math.tanh(x * drive) / driveNorm;
    out[i] = x * env * gain;
  }
  return out;
}

export function sampleKey(source) { return source ? `${source.type}:${source.name}` : ''; }

/* The seeded offsets for one variant. Variant 0 is always the authored
 * design itself so "what you hear while editing" is reproducible. */
export function variantOffsets(variation, index) {
  if (!index) return { pitch: 0, gain: 0, time: 0, filter: 0 };
  const r = rng((variation.seed * 7919 + index * 104729) >>> 0);
  const spread = v => (r() * 2 - 1) * v;
  return { pitch: spread(variation.pitch) / 100, gain: spread(variation.gain), time: r() * variation.time, filter: spread(variation.filter) };
}

/* Which layers sound in a container segment. One-shots play everything;
 * loops play `start` layers on start, `loop`/`all` while running and `stop`
 * layers on stop. Solo wins over everything. */
export function layersFor(design, segment = 'oneshot') {
  const enabled = design.layers.filter(l => l.enabled);
  const soloed = enabled.filter(l => l.solo);
  const pool = soloed.length ? soloed : enabled;
  if (segment === 'oneshot' || design.container.mode === 'oneshot') return pool;
  if (segment === 'loop') return pool.filter(l => l.segment === 'loop' || l.segment === 'all');
  return pool.filter(l => l.segment === segment);
}


/* Early reflections plus a damped feedback tail from an environment
 * profile (rdx/data/soundlab manifest previewModel.environments). */
export function applyRoom(dry, profile, amount, sr = RENDER_RATE) {
  if (!profile || amount <= 0) return dry;
  const wet = Math.min(1, profile.maxWet * amount / 0.35);
  const tailMs = profile.decayMs * 3;
  const out = new Float32Array(dry.length + Math.round(tailMs * sr / 1000));
  out.set(dry);
  const pre = Math.round((profile.predelayMs || 0) * sr / 1000);
  for (const r of profile.earlyReflections || []) mixInto(out, dry, pre + Math.round(r.delayMs * sr / 1000), r.gain * wet);
  const delay = Math.max(1, Math.round(29.7 * sr / 1000));
  const feedback = Math.pow(0.001, (delay / sr * 1000) / profile.decayMs);
  const damp = profile.highFrequencyDamping ?? 0.6;
  const buf = new Float32Array(delay);
  let lp = 0;
  for (let i = 0; i < out.length; i++) {
    const j = i % delay;
    const y = buf[j];
    lp = y * (1 - damp) + lp * damp;
    buf[j] = (i - pre >= 0 && i - pre < dry.length ? dry[i - pre] : 0) + lp * feedback;
    out[i] += y * wet * 0.5;
  }
  return out;
}

/* Fast-attack, 60 ms release peak limiter to `ceilingDb`. */
export function limit(left, right, ceilingDb, sr = RENDER_RATE) {
  const ceiling = dbToGain(ceilingDb), rel = Math.exp(-1 / (0.06 * sr));
  let g = 1;
  for (let i = 0; i < left.length; i++) {
    const peak = Math.max(Math.abs(left[i]), Math.abs(right[i]));
    const want = peak > ceiling ? ceiling / peak : 1;
    g = want < g ? want : want + (g - want) * rel;
    left[i] *= g; right[i] *= g;
  }
}

/* Render one event instance. `inspect` is the session inspector's data for
 * the occurrence (or null for a neutral preview). Returns stereo buffers. */
export function renderEvent(design, { inspect = null, variant = 0, segment = 'oneshot', samples = new Map(), environment = null, sr = RENDER_RATE, lengthMs = null, motion = null } = {}) {
  const { design: d, values } = resolveDesign(design, inspect);
  const vary = variantOffsets(d.variation, variant);
  const layers = layersFor(d, segment).map(layer => {
    /* Without a recorded trace a speed-following Foley layer takes the
     * speed of the moment it is heard at. */
    if (layer.kind !== 'foley' || !layer.foley.followMotion || (motion && motion.length > 1) || !(values.speed > 0)) return layer;
    return { ...layer, foley: { ...layer.foley, speed: Math.min(400, values.speed) } };
  });
  const rendered = layers.map((layer, i) => ({
    layer,
    data: renderLayer(layer, { sr, samples, masterPitch: d.master.pitch, vary, variant, motion, seed: (d.variation.seed + variant * 31 + i * 1013) >>> 0, lengthOverrideMs: segment === 'loop' ? lengthMs ?? d.container.length + d.container.crossfade : null })
  }));
  const timeShift = Math.round(vary.time * sr / 1000);
  const total = rendered.reduce((m, r) => Math.max(m, r.data.length + Math.round(r.layer.delay * sr / 1000)), 0) + timeShift;
  let mono = new Float32Array(total);
  for (const r of rendered) mixInto(mono, r.data, timeShift + Math.round(r.layer.delay * sr / 1000));
  if (segment === 'loop') mono = makeLoop(mono, d.container, sr);
  else mono = applyRoom(mono, environment, d.master.room, sr);
  const distance = Math.min(1, (values.distance || 0) / 320);
  const gain = dbToGain(d.master.gain) * (1 - d.master.distanceAmount * distance * 0.75);
  const pan = Math.max(-1, Math.min(1, (values.pan || 0) * d.master.panAmount));
  const angle = (pan + 1) * Math.PI / 4;
  const left = new Float32Array(mono.length), right = new Float32Array(mono.length);
  const gl = Math.cos(angle) * Math.SQRT2 * gain, gr = Math.sin(angle) * Math.SQRT2 * gain;
  for (let i = 0; i < mono.length; i++) { left[i] = mono[i] * gl; right[i] = mono[i] * gr; }
  if (segment !== 'loop') limit(left, right, d.master.limiter, sr);
  return { left, right, sampleRate: sr, context: values, variant, segment, resolved: d };
}

/* Fold the crossfade tail into the head so the buffer loops seamlessly. */
function makeLoop(mono, container, sr) {
  const body = Math.round(container.length * sr / 1000);
  const xf = Math.min(Math.round(container.crossfade * sr / 1000), Math.max(0, mono.length - body));
  const out = new Float32Array(body);
  out.set(mono.subarray(0, body));
  for (let i = 0; i < xf; i++) {
    const t = i / xf;
    out[i] = out[i] * Math.sin(t * Math.PI / 2) + mono[body + i] * Math.cos(t * Math.PI / 2);
  }
  return out;
}

/* A staged (loop) design along a recorded span: the start stage at the
 * first frame, the movement re-rendered every `chunkFrames` with that
 * frame's context (speed, distance, pan) and crossfaded, the stop stage at
 * the end, joined by the design's in/out transitions (see
 * TRANSITION_MODES). */
export function renderSpan(design, { contexts, chunkFrames = 4, samples = new Map(), environment = null, sr = RENDER_RATE } = {}) {
  const frameSamples = Math.round(sr / FRAME_HZ);
  const spanLen = contexts.length * frameSamples;
  const tr = transitionsOf(design);
  const ms = v => Math.max(0, Math.round(v * sr / 1000));
  const tIn = Math.max(1, ms(tr.in.timeMs)), tOut = Math.max(1, ms(tr.out.timeMs)), ramp = ms(5) || 1;
  const start = renderEvent(design, { inspect: contexts[0], segment: 'start', samples, sr });
  const stop = renderEvent(design, { inspect: contexts.at(-1), segment: 'stop', samples, sr });
  const ringout = tr.out.mode === 'ringout' ? tOut : 0;
  const xf = Math.round(Math.max(5, design.container.crossfade) * sr / 1000);
  const bodyLen = spanLen + ringout + xf;
  /* recorded speed per frame; for a ring-out the movement winds down after the end */
  const trace = contexts.map(c => Math.abs(c?.actor?.speed ?? 0));
  const tail = Math.ceil(ringout / frameSamples), last = trace.at(-1) || 0;
  for (let i = 1; i <= tail; i++) trace.push(last * (1 - i / (tail + 1)));
  const movement = movementOf(design);
  let bodyL = new Float32Array(bodyLen), bodyR = new Float32Array(bodyLen), movementMeasures = { method: 'synth' };
  if (movement.method !== 'synth' && layersFor(design, 'loop').length) {
    const body = renderMovement(design, contexts, trace, movement, { len: bodyLen, samples, sr });
    bodyL = body.left; bodyR = body.right; movementMeasures = body.measures;
  } else {
    /* Speed-following continuous Foley layers are generated once over the
     * whole recorded speed trace; every other movement layer is chunked. */
    const tracked = id => {
      const l = design.layers.find(x => x.id === id);
      return l?.kind === 'foley' && l.foley.followMotion && FOLEY_MODELS[l.foley.model]?.continuous;
    };
    let followed = null;
    if (layersFor(design, 'loop').some(l => tracked(l.id))) {
      const only = { ...design, container: { ...design.container, mode: 'oneshot' }, layers: design.layers.map(l => ({ ...l, enabled: l.enabled && tracked(l.id) })) };
      followed = renderEvent(only, { inspect: contexts[0], samples, sr, motion: trace });
      design = { ...design, layers: design.layers.map(l => ({ ...l, enabled: l.enabled && !tracked(l.id) })) };
    }
    const chunk = chunkFrames * frameSamples;
    const chunked = layersFor(design, 'loop').length > 0;
    for (let c = 0, at = 0; chunked && at < spanLen + ringout; c++, at += chunk) {
      const ctx = contexts[Math.min(contexts.length - 1, c * chunkFrames)];
      const body = renderEvent(design, { inspect: ctx, segment: 'loop', samples, sr, variant: 0, lengthMs: (chunk + xf) * 1000 / sr + design.container.crossfade });
      const n = Math.min(chunk + xf, body.left.length);
      for (let i = 0; i < n && at + i < bodyLen; i++) {
        const w = (c === 0 ? 1 : Math.min(1, i / xf)) * (i < chunk ? 1 : Math.max(0, 1 - (i - chunk) / xf));
        bodyL[at + i] += body.left[i] * w; bodyR[at + i] += body.right[i] * w;
      }
    }
    if (followed) { mixInto(bodyL, followed.left, 0); mixInto(bodyR, followed.right, 0); }
  }
  /* stage gains over time */
  const moveGain = i => {
    let g = 1;
    if (tr.in.mode === 'cut') g = Math.min(1, i / ramp);
    else if (tr.in.mode === 'crossfade') g = Math.min(1, i / tIn);
    else if (tr.in.mode === 'swell') { const x = Math.min(1, i / tIn); g = x * x * (3 - 2 * x); }
    else if (tr.in.mode === 'after') g = i < tIn ? 0 : Math.min(1, (i - tIn) / ms(30));
    if (tr.out.mode === 'cut') g *= i < spanLen ? 1 : Math.max(0, 1 - (i - spanLen) / ramp);
    else if (tr.out.mode === 'crossfade' || tr.out.mode === 'early') g *= i < spanLen - tOut ? 1 : Math.max(0, (spanLen - i) / tOut);
    else if (tr.out.mode === 'ringout') g *= i < spanLen ? 1 : Math.max(0, 1 - (i - spanLen) / tOut);
    return g;
  };
  const startGain = i => (tr.in.mode === 'crossfade' ? Math.max(0, 1 - i / tIn) : 1);
  const stopAt = tr.out.mode === 'crossfade' ? Math.max(0, spanLen - tOut) : spanLen;
  const stopGain = i => (tr.out.mode === 'crossfade' ? Math.min(1, i / tOut) : 1);
  const left = new Float32Array(Math.max(bodyLen, start.left.length, stopAt + stop.left.length)), right = new Float32Array(left.length);
  for (let i = 0; i < start.left.length; i++) { const g = startGain(i); left[i] += start.left[i] * g; right[i] += start.right[i] * g; }
  for (let i = 0; i < bodyLen; i++) { const g = moveGain(i); left[i] += bodyL[i] * g; right[i] += bodyR[i] * g; }
  for (let i = 0; i < stop.left.length; i++) { const g = stopGain(i); left[stopAt + i] += stop.left[i] * g; right[stopAt + i] += stop.right[i] * g; }
  limit(left, right, design.master.limiter, sr);
  return { left, right, sampleRate: sr, stopAtMs: stopAt * 1000 / sr, movement: movementMeasures };
}

/* ---------- movement played the way the game can play it ---------- */

/* The typical speed of a run (median of the moving frames), px/s. */
export function typicalSpeed(trace) {
  const moving = trace.filter(v => v > 1).sort((a, b) => a - b);
  return moving.length ? moving[Math.floor(moving.length / 2)] : 60;
}

/* The movement stage rendered once at a constant speed, centred and at no
 * distance: the material that bites and loops are cut from. Mono. */
export function movementSource(design, contexts, { refSpeed, lengthMs, samples = new Map(), sr = RENDER_RATE }) {
  const mid = contexts[Math.floor(contexts.length / 2)] || contexts[0] || {};
  const inspect = { ...mid, pan: 0, listener: { ...(mid.listener || {}), distancePx: 0 }, actor: mid.actor ? { ...mid.actor, speed: refSpeed } : { speed: refSpeed, velocity: { x: refSpeed, y: 0 }, acceleration: { x: 0, y: 0 }, size: { w: 16, h: 16 } } };
  const only = { ...design, container: { ...design.container, mode: 'oneshot' }, layers: design.layers.map(l => ({ ...l, enabled: l.enabled && (l.segment === 'loop' || l.segment === 'all') })) };
  /* a pre-roll skips the onset: bites and loops come from the steady movement */
  const preMs = 300, frames = Math.ceil((lengthMs + preMs) * FRAME_HZ / 1000) + 2;
  const r = renderEvent(only, { inspect, samples, sr, motion: new Array(frames).fill(refSpeed), lengthMs: lengthMs + preMs });
  let pre = Math.round(preMs * sr / 1000);
  if (r.left.length < pre + Math.round(lengthMs * sr / 1000)) pre = 0; /* a short sample layer: keep its start */
  /* rendered at pan 0, so left = right = mono */
  return r.left.slice(pre, Math.min(r.left.length, pre + Math.round(lengthMs * sr / 1000)));
}

/* Bites: separate stretches of the source (no shared content, so any bite
 * can follow any other), each with equal-power edges of `xfadeMs` and
 * matched in level, so bites played back to back join without a bump. */
export function cutBites(source, { bitePx, refSpeed, variants, xfadeMs }, sr = RENDER_RATE) {
  const biteN = Math.max(32, Math.round(bitePx / refSpeed * sr)), xf = Math.max(2, Math.round(xfadeMs * sr / 1000));
  const k = Math.max(1, Math.min(variants, Math.floor(source.length / (biteN + xf))));
  const bites = [];
  for (let b = 0; b < k; b++) {
    const at = b * (biteN + xf), n = Math.min(biteN + xf, source.length - at), out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const w = i < xf ? Math.sin(Math.PI / 2 * i / xf) : i >= biteN ? Math.cos(Math.PI / 2 * Math.min(1, (i - biteN) / xf)) : 1;
      out[i] = source[at + i] * w;
    }
    bites.push(out);
  }
  const rms = x => { let e = 0; for (let i = xf; i < Math.min(biteN, x.length); i++) e += x[i] * x[i]; return Math.sqrt(e / Math.max(1, Math.min(biteN, x.length) - xf)); };
  const levels = bites.map(rms), mean = levels.reduce((a, v) => a + v, 0) / levels.length;
  bites.forEach((x, i) => { const g = levels[i] > 1e-9 ? mean / levels[i] : 1; for (let j = 0; j < x.length; j++) x[j] *= g; });
  return { bites, biteN, xf };
}

/* Brightness of a stretch as a zero-crossing estimate, Hz. */
const brightness = (x, sr) => { let z = 0; for (let i = 1; i < x.length; i++) if ((x[i] >= 0) !== (x[i - 1] >= 0)) z++; return z * sr / 2 / Math.max(1, x.length); };

/* A seamless loop: the loop point near `loopMs` whose next samples best match
 * the start, and an equal-power crossfade over the seam. */
export function makeSeamlessLoop(source, { loopMs, xfadeMs }, sr = RENDER_RATE) {
  const xf = Math.max(4, Math.round(xfadeMs * sr / 1000));
  const want = Math.max(xf * 2, Math.min(Math.round(loopMs * sr / 1000), source.length - xf - 1));
  const search = Math.min(Math.round(0.03 * sr), Math.floor(want / 4)), win = Math.min(Math.max(xf, Math.round(0.02 * sr)), want >> 1);
  let best = want, bestScore = -Infinity;
  let e0 = 0; for (let i = 0; i < win; i++) e0 += source[i] * source[i];
  for (let e = want - search; e <= want; e++) {
    if (e + win >= source.length) break;
    let c = 0, ee = 0;
    for (let i = 0; i < win; i++) { c += source[e + i] * source[i]; ee += source[e + i] * source[e + i]; }
    const score = c / Math.sqrt((e0 + 1e-12) * (ee + 1e-12));
    if (score > bestScore) { bestScore = score; best = e; }
  }
  /* the crossfade keeps the level whatever the correlation: equal gain for
   * matching material, equal power for unrelated material */
  const r = Math.max(0, Math.min(1, bestScore));
  const loop = source.slice(0, best);
  for (let i = 0; i < xf && best + i < source.length; i++) {
    const p = i / xf, a = p, b = 1 - p, norm = Math.sqrt(a * a + b * b + 2 * a * b * r) || 1;
    loop[i] = (source[i] * a + source[best + i] * b) / norm;
  }
  return { loop, loopPoint: best, match: bestScore };
}

/* Per-frame gain and pan of the moving source along the run, as the game
 * would apply them: level follows speed below the made-at speed. */
function frameShape(design, contexts, trace, ref) {
  return trace.map((v, f) => {
    const { design: d, values } = resolveDesign(design, contexts[Math.min(f, contexts.length - 1)]);
    const distance = Math.min(1, (values.distance || 0) / 320);
    const pan = Math.max(-1, Math.min(1, (values.pan || 0) * d.master.panAmount));
    const level = Math.sqrt(Math.max(0, Math.min(1, v / ref))) * (1 - d.master.distanceAmount * distance * 0.75);
    const angle = (pan + 1) * Math.PI / 4;
    return { l: Math.cos(angle) * Math.SQRT2 * level, r: Math.sin(angle) * Math.SQRT2 * level };
  });
}

/* How much rougher the signal is at the joins than elsewhere: the largest
 * sample-to-sample step within 1 ms of each join, against the same measure
 * over every 2 ms window of the signal (95th percentile), in dB. At or below
 * 0 dB the joins are no rougher than the sound itself (no clicks). */
export function seamJumpDb(x, joins, sr = RENDER_RATE) {
  if (!joins.length || x.length < 4) return null;
  const w = Math.max(1, Math.round(sr / 1000));
  const stepMax = (a, b) => { let m = 0; for (let i = Math.max(1, a); i < Math.min(x.length, b); i++) m = Math.max(m, Math.abs(x[i] - x[i - 1])); return m; };
  const windows = [];
  for (let i = 1; i + 2 * w <= x.length; i += 2 * w) windows.push(stepMax(i, i + 2 * w));
  windows.sort((p, q) => p - q);
  const typical = windows[Math.floor(windows.length * 0.95)] || 1e-9;
  const worst = Math.max(...joins.map(j => stepMax(j - w, j + w)));
  return Math.round(20 * Math.log10(Math.max(worst, 1e-9) / typical) * 10) / 10;
}
const rateFor = (v, ref, follow) => Math.max(0.5, Math.min(2, Math.pow(Math.max(v, 1e-3) / ref, follow)));

/* The movement stage along a recorded run, as bites per distance travelled
 * or as a seamless loop whose rate follows speed. */
export function renderMovement(design, contexts, trace, movement, { len, samples = new Map(), sr = RENDER_RATE }) {
  const ref = movement.refSpeed > 0 ? movement.refSpeed : typicalSpeed(trace);
  const fs = sr / FRAME_HZ;
  const shape = frameShape(design, contexts, trace, ref);
  const left = new Float32Array(len), right = new Float32Array(len);
  const gainAt = t => { const f = Math.min(shape.length - 1, Math.floor(t / fs)), g = Math.min(shape.length - 1, f + 1), x = t / fs - f; return [shape[f].l + (shape[g].l - shape[f].l) * x, shape[f].r + (shape[g].r - shape[f].r) * x]; };
  const random = rng((design.variation?.seed ?? 1) * 7 + 11);
  if (movement.method === 'bites') {
    const biteMs = movement.bitePx / ref * 1000;
    const source = movementSource(design, contexts, { refSpeed: ref, lengthMs: (biteMs + movement.xfadeMs) * movement.variants + 20, samples, sr });
    const { bites, biteN, xf } = cutBites(source, { ...movement, refSpeed: ref }, sr);
    let dist = 0, next = 0, prev = -1;
    for (let f = 0; f < trace.length; f++) {
      const v = trace[f], step = v / FRAME_HZ;
      if (!(step > 0)) continue;
      while (next < dist + step) {
        const t = Math.round((f + (next - dist) / step) * fs);
        let k = Math.floor(random() * bites.length);
        if (bites.length > 1 && k === prev) k = (k + 1) % bites.length;
        prev = k;
        const bite = bites[k], r = rateFor(v, ref, movement.pitchFollow), n = Math.floor((bite.length - 1) / r);
        for (let i = 0; i < n && t + i < len; i++) {
          const x = i * r, j = x | 0, s = bite[j] + (bite[j + 1] - bite[j]) * (x - j);
          const [gl, gr] = gainAt(t + i);
          left[t + i] += s * gl; right[t + i] += s * gr;
        }
        next += movement.bitePx;
      }
      dist += step;
    }
    /* measurements: each bite's level, and the joins of every bite into another */
    const bright = bites.map(x => brightness(x.subarray(xf, biteN), sr)), meanBright = bright.reduce((a, v) => a + v, 0) / bright.length;
    const order = bites.flatMap((_, k) => bites.length > 1 ? [k, (k + 1) % bites.length] : [k, k]);
    const chain = new Float32Array(order.length * biteN + xf), joins = [];
    order.forEach((k, i) => { mixInto(chain, bites[k], i * biteN); if (i) joins.push(i * biteN + Math.round(xf / 2)); });
    const measures = { method: 'bites', refSpeed: Math.round(ref), bites: bites.length, biteMs: Math.round(biteN * 1000 / sr), brightnessSpread: Math.round((Math.max(...bright) - Math.min(...bright)) / Math.max(1, meanBright) * 100) / 100, seamDb: seamJumpDb(chain.subarray(xf, chain.length - xf), joins.map(j => j - xf), sr) };
    return { left, right, measures };
  }
  /* loop */
  const source = movementSource(design, contexts, { refSpeed: ref, lengthMs: movement.loopMs + 60 + movement.xfadeMs, samples, sr });
  const { loop, match } = makeSeamlessLoop(source, movement, sr);
  const P = loop.length;
  let phase = Math.floor(random() * P);
  for (let i = 0; i < len; i++) {
    const f = Math.min(trace.length - 1, Math.floor(i / fs)), g = Math.min(trace.length - 1, f + 1), x = i / fs - f;
    const v = trace[f] + (trace[g] - trace[f]) * x;
    const j = phase | 0, s = loop[j] + (loop[(j + 1) % P] - loop[j]) * (phase - j);
    const [gl, gr] = gainAt(i);
    left[i] = s * gl; right[i] = s * gr;
    phase += rateFor(v, ref, movement.pitchFollow);
    if (phase >= P) phase -= P;
  }
  const twice = new Float32Array(P * 2); twice.set(loop); twice.set(loop, P);
  const measures = { method: 'loop', refSpeed: Math.round(ref), loopMs: Math.round(P * 1000 / sr), loopMatch: Math.round(match * 100) / 100, seamDb: seamJumpDb(twice, [P], sr) };
  return { left, right, measures };
}

/* Mix timed stereo clips into one buffer (used for in-context playback). */
export function mixClips(clips, lengthSamples, sr = RENDER_RATE) {
  const left = new Float32Array(lengthSamples), right = new Float32Array(lengthSamples);
  for (const c of clips) {
    const off = Math.round(c.atMs * sr / 1000);
    mixInto(left, c.left, off, c.gain ?? 1); mixInto(right, c.right || c.left, off, c.gain ?? 1);
  }
  limit(left, right, -0.5, sr);
  return { left, right, sampleRate: sr };
}

/* Mono sample to a centred (or panned) stereo clip, resampled to `sr`. */
export function sampleClip(sample, { pan = 0, gain = 1, sr = RENDER_RATE } = {}) {
  const ratio = sample.sampleRate / sr, n = Math.floor(sample.data.length / ratio);
  const angle = (Math.max(-1, Math.min(1, pan)) + 1) * Math.PI / 4;
  const gl = Math.cos(angle) * Math.SQRT2 * gain, gr = Math.sin(angle) * Math.SQRT2 * gain;
  const left = new Float32Array(n), right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * ratio, k = Math.floor(p), f = p - k;
    const x = (sample.data[k] ?? 0) + ((sample.data[k + 1] ?? 0) - (sample.data[k] ?? 0)) * f;
    left[i] = x * gl; right[i] = x * gr;
  }
  return { left, right };
}

/* ---------- WAV ---------- */

export function decodeWav(buffer) {
  const view = new DataView(buffer instanceof ArrayBuffer ? buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  const tag = o => String.fromCharCode(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2), view.getUint8(o + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file');
  let fmt = null, off = 12;
  while (off + 8 <= view.byteLength) {
    const id = tag(off), size = view.getUint32(off + 4, true), body = off + 8;
    if (id === 'fmt ') fmt = { format: view.getUint16(body, true), channels: view.getUint16(body + 2, true), sampleRate: view.getUint32(body + 4, true), bits: view.getUint16(body + 14, true) };
    else if (id === 'data' && fmt) {
      const bytes = fmt.bits / 8, frames = Math.floor(Math.min(size, view.byteLength - body) / (bytes * fmt.channels));
      const data = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < fmt.channels; c++) {
          const p = body + (i * fmt.channels + c) * bytes;
          if (fmt.bits === 8) sum += (view.getUint8(p) - 128) / 128;
          else if (fmt.bits === 16) sum += view.getInt16(p, true) / 32768;
          else if (fmt.bits === 24) sum += ((view.getUint8(p) | view.getUint8(p + 1) << 8 | view.getInt8(p + 2) << 16)) / 8388608;
          else if (fmt.bits === 32 && fmt.format === 3) sum += view.getFloat32(p, true);
          else sum += view.getInt32(p, true) / 2147483648;
        }
        data[i] = sum / fmt.channels;
      }
      return { data, sampleRate: fmt.sampleRate };
    }
    off = body + size + (size & 1);
  }
  throw new Error('WAV has no data chunk');
}

/* 16-bit PCM WAV; mono when the channels are identical. */
export function encodeWav({ left, right, sampleRate }) {
  const stereo = right && right !== left && right.some((v, i) => v !== left[i]);
  const ch = stereo ? 2 : 1, frames = left.length;
  const buf = new ArrayBuffer(44 + frames * ch * 2), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + frames * ch * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, frames * ch * 2, true);
  let o = 44;
  for (let i = 0; i < frames; i++) for (let c = 0; c < ch; c++) {
    const s = Math.max(-1, Math.min(1, (c ? right : left)[i]));
    v.setInt16(o, Math.round(s * 32767), true); o += 2;
  }
  return buf;
}
