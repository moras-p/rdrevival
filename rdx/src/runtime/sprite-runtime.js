import { PixelBuffer } from '../render/pixel-buffer.js';
import {
  RdxSemanticSpriteMapper,
  xrickBlockingFootOrigin,
  xrickDynamiteFootOrigin,
  xrickEntityFootOrigin
} from './sprite-mapping.js';

export const RdxSpriteMode = Object.freeze({
  classic: 0,
  rdx: 1
});

const RICK_STATE = Object.freeze({
  STOP: 0x01,
  SHOOT: 0x02,
  CLIMB: 0x04,
  JUMP: 0x08,
  ZOMBIE: 0x10,
  DEAD: 0x20,
  CRAWL: 0x40
});

const CONTROL_HORIZONTAL = 0x03;
const RDX_SCREEN_X = 0;
const CLASSIC_SCREEN_X = 32;
const PLAYFIELD_Y = 8;
const CLASSIC_TO_RDX_SHIFT_X = 0;
const RICK_ENTITY_ORIGIN_X = 11;
const RICK_ENTITY_SCREEN_Y_DELTA = -36;
const XRICK_BOMB_TICKER = 0x2d;
const XRICK_BOMB_FUSE_LAST = 0x0a;
const XRICK_BOMB_EXPLOSION_FIRST = 0x09;
const RDX_DYNAMITE_FUSE_FRAME_TICKS = Object.freeze([0, 50, 57, 64, 71]);
const RDX_DYNAMITE_EXPLOSION_FRAME_TICKS = Object.freeze([0, 5, 10, 15, 20, 25]);
const XRICK_STOPRICK_FLAG = 0x02;
const FLOOR_SPIKE_PNS = new Set([0x4c, 0x4d, 0x4e, 0x4f, 0x50, 0x51]);
const MD0011_SPIKE_PROXY_SUBMAP = 8;

/** xrick entity 0x1A/sprite 0x56 is a thin collision/trigger strip for the
 * bottom MD0011 spike mechanism.  The complete remastered spike artwork is
 * already present in the RDX scene; drawing the classic strip over it adds an
 * opaque grey slab between the blades.  Suppress only this exact Level-1
 * proxy in RDX sprite mode, while retaining it in classic presentation. */
export function isEmbeddedRdxSpikeProxy(submap, entity) {
  return Number(submap) === MD0011_SPIKE_PROXY_SUBMAP &&
    (Number(entity?.n || 0) & 0x7f) === 0x1a &&
    (Number(entity?.sprite || 0) & 0xff) === 0x56;
}

function rickEntityScreenOrigin(entity) {
  /* Native sync uses worldX = entity.x + baseDx + 11 and
   * worldY = entity.y + viewportY - 44. With the 8px HUD inset, that is
   * exactly (classic screen X 32 + entity.x + 11, entity.y - 36) in the
   * centered full-width RDX viewport.
   * Continue from the xrick entity during zombie/dead motion because the
   * native terrain player intentionally stops updating after death. */
  return {
    x: CLASSIC_SCREEN_X + Number(entity?.x || 0) + RICK_ENTITY_ORIGIN_X,
    y: Number(entity?.y || 0) + RICK_ENTITY_SCREEN_Y_DELTA
  };
}

export function selectRickAction(snapshot) {
  const state = snapshot.rick?.state ?? 0;
  const left = !!snapshot.rick?.direction;
  const direction = left ? 'left' : 'right';
  const control = snapshot.rick?.control ?? 0;
  const nativeActive = !!snapshot.collision?.native?.playerActive;
  const grounded = nativeActive
    ? !!snapshot.collision?.native?.playerGrounded
    : !(state & RICK_STATE.JUMP);

  if (state & (RICK_STATE.ZOMBIE | RICK_STATE.DEAD))
    return { action: 'die', direction: 'neutral' };
  if (state & RICK_STATE.CLIMB)
    return { action: 'ladder_climb', direction: 'neutral' };
  if (state & RICK_STATE.CRAWL)
    return { action: 'crawl', direction };
  if (state & RICK_STATE.SHOOT)
    return { action: 'shoot', direction };
  if ((state & RICK_STATE.JUMP) || (nativeActive && !grounded))
    return { action: 'jump', direction };
  if (control & CONTROL_HORIZONTAL)
    return { action: 'walk', direction };
  return { action: 'stand', direction };
}

