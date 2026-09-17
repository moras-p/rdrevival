const int = value => Number.isInteger(Number(value)) ? Number(value) : null;
const clonePoint = value => Array.isArray(value) && value.length >= 2 ? [Number(value[0]), Number(value[1])] : null;

export const ENEMY_CONTROLLER_MIN = 0x04;
export const ENEMY_CONTROLLER_MAX = 0x0f;

export const ENEMY_TYPES = Object.freeze([
  Object.freeze({ id:'bounded-patrol', label:'Bounded patrol', offset:0, controllerFamily:'type1a', description:'Walks a fixed Classic/xrick horizontal patrol and reverses at the authored bounds or earlier static blocking.' }),
  Object.freeze({ id:'free-roam', label:'Free roam', offset:1, controllerFamily:'type1b', description:'Native reactive enemy. The editor keeps a stable whole-room anchor while xrick owns live roaming/falling motion.' }),
  Object.freeze({ id:'terrain-pursuit', label:'Free roam + terrain pursuit', offset:2, controllerFamily:'type2', description:'Native pursuit/climb controller. Mutable motion is xrick-only; the editor does not fabricate a patrol route.' })
]);

const typeById = new Map(ENEMY_TYPES.map(row => [row.id, row]));
const typeByOffset = new Map(ENEMY_TYPES.map(row => [row.offset, row]));

export function isClassicEnemyEntity(entityN) {
  const n = int(entityN);
  return n != null && n >= ENEMY_CONTROLLER_MIN && n <= ENEMY_CONTROLLER_MAX;
}

export function enemyControllerParts(entityN) {
  const n = int(entityN);
  if (!isClassicEnemyEntity(n)) return null;
  const familyIndex = Math.floor((n - ENEMY_CONTROLLER_MIN) / 3);
  const offset = (n - ENEMY_CONTROLLER_MIN) % 3;
  const type = typeByOffset.get(offset) || null;
  return Object.freeze({ entity:n, familyIndex, kindBaseEntity:ENEMY_CONTROLLER_MIN + familyIndex * 3, typeId:type?.id || null, typeOffset:offset, controllerFamily:type?.controllerFamily || null });
}

export function enemyTypeForEntity(entityN) {
  const parts = enemyControllerParts(entityN);
  return parts ? typeById.get(parts.typeId) || null : null;
}

export function enemyEntityFor(kindBaseEntity, typeId) {
  const base = int(kindBaseEntity), type = typeById.get(String(typeId || ''));
  if (!type || base == null || ![0x04,0x07,0x0a,0x0d].includes(base)) return null;
  return base + type.offset;
}

export function enemyKindFromClassicSource(source) {
  const entity = int(source?.entity), sprbase = int(source?.sprbase ?? source?.sprite);
  const parts = enemyControllerParts(entity);
  if (!parts || sprbase == null) return null;
  return Object.freeze({ kindBaseEntity:parts.kindBaseEntity, sprbase, sourceEntity:entity });
}


const EXCLUDED_RDX_ENEMY_KIND_SET_IDS = new Set(['castle_dog']);

function animationKey(row) {
  return `${String(row?.action || '')}:${String(row?.direction || 'neutral')}`;
}

function enemyWalkAnimations(set) {
  const animations = Array.isArray(set?.animations) ? set.animations : [];
  const right = animations.find(row => String(row?.action || '') === 'walk' && String(row?.direction || '') === 'right');
  const left = animations.find(row => String(row?.action || '') === 'walk' && String(row?.direction || '') === 'left');
  return right && left ? { right, left } : null;
}

function selectableRdxEnemySet(set) {
  return String(set?.type || '') === 'enemy' && !!enemyWalkAnimations(set) && !EXCLUDED_RDX_ENEMY_KIND_SET_IDS.has(String(set?.setId || ''));
}

const ENEMY_KIND_LABELS = Object.freeze({
  jungle_enemy_a:'Jungle enemy A',
  jungle_enemy_b:'Jungle enemy B',
  egypt_mummy_guard:'Fez / mummy guard',
  egypt_large_guard:'Walk-like-Egyptian / large guard',
  castle_guard:'Castle guard',
  castle_missile_guard:'Castle / Missile guard',
  missile_soldier_guard:'Missile soldier guard'
});

function kindLabel(set) {
  const display = String(set?.displayName || set?.setId || 'RDX enemy');
  const suffix = ENEMY_KIND_LABELS[String(set?.setId || '')] || (display.includes('—') ? display.split('—').slice(1).join('—').trim() : display);
  const walk = enemyWalkAnimations(set);
  const pns = walk ? `${Number(walk.right.pn)}/${Number(walk.left.pn)}` : '';
  return `${suffix}${pns ? ` · PN ${pns}` : ''}`;
}

