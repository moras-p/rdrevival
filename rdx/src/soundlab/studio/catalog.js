/* SoundLab Studio event catalog.
 *
 * Every sound the game can make (and the continuous sounds it cannot make
 * yet) is one catalog event. Recorded native sound requests and SoundLab
 * semantic observations are classified into these events by their logical
 * SFX slot, their source actor and, for traps, the source entity type. The
 * catalog is presentation data for the authoring tool; native gameplay stays
 * the only authority for when a sound fires. */

export const SFX_NAMES = Object.freeze([
  'walk', 'crawl', 'jump', 'stick', 'bullet', 'bombshht', 'explode', 'box', 'bonus',
  'sbonus1', 'sbonus2', 'pad', 'die', 'ent0', 'ent1', 'ent2', 'ent3', 'ent4', 'ent5',
  'ent6', 'ent7', 'ent8', 'stick_hit'
]);

export const SFX_ENTITY0 = 13;
export const RICK_SLOT = 1;

/* rdx_soundlab.h event ids -> semantic names used by bindings.json. */
export const SEMANTIC_EVENTS = Object.freeze({
  1: 'boulder.impact', 2: 'boulder.roll', 3: 'player.step', 4: 'player.land',
  5: 'projectile.launch', 6: 'dynamite.explosion', 7: 'platform.mechanism',
  8: 'projectile.impact', 9: 'emitter.fire', 10: 'enemy.hit', 11: 'player.scrape'
});

export const FAMILIES = Object.freeze([
  { id: 'rick', label: 'Rick' },
  { id: 'weapons', label: 'Weapons' },
  { id: 'explosives', label: 'Explosives' },
  { id: 'traps', label: 'Traps' },
  { id: 'platforms', label: 'Platforms' },
  { id: 'enemies', label: 'Enemies' },
  { id: 'pickups', label: 'Pickups' }
]);

/* Classic entity types (ent_t.n & 0x7f) with a reviewed sound identity.
 * Unlisted trap types still classify, as "trap type 0x..". */
export const ENTITY_TYPES = Object.freeze({
  0x2a: { family: 'boulder', label: 'Boulder' },
  0x32: { family: 'barrel', label: 'Rolling barrel' },
  0x33: { family: 'barrel', label: 'Rolling barrel' },
  0x3d: { family: 'barrel', label: 'Rolling barrel' },
  0x35: { family: 'dog', label: 'Dog trap' },
  0x3e: { family: 'dog', label: 'Dog trap' },
  0x42: { family: 'dog', label: 'Dog trap' },
  0x36: { family: 'blockage', label: 'Crumbling blockage' },
  0x3b: { family: 'pipe-fire', label: 'Pipe fire' },
  0x40: { family: 'pipe-fire', label: 'Pipe fire' },
  0x47: { family: 'dying-enemy', label: 'Falling enemy' }
});

export function entityTypeInfo(type) {
  const t = Number(type) & 0x7f;
  if (ENTITY_TYPES[t]) return { type: t, ...ENTITY_TYPES[t] };
  if (t === 0x01) return { type: t, family: 'rick', label: 'Rick' };
  if (t === 0x02) return { type: t, family: 'bullet', label: 'Bullet' };
  if (t === 0x03) return { type: t, family: 'dynamite', label: 'Dynamite' };
  if (t >= 0x04 && t <= 0x0f) return { type: t, family: 'enemy', label: `Enemy 0x${hex(t)}` };
  if (t >= 0x10 && t <= 0x17) return { type: t, family: 'pickup', label: `Pickup 0x${hex(t)}` };
  if (t >= 0x18) return { type: t, family: 'trap', label: `Trap 0x${hex(t)}` };
  return { type: t, family: 'unknown', label: `Entity 0x${hex(t)}` };
}

function hex(n) { return Number(n).toString(16).padStart(2, '0'); }

/* status: what exists today. `original` plays only the recovered game sound,
 * `soundlab` has a SoundLab binding, `needs-hook` cannot be emitted yet. */
