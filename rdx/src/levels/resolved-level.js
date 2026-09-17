import { playerEntryPhaseZeroUsable } from './player-entry-authority.js';

const RESOLVED_SCHEMA = 'rdr.resolved_levels.v1';
export const EDITOR_PROJECTION_SCHEMA = 'rdr.resolved_editor_projection.v1';

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}


function presentationActorDepth(presentation, state = null) {
  const value = String(state?.actorDepth || state?.depth || presentation?.layer || '');
  if (value === 'behind-midground' || value === 'normal' || value === 'front') return value;
  return state?.front === true ? 'front' : 'normal';
}

function point(value, fallback = [0, 0]) {
  if (!Array.isArray(value) || value.length < 2) return fallback.slice();
  return [num(value[0]), num(value[1])];
}

const EDITOR_INSPECTION_HALF_PERIOD_TICKS = 50; // 2 s at xrick's 25 Hz simulation cadence.

function stageWorldPoint(object, value, reference = null) {
  const projected = point(value);
  const bias = point(object?.alignedBaseline?.runtimeViewportBias || [0, 0]);
  const target = Array.isArray(reference) ? point(reference) : null;
  if (!target || (!bias[0] && !bias[1])) return projected;
  /* Layer-E snapshot draw coordinates may retain the runtime viewport phase
   * while aligned/effective coordinates are already whole-room RDX world
   * coordinates. Collapse only the axis whose documented bias exactly explains
   * its split; an independent visual-anchor residual on the other axis remains. */
  return projected.map((coordinate, axis) => {
    const delta = bias[axis];
    return delta && coordinate + delta === target[axis] ? coordinate + delta : coordinate;
  });
}

function type3SourceIdentity(object, source) {
  const sequence = source?.spriteSequence;
  if (!sequence || String(sequence.authority || '') !== 'xrick-ent-sprseq') return null;
  const dormantSprite = num(sequence.dormant);
  const activeSprite = Array.isArray(sequence.active)
    ? sequence.active.map(value => num(value)).find(value => value > 0) : 0;
  /* xrick type-3 ent_entdata[].spr is not an artwork id: it is the base index
   * into ent_sprseq[]. e_them_t3_action2() resolves the drawable sprite from
   * that sequence on every action call. Layer B must therefore never draw the
   * raw sprbase as sprite art. Prefer the real dormant frame; when the native
   * dormant frame is zero, ordinary actors use the first non-zero active frame
   * as an editor-visible representative. Shooter/projectile carriers stay
   * unresolved until native activation so an active projectile is never drawn
   * as a persistent emitter body. Lifecycle/timing remains native-owned. */
  const role = String(object?.presentation?.runtimeRole || object?.class || '').toLowerCase();
  const transientCarrier = dormantSprite === 0 && (role === 'shooter' || role === 'projectile');
  const sprite = dormantSprite > 0 ? dormantSprite : transientCarrier ? 0 : activeSprite;
  if (!sprite && !transientCarrier) return null;
  return Object.freeze({
    sprite, dormantSprite, activeSprite, role, transientCarrier,
    phase:dormantSprite > 0 ? 'dormant' : transientCarrier ? 'inactive-carrier' : 'active-representative',
    authority:String(sequence.authority)
  });
}

function type3InspectionIdentity(object, source) {
  const identity = type3SourceIdentity(object, source);
  if (!identity?.activeSprite) return null;
  const role = identity.role;
  /* Only stationary trap/lure mechanisms get this editor-only visibility
   * inspection. Other action-owned type-3 entities (SM00's moving ball is the
   * regression case) keep their native/scripted lifecycle rather than becoming
   * a browser-authored blink merely because sprseq has a dormant zero frame. */
  if (identity.dormantSprite !== 0 || (role !== 'trap' && role !== 'lure')) return null;
  return Object.freeze({ activeSprite:identity.activeSprite, authority:identity.authority, role });
}

function editorType3InspectionCycle({ authority, pn = null, classicSprite = null, startVisible = true } = {}) {
  const half = EDITOR_INSPECTION_HALF_PERIOD_TICKS;
  const visible = { phase:startVisible ? 0 : half, duration:half, visible:true, visualState:'active', presentationOnlyInspection:true };
  const hidden = { phase:startVisible ? half : 0, duration:half, visible:false, visualState:'inactive', presentationOnlyInspection:true };
  if (pn != null && Number.isFinite(Number(pn))) { visible.pn=num(pn); hidden.pn=num(pn); }
  if (classicSprite != null && Number.isFinite(Number(classicSprite))) {
    visible.classicSprite=num(classicSprite); hidden.classicSprite=num(classicSprite);
  }
  return Object.freeze({
    authority:`${String(authority || 'xrick-ent-sprseq')}+editor-simulate-presentation-only`,
    period:half*2, inspectionStateSeconds:2,
    samples:Object.freeze(startVisible
      ? [Object.freeze(visible),Object.freeze(hidden)]
      : [Object.freeze(hidden),Object.freeze(visible)])
  });
}

