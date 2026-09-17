import { previewElementId } from './preview-elements.js';

export const PREVIEW_PATCHES_SCHEMA = 'rdx.preview_patches.v1';
export const PREVIEW_PATCHES_VERSION = '2026-08-07-absolute-targets';

function text(value, fallback = '') { return String(value ?? fallback).trim(); }
function finite(value, fallback = 0) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function nowIso(clock) { return new Date(typeof clock === 'function' ? clock() : Date.now()).toISOString(); }

export function createPreviewPatchesDocument({ appVersion = 'unknown', romSha256 = null, createdAt = null } = {}) {
  const timestamp = createdAt || new Date().toISOString();
  return {
    schema: PREVIEW_PATCHES_SCHEMA,
    version: PREVIEW_PATCHES_VERSION,
    game: { project: 'xrick/RDX Web', appVersion: text(appVersion || 'unknown'), rdxRomSha256: romSha256 || null },
    purpose: 'Review-only single-element corrections. This file does not mutate decoded map data or production C state.',
    createdAt: timestamp,
    updatedAt: timestamp,
    rooms: []
  };
}

function validate(document) {
  if (!document || document.schema !== PREVIEW_PATCHES_SCHEMA) throw new Error(`Expected ${PREVIEW_PATCHES_SCHEMA}`);
  if (!Array.isArray(document.rooms)) throw new Error('patches.json rooms must be an array');
  return document;
}

function normalizePatchVersions(document, fallbackVersion = 'unknown') {
  const sourceVersion = text(document?.game?.appVersion || fallbackVersion || 'unknown');
  for (const room of document?.rooms || []) for (const patch of room?.patches || []) {
    if (!patch.introducedInVersion) patch.introducedInVersion = sourceVersion;
    const observed = patch.observed || (patch.observed = {});
    const change = patch.change || (patch.change = { dx:0, dy:0, enabled:true, bugged:'' });
    const ox = finite(observed.x), oy = finite(observed.y);
    const dx = finite(change.dx), dy = finite(change.dy);
    const bounds = Array.isArray(observed.bounds) ? observed.bounds : [ox, oy, 1, 1];
    /* v2.1.32 makes the desired absolute world position first-class.  Older
     * review files only carried a delta from an observed point; normalize them
     * once so exported/reloaded/imported patches never depend on whether a
     * source correction has already been promoted into production. */
    if (!patch.target || !Number.isFinite(Number(patch.target.x)) || !Number.isFinite(Number(patch.target.y))) {
      patch.target = {
        x: ox + dx, y: oy + dy,
        bounds: [finite(bounds[0]) + dx, finite(bounds[1]) + dy, Math.max(1, finite(bounds[2], 1)), Math.max(1, finite(bounds[3], 1))],
        visible: change.enabled !== false
      };
    } else {
      patch.target.x = finite(patch.target.x);
      patch.target.y = finite(patch.target.y);
      patch.target.visible = change.enabled !== false;
      if (!Array.isArray(patch.target.bounds)) {
        const tdx = patch.target.x - ox, tdy = patch.target.y - oy;
        patch.target.bounds = [finite(bounds[0]) + tdx, finite(bounds[1]) + tdy, Math.max(1, finite(bounds[2], 1)), Math.max(1, finite(bounds[3], 1))];
      }
      change.dx = Math.round(patch.target.x - ox);
      change.dy = Math.round(patch.target.y - oy);
    }
  }
  return document;
}

function patchComparable(patch) {
  if (!patch) return null;
  return JSON.stringify({
    elementId: patch.elementId,
    sourceKey: patch.sourceKey ?? null,
    instanceKey: patch.instanceKey ?? null,
    traceCollection: patch.traceCollection ?? null,
    elementKind: patch.elementKind,
    category: patch.category,
    port: patch.port ?? null,
    debugOnly: !!patch.debugOnly,
    introducedInVersion: patch.introducedInVersion || null,
    observed: patch.observed || {},
    target: patch.target || null,
    change: patch.change || {}
  });
}

function patchKey(room, patch) {
  return `${Number(room?.submap ?? -1)}:${Number(room?.mapId ?? -1)}:${String(patch?.elementId || '')}`;
}

