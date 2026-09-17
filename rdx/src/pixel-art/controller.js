import { AGENT_WORKFLOW } from "./direction.js";
import { AssetPluginRegistry } from "./asset-plugins.js";
import { encodeSession, decodeSession } from "./session.js";
import { ArtStore } from "./commands.js";
import {
  LIMITS,
  clone,
  requireArt,
  createDocument,
  encodeProject,
  decodeProject,
  composite,
  rect,
} from "./document.js";
import { analyze, inspect as inspectDocument, readRegion } from "./analysis.js";
import { documentDelta, warningDelta } from "./diff.js";
import { indicesToRuns, maskHash, resolveSelector } from "./selectors.js";
import { PIXEL_ART_RECIPES, compileRecipe } from "./recipes.js";
import { ATTACHABLE_REFERENCE_ROLES, REFERENCE_ROLES, REFERENCE_POLICIES, normalizeAttachedReferenceMetadata, normalizeReferenceMetadata, publicReference } from "./references.js";
import { silhouetteRgba, valueRgba, paletteRoleRgba, frameDeltaRgba, checkpointDeltaRgba } from "./critique-view.js";
import { PIXEL_ART_BENCHMARK_TASKS, benchmarkReport } from "./benchmark.js";
import {
  sha256,
  convertImage,
  sliceSheet,
  exportSheet,
  pngBlob,
  rgbaPixels,
  imageCanvas,
  readImageFile,
  paletteFromImage,
} from "./image-io.js";