function projectileEmitterProjection(object) {
  const topology = object?.projectileTopologyResolved || null;
  const emitter = topology?.emitter || object?.projectileEmitterResolved;
  if (!emitter || !Array.isArray(emitter.mouth)) return null;
  const projectile = (object?.components || []).find(component =>
    String(component?.role || '') === 'projectile' && Number.isFinite(Number(component?.pn)));
  const projectilePn = projectile?.pn == null ? Number(emitter.projectilePn) : Number(projectile.pn);
  if (!Number.isFinite(projectilePn)) return null;
  const linked = emitter.linked === true;
  if (linked && !Array.isArray(emitter.origin)) return null;
  const shooter = topology?.shooter || null;
  const lane = topology?.lane || null;
  const objectSourceKey = markSource(object);
  const bodySourceKey = String(topology?.bodySourceKey || objectSourceKey || '');
  if (topology?.topologyRole === 'native-projectile-carrier' || (bodySourceKey && objectSourceKey !== bodySourceKey)) return null;
  const sourceKey = bodySourceKey || objectSourceKey;
  const nativeProjectileSourceKeys = Array.isArray(topology?.nativeProjectileSourceKeys)
    ? topology.nativeProjectileSourceKeys.map(String).filter(Boolean)
    : (sourceKey ? [sourceKey] : []);
  const renderOrder = object?.states?.snapshot?.renderOrder;
  const bodyOrigin = linked ? point(shooter?.origin || emitter.origin) : null;
  const emitterOrigin = Array.isArray(emitter.origin) ? point(emitter.origin) : null;
  const actorIdValue = shooter?.actorId ?? emitter.actorId;
  const sourceActorIdValue = shooter?.sourceActorId ?? emitter.actorId;
  const spawnIndexValue = shooter?.spawnIndex ?? emitter.spawnIndex;
  return Object.freeze({
    key: `resolved-emitter:${object.semanticId}`,
    semanticId: object.semanticId,
    sourceKey,
    bodySourceKey: sourceKey,
    nativeProjectileSourceKeys:Object.freeze(nativeProjectileSourceKeys),
    /* A reviewed logical emitter can have multiple mutually exclusive Classic
     * carrier sources. Whole-room Simulate intentionally drives one canonical
     * native carrier so forcing every trigger does not manufacture parallel
     * missiles that normal gameplay can never launch together. */
    simulationProjectileSourceKey:nativeProjectileSourceKeys[0] || sourceKey || null,
    role: 'shooter',
    linked,
    actorId: Number.isFinite(Number(actorIdValue)) ? num(actorIdValue) : null,
    sourceActorId: Number.isFinite(Number(sourceActorIdValue)) ? num(sourceActorIdValue) : null,
    spawnIndex: Number.isFinite(Number(spawnIndexValue)) ? num(spawnIndexValue) : null,
    bodyOrigin: bodyOrigin ? Object.freeze(bodyOrigin) : null,
    bodyVisible: linked && shooter?.visible !== false,
    bodyPn: linked && shooter?.pn != null ? num(shooter.pn) : null,
    bodyMirrorX: linked && !!shooter?.mirrorX,
    bodyMirrorY: linked && !!shooter?.mirrorY,
    bodyFront: linked && object?.presentation?.layer === 'front',
    bodyAuthority: linked ? String(shooter?.authority || 'canonical-static-projectile-shooter') : null,
    origin: emitterOrigin ? Object.freeze(emitterOrigin) : null,
    mouth: Object.freeze(point(emitter.mouth)),
    muzzleOffset: Object.freeze(point(emitter.muzzleOffset || [0,0])),
    direction: String(lane?.direction || emitter.direction || ''),
    lane: Object.freeze({
      direction:String(lane?.direction || emitter.direction || ''),
      endpointPolicy:String(lane?.endpointPolicy || 'room-edge'),
      collisionSize:Object.freeze(point(lane?.collisionSize || [5,3])),
      speedPxPerUpdate:num(lane?.speedPxPerUpdate || emitter?.cadence?.speedPxPerUpdate || 8),
      authority:String(lane?.authority || emitter?.projectionPolicy?.motion || 'native-xrick-projectile-state')
    }),
    renderOrder: renderOrder == null ? null : num(renderOrder),
    front: object?.presentation?.layer === 'front',
    projectilePn:num(projectilePn),
    projectileMirrorX: projectile?.mirrorX == null ? !!(lane?.projectileMirrorX ?? emitter.projectileMirrorX) : !!projectile.mirrorX,
    projectileMirrorY: projectile?.mirrorY == null ? !!(lane?.projectileMirrorY ?? emitter.projectileMirrorY) : !!projectile.mirrorY,
    projectileFront: !!projectile?.front,
    cadence: Object.freeze({
      activationMode:String(emitter.cadence?.activationMode || ''),
      speedPxPerUpdate:num(emitter.cadence?.speedPxPerUpdate || lane?.speedPxPerUpdate || 8),
      authority:String(emitter.cadence?.authority || 'native-xrick-projectile-state')
    }),
    corrections:Object.freeze(Array.isArray(emitter.corrections) ? [...emitter.corrections] : []),
    nativeDisplacementPreserved:emitter.nativeDisplacementPreserved === true,
    cadenceAuthority: String(emitter.cadence?.authority || ''),
    motionAuthority: String(lane?.authority || emitter.projectionPolicy?.motion || ''),
    authority: String(emitter.authority || (linked ? 'reviewed-projectile-emitter-link' : 'source-owned-projectile-emitter'))
  });
}

function markSource(object) {
  /* Rick is the one semantic source whose native identity is not its Classic
   * source mark. Production presentation/runtime evidence uses the stable
   * `player` key, so retaining `mark:0` here disconnects the resolved player
   * from the live native sample and from the legacy editor's player identity. */
  const rdxSourceKey = String(object?.sources?.rdx?.sourceKey || '');
  if (String(object?.presentation?.runtimeRole || object?.class || '') === 'player' && rdxSourceKey)
    return rdxSourceKey;
  const mark = object?.sources?.classic?.mark;
  return Number.isFinite(Number(mark)) ? `mark:${Number(mark)}` : String(rdxSourceKey || object?.semanticId || '');
}

