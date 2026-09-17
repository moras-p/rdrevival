import { rdxDirectionalMirrorX } from '../runtime/sprite-mapping.js';
import { topologyTargetYs } from '../core/map-topology.js';
import { classifyClassicEnemy } from './enemy-behavior.js';
import { effectiveProductionRecord, productionActorPatchMap } from './production-overrides.js';
import { editorInspectionCycleSample } from './preview-mechanisms.js';

function actorNumber(value) {
  if (typeof value === 'number') return value;
  return Number.parseInt(String(value || '').replace(/^0x/i, ''), 16);
}
function setPriority(set) {
  return ({ player: 6, enemy: 5, trap: 4, collectible: 3, object: 2, utility: 1 })[set.type] ?? 0;
}
function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }

/* ROM/runtime corrections which are stronger than the stale friendly sidecar
 * category. They affect preview behavior only; actor art/PN still comes from
 * the ROM and the shared sprite catalogue. */
const ROLE_OVERRIDES = Object.freeze(new Map([
  [0x45, 'collectible'],       // MD0006 top pickup is static, not a moving trap.
  [0x0c, 'enemy']              // MD0006 MA 0x0C owns the recovered PN15/16 bat set.
]));

/* Direction is encoded by the PA actor variant, not by PN49/PN50 (both are
 * neutral-direction body frames).  These fixed emitters must never flip while
 * firing. Actor 0x34 is the MD0005 left-facing shooter reported by gameplay. */
export const FIXED_ACTOR_FACING = Object.freeze(new Map([
  [0x33, 'right'], [0x34, 'left'], [0x35, 'right'], [0x36, 'left']
]));

function cloneSetWithType(set, type) { return set ? { ...set, type } : null; }

export function classicRoleForEntity(entity, fallback = 'actor') {
  const n = Number(entity || 0) & 0x7f;
  return n >= 0x10 && n <= 0x17 ? 'collectible' : fallback;
}

export function strictTraceOrientation(pnMeta, tracked, fallbackMirrorX = false) {
  const declared = String(pnMeta?.animation?.direction || 'neutral');
  const runtimeMirrorX = !!(tracked?.mirrorX ?? fallbackMirrorX);
  /* PN direction labels describe the intended gameplay facing, while the C
   * presenter mirror flag describes how the decoded ROM pixels must actually
   * be drawn.  Directional RDX PN rows use the opposite raw ROM convention,
   * so dropping mirrorX makes Rick and enemies face backwards. */
  if (declared === 'left' || declared === 'right') {
    return Object.freeze({ direction: declared, mirrorX: runtimeMirrorX,
      authority: 'production-c-directional-pn+runtime-mirror' });
  }
  return Object.freeze({ direction: runtimeMirrorX ? 'left' : 'right', mirrorX: runtimeMirrorX,
    authority: 'runtime-explicit-mirror' });
}


export function strictTraceAnimationTick(role, trackedTick, simulationTick, allActive = false) {
  /* Production trace ticks identify captured visual states, not an instruction
   * to freeze a looping sprite on that capture tick. During Simulate, enemies
   * and projectile/effect actors must keep advancing their PN animation even
   * when the resolved source contains only a stationary phase-zero sample.
   * Mechanism and trap timelines remain trace-owned because their frame phase
   * can encode gameplay state. */
  if (allActive && ['enemy', 'projectile'].includes(String(role || '')))
    return Math.floor(Number(simulationTick) || 0);
  return Math.floor(Number(trackedTick) || 0);
}

export function directionalPnForMotion(pnMeta, direction, fallbackPn) {
  const wanted = String(direction || 'neutral');
  if (wanted !== 'left' && wanted !== 'right') return Number(fallbackPn);
  const current = String(pnMeta?.animation?.direction || 'neutral');
  if (current === wanted) return Number(fallbackPn);
  const action = String(pnMeta?.animation?.action || '');
  const animations = pnMeta?.set?.animations || [];
  const exact = animations.find(row => row.direction === wanted && String(row.action || '') === action);
  const directional = exact || animations.find(row => row.direction === wanted);
  const pn = Number(directional?.pn);
  return Number.isFinite(pn) ? pn : Number(fallbackPn);
}

export function buildActorMetadata(spriteAnims) {
  const byActor = new Map();
  let batSet = null;
  for (const set of spriteAnims?.sets || []) {
    if (set.setId === 'bat') batSet = set;
    for (const raw of set.actorIds || []) {
      const actorId = actorNumber(raw);
      if (!Number.isFinite(actorId)) continue;
      const effective = ROLE_OVERRIDES.has(actorId)
        ? cloneSetWithType(set, ROLE_OVERRIDES.get(actorId)) : set;
      const existing = byActor.get(actorId);
      if (!existing || setPriority(effective) > setPriority(existing)) byActor.set(actorId, effective);
    }
  }
  /* The corrected June-1 catalogue recovered PN15/16 as the bat but did not
   * attach the runtime PA owner. MD0006 MA actor 0x0C is that owner. */
  if (batSet) byActor.set(0x0c, { ...batSet, type: 'enemy', actorIds: ['0x0C'] });
  if (byActor.has(0x45)) byActor.set(0x45, { ...byActor.get(0x45), type: 'collectible' });
  return byActor;
}

function findAction(set, direction, accepted) {
  const animations = set?.animations || [];
  return animations.find(row => row.direction === direction && accepted.some(name => String(row.action || '').includes(name))) || null;
}
function actionForState(set, direction) {
  const animations = set?.animations || [];
  if (!animations.length) return null;
  if (set?.type === 'player') {
    return findAction(set, direction, ['stand', 'idle']) || findAction(set, 'right', ['stand', 'idle']) || animations[0];
  }
  if (set?.type === 'collectible') {
    return animations.find(row => /idle|collectible/.test(String(row.action || ''))) || animations.find(row => row.direction === 'neutral') || animations[0];
  }
  if (set?.setId === 'bat') {
    return animations.find(row => /flying|fly/.test(String(row.action || ''))) || animations[0];
  }
  if (set?.type === 'enemy') {
    return findAction(set, direction, ['walk', 'move', 'run', 'patrol']) || animations.find(row => row.direction === direction) || animations.find(row => row.direction === 'neutral') || animations[0];
  }
  return animations.find(row => /idle|stand/.test(String(row.action || '')) && row.direction === 'neutral') ||
         animations.find(row => row.direction === direction) || animations.find(row => row.direction === 'neutral') || animations[0];
}

function resolvedBatAnimationPn(actor, allActive) {
  if (!allActive || Number(actor?.actorId) !== 0x0c || String(actor?.role || '') !== 'enemy' ||
      String(actor?.set?.setId || '') !== 'bat') return null;
  const flying = (actor.set.animations || []).find(row => String(row.action || '') === 'flying');
  const pn = Number(flying?.pn);
  return Number.isFinite(pn) ? pn : null;
}

function maskSolid(mask, pixelX, pixelY) {
  if (!mask?.proven || pixelX < 0 || pixelY < 0) return false;
  const x = Math.floor(pixelX / 8), y = Math.floor(pixelY / 8);
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return false;
  return mask.data[y * mask.width + x] !== 0;
}
function terrainSupportsFoot(mask, x, footY) {
  const probes = [x - 3, x, x + 3];
  const supported = probes.reduce((sum, px) => sum + (maskSolid(mask, px, footY + 1) ? 1 : 0), 0);
  if (supported < 2) return false;
  for (const px of [x - 4, x + 4]) if (maskSolid(mask, px, footY - 5) || maskSolid(mask, px, footY - 13)) return false;
  return true;
}
function movementMetadata(set, actorId) {
  const animations = set?.animations || [];
  const right = findAction(set, 'right', ['walk', 'move', 'run', 'patrol']);
  const left = findAction(set, 'left', ['walk', 'move', 'run', 'patrol']);
  const mobile = set?.type === 'enemy' && !!(right || left);
  const fixed = FIXED_ACTOR_FACING.get(Number(actorId));
  let startDirection = fixed || (right ? 'right' : left ? 'left' : 'neutral');
  return { mobile, right, left, startDirection, fixedFacing: fixed || null };
}
export function derivePatrol(actorId, originX, originY, dimensions, set, solidMask) {
  const movement = movementMetadata(set, actorId);
  const staticResult = Object.freeze({ mobile: false, minX: originX, maxX: originX, originX, originY, speedTicks: 2, startDirection: movement.startDirection, fixedFacing: movement.fixedFacing, source: movement.mobile ? 'unresolved-support-static' : 'fixed-role' });
  if (!movement.mobile || !solidMask?.proven || !terrainSupportsFoot(solidMask, originX, originY)) return staticResult;
  let minX = clamp(originX, 4, dimensions.width - 5), maxX = minX;
  while (minX > 4 && terrainSupportsFoot(solidMask, minX - 1, originY)) minX -= 1;
  while (maxX < dimensions.width - 5 && terrainSupportsFoot(solidMask, maxX + 1, originY)) maxX += 1;
  if (maxX - minX < 4) return staticResult;
  return Object.freeze({ mobile: true, minX, maxX, originX: clamp(originX, minX, maxX), originY, speedTicks: 2, startDirection: movement.startDirection, fixedFacing: null, source: 'rdx-mt-support-derived' });
}

/* A production whole-room actor can be captured at a camera-local x/y that is
 * one contact cell away from the full-room MT support surface.  The exact
 * snapshot must retain that C coordinate, but the synthetic all-active audit
 * needs a terrain-valid movement envelope.  Search only a small local contact
 * neighbourhood (large enough for the known 32px enemy anchor variants) and
 * use the first proven support run; never cross a wall or invent a fixed-width
 * patrol. */