function kindRow(set) {
  if (!selectableRdxEnemySet(set)) return null;
  const animations = Object.freeze((set.animations || []).map(row => Object.freeze({
    action:String(row?.action || ''), direction:String(row?.direction || 'neutral'), pn:Number(row?.pn)
  })).filter(row => Number.isInteger(row.pn) && row.pn >= 0 && row.pn < 255));
  const actorIds = Object.freeze((set.actorIds || []).map(value => Number.parseInt(String(value), 0))
    .filter(value => Number.isInteger(value) && value >= 0 && value < 256));
  const walk = enemyWalkAnimations(set);
  return Object.freeze({
    setId:String(set.setId), displayName:String(set.displayName || set.setId), label:kindLabel(set),
    levelGroup:String(set?.introducedAt?.levelGroup || ''), animations, actorIds,
    walkRightPn:Number(walk.right.pn), walkLeftPn:Number(walk.left.pn)
  });
}

export function rdxEnemyKindBySetId(spriteAnims, setId) {
  const set=(spriteAnims?.sets || []).find(row => String(row?.setId || '') === String(setId || ''));
  return kindRow(set);
}

export function rdxEnemyKindForPn(spriteAnims, pn) {
  const n=int(pn); if (n == null) return null;
  for (const set of spriteAnims?.sets || []) {
    if (!selectableRdxEnemySet(set)) continue;
    if ((set.animations || []).some(row => Number(row?.pn) === n)) return kindRow(set);
  }
  return null;
}

export function rdxEnemyKindForActorId(spriteAnims, actorId) {
  const n=int(actorId); if (n == null) return null;
  for (const set of spriteAnims?.sets || []) {
    const kind=kindRow(set); if (!kind) continue;
    if (kind.actorIds.includes(n)) return kind;
  }
  return null;
}

function semanticSourcePnCandidates(semantic) {
  const presentation=semantic?.presentation || {}, states=semantic?.states || {}, out=[];
  for (const value of [presentation?.pnByState?.snapshot,presentation?.pnByState?.simulated,states?.snapshot?.pn,states?.simulated?.pn]) {
    const pn=int(value); if (pn != null && pn >= 0 && pn < 255 && !out.includes(pn)) out.push(pn);
  }
  for (const state of presentation?.statePresentations || []) {
    const pn=int(state?.sourcePn); if (pn != null && pn >= 0 && pn < 255 && !out.includes(pn)) out.push(pn);
  }
  return out;
}

export function sourceRdxEnemyKind(semantic, spriteAnims) {
  for (const pn of semanticSourcePnCandidates(semantic)) {
    const kind=rdxEnemyKindForPn(spriteAnims,pn); if (kind) return kind;
  }
  return null;
}

export function effectiveEnemyKind({ semantic, override = null, spriteAnims } = {}) {
  const explicit=rdxEnemyKindBySetId(spriteAnims,override?.enemyKindSetId);
  if (explicit) return Object.freeze({ ...explicit, source:'draft-rdx-kind' });
  const canonicalTargets=(semantic?.presentation?.statePresentations || []).map(row=>int(row?.pn)).filter(pn=>pn!=null);
  const draftTargets=(override?.statePresentationOverrides || []).map(row=>int(row?.pn)).filter(pn=>pn!=null);
  for (const pn of [...draftTargets,...canonicalTargets]) {
    const kind=rdxEnemyKindForPn(spriteAnims,pn); if (kind) return Object.freeze({ ...kind, source:draftTargets.includes(pn)?'draft-state-presentation':'canonical-state-presentation' });
  }
  const base=sourceRdxEnemyKind(semantic,spriteAnims);
  return base ? Object.freeze({ ...base, source:'rdx-layer-e' }) : null;
}

function roomGroup(manifest, submap) {
  const rooms = Array.isArray(manifest?.rooms) ? manifest.rooms : [];
  return String(rooms.find(row => Number(row?.submap) === Number(submap))?.group || '');
}

function humanizeGroup(group) {
  const key=String(group || 'level');
  const labels={ south_america:'Jungle', egypt:'Egypt', castle:'Castle', missile_base:'Missile Base' };
  return labels[key] || key.replaceAll('_',' ').replace(/\b\w/g, char => char.toUpperCase());
}

export function enemyLevelLabel({ manifest, submap }) {
  return humanizeGroup(roomGroup(manifest, submap));
}

