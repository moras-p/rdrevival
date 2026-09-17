import { normalizeLevelDocument } from './level-document.js';

export const LEVEL_LAYER_DRAFT_SCHEMA = 'rdr.level_layer_draft.v1';

const clone = value => JSON.parse(JSON.stringify(value));
const sm = submap => `SM${Number(submap).toString(16).toUpperCase().padStart(2, '0')}`;

function semanticByMark(resolvedRoom) {
  return new Map((resolvedRoom?.layers?.semanticCorpus?.objects || []).flatMap(object => {
    const mark = Number(object?.sources?.classic?.mark);
    return Number.isFinite(mark) ? [[mark, object]] : [];
  }));
}

function adjustmentId(roomId, target, property, suffix = 'editor') {
  return `${roomId}.${String(target).replace(/[^a-zA-Z0-9_.-]+/g, '-')}.${property}.${suffix}`;
}

function alignmentOperations(d, resolvedRoom) {
  const roomId=sm(d.base.submap), file=`config/levels/rooms/${roomId}/alignment.json`;
  const canonical=new Map((resolvedRoom?.layers?.alignment?.regions || []).map(region=>[String(region?.id || ''),region]));
  return (d.alignmentOverrides || []).map(row => {
    const base=canonical.get(String(row.id)) || {};
    return {
      targetLayer:'C', kind:'alignment.upsert', targetFile:file,
      record:{
        ...clone(base),
        id:String(row.id),
        classicBoundsPx:row.classicBoundsPx.map(Number),
        rdxBoundsPx:row.rdxBoundsPx.map(Number),
        transform:{type:'translate',dxPx:Number(row.transform?.dxPx || 0),dyPx:Number(row.transform?.dyPx || 0)},
        status:String(row.status || 'reviewed'),
        authority:String(row.authority || 'level-editor-draft'),
        ...(row.confidence == null ? {} : {confidence:Number(row.confidence)})
      }
    };
  });
}

function sourceOverrideOperations(d, resolvedRoom) {
  const byMark = semanticByMark(resolvedRoom);
  const out = [];
  for (const row of d.sourceEntityOverrides || []) {
    const mark = Number(row.mark);
    const object = byMark.get(mark);
    const target = object?.semanticId || `${sm(d.base.submap)}.classic-mark-${mark}`;
    const dx = Number(row.placementDx || 0), dy = Number(row.placementDy || 0);
    if (dx || dy) out.push({
      targetLayer: 'F', kind: 'adjustment.upsert',
      targetFile: `config/levels/rooms/${sm(d.base.submap)}/adjustments.json`,
      record: {
        id: adjustmentId(sm(d.base.submap), target, 'position'), target, property: 'position',
        operation: { type: 'translate', dxPx: dx, dyPx: dy },
        provenance: 'Level Editor layered draft'
      },
      source: { mark }
    });
    if (row.presentationPn != null) out.push({
      targetLayer: 'E', kind: 'semantic.patch',
      targetFile: `config/levels/rooms/${sm(d.base.submap)}/entities.json`,
      semanticId: target,
      patch: { presentationPn: Number(row.presentationPn) },
      source: { mark }
    });
    if (row.suppressed) out.push({
      targetLayer: 'E', kind: 'semantic.suppress',
      targetFile: `config/levels/rooms/${sm(d.base.submap)}/entities.json`,
      semanticId: target,
      source: { mark }
    });
  }
  return out;
}

