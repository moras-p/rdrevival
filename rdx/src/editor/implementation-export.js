import { normalizeLevelDocument } from './level-document.js';
import { EDITOR_COORDINATE_SPACES, cloneNativeDraftPlan } from './native-draft-plan.js';

export const LEVEL_EDITOR_IMPLEMENTATION_SCHEMA = 'rdx.level_editor_implementation.v1';
export const LEVEL_EDITOR_CHANGES_SCHEMA = 'rdx.level_editor_changes.v1';

const clone = value => JSON.parse(JSON.stringify(value));
const md = mapId => `MD${String(Number(mapId)).padStart(4,'0')}`;
const coordinate = (space, x, y) => ({ space, x:Number(x), y:Number(y) });

function authoredChanges(d, nativeDraftPlan) {
  const entityPlanById=new Map((nativeDraftPlan?.entities || []).map(row=>[String(row.id),row]));
  const out=[];
  for (const row of d.terrain || []) out.push({ id:`${md(d.base.mapId)}#terrain#cell16:${row.cell[0]}:${row.cell[1]}`, type:'terrain', coordinate:coordinate(EDITOR_COORDINATE_SPACES.terrain,row.cell[0],row.cell[1]), authored:clone(row) });
  for (const row of d.terrainRelations || []) out.push({ id:String(row.id), type:'terrain-relation', coordinate:{ space:EDITOR_COORDINATE_SPACES.terrain, anchor:[Number(row.anchor?.[0]),Number(row.anchor?.[1])], end:[Number(row.end?.[0]),Number(row.end?.[1])] }, authored:clone(row) });
  for (const row of d.stamps || []) out.push({ id:String(row.id), type:'stamp', coordinate:coordinate(EDITOR_COORDINATE_SPACES.terrain,row.cell?.[0],row.cell?.[1]), authored:clone(row) });
  for (const row of d.tiles || []) out.push({ id:`${md(d.base.mapId)}#presentation#rdx:g8:${row.target[0]}:${row.target[1]}:${row.layer}`, type:'presentation-cell', coordinate:coordinate(EDITOR_COORDINATE_SPACES.presentation,row.target[0],row.target[1]), plane:String(row.layer), sourceReference:row.source?{ mapId:Number(row.sourceMapId ?? d.base.mapId), plane:String(row.sourceLayer || row.layer), coordinate:coordinate(EDITOR_COORDINATE_SPACES.presentation,row.source[0],row.source[1]) }:null, authored:clone(row) });
  for (const row of d.collision || []) out.push({ id:`${md(d.base.mapId)}#collision#native-mt:${row.logic[0]}:${row.logic[1]}`, type:'collision', coordinate:coordinate(EDITOR_COORDINATE_SPACES.collision,row.logic[0],row.logic[1]), authored:clone(row) });
  for (const row of d.gameplayCollision || []) out.push({ id:`${md(d.base.mapId)}#collision#rdx:g8:${row.g8[0]}:${row.g8[1]}`, type:'gameplay-collision', coordinate:coordinate(EDITOR_COORDINATE_SPACES.gameplayCollision,row.g8[0],row.g8[1]), authored:clone(row) });
  for (const row of d.presentationDepthClassEdits || []) out.push({ id:`presentation-depth-class#${row.plane}:${row.globalTile}`, type:'presentation-depth-class', plane:String(row.plane), globalTile:Number(row.globalTile), action:String(row.action), ...(row.band?{band:String(row.band)}:{}), authored:clone(row) });
  for (const row of d.presentationDepthOverrides || []) out.push({ id:`${md(d.base.mapId)}#presentation-depth#${row.id}`, type:'presentation-depth', plane:String(row.plane), band:String(row.band), bounds:row.bounds.map(Number), authored:clone(row) });
  for (const row of d.entities || []) { const id=`${md(d.base.mapId)}#editor-entity#${row.id}`,resolved=entityPlanById.get(id);out.push({ id, type:'entity', coordinate:coordinate(EDITOR_COORDINATE_SPACES.rdxWorld,row.x,row.y), sourceMark:row.sourceMark == null ? null : Number(row.sourceMark), references:resolved?clone(resolved.references):null, patrol:resolved?clone(resolved.patrol):null, trigger:resolved?clone(resolved.trigger):null, authored:clone(row) }); }
  for (const row of d.sourceEntityOverrides || []) out.push({ id:`${md(d.base.mapId)}#source-mark#${row.mark}`, type:'source-entity-override', sourceMark:Number(row.mark), authored:clone(row) });
  for (const row of d.systemPatchRemovals || []) out.push({ id:`${md(d.base.mapId)}#system-patch-removal#${row.patchId}`, type:'system-patch-removal', operation:'remove', collection:String(row.collection), patchId:String(row.patchId), sourceKey:String(row.sourceKey || ''), authored:clone(row) });
  for (const row of d.transitions || []) out.push({ id:String(row.id), type:'transition', coordinate:coordinate(EDITOR_COORDINATE_SPACES.transitionEntry,row.entryX,row.entryY), authored:clone(row) });
  return out;
}

