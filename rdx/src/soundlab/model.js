export function assertSoundLabManifest(manifest) {
  if (!manifest || manifest.schema !== 'soundlab.build-manifest.v1') throw new Error('Expected soundlab.build-manifest.v1');
  if (!manifest.project || !Array.isArray(manifest.bindings) || !Array.isArray(manifest.outputs)) throw new Error('SoundLab manifest is incomplete');
  return manifest;
}

export function bindingFor(manifest, id) {
  const binding = manifest.bindings.find(row => row.id === id) || manifest.bindings[0];
  if (!binding) throw new Error('SoundLab manifest has no bindings');
  return binding;
}

export function outputsFor(manifest, bindingId, profile = null) {
  return manifest.outputs.filter(row => row.binding === bindingId && (!profile || row.profile === profile)).sort((a,b) => a.variant - b.variant);
}

export function resourceOptions(manifest, kind) {
  return Object.values(manifest.previewModel?.resources?.[kind] || {}).sort((a,b) => String(a.id).localeCompare(String(b.id)));
}
export function materialOptions(manifest) { return resourceOptions(manifest,'materials'); }
export function sourceOptions(manifest) { return [...(manifest.previewModel?.sources || [])].sort((a,b)=>String(a.id).localeCompare(String(b.id))); }


export const PERCEPTUAL_FINGERPRINT_AXES=Object.freeze(['depth','hardness','roughness','boominess','brightness','warmth','ring','reverberance']);
function fingerprintRmsRange(samples,start,end){let sum=0,count=0;const a=Math.max(0,Math.min(samples.length,Math.floor(start))),b=Math.max(a,Math.min(samples.length,Math.floor(end)));for(let i=a;i<b;i+=1){const x=Number(samples[i])||0;sum+=x*x;count+=1;}return Math.sqrt(sum/Math.max(1,count));}
function fingerprintLowpassEnergy(samples,sampleRate,cutoffHz){const alpha=1-Math.exp(-2*Math.PI*Math.max(1,cutoffHz)/Math.max(1,sampleRate));let low=0,lowEnergy=0,highEnergy=0;for(let i=0;i<samples.length;i+=1){const x=Number(samples[i])||0;low+=alpha*(x-low);const high=x-low;lowEnergy+=low*low;highEnergy+=high*high;}return{low:lowEnergy/Math.max(1,samples.length),high:highEnergy/Math.max(1,samples.length)};}
/** Browser parity copy of the canonical reference-navigation fingerprint. */
export function perceptualFingerprint(samples,sampleRate){
  const n=Math.max(1,samples?.length||0);if(!samples?.length)return Object.fromEntries(PERCEPTUAL_FINGERPRINT_AXES.map(axis=>[axis,0]));
  let sum=0,zcr=0,prev=Number(samples[0])||0,onset=-1,last=-1,derivative=0;const threshold=.008;
  for(let i=0;i<samples.length;i+=1){const x=Number(samples[i])||0,a=Math.abs(x);sum+=x*x;if(onset<0&&a>=threshold)onset=i;if(a>=threshold)last=i;if((x>=0)!==(prev>=0))zcr+=1;if(i){const d=x-prev;derivative+=d*d;}prev=x;}
  const rms=Math.sqrt(sum/n),total=Math.max(1e-12,rms*rms),durationMs=(last>=onset&&onset>=0)?(last-onset+1)*1000/sampleRate:0,zeroCrossingRate=zcr/n;
  derivative/=Math.max(1,n-1);const low300=fingerprintLowpassEnergy(samples,sampleRate,300),low1200=fingerprintLowpassEnergy(samples,sampleRate,1200),low2600=fingerprintLowpassEnergy(samples,sampleRate,2600),start=onset<0?0:onset,earlyEnd=Math.min(n,start+Math.max(1,Math.round(sampleRate*.045))),bodyEnd=Math.min(n,start+Math.max(1,Math.round(sampleRate*.18))),lateStart=Math.min(n,start+Math.max(1,Math.round((n-start)*.55))),early=fingerprintRmsRange(samples,start,earlyEnd),body=fingerprintRmsRange(samples,earlyEnd,bodyEnd),late=fingerprintRmsRange(samples,lateStart,n),lowRatio=Math.max(0,Math.min(1,low300.low/total)),midRatio=Math.max(0,Math.min(1,(low1200.low-low300.low)/total)),highRatio=Math.max(0,Math.min(1,low2600.high/total)),earlyRatio=Math.max(0,Math.min(4,(early*early)/(total+1e-12))),lateRatio=Math.max(0,Math.min(4,(late*late)/(total+1e-12))),bodyRatio=Math.max(0,Math.min(4,(body*body)/(total+1e-12))),brightness=Math.max(0,Math.min(1,Math.sqrt(highRatio)*1.12)),depth=Math.max(0,Math.min(1,.18+Math.sqrt(lowRatio)*.92-brightness*.26)),hardness=Math.max(0,Math.min(1,.12+Math.sqrt(earlyRatio)*.48+Math.sqrt(derivative/total)*.12)),roughness=Math.max(0,Math.min(1,zeroCrossingRate*5.2+Math.sqrt(Math.min(4,derivative/total))*.18)),boominess=Math.max(0,Math.min(1,Math.sqrt(lowRatio)*(.58+.3*Math.min(1,lateRatio)))),warmth=Math.max(0,Math.min(1,.2+Math.sqrt(Math.max(0,Math.min(1,lowRatio+midRatio*.7)))*.85-brightness*.28)),ring=Math.max(0,Math.min(1,Math.sqrt(lateRatio)*.7+Math.sqrt(Math.min(1,bodyRatio))*.12)),reverberance=Math.max(0,Math.min(1,Math.sqrt(lateRatio)*.55+(durationMs/Math.max(80,n*1000/sampleRate))*.18));
  return Object.fromEntries(Object.entries({depth,hardness,roughness,boominess,brightness,warmth,ring,reverberance}).map(([key,value])=>[key,Number(value.toFixed(4))]));
}
export function fingerprintDistance(a,b,axes=PERCEPTUAL_FINGERPRINT_AXES){let sum=0,count=0;for(const axis of axes){if(!Number.isFinite(Number(a?.[axis]))||!Number.isFinite(Number(b?.[axis])))continue;const d=Number(a[axis])-Number(b[axis]);sum+=d*d;count+=1;}return count?Math.sqrt(sum/count):Infinity;}
export function referenceLibrary(manifest){
  const bindings=new Map((manifest?.bindings||[]).map(row=>[row.id,row]));
  const promoted=(manifest?.outputs||[]).filter(row=>row.profile==='master'&&row.fingerprint).map(row=>({...row,kind:'promoted',label:`${bindings.get(row.binding)?.event||row.binding} · v${Number(row.variant)+1}`}));
  const sources=(manifest?.previewModel?.sources||[]).filter(row=>row.fingerprint).map(row=>({...row,kind:'source',label:`${row.id} · ${row.role}`}));
  return [...promoted,...sources];
}

