import { compactGeometryIds, expandGeometrySelectors } from './geometry-ids.js';
export const PREVIEW_NOTES_SCHEMA = 'rdx.preview_notes.v1';
export const PREVIEW_NOTES_VERSION = '2026-08-11';

function finite(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function finitePn(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number < 0xff ? number : fallback;
}
function text(value, fallback = '') { return String(value ?? fallback).trim(); }
function deepClone(value) { return JSON.parse(JSON.stringify(value)); }
function nowIso(clock) { return new Date(typeof clock === 'function' ? clock() : Date.now()).toISOString(); }
function cleanObject(value) {
  return Object.fromEntries(Object.entries(value || {}).filter(([, entry]) => entry !== undefined));
}


export function isSceneryAssemblyItem(item = {}) {
  return (Number(item?.assetFlags || 0) & 0x08) !== 0 || Number(item?.visualKind || 0) === 1 ||
    (Array.isArray(item?.tileIndices) && item.tileIndices.length >= 2 && Array.isArray(item?.repeat));
}

export function compatibleRdxAssetOverride(item, savedOverride) {
  if (!savedOverride || isSceneryAssemblyItem(item)) return null;
  return savedOverride;
}

/* Debug rows are selectable review objects, but asset-edit actions must operate
 * on the real presentation object they describe. Resolve that backing object
 * without forcing the user to clear the diagnostic selection first. */
export function editablePreviewAsset(item, candidates = []) {
  if (!item) return null;
  if (!item.debugOnly) return item;
  const keys = new Set([
    item.rdxSourceKey, item.debugRow?.rdxSourceKey,
    item.sourceKey, item.parentSourceKey, item.debugRow?.parentSourceKey
  ].filter(Boolean).map(String));
  if (!keys.size) return null;
  const matches = (candidates || []).filter(candidate => !candidate?.debugOnly &&
    (keys.has(String(candidate.sourceKey || '')) || keys.has(String(candidate.parentSourceKey || ''))));
  const rdxMatches = matches.filter(candidate => String(candidate.port || '') === 'rdx');
  if (rdxMatches.length === 1) return rdxMatches[0];
  return matches.length === 1 ? matches[0] : null;
}

export function previewAssetKey(item) {
  if (!item) return '';
  if (item.assetKey) return String(item.assetKey);
  const instanceKey = text(item.instanceKey);
  if (instanceKey) return `${item.port || 'preview'}:instance:${instanceKey}`;
  const sourceKey = text(item.sourceKey);
  if (sourceKey) return `${item.port || 'preview'}:${sourceKey}`;
  if (Number.isFinite(Number(item.pn))) return `rdx:pn:${Number(item.pn)}`;
  if (Number.isFinite(Number(item.sprite))) return `classic:sprite:${Number(item.sprite)}`;
  return `${item.kind || 'asset'}:${item.id || 'unknown'}`;
}

export function normalizePreviewState(input = {}, fallback = {}) {
  const x = finite(input.x, finite(fallback.x, 0));
  const y = finite(input.y, finite(fallback.y, 0));
  const pn = finitePn(input.pn, finitePn(fallback.pn, null));
  const actorId = finite(input.actorId, finite(fallback.actorId, null));
  const animationTick = finite(input.animationTick, finite(fallback.animationTick, 0));
  const state = cleanObject({
    id: text(input.id || fallback.id),
    label: text(input.label || fallback.label || 'state'),
    order: finite(input.order, finite(fallback.order, 0)),
    tick: finite(input.tick, finite(fallback.tick, 0)),
    x,
    y,
    coordinatePolicy: text(input.coordinatePolicy || fallback.coordinatePolicy || 'world-origin-contact'),
    visible: input.visible == null ? fallback.visible !== false : input.visible !== false,
    pn,
    actorId,
    animationTick,
    direction: text(input.direction || fallback.direction || 'neutral'),
    mirrorX: input.mirrorX == null ? !!fallback.mirrorX : !!input.mirrorX,
    mirrorY: input.mirrorY == null ? !!fallback.mirrorY : !!input.mirrorY,
    quarterTurns: Math.max(0, Math.min(3, Math.round(finite(input.quarterTurns, finite(fallback.quarterTurns, 0))))) & 3,
    front: input.front == null ? !!fallback.front : !!input.front,
    note: text(input.note || fallback.note)
  });
  if (!state.id) delete state.id;
  if (pn == null) delete state.pn;
  if (actorId == null) delete state.actorId;
  return state;
}

export function createPreviewNotesDocument({ appVersion = 'unknown', romSha256 = null, createdAt = null } = {}) {
  const timestamp = createdAt || new Date().toISOString();
  return {
    schema: PREVIEW_NOTES_SCHEMA,
    version: PREVIEW_NOTES_VERSION,
    game: {
      project: 'xrick/RDX Web',
      appVersion: text(appVersion || 'unknown'),
      rdxRomSha256: romSha256 || null
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    rooms: []
  };
}

function validateDocument(document) {
  if (!document || document.schema !== PREVIEW_NOTES_SCHEMA) {
    throw new Error(`Expected ${PREVIEW_NOTES_SCHEMA}`);
  }
  if (!Array.isArray(document.rooms)) throw new Error('notes.json rooms must be an array');
  for (const room of document.rooms) for (const note of room.geometryNotes || []) {
    const selectors = Array.isArray(note.geometrySelectors) && note.geometrySelectors.length ? note.geometrySelectors : note.geometryIds;
    if (Array.isArray(selectors)) {
      try { note.geometryIds = expandGeometrySelectors(selectors); note.geometrySelectors = compactGeometryIds(note.geometryIds); } catch {}
    }
  }
  return document;
}

export class PreviewNotesStore {
  constructor(options = {}) {
    this.clock = options.clock || Date.now;
    this.storage = options.storage || null;
    this.storageKey = options.storageKey || 'rdx.preview.notes.v1';
    this.onChange = typeof options.onChange === 'function' ? options.onChange : null;
    this.sequence = 0;
    this.document = createPreviewNotesDocument({
      appVersion: options.appVersion,
      romSha256: options.romSha256,
      createdAt: nowIso(this.clock)
    });
    if (options.loadStored !== false) this.loadStored();
  }

  #id(prefix) { this.sequence += 1; return `${prefix}-${Math.floor(Number(this.clock()))}-${this.sequence}`; }
  #changed() {
    this.document.updatedAt = nowIso(this.clock);
    if (this.storage?.setItem) {
      try { this.storage.setItem(this.storageKey, JSON.stringify(this.document)); } catch {}
    }
    this.onChange?.(this.snapshot());
  }
  loadStored() {
    if (!this.storage?.getItem) return false;
    try {
      const raw = this.storage.getItem(this.storageKey);
      if (!raw) return false;
      this.document = validateDocument(JSON.parse(raw));
      return true;
    } catch { return false; }
  }
  import(document) {
    this.document = deepClone(validateDocument(document));
    this.#changed();
    return this.snapshot();
  }
  reset({ appVersion, romSha256 } = {}) {
    this.document = createPreviewNotesDocument({
      appVersion: appVersion || this.document.game?.appVersion,
      romSha256: romSha256 ?? this.document.game?.rdxRomSha256,
      createdAt: nowIso(this.clock)
    });
    this.#changed();
  }
  snapshot() { return deepClone(this.document); }
  setGameMetadata({ appVersion, romSha256 } = {}) {
    if (appVersion) this.document.game.appVersion = text(appVersion);
    if (romSha256 !== undefined) this.document.game.rdxRomSha256 = romSha256 || null;
    this.#changed();
    return this.snapshot();
  }

  room(context = {}) {
    const submap = finite(context.submap, -1);
    const mapId = finite(context.mapId, -1);
    let room = this.document.rooms.find(entry => Number(entry.submap) === submap && Number(entry.mapId) === mapId);
    if (!room) {
      room = {
        submap,
        submapName: text(context.submapName || `SM${String(Math.max(0, submap)).padStart(2, '0')}`),
        mapId,
        mapName: text(context.mapName || `MD${String(Math.max(0, mapId)).padStart(4, '0')}`),
        world: text(context.world),
        visualSource: text(context.visualSource || 'rdx'),
        assets: [],
        geometryNotes: []
      };
      this.document.rooms.push(room);
    } else {
      if (!Array.isArray(room.assets)) room.assets = [];
      if (!Array.isArray(room.geometryNotes)) room.geometryNotes = [];
      Object.assign(room, cleanObject({
        submapName: text(context.submapName || room.submapName),
        mapName: text(context.mapName || room.mapName),
        world: text(context.world || room.world),
        visualSource: text(context.visualSource || room.visualSource)
      }));
    }
    return room;
  }

  asset(context, item) {
    const room = this.room(context);
    const assetKey = previewAssetKey(item);
    let asset = room.assets.find(entry => entry.assetKey === assetKey);
    if (!asset) {
      asset = {
        assetKey,
        sourceKey: item?.sourceKey || null,
        selectionType: item?.kind || 'asset',
        category: item?.category || item?.role || 'unclassified',
        observed: cleanObject({
          port: item?.port || context.visualSource || 'rdx',
          authority: item?.authority || null,
          fallback: !!item?.fallback,
          sourceKey: item?.sourceKey || null,
          actorId: finite(item?.actorId, null),
          entity: finite(item?.entity, null),
          pn: finite(item?.pn, null),
          sprite: finite(item?.sprite, null),
          setId: item?.setId || null,
          role: item?.role || null,
          x: finite(item?.x, 0),
          y: finite(item?.y, 0),
          draw: item?.draw || null,
          bounds: item?.bounds || null
        }),
        notes: [],
        operations: [],
        rdxAssetOverride: null
      };
      room.assets.push(asset);
    } else {
      asset.category = item?.category || asset.category;
      asset.observed = { ...asset.observed, ...cleanObject({
        pn: finite(item?.pn, asset.observed?.pn),
        sprite: finite(item?.sprite, asset.observed?.sprite),
        actorId: finite(item?.actorId, asset.observed?.actorId),
        entity: finite(item?.entity, asset.observed?.entity),
        x: finite(item?.x, asset.observed?.x),
        y: finite(item?.y, asset.observed?.y),
        draw: item?.draw || asset.observed?.draw,
        bounds: item?.bounds || asset.observed?.bounds,
        fallback: item?.fallback == null ? asset.observed?.fallback : !!item.fallback,
        authority: item?.authority || asset.observed?.authority
      }) };
    }
    return asset;
  }

  setCategory(context, item, category) {
    const asset = this.asset(context, item);
    asset.category = text(category || 'unclassified');
    this.#changed();
    return asset;
  }

  addNote(context, item, note, extra = {}) {
    const value = text(note);
    if (!value) throw new Error('A note is required');
    const asset = this.asset(context, item);
    const entry = cleanObject({
      id: this.#id('note'),
      text: value,
      createdAt: nowIso(this.clock),
      tick: finite(extra.tick, 0),
      x: finite(extra.x, finite(item?.x, 0)),
      y: finite(extra.y, finite(item?.y, 0)),
      category: text(extra.category || asset.category)
    });
    asset.notes.push(entry);
    this.#changed();
    return entry;
  }

  ensureOperation(context, item, { id = '', name = '', description = '' } = {}) {
    const asset = this.asset(context, item);
    let operation = id ? asset.operations.find(entry => entry.id === id) : null;
    if (!operation) {
      operation = {
        id: id || this.#id('operation'),
        name: text(name || 'asset operation'),
        description: text(description),
        states: []
      };
      asset.operations.push(operation);
    } else {
      if (name) operation.name = text(name);
      if (description) operation.description = text(description);
    }
    this.#changed();
    return operation;
  }

  addState(context, item, operationId, stateInput) {
    const asset = this.asset(context, item);
    const operation = asset.operations.find(entry => entry.id === operationId);
    if (!operation) throw new Error('Select or create an operation first');
    const state = normalizePreviewState({ ...stateInput, id: stateInput?.id || this.#id('state') }, item);
    const index = operation.states.findIndex(entry => entry.id === state.id);
    if (index >= 0) operation.states[index] = state;
    else operation.states.push(state);
    operation.states.sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
    this.#changed();
    return state;
  }

  removeState(context, item, operationId, stateId) {
    const asset = this.asset(context, item);
    const operation = asset.operations.find(entry => entry.id === operationId);
    if (!operation) return false;
    const before = operation.states.length;
    operation.states = operation.states.filter(entry => entry.id !== stateId);
    if (operation.states.length !== before) this.#changed();
    return operation.states.length !== before;
  }

  setRdxAssetOverride(context, item, override) {
    const asset = this.asset(context, item);
    asset.rdxAssetOverride = cleanObject({
      pn: finite(override?.pn, null),
      actorId: finite(override?.actorId, finite(item?.actorId, null)),
      setId: text(override?.setId),
      action: text(override?.action),
      direction: text(override?.direction || 'neutral'),
      mirrorX: !!override?.mirrorX,
      mirrorY: !!override?.mirrorY,
      selectedAt: nowIso(this.clock),
      source: text(override?.source || 'rdx-asset-browser')
    });
    if (asset.rdxAssetOverride.pn == null) delete asset.rdxAssetOverride.pn;
    this.#changed();
    return asset.rdxAssetOverride;
  }

  clearRdxAssetOverride(context, item) {
    const asset = this.asset(context, item);
    if (asset.rdxAssetOverride == null) return false;
    asset.rdxAssetOverride = null;
    this.#changed();
    return true;
  }


  addGeometryNote(context, cells, note) {
    const value = text(note);
    if (!value) throw new Error('A geometry audit note is required');
    const rows = (cells || []).filter(Boolean).map(cell => cleanObject({
      id: text(cell.id),
      visualSource: text(cell.visualSource || context.visualSource || 'rdx'),
      kind: text(cell.kind),
      kindName: text(cell.kindName),
      bounds: {
        x:finite(cell.bounds?.x, finite(cell.grid?.x, 0) * finite(cell.grid?.size, 8)),
        y:finite(cell.bounds?.y, finite(cell.grid?.y, 0) * finite(cell.grid?.size, 8)),
        width:finite(cell.bounds?.width, finite(cell.grid?.size, 8)),
        height:finite(cell.bounds?.height, finite(cell.grid?.size, 8))
      },
      grid: cell.grid ? { size:finite(cell.grid.size, 8), x:finite(cell.grid.x, 0), y:finite(cell.grid.y, 0) } : undefined,
      logicCell: cell.logicCell ? { x:finite(cell.logicCell.x, 0), y:finite(cell.logicCell.y, 0) } : undefined,
      description: text(cell.description)
    })).filter(cell => cell.id);
    if (!rows.length) throw new Error('Select at least one geometry cell first');
    const room = this.room(context);
    if (!Array.isArray(room.geometryNotes)) room.geometryNotes = [];
    const entry = {
      id: this.#id('geometry-note'),
      text: value,
      createdAt: nowIso(this.clock),
      geometryIds: rows.map(cell => cell.id),
      geometrySelectors: compactGeometryIds(rows.map(cell => cell.id)),
      cells: rows
    };
    room.geometryNotes.push(entry);
    this.#changed();
    return entry;
  }

  geometryNotes(context = {}) {
    const submap = finite(context.submap, -1);
    const mapId = finite(context.mapId, -1);
    const room = this.document.rooms.find(entry => Number(entry.submap) === submap && Number(entry.mapId) === mapId);
    return deepClone(Array.isArray(room?.geometryNotes) ? room.geometryNotes : []);
  }

  findAsset(context, item) {
    const room = this.room(context);
    return room.assets.find(entry => entry.assetKey === previewAssetKey(item)) || null;
  }
}

export function overrideFromPreviewState(state, item = {}) {
  const normalized = normalizePreviewState(state, item);
  /* Scenery assemblies use PN255 only as a sentinel in production traces.
   * Never turn a stale state/editor PN into a sprite replacement while moving
   * a ROM tile assembly. Geometry edits must preserve tileIndices/repeat. */
  const pn = isSceneryAssemblyItem(item) ? null : finitePn(normalized.pn, finitePn(item.pn, null));
  return cleanObject({
    sourceKey: item.sourceKey || null,
    pn: pn == null ? undefined : pn,
    actorId: finite(normalized.actorId, finite(item.actorId, null)),
    x: normalized.x,
    y: normalized.y,
    visible: normalized.visible,
    mirrorX: normalized.mirrorX,
    mirrorY: normalized.mirrorY,
    quarterTurns: normalized.quarterTurns || 0,
    direction: normalized.direction,
    front: normalized.front,
    animationTick: normalized.animationTick,
    stateLabel: normalized.label,
    authority: 'preview-note-override'
  });
}
