/* SoundLab Studio sound designs.
 *
 * A design is a small declarative document per catalog event: ordered layers
 * (recorded sample, tone, noise) each with envelope, pitch, filter, EQ and
 * drive; seeded variation; a container mode (one-shot pool or loop with
 * start/sustain/stop segments); game-parameter mappings that read inspector
 * values (speed, distance, pan, ...) and drive parameters; and space/master
 * settings. Every editable value is described in PARAMS so the UI, the
 * WebMCP patch tool and the renderer share one bounded vocabulary. */

import { CATALOG_BY_ID, EVENT_GROUPS, STAGE_SEGMENT } from './catalog.js';
import { EVENT_FOLEY, FOLEY_PARAMS, defaultFoley, normalizeFoley } from './foley.js';

export const DESIGN_SCHEMA = 'soundlab.studio-design.v1';
export const LAYER_KINDS = Object.freeze(['sample', 'foley', 'tone', 'noise']);
/* Foley controls a mapping may drive on a foley layer. */
export const FOLEY_MAPPABLE = Object.freeze(['intensity', 'size', 'weight', 'brightness', 'roughness', 'density', 'speed', 'distance']);
export const WAVEFORMS = Object.freeze(['sine', 'triangle', 'square', 'saw']);
export const NOISE_COLORS = Object.freeze(['white', 'pink', 'brown']);
export const FILTER_TYPES = Object.freeze(['off', 'lowpass', 'highpass', 'bandpass']);
export const SEGMENTS = Object.freeze(['all', 'start', 'loop', 'stop']);
export const CONTAINER_MODES = Object.freeze(['oneshot', 'loop']);
export const CURVES = Object.freeze(['linear', 'exp', 'log', 'step']);

/* How a staged (loop) design moves between its stages along a span:
 * `in` from the start sound into the movement, `out` from the movement
 * into the stop sound. Each has a mode and a time. */
export const TRANSITION_MODES = Object.freeze({
  in: Object.freeze({
    crossfade: 'The start sound fades out while the movement fades in',
    swell: 'The movement swells in slowly; the start sound plays out on top',
    after: 'The movement waits for the time, then comes in',
    cut: 'The movement starts at full level with the start sound'
  }),
  out: Object.freeze({
    crossfade: 'The movement fades out while the stop sound fades in',
    ringout: 'The stop sound hits at the end; the movement rings on and fades',
    early: 'The movement fades out over the time before the stop sound',
    cut: 'The movement stops dead as the stop sound hits'
  })
});
export const TRANSITION_TIME = Object.freeze([0, 3000, 250, 'ms', 'Transition time', 'How long the change between stages takes']);
export function defaultTransitions() { return { in: { mode: 'crossfade', timeMs: 400 }, out: { mode: 'crossfade', timeMs: 300 } }; }

/* How the movement stage of a staged design is played along the recorded
 * speed. The game can retrigger short sounds on a tick cadence with a pitch
 * set per trigger (as the platform cog does), so `bites` ships without new
 * native support; `loop` needs a looping voice whose pitch changes while it
 * plays; `synth` is generated for the whole run and is a preview only. */
export const MOVEMENT_METHODS = Object.freeze({
  bites: 'Short bites cut from the movement sound, one per distance travelled, picked at random and pitched by speed (plays in the game like the platform cog)',
  loop: 'One seamless loop of the movement sound with an automatic loop point and crossfade; pitch and level follow speed (needs a native looping voice)',
  synth: 'Generated along the whole recorded speed trace (a preview: the game cannot generate it live)'
});
export const MOVEMENT_PARAMS = Object.freeze({
  bitePx: [2, 64, 8, 'px', 'Bite distance', 'Distance travelled per bite (8 px is one map cell)'],
  variants: [1, 8, 4, '', 'Bites', 'How many different bites to pick from'],
  pitchFollow: [0, 1, 1, '', 'Pitch follows speed', '0 keeps the pitch; 1 plays twice as fast an octave higher'],
  refSpeed: [0, 400, 0, 'px/s', 'Made at speed', 'The speed the bites or the loop are made at; 0 uses the typical speed of the run'],
  loopMs: [300, 4000, 1200, 'ms', 'Loop length', 'Length of the seamless loop'],
  xfadeMs: [2, 200, 8, 'ms', 'Seam', 'Crossfade at each bite edge or loop seam']
});
export function defaultMovement(method = 'synth') { return { method, ...Object.fromEntries(Object.entries(MOVEMENT_PARAMS).map(([k, v]) => [k, v[2]])) }; }
/* A design's movement settings with defaults filled in. */
export function movementOf(design) { return { ...defaultMovement(), ...(design?.container?.movement || {}) }; }

