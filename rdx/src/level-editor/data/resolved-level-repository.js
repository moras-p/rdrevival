const DEFAULT_RESOLVED_LEVELS_URL = './rdx/data/levels/resolved/levels.json';
const DEFAULT_RESOLVED_MANIFEST_URL = './rdx/data/levels/resolved/manifest.json';
const RESOLVED_SCHEMA = 'rdr.resolved_levels.v1';
const MANIFEST_SCHEMA = 'rdr.resolved_levels_manifest.v1';
const ROOM_SCHEMA = 'rdr.resolved_level_room.v2';

async function defaultFetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Level Editor data request failed: ${response.status} ${response.statusText} (${url})`);
  return response.json();
}

function roomLabel(room) {
  return room?.id || `SM${Number(room?.submap || 0).toString(16).toUpperCase().padStart(2, '0')}`;
}

function defaultRoomUrl(room) {
  return room?.resource || `./rdx/data/levels/resolved/rooms/${roomLabel(room)}.json`;
}

function freezeRows(rows) { return Object.freeze((rows || []).map(row => Object.freeze({ ...row }))); }

export class ResolvedLevelRepository {
  constructor({
    fetchJson = defaultFetchJson,
    resolvedLevelsUrl = DEFAULT_RESOLVED_LEVELS_URL,
    manifestUrl = DEFAULT_RESOLVED_MANIFEST_URL,
    roomUrlFor = defaultRoomUrl,
    aggregateFallback = true
  } = {}) {
    this.fetchJson = fetchJson;
    this.resolvedLevelsUrl = resolvedLevelsUrl;
    this.manifestUrl = manifestUrl;
    this.roomUrlFor = roomUrlFor;
    this.aggregateFallback = aggregateFallback;
    this.resolvedPromise = null;
    this.manifestPromise = null;
    this.roomPromises = new Map();
  }

  async manifest() {
    if (!this.manifestPromise) {
      this.manifestPromise = Promise.resolve(this.fetchJson(this.manifestUrl)).then(model => {
        if (model?.schema !== MANIFEST_SCHEMA) throw new Error(`Expected ${MANIFEST_SCHEMA}, received ${model?.schema || 'missing schema'}`);
        return model;
      }).catch(error => {
        this.manifestPromise = null;
        throw error;
      });
    }
    return this.manifestPromise;
  }

  async resolvedLevels() {
    if (!this.resolvedPromise) {
      this.resolvedPromise = Promise.resolve(this.fetchJson(this.resolvedLevelsUrl)).then(model => {
        if (model?.schema !== RESOLVED_SCHEMA) throw new Error(`Expected ${RESOLVED_SCHEMA}, received ${model?.schema || 'missing schema'}`);
        return model;
      }).catch(error => {
        this.resolvedPromise = null;
        throw error;
      });
    }
    return this.resolvedPromise;
  }

  async listRooms() {
    const model = await this.manifest();
    return Object.freeze((model.rooms || []).map(room => Object.freeze({
      id: roomLabel(room),
      submap: Number(room.submap),
      mapId: Number(room.mapId),
      mapName: String(room.mapName || ''),
      group: String(room.group || ''),
      fingerprint: room.fingerprint || null,
      migrationStatus: room.migrationStatus || null,
      resource: room.resource || defaultRoomUrl(room)
    })));
  }

  async roomStaticModel(submap) {
    const index = Number(submap);
    if (this.roomPromises.has(index)) return this.roomPromises.get(index);
    const promise = (async () => {
      const manifest = await this.manifest();
      const descriptor = (manifest.rooms || []).find(row => Number(row.submap) === index);
      if (!descriptor) throw new Error(`ResolvedLevel manifest has no room for submap ${submap}`);
      try {
        const projection = await this.fetchJson(this.roomUrlFor(descriptor));
        if (projection?.schema !== ROOM_SCHEMA) throw new Error(`Expected ${ROOM_SCHEMA}, received ${projection?.schema || 'missing schema'}`);
        if (Number(projection?.room?.submap) !== index) throw new Error(`Room projection submap mismatch for ${roomLabel(descriptor)}`);
        return projection.room;
      } catch (error) {
        if (!this.aggregateFallback) throw error;
        const model = await this.resolvedLevels();
        const room = (model.rooms || []).find(row => Number(row.submap) === index);
        if (!room) throw error;
        return room;
      }
    })().catch(error => {
      this.roomPromises.delete(index);
      throw error;
    });
    this.roomPromises.set(index, promise);
    return promise;
  }

  async rawRdxSource(submap) { return (await this.roomStaticModel(submap))?.layers?.source?.rdx || null; }
  async classicSource(submap) { return (await this.roomStaticModel(submap))?.layers?.source?.classic || null; }
  async effectiveRoom(submap) {
    const room = await this.roomStaticModel(submap);
    return Object.freeze({ effective: room.effective, layers: room.layers, provenance: room.provenance, fingerprints: room.fingerprints });
  }
  async semanticObjects(submap) { return freezeRows((await this.roomStaticModel(submap))?.layers?.semanticCorpus?.objects || []); }

  async layerProjection(submap, layer) {
    const room = await this.roomStaticModel(submap);
    const key = String(layer || '').toUpperCase();
    const value = key === 'A' ? room?.layers?.source?.rdx
      : key === 'B' ? room?.layers?.source?.classic
      : key === 'C' ? room?.layers?.alignment
      : key === 'D' ? room?.layers?.structuralCorrections
      : key === 'E' ? room?.layers?.semanticCorpus
      : key === 'F' ? room?.layers?.adjustments
      : key === 'EFFECTIVE' ? room?.effective
      : null;
    if (value == null) throw new Error(`Unknown or unavailable level layer '${layer}'`);
    return value;
  }

  async provenance(submap) {
    const room = await this.roomStaticModel(submap);
    const rows = [
      { layer:'A', label:'Decoded RDX source', value:room?.layers?.source?.rdx, authority:room?.layers?.source?.rdx?.visualAuthority || 'rdx-source-leg' },
      { layer:'B', label:'Normalized Classic/xrick source', value:room?.layers?.source?.classic, authority:'rdr-generated-classic-source-leg' },
      { layer:'C', label:'Reviewed Classic→RDX alignment', value:room?.layers?.alignment, authority:'reviewed-room-correspondence' },
      { layer:'D', label:'Structural RDX corrections', value:room?.layers?.structuralCorrections, authority:'reviewed-structural-corrections' },
      { layer:'E', label:'Semantic corpus / relationships', value:room?.layers?.semanticCorpus, authority:'resolved-semantic-corpus' },
      { layer:'F', label:'Placement / typed-bounds residuals', value:room?.layers?.adjustments, authority:'reviewed-adjustments' },
      { layer:'effective', label:'ResolvedLevel effective state', value:room?.effective, authority:'resolved-level' }
    ];
    return Object.freeze(rows.map(row => Object.freeze(row)));
  }

  async relationships(submap) {
    const room = await this.roomStaticModel(submap);
    const objects = room?.layers?.semanticCorpus?.objects || [];
    const edges = [];
    const nodes = new Map();
    const addNode = node => { if (node?.id) nodes.set(node.id, Object.freeze(node)); };
    const addEdge = edge => edges.push(Object.freeze(edge));
    for (const object of objects) {
      const semanticId = String(object.semanticId);
      addNode({ id:semanticId, kind:'semantic-object', label:semanticId, class:object.class, position:object?.effective?.position || object?.effective?.visualAnchor || object?.states?.snapshot?.draw || null });
      for (const source of Object.values(object.sources || {})) {
        if (!source?.ref) continue;
        addNode({ id:String(source.ref), kind:'source', label:String(source.ref), position:null, coordinateSpace:'source-record' });
        addEdge({ id:`source:${source.ref}->${semanticId}`, type:'source-effective', from:String(source.ref), to:semanticId, authority:'ResolvedLevel source association' });
      }
      for (const component of object.components || []) {
        const componentId = `component:${semanticId}:${component.key}`;
        addNode({ id:componentId, kind:'presentation-component', label:component.key, position:object?.states?.snapshot?.draw || object?.effective?.position || null });
        addEdge({ id:`presentation:${componentId}->${semanticId}`, type:'presentation-association', from:componentId, to:semanticId, authority:component.owner || object?.presentation?.owner || 'presentation' });
      }
      const emitter = object.projectileEmitterResolved || object.projectileEmitter;
      if (emitter?.linked && Array.isArray(emitter.origin)) {
        const emitterId = `emitter:${semanticId}:${Number(emitter.spawnIndex ?? -1)}`;
        addNode({ id:emitterId, kind:'projectile-emitter', label:`Emitter ${emitter.spawnIndex ?? ''}`.trim(), position:emitter.origin });
        addEdge({ id:`shooter:${semanticId}->${emitterId}`, type:'shooter-emitter', from:semanticId, to:emitterId, authority:emitter.authority || 'semantic-emitter-link' });
      }
      for (const relation of object.relationships || []) {
        if (!relation) continue;
        const target = String(relation.target || relation.to || relation.semanticId || '');
        if (!target) continue;
        addEdge({ id:relation.id || `relationship:${semanticId}->${target}`, type:relation.type || 'semantic', from:semanticId, to:target, authority:relation.authority || 'semantic-corpus' });
      }
    }
    for (const hazard of room?.layers?.semanticCorpus?.terrainHazards || []) {
      const semanticId = String(hazard.semanticId || hazard.id);
      addNode({ id:semanticId, kind:'terrain-hazard', label:String(hazard.id || semanticId), class:'trap', position:hazard?.effective?.position || hazard.position || null });
      if (hazard.sourceKey) {
        const sourceId = String(hazard.sourceKey);
        addNode({ id:sourceId, kind:'source', label:sourceId, position:null, coordinateSpace:'source-record' });
        addEdge({ id:`source:${sourceId}->${semanticId}`, type:'source-effective', from:sourceId, to:semanticId, authority:hazard.authority || 'resolved-terrain-hazard' });
      }
    }
    return Object.freeze({ nodes:Object.freeze([...nodes.values()]), edges:Object.freeze(edges) });
  }

  async geometryProvenance(submap) {
    const room = await this.roomStaticModel(submap);
    const structural = room?.layers?.structuralCorrections?.operations || [];
    const adjustments = room?.layers?.adjustments?.operations || [];
    const rows = [];
    for (const operation of structural) rows.push(Object.freeze({ layer:'D', id:operation.id, type:operation.type, target:operation.sourceKey || null, bounds:operation.bounds || operation.g8Bounds || null, reason:operation.reason || operation.provenance || '', authority:operation.authority || null, operation }));
    for (const operation of adjustments) {
      if (!/bounds|position|anchor/i.test(String(operation.property || ''))) continue;
      rows.push(Object.freeze({ layer:'F', id:operation.id, type:operation.property || 'adjustment', target:operation.target || null, bounds:operation.operation?.rect || null, reason:operation.provenance || '', authority:operation.authority || null, operation }));
    }
    return Object.freeze(rows);
  }
}

export { DEFAULT_RESOLVED_LEVELS_URL, DEFAULT_RESOLVED_MANIFEST_URL, ROOM_SCHEMA };
