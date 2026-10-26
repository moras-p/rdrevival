/* In-context audition: rebuild the soundscape around one recorded moment
 * from the session (every sound the game played within the window, at its
 * recorded time and stereo position) and swap the design under review in
 * for every occurrence of its event. Pure: sample data comes from a
 * SampleLibrary-shaped object; nothing here touches Web Audio. */

import { entityTypeInfo, stageEvents } from './catalog.js';
import { FRAME_HZ, laneKey } from './session.js';
import { speedTrace } from './foley.js';
import { RENDER_RATE, limit, renderEvent, renderSpan, sampleClip, sampleKey } from './render.js';
import { mixInto } from './dsp.js';

export const CONTEXT_WINDOW_FRAMES = 25; /* 1 s either side */

/* Continuous catalog events heard along recorded spans. */
export function spanEventId(span) {
  if (span.kind === 'platform') return span.state === 'moving' ? 'platform.move' : null;
  const family = entityTypeInfo(span.source?.type ?? 0).family;
  if (family === 'boulder') return 'trap.boulder.rolling-loop';
  if (family === 'pipe-fire') return 'trap.pipe-fire.sustain';
  return null;
}

/* What the game itself plays for one occurrence today: the recovered
 * original sample for native requests (unless SoundLab replaced it) and
 * the published SoundLab variant for cues. */
export function originalSourceFor(o, library) {
  if (o.kind === 'sound') return o.suppressed ? null : { type: 'original', name: o.name };
  if (o.kind === 'cue') {
    const files = library.publishedFiles(o.name);
    return files.length ? { type: 'published', name: files[(o.cue?.serial ?? 0) % files.length] } : null;
  }
  return null;
}

/* Every sample source a window needs, so the caller can preload them. */
export function contextSources(session, { from, to, design = null, designs = {}, library }) {
  const out = new Map();
  for (const o of session.occurrencesBetween(from - LOOKBACK_FRAMES, to)) {
    const s = originalSourceFor(o, library);
    if (s) out.set(sampleKey(s), s);
  }
  for (const d of [design, ...Object.values(designs)]) for (const l of d?.layers || []) if (l.kind === 'sample') out.set(sampleKey(l.source), l.source);
  return [...out.values()];
}

function contextAt(session, frame, source) {
  return session.inspect({ id: `ctx:${frame}`, kind: 'span', name: 'span', frame, source });
}

/* Inspector context for every frame of a span (what renderSpan follows). */
export function spanContexts(session, span) {
  const out = [];
  for (let f = span.start; f <= span.end; f++) out.push(contextAt(session, f, span.source));
  return out;
}

/* Recorded speed trace of the occurrence's source from that frame to the
 * end of its motion span (empty when the source is not moving). */
export function motionAt(session, o) {
  const slot = o?.source?.slot;
  if (slot == null) return null;
  const span = session.spans.find(s => s.source.slot === slot && s.start <= o.frame && s.end >= o.frame && s.speed.length > 1);
  if (!span) return null;
  return speedTrace(span).slice(o.frame - span.start);
}

/* Lane filter from mute/solo sets of lane keys. */
export function laneAudible(key, { muted = new Set(), soloed = new Set() } = {}) {
  if (muted.has(key)) return false;
  return soloed.size ? soloed.has(key) : true;
}

/* One-shot sounds that started up to this long before a range still sound
 * into it, so playback from the middle of a long sound (a rolling boulder)
 * includes the rest of it. */
export const LOOKBACK_FRAMES = FRAME_HZ * 6;
/* Playback of a range stops at its end with this fade. */
export const END_FADE_MS = 120;

/* Group spans whose staged design replaces their stage events. */
function stagedSpans(session, designs, from, to) {
  const out = [];
  for (const s of session.spans) {
    const lead = spanEventId(s), design = lead && designs[lead];
    if (!design || design.container.mode !== 'loop' || s.end < from || s.start > to) continue;
    out.push({ span: s, design, events: new Set(stageEvents(lead)) });
  }
  return out;
}

const sameSource = (a, b) => !a || !b || a.slot == null || b.slot == null || a.slot === b.slot;

/* The voices of a stretch of the recording, unmixed: every sound with its
 * timeline lane, start time relative to `from` (negative when it started
 * before the range) and stereo samples. `designs` maps catalog event ids to
 * the designs heard in place of the game sound; `mode` is 'candidate'
 * (designs swapped in), 'original' (what the game plays) or 'solo' (only
 * the designs). A group's staged design (on its lead event) plays along
 * each of the group's spans and replaces the group's stage events there. */
