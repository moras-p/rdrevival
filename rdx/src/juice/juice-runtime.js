import { PERFORMANCE_PRESETS, scaledValue } from './juice-protocol.js';
import { PRESENTATION_LAYER_BITS, PRESENTATION_LAYER_MASK_PRESETS, presentationLayerMaskBits } from './presentation-layer-mask.js';

const TAU = Math.PI * 2;
const OPAQUE_EPSILON = 0.999;
const FULL_EFFECT_MASK = new Uint8Array(320 * 200);
FULL_EFFECT_MASK.fill(1, 8 * 320);
const PRESENTATION_BACK_BITS=PRESENTATION_LAYER_BITS.backdrop|PRESENTATION_LAYER_BITS.midground|PRESENTATION_LAYER_BITS.actors;
const PRESENTATION_FRONT_BITS=PRESENTATION_LAYER_BITS.foreground|PRESENTATION_LAYER_BITS.frontActors;
function binaryMaskForPresentationLayers(presentationLayers, selectedBits, fallback=null){
  if(!(presentationLayers instanceof Uint8Array))return fallback;const out=new Uint8Array(presentationLayers.length);for(let i=0;i<presentationLayers.length;i++)if(presentationLayers[i]&selectedBits)out[i]=1;return out;
}

export function restoreAboveActorDepth(ctx, sourceCanvas, presentationLayers, width = Number(sourceCanvas?.width) || 320, height = Number(sourceCanvas?.height) || 200) {
  if (!ctx || !sourceCanvas || !(presentationLayers instanceof Uint8Array) || typeof ctx.beginPath !== 'function' || typeof ctx.clip !== 'function') return;
  const w=Math.max(1,Math.floor(Number(width)||320)),h=Math.max(1,Math.floor(Number(height)||200));
  const occluders=PRESENTATION_LAYER_BITS.foreground|PRESENTATION_LAYER_BITS.frontActors;
  ctx.save();ctx.beginPath();
  let any=false;
  for(let y=0;y<h;y++){
    let run=-1;
    for(let x=0;x<=w;x++){
      const covered=x<w && !!((presentationLayers[y*w+x]||0)&occluders);
      if(covered&&run<0)run=x;
      else if(!covered&&run>=0){ctx.rect(run,y,x-run,1);run=-1;any=true;}
    }
  }
  if(any){ctx.clip();ctx.drawImage(sourceCanvas,0,0);}
  ctx.restore();
}

export const JUICE_SIM_FRAME_SECONDS = 1 / 25;

function authoredOpacity(value, magnitude = 1) {
  const opacity = Math.max(0, Math.min(1, Number(value) || 0));
  return opacity >= OPAQUE_EPSILON ? 1 : opacity * Math.max(0, Math.min(1, Number(magnitude) || 0));
}

function lifetimeOpacity(opacity, life = 1) {
  return opacity >= OPAQUE_EPSILON ? 1 : opacity * Math.max(0, Math.min(1, Number(life) || 0));
}

const GAME_SFX = Object.freeze(['walk.wav','jump.wav','stick.wav','bullet.wav','box.wav','ent0.wav','bombshht.wav','explode.wav','bonus.wav','die.wav','stick_hit.wav','crawl.wav','pad.wav']);


export function poseEmitterReferenceDirection(binding, liveDirection = 1) {
  const value = Number(binding?.referenceDirection ?? 0);
  if (value < 0) return -1;
  if (value > 0) return 1;
  return Number(liveDirection) < 0 ? -1 : 1;
}

export function poseEmitterParticleDirection(binding, liveDirection = 1) {
  let direction = Number(liveDirection) < 0 ? -1 : 1;
  if (binding?.emitter?.flipH) direction *= -1;
  return direction;
}

export function poseEmitterCadenceSeconds(bindingOrEmitter) {
  const emitter = bindingOrEmitter?.emitter || bindingOrEmitter || {};
  return Math.max(1, Math.round(Number(emitter.cadenceFrames) || 3)) * JUICE_SIM_FRAME_SECONDS;
}

export function poseEmitterParticleSample(emitter, direction = 1, random = Math.random) {
  const source = emitter || {};
  const spread = Math.max(0, Math.min(2, Number(source.spread) || 0));
  const baseSpeed = Math.max(0, Math.min(160, Number(source.speed) || 0));
  const angle = (random() - 0.5) * Math.PI * spread + (Number(direction) < 0 ? Math.PI : 0);
  const speed = baseSpeed * (0.55 + random() * 0.75);
  let vy = Math.sin(angle) * speed - speed * 0.2;
  if (source.flipV) vy *= -1;
  return {
    vx: Math.cos(angle) * speed,
    vy,
    lifeMs: Math.max(10, Math.min(2000, Number(source.lifeMs) || 260)) * (0.8 + random() * 0.4),
    gravity: Number(source.gravity) || 0,
    size: Math.max(1, Math.min(4, Math.round(Number(source.size) || 1))),
    tone: source.tone || 'smoke'
  };
}

export function particleEmitterDimensions(source = {}) {
  return {
    width: Math.max(1, Math.min(32, Math.round(Number(source.emitterWidth) || 1))),
    height: Math.max(1, Math.min(21, Math.round(Number(source.emitterHeight) || 1)))
  };
}

export function particleEmitterSpawnOffset(source = {}, random = Math.random) {
  const { width, height } = particleEmitterDimensions(source);
  return {
    x: (random() - 0.5) * Math.max(0, width - 1),
    y: (random() - 0.5) * Math.max(0, height - 1)
  };
}

/* Legacy v2.1.84 normalized anchors with (localX/31) and (localY/20), then used Number(bounds.right)-Number(bounds.left); v2.1.87 instead normalizes inside the visible reference-pose content rect so preview and live actor bounds agree. */
export function poseEmitterAnchorPoint(binding, bounds, liveDirection = 1) {
  if (!binding?.emitter || !bounds) return null;
  const emitter = binding.emitter;
  const localX = Math.max(0, Math.min(31, Number(emitter.anchorX ?? 25)));
  const localY = Math.max(0, Math.min(20, Number(emitter.anchorY ?? 9)));
  const refX = Math.max(0, Math.min(31, Number(emitter.refX ?? 0)));
  const refY = Math.max(0, Math.min(20, Number(emitter.refY ?? 0)));
  const refW = Math.max(1, Math.min(32 - refX, Number(emitter.refW ?? 32)));
  const refH = Math.max(1, Math.min(21 - refY, Number(emitter.refH ?? 21)));
  const nx0 = refW > 1 ? Math.max(0, Math.min(1, (localX - refX) / (refW - 1))) : 0.5;
  const ny = refH > 1 ? Math.max(0, Math.min(1, (localY - refY) / (refH - 1))) : 0.5;
  const live = Number(liveDirection) < 0 ? -1 : 1;
  const reference = poseEmitterReferenceDirection(binding, live);
  const shouldMirror = emitter.mirrorX !== false && reference !== live;
  const nx = shouldMirror ? 1 - nx0 : nx0;
  const left = Number(bounds.left), top = Number(bounds.top);
  const width = Math.max(1, Number(bounds.right) - left);
  const height = Math.max(1, Number(bounds.bottom) - top);
  return {
    x: left + nx * Math.max(0, width - 1),
    y: top + ny * Math.max(0, height - 1),
    normalizedX: nx,
    normalizedY: ny,
    mirrored: shouldMirror
  };
}

export function entityAudioCategory(entityType) {
  const n = Number(entityType) & 0x7f;
  if (n === 0x10 || n === 0x11 || n === 0x2e) return 'breakable-block';
  if (n >= 0x12 && n <= 0x17) return 'collectible';
  if ([0x19,0x1a,0x39].includes(n)) return 'projectile-shooter';
  if ([0x18,0x1c,0x2c,0x42].includes(n)) return 'moving-platform';
  if ([0x1b,0x1f,0x21,0x25,0x27,0x30,0x31].includes(n)) return 'trap-mechanism';
  if ([0x1d,0x1e].includes(n)) return 'projectile';
  return 'other-mechanism';
}

