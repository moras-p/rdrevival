import { COLLISION_PRESETS, normalizeLevelDocument } from './level-document.js';
import { normalizeStatePresentationOverrides } from './stateful-presentation.js';
import { effectiveSourcePlacementOffset } from './source-placement.js';
import { normalizeEnemyPatrol } from './enemy-authoring.js';
import { applyPresentationDepthClassEdits } from './presentation-depth-class-authoring.js';

export const EDITOR_COORDINATE_SPACES = Object.freeze({
  presentation:'rdx-g8-zero-based',
  terrain:'rdx-cell16-zero-based',
  collision:'native-mt-1-based',
  gameplayCollision:'rdx-g8-zero-based',
  nativeBorderedZero:'native-mt-bordered-zero-based',
  rdxWorld:'rdx-world-px',
  classicWorld:'classic-world-px',
  runtimeEntity:'runtime-entity-origin-px',
  transitionEntry:'native-xrick-entry-px'
});

const clone = value => JSON.parse(JSON.stringify(value));
const md = mapId => `MD${String(Number(mapId)).padStart(4,'0')}`;
const coordinate = (space, x, y) => Object.freeze({ space, x:Number(x), y:Number(y) });

function mappingContext(mapping = null) {
  if (!mapping) return null;
  const pixelOffset = mapping.pixelOffset || {};
  const runtimeViewportBias = mapping.runtimeViewportBias || {};
  return Object.freeze({
    xrickSubmap:Number(mapping.xrickSubmap),
    rdxMapId:Number(mapping.rdxMd),
    rdxMapName:mapping.rdxMdName || md(mapping.rdxMd),
    pixelOffset:Object.freeze({ dxPx:Number(pixelOffset.dxPx || 0), dyPx:Number(pixelOffset.dyPx || 0) }),
    runtimeViewportBias:Object.freeze({ dxPx:Number(runtimeViewportBias.dxPx || 0), dyPx:Number(runtimeViewportBias.dyPx || 0) }),
    alignmentScore:Number.isFinite(Number(mapping.alignmentScore)) ? Number(mapping.alignmentScore) : null
  });
}

function worldReferences(x, y, mapping = null) {
  const px=Number(x), py=Number(y), offset=mapping?.pixelOffset || {};
  const dx=Number(offset.dxPx || 0), dy=Number(offset.dyPx || 0);
  return Object.freeze({
    rdxWorldPx:Object.freeze([px,py]),
    classicWorldPx:Object.freeze([px-dx,py-dy]),
    runtimeEntityOrigin:Object.freeze([px,py]),
    coordinate:Object.freeze({
      rdx:coordinate(EDITOR_COORDINATE_SPACES.rdxWorld,px,py),
      classic:coordinate(EDITOR_COORDINATE_SPACES.classicWorld,px-dx,py-dy),
      runtime:coordinate(EDITOR_COORDINATE_SPACES.runtimeEntity,px,py)
    }),
    correspondence:mappingContext(mapping)
  });
}

