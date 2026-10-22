/* Review-only generated audio over native SoundLab visual replay. The checked
 * event and rolling-contact motion profile must match the fixture; the
 * final airborne frames are muted, so their vertical distances may differ. */
export function matchingRollingReviewScene(scene, catalog) {
  if (!scene || !catalog?.available || scene.event?.event !== 'boulder.roll' ||
      Number(scene.event?.submap) !== 0 || Number(scene.event?.actor?.mark) !== 1 ||
      Number(scene.proofFrame) !== Number(scene.event?.tick) + 1) return false;
  const expected = catalog.expectedMotion;
  if (!Array.isArray(expected) || expected.length !== catalog.frameCount) return false;
  const rows = new Map((scene.path||[]).map(row => [Number(row.frameSerial),row]));
  const proof = Number(scene.proofFrame);
  for (let index=0;index<expected.length;index++) {
    const now=rows.get(proof+index),previous=rows.get(proof+index-1);
    if (!now||!previous) return false;
    const dx=index===0?Number(scene.event.frameDelta?.[0]):Number(now.x)-Number(previous.x);
    const dy=index===0?Number(scene.event.frameDelta?.[1]):Number(now.y)-Number(previous.y);
    if (!Number.isFinite(dx)||!Number.isFinite(dy)||Math.abs(dx-expected[index][0])>.01 ||
        (Math.abs(dy)<.5)!==expected[index][2] || (expected[index][2] && Math.abs(dy-expected[index][1])>.01)) return false;
  }
  return true;
}

export function rollingReviewPlaybackPlan(scene, event, frameCount=96, frameRateHz=25) {
  if (!scene || !event || !Number.isFinite(Number(scene.proofFrame))) return null;
  const first=Number(scene.proofFrame),last=first+frameCount-1;
  const start=Math.max(Number(event.frameSerial), Number(event.startFrame), first);
  const end=Math.min(Number(event.endFrame),last);
  if (![start,end].every(Number.isFinite)||end<start)return null;
  return {delaySeconds:Math.max(0,first-Number(event.frameSerial))/frameRateHz,
    offsetSeconds:(start-first)/frameRateHz,
    durationSeconds:(end-start+1)/frameRateHz};
}

/* Listening-only transform. Native gameplay stays at its original frame cadence;
 * the replay adapter controls wall-clock display speed. A transient-friendly
 * waveform-similarity overlap/add stretch keeps pitch and time independent. */
export function rollingReviewTuning({speed=1,pitch=0,volume=100}={}) {
  const rate=Number(speed),semitones=Number(pitch),level=Number(volume);
  if (![1,.75,.5,.25].includes(rate) || !Number.isFinite(semitones) || semitones < -6 || semitones > 6 ||
      !Number.isFinite(level) || level < 0 || level > 150) throw new Error('Invalid rolling review audition settings');
  return {speed:rate,pitch:Math.round(semitones*2)/2,volume:Math.round(level)};
}

export function rollingReviewTimePlan(plan,speed=1) {
  const tuning=rollingReviewTuning({speed});
  if (!plan) return null;
  return Object.fromEntries(Object.entries(plan).map(([key,value])=>[key,value/tuning.speed]));
}

export function rollingReviewPitchTime(samples,sampleRate,{speed=1,pitch=0,tempo=1}={}) {
  const tuning=rollingReviewTuning({speed,pitch});
  if(!Number.isFinite(tempo)||tempo<.5||tempo>1.5)throw new Error('Invalid rolling audio cadence');
  if (!(samples instanceof Float32Array) || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000)
    throw new Error('Expected mono floating-point rolling audio and a valid sampling rate');
  if (tuning.speed===1 && tuning.pitch===0 && tempo===1) return samples;
  if (!samples.length) return new Float32Array();
  const ratio=2**(tuning.pitch/12),intermediateLength=Math.max(1,Math.ceil(samples.length/ratio));
  const pitched=new Float32Array(intermediateLength);
  for(let i=0;i<intermediateLength;i++) {
    const point=Math.min(samples.length-1,i*ratio),lo=Math.floor(point),mix=point-lo;
    pitched[i]=samples[lo]*(1-mix)+(samples[Math.min(lo+1,samples.length-1)]||0)*mix;
  }
  const outputLength=Math.max(1,Math.round(samples.length/(tuning.speed*tempo)));
  if(outputLength<=32) {
    const output=new Float32Array(outputLength);
    for(let i=0;i<outputLength;i++) output[i]=pitched[Math.min(pitched.length-1,Math.floor(i*pitched.length/outputLength))];
    return output;
  }
  const grain=Math.min(2048,Math.max(128,2**Math.round(Math.log2(sampleRate*.045))));
  const hop=grain>>1,overlap=grain-hop,search=Math.round(grain*.14),stride=8;
  const output=new Float32Array(outputLength),weights=new Float32Array(outputLength);
  const window=new Float32Array(grain);
  for(let i=0;i<grain;i++) window[i]=.5-.5*Math.cos(2*Math.PI*(i+.5)/grain);
  const lastStart=Math.max(0,pitched.length-grain);
  let first=true;
  for(let dest=0;dest<outputLength;dest+=hop) {
    const center=Math.min(lastStart,Math.max(0,Math.round(dest*pitched.length/outputLength)));
    let sourceStart=center;
    if(!first && center>0 && center<lastStart) {
      let best=-Infinity;
      for(let shift=-search;shift<=search;shift+=4) {
        const src=Math.max(0,Math.min(lastStart,center+shift));
        let ab=0,aa=0,bb=0;
        for(let j=0;j<overlap && dest+j<outputLength;j+=stride) {
          const w=weights[dest+j];if(w<.1)continue;
          const a=output[dest+j]/w,b=pitched[Math.min(pitched.length-1,src+j)];
          ab+=a*b;aa+=a*a;bb+=b*b;
        }
        const similarity=ab/Math.sqrt(aa*bb+1e-12)-.015*Math.abs(src-center)/Math.max(1,search);
        if(similarity>best){best=similarity;sourceStart=src;}
      }
    }
    for(let j=0;j<grain&&dest+j<outputLength;j++) {
      const w=window[j],src=Math.min(pitched.length-1,sourceStart+j);
      output[dest+j]+=pitched[src]*w;
      weights[dest+j]+=w;
    }
    first=false;
  }
  for(let i=0;i<outputLength;i++) output[i]=weights[i]>1e-5?output[i]/weights[i]:0;
  return output;
}