export function environmentForBinding(manifest, binding) {
  const environments=manifest.previewModel?.environments||{};
  const submap=String(Number(binding?.match?.submap ?? -1));
  const row=environments.submaps?.[submap]||{};
  const profileId=row.acoustics||environments.defaultAcoustics?.[row.world]||null;
  const profile=profileId?environments.profiles?.[profileId]:null;
  return profile?{...profile,id:profile.id||profileId,world:row.world||null}:null;
}

export function deepMerge(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return base;
  const result={...(base||{})};
  for(const [key,value] of Object.entries(override)){
    if(value&&typeof value==='object'&&!Array.isArray(value)&&result[key]&&typeof result[key]==='object'&&!Array.isArray(result[key]))result[key]=deepMerge(result[key],value);
    else if(value===null)delete result[key];
    else result[key]=value;
  }
  return result;
}

const clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,Number(value)));
const close=(a,b,epsilon=.0001)=>Math.abs(Number(a)-Number(b))<=epsilon;
const PERCEPTUAL_KEYS=['energy','depth','hardness','roughness','boominess','brightness','warmth','ring','reverberance'];
function cleanPerceptualDescription(values={}){const out={schema:'soundlab.perceptual-description.v1'};for(const key of PERCEPTUAL_KEYS)if(Number.isFinite(Number(values[key])))out[key]=clamp(values[key]);return out;}

export function perceptualSoundDescription(values={}) {
  return{
    schema:'soundlab.perceptual-description.v1',
    energy:clamp(values.energy??.5),
    depth:clamp(values.depth??.5),
    hardness:clamp(values.hardness??values.attack??.5),
    roughness:clamp(values.roughness??values.texture??.5),
    boominess:clamp(values.boominess??.5),
    brightness:clamp(values.brightness??.5),
    warmth:clamp(values.warmth??.5),
    ring:clamp(values.ring??.5),
    reverberance:clamp(values.reverberance??values.space??0)
  };
}

