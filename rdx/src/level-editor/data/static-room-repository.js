import { RdxRom } from '../../core/rom.js';
import { RdxMapDecoder } from '../../core/map.js';
import { RdxSpriteDecoder } from '../../core/sprite.js';
import { PaletteRegistry } from '../../data/palettes.js';
import { RdxMapping } from '../../runtime/mapping.js';
import { ClassicRdxCellShiftMap } from '../../runtime/classic-rdx-cell-shift-map.js';
import { ResolvedLevelRepository } from './resolved-level-repository.js';

export const STATIC_ROOM_RESOURCES = Object.freeze({
  rom: './rdx/data/editor/Rick_Dangerous_DX_1.3x.bin',
  mapping: './rdx/data/rd_asset_mapping_v1.json',
  matcherDiff: './rdx/data/rd_asset_matcher_diff_sourcefix_v27_curated.json',
  palettes: './rdx/data/palettes.json',
  visualAssets: './rdx/data/editor/visual-assets.json',
  classicPreview: './rdx/data/preview/classic_level_preview.json',
  collision: './rdx/data/collision/rdx_collision_runtime.json',
  trapRegistry: './rdx/data/preview/trap_registry.json',
  scriptedPaths: './rdx/data/preview/classic_scripted_paths.json'
});

async function defaultFetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Level Editor resource request failed: ${response.status} ${response.statusText} (${url})`);
  return response.json();
}

async function defaultFetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Level Editor binary request failed: ${response.status} ${response.statusText} (${url})`);
  return new Uint8Array(await response.arrayBuffer());
}

function roomKey(mapId) { return `MD${Math.max(0, Number(mapId) | 0).toString().padStart(4, '0')}`; }
function freezeObject(value) { return value && typeof value === 'object' ? Object.freeze(value) : value; }

export class StaticRoomRepository {
  constructor({
    levelRepository = null,
    fetchJson = defaultFetchJson,
    fetchBytes = defaultFetchBytes,
    resources = STATIC_ROOM_RESOURCES
  } = {}) {
    this.fetchJson = fetchJson;
    this.fetchBytes = fetchBytes;
    this.resources = { ...STATIC_ROOM_RESOURCES, ...(resources || {}) };
    this.levels = levelRepository || new ResolvedLevelRepository({ fetchJson });
    this.resourcePromises = new Map();
    this.assetPromise = null;
  }

  listRooms() { return this.levels.listRooms(); }
  roomStaticModel(submap) { return this.levels.roomStaticModel(submap); }
  rawRdxSource(submap) { return this.levels.rawRdxSource(submap); }
  classicSource(submap) { return this.levels.classicSource(submap); }
  effectiveRoom(submap) { return this.levels.effectiveRoom(submap); }
  semanticObjects(submap) { return this.levels.semanticObjects(submap); }
  layerProjection(submap, layer) { return this.levels.layerProjection(submap, layer); }
  provenance(submap) { return this.levels.provenance(submap); }
  relationships(submap) { return this.levels.relationships(submap); }
  geometryProvenance(submap) { return this.levels.geometryProvenance(submap); }

  jsonResource(key) {
    if (!this.resourcePromises.has(key)) {
      const url = this.resources[key];
      this.resourcePromises.set(key, Promise.resolve(this.fetchJson(url)).catch(error => {
        this.resourcePromises.delete(key);
        throw error;
      }));
    }
    return this.resourcePromises.get(key);
  }

  bytesResource(key) {
    const cacheKey = `bytes:${key}`;
    if (!this.resourcePromises.has(cacheKey)) {
      const url = this.resources[key];
      this.resourcePromises.set(cacheKey, Promise.resolve(this.fetchBytes(url)).catch(error => {
        this.resourcePromises.delete(cacheKey);
        throw error;
      }));
    }
    return this.resourcePromises.get(cacheKey);
  }

  async nativeRuntimeResources() {
    const [romBytes, scriptedPaths] = await Promise.all([
      this.bytesResource('rom'),
      this.jsonResource('scriptedPaths')
    ]);
    return Object.freeze({ romBytes, scriptedPaths });
  }

  async presentationAssets() {
    if (!this.assetPromise) {
      this.assetPromise = Promise.all([
        this.bytesResource('rom'),
        this.jsonResource('mapping'),
        this.jsonResource('matcherDiff'),
        this.jsonResource('palettes'),
        this.jsonResource('visualAssets'),
        this.jsonResource('classicPreview'),
        this.jsonResource('collision'),
        this.jsonResource('trapRegistry'),
        this.levels.resolvedLevels()
      ]).then(async ([bytes, mappingData, matcherDiff, paletteData, visualAssets, classicPreview, collision, trapRegistry, resolvedLevels]) => {
        if (classicPreview?.schema !== 'xrick.classic_level_preview.v2') throw new Error(`Unexpected Classic preview schema ${classicPreview?.schema || 'missing'}`);
        if (collision?.schema !== 'rdx.collision.v1') throw new Error(`Unexpected collision schema ${collision?.schema || 'missing'}`);
        const rom = await RdxRom.from(bytes, { strictHash:true, label:'Level Editor RDX ROM' });
        const mapping = new RdxMapping(mappingData, matcherDiff, resolvedLevels);
        const mapDecoder = new RdxMapDecoder(rom);
        const spriteDecoder = new RdxSpriteDecoder(rom);
        const palettes = new PaletteRegistry(paletteData);
        const correspondence = new ClassicRdxCellShiftMap({ classicData:classicPreview, mapping, collisionData:collision });
        return Object.freeze({ rom, mapping, mapDecoder, spriteDecoder, palettes, authoredVisualAssets:visualAssets, classicPreview, collision, correspondence, trapRegistry });
      }).catch(error => {
        this.assetPromise = null;
        throw error;
      });
    }
    return this.assetPromise;
  }

  async roomInspection(submap) {
    const [room, assets, provenance, relationships, geometryProvenance] = await Promise.all([
      this.roomStaticModel(submap),
      this.presentationAssets(),
      this.provenance(submap),
      this.relationships(submap),
      this.geometryProvenance(submap)
    ]);
    const classicPreview = (assets.classicPreview.rooms || []).find(row => Number(row.submap) === Number(submap)) || null;
    const collision = assets.collision?.rooms?.[roomKey(room.mapId)] || null;
    const correspondence = assets.correspondence.roomForSubmap(submap);
    return Object.freeze({
      room,
      assets,
      classicPreview: freezeObject(classicPreview),
      collision: freezeObject(collision),
      correspondence: freezeObject(correspondence),
      provenance,
      relationships,
      geometryProvenance
    });
  }
}