/* Inspector values a mapping can read, with the range the UI suggests. */
export const MAPPING_SOURCES = Object.freeze({
  speed: { label: 'Source speed (px/s)', min: 0, max: 300 },
  speedX: { label: 'Horizontal speed (px/s)', min: 0, max: 300 },
  speedY: { label: 'Vertical speed (px/s, + down)', min: -300, max: 300 },
  acceleration: { label: 'Acceleration magnitude (px/s²)', min: 0, max: 3000 },
  distance: { label: 'Distance to Rick (px)', min: 0, max: 320 },
  pan: { label: 'Stereo position (-1 left … 1 right)', min: -1, max: 1 },
  size: { label: 'Source size (px²)', min: 64, max: 1600 },
  nearby: { label: 'Sounds within ±0.5 s', min: 0, max: 12 }
});

/* name: [min, max, default, unit, label] */
const LAYER_PARAMS = {
  gain: [-48, 12, 0, 'dB', 'Gain'],
  delay: [0, 1000, 0, 'ms', 'Start delay'],
  pitch: [-24, 24, 0, 'st', 'Pitch'],
  pitchEnv: [-48, 48, 0, 'st', 'Pitch sweep'],
  pitchEnvTime: [1, 2000, 120, 'ms', 'Sweep time'],
  attack: [0, 2000, 2, 'ms', 'Attack'],
  hold: [0, 4000, 0, 'ms', 'Hold'],
  decay: [1, 4000, 180, 'ms', 'Decay'],
  sustain: [0, 1, 0, '', 'Sustain level'],
  release: [1, 4000, 60, 'ms', 'Release'],
  duration: [5, 8000, 400, 'ms', 'Length'],
  freq: [20, 8000, 110, 'Hz', 'Tone frequency'],
  filterFreq: [20, 20000, 8000, 'Hz', 'Filter cutoff'],
  filterQ: [0.1, 18, 0.7, '', 'Filter resonance'],
  filterEnv: [-48, 48, 0, 'st', 'Filter sweep'],
  eqLow: [-18, 18, 0, 'dB', 'EQ low (200 Hz)'],
  eqMid: [-18, 18, 0, 'dB', 'EQ mid (1 kHz)'],
  eqHigh: [-18, 18, 0, 'dB', 'EQ high (5 kHz)'],
  drive: [0, 1, 0, '', 'Drive'],
  start: [0, 1, 0, '', 'Sample start'],
  reverse: [0, 1, 0, '', 'Reverse']
};
const MASTER_PARAMS = {
  gain: [-48, 12, 0, 'dB', 'Master gain'],
  pitch: [-24, 24, 0, 'st', 'Master pitch'],
  panAmount: [0, 1, 0.6, '', 'Follow stereo position'],
  distanceAmount: [0, 1, 0.3, '', 'Distance attenuation'],
  room: [0, 1, 0.35, '', 'Room amount'],
  limiter: [-24, 0, -1, 'dBFS', 'Limiter ceiling']
};
const VARIATION_PARAMS = {
  count: [1, 8, 4, '', 'Variants'],
  pitch: [0, 1200, 60, 'cents', 'Pitch spread'],
  gain: [0, 12, 1.5, 'dB', 'Gain spread'],
  time: [0, 60, 4, 'ms', 'Timing spread'],
  filter: [0, 24, 0, 'st', 'Brightness spread'],
  seed: [0, 2147483647, 1, '', 'Seed']
};
const LOOP_PARAMS = {
  crossfade: [0, 200, 20, 'ms', 'Loop crossfade'],
  length: [20, 4000, 400, 'ms', 'Loop length'],
  stopTail: [0, 2000, 120, 'ms', 'Stop tail']
};

export const PARAMS = Object.freeze({ layer: LAYER_PARAMS, master: MASTER_PARAMS, variation: VARIATION_PARAMS, loop: LOOP_PARAMS });

/* Parameters a mapping can drive: "master.gain", "layer:<id>.filterFreq". */
export function mappingTargets(design) {
  const out = ['master.gain', 'master.pitch', 'master.room'];
  for (const layer of design.layers) {
    for (const p of ['gain', 'pitch', 'filterFreq', 'drive', 'decay', 'duration']) out.push(`layer:${layer.id}.${p}`);
    if (layer.kind === 'foley') for (const p of FOLEY_MAPPABLE) out.push(`layer:${layer.id}.foley.${p}`);
  }
  return out;
}