export function enemyKindsForLevel({ spriteAnims, resolvedLevels, manifest, submap }) {
  const group = roomGroup(manifest, submap);
  if (!group) return Object.freeze([]);
  const groupSubmaps = new Set((manifest?.rooms || []).filter(row => String(row?.group || '') === group).map(row => Number(row.submap)));
  const kinds = new Map();
  for (const room of resolvedLevels?.rooms || []) {
    if (!groupSubmaps.has(Number(room?.submap))) continue;
    for (const actor of room?.layers?.source?.rdx?.actors || []) {
      const kind=rdxEnemyKindForActorId(spriteAnims,actor?.actorId); if (!kind) continue;
      const row=kinds.get(kind.setId) || { ...kind, group, count:0, submaps:new Set() };
      row.count += 1; row.submaps.add(Number(room.submap)); kinds.set(kind.setId,row);
    }
  }
  return Object.freeze([...kinds.values()].sort((a,b)=>a.walkRightPn-b.walkRightPn || a.setId.localeCompare(b.setId)).map(row=>Object.freeze({
    setId:row.setId, displayName:row.displayName, label:row.label, group:row.group,
    walkRightPn:row.walkRightPn, walkLeftPn:row.walkLeftPn, animations:row.animations,
    count:row.count, submaps:Object.freeze([...row.submaps].sort((a,b)=>a-b))
  })));
}

/** Build PN-for-PN RDX presentation remaps for an enemy Kind change. The
 * Classic/xrick controller entity is intentionally untouched; only matching
 * RDX animation actions/directions are replaced. */
export function enemyKindStateOverrides({ semantic, targetSetId, spriteAnims, existing = [] } = {}) {
  const sourceKind=sourceRdxEnemyKind(semantic,spriteAnims),targetKind=rdxEnemyKindBySetId(spriteAnims,targetSetId);
  if (!sourceKind || !targetKind) return Object.freeze([]);
  const targetByKey=new Map(targetKind.animations.map(row=>[animationKey(row),row]));
  const sourceKey=String(semantic?.sources?.rdx?.sourceKey || (semantic?.sources?.classic?.mark != null ? `mark:${Number(semantic.sources.classic.mark)}` : ''));
  if (!sourceKey) return Object.freeze([]);
  const existingRows=Array.isArray(existing)?existing:[];
  const out=[];
  for (const sourceState of sourceKind.animations) {
    const target=targetByKey.get(animationKey(sourceState)); if (!target) continue;
    const prior=existingRows.find(row=>String(row?.sourceKey||'')===sourceKey&&Number(row?.sourcePn)===Number(sourceState.pn));
    const next={sourceKey,stateKey:`pn:${Number(sourceState.pn)}`,sourcePn:Number(sourceState.pn),pn:Number(target.pn)};
    if (Array.isArray(prior?.offset) && (Number(prior.offset[0])||Number(prior.offset[1]))) next.offset=[Number(prior.offset[0]||0),Number(prior.offset[1]||0)];
    if (next.pn != null || next.offset) out.push(Object.freeze(next));
  }
  return Object.freeze(out);
}

export function effectiveEnemyEntity(source, override = null) {
  const draft = int(override?.controllerEntity);
  return isClassicEnemyEntity(draft) ? draft : (isClassicEnemyEntity(source?.entity) ? Number(source.entity) : null);
}

export function normalizeEnemyPatrol(value) {
  const start = clonePoint(value?.start), end = clonePoint(value?.end);
  if (!start || !end || !start.every(Number.isFinite) || !end.every(Number.isFinite)) return null;
  start[0]=Math.round(start[0]);start[1]=Math.round(start[1]);end[0]=Math.round(end[0]);end[1]=Math.round(end[1]);
  if (start[1] !== end[1]) return null;
  const distancePx = Math.abs(end[0]-start[0]);
  if (!distancePx || (distancePx & 1)) return null;
  const initialDirection = end[0] < start[0] ? 'left' : 'right';
  const startupLatencyTicks = Math.max(0,Math.min(255,Math.round(Number(value?.startupLatencyTicks ?? value?.startupLatency ?? 0) || 0)));
  return Object.freeze({
    start:Object.freeze(start), end:Object.freeze(end), distancePx, stepPx:2,
    counterLimit:Math.max(1,Math.floor(distancePx/2)), initialDirection,
    startupLatencyTicks, loopPeriodTicks:Math.max(2,distancePx)
  });
}

export function sourceEnemyPatrol(source, override = null, semantic = null) {
  return normalizeEnemyPatrol(override?.patrol) || normalizeEnemyPatrol(semantic?.controller?.reviewedPatrol) || normalizeEnemyPatrol(source?.controller?.patrol) || null;
}

