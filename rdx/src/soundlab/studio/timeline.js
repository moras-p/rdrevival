/* Event timeline: one lane per sound source, markers for one-shot sounds,
 * bars for continuous state (platform runs, trap motion with its speed
 * curve), a mix lane, a playhead, the highlighted listening range (drag its
 * edges to resize, drag in the ruler to draw a new one) and per-lane mute
 * and solo buttons. Canvas rendering; geometry and hit testing are pure
 * functions (tested under node); the owner keeps selection, range and lane
 * state. */

import { FRAME_HZ } from './session.js';

export const LABEL_W = 156;
export const RULER_H = 22;
export const LANE_H = 26;
export const MIX_H = 30;
export const HANDLE_PX = 6;
const BTN = 18;

export const frameToX = (view, width, frame) => LABEL_W + (frame - view.start) * (width - LABEL_W) / view.frames;
export const xToFrame = (view, width, x) => Math.round(view.start + (x - LABEL_W) * view.frames / (width - LABEL_W));

/* Mute and solo buttons in a lane's label cell. */
export function laneButtons(index) {
  const y = RULER_H + index * LANE_H + (LANE_H - BTN) / 2;
  return { mute: { x0: LABEL_W - 2 * BTN - 8, x1: LABEL_W - BTN - 8, y0: y, y1: y + BTN }, solo: { x0: LABEL_W - BTN - 4, x1: LABEL_W - 4, y0: y, y1: y + BTN } };
}

/* What a pointer at (x, y) is over. `hits` are drawn markers and spans. */
export function hitTest({ view, width, lanes = [], range = null, hits = [] }, x, y) {
  const inBox = b => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
  if (x < LABEL_W) {
    const i = Math.floor((y - RULER_H) / LANE_H);
    if (y >= RULER_H && i >= 0 && i < lanes.length) {
      const b = laneButtons(i);
      if (inBox(b.mute)) return { kind: 'mute', lane: lanes[i].key };
      if (inBox(b.solo)) return { kind: 'solo', lane: lanes[i].key };
      return { kind: 'label', lane: lanes[i].key };
    }
    return { kind: 'none' };
  }
  const frame = xToFrame(view, width, x);
  if (range) {
    const xs = frameToX(view, width, range.from), xe = frameToX(view, width, range.to);
    if (Math.abs(x - xs) <= HANDLE_PX) return { kind: 'range-start', frame };
    if (Math.abs(x - xe) <= HANDLE_PX) return { kind: 'range-end', frame };
  }
  if (y < RULER_H) return { kind: 'ruler', frame };
  const hit = hits.filter(inBox).sort((a, b) => (a.kind === 'occurrence' ? -1 : 1) - (b.kind === 'occurrence' ? -1 : 1))[0];
  if (hit) return { kind: hit.kind, id: hit.id, frame };
  return { kind: 'track', frame };
}

/* A range being dragged: which edge moves, the fixed edge, a 1-frame minimum. */
export function dragRange(anchor, frame, bounds) {
  let from = Math.min(anchor, frame), to = Math.max(anchor, frame);
  if (bounds) { from = Math.max(bounds.first, from); to = Math.min(bounds.last, to); }
  if (to <= from) to = from + 1;
  return { from, to };
}