function samePatchSubject(a, b) {
  if (!a || !b) return false;
  if (String(a.elementId || '') && String(a.elementId || '') === String(b.elementId || '')) return true;
  /* A user can first select a diagnostic hazard box and later the actual rendered
   * trap for the same gameplay source.  Treat those as the same integration
   * subject when they share the source and runtime collection.  Activators keep
   * their own collection and therefore never collapse into the gameplay actor. */
  const sourceA = String(a.sourceKey || ''), sourceB = String(b.sourceKey || '');
  const collectionA = String(a.traceCollection || ''), collectionB = String(b.traceCollection || '');
  return !!sourceA && sourceA === sourceB && !!collectionA && collectionA === collectionB;
}

function targetMatches(value, expected) {
  if (!value || !expected) return false;
  return Math.round(finite(value?.target?.x, NaN)) === Math.round(finite(expected?.x, NaN)) &&
    Math.round(finite(value?.target?.y, NaN)) === Math.round(finite(expected?.y, NaN));
}

function reconcileDesiredAgainstBaseline(baseline, desired) {
  const reconciled = clone(desired);
  for (const room of reconciled.rooms || []) {
    const baselineRoom = (baseline?.rooms || []).find(row =>
      finite(row.submap, -1) === finite(room.submap, -1) && finite(row.mapId, -1) === finite(room.mapId, -1));
    if (!baselineRoom) continue;
    room.patches = (room.patches || []).filter(existing => {
      const shipped = (baselineRoom.patches || []).find(row => samePatchSubject(row, existing));
      if (!shipped) return true;
      /* v2.1.35 can explicitly supersede a previously integrated coordinate
       * that was later proven to be stale.  Do not let browser localStorage
       * resurrect that rejected target merely because its old element id was a
       * debug-bounds id rather than the eventual rendered-entity id. */
      if (targetMatches(existing, shipped.supersedesIntegratedTarget)) return false;
      if (patchComparable(existing) === patchComparable(shipped)) return false;
      const shippedMoves = finite(shipped?.change?.dx) !== 0 || finite(shipped?.change?.dy) !== 0;
      const existingMoves = finite(existing?.change?.dx) !== 0 || finite(existing?.change?.dy) !== 0;
      const sameNoteIntent = !shippedMoves && !existingMoves &&
        text(existing?.change?.bugged) === text(shipped?.change?.bugged) &&
        (existing?.change?.enabled !== false) === (shipped?.change?.enabled !== false);
      /* Note-only rows carry incidental observed coordinates. If the shipped
       * build resolved the same note, drop the old overlay instead of pinning
       * the authoring snapshot.  A note can cause a source-level runtime fix
       * without becoming an implicit position patch. */
      return !sameNoteIntent;
    });
  }
  reconciled.rooms = (reconciled.rooms || []).filter(room => (room.patches || []).length > 0);
  return reconciled;
}


