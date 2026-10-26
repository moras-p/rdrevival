/* Sample and environment data for the Studio renderer: the recovered game
 * samples (audio/cd32/runtime, audio/classic), the published SoundLab
 * outputs and the environment acoustics from the SoundLab manifest. Fetch
 * is injectable so node tests can serve files from disk. */

import { decodeWav, sampleKey } from './render.js';
import { roomObjects } from './emitters.js';

const REGION_FALLBACK = { 'south-america': 'temple-room', egypt: 'stone-chamber', castle: 'castle-room', 'missile-base': 'metal-room' };

export class SampleLibrary {
  constructor({ base = '', fetchImpl = globalThis.fetch?.bind(globalThis) } = {}) {
    this.base = base;
    this.fetch = fetchImpl;
    this.samples = new Map();
    this.pending = new Map();
    this.manifest = null;
    this.originals = [];
  }

  async init() {
    const json = async path => { try { const r = await this.fetch(this.base + path); return r.ok ? r.json() : null; } catch { return null; } };
    this.manifest = await json('rdx/data/soundlab/manifest.json');
    const runtime = await json('audio/cd32/runtime/manifest.json');
    const names = runtime ? collectNames(runtime) : [];
    this.originals = names.length ? names : ['walk', 'crawl', 'jump', 'stick', 'bullet', 'bombshht', 'explode', 'box', 'bonus', 'sbonus1', 'pad', 'die', 'ent0', 'ent1', 'ent2', 'ent3', 'ent4', 'ent5', 'ent6', 'stick_hit'];
    return this;
  }

  url(source) {
    if (source.type === 'original') return `${this.base}audio/cd32/runtime/${source.name}.wav`;
    if (source.type === 'classic') return `${this.base}audio/classic/${source.name}.wav`;
    if (source.type === 'published') return `${this.base}rdx/data/soundlab/${source.name}`;
    throw new Error(`Unknown sample source ${source.type}`);
  }

  /* Published master files for a SoundLab semantic event name. */
  publishedFiles(semanticName) {
    return (this.manifest?.outputs || []).filter(o => o.event === semanticName && o.profile !== 'runtime' && !String(o.file).startsWith('runtime/'))
      .sort((a, b) => (a.variant ?? 0) - (b.variant ?? 0)).map(o => o.file);
  }

  /* Every selectable sample, for the layer source picker. */
  catalogue() {
    const published = [...new Set((this.manifest?.outputs || []).filter(o => !String(o.file).startsWith('runtime/')).map(o => o.file))];
    return [
      ...this.originals.map(name => ({ type: 'original', name, label: `game · ${name}` })),
      ...published.map(name => ({ type: 'published', name, label: `soundlab · ${name.replace(/^audio\//, '')}` })),
      ...[...this.samples.keys()].filter(k => k.startsWith('take:')).map(k => ({ type: 'take', name: k.slice(5), label: `take · ${k.slice(5)}` }))
    ];
  }

  /* Placed objects of every room (for emitter locations); loaded once. */
  async levelRooms() {
    if (this.rooms) return this.rooms;
    this.rooms = (async () => {
      try {
        const r = await this.fetch(`${this.base}rdx/data/levels/resolved/manifest.json`);
        const manifest = r.ok ? await r.json() : { rooms: [] };
        const rows = await Promise.all((manifest.rooms || []).map(async room => {
          try {
            const res = await this.fetch(this.base + String(room.resource).replace(/^\.\//, ''));
            return res.ok ? roomObjects(await res.json()) : null;
          } catch { return null; }
        }));
        return rows.filter(Boolean);
      } catch { return []; }
    })();
    return this.rooms;
  }

  /* Register an external sample (e.g. an uploaded reference) under a key. */
  addSample(source, decoded) { this.samples.set(sampleKey(source), decoded); }

  environments() { return this.manifest?.previewModel?.environments || null; }

  /* Acoustic profile for a room (explicit submap override, else region). */
  environmentFor(room) {
    const env = this.environments();
    if (!env || !room) return null;
    const id = env.submaps?.[String(room.submap)]?.acoustics || env.defaultAcoustics?.[room.region] || REGION_FALLBACK[room.region];
    return env.profiles?.[id] ? { ...env.profiles[id] } : null;
  }

  async load(sources) {
    await Promise.all(sources.filter(Boolean).map(s => this.#loadOne(s)));
    return this.samples;
  }

  #loadOne(source) {
    const key = sampleKey(source);
    if (this.samples.has(key)) return Promise.resolve(this.samples.get(key));
    /* generated audio kept in the browser (Earshot takes), restored by the workbench */
    if (source.type === 'take') { this.restoreTake?.(source); return Promise.resolve(this.samples.get(key) || null); }
    if (!this.pending.has(key)) {
      this.pending.set(key, (async () => {
        try {
          const r = await this.fetch(this.url(source));
          if (!r.ok) return null;
          const decoded = decodeWav(await r.arrayBuffer());
          this.samples.set(key, decoded);
          return decoded;
        } catch { return null; } finally { this.pending.delete(key); }
      })());
    }
    return this.pending.get(key);
  }
}

function collectNames(manifest) {
  const rows = Array.isArray(manifest) ? manifest : manifest.assets || manifest.samples || manifest.files || [];
  const names = (Array.isArray(rows) ? rows : Object.keys(rows)).map(r => typeof r === 'string' ? r : r.logical || r.name || r.file)
    .filter(Boolean).map(n => String(n).replace(/\.wav$/, '').replace(/^.*\//, ''));
  return [...new Set(names)];
}
