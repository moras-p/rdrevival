import { ViewportModel } from '../level-editor/domain/viewport-model.js';
import { CanonicalLevelEditorRoomRenderer } from '../level-editor/rendering/canonical-room-renderer.js';
import { drawPixelBuffer } from '../level-editor/rendering/pixel-canvas-renderer.js';
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

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
  const neighboring = [steps[index - 1], selected, steps[index + 1]].filter(Boolean);
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
  constructor({ root, resourcesProvider, roomRenderer = null } = {}) {
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
          <p class="gai-route-eyebrow">GAI walkthrough analysis</p>
          <div class="gai-route-title-row">
            <h2>Current route plan</h2>
            <span class="gai-route-badge" data-route-status>Waiting for plan</span>
          </div>
          <p class="gai-route-provenance">Effective RDX · canonical Level Editor ResolvedLevel + PreviewRenderer pipeline</p>
        </div>
        <div class="gai-route-actions">
          <button type="button" data-route-copy disabled>Copy route JSON</button>
        </div>
      </div>
      <div class="gai-route-summary" data-route-summary></div>
      <div class="gai-route-empty" data-route-empty>Run GAI to display its certified route nodes and blocker here.</div>
      <div class="gai-route-node-strip" data-route-nodes role="list" aria-label="GAI route nodes" hidden></div>
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
      </div>`;
    this.ui = {
      badge:root.querySelector('[data-route-status]'),
      summary:root.querySelector('[data-route-summary]'),
      empty:root.querySelector('[data-route-empty]'),
      nodes:root.querySelector('[data-route-nodes]'),
      detail:root.querySelector('[data-route-detail]'),
      detailCanvas:root.querySelector('[data-route-detail-canvas]'),
      detailTitle:root.querySelector('[data-route-detail-title]'),
      detailAction:root.querySelector('[data-route-detail-action]'),
      detailFields:root.querySelector('[data-route-detail-fields]'),
      copy:root.querySelector('[data-route-copy]')
    };
    this.ui.nodes.addEventListener('click', event => {
      const button = event.target.closest('[data-route-step]');
      if (!button) return;
      this.select(Number(button.dataset.routeStep) | 0, { scroll:false });
    });
    this.ui.copy.addEventListener('click', () => void this.copyPlan());
    this.resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.scheduleSelectedRender()) : null;
    this.resizeObserver?.observe(this.ui.detail);
    this.renderEmpty();
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
    this.ui.nodes.hidden = true;
    this.ui.detail.hidden = true;
    this.ui.empty.hidden = false;
    this.ui.empty.textContent = plan?.blocker
      ? `GAI reported ${plan.blocker.kindLabel} ${plan.blocker.from}→${plan.blocker.to}, but this WASM build does not expose route-node coordinates.`
      : 'Run GAI to display its certified route nodes and blocker here.';
    this.ui.copy.disabled = !plan;
  }

  renderPlanShell() {
    const plan = this.plan;
    this.root.dataset.kind = plan.blocker ? 'blocked' : plan.complete ? 'complete' : 'route';
    this.ui.badge.textContent = routeStatusLabel(plan);
    this.ui.summary.replaceChildren();
    const summary = [
      plan.room || `SM${String(plan.submap).padStart(2, '0')}`,
      `${plan.certifiedEdgeCount} certified edges`,
      `${plan.phaseCount} phases`,
      plan.blocker ? `blocker: ${plan.blocker.kindLabel} ${plan.blocker.from}→${plan.blocker.to}` : null
    ].filter(Boolean);
    for (const value of summary) {
      const span = document.createElement('span'); span.textContent = value; this.ui.summary.append(span);
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
      button.setAttribute('aria-label', `Route step ${step.index + 1}, node ${step.nodeId}${step.incoming ? `, ${step.incoming.kindLabel}` : ''}`);
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
      action.textContent = step.incoming
        ? `${step.incoming.certified ? '→' : '×'} ${step.incoming.kindLabel}`
        : step.index ? 'BLOCKER SOURCE' : 'START';
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
    this.ui.detailTitle.textContent = `Node ${step.nodeId} · step ${step.index + 1}/${this.plan.steps.length}`;
    this.ui.detailAction.textContent = edge
      ? `${edge.certified ? 'Certified' : 'Unresolved'} ${edge.kindLabel} from node ${edge.from} to ${edge.to}`
      : 'Native route start position';
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
      const previous = this.ui.copy.textContent;
      this.ui.copy.textContent = 'Copied';
      setTimeout(() => { this.ui.copy.textContent = previous; }, 1200);
    } catch (_) {
      console.info('[rdx/gai-route-inspector]', text);
      this.ui.copy.textContent = 'Written to console';
    }
  }
}
