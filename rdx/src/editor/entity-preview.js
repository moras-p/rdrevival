import { ENTITY_FLAGS } from './level-document.js';

function sourceKeyForState(state) {
  return state?.actor?.sourceKey || state?.sourceKey || state?.actor?.production?.sourceKey || null;
}

/**
 * Replay only the authoritative production motion for a converted source
 * entity. The editor-authored entity owns presentation/gameplay properties;
 * source provenance is used solely as a Preview trace so Simulate does not
 * invent a second JavaScript platform/enemy movement model.
 */
export function editorEntitySourceMotion(entity, states = []) {
  const mark = Number(entity?.sourceMark);
  if (!Number.isInteger(mark) || mark < 0) return Object.freeze({ found:false, visible:true, dx:0, dy:0 });
  const wanted = `mark:${mark}`;
  const state = (states || []).find(row => String(sourceKeyForState(row) || '') === wanted);
  if (!state) return Object.freeze({ found:false, visible:true, dx:0, dy:0 });
  const production = state.actor?.production || null;
  const auditSamples = Array.isArray(production?.auditSamples) ? production.auditSamples : [];
  const phaseZero = auditSamples.find(sample => Number(sample?.phase || 0) === 0 && Array.isArray(sample?.origin)) ||
    auditSamples.find(sample => Array.isArray(sample?.origin)) || null;
  /* Converted entities own their corrected authored placement. Replay only the
   * production trajectory displacement from its own phase-zero sample. Using
   * the static production origin here is wrong for activated platform captures
   * whose audit trace starts from a different absolute placement, and makes
   * Simulate jump back to the pre-correction path. */
  const origin = phaseZero?.origin || production?.origin;
  if (!Array.isArray(origin) || origin.length < 2) return Object.freeze({ found:true, visible:state.visible !== false, dx:0, dy:0 });
  const correction = state.actor?.visualPlacementCorrection || {};
  const baseX = Number(origin[0]) + Number(correction.dx || 0);
  const baseY = Number(origin[1]) + Number(correction.dy || 0);
  const sprite = Number(state.sprite ?? state.nativeEntity?.sprite);
  const c1 = Number(state.nativeEntity?.c1);
  const classicX = Number(state.nativeEntity?.x);
  const classicY = Number(state.nativeEntity?.y);
  return Object.freeze({
    found:true,
    visible:state.visible !== false,
    dx:Number(state.x) - baseX,
    dy:Number(state.y) - baseY,
    ...(Number.isFinite(sprite) ? { sprite } : {}),
    ...(Number.isFinite(c1) ? { c1 } : {}),
    ...(Number.isFinite(classicX) ? { classicX } : {}),
    ...(Number.isFinite(classicY) ? { classicY } : {})
  });
}

/**
 * Native synthetic editor entities use the xrick entity contact origin. Most
 * entities use the historic +21 body anchor; STOPRICK platforms use their
 * native collision height so a replacement PN remains attached to the same
 * support surface instead of dropping five pixels.
 */
export function editorEntityPresentationOrigin(entity, nativeHeight = 21, motion = null) {
  const dx = Number(motion?.dx || 0), dy = Number(motion?.dy || 0);
  const stopRick = (Number(entity?.flags || 0) & ENTITY_FLAGS.stopRick) !== 0;
  const yOffset = stopRick ? Math.max(1, Number(nativeHeight) || 1) : 21;
  return Object.freeze({ x:Number(entity?.x || 0) + dx + 16, y:Number(entity?.y || 0) + dy + yOffset });
}

export function editorEntityDrawPosition(frame, entity, nativeHeight = 21, motion = null, placementAnchor = null) {
  const origin = editorEntityPresentationOrigin(entity, nativeHeight, motion);
  const anchorX = placementAnchor?.x ?? frame?.footAnchorX ?? frame?.originX ?? 0;
  const anchorY = placementAnchor?.y ?? frame?.footAnchorY ?? frame?.originY ?? 0;
  return Object.freeze({
    x:Math.round(origin.x - Number(anchorX)),
    y:Math.round(origin.y - Number(anchorY)),
    origin
  });
}

function rectArray(x, y, width, height) {
  return [Math.round(Number(x)), Math.round(Number(y)), Math.round(Number(width)), Math.round(Number(height))];
}

