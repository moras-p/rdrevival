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
export function renderImpactPreview({sampleRate=48000,strength=.7,seed=1,material,object,recipe,style}){
  const length=Math.max(1,Math.ceil(sampleRate*Number(recipe.durationMs||320)/1000));
  const out=new Float32Array(length), body=new Float32Array(length),rng=new Rng(seed), pitch=rng.normal(),decayLat=rng.normal(),brightLat=rng.normal();
  const raw=clamp(Number(strength)||0,0,1),curve=recipe.mapping?.strengthCurve,sMapped=curve==='square'?raw*raw:curve==='linear'?raw:Math.sqrt(raw),s=Number(recipe.mapping?.minStrength??.1)+(1-Number(recipe.mapping?.minStrength??.1))*sMapped;
  const hardness=clamp(Number(material.transient?.hardness??.5)+brightLat*Number(object.variation?.brightness??.035),0,1), trng=new Rng(hashSeed(seed,'transient'));
  const transientN=Math.max(1,Math.round((2.5+8*hardness)*sampleRate/1000));let low=0,prev=0;
  for(let i=0;i<Math.min(transientN,length);i++){const n=trng.signed();low=low*.62+n*.38;const bright=n-low*.55,attack=Math.min(1,i/Math.max(1,transientN*.08)),env=attack*Math.exp(-5.4*i/transientN),click=i===0?trng.signed()*.18*hardness:0;out[i]+=(bright*(.45+hardness*.75)+prev*.08)*env*s*Number(recipe.mapping?.transientGain??1)*Number(recipe.mix?.transient??.6)+click*s;prev=bright;}
  const mrng=new Rng(hashSeed(seed,'modes')),fScale=Number(object.modal?.frequencyScale??1),dScale=Number(object.modal?.decayScale??1),coupling=Number(object.modal?.coupling??1),bodyMix=Number(recipe.mix?.body??.8);
  for(const [index,mode] of (material.modal?.modes||[]).slice(0,Number(recipe.advanced?.modalModeLimit??12)).entries()){const freq=clamp(Number(mode.frequencyHz)*fScale*(1+pitch*Number(object.variation?.frequency??.018)+mrng.normal()*Number(mode.frequencyJitter??.004)),20,sampleRate*.46),decayMs=Math.max(8,Number(mode.decayMs)*dScale*(1+decayLat*Number(object.variation?.decay??.08)+mrng.normal()*.025)),gain=Number(mode.gain??1)*coupling*s*Number(recipe.mapping?.bodyGain??1)*(1-index*.035),phase=mrng.unit()*TAU,k=Math.log(1000)/(decayMs*sampleRate/1000);for(let i=0;i<length;i++)body[i]+=Math.sin(phase+TAU*freq*i/sampleRate)*Math.exp(-k*i)*gain;}
  for(let i=0;i<length;i++)out[i]+=body[i]*bodyMix;
  const rrng=new Rng(hashSeed(seed,'residual')),amount=Number(material.residual?.amount??0)*Number(recipe.mapping?.residualGain??1)*s*Number(recipe.mix?.residual??.3),rough=clamp(Number(material.contact?.roughness??.5),0,1),brightness=clamp(Number(material.residual?.brightness??.5),0,1),decay=Math.log(1000)/(Math.max(15,Number(material.residual?.decayMs??70))*sampleRate/1000);low=0;let last=0;
  for(let i=0;i<length;i++){const n=rrng.signed();low=low*(.78-brightness*.3)+n*(.22+brightness*.3);const grain=(n-low)*(.3+brightness*.9)+low*.45,asperity=rrng.unit()<rough*.0025*s?rrng.signed()*1.5:0,x=(grain+asperity)*Math.exp(-decay*i)*amount;out[i]+=x*.88+last*.12;last=x;}
  highpass(out,Number(style.finishing?.highpassHz??22),sampleRate);lowpass(out,Number(style.finishing?.lowpassHz??sampleRate*.48),sampleRate);
  const drive=Number(style.finishing?.drive??1),clip=Number(style.finishing?.softClip??.75),master=Number(style.finishing?.masterGain??.9);let peak=0;
  for(let i=0;i<length;i++){out[i]=softclip(out[i]*drive,clip)*master;peak=Math.max(peak,Math.abs(out[i]));}if(peak>.985){const scale=.985/peak;for(let i=0;i<length;i++)out[i]*=scale;}
  return {samples:out,sampleRate};
}
export function audioBufferFrom(context,render){const buffer=context.createBuffer(1,render.samples.length,render.sampleRate);buffer.copyToChannel(render.samples,0);return buffer;}
