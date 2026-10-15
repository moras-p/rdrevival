import { describeAiPhaseGuard } from './ai-coach.js';
import { ViewportModel } from '../level-editor/domain/viewport-model.js';
import { CanonicalLevelEditorRoomRenderer } from '../level-editor/rendering/canonical-room-renderer.js';
import { drawPixelBuffer } from '../level-editor/rendering/pixel-canvas-renderer.js';
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const ICONS = {
  mortal:'<path d="M12 21s-8-5-8-11a4 4 0 0 1 8-2 4 4 0 0 1 8 2c0 6-8 11-8 11Z"/>',
  immortal:'<path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6Z"/><path d="m8 12 3 3 5-6"/>',
  record:'<circle cx="12" cy="12" r="7" fill="currentColor" stroke="none"/>',
  stop:'<rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" stroke="none"/>',
  export:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  copy:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
  generate:'<path d="M3 11a9 9 0 1 1 2.7 7M3 4v7h7"/>',
  play:'<path d="m8 4 12 8-12 8Z" fill="currentColor" stroke="none"/>',
  pause:'<path d="M7 4v16M17 4v16" stroke-width="4"/>',
  check:'<path d="m4 12 5 5L20 6"/>'
};

function setIconButton(button, icon, label) {
  // Preserve the pointer target between down/up while recording updates each frame.
  if (button.dataset.icon !== icon) {
    button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[icon]}</svg>`;
    button.dataset.icon = icon;
  }
  if (button.title !== label) button.title = label;
  if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label);
}

function routeStatusLabel(plan) {
  if (plan?.complete) return 'Complete certificate';
  if (plan?.partial) return 'Certified prefix';
  if (plan?.blocker) return 'Blocked';
  return plan?.edges?.length ? 'Route available' : 'Waiting for plan';
}

function nearestStep(steps, position) {
  if (!steps?.length || !position) return 0;
  let best = 0;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < steps.length; index += 1) {
    const point = steps[index]?.point || {};
    const dx = finite(point.x) - finite(position.x);
    const dy = finite(point.y) - finite(position.y);
    const candidate = dx * dx + dy * dy * 1.5;
    if (candidate < distance) { distance = candidate; best = index; }
  }
  return best;
}

export function gaiRouteProgressIndex(plan, position) {
  if (!plan?.steps?.length || !position) return null;
  const planSubmap = Number(plan.submap);
  const progressSubmap = Number(position.submap);
  if (Number.isFinite(planSubmap) && Number.isFinite(progressSubmap) &&
      planSubmap !== progressSubmap) return null;
  return nearestStep(plan.steps, position);
}

function setCanvasSize(canvas, viewport, { fallbackWidth, fallbackHeight }) {
  const rect = canvas.getBoundingClientRect();
  const cssWidth = Math.max(1, Math.round(rect.width || fallbackWidth));
  const cssHeight = Math.max(1, Math.round(rect.height || fallbackHeight));
  const devicePixelRatio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const metrics = viewport.resize({ cssWidth, cssHeight, devicePixelRatio });
  if (canvas.width !== metrics.backingWidth) canvas.width = metrics.backingWidth;
  if (canvas.height !== metrics.backingHeight) canvas.height = metrics.backingHeight;
  return metrics;
}

function drawRouteOverlay(context, viewport, steps, index) {
  const selected = steps[index];
  if (!selected?.point) return;
  // Only draw the witness explicitly attached to this inspection point.
  // Adjacent proof records are not a continuous executable route.
  const neighboring = selected.sourceIndex != null ? [steps[selected.sourceIndex], selected]
    : selected.targetIndex != null ? [selected, steps[selected.targetIndex]] : [selected];
  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (let pair = 1; pair < neighboring.length; pair += 1) {
    const from = neighboring[pair - 1];
    const to = neighboring[pair];
    const a = viewport.worldToScreen(from.point.x, from.point.y);
    const b = viewport.worldToScreen(to.point.x, to.point.y);
    context.strokeStyle = to.blocked ? '#ff6b57' : '#6ee7ff';
    context.lineWidth = 3;
    context.setLineDash(to.blocked ? [7, 5] : []);
    context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke();
  }
  const point = viewport.worldToScreen(selected.point.x, selected.point.y);
  context.setLineDash([]);
  context.fillStyle = selected.blocked ? '#ff5c49' : '#ffd86b';
  context.strokeStyle = '#071018';
  context.lineWidth = 3;
  context.beginPath(); context.arc(point.x, point.y, selected.blocked ? 8 : 7, 0, Math.PI * 2); context.fill(); context.stroke();
  context.fillStyle = '#071018';
  context.font = '800 9px ui-monospace, monospace';
  context.textAlign = 'center'; context.textBaseline = 'middle';
  context.fillText(String(index), point.x, point.y + .5);
  context.restore();
}

export class GaiRouteInspector {
  constructor({ root, resourcesProvider, roomRenderer = null, onRecordManual = null, onExportEvidence = null,
    onGeneratePlan = null, onTogglePlayback = null, onToggleMortality = null,
    onCacheToggle = null, onConnectCacheFolder = null, onExportReplayCache = null } = {}) {
    if (!root) throw new TypeError('GaiRouteInspector requires a root element');
    this.root = root;
    this.roomRenderer = roomRenderer || new CanonicalLevelEditorRoomRenderer({ resourcesProvider });
    this.framePromises = new Map();
    this.roomFrame = null;
    this.plan = null;
    this.selectedIndex = 0;
    this.currentIndex = 0;
    this.loadGeneration = 0;
    this.renderFrame = 0;
    this.statusText = '';
    this.root.classList.add('gai-route-inspector');
    this.root.hidden = false;
    this.root.innerHTML = `
      <div class="gai-route-header">
        <div>
          <div class="gai-route-title-row">
            <h2>Current certificate</h2>
            <span class="gai-route-badge" data-route-status>Waiting for plan</span>
          </div>
        </div>
        <div class="gai-route-actions">
          <label class="gai-route-cache-switch" title="OFF by default. ON skips fresh native planning when an exact successful room replay exists; do not enable during GAI regression testing."><input type="checkbox" data-route-cache-toggle autocomplete="off"> Reuse</label>
          <button type="button" data-route-cache-folder title="Connect this repository folder; completed fresh room runs will automatically update the tracked replay JSON file">📁</button>
          <button type="button" data-route-cache-export title="Download all completed replay data as room-replays.json for committing">↓</button>
          <button type="button" data-route-mortality></button>
          <button type="button" data-route-generate disabled></button>
          <button type="button" data-route-playback hidden></button>
          <button type="button" data-route-record>Record manual walkthrough</button>
          <button type="button" data-route-export disabled>Export walkthrough + GAI JSON</button>
          <button type="button" data-route-copy disabled>Copy route JSON</button>
        </div>
      </div>
      <p class="gai-route-cache-message" data-route-cache-message aria-live="polite">Replay reuse OFF · successful fresh runs can be committed via the repository folder button.</p>
      <details class="gai-route-analysis" data-route-analysis>
        <summary>GAI walkthrough analysis</summary>
        <p class="gai-route-provenance">Effective RDX · canonical Level Editor ResolvedLevel + PreviewRenderer pipeline</p>
      <p class="gai-route-provenance" data-route-recording-status>Record any partial manual run, then export here. No room completion required. Export before reloading this page.</p>
      <section data-route-execution hidden aria-label="Executed walkthrough">
        <h3>Executed walkthrough</h3>
        <p data-route-execution-status></p>
        <details><summary>Executed input runs</summary><ol data-route-executed-inputs></ol></details>
        <details><summary>Executed node traversal</summary><ol data-route-executed-nodes></ol></details>
      </section>
      <div class="gai-route-summary" data-route-summary></div>
      <details class="gai-route-program" data-route-program hidden>
        <summary data-route-program-title>Executable input program</summary>
        <ol data-route-phases></ol>
      </details>
      <div class="gai-route-empty" data-route-empty>Generate a GAI certificate to inspect its input phases, proof records and blocker here.</div>
      <div class="gai-route-node-strip" data-route-nodes role="list" aria-label="Initial position, independent proof records and blocker" hidden></div>
      <div class="gai-route-detail" data-route-detail hidden>
        <div class="gai-route-detail-map">
          <canvas data-route-detail-canvas width="640" height="360" aria-label="Selected GAI route node rendered with Level Editor map layers"></canvas>
          <span class="gai-route-map-label">REAL MAP RENDER</span>
        </div>
        <div class="gai-route-detail-copy">
          <h3 data-route-detail-title>Node</h3>
          <p data-route-detail-action></p>
          <dl data-route-detail-fields></dl>
        </div>
      </div>
      </details>`;
    this.ui = {
      badge:root.querySelector('[data-route-status]'),
      summary:root.querySelector('[data-route-summary]'),
      execution:root.querySelector('[data-route-execution]'),
      executionStatus:root.querySelector('[data-route-execution-status]'),
      executedInputs:root.querySelector('[data-route-executed-inputs]'),
      executedNodes:root.querySelector('[data-route-executed-nodes]'),
      program:root.querySelector('[data-route-program]'),
      programTitle:root.querySelector('[data-route-program-title]'),
      phases:root.querySelector('[data-route-phases]'),
      empty:root.querySelector('[data-route-empty]'),
      nodes:root.querySelector('[data-route-nodes]'),
      detail:root.querySelector('[data-route-detail]'),
      detailCanvas:root.querySelector('[data-route-detail-canvas]'),
      detailTitle:root.querySelector('[data-route-detail-title]'),
      detailAction:root.querySelector('[data-route-detail-action]'),
      detailFields:root.querySelector('[data-route-detail-fields]'),
      copy:root.querySelector('[data-route-copy]'),
      record:root.querySelector('[data-route-record]'),
      export:root.querySelector('[data-route-export]'),
      recordingStatus:root.querySelector('[data-route-recording-status]')
    };
    this.ui.cacheToggle = root.querySelector('[data-route-cache-toggle]');
    this.ui.cacheFolder = root.querySelector('[data-route-cache-folder]');
    this.ui.cacheExport = root.querySelector('[data-route-cache-export]');
    this.ui.cacheMessage = root.querySelector('[data-route-cache-message]');
    this.ui.cacheToggle.checked = false;
    this.ui.cacheToggle.addEventListener('change', () => onCacheToggle?.(this.ui.cacheToggle.checked));
    this.ui.cacheFolder.addEventListener('click', () => void onConnectCacheFolder?.());
    this.ui.cacheExport.addEventListener('click', () => void onExportReplayCache?.());
    this.ui.mortality = root.querySelector('[data-route-mortality]');
    setIconButton(this.ui.mortality, 'mortal', 'Mortal GAI run — switch to immortal');
    this.ui.generate = root.querySelector('[data-route-generate]');
    this.ui.playback = root.querySelector('[data-route-playback]');
    setIconButton(this.ui.generate, 'generate', 'Generate plan from initial map state');
    setIconButton(this.ui.playback, 'play', 'Play certified plan');
    setIconButton(this.ui.record, 'record', 'Record manual walkthrough');
    setIconButton(this.ui.export, 'export', 'Export walkthrough + GAI JSON');
    setIconButton(this.ui.copy, 'copy', 'Copy route JSON');
    this.ui.nodes.addEventListener('click', event => {
      const button = event.target.closest('[data-route-step]');
      if (!button) return;
      this.select(Number(button.dataset.routeStep) | 0, { scroll:false });
    });
    this.ui.copy.addEventListener('click', () => void this.copyPlan());
    this.ui.record.hidden = !onRecordManual;
    this.ui.export.hidden = !onExportEvidence;
    this.ui.record.addEventListener('click', () => onRecordManual?.());
    this.ui.export.addEventListener('click', () => onExportEvidence?.());
    this.ui.mortality.hidden = !onToggleMortality;
    this.ui.mortality.addEventListener('click', () => onToggleMortality?.());
    this.ui.generate.hidden = !onGeneratePlan;
    this.ui.generate.addEventListener('click', () => void onGeneratePlan?.());
    this.ui.playback.addEventListener('click', () => onTogglePlayback?.());
    this.resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.scheduleSelectedRender()) : null;
    this.resizeObserver?.observe(this.ui.detail);
    this.renderEmpty();
  }

  showCachedReplay(frames) {
    this.root.dataset.kind = 'empty';
    this.ui.badge.textContent = 'Cached input replay · no new proof';
    this.ui.empty.textContent = `${frames} saved input frames available. Native GAI planning was SKIPPED. Press Play to replay; disable Reuse for regression testing.`;
  }

  updateCache({ enabled = false, disabled = false, connected = false, message = '' } = {}) {
    this.ui.cacheToggle.checked = !!enabled;
    this.ui.cacheToggle.disabled = disabled;
    this.ui.cacheFolder.title = connected ? 'Repository connected · successful room runs auto-save to Git-tracked JSON' : 'Choose repository root for automatic recording to the tracked JSON';
    if (message) this.ui.cacheMessage.textContent = message;
  }

  updateEvidence({ active = false, samples = 0, hasManual = false, hasPlan = false, execution = null, message = '' } = {}) {
    setIconButton(this.ui.record, active ? 'stop' : 'record', active ? 'Stop manual recording' : hasManual ? 'Record new manual walkthrough' : 'Record manual walkthrough');
    this.ui.record.setAttribute('aria-pressed', String(active));
    this.ui.export.disabled = !(hasManual || hasPlan || execution);
    this.ui.execution.hidden = !execution;
    if (execution) {
      this.ui.executionStatus.textContent = `${execution.completion} · ${execution.frames} native frames · ${execution.skippedFrames} missing observations` +
        (execution.roomExit ? ` · SM${execution.roomExit.from.toString(16).padStart(2,'0')} → SM${execution.roomExit.to.toString(16).padStart(2,'0')}` : '');
      for (const [list, rows, describe] of [
        [this.ui.executedInputs, execution.inputRuns, run => `${run.controls.join(' + ') || 'neutral'} · frames ${run.firstFrame}–${run.lastFrame} · ${run.from?.join(',')} → ${run.to?.join(',')}`],
        [this.ui.executedNodes, execution.nodeTraversal, node => `${node.nodeId == null ? 'Support' : `N${node.nodeId}`} · support ${node.supportId} · frame ${node.frameSerial} · ${node.position?.join(',')}`]
      ]) {
        list.replaceChildren();
        for (const row of rows) { const li = document.createElement('li'); li.textContent = describe(row); list.append(li); }
      }
    }
    this.ui.recordingStatus.textContent = message || (hasManual
      ? `${active ? 'Recording' : 'Retained partial manual run'} · ${samples} observed frames. Export now; starting AI keeps this recording. A new manual recording replaces it.`
      : 'Record any partial manual run, then export here. No room completion required. Export before reloading this page.');
  }

  updatePlayback({ available = false, planning = false, ready = false, partial = false, cached = false, playing = false, paused = false, immortal = false } = {}) {
    setIconButton(this.ui.mortality, immortal ? 'immortal' : 'mortal', immortal ? 'Immortal GAI run — switch to mortal' : 'Mortal GAI run — switch to immortal');
    this.ui.mortality.setAttribute('aria-pressed', String(immortal));
    this.ui.mortality.disabled = !available || planning || playing;
    this.ui.generate.disabled = !available || planning;
    this.ui.generate.setAttribute('aria-busy', String(planning));
    this.ui.playback.hidden = !(ready || cached || playing || paused) || planning;
    this.ui.playback.disabled = !available;
    setIconButton(this.ui.playback, playing ? 'pause' : 'play', playing ? 'Pause GAI playback' : paused ? 'Resume GAI playback' : cached ? 'Play cached inputs (native planner SKIPPED)' : partial ? 'Play certified partial' : 'Play certified plan');
    this.ui.playback.setAttribute('aria-pressed', String(playing));
  }

  async frameForSubmap(submap) {
    const key = Number(submap) >>> 0;
    if (!this.framePromises.has(key)) {
      this.framePromises.set(key, Promise.resolve().then(() => this.roomRenderer.frameForSubmap(key)).catch(error => {
        this.framePromises.delete(key);
        throw error;
      }));
    }
    return this.framePromises.get(key);
  }

  async updatePlan(plan, { statusText = '' } = {}) {
    this.plan = plan || null;
    this.statusText = String(statusText || '');
    const generation = ++this.loadGeneration;
    this.roomFrame = null;
    if (!plan?.steps?.length || plan.submap == null) {
      this.renderEmpty(plan);
      return;
    }
    this.currentIndex = nearestStep(plan.steps, plan.capturedPlayer);
    this.selectedIndex = this.currentIndex;
    this.renderPlanShell();
    try {
      const roomFrame = await this.frameForSubmap(plan.submap);
      if (generation !== this.loadGeneration || this.plan !== plan) return;
      this.roomFrame = roomFrame;
      this.renderAllMaps();
    } catch (error) {
      if (generation !== this.loadGeneration) return;
      this.ui.empty.hidden = false;
      this.ui.empty.textContent = `Route exists, but the Level Editor map render could not load: ${error?.message || error}`;
      this.root.dataset.kind = 'error';
    }
  }

  updateProgress({ x, y, submap, statusText = '' } = {}) {
    if (statusText) this.statusText = String(statusText);
    const next = gaiRouteProgressIndex(this.plan, { x, y, submap });
    if (next == null) return;
    if (next === this.currentIndex) return;
    this.currentIndex = next;
    for (const button of this.ui.nodes.querySelectorAll('[data-route-step]')) {
      button.classList.toggle('is-current', Number(button.dataset.routeStep) === next);
    }
  }

  clear() {
    this.plan = null;
    this.roomFrame = null;
    this.loadGeneration += 1;
    this.renderEmpty();
  }

  renderEmpty(plan = null) {
    this.root.dataset.kind = 'empty';
    this.ui.badge.textContent = routeStatusLabel(plan);
    this.ui.summary.replaceChildren();
    this.ui.nodes.replaceChildren();
    this.ui.program.hidden = true;
    this.ui.phases.replaceChildren();
    this.ui.nodes.hidden = true;
    this.ui.detail.hidden = true;
    this.ui.empty.hidden = false;
    this.ui.empty.textContent = plan?.blocker
      ? `GAI reported ${plan.blocker.kindLabel} ${plan.blocker.from}→${plan.blocker.to}, but this WASM build does not expose route-node coordinates.`
      : 'Generate a GAI certificate to inspect its input phases, proof records and blocker here.';
    this.ui.copy.disabled = !plan;
  }

  renderPlanShell() {
    const plan = this.plan;
    this.root.dataset.kind = plan.blocker ? 'blocked' : plan.complete ? 'complete' : 'route';
    this.ui.badge.textContent = routeStatusLabel(plan);
    this.ui.summary.replaceChildren();
    const summary = [
      plan.room || `SM${String(plan.submap).padStart(2, '0')}`,
      `${plan.proofRecordCount ?? plan.certifiedEdgeCount} proof records · ${plan.uniqueProofRecordCount ?? plan.certifiedEdgeCount} distinct`,
      `${plan.phaseCount} executable phases`,
      plan.blocker ? `blocker: ${plan.blocker.kindLabel} ${plan.blocker.from}→${plan.blocker.to}` : null
    ].filter(Boolean);
    for (const value of summary) {
      const span = document.createElement('span'); span.textContent = value; this.ui.summary.append(span);
    }
    this.ui.program.hidden = !plan.certificateProgram?.phases?.length;
    this.ui.program.open = plan.phaseCount <= 8;
    this.ui.programTitle.textContent = `Planned input runs · ${plan.phaseCount} phases`;
    this.ui.phases.replaceChildren();
    for (const phase of plan.certificateProgram?.phases || []) {
      const li = document.createElement('li');
      const guards = phase.guards.map(guard => describeAiPhaseGuard(guard, plan.steps.map(step => step.support))).join(' and ');
      li.textContent = `${phase.controls.join(' + ') || 'neutral'} → ${guards || 'native phase boundary'} · watchdog ${phase.watchdogFrames} frames`;
      this.ui.phases.append(li);
    }
    this.ui.empty.hidden = true;
    this.ui.nodes.hidden = false;
    this.ui.detail.hidden = false;
    this.ui.copy.disabled = false;
    this.ui.nodes.replaceChildren();
    for (const step of plan.steps) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'gai-route-node';
      button.dataset.routeStep = String(step.index);
      button.dataset.blocked = step.blocked ? 'true' : 'false';
      button.setAttribute('aria-label', `${step.role || 'Inspection point'}, node ${step.nodeId}${step.incoming ? `, ${step.incoming.kindLabel}` : ''}`);
      button.classList.toggle('is-selected', step.index === this.selectedIndex);
      button.classList.toggle('is-current', step.index === this.currentIndex);
      const canvas = document.createElement('canvas');
      canvas.width = 320; canvas.height = 180;
      canvas.setAttribute('aria-hidden', 'true');
      const meta = document.createElement('span'); meta.className = 'gai-route-node-meta';
      const label = document.createElement('strong'); label.textContent = `N${step.nodeId}`;
      const coordinate = document.createElement('small'); coordinate.textContent = `${Math.round(step.point.x)}, ${Math.round(step.point.y)}`;
      meta.append(label, coordinate);
      const action = document.createElement('span'); action.className = 'gai-route-node-action';
      action.textContent = step.role === 'initial' ? 'INITIAL STATE'
        : step.role === 'blocker-source' ? 'BLOCKER SOURCE'
        : step.role === 'proof-source' ? `PROOF ${step.recordIndex + 1} SOURCE${step.repetitions > 1 ? ` · ×${step.repetitions}` : ''}`
        : `${step.blocked ? '× unresolved' : '→ proved'} ${step.incoming?.kindLabel || ''}${step.repetitions > 1 ? ` · ×${step.repetitions}` : ''}`;
      button.append(canvas, meta, action);
      this.ui.nodes.append(button);
    }
    this.renderSelectedDetails();
  }

  select(index, { scroll = true } = {}) {
    if (!this.plan?.steps?.length) return;
    this.selectedIndex = Math.max(0, Math.min(this.plan.steps.length - 1, Number(index) | 0));
    for (const button of this.ui.nodes.querySelectorAll('[data-route-step]')) {
      const selected = Number(button.dataset.routeStep) === this.selectedIndex;
      button.classList.toggle('is-selected', selected);
      if (selected && scroll) button.scrollIntoView({ block:'nearest', inline:'center', behavior:'smooth' });
    }
    this.renderSelectedDetails();
  }

  renderSelectedDetails() {
    const step = this.plan?.steps?.[this.selectedIndex];
    if (!step) return;
    const edge = step.incoming;
    this.ui.detailTitle.textContent = `Node ${step.nodeId} · inspection point ${step.index + 1}/${this.plan.steps.length}`;
    this.ui.detailAction.textContent = edge
      ? `${edge.certified ? 'Proved witness' : 'Unresolved blocker'}: ${edge.kindLabel} ${edge.from}→${edge.to}. Proof records do not imply route continuity.`
      : step.role === 'initial' ? 'Canonical native initial position'
      : step.role === 'blocker-source' ? 'Unresolved blocker source'
      : `Independent proof record ${step.recordIndex + 1} source; ${step.repetitions} recorded occurrence(s)`;
    const fields = [
      ['World position', `${Math.round(step.point.x)}, ${Math.round(step.point.y)} px`],
      ['Support', step.support ? `#${step.support.index} · x ${step.support.x0}–${step.support.x1} · y ${step.support.y}` : 'synthetic exit/goal'],
      ['Proof frames', edge?.frames ?? '—'],
      ['Resources', edge ? `${edge.bombs || 0} dynamite · ${edge.bullets || 0} bullets` : '—'],
      ['Hazard evidence', edge ? `${edge.hazardContacts || 0} contacts · ${edge.deathEpisodes || 0} death episodes` : '—'],
      ['Wait program', edge ? `${edge.safeWaitFrames || 0} safe · ${edge.activationWaitFrames || 0} activation · ${edge.timingSafeWindowFrames || 0} window` : '—'],
      ['Mechanism', edge?.demolitionOnly ? 'demolition-only checkpoint' : edge?.observedActivationActorId ? `actor ${edge.observedActivationActorId}` : edge?.observedActivationPlatform ? 'platform activation observed' : '—']
    ];
    this.ui.detailFields.replaceChildren();
    for (const [name, value] of fields) {
      const dt = document.createElement('dt'); dt.textContent = name;
      const dd = document.createElement('dd'); dd.textContent = String(value);
      this.ui.detailFields.append(dt, dd);
    }
    this.scheduleSelectedRender();
  }

  scheduleSelectedRender() {
    cancelAnimationFrame(this.renderFrame);
    this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = 0;
      if (!this.roomFrame || !this.plan) return;
      this.renderMap(this.ui.detailCanvas, this.selectedIndex, true);
    });
  }

  renderAllMaps() {
    if (!this.roomFrame || !this.plan) return;
    const canvases = this.ui.nodes.querySelectorAll('canvas');
    canvases.forEach((canvas, index) => this.renderMap(canvas, index, false));
    this.renderSelectedDetails();
  }

  renderMap(canvas, index, detailed) {
    const step = this.plan?.steps?.[index];
    if (!canvas || !step || !this.roomFrame) return;
    const viewport = new ViewportModel({ zoom:detailed ? 1.35 : 1, minZoom:.25, maxZoom:4 });
    const metrics = setCanvasSize(canvas, viewport, detailed
      ? { fallbackWidth:560, fallbackHeight:300 }
      : { fallbackWidth:190, fallbackHeight:108 });
    viewport.centerOn(step.point.x, step.point.y - metrics.cssHeight * .17 / viewport.zoom);
    const context = canvas.getContext('2d');
    context.setTransform(metrics.devicePixelRatio, 0, 0, metrics.devicePixelRatio, 0, 0);
    context.imageSmoothingEnabled = false;
    context.fillStyle = '#020407'; context.fillRect(0, 0, metrics.cssWidth, metrics.cssHeight);
    drawPixelBuffer(context, viewport, this.roomFrame.background, 0, 0);
    drawPixelBuffer(context, viewport, this.roomFrame.actors, 0, 0);
    drawPixelBuffer(context, viewport, this.roomFrame.foreground, 0, 0);
    drawPixelBuffer(context, viewport, this.roomFrame.frontActors, 0, 0);
    drawRouteOverlay(context, viewport, this.plan.steps, index);
  }

  async copyPlan() {
    if (!this.plan) return;
    const text = JSON.stringify(this.plan, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setIconButton(this.ui.copy, 'check', 'Route JSON copied');
      setTimeout(() => setIconButton(this.ui.copy, 'copy', 'Copy route JSON'), 1200);
    } catch (_) {
      setIconButton(this.ui.copy, 'copy', 'Copy failed; use Export walkthrough + GAI JSON');
    }
  }
}
