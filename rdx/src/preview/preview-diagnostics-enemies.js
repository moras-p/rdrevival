import { buildEnemyBehaviorDiagnostic, classifyClassicEnemy, traceEnvelope } from './enemy-behavior.js';
import { classicBoundedPatrolEnvelope } from '../editor/whole-room-simulation.js';
import { classicProjectileCollisionCenter, classicType1aContactSweep } from './preview-collision-geometry.js';
import { firstVisibleSample } from './preview-production-state.js';
import { reviewedRdxTraps, classicTerrainHazardRects } from './preview-static-renderer.js';

export function triggerKindLabel(flags) {
  const kinds = [];
  if (Number(flags) & 0x10) kinds.push('dynamite');
  if (Number(flags) & 0x20) kinds.push('bullet');
  if (Number(flags) & 0x40) kinds.push('Rick stop');
  if (Number(flags) & 0x80) kinds.push('Rick contact');
  return kinds.join(' + ');
}

export function activationVisualSignature(sample) {
  if (!sample) return '';
  return JSON.stringify({
    visible: sample.visible !== false,
    pn: sample.pn ?? null,
    sprite: sample.sprite ?? null,
    origin: sample.origin ?? null,
    draw: sample.draw ?? null,
    frameHash: sample.frameHash ?? null,
    front: !!sample.front
  });
}

export function activationEffectStatus(productionRoom, sourceKey) {
  if (!productionRoom || !sourceKey) return Object.freeze({ observed: false, reason: 'no production C activation capture' });
  if ((productionRoom.projectileEmitters || []).some(row => String(row.sourceKey || '') === String(sourceKey))) {
    return Object.freeze({ observed: true, reason: 'reviewed Layer-E projectile-emitter relationship' });
  }
  const children = (productionRoom.children || []).filter(row => String(row.sourceKey || '') === String(sourceKey));
  if (children.some(row => (row.auditSamples || row.samples || []).some(sample => sample.visible !== false))) {
    return Object.freeze({ observed: true, reason: 'source-owned projectile/effect child' });
  }
  const records = ['actors', 'fallbacks', 'classicActors']
    .flatMap(collection => productionRoom[collection] || [])
    .filter(row => String(row.sourceKey || '') === String(sourceKey));
  for (const record of records) {
    const sequence = record?.source?.spriteSequence;
    const activeSprite = Array.isArray(sequence?.active)
      ? sequence.active.map(value => Number(value || 0)).find(value => value > 0) : 0;
    const sourceEntity = Number(record?.source?.entity ?? record?.source?.n ?? -1) & 0x7f;
    const sourceTriggerFlags = Number(record?.source?.flags || 0) & 0xf0;
    if (record?.runtimeSuppressed !== true && sourceEntity >= 0x18 && sourceTriggerFlags) {
      return Object.freeze({ observed: true, reason: 'xrick type-3 source-owned trigger lifecycle' });
    }
    if (record?.actionStateOwner === true || Number(record?.previewStateCycle?.inspectionStateSeconds) > 0 ||
        (Number(sequence?.dormant) === 0 && activeSprite > 0)) {
      return Object.freeze({ observed: true, reason: 'resolved source-owned activation lifecycle' });
    }
    const passive = new Set((record.samples || []).map(activationVisualSignature));
    const active = (record.auditSamples || []).map(activationVisualSignature);
    if (active.some(signature => !passive.has(signature))) {
      return Object.freeze({ observed: true, reason: 'C activation changes visible state, frame or position' });
    }
  }
  return Object.freeze({ observed: false, reason: records.length ? 'activation was captured but produced no presentation change' : 'no source-owned activation record' });
}

export function scriptedPolyline(catalog, entity, origin) {
  const path = catalog?.entities?.[String(Number(entity || 0) & 0x7f)];
  if (!path?.polyline?.length) return null;
  return Object.freeze(path.polyline.map(point => Object.freeze([
    Number(origin[0] || 0) + Number(point[0] || 0),
    Number(origin[1] || 0) + Number(point[1] || 0)
  ])));
}

