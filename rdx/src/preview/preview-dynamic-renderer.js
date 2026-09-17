import { PreviewTrapSystem } from './preview-traps.js';
import { mechanismDirtyBounds, mechanismTransform } from './preview-mechanisms.js';
import { productionActorPatchMap } from './production-overrides.js';
import { projectNativeProjectile } from '../editor/runtime-projectiles.js';
import { normalizeCanonicalStatePresentations, statePresentationMatch, resolvedStatePresentation } from '../runtime/state-presentation.js';
import { rotateSpriteFrame, unionBounds, clipBounds, opaqueDrawBounds, clearRect, drawRect, blitOpacity } from './preview-render-primitives.js';
import { controllerBodyCollisionBounds, fittedClassicCollisionBounds, minimalProjectileCollisionBounds, emitterAlignedProjectileGeometry, classicSpriteOpaqueExtents } from './preview-collision-geometry.js';
import { sourceKeyForState, activatorTypeFromClassicFlags, previewCategory, patchedPlacementAuthority, selectableRecord, trackSample, productionProjectileCadenceSample, productionDrawPoint, isClassicRickSprite } from './preview-production-state.js';
import { RDX_ASSET_FLAG_SCENERY_ASSEMBLY, sceneryAssemblyFrame, statefulTrapSceneryVisual, reviewedRdxTraps, descriptorStaticSceneryVisuals } from './preview-static-renderer.js';
import { revivalDynamiteVariantFromSeed, revivalRollingExplosionFrame } from '../runtime/revival-dynamite.js';

const RDX_ASSET_FLAG_FLOOR_SPIKE = 0x02;
const RDX_BLACK_KEY_STATIC_ACTORS = new Set([0x50, 0x51, 0x53, 0x56]);
function normalizedActorDepth(value, fallbackFront = false) {
  const depth=String(value || '');
  if (depth === 'behind-midground' || depth === 'normal' || depth === 'front') return depth;
  return fallbackFront ? 'front' : 'normal';
}

function actorDepthFor(state, override = null) {
  const overrideDepth=override?.actorDepth ?? override?.depth ?? null;
  if (overrideDepth != null) return normalizedActorDepth(overrideDepth, override?.front === true);
  if (Object.prototype.hasOwnProperty.call(override || {}, 'front')) return override.front ? 'front' : 'normal';
  return normalizedActorDepth(state?.actorDepth ?? state?.actor?.production?.actorDepth ?? state?.actor?.production?.layer, state?.front === true);
}

function targetForActorDepth(renderer, depth) {
  if (depth === 'behind-midground') return renderer.dynamicBehindMidground;
  return depth === 'front' ? renderer.dynamicFront : renderer.dynamic;
}


function reviewedCollisionBounds(collision, { classicData = null, sprite = null, draw = null } = {}) {
  if (!collision || typeof collision !== 'object') return null;
  if (Array.isArray(collision.contactBounds) && collision.contactBounds.length >= 4) {
    const [x,y,width,height] = collision.contactBounds.slice(0,4).map(Number);
    if ([x,y,width,height].every(Number.isFinite) && width > 0 && height > 0)
      return Object.freeze({ x:Math.round(x), y:Math.round(y), width:Math.round(width), height:Math.round(height) });
  }
  if (String(collision.contactPolicy || '') === 'classic-opaque' && Array.isArray(draw)) {
    const extents = classicSpriteOpaqueExtents(classicData, sprite);
    if (extents) return Object.freeze({
      x:Math.round(Number(draw[0]) + extents.minX),
      y:Math.round(Number(draw[1]) + extents.minY),
      width:extents.maxX - extents.minX + 1,
      height:extents.maxY - extents.minY + 1
    });
  }
  return null;
}

export function forcesRevivalDynamitePresentation(state, effectivePn = null, classicEntityNo = -1) {
  const family = String(state?.actor?.production?.family || '');
  const pn = Number(effectivePn ?? state?.pn ?? state?.actor?.production?.pn ?? -1);
  const entityNo = Number(classicEntityNo) & 0x7f;
  return family === 'missile-scripted-explosion' ||
    (pn === 41 && ![0x03, 0x10, 0x11].includes(entityNo));
}

export function usesDynamitePresentation(state, classicEntityNo, effectivePn = null) {
  const entityNo = Number(classicEntityNo) & 0x7f;
  const pn = Number(effectivePn ?? state?.pn ?? state?.actor?.production?.pn ?? -1);
  return pn === 41 || [0x03, 0x10, 0x11].includes(entityNo) ||
    forcesRevivalDynamitePresentation(state, pn, entityNo);
}

export function sharedExplosionVariant(state, sourceKey = '') {
  let seed = 0x811c9dc5;
  const label = String(sourceKey || sourceKeyForState(state) || state?.actor?.production?.sourceKey || '');
  for (let index = 0; index < label.length; index += 1) {
    seed ^= label.charCodeAt(index);
    seed = Math.imul(seed, 0x01000193) >>> 0;
  }
  seed ^= (Number(state?.sprite ?? state?.actor?.sprite ?? 0) & 0xff) << 8;
  return revivalDynamiteVariantFromSeed(seed >>> 0);
}

export function egyptProjectileAnimationTick(mapId, sourceKey, pn, tick) {
  const md = Number(mapId), spritePn = Number(pn), baseTick = Math.max(0, Number(tick) || 0);
  if (md < 13 || md > 23 || (spritePn !== 51 && spritePn !== 52)) return baseTick;
  const source = String(sourceKey || '');
  if (md === 13 && (source === 'mark:102' || source === 'mark:103')) return 3 + (baseTick % 4);
  return baseTick % 3;
}

export function productionBlackKey(state, category) {
  const flags = Number(state?.assetFlags || 0);
  const actorId = Number(state?.actor?.actorId || 0);
  return (flags & RDX_ASSET_FLAG_FLOOR_SPIKE) !== 0 || RDX_BLACK_KEY_STATIC_ACTORS.has(actorId);
}

export function _previewCoordinates(state) {
  if (this.selection.visualSource === 'rdx') return { x: state.x, y: state.y };
  const room = this._classicPreviewRoom(this.selection.submap);
  const offset = this.selection.level?.pixelOffset || { dxPx: 0, dyPx: 0 };
  return { x: state.x - Number(offset.dxPx || 0), y: state.y - Number(offset.dyPx || 0) - room.startRow * 8 };
}

export function _placeholder(x, y, actorId, policy, diagnostic = false, target = this.dynamic) {
  if (policy === 'hidden') return null;
  const color = policy === 'red' || diagnostic ? [255, 20, 35, 255] : [180, 180, 180, 255];
  drawRect(target, Math.round(x - 6), Math.round(y - 16), 13, 17, color, false);
  return { x: x - 8, y: y - 18, width: 17, height: 21, placeholder: true, actorId };
}

