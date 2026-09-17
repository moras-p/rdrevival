import { clear, element } from './dom.js';

const ICONS=Object.freeze({
  enemy:'◆','moving-platform':'▬',platform:'▬',trap:'▲',mechanism:'⚙',shooter:'⌁','projectile-emitter':'•',collectible:'◇',trigger:'◌',blockage:'■',source:'⌘',object:'◆'
});

function iconFor(item){return ICONS[item.class]||ICONS[item.family]||ICONS[item.kind]||ICONS.object;}
function displayLabel(item){const value=String(item.label||item.id||'');const match=value.match(/\.mark-(\d+)$/);return match?`mark ${match[1]} · ${value.split('.')[1]||value}`:value;}

function buttonFor(item, selectedId, onSelect) {
  const button = element('button', { className:'scene-row', attrs:{ type:'button', 'aria-pressed':String(String(item.id) === String(selectedId)), title:String(item.id||'') } });
  button.append(
    element('span',{className:'scene-row-icon',text:iconFor(item)}),
    element('span', { className:'scene-row-copy' }),
    element('span', { className:'scene-row-meta', text:item.meta || item.kind || '' })
  );
  const copy=button.querySelector('.scene-row-copy');
  copy.append(element('strong',{text:displayLabel(item)}),element('small',{text:String(item.id||'')}));
  button.addEventListener('click', () => onSelect(item));
  return button;
}

function groupBlock(name,items,selectedId,onSelect,{open=true}={}){
  const group=element('details',{className:'scene-group',attrs:open?{open:''}:{}}),summary=element('summary');
  summary.append(element('span',{className:'scene-group-disclosure',text:'⌄'}),element('span',{className:'scene-group-name',text:name}),element('span',{className:'scene-group-count',text:String(items.length)}));
  const rows=element('div',{className:'scene-group-items'});for(const item of items)rows.append(buttonFor(item,selectedId,onSelect));
  group.append(summary,rows);return group;
}

export function renderSceneNavigation(container, project, graph, selectedId, onSelect, { filter = '' } = {}) {
  clear(container);
  if (!project) { container.append(element('div', { className:'empty-state', text:'No room loaded.' })); return; }
  const query=String(filter||'').trim().toLowerCase();
  const matches=item=>!query || [item.id,item.label,item.meta,item.kind,item.class,item.family].filter(Boolean).some(value=>String(value).toLowerCase().includes(query));
  const groups = new Map();
  for (const entity of project.entities || []) {
    if (!matches(entity)) continue;
    const className = entity.class || entity.kind || 'object';
    if (!groups.has(className)) groups.set(className, []);
    groups.get(className).push({ id:entity.id, kind:entity.kind, class:entity.class, family:entity.family, label:entity.id, meta:entity.family || className });
  }
  const wrapper = element('div', { className:'scene-navigation scene-tree' });
  for (const [name, items] of [...groups.entries()].sort((a,b) => a[0].localeCompare(b[0]))) wrapper.append(groupBlock(name,items,selectedId,onSelect));
  const visibleEntityIds = new Set((project.entities || []).map(row => String(row.id)));
  const graphRows = (graph?.nodes || []).filter(node => !visibleEntityIds.has(String(node.id)) && matches({ ...node, meta:node.kind }));
  if (graphRows.length) wrapper.append(groupBlock('Sources & related',graphRows.map(node=>({ id:node.id, kind:node.kind, class:'source', label:node.label || node.id, meta:node.kind })),selectedId,onSelect,{open:false}));
  if (!wrapper.childElementCount) wrapper.append(element('div', { className:'empty-state', text:query ? 'No matching objects or sources.' : 'No objects or sources.' }));
  container.append(wrapper);
}
