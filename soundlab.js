/* SoundLab Studio: play the game, scrub to any moment, see every sound that
 * fired with the game state behind it, produce Foley and design a
 * replacement against that moment, and hand it to a person for review.
 * Session recording, event catalog, timeline with playback, game view
 * overlay, state inspector, emitter navigation, Foley producer, designer,
 * review queue and WebMCP. The panels and the agent tools share one
 * Workbench. */

import { installWebMcpTools } from './rdx/src/agent/webmcp.js';
import { CATALOG, CATALOG_BY_ID, FAMILIES, groupOf, stageOf } from './rdx/src/soundlab/studio/catalog.js';
import { spanEventId } from './rdx/src/soundlab/studio/context.js';
import { LIVE_HEIGHT, LIVE_WIDTH, StudioRuntime } from './rdx/src/soundlab/studio/runtime.js';
import { Workbench } from './rdx/src/soundlab/studio/workbench.js';
import { StudioPanels, WebAudioPlayer, safeLocalStorage } from './rdx/src/soundlab/studio/panels.js';
import { confirmDialog, installTooltips, toast } from './rdx/src/soundlab/studio/dialogs.js';
import { hasEmitters, locationIndex } from './rdx/src/soundlab/studio/emitters.js';
import { icon } from './rdx/src/soundlab/studio/icons.js';
import { SampleLibrary } from './rdx/src/soundlab/studio/library.js';
import { discoverEarshot } from './rdx/src/soundlab/studio/earshot.js';
import { FRAME_HZ, StudioSession } from './rdx/src/soundlab/studio/session.js';
import { Timeline } from './rdx/src/soundlab/studio/timeline.js';
import { soundlabWebMcpTools } from './rdx/src/soundlab/studio/webmcp-tools.js';

const $ = id => document.getElementById(id);
const els = {
  status: $('st-status'), room: $('st-room'), newSession: $('st-new'), play: $('st-play'), step: $('st-step'),
  speed: $('st-speed'), invincible: $('st-invincible'), save: $('st-save'), load: $('st-load'),
  romLabel: $('st-rom-label'), rom: $('st-rom'), agent: $('st-agent'), agentText: $('st-agent-text'),
  filter: $('st-filter'), catalog: $('st-catalog'), frame: $('st-frame'), viewing: $('st-viewing'), live: $('st-live'),
  overlayToggle: $('st-overlay'), screen: $('st-screen'), overlay: $('st-overlay-canvas'), timeline: $('st-timeline'),
  inspectEmpty: $('st-inspect-empty'), inspect: $('st-inspect'), inTitle: $('in-title'), inIndex: $('in-index'),
  inPrev: $('in-prev'), inNext: $('in-next'), inFacts: $('in-facts'), inNearby: $('in-nearby'), inJson: $('in-json'),
  inDesign: $('in-design'), inFoley: $('in-foley'), inPlay: $('in-play'), reviewCount: $('st-review-count'), emitters: $('in-emitters'),
  tlPlay: $('tl-play'), tlStop: $('tl-stop'), tlLoop: $('tl-loop'), tlHearGame: $('tl-hear-game'), tlHearDesigns: $('tl-hear-designs'),
  tlRange: $('tl-range'), tlRangeClear: $('tl-range-clear'), tlVolume: $('tl-volume')
};
const TABS = ['inspect', 'foley', 'design', 'review'];
const screenCtx = els.screen.getContext('2d');
const overlayCtx = els.overlay.getContext('2d');
screenCtx.imageSmoothingEnabled = false;

const state = {
  tab: 'inspect',
  playhead: 0,
  live: true,
  selectedId: null,
  focusEventId: null,
  lastLiveCanvas: null,
  viewToken: 0,
  hear: 'game',
  emitters: null, /* { eventId, list, index } */
  highlight: null /* emitter to outline on the game view: { submap, type, mark } */
};

const runtime = new StudioRuntime({
  onStatus: text => { els.status.textContent = text; },
  onState: s => renderControls(s),
  onFrame: ({ record, canvas }) => {
    state.lastLiveCanvas = canvas;
    if (state.live) {
      state.playhead = record.frame;
      drawScreen(canvas, record);
    }
    scheduleUi();
  }
});
const library = new SampleLibrary();
const bench = new Workbench({
  session: () => runtime.session,
  library,
  player: new WebAudioPlayer(),
  storage: safeLocalStorage(),
  hooks: {
    changed: kind => benchChanged(kind),
    status: text => { els.status.textContent = text; },
    showFrame: frame => seek({ frame, fromPlayback: true })
  }
});
/* Earshot is reachable when the Studio is opened from the SoundLab
 * authoring service (npm run soundlab:serve -- --earshot-root …). */
