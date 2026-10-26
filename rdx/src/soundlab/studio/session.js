/* SoundLab Studio session model.
 *
 * A session is what the tool recorded while native gameplay advanced one
 * authoritative 25 Hz frame at a time: per-frame actor state, the native SFX
 * requests (with source actor attribution from the C ring), the SoundLab
 * semantic observations, and the control mask that produced the frame. All
 * analysis below is derived from those records; nothing here simulates
 * gameplay. Pure module: no DOM, so it runs under node --test. */

import { CATALOG, CATALOG_BY_ID, RICK_SLOT, classifySemantic, classifySound, entityTypeInfo, sfxName } from './catalog.js';

export const SESSION_SCHEMA = 'soundlab.studio-session.v1';
export const FRAME_HZ = 25;
export const REGIONS = Object.freeze(['south-america', 'egypt', 'castle', 'missile-base']);
export const PLATFORM_STATES = Object.freeze(['none', 'waiting', 'moving', 'released']);
const CONTEXT_FRAMES = 12; /* 480 ms either side counts as "playing nearby". */

function round(n, places = 2) { const m = 10 ** places; return Math.round(Number(n) * m) / m; }

/* Compact, JSON-safe frame record from a bridge snapshot. `bounds` maps slot
 * -> presentation-space rectangle (the tool's view of where the actor is
 * drawn); sounds/cues are the rows the bridge returned for this frame. */
export function frameRecord({ snapshot, mask = 0, sounds = [], cues = [], bounds = new Map() }) {
  const ents = [];
  for (const e of snapshot?.entities || []) {
    const n = Number(e.n) >>> 0;
    if (!n || n === 0xff) continue;
    const b = bounds.get(Number(e.slot));
    ents.push({
      slot: Number(e.slot), type: n & 0x7f, mark: Number(e.mark),
      x: (Number(e.x) << 16) >> 16, y: Number(e.y), w: Number(e.w), h: Number(e.h),
      mps: Number(e.movingPlatformState || 0),
      b: b ? [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)] : null
    });
  }
  return {
    frame: Number(snapshot?.frameSerial ?? -1),
    submap: Number(snapshot?.submap ?? -1),
    map: Number(snapshot?.map ?? -1),
    mask: Number(mask) >>> 0,
    rickState: Number(snapshot?.rick?.state ?? 0),
    ents,
    sounds: sounds.map(s => ({
      serial: s.serial, logicalId: s.logicalId, name: sfxName(s.logicalId), screenX: s.screenX,
      suppressed: !!s.suppressed, source: s.source ? { ...s.source } : null
    })),
    cues: cues.map(c => ({ ...c }))
  };
}

export class StudioSession {
  constructor({ start = {}, frames = [] } = {}) {
    this.start = { submap: 0, presentation: 'rdx', ...start };
    this.frames = [];
    this.byFrame = new Map();
    this.occurrences = [];
    this.spans = [];
    this.openSpans = new Map();
    for (const f of frames) this.add(f);
  }

  get firstFrame() { return this.frames[0]?.frame ?? 0; }
  get lastFrame() { return this.frames.at(-1)?.frame ?? 0; }
  get length() { return this.frames.length; }
  frameAt(frame) { return this.byFrame.get(Number(frame)) || null; }
  indexOf(frame) { const r = this.byFrame.get(Number(frame)); return r ? r._i : -1; }