export function enemyPatrolEditorGeometry({ source, semantic, override = null } = {}) {
  const patrol=sourceEnemyPatrol(source,override,semantic);
  if (!patrol) return null;
  const classic=semantic?.sourceEvidence?.classic || source || null;
  const sourceX=Number(classic?.x),sourceY=Number(classic?.y);
  /* Reviewed patrol-start edits translate the effective controller as well as
   * changing the source-space patrol descriptor. Project the descriptor from
   * the pre-review Layer-C alignment so that anchor movement is applied once,
   * matching native's source-position delta + patrol-distance override. */
  const patrolAnchorDelta=semantic?.reviewed?.patrolAnchorDelta;
  const effective=semantic?.effective?.position;
  const aligned=Array.isArray(semantic?.alignedBaseline?.origin)
    ? semantic.alignedBaseline.origin
    : (Array.isArray(effective)&&Array.isArray(patrolAnchorDelta)
      ? [Number(effective[0])-Number(patrolAnchorDelta[0]||0),Number(effective[1])-Number(patrolAnchorDelta[1]||0)]
      : effective);
  const dx=Array.isArray(aligned)&&Number.isFinite(sourceX)?Number(aligned[0])-sourceX:0;
  const dy=Array.isArray(aligned)&&Number.isFinite(sourceY)?Number(aligned[1])-sourceY:0;
  const floorOffsetY=Math.max(0,Number(classic?.h ?? source?.h ?? 0) || 0);
  const project=point=>Object.freeze([Number(point[0])+dx,Number(point[1])+dy+floorOffsetY]);
  const start=project(patrol.start),end=project(patrol.end);
  const startIsLeft=Number(start[0])<=Number(end[0]);
  const left=startIsLeft?start:end,right=startIsLeft?end:start;
  const enemyW=Math.max(1,Number(classic?.w ?? source?.w ?? 24) || 24);
  const enemyH=Math.max(1,Number(classic?.h ?? source?.h ?? 21) || 21);
  const reviewedPatrol=normalizeEnemyPatrol(semantic?.controller?.reviewedPatrol);
  const patrolAuthority=override?.patrol?'editor-draft':reviewedPatrol?'editor-layer-f-reviewed':'editor-layer-b';
  const sweepMinX=Number(left[0])-1,sweepMaxX=Number(right[0])+enemyW;
  const sweepMinY=Number(left[1])-enemyH,sweepMaxY=Number(left[1]);
  const sweepBounds=Object.freeze({
    x:sweepMinX,y:sweepMinY,
    width:Math.max(1,sweepMaxX-sweepMinX),height:Math.max(1,sweepMaxY-sweepMinY)
  });
  const dangerEnvelope=Object.freeze({
    minX:sweepMinX,maxX:sweepMaxX,minY:sweepMinY,maxY:sweepMaxY,
    width:sweepBounds.width,height:sweepBounds.height,
    sampleCount:2,authority:`${patrolAuthority}-guard-sweep`
  });
  const sourceKey=String(semantic?.sources?.rdx?.sourceKey || `mark:${Number(classic?.mark ?? source?.mark ?? -1)}`);
  const overlayRow=Object.freeze({
    debugId:`editor-patrol:${sourceKey}`,
    elementId:`editor-patrol:${sourceKey}`,
    sourceKey,
    category:'enemy',subjectCategory:'enemy',overlayType:'editor-selected-patrol',
    bounds:sweepBounds,
    current:Object.freeze([Number(left[0])+Math.floor((enemyW-1)/2),Number(left[1])]),
    policy:Object.freeze({family:'type1a',label:`${sourceKey} patrol`}),
    dangerEnvelope,
    pathPoints:Object.freeze([Object.freeze([Number(left[0]),Number(left[1])]),Object.freeze([Number(right[0]),Number(right[1])])]),
    notes:Object.freeze([`Map-view selected bounded patrol uses the ${patrolAuthority} descriptor and projected guard sweep.`])
  });
  return Object.freeze({
    patrol,start,end,left,right,startIsLeft,
    sourceOffset:Object.freeze([dx,dy]),floorOffsetY,
    enemySize:Object.freeze([enemyW,enemyH]),sweepBounds,dangerEnvelope,overlayRow,
    leftEndpoint:startIsLeft?'start':'end',rightEndpoint:startIsLeft?'end':'start'
  });
}

