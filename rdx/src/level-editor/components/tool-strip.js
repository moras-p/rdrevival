import { clear, element } from './dom.js';
import { AUTHORING_TOOLS } from '../tools/editor-tool-controller.js';

const ICONS=Object.freeze({select:'↖',pan:'✋','terrain-brush':'✎','terrain-line':'╱','terrain-rectangle':'▭','terrain-fill':'▨','terrain-erase':'⌫',collision:'▦',motif:'◆'});
export function renderToolStrip(container,{tools}={}){
  clear(container);if(!tools)return;
  const state=tools.snapshot();
  for(const tool of AUTHORING_TOOLS){const button=element('button',{attrs:{type:'button','aria-pressed':String(state.activeTool===tool.id),title:`${tool.label} (${tool.shortcut})`}}),icon=element('span',{className:'tool-icon',text:ICONS[tool.id]||'·'}),label=element('small',{text:tool.label});button.append(icon,label);button.addEventListener('click',()=>tools.setTool(tool.id));container.append(button);}
}