const EVENTS = [
  ev('rick.step', 'rick', 'Footstep', 'Walking and ladder contacts', { sfx: ['walk'], semantic: ['player.step'], status: 'soundlab' }),
  ev('rick.crawl', 'rick', 'Crawl / scrape', 'Crawling contacts', { sfx: ['crawl'], semantic: ['player.scrape'], status: 'soundlab' }),
  ev('rick.jump', 'rick', 'Jump', 'Take-off', { sfx: ['jump'] }),
  ev('rick.land', 'rick', 'Land', 'Landing after a fall or jump', { semantic: ['player.land'], status: 'soundlab' }),
  ev('rick.pad', 'rick', 'Pad launch', 'Spring pad bounce', { sfx: ['pad'] }),
  ev('rick.stick', 'rick', 'Stick swing', 'Staff swing that misses', { sfx: ['stick'] }),
  ev('rick.stick-hit', 'rick', 'Stick hit', 'Staff connects with an enemy', { sfx: ['stick_hit'] }),
  ev('rick.death', 'rick', 'Death', 'Rick dies (trap, shot or fall)', { sfx: ['die'], source: 'rick' }),
  ev('weapon.gunfire', 'weapons', 'Gunfire', 'Rick fires the pistol', { sfx: ['bullet'], semantic: ['projectile.launch'], status: 'soundlab' }),
  ev('weapon.impact', 'weapons', 'Bullet impact', 'Bullet hits a wall or platform', { semantic: ['projectile.impact'], status: 'soundlab' }),
  ev('enemy.hit', 'enemies', 'Enemy hit', 'Bullet or staff hits an enemy', { semantic: ['enemy.hit'], status: 'soundlab' }),
  ev('enemy.death', 'enemies', 'Enemy death', 'Enemy dies', { sfx: ['die'], source: 'other' }),
  ev('dynamite.fuse', 'explosives', 'Dynamite fuse', 'Fuse burning after placement', { sfx: ['bombshht'] }),
  ev('explosion.dynamite', 'explosives', 'Dynamite explosion', 'Dynamite blast', { sfx: ['explode'], semantic: ['dynamite.explosion'], sourceFamily: ['dynamite'], status: 'soundlab' }),
  ev('explosion.box', 'explosives', 'Box explosion', 'Exploding crate', { sfx: ['explode'], sourceFamilyNot: ['dynamite'] }),
  ev('trap.boulder.trigger', 'traps', 'Boulder trigger', 'Boulder trap activates', { trap: ['boulder'] }),
  ev('trap.boulder.impact', 'traps', 'Boulder impact', 'Boulder lands or hits the floor', { semantic: ['boulder.impact'], status: 'soundlab' }),
  ev('trap.boulder.roll', 'traps', 'Boulder rolling', 'Onset today; continuous roll needs a native span', { semantic: ['boulder.roll'], status: 'soundlab' }),
  ev('trap.dog.trigger', 'traps', 'Dog trap', 'Castle dog trap activates', { trap: ['dog'] }),
  ev('trap.barrel.trigger', 'traps', 'Rolling barrel', 'Castle barrel released', { trap: ['barrel'] }),
  ev('trap.pipe-fire', 'traps', 'Pipe fire', 'Directional fire jet', { trap: ['pipe-fire'], semantic: ['emitter.fire'], status: 'soundlab' }),
  ev('trap.blockage', 'traps', 'Crumbling blockage', 'Blockage collapses', { trap: ['blockage'] }),
  ev('trap.other.trigger', 'traps', 'Other trap triggers', 'Spikes, projectiles and other entity trigger cues', { trap: ['*'] }),
  ev('platform.mechanism', 'platforms', 'Platform mechanism', 'Moving platform cog cadence', { semantic: ['platform.mechanism'], status: 'soundlab' }),
  ev('pickup.bonus', 'pickups', 'Bonus', 'Treasure pickup', { sfx: ['bonus'] }),
  ev('pickup.box', 'pickups', 'Ammo / dynamite box', 'Supply pickup', { sfx: ['box'] }),
  ev('pickup.special-start', 'pickups', 'Special bonus start', 'Special bonus sequence begins', { sfx: ['sbonus1'] }),
  ev('pickup.special-complete', 'pickups', 'Special bonus complete', 'Special bonus collected', { sfx: ['sbonus2'] }),
  /* Continuous events that need native state spans and looping voices. */
  ev('trap.boulder.rolling-loop', 'traps', 'Boulder rolling loop', 'Speed-driven roll from start to stop', { status: 'needs-hook', planned: true }),
  ev('trap.boulder.stop', 'traps', 'Boulder stop', 'Boulder comes to rest', { status: 'needs-hook', planned: true }),
  ev('platform.start', 'platforms', 'Platform start', 'WAITING to MOVING', { status: 'needs-hook', planned: true, platformTransition: 'start' }),
  ev('platform.move', 'platforms', 'Platform moving', 'Speed-driven loop while MOVING', { status: 'needs-hook', planned: true }),
  ev('platform.stop', 'platforms', 'Platform stop', 'MOVING back to WAITING', { status: 'needs-hook', planned: true, platformTransition: 'stop' }),
  ev('platform.release', 'platforms', 'Platform break-away', 'Explosion releases the platform', { status: 'needs-hook', planned: true, platformTransition: 'release' }),
  ev('dynamite.fuse-loop', 'explosives', 'Fuse loop', 'Fuse sustain until the blast', { status: 'needs-hook', planned: true }),
  ev('trap.pipe-fire.sustain', 'traps', 'Pipe fire sustain', 'Jet sustain and stop', { status: 'needs-hook', planned: true })
];

