/* SoundLab Studio panels: the Foley, Design and Review tabs drawn over a
 * Workbench. The panels only render and translate clicks; all behaviour is
 * in workbench.js (shared with WebMCP and unit tested). */

import { CATALOG, CATALOG_BY_ID, FAMILIES, STAGE_SEGMENT } from './catalog.js';
import { CONTAINER_MODES, CURVES, FILTER_TYPES, MAPPING_SOURCES, MOVEMENT_METHODS, MOVEMENT_PARAMS, NOISE_COLORS, PARAMS, SEGMENTS, TRANSITION_MODES, TRANSITION_TIME, WAVEFORMS, mappingTargets, movementOf, transitionsOf } from './design.js';
import { EQ_BANDS, FOLEY_MODELS, FOLEY_PARAMS, MATERIALS } from './foley.js';
import { EARSHOT_DIRECTIONS } from './earshot.js';
import { REVIEW_TAGS, VERDICTS } from './review.js';
import { FRAME_HZ } from './session.js';
import { confirmDialog, openDialog, toast } from './dialogs.js';
import { icon } from './icons.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const fmt = (v, unit) => {
  const n = Number(v), a = Math.abs(n);
  if (!Number.isFinite(n)) return '–';
  const text = a >= 100 || Number.isInteger(n) ? String(Math.round(n)) : a >= 1 ? n.toFixed(1) : n.toFixed(2);
  return `${text}${unit ? ` ${unit}` : ''}`;
};
const LOG_UNITS = new Set(['Hz']);
const secs = (s, f) => `${((f - s.firstFrame) / FRAME_HZ).toFixed(1)} s`;

export { WebAudioPlayer } from './player.js';

export class StudioPanels {
  constructor({ bench, roots, hooks }) {
    this.bench = bench;
    this.roots = roots; /* { foley, design, review } */
    this.hooks = hooks; /* { selectTab, error, catalogChanged } */
    this.listen = 'design';
    this.reviewFilter = 'pending';
    this.blind = new Map();
    this.renderTimer = 0;
    this.quiet = false;
    this.busy = null;
    this.openLayers = new Set(); /* layers opened inside stage cards (event:layer) */
    this.#wireDesign(); this.#wireFoley(); this.#wireReview();
  }

  /* Workbench change notifications. Slider edits keep the DOM (quiet). */
  changed(kind) {
    if (kind === 'playback') return this.#renderPlayback();
    if (kind === 'review') { this.renderReview(); this.hooks.catalogChanged?.(); return; }
    if (kind === 'foley') { if (!this.quiet) this.renderFoley(); return; }
    if (kind === 'lanes') return;
    if (kind === 'range') return this.#renderRange();
    if (kind === 'design-patch' && this.quiet) { this.#updateRev(); this.scheduleAnalysis(); this.hooks.catalogChanged?.(); return; }
    this.renderDesign(); this.renderFoley(); this.scheduleAnalysis(); this.hooks.catalogChanged?.();
  }

  scheduleAnalysis() { clearTimeout(this.renderTimer); this.renderTimer = setTimeout(() => this.refreshAnalysis(), 140); }

  async refreshAnalysis() {
    if (!this.bench.design) return;
    const token = (this.analysisToken = (this.analysisToken || 0) + 1);
    try {
      const r = await this.bench.renderCandidate();
      if (token === this.analysisToken) this.#drawAnalysis(r);
    } catch (e) { this.hooks.error(e); }
  }

  async #run(fn) {
    try { return await fn(); } catch (e) { this.hooks.error(e); return null; }
  }

  /* ---------- shared bits ---------- */