function baselineActor(object, terrainHazard = null, { throughLayer = 'F' } = {}) {
  const sourceKey = markSource(object);
  const useEffectivePlacement = String(throughLayer || 'F').toUpperCase() === 'F';
  const presentation = object?.presentation || {};
  const syntheticClassicReplacement = !!object?.fallback && presentation.authoredOverride === true;
  const syntheticClassicAlwaysVisible = syntheticClassicReplacement &&
    ['follow-classic-always-visible','visible-always-fixed'].includes(
      String(presentation.behavior || 'follow-classic-always-visible'));
  const baseline = object?.baseline || {};
  const aligned = object?.alignedBaseline || {};
  const runtimeAligned = object?.runtimeAlignedBaseline || aligned;
  const effective = object?.effective || {};
  const snapshot = object?.states?.snapshot || {};
  const simulated = object?.states?.simulated || {};
  const visualAnchorOnlyAdjustment = (object?.adjustmentsApplied || [])
    .some(row => String(row?.property || '') === 'visualAnchor');
  const positionAdjustment = (object?.adjustmentsApplied || [])
    .some(row => String(row?.property || '') === 'position');
  const controllerCoupledPresentationAdjustment = positionAdjustment && visualAnchorOnlyAdjustment &&
    object?.controller?.authority === 'classic-xrick' &&
    (presentation.authoredOverride === true || String(object?.class || '') === 'enemy');
  const classicEntity = Number(object?.controller?.entity ?? object?.sources?.classic?.entity);
  const fixedContactPickup = String(object?.spatial?.trajectoryAuthority || '') === 'fixed-contact' &&
    classicEntity >= 0x10 && classicEntity <= 0x15 && presentation.owner === 'rdx';
  const sourceBackedMechanismComponent = Array.isArray(object?.rubbleComponents) && object.rubbleComponents.length > 0;
  /* A Layer-F source-mark correction moves native mechanism-component origin
   * and draw together after immutable actor/spawn selection.  Preserve that
   * same presentation registration in the editor without moving the separate
   * Classic controller coordinate below. Other visual-only families retain
   * their established controller-relative simulation policy. */
  const useEffectivePresentationOrigin = useEffectivePlacement &&
    (!visualAnchorOnlyAdjustment || controllerCoupledPresentationAdjustment ||
      fixedContactPickup || sourceBackedMechanismComponent);
  const unadjustedRuntimeOrigin = snapshot.origin || simulated.origin || baseline.runtimeOrigin || baseline.origin || null;
  const unadjustedRuntimeDraw = snapshot.draw || baseline.runtimeDraw || baseline.visualAnchor || unadjustedRuntimeOrigin;
  const coupledPresentationOriginDelta = useEffectivePlacement && controllerCoupledPresentationAdjustment &&
    Array.isArray(effective.presentationOrigin) && Array.isArray(unadjustedRuntimeOrigin)
    ? [num(effective.presentationOrigin[0]) - num(unadjustedRuntimeOrigin[0]),
      num(effective.presentationOrigin[1]) - num(unadjustedRuntimeOrigin[1])] : null;
  const coupledPresentationDrawDelta = useEffectivePlacement && controllerCoupledPresentationAdjustment &&
    Array.isArray(effective.visualAnchor) && Array.isArray(unadjustedRuntimeDraw)
    ? [num(effective.visualAnchor[0]) - num(unadjustedRuntimeDraw[0]),
      num(effective.visualAnchor[1]) - num(unadjustedRuntimeDraw[1])] : null;
  let origin = point((useEffectivePresentationOrigin ? effective.presentationOrigin : null) ||
    unadjustedRuntimeOrigin || aligned.origin || baseline.runtimeDraw || baseline.visualAnchor);
  let draw = point((useEffectivePlacement ? effective.visualAnchor : null) || unadjustedRuntimeDraw || origin);
  if (syntheticClassicReplacement) draw = stageWorldPoint(object, draw, origin);
  const isPlayer = String(presentation.runtimeRole || object?.class || '') === 'player';
  const playerEntry = isPlayer ? object?.playerEntry || null : null;
  const playerInitializer = playerEntry?.sourceAgreement === 'exact' && Array.isArray(playerEntry?.rdxInitializerOrigin)
    ? point(playerEntry.rdxInitializerOrigin)
    : playerEntry?.phaseZeroAuthority === true && Array.isArray(playerEntry?.rdxInitializerExpectedOrigin)
      ? point(playerEntry.rdxInitializerExpectedOrigin) : null;
  const playerContact = Array.isArray(playerEntry?.worldContact) ? point(playerEntry.worldContact) : null;
  const playerPhaseZero = playerEntryPhaseZeroUsable(playerEntry) && !!playerContact;
  const capturedAnchor = [origin[0] - draw[0], origin[1] - draw[1]];
  /* Rick's Layer-E capture is observational and may be taken long after room
   * entry. When Layer B's xrick map_maps start, Layer C's reviewed transform,
   * and Layer A's PA005D initializer agree exactly, that source convergence is
   * the phase-zero presentation authority. Keep the RDX frame registration
   * from the capture, but not its stale room position. */
  if (playerInitializer) {
    origin = playerInitializer;
    draw = [origin[0] - capturedAnchor[0], origin[1] - capturedAnchor[1]];
  }
  /* RDX-static terrain hazards are sometimes authored as a semantic source
   * plus a separately reviewed Layer-F hazard placement.  Their sourceKey is
   * the join: the semantic source provides artwork/state, while the hazard's
   * visuals.static.position is the reviewed top-left draw position.  Keeping
   * only the source position makes the actual blade sprite stay at Layer E
   * while diagnostics correctly outline its Layer-F placement (SM05 lower
   * floor blades). */
  const hazardStaticDraw = useEffectivePlacement && Array.isArray(terrainHazard?.visuals?.static?.position)
    ? point(terrainHazard.visuals.static.position) : null;
  if (hazardStaticDraw) {
    const baseAnchor = Array.isArray(snapshot.anchor) ? point(snapshot.anchor) : [origin[0] - draw[0], origin[1] - draw[1]];
    draw = hazardStaticDraw;
    origin = [draw[0] + baseAnchor[0], draw[1] + baseAnchor[1]];
  }
  const anchor = [origin[0] - draw[0], origin[1] - draw[1]];
  /* Layer E distinguishes the static room snapshot from the state at which
   * native simulation begins.  The editor must retain the latter separately:
   * xrick's presentation audit is viewport-relative, while this anchor is in
   * the resolved RDX whole-room coordinate space. */
  /* Layer F corrections are effective presentation state, not a static-only
   * editor decoration.  Simulate must start from the same corrected RDX
   * anchor that the static editor shows, then apply controller/native
   * displacement to that anchor exactly once.  Falling back to the raw
   * Layer-E simulated capture here makes corrected actors snap back to stale
   * pre-correction placement as soon as motion begins. */
  let simulationOrigin = playerPhaseZero ? playerContact.slice() :
    coupledPresentationOriginDelta && Array.isArray(simulated.origin)
      ? [num(simulated.origin[0]) + coupledPresentationOriginDelta[0],
        num(simulated.origin[1]) + coupledPresentationOriginDelta[1]]
      : point((useEffectivePresentationOrigin ? effective.presentationOrigin : null) || simulated.origin || origin);
  /* Layer-F visual-anchor corrections are part of the effective simulated
   * presentation as well as the static snapshot.  The earlier scripted-body
   * exemption left SM00's rolling boulder and the same family elsewhere on
   * their stale Layer-E registration as soon as Simulate started, even though
   * the static Layer-F viewport and diagnostics already showed the corrected
   * anchor.  Whole-room controller replay still owns motion; it should simply
   * reuse the corrected phase-zero anchor. */
  let simulationDraw = playerPhaseZero
    ? [simulationOrigin[0] - capturedAnchor[0], simulationOrigin[1] - capturedAnchor[1]]
    : coupledPresentationDrawDelta && Array.isArray(simulated.draw)
      ? [num(simulated.draw[0]) + coupledPresentationDrawDelta[0],
        num(simulated.draw[1]) + coupledPresentationDrawDelta[1]]
      : point((useEffectivePlacement ? effective.visualAnchor : null) || simulated.draw || draw);
  if (syntheticClassicReplacement) simulationDraw = stageWorldPoint(object, simulationDraw, simulationOrigin);
  if (hazardStaticDraw) {
    const simulatedAnchor = Array.isArray(simulated.anchor) ? point(simulated.anchor) : [simulationOrigin[0] - simulationDraw[0], simulationOrigin[1] - simulationDraw[1]];
    simulationDraw = hazardStaticDraw.slice();
    simulationOrigin = [simulationDraw[0] + simulatedAnchor[0], simulationDraw[1] + simulatedAnchor[1]];
  }
  const simulationAnchor = [simulationOrigin[0] - simulationDraw[0], simulationOrigin[1] - simulationDraw[1]];
  const source = object?.sourceEvidence?.classic || {};
  const effectiveTriggerBounds = Array.isArray(effective?.triggerBounds) && effective.triggerBounds.length >= 4
    ? Object.freeze(effective.triggerBounds.slice(0,4).map(Number)) : null;
  const triggerAuthority = object?.alignedTrigger?.authority || object?.triggerSemantics?.authority || null;
  const controllerSourceOrigin = Number.isFinite(Number(source.x)) && Number.isFinite(Number(source.y))
    ? [num(source.x), num(source.y)] : null;
  const controllerAlignedOrigin = Array.isArray(runtimeAligned?.origin) && runtimeAligned.origin.length >= 2
    ? point(runtimeAligned.origin) : null;
  const effectiveControllerOrigin = controllerAlignedOrigin && Array.isArray(effective?.position) && effective.position.length >= 2
    ? point(effective.position) : controllerAlignedOrigin;
  const phaseZeroControllerOrigin = useEffectivePlacement ? effectiveControllerOrigin : controllerAlignedOrigin;
  /* Keep gameplay/controller coordinates separate from presentation anchors.
   * Layer B owns the source entity position and motion program; Layer C moves
   * that gameplay point into RDX-world space. Layer E/F then supplies only the
   * residual visual placement around that point. Whole-room Simulate can move
   * the controller in its own coordinate basis and reapply these residuals
   * without accidentally treating a PN anchor as another alignment offset. */
  /* Layer-B/C player provenance must survive even when the independent RDX
   * initializer does not agree with the Classic entry. Do not let that source
   * evidence become a Layer-E simulation rebase unless source convergence has
   * proved the phase-zero player registration. */
  const controllerPlacement = phaseZeroControllerOrigin && (!isPlayer || playerPhaseZero) ? Object.freeze({
    sourceOrigin: controllerSourceOrigin ? Object.freeze(controllerSourceOrigin) : null,
    alignedOrigin: Object.freeze(controllerAlignedOrigin),
    effectiveControllerOrigin: Object.freeze(effectiveControllerOrigin),
    phaseZeroControllerOrigin: Object.freeze(phaseZeroControllerOrigin),
    presentationOriginOffset: Object.freeze([
      simulationOrigin[0] - phaseZeroControllerOrigin[0],
      simulationOrigin[1] - phaseZeroControllerOrigin[1]
    ]),
    presentationDrawOffset: Object.freeze([
      simulationDraw[0] - phaseZeroControllerOrigin[0],
      simulationDraw[1] - phaseZeroControllerOrigin[1]
    ]),
    regionId: runtimeAligned.authority || null,
    coordinateSpace: 'rdx-world-px',
    authority: useEffectivePlacement
      ? 'layer-b-controller+layer-c-alignment+layer-f-effective-controller+stage-relative-presentation-residual'
      : 'layer-b-controller+layer-c-alignment+layer-e-presentation-residual'
  }) : null;
  const actorId = presentation.actorId == null ? null : num(presentation.actorId);
  const pn = snapshot.pn ?? presentation?.pnByState?.snapshot ?? presentation?.pnByState?.simulated ?? null;
  const assetFlags = num(presentation.assetFlags);
  const tileIndices = Array.isArray(presentation.tileIndices) ? presentation.tileIndices.map(item => num(item)) : [];
  const repeat = Array.isArray(presentation.repeat) ? presentation.repeat.map(item => num(item)) : [];
  const visualKind = num(presentation.visualKind, (assetFlags & 0x08) !== 0 ? 1 : 0);
  const renderOrder = snapshot.renderOrder;
  const actorDepth = presentationActorDepth(presentation, snapshot);
  const front = actorDepth === 'front';
  const mirrorX = snapshot.mirrorX ?? presentation.mirrorX;
  const mirrorY = snapshot.mirrorY ?? presentation.mirrorY;
  const family = String(object?.family || '');
  const implementationDisposition = String(object?.implementationDisposition || '');
  const reviewedInspectionCycle = Number(object?.previewStateCycle?.inspectionStateSeconds) > 0
    ? object.previewStateCycle : null;
  const sourceInspection = type3InspectionIdentity(object, source);
  const previewStateCycle = reviewedInspectionCycle || (sourceInspection && presentation.actionStateOwner === true
    ? editorType3InspectionCycle({ authority:sourceInspection.authority, pn, startVisible:sourceInspection.role !== 'lure' }) : null);
  const runtimeSuppressed = presentation.behavior === 'suppress' || implementationDisposition.startsWith('suppressed');
  const positionAdjusted = (object?.adjustmentsApplied || []).some(row => String(row?.property || '') === 'position');
  const classicMotionOwnedReplacement = family === 'moving-platform' &&
    presentation.authoredOverride === true && object?.controller?.authority === 'classic-xrick';
  const collision = object?.collision && typeof object.collision === 'object'
    ? Object.freeze({
        ...object.collision,
        ...(Array.isArray(object.collision.contactBounds)
          ? { contactBounds:Object.freeze(object.collision.contactBounds.slice(0,4).map(Number)) } : {})
      }) : null;
  return {
    key: `resolved:${object.semanticId}`,
    semanticId: object.semanticId,
    sourceKey,
    role: String(presentation.runtimeRole || object.class || 'actor'),
    family: family || null,
    trajectoryAuthority: object?.spatial?.trajectoryAuthority == null ? null : String(object.spatial.trajectoryAuthority),
    trajectoryPhaseOffsetTicks: num(object?.spatial?.trajectoryPhaseOffsetTicks),
    collision,
    actorId,
    pn: pn == null ? null : num(pn),
    renderOrder: renderOrder == null ? null : num(renderOrder),
    origin,
    draw,
    anchor,
    playerEntry: playerEntry ? Object.freeze({ ...playerEntry,
      classicEntityOrigin:Object.freeze(point(playerEntry.classicEntityOrigin)),
      alignedEntityOrigin:Object.freeze(point(playerEntry.alignedEntityOrigin)),
      worldContact:Object.freeze(point(playerEntry.worldContact)),
      rdxInitializerOrigin:Array.isArray(playerEntry.rdxInitializerOrigin) ? Object.freeze(point(playerEntry.rdxInitializerOrigin)) : null,
      rdxInitializerExpectedOrigin:Array.isArray(playerEntry.rdxInitializerExpectedOrigin) ? Object.freeze(point(playerEntry.rdxInitializerExpectedOrigin)) : null
    }) : null,
    simulation: Object.freeze({
      origin: Object.freeze(simulationOrigin),
      draw: Object.freeze(simulationDraw),
      anchor: Object.freeze(simulationAnchor),
      pn: simulated.pn ?? presentation?.pnByState?.simulated ?? pn,
      actorDepth: presentationActorDepth(presentation, simulated),
      front: presentationActorDepth(presentation, simulated) === 'front',
      mirrorX: simulated.mirrorX ?? mirrorX,
      mirrorY: simulated.mirrorY ?? mirrorY,
      visible: syntheticClassicAlwaysVisible || simulated.visible !== false,
      coordinateSpace: 'rdx-world-px',
      authority: playerPhaseZero ? 'xrick-direct-entry-contact+resolved-rick-presentation-anchor' :
        'layer-e-capture+layer-f-effective-simulated-state'
    }),
    controllerPlacement,
    positionAdjusted,
    projectionThroughLayer: String(throughLayer || 'F').toUpperCase(),
    size: [32, 32],
    mirrorX: !!mirrorX,
    mirrorY: !!mirrorY,
    quarterTurns: num(presentation.quarterTurns) & 3,
    actorDepth,
    front: !!front,
    visible: syntheticClassicAlwaysVisible || snapshot.visible !== false,
    category: presentation.category == null ? null : String(presentation.category),
    assetFlags,
    visualKind,
    repeat,
    verticalPair: !!presentation.verticalPair,
    paletteLine: num(presentation.paletteLine),
    tileIndices,
    emitter: presentation.emitter || null,
    movingPlatform: family === 'moving-platform',
    syntheticClassicReplacement,
    classicMotionOwnedReplacement,
    parentSourceKey: terrainHazard?.classicParentSourceKey || null,
    actionStateOwner: presentation.actionStateOwner === true,
    lifecycleAuthority: presentation.lifecycleAuthority || null,
    scriptedPresentation: object?.scriptedPresentation ? Object.freeze({
      ...object.scriptedPresentation,
      activePnByDirection:Object.freeze({ ...(object.scriptedPresentation.activePnByDirection || {}) })
    }) : null,
    previewStateCycle,
    statePresentations:Object.freeze((presentation.statePresentations || []).map(row=>Object.freeze({...row,offset:Array.isArray(row?.offset)?Object.freeze(row.offset.map(Number)):Object.freeze([0,0])}))),
    presentationRegistration:String(presentation.registration || 'origin'),
    runtimeSuppressed,
    suppression: object?.suppression || null,
    implementationDisposition: implementationDisposition || null,
    authority: 'resolved-level-static',
    source: { ...source, mark: object?.sources?.classic?.mark ?? source.mark, n: object?.sources?.classic?.entity ?? source.n },
    triggerBounds: effectiveTriggerBounds,
    triggerAuthority,
    controller: object.controller || null,
    relationships: object.relationships || [],
    samples: [{ phase: 0, duration: 1, state: 'resolved', visible: syntheticClassicAlwaysVisible || snapshot.visible !== false, sourceKey, origin, draw, anchor,
      size: [32, 32], pn: pn == null ? null : num(pn), mirrorX: !!mirrorX,
      mirrorY: !!mirrorY, front: !!front }],
    trackPeriod: 1
  };
}

