const text=value=>String(value??'');
const componentGroup=id=>text(id).split('|component:',1)[0];

export function statefulComponentIdentity(semantic,stateOrSourceKey){
  const semanticId=text(semantic?.semanticId||semantic?.sourceRecordId||'semantic');
  const sourceKey=typeof stateOrSourceKey==='string'?stateOrSourceKey:text(stateOrSourceKey?.sourceKey);
  return `${semanticId}|component:${sourceKey||'main'}`;
}

export function statefulPresentationStateIdentity(semantic,state){
  return `${statefulComponentIdentity(semantic,state)}|state:${text(state?.stateKey)}|pn:${Number(state?.sourcePn)}`;
}

export function statefulPresentationComponents(semantic,states=[]){
  const groups=new Map();
  for(const state of states||[]){
    const sourceKey=text(state?.sourceKey);if(!sourceKey)continue;
    const id=statefulComponentIdentity(semantic,sourceKey),prior=groups.get(id);
    if(prior){prior.states.push(state);continue;}
    groups.set(id,{id,sourceKey,label:text(state?.owner||state?.componentKey||'Main'),componentKey:state?.componentKey==null?null:text(state.componentKey),states:[state]});
  }
  return [...groups.values()].map(group=>Object.freeze({...group,states:Object.freeze(group.states.slice())}));
}

export class StatefulComponentInspectionState {
  constructor(){this.hidden=new Set();this.soloId=null;}
  clear(){this.hidden.clear();this.soloId=null;}
  isHidden(id){return this.hidden.has(text(id));}
  isSoloed(id){return this.soloId===text(id);}
  setVisible(id,visible){const key=text(id);if(!key)return;if(visible)this.hidden.delete(key);else this.hidden.add(key);if(this.soloId===key&&!visible)this.soloId=null;}
  toggle(id){const key=text(id);this.setVisible(key,this.hidden.has(key));return !this.hidden.has(key);}
  solo(id){const key=text(id);this.soloId=this.soloId===key?null:key;return this.soloId;}
  visible(id,{forcedId=null}={}){
    const key=text(id),forced=text(forcedId);
    if(forced)return key===forced;
    if(this.soloId&&componentGroup(key)===componentGroup(this.soloId))return key===this.soloId;
    return !this.hidden.has(key);
  }
  snapshot(){return Object.freeze({hidden:Object.freeze([...this.hidden].sort()),soloId:this.soloId});}
}