export function deriveAuditPatrol(actorId, originX, originY, dimensions, set, solidMask) {
  const direct = derivePatrol(actorId, originX, originY, dimensions, set, solidMask);
  if (direct.mobile || !movementMetadata(set, actorId).mobile || !solidMask?.proven) return direct;
  const candidates = [];
  for (let dy = -24; dy <= 24; dy += 1) {
    for (let dx = -32; dx <= 32; dx += 1) {
      if (!dx && !dy) continue;
      candidates.push({ dx, dy, score: Math.abs(dx) + Math.abs(dy) * 3 });
    }
  }
  candidates.sort((a, b) => a.score - b.score || Math.abs(a.dy) - Math.abs(b.dy) || Math.abs(a.dx) - Math.abs(b.dx));
  for (const candidate of candidates) {
    const x = originX + candidate.dx, y = originY + candidate.dy;
    const patrol = derivePatrol(actorId, x, y, dimensions, set, solidMask);
    if (!patrol.mobile) continue;
    /* Keep the exact production spawn as the coordinate authority.  The nearby
     * MT support search is only solving the patrol *envelope* when the captured
     * C track is incomplete.  Returning the adjusted support coordinate as the
     * actor origin made whole-map preview silently relocate enemies (the old
     * MD0011 mark:94 failure).  Translate the support run back into the source
     * coordinate basis instead. */
    return Object.freeze({
      ...patrol,
      minX: patrol.minX - candidate.dx,
      maxX: patrol.maxX - candidate.dx,
      originX,
      originY,
      sourceOriginX: originX,
      sourceOriginY: originY,
      supportOriginX: patrol.originX,
      supportOriginY: patrol.originY,
      contactAdjustment: Object.freeze([candidate.dx, candidate.dy]),
      source: candidate.dx || candidate.dy ? 'rdx-mt-source-anchored-nearest-support-derived' : patrol.source
    });
  }
  return direct;
}
function reflectedPosition(patrol, tick) {
  const span = patrol.maxX - patrol.minX;
  if (!patrol.mobile || span <= 0) return { x: patrol.originX, direction: patrol.startDirection };
  const start = patrol.originX - patrol.minX;
  const signedStep = Math.floor(tick / patrol.speedTicks) * (patrol.startDirection === 'left' ? -1 : 1);
  const period = span * 2;
  const raw = ((start + signedStep) % period + period) % period;
  const xOffset = raw <= span ? raw : period - raw;
  return { x: patrol.minX + xOffset, direction: raw < span ? 'right' : 'left' };
}

function buildPnMetadata(spriteAnims) {
  const byPn = new Map();
  for (const set of spriteAnims?.sets || []) {
    for (const animation of set.animations || []) {
      const pn = Number(animation?.pn);
      if (!Number.isFinite(pn)) continue;
      const existing = byPn.get(pn);
      if (!existing || setPriority(set) > setPriority(existing.set)) {
        byPn.set(pn, Object.freeze({ set, animation }));
      }
    }
  }
  return byPn;
}

function productionRoom(scene, mapId, submap) {
  if (!['rdx.production_preview_scene.v1', 'rdx.production_preview_scene.v2', 'rdx.production_preview_scene.v3', 'rdx.production_presentation_trace.v1', 'rdr.resolved_editor_projection.v1'].includes(scene?.schema)) return null;
  return (scene.rooms || []).find(room =>
    Number(room.mapId) === Number(mapId) &&
    (submap == null || Number(room.submap) === Number(submap))) || null;
}

function productionSampleAtPhase(record, samples, phase) {
  let selected = samples[0];
  for (const sample of samples) {
    if (Number(sample.phase) > phase) break;
    selected = sample;
    const duration = Math.max(1, Number(sample.duration || 1));
    if (phase < Number(sample.phase) + duration) break;
  }
  return { ...(record || {}), ...selected };
}

function productionTimelinePhase(record, tick, prefix, legacyPeriod) {
  const rawTick = Math.floor(Number(tick) || 0);
  const horizon = Number(record?.[`${prefix}CaptureHorizon`]);
  if (Number.isFinite(horizon) && horizon > 0) {
    const captureHorizon = Math.max(1, Math.floor(horizon));
    const loopStart = Number(record?.[`${prefix}LoopStart`]);
    const loopPeriod = Number(record?.[`${prefix}LoopPeriod`]);
    if (Number.isFinite(loopStart) && loopStart >= 0 && Number.isFinite(loopPeriod) && loopPeriod > 0 &&
        loopStart + loopPeriod <= captureHorizon && rawTick >= loopStart) {
      const period = Math.floor(loopPeriod);
      const start = Math.floor(loopStart);
      return start + (((rawTick - start) % period) + period) % period;
    }
    // A capture horizon is finite evidence, not an implicit loop. Before phase
    // zero and after the last captured phase, hold the nearest verified state.
    return Math.max(0, Math.min(captureHorizon - 1, rawTick));
  }

  // Legacy traces predate the capture-horizon contract and encoded looping in
  // trackPeriod/auditPeriod. Keep them readable while all newly generated data
  // distinguishes observed duration from a verified recurrence explicitly.
  const period = Math.max(1, Number(legacyPeriod || 1));
  return ((rawTick % period) + period) % period;
}

export function productionTrackSample(record, tick, allActive = false) {
  const inspection = allActive && Number(record?.previewStateCycle?.inspectionStateSeconds) > 0
    ? editorInspectionCycleSample(record.previewStateCycle, tick) : null;
  if (inspection) return { ...(record || {}), ...inspection };
  /* C presentation audit samples describe RDX-owned draw plans. Records in the explicit `fallbacks` collection have no RDX plan by
   * definition, so an audit capture can legitimately say `visible:false` even
   * while the classic sprite is visible. An actor record may still be tagged
   * `classic-fallback` while carrying a valid RDX audit draw plan (for example
   * MD0010 mark78), so collection ownership is the precise discriminator.
   * In Simulate, keep explicit fallback visibility/timing on the classic sample track;
   * scripted movement is then layered from the classic entity program below.
   * This restores Egypt fallback traps such as MD0022 marks 221/222 instead of
   * making them disappear as soon as Simulate is pressed. */
  const useAudit = allActive && record?.collection !== 'fallbacks' &&
    Array.isArray(record?.auditSamples) && record.auditSamples.length;
  const samples = useAudit ? record.auditSamples : (Array.isArray(record?.samples) ? record.samples : []);
  if (!samples.length) return record || null;
  const prefix = useAudit ? 'audit' : 'track';
  const phase = productionTimelinePhase(record, tick, prefix, useAudit ? record.auditPeriod : record.trackPeriod);
  return productionSampleAtPhase(record, samples, phase);
}

export function productionTrajectorySample(record, tick, allActive = false) {
  const useAudit = allActive && record?.collection !== 'fallbacks' &&
    Array.isArray(record?.auditSamples) && record.auditSamples.length;
  const samples = useAudit ? record.auditSamples : (Array.isArray(record?.samples) ? record.samples : []);
  if (!samples.length) return record || null;
  if (Number.isFinite(Number(record?.trajectoryCaptureHorizon))) {
    const phase = productionTimelinePhase(record, tick, 'trajectory', useAudit ? record.auditPeriod : record.trackPeriod);
    return productionSampleAtPhase(record, samples, phase);
  }
  return productionTrackSample(record, tick, allActive);
}

function productionRoleSet(role, animation, set) {
  if (set) return set;
  const type = role === 'player' ? 'player' : role === 'enemy' ? 'enemy' :
    role === 'collectible' ? 'collectible' : role === 'projectile' ? 'utility' :
    (role === 'shooter' || role === 'trap') ? 'trap' : 'object';
  return Object.freeze({
    setId: `production-${role || 'actor'}`,
    type,
    animations: animation ? [animation] : []
  });
}

function actorDefaultPn(spriteDecoder, actorId) {
  const actor = spriteDecoder?.parseActorDef?.(actorId);
  return Array.isArray(actor?.pnUnique) && actor.pnUnique.length ? Number(actor.pnUnique[0]) : null;
}

function staticSourceActorRecord(actor, pn, role, origin, animationTickOffset = 0, snapshotVisible = true, front = false) {
  const sourceKey = String(actor.sourceKey || '');
  const snapshotTick = Number(animationTickOffset || 0);
  const sample = Object.freeze({ phase: 0, duration: 1, state: 'resolved-static-source',
    visible: snapshotVisible !== false, sourceKey, origin: Object.freeze(origin.slice()), pn,
    mirrorX: false, mirrorY: false, front: !!front, tick: snapshotTick, reanchorFromPn: true });
  return Object.freeze({
    sourceKey, role, actorId: Number(actor.actorId), pn, origin: Object.freeze(origin.slice()),
    draw: null, anchor: null, size: Object.freeze([0, 0]), mirrorX: false, mirrorY: false,
    front: !!front, visible: snapshotVisible !== false, samples: Object.freeze([sample]), trackPeriod: 1,
    staticSource: true, snapshotVisible: snapshotVisible !== false, snapshotAnimationTick: snapshotTick,
    animationTickOffset: snapshotTick, reanchorFromPn: true,
    authority: 'resolved-layer-b-static-presentation-source'
  });
}


function scriptedPathEntry(catalog, entity) {
  return catalog?.entities?.[String(Number(entity || 0) & 0x7f)] || null;
}

