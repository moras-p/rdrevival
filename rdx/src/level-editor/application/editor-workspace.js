import { CorrectionAuthoringService } from './correction-authoring-service.js';
import { buildRuntimeDraft } from './runtime-draft-builder.js';
import { ReviewedCorrectionRepository } from '../data/reviewed-correction-repository.js';
import { TerrainResourceRepository } from '../data/terrain-resource-repository.js';
import { DraftStorageRepository, WORKSPACE_DRAFT_SCHEMA } from '../data/draft-storage-repository.js';
import { reviewedCorrectionCurrentValue } from '../domain/reviewed-corrections.js';
import { createEditorCommand } from '../domain/command-history.js';
import { TerrainConstructionEngine, createTerrainCommand } from '../domain/terrain-construction-engine.js';
import { TerrainWorkspace } from '../domain/terrain-workspace.js';

const clone = value => value == null ? value : structuredClone(value);
const safeId = value => String(value || '').replace(/[^a-zA-Z0-9_.-]+/g, '-');
const signature = value => JSON.stringify(value ?? null);
function emptyTerrainState() { return { cells:[], gameplayExceptions:[], motifPlacements:[] }; }

export class EditorWorkspace {
  constructor({ history, correctionRepository = null, terrainRepository = null, draftStorage = null, terrainEngine = null } = {}) {
    if (!history) throw new TypeError('EditorWorkspace requires command history');
    this.history = history;
    this.correctionRepository = correctionRepository || new ReviewedCorrectionRepository();
    this.terrainRepository = terrainRepository || new TerrainResourceRepository();
    this.draftStorage = draftStorage || new DraftStorageRepository();
    this.terrainEngine = terrainEngine || new TerrainConstructionEngine();
    this.corrections = new CorrectionAuthoringService({ correctionRepository:this.correctionRepository, history:this.history });
    this.listeners = new Set();
    this.room = null; this.assets = null; this.terrainResources = null; this.terrainWorkspace = null;
    this.restoring = false; this.autosaveQueued = false; this.canonicalSignature = ''; this.localSavedAt = null; this.lastRuntimeIssues = Object.freeze([]);
    this.history.subscribe((_state, reason) => {
      if (this.restoring || !this.room) return;
      this.queueAutosave(); this.emit(`history:${reason}`);
    });
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit(reason) { const value=this.snapshot(); for (const listener of this.listeners) listener(value,reason); }
  snapshot() {
    const draft=this.room ? this.exportDraft({includeTimestamp:false}) : null;
    return Object.freeze({
      roomId:this.room?.id || null, dirty:!!this.room && signature(draft) !== this.canonicalSignature, history:this.history.state(), corrections:this.corrections.snapshot(),
      terrain:Object.freeze({ cells:this.terrainWorkspace?.listCells().length || 0, gameplayExceptions:this.terrainWorkspace?.listGameplayExceptions().length || 0, motifs:this.terrainWorkspace?.listMotifPlacements().length || 0 }),
      localSavedAt:this.localSavedAt, runtimeIssues:this.lastRuntimeIssues
    });
  }
  async openRoom({room,assets,restoreLocal=true}={}) {
    if (!room || !assets) throw new TypeError('EditorWorkspace.openRoom requires room and presentation assets');
    this.restoring=true;
    try {
      this.room=room; this.assets=assets; this.terrainResources=await this.terrainRepository.resourcesForRoom(room);
      const dimensions=assets.mapDecoder.dimensions(room.mapId);
      this.terrainWorkspace=new TerrainWorkspace({catalog:this.terrainResources.catalog,roomId:room.id,group:room.group,widthCells:dimensions.cellWidth,heightCells:dimensions.cellHeight});
      await this.corrections.openRoom(room); this.history.clear('workspace-room-change');
      this.canonicalSignature=signature(this.exportDraft({includeTimestamp:false}));
      const local=restoreLocal ? await this.draftStorage.get(room.id) : null;
      if (local && local.baseFingerprint === (room?.fingerprints?.resolved || null)) this.loadDraft(local,{recordHistory:false,persist:false});
      this.history.clear('workspace-room-opened'); this.localSavedAt=local?.savedAt || null;
    } finally { this.restoring=false; }
    this.emit('room-opened'); return this.snapshot();
  }
  effectiveRoom() { if (!this.room) return null; return this.corrections.resolveReviewedRoom(); }
  inspection(baseInspection) { const room=this.effectiveRoom(); return room && baseInspection ? Object.freeze({...baseInspection,room}) : baseInspection; }
  correctionId(type,target) { return `${this.room?.id || 'room'}.${safeId(target)}.${safeId(type)}.editor`; }
  upsertCorrection({type,target,value,reason='Level Editor reviewed correction',id=null}={}) {
    if (!this.room) throw new Error('Open a room before authoring corrections');
    const correctionId=id || this.correctionId(type,target);
    const existing=this.corrections.getRoomCorrections().corrections.find(row=>row.id===correctionId) || null;
    const expected=existing?.expected !== undefined ? clone(existing.expected) : reviewedCorrectionCurrentValue(this.effectiveRoom(),type,target,value);
    const correction={id:correctionId,type:String(type),target:String(target),expected,value:clone(value),provenance:{authority:'user-reviewed',reason:String(reason || 'Level Editor reviewed correction'),evidence:['replacement-level-editor']}};
    this.corrections.validateCorrection(correction);
    const before=this.corrections.getRoomCorrections();
    const next={...before,corrections:[...(before.corrections||[]).filter(row=>row.id!==correctionId),clone(correction)]};
    this.history.execute(createEditorCommand({id:`workspace.correction.${correctionId}.${Date.now()}`,label:`${existing?'Update':'Add'} ${type}`,execute:()=>this.corrections.loadWorkingCorrections(next),undo:()=>this.corrections.loadWorkingCorrections(before)}),this);
    this.emit('correction'); return correction;
  }
  removeCorrection(id) {
    const before=this.corrections.getRoomCorrections();
    if (!(before.corrections||[]).some(row=>row.id===id)) throw new Error(`No accepted correction '${id}'`);
    const next={...before,corrections:before.corrections.filter(row=>row.id!==id)};
    this.history.execute(createEditorCommand({id:`workspace.correction.remove.${id}.${Date.now()}`,label:`Remove ${id}`,execute:()=>this.corrections.loadWorkingCorrections(next),undo:()=>this.corrections.loadWorkingCorrections(before)}),this);
    this.emit('correction-remove'); return true;
  }
  applyTerrainChange(changeSet) { const command=createTerrainCommand(changeSet); this.history.execute(command,this); this.emit('terrain'); return changeSet; }
  undo(){const changed=this.history.undo(this); if(changed)this.emit('undo'); return changed;}
  redo(){const changed=this.history.redo(this); if(changed)this.emit('redo'); return changed;}
  terrainState(){return this.terrainWorkspace ? {cells:this.terrainWorkspace.listCells().map(clone),gameplayExceptions:this.terrainWorkspace.listGameplayExceptions().map(clone),motifPlacements:this.terrainWorkspace.listMotifPlacements().map(clone)} : emptyTerrainState();}
  exportDraft({includeTimestamp=true}={}) {
    if(!this.room)return null;
    const value={schema:WORKSPACE_DRAFT_SCHEMA,version:1,room:{id:this.room.id,submap:Number(this.room.submap),mapId:Number(this.room.mapId)},baseFingerprint:this.room?.fingerprints?.resolved||null,corrections:this.corrections.getRoomCorrections(),terrain:this.terrainState()};
    if(includeTimestamp)value.savedAt=new Date().toISOString(); return value;
  }
  loadDraft(draft,{recordHistory=false,persist=true}={}) {
    if(!this.room)throw new Error('Open a room before importing a draft');
    if(draft?.schema!==WORKSPACE_DRAFT_SCHEMA)throw new Error(`Expected ${WORKSPACE_DRAFT_SCHEMA}, received ${draft?.schema || 'missing schema'}`);
    if(String(draft?.room?.id||'')!==String(this.room.id))throw new Error(`Draft is for ${draft?.room?.id || 'another room'}, current room is ${this.room.id}`);
    if(draft.baseFingerprint && this.room?.fingerprints?.resolved && draft.baseFingerprint!==this.room.fingerprints.resolved)throw new Error(`Draft base is stale for ${this.room.id}`);
    const previous=recordHistory ? this.exportDraft({includeTimestamp:false}) : null;
    const apply=value=>{
      this.corrections.loadWorkingCorrections(value.corrections);
      this.terrainWorkspace=new TerrainWorkspace({catalog:this.terrainResources.catalog,roomId:this.room.id,group:this.room.group,widthCells:this.assets.mapDecoder.dimensions(this.room.mapId).cellWidth,heightCells:this.assets.mapDecoder.dimensions(this.room.mapId).cellHeight,cells:value.terrain?.cells||[],gameplayExceptions:value.terrain?.gameplayExceptions||[],motifPlacements:value.terrain?.motifPlacements||[]});
    };
    if(recordHistory)this.history.execute(createEditorCommand({id:`workspace.import.${Date.now()}`,label:'Import room draft',execute:()=>apply(draft),undo:()=>apply(previous)}),this); else apply(draft);
    if(persist)this.queueAutosave(); this.emit('draft-loaded'); return this.snapshot();
  }
  discardDraft() {
    if(!this.room)return false;
    const empty={schema:WORKSPACE_DRAFT_SCHEMA,version:1,room:{id:this.room.id,submap:Number(this.room.submap),mapId:Number(this.room.mapId)},baseFingerprint:this.room?.fingerprints?.resolved||null,corrections:this.corrections.persisted,terrain:emptyTerrainState()};
    this.loadDraft(empty,{recordHistory:true,persist:true}); return true;
  }
  runtimeDraft() {
    if(!this.room)return{draft:null,issues:Object.freeze([])};
    const result=buildRuntimeDraft({baseRoom:this.room,reviewedRoom:this.effectiveRoom(),terrainWorkspace:this.terrainWorkspace,assets:this.assets}); this.lastRuntimeIssues=result.issues; return result;
  }
  validationIssues() {
    const issues=[];
    for(const issue of this.terrainWorkspace ? this.terrainEngine.validateConnectors(this.terrainWorkspace) : []) issues.push(issue);
    const terrainCells=this.terrainWorkspace?.listCells?.() || [], motifs=this.terrainWorkspace?.listMotifPlacements?.() || [];
    if(terrainCells.length || motifs.length)issues.push(Object.freeze({severity:'info',code:'TERRAIN_PROMOTION_REQUIRED',message:'Semantic terrain is available in the working/static/native development draft, but canonical terrain promotion still requires the replacement terrain compiler/storage boundary.'}));
    try{this.effectiveRoom();}catch(error){issues.push(Object.freeze({severity:'error',code:'CORRECTION_INVALID',message:error.message||String(error)}));}
    try { issues.push(...this.runtimeDraft().issues); } catch (error) { issues.push(Object.freeze({severity:'error',code:'RUNTIME_DRAFT_INVALID',message:error.message||String(error)})); }
    return Object.freeze(issues);
  }
  changes() {
    const corrections=this.corrections.getRoomCorrections().corrections||[];
    return Object.freeze([
      ...corrections.map(row=>Object.freeze({kind:'correction',id:row.id,label:`${row.type} · ${row.target}`,semantic:this.corrections.describeCorrectionImpact(row)?.semantic||''})),
      ...this.terrainWorkspace.listCells().map(row=>Object.freeze({kind:'terrain',id:`terrain:${row.cell.join(':')}`,label:`Terrain ${row.cell.join(',')} · ${row.familyId}`,semantic:row.gameplay?.mode==='semantic'?row.gameplay.semantic:'visual'})),
      ...this.terrainWorkspace.listGameplayExceptions().map(row=>Object.freeze({kind:'collision',id:`collision:${row.cell.join(':')}`,label:`G8 ${row.cell.join(',')} · ${row.semantic}`,semantic:'gameplay'})),
      ...this.terrainWorkspace.listMotifPlacements().map(row=>Object.freeze({kind:'motif',id:row.id,label:`Motif ${row.motifId} @ ${row.origin.join(',')}`,semantic:'visual'}))
    ]);
  }
  queueAutosave() {
    if(this.autosaveQueued||!this.room)return;
    this.autosaveQueued=true;
    queueMicrotask(async()=>{this.autosaveQueued=false;if(!this.room)return;const draft=this.exportDraft();try{await this.draftStorage.put(this.room.id,draft);this.localSavedAt=draft.savedAt;this.emit('autosaved');}catch(error){this.emit(`autosave-error:${error.message||error}`);}});
  }
}
export { WORKSPACE_DRAFT_SCHEMA };