export function perceptualDefaults(resources={},mapping={}){
  const defaults=mapping.defaults||{},material=resources.material||{},recipe=resources.recipe||{};
  return perceptualSoundDescription({
    energy:defaults.energy??.5,
    depth:defaults.depth??.5,
    hardness:material.transient?.hardness??defaults.hardness??.5,
    roughness:material.contact?.roughness??defaults.roughness??.5,
    boominess:recipe.perceptual?.boominess??defaults.boominess??.5,
    brightness:recipe.perceptual?.brightness??defaults.brightness??.5,
    warmth:recipe.perceptual?.warmth??defaults.warmth??.5,
    ring:defaults.ring??.5,
    reverberance:recipe.perceptual?.reverberance??defaults.reverberance??0
  });
}

export function strengthForEnergy(energy,mapping={}){const exponent=Math.max(.01,Number(mapping.energy?.strengthExponent??2));return clamp(energy)**exponent;}
export function energyForStrength(strength,mapping={}){const exponent=Math.max(.01,Number(mapping.energy?.strengthExponent??2));return Math.pow(clamp(strength),1/exponent);}

export function resolvePerceptualOverrides(resources,description,mapping={}){
  if(!description)return{};
  const current=cleanPerceptualDescription(description),defaults=perceptualDefaults(resources,mapping),base=resources||{},out={};
  const ensure=(kind,key,value)=>{out[kind]??={};let cursor=out[kind],parts=key.split('.');for(const part of parts.slice(0,-1))cursor=cursor[part]??={};cursor[parts.at(-1)]=value;};
  if(Number.isFinite(current.depth)&&!close(current.depth,defaults.depth)){
    const modal=base.object?.modal||{},delta=current.depth-defaults.depth;
    ensure('object','modal.frequencyScale',Number(modal.frequencyScale??1)*Math.pow(2,Number(mapping.depth?.frequencyOctavesPerUnit??-.72)*delta));
    ensure('object','modal.coupling',Number(modal.coupling??1)*(1+Number(mapping.depth?.couplingPerUnit??.24)*delta));
  }
  if(Number.isFinite(current.roughness)&&!close(current.roughness,defaults.roughness))ensure('material','contact.roughness',current.roughness);
  if(Number.isFinite(current.hardness)&&!close(current.hardness,defaults.hardness)){
    const delta=current.hardness-defaults.hardness,scale=Number(mapping.hardness?.transientMixPerUnit??.28);
    ensure('material','transient.hardness',current.hardness);
    ensure('recipe','mix.transient',clamp(Number(base.recipe?.mix?.transient??.6)+delta*scale,Number(mapping.hardness?.transientMixMin??0),Number(mapping.hardness?.transientMixMax??1.2)));
  }
  if(Number.isFinite(current.ring)&&!close(current.ring,defaults.ring)){
    const modal=base.object?.modal||{},delta=current.ring-defaults.ring;
    ensure('object','modal.decayScale',Number(modal.decayScale??1)*Math.pow(2,Number(mapping.ring?.decayOctavesPerUnit??1.15)*delta));
  }
  for(const key of ['boominess','brightness','warmth','reverberance'])if(Number.isFinite(current[key])&&!close(current[key],defaults[key]))ensure('recipe',`perceptual.${key}`,current[key]);
  return out;
}

export function resolvePreviewResources(manifest, binding, materialId = binding.surface, selections = {}) {
  const resources = manifest.previewModel?.resources || {},mapping=manifest.previewModel?.perceptualMapping||{};
  const objectId=selections.object || binding.object, recipeId=selections.recipe || binding.recipe, styleId=selections.style || binding.style;
  const base={material:resources.materials?.[materialId],object:resources.objects?.[objectId],recipe:resources.recipes?.[recipeId],style:resources.styles?.[styleId]};
  if (!base.material || !base.object || !base.recipe || !base.style) throw new Error(`Missing preview resources for ${binding.id}`);
  const semantic=resolvePerceptualOverrides(base,binding.perceptual,mapping);
  const material=deepMerge(deepMerge(base.material,semantic.material),binding.overrides?.material);
  const object=deepMerge(deepMerge(base.object,semantic.object),binding.overrides?.object);
  const recipe=deepMerge(deepMerge(base.recipe,semantic.recipe),binding.overrides?.recipe);
  const style=deepMerge(base.style,binding.overrides?.style);
  const environment = environmentForBinding(manifest,binding);
  return { material, object, recipe, style, environment };
}