export function scriptedMotionAt(path, tick, origin = [0, 0]) {
  if (!path?.steps?.length || !Number.isFinite(Number(path.totalTicks)) || Number(path.totalTicks) <= 0) return null;
  let remaining = ((Math.floor(Number(tick || 0)) % Number(path.totalTicks)) + Number(path.totalTicks)) % Number(path.totalTicks);
  let x = Number(origin[0] || 0), y = Number(origin[1] || 0);
  let direction = 'right';
  for (const step of path.steps) {
    const count = Math.max(0, Number(step.count || 0));
    const used = Math.min(remaining, count);
    x += used * Number(step.dx || 0);
    y += used * Number(step.dy || 0);
    if (used > 0 && Number(step.dx || 0) !== 0) direction = Number(step.dx) < 0 ? 'left' : 'right';
    if (remaining < count) break;
    remaining -= count;
  }
  return Object.freeze({ origin: Object.freeze([x, y]), direction, mirrorX: rdxDirectionalMirrorX(direction),
    authority: 'classic-ent-mvstep-scripted-path' });
}

/* Presentation-only reconstruction for incomplete Classic trigger captures.
 * The native type-3 actor remains gameplay authority; this mirrors only its
 * source-coordinate step/bounds/ONCE semantics so preview artwork can follow it. */
export function classicOneShotScriptedDeltaAt(path, tick, sourceOrigin = [0, 0]) {
  if (!path?.steps?.length) return null;
  const startX = Number(sourceOrigin[0] || 0), startY = Number(sourceOrigin[1] || 0);
  let x = startX, y = startY, stepIndex = 0, stepCount = 0, direction = 'right';
  const updates = Math.max(0, Math.floor(Number(tick) || 0));
  for (let update = 0; update < updates; update += 1) {
    let advanced = false;
    while (!advanced) {
      const step = path.steps[stepIndex];
      if (!step) return Object.freeze({ delta:Object.freeze([x - startX, y - startY]), direction, visible:false,
        authority:'classic-ent-mvstep-one-shot-runtime-bounds' });
      const count = Math.max(0, Number(step.count || 0));
      if (stepCount < count) {
        stepCount += 1;
        const dx = Number(step.dx || 0), dy = Number(step.dy || 0);
        const nextX = x + dx;
        if (nextX > 0 && nextX < 0xe8) {
          x = nextX;
          if (dx !== 0) direction = dx < 0 ? 'left' : 'right';
          const nextY = y + dy;
          if (nextY > 0 && nextY < 0x140) { y = nextY; advanced = true; continue; }
        }
      }
      stepIndex += 1;
      stepCount = 0;
    }
  }
  return Object.freeze({ delta:Object.freeze([x - startX, y - startY]), direction, visible:true,
    authority:'classic-ent-mvstep-one-shot-runtime-bounds' });
}

function syntheticStrictTraceMotion(actor, tick, allActive, scriptedCatalog) {
  const source = actor?.classicSource || null;
  const entity = Number(source?.n || 0) & 0x7f;
  const scripted = scriptedPathEntry(scriptedCatalog, entity);
  if (!allActive || entity < 0x18 || !scripted) return null;
  const expectedWidth = Number(scripted.envelope?.maxX || 0) - Number(scripted.envelope?.minX || 0);
  const expectedHeight = Number(scripted.envelope?.maxY || 0) - Number(scripted.envelope?.minY || 0);
  /* Type-3 identity does not imply movement. Entities such as the on/off side
   * dagger have an all-zero ent_mvstep program and must remain fixed. Falling
   * daggers, boulders and bats are distinguished by a non-zero source path. */
  if (expectedWidth < 1 && expectedHeight < 1) return null;
  /* Preserve the classic capture as the generic completeness test. Production
   * traces can contain transformed or partial action data and must not suppress
   * the complete authored type-3 script globally. Source-specific corrections
   * (currently MD0009 mark:58) are handled before this fallback. */
  const captured = actor?.classicMovementEnvelope || actor?.productionMovementEnvelope || { width: 0, height: 0 };
  if (captured.width + 2 >= expectedWidth && captured.height + 2 >= expectedHeight) return null;
  const oneShot = (Number(actor?.classicFlags || 0) & 0x01) !== 0;
  const oneShotDelta = oneShot ? classicOneShotScriptedDeltaAt(scripted, tick, [
    Number(actor?.classicSource?.x ?? actor.x), Number(actor?.classicSource?.y ?? actor.y)
  ]) : null;
  const motion = oneShotDelta ? Object.freeze({
    origin:Object.freeze([Number(actor.x) + Number(oneShotDelta.delta[0]), Number(actor.y) + Number(oneShotDelta.delta[1])]),
    direction:oneShotDelta.direction, mirrorX:rdxDirectionalMirrorX(oneShotDelta.direction), visible:oneShotDelta.visible,
    authority:oneShotDelta.authority
  }) : scriptedMotionAt(scripted, tick, [actor.x, actor.y]);
  if (expectedWidth < 1) {
    /* A purely vertical ent_mvstep program has no facing semantics. Reusing the
     * helper's default `right` direction would invoke the RDX directional draw
     * mirror and shift asymmetric black-key footprints by one pixel (MD0007
     * mark:45). Preserve the source presentation orientation instead. */
    const tracked = actor?.production ? productionTrackSample(actor.production, tick, true) : null;
    return Object.freeze({ ...motion, direction: 'neutral', mirrorX: !!(tracked?.mirrorX ?? actor?.production?.mirrorX),
      authority: 'classic-ent-mvstep-scripted-path' });
  }
  return Object.freeze({ ...motion, authority: 'classic-ent-mvstep-scripted-path' });
}

function productionTrackMoves(record, audit = false) {
  const samples = audit && Array.isArray(record?.auditSamples) && record.auditSamples.length
    ? record.auditSamples : (Array.isArray(record?.samples) ? record.samples : []);
  if (!samples.length) return false;
  const base = record?.origin || [0, 0];
  const points = [];
  let current = [Number(base[0] || 0), Number(base[1] || 0)];
  for (const sample of samples) {
    if (Array.isArray(sample.origin)) current = [Number(sample.origin[0]), Number(sample.origin[1])];
    if (sample.visible !== false) points.push(current);
  }
  if (points.length < 2) return false;
  const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
  return Math.max(...xs) - Math.min(...xs) >= 2 || Math.max(...ys) - Math.min(...ys) >= 2;
}


function productionMovementEnvelope(record, audit = false) {
  const samples = audit && Array.isArray(record?.auditSamples) && record.auditSamples.length
    ? record.auditSamples : (Array.isArray(record?.samples) ? record.samples : []);
  const points = samples.filter(sample => sample.visible !== false && Array.isArray(sample.origin)).map(sample => sample.origin);
  if (!points.length) return Object.freeze({ width: 0, height: 0 });
  const xs = points.map(point => Number(point[0])), ys = points.map(point => Number(point[1]));
  return Object.freeze({ width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) });
}

function classicMovementEnvelope(record, audit = true) {
  const samples = audit && Array.isArray(record?.auditSamples) && record.auditSamples.length
    ? record.auditSamples : (Array.isArray(record?.samples) ? record.samples : []);
  const points = samples.filter(sample => sample.visible !== false && Array.isArray(sample.draw)).map(sample => sample.draw);
  if (!points.length) return Object.freeze({ width: 0, height: 0 });
  const xs = points.map(point => Number(point[0])), ys = points.map(point => Number(point[1]));
  return Object.freeze({ width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) });
}

export function classicTrackQuality(record, source = null) {
  const samples = (record?.auditSamples?.length ? record.auditSamples : record?.samples) || [];
  const visible = samples.filter(sample => sample.visible !== false && Array.isArray(sample.draw));
  const envelope = classicMovementEnvelope(record, true);
  const policy = classifyClassicEnemy(source?.n ?? record?.source?.n);
  const directions = visible.map(sample => {
    if (sample.direction === 'left' || sample.direction === 'right') return sample.direction;
    return Number(sample.c1 || 0) < 0 ? 'left' : 'right';
  });
  let reversed = false;
  for (let index = 1; index < directions.length; index += 1) {
    if (directions[index] !== directions[index - 1]) { reversed = true; break; }
  }
  const moved = envelope.width >= 2 || envelope.height >= 2;
  const horizontalFamily = policy?.family === 'type1a' || policy?.family === 'type1b';
  /* Type-1 walkers cannot climb or fly. A multi-camera capture occasionally
   * stitched startup rows from different vertical room contexts into one
   * source track (for example MD0009 mark:70). Treat that as invalid capture
   * geometry and fall back to the terrain-bounded horizontal solver. */
  const invalidVerticalDrift = horizontalFamily && envelope.height > 2;
  const hasTrajectoryContract = Number.isFinite(Number(record?.trajectoryCaptureHorizon));
  const verifiedLoop = Number(record?.trajectoryLoopPeriod) > 0 &&
    Number(record?.trajectoryLoopStart) >= 0 &&
    String(record?.trajectoryLoopAuthority || '').includes('native-type1a-motion-state');
  const complete = invalidVerticalDrift ? false : policy?.family === 'type1a'
    ? moved && reversed && (!hasTrajectoryContract || verifiedLoop) : moved;
  return Object.freeze({
    complete,
    moved,
    reversed,
    verifiedLoop,
    invalidVerticalDrift,
    sampleCount: visible.length,
    envelope,
    reason: invalidVerticalDrift ? 'invalid-horizontal-vertical-drift' : complete
      ? (hasTrajectoryContract ? 'verified-native-runtime-cycle' : 'authoritative-runtime-cycle-legacy') : policy?.family === 'type1a'
      ? (moved && reversed ? 'incomplete-unverified-loop' : 'incomplete-no-reversal') : moved ? 'movement-observed' : 'motionless-capture'
  });
}