/**
 * Compact, deterministic description of the exact placement the Level Editor
 * rendered for an authored entity. This is intentionally presentation context,
 * not another gameplay model: contact/patrol/trigger remain the authored native
 * values, while the draw/opaque rectangles explain how the selected PN was
 * anchored to that contact point.
 */
export function editorEntityPlacementSnapshot(entity, rendered = null, nativeHeight = 21) {
  const presentation = {
    pn:Number(entity?.pn ?? -1),
    frameIndex:Number(rendered?.frame?.frameIndex ?? (Number(entity?.frameIndex) >= 0 ? Number(entity.frameIndex) : 0)),
    nativeHeight:Math.max(1,Number(nativeHeight) || 1),
    origin:null,
    anchor:null,
    drawBounds:null,
    frameSize:null,
    opaqueBounds:null
  };
  if (rendered?.frame?.pixels && rendered?.origin) {
    const pixels=rendered.frame.pixels;
    const drawX=Number(rendered.drawX),drawY=Number(rendered.drawY);
    presentation.pn=Number(rendered.pn ?? entity?.pn ?? -1);
    presentation.origin=[Math.round(Number(rendered.origin.x)),Math.round(Number(rendered.origin.y))];
    presentation.anchor=[Number(rendered.origin.x)-drawX,Number(rendered.origin.y)-drawY];
    presentation.frameSize=[Number(pixels.width),Number(pixels.height)];
    presentation.drawBounds=rectArray(drawX,drawY,pixels.width,pixels.height);
    const opaque=typeof pixels.opaqueBounds==='function' ? pixels.opaqueBounds() : null;
    if (opaque) presentation.opaqueBounds=rectArray(
      drawX+Number(opaque.minX),drawY+Number(opaque.minY),
      Number(opaque.maxX)-Number(opaque.minX)+1,Number(opaque.maxY)-Number(opaque.minY)+1);
  }
  return {
    contact:[Number(entity?.x || 0),Number(entity?.y || 0)],
    patrol:[Number(entity?.patrolX ?? entity?.x ?? 0),Number(entity?.patrolY ?? entity?.y ?? 0)],
    trigger:[Number(entity?.triggerX ?? entity?.x ?? 0),Number(entity?.triggerY ?? entity?.y ?? 0)],
    presentation
  };
}

/** Build the compact production snapshot used as the edit baseline. */
export function productionEntityBaselineContext(source, productionRoom = null, pixelOffset = null, options = {}) {
  if (!source) return null;
  const placement=productionConvertedSourcePlacement(source,productionRoom,pixelOffset,options);
  if (!placement) return null;
  const mark=Number(source.mark);
  const actor=(productionRoom?.actors || []).find(row => String(row?.sourceKey || '') === `mark:${mark}`) || null;
  const presentation=actor ? {
    pn:Number(actor.pn),
    origin:Array.isArray(actor.origin)?actor.origin.slice(0,2).map(Number):placement.presentationOrigin,
    anchor:Array.isArray(actor.anchor)?actor.anchor.slice(0,2).map(Number):null,
    drawBounds:Array.isArray(actor.draw)&&Array.isArray(actor.size)?rectArray(actor.draw[0],actor.draw[1],actor.size[0],actor.size[1]):null
  } : { pn:placement.pn, origin:placement.presentationOrigin, anchor:null, drawBounds:null };
  return {
    contact:[Number(placement.x),Number(placement.y)],
    trigger:[Number(placement.triggerX),Number(placement.triggerY)],
    presentation,
    authority:{position:String(placement.placementAuthority),trigger:String(placement.triggerAuthority)}
  };
}

/**
 * Resolve the editable baseline for a production source entity. STOPRICK
 * platforms have an exact native contact-to-presentation contract: the RDX
 * presentation origin is contact + [16, native height]. Prefer current compact
 * reviewed authority when present; the production capture is only the fallback
 * observational baseline. Explicit trigger semantics likewise win over captured
 * native debug geometry.
 */
