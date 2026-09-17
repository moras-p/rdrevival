import { PreviewClock } from './preview-clock.js';
import { diagnosticSelectable } from './preview-elements.js';

function putBuffer(context, buffer, dirty = null) {
  const image = new ImageData(buffer.data, buffer.width, buffer.height);
  if (dirty) context.putImageData(image, 0, 0, dirty.x, dirty.y, dirty.width, dirty.height);
  else context.putImageData(image, 0, 0);
}

/** UI controller for the whole-map viewer. It never mutates the live C core,
 * but RDX actor identity, PN, flip, layer and exact placement come from the
 * compiled production C presentation trace. */
export class LevelPreview {
  constructor(options) {
    this.renderer = options.renderer;
    this.backgroundCanvas = options.backgroundCanvas;
    this.actorCanvas = options.actorCanvas;
    this.foregroundCanvas = options.foregroundCanvas;
    this.frontActorCanvas = options.frontActorCanvas || null;
    this.patrolCanvas = options.patrolCanvas || null;
    this.collisionCanvas = options.collisionCanvas || null;
    this.unresolvedCollisionCanvas = options.unresolvedCollisionCanvas || null;
    this.shiftCanvas = options.shiftCanvas || null;
    this.shiftMap = options.shiftMap || null;
    this.editorCanvas = options.editorCanvas || null;
    this.statusElement = options.statusElement || null;
    this.clock = options.clock || new PreviewClock({ stepMs: 40, maxCatchUpSteps: 4 });
    this.contexts = [this.backgroundCanvas, this.actorCanvas, this.foregroundCanvas, this.frontActorCanvas]
      .filter(Boolean).map(canvas => {
      const context = canvas.getContext('2d'); context.imageSmoothingEnabled = false; return context;
    });
    this.patrolContext = this.patrolCanvas?.getContext('2d') || null;
    this.collisionContext = this.collisionCanvas?.getContext('2d') || null;
    this.unresolvedCollisionContext = this.unresolvedCollisionCanvas?.getContext('2d') || null;
    this.shiftContext = this.shiftCanvas?.getContext('2d') || null;
    this.editorContext = this.editorCanvas?.getContext('2d') || null;
    if (this.patrolContext) this.patrolContext.imageSmoothingEnabled = false;
    if (this.collisionContext) this.collisionContext.imageSmoothingEnabled = false;
    if (this.unresolvedCollisionContext) this.unresolvedCollisionContext.imageSmoothingEnabled = false;
    if (this.shiftContext) this.shiftContext.imageSmoothingEnabled = false;
    if (this.editorContext) this.editorContext.imageSmoothingEnabled = false;
    this.running = false;
    this.visible = true;
    this.documentVisible = typeof document === 'undefined' ? true : !document.hidden;
    this.showPatrol = false;
    this.debugFilter = 'all';
    this.debugSelectionId = null;
    this.showCollision = false;
    this.showUnresolvedCollision = false;
    this.showShift = false;
    this.geometrySelectedIds = new Set();
    this.selectionBox = null;
    this.mapEditorOverlay = null;
    this.manualPaused = false;
    this.lastStaticPhase = null;
    this.animationFrame = 0;
    this.selection = null;
    this.lastDynamic = null;
    this.editorEnabled = false;
    this.editorSelectionId = null;
    this.zoom = 1;
    this.onDynamicFrame = typeof options.onDynamicFrame === 'function' ? options.onDynamicFrame : null;
    this.onElementSelect = typeof options.onElementSelect === 'function' ? options.onElementSelect : null;
    this.patchMode = false;
    this.noOverlapMode = false;
    this.placementMode = false;
    this.patrolDirty = true;
    this.patchGuide = null;
    this.debugElementPatches = new Map();
    this.boundOnFrame = this.#onFrame.bind(this);
    this.patrolCanvas?.addEventListener?.('pointerdown', event => this.#selectDebugAtEvent(event));
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => {
      this.documentVisible = !document.hidden;
      this.#syncPause();
    });
  }