/* Preview-only crossfade makes a bed that can wait through stops and resume
 * without exhausting a one-shot take. The authored sample is never changed. */
export function rollingReviewLoop(samples,sampleRate,{crossfadeMs=80}={}) {
  if(!(samples instanceof Float32Array) || !Number.isInteger(sampleRate) || sampleRate<8000)
    throw new Error('Rolling loop expects mono PCM and a valid sample rate');
  const overlap=Math.max(8,Math.min(Math.floor(samples.length/4),Math.round(sampleRate*crossfadeMs/1000)));
  if(samples.length<overlap*3 || overlap<8)return samples;
  const n=samples.length, output=new Float32Array(n-overlap);
  output.set(samples.subarray(overlap,n-overlap),overlap);
  for(let i=0;i<overlap;i++){
    const t=(i+.5)/overlap;
    output[i]=samples[n-overlap+i]*(1-t)+samples[i]*t;
  }
  return output;
}

/* Publication uses the existing frozen-sample Sound Score lane. This is a
 * fixed, reproducible sound take, not a claim of native runtime speed following. */
export function rollingPublishedScore({ sourceId, firstFrame, frameCount=96, actor='sm00-boulder' }={}) {
  if(!sourceId || !Number.isInteger(firstFrame) || !Number.isInteger(frameCount) || frameCount<1 || frameCount>480)
    throw new Error('Publication requires a source and a valid captured rolling interval');
  const endFrame=firstFrame+frameCount-1;
  return {
    schema:'soundlab.sound-score.v1',sceneIntentId:`sm00-rolling-review:${sourceId}`,
    sequence:{actor,startFrame:firstFrame,endFrame},
    segments:[{id:'rolling',label:'Reviewed rolling take',semanticType:'rolling',sourceSegment:'roll',gameRange:[firstFrame,endFrame],authoringRange:[firstFrame,endFrame],proofFrames:[firstFrame],
      layers:[{id:'reviewed-rolling-take',label:'Auditioned stone rolling',source:{type:'frozen-sample',id:sourceId,preserve:true},enabled:true,solo:false,gain:1,envelope:{attackMs:0,releaseMs:0},variation:{amount:0,rateHz:4,seedOffset:0},gestures:[],mappings:[]}],gestures:[]}]
  };
}

export function encodeRollingPcm16(samples,sampleRate){
  if(!(samples instanceof Float32Array)||!Number.isInteger(sampleRate)||sampleRate<8000||sampleRate>192000)throw new Error('PCM16 export expects valid mono samples');
  const buffer=new ArrayBuffer(44+samples.length*2),view=new DataView(buffer);
  const ascii=(at,value)=>{for(let i=0;i<value.length;i++)view.setUint8(at+i,value.charCodeAt(i));};
  ascii(0,'RIFF');view.setUint32(4,36+samples.length*2,true);ascii(8,'WAVE');ascii(12,'fmt ');
  view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
  view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);
  ascii(36,'data');view.setUint32(40,samples.length*2,true);
  for(let i=0;i<samples.length;i++){const v=Math.max(-1,Math.min(1,Number(samples[i])||0));view.setInt16(44+i*2,Math.round(v*(v<0?32768:32767)),true);}
  return new Uint8Array(buffer);
}