export function enemyBehaviorDiagnostics(tick, selectables = []) {
  const room = this._productionRoom();
  if (!room) return Object.freeze([]);
  const bySource = new Map((selectables || []).filter(item => item?.sourceKey).map(item => [String(item.sourceKey), item]));
  const heroItem = (selectables || []).find(item => item.category === 'hero' || item.kind === 'player');
  const hero = heroItem ? [Number(heroItem.x), Number(heroItem.y)] : null;
  const output = [];
  for (const classic of room.classicActors || []) {
    const sourceKey = String(classic.sourceKey || '');
    const source = classic.source || {};
    const policy = classifyClassicEnemy(source.n);
    if (!policy) continue;
    const rdx = (room.actors || []).find(record => String(record.sourceKey || '') === sourceKey) || null;
    const loadedActor = (this.actorSystem.actors || []).find(actor => String(actor.production?.sourceKey || '') === sourceKey) || null;
    const offset = loadedActor?.classicTrackOffset || [0, 0];
    const samples = (classic.auditSamples && classic.auditSamples.length ? classic.auditSamples : classic.samples) || [];
    let points = samples.filter(sample => sample.visible !== false && Array.isArray(sample.draw)).map(sample => {
      if (this.selection.visualSource === 'classic') return [Number(sample.draw[0]) + 16, Number(sample.draw[1]) + 20];
      return [Number(sample.draw[0]) + 16 + Number(offset[0] || 0),
        Number(sample.draw[1]) + 20 + Number(offset[1] || 0)];
    });
    const type1aPatrol = policy.family === 'type1a' && String(source.controller?.kind || '') === 'bounded-horizontal-patrol'
      ? source.controller?.patrol || null : null;
    const type1aConfiguredDisplayPath = type1aPatrol ? (() => {
      const floorOffsetY = Math.max(0, Number(source.h || 21));
      const start = Array.isArray(type1aPatrol.start) ? type1aPatrol.start.map(Number) : [Number(source.x || 0), Number(source.y || 0)];
      const sourceEnvelope = classicBoundedPatrolEnvelope(rdx, this._classicRoom(this.selection.submap));
      const sourcePoints = sourceEnvelope
        ? [[Number(sourceEnvelope.minX), Number(sourceEnvelope.y)], [Number(sourceEnvelope.maxX), Number(sourceEnvelope.y)]]
        : (() => {
            const initialDirection = String(type1aPatrol.initialDirection || 'right') === 'left' ? 'left' : 'right';
            const distance = Math.max(0, Number(type1aPatrol.distancePx || 0));
            const end = Array.isArray(type1aPatrol.end) ? type1aPatrol.end.map(Number)
              : [start[0] + (initialDirection === 'left' ? -distance : distance), start[1]];
            return [start, end];
          })();
      if (this.selection.visualSource === 'classic') return sourcePoints.map(point => [point[0], point[1] + floorOffsetY]);
      const placement = rdx?.controllerPlacement || null;
      if (!Array.isArray(placement?.sourceOrigin) || !Array.isArray(placement?.alignedOrigin)) return null;
      /* This is gameplay/controller geometry, not sprite presentation.
       * Layer-E/F visual residuals shifted the SM03 mark-25 patrol 16 px to
       * the right into the wall. Project only Layer B through Layer C, then
       * draw the solid route on the enemy's Classic foot row. */
      const project = point => [
        Number(placement.alignedOrigin[0]) + Number(point[0]) - Number(placement.sourceOrigin[0]),
        Number(placement.alignedOrigin[1]) + Number(point[1]) - Number(placement.sourceOrigin[1]) + floorOffsetY
      ];
      return sourcePoints.map(project);
    })() : null;
    /* A normalized type-1A patrol is the authoritative whole-room interval.
     * Do not replace it with a short nearby support scan merely because the
     * editor can derive one. The support-derived interval is only stronger
     * after Layer F moved the actor relative to its source floor (SM08
     * mark94), where the original controller interval no longer matches the
     * effective RDX geometry. This is the same authority split used by the
     * Simulate actor projection. */
    if (policy.family === 'type1a' && this.selection.visualSource !== 'classic' &&
        loadedActor?.positionAdjusted && !loadedActor.classicTrackMoves && loadedActor.auditPatrol?.mobile) {
      const y = Number(loadedActor.auditPatrol.originY || loadedActor.y);
      points = [[Number(loadedActor.auditPatrol.minX), y], [Number(loadedActor.auditPatrol.maxX), y]];
    } else if (policy.family === 'type1a' && type1aConfiguredDisplayPath) {
      points = type1aConfiguredDisplayPath;
    }
    const observedPathPoints = Object.freeze(points.map(point => Object.freeze([...point])));
    const controllerAnchor = this.selection.visualSource === 'classic' ? null : rdx?.controllerPlacement?.alignedOrigin;
    const initialPoint = (Array.isArray(controllerAnchor) ? [Number(controllerAnchor[0]),Number(controllerAnchor[1])] : null) || points[0] || (this.selection.visualSource === 'classic'
      ? [Number(classic.draw?.[0] || source.x || 0), Number(classic.draw?.[1] || source.y || 0) + Math.max(0, Number(source.h || 21))]
      : [Number(rdx?.origin?.[0] || 0), Number(rdx?.origin?.[1] || 0)]);
    if(this.selection.visualSource!=='classic'&&policy.family==='type1a'&&Array.isArray(controllerAnchor)&&points.length<2)points=[initialPoint];
    const scripted = policy.family === 'type3'
      ? scriptedPolyline(this.classicScriptedPaths, source.n, initialPoint) : null;
    if (scripted) points = [...scripted];
    const item = bySource.get(sourceKey);
    const type1aPathAuthority = policy.family === 'type1a'
      ? (loadedActor?.positionAdjusted && this.selection.visualSource !== 'classic'
          ? 'layer-f-effective-support' : 'layer-b-classic-static-envtest-projected')
      : null;
    const configuredStart = policy.family === 'type1a'
      ? (type1aConfiguredDisplayPath?.[0] || (this.selection.visualSource === 'classic'
          ? (Array.isArray(source.controller?.patrol?.start) ? source.controller.patrol.start : null)
          : (Array.isArray(controllerAnchor) ? controllerAnchor : null)))
      : null;
    const diagnostic = buildEnemyBehaviorDiagnostic({
      sourceKey, source,
      current: item ? [Number(item.x), Number(item.y)] : initialPoint,
      points, configuredStart, pathAuthority:type1aPathAuthority,
      contactSweep:policy.family==='type1a'?classicType1aContactSweep(this.classicData,source,points):null,
      hero, width: this.selection.dimensions.width, height: this.selection.dimensions.height
    });
    if (diagnostic) {
      const enriched = policy.family === 'type3'
        ? Object.freeze({ ...diagnostic, debugId: `enemy:${sourceKey}`, observedPathPoints,
            scriptVsRuntime: scripted ? 'authored-script-plus-observed-runtime' : 'observed-runtime-only' })
        : policy.family === 'type1b'
          ? Object.freeze({ ...diagnostic, debugId:`enemy:${sourceKey}`, typeMarker:true, geometrySemantic:'type marker' })
          : Object.freeze({ ...diagnostic, debugId: `enemy:${sourceKey}`, pathAuthority:type1aPathAuthority, geometrySemantic:diagnostic.geometrySemantic || 'guard sweep' });
      output.push(item?.bounds ? Object.freeze({ ...enriched, bounds: item.collisionBounds || item.bounds }) : enriched);
    }
  }
  for (const classic of room.classicActors || []) {
    const source = classic.source || {};
    const entity = Number(source.n || 0) & 0x7f;
    const sourceKey = String(classic.sourceKey || '');
    if (entity < 0x18 || classifyClassicEnemy(entity) || classic.role === 'shooter') continue;
    const path = this.classicScriptedPaths?.entities?.[String(entity)] || null;
    const width = Number(path?.envelope?.maxX || 0) - Number(path?.envelope?.minX || 0);
    const height = Number(path?.envelope?.maxY || 0) - Number(path?.envelope?.minY || 0);
    if (!path?.polyline?.length || (width < 1 && height < 1)) continue;
    const item = bySource.get(sourceKey);
    let initial;
    if (this.selection.visualSource === 'classic') {
      const draw = firstVisibleSample(classic, 'draw')?.draw || classic.draw || [0, 0];
      initial = [Number(draw[0]) + 16, Number(draw[1]) + 20];
    } else {
      const actor = (room.actors || []).find(row => String(row.sourceKey || '') === sourceKey) || null;
      const controllerAnchor=actor?.controllerPlacement?.alignedOrigin;
      initial = Array.isArray(controllerAnchor) ? [Number(controllerAnchor[0]),Number(controllerAnchor[1])]
        : actor?.origin ? [Number(actor.origin[0]), Number(actor.origin[1])] : [Number(item?.x || 0), Number(item?.y || 0)];
    }
    let pathPoints = scriptedPolyline(this.classicScriptedPaths, entity, initial) || [];
    let pathAuthority = 'classic-ent-mvstep';
    let pathNotes = ['Path comes from the classic entity ent_mvstep program; RDX PA/PN supplies only visual state.'];
    /* In RDX view, any captured production trajectory outranks the generic
     * entity program. This keeps the debug path, Simulate sprite and native
     * C presentation on one source-specific trajectory for every moving
     * block/hazard, not only previously reviewed one-off marks. */
    if (this.selection.visualSource !== 'classic') {
      const actor = (room.actors || []).find(row => String(row.sourceKey || '') === sourceKey) || null;
      const samples = (actor?.auditSamples?.length ? actor.auditSamples : actor?.samples) || [];
      const traced = samples.filter(sample => sample.visible !== false && Array.isArray(sample.origin))
        .map(sample => [Number(sample.origin[0]), Number(sample.origin[1])]);
      const deduped = traced.filter((point, index) => index === 0 || point[0] !== traced[index - 1][0] || point[1] !== traced[index - 1][1]);
      if (deduped.length >= 2) {
        pathPoints = Object.freeze(deduped.map(point => Object.freeze(point)));
        pathAuthority = 'production-c-audit-track';
        pathNotes = ['Source-specific production trajectory shared with RDX Simulate/native presentation.'];
      }
    }
    const envelope = traceEnvelope(pathPoints, initial);
    const role = String((room.actors || []).find(row => String(row.sourceKey || '') === sourceKey)?.role || classic.role || 'actor');
    const movingPlatform = !!item?.movingPlatform || ['platform','moving-platform'].includes(String(item?.category || '')) || String(item?.role || '') === 'moving-platform';
    const category = movingPlatform ? 'moving-platform' : (role === 'trap' ? 'hazard' : role);
    output.push(Object.freeze({
      debugId: `scripted:${sourceKey}`, sourceKey,
      current: Object.freeze(item ? [Number(item.x), Number(item.y)] : initial),
      category, subjectCategory:category, overlayType: movingPlatform ? 'moving-platform-path' : 'scripted-action', bounds: movingPlatform ? null : (item?.bounds || null),
      envelope, geometrySemantic:movingPlatform ? 'trajectory' : 'path',
      policy: Object.freeze({ family: movingPlatform ? 'platform' : 'action', label: movingPlatform ? 'moving-platform trajectory' : (role === 'trap' ? 'falling hazard path' : 'scripted action path') }),
      pathPoints, trigger: pathAuthority === 'classic-ent-mvstep' ? 'classic-type3' : 'production-trace',
      authority: pathAuthority, notes: Object.freeze(pathNotes)
    }));
  }

  /* Stationary 0x19/0x1A sources remain shooter mechanisms even when a
   * captured room starts with c1 already active and production labels the
   * current slot as a projectile (SM12 mark:216). Diagnostics describe the
   * mechanism identity, not only the actor's transient role. */
  const classicShooters = (room.classicActors || []).filter(row => {
    const entity = Number(row?.source?.n);
    return row.role === 'shooter' || entity === 0x19 || entity === 0x1a;
  });
  for (const classic of classicShooters) {
    const sourceKey = String(classic.sourceKey || '');
    const child = (room.children || []).find(row => row.role === 'projectile' && String(row.sourceKey || '') === sourceKey) || null;
    const resolvedEmitter = (room.projectileEmitters || []).find(row => String(row.sourceKey || '') === sourceKey) || null;
    const childSamples = (child?.auditSamples?.length ? child.auditSamples : child?.samples) || [];
    let pathPoints = childSamples.filter(sample => sample.visible !== false && Array.isArray(sample.origin)).map(sample => [Number(sample.origin[0]), Number(sample.origin[1])]);
    if (this.selection.visualSource === 'classic' && pathPoints.length) {
      const levelOffset = this.selection.level?.pixelOffset || { dxPx: 0, dyPx: 0 };
      const firstChild = firstVisibleSample(child, 'origin');
      const firstClassic = firstVisibleSample(classic, 'draw') || classic;
      if (firstChild?.origin && firstClassic?.draw) {
        const convertedFirst = [Number(firstChild.origin[0]) - Number(levelOffset.dxPx || 0), Number(firstChild.origin[1]) - Number(levelOffset.dyPx || 0)];
        const nativeCenter=classicProjectileCollisionCenter(this.classicData,classic,firstClassic.draw);
        const contactOffset = [nativeCenter[0] - convertedFirst[0], nativeCenter[1] - convertedFirst[1]];
        pathPoints = pathPoints.map(point => [point[0] - Number(levelOffset.dxPx || 0) + contactOffset[0], point[1] - Number(levelOffset.dyPx || 0) + contactOffset[1]]);
      }
    }
    /* RDX/effective diagnostics describe the authored lane, not a sampled
     * transient projectile trajectory. Its first point is always the
     * reviewed muzzle; xrick remains authoritative for per-tick motion. */
    if (this.selection.visualSource !== 'classic' && Array.isArray(resolvedEmitter?.mouth)) {
      const mouth = resolvedEmitter.mouth.map(Number), direction = String(resolvedEmitter.direction || 'right');
      pathPoints = [mouth, [direction === 'left' ? 0 : Math.max(0, Number(this.selection.dimensions.width) - 1), mouth[1]]];
    }
    if (!pathPoints.length) {
      if (this.selection.visualSource !== 'classic' && Array.isArray(resolvedEmitter?.mouth)) {
        const mouth = resolvedEmitter.mouth.map(Number), direction = String(resolvedEmitter.direction || 'right');
        pathPoints = [mouth, [direction === 'left' ? 0 : Math.max(0, Number(this.selection.dimensions.width) - 1), mouth[1]]];
      } else {
        const draw = firstVisibleSample(classic, 'draw')?.draw || classic.draw || [Number(classic.source?.x || 0), Number(classic.source?.y || 0)];
        const start = classicProjectileCollisionCenter(this.classicData,classic,draw);
        const direction = Number(classic.source?.n) === 0x1a ? 'left' : 'right';
        pathPoints = [start, [direction === 'left' ? 0 : Math.max(0, Number(this.selection.dimensions.width) - 1), start[1]]];
      }
    }
    const topologyOverride = this.selection.visualSource !== 'classic' ? this.manualOverride(`rdx:${sourceKey}`) : null;
    if (Array.isArray(topologyOverride?.projectileEmitterOrigin) && topologyOverride.projectileEmitterOrigin.length >= 2) {
      const origin=topologyOverride.projectileEmitterOrigin.map(Number),offset=Array.isArray(resolvedEmitter?.muzzleOffset)?resolvedEmitter.muzzleOffset.map(Number):[0,0],mouth=[origin[0]+offset[0],origin[1]+offset[1]],direction=String(topologyOverride.projectileLaneDirection||resolvedEmitter?.direction||'right');
      pathPoints=[mouth,[direction==='left'?0:Math.max(0,Number(this.selection.dimensions.width)-1),mouth[1]]];
    } else if (topologyOverride?.projectileLaneDirection && Array.isArray(resolvedEmitter?.mouth)) {
      const mouth=resolvedEmitter.mouth.map(Number),direction=String(topologyOverride.projectileLaneDirection);
      pathPoints=[mouth,[direction==='left'?0:Math.max(0,Number(this.selection.dimensions.width)-1),mouth[1]]];
    }
    const pathEnvelope = traceEnvelope(pathPoints, pathPoints[0]);
    /* Rick's crawling contact is inclusive y+8..y+20: 13 px tall. Expand
     * the projectile-lane inspection band downward by that height so the
     * editor immediately shows whether a floor/crawl lane intersects the
     * shot. The center polyline remains the projectile collider route. */
    const crawlHeight = 13;
    const envelope = Object.freeze({ ...pathEnvelope, maxY:pathEnvelope.maxY+crawlHeight,
      height:Math.max(1,pathEnvelope.maxY+crawlHeight-pathEnvelope.minY) });
    const currentItem = (selectables || []).find(item => String(item?.sourceKey || '') === sourceKey && (String(item?.category || '') === 'projectile-shooter' || String(item?.role || '') === 'shooter')) || bySource.get(sourceKey);
    const overrideEmitterOrigin=Array.isArray(topologyOverride?.projectileEmitterOrigin)?topologyOverride.projectileEmitterOrigin.map(Number):null;
    const resolvedMuzzleOffset=Array.isArray(child?.emitterMuzzleOffset||resolvedEmitter?.muzzleOffset)?(child?.emitterMuzzleOffset||resolvedEmitter.muzzleOffset).map(Number):[0,0];
    const emitterMouth = overrideEmitterOrigin ? [overrideEmitterOrigin[0]+resolvedMuzzleOffset[0],overrideEmitterOrigin[1]+resolvedMuzzleOffset[1]] : (child?.emitterContact || resolvedEmitter?.mouth || null);
    const reviewedEmitter = this.selection.visualSource !== 'classic' && Array.isArray(emitterMouth)
      ? [Number(emitterMouth[0]), Number(emitterMouth[1])] : null;
    const emitterPoint = reviewedEmitter || pathPoints[0];
    const emitter = Object.freeze({
      linked: child?.emitterAligned === true || resolvedEmitter?.linked === true,
      actorId: child?.emitterActorId == null ? (resolvedEmitter?.actorId == null ? null : Number(resolvedEmitter.actorId)) : Number(child.emitterActorId),
      spawnIndex: child?.emitterSpawnIndex == null ? (resolvedEmitter?.spawnIndex == null ? null : Number(resolvedEmitter.spawnIndex)) : Number(child.emitterSpawnIndex),
      bodyActorId: currentItem?.actorId == null ? (resolvedEmitter?.actorId == null ? null : Number(resolvedEmitter.actorId)) : Number(currentItem.actorId),
      bodyPn: currentItem?.pn == null ? (resolvedEmitter?.bodyPn == null ? null : Number(resolvedEmitter.bodyPn)) : Number(currentItem.pn),
      bodyOrigin: currentItem ? Object.freeze([Number(currentItem.x),Number(currentItem.y)]) : (Array.isArray(resolvedEmitter?.bodyOrigin) ? Object.freeze(resolvedEmitter.bodyOrigin.map(Number)) : null),
      bodyLayer: currentItem?.front ? 'front' : 'normal',
      parentKey: child?.parentKey || null,
      origin: Array.isArray(overrideEmitterOrigin || child?.emitterOrigin || resolvedEmitter?.origin) ? Object.freeze((overrideEmitterOrigin || child?.emitterOrigin || resolvedEmitter.origin).map(Number)) : null,
      mouth: Array.isArray(emitterMouth) ? Object.freeze(emitterMouth.map(Number)) : null,
      mouthOffset: Object.freeze(resolvedMuzzleOffset),
      direction: topologyOverride?.projectileLaneDirection || child?.emitterDirection || child?.direction || resolvedEmitter?.direction || null,
      cadence: Object.freeze({
        activationMode: child?.emitterCadence?.activationMode || child?.activationMode || resolvedEmitter?.cadence?.activationMode || null,
        speedPxPerUpdate: Number(child?.emitterCadence?.speedPxPerUpdate || child?.trajectorySpeedPx || resolvedEmitter?.cadence?.speedPxPerUpdate || resolvedEmitter?.lane?.speedPxPerUpdate || 0),
        capturedTrackPeriod: Number(child?.emitterCadence?.capturedTrackPeriod || child?.trackPeriod || child?.auditPeriod || 0),
        authority: child?.emitterCadence?.authority || resolvedEmitter?.cadence?.authority || child?.authority || resolvedEmitter?.cadenceAuthority || null
      }),
      corrections: Object.freeze(Array.isArray(child?.emitterCorrections) ? [...child.emitterCorrections] : (Array.isArray(resolvedEmitter?.corrections) ? [...resolvedEmitter.corrections] : [])),
      nativeDisplacementPreserved: child?.nativeDisplacementPreserved === true || resolvedEmitter?.nativeDisplacementPreserved === true
    });
    if (currentItem?.bounds) output.push(Object.freeze({
      debugId:`shooter-body:${sourceKey}`, sourceKey, traceCollection:currentItem.traceCollection || 'classicActors',
      current:Object.freeze([Number(currentItem.x),Number(currentItem.y)]), category:'projectile-shooter',
      subjectCategory:'projectile-shooter', overlayType:'projectile-shooter-body', bounds:currentItem.bounds,
      geometrySemantic:'presentation', policy:Object.freeze({family:'shooter-body',label:'shooter presentation/body'}),
      pathPoints:Object.freeze([]), emitter,
      notes:Object.freeze(['Visible shooter presentation/body. Its authored origin and sprite identity are independent from the projectile emitter.'])
    }));
    output.push(Object.freeze({
      debugId:`emitter:${sourceKey}`, sourceKey, traceCollection:'projectileEmitters', current:Object.freeze(emitterPoint),
      category:'projectile-emitter', subjectCategory:'projectile-emitter', overlayType:'projectile-emitter',
      connectionPoint:Object.freeze(emitterPoint), hitPoint:Object.freeze(emitterPoint), hitPointRadius:6, geometrySemantic:'emitter',
      policy:Object.freeze({family:'projectile-emitter',label:'projectile emitter/muzzle'}), pathPoints:Object.freeze([]), emitter,
      notes:Object.freeze(emitter.linked ? ['Explicit projectile-emitter identity; no collision rectangle is drawn for this point.'] : ['Unlinked source-owned projectile emitter.'])
    }));
    output.push(Object.freeze({
      debugId:`projectile-lane:${sourceKey}`, sourceKey, traceCollection:'projectileEmitters', current:Object.freeze(emitterPoint),
      category:'projectile-lane', subjectCategory:'projectile', overlayType:'projectile-lane',
      envelope, pathPoints:Object.freeze(pathPoints.map(point=>Object.freeze(point))), hitPathTolerance:6,
      geometrySemantic:'crawl-clearance', policy:Object.freeze({family:'projectile-lane',label:'projectile lane / crawl-clearance'}),
      trigger:classic.source?.n===0x19||classic.source?.n===0x1a?'projectile':null, emitter,
      notes:Object.freeze(['Solid center line is the projectile collider route; the inspection band extends one crawling-Rick contact height downward.'])
    }));
  }

  for (const item of (selectables || [])) {
    if (!item?.sourceKey) continue;
    const movingPlatform=!!item.movingPlatform||['moving-platform','platform'].includes(String(item.category||''))||String(item.role||'')==='moving-platform';
    if(!movingPlatform)continue;
    const bounds=item.collisionBounds||item.opaqueBounds||item.bounds;if(!bounds)continue;
    output.push(Object.freeze({
      debugId:`platform-body:${String(item.sourceKey)}`,sourceKey:String(item.sourceKey),traceCollection:item.traceCollection||null,
      current:Object.freeze([Number(item.x||0),Number(item.y||0)]),category:'platform',subjectCategory:'platform',overlayType:'moving-platform',
      bounds,geometrySemantic:'collision',policy:Object.freeze({family:'platform',label:'moving-platform collision'}),pathPoints:Object.freeze([]),
      authority:item.authority||'native-gameplay-collision-size',notes:Object.freeze(['Rectangle is the moving platform contact/collision body. Its trajectory is a separate native path diagnostic.'])
    }));
  }

  for (const item of (selectables || [])) {
    if (!item?.sourceKey) continue;
    /* Stationary shooter mechanisms already emit one canonical `shooter`
     * diagnostic above.  That row owns the reviewed emitter body, muzzle,
     * projectile-collider center line, and crawl-clearance band.  Emitting
     * the source's Classic lethal flag again as a generic collision-hazard
     * produces a second offset rectangle for the same mechanism and can
     * make activator wiring appear to target the wrong box (SM06 mark:68).
     * Keep collision-hazard rows for the transient projectile itself; only
     * the persistent projectile-shooter body is represented once. */
    if (String(item.category || '') === 'projectile-shooter' || item.movingPlatform || ['platform','moving-platform'].includes(String(item.category || '')) || String(item.role || '') === 'moving-platform') continue;
    const lethality = this._lethalityForSelectable(item);
    const collectible = item.category === 'collectible';
    if (!lethality.lethal && !collectible) continue;
    const lethal = lethality.lethal;
    const overlayFamily = lethal ? 'hazard' : 'collectible';
    const bounds = lethal ? this._hazardBoundsForSelectable(item, lethality) : (item.collisionBounds || item.opaqueBounds || item.bounds);
    if (!bounds) continue;
    /* Keep the collision box selectable while sharing the source's actual
     * simulated motion path. Previously `bounds:hazard:mark:98` was a static
     * one-frame rectangle even though the same PN66 source had a moving
     * scripted diagnostic, so selecting the RDX hazard hid the path that was
     * visible on the Classic side. */
    const sourceMotion = lethal ? output.find(row => String(row?.sourceKey || '') === String(item.sourceKey || '') &&
      Array.isArray(row?.pathPoints) && row.pathPoints.length > 1 && row.overlayType === 'scripted-action') : null;
    const pathPoints = sourceMotion?.pathPoints || Object.freeze([]);
    const motionEnvelope = sourceMotion?.envelope || Object.freeze({ minX: bounds.x, minY: bounds.y, maxX: bounds.x + bounds.width, maxY: bounds.y + bounds.height, width: bounds.width, height: bounds.height, sampleCount: 1 });
    output.push(Object.freeze({
      debugId: `bounds:${lethal ? 'hazard' : 'collectible'}:${String(item.sourceKey || '')}${item.instanceKey ? `:${item.instanceKey}` : ''}`,
      sourceKey: String(item.sourceKey || ''),
      instanceKey: item.instanceKey || null,
      traceCollection: item.traceCollection || null,
      current: Object.freeze([Number(item.x || 0), Number(item.y || 0)]),
      category: overlayFamily,
      subjectCategory: item.category,
      overlayType: lethal ? 'collision-hazard' : 'bounds',
      bounds,
      envelope: motionEnvelope,
      geometrySemantic: lethal ? 'collision' : 'pickup',
      policy: Object.freeze({ family: overlayFamily, label: lethal ? (item.category === 'projectile' ? 'projectile collision' : `${item.category} collision`) : 'collectible pickup' }),
      pathPoints,
      authority: lethal ? (item.category === 'projectile' && Array.isArray(item.emitterContact)
        ? 'reviewed-projectile-emitter-link+classic-c-5x3-core'
        : (lethality.classicFlags ? 'classic-entity-lethality+gameplay-collision-size' : 'native-gameplay-collision-size')) : item.authority,
      classicLethalFlags: lethality.classicFlags,
      notes: Object.freeze(lethal ? ['Exact gameplay collision box; outer selection/patrol envelopes are not lethal.'] : [])
    }));
  }
  for (const binding of this._roomActionBindings()) {
    const sourceKey = String(binding.sourceKey || '');
    const item = bySource.get(sourceKey);
    /* A live unconditional killer already emitted collision-hazard above,
     * so its component registry must not add a second frame. Landing-only
     * rubble is the exception: its binding owns the one tight hazard frame
     * while the live visual owns the one selectable identity. State-aware
     * hazardPotential removes that frame after the blockage has exploded. */
    const bindingLethality = item ? this._lethalityForSelectable(item) : null;
    const showComponentHazard = Array.isArray(binding.hazardBounds) && binding.hazardBounds.length === 4 &&
      (!item || (!bindingLethality?.lethal && this._hazardPotentialForSelectable(item, bindingLethality)));
    if (showComponentHazard) {
      const [x, y, width, height] = binding.hazardBounds.map(Number);
      const bounds = Object.freeze({ x, y, width, height });
      output.push(Object.freeze({
        debugId: `component-hazard:${sourceKey}`, sourceKey,
        current: Object.freeze([x + width / 2, y + height / 2]),
        category: 'hazard', overlayType: 'component-hazard', bounds,
        envelope: Object.freeze({ minX:x, minY:y, maxX:x+width, maxY:y+height, width, height, sampleCount:1 }),
        policy: Object.freeze({ family:'hazard', label:String(binding.hazardLabel || 'hazard') }),
        pathPoints: Object.freeze([]), authority: binding.authority || 'generated-component-registry',
        notes: Object.freeze([`First-class component: ${binding.componentKind || 'dynamic-hazard'}`])
      }));
    }
    const action = binding.action || binding.classicAction || null;
    if (!action || ['state-swap-on-trigger', 'hide-on-trigger', 'visibility-toggle-loop'].includes(String(action.kind || ''))) continue;
    const actionVector = Array.isArray(action.vector) ? action.vector : null;
    const hasSpatialPath = actionVector ? actionVector.some(value => Number(value) !== 0) :
      Array.isArray(action.points) && action.points.some(point => Array.isArray(point) && point.some(value => Number(value) !== 0));
    if (!hasSpatialPath) continue;
    let origin;
    if (item) origin = [Number(item.x), Number(item.y)];
    else if (this.selection.visualSource === 'classic') {
      const classic = (room.classicActors || []).find(record => String(record.sourceKey || '') === sourceKey);
      const classicPos = this._classicCoordinates(Number(classic?.draw?.[0] || 0), Number(classic?.draw?.[1] || 0), false);
      origin = [classicPos.x + 16, classicPos.y + 20];
    } else origin = [Number(binding.origin?.[0] || 0), Number(binding.origin?.[1] || 0)];
    const vector = Array.isArray(action.vector) ? [Number(action.vector[0] || 0), Number(action.vector[1] || 0)] : [0, 0];
    const target = [origin[0] + vector[0], origin[1] + vector[1]];
    const minX = Math.min(origin[0], target[0]), minY = Math.min(origin[1], target[1]);
    const maxX = Math.max(origin[0], target[0]), maxY = Math.max(origin[1], target[1]);
    const movingPlatform = !!item?.movingPlatform || ['platform','moving-platform'].includes(String(item?.category || '')) || String(item?.role || '') === 'moving-platform';
    output.push(Object.freeze({
      debugId: `action:${sourceKey}`,
      sourceKey,
      current: Object.freeze(origin),
      category: binding.role || (movingPlatform ? 'moving-platform' : 'trap'),
      overlayType: 'action',
      bounds: movingPlatform ? null : (item?.bounds || null),
      envelope: Object.freeze({ minX, minY, maxX, maxY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY), sampleCount: 2 }),
      geometrySemantic:movingPlatform ? 'trajectory' : 'path',
      policy: Object.freeze({ family: movingPlatform ? 'platform' : 'action', label: movingPlatform ? 'moving-platform trajectory' : (action.kind === 'state-swap-on-trigger' ? 'bomb-triggered state' : 'scripted trap path') }),
      pathPoints: Object.freeze([Object.freeze(origin), Object.freeze(target)]),
      trigger: ['hide-on-trigger','state-swap-on-trigger','linear-one-shot-loop'].includes(action.kind) ? 'dynamite' : null,
      notes: Object.freeze([])
    }));
  }
  /* Activators are gameplay regions, not sprite geometry.  Keep them faint
   * and separately selectable in both Classic and aligned RDX coordinates. */
  const triggerSemanticByMark = new Map((this.productionOverrides?.tables?.triggerSemantics || [])
    .filter(row => Number(row.submap) === Number(this.selection.submap) && Number(row.mapId) === Number(this.selection.mapId))
    .map(row => [Number(row.mark), row]));
  const classicRoom = this.selection.visualSource === 'classic'
    ? this._classicPreviewRoom(this.selection.submap)
    : (this.classicData?.rooms?.find(row => Number(row.submap) === Number(this.selection.submap)) || null);
  const resolvedTriggerBySource = new Map();
  if (this.selection.visualSource !== 'classic') {
    for (const entry of [...(room?.actors || []), ...(room?.fallbacks || []), ...(room?.classicActors || [])]) {
      const sourceKey = String(entry?.sourceKey || '');
      if (!sourceKey || resolvedTriggerBySource.has(sourceKey) || !Array.isArray(entry?.triggerBounds) || entry.triggerBounds.length < 4) continue;
      resolvedTriggerBySource.set(sourceKey, Object.freeze({
        bounds: Object.freeze(entry.triggerBounds.slice(0,4).map(Number)),
        authority: String(entry?.triggerAuthority || 'resolved-level-trigger')
      }));
    }
  }
  for (const entity of classicRoom?.entities || []) {
    const sourceFlags = Number(entity.flags || 0);
    const semanticForFlags = triggerSemanticByMark?.get?.(Number(entity.mark)) || null;
    const flags = semanticForFlags ? ((sourceFlags & ~Number(semanticForFlags.clearFlags || 0)) | Number(semanticForFlags.setFlags || 0)) : sourceFlags;
    const entityNo = Number(entity.entity ?? entity.n ?? 0) & 0x7f;
    const semanticTrigger = entityNo === 0x16 || entityNo === 0x17;
    const bounds = entity.triggerBounds;
    if (!(flags & 0xf0) && !semanticTrigger) continue;
    if (!Array.isArray(bounds) || Number(bounds[2]) <= 0 || Number(bounds[3]) <= 0) continue;
    const sourceKey = `mark:${Number(entity.mark)}`;
    const productionActivator = this.selection.visualSource !== 'classic'
      ? (room?.activators || []).find(row => String(row.sourceKey || '') === sourceKey)
      : null;
    /* classic_level_preview triggerBounds are already expressed in the
     * canonical whole-room coordinate system.  _classicCoordinates() is
     * for camera/local actor draws and adds startRow*8; using it here
     * double-shifted uncaptured activators vertically.
     *
     * More importantly, Classic xrick is the gameplay authority for these
     * trigger rectangles.  Native/RDX debug geometry is useful QA evidence
     * but must not replace the source trigger in Runtime Preview.  Placement
     * view retains that native rectangle as the gray current box and the
     * topology-projected Classic rectangle as the preferred fitted box. */
    const levelOffset = this.selection.visualSource !== 'classic'
      ? (this.selection.level?.pixelOffset || { dxPx: 0, dyPx: 0 })
      : { dxPx: 0, dyPx: 0 };
    const triggerSemantic = triggerSemanticByMark.get(Number(entity.mark)) || null;
    const rawBox = { x: Number(bounds[0]) + Number(levelOffset.dxPx || 0) + Number(triggerSemantic?.dx || 0),
      y: Number(bounds[1]) + Number(levelOffset.dyPx || 0) + Number(triggerSemantic?.dy || 0), width: Number(bounds[2]), height: Number(bounds[3]) };
    const resolvedTrigger = resolvedTriggerBySource.get(sourceKey) || null;
    const resolvedBox = resolvedTrigger ? {
      x:Number(resolvedTrigger.bounds[0]), y:Number(resolvedTrigger.bounds[1]),
      width:Number(resolvedTrigger.bounds[2]), height:Number(resolvedTrigger.bounds[3])
    } : null;
    const nativeBounds = productionActivator && Array.isArray(productionActivator.bounds) && productionActivator.bounds.length >= 4
      ? productionActivator.bounds.map(Number) : null;
    const nativeBox = nativeBounds ? { x:nativeBounds[0], y:nativeBounds[1],
      width:Math.max(1,nativeBounds[2]-nativeBounds[0]+1), height:Math.max(1,nativeBounds[3]-nativeBounds[1]+1) } : null;
    const nativeDrift = nativeBox ? [nativeBox.x-rawBox.x,nativeBox.y-rawBox.y] : [0,0];
    const alignment = resolvedBox
      ? { box: resolvedBox, adjusted: resolvedBox.x !== rawBox.x || resolvedBox.y !== rawBox.y ||
          resolvedBox.width !== rawBox.width || resolvedBox.height !== rawBox.height,
          delta: [resolvedBox.x - rawBox.x, resolvedBox.y - rawBox.y],
          authority: resolvedTrigger.authority, labelSuffix: ' (RDX-aligned)', nativeBox, nativeDrift }
      : { box: rawBox, adjusted: false, delta: [0, 0],
          authority: 'classic-trigger+room-topology-offset', labelSuffix: ' (C geometry)', nativeBox, nativeDrift };
    const box = Object.freeze(alignment.box);
    const trigger = semanticTrigger ? (entityNo === 0x16 ? 'speed-bonus start' : 'speed-bonus finish') : triggerKindLabel(flags);
    const effect = semanticTrigger
      ? Object.freeze({ observed: true, reason: entityNo === 0x16 ? 'classic speed-bonus start gameplay trigger' : 'classic speed-bonus finish gameplay trigger' })
      : activationEffectStatus(room, sourceKey);
    const notes = [];
    if (alignment.authority) notes.push(`bounds: ${alignment.authority}`);
    if (alignment.nativeBox && (alignment.nativeDrift[0] || alignment.nativeDrift[1]))
      notes.push(`Placement QA: native/debug current differs by ${alignment.nativeDrift[0]},${alignment.nativeDrift[1]}; see Placement view`);
    if (!effect.observed) notes.push(`NO OBSERVED EFFECT: ${effect.reason}; mapping/action needs review`);
    const labelSuffix = !effect.observed ? ' · NO OBSERVED EFFECT' : (alignment.labelSuffix || '');
    output.push(Object.freeze({
      debugId: `activator:${sourceKey}`, sourceKey, traceCollection: 'activators',
      current: Object.freeze([box.x + box.width / 2, box.y + box.height / 2]),
      category: 'activator', overlayType: 'activator', bounds: box,
      sourceBounds: Object.freeze(rawBox),
      envelope: Object.freeze({ minX: box.x, minY: box.y, maxX: box.x + box.width,
        maxY: box.y + box.height, width: box.width, height: box.height, sampleCount: 1 }),
      policy: Object.freeze({ family: 'activator', label: `activator: ${trigger}${labelSuffix}` }),
      pathPoints: Object.freeze([]), trigger, adjusted: !!alignment.adjusted,
      delta: Object.freeze(alignment.delta || [0, 0]), noEffect: !effect.observed,
      effectAuthority: effect.reason, notes: Object.freeze(notes)
    }));
  }
  const classicActivatorKeys = new Set((classicRoom?.entities || [])
    .filter(entity => (Number(entity.flags || 0) & 0xf0) || [0x16,0x17].includes(Number(entity.entity ?? entity.n ?? 0) & 0x7f))
    .map(entity => `mark:${Number(entity.mark)}`));
  if (this.selection.visualSource !== 'classic') for (const productionActivator of room?.activators || []) {
    const sourceKey = String(productionActivator.sourceKey || `mark:${Number(productionActivator.sourceId)}`);
    if (classicActivatorKeys.has(sourceKey) || !Array.isArray(productionActivator.bounds)) continue;
    const [x0, y0, x1, y1] = productionActivator.bounds.map(Number);
    const box = Object.freeze({ x:x0, y:y0, width:Math.max(1,x1-x0+1), height:Math.max(1,y1-y0+1) });
    const trigger = triggerKindLabel(Number(productionActivator.flags || 0));
    const effect = activationEffectStatus(room, sourceKey);
    output.push(Object.freeze({
      debugId:`activator:${sourceKey}`, sourceKey, traceCollection:'activators', current:Object.freeze([box.x+box.width/2,box.y+box.height/2]),
      category:'activator', overlayType:'activator', bounds:box,
      envelope:Object.freeze({minX:box.x,minY:box.y,maxX:box.x+box.width,maxY:box.y+box.height,width:box.width,height:box.height,sampleCount:1}),
      policy:Object.freeze({family:'activator',label:`activator: ${trigger}${effect.observed ? ' (C geometry)' : ' · NO OBSERVED EFFECT'}`}),
      pathPoints:Object.freeze([]), trigger, adjusted:true, delta:Object.freeze([0,0]),
      noEffect:!effect.observed, effectAuthority:effect.reason,
      notes:Object.freeze([`bounds: ${productionActivator.authority || 'production-c-debug-geometry'}`,
        ...(effect.observed ? [] : [`NO OBSERVED EFFECT: ${effect.reason}; mapping/action needs review`])])
    }));
  }
  for (const item of selectables || []) {
    if (!item?.patchedPlacement || !item.bounds) continue;
    output.push(Object.freeze({
      debugId: `patch:${item.port || 'rdx'}:${item.sourceKey || item.id}`,
      sourceKey: String(item.sourceKey || item.id || ''),
      current: Object.freeze([Number(item.x || 0), Number(item.y || 0)]),
      category: 'patch', overlayType: 'patched-placement', bounds: item.bounds,
      envelope: Object.freeze({ minX: item.bounds.x, minY: item.bounds.y,
        maxX: item.bounds.x + item.bounds.width, maxY: item.bounds.y + item.bounds.height,
        width: item.bounds.width, height: item.bounds.height, sampleCount: 1 }),
      policy: Object.freeze({ family: 'patch', label: 'reviewed placement patch' }),
      pathPoints: Object.freeze([]), patchedPlacement: true, notes: Object.freeze([])
    }));
  }
  if (this.systemModificationsEnabled) {
    output.push(...this._reviewedMapVisualPatchDiagnostics());
    output.push(...this._terrainHazardDiagnostics(tick, selectables));
  }
  return Object.freeze(output);
}