discoverEarshot().then(service => { bench.earshot = service; if (service.connected) panels.renderFoley(); }).catch(() => {});
const panels = new StudioPanels({
  bench,
  roots: { foley: $('panel-foley'), design: $('panel-design'), review: $('panel-review') },
  hooks: {
    selectTab: name => selectTab(name),
    error: error => showError(error),
    catalogChanged: () => { els.catalog.dataset.html = ''; scheduleUi(); renderReviewCount(); }
  }
});
const timeline = new Timeline(els.timeline, {
  onSeek: frame => { if (bench.playback) bench.stop(); seek({ frame }); },
  onSelect: id => select(id),
  onRange: (range, { final }) => { if (final) bench.setRange(range); else renderRange(range); },
  onLane: (key, kind) => bench.toggleLane(key, kind),
  laneState: () => bench.laneState()
});

function benchChanged(kind) {
  panels.changed(kind);
  if (kind === 'playback') renderTransport();
  else if (kind === 'loop') els.tlLoop.checked = bench.loop;
  else if (kind === 'volume') els.tlVolume.value = String(Math.round(bench.volume * 100));
  else if (kind === 'lanes') timeline.render();
  else if (kind === 'review') renderReviewCount();
  else {
    timeline.setRange(bench.range); renderRange(bench.range);
    if (bench.eventId && bench.eventId !== state.focusEventId && (kind === 'design' || kind === 'target')) { state.focusEventId = bench.eventId; timeline.setFocusEvent(bench.eventId); scheduleUi(); }
    if (kind === 'design-agent' && state.tab !== 'design' && state.tab !== 'foley') selectTab('design');
  }
}

/* ---------- rendering ---------- */

let uiQueued = false;
function scheduleUi() {
  if (uiQueued) return;
  uiQueued = true;
  requestAnimationFrame(() => {
    uiQueued = false;
    timeline.setPlayhead(state.playhead);
    renderCatalog();
    els.frame.textContent = `frame ${state.playhead}${state.live ? ' · live' : ''} · ${runtime.session.length} recorded`;
  });
}

function drawScreen(source, record) {
  if (source) screenCtx.drawImage(source, 0, 0, LIVE_WIDTH, LIVE_HEIGHT);
  drawOverlay(record);
}

function drawOverlay(record) {
  const o = overlayCtx, sx = els.overlay.width / LIVE_WIDTH, sy = els.overlay.height / LIVE_HEIGHT;
  o.clearRect(0, 0, els.overlay.width, els.overlay.height);
  if (!record || !els.overlayToggle.checked) return;
  const selected = state.selectedId ? runtime.session.occurrence(state.selectedId) : null;
  const hl = state.highlight && state.highlight.submap === record.submap ? state.highlight : null;
  o.font = '11px system-ui, sans-serif'; o.lineWidth = 1.5;
  for (const e of record.ents) {
    if (!e.b) continue;
    const [l, t, r, b] = e.b;
    if (hl && (e.type & 0x7f) === (hl.type & 0x7f) && e.mark === hl.mark) {
      o.strokeStyle = '#3fb68b'; o.lineWidth = 3; o.setLineDash([6, 4]);
      o.strokeRect(l * sx - 4, t * sy - 4, (r - l) * sx + 8, (b - t) * sy + 8); o.setLineDash([]);
      o.fillStyle = '#3fb68b'; o.fillText('emitter', l * sx - 4, Math.max(10, t * sy - 8));
    }
    const isSel = selected?.source && selected.source.slot === e.slot && (selected.source.mark == null || selected.source.mark === e.mark);
    o.strokeStyle = isSel ? '#ffffff' : e.slot === 1 ? 'rgba(240,180,67,.8)' : 'rgba(91,155,224,.7)';
    o.lineWidth = isSel ? 2.5 : 1.25;
    o.strokeRect(l * sx, t * sy, (r - l) * sx, (b - t) * sy);
    if (isSel || e.slot !== 1) {
      o.fillStyle = isSel ? '#ffffff' : 'rgba(200,215,235,.85)';
      o.fillText(`${e.slot}·0x${e.type.toString(16)}${e.mps ? ` ${['', 'wait', 'move', 'rel'][e.mps]}` : ''}`, l * sx, Math.max(10, t * sy - 3));
    }
  }
  /* pings for sounds that fired on this frame, at their stereo position */
  const rows = runtime.session.occurrencesBetween(record.frame, record.frame);
  rows.forEach((row, i) => {
    const x = Number.isFinite(row.screenX) ? row.screenX * sx : els.overlay.width / 2;
    const y = 18 + i * 16;
    o.fillStyle = row.kind === 'sound' ? '#f0b443' : row.kind === 'cue' ? '#5b9be0' : '#b48ae6';
    o.beginPath(); o.arc(x, y, 4, 0, Math.PI * 2); o.fill();
    o.fillText(row.name, x + 8, y + 4);
  });
}

