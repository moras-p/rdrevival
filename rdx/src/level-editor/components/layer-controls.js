import { clear, element } from './dom.js';

export const STATIC_LAYER_CONTROLS = Object.freeze([
  Object.freeze({ id:'entities', label:'Entities & objects', description:'Production sprites and semantic objects', defaultVisible:true }),
  Object.freeze({ id:'bounds', label:'Typed bounds', description:'Visual, gameplay, trigger and support bounds', defaultVisible:false }),
  Object.freeze({ id:'collision', label:'Collision semantics', description:'Effective shared 8×8 gameplay cells', defaultVisible:false }),
  Object.freeze({ id:'correspondence', label:'Classic ↔ RDX field', description:'Dense reviewed cell correspondence', defaultVisible:false }),
  Object.freeze({ id:'provenance', label:'Layer D/F provenance', description:'Structural corrections and residual placement', defaultVisible:false }),
  Object.freeze({ id:'relationships', label:'Relationships', description:'Trigger, mechanism and source associations', defaultVisible:false }),
  Object.freeze({ id:'grid', label:'8×8 logical grid', description:'Shared Rick collision granularity', defaultVisible:false })
]);

export function createLayerVisibilityState() {
  return Object.fromEntries(STATIC_LAYER_CONTROLS.map(row => [row.id, row.defaultVisible]));
}

export function renderLayerControls(container, visibility, onChange) {
  clear(container);
  const list = element('div', { className:'layer-control-list' });
  for (const row of STATIC_LAYER_CONTROLS) {
    const label = element('label', { className:'layer-control' });
    const input = element('input', { attrs:{ type:'checkbox' } });
    const copy=element('span',{className:'layer-control-copy'});
    copy.append(element('b',{text:row.label}),element('small',{text:row.description}));
    input.checked = visibility[row.id] !== false;
    input.addEventListener('change', () => onChange(row.id, input.checked));
    label.append(input, copy);
    list.append(label);
  }
  container.append(list);
}
