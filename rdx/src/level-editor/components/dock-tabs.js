function buttons(group){return [...group.querySelectorAll(':scope > .panel-tabs [data-tab]')];}
function panes(group){return [...group.querySelectorAll(':scope > .dock-panes > [data-pane]')];}

export function activateDockTab(group,id,{focus=false}={}){
  if(!group)return false;const value=String(id||''),tabButtons=buttons(group),tabPanes=panes(group);let matched=false;
  for(const button of tabButtons){const active=String(button.dataset.tab)===value;matched ||= active;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;if(active&&focus)button.focus();}
  for(const pane of tabPanes){const active=String(pane.dataset.pane)===value;pane.hidden=!active;pane.classList.toggle('active',active);}
  return matched;
}

export function bindDockTabs(group,{initial=null,storageKey=null,storage=globalThis.localStorage}={}){
  if(!group)return()=>{};const tabButtons=buttons(group);
  let stored=null;try{stored=storageKey?storage?.getItem(storageKey):null;}catch{}
  const first=stored||initial||tabButtons.find(button=>button.classList.contains('active'))?.dataset.tab||tabButtons[0]?.dataset.tab;
  activateDockTab(group,first);
  const listeners=[];
  const select=button=>{activateDockTab(group,button.dataset.tab,{focus:true});try{if(storageKey)storage?.setItem(storageKey,button.dataset.tab);}catch{}};
  for(const button of tabButtons){const handler=()=>select(button),keyHandler=event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const index=tabButtons.indexOf(button),next=event.key==='Home'?0:event.key==='End'?tabButtons.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabButtons.length)%tabButtons.length;select(tabButtons[next]);};button.addEventListener('click',handler);button.addEventListener('keydown',keyHandler);listeners.push([button,'click',handler],[button,'keydown',keyHandler]);}
  return()=>{for(const [button,type,handler] of listeners)button.removeEventListener(type,handler);};
}