  #header(root) {
    const b = this.bench, d = b.design, targets = b.targets(), s = b.session;
    const range = b.range;
    return `<div class="pane-row">
        <label class="field grow">Event <select data-act="event">${eventOptions(d.eventId)}</select></label>
        <span class="dz-rev mono" data-rev></span>
      </div>
      <div class="pane-row">
        <label class="field grow" data-tip="The recorded moment the sound is heard at: its game state drives the scene, mappings and in-context playback">At
          <select data-act="target">${targets.length ? targets.map(t => `<option value="${t.id}" ${t.id === b.target ? 'selected' : ''}>${esc(t.label)}</option>`).join('') : '<option value="">not recorded yet · neutral context</option>'}</select></label>
        ${root === 'design' ? `<span class="range-chip mono" data-range data-tip="The stretch played by “in context”. Drag its edges on the timeline to hear more or less">${range ? `${secs(s, range.from)} – ${secs(s, range.to)}` : 'no range'}</span>` : ''}
      </div>`;
  }

  #transport(kind) {
    const b = this.bench, hasTarget = !!(b.target || b.range);
    if (kind === 'design') {
      const multi = b.design.variation.count > 1;
      return `<div class="transport" role="toolbar" aria-label="Listen">
        <div class="seg" role="radiogroup" aria-label="Listen to">
          <button type="button" role="radio" aria-checked="${this.listen === 'design'}" data-act="listen" data-which="design" data-tip="Listen to your design">Design</button>
          <button type="button" role="radio" aria-checked="${this.listen === 'game'}" data-act="listen" data-which="game" data-tip="Listen to what the game plays today">Game sound</button>
        </div>
        <button type="button" class="icon-btn primary" data-act="play-once" aria-label="Play once" data-tip="Play the ${this.listen === 'game' ? 'game sound' : 'design'} once, as heard at the selected moment">${icon('play')}</button>
        <button type="button" class="icon-btn" data-act="play-context" ${hasTarget ? '' : 'disabled'} aria-label="Play in context" data-tip="Replay the highlighted stretch of the recording with every other game sound, ${this.listen === 'game' ? 'as the game sounds today' : 'with your design swapped in'}; the game view follows">${icon('context')}</button>
        <button type="button" class="icon-btn" data-act="variants" ${this.listen === 'design' && multi ? '' : 'disabled'} aria-label="Play all variants" data-tip="Play each of the ${b.design.variation.count} variants in turn (seeded pitch, level and timing spread) so you can hear the variety">${icon('variants')}</button>
        <button type="button" class="icon-btn" data-act="stop" aria-label="Stop" data-tip="Stop all playback (Esc)">${icon('stop')}</button>
        <span class="now-playing mono" data-now></span>
      </div>`;
    }
    return '';
  }

  #renderPlayback() {
    const p = this.bench.playback;
    for (const el of document.querySelectorAll('[data-now]')) el.textContent = p ? `▶ ${p.label}` : '';
    for (const el of document.querySelectorAll('[data-act="stop"]')) el.classList.toggle('live', !!p);
  }

  #renderRange() {
    const b = this.bench, s = b.session, el = this.roots.design.querySelector('[data-range]');
    if (el) el.textContent = b.range ? `${secs(s, b.range.from)} – ${secs(s, b.range.to)}` : 'no range';
    const btn = this.roots.design.querySelector('[data-act="play-context"]');
    if (btn) btn.disabled = !(b.target || b.range);
  }

  #updateRev() {
    for (const el of document.querySelectorAll('[data-rev]')) el.textContent = this.bench.design ? `rev ${this.bench.design.revision}${this.bench.saved() ? ' · draft saved' : ' · game sound'}` : '';
  }

  /* ---------- Design tab ---------- */

  renderDesign() {
    const root = this.roots.design, b = this.bench;
    if (!b.design) { root.innerHTML = emptyState(); return; }
    const d = b.design, e = CATALOG_BY_ID[d.eventId];
    const samples = b.library.catalogue();
    const keep = root.scrollTop;
    root.innerHTML = `
      ${this.#header('design')}
      <p class="dz-desc">${esc(e.description)}${e.status === 'needs-hook' ? ' · <b>the game cannot play this yet</b>: design it ahead of the native hook' : ''}</p>
      ${this.#transport('design')}
      <canvas class="dz-viz" data-viz width="720" height="200" aria-label="Waveform and spectrogram: design on top, game sound below"></canvas>
      <table class="dz-metrics" data-metrics></table>
      <p class="dz-context mono" data-context></p>
      ${b.stagedGroup() ? stagesSection(b.stagedGroup(), d, samples, id => this.openLayers.has(`${d.eventId}:${id}`)) : ''}
      <details ${b.stagedGroup() ? '' : 'open'} ${b.stagedGroup() ? 'hidden' : ''}><summary>Layers <span class="hint">${d.layers.length}</span></summary>
        <div class="dz-layers">${b.stagedGroup() ? '' : d.layers.map(l => layerCard(l, samples, d.container.mode)).join('')}</div>
        <div class="dz-add">Add layer
          <button type="button" data-act="add" data-kind="foley" data-tip="A generated Foley layer (open the Foley tab to shape it from the scene)">Foley</button>
          <button type="button" data-act="add" data-kind="sample" data-tip="A recorded game or SoundLab sample">Sample</button>
          <button type="button" data-act="add" data-kind="tone" data-tip="An oscillator: sweeps, thumps, whines">Tone</button>
          <button type="button" data-act="add" data-kind="noise" data-tip="Filtered noise: air, grit, hiss">Noise</button></div>
      </details>
      <details ${d.container.mode === 'loop' ? 'open' : ''}><summary>Playback &amp; variation</summary>
        <label class="field" data-tip="One-shot plays once per occurrence; loop plays start/loop/stop segments along a recorded motion">Container <select data-path="container.mode">${CONTAINER_MODES.map(m => `<option ${m === d.container.mode ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
        <label class="check"><input type="checkbox" data-path="container.noRepeat" ${d.container.noRepeat ? 'checked' : ''}> Never repeat a variant twice in a row</label>
        ${Object.entries(PARAMS.variation).map(([k, s]) => slider(`variation.${k}`, s, d.variation[k])).join('')}
        ${d.container.mode === 'loop' ? Object.entries(PARAMS.loop).map(([k, s]) => slider(`container.${k}`, s, d.container[k])).join('') : ''}
      </details>
      <details ${d.mappings.length ? 'open' : ''}><summary>Game parameters → sound <span class="hint">${d.mappings.length}</span></summary>
        <p class="hint">Each row reads a value from the game at the moment the sound fires (speed, distance, …) and drives one parameter through a curve.</p>
        <div class="dz-maps">${d.mappings.map((m, i) => mappingRow(m, i, d)).join('')}</div>
        <button type="button" data-act="add-map">Add mapping</button>
      </details>
      <details><summary>Space &amp; master</summary>
        ${Object.entries(PARAMS.master).map(([k, s]) => slider(`master.${k}`, s, d.master[k])).join('')}
      </details>
      <label class="field block">Notes <textarea data-path="notes" rows="2" placeholder="What this sound should feel like">${esc(d.notes)}</textarea></label>
      <div class="dz-actions">
        <button type="button" class="primary" data-act="submit" data-tip="Send this version to the Review tab for a listening verdict">Submit for review</button>
        <button type="button" data-act="reset" data-tip="Discard this draft and start again from the game sound">Reset to game sound</button>
        <button type="button" class="icon-btn" data-act="wav" aria-label="Download WAV" data-tip="Download the design as a WAV">${icon('download')} WAV</button>
        <button type="button" class="icon-btn" data-act="json" aria-label="Download design" data-tip="Download the design document (JSON)">${icon('download')} JSON</button>
      </div>`;
    root.scrollTop = keep;
    this.#updateRev(); this.#renderPlayback();
    if (b.last) this.#drawAnalysis(b.last);
  }

  #drawAnalysis(r) {
    const root = this.roots.design;
    const canvas = root.querySelector('[data-viz]');
    if (!canvas || !r) return;
    drawViz(canvas, r.analysis, r.referenceAnalysis);
    const a = r.analysis, g = r.referenceAnalysis || {};
    const row = (label, k, unit, tip) => `<tr><th data-tip="${tip}">${label}</th><td>${a.silent ? '–' : fmt(a[k], unit)}</td><td>${g && !g.silent && g[k] != null ? fmt(g[k], unit) : '–'}</td></tr>`;
    const c = r.comparison;
    root.querySelector('[data-metrics]').innerHTML = `<tr><th></th><th>Design</th><th>Game</th></tr>
      ${row('Length', 'durationMs', 'ms', 'From onset until the sound falls 60 dB below its peak')}${row('Attack', 'attackMs', 'ms', 'Onset to peak')}${row('Peak', 'peakDb', 'dB', 'Highest sample level')}${row('Loudness', 'loudestDb', 'dB', 'Loudest 50 ms RMS window')}${row('Brightness', 'centroidHz', 'Hz', 'Spectral centroid')}
      ${c ? `<tr><th>Versus game</th><td colspan="2">spectrum ${c.spectralDistanceDb} dB apart · ${c.loudnessDiffDb > 0 ? '+' : ''}${c.loudnessDiffDb} dB · ${c.durationRatio}× length</td></tr>` : ''}
      ${r.missing?.length ? `<tr><th>Missing</th><td colspan="2" class="warn">could not load ${r.missing.map(m => esc(m.name)).join(', ')}</td></tr>` : ''}`;
    const ctx = r.context;
    const mv = root.querySelector('[data-movement-metrics]');
    if (mv) mv.textContent = movementFacts(r.movement);
    root.querySelector('[data-context]').textContent = `heard at: speed ${ctx.speed} px/s · distance ${ctx.distance} px · pan ${ctx.pan} · ${ctx.nearby} sound(s) nearby${r.environment ? ` · ${r.environment}` : ''}`;
  }

  #wireDesign() {
    const d = this.roots.design;
    d.addEventListener('input', e => this.#onDesignInput(e, false));
    d.addEventListener('change', e => this.#onDesignInput(e, true));
    d.addEventListener('click', e => this.#onDesignClick(e));
    /* stage cards start collapsed; remember what was opened (toggle does not bubble) */
    d.addEventListener('toggle', e => {
      const id = e.target.dataset?.layer;
      if (!id || !e.target.closest('.stage-card') || !this.bench.design) return;
      const key = `${this.bench.design.eventId}:${id}`;
      if (e.target.open) this.openLayers.add(key); else this.openLayers.delete(key);
    }, true);
  }

  #onDesignInput(e, committed) {
    const el = e.target, b = this.bench;
    if (el.dataset.act === 'event' && committed) return this.#run(() => b.open(el.value));
    if (el.dataset.act === 'target' && committed) return this.#run(() => b.setTarget(el.value || null));
    if (el.dataset.map != null) return committed && this.#onMapping(el);
    if (el.dataset.mv) {
      if (el.type === 'range' && committed) return;
      if (el.tagName === 'SELECT' && !committed) return;
      let value = el.tagName === 'SELECT' ? el.value : Number(el.value);
      if (el.dataset.log) value = Math.round(fromLog(Number(el.value), Number(el.dataset.min), Number(el.dataset.max)));
      this.quiet = el.tagName !== 'SELECT';
      try { b.patch(null, { container: { movement: { [el.dataset.mv]: value } } }); } catch (err) { this.hooks.error(err); } finally { this.quiet = false; }
      const out = el.closest('.pr')?.querySelector('output');
      if (out) out.textContent = el.dataset.mv === 'refSpeed' && !value ? 'auto' : fmt(value, el.dataset.unit);
      return;
    }
    if (el.dataset.tr) {
      if (el.type === 'range' && committed) return;
      if (el.tagName === 'SELECT' && !committed) return;
      const value = el.tagName === 'SELECT' ? el.value : Number(el.value);
      this.quiet = el.tagName !== 'SELECT';
      try { b.patch(null, { container: { transitions: { [el.dataset.tr]: { [el.dataset.k]: value } } } }); } catch (err) { this.hooks.error(err); } finally { this.quiet = false; }
      const out = el.closest('.pr')?.querySelector('output');
      if (out) out.textContent = fmt(value, 'ms');
      return;
    }
    const path = el.dataset.path;
    if (!path || (el.type === 'range' && committed)) return;
    if (el.tagName === 'TEXTAREA' && !committed) return;
    const structural = el.tagName === 'SELECT' || el.type === 'checkbox';
    if (!committed && structural) return;
    let value = el.type === 'checkbox' ? el.checked : el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' ? el.value : Number(el.value);
    if (el.dataset.log) value = Math.round(fromLog(Number(el.value), Number(el.dataset.min), Number(el.dataset.max)));
    const rerender = structural && /mode|kind|filter|segment|source|model|enabled|solo/.test(path);
    this.quiet = !rerender;
    try { b.patch(null, pathPatch(path, value)); } catch (err) { this.hooks.error(err); } finally { this.quiet = false; }
    const out = el.closest('.pr')?.querySelector('output');
    if (out) out.textContent = fmt(value, el.dataset.unit);
  }

  #onMapping(el) {
    const rows = [...this.roots.design.querySelectorAll('.dz-map')].map(row => {
      const get = k => row.querySelector(`[data-k="${k}"]`).value;
      return { source: get('source'), target: get('target'), curve: get('curve'), inMin: Number(get('inMin')), inMax: Number(get('inMax')), outMin: Number(get('outMin')), outMax: Number(get('outMax')) };
    });
    this.quiet = !(el.dataset.k === 'source' || el.dataset.k === 'target');
    try { this.bench.patch(null, { mappings: rows }); } finally { this.quiet = false; }
  }

  async #onDesignClick(e) {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const b = this.bench, act = btn.dataset.act;
    await this.#run(async () => {
      if (act === 'listen') { this.listen = btn.dataset.which; this.renderDesign(); }
      else if (act === 'play-once') await b.play(this.listen);
      else if (act === 'play-context') await b.playInContext({ mode: this.listen === 'game' ? 'original' : 'candidate' });
      else if (act === 'variants') await b.playVariants();
      else if (act === 'stop') b.stop();
      else if (act === 'add') {
        b.patch(null, { addLayer: { kind: btn.dataset.kind, ...(btn.dataset.segment ? { segment: btn.dataset.segment } : {}) } });
        if (btn.dataset.kind === 'foley') toast('Foley layer added. Shape it in the Foley tab.');
      } else if (act === 'foley-stage') { b.setFoleyStage(btn.dataset.stage); this.hooks.selectTab('foley'); }
      else if (act === 'remove') b.patch(null, { removeLayer: btn.dataset.layer });
      else if (act === 'edit-foley') this.hooks.selectTab('foley');
      else if (act === 'add-map') b.patch(null, { mappings: [...b.design.mappings, { source: 'speed', target: mappingTargets(b.design)[0], curve: 'linear', inMin: 0, inMax: 150, outMin: -12, outMax: 0 }] });
      else if (act === 'del-map') b.patch(null, { mappings: b.design.mappings.filter((_, i) => i !== Number(btn.dataset.index)) });
      else if (act === 'submit') await this.submitDialog();
      else if (act === 'reset') { if (await confirmDialog('Reset to the game sound?', 'This discards your draft of this event. Submitted review candidates are kept.', { confirm: 'Reset', danger: true })) b.reset(); }
      else if (act === 'wav') download(new Blob([await b.wavFor()], { type: 'audio/wav' }), `${b.eventId}-rev${b.design.revision}.wav`);
      else if (act === 'json') download(new Blob([JSON.stringify(b.design, null, 2)], { type: 'application/json' }), `${b.eventId}-rev${b.design.revision}.json`);
    });
  }

  async submitDialog() {
    const { candidateName } = await import('./workbench.js');
    const r = await openDialog({
      title: 'Submit for review',
      message: `${CATALOG_BY_ID[this.bench.eventId].label}, revision ${this.bench.design.revision}. It appears in the Review tab for a listening verdict.`,
      fields: [{ name: 'name', label: 'Name', value: candidateName(this.bench.eventId) }, { name: 'rationale', label: 'What should the reviewer listen for? (optional)', multiline: true }],
      actions: [{ label: 'Cancel', value: 'cancel' }, { label: 'Submit', value: 'submit', primary: true }]
    });
    if (r?.action !== 'submit') return null;
    const c = await this.bench.submit({ name: r.values.name, rationale: r.values.rationale });
    toast(`Submitted “${c.name}”`);
    this.hooks.selectTab('review');
    return c;
  }

  /* ---------- Foley tab ---------- */

  renderFoley() {
    const root = this.roots.foley, b = this.bench;
    if (!b.design) { root.innerHTML = emptyState(); return; }
    let scene;
    try { scene = b.foleyScene(); } catch (e) { root.innerHTML = `<p class="empty">${esc(e.message)}</p>`; return; }
    const f = b.foley, p = f.recipe, ref = f.reference;
    const keep = root.scrollTop;
    const model = FOLEY_MODELS[p.model];
    const grp = b.stagedGroup(), stage = grp?.stages.find(x => x.id === f.stage);
    root.innerHTML = `
      ${this.#header('foley')}
      ${grp ? `<div class="pane-row fz-stage"><span class="hint">Producing the</span>
        <div class="seg" role="radiogroup" aria-label="Stage">${grp.stages.map(st => `<button type="button" role="radio" aria-checked="${st.id === f.stage}" data-fact="stage" data-stage="${st.id}" data-tip="${esc(stageTip(st))}">${esc(st.label)}</button>`).join('')}</div>
        <span class="hint">stage of the ${esc(grp.label.toLowerCase())}</span></div>` : ''}
      <section class="fz-block">
        <h4>Scene <span class="hint">read from the recording</span></h4>
        <dl class="facts compact">${scene.facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
        ${f.scene.motion ? `<canvas class="fz-motion" data-motion width="600" height="56" aria-label="Recorded speed over time"></canvas>` : ''}
      </section>
      <section class="fz-block">
        <h4>Description</h4>
        <div class="fz-describe">
          <textarea data-fact="description" rows="2" placeholder="e.g. heavy granite boulder rolling slowly over gritty temple floor, slightly distant">${esc(f.description)}</textarea>
          <button type="button" data-fact="describe" data-tip="Read the description into the controls below, on top of the scene">Apply</button>
        </div>
        ${f.terms.length ? `<p class="chips">${f.terms.map(t => `<span class="chip on">${esc(t)}</span>`).join('')}</p>` : '<p class="hint">Words for material (stone, metal, wood…), surface (“on gravel”), action (rolling, scraping, impact…) and character (heavy, sharp, gritty, ringing, distant…) set the controls.</p>'}
      </section>
      <section class="fz-block">
        <h4>Reference <span class="hint">optional · steers the generator toward a recording</span></h4>
        ${ref ? `<div class="fz-ref">
            <button type="button" class="icon-btn" data-fact="play-ref" aria-label="Play reference" data-tip="Play the reference">${icon('play')}</button>
            <canvas data-refwave width="300" height="40" aria-hidden="true"></canvas>
            <span class="mono">${esc(ref.label)} · ${fmt(ref.features.durationMs, 'ms')} · ${fmt(ref.features.centroidHz, 'Hz')}</span>
            <button type="button" class="link" data-fact="clear-ref">remove</button></div>
          ${slider('ref.weight', [0, 1, 0.7, '', 'Steer strength', 'How strongly matching the reference outweighs the scene and description'], f.referenceWeight, 'data-fpath')}
          <label class="check" data-tip="Off: keep the model and material from the scene and description, only shape the controls. On: also try every model and material"><input type="checkbox" data-fact="allow-model" ${f.allowModelChange ? 'checked' : ''}> May change model and material</label>
          <div class="fz-row"><button type="button" class="primary" data-fact="fit" data-tip="Adjust the controls and a match EQ so the generated sound gets closer to the reference, within the scene">Match reference</button>
            <span class="mono" data-fitstatus>${f.fit ? `match ${pct(f.fit.before)} → ${pct(f.fit.after)}` : ''}</span></div>`
        : `<div class="fz-ref empty-ref" data-drop>
            <label class="button-like" data-tip="A WAV recording of the kind of sound you want">${icon('upload')} Choose WAV…<input type="file" data-fact="ref-file" accept=".wav,audio/wav,audio/*" hidden></label>
            <button type="button" data-fact="ref-game" ${b.target ? '' : 'disabled'} data-tip="Use the sound the game plays at the selected moment">Use game sound</button>
            <select data-fact="ref-lib" aria-label="Pick a library sound"><option value="">or pick a sample…</option>${b.library.catalogue().map(s => `<option value="${s.type}|${esc(s.name)}">${esc(s.label)}</option>`).join('')}</select>
            <span class="hint">or drop a file here</span></div>`}
      </section>
      <section class="fz-block">
        <h4>Generator</h4>
        <div class="fz-row">
          <label class="field" data-tip="${esc(model.help)}">Model <select data-fpath="model">${Object.entries(FOLEY_MODELS).map(([k, m]) => `<option value="${k}" ${k === p.model ? 'selected' : ''}>${m.label}</option>`).join('')}</select></label>
          <label class="field">Material <select data-fpath="material">${materialOptions(p.material)}</select></label>
          <label class="field" data-tip="What the source hits, rolls or steps on">Surface <select data-fpath="surface">${materialOptions(p.surface)}</select></label>
          ${model.continuous ? `<label class="check" data-tip="Use the recorded speed over time (${f.scene.motion ? `${f.scene.motion.length} frames` : 'none recorded here'}) instead of a fixed speed and length"><input type="checkbox" data-fpath="followMotion" ${p.followMotion ? 'checked' : ''}> Follow recorded motion</label>` : ''}
        </div>
        ${Object.entries(FOLEY_PARAMS).filter(([k]) => k !== 'seed' && !(k === 'speed' && !model.continuous && p.model !== 'whoosh') && !(model.continuous && p.followMotion && f.scene.motion && (k === 'speed' || k === 'durationMs'))).map(([k, s]) => slider(`foley.${k}`, s, p[k], 'data-fpath')).join('')}
        ${p.eq ? `<div class="fz-row fz-eq" data-tip="Match EQ set by Match reference: gain per band, low to high"><span class="hint">Match EQ</span>${p.eq.map((g, i) => `<span class="eqb" title="${EQ_BANDS[i] >= 1000 ? `${(EQ_BANDS[i] / 1000).toFixed(1)} kHz` : `${EQ_BANDS[i]} Hz`}: ${g > 0 ? '+' : ''}${g} dB"><i style="height:${(Math.abs(g) / 18 * 13).toFixed(1)}px;${g > 0 ? 'bottom' : 'top'}:50%"></i></span>`).join('')}<button type="button" class="link" data-fact="clear-eq">flatten</button></div>` : ''}
        ${slider('takes.spread', [0, 1, 0.15, '', 'Take variation', 'How far each take wanders from these controls (0 = only the seed changes)'], f.spread, 'data-fpath')}
        <div class="fz-row">
          <button type="button" class="primary" data-fact="takes" data-tip="Render four variations around these controls${ref ? ', ranked by how close each is to the reference' : ''}">${icon('variants')} Generate takes</button>
          <button type="button" data-fact="scene" data-tip="Start again from what the scene suggests">Reset to scene</button>
        </div>
      </section>
      ${earshotSection(b)}
      <section class="fz-block">
        <h4>Takes</h4>
        ${f.takes.length ? `<ol class="takes">${f.takes.map(t => `<li data-take="${t.id}">
            <canvas data-takewave="${t.id}" width="220" height="36" aria-hidden="true"></canvas>
            <div class="take-meta"><b>${t.id}</b>${t.source === 'earshot' ? ` <span class="badge phase" data-tip="Made by Earshot: ${esc(JSON.stringify(t.earshot))}">earshot · ${esc(t.label)}</span>${t.metrics?.warnings?.length ? ` <span class="badge v-wrong" data-tip="Earshot signal checks (not a quality judgement): ${esc(t.metrics.warnings.join(', '))}">${t.metrics.warnings.length} check${t.metrics.warnings.length > 1 ? 's' : ''}</span>` : ''}` : ''}${t.match != null ? ` <span class="badge ${t.match > 0.5 ? 'soundlab' : ''}" data-tip="Closeness to the reference">${pct(t.match)} match</span>` : ''}
              <span class="mono">${fmt(t.analysis.durationMs, 'ms')} · ${fmt(t.analysis.centroidHz, 'Hz')}</span></div>
            <div class="take-actions">
              <button type="button" class="icon-btn" data-fact="take-play" aria-label="Play take" data-tip="Play this take on its own">${icon('play')}</button>
              <button type="button" class="icon-btn" data-fact="take-context" ${b.target || b.range ? '' : 'disabled'} aria-label="Play take in context" data-tip="Hear this take in the recorded scene, replacing the current design">${icon('context')}</button>
              <button type="button" data-fact="take-use" data-tip="${stage ? `Make this take the ${esc(stage.label)} stage (that stage's other layers are muted, not deleted)` : 'Make this take the design\'s Foley layer (other layers are muted, not deleted)'}">${stage ? `Use for ${esc(stage.label)}` : 'Use'}</button>
              <button type="button" data-fact="take-add" data-tip="${stage ? `Add this take as an extra layer in the ${esc(stage.label)} stage` : 'Add this take as an extra layer on top of the design'}">Add layer</button>
              ${t.source === 'earshot'
                ? `<select data-fact="earshot-refine" aria-label="Refine with Earshot" data-tip="Four new Earshot takes starting from this one"><option value="">refine with Earshot…</option>${Object.entries(EARSHOT_DIRECTIONS).map(([k, help]) => `<option value="${k}" title="${esc(help)}">${k}</option>`).join('')}</select>`
                : `<button type="button" class="link" data-fact="take-refine" data-tip="Copy this take's controls into the generator to refine from it">refine</button>`}
            </div></li>`).join('')}</ol>` : '<p class="hint">Generate takes to audition variations; use one to put it into the design.</p>'}
      </section>`;
    root.scrollTop = keep;
    this.#updateRev();
    if (f.scene.motion) drawSpeed(root.querySelector('[data-motion]'), f.scene.motion);
    if (ref) drawWave(root.querySelector('[data-refwave]'), ref.buffer.left);
    for (const t of f.takes) drawWave(root.querySelector(`[data-takewave="${t.id}"]`), t.buffer.left);
  }

  #wireFoley() {
    const r = this.roots.foley;
    r.addEventListener('input', e => this.#onFoleyInput(e, false));
    r.addEventListener('change', e => this.#onFoleyInput(e, true));
    r.addEventListener('click', e => this.#onFoleyClick(e));
    r.addEventListener('dragover', e => { if (e.target.closest('[data-drop]')) { e.preventDefault(); e.target.closest('[data-drop]').classList.add('over'); } });
    r.addEventListener('dragleave', e => e.target.closest('[data-drop]')?.classList.remove('over'));
    r.addEventListener('drop', e => {
      const zone = e.target.closest('[data-drop]'); if (!zone) return;
      e.preventDefault(); zone.classList.remove('over');
      const file = e.dataTransfer?.files?.[0]; if (file) this.#run(() => this.#loadReferenceFile(file));
    });
    r.addEventListener('keydown', e => { if (e.target.dataset.fact === 'description' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.#run(() => this.bench.describeFoley(e.target.value)); } });
  }

  async #loadReferenceFile(file) {
    const bytes = await file.arrayBuffer();
    try { return await this.bench.setReference({ wav: bytes, label: file.name }); }
    catch {
      /* not a PCM WAV: let the browser decode it (mp3, ogg, ...) */
      const ctx = new OfflineAudioContext(1, 1, 48000);
      const audio = await ctx.decodeAudioData(bytes.slice(0));
      return this.bench.setReference({ decoded: { data: audio.getChannelData(0), sampleRate: audio.sampleRate }, label: file.name });
    }
  }

  #onFoleyInput(e, committed) {
    const el = e.target, b = this.bench;
    if (el.dataset.act === 'event' && committed) return this.#run(() => b.open(el.value));
    if (el.dataset.act === 'target' && committed) return this.#run(() => { b.setTarget(el.value || null); this.renderFoley(); });
    if (el.dataset.fact === 'allow-model' && committed) { b.setAllowModelChange(el.checked); return; }
    if (el.dataset.fact === 'earshot-refine' && committed && el.value) {
      const take = el.closest('[data-take]').dataset.take, direction = el.value;
      el.disabled = true;
      return this.#run(async () => { await b.earshotRound({ parent: take, direction }); toast(`Earshot round from ${take}: ${direction}.`); });
    }
    if (el.dataset.fact === 'ref-file' && committed) { const file = el.files?.[0]; if (file) this.#run(() => this.#loadReferenceFile(file)); return; }
    if (el.dataset.fact === 'ref-lib' && committed && el.value) { const [type, ...rest] = el.value.split('|'); return this.#run(() => b.setReference({ source: { type, name: rest.join('|') } })); }
    const path = el.dataset.fpath;
    if (!path || (el.type === 'range' && committed)) return;
    const structural = el.tagName === 'SELECT' || el.type === 'checkbox';
    if (!committed && structural) return;
    let value = el.type === 'checkbox' ? el.checked : el.tagName === 'SELECT' ? el.value : Number(el.value);
    if (el.dataset.log) value = Math.round(fromLog(Number(el.value), Number(el.dataset.min), Number(el.dataset.max)));
    this.quiet = !structural;
    try {
      if (path === 'ref.weight') b.setReferenceWeight(value);
      else if (path === 'takes.spread') b.setTakeSpread(value);
      else b.setFoley({ [path.replace(/^foley\./, '')]: value });
    } finally { this.quiet = false; }
    const out = el.closest('.pr')?.querySelector('output');
    if (out) out.textContent = fmt(value, el.dataset.unit);
  }

  async #onFoleyClick(e) {
    const btn = e.target.closest('button[data-fact]');
    if (!btn) return;
    const b = this.bench, act = btn.dataset.fact, take = btn.closest('[data-take]')?.dataset.take;
    await this.#run(async () => {
      if (act === 'describe') b.describeFoley(this.roots.foley.querySelector('[data-fact="description"]').value);
      else if (act === 'ref-game') await b.setReference({ occurrenceId: b.target });
      else if (act === 'clear-ref') b.clearReference();
      else if (act === 'clear-eq') b.setFoley({ eq: null });
      else if (act === 'play-ref') await b.playReference();
      else if (act === 'fit') {
        btn.disabled = true; btn.textContent = 'Matching…';
        const status = this.roots.foley.querySelector('[data-fitstatus]');
        const r = await b.fitReference({ onProgress: p => { if (status) status.textContent = `${p.iteration}/${p.of} · ${pct(p.score)}`; } });
        toast(`Reference match ${pct(r.matchBefore)} → ${pct(r.matchAfter)}. Generate takes to audition.`);
      } else if (act === 'takes') { btn.disabled = true; btn.textContent = 'Rendering…'; await new Promise(res => setTimeout(res, 20)); b.generateTakes(); }
      else if (act === 'scene') b.useSceneRecipe();
      else if (act === 'take-play') await b.playTake(take);
      else if (act === 'take-context') await b.playTakeInContext(take);
      else if (act === 'stage') b.setFoleyStage(btn.dataset.stage);
      else if (act === 'take-use') { const st = b.stagedGroup()?.stages.find(x => x.id === b.foley.stage); b.useTake(take, { mode: 'replace' }); toast(st ? `Take ${take} is now the ${st.label} stage.` : `Take ${take} is now the design's Foley layer. Other layers are muted.`); }
      else if (act === 'take-add') { b.useTake(take, { mode: 'add' }); toast(`Take ${take} added as a layer.`); }
      else if (act === 'take-refine') { const t = b.foley.takes.find(x => x.id === take); b.setFoley({ ...t.foley }); }
      else if (act === 'earshot') { btn.disabled = true; btn.textContent = 'Earshot is rendering…'; await b.earshotRound(); }
    });
  }

  /* ---------- Review tab ---------- */

  renderReview() {
    const store = this.bench.store;
    const rows = store.list({ status: this.reviewFilter === 'all' ? null : this.reviewFilter });
    const counts = Object.fromEntries(['pending', ...VERDICTS].map(s => [s, store.list({ status: s }).length]));
    this.roots.review.innerHTML = `
      <div class="rv-head">
        <div class="seg" role="radiogroup" aria-label="Show">${['pending', 'fits', 'close', 'wrong', 'all'].map(s => `<button type="button" role="radio" aria-checked="${s === this.reviewFilter}" data-rv="filter" data-value="${s}">${s}${s === 'all' ? '' : ` ${counts[s]}`}</button>`).join('')}</div>
        <button type="button" class="icon-btn" data-rv="export" ${counts.fits ? '' : 'disabled'} data-tip="Download every approved (“fits”) design as one bundle">${icon('download')} Approved</button>
      </div>
      ${rows.length ? '' : `<p class="empty">${this.reviewFilter === 'pending' ? 'Nothing waiting. Designs submitted from the Design tab (by you or an agent) land here for listening.' : 'Nothing with this verdict.'}</p>`}
      <ol class="rv-list">${rows.map(c => this.#card(c)).join('')}</ol>`;
  }

  #card(c) {
    const e = CATALOG_BY_ID[c.eventId], a = c.analysis || {}, cmp = c.comparison, blind = this.blind.get(c.id);
    return `<li class="rv-card" data-id="${c.id}">
      <div class="rv-title"><input class="rv-name" value="${esc(c.name)}" aria-label="Candidate name" data-tip="Rename"><span class="badge v-${c.status}">${c.status}</span></div>
      <p class="mono rv-sub">${esc(e?.label || c.eventId)} · rev ${c.revision} · by ${esc(c.by)} · ${esc(fmtDate(c.createdAt))}</p>
      ${c.rationale ? `<p class="rv-why">${esc(c.rationale)}</p>` : ''}
      <p class="mono rv-metrics">${a.silent ? 'silent' : `${fmt(a.durationMs, 'ms')} · peak ${fmt(a.peakDb, 'dB')} · ${fmt(a.centroidHz, 'Hz')}`}${cmp ? ` · vs game ${cmp.loudnessDiffDb > 0 ? '+' : ''}${cmp.loudnessDiffDb} dB, spectrum ${cmp.spectralDistanceDb} dB apart` : ''}</p>
      <div class="rv-listen">
        <button type="button" class="icon-btn primary" data-rv="play" data-mode="candidate" data-tip="Hear the design in the recorded scene">${icon('context')} Design</button>
        <button type="button" class="icon-btn" data-rv="play" data-mode="original" data-tip="Hear the same scene as the game sounds today">${icon('context')} Game</button>
        <button type="button" class="icon-btn" data-rv="stop" aria-label="Stop" data-tip="Stop">${icon('stop')}</button>
        <button type="button" data-rv="blind" data-tip="Listen to A and B without knowing which is the design, then pick one">Blind A/B</button>
        <button type="button" class="link" data-rv="open" data-tip="Load this version into the Design tab">open in designer</button>
      </div>
      ${blind ? `<div class="rv-blind">Blind test:
        <button type="button" class="icon-btn" data-rv="ab" data-letter="A">${icon('play')} A</button><button type="button" class="icon-btn" data-rv="ab" data-letter="B">${icon('play')} B</button>
        <span>prefer</span><button type="button" data-rv="prefer" data-letter="A" aria-pressed="${blind.preferred === 'A'}">A</button><button type="button" data-rv="prefer" data-letter="B" aria-pressed="${blind.preferred === 'B'}">B</button>
        ${blind.preferred ? `<span class="hint">you preferred ${blind.preferred}: ${blind.preferred === blind.candidate ? 'the design' : 'the game sound'}</span>` : ''}</div>` : ''}
      <div class="rv-verdict">
        <div class="rv-tags">${REVIEW_TAGS.map(t => `<label class="chip"><input type="checkbox" value="${esc(t)}">${esc(t)}</label>`).join('')}</div>
        <input type="text" class="rv-note" placeholder="Note for the designer (optional)">
        ${VERDICTS.map(v => `<button type="button" data-rv="verdict" data-verdict="${v}" class="v-${v}" data-tip="${v === 'fits' ? 'Approve: this sound fits the moment' : v === 'close' ? 'Nearly there: say what to change in tags or the note' : 'Does not fit'}">${v === 'fits' ? 'Fits' : v === 'close' ? 'Close' : 'Wrong'}</button>`).join('')}
      </div>
      ${c.reviews.length ? `<ul class="rv-history">${c.reviews.map(r => `<li><b>${r.verdict}</b> ${r.tags.map(esc).join(', ')}${r.note ? ` · ${esc(r.note)}` : ''}${r.blind ? ` · blind: preferred ${r.blind.preferredCandidate ? 'design' : 'game sound'}` : ''} <span class="mono">${esc(fmtDate(r.at))}</span></li>`).join('')}</ul>` : ''}
    </li>`;
  }

  #wireReview() {
    const r = this.roots.review;
    r.addEventListener('click', e => this.#onReviewClick(e));
    r.addEventListener('change', e => { if (e.target.classList.contains('rv-name')) this.#run(() => this.bench.renameCandidate(e.target.closest('.rv-card').dataset.id, e.target.value)); });
  }

  async #onReviewClick(e) {
    const btn = e.target.closest('button[data-rv]');
    if (!btn) return;
    const b = this.bench, card = btn.closest('.rv-card'), id = card?.dataset.id, act = btn.dataset.rv;
    await this.#run(async () => {
      if (act === 'filter') { this.reviewFilter = btn.dataset.value; this.renderReview(); }
      else if (act === 'export') download(new Blob([JSON.stringify(b.exportBundle(), null, 2)], { type: 'application/json' }), `soundlab-approved-${Date.now()}.json`);
      else if (act === 'play') await b.playCandidate(id, btn.dataset.mode);
      else if (act === 'stop') b.stop();
      else if (act === 'open') { b.openCandidate(id); this.hooks.selectTab('design'); }
      else if (act === 'blind') { this.blind.set(id, { candidate: Math.random() < 0.5 ? 'A' : 'B', preferred: null }); this.renderReview(); }
      else if (act === 'ab') { const bl = this.blind.get(id); await b.playCandidate(id, btn.dataset.letter === bl.candidate ? 'candidate' : 'original'); }
      else if (act === 'prefer') { this.blind.get(id).preferred = btn.dataset.letter; this.renderReview(); }
      else if (act === 'verdict') {
        const tags = [...card.querySelectorAll('.rv-tags input:checked')].map(i => i.value);
        const note = card.querySelector('.rv-note').value;
        const bl = this.blind.get(id);
        b.recordVerdict(id, btn.dataset.verdict, { tags, note, blind: bl?.preferred ? { preferred: bl.preferred, candidateWas: bl.candidate } : null });
        this.blind.delete(id);
        toast(`Marked “${b.store.get(id).name}” as ${btn.dataset.verdict}`);
      }
    });
  }
}

