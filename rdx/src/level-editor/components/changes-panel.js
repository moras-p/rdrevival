import { clear, element } from './dom.js';
export function renderChangesPanel(container,{workspace,onRemoveCorrection=()=>{}}={}){
  clear(container);const rows=workspace?.changes?.()||[];
  if(!rows.length){container.append(element('div',{className:'muted',text:'No working-draft changes.'}));return;}
  const list=element('div',{className:'changes-list'});
  for(const row of rows){const item=element('div',{className:'change-row'}),text=element('div',{className:'change-text'});text.append(element('strong',{text:row.label}),element('span',{className:'change-semantic',text:row.semantic||row.kind}));item.append(text);if(row.kind==='correction'){const remove=element('button',{text:'×',attrs:{type:'button',title:'Remove correction','aria-label':`Remove ${row.label}`}});remove.addEventListener('click',()=>onRemoveCorrection(row.id));item.append(remove);}list.append(item);}
  container.append(list);
}