class ParticlePool {
  constructor(capacity) {
    this.capacity = capacity;
    this.items = Array.from({ length: capacity }, () => ({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 0, gravity: 0, size: 1, shape: 'block', shrink: false, tone: 'dust' }));
    this.active = 0; this.dropped = 0; this.cursor = 0;
  }
  resize(capacity) {
    if (capacity === this.capacity) return;
    this.capacity = capacity;
    this.items = Array.from({ length: capacity }, () => ({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 0, gravity: 0, size: 1, shape: 'block', shrink: false, tone: 'dust' }));
    this.active = 0; this.dropped = 0; this.cursor = 0;
  }
  allocate() {
    for (let i = 0; i < this.capacity; i += 1) {
      const index = (this.cursor + i) % this.capacity;
      if (!this.items[index].active) { this.cursor = (index + 1) % this.capacity; return this.items[index]; }
    }
    this.dropped += 1; return null;
  }
  spawnOne(x, y, vx, vy, lifeMs, gravity, size, tone = 'dust', shrink = false, shape = 'block') {
    const found = this.allocate(); if (!found) return false;
    found.active = true; found.x = x; found.y = y; found.vx = vx; found.vy = vy;
    found.life = found.maxLife = Math.max(.01, lifeMs / 1000); found.gravity = gravity; found.size = size; found.shape = shape === 'puff' ? 'puff' : 'block'; found.shrink = !!shrink; found.tone = tone;
    this.active += 1; return true;
  }
  spawn(x, y, count, options, direction, quality, spatialScale = 1) {
    const spawnStencil = [[-1,-.375],[-.375,-1],[.625,-.75],[1,.125],[.5,1],[-.5,1],[-1,.5],[0,0]];
    let wanted = Math.max(0, Math.round(count * quality)), emitted = 0;
    while (wanted-- > 0) {
      const angle = (Math.random() - 0.5) * Math.PI * options.spread + (direction < 0 ? Math.PI : 0);
      const scale = Math.max(.25, Math.min(8, Number(spatialScale) || 1));
      const speed = options.speed * scale * (0.55 + Math.random() * 0.75);
      const vx = Math.cos(angle) * speed;
      let vy = Math.sin(angle) * speed - speed * 0.2;
      if (options.flipV) vy *= -1;
      const radius = Math.max(0, Number(options.spawnRadius || 0)) * scale;
      const stencil = spawnStencil[emitted++ % spawnStencil.length];
      const emitterOffset = particleEmitterSpawnOffset(options);
      const sx = x + emitterOffset.x * scale + stencil[0] * radius * (direction < 0 ? -1 : 1);
      const sy = y + emitterOffset.y * scale + stencil[1] * radius;
      this.spawnOne(sx, sy, vx, vy,
        (options.shrink ? options.lifeMs : options.lifeMs * (0.8 + Math.random() * 0.4)), options.gravity * scale, options.size * scale, options.tone || 'dust', options.shrink, options.shape);
    }
  }
  spawnForegroundDust(mask, width, height, burst, quality) {
    if (!mask || !burst) return;
    const block = Math.max(4, Math.round(burst.blockSize || 8));
    const radius = Math.max(block, Number(burst.radius || 48));
    const radius2 = radius * radius, density = Math.max(0, Math.min(1, Number(burst.density || 0))) * quality;
    const x0 = Math.max(0, Math.floor((burst.x - radius) / block) * block);
    const y0 = Math.max(0, Math.floor((burst.y - radius) / block) * block);
    const x1 = Math.min(width - 1, Math.ceil((burst.x + radius) / block) * block);
    const y1 = Math.min(height - 1, Math.ceil((burst.y + radius) / block) * block);
    const serial = Number(burst.serial || 0) >>> 0;
    for (let y = y0; y <= y1; y += block) for (let x = x0; x <= x1; x += block) {
      const cx = Math.min(width - 1, x + Math.floor(block / 2)), cy = Math.min(height - 1, y + Math.floor(block / 2));
      const dx = cx - burst.x, dy = cy - burst.y, d2 = dx * dx + dy * dy;
      if (d2 > radius2 || !mask[cy * width + cx]) continue;
      /* Stable per-block selection avoids frame-dependent/random bursts and is
       * cheap enough to map to a bounded BOB list on Amiga/CD32. */
      let h = ((x * 73856093) ^ (y * 19349663) ^ (serial * 83492791)) >>> 0;
      h ^= h >>> 13; h = Math.imul(h, 1274126177) >>> 0;
      if ((h & 0xffff) / 65535 > density) continue;
      const dist = Math.max(1, Math.sqrt(d2)), speed = Number(burst.speed || 54) * (0.65 + ((h >>> 16) & 255) / 512);
      const vx = dx / dist * speed, vy = dy / dist * speed - speed * 0.12;
      this.spawnOne(cx, cy, vx, vy, burst.lifeMs, burst.gravity, burst.size, burst.tone || 'dust');
    }
  }
  update(dt) {
    for (const p of this.items) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) { p.active = false; this.active -= 1; continue; }
      p.vy += p.gravity * dt; p.x += p.vx * dt; p.y += p.vy * dt;
    }
  }
  render(ctx) {
    ctx.save();
    for (const p of this.items) {
      if (!p.active) continue;
      /* Production-candidate particles are hard-lived opaque pixels/BOBs.
       * Shrinking uses three integer size stages, equivalent to swapping among
       * a tiny authored BOB frame set rather than filtering/scaling a sprite. */
      ctx.globalAlpha = 1;
      ctx.fillStyle = p.tone === 'smoke' ? '#c7c7c0' : p.tone === 'spark' ? '#fff4c2' : '#f2d28b';
      const life = p.maxLife > 0 ? Math.max(0, p.life / p.maxLife) : 0;
      const size = !p.shrink ? p.size : life > 2/3 ? p.size : life > 1/3 ? Math.max(1, Math.ceil(p.size / 2)) : 1;
      if (p.shape === 'puff') {
        const left = Math.round(p.x - size / 2), top = Math.round(p.y - size / 2);
        if (size >= 4) {
          const cap = Math.max(1, Math.floor(size / 4)), inset = Math.max(1, Math.floor(size / 4));
          const middle = Math.max(1, size - cap * 2);
          ctx.fillRect(left + inset, top, Math.max(1, size - inset * 2), cap);
          ctx.fillRect(left, top + cap, size, middle);
          ctx.fillRect(left + inset, top + cap + middle, Math.max(1, size - inset * 2), cap);
        } else {
          ctx.fillRect(Math.round(p.x), Math.round(p.y), size, size);
        }
      } else {
        const inset = (p.size - size) / 2;
        ctx.fillRect(Math.round(p.x + inset), Math.round(p.y + inset), size, size);
      }
    }
    ctx.restore();
  }
}