export class PreviewPatchStore {
  constructor(options = {}) {
    this.clock = options.clock || Date.now;
    this.appVersion = text(options.appVersion || 'unknown');
    this.storage = options.storage || null;
    this.storageKey = options.storageKey || 'rdx.preview.patches.v1';
    this.baselineStorageKey = options.baselineStorageKey || `${this.storageKey}.integration-baseline`;
    this.onChange = typeof options.onChange === 'function' ? options.onChange : null;
    this.document = createPreviewPatchesDocument({ appVersion: options.appVersion, romSha256: options.romSha256, createdAt: nowIso(this.clock) });
    if (options.loadStored !== false) this.loadStored();
    normalizePatchVersions(this.document, options.appVersion);
    const integratedBaseline = options.integratedBaseline
      ? normalizePatchVersions(clone(validate(options.integratedBaseline)), this.appVersion) : null;
    const storedVersion = text(this.document?.game?.appVersion || 'unknown');
    const restoredBaseline = options.loadStored !== false ? this.loadStoredBaseline() : null;
    const sameBuildBaseline = restoredBaseline &&
      text(restoredBaseline?.game?.appVersion || 'unknown') === this.appVersion &&
      storedVersion === this.appVersion;
    /* The baseline means "already integrated into the shipped build", not
     * "already downloaded once".  v2.1.33 ships an explicit baseline so an
     * edited v2.1.32 localStorage row (for example a newly corrected mark:93
     * target) survives the app upgrade as a pending diff, while corrections
     * already promoted into source do not reappear. */
    this.shippedBaseline = !!integratedBaseline;
    this.baselineDocument = integratedBaseline || (sameBuildBaseline ? restoredBaseline : clone(this.document));
    if (integratedBaseline) this.document = reconcileDesiredAgainstBaseline(integratedBaseline, this.document);
    this.document.game.appVersion = this.appVersion;
    this.baselineDocument.game.appVersion = this.appVersion;
    this.saveStoredBaseline();
  }
  #changed() {
    this.document.updatedAt = nowIso(this.clock);
    if (this.storage?.setItem) { try { this.storage.setItem(this.storageKey, JSON.stringify(this.document)); } catch {} }
    this.onChange?.(this.snapshot());
  }
  loadStored() {
    if (!this.storage?.getItem) return false;
    try {
      const raw = this.storage.getItem(this.storageKey); if (!raw) return false;
      this.document = normalizePatchVersions(validate(JSON.parse(raw)), this.document?.game?.appVersion); return true;
    } catch { return false; }
  }
  loadStoredBaseline() {
    if (!this.storage?.getItem) return null;
    try {
      const raw = this.storage.getItem(this.baselineStorageKey);
      if (!raw) return null;
      return normalizePatchVersions(validate(JSON.parse(raw)), this.appVersion);
    } catch { return null; }
  }
  saveStoredBaseline() {
    if (!this.storage?.setItem || !this.baselineDocument) return false;
    try { this.storage.setItem(this.baselineStorageKey, JSON.stringify(this.baselineDocument)); return true; }
    catch { return false; }
  }
  import(document, { asBaseline = true } = {}) {
    const importedVersion = text(document?.game?.appVersion || 'unknown');
    const incoming = normalizePatchVersions(clone(validate(document)), importedVersion);
    const isDiff = !!incoming.diffBase || (incoming.rooms || []).some(room => (room.patches || []).some(patch => patch.operation));
    if (isDiff) {
      /* A downloaded patch file is normally a diff.  Importing that file back
       * into the workbench must merge it into the desired review state rather
       * than replacing every previously saved room patch with only the latest
       * changed rows. */
      const merged = normalizePatchVersions(clone(this.document), this.appVersion);
      for (const incomingRoom of incoming.rooms || []) {
        const submap = finite(incomingRoom.submap, -1), mapId = finite(incomingRoom.mapId, -1);
        let room = merged.rooms.find(row => Number(row.submap) === submap && Number(row.mapId) === mapId);
        if (!room) { room = { ...clone(incomingRoom), patches:[] }; delete room.diffBase; merged.rooms.push(room); }
        for (const entry of incomingRoom.patches || []) {
          const index = room.patches.findIndex(row => row.elementId === entry.elementId);
          if (entry.operation === 'remove') { if (index >= 0) room.patches.splice(index, 1); continue; }
          const clean = clone(entry); delete clean.operation; delete clean.removedInVersion;
          if (index >= 0) room.patches[index] = clean; else room.patches.push(clean);
        }
      }
      this.document = normalizePatchVersions(merged, importedVersion);
    } else this.document = incoming;
    this.document.importedFromAppVersion = importedVersion;
    if (this.appVersion && this.appVersion !== 'unknown') this.document.game.appVersion = this.appVersion;
    this.#changed();
    if (asBaseline) { this.baselineDocument = clone(this.document); this.saveStoredBaseline(); }
    this.onChange?.(this.snapshot());
    return this.snapshot();
  }
  snapshot() { return clone(this.document); }
  baselineSnapshot() { return clone(this.baselineDocument || createPreviewPatchesDocument()); }
  markCurrentAsBaseline() {
    this.baselineDocument = clone(this.document);
    this.saveStoredBaseline();
    this.onChange?.(this.snapshot());
    return this.baselineSnapshot();
  }
  #baselineIndex() {
    const out = new Map();
    for (const room of this.baselineDocument?.rooms || []) for (const patch of room?.patches || []) out.set(patchKey(room, patch), patchComparable(patch));
    return out;
  }
  isPatchDirty(context, patch) {
    if (!patch) return false;
    const room = { submap: finite(context?.submap, -1), mapId: finite(context?.mapId, -1) };
    return this.#baselineIndex().get(patchKey(room, patch)) !== patchComparable(patch);
  }
  diffSnapshot() {
    const baseline = this.#baselineIndex();
    const timestamp = nowIso(this.clock);
    const out = createPreviewPatchesDocument({
      appVersion: this.document?.game?.appVersion || 'unknown',
      romSha256: this.document?.game?.rdxRomSha256 || null,
      createdAt: timestamp
    });
    out.purpose = 'Diff of review-only single-element corrections since this browser session/import baseline.';
    out.diffBase = {
      appVersion: this.baselineDocument?.game?.appVersion || null,
      updatedAt: this.baselineDocument?.updatedAt || null
    };
    out.updatedAt = timestamp;
    const currentKeys = new Set();
    const roomOutputs = new Map();
    const ensureRoom = room => {
      const key = `${Number(room?.submap ?? -1)}:${Number(room?.mapId ?? -1)}`;
      if (!roomOutputs.has(key)) {
        const copy = { ...clone(room), patches: [] };
        roomOutputs.set(key, copy); out.rooms.push(copy);
      }
      return roomOutputs.get(key);
    };
    for (const room of this.document?.rooms || []) for (const patch of room.patches || []) {
      const key = patchKey(room, patch); currentKeys.add(key);
      if (baseline.get(key) === patchComparable(patch)) continue;
      ensureRoom(room).patches.push({ ...clone(patch), operation: 'upsert' });
    }
    /* Removing an entry that was part of the baseline is itself a meaningful
     * review change. Emit an explicit tombstone so the next integration pass
     * can revert a previously promoted patch instead of silently losing the
     * user's intent. Removing a brand-new, never-exported entry simply cancels
     * it and therefore produces no diff. */
    if (!this.shippedBaseline) for (const room of this.baselineDocument?.rooms || []) for (const patch of room.patches || []) {
      const key = patchKey(room, patch);
      if (currentKeys.has(key)) continue;
      ensureRoom(room).patches.push({
        ...clone(patch), operation: 'remove', removedInVersion: text(this.appVersion || this.document?.game?.appVersion || 'unknown'), updatedAt: timestamp
      });
    }
    out.rooms = out.rooms.filter(room => room.patches.length > 0);
    return out;
  }
  setGameMetadata({ appVersion, romSha256 } = {}) {
    if (appVersion) { this.appVersion = text(appVersion); this.document.game.appVersion = this.appVersion; }
    if (romSha256 !== undefined) this.document.game.rdxRomSha256 = romSha256 || null;
    this.#changed();
  }
  room(context = {}, create = true) {
    const submap = finite(context.submap, -1), mapId = finite(context.mapId, -1);
    let room = this.document.rooms.find(row => Number(row.submap) === submap && Number(row.mapId) === mapId);
    if (!room && create) {
      room = { submap, submapName: text(context.submapName), mapId, mapName: text(context.mapName), world: text(context.world), visualSource: text(context.visualSource || 'rdx'), patches: [] };
      this.document.rooms.push(room);
    }
    return room || null;
  }
  patch(context, item, create = false) {
    const room = this.room(context, create);
    if (!room) return null;
    const elementId = previewElementId(item, context, !!item?.debugOnly);
    let patch = room.patches.find(row => row.elementId === elementId);
    if (!patch && item) {
      /* Compatibility for v2.1.29 category-based debug ids.  The source,
       * diagnostic/category and debug-vs-rendered ownership are stable even
       * when the debug kind token changed.  Only bind an unambiguous row. */
      const compatible = room.patches.filter(row =>
        !!row.debugOnly === !!item.debugOnly &&
        String(row.sourceKey || '') === String(item.sourceKey || '') &&
        String(row.category || '') === String(item.category || '')
      );
      if (compatible.length === 1) patch = compatible[0];
    }
    if (!patch && create) {
      const bounds = item?.bounds || { x: finite(item?.x), y: finite(item?.y), width: 1, height: 1 };
      patch = {
        elementId,
        sourceKey: item?.sourceKey || null,
        instanceKey: item?.instanceKey || null,
        traceCollection: item?.traceCollection || null,
        elementKind: item?.elementKind || item?.kind || 'element',
        category: item?.category || item?.kind || 'unclassified',
        port: item?.port || 'preview',
        debugOnly: !!item?.debugOnly,
        introducedInVersion: text(this.appVersion || this.document?.game?.appVersion || 'unknown'),
        observed: {
          x: finite(item?.x), y: finite(item?.y),
          bounds: [finite(bounds.x), finite(bounds.y), Math.max(1, finite(bounds.width, 1)), Math.max(1, finite(bounds.height, 1))],
          visible: item?.visible !== false,
          authority: item?.authority || null
        },
        target: {
          x: finite(item?.x), y: finite(item?.y),
          bounds: [finite(bounds.x), finite(bounds.y), Math.max(1, finite(bounds.width, 1)), Math.max(1, finite(bounds.height, 1))],
          visible: item?.visible !== false
        },
        change: { dx: 0, dy: 0, enabled: item?.visible !== false, bugged: '' },
        updatedAt: nowIso(this.clock)
      };
      room.patches.push(patch);
    }
    return patch || null;
  }
  update(context, item, changes = {}) {
    const patch = this.patch(context, item, true);
    if (!patch.introducedInVersion) patch.introducedInVersion = text(this.appVersion || this.document?.game?.appVersion || 'unknown');
    normalizePatchVersions({ game:this.document.game, rooms:[{ patches:[patch] }] }, this.appVersion);
    const ox = finite(patch.observed?.x), oy = finite(patch.observed?.y);
    let targetX = finite(patch.target?.x, ox + finite(patch.change?.dx));
    let targetY = finite(patch.target?.y, oy + finite(patch.change?.dy));
    if (changes.x != null) targetX = Math.round(finite(changes.x, targetX));
    else if (changes.dx != null) targetX = ox + Math.round(finite(changes.dx));
    if (changes.y != null) targetY = Math.round(finite(changes.y, targetY));
    else if (changes.dy != null) targetY = oy + Math.round(finite(changes.dy));
    const dx = Math.round(targetX - ox), dy = Math.round(targetY - oy);
    const bounds = Array.isArray(patch.observed?.bounds) ? patch.observed.bounds : [ox, oy, 1, 1];
    patch.change.dx = dx; patch.change.dy = dy;
    if (changes.enabled != null) patch.change.enabled = !!changes.enabled;
    if (changes.bugged != null) patch.change.bugged = text(changes.bugged);
    patch.target = {
      x: targetX, y: targetY,
      bounds: [finite(bounds[0]) + dx, finite(bounds[1]) + dy, Math.max(1, finite(bounds[2], 1)), Math.max(1, finite(bounds[3], 1))],
      visible: patch.change.enabled !== false
    };
    patch.updatedAt = nowIso(this.clock);
    this.#changed();
    return clone(patch);
  }
  remove(context, itemOrId) {
    const room = this.room(context, false); if (!room) return false;
    let elementId = typeof itemOrId === 'string' ? itemOrId : previewElementId(itemOrId, context, !!itemOrId?.debugOnly);
    if (typeof itemOrId !== 'string') {
      const resolved = this.patch(context, itemOrId, false);
      if (resolved?.elementId) elementId = resolved.elementId;
    }
    const before = room.patches.length;
    room.patches = room.patches.filter(row => row.elementId !== elementId);
    if (room.patches.length !== before) this.#changed();
    return room.patches.length !== before;
  }
  entriesForRoom(context) { return clone(this.room(context, false)?.patches || []); }
  diffEntriesForRoom(context) { return this.entriesForRoom(context).filter(patch => this.isPatchDirty(context, patch)); }
}

export function patchTargetState(patch) {
  const observed = patch?.observed || {};
  const change = patch?.change || {};
  const x = Number.isFinite(Number(patch?.target?.x)) ? finite(patch.target.x) : finite(observed.x) + finite(change.dx);
  const y = Number.isFinite(Number(patch?.target?.y)) ? finite(patch.target.y) : finite(observed.y) + finite(change.dy);
  return {
    x, y,
    enabled: change.enabled !== false,
    bugged: text(change.bugged),
    dx: Math.round(x - finite(observed.x)), dy: Math.round(y - finite(observed.y))
  };
}
