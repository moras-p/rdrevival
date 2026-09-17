import { PixelBuffer } from '../render/pixel-buffer.js';
import { rdxEnemyAnimationFamily, rdxEnemyClimbFrame, rdxEnemyPresentationTick, rdxEnemySpatialPhaseTick, rdxEnemyUsesGroundContact } from '../core/sprite.js';
import { classicRoleForEntity, effectiveClassicPatrolState, scriptedMotionAt, classicOneShotScriptedDeltaAt, productionTrackSample } from './preview-actors.js';
import { classifyClassicEnemy } from './enemy-behavior.js';
import { cd32AugmentedRdxFrame, cd32AugmentedRdxTick } from '../runtime/cd32-augmentation.js';
import { revivalBulletFrame } from '../runtime/revival-bullet.js';
import { revivalDynamiteFrameForPn } from '../runtime/revival-dynamite.js';
import { revivalIdolFrame } from '../runtime/revival-idol.js';
import { REVIVAL_MISSILE_PRESENTATION_PN, revivalMissileFrame } from '../runtime/revival-missile.js';
import { revivalAmmoBoxFrame } from '../runtime/revival-ammo-box.js';
import { decoratePreviewElement } from './preview-elements.js';
import { composeWholeRoomSimulationStates, configuredClassicBoundedPatrolState } from '../editor/whole-room-simulation.js';
import { isNativeProjectileActive } from '../editor/runtime-projectiles.js';
import { fittedClassicCollisionBounds } from './preview-collision-geometry.js';
import { drawRect } from './preview-render-primitives.js';

export function sourceKeyForState(state) {
  return state?.actor?.sourceKey || state?.sourceKey || state?.actor?.production?.sourceKey || null;
}

export function activatorTypeFromClassicFlags(flags) {
  const value = Number(flags || 0);
  if (value & 0x10) return 'explosion';
  if (value & 0x80) return 'hero-presence';
  if (value & 0x20) return 'projectile';
  if (value & 0x40) return 'hero-stop';
  return '';
}

export function previewCategory(state, fallback = '') {
  const role = String(state?.actor?.role || state?.role || state?.kind || state?.actor?.set?.type || fallback || '').toLowerCase();
  if (role === 'player') return 'hero';
  if (role === 'enemy') return 'enemy';
  if (role === 'collectible') return 'collectible';
  if (role === 'projectile') return 'projectile';
  if (role === 'shooter' || role === 'projectile-shooter') return 'projectile-shooter';
  if (role === 'trap') return 'trap';
  if (/block|rubble|wall|door/.test(role)) return 'blockage';
  if (/explod|destroy/.test(role)) return 'explodable';
  return role || 'object';
}

export function recoveredClassicSourceSprite(entity, sprite, sprbase = 0) {
  /* Resolved Classic actors already choose any semantic visible identity
   * from native ent_sprseq while retaining raw sprbase source evidence. Do not
   * re-infer type-3 identities in the renderer. */
  void entity; void sprbase;
  return Number(sprite||0)&0xff;
}

export function classicPreviewKind(role, entity, activeProjectile = false) {
  if (activeProjectile) return 'projectile';
  const semantic = classicRoleForEntity(entity, String(role || 'actor'));
  if (semantic === 'player') return 'player';
  if (semantic === 'collectible') return 'collectible';
  if (semantic === 'enemy') return 'enemy';
  if (semantic === 'lure') return 'lure';
  if (semantic === 'shooter' || semantic === 'trap') return 'trap';
  if (/block|rubble|wall|door/.test(semantic)) return 'blockage';
  if (/explod|destroy/.test(semantic)) return 'explodable';
  return 'entity';
}

export function patchedPlacementAuthority(...values) {
  return values.some(value => {
    if (value === true) return true;
    if (value && typeof value === 'object') return value.kind === 'patch' || value.classification === 'patch';
    return /reviewed|patch|manual|corrected|override|user-annotated|introduced/i.test(String(value || ''));
  });
}

export function selectableRecord(base, bounds) {
  if (!bounds) return null;
  return Object.freeze({
    ...base,
    bounds: Object.freeze({
      x: Math.round(Number(bounds.x || 0)),
      y: Math.round(Number(bounds.y || 0)),
      width: Math.max(1, Math.round(Number(bounds.width || 1))),
      height: Math.max(1, Math.round(Number(bounds.height || 1)))
    })
  });
}

export function trackSample(record, tick, allActive = false) {
  // Keep every PreviewRenderer consumer on the same capture-horizon/verified-loop
  // contract as PreviewActorSystem. Finite native evidence must never regain an
  // implicit modulo loop in overlays, mechanisms, diagnostics, or asset timelines.
  return productionTrackSample(record, tick, allActive);
}

export function productionProjectileCadenceSample(child, tick, room) {
  if (!child) return null;
  const sourceKey = String(child.sourceKey || child.triggerSourceKey || '');
  const flightPeriod = Math.max(1, Number(child.auditPeriod || child.trackPeriod || 1));
  const owner = (room?.classicActors || []).find(record => String(record?.sourceKey || '') === sourceKey) || null;
  const ownerAudit = Math.max(0, Number(owner?.auditPeriod || 0));
  const ownerTrack = Math.max(0, Number(owner?.trackPeriod || 0));
  const cadencePeriod = Math.max(flightPeriod, ownerAudit > flightPeriod ? ownerAudit : (ownerTrack > flightPeriod ? ownerTrack : 128));
  const phase = ((Math.floor(Number(tick)) % cadencePeriod) + cadencePeriod) % cadencePeriod;
  if (phase >= flightPeriod) return Object.freeze({ ...(child || {}), visible:false, cadencePeriod, cadencePhase:phase, flightPeriod });
  const sample = trackSample(child, phase, true) || child;
  return Object.freeze({ ...sample, cadencePeriod, cadencePhase:phase, flightPeriod });
}

export function productionDrawPoint(productionDraw, displayedOrigin, tracedOrigin) {
  const draw = productionDraw || [0, 0];
  const shown = displayedOrigin || tracedOrigin || [0, 0];
  const traced = tracedOrigin || shown;
  return Object.freeze([
    Math.round(Number(draw[0] || 0) + (Number(shown[0] || 0) - Number(traced[0] || 0))),
    Math.round(Number(draw[1] || 0) + (Number(shown[1] || 0) - Number(traced[1] || 0)))
  ]);
}

export function drawEnvelope(samples = []) {
  const points = samples.filter(sample => sample.visible !== false && Array.isArray(sample.draw)).map(sample => sample.draw);
  if (!points.length) return Object.freeze({ width: 0, height: 0 });
  const xs = points.map(point => Number(point[0])), ys = points.map(point => Number(point[1]));
  return Object.freeze({ width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) });
}