export function buildScene(session, { from, to, designs = {}, mode = 'candidate', library, environment = null, environmentFor = null, sr = RENDER_RATE }) {
  from = Math.max(session.firstFrame, Math.round(from));
  to = Math.min(session.lastFrame, Math.round(to));
  if (!(to >= from)) throw new Error('Empty range');
  const frameMs = 1000 / FRAME_HZ;
  const durationMs = (to - from + 1) * frameMs;
  const voices = [];
  const replaced = new Set();
  const variants = new Map();
  const envOf = o => (environmentFor ? environmentFor(o) : environment);
  const staged = mode === 'original' ? [] : stagedSpans(session, designs, from - LOOKBACK_FRAMES, to);
  const add = (v, clip) => {
    const lengthMs = clip.left.length * 1000 / sr;
    if (v.atMs + lengthMs <= 0) return;
    voices.push({ ...v, left: clip.left, right: clip.right || clip.left, gain: clip.gain ?? 1, lengthMs });
  };
  for (const o of session.occurrencesBetween(from - LOOKBACK_FRAMES, to)) {
    const atMs = (o.frame - from) * frameMs;
    const base = { id: o.id, frame: o.frame, eventId: o.eventId, name: o.name, atMs, lane: laneKey(o.source) };
    const stage = o.eventId && staged.find(x => x.events.has(o.eventId) && o.frame >= x.span.start - 3 && o.frame <= x.span.end + 3 && sameSource(o.source, x.span.source));
    if (stage) continue; /* heard as a stage of its group's design */
    const design = mode !== 'original' && o.eventId ? designs[o.eventId] : null;
    if (design) {
      const key = `${o.eventId}@${o.frame}`;
      if (replaced.has(key)) continue; /* sound + cue for one moment: one voice */
      replaced.add(key);
      const count = Math.max(1, design.variation.count || 1);
      const state = variants.get(o.eventId) || { next: 0, last: -1 };
      let v = state.next++ % count;
      if (design.container.noRepeat && count > 1 && v === state.last) v = (v + 1) % count;
      state.last = v; variants.set(o.eventId, state);
      const r = renderEvent(design, { inspect: session.inspect(o), variant: v, samples: library.samples, environment: envOf(o), sr, motion: motionAt(session, o) });
      add({ ...base, voice: 'candidate', variant: v }, r);
      continue;
    }
    if (mode === 'solo') continue;
    const src = originalSourceFor(o, library);
    const sample = src && library.samples.get(sampleKey(src));
    if (!sample) continue;
    const pan = Number.isFinite(o.screenX) ? Math.max(-1, Math.min(1, (o.screenX - 160) / 160)) * 0.6 : 0;
    add({ ...base, voice: src.type }, { ...sampleClip(sample, { pan, sr }), gain: 0.8 });
  }
  for (const { span: s, design } of staged) {
    if (s.end < from) continue;
    const r = renderSpan(design, { contexts: spanContexts(session, s), samples: library.samples, sr });
    add({ id: s.id, frame: s.start, eventId: design.eventId, name: s.label, atMs: (s.start - from) * frameMs, lane: laneKey(s.source), voice: 'stages', frames: s.end - s.start + 1 }, r);
  }
  voices.sort((a, b) => a.atMs - b.atMs);
  return { from, to, mode, sampleRate: sr, durationMs, voices };
}

/* What a scene sounds like with the lanes' mute/solo applied: one stereo
 * buffer cut at the end of the range with a short fade. */
export function mixScene(scene, { lanes = {} } = {}) {
  const sr = scene.sampleRate, end = Math.round(scene.durationMs * sr / 1000), fade = Math.round(END_FADE_MS * sr / 1000);
  const left = new Float32Array(end + fade), right = new Float32Array(end + fade);
  for (const v of scene.voices) {
    if (!laneAudible(v.lane, lanes)) continue;
    const off = Math.round(v.atMs * sr / 1000);
    mixInto(left, v.left, off, v.gain); mixInto(right, v.right, off, v.gain);
  }
  for (let i = 0; i < fade; i++) { const g = 1 - i / fade; left[end + i] *= g; right[end + i] *= g; }
  limit(left, right, -0.5, sr);
  return { left, right, sampleRate: sr };
}

/* Which voices of a scene are heard (with the lanes applied), for reports. */
export function sceneHeard(scene, lanes = {}) {
  return scene.voices.filter(v => laneAudible(v.lane, lanes)).map(({ left, right, gain, ...v }) => ({ ...v, atMs: Math.round(v.atMs), lengthMs: Math.round(v.lengthMs) }));
}

/* A stretch of the recording mixed down (see buildScene, mixScene). */
export function buildSceneMix(session, { lanes = {}, ...opts }) {
  const scene = buildScene(session, opts);
  return { ...mixScene(scene, { lanes }), from: scene.from, to: scene.to, mode: scene.mode, heard: sceneHeard(scene, lanes) };
}

/* The window an in-context audition plays by default: ±1 s around the
 * occurrence, or the whole span plus 1 s either side. */
export function contextRange(session, target, windowFrames = CONTEXT_WINDOW_FRAMES) {
  const occ = session.occurrence(target);
  const span = occ ? null : session.spans.find(s => s.id === target);
  if (!occ && !span) throw new Error(`Unknown occurrence or span ${target}`);
  const centre = occ ? occ.frame : span.start;
  return {
    from: Math.max(session.firstFrame, centre - windowFrames),
    to: Math.min(session.lastFrame, (span ? span.end : centre) + windowFrames),
    centre
  };
}

/* In-context audition of one design around a target (or an explicit range). */
export function buildContextMix(session, { target, design, mode = 'candidate', library, environment = null, range = null, lanes = {}, windowFrames = CONTEXT_WINDOW_FRAMES, sr = RENDER_RATE }) {
  const r = range || contextRange(session, target, windowFrames);
  const centre = target ? contextRange(session, target, 0).centre : r.from;
  const mix = buildSceneMix(session, { from: r.from, to: r.to, designs: design ? { [design.eventId]: design } : {}, mode, library, environment, lanes, sr });
  return { ...mix, centre };
}
