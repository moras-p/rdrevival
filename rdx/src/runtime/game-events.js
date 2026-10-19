/** Versioned, independent consumer of native facts. No input/gameplay callbacks. */
export const GAME_EVENT_KIND = Object.freeze({
  1: 'world.boulder.impact', 2: 'world.boulder.roll',
  3: 'item.dynamite.placed', 4: 'item.dynamite.exploded',
  5: 'player.died', 6: 'level.transitioned', 7: 'world.mechanism.activated', 8: 'enemy.died', 9: 'player.footstep'
});

export function readGameEvents(bridge, cursor = null, maximum = 64) {
  const api = bridge.api || bridge;
  const version = api.gameEventsVersion();
  if (version !== 2) throw new Error(`Unsupported native gameplay-event ABI: ${version}`);
  const generation = api.gameEventsGeneration() >>> 0;
  const oldestSerial = api.gameEventsOldest() >>> 0;
  const latestSerial = api.gameEventsLatest() >>> 0;
  const droppedCount = api.gameEventsDropped() >>> 0;
  const reset = !!cursor && cursor.generation !== generation;
  let after = reset || !cursor ? latestSerial : cursor.serial >>> 0;
  // New subscribers attach live by default; explicit {generation,serial:0}
  // opts into retained history without pretending to have seen earlier events.
  const gap = !reset && !!cursor && oldestSerial > 0 && after < oldestSerial - 1;
  const lostCount = gap ? oldestSerial - 1 - after : 0;
  if (gap) after = oldestSerial - 1;
  const events = [];
  const limit = Math.min(256, Math.max(0, Math.trunc(maximum) || 0));
  for (let serial = after + 1; serial <= latestSerial && events.length < limit; serial++) {
    const kindId = api.gameEventKind(serial) >>> 0;
    const flags = api.gameEventFlags(serial) >>> 0;
    if (kindId === 0xffffffff) continue; // stale between snapshot and read
    events.push({
      version, generation, serial, tick: api.gameEventTick(serial) >>> 0,
      kindId, kind: GAME_EVENT_KIND[kindId] || null,
      experience: api.gameEventExperience(serial) ? 'revival' : 'classic',
      submap: api.gameEventSubmap(serial) >>> 0,
      source: flags & 12 ? {
        actorSlot: flags & 4 ? api.gameEventActor(serial) : null,
        mark: flags & 8 ? api.gameEventMark(serial) : null
      } : null,
      world: flags & 1 ? { x: api.gameEventX(serial), y: api.gameEventY(serial) } : null,
      coordinateSpace: flags & 32 ? 'rdx-world' : 'xrick-local',
      supportedContact: !!(flags & 64),
      velocity: flags & 2 ? { dx: api.gameEventDx(serial), dy: api.gameEventDy(serial) } : null,
      previousSubmap: flags & 16 ? api.gameEventPreviousSubmap(serial) : null
    });
  }
  return { version, generation, reset, gap, lostCount, droppedCount, oldestSerial,
    latestSerial, events, cursor: { generation, serial: events.at(-1)?.serial ?? after } };
}

export class GameEventDispatcher {
  constructor(bridge, clock = () => globalThis.performance?.now?.() ?? 0) {
    this.bridge = bridge;
    this.clock = clock;
    this.cursor = null;
    this.listeners = new Set();
    this.suspended = false;
  }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  reset() { this.cursor = null; }
  suspend() { this.suspended = true; }
  resume({ skipStale = true } = {}) {
    this.suspended = false;
    if (skipStale) this.cursor = null;
  }
  poll(max = 64) {
    if (this.suspended) return null;
    const batch = readGameEvents(this.bridge, this.cursor, max);
    this.cursor = batch.cursor;
    const observedAt = this.clock();
    for (const listener of [...this.listeners]) {
      if (batch.reset || batch.gap) listener({ type: batch.reset ? 'reset' : 'gap', batch, observedAt });
      for (const event of batch.events) listener({ type: 'event', event, observedAt });
    }
    return batch;
  }
}