function ev(id, family, label, description, opts = {}) {
  return Object.freeze({
    id, family, label, description,
    sfx: Object.freeze(opts.sfx || []),
    semantic: Object.freeze(opts.semantic || []),
    trap: Object.freeze(opts.trap || []),
    source: opts.source || null,
    sourceFamily: opts.sourceFamily || null,
    sourceFamilyNot: opts.sourceFamilyNot || null,
    platformTransition: opts.platformTransition || null,
    status: opts.status || 'original',
    planned: !!opts.planned
  });
}

export const CATALOG = Object.freeze(EVENTS);
export const CATALOG_BY_ID = Object.freeze(Object.fromEntries(EVENTS.map(e => [e.id, e])));

/* Event groups: one moving thing heard in stages (start, move, stop) along
 * a recorded span. The group is designed as one staged design on its `lead`
 * event (the continuous one), which in context replaces every stage event
 * of the group heard on that span. `also` lists related events that keep
 * their own designs. */
export const STAGES = Object.freeze(['start', 'move', 'stop']);
export const STAGE_SEGMENT = Object.freeze({ start: 'start', move: 'loop', stop: 'stop' });
export const EVENT_GROUPS = Object.freeze([
  group('boulder', 'Boulder', 'traps', 'trap.boulder.rolling-loop', {
    start: { label: 'Release', events: ['trap.boulder.trigger'] },
    move: { label: 'Rolling', events: ['trap.boulder.roll', 'trap.boulder.rolling-loop'] },
    stop: { label: 'Comes to rest', events: ['trap.boulder.stop'] }
  }, ['trap.boulder.impact'], 'bites'),
  group('platform', 'Moving platform', 'platforms', 'platform.move', {
    start: { label: 'Starts moving', events: ['platform.start'] },
    move: { label: 'Moving', events: ['platform.move', 'platform.mechanism'] },
    stop: { label: 'Stops', events: ['platform.stop'] }
  }, ['platform.release'], 'bites'),
  group('pipe-fire', 'Pipe fire', 'traps', 'trap.pipe-fire.sustain', {
    start: { label: 'Ignites', events: ['trap.pipe-fire'] },
    move: { label: 'Burning', events: ['trap.pipe-fire.sustain'] },
    stop: { label: 'Dies out', events: [] }
  }, [], 'loop')
]);

/* `movement` is how the movement stage starts out (see MOVEMENT_METHODS):
 * rolling and grinding repeat per distance, a fire is a texture. */
function group(id, label, family, lead, stages, also = [], movement = 'bites') {
  return Object.freeze({ id, label, family, lead, movement, also: Object.freeze(also), stages: Object.freeze(STAGES.map(k => Object.freeze({ id: k, ...stages[k], events: Object.freeze(stages[k].events) }))) });
}

export const GROUP_BY_ID = Object.freeze(Object.fromEntries(EVENT_GROUPS.map(g => [g.id, g])));

/* The group an event belongs to (as a stage event or related event). */
export function groupOf(eventId) {
  return EVENT_GROUPS.find(g => g.lead === eventId || g.also.includes(eventId) || g.stages.some(s => s.events.includes(eventId))) || null;
}

/* The stage an event plays in its group ('start' | 'move' | 'stop'), or null. */
export function stageOf(eventId) {
  const g = groupOf(eventId);
  return g?.stages.find(s => s.events.includes(eventId))?.id || null;
}

/* Every event a group's staged design replaces in context. */
export function stageEvents(groupOrLead) {
  const g = typeof groupOrLead === 'string' ? EVENT_GROUPS.find(x => x.lead === groupOrLead || x.id === groupOrLead) : groupOrLead;
  return g ? g.stages.flatMap(s => s.events) : [];
}

/* Classify one recorded native SFX request. */
export function classifySound(sound) {
  const name = SFX_NAMES[sound.logicalId] || `sfx${sound.logicalId}`;
  const src = sound.source;
  const info = src ? entityTypeInfo(src.type) : null;
  const fromRick = src?.slot === RICK_SLOT;
  if (sound.logicalId >= SFX_ENTITY0 && sound.logicalId < SFX_ENTITY0 + 9) {
    const family = info?.family || 'trap';
    const exact = EVENTS.find(e => e.trap.includes(family));
    return (exact || CATALOG_BY_ID['trap.other.trigger']).id;
  }
  for (const e of EVENTS) {
    if (!e.sfx.includes(name)) continue;
    if (e.source === 'rick' && src && !fromRick) continue;
    if (e.source === 'other' && (!src || fromRick)) continue;
    if (e.sourceFamily && !e.sourceFamily.includes(info?.family)) continue;
    if (e.sourceFamilyNot && e.sourceFamilyNot.includes(info?.family)) continue;
    return e.id;
  }
  return null;
}

export function classifySemantic(name) {
  const e = EVENTS.find(row => row.semantic.includes(name));
  return e ? e.id : null;
}

export function sfxName(logicalId) { return SFX_NAMES[logicalId] || `sfx${logicalId}`; }
