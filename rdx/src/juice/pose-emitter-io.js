import { ACTIONS, cloneProfile, normalizeProfile } from './juice-protocol.js';

export const POSE_EMITTER_ACTION_SCHEMA='rick-dangerous-revival.pose-emitter-action.v1';
const clone=value=>JSON.parse(JSON.stringify(value));

export function buildPoseEmitterActionExport({actionId,actionLabel='',presentation='classic',poseEmitter,sprites=[],exportedAt=null}={}){
  if(!ACTIONS.some(action=>action.id===actionId)) throw new Error(`Unknown Game Juice action: ${actionId}`);
  if(!poseEmitter || typeof poseEmitter!=='object') throw new Error('Pose-attached generator effect is required');
  return {
    schema:POSE_EMITTER_ACTION_SCHEMA,
    formatVersion:1,
    exportedAt:exportedAt || new Date().toISOString(),
    sourceAction:{id:actionId,label:String(actionLabel||actionId)},
    presentation:presentation==='rdx'?'rdx':'classic',
    effectDescription:'Event-bound Hero sprite particle generators. The Hero animation remains native; each binding describes when particles are active, how they repeat, their sprite-relative anchor, and particle motion/appearance.',
    spriteEncoding:'data:image/png;base64',
    timing:{simulationFps:25,frameMs:40},
    coordinateSpace:{heroReferenceWidth:32,heroReferenceHeight:21,anchorUnits:'hero reference pixels'},
    poseEmitter:clone(poseEmitter),
    sprites:(Array.isArray(sprites)?sprites:[]).map(sprite=>clone(sprite))
  };
}

export function poseEmitterFromPortablePayload(payload){
  if(!payload || typeof payload!=='object') return null;
  if(payload.schema && payload.schema!==POSE_EMITTER_ACTION_SCHEMA) return null;
  const raw=payload.poseEmitter || payload.effect?.poseEmitter || (payload.effect?.bindings ? payload.effect : null);
  if(!raw || typeof raw!=='object' || !Array.isArray(raw.bindings)) return null;
  const effect=clone(raw);
  const assets=new Map((Array.isArray(payload.sprites)?payload.sprites:[]).map(asset=>[String(asset?.bindingId||''),asset]));
  for(const binding of effect.bindings){
    if(binding?.capturedPose) continue;
    const asset=assets.get(String(binding?.id||''));
    const embedded=asset?.previewPngDataUrl || asset?.classicPngDataUrl || asset?.rdxPngDataUrl || '';
    if(typeof embedded==='string' && embedded.startsWith('data:image/png;base64,')) binding.capturedPose=embedded;
  }
  return effect;
}

export function importPoseEmitterActionPayload(profile,targetActionId,payload){
  if(!profile?.actions?.[targetActionId] || !ACTIONS.some(action=>action.id===targetActionId)) return null;
  const effect=poseEmitterFromPortablePayload(payload); if(!effect)return null;
  const next=cloneProfile(profile); next.actions[targetActionId].poseEmitter=effect;
  return normalizeProfile(next);
}
