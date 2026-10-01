const encoder=new TextEncoder();

function choiceName(choice){return typeof choice==='string'?choice:String(choice?.name??'');}
function outputText(payload){
  if(typeof payload?.output_text==='string')return payload.output_text;
  for(const item of payload?.output||[]){
    if(item?.type!=='message')continue;
    for(const content of item.content||[]){
      if(content?.type==='refusal')throw new Error(`OpenAI Responses refusal: ${content.refusal||'request refused'}`);
      if(content?.type==='output_text'&&typeof content.text==='string')return content.text;
    }
  }
  return null;
}

export function buildOpenAIResponsesRequest({projectedState,choices,model,instructions=null,maxOutputTokens=64,reasoningEffort=null}={}){
  if(!projectedState||typeof projectedState!=='object')throw new TypeError('OpenAI Responses projected state is required');
  const legal=(choices||[]).map(choice=>({name:choiceName(choice),description:choice?.description||null}));
  if(!legal.length||legal.some(choice=>!choice.name))throw new Error('OpenAI Responses requires named legal actions');
  const names=legal.map(choice=>choice.name);
  const request={
    model:String(model||''),
    store:false,
    instructions:instructions||'Control Rick Dangerous in real time. Choose exactly one currently legal semantic action. Advance the current room objective while avoiding hazards and repeated no-progress actions. Use only the supplied state and legal actions.',
    input:[{role:'user',content:JSON.stringify({state:projectedState,legalActions:legal})}],
    max_output_tokens:Number(maxOutputTokens)||64,
    text:{format:{type:'json_schema',name:'rdr_realtime_action',strict:true,schema:{type:'object',properties:{choice:{type:'string',enum:names}},required:['choice'],additionalProperties:false}}}
  };
  if(!request.model)delete request.model;
  if(reasoningEffort)request.reasoning={effort:String(reasoningEffort)};
  return request;
}

export function parseOpenAIResponsesResponse(payload,offeredChoices){
  if(!payload||typeof payload!=='object')throw new Error('OpenAI Responses payload must be an object');
  if(payload.error)throw new Error(`OpenAI Responses error: ${payload.error.message||payload.error.code||'unknown error'}`);
  if(payload.status&&payload.status!=='completed')throw new Error(`OpenAI Responses status '${payload.status}' is not completed`);
  const text=outputText(payload);
  if(!text)throw new Error('OpenAI Responses payload has no output text');
  let parsed;try{parsed=JSON.parse(text);}catch(error){throw new Error(`OpenAI Responses structured output is malformed JSON: ${error.message}`);}
  const offered=new Set((offeredChoices||[]).map(choiceName));
  const choice=String(parsed?.choice||'');
  if(!offered.has(choice))throw new Error(`OpenAI Responses selected action '${choice}' was not offered`);
  return {choice,provider:'openai-responses-http',model:payload.model??null,modelVersion:payload.model_version??payload.modelVersion??null,usage:payload.usage??null};
}

export function createOpenAIResponsesProvider({fetchImpl=globalThis.fetch,endpoint='https://api.openai.com/v1/responses',apiKey=null,model=null,maxStateBytes=8192,headers=null,maxOutputTokens=64,reasoningEffort=null,now=()=>performance.now()}={}){
  if(typeof fetchImpl!=='function')throw new Error('OpenAI Responses provider requires fetch');
  return Object.freeze({
    family:'openai-responses-http',
    getCapabilities(){return {structured:true,pixels:false,hybrid:false};},
    async decide({projectedState,choices,signal}={}){
      const bytes=encoder.encode(JSON.stringify(projectedState)).byteLength;
      if(bytes>maxStateBytes)throw new RangeError(`OpenAI Responses state is ${bytes} bytes, exceeding ${maxStateBytes}-byte provider budget`);
      const body=buildOpenAIResponsesRequest({projectedState,choices,model,maxOutputTokens,reasoningEffort});
      const started=now();
      const requestHeaders={'content-type':'application/json',...(headers||{})};
      if(apiKey)requestHeaders.authorization=`Bearer ${apiKey}`;
      const response=await fetchImpl(endpoint,{method:'POST',headers:requestHeaders,body:JSON.stringify(body),signal});
      if(!response||typeof response.ok!=='boolean')throw new Error('OpenAI Responses fetch returned an invalid response object');
      if(!response.ok){let detail='';try{detail=await response.text();}catch(_){}throw new Error(`OpenAI Responses HTTP ${response.status}${detail?`: ${detail.slice(0,240)}`:''}`);}
      let payload;try{payload=await response.json();}catch(error){throw new Error(`OpenAI Responses malformed JSON response: ${error.message}`);}
      return {...parseOpenAIResponsesResponse(payload,choices),latencyMs:Math.max(0,now()-started)};
    }
  });
}
