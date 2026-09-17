import { clear, element } from './dom.js';
import { AUTHORING_TOOLS } from '../tools/editor-tool-controller.js';

function option(value,label){return element('option',{text:label,attrs:{value}});}
function selectField(label,select,help=''){const wrap=element('label',{className:'palette-field'});wrap.append(element('span',{text:label}),select);if(help)wrap.append(element('small',{text:help}));return wrap;}
export function renderTerrainPalette(container,{workspace,tools,showTools=true}={}){
  clear(container);
  const state=tools.snapshot();
  const toolRow=element('div',{className:'tool-grid'});
  for(const tool of AUTHORING_TOOLS){const button=element('button',{className:'tool-button',text:`${tool.label} ${tool.shortcut}`,attrs:{type:'button','aria-pressed':String(state.activeTool===tool.id),title:`${tool.label} (${tool.shortcut})`}});button.addEventListener('click',()=>tools.setTool(tool.id));toolRow.append(button);}
  if(showTools)container.append(toolRow);
  if(!workspace?.terrainResources){container.append(element('div',{className:'empty-state',text:'Open a room to load semantic terrain resources.'}));return;}
  const controls=element('div',{className:'tool-options'});
  const family=element('select',{attrs:{'aria-label':'Terrain family'}});
  for(const row of workspace.terrainResources.families||[])family.append(option(row.id,row.label||row.id));
  family.value=state.options.familyId || family.options[0]?.value || '';
  family.addEventListener('change',()=>tools.setOptions({familyId:family.value,materialId:null}));
  const material=element('select',{attrs:{'aria-label':'Terrain material'}}); material.append(option('','Auto material'));
  for(const row of workspace.terrainResources.materials||[])material.append(option(row.id,row.label||row.id));
  material.value=state.options.materialId || ''; material.addEventListener('change',()=>tools.setOptions({materialId:material.value||null}));
  const collision=element('select',{attrs:{'aria-label':'Collision exception semantic'}}); collision.append(option('open','G8 open'),option('one-way','G8 one-way'),option('climb-through','G8 climb-through'),option('lethal','G8 lethal')); collision.value=state.options.collisionSemantic; collision.addEventListener('change',()=>tools.setOptions({collisionSemantic:collision.value}));
  const motif=element('select',{attrs:{'aria-label':'Terrain motif'}}); motif.append(option('','Choose motif…')); for(const row of workspace.terrainResources.motifs||[])motif.append(option(row.id,row.label||row.id)); motif.value=state.options.motifId||''; motif.addEventListener('change',()=>tools.setOptions({motifId:motif.value||null}));
  controls.append(
    selectField('Terrain family',family,'16×16 semantic topology'),
    selectField('Material',material,'Auto selects a production-matching variant'),
    selectField('Exact collision',collision,'Used by the Collision tool only'),
    selectField('Motif',motif,'Production multi-cell construction')
  );
  const fillLabel=element('label',{className:'option-tile'}); const fill=element('input',{attrs:{type:'checkbox'}});fill.checked=!!state.options.rectangleFill;fill.addEventListener('change',()=>tools.setOptions({rectangleFill:fill.checked}));const fillCopy=element('span');fillCopy.append(element('b',{text:'Filled rectangle'}),element('small',{text:'Paint the rectangle interior, not only its perimeter'}));fillLabel.append(fill,fillCopy);controls.append(fillLabel);container.append(controls);
}
