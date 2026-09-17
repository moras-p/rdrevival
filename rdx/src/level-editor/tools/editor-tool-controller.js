const pointKey = point => `${Number(point[0])},${Number(point[1])}`;
const clampCell = (point, width, height) => [Math.max(0, Math.min(width - 1, Math.floor(Number(point[0])))), Math.max(0, Math.min(height - 1, Math.floor(Number(point[1]))))];

export const AUTHORING_TOOLS = Object.freeze([
  { id:'select', label:'Select', shortcut:'V' }, { id:'pan', label:'Pan', shortcut:'H' },
  { id:'terrain-brush', label:'Brush', shortcut:'B' }, { id:'terrain-line', label:'Line', shortcut:'L' },
  { id:'terrain-rectangle', label:'Rectangle', shortcut:'R' }, { id:'terrain-fill', label:'Fill', shortcut:'F' },
  { id:'terrain-erase', label:'Erase', shortcut:'E' }, { id:'collision', label:'Collision', shortcut:'C' },
  { id:'motif', label:'Motif', shortcut:'M' }
]);

export class EditorToolController {
  constructor({ workspace = null } = {}) {
    this.workspace=workspace; this.listeners=new Set(); this.activeTool='select'; this.hover=null; this.gesture=null;
    this.options={ familyId:'structural', materialId:null, collisionSemantic:'open', motifId:null, rectangleFill:true };
  }
  setWorkspace(workspace) { this.workspace=workspace; this.cancel(); this.emit('workspace'); }
  subscribe(listener){this.listeners.add(listener);return()=>this.listeners.delete(listener);}
  emit(reason){const state=this.snapshot();for(const listener of this.listeners)listener(state,reason);}
  snapshot(){return Object.freeze({activeTool:this.activeTool,hover:this.hover ? Object.freeze([...this.hover]) : null,gesture:this.gesture ? Object.freeze({...this.gesture,cells:Object.freeze((this.gesture.cells||[]).map(row=>Object.freeze([...row])))}) : null,options:Object.freeze({...this.options})});}
  setTool(id){if(!AUTHORING_TOOLS.some(row=>row.id===id))throw new Error(`Unknown editor tool '${id}'`);this.activeTool=id;this.cancel();this.emit('tool');}
  setOptions(options={}){Object.assign(this.options,options);this.emit('options');}
  rdxLocal(project,world){const pane=project?.panes?.find(row=>row.id==='rdx');if(!pane)return null;const x=Number(world.x)-Number(pane.x),y=Number(world.y)-Number(pane.y);if(x<0||y<0||x>=pane.width||y>=pane.height)return null;return [x,y];}
  cell16(project,world){const local=this.rdxLocal(project,world);if(!local||!this.workspace?.terrainWorkspace)return null;return clampCell([local[0]/16,local[1]/16],this.workspace.terrainWorkspace.widthCells,this.workspace.terrainWorkspace.heightCells);}
  cell8(project,world){const local=this.rdxLocal(project,world);if(!local)return null;return [Math.floor(local[0]/8),Math.floor(local[1]/8)];}
  updateHover(project,world){const cell=this.activeTool==='collision'?this.cell8(project,world):this.cell16(project,world);if(JSON.stringify(cell)!==JSON.stringify(this.hover)){this.hover=cell;this.emit('hover');}return cell;}
  terrainOptions(){return{familyId:this.options.familyId,materialId:this.options.materialId || null};}
  pointerDown(project,world){
    if(!this.workspace||['select','pan'].includes(this.activeTool))return false;
    const cell=this.activeTool==='collision'?this.cell8(project,world):this.cell16(project,world);if(!cell)return false;
    if(this.activeTool==='terrain-fill'){this.workspace.applyTerrainChange(this.workspace.terrainEngine.floodFill(this.workspace.terrainWorkspace,cell,this.terrainOptions()));this.emit('commit');return true;}
    if(this.activeTool==='motif'){if(!this.options.motifId)return false;this.workspace.applyTerrainChange(this.workspace.terrainEngine.motif(this.workspace.terrainWorkspace,this.options.motifId,cell));this.emit('commit');return true;}
    this.gesture={tool:this.activeTool,start:[...cell],end:[...cell],cells:[[...cell]]};this.emit('gesture-start');return true;
  }
  pointerMove(project,world){
    const cell=this.updateHover(project,world);if(!this.gesture||!cell)return false;this.gesture.end=[...cell];
    if(['terrain-brush','terrain-erase','collision'].includes(this.gesture.tool)){
      const keys=new Set(this.gesture.cells.map(pointKey));if(!keys.has(pointKey(cell)))this.gesture.cells.push([...cell]);
    }
    this.emit('gesture-move');return true;
  }
  pointerUp(project,world){
    if(!this.gesture||!this.workspace)return false;const gesture=this.gesture;const cell=(gesture.tool==='collision'?this.cell8(project,world):this.cell16(project,world))||gesture.end;gesture.end=[...cell];
    let change=null, engine=this.workspace.terrainEngine, terrain=this.workspace.terrainWorkspace;
    if(gesture.tool==='terrain-brush')change=engine.path(terrain,gesture.cells,this.terrainOptions());
    else if(gesture.tool==='terrain-erase')change=engine.eraseCells(terrain,gesture.cells);
    else if(gesture.tool==='collision')change=engine.gameplayExceptions(terrain,gesture.cells,this.options.collisionSemantic,{reason:'Reviewed Level Editor G8 correction'});
    else if(gesture.tool==='terrain-line')change=engine.line(terrain,gesture.start,gesture.end,this.terrainOptions());
    else if(gesture.tool==='terrain-rectangle')change=engine.rectangle(terrain,gesture.start,gesture.end,this.terrainOptions(),{fill:!!this.options.rectangleFill});
    this.gesture=null;if(change)this.workspace.applyTerrainChange(change);this.emit('gesture-end');return !!change;
  }
  cancel(){if(!this.gesture&&!this.hover)return;this.gesture=null;this.hover=null;this.emit('cancel');}
}