export function firstVisibleSample(record, coordinate = 'draw') {
  const samples = (record?.auditSamples?.length ? record.auditSamples : record?.samples) || [];
  return samples.find(sample => sample.visible !== false && Array.isArray(sample?.[coordinate])) || null;
}

export function classicEnemySpriteAt(entity, direction, tick, fallbackSprite = 0) {
  const base = Number(entity?.sprbase ?? entity?.sprite ?? fallbackSprite ?? 0);
  if (!base) return Number(fallbackSprite || 0);
  const policy = classifyClassicEnemy(entity?.n ?? entity?.entity);
  if (policy?.family === 'type2') {
    /* e_them_t2_action2 indexes ent_sprseq with 0/1 while moving right and
     * 4/5 while moving left.  The off-bank presentation cycle has no native X
     * displacement to key that phase from, so advance the same two poses from
     * the bounded editor animation tick. */
    const phase = Math.floor(Number(tick || 0) / 4) & 1;
    return direction === 'left' ? [base + 5, base + 3][phase] : [base, base + 1][phase];
  }
  const phase = Math.floor(Number(tick || 0) / 4) & 3;
  return direction === 'left' ? [base + 3, base + 4, base + 3, base + 5][phase]
    : [base, base + 1, base, base + 2][phase];
}

export function classicScriptedActiveSpriteAt(entity, tick, fallbackSprite = 0) {
  const n = Number(entity?.n ?? entity?.entity ?? 0) & 0x7f;
  if (n !== 0x2b) return Number(fallbackSprite || 0);
  /* Native e_them_t3_action2 rotates ent_sprseq from offset 1 while awake.
   * Entity 0x2B has sprbase 0x30, whose authored active sequence is exactly
   * 0x62,0x62,0x63,0x63 before the 0xff terminator. */
  return [0x62, 0x62, 0x63, 0x63][Math.max(0, Math.floor(Number(tick) || 0)) & 3];
}

export function fixedAnchorLifecycle(record) {
  return !!record?.actionStateOwner && /fixed-anchor/.test(String(record?.lifecycleAuthority || record?.auditAuthority || record?.authority || ''));
}

export function isClassicRickSprite(spriteId) {
  const id = Number(spriteId) & 0xff;
  return id >= 0x01 && id <= 0x1a;
}

export function _frameForPn(pn, tick, palette, options = {}) {
  if (Number(pn) === REVIVAL_MISSILE_PRESENTATION_PN) return revivalMissileFrame();
  const rawRdxPn = options.rawRdxPn === true;
  const ammoBoxEntity = Number(options.ammoBoxEntity);
  if (!rawRdxPn && this.ammoBoxSource === 'revival' && [67,68].includes(Number(pn))) {
    const replacement = revivalAmmoBoxFrame(ammoBoxEntity);
    if (replacement) return replacement;
  }
  if (!rawRdxPn && Number(pn) === 27) return revivalIdolFrame();
  const useDynamitePresentation = options.useDynamitePresentation !== false;
  const forceRevivalDynamite = options.forceRevivalDynamite === true;
  const dynamiteVariant = Math.max(0, Number(options.dynamiteVariant) || 0);
  const playerBullet = options.playerBullet === true && (Number(pn) === 13 || Number(pn) === 14);
  if (!rawRdxPn && playerBullet) {
    if (this.bulletSource === 'classic') return null;
    return revivalBulletFrame(tick, Number(pn) === 14);
  }
  if (!rawRdxPn && forceRevivalDynamite && (Number(pn) === 36 || Number(pn) === 41)) {
    const replacement = revivalDynamiteFrameForPn(pn, tick, dynamiteVariant);
    if (replacement) return replacement;
  }
  if (!rawRdxPn && useDynamitePresentation && this.dynamiteSource === 'classic' && (Number(pn) === 36 || Number(pn) === 41)) return null;
  if (!rawRdxPn && useDynamitePresentation && this.dynamiteSource === 'revival' && (Number(pn) === 36 || Number(pn) === 41)) {
    const replacement = revivalDynamiteFrameForPn(pn, tick, dynamiteVariant);
    if (replacement) return replacement;
  }
  if (!rawRdxPn) {
    const climb = rdxEnemyClimbFrame(this.spriteDecoder, this.classicData, pn,
      options.classicEntity, options.classicSprite, palette, options.classicClimbState);
    if (climb) return climb;
  }
  let spatialPhaseTick = 0;
  if (!rawRdxPn && Number.isFinite(Number(options.enemySpawnX)) && Number.isFinite(Number(options.enemySpawnY))) {
    const animation = this.spriteDecoder.framesForPn(pn, palette, options);
    spatialPhaseTick = rdxEnemySpatialPhaseTick(pn, options.enemySpawnX, options.enemySpawnY, animation.frames);
  }
  const sourceTick = rawRdxPn ? Math.max(0, Math.floor(Number(tick) || 0))
    : rdxEnemyPresentationTick(pn, tick, options.classicSprite, spatialPhaseTick);
  const frame = this.spriteDecoder.frameForPn(pn, cd32AugmentedRdxTick(pn, sourceTick), palette, options);
  return cd32AugmentedRdxFrame(frame, pn);
}

