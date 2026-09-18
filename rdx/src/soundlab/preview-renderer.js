/* Fast browser audition adapter. Production promotion always uses tools/soundlab's
 * canonical offline renderer; this intentionally shares recipe semantics, not
 * byte identity, so browser capabilities never become a build dependency. */
const TAU=Math.PI*2;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const ascii=(view,start,length)=>String.fromCharCode(...Array.from({length},(_,index)=>view.getUint8(start+index)));
export function decodePcmWavPreview(bytes){
  const buffer=bytes instanceof ArrayBuffer?bytes:bytes?.buffer?.slice(bytes.byteOffset||0,(bytes.byteOffset||0)+(bytes.byteLength||0));
  if(!(buffer instanceof ArrayBuffer))throw new Error('SoundLab frozen source requires WAV bytes');
  const view=new DataView(buffer);if(view.byteLength<12||ascii(view,0,4)!=='RIFF'||ascii(view,8,4)!=='WAVE')throw new Error('Unsupported WAV container');
  let offset=12,fmt=null,dataStart=-1,dataSize=0;
  while(offset+8<=view.byteLength){const id=ascii(view,offset,4),size=view.getUint32(offset+4,true),start=offset+8;if(start+size>view.byteLength)throw new Error('Malformed WAV chunk');if(id==='fmt '){fmt={format:view.getUint16(start,true),channels:view.getUint16(start+2,true),sampleRate:view.getUint32(start+4,true),bits:view.getUint16(start+14,true)};}if(id==='data'){dataStart=start;dataSize=size;break;}offset=start+size+(size&1);}
  if(!fmt||dataStart<0||fmt.format!==1||fmt.channels!==1||(fmt.bits!==8&&fmt.bits!==16))throw new Error('SoundLab currently accepts mono PCM 8/16-bit WAV');
  const bytesPerSample=fmt.bits>>3,count=Math.floor(dataSize/bytesPerSample),samples=new Float32Array(count);if(fmt.bits===8){for(let i=0;i<count;i++)samples[i]=(view.getUint8(dataStart+i)-128)/128;}else{for(let i=0;i<count;i++)samples[i]=view.getInt16(dataStart+i*2,true)/32768;}
  return{samples,sampleRate:fmt.sampleRate,channels:1,bits:fmt.bits};
}
export function resampleLinearPreview(samples,fromRate,toRate){if(Number(fromRate)===Number(toRate))return Float32Array.from(samples);const outLength=Math.max(1,Math.round(samples.length*Number(toRate)/Number(fromRate))),out=new Float32Array(outLength),scale=Number(fromRate)/Number(toRate);for(let i=0;i<outLength;i++){const pos=i*scale,a=Math.min(samples.length-1,Math.floor(pos)),b=Math.min(samples.length-1,a+1),t=pos-a;out[i]=samples[a]+(samples[b]-samples[a])*t;}return out;}
export function fitFrozenScoreLayerPreview(decoded,{sampleRate=48000,length=1,onsetSample=0,source=null}={}){if(!decoded?.samples?.length)return null;const samples=resampleLinearPreview(decoded.samples,decoded.sampleRate,sampleRate),onset=Math.max(0,Math.min(samples.length,Math.round(Number(onsetSample||0)*sampleRate/decoded.sampleRate))),out=new Float32Array(Math.max(1,Math.round(length)));for(let i=0;i<Math.min(out.length,samples.length-onset);i++)out[i]=samples[onset+i];return{samples:out,sampleRate,source:source?{id:source.id,sha256:source.sha256,role:source.role}:undefined};}
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
function motionStrengthFactor(strength,recipe={}){const reference=Number(recipe?.mapping?.strengthReference??0),influence=clamp(Number(recipe?.mapping?.strengthInfluence??0),0,1);if(!(reference>0)||!(influence>0))return 1;return Math.pow(clamp(Number(strength??reference)/reference,0,2),influence);}
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