const SOUND_DESCRIPTION_AXES = {
  energy: { positive: ['forceful','strong','stronger','harder hit','more energy'], negative: ['gentle','gentler','weaker','less energy'] },
  depth: { positive: ['heavy','heavier','deep','deeper','weightier'], negative: ['light','lighter','thin','thinner'] },
  texture: { positive: ['rocky','rough','rougher','grainy','more texture'], negative: ['smooth','smoother','less texture'] },
  attack: { positive: ['sharp','sharper','hard attack','harder attack','crisp attack'], negative: ['soft','softer','rounded','rounder','less sharp'] },
  ring: { positive: ['ringing','ringier','longer ring','long tail','longer tail'], negative: ['short ring','shorter ring','dead','less ringy','less ringing','short tail'] },
  boominess: { positive: ['boomy','boomier','punchy','punchier','more boom'], negative: ['tight','tighter','less boomy','less boom'] },
  brightness: { positive: ['bright','brighter','crisp','crisper'], negative: ['dark','darker','dull','duller','less bright'] },
  warmth: { positive: ['warm','warmer'], negative: ['cold','colder','less warm'] },
  space: { positive: ['roomy','roomier','echoing','echoey','more echo','larger chamber','larger room'], negative: ['dry','drier','close','closer','less echo','less roomy'] }
};
const DESCRIPTION_STEP=.16;
const phrasePattern=phrase=>new RegExp(`(?:^|\\b)${phrase.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&').replace(/\\ /g,'\\s+')}(?=$|\\b)`,'i');
const hasPhrase=(text,phrase)=>phrasePattern(phrase).test(text);

/**
 * Deterministic, deliberately constrained plain-language interpreter. It only
 * resolves phrases into SoundLab's explicit semantic controls/window; it never
 * creates an alternate synthesis path or guesses gameplay timing.
 */
export function interpretSoundDescription(text,{values={},scene=null}={}) {
  const source=String(text||'').trim().toLowerCase().replace(/[–—]/g,'-');
  const next={...values},changes=[],notes=[];
  if(!source)return{values:next,changes,notes,timing:null};
  for(const [axis,terms] of Object.entries(SOUND_DESCRIPTION_AXES)){
    let direction=0,matched='';
    for(const term of terms.negative){if(hasPhrase(source,term)){direction=-1;matched=term;break;}}
    if(!direction)for(const term of terms.positive){if(hasPhrase(source,term)){direction=1;matched=term;break;}}
    if(!direction)continue;
    const current=Number.isFinite(Number(values[axis]))?Number(values[axis]):axis==='space'?0:.5;
    let target=clamp(current+direction*DESCRIPTION_STEP,0,1);
    if(['dry','dead'].includes(matched))target=0;
    else if(['echoing','echoey','larger chamber','larger room'].includes(matched))target=Math.max(target,.78);
    else if(['heavy','deep','rocky','rough','sharp','bright','warm','boomy','punchy','forceful'].includes(matched))target=Math.max(target,.72);
    else if(['light','thin','smooth','soft','rounded','dark','dull','cold','tight','gentle'].includes(matched))target=Math.min(target,.28);
    next[axis]=Number(target.toFixed(2));
    changes.push({type:'control',axis,value:next[axis],phrase:matched});
  }
  let timing=null;
  if(scene){
    timing={};
    if(/(?:begin|start)(?:\s+the\s+sound)?(?:\s+exactly)?\s+(?:at|when)\s+(?:the\s+)?(?:contact|impact|hit|hits|touch|touches)/i.test(source)||/begin exactly when .*touch/i.test(source)){
      timing.startFrame=Number(scene.proofFrame);changes.push({type:'timing',edge:'start',frame:timing.startFrame,phrase:'start at contact'});
    }
    if(/(?:end|stop)(?:\s+the\s+sound)?\s+after\s+(?:the\s+)?(?:first\s+)?(?:bounce|rebound)/i.test(source)){
      const rebound=scene.segments?.find(row=>row.id==='rebound');
      if(rebound){timing.endFrame=Number(rebound.endFrame);changes.push({type:'timing',edge:'end',frame:timing.endFrame,phrase:'end after rebound'});}else notes.push('No rebound segment is present in the captured scene.');
    }
    if(/(?:end|stop)(?:\s+the\s+sound)?\s+(?:at|after)\s+(?:the\s+)?settle/i.test(source)){
      const settle=scene.segments?.find(row=>row.id==='settle');
      if(settle){timing.endFrame=Number(settle.endFrame);changes.push({type:'timing',edge:'end',frame:timing.endFrame,phrase:'end after settle'});}
    }
    if(!Object.keys(timing).length)timing=null;
  }else if(/(?:begin|start|end|stop).*(?:contact|impact|hit|touch|bounce|rebound|settle)/i.test(source))notes.push('Capture the native scene before applying timing phrases.');
  if(!changes.length&&!notes.length)notes.push('No supported sound or scene-timing phrases were recognized.');
  return{values:next,changes,notes,timing};
}

