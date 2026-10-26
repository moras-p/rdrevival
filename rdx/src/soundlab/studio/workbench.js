/* SoundLab Studio workbench: the design, Foley, playback and review logic
 * behind the Design, Foley and Review tabs and the WebMCP tools. No DOM:
 * audio output, the session and the view are injected, so every action is
 * unit tested under node and the page and agents share one implementation. */

import { CATALOG_BY_ID, EVENT_GROUPS, STAGE_SEGMENT } from './catalog.js';
import { cloneDesign, defaultDesign, movementOf, patchDesign } from './design.js';
import { EARSHOT_DIRECTIONS } from './earshot.js';
import { analyze, compare, summarize } from './analysis.js';
import { buildScene, contextRange, contextSources, laneAudible, motionAt, originalSourceFor, sceneHeard, spanContexts, spanEventId } from './context.js';
import { RENDER_RATE, decodeWav, encodeWav, renderEvent, renderSpan, sampleClip, sampleKey, typicalSpeed } from './render.js';
import {
  FOLEY_MODELS, applyDescription, fitToReference, generateTakes, matchDistance, matchScore, normalizeFoley,
  parseDescription, referenceFeatures, renderFoley, sceneProfile, speedTrace
} from './foley.js';
import { StudioStore } from './review.js';
import { emitterLocations, hasEmitters } from './emitters.js';
import { FRAME_HZ, laneKey } from './session.js';

const MAX_PLAY_FRAMES = FRAME_HZ * 90;
const LOOP_LIMIT = 200;
const TAKE_AUDIO_KEY = 'rdx.soundlab.take-audio.v1';
const TAKE_AUDIO_LIMIT = 3_000_000; /* characters of base64 PCM kept in the browser */

export function candidateName(eventId, date = new Date()) {
  const label = CATALOG_BY_ID[eventId]?.label || eventId;
  const when = date.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return `${label} · ${when}`;
}

/* A player that renders nothing: for tests and agents without speakers. */
export class SilentPlayer {
  constructor() { this.played = []; this.scenes = []; this.playing = false; this.volume = 1; this.laneGains = null; }
  async play(buf, { onProgress = null } = {}) {
    const durationMs = buf.left.length / buf.sampleRate * 1000;
    this.played.push({ durationMs, buf }); this.playing = true;
    onProgress?.(0);
    return { audible: false, durationMs, ended: Promise.resolve() };
  }
  async playScene(scene, { gains = {}, onProgress = null } = {}) {
    this.scenes.push({ scene, gains: { ...gains } }); this.playing = true;
    onProgress?.(0);
    return { audible: false, durationMs: scene.durationMs, ended: Promise.resolve() };
  }
  setLaneGains(gains) { this.laneGains = { ...gains }; }
  setVolume(v) { this.volume = v; }
  stop() { this.playing = false; }
}

export class Workbench {
  constructor({ session, library, player = new SilentPlayer(), storage, hooks = {}, now = () => new Date(), sleep = wait, earshot = null }) {
    this.sleep = sleep;
    this.earshot = earshot;
    if (library && typeof library === 'object') library.restoreTake = source => this.#restoreTakeAudio(source);
    this.getSession = session;
    this.library = library;
    this.player = player;
    this.store = new StudioStore(storage, { now: () => now().toISOString() });
    this.hooks = { changed: () => {}, status: () => {}, showFrame: () => {}, ...hooks };
    this.now = now;
    this.eventId = null;
    this.design = null;
    this.target = null;
    this.range = null;
    this.last = null;
    this.lanes = { muted: new Set(), soloed: new Set() };
    this.playToken = 0;
    this.playback = null;
    this.volume = 1;
    this.loop = false;
    this.foley = { recipe: null, description: '', terms: [], reference: null, referenceWeight: 0.7, allowModelChange: false, spread: 0.15, stage: 'move', takes: [], fit: null, scene: null, eventId: null };
  }

  get session() { return this.getSession(); }

  /* ---------- design ---------- */