export function createNativeDraftPlan(document, {
  visualCellOverrides = null,
  collisionOverrides = null,
  sourceMarks = [],
  logicDimensions = null,
  mapping = null,
  resolvedRoom = null,
  mapDecoder = null
} = {}) {
  const d=normalizeLevelDocument(document);
  const presentationRows=Array.isArray(visualCellOverrides) ? visualCellOverrides : d.tiles;
  const collisionRows=Array.isArray(collisionOverrides) ? collisionOverrides : d.collision;
  const plan={
    schema:'rdx.level_editor_native_draft_plan.v1',
    room:Object.freeze({ submap:Number(d.base.submap), mapId:Number(d.base.mapId), blank:!!d.base.blank }),
    mapping:mappingContext(mapping),
    presentation:[], presentationDepth:[], blankDescriptors:[], gameplayCollision:[], collision:[], alignmentOverrides:[], sourceSuppressions:[], sourceEntity:[], sourcePatrol:[], sourcePlacement:[], sourcePresentation:[], sourceStateVisual:[], sourceStatePresentation:[], sourceOcclusion:[], entities:[], transitions:[],
    hero:Object.freeze({ type:'hero-start', references:worldReferences(d.heroStart.x,d.heroStart.y,mapping) })
  };

  for (const row of presentationRows) {
    const gx=Number(row.target?.[0]), gy=Number(row.target?.[1]), layer=String(row.layer || 'B');
    if (!Number.isInteger(gx) || !Number.isInteger(gy)) continue;
    const source=row.source == null ? null : Object.freeze({
      mapId:Number(row.sourceMapId ?? d.base.mapId), layer:String(row.sourceLayer || layer),
      coordinate:coordinate(EDITOR_COORDINATE_SPACES.presentation,row.source[0],row.source[1])
    });
    plan.presentation.push(Object.freeze({
      id:`${md(d.base.mapId)}#presentation#rdx:g8:${gx}:${gy}:${layer}`,
      type:'presentation-cell',
      coordinate:coordinate(EDITOR_COORDINATE_SPACES.presentation,gx,gy),
      layer, operation:row.operation === 'clear' ? 'clear' : 'copy', source,
      authority:String(row.authority || 'manual'), mirrorX:!!row.mirrorX,
      runtime:Object.freeze({
        mapId:Number(d.base.mapId), targetX:gx, targetY:gy,
        sourceX:Number(row.source?.[0] ?? 0), sourceY:Number(row.source?.[1] ?? 0),
        targetPlane:layer === 'B' ? 0 : layer === 'A' ? 1 : 2,
        sourcePlane:row.sourceLayer === 'B' ? 0 : 1,
        clear:row.operation === 'clear', sourceMapId:Number(row.sourceMapId ?? d.base.mapId), mirrorX:!!row.mirrorX
      })
    }));
  }

  /* Shared depth-class edits are global authoring operations, but the native
   * Level Editor bridge deliberately exposes only exact room rectangles. For
   * live Simulate/Playtest parity, expand the effective shared classes to the
   * matching 8x8 cells of the current room before layering local overrides. */
  if (mapDecoder && resolvedRoom && (d.presentationDepthClassEdits || []).length) {
    const baseDepth=resolvedRoom?.layers?.presentationDepth || {classes:[]};
    const effectiveClasses=applyPresentationDepthClassEdits(baseDepth.classes || [], d.presentationDepthClassEdits || []);
    const rules=new Map();
    for(const row of effectiveClasses)for(const tile of row.globalTiles||[])rules.set(`${String(row.plane).toUpperCase()}:${Number(tile)}`,row);
    const topology=resolvedRoom?.layers?.structuralCorrections?.topology || null;
    const gxMax=Math.ceil(Number(d.bounds.width||0)/8),gyMax=Math.ceil(Number(d.bounds.height||0)/8);
    for(let gy=0;gy<gyMax;gy++)for(let gx=0;gx<gxMax;gx++)for(const plane of ['B','A']){
      let cell=null;try{cell=mapDecoder.inspectGridCell(Number(d.base.mapId),gx,gy,0,{topology});}catch{continue;}
      const visual=plane==='A'?cell?.visual?.foreground:cell?.visual?.background,globalTile=Number(visual?.resolution?.globalTile),rule=Number.isInteger(globalTile)?rules.get(`${plane}:${globalTile}`):null;
      if(!rule)continue;
      const band=String(rule.band),bounds=[gx*8,gy*8,8,8];
      plan.presentationDepth.push(Object.freeze({id:`shared:${rule.id}:${gx}:${gy}`,type:'presentation-depth',plane,band,bounds:Object.freeze(bounds),authority:'shared-class-draft',runtime:Object.freeze({submap:Number(d.base.submap),mapId:Number(d.base.mapId),plane:plane==='B'?0:1,band:band==='backdrop'?0:band==='midground'?1:2,x:bounds[0],y:bounds[1],width:8,height:8})}));
    }
  }

  for (const row of d.presentationDepthOverrides || []) {
    plan.presentationDepth.push(Object.freeze({
      id:String(row.id), type:'presentation-depth', plane:String(row.plane), band:String(row.band), bounds:Object.freeze(row.bounds.map(Number)),
      runtime:Object.freeze({ submap:Number(d.base.submap), mapId:Number(d.base.mapId), plane:String(row.plane) === 'B' ? 0 : 1,
        band:String(row.band) === 'backdrop' ? 0 : String(row.band) === 'midground' ? 1 : 2,
        x:Number(row.bounds[0]), y:Number(row.bounds[1]), width:Number(row.bounds[2]), height:Number(row.bounds[3]) })
    }));
  }

  const alignmentPlacementMarks=new Set();
  if (!d.base.blank && resolvedRoom && d.alignmentOverrides?.length) {
    const canonicalRegions=new Map((resolvedRoom?.layers?.alignment?.regions || []).map(region=>[String(region?.id || ''),region]));
    const objects=resolvedRoom?.layers?.semanticCorpus?.objects || [];
    for (const override of d.alignmentOverrides) {
      const regionId=String(override.id || ''), canonical=canonicalRegions.get(regionId);
      if (!canonical) continue;
      const type=String(canonical?.transform?.type || 'translate'), nextType=String(override?.transform?.type || 'translate');
      if (type !== 'translate' || nextType !== 'translate') continue;
      const dx=Number(override.transform?.dxPx || 0)-Number(canonical.transform?.dxPx || 0);
      const dy=Number(override.transform?.dyPx || 0)-Number(canonical.transform?.dyPx || 0);
      plan.alignmentOverrides.push(Object.freeze({
        type:'alignment-region', regionId, delta:Object.freeze([dx,dy]),
        canonical:Object.freeze({dxPx:Number(canonical.transform?.dxPx || 0),dyPx:Number(canonical.transform?.dyPx || 0)}),
        edited:Object.freeze({dxPx:Number(override.transform?.dxPx || 0),dyPx:Number(override.transform?.dyPx || 0)})
      }));
      if (!dx && !dy) continue;
      for (const object of objects) {
        if (String(object?.alignedBaseline?.authority || '') !== regionId) continue;
        const mark=Number(object?.sources?.classic?.mark);
        if (!Number.isInteger(mark) || mark < 0) continue;
        alignmentPlacementMarks.add(mark);
      }
    }
  }

  if (d.base.blank && logicDimensions) {
    const width=Math.max(0,Number(logicDimensions.width) | 0), height=Math.max(0,Number(logicDimensions.height) | 0);
    for (let y=0;y<height;y+=1) for (let x=0;x<width;x+=1) plan.blankDescriptors.push(Object.freeze({
      type:'blank-descriptor', coordinate:coordinate(EDITOR_COORDINATE_SPACES.nativeBorderedZero,x,y), runtime:Object.freeze({ logicX:x, logicY:y, mt:0, ml:0 })
    }));
  }

  for (const row of d.gameplayCollision || []) {
    const gx=Number(row?.g8?.[0]),gy=Number(row?.g8?.[1]),action=String(row?.action||''),kind=action==='open'?1:action==='one-way'?2:action==='lethal'?3:action==='climb-through'?5:0;
    if(!kind||!Number.isInteger(gx)||!Number.isInteger(gy))continue;
    plan.gameplayCollision.push(Object.freeze({id:`${md(d.base.mapId)}#collision#rdx:g8:${gx}:${gy}`,type:'gameplay-collision',coordinate:coordinate(EDITOR_COORDINATE_SPACES.gameplayCollision,gx,gy),action,authority:'manual',runtime:Object.freeze({submap:Number(d.base.submap),mapId:Number(d.base.mapId),g8X:gx,g8Y:gy,kind})}));
  }

  for (const row of collisionRows) {
    const lx=Number(row.logic?.[0]), ly=Number(row.logic?.[1]), preset=COLLISION_PRESETS[row.collision];
    if (!preset || !Number.isInteger(lx) || !Number.isInteger(ly)) continue;
    plan.collision.push(Object.freeze({
      id:`${md(d.base.mapId)}#collision#native-mt:${lx}:${ly}`,
      type:'collision', coordinate:coordinate(row.authority==='blank'?EDITOR_COORDINATE_SPACES.nativeBorderedZero:EDITOR_COORDINATE_SPACES.collision,lx,ly),
      collision:String(row.collision), authority:String(row.authority || 'manual'),
      descriptor:Object.freeze({ mt:Number(preset.mt), ml:Number(preset.ml) }),
      runtime:Object.freeze({ logicX:lx, logicY:ly, mt:Number(preset.mt), ml:Number(preset.ml) })
    }));
  }

  const suppress=new Set(d.base.blank ? sourceMarks.map(Number) : d.sourceEntityOverrides.filter(row=>row.suppressed).map(row=>Number(row.mark)));
  for (const mark of suppress) plan.sourceSuppressions.push(Object.freeze({ type:'source-suppression', sourceMark:Number(mark), runtime:Object.freeze({ submap:Number(d.base.submap), mark:Number(mark) }) }));
  const sourcePlacementMarks=new Set(alignmentPlacementMarks);
  for (const row of d.sourceEntityOverrides) {
    if (d.base.blank || row.suppressed) continue;
    const mark=Number(row.mark);
    sourcePlacementMarks.add(mark);
    if (row.controllerEntity != null) {
      const entityN=Number(row.controllerEntity);
      plan.sourceEntity.push(Object.freeze({ type:'source-entity', sourceMark:mark, controllerEntity:entityN, runtime:Object.freeze({ submap:Number(d.base.submap), mark, entityN }) }));
    }
    if (row.patrol) {
      const patrol=normalizeEnemyPatrol(row.patrol), effectiveEntity=Number(row.controllerEntity ?? 0);
      if (patrol) {
        const initialDx=patrol.initialDirection==='left'?-2:2;
        plan.sourcePatrol.push(Object.freeze({ type:'source-patrol', sourceMark:mark, patrol, runtime:Object.freeze({ submap:Number(d.base.submap), mark, distancePx:Number(patrol.distancePx), initialDx, startupLatencyTicks:Number(patrol.startupLatencyTicks) }) }));
      }
      void effectiveEntity;
    }
    if (row.presentationPn != null) plan.sourcePresentation.push(Object.freeze({ type:'source-presentation', sourceMark:Number(row.mark), presentationPn:Number(row.presentationPn), runtime:Object.freeze({ submap:Number(d.base.submap), mark:Number(row.mark), pn:Number(row.presentationPn) }) }));
    for (const [pn,offset] of Object.entries(row.stateVisualOffsetsByPn || {})) {
      const statePn=Number(pn), stateDx=Number(offset?.[0]||0), stateDy=Number(offset?.[1]||0);
      if (!Number.isInteger(statePn) || statePn < 0 || statePn > 254 || (!stateDx && !stateDy)) continue;
      plan.sourceStateVisual.push(Object.freeze({ type:'source-state-visual-offset', sourceMark:Number(row.mark), pn:statePn, offset:Object.freeze([stateDx,stateDy]), runtime:Object.freeze({ submap:Number(d.base.submap), mark:Number(row.mark), pn:statePn, dx:stateDx, dy:stateDy }) }));
    }
    for (const state of normalizeStatePresentationOverrides(row)) {
      const targetPn=Number(state.pn),offset=state.offset||[0,0],stateDx=Number(offset[0]||0),stateDy=Number(offset[1]||0);
      plan.sourceStatePresentation.push(Object.freeze({ type:'source-state-presentation', sourceMark:Number(row.mark), sourceKey:String(state.sourceKey), stateKey:String(state.stateKey), sourcePn:Number(state.sourcePn), targetPn:Number.isInteger(targetPn)?targetPn:null, offset:Object.freeze([stateDx,stateDy]), runtime:Object.freeze({ submap:Number(d.base.submap), mark:Number(row.mark), sourcePn:Number(state.sourcePn), targetPn:Number.isInteger(targetPn)?targetPn:null, dx:stateDx, dy:stateDy }) }));
    }
    if (['behind-midground','normal','front'].includes(String(row.occlusionLayer || ''))) plan.sourceOcclusion.push(Object.freeze({ type:'source-occlusion', sourceMark:Number(row.mark), layer:String(row.occlusionLayer), runtime:Object.freeze({ submap:Number(d.base.submap), mark:Number(row.mark), depth:String(row.occlusionLayer) }) }));
  }
  for (const mark of sourcePlacementMarks) {
    const row=d.sourceEntityOverrides.find(candidate=>Number(candidate.mark)===Number(mark)) || null;
    const { dx,dy }=effectiveSourcePlacementOffset(mark,row,{ document:d,resolvedRoom });
    if (dx || dy) plan.sourcePlacement.push(Object.freeze({ type:'source-placement', sourceMark:Number(mark), offset:Object.freeze([dx,dy]), runtime:Object.freeze({ submap:Number(d.base.submap), mark:Number(mark), dx, dy }) }));
  }

  for (const e of d.entities) {
    if (e.enabled === false) continue;
    plan.entities.push(Object.freeze({
      id:`${md(d.base.mapId)}#editor-entity#${e.id}`, type:'entity', sourceMark:e.sourceMark == null ? null : Number(e.sourceMark),
      references:worldReferences(e.x,e.y,mapping),
      patrol:Object.freeze({ coordinate:coordinate(EDITOR_COORDINATE_SPACES.rdxWorld,e.patrolX ?? e.x,e.patrolY ?? e.y) }),
      trigger:Object.freeze({ coordinate:coordinate(EDITOR_COORDINATE_SPACES.rdxWorld,e.triggerX,e.triggerY) }),
      runtime:Object.freeze({
        submap:Number(d.base.submap), entity:Number(e.entity), flags:Number(e.flags), x:Number(e.x), y:Number(e.y),
        patrolX:Number(e.patrolX ?? e.x), patrolY:Number(e.patrolY ?? e.y), triggerX:Number(e.triggerX), triggerY:Number(e.triggerY),
        latency:Number(e.latency), actionPeriod:Number(e.actionPeriod ?? 1), front:!!e.front, pn:Number(e.pn), mirrorX:!!e.mirrorX
      })
    }));
  }

  for (const t of d.transitions) plan.transitions.push(Object.freeze({
    id:String(t.id), type:'transition', side:String(t.side), contactRow:Number(t.contactRow), rowIn:Number(t.rowIn), targetSubmap:Number(t.targetSubmap),
    entry:Object.freeze({ coordinate:coordinate(EDITOR_COORDINATE_SPACES.transitionEntry,t.entryX,t.entryY), frow:Number(t.entryFrow), rowIn:Number(t.rowIn) }),
    runtime:Object.freeze({ submap:Number(d.base.submap), direction:t.side === 'left' ? -1 : 1, contactRow:Number(t.contactRow), targetSubmap:Number(t.targetSubmap), rowIn:Number(t.rowIn), entryX:Number(t.entryX), entryY:Number(t.entryY), entryFrow:Number(t.entryFrow) })
  }));

  return Object.freeze({ ...plan,
    presentation:Object.freeze(plan.presentation), presentationDepth:Object.freeze(plan.presentationDepth), blankDescriptors:Object.freeze(plan.blankDescriptors), gameplayCollision:Object.freeze(plan.gameplayCollision), collision:Object.freeze(plan.collision), alignmentOverrides:Object.freeze(plan.alignmentOverrides),
    sourceSuppressions:Object.freeze(plan.sourceSuppressions), sourceEntity:Object.freeze(plan.sourceEntity), sourcePatrol:Object.freeze(plan.sourcePatrol), sourcePlacement:Object.freeze(plan.sourcePlacement), sourcePresentation:Object.freeze(plan.sourcePresentation), sourceStateVisual:Object.freeze(plan.sourceStateVisual), sourceStatePresentation:Object.freeze(plan.sourceStatePresentation), sourceOcclusion:Object.freeze(plan.sourceOcclusion), entities:Object.freeze(plan.entities), transitions:Object.freeze(plan.transitions)
  });
}

