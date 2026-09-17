import { diagnosticSelectable } from '../preview/preview-elements.js';
import { DebugPrimitiveFlag, DebugPrimitiveType } from '../debug/overlay-model.js';

export const EDITOR_DIAGNOSTIC_VIEWS = Object.freeze([
  ['runtime', 'Runtime'], ['layers', 'Layers'], ['structure', 'Structure'], ['draft', 'Draft'], ['shift', 'Classic ↔ RDX shift']
]);

export const EDITOR_DIAGNOSTIC_FILTERS = Object.freeze([
  ['all', 'All'], ['hazard', 'Hazards'], ['enemy', 'Enemies'], ['collectible', 'Collectibles'],
  ['projectile', 'Projectiles'], ['activator', 'Triggers'], ['blockage', 'Blockages'], ['action', 'Actions'], ['patch', 'Patches']
]);

export const EDITOR_INSTANCE_TYPES = Object.freeze([
  ['enemy', 'Enemy'], ['platform', 'Platform'], ['projectile-shooter', 'Projectile shooter'], ['projectile-emitter', 'Projectile emitter'], ['projectile-lane', 'Projectile lane'], ['projectile', 'Projectile'],
  ['trap', 'Trap / hazard'], ['collectible', 'Collectible'], ['lure', 'Lure / feedback'], ['activator', 'Trigger'], ['blockage', 'Blockage']
]);

const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const box = (x, y, width, height) => Object.freeze({ x:num(x), y:num(y), width:Math.max(1,num(width)), height:Math.max(1,num(height)) });
const contextFor = renderer => ({ mapId:renderer?.selection?.mapId, submap:renderer?.selection?.submap });
const SHIFT_CELL_PX = 8;

function nativeGeometrySourceKey(sourceId) {
  const mark = Number(sourceId);
  return Number.isInteger(mark) && mark >= 0 && mark < 0x8000 ? `mark:${mark}` : '';
}

function nativeGeometryFamily(flags, type) {
  const semanticClass = Number(flags || 0) & DebugPrimitiveFlag.CLASS_MASK;
  if (type === DebugPrimitiveType.PATROL || semanticClass === DebugPrimitiveFlag.CLASS_T1A) return 'type1a';
  if (semanticClass === DebugPrimitiveFlag.CLASS_PLATFORM) return 'platform';
  if (semanticClass === DebugPrimitiveFlag.CLASS_T3) return 'type3';
  return 'action';
}

function nativeGeometryEnvelope(segments) {
  const xs=[],ys=[];
  for (const segment of segments) {
    xs.push(Number(segment[0]),Number(segment[2]));
    ys.push(Number(segment[1]),Number(segment[3]));
  }
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  return Object.freeze({minX,maxX,minY,maxY,width:Math.max(1,maxX-minX),height:Math.max(1,maxY-minY),sampleCount:segments.length+1});
}

function nativeGeometryPathPoints(segments) {
  if (!segments.length) return Object.freeze([]);
  const points=[[segments[0][0],segments[0][1]]];
  for (const segment of segments) {
    const last=points.at(-1);
    if (last[0]!==segment[0] || last[1]!==segment[1]) points.push([segment[0],segment[1]]);
    points.push([segment[2],segment[3]]);
  }
  return Object.freeze(points.map(point=>Object.freeze(point)));
}

/** Adapt native xrick debug geometry to the Level Editor's diagnostic rows.
 * Native RDX debug geometry is expressed in the currently loaded xrick camera
 * bank. It is therefore live motion evidence, not by itself a complete
 * whole-room RDX route. When authored controller geometry exists, the merge
 * compares native evidence in the Layer-B+C controller basis; Layer-E/F
 * presentation residuals are deliberately not part of the path transform. */
export function mergeEditorNativeMotionGeometry(previousGeometry = null, currentGeometry = null) {
  if (!currentGeometry || currentGeometry.mode !== 'rdx' || !Array.isArray(currentGeometry.primitives)) return currentGeometry || previousGeometry;
  if (!previousGeometry || previousGeometry.mode !== 'rdx' || !Array.isArray(previousGeometry.primitives)) return currentGeometry;
  const motionKey=primitive=>{
    const type=Number(primitive?.type);
    if(type!==DebugPrimitiveType.PATH&&type!==DebugPrimitiveType.PATROL)return '';
    return `${type}:${Number(primitive?.sourceId)}`;
  };
  const currentKeys=new Set(currentGeometry.primitives.map(motionKey).filter(Boolean));
  const retained=previousGeometry.primitives.filter(primitive=>{const key=motionKey(primitive);return key&&!currentKeys.has(key);});
  if(!retained.length)return currentGeometry;
  return Object.freeze({...currentGeometry,primitives:Object.freeze([...currentGeometry.primitives,...retained])});
}

export function editorNativeMotionGeometryRows(nativeGeometry = null) {
  if (!nativeGeometry || nativeGeometry.mode !== 'rdx' || !Array.isArray(nativeGeometry.primitives)) return [];
  const groups=new Map();
  for (const primitive of nativeGeometry.primitives) {
    const type=Number(primitive?.type);
    if (type!==DebugPrimitiveType.PATH && type!==DebugPrimitiveType.PATROL) continue;
    const sourceKey=nativeGeometrySourceKey(primitive?.sourceId); if(!sourceKey)continue;
    const key=`${type}:${sourceKey}`;
    let group=groups.get(key);
    if(!group){group={type,sourceKey,flags:Number(primitive?.flags||0),segments:[]};groups.set(key,group);}
    group.flags|=Number(primitive?.flags||0);
    group.segments.push(Object.freeze([num(primitive.x0),num(primitive.y0),num(primitive.x1),num(primitive.y1)]));
  }
  return [...groups.values()].map(group=>{
    const family=nativeGeometryFamily(group.flags,group.type), envelope=nativeGeometryEnvelope(group.segments), pathPoints=nativeGeometryPathPoints(group.segments);
    const isPatrol=group.type===DebugPrimitiveType.PATROL;
    return Object.freeze({
      debugId:`native-${isPatrol?'patrol':'path'}:${group.sourceKey}`,
      elementId:`native-${isPatrol?'patrol':'path'}:${group.sourceKey}`,
      sourceKey:group.sourceKey,
      category:isPatrol?'enemy':family==='platform'?'platform':'actor',
      subjectCategory:isPatrol?'enemy':family==='platform'?'platform':'actor',
      overlayType:isPatrol?'native-patrol':'native-path',
      current:pathPoints[0] || Object.freeze([envelope.minX,envelope.minY]),
      envelope,pathPoints,
      pathSegments:Object.freeze(group.segments),
      policy:Object.freeze({family,label:isPatrol?'native patrol span':family==='platform'?'native moving-platform path':'native scripted path'}),
      authority:'native-xrick-debug-geometry',
      notes:Object.freeze([isPatrol?'Patrol span is emitted by native xrick debug geometry.':'Scripted path is emitted by native xrick debug geometry.'])
    });
  });
}

function offsetNativeMotionGeometry(nativeRow, anchor) {
  const start=nativeRow?.pathPoints?.[0];
  if(!Array.isArray(start)||!Array.isArray(anchor))return nativeRow;
  const dx=num(anchor[0])-num(start[0]),dy=num(anchor[1])-num(start[1]);
  if(!dx&&!dy)return Object.freeze({
    ...nativeRow,
    roomOffset:Object.freeze([0,0]),
    authority:'native-xrick-debug-geometry+resolved-controller-alignment'
  });
  const pathSegments=Object.freeze((nativeRow.pathSegments||[]).map(segment=>Object.freeze([
    num(segment[0])+dx,num(segment[1])+dy,num(segment[2])+dx,num(segment[3])+dy
  ])));
  const pathPoints=nativeGeometryPathPoints(pathSegments),envelope=nativeGeometryEnvelope(pathSegments);
  return Object.freeze({
    ...nativeRow,pathSegments,pathPoints,envelope,current:pathPoints[0]||nativeRow.current,
    roomOffset:Object.freeze([dx,dy]),
    authority:'native-xrick-debug-geometry+resolved-phase-zero'
  });
}