export function productionConvertedSourcePlacement(source, productionRoom = null, pixelOffset = null, { gameplayDelta = null, triggerSemantic = null, actorOverride = null } = {}) {
  if (!source) return null;
  const mark=Number(source.mark), flags=Number(source.flags || 0);
  const stopRick=(flags & ENTITY_FLAGS.stopRick) !== 0;
  const actor=(productionRoom?.actors || []).find(row => String(row?.sourceKey || '') === `mark:${mark}`) || null;
  const activator=(productionRoom?.activators || []).find(row => Number(row?.sourceId) === mark || String(row?.sourceKey || '') === `mark:${mark}`) || null;
  const offsetX=Number(pixelOffset?.dxPx || 0), offsetY=Number(pixelOffset?.dyPx || 0);
  const deltaX=Number(gameplayDelta?.dx || 0), deltaY=Number(gameplayDelta?.dy || 0);
  let x=Number(source.x || 0) + offsetX + deltaX;
  let y=Number(source.y || 0) + offsetY + deltaY;
  let placementAuthority='classic-room-offset';
  const reviewedOrigin = actorOverride && Number.isFinite(Number(actorOverride.rdxX)) && Number.isFinite(Number(actorOverride.rdxY))
    ? [Number(actorOverride.rdxX),Number(actorOverride.rdxY)] : null;
  if (stopRick && reviewedOrigin) {
    const nativeHeight=Math.max(1,Number(source.h || 1));
    x=reviewedOrigin[0] - 16;
    y=reviewedOrigin[1] - nativeHeight;
    placementAuthority='canonical-mark-override';
  } else if (stopRick && Array.isArray(actor?.origin) && actor.origin.length >= 2) {
    const nativeHeight=Math.max(1,Number(source.h || 1));
    x=Number(actor.origin[0]) - 16;
    y=Number(actor.origin[1]) - nativeHeight;
    placementAuthority='production-c-presentation-origin';
  }
  const tr=Array.isArray(source.triggerBounds) ? source.triggerBounds : [source.x,source.y,0,0];
  let triggerX=Number(tr[0] || 0) + offsetX + Number(triggerSemantic?.dx || 0);
  let triggerY=Number(tr[1] || 0) + offsetY + Number(triggerSemantic?.dy || 0);
  let triggerAuthority=triggerSemantic ? 'canonical-trigger-semantic' : 'classic-trigger-offset';
  if (!triggerSemantic && Array.isArray(activator?.bounds) && activator.bounds.length >= 2) {
    triggerX=Number(activator.bounds[0]);
    triggerY=Number(activator.bounds[1]);
    triggerAuthority=String(activator.authority || 'production-c-debug-geometry');
  }
  const effectiveOrigin=reviewedOrigin || (Array.isArray(actor?.origin) ? actor.origin.slice(0,2).map(Number) : null);
  return Object.freeze({
    x,y,triggerX,triggerY,
    pn:Number.isFinite(Number(actorOverride?.pn)) ? Number(actorOverride.pn) : (Number.isFinite(Number(actor?.pn)) ? Number(actor.pn) : null),
    front:actorOverride?.front == null ? (actor?.front == null ? null : !!actor.front) : !!actorOverride.front,
    presentationOrigin:effectiveOrigin ? Object.freeze(effectiveOrigin) : null,
    placementAuthority,triggerAuthority
  });
}

/** Resolve the editable baseline directly from the canonical semantic object. */
export function resolvedConvertedSourcePlacement(object) {
  if (!object) return null;
  const effective=object.effective || {}, position=effective.position;
  if (!Array.isArray(position) || position.length < 2) return null;
  const trigger=Array.isArray(effective.triggerBounds) ? effective.triggerBounds : null;
  const presentation=object.presentation || {}, pnByState=presentation.pnByState || {};
  return Object.freeze({
    x:Number(position[0]), y:Number(position[1]),
    triggerX:Number(trigger?.[0] ?? position[0]), triggerY:Number(trigger?.[1] ?? position[1]),
    triggerBounds:trigger ? Object.freeze(trigger.slice(0,4).map(Number)) : null,
    pn:Number.isFinite(Number(pnByState.snapshot)) ? Number(pnByState.snapshot) : (Number.isFinite(Number(pnByState.simulated)) ? Number(pnByState.simulated) : null),
    front:String(presentation.layer || '') === 'front',
    mirrorX:!!presentation.mirrorX, mirrorY:!!presentation.mirrorY,
    presentationOrigin:Array.isArray(effective.presentationOrigin) ? Object.freeze(effective.presentationOrigin.slice(0,2).map(Number)) : null,
    placementAuthority:String(object?.alignedBaseline?.authority || object?.authority || 'resolved-level'),
    triggerAuthority:String(object?.alignedTrigger?.authority || (trigger ? 'resolved-level' : 'none'))
  });
}