function classicTrackOffset(record, classicRecord) {
  const rdxSamples = (record?.auditSamples?.length ? record.auditSamples : record?.samples) || [];
  const classicSamples = (classicRecord?.auditSamples?.length ? classicRecord.auditSamples : classicRecord?.samples) || [];
  let rdxSample = null, classicSample = null;
  for (const candidate of rdxSamples) {
    if (candidate.visible === false || !Array.isArray(candidate.origin)) continue;
    const match = classicSamples.find(sample => sample.visible !== false && Array.isArray(sample.draw)
      && Number(sample.phase || 0) === Number(candidate.phase || 0));
    if (match) { rdxSample = candidate; classicSample = match; break; }
  }
  rdxSample ||= rdxSamples.find(sample => sample.visible !== false && Array.isArray(sample.origin)) || record;
  classicSample ||= classicSamples.find(sample => sample.visible !== false && Array.isArray(sample.draw)) || classicRecord;
  if (!Array.isArray(rdxSample?.origin) || !Array.isArray(classicSample?.draw)) return Object.freeze([0, 0]);
  return Object.freeze([
    Number(rdxSample.origin[0]) - (Number(classicSample.draw[0]) + 16),
    Number(rdxSample.origin[1]) - (Number(classicSample.draw[1]) + 20)
  ]);
}

/* Offline whole-room Classic presentation may use the same resolved RDX
 * support-derived patrol envelope as the RDX pane, but the rendered Classic
 * sprite must stay in Classic draw coordinates.  Convert only the effective
 * patrol displacement back through the already-measured Classic↔RDX contact
 * offset; do not project Layer-E sprite registration into the source leg. */
export function effectiveClassicPatrolState(actor, tick) {
  const patrol = actor?.auditPatrol;
  if (!patrol?.mobile || !actor?.classicProduction) return null;
  const movement = reflectedPosition(patrol, tick);
  const offset = actor.classicTrackOffset || [0, 0];
  return Object.freeze({
    sourceKey: String(actor.production?.sourceKey || actor.classicProduction?.sourceKey || ''),
    draw: Object.freeze([
      Number(movement.x) - Number(offset[0] || 0) - 16,
      Number(patrol.originY) - Number(offset[1] || 0) - 20
    ]),
    direction: movement.direction,
    visible: true,
    authority: 'resolved-rdx-support-envelope+classic-source-registration'
  });
}

function productionAuditMotionAt(actor, tick, allActive, tracked = null) {
  /* A production audit trajectory is the strongest source-specific movement
   * evidence available to the browser. Replay it for every source that moves,
   * rather than special-casing individual marks or falling back to a generic
   * entity program that can have different timing/extent. This is also the
   * native/HTML parity contract: one captured source trajectory, one visual. */
  if (!allActive || !actor?.production || !actor?.productionMovement?.audit) return null;
  const current = productionTrajectorySample(actor.production, tick, true) || tracked;
  if (!Array.isArray(current?.origin)) return null;
  const previous = productionTrajectorySample(actor.production, Number(tick) - 1, true);
  const next = productionTrajectorySample(actor.production, Number(tick) + 1, true);
  const cx = Number(current.origin[0]), cy = Number(current.origin[1]);
  let dx = Array.isArray(previous?.origin) ? cx - Number(previous.origin[0]) : 0;
  let dy = Array.isArray(previous?.origin) ? cy - Number(previous.origin[1]) : 0;
  if (!dx && !dy && Array.isArray(next?.origin)) {
    dx = Number(next.origin[0]) - cx;
    dy = Number(next.origin[1]) - cy;
  }
  const directionalBody = actor.role === 'enemy' || actor.role === 'player';
  const direction = directionalBody && dx ? (dx < 0 ? 'left' : 'right') : 'neutral';
  return Object.freeze({
    origin: Object.freeze([cx, cy]), direction,
    mirrorX: directionalBody && dx ? rdxDirectionalMirrorX(direction) : !!current.mirrorX,
    visible: current.visible !== false,
    authority: 'production-c-audit-trajectory'
  });
}

export function classicTraceMotionAt(actor, tick, allActive = false) {
  const record = actor?.classicProduction || null;
  const policy = classifyClassicEnemy(actor?.classicSource?.n);
  if (!allActive || !record || !policy || !actor?.classicTrackMoves) return null;
  const sample = productionTrajectorySample(record, tick, true);
  if (!Array.isArray(sample?.draw)) return null;
  const offset = actor.classicTrackOffset || [0, 0];
  const direction = sample.direction === 'left' || Number(sample.c1 || 0) < 0 ? 'left' : 'right';
  return Object.freeze({
    origin: Object.freeze([
      Number(sample.draw[0]) + 16 + Number(offset[0] || 0),
      Number(sample.draw[1]) + 20 + Number(offset[1] || 0)
    ]),
    direction,
    mirrorX: rdxDirectionalMirrorX(direction),
    visible: sample.visible !== false,
    authority: 'classic-c-gameplay-track+rdx-contact-offset'
  });
}

export class PreviewActorSystem {
  constructor(spriteDecoder, spriteAnims, mapDecoder, productionScene = null, classicScriptedPaths = null, visualPlacementCorrections = null, productionOverrides = null, reviewedMapVisualPatches = null, productionMappings = null) {
    this.spriteDecoder = spriteDecoder;
    this.mapDecoder = mapDecoder;
    this.metadata = buildActorMetadata(spriteAnims);
    this.pnMetadata = buildPnMetadata(spriteAnims);
    this.productionScene = productionScene;
    this.classicScriptedPaths = classicScriptedPaths || { entities: {} };
    this.visualPlacementCorrections = visualPlacementCorrections || { rows: [] };
    this.productionOverrides = productionOverrides || { tables: { markActorOverrides: [] } };
    this.productionMappings = productionMappings || {};
    this.reviewedMapVisualPatches = Array.isArray(reviewedMapVisualPatches?.patches) ? reviewedMapVisualPatches.patches : (Array.isArray(reviewedMapVisualPatches) ? reviewedMapVisualPatches : []);
    this.systemModificationsEnabled = true;
    this.strictTrace = productionScene?.schema === 'rdx.production_presentation_trace.v1';
    this.resolvedProjection = productionScene?.schema === 'rdr.resolved_editor_projection.v1';
    this.actors = [];
    this.nativeRuntimeStates = new Map();
    this.authority = 'legacy-ma-diagnostic';
  }