function overlayNativeMotionGeometry(rows, nativeGeometry) {
  const nativeRows=editorNativeMotionGeometryRows(nativeGeometry);
  if(!nativeRows.length)return rows;
  const out=[...rows];
  for(const nativeRow of nativeRows){
    const nativeFamily=String(nativeRow.policy?.family||'');
    const index=out.findIndex(row=>{
      if(String(row?.sourceKey||'')!==String(nativeRow.sourceKey))return false;
      const family=String(row?.policy?.family||'');
      return nativeFamily==='type1a' ? family==='type1a' : ['type3','action','platform'].includes(family);
    });
    if(index<0){out.push(nativeRow);continue;}
    const prior=out[index];
    const authoredWholeRoute=nativeFamily==='type3' && prior?.scriptVsRuntime==='authored-script-plus-observed-runtime'
      && Array.isArray(prior?.pathPoints) && prior.pathPoints.length>=2;
    const boundedPatrol=nativeFamily==='type1a' && String(prior?.configured?.authority||'')==='xrick-map-mark-type1a'
      && Array.isArray(prior?.pathPoints) && prior.pathPoints.length>=2;
    const configuredPatrol=boundedPatrol&&String(prior?.pathAuthority||'').startsWith('layer-b-');
    /* Scripted Layer-B routes and ordinary normalized type-1A patrols stay in
     * their projected controller basis. A position-adjusted type-1A actor is
     * the exception: its displayed leg is the effective Layer-F RDX support.
     * Native PATH/PATROL is camera-local evidence in either case and is
     * rebased onto the already-selected whole-room leg rather than replacing
     * it. */
    const anchor=(authoredWholeRoute||boundedPatrol)?prior?.pathPoints?.[0]
      :(Array.isArray(prior?.current)?prior.current:prior?.pathPoints?.[0]);
    const adapted=offsetNativeMotionGeometry(nativeRow,anchor);
    if(authoredWholeRoute||boundedPatrol){
      out[index]=Object.freeze({
        ...prior,
        authority:prior.authority||(authoredWholeRoute?'classic-ent-mvstep':configuredPatrol?String(prior.pathAuthority||'layer-b-configured-patrol-projected'):'rdx-effective-support-patrol+layer-b-controller-limit'),
        nativeGeometry:adapted,
        notes:Object.freeze([...(prior.notes||[]),authoredWholeRoute
          ? 'Whole-room path comes from normalized Classic ent_mvstep; live native geometry is camera-local runtime evidence.'
          : configuredPatrol
            ? (String(prior.pathAuthority||'')==='layer-b-classic-static-envtest-projected'
              ? 'Whole-room patrol is the Classic static-envtest constrained Layer-B interval projected into RDX; live native geometry remains camera-local runtime evidence.'
              : 'Whole-room patrol is the normalized Layer-B interval projected into RDX; live native geometry remains camera-local runtime evidence.')
            : 'Whole-room patrol is the effective RDX support leg after Layer-F placement; Layer-B retains the configured maximum and live native geometry remains camera-local runtime evidence.'])
      });
      continue;
    }
    out[index]=Object.freeze({
      ...prior,
      envelope:adapted.envelope,
      pathPoints:adapted.pathPoints,
      pathSegments:adapted.pathSegments,
      authority:adapted.authority,
      nativeGeometry:adapted,
      notes:Object.freeze([...(prior.notes||[]),...adapted.notes])
    });
  }
  return out;
}

export function editorClassicRdxShiftSummary({ shiftMap, submap } = {}) {
  const room = shiftMap?.roomForSubmap?.(submap) || null;
  if (!room) return Object.freeze({ available:false, mappedCells:0, totalCells:0, coveragePct:0, offsetCount:0, dominant:null, visualBaseOffset:null, runtimeOffset:null });
  const vectors = (room.shiftVectors || []).filter(row => Number(row.dxPx) || Number(row.dyPx));
  const dominant = [...vectors].sort((a,b)=>Number(b.count||0)-Number(a.count||0))[0] || null;
  const totalCells = Math.max(0, Number(room.width||0) * Number(room.height||0));
  const mappedCells = Math.max(0, Number(room.mappedCellCount||0));
  return Object.freeze({
    available:true, mappedCells, totalCells,
    coveragePct:totalCells ? Math.round(mappedCells * 100 / totalCells) : 0,
    offsetCount:vectors.length,
    dominant:dominant ? Object.freeze({ dxPx:Number(dominant.dxPx||0), dyPx:Number(dominant.dyPx||0), count:Number(dominant.count||0) }) : null,
    visualBaseOffset:room.visualBaseOffset || null,
    runtimeOffset:room.runtimeOffset || null
  });
}

