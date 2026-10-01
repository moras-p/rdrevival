import { realtimeActionName } from './realtime-actions.js';

function normalizeDecision(result, {provider='unknown',model=null,startedAt=0,now=()=>performance.now()} = {}) {
  if (!result || result.choice == null) throw new Error('Decision provider returned no choice');
  return {
    ...result,
    choice:realtimeActionName(result.choice),
    provider:String(result.provider || provider),
    model:result.model == null ? model : String(result.model),
    latencyMs:Number.isFinite(result.latencyMs) ? Number(result.latencyMs) : Math.max(0,now()-startedAt)
  };
}

export function createMockDecisionProvider({ policy = null, name='mock', model='deterministic-v1', capabilities={structured:true,pixels:false,hybrid:false}, now=()=>performance.now() } = {}) {
  const providerCapabilities=Object.freeze({structured:!!capabilities.structured,pixels:!!capabilities.pixels,hybrid:!!capabilities.hybrid});
  return Object.freeze({
    family:'mock',
    getCapabilities(){ return providerCapabilities; },
    async decide(request) {
      const startedAt=now();
      const result = policy ? await policy(request) : {choice:request.choices[0]?.name || request.choices[0]};
      return normalizeDecision(result,{provider:name,model,startedAt,now});
    }
  });
}

export function createReplayDecisionProvider(records = [], { name='replay', model='recorded-v1', now=()=>performance.now() } = {}) {
  const queue=[...records];
  let cursor=0;
  return Object.freeze({
    family:'replay',
    getCapabilities(){ return {structured:true,pixels:false,hybrid:false}; },
    reset(){ cursor=0; },
    remaining(){ return Math.max(0,queue.length-cursor); },
    async decide(request) {
      const startedAt=now();
      if (cursor >= queue.length) throw new Error('Replay decision stream exhausted');
      const record=queue[cursor++];
      const result=typeof record === 'string' || Number.isInteger(record) ? {choice:record} : record;
      const offered=new Set(request.choices.map(choice=>typeof choice==='string'?choice:choice.name));
      const normalized=normalizeDecision(result,{provider:name,model,startedAt,now});
      if (!offered.has(normalized.choice)) throw new Error(`Replay action '${normalized.choice}' is not legal in current state`);
      return normalized;
    }
  });
}