/** Compatibility helper retained for tests and diagnostics. Runtime selection
 * uses the v27 mapper; this table is only an explicit fallback if no mapper is
 * supplied. */
function rickSourceRoleCompatible(selectedAction, sourceRole) {
  if (sourceRole === selectedAction) return true;
  return selectedAction === 'jump' && sourceRole === 'jump_alt';
}

function compressedAnimationTick(ticker, firstTicker, lastTicker, frameTicks) {
  const first = Number(firstTicker) | 0;
  const last = Number(lastTicker) | 0;
  const clamped = Math.max(last, Math.min(first, Number(ticker) | 0));
  const elapsed = first - clamped;
  const steps = first - last + 1;
  const stage = Math.min(frameTicks.length - 1,
    Math.floor(elapsed * frameTicks.length / Math.max(1, steps)));
  return frameTicks[stage];
}

/** Adapt the shorter xrick bomb lifetime to the original RDX art sequence.
 * Using a proportional raw-PF clock left PN36 on its 50-tick first frame for
 * most of xrick's 36-tick fuse, which made the fuse appear unlit. Distribute
 * the five decoded burn stages across the complete classic fuse lifetime,
 * while still selecting the exact PF frames and Jungle palette from the ROM.
 * The classic sprite mode remains xrick's native 0x22/0x23 blinking fuse. */
export function dynamiteTimelineTick(snapshot, action) {
  const ticker = Math.max(0, Math.min(XRICK_BOMB_TICKER,
    Number(snapshot?.bomb?.ticker ?? XRICK_BOMB_TICKER) | 0));
  if (action === 'dynamite_fuse') {
    return compressedAnimationTick(ticker, XRICK_BOMB_TICKER,
      XRICK_BOMB_FUSE_LAST, RDX_DYNAMITE_FUSE_FRAME_TICKS);
  }
  if (action === 'dynamite_explosion') {
    return compressedAnimationTick(ticker, XRICK_BOMB_EXPLOSION_FIRST,
      1, RDX_DYNAMITE_EXPLOSION_FRAME_TICKS);
  }
  return null;
}

export function selectRickAnimation(snapshot, mapper = null, entity = null) {
  const selected = selectRickAction(snapshot);
  if (mapper) {
    /* Rick's gameplay state is authoritative. The classic source sprite can
     * legally retain a walk frame while Rick is already idle, so resolving by
     * sprite first makes the RDX stand animation look like a walk cycle. Keep
     * source-frame specificity only for a state-compatible variant such as
     * the alternate jump pose. */
    if (entity) {
      const source = mapper.resolveRickEntity(entity, null);
      if (source.status === 'mapped' && rickSourceRoleCompatible(selected.action, source.role)) {
        return source;
      }
    }
    return mapper.resolveRick(selected.action, selected.direction);
  }
  const key = `${selected.action}:${selected.direction}`;
  const pn = {
    'die:neutral': 0x60,
    'ladder_climb:neutral': 0x5d,
    'crawl:right': 0x5e,
    'crawl:left': 0x5f,
    'shoot:right': 0x5b,
    'shoot:left': 0x5c,
    'jump:right': 0x61,
    'jump:left': 0x62,
    'walk:right': 0x6b,
    'walk:left': 0x6c,
    'stand:right': 0x63,
    'stand:left': 0x64
  }[key];
  return { status: 'mapped', pn, ...selected, role: selected.action, confidence: 'high', mappingId: 'rick-v27-fallback' };
}

function framePlacement(frame, anchor, originX, originY, metadata) {
  if (!frame || !anchor) return null;
  return {
    pixels: frame.pixels,
    x: Math.round(originX - anchor.x),
    y: Math.round(originY - anchor.y),
    pn: frame.pn?.index ?? metadata.pn,
    frameIndex: frame.frameIndex ?? 0,
    ...metadata
  };
}

/** Alpha-composite all RDX replacements into one transparent layer. Canvas
 * putImageData replaces transparent pixels as well as opaque ones, so drawing
 * each actor separately erases actors already drawn underneath. PixelBuffer
 * blitting preserves destination pixels wherever the later sprite is
 * transparent. */