export function editorClassicRdxShiftInspection({ shiftMap, submap, point } = {}) {
  const px=Number(point?.x), py=Number(point?.y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
  const room=shiftMap?.roomForSubmap?.(submap) || null, cell=shiftMap?.atRdxPixel?.(submap,px,py) || null;
  if (!room || !cell) return null;
  const classicX=Number(cell.x) - Number(cell.dxPx||0)/SHIFT_CELL_PX;
  const classicY=Number(cell.y) - Number(cell.dyPx||0)/SHIFT_CELL_PX;
  const mapId=Number(room.mapId||0);
  return Object.freeze({
    id:`MD${String(mapId).padStart(4,'0')}#alignment#classic-rdx:rdx:g8:${cell.x}:${cell.y}`,
    submap:Number(submap), mapId,
    rdx:Object.freeze({ cell:Object.freeze([Number(cell.x),Number(cell.y)]), pixel:Object.freeze([Number(cell.x)*SHIFT_CELL_PX,Number(cell.y)*SHIFT_CELL_PX]) }),
    classic:Object.freeze({ cell:Object.freeze([classicX,classicY]), pixel:Object.freeze([classicX*SHIFT_CELL_PX,classicY*SHIFT_CELL_PX]) }),
    shift:Object.freeze({ dxPx:Number(cell.dxPx||0), dyPx:Number(cell.dyPx||0) }),
    runtimeCorrection:Object.freeze({ dxPx:Number(cell.correctionDxPx||0), dyPx:Number(cell.correctionDyPx||0) }),
    confidence:Number(cell.confidence||0)
  });
}

export function drawEditorClassicRdxShift(context, { shiftMap, submap, selected = null, selectionOnly = false } = {}) {
  const room=shiftMap?.roomForSubmap?.(submap) || null;
  if (!context || !room) return;
  context.save();
  context.lineWidth=1;
  context.lineCap='round';
  if (!selectionOnly) for (let gy=0; gy<room.height; gy+=1) for (let gx=0; gx<room.width; gx+=1) {
    const i=gy*room.width+gx;
    if (!room.coverage?.[i]) continue;
    const dx=Number(room.totalDxCells?.[i]||0)*SHIFT_CELL_PX, dy=Number(room.totalDyCells?.[i]||0)*SHIFT_CELL_PX;
    if (!dx && !dy) continue;
    const x=gx*SHIFT_CELL_PX, y=gy*SHIFT_CELL_PX, confidence=Number(room.confidence?.[i]||0)/255;
    const magnitude=Math.max(1,Math.hypot(dx,dy)), vx=dx/magnitude, vy=dy/magnitude;
    const alpha=.18 + Math.min(.22,confidence*.22);
    context.fillStyle=`rgba(103,184,208,${Math.max(.045,alpha*.22)})`;
    context.fillRect(x+1,y+1,SHIFT_CELL_PX-2,SHIFT_CELL_PX-2);
    context.strokeStyle=`rgba(133,211,229,${alpha})`;
    context.beginPath();context.moveTo(x+4-vx*1.3,y+4-vy*1.3);context.lineTo(x+4+vx*2.3,y+4+vy*2.3);context.stroke();
    context.fillStyle=`rgba(170,229,239,${Math.min(.72,alpha+.18)})`;
    context.fillRect(Math.round(x+4+vx*2.3)-.5,Math.round(y+4+vy*2.3)-.5,1.5,1.5);
  }
  if (selected?.rdx?.pixel && selected?.classic?.pixel) {
    const [rx,ry]=selected.rdx.pixel,[cx,cy]=selected.classic.pixel;
    context.setLineDash([4,3]);context.strokeStyle='rgba(155,217,232,.9)';
    context.beginPath();context.moveTo(cx+4,cy+4);context.lineTo(rx+4,ry+4);context.stroke();
    context.strokeRect(cx+.5,cy+.5,SHIFT_CELL_PX-1,SHIFT_CELL_PX-1);
    context.setLineDash([]);context.strokeStyle='rgba(255,227,110,.98)';context.lineWidth=2;context.strokeRect(rx+1,ry+1,SHIFT_CELL_PX-2,SHIFT_CELL_PX-2);
  }
  context.restore();
}

export function editorDebugFilterMatches(row, filter = 'all') {
  if (filter === 'all') return true;
  const family = String(row?.policy?.family || '');
  const category = String(row?.category || '');
  const subject = String(row?.subjectCategory || '');
  const type = String(row?.overlayType || '');
  if (filter === 'hazard') return ['hazard','trap','blockage-hazard','shooter'].includes(family) || type.includes('hazard');
  if (filter === 'enemy') return category === 'enemy' || subject === 'enemy' || ['type1a','type1b'].includes(family);
  if (filter === 'collectible') return category === 'collectible' || family === 'collectible';
  if (filter === 'projectile') return ['projectile','projectile-shooter','projectile-emitter','projectile-lane'].includes(category) || ['projectile','projectile-shooter','projectile-emitter','projectile-lane'].includes(subject) || ['shooter','shooter-body','projectile-emitter','projectile-lane'].includes(family) || type.includes('projectile');
  if (filter === 'activator') return family === 'activator' || type === 'activator' || category === 'activator' || subject === 'activator';
  if (filter === 'blockage') return subject === 'blockage' || subject === 'explodable' || category === 'blockage' || family === 'blockage-hazard';
  if (filter === 'action') return family === 'action' || type === 'action';
  if (filter === 'patch') return family === 'patch' || family === 'editor-patch' || type.includes('patch') || category === 'editor-patch';
  if (filter === 'no-overlap') return family === 'no-overlap' || category === 'no-overlap' || type.includes('missing-rdx');
  if (filter === 'placement') return family === 'placement' || category === 'placement' || type === 'placement';
  return true;
}

function dedupeHazards(rows) {
  const rank = row => String(row?.overlayType || '') === 'collision-hazard' ? 3
    : String(row?.overlayType || '') === 'component-hazard' ? 2
    : String(row?.overlayType || '') === 'terrain-hazard' ? 1 : 0;
  const bySource = new Map();
  for (const row of rows) {
    const key = `${String(row?.sourceKey || row?.debugId || '')}|${String(row?.instanceKey || '')}`;
    const previous = bySource.get(key);
    if (!previous || rank(row) > rank(previous)) bySource.set(key, row);
  }
  return [...bySource.values()];
}

function editorPatchRow({ id, label, bounds, sourceKey = null, subjectCategory = 'editor', detail = '', selection = null }) {
  const current = [bounds.x + bounds.width / 2, bounds.y + bounds.height / 2];
  return Object.freeze({
    debugId:`editor-patch:${id}`, sourceKey, category:'editor-patch', subjectCategory,
    overlayType:'editor-patch', current:Object.freeze(current), bounds:Object.freeze(bounds),
    envelope:Object.freeze({ minX:bounds.x, minY:bounds.y, maxX:bounds.x+bounds.width, maxY:bounds.y+bounds.height, width:bounds.width, height:bounds.height, sampleCount:1 }),
    authority:'level-editor-draft', policy:Object.freeze({ family:'editor-patch', label }),
    notes:Object.freeze(detail ? [detail] : []), editorSelection:selection
  });
}

/** Convert authored Level Editor changes into the shared diagnostic row contract.
 * These are review overlays only; the layered document remains authoritative. */
export function editorDraftPatchDiagnostics(document, { sourceSelectables = [], stampBoundsFor = null } = {}) {
  if (!document) return [];
  const rows = [];
  for (const t of document.terrain || []) rows.push(editorPatchRow({ id:`terrain:${t.id}`, label:'Terrain draft', bounds:box(t.cell?.[0]*16,t.cell?.[1]*16,16,16), detail:`${t.terrainSet} · ${t.collisionMode}`, selection:{kind:'terrain',id:t.id,cx:t.cell?.[0],cy:t.cell?.[1]} }));
  for (const r of document.terrainRelations || []) if (r.type === 'support') {
    const x=num(r.anchor?.[0])*16, y=num(r.anchor?.[1])*16, h=Math.max(16,(num(r.end?.[1])-num(r.anchor?.[1])+1)*16);
    rows.push(editorPatchRow({ id:`relation:${r.id}`, label:'Smart construction draft', bounds:box(x,y,16,h), detail:r.terrainSet, selection:{kind:'terrain-relation',id:r.id} }));
  }
  for (const p of document.stamps || []) {
    const resolved=typeof stampBoundsFor==='function'?stampBoundsFor(p):null,w=Math.max(1,num(resolved?.width || p.sizeCells?.[0]*16 || 16)),h=Math.max(1,num(resolved?.height || p.sizeCells?.[1]*16 || 16));
    rows.push(editorPatchRow({ id:`stamp:${p.id}`, label:'Stamp draft', bounds:box(resolved?.x ?? p.cell?.[0]*16,resolved?.y ?? p.cell?.[1]*16,w,h), detail:p.stampId, selection:{kind:'stamp',id:p.id} }));
  }
  for (const c of document.collision || []) rows.push(editorPatchRow({ id:`collision:${c.logic?.[0]}:${c.logic?.[1]}`, label:'Collision draft', bounds:box((num(c.logic?.[0])-1)*16,(num(c.logic?.[1])-1)*16,16,16), detail:c.collision, subjectCategory:'collision', selection:{kind:'collision',id:`logic:${c.logic?.[0]}:${c.logic?.[1]}`,logic:[num(c.logic?.[0]),num(c.logic?.[1])]} }));
  for (const c of document.gameplayCollision || []) rows.push(editorPatchRow({ id:`gameplay-collision:${c.g8?.[0]}:${c.g8?.[1]}`, label:'Gameplay collision draft', bounds:box(num(c.g8?.[0])*8,num(c.g8?.[1])*8,8,8), detail:c.action, subjectCategory:'collision', selection:{kind:'gameplay-collision',id:`g8:${c.g8?.[0]}:${c.g8?.[1]}`,g8:[num(c.g8?.[0]),num(c.g8?.[1])]} }));
  for (const t of document.tiles || []) rows.push(editorPatchRow({ id:`tile:${t.layer}:${t.target?.[0]}:${t.target?.[1]}`, label:'Presentation draft', bounds:box(num(t.target?.[0])*8,num(t.target?.[1])*8,8,8), detail:t.operation || 'copy', subjectCategory:'presentation', selection:{kind:'cell',id:`${t.layer}:${t.target?.[0]}:${t.target?.[1]}`,gx:num(t.target?.[0]),gy:num(t.target?.[1]),layer:t.layer} }));
  for (const e of document.entities || []) rows.push(editorPatchRow({ id:`entity:${e.id}`, label:'Editable entity draft', bounds:box(e.x,e.y,24,21), detail:e.name, subjectCategory:e.category || 'actor', selection:{kind:'entity',id:e.id} }));
  for (const a of document.alignmentOverrides || []) {
    const b=a.rdxBoundsPx || [0,0,16,16];
    rows.push(editorPatchRow({ id:`alignment:${a.id}`, label:'Layer C alignment draft', bounds:box(b[0],b[1],b[2],b[3]), detail:`translate ${num(a.transform?.dxPx)}, ${num(a.transform?.dyPx)}`, subjectCategory:'alignment', selection:{kind:'alignment',id:String(a.id)} }));
  }
  for (const r of document.systemPatchRemovals || []) if (Array.isArray(r.bounds) && r.bounds.length >= 4) {
    rows.push(editorPatchRow({ id:`system-patch-removal:${r.patchId}`, label:'Layer D retraction draft', bounds:box(r.bounds[0],r.bounds[1],r.bounds[2],r.bounds[3]), sourceKey:r.sourceKey || null, detail:`remove ${r.patchId}`, subjectCategory:'structure' }));
  }
  const sourceByKey = new Map(sourceSelectables.filter(row => row?.sourceKey && row?.bounds).map(row => [String(row.sourceKey),row]));
  for (const o of document.sourceEntityOverrides || []) if (o.suppressed) {
    const sourceKey=`mark:${o.mark}`, source=sourceByKey.get(sourceKey), b=source?.bounds;
    if (b) rows.push(editorPatchRow({ id:`source:${sourceKey}`, label:'Suppressed production source', bounds:box(b.x,b.y,b.width,b.height), sourceKey, detail:'Suppressed or converted in this draft', subjectCategory:source?.category || 'actor', selection:{kind:'source',id:sourceKey,sourceKey} }));
  }
  return rows;
}

export function editorStructuralDiagnosticRows({ resolvedRoom = null } = {}) {
  if (!resolvedRoom) return [];
  const rawActors=resolvedRoom?.layers?.source?.rdx?.actors || [];
  return (resolvedRoom?.layers?.structuralCorrections?.operations || []).map(operation => {
    let bounds=null;
    if (Array.isArray(operation?.bounds) && operation.bounds.length >= 4) bounds=box(...operation.bounds.slice(0,4));
    else if (Array.isArray(operation?.g8Bounds) && operation.g8Bounds.length >= 4) bounds=box(operation.g8Bounds[0]*8,operation.g8Bounds[1]*8,operation.g8Bounds[2]*8,operation.g8Bounds[3]*8);
    else if (Number.isInteger(Number(operation?.spawnIndex))) {
      const actor=rawActors.find(row=>Number(row.index)===Number(operation.spawnIndex) && (operation.actorId == null || Number(row.actorId)===Number(operation.actorId)));
      if (actor) bounds=box(actor.x,actor.y,16,16);
    }
    if (!bounds) bounds=box(0,0,1,1);
    return Object.freeze({
      debugId:`structure:${operation.id}`, elementId:`structure:${operation.id}`, sourceKey:String(operation.sourceKey || operation.sourceRef || ''),
      category:'structure',subjectCategory:'structure',overlayType:'resolved-structural-correction',bounds,
      current:Object.freeze([bounds.x+bounds.width/2,bounds.y+bounds.height/2]),authority:String(operation.authority || 'resolved-level-layer-d'),
      policy:Object.freeze({family:'structure',label:String(operation.id || operation.type || 'Structural correction')}),
      notes:Object.freeze([String(operation.reason || operation.provenance || operation.type || '')].filter(Boolean)),
      layered:Object.freeze({structuralCorrections:Object.freeze([operation])})
    });
  });
}


function rectFromArray(value) {
  return Array.isArray(value) && value.length >= 4
    ? box(value[0], value[1], value[2], value[3]) : null;
}

function semanticBounds(object, runtimeState = null) {
  if (runtimeState?.draw && runtimeState?.size) return box(runtimeState.draw[0], runtimeState.draw[1], runtimeState.size[0], runtimeState.size[1]);
  const effective = object?.effective || {};
  const direct = rectFromArray(effective.gameplayBounds) || rectFromArray(effective.visualBounds) || rectFromArray(effective.supportBounds) || rectFromArray(effective.triggerBounds);
  if (direct) return direct;
  const draw = effective.visualAnchor || object?.baseline?.runtimeDraw || object?.baseline?.visualAnchor || effective.presentationOrigin || effective.position;
  const classic = object?.sourceEvidence?.classic || {};
  const state = object?.states?.snapshot || object?.states?.simulated || {};
  const size = Array.isArray(state.size) ? state.size : [classic.w || 16, classic.h || 16];
  return Array.isArray(draw) ? box(draw[0], draw[1], size[0] || 16, size[1] || 16) : null;
}

function structuralRowsForObject(room, object) {
  const sourceRef = String(object?.sources?.rdx?.ref || '');
  const sourceKey = String(object?.sources?.rdx?.sourceKey || '');
  const semanticId = String(object?.semanticId || '');
  return (room?.layers?.structuralCorrections?.operations || []).filter(operation => {
    const values = [operation?.sourceRef, operation?.target, operation?.sourceKey, operation?.semanticId].map(value => String(value || ''));
    return (sourceRef && values.includes(sourceRef)) || (sourceKey && values.includes(sourceKey)) || (semanticId && values.includes(semanticId));
  });
}

function rawRdxActorForObject(room, object) {
  const selector = object?.sourceSelector || object?.semantic?.sourceSelector || null;
  const actors = room?.layers?.source?.rdx?.actors || [];
  if (selector && Number.isInteger(Number(selector.spawnIndex)) && Number.isInteger(Number(selector.actorId))) {
    return actors.find(row => Number(row.index) === Number(selector.spawnIndex) && Number(row.actorId) === Number(selector.actorId)) || null;
  }
  const ref = String(object?.sources?.rdx?.ref || '');
  return actors.find(row => String(row.sourceRef || '') === ref) || null;
}

function layerPayloadForObject(room, object, runtimeState = null) {
  const alignmentRegion = (room?.layers?.alignment?.regions || []).find(region => String(region?.id || '') === String(object?.alignedBaseline?.authority || '')) || null;
  return Object.freeze({
    rdxSource: Object.freeze({ association:object?.sources?.rdx || null, rawActor:rawRdxActorForObject(room, object), roomRef:room?.layers?.source?.rdx?.ref || null }),
    classicSource: Object.freeze({ association:object?.sources?.classic || null, evidence:object?.sourceEvidence?.classic || null, roomRef:room?.layers?.source?.classic?.ref || null }),
    alignment: Object.freeze({ projectedBaseline:object?.alignedBaseline || null, region:alignmentRegion }),
    structuralCorrections: Object.freeze(structuralRowsForObject(room, object)),
    semantic: Object.freeze({
      semanticId:object?.semanticId || null, class:object?.class || null, family:object?.family || null, mounting:object?.mounting || null,
      controller:object?.controller || null, presentation:object?.presentation || null, collision:object?.collision || null,
      relationships:object?.relationships || [], components:object?.components || [], implementationDisposition:object?.implementationDisposition || null,
      sourceSelector:object?.sourceSelector || null, staticReplacement:object?.staticReplacement || null, authority:object?.authority || null
    }),
    adjustments: Object.freeze(object?.adjustmentsApplied || []),
    effective: Object.freeze(object?.effective || {}),
    runtime: runtimeState || null
  });
}

function layerPayloadForHazard(room, hazard) {
  const sourceKey = String(hazard?.sourceKey || '');
  const structuralCorrections = (room?.layers?.structuralCorrections?.operations || []).filter(operation =>
    sourceKey && [operation?.sourceKey, operation?.sourceRef, operation?.target].some(value => String(value || '').includes(sourceKey)));
  return Object.freeze({
    rdxSource:Object.freeze({sourceKey:hazard?.sourceKey || null,sourceSelector:hazard?.sourceSelector || null,sourceBounds:hazard?.sourceBounds || null,roomRef:room?.layers?.source?.rdx?.ref || null}),
    classicSource:Object.freeze({parentSourceKey:hazard?.classicParentSourceKey || null}),
    alignment:Object.freeze({roomRegions:room?.layers?.alignment?.regions || []}),
    structuralCorrections:Object.freeze(structuralCorrections),
    semantic:Object.freeze({id:hazard?.id || null,class:'trap',family:hazard?.family || null,mounting:hazard?.mounting || null,contact:hazard?.contact || null,visuals:hazard?.visuals || null,authority:hazard?.authority || null}),
    adjustments:Object.freeze(hazard?.adjustmentsApplied || []),
    effective:Object.freeze(hazard?.effective || {}),
    runtime:null
  });
}

export function editorLayerDiagnosticRows({ resolvedRoom = null, nativeStates = null } = {}) {
  if (!resolvedRoom) return [];
  const stateFor = key => nativeStates?.get?.(String(key || '')) || null;
  const rows=[];
  for (const object of resolvedRoom?.layers?.semanticCorpus?.objects || []) {
    const sourceKey=String(object?.sources?.rdx?.sourceKey || (object?.sources?.classic?.mark != null ? `mark:${object.sources.classic.mark}` : ''));
    const runtime=stateFor(sourceKey), bounds=semanticBounds(object,runtime); if(!bounds)continue;
    rows.push(Object.freeze({
      debugId:`layered:${object.semanticId}`, elementId:`layered:${object.semanticId}`, sourceKey,
      category:String(object.class || 'object'), subjectCategory:String(object.class || 'object'), overlayType:'layered-semantic-object',
      bounds, current:Object.freeze([bounds.x+bounds.width/2,bounds.y+bounds.height/2]),
      authority:'resolved-level', policy:Object.freeze({family:String(object.family || object.class || 'layered'),label:String(object.semanticId || 'Semantic object')}),
      notes:Object.freeze(object?.evidence || []), layered:layerPayloadForObject(resolvedRoom,object,runtime), semanticId:object.semanticId
    }));
  }
  for (const hazard of resolvedRoom?.layers?.semanticCorpus?.terrainHazards || []) {
    const effective=hazard?.effective || {}, bounds=rectFromArray(effective.gameplayBounds) || rectFromArray(effective.visualBounds) || (Array.isArray(effective.position) ? box(effective.position[0],effective.position[1],hazard?.contact?.bounds?.[2] || 8,hazard?.contact?.bounds?.[3] || 8) : null);
    if(!bounds)continue;
    rows.push(Object.freeze({
      debugId:`layered-hazard:${hazard.id}`, elementId:`layered-hazard:${hazard.id}`, sourceKey:String(hazard.sourceKey || ''),
      category:'trap',subjectCategory:'trap',overlayType:'layered-terrain-hazard',bounds,current:Object.freeze([bounds.x+bounds.width/2,bounds.y+bounds.height/2]),
      authority:'resolved-level',policy:Object.freeze({family:'trap',label:String(hazard.id || 'Terrain hazard')}),notes:Object.freeze(hazard?.evidence || []),
      layered:layerPayloadForHazard(resolvedRoom,hazard),semanticId:`${resolvedRoom.id}.trap.${hazard.id}`
    }));
  }
  return rows;
}

function editorRuntimeActivatorGeometry(rows, renderer, cellShiftMap = null, resolvedRoom = null) {
  const placements = new Map((renderer?.placementDiagnostics?.() || [])
    .filter(row => String(row?.subjectCategory || '') === 'activator' && row?.sourceKey && (row?.currentBounds || row?.fittedBounds))
    .map(row => [String(row.sourceKey), row]));
  const resolvedBySource = new Map(), sourceBySemanticId = new Map(), relatedSources = new Map();
  const semanticObjects = resolvedRoom?.layers?.semanticCorpus?.objects || [];
  for (const object of semanticObjects) {
    const sourceKey = String(object?.sources?.rdx?.sourceKey || (object?.sources?.classic?.mark != null ? `mark:${object.sources.classic.mark}` : ''));
    const semanticId = String(object?.semanticId || '');
    if (semanticId && sourceKey) sourceBySemanticId.set(semanticId, sourceKey);
    const trigger = rectFromArray(object?.effective?.triggerBounds);
    const semanticOffset = Array.isArray(object?.alignedTrigger?.semanticOffset) ? object.alignedTrigger.semanticOffset.map(num) : null;
    const rawBounds = trigger && semanticOffset && semanticOffset.length >= 2 && (semanticOffset[0] || semanticOffset[1])
      ? box(trigger.x - semanticOffset[0], trigger.y - semanticOffset[1], trigger.width, trigger.height)
      : null;
    if (sourceKey && trigger) resolvedBySource.set(sourceKey, {
      bounds:trigger,
      rawBounds,
      authority:object?.alignedTrigger?.authority || object?.authority || 'resolved-level-trigger'
    });
  }
  for (const object of semanticObjects) {
    const sourceKey = String(object?.sources?.rdx?.sourceKey || (object?.sources?.classic?.mark != null ? `mark:${object.sources.classic.mark}` : ''));
    if (!sourceKey) continue;
    const relations = [];
    for (const relation of object?.relationships || []) {
      const targetId = String(relation?.target || relation?.to || relation?.semanticId || '');
      const targetSourceKey = sourceBySemanticId.get(targetId);
      if (!targetSourceKey || targetSourceKey === sourceKey) continue;
      relations.push(Object.freeze({ sourceKey:targetSourceKey, type:String(relation?.type || 'semantic'), authority:String(relation?.authority || 'semantic-corpus') }));
    }
    if (relations.length) relatedSources.set(sourceKey, Object.freeze(relations));
  }
  if (!placements.size && !resolvedBySource.size && !relatedSources.size) return rows;
  return rows.map(row => {
    if (!editorInstanceTypeMatches(row, 'activator')) return row;
    const sourceKey = String(row?.sourceKey || '');
    const relationships = relatedSources.get(sourceKey) || Object.freeze([]);
    const withRelationships = relationships.length ? Object.freeze({ ...row, relatedSourceKeys:relationships }) : row;
    /* Layer B is the normalized Classic source leg. Do not overwrite its
     * trigger geometry with resolved RDX placement merely because the caller
     * supplied the resolved room for relationship lookup. Layer C/D projection
     * happens later through the shared Classic↔RDX correspondence map. */
    if (renderer?.selection?.visualSource === 'classic') return withRelationships;
    const placement = placements.get(sourceKey), resolved = resolvedBySource.get(sourceKey);
    const fittedBounds = placement?.fittedBounds || null;
    const currentBounds = placement?.currentBounds || resolved?.rawBounds || null;
    const rowSourceBounds = row?.sourceBounds && Number.isFinite(Number(row.sourceBounds.x)) && Number.isFinite(Number(row.sourceBounds.y))
      ? box(Number(row.sourceBounds.x), Number(row.sourceBounds.y), Number(row.sourceBounds.width), Number(row.sourceBounds.height)) : null;
    const production = fittedBounds || resolved?.bounds || currentBounds, rawOriginal = rowSourceBounds || diagnosticBounds(row);
    if (!production || !rawOriginal) return withRelationships;
    const levelOffset = renderer?.selection?.level?.pixelOffset || { dxPx:0, dyPx:0 };
    const classicBounds = {
      x:Number(rawOriginal.x) - Number(levelOffset.dxPx || 0),
      y:Number(rawOriginal.y) - Number(levelOffset.dyPx || 0),
      width:Number(rawOriginal.width), height:Number(rawOriginal.height)
    };
    const centerX = classicBounds.x + classicBounds.width / 2, centerY = classicBounds.y + classicBounds.height / 2;
    const mapped = cellShiftMap?.mapPresentationPixel?.(renderer?.selection?.submap, centerX, centerY, true) || null;
    const original = mapped ? {
      x:classicBounds.x + mapped.x - centerX, y:classicBounds.y + mapped.y - centerY,
      width:classicBounds.width, height:classicBounds.height
    } : rawOriginal;
    const comparison = currentBounds || original;
    const changed = production.x !== comparison.x || production.y !== comparison.y ||
      production.width !== comparison.width || production.height !== comparison.height;
    if (!changed) return withRelationships;
    const bounds = box(production.x, production.y, production.width, production.height);
    const preAdjustedBounds = box(comparison.x, comparison.y, comparison.width, comparison.height);
    return Object.freeze({
      ...withRelationships,
      current:Object.freeze([bounds.x + bounds.width / 2, bounds.y + bounds.height / 2]),
      bounds,
      envelope:Object.freeze({ minX:bounds.x, minY:bounds.y, maxX:bounds.x+bounds.width,
        maxY:bounds.y+bounds.height, width:bounds.width, height:bounds.height, sampleCount:1 }),
      authority:(fittedBounds ? 'reviewed-trigger-placement' : (placement?.authority || resolved?.authority || row.authority || 'production-activator-geometry')),
      productionBounds:bounds,
      preAdjustedBounds,
      notes:Object.freeze([...(row.notes || []), fittedBounds && currentBounds
        ? 'Selected trigger also shows its raw native/debug rectangle for comparison.'
        : 'Selected trigger also shows its pre-adjusted Classic-projected bounds.'])
    });
  });
}

export function editorDiagnosticRows({ renderer, dynamic, tick = 0, view = 'runtime', filter = 'all', document = null, sourceSelectables = [], stampBoundsFor = null, resolvedRoom = null, nativeStates = null, nativeGeometry = null, cellShiftMap = null } = {}) {
  let rows = [];
  if (view === 'shift') rows = [];
  else if (view === 'layers') {
    const layered = editorLayerDiagnosticRows({ resolvedRoom, nativeStates });
    /* Layers is an inspection of the currently rendered projection stage.
     * Keep mechanism geometry produced by that stage (Classic source geometry
     * on B, dense correspondence on C-E/F).  Runtime view separately replaces
     * trigger rectangles with native/effective gameplay geometry and shows the
     * pre-adjusted rectangle.  Reusing that runtime replacement here moved
     * SM0E mark169's Layer-E activator 16px below the shooter even though the
     * stage renderer had already projected it correctly. */
    const mechanisms = [...(dynamic?.enemyBehaviors || [])]
      .filter(row => ['activator','projectile-emitter','projectile-lane'].includes(String(row?.policy?.family || '')));
    rows = [...layered, ...mechanisms];
  }
  else if (view === 'structure') rows = editorStructuralDiagnosticRows({ resolvedRoom });
  else if (view === 'draft') rows = editorDraftPatchDiagnostics(document, { sourceSelectables, stampBoundsFor });
  else {
    const runtime = overlayNativeMotionGeometry([...(dynamic?.enemyBehaviors || [])], nativeGeometry);
    rows = view === 'runtime' ? editorRuntimeActivatorGeometry(runtime, renderer, cellShiftMap, resolvedRoom) : runtime;
  }
  if (filter !== 'all') rows = rows.filter(row => editorDebugFilterMatches(row, filter));
  if (filter === 'hazard' && view === 'runtime') rows = dedupeHazards(rows);
  return rows;
}

export function editorDiagnosticCandidates({ renderer, dynamic, rows = [], filter = 'all' } = {}) {
  const context = contextFor(renderer);
  let live = [...(dynamic?.selectables || [])];
  if (filter === 'hazard') live = live.filter(item => !!item?.hazardPotential);
  const diagnostics = rows.map(row => diagnosticSelectable(row, context)).filter(Boolean);
  return [...live, ...diagnostics];
}

export function editorInstanceTypeMatches(item, type = 'enemy') {
  const row = item?.debugRow || item || {};
  const family = String(row?.policy?.family || '');
  const category = String(item?.category || row?.category || '');
  const subject = String(row?.subjectCategory || '');
  const overlay = String(row?.overlayType || '');
  if (type === 'enemy') return category === 'enemy' || subject === 'enemy' || ['type1a','type1b'].includes(family);
  if (type === 'platform') return category === 'platform' || subject === 'platform' || family === 'platform';
  if (type === 'projectile-shooter') return category === 'projectile-shooter' || subject === 'projectile-shooter' || ['shooter','shooter-body'].includes(family);
  if (type === 'projectile-emitter') return category === 'projectile-emitter' || subject === 'projectile-emitter' || family === 'projectile-emitter';
  if (type === 'projectile-lane') return category === 'projectile-lane' || subject === 'projectile-lane' || family === 'projectile-lane';
  if (type === 'projectile') return category === 'projectile' || subject === 'projectile' || overlay === 'projectile';
  if (type === 'trap') return ['trap','hazard','blockage-hazard'].includes(family) || ['trap','hazard'].includes(category) || ['trap','hazard'].includes(subject) || overlay.includes('hazard');
  if (type === 'collectible') return category === 'collectible' || subject === 'collectible' || family === 'collectible';
  if (type === 'lure') return category === 'lure' || subject === 'lure' || family === 'lure';
  if (type === 'activator') return category === 'activator' || subject === 'activator' || family === 'activator' || overlay === 'activator';
  if (type === 'blockage') return category === 'blockage' || ['blockage','explodable'].includes(subject) || family === 'blockage-hazard';
  return false;
}

export function editorInstanceCandidates(candidates = [], type = 'enemy') {
  const seen = new Set();
  return candidates.filter(item => editorInstanceTypeMatches(item, type)).filter(item => {
    const id=String(item.elementId || item.debugId || item.instanceKey || item.sourceKey || item.id || '');
    if (!id || seen.has(id)) return false; seen.add(id); return true;
  });
}

export function diagnosticItemId(item) { return String(item?.elementId || item?.debugId || item?.sourceKey || item?.id || ''); }
export function diagnosticBounds(item) { return item?.bounds || item?.debugRow?.bounds || null; }
function pointSegmentDistance(point,a,b){
  const px=num(point?.x),py=num(point?.y),ax=num(a?.[0]),ay=num(a?.[1]),bx=num(b?.[0]),by=num(b?.[1]);
  const dx=bx-ax,dy=by-ay,den=dx*dx+dy*dy;if(!den)return Math.hypot(px-ax,py-ay);
  const t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/den)),x=ax+t*dx,y=ay+t*dy;return Math.hypot(px-x,py-y);
}
function diagnosticHit(item,point){
  const row=item?.debugRow||item||{};
  if(Array.isArray(row.hitPoint))return Math.hypot(num(point?.x)-num(row.hitPoint[0]),num(point?.y)-num(row.hitPoint[1]))<=Math.max(1,num(row.hitPointRadius||6));
  if(Array.isArray(row.pathPoints)&&row.pathPoints.length>=2&&num(row.hitPathTolerance)>0){
    for(let i=1;i<row.pathPoints.length;i++)if(pointSegmentDistance(point,row.pathPoints[i-1],row.pathPoints[i])<=num(row.hitPathTolerance))return true;
    return false;
  }
  const b=diagnosticBounds(item);return !!b&&point.x>=b.x&&point.y>=b.y&&point.x<=b.x+b.width&&point.y<=b.y+b.height;
}
export function hitDiagnosticCandidate(candidates, point) {
  const rows=candidates||[];
  /* Semantic point handles (notably projectile emitters) are deliberately
   * drawn on top of their lane. Give the point first refusal inside its small
   * hit radius so the lane's broader invisible tolerance cannot make the
   * emitter impossible to select at the muzzle. */
  for (let i=rows.length-1;i>=0;i--) {
    const row=rows[i]?.debugRow||rows[i]||{};
    if(Array.isArray(row.hitPoint)&&diagnosticHit(rows[i],point))return rows[i];
  }
  for (let i=rows.length-1;i>=0;i--) if(diagnosticHit(rows[i],point)) return rows[i];
  return null;
}
function diagnosticAnchor(item){
  const row=item?.debugRow||item||{};
  if(Array.isArray(row.connectionPoint))return Object.freeze([num(row.connectionPoint[0]),num(row.connectionPoint[1])]);
  if(Array.isArray(row.hitPoint))return Object.freeze([num(row.hitPoint[0]),num(row.hitPoint[1])]);
  const b=diagnosticBounds(item);return b?Object.freeze([b.x+b.width/2,b.y+b.height/2]):null;
}