function defaults(table) { return Object.fromEntries(Object.entries(table).map(([k, v]) => [k, v[2]])); }
function clampParam(table, key, value) {
  const spec = table[key];
  const n = Number(value);
  if (!spec || !Number.isFinite(n)) return { ok: false };
  const v = Math.max(spec[0], Math.min(spec[1], n));
  return { ok: true, value: v, clamped: v !== n };
}

/* Layer ids are stable within a design: kind plus the first free number. */
export function nextLayerId(design, kind) {
  const used = new Set((design?.layers || []).map(l => l.id));
  let i = 1;
  while (used.has(`${kind}${i}`)) i += 1;
  return `${kind}${i}`;
}

export function newLayer(kind = 'tone', overrides = {}) {
  if (!LAYER_KINDS.includes(kind)) throw new Error(`Unknown layer kind ${kind}`);
  const base = { id: `${kind}1`, kind, enabled: true, solo: false, segment: 'all', ...defaults(LAYER_PARAMS) };
  if (kind === 'sample') Object.assign(base, { source: { type: 'original', name: '' }, decay: 4000, sustain: 1, duration: 8000 });
  if (kind === 'tone') Object.assign(base, { waveform: 'sine', filter: 'off' });
  if (kind === 'noise') Object.assign(base, { color: 'white', filter: 'lowpass', filterFreq: 3000 });
  if (kind === 'sample') base.filter = 'off';
  if (kind === 'foley') Object.assign(base, { foley: defaultFoley(), decay: 4000, sustain: 1, duration: 8000, filter: 'off' });
  return { ...base, ...overrides };
}

/* Start from what the game plays today: the published SoundLab sound when
 * the event has one, else the recovered original sample (`original` names
 * the one actually heard, e.g. ent3 for a trap whose cue slot varies).
 * A group's lead event starts as a staged design: the game's start sound
 * (or a Foley start), a Foley movement that follows the recorded speed,
 * and a Foley stop; `stageSources` gives game samples per stage. */
export function defaultDesign(eventId, { published = null, original = null, stageSources = {} } = {}) {
  const event = CATALOG_BY_ID[eventId];
  if (!event) throw new Error(`Unknown event ${eventId}`);
  const grp = EVENT_GROUPS.find(g => g.lead === eventId);
  if (grp) return stagedDesign(grp, stageSources);
  const continuous = event.status === 'needs-hook' && /loop|move|sustain/.test(eventId);
  const layers = [];
  const name = original || event.sfx[0] || null;
  if (published) layers.push(newLayer('sample', { id: 'game', source: { type: 'published', name: published } }));
  else if (name) layers.push(newLayer('sample', { id: 'game', source: { type: 'original', name } }));
  else layers.push(newLayer('noise', { id: 'noise1', decay: continuous ? 4000 : 220, sustain: continuous ? 0.8 : 0, filterFreq: 1200 }));
  return {
    schema: DESIGN_SCHEMA,
    eventId,
    revision: 0,
    container: { mode: continuous ? 'loop' : 'oneshot', noRepeat: true, ...defaults(LOOP_PARAMS) },
    layers,
    variation: defaults(VARIATION_PARAMS),
    mappings: [],
    master: defaults(MASTER_PARAMS),
    notes: ''
  };
}

function stagedDesign(grp, stageSources) {
  const layers = [];
  for (const stage of grp.stages) {
    const segment = STAGE_SEGMENT[stage.id];
    const src = stageSources[stage.id];
    const eventId = stage.id === 'move' ? grp.lead : stage.events[0];
    if (src) { layers.push(newLayer('sample', { id: stage.id, segment, source: { type: src.type, name: src.name } })); continue; }
    if (!eventId) continue;
    const foley = defaultFoley({ ...(EVENT_FOLEY[eventId] || {}), followMotion: stage.id === 'move' });
    layers.push(newLayer('foley', { id: stage.id, segment, foley }));
  }
  return {
    schema: DESIGN_SCHEMA, eventId: grp.lead, revision: 0,
    container: { mode: 'loop', noRepeat: true, ...defaults(LOOP_PARAMS), transitions: defaultTransitions(), movement: defaultMovement(grp.movement) },
    layers, variation: defaults(VARIATION_PARAMS), mappings: [], master: defaults(MASTER_PARAMS), notes: ''
  };
}

/* A design's transitions with defaults filled in (older drafts have none). */
export function transitionsOf(design) {
  const t = design?.container?.transitions || {}, d = defaultTransitions();
  return { in: { ...d.in, ...(t.in || {}) }, out: { ...d.out, ...(t.out || {}) } };
}

