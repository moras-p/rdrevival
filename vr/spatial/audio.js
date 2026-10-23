/** Additional room-transmitted acoustic cues. The native SDL TV mix is untouched.
 * The AudioContext is created in the Enter VR click (entry.js) and passed in, so room
 * audio runs from the first frame in the headset; without one, unlock() makes it on a
 * later gesture. Cues are the SoundLab runtime recordings, HRTF-panned from where the
 * event happened, with a synthetic fallback while they load (or if they cannot).
 * Everything reaches the listener through the building: the profile's low-pass for the
 * ceiling or wall in between, a low-shelf boost for the structure-borne rumble of heavy
 * hits, and a short generated room reverb. A rolling boulder is a looping voice whose
 * panner follows it (startLoop / updateLoop / stopLoop). */
const SAMPLES = Object.freeze({
  footstep: 'rick_step', impact: 'boulder_impact', death: 'enemy_hit', explosion: 'dynamite_explosion',
  roll: 'boulder_roll'
});
const VARIANTS = 4;
const SAMPLE_BASE = new URL('../../rdx/data/soundlab/runtime/', import.meta.url);
const STRENGTH = Object.freeze({impact: 1, explosion: 1, death: 0.48, footstep: 0.2});
const HEAVY = new Set(['impact', 'explosion', 'roll']);
const ROLL_LEVEL = 0.7;
const REVERB_SEND = 0.22;
const KNOCK_LEVEL = 0.55;
const MAX_KNOCKS = 6;
const IN_ROOM = Object.freeze({lowpassHz: 16000});
/** Struck-object timbres for the room's own props: [duration s, decay /s, partials Hz, noise share]. */
const KNOCKS = Object.freeze({
  paper: [0.08, 60, [120, 310], 0.7], wood: [0.13, 42, [380, 820, 1650], 0.45],
  ceramic: [0.4, 13, [1850, 2730, 4100], 0.15], plastic: [0.09, 55, [1100, 1720], 0.35],
  metal: [0.55, 7, [900, 2350, 3900], 0.1]
});

async function fetchSample(context, url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return context.decodeAudioData(await response.arrayBuffer());
}