export function diagnosticDisplayName(item) {
  const row=item?.debugRow || item || {};
  return String(row?.policy?.label || item?.role || row?.classification || row?.subjectCategory || item?.category || row?.overlayType || 'Diagnostic');
}

function activatorTargetScore(item, runtime = false) {
  const row=item?.debugRow || item || {};
  const family=String(row?.policy?.family || '');
  const category=String(item?.category || row?.category || '');
  const subject=String(row?.subjectCategory || '');
  const overlay=String(row?.overlayType || '');
  if (family === 'activator' || category === 'activator' || subject === 'activator' || overlay === 'activator') return -1;
  if (family === 'projectile-emitter' || category === 'projectile-emitter' || subject === 'projectile-emitter') return 200;
  if (family === 'shooter' || family === 'shooter-body' || category === 'projectile-shooter' || subject === 'projectile-shooter') return 120;
  if (family === 'collectible' || category === 'collectible' || subject === 'collectible') return 100;
  if (runtime && !overlay.includes('hazard') && category !== 'projectile' && subject !== 'projectile') return 80;
  if (!runtime && !['projectile','collision-hazard'].includes(category) && !overlay.includes('hazard')) return 65;
  if (runtime) return 40;
  return 20;
}

/** Resolve the production object controlled by each trigger. A Classic mark is
 * the stable relationship key: prefer a runtime semantic object (notably a
 * projectile shooter) and fall back to the source selectable that owns the
 * same mark. This keeps trigger diagnostics useful even when the active filter
 * hides the target row itself. */
