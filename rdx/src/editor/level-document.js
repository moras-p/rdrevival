import { COLLISION_PRESETS } from '../collision/descriptor-semantics.js';
import { normalizeSystemPatchRemoval } from './system-patch-removals.js';
import { sourceOcclusionLayer, sourcePlacementOffset, sourceStateVisualOffsets } from './source-placement.js';
import { normalizeStatePresentationOverrides } from './stateful-presentation.js';
import { isClassicEnemyEntity, normalizeEnemyPatrol } from './enemy-authoring.js';
import { validatePresentationDepthOverrides } from '../levels/presentation-depth.js';
import { normalizePresentationDepthClassEdits } from './presentation-depth-class-authoring.js';

export { COLLISION_PRESETS };
export const LEVEL_EDITOR_SCHEMA = 'rdx.level_editor_document.v1';
export const LEVEL_EDITOR_VERSION = '2.1.104';
export const ENTITY_FLAGS = Object.freeze({
  once:0x01, stopRick:0x02, lethalRestart:0x04, lethalInitially:0x08,
  triggerBomb:0x10, triggerBullet:0x20, triggerStop:0x40, triggerRick:0x80
});
const clone = value => JSON.parse(JSON.stringify(value));
const id = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
const finite = value => Number.isFinite(Number(value));
const integer = value => Number.isInteger(Number(value));

export function createLevelDocument({ name='Untitled level', submap=0, mapId=3, width=320, height=896, blank=false, heroStart=null }={}) {
  return {
    schema:LEVEL_EDITOR_SCHEMA, version:LEVEL_EDITOR_VERSION, collisionCoordinates:'native-mt-1-based',
    id:id('level'), name:String(name), createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(),
    base:{ submap:Number(submap), mapId:Number(mapId), blank:!!blank },
    bounds:{ x:0,y:0,width:Number(width),height:Number(height) },
    heroStart:heroStart ? { x:Number(heroStart.x), y:Number(heroStart.y) } : { x:40,y:80 },
    layers:{ background:{visible:true,locked:false}, gameplay:{visible:true,locked:false}, entities:{visible:true,locked:false}, foreground:{visible:true,locked:false} },
    terrain:[], terrainRelations:[], stamps:[], tiles:[], gameplayCollision:[], collision:[], entities:[], presentationDepthOverrides:[], presentationDepthClassEdits:[], alignmentOverrides:[], sourceEntityOverrides:[], systemPatchRemovals:[], transitions:[], metadata:{ notes:'', tags:[], music:'inherit' },
    settings:{ gridSize:8, snap:true, simulatePreview:true, soundPlaytest:true, invulnerablePlaytest:true, infiniteResources:true, renderScale:2, terrainCollisionMode:'catalog', terrainAssistAmbiguity:true, rawRdxRegions:[] }
  };
}