export function dynamicFrame(tick) {
  if (!this.selection || !this.dynamic) throw new Error('PreviewRenderer.select() must be called first');
  clearRect(this.dynamicBehindMidground, this.previousBehindMidgroundDirty);
  clearRect(this.dynamic, this.previousDirty);
  clearRect(this.dynamicFront, this.previousFrontDirty);
  let dirtyBehindMidground = null;
  let dirty = null;
  let dirtyFront = null;
  const metrics = { actors: 0, animated: 0, fallback: 0, invalidRickFallbacks: 0, hidden: 0, traps: 0, projectiles: 0, invulnerableEnemies: 0 };
  const selectables = [];

  if (this.selection.visualSource === 'classic') {
    const states = [...this._classicStates(tick, false, this.activateAllTraps), ...this._classicProjectileStates(tick)];
    for (const state of states) {
      const sourceKey = state.sourceKey || `classic:${state.kind}:${state.entity}:${state.x}:${state.y}`;
      const override = this._overrideFor('classic', sourceKey);
      const effective = override ? {
        ...state,
        x: Number.isFinite(Number(override.x)) ? Number(override.x) - 16 : state.x,
        y: Number.isFinite(Number(override.y)) ? Number(override.y) - 20 : state.y,
        sprite: Number.isFinite(Number(override.sprite)) ? Number(override.sprite) : state.sprite,
        visible: override.visible !== false
      } : state;
      const inspectionHidden = effective.presentationOnlyInspection === true && effective.visible === false;
      if (effective.visible === false && !inspectionHidden) continue;
      let bounds = null;
      if (inspectionHidden) {
        const frame = this._classicSprite(effective.sprite);
        if (frame) bounds = { x:Math.round(effective.x), y:Math.round(effective.y), width:frame.width, height:frame.height };
      } else bounds = this._drawClassicFallback(effective);
      if (bounds) {
        if (!inspectionHidden) { dirty = unionBounds(dirty, bounds); metrics.actors += 1; }
        else metrics.hidden += 1;
        if (effective.animated) metrics.animated += 1;
        selectables.push(selectableRecord({
          id: `classic:${sourceKey}`,
          sourceKey,
          traceCollection: 'classicActors',
          port: 'classic',
          kind: effective.kind,
          category: previewCategory(effective),
          role: effective.kind,
          entity: effective.entity,
          sprite: effective.sprite,
          direction: effective.direction || null,
          instanceKey: effective.instanceKey || null,
          x: Number(effective.x) + 16,
          y: Number(effective.y) + 20,
          draw: [Number(effective.x), Number(effective.y)],
          fallback: false,
          authority: effective.authority || (effective.productionClassicTrack ? 'production-c-classic-track' : 'classic-preview'),
          nativeRuntimeProjectile: !!effective.nativeRuntimeProjectile,
          visible: !inspectionHidden,
          presentationOnlyInspection: effective.presentationOnlyInspection === true,
          inspectionVisualState: effective.inspectionVisualState || null,
          runtimeSuppressed: effective.runtimeSuppressed === true,
          suppression: effective.suppression || null,
          implementationDisposition: effective.implementationDisposition || null
        }, bounds));
      }
      if (effective.kind === 'projectile') metrics.projectiles += 1;
      if (effective.entity > 0x17 || effective.kind === 'projectile') metrics.traps += 1;
    }
    const upload = clipBounds(unionBounds(this.previousDirty, dirty), this.dynamic.width, this.dynamic.height) || { x: 0, y: 0, width: 1, height: 1 };
    this.previousBehindMidgroundDirty = null;
    this.previousDirty = clipBounds(dirty, this.dynamic.width, this.dynamic.height);
    this.previousFrontDirty = null;
    const decorated = this._decorateDynamic(selectables, this.enemyBehaviorDiagnostics(tick, selectables));
    return Object.freeze({
      behindMidgroundPixels: this.dynamicBehindMidground,
      pixels: this.dynamic,
      frontPixels: this.dynamicFront,
      behindMidgroundDirtyBounds: Object.freeze({ x:0, y:0, width:1, height:1 }),
      dirtyBounds: Object.freeze(upload),
      frontDirtyBounds: Object.freeze({ x: 0, y: 0, width: 1, height: 1 }),
      metrics: Object.freeze(metrics), states: Object.freeze(states), effects: Object.freeze([]),
      ...decorated
    });
  }

  const palette = this.paletteRegistry.forMap(this.selection.mapId).rgba;
  const states = this._actorStatesAt(tick);
  const productionRoom = this._productionRoom();
  const reviewedActorPatchBySource = this.systemModificationsEnabled
    ? productionActorPatchMap(this.productionOverrides, this.reviewedMapVisualPatches, this.selection.submap, this.selection.mapId)
    : new Map();
  const reviewedActorPatches = [...reviewedActorPatchBySource.values()];
  const classicActorBySource = new Map((productionRoom?.classicActors || []).map(row =>
    [String(row.sourceKey || ''), row]));
  const stateSourceKeys = new Set(states.map(state => String(sourceKeyForState(state) || '')));
  const reviewedActorOwnedSources = new Set(reviewedActorPatchBySource.keys());
  const reviewedClassicMotion = (patch, sourceKey) => {
    const track = classicActorBySource.get(String(sourceKey));
    if (!track) return { track:null, sample:null, dx:0, dy:0, visible:true };
    const sample = trackSample(track, tick, this.activateAllTraps) || track;
    const baseDraw = Array.isArray(track.draw) ? track.draw : sample.draw;
    const sampleDraw = Array.isArray(sample.draw) ? sample.draw : baseDraw;
    const fixed = patch?.behavior === 'visible-always-fixed';
    return {
      track, sample,
      dx:fixed ? 0 : Number(sampleDraw?.[0] || 0) - Number(baseDraw?.[0] || 0),
      dy:fixed ? 0 : Number(sampleDraw?.[1] || 0) - Number(baseDraw?.[1] || 0),
      visible: patch?.behavior === 'follow-classic-visible' ? sample?.visible !== false : true
    };
  };
  const isV3 = ['rdx.production_preview_scene.v3', 'rdx.production_presentation_trace.v1'].includes(this.productionScene?.schema);
  const sampledEffects = isV3
    ? (this.activateAllTraps ? (productionRoom?.children || []).map(child => {
        const sample = String(child?.role || '') === 'projectile'
          ? productionProjectileCadenceSample(child, tick, productionRoom)
          : trackSample(child, tick, this.activateAllTraps);
        return sample?.visible === false ? null : { ...sample, child, kind: child.role || 'projectile' };
      }).filter(Boolean) : [])
    : (this.activateAllTraps ? this.trapSystem.effectsAt(states, tick) : []);
  // Resolved Simulate keeps non-projectile diagnostics but never accepts
  // synthetic projectile cadence/travel as runtime truth.
  const recordedEffects = this.resolvedProjection
    ? sampledEffects.filter(effect => effect.kind !== 'projectile')
    : sampledEffects;
  /* ResolvedLevel deliberately does not persist projectile tracks. In
   * Simulate, Layer E supplies only the reviewed emitter/muzzle while the
   * current native type-3 slot supplies wake/cadence/displacement/lifetime. */
  const nativeProjectileEffects = this.activateAllTraps && this.resolvedProjection
    ? (productionRoom?.projectileEmitters || []).flatMap(emitter => {
        const reviewedCarrierKeys = Array.isArray(emitter?.nativeProjectileSourceKeys) && emitter.nativeProjectileSourceKeys.length
          ? emitter.nativeProjectileSourceKeys : [emitter?.sourceKey];
        const simulationSourceKey = String(emitter?.simulationProjectileSourceKey || reviewedCarrierKeys[0] || '');
        return simulationSourceKey ? [projectNativeProjectile(
          emitter, this.nativeRuntimeStates.get(simulationSourceKey) || null)].filter(Boolean) : [];
      })
    : [];
  const effects = [...recordedEffects, ...nativeProjectileEffects];
  /* A logical stationary shooter can own one or more separate native 0x39
   * carrier slots. Those carrier semantic rows remain useful as resolved Layer-E
   * topology metadata, but they are never a phase-zero drawable
   * actor: their dormant Classic sprite is zero and their captured draw is
   * only the mutable carrier slot, not the reviewed muzzle. Render a carrier
   * sprite only through the native projectile effect above when Simulate says
   * that slot is active. Self-owned projectile actors (0x19/0x1a families)
   * are intentionally excluded from this suppression. */
  const separateNativeProjectileCarrierSources = new Set(
    (productionRoom?.projectileEmitters || []).flatMap(emitter => {
      const bodySourceKey = String(emitter?.bodySourceKey || emitter?.sourceKey || '');
      const carrierKeys = Array.isArray(emitter?.nativeProjectileSourceKeys) && emitter.nativeProjectileSourceKeys.length
        ? emitter.nativeProjectileSourceKeys : [emitter?.sourceKey];
      return carrierKeys.map(key => String(key || '')).filter(key => key && key !== bodySourceKey);
    }));
  /* ResolvedLevel/native actor state already owns non-projectile body motion
   * and presentation. Legacy PreviewTrapSystem effects are useful for the old
   * production-scene path, but applying their transform/PN again would
   * double-project controller motion and can replace reviewed RDX identity. */
  const effectByIndex = new Map((isV3 || this.resolvedProjection) ? [] :
    effects.filter(effect => effect.kind !== 'projectile').map(effect => [effect.sourceIndex, effect]));
  metrics.traps = effects.length;

  /* Static reusable traps are descriptor-owned, so Preview can render their
   * compiled family asset directly instead of depending on a stale captured
   * production_scene actor row. Native gameplay consumes the same resolved
   * tile-pair through rdx_scenery_placements. Stateful traps remain runtime-
   * source-owned so activation/deactivation is never reimplemented here. */
  if (this.systemModificationsEnabled) for (const row of descriptorStaticSceneryVisuals(this.trapRegistry, this.selection.submap, this.selection.mapId)) {
    const sourceKey = String(row.trap.sourceKey || `trap:${row.trap.id}`);
    if (stateSourceKeys.has(sourceKey)) continue;
    const frame = sceneryAssemblyFrame(this.spriteDecoder, palette, row.asset, this);
    if (!frame) continue;
    const drawX = Math.round(row.position[0]), drawY = Math.round(row.position[1]);
    const actorDepth = normalizedActorDepth(row.asset.actorDepth || row.asset.depth || 'behind-midground');
    const front = actorDepth === 'front';
    const target = targetForActorDepth(this, actorDepth);
    target.blit(frame.pixels, drawX, drawY, { useAlpha:true });
    const drawBounds = { x:drawX, y:drawY, width:frame.pixels.width, height:frame.pixels.height };
    const opaqueBounds = opaqueDrawBounds(frame.pixels, drawX, drawY) || drawBounds;
    const collisionBounds = { x:row.contact[0], y:row.contact[1], width:row.contact[2], height:row.contact[3] };
    const resolvedTrap = (productionRoom?.terrainHazards || []).find(item => String(item?.sourceKey || '') === sourceKey) || null;
    const diagnostic = resolvedTrap?.diagnostics || row.trap?.diagnostics || null;
    const diagnosticMargin = Math.max(0, Number(diagnostic?.selectionMarginPx || 0));
    const selectableBounds = diagnosticMargin ? {
      x:drawBounds.x - diagnosticMargin, y:drawBounds.y - diagnosticMargin,
      width:drawBounds.width + diagnosticMargin * 2, height:drawBounds.height + diagnosticMargin * 2
    } : drawBounds;
    if (actorDepth === 'behind-midground') dirtyBehindMidground = unionBounds(dirtyBehindMidground, drawBounds);
    else if (front) dirtyFront = unionBounds(dirtyFront, drawBounds); else dirty = unionBounds(dirty, drawBounds);
    metrics.actors += 1; metrics.traps += 1;
    selectables.push(selectableRecord({
      id:`descriptor-scenery:${row.trap.id}`, sourceKey, traceCollection:'trapRegistry', port:'rdx',
      kind:'trap', category:'trap', role:'trap', actorId:0,
      pn:diagnostic?.pn != null && Number.isFinite(Number(diagnostic.pn)) ? Number(diagnostic.pn) : null,
      animationTick:Number(tick) || 0,
      x:drawX + Math.floor(frame.pixels.width / 2), y:drawY + frame.pixels.height, draw:[drawX,drawY], fallback:false,
      authority:'trap-descriptor-reusable-scenery', visible:true, mirrorX:!!row.asset.mirrorX,
      mirrorY:!!row.asset.mirrorY,
      ...(diagnostic?.quarterTurns != null && Number.isFinite(Number(diagnostic.quarterTurns))
        ? { quarterTurns:Number(diagnostic.quarterTurns) & 3 } : {}),
      actorDepth, front, assetFlags:Number(row.asset.assetFlags || RDX_ASSET_FLAG_SCENERY_ASSEMBLY),
      visualKind:1, tileIndices:row.asset.tileIndices, repeat:row.asset.repeat,
      paletteLine:Number(row.asset.paletteLine || 0), opaqueBounds, collisionBounds,
      assetFamily:row.trap.family || null, parentSourceKey:row.trap.classicParentSourceKey || null
    }, selectableBounds));
  }

  /* Reviewed PN overlays are rendered in the same actor/scenery layer as the
   * native presenter.  They deliberately do not mutate Plane A/B: suppress/
   * copy patches own map pixels, while overlay-pn owns a stable PI-origin
   * sprite replacement.  Keeping this dynamic also preserves Preview/native
   * occlusion parity with the foreground plane. */
  if (this.systemModificationsEnabled) for (const patch of this.reviewedMapVisualPatches) {
    if (patch.action !== 'overlay-pn' ||
        Number(patch.mapId) !== Number(this.selection.mapId) ||
        Number(patch.submap) !== Number(this.selection.submap)) continue;
    const origin = Array.isArray(patch.origin) ? patch.origin.map(Number) : null;
    const sourceKey = String(patch.sourceKey || `map-visual:${patch.id}`);
    const userOverride = this._overrideFor('rdx', sourceKey);
    const pn = Number(userOverride?.pn ?? patch.pn);
    if (!origin || origin.length < 2 || !Number.isFinite(pn) || userOverride?.visible === false) continue;
    const effectiveOrigin = [Number(userOverride?.x ?? origin[0]), Number(userOverride?.y ?? origin[1])];
    const mirrorX = userOverride?.mirrorX == null ? !!patch.mirrorX : !!userOverride.mirrorX;
    const mirrorY = userOverride?.mirrorY == null ? !!patch.mirrorY : !!userOverride.mirrorY;
    const actorDepth = normalizedActorDepth(userOverride?.actorDepth ?? userOverride?.depth ?? patch.depth ?? patch.actorDepth,
      userOverride?.front == null ? !!patch.front : !!userOverride.front);
    const front = actorDepth === 'front';
    const quarterTurns = Number(patch.quarterTurns || 0) & 3;
    const pinnedFrame = Number(userOverride?.frameIndex ?? -1);
    let sourceFrame = null;
    if (Number.isInteger(pinnedFrame) && pinnedFrame >= 0) {
      const animation = this.spriteDecoder.framesForPn(pn, palette, { mirrorX, mirrorY });
      sourceFrame = animation.frames[Math.min(pinnedFrame, Math.max(0, animation.frames.length - 1))] || null;
    } else sourceFrame = this._frameForPn(pn, Number(tick) || 0, palette, { mirrorX, mirrorY });
    const frame = rotateSpriteFrame(sourceFrame, quarterTurns);
    if (!frame) continue;
    const drawX = Math.round(effectiveOrigin[0] - Number(frame.originX || 0));
    const drawY = Math.round(effectiveOrigin[1] - Number(frame.originY || 0));
    const target = targetForActorDepth(this, actorDepth);
    target.blit(frame.pixels, drawX, drawY, { useAlpha:true });
    const bounds = { x:drawX, y:drawY, width:frame.pixels.width, height:frame.pixels.height };
    const opaqueBounds = opaqueDrawBounds(frame.pixels, drawX, drawY) || bounds;
    if (actorDepth === 'behind-midground') dirtyBehindMidground = unionBounds(dirtyBehindMidground, bounds);
    else if (front) dirtyFront = unionBounds(dirtyFront, bounds); else dirty = unionBounds(dirty, bounds);
    metrics.actors += 1;
    if (String(patch.role || '').toLowerCase() === 'trap' || String(patch.category || '').toLowerCase() === 'hazard') metrics.traps += 1;
    selectables.push(selectableRecord({
      id:`reviewed-overlay:${patch.id}`, sourceKey,
      traceCollection:'reviewedMapVisualPatches', port:'rdx', kind:String(patch.role || 'scenery'),
      category:String(patch.category || patch.role || 'object'), role:String(patch.role || 'scenery'),
      actorId:Number(patch.actorId || 0), pn, animationTick:Number(tick) || 0,
      x:effectiveOrigin[0], y:effectiveOrigin[1], draw:[drawX,drawY], fallback:false,
      authority:String(userOverride?.authority || patch.authority || 'reviewed-static-pn-overlay'), visible:true,
      mirrorX, mirrorY, quarterTurns, actorDepth, front, opaqueBounds,
      collisionBounds:(String(patch.role || '').toLowerCase()==='trap' ? opaqueBounds : null)
    }, bounds));
  }

  /* Stationary shooter bodies are stable Layer-E presentation objects even
   * though their Classic type-3 source slot becomes the projectile while
   * awake. Keep the body persistent and separate from the transient native
   * projectile instance; do not bind its position to the mutable slot. */
  for (const emitter of productionRoom?.projectileEmitters || []) {
    const sourceKey = String(emitter?.bodySourceKey || emitter?.sourceKey || '');
    if (!sourceKey || stateSourceKeys.has(sourceKey) || emitter?.bodyVisible === false) continue;
    const actorId = Number(emitter.actorId);
    const actorDef = Number.isFinite(actorId) ? this.spriteDecoder.parseActorDef(actorId) : null;
    const pn = emitter.bodyPn != null && Number.isFinite(Number(emitter.bodyPn)) ? Number(emitter.bodyPn) : (Array.isArray(actorDef?.pnUnique) && actorDef.pnUnique.length ? Number(actorDef.pnUnique[0]) : NaN);
    const origin = Array.isArray(emitter.bodyOrigin) ? emitter.bodyOrigin.map(Number) : (Array.isArray(emitter.origin) ? emitter.origin.map(Number) : null);
    if (!origin || origin.length < 2 || !Number.isFinite(pn)) continue;
    const frame = this._frameForPn(pn, Number(tick) || 0, palette, { mirrorX:!!emitter.bodyMirrorX, mirrorY:!!emitter.bodyMirrorY });
    if (!frame) continue;
    const anchor = this.spriteDecoder.placementAnchor(frame, actorId, { role:'shooter' });
    const drawX = Math.round(origin[0] - Number(anchor.x || 0));
    const drawY = Math.round(origin[1] - Number(anchor.y || 0));
    const front = emitter.bodyFront == null ? !!emitter.front : !!emitter.bodyFront;
    const target = front ? this.dynamicFront : this.dynamic;
    target.blit(frame.pixels, drawX, drawY, { useAlpha:true });
    const bounds = { x:drawX, y:drawY, width:frame.pixels.width, height:frame.pixels.height };
    const opaqueBounds = opaqueDrawBounds(frame.pixels, drawX, drawY) || bounds;
    if (front) dirtyFront = unionBounds(dirtyFront, bounds); else dirty = unionBounds(dirty, bounds);
    metrics.actors += 1; metrics.traps += 1;
    stateSourceKeys.add(sourceKey);
    selectables.push(selectableRecord({
      id:`rdx-emitter:${sourceKey}`, sourceKey, instanceKey:String(emitter.key || `emitter-body:${sourceKey}`),
      traceCollection:'projectileEmitters', port:'rdx', kind:'shooter', category:'projectile-shooter', role:'shooter',
      actorId, pn, animationTick:Number(tick) || 0, x:origin[0], y:origin[1], draw:[drawX,drawY],
      fallback:false, authority:String(emitter.bodyAuthority || emitter.authority || 'reviewed-projectile-emitter-link'), visible:true,
      mirrorX:!!emitter.bodyMirrorX, mirrorY:!!emitter.bodyMirrorY, front, emitterContact:emitter.mouth || null,
      emitterDirection:emitter.direction || null, opaqueBounds
    }, bounds));
  }

  for (const state of states) {
    const sourceKey = sourceKeyForState(state) || `rdx:actor:${state.actor?.index ?? state.actor?.actorId ?? 'unknown'}`;
    if (this.resolvedProjection && separateNativeProjectileCarrierSources.has(String(sourceKey))) continue;
    const reviewedActorPatch = reviewedActorPatchBySource.get(String(sourceKey)) || null;
    const classicVisibilityMotion = reviewedActorPatch ? reviewedClassicMotion(reviewedActorPatch, sourceKey) : null;
    const productionBaseOrigin = Array.isArray(state.actor?.productionMotionOrigin)
      ? state.actor.productionMotionOrigin
      : Array.isArray(state.actor?.production?.origin)
        ? state.actor.production.origin : [state.actor?.x ?? state.x, state.actor?.y ?? state.y];
    /* A reviewed actor-pn patch chooses the RDX asset/base anchor only. The
     * current movement delta must come from the already-resolved production
     * RDX actor state, not from a separately captured Classic audit stream.
     * Use the production motion trace's own phase-zero origin when available:
     * activated captures can retain a different static snapshot origin, and
     * subtracting that stale point shifts the whole reviewed trajectory.
     * When motion preview is disabled the reviewed patch origin is itself the
     * intended phase-zero placement, so the dormant capture contributes no
     * motion delta. MD0018 mark:166 exposed both failure modes. */
    const reviewedMotion = reviewedActorPatch ? {
      dx:this.activateAllTraps ? Number(state.x) - Number(productionBaseOrigin?.[0] || 0) : 0,
      dy:this.activateAllTraps ? Number(state.y) - Number(productionBaseOrigin?.[1] || 0) : 0,
      visible:classicVisibilityMotion?.visible !== false
    } : null;
    const userOverride = this._overrideFor('rdx', sourceKey);
    const reviewedOverride = reviewedActorPatch ? {
      pn:Number(reviewedActorPatch.pn), actorId:Number(reviewedActorPatch.actorId || 0),
      x:Number(reviewedActorPatch.origin?.[0]) + Number(reviewedMotion?.dx || 0),
      y:Number(reviewedActorPatch.origin?.[1]) + Number(reviewedMotion?.dy || 0),
      mirrorX:!!reviewedActorPatch.mirrorX, mirrorY:!!reviewedActorPatch.mirrorY,
      quarterTurns:Number(reviewedActorPatch.quarterTurns || 0) & 3,
      contactPolicy:String(reviewedActorPatch.contactPolicy || ''),
      front:!!reviewedActorPatch.front, category:reviewedActorPatch.role || 'trap',
      visible: reviewedMotion?.visible !== false,
      authority:reviewedActorPatch.authority || 'reviewed-actor-pn-patch'
    } : null;
    const override = reviewedOverride || userOverride ? { ...(reviewedOverride || {}), ...(userOverride || {}) } : null;
    const stateDescriptor={
      sourceKey:String(sourceKey),
      stateKey:state.inspectionVisualState ? String(state.inspectionVisualState) : state.animation?.action ? `animation:${String(state.animation.action)}` : `pn:${Number(state.pn)}`,
      sourcePn:Number(state.pn)
    };
    const canonicalStateRows=normalizeCanonicalStatePresentations(state.actor?.production||{}),draftStateRows=Array.isArray(override?.statePresentationOverrides)?override.statePresentationOverrides:[];
    const hasStatePresentation=!!statePresentationMatch(canonicalStateRows,stateDescriptor)||!!statePresentationMatch(draftStateRows,stateDescriptor);
    const statePresentation=resolvedStatePresentation({presentation:state.actor?.production||{},override:draftStateRows,state:stateDescriptor});
    const stateOffsetX=Number(statePresentation.offset?.[0]||0),stateOffsetY=Number(statePresentation.offset?.[1]||0);
    const translateX=Number(override?.translateX||0),translateY=Number(override?.translateY||0);
    const statePresentationOverride=hasStatePresentation&&(statePresentation.pn!==Number(state.pn)||stateOffsetX!==0||stateOffsetY!==0);
    const presentationOverride=statePresentationOverride||(!!override && ['pn','actorId','x','y','mirrorX','mirrorY','front','quarterTurns','frameIndex','category','contactPolicy'].some(key=>Object.prototype.hasOwnProperty.call(override,key)));
    const reviewedOwnsVisibility = reviewedActorPatch?.behavior === 'follow-classic-visible';
    const inspectionHidden = !reviewedOwnsVisibility && state.presentationOnlyInspection === true && state.visible === false;
    if ((!reviewedOwnsVisibility && state.visible === false && !inspectionHidden) || override?.visible === false) continue;
    const runtimeSuppressed = state.runtimeSuppressed === true;
    const effect = effectByIndex.get(state.actor.index), transform = mechanismTransform(effect);
    if (!transform.visible) continue;
    const x = (Number.isFinite(Number(override?.x)) ? Number(override.x) : state.x + transform.dx) + translateX + stateOffsetX;
    const y = (Number.isFinite(Number(override?.y)) ? Number(override.y) : state.y + transform.dy) + translateY + stateOffsetY;
    const mirrorX = override?.mirrorX == null ? !!state.mirrorX : !!override.mirrorX;
    const mirrorY = override?.mirrorY == null ? !!state.mirrorY : !!override.mirrorY;
    const actorDepth = actorDepthFor(state, override);
    const front = actorDepth === 'front';
    if (state.actor.set?.type === 'enemy' || state.actor.role === 'enemy') metrics.invulnerableEnemies += 1;
    const effectPn = state.authority === 'production-c-track' || state.authority === 'production-c-runtime-timeline' || state.authority === 'production-c-strict-trace-replay' ? null : Number(effect?.pn);
    const overridePn = Number(override?.pn);
    const hasOverridePn = Number.isFinite(overridePn) && overridePn >= 0 && overridePn < 0xff;
    const effectivePn = hasOverridePn ? overridePn :
      (hasStatePresentation ? statePresentation.pn : (Number.isFinite(effectPn) && effectPn >= 0 && effectPn < 0xff ? effectPn : state.pn));
    const animationTick = Number.isFinite(Number(override?.animationTick)) ? Number(override.animationTick) : state.animationTick;
    const spriteAnimationTick = egyptProjectileAnimationTick(this.selection.mapId, sourceKey, effectivePn, animationTick);
    const actorId = Number(override?.actorId ?? state.actor.actorId ?? 0);
    const classicEntity = this._classicEntityForSourceKey(sourceKey);
    const classicEntityNo = Number(classicEntity?.entity ?? -1);
    const syntheticClassicReplacement = state.actor?.production?.syntheticClassicReplacement === true;
    const classicMotionOwnedReplacement = state.actor?.production?.classicMotionOwnedReplacement === true;
    const movingPlatform = state.actor?.production?.movingPlatform === true ||
      (actorId === 0x72 && Number(effectivePn) === 66) ||
      (Number(this.selection.mapId) >= 13 && Number(this.selection.mapId) <= 23 && [22,24].includes(Number(effectivePn)) &&
       [0x18, 0x1c].includes(classicEntityNo)) ||
      (String(override?.category || '') === 'moving-platform' && [21,22,23,24].includes(Number(effectivePn)));
    const category = movingPlatform ? ((syntheticClassicReplacement || classicMotionOwnedReplacement) ? 'moving-platform' : 'platform') :
      (override?.category || state.actor?.production?.category || previewCategory(state));
    const blackKey = productionBlackKey(state, category);
    const useSceneryAssembly = !hasOverridePn &&
      ((Number(state.assetFlags || 0) & RDX_ASSET_FLAG_SCENERY_ASSEMBLY) !== 0 || Number(state.visualKind || 0) === 1);
    /* PN36/PN41 are shared semantic weapon/effect identities. Player fuse and
     * ammo still honor the Classic/Revival debug selector, while effective
     * environmental PN41 is always the shared Revival explosion family so the
     * Level Editor matches production SM0C/SM09/SM2E presentation. */
    const forceRevivalDynamite = forcesRevivalDynamitePresentation(state, effectivePn, classicEntityNo);
    const useDynamitePresentation = usesDynamitePresentation(state, classicEntityNo, effectivePn);
    const dynamiteVariant = sharedExplosionVariant(state, sourceKey);
    const playerBullet = classicEntityNo === 0x02;
    const classicClimbState = state.nativeEntity ? {
      c1:state.nativeEntity.c1, x:state.nativeEntity.x, y:state.nativeEntity.y
    } : null;
    const enemySpawn = state.actor?.production?.origin || [state.actor?.x, state.actor?.y];
    const enemySpawnX = Number(enemySpawn?.[0]), enemySpawnY = Number(enemySpawn?.[1]);
    let frame = useSceneryAssembly ? sceneryAssemblyFrame(this.spriteDecoder, palette, state, this) :
      (Number.isFinite(effectivePn) ? (presentationOverride
        ? this._frameForPn(effectivePn, spriteAnimationTick, palette, { mirrorX, mirrorY, rawRdxPn:!!reviewedActorPatch, useDynamitePresentation, forceRevivalDynamite, dynamiteVariant, playerBullet, ammoBoxEntity:classicEntityNo, classicEntity:classicEntityNo, classicSprite:state.sprite, classicClimbState, enemySpawnX, enemySpawnY })
        : this._frameForPn(effectivePn, egyptProjectileAnimationTick(this.selection.mapId, sourceKey, effectivePn, state.animationTick), palette, { mirrorX: !!state.mirrorX, mirrorY: !!state.mirrorY, useDynamitePresentation, forceRevivalDynamite, dynamiteVariant, playerBullet, ammoBoxEntity:classicEntityNo, classicEntity:classicEntityNo, classicSprite:state.sprite, classicClimbState, enemySpawnX, enemySpawnY })) : null);
    const quarterTurns = Number(override?.quarterTurns ?? state.actor?.production?.quarterTurns ?? 0) & 3;
    if (frame && quarterTurns) frame = rotateSpriteFrame(frame, quarterTurns);
    if (frame && state.actorDef) frame = { ...frame, actor: state.actorDef };
    const target = targetForActorDepth(this, actorDepth);
    if (!frame && playerBullet && this.bulletSource === 'classic') {
      const classicState = this._classicStates(tick, true).find(row =>
        Number(row.entity) === 0x02 && String(row.sourceKey || '') === String(sourceKey || ''));
      const classicFrame = classicState ? this._classicSprite(classicState.sprite) : null;
      if (classicFrame) {
        const drawX = Math.round(classicState.x), drawY = Math.round(classicState.y);
        target.blit(classicFrame, drawX, drawY);
        const bounds = { x:drawX, y:drawY, width:classicFrame.width, height:classicFrame.height };
        if (actorDepth === 'behind-midground') dirtyBehindMidground = unionBounds(dirtyBehindMidground,bounds); else if (front) dirtyFront = unionBounds(dirtyFront,bounds); else dirty = unionBounds(dirty,bounds);
        metrics.fallback += 1;
        continue;
      }
    }
    if (!frame && useDynamitePresentation && !forceRevivalDynamite && [36,41].includes(Number(effectivePn)) && this.dynamiteSource === 'classic') {
      const classicStates = this._classicStates(tick, true);
      let classicState = classicStates.find(row => {
        const n = Number(row.entity) & 0x7f;
        return String(row.sourceKey || '') === String(sourceKey || '') && (n === 0x03 || n === 0x10 || n === 0x11);
      });
      if (!classicState && Number(effectivePn) === 36) classicState = this._classicDynamiteState(tick, sourceKey);
      const classicFrame = classicState ? this._classicSprite(classicState.sprite) : null;
      if (classicFrame) {
        const drawX = Math.round(classicState.x), drawY = Math.round(classicState.y);
        target.blit(classicFrame, drawX, drawY);
        const bounds = { x: drawX, y: drawY, width: classicFrame.width, height: classicFrame.height };
        if (actorDepth === 'behind-midground') dirtyBehindMidground = unionBounds(dirtyBehindMidground, bounds); else if (front) dirtyFront = unionBounds(dirtyFront, bounds); else dirty = unionBounds(dirty, bounds);
        metrics.fallback += 1;
        selectables.push(selectableRecord({
          id: `classic-weapon:${sourceKey}`, sourceKey, traceCollection: state.actor?.production?.collection || 'actors', port: 'classic', kind: 'dynamite',
          category:'object', role:Number(effectivePn)===36?'dynamite-fuse':'dynamite-explosion', entity:Number(classicState.entity), sprite:classicState.sprite,
          pn:Number(effectivePn), x:Number(classicState.x)+16, y:Number(classicState.y)+20,
          draw:[drawX,drawY], fallback:true, authority:'weapon-source-selector', visible:true, actorDepth, front
        }, bounds));
        continue;
      }
    }
    if (!frame) {
      const placeholder = this._placeholder(x, y, state.actor.actorId, this.selection.missingPolicy,
        effect?.kind === 'diagnostic', target);
      if (placeholder) {
        if (actorDepth === 'behind-midground') dirtyBehindMidground = unionBounds(dirtyBehindMidground, placeholder);
        else if (front) dirtyFront = unionBounds(dirtyFront, placeholder);
        else dirty = unionBounds(dirty, placeholder);
        metrics.fallback += 1;
        selectables.push(selectableRecord({
          id: `rdx:${sourceKey}`,
          sourceKey,
          traceCollection: state.actor?.production?.collection || 'actors',
          port: 'rdx',
          kind: movingPlatform ? 'moving-platform' : (state.actor.role || state.actor.set?.type || 'actor'),
          category,
          role: movingPlatform ? 'moving-platform' : (state.actor.role || state.actor.set?.type || 'actor'),
          actorId: Number(state.actor.actorId || 0),
          pn: Number.isFinite(effectivePn) ? effectivePn : null,
          x, y,
          draw: [placeholder.x, placeholder.y],
          setId: state.actor.set?.setId || null,
          fallback: true,
          authority: override?.authority || state.authority,
          contactPolicy: override?.contactPolicy || null,
          collisionBounds: reviewedCollisionBounds(state.actor?.production?.collision),
          patchedPlacement: patchedPlacementAuthority(override?.authority, state.actor?.production?.authority, state.actor?.production?.auditAuthority, state.actor?.production?.patchProvenance, state.actor?.production?.implementationDisposition),
          patchProvenance: state.actor?.production?.patchProvenance || null,
          ...(movingPlatform ? { activatorType: activatorTypeFromClassicFlags(classicEntity?.flags) } : {}),
          visible: true,
          mirrorX,
          mirrorY,
          actorDepth,
          front
        }, placeholder));
      } else metrics.hidden += 1;
      continue;
    }
    /* Static and fixed production actors must use the exact C draw point.
     * Re-running the browser's generic MA/PA anchor policy was the root cause
     * of the MD0005 statue shooter being lowered from its mouth to its eyes.
     * Manual note states deliberately use the selected contact/origin point. */
    const drawRegistered = String(state.actor?.production?.presentationRegistration || '') === 'draw';
    const productionEnemyAnchor = !presentationOverride ? this._productionEnemyAnchor(state, frame, palette) : null;
    const decodedAnchor = productionEnemyAnchor || (presentationOverride
      ? this.spriteDecoder.placementAnchor(frame, Number(override?.actorId ?? state.actor.actorId),
          { role: override?.category || state.actor.set?.type || state.actor.role || '' })
      : this.spriteDecoder.placementAnchor(frame, state.actor.actorId,
          { role: state.actor.set?.type || state.actor.role || '' }));
    const traceAnchor = Array.isArray(state.productionAnchor) ? state.productionAnchor : null;
    const anchorTolerance = category === 'enemy' ? 0.01 : 1;
    const cycleAnchorMatches = !state.productionStateCycle || !traceAnchor ||
      (Math.abs(Number(traceAnchor[0]) - Number(decodedAnchor.x)) <= anchorTolerance &&
       Math.abs(Number(traceAnchor[1]) - Number(decodedAnchor.y)) <= anchorTolerance);
    /* A state cycle may change PN dimensions and therefore its contact
     * anchor. Reusing the intact state's draw/anchor for a shorter rubble
     * frame put the exploded remnant in the air. Exact C draw remains valid
     * for stable geometry; state-changed geometry is re-anchored at the same
     * authoritative origin/contact. */
    const stateCyclePnChanged = state.productionStateCycle && Number(state.productionPn) !== Number(state.actor?.production?.pn);
    /* Default Revival replacements (the PN27 idol and PN67/PN68 ammo boxes)
     * use cropped authored frames with their own foot anchors. Native keeps
     * the authoritative contact origin and re-anchors those frames; an exact
     * captured RDX draw point would instead apply the old PN border a second
     * time and move the editor collectible up/left. */
    const replacementFrameOwnsAnchor = ['revival-idol','revival-ammo-box'].includes(String(frame?.pn?.source || ''));
    const sourcePhaseOwnsAnchor = String(productionEnemyAnchor?.mode || '') === 'enemy-classic-source-phase';
    const exactProductionDraw = state.productionDraw && !replacementFrameOwnsAnchor && !sourcePhaseOwnsAnchor && !Number.isFinite(effectPn) && (
      drawRegistered || (!syntheticClassicReplacement && !presentationOverride && effectivePn === state.productionPn && (!stateCyclePnChanged || cycleAnchorMatches))
    );
    let drawX, drawY;
    if (exactProductionDraw) {
      [drawX, drawY] = productionDrawPoint(state.productionDraw, [x, y], state.productionTraceOrigin || [state.x, state.y]);
    } else {
      drawX = Math.round(x - decodedAnchor.x);
      drawY = Math.round(y - decodedAnchor.y);
    }
    const occlusionClip = { top: state.clipTop, bottom: state.clipBottom, left: state.clipLeft, right: state.clipRight };
    if (!inspectionHidden && !runtimeSuppressed) blitOpacity(target, frame.pixels, drawX, drawY, transform.alpha, occlusionClip, blackKey);
    const actorDirty = mechanismDirtyBounds(drawX, drawY, frame.pixels.width, frame.pixels.height, transform);
    const selectableBounds = syntheticClassicReplacement
      ? { x:drawX, y:drawY, width:frame.pixels.width, height:frame.pixels.height }
      : actorDirty;
    const opaqueBounds = opaqueDrawBounds(frame.pixels, drawX, drawY, occlusionClip, blackKey) || actorDirty;
    const classicSourceRecord = (productionRoom?.classicActors || []).find(row => String(row.sourceKey || '') === String(sourceKey));
    const liveEnemyController = category === 'enemy' && Array.isArray(state.nativeControllerOrigin)
      ? state.nativeControllerOrigin : null;
    const canonicalCollision = reviewedCollisionBounds(state.actor?.production?.collision, {
      classicData:this.classicData,
      sprite:classicSourceRecord?.sprite ?? classicSourceRecord?.source?.sprite,
      draw:classicSourceRecord?.draw
    });
    const collisionBounds = canonicalCollision || (override?.contactPolicy === 'classic-source'
      ? fittedClassicCollisionBounds(opaqueBounds, classicEntity)
      : category === 'enemy'
        ? controllerBodyCollisionBounds({
            placement:state.actor?.production?.controllerPlacement, source:classicSourceRecord?.source,
            currentPresentationOrigin:[x,y],
            phaseZeroPresentationOrigin:state.actor?.production?.simulation?.origin || state.actor?.production?.origin,
            liveControllerOrigin:liveEnemyController
          })
        : ['collectible','moving-platform','platform'].includes(category)
          ? fittedClassicCollisionBounds(opaqueBounds, classicSourceRecord?.source)
          : category === 'projectile'
            ? minimalProjectileCollisionBounds(opaqueBounds)
            : (category === 'trap' || category === 'blockage' || category === 'explodable') ? opaqueBounds : null);
    const collisionAuthority = category === 'enemy' && collisionBounds
      ? (liveEnemyController ? 'native-live-controller-body' : 'resolved-controller-placement-body')
      : null;
    if (!inspectionHidden && !runtimeSuppressed) {
      if (actorDepth === 'behind-midground') dirtyBehindMidground = unionBounds(dirtyBehindMidground, actorDirty);
      else if (front) dirtyFront = unionBounds(dirtyFront, actorDirty);
      else dirty = unionBounds(dirty, actorDirty);
      metrics.actors += 1;
    } else metrics.hidden += 1;
    if (state.actor.set?.type !== 'collectible' && ((state.actor.set?.animations || []).length > 1 || frame.pn?.count > 1)) metrics.animated += 1;
    selectables.push(selectableRecord({
      id: `rdx:${sourceKey}`,
      sourceKey,
      traceCollection: state.actor?.production?.collection || 'actors',
      port: 'rdx',
      kind: movingPlatform ? 'moving-platform' : (state.actor.role || state.actor.set?.type || 'actor'),
      category,
      role: movingPlatform ? 'moving-platform' : (state.actor.role || state.actor.set?.type || 'actor'),
      actorId: Number(override?.actorId ?? state.actor.actorId ?? 0),
      pn: Number.isFinite(effectivePn) ? effectivePn : null,
      animationTick,
      x, y,
      draw: [drawX, drawY],
      setId: state.actor.set?.setId || null,
      action: state.animation?.action || null,
      fallback: false,
      authority: override?.authority || state.authority,
      patchedPlacement: patchedPlacementAuthority(override?.authority, state.actor?.production?.authority, state.actor?.production?.auditAuthority, state.actor?.production?.patchProvenance, state.actor?.production?.implementationDisposition),
      patchProvenance: state.actor?.production?.patchProvenance || null,
      parentSourceKey: state.actor?.production?.parentSourceKey || null,
      assetFamily: state.actor?.production?.assetFamily || null,
      visible: !inspectionHidden && !runtimeSuppressed,
      presentationOnlyInspection: state.presentationOnlyInspection === true,
      inspectionVisualState: state.inspectionVisualState || null,
      runtimeSuppressed: state.runtimeSuppressed === true,
      suppression: state.suppression || null,
      implementationDisposition: state.actor?.production?.implementationDisposition || null,
      editorEvidenceOnly: state.actor?.production?.editorEvidenceOnly === true,
      mirrorX,
      mirrorY,
      quarterTurns,
      actorDepth,
      front,
      ...(!syntheticClassicReplacement ? {
        assetFlags: Number(state.assetFlags || 0),
        visualKind: Number(state.visualKind || 0),
        tileIndices: state.tileIndices || null,
        repeat: state.repeat || null,
        paletteLine: Number(state.paletteLine || 0)
      } : {}),
      opaqueBounds,
      collisionBounds,
      ...(collisionAuthority ? { collisionAuthority } : {}),
      movingPlatform,
      movingPlatformMoving: movingPlatform &&
        Array.isArray(state.actor?.production?.origin) &&
        (Math.round(Number(x)) !== Math.round(Number(state.actor.production.origin[0]) + translateX) ||
         Math.round(Number(y)) !== Math.round(Number(state.actor.production.origin[1]) + translateY)),
      ...(movingPlatform ? { activatorType: activatorTypeFromClassicFlags(classicEntity?.flags) } : {})
    }, selectableBounds));
    if (!runtimeSuppressed && effect?.kind === 'diagnostic') drawRect(target, drawX - 1, drawY - 1,
      frame.pixels.width + 2, frame.pixels.height + 2,
      [255, 0, 30, Math.round(255 * (effect.pulse || 1))]);
  }

  /* Native rolling explosions are compositor-owned plan instances rather than
   * xrick entities. NativeRuntimeTimeline preserves them as presentation-only
   * samples; draw each instance separately so SM2E/SM0C/SM09 Simulate shows
   * independently aging rolling cells instead of one frozen source carrier. */
  for (const live of this.nativeRuntimeStates.values()) {
    if (live?.presentationOnlyExplosion !== true || live.visible === false) continue;
    const parentSourceKey = String(live.parentSourceKey || live.sourceKey || 'explosion');
    const variant = sharedExplosionVariant(live, `${parentSourceKey}:${Number(live.presentationInstanceIndex || 0)}`);
    const frame = revivalRollingExplosionFrame(Number(live.tick || 0), variant);
    if (!frame || !Array.isArray(live.draw)) continue;
    const drawX = Math.round(Number(live.draw[0] || 0));
    const drawY = Math.round(Number(live.draw[1] || 0));
    const front = !!live.front;
    const target = front ? this.dynamicFront : this.dynamic;
    blitOpacity(target, frame.pixels, drawX, drawY, 1);
    const bounds = { x:drawX, y:drawY, width:frame.pixels.width, height:frame.pixels.height };
    const opaqueBounds = opaqueDrawBounds(frame.pixels, drawX, drawY) || bounds;
    if (front) dirtyFront = unionBounds(dirtyFront, bounds); else dirty = unionBounds(dirty, bounds);
    metrics.actors += 1;
    metrics.animated += 1;
    selectables.push(selectableRecord({
      id:`rdx:${live.sourceKey}`,
      sourceKey:String(live.sourceKey),
      parentSourceKey,
      traceCollection:'native-presentation-instances',
      port:'rdx', kind:'explosion', category:'projectile', role:'dynamite-explosion',
      actorId:Number(live.actorId ?? 0xff), pn:41,
      animationTick:Number(live.tick || 0), explosionVariant:variant,
      x:Number(live.origin?.[0] ?? 0), y:Number(live.origin?.[1] ?? 0),
      draw:[drawX,drawY], fallback:false,
      authority:String(live.authority || 'native-rdx-presentation-instance'),
      visible:true, mirrorX:false, mirrorY:false, front,
      opaqueBounds
    }, bounds));
  }

  /* Stateful descriptor scenery has no actor slot in the resolved projection.
   * Native draws it through rdx_scenery_placements while its source mark is
   * asleep, then removes it atomically with the mark-owned contact. Mirror that
   * production authority here so Preview/audit do not fall back to the
   * presentation-suppressed legacy actor sprite. */
  const renderedRdxSources = new Set(selectables.filter(item => item?.port === 'rdx' && item?.sourceKey && item?.visible !== false)
    .map(item => String(item.sourceKey)));
  for (const trap of reviewedRdxTraps(this.trapRegistry, this.selection.submap, this.selection.mapId)) {
    const sourceKey = String(trap.sourceKey || '');
    if (!sourceKey || renderedRdxSources.has(sourceKey)) continue;
    const scenery = statefulTrapSceneryVisual(trap, this.nativeRuntimeStates, this._overrideFor('rdx', sourceKey));
    if (!scenery) continue;
    const frame = sceneryAssemblyFrame(this.spriteDecoder, palette, scenery.state, this);
    if (!frame) continue;
    const drawX = Math.round(scenery.position[0]), drawY = Math.round(scenery.position[1]);
    const actorDepth = normalizedActorDepth(scenery.state.actorDepth || scenery.state.depth || 'behind-midground', scenery.state.front === true);
    const front = actorDepth === 'front';
    const target = targetForActorDepth(this, actorDepth);
    target.blit(frame.pixels, drawX, drawY, { useAlpha:true });
    const bounds = { x:drawX, y:drawY, width:frame.pixels.width, height:frame.pixels.height };
    const opaqueBounds = opaqueDrawBounds(frame.pixels, drawX, drawY) || bounds;
    const contact = Array.isArray(trap.contact?.bounds) && trap.contact.bounds.length === 4
      ? trap.contact.bounds.map(Number) : null;
    const collisionBounds = contact && contact.every(Number.isFinite)
      ? Object.freeze({ x:contact[0], y:contact[1], width:contact[2], height:contact[3] }) : opaqueBounds;
    if (actorDepth === 'behind-midground') dirtyBehindMidground = unionBounds(dirtyBehindMidground, bounds);
    else if (front) dirtyFront = unionBounds(dirtyFront, bounds); else dirty = unionBounds(dirty, bounds);
    metrics.actors += 1; metrics.traps += 1;
    renderedRdxSources.add(sourceKey);
    const resolvedTrap = (productionRoom?.terrainHazards || []).find(row => String(row?.sourceKey || '') === sourceKey) || null;
    const diagnostic = resolvedTrap?.diagnostics || trap?.diagnostics || null;
    const diagnosticMargin = Math.max(0, Number(diagnostic?.selectionMarginPx || 0));
    const diagnosticBounds = diagnosticMargin ? {
      x:bounds.x - diagnosticMargin, y:bounds.y - diagnosticMargin,
      width:bounds.width + diagnosticMargin * 2, height:bounds.height + diagnosticMargin * 2
    } : bounds;
    selectables.push(selectableRecord({
      id:`trap-descriptor:${trap.id}`, sourceKey, traceCollection:'trapRegistry', port:'rdx',
      kind:'trap', category:'trap', role:'trap', actorId:0,
      pn:diagnostic?.pn != null && Number.isFinite(Number(diagnostic.pn)) ? Number(diagnostic.pn) : null,
      x:scenery.position[0] + scenery.size[0] / 2, y:scenery.position[1] + scenery.size[1],
      draw:[drawX,drawY], fallback:false,
      authority:String(trap.authority || 'trap-descriptor-scenery-placement'), visible:true,
      mirrorX:!!scenery.state.mirrorX, mirrorY:!!scenery.state.mirrorY,
      quarterTurns:diagnostic?.quarterTurns != null && Number.isFinite(Number(diagnostic.quarterTurns)) ? Number(diagnostic.quarterTurns) & 3 : undefined,
      actorDepth, front, assetFlags:Number(scenery.state.assetFlags || 0), visualKind:1,
      tileIndices:scenery.state.tileIndices, repeat:scenery.state.repeat,
      paletteLine:Number(scenery.state.paletteLine || 0), opaqueBounds, collisionBounds,
      hazardPotential:trap.contact?.lethal === true, lethalPotential:trap.contact?.lethal === true,
      parentSourceKey:trap.classicParentSourceKey || null, assetFamily:trap.family || null
    }, diagnosticBounds));
  }

  /* Some reviewed visual replacements intentionally target Classic entities
   * for which production RDX emitted no actor state at all (notably the
   * retracting Egypt spike family).  Synthesize those PN actors from the
   * Classic runtime track so Preview and native share visibility + motion;
   * only the asset is replaced. */
  for (const patch of reviewedActorPatches) {
    const sourceKey = String(patch.sourceKey || `mark:${patch.mark}`);
    if (patch.behavior === 'suppress' || patch.visible === false) continue;
    if (stateSourceKeys.has(sourceKey)) continue;
    const fixedPresentation = patch.behavior === 'visible-always-fixed';
    const motion = reviewedClassicMotion(patch, sourceKey);
    /* Fixed presentation-only actors do not require a Classic runtime track:
     * their reviewed RDX origin is already the complete placement authority.
     * This is used for Classic-owned projectile controllers whose visible
     * launcher body is absent from the RDX MA stream (SM10 marks 195/199 and
     * SM13 mark 237).  Other reviewed replacements still require the Classic
     * track so visibility/motion cannot be invented. */
    if ((!motion.track && !fixedPresentation) || motion.visible === false) continue;
    const pn = Number(patch.pn);
    const origin = Array.isArray(patch.origin) ? patch.origin.map(Number) : null;
    if (!origin || origin.length < 2 || !Number.isFinite(pn)) continue;
    const x = Number(origin[0]) + Number(fixedPresentation ? 0 : motion.dx || 0);
    const y = Number(origin[1]) + Number(fixedPresentation ? 0 : motion.dy || 0);
    const mirrorX = !!patch.mirrorX, mirrorY = !!patch.mirrorY;
    const productionActor = (productionRoom?.actors || []).find(row => String(row?.sourceKey || '') === sourceKey) || null;
    const category = String(patch.category || patch.role || productionActor?.category || productionActor?.role || 'actor');
    const actorDepth = normalizedActorDepth(patch.actorDepth || patch.depth || productionActor?.actorDepth || ((category === 'trap' || category === 'hazard') ? 'behind-midground' : ''), patch.front === true);
    const front = actorDepth === 'front';
    const quarterTurns = Number(patch.quarterTurns || 0) & 3;
    const frame = rotateSpriteFrame(this._frameForPn(pn, Number(tick) || 0, palette, { mirrorX, mirrorY }), quarterTurns);
    if (!frame) continue;
    const actorId = Number(patch.actorId || 0);
    const anchor = this.spriteDecoder.placementAnchor(frame, actorId, { role:category });
    const drawX = Math.round(x - anchor.x), drawY = Math.round(y - anchor.y);
    const target = targetForActorDepth(this, actorDepth);
    target.blit(frame.pixels, drawX, drawY);
    const bounds = { x:drawX, y:drawY, width:frame.pixels.width, height:frame.pixels.height };
    const opaqueBounds = opaqueDrawBounds(frame.pixels, drawX, drawY) || bounds;
    if (actorDepth === 'behind-midground') dirtyBehindMidground = unionBounds(dirtyBehindMidground, bounds);
    else if (front) dirtyFront = unionBounds(dirtyFront, bounds); else dirty = unionBounds(dirty, bounds);
    metrics.actors += 1;
    if (category === 'trap' || category === 'hazard') metrics.traps += 1;
    selectables.push(selectableRecord({
      id:`reviewed-actor:${sourceKey}`, sourceKey, traceCollection:'classicActors', port:'rdx',
      kind:String(patch.role || productionActor?.role || category), category, role:String(patch.role || productionActor?.role || category), actorId, pn,
      animationTick:Number(tick) || 0, x, y, draw:[drawX,drawY], fallback:false,
      replacesClassicFallback:true, authority:String(patch.authority || 'reviewed-actor-pn-patch'),
      visible:true, mirrorX, mirrorY, quarterTurns, actorDepth, front, opaqueBounds,
      collisionBounds:(category === 'trap' || category === 'hazard') ? opaqueBounds : null
    }, bounds));
  }

  /* The production RDX view keeps classic sprites only for sources with no RDX
   * owner in any passive or action state. Action-state owners such as the
   * MD0003 PN018 boulder and PN077/PN081 spike banks suppress classic overlays. */
  const childOwnedSources = new Set(effects.filter(effect => effect.kind === 'projectile' && effect.child?.sourceKey).map(effect => effect.child.sourceKey));
  for (const fallback of this._classicFallbacks(tick, states)) {
    const sourceKey = fallback.sourceKey || `classic-fallback:${fallback.kind}:${fallback.entity}:${fallback.x}:${fallback.y}`;
    if (reviewedActorOwnedSources.has(String(sourceKey))) continue;
    if (childOwnedSources.has(sourceKey) && (fallback.kind === 'shooter' || fallback.kind === 'projectile')) continue;
    const explicitOverride = this._overrideFor('rdx', sourceKey);
    const recoveredLureMapping = !explicitOverride && Number(fallback.entity) === 0x2f && this.semanticMapper
      ? this.semanticMapper.resolveEntity({ n:fallback.entity, sprite:fallback.sprite, sprbase:Number(fallback.source?.sprbase ?? fallback.source?.sprite ?? 0), x:fallback.x, y:fallback.y }, { direction:fallback.direction })
      : null;
    const override = explicitOverride || (recoveredLureMapping?.status === 'mapped'
      ? { pn:recoveredLureMapping.pn, mirrorX:!!recoveredLureMapping.mirrorX, category:'lure', authority:'recovered-classic-lure-semantic' }
      : null);
    if (override?.visible === false) continue;
    if (Number.isFinite(Number(override?.pn))) {
      const pn = Number(override.pn);
      const originX = Number.isFinite(Number(override.x)) ? Number(override.x) : Number(fallback.x) + 16;
      const originY = Number.isFinite(Number(override.y)) ? Number(override.y) : Number(fallback.y) + 20;
      const mirrorX = !!override.mirrorX;
      const mirrorY = !!override.mirrorY;
      const actorDepth = actorDepthFor(fallback, override);
      const front = actorDepth === 'front';
      const animationTick = Number.isFinite(Number(override.animationTick)) ? Number(override.animationTick) : tick;
      const frame = this._frameForPn(pn, animationTick, palette, { mirrorX, mirrorY });
      if (frame) {
        const actorId = Number(override.actorId || 0);
        const anchor = this.spriteDecoder.placementAnchor(frame, actorId, { role: override.category || fallback.kind || 'object' });
        const drawX = Math.round(originX - anchor.x), drawY = Math.round(originY - anchor.y);
        const target = targetForActorDepth(this, actorDepth);
        target.blit(frame.pixels, drawX, drawY);
        const bounds = { x: drawX, y: drawY, width: frame.pixels.width, height: frame.pixels.height };
        const opaqueBounds = opaqueDrawBounds(frame.pixels, drawX, drawY) || bounds;
        const manualCategory = override.category || previewCategory(fallback);
        const fallbackSource=fallback?.source || null;
        const collisionBounds = manualCategory === 'projectile'
          ? minimalProjectileCollisionBounds(opaqueBounds)
          : manualCategory === 'collectible' ? fittedClassicCollisionBounds(opaqueBounds,fallbackSource)
          : (manualCategory === 'trap' ? opaqueBounds : null);
        if (actorDepth === 'behind-midground') dirtyBehindMidground = unionBounds(dirtyBehindMidground, bounds);
        else if (front) dirtyFront = unionBounds(dirtyFront, bounds); else dirty = unionBounds(dirty, bounds);
        metrics.actors += 1;
        selectables.push(selectableRecord({
          id: `manual-rdx:${sourceKey}`,
          sourceKey,
          traceCollection: 'fallbacks',
          port: 'rdx',
          kind: fallback.kind,
          category: manualCategory,
          role: fallback.kind,
          actorId,
          entity: fallback.entity,
          sprite: fallback.sprite,
          pn,
          animationTick,
          x: originX,
          y: originY,
          draw: [drawX, drawY],
          fallback: false,
          replacesClassicFallback: true,
          authority: override.authority || 'preview-note-override',
          visible: true,
          mirrorX,
          mirrorY,
          actorDepth,
          front,
          opaqueBounds,
          collisionBounds
        }, bounds));
        continue;
      }
    }
    const effectiveFallback = override ? {
      ...fallback,
      x: Number.isFinite(Number(override.x)) ? Number(override.x) - 16 : fallback.x,
      y: Number.isFinite(Number(override.y)) ? Number(override.y) - 20 : fallback.y,
      sprite: Number.isFinite(Number(override.sprite)) ? Number(override.sprite) : fallback.sprite,
      actorDepth: actorDepthFor(fallback, override),
      front: actorDepthFor(fallback, override) === 'front'
    } : fallback;
    const invalidRickFallback = effectiveFallback.kind !== 'player' && isClassicRickSprite(effectiveFallback.sprite);
    const bounds = this._drawClassicFallback(effectiveFallback);
    if (bounds) {
      const fallbackCategory = previewCategory(effectiveFallback);
      const fallbackSource=effectiveFallback?.source || fallback?.source || null;
      const fallbackCollision = reviewedCollisionBounds(effectiveFallback?.collision || fallback?.collision, {
        classicData:this.classicData, sprite:effectiveFallback.sprite,
        draw:[Number(effectiveFallback.x), Number(effectiveFallback.y)]
      }) || (fallbackCategory === 'projectile'
        ? minimalProjectileCollisionBounds(bounds)
        : fallbackCategory === 'collectible' ? fittedClassicCollisionBounds(bounds,fallbackSource)
        : (fallbackCategory === 'trap' ? bounds : null));
      const fallbackDepth = actorDepthFor(effectiveFallback);
      if (fallbackDepth === 'behind-midground') dirtyBehindMidground = unionBounds(dirtyBehindMidground, bounds);
      else if (fallbackDepth === 'front') dirtyFront = unionBounds(dirtyFront, bounds);
      else dirty = unionBounds(dirty, bounds);
      metrics.fallback += 1; if (invalidRickFallback) metrics.invalidRickFallbacks += 1;
      selectables.push(selectableRecord({
        id: `fallback:${sourceKey}`,
        sourceKey,
        traceCollection: 'fallbacks',
        port: 'classic',
        kind: effectiveFallback.kind,
        category: fallbackCategory,
        role: effectiveFallback.kind,
        entity: effectiveFallback.entity,
        sprite: effectiveFallback.sprite,
        x: Number(effectiveFallback.x) + 16,
        y: Number(effectiveFallback.y) + 20,
        draw: [Number(effectiveFallback.x), Number(effectiveFallback.y)],
        fallback: true,
        actorDepth:fallbackDepth,
        front: fallbackDepth === 'front',
        diagnosticPlaceholder: !!effectiveFallback.diagnosticPlaceholder,
        authority: effectiveFallback.auditAuthority || 'production-classic-fallback',
        visible: true,
        opaqueBounds: bounds,
        collisionBounds: fallbackCollision
      }, bounds));
    }
    if (this.activateAllTraps && !isV3 && !this.resolvedProjection && fallback.kind === 'shooter') {
      const sign = effectiveFallback.direction === 'left' ? -1 : 1, travel = (tick % 64) * 3;
      const bullet = this._classicSprite(effectiveFallback.direction === 'left' ? 0x21 : 0x20);
      const px = effectiveFallback.x + (sign < 0 ? -8 - travel : 18 + travel), py = effectiveFallback.y + 6;
      if (bullet) this.dynamic.blit(bullet, Math.round(px), Math.round(py));
      else drawRect(this.dynamic, Math.round(px), Math.round(py), 5, 3, [255, 238, 110, 255], true);
      dirty = unionBounds(dirty, { x: px - 1, y: py - 1, width: bullet?.width || 7, height: bullet?.height || 5 });
      metrics.projectiles += 1; metrics.traps += 1;
    } else if (effectiveFallback.entity > 0x17) {
      metrics.traps += 1;
    }
  }

  for (const effect of effects) {
    if (effect.kind !== 'projectile') continue;
    const projectileDescriptor = effect.child || effect;
    const sourceKey = projectileDescriptor?.sourceKey || effect.sourceKey || `projectile:${projectileDescriptor?.parentSourceKey || 'unknown'}:${projectileDescriptor?.index ?? 0}`;
    const instanceKey = effect.instanceKey || projectileDescriptor?.key || null;
    const override = this._overrideForInstance('rdx', sourceKey, instanceKey);
    if (override?.visible === false) continue;
    const pn = Number.isFinite(Number(override?.pn)) ? Number(override.pn) : Number(effect.pn ?? projectileDescriptor?.pn);
    const animationTick = Number.isFinite(Number(override?.animationTick)) ? Number(override.animationTick) : Number(effect.tick ?? tick);
    const mirrorX = override?.mirrorX == null ? !!effect.mirrorX : !!override.mirrorX;
    const mirrorY = override?.mirrorY == null ? !!effect.mirrorY : !!override.mirrorY;
    const projectileFrame = Number.isFinite(pn)
      ? this._frameForPn(pn, egyptProjectileAnimationTick(this.selection.mapId, sourceKey, pn, animationTick), palette, { mirrorX, mirrorY }) : null;
    const sourceOrigin = effect.origin || [effect.x, effect.y];
    const origin = [
      Number.isFinite(Number(override?.x)) ? Number(override.x) : Number(sourceOrigin?.[0] || 0),
      Number.isFinite(Number(override?.y)) ? Number(override.y) : Number(sourceOrigin?.[1] || 0)
    ];
    const front = override?.front == null ? !!effect.front : !!override.front;
    if (projectileFrame) {
      let px, py, projectileClip = null;
      const emitterGeometry = !override ? emitterAlignedProjectileGeometry(projectileFrame, origin, projectileDescriptor) : null;
      if (emitterGeometry) {
        px = emitterGeometry.drawX; py = emitterGeometry.drawY; projectileClip = emitterGeometry.clip;
      } else if (!override && Array.isArray(effect.draw)) {
        px = Math.round(Number(effect.draw[0])); py = Math.round(Number(effect.draw[1]));
      } else {
        const anchor = override
          ? this.spriteDecoder.placementAnchor(projectileFrame, Number(override.actorId || 0), { role: 'projectile' })
          : this.spriteDecoder.placementAnchor(projectileFrame, 0, { role: 'projectile' });
        px = Math.round(Number(origin[0]) - anchor.x); py = Math.round(Number(origin[1]) - anchor.y);
      }
      const target = front ? this.dynamicFront : this.dynamic;
      if (projectileClip) blitOpacity(target, projectileFrame.pixels, px, py, 1, projectileClip, false);
      else target.blit(projectileFrame.pixels, px, py);
      const bounds = { x: px, y: py, width: projectileFrame.pixels.width, height: projectileFrame.pixels.height };
      const opaqueBounds = opaqueDrawBounds(projectileFrame.pixels, px, py, projectileClip) || bounds;
      const collisionBounds = minimalProjectileCollisionBounds(opaqueBounds);
      if (front) dirtyFront = unionBounds(dirtyFront, bounds); else dirty = unionBounds(dirty, bounds);
      selectables.push(selectableRecord({
        id: `projectile:${sourceKey}`,
        sourceKey,
        instanceKey,
        traceCollection: projectileDescriptor?.collection || (effect.runtimeLifecycle ? 'runtimeProjectiles' : 'children'),
        port: 'rdx',
        kind: 'projectile',
        category: 'projectile',
        role: 'projectile',
        actorId: Number(override?.actorId || 0),
        pn,
        animationTick,
        x: origin[0],
        y: origin[1],
        draw: [px, py],
        fallback: false,
        authority: override?.authority || effect.authority || projectileDescriptor?.authority || 'production-c-child-track',
        visible: true,
        mirrorX,
        mirrorY,
        front,
        parentSourceKey: projectileDescriptor?.parentSourceKey || null,
        emitterContact: projectileDescriptor?.emitterContact || null,
        emitterDirection: projectileDescriptor?.emitterDirection || null,
        opaqueBounds,
        collisionBounds
      }, bounds));
    } else {
      const x = Number(origin[0]), y = Number(origin[1]);
      const width = Number(effect.size?.[0] || 5), height = Number(effect.size?.[1] || 3);
      drawRect(this.dynamic, Math.round(x), Math.round(y), width, height, [255, 238, 110, 255], true);
      const bounds = { x: x - 1, y: y - 1, width: width + 2, height: height + 2 };
      const collisionBounds = Object.freeze({ x:Math.round(x), y:Math.round(y), width:5, height:3 });
      dirty = unionBounds(dirty, bounds);
      selectables.push(selectableRecord({
        id: `projectile:${sourceKey}`,
        sourceKey,
        instanceKey,
        traceCollection: projectileDescriptor?.collection || (effect.runtimeLifecycle ? 'runtimeProjectiles' : 'children'),
        port: 'rdx',
        kind: 'projectile',
        category: 'projectile',
        role: 'projectile',
        pn: Number.isFinite(pn) ? pn : null,
        x, y,
        draw: [x, y],
        fallback: true,
        authority: override?.authority || 'production-c-child-placeholder',
        visible: true,
        mirrorX,
        mirrorY,
        front: false,
        parentSourceKey: projectileDescriptor?.parentSourceKey || null,
        collisionBounds
      }, bounds));
    }
    metrics.projectiles += 1;
  }

  const behindMidgroundUpload = clipBounds(unionBounds(this.previousBehindMidgroundDirty, dirtyBehindMidground), this.dynamicBehindMidground.width, this.dynamicBehindMidground.height) || { x:0, y:0, width:1, height:1 };
  const upload = clipBounds(unionBounds(this.previousDirty, dirty), this.dynamic.width, this.dynamic.height) || { x: 0, y: 0, width: 1, height: 1 };
  const frontUpload = clipBounds(unionBounds(this.previousFrontDirty, dirtyFront), this.dynamicFront.width, this.dynamicFront.height) || { x: 0, y: 0, width: 1, height: 1 };
  this.previousBehindMidgroundDirty = clipBounds(dirtyBehindMidground, this.dynamicBehindMidground.width, this.dynamicBehindMidground.height);
  this.previousDirty = clipBounds(dirty, this.dynamic.width, this.dynamic.height);
  this.previousFrontDirty = clipBounds(dirtyFront, this.dynamicFront.width, this.dynamicFront.height);
  metrics.productionAuthority = this.actorSystem.authority;
  metrics.activityMode = this.activateAllTraps ? (this.strictTrace ? 'simulated-trace' : ((isV3 || this.resolvedProjection) ? 'all-active-runtime-audit' : 'all-traps-preview')) : 'production-snapshot';
  const decorated = this._decorateDynamic(selectables, this.enemyBehaviorDiagnostics(tick, selectables));
  return Object.freeze({
    behindMidgroundPixels: this.dynamicBehindMidground,
    pixels: this.dynamic,
    frontPixels: this.dynamicFront,
    behindMidgroundDirtyBounds: Object.freeze(behindMidgroundUpload),
    dirtyBounds: Object.freeze(upload),
    frontDirtyBounds: Object.freeze(frontUpload),
    metrics: Object.freeze(metrics), states: Object.freeze(states), effects: Object.freeze(effects),
    ...decorated
  });
}