export function cloneDesign(design) { return JSON.parse(JSON.stringify(design)); }

/* Strict patch used by the UI and by WebMCP. Unknown keys are rejected, values
 * outside the published range are clamped and reported. Returns the new
 * design plus a report; the input is not mutated. */
export function patchDesign(design, patch = {}) {
  const next = cloneDesign(design);
  const report = { applied: [], clamped: [], rejected: [] };
  const setFrom = (table, target, values, prefix) => {
    for (const [k, v] of Object.entries(values || {})) {
      const r = clampParam(table, k, v);
      if (!r.ok) { report.rejected.push(`${prefix}.${k}`); continue; }
      target[k] = r.value; report.applied.push(`${prefix}.${k}`);
      if (r.clamped) report.clamped.push(`${prefix}.${k}`);
    }
  };
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'master') setFrom(MASTER_PARAMS, next.master, value, 'master');
    else if (key === 'variation') setFrom(VARIATION_PARAMS, next.variation, value, 'variation');
    else if (key === 'container') {
      const { mode, noRepeat, transitions, movement, ...rest } = value || {};
      if (mode !== undefined) { if (CONTAINER_MODES.includes(mode)) { next.container.mode = mode; report.applied.push('container.mode'); } else report.rejected.push('container.mode'); }
      if (transitions !== undefined) patchTransitions(next, transitions, report);
      if (movement !== undefined) patchMovement(next, movement, report);
      if (noRepeat !== undefined) { next.container.noRepeat = !!noRepeat; report.applied.push('container.noRepeat'); }
      setFrom(LOOP_PARAMS, next.container, rest, 'container');
    } else if (key === 'layers') {
      for (const lp of value || []) patchLayer(next, lp, report);
    } else if (key === 'addLayer') {
      try { const layer = newLayer(value.kind, { id: nextLayerId(next, value.kind) }); next.layers.push(layer); patchLayer(next, { ...value, id: layer.id, kind: undefined }, report); report.applied.push(`addLayer:${layer.id}`); }
      catch { report.rejected.push('addLayer'); }
    } else if (key === 'removeLayer') {
      const before = next.layers.length;
      next.layers = next.layers.filter(l => l.id !== value);
      next.mappings = next.mappings.filter(m => !m.target.startsWith(`layer:${value}.`));
      (next.layers.length < before ? report.applied : report.rejected).push(`removeLayer:${value}`);
    } else if (key === 'mappings') {
      const valid = [];
      for (const m of value || []) {
        const ok = MAPPING_SOURCES[m.source] && mappingTargets(next).includes(m.target) && CURVES.includes(m.curve || 'linear')
          && [m.inMin, m.inMax, m.outMin, m.outMax].every(Number.isFinite);
        if (ok) valid.push({ source: m.source, target: m.target, curve: m.curve || 'linear', inMin: m.inMin, inMax: m.inMax, outMin: m.outMin, outMax: m.outMax });
        else report.rejected.push(`mapping:${m.source}->${m.target}`);
      }
      next.mappings = valid; report.applied.push('mappings');
    } else if (key === 'notes') { next.notes = String(value).slice(0, 2000); report.applied.push('notes'); }
    else report.rejected.push(key);
  }
  if (report.applied.length) next.revision = (design.revision || 0) + 1;
  return { design: next, report };
}

function patchTransitions(design, value, report) {
  const t = transitionsOf(design);
  for (const [side, v] of Object.entries(value || {})) {
    if (!TRANSITION_MODES[side] || !v || typeof v !== 'object') { report.rejected.push(`container.transitions.${side}`); continue; }
    for (const [k, x] of Object.entries(v)) {
      const path = `container.transitions.${side}.${k}`;
      if (k === 'mode') { if (TRANSITION_MODES[side][x]) { t[side].mode = x; report.applied.push(path); } else report.rejected.push(path); }
      else if (k === 'timeMs') {
        const n = Number(x);
        if (!Number.isFinite(n)) { report.rejected.push(path); continue; }
        t[side].timeMs = Math.max(TRANSITION_TIME[0], Math.min(TRANSITION_TIME[1], n)); report.applied.push(path);
        if (t[side].timeMs !== n) report.clamped.push(path);
      } else report.rejected.push(path);
    }
  }
  design.container.transitions = t;
}

