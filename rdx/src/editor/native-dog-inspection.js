export const CASTLE_DOG_INSPECTION_FAMILY = 'castle-dog-scripted-state';

const int=(value,fallback=0)=>{const n=Number(value);return Number.isFinite(n)?Math.trunc(n):fallback;};

function dogSourceKeys(actors=[]) {
  return (actors||[])
    .filter(actor=>String(actor?.scriptedPresentation?.id||'')===CASTLE_DOG_INSPECTION_FAMILY)
    .map(actor=>String(actor?.sourceKey||''))
    .filter(Boolean);
}

function activeDogState(state) {
  const entity=state?.nativeEntity||{};
  return int(entity.c1,0)!==0;
}

/**
 * Editor-only orchestration for reviewed Castle dogs. The checkpoint contains
 * the real dormant native room. We only decide when to expose xrick's existing
 * simulate-all-triggers path and when to restore that checkpoint; dog motion,
 * facing, bounds and completion remain native-owned.
 */
export class NativeDogInspectionLoop {
  constructor({checkpointSlot=6,holdTicks=50}={}){
    this.checkpointSlot=int(checkpointSlot,6);
    this.holdTicks=Math.max(1,int(holdTicks,50));
    this.reset();
  }
  reset(){this.bridge=null;this.sourceKeys=[];this.phase='idle';this.sleepTicks=0;this.sawActive=false;this.checkpointSaved=false;}
  begin({bridge,actors=[]}={}){
    this.reset();
    this.bridge=bridge||null;
    this.sourceKeys=dogSourceKeys(actors);
    if(!this.bridge||!this.sourceKeys.length)return false;
    this.bridge.setSimulateAllTriggers(false);
    if(!this.bridge.debugCheckpointSave(this.checkpointSlot))throw new Error('Castle dog Simulate inspection could not save its dormant checkpoint.');
    this.checkpointSaved=true;
    this.phase='sleep';
    return true;
  }
  stop(){
    if(this.checkpointSaved&&this.bridge?.debugCheckpointDiscard)this.bridge.debugCheckpointDiscard(this.checkpointSlot);
    this.reset();
  }
  observe(states=new Map()){
    if(this.phase==='idle'||!this.bridge)return {restored:false,phase:this.phase};
    if(this.phase==='sleep'){
      this.sleepTicks+=1;
      if(this.sleepTicks>=this.holdTicks){
        this.phase='active';
        this.sawActive=false;
        this.bridge.setSimulateAllTriggers(true);
      }
      return {restored:false,phase:this.phase};
    }
    const active=this.sourceKeys.some(sourceKey=>activeDogState(states.get(sourceKey)));
    if(active)this.sawActive=true;
    if(!this.sawActive||active)return {restored:false,phase:this.phase};
    if(!this.bridge.debugCheckpointLoad(this.checkpointSlot))throw new Error('Castle dog Simulate inspection could not restore its dormant checkpoint.');
    this.bridge.setSimulateAllTriggers(false);
    this.bridge.setFrontendPaused(false);
    this.phase='sleep';
    this.sleepTicks=0;
    this.sawActive=false;
    return {restored:true,phase:this.phase};
  }
}