function componentActors(object, parent) {
  if (!parent) return [];
  const parentSourceKey = String(parent.sourceKey || markSource(object));
  const parentOrigin = point(parent.origin);
  const parentDraw = point(parent.draw);
  const rebaseSamples = (samples, sourceKey, origin, draw) => {
    if (!Array.isArray(samples)) return samples;
    const originDx = origin[0] - parentOrigin[0], originDy = origin[1] - parentOrigin[1];
    const drawDx = draw[0] - parentDraw[0], drawDy = draw[1] - parentDraw[1];
    return samples.map(sample => {
      const sampleOrigin = Array.isArray(sample?.origin) ? point(sample.origin) : parentOrigin;
      const sampleDraw = Array.isArray(sample?.draw) ? point(sample.draw) : parentDraw;
      return Object.freeze({
        ...sample, sourceKey,
        origin:Object.freeze([sampleOrigin[0] + originDx, sampleOrigin[1] + originDy]),
        draw:Object.freeze([sampleDraw[0] + drawDx, sampleDraw[1] + drawDy])
      });
    });
  };
  const rows = [];
  for (const component of object?.components || []) {
    if (component?.owner !== 'rdx') continue;
    const sourceKey = String(component.sourceKey || '');
    if (!sourceKey || sourceKey === parentSourceKey) continue;
    const match = /^static:(\d+):(-?\d+):(-?\d+):front:([01])$/.exec(sourceKey);
    if (!match) continue;
    const origin = [Number(match[2]), Number(match[3])];
    const anchor = point(parent.anchor);
    const simulationAnchor = point(parent.simulation?.anchor || anchor);
    const draw = [origin[0] - anchor[0], origin[1] - anchor[1]];
    const simulationDraw = [origin[0] - simulationAnchor[0], origin[1] - simulationAnchor[1]];
    const componentCycle = object?.componentStateCycles?.[sourceKey]?.cycle || null;
    const componentSnapshot = object?.componentStateCycles?.[sourceKey]?.snapshot || null;
    const pn = componentSnapshot?.pn == null ? (component.pn == null ? parent.pn : num(component.pn)) : num(componentSnapshot.pn);
    const simulatedSample = Array.isArray(componentCycle?.samples) && componentCycle.samples.length ? componentCycle.samples[componentCycle.samples.length - 1] : null;
    const simulatedPn = simulatedSample?.pn == null ? pn : num(simulatedSample.pn);
    const front = Number(match[4]) !== 0;
    rows.push(Object.freeze({
      ...parent,
      key:`resolved-component:${object.semanticId}:${sourceKey}`,
      semanticId:`${object.semanticId}#component:${sourceKey}`,
      parentSemanticId:String(object.semanticId),
      sourceKey,
      parentSourceKey,
      role:String(component.role || object?.class || 'actor'),
      actorId:component.actorId == null ? parent.actorId : num(component.actorId),
      pn,
      origin:Object.freeze(origin),
      draw:Object.freeze(draw),
      anchor:Object.freeze(anchor),
      front,
      simulation:Object.freeze({
        ...parent.simulation,
        origin:Object.freeze(origin.slice()),
        draw:Object.freeze(simulationDraw),
        anchor:Object.freeze(simulationAnchor),
        pn:simulatedPn,
        front
      }),
      samples:rebaseSamples(parent.samples, sourceKey, origin, draw),
      auditSamples:rebaseSamples(parent.auditSamples, sourceKey, origin, draw),
      previewStateCycle:componentCycle,
      controllerPlacement:null,
      source:Object.freeze({ ...(parent.source || {}), mark:null }),
      authority:'resolved-level-component'
    }));
  }
  return rows;
}