export function editorActivatorConnections({ rows = [], targetRows = [], sourceSelectables = [] } = {}) {
  const runtimeBySource=new Map(), sourceBySource=new Map(), activatorBySource=new Map();
  /* The maintained editor passes the complete diagnostic set as `rows`; do
   * not require callers to duplicate emitter/lane rows through `targetRows`.
   * Runtime semantic targets are ranked ahead of source hit-test envelopes,
   * so projectile activators remain anchored to the stable muzzle point. */
  const runtimeTargets=[...(targetRows || []), ...(rows || [])];
  for (const row of runtimeTargets) {
    const key=String(row?.sourceKey || ''); if(!key || !diagnosticAnchor(row))continue;
    if (editorInstanceTypeMatches(row,'activator')) { if (!activatorBySource.has(key)) activatorBySource.set(key,row); continue; }
    const score=activatorTargetScore(row,true); if(score<0)continue;
    const prior=runtimeBySource.get(key); if(!prior || score>prior.score)runtimeBySource.set(key,{item:row,score});
  }
  for (const item of sourceSelectables || []) {
    const key=String(item?.sourceKey || ''); if(!key || !diagnosticAnchor(item))continue;
    const score=activatorTargetScore(item,false); if(score<0)continue;
    const prior=sourceBySource.get(key); if(!prior || score>prior.score)sourceBySource.set(key,{item,score});
  }
  const out=[], seen=new Set();
  const connect=(row, sourceKey, activatorBounds, target, relationship=null) => {
    const targetBounds=diagnosticBounds(target), targetPoint=diagnosticAnchor(target); if(!targetPoint)return;
    const activatorId=diagnosticItemId(row),targetId=diagnosticItemId(target);
    const key=`${activatorId}=>${targetId}`; if(!targetId||seen.has(key))return; seen.add(key);
    out.push(Object.freeze({
      sourceKey, activatorId, activatorBounds, targetId, targetBounds, targetPoint,
      targetCategory:String(target?.category || target?.subjectCategory || target?.policy?.family || 'actor'),
      relationship:relationship ? Object.freeze({type:String(relationship.type || 'semantic'),authority:String(relationship.authority || 'semantic-corpus'),sourceKey:String(relationship.sourceKey || '')}) : null
    }));
  };
  for (const row of rows || []) {
    if (!editorInstanceTypeMatches(row,'activator')) continue;
    const sourceKey=String(row?.sourceKey || ''); const activatorBounds=diagnosticBounds(row);
    if(!sourceKey || !activatorBounds)continue;
    const resolved=runtimeBySource.get(sourceKey) || sourceBySource.get(sourceKey);
    if(resolved)connect(row,sourceKey,activatorBounds,resolved.item);
    for (const relationship of row?.relatedSourceKeys || []) {
      const targetSourceKey=String(relationship?.sourceKey || ''); if(!targetSourceKey)continue;
      const relatedTarget=runtimeBySource.get(targetSourceKey) || sourceBySource.get(targetSourceKey);
      if(relatedTarget)connect(row,sourceKey,activatorBounds,relatedTarget.item,relationship);
      const relatedActivator=activatorBySource.get(targetSourceKey);
      if(relatedActivator)connect(row,sourceKey,activatorBounds,relatedActivator,relationship);
    }
  }
  return Object.freeze(out);
}