  /* Nearest recorded frame at or before `frame`. */
  nearest(frame) {
    const f = Number(frame);
    if (this.byFrame.has(f)) return this.byFrame.get(f);
    let lo = 0, hi = this.frames.length - 1, best = this.frames[0] || null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.frames[mid].frame <= f) { best = this.frames[mid]; lo = mid + 1; } else hi = mid - 1;
    }
    return best;
  }

  add(record) {
    if (!record || !Number.isFinite(record.frame)) return;
    const prev = this.frames.at(-1);
    if (prev && record.frame <= prev.frame) return; /* frames are append-only */
    Object.defineProperty(record, '_i', { value: this.frames.length, enumerable: false, writable: true });
    this.frames.push(record);
    this.byFrame.set(record.frame, record);
    for (const s of record.sounds) {
      const eventId = classifySound(s);
      this.occurrences.push({
        id: `${record.frame}:s${s.serial}`, frame: record.frame, kind: 'sound', eventId, name: s.name,
        source: s.source && s.source.type ? { slot: s.source.slot, type: s.source.type, mark: s.source.mark } : null,
        screenX: s.screenX, suppressed: s.suppressed, submap: record.submap
      });
    }
    const heard = new Set(record.sounds.map(classifySound));
    for (const c of record.cues) {
      const eventId = classifySemantic(c.name);
      /* A SoundLab cue on the same frame as the native sound for the same
       * event is context for that sound, not a second occurrence. */
      this.occurrences.push({
        id: `${record.frame}:c${c.serial}`, frame: record.frame, kind: 'cue', eventId, name: c.name, paired: heard.has(eventId),
        source: { slot: c.slot, type: (record.ents.find(e => e.slot === c.slot) || prev?.ents.find(e => e.slot === c.slot))?.type ?? null, mark: c.mark },
        screenX: c.screenX, submap: record.submap, cue: c
      });
    }
    this.#trackSpans(prev, record);
  }

  /* Continuous context the game has no sound for yet: platform state runs
   * and actor motion runs (boulder rolling, barrels, projectiles). */
  #trackSpans(prev, record) {
    const seen = new Set();
    const roomChanged = prev && prev.submap !== record.submap;
    for (const e of record.ents) {
      if (e.slot === RICK_SLOT) continue;
      const before = !roomChanged && prev ? prev.ents.find(p => p.slot === e.slot && p.type === e.type && p.mark === e.mark) : null;
      if (e.mps) {
        const key = `p:${e.slot}:${e.mark}`; seen.add(key);
        const was = before?.mps || 0;
        if (was !== e.mps) {
          this.#closeSpan(key, prev?.frame ?? record.frame);
          const transition = was === 1 && e.mps === 2 ? 'start' : was === 2 && e.mps === 1 ? 'stop' : e.mps === 3 ? 'release' : null;
          if (transition && before) {
            const planned = CATALOG.find(c => c.platformTransition === transition);
            this.occurrences.push({
              id: `${record.frame}:t${e.slot}`, frame: record.frame, kind: 'state', eventId: planned?.id || null,
              name: `platform ${transition}`, source: { slot: e.slot, type: e.type, mark: e.mark }, submap: record.submap
            });
          }
          if (e.mps === 2 || e.mps === 3)
            this.#openSpan(key, { kind: 'platform', state: PLATFORM_STATES[e.mps], source: { slot: e.slot, type: e.type, mark: e.mark }, frame: record.frame, submap: record.submap });
        }
      }
      /* Motion runs only for scripted trap actors: walking enemies move all
       * the time and are already heard through their own events. */
      if (e.mps || e.type < 0x18 || e.type === 0x47) continue;
      const dx = before ? e.x - before.x : 0, dy = before ? e.y - before.y : 0;
      const key = `m:${e.slot}:${e.type}:${e.mark}`;
      if (dx || dy) {
        seen.add(key);
        const span = this.openSpans.get(key) || this.#openSpan(key, { kind: 'motion', source: { slot: e.slot, type: e.type, mark: e.mark }, frame: prev.frame, submap: record.submap });
        span.speed.push([record.frame, round(Math.hypot(dx, dy) * FRAME_HZ, 1)]);
      }
    }
    for (const [key] of this.openSpans) if (!seen.has(key)) this.#closeSpan(key, prev?.frame ?? record.frame);
    for (const span of this.openSpans.values()) span.end = record.frame;
  }

  #openSpan(key, { kind, state = null, source, frame, submap }) {
    const span = { id: `${kind}:${source.slot}:${frame}`, kind, state, source, start: frame, end: frame, submap, speed: [], label: spanLabel(kind, state, source) };
    this.openSpans.set(key, span); this.spans.push(span);
    return span;
  }

  #closeSpan(key, frame) {
    const span = this.openSpans.get(key);
    if (!span) return;
    span.end = Math.max(span.start, frame);
    this.openSpans.delete(key);
  }

  occurrencesOf(eventId, { submap = null, limit = 0 } = {}) {
    const rows = this.occurrences.filter(o => o.eventId === eventId && !o.paired && (submap == null || o.submap === Number(submap)));
    return limit ? rows.slice(0, limit) : rows;
  }

  occurrencesBetween(from, to) {
    return this.occurrences.filter(o => o.frame >= from && o.frame <= to);
  }

  occurrence(id) { return this.occurrences.find(o => o.id === id) || null; }

  /* Per-event counts and rooms for the catalog rail. */
  coverage() {
    const out = {};
    for (const e of CATALOG) out[e.id] = { count: 0, rooms: new Set() };
    for (const o of this.occurrences) {
      if (!o.eventId || o.paired || !out[o.eventId]) continue;
      out[o.eventId].count += 1; out[o.eventId].rooms.add(o.submap);
    }
    return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { count: v.count, rooms: [...v.rooms].sort((a, b) => a - b) }]));
  }

  /* Sound sources become timeline lanes: Rick first, then each actor in the
   * order it was first heard or seen moving. */
  lanes() {
    const lanes = new Map();
    const touch = (source, label) => {
      const key = laneKey(source);
      if (!lanes.has(key)) lanes.set(key, { key, label: label || laneLabel(source), occurrences: [], spans: [] });
      return lanes.get(key);
    };
    touch({ slot: RICK_SLOT }, 'Rick');
    for (const o of this.occurrences) touch(o.source).occurrences.push(o);
    for (const s of this.spans) touch(s.source).spans.push(s);
    return [...lanes.values()];
  }

  /* Everything known about one occurrence: the inspector's data and the
   * context an agent maps onto sound parameters. */
  inspect(occurrenceOrId) {
    const o = typeof occurrenceOrId === 'string' ? this.occurrence(occurrenceOrId) : occurrenceOrId;
    if (!o) return null;
    const record = this.frameAt(o.frame);
    const catalog = o.eventId ? CATALOG_BY_ID[o.eventId] : null;
    const slot = o.source?.slot;
    const actor = slot != null ? this.actorMotion(slot, o.frame, o.source) : null;
    const rick = this.actorMotion(RICK_SLOT, o.frame, { slot: RICK_SLOT });
    const screenX = Number.isFinite(o.screenX) ? o.screenX : actor?.screen?.x ?? null;
    const nearby = this.occurrencesBetween(o.frame - CONTEXT_FRAMES, o.frame + CONTEXT_FRAMES)
      .filter(row => row.id !== o.id && !row.paired)
      .map(row => ({ id: row.id, name: row.name, eventId: row.eventId, offsetMs: (row.frame - o.frame) * 1000 / FRAME_HZ }));
    const spans = this.spans.filter(s => s.start <= o.frame && s.end >= o.frame && (slot == null || s.source.slot === slot));
    return {
      occurrence: { id: o.id, kind: o.kind, name: o.name, frame: o.frame, timeMs: Math.round((o.frame - this.firstFrame) * 1000 / FRAME_HZ), suppressed: !!o.suppressed },
      event: catalog ? { id: catalog.id, label: catalog.label, family: catalog.family, status: catalog.status } : null,
      source: o.source ? { ...o.source, ...entityTypeInfo(o.source.type ?? (slot === RICK_SLOT ? 1 : 0)) } : null,
      room: record ? { submap: record.submap, id: `SM${record.submap.toString(16).toUpperCase().padStart(2, '0')}`, region: REGIONS[record.map] || null } : null,
      actor,
      listener: rick ? { position: rick.position, distancePx: actor?.position && rick.position ? round(Math.hypot(actor.position.x - rick.position.x, actor.position.y - rick.position.y), 1) : null } : null,
      pan: Number.isFinite(screenX) ? round(Math.max(-1, Math.min(1, (screenX - 160) / 160)), 2) : null,
      platform: actor?.platformState ? { state: actor.platformState } : null,
      activeSpans: spans.map(s => ({ id: s.id, kind: s.kind, label: s.label, start: s.start, end: s.end })),
      nearby,
      input: record ? { mask: record.mask } : null
    };
  }

  /* Velocity/acceleration from consecutive native positions (px per frame
   * converted to px/s at the authoritative 25 Hz cadence). */
  actorMotion(slot, frame, identity = {}) {
    const at = this.frameAt(frame) || this.nearest(frame);
    if (!at) return null;
    const find = rec => rec?.ents.find(e => e.slot === slot && (identity.mark == null || e.mark === identity.mark));
    const cur = find(at);
    if (!cur) return null;
    const i = at._i;
    const p1 = find(this.frames[i - 1]), p2 = find(this.frames[i - 2]);
    const v = p1 ? { x: cur.x - p1.x, y: cur.y - p1.y } : { x: 0, y: 0 };
    const v0 = p1 && p2 ? { x: p1.x - p2.x, y: p1.y - p2.y } : v;
    const speed = Math.hypot(v.x, v.y) * FRAME_HZ;
    return {
      position: { x: cur.x, y: cur.y },
      size: { w: cur.w, h: cur.h },
      screen: cur.b ? { x: (cur.b[0] + cur.b[2]) / 2, y: (cur.b[1] + cur.b[3]) / 2, bounds: cur.b } : null,
      velocity: { x: round(v.x * FRAME_HZ, 1), y: round(v.y * FRAME_HZ, 1) },
      speed: round(speed, 1),
      acceleration: { x: round((v.x - v0.x) * FRAME_HZ * FRAME_HZ, 1), y: round((v.y - v0.y) * FRAME_HZ * FRAME_HZ, 1) },
      direction: speed ? directionName(v) : 'still',
      platformState: cur.mps ? PLATFORM_STATES[cur.mps] : null
    };
  }

  toJSON() {
    return { schema: SESSION_SCHEMA, start: this.start, frames: this.frames };
  }

  static fromJSON(json) {
    if (!json || json.schema !== SESSION_SCHEMA) throw new Error(`Not a ${SESSION_SCHEMA} file`);
    return new StudioSession({ start: json.start, frames: json.frames || [] });
  }
}

/* Timeline lane of a sound source: Rick, one lane per placed actor, or the world. */
export function laneKey(source) {
  return source ? (source.slot === RICK_SLOT ? 'rick' : `${source.type}:${source.mark}`) : 'world';
}

function directionName(v) {
  const h = v.x > 0 ? 'right' : v.x < 0 ? 'left' : '';
  const vert = v.y > 0 ? 'down' : v.y < 0 ? 'up' : '';
  return [vert, h].filter(Boolean).join('-') || 'still';
}

function laneLabel(source) {
  if (!source) return 'World';
  const info = entityTypeInfo(source.type ?? 0);
  return `${info.label}${source.mark != null && source.mark !== 0xffff ? ` #${source.mark}` : ''}`;
}

function spanLabel(kind, state, source) {
  const info = entityTypeInfo(source.type ?? 0);
  return kind === 'platform' ? `Platform ${state}` : `${info.label} moving`;
}