function classicActor(object) {
  const source = object?.sourceEvidence?.classic;
  if (!source || !Number.isFinite(Number(source.x)) || !Number.isFinite(Number(source.y))) return null;
  const sourceKey = markSource(object);
  const reviewedCycle = object?.previewStateCycle || null;
  const sourceIdentity = type3SourceIdentity(object, source);
  const sourceInspection = type3InspectionIdentity(object, source);
  const classicIdentitySamples = Array.isArray(reviewedCycle?.samples)
    ? reviewedCycle.samples.filter(sample => Number.isFinite(Number(sample?.classicSprite))).map(sample => ({
        ...sample, sprite: num(sample.classicSprite), draw: [num(source.x), num(source.y)]
      }))
    : [];
  const inspectionCycle = Number(reviewedCycle?.inspectionStateSeconds) > 0 ? reviewedCycle : null;
  const generatedInspection = !inspectionCycle && sourceInspection
    ? editorType3InspectionCycle({ authority:sourceInspection.authority, classicSprite:sourceInspection.activeSprite, startVisible:sourceInspection.role !== 'lure' }) : null;
  const generatedClassicSamples = generatedInspection ? generatedInspection.samples.map(sample => ({
    ...sample, sprite:num(sample.classicSprite), draw:[num(source.x),num(source.y)]
  })) : [];
  const classicCycleSamples = inspectionCycle ? classicIdentitySamples : generatedClassicSamples;
  const snapshotVisible = object?.states?.snapshot?.visible !== false;
  /* A reviewed Classic state identity is useful even when the state timing is
   * native/runtime-owned rather than an editor inspection cycle. SM04 mark51
   * is the canonical example: source sprbase 54 is an unrelated enemy-death
   * frame, while the reviewed rubble pair is Classic 103/104. Previously the
   * identity was discarded unless `inspectionStateSeconds` was present, so
   * ordinary Classic Simulate drew the death frame. */
  const snapshotSprite = snapshotVisible && classicIdentitySamples.length
    ? num(classicIdentitySamples[0].sprite)
    : sourceIdentity ? num(sourceIdentity.sprite) : num(source.sprite);
  const previewStateCycle = classicCycleSamples.length
    ? { ...(inspectionCycle || generatedInspection), samples: classicCycleSamples } : null;
  const implementationDisposition = String(object?.implementationDisposition || '');
  const runtimeSuppressed = object?.presentation?.behavior === 'suppress' || implementationDisposition.startsWith('suppressed');
  const collision = object?.collision && typeof object.collision === 'object'
    ? Object.freeze({
        ...object.collision,
        ...(Array.isArray(object.collision.contactBounds)
          ? { contactBounds:Object.freeze(object.collision.contactBounds.slice(0,4).map(Number)) } : {})
      }) : null;
  return {
    key: `resolved-classic:${object.semanticId}`,
    semanticId: object.semanticId,
    sourceKey,
    role: String(object?.presentation?.runtimeRole || object.class || 'actor'),
    family: object?.family == null ? null : String(object.family),
    trajectoryAuthority: object?.spatial?.trajectoryAuthority == null ? null : String(object.spatial.trajectoryAuthority),
    collision,
    entity: num(object?.sources?.classic?.entity ?? source.entity),
    sprite: snapshotSprite,
    draw: [num(source.x), num(source.y)],
    source: { ...source, n: num(object?.sources?.classic?.entity ?? source.entity) },
    visible: snapshotVisible,
    authority: classicIdentitySamples.length ? 'classic-source-leg+reviewed-state-identity'
      : sourceIdentity ? `classic-source-leg+${sourceIdentity.authority}-${sourceIdentity.transientCarrier ? 'inactive-carrier' : 'visible-identity'}` : 'classic-source-leg',
    diagnosticPlaceholder: sourceIdentity?.transientCarrier === true,
    renderOrder: Number.isFinite(Number(object?.states?.snapshot?.renderOrder)) ? Number(object.states.snapshot.renderOrder) : null,
    previewStateCycle,
    runtimeSuppressed,
    suppression: object?.suppression || null,
    implementationDisposition: implementationDisposition || null,
    actionStateOwner: object?.presentation?.actionStateOwner === true,
    lifecycleAuthority: object?.presentation?.lifecycleAuthority || null,
    samples: [{ phase: 0, duration: 1, state: 'resolved', visible: snapshotVisible, sourceKey,
      draw: [num(source.x), num(source.y)], sprite: snapshotSprite, direction: 'right' }],
    trackPeriod: 1
  };
}