function compactChanges(d, entityContexts = null) {
  const out=[];
  for (const row of d.terrain || []) if (!row.stampOwner) out.push({op:'terrain',cell:[...row.cell],terrainSet:row.terrainSet,seed:Number(row.seed),collisionMode:row.collisionMode});
  for (const row of d.terrainRelations || []) out.push({op:'terrain-relation',type:row.type,terrainSet:row.terrainSet,anchor:[...row.anchor],end:[...row.end],...(row.prototypeId?{prototypeId:row.prototypeId}:{})});
  for (const row of d.stamps || []) out.push({op:'stamp',stampId:row.stampId,cell:[...row.cell],...(row.familyId?{familyId:row.familyId}:{}),mirrorX:!!row.mirrorX,terrainMode:row.terrainMode});
  for (const row of d.tiles || []) out.push({op:'presentation-cell',target:[...row.target],plane:row.layer,...(row.operation==='clear'?{clear:true}:{sourceMapId:Number(row.sourceMapId ?? d.base.mapId),source:[...row.source],sourcePlane:row.sourceLayer || row.layer})});
  for (const row of d.collision || []) out.push({op:'collision',logic:[...row.logic],collision:row.collision});
  for (const row of d.gameplayCollision || []) out.push({op:'gameplay-collision',g8:[...row.g8],action:row.action});
  for (const row of d.presentationDepthClassEdits || []) out.push({op:'presentation-depth-class',plane:String(row.plane),globalTile:Number(row.globalTile),action:String(row.action),...(row.band?{band:String(row.band)}:{})});
  for (const row of d.presentationDepthOverrides || []) out.push({op:'presentation-depth',id:String(row.id),plane:String(row.plane),band:String(row.band),bounds:row.bounds.map(Number)});
  for (const row of d.entities || []) { const context=entityContexts?.[String(row.id)] || null;out.push({op:'entity',id:row.id,entity:Number(row.entity),name:row.name,category:row.category,position:[Number(row.x),Number(row.y)],patrol:[Number(row.patrolX),Number(row.patrolY)],trigger:[Number(row.triggerX),Number(row.triggerY)],flags:Number(row.flags),latency:Number(row.latency),actionPeriod:Number(row.actionPeriod),pn:Number(row.pn),presentation:{pn:Number(row.pn),pairedWithPosition:true},frameIndex:Number(row.frameIndex ?? -1),front:!!row.front,mirrorX:!!row.mirrorX,mirrorY:!!row.mirrorY,enabled:row.enabled!==false,...(row.sourceMark!=null?{sourceMark:Number(row.sourceMark)}:{}),...(context?{editorContext:clone(context)}:{})}); }
  for (const row of d.sourceEntityOverrides || []) { const dx=Number(row.placementDx||0),dy=Number(row.placementDy||0);out.push({op:'source-entity',mark:Number(row.mark),...(row.suppressed?{suppressed:true}:{}),...(row.presentationPn!=null?{presentationPn:Number(row.presentationPn)}:{}),...(dx||dy?{placementOffset:[dx,dy]}:{})}); }
  for (const row of d.systemPatchRemovals || []) out.push({op:'remove-system-patch',collection:row.collection,patchId:row.patchId,...(row.sourceKey?{sourceKey:row.sourceKey}:{}),...(row.action?{action:row.action}:{}),...(row.layer?{layer:row.layer}:{}),...(row.bounds?{bounds:[...row.bounds]}:{})});
  for (const row of d.transitions || []) out.push({op:'transition',side:row.side,targetSubmap:Number(row.targetSubmap),entry:[Number(row.entryX),Number(row.entryY)],entryFrow:Number(row.entryFrow)});
  return out;
}