function styleFor(row) {
  if (row?.removedByDraft) return { stroke:'rgba(214,126,126,.92)', fill:'rgba(214,126,126,.025)', dash:[2,3], removed:true };
  const family=String(row?.policy?.family || row?.category || 'debug');
  if (family === 'editor-patch' || family === 'patch') return { stroke:'rgba(255,225,70,.98)', fill:'rgba(255,225,70,.04)', dash:[5,3] };
  if (family === 'placement') return { stroke:'rgba(80,220,235,.98)', fill:'rgba(80,220,235,.07)', dash:[] };
  if (family === 'no-overlap') return { stroke:'rgba(255,90,90,.98)', fill:'rgba(255,90,90,.09)', dash:[4,3] };
  if (['trap','hazard','blockage-hazard'].includes(family) || String(row?.overlayType||'').includes('hazard')) return { stroke:'rgba(255,90,90,.96)', fill:'rgba(255,90,90,.08)', dash:[3,3] };
  if (family === 'activator') return { stroke:'rgba(170,120,255,.92)', fill:'rgba(170,120,255,.05)', dash:[3,3] };
  if (family === 'collectible') return { stroke:'rgba(255,225,100,.96)', fill:'rgba(255,225,100,.08)', dash:[3,3] };
  if (family === 'shooter' || family === 'shooter-body' || family === 'projectile-emitter' || family === 'projectile-lane') return { stroke:'rgba(255,140,60,.96)', fill:'rgba(255,140,60,.08)', dash:[3,3] };
  if (family === 'type1a') return { stroke:'rgba(84,220,130,.96)', fill:'rgba(84,220,130,.08)', dash:[5,3] };
  if (family === 'type1b') return { stroke:'rgba(255,190,70,.96)', fill:'rgba(255,190,70,.08)', dash:[3,3] };
  if (family === 'action') return { stroke:'rgba(255,110,210,.96)', fill:'rgba(255,110,210,.06)', dash:[6,3] };
  if (family === 'platform') return { stroke:'rgba(80,220,235,.98)', fill:'rgba(80,220,235,.06)', dash:[5,3] };
  return { stroke:'rgba(96,180,255,.96)', fill:'rgba(96,180,255,.08)', dash:[3,3] };
}