export class LevelDocumentStore {
  constructor(document, {historyLimit=100}={}) {
    this.historyLimit=historyLimit; this.undoStack=[]; this.redoStack=[]; this.listeners=new Set();
    this.document=normalizeLevelDocument(document);
  }
  subscribe(fn){ this.listeners.add(fn); return ()=>this.listeners.delete(fn); }
  emit(reason='change'){ this.document.updatedAt=new Date().toISOString(); for(const fn of this.listeners) fn(this.document,reason); }
  snapshot(){ return clone(this.document); }
  transact(reason, fn){ const before=this.snapshot(); fn(this.document); this.undoStack.push(before); if(this.undoStack.length>this.historyLimit)this.undoStack.shift(); this.redoStack=[]; this.emit(reason); return this.document; }
  replace(document,reason='replace'){ this.undoStack.push(this.snapshot()); this.document=normalizeLevelDocument(document); this.redoStack=[]; this.emit(reason); }
  undo(){ if(!this.undoStack.length)return false; this.redoStack.push(this.snapshot()); this.document=this.undoStack.pop(); this.emit('undo'); return true; }
  redo(){ if(!this.redoStack.length)return false; this.undoStack.push(this.snapshot()); this.document=this.redoStack.pop(); this.emit('redo'); return true; }
  canUndo(){return this.undoStack.length>0;} canRedo(){return this.redoStack.length>0;}
  tileAt(x,y,layer){ return this.document.tiles.find(t=>t.target[0]===x&&t.target[1]===y&&t.layer===layer)||null; }
  paintTile(x,y,{layer='B',sourceMapId=this.document.base.mapId,sourceX=x,sourceY=y,sourceLayer=layer,operation='copy',smartScissors=null}={}){
    if(!integer(x)||!integer(y))throw new Error('Tile coordinates must be integers');
    const key=t=>t.target[0]===Number(x)&&t.target[1]===Number(y)&&t.layer===layer;
    const tiles=this.document.tiles; const at=tiles.findIndex(key); if(at>=0)tiles.splice(at,1);
    tiles.push({id:id('tile'),target:[Number(x),Number(y)],layer,operation,source:operation==='clear'?null:[Number(sourceX),Number(sourceY)],sourceMapId:Number(sourceMapId),sourceLayer,...(smartScissors?{smartScissors:clone(smartScissors)}:{})});
  }
  eraseTile(x,y,layer){ this.document.tiles=this.document.tiles.filter(t=>!(t.target[0]===x&&t.target[1]===y&&(layer==='AB'||t.layer===layer))); }
  terrainAt(x,y){ return this.document.terrain.find(t=>t.cell[0]===Number(x)&&t.cell[1]===Number(y))||null; }
  paintTerrain(x,y,{terrainSet,seed=null,collisionMode=this.document.settings?.terrainCollisionMode||'catalog',stampOwner=null}={}){
    if(!integer(x)||!integer(y))throw new Error('Terrain coordinates must be integers');
    if(!terrainSet)throw new Error('A terrain set is required');
    this.document.terrain=this.document.terrain.filter(t=>!(t.cell[0]===Number(x)&&t.cell[1]===Number(y)));
    const stableSeed=integer(seed)?Number(seed):(((Number(x)&0xffff)<<16)^(Number(y)&0xffff)^String(terrainSet).split('').reduce((h,c)=>Math.imul(h^c.charCodeAt(0),16777619)>>>0,2166136261))>>>0;
    this.document.terrain.push({id:id('terrain'),cell:[Number(x),Number(y)],terrainSet:String(terrainSet),seed:stableSeed,collisionMode:['catalog','visual-only','preserve'].includes(String(collisionMode))?String(collisionMode):'catalog',...(stampOwner?{stampOwner:String(stampOwner)}:{})});
  }
  eraseTerrain(x,y){ this.document.terrain=this.document.terrain.filter(t=>!(t.cell[0]===Number(x)&&t.cell[1]===Number(y))); this.document.terrainRelations=this.document.terrainRelations.filter(r=>!(r.type==='support'&&r.anchor?.[0]===Number(x)&&r.anchor?.[1]===Number(y))); }
  upsertTerrainSupport(anchorX,anchorY,{terrainSet,endY,prototypeId=null,seed=null}={}){
    if(!integer(anchorX)||!integer(anchorY)||!integer(endY)||!terrainSet)throw new Error('Support relation requires an integer anchor/end and terrain set');
    const x=Number(anchorX),y=Number(anchorY),ey=Number(endY);
    this.document.terrainRelations=this.document.terrainRelations.filter(r=>!(r.type==='support'&&r.terrainSet===String(terrainSet)&&r.anchor?.[0]===x&&r.anchor?.[1]===y));
    if(ey<=y)return null;
    const relation={id:id('terrain-relation'),type:'support',terrainSet:String(terrainSet),anchor:[x,y],end:[x,ey],direction:'down',seed:integer(seed)?Number(seed):(((x&0xffff)<<16)^(y&0xffff)^0x53555050)>>>0,...(prototypeId?{prototypeId:String(prototypeId)}:{})};
    this.document.terrainRelations.push(relation);return relation;
  }
  removeTerrainRelation(relationId){ this.document.terrainRelations=this.document.terrainRelations.filter(r=>r.id!==relationId); }
  addStamp(stampId,x,y,{terrainMode='adapt',familyId=null,variantId=null,mirrorX=false,contextCell=null}={}){
    if(!stampId||!integer(x)||!integer(y))throw new Error('Stamp id and integer cell coordinates are required');
    const resolvedVariant=String(variantId||stampId);
    const placement={id:id('stamp'),stampId:resolvedVariant,variantId:resolvedVariant,...(familyId?{familyId:String(familyId)}:{}),cell:[Number(x),Number(y)],contextCell:Array.isArray(contextCell)?contextCell.slice(0,2).map(Number):[Number(x),Number(y)],mirrorX:!!mirrorX,terrainMode:['adapt','visual-only'].includes(String(terrainMode))?String(terrainMode):'adapt',terrainRestore:[]};
    this.document.stamps.push(placement);return placement;
  }
  removeStamp(stampId){ const placement=this.document.stamps.find(s=>s.id===stampId);this.document.stamps=this.document.stamps.filter(s=>s.id!==stampId);const owned=new Set(this.document.terrain.filter(t=>t.stampOwner===stampId).map(t=>`${t.cell[0]},${t.cell[1]}`));this.document.terrain=this.document.terrain.filter(t=>t.stampOwner!==stampId);for(const restore of placement?.terrainRestore||[]){const k=`${restore.cell[0]},${restore.cell[1]}`;if(!owned.has(k)||!restore.terrain)continue;if(restore.terrain.stampOwner&&!this.document.stamps.some(s=>s.id===restore.terrain.stampOwner))continue;this.document.terrain=this.document.terrain.filter(t=>!(t.cell[0]===restore.cell[0]&&t.cell[1]===restore.cell[1]));this.document.terrain.push(clone(restore.terrain));} }
  setGameplayCollision(g8X,g8Y,action='original'){
    if(!['original','open','one-way','climb-through','lethal'].includes(String(action)))throw new Error(`Unknown gameplay collision action ${action}`);
    const gx=Number(g8X),gy=Number(g8Y);if(!integer(gx)||!integer(gy))throw new Error('Gameplay collision coordinates must be integers');
    this.document.gameplayCollision=this.document.gameplayCollision.filter(c=>!(Number(c.g8?.[0])===gx&&Number(c.g8?.[1])===gy));
    if(action!=='original')this.document.gameplayCollision.push({id:id('gameplay-collision'),g8:[gx,gy],action:String(action)});
  }
  setCollision(logicX,logicY,collision='original'){
    if(!(collision in COLLISION_PRESETS))throw new Error(`Unknown collision preset ${collision}`);
    this.document.collision=this.document.collision.filter(c=>!(c.logic[0]===logicX&&c.logic[1]===logicY));
    if(collision!=='original'){ const p=COLLISION_PRESETS[collision]; this.document.collision.push({id:id('collision'),logic:[Number(logicX),Number(logicY)],collision,mt:p.mt,ml:p.ml}); }
  }
  addEntity(data={}){
    const entity={id:id('entity'),entity:Number(data.entity??4),name:String(data.name||`Entity 0x${Number(data.entity??4).toString(16).padStart(2,'0').toUpperCase()}`),category:String(data.category||'actor'),x:Number(data.x??32),y:Number(data.y??64),patrolX:Number(data.patrolX??data.x??32),patrolY:Number(data.patrolY??data.y??64),triggerX:Number(data.triggerX??data.x??32),triggerY:Number(data.triggerY??data.y??64),flags:Number(data.flags??0)&0xff,latency:Number(data.latency??0)&0xff,actionPeriod:Math.max(1,Math.min(255,Number(data.actionPeriod??1)|0)),pn:Number(data.pn??-1),frameIndex:Number.isInteger(Number(data.frameIndex))?Number(data.frameIndex):-1,front:!!data.front,mirrorX:!!data.mirrorX,mirrorY:!!data.mirrorY,enabled:data.enabled!==false,...(data.sourceMark!=null&&integer(data.sourceMark)&&Number(data.sourceMark)>=0?{sourceMark:Number(data.sourceMark)}:{})};
    this.document.entities.push(entity); return entity;
  }
  removeEntity(entityId){ this.document.entities=this.document.entities.filter(e=>e.id!==entityId); }
  sourceEntityOverride(mark, patch={}) { const m=Number(mark); let row=this.document.sourceEntityOverrides.find(r=>r.mark===m); if(!row){row={mark:m,suppressed:false};this.document.sourceEntityOverrides.push(row);} Object.assign(row,patch); return row; }
}