export function _productionEnemyAnchor(state, frame, palette) {
  const role = String(state?.actor?.role || state?.actor?.set?.type || '');
  const pn = Number(state?.pn);
  const family = rdxEnemyAnimationFamily(pn);
  const record = state?.actor?.production || null;
  const classicEntity = Number(state?.actor?.classicProduction?.entity ?? state?.actor?.classicSource?.n ?? -1) & 0x7f;
  const castleDog = family === 6 && [0x35,0x3e,0x42].includes(classicEntity);
  if ((!castleDog && role !== 'enemy') || !family || !record || !frame) return null;

  /* Castle dogs expose the exact Classic 0x6D..0x70 source pose.  Use the
   * same per-pose opaque-center/bottom registration as native C so the wider
   * 0x70 pose grows to Classic's right instead of making the RDX body twitch
   * left under the generic family-stable-X rule. */
  const sourceAnchor = this.spriteDecoder.placementAnchor(frame, 0, {
    role:'enemy', classicSprite:state?.sprite ?? state?.actor?.classicProduction?.sprite
  });
  if (sourceAnchor?.mode === 'enemy-classic-source-phase') return sourceAnchor;

  /* production_scene carries exact anchors captured from the native C
   * presenter. Use the first captured member of the current enemy family as
   * the horizontal registration reference, then preserve the current PI X.
   * This mirrors native family-stable X even when a patrol reverses PN. */
  const candidates = [record, ...(record.samples || []), ...(record.auditSamples || [])];
  const reference = candidates.find(sample => {
    const samplePn = Number(sample?.pn ?? record.pn);
    return sample?.visible !== false && Array.isArray(sample?.anchor) &&
      rdxEnemyAnimationFamily(samplePn) === family;
  });
  if (!reference) return null;
  const referencePn = Number(reference.pn ?? record.pn);
  const referenceTick = Math.max(0, Math.floor(Number(reference.tick ?? record.tick ?? 0) || 0));
  const referenceMirrorX = !!(reference.mirrorX ?? record.mirrorX ?? state.mirrorX);
  const referenceMirrorY = !!(reference.mirrorY ?? record.mirrorY ?? state.mirrorY);
  const referenceFrame = this.spriteDecoder.frameForPn(referencePn, referenceTick, palette, {
    mirrorX: referenceMirrorX, mirrorY: referenceMirrorY
  });
  if (!referenceFrame) return null;
  const x = Number(frame.originX) + Number(reference.anchor[0]) - Number(referenceFrame.originX);

  if (!rdxEnemyUsesGroundContact(pn)) {
    return {
      x,
      y: Number(frame.originY) + Number(reference.anchor[1]) - Number(referenceFrame.originY),
      mode: 'production-enemy-family-pi-origin'
    };
  }

  /* Ground-contact Y is support-foot based, not PI-origin based. Calibrate
   * the Classic support-line offset from the trace frame when possible and
   * apply it to the current source-timed RDX frame. This is what lets a
   * one-pixel-short pose move down by one pixel: feet remain planted while
   * the head/body visibly bobs. */
  let yCorrection = Number(reference.anchor[1]) - Number(referenceFrame.footAnchorY);
  const traceAnchor = Array.isArray(state.productionAnchor) ? state.productionAnchor : null;
  const tracePn = Number(state.productionPn);
  if (traceAnchor && rdxEnemyAnimationFamily(tracePn) === family) {
    const traceTick = Math.max(0, Math.floor(Number(state.productionTick) || 0));
    const traceFrame = this.spriteDecoder.frameForPn(tracePn, traceTick, palette, {
      mirrorX: !!state.mirrorX, mirrorY: !!state.mirrorY
    });
    if (traceFrame) yCorrection = Number(traceAnchor[1]) - Number(traceFrame.footAnchorY);
  }
  return {
    x,
    y: Number(frame.footAnchorY) + yCorrection,
    mode: 'production-enemy-family-x-ground-y'
  };
}

export function _actorStatesAt(tick) {
  /* Native runtime state is strongest when present.  The offline editor and
   * branch comparator have no WASM runtime, so resolved Simulate falls back
   * only to immutable Layer-B controller programs already carried by the
   * resolved model (bounded patrols, moving platforms, scripted trap bodies).
   * This is projection of controller authority, not a browser gameplay
   * solver; terrain/reactive lifecycle remains native-only. */
  if (!this.resolvedProjection || !this.activateAllTraps || this.nativeRuntimeStates.size)
    return this.actorSystem.statesAt(tick, this.activateAllTraps);
  const room = this._productionRoom();
  const supportPatrolBySource=new Map((this.actorSystem?.actors||[])
    .filter(actor=>actor?.production?.sourceKey)
    .map(actor=>[String(actor.production.sourceKey),actor.auditPatrol||null]));
  const projected = composeWholeRoomSimulationStates({
    resolvedActors: room?.actors || [], classicScriptedPaths: this.classicScriptedPaths,
    primaryStates: new Map(), tick, classicRoom:this._classicRoom(this.selection.submap),supportPatrolBySource
  });
  if (!projected.size) return this.actorSystem.statesAt(tick, this.activateAllTraps);
  this.actorSystem.setNativeRuntimeStates(projected);
  try { return this.actorSystem.statesAt(tick, this.activateAllTraps); }
  finally { this.actorSystem.setNativeRuntimeStates(this.nativeRuntimeStates); }
}

export function _overrideFor(port, sourceKey) {
  /* The compiled trace remains immutable source data, but the workbench may
   * layer an explicit preview-only reviewed override on top of it. */
  const manual = this.manualOverrides.get(`${port}:${sourceKey}`) || this.manualOverrides.get(`source:${sourceKey}`) || null;
  const patch = this.patchOverrides.get(`${port}:${sourceKey}`) || this.patchOverrides.get(`source:${sourceKey}`) || null;
  return manual || patch ? Object.freeze({ ...(manual || {}), ...(patch || {}) }) : null;
}

export function _overrideForInstance(port, sourceKey, instanceKey = null) {
  const base = this._overrideFor(port, sourceKey);
  if (!instanceKey) return base;
  const key = `${port}:instance:${instanceKey}`;
  const manual = this.manualOverrides.get(key) || null;
  const patch = this.patchOverrides.get(key) || null;
  return base || manual || patch ? Object.freeze({ ...(base || {}), ...(manual || {}), ...(patch || {}) }) : null;
}

export function _classicEntityForSourceKey(sourceKey) {
  const match = /^mark:(\d+)$/.exec(String(sourceKey || ''));
  if (!match || !this.selection) return null;
  const room = this.selection.visualSource === 'classic'
    ? this._classicPreviewRoom(this.selection.submap)
    : this._classicRoom(this.selection.submap);
  const mark = Number(match[1]);
  return (room?.entities || []).find(row => Number(row.mark) === mark) || null;
}

export function _lethalityForSelectable(item) {
  const category = String(item?.category || '');
  const entity = this._classicEntityForSourceKey(item?.sourceKey);
  const classicFlags = Number(entity?.flags || 0) & 0x0c; /* LETHALR | LETHALI */
  const initiallyLethal = (Number(entity?.flags || 0) & 0x08) !== 0;
  /* Production PN66 / actor 0x72 rows are the Revival moving-platform
   * family.  Their classic entity may carry LETHALR, but passive body
   * contact is intentionally safe: only platform motion that creates a new
   * overlap can hurt Rick.  Keep the browser hazard view in the same state
   * model by marking the current sprite hazardous only while it is actually
   * displaced/moving in Simulate. */
  const movingPlatform = !!item?.movingPlatform;
  if (movingPlatform)
    return Object.freeze({ lethal: !!item?.movingPlatformMoving, classicFlags, entity, initiallyLethal, movingPlatform: true });
  /* Category is useful for true moving killers whose current classic n bit
   * is not carried into the browser trace. A blockage/explodable label is
   * deliberately not unconditional lethality: Revival rubble is a solid
   * side blockage with a lethal top-crossing rule, not an overlap killer.
   * Its conditional component still belongs in the Hazards debug filter. */
  const semanticLethal = ['trap', 'enemy', 'projectile'].includes(category);
  return Object.freeze({ lethal: semanticLethal || initiallyLethal, classicFlags, entity, initiallyLethal, movingPlatform: false });
}