class GameSampleAudio {
  constructor() {
    this.context = null; this.active = 0; this.maxVoices = 2; this.dropped = 0;
    this.enabled = true; this.source = 'cd32'; this.cache = new Map(); this.pending = new Map(); this.userUnlocked = false;
  }
  setMaxVoices(count) { this.maxVoices = count; }
  setEnabled(enabled) { this.enabled = !!enabled; }
  setSource(source) { this.source = ['classic','cd32','sega'].includes(source) ? source : 'classic'; }
  ensureContext() {
    const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext || globalThis.window?.AudioContext || globalThis.window?.webkitAudioContext;
    if (!AudioContext) return null;
    if (!this.context) {
      try { this.context = new AudioContext({ latencyHint: 'interactive' }); }
      catch { return null; }
    }
    return this.context;
  }
  async prepareContext() {
    const context = this.ensureContext();
    if (!context) return null;
    if (context.state === 'suspended') {
      try { await context.resume(); } catch { return null; }
    }
    if (context.state === 'running') this.userUnlocked = true;
    return context;
  }
  async unlock() {
    const context = await this.prepareContext();
    this.userUnlocked = !!context && context.state === 'running';
    return this.userUnlocked;
  }
  paths(sample) {
    /* The first path is the published browser build.  The second is the same
     * source's package-local development path so an AI/developer can serve the
     * repository root directly without first copying web assets.  Never fall
     * across Classic↔CD32 here: the source selector must remain a truthful A/B. */
    if (this.source === 'classic') return [`audio/classic/${sample}`, `../data/sounds/${sample}`];
    if (this.source === 'cd32') return [`audio/cd32/runtime/${sample}`, `../data/audio/cd32/runtime/${sample}`];
    return [`audio/${this.source}/runtime/${sample}`];
  }
  cacheKey(sample) { return `${this.source}:${String(sample || '')}`; }
  async load(sample) {
    const key = this.cacheKey(sample);
    if (this.cache.has(key)) return this.cache.get(key);
    if (this.pending.has(key)) return this.pending.get(key);
    const task = (async () => {
      const context = await this.prepareContext();
      if (!context) return null;
      for (const path of this.paths(sample)) {
        try {
          const response = await fetch(path, { cache: 'force-cache' });
          if (!response.ok) continue;
          const buffer = await context.decodeAudioData(await response.arrayBuffer());
          this.cache.set(key, buffer); return buffer;
        } catch { /* fall through to the project's classic fallback */ }
      }
      return null;
    })();
    this.pending.set(key, task);
    try { return await task; } finally { this.pending.delete(key); }
  }
  preload() { for (const sample of GAME_SFX) this.load(sample); }
  async prepare(options) {
    if (!options?.enabled || Number(options.gain || 0) <= 0 && !(options.layerSample && Number(options.layerGain || 0) > 0)) return false;
    const primary = Number(options.gain || 0) > 0 ? await this.load(String(options.sample || 'walk.wav')) : true;
    const layer = options.layerSample && Number(options.layerGain || 0) > 0 ? await this.load(String(options.layerSample)) : true;
    return !!primary && !!layer;
  }
  async audition(options, magnitude = 1, event = null) {
    /* Explicit editor audition bypasses the global monitor switch. Prefer the
     * exact WebAudio path, but fall back to HTMLAudio when AudioContext decode
     * or resume is unavailable: the audition button itself is a user gesture,
     * so a supported browser should always produce audible feedback. */
    try {
      const ok = await this.#trigger(options, magnitude, event, true);
      if (ok && options?.layerSample && Number(options.layerGain || 0) > 0) {
        const layer = { ...options, sample: options.layerSample, gain: options.layerGain,
          rate: Number(options.layerRate || 1), layerSample: '', layerGain: 0 };
        await this.#trigger(layer, magnitude, event, true);
      }
      if (ok) return true;
    }
    catch { /* HTMLAudio below is intentionally the resilient user-gesture path. */ }
    if (typeof Audio === 'undefined') return false;
    const sample = String(options.sample || 'walk.wav');
    const variance = (Math.random() * 2 - 1) * Number(options.pitchVariance || 0);
    const eventRate = Math.max(0.5, Math.min(2, Number(event?.audioRate || 1)));
    for (const path of this.paths(sample)) {
      try {
        const audio = new Audio(path);
        audio.preload = 'auto';
        audio.volume = Math.max(0, Math.min(1, Number(options.gain || 0) * (0.6 + magnitude * 0.4)));
        audio.playbackRate = Math.max(0.5, Math.min(2, Number(options.rate || 1) * eventRate * (1 + variance)));
        await audio.play();
        return true;
      } catch { /* try the next source path, if any */ }
    }
    return false;
  }
  trigger(options, magnitude, event = null) {
    /* Live gameplay events are not themselves browser user gestures. Once the
     * editor/game canvas has unlocked audio, a decoded WebAudio voice should
     * be reliable; if a browser still rejects that path, fall back to a plain
     * HTMLAudio voice instead of silently dropping the authored effect. */
    const launch = voice => {
      const task = this.#trigger(voice, magnitude, event, false);
      void task.then(ok => { if (!ok && this.enabled && this.userUnlocked) void this.#fallback(voice, magnitude, event); });
      return task;
    };
    const primary = launch(options);
    if (options?.layerSample && Number(options.layerGain || 0) > 0) {
      const layer = { ...options, sample: options.layerSample, gain: options.layerGain,
        rate: Number(options.layerRate || 1), layerSample: '', layerGain: 0 };
      launch(layer);
    }
    return primary;
  }
  async #fallback(options, magnitude, event = null) {
    if (typeof Audio === 'undefined' || !this.userUnlocked || !this.enabled) return false;
    const sample=String(options?.sample || 'walk.wav');
    const variance=(Math.random()*2-1)*Number(options?.pitchVariance||0);
    const eventRate=Math.max(.5,Math.min(2,Number(event?.audioRate||1)));
    for (const path of this.paths(sample)) {
      try {
        const audio=new Audio(path); audio.preload='auto';
        audio.volume=Math.max(0,Math.min(1,Number(options?.gain||0)*(0.6+Number(magnitude||0)*0.4)));
        audio.playbackRate=Math.max(.5,Math.min(2,Number(options?.rate||1)*eventRate*(1+variance)));
        await audio.play(); return true;
      } catch { /* try development/source fallback path */ }
    }
    return false;
  }
  async #trigger(options, magnitude, event = null, force = false) {
    if ((!this.enabled && !force) || this.active >= this.maxVoices) { if (this.enabled || force) this.dropped += 1; return false; }
    const context = await this.prepareContext();
    if (!context) return false;
    const sample = String(options.sample || 'walk.wav');
    const buffer = await this.load(sample);
    if (!buffer || (!this.enabled && !force)) return false;
    if (this.active >= this.maxVoices) { this.dropped += 1; return false; }
    const source = context.createBufferSource(); const gain = context.createGain();
    source.buffer = buffer;
    const variance = (Math.random() * 2 - 1) * Number(options.pitchVariance || 0);
    const eventRate = Math.max(0.5, Math.min(2, Number(event?.audioRate || 1)));
    source.playbackRate.value = Math.max(0.5, Math.min(2, Number(options.rate || 1) * eventRate * (1 + variance)));
    const targetGain = Math.max(0, Number(options.gain || 0)) * (0.6 + magnitude * 0.4);
    const now = context.currentTime, attack = Math.max(0, Number(options.attackMs || 0)) / 1000;
    const release = Math.max(0, Number(options.releaseMs || 0)) / 1000;
    gain.gain.cancelScheduledValues(now);
    if (attack > 0) { gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(targetGain, now + attack); }
    else gain.gain.setValueAtTime(targetGain, now);
    const duration = buffer.duration / Math.max(0.01, source.playbackRate.value);
    if (release > 0 && duration > release) {
      const releaseAt = now + Math.max(attack, duration - release);
      gain.gain.setValueAtTime(targetGain, releaseAt); gain.gain.linearRampToValueAtTime(0, now + duration);
    }
    const requestedPan = Math.max(-1, Math.min(1, Number(options.pan || 0) + (options.panFromEvent ? Number(event?.audioPan || 0) : 0)));
    let filter = null, panner = null, tail = gain;
    source.connect(gain);
    if (['lowpass','highpass','bandpass'].includes(options.filterType) && typeof context.createBiquadFilter === 'function') {
      filter = context.createBiquadFilter(); filter.type = options.filterType;
      filter.frequency.value = Math.max(80, Math.min(12000, Number(options.filterHz || 4200)));
      tail.connect(filter); tail = filter;
    }
    if (typeof context.createStereoPanner === 'function' && Math.abs(requestedPan) > 0.01) {
      panner = context.createStereoPanner(); panner.pan.value = requestedPan; tail.connect(panner); tail = panner;
    }
    tail.connect(context.destination);
    this.active += 1; source.start();
    source.onended = () => { this.active = Math.max(0, this.active - 1); try { source.disconnect(); gain.disconnect(); filter?.disconnect(); panner?.disconnect(); } catch {} };
    return true;
  }
}