function resolvedClassicFallback(object, classic, { throughLayer = 'F' } = {}) {
  if (!classic) return null;
  const useEffectivePlacement = String(throughLayer || 'F').toUpperCase() === 'F';
  const effective = object?.effective || {};
  const aligned = object?.alignedBaseline || {};
  const snapshot = object?.states?.snapshot || {};
  const simulated = object?.states?.simulated || {};
  const preserveClassicSourceVisual = object?.presentation?.preserveClassicSourceVisual === true;
  /* A semantic record can own an RDX presentation while intentionally keeping
   * the Classic source pixels as a second visual at the source-aligned anchor.
   * SM2E mark 521 is such a record: its two PN2 consoles share the Classic bomb
   * controller with the lower half of a separate paired Castle blockage.  Do
   * not reuse the RDX component's visualAnchor for that preserved Classic leg. */
  const classicSourceDraw = preserveClassicSourceVisual
    ? point(aligned.origin || classic.draw) : null;
  const contact = point((useEffectivePlacement ? effective.position : null) || aligned.origin || classic.draw);
  const presentationOrigin = classicSourceDraw || point((useEffectivePlacement ? effective.presentationOrigin : null) || simulated.origin || snapshot.origin || contact);
  const rawDraw = classicSourceDraw || point((useEffectivePlacement ? effective.visualAnchor : null) || simulated.draw || snapshot.draw || presentationOrigin);
  const draw = classicSourceDraw || stageWorldPoint(object, rawDraw, presentationOrigin);
  const triggerBounds = Array.isArray(effective?.triggerBounds) && effective.triggerBounds.length >= 4
    ? Object.freeze(effective.triggerBounds.slice(0,4).map(Number)) : null;
  const triggerAuthority = object?.alignedTrigger?.authority || object?.triggerSemantics?.authority || null;
  /* Keep the Classic fallback lifecycle/sample contract intact; only move its
   * presentation into resolved RDX space. Scripted/native motion is layered by
   * the existing preview actor system and is not reimplemented here. */
  const samples = (classic.samples || []).map(sample => ({ ...sample, draw: draw.slice() }));
  return {
    ...classic,
    key: `resolved-fallback:${object.semanticId}`,
    contact,
    presentationOrigin,
    draw,
    triggerBounds,
    triggerAuthority,
    collision: object?.collision && typeof object.collision === 'object'
      ? Object.freeze({
          ...object.collision,
          ...(Array.isArray(object.collision.contactBounds)
            ? { contactBounds:Object.freeze(object.collision.contactBounds.slice(0,4).map(Number)) } : {})
        }) : classic.collision || null,
    preserveClassicSourceVisual,
    actorDepth: presentationActorDepth(object?.presentation, snapshot),
    front: presentationActorDepth(object?.presentation, snapshot) === 'front',
    authority: 'resolved-level-classic-fallback',
    samples
  };
}

