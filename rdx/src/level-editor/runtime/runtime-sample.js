export const DEBUG_PRIMITIVE = Object.freeze({
  PLAYER: 1, ACTOR: 2, COLLECTIBLE: 3, PROJECTILE: 4, TRIGGER: 5, WALKABLE: 6, LADDER: 7, LETHAL: 8,
  IMPENETRABLE: 9, HAZARD: 10, PATH: 11, PATROL: 12, EMITTER: 13, ACTIVATION: 14, PLATFORM_BODY: 15, SUPER_PAD: 16
});

function int(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? Math.trunc(n) : fallback; }
function objects(room) { return room?.layers?.semanticCorpus?.objects || []; }
function sourceKeyFor(object, entity) { return String(object?.sources?.rdx?.sourceKey || (entity?.mark != null ? `mark:${int(entity.mark)}` : `slot:${int(entity?.slot, -1)}`)); }
function rectOf(primitive) { return Object.freeze({ x: int(primitive.x0), y: int(primitive.y0), width: Math.max(1, int(primitive.x1) - int(primitive.x0) + 1), height: Math.max(1, int(primitive.y1) - int(primitive.y0) + 1) }); }

function objectMaps(room) {
  const byMark = new Map(), bySlot = new Map();
  for (const object of objects(room)) {
    const classic = object?.sources?.classic || {};
    if (classic.mark != null) byMark.set(int(classic.mark), object);
    if (classic.slot != null) bySlot.set(int(classic.slot), object);
  }
  return { byMark, bySlot };
}

function preferredWorldPrimitive(entity, object, primitives) {
  const mark = int(entity?.mark, -1), slot = int(entity?.slot, -1);
  const find = (type, sourceId) => primitives.find(row => int(row.type) === type && int(row.sourceId, -2) === sourceId) || null;
  const platform = String(object?.family || '') === 'moving-platform' || String(object?.class || '') === 'platform';
  const projectile = String(object?.class || '') === 'projectile';
  const shooter = String(object?.class || '') === 'shooter';
  if (platform) return find(DEBUG_PRIMITIVE.PLATFORM_BODY, mark) || find(DEBUG_PRIMITIVE.ACTOR, slot) || find(DEBUG_PRIMITIVE.HAZARD, mark);
  if (projectile) return find(DEBUG_PRIMITIVE.PROJECTILE, mark) || find(DEBUG_PRIMITIVE.ACTOR, slot);
  if (shooter) return find(DEBUG_PRIMITIVE.EMITTER, mark) || find(DEBUG_PRIMITIVE.ACTOR, slot);
  return find(DEBUG_PRIMITIVE.ACTOR, slot) || find(DEBUG_PRIMITIVE.HAZARD, mark) || find(DEBUG_PRIMITIVE.COLLECTIBLE, mark) || find(DEBUG_PRIMITIVE.ACTIVATION, mark) || find(DEBUG_PRIMITIVE.PROJECTILE, mark);
}

