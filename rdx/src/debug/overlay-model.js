import { RDX_PLAYFIELD, XRICK_PLAYFIELD } from '../../xrick-bridge.js';

/** C debug ABI primitive identifiers. Coordinates are inclusive world pixels. */
export const DebugPrimitiveType = Object.freeze({
  PLAYER: 1,
  ACTOR: 2,
  COLLECTIBLE: 3,
  PROJECTILE: 4,
  TRIGGER: 5,
  WALKABLE: 6,
  LADDER: 7,
  LETHAL: 8,
  IMPENETRABLE: 9,
  HAZARD: 10,
  PATH: 11,
  PATROL: 12,
  EMITTER: 13,
  ACTIVATION: 14,
  PLATFORM_BODY: 15,
  SUPER_PAD: 16,
  PLAYER_PROBE: 17
});

export const DebugPrimitiveFlag = Object.freeze({
  ONE_WAY: 0x01,
  INACTIVE: 0x02,
  EXPLODABLE: 0x04,
  SHOOTER: 0x08,
  CLASS_MASK: 0x70,
  CLASS_T1A: 0x10,
  CLASS_T1B: 0x20,
  CLASS_T2: 0x30,
  CLASS_T3: 0x40,
  CLASS_PLATFORM: 0x50,
  CLASS_PROJECTILE: 0x60,
  CLASS_ONOFF: 0x70,
  ACTIVE: 0x80,
  TRIGGER_DYNAMITE: 0x10,
  TRIGGER_BULLET: 0x20,
  TRIGGER_RICK_STOP: 0x40,
  TRIGGER_RICK_CONTACT: 0x80,
  PROBE_LEFT: 0x10,
  PROBE_RIGHT: 0x20,
  PROBE_TOP: 0x30,
  PROBE_BOTTOM: 0x40,
  PROBE_CLIMB_TOP: 0x50,
  PROBE_CLIMB_BOTTOM: 0x60
});

function freezeViewport(viewport) {
  return Object.freeze({
    worldX: Number(viewport.worldX) | 0,
    worldY: Number(viewport.worldY) | 0,
    screenX: Number(viewport.screenX) | 0,
    screenY: Number(viewport.screenY) | 0,
    width: Number(viewport.width) >>> 0,
    height: Number(viewport.height) >>> 0
  });
}

export function worldToScreen(viewport, worldX, worldY) {
  return Object.freeze({
    x: viewport.screenX + (Number(worldX) - viewport.worldX),
    y: viewport.screenY + (Number(worldY) - viewport.worldY)
  });
}

export function transformDebugPrimitive(viewport, primitive) {
  const a = worldToScreen(viewport, primitive.x0, primitive.y0);
  const b = worldToScreen(viewport, primitive.x1, primitive.y1);
  return Object.freeze({
    ...primitive,
    screenX0: a.x,
    screenY0: a.y,
    screenX1: b.x,
    screenY1: b.y
  });
}

function categoryName(type) {
  switch (type) {
    case DebugPrimitiveType.PLAYER: return 'playerBox';
    case DebugPrimitiveType.ACTOR: return 'actorBoxes';
    case DebugPrimitiveType.COLLECTIBLE: return 'collectibles';
    case DebugPrimitiveType.PROJECTILE: return 'projectiles';
    case DebugPrimitiveType.TRIGGER: return 'triggers';
    case DebugPrimitiveType.WALKABLE: return 'walkableSurfaces';
    case DebugPrimitiveType.LADDER: return 'ladders';
    case DebugPrimitiveType.LETHAL: return 'lethalSurfaces';
    case DebugPrimitiveType.IMPENETRABLE: return 'impenetrableWalls';
    case DebugPrimitiveType.HAZARD: return 'hazards';
    case DebugPrimitiveType.PATH: return 'paths';
    case DebugPrimitiveType.PATROL: return 'patrols';
    case DebugPrimitiveType.EMITTER: return 'emitters';
    case DebugPrimitiveType.ACTIVATION: return 'activationOrigins';
    case DebugPrimitiveType.PLATFORM_BODY: return 'platformBodies';
    case DebugPrimitiveType.SUPER_PAD: return 'superPadSurfaces';
    case DebugPrimitiveType.PLAYER_PROBE: return 'playerProbes';
    default: return 'unknown';
  }
}