export function _hazardPotentialForSelectable(item, lethality = this._lethalityForSelectable(item)) {
  const category = String(item?.category || '');
  if (lethality.lethal) return true;
  /* Moving platforms are not passive hazards. They become lethal only for
   * the frames where production simulation says the activated platform is
   * moving into Rick; a stationary platform is ordinary solid geometry. */
  if (lethality.movingPlatform) return false;
  if (!['blockage', 'explodable'].includes(category)) return false;
  /* Reviewed bomb blockages belong in the broad debug "hazards" view
   * because landing on intact rubble is lethal in Revival. Their side
   * contact remains safe, so they are not modeled as unconditional overlap
   * killers here. Once the state-swap reaches the exploded PN, there is no
   * blockage/hazard left to outline. */
  const binding = this._roomActionBindings().find(row => String(row?.sourceKey || '') === String(item?.sourceKey || '') &&
    Array.isArray(row?.hazardBounds) && row.hazardBounds.length === 4);
  if (!binding) return item?.visible !== false;
  if (Number.isFinite(Number(binding.pn)) && Number.isFinite(Number(item?.pn)))
    return Number(item.pn) === Number(binding.pn);
  return item?.visible !== false;
}

export function _hazardBoundsForSelectable(item, lethality = this._lethalityForSelectable(item)) {
  if (!lethality.lethal) return null;
  if (item?.collisionBounds) return item.collisionBounds;
  /* In RDX mode scripted/type-3 hazards use the exact opaque sprite footprint
   * in native gameplay. Neutral-role mapped actors (for example MD0010
   * mark:78) must therefore not shrink back to classic w/h dimensions.
   * Enemies/projectiles already carry their intentional collisionBounds. */
  if (item?.port === 'rdx' && item?.opaqueBounds) return item.opaqueBounds;
  if (item?.opaqueBounds && lethality.classicFlags && lethality.entity)
    return fittedClassicCollisionBounds(item.opaqueBounds, lethality.entity);
  return item?.opaqueBounds || item?.bounds || null;
}

export function _decorateDynamic(selectables, diagnostics) {
  const context = { mapId: this.selection?.mapId, submap: this.selection?.submap };
  const decoratedSelectables = (selectables || []).filter(Boolean).map(item => {
    const lethality = this._lethalityForSelectable(item);
    const collisionBounds = this._hazardBoundsForSelectable(item, lethality);
    const classicEntity = this._classicEntityForSourceKey(item?.sourceKey);
    const sound = classicEntity ? this.activatorSounds?.entities?.[String(Number(classicEntity.entity))] : null;
    const triggerSound = sound ? Object.freeze({ ...sound, route: `audio/classic/${sound.sample}` }) : null;
    return decoratePreviewElement(Object.freeze({
      ...item,
      ...(triggerSound ? { triggerSound } : {}),
      lethalPotential: lethality.lethal,
      hazardPotential: this._hazardPotentialForSelectable(item, lethality),
      classicLethalFlags: lethality.classicFlags,
      ...(collisionBounds && !item.collisionBounds ? { collisionBounds } : {})
    }), context, false);
  });
  const decoratedDiagnostics = (diagnostics || []).filter(Boolean).map(item => {
    const classicEntity = this._classicEntityForSourceKey(item?.sourceKey);
    const sound = classicEntity ? this.activatorSounds?.entities?.[String(Number(classicEntity.entity))] : null;
    const triggerSound = sound ? Object.freeze({ ...sound, route: `audio/classic/${sound.sample}` }) : null;
    return decoratePreviewElement(Object.freeze({ ...item, ...(triggerSound ? { triggerSound } : {}) }), context, true);
  });
  return Object.freeze({
    selectables: Object.freeze(decoratedSelectables),
    enemyBehaviors: Object.freeze(decoratedDiagnostics)
  });
}

export function _classicRoom(submap) {
  const room = this.classicData?.rooms?.find(row => Number(row.submap) === Number(submap));
  if (!room) throw new Error(`No generated classic preview room for submap ${submap}`);
  return room;
}

export function _classicPreviewRoom(submap) {
  const room = this._classicRoom(submap);
  if (!room.preview) return room;
  return Object.freeze({ ...room, ...room.preview, bank: room.bank });
}

export function _classicPreviewYOffset(submap = this.selection?.submap) {
  const room = this._classicRoom(submap);
  const preview = room.preview || room;
  return Math.max(0, (Number(room.startRow) - Number(preview.startRow)) * 8);
}

export function _classicPreviewBounds(bounds) {
  if (!bounds) return bounds;
  const dy = this._classicPreviewYOffset();
  return Object.freeze({ ...bounds, y: Number(bounds.y) + dy });
}

export function _classicDimensions(submap) {
  const room = this._classicPreviewRoom(submap);
  return { width: room.widthTiles * 8, height: room.heightTiles * 8, cellWidth: room.widthTiles, cellHeight: room.heightTiles, source: 'generated xrick tile data' };
}

export function _classicPlane(submap) {
  const room = this._classicPreviewRoom(submap);
  const key = `classic:${submap}`;
  if (this.staticCache.has(key)) return this.staticCache.get(key);
  const output = new PixelBuffer(room.widthTiles * 8, room.heightTiles * 8, [0, 0, 0, 255]);
  const bank = this.classicData.banks[String(room.bank)];
  for (let tileY = 0; tileY < room.heightTiles; tileY += 1) for (let tileX = 0; tileX < room.widthTiles; tileX += 1) {
    const tile = bank[room.tiles[tileY * room.widthTiles + tileX]];
    for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) {
      output.setPixel(tileX * 8 + x, tileY * 8 + y, this.classicData.palette[tile[y * 8 + x] || 0]);
    }
  }
  const result = Object.freeze({ background: output, foreground: new PixelBuffer(output.width, output.height), metrics: { visualSource: 'classic', source: 'generated xrick GFXST map tiles' } });
  this.staticCache.set(key, result);
  return result;
}

export function _classicSprite(spriteId) {
  const id = Number(spriteId) | 0;
  if (this.classicSpriteCache.has(id)) return this.classicSpriteCache.get(id);
  const source = this.classicData?.sprites?.[id];
  if (!source) return null;
  const width = Number(this.classicData.spriteWidth || 32), height = Number(this.classicData.spriteHeight || 21);
  const frame = new PixelBuffer(width, height, [0, 0, 0, 0]);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const colorIndex = Number(source[y * width + x] || 0);
    if (colorIndex) frame.setPixel(x, y, this.classicData.palette[colorIndex]);
  }
  this.classicSpriteCache.set(id, frame);
  return frame;
}

export function _classicCoordinates(localX, localY, toRdx, previewLocal = false) {
  if (!toRdx) return { x: Number(localX), y: Number(localY) + (previewLocal ? 0 : this._classicPreviewYOffset()) };
  const offset = this.selection.level?.pixelOffset || { dxPx: 0, dyPx: 0 };
  /* Canonical classic_level_preview coordinates remain relative to startRow
   * because native presentation generation consumes that contract. Classic
   * Map Preview may prepend source-backed rows via room.preview, hence the
   * display-only y offset above. The level mapping contract is
   * explicitly rdx = classic-local + pixelOffset, so adding startRow again
   * double-counted vertical room origin in side-by-side/debug projections. */
  return {
    x: Number(localX) + Number(offset.dxPx || 0),
    y: Number(localY) + Number(offset.dyPx || 0)
  };
}

