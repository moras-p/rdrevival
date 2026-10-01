import { acquireGameplayControlLease, releaseGameplayControlLease, setGameplayControlMask } from './gameplay-control.js';
import { legalRealtimeActions, realtimeActionName } from './realtime-actions.js';
import { createRealtimeDecisionTrace } from './realtime-decision-trace.js';
import { createRealtimeLoopMemory } from './realtime-loop-memory.js';
import { createRealtimeCadencePolicy } from './realtime-cadence.js';
import { createRealtimeConfidenceCalibration } from './realtime-confidence-calibration.js';
import { captureBrowserRealtimeFrame, prepareRealtimeDecisionInput, resolveRealtimeProviderInput } from './realtime-decision-input.js';

const MODES=new Set(['off','shadow','live']);
const abortError=()=>Object.assign(new Error('Realtime AI decision aborted'),{name:'AbortError'});

export class RealtimeAiController {
  constructor({bridge,provider,projection='compact-v1',inputMode='auto',captureFrame=null,maxStateBytes=8192,decisionCadenceFrames=4,maxAdaptiveCadenceFrames=24,maxObservationAgeFrames=24,decisionTimeoutMs=1000,trace=null,loopMemory=null,cadencePolicy=null,confidenceCalibration=null,providerProfile=null,endpointLocality='none',now=()=>performance.now(),scheduleTimer=(fn,ms)=>setTimeout(fn,ms),cancelTimer=id=>clearTimeout(id)}={}) {
    if (!bridge) throw new Error('RealtimeAiController requires bridge');
    if (!provider || typeof provider.decide!=='function') throw new Error('RealtimeAiController requires DecisionProvider');
    this.bridge=bridge; this.provider=provider; this.projection=projection; this.providerInput=resolveRealtimeProviderInput(provider,{inputMode}); this.captureFrame=captureFrame||((observation)=>captureBrowserRealtimeFrame(bridge,observation)); this.previousDecisionFrame=null; this.maxStateBytes=maxStateBytes;
    this.decisionCadenceFrames=Math.max(1,decisionCadenceFrames|0); this.cadencePolicy=cadencePolicy||createRealtimeCadencePolicy({configuredCadenceFrames:this.decisionCadenceFrames,maxCadenceFrames:maxAdaptiveCadenceFrames}); this.confidenceCalibration=confidenceCalibration||createRealtimeConfidenceCalibration(); this.maxObservationAgeFrames=Math.max(1,maxObservationAgeFrames|0); this.decisionTimeoutMs=Math.max(1,decisionTimeoutMs|0); this.trace=trace||createRealtimeDecisionTrace(); this.loopMemory=loopMemory||createRealtimeLoopMemory(); this.providerProfile=providerProfile||provider.family||'unknown'; this.endpointLocality=endpointLocality; this.now=now; this.scheduleTimer=scheduleTimer; this.cancelTimer=cancelTimer;
    this.mode='off'; this.sessionGeneration=0; this.lease=null; this.inflight=null; this.pending=null; this.activeAction=null;
    this.lastDecisionFrame=-Infinity; this.lastError=null; this.decisionCount=0; this.staleDiscardCount=0; this.providerErrorCount=0; this.lowConfidenceCount=0; this.applied=[];
  }

  status(){ return {mode:this.mode,sessionGeneration:this.sessionGeneration,inflight:!!this.inflight,pending:!!this.pending,
    activeAction:this.activeAction?.name || null,activeActionAge:this.activeAction?.age || 0,inputMode:this.providerInput.mode,decisionCount:this.decisionCount,
    staleDiscardCount:this.staleDiscardCount,providerErrorCount:this.providerErrorCount,lowConfidenceCount:this.lowConfidenceCount,lastError:this.lastError,applied:[...this.applied],receiptCount:this.trace.list().length,loop:this.loopMemory.snapshot(),cadence:this.cadencePolicy.snapshot()}; }

  start({mode='shadow'}={}) {
    if (!MODES.has(mode) || mode==='off') throw new Error("Realtime AI start mode must be 'shadow' or 'live'");
    this.stop();
    this.sessionGeneration += 1;
    this.mode=mode;
    this.lease=acquireGameplayControlLease(`realtime-ai-${mode}`,{shadow:mode==='shadow'});
    this.lastDecisionFrame=-Infinity;
    return this.status();
  }

  stop() {
    this.sessionGeneration += 1;
    if (this.inflight) { this.inflight.controller.abort(); if (this.inflight.timer != null) this.cancelTimer(this.inflight.timer); this.inflight=null; }
    this.pending=null; this.activeAction=null; this.previousDecisionFrame=null; this.loopMemory.reset(); this.cadencePolicy.reset();
    if (this.lease && !this.lease.shadow) releaseGameplayControlLease(this.lease,this.bridge);
    this.lease=null; this.mode='off';
    return this.status();
  }