  select(selection) {
    this.selection = this.renderer.select(selection);
    for (const canvas of [this.backgroundCanvas, this.actorCanvas, this.foregroundCanvas, this.frontActorCanvas, this.patrolCanvas, this.collisionCanvas, this.unresolvedCollisionCanvas, this.shiftCanvas, this.editorCanvas].filter(Boolean)) {
      canvas.width = this.selection.dimensions.width;
      canvas.height = this.selection.dimensions.height;
    }
    this.#applyZoom();
    this.clock.reset(0);
    this.lastStaticPhase = null;
    this.patrolDirty = true;
    this.#renderCollision();
    this.#renderUnresolvedCollision();
    this.#renderShift();
    this.render(true);
    return this.selection;
  }
  setVisible(visible) { this.visible = !!visible; this.#syncPause(); }
  setPaused(paused) { this.manualPaused = !!paused; this.#syncPause(); }
  setSpeed(speed) { this.clock.setSpeed(speed); }
  setZoom(zoom) {
    const requested = Number(zoom);
    this.zoom = requested === 2 || requested === 4 ? requested : 1;
    this.#applyZoom();
    return this.zoom;
  }
  #applyZoom() {
    const canvases = [this.backgroundCanvas, this.actorCanvas, this.foregroundCanvas, this.frontActorCanvas, this.patrolCanvas, this.collisionCanvas, this.unresolvedCollisionCanvas, this.shiftCanvas, this.editorCanvas].filter(Boolean);
    for (const canvas of canvases) {
      canvas.style.width = `${canvas.width * this.zoom}px`;
      canvas.style.height = `${canvas.height * this.zoom}px`;
    }
  }
  setActivateAllTraps(active) {
    this.renderer.setActivateAllTraps?.(active);
    return this.render(true);
  }
  setBulletSource(source) {
    this.renderer.setBulletSource?.(source);
    return this.render(true);
  }
  setDynamiteSource(source) {
    this.renderer.setDynamiteSource?.(source);
    return this.render(true);
  }
  setPhase(phase) {
    this.clock.reset(Math.max(0, Number(phase) | 0) * 5);
    this.lastStaticPhase = null;
    return this.render(true);
  }
  setTick(tick) {
    this.clock.reset(Math.max(0, Number(tick) | 0));
    this.lastStaticPhase = null;
    return this.render(true);
  }
  timelineFor(item) { return this.renderer.timelineForAsset?.(item) || null; }
  geometryCellAt(x, y, options = {}) {
    const phase = options.phase ?? this.renderer.staticPhaseAtTick?.(this.clock.tick) ?? 0;
    return this.renderer.geometryCellAt?.(x, y, { ...options, phase }) || null;
  }
  geometryCellsInRect(rect = null) {
    if (!rect || !this.selection) return [];
    const x0 = Math.max(0, Math.floor(Number(rect.x || 0) / 8));
    const y0 = Math.max(0, Math.floor(Number(rect.y || 0) / 8));
    const x1 = Math.floor((Number(rect.x || 0) + Math.max(1, Number(rect.width || 1)) - 1) / 8);
    const y1 = Math.floor((Number(rect.y || 0) + Math.max(1, Number(rect.height || 1)) - 1) / 8);
    const cells = [];
    for (let gy = y0; gy <= y1; gy += 1) for (let gx = x0; gx <= x1; gx += 1) {
      const cell = this.geometryCellAt(gx * 8 + 4, gy * 8 + 4);
      if (cell) cells.push(cell);
    }
    return cells;
  }
  elementsInRect(rect = null, includeDisabled = true) {
    if (!rect) return [];
    const rx0 = Number(rect.x || 0), ry0 = Number(rect.y || 0);
    const rx1 = rx0 + Math.max(1, Number(rect.width || 1));
    const ry1 = ry0 + Math.max(1, Number(rect.height || 1));
    return this.selectionCandidates(includeDisabled).filter(item => {
      const b = item?.bounds; if (!b) return false;
      return Number(b.x) < rx1 && Number(b.y) < ry1 &&
        Number(b.x) + Number(b.width || 1) > rx0 && Number(b.y) + Number(b.height || 1) > ry0;
    });
  }
  setSelectionBox(rect = null) {
    this.selectionBox = rect ? Object.freeze({ x:Number(rect.x||0), y:Number(rect.y||0), width:Math.max(1,Number(rect.width||1)), height:Math.max(1,Number(rect.height||1)) }) : null;
    this.#renderEditor();
    return this.selectionBox;
  }
  setMapCellOverrides(entries = []) {
    this.renderer.setMapCellOverrides?.(entries);
    this.lastStaticPhase = null;
    return this.render(true);
  }
  setGeometryOverrides(entries = []) {
    this.renderer.setGeometryOverrides?.(entries);
    this.#renderCollision();
    this.#renderUnresolvedCollision();
    return entries.length;
  }
  setMapEditorOverlay(overlay = null) {
    if (!overlay) this.mapEditorOverlay = null;
    else {
      const window = overlay.window ? {
        x:Number(overlay.window.x || 0), y:Number(overlay.window.y || 0),
        width:Math.max(1,Number(overlay.window.width || 320)), height:Math.max(1,Number(overlay.window.height || 192))
      } : null;
      const hero = overlay.hero ? { x:Number(overlay.hero.x || 0), y:Number(overlay.hero.y || 0) } : null;
      const targetCell = overlay.targetCell ? { x:Number(overlay.targetCell.x||0), y:Number(overlay.targetCell.y||0) } : null;
      const sourceCell = overlay.sourceCell ? { x:Number(overlay.sourceCell.x||0), y:Number(overlay.sourceCell.y||0) } : null;
      this.mapEditorOverlay = Object.freeze({ window, hero, targetCell, sourceCell });
    }
    this.#renderEditor();
    return this.mapEditorOverlay;
  }
  setGeometrySelection(ids = []) {
    this.geometrySelectedIds = new Set((ids || []).map(String));
    this.#renderCollision();
    return [...this.geometrySelectedIds];
  }
  setPatchMode(enabled) { this.patchMode = !!enabled; if (!this.patchMode) this.patchGuide = null; this.patrolDirty = true; this.#renderPatrol(true); this.#renderEditor(); }
  setDebugFilter(filter) {
    const allowed = new Set(['all','hazard','enemy','collectible','projectile','activator','audio-activator','blockage','action','patch','no-overlap','placement']);
    this.debugFilter = allowed.has(String(filter || 'all')) ? String(filter || 'all') : 'all';
    this.patrolDirty = true; this.#renderPatrol(true); this.#renderEditor();
    return this.debugFilter;
  }
  #debugFilterMatches(row) {
    const filter = this.debugFilter || 'all';
    if (filter === 'all') return true;
    const family = String(row?.policy?.family || '');
    const category = String(row?.category || '');
    const subject = String(row?.subjectCategory || '');
    const type = String(row?.overlayType || '');
    if (filter === 'hazard') return ['hazard','trap','blockage-hazard','shooter'].includes(family) || type.includes('hazard');
    if (filter === 'enemy') return category === 'enemy' || subject === 'enemy' || ['type1a','type1b'].includes(family);
    if (filter === 'collectible') return category === 'collectible' || family === 'collectible';
    if (filter === 'projectile') return ['projectile','projectile-shooter'].includes(category) || ['projectile','projectile-shooter'].includes(subject) || family === 'shooter' || type.includes('projectile');
    if (filter === 'activator') return family === 'activator' || type === 'activator';
    if (filter === 'audio-activator') return !!row?.triggerSound?.sample;
    if (filter === 'blockage') return subject === 'blockage' || subject === 'explodable' || family === 'blockage-hazard';
    if (filter === 'action') return family === 'action' || type === 'action';
    if (filter === 'patch') return family === 'patch' || type.includes('patch');
    if (filter === 'no-overlap') return family === 'no-overlap' || category === 'no-overlap' || type.includes('missing-rdx');
    if (filter === 'placement') return family === 'placement' || category === 'placement' || type === 'placement';
    return true;
  }
  setNoOverlapMode(enabled) { this.noOverlapMode = !!enabled; this.patrolDirty = true; this.#renderPatrol(true); this.#renderEditor(); return this.noOverlapMode; }
  setPlacementMode(enabled) { this.placementMode = !!enabled; this.patrolDirty = true; this.#renderPatrol(true); this.#renderEditor(); return this.placementMode; }
  setPatchGuide(guide = null) { this.patchGuide = guide ? Object.freeze({ ...guide }) : null; this.#renderEditor(); }
  setDebugElementPatch(elementId, patch = null) {
    const key = String(elementId || '');
    if (!key) return null;
    if (!patch) this.debugElementPatches.delete(key);
    else this.debugElementPatches.set(key, Object.freeze({ ...patch }));
    this.patrolDirty = true; this.#renderPatrol(true); this.#renderEditor();
    return this.debugElementPatches.get(key) || null;
  }
  clearDebugElementPatches() { this.debugElementPatches.clear(); this.patrolDirty = true; this.#renderPatrol(true); this.#renderEditor(); }
  setEditorEnabled(enabled) {
    this.editorEnabled = !!enabled;
    if (this.editorCanvas) {
      this.editorCanvas.hidden = !this.editorEnabled;
      this.editorCanvas.style.pointerEvents = this.editorEnabled ? 'auto' : 'none';
    }
    this.#renderEditor();
  }
  setEditorSelection(id) { this.editorSelectionId = id || null; this.#renderEditor(); }
  currentTick() { return this.clock.tick; }
  currentDynamicFrame() { return this.lastDynamic; }
  setManualOverride(overrideKey, override) { this.renderer.setManualOverride(overrideKey, override); return this.render(true); }
  replaceManualOverrides(entries) { this.renderer.replaceManualOverrides(entries); return this.render(true); }
  clearManualOverrides() { this.renderer.clearManualOverrides(); return this.render(true); }
  #shiftPoint(point, dx, dy) { return Array.isArray(point) ? Object.freeze([Number(point[0] || 0) + dx, Number(point[1] || 0) + dy]) : point; }
  #patchedDiagnostic(row, includeDisabled = false) {
    if (!row) return null;
    const patch = this.debugElementPatches.get(String(row.elementId || '')) || null;
    if (!patch) return row;
    if (patch.enabled === false && !includeDisabled) return null;
    const basePoint = Array.isArray(row.current) ? row.current
      : (Number.isFinite(Number(row.x)) && Number.isFinite(Number(row.y)) ? [Number(row.x), Number(row.y)]
        : row.bounds ? [Number(row.bounds.x || 0), Number(row.bounds.y || 0)] : [0,0]);
    const dx = Number.isFinite(Number(patch.targetX)) ? Number(patch.targetX) - Number(basePoint[0] || 0) : Number(patch.dx || 0);
    const dy = Number.isFinite(Number(patch.targetY)) ? Number(patch.targetY) - Number(basePoint[1] || 0) : Number(patch.dy || 0);
    const shiftBounds = bounds => bounds ? Object.freeze({ ...bounds, x: Number(bounds.x || 0) + dx, y: Number(bounds.y || 0) + dy }) : bounds;
    const envelope = row.envelope ? Object.freeze({ ...row.envelope,
      minX: Number(row.envelope.minX || 0) + dx, maxX: Number(row.envelope.maxX || 0) + dx,
      minY: Number(row.envelope.minY || 0) + dy, maxY: Number(row.envelope.maxY || 0) + dy }) : row.envelope;
    const configured = row.configured ? Object.freeze({ ...row.configured,
      start: this.#shiftPoint(row.configured.start, dx, dy), target: this.#shiftPoint(row.configured.target, dx, dy) }) : row.configured;
    return Object.freeze({ ...row, bounds: shiftBounds(row.bounds), envelope, configured,
      current: this.#shiftPoint(row.current, dx, dy), hero: this.#shiftPoint(row.hero, dx, dy),
      pathPoints: Object.freeze((row.pathPoints || []).map(point => this.#shiftPoint(point, dx, dy))),
      observedPathPoints: Object.freeze((row.observedPathPoints || []).map(point => this.#shiftPoint(point, dx, dy))),
      patchedPlacement: dx !== 0 || dy !== 0, patchBugged: String(patch.bugged || ''), patchDisabled: patch.enabled === false });
  }
  diagnosticRows(includeDisabled = false) {
    const base = [...(this.lastDynamic?.enemyBehaviors || [])];
    if (this.noOverlapMode) base.push(...(this.renderer.noOverlapDiagnostics?.(this.clock.tick, this.lastDynamic?.selectables || []) || []));
    if (this.placementMode) base.push(...(this.renderer.placementDiagnostics?.() || []));
    const rows = base.map(row => this.#patchedDiagnostic(row, includeDisabled)).filter(Boolean).filter(row => this.#debugFilterMatches(row));
    if ((this.debugFilter || 'all') !== 'hazard') return rows;
    /* Hazards mode is collision truth, not an ownership/action inspector. If
     * more than one producer describes the same source, keep exactly one tight
     * collision frame. This prevents a reintroduced action/legacy envelope or
     * duplicate component row from drawing a second outline around mark:45. */
    const rank = row => String(row?.overlayType || '') === 'collision-hazard' ? 3
      : String(row?.overlayType || '') === 'component-hazard' ? 2
      : String(row?.overlayType || '') === 'terrain-hazard' ? 1 : 0;
    const bySource = new Map();
    for (const row of rows) {
      const key = `${String(row?.sourceKey || row?.debugId || '')}|${String(row?.instanceKey || '')}`;
      const previous = bySource.get(key);
      if (!previous || rank(row) > rank(previous)) bySource.set(key, row);
    }
    return [...bySource.values()];
  }
  selectionCandidates(includeDisabled = false) {
    const context = { mapId: this.selection?.mapId, submap: this.selection?.submap };
    let selectables = [...(this.lastDynamic?.selectables || [])];
    let diagnosticRows = this.diagnosticRows(includeDisabled);
    if ((this.debugFilter || 'all') === 'hazard') {
      /* A collision-hazard row is the visualization of a live lethal element,
       * not a second editor object. Keep the underlying RDX/classic source as
       * the sole selectable identity and retain diagnostic-only terrain rows. */
      selectables = selectables.filter(item => !!item?.hazardPotential);
      const liveKeys = new Set(selectables.map(item => `${String(item.sourceKey || '')}|${String(item.instanceKey || '')}`));
      diagnosticRows = diagnosticRows.filter(row =>
        !['collision-hazard', 'component-hazard'].includes(String(row?.overlayType || '')) ||
        !liveKeys.has(`${String(row.sourceKey || '')}|${String(row.instanceKey || '')}`));
    }
    const diagnostics = diagnosticRows.map(row => diagnosticSelectable(row, context)).filter(Boolean);
    return [...selectables, ...diagnostics];
  }
  elementById(elementId, includeDisabled = true) {
    const wanted = String(elementId || '');
    const candidates = this.selectionCandidates(includeDisabled);
    const exact = candidates.find(item => String(item.elementId || '') === wanted);
    if (exact) return exact;

    /* v2.1.29 briefly exported category-based debug ids (debug-hazard) while
     * the canonical catalog used overlay-specific ids (debug-bounds /
     * debug-terrain-hazard).  patches.json is a review artifact, so keep those
     * files usable: the identity suffix remains exact and uniquely identifies
     * the diagnostic primitive. */
    const hash = wanted.lastIndexOf('#');
    if (hash >= 0) {
      const suffix = wanted.slice(hash + 1);
      const legacy = candidates.filter(item => item.debugOnly &&
        String(item.elementId || '').endsWith(`#${suffix}`));
      if (legacy.length === 1) return legacy[0];
    }
    return null;
  }
  elementForPatch(patch, includeDisabled = true) {
    if (!patch) return null;
    const exact = this.elementById(patch.elementId, includeDisabled);
    if (exact) return exact;
    const candidates = this.selectionCandidates(includeDisabled).filter(item =>
      !!item.debugOnly === !!patch.debugOnly &&
      String(item.sourceKey || '') === String(patch.sourceKey || '') &&
      (!patch.category || String(item.category || '') === String(patch.category))
    );
    return candidates.length === 1 ? candidates[0] : null;
  }
  hitTestCandidates(x, y) {
    const hits = this.selectionCandidates(false).filter(item => item.bounds &&
      x >= item.bounds.x && y >= item.bounds.y &&
      x < item.bounds.x + item.bounds.width && y < item.bounds.y + item.bounds.height);
    hits.sort((a, b) => {
      /* In Patches mode, a normal click should reach the actual movable entity
       * instead of being permanently intercepted by its debug bounds.  Debug
       * primitives remain in this list and the UI can cycle through overlaps. */
      const debugBias = this.patchMode ? (a.debugOnly ? 1 : 0) - (b.debugOnly ? 1 : 0)
        : (a.debugOnly ? 1 : 0) - (b.debugOnly ? 1 : 0);
      const area = item => Math.max(1, Number(item.bounds?.width || 1)) * Math.max(1, Number(item.bounds?.height || 1));
      return debugBias || area(a) - area(b) || String(a.elementId || '').localeCompare(String(b.elementId || ''));
    });
    return hits;
  }
  hitTest(x, y) { return this.hitTestCandidates(x, y)[0] || null; }
  #renderEditor() {
    if (!this.editorContext || !this.editorCanvas) return;
    this.editorContext.clearRect(0, 0, this.editorCanvas.width, this.editorCanvas.height);
    if (!this.editorEnabled) return;
    /* Any introduced/reviewed placement is visibly distinct from decoded map
     * truth even when it is not selected. Corner chevrons are deliberately
     * sparse so they do not obscure pixel art. */
    for (const entry of this.lastDynamic?.selectables || []) {
      if (entry?.patchedPlacement && entry.bounds) this.#drawPatchCorners(this.editorContext, entry.bounds);
    }
    for (const row of this.diagnosticRows(false)) {
      if (row?.patchedPlacement) {
        const item = diagnosticSelectable(row, { mapId: this.selection?.mapId, submap: this.selection?.submap });
        if (item?.bounds) this.#drawPatchCorners(this.editorContext, item.bounds);
      }
    }
    if (this.patchMode && this.patchGuide?.fromBounds && this.patchGuide?.toBounds) {
      const from = this.patchGuide.fromBounds, to = this.patchGuide.toBounds;
      const cx0 = from.x + from.width / 2, cy0 = from.y + from.height / 2;
      const cx1 = to.x + to.width / 2, cy1 = to.y + to.height / 2;
      this.editorContext.save();
      this.editorContext.setLineDash([4,3]);
      this.editorContext.strokeStyle = 'rgba(99,205,255,.9)';
      this.editorContext.lineWidth = 1;
      this.editorContext.strokeRect(from.x + .5, from.y + .5, from.width, from.height);
      this.editorContext.setLineDash([]);
      this.editorContext.strokeStyle = 'rgba(255,224,72,.9)';
      this.editorContext.fillStyle = 'rgba(255,224,72,.9)';
      if (Math.abs(cx1-cx0) + Math.abs(cy1-cy0) > 1) this.#drawArrow(this.editorContext, cx0, cy0, cx1, cy1);
      this.editorContext.restore();
    }
    if (this.selectionBox) {
      const b = this.selectionBox;
      this.editorContext.save();
      this.editorContext.strokeStyle = 'rgba(110,220,255,.98)';
      this.editorContext.fillStyle = 'rgba(110,220,255,.10)';
      this.editorContext.setLineDash([4,3]);
      this.editorContext.lineWidth = 1.5;
      this.editorContext.fillRect(b.x,b.y,b.width,b.height);
      this.editorContext.strokeRect(b.x+.5,b.y+.5,b.width,b.height);
      this.editorContext.restore();
    }
    if (this.mapEditorOverlay?.window || this.mapEditorOverlay?.hero || this.mapEditorOverlay?.targetCell || this.mapEditorOverlay?.sourceCell) {
      this.editorContext.save();
      if (this.mapEditorOverlay.window) {
        const w = this.mapEditorOverlay.window;
        this.editorContext.strokeStyle = 'rgba(82,224,255,.98)';
        this.editorContext.fillStyle = 'rgba(82,224,255,.045)';
        this.editorContext.setLineDash([6,3]);
        this.editorContext.lineWidth = 1.5;
        this.editorContext.fillRect(w.x,w.y,w.width,w.height);
        this.editorContext.strokeRect(w.x+.5,w.y+.5,w.width,w.height);
      }
      if (this.mapEditorOverlay.sourceCell) {
        const c=this.mapEditorOverlay.sourceCell;
        this.editorContext.setLineDash([2,2]); this.editorContext.strokeStyle='rgba(80,210,255,.95)'; this.editorContext.lineWidth=1.5;
        this.editorContext.strokeRect(c.x*8+.5,c.y*8+.5,7,7);
      }
      if (this.mapEditorOverlay.targetCell) {
        const c=this.mapEditorOverlay.targetCell;
        this.editorContext.setLineDash([]); this.editorContext.strokeStyle='rgba(255,205,70,.98)'; this.editorContext.lineWidth=2;
        this.editorContext.strokeRect(c.x*8+1,c.y*8+1,6,6);
      }
      if (this.mapEditorOverlay.hero) {
        const h = this.mapEditorOverlay.hero;
        /* Origin/contact marker: Rick's authored start point is more useful
         * than drawing a guessed sprite frame while the editor is paused. */
        this.editorContext.setLineDash([]);
        this.editorContext.strokeStyle = 'rgba(255,232,80,.98)';
        this.editorContext.fillStyle = 'rgba(255,232,80,.18)';
        this.editorContext.lineWidth = 1.5;
        this.editorContext.fillRect(h.x-7,h.y-20,15,20);
        this.editorContext.strokeRect(h.x-7+.5,h.y-20+.5,15,20);
        this.editorContext.beginPath();
        this.editorContext.moveTo(h.x-8,h.y); this.editorContext.lineTo(h.x+8,h.y);
        this.editorContext.moveTo(h.x,h.y-8); this.editorContext.lineTo(h.x,h.y+4);
        this.editorContext.stroke();
      }
      this.editorContext.restore();
    }
    if (!this.editorSelectionId) return;
    const editorCandidates = this.selectionCandidates(true);
    let item = editorCandidates.find(entry => entry.elementId === this.editorSelectionId || entry.id === this.editorSelectionId);
    if (!item) {
      /* sourceKey is a relationship key, not a unique presentation identity:
       * one mark may legitimately own a visible trap, an activator and one or
       * more debug/hazard primitives.  Falling back to the first sourceKey
       * sibling is what made selections such as MD0006 mark:28 highlight the
       * wrong family.  Only accept a source-key-only selection when it is
       * genuinely unambiguous. */
      const bySource = editorCandidates.filter(entry => String(entry.sourceKey || '') === String(this.editorSelectionId));
      if (bySource.length === 1) item = bySource[0];
    }
    if (!item) return;
    const b = item.bounds;
    const hazardDiagnosticOwnsBox = (this.debugFilter || 'all') === 'hazard' && !!item.hazardPotential &&
      this.diagnosticRows(false).some(row =>
        ['collision-hazard','component-hazard','terrain-hazard'].includes(String(row?.overlayType || '')) &&
        String(row?.sourceKey || '') === String(item?.sourceKey || '') &&
        String(row?.instanceKey || '') === String(item?.instanceKey || ''));
    this.editorContext.save();
    this.editorContext.strokeStyle = 'rgba(255,224,72,.98)';
    this.editorContext.fillStyle = 'rgba(255,224,72,.13)';
    this.editorContext.lineWidth = 2;
    /* In the Hazards filter the red collision diagnostic is the one and only
     * geometry frame. The editor selection used to paint a second yellow box
     * around the same live source, making MD0007 mark:45 look like two
     * hazards even though selectionCandidates() correctly exposed one id. */
    if (!hazardDiagnosticOwnsBox) {
      this.editorContext.fillRect(b.x, b.y, b.width, b.height);
      this.editorContext.strokeRect(b.x + .5, b.y + .5, b.width, b.height);
    }
    const label = `${item.category || item.kind} · ${item.elementId || item.sourceKey || item.id}`;
    this.editorContext.font = '10px ui-monospace, monospace';
    const width = Math.ceil(this.editorContext.measureText(label).width) + 8;
    const labelY = Math.max(0, b.y - 14);
    this.editorContext.fillStyle = 'rgba(8,12,20,.92)';
    this.editorContext.fillRect(b.x, labelY, width, 13);
    this.editorContext.fillStyle = 'rgba(255,240,170,1)';
    this.editorContext.fillText(label, b.x + 4, labelY + 10);
    this.editorContext.restore();
  }
  setShowPatrol(show) {
    this.showPatrol = !!show;
    if (this.patrolCanvas) {
      this.patrolCanvas.hidden = !this.showPatrol;
      this.patrolCanvas.style.pointerEvents = this.showPatrol ? 'auto' : 'none';
      this.patrolCanvas.style.cursor = this.showPatrol ? 'pointer' : 'default';
    }
    if (!this.showPatrol) this.debugSelectionId = null;
    this.patrolDirty = true; this.#renderPatrol(true);
  }
  #debugRowContains(row, x, y) {
    const bounds = row?.bounds;
    if (bounds && x >= bounds.x && y >= bounds.y && x <= bounds.x + bounds.width && y <= bounds.y + bounds.height) return true;
    const envelope = row?.envelope;
    if (!envelope) return false;
    const padding = 6;
    return x >= envelope.minX - padding && x <= envelope.maxX + padding &&
      y >= envelope.minY - padding && y <= envelope.maxY + padding;
  }
  #selectDebugAtEvent(event) {
    if (!this.showPatrol || !this.patrolCanvas) return;
    const rect = this.patrolCanvas.getBoundingClientRect();
    const x = (Number(event.clientX) - rect.left) * this.patrolCanvas.width / Math.max(1, rect.width);
    const y = (Number(event.clientY) - rect.top) * this.patrolCanvas.height / Math.max(1, rect.height);
    const rows = this.diagnosticRows(false).filter(row => this.#debugRowContains(row, x, y));
    rows.sort((a, b) => {
      const priority = row => ['terrain-hazard','component-hazard'].includes(String(row.overlayType || '')) ? 0
        : row.policy?.family === 'hazard' ? 1 : 2;
      const area = row => Math.max(1, Number(row.bounds?.width || row.envelope?.width || 1)) * Math.max(1, Number(row.bounds?.height || row.envelope?.height || 1));
      return priority(a) - priority(b) || area(a) - area(b);
    });
    this.debugSelectionId = rows[0]?.elementId || rows[0]?.debugId || null;
    this.patrolDirty = true; this.#renderPatrol(true);
    if (rows[0]) this.onElementSelect?.(diagnosticSelectable(rows[0], { mapId: this.selection?.mapId, submap: this.selection?.submap }));
  }
  #drawArrow(context, x0, y0, x1, y1) {
    const angle = Math.atan2(y1 - y0, x1 - x0);
    context.beginPath(); context.moveTo(x0, y0); context.lineTo(x1, y1); context.stroke();
    context.beginPath(); context.moveTo(x1, y1);
    context.lineTo(x1 - Math.cos(angle - .55) * 6, y1 - Math.sin(angle - .55) * 6);
    context.lineTo(x1 - Math.cos(angle + .55) * 6, y1 - Math.sin(angle + .55) * 6);
    context.closePath(); context.fill();
  }
  #drawPolyline(context, points = []) {
    if (!Array.isArray(points) || points.length < 2) return;
    context.beginPath();
    context.moveTo(points[0][0], points[0][1]);
    for (const point of points.slice(1)) context.lineTo(point[0], point[1]);
    context.stroke();
  }
  #drawPatchCorners(context, bounds) {
    if (!bounds) return;
    const size = 5;
    const corners = [
      [bounds.x, bounds.y, 1, 1],
      [bounds.x + bounds.width, bounds.y, -1, 1],
      [bounds.x, bounds.y + bounds.height, 1, -1],
      [bounds.x + bounds.width, bounds.y + bounds.height, -1, -1]
    ];
    context.save();
    context.strokeStyle = 'rgba(255,225,70,.98)';
    context.fillStyle = 'rgba(255,225,70,.98)';
    context.lineWidth = 1.5;
    context.setLineDash([]);
    for (const [x, y, sx, sy] of corners) {
      context.beginPath();
      context.moveTo(x + sx * size, y);
      context.lineTo(x, y);
      context.lineTo(x, y + sy * size);
      context.stroke();
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x + sx * 3, y + sy * 1.5);
      context.lineTo(x + sx * 1.5, y + sy * 3);
      context.closePath();
      context.fill();
    }
    context.restore();
  }
  #renderPatrol(force = false) {
    if (!this.patrolContext || !this.patrolCanvas) return;
    const staticAuditMode = (this.noOverlapMode && this.debugFilter === 'no-overlap') || (this.placementMode && this.debugFilter === 'placement');
    if (staticAuditMode && !force && !this.patrolDirty) return;
    const context = this.patrolContext;
    context.clearRect(0, 0, this.patrolCanvas.width, this.patrolCanvas.height);
    if (!this.showPatrol) { this.patrolDirty = false; return; }
    const rows = this.diagnosticRows(false);
    context.save();
    context.lineWidth = 1.5;
    context.font = '9px ui-monospace, monospace';
    for (const row of rows) {
      const [cx, cy] = row.current || [Number(row.bounds?.x || 0), Number(row.bounds?.y || 0)];
      /* Generated No-overlap rows are intentionally compact evidence objects
       * and historically omitted an envelope.  Dereferencing minX on that
       * missing object threw from requestAnimationFrame, which stopped the
       * whole preview animation loop and made actors appear to vanish/freeze. */
      const envelope = row.envelope || (row.bounds ? {
        minX:Number(row.bounds.x || 0), minY:Number(row.bounds.y || 0),
        maxX:Number(row.bounds.x || 0)+Number(row.bounds.width || 1),
        maxY:Number(row.bounds.y || 0)+Number(row.bounds.height || 1),
        width:Number(row.bounds.width || 1), height:Number(row.bounds.height || 1), sampleCount:1
      } : { minX:cx, minY:cy, maxX:cx+1, maxY:cy+1, width:1, height:1, sampleCount:1 });
      const family = row.policy?.family || row.category || 'debug';
      const selected = row.elementId === this.debugSelectionId || row.debugId === this.debugSelectionId;
      if (family === 'placement') {
        const currentBox = row.currentBounds || row.bounds;
        const fittedBox = row.fittedBounds || row.bounds;
        const typeColor = row.subjectCategory === 'enemy' ? 'rgba(84,220,130,.98)'
          : row.subjectCategory === 'activator' ? 'rgba(190,120,255,.98)'
          : row.subjectCategory === 'collectible' ? 'rgba(255,225,100,.98)'
          : ['trap','hazard','blockage'].includes(String(row.subjectCategory)) ? 'rgba(255,90,90,.98)'
          : row.subjectCategory === 'player' ? 'rgba(80,190,255,.98)' : 'rgba(80,220,235,.98)';
        if (currentBox && !row.classicReference) {
          context.lineWidth = selected ? 2 : 1.5; context.strokeStyle = 'rgba(170,176,188,.78)'; context.fillStyle = 'rgba(170,176,188,.05)';
          context.setLineDash([4,3]); context.fillRect(currentBox.x,currentBox.y,currentBox.width,currentBox.height);
          context.strokeRect(currentBox.x+.5,currentBox.y+.5,currentBox.width,currentBox.height);
        }
        if (fittedBox) {
          context.strokeStyle = typeColor; context.fillStyle = typeColor.replace('.98)', '.09)'); context.setLineDash([]); context.lineWidth = selected ? 2.5 : 1.7;
          context.fillRect(fittedBox.x,fittedBox.y,fittedBox.width,fittedBox.height);
          context.strokeRect(fittedBox.x+.5,fittedBox.y+.5,fittedBox.width,fittedBox.height);
        }
        if (currentBox && fittedBox && (Math.abs(currentBox.x-fittedBox.x)>.5 || Math.abs(currentBox.y-fittedBox.y)>.5)) {
          context.strokeStyle=typeColor; context.fillStyle=typeColor; context.lineWidth=1.5;
          this.#drawArrow(context,currentBox.x+currentBox.width/2,currentBox.y+currentBox.height/2,fittedBox.x+fittedBox.width/2,fittedBox.y+fittedBox.height/2);
        }
        if (selected && fittedBox) {
          const label = `${row.sourceKey || row.debugId} · ${row.subjectCategory || 'entity'} · ${row.placementStatus || row.classification || 'review'} · drift ${Number(row.drift?.[0]||0)},${Number(row.drift?.[1]||0)}`;
          const labelWidth=Math.ceil(context.measureText(label).width)+6; const labelX=Math.max(0,Math.min(this.patrolCanvas.width-labelWidth,fittedBox.x)); const labelY=Math.max(10,fittedBox.y-4);
          context.fillStyle='rgba(5,10,18,.9)'; context.fillRect(labelX,labelY-9,labelWidth,11); context.fillStyle=typeColor; context.fillText(label,labelX+3,labelY);
        }
        continue;
      }
      const stroke = row.noEffect ? 'rgba(255,64,64,.98)'
        : family === 'type1a' ? 'rgba(84,220,130,.96)'
        : family === 'type1b' ? 'rgba(255,190,70,.96)'
        : family === 'trap' || family === 'hazard' || family === 'blockage-hazard' ? 'rgba(255,90,90,.96)'
        : family === 'shooter' ? 'rgba(255,140,60,.96)'
        : family === 'activator' ? 'rgba(170,120,255,.72)'
        : family === 'patch' ? 'rgba(255,225,70,.98)'
        : family === 'collectible' ? 'rgba(255,225,100,.96)'
        : family === 'action' ? 'rgba(255,110,210,.96)'
        : 'rgba(96,180,255,.96)';
      const fill = row.noEffect ? 'rgba(255,32,32,.10)'
        : family === 'trap' || family === 'hazard' || family === 'blockage-hazard' ? 'rgba(255,90,90,.08)'
        : family === 'shooter' ? 'rgba(255,140,60,.08)'
        : family === 'activator' ? 'rgba(170,120,255,.035)'
        : family === 'patch' ? 'rgba(255,225,70,0)'
        : family === 'collectible' ? 'rgba(255,225,100,.08)'
        : family === 'action' ? 'rgba(255,110,210,.08)'
        : family === 'type1a' ? 'rgba(84,220,130,.10)'
        : family === 'type1b' ? 'rgba(255,190,70,.10)' : 'rgba(96,180,255,.10)';
      context.strokeStyle = stroke; context.fillStyle = fill; context.lineWidth = selected ? 2.5 : 1.5;
      context.setLineDash(family === 'type1a' ? [5, 3] : family === 'action' ? [6, 3] : [3, 3]);
      const exactBounds = ['activator','hazard','trap','blockage-hazard','collectible','shooter'].includes(family) && row.bounds;
      if (family !== 'patch') {
        const boxX = exactBounds ? row.bounds.x : envelope.minX - 4;
        const boxY = exactBounds ? row.bounds.y : envelope.minY - 8;
        const boxW = exactBounds ? row.bounds.width : Math.max(8, envelope.width + 8);
        const boxH = exactBounds ? row.bounds.height : Math.max(16, envelope.height + 16);
        context.fillRect(boxX, boxY, boxW, boxH);
        context.strokeRect(boxX + .5, boxY + .5, boxW, boxH);
        if (row.noEffect) {
          context.beginPath();
          context.moveTo(boxX + 2, boxY + 2);
          context.lineTo(boxX + boxW - 2, boxY + boxH - 2);
          context.moveTo(boxX + boxW - 2, boxY + 2);
          context.lineTo(boxX + 2, boxY + boxH - 2);
          context.stroke();
          context.fillStyle = 'rgba(5,10,18,.88)';
          context.fillRect(boxX, Math.max(0, boxY - 10), 54, 10);
          context.fillStyle = stroke;
          context.fillText('NO EFFECT', boxX + 2, Math.max(8, boxY - 2));
        }
      }
      context.setLineDash([]);
      if (row.bounds && family !== 'activator' && family !== 'patch' && !exactBounds) {
        context.strokeStyle = stroke;
        context.strokeRect(row.bounds.x + .5, row.bounds.y + .5, row.bounds.width, row.bounds.height);
      } else if (row.bounds && family === 'patch') {
        /* A suppressed visual must stay findable after its pixels disappear.
         * Keep an explicit yellow outline plus patch corners in debug/patch
         * mode instead of removing its selectable geometry with the art. */
        context.strokeStyle = stroke;
        context.lineWidth = selected ? 2.5 : 1.5;
        context.strokeRect(row.bounds.x + .5, row.bounds.y + .5, row.bounds.width, row.bounds.height);
      }
      if (row.patchedPlacement || family === 'patch') this.#drawPatchCorners(context, row.bounds);
      if (family === 'type1a' && row.configured?.drawConfiguredLine) {
        context.lineWidth = 2; context.strokeStyle = stroke; context.fillStyle = stroke;
        this.#drawArrow(context, row.configured.start[0], row.configured.start[1], row.configured.target[0], row.configured.target[1]);
      } else if (family === 'type1b' && row.hero) {
        context.lineWidth = 1; context.strokeStyle = stroke; context.fillStyle = stroke;
        this.#drawArrow(context, cx, cy, row.hero[0], row.hero[1]);
      } else if ((family === 'type3' || family === 'action') && Array.isArray(row.pathPoints) && row.pathPoints.length >= 2) {
        if (family === 'type3' && Array.isArray(row.observedPathPoints) && row.observedPathPoints.length >= 2) {
          context.lineWidth = 1; context.strokeStyle = 'rgba(255,255,255,.72)'; context.setLineDash([]);
          this.#drawPolyline(context, row.observedPathPoints);
        }
        context.lineWidth = 2; context.strokeStyle = stroke; context.fillStyle = stroke;
        context.setLineDash(family === 'type3' ? [6, 3] : []);
        this.#drawPolyline(context, row.pathPoints);
        context.setLineDash([]);
        const first = row.pathPoints[row.pathPoints.length - 2], last = row.pathPoints[row.pathPoints.length - 1];
        this.#drawArrow(context, first[0], first[1], last[0], last[1]);
      }
      if (selected) {
        const patrolDetail = family === 'type1a' && row.configured?.actualDistancePx != null
          ? ` · actual ${Math.round(row.configured.actualDistancePx)}px / cap ${Math.round(row.configured.configuredDistancePx)}px` : '';
        const scriptDetail = family === 'type3' && row.scriptVsRuntime === 'authored-script-plus-observed-runtime'
          ? ' · dashed script / white runtime' : '';
        const bugDetail = row.patchBugged ? ` · BUGGED: ${row.patchBugged}` : '';
        const label = `${row.elementId || row.sourceKey} · ${row.policy.label}${patrolDetail}${scriptDetail}${row.trigger ? ` · ${row.trigger}` : ''}${bugDetail}`;
        const labelWidth = Math.ceil(context.measureText(label).width) + 6;
        const labelX = Math.max(0, Math.min(this.patrolCanvas.width - labelWidth, envelope.minX - 4));
        const labelY = Math.max(10, envelope.minY - 10);
        context.fillStyle = 'rgba(5,10,18,.88)'; context.fillRect(labelX, labelY - 9, labelWidth, 11);
        context.fillStyle = stroke; context.fillText(label, labelX + 3, labelY);
      }
      if (family !== 'activator' && family !== 'patch') {
        context.fillStyle = stroke;
        context.beginPath(); context.arc(cx, cy, selected ? 3.5 : 2.5, 0, Math.PI * 2); context.fill();
      }
    }
    context.restore();
    this.patrolDirty = false;
  }
  setShowCollision(show) {
    this.showCollision = !!show;
    if (this.collisionCanvas) {
      this.collisionCanvas.hidden = !this.showCollision;
      this.collisionCanvas.style.pointerEvents = this.showCollision ? 'auto' : 'none';
      this.collisionCanvas.style.cursor = this.showCollision ? 'cell' : '';
      this.collisionCanvas.style.touchAction = this.showCollision ? 'none' : '';
      this.collisionCanvas.classList.toggle('preview-geometry-interactive', this.showCollision);
    }
    this.#renderCollision();
  }
  setShowUnresolvedCollision(show) {
    this.showUnresolvedCollision = !!show;
    if (this.unresolvedCollisionCanvas) {
      this.unresolvedCollisionCanvas.hidden = !this.showUnresolvedCollision;
      this.unresolvedCollisionCanvas.style.pointerEvents = 'none';
    }
    this.#renderUnresolvedCollision();
  }
  setShowShift(show) {
    this.showShift = !!show;
    if (this.shiftCanvas) {
      this.shiftCanvas.hidden = !(this.showShift && this.selection?.visualSource === 'rdx');
      this.shiftCanvas.style.pointerEvents = 'none';
    }
    this.#renderShift();
    return this.showShift;
  }
  unresolvedCollisionCount() { return this.renderer.unresolvedCollisionCells?.().length || 0; }
  #syncPause() { this.clock.setPaused(this.manualPaused || !(this.visible && this.documentVisible)); }
  #renderCollision() {
    if (!this.collisionContext || !this.selection) return;
    this.collisionContext.clearRect(0, 0, this.collisionCanvas.width, this.collisionCanvas.height);
    if (this.showCollision) putBuffer(this.collisionContext, this.renderer.collisionLayer([...this.geometrySelectedIds]));
  }
  #renderUnresolvedCollision() {
    if (!this.unresolvedCollisionContext || !this.selection) return;
    this.unresolvedCollisionContext.clearRect(0, 0, this.unresolvedCollisionCanvas.width, this.unresolvedCollisionCanvas.height);
    if (this.showUnresolvedCollision) putBuffer(this.unresolvedCollisionContext, this.renderer.unresolvedCollisionLayer());
  }
  #renderShift() {
    if (!this.shiftContext || !this.selection) return;
    this.shiftContext.clearRect(0, 0, this.shiftCanvas.width, this.shiftCanvas.height);
    const visible = this.showShift && this.selection.visualSource === 'rdx';
    this.shiftCanvas.hidden = !visible;
    if (!visible) return;
    const overlay = this.shiftMap?.overlayForSubmap?.(this.selection.submap);
    if (overlay && overlay.width === this.shiftCanvas.width && overlay.height === this.shiftCanvas.height)
      putBuffer(this.shiftContext, overlay);
  }

  render(forceStatic = false) {
    if (!this.selection) return null;
    const phase = this.renderer.staticPhaseAtTick(this.clock.tick);
    if (forceStatic || phase !== this.lastStaticPhase) {
      const layers = this.renderer.staticLayers(phase);
      putBuffer(this.contexts[0], layers.background);
      putBuffer(this.contexts[2], layers.foreground);
      this.lastStaticPhase = phase;
    }
    const dynamic = this.renderer.dynamicFrame(this.clock.tick);
    this.lastDynamic = dynamic;
    this.#renderPatrol();
    putBuffer(this.contexts[1], dynamic.pixels, dynamic.dirtyBounds);
    if (this.contexts[3] && dynamic.frontPixels) {
      putBuffer(this.contexts[3], dynamic.frontPixels, dynamic.frontDirtyBounds);
    }
    this.#renderEditor();
    this.onDynamicFrame?.(dynamic, this.selection, this.clock.tick);
    if (this.statusElement) {
      const m = dynamic.metrics;
      this.statusElement.textContent = `${this.selection.visualSource.toUpperCase()} · MD${String(this.selection.mapId).padStart(4, '0')} · ${m.productionAuthority || 'classic-C-data'} · ${m.activityMode || 'production-snapshot'} · tick ${this.clock.tick} · phase ${phase} · ${m.actors} actors · ${m.traps} trap effects · ${m.projectiles} projectiles · ${m.fallback} fallbacks`;
    }
    return dynamic;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.animationFrame = requestAnimationFrame(this.boundOnFrame);
  }
  stop() {
    this.running = false;
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = 0;
  }
  #onFrame(now) {
    if (!this.running) return;
    if (this.clock.update(now) > 0) this.render(false);
    this.animationFrame = requestAnimationFrame(this.boundOnFrame);
  }
}