export function _reviewedMapVisualPatchDiagnostics() {
  if (!this.selection || this.selection.visualSource === 'classic') return [];
  return this.reviewedMapVisualPatches.filter(row =>
    Number(row.submap) === Number(this.selection.submap) && Number(row.mapId) === Number(this.selection.mapId) &&
    Array.isArray(row.bounds) && row.bounds.length >= 4
  ).map(row => {
    const b = row.bounds.map(Number);
    const bounds = Object.freeze({ x:b[0], y:b[1], width:Math.max(1,b[2]), height:Math.max(1,b[3]) });
    return Object.freeze({
      /* Preserve the old terrain-hazard suffix so v2.1.29/v2.1.30 review
       * files still select this exact location after the semantic-hazard
       * misclassification was removed.  It is now explicitly a visual
       * suppression patch, not a lethal entity. */
      debugId:`terrain-hazard:${row.id}`,
      sourceKey:String(row.sourceKey || `map-visual:${row.id}`),
      traceCollection:'reviewedMapVisualPatches',
      current:Object.freeze([bounds.x + bounds.width / 2, bounds.y + bounds.height / 2]),
      category:'patch', overlayType:'patched-map-visual', bounds,
      envelope:Object.freeze({minX:bounds.x,minY:bounds.y,maxX:bounds.x+bounds.width,maxY:bounds.y+bounds.height,width:bounds.width,height:bounds.height,sampleCount:1}),
      policy:Object.freeze({family:'patch',label:`reviewed ${row.layer || 'map'} visual ${row.action || 'patch'}`}),
      pathPoints:Object.freeze([]), patchedPlacement:true,
      authority:String(row.authority || 'reviewed-map-visual-patch'),
      introducedInVersion:String(row.introducedInVersion || 'unknown'),
      notes:Object.freeze([String(row.reason || ''), `introduced in v${row.introducedInVersion || 'unknown'}`].filter(Boolean))
    });
  });
}

