import { REVIEWED_CORRECTIONS_SCHEMA, validateReviewedCorrectionLedger } from '../domain/reviewed-corrections.js';

const roomName = submap => `SM${Number(submap).toString(16).toUpperCase().padStart(2, '0')}`;

async function defaultFetchJson(url) {
  const response = await fetch(url);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Reviewed correction request failed: ${response.status} ${response.statusText} (${url})`);
  return response.json();
}

export class ReviewedCorrectionRepository {
  constructor({ fetchJson = defaultFetchJson, saveJson = null, baseUrl = '../config/levels/rooms' } = {}) {
    this.fetchJson = fetchJson;
    this.saveJson = saveJson;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  urlForRoom(submap) { return `${this.baseUrl}/${roomName(submap)}/reviewed-corrections.json`; }

  emptyLedger(room) {
    return { schema: REVIEWED_CORRECTIONS_SCHEMA, room: { submap:Number(room.submap), mapId:Number(room.mapId) }, corrections: [] };
  }

  async getRoomCorrections(room) {
    const loaded = await this.fetchJson(this.urlForRoom(room.submap));
    const ledger = loaded || this.emptyLedger(room);
    validateReviewedCorrectionLedger(ledger, { room, roomId:room.id, submap:room.submap, mapId:room.mapId });
    return ledger;
  }

  async saveRoomCorrections(room, ledger) {
    validateReviewedCorrectionLedger(ledger, { room, roomId:room.id, submap:room.submap, mapId:room.mapId });
    if (typeof this.saveJson !== 'function') throw new Error('ReviewedCorrectionRepository is read-only; provide saveJson for authoring');
    await this.saveJson(this.urlForRoom(room.submap), ledger);
    return ledger;
  }
}