export function _classicGeneratedEntityState(entity, tick, toRdx = false, previewLocal = false) {
  const collectibles = new Set([0x10,0x11,0x12,0x13,0x14,0x15,0x16,0x17]);
  const rolling = new Set([0x2a,0x2c,0x32,0x33,0x3d]);
  const shooters = new Set([0x19,0x1a,0x2b,0x39]);
  const n = Number(entity.entity) & 0x7f;
  let x = Number(entity.x), y = Number(entity.y), sprite = Number(entity.sprite || 0);
  let direction = 'right', animated = false;
  if (n >= 4 && n <= 15) {
    const span = 24, period = span * 2, raw = Math.floor(tick / 2) % period;
    const offset = raw <= span ? raw : period - raw;
    direction = raw < span ? 'right' : 'left';
    x += offset - span / 2;
    const base = Number(entity.sprbase || sprite);
    const seq = Math.floor(tick / 4) & 3;
    sprite = direction === 'right' ? [base,base+1,base,base+2][seq] : [base+3,base+4,base+3,base+5][seq];
    animated = true;
  } else if (rolling.has(n)) {
    const span = 48, period = span * 2, raw = Math.floor(tick / 2) % period;
    x += (raw <= span ? raw : period - raw) - span / 2;
    sprite = Number(entity.sprbase || sprite) + (Math.floor(tick / 5) & 1);
    animated = true;
  } else if (!collectibles.has(n) && n > 0x17 && !shooters.has(n)) {
    sprite = Number(entity.sprbase || sprite) + (Math.floor(tick / 12) & 1);
    animated = true;
  }
  const pos = this._classicCoordinates(x, y, toRdx, previewLocal);
  return Object.freeze({
    kind: collectibles.has(n) ? 'collectible' : shooters.has(n) ? 'shooter' : 'entity',
    entity: n, sprite, x: pos.x, y: pos.y, direction, animated, source: entity,
    sourceKey: `mark:${Number(entity.mark)}`, visible: true, previewSourceFallback: true
  });
}