export function resolvedEntityBaselineContext(object) {
  const placement=resolvedConvertedSourcePlacement(object);
  if (!placement) return null;
  return {
    contact:[placement.x,placement.y],
    trigger:[placement.triggerX,placement.triggerY],
    presentation:{
      pn:placement.pn,
      origin:placement.presentationOrigin,
      anchor:null,
      drawBounds:null
    },
    authority:{position:placement.placementAuthority,trigger:placement.triggerAuthority}
  };
}

/** Recover source provenance for older drafts against ResolvedLevel semantics. */
export function recoverConvertedSourceProvenanceFromResolved(document, resolvedRoom = null) {
  const objects=resolvedRoom?.layers?.semanticCorpus?.objects || [];
  const byMark=new Map(objects.flatMap(object=>{
    const mark=Number(object?.sources?.classic?.mark);
    return Number.isInteger(mark) ? [[mark,object]] : [];
  }));
  const claimed=new Set((document?.entities || []).filter(e=>e?.sourceMark != null&&Number.isInteger(Number(e.sourceMark))).map(e=>Number(e.sourceMark)));
  for (const override of (document?.sourceEntityOverrides || []).filter(row=>row?.suppressed&&!claimed.has(Number(row.mark)))) {
    const mark=Number(override.mark), object=byMark.get(mark), placement=resolvedConvertedSourcePlacement(object);
    if (!object || !placement) continue;
    const entityType=Number(object?.controller?.entity ?? object?.sourceEvidence?.classic?.entity);
    const matches=(document.entities || []).filter(entity =>
      entity?.sourceMark == null && Number(entity.entity) === entityType &&
      ((Number(entity.x) === placement.x && Number(entity.y) === placement.y) ||
       (Number(entity.triggerX) === placement.triggerX && Number(entity.triggerY) === placement.triggerY)));
    if (matches.length === 1) { matches[0].sourceMark=mark; claimed.add(mark); }
  }
  return document;
}


/** Recover provenance for drafts saved before sourceMark was persisted. */
export function recoverConvertedSourceProvenance(document, sourceEntities = [], pixelOffset = null, productionRoom = null) {
  const dx = Number(pixelOffset?.dxPx || 0), dy = Number(pixelOffset?.dyPx || 0);
  const claimed = new Set((document?.entities || []).filter(e => e?.sourceMark != null && Number.isInteger(Number(e.sourceMark))).map(e => Number(e.sourceMark)));
  for (const override of (document?.sourceEntityOverrides || []).filter(row => row?.suppressed && !claimed.has(Number(row.mark)))) {
    const mark = Number(override.mark);
    const source = (sourceEntities || []).find(row => Number(row?.mark) === mark);
    if (!source) continue;
    const trigger = source.triggerBounds || [source.x, source.y, 0, 0];
    const expectedX = Number(source.x) + dx, expectedY = Number(source.y) + dy;
    const expectedTriggerX = Number(trigger[0]) + dx, expectedTriggerY = Number(trigger[1]) + dy;
    const production=productionConvertedSourcePlacement(source,productionRoom,pixelOffset);
    const matches = (document.entities || []).filter(entity =>
      entity?.sourceMark == null && Number(entity.entity) === Number(source.entity) &&
      ((Number(entity.x) === expectedX && Number(entity.y) === expectedY) ||
       (Number(entity.triggerX) === expectedTriggerX && Number(entity.triggerY) === expectedTriggerY) ||
       (production && Number(entity.x) === production.x && Number(entity.y) === production.y) ||
       (production && Number(entity.triggerX) === production.triggerX && Number(entity.triggerY) === production.triggerY)));
    if (matches.length === 1) {
      matches[0].sourceMark = mark;
      claimed.add(mark);
    }
  }
  return document;
}
