import { clear, detailsList, element, section } from './dom.js';

function compact(value) {
  if (value == null) return '—';
  if (Array.isArray(value)) return `[${value.join(', ')}]`;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function layerSummary(row) {
  const value = row.value;
  const count = Array.isArray(value?.operations) ? `${value.operations.length} operations`
    : Array.isArray(value?.objects) ? `${value.objects.length} objects`
    : value ? 'available' : 'absent';
  return `${count} · ${row.authority}`;
}


function spritePreview(inspection) {
  const entity=inspection?.entity, sprite=entity?.sprite;
  if(!sprite?.data||!sprite.width||!sprite.height)return null;
  const card=element('div',{className:'selection-overview'}),canvas=element('canvas',{className:'selection-preview',attrs:{width:58,height:58}}),copy=element('div',{className:'selection-overview-copy'});
  const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;
  try{
    const source=document.createElement('canvas');source.width=sprite.width;source.height=sprite.height;const sourceCtx=source.getContext('2d');sourceCtx.putImageData(new ImageData(new Uint8ClampedArray(sprite.data),sprite.width,sprite.height),0,0);
    const scale=Math.max(1,Math.min(4,Math.floor(Math.min(50/sprite.width,50/sprite.height)))),width=sprite.width*scale,height=sprite.height*scale;ctx.drawImage(source,Math.floor((58-width)/2),Math.floor((58-height)/2),width,height);
  }catch{}
  const object=inspection.object||inspection.hazard||{};copy.append(element('strong',{text:object.class||entity.class||object.family||entity.family||'Selected object'}),element('span',{text:object.family||entity.family||entity.kind||''}),element('small',{text:String(entity.id||inspection.id||'')}));card.append(canvas,copy);return card;
}

function renderLayerProvenance(provenance) {
  const table = element('div', { className:'provenance-table' });
  for (const row of provenance || []) {
    const item = element('div', { className:'provenance-row' });
    item.append(element('strong', { className:'provenance-layer', text:row.layer }), element('span', { className:'provenance-name', text:row.label }), element('span', { className:'provenance-meta', text:layerSummary(row) }));
    table.append(item);
  }
  return table;
}

function relationshipButtons(graph, selectedId, onNavigate) {
  const edges = (graph?.edges || []).filter(edge => String(edge.from) === String(selectedId) || String(edge.to) === String(selectedId));
  if (!edges.length) return element('div', { className:'muted', text:'No static relationships recorded for this selection.' });
  const list = element('div', { className:'relationship-list' });
  for (const edge of edges) {
    const other = String(edge.from) === String(selectedId) ? edge.to : edge.from;
    const button = element('button', { className:'relationship-row', attrs:{ type:'button' } });
    button.append(element('span', { text:edge.type }), element('span', { className:'relationship-arrow', text:String(edge.from) === String(selectedId) ? '→' : '←' }), element('span', { text:other }));
    button.title = edge.authority || '';
    button.addEventListener('click', () => onNavigate({ kind:graph.nodes?.find(node => String(node.id) === String(other))?.kind || 'semantic-object', id:String(other) }));
    list.append(button);
  }
  return list;
}

function entityDetails(object, entity) {
  const source = object?.sourceEvidence?.classic || null;
  const effective = object?.effective || {};
  const state = object?.states?.snapshot || object?.states?.simulated || {};
  const patrol = object?.controller?.patrol || object?.controller?.bounds || object?.controller?.descriptor || object?.controller?.staticDescriptor || null;
  return detailsList([
    ['ID', entity.id], ['Class', object?.class || entity.class], ['Family', object?.family || entity.family],
    ['Controller', object?.controller?.authority || object?.controller?.type || object?.controller?.kind],
    ['Source record', object?.sourceRecordId], ['Source IDs', Object.values(object?.sources || {}).map(row => row?.ref).filter(Boolean)],
    ['Source position', source ? [source.x, source.y] : null], ['Effective position', effective.position || effective.visualAnchor || effective.presentationOrigin],
    ['Visual bounds', effective.visualBounds], ['Gameplay bounds', effective.gameplayBounds], ['Trigger bounds', effective.triggerBounds],
    ['Presentation owner', object?.presentation?.owner], ['PN / frame', state.pn ?? object?.presentation?.pnByState?.snapshot ?? object?.presentation?.pnByState?.simulated],
    ['Static patrol descriptor', patrol]
  ]);
}

function inspectDetails(inspection, graph) {
  if (!inspection) return element('div', { className:'muted', text:'Nothing selected.' });
  if (inspection.object) return entityDetails(inspection.object, inspection.entity);
  if (inspection.hazard) {
    const hazard=inspection.hazard, effective=hazard.effective || {};
    return detailsList([
      ['ID', inspection.entity.id], ['Class', 'trap'], ['Family', hazard.family], ['State', hazard.state], ['Mounting', hazard.mounting],
      ['Source ID', hazard.sourceId], ['Source key', hazard.sourceKey], ['Source bounds', hazard.sourceBounds], ['Effective position', effective.position || hazard.position],
      ['Visual bounds', effective.visualBounds], ['Gameplay/contact bounds', effective.gameplayBounds || hazard?.contact?.bounds], ['Lethal', hazard?.contact?.lethal],
      ['Presentation asset', hazard?.visuals?.static?.asset?.kind || (inspection.entity.sprite ? 'reviewed trap registry tile-pair' : null)], ['Authority', hazard.authority], ['Evidence', hazard.evidence]
    ]);
  }
  if (inspection.correspondence) {
    const c = inspection.correspondence;
    return detailsList([
      ['Cell', `${c.side} ${c.x},${c.y}`], ['Mapped', c.mapped ? 'yes' : 'no'],
      ['Classic cell', c.classicX != null ? [c.classicX, c.classicY] : c.cx != null ? [c.cx,c.cy] : null],
      ['RDX cell', c.rdxX != null ? [c.rdxX, c.rdxY] : c.rx != null ? [c.rx,c.ry] : null],
      ['Local shift', [c.dxPx ?? c.dx ?? c.shiftX ?? 0, c.dyPx ?? c.dy ?? c.shiftY ?? 0]], ['Confidence', c.confidence],
      ['Source alignment', inspection.alignment?.source || inspection.alignment?.reviewed || inspection.alignment], ['Effective alignment', inspection.alignment?.effective || inspection.alignment]
    ]);
  }
  if (inspection.collision) {
    const c=inspection.collision;
    return detailsList([['G8 cell', [c.gx,c.gy]], ['Raw RDX', c.rawKind], ['Effective', c.effectiveKind], ['Override', c.override?.id || null],
      ['Exit direction', c.override?.action === 'exit' ? c.override?.direction : null], ['xrick rowout', c.override?.action === 'exit' ? `0x${Number(c.override?.contactRow).toString(16)}` : null],
      ['Destination', c.override?.action === 'exit' ? `SM${Number(c.override?.targetSubmap).toString(16).toUpperCase().padStart(2,'0')} / rowin 0x${Number(c.override?.rowIn).toString(16)}` : null],
      ['Override reason', c.override?.reason || c.override?.provenance], ['Geometry source', c.sourceProven]]);
  }
  if (inspection.provenance) {
    const p=inspection.provenance;
    return detailsList([['Layer', p.layer], ['Operation', p.id], ['Type', p.operation?.type || p.operation?.property], ['Reason', p.reason], ['Authority', p.authority], ['Bounds', p.operation?.bounds || p.operation?.g8Bounds || p.operation?.operation?.rect]]);
  }
  const graphNode = graph?.nodes?.find(node => String(node.id) === String(inspection.id));
  if (graphNode) return detailsList([['ID', graphNode.id], ['Kind', graphNode.kind], ['Label', graphNode.label], ['Coordinate space', graphNode.coordinateSpace], ['Position', graphNode.position]]);
  return detailsList([['Selection', inspection.id], ['Kind', inspection.kind]]);
}

export function renderRoomSummary(container, project) {
  clear(container);
  if (!project) { container.classList.add('muted'); container.append(element('span',{text:'No room loaded.'})); return; }
  container.classList.remove('muted');
  const room=project.room, rdx=project.panes.find(row=>row.id==='rdx'), classic=project.panes.find(row=>row.id==='classic');
  container.append(detailsList([
    ['Room', room.id], ['Map', room.mapName], ['Group', room.group],
    ['RDX size', rdx ? `${rdx.width}×${rdx.height}` : room?.layers?.source?.rdx?.dimensions ? `${room.layers.source.rdx.dimensions.width}×${room.layers.source.rdx.dimensions.height}` : null],
    ['Classic size', classic ? `${classic.width}×${classic.height}` : null], ['Objects', room?.layers?.semanticCorpus?.objects?.length || 0],
    ['Correspondence', project.correspondenceSummary ? `${project.correspondenceSummary.mappedCells ?? project.correspondenceSummary.mapped ?? 'available'} mapped` : 'unavailable']
  ]));
}

export function renderInspector(container, { project, inspection, selection, graph, onNavigate }) {
  clear(container);
  if (!project) { container.append(element('div',{className:'muted',text:'Open a room to inspect static data.'})); return; }
  const selectedId=selection?.id || inspection?.id || null;
  const overview=spritePreview(inspection),selectionBody=element('div',{className:'selection-inspector-body'});if(overview)selectionBody.append(overview);selectionBody.append(inspectDetails(inspection, graph));
  container.append(section('Selection', selectionBody));
  container.append(section('Relationships', relationshipButtons(graph, selectedId, onNavigate)));
  container.append(section('Layers A–F', renderLayerProvenance(project.provenance)));
  if (project.collisionSummary) container.append(section('Collision source', detailsList([
    ['Availability', project.collisionSummary.availability], ['Coverage', project.collisionSummary.coverage], ['Verified classes', compact(project.collisionSummary.verifiedClasses)], ['Unresolved classes', compact(project.collisionSummary.unresolvedClasses)], ['Notes', project.collisionSummary.notes]
  ])));
}