function patchMovement(design, value, report) {
  const m = movementOf(design);
  for (const [k, x] of Object.entries(value || {})) {
    const path = `container.movement.${k}`;
    if (k === 'method') { if (MOVEMENT_METHODS[x]) { m.method = x; report.applied.push(path); } else report.rejected.push(path); continue; }
    const r = clampParam(MOVEMENT_PARAMS, k, x);
    if (!r.ok) { report.rejected.push(path); continue; }
    m[k] = k === 'variants' ? Math.round(r.value) : r.value; report.applied.push(path);
    if (r.clamped) report.clamped.push(path);
  }
  design.container.movement = m;
}

function patchLayer(design, lp, report) {
  const layer = design.layers.find(l => l.id === lp.id);
  if (!layer) { report.rejected.push(`layer:${lp.id}`); return; }
  for (const [k, v] of Object.entries(lp)) {
    if (k === 'id' || v === undefined) continue;
    const path = `layer:${layer.id}.${k}`;
    if (k === 'enabled' || k === 'solo') { layer[k] = !!v; report.applied.push(path); }
    else if (k === 'segment') { if (SEGMENTS.includes(v)) { layer.segment = v; report.applied.push(path); } else report.rejected.push(path); }
    else if (k === 'waveform' && layer.kind === 'tone') { if (WAVEFORMS.includes(v)) { layer.waveform = v; report.applied.push(path); } else report.rejected.push(path); }
    else if (k === 'color' && layer.kind === 'noise') { if (NOISE_COLORS.includes(v)) { layer.color = v; report.applied.push(path); } else report.rejected.push(path); }
    else if (k === 'filter') { if (FILTER_TYPES.includes(v)) { layer.filter = v; report.applied.push(path); } else report.rejected.push(path); }
    else if (k === 'foley' && layer.kind === 'foley') {
      if (!v || typeof v !== 'object') { report.rejected.push(path); continue; }
      const r = normalizeFoley(v, layer.foley);
      layer.foley = r.foley;
      for (const key of r.report.applied) report.applied.push(`${path}.${key}`);
      for (const key of r.report.clamped) report.clamped.push(`${path}.${key}`);
      for (const key of r.report.rejected) report.rejected.push(`${path}.${key}`);
    } else if (k === 'source' && layer.kind === 'sample') {
      if (v && ['original', 'published', 'classic', 'take'].includes(v.type) && typeof v.name === 'string') { layer.source = { type: v.type, name: v.name }; report.applied.push(path); }
      else report.rejected.push(path);
    } else {
      const r = clampParam(LAYER_PARAMS, k, v);
      if (!r.ok) { report.rejected.push(path); continue; }
      layer[k] = r.value; report.applied.push(path);
      if (r.clamped) report.clamped.push(path);
    }
  }
}

/* Read the inspector context into mapping source values. */
export function contextValues(inspect) {
  const a = inspect?.actor;
  return {
    speed: a?.speed ?? 0,
    speedX: Math.abs(a?.velocity?.x ?? 0),
    speedY: a?.velocity?.y ?? 0,
    acceleration: a ? Math.hypot(a.acceleration.x, a.acceleration.y) : 0,
    distance: inspect?.listener?.distancePx ?? 0,
    pan: inspect?.pan ?? 0,
    size: a ? a.size.w * a.size.h : 0,
    nearby: inspect?.nearby?.length ?? 0
  };
}

export function curveValue(m, input) {
  const span = m.inMax - m.inMin || 1;
  let t = Math.max(0, Math.min(1, (input - m.inMin) / span));
  if (m.curve === 'exp') t = t * t;
  else if (m.curve === 'log') t = Math.sqrt(t);
  else if (m.curve === 'step') t = t < 0.5 ? 0 : 1;
  return m.outMin + (m.outMax - m.outMin) * t;
}

/* The design with every mapping applied for one context. Mapped values
 * replace the authored value (and are clamped to the parameter's range). */
export function resolveDesign(design, inspect) {
  const values = contextValues(inspect);
  const out = cloneDesign(design);
  for (const m of design.mappings) {
    const v = curveValue(m, values[m.source]);
    const [scope, param, sub] = m.target.split('.');
    if (scope === 'master') { const r = clampParam(MASTER_PARAMS, param, v); if (r.ok) out.master[param] = r.value; }
    else if (param === 'foley') {
      const layer = out.layers.find(l => `layer:${l.id}` === scope && l.kind === 'foley');
      if (layer && FOLEY_PARAMS[sub]) layer.foley = normalizeFoley({ [sub]: v }, layer.foley).foley;
    } else {
      const layer = out.layers.find(l => `layer:${l.id}` === scope);
      const r = clampParam(LAYER_PARAMS, param, v);
      if (layer && r.ok) layer[param] = r.value;
    }
  }
  return { design: out, values };
}