export function _classicStates(tick, toRdx = false, includeInvisible = false) {
  const room = this._classicRoom(this.selection.submap);
  const productionRoom = this._productionRoom();
  const presentationStates = this.resolvedProjection && this.activateAllTraps
    ? composeWholeRoomSimulationStates({
        resolvedActors: productionRoom?.actors || [], classicScriptedPaths: this.classicScriptedPaths,
        primaryStates: this.nativeRuntimeStates, tick, classicRoom:this._classicRoom(this.selection.submap)
      })
    : this.nativeRuntimeStates;
  if (Array.isArray(productionRoom?.classicActors) && productionRoom.classicActors.length) {
    const productionStates = productionRoom.classicActors.map(record => {
      /* The whole-map Classic hero is an entrance marker, not a simulated
       * actor. Always use the canonical map_maps-derived playerStart rather
       * than a camera-local or later runtime capture sample. */
      if (record.role === 'player' || String(record.sourceKey || '') === 'player') {
        const player = room.playerStart || { x: 8, y: 8, sprite: 1 };
        const position = this._classicCoordinates(Number(player.x), Number(player.y), toRdx);
        return Object.freeze({ kind: 'player', entity: 1, sprite: Number(player.sprite ?? 1),
          x: position.x, y: position.y, direction: 'right', animated: false, static: true,
          source: record.source || null, sourceKey: 'player', productionClassicTrack: false,
          canonicalPlayerStart: true, visible: true });
      }
      /* Shooter entities become projectile carriers after activation. In the
       * resolved editor projection keep the source body fixed at its Classic
       * phase-zero draw and render the transient native carrier separately.
       * The legacy captured-preview path retains its historical behavior. */
      if (record.role === 'shooter') {
        if (!this.resolvedProjection) return null;
        const source = record.source || {};
        const local = Array.isArray(record.draw) ? record.draw : [Number(source.x || 0), Number(source.y || 0)];
        const sprite = Number(record.sprite ?? source.sprite ?? 0);
        const position = this._classicCoordinates(Number(local[0]), Number(local[1]), toRdx);
        return Object.freeze({
          kind: 'shooter', entity: Number(source.n || 0) & 0x7f, sprite,
          x: position.x, y: position.y,
          direction: record.direction || (Number(source.n) === 0x1a ? 'left' : 'right'),
          animated: false, static: true, source, sourceKey: String(record.sourceKey || ''),
          productionClassicTrack: true, resolvedShooterBody: true,
          diagnosticPlaceholder: record?.diagnosticPlaceholder === true,
          visible: sprite > 0 || record?.diagnosticPlaceholder === true
        });
      }
      const source = record.source || {};
      const sourceKey = String(record.sourceKey || '');
      const counterpart = (productionRoom.actors || []).find(row => String(row.sourceKey || '') === sourceKey) || null;
      const loadedActor = (this.actorSystem.actors || []).find(actor => String(actor.production?.sourceKey || '') === sourceKey) || null;
      let sample = trackSample(record, tick, this.activateAllTraps) || record;
      let local = sample.draw || record.draw || [0, 0];
      let sprite = recoveredClassicSourceSprite(source.n, sample.sprite ?? record.sprite ?? 0, source.sprbase ?? source.sprite ?? 0);
      let direction = sample.direction || 'right';
      let visible = sample.visible !== false;
      let scriptedDirection = null;
      let syntheticPatrol = false;
      let fixedLifecycle = false;
      const policy = classifyClassicEnemy(source.n);
      const live = this.resolvedProjection ? presentationStates.get(sourceKey) || null : null;

      const hasNativeClassicDraw = !!live && Array.isArray(live.classicDraw);
      if (hasNativeClassicDraw) {
        local = live.classicDraw;
        direction = live.direction === 'left' || live.direction === 'right' ? live.direction : direction;
        /* Whole-room/native Simulate uses the Classic live sample only for
         * mutable source-space placement (and, for walkers, motion phase).
         * Raw native sprite ids are not stable presentation authority here:
         * SM03's bat reverted to a generic ground enemy body and SM04's
         * rubble picked an enemy-death frame because their Classic semantic
         * state lives in reviewed source/scripted tables rather than in the
         * unaudited runtime sprite field. */
        const cycleSample = trackSample(record, live.tick, this.activateAllTraps) ||
          trackSample(record, tick, this.activateAllTraps) || record;
        sprite = recoveredClassicSourceSprite(source.n, cycleSample.sprite ?? record.sprite ?? sprite, source.sprbase ?? source.sprite ?? 0);
        if (policy?.family === 'type1a') {
          const entity = (room.entities || []).find(row => Number(row.mark) === Number(source.mark)) || source;
          sprite = classicEnemySpriteAt(entity, direction, live.tick, sprite);
        } else if ((Number(source.n || 0) & 0x7f) === 0x2b) {
          sprite = classicScriptedActiveSpriteAt(source, live.tick, sprite);
        } else if (fixedAnchorLifecycle(counterpart) && (Number(source.n || 0) & 0x7f) >= 0x18) {
          const activeClassic = firstVisibleSample(record, 'draw') || cycleSample || record;
          local = activeClassic.draw || record.draw || local;
          sprite = Number(activeClassic.sprite ?? record.sprite ?? sprite);
          fixedLifecycle = true;
        }
        visible = cycleSample?.presentationOnlyInspection === true
          ? cycleSample.visible !== false
          : live.visible !== false;
        syntheticPatrol = true;
      } else if (fixedAnchorLifecycle(counterpart) && (Number(source.n || 0) & 0x7f) >= 0x18) {
        const stateSample = trackSample(counterpart, tick, this.activateAllTraps) || counterpart;
        const activeClassic = firstVisibleSample(record, 'draw') || record;
        local = activeClassic.draw || record.draw || local;
        sprite = Number(activeClassic.sprite ?? record.sprite ?? sprite);
        visible = stateSample?.visible !== false;
        fixedLifecycle = true;
      } else if ((Number(source.n || 0) & 0x7f) >= 0x18) {
        const path = this.classicScriptedPaths?.entities?.[String(Number(source.n || 0) & 0x7f)] || null;
        if (this.activateAllTraps && path?.steps?.length) {
          const captured = drawEnvelope(record.auditSamples || record.samples || []);
          const expectedWidth = Number(path.envelope?.maxX || 0) - Number(path.envelope?.minX || 0);
          const expectedHeight = Number(path.envelope?.maxY || 0) - Number(path.envelope?.minY || 0);
          if ((expectedWidth >= 1 || expectedHeight >= 1) &&
              (captured.width + 2 < expectedWidth || captured.height + 2 < expectedHeight)) {
            /* Trigger captures begin after the first native step. Keep the dormant
             * phase-zero draw as the presentation origin, then apply source deltas. */
            const initial = record.draw || firstVisibleSample(record, 'draw')?.draw || [0, 0];
            const classicEntity = (room.entities || []).find(entity => Number(entity.mark) === Number(source.mark));
            const oneShot = (Number(classicEntity?.flags || 0) & 0x01) !== 0;
            const delta = oneShot ? classicOneShotScriptedDeltaAt(path, tick, [
              Number(source.x ?? initial[0]), Number(source.y ?? initial[1])
            ]) : null;
            const motion = delta ? { origin:[Number(initial[0]) + Number(delta.delta[0]), Number(initial[1]) + Number(delta.delta[1])],
              direction:delta.direction, visible:delta.visible } : scriptedMotionAt(path, tick, initial);
            if (motion) { local = motion.origin; scriptedDirection = motion.direction; direction = motion.direction; visible = visible && motion.visible !== false; }
          }
        }
      } else if (this.activateAllTraps && policy?.family === 'type1a' && counterpart) {
        /* The Classic port replays the immutable xrick controller in Layer-B
         * coordinates. Do not back-solve Classic draw coordinates from the
         * RDX presentation origin/residual: doing so mixes Layer C/E/F into
         * the source leg and can leave the Classic actor stationary or
         * shifted when the RDX registration changes. */
        const motion = configuredClassicBoundedPatrolState(counterpart, tick, this._classicRoom(this.selection.submap)) || effectiveClassicPatrolState(loadedActor, tick);
        if (motion) {
          local = motion.draw;
          direction = motion.direction || direction;
          const entity = (room.entities || []).find(row => Number(row.mark) === Number(source.mark)) || source;
          sprite = classicEnemySpriteAt(entity, direction, tick, sprite);
          visible = motion.visible !== false;
          syntheticPatrol = true;
        }
      }

      /* Offline whole-room states carry RDX presentation coordinates only.
       * They may still supply an animation/direction phase for reactive
       * actors, but they must not suppress Classic Layer-B/source motion. */
      if (live && !hasNativeClassicDraw) {
        visible = visible && live.visible !== false;
        if (live.reactivePresentation) {
          direction = live.direction === 'left' || live.direction === 'right' ? live.direction : direction;
          const entity = (room.entities || []).find(row => Number(row.mark) === Number(source.mark)) || source;
          sprite = classicEnemySpriteAt(entity, direction, live.tick, sprite);
          syntheticPatrol = true;
        }
      }

      if (!live && this.activateAllTraps && (Number(source.n || 0) & 0x7f) === 0x2b) {
        sprite = classicScriptedActiveSpriteAt(source, tick, sprite);
        syntheticPatrol = true;
      }

      const position = this._classicCoordinates(Number(local[0]), Number(local[1]), toRdx);
      return Object.freeze({
        kind: classicPreviewKind(record.role, source.n, false),
        entity: Number(source.n || 0) & 0x7f,
        sprite,
        x: position.x,
        y: position.y,
        direction: scriptedDirection || direction || 'right',
        animated: syntheticPatrol || !!scriptedDirection || fixedLifecycle || (record.samples || []).some(row =>
          Number(row.sprite) !== Number((record.samples || [row])[0]?.sprite) ||
          Number(row.draw?.[0]) !== Number((record.samples || [row])[0]?.draw?.[0]) ||
          Number(row.draw?.[1]) !== Number((record.samples || [row])[0]?.draw?.[1])),
        static: fixedLifecycle,
        source,
        sourceKey,
        productionClassicTrack: true,
        scriptedPathReplay: !!scriptedDirection,
        syntheticPatrol,
        fixedLifecycle,
        visible,
        presentationOnlyInspection: sample?.presentationOnlyInspection === true,
        inspectionVisualState: sample?.visualState || null,
        runtimeSuppressed: record?.runtimeSuppressed === true,
        suppression: record?.suppression || null,
        implementationDisposition: record?.implementationDisposition || null,
        diagnosticPlaceholder: record?.diagnosticPlaceholder === true
      });
    }).filter(state => state && (state.sprite > 0 || state.diagnosticPlaceholder || includeInvisible) && (state.visible || includeInvisible));
    if (toRdx || !room.preview) return productionStates;

    /* Production traces are captured in gameplay camera phases and therefore
     * intentionally do not contain source records above the canonical room
     * start.  The full-map Classic pane supplements only those newly exposed
     * source marks from generated xrick data; overlapping trace actors remain
     * production-authoritative. */
    const canonicalMarks = new Set((room.entities || []).map(entity => Number(entity.mark)));
    const previewOnly = (room.preview.entities || [])
      .filter(entity => !canonicalMarks.has(Number(entity.mark)))
      .map(entity => this._classicGeneratedEntityState(entity, tick, false, true))
      .filter(state => state.sprite > 0 && state.visible);
    return Object.freeze([...productionStates, ...previewOnly]);
  }
  const states = [];
  const sourceRoom = !toRdx ? this._classicPreviewRoom(this.selection.submap) : room;
  const previewLocal = !toRdx && sourceRoom !== room;
  const player = sourceRoom.playerStart || { x: 8, y: 8, sprite: 1 };
  const playerPos = this._classicCoordinates(player.x, player.y, toRdx, previewLocal);
  states.push({ kind: 'player', entity: 1, sprite: Number(player.sprite ?? 1), x: playerPos.x, y: playerPos.y, static: true, sourceKey: 'player' });
  for (const entity of sourceRoom.entities || [])
    states.push(this._classicGeneratedEntityState(entity, tick, toRdx, previewLocal));
  return states;
}