function cssVar(el, name, fallback) {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

export class Timeline {
  constructor(canvas, { onSeek = () => {}, onSelect = () => {}, onRange = () => {}, onLane = () => {}, laneState = () => ({ muted: [], soloed: [] }) } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    Object.assign(this, { onSeek, onSelect, onRange, onLane, laneState });
    this.session = null;
    this.lanes = [];
    this.view = { start: 0, frames: 750 };
    this.follow = true;
    this.playhead = 0;
    this.selectedId = null;
    this.focusEventId = null;
    this.range = null;
    this.hits = [];
    this.drag = null;
    this.width = 600;
    canvas.addEventListener('pointerdown', e => this.#pointerDown(e));
    canvas.addEventListener('pointermove', e => this.#pointerMove(e));
    canvas.addEventListener('pointerup', e => this.#pointerUp(e));
    canvas.addEventListener('wheel', e => this.#wheel(e), { passive: false });
    new ResizeObserver(() => this.render()).observe(canvas.parentElement || canvas);
  }

  setSession(session) { this.session = session; this.follow = true; this.render(); }
  setPlayhead(frame) { this.playhead = frame; this.#keepVisible(); this.render(); }
  setSelected(id) { this.selectedId = id; this.render(); }
  setFocusEvent(eventId) { this.focusEventId = eventId; this.render(); }
  setRange(range) { this.range = range ? { ...range } : null; this.render(); }

  zoom(factor, anchorFrame = this.playhead) {
    const frames = Math.max(50, Math.min(15000, Math.round(this.view.frames * factor)));
    const ratio = (anchorFrame - this.view.start) / this.view.frames;
    this.view.frames = frames;
    this.view.start = Math.round(anchorFrame - ratio * frames);
    this.follow = false;
    this.render();
  }

  showAll() {
    if (!this.session?.length) return;
    this.view.start = this.session.firstFrame;
    this.view.frames = Math.max(50, this.session.lastFrame - this.session.firstFrame + 10);
    this.follow = false;
    this.render();
  }

  /* Bring a frame range into view (keeps the zoom when it fits). */
  reveal(from, to = from) {
    if (from >= this.view.start && to <= this.view.start + this.view.frames) return;
    if (to - from > this.view.frames * 0.9) this.view.frames = Math.round((to - from) * 1.3);
    this.view.start = Math.round((from + to) / 2 - this.view.frames / 2);
    this.follow = false;
    this.render();
  }

  #keepVisible() {
    if (!this.session?.length) return;
    const last = this.session.lastFrame;
    if (this.follow && this.playhead >= last - 1) {
      this.view.start = Math.max(this.session.firstFrame, last - Math.round(this.view.frames * 0.9));
    } else if (this.playhead < this.view.start || this.playhead > this.view.start + this.view.frames) {
      this.view.start = Math.round(this.playhead - this.view.frames * 0.1);
    }
  }

  #x(frame) { return frameToX(this.view, this.width, frame); }

  render() {
    const c = this.canvas, ctx = this.ctx;
    const dpr = globalThis.devicePixelRatio || 1;
    const width = (this.width = c.parentElement?.clientWidth || c.clientWidth || 600);
    this.lanes = this.session ? this.session.lanes() : [];
    const height = RULER_H + this.lanes.length * LANE_H + MIX_H + 6;
    c.style.height = `${height}px`;
    c.width = Math.round(width * dpr); c.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const col = {
      bg: cssVar(c, '--panel', '#14171c'), grid: cssVar(c, '--line', '#262b33'), text: cssVar(c, '--text', '#e7e9ee'),
      quiet: cssVar(c, '--muted', '#8b93a1'), accent: cssVar(c, '--accent', '#f0b443'), span: cssVar(c, '--span', '#4f8fd6'),
      planned: cssVar(c, '--planned', '#b07de0'), sel: cssVar(c, '--select', '#ffffff'), range: cssVar(c, '--range', '#3fb68b'),
      bad: cssVar(c, '--bad', '#e5534b')
    };
    ctx.fillStyle = col.bg; ctx.fillRect(0, 0, width, height);
    this.hits = [];
    if (!this.session || !this.session.length) {
      ctx.fillStyle = col.quiet; ctx.font = '13px system-ui, sans-serif';
      ctx.fillText('Start a session and play: every sound the game makes appears here, one lane per source.', 16, 34);
      return;
    }
    const fps = FRAME_HZ, end = this.view.start + this.view.frames;
    /* listening range */
    if (this.range) {
      const x0 = Math.max(LABEL_W, this.#x(this.range.from)), x1 = Math.min(width, this.#x(this.range.to));
      if (x1 > LABEL_W && x0 < width) {
        ctx.fillStyle = col.range; ctx.globalAlpha = 0.12; ctx.fillRect(x0, 0, x1 - x0, height); ctx.globalAlpha = 0.5; ctx.fillRect(x0, 0, x1 - x0, RULER_H); ctx.globalAlpha = 1;
        ctx.fillStyle = col.range;
        for (const f of [this.range.from, this.range.to]) {
          const x = this.#x(f); if (x < LABEL_W || x > width) continue;
          ctx.fillRect(x - 1.5, 0, 3, height); ctx.fillRect(x - 4, 2, 8, RULER_H - 4);
        }
      }
    }
    /* ruler: a tick every second, labels every 5 s (or wider when zoomed out) */
    const step = this.view.frames > 3000 ? fps * 30 : this.view.frames > 1000 ? fps * 10 : fps * 5;
    ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'middle';
    const first = this.session.firstFrame;
    for (let f = Math.ceil((this.view.start - first) / fps) * fps + first; f <= end; f += fps) {
      const x = this.#x(f); if (x < LABEL_W) continue;
      const major = (f - first) % step === 0;
      ctx.strokeStyle = col.grid; ctx.globalAlpha = major ? 1 : 0.5;
      ctx.beginPath(); ctx.moveTo(x + 0.5, major ? 4 : 12); ctx.lineTo(x + 0.5, height); ctx.stroke();
      ctx.globalAlpha = 1;
      if (major) { ctx.fillStyle = col.quiet; ctx.fillText(`${Math.round((f - first) / fps)}s`, x + 4, 11); }
    }
    /* lanes */
    const { muted = [], soloed = [] } = this.laneState() || {};
    const anySolo = soloed.length > 0;
    this.lanes.forEach((lane, i) => {
      const y = RULER_H + i * LANE_H, mid = y + LANE_H / 2;
      const isMuted = muted.includes(lane.key), isSolo = soloed.includes(lane.key);
      const silent = isMuted || (anySolo && !isSolo);
      ctx.strokeStyle = col.grid; ctx.beginPath(); ctx.moveTo(0, y + LANE_H + 0.5); ctx.lineTo(width, y + LANE_H + 0.5); ctx.stroke();
      ctx.fillStyle = silent ? col.quiet : col.text; ctx.font = '12px system-ui, sans-serif';
      ctx.fillText(clip(ctx, lane.label, LABEL_W - 2 * BTN - 22), 10, mid);
      const b = laneButtons(i);
      drawToggle(ctx, b.mute, 'M', isMuted, col.bad, col);
      drawToggle(ctx, b.solo, 'S', isSolo, col.accent, col);
      ctx.save(); ctx.beginPath(); ctx.rect(LABEL_W, y, width - LABEL_W, LANE_H); ctx.clip();
      ctx.globalAlpha = silent ? 0.3 : 1;
      for (const s of lane.spans) {
        if (s.end < this.view.start || s.start > end) continue;
        const x0 = Math.max(LABEL_W, this.#x(s.start)), x1 = Math.max(x0 + 2, this.#x(s.end));
        const a = ctx.globalAlpha;
        ctx.fillStyle = s.kind === 'platform' ? col.planned : col.span; ctx.globalAlpha = a * 0.28;
        ctx.fillRect(x0, y + 5, x1 - x0, LANE_H - 10); ctx.globalAlpha = a;
        if (s.speed.length > 1) {
          const max = Math.max(...s.speed.map(p => p[1]), 1);
          ctx.strokeStyle = s.kind === 'platform' ? col.planned : col.span; ctx.beginPath();
          s.speed.forEach(([f, v], k) => { const px = this.#x(f), py = y + LANE_H - 6 - (v / max) * (LANE_H - 12); k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
          ctx.stroke();
        }
        this.hits.push({ kind: 'span', id: s.id, x0, x1, y0: y, y1: y + LANE_H, frame: s.start });
      }
      for (const o of lane.occurrences) {
        if (o.paired || o.frame < this.view.start || o.frame > end) continue;
        const x = this.#x(o.frame);
        const dim = this.focusEventId && o.eventId !== this.focusEventId;
        ctx.globalAlpha = (silent ? 0.3 : 1) * (dim ? 0.25 : 1);
        ctx.fillStyle = o.kind === 'cue' ? col.span : o.kind === 'state' ? col.planned : col.accent;
        if (o.kind === 'sound') ctx.fillRect(x - 1.5, y + 5, 3, LANE_H - 10);
        else { ctx.beginPath(); ctx.moveTo(x, y + 5); ctx.lineTo(x + 5, mid); ctx.lineTo(x, y + LANE_H - 5); ctx.lineTo(x - 5, mid); ctx.closePath(); ctx.fill(); }
        if (o.id === this.selectedId) { ctx.globalAlpha = 1; ctx.strokeStyle = col.sel; ctx.lineWidth = 2; ctx.strokeRect(x - 5, y + 3, 10, LANE_H - 6); ctx.lineWidth = 1; }
        this.hits.push({ kind: 'occurrence', id: o.id, x0: x - 5, x1: x + 5, y0: y, y1: y + LANE_H, frame: o.frame });
      }
      ctx.restore();
    });
    /* mix lane: sounds per frame */
    const my = RULER_H + this.lanes.length * LANE_H;
    ctx.fillStyle = col.quiet; ctx.font = '12px system-ui, sans-serif'; ctx.fillText('Mix', 10, my + MIX_H / 2);
    const counts = new Map();
    for (const o of this.session.occurrencesBetween(this.view.start, end)) if (o.kind === 'sound') counts.set(o.frame, (counts.get(o.frame) || 0) + 1);
    ctx.fillStyle = col.accent; ctx.globalAlpha = 0.6;
    for (const [f, n] of counts) { const x = this.#x(f); if (x < LABEL_W) continue; const h = Math.min(MIX_H - 6, n * 7); ctx.fillRect(x - 1, my + MIX_H - 3 - h, 2, h); }
    ctx.globalAlpha = 1;
    /* playhead + live head */
    const live = this.#x(this.session.lastFrame);
    if (live >= LABEL_W) { ctx.strokeStyle = col.quiet; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(live + 0.5, RULER_H); ctx.lineTo(live + 0.5, height); ctx.stroke(); ctx.setLineDash([]); }
    const px = this.#x(this.playhead);
    if (px >= LABEL_W) {
      ctx.strokeStyle = col.accent; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, height); ctx.stroke(); ctx.lineWidth = 1;
      ctx.fillStyle = col.accent; ctx.beginPath(); ctx.moveTo(px - 5, 0); ctx.lineTo(px + 5, 0); ctx.lineTo(px, 7); ctx.closePath(); ctx.fill();
    }
  }

  #geometry() { return { view: this.view, width: this.width, lanes: this.lanes, range: this.range, hits: this.hits }; }
  #bounds() { return this.session?.length ? { first: this.session.firstFrame, last: this.session.lastFrame } : null; }

  #pointerDown(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const hit = hitTest(this.#geometry(), x, y);
    if (hit.kind === 'mute' || hit.kind === 'solo') { this.onLane(hit.lane, hit.kind); this.render(); return; }
    if (hit.kind === 'none' || hit.kind === 'label') return;
    if (hit.kind === 'occurrence') { this.onSelect(hit.id); return; }
    this.canvas.setPointerCapture?.(e.pointerId);
    this.follow = false;
    const frame = this.#clampFrame(hit.frame);
    if (hit.kind === 'range-start') this.drag = { kind: 'range', anchor: this.range.to };
    else if (hit.kind === 'range-end') this.drag = { kind: 'range', anchor: this.range.from };
    else if (hit.kind === 'ruler' && e.shiftKey === false && e.altKey === false) this.drag = { kind: 'draw', anchor: frame, moved: false };
    else { this.drag = { kind: 'scrub' }; this.onSeek(frame); }
  }

  #pointerMove(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (!this.drag) {
      const hit = hitTest(this.#geometry(), x, y);
      this.canvas.style.cursor = hit.kind === 'range-start' || hit.kind === 'range-end' ? 'ew-resize' : hit.kind === 'mute' || hit.kind === 'solo' || hit.kind === 'occurrence' ? 'pointer' : hit.kind === 'ruler' ? 'crosshair' : 'default';
      this.canvas.title = hit.kind === 'mute' ? 'Mute this source in playback' : hit.kind === 'solo' ? 'Solo: hear only soloed sources' : hit.kind.startsWith('range') ? 'Drag to hear more or less context' : hit.kind === 'ruler' ? 'Drag to mark a range to listen to; click to move the playhead' : '';
      return;
    }
    const frame = this.#clampFrame(xToFrame(this.view, this.width, x));
    if (this.drag.kind === 'scrub') this.onSeek(frame);
    else {
      if (this.drag.kind === 'draw' && Math.abs(frame - this.drag.anchor) < 2) return;
      this.drag.moved = true;
      this.range = dragRange(this.drag.anchor, frame, this.#bounds());
      this.onRange(this.range, { final: false });
      this.render();
    }
  }

  #pointerUp(e) {
    const d = this.drag;
    this.drag = null;
    this.canvas.releasePointerCapture?.(e.pointerId);
    if (!d) return;
    if (d.kind === 'draw' && !d.moved) this.onSeek(d.anchor);
    else if (d.kind !== 'scrub' && this.range) this.onRange(this.range, { final: true });
  }

  #wheel(e) {
    e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      this.view.start += Math.round((e.deltaX || e.deltaY) * this.view.frames / 1000);
      this.follow = false; this.render(); return;
    }
    this.zoom(e.deltaY > 0 ? 1.25 : 0.8, xToFrame(this.view, this.width, e.clientX - r.left));
  }

  #clampFrame(f) {
    if (!this.session?.length) return 0;
    return Math.max(this.session.firstFrame, Math.min(this.session.lastFrame, f));
  }
}

function drawToggle(ctx, b, letter, on, onColor, col) {
  ctx.fillStyle = on ? onColor : 'transparent';
  ctx.strokeStyle = on ? onColor : col.grid;
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, 4) : ctx.rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = on ? '#111' : col.quiet; ctx.font = 'bold 11px system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(letter, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2 + 0.5);
  ctx.textAlign = 'start';
}

function clip(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}