export class ArtController {
  constructor({ doc, plugins = new AssetPluginRegistry(), pluginContext = {}, onChange = () => {}, onView = () => {} } = {}) {
    this.store = new ArtStore(doc);
    this.pluginContext = pluginContext;
    this.plugins = plugins;
    this.handles = new Map();
    this.artifacts = new Map();
    this.onChange = onChange;
    this.onView = onView;
    this.selectedFrame = this.store.document.frames[0].id;
    this.selectedLayer = "ink";
    this.activeCandidate = "main";
    this.primaryCandidate = "main";
    this.candidates = new Map([["main", this.store]]);
    this.#watchStore(this.store);
    this.lastView = null;
    this.selectionHandles = new Map();
  }
  #watchStore(store) {
    if (!store.__rdrControllerSubscribed) {
      store.subscribe(() => this.onChange());
      Object.defineProperty(store, "__rdrControllerSubscribed", { value: true, configurable: true });
    }
  }
  #setActiveCandidate(name) {
    const store = this.candidates.get(name);
    requireArt(store, "CANDIDATE", `Unknown candidate: ${name}`);
    this.store = store;
    this.activeCandidate = name;
    this.selectionHandles?.clear();
    this.#watchStore(store);
    const d = store.document;
    if (!d.frames.some(frame => frame.id === this.selectedFrame)) this.selectedFrame = d.frames[0].id;
    if (!d.layers.some(layer => layer.id === this.selectedLayer)) this.selectedLayer = d.layers[0].id;
    this.onChange();
  }
  #resetCandidates(store = this.store, name = "main") {
    this.candidates = new Map([[name, store]]);
    this.activeCandidate = name;
    this.primaryCandidate = name;
    this.selectionHandles?.clear();
    this.#watchStore(store);
  }
  candidateState() {
    return {
      active: this.activeCandidate,
      primary: this.primaryCandidate,
      candidates: [...this.candidates].map(([name, store]) => {
        const d = store.document;
        return { name, primary: name === this.primaryCandidate, active: name === this.activeCandidate, revision: d.revision, provenance: d.provenance.candidate ?? null };
      }),
    };
  }
  candidateCommand(i = {}) {
    const current = this.store.document;
    if (i.action === "list") return this.candidateState();
    if (i.action === "compare") return this.candidateCompare({ source: i.name, target: i.targetCandidate ?? this.activeCandidate });
    requireArt(i.documentId === current.id && i.expectedRevision === current.revision, "STALE_REVISION", "Candidate operation requires the exact active revision");
    if (i.action === "fork") {
      requireArt(typeof i.name === "string" && /^[a-zA-Z0-9_-]{1,40}$/.test(i.name), "CANDIDATE", "Candidate name must be 1–40 safe characters");
      requireArt(!this.candidates.has(i.name), "CANDIDATE", "Candidate name already exists");
      requireArt(this.candidates.size < 4, "LIMIT", "Maximum four live candidates");
      const base = i.checkpoint ? this.store.checkpoints.get(i.checkpoint) : current;
      requireArt(base, "HISTORY", "Unknown candidate fork checkpoint");
      const snapshot = clone(base);
      snapshot.provenance.candidate = { name: i.name, parent: this.activeCandidate, forkRevision: current.revision, checkpoint: i.checkpoint ?? null };
      const store = new ArtStore(snapshot);
      store.checkpoints = new Map([...this.store.checkpoints].map(([name, checkpoint]) => [name, clone(checkpoint)]));
      this.#watchStore(store);
      this.candidates.set(i.name, store);
      if (i.switch !== false) this.#setActiveCandidate(i.name);
      return this.candidateState();
    }
    if (i.action === "switch") {
      this.#setActiveCandidate(i.name);
      return this.candidateState();
    }
    if (i.action === "promote") {
      requireArt(this.candidates.has(i.name), "CANDIDATE", "Unknown candidate");
      this.primaryCandidate = i.name;
      if (i.switch !== false) this.#setActiveCandidate(i.name);
      this.onChange();
      return this.candidateState();
    }
    if (i.action === "delete") {
      requireArt(this.candidates.has(i.name), "CANDIDATE", "Unknown candidate");
      requireArt(this.candidates.size > 1, "CANDIDATE", "Cannot delete the only candidate");
      requireArt(i.name !== this.primaryCandidate || i.replacementPrimary, "CANDIDATE", "Choose a replacement primary before deleting the primary candidate");
      if (i.name === this.primaryCandidate) {
        requireArt(this.candidates.has(i.replacementPrimary) && i.replacementPrimary !== i.name, "CANDIDATE", "Invalid replacement primary");
        this.primaryCandidate = i.replacementPrimary;
      }
      const wasActive = i.name === this.activeCandidate;
      this.candidates.delete(i.name);
      if (wasActive) this.#setActiveCandidate(this.primaryCandidate);
      else this.onChange();
      return this.candidateState();
    }
    if (i.action === "transfer") return this.candidateTransfer({ ...i, sourceCandidate: i.name, targetCandidate: i.targetCandidate ?? this.activeCandidate }, { simulate: i.simulate === true });
    requireArt(false, "CANDIDATE", "Unknown candidate action");
  }
  candidateCompare({ source, target = this.activeCandidate } = {}) {
    const aStore = this.candidates.get(source), bStore = this.candidates.get(target);
    requireArt(aStore && bStore, "CANDIDATE", "Candidate comparison requires two existing candidates");
    const a = aStore.document, b = bStore.document;
    requireArt(a.width === b.width && a.height === b.height, "CANDIDATE", "Candidate dimensions differ");
    const delta = documentDelta(a, b), warnings = warningDelta(a, b);
    const frameFacts = b.frames.map((frame) => {
      const prior = a.frames.find(row => row.id === frame.id);
      if (!prior) return { frameId: frame.id, status: "added" };
      const opaque = (doc, f) => {
        const pixels = composite(doc, f.id);
        let count = 0, sx = 0, sy = 0;
        for (let i = 0; i < pixels.length; i++) if (pixels[i] !== 0) { count++; sx += i % doc.width; sy += Math.floor(i / doc.width); }
        return { count, centroid: count ? [sx / count, sy / count] : null };
      };
      return { frameId: frame.id, source: opaque(a, prior), target: opaque(b, frame) };
    });
    const paletteUsage = (doc) => { const used=new Set(); for (const f of doc.frames) for (const value of composite(doc,f.id)) used.add(value); return [...used].sort((x,y)=>x-y); };
    const sourceUsage=paletteUsage(a),targetUsage=paletteUsage(b);
    const sourceFork=a.provenance?.candidate??null,targetFork=b.provenance?.candidate??null;
    const commonBase = sourceFork?.parent === target ? { candidate: target, revision: sourceFork.forkRevision, checkpoint: sourceFork.checkpoint ?? null }
      : targetFork?.parent === source ? { candidate: source, revision: targetFork.forkRevision, checkpoint: targetFork.checkpoint ?? null }
      : sourceFork?.parent && sourceFork.parent === targetFork?.parent ? { candidate: sourceFork.parent, sourceForkRevision: sourceFork.forkRevision, targetForkRevision: targetFork.forkRevision } : null;
    return { source, target, sourceRevision: a.revision, targetRevision: b.revision, commonBase, delta, warnings, frameFacts, paletteUsage:{ source:sourceUsage, target:targetUsage, added:targetUsage.filter(v=>!sourceUsage.includes(v)), removed:sourceUsage.filter(v=>!targetUsage.includes(v)) } };
  }
  candidateTransfer(i = {}, { simulate = false } = {}) {
    const sourceStore = this.candidates.get(i.sourceCandidate), targetStore = this.candidates.get(i.targetCandidate ?? this.activeCandidate);
    requireArt(sourceStore && targetStore, "CANDIDATE", "Candidate transfer requires existing source and target candidates");
    const source = sourceStore.document, target = targetStore.document;
    requireArt(i.sourceRevision === source.revision, "STALE_REVISION", `Source candidate revision is ${source.revision}`, { currentRevision: source.revision });
    requireArt(targetStore === this.store, "CANDIDATE", "Candidate transfer target must be the active candidate");
    requireArt(i.documentId === target.id && i.expectedRevision === target.revision, "STALE_REVISION", "Candidate transfer requires exact target revision");
    requireArt(source.width === target.width && source.height === target.height && JSON.stringify(source.palette) === JSON.stringify(target.palette), "CANDIDATE", "Candidate transfer requires matching dimensions and palette");
    const sourceFrameId = i.sourceFrameId ?? i.frameId ?? source.frames[0].id, sourceLayerId = i.sourceLayerId ?? i.layerId ?? source.layers[0].id;
    const targetFrameId = i.targetFrameId ?? i.frameId ?? sourceFrameId, targetLayerId = i.targetLayerId ?? i.layerId ?? sourceLayerId;
    const sourceFrame = source.frames.find(f => f.id === sourceFrameId), sourceLayer = source.layers.find(l => l.id === sourceLayerId);
    requireArt(sourceFrame && sourceLayer, "TARGET", "Unknown candidate transfer source cel");
    const indices = resolveSelector(source, { frameId: sourceFrameId, layerId: sourceLayerId, selector: i.selector ?? { type: "opaque" } });
    const rows = [];
    for (const [y, x, length] of indicesToRuns(source, indices)) rows.push([y, x, sourceFrame.cels[sourceLayerId].slice(y * source.width + x, y * source.width + x + length)]);
    const input = { documentId: target.id, expectedRevision: target.revision, requestId: i.requestId, label: i.label ?? `candidate-region:${i.sourceCandidate}`, assertions: i.assertions, ops: [{ type: "pixels", frameId: targetFrameId, layerId: targetLayerId, rows }] };
    if (simulate) return { ...targetStore.simulate(input), resolved: { sourceCandidate: i.sourceCandidate, sourceRevision: source.revision, sourceFrameId, sourceLayerId, targetFrameId, targetLayerId, pixelCount: indices.length } };
    const result = targetStore.apply(input);
    targetStore._doc.provenance.candidateTransfers ??= [];
    targetStore._doc.provenance.candidateTransfers.push({ revision: result.revision, sourceCandidate: i.sourceCandidate, sourceRevision: source.revision, sourceFrameId, sourceLayerId, targetFrameId, targetLayerId, pixelCount: indices.length, sourceMaskHash: maskHash({ documentId: source.id, revision: source.revision, frameId: sourceFrameId, layerId: sourceLayerId, indices }) });
    return { ...result, resolved: { sourceCandidate: i.sourceCandidate, sourceRevision: source.revision, pixelCount: indices.length } };
  }
  recipe(i = {}) {
    const compiled = compileRecipe(this.store.document, i.recipe);
    if (compiled.candidateTransfer) return this.candidateTransfer({ ...i, ...compiled.candidateTransfer }, { simulate: i.mode === "simulate" });
    const input = { documentId: this.store.document.id, expectedRevision: i.expectedRevision, requestId: i.requestId, label: i.label ?? `recipe:${i.recipe.id}`, ops: compiled.ops, assertions: { ...(compiled.assertions ?? {}), ...(i.assertions ?? {}) } };
    const result = i.mode === "simulate" ? this.simulate(input) : this.apply(input);
    return { ...result, recipe: i.recipe.id, resolvedOps: compiled.ops };
  }
  #createSelectionHandle(selection) {
    const handle = `selection-${crypto.randomUUID()}`;
    while (this.selectionHandles.size >= 32) this.selectionHandles.delete(this.selectionHandles.keys().next().value);
    this.selectionHandles.set(handle, clone({ ...selection, candidate: this.activeCandidate }));
    return handle;
  }
  #resolveSelectionHandle(handle, { doc, frameId, layerId = null }) {
    const selection = this.selectionHandles.get(handle);
    if (!selection) return null;
    if (selection.candidate !== this.activeCandidate || selection.documentId !== doc.id || selection.revision !== doc.revision || selection.frameId !== frameId || (selection.layerId ?? null) !== (layerId ?? null) || selection.dimensions?.[0] !== doc.width || selection.dimensions?.[1] !== doc.height) return null;
    return clone(selection);
  }
  #checkpoint(name) {
    return name ? this.store.checkpoints.get(name) ?? null : null;
  }
  guard() {
    const d = this.store.document;
    return {
      documentId: d.id,
      expectedRevision: d.revision,
      requestId: crypto.randomUUID(),
    };
  }
  sessionText() {
    return encodeSession(this.store, {
      candidates: [...this.candidates]
        .filter(([name]) => name !== this.activeCandidate)
        .map(([name, store]) => ({ name, store })),
      activeCandidate: this.activeCandidate,
      primaryCandidate: this.primaryCandidate,
    });
  }
  restoreSessionText(text) {
    this.selectionHandles.clear();
    const session = decodeSession(text);
    requireArt(session.candidates.size + 1 <= 4, "LIMIT", "Maximum four live candidates");
    const activeName = session.activeCandidate || "main";
    const activeStore = new ArtStore(session.doc);
    activeStore.checkpoints = session.checkpoints;
    this.#watchStore(activeStore);
    const candidates = new Map([[activeName, activeStore]]);
    for (const [name, entry] of session.candidates) {
      requireArt(name !== activeName && !candidates.has(name), "CANDIDATE", "Saved candidate identity is invalid");
      const store = new ArtStore(entry.doc);
      store.checkpoints = entry.checkpoints;
      this.#watchStore(store);
      candidates.set(name, store);
    }
    requireArt(candidates.has(session.primaryCandidate), "CANDIDATE", "Saved primary candidate does not exist");
    this.candidates = candidates;
    this.store = activeStore;
    this.activeCandidate = activeName;
    this.primaryCandidate = session.primaryCandidate;
    this.selectedFrame = session.doc.frames[0].id;
    this.selectedLayer = session.doc.layers[0].id;
    this.onChange();
    return this.candidateState();
  }
  addHandle(value) {
    const handle = `file-${crypto.randomUUID()}`;
    while (this.handles.size >= 8)
      this.handles.delete(this.handles.keys().next().value);
    this.handles.set(handle, value);
    return handle;
  }
  state({ detail = false } = {}) {
    const d = this.store.document;
    return {
      documentId: d.id,
      revision: d.revision,
      width: d.width,
      height: d.height,
      frames: d.frames.length,
      layers: d.layers.length,
      selectedFrame: this.selectedFrame,
      selectedLayer: this.selectedLayer,
      profile: d.profile,
      paletteSize: d.palette.length,
      limits: LIMITS,
      capabilities: {
        indexed: true,
        sheets: true,
        assetPlugins: this.plugins.list(),
        productionPreview: !!this.pluginContext.productionPreviewProvider,
        referenceRoles: [...REFERENCE_ROLES],
        attachableReferenceRoles: [...ATTACHABLE_REFERENCE_ROLES],
        referencePolicies: [...REFERENCE_POLICIES],
        benchmarkTasks: PIXEL_ART_BENCHMARK_TASKS.map(({ id, title }) => ({ id, title })),
        critiqueViews: ["critique", "silhouette", "value", "palette-role", "frame-delta", "animation-review"],
        candidateBranches: true,
        semanticSelectors: ["rect", "opaque", "color", "component", "handle", "checkpoint-delta", "layer-role", "bounds", "contour", "union", "intersect", "subtract", "invert-within-region"],
        inspectFacts: ["bounds", "centroid", "counts", "paletteHistogram", "components", "contour", "holes", "contacts", "occupancy", "symmetry", "anchorRelativeBounds", "layerContribution", "checkpointDelta", "neighborhood", "paletteSemantics"],
        dryRunOps: true,
        targetSets: true,
        selectionTransforms: ["translate", "copy-translate", "mirror-horizontal", "mirror-vertical", "rotate-90", "rotate-180", "rotate-270", "scale-integer", "scale-nearest", "clear", "recolor", "contour"],
        structuralOps: ["delete_frame", "duplicate_frames", "delete_layer", "duplicate_layer", "reorder_layers", "merge_layers", "flatten_visible", "cel", "bulk_anchor", "trim_to_selection", "pad_canvas"],
        paletteOps: ["shade_step", "remap_ramp", "palette_add", "palette_remove", "palette_reorder", "palette_ramp"],
        recipes: PIXEL_ART_RECIPES.map(({ id, required }) => ({ id, required })),
        candidateCompare: true,
        candidateRegionTransfer: true,
        handoffState: true,
        transactionAssertions: ["changedPixels", "changedBoundsWithin", "unchanged", "paletteUnchanged", "anchorsUnchanged", "clipsUnchanged", "structureUnchanged", "opaqueBounds", "componentCount", "colorsUsed", "noNewWarnings", "checkpointDeltaWithin"],
        imageDelivery: "host capture required",
      },
      ...(detail
        ? {
            brief: d.brief,
            artDirection: d.artDirection ?? {},
            palettePolicy: d.palettePolicy ?? null,
            paletteLocks: d.paletteLocks,
            provenance: { binding: d.provenance.binding ? { ...d.provenance.binding, sourceText: undefined, rowLines: undefined } : null, asset: d.provenance.asset ?? null },
            workflow: AGENT_WORKFLOW,
            palette: d.palette,
            frames: d.frames.map(({ cels, ...f }) => f),
            layers: d.layers,
            clips: d.clips,
            layout: d.layout,
            constraints: d.constraints,
            references: d.references.map(publicReference),
            styleProfile: d.styleProfile ?? null,
            authoring: d.authoring ?? null,
            handoff: d.handoff ?? null,
            candidates: this.candidateState(),
            fileHandles: [...this.handles].map(([handle, value]) => ({
              handle,
              type: value instanceof Uint8Array ? "rom" : typeof value === "string" ? "text" : "image",
              name: value.name ?? null,
              width: value.width ?? null,
              height: value.height ?? null,
            })),
            checkpoints: [...this.store.checkpoints.keys()],
            metrics: this.store.metrics,
          }
        : {}),
    };
  }
  apply(i) {
    return this.store.apply(i, { handleResolver: (handle, scope) => this.#resolveSelectionHandle(handle, scope) });
  }
  simulate(i) {
    return this.store.simulate(i, { handleResolver: (handle, scope) => this.#resolveSelectionHandle(handle, scope) });
  }
  inspect(i = {}) {
    const document = this.store.document;
    requireArt(i.expectedRevision === document.revision, "STALE_REVISION", `Current revision is ${document.revision}`, { expectedRevision: i.expectedRevision, currentRevision: document.revision });
    const checkpoint = i.checkpoint ? this.#checkpoint(i.checkpoint) : null;
    requireArt(!i.checkpoint || checkpoint, "HISTORY", "Unknown checkpoint", { checkpoint: i.checkpoint });
    return inspectDocument(document, i, {
      checkpoint,
      checkpointResolver: (name) => this.#checkpoint(name),
      handleResolver: (handle, scope) => this.#resolveSelectionHandle(handle, scope),
      createHandle: (selection) => this.#createSelectionHandle(selection),
    });
  }
  read(i) {
    return readRegion(this.store.document, i);
  }
  analyze({ checkpoint, benchmarkTask, review } = {}) {
    const baseline = checkpoint ? this.store.checkpoints.get(checkpoint) : null;
    requireArt(!checkpoint || baseline, "HISTORY", "Unknown checkpoint");
    const result = {
      ...analyze(this.store.document, baseline),
      session: {
        ...this.store.metrics,
        elapsedMs: Date.now() - this.store.metrics.startedAt,
        hostImageObservations: null,
        modelUsage: null,
      },
    };
    return benchmarkTask ? { ...result, benchmark: benchmarkReport(this.store.document, result, { taskId: benchmarkTask, review }) } : result;
  }
  history(i) {
    return i.action === "checkpoint"
      ? this.store.checkpoint(i)
      : this.store.history(i);
  }
  async artifact(blob, name, revision) {
    const hash = await sha256(await blob.arrayBuffer()),
      handle = `artifact-${crypto.randomUUID()}`,
      url = URL.createObjectURL(blob);
    if (this.artifacts.size >= 24) {
      const [key, a] = this.artifacts.entries().next().value;
      URL.revokeObjectURL(a.url);
      this.artifacts.delete(key);
    }
    this.artifacts.set(handle, { blob, name, url, hash, revision });
    return {
      handle,
      name,
      hash,
      revision,
      bytes: blob.size,
      repositoryWritten: false,
    };
  }
  async documentCommand(i) {
    const d = this.store.document,
      o = i.options ?? {};
    if (i.action === "save" || i.action === "export") {
      requireArt(
        i.documentId === d.id && i.expectedRevision === d.revision,
        "STALE_REVISION",
        "Save/export requires the exact document revision",
      );
      const artifacts = [];
      if (i.action === "save" || i.format === "project")
        artifacts.push(
          await this.artifact(
            new Blob([this.sessionText()], { type: "application/json" }),
            `${d.id}.rdr-art.json`,
            d.revision,
          ),
        );
      else if (i.format === "report")
        artifacts.push(
          await this.artifact(
            new Blob([JSON.stringify(this.analyze(), null, 2)], {
              type: "application/json",
            }),
            `${d.id}-validation.json`,
            d.revision,
          ),
        );
      else if (i.format === "sheet" || (!i.format && d.frames.length > 1)) {
        const s = exportSheet(d);
        artifacts.push(
          await this.artifact(
            await pngBlob(s.width, s.height, s.rgba),
            `${d.id}.png`,
            d.revision,
          ),
        );
        artifacts.push(
          await this.artifact(
            new Blob([JSON.stringify(s.metadata, null, 2)], {
              type: "application/json",
            }),
            `${d.id}.sheet.json`,
            d.revision,
          ),
        );
      } else
        artifacts.push(
          await this.artifact(
            await pngBlob(
              d.width,
              d.height,
              rgbaPixels(d, o.frameId ?? d.frames[0].id),
            ),
            `${d.id}.png`,
            d.revision,
          ),
        );
      this.onChange();
      return { revision: d.revision, artifacts };
    }
    if (i.action === "production-export" || i.action === "asset-export") {
      requireArt(
        i.documentId === d.id && i.expectedRevision === d.revision,
        "STALE_REVISION",
        "Export requires current revision",
      );
      if (o.sourceHandle) requireArt(this.handles.has(o.sourceHandle), "HANDLE", "Choose the current owning source first");
      const result = await this.plugins.export(d, { currentSource: o.sourceHandle ? this.handles.get(o.sourceHandle) : undefined });
      const artifacts = [];
      for (const file of result.files) artifacts.push(await this.artifact(new Blob([file.text], { type: "text/plain" }), file.name, d.revision));
      artifacts.push(await this.artifact(new Blob([JSON.stringify(result.manifest, null, 2)], { type: "application/json" }), "production-candidate.json", d.revision));
      this.onChange();
      return { revision: d.revision, artifacts, manifest: result.manifest };
    }

    let file = this.handles.get(i.handle);
    if (file === undefined && this.artifacts.has(i.handle)) {
      const a = this.artifacts.get(i.handle);
      file = a.blob.type.startsWith("image/")
        ? await readImageFile(new File([a.blob], a.name, { type: a.blob.type }))
        : await a.blob.text();
    }
    let next, openedCheckpoints, openedCandidates, openedActiveCandidate, openedPrimaryCandidate;
    if (i.action === "create") next = createDocument(o);
    else if (i.action === "open") {
      requireArt(
        typeof file === "string",
        "HANDLE",
        "Choose a project file first",
      );
      const session = decodeSession(file);
      next = session.doc;
      openedCheckpoints = session.checkpoints;
      openedCandidates = session.candidates;
      openedActiveCandidate = session.activeCandidate;
      openedPrimaryCandidate = session.primaryCandidate;
    } else if (i.action === "asset-import" || this.plugins.importId(i.action)) {
      requireArt(file !== undefined, "HANDLE", "Choose the plugin source file first");
      next = await this.plugins.import(this.plugins.importId(i.action, o.pluginId), file, o, this.pluginContext);
    } else if (i.action === "import-sheet") {
      requireArt(file?.rgba, "HANDLE", "Choose an image file first");
      next = sliceSheet(file, {
        ...o,
        allowedIndices: o.palettePolicy !== "source" && !o.palette ? d.palettePolicy?.allowedIndices : o.allowedIndices,
        palette:
          o.palettePolicy === "source"
            ? paletteFromImage(file)
            : (o.palette ?? d.palette),
      });
      if (o.fixedPalette) next.palettePolicy = fixedPolicy(o, next.palette, o.palettePolicy !== "source" && !o.palette ? d.palettePolicy : null);
      next.references = [normalizeReferenceMetadata({ ...file, id: "source" }, { role: "editable-source", policy: "exact-copy-allowed", notes: "Imported editable source" })];
    } else if (i.action === "reference") {
      requireArt(file?.rgba, "HANDLE", "Choose an image file first");
      return this.store.transact(i, (draft) =>
        draft.references.push(normalizeAttachedReferenceMetadata({
          ...clone(file),
          id: o.id ?? `reference-${draft.references.length + 1}`,
        }, { role: o.role ?? "style", notes: o.notes ?? "" })),
      );
    } else if (i.action === "import-image") {
      requireArt(file?.rgba, "HANDLE", "Choose an image file first");
      requireArt(o.fit, "FIT", "Choose a fit policy explicitly");
      if (o.newDocument) {
        next = createDocument({
          id: o.id ?? "imported-image",
          width: o.width ?? file.width,
          height: o.height ?? file.height,
          palette:
            o.palettePolicy === "source"
              ? paletteFromImage(file)
              : (o.palette ?? d.palette),
          palettePolicy: o.fixedPalette ? fixedPolicy(o, o.palettePolicy === "source" ? paletteFromImage(file) : (o.palette ?? d.palette), o.palettePolicy !== "source" && !o.palette ? d.palettePolicy : null) : undefined,
        });
        const conversion = convertImage(file, {
          width: next.width,
          height: next.height,
          ...o,
          palette: next.palette,
          allowedIndices: next.palettePolicy?.allowedIndices,
        });
        next.frames[0].cels.ink = conversion.pixels;
        next.references = [
          {
            ...clone(file),
            id: "source",
            role: "editable-source",
            policy: "exact-copy-allowed",
            notes: "Imported editable source",
            transform: conversion.transform,
          },
        ];
        const result = this.store.transact(
          { ...i, action: "import-new-image" },
          (draft) => {
            Object.keys(draft).forEach((k) => delete draft[k]);
            Object.assign(draft, next);
          },
        );
        this.#resetCandidates(this.store, "main");
        this.selectedFrame = next.frames[0].id;
        this.selectedLayer = next.layers[0].id;
        this.onChange();
        return result;
      }
      requireArt(
        o.palettePolicy !== "source",
        "PALETTE",
        "Source palette requires a new image to avoid recoloring other cels",
      );
      const converted = convertImage(file, {
        width: d.width,
        height: d.height,
        ...o,
        palette: d.palette,
        allowedIndices: d.palettePolicy?.allowedIndices ?? d.constraints.allowedPalette,
      });
      return this.store.transact(i, (draft) => {
        const f = draft.frames.find((f) => f.id === o.frameId);
        requireArt(
          f && f.cels[o.layerId],
          "TARGET",
          "Explicit frame and layer required",
        );
        f.cels[o.layerId] = converted.pixels;
        draft.references.push({
          ...clone(file),
          id: `source-${draft.references.length + 1}`,
          role: "editable-source",
          policy: "exact-copy-allowed",
          notes: "Imported editable source",
          transform: converted.transform,
        });
      });
    } else requireArt(false, "ACTION", "Unknown document action");
    const result = this.store.transact(i, (draft) => {
      Object.keys(draft).forEach((k) => delete draft[k]);
      Object.assign(draft, next);
    });
    if (openedCheckpoints) this.store.checkpoints = openedCheckpoints;
    if (i.action === "open") {
      const activeName = openedActiveCandidate || "main";
      this.candidates = new Map([[activeName, this.store]]);
      for (const [name, entry] of openedCandidates ?? []) {
        requireArt(name !== activeName, "CANDIDATE", "Saved candidate duplicates the active branch");
        const candidateStore = new ArtStore(entry.doc); candidateStore.checkpoints = entry.checkpoints; this.#watchStore(candidateStore); this.candidates.set(name, candidateStore);
      }
      this.activeCandidate = activeName;
      this.primaryCandidate = this.candidates.has(openedPrimaryCandidate) ? openedPrimaryCandidate : activeName;
    } else if (["create", "asset-import", "production-import", "import-rdx-sprite", "import-sheet", "import-new-image"].includes(i.action)) this.#resetCandidates(this.store, "main");
    this.selectedFrame = next.frames[0].id;
    this.selectedLayer = next.layers[0].id;
    this.onChange();
    return result;
  }
  async view({
    expectedRevision,
    mode = "asset",
    frameId,
    referenceId,
    region,
    zoom = 8,
    checkpoint,
    adjacent = "previous",
    previewOptions = {},
  } = {}) {
    const d = this.store.document;
    requireArt(expectedRevision === undefined || expectedRevision === d.revision, "STALE_REVISION", "View revision is stale");
    requireArt(Number.isInteger(zoom) && zoom >= 1 && zoom <= 24, "LIMIT", "Zoom must be an integer from 1 to 24");
    const selected = frameId ?? this.selectedFrame;
    requireArt(d.frames.some(frame => frame.id === selected), "TARGET", "Unknown view frame");

    const cropCanvas = (source) => {
      if (!region) return source;
      rect({ width: source.width, height: source.height }, region);
      const crop = document.createElement("canvas"); crop.width = region[2]; crop.height = region[3];
      crop.getContext("2d").drawImage(source, ...region, 0, 0, region[2], region[3]);
      return crop;
    };
    const panel = (label, canvas, note = "") => ({ label, canvas: cropCanvas(canvas), note });
    let panels = [], source = null, metadata = {};

    if (mode === "production") {
      requireArt(this.pluginContext.productionPreviewProvider?.render, "PREVIEW", "Production-context preview provider is unavailable");
      const descriptor = await this.plugins.preview(d, { ...previewOptions, frameId: selected }, this.pluginContext);
      const preview = await this.pluginContext.productionPreviewProvider.render(d, descriptor);
      requireArt(preview?.canvas, "PREVIEW", "Production preview provider did not return a canvas");
      panels = [
        panel("Draft · native asset", imageCanvas(d.width, d.height, rgbaPixels(d, selected))),
        panel("Real map · draft substituted", preview.canvas),
      ];
      metadata.production = { descriptor, context: preview.context ?? null };
    } else if (mode === "critique") {
      const index = d.frames.findIndex(frame => frame.id === selected), base = checkpoint ? this.store.checkpoints.get(checkpoint) : null;
      requireArt(!checkpoint || base, "HISTORY", "Unknown checkpoint");
      panels = [
        panel("Native 1×", imageCanvas(d.width, d.height, rgbaPixels(d, selected))),
        panel("Silhouette", imageCanvas(d.width, d.height, silhouetteRgba(d, selected))),
        panel("Value", imageCanvas(d.width, d.height, valueRgba(d, selected))),
        panel("Palette roles", imageCanvas(d.width, d.height, paletteRoleRgba(d, selected)), d.styleProfile?.ramps?.length ? "Style-profile ramp membership" : "No style-profile ramps: opaque colors are neutral"),
      ];
      if (index > 0) panels.push(panel("Previous-frame delta", imageCanvas(d.width, d.height, frameDeltaRgba(d, selected, d.frames[index - 1].id)), "Pink=current-only · cyan=previous-only · yellow=color change"));
      if (base) panels.push(panel(`Checkpoint delta · ${checkpoint}`, imageCanvas(d.width, d.height, checkpointDeltaRgba(d, selected, base))));
      metadata.analysis = this.analyze({ checkpoint });
    } else if (mode === "animation-review") {
      const index = d.frames.findIndex(frame => frame.id === selected);
      panels = [panel("Current", imageCanvas(d.width, d.height, rgbaPixels(d, selected))), panel("Silhouette", imageCanvas(d.width, d.height, silhouetteRgba(d, selected)))];
      if (index > 0) panels.push(panel("Δ previous", imageCanvas(d.width, d.height, frameDeltaRgba(d, selected, d.frames[index - 1].id))));
      if (index + 1 < d.frames.length) panels.push(panel("Δ next", imageCanvas(d.width, d.height, frameDeltaRgba(d, selected, d.frames[index + 1].id))));
      const strip = document.createElement("canvas"); strip.width = d.width * d.frames.length; strip.height = d.height;
      d.frames.forEach((frame, n) => strip.getContext("2d").drawImage(imageCanvas(d.width, d.height, silhouetteRgba(d, frame.id)), n * d.width, 0));
      panels.push(panel("Silhouette strip", strip));
      metadata.analysis = this.analyze();
    } else if (mode === "silhouette") source = imageCanvas(d.width, d.height, silhouetteRgba(d, selected));
    else if (mode === "value") source = imageCanvas(d.width, d.height, valueRgba(d, selected));
    else if (mode === "palette-role") source = imageCanvas(d.width, d.height, paletteRoleRgba(d, selected));
    else if (mode === "frame-delta") {
      const index = d.frames.findIndex(frame => frame.id === selected), other = adjacent === "next" ? d.frames[index + 1] : d.frames[index - 1];
      requireArt(other, "TARGET", `No ${adjacent === "next" ? "next" : "previous"} frame to compare`);
      source = imageCanvas(d.width, d.height, frameDeltaRgba(d, selected, other.id)); metadata.otherFrameId = other.id;
    } else if (mode === "review") {
      const base = this.store.checkpoints.get(checkpoint);
      requireArt(base && base.width === d.width && base.height === d.height && base.frames.some(f => f.id === selected), "HISTORY", "Review requires a compatible checkpoint and frame");
      panels = [
        panel(`Before r${base.revision}`, imageCanvas(d.width, d.height, rgbaPixels(base, selected))),
        panel(`After r${d.revision}`, imageCanvas(d.width, d.height, rgbaPixels(d, selected))),
        panel("Changed pixels", imageCanvas(d.width, d.height, checkpointDeltaRgba(d, selected, base))),
      ];
      metadata = { direction: d.artDirection ?? {}, brief: d.brief, analysis: this.analyze({ checkpoint }) };
    } else if (mode === "sheet") {
      const sheet = exportSheet(d); source = imageCanvas(sheet.width, sheet.height, sheet.rgba);
    } else if (mode === "reference") {
      const r = d.references.find((r) => r.id === referenceId); requireArt(r, "REFERENCE", "Unknown reference"); source = imageCanvas(r.width, r.height, r.rgba); metadata.reference = publicReference(r);
    } else if (mode === "strip" || mode === "playback") {
      const frames = mode === "playback" ? d.clips[0].frameIds.map(id => d.frames.find(frame => frame.id === id)) : d.frames;
      source = document.createElement("canvas"); source.width = d.width * frames.length; source.height = d.height;
      requireArt(source.width * source.height <= LIMITS.celPixels, "LIMIT", "Strip too large");
      frames.forEach((frame, n) => source.getContext("2d").drawImage(imageCanvas(d.width, d.height, rgbaPixels(d, frame.id)), n * d.width, 0));
    } else {
      source = imageCanvas(d.width, d.height, rgbaPixels(d, selected));
      if (mode === "onion") {
        requireArt(["previous", "next", "both"].includes(adjacent), "VIEW", "Onion adjacent must be previous, next or both");
        const n = d.frames.findIndex(frame => frame.id === selected), ctx = source.getContext("2d");
        ctx.globalAlpha = 0.3; ctx.globalCompositeOperation = "destination-over";
        if ((adjacent === "previous" || adjacent === "both") && n > 0) ctx.drawImage(imageCanvas(d.width, d.height, rgbaPixels(d, d.frames[n - 1].id)), 0, 0);
        if ((adjacent === "next" || adjacent === "both") && n + 1 < d.frames.length) ctx.drawImage(imageCanvas(d.width, d.height, rgbaPixels(d, d.frames[n + 1].id)), 0, 0);
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
      }
      if (mode === "diff") {
        const base = this.store.checkpoints.get(checkpoint); requireArt(base, "HISTORY", "Compatible checkpoint required");
        source = imageCanvas(d.width, d.height, checkpointDeltaRgba(d, selected, base));
      }
    }
    if (source) panels = [panel(mode, source)];
    requireArt(panels.length > 0, "VIEW", `Unsupported view mode: ${mode}`);
    for (const item of panels) requireArt(item.canvas.width * zoom <= 16384 && item.canvas.height * zoom <= 16384 && item.canvas.width * item.canvas.height * zoom * zoom <= 32000000, "LIMIT", "View too large; reduce zoom or choose a crop");
    this.store.metrics.views++;
    const width = Math.max(...panels.map(item => item.canvas.width)), height = Math.max(...panels.map(item => item.canvas.height));
    this.lastView = {
      handle: `view-${crypto.randomUUID()}`, revision: d.revision, mode, width, height, zoom, selector: "#art-observation",
      imageDelivery: "Capture the prepared region with host image facilities", activeCandidate: this.activeCandidate, primaryCandidate: this.primaryCandidate,
      ...metadata, panels,
    };
    this.onView(this.lastView);
    return { ...this.lastView, panels: panels.map(({ canvas, ...item }) => ({ ...item, width: canvas.width, height: canvas.height })) };
  }

}

function fixedPolicy(options, palette, inherited) {
  if (options.assetPalettePolicy) return clone(options.assetPalettePolicy);
  if (inherited) return clone(inherited);
  return { name: options.paletteName ?? "Imported asset palette", source: options.paletteSource ?? "Selected source image", colors: clone(palette), allowedIndices: options.allowedIndices ?? palette.map((_, i) => i), maxColors: options.maxColors ?? palette.length - 1 };
}