export function _classicProjectileStates(tick) {
  if (!this.activateAllTraps) return [];
  const productionRoom = this._productionRoom();
  if (this.resolvedProjection) {
    return (productionRoom?.classicActors || []).filter(classic => classic.role === 'shooter').map(classic => {
      const sourceKey = String(classic.sourceKey || '');
      const live = this.nativeRuntimeStates.get(sourceKey) || null;
      if (!live || !isNativeProjectileActive(live)) return null;
      const local = Array.isArray(live.classicDraw) ? live.classicDraw : null;
      const sprite = Number(live.sprite || live.nativeEntity?.sprite || 0);
      if (!local || sprite <= 0) return null;
      const source = classic.source || {};
      const direction = classic.direction || (Number(source.n) === 0x1a ? 'left' : 'right');
      const position = this._classicCoordinates(Number(local[0]), Number(local[1]), false);
      return Object.freeze({
        kind: 'projectile', entity: Number(source.n || live.nativeEntity?.n || 0) & 0x7f,
        sprite, x: position.x, y: position.y, direction, animated: true, static: false,
        source, sourceKey, instanceKey: live.runtimeInstanceKey || null,
        productionClassicTrack: true, projectileChild: true, nativeRuntimeProjectile: true,
        authority: 'native-xrick-projectile-state', visible: true
      });
    }).filter(Boolean);
  }
  const classicRoom = this._classicRoom(this.selection.submap);
  const levelOffset = this.selection.level?.pixelOffset || { dxPx: 0, dyPx: 0 };
  return (productionRoom?.children || []).filter(child => child.role === 'projectile').map(child => {
    const sample = trackSample(child, tick, true) || child;
    if (sample.visible === false || !Array.isArray(sample.origin)) return null;
    const classic = (productionRoom.classicActors || []).find(row => row.role === 'shooter' && String(row.sourceKey || '') === String(child.sourceKey || '')) || null;
    const firstChild = firstVisibleSample(child, 'origin') || sample;
    const firstClassic = firstVisibleSample(classic, 'draw') || classic;
    if (!Array.isArray(firstChild?.origin) || !Array.isArray(firstClassic?.draw)) return null;
    const convertedFirst = [Number(firstChild.origin[0]) - Number(levelOffset.dxPx || 0), Number(firstChild.origin[1]) - Number(levelOffset.dyPx || 0)];
    const contactOffset = [Number(firstClassic.draw[0]) - convertedFirst[0], Number(firstClassic.draw[1]) - convertedFirst[1]];
    const x = Number(sample.origin[0]) - Number(levelOffset.dxPx || 0) + contactOffset[0];
    const y = Number(sample.origin[1]) - Number(levelOffset.dyPx || 0) + contactOffset[1] + this._classicPreviewYOffset();
    const direction = sample.direction || child.direction || (Number(classic?.source?.n) === 0x1a ? 'left' : 'right');
    const sprite = Number(firstClassic.sprite || (direction === 'left' ? 0x21 : 0x20));
    return Object.freeze({
      kind: 'projectile', entity: Number(classic?.source?.n || 0) & 0x7f,
      sprite, x, y, direction, animated: true, static: false,
      source: classic?.source || null, sourceKey: String(child.sourceKey || ''),
      productionClassicTrack: true, projectileChild: true, visible: true
    });
  }).filter(Boolean);
}

function classicStateActorDepth(state) {
  const value = String(state?.actorDepth || state?.depth || '');
  if (value === 'behind-midground' || value === 'normal' || value === 'front') return value;
  return state?.front === true ? 'front' : 'normal';
}

function classicStateTarget(renderer, state) {
  const depth = classicStateActorDepth(state);
  if (depth === 'behind-midground') return renderer.dynamicBehindMidground;
  if (depth === 'front') return renderer.dynamicFront;
  return renderer.dynamic;
}

export function _drawClassicState(state, redFrame = false) {
  const frame = this._classicSprite(state.sprite);
  if (!frame) return null;
  const drawX = Math.round(state.x), drawY = Math.round(state.y);
  const target = classicStateTarget(this, state);
  target.blit(frame, drawX, drawY);
  const bounds = { x: drawX, y: drawY, width: frame.width, height: frame.height };
  if (redFrame) drawRect(target, drawX - 1, drawY - 1, frame.width + 2, frame.height + 2, [255, 20, 35, 255], false);
  return redFrame ? { x: drawX - 1, y: drawY - 1, width: frame.width + 2, height: frame.height + 2 } : bounds;
}

export function _classicDynamiteState(tick, sourceKey = '') {
  const states = this._classicStates(tick, true).filter(state => Number(state.entity) === 0x03);
  return states.find(state => String(state.sourceKey || '') === String(sourceKey || '')) || states[0] || null;
}

export function _drawClassicFallback(state) {
  if (state.diagnosticPlaceholder || !Number(state.sprite)) {
    return this._placeholder(Number(state.x) + 16, Number(state.y) + 20,
      state.entity, this.selection.missingPolicy, true, classicStateTarget(this, state));
  }
  /* Never render Rick artwork for an unresolved non-player entity. Several
   * source entities use low sprite ids transiently; drawing those ids in the
   * whole-map preview created fake Rick clones. Keep the unresolved action
   * auditable with a red placeholder instead. */
  if (state.kind !== 'player' && isClassicRickSprite(state.sprite)) {
    const x = Number(state.x) + 16;
    const y = Number(state.y) + 20;
    return this._placeholder(x, y, state.entity, this.selection.missingPolicy, true, classicStateTarget(this, state));
  }
  /* missingPolicy controls unresolved presentation only. A diagnostic-red
   * policy must not put a red frame around every valid Classic sprite. */
  return this._drawClassicState(state, false);
}

export function _productionRoom() {
  return ['rdx.production_preview_scene.v1', 'rdx.production_preview_scene.v2', 'rdx.production_preview_scene.v3', 'rdx.production_presentation_trace.v1', 'rdr.resolved_editor_projection.v1'].includes(this.productionScene?.schema)
    ? (this.productionScene.rooms || []).find(room =>
        Number(room.submap) === Number(this.selection?.submap) &&
        Number(room.mapId) === Number(this.selection?.mapId)) || null
    : null;
}

