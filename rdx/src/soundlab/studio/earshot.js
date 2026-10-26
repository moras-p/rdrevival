/* Earshot takes through the SoundLab authoring service (`npm run
 * soundlab:serve -- --earshot-root <earshot-main>`). Earshot is an optional,
 * offline Python generator: the service renders four deterministic takes per
 * round, optionally refining a take of the previous round in a direction.
 * Nothing here judges quality; the Studio measures takes like any other. */

import { decodeWav } from './render.js';

export const EARSHOT_DIRECTIONS = Object.freeze({
  variation: 'New seeds around the chosen take',
  crisper: 'Brighter, shorter contact',
  heavier: 'More low body',
  drier: 'Less tail',
  rougher: 'More gritty detail',
  stone: 'Stone thud: less metallic ringing, a short granular contact',
  mineral: 'Denser stone: damps the hollow low-mid tail'
});

export class EarshotService {
  constructor(base, { fetchImpl = globalThis.fetch?.bind(globalThis) } = {}) {
    this.base = String(base).replace(/\/?$/, '/');
    this.fetch = fetchImpl;
    this.connected = false;
    this.available = false;
    this.reason = 'Not connected to the SoundLab authoring service';
  }

  async #json(path, body = null) {
    const r = await this.fetch(this.base + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
    const value = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
    if (!r.ok) throw new Error(value.error || `SoundLab authoring service failed (${r.status})`);
    return value;
  }

  async connect() {
    try {
      const caps = await this.#json('capabilities');
      this.connected = !!caps.connected;
      this.available = !!caps.capabilities?.earshotImprovement;
      this.reason = this.available ? '' : 'The authoring service has no Earshot (start it with --earshot-root <earshot-main>)';
    } catch {
      this.connected = false; this.available = false;
    }
    return this.status();
  }

  status() { return { connected: this.connected, available: this.available, reason: this.reason }; }

  /* Four takes for an event; `parentId` refines a take of an earlier round. */
  async round({ eventId, durationMs, seed = 13, direction = 'variation', parentId = null }) {
    if (!this.available) throw new Error(this.reason || 'Earshot is not available');
    const res = await this.#json('earshot/round', { bindingId: `studio:${eventId}`, durationMs: Math.round(durationMs), seed, direction, parentId });
    const origin = new URL(this.base, globalThis.location?.href || 'http://localhost/');
    return Promise.all(res.rows.map(async row => {
      const r = await this.fetch(new URL(row.url, origin).href);
      if (!r.ok) throw new Error('Earshot take expired; start a new round');
      const wav = decodeWav(await r.arrayBuffer());
      return { id: row.id, label: row.label, recipe: row.recipe, metrics: row.metrics, sha256: row.sha256, sample: wav };
    }));
  }
}

/* The service the Studio was opened from (same origin), or `?service=`. */
export async function discoverEarshot({ location = globalThis.location, fetchImpl } = {}) {
  const param = location ? new URL(location.href).searchParams.get('service') : null;
  const service = new EarshotService(param || '__soundlab/api/', { fetchImpl });
  await service.connect();
  return service;
}