export function composeSpritePlacements(width, height, placements) {
  const output = new PixelBuffer(width, height);
  for (const placement of placements || []) {
    if (!placement?.pixels) continue;
    output.blit(placement.pixels, Math.round(placement.x), Math.round(placement.y));
  }
  return output;
}

/** The Level-1 floor-spike PI records use opaque palette black around the
 * spike silhouettes even though the original presentation exposes the map
 * through those gaps. Apply a narrowly scoped chroma-key correction only to
 * the curated floor-spike mapping; other actors retain black outlines. */
export function applyMappedTransparency(frame, mapping) {
  if (!frame?.pixels?.data || mapping?.assetKey !== 'x:entity_2D' ||
      !FLOOR_SPIKE_PNS.has(Number(mapping.pn))) return frame;
  const pixels = new PixelBuffer(frame.pixels.width, frame.pixels.height);
  pixels.data.set(frame.pixels.data);
  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    if (pixels.data[offset] === 0 && pixels.data[offset + 1] === 0 &&
        pixels.data[offset + 2] === 0 && pixels.data[offset + 3] !== 0) {
      pixels.data[offset + 3] = 0;
    }
  }
  return { ...frame, pixels, transparencyMode: 'floor-spike-black-key' };
}

/** Browser-side v27 semantic sprite adapter. Gameplay, positions, collision,
 * and entity lifetimes stay xrick-owned. Only visual actions with a
 * medium-or-better RDX PN mapping replace their classic sprite. */
export class RdxSpriteRuntime {
  constructor(spriteDecoder, mapping, options = {}) {
    this.spriteDecoder = spriteDecoder;
    this.mapper = new RdxSemanticSpriteMapper(mapping, options);
    this.supportResolver = typeof options.supportResolver === 'function' ? options.supportResolver : null;
    this.actorMotion = new Map();
    this.animationClocks = new Map();
    this.lastSubmap = null;
  }

  reset() {
    this.actorMotion.clear();
    this.animationClocks.clear();
    this.lastSubmap = null;
  }