export function sceneMotionSamples(scene, windowState = null, { frameSeconds = 1 / 25 } = {}) {
  if (!scene?.path?.length) return [];
  const startFrame=Number(windowState?.startFrame ?? scene.startFrame ?? scene.minFrame), endFrame=Number(windowState?.endFrame ?? scene.endFrame ?? scene.maxFrame);
  const rows=scene.path.filter(row=>Number(row.frameSerial)>=startFrame&&Number(row.frameSerial)<=endFrame).sort((a,b)=>Number(a.frameSerial)-Number(b.frameSerial));
  if(!rows.length)return[];
  const samples=[];
  for(let index=0;index<rows.length;index+=1){
    const row=rows[index],previous=rows[Math.max(0,index-1)],frame=Number(row.frameSerial),previousFrame=Number(previous.frameSerial),frameSpan=Math.max(1,frame-previousFrame);
    const dx=index?(Number(row.x)-Number(previous.x))/frameSpan:0,dy=index?(Number(row.y)-Number(previous.y))/frameSpan:0;
    const prior=samples.at(-1),ax=index?(dx-Number(prior?.dx||0))/frameSpan:0,ay=index?(dy-Number(prior?.dy||0))/frameSpan:0;
    samples.push({frame,time:Number(((frame-startFrame)*frameSeconds).toFixed(6)),x:Number(row.x),y:Number(row.y),dx:Number(dx.toFixed(4)),dy:Number(dy.toFixed(4)),speed:Number(Math.hypot(dx,dy).toFixed(4)),ax:Number(ax.toFixed(4)),ay:Number(ay.toFixed(4))});
  }
  return samples;
}

function pathDistance(path,startFrame,endFrame){
  const rows=(path||[]).filter(row=>Number(row.frameSerial)>=startFrame&&Number(row.frameSerial)<=endFrame).sort((a,b)=>Number(a.frameSerial)-Number(b.frameSerial));
  let distance=0;
  for(let index=1;index<rows.length;index+=1)distance+=Math.hypot(Number(rows[index].x)-Number(rows[index-1].x),Number(rows[index].y)-Number(rows[index-1].y));
  return Number(distance.toFixed(4));
}

function playbackKind(recipe={}){
  const explicit=String(recipe.playback?.kind||'');
  if(['one-shot','repeated','looped','continuous'].includes(explicit))return explicit;
  return ['roll','slide','scrape','mechanism','emitter'].includes(String(recipe.generator||''))?'continuous':'one-shot';
}

function directionOf(vector){
  const x=Number(vector?.[0]||0),y=Number(vector?.[1]||0),length=Math.hypot(x,y);
  return length>0?[Number((x/length).toFixed(6)),Number((y/length).toFixed(6))]:[0,0];
}

function pathVelocityBefore(path,frame){
  const rows=(path||[]).filter(row=>Number(row.frameSerial)<frame).sort((a,b)=>Number(a.frameSerial)-Number(b.frameSerial));
  if(rows.length<2)return[0,0];
  const current=rows.at(-1),previous=rows.at(-2),span=Math.max(1,Number(current.frameSerial)-Number(previous.frameSerial));
  return[(Number(current.x)-Number(previous.x))/span,(Number(current.y)-Number(previous.y))/span];
}

