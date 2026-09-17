const STORAGE_KEY = 'rdr.level-editor.layout.v1';
const DEFAULTS = Object.freeze({ leftWidth:258, rightWidth:326, leftCollapsed:false, rightCollapsed:false });
const clamp = (value,min,max) => Math.max(min,Math.min(max,Number(value)||0));

function loadState(storage) {
  try {
    const raw=storage?.getItem(STORAGE_KEY);
    if(raw)return { state:{...DEFAULTS,...JSON.parse(raw)}, stored:true };
  } catch {}
  return { state:{...DEFAULTS}, stored:false };
}

function saveState(storage,state) {
  try { storage?.setItem(STORAGE_KEY,JSON.stringify(state)); } catch {}
}

export class DockLayoutController {
  constructor({ workspace, leftDock, rightDock, leftHandle, rightHandle, leftToggle, rightToggle, storage=globalThis.localStorage, onLayout=()=>{} }={}) {
    if (!workspace) throw new TypeError('DockLayoutController requires workspace');
    this.workspace=workspace; this.leftDock=leftDock; this.rightDock=rightDock; this.leftHandle=leftHandle; this.rightHandle=rightHandle;
    this.leftToggle=leftToggle; this.rightToggle=rightToggle; this.storage=storage; this.onLayout=onLayout; const loaded=loadState(storage); this.state=loaded.state; this.drag=null;
    if(!loaded.stored){const width=Number(globalThis.innerWidth)||1280;if(width<920)this.state.rightCollapsed=true;if(width<680)this.state.leftCollapsed=true;}
    this.handlers=[]; this.apply(); this.bind();
  }
  persist(){ saveState(this.storage,this.state); }
  apply(){
    this.workspace.style.setProperty('--left-dock-width',`${clamp(this.state.leftWidth,210,430)}px`);
    this.workspace.style.setProperty('--right-dock-width',`${clamp(this.state.rightWidth,250,470)}px`);
    this.workspace.classList.toggle('left-collapsed',!!this.state.leftCollapsed);
    this.workspace.classList.toggle('right-collapsed',!!this.state.rightCollapsed);
    if(this.leftToggle){this.leftToggle.setAttribute('aria-pressed',String(!this.state.leftCollapsed));this.leftToggle.title=this.state.leftCollapsed?'Show scene dock':'Hide scene dock';}
    if(this.rightToggle){this.rightToggle.setAttribute('aria-pressed',String(!this.state.rightCollapsed));this.rightToggle.title=this.state.rightCollapsed?'Show inspector dock':'Hide inspector dock';}
    queueMicrotask(()=>this.onLayout());
  }
  setCollapsed(side,value){this.state[`${side}Collapsed`]=!!value;this.persist();this.apply();}
  toggle(side){this.setCollapsed(side,!this.state[`${side}Collapsed`]);}
  reset(side){this.state[`${side}Width`]=DEFAULTS[`${side}Width`];this.state[`${side}Collapsed`]=false;this.persist();this.apply();}
  bind(){
    const listen=(node,type,handler)=>{if(!node)return;node.addEventListener(type,handler);this.handlers.push([node,type,handler]);};
    listen(this.leftToggle,'click',()=>this.toggle('left')); listen(this.rightToggle,'click',()=>this.toggle('right'));
    listen(this.leftHandle,'dblclick',()=>this.reset('left')); listen(this.rightHandle,'dblclick',()=>this.reset('right'));
    const begin=(side,event)=>{if(event.button!==0)return;event.preventDefault();this.drag={side,startX:event.clientX,startWidth:this.state[`${side}Width`]};event.currentTarget.setPointerCapture?.(event.pointerId);this.workspace.classList.add('resizing-dock');};
    listen(this.leftHandle,'pointerdown',event=>begin('left',event)); listen(this.rightHandle,'pointerdown',event=>begin('right',event));
    const move=event=>{if(!this.drag)return;const direction=this.drag.side==='left'?1:-1;this.state[`${this.drag.side}Width`]=clamp(this.drag.startWidth+(event.clientX-this.drag.startX)*direction,this.drag.side==='left'?210:250,this.drag.side==='left'?430:470);this.apply();};
    const end=()=>{if(!this.drag)return;this.drag=null;this.workspace.classList.remove('resizing-dock');this.persist();this.onLayout();};
    listen(window,'pointermove',move);listen(window,'pointerup',end);listen(window,'pointercancel',end);
  }
  dispose(){for(const [node,type,handler] of this.handlers)node.removeEventListener(type,handler);this.handlers=[];}
}
