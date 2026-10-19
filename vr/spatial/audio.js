/** Additional room-transmitted acoustic cues. The native SDL TV mix is untouched.
 * Construct this only on room entry; AudioContext starts on a user gesture. */
export class SpatialRoomAudio {
  constructor({ Context = globalThis.AudioContext || globalThis.webkitAudioContext,
    maxVoices = 8, now = () => globalThis.performance?.now?.() ?? 0 } = {}) {
    this.Context = Context; this.context = null; this.voices = new Set();
    this.buffers = new Map(); this.maxVoices = maxVoices; this.now=now;
    this.level = 0.5; this.enabled = true; this.lastFootstep = -Infinity;
    this.listenerPosition = null; this.listenerForward = null;
  }
  async unlock() {
    if (!this.Context) return false;
    try {
      if (!this.context) this.context = new this.Context();
      await this.context.resume();
      return this.context.state === 'running';
    } catch { return false; }
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
    if (this.buffers.has(kind)) return this.buffers.get(kind);
    const ctx=this.context, duration=kind==='impact' ? 0.55 : kind==='death' ? 0.3 : 0.11;
    const buffer=ctx.createBuffer(1,Math.ceil(ctx.sampleRate*duration),ctx.sampleRate);
    const samples=buffer.getChannelData(0);
    // Stable, intentionally non-SDL-generated timbres, no per-frame synthesis.
    let noise=0x1234abce;
    for (let i=0;i<samples.length;i++) {
      noise=(Math.imul(noise,1664525)+1013904223)>>>0;
      const t=i/ctx.sampleRate, envelope=Math.exp(-t*(kind==='impact'?9:kind==='death'?14:32));
      const n=(noise/0xffffffff*2-1);
      const frequency=kind==='impact'?65:kind==='death'?130+180*t:155;
      samples[i]=envelope*(0.63*Math.sin(2*Math.PI*frequency*t)+0.37*n);
    }
    this.buffers.set(kind,buffer);
    return buffer;
  }
  play(kind,point,calibration) {
    if (!this.enabled || !this.level || !this.context || this.context.state!=='running' ||
        !calibration || !point || !['footstep','impact','death'].includes(kind)) return false;
    if (kind==='footstep' && this.now()-this.lastFootstep < 90) return false;
    if (this.voices.size >= this.maxVoices) return false;
    if (kind==='footstep') this.lastFootstep=this.now();
    const ctx=this.context, start=ctx.currentTime;
    const source=ctx.createBufferSource(), filter=ctx.createBiquadFilter();
    const panner=ctx.createPanner(),gain=ctx.createGain();
    source.buffer=this.#buffer(kind);
    filter.type='lowpass'; filter.frequency.value=calibration.lowpassHz;
    panner.panningModel='HRTF';panner.distanceModel='inverse';
    panner.refDistance=1;panner.maxDistance=15;panner.rolloffFactor=0.7;
    panner.positionX.value=point.x;panner.positionY.value=point.y;panner.positionZ.value=point.z;
    const strength=kind==='impact'?1:kind==='death'?0.48:0.20;
    gain.gain.setValueAtTime(0,start);
    gain.gain.linearRampToValueAtTime(this.level*calibration.gain*strength,start+0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001,start+source.buffer.duration);
    source.connect(filter);filter.connect(panner);panner.connect(gain);gain.connect(ctx.destination);
    const voice={source,filter,panner,gain};this.voices.add(voice);
    source.onended=()=>{this.voices.delete(voice);source.disconnect();filter.disconnect();panner.disconnect();gain.disconnect();};
    source.start(start);source.stop(start+source.buffer.duration);
    return true;
  }
  clear() {
    for (const voice of this.voices) { voice.source.onended=null;try {voice.source.stop();} catch {}
      voice.source.disconnect();voice.filter.disconnect();voice.panner.disconnect();voice.gain.disconnect(); }
    this.voices.clear();this.lastFootstep=-Infinity;
  }
  async dispose() {this.clear();await this.context?.close();this.context=null;this.buffers.clear();}
}