async function showRecordedFrame(frame) {
  const token = ++state.viewToken;
  const record = runtime.session.nearest(frame);
  if (!record) return;
  const bitmap = await runtime.imageFor(record.frame);
  if (token !== state.viewToken) return;
  if (bitmap) screenCtx.drawImage(bitmap, 0, 0, LIVE_WIDTH, LIVE_HEIGHT);
  drawOverlay(record);
}

function renderControls(s) {
  els.play.textContent = s.playing ? 'Pause' : 'Play';
  els.play.setAttribute('aria-pressed', String(!!s.playing));
  for (const b of [els.play, els.step, els.newSession, els.save]) b.disabled = !s.ready;
  els.invincible.checked = !!s.invincible;
}

function renderCatalog() {
  const coverage = runtime.session.coverage();
  const drafts = new Set(bench.store.designedEvents());
  const filter = els.filter.value.trim().toLowerCase();
  const match = e => !filter || `${e.label} ${e.id} ${e.description} ${groupOf(e.id)?.label || ''}`.toLowerCase().includes(filter);
  const row = (e, { member = false } = {}) => {
    const c = coverage[e.id] || { count: 0, rooms: [] }, stage = stageOf(e.id);
    return `<li class="${member ? 'member' : ''}"><button type="button" data-event="${e.id}" aria-current="${state.focusEventId === e.id}" data-tip="${escapeHtml(e.description)}">
        <span class="name">${escapeHtml(e.label)}</span><span class="count ${c.count ? '' : 'zero'}">${c.count}</span>
        <span class="meta">${member && stage ? `<span class="badge phase">${stage}</span>` : ''}<span class="badge ${e.status}">${e.status === 'needs-hook' ? 'needs hook' : e.status}</span>${drafts.has(e.id) ? '<span class="badge draft">draft</span>' : ''}${c.rooms.length ? `rooms ${c.rooms.map(roomId).join(', ')}` : ''}</span>
      </button></li>`;
  };
  const html = [];
  for (const fam of FAMILIES) {
    const rows = CATALOG.filter(e => e.family === fam.id && match(e));
    if (!rows.length) continue;
    html.push(`<li class="family">${fam.label}</li>`);
    const done = new Set();
    for (const e of rows) {
      if (done.has(e.id)) continue;
      const grp = groupOf(e.id);
      if (!grp) { html.push(row(e)); continue; }
      /* a group: its staged design (on the lead event), then its member events */
      const members = [...grp.stages.flatMap(st => st.events), ...grp.also].filter(id => id !== grp.lead && CATALOG_BY_ID[id].family === fam.id);
      [grp.lead, ...members].forEach(id => done.add(id));
      const lead = CATALOG_BY_ID[grp.lead], runs = runtime.session.spans.filter(sp => spanEventId(sp) === grp.lead).length;
      html.push(`<li class="group"><button type="button" data-event="${grp.lead}" aria-current="${state.focusEventId === grp.lead}" data-tip="Design the whole ${escapeHtml(grp.label.toLowerCase())} as one sound in stages: ${grp.stages.map(st => st.label.toLowerCase()).join(' → ')}">
          <span class="name">${escapeHtml(grp.label)} <span class="hint">${grp.stages.map(st => escapeHtml(st.label.toLowerCase())).join(' → ')}</span></span><span class="count ${runs ? '' : 'zero'}" data-tip="Recorded runs">${runs}</span>
          <span class="meta"><span class="badge phase">staged</span>${drafts.has(lead.id) ? '<span class="badge draft">draft</span>' : ''}</span></button></li>`);
      for (const id of members) html.push(row(CATALOG_BY_ID[id], { member: true }));
    }
  }
  const next = html.join('');
  if (els.catalog.dataset.html !== next) { els.catalog.innerHTML = next; els.catalog.dataset.html = next; }
}