export function applyNativeDraftPlan(plan, bridge) {
  if (!plan || plan.schema !== 'rdx.level_editor_native_draft_plan.v1') throw new Error('Unsupported Level Editor native draft plan');
  if (!bridge) throw new Error('Native draft bridge is required');
  bridge.clearMapEditorCollisionOverrides?.();bridge.clearMapEditorVisualOverrides();bridge.clearMapEditorPresentationDepthOverrides?.();bridge.clearMapEditorEntities();bridge.clearMapEditorTransitions();bridge.restoreNativeWorldOriginal();
  for (const row of plan.gameplayCollision || []) { const r=row.runtime;if(!bridge.addMapEditorCollisionOverride?.(r.submap,r.mapId,r.g8X,r.g8Y,r.kind))throw new Error(`RDX gameplay collision override rejected at ${r.g8X},${r.g8Y}`); }
  for (const row of plan.presentation) {
    const r=row.runtime;
    if (!bridge.addMapEditorVisualOverride(r.mapId,r.targetX,r.targetY,r.sourceX,r.sourceY,r.targetPlane,r.sourcePlane,r.clear,r.sourceMapId,r.mirrorX)) throw new Error(`RDX visual override rejected at ${r.targetX},${r.targetY}`);
  }
  for (const row of plan.presentationDepth || []) { const r=row.runtime;if(!bridge.addMapEditorPresentationDepthOverride?.(r.submap,r.mapId,r.x,r.y,r.width,r.height,r.plane,r.band))throw new Error(`RDX presentation depth override rejected at ${r.x},${r.y} ${r.width}x${r.height}`); }
  for (const row of plan.blankDescriptors) { const r=row.runtime;if(!bridge.setNativeWorldCell(r.logicX,r.logicY,r.mt,r.ml))throw new Error(`RDX descriptor reset rejected at ${r.logicX},${r.logicY}`); }
  for (const row of plan.collision) { const r=row.runtime;if(!bridge.setNativeWorldCell(r.logicX,r.logicY,r.mt,r.ml))throw new Error(`RDX descriptor edit rejected at ${r.logicX},${r.logicY}`); }
  for (const row of plan.sourceSuppressions) { const r=row.runtime;bridge.suppressMapEditorMark(r.submap,r.mark); }
  for (const row of plan.sourceEntity || []) { const r=row.runtime;if(!bridge.overrideMapEditorSourceEntity(r.submap,r.mark,r.entityN))throw new Error(`RDX source enemy type/kind override rejected for mark ${r.mark} → 0x${r.entityN.toString(16)}`); }
  for (const row of plan.sourcePatrol || []) { const r=row.runtime;if(!bridge.overrideMapEditorSourcePatrol(r.submap,r.mark,r.distancePx,r.initialDx,r.startupLatencyTicks))throw new Error(`RDX source patrol override rejected for mark ${r.mark}`); }
  for (const row of plan.sourcePlacement || []) { const r=row.runtime;if(!bridge.translateMapEditorSource(r.submap,r.mark,r.dx,r.dy))throw new Error(`RDX source placement override rejected for mark ${r.mark} → ${r.dx},${r.dy}`); }
  for (const row of plan.sourcePresentation) { const r=row.runtime;if(!bridge.overrideMapEditorSourcePn(r.submap,r.mark,r.pn))throw new Error(`RDX source presentation override rejected for mark ${r.mark} → PN ${r.pn}`); }
  for (const row of plan.sourceStateVisual || []) { const r=row.runtime;if(!bridge.overrideMapEditorSourceStateVisualOffset(r.submap,r.mark,r.pn,r.dx,r.dy))throw new Error(`RDX source state visual offset rejected for mark ${r.mark} PN ${r.pn}`); }
  for (const row of plan.sourceStatePresentation || []) { const r=row.runtime;if(r.targetPn!=null&&!bridge.overrideMapEditorSourceStatePn(r.submap,r.mark,r.sourcePn,r.targetPn))throw new Error(`RDX source state PN override rejected for mark ${r.mark} PN ${r.sourcePn} → ${r.targetPn}`);if((r.dx||r.dy)&&!bridge.overrideMapEditorSourceStateVisualOffset(r.submap,r.mark,r.sourcePn,r.dx,r.dy))throw new Error(`RDX source state offset rejected for mark ${r.mark} PN ${r.sourcePn}`); }
  for (const row of plan.sourceOcclusion || []) { const r=row.runtime;if(!bridge.overrideMapEditorSourceDepth(r.submap,r.mark,r.depth))throw new Error(`RDX source occlusion override rejected for mark ${r.mark}`); }
  for (const row of plan.entities) {
    const r=row.runtime,mark=bridge.addMapEditorEntity(r.submap,r.entity,r.flags,r.x,r.y,r.patrolX,r.patrolY,r.triggerX,r.triggerY,r.latency,r.actionPeriod,r.front,r.pn,r.mirrorX);
    if(!mark)throw new Error(`RDX entity registry rejected ${row.id}`);
  }
  for (const row of plan.transitions) { const r=row.runtime;if(!bridge.addMapEditorTransition(r.submap,r.direction,r.contactRow,r.targetSubmap,r.rowIn,r.entryX,r.entryY,r.entryFrow))throw new Error(`RDX transition registry rejected ${row.side} row 0x${r.contactRow.toString(16)} → SM${String(row.targetSubmap).padStart(2,'0')}`); }
  return true;
}

export function cloneNativeDraftPlan(plan) { return clone(plan); }