export function sampleNativeRuntime({ room, snapshot, debugGeometry, descriptors = [], previous = null, simulationTick = 0 } = {}) {
  if (!snapshot) throw new TypeError('sampleNativeRuntime requires a native snapshot');
  const geometry = debugGeometry || { mode: 'rdx', primitives: [] };
  const primitives = Object.freeze([...(geometry.primitives || [])].map(row => Object.freeze({ ...row })));
  const maps = objectMaps(room);
  const audits = new Map((snapshot.presentation || []).map(row => [int(row.slot, -1), row]));
  const actors = [];
  for (const entity of snapshot.entities || []) {
    const object = maps.byMark.get(int(entity.mark, -1)) || maps.bySlot.get(int(entity.slot, -1)) || null;
    const sourceKey = sourceKeyFor(object, entity);
    const audit = audits.get(int(entity.slot, -1)) || null;
    const primitive = preferredWorldPrimitive(entity, object, primitives);
    const worldBounds = primitive ? rectOf(primitive) : null;
    actors.push(Object.freeze({
      sourceKey, semanticId: object?.semanticId || null, class: object?.class || null, family: object?.family || null,
      mark: int(entity.mark, -1), slot: int(entity.slot, -1), entity: int(entity.n, -1),
      nativeLocal: Object.freeze({ space: 'native-xrick-camera-entity-px', position: Object.freeze([int(entity.x), int(entity.y)]), width: int(entity.w), height: int(entity.h) }),
      presentation: audit ? Object.freeze({ space: 'native-presentation-playfield-px', origin: Object.freeze([int(audit.originX), int(audit.originY)]), draw: Object.freeze([int(audit.drawX), int(audit.drawY)]), pn: int(audit.pn), visible: int(audit.visiblePixels) > 0, mirrorX:!!audit.mirrorX, mirrorY:!!audit.mirrorY, actorDepth:String(audit.actorDepth || (audit.front ? 'front' : 'normal')), front:!!audit.front, tick:int(audit.tick) }) : null,
      worldGeometry: worldBounds ? Object.freeze({ space: 'rdx-world-px', type: int(primitive.type), flags: int(primitive.flags), bounds: worldBounds, position: Object.freeze([worldBounds.x, worldBounds.y]) }) : null,
      state: Object.freeze({ flags: int(entity.flags), c1: int(entity.c1), c2: int(entity.c2), movingPlatformState: int(entity.movingPlatformState), direction: int(entity.c1) < 0 ? 'left' : int(entity.c1) > 0 ? 'right' : 'neutral' }),
      intendedController: (descriptors || []).find(row => row.sourceKey === sourceKey) || null,
      authority: 'native-xrick-live-state'
    }));
  }
  const actorMap = new Map(actors.map(actor => [actor.sourceKey, actor]));
  const events = [];
  if (previous) {
    const previousActors = new Map((previous.actors || []).map(actor => [actor.sourceKey, actor]));
    for (const actor of actors) {
      const before = previousActors.get(actor.sourceKey);
      if (!before) { events.push(Object.freeze({ type: 'actor-activated', sourceKey: actor.sourceKey })); continue; }
      if (before.state.flags !== actor.state.flags || before.state.movingPlatformState !== actor.state.movingPlatformState) {
        events.push(Object.freeze({ type: 'actor-state-change', sourceKey: actor.sourceKey, from: Object.freeze({ flags: before.state.flags, movingPlatformState: before.state.movingPlatformState }), to: Object.freeze({ flags: actor.state.flags, movingPlatformState: actor.state.movingPlatformState }) }));
      }
    }
    for (const before of previousActors.values()) {
      if (!actorMap.has(before.sourceKey)) events.push(Object.freeze({ type: 'actor-deactivated', sourceKey: before.sourceKey }));
    }
  }
  const native = snapshot?.collision?.native || {};
  return Object.freeze({
    frameSerial: int(snapshot.frameSerial), simulationTick:int(simulationTick), submap: int(snapshot.submap), mapId: int(native.mapId, int(snapshot.map)),
    camera: Object.freeze({ space: 'native-runtime-camera', mapFrow: int(snapshot.mapFrow), visibleTopRow: int(snapshot.visibleTopRow), cameraDeltaRows: int(snapshot.cameraDeltaRows), cameraOffsetPx: int(snapshot.cameraOffsetPx) }),
    player: Object.freeze({ space: 'rdx-world-px', position: Object.freeze([int(native.playerWorldX), int(native.playerWorldY)]), screen: Object.freeze([int(native.playerScreenX), int(native.playerScreenY)]), grounded: !!native.grounded, climbing: !!native.climbing, crawling: !!native.crawling }),
    actors: Object.freeze(actors), actorMap, debugGeometry: Object.freeze({ mode: geometry.mode || 'rdx', space: geometry.mode === 'rdx' ? 'rdx-world-px' : 'classic-runtime-space', primitives }),
    events: Object.freeze(events), authority: 'native-xrick-live-sample'
  });
}