  #loadProduction(mapId, dimensions, submap, topology = null) {
    const room = productionRoom(this.productionScene, mapId, submap);
    if (!room) return null;
    const solidMask = this.mapDecoder?.solidMask(mapId, {
      x: 0, y: 0, width: dimensions.width, height: dimensions.height
    }, { topology }) || null;
    let index = 0;
    const actors = [];
    const presentationPatches = this.systemModificationsEnabled
      ? productionActorPatchMap(this.productionOverrides, this.reviewedMapVisualPatches, submap, mapId)
      : new Map();
    let keptPlayer = false;
    for (const capturedRecord of room.actors || []) {
      const sourceKey = String(capturedRecord.sourceKey || '');
      const patch = presentationPatches.get(sourceKey);
      const preserveSuppressedEvidence = this.resolvedProjection && capturedRecord.runtimeSuppressed === true;
      const record = preserveSuppressedEvidence
        ? { ...capturedRecord, ...(patch ? { suppressionPatch: patch } : {}), editorEvidenceOnly: true }
        : effectiveProductionRecord(capturedRecord, patch);
      if (!record) continue;
      if (record.role === 'player') {
        if (keptPlayer) continue;
        keptPlayer = true;
      }
      const actorId = Number(record.actorId) || 0;
      const classicRecord = (room.classicActors || []).find(current => String(current.sourceKey || '') === String(record.sourceKey || '')) || null;
      const pn = Number(record.pn);
      const pnMeta = this.pnMetadata.get(pn) || null;
      const semanticRole = classicRoleForEntity(classicRecord?.source?.n, record.role || 'actor');
      const actorSet = this.metadata.get(actorId) || pnMeta?.set || null;
      const roleAdjustedSet = semanticRole === 'collectible' ? cloneSetWithType(actorSet, 'collectible') : actorSet;
      const set = productionRoleSet(semanticRole, pnMeta?.animation || null,
        ROLE_OVERRIDES.has(actorId) ? cloneSetWithType(roleAdjustedSet, ROLE_OVERRIDES.get(actorId)) : roleAdjustedSet);
      const originX = Number(record.origin?.[0] || 0);
      const originY = Number(record.origin?.[1] || 0);
      const sourceMark = Number(String(record.sourceKey || '').startsWith('mark:')
        ? String(record.sourceKey).slice(5) : -1);
      const visualPlacementCorrection = (this.visualPlacementCorrections?.rows || []).find(row =>
        Number(row.submap) === Number(submap) && Number(row.mapId) === Number(mapId) &&
        Number(row.mark) === sourceMark) || null;
      const firstVisibleMotionSample = (record.auditSamples || record.samples || []).find(sample =>
        sample.visible !== false && Array.isArray(sample.origin));
      const productionMotionOrigin = Object.freeze([
        Number(firstVisibleMotionSample?.origin?.[0] ?? originX),
        Number(firstVisibleMotionSample?.origin?.[1] ?? originY)
      ]);
      /* The exact snapshot remains production-C owned.  The all-active whole-room
       * audit uses an RDX MT support envelope because camera-local production
       * captures cannot observe every offscreen enemy patrol. */
      const patrol = Object.freeze({
        mobile: false, minX: originX, maxX: originX, originX, originY,
        speedTicks: 1,
        startDirection: FIXED_ACTOR_FACING.get(actorId) ||
          pnMeta?.animation?.direction || (record.mirrorX ? 'left' : 'right'),
        fixedFacing: FIXED_ACTOR_FACING.get(actorId) || null,
        source: 'production-c-runtime-timeline'
      });
      const classicQuality = classicTrackQuality(classicRecord, classicRecord?.source);
      const classicEnvelope = classicQuality.envelope;
      const classicMoves = classicQuality.complete;
      const behavior = classifyClassicEnemy(classicRecord?.source?.n);
      const needsTerrainPatrol = this.strictTrace && behavior?.family === 'type1a' && !classicMoves;
      const needsResolvedSupportPatrol = this.resolvedProjection && record.positionAdjusted === true &&
        behavior?.family === 'type1a';
      /* RDX MT support can constrain the immutable Type-1A horizontal
       * controller when its Classic range no longer fits the redrawn room.
       * It is not a generic enemy-motion oracle: Type-1B and Type-2 depend on
       * mutable native state (Rick target, ladders, collision reactions).  The
       * old resolved-preview path derived a support patrol for every enemy,
       * which made SM0F mark182 walk a fake horizontal route and flip in
       * place when native Type-2 state was absent. */
      const auditPatrol = ((record.role === 'enemy' || set?.type === 'enemy') &&
        behavior?.family === 'type1a' &&
        (!this.strictTrace || needsTerrainPatrol || needsResolvedSupportPatrol))
        ? deriveAuditPatrol(actorId, productionMotionOrigin[0], productionMotionOrigin[1], dimensions, set, solidMask)
        : patrol;
      actors.push(Object.freeze({
        mapId: Number(mapId),
        index: index++,
        actorId,
        x: originX,
        y: originY,
        set,
        patrol,
        auditPatrol,
        invulnerable: true,
        destructive: false,
        production: Object.freeze({
          ...record,
          origin: Object.freeze([originX, originY]),
          draw: Object.freeze([Number(record.draw?.[0] || 0), Number(record.draw?.[1] || 0)]),
          anchor: Object.freeze([Number(record.anchor?.[0] || 0), Number(record.anchor?.[1] || 0)]),
          size: Object.freeze([Number(record.size?.[0] || 0), Number(record.size?.[1] || 0)])
        }),
        productionAnimation: pnMeta?.animation || null,
        productionMovement: Object.freeze({
          base: productionTrackMoves(record, false),
          audit: productionTrackMoves(record, true),
          hasAudit: Array.isArray(record.auditSamples) && record.auditSamples.length > 0
        }),
        productionMovementEnvelope: productionMovementEnvelope(record, true),
        productionMotionOrigin,
        positionAdjusted: record.positionAdjusted === true,
        visualPlacementCorrection: visualPlacementCorrection ? Object.freeze({ dx:Number(visualPlacementCorrection.dx || 0), dy:Number(visualPlacementCorrection.dy || 0) }) : null,
        classicProduction: classicRecord,
        classicTrackOffset: classicTrackOffset(record, classicRecord),
        classicTrackMoves: classicMoves,
        classicTrackQuality: classicQuality,
        classicMovementEnvelope: classicEnvelope,
        source: record.source || null,
        classicSource: classicRecord?.source || null,
        classicFlags: Number((room.activators || []).find(row => String(row.sourceKey || '') === String(record.sourceKey || ''))?.flags || 0),
        classicEntity: classicRecord?.entity || null,
        front: !!record.front,
        role: semanticRole
      }));
    }
    const snapshotRows = (this.productionMappings.staticPresentationSnapshot || []).filter(row =>
      Number(row.submap) === Number(submap) && Number(row.mapId) === Number(mapId));
    /* Independent MA actors can carry reviewed Layer-F position corrections
     * without a Classic mark-linked semantic object. Native presentation
     * consumes rdxSpawnPlacementOverrides for exactly those actor/spawn pairs;
     * the Level Editor must consume the same table or its final Layer-F view
     * silently falls back to the raw MA coordinates. */
    const rdxSpawnPlacementByIdentity = new Map((this.systemModificationsEnabled
      ? this.productionMappings.rdxSpawnPlacementOverrides || [] : [])
      .filter(row => Number(row.submap) === Number(submap) && Number(row.mapId) === Number(mapId))
      .map(row => [`${Number(row.actorId)}:${Number(row.spawnIndex)}`, row]));
    const emitterActorIds = new Set((this.productionMappings.emitterMuzzles || [])
      .map(row => Number(row.actorId)).filter(Number.isFinite));
    const emitterOwnedSpawns = new Set((room.projectileEmitters || [])
      .filter(row => row?.linked === true && Number.isFinite(Number(row?.spawnIndex)))
      .map(row => `${Number(row.sourceActorId ?? row.actorId)}:${Number(row.spawnIndex)}`));
    const staticActorIds = new Set([
      ...(this.productionMappings.staticPresentationActorIds || []).map(row => Number(row.actorId)).filter(Number.isFinite),
      ...emitterActorIds,
      0x70 // Native RDX_EGYPT_TORCH_ACTOR: source-only MA foreground decoration.
    ]);
    if (snapshotRows.length || staticActorIds.size) {
      const representedOrigins = new Set(actors.map(actor => {
        const x = Math.round(Number(actor.production?.origin?.[0] ?? actor.x));
        const y = Math.round(Number(actor.production?.origin?.[1] ?? actor.y));
        return `${Number(actor.actorId)}:${x}:${y}`;
      }));
      const snapshotBySpawn = new Map(snapshotRows.map(row =>
        [`${Number(row.actorId)}:${Number(row.spawnIndex)}`, row]));
      const legacyActors = this.#loadLegacy(mapId, dimensions, topology);
      for (const legacy of legacyActors) {
        const actorId = Number(legacy.actorId);
        const spawnIdentity = `${actorId}:${Number(legacy.index)}`;
        if (emitterOwnedSpawns.has(spawnIdentity)) continue;
        const snapshot = snapshotBySpawn.get(spawnIdentity) || null;
        if (!snapshot && !staticActorIds.has(actorId)) continue;
        const placement = rdxSpawnPlacementByIdentity.get(spawnIdentity) || null;
        const placementX = Number(placement?.rdxX), placementY = Number(placement?.rdxY);
        const origin = Number.isFinite(placementX) && Number.isFinite(placementY)
          ? [placementX, placementY] : [Number(legacy.x), Number(legacy.y)];
        const originKey = `${actorId}:${Math.round(origin[0])}:${Math.round(origin[1])}`;
        if (representedOrigins.has(originKey)) continue;
        const pn = actorDefaultPn(this.spriteDecoder, actorId);
        if (!Number.isFinite(pn)) continue;
        const pnMeta = this.pnMetadata.get(pn) || null;
        const role = emitterActorIds.has(actorId) ? 'shooter' : 'actor';
        const set = productionRoleSet(role, pnMeta?.animation || null, legacy.set);
        const torch = actorId === 0x70;
        /* Native add_level_decorations() owns the same source-only MA actors.
         * Wall emitters come from the shared emitter catalog; Egypt torches are
         * front decorations and use a spatial six-tick phase offset. Historical
         * empty-bootstrap samples are capture artifacts, not permission for the
         * static editor to omit the authored torch placement entirely. */
        const animationTickOffset = torch
          ? (Math.floor(origin[0] / 16) + Math.floor(origin[1] / 16)) * 6 : 0;
        const snapshotVisible = this.resolvedProjection && torch ? true : snapshot?.visible !== false;
        const production = staticSourceActorRecord(legacy, pn, role, origin, animationTickOffset, snapshotVisible, torch);
        actors.push(Object.freeze({ ...legacy, x: origin[0], y: origin[1], set, role, production,
          productionAnimation: pnMeta?.animation || null,
          productionMovement: Object.freeze({ base: false, audit: false, hasAudit: false }),
          productionMovementEnvelope: Object.freeze({ width: 0, height: 0 }),
          productionMotionOrigin: Object.freeze(origin.slice()),
          classicProduction: null, classicTrackOffset: Object.freeze([0, 0]), classicTrackMoves: false,
          classicTrackQuality: null, classicMovementEnvelope: Object.freeze({ width: 0, height: 0 }),
          source: null, classicSource: null, classicFlags: 0, classicEntity: null, front: torch
        }));
        representedOrigins.add(originKey);
      }
    }
    this.authority = this.productionScene?.schema === 'rdr.resolved_editor_projection.v1'
      ? (this.productionScene?.runtimeEvidence?.compatible ? 'resolved-level+native-runtime-evidence' : 'resolved-level-static')
      : this.productionScene?.schema === 'rdx.production_presentation_trace.v1'
      ? 'production-c-strict-trace-replay'
      : this.productionScene?.schema === 'rdx.production_preview_scene.v3'
      ? 'production-c-runtime-timeline'
      : this.productionScene?.schema === 'rdx.production_preview_scene.v2'
        ? 'production-c-track' : 'production-c-scene';
    return actors;
  }

  #loadLegacy(mapId, dimensions, topology = null) {
    const solidMask = this.strictTrace ? null : (this.mapDecoder?.solidMask(mapId, {
      x: 0, y: 0, width: dimensions.width, height: dimensions.height
    }, { topology }) || null);
    const spawns = this.spriteDecoder?.parseMaSpawns?.(mapId) || [];
    let keptPlayer = false;
    this.authority = 'legacy-ma-diagnostic';
    return spawns.flatMap(spawn => {
      const set = this.metadata.get(spawn.actorId) || null;
      if (set?.type === 'player') {
        if (spawn.actorId !== 0x5d || keptPlayer) return [];
        keptPlayer = true;
      }
      const effectiveSet = ROLE_OVERRIDES.has(spawn.actorId)
        ? cloneSetWithType(set, ROLE_OVERRIDES.get(spawn.actorId)) : set;
      const targetYs = topologyTargetYs(topology, Number(spawn.y));
      const effectiveY = targetYs.length ? Number(targetYs[0]) : Number(spawn.y);
      const patrol = derivePatrol(spawn.actorId, spawn.x, effectiveY, dimensions, effectiveSet, solidMask);
      return [Object.freeze({ ...spawn, y:effectiveY, set: effectiveSet, patrol, invulnerable: true,
        destructive: false, production: null, front: false,
        role: effectiveSet?.type || 'actor' })];
    });
  }

  setSystemModificationsEnabled(enabled) { this.systemModificationsEnabled = enabled !== false; return this.systemModificationsEnabled; }

  setNativeRuntimeStates(states) { this.nativeRuntimeStates = states instanceof Map ? states : new Map(); return this.nativeRuntimeStates; }

  load(mapId, dimensions, submap = null, topology = null) {
    this.actors = this.#loadProduction(mapId, dimensions, submap, topology) ||
      this.#loadLegacy(mapId, dimensions, topology);
    return this.actors;
  }

  stateAt(actor, tick, allActive = false) {
    if (this.resolvedProjection && actor.production) {
      const sourceKey = String(actor.production.sourceKey || '');
      const live = actor.production.runtimeSuppressed === true ? null : (this.nativeRuntimeStates.get(sourceKey) || null);
      if (live) {
        /* Layer E owns the selected simulated visual identity and its anchor.
         * The native audit is intentionally limited to mutable runtime state:
         * position, visibility and frame timing.  Its raw PN may identify the
         * Classic controller sprite (SM05 mark 55 reports PN18) rather than the
         * reviewed RDX replacement (PN66), so it must not replace the resolved
         * asset or discard a scenery assembly while Simulate is running. */
        const simulation = actor.production.simulation || {};
        const directionalBody = actor.role === 'enemy' || actor.role === 'player';
        const inspection = allActive && Number(actor.production?.previewStateCycle?.inspectionStateSeconds) > 0
          ? editorInspectionCycleSample(actor.production.previewStateCycle, tick) : null;
        /* Non-audited motion samples describe controller movement/direction,
         * not a replacement RDX character family.  Use the reviewed snapshot
         * PN as the family anchor and select its directional sibling below.
         * The migrated SM01 Layer-E `simulated` rows contain stale PN4 values
         * for PN7 enemies; trusting that field made those two actors switch
         * families only in the editor.  A presentation-audited native sample
         * may still advance an explicitly reviewed family (the bat case). */
        const scriptedBatPn = allActive && String(live.authority || '').includes('layer-b-scripted-path')
          ? resolvedBatAnimationPn(actor, true) : null;
        const semanticPn = Number.isFinite(Number(inspection?.pn))
          ? Number(inspection.pn)
          : Number.isFinite(scriptedBatPn)
          ? scriptedBatPn
          : directionalBody && !live.presentationAudited
            ? actor.production.pn
            : (simulation.pn ?? actor.production.pn);
        let pn = Number(semanticPn);
        let pnMeta = Number.isFinite(pn) ? this.pnMetadata.get(pn) || null : null;
        const livePn = Number(live.pn);
        const livePnMeta = Number.isFinite(livePn) ? this.pnMetadata.get(livePn) || null : null;
        const editorKindPn = !!live.editorEnemyKindSetId &&
          String(livePnMeta?.set?.setId || '') === String(live.editorEnemyKindSetId);
        if (editorKindPn) { pn = livePn; pnMeta = livePnMeta; }
        /* A presentation-audited native PN may advance within the already
         * reviewed RDX animation family (the SM03 bat switches PN15 -> PN16).
         * It still may not replace that reviewed family with an unrelated raw
         * Classic/controller PN, as happens for some mechanisms. */
        if (!Number.isFinite(scriptedBatPn) && live.presentationAudited && pnMeta?.set?.setId === 'bat' && livePnMeta?.set?.setId === 'bat') {
          pn = livePn;
          pnMeta = livePnMeta;
        }
        let liveDirection = live.direction === 'left' || live.direction === 'right' ? live.direction : null;
        /* Direction may select a reviewed sibling PN inside the same RDX
         * animation family (PN4 right -> PN5 left, for example).  Never adopt
         * the raw native PN: moving-platform audits can report a Classic
         * controller PN that is intentionally different from the Layer-E RDX
         * replacement. */
        if (directionalBody && liveDirection && Number.isFinite(pn)) {
          pn = directionalPnForMotion(pnMeta, liveDirection, pn);
          pnMeta = Number.isFinite(pn) ? this.pnMetadata.get(pn) || pnMeta : pnMeta;
        }
        let origin = Array.isArray(live.origin) ? live.origin : actor.production.origin || [actor.x, actor.y];
        let productionDraw = live.draw || actor.production.draw || null;
        /* productionDrawPoint() may add displayed-origin displacement to a
         * trace draw. Keep track of whether this live draw is already paired
         * with the displayed origin. Native presentation audits are rebased as
         * an origin/draw pair by NativeRuntimeTimeline, and the unaudited
         * Classic-controller branch below constructs the same resolved pair.
         * Treating either resolved draw as if it still belonged to the raw
         * native origin applied the room/controller transform a second time:
         * SM00's ball left its diagnostic path, SM01 enemies floated away from
         * their patrols, and SM05 floor blades appeared in mid-air. */
        let productionDrawMatchesDisplayedOrigin = Array.isArray(live.draw);
        const placement = actor.production.controllerPlacement || null;
        if (!live.presentationAudited && live.supportConstrained !== true && Array.isArray(live.classicDraw) &&
            Array.isArray(placement?.sourceOrigin) && Array.isArray(placement?.alignedOrigin)) {
          const dx = Number(live.classicDraw[0]) - Number(placement.sourceOrigin[0]);
          const dy = Number(live.classicDraw[1]) - Number(placement.sourceOrigin[1]);
          const phaseZero = Array.isArray(placement?.phaseZeroControllerOrigin)
            ? placement.phaseZeroControllerOrigin
            : Array.isArray(placement?.effectiveControllerOrigin)
              ? placement.effectiveControllerOrigin
              : placement.alignedOrigin;
          const controllerX = Number(phaseZero[0]) + dx;
          const controllerY = Number(phaseZero[1]) + dy;
          const originOffset = placement.presentationOriginOffset || [0, 0];
          const drawOffset = placement.presentationDrawOffset || originOffset;
          origin = [controllerX + Number(originOffset[0] || 0), controllerY + Number(originOffset[1] || 0)];
          productionDraw = [controllerX + Number(drawOffset[0] || 0), controllerY + Number(drawOffset[1] || 0)];
          productionDrawMatchesDisplayedOrigin = true;
        }
        /* A Layer-F gameplay-position correction can move a bounded walker
         * relative to the source floor. In that case its raw native/source
         * patrol no longer describes the visible RDX support. Keep the native
         * state for identity/lifecycle, but project whole-room position and
         * facing from the effective RDX support envelope. Ordinary type-1A
         * actors never enter this branch; their explicit Layer-B descriptor is
         * composed before stateAt(). */
        const classicBehavior = classifyClassicEnemy(actor.classicSource?.n);
        if (actor.positionAdjusted && classicBehavior?.family === 'type1a' && actor.auditPatrol?.mobile) {
          const supportMotion = reflectedPosition(actor.auditPatrol, tick);
          const baseOrigin = actor.production.origin || [actor.x, actor.y];
          const baseDraw = actor.production.draw || null;
          origin = [Number(supportMotion.x), Number(actor.auditPatrol.originY ?? baseOrigin[1])];
          if (Array.isArray(baseDraw)) {
            productionDraw = [
              Number(baseDraw[0]) + origin[0] - Number(baseOrigin[0]),
              Number(baseDraw[1]) + origin[1] - Number(baseOrigin[1])
            ];
          }
          productionDrawMatchesDisplayedOrigin = true;
          liveDirection = supportMotion.direction;
        }
        if (directionalBody && liveDirection && Number.isFinite(pn)) {
          pn = directionalPnForMotion(pnMeta, liveDirection, pn);
          pnMeta = Number.isFinite(pn) ? this.pnMetadata.get(pn) || pnMeta : pnMeta;
        }
        const nativeControllerOrigin = (() => {
          if (!placement || !Array.isArray(live.classicDraw) || !Array.isArray(placement.sourceOrigin)) return null;
          const phaseZero = Array.isArray(placement.phaseZeroControllerOrigin)
            ? placement.phaseZeroControllerOrigin
            : Array.isArray(placement.effectiveControllerOrigin)
              ? placement.effectiveControllerOrigin
              : placement.alignedOrigin;
          if (!Array.isArray(phaseZero)) return null;
          return Object.freeze([
            Number(phaseZero[0]) + Number(live.classicDraw[0]) - Number(placement.sourceOrigin[0]),
            Number(phaseZero[1]) + Number(live.classicDraw[1]) - Number(placement.sourceOrigin[1])
          ]);
        })();
        const liveSet = actor.role === 'collectible' ? actor.set : (pnMeta?.set || actor.set);
        const effectiveActor = liveSet === actor.set ? actor : Object.freeze({ ...actor, set: liveSet });
        const runtimeMirrorX = directionalBody && liveDirection
          ? (String(pnMeta?.animation?.direction || '') === liveDirection
              ? !!(simulation.mirrorX ?? actor.production.mirrorX)
              : rdxDirectionalMirrorX(liveDirection))
          : !!(simulation.mirrorX ?? actor.production.mirrorX);
        const semanticDirection = String(pnMeta?.animation?.direction || 'neutral');
        const resolvedDirection = liveDirection ||
          ((semanticDirection === 'left' || semanticDirection === 'right') ? semanticDirection : (runtimeMirrorX ? 'left' : 'right'));
        return Object.freeze({
          actor: effectiveActor, visible: inspection ? inspection.visible !== false : live.visible !== false,
          x: Number(origin[0] ?? actor.x), y: Number(origin[1] ?? actor.y),
          direction: resolvedDirection,
          animation: pnMeta?.animation || null, pn: Number.isFinite(pn) ? pn : null,
          animationTick: Number(live.tick || 0),
          mirrorX: runtimeMirrorX,
          mirrorY: !!(simulation.mirrorY ?? actor.production.mirrorY),
          clipTop: 0, clipBottom: 0, clipLeft: 0, clipRight: 0,
          actorDef: actor.actorId ? this.spriteDecoder.parseActorDef(actor.actorId) : null,
          front: !!(simulation.front ?? actor.production.front), productionDraw,
          productionTraceOrigin: productionDrawMatchesDisplayedOrigin
            ? origin
            : (actor.production.origin || origin),
          productionAnchor: live.anchor || actor.production.anchor || null,
          productionPn: Number.isFinite(pn) ? pn : null, productionTick: Number(live.tick || 0),
          productionFrameHash: Number(actor.production.frameHash || 0),
          assetFlags: Number(actor.production.assetFlags || 0),
          visualKind: Number(actor.production.visualKind || 0),
          repeat: actor.production.repeat || [0, 0], verticalPair: !!actor.production.verticalPair,
          paletteLine: Number(actor.production.paletteLine || 0),
          tileIndices: actor.production.tileIndices || [0, 0],
          productionEmitter: actor.production.emitter || null,
          productionStateCycle: !!actor.production.previewStateCycle,
          presentationOnlyInspection: !!inspection,
          inspectionVisualState: inspection?.visualState || null,
          runtimeSuppressed: false,
          nativeControllerOrigin,
          authority: String(live.authority || 'native-xrick-live-state')
        });
      }
    }
    const activeBatPn = resolvedBatAnimationPn(actor, allActive);
    if (this.resolvedProjection && actor.production && Number.isFinite(activeBatPn)) {
      const simulation = actor.production.simulation || {};
      const pnMeta = this.pnMetadata.get(activeBatPn) || null;
      const batSet = pnMeta?.set || actor.set;
      const effectiveActor = batSet === actor.set ? actor : Object.freeze({ ...actor, set: batSet });
      const origin = simulation.origin || actor.production.origin || [actor.x, actor.y];
      const draw = simulation.draw || actor.production.draw || null;
      const phase = Math.max(0, Math.floor(Number(tick) || 0));
      return Object.freeze({
        actor: effectiveActor, visible: simulation.visible !== false,
        x: Number(origin[0] ?? actor.x), y: Number(origin[1] ?? actor.y), direction: 'neutral',
        animation: pnMeta?.animation || null, pn: activeBatPn, animationTick: phase,
        mirrorX: !!(simulation.mirrorX ?? actor.production.mirrorX),
        mirrorY: !!(simulation.mirrorY ?? actor.production.mirrorY),
        clipTop: 0, clipBottom: 0, clipLeft: 0, clipRight: 0,
        actorDef: actor.actorId && this.spriteDecoder?.parseActorDef ? this.spriteDecoder.parseActorDef(actor.actorId) : null,
        front: !!(simulation.front ?? actor.production.front), productionDraw: draw,
        productionTraceOrigin: origin, productionAnchor: simulation.anchor || actor.production.anchor || null,
        productionPn: activeBatPn, productionTick: phase,
        productionFrameHash: Number(actor.production.frameHash || 0),
        assetFlags: Number(actor.production.assetFlags || 0), visualKind: Number(actor.production.visualKind || 0),
        repeat: actor.production.repeat || [0, 0], verticalPair: !!actor.production.verticalPair,
        paletteLine: Number(actor.production.paletteLine || 0), tileIndices: actor.production.tileIndices || [0, 0],
        productionEmitter: actor.production.emitter || null, productionStateCycle: !!actor.production.previewStateCycle,
        authority: 'resolved-authored-bat-flight-animation'
      });
    }
    const tracked = actor.production ? productionTrackSample(actor.production, tick, allActive) : null;
    const staticSnapshot = !!(actor.production?.staticSource && !allActive && Number(tick || 0) === 0);
    if (this.strictTrace && actor.production) {
      let pn = Number(tracked?.pn ?? actor.production.pn);
      let pnMeta = Number.isFinite(pn) ? this.pnMetadata.get(pn) || null : null;
      /* A type-1a C trajectory is source-specific simulation authority only
       * when native motion-state recurrence proves its cycle. A finite capture
       * without verified closure is only evidence, even when it contains one
       * reversal. In that case preserve the production spawn but deliberately
       * bypass the fragment so the source-anchored MT support solver can animate
       * the full walkable run (MD0010 mark:76 and the same family elsewhere). */
      const behavior = classifyClassicEnemy(actor?.classicSource?.n);
      const needsTerrainPatrol = allActive && behavior?.family === 'type1a' &&
        !actor.classicTrackMoves && actor.auditPatrol?.mobile;
      const productionMotion = needsTerrainPatrol ? null : productionAuditMotionAt(actor, tick, allActive, tracked);
      const scripted = productionMotion ? null : syntheticStrictTraceMotion(actor, tick, allActive, this.classicScriptedPaths);
      const classicMotion = (productionMotion || scripted) ? null : classicTraceMotionAt(actor, tick, allActive);
      /* Spawn and patrol-cycle authority are deliberately separate. The C
       * production origin remains the exact phase-zero placement, but a finite
       * type-1 capture without native state closure cannot claim recurrence. In
       * that incomplete/unverified case, animate a source-anchored MT support
       * envelope instead of inventing a modulo wrap. Verified C cycles, scripted
       * motion, and all non-walker families remain production owned. */
      const incompleteHorizontalPatrol = needsTerrainPatrol;
      const terrainStep = (!productionMotion && !scripted && !classicMotion && incompleteHorizontalPatrol)
        ? reflectedPosition(actor.auditPatrol, tick) : null;
      const terrainMotion = terrainStep ? Object.freeze({
        origin: Object.freeze([terrainStep.x, Number(actor.auditPatrol.originY ?? actor.y)]),
        direction: terrainStep.direction,
        mirrorX: rdxDirectionalMirrorX(terrainStep.direction),
        visible: true,
        authority: 'rdx-mt-support-derived-patrol-fallback'
      }) : null;
      const motion = productionMotion || scripted || classicMotion || terrainMotion;
      if (motion && (actor.role === 'enemy' || actor.role === 'player')) {
        /* Position changes do not imply a new visual family. Rigid blocks,
         * traps, pickups and mechanisms retain their PN while moving; only
         * genuinely directional bodies may select a left/right PN sibling. */
        pn = directionalPnForMotion(pnMeta, motion.direction, pn);
        pnMeta = Number.isFinite(pn) ? this.pnMetadata.get(pn) || pnMeta : pnMeta;
      }
      const tracedSet = actor.role === 'collectible' ? actor.set : (pnMeta?.set || actor.set || productionRoleSet(actor.role, pnMeta?.animation || null, null));
      const effectiveActor = tracedSet === actor.set ? actor : Object.freeze({ ...actor, set: tracedSet });
      const tracedOrigin = motion?.origin || tracked?.origin || actor.production.origin || [actor.x, actor.y];
      /* ResolvedLevel already carries Layer-F placement in effective.origin /
       * effective.visualAnchor.  visualPlacementCorrections is retained here
       * only as provenance for legacy/raw-trace previews and Diagnostics.  The
       * rewired editor used to add it again on top of a resolved projection,
       * shifting every reviewed actor twice (SM00 mark2 and the same pattern
       * across multiple rooms). */
      const applyLegacyPlacementCorrection = this.systemModificationsEnabled && !this.resolvedProjection;
      const visualDx = applyLegacyPlacementCorrection ? Number(actor.visualPlacementCorrection?.dx || 0) : 0;
      const visualDy = applyLegacyPlacementCorrection ? Number(actor.visualPlacementCorrection?.dy || 0) : 0;
      const origin = visualDx || visualDy
        ? [Number(tracedOrigin?.[0] ?? actor.x) + visualDx, Number(tracedOrigin?.[1] ?? actor.y) + visualDy]
        : tracedOrigin;
      const orientation = motion || strictTraceOrientation(pnMeta, tracked, actor.production.mirrorX);
      return Object.freeze({
        actor: effectiveActor,
        visible: tracked?.visible !== false && motion?.visible !== false,
        x: Number(origin?.[0] ?? actor.x),
        y: Number(origin?.[1] ?? actor.y),
        direction: orientation.direction,
        animation: pnMeta?.animation || null,
        pn: Number.isFinite(pn) ? pn : null,
        animationTick: strictTraceAnimationTick(
          effectiveActor.role || effectiveActor.set?.type || actor.role,
          tracked?.tick ?? actor.production.tick ?? 0, tick, allActive
        ),
        mirrorX: !!orientation.mirrorX,
        mirrorY: !!(tracked?.mirrorY ?? actor.production.mirrorY),
        clipTop: Math.max(0, Number(tracked?.clipTop ?? actor.production.clipTop ?? 0)),
        clipBottom: Math.max(0, Number(tracked?.clipBottom ?? actor.production.clipBottom ?? 0)),
        clipLeft: Math.max(0, Number(tracked?.clipLeft ?? actor.production.clipLeft ?? 0)),
        clipRight: Math.max(0, Number(tracked?.clipRight ?? actor.production.clipRight ?? 0)),
        actorDef: actor.actorId ? this.spriteDecoder.parseActorDef(actor.actorId) : null,
        front: !!(tracked?.front ?? actor.front),
        productionDraw: tracked?.draw || actor.production.draw || null,
        productionTraceOrigin: tracked?.origin || actor.production.origin || null,
        productionAnchor: tracked?.anchor || actor.production.anchor || null,
        productionPn: Number.isFinite(pn) ? pn : null,
        productionTick: Number(tracked?.tick ?? actor.production.tick ?? 0),
        productionFrameHash: Number(tracked?.frameHash ?? actor.production.frameHash ?? 0),
        assetFlags: Number(tracked?.assetFlags ?? actor.production.assetFlags ?? 0),
        visualKind: Number(tracked?.visualKind ?? actor.production.visualKind ?? 0),
        repeat: tracked?.repeat || actor.production.repeat || [0, 0],
        verticalPair: !!(tracked?.verticalPair ?? actor.production.verticalPair),
        paletteLine: Number(tracked?.paletteLine ?? actor.production.paletteLine ?? 0),
        tileIndices: tracked?.tileIndices || actor.production.tileIndices || [0, 0],
        productionEmitter: tracked?.emitter || actor.production.emitter || null,
        productionStateCycle: !!actor.production.previewStateCycle,
        presentationOnlyInspection: !!tracked?.presentationOnlyInspection,
        inspectionVisualState: tracked?.visualState || null,
        runtimeSuppressed: actor.production?.runtimeSuppressed === true,
        suppression: actor.production?.suppression || null,
        authority: motion?.authority || 'production-c-strict-trace-replay'
      });
    }
    const hasAuditTimeline = !!(allActive && actor.production &&
      Array.isArray(actor.production.auditSamples) && actor.production.auditSamples.length);

    /* A C/action-owned audit timeline is authoritative for both identity and
     * motion.  The old code enabled a terrain-derived enemy patrol merely from
     * the baseline PN category, even while auditSamples were selecting another
     * PN.  That made MD0006's PN15/16 bat render as the baseline jungle enemy
     * and made triggered mechanisms inherit enemy patrol logic.  MT-derived
     * patrol remains only as a last resort for a production enemy with no audit
     * timeline at all. */
    const useAuditPatrol = !!(allActive && actor.production && !hasAuditTimeline &&
      actor.auditPatrol?.mobile && (actor.role === 'enemy' || actor.set?.type === 'enemy'));
    const activePatrol = useAuditPatrol ? actor.auditPatrol : actor.patrol;
    const visualTrack = useAuditPatrol ? actor.production : tracked;
    const productionPn = Number(visualTrack?.pn ?? actor.production?.pn);
    const trackedPnMeta = Number.isFinite(productionPn) ? this.pnMetadata.get(productionPn) || null : null;
    const trackedSet = trackedPnMeta?.set || actor.set || null;
    const effectiveSet = ROLE_OVERRIDES.has(Number(actor.actorId))
      ? cloneSetWithType(trackedSet, ROLE_OVERRIDES.get(Number(actor.actorId))) : trackedSet;
    const effectiveActor = effectiveSet && effectiveSet !== actor.set
      ? Object.freeze({ ...actor, set: effectiveSet }) : actor;

    const movement = useAuditPatrol ? reflectedPosition(activePatrol, tick) : tracked ? {
      x: Number(tracked.origin?.[0] ?? actor.x),
      direction: tracked.mirrorX ? 'left' : 'right'
    } : reflectedPosition(activePatrol, tick);
    const direction = activePatrol.fixedFacing || movement.direction ||
      activePatrol.startDirection || 'neutral';
    const productionAnimation = trackedPnMeta?.animation || actor.productionAnimation || null;
    const animation = actor.production && Number.isFinite(productionPn) && !useAuditPatrol
      ? productionAnimation
      : (actionForState(effectiveSet, direction) || productionAnimation || null);
    const actorDef = actor.actorId ? this.spriteDecoder.parseActorDef(actor.actorId) : null;
    const actorOwnedPn = !actor.production && FIXED_ACTOR_FACING.has(Number(actor.actorId)) &&
      actorDef?.pnUnique?.length === 1 ? Number(actorDef.pnUnique[0]) : null;
    let pn;
    if (useAuditPatrol && Number.isFinite(Number(animation?.pn))) {
      pn = Number(animation.pn);
    } else if (actor.production && Number.isFinite(productionPn)) {
      /* A production timeline is the actual C selection for this source and
       * sample. Never replace it with a browser-side semantic guess merely
       * because the source is an enemy or mechanism. */
      pn = productionPn;
    } else {
      pn = Number.isFinite(actorOwnedPn) ? actorOwnedPn :
        (Number.isFinite(Number(animation?.pn)) ? Number(animation.pn) :
          (Number.isFinite(productionPn) ? productionPn : actorDef?.pnUnique?.[0]));
    }
    const frozen = actor.role === 'collectible' || effectiveSet?.type === 'collectible';
    const productionDirection = productionAnimation?.direction ||
      ((visualTrack?.mirrorX ?? actor.production?.mirrorX) ? 'left' : 'right');
    const unchangedProductionVisual = actor.production && !useAuditPatrol && pn === productionPn;
    const fixedNeutralBody = !!activePatrol.fixedFacing &&
      (animation?.direction === 'neutral' || actor.role === 'shooter');
    const mirrorX = unchangedProductionVisual ? !!(visualTrack?.mirrorX ?? actor.production.mirrorX) :
      fixedNeutralBody ? !!actor.production?.mirrorX :
      animation?.direction === 'neutral' ? direction === 'left' :
      animation ? rdxDirectionalMirrorX(animation.direction) :
      direction === productionDirection ? !!actor.production?.mirrorX : direction === 'left';
    return Object.freeze({
      actor: effectiveActor,
      visible: useAuditPatrol ? true : actor.production?.staticSource && !staticSnapshot ? true : tracked?.visible !== false,
      x: movement.x + (this.systemModificationsEnabled && !this.resolvedProjection ? Number(actor.visualPlacementCorrection?.dx || 0) : 0),
      y: (useAuditPatrol ? Number(activePatrol.originY ?? actor.y) :
        (tracked ? Number(tracked.origin?.[1] ?? actor.y) : actor.y)) + (this.systemModificationsEnabled && !this.resolvedProjection ? Number(actor.visualPlacementCorrection?.dy || 0) : 0),
      direction,
      animation,
      pn,
      animationTick: actor.production?.staticSource
        ? (staticSnapshot ? Number(actor.production.snapshotAnimationTick || 0) : Number(tick || 0) + Number(actor.production.animationTickOffset || 0))
        : useAuditPatrol ? tick :
        (tracked ? (this.resolvedProjection
          ? strictTraceAnimationTick(effectiveActor.role || effectiveActor.set?.type || actor.role, tracked.tick ?? actor.production?.tick ?? 0, tick, allActive)
          : Number(tracked.tick || 0)) : (frozen ? Number(actor.production?.tick || 0) : tick)),
      mirrorX,
      mirrorY: !!(visualTrack?.mirrorY ?? actor.production?.mirrorY),
      clipTop: Math.max(0, Number(visualTrack?.clipTop ?? actor.production?.clipTop ?? 0)),
      clipBottom: Math.max(0, Number(visualTrack?.clipBottom ?? actor.production?.clipBottom ?? 0)),
      clipLeft: Math.max(0, Number(visualTrack?.clipLeft ?? actor.production?.clipLeft ?? 0)),
      clipRight: Math.max(0, Number(visualTrack?.clipRight ?? actor.production?.clipRight ?? 0)),
      actorDef,
      front: !!(visualTrack?.front ?? actor.front),
      productionDraw: visualTrack?.draw || actor.production?.draw || null,
      /* An MT-support audit moves the effective actor away from the resolved
       * phase-zero origin without replacing its Layer-E/F draw registration.
       * Give the renderer that phase-zero origin so productionDrawPoint()
       * applies the same displacement to the sprite.  Without this, the
       * contact moved while the draw point stayed frozen (the SM01 enemy
       * visibly walked out of its own patrol body). */
      productionTraceOrigin: useAuditPatrol ? (actor.production?.origin || [actor.x,actor.y]) :
        (visualTrack?.origin || actor.production?.origin || null),
      productionAnchor: visualTrack?.anchor || actor.production?.anchor || null,
      productionPn: Number.isFinite(productionPn) ? productionPn : null,
      productionTick: Number(visualTrack?.tick ?? actor.production?.tick ?? 0),
      productionFrameHash: Number(visualTrack?.frameHash ?? actor.production?.frameHash ?? 0),
      assetFlags: Number(visualTrack?.assetFlags ?? actor.production?.assetFlags ?? 0),
      visualKind: Number(visualTrack?.visualKind ?? actor.production?.visualKind ?? 0),
      repeat: visualTrack?.repeat || actor.production?.repeat || [0, 0],
      verticalPair: !!(visualTrack?.verticalPair ?? actor.production?.verticalPair),
      paletteLine: Number(visualTrack?.paletteLine ?? actor.production?.paletteLine ?? 0),
      tileIndices: visualTrack?.tileIndices || actor.production?.tileIndices || [0, 0],
      productionEmitter: visualTrack?.emitter || actor.production?.emitter || null,
      productionStateCycle: !!actor.production?.previewStateCycle,
      presentationOnlyInspection: !!tracked?.presentationOnlyInspection,
      inspectionVisualState: tracked?.visualState || null,
      runtimeSuppressed: actor.production?.runtimeSuppressed === true,
      suppression: actor.production?.suppression || null,
      authority: useAuditPatrol ? 'production-c-identity+rdx-mt-support-audit' : actor.production ?
        (this.productionScene?.schema === 'rdx.production_preview_scene.v3'
          ? 'production-c-runtime-timeline'
          : (Array.isArray(actor.production.samples) ? 'production-c-track' : 'production-c-scene'))
        : 'legacy-ma-diagnostic'
    });
  }

  statesAt(tick, allActive = false) { return this.actors.map(actor => this.stateAt(actor, tick, allActive)); }
}
