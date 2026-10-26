/* Sound emitter locations: every placed actor in the level data whose type
 * belongs to a catalog event's trap family (each dog trap, pipe-fire jet,
 * barrel, boulder ...), merged with the emitters heard in the current
 * session. Pure: room data is passed in. */

import { CATALOG_BY_ID, ENTITY_TYPES, entityTypeInfo } from './catalog.js';

/* Placed objects from resolved room files (rdx/data/levels/resolved). */
export function roomObjects(roomJson) {
  const room = roomJson?.room || roomJson;
  const objects = room?.layers?.semanticCorpus?.objects || [];
  const seen = new Set(), out = [];
  for (const o of objects) {
    const type = Number(o?.controller?.entity ?? o?.sources?.classic?.entity);
    const mark = Number(o?.sourceEvidence?.classic?.mark ?? o?.sources?.classic?.mark);
    if (!Number.isFinite(type) || !Number.isFinite(mark)) continue;
    const key = `${type}:${mark}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const origin = o?.effective?.presentationOrigin || [null, null];
    out.push({ type, mark, x: origin[0], y: origin[1] });
  }
  return { submap: Number(room?.submap), id: room?.id || null, objects: out };
}

/* Does an actor type emit this catalog event? */
export function emitsEvent(eventId, type) {
  const event = CATALOG_BY_ID[eventId];
  if (!event?.trap.length) return false;
  const t = Number(type) & 0x7f;
  const family = entityTypeInfo(t).family;
  if (event.trap.includes('*')) return t >= 0x18 && !ENTITY_TYPES[t] && family === 'trap';
  return event.trap.includes(family);
}

export const hasEmitters = eventId => !!CATALOG_BY_ID[eventId]?.trap.length;

/* Every location of the event's emitters, in room order, marked with the
 * first occurrence heard from it in the session (if any). */
export function emitterLocations(eventId, { rooms = [], session = null } = {}) {
  if (!hasEmitters(eventId)) return [];
  const rows = new Map();
  for (const r of rooms) for (const o of r.objects) {
    if (!emitsEvent(eventId, o.type)) continue;
    rows.set(`${r.submap}:${o.type}:${o.mark}`, { submap: r.submap, roomId: r.id || roomId(r.submap), type: o.type, mark: o.mark, x: o.x, y: o.y, label: entityTypeInfo(o.type).label, occurrenceId: null, heard: 0 });
  }
  for (const occ of session?.occurrencesOf(eventId) || []) {
    const src = occ.source;
    if (!src) continue;
    const key = `${occ.submap}:${src.type}:${src.mark}`;
    const row = rows.get(key) || { submap: occ.submap, roomId: roomId(occ.submap), type: src.type, mark: src.mark, x: null, y: null, label: entityTypeInfo(src.type).label, occurrenceId: null, heard: 0 };
    row.heard += 1;
    row.occurrenceId ||= occ.id;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => a.submap - b.submap || a.mark - b.mark);
}

/* Index of the location an occurrence belongs to. */
export function locationIndex(locations, occurrence) {
  if (!occurrence?.source) return -1;
  return locations.findIndex(l => l.submap === occurrence.submap && l.type === occurrence.source.type && l.mark === occurrence.source.mark);
}

export function roomId(submap) { return `SM${Number(submap).toString(16).toUpperCase().padStart(2, '0')}`; }