export function resizeEnemyPatrolEdge(patrolValue, edge, classicX) {
  const patrol=normalizeEnemyPatrol(patrolValue);
  if (!patrol || !['left','right'].includes(String(edge))) return null;
  const start=[...patrol.start],end=[...patrol.end],startIsLeft=start[0]<=end[0];
  const leftX=Math.min(start[0],end[0]),rightX=Math.max(start[0],end[0]);
  const raw=Math.round(Number(classicX)); if (!Number.isFinite(raw)) return patrol;
  let nextLeft=leftX,nextRight=rightX;
  if (edge==='left') {
    const candidate=Math.min(raw,rightX-2),span=Math.max(2,Math.round((rightX-candidate)/2)*2);
    nextLeft=rightX-span;
  } else {
    const candidate=Math.max(raw,leftX+2),span=Math.max(2,Math.round((candidate-leftX)/2)*2);
    nextRight=leftX+span;
  }
  if (startIsLeft) { start[0]=nextLeft; end[0]=nextRight; }
  else { start[0]=nextRight; end[0]=nextLeft; }
  return normalizeEnemyPatrol({ ...patrol,start,end });
}

export function applyEnemyKindToSimulationState({ state, override = null, spriteAnims } = {}) {
  if (!state || !override?.enemyKindSetId) return state || null;
  const target=rdxEnemyKindBySetId(spriteAnims,override.enemyKindSetId);
  if (!target) return state;
  const sourcePn=int(state.pn);
  const remap=(override.statePresentationOverrides || []).find(row=>int(row?.sourcePn)===sourcePn);
  let pn=int(remap?.pn);
  if (pn == null && sourcePn != null && rdxEnemyKindForPn(spriteAnims,sourcePn)?.setId===target.setId) pn=sourcePn;
  if (pn == null) pn=String(state.direction||'')==='left'?target.walkLeftPn:target.walkRightPn;
  return Object.freeze({
    ...state,pn,presentationAudited:true,editorEnemyKindSetId:target.setId,
    presentationAuthority:'editor-enemy-kind-draft'
  });
}

export function enemyPatrolSourceStart(source) {
  const classic = source?.sourceEvidence?.classic || source || null;
  const patrol = normalizeEnemyPatrol(classic?.controller?.patrol);
  if (patrol) return patrol.start;
  const x=Number(classic?.x), y=Number(classic?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? Object.freeze([Math.round(x),Math.round(y)]) : null;
}

export function enemyPatrolAnchorOffset(source, patrolValue) {
  const base=enemyPatrolSourceStart(source), patrol=normalizeEnemyPatrol(patrolValue);
  if (!base || !patrol) return Object.freeze({dx:0,dy:0,baseStart:base,editedStart:patrol?.start || null});
  return Object.freeze({
    dx:Number(patrol.start[0])-Number(base[0]),
    dy:Number(patrol.start[1])-Number(base[1]),
    baseStart:base,
    editedStart:patrol.start
  });
}

/** Pick a source-grounded bounded-patrol shape from this level/theme. The
 * selected enemy's Classic source position remains the phase-zero anchor;
 * only distance/direction/latency are borrowed when converting a free-roam
 * family that has no authored patrol of its own. */
export function defaultEnemyPatrolForSource({ source, classicData, manifest, submap, kindBaseEntity = null }) {
  const sourceKind = enemyKindFromClassicSource(source);
  const preferredBase = int(kindBaseEntity) ?? sourceKind?.kindBaseEntity ?? null;
  const group = roomGroup(manifest, submap);
  const groupSubmaps = new Set((manifest?.rooms || []).filter(row=>String(row?.group||'')===group).map(row=>Number(row.submap)));
  const candidates=[];
  for (const room of classicData?.rooms || []) {
    if (!groupSubmaps.has(Number(room?.submap))) continue;
    for (const row of room?.entities || []) {
      const parts=enemyControllerParts(row?.entity), patrol=normalizeEnemyPatrol(row?.controller?.patrol);
      if (!parts || parts.typeId!=='bounded-patrol' || !patrol) continue;
      candidates.push({ row, parts, patrol, sameRoom:Number(room.submap)===Number(submap), sameKind:parts.kindBaseEntity===preferredBase });
    }
  }
  candidates.sort((a,b)=>Number(b.sameKind)-Number(a.sameKind) || Number(b.sameRoom)-Number(a.sameRoom));
  const template=candidates[0]?.patrol;
  const x=Math.round(Number(source?.x)||0), y=Math.round(Number(source?.y)||0);
  const distance=template?.distancePx || 64, direction=template?.initialDirection || 'right', endX=x+(direction==='left'?-distance:distance);
  return normalizeEnemyPatrol({ start:[x,y], end:[endX,y], startupLatencyTicks:template?.startupLatencyTicks || 0 });
}