  #motion(entity) {
    const previous = this.actorMotion.get(entity.slot);
    let direction = previous?.direction || 'right';
    if (previous && entity.x < previous.x) direction = 'left';
    else if (previous && entity.x > previous.x) direction = 'right';
    this.actorMotion.set(entity.slot, { x: entity.x, y: entity.y, direction });
    return { direction, dx: previous ? entity.x - previous.x : 0, dy: previous ? entity.y - previous.y : 0 };
  }

  #animationTick(slot, key, frameSerial, advance = true) {
    const serial = Number(frameSerial || 0) >>> 0;
    const previous = this.animationClocks.get(slot);
    if (!previous || previous.key !== key) {
      this.animationClocks.set(slot, { key, serial, tick: 0 });
      return 0;
    }
    const rawDelta = (serial - previous.serial) >>> 0;
    const delta = rawDelta < 0x80000000 ? Math.min(rawDelta, 60) : 0;
    const tick = advance ? previous.tick + delta : previous.tick;
    /* Always consume the serial delta while paused so releasing the pause
     * cannot fast-forward the animation clock. */
    this.animationClocks.set(slot, { key, serial, tick });
    return tick;
  }

  #frame(slot, mapping, frameSerial, palette, snapshot = null) {
    const key = `${mapping.mappingId || mapping.assetKey || 'mapping'}:${mapping.pn}:${mapping.action}:${mapping.direction}`;
    const utilityTick = mapping.assetKey === 'x:utility_dynamite'
      ? dynamiteTimelineTick(snapshot, mapping.action) : null;
    const tick = utilityTick == null
      ? this.#animationTick(slot, key, frameSerial, mapping.animationPaused !== true)
      : utilityTick;
    /* RDX PN direction metadata describes gameplay direction, but the stored
     * PI graphics use the opposite horizontal presentation. The sourcefix-v27
     * matcher corrects every directional PN at display time. Neutral actions
     * (death, ladder, static objects) remain unmirrored. */
    const frame = this.spriteDecoder.frameForPn(mapping.pn, tick, palette, { mirrorX: mapping.mirrorX === true });
    return applyMappedTransparency(frame, mapping);
  }

  renderPlan(snapshot, palette, viewport) {
    const submap = Number(snapshot.submap ?? -1);
    if (this.lastSubmap !== submap) {
      this.actorMotion.clear();
      this.animationClocks.clear();
      this.lastSubmap = submap;
    }

    const placements = [];
    const activeSlots = new Set();
    let replacementMask = 0;
    const stats = { mapped: 0, fallback: 0, suppressed: 0, rick: 0, entities: 0, mappingVersion: this.mapper.mapping.data.version };
    const native = snapshot.collision?.native;
    const rick = snapshot.entities?.find(entity => entity.slot === 1 && entity.n && entity.n !== 0xff);

    if (rick) activeSlots.add(1);
    const nativePlayerVisual = !!native?.playerActive;
    if (rick && (!nativePlayerVisual || native.playerSpawnValid)) {
      const dying = !!((snapshot.rick?.state ?? 0) & (RICK_STATE.ZOMBIE | RICK_STATE.DEAD));
      const entityOrigin = rickEntityScreenOrigin(rick);
      const rickMotion = this.#motion({
        slot: 1,
        x: (dying || !nativePlayerVisual) ? entityOrigin.x : Number(native.playerWorldX ?? rick.x ?? 0),
        y: (dying || !nativePlayerVisual) ? entityOrigin.y : Number(native.playerWorldY ?? rick.y ?? 0)
      });
      const animation = selectRickAnimation(snapshot, this.mapper, rick);
      /* The original ladder pose advances only while Rick changes vertical
       * position. Neutral ladder hold keeps the current PF instead of walking
       * in place. */
      animation.animationPaused =
        (animation.action === 'ladder_climb' && rickMotion.dy === 0) ||
        (animation.action === 'crawl' && rickMotion.dx === 0);
      if (animation.status === 'mapped') {
        const frame = this.#frame(1, animation, snapshot.frameSerial, palette, snapshot);
        const actorId = dying ? 0x61 : 0x5d;
        const anchor = this.spriteDecoder.placementAnchor(frame, actorId);
        const originX = (dying || !nativePlayerVisual)
          ? entityOrigin.x : Number(native.playerScreenX) + CLASSIC_TO_RDX_SHIFT_X;
        const originY = (dying || !nativePlayerVisual)
          ? entityOrigin.y : Number(native.playerScreenY);
        const placement = framePlacement(frame, anchor, originX, originY, {
          slot: 1,
          actorId,
          source: 'v27-rick-action',
          action: animation.action,
          direction: animation.direction,
          confidence: animation.confidence,
          mappingId: animation.mappingId,
          pn: animation.pn,
          mirrored: animation.mirrorX === true,
          anchorMode: anchor.mode || 'derived-foot',
          /* A dying Rick is the top-most gameplay actor in the original
           * presentation. Draw him above classic fallbacks, other RDX actors,
           * and Plane A foreground tiles while the zombie trajectory runs. */
          presentationLayer: dying ? 'front' : 'normal'
        });
        if (placement) {
          placements.push(placement);
          replacementMask |= (1 << 1);
          stats.mapped += 1;
          stats.rick += 1;
        }
      }
    }

    for (const entity of snapshot.entities || []) {
      if (entity.slot === 1 || !entity.n || entity.n === 0xff) continue;
      activeSlots.add(entity.slot);
      if (isEmbeddedRdxSpikeProxy(submap, entity)) {
        replacementMask |= (1 << entity.slot);
        stats.suppressed += 1;
        continue;
      }
      const motion = this.#motion(entity);
      const mapping = this.mapper.resolveEntity(entity, motion);
      if (mapping.status !== 'mapped') {
        stats.fallback += 1;
        continue;
      }

      const frame = this.#frame(entity.slot, mapping, snapshot.frameSerial, palette, snapshot);
      if (!frame) {
        stats.fallback += 1;
        continue;
      }

      const actor = entity.actorCollision;
      let originScreenX;
      let originScreenY;
      let actorId = 0;
      let originMode = 'xrick-visual-foot-v27';
      const zombie = (Number(entity.n || 0) & 0x7f) === 0x47;
      if (!zombie && actor?.source === 2 && actor.actorId === 0x03) {
        /* Exact PA 0x03 bounds {-11,-19,+8,-1}. Use the verified world origin
         * only while the live actor owns that box. Zombie motion is xrick-
         * owned and must follow the falling entity instead of a stale box. */
        actorId = actor.actorId;
        const originWorldX = actor.left + 11;
        const originWorldY = actor.bottom + 1;
        originScreenX = RDX_SCREEN_X + originWorldX - viewport.x;
        originScreenY = PLAYFIELD_Y + originWorldY - viewport.y;
        originMode = 'verified-rdx-origin';
      } else {
        let foot;
        if (mapping.assetKey === 'x:utility_dynamite')
          foot = xrickDynamiteFootOrigin(entity);
        else if (mapping.assetKey === 'x:entity_2C' ||
                 (Number(entity.flags || 0) & XRICK_STOPRICK_FLAG))
          foot = xrickBlockingFootOrigin(entity);
        else
          foot = xrickEntityFootOrigin(entity);
        originScreenX = CLASSIC_SCREEN_X + foot.x;
        originScreenY = PLAYFIELD_Y + foot.y;
        if (zombie) originMode = 'xrick-zombie-motion-v27';
        else if (mapping.assetKey === 'x:utility_dynamite') originMode = 'xrick-dynamite-foot-sourcefix';
        else if (mapping.assetKey === 'x:entity_2C') originMode = 'xrick-short-block-surface-foot';
        else if (Number(entity.flags || 0) & XRICK_STOPRICK_FLAG) originMode = 'xrick-blocking-surface-foot';
      }
      const entityType = Number(entity.n || 0) & 0x7f;
      const intactCollectible = entityType >= 0x12 && entityType <= 0x17 &&
        (Number(entity.sprite || 0) & 0xff) !== 0xad;
      const mappedAmmo = entityType >= 0x10 && entityType <= 0x11 && Number(mapping.pn) === 67;
      if (this.supportResolver && (mappedAmmo || intactCollectible)) {
        const span = mappedAmmo ? 28 : 16;
        const world = this.supportResolver({
          submap, originX: viewport.x + originScreenX - RDX_SCREEN_X,
          originY: viewport.y + originScreenY - PLAYFIELD_Y,
          span, height: mappedAmmo ? 18 : 18,
          minimumSupport: mappedAmmo ? 21 : 12
        });
        if (world?.shifted) {
          originScreenX = RDX_SCREEN_X + Number(world.x) - viewport.x;
          originScreenY = PLAYFIELD_Y + Number(world.y) - viewport.y;
          originMode = mappedAmmo ? 'rdx-supported-ammo-foot' : 'rdx-supported-collectible-foot';
        }
      }

      const anchor = this.spriteDecoder.placementAnchor(frame, actorId);
      const placement = framePlacement(frame, anchor, originScreenX, originScreenY, {
        slot: entity.slot,
        actorId,
        source: mapping.assetKey === 'x:utility_dynamite' ? 'sourcefix-player-weapon' : 'v27-semantic-mapping',
        originMode,
        action: mapping.action,
        role: mapping.role,
        direction: mapping.direction,
        confidence: mapping.confidence,
        mappingId: mapping.mappingId,
        assetKey: mapping.assetKey,
        pn: mapping.pn,
        mirrored: mapping.mirrorX === true,
        anchorMode: anchor.mode || 'derived-foot',
        /* Enemy zombie/death flight is deliberately composited over all map
         * planes. Treat it like a camera gag, not a body moving through level
         * geometry; native C uses the same front-plane contract. */
        presentationLayer: zombie ? 'front' : 'normal'
      });
      if (!placement) {
        stats.fallback += 1;
        continue;
      }
      placements.push(placement);
      replacementMask |= (1 << entity.slot);
      stats.mapped += 1;
      stats.entities += 1;
    }

    for (const slot of this.animationClocks.keys()) {
      if (!activeSlots.has(slot)) this.animationClocks.delete(slot);
    }
    for (const slot of this.actorMotion.keys()) {
      if (!activeSlots.has(slot)) this.actorMotion.delete(slot);
    }

    return { placements, replacementMask: replacementMask >>> 0, stats };
  }

  placements(snapshot, palette, viewport) {
    return this.renderPlan(snapshot, palette, viewport).placements;
  }
}