export function drawEditorDiagnosticRows(context, rows = [], selectedId = '', { targetRows = [], sourceSelectables = [], showTrajectories = true } = {}) {
  if (!context) return;
  context.save(); context.font='8px ui-monospace, monospace'; context.textBaseline='bottom';
  for (const relation of editorActivatorConnections({rows,targetRows,sourceSelectables})) {
    const a=relation.activatorBounds,t=relation.targetBounds,p=relation.targetPoint;
    const selected=String(relation.activatorId)===String(selectedId||'') || String(relation.targetId)===String(selectedId||'');
    const ax=a.x+a.width/2,ay=a.y+a.height/2,tx=p[0],ty=p[1];
    context.strokeStyle=selected?'rgba(225,200,255,.98)':'rgba(190,145,255,.72)'; context.lineWidth=selected?2.25:1.25; context.setLineDash([4,3]);
    context.beginPath();context.moveTo(ax,ay);context.lineTo(tx,ty);context.stroke();context.setLineDash([]);
    context.strokeStyle=selected?'rgba(255,232,130,.98)':'rgba(255,225,130,.72)';context.fillStyle=context.strokeStyle;context.lineWidth=selected?2.25:1.25;context.setLineDash([]);
    if(t){context.fillStyle=selected?'rgba(255,225,130,.09)':'rgba(255,225,130,.035)';context.setLineDash([3,2]);context.fillRect(t.x,t.y,t.width,t.height);context.strokeRect(t.x+.5,t.y+.5,t.width,t.height);context.setLineDash([]);}else{context.beginPath();context.arc(tx,ty,selected?3.5:2.5,0,Math.PI*2);context.fill();}
    if(selected){const label='ACTIVATES';const w=Math.ceil(context.measureText(label).width)+6,x=Math.max(0,tx),y=Math.max(10,ty-2);context.fillStyle='rgba(5,10,18,.9)';context.fillRect(x,y-10,w,10);context.fillStyle='rgba(255,232,130,.98)';context.fillText(label,x+3,y-1);}
  }
  for (const row of rows) {
    const style=styleFor(row), selected=String(row.debugId||'')===String(selectedId||'') || String(row.elementId||'')===String(selectedId||'');
    const family=String(row?.policy?.family||'');
    if(family==='projectile-emitter'&&Array.isArray(row.connectionPoint)){
      const [x,y]=row.connectionPoint;context.fillStyle=style.stroke;context.beginPath();context.arc(num(x),num(y),selected?3.5:2.25,0,Math.PI*2);context.fill();
      if(selected){const label=diagnosticDisplayName(row),w=Math.ceil(context.measureText(label).width)+6,ly=Math.max(10,num(y)-2);context.fillStyle='rgba(5,10,18,.9)';context.fillRect(Math.max(0,num(x)),ly-10,w,10);context.fillStyle=style.stroke;context.fillText(label,Math.max(0,num(x))+3,ly-1);}continue;
    }
    if(family==='projectile-lane'&&Array.isArray(row.pathPoints)&&row.pathPoints.length>=2){
      const pts=row.pathPoints,clearance=Math.max(0,num(row.envelope?.height));const y0=num(pts[0][1]),lower=num(row.envelope?.maxY);
      context.fillStyle=selected?'rgba(255,140,60,.10)':'rgba(255,140,60,.045)';context.fillRect(Math.min(...pts.map(p=>num(p[0]))),Math.min(y0,lower),Math.max(1,Math.max(...pts.map(p=>num(p[0])))-Math.min(...pts.map(p=>num(p[0])))),Math.max(1,Math.abs(lower-y0)));
      context.strokeStyle=style.stroke;context.lineWidth=selected?2.5:1.75;context.setLineDash([]);context.beginPath();context.moveTo(num(pts[0][0]),num(pts[0][1]));for(const point of pts.slice(1))context.lineTo(num(point[0]),num(point[1]));context.stroke();
      context.setLineDash([3,3]);context.beginPath();context.moveTo(num(pts[0][0]),lower);context.lineTo(num(pts.at(-1)[0]),lower);context.stroke();context.setLineDash([]);continue;
    }
    if(family==='type1b'&&row.typeMarker===true){const b=row.bounds;if(!b)continue;context.fillStyle=style.stroke;context.beginPath();context.arc(b.x+2,b.y+2,selected?3:2,0,Math.PI*2);context.fill();continue;}
    if (row.policy?.family === 'placement') {
      const current=row.currentBounds, fitted=row.fittedBounds || row.bounds;
      if (current) { context.strokeStyle='rgba(170,176,188,.8)'; context.fillStyle='rgba(170,176,188,.035)'; context.lineWidth=1; context.setLineDash([4,3]); context.fillRect(current.x,current.y,current.width,current.height); context.strokeRect(current.x+.5,current.y+.5,current.width,current.height); }
      if (fitted) { context.strokeStyle=style.stroke; context.fillStyle=style.fill; context.lineWidth=selected?2.5:1.5; context.setLineDash([]); context.fillRect(fitted.x,fitted.y,fitted.width,fitted.height); context.strokeRect(fitted.x+.5,fitted.y+.5,fitted.width,fitted.height); }
      continue;
    }
    const hasMotionPath=(Array.isArray(row.pathSegments)&&row.pathSegments.length)||(Array.isArray(row.pathPoints)&&row.pathPoints.length>=2);
    /* Only a type-1A dangerEnvelope is a semantic swept rectangle. Type-3
     * and generic action envelopes are trace extents used internally for
     * indexing; drawing them as boxes falsely suggests collision geometry. */
    const b=family==='type1a' && row.dangerEnvelope
      ? {x:num(row.dangerEnvelope.minX),y:num(row.dangerEnvelope.minY),width:Math.max(1,num(row.dangerEnvelope.width)),height:Math.max(1,num(row.dangerEnvelope.height))}
      : row.bounds || null;
    if (b) {
      context.strokeStyle=style.stroke; context.fillStyle=style.fill; context.lineWidth=selected?2.5:1.35; context.setLineDash(style.dash); context.fillRect(b.x,b.y,b.width,b.height); context.strokeRect(b.x+.5,b.y+.5,b.width,b.height); context.setLineDash([]);
    }
    if(hasMotionPath && (family!=='platform' || showTrajectories)){
      context.strokeStyle=style.stroke;context.lineWidth=selected?2.5:1.75;context.setLineDash(family==='type3'||family==='action'?[6,3]:[]);context.beginPath();
      if(Array.isArray(row.pathSegments)&&row.pathSegments.length){for(const segment of row.pathSegments){context.moveTo(num(segment[0]),num(segment[1]));context.lineTo(num(segment[2]),num(segment[3]));}}
      else {const points=row.pathPoints;context.moveTo(num(points[0][0]),num(points[0][1]));for(const point of points.slice(1))context.lineTo(num(point[0]),num(point[1]));}
      context.stroke();context.setLineDash([]);
    }
    if (style.removed && b) {
      const inset=Math.min(3,Math.max(1,Math.min(b.width,b.height)/4));
      context.beginPath();
      context.moveTo(b.x+inset,b.y+inset); context.lineTo(b.x+b.width-inset,b.y+b.height-inset);
      context.moveTo(b.x+b.width-inset,b.y+inset); context.lineTo(b.x+inset,b.y+b.height-inset);
      context.stroke();
    }
    if (selected) { const label=`${style.removed?'REMOVED · ':''}${diagnosticDisplayName(row)}`; const w=Math.ceil(context.measureText(label).width)+6, anchor=b ? [b.x,b.y] : (row.pathPoints?.[0] || row.current || [0,10]), x=Math.max(0,num(anchor[0])), y=Math.max(10,num(anchor[1])-2); context.fillStyle='rgba(5,10,18,.9)';context.fillRect(x,y-10,w,10);context.fillStyle=style.stroke;context.fillText(label,x+3,y-1); }
  }
  context.restore();
}

