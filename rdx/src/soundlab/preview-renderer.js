/* Fast browser audition adapter. Production promotion always uses tools/soundlab's
 * canonical offline renderer; this intentionally shares recipe semantics, not
 * byte identity, so browser capabilities never become a build dependency. */
const TAU=Math.PI*2;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
class Rng { constructor(seed=1){this.s=(Number(seed)>>>0)||0x6d2b79f5;} next(){let x=this.s;x^=(x<<13)>>>0;x^=x>>>17;x^=(x<<5)>>>0;this.s=x>>>0;return this.s;} unit(){return this.next()/0x100000000;} signed(){return this.unit()*2-1;} normal(){return (this.signed()+this.signed()+this.signed())/3;} }
function hashSeed(seed,tag){let h=2166136261>>>0;for(const ch of String(tag)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return (Number(seed)^h)>>>0;}
function highpass(samples,cutoff,sr){if(!(cutoff>0))return;const a=Math.exp(-TAU*cutoff/sr);let low=0;for(let i=0;i<samples.length;i++){low=(1-a)*samples[i]+a*low;samples[i]-=low;}}
function lowpass(samples,cutoff,sr){if(!(cutoff>0)||cutoff>=sr*.48)return;const a=Math.exp(-TAU*cutoff/sr);let y=0;for(let i=0;i<samples.length;i++){y=(1-a)*samples[i]+a*y;samples[i]=y;}}
function softclip(x,amount){const drive=1+amount*2.5;return Math.tanh(x*drive)/Math.tanh(drive);}
function perceptualState(recipe={}){const row=recipe.perceptual||{};return{boominess:clamp(Number(row.boominess??.5),0,1),brightness:clamp(Number(row.brightness??.5),0,1),warmth:clamp(Number(row.warmth??.5),0,1),reverberance:clamp(Number(row.reverberance??0),0,1)};}
function modeTimbreGain(freq,p){const brightness=(p.brightness-.5)*2,warmth=(p.warmth-.5)*2,boom=(p.boominess-.5)*2,high=clamp(Math.log2(Math.max(40,freq)/500),-1.5,2)/2,low=clamp((700-freq)/650,-1,1),lowBass=clamp((420-freq)/380,0,1);return Math.pow(2,brightness*high*.55+warmth*low*.28+boom*lowBass*.58);}
function applyEnvironment(samples,sampleRate,environment={},perceptual={}){const amount=clamp(Number(perceptual.reverberance??0),0,1),wetMix=clamp(Number(environment?.maxWet??.16),0,.4)*amount;if(!(wetMix>0)||!samples.length)return;const dry=Float32Array.from(samples),wet=new Float32Array(samples.length),predelay=Math.max(0,Math.round(Number(environment?.predelayMs||0)*sampleRate/1000));for(const tap of environment?.earlyReflections||[]){const delay=predelay+Math.max(1,Math.round(Number(tap.delayMs||0)*sampleRate/1000)),gain=Number(tap.gain||0)*(.45+.55*amount);for(let i=0;i+delay<wet.length;i++)wet[i+delay]+=dry[i]*gain;}const decayMs=Math.max(40,Number(environment?.decayMs||140)),delay=Math.max(1,Math.round(predelay+23*sampleRate/1000)),feedback=Math.exp(Math.log(.001)*delay/(sampleRate*decayMs/1000)),damping=clamp(Number(environment?.highFrequencyDamping??.68),0,1);let filtered=0;for(let i=delay;i<wet.length;i++){const echoed=(dry[i-delay]*.08+wet[i-delay])*feedback;filtered=filtered*damping+echoed*(1-damping);wet[i]+=filtered;}for(let i=0;i<samples.length;i++)samples[i]=dry[i]+wet[i]*wetMix;}

function telemetryMotionRows(telemetry){
  if(Array.isArray(telemetry))return telemetry;
  if(Array.isArray(telemetry?.sceneIntent?.motion?.samples))return telemetry.sceneIntent.motion.samples;
  if(Array.isArray(telemetry?.motion))return telemetry.motion;
  return[];
}
function sceneConditionedImpactStrength(strength,recipe,telemetry,binding=null){
  const reference=Number(recipe?.mapping?.sceneSpeedReference??0),influence=clamp(Number(recipe?.mapping?.sceneEnergyInfluence??0),0,1);
  if(!(reference>0)||!(influence>0))return Number(strength);
  const intent=telemetry?.sceneIntent,intentMatches=intent&&(!binding?.event||String(intent.event||'')===String(binding.event)),events=Array.isArray(telemetry)?telemetry.filter(row=>row?.event):Array.isArray(telemetry?.events)?telemetry.events:[],row=intentMatches?{motion:{dx:intent.contact?.velocityPxPerFrame?.[0],dy:intent.contact?.velocityPxPerFrame?.[1]}}:(events.find(event=>!binding?.event||String(event?.event||'')===String(binding.event))||events[0]);
  const dx=Number(row?.motion?.dx??row?.dx??row?.frameDelta?.[0]),dy=Number(row?.motion?.dy??row?.dy??row?.frameDelta?.[1]);
  if(!Number.isFinite(dx)||!Number.isFinite(dy))return Number(strength);
  const ratio=clamp(Math.hypot(dx,dy)/reference,0,2),factor=(1-influence)+influence*Math.sqrt(ratio);
  return clamp(Number(strength)*factor,0,1);
}
function finishPreview(out,sampleRate,style={},environment=null,perceptual={}){
  applyEnvironment(out,sampleRate,environment||{},perceptual);highpass(out,Number(style.finishing?.highpassHz??22),sampleRate);lowpass(out,Number(style.finishing?.lowpassHz??sampleRate*.48),sampleRate);
  const drive=Number(style.finishing?.drive??1),clip=Number(style.finishing?.softClip??.75),master=Number(style.finishing?.masterGain??.9);let peak=0;
  for(let i=0;i<out.length;i++){out[i]=softclip(out[i]*drive,clip)*master;peak=Math.max(peak,Math.abs(out[i]));}if(peak>.985){const scale=.985/peak;for(let i=0;i<out.length;i++)out[i]*=scale;}
  return out;
}
export function renderImpactPreview({sampleRate=48000,strength=.7,seed=1,material,object,recipe,style,environment=null}){
  const length=Math.max(1,Math.ceil(sampleRate*Number(recipe.durationMs||320)/1000));
  const out=new Float32Array(length), body=new Float32Array(length),rng=new Rng(seed), pitch=rng.normal(),decayLat=rng.normal(),brightLat=rng.normal();
  const raw=clamp(Number(strength)||0,0,1),curve=recipe.mapping?.strengthCurve,sMapped=curve==='square'?raw*raw:curve==='linear'?raw:Math.sqrt(raw),s=Number(recipe.mapping?.minStrength??.1)+(1-Number(recipe.mapping?.minStrength??.1))*sMapped,perceptual=perceptualState(recipe);
  const hardness=clamp(Number(material.transient?.hardness??.5)+brightLat*Number(object.variation?.brightness??.035),0,1), trng=new Rng(hashSeed(seed,'transient'));
  const transientN=Math.max(1,Math.round((2.5+8*hardness)*sampleRate/1000));let low=0,prev=0;
  for(let i=0;i<Math.min(transientN,length);i++){const n=trng.signed();low=low*.62+n*.38;const bright=n-low*.55,attack=Math.min(1,i/Math.max(1,transientN*.08)),env=attack*Math.exp(-5.4*i/transientN),click=i===0?trng.signed()*.18*hardness:0;out[i]+=(bright*(.45+hardness*.75)+prev*.08)*env*s*Number(recipe.mapping?.transientGain??1)*Number(recipe.mix?.transient??.6)+click*s;prev=bright;}
  const mrng=new Rng(hashSeed(seed,'modes')),fScale=Number(object.modal?.frequencyScale??1),dScale=Number(object.modal?.decayScale??1),coupling=Number(object.modal?.coupling??1),bodyMix=Number(recipe.mix?.body??.8);
  for(const [index,mode] of (material.modal?.modes||[]).slice(0,Number(recipe.advanced?.modalModeLimit??12)).entries()){const freq=clamp(Number(mode.frequencyHz)*fScale*(1+pitch*Number(object.variation?.frequency??.018)+mrng.normal()*Number(mode.frequencyJitter??.004)),20,sampleRate*.46),decayMs=Math.max(8,Number(mode.decayMs)*dScale*(1+decayLat*Number(object.variation?.decay??.08)+mrng.normal()*.025)),gain=Number(mode.gain??1)*coupling*s*Number(recipe.mapping?.bodyGain??1)*(1-index*.035)*modeTimbreGain(freq,perceptual),phase=mrng.unit()*TAU,k=Math.log(1000)/(decayMs*sampleRate/1000);for(let i=0;i<length;i++)body[i]+=Math.sin(phase+TAU*freq*i/sampleRate)*Math.exp(-k*i)*gain;}
  for(let i=0;i<length;i++)out[i]+=body[i]*bodyMix;
  const rrng=new Rng(hashSeed(seed,'residual')),amount=Number(material.residual?.amount??0)*Number(recipe.mapping?.residualGain??1)*s*Number(recipe.mix?.residual??.3),rough=clamp(Number(material.contact?.roughness??.5),0,1),brightness=clamp(Number(material.residual?.brightness??.5)+(perceptual.brightness-.5)*.42-(perceptual.warmth-.5)*.18,0,1),decay=Math.log(1000)/(Math.max(15,Number(material.residual?.decayMs??70))*sampleRate/1000);low=0;let last=0;
  for(let i=0;i<length;i++){const n=rrng.signed();low=low*(.78-brightness*.3)+n*(.22+brightness*.3);const grain=(n-low)*(.3+brightness*.9)+low*.45,asperity=rrng.unit()<rough*.0025*s?rrng.signed()*1.5:0,x=(grain+asperity)*Math.exp(-decay*i)*amount;out[i]+=x*.88+last*.12;last=x;}
  finishPreview(out,sampleRate,style,environment,perceptual);
  return {samples:out,sampleRate};
}

export function renderRollPreview({sampleRate=48000,seed=1,material,object,recipe,style,environment=null,telemetry=[]}){
  const length=Math.max(1,Math.ceil(sampleRate*Number(recipe.durationMs||1000)/1000)),out=new Float32Array(length),rng=new Rng(seed),perceptual=perceptualState(recipe),ticks=telemetryMotionRows(telemetry);
  if(!ticks.length)return{samples:out,sampleRate,contacts:0};
  const rough=clamp(Number(material.contact?.roughness??.5),0,1),speedRef=Math.max(.1,Number(recipe.mapping?.speedReference??4)),densityScale=Number(recipe.mapping?.contactDensity??6),maxContacts=Number(recipe.advanced?.maxContactsPerSecond??90),microN=Math.max(1,Math.round(Number(recipe.advanced?.microImpactMs??45)*sampleRate/1000));
  const speedAt=time=>{let row=ticks[0];for(const candidate of ticks){if(Number(candidate.time??0)>time)break;row=candidate;}return Math.hypot(Number(row.dx||0),Number(row.dy||0));};
  const baseMode=(material.modal?.modes||[])[0]||{frequencyHz:180,decayMs:45,gain:.6},freq=clamp(Number(baseMode.frequencyHz||180)*Number(object.modal?.frequencyScale??1),30,sampleRate*.42),bodyGain=Number(recipe.mapping?.bodyGain??.42)*Number(recipe.mix?.body??.68),residualGain=Number(recipe.mapping?.residualGain??.28)*Number(recipe.mix?.residual??.38),decayMs=Math.max(12,Math.min(Number(baseMode.decayMs||45),Number(recipe.advanced?.microImpactMs??45)));
  let next=0,contacts=0;
  while(next<length){
    const speed=speedAt(next/sampleRate),normalized=clamp(speed/speedRef,0,3);
    if(normalized<=1e-6){next+=Math.max(1,Math.round(sampleRate*.02));continue;}
    const perSecond=clamp(densityScale*(.3+rough*1.3)*normalized,1,maxContacts),mean=sampleRate/perSecond,jitter=.55+rough*.55;
    next+=Math.max(1,Math.round(mean*(1+rng.normal()*jitter)));if(next>=length)break;
    const energy=clamp(.035+normalized*.085+rng.unit()*rough*.06,0,.32),phase=rng.unit()*TAU,decay=Math.log(1000)/(decayMs*sampleRate/1000);
    for(let i=0;i<microN&&next+i<length;i++){
      const env=Math.exp(-decay*i),body=Math.sin(phase+TAU*freq*i/sampleRate)*env*energy*bodyGain,texture=rng.signed()*env*energy*residualGain*(.35+rough*.8);
      out[next+i]+=body+texture;
    }
    contacts++;
  }
  finishPreview(out,sampleRate,style,environment,perceptual);
  return{samples:out,sampleRate,contacts};
}

export function renderSoundPreview(options){if(options?.recipe?.generator==='roll')return renderRollPreview(options);return renderImpactPreview({...options,strength:sceneConditionedImpactStrength(options?.strength,options?.recipe,options?.telemetry,options?.binding)});}
export function audioBufferFrom(context,render){const buffer=context.createBuffer(1,render.samples.length,render.sampleRate);buffer.copyToChannel(render.samples,0);return buffer;}
