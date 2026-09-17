import { DRAFT_SCHEMA } from '../runtime/native-runtime-adapter.js';

const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const equal = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const sourceMark = object => { const mark=Number(object?.sources?.classic?.mark); return Number.isInteger(mark) && mark > 0 ? mark : null; };
const suppressed = object => String(object?.implementationDisposition || '').startsWith('suppressed');
const position = object => object?.effective?.position || object?.alignedBaseline?.origin || null;
const patrol = object => object?.controller?.reviewedPatrol || object?.sourceEvidence?.classic?.controller?.patrol || null;
const visualAnchor = object => object?.effective?.visualAnchor || null;
const pn = object => { const value=object?.presentation?.pnByState?.snapshot ?? object?.presentation?.pnByState?.simulated ?? object?.states?.snapshot?.pn ?? object?.states?.simulated?.pn; return Number.isInteger(Number(value)) ? Number(value) : null; };
const plane = value => String(value || 'B').toUpperCase() === 'A' ? 1 : 0;
function objectsById(room) { return new Map((room?.layers?.semanticCorpus?.objects || []).map(object => [String(object.semanticId), object])); }
function blockingIssue(type, target, message) { return Object.freeze({ severity:'error', code:'RUNTIME_DRAFT_BLOCKED', type, ...(target ? {target} : {}), blocking:true, nativePlaytest:'blocked', message }); }
function addTranslation(map, submap, mark, dx, dy) {
  const key=`${submap}:${mark}`, previous=map.get(key) || {submap,mark,dx:0,dy:0};
  map.set(key, {submap,mark,dx:Number(previous.dx)+Number(dx),dy:Number(previous.dy)+Number(dy)});
}
function presentationWithoutPn(object) {
  const value=structuredClone(object?.presentation || null);
  if (!value) return value;
  delete value.pn; delete value.pnByState; delete value.authoredOverride; delete value.provenance;
  return value;
}
function terrainWorldCells(terrainWorkspace, assets, issues) {
  const rows=[]; if (!terrainWorkspace || !assets?.mapDecoder) return rows;
  for (const resolved of terrainWorkspace.listResolved()) {
    if (resolved?.cell?.gameplay?.mode !== 'semantic' || resolved.cell.gameplay.semantic === 'preserve') continue;
    const output=resolved?.source?.outputs?.[0] || null;
    if (!output?.sourceCell || output.sourceMapId == null) { issues.push(blockingIssue('terrain-cell',String(resolved.cell.cell),`${resolved.cell.familyId} has no source descriptor for authoritative native Playtest.`)); continue; }
    const source=assets.mapDecoder.inspectGridCell(Number(output.sourceMapId), Number(output.sourceCell[0])*2, Number(output.sourceCell[1])*2);
    const mt=source?.descriptor?.mt, ml=source?.descriptor?.ml;
    if (mt == null || ml == null) { issues.push(blockingIssue('terrain-cell',String(resolved.cell.cell),`${resolved.cell.familyId} source descriptor is unavailable for authoritative native Playtest.`)); continue; }
    rows.push(Object.freeze({x:Number(resolved.cell.cell[0])+1,y:Number(resolved.cell.cell[1])+1,mt:Number(mt),ml:Number(ml)}));
  }
  return rows;
}
function terrainVisualOverrides(terrainWorkspace, room) {
  if (!terrainWorkspace) return [];
  return terrainWorkspace.visualOperations().map(row => Object.freeze({
    mapId:Number(room.mapId), targetX:Number(row.visualCell[0]), targetY:Number(row.visualCell[1]),
    sourceX:Number(row.sourceVisualCell[0]), sourceY:Number(row.sourceVisualCell[1]), targetPlane:plane(row.layer), sourcePlane:plane(row.sourceLayer),
    clear:false, sourceMapId:Number(row.sourceMapId ?? room.mapId), mirrorX:false
  }));
}

