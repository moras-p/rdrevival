import { createRealtimeContinuationPolicy, evaluateRealtimeContinuationProgress } from './realtime-continuation-policy.js';

const continuousKind = info => info?.kind==='continuous' || Number(info?.kindId)===1;
const cloneActive = a => a ? Object.freeze({id:a.id,name:a.name,kind:a.kind,age:a.age,currentMask:a.currentMask,startFrame:a.startFrame,lastRenewedFrame:a.lastRenewedFrame,minCommitUntilFrame:a.minCommitUntilFrame,safeUntilFrame:a.safeUntilFrame,hardExpiryFrame:a.hardExpiryFrame,intentId:a.intentId,endReason:a.endReason||null}) : null;

export class RealtimeIntentExecutor {
  constructor({bridge,applyMask=()=>{},continuationPolicy=createRealtimeContinuationPolicy(),trace=null,captureObservation=null}={}){
    if(!bridge) throw new Error('RealtimeIntentExecutor requires bridge');
    this.bridge=bridge;this.applyMask=applyMask;this.continuationPolicy=continuationPolicy;this.trace=trace;this.captureObservation=captureObservation||(()=>bridge.agentObservation());
    this.activeIntent=null;this.nextIntentId=1;this.currentMask=0;this.lastDisposition=null;this.lastEndReason=null;this.neutralGapFrames=0;this.completed=[];
  }
  reset({release=true,reason='stopped'}={}){if(this.activeIntent)this.#finish(reason,{release});else if(release)this.#mask(0);this.activeIntent=null;this.currentMask=0;this.lastDisposition=null;this.lastEndReason=null;this.neutralGapFrames=0;this.completed.length=0;}
  status(){return Object.freeze({active:cloneActive(this.activeIntent),currentMask:this.currentMask,lastDisposition:this.lastDisposition,lastEndReason:this.lastEndReason,neutralGapFramesBetweenEquivalentContinuousIntents:this.neutralGapFrames});}
  recordRequestPendingFrame(){if(this.isContinuous()&&this.activeIntent?.receiptId&&this.trace?.continuationPending)return this.trace.continuationPending(this.activeIntent.receiptId);return false;}
  hasActive(){return !!this.activeIntent;}
  isContinuous(){return continuousKind(this.activeIntent?.execution);}
  isAtomic(){return !!this.activeIntent&&!this.isContinuous();}
  #mask(mask){this.currentMask=Number(mask)>>>0;this.applyMask(this.currentMask);}
  #execution(choice){return choice?.execution||this.bridge.agentActionExecutionInfo?.(choice.id)||Object.freeze({kind:'atomic',kindId:0,continuousMask:0,minCommitFrames:0,flags:0});}
  #outcome(active,endObservation,reason){return {dx:(Number(endObservation?.player?.xFp||0)-active.startXfp)/256,dy:(Number(endObservation?.player?.yFp||0)-active.startYfp)/256,blocked:reason==='became-illegal',landed:!!endObservation?.player?.grounded,death:!!endObservation?.player?.dead,transition:endObservation?.episode?.roomGeneration!==active.roomGeneration,bulletsUsed:Math.max(0,active.startBullets-Number(endObservation?.player?.bullets||0)),dynamiteUsed:Math.max(0,active.startDynamite-Number(endObservation?.player?.dynamite||0))};}
  #finish(reason,{release=true,frameSerial=null}={}){
    const active=this.activeIntent;if(!active)return null;
    if(release)this.#mask(0);
    let observation=null,outcome=null;
    try{observation=this.captureObservation();outcome=this.#outcome(active,observation,reason);}catch(_){outcome=null;}
    const endFrame=frameSerial??observation?.episode?.frameSerial??active.lastAppliedFrame??active.startFrame;
    if(active.receiptId&&this.trace?.intentEnded)this.trace.intentEnded(active.receiptId,{frame:endFrame,reason,outcome});
    else if(active.receiptId&&this.trace?.finalize)this.trace.finalize(active.receiptId,{accepted:true,reason,outcome});
    const event={intentId:active.intentId,action:active.name,startFrame:active.startFrame,endFrame,reason,outcome,endObservation:observation};this.completed.push(event);if(this.completed.length>32)this.completed.shift();
    this.activeIntent=null;this.lastEndReason=reason;return event;
  }
  drainCompleted(){const out=this.completed.splice(0);return out;}
  accept({choice,observation,frameSerial=observation?.episode?.frameSerial??0,receiptId=null,decision=null}={}){
    if(!choice) throw new Error('RealtimeIntentExecutor accept requires choice');
    const execution=this.#execution(choice),frame=Number(frameSerial)>>>0;
    if(this.activeIntent&&this.isContinuous()&&continuousKind(execution)&&this.activeIntent.id===choice.id){
      const lease=this.continuationPolicy.lease(choice.name,observation,frame);
      if(this.activeIntent.receiptId&&this.trace?.intentEnded)this.trace.intentEnded(this.activeIntent.receiptId,{frame,reason:'renewed',outcome:null});
      else if(this.activeIntent.receiptId&&this.trace?.finalize)this.trace.finalize(this.activeIntent.receiptId,{accepted:true,reason:'renewed',outcome:null});
      this.activeIntent.receiptId=receiptId;this.activeIntent.decision=decision;this.activeIntent.lastRenewedFrame=frame;this.activeIntent.safeUntilFrame=lease.safeUntilFrame;this.activeIntent.hardExpiryFrame=lease.hardExpiryFrame;this.activeIntent.leaseEvidence=lease.evidence;this.activeIntent.roomGeneration=observation.episode.roomGeneration;this.activeIntent.lifeGeneration=observation.episode.lifeGeneration;this.activeIntent.lastProgressXfp=Number(observation.player.xFp)||0;this.activeIntent.lastProgressYfp=Number(observation.player.yFp)||0;this.activeIntent.lastProgressFrame=frame;
      this.lastDisposition='renew';
      if(receiptId&&this.trace?.intentAccepted)this.trace.intentAccepted(receiptId,{disposition:'renew',intentId:this.activeIntent.intentId,executionKind:'continuous',frame,safeUntilFrame:lease.safeUntilFrame,hardExpiryFrame:lease.hardExpiryFrame,neutralGapFramesBeforeApply:0});
      this.#mask(execution.continuousMask);
      return Object.freeze({disposition:'renew',intent:cloneActive(this.activeIntent)});
    }
    if(this.activeIntent){const release=!!(this.activeIntent.execution?.flags&1);this.#finish('switched',{release,frameSerial:frame});}
    const lease=continuousKind(execution)?this.continuationPolicy.lease(choice.name,observation,frame):{safeUntilFrame:frame,hardExpiryFrame:frame,evidence:'atomic'};
    const startXfp=Number(observation.player.xFp)||0,startYfp=Number(observation.player.yFp)||0;
    const active={intentId:this.nextIntentId++,id:choice.id,name:choice.name,execution,kind:execution.kind||'atomic',age:0,startFrame:frame,lastRenewedFrame:frame,minCommitUntilFrame:frame+Math.max(0,Number(execution.minCommitFrames)||0),safeUntilFrame:lease.safeUntilFrame,hardExpiryFrame:lease.hardExpiryFrame,leaseEvidence:lease.evidence,currentMask:0,lastAppliedFrame:null,decision,receiptId,startXfp,startYfp,lastProgressXfp:startXfp,lastProgressYfp:startYfp,lastProgressFrame:frame,startBullets:Number(observation.player.bullets)||0,startDynamite:Number(observation.player.dynamite)||0,roomGeneration:observation.episode.roomGeneration,lifeGeneration:observation.episode.lifeGeneration,startedGrounded:!!observation.player.grounded,startedClimbing:!!observation.player.climbing};
    this.activeIntent=active;this.lastDisposition='start';this.lastEndReason=null;
    if(receiptId&&this.trace?.intentAccepted)this.trace.intentAccepted(receiptId,{disposition:'start',intentId:active.intentId,executionKind:active.kind,frame,safeUntilFrame:active.safeUntilFrame,hardExpiryFrame:active.hardExpiryFrame,neutralGapFramesBeforeApply:0});
    this.#applyFrame(frame);
    return Object.freeze({disposition:'start',intent:cloneActive(active)});
  }
  #applyFrame(frameSerial){
    const active=this.activeIntent;if(!active||active.lastAppliedFrame===frameSerial)return null;
    if(this.isContinuous()){
      this.#mask(active.execution.continuousMask);active.currentMask=this.currentMask;active.age+=1;active.lastAppliedFrame=frameSerial;
      if(active.receiptId&&this.trace?.actionMask)this.trace.actionMask(active.receiptId,this.currentMask,{frame:frameSerial,continuation:true});
      return {mask:this.currentMask,done:false};
    }
    const step=(this.bridge.agentIntentStep||this.bridge.agentActionStep).call(this.bridge,active.id,active.age);
    this.#mask(step.mask);active.currentMask=this.currentMask;active.age+=1;active.lastAppliedFrame=frameSerial;
    if(active.receiptId&&this.trace?.actionMask)this.trace.actionMask(active.receiptId,this.currentMask,{frame:frameSerial});
    if(step.done)this.#finish('macro-complete',{release:false,frameSerial});
    return step;
  }
  tick(status){
    const active=this.activeIntent;if(!active)return Object.freeze({active:false,urgent:false});
    const frame=Number(status?.frameSerial)>>>0;
    if(this.isContinuous()){
      const continuation=this.continuationPolicy.continuation(active,status);
      if(!continuation.allowed){this.#finish(continuation.reason,{release:true,frameSerial:frame});return Object.freeze({active:false,urgent:true,reason:continuation.reason});}
      let urgent=!!continuation.urgent,reason=continuation.urgentReason||null;
      const progress=evaluateRealtimeContinuationProgress(active,status,this.continuationPolicy.limits);active.lastProgressXfp=progress.lastProgressXfp;active.lastProgressYfp=progress.lastProgressYfp;active.lastProgressFrame=progress.lastProgressFrame;
      if(progress.urgent){urgent=true;reason=progress.reason;}
      this.#applyFrame(frame);
      return Object.freeze({active:true,urgent,reason});
    }
    if(status?.dead||status?.roomGeneration!==active.roomGeneration||status?.lifeGeneration!==active.lifeGeneration){const reason=status?.dead?'dead':status?.roomGeneration!==active.roomGeneration?'room-transition':'life-transition';this.#finish(reason,{release:true,frameSerial:frame});return Object.freeze({active:false,urgent:true,reason});}
    if(!(Number(status?.legalMask||0)&(1<<active.id))){this.#finish('became-illegal',{release:true,frameSerial:frame});return Object.freeze({active:false,urgent:true,reason:'became-illegal'});}
    this.#applyFrame(frame);return Object.freeze({active:!!this.activeIntent,urgent:false});
  }
  release(reason='released',status=null){return this.#finish(reason,{release:true,frameSerial:status?.frameSerial});}
}

export function createRealtimeIntentExecutor(options){return new RealtimeIntentExecutor(options);}
