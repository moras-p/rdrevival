const encoder=new TextEncoder();

function choiceName(choice){ return typeof choice==='string'?choice:String(choice?.name ?? ''); }
function finite(value,name){ const n=Number(value); if(!Number.isFinite(n)) throw new Error(`System One ${name} must be finite`); return n; }

export function buildSystemOneRequest({projectedState,choices,model=null,instructions='Choose the next safe gameplay action that best advances the current objective.'}={}) {
  if(!projectedState || typeof projectedState!=='object') throw new TypeError('System One projected state is required');
  const criteria={};
  for(const choice of choices||[]) {
    const name=choiceName(choice); if(!name) throw new Error('System One choice has no action name');
    criteria[name]=choice?.description || `Legal semantic gameplay action: ${name}`;
  }
  if(!Object.keys(criteria).length) throw new Error('System One requires at least one legal action');
  const request={}; if(model) request.model=String(model);
  request.state=projectedState;
  request.questions={action:{type:'choice',instructions:String(instructions),criteria}};
  return request;
}

export function parseSystemOneResponse(payload, offeredChoices, {probabilitySum='unit',confidenceRange=[0,1]}={}) {
  if(!payload || typeof payload!=='object') throw new Error('System One response must be an object');
  const answer=payload.answers?.action;
  if(!answer || typeof answer!=='object') throw new Error('System One response is missing answers.action');
  if(answer.type!=null && answer.type!=='choice') throw new Error(`System One action answer type '${answer.type}' is not choice`);
  const offered=new Set((offeredChoices||[]).map(choiceName));
  const choice=String(answer.choice || '');
  if(!offered.has(choice)) throw new Error(`System One selected action '${choice}' was not offered`);
  let probabilities;
  if(answer.probabilities!=null) {
    if(typeof answer.probabilities!=='object' || Array.isArray(answer.probabilities)) throw new Error('System One probabilities must be an object');
    probabilities={}; let sum=0;
    for(const [key,value] of Object.entries(answer.probabilities)) {
      if(!offered.has(key)) throw new Error(`System One probability key '${key}' was not offered`);
      const p=finite(value,`probability ${key}`); if(p<0) throw new Error(`System One probability ${key} must be non-negative`);
      probabilities[key]=p; sum+=p;
    }
    if(probabilitySum==='unit' && Object.keys(probabilities).length && Math.abs(sum-1)>0.02)
      throw new Error(`System One probability sum ${sum} is outside 1±0.02`);
  }
  let confidence;
  if(answer.confidence!=null) {
    confidence=finite(answer.confidence,'confidence');
    if(confidence<confidenceRange[0] || confidence>confidenceRange[1]) throw new Error(`System One confidence ${confidence} is outside advertised range`);
  }
  return {choice,confidence,probabilities,provider:'system-one-http',model:payload.model ?? null,modelVersion:payload.model_version ?? payload.modelVersion ?? null,usage:payload.usage ?? null};
}

export function createSystemOneProvider({fetchImpl=globalThis.fetch,endpoint='/v1/systemone',model=null,maxStateBytes=8192,headers=null,probabilitySum='unit',confidenceRange=[0,1],family='system-one-http',now=()=>performance.now()}={}) {
  if(typeof fetchImpl!=='function') throw new Error('System One provider requires fetch');
  return Object.freeze({
    family:String(family||'system-one-http'),
    getCapabilities(){return {structured:true,pixels:false,hybrid:false};},
    async decide({projectedState,choices,signal}={}) {
      const serialized=JSON.stringify(projectedState);
      const bytes=encoder.encode(serialized).byteLength;
      if(bytes>maxStateBytes) throw new RangeError(`System One state is ${bytes} bytes, exceeding ${maxStateBytes}-byte provider budget`);
      const body=buildSystemOneRequest({projectedState,choices,model});
      const started=now();
      const response=await fetchImpl(endpoint,{method:'POST',headers:{'content-type':'application/json',...(headers||{})},body:JSON.stringify(body),signal});
      if(!response || typeof response.ok!=='boolean') throw new Error('System One fetch returned an invalid response object');
      if(!response.ok) {
        let detail=''; try{detail=await response.text();}catch(_){ }
        throw new Error(`System One HTTP ${response.status}${detail?`: ${detail.slice(0,240)}`:''}`);
      }
      let payload; try{payload=await response.json();}catch(error){throw new Error(`System One malformed JSON response: ${error.message}`);}
      return {...parseSystemOneResponse(payload,choices,{probabilitySum,confidenceRange}),latencyMs:Math.max(0,now()-started)};
    }
  });
}