function geometryOperations(d) {
  const roomId = sm(d.base.submap), file = `config/levels/rooms/${roomId}/geometry-corrections.json`;
  const out = [];
  for (const row of d.tiles || []) out.push({ targetLayer:'D', kind:'geometry.upsert', targetFile:file, record:{
    id:`${roomId}.editor.presentation.${row.layer}.${row.target?.[0]}.${row.target?.[1]}`,
    type:'presentation-cell-override', authority:'level-editor-draft', layer:String(row.layer || 'B'),
    target:Array.isArray(row.target)?row.target.map(Number):null, source:Array.isArray(row.source)?row.source.map(Number):null,
    sourceMapId:Number(row.sourceMapId ?? d.base.mapId), sourceLayer:String(row.sourceLayer || row.layer || 'B'),
    action:String(row.operation || 'copy'), provenance:'Level Editor layered draft'
  }});
  for (const row of d.collision || []) out.push({ targetLayer:'D', kind:'geometry.upsert', targetFile:file, record:{
    id:`${roomId}.editor.collision.${row.logic?.[0]}.${row.logic?.[1]}`,
    type:'gameplay-cell-override', authority:'level-editor-draft', logic:Array.isArray(row.logic)?row.logic.map(Number):null,
    collision:String(row.collision || 'pass-through'), provenance:'Level Editor layered draft'
  }});
  for (const row of d.terrain || []) if (!row.stampOwner) out.push({ targetLayer:'D', kind:'geometry.upsert', targetFile:file, record:{
    id:`${roomId}.editor.terrain.${row.cell?.[0]}.${row.cell?.[1]}`,
    type:'semantic-terrain-override', authority:'level-editor-draft', cell:Array.isArray(row.cell)?row.cell.map(Number):null,
    terrainSet:String(row.terrainSet || ''), collisionMode:String(row.collisionMode || 'catalog'), seed:Number(row.seed || 0),
    provenance:'Level Editor layered draft'
  }});
  for (const row of d.terrainRelations || []) out.push({ targetLayer:'D', kind:'geometry.upsert', targetFile:file, record:{
    id:String(row.id), type:'semantic-terrain-relation', authority:'level-editor-draft', relation:clone(row), provenance:'Level Editor layered draft'
  }});
  for (const row of d.stamps || []) out.push({ targetLayer:'D', kind:'geometry.upsert', targetFile:file, record:{
    id:String(row.id), type:'semantic-stamp', authority:'level-editor-draft', stamp:clone(row), provenance:'Level Editor layered draft'
  }});
  for (const row of d.systemPatchRemovals || []) out.push({ targetLayer:'D', kind:'geometry.remove', targetFile:file,
    id:String(row.patchId), sourceKey:String(row.sourceKey || ''), provenance:'Level Editor layered draft' });
  return out;
}

function semanticOperations(d) {
  const roomId = sm(d.base.submap), file = `config/levels/rooms/${roomId}/entities.json`;
  const out=[];
  for (const row of d.entities || []) out.push({ targetLayer:'E', kind:'semantic.upsert', targetFile:file, record:{
    semanticId:`${roomId}.editor.${row.id}`, class:String(row.category || 'actor'),
    sources: row.sourceMark == null ? { editor:{ id:String(row.id) } } : { classic:{ mark:Number(row.sourceMark) }, editor:{ id:String(row.id) } },
    controller:{ authority:'xrick-native-entity', entity:Number(row.entity) },
    baseline:{ editorPosition:[Number(row.x),Number(row.y)] },
    presentation:{ owner:'rdx', pnByState:{ snapshot:Number(row.pn), simulated:Number(row.pn) }, mirrorX:!!row.mirrorX, mirrorY:!!row.mirrorY, layer:row.front?'front':'normal' },
    editorAuthoring:{ name:String(row.name || ''), patrol:[Number(row.patrolX),Number(row.patrolY)], trigger:[Number(row.triggerX),Number(row.triggerY)], flags:Number(row.flags), latency:Number(row.latency), actionPeriod:Number(row.actionPeriod), frameIndex:Number(row.frameIndex ?? -1), enabled:row.enabled!==false },
    relationships:[], authority:'level-editor-draft'
  }});
  if (d.heroStart) out.push({ targetLayer:'E', kind:'room-anchor.upsert', targetFile:file, anchor:'start', value:[Number(d.heroStart.x),Number(d.heroStart.y)] });
  for (const row of d.transitions || []) out.push({ targetLayer:'E', kind:'room-exit.upsert', targetFile:file, record:clone(row) });
  return out;
}

export function createLayeredDraft(document, { resolvedRoom = null, exportedAt = null } = {}) {
  const d = normalizeLevelDocument(document);
  const operations = [
    ...alignmentOperations(d, resolvedRoom),
    ...geometryOperations(d),
    ...semanticOperations(d),
    ...sourceOverrideOperations(d, resolvedRoom)
  ];
  return {
    schema: LEVEL_LAYER_DRAFT_SCHEMA,
    version: 1,
    exportedAt: exportedAt || new Date().toISOString(),
    room: { submap:Number(d.base.submap), mapId:Number(d.base.mapId), id:sm(d.base.submap) },
    resolvedBaseFingerprint: resolvedRoom?.fingerprints?.resolved || null,
    semantics: {
      C:'reviewed local Classic/xrick → RDX regional alignment',
      D:'structural corrections to decoded RDX geometry/presentation',
      E:'shared semantic corpus and room anchors/relationships',
      F:'typed residual placement and bounds adjustments'
    },
    operations
  };
}

export function exportLayeredDraftJson(document, options) {
  return JSON.stringify(createLayeredDraft(document, options), null, 2);
}