/* ---------- helpers ---------- */

function stageTip(stage) {
  const names = stage.events.map(id => CATALOG_BY_ID[id]?.label).filter(Boolean);
  return `${stage.id === 'move' ? 'Continuous, follows the recorded speed' : stage.id === 'start' ? 'Plays when the movement starts' : 'Plays when the movement ends'}${names.length ? ` · replaces ${names.join(', ')}` : ''}`;
}

/* A group's staged design: stage cards with their layers and the
 * transitions between them. */
function stagesSection(grp, d, samples, isOpen = () => false) {
  const tr = transitionsOf(d);
  const replaced = grp.stages.flatMap(st => st.events).map(id => CATALOG_BY_ID[id]?.label).filter(Boolean);
  const card = (st, n) => {
    const seg = STAGE_SEGMENT[st.id];
    const layers = d.layers.filter(l => l.segment === seg || (st.id === 'move' && l.segment === 'all'));
    return `<section class="stage-card" data-stage="${st.id}">
      <h5><span class="stage-n">${n}</span>${esc(st.label)} <span class="hint">${esc(stageTip(st))}</span></h5>
      ${st.id === 'move' ? movementControls(movementOf(d)) : ''}
      <div class="dz-layers">${layers.length ? layers.map(l => layerCard(l, samples, d.container.mode, isOpen(l.id))).join('') : '<p class="hint">Silent: add a layer, or make one in the Foley tab.</p>'}</div>
      <div class="dz-add">Add to this stage
        ${['foley', 'sample', 'tone', 'noise'].map(k => `<button type="button" data-act="add" data-kind="${k}" data-segment="${seg}" data-tip="Add a ${k} layer that plays in the ${esc(st.label.toLowerCase())} stage${st.id === 'stop' ? ' (for example a final clunk)' : ''}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}
        <button type="button" class="link" data-act="foley-stage" data-stage="${st.id}" data-tip="Generate this stage from the scene in the Foley tab">make in Foley tab</button></div>
    </section>`;
  };
  const transition = side => `<div class="transition" data-side="${side}">
      <label class="field" data-tip="${esc(TRANSITION_MODES[side][tr[side].mode])}">${side === 'in' ? 'Into the movement' : 'Into the stop'} <select data-tr="${side}" data-k="mode">${Object.entries(TRANSITION_MODES[side]).map(([k, help]) => `<option value="${k}" title="${esc(help)}" ${k === tr[side].mode ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
      <label class="pr" data-tip="${esc(TRANSITION_TIME[5])}"><span>Time</span><input type="range" min="${TRANSITION_TIME[0]}" max="${TRANSITION_TIME[1]}" step="10" value="${tr[side].timeMs}" data-tr="${side}" data-k="timeMs"><output>${fmt(tr[side].timeMs, 'ms')}</output></label>
      <p class="hint">${esc(TRANSITION_MODES[side][tr[side].mode])}</p></div>`;
  return `<details open class="stages"><summary>${esc(grp.label)} stages <span class="hint">one design for the whole movement</span></summary>
    <p class="hint">Plays along each recorded ${esc(grp.label.toLowerCase())} run and replaces ${esc(replaced.join(', '))} there. Use the “At” menu to pick which run you hear.</p>
    ${card(grp.stages[0], 1)}${transition('in')}${card(grp.stages[1], 2)}${transition('out')}${card(grp.stages[2], 3)}
  </details>`;
}

/* How the movement plays along the run: bites, a seamless loop or generated. */
const MOVEMENT_LABELS = { bites: 'Bites per distance', loop: 'Seamless loop', synth: 'Generated (preview only)' };
const MOVEMENT_KEYS = { bites: ['bitePx', 'variants', 'pitchFollow', 'refSpeed', 'xfadeMs'], loop: ['loopMs', 'pitchFollow', 'refSpeed', 'xfadeMs'], synth: [] };
function movementControls(m) {
  return `<div class="movement">
    <label class="field" data-tip="${esc(MOVEMENT_METHODS[m.method])}">Plays as <select data-mv="method">${Object.keys(MOVEMENT_METHODS).map(k => `<option value="${k}" title="${esc(MOVEMENT_METHODS[k])}" ${k === m.method ? 'selected' : ''}>${MOVEMENT_LABELS[k]}</option>`).join('')}</select></label>
    ${MOVEMENT_KEYS[m.method].map(k => { const html = slider(k, MOVEMENT_PARAMS[k], m[k], 'data-mv'); return k === 'refSpeed' && !m[k] ? html.replace(/<output>[^<]*<\/output>/, '<output>auto</output>') : html; }).join('')}
    <p class="hint">${esc(MOVEMENT_METHODS[m.method])}</p>
    <p class="hint mono" data-movement-metrics data-tip="Measured on this render. Seams: how much rougher the sound is at the joins than elsewhere (0 dB or less: no clicks)"></p></div>`;
}
export function movementFacts(m) {
  if (!m || m.method === 'synth') return '';
  const seam = m.seamDb == null ? '' : ` · seams ${m.seamDb > 0 ? '+' : ''}${m.seamDb} dB`;
  if (m.method === 'bites') return `${m.bites} bites of ${m.biteMs} ms made at ${m.refSpeed} px/s · brightness spread ${Math.round(m.brightnessSpread * 100)}%${seam}`;
  return `loop of ${m.loopMs} ms made at ${m.refSpeed} px/s · loop point match ${m.loopMatch}${seam}`;
}

/* Earshot through the authoring service, and every round of takes measured. */
function earshotSection(b) {
  const st = b.earshotStatus(), rounds = b.foleyRounds();
  const best = rounds.filter(r => r.bestMatch != null);
  const trend = r => { const prev = best[best.indexOf(r) - 1]; if (!prev || r.bestMatch == null) return ''; const d = Math.round((r.bestMatch - prev.bestMatch) * 100); return d ? ` <span class="${d > 0 ? 'ok' : 'warn'}">${d > 0 ? '+' : ''}${d}</span>` : ' ±0'; };
  return `<section class="fz-block">
    <h4>Earshot <span class="hint">optional generator</span></h4>
    ${st.available
      ? `<div class="fz-row"><button type="button" data-fact="earshot" data-tip="Four Earshot takes for this ${b.stagedGroup() ? 'stage' : 'event'}, about ${Math.round(b.earshotLength())} ms long${b.foley.reference ? ', measured against the reference' : ''}">${icon('variants')} Earshot takes</button>
         <span class="hint">${Math.round(b.earshotLength())} ms · refine a take to iterate</span></div>`
      : `<p class="hint">${esc(st.reason)}</p>`}
    ${rounds.length ? `<table class="rounds" data-tip="Objective measurements of each round; you judge which sounds better">
      <tr><th>#</th><th>From</th><th>Best match</th><th>Loudness</th><th>Brightness</th><th>Length</th></tr>
      ${rounds.slice(-8).map(r => `<tr><td>${r.n}</td><td>${r.source}${r.direction ? ` · ${esc(r.direction)}` : ''}${r.stage ? ` · ${r.stage}` : ''}</td><td>${r.bestMatch != null ? `${pct(r.bestMatch)} ${r.bestTake}${trend(r)}` : '–'}</td><td>${fmt(r.loudestDb, 'dB')}</td><td>${fmt(r.centroidHz, 'Hz')}</td><td>${fmt(r.durationMs, 'ms')}</td></tr>`).join('')}
    </table>` : ''}
  </section>`;
}

function emptyState() {
  return `<div class="empty-state"><p><b>Pick a sound to work on.</b></p><p>Choose an event in the list on the left, or select a marker on the timeline and press <b>Design this sound</b> in the inspector.</p></div>`;
}

function eventOptions(selected) {
  return FAMILIES.map(f => `<optgroup label="${f.label}">${CATALOG.filter(e => e.family === f.id).map(e => `<option value="${e.id}" ${e.id === selected ? 'selected' : ''}>${esc(e.label)}${e.status === 'needs-hook' ? ' (needs hook)' : ''}</option>`).join('')}</optgroup>`).join('');
}
function materialOptions(selected) { return Object.entries(MATERIALS).map(([k, m]) => `<option value="${k}" ${k === selected ? 'selected' : ''}>${m.label}</option>`).join(''); }
const pct = v => (v == null ? '–' : `${Math.round(v * 100)}%`);
function fmtDate(iso) { try { return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return iso; } }

function stepFor([min, max, , unit]) {
  if (unit === 'ms' || unit === 'Hz' || unit === 'cents' || unit === 'px/s' || max - min > 1000) return 1;
  if (unit === 'dB' || unit === 'st' || unit === 'dBFS') return 0.5;
  if (max - min <= 2) return 0.01;
  return 1;
}
function toLog(v, min, max) { return Math.round(1000 * Math.log(v / min) / Math.log(max / min)); }
function fromLog(p, min, max) { return min * Math.pow(max / min, p / 1000); }

export function slider(path, spec, value, attr = 'data-path') {
  const [min, max, , unit, label, help] = spec;
  const log = LOG_UNITS.has(unit);
  const attrs = log ? `min="0" max="1000" step="1" value="${toLog(value, min, max)}" data-log="1" data-min="${min}" data-max="${max}"` : `min="${min}" max="${max}" step="${stepFor(spec)}" value="${value}"`;
  return `<label class="pr"${help ? ` data-tip="${esc(help)}"` : ''}><span>${esc(label)}</span><input type="range" ${attrs} ${attr}="${path}" data-unit="${unit}"><output>${fmt(value, unit)}</output></label>`;
}

const GROUPS = [
  ['Level', ['gain', 'delay']],
  ['Pitch', ['pitch', 'pitchEnv', 'pitchEnvTime']],
  ['Envelope', ['attack', 'hold', 'decay', 'sustain', 'release', 'duration']],
  ['Filter', ['filterFreq', 'filterQ', 'filterEnv']],
  ['EQ & drive', ['eqLow', 'eqMid', 'eqHigh', 'drive']]
];

function layerCard(l, samples, mode, open = l.enabled) {
  const p = `layer:${l.id}`;
  const params = GROUPS.map(([title, keys]) => {
    const ks = keys.filter(k => !(l.filter === 'off' && k.startsWith('filter')));
    return ks.length ? `<fieldset><legend>${title}</legend>${ks.map(k => slider(`${p}.${k}`, PARAMS.layer[k], l[k])).join('')}</fieldset>` : '';
  }).join('');
  let kindFields;
  if (l.kind === 'sample') kindFields = `<label class="field grow">Sample <select data-path="${p}.source">${samples.map(s => `<option value="${s.type}|${esc(s.name)}" ${s.type === l.source.type && s.name === l.source.name ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select></label>
       ${slider(`${p}.start`, PARAMS.layer.start, l.start)}<label class="check"><input type="checkbox" data-path="${p}.reverse" ${l.reverse ? 'checked' : ''}> Reverse</label>`;
  else if (l.kind === 'foley') kindFields = `<span class="foley-sum">${esc(FOLEY_MODELS[l.foley.model].label)} · ${esc(MATERIALS[l.foley.material].label)} on ${esc(MATERIALS[l.foley.surface].label)}${l.foley.followMotion ? ' · follows motion' : ''}</span>
       <button type="button" data-act="edit-foley" data-tip="Shape this layer in the Foley tab">Edit in Foley tab</button>`;
  else if (l.kind === 'tone') kindFields = `<label class="field">Wave <select data-path="${p}.waveform">${WAVEFORMS.map(w => `<option ${w === l.waveform ? 'selected' : ''}>${w}</option>`).join('')}</select></label>${slider(`${p}.freq`, PARAMS.layer.freq, l.freq)}`;
  else kindFields = `<label class="field">Colour <select data-path="${p}.color">${NOISE_COLORS.map(w => `<option ${w === l.color ? 'selected' : ''}>${w}</option>`).join('')}</select></label>`;
  return `<details class="layer ${l.enabled ? '' : 'off'}" data-layer="${esc(l.id)}" ${open ? 'open' : ''}><summary><b>${esc(l.id)}</b> <span class="kind">${l.kind}</span>
      <label class="check" data-tip="Layer on/off"><input type="checkbox" data-path="${p}.enabled" ${l.enabled ? 'checked' : ''}> on</label>
      <label class="check" data-tip="Hear only soloed layers"><input type="checkbox" data-path="${p}.solo" ${l.solo ? 'checked' : ''}> solo</label>
      <button type="button" class="link" data-act="remove" data-layer="${esc(l.id)}" data-tip="Remove layer">remove</button></summary>
    <div class="layer-top">${kindFields}
      <label class="field">Filter <select data-path="${p}.filter">${FILTER_TYPES.map(f => `<option ${f === l.filter ? 'selected' : ''}>${f}</option>`).join('')}</select></label>
      ${mode === 'loop' ? `<label class="field" data-tip="Which loop segment this layer plays in">Plays on <select data-path="${p}.segment">${SEGMENTS.map(s => `<option ${s === l.segment ? 'selected' : ''}>${s}</option>`).join('')}</select></label>` : ''}
    </div>${params}</details>`;
}

function mappingRow(m, i, design) {
  const opt = (list, v) => list.map(x => `<option ${x === v ? 'selected' : ''}>${x}</option>`).join('');
  return `<div class="dz-map">
    <select data-map="${i}" data-k="source" aria-label="Game value">${Object.entries(MAPPING_SOURCES).map(([k, s]) => `<option value="${k}" ${k === m.source ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select>
    <input data-map="${i}" data-k="inMin" type="number" value="${m.inMin}" aria-label="input low"> → <input data-map="${i}" data-k="inMax" type="number" value="${m.inMax}" aria-label="input high">
    <select data-map="${i}" data-k="target" aria-label="Sound parameter">${opt(mappingTargets(design), m.target)}</select>
    <input data-map="${i}" data-k="outMin" type="number" value="${m.outMin}" aria-label="output at input low"> → <input data-map="${i}" data-k="outMax" type="number" value="${m.outMax}" aria-label="output at input high">
    <select data-map="${i}" data-k="curve" aria-label="Curve">${opt(CURVES, m.curve)}</select>
    <button type="button" class="link" data-act="del-map" data-index="${i}">remove</button></div>`;
}

export function pathPatch(path, value) {
  if (path === 'notes') return { notes: value };
  const [scope, key] = path.split('.');
  if (scope.startsWith('layer:')) {
    const id = scope.slice(6);
    if (key === 'source') { const [type, ...rest] = String(value).split('|'); return { layers: [{ id, source: { type, name: rest.join('|') } }] }; }
    return { layers: [{ id, [key]: value }] };
  }
  return { [scope]: { [key]: value } };
}

function drawViz(canvas, a, b) {
  const ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
  ctx.fillStyle = '#0d1117'; ctx.fillRect(0, 0, W, H);
  const visible = an => (an && !an.silent ? an.onsetMs + an.durationMs : 0);
  const totalMs = Math.max(visible(a), visible(b), 20) * 1.15;
  const half = H / 2;
  const lane = (an, y0, color, label) => {
    ctx.fillStyle = '#8b98a9'; ctx.font = '12px system-ui, sans-serif'; ctx.fillText(label, 8, y0 + 14);
    if (!an || an.silent) { ctx.fillText('silent', 8, y0 + 30); return; }
    const w = W * an.totalMs / totalMs;
    const spec = an.spectrogram || [], cols = spec.length, bins = spec[0]?.length || 0;
    for (let x = 0; x < cols; x++) for (let k = 0; k < bins; k++) {
      const t = Math.max(0, Math.min(1, (spec[x][k] + 90) / 80));
      if (t <= 0.02) continue;
      ctx.fillStyle = `rgba(${Math.round(80 + 175 * t)},${Math.round(60 + 120 * t * t)},${Math.round(160 * (1 - t))},${0.25 + 0.6 * t})`;
      ctx.fillRect(x * w / cols, y0 + half - (k + 1) * half / bins, Math.ceil(w / cols), Math.ceil(half / bins));
    }
    ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.beginPath();
    an.waveform.forEach(([lo, hi], i) => { const x = i * w / an.waveform.length; ctx.moveTo(x, y0 + half / 2 - hi * half / 2); ctx.lineTo(x, y0 + half / 2 - lo * half / 2); });
    ctx.stroke();
  };
  lane(a, 0, '#f0b443', 'Design');
  ctx.fillStyle = '#2a3340'; ctx.fillRect(0, half - 0.5, W, 1);
  lane(b, half, '#5b9be0', 'Game sound');
  ctx.fillStyle = '#8b98a9'; ctx.fillText(`${Math.round(totalMs)} ms`, W - 64, H - 6);
}

function drawWave(canvas, data) {
  if (!canvas || !data) return;
  const ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = '#f0b443'; ctx.beginPath();
  const step = Math.max(1, Math.floor(data.length / W));
  for (let x = 0; x < W; x++) {
    let lo = 0, hi = 0;
    for (let i = x * step; i < Math.min(data.length, (x + 1) * step); i++) { lo = Math.min(lo, data[i]); hi = Math.max(hi, data[i]); }
    ctx.moveTo(x + 0.5, H / 2 - hi * H / 2); ctx.lineTo(x + 0.5, H / 2 - lo * H / 2);
  }
  ctx.stroke();
}

function drawSpeed(canvas, trace) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const max = Math.max(...trace, 1);
  ctx.fillStyle = 'rgba(91,155,224,.18)'; ctx.strokeStyle = '#5b9be0'; ctx.beginPath(); ctx.moveTo(0, H);
  trace.forEach((v, i) => ctx.lineTo(i * W / Math.max(1, trace.length - 1), H - 4 - v / max * (H - 14)));
  ctx.lineTo(W, H); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#8b98a9'; ctx.font = '11px system-ui, sans-serif';
  ctx.fillText(`speed · peak ${Math.round(max)} px/s · ${(trace.length / FRAME_HZ).toFixed(1)} s`, 6, 12);
}

function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function safeLocalStorage() { try { const s = globalThis.localStorage; s.getItem('x'); return s; } catch { return undefined; } }