  dispose(){ return this.stop(); }

  #legal() {
    const contract=this.bridge.agentActions();
    return {contract,choices:contract.actions || legalRealtimeActions(contract.legalMask)};
  }

  #releaseMask(){ if (this.mode==='live' && this.lease && !this.lease.shadow) setGameplayControlMask(this.bridge,this.lease,0); }

  #finishActive(reason='complete') {
    if (!this.activeAction) return;
    this.#releaseMask();
    const endFrame=this.bridge.snapshot().frameSerial>>>0;
    const endObservation=this.bridge.agentObservation();
    const outcome={dx:(endObservation.player.xFp-this.activeAction.startXfp)/256,dy:(endObservation.player.yFp-this.activeAction.startYfp)/256,
      blocked:reason==='became-illegal',landed:!!endObservation.player.grounded,death:!!endObservation.player.dead,
      transition:endObservation.episode.roomGeneration!==this.activeAction.roomGeneration,
      bulletsUsed:Math.max(0,this.activeAction.startBullets-endObservation.player.bullets),dynamiteUsed:Math.max(0,this.activeAction.startDynamite-endObservation.player.dynamite)};
    this.applied.push({action:this.activeAction.name,startFrame:this.activeAction.startFrame,endFrame,reason});
    this.loopMemory.observe(endObservation); this.loopMemory.recordOutcome(this.activeAction.name,outcome);
    if (this.activeAction.receiptId) this.trace.finalize(this.activeAction.receiptId,{accepted:true,reason,outcome});
    if (this.applied.length>32) this.applied.shift();
    this.activeAction=null;
  }

  #advanceAction(frameSerial) {
    if (!this.activeAction) return;
    const legal=this.#legal();
    if (!legal.choices.some(choice=>choice.id===this.activeAction.id)) { this.#finishActive('became-illegal'); return; }
    const step=this.bridge.agentActionStep(this.activeAction.id,this.activeAction.age);
    if (this.mode==='live') setGameplayControlMask(this.bridge,this.lease,step.mask);
    this.activeAction.masks.push(step.mask>>>0);
    if (this.activeAction.receiptId) this.trace.actionMask(this.activeAction.receiptId,step.mask);
    this.activeAction.age += 1;
    if (step.done) this.#finishActive('macro-complete');
  }

  #acceptPending(observation,frameSerial) {
    if (!this.pending) return;
    const pending=this.pending; this.pending=null;
    if (pending.sessionGeneration!==this.sessionGeneration || pending.roomGeneration!==observation.episode.roomGeneration || pending.lifeGeneration!==observation.episode.lifeGeneration ||
        (frameSerial-pending.observationFrame)>this.maxObservationAgeFrames) { this.staleDiscardCount+=1; this.trace.reject(pending.receiptId,'stale'); return; }
    const legal=this.#legal().choices;
    let choiceName;
    try { choiceName=realtimeActionName(pending.decision.choice); }
    catch (error) { this.providerErrorCount+=1; this.lastError=String(error?.message || error); this.trace.reject(pending.receiptId,'invalid-action',pending.decision); this.#releaseMask(); return; }
    const choice=legal.find(item=>item.name===choiceName);
    if (!choice || !pending.offeredActions.includes(choiceName)) { this.providerErrorCount+=1; this.lastError=`Provider selected unavailable action '${choiceName}'`; this.trace.reject(pending.receiptId,choice?'unoffered-action':'illegal-action',pending.decision); this.#releaseMask(); return; }
    let confidence;
    try { confidence=this.confidenceCalibration.evaluate(pending.decision,{providerFamily:this.provider.family||'unknown',providerProfile:this.providerProfile,model:pending.decision?.model,modelVersion:pending.decision?.modelVersion,projection:pending.calibrationKey}); }
    catch(error){this.providerErrorCount+=1;this.lastError=String(error?.message||error);this.trace.reject(pending.receiptId,'invalid-confidence',pending.decision);this.#releaseMask();return;}
    this.trace.calibration(pending.receiptId,confidence);
    if(!confidence.apply){this.lowConfidenceCount+=1;this.trace.reject(pending.receiptId,'low-confidence',pending.decision);this.#releaseMask();return;}
    this.decisionCount+=1;
    this.trace.decision(pending.receiptId,pending.decision,{accepted:true,reason:this.mode==='shadow'?'shadow':'accepted',requestEndMs:this.now()});
    if (this.mode==='shadow') { this.trace.finalize(pending.receiptId,{accepted:true,reason:'shadow',outcome:null}); return; }
    this.#finishActive('superseded');
    this.trace.actionBegan(pending.receiptId,frameSerial);
    this.activeAction={id:choice.id,name:choice.name,age:0,startFrame:frameSerial,masks:[],decision:pending.decision,receiptId:pending.receiptId,
      startXfp:observation.player.xFp,startYfp:observation.player.yFp,startBullets:observation.player.bullets,startDynamite:observation.player.dynamite,roomGeneration:observation.episode.roomGeneration};
  }

  #decisionDue(frameSerial) { return !this.inflight && !this.pending && !this.activeAction && frameSerial-this.lastDecisionFrame>=this.cadencePolicy.snapshot().effectiveCadenceFrames; }

  #request(observation,choices,frameSerial) {
    let frame=null;
    try {
      if(this.providerInput.mode!=='structured') frame=this.captureFrame(observation);
    } catch(error) {
      this.providerErrorCount+=1; this.lastError=String(error?.message||error); this.#releaseMask(); return;
    }
    const controller=new AbortController();
    const sessionGeneration=this.sessionGeneration;
    const requestStartMs=this.now();
    let prepared;
    try {
      prepared=prepareRealtimeDecisionInput({provider:this.provider,inputMode:this.providerInput.mode,observation,choices,projection:this.projection,maxStateBytes:this.maxStateBytes,
        history:this.loopMemory.snapshot(),timingContext:this.cadencePolicy.snapshot(),frame,previousFrame:this.previousDecisionFrame,signal:controller.signal});
    } catch(error) {
      this.providerErrorCount+=1; this.lastError=String(error?.message||error); this.#releaseMask(); return;
    }
    if(frame) this.previousDecisionFrame=frame;
    const receiptId=this.trace.begin({observation,projection:prepared.projected,input:prepared.input,choices,providerFamily:this.provider.family||'unknown',providerProfile:this.providerProfile,endpointLocality:this.endpointLocality,model:null,calibration:this.confidenceCalibration.metadata(),requestStartMs});
    const request=prepared.request;
    this.lastDecisionFrame=frameSerial;
    const token={controller,sessionGeneration,receiptId,calibrationKey:prepared.calibrationKey,observationFrame:observation.episode.frameSerial,roomGeneration:observation.episode.roomGeneration,lifeGeneration:observation.episode.lifeGeneration,offeredActions:choices.map(choice=>choice.name),timer:null};
    token.timer=this.scheduleTimer(()=>{
      if (this.inflight!==token || sessionGeneration!==this.sessionGeneration) return;
      controller.abort(); this.inflight=null; this.providerErrorCount+=1;
      this.lastError=`Decision timed out after ${this.decisionTimeoutMs} ms`; this.trace.reject(receiptId,'timeout'); this.#releaseMask();
    },this.decisionTimeoutMs);
    this.inflight=token;
    Promise.resolve().then(()=>this.provider.decide(request)).then(decision=>{
      if (controller.signal.aborted) throw abortError();
      if (this.inflight!==token || sessionGeneration!==this.sessionGeneration) { this.staleDiscardCount+=1; return; }
      const requestEndMs=this.now();
      this.cadencePolicy.observe({latencyMs:Math.max(0,Number(decision?.latencyMs ?? (requestEndMs-requestStartMs))||0),tickRate:observation.timing?.gameplayTickRate||25});
      this.trace.decision(receiptId,decision,{requestEndMs});
      this.pending={...token,decision};
    }).catch(error=>{
      if (error?.name==='AbortError') return;
      if (sessionGeneration!==this.sessionGeneration) return;
      this.providerErrorCount+=1; this.lastError=String(error?.message || error); this.trace.reject(receiptId,'provider-error'); this.#releaseMask();
    }).finally(()=>{ if (token.timer != null) this.cancelTimer(token.timer); if (this.inflight===token) this.inflight=null; });
  }

  tick() {
    if (this.mode==='off') return this.status();
    const frameSerial=this.bridge.snapshot().frameSerial>>>0;
    if (this.pending) {
      const observation=this.bridge.agentObservation();
      this.#acceptPending(observation,frameSerial);
    }
    this.#advanceAction(frameSerial);
    if (this.#decisionDue(frameSerial)) {
      const observation=this.bridge.agentObservation();
      this.loopMemory.observe(observation);
      const {choices}=this.#legal();
      const offeredChoices=this.loopMemory.offerChoices(choices);
      if (offeredChoices.length) this.#request(observation,offeredChoices,frameSerial);
    }
    return this.status();
  }
}

export function createRealtimeAiController(options){ return new RealtimeAiController(options); }