/** Non-persistent single-cell inspection built from PreviewRenderer provenance.
 * The renderer owns descriptor/correspondence interpretation; the editor only
 * adds authored-document context around that production-derived cell. */
export function editorHoverCellInspection({ renderer, document, point, collisionBase = null, collisionEffective = null, collisionOverride = null } = {}) {
  const cell=renderer?.geometryCellAt?.(point?.x,point?.y,{includeOpen:true,includeProvenance:true}) || null;
  if(!cell)return null;
  const gx=Number(cell.grid?.x ?? cell.provenance?.coordinate?.grid8?.x), gy=Number(cell.grid?.y ?? cell.provenance?.coordinate?.grid8?.y);
  const logic=cell.provenance?.coordinate?.romLogic || {};
  const logicX=Number.isFinite(Number(logic.x)) ? Number(logic.x) : Math.floor(gx/2)+1;
  const logicY=Number.isFinite(Number(logic.y)) ? Number(logic.y) : Math.floor(gy/2)+1;
  const mapId=Number(cell.mapId ?? document?.base?.mapId ?? 0), visual=cell.provenance?.visual || null;
  const planeState = (plane, trace) => ({
    plane,
    id:`MD${String(mapId).padStart(4,'0')}#presentation#rdx:g8:${gx}:${gy}:${plane}`,
    state:plane==='A' && visual && visual.overlayAllowed===false ? 'disabled' : trace?.transparent ? 'transparent' : trace ? 'visible' : 'unresolved'
  });
  const editorTiles=(document?.tiles || []).filter(row=>Number(row.target?.[0])===gx&&Number(row.target?.[1])===gy).map(row=>({type:'presentation-cell',id:row.id,layer:row.layer,operation:row.operation,source:row.source,sourceMapId:row.sourceMapId,sourceLayer:row.sourceLayer}));
  const cell16X=Math.floor(gx/2),cell16Y=Math.floor(gy/2);
  const editorTerrain=(document?.terrain || []).filter(row=>Number(row.cell?.[0])===cell16X&&Number(row.cell?.[1])===cell16Y).map(row=>({type:'terrain',id:row.id,terrainSet:row.terrainSet,collisionMode:row.collisionMode,cell:[cell16X,cell16Y]}));
  const override=typeof collisionOverride==='function' ? collisionOverride(logicX,logicY) : null;
  return Object.freeze({
    id:String(cell.id), cell,
    presentation:Object.freeze({
      coordinate:Object.freeze({space:'rdx-g8-zero-based',x:gx,y:gy}),
      planes:Object.freeze([planeState('B',visual?.background),planeState('A',visual?.foreground)]),
      editorModifications:Object.freeze([...editorTiles,...editorTerrain])
    }),
    gameplay:Object.freeze({
      coordinate:Object.freeze({space:'native-mt-1-based',x:logicX,y:logicY}),
      mt:cell.provenance?.descriptor?.mt ?? cell.raw?.mt ?? null,
      ml:cell.provenance?.descriptor?.ml ?? cell.raw?.ml ?? null,
      effective8x8:Object.freeze({kind:cell.kindName || cell.kind || 'open',flags:Number(cell.flags || 0)&0xff,projection:cell.provenance?.projection?.source || cell.raw?.projection || null}),
      base:typeof collisionBase==='function' ? collisionBase(logicX,logicY) : null,
      effective:typeof collisionEffective==='function' ? collisionEffective(logicX,logicY) : null,
      override:override ? Object.freeze({id:override.id || null,collision:override.collision,mt:override.mt,ml:override.ml}) : null
    }),
    provenance:cell.provenance || null
  });
}
