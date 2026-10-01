function fnv1a32(text) {
  let hash=0x811c9dc5;
  for (let i=0;i<text.length;i+=1) { hash^=text.charCodeAt(i); hash=Math.imul(hash,0x01000193)>>>0; }
  return `fnv1a32:${hash.toString(16).padStart(8,'0')}`;
}
function freezeReceipt(value){ return Object.freeze(structuredClone(value)); }
const SUPPORTED_RECEIPT_SCHEMAS=new Set(['rdr.realtime-ai.receipt.v1','rdr.realtime-ai.receipt.v2']);

export class RealtimeDecisionTrace {
  constructor({limit=256}={}) { this.limit=Math.max(1,limit|0); this.receipts=[]; this.nextId=1; this.pending=new Map(); }
  begin({observation,projection,input=null,choices,providerFamily='unknown',providerProfile='unknown',endpointLocality='none',model=null,calibration=null,requestStartMs=0,earlyDecisionReason=null}={}) {
    const observationText=JSON.stringify(observation);
    const id=this.nextId++,requestFrame=observation?.episode?.frameSerial ?? null;
    this.pending.set(id,{
      schema:'rdr.realtime-ai.receipt.v2',id,
      observation:{schema:observation?.schema || null,version:observation?.schemaVersion ?? 1,hash:fnv1a32(observationText),frame:requestFrame,
        roomGeneration:observation?.episode?.roomGeneration ?? null,lifeGeneration:observation?.episode?.lifeGeneration ?? null},
      projection:{schema:projection?.projectedState?.schema || null,version:projection?.version ?? 1,serializedBytes:projection?.serializedBytes ?? null},
      input:{mode:input?.mode || 'structured',frameSchema:input?.frameSchema ?? null,frameSerial:input?.frameSerial ?? null,
        previousFrameSerial:input?.previousFrameSerial ?? null,pixelBytes:input?.pixelBytes ?? 0},
      legalActions:(choices||[]).map(choice=>typeof choice==='string'?choice:choice.name),
      provider:{family:providerFamily,profile:providerProfile,endpointLocality,model,modelVersion:null},
      calibration:{profile:calibration?.profile ?? null,version:calibration?.version ?? null,calibrated:null,threshold:null},
      decision:{selected:null,confidence:null,probabilities:null,usage:null,requestStartMs,requestEndMs:null,latencyMs:null,accepted:null,reason:null},
      execution:{intentId:null,executionKind:null,requestFrame,responseFrame:null,responseAgeFrames:null,disposition:null,intentStartedFrame:null,intentRenewedFrame:null,intentEndedFrame:null,continuationFramesWhileRequestPending:0,neutralGapFramesBeforeApply:0,safeUntilFrame:null,hardExpiryFrame:null,earlyDecisionReason:earlyDecisionReason||null,endReason:null},
      action:{beganFrame:null,masks:[],frames:0}, outcome:null
    });
    return id;
  }
  decision(id,result,{accepted=null,reason=null,requestEndMs=null}={}) {
    const r=this.pending.get(id); if(!r) return false;
    r.provider.model=result?.model ?? r.provider.model; r.provider.modelVersion=result?.modelVersion ?? null;
    r.decision.selected=result?.choice ?? null; r.decision.confidence=result?.confidence ?? null; r.decision.probabilities=result?.probabilities ?? null; r.decision.usage=result?.usage ?? null;
    r.decision.requestEndMs=requestEndMs; r.decision.latencyMs=result?.latencyMs ?? (requestEndMs!=null?Math.max(0,requestEndMs-r.decision.requestStartMs):null);
    r.decision.accepted=accepted; r.decision.reason=reason; return true;
  }
  responseFrame(id,frame){const r=this.pending.get(id);if(!r||!r.execution)return false;const value=Number(frame)>>>0;r.execution.responseFrame=value;r.execution.responseAgeFrames=r.execution.requestFrame==null?null:Math.max(0,value-r.execution.requestFrame);return true;}
  earlyDecision(id,reason){const r=this.pending.get(id);if(!r||!r.execution)return false;r.execution.earlyDecisionReason=reason||null;return true;}
  calibration(id,result){ const r=this.pending.get(id); if(!r) return false; r.calibration.calibrated=!!result?.calibrated; r.calibration.threshold=result?.threshold ?? null; return true; }
  actionBegan(id,frame){ const r=this.pending.get(id); if(!r) return false; r.action.beganFrame=frame>>>0; return true; }
  actionMask(id,mask,{frame=null,continuation=false,pending=false}={}) { const r=this.pending.get(id); if(!r) return false; r.action.masks.push(mask>>>0); r.action.frames+=1;if(r.execution&&pending&&continuation)r.execution.continuationFramesWhileRequestPending+=1;if(r.execution&&frame!=null&&r.action.beganFrame==null)r.action.beganFrame=Number(frame)>>>0;return true; }
  continuationPending(id){const r=this.pending.get(id);if(!r||!r.execution)return false;r.execution.continuationFramesWhileRequestPending+=1;return true;}
  intentAccepted(id,{disposition='start',intentId=null,executionKind=null,frame=0,safeUntilFrame=null,hardExpiryFrame=null,neutralGapFramesBeforeApply=0}={}){
    const r=this.pending.get(id);if(!r||!r.execution)return false;const f=Number(frame)>>>0;
    r.execution.intentId=intentId;r.execution.executionKind=executionKind;r.execution.disposition=disposition;r.execution.safeUntilFrame=safeUntilFrame;r.execution.hardExpiryFrame=hardExpiryFrame;r.execution.neutralGapFramesBeforeApply=Math.max(0,Number(neutralGapFramesBeforeApply)||0);
    if(disposition==='renew')r.execution.intentRenewedFrame=f;else r.execution.intentStartedFrame=f;
    if(r.action.beganFrame==null)r.action.beganFrame=f;return true;
  }
  intentEnded(id,{frame=null,reason='complete',outcome=null}={}){const r=this.pending.get(id);if(!r)return null;if(r.execution){r.execution.intentEndedFrame=frame==null?null:Number(frame)>>>0;r.execution.endReason=reason;}return this.finalize(id,{accepted:true,reason,outcome});}
  finalize(id,{accepted=true,reason='complete',outcome=null}={}) {
    const r=this.pending.get(id); if(!r) return null;
    r.decision.accepted=accepted; r.decision.reason=reason; r.outcome=outcome;
    if(r.execution){if(!r.execution.disposition)r.execution.disposition=accepted?(reason==='shadow'?'shadow':'complete'):'reject';if(!r.execution.endReason)r.execution.endReason=reason;}
    this.pending.delete(id); const receipt=freezeReceipt(r); this.receipts.push(receipt);
    if(this.receipts.length>this.limit) this.receipts.splice(0,this.receipts.length-this.limit);
    return receipt;
  }
  reject(id,reason,result=null){ if(result) this.decision(id,result,{accepted:false,reason}); return this.finalize(id,{accepted:false,reason,outcome:null}); }
  list(){ return [...this.receipts]; }
  clear(){ this.receipts.length=0; this.pending.clear(); }
  exportJsonl(){ return this.receipts.map(r=>JSON.stringify(r)).join('\n')+(this.receipts.length?'\n':''); }
  importJsonl(text,{replace=true}={}) {
    const rows=String(text||'').split(/\r?\n/).filter(Boolean).map((line,index)=>{
      let row; try{row=JSON.parse(line);}catch(error){throw new Error(`Invalid realtime receipt JSONL line ${index+1}: ${error.message}`);}
      if(!SUPPORTED_RECEIPT_SCHEMAS.has(row?.schema)) throw new Error(`Unsupported realtime receipt schema at line ${index+1}`);
      return freezeReceipt(row);
    });
    if(replace) this.receipts=[]; this.receipts.push(...rows.slice(-this.limit)); return rows.length;
  }
  replayDecisions(){ return this.receipts.filter(r=>r.decision?.accepted && r.decision?.selected).map(r=>({choice:r.decision.selected,confidence:r.decision.confidence,probabilities:r.decision.probabilities,provider:'replay',model:r.provider?.model})); }
}
export function createRealtimeDecisionTrace(options){ return new RealtimeDecisionTrace(options); }