export function normalizeLevelDocument(input){
  const source=clone(input||{}); if(source.schema!==LEVEL_EDITOR_SCHEMA)throw new Error(`Unsupported level editor schema ${source.schema||'missing'}`);
  source.version=LEVEL_EDITOR_VERSION; source.collisionCoordinates='native-mt-1-based'; source.name=String(source.name||'Untitled level');
  source.base={submap:Number(source.base?.submap??0),mapId:Number(source.base?.mapId??3),blank:!!source.base?.blank};
  source.bounds={x:0,y:0,width:Math.max(16,Number(source.bounds?.width||320)),height:Math.max(16,Number(source.bounds?.height||896))};
  source.heroStart={x:Number(source.heroStart?.x??40),y:Number(source.heroStart?.y??80)};
  source.terrain=(Array.isArray(source.terrain)?source.terrain:[]).filter(t=>Array.isArray(t?.cell)&&t.cell.length>=2&&integer(t.cell[0])&&integer(t.cell[1])&&t?.terrainSet).map(t=>({id:String(t.id||id('terrain')),cell:[Number(t.cell[0]),Number(t.cell[1])],terrainSet:String(t.terrainSet),seed:integer(t.seed)?Number(t.seed):0,collisionMode:['catalog','visual-only','preserve'].includes(String(t.collisionMode))?String(t.collisionMode):'catalog',...(t.stampOwner?{stampOwner:String(t.stampOwner)}:{})})); source.terrainRelations=(Array.isArray(source.terrainRelations)?source.terrainRelations:[]).filter(r=>r?.type==='support'&&r?.terrainSet&&Array.isArray(r?.anchor)&&Array.isArray(r?.end)&&r.anchor.length>=2&&r.end.length>=2&&r.anchor.every(integer)&&r.end.every(integer)).map(r=>({id:String(r.id||id('terrain-relation')),type:'support',terrainSet:String(r.terrainSet),anchor:[Number(r.anchor[0]),Number(r.anchor[1])],end:[Number(r.end[0]),Number(r.end[1])],direction:'down',seed:integer(r.seed)?Number(r.seed):0,...(r.prototypeId?{prototypeId:String(r.prototypeId)}:{})})); source.stamps=(Array.isArray(source.stamps)?source.stamps:[])
    .filter(s=>(s?.variantId||s?.stampId)&&Array.isArray(s?.cell)&&s.cell.length>=2&&integer(s.cell[0])&&integer(s.cell[1]))
    .map(s=>{
      const variantId=String(s.variantId||s.stampId);
      return {
        id:String(s.id||id('stamp')),
        stampId:variantId,
        variantId,
        ...(s.familyId?{familyId:String(s.familyId)}:{}),
        cell:[Number(s.cell[0]),Number(s.cell[1])],
        contextCell:Array.isArray(s.contextCell)&&s.contextCell.length>=2&&s.contextCell.every(integer)?[Number(s.contextCell[0]),Number(s.contextCell[1])]:[Number(s.cell[0]),Number(s.cell[1])],mirrorX:!!s.mirrorX,terrainMode:['adapt','visual-only'].includes(String(s.terrainMode))?String(s.terrainMode):'adapt',
        terrainRestore:(Array.isArray(s.terrainRestore)?s.terrainRestore:[])
          .filter(r=>Array.isArray(r?.cell)&&r.cell.length>=2)
          .map(r=>({cell:[Number(r.cell[0]),Number(r.cell[1])],terrain:r.terrain?clone(r.terrain):null}))
      };
    });
  source.tiles=Array.isArray(source.tiles)?source.tiles:[]; source.gameplayCollision=(Array.isArray(source.gameplayCollision)?source.gameplayCollision:[]).filter(c=>Array.isArray(c?.g8)&&c.g8.length>=2&&integer(c.g8[0])&&integer(c.g8[1])&&['open','one-way','climb-through','lethal'].includes(String(c?.action||''))).map(c=>({id:String(c.id||id('gameplay-collision')),g8:[Number(c.g8[0]),Number(c.g8[1])],action:String(c.action)})); source.collision=Array.isArray(source.collision)?source.collision:[]; source.entities=Array.isArray(source.entities)?source.entities:[];
  source.presentationDepthOverrides=validatePresentationDepthOverrides((Array.isArray(source.presentationDepthOverrides)?source.presentationDepthOverrides:[]).map((row,index)=>({
    ...row, id:String(row?.id || `depth-${index}`), plane:String(row?.plane || 'A').toUpperCase(), source:String(row?.source || 'editor-draft')
  }))).map(row=>({ ...row, bounds:[...row.bounds], provenance:row.provenance ? clone(row.provenance) : null }));
  source.presentationDepthClassEdits=normalizePresentationDepthClassEdits(source.presentationDepthClassEdits || []).map(row=>({...row,provenance:row.provenance?clone(row.provenance):null}));
  source.alignmentOverrides=(Array.isArray(source.alignmentOverrides)?source.alignmentOverrides:[])
    .filter(row=>row?.id&&Array.isArray(row?.classicBoundsPx)&&row.classicBoundsPx.length>=4&&Array.isArray(row?.rdxBoundsPx)&&row.rdxBoundsPx.length>=4)
    .map(row=>({
      id:String(row.id),
      classicBoundsPx:row.classicBoundsPx.slice(0,4).map(Number),
      rdxBoundsPx:row.rdxBoundsPx.slice(0,4).map(Number),
      transform:{type:'translate',dxPx:Number(row.transform?.dxPx||0),dyPx:Number(row.transform?.dyPx||0)},
      status:String(row.status||'reviewed'),
      authority:String(row.authority||'level-editor-draft'),
      ...(finite(row.confidence)?{confidence:Number(row.confidence)}:{})
    }));
  source.sourceEntityOverrides=(Array.isArray(source.sourceEntityOverrides)?source.sourceEntityOverrides:[]).filter(o=>integer(o?.mark)).map(o=>{const placement=sourcePlacementOffset(o),stateVisualOffsetsByPn=sourceStateVisualOffsets(o),statePresentationOverrides=normalizeStatePresentationOverrides(o),occlusionLayer=sourceOcclusionLayer(o),projectileShooter=o?.projectileShooterPresentation,projectileEmitter=Array.isArray(o?.projectileEmitterOrigin)&&o.projectileEmitterOrigin.length>=2?o.projectileEmitterOrigin.slice(0,2).map(Number):null,projectileLane=['left','right'].includes(String(o?.projectileLaneDirection||'').toLowerCase())?String(o.projectileLaneDirection).toLowerCase():null,movingPlatformDirection=['left','right'].includes(String(o?.movingPlatformDirection||'').toLowerCase())?String(o.movingPlatformDirection).toLowerCase():null,controllerEntity=isClassicEnemyEntity(o?.controllerEntity)?Number(o.controllerEntity):null,patrol=normalizeEnemyPatrol(o?.patrol);return {mark:Number(o.mark),suppressed:!!o.suppressed,...(integer(o.presentationPn)&&Number(o.presentationPn)>=0&&Number(o.presentationPn)<255?{presentationPn:Number(o.presentationPn)}:{}),...(controllerEntity!=null?{controllerEntity}:{}),...(String(o?.enemyKindSetId||'').trim()?{enemyKindSetId:String(o.enemyKindSetId)}:{}),...(patrol?{patrol}:{}),...(placement.dx?{placementDx:placement.dx}:{}),...(placement.dy?{placementDy:placement.dy}:{}),...(Object.keys(stateVisualOffsetsByPn).length&&!statePresentationOverrides.length?{stateVisualOffsetsByPn}:{}),...(statePresentationOverrides.length?{statePresentationOverrides}:{}),...(occlusionLayer?{occlusionLayer}:{}),...(projectileShooter&&integer(projectileShooter.actorId)&&integer(projectileShooter.pn)&&Array.isArray(projectileShooter.origin)&&projectileShooter.origin.length>=2?{projectileShooterPresentation:{actorId:Number(projectileShooter.actorId),pn:Number(projectileShooter.pn),origin:projectileShooter.origin.slice(0,2).map(Number)}}:{}),...(projectileEmitter&&projectileEmitter.every(finite)?{projectileEmitterOrigin:projectileEmitter}:{}),...(projectileLane?{projectileLaneDirection:projectileLane}:{}),...(movingPlatformDirection?{movingPlatformDirection}: {})};});
  delete source.presentationOverrides;
  source.systemPatchRemovals=(Array.isArray(source.systemPatchRemovals)?source.systemPatchRemovals:[]).map(normalizeSystemPatchRemoval).filter(Boolean);
  source.transitions=(Array.isArray(source.transitions)?source.transitions:[]).map((t,i)=>{const entryFrow=Number(t?.entryFrow??0),contactRow=Number(t?.contactRow??t?.rowout??(entryFrow+0x10)),rowIn=Number(t?.rowIn??t?.rowin??(entryFrow+0x10));return {id:String(t?.id||`transition-${i}`),side:t?.side==='left'?'left':'right',contactRow,rowIn,targetSubmap:Number(t?.targetSubmap??source.base.submap),entryX:Number(t?.entryX??40),entryY:Number(t?.entryY??80),entryFrow};});
  source.layers={background:{visible:true,locked:false,...source.layers?.background},gameplay:{visible:true,locked:false,...source.layers?.gameplay},entities:{visible:true,locked:false,...source.layers?.entities},foreground:{visible:true,locked:false,...source.layers?.foreground}};
  source.settings={gridSize:8,snap:true,simulatePreview:true,soundPlaytest:true,invulnerablePlaytest:true,infiniteResources:true,renderScale:2,terrainCollisionMode:'catalog',terrainAssistAmbiguity:true,rawRdxRegions:[],...source.settings};source.settings.terrainCollisionMode=['catalog','visual-only','preserve'].includes(String(source.settings.terrainCollisionMode))?String(source.settings.terrainCollisionMode):'catalog';source.settings.renderScale=[1,2,4].includes(Number(source.settings.renderScale))?Number(source.settings.renderScale):2;source.settings.rawRdxRegions=(Array.isArray(source.settings.rawRdxRegions)?source.settings.rawRdxRegions:[]).filter(r=>r&&['background','foreground','all'].includes(String(r.mode))&&finite(r.x)&&finite(r.y)&&finite(r.width)&&finite(r.height)&&Number(r.width)>0&&Number(r.height)>0).map(r=>({x:Math.max(0,Math.floor(Number(r.x))),y:Math.max(0,Math.floor(Number(r.y))),width:Math.max(1,Math.ceil(Number(r.width))),height:Math.max(1,Math.ceil(Number(r.height))),mode:String(r.mode)})); source.metadata={notes:'',tags:[],music:'inherit',...source.metadata};
  source.entities=source.entities.map(e=>{const row={...e,patrolX:Number(e?.patrolX??e?.x??32),patrolY:Number(e?.patrolY??e?.y??64),triggerX:Number(e?.triggerX??e?.x??32),triggerY:Number(e?.triggerY??e?.y??64),actionPeriod:Math.max(1,Math.min(255,Number(e?.actionPeriod??1)|0)),frameIndex:Number.isInteger(Number(e?.frameIndex))?Number(e?.frameIndex):-1,front:!!e?.front,mirrorX:!!e?.mirrorX,mirrorY:!!e?.mirrorY,enabled:e?.enabled!==false};if(e?.sourceMark!=null&&integer(e.sourceMark)&&Number(e.sourceMark)>=0)row.sourceMark=Number(e.sourceMark);else delete row.sourceMark;return row;});
  return source;
}