function renderInspector() {
  const data = state.selectedId ? runtime.session.inspect(state.selectedId) : null;
  els.inspect.hidden = !data; els.inspectEmpty.hidden = !!data;
  if (!data) return;
  const o = runtime.session.occurrence(state.selectedId);
  const event = data.event;
  els.inTitle.textContent = event ? event.label : data.occurrence.name;
  const peers = siblings(o);
  const index = peers.findIndex(p => p.id === o.id);
  els.inIndex.textContent = peers.length ? `${index + 1} / ${peers.length}` : '–';
  els.inPrev.disabled = index <= 0; els.inNext.disabled = index < 0 || index >= peers.length - 1;
  els.inDesign.disabled = !event; els.inFoley.disabled = !event;
  els.inDesign.textContent = event ? `Design “${event.label}”` : 'Not a catalog event';
  const a = data.actor;
  const facts = [
    ['Event', event ? `${event.id} · ${event.status === 'needs-hook' ? 'needs hook' : event.status}` : 'not in catalog'],
    ['Sound', `${data.occurrence.name}${data.occurrence.kind !== 'sound' ? ` (${data.occurrence.kind})` : ''}${data.occurrence.suppressed ? ' · muted' : ''}`],
    ['Time', `${(data.occurrence.timeMs / 1000).toFixed(2)} s · frame ${data.occurrence.frame}`],
    ['Room', data.room ? `${data.room.id}${data.room.region ? ` · ${data.room.region}` : ''}` : '–'],
    ['Source', data.source ? `${data.source.label} · slot ${data.source.slot}${data.source.mark != null && data.source.mark !== 0xffff ? ` · mark ${data.source.mark}` : ''}` : 'global'],
    ['Position', a ? `${a.position.x}, ${a.position.y} px` : '–'],
    ['Velocity', a ? `${a.velocity.x}, ${a.velocity.y} px/s` : '–'],
    ['Speed', a ? `${a.speed} px/s · ${a.direction}` : '–'],
    ['Acceleration', a ? `${a.acceleration.x}, ${a.acceleration.y} px/s²` : '–'],
    ['Platform', data.platform ? data.platform.state : '–'],
    ['Distance to Rick', data.listener?.distancePx != null ? `${data.listener.distancePx} px` : '–'],
    ['Stereo pan', data.pan != null ? `${data.pan > 0 ? 'right' : data.pan < 0 ? 'left' : 'centre'} ${Math.abs(data.pan).toFixed(2)}` : '–'],
    ['Ongoing', data.activeSpans.length ? data.activeSpans.map(s => s.label).join(', ') : '–'],
    ['Input held', inputName(data.input?.mask)]
  ];
  els.inFacts.innerHTML = facts.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(String(v))}</dd>`).join('');
  els.inNearby.innerHTML = data.nearby.length
    ? data.nearby.map(n => `<li><button type="button" data-occ="${n.id}">${escapeHtml(n.eventId ? CATALOG_BY_ID[n.eventId]?.label || n.name : n.name)}</button><span class="offset">${n.offsetMs > 0 ? '+' : ''}${Math.round(n.offsetMs)} ms</span></li>`).join('')
    : '<li><span class="offset">nothing else</span></li>';
  els.inJson.textContent = JSON.stringify(data, null, 1);
}

function renderReviewCount() {
  const n = bench.store.list({ status: 'pending' }).length;
  els.reviewCount.hidden = !n; els.reviewCount.textContent = String(n);
}

function renderTransport() {
  const p = bench.playback, timelinePlaying = p?.kind === 'range';
  els.tlPlay.innerHTML = icon(timelinePlaying ? 'pause' : 'play');
  els.tlPlay.setAttribute('aria-label', timelinePlaying ? 'Pause' : 'Play from here');
  els.tlStop.classList.toggle('live', !!p);
}

function renderRange(range) {
  const s = runtime.session;
  els.tlRange.textContent = range ? `range ${((range.from - s.firstFrame) / FRAME_HZ).toFixed(1)}–${((range.to - s.firstFrame) / FRAME_HZ).toFixed(1)} s` : 'no range · drag in the ruler';
  els.tlRange.classList.toggle('on', !!range);
  els.tlRangeClear.hidden = !range;
}

function setHear(which) {
  state.hear = which === 'designs' ? 'designs' : 'game';
  els.tlHearGame.setAttribute('aria-checked', String(state.hear === 'game'));
  els.tlHearDesigns.setAttribute('aria-checked', String(state.hear === 'designs'));
}

/* Play the recording from the playhead (to the end of the highlighted range
 * when the playhead is inside it, or looping the range). Pressing it while
 * playing pauses: the playhead stays where the audio got to. */
async function playFromHere({ toggle = true, from = null, to = null, loop = bench.loop, hear = state.hear } = {}) {
  const s = runtime.session;
  if (!s.length) throw new Error('Nothing recorded yet');
  if (toggle && bench.playback?.kind === 'range') { bench.stop(); return { stopped: true, playhead: state.playhead }; }
  if (runtime.playing) runtime.pause();
  const r = bench.range;
  let start = from ?? state.playhead, end = to ?? s.lastFrame;
  const inRange = r && start >= r.from && start < r.to - 1;
  if (from == null && to == null) {
    if (loop && r) { start = r.from; end = r.to; }
    else if (inRange) end = r.to;
    if (start >= end - 1) start = r && !inRange ? r.from : s.firstFrame;
  }
  const designs = hear === 'designs' ? bench.drafts() : {};
  return bench.playRange({ from: start, to: end, mode: hear === 'designs' ? 'candidate' : 'original', designs, loop: loop && !bench.loop, label: hear === 'designs' ? 'Recording with my designs' : 'Recording' });
}

async function refreshEmitters(eventId, occurrence = null) {
  if (!eventId || !hasEmitters(eventId)) { state.emitters = null; renderEmitters(); return null; }
  const list = await bench.emitters(eventId);
  const keep = state.emitters?.eventId === eventId ? state.emitters.index : -1;
  const index = occurrence ? locationIndex(list, occurrence) : keep;
  state.emitters = { eventId, list, index };
  renderEmitters();
  return state.emitters;
}

function renderEmitters() {
  const em = state.emitters;
  els.emitters.hidden = !em || !em.list.length;
  if (els.emitters.hidden) return;
  const loc = em.list[em.index], label = CATALOG_BY_ID[em.eventId].label;
  els.emitters.innerHTML = `<div class="em-row">
      <span class="em-title">${icon('pin')} ${escapeHtml(label)} <span class="hint">placed in the level</span></span>
      <span class="nav" data-tip="Jump between the places this sound comes from (← →; Shift+← → for other times it was heard)">
        <button type="button" class="icon-btn" data-em="-1" aria-label="Previous location" ${em.index <= 0 && em.index !== -1 ? 'disabled' : ''}>${icon('prev')}</button>
        <span class="mono">${em.index >= 0 ? em.index + 1 : '–'} / ${em.list.length}</span>
        <button type="button" class="icon-btn" data-em="1" aria-label="Next location" ${em.index >= em.list.length - 1 ? 'disabled' : ''}>${icon('next')}</button></span></div>
    <p class="mono em-where">${loc ? `${loc.roomId} · ${escapeHtml(loc.label)} · mark ${loc.mark} · ${loc.heard ? `heard ${loc.heard}× this session` : 'not heard yet'}` : `${em.list.length} locations in ${[...new Set(em.list.map(l => l.roomId))].length} rooms · ${em.list.filter(l => l.heard).length} heard this session`}</p>`;
}

/* Jump to an emitter location: its first recorded occurrence, or (after a
 * confirmation, since it replaces the recording) a new session in its room
 * with the emitter outlined on the game view. */
async function gotoEmitter(index, { eventId = state.emitters?.eventId, startNewSession = null } = {}) {
  if (!state.emitters || state.emitters.eventId !== eventId) await refreshEmitters(eventId);
  const em = state.emitters;
  if (!em?.list.length) throw new Error(`${eventId} has no placed emitters`);
  const i = Math.max(0, Math.min(em.list.length - 1, Number(index)));
  const loc = em.list[i];
  em.index = i;
  state.highlight = { submap: loc.submap, type: loc.type, mark: loc.mark };
  renderEmitters();
  if (loc.occurrenceId && runtime.session.occurrence(loc.occurrenceId)) { select(loc.occurrenceId, { keepEmitter: true }); return { location: loc, index: i, moved: 'occurrence', occurrenceId: loc.occurrenceId }; }
  let go = startNewSession;
  if (go == null) go = await confirmDialog(`Go to ${loc.roomId}?`, `This ${loc.label.toLowerCase()} has not been heard in this session yet. Starting a new session in ${loc.roomId} replaces the current recording (save it first if you need it). The emitter is outlined in green.`, { confirm: `Start in ${loc.roomId}` });
  if (!go) { drawOverlay(runtime.session.nearest(state.playhead)); return { location: loc, index: i, moved: null }; }
  await startSession(loc.submap, { keepEmitters: true });
  await refreshEmitters(eventId);
  state.emitters.index = i; renderEmitters();
  return { location: loc, index: i, moved: 'session', submap: loc.submap };
}

function stepEmitter(delta) {
  const em = state.emitters;
  if (!em?.list.length) return false;
  const next = em.index < 0 ? (delta > 0 ? 0 : em.list.length - 1) : em.index + delta;
  if (next < 0 || next >= em.list.length) return true;
  gotoEmitter(next).catch(showError);
  return true;
}

function siblings(o) {
  if (!o) return [];
  return o.eventId ? runtime.session.occurrencesOf(o.eventId) : runtime.session.occurrences.filter(r => r.name === o.name);
}

/* ---------- actions (shared by UI and WebMCP) ---------- */

function seek({ frame, occurrenceId, fromPlayback = false } = {}) {
  if (occurrenceId) return select(occurrenceId);
  const session = runtime.session;
  if (!session.length) return summary();
  if (!fromPlayback && bench.playback?.kind === 'range') bench.stop();
  const f = Math.max(session.firstFrame, Math.min(session.lastFrame, Number(frame)));
  if (runtime.playing) runtime.pause();
  state.playhead = f;
  state.live = f >= session.lastFrame;
  els.viewing.hidden = state.live;
  if (state.live && state.lastLiveCanvas) drawScreen(state.lastLiveCanvas, session.frameAt(f));
  else showRecordedFrame(f);
  scheduleUi();
  return summary();
}

function select(id, { keepEmitter = false } = {}) {
  const o = runtime.session.occurrence(id);
  if (!o) throw new Error(`Unknown occurrence ${id}`);
  state.selectedId = id;
  if (!keepEmitter) state.highlight = o.source?.mark != null ? { submap: o.submap, type: o.source.type, mark: o.source.mark } : null;
  timeline.setSelected(id);
  timeline.reveal(o.frame);
  seek({ frame: o.frame });
  renderInspector();
  refreshEmitters(o.eventId, o).catch(showError);
  if ((state.tab === 'design' || state.tab === 'foley') && o.eventId) {
    if (bench.eventId === o.eventId) bench.setTarget(id); else bench.open(o.eventId, { target: id });
  } else if (state.tab !== 'inspect') selectTab('inspect');
  return runtime.session.inspect(id);
}

function focusEvent(eventId) {
  if (state.tab === 'design' || state.tab === 'foley') { state.focusEventId = eventId; timeline.setFocusEvent(eventId); bench.open(eventId); scheduleUi(); return; }
  state.focusEventId = state.focusEventId === eventId ? null : eventId;
  timeline.setFocusEvent(state.focusEventId);
  scheduleUi();
  if (!state.focusEventId) { refreshEmitters(null); return; }
  const first = runtime.session.occurrencesOf(eventId)[0];
  if (first) select(first.id);
  else {
    state.selectedId = null; timeline.setSelected(null); renderInspector();
    refreshEmitters(eventId).catch(showError);
    els.status.textContent = `${CATALOG_BY_ID[eventId].label}: not heard yet in this session${hasEmitters(eventId) ? ' · use the location arrows to go to one' : ''}`;
  }
}

async function startSession(submap = Number(els.room.value), { keepEmitters = false } = {}) {
  bench.stop();
  state.selectedId = null; state.live = true;
  if (!keepEmitters) { state.focusEventId = null; state.emitters = null; state.highlight = null; renderEmitters(); }
  els.viewing.hidden = true;
  renderInspector();
  await runtime.startSession({ submap });
  if (bench.eventId) bench.open(bench.eventId, { target: null });
  bench.setRange(null);
  els.room.value = String(submap);
  timeline.setSession(runtime.session);
  timeline.setFocusEvent(keepEmitters ? state.focusEventId : null);
  els.status.textContent = `Recording in ${roomId(submap)} · click the game and play`;
  scheduleUi();
  return summary();
}

function runFrames(frames, mask = 0) {
  goLive();
  const before = runtime.session.occurrences.length;
  runtime.run(frames, mask);
  state.playhead = runtime.session.lastFrame;
  if (state.lastLiveCanvas) drawScreen(state.lastLiveCanvas, runtime.session.frameAt(state.playhead));
  scheduleUi();
  return { ...summary(), heard: runtime.session.occurrences.slice(before).map(compactOccurrence) };
}

function setPlaying(playing) {
  if (playing) { goLive(); runtime.play(); els.screen.focus(); } else runtime.pause();
  return summary();
}

function goLive() {
  state.live = true; els.viewing.hidden = true;
  state.playhead = runtime.session.lastFrame;
  if (state.lastLiveCanvas) drawScreen(state.lastLiveCanvas, runtime.session.frameAt(state.playhead));
}

async function replaySession(json) {
  bench.stop();
  state.selectedId = null; renderInspector();
  await runtime.replaySession(json);
  timeline.setSession(runtime.session);
  goLive();
  return summary();
}

function findOccurrences({ eventId, name, submap, limit = 50 }) {
  if (!eventId && !name) throw new Error('Pass eventId or name');
  if (eventId && !CATALOG_BY_ID[eventId]) throw new Error(`Unknown event ${eventId}`);
  let rows = runtime.session.occurrences.filter(o => (eventId ? o.eventId === eventId && !o.paired : o.name === name) && (submap == null || o.submap === Number(submap)));
  const total = rows.length;
  rows = rows.slice(0, limit);
  return { total, occurrences: rows.map(compactOccurrence) };
}

async function frameDetail(frame, { image = false } = {}) {
  const record = runtime.session.frameAt(frame) || runtime.session.nearest(frame);
  if (!record) throw new Error('No recorded frames yet');
  const out = { frame: record.frame, submap: record.submap, mask: record.mask, actors: record.ents, sounds: runtime.session.occurrencesBetween(record.frame, record.frame).map(compactOccurrence) };
  if (image) {
    const bitmap = await runtime.imageFor(record.frame);
    const c = document.createElement('canvas'); c.width = els.overlay.width; c.height = els.overlay.height;
    const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
    if (bitmap) ctx.drawImage(bitmap, 0, 0, c.width, c.height);
    drawOverlay(record); ctx.drawImage(els.overlay, 0, 0); drawOverlay(runtime.session.nearest(state.playhead));
    out.image = c.toDataURL('image/png');
  }
  return out;
}

function compactOccurrence(o) {
  return { id: o.id, frame: o.frame, eventId: o.eventId, name: o.name, kind: o.kind, submap: o.submap, source: o.source };
}

function summary() {
  const s = runtime.state();
  return {
    ready: s.ready, playing: s.playing, replaying: s.replaying,
    session: s.session, playhead: state.playhead, live: state.live,
    selected: state.selectedId ? compactOccurrence(runtime.session.occurrence(state.selectedId)) : null,
    focusEvent: state.focusEventId
  };
}

/* ---------- UI wiring ---------- */

function selectTab(name) {
  state.tab = name;
  $('studio').classList.toggle('wide-side', name !== 'inspect');
  for (const t of TABS) {
    $(`tab-${t}`).setAttribute('aria-selected', String(t === name));
    $(`panel-${t}`).hidden = t !== name;
  }
  if (name === 'review') panels.renderReview();
  if (name === 'design' || name === 'foley') {
    const o = state.selectedId && runtime.session.occurrence(state.selectedId);
    const eventId = o?.eventId || state.focusEventId;
    if (!bench.design && eventId) bench.open(eventId, { target: o?.eventId === eventId ? o.id : undefined });
    else if (name === 'design') panels.renderDesign(); else panels.renderFoley();
  }
}
for (const t of TABS) $(`tab-${t}`).addEventListener('click', () => { try { selectTab(t); } catch (e) { showError(e); } });

function designSelected(tab) {
  const o = runtime.session.occurrence(state.selectedId);
  if (!o?.eventId) return;
  bench.open(o.eventId, { target: o.id });
  selectTab(tab);
}

els.newSession.addEventListener('click', () => startSession().catch(showError));
els.play.addEventListener('click', () => setPlaying(!runtime.playing));
els.step.addEventListener('click', () => { goLive(); runtime.step(1); });
els.live.addEventListener('click', () => goLive());
els.speed.addEventListener('change', () => runtime.setSpeed(els.speed.value));
els.invincible.addEventListener('change', () => runtime.setInvincible(els.invincible.checked));
els.overlayToggle.addEventListener('change', () => drawOverlay(runtime.session.nearest(state.playhead)));
els.filter.addEventListener('input', () => renderCatalog());
els.catalog.addEventListener('click', e => { const b = e.target.closest('button[data-event]'); if (b) focusEvent(b.dataset.event); });
els.inNearby.addEventListener('click', e => { const b = e.target.closest('button[data-occ]'); if (b) select(b.dataset.occ); });
els.inDesign.addEventListener('click', () => designSelected('design'));
els.inFoley.addEventListener('click', () => designSelected('foley'));
els.inPlay.addEventListener('click', () => bench.playInContext({ mode: 'original', target: state.selectedId, design: null }).catch(showError));
els.emitters.addEventListener('click', e => { const b = e.target.closest('button[data-em]'); if (b) stepEmitter(Number(b.dataset.em)); });
els.tlPlay.addEventListener('click', () => playFromHere().catch(showError));
els.tlStop.addEventListener('click', () => bench.stop());
els.tlHearGame.addEventListener('click', () => setHear('game'));
els.tlHearDesigns.addEventListener('click', () => setHear('designs'));
els.tlRangeClear.addEventListener('click', () => bench.setRange(null));
els.tlLoop.addEventListener('change', () => bench.setLoop(els.tlLoop.checked));
els.tlVolume.addEventListener('input', () => {
  bench.setVolume(Number(els.tlVolume.value) / 100);
  try { localStorage.setItem('rdx.soundlab.volume', els.tlVolume.value); } catch { /* private mode */ }
});
els.inPrev.addEventListener('click', () => stepSibling(-1));
els.inNext.addEventListener('click', () => stepSibling(1));
$('tl-in').addEventListener('click', () => timeline.zoom(0.66));
$('tl-out').addEventListener('click', () => timeline.zoom(1.5));
$('tl-all').addEventListener('click', () => timeline.showAll());
els.save.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(runtime.session.toJSON())], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `soundlab-session-${roomId(runtime.session.start.submap)}-${Date.now()}.json`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
els.load.addEventListener('change', async () => {
  const file = els.load.files?.[0]; els.load.value = '';
  if (!file) return;
  try { await replaySession(JSON.parse(await file.text())); } catch (error) { showError(error); }
});
els.rom.addEventListener('change', async () => {
  const file = els.rom.files?.[0]; els.rom.value = '';
  if (!file) return;
  try { await runtime.loadRomFile(file); els.romLabel.hidden = true; await startSession(); } catch (error) { showError(error); }
});

function stepSibling(delta) {
  const o = runtime.session.occurrence(state.selectedId);
  const peers = siblings(o);
  const next = peers[peers.findIndex(p => p.id === o?.id) + delta];
  if (next) select(next.id);
}

/* Game input goes to the game only while its canvas has focus, so typing in
 * the filter never moves Rick. Global shortcuts work everywhere else. */
els.screen.addEventListener('keydown', e => { if (e.repeat) return; runtime.keyDown(e.code); if (gameKey(e.code)) e.preventDefault(); });
els.screen.addEventListener('keyup', e => runtime.keyUp(e.code));
els.screen.addEventListener('blur', () => runtime.clearKeys());
els.screen.addEventListener('pointerdown', () => els.screen.focus());
document.addEventListener('keydown', e => {
  if (e.target === els.screen || document.querySelector('dialog[open]')) return;
  if (e.target.closest('textarea, select, input:not([type=range]):not([type=checkbox])')) return;
  if (e.key === 'Escape') { bench.stop(); return; }
  if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); playFromHere().catch(showError); return; }
  if (e.target.matches('input[type=range]')) return;
  if (e.key === 'p' || e.key === 'P') { setPlaying(!runtime.playing); e.preventDefault(); }
  else if (e.key === '.') { goLive(); runtime.step(1); }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const d = e.key === 'ArrowLeft' ? -1 : 1;
    if (!e.shiftKey && stepEmitter(d)) e.preventDefault();
    else if (state.selectedId) { stepSibling(d); e.preventDefault(); }
  }
});
function gameKey(code) { return /^(Arrow|Space|Key[WASDXC])/.test(code); }

function inputName(mask) {
  const m = Number(mask) || 0;
  if (!m) return 'none';
  if (m === 0x18) return 'gun (fire+up)';
  if (m === 0x14) return 'dynamite (fire+down)';
  return [m & 1 && 'right', m & 2 && 'left', m & 4 && 'down', m & 8 && 'up', m & 16 && 'fire'].filter(Boolean).join('+');
}
function roomId(submap) { return `SM${Number(submap).toString(16).toUpperCase().padStart(2, '0')}`; }
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function showError(error) {
  console.error(error);
  els.status.textContent = error?.message || String(error);
  toast(error?.message || String(error), { kind: 'error', ms: 6000 });
  if (error?.code === 'ROM_REQUIRED') els.romLabel.hidden = false;
}

async function loadRooms() {
  let rooms = [];
  try {
    const manifest = await (await fetch('rdx/data/levels/resolved/manifest.json')).json();
    rooms = (manifest.rooms || []).map(r => ({ submap: Number(r.submap), id: r.id })).sort((a, b) => a.submap - b.submap);
  } catch { rooms = Array.from({ length: 47 }, (_, i) => ({ submap: i, id: roomId(i) })); }
  els.room.innerHTML = rooms.map(r => `<option value="${r.submap}">${r.id}</option>`).join('');
}

/* ---------- WebMCP ---------- */

const app = {
  summary, session: () => runtime.session, startSession, runFrames, setPlaying, seek,
  inspect: id => { const data = runtime.session.inspect(id); if (!data) throw new Error(`Unknown occurrence ${id}`); select(id); return data; },
  findOccurrences, frameDetail, replaySession, bench, panels,
  selectTab, playFromHere, setHear,
  setPlaybackOptions: ({ volume, loop } = {}) => { if (volume != null) bench.setVolume(volume); if (loop != null) bench.setLoop(loop); return { volume: bench.volume, loop: bench.loop }; },
  emitters: async eventId => (await refreshEmitters(eventId))?.list || [],
  gotoEmitter
};
let agentCalls = 0, agentTimer = 0;
function agentBusy(tool) {
  agentCalls += 1; clearTimeout(agentTimer);
  els.agent.hidden = false; els.agentText.textContent = `Agent: ${tool.title || tool.name}`;
  return () => { agentCalls -= 1; if (!agentCalls) agentTimer = setTimeout(() => { els.agent.hidden = true; }, 2500); };
}

/* ---------- boot ---------- */

(async function boot() {
  installTooltips();
  for (const el of document.querySelectorAll('[data-icon]')) el.outerHTML = icon(el.dataset.icon);
  els.inPrev.innerHTML = icon('prev'); els.inNext.innerHTML = icon('next');
  els.tlStop.innerHTML = icon('stop');
  renderTransport(); renderRange(null);
  try { const v = localStorage.getItem('rdx.soundlab.volume'); if (v != null) els.tlVolume.value = v; } catch { /* private mode */ }
  bench.setVolume(Number(els.tlVolume.value) / 100);
  timeline.setSession(runtime.session);
  renderCatalog();
  await loadRooms();
  await library.init();
  renderReviewCount();
  try {
    await runtime.init();
    await startSession(0);
  } catch (error) {
    showError(error);
  }
  await installWebMcpTools({ namespace: 'rdr.soundlab', tools: soundlabWebMcpTools(app), beforeExecute: agentBusy });
  globalThis.soundlab = app; /* console and test access */
})();

export { StudioSession };
