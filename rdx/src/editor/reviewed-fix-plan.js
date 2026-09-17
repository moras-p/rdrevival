import { normalizeLevelDocument } from './level-document.js';
import {
  REVIEWED_CORRECTIONS_SCHEMA,
  reviewedCorrectionCurrentValue,
  validateReviewedCorrectionLedger
} from '../level-editor/domain/reviewed-corrections.js';
import { mergeCanonicalStatePresentations, normalizeStatePresentationOverrides } from './stateful-presentation.js';
import { enemyTypeForEntity, normalizeEnemyPatrol } from './enemy-authoring.js';
import { stampById, resolveStampVisualOverrides } from './stamps.js';

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const safe = value => String(value || '').replace(/[^a-zA-Z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'target';

function blocking(code, message, detail = null) {
  return Object.freeze({
    severity:'error', code, message, blocking:true, nativePlaytest:'blocked',
    ...(detail == null ? {} : { detail })
  });
}

function sourceObjectsByMark(room) {
  return new Map((room?.layers?.semanticCorpus?.objects || []).flatMap(object => {
    const mark = Number(object?.sources?.classic?.mark);
    return Number.isInteger(mark) ? [[mark, object]] : [];
  }));
}

function nextCorrectionId(roomId, type, target, occupied) {
  const stem = `${roomId}.editor.${safe(type)}.${safe(target)}`;
  let n = 1;
  while (occupied.has(`${stem}.${n}`)) n += 1;
  const id = `${stem}.${n}`;
  occupied.add(id);
  return id;
}

function correction(room, occupied, type, target, value, reason, { expected = undefined } = {}) {
  const row = {
    id:nextCorrectionId(room.id, type, target, occupied), type, target, value:clone(value),
    provenance:{ authority:'level-editor-reviewed-fix', reason:String(reason || `Level Editor ${type} correction`) }
  };
  if (expected !== undefined) row.expected = clone(expected);
  return row;
}

function visualRecord(row, room, mapDecoder) {
  const gx = Number(row?.target?.[0]), gy = Number(row?.target?.[1]);
  const layer = String(row?.layer || 'B').toUpperCase();
  if (!Number.isInteger(gx) || !Number.isInteger(gy) || !['A','B'].includes(layer)) return { error:'Presentation cell has invalid target coordinates or plane.' };
  const bounds = [gx * 8, gy * 8, 8, 8];
  if (String(row.operation || 'copy') === 'clear') return { value:{ action:'suppress', layer, bounds } };

  const sourceMapId = Number(row.sourceMapId ?? room.mapId);
  const source = Array.isArray(row.source) ? row.source.map(Number) : null;
  const sourceLayer = String(row.sourceLayer || layer).toUpperCase();
  if (!source || source.length !== 2 || source.some(value => !Number.isInteger(value)) || !['A','B'].includes(sourceLayer)) return { error:'Presentation copy has no stable RDX source cell.' };

  /* Reviewed visual corrections must preserve the raw donor cell selected by
   * the editor.  A deferred same-map `copy` would read from the already
   * patched presentation (and, in native viewport rendering, may not have the
   * donor cell decoded at all), so materialize the donor tile now just like a
   * cross-map copy. */
  if (!mapDecoder?.inspectGridCell) return { error:'Presentation copy requires RDX source provenance.' };
  const inspected = mapDecoder.inspectGridCell(sourceMapId, source[0], source[1]);
  const plane = sourceLayer === 'A' ? inspected?.visual?.foreground : inspected?.visual?.background;
  if (!plane?.allowed || plane.transparent) return { value:{ action:'suppress', layer, bounds } };
  const globalTile = Number(plane?.resolution?.globalTile);
  if (!Number.isInteger(globalTile) || globalTile < 0) return { error:`Source ${sourceMapId}:${source[0]},${source[1]}:${sourceLayer} is inline/animated and cannot be persisted as a stable reviewed tile.` };
  return { value:{
    action:'overlay-tiles', bounds, clearLayer:layer,
    tiles:[{
      globalTile, offset:[0,0], paletteLine:Number(plane.paletteLine || 0), plane:layer,
      hFlip:Boolean(plane.hFlip) !== Boolean(row.mirrorX), vFlip:Boolean(plane.vFlip)
    }]
  } };
}

function smartScissorsBatchRecords(rows, room, mapDecoder) {
  const meta=rows?.[0]?.smartScissors || null;
  if(!meta||!Array.isArray(meta.targetBounds)||!Array.isArray(meta.sourceBounds))return { error:'Smart-scissors batch is missing stable source/target bounds.' };
  const targetBounds=meta.targetBounds.slice(0,4).map(Number),sourceBounds=meta.sourceBounds.slice(0,4).map(Number),sourceMapId=Number(meta.sourceMapId);
  if(targetBounds.some(value=>!Number.isInteger(value))||sourceBounds.some(value=>!Number.isInteger(value))||targetBounds[2]<=0||targetBounds[3]<=0||targetBounds.some(value=>value%8)||sourceBounds.some(value=>value%8))return { error:'Smart-scissors batch bounds must be positive 8px-aligned rectangles.' };
  const values=[];
  for(const layer of ['B','A']){
    const planeRows=rows.filter(row=>String(row.layer||'').toUpperCase()===layer);
    if(!planeRows.length)continue;
    /* Keep Smart Scissors cut/move semantics stable: its donor rectangle is
     * raw map provenance, not a reference to the current patched room. */
    if(!mapDecoder?.inspectGridCell) return { error:'Smart-scissors repair requires RDX source provenance.' };
    const tiles=[];
    for(const row of planeRows){
      if(String(row.operation||'copy')==='clear')continue;
      const source=Array.isArray(row.source)?row.source.map(Number):null;
      if(!source||source.length!==2||source.some(value=>!Number.isInteger(value)))return { error:'Smart-scissors source tile is missing stable coordinates.' };
      const inspected=mapDecoder.inspectGridCell(sourceMapId,source[0],source[1]),plane=layer==='A'?inspected?.visual?.foreground:inspected?.visual?.background;
      if(!plane?.allowed||plane.transparent)continue;
      const globalTile=Number(plane?.resolution?.globalTile);
      if(!Number.isInteger(globalTile)||globalTile<0)return { error:`Smart-scissors donor ${sourceMapId}:${source.join(',')}:${layer} is not a stable global tile.` };
      tiles.push({globalTile,offset:[Number(row.target[0])*8-targetBounds[0],Number(row.target[1])*8-targetBounds[1]],paletteLine:Number(plane.paletteLine||0),plane:layer,hFlip:!!plane.hFlip,vFlip:!!plane.vFlip});
    }
    values.push({layer,value:tiles.length?{action:'overlay-tiles',bounds:targetBounds,clearLayer:layer,tiles}:{action:'suppress',layer,bounds:targetBounds}});
  }
  return { values,meta };
}

/** Compile the maintained editor's unsaved document into the same reviewed
 * correction ledger consumed by the canonical resolver. Anything that the
 * current production model cannot express faithfully is reported as blocking;
 * callers must not launch native Playtest while such an edit is present. */
export function createReviewedFixPlan(document, { resolvedRoom, mapDecoder = null, stampCatalog = null, heroStartChanged = false } = {}) {
  const d = normalizeLevelDocument(document);
  if (!resolvedRoom) return Object.freeze({ ledger:null, corrections:Object.freeze([]), issues:Object.freeze([blocking('REVIEWED_FIX_ROOM','Canonical ResolvedLevel room is unavailable.')]), nativePlaytestSupported:false });
  const existing = clone(resolvedRoom?.layers?.reviewedCorrections || {
    schema:REVIEWED_CORRECTIONS_SCHEMA,
    room:{ submap:Number(resolvedRoom.submap), mapId:Number(resolvedRoom.mapId) },
    corrections:[]
  });
  existing.schema = REVIEWED_CORRECTIONS_SCHEMA;
  existing.room = { submap:Number(resolvedRoom.submap), mapId:Number(resolvedRoom.mapId) };
  existing.corrections = Array.isArray(existing.corrections) ? existing.corrections : [];
  const additions = [];
  const issues = [];
  const removalIds=new Set((d.systemPatchRemovals||[]).map(row=>String(row.patchId||'')).filter(Boolean));
  if(removalIds.size){
    const existingById=new Map(existing.corrections.map(row=>[String(row.id||''),row]));
    for(const id of removalIds){
      const current=existingById.get(id);
      if(!current||current.type!=='visual-plane')issues.push(blocking('REVIEWED_FIX_PATCH_REMOVAL',`System patch ${id} is not a reviewed visual-plane correction and cannot be replaced by Smart Scissors.`));
    }
    existing.corrections=existing.corrections.filter(row=>!removalIds.has(String(row.id||''))||row.type!=='visual-plane');
  }
  const occupied = new Set(existing.corrections.map(row => String(row.id || '')));
  const byMark = sourceObjectsByMark(resolvedRoom);

  if (d.base.blank) issues.push(blocking('REVIEWED_FIX_BLANK','Blank/new-room authoring is not a reviewed production correction and cannot use authoritative correction Playtest.'));
  if (d.alignmentOverrides?.length) issues.push(blocking('REVIEWED_FIX_ALIGNMENT','Layer-C alignment edits change correspondence beyond the hot-applied source actors. Promote/reload the alignment draft before native Playtest.'));
  if (d.collision?.length) issues.push(blocking('REVIEWED_FIX_DESCRIPTOR','16×16 MT/ML descriptor edits do not map exactly to reviewed 8×8 gameplay-cell corrections. Promote a canonical collision correction before native Playtest.'));
  if (d.terrain?.length || d.terrainRelations?.length) issues.push(blocking('REVIEWED_FIX_TERRAIN','Semantic terrain authoring has no canonical reviewed-correction projection yet. It is blocked from native Playtest rather than approximated.'));
  const visualOnlyStamps=[],unsupportedStamps=[];
  for(const placement of d.stamps||[]){const stamp=stampCatalog?stampById(stampCatalog,placement?.variantId||placement?.stampId):null;if(stamp&&!(stamp.terrainFootprint||[]).length)visualOnlyStamps.push(placement);else unsupportedStamps.push(placement);}
  if(unsupportedStamps.length)issues.push(blocking('REVIEWED_FIX_STAMP','Terrain-bearing or unknown smart stamps have no canonical reviewed-correction projection yet. Exact visual-only stamp families can be promoted directly.',{ids:unsupportedStamps.map(row=>row.id)}));
  if (d.entities?.length) issues.push(blocking('REVIEWED_FIX_CUSTOM_ENTITY','Custom/new entity authoring has no faithful reviewed-room production projection. It is blocked from native Playtest.'));
  if (d.transitions?.length) issues.push(blocking('REVIEWED_FIX_TRANSITION','Custom room exits are level-authoring changes, not reviewed room corrections. Promote/reload them before native Playtest.'));
  /* Hero start is an intentionally transient playtest checkpoint. It is fed to
   * the native Rick solver but never exported into the reviewed room ledger. */
  void heroStartChanged;

  for (const row of d.sourceEntityOverrides || []) {
    const mark = Number(row.mark);
    const object = byMark.get(mark);
    const target = String(object?.semanticId || object?.sources?.classic?.ref || '');
    if (!object || !target) {
      issues.push(blocking('REVIEWED_FIX_SOURCE_TARGET',`Classic source mark ${mark} no longer resolves to a stable semantic entity.`));
      continue;
    }
    if (row.controllerEntity != null) {
      const expected = reviewedCorrectionCurrentValue(resolvedRoom, 'entity-type', target) || {};
      const controllerEntity = Number(row.controllerEntity), type = enemyTypeForEntity(controllerEntity);
      if (!type) issues.push(blocking('REVIEWED_FIX_ENEMY_TYPE',`Entity ${target} has unsupported enemy controller 0x${controllerEntity.toString(16)}.`));
      else additions.push(correction(resolvedRoom, occupied, 'entity-type', target, { class:String(expected.class || object.class || 'enemy'), controllerEntity }, `Level Editor enemy type/kind correction for classic mark ${mark}`, { expected }));
    }
    if (row.patrol) {
      const patrol = normalizeEnemyPatrol(row.patrol), effectiveEntity = Number(row.controllerEntity ?? object?.controller?.entity);
      if (!patrol) issues.push(blocking('REVIEWED_FIX_ENEMY_PATROL',`Entity ${target} has invalid bounded patrol geometry.`));
      else if (enemyTypeForEntity(effectiveEntity)?.id !== 'bounded-patrol') issues.push(blocking('REVIEWED_FIX_ENEMY_PATROL_TYPE',`Entity ${target} has a patrol draft but its effective enemy type is not bounded patrol.`));
      else {
        const expected = reviewedCorrectionCurrentValue(resolvedRoom, 'entity-patrol', target);
        additions.push(correction(resolvedRoom, occupied, 'entity-patrol', target, patrol, `Level Editor bounded patrol correction for classic mark ${mark}`, { expected }));
      }
    }
    const dx = Number(row.placementDx || 0), dy = Number(row.placementDy || 0);
    if (dx || dy) {
      const expected = reviewedCorrectionCurrentValue(resolvedRoom, 'entity-position', target);
      if (!Array.isArray(expected) || expected.length !== 2) issues.push(blocking('REVIEWED_FIX_POSITION',`Entity ${target} has no canonical effective position for a guarded placement correction.`));
      else additions.push(correction(resolvedRoom, occupied, 'entity-position', target, { position:[Number(expected[0]) + dx, Number(expected[1]) + dy] }, `Level Editor placement correction for classic mark ${mark}`, { expected }));
    }
    const stateDraft = row.stateVisualOffsetsByPn || {};
    const statePresentationDraft = normalizeStatePresentationOverrides(row);
    const occlusionLayer = ['normal','front'].includes(String(row.occlusionLayer || '')) ? String(row.occlusionLayer) : null;
    if (row.presentationPn != null || occlusionLayer || Object.keys(stateDraft).length || statePresentationDraft.length) {
      const expected = reviewedCorrectionCurrentValue(resolvedRoom, 'presentation', target) || {};
      const value = {};
      if (row.presentationPn != null) value.pn=Number(row.presentationPn);
      if (occlusionLayer) value.layer=occlusionLayer;
      if (Object.keys(stateDraft).length) {
        const base={ ...(expected?.stateVisualOffsetsByPn || {}) };
        for (const [key,delta] of Object.entries(stateDraft)) {
          const pn=Number(key), prior=base[key] || base[String(pn)] || [0,0];
          if (!Number.isInteger(pn) || pn < 0 || pn > 254 || !Array.isArray(delta) || delta.length !== 2) continue;
          const next=[Number(prior?.[0]||0)+Number(delta[0]||0),Number(prior?.[1]||0)+Number(delta[1]||0)];
          if (next[0] || next[1]) base[pn]=next; else delete base[pn];
        }
        value.stateVisualOffsetsByPn=base;
      }
      if (statePresentationDraft.length) value.statePresentations=mergeCanonicalStatePresentations(expected,statePresentationDraft);
      additions.push(correction(resolvedRoom, occupied, 'presentation', target, value, `Level Editor presentation correction for classic mark ${mark}`, { expected }));
    }
    if (row.projectileShooterPresentation) {
      const expected = reviewedCorrectionCurrentValue(resolvedRoom, 'projectile-shooter-presentation', target);
      if (!expected) issues.push(blocking('REVIEWED_FIX_PROJECTILE_SHOOTER',`Entity ${target} has no canonical projectile shooter topology.`));
      else additions.push(correction(resolvedRoom, occupied, 'projectile-shooter-presentation', target, clone(row.projectileShooterPresentation), `Level Editor projectile shooter presentation correction for classic mark ${mark}`, { expected }));
    }
    if (Array.isArray(row.projectileEmitterOrigin)) {
      const expected = reviewedCorrectionCurrentValue(resolvedRoom, 'projectile-emitter', target);
      if (!expected) issues.push(blocking('REVIEWED_FIX_PROJECTILE_EMITTER',`Entity ${target} has no canonical projectile emitter topology.`));
      else additions.push(correction(resolvedRoom, occupied, 'projectile-emitter', target, { origin:row.projectileEmitterOrigin.map(Number) }, `Level Editor projectile emitter correction for classic mark ${mark}`, { expected }));
    }
    if (['left','right'].includes(String(row.projectileLaneDirection || ''))) {
      const expected = reviewedCorrectionCurrentValue(resolvedRoom, 'projectile-lane', target);
      if (!expected) issues.push(blocking('REVIEWED_FIX_PROJECTILE_LANE',`Entity ${target} has no canonical projectile lane topology.`));
      else additions.push(correction(resolvedRoom, occupied, 'projectile-lane', target, { direction:String(row.projectileLaneDirection) }, `Level Editor projectile lane correction for classic mark ${mark}`, { expected }));
    }
    if (['left','right'].includes(String(row.movingPlatformDirection || ''))) {
      const expected = reviewedCorrectionCurrentValue(resolvedRoom, 'moving-platform-controller', target);
      additions.push(correction(resolvedRoom, occupied, 'moving-platform-controller', target, { parameters:{ direction:String(row.movingPlatformDirection) } }, `Level Editor moving-platform controller direction for classic mark ${mark}`, { expected }));
    }
    if (row.suppressed) {
      const expected = reviewedCorrectionCurrentValue(resolvedRoom, 'entity-suppression', target);
      additions.push(correction(resolvedRoom, occupied, 'entity-suppression', target, { suppressed:true }, `Level Editor source suppression for classic mark ${mark}`, { expected }));
    }
  }

  if(visualOnlyStamps.length){
    for(const row of resolveStampVisualOverrides({...d,stamps:visualOnlyStamps},stampCatalog)){
      const visual=visualRecord(row,resolvedRoom,mapDecoder);
      if(visual.error){issues.push(blocking('REVIEWED_FIX_STAMP_VISUAL',visual.error,{stampId:row.stampId||null,target:row.target||null}));continue;}
      const target=`room:${resolvedRoom.id}:stamp:${safe(row.stampPlacementId)}:${String(row.layer||'B').toUpperCase()}:${Number(row.target?.[0])}:${Number(row.target?.[1])}`;
      additions.push(correction(resolvedRoom,occupied,'visual-plane',target,visual.value,`Level Editor visual-only stamp ${row.stampFamilyId||row.stampId} at ${row.target?.[0]},${row.target?.[1]} ${String(row.layer||'B').toUpperCase()}`));
    }
  }

  for (const row of d.gameplayCollision || []) {
    const gx=Number(row?.g8?.[0]), gy=Number(row?.g8?.[1]), action=String(row?.action||'');
    if (!Number.isInteger(gx) || !Number.isInteger(gy) || !['open','one-way','climb-through','lethal'].includes(action)) {
      issues.push(blocking('REVIEWED_FIX_GAMEPLAY_COLLISION','Exact gameplay collision edit has invalid G8 coordinates or semantic.',{id:row?.id||null,g8:row?.g8||null,action}));
      continue;
    }
    const target=`room:${resolvedRoom.id}:collision:g8:${gx}:${gy}`;
    additions.push(correction(resolvedRoom,occupied,'terrain-cell',target,{action,g8Bounds:[gx,gy,1,1]},`Level Editor exact G8 collision correction at ${gx},${gy}`));
  }

  for (const row of d.presentationDepthOverrides || []) {
    const target = `room:${resolvedRoom.id}:presentation-depth:${String(row.id)}`;
    additions.push(correction(resolvedRoom, occupied, 'presentation-depth', target,
      { plane:String(row.plane), band:String(row.band), bounds:row.bounds.map(Number) },
      `Level Editor presentation-depth correction ${String(row.id)}`));
  }

  const smartBatches=new Map();
  for(const row of d.tiles||[]){const batchId=String(row?.smartScissors?.batchId||'');if(batchId){if(!smartBatches.has(batchId))smartBatches.set(batchId,[]);smartBatches.get(batchId).push(row)}}
  for(const [batchId,rows] of smartBatches){
    const batch=smartScissorsBatchRecords(rows,resolvedRoom,mapDecoder);
    if(batch.error){issues.push(blocking('REVIEWED_FIX_SMART_SCISSORS',batch.error,{batchId}));continue;}
    for(const record of batch.values){
      const target=`room:${resolvedRoom.id}:smart-scissors:${safe(batchId)}:${record.layer}`;
      const donor=`MD${String(Number(batch.meta.sourceMapId)).padStart(4,'0')} ${batch.meta.sourceBounds.join(',')}`;
      additions.push(correction(resolvedRoom,occupied,'visual-plane',target,record.value,`Smart Scissors scenery repair from ${donor}; seam score ${Number(batch.meta.score||0).toFixed(2)}`));
    }
  }

  for (const row of (d.tiles || []).filter(row=>!row?.smartScissors?.batchId)) {
    const visual = visualRecord(row, resolvedRoom, mapDecoder);
    if (visual.error) {
      issues.push(blocking('REVIEWED_FIX_VISUAL_CELL',visual.error,{ id:row.id || null, target:row.target || null }));
      continue;
    }
    const target = `room:${resolvedRoom.id}:visual:${String(row.layer || 'B').toUpperCase()}:${Number(row.target?.[0])}:${Number(row.target?.[1])}`;
    additions.push(correction(resolvedRoom, occupied, 'visual-plane', target, visual.value, `Level Editor visual-plane correction at ${row.target?.[0]},${row.target?.[1]} ${String(row.layer || 'B').toUpperCase()}`));
  }

  const ledger = { ...existing, corrections:[...existing.corrections, ...additions] };
  try { validateReviewedCorrectionLedger(ledger, { room:resolvedRoom, roomId:resolvedRoom.id, submap:resolvedRoom.submap, mapId:resolvedRoom.mapId }); }
  catch (error) { issues.push(blocking('REVIEWED_FIX_LEDGER',error.message)); }
  return Object.freeze({
    ledger:Object.freeze(clone(ledger)), corrections:Object.freeze(clone(additions)), issues:Object.freeze(issues),
    nativePlaytestSupported:!issues.some(issue => issue.blocking)
  });
}

export function exportReviewedFixesJson(document, options = {}) {
  const plan = createReviewedFixPlan(document, options);
  if (!plan.nativePlaytestSupported) throw new Error(plan.issues.map(issue => issue.message).join(' '));
  return JSON.stringify(plan.ledger, null, 2);
}
