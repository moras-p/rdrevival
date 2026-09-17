import { motifsForGroup, materialsForGroup, normalizeTerrainResources } from '../domain/terrain-model.js';

export const DEFAULT_TERRAIN_RESOURCES_URL = './rdx/data/level-editor/terrain-resources.json';

async function defaultFetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Level Editor terrain resource request failed: ${response.status} ${response.statusText} (${url})`);
  return response.json();
}

export class TerrainResourceRepository {
  constructor({ fetchJson = defaultFetchJson, terrainResourcesUrl = DEFAULT_TERRAIN_RESOURCES_URL } = {}) {
    this.fetchJson = fetchJson;
    this.terrainResourcesUrl = terrainResourcesUrl;
    this.catalogPromise = null;
  }

  async catalog() {
    if (!this.catalogPromise) {
      this.catalogPromise = Promise.resolve(this.fetchJson(this.terrainResourcesUrl)).then(normalizeTerrainResources).catch(error => {
        this.catalogPromise = null;
        throw error;
      });
    }
    return this.catalogPromise;
  }

  async resourcesForGroup(group) {
    const catalog = await this.catalog();
    return Object.freeze({
      catalog,
      group: String(group || ''),
      families: catalog.families,
      materials: Object.freeze(materialsForGroup(catalog, group)),
      motifs: Object.freeze(motifsForGroup(catalog, group))
    });
  }

  async resourcesForRoom(room) { return this.resourcesForGroup(room?.group || ''); }
}