export class JuiceRuntime {
  constructor(profile) {
    this.profile = profile;
    this.preset = PERFORMANCE_PRESETS[profile.performancePreset] || PERFORMANCE_PRESETS.potato25;
    this.particles = new ParticlePool(this.preset.maxParticles);
    this.audio = new GameSampleAudio(); this.audio.setMaxVoices(this.preset.maxVoices);
    this.flashes = [];
    this.clockSeconds = 0;
    this.camera = { x: 0, y: 0, time: 0, duration: 0, amplitude: 0, frequency: 0 };
    this.foregroundDustBursts = []; this.eventSerial = 0;
    this.impulse = { x: 0, y: 0, squash: 0, deformationMode: 'blitter-bands', bands: 4, deformationPixels: 4, degradeSprite: false, degradationPx: 1, time: 0, duration: 0, bounds: null, targetSlot: 1 };
    this.actorFlash = { color: 'white', alpha: 1, time: 0, duration: 0, targetSlot: 1 };
    this.knockback = { x: 0, y: 0, time: 0, duration: 0, targetSlot: 1 };
    this.worldFlash = { x: 0, y: 0, radius: 0, ringWidth: 16, blockSize: 8, color: 'white', backgroundColor: 'off-white', backgroundAlphaScale: 0.55, alpha: 0, time: 0, duration: 0, baseDuration: 0, layerMask: presentationLayerMaskBits(PRESENTATION_LAYER_MASK_PRESETS.allGameplay), foregroundDelay: 0, backgroundDelay: 0 };
    this.hudImpulse = { bounds: null, color: 'white', alpha: 0, jitter: 0, time: 0, duration: 0 }; this.hudImpulses = [];
    this.poseGenerators = []; this.poseGeneratorCycle = new Map();
    this.freeze = { startFrame: -1, frames: 0 }; this.enabled = true; this.audioIndependent = false; this.audioEventFilter = ''; this.quality = this.preset.defaultQuality; this.frameOverruns = 0;
    this.spatialScale = 1;
    this.stats = { events: 0, droppedParticles: 0, droppedAudio: 0, quality: this.quality };
  }
  setProfile(profile) {
    this.profile = profile;
    const next = PERFORMANCE_PRESETS[profile.performancePreset] || PERFORMANCE_PRESETS.potato25;
    if (next.id !== this.preset.id) {
      this.preset = next; this.particles.resize(next.maxParticles); this.audio.setMaxVoices(next.maxVoices); this.quality = next.defaultQuality;
    }
  }
  setEnabled(enabled) { this.enabled = !!enabled; }
  setSpatialScale(scale = 1) { this.spatialScale = Math.max(.25, Math.min(8, Number(scale) || 1)); return this.spatialScale; }
  setAudioEnabled(enabled) { this.audio.setEnabled(enabled); }
  setAudioIndependent(enabled) { this.audioIndependent = !!enabled; }
  setAudioEventFilter(actionId = '') { this.audioEventFilter = String(actionId || ''); }
  async unlockAudio() { return this.audio.unlock(); }
  audioRecipeForEvent(event) {
    if (this.audioEventFilter && String(event?.type || '') !== this.audioEventFilter) return null;
    const recipe=this.profile.actions?.[event?.type]; if(!recipe?.audio?.enabled)return null;
    const hasEntity=Number.isInteger(Number(event?.entityType));
    const entityKey=hasEntity?`entity:${Number(event.entityType)&0x7f}`:null;
    const categoryKey=hasEntity?`category:${entityAudioCategory(event.entityType)}`:null;
    const override=(categoryKey&&this.profile.entityAudio?.[categoryKey])||(entityKey&&this.profile.entityAudio?.[entityKey])||null;
    const audio=override?{...recipe.audio,...override}:recipe.audio;
    return audio.enabled===false?null:audio;
  }
  triggerAudioOnly(event) {
    const audioRecipe=this.audioRecipeForEvent(event); if(!audioRecipe)return false;
    const magnitude=Math.max(0,Math.min(1,Number(event?.magnitude??1)));
    this.audio.trigger(audioRecipe,magnitude,event); return true;
  }
  async prepareAudioAction(actionId) {
    const audioRecipe=this.audioRecipeForEvent({type:actionId});
    return audioRecipe ? this.audio.prepare(audioRecipe) : false;
  }
  setAudioSource(source) { this.audio.setSource(source); this.audio.preload(); }
  resetTransient() {
    this.particles.resize(this.preset.maxParticles); this.flashes.length = 0;
    this.camera.time = 0; this.impulse.time = 0; this.impulse.bounds = null; this.impulse.targetSlot = 1;
    this.actorFlash.time = 0; this.actorFlash.targetSlot = 1;
    this.knockback.time = 0; this.knockback.targetSlot = 1; this.worldFlash.time = 0; this.foregroundDustBursts.length = 0; this.hudImpulse.time = 0; this.hudImpulse.bounds = null; this.hudImpulses.length = 0; this.poseGenerators.length = 0;
    this.freeze.startFrame = -1; this.freeze.frames = 0; this.clockSeconds = 0;
    this.audio.dropped = 0; this.particles.dropped = 0; this.stats.events = 0;
  }
  setMeasuredJuiceMs(ms) {
    if (!this.profile.adaptiveBudget) { this.quality = 1; return; }
    if (ms > this.preset.juiceBudgetMs) this.frameOverruns = Math.min(30, this.frameOverruns + 2);
    else this.frameOverruns = Math.max(0, this.frameOverruns - 1);
    if (this.frameOverruns > 20) this.quality = 0.35;
    else if (this.frameOverruns > 12) this.quality = 0.5;
    else if (this.frameOverruns > 5) this.quality = 0.75;
    else this.quality = this.preset.defaultQuality;
    this.stats.quality = this.quality;
  }
  shouldHoldFrame(frameSerial) {
    if (!this.enabled || this.freeze.frames <= 0 || this.freeze.startFrame < 0) return false;
    const age = Number(frameSerial) - this.freeze.startFrame;
    return age > 0 && age <= this.freeze.frames;
  }
  poseGeneratorBindingsForEvent(eventType) {
    const matches=[];
    for (const action of Object.values(this.profile.actions || {})) {
      if (!action?.poseEmitter?.enabled) continue;
      const bindings=Array.isArray(action.poseEmitter.bindings)?action.poseEmitter.bindings:[];
      for (const binding of bindings) if (binding?.event === eventType && binding?.emitter?.enabled !== false) matches.push(binding);
    }
    return matches;
  }
  spawnPoseGenerator(binding,bounds,direction) {
    if (!binding?.emitter || !bounds) return;
    const emitter=binding.emitter;
    const anchor=poseEmitterAnchorPoint(binding,bounds,direction);
    if (!anchor) return;
    const particleDirection=poseEmitterParticleDirection(binding,direction);
    let wanted=Math.max(0,Math.round((Number(emitter.count)||0)*this.quality));
    while(wanted-- > 0){
      const sample=poseEmitterParticleSample(emitter,particleDirection),scale=this.spatialScale;
      const offset=particleEmitterSpawnOffset(emitter);
      this.particles.spawnOne(anchor.x+offset.x*scale,anchor.y+offset.y*scale,sample.vx*scale,sample.vy*scale,sample.lifeMs,sample.gravity*scale,sample.size*scale,sample.tone);
    }
  }
  armPoseGeneratorsForEvent(event) {
    const matches=this.poseGeneratorBindingsForEvent(String(event?.type || ''));
    if (!matches.length) return;
    /* Every matching binding is an independent authored layer. Repeated source
     * events during the same held/fixed episode refresh each layer but do not
     * inject extra bursts; each generator's playback mode owns repetition. */
    const direction=Number(event?.direction ?? 1)<0?-1:1;
    const targetSlot=Number(event?.targetSlot ?? 1)>>>0;
    for(const binding of matches){
      const playbackMode=binding.emitter?.playbackMode==='one-shot'?'one-shot':'loop';
      const existing=this.poseGenerators.find(item=>item.binding?.id===binding.id && item.binding?.event===binding.event);
      if(existing){
        existing.binding=binding; existing.direction=direction; existing.targetSlot=targetSlot;
        if(existing.holdMode==='frames') existing.remaining=Math.max(existing.remaining,Math.max(1,Math.round(binding.frames||2)));
        continue;
      }
      const active={binding,targetSlot,direction,holdMode:binding.holdMode||'frames',remaining:Math.max(1,Math.round(binding.frames||2)),playbackMode,nextEmit:this.clockSeconds+poseEmitterCadenceSeconds(binding)};
      this.poseGenerators.push(active);
      this.spawnPoseGenerator(binding,event?.targetBounds,direction);
    }
  }
  updatePoseGenerators(actorResolver,visual={}) {
    if (!this.poseGenerators.length || typeof actorResolver !== 'function') return;
    for (let i=this.poseGenerators.length-1;i>=0;i-=1) {
      const active=this.poseGenerators[i];
      const held=active.holdMode==='while-fire'?!!visual.fireHeld:active.holdMode==='while-action'?!!visual.actionHeld:active.remaining>0;
      if (!held) { this.poseGenerators.splice(i,1); continue; }
      if (active.playbackMode==='one-shot') continue;
      if (this.clockSeconds + 1e-9 < active.nextEmit) continue;
      const actor=actorResolver(active.targetSlot); const bounds=actor?.bounds; if(!bounds) continue;
      this.spawnPoseGenerator(active.binding,bounds,active.direction);
      active.nextEmit=this.clockSeconds+poseEmitterCadenceSeconds(active.binding);
    }
  }
  trigger(event) {
    if (!this.enabled) return;
    const recipe = this.profile.actions[event.type];
    if (!recipe) return;
    if (!recipe.enabled) { if (this.audioIndependent && !event?.skipAuthoredAudio) this.triggerAudioOnly(event); return; }
    const magnitude = Math.max(0, Math.min(1, Number(event.magnitude ?? 1)));
    const x = Number(event.x ?? 0), y = Number(event.y ?? 0), direction = Number(event.direction ?? 1) < 0 ? -1 : 1;
    this.stats.events += 1; const eventSerial = ++this.eventSerial;
    if (recipe.particles.enabled) this.particles.spawn(x, y, recipe.particles.count, recipe.particles, direction, this.quality, this.spatialScale);
    if (recipe.camera.enabled) {
      this.camera.time = this.camera.duration = recipe.camera.durationMs / 1000;
      const impactScale = recipe.camera.impactLinked ? (Number(recipe.camera.impactMinScale ?? 0.35) + (1 - Number(recipe.camera.impactMinScale ?? 0.35)) * Math.pow(magnitude, Number(recipe.camera.impactExponent ?? 1))) : 1;
      this.camera.amplitude = Number(recipe.camera.amplitude) * impactScale * this.spatialScale; this.camera.frequency = recipe.camera.frequency;
    }
    if (recipe.foregroundDust?.enabled) { const f=recipe.foregroundDust,scale=this.spatialScale; this.foregroundDustBursts.push({ x, y, serial:eventSerial, ...f, layerMaskBits:presentationLayerMaskBits(f.layerMask,PRESENTATION_LAYER_MASK_PRESETS.inFrontOfActors), radius:Number(f.radius)*scale, blockSize:Number(f.blockSize)*scale, speed:Number(f.speed)*scale, gravity:Number(f.gravity)*scale, size:Number(f.size)*scale }); }
    if (recipe.flash.enabled && this.flashes.length < this.preset.maxFlashes) {
      this.flashes.push({ x, y, time: recipe.flash.durationMs / 1000, duration: recipe.flash.durationMs / 1000, alpha: authoredOpacity(recipe.flash.alpha, magnitude), radius: recipe.flash.radius * (0.65 + magnitude * 0.35) * this.spatialScale, targetMode: recipe.flash.targetMode || 'area', targetSlot: Number(event.targetSlot ?? 1) >>> 0 });
    }
    if (recipe.actorFlash.enabled) {
      const frames = Math.max(0, Math.round(recipe.actorFlash.frames * magnitude));
      this.actorFlash.time = this.actorFlash.duration = frames * 0.04;
      this.actorFlash.color = recipe.actorFlash.color === 'red' ? 'red' : 'white';
      this.actorFlash.alpha = authoredOpacity(recipe.actorFlash.alpha, magnitude);
      this.actorFlash.targetSlot = Number(event.targetSlot ?? 1) >>> 0;
    }
    if (recipe.worldFlash.enabled) {
      const frames = Math.max(0, Math.round(recipe.worldFlash.frames * magnitude));
      const foregroundDelayFrames = Math.max(0, Math.round(recipe.worldFlash.foregroundDelayFrames || 0));
      const backgroundDelayFrames = Math.max(0, Math.round(recipe.worldFlash.backgroundDelayFrames || 0));
      this.worldFlash.baseDuration = frames * 0.04;
      this.worldFlash.foregroundDelay = foregroundDelayFrames * 0.04;
      this.worldFlash.backgroundDelay = backgroundDelayFrames * 0.04;
      this.worldFlash.layerMask = presentationLayerMaskBits(recipe.worldFlash.layerMask,PRESENTATION_LAYER_MASK_PRESETS.allGameplay);
      const maxDelay = Math.max((this.worldFlash.layerMask&PRESENTATION_FRONT_BITS)?this.worldFlash.foregroundDelay:0,(this.worldFlash.layerMask&PRESENTATION_BACK_BITS)?this.worldFlash.backgroundDelay:0);
      this.worldFlash.time = this.worldFlash.duration = this.worldFlash.baseDuration + maxDelay;
      this.worldFlash.x = x; this.worldFlash.y = y;
      this.worldFlash.radius = recipe.worldFlash.radius * (0.65 + magnitude * 0.35) * this.spatialScale;
      this.worldFlash.ringWidth = recipe.worldFlash.ringWidth * this.spatialScale;
      this.worldFlash.blockSize = recipe.worldFlash.blockSize * this.spatialScale;
      this.worldFlash.alpha = authoredOpacity(recipe.worldFlash.alpha, magnitude);
      this.worldFlash.color = ['red','gray'].includes(recipe.worldFlash.color) ? recipe.worldFlash.color : 'white';
      this.worldFlash.backgroundColor = ['white','off-white','faint-white','gray','red'].includes(recipe.worldFlash.backgroundColor) ? recipe.worldFlash.backgroundColor : 'off-white';
      this.worldFlash.backgroundAlphaScale = Math.max(0, Math.min(1, Number(recipe.worldFlash.backgroundAlphaScale ?? 0.55)));
    }
    if (recipe.hitStop.enabled) {
      const frames = Math.max(0, Math.round(recipe.hitStop.frames * magnitude));
      if (frames > 0) { this.freeze.startFrame = Number(event.frameSerial ?? -1); this.freeze.frames = frames; }
    }
    if (recipe.spriteImpulse.enabled) {
      this.impulse.time = this.impulse.duration = recipe.spriteImpulse.durationMs / 1000;
      this.impulse.x = recipe.spriteImpulse.x * direction * magnitude * this.spatialScale; this.impulse.y = recipe.spriteImpulse.y * magnitude * this.spatialScale;
      this.impulse.squash = recipe.spriteImpulse.squash * magnitude; this.impulse.deformationMode = recipe.spriteImpulse.deformationMode || 'blitter-bands'; this.impulse.bands = recipe.spriteImpulse.bands || 4; this.impulse.deformationPixels = (recipe.spriteImpulse.deformationPixels ?? 4) * this.spatialScale; this.impulse.degradeSprite = !!recipe.spriteImpulse.degradeSprite; this.impulse.degradationPx = (recipe.spriteImpulse.degradationPx ?? 1) * this.spatialScale; this.impulse.bounds = event.targetBounds || null; this.impulse.targetSlot = Number(event.targetSlot ?? 1) >>> 0;
    }
    if (recipe.knockback.enabled) {
      const frames = Math.max(0, Math.round(recipe.knockback.frames * magnitude));
      this.knockback.time = this.knockback.duration = frames * 0.04;
      this.knockback.x = recipe.knockback.distance * direction * magnitude * this.spatialScale;
      this.knockback.y = recipe.knockback.lift * magnitude * this.spatialScale;
      this.knockback.targetSlot = Number(event.targetSlot ?? 1) >>> 0;
    }
    if (recipe.hudImpulse.enabled && (event.hudBounds || event.hudSequence?.length || event.hudInventoryBounds)) {
      const frames = Math.max(0, Math.round(recipe.hudImpulse.frames * magnitude));
      const duration = frames * 0.04;
      const color = ['red','gray'].includes(recipe.hudImpulse.color) ? recipe.hudImpulse.color : 'white';
      const scope = recipe.hudImpulse.resourceScope || 'event';
      let sequence;
      if (scope === 'all') sequence = ['bullet','dynamite','life'].map(key => event.hudInventoryBounds?.[key]).filter(Boolean);
      else if (['bullet','dynamite','life'].includes(scope)) sequence = [event.hudInventoryBounds?.[scope]].filter(Boolean);
      else sequence = Array.isArray(event.hudSequence) && event.hudSequence.length ? event.hudSequence : [event.hudBounds];
      const stagger = Math.max(0, Math.round(recipe.hudImpulse.staggerFrames || 0)) * 0.04;
      for (let i = 0; i < sequence.length && this.hudImpulses.length < 12; i += 1) {
        const bounds = sequence[i]; if (!bounds) continue;
        this.hudImpulses.push({ bounds: { ...bounds }, color, mask: recipe.hudImpulse.mask === 'square' ? 'square' : 'sprite', pattern: recipe.hudImpulse.pattern || 'tint', alpha: authoredOpacity(recipe.hudImpulse.alpha, magnitude), jitter: recipe.hudImpulse.jitter * this.spatialScale, time: duration, duration, delay: i * stagger });
      }
      const last = this.hudImpulses.at(-1);
      if (last) Object.assign(this.hudImpulse, last);
    }
    this.armPoseGeneratorsForEvent(event);
    if (recipe.audio.enabled && !event?.skipAuthoredAudio) this.triggerAudioOnly(event);
  }
  update(dt) {
    if (!this.enabled) return;
    const step = Math.max(0, Number(dt) || 0);
    this.clockSeconds += step;
    this.particles.update(step);
    for (let i = this.flashes.length - 1; i >= 0; i -= 1) { this.flashes[i].time -= step; if (this.flashes[i].time <= 0) this.flashes.splice(i, 1); }
    this.camera.time = Math.max(0, this.camera.time - step); this.impulse.time = Math.max(0, this.impulse.time - step); this.actorFlash.time = Math.max(0, this.actorFlash.time - step);
    if (step > 0) for (const active of this.poseGenerators) if (active.holdMode === 'frames') active.remaining -= step / 0.04;
    this.knockback.time = Math.max(0, this.knockback.time - step); this.worldFlash.time = Math.max(0, this.worldFlash.time - step); this.hudImpulse.time = Math.max(0, this.hudImpulse.time - step); for (const h of this.hudImpulses) { if (h.delay > 0) h.delay = Math.max(0, h.delay - step); else h.time = Math.max(0, h.time - step); } this.hudImpulses = this.hudImpulses.filter(h => h.delay > 0 || h.time > 0);
    this.stats.droppedParticles = this.particles.dropped; this.stats.droppedAudio = this.audio.dropped;
  }
  cameraOffset(_nowSeconds = this.clockSeconds) {
    if (this.camera.time <= 0 || this.camera.duration <= 0) return { x: 0, y: 0 };
    const decay = this.camera.time / this.camera.duration;
    const age = Math.max(0, this.camera.duration - this.camera.time);
    const phase = age * this.camera.frequency * TAU;
    let x = Math.sin(phase) * this.camera.amplitude * decay;
    let y = Math.cos(phase * 1.37) * this.camera.amplitude * 0.55 * decay;
    /* Pixel-art camera feedback must survive integer framebuffer translation.
     * Enabled presets with >=1px amplitude should never quantize to permanent
     * zero, even if a sampled phase lands near a sine crossing. */
    if (this.camera.amplitude >= 1 && decay > .15 && Math.abs(x) < .55 && Math.abs(y) < .55)
      x = (Math.cos(phase) >= 0 ? 1 : -1) * Math.min(this.camera.amplitude, 1);
    return { x, y };
  }
  spriteTransform() {
    if (this.impulse.time <= 0 || this.impulse.duration <= 0) return { x: 0, y: 0, squash: 0, deformationMode:'blitter-bands', bounds: null, targetSlot: 1 };
    const t = this.impulse.time / this.impulse.duration;
    return { x: this.impulse.x * t, y: this.impulse.y * t, squash: this.impulse.squash * Math.sin(t * Math.PI), deformationMode:this.impulse.deformationMode || 'blitter-bands', bands:this.impulse.bands || 4, deformationPixels:this.impulse.deformationPixels ?? 4, degradeSprite:!!this.impulse.degradeSprite, degradationPx:this.impulse.degradationPx ?? 1, bounds: this.impulse.bounds, targetSlot: this.impulse.targetSlot };
  }
  knockbackTransform() {
    if (this.knockback.time <= 0 || this.knockback.duration <= 0) return { x: 0, y: 0, targetSlot: 1 };
    const t = this.knockback.time / this.knockback.duration;
    /* Fast attack / slower settle without any spring simulation. */
    const envelope = t > 0.55 ? 1 : t / 0.55;
    return { x: this.knockback.x * envelope, y: this.knockback.y * envelope, targetSlot: this.knockback.targetSlot };
  }
  renderActorEffects(ctx, actorResolver, visual = {}) {
    if (!this.enabled || typeof actorResolver !== 'function') return;
    const impulse = this.spriteTransform();
    const knock = this.knockbackTransform();
    const impulseActive = !!(impulse.x || impulse.y || impulse.squash);
    const knockActive = !!(knock.x || knock.y);
    const flashActive = this.actorFlash.time > 0 && this.actorFlash.duration > 0 && this.actorFlash.alpha > 0;
    this.updatePoseGenerators(actorResolver, visual);
    if (!impulseActive && !knockActive && !flashActive) return;

    const slots = [];
    const addSlot = (slot) => { if (!slots.includes(slot)) slots.push(slot); };
    if (impulseActive) addSlot(impulse.targetSlot);
    if (knockActive) addSlot(knock.targetSlot);
    if (flashActive) addSlot(this.actorFlash.targetSlot);

    ctx.save(); ctx.globalAlpha = 1; ctx.imageSmoothingEnabled = false;
    for (const slot of slots) {
      const actor = actorResolver(slot);
      const b = actor?.bounds || (slot === impulse.targetSlot ? impulse.bounds : null);
      let sourceCanvas = actor?.canvas;
      if (!b || !sourceCanvas) continue;
      const sx = Math.max(0, Math.floor(b.left - 2)), sy = Math.max(0, Math.floor(b.top - 2));
      const sw = Math.min(sourceCanvas.width - sx, Math.ceil(b.right - b.left + 4));
      const sh = Math.min(sourceCanvas.height - sy, Math.ceil(b.bottom - b.top + 4));
      if (sw <= 0 || sh <= 0) continue;

      const useImpulse = impulseActive && slot === impulse.targetSlot;
      const useKnock = knockActive && slot === knock.targetSlot;
      const useFlash = flashActive && slot === this.actorFlash.targetSlot;
      const mode = useImpulse ? (impulse.deformationMode || 'blitter-bands') : 'translate';
      const offsetX = (useImpulse ? impulse.x : 0) + (useKnock ? knock.x : 0);
      const offsetY = (useImpulse ? impulse.y : 0) + (useKnock ? knock.y : 0);
      let dx = Math.round(sx + offsetX), dy = Math.round(sy + offsetY), dw = sw, dh = sh;
      if (mode === 'scale') {
        /* Enhanced/non-period-accurate preview option only. The default and
         * Amiga fallback never depend on real-time hardware scaling. */
        const scaleX = Math.max(.65, 1 + impulse.squash), scaleY = Math.max(.65, 1 - impulse.squash);
        dw = Math.max(1, Math.round(sw * scaleX)); dh = Math.max(1, Math.round(sh * scaleY));
        dx = Math.round(sx + offsetX - (dw - sw) / 2); dy = Math.round(sy + offsetY + (sh - dh));
      }
      const drawActor = canvas => {
        if (mode !== 'blitter-bands' || !useImpulse || Math.abs(impulse.squash) < .001) {
          ctx.drawImage(canvas, sx, sy, sw, sh, dx, dy, dw, dh); return;
        }
        /* Period-accurate deformation approximation: split the sprite into
         * horizontal blitter strips and reposition/overlap those strips at
         * 1:1 pixel size. No source region is scaled. Positive squash overlaps
         * bands toward the feet; negative squash separates them slightly. */
        const bands = Math.max(2, Math.min(8, Math.round(impulse.bands || 4)));
        const maxPixels = Math.max(0, Math.min(8, Math.round(impulse.deformationPixels ?? 4)));
        let amount = Math.round(Math.max(-1, Math.min(1, impulse.squash / .35)) * maxPixels);
        /* A 1px band shift is effectively invisible on Rick once the actor is
         * composited over a moving gameplay frame. Preserve response to the
         * authored strength but guarantee a readable two-pixel deformation for
         * any intentional squash/stretch when the configured range permits it. */
        if (maxPixels >= 2 && Math.abs(impulse.squash) >= .01 && Math.abs(amount) < 2)
          amount = impulse.squash < 0 ? -2 : 2;
        for (let band=0; band<bands; band+=1) {
          let by0=Math.floor(sh*band/bands), by1=Math.floor(sh*(band+1)/bands);
          const degrade = impulse.degradeSprite && amount > 0 ? Math.min(Math.max(0, Math.round(impulse.degradationPx || 0)), Math.max(0, by1-by0-1)) : 0;
          if (degrade && band < bands - 1) by0 += degrade;
          const bh=Math.max(1,by1-by0);
          const weight=(bands-1-band)/(bands-1);
          const shiftY=Math.round(amount*weight);
          const bow=Math.round(Math.abs(amount) * (band===0 || band===bands-1 ? 0.5 : 0));
          const shiftX=(band%2===0 ? -bow : bow);
          ctx.drawImage(canvas, sx, sy+by0, sw, bh, dx+shiftX, dy+by0+shiftY, sw, bh);
        }
      };

      if (useImpulse || useKnock) {
        const bg = actor.backgroundCanvas;
        if (bg) ctx.drawImage(bg, 0, 0);
        drawActor(sourceCanvas);
      }
      if (useFlash && typeof actor.tintCanvas === 'function') {
        const tinted = actor.tintCanvas(this.actorFlash.color);
        ctx.save(); ctx.globalAlpha = this.actorFlash.alpha; ctx.imageSmoothingEnabled = false;
        drawActor(tinted);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  needsPresentationLayerMask() {
    return this.enabled && ((this.worldFlash.time > 0 && this.worldFlash.duration > 0) || this.foregroundDustBursts.length > 0);
  }
  needsForegroundMask() { return this.needsPresentationLayerMask(); }
  prepareWorldEffects(presentationLayers = null, foregroundMask = null) {
    if (!this.enabled || !this.foregroundDustBursts.length) return;
    for (const burst of this.foregroundDustBursts.splice(0)) {
      const dustMask=binaryMaskForPresentationLayers(presentationLayers,burst.layerMaskBits,foregroundMask||FULL_EFFECT_MASK);
      this.particles.spawnForegroundDust(dustMask, 320, 200, burst, this.quality);
    }
  }
  renderWorldEffects(ctx, presentationLayers = null, foregroundMask = null, options = {}) {
    if (!this.enabled) return;
    if (options.prepare !== false) this.prepareWorldEffects(presentationLayers,foregroundMask);
    if (this.worldFlash.time <= 0 || this.worldFlash.duration <= 0) return;
    const f = this.worldFlash;
    const age = Math.max(0, f.duration - f.time);
    const drawPlane = (delay, passBits, foregroundTone) => {
      if (!(f.layerMask & passBits) || age < delay || f.baseDuration <= 0 || age >= delay + f.baseDuration) return;
      const progress = Math.max(0, Math.min(1, (age - delay) / f.baseDuration));
      const life = 1 - progress;
      const radius = Math.max(f.blockSize, f.radius * (0.55 + progress * 0.45));
      const inner = Math.max(0, radius - f.ringWidth);
      const block = Math.max(4, Math.round(f.blockSize));
      const x0 = Math.max(0, Math.floor((f.x - radius) / block) * block);
      const x1 = Math.min(320, Math.ceil((f.x + radius) / block) * block);
      const y0 = Math.max(8, Math.floor((f.y - radius) / block) * block);
      const y1 = Math.min(200, Math.ceil((f.y + radius) / block) * block);
      ctx.save();ctx.globalCompositeOperation = 'source-over';
      const tone = foregroundTone ? f.color : f.backgroundColor, alphaScale = foregroundTone ? 1 : f.backgroundAlphaScale;
      ctx.globalAlpha = lifetimeOpacity(f.alpha * alphaScale, 0.55 + 0.45 * life);
      ctx.fillStyle = tone === 'red' ? '#ff5050' : tone === 'gray' ? '#c8c8c8' : tone === 'off-white' ? '#fff3d6' : tone === 'faint-white' ? '#d8d8d0' : '#ffffff';
      const inner2 = inner * inner, outer2 = radius * radius;
      for (let y = y0; y < y1; y += block) for (let x = x0; x < x1; x += block) {
        const cx = x + block * .5, cy = y + block * .5, ddx = cx - f.x, ddy = cy - f.y, d2 = ddx * ddx + ddy * ddy;
        if (d2 < inner2 || d2 > outer2) continue;
        if (presentationLayers) {
          /* Keep the authored 8x8 ripple geometry, but mask every pixel inside
           * the selected ripple block. Sampling only the block centre lets a
           * foreground decoration turn adjacent Midground terrain white when
           * both occupy the same 8x8 square, violating the layer-mask contract. */
          const left=Math.max(0,x),right=Math.min(320,x+block),top=Math.max(8,y),bottom=Math.min(200,y+block);
          for(let py=top;py<bottom;py++){
            let run=-1;
            for(let px=left;px<=right;px++){
              const selected=px<right && !!((presentationLayers[py*320+px]||0) & f.layerMask & passBits);
              if(selected&&run<0)run=px;
              else if(!selected&&run>=0){ctx.fillRect(run,py,px-run,1);run=-1;}
            }
          }
        } else {
          const preferred=(f.layerMask&PRESENTATION_FRONT_BITS)?PRESENTATION_FRONT_BITS:PRESENTATION_BACK_BITS;
          if(passBits!==preferred)continue;
          ctx.fillRect(x, y, block, block);
        }
      }
      ctx.restore();
    };
    drawPlane(f.backgroundDelay, PRESENTATION_BACK_BITS, false);
    drawPlane(f.foregroundDelay, PRESENTATION_FRONT_BITS, true);
  }
  renderHudEffects(ctx, sourceCanvas) {
    if (!this.enabled || !this.hudImpulses.length) return;
    for (const h of this.hudImpulses) {
      if (h.delay > 0 || h.time <= 0 || h.duration <= 0 || !h.bounds) continue;
      const b = h.bounds;
      const life = Math.max(0, Math.min(1, h.time / h.duration));
      const phase = Math.floor((h.duration - h.time) / 0.04);
      const jitter = Math.round(h.jitter * life) * (phase & 1 ? -1 : 1);
      const x = Math.round(b.left), y = Math.round(b.top), w = Math.max(1, Math.round(b.right - b.left)), hh = Math.max(1, Math.round(b.bottom - b.top));
      const pattern = ['strobe','spark','cross','scan','hop'].includes(h.pattern) ? h.pattern : 'tint';
      ctx.save(); ctx.imageSmoothingEnabled = false;
      const dy = (phase & 2) ? 1 : 0;
      const fill = h.color === 'red' ? '#ff5050' : h.color === 'gray' ? '#bcbcbc' : '#ffffff';
      const opacity = lifetimeOpacity(h.alpha, life);
      let pixels = null;
      if (h.mask !== 'square' || pattern === 'hop') {
        try {
          const sourceContext = sourceCanvas?.getContext?.('2d', { willReadFrequently: true });
          pixels = sourceContext?.getImageData(x, y, w, hh)?.data || null;
        } catch (_) { pixels = null; }
      }
      const drawSpriteMask = (ox = 0, oy = 0, eraseSource = false) => {
        if (!pixels) return false;
        if (eraseSource) ctx.fillStyle = '#000000';
        for (let py = 0; py < hh; py += 1) for (let px = 0; px < w; px += 1) {
          const index = (py * w + px) * 4, alpha = pixels[index + 3];
          const luminance = pixels[index] + pixels[index + 1] + pixels[index + 2];
          if (!alpha || luminance <= 12) continue;
          if (eraseSource) ctx.fillRect(x + px, y + py, 1, 1);
        }
        ctx.fillStyle = fill;
        ctx.globalAlpha = opacity;
        for (let py = 0; py < hh; py += 1) for (let px = 0; px < w; px += 1) {
          const index = (py * w + px) * 4, alpha = pixels[index + 3];
          const luminance = pixels[index] + pixels[index + 1] + pixels[index + 2];
          if (!alpha || luminance <= 12) continue;
          ctx.fillRect(x + jitter + ox + px, y + oy + py, 1, 1);
        }
        return true;
      };

      if (pattern === 'cross') {
        ctx.globalAlpha = opacity; ctx.fillStyle = fill;
        const inset = Math.min(2, phase);
        for (let p = inset; p < Math.min(w, hh) - inset; p += 1) {
          ctx.fillRect(x + p, y + p, 1, 1);
          ctx.fillRect(x + w - 1 - p, y + p, 1, 1);
        }
      } else if (pattern === 'scan') {
        ctx.globalAlpha = opacity; ctx.fillStyle = fill;
        const row = Math.min(hh - 1, Math.floor((phase % Math.max(1, Math.min(4, hh))) * hh / Math.max(1, Math.min(4, hh))));
        ctx.fillRect(x, y + row, w, Math.min(2, hh - row));
      } else if (pattern === 'spark') {
        if (h.mask === 'square') { ctx.globalAlpha = opacity; ctx.fillStyle = fill; ctx.fillRect(x + jitter, y, w, hh); }
        else drawSpriteMask(0, 0, false);
        ctx.globalAlpha = opacity; ctx.fillStyle = fill;
        const reach = Math.max(1, 3 - Math.min(2, phase));
        const cx = x + Math.floor(w / 2), cy = y + Math.floor(hh / 2);
        ctx.fillRect(cx, y - reach, 1, 2); ctx.fillRect(cx, y + hh + reach - 2, 1, 2);
        ctx.fillRect(x - reach, cy, 2, 1); ctx.fillRect(x + w + reach - 2, cy, 2, 1);
      } else if (pattern === 'hop' && h.mask !== 'square' && pixels) {
        const hop = [0, -2, -1, 0][phase & 3];
        drawSpriteMask(0, hop, true);
      } else if (pattern !== 'strobe' || !(phase & 1)) {
        if (h.mask === 'square') {
          if (sourceCanvas && jitter) ctx.drawImage(sourceCanvas, x, y, w, hh, x + jitter, y + dy, w, hh);
          ctx.globalAlpha = opacity; ctx.fillStyle = fill; ctx.fillRect(x + jitter, y, w, hh);
        } else {
          drawSpriteMask(0, dy, false);
        }
      }
      ctx.restore();
    }
  }
  /* Backward-compatible name for older editor smoke tests/extensions. */
  renderSpriteImpulse(ctx, actorResolver) { this.renderActorEffects(ctx, actorResolver); }
  renderFlashes(ctx, visual = {}, presentationScoped = false) {
    const mask = visual.foregroundMask || null;
    const actorResolver = typeof visual.actorResolver === 'function' ? visual.actorResolver : null;
    const actorSlots = Array.isArray(visual.actorSlots) ? visual.actorSlots : [];
    for (const f of this.flashes) {
      const scoped=f.targetMode === 'foreground' || f.targetMode === 'background';
      if(scoped!==presentationScoped)continue;
      const life = Math.max(0, f.duration > 0 ? f.time / f.duration : 0);
      const alpha = lifetimeOpacity(f.alpha, life);
      const radius = Math.max(1, Math.round(f.radius * (1.25 - life * 0.25)));
      const left = Math.round(f.x - radius / 2), top = Math.round(f.y - radius / 2);
      ctx.save(); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = alpha; ctx.fillStyle = '#fff3bf';
      if (scoped && mask) {
        const wantForeground = f.targetMode === 'foreground';
        const x0=Math.max(0,left), y0=Math.max(8,top), x1=Math.min(320,left+radius), y1=Math.min(200,top+radius);
        for(let y=y0;y<y1;y+=2) for(let x=x0;x<x1;x+=2) {
          if (!!mask[y*320+x] === wantForeground) ctx.fillRect(x,y,2,2);
        }
      } else if ((f.targetMode === 'target-actor' || f.targetMode === 'nearby-actors') && actorResolver) {
        const candidates = f.targetMode === 'target-actor' ? [f.targetSlot] : actorSlots;
        ctx.beginPath(); ctx.rect(left,top,radius,radius); ctx.clip();
        for (const slot of candidates) {
          const actor=actorResolver(slot), b=actor?.bounds; if(!actor?.canvas||!b)continue;
          if (b.right < left || b.left > left+radius || b.bottom < top || b.top > top+radius) continue;
          const tint=typeof actor.tintCanvas==='function'?actor.tintCanvas('white'):actor.canvas; ctx.drawImage(tint,0,0);
        }
      } else {
        ctx.fillRect(left, top, radius, radius);
      }
      ctx.restore();
    }
  }
  renderActorDepthEffects(ctx, visual = {}) {
    if (!this.enabled) return;
    this.particles.render(ctx);
    this.renderFlashes(ctx,visual,false);
  }
  renderPresentationEffects(ctx, visual = {}) {
    if (!this.enabled) return;
    this.renderFlashes(ctx,visual,true);
  }
  render(ctx, visual = {}) {
    if (!this.enabled) return;
    this.renderActorDepthEffects(ctx,visual);
    this.renderPresentationEffects(ctx,visual);
  }
}
