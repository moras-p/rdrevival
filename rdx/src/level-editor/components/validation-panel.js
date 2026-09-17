import { clear, element } from './dom.js';
export function renderValidationPanel(container,{workspace}={}){
  clear(container);const rows=workspace?.validationIssues?.()||[];
  if(!rows.length){container.append(element('div',{className:'validation-ok',text:'No working-draft validation issues.'}));return;}
  for(const row of rows){const item=element('div',{className:`validation-row validation-${row.severity||'info'}`});item.append(element('strong',{text:row.code||row.severity||'Issue'}),element('span',{text:row.message||String(row)}));container.append(item);}
}