export class SpatialRoomAudio {
  constructor({ Context = globalThis.AudioContext || globalThis.webkitAudioContext, context = null,
    maxVoices = 8, now = () => globalThis.performance?.now?.() ?? 0, loadSample = fetchSample } = {}) {
    this.Context = Context; this.context = context; this.voices = new Set();
    this.buffers = new Map(); this.samples = new Map(); this.loadSample = loadSample;
    this.maxVoices = maxVoices; this.now=now;
    this.level = 0.5; this.enabled = true; this.lastFootstep = -Infinity;
    this.listenerPosition = null; this.listenerForward = null; this.loading = null;
    this.loops = new Map(); this.reverb = null; this.knocks = 0; this.knockBuffers = new Map();
  }
  async unlock() {
    if (!this.Context && !this.context) return false;
    try {
      if (!this.context) this.context = new this.Context();
      await this.context.resume();
      this.loading ??= this.#loadSamples();
      return this.context.state === 'running';
    } catch { return false; }
  }
  /** Fetch every recorded variant once; a cue plays the synthetic fallback until its kind is ready. */
  #loadSamples() {
    return Promise.all(Object.entries(SAMPLES).map(async ([kind, stem]) => {
      const loaded = await Promise.allSettled(Array.from({length: VARIANTS}, (_, i) =>
        this.loadSample(this.context, new URL(`${stem}_${i}.wav`, SAMPLE_BASE).href)));
      const buffers = loaded.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
      if (buffers.length) this.samples.set(kind, buffers);
    }));
  }
  setLevel(level) { this.level = Math.max(0, Math.min(1, Number(level)||0)); }
  setMuted(muted) { this.enabled = !muted; if (muted) this.clear(); }
  /** World pose already includes XR room anchor; do not rotate emitters with head. */
  setListener(position, forward, up = {x:0,y:1,z:0}) {
    const listener = this.context?.listener;
    if (!listener) return;
    if (listener.positionX && listener.forwardX) {
      listener.positionX.value=position.x;listener.positionY.value=position.y;listener.positionZ.value=position.z;
      listener.forwardX.value=forward.x;listener.forwardY.value=forward.y;listener.forwardZ.value=forward.z;
      listener.upX.value=up.x;listener.upY.value=up.y;listener.upZ.value=up.z;
    } else {
      listener.setPosition?.(position.x,position.y,position.z);
      listener.setOrientation?.(forward.x,forward.y,forward.z,up.x,up.y,up.z);
    }
  }
  #buffer(kind) {
    const recorded = this.samples.get(kind);
    if (recorded) return recorded[Math.floor(Math.random() * recorded.length)];
    if (this.buffers.has(kind)) return this.buffers.get(kind);
    const ctx=this.context, heavy=kind==='impact'||kind==='explosion';
    const roll=kind==='roll'; // a steady rumble that loops cleanly: 50 whole cycles a second
    const duration=roll ? 1 : heavy ? 0.55 : kind==='death' ? 0.3 : 0.11;
    const buffer=ctx.createBuffer(1,Math.ceil(ctx.sampleRate*duration),ctx.sampleRate);
    const samples=buffer.getChannelData(0);
    // Stable, intentionally non-SDL-generated timbres, no per-frame synthesis.
    let noise=0x1234abce;
    for (let i=0;i<samples.length;i++) {
      noise=(Math.imul(noise,1664525)+1013904223)>>>0;
      const t=i/ctx.sampleRate, envelope=roll ? 0.6 : Math.exp(-t*(heavy?9:kind==='death'?14:32));
      const n=(noise/0xffffffff*2-1);
      const frequency=roll?50:heavy?65:kind==='death'?130+180*t:155;
      samples[i]=envelope*(0.63*Math.sin(2*Math.PI*frequency*t)+0.37*n);
    }
    this.buffers.set(kind,buffer);
    return buffer;
  }
  /** A short, dark room response, generated once: no impulse file to fetch. */
  #reverb() {
    if (this.reverb) return this.reverb;
    const ctx=this.context, length=Math.ceil(ctx.sampleRate*0.9);
    const impulse=ctx.createBuffer(2,length,ctx.sampleRate);
    for (let c=0;c<2;c++) {
      const data=impulse.getChannelData(c);let noise=0x9e3779b9+c, low=0;
      for (let i=0;i<length;i++) {
        noise=(Math.imul(noise,1664525)+1013904223)>>>0;
        low+=0.35*((noise/0xffffffff*2-1)-low); // furnished room: highs die first
        data[i]=low*Math.exp(-i/ctx.sampleRate*6.5);
      }
    }
    const convolver=ctx.createConvolver(), send=ctx.createGain();
    convolver.buffer=impulse;send.gain.value=REVERB_SEND;
    send.connect(convolver);convolver.connect(ctx.destination);
    return this.reverb={convolver,send};
  }
  /** source → through-structure filters → panner → gain → speakers and room reverb. */
  #chain(kind,point,calibration) {
    const ctx=this.context;
    const filter=ctx.createBiquadFilter(), rumble=ctx.createBiquadFilter();
    const panner=ctx.createPanner(), gain=ctx.createGain();
    filter.type='lowpass';filter.frequency.value=calibration.lowpassHz;
    rumble.type='lowshelf';rumble.frequency.value=120;rumble.gain.value=HEAVY.has(kind) ? 7 : 0;
    panner.panningModel='HRTF';panner.distanceModel='inverse';
    panner.refDistance=1;panner.maxDistance=15;panner.rolloffFactor=0.7;
    panner.positionX.value=point.x;panner.positionY.value=point.y;panner.positionZ.value=point.z;
    filter.connect(rumble);rumble.connect(panner);panner.connect(gain);gain.connect(ctx.destination);
    gain.connect(this.#reverb().send);
    const nodes=[filter,rumble,panner,gain];
    return {input:filter,panner,gain,disconnect:()=>{for (const node of nodes) node.disconnect();}};
  }
  play(kind,point,calibration) {
    if (!this.enabled || !this.level || !this.context || this.context.state!=='running' ||
        !calibration || !point || !(kind in STRENGTH)) return false;
    if (kind==='footstep' && this.now()-this.lastFootstep < 90) return false;
    if (this.voices.size >= this.maxVoices) return false;
    if (kind==='footstep') this.lastFootstep=this.now();
    const ctx=this.context, start=ctx.currentTime;
    const source=ctx.createBufferSource(), chain=this.#chain(kind,point,calibration), {gain}=chain;
    source.buffer=this.#buffer(kind);
    gain.gain.setValueAtTime(0,start);
    gain.gain.linearRampToValueAtTime(this.level*calibration.gain*STRENGTH[kind],start+0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001,start+source.buffer.duration);
    source.connect(chain.input);
    const voice={source,chain};this.voices.add(voice);
    source.onended=()=>{this.voices.delete(voice);source.disconnect();chain.disconnect();};
    source.start(start);source.stop(start+source.buffer.duration);
    return true;
  }
  /** A prop in the room landing, bouncing or slamming: struck-object sound, by material,
   * from where it happened (world metres), louder the faster it was stopped (m/s). */
  knock(material,point,speed) {
    if (!this.enabled || !this.level || !this.context || this.context.state!=='running' ||
        !point || this.knocks >= MAX_KNOCKS) return false;
    const ctx=this.context, start=ctx.currentTime;
    const source=ctx.createBufferSource(), chain=this.#chain('knock',point,IN_ROOM), {gain}=chain;
    source.buffer=this.#knockBuffer(material);
    source.playbackRate.value=0.88+0.24*Math.random();
    gain.gain.setValueAtTime(this.level*KNOCK_LEVEL*Math.min(1,speed/3)**1.4,start);
    source.connect(chain.input);this.knocks++;
    source.onended=()=>{this.knocks--;source.disconnect();chain.disconnect();};
    source.start(start);
    return true;
  }
  #knockBuffer(material) {
    const key=KNOCKS[material] ? material : 'wood';
    if (this.knockBuffers.has(key)) return this.knockBuffers.get(key);
    const [duration,decay,partials,noiseShare]=KNOCKS[key], ctx=this.context;
    const buffer=ctx.createBuffer(1,Math.ceil(ctx.sampleRate*duration),ctx.sampleRate);
    const data=buffer.getChannelData(0);let noise=0x51f15e, low=0;
    for (let i=0;i<data.length;i++) {
      noise=(Math.imul(noise,1664525)+1013904223)>>>0;
      const t=i/ctx.sampleRate;
      low+=0.3*((noise/0xffffffff*2-1)-low);
      let tone=0;
      partials.forEach((f,k)=>{tone+=Math.sin(2*Math.PI*f*t)*Math.exp(-t*decay*(1+0.6*k))/(k+1);});
      data[i]=(noiseShare*low*Math.exp(-t*decay*2.5)+(1-noiseShare)*tone)*Math.min(1,t*4000);
    }
    this.knockBuffers.set(key,buffer);
    return buffer;
  }
  /** A rolling boulder: one looping voice per actor that follows it until stopLoop. */
  startLoop(id,kind,point,calibration) {
    if (!this.enabled || !this.level || !this.context || this.context.state!=='running' ||
        !calibration || !point || this.loops.has(id)) return false;
    const ctx=this.context, start=ctx.currentTime;
    const source=ctx.createBufferSource(), chain=this.#chain(kind,point,calibration);
    source.buffer=this.#buffer(kind);source.loop=true;
    chain.gain.gain.setValueAtTime(0,start);
    source.connect(chain.input);
    source.start(start,Math.random()*source.buffer.duration);
    this.loops.set(id,{source,chain,level:this.level*calibration.gain*ROLL_LEVEL});
    return true;
  }
  updateLoop(id,point,intensity=1) {
    const loop=this.loops.get(id);
    if (!loop) return false;
    const t=this.context.currentTime, {panner,gain}=loop.chain;
    // Smoothed toward the extrapolated position: no zipper noise between frames.
    panner.positionX.setTargetAtTime(point.x,t,0.03);
    panner.positionY.setTargetAtTime(point.y,t,0.03);
    panner.positionZ.setTargetAtTime(point.z,t,0.03);
    gain.gain.setTargetAtTime(loop.level*(0.35+0.65*intensity),t,0.06);
    loop.source.playbackRate.setTargetAtTime(0.8+0.35*intensity,t,0.1);
    return true;
  }
  stopLoop(id) {
    const loop=this.loops.get(id);
    if (!loop) return false;
    this.loops.delete(id);
    const t=this.context.currentTime;
    loop.chain.gain.gain.setTargetAtTime(0,t,0.08);
    loop.source.onended=()=>{loop.source.disconnect();loop.chain.disconnect();};
    loop.source.stop(t+0.5);
    return true;
  }
  clear() {
    for (const voice of [...this.voices,...this.loops.values()]) {
      voice.source.onended=null;try {voice.source.stop();} catch {}
      voice.source.disconnect();voice.chain.disconnect();
    }
    this.voices.clear();this.loops.clear();this.lastFootstep=-Infinity;
  }
  async dispose() {this.clear();await this.context?.close();this.context=null;this.buffers.clear();this.samples.clear();this.loading=null;this.reverb=null;this.knockBuffers.clear();}
}