export function runtimeEvidenceStatus(resolved, evidence) {
  if (!evidence || evidence.schema !== 'rdx.production_presentation_trace.v1')
    return Object.freeze({ compatible: false, reason: 'runtime evidence is missing' });
  const source = evidence.sourceCapture || {};
  const resolvedHash = evidence.resolvedLevelFingerprint || source.resolvedLevelFingerprint;
  const runtimeHash = evidence.runtimeSourceFingerprint || source.runtimeSourceFingerprint;
  if (!resolvedHash || String(resolvedHash) !== String(resolved?.fingerprints?.resolved || ''))
    return Object.freeze({ compatible: false, reason: 'resolved-level fingerprint differs or is absent' });
  if (!runtimeHash || String(runtimeHash) !== String(resolved?.fingerprints?.runtimeSource || ''))
    return Object.freeze({ compatible: false, reason: 'native runtime-source fingerprint differs or is absent' });
  return Object.freeze({ compatible: true, reason: 'resolved level and native runtime fingerprints match' });
}

function mergeRuntimeRecord(base, evidence) {
  if (!evidence) return base;
  const preserved = {
    auditSamples: evidence.auditSamples,
    auditPeriod: evidence.auditPeriod,
    auditCaptureHorizon: evidence.auditCaptureHorizon,
    auditLoopStart: evidence.auditLoopStart,
    auditLoopPeriod: evidence.auditLoopPeriod,
    auditLoopAuthority: evidence.auditLoopAuthority,
    samples: evidence.samples,
    trackPeriod: evidence.trackPeriod,
    trajectoryCaptureHorizon: evidence.trajectoryCaptureHorizon,
    trajectoryLoopStart: evidence.trajectoryLoopStart,
    trajectoryLoopPeriod: evidence.trajectoryLoopPeriod,
    trajectoryLoopAuthority: evidence.trajectoryLoopAuthority,
    trajectoryKind: evidence.trajectoryKind,
    activationMode: evidence.activationMode,
    auditAuthority: evidence.auditAuthority,
    runtimeEvidenceAuthority: evidence.authority || null
  };
  return { ...base, ...Object.fromEntries(Object.entries(preserved).filter(([, value]) => value != null)),
    authority: 'resolved-level+native-runtime-evidence' };
}

