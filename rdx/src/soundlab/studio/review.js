/* Design drafts and the human review queue.
 *
 * Designs are kept per catalog event. A candidate is a frozen copy of a
 * design submitted for listening (by an agent or by the person) together
 * with the objective analysis and the occurrence it was auditioned against.
 * Only a person's "fits" verdict makes a candidate publishable; agents can
 * submit and read reviews but cannot record verdicts. Storage is injectable
 * (localStorage in the page, a Map in tests). */

import { DESIGN_SCHEMA, cloneDesign } from './design.js';

export const REVIEW_SCHEMA = 'soundlab.studio-review.v1';
export const VERDICTS = Object.freeze(['fits', 'close', 'wrong']);
export const REVIEW_TAGS = Object.freeze(['too loud', 'too quiet', 'too long', 'too short', 'too bright', 'too dull', 'wrong pitch', 'wrong material', 'too repetitive', 'masks other sounds', 'bad stereo', 'clicks / artefacts']);

const KEY = 'rdx.soundlab.studio.v1';

export function memoryStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}

export class StudioStore {
  constructor(storage = memoryStorage(), { now = () => new Date().toISOString() } = {}) {
    this.storage = storage;
    this.now = now;
    this.state = { schema: REVIEW_SCHEMA, designs: {}, candidates: [], seq: 0 };
    try {
      const raw = storage.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed?.schema === REVIEW_SCHEMA) this.state = { ...this.state, ...parsed };
    } catch { /* corrupt or unavailable storage: start empty */ }
  }

  #save() { try { this.storage.setItem(KEY, JSON.stringify(this.state)); } catch { /* quota or private mode */ } }

  design(eventId) { return this.state.designs[eventId] ? cloneDesign(this.state.designs[eventId]) : null; }
  saveDesign(design) {
    if (design?.schema !== DESIGN_SCHEMA) throw new Error('Not a SoundLab Studio design');
    this.state.designs[design.eventId] = cloneDesign(design);
    this.#save();
  }
  resetDesign(eventId) { delete this.state.designs[eventId]; this.#save(); }
  designedEvents() { return Object.keys(this.state.designs); }

  submit({ design, name = '', occurrenceId = null, context = null, analysis = null, comparison = null, rationale = '', by = 'human' }) {
    const id = `c${++this.state.seq}`;
    const candidate = {
      id, name: String(name || id).slice(0, 120), eventId: design.eventId, revision: design.revision, design: cloneDesign(design),
      occurrenceId, context, analysis, comparison, rationale: String(rationale).slice(0, 2000), by,
      createdAt: this.now(), reviews: []
    };
    this.state.candidates.push(candidate);
    this.#save();
    return candidate;
  }

  /* A person's judgement. `blind` records an A/B listen: which letter the
   * person preferred and which letter the candidate was. */
  review(candidateId, { verdict, tags = [], note = '', blind = null, reviewer = 'human' }) {
    const c = this.candidate(candidateId);
    if (!c) throw new Error(`Unknown candidate ${candidateId}`);
    if (!VERDICTS.includes(verdict)) throw new Error(`Verdict must be one of ${VERDICTS.join(', ')}`);
    const row = {
      verdict, tags: tags.filter(t => typeof t === 'string').slice(0, 12), note: String(note).slice(0, 2000), reviewer, at: this.now(),
      blind: blind ? { preferred: blind.preferred, candidateWas: blind.candidateWas, preferredCandidate: blind.preferred === blind.candidateWas } : null
    };
    c.reviews.push(row);
    this.#save();
    return this.#view(c);
  }

  rename(id, name) {
    const c = this.candidate(id);
    if (!c) throw new Error(`Unknown candidate ${id}`);
    c.name = String(name).slice(0, 120) || c.id;
    this.#save();
    return this.#view(c);
  }

  candidate(id) { return this.state.candidates.find(c => c.id === id) || null; }
  status(c) { return c.reviews.at(-1)?.verdict || 'pending'; }

  list({ eventId = null, status = null } = {}) {
    return this.state.candidates
      .filter(c => (!eventId || c.eventId === eventId) && (!status || this.status(c) === status))
      .map(c => this.#view(c));
  }

  get(id) { const c = this.candidate(id); return c ? { ...this.#view(c), design: cloneDesign(c.design) } : null; }

  #view(c) {
    return {
      id: c.id, name: c.name || c.id, eventId: c.eventId, revision: c.revision, by: c.by, rationale: c.rationale, occurrenceId: c.occurrenceId,
      createdAt: c.createdAt, status: this.status(c), reviews: c.reviews.map(r => ({ ...r })),
      analysis: c.analysis, comparison: c.comparison, context: c.context, publishable: this.status(c) === 'fits'
    };
  }

  /* Approved designs as one bundle (the hand-off to the game build). */
  exportBundle() {
    const approved = this.state.candidates.filter(c => this.status(c) === 'fits');
    const latest = {};
    for (const c of approved) latest[c.eventId] = c;
    return {
      schema: 'soundlab.studio-bundle.v1', exportedAt: this.now(),
      events: Object.values(latest).map(c => ({ eventId: c.eventId, candidateId: c.id, design: cloneDesign(c.design), reviews: c.reviews }))
    };
  }
}