export function renderRollPreview({sampleRate=48000,strength=.7,seed=1,material,object,recipe,style,environment=null,telemetry=[]}){
  const length=Math.max(1,Math.ceil(sampleRate*Number(recipe.durationMs||1000)/1000)),out=new Float32Array(length),rng=new Rng(seed),perceptual=perceptualState(recipe),ticks=telemetryMotionRows(telemetry);
  if(!ticks.length)return{samples:out,sampleRate,contacts:0};
  const rough=clamp(Number(material.contact?.roughness??.5),0,1),speedRef=Math.max(.1,Number(recipe.mapping?.speedReference??4)),densityScale=Number(recipe.mapping?.contactDensity??6),maxContacts=Number(recipe.advanced?.maxContactsPerSecond??90),microN=Math.max(1,Math.round(Number(recipe.advanced?.microImpactMs??45)*sampleRate/1000)),energyFactor=motionStrengthFactor(strength,recipe);
  const speedAt=time=>{let row=ticks[0];for(const candidate of ticks){if(Number(candidate.time??0)>time)break;row=candidate;}return Math.hypot(Number(row.dx||0),Number(row.dy||0));};
  const baseMode=(material.modal?.modes||[])[0]||{frequencyHz:180,decayMs:45,gain:.6},freq=clamp(Number(baseMode.frequencyHz||180)*Number(object.modal?.frequencyScale??1),30,sampleRate*.42),bodyGain=Number(recipe.mapping?.bodyGain??.42)*Number(recipe.mix?.body??.68),residualGain=Number(recipe.mapping?.residualGain??.28)*Number(recipe.mix?.residual??.38),decayMs=Math.max(12,Math.min(Number(baseMode.decayMs||45),Number(recipe.advanced?.microImpactMs??45)));
  let next=0,contacts=0;
  while(next<length){
    const speed=speedAt(next/sampleRate),normalized=clamp(speed/speedRef,0,3)*energyFactor;
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

export function renderFrictionPreview({sampleRate=48000,strength=.7,seed=1,material,object,recipe,style,environment=null,telemetry=[]}){
  const length=Math.max(1,Math.ceil(sampleRate*Number(recipe.durationMs||1000)/1000)),out=new Float32Array(length),rng=new Rng(seed),perceptual=perceptualState(recipe),ticks=telemetryMotionRows(telemetry);
  if(!ticks.length)return{samples:out,sampleRate,contacts:0};
  const speedAt=time=>{let row=ticks[0];for(const candidate of ticks){if(Number(candidate.time??0)>time)break;row=candidate;}return Math.hypot(Number(row.dx||0),Number(row.dy||0));};
  const speedRef=Math.max(.1,Number(recipe.mapping?.speedReference??4)),strengthFactor=motionStrengthFactor(strength,recipe),speedExponent=Math.max(.2,Number(recipe.mapping?.speedExponent??.8));
  const rough=clamp(Number(material.contact?.roughness??.5)*Number(recipe.mapping?.roughnessDrive??1),0,1.5),frictionGain=Math.max(0,Number(recipe.mapping?.frictionGain??.35))*Number(recipe.mix?.residual??.65),bodyGain=Math.max(0,Number(recipe.mapping?.bodyGain??.12))*Number(recipe.mix?.body??.25);
  const chatterDensity=Math.max(0,Number(recipe.mapping?.chatterDensity??2)),maxChatter=Math.max(0,Number(recipe.advanced?.maxChatterPerSecond??30)),chatterDecay=Math.exp(Math.log(.001)/Math.max(1,Number(recipe.advanced?.chatterMs??14)*sampleRate/1000));
  const baseMode=(material.modal?.modes||[])[0]||{frequencyHz:180},bodyFreq=clamp(Number(baseMode.frequencyHz||180)*Number(object.modal?.frequencyScale??1)*Number(recipe.advanced?.bodyFrequencyScale??.7),25,sampleRate*.35);
  let low=0,phase=0,chatter=0,contacts=0,envelope=0;
  for(let i=0;i<length;i++){const normalized=clamp(speedAt(i/sampleRate)/speedRef,0,3),motion=Math.pow(normalized,speedExponent)*strengthFactor,target=clamp(motion,0,3),slew=target>envelope ? .018 : .006;envelope+=(target-envelope)*slew;if(envelope<=1e-7){chatter*=chatterDecay;continue;}const n=rng.signed();low=low*(.86-rough*.16)+n*(.14+rough*.16);const grain=(n-low)*(.35+rough*.75)+low*.24,chatterRate=Math.min(maxChatter,chatterDensity*(.25+rough*1.5)*envelope);if(chatterRate>0&&rng.unit()<chatterRate/sampleRate){chatter+=rng.signed()*(.12+.12*rough)*Math.min(1.5,envelope);contacts++;}chatter*=chatterDecay;phase+=TAU*bodyFreq*(.72+.13*Math.min(2,envelope))/sampleRate;out[i]+=grain*frictionGain*envelope+Math.sin(phase)*bodyGain*envelope*(.25+.35*rough)+chatter;}
  finishPreview(out,sampleRate,style,environment,perceptual);return{samples:out,sampleRate,contacts};
}

export function renderLaunchPreview({sampleRate=48000,strength=.7,seed=1,material,object,recipe,style,environment=null}){
  const length=Math.max(1,Math.ceil(sampleRate*Number(recipe.durationMs||160)/1000)),out=new Float32Array(length),rng=new Rng(seed),perceptual=perceptualState(recipe),raw=clamp(Number(strength)||0,0,1),s=Number(recipe.mapping?.minStrength??.1)+(1-Number(recipe.mapping?.minStrength??.1))*Math.sqrt(raw),hardness=clamp(Number(material.transient?.hardness??.55),0,1),baseHz=clamp(Number(recipe.mapping?.bodyFrequencyHz??420)*Number(object.modal?.frequencyScale??1),40,sampleRate*.4),sweep=Number(recipe.mapping?.sweepOctaves??.45),noiseGain=Number(recipe.mapping?.noiseGain??.62),bodyGain=Number(recipe.mapping?.bodyGain??.28);let phase=0,low=0;
  for(let i=0;i<length;i++){const t=i/Math.max(1,length-1),env=(1-Math.exp(-t*70))*Math.exp(-t*Number(recipe.mapping?.decayShape??7.5)),n=rng.signed();low=low*.7+n*.3;const bright=n-low*(.35+.3*(1-hardness)),freq=baseHz*Math.pow(2,sweep*(.5-t));phase+=TAU*freq/sampleRate;out[i]+=env*s*(bright*noiseGain+Math.sin(phase)*bodyGain);}
  finishPreview(out,sampleRate,style,environment,perceptual);return{samples:out,sampleRate};
}

export function renderMechanismPreview(options){
  const {sampleRate=48000,strength=.7,seed=1,material,object,recipe,style,environment=null,telemetry=[]}=options,length=Math.max(1,Math.ceil(sampleRate*Number(recipe.durationMs||1000)/1000)),base=renderFrictionPreview({...options,style:{finishing:{drive:1,softClip:0,masterGain:1,highpassHz:0,lowpassHz:sampleRate*.48}},environment:null}),out=Float32Array.from(base.samples),rng=new Rng(seed^0x6d656368),ticks=telemetryMotionRows(telemetry),speedRef=Math.max(.1,Number(recipe.mapping?.speedReference??2));
  const speedAt=time=>{let row=ticks[0]||{dx:0,dy:0};for(const candidate of ticks){if(Number(candidate.time??0)>time)break;row=candidate;}return Math.hypot(Number(row.dx||0),Number(row.dy||0));},cadence=Math.max(.5,Number(recipe.mapping?.cadenceHz??5)),clickN=Math.max(1,Math.round(Number(recipe.advanced?.clickMs??18)*sampleRate/1000)),mode=(material.modal?.modes||[])[0]||{frequencyHz:180},freq=clamp(Number(mode.frequencyHz||180)*Number(recipe.advanced?.clickFrequencyScale??1.4),50,sampleRate*.4),strengthFactor=motionStrengthFactor(strength,recipe),clickGain=Math.max(0,Number(recipe.mapping?.clickGain??.22))*strengthFactor;let contacts=base.contacts||0;
  const addClick=(sampleIndex,gain,motion=1)=>{const start=Math.max(0,Math.min(length-1,Math.round(sampleIndex))),phase=rng.unit()*TAU,scaled=Math.max(0,gain)*strengthFactor*Math.min(1.5,Math.max(.35,motion));for(let i=0;i<clickN&&start+i<length;i++){const env=Math.exp(-5*i/clickN);out[start+i]+=Math.sin(phase+TAU*freq*i/sampleRate)*env*scaled+rng.signed()*env*scaled*.22;}contacts++;};
  let moving=false;for(const row of ticks){const speed=Math.hypot(Number(row.dx||0),Number(row.dy||0)),isMoving=speed>1e-6,time=Math.max(0,Number(row.time??0));if(isMoving&&!moving)addClick(time*sampleRate,Number(recipe.mapping?.startClickGain??.18),clamp(speed/speedRef,0,3));else if(!isMoving&&moving)addClick(time*sampleRate,Number(recipe.mapping?.stopClickGain??.24),1);moving=isMoving;}
  let next=0;while(next<length){const motion=clamp(speedAt(next/sampleRate)/speedRef,0,3);if(motion<=1e-6){next+=Math.max(1,Math.round(sampleRate*.02));continue;}next+=Math.max(1,Math.round(sampleRate/(cadence*(.55+.65*motion))));if(next>=length)break;const phase=rng.unit()*TAU;for(let i=0;i<clickN&&next+i<length;i++){const env=Math.exp(-5*i/clickN);out[next+i]+=Math.sin(phase+TAU*freq*i/sampleRate)*env*clickGain*Math.min(1.5,motion)+rng.signed()*env*clickGain*.22;}contacts++;}
  finishPreview(out,sampleRate,style,environment,perceptualState(recipe));return{samples:out,sampleRate,contacts};
}

export function renderExplosionPreview({sampleRate=48000,strength=.8,seed=1,material,object,recipe,style,environment=null}){
  const length=Math.max(1,Math.ceil(sampleRate*Number(recipe.durationMs||420)/1000)),out=new Float32Array(length),rng=new Rng(seed),perceptual=perceptualState(recipe),s=Number(recipe.mapping?.minStrength??.16)+(1-Number(recipe.mapping?.minStrength??.16))*Math.sqrt(clamp(Number(strength)||0,0,1)),crackGain=Number(recipe.mapping?.crackGain??.72),bodyGain=Number(recipe.mapping?.bodyGain??.48),debrisGain=Number(recipe.mapping?.debrisGain??.22),bodyHz=clamp(Number(recipe.mapping?.bodyFrequencyHz??115)*Number(object.modal?.frequencyScale??1),45,420);let low=0,phase=rng.unit()*TAU;
  for(let i=0;i<length;i++){const t=i/sampleRate,fast=Math.exp(-t*24),body=Math.exp(-t*8.5),tail=Math.exp(-t*5.2),n=rng.signed();low=low*.92+n*.08;phase+=TAU*bodyHz/sampleRate;out[i]+=((n-low)*fast*crackGain+(Math.sin(phase)*.65+low*.35)*body*bodyGain+(rng.unit()<.0018?rng.signed()*1.4:0)*tail*debrisGain)*s;}
  finishPreview(out,sampleRate,style,environment,perceptual);return{samples:out,sampleRate};
}

export function renderEmitterPreview({sampleRate=48000,strength=.55,seed=1,material,recipe,style,environment=null}){
  const length=Math.max(1,Math.ceil(sampleRate*Number(recipe.durationMs||1200)/1000)),out=new Float32Array(length),rng=new Rng(seed),perceptual=perceptualState(recipe),gain=Math.max(0,Number(recipe.mapping?.noiseGain??.32))*clamp(strength,0,1),rough=clamp(Number(material.contact?.roughness??.5),0,1),pulseHz=Math.max(0,Number(recipe.mapping?.pulseHz??0)),brightness=clamp(Number(material.residual?.brightness??.6),0,1);let low=0;
  for(let i=0;i<length;i++){const n=rng.signed();low=low*(.88-brightness*.2)+n*(.12+brightness*.2);const hiss=(n-low)*(.5+brightness*.7)+low*.15,pulse=pulseHz>0?.82+.18*Math.sin(TAU*pulseHz*i/sampleRate):1;out[i]=hiss*gain*pulse*(.7+.3*rough);}
  finishPreview(out,sampleRate,style,environment,perceptual);return{samples:out,sampleRate};
}


export function renderScoreLayerPreview({sampleRate=48000,durationMs=240,strength=.7,seed=1,material={},object={},recipe={},style={},environment=null,telemetry=[],binding=null,source={},semanticType='motion',controlSignals=null}={}){
  const type=String(source?.type||'noise');
  if(type==='binding')return renderSoundPreview({sampleRate,strength,seed,material,object,recipe,style,environment,telemetry,binding});
  const length=Math.max(1,Math.ceil(sampleRate*Math.max(1,Number(durationMs||240))/1000)),out=new Float32Array(length),rng=new Rng(seed),params=source?.params||{},rows=telemetryMotionRows(telemetry),speedRef=Math.max(.1,Number(params.speedReference??recipe?.mapping?.speedReference??4)),baseGain=Math.max(0,Number(params.gain??1)),baseRough=clamp(Number(material?.contact?.roughness??.5),0,1),baseBrightness=clamp(Number(params.brightness??recipe?.perceptual?.brightness??material?.residual?.brightness??.55),0,1);
  const signalAt=(target,index,fallback)=>{const values=controlSignals?.targets?.[target];if(!Array.isArray(values)||!values.length)return fallback;const p=clamp(index/Math.max(1,length-1),0,1)*(values.length-1),a=Math.floor(p),b=Math.min(values.length-1,Math.ceil(p)),t=p-a;return Number(values[a]??fallback)+(Number(values[b]??fallback)-Number(values[a]??fallback))*t;};
  const strengthAt=i=>clamp(signalAt('binding.strength',i,Number(strength)||0),0,1),roughAt=i=>clamp(signalAt('material.contact.roughness',i,baseRough),0,1),brightnessAt=i=>clamp(signalAt('recipe.perceptual.brightness',i,baseBrightness),0,1);
  const speedAt=time=>{if(!rows.length)return speedRef;let row=rows[0];for(const candidate of rows){if(Number(candidate.time??0)>time)break;row=candidate;}return Math.hypot(Number(row.dx||0),Number(row.dy||0));};
  const motionEnvelope=i=>{const normalized=clamp(speedAt(i/sampleRate)/speedRef,0,2),attack=Math.min(1,i/Math.max(1,Math.round(sampleRate*.008))),release=Math.min(1,(length-i)/Math.max(1,Math.round(sampleRate*.012)));return baseGain*strengthAt(i)*Math.min(attack,release)*(.2+.8*Math.pow(normalized,.7));};
  let contacts=0;
  if(type==='noise'){
    let low=0,slow=0;const whoosh=semanticType==='falling'||String(source?.id||'').includes('whoosh');for(let i=0;i<length;i++){const env=motionEnvelope(i),n=rng.signed(),brightness=brightnessAt(i),rough=roughAt(i);low=low*(.9-brightness*.18)+n*(.1+brightness*.18);slow=slow*.985+n*.015;const hiss=(n-low)*(.35+brightness*.95)+low*.18,body=slow*(.2+.35*(1-brightness));out[i]=(whoosh?hiss*.78+body*.22:hiss*.52+low*.48)*env*(.6+.4*rough);}
  }else if(type==='contact-train'){
    const density=Math.max(.2,Number(params.density??recipe?.mapping?.contactDensity??7)),mode=(material?.modal?.modes||[])[0]||{frequencyHz:170,decayMs:35},freq=clamp(Number(mode.frequencyHz||170)*Number(object?.modal?.frequencyScale??1),35,sampleRate*.38),decayMs=Math.max(6,Number(params.decayMs??Math.min(48,Number(mode.decayMs||35)))),pulseN=Math.max(1,Math.round(decayMs*sampleRate/1000));let next=0;while(next<length){const normalized=clamp(speedAt(next/sampleRate)/speedRef,0,2);if(normalized<=1e-6){next+=Math.max(1,Math.round(sampleRate*.02));continue;}const rough=roughAt(next),densityNow=Math.max(.2,signalAt('recipe.mapping.contactDensity',next,density)),rate=densityNow*(.35+normalized*(.7+rough*.5)),mean=sampleRate/Math.max(.2,rate);next+=Math.max(1,Math.round(mean*(.72+rng.unit()*.56)));if(next>=length)break;const phase=rng.unit()*TAU,amp=baseGain*strengthAt(next)*(.045+.09*normalized)*(.7+.3*rng.unit());for(let j=0;j<pulseN&&next+j<length;j++){const env=Math.exp(-5.2*j/pulseN);out[next+j]+=Math.sin(phase+TAU*freq*j/sampleRate)*env*amp+rng.signed()*env*amp*.38;}contacts++;}
  }else if(type==='resonant-body'){
    const modes=(material?.modal?.modes||[]).slice(0,Math.max(1,Math.min(8,Math.round(Number(params.modeLimit??4))))),decayScale=Math.max(.1,Number(params.decayScale??1)),frequencyScale=Math.max(.2,Number(params.frequencyScale??1))*Number(object?.modal?.frequencyScale??1),motionBed=!['impact','rebound'].includes(semanticType),perceptual=perceptualState(recipe);for(const [index,mode] of modes.entries()){const freq=clamp(Number(mode.frequencyHz||150)*frequencyScale,30,sampleRate*.4),phase=rng.unit()*TAU,decayMs=Math.max(12,Number(mode.decayMs||90)*Number(object?.modal?.decayScale??1)*decayScale),decay=Math.log(1000)/(decayMs*sampleRate/1000),modeGain=Number(mode.gain??1)*baseGain*(.18-index*.012)*modeTimbreGain(freq,perceptual);for(let i=0;i<length;i++){const env=motionBed?motionEnvelope(i):Math.exp(-decay*i)*strengthAt(i);out[i]+=Math.sin(phase+TAU*freq*i/sampleRate)*env*modeGain;}}
  }else if(type==='accent'){
    const density=Math.max(.2,Number(params.density??7)),decayN=Math.max(8,Math.round(Number(params.decayMs??18)*sampleRate/1000)),freq=Math.max(60,Number(params.frequencyHz??950)),count=Math.max(1,Math.round(durationMs/1000*density));for(let n=0;n<count;n++){const center=Math.min(length-1,Math.round((.08+.86*rng.unit())*length)),amp=baseGain*strengthAt(center)*(.08+.13*rng.unit()),phase=rng.unit()*TAU;for(let j=0;j<decayN&&center+j<length;j++){const env=Math.exp(-5*j/decayN);out[center+j]+=rng.signed()*env*amp*.7+Math.sin(phase+TAU*freq*j/sampleRate)*env*amp*.3;}contacts++;}
  }else if(type==='procedural'&&String(source?.id||'').includes('transient')){
    const hardness=clamp(Number(material?.transient?.hardness??.55),0,1),duration=Math.max(1,Math.round((2.5+8*hardness)*sampleRate/1000));let low=0,prev=0;for(let i=0;i<Math.min(duration,length);i++){const n=rng.signed();low=low*.62+n*.38;const bright=n-low*.55,attack=Math.min(1,i/Math.max(1,duration*.08)),env=attack*Math.exp(-5.4*i/duration),click=i===0?rng.signed()*.18*hardness:0;out[i]+=(bright*(.45+hardness*.75)+prev*.08)*env*baseGain*strengthAt(i)*Math.max(0,signalAt('recipe.mapping.transientGain',i,Number(recipe?.mapping?.transientGain??1)))+click*baseGain*strengthAt(i);prev=bright;}contacts=1;
  }
  finishPreview(out,sampleRate,style,environment,perceptualState(recipe));return{samples:out,sampleRate,contacts};
}

export function scoreLayerMixGains(layer,{sampleRate=48000,length=1,seed=1}={}){
  const count=Math.max(1,Math.round(Number(length)||1)),rate=Math.max(1,Number(sampleRate)||48000),gain=Math.max(0,Number(layer?.gain??1)),envelope=layer?.envelope||{},variation=layer?.variation||{};
  const attackN=Math.max(0,Math.round(Math.max(0,Number(envelope.attackMs)||0)*rate/1000)),releaseN=Math.max(0,Math.round(Math.max(0,Number(envelope.releaseMs)||0)*rate/1000));
  const amount=Math.max(0,Math.min(1,Number(variation.amount)||0)),variationRate=Math.max(.1,Math.min(20,Number(variation.rateHz)||4)),seedOffset=Math.round(Number(variation.seedOffset)||0);let knots=null;
  if(amount>0){const duration=count/rate,knotCount=Math.max(2,Math.ceil(duration*variationRate)+1);knots=new Float32Array(knotCount);let state=((Number(seed)>>>0)^(Math.imul(seedOffset|0,0x9e3779b1)>>>0)^0x76617279)>>>0;if(!state)state=0x6d2b79f5;for(let index=0;index<knotCount;index++){let x=state>>>0;x^=(x<<13)>>>0;x^=x>>>17;x^=(x<<5)>>>0;state=x>>>0;knots[index]=state/0x100000000*2-1;}}
  const out=new Float32Array(count);for(let index=0;index<count;index++){const attack=attackN>0?Math.min(1,index/attackN):1,release=releaseN>0?Math.min(1,(count-1-index)/releaseN):1;let factor=1;if(knots){const position=(index/Math.max(1,count-1))*(knots.length-1),a=Math.floor(position),b=Math.min(knots.length-1,Math.ceil(position)),t=position-a,noise=knots[a]+(knots[b]-knots[a])*t;factor=Math.max(0,1+amount*noise);}out[index]=gain*Math.min(attack,release)*factor;}return out;
}

export function mixScoreLayerPreviews(layers,{sampleRate=48000}={}){
  const length=Math.max(1,...layers.map(row=>row?.render?.samples?.length||0)),out=new Float32Array(length);let contacts=0;for(const row of layers){const samples=row?.render?.samples||[],gains=scoreLayerMixGains(row,{sampleRate,length,seed:row?.mixSeed??1});for(let i=0;i<samples.length;i++)out[i]+=samples[i]*gains[i];contacts+=Number(row?.render?.contacts||0);}let peak=0;for(const value of out)peak=Math.max(peak,Math.abs(value));if(peak>.985){const scale=.985/peak;for(let i=0;i<out.length;i++)out[i]*=scale;}return{samples:out,sampleRate,contacts,layers:layers.map(row=>({id:row.id,source:row.source,gain:row.gain,envelope:row.envelope||null,variation:row.variation||null}))};
}

export function renderSoundPreview(options){const generator=String(options?.recipe?.generator||'impact');if(generator==='roll')return renderRollPreview(options);if(generator==='slide'||generator==='scrape')return renderFrictionPreview(options);if(generator==='launch')return renderLaunchPreview(options);if(generator==='mechanism')return renderMechanismPreview(options);if(generator==='explosion')return renderExplosionPreview(options);if(generator==='emitter')return renderEmitterPreview(options);return renderImpactPreview({...options,strength:sceneConditionedImpactStrength(options?.strength,options?.recipe,options?.telemetry,options?.binding)});}
export function audioBufferFrom(context,render){const buffer=context.createBuffer(1,render.samples.length,render.sampleRate);buffer.copyToChannel(render.samples,0);return buffer;}