function sceneSpatialization(scene,event,contact){
  if(!contact)return null;
  const width=Number(scene.viewport?.width||0),height=Number(scene.viewport?.height||0),x=Number(contact.x),y=Number(contact.y),world=Array.isArray(event.world)?event.world:Array.isArray(event.position)?event.position:null;
  const spatial={screen:[x,y]};
  if(world?.length>=2)spatial.native=[Number(world[0]),Number(world[1])];
  if(width>0&&height>0){
    const relative=[x-width/2,y-height/2];
    spatial.cameraRelative=relative.map(value=>Number(value.toFixed(4)));
    spatial.normalized=[Number((x/width).toFixed(6)),Number((y/height).toFixed(6))];
    spatial.pan=Number(Math.max(-1,Math.min(1,relative[0]/(width/2))).toFixed(6));
  }
  return spatial;
}

export function sceneSoundIntent(manifest, binding, scene, windowState = null, selections = {}) {
  if(!scene||!binding)return null;
  const resources=manifest?.previewModel?.resources||{},objectId=selections.object||binding.object,surfaceId=selections.surface||binding.surface,recipeId=selections.recipe||binding.recipe;
  const object=resources.objects?.[objectId]||{},recipe=resources.recipes?.[recipeId]||{},environment=environmentForBinding(manifest,binding),event=scene.event||{};
  const startFrame=Number(windowState?.startFrame??scene.startFrame),endFrame=Number(windowState?.endFrame??scene.endFrame),proofFrame=Number(scene.proofFrame),motion=sceneMotionSamples(scene,{startFrame,endFrame}),contact=scene.contact||null,facts=scene.facts||{};
  const velocity=[Number(event.frameDelta?.[0]||0),Number(event.frameDelta?.[1]||0)],priorVelocity=pathVelocityBefore(scene.path,proofFrame);
  const acceleration=[Number((velocity[0]-priorVelocity[0]).toFixed(4)),Number((velocity[1]-priorVelocity[1]).toFixed(4))];
  const size=object.size&&typeof object.size==='object'?JSON.parse(JSON.stringify(object.size)):null;
  const visualSize=contact?{width:Number(contact.width||0),height:Number(contact.height||0),referenceUnit:'game-px'}:null;
  return{
    schema:'soundlab.scene-intent.v1',
    event:String(event.event||binding.event||''),
    action:String(recipe.generator||'impact'),
    playback:{kind:playbackKind(recipe)},
    target:{object:String(objectId||''),family:String(binding.match?.actorFamily||event.actor?.family||''),slot:Number(event.actor?.slot??scene.target?.slot??0xff),mark:Number(event.actor?.mark??scene.target?.mark??0xffff),massClass:String(object.massClass||''),...(size?{size}:{}),...(visualSize?{visualSize}:{})},
    counterpart:{surface:String(surfaceId||''),material:String(surfaceId||'')},
    interval:{startFrame,endFrame,proofFrame,durationFrames:Math.max(0,endFrame-startFrame),frameRateHz:25},
    contact:contact?{x:Number(contact.x),y:Number(contact.y),normal:[...(event.normal||[0,0])],velocityPxPerFrame:velocity,speedPxPerFrame:Number(Math.hypot(...velocity).toFixed(4)),impactDirection:directionOf(velocity),accelerationPxPerFrame2:acceleration}:null,
    spatialization:sceneSpatialization(scene,event,contact),
    motion:{samples:motion,fallPx:Number(facts.fallPx||0),horizontalPx:Number(facts.horizontalPx||0),approachDistancePx:pathDistance(scene.path,startFrame,proofFrame),bouncePx:Number(facts.bouncePx||0),bounceCount:Number(facts.bounceCount||0)},
    segments:(scene.segments||[]).map(row=>({id:String(row.id),startFrame:Number(row.startFrame),endFrame:Number(row.endFrame)})),
    environment:environment?.id?{id:String(environment.id),world:environment.world||null}:null
  };
}

export function telemetryTrace(project, events, metadata = {}) {
  return {
    schema:'soundlab.telemetry.v1',
    project,
    capturedFrom:'native-runtime',
    ...metadata,
    events:events.map(event => ({
      event:event.event,
      submap:event.submap,
      actor:{ slot:event.actor?.slot ?? 0xff, mark:event.actor?.mark ?? 0xffff, ...(event.actor?.family ? {family:event.actor.family} : {}) },
      tick:event.tick,
      position:[...(event.world || event.position || [0,0])],
      motion:{dx:Number(event.frameDelta?.[0] ?? event.motion?.dx ?? 0),dy:Number(event.frameDelta?.[1] ?? event.motion?.dy ?? 0)},
      contact:{normal:[...(event.normal || event.contact?.normal || [0,0])]},
      direction:event.direction ?? 0
    }))
  };
}