export function buildRuntimeDraft({ baseRoom, reviewedRoom = baseRoom, terrainWorkspace = null, assets = null } = {}) {
  if (!baseRoom || !reviewedRoom) throw new TypeError('Runtime draft requires base and reviewed rooms');
  const beforeById=objectsById(baseRoom), afterById=objectsById(reviewedRoom);
  const translationBySource=new Map(), sourcePresentation=[], sourceSuppressions=[], sourceEntityOverrides=[], sourcePatrolOverrides=[], sourceVisualOffsets=[], issues=[];
  for (const [id, after] of afterById) {
    const before=beforeById.get(id); if (!before) continue;
    const mark=sourceMark(after) ?? sourceMark(before);
    if (mark == null) {
      if (!equal(before,after)) issues.push(blockingIssue('entity-source',id,'This edited semantic object has no Classic source mark that the native draft ABI can address; promote/reload it before Playtest.'));
      continue;
    }
    const submap=Number(reviewedRoom.submap);
    const beforePosition=position(before), afterPosition=position(after);
    if (Array.isArray(beforePosition) && Array.isArray(afterPosition) && !equal(beforePosition,afterPosition)) addTranslation(translationBySource,submap,mark,number(afterPosition[0])-number(beforePosition[0]),number(afterPosition[1])-number(beforePosition[1]));

    const beforeType=before?.controller?.entity == null ? null : Number(before.controller.entity), afterType=after?.controller?.entity == null ? null : Number(after.controller.entity);
    if (Number.isInteger(afterType) && beforeType !== afterType) sourceEntityOverrides.push(Object.freeze({submap,mark,entityN:afterType}));
    if (String(before?.class || '') !== String(after?.class || '')) issues.push(blockingIssue('entity-type',id,'Changing semantic class can alter production projection ownership; only the xrick controller entity can be hot-applied. Promote/reload this class change before Playtest.'));

    const beforePatrol=patrol(before), afterPatrol=patrol(after);
    if (!equal(beforePatrol,afterPatrol)) {
      if (Array.isArray(afterPatrol?.start) && Array.isArray(afterPatrol?.end)) {
        /* Reviewed patrol application already projects a changed phase-zero
         * start into effective.position. The position delta above therefore
         * owns the native source translation for both bounded→bounded and
         * free-roam→bounded edits; adding the patrol-start delta again here
         * would double-translate the live xrick entity. */
        const distancePx=Math.abs(number(afterPatrol.end[0])-number(afterPatrol.start[0]));
        const initialDx=String(afterPatrol.initialDirection || '').toLowerCase()==='left' || number(afterPatrol.end[0]) < number(afterPatrol.start[0]) ? -2 : 2;
        sourcePatrolOverrides.push(Object.freeze({submap,mark,distancePx,initialDx,startupLatencyTicks:number(afterPatrol.startupLatencyTicks ?? afterPatrol.startupLatency,0)}));
      } else issues.push(blockingIssue('entity-patrol',id,'The edited patrol has no valid native bounded-patrol descriptor.'));
    }

    const beforeAnchor=visualAnchor(before), afterAnchor=visualAnchor(after);
    if (Array.isArray(beforeAnchor) && Array.isArray(afterAnchor) && !equal(beforeAnchor,afterAnchor)) {
      const patrolDelta=Array.isArray(after?.reviewed?.patrolAnchorDelta) ? after.reviewed.patrolAnchorDelta : [0,0];
      const dx=number(afterAnchor[0])-number(beforeAnchor[0])-number(patrolDelta[0]);
      const dy=number(afterAnchor[1])-number(beforeAnchor[1])-number(patrolDelta[1]);
      if (dx || dy) sourceVisualOffsets.push(Object.freeze({submap,mark,dx,dy}));
    }

    const beforePn=pn(before), afterPn=pn(after); if (afterPn != null && beforePn !== afterPn) sourcePresentation.push(Object.freeze({submap,mark,pn:afterPn}));
    if (!equal(presentationWithoutPn(before),presentationWithoutPn(after))) issues.push(blockingIssue('presentation',id,'This presentation edit changes semantics beyond the native PN draft override; promote/reload it before Playtest.'));

    if (!suppressed(before) && suppressed(after)) sourceSuppressions.push(Object.freeze({submap,mark}));
    if (suppressed(before) && !suppressed(after)) issues.push(blockingIssue('entity-suppression',id,'Unsuppressing an already-canonical source requires promotion/reload before native Playtest.'));

    const unsupported = [
      ['entity-source', before?.sources, after?.sources],
      ['trigger-bounds', before?.effective?.triggerBounds, after?.effective?.triggerBounds],
      ['gameplay-bounds', before?.effective?.gameplayBounds, after?.effective?.gameplayBounds],
      ['visual-bounds', before?.effective?.visualBounds, after?.effective?.visualBounds],
      ['moving-platform-controller', before?.controller?.reviewedParameters, after?.controller?.reviewedParameters]
    ];
    for (const [type,beforeValue,afterValue] of unsupported) if (!equal(beforeValue,afterValue)) issues.push(blockingIssue(type,id,`${type} cannot be hot-applied faithfully by the native draft ABI; promote/reload it before Playtest.`));
  }
  if (!equal(baseRoom?.layers?.alignment, reviewedRoom?.layers?.alignment)) issues.push(blockingIssue('alignment-exception',null,'Layer-C alignment edits require canonical promotion/reload before native Playtest.'));
  if (!equal(baseRoom?.layers?.structuralCorrections, reviewedRoom?.layers?.structuralCorrections)) issues.push(blockingIssue('terrain-cell',null,'Reviewed exact 8×8 collision edits require canonical promotion/reload before native Playtest.'));
  for (const exception of terrainWorkspace?.listGameplayExceptions?.() || []) issues.push(blockingIssue('terrain-cell',null,`Exact 8×8 gameplay exception ${exception.cell} requires canonical promotion/reload; the development ABI edits 16×16 native descriptors only.`));

  const sourceTranslations=[...translationBySource.values()].filter(row=>row.dx||row.dy).map(Object.freeze);
  return Object.freeze({ draft:Object.freeze({
    schema:DRAFT_SCHEMA, worldCells:Object.freeze(terrainWorldCells(terrainWorkspace,assets,issues)), sourceSuppressions:Object.freeze(sourceSuppressions),
    sourceTranslations:Object.freeze(sourceTranslations), sourceEntityOverrides:Object.freeze(sourceEntityOverrides), sourcePatrolOverrides:Object.freeze(sourcePatrolOverrides),
    sourceVisualOffsets:Object.freeze(sourceVisualOffsets), sourcePresentation:Object.freeze(sourcePresentation), visualOverrides:Object.freeze(terrainVisualOverrides(terrainWorkspace,reviewedRoom)),
    entities:Object.freeze([]), transitions:Object.freeze([])
  }), issues:Object.freeze(issues) });
}