export function _terrainHazardDiagnostics(tick = 0, selectables = []) {
  if (!this.selection) return [];
  const registry = this.trapRegistry || {};
  const makeRow = (id, bounds, authority, notes = [], extra = {}) => Object.freeze({
    debugId: `terrain-hazard:${id}`,
    sourceKey: `terrain-hazard:${id}`,
    current: Object.freeze([bounds.x + bounds.width / 2, bounds.y + bounds.height / 2]),
    category: 'hazard', overlayType: 'terrain-hazard', bounds: Object.freeze(bounds),
    envelope: Object.freeze({ minX: bounds.x, minY: bounds.y,
      maxX: bounds.x + bounds.width, maxY: bounds.y + bounds.height,
      width: bounds.width, height: bounds.height, sampleCount: 1 }),
    policy: Object.freeze({ family: 'hazard', label: 'hazard' }),
    pathPoints: Object.freeze([]), authority,
    notes: Object.freeze(notes),
    ...extra
  });

  if (this.selection.visualSource !== 'classic') {
    return reviewedRdxTraps(registry, this.selection.submap, this.selection.mapId).map(trap => {
      const sourceItem = (selectables || []).find(item =>
        String(item?.sourceKey || '') === String(trap.sourceKey || '') && item.port === 'rdx') || null;
      /* A rendered source already emits one exact collision-hazard from its
       * collision/opaque footprint above. Descriptor contact is the fallback
       * for trap-owned map art only; drawing it as a second independent row
       * creates the large persistent box that obscures the real sprite box. */
      if (sourceItem) return null;
      /* Preview has no independent trap state. A stateful descriptor is
       * active only while its production source projection is present. */
      if (trap.state === 'inactive') return null;
      if (trap.state === 'active' && trap.sourceMark && !sourceItem) return null;
      const contact = Array.isArray(trap.contact?.bounds) ? trap.contact.bounds.map(Number) : [0,0,0,0];
      const bounds = { x:contact[0], y:contact[1], width:contact[2], height:contact[3] };
      return makeRow(trap.id, bounds, trap.authority || 'trap-descriptor', [
        `Trap state: ${trap.state}`,
        `Asset family: ${trap.family || 'unclassified'}`,
        trap.sourceMark ? `Lifecycle source: mark ${trap.sourceMark}` : 'Lifecycle: static.',
        'Contact is a projection of this trap descriptor, not independent terrain lethality.'
      ], {
        rdxSourceKey: trap.sourceKey || null,
        parentSourceKey: trap.classicParentSourceKey || null,
        assetFamily: trap.family || null,
        counterpartClassification: `trap-${trap.state}`
      });
    }).filter(Boolean);
  }

  const room = this._classicPreviewRoom(this.selection.submap);
  if (!room) return [];
  return classicTerrainHazardRects(room, registry).map((group, index) =>
    makeRow(`classic-sm${String(this.selection.submap).padStart(2, '0')}-${index}`, { ...group.bounds },
      'classic-MAP_EFLG_LETHAL-reviewed', [`Classic lethal tile(s): ${group.tiles.join(', ')}`]));
}

export function _roomActionBindings() {
  if (!this.selection) return [];
  return this.actionVisualBindings.filter(row => Number(row.submap) === Number(this.selection.submap)
    && Number(row.mapId) === Number(this.selection.mapId));
}