export function createImplementationExport(document, { nativeDraftPlan, exportedAt = null } = {}) {
  const d=normalizeLevelDocument(document);
  if (!nativeDraftPlan || nativeDraftPlan.schema !== 'rdx.level_editor_native_draft_plan.v1') throw new Error('Implementation export requires the production native draft plan');
  return {
    schema:LEVEL_EDITOR_IMPLEMENTATION_SCHEMA,
    editorDocumentSchema:d.schema,
    editorDocumentVersion:d.version,
    exportedAt:exportedAt || new Date().toISOString(),
    room:{ submap:Number(d.base.submap), mapId:Number(d.base.mapId), stableMapId:md(d.base.mapId), blank:!!d.base.blank },
    coordinateSpaces:{
      [EDITOR_COORDINATE_SPACES.presentation]:'Zero-based 8×8 RDX presentation grid; plane is explicit per presentation item.',
      [EDITOR_COORDINATE_SPACES.terrain]:'Zero-based 16×16 borderless RDX visual/semantic cell grid.',
      [EDITOR_COORDINATE_SPACES.collision]:'One-based bordered native MT/ML logic coordinates used only by advanced descriptor collision changes.',
      [EDITOR_COORDINATE_SPACES.gameplayCollision]:'Zero-based exact 8×8 RDX gameplay-cell coordinates used by canonical collision corrections.',
      [EDITOR_COORDINATE_SPACES.nativeBorderedZero]:'Zero-based bordered native MT/ML array coordinate used only by blank-room reset operations in the resolved production plan.',
      [EDITOR_COORDINATE_SPACES.rdxWorld]:'RDX descriptor-world pixels used by editor placement.',
      [EDITOR_COORDINATE_SPACES.classicWorld]:'Classic world pixels resolved by subtracting the reviewed room correspondence offset.',
      [EDITOR_COORDINATE_SPACES.runtimeEntity]:'Exact synthetic entity origin passed to the native Level Editor registry.',
      [EDITOR_COORDINATE_SPACES.transitionEntry]:'Native xrick target-room entry pixel coordinate.'
    },
    editorDocument:clone(d),
    authoredChanges:authoredChanges(d,nativeDraftPlan),
    heroStart:clone(nativeDraftPlan.hero),
    resolvedProductionPlan:cloneNativeDraftPlan(nativeDraftPlan)
  };
}

export function createChangesExport(document, { exportedAt = null, heroStartChanged = false, entityContexts = null } = {}) {
  const d=normalizeLevelDocument(document);
  return {
    schema:LEVEL_EDITOR_CHANGES_SCHEMA,
    editorDocumentSchema:d.schema,editorDocumentVersion:d.version,
    exportedAt:exportedAt || new Date().toISOString(),
    room:{submap:Number(d.base.submap),mapId:Number(d.base.mapId),stableMapId:md(d.base.mapId),blank:!!d.base.blank},
    coordinates:{g8:EDITOR_COORDINATE_SPACES.presentation,cell16:EDITOR_COORDINATE_SPACES.terrain,logic:EDITOR_COORDINATE_SPACES.collision,world:EDITOR_COORDINATE_SPACES.rdxWorld,entry:EDITOR_COORDINATE_SPACES.transitionEntry},
    coordinateSemantics:{
      entityPosition:'Entity position/patrol are native xrick entity contact points expressed in RDX-world pixels; trigger is the activator top-left. These are not sprite draw origins.',
      entityPresentation:'For reviewed entities, PN is paired with position. Preserve the exported PN together with the coordinates; substituting a different PN requires visual re-alignment because frame dimensions/anchors may differ.',
      entityEditorContext:'editorContext is deterministic frame-0 diagnostic evidence: productionBaseline is the source state Convert started from, reviewedPlacement is what the editor actually drew, and deltaFromProduction is their authored contact/trigger/PN delta.',
      sourcePlacement:'source-entity placementOffset is an RDX-world pixel translation of the existing production actor trajectory. It preserves native controller identity, path shape/period and PN unless those are separately overridden.',
      gameplayCollision:'gameplay-collision targets one exact 8×8 gameplay cell and is canonical for Reviewed Fix promotion; collision targets an advanced 16×16 MT/ML descriptor and may project differently by quadrant.'
    },
    ...(heroStartChanged?{heroStart:{world:[Number(d.heroStart.x),Number(d.heroStart.y)]}}:{}),
    changes:compactChanges(d,entityContexts)
  };
}

export function exportImplementationJson(document, options) { return JSON.stringify(createImplementationExport(document,options),null,2); }
export function exportChangesJson(document, options) { return JSON.stringify(createChangesExport(document,options),null,2); }

export function implementationNativeDraftPlan(payload) {
  if (!payload || payload.schema !== LEVEL_EDITOR_IMPLEMENTATION_SCHEMA) throw new Error(`Unsupported implementation export schema ${payload?.schema || 'missing'}`);
  const plan=payload.resolvedProductionPlan;
  if (!plan || plan.schema !== 'rdx.level_editor_native_draft_plan.v1') throw new Error('Implementation export lacks a native draft plan');
  return clone(plan);
}

export function implementationEditorDocument(payload) {
  if (!payload || payload.schema !== LEVEL_EDITOR_IMPLEMENTATION_SCHEMA) throw new Error(`Unsupported implementation export schema ${payload?.schema || 'missing'}`);
  if (!payload.editorDocument) throw new Error('Implementation export lacks the editor document');
  return normalizeLevelDocument(payload.editorDocument);
}