export function validateLevelDocument(document,{hostWidth=320,hostHeight=Infinity,entityLimit=192}={}){
  const d=normalizeLevelDocument(document), issues=[];
  if(d.bounds.width>hostWidth)issues.push({severity:'error',code:'WIDTH_HOST',message:`Level width ${d.bounds.width}px exceeds native host width ${hostWidth}px.`});
  if(d.bounds.height>hostHeight)issues.push({severity:'error',code:'HEIGHT_HOST',message:`Level height ${d.bounds.height}px exceeds host room height ${hostHeight}px.`});
  if(d.bounds.width%16||d.bounds.height%16)issues.push({severity:'error',code:'LOGIC_GRID',message:'Level dimensions must be multiples of the 16px native logic cell.'});
  if(d.entities.length>entityLimit)issues.push({severity:'error',code:'ENTITY_CAP',message:`Editor entity definition count exceeds ${entityLimit}.`});
  if(!finite(d.heroStart.x)||!finite(d.heroStart.y)||d.heroStart.x<0||d.heroStart.y<0||d.heroStart.x>=d.bounds.width||d.heroStart.y>=d.bounds.height)issues.push({severity:'error',code:'HERO_BOUNDS',message:'Hero start is outside level bounds.'});
  const terrainSeen=new Set(); for(const t of d.terrain){const [cx,cy]=t.cell,k=`${cx},${cy}`;if(terrainSeen.has(k))issues.push({severity:'error',code:'TERRAIN_DUP_CELL',message:`Multiple terrain entries target cell ${k}.`});terrainSeen.add(k);if(cx<0||cy<0||cx*16>=d.bounds.width||cy*16>=d.bounds.height)issues.push({severity:'error',code:'TERRAIN_BOUNDS',message:`Terrain cell ${k} is outside the editable level bounds.`});}
  for(const r of d.terrainRelations){const [ax,ay]=r.anchor,[ex,ey]=r.end;if(r.type!=='support'||ex!==ax||ey<=ay)issues.push({severity:'error',code:'TERRAIN_RELATION',message:`Terrain relation ${r.id} has an invalid support path.`});if(ax<0||ay<0||ax*16>=d.bounds.width||ey*16>d.bounds.height)issues.push({severity:'error',code:'TERRAIN_RELATION_BOUNDS',message:`Terrain relation ${r.id} extends outside the editable level bounds.`});}
  const gameplayCollisionSeen=new Set(); for(const c of d.gameplayCollision){const [gx,gy]=c.g8,k=`${gx},${gy}`;if(gameplayCollisionSeen.has(k))issues.push({severity:'error',code:'GAMEPLAY_COLLISION_DUP',message:`Multiple gameplay collision entries target G8 ${k}.`});gameplayCollisionSeen.add(k);if(gx<0||gy<0||gx*8>=d.bounds.width||gy*8>=d.bounds.height)issues.push({severity:'error',code:'GAMEPLAY_COLLISION_BOUNDS',message:`Gameplay collision G8 ${k} is outside the editable level bounds.`});}
  const seen=new Set(); for(const e of d.entities){if(seen.has(e.id))issues.push({severity:'error',code:'DUP_ID',message:`Duplicate entity id ${e.id}.`});seen.add(e.id);if(e.entity<4||e.entity>=0x4a)issues.push({severity:'error',code:'ENTITY_TYPE',message:`${e.name} uses unsupported native entity type ${e.entity}.`});if(e.x<0||e.y<0||e.x>=d.bounds.width||e.y>=d.bounds.height)issues.push({severity:'warning',code:'ENTITY_BOUNDS',message:`${e.name} is outside the editable level bounds.`});}
  const sourceMarks=new Set(); for(const o of d.sourceEntityOverrides){if(sourceMarks.has(o.mark))issues.push({severity:'error',code:'SOURCE_OVERRIDE_DUP',message:`Source mark ${o.mark} has more than one editor override.`});sourceMarks.add(o.mark);if(o.mark<0)issues.push({severity:'error',code:'SOURCE_OVERRIDE_MARK',message:`Source override mark ${o.mark} is invalid.`});if(o.controllerEntity!=null&&!isClassicEnemyEntity(o.controllerEntity))issues.push({severity:'error',code:'SOURCE_ENEMY_TYPE',message:`Source mark ${o.mark} has an invalid editable enemy controller 0x${Number(o.controllerEntity).toString(16)}.`});if(o.patrol&&!normalizeEnemyPatrol(o.patrol))issues.push({severity:'error',code:'SOURCE_ENEMY_PATROL',message:`Source mark ${o.mark} has invalid bounded patrol geometry.`});}
  const alignmentIds=new Set(); for(const row of d.alignmentOverrides){if(alignmentIds.has(row.id))issues.push({severity:'error',code:'ALIGNMENT_OVERRIDE_DUP',message:`Alignment region ${row.id} has more than one editor override.`});alignmentIds.add(row.id);for(const [label,bounds] of [['Classic',row.classicBoundsPx],['RDX',row.rdxBoundsPx]])if(bounds.some(v=>!finite(v))||Number(bounds[2])<=0||Number(bounds[3])<=0)issues.push({severity:'error',code:'ALIGNMENT_OVERRIDE_BOUNDS',message:`${label} bounds for alignment region ${row.id} are invalid.`});}
  const removedSystemPatches=new Set(); for(const row of d.systemPatchRemovals){if(removedSystemPatches.has(row.patchId))issues.push({severity:'error',code:'SYSTEM_PATCH_REMOVAL_DUP',message:`System patch ${row.patchId} is marked for removal more than once.`});removedSystemPatches.add(row.patchId);if(row.collection!=='reviewedMapVisualPatches'||row.operation!=='remove')issues.push({severity:'error',code:'SYSTEM_PATCH_REMOVAL_KIND',message:`System patch removal ${row.patchId} has an unsupported target.`});}
  for(const t of d.transitions){if(!Number.isInteger(t.targetSubmap)||t.targetSubmap<0)issues.push({severity:'error',code:'TRANSITION_TARGET',message:`Transition ${t.id} has an invalid target submap.`});if(!integer(t.contactRow)||t.contactRow<0||t.contactRow>255||!integer(t.rowIn)||t.rowIn<0||t.rowIn>255)issues.push({severity:'error',code:'TRANSITION_ROWS',message:`Transition ${t.id} has invalid native contact/entry rows.`});if(!finite(t.entryX)||!finite(t.entryY)||!integer(t.entryFrow)||t.entryFrow<0||t.entryFrow>255)issues.push({severity:'error',code:'TRANSITION_ENTRY',message:`Transition ${t.id} has an invalid native destination entry.`});}
  if(!d.transitions.length)issues.push({severity:'info',code:'NO_TRANSITION',message:'No custom exit routing authored; native host-room connectors remain active.'});
  return issues;
}

export function exportLevelJson(document){ return JSON.stringify(normalizeLevelDocument(document),null,2); }