  #publishedFor(eventId) {
    for (const name of CATALOG_BY_ID[eventId]?.semantic || []) { const files = this.library.publishedFiles(name); if (files.length) return files[0]; }
    return null;
  }

  designFor(eventId, target = null) {
    if (!CATALOG_BY_ID[eventId]) throw new Error(`Unknown event ${eventId}`);
    const saved = this.store.design(eventId);
    if (saved) return saved;
    const heard = target && this.session.occurrence(target);
    const original = heard?.kind === 'sound' ? heard.name : this.session.occurrencesOf(eventId).find(o => o.kind === 'sound')?.name;
    return defaultDesign(eventId, { published: this.#publishedFor(eventId), original, stageSources: this.#stageSources(eventId) });
  }

  /* Game samples for a group's start and stop stages (the movement starts
   * as Foley that follows the recorded speed). */
  #stageSources(eventId) {
    const grp = EVENT_GROUPS.find(g => g.lead === eventId);
    if (!grp) return {};
    const out = {};
    for (const stage of grp.stages) {
      if (stage.id === 'move') continue;
      for (const id of stage.events) {
        const o = this.session.occurrencesOf(id).find(x => originalSourceFor(x, this.library));
        const src = o ? originalSourceFor(o, this.library) : (this.#publishedFor(id) ? { type: 'published', name: this.#publishedFor(id) } : CATALOG_BY_ID[id].sfx[0] ? { type: 'original', name: CATALOG_BY_ID[id].sfx[0] } : null);
        if (src) { out[stage.id] = src; break; }
      }
    }
    return out;
  }

  /* The open design's group when it is that group's staged design. */
  stagedGroup() {
    const g = EVENT_GROUPS.find(x => x.lead === this.eventId);
    return g && this.design?.container.mode === 'loop' ? g : null;
  }

  targetValid(id) { return !!(id && (this.session.occurrence(id) || this.session.spans.find(s => s.id === id))); }

  defaultTarget(eventId, preferred = null) {
    const s = this.session;
    const o = preferred && s.occurrence(preferred);
    if (o && o.eventId === eventId) return o.id;
    const first = s.occurrencesOf(eventId)[0];
    if (first) return first.id;
    return s.spans.find(sp => spanEventId(sp) === eventId)?.id || null;
  }

  targets(eventId = this.eventId) {
    const s = this.session;
    const rows = s.occurrencesOf(eventId).map(o => ({ id: o.id, kind: 'occurrence', frame: o.frame, label: `${(o.frame - s.firstFrame) / FRAME_HZ}s · frame ${o.frame} · ${roomId(o.submap)}` }));
    for (const sp of s.spans) if (spanEventId(sp) === eventId) rows.push({ id: sp.id, kind: 'span', frame: sp.start, label: `${sp.label} · frames ${sp.start}–${sp.end}` });
    return rows;
  }

  /* Open an event: its saved draft or a fresh design from the game sound,
   * auditioned against `target` (or the best recorded match). */
  open(eventId, { target, preferred = null } = {}) {
    if (!CATALOG_BY_ID[eventId]) throw new Error(`Unknown event ${eventId}`);
    const changed = eventId !== this.eventId;
    if (changed) { this.eventId = eventId; this.target = null; this.last = null; }
    if (target !== undefined) this.target = target || null;
    if (!this.targetValid(this.target)) this.target = this.defaultTarget(eventId, preferred);
    if (changed || !this.design) this.design = this.designFor(eventId, this.target);
    this.range = this.target ? contextRange(this.session, this.target) : null;
    if (changed || this.foley.eventId !== eventId) this.resetFoley();
    this.hooks.changed('design');
    return this.describe();
  }

  setTarget(target) {
    if (target && !this.targetValid(target)) throw new Error(`Unknown occurrence or span ${target}`);
    this.target = target || null;
    this.range = this.target ? contextRange(this.session, this.target) : null;
    this.foley.scene = null;
    this.hooks.changed('target');
    return this.describe();
  }

  #require() { if (!this.design) throw new Error('Open an event first (get_design / pick one in the list)'); }

  patch(eventId, patch, { by = 'human' } = {}) {
    if (eventId && eventId !== this.eventId) this.open(eventId);
    this.#require();
    const { design, report } = patchDesign(this.design, patch);
    if (report.applied.length) {
      this.design = design;
      this.store.saveDesign(design);
      this.hooks.changed(by === 'agent' ? 'design-agent' : 'design-patch');
    }
    return { report, design: cloneDesign(this.design) };
  }

  reset(eventId = this.eventId) {
    this.store.resetDesign(eventId);
    if (eventId === this.eventId) { this.design = this.designFor(eventId, this.target); this.last = null; }
    this.hooks.changed('design');
    return cloneDesign(this.designFor(eventId, eventId === this.eventId ? this.target : null));
  }

  saved(eventId = this.eventId) { return this.store.designedEvents().includes(eventId); }

  describe() {
    const e = CATALOG_BY_ID[this.eventId];
    return {
      eventId: this.eventId, event: e ? { id: e.id, label: e.label, family: e.family, status: e.status, description: e.description } : null,
      target: this.target, range: this.range, targets: this.eventId ? this.targets().slice(0, 40) : [],
      design: this.design ? cloneDesign(this.design) : null, saved: this.eventId ? this.saved() : false
    };
  }

  inspectTarget(target = this.target) {
    if (!target) return null;
    const s = this.session, o = s.occurrence(target);
    if (o) return s.inspect(o);
    const sp = s.spans.find(x => x.id === target);
    return sp ? s.inspect({ id: sp.id, kind: 'span', name: sp.label, frame: sp.start, source: sp.source }) : null;
  }

  motionForTarget(target = this.target) {
    const s = this.session, o = target && s.occurrence(target);
    if (o) return motionAt(s, o);
    const sp = target && s.spans.find(x => x.id === target);
    return sp?.speed?.length > 1 ? speedTrace(sp) : null;
  }

  /* The recorded span a continuous design plays along: the target span, or
   * the span of the target occurrence's source at that moment. */
  targetSpan(eventId = this.eventId, target = this.target) {
    const s = this.session;
    const span = target && s.spans.find(x => x.id === target);
    if (span) return span;
    const o = target && s.occurrence(target);
    if (!o) return null;
    return s.spans.find(x => spanEventId(x) === eventId && x.start <= o.frame + 3 && x.end >= o.frame && (!o.source || x.source?.slot === o.source.slot)) || null;
  }

  environmentFor(inspect) { return this.library.environmentFor(inspect?.room) || null; }

  referenceSource(inspectData = this.inspectTarget()) {
    const o = inspectData?.occurrence ? this.session.occurrence(inspectData.occurrence.id) : null;
    const fromOcc = o && originalSourceFor(o, this.library);
    if (fromOcc) return fromOcc;
    const published = this.#publishedFor(this.eventId);
    if (published) return { type: 'published', name: published };
    const sfx = CATALOG_BY_ID[this.eventId]?.sfx[0];
    return sfx ? { type: 'original', name: sfx } : null;
  }

  async #loadDesignSamples(design, extra = []) {
    const sources = [...design.layers.filter(l => l.kind === 'sample').map(l => l.source), ...extra].filter(Boolean);
    for (const s of sources) if (s.type === 'take' && !this.library.samples.has(sampleKey(s))) this.#restoreTakeAudio(s);
    await this.library.load(sources);
    const missing = sources.filter(s => !this.library.samples.has(sampleKey(s)));
    if (missing.length) this.hooks.status(`Could not load ${missing.map(m => m.name).join(', ')}`);
    return missing;
  }

  async renderCandidate({ variant = 0, segment = 'oneshot', design = this.design } = {}) {
    if (!design) this.#require();
    const inspectData = this.inspectTarget();
    const ref = this.referenceSource(inspectData);
    const missing = await this.#loadDesignSamples(design, [ref]);
    const environment = this.environmentFor(inspectData);
    /* a staged design plays its whole run (start, movement, stop) */
    const span = design.container.mode === 'loop' && segment === 'oneshot' ? this.targetSpan(design.eventId) : null;
    const candidate = span
      ? { ...renderSpan(design, { contexts: spanContexts(this.session, span), samples: this.library.samples }), context: renderEvent(design, { inspect: inspectData, segment: 'start', samples: this.library.samples }).context }
      : renderEvent(design, { inspect: inspectData, variant, segment, samples: this.library.samples, environment, motion: this.motionForTarget() });
    const refSample = ref && this.library.samples.get(sampleKey(ref));
    const reference = refSample ? { ...sampleClip(refSample, { sr: RENDER_RATE }), sampleRate: RENDER_RATE } : null;
    const a = analyze(candidate), b = reference ? analyze(reference) : null;
    this.last = { candidate, reference, analysis: a, referenceAnalysis: b, comparison: compare(a, b), context: candidate.context, referenceSource: ref, environment: environment?.id || null, variant, segment, missing, movement: candidate.movement || null };
    return this.last;
  }

  report(r = this.last, { detail = false } = {}) {
    if (!r) return null;
    return {
      eventId: this.eventId, revision: this.design?.revision, target: this.target, variant: r.variant, segment: r.segment,
      context: r.context, environment: r.environment, reference: r.referenceSource, missingSamples: r.missing?.map(m => m.name) || [],
      analysis: detail ? r.analysis : summarize(r.analysis), referenceAnalysis: detail ? r.referenceAnalysis : summarize(r.referenceAnalysis),
      comparison: r.comparison, ...(r.movement ? { movement: r.movement } : {})
    };
  }

  /* ---------- playback (one token: any new play or stop ends the last) ---------- */

  stop() {
    this.playToken++;
    this.player.stop();
    if (this.playback) { this.playback = null; this.hooks.changed('playback'); }
  }

  async #play(buf, info, { onProgress = null, scene = null } = {}) {
    const token = ++this.playToken;
    this.player.stop();
    this.playback = { ...info, token, scene };
    this.hooks.changed('playback');
    const progress = ms => { if (token === this.playToken) onProgress?.(ms); };
    const out = scene ? await this.player.playScene(scene, { gains: this.#laneGains(scene), onProgress: progress }) : await this.player.play(buf, { onProgress: progress });
    out.ended.then(() => { if (token === this.playToken && this.playback?.token === token) { this.playback = null; this.hooks.changed('playback'); } });
    return { token, ...out };
  }

  /* `which`: 'design' or 'game'. */
  async play(which = 'design', { variant = 0 } = {}) {
    const r = await this.renderCandidate({ variant });
    const buf = which === 'game' ? r.reference : r.candidate;
    if (!buf) throw new Error('This event has no game sound to compare with');
    const label = which === 'game' ? 'Game sound' : `Design${this.design.variation.count > 1 ? ` · variant ${variant + 1} of ${this.design.variation.count}` : ''}`;
    const out = await this.#play({ ...buf, sampleRate: RENDER_RATE }, { kind: which, label });
    this.hooks.status(`${label} · ${Math.round(out.durationMs)} ms${out.audible ? '' : ' (audio starts after you click the page)'}`);
    return { audible: out.audible, durationMs: Math.round(out.durationMs), label };
  }

  /* Every variant in turn, each announced, until done, stopped or
   * replaced by another playback. */
  async playVariants({ gapMs = 250 } = {}) {
    this.#require();
    const count = this.design.variation.count, played = [];
    for (let v = 0; v < count; v++) {
      const p = await this.play('design', { variant: v });
      const token = this.playToken;
      played.push(p.label);
      await this.sleep(p.durationMs + gapMs);
      if (this.playToken !== token) return { played, interrupted: true };
    }
    return { played, interrupted: false };
  }

  setRange(range) {
    if (!range) { this.range = null; this.hooks.changed('range'); return null; }
    const s = this.session;
    let from = Math.round(Math.min(range.from, range.to)), to = Math.round(Math.max(range.from, range.to));
    from = Math.max(s.firstFrame, from); to = Math.min(s.lastFrame, Math.max(to, from + 1));
    this.range = { from, to };
    this.hooks.changed('range');
    return this.range;
  }

  drafts() {
    const out = {};
    for (const id of this.store.designedEvents()) out[id] = this.store.design(id);
    if (this.design) out[this.design.eventId] = this.design;
    return out;
  }

  /* Build (and optionally play) a stretch of the recording. mode 'candidate'
   * swaps `designs` in, 'original' plays the game sounds, 'solo' only the
   * designs. The game view follows the audio frame by frame. Each voice
   * keeps its timeline lane, so mute/solo and volume change while playing.
   * Playback ends at `to`; it repeats while looping is on (the `loop`
   * argument, or the live setLoop state). */
  async playRange({ from, to, mode = 'candidate', designs = null, play = true, label = null, loop = false } = {}) {
    const s = this.session;
    if (!s.length) throw new Error('Nothing recorded yet');
    const range = { from: from ?? this.range?.from ?? s.firstFrame, to: to ?? this.range?.to ?? s.lastFrame };
    range.to = Math.min(range.to, range.from + MAX_PLAY_FRAMES);
    const set = designs ?? (this.design ? { [this.design.eventId]: this.design } : {});
    await this.library.load(contextSources(s, { from: range.from, to: range.to, designs: set, library: this.library }));
    const scene = buildScene(s, { from: range.from, to: range.to, designs: set, mode, library: this.library, environmentFor: o => this.library.environmentFor(s.inspect(o)?.room) });
    const out = { mode, from: scene.from, to: scene.to, durationMs: Math.round(scene.durationMs), heard: sceneHeard(scene, this.lanes) };
    if (!play) return out;
    const frameMs = 1000 / FRAME_HZ;
    const info = { kind: 'range', mode, from: scene.from, to: scene.to, label: label || (mode === 'original' ? 'Game sounds' : mode === 'solo' ? 'Designs only' : 'With designs') };
    const onProgress = ms => { const f = scene.from + Math.floor(ms / frameMs); if (f <= scene.to) this.hooks.showFrame(f); };
    /* bounded, so a silent player cannot spin */
    const start = async (round = 0) => {
      const p = await this.#play(null, { ...info, round }, { onProgress, scene });
      p.ended.then(() => { if (this.playToken === p.token && (loop || this.loop) && round < LOOP_LIMIT) start(round + 1); });
      return p;
    };
    const p = await start();
    out.audible = p.audible;
    out.loop = !!(loop || this.loop);
    this.hooks.status(`${info.label} · ${((scene.to - scene.from + 1) / FRAME_HZ).toFixed(1)} s from frame ${scene.from}`);
    return out;
  }

  /* Lane gains for a scene from the mute/solo state. */
  #laneGains(scene) {
    const gains = {};
    for (const v of scene.voices) gains[v.lane] = laneAudible(v.lane, this.lanes) ? 1 : 0;
    return gains;
  }

  setLoop(on) { this.loop = !!on; this.hooks.changed('loop'); return this.loop; }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, Number(v) || 0));
    this.player.setVolume?.(this.volume);
    this.hooks.changed('volume');
    return this.volume;
  }

  /* In-context audition of the open design around its target and range. */
  async playInContext({ mode = 'candidate', target = this.target, design = this.design, play = true, range = null } = {}) {
    if (!target && !range && !this.range) throw new Error('Record an occurrence of this event first, or pick a range on the timeline');
    const r = range || (target && target !== this.target ? contextRange(this.session, target) : this.range) || contextRange(this.session, target);
    return this.playRange({ ...r, mode, designs: design ? { [design.eventId]: design } : {}, play, label: mode === 'original' ? 'Game sound in context' : 'Design in context' });
  }

  toggleLane(key, kind) {
    const set = kind === 'solo' ? this.lanes.soloed : this.lanes.muted;
    if (set.has(key)) set.delete(key); else set.add(key);
    /* applies to what is playing now, not only the next playback */
    if (this.playback?.scene) this.player.setLaneGains?.(this.#laneGains(this.playback.scene));
    this.hooks.changed('lanes');
    return this.laneState();
  }
  laneState() { return { muted: [...this.lanes.muted], soloed: [...this.lanes.soloed] }; }
  laneKeyOf(occurrence) { return laneKey(occurrence?.source); }

  /* ---------- Foley ---------- */

  resetFoley() {
    const rounds = this.foley?.eventId === this.eventId ? this.foley.rounds || [] : [];
    this.foley = { rounds, recipe: null, description: '', terms: [], reference: this.foley?.reference || null, referenceWeight: this.foley?.referenceWeight ?? 0.7, allowModelChange: !!this.foley?.allowModelChange, spread: this.foley?.spread ?? 0.15, stage: 'move', takes: [], fit: null, scene: null, eventId: this.eventId };
  }

  /* What the recording says about the target, as facts and a starting recipe. */
  foleyScene() {
    this.#require();
    const inspect = this.inspectTarget();
    const s = this.session;
    const span = this.target && s.spans.find(x => x.id === this.target)
      || (inspect?.activeSpans?.length ? s.spans.find(x => x.id === inspect.activeSpans[0].id) : null);
    /* a staged design is produced stage by stage: the stage's own event sets the starting recipe */
    const grp = this.stagedGroup(), stage = grp ? grp.stages.find(x => x.id === this.foley.stage) : null;
    const eventId = stage && stage.id !== 'move' ? stage.events[0] || this.eventId : this.eventId;
    const scene = sceneProfile({ eventId, inspect, span, environments: this.library.environments?.() });
    const motion = this.motionForTarget() || scene.motion;
    if (stage) scene.foley.followMotion = stage.id === 'move';
    if (stage) scene.facts.unshift(['Stage', `${stage.label} (${stage.id})`]);
    this.foley.scene = { facts: scene.facts, motion, recipe: scene.foley, target: this.target, stage: stage?.id || null };
    if (!this.foley.recipe) this.foley.recipe = scene.foley;
    return { facts: scene.facts, recipe: scene.foley, stage: stage?.id || null, motionFrames: motion?.length || 0, motion: motion ? motion.slice(0, 400) : null };
  }

  /* Which stage of a staged design the Foley tab produces ('start' | 'move' | 'stop'). */
  setFoleyStage(stage) {
    if (!STAGE_SEGMENT[stage]) throw new Error(`Stage must be one of ${Object.keys(STAGE_SEGMENT).join(', ')}`);
    if (!this.stagedGroup()) throw new Error('This event has no stages (open a group such as the boulder or the moving platform)');
    this.foley.stage = stage;
    this.foley.recipe = null; this.foley.takes = []; this.foley.fit = null; this.foley.scene = null;
    this.foleyScene();
    this.hooks.changed('foley');
    return { stage, recipe: { ...this.foley.recipe } };
  }

  setTakeSpread(v) { this.foley.spread = Math.max(0, Math.min(1, Number(v) || 0)); this.hooks.changed('foley'); return this.foley.spread; }

  /* Continuous models follow the recorded movement whenever there is one. */
  #followIfMoving(recipe, explicit = false) {
    if (!explicit && FOLEY_MODELS[recipe.model]?.continuous && this.foley.scene?.motion?.length > 1 && this.foley.scene.stage !== 'start' && this.foley.scene.stage !== 'stop') recipe.followMotion = true;
    return recipe;
  }

  #ensureFoley() {
    this.#require();
    if (!this.foley.scene) this.foleyScene();
    return this.foley;
  }

  setFoley(patch = {}) {
    const f = this.#ensureFoley();
    const r = normalizeFoley(patch, f.recipe);
    f.recipe = 'model' in patch ? this.#followIfMoving(r.foley, 'followMotion' in patch) : r.foley;
    this.hooks.changed('foley');
    return { recipe: { ...f.recipe }, report: r.report };
  }

  /* Read a plain-language description into the recipe (on top of the scene). */
  describeFoley(text, { fromScene = true } = {}) {
    const f = this.#ensureFoley();
    const parsed = parseDescription(text);
    f.description = String(text);
    f.terms = parsed.terms;
    f.recipe = this.#followIfMoving(applyDescription(fromScene ? f.scene.recipe : f.recipe, parsed));
    this.hooks.changed('foley');
    return { recipe: { ...f.recipe }, understood: parsed.terms, model: f.recipe.model };
  }

  useSceneRecipe() {
    const f = this.#ensureFoley();
    f.recipe = { ...f.scene.recipe };
    f.description = ''; f.terms = [];
    this.hooks.changed('foley');
    return { ...f.recipe };
  }

  /* Reference: a library sample, the game sound of an occurrence, or
   * decoded/encoded WAV data (an upload). */
  async setReference({ source = null, occurrenceId = null, wav = null, decoded = null, label = null } = {}) {
    let data = decoded, name = label;
    if (wav) { data = decodeWav(wav); name ||= 'uploaded reference'; }
    else if (occurrenceId || source) {
      const src = source || originalSourceFor(this.session.occurrence(occurrenceId) || {}, this.library);
      if (!src) throw new Error('That occurrence has no game sound to use as a reference');
      await this.library.load([src]);
      data = this.library.samples.get(sampleKey(src));
      if (!data) throw new Error(`Could not load ${src.name}`);
      name ||= `${src.type} · ${src.name}`;
    }
    if (!data?.data?.length) throw new Error('Reference has no audio');
    const buf = { left: data.data, right: data.data, sampleRate: data.sampleRate };
    const features = referenceFeatures(buf);
    if (features.silent) throw new Error('Reference is silent');
    this.foley.reference = { label: name || 'reference', buffer: buf, features, analysis: analyze(buf) };
    for (const t of this.foley.takes) Object.assign(t, this.#match(t.buffer));
    this.hooks.changed('foley');
    return { label: this.foley.reference.label, features: { ...features, envelope: undefined, spectrum: undefined } };
  }

  clearReference() { this.foley.reference = null; this.hooks.changed('foley'); }

  setAllowModelChange(on) { this.foley.allowModelChange = !!on; this.hooks.changed('foley'); return this.foley.allowModelChange; }

  setReferenceWeight(w) { this.foley.referenceWeight = Math.max(0, Math.min(1, Number(w) || 0)); this.hooks.changed('foley'); return this.foley.referenceWeight; }

  #match(buf) {
    const ref = this.foley.reference?.features;
    if (!ref) return { match: null, distance: null };
    const d = matchDistance(referenceFeatures(buf), ref);
    return { match: matchScore(d.total), distance: d.total, parts: d.parts };
  }

  /* Move the recipe toward the reference (balanced against the scene by
   * referenceWeight). */
  async fitReference({ iterations = 48, referenceWeight = this.foley.referenceWeight, lock = [], allowModelChange = this.foley.allowModelChange, onProgress = null } = {}) {
    const f = this.#ensureFoley();
    if (!f.reference) throw new Error('Set a reference sound first');
    if (!allowModelChange) lock = [...new Set([...lock, 'model', 'material'])];
    const before = matchScore(matchDistance(referenceFeatures(bufOf(renderFoley(f.recipe, { sr: 22050, motion: f.scene.motion }), 22050)), f.reference.features).total);
    const result = await fitToReference(f.recipe, f.reference.features, { iterations, referenceWeight, motion: f.scene.motion, lock, onProgress: p => { onProgress?.(p); this.hooks.status(`Matching reference · ${p.iteration}/${p.of} · ${Math.round(p.score * 100)}%`); } });
    f.recipe = result.foley;
    f.fit = { before, after: result.score, evaluations: result.evaluations, referenceWeight, allowModelChange: !!allowModelChange };
    this.hooks.changed('foley');
    return { recipe: { ...f.recipe }, matchBefore: before, matchAfter: result.score, evaluations: result.evaluations, model: f.recipe.model, material: f.recipe.material, eq: f.recipe.eq || null };
  }

  /* Takes around the current recipe; ranked by match when a reference is set. */
  generateTakes({ count = 4, spread = this.foley.spread, seed = null } = {}) {
    const f = this.#ensureFoley();
    const takes = generateTakes(f.recipe, { count, spread, seed: seed ?? (f.recipe.seed + f.takes.length * 31), motion: f.scene.motion, reference: f.reference?.features || null });
    f.takes = takes.map((t, i) => ({ id: `t${i + 1}`, source: 'foley', foley: t.foley, buffer: t.buffer, match: t.match ?? null, distance: t.distance ?? null, parts: t.parts, analysis: summarize(analyze(t.buffer)) }));
    this.#recordRound('foley', { spread });
    this.hooks.changed('foley');
    return this.takesView();
  }

  /* ---------- Earshot (through the authoring service) ---------- */

  earshotStatus() { return this.earshot ? this.earshot.status() : { connected: false, available: false, reason: 'Open the Studio from the SoundLab authoring service (npm run soundlab:serve) to use Earshot' }; }

  /* How long Earshot takes should be: enough for the bites or the loop of a
   * staged movement, the recorded movement, or the recipe's length. */
  earshotLength() {
    const f = this.#ensureFoley(), grp = this.stagedGroup();
    if (grp && f.stage === 'move') {
      const m = movementOf(this.design), ref = m.refSpeed || typicalSpeed((f.scene.motion || []).map(Math.abs));
      if (m.method === 'bites') return (m.bitePx / ref * 1000 + m.xfadeMs) * m.variants + 320;
      if (m.method === 'loop') return m.loopMs + m.xfadeMs + 360;
      return (f.scene.motion?.length || 25) * 1000 / FRAME_HZ;
    }
    return f.recipe.durationMs;
  }

  /* Four Earshot takes for the open event, or a refinement of an Earshot
   * take of the last round in a direction. They are measured and matched to
   * the reference like Foley takes; nothing here judges which is better. */
  async earshotRound({ direction = 'variation', parent = null, durationMs = null, seed = null } = {}) {
    const f = this.#ensureFoley();
    if (!this.earshot?.available) throw new Error(this.earshotStatus().reason || 'Earshot is not available');
    if (!EARSHOT_DIRECTIONS[direction]) throw new Error(`Direction must be one of ${Object.keys(EARSHOT_DIRECTIONS).join(', ')}`);
    let parentId = null;
    if (parent) { const t = this.#take(parent); if (t.source !== 'earshot') throw new Error('Only an Earshot take can be refined by Earshot'); parentId = t.earshotId; }
    const ms = Math.round(Math.max(40, Math.min(2000, durationMs ?? this.earshotLength())));
    const rows = await this.earshot.round({ eventId: this.eventId, durationMs: ms, seed: seed ?? 13 + f.rounds.length * 7, direction, parentId });
    let takes = rows.map((row, i) => {
      const mono = row.sample.sampleRate === RENDER_RATE ? row.sample : { data: sampleClip(row.sample, { sr: RENDER_RATE, gain: Math.SQRT1_2 }).left, sampleRate: RENDER_RATE };
      const buffer = { left: mono.data, right: mono.data, sampleRate: RENDER_RATE };
      return { id: `e${i + 1}`, source: 'earshot', earshotId: row.id, label: row.label, earshot: row.recipe, metrics: row.metrics, sha256: row.sha256, sample: mono, buffer, analysis: summarize(analyze(buffer)), ...this.#matchRef(buffer) };
    });
    if (f.reference) takes = takes.sort((a, b) => a.distance - b.distance);
    f.takes = takes;
    this.#recordRound('earshot', { direction, parent, durationMs: ms, warnings: rows.reduce((n, r) => n + (r.metrics?.warnings?.length || 0), 0) });
    this.hooks.changed('foley');
    return this.takesView();
  }

  #matchRef(buffer) {
    const ref = this.foley.reference?.features;
    if (!ref || ref.silent) return { match: null, distance: null };
    const d = matchDistance(referenceFeatures(buffer), ref);
    return { match: matchScore(d.total), distance: d.total, parts: d.parts };
  }

  /* Each round of takes, measured: the best match to the reference (when one
   * is set), and the takes' mean loudness, brightness and length. A trend to
   * read, not a verdict. */
  #recordRound(source, extra = {}) {
    const f = this.foley, takes = f.takes;
    const mean = k => { const v = takes.map(t => t.analysis?.[k]).filter(Number.isFinite); return v.length ? Math.round(v.reduce((a, x) => a + x, 0) / v.length * 10) / 10 : null; };
    const matched = takes.filter(t => t.match != null);
    const best = matched.length ? matched.reduce((a, t) => (t.match > a.match ? t : a)) : null;
    f.rounds.push({ n: (f.rounds.at(-1)?.n || 0) + 1, source, stage: this.stagedGroup() ? f.stage : null, at: this.now().toISOString(), takes: takes.length, bestMatch: best ? best.match : null, bestTake: best?.id || null, reference: f.reference?.label || null, loudestDb: mean('loudestDb'), centroidHz: mean('centroidHz'), durationMs: mean('durationMs'), ...extra });
    if (f.rounds.length > 50) f.rounds.shift();
  }

  foleyRounds() { return this.foley.rounds.map(r => ({ ...r })); }

  /* Generated audio (Earshot takes) used in a design is kept in the browser
   * so drafts still play after a reload. */
  #keepTakeAudio(name, mono) {
    this.library.samples.set(sampleKey({ type: 'take', name }), mono);
    try {
      const st = this.store.storage, all = JSON.parse(st.getItem(TAKE_AUDIO_KEY) || '{}');
      all[name] = { sampleRate: mono.sampleRate, pcm: pcm16Base64(mono.data), at: this.now().toISOString() };
      let names = Object.keys(all).sort((a, b) => all[a].at.localeCompare(all[b].at));
      while (names.length > 1 && JSON.stringify(all).length > TAKE_AUDIO_LIMIT) delete all[names.shift()];
      st.setItem(TAKE_AUDIO_KEY, JSON.stringify(all));
    } catch { /* quota or private mode: kept for this session only */ }
  }

  #restoreTakeAudio(source) {
    try {
      const row = JSON.parse(this.store.storage.getItem(TAKE_AUDIO_KEY) || '{}')[source.name];
      if (row) this.library.samples.set(sampleKey(source), { sampleRate: row.sampleRate, data: pcm16FromBase64(row.pcm) });
    } catch { /* unreadable: reported as missing */ }
  }

  takesView() {
    return this.foley.takes.map(t => (t.source === 'earshot'
      ? { id: t.id, source: 'earshot', label: t.label, match: t.match, analysis: t.analysis, earshot: { ...t.earshot }, metrics: t.metrics }
      : { id: t.id, source: 'foley', match: t.match, analysis: t.analysis, recipe: { ...t.foley } }));
  }

  #take(id) {
    const t = this.foley.takes.find(x => x.id === id);
    if (!t) throw new Error(`Unknown take ${id}`);
    return t;
  }

  async playTake(id) {
    const t = this.#take(id);
    const out = await this.#play(t.buffer, { kind: 'take', take: id, label: `Foley take ${id}` });
    return { audible: out.audible, durationMs: Math.round(out.durationMs) };
  }

  async playReference() {
    if (!this.foley.reference) throw new Error('No reference set');
    const out = await this.#play(this.foley.reference.buffer, { kind: 'reference', label: `Reference · ${this.foley.reference.label}` });
    return { audible: out.audible, durationMs: Math.round(out.durationMs) };
  }

  #takePatch(id, mode, stage = null) {
    this.#require();
    const t = this.#take(id);
    const grp = this.stagedGroup();
    if (t.source === 'earshot') {
      /* an Earshot take becomes a sample layer of audio kept in the browser */
      const source = { type: 'take', name: `earshot-${t.sha256.slice(0, 12)}` };
      if (!this.library.samples.has(sampleKey(source))) this.#keepTakeAudio(source.name, t.sample);
      const segment = grp ? STAGE_SEGMENT[stage || this.foley.stage] : undefined;
      const others = this.design.layers.filter(l => l.enabled && (!grp || l.segment === segment));
      const addLayer = { kind: 'sample', source, ...(segment ? { segment } : {}) };
      return { patch: mode === 'add' ? { addLayer } : { addLayer, layers: others.map(l => ({ id: l.id, enabled: false })) }, foley: null };
    }
    const foley = { ...t.foley };
    if (grp) {
      /* staged design: the take goes into the Foley tab's stage; other stages are untouched */
      const segment = STAGE_SEGMENT[stage || this.foley.stage];
      const inStage = this.design.layers.filter(l => l.segment === segment);
      const existing = inStage.find(l => l.kind === 'foley');
      if (mode === 'add') return { patch: { addLayer: { kind: 'foley', foley, segment } }, foley };
      if (existing) return { patch: { layers: [{ id: existing.id, foley, enabled: true }, ...inStage.filter(l => l !== existing && l.enabled).map(l => ({ id: l.id, enabled: false }))] }, foley };
      return { patch: { addLayer: { kind: 'foley', foley, segment }, layers: inStage.filter(l => l.enabled).map(l => ({ id: l.id, enabled: false })) }, foley };
    }
    const existing = this.design.layers.find(l => l.kind === 'foley');
    let patch;
    if (mode === 'replace' && existing) patch = { layers: [{ id: existing.id, foley, enabled: true }] };
    else {
      patch = { addLayer: { kind: 'foley', foley } };
      if (mode === 'replace') patch.layers = this.design.layers.filter(l => l.enabled).map(l => ({ id: l.id, enabled: false }));
    }
    if (FOLEY_MODELS[foley.model]?.continuous && CATALOG_BY_ID[this.eventId]?.status === 'needs-hook' && this.design.container.mode !== 'loop') patch.container = { mode: 'loop' };
    return { patch, foley };
  }

  /* The design as it would be with a take, without saving it. */
  takeDesign(id, mode = 'replace', stage = null) { return patchDesign(this.design, this.#takePatch(id, mode, stage).patch).design; }

  async playTakeInContext(id, { mode = 'replace', stage = null, play = true } = {}) {
    return this.playInContext({ design: this.takeDesign(id, mode, stage), play });
  }

  /* Put a take into the design as a foley layer. 'replace' swaps the first
   * foley layer (or adds one and mutes the other layers), 'add' layers it in. */
  useTake(id, { mode = 'replace', stage = null, by = 'human' } = {}) {
    const { patch, foley } = this.#takePatch(id, mode, stage);
    if (foley) this.foley.recipe = foley;
    return this.patch(null, patch, { by });
  }

  /* ---------- review ---------- */

  async submit({ name = '', rationale = '', by = 'human' } = {}) {
    this.#require();
    const r = await this.renderCandidate();
    const c = this.store.submit({ design: this.design, name: name || candidateName(this.eventId, this.now()), occurrenceId: this.target, context: r.context, analysis: summarize(r.analysis), comparison: r.comparison, rationale, by });
    this.hooks.changed('review');
    this.hooks.status(`Submitted “${c.name}” for review`);
    return this.store.get(c.id);
  }

  async playCandidate(id, mode = 'candidate') {
    const c = this.store.get(id);
    if (!c) throw new Error(`Unknown candidate ${id}`);
    const target = this.targetValid(c.occurrenceId) ? c.occurrenceId : this.defaultTarget(c.eventId);
    if (!target) {
      await this.#loadDesignSamples(c.design);
      const r = renderEvent(c.design, { samples: this.library.samples });
      const out = await this.#play(r, { kind: 'candidate', label: c.name });
      return { audible: out.audible, durationMs: Math.round(out.durationMs), inContext: false };
    }
    return this.playRange({ ...contextRange(this.session, target), mode, designs: { [c.eventId]: c.design }, label: `${c.name} · ${mode === 'original' ? 'game sound' : 'design'} in context` });
  }

  recordVerdict(id, verdict, opts = {}) {
    const view = this.store.review(id, { ...opts, verdict });
    this.hooks.changed('review');
    return view;
  }

  /* Load a submitted version back into the designer as the draft. */
  openCandidate(id) {
    const c = this.store.get(id);
    if (!c) throw new Error(`Unknown candidate ${id}`);
    this.store.saveDesign(c.design);
    this.eventId = null;
    return this.open(c.eventId, { target: this.targetValid(c.occurrenceId) ? c.occurrenceId : undefined });
  }

  renameCandidate(id, name) { const v = this.store.rename(id, name); this.hooks.changed('review'); return v; }

  exportBundle() { return this.store.exportBundle(); }

  async wavFor(design = this.design, variant = 0) {
    await this.#loadDesignSamples(design);
    const inspect = this.inspectTarget();
    const r = renderEvent(design, { inspect, variant, samples: this.library.samples, environment: this.environmentFor(inspect), motion: this.motionForTarget() });
    return encodeWav(r);
  }

  /* ---------- emitters ---------- */

  async emitters(eventId = this.eventId) {
    if (!hasEmitters(eventId)) return [];
    const rooms = await this.library.levelRooms?.() || [];
    return emitterLocations(eventId, { rooms, session: this.session });
  }
}

function bufOf(data, sr) { return { left: data, right: data, sampleRate: sr }; }
function wait(ms) { return new Promise(res => setTimeout(res, Math.max(0, ms))); }

const toBase64 = bytes => (typeof Buffer !== 'undefined' ? Buffer.from(bytes).toString('base64') : btoa(Array.from(bytes, b => String.fromCharCode(b)).join('')));
const fromBase64 = text => (typeof Buffer !== 'undefined' ? new Uint8Array(Buffer.from(text, 'base64')) : Uint8Array.from(atob(text), c => c.charCodeAt(0)));
function pcm16Base64(data) {
  const pcm = new Int16Array(data.length);
  for (let i = 0; i < data.length; i++) pcm[i] = Math.round(Math.max(-1, Math.min(1, data[i])) * 32767);
  return toBase64(new Uint8Array(pcm.buffer));
}
function pcm16FromBase64(text) {
  const bytes = fromBase64(text), pcm = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1);
  return Float32Array.from(pcm, v => v / 32767);
}
function roomId(submap) { return `SM${Number(submap).toString(16).toUpperCase().padStart(2, '0')}`; }