function classicViewport(snapshot) {
  const committedOffset = (Number(snapshot.cameraDeltaRows) | 0) * 8;
  const inFlightOffset = (Number(snapshot.cameraOffsetPx) | 0) - committedOffset;
  // visibleTopRow is the packed xrick row and can remain pinned while Fluid-v2
  // advances through RDX-only committed rows. reachableStartRow + cameraDeltaRows
  // is the effective Classic viewport row in that case (and is identical to
  // visibleTopRow for ordinary/classic scrolling).
  const effectiveVisibleTopRow =
    (Number(snapshot.reachableStartRow) | 0) + (Number(snapshot.cameraDeltaRows) | 0);
  return freezeViewport({
    worldX: 0,
    worldY: effectiveVisibleTopRow * 8 + inFlightOffset,
    screenX: XRICK_PLAYFIELD.x,
    screenY: XRICK_PLAYFIELD.y,
    width: XRICK_PLAYFIELD.width,
    height: XRICK_PLAYFIELD.height
  });
}

function rdxViewport(snapshot, mapping) {
  const renderCameraY = Number.isFinite(Number(snapshot.renderCameraOffsetPx))
    ? Number(snapshot.renderCameraOffsetPx) | 0
    : Number(snapshot.cameraOffsetPx) | 0;
  const mapped = mapping?.viewportForSubmap(snapshot.submap, {
    cameraX: RDX_PLAYFIELD.cameraOffsetX,
    cameraY: renderCameraY,
    width: RDX_PLAYFIELD.width,
    height: RDX_PLAYFIELD.height
  });
  if (!mapped) return null;
  return freezeViewport({
    worldX: mapped.x,
    worldY: mapped.y,
    screenX: RDX_PLAYFIELD.x,
    screenY: RDX_PLAYFIELD.y,
    width: mapped.width,
    height: mapped.height
  });
}

/**
 * Build one immutable, C-fed overlay model. JavaScript never derives contacts
 * from map art; it performs only this one world-to-screen transform.
 */
export function buildDebugOverlayModel(snapshot, bridge, mapping) {
  if (!snapshot || !bridge || typeof bridge.debugGeometry !== 'function') return null;
  const descriptorWorldLoaded = !!snapshot.collision?.native?.worldLoaded;
  const wantsRdx = !!snapshot.enabled && !snapshot.classicAssets && descriptorWorldLoaded;
  const geometry = bridge.debugGeometry(wantsRdx ? 1 : 0);
  const mode = geometry.mode === 'rdx' ? 'rdx' : 'classic';
  const viewport = mode === 'rdx' ? rdxViewport(snapshot, mapping) : classicViewport(snapshot);
  if (!viewport) return null;

  const buckets = {
    playerBox: null,
    actorBoxes: [],
    collectibles: [],
    projectiles: [],
    triggers: [],
    walkableSurfaces: [],
    ladders: [],
    lethalSurfaces: [],
    impenetrableWalls: [],
    hazards: [],
    paths: [],
    patrols: [],
    emitters: [],
    activationOrigins: [],
    platformBodies: [],
    superPadSurfaces: [],
    playerProbes: [],
    unknown: []
  };
  for (const primitive of geometry.primitives) {
    const transformed = transformDebugPrimitive(viewport, primitive);
    const category = categoryName(primitive.type);
    if (category === 'playerBox') buckets.playerBox = transformed;
    else buckets[category].push(transformed);
  }
  for (const [key, value] of Object.entries(buckets)) {
    if (Array.isArray(value)) buckets[key] = Object.freeze(value);
  }
  return Object.freeze({
    frameSerial: Number(snapshot.frameSerial) >>> 0,
    mode,
    authority: mode === 'rdx' ? 'RDX descriptors + shared xrick 8px collision' : 'classic xrick collision',
    viewport,
    ...buckets
  });
}

export function primitiveVisible(viewport, primitive) {
  const left = Math.min(primitive.screenX0, primitive.screenX1);
  const right = Math.max(primitive.screenX0, primitive.screenX1);
  const top = Math.min(primitive.screenY0, primitive.screenY1);
  const bottom = Math.max(primitive.screenY0, primitive.screenY1);
  return right >= viewport.screenX && left < viewport.screenX + viewport.width &&
    bottom >= viewport.screenY && top < viewport.screenY + viewport.height;
}
