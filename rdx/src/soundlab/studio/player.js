/* Web Audio output for the workbench. Single buffers (a design, a take, the
 * reference) and scenes (a stretch of the recording as separate voices):
 * each scene voice is scheduled on its own source through a gain per
 * timeline lane, so mute/solo apply while playing; every playback goes
 * through one volume control. */

import { END_FADE_MS } from './context.js';

export class WebAudioPlayer {
  constructor() { this.ctx = null; this.out = null; this.current = null; this.raf = 0; this.volume = 1; }

  get playing() { return !!this.current; }

  async #context(sampleRate) {
    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate });
      this.out = this.ctx.createGain();
      this.out.gain.value = this.volume;
      this.out.connect(this.ctx.destination);
    }
    try { if (this.ctx.state !== 'running') await this.ctx.resume(); } catch { /* needs a user gesture */ }
    return this.ctx;
  }

  #buffer(left, right, sampleRate) {
    const ab = this.ctx.createBuffer(2, Math.max(1, left.length), sampleRate);
    ab.copyToChannel(left, 0); ab.copyToChannel(right || left, 1);
    return ab;
  }

  /* Progress callbacks and the end of a playback, from the audio clock. */
  #run(current, t0, durationMs, onProgress) {
    const ctx = this.ctx;
    const clock = ctx.createConstantSource(), mute = ctx.createGain();
    mute.gain.value = 0; clock.connect(mute); mute.connect(ctx.destination);
    clock.start(t0); clock.stop(t0 + durationMs / 1000);
    current.clock = clock;
    const ended = new Promise(resolve => { clock.onended = () => { if (this.current === current) this.#teardown(); resolve(); }; });
    if (onProgress) {
      const tick = () => {
        if (this.current !== current) return;
        const ms = (ctx.currentTime - t0) * 1000;
        if (ms >= 0) onProgress(Math.min(ms, durationMs));
        if (ms < durationMs) this.raf = requestAnimationFrame(tick);
      };
      tick();
    }
    return ended;
  }

  async play(buf, { onProgress = null } = {}) {
    this.stop();
    const ctx = await this.#context(buf.sampleRate);
    const node = ctx.createBufferSource();
    node.buffer = this.#buffer(buf.left, buf.right, buf.sampleRate);
    const gain = ctx.createGain(); node.connect(gain); gain.connect(this.out);
    const t0 = ctx.currentTime + 0.02;
    node.start(t0);
    const current = { sources: [node], nodes: [gain], lanes: new Map() };
    this.current = current;
    const durationMs = buf.left.length / buf.sampleRate * 1000;
    const ended = this.#run(current, t0, durationMs, onProgress);
    return { audible: ctx.state === 'running', durationMs, ended };
  }

  /* scene: { sampleRate, durationMs, voices: [{ lane, atMs, left, right, gain }] } */
  async playScene(scene, { gains = {}, onProgress = null } = {}) {
    this.stop();
    const ctx = await this.#context(scene.sampleRate);
    const master = ctx.createGain(); master.connect(this.out);
    const lanes = new Map(), sources = [];
    const t0 = ctx.currentTime + 0.05, end = t0 + scene.durationMs / 1000, fade = END_FADE_MS / 1000;
    for (const v of scene.voices) {
      if (!lanes.has(v.lane)) { const g = ctx.createGain(); g.gain.value = gains[v.lane] ?? 1; g.connect(master); lanes.set(v.lane, g); }
      const src = ctx.createBufferSource();
      src.buffer = this.#buffer(v.left, v.right, scene.sampleRate);
      let target = lanes.get(v.lane);
      if (v.gain !== 1) { const g = ctx.createGain(); g.gain.value = v.gain; g.connect(target); target = g; }
      src.connect(target);
      if (v.atMs >= 0) src.start(t0 + v.atMs / 1000); else src.start(t0, -v.atMs / 1000);
      src.stop(end + fade);
      sources.push(src);
    }
    /* the range ends where it ends: a short fade, no tails */
    master.gain.setValueAtTime(1, end);
    master.gain.linearRampToValueAtTime(0, end + fade);
    const current = { sources, nodes: [master], lanes };
    this.current = current;
    const ended = this.#run(current, t0, scene.durationMs + END_FADE_MS, onProgress);
    return { audible: ctx.state === 'running', durationMs: scene.durationMs, ended };
  }

  setLaneGains(gains) {
    if (!this.current || !this.ctx) return;
    for (const [lane, node] of this.current.lanes) node.gain.setTargetAtTime(gains[lane] ?? 1, this.ctx.currentTime, 0.012);
  }

  setVolume(v) {
    this.volume = v;
    if (this.out) this.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.015);
  }

  #teardown() {
    const c = this.current;
    this.current = null;
    cancelAnimationFrame(this.raf);
    if (!c) return;
    for (const s of c.sources) { try { s.stop(); } catch { /* not started or already stopped */ } try { s.disconnect(); } catch { /* gone */ } }
    for (const n of [...c.nodes, ...c.lanes.values()]) { try { n.disconnect(); } catch { /* gone */ } }
    return c;
  }

  stop() {
    const c = this.#teardown();
    if (c?.clock) { try { c.clock.stop(); } catch { /* already stopped */ } }
  }
}
