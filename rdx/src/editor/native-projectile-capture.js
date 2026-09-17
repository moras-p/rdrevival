import { NativeRuntimeTimeline } from './native-runtime-timeline.js';
import { isNativeProjectileActive } from './runtime-projectiles.js';

export const EDITOR_PROJECTILE_CHECKPOINT_SLOT = 6;

const int=(value,fallback=0)=>{const n=Number(value);return Number.isFinite(n)?Math.trunc(n):fallback;};

function sourceState(snapshot, sourceKey) {
  const mark = Number(String(sourceKey || '').replace(/^mark:/, ''));
  return (snapshot?.entities || []).find(entity => Number(entity?.mark) === mark) || null;
}

function namespacedState(state, session) {
  if (!state?.runtimeInstanceKey) return state;
  const key=String(state.runtimeInstanceKey).replace(/^session:\d+:/,`session:${Math.max(1,int(session,1))}:`);
  return key===state.runtimeInstanceKey?state:Object.freeze({...state,runtimeInstanceKey:key});
}

/**
 * Session-local native evidence for stationary projectile emitters that are
 * outside the currently resident xrick camera bank. Each source is sampled by
 * the real type-3 controller from an exact native checkpoint; this object only
 * stores/replays those observations for whole-room Simulate projection.
 */
export class NativeProjectileCaptureTimeline {
  constructor(){this.runtimeSession=0;this.records=new Map();}
  reset(){this.runtimeSession=0;this.records=new Map();}
  beginSession(runtimeSession=0){this.runtimeSession=Math.max(1,int(runtimeSession,this.runtimeSession+1));this.records=new Map();return this.runtimeSession;}
  setSourceTimeline(sourceKey,timeline){if(sourceKey&&timeline)this.records.set(String(sourceKey),timeline);}
  sourceRecord(sourceKey){return this.records.get(String(sourceKey||''))?.sourceRecord(String(sourceKey||''))||null;}
  sourceStateAt(sourceKey,tick){const state=this.records.get(String(sourceKey||''))?.sourceStateAt(String(sourceKey||''),tick)||null;return namespacedState(state,this.runtimeSession);}
  statesAt(tick){const states=new Map();for(const key of this.records.keys()){const state=this.sourceStateAt(key,tick);if(state)states.set(key,state);}return states;}
}

/**
 * Capture one native lifecycle per reviewed emitter without altering the live
 * Simulate session. The caller supplies the camera-row transform and draft
 * application because those are editor orchestration concerns, not projectile
 * semantics.
 */
export function captureNativeProjectileLifecycles({
  bridge, emitters=[], classicActors=[], timeline, cameraFrowForClassicY,
  applyDraft=()=>true, snapshot=()=>bridge?.snapshot(), maxFrames=300,
  checkpointSlot=EDITOR_PROJECTILE_CHECKPOINT_SLOT
}={}) {
  if(!bridge||!timeline||typeof cameraFrowForClassicY!=='function') return {captured:0,failed:[]};
  const classicBySource=new Map((classicActors||[]).map(row=>[String(row?.sourceKey||''),row]));
  const failures=[];
  let captured=0,saved=false;
  if(!bridge.debugCheckpointSave(checkpointSlot)) throw new Error('Native projectile Simulate capture could not save its checkpoint.');
  saved=true;
  try{
    for(const emitter of emitters||[]){
      const bodySourceKey=String(emitter?.bodySourceKey||emitter?.sourceKey||'');
      const reviewedCarrierSourceKeys=(Array.isArray(emitter?.nativeProjectileSourceKeys)&&emitter.nativeProjectileSourceKeys.length
        ? emitter.nativeProjectileSourceKeys : [emitter?.sourceKey]).map(String).filter(Boolean);
      const simulationSourceKey=String(emitter?.simulationProjectileSourceKey||reviewedCarrierSourceKeys[0]||'');
      const carrierSourceKeys=simulationSourceKey?[simulationSourceKey]:[];
      for(const sourceKey of carrierSourceKeys){
        const classic=classicBySource.get(sourceKey);
        const failure=(reason)=>failures.push({sourceKey:bodySourceKey||sourceKey,bodySourceKey:bodySourceKey||sourceKey,carrierSourceKey:sourceKey,reason});
        if(!sourceKey||!classic||!Array.isArray(classic.draw)){failure('missing-classic-source');continue;}
        if(!bridge.debugCheckpointLoad(checkpointSlot)) throw new Error(`Native projectile Simulate capture could not restore checkpoint for ${bodySourceKey||sourceKey} carrier ${sourceKey}.`);
        bridge.setFrontendPaused(true);
        bridge.setSimulateAllTriggers(false);
        const frow=cameraFrowForClassicY(Number(classic.draw[1]));
        if(!bridge.setCameraFrow(frow)){failure(`camera-row-${frow}-rejected`);continue;}
        applyDraft();
      /* Applying the typed editor draft clears/reinstalls transient source
       * suppressions and placements after map_init(). A trigger source that was
       * absent in the restored checkpoint is not automatically recreated merely
       * because its suppression disappeared. Rebuild current-room type-3 source
       * state now, after the final draft is installed, so the isolated camera
       * bank starts from the same dormant native controller contract as room
       * entry. The outer checkpoint restores the user's visible Simulate state. */
        if(typeof bridge.resetCurrentRoomTriggers==='function') bridge.resetCurrentRoomTriggers();
        bridge.setSimulateAllTriggers(true);

        const sourceTimeline=new NativeRuntimeTimeline({maxSamples:Math.max(32,int(maxFrames,300)),minLoopPeriod:4});
        sourceTimeline.beginSession();
        sourceTimeline.setPhaseZeroAnchors([],{classicActors:[classic]});
        let snap=snapshot();
        let entity=sourceState(snap,sourceKey);
        if(!entity){failure('native-slot-not-materialized');continue;}
        sourceTimeline.record(snap,snap?.presentation||[]);
        let sawActive=!!entity.projectileActive||isNativeProjectileActive(entity);
        let completed=false;
        for(let frame=0;frame<maxFrames;frame+=1){
          bridge.debugForceBrowserFrame();
          snap=snapshot();
          entity=sourceState(snap,sourceKey);
          if(!entity)break;
          if(entity.projectileActive||isNativeProjectileActive(entity))sawActive=true;
          sourceTimeline.record(snap,snap?.presentation||[]);
          const record=sourceTimeline.sourceRecord(sourceKey);
          if(sawActive&&record?.trajectoryLoopPeriod!=null){completed=true;break;}
        }
        if(!sawActive){failure('never-activated');continue;}
        if(!completed){failure('lifecycle-did-not-recur');continue;}
        timeline.setSourceTimeline(sourceKey,sourceTimeline);captured+=1;
      }
    }
  } finally {
    if(saved){
      const restored=bridge.debugCheckpointLoad(checkpointSlot);
      bridge.debugCheckpointDiscard(checkpointSlot);
      if(!restored) throw new Error('Native projectile Simulate capture could not restore the visible session checkpoint.');
    }
  }
  return {captured,failed:failures};
}