export function _productionFallbacks(tick) {
  const room = this._productionRoom();
  if (!room) return null;
  const replacementKeys = new Set(room.replacementSourceKeys ||
    (room.actors || []).map(record => record.sourceKey).filter(Boolean));
  /* Trigger-isolated production captures sometimes retain only the passive
   * fallback sample even though Classic is the actual runtime visual owner.
   * Reuse the same Classic action replay used by the Classic pane so RDX
   * fallback presentation inherits scripted motion/visibility instead of
   * freezing at the snapshot (MD0013 mark109/114). */
  const needsRecoveredLure = (room.fallbacks || []).some(record => (Number(record.n ?? record.source?.n ?? 0) & 0x7f) === 0x2f);
  const activeClassic = (this.activateAllTraps || needsRecoveredLure)
    ? new Map(this._classicStates(tick, true, true).map(state => [String(state.sourceKey || ''), state]))
    : null;
  return (room.fallbacks || []).filter(record => record.runtimeSuppressed !== true &&
    (!record.sourceKey || !replacementKeys.has(record.sourceKey)) &&
    (!record.overlayForSourceKey || !replacementKeys.has(record.overlayForSourceKey))).map(record => {
    const sample = trackSample(record, tick, this.activateAllTraps) || record;
    const source = record.source || {};
    const n = Number(record.n ?? source.n ?? 0) & 0x7f;
    const classic = activeClassic?.get(String(record.sourceKey || '')) || null;
    const useClassicAction = !!classic && n >= 0x18 && record.role !== 'shooter' && this.activateAllTraps;
    return Object.freeze({
      kind: classicPreviewKind(record.role, n, false),
      entity: n,
      sprite: Number(useClassicAction ? classic.sprite : (sample.sprite ?? record.sprite ?? 0)),
      x: Number(useClassicAction ? classic.x : (sample.draw?.[0] ?? record.draw?.[0] ?? 0)),
      y: Number(useClassicAction ? classic.y : (sample.draw?.[1] ?? record.draw?.[1] ?? 0)),
      direction: useClassicAction ? (classic.direction || 'right') : (sample.direction || 'right'),
      animated: useClassicAction ? !!classic.animated : (Array.isArray(record.samples) && record.samples.length > 1),
      static: false,
      source,
      sourceKey: record.sourceKey,
      collision: record.collision || null,
      overlayForSourceKey: record.overlayForSourceKey || null,
      diagnosticPlaceholder: !!record.diagnosticPlaceholder,
      auditAuthority: useClassicAction ? 'classic-action-fallback-parity' : (record.auditAuthority || null),
      productionFallback: true,
      actorDepth: String(sample.actorDepth || record.actorDepth || ((sample.front === true || record.front === true) ? 'front' : 'normal')),
      front: String(sample.actorDepth || record.actorDepth || '') === 'front' || sample.front === true || record.front === true,
      scriptedPathReplay: !!classic?.scriptedPathReplay,
      visible: useClassicAction ? classic.visible !== false : sample.visible !== false
    });
  }).filter(state => (state.sprite > 0 || state.diagnosticPlaceholder) && state.visible);
}

export function _classicFallbacks(tick, rdxStates) {
  const production = this._productionFallbacks(tick);
  if (production) return production;
  if (!Array.isArray(this.classicData?.rooms) || !this.classicData.rooms.length) return [];
  return this._classicStates(tick, true).filter(state => {
    if (state.kind === 'player') return !rdxStates.some(rdx => rdx.actor.set?.type === 'player');

    /* Match the production fallback decision first. A source action with a
     * verified PN mapping is represented by the RDX actor layer and must not
     * be repeated as a red-framed classic sprite merely because static MA
     * and xrick contact anchors differ by a few pixels. */
    if (this.semanticMapper) {
      const source = state.source || {};
      const resolution = this.semanticMapper.resolveEntity({
        n: state.entity,
        sprite: state.sprite,
        sprbase: Number(source.sprbase ?? source.sprite ?? state.sprite),
        x: state.x,
        y: state.y,
        w: Number(source.w || 0),
        h: Number(source.h || 0)
      }, { direction: state.direction });
      if (resolution.status === 'mapped') return false;
    }

    /* Unmapped classic actions stay visible. Suppress only an obvious
     * positional duplicate of an RDX room actor; otherwise retain the red
     * fallback frame so unresolved assets remain auditable. */
    const footX = state.x + 16, footY = state.y + 20;
    return !rdxStates.some(rdx => Math.abs(rdx.x - footX) <= 18 && Math.abs(rdx.y - footY) <= 22);
  });
}

export function timelineForAsset(item) {
  const room = this._productionRoom();
  if (!room || !item) return null;
  const sourceKey = String(item.sourceKey || '');
  if (!sourceKey) return null;
  let record = null;
  let sourceKind = 'actor';
  const wantsProjectile = item.kind === 'projectile' || item.role === 'projectile' || String(item.id || '').startsWith('projectile:');
  if (item.port === 'classic' || this.selection?.visualSource === 'classic') {
    record = (room.classicActors || []).find(row => row.sourceKey === sourceKey) ||
      (room.fallbacks || []).find(row => row.sourceKey === sourceKey);
    sourceKind = 'classic';
  } else if (wantsProjectile) {
    record = (room.children || []).find(row => row.sourceKey === sourceKey && row.role === 'projectile') ||
      (room.actors || []).find(row => row.sourceKey === sourceKey && row.role === 'projectile');
    sourceKind = 'projectile';
  } else {
    record = (room.actors || []).find(row => row.sourceKey === sourceKey) ||
      (room.children || []).find(row => row.sourceKey === sourceKey);
  }
  if (!record) return null;
  const action = this._roomActionBindings().find(row => String(row.sourceKey || '') === sourceKey)?.action || null;
  if (action && ['state-swap-on-trigger', 'hide-on-trigger', 'visibility-toggle-loop'].includes(String(action.kind || ''))) return null;
  if (record.stateOnlyLifecycle || record.previewStateCycle) return null;
  const useAudit = this.activateAllTraps && Array.isArray(record.auditSamples) && record.auditSamples.length;
  const samples = useAudit ? record.auditSamples : (Array.isArray(record.samples) ? record.samples : []);
  const period = Math.max(1, Number(useAudit ? record.auditPeriod : record.trackPeriod || 1));
  return Object.freeze({
    sourceKey, sourceKind, recordKey: record.key || null, period, firstTick: 0, lastTick: period - 1,
    authority: useAudit ? (record.auditAuthority || 'production-c-audit') : (record.authority || 'production-c-snapshot'),
    samples: Object.freeze(samples.map(sample => Object.freeze({ ...sample }))),
    sampleAt: tick => trackSample(record, tick, useAudit)
  });
}
