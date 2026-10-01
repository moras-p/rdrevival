export const REALTIME_PROVIDER_PROFILES=Object.freeze({
  'typesafe-jev':Object.freeze({id:'typesafe-jev',family:'system-one-http',baseUrl:'https://api.typesafe.ai/',model:'jev-latest',authRequired:true,localOnly:false,timeoutMs:750,maxStateBytes:8192,projection:'compact-v8',probabilitySum:'unit'}),
  'openai-responses':Object.freeze({id:'openai-responses',family:'openai-responses-http',baseUrl:'https://api.openai.com/',model:'gpt-6-luna',authRequired:true,localOnly:false,timeoutMs:3000,maxStateBytes:8192,projection:'compact-v8',probabilitySum:'unit'}),
  'laya-local':Object.freeze({id:'laya-local',family:'system-one-http',baseUrl:'http://127.0.0.1:8000/',model:null,authRequired:false,localOnly:true,timeoutMs:500,maxStateBytes:4096,projection:'compact-local-v1',probabilitySum:'unit'}),
  'system-one-local':Object.freeze({id:'system-one-local',family:'system-one-http',baseUrl:'http://127.0.0.1:8000/',model:null,authRequired:false,localOnly:true,timeoutMs:750,maxStateBytes:8192,projection:'compact-v8',probabilitySum:'unit'}),
  'system-one-custom':Object.freeze({id:'system-one-custom',family:'system-one-http',baseUrl:null,model:null,authRequired:false,localOnly:false,timeoutMs:750,maxStateBytes:8192,projection:'compact-v8',probabilitySum:'unit'})
});

export function realtimeProviderProfile(id='system-one-custom') {
  const profile=REALTIME_PROVIDER_PROFILES[String(id)];
  if(!profile) throw new Error(`Unknown realtime decision profile '${id}'`);
  return profile;
}

export function resolveRealtimeProviderProfile(id,{baseUrl=null,model=null,timeoutMs=null,maxStateBytes=null,localOnly=null}={}) {
  const profile=realtimeProviderProfile(id);
  return Object.freeze({...profile,baseUrl:baseUrl||profile.baseUrl,model:model??profile.model,
    timeoutMs:timeoutMs==null?profile.timeoutMs:Number(timeoutMs),maxStateBytes:maxStateBytes==null?profile.maxStateBytes:Number(maxStateBytes),localOnly:localOnly==null?profile.localOnly:!!localOnly});
}