export function createResolvedEditorProjection(resolved, { runtimeEvidence = null, throughLayer = 'F' } = {}) {
  if (resolved?.schema !== RESOLVED_SCHEMA) throw new Error(`Expected ${RESOLVED_SCHEMA}`);
  const evidenceStatus = runtimeEvidenceStatus(resolved, runtimeEvidence);
  const evidenceRooms = new Map((evidenceStatus.compatible ? runtimeEvidence.rooms || [] : [])
    .map(room => [`${num(room.submap)}:${num(room.mapId)}`, room]));
  const rooms = (resolved.rooms || []).map(room => {
    const evidenceRoom = evidenceRooms.get(`${num(room.submap)}:${num(room.mapId)}`) || null;
    const bySource = new Map((evidenceRoom?.actors || []).map(row => [String(row.sourceKey || ''), row]));
    const byClassic = new Map((evidenceRoom?.classicActors || []).map(row => [String(row.sourceKey || ''), row]));
    const semantic = room?.layers?.semanticCorpus?.objects || [];
    const terrainHazards = room?.layers?.semanticCorpus?.terrainHazards || [];
    const terrainHazardByParent = new Map(terrainHazards
      .filter(hazard => String(hazard?.classicParentSourceKey || ''))
      .map(hazard => [String(hazard.classicParentSourceKey), hazard]));
    const terrainHazardBySource = new Map(terrainHazards
      .filter(hazard => String(hazard?.sourceKey || ''))
      .map(hazard => [String(hazard.sourceKey), hazard]));
    const actors = semantic
      .map((object, sourceOrder) => ({ object, sourceOrder }))
      .filter(({ object }) => ['rdx','revival'].includes(String(object?.presentation?.owner || '')))
      .sort((a, b) => num(a.object?.states?.snapshot?.renderOrder, a.sourceOrder) -
        num(b.object?.states?.snapshot?.renderOrder, b.sourceOrder))
      .flatMap(({ object }) => {
        const sourceKey = String(markSource(object));
        const base = baselineActor(object, terrainHazardBySource.get(sourceKey) || terrainHazardByParent.get(sourceKey) || null, { throughLayer });
        const parent = mergeRuntimeRecord(base, bySource.get(String(base.sourceKey)) || null);
        return [parent, ...componentActors(object, parent).map(row =>
          mergeRuntimeRecord(row, bySource.get(String(row.sourceKey)) || null))];
      });
    const classicActors = semantic.map(object => {
      const base = classicActor(object);
      return base ? mergeRuntimeRecord(base, byClassic.get(String(base.sourceKey)) || null) : null;
    }).filter(Boolean).sort((a, b) => {
      const ao = Number(a.renderOrder), bo = Number(b.renderOrder);
      if (Number.isFinite(ao) && Number.isFinite(bo) && ao !== bo) return ao - bo;
      if (Number.isFinite(ao) !== Number.isFinite(bo)) return Number.isFinite(ao) ? -1 : 1;
      const ay = num(a.draw?.[1]), by = num(b.draw?.[1]);
      if (ay !== by) return ay - by;
      const ax = num(a.draw?.[0]), bx = num(b.draw?.[0]);
      if (ax !== bx) return ax - bx;
      return String(a.sourceKey || '').localeCompare(String(b.sourceKey || ''));
    });
    const projectileEmitters = semantic.map(projectileEmitterProjection).filter(Boolean)
      .sort((a, b) => num(a.renderOrder) - num(b.renderOrder) || String(a.sourceKey).localeCompare(String(b.sourceKey)));
    const preservedClassicSourceKeys = new Set(semantic
      .filter(object => object?.presentation?.preserveClassicSourceVisual === true)
      .map(markSource).filter(Boolean));
    const replacementSourceKeys = [...new Set([
      ...actors.map(row => row.sourceKey).filter(Boolean),
      ...projectileEmitters.map(row => row.sourceKey).filter(Boolean)
    ])].filter(sourceKey => !preservedClassicSourceKeys.has(sourceKey));
    const fallbackKeys = new Set(replacementSourceKeys);
    /* Some Classic action slots are controller/trigger partners for a nearby
     * RDX-owned presentation body rather than a second visible object.  The
     * canonical room keeps both sources because native xrick still owns both
     * controllers.  RDX editor projection, however, must not materialize the
     * Classic partner as an additional sprite when the pair has the same
     * Classic entity type and exactly the same effective trigger bounds.  At
     * present this uniquely identifies SM03 mark29 -> mark30, and unlike a
     * gameplay suppression it leaves the Classic pane and native runtime
     * untouched. */
    const triggerKey = value => Array.isArray(value) && value.length === 4
      ? value.map(Number).join(',') : '';
    for (const object of semantic) {
      if (object?.presentation?.owner !== 'classic-fallback') continue;
      const sourceKey = markSource(object);
      const entity = Number(object?.sources?.classic?.entity);
      const trigger = triggerKey(object?.effective?.triggerBounds);
      if (!sourceKey || !Number.isFinite(entity) || !trigger) continue;
      const presentationOwner = semantic.find(candidate => candidate !== object &&
        ['rdx','revival'].includes(String(candidate?.presentation?.owner || '')) &&
        Number(candidate?.sources?.classic?.entity) === entity &&
        triggerKey(candidate?.effective?.triggerBounds) === trigger);
      if (presentationOwner) fallbackKeys.add(sourceKey);
    }
    /* The native/player semantic identity is `player`, but Classic mark 0 is
     * historically shared with transient dynamic slots in some rooms. Preserve
     * the existing replacement suppression for that Classic source identity so
     * fixing Rick's runtime join does not materialize unrelated mark-0 fallback
     * records. */
    for (const actor of actors) {
      if (actor?.role !== 'player') continue;
      const sourceMark = Number(actor?.source?.mark);
      if (Number.isFinite(sourceMark)) fallbackKeys.add(`mark:${sourceMark}`);
    }
    /* `classicActors` intentionally stays in raw Classic source space for the
     * Classic comparison pane. RDX fallbacks are a different projection: the
     * Classic pixels are drawn at the ResolvedLevel contact/presentation
     * anchor after Layer C/E/F have been applied exactly once. Reusing the raw
     * source-space draw here was the SM02 collectible double-space bug. */
    const classicBySemanticId = new Map(classicActors.map(row => [String(row.semanticId || ''), row]));
    const fallbacks = semantic
      .filter(object => !fallbackKeys.has(markSource(object)))
      .map(object => resolvedClassicFallback(object, classicBySemanticId.get(String(object.semanticId || '')), { throughLayer }))
      .filter(Boolean)
      .sort((a, b) => {
        const ao = Number(a.renderOrder), bo = Number(b.renderOrder);
        if (Number.isFinite(ao) && Number.isFinite(bo) && ao !== bo) return ao - bo;
        if (Number.isFinite(ao) !== Number.isFinite(bo)) return Number.isFinite(ao) ? -1 : 1;
        const ay = num(a.draw?.[1]), by = num(b.draw?.[1]);
        if (ay !== by) return ay - by;
        const ax = num(a.draw?.[0]), bx = num(b.draw?.[0]);
        if (ax !== bx) return ax - bx;
        return String(a.sourceKey || '').localeCompare(String(b.sourceKey || ''));
      });
    return {
      submap: num(room.submap), mapId: num(room.mapId),
      actors, classicActors, fallbacks, replacementSourceKeys, projectileEmitters,
      terrainHazards: [...terrainHazards],
      presentationDepth: room?.layers?.presentationDepth || null,
      children: evidenceRoom?.children || [], activators: evidenceRoom?.activators || [], actionAliases: evidenceRoom?.actionAliases || {},
      captures: evidenceRoom?.captures || [],
      resolvedFingerprint: room?.fingerprints?.resolved || null,
      runtimeEvidenceCompatible: evidenceStatus.compatible
    };
  });
  return Object.freeze({
    schema: EDITOR_PROJECTION_SCHEMA,
    version: resolved.version,
    resolvedLevelFingerprint: resolved.fingerprints.resolved,
    resolvedLevelFingerprint32: resolved.fingerprints.resolved32,
    runtimeSourceFingerprint: resolved.fingerprints.runtimeSource,
    runtimeSourceFingerprint32: resolved.fingerprints.runtimeSource32,
    runtimeEvidence: evidenceStatus,
    throughLayer: String(throughLayer || 'F').toUpperCase(),
    rooms
  });
}

export function nativeLevelParity(resolved, bridge) {
  if (!bridge) return Object.freeze({ compatible: false, reason: 'native runtime unavailable' });
  const expectedLevel = Number(resolved?.fingerprints?.resolved32) >>> 0;
  const expectedRuntime = Number(resolved?.fingerprints?.runtimeSource32) >>> 0;
  const nativeLevel = Number(bridge.resolvedLevelsFingerprint?.()) >>> 0;
  const nativeRuntime = Number(bridge.runtimeSourceFingerprint?.()) >>> 0;
  if (nativeLevel !== expectedLevel) return Object.freeze({ compatible: false, reason: 'native resolved-level fingerprint differs', expectedLevel, nativeLevel, expectedRuntime, nativeRuntime });
  if (nativeRuntime !== expectedRuntime) return Object.freeze({ compatible: false, reason: 'native runtime-source fingerprint differs', expectedLevel, nativeLevel, expectedRuntime, nativeRuntime });
  return Object.freeze({ compatible: true, reason: 'browser resolved model and native runtime match', expectedLevel, nativeLevel, expectedRuntime, nativeRuntime });
}
