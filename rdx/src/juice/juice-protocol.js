import { PRESENTATION_LAYER_MASK_PRESETS, normalizePresentationLayerSelection } from './presentation-layer-mask.js';
export const JUICE_SCHEMA = 'rick-dangerous-revival.juice-profile.v1';
export const JUICE_STORAGE_KEY = 'rick-dangerous-revival.juice-editor.v1';

export const PERFORMANCE_PRESETS = Object.freeze({
  potato25: Object.freeze({
    id: 'potato25', label: 'Very low-end · 25 FPS', frameBudgetMs: 40, juiceBudgetMs: 2,
    maxParticles: 48, maxVoices: 2, maxFlashes: 1, maxTrails: 4, defaultQuality: 0.75
  }),
  low30: Object.freeze({
    id: 'low30', label: 'Low-end · 30 FPS', frameBudgetMs: 33.33, juiceBudgetMs: 3,
    maxParticles: 72, maxVoices: 3, maxFlashes: 2, maxTrails: 8, defaultQuality: 1
  }),
  desktop60: Object.freeze({
    id: 'desktop60', label: 'Desktop · 60 FPS', frameBudgetMs: 16.67, juiceBudgetMs: 4,
    maxParticles: 160, maxVoices: 6, maxFlashes: 4, maxTrails: 24, defaultQuality: 1
  })
});

export const MAX_POSE_EMITTER_BINDINGS = 64;

export const ACTIONS = Object.freeze([
  { id: 'player.step', group: 'Player', label: 'Walk step', test: 'run' },
  { id: 'player.turn', group: 'Player', label: 'Grounded direction turn', test: 'run' },
  { id: 'player.jump', group: 'Player', label: 'Jump takeoff', test: 'jump' },
  { id: 'player.bounce_back', group: 'Player', label: 'Bounce back', test: 'jump' },
  { id: 'player.apex', group: 'Player', label: 'Jump apex', test: 'jump' },
  { id: 'player.land', group: 'Player', label: 'Landing', test: 'jump' },
  { id: 'player.wall_hug', group: 'Player', label: 'Wall hug / falling contact', test: 'jump' },
  { id: 'player.staff_hold', group: 'Player', label: 'Staff / stop pose hold', test: 'run' },
  { id: 'weapon.fire', group: 'Weapon', label: 'Gun fire', test: 'range' },
  { id: 'bullet.wall_hit', group: 'Weapon', label: 'Bullet wall impact', test: 'range' },
  { id: 'bullet.target_hit', group: 'Weapon', label: 'Enemy hit by bullet', test: 'range' },
  { id: 'enemy.stick_hit', group: 'Weapon', label: 'Enemy stopped by stick', test: 'range' },
  { id: 'player.projectile_hit', group: 'Damage', label: 'Hero hit by projectile', test: 'range' },
  { id: 'projectile.near_miss', group: 'Danger', label: 'Projectile near miss', test: 'range' },
  { id: 'dynamite.place', group: 'Dynamite', label: 'Place dynamite', test: 'dynamite' },
  { id: 'dynamite.fuse', group: 'Dynamite', label: 'Fuse pulse', test: 'dynamite' },
  { id: 'dynamite.explode', group: 'Dynamite', label: 'Explosion', test: 'dynamite' },
  { id: 'ammo.explode', group: 'World', label: 'Ammo collectible explosion', test: 'range' },
  { id: 'dynamite.target_hit', group: 'Damage', label: 'Enemy hit by explosion', test: 'dynamite' },
  { id: 'player.explosion_hit', group: 'Damage', label: 'Hero hit by explosion', test: 'dynamite' },
  { id: 'player.explosion_near_miss', group: 'Danger', label: 'Hero near explosion bounce', test: 'dynamite' },
  { id: 'player.suppressed_lethal_hit', group: 'Damage', label: 'Invincible lethal-hit feedback', test: 'range' },
  { id: 'pickup.collect', group: 'World', label: 'Pickup', test: 'pickup' },
  { id: 'ammo.deplete', group: 'Resources', label: 'Ammo depletion', test: 'range' },
  { id: 'ammo.collect', group: 'Resources', label: 'Ammo collection', test: 'pickup' },
  { id: 'points.collect', group: 'Resources', label: 'Points gained', test: 'pickup' },
  { id: 'platform.start', group: 'Moving platform', label: 'Platform starts moving', test: 'platform' },
  { id: 'platform.release', group: 'Moving platform', label: 'Explodable platform activation', test: 'platform' },
  { id: 'platform.stop', group: 'Moving platform', label: 'Platform stops moving', test: 'platform' },
  { id: 'platform.moving', group: 'Moving platform', label: 'Platform moving', test: 'platform' },
  { id: 'platform.running', group: 'Moving platform', label: 'Platform running / released', test: 'platform' },
  { id: 'blockage.crumble', group: 'World', label: 'Castle blockage crumble', test: 'range' }
]);

const EFFECT_COST = Object.freeze({
  particles: 1,
  camera: 0.35,
  flash: 0.2,
  actorFlash: 0.08,
  worldFlash: 0.12,
  hitStop: 0.05,
  spriteImpulse: 0.1,
  foregroundDust: 0.55,
  knockback: 0.08,
  hudImpulse: 0.06,
  heroPose: 0.08,
  attachedEmitter: 0.3,
  poseEmitter: 0.3,
  audio: 0.25
});

function effect(overrides = {}) {
  return {
    enabled: true,
    solo: false,
    particles: { enabled: false, count: 0, speed: 30, lifeMs: 220, spread: 1, gravity: 45, size: 2, shape: 'block', spawnRadius: 0, emitterWidth: 1, emitterHeight: 1, shrink: false, tone: 'dust', ...overrides.particles },
    camera: { enabled: false, amplitude: 0, durationMs: 90, frequency: 28, impactLinked: false, impactMinScale: 0.35, impactExponent: 1, ...overrides.camera },
    flash: { enabled: false, alpha: 0, durationMs: 45, radius: 20, targetMode: 'area', ...overrides.flash },
    actorFlash: { enabled: false, color: 'white', frames: 1, alpha: 1, ...overrides.actorFlash },
    worldFlash: { enabled: false, color: 'white', backgroundColor: 'off-white', backgroundAlphaScale: 0.55, frames: 1, alpha: 0.8, radius: 56, blockSize: 8, ringWidth: 16, layerMask: [...PRESENTATION_LAYER_MASK_PRESETS.allGameplay], foregroundDelayFrames: 0, backgroundDelayFrames: 1, ...overrides.worldFlash },
    hitStop: { enabled: false, frames: 0, ...overrides.hitStop },
    spriteImpulse: { enabled: false, x: 0, y: 0, squash: 0, deformationMode: 'blitter-bands', bands: 4, deformationPixels: 4, degradeSprite: false, degradationPx: 1, durationMs: 100, ...overrides.spriteImpulse },
    foregroundDust: { enabled: false, radius: 48, blockSize: 8, density: 0.3, speed: 54, lifeMs: 260, gravity: 65, size: 2, layerMask: [...PRESENTATION_LAYER_MASK_PRESETS.inFrontOfActors], ...overrides.foregroundDust },
    knockback: { enabled: false, distance: 0, lift: 0, frames: 2, ...overrides.knockback },
    hudImpulse: { enabled: false, color: 'white', mask: 'sprite', pattern: 'tint', resourceScope: 'event', frames: 2, alpha: 1, jitter: 1, staggerFrames: 0, ...overrides.hudImpulse },
    heroPose: { enabled: false, frame: 'event', holdMode: 'frames', frames: 2, poses: [], ...overrides.heroPose },
    attachedEmitter: { enabled: false, anchorX: 25, anchorY: 9, mirrorX: true, emitterWidth: 1, emitterHeight: 1, count: 3, speed: 18, lifeMs: 260, spread: 0.35, gravity: -6, size: 1, tone: 'smoke', ...overrides.attachedEmitter },
    poseEmitter: { enabled: false, bindings: [], ...overrides.poseEmitter },
    audio: { enabled: false, sample: 'walk.wav', gain: 0.55, pitchVariance: 0.03, rate: 1, pan: 0, panFromEvent: false, attackMs: 0, releaseMs: 0, filterType: 'none', filterHz: 4200, layerSample: '', layerGain: 0, layerRate: 1, ...overrides.audio }
  };
}

export function createDefaultActionRecipe(overrides = {}) {
  return effect(overrides);
}

export const DEFAULT_PROFILE = Object.freeze({
  schema: JUICE_SCHEMA,
  name: 'Balanced low-end draft',
  performancePreset: 'potato25',
  adaptiveBudget: true,
  motionTrail: { enabled: false, copies: 3, color: 'off-white', alpha: 1 },
  entityAudio: {},
  transitions: {
    mapExit: { preset: 'copper-curtain', durationFrames: 12, direction: 'auto', origin: 'rick', originX: 160, originY: 100 },
    mapEntry: { preset: 'copper-curtain', durationFrames: 10, direction: 'auto', origin: 'center', originX: 160, originY: 100 },
    playerDeath: { preset: 'tunnel-iris', durationFrames: 10, direction: 'auto', origin: 'rick', originX: 160, originY: 100 }
  },
  actions: {
    'player.step': effect({ particles: { enabled: true, count: 2, speed: 13, lifeMs: 130, gravity: 20, size: 1 }, audio: { enabled: true, sample: 'walk.wav', gain: 0.34, pitchVariance: 0.02 } }),
    'player.turn': effect({ particles: { enabled: true, count: 3, speed: 18, lifeMs: 140, gravity: 30, size: 1 }, spriteImpulse: { enabled: true, x: -1, durationMs: 70 } }),
    'player.jump': effect({ particles: { enabled: true, count: 4, speed: 21, lifeMs: 150, gravity: 35, size: 1 }, spriteImpulse: { enabled: true, y: 1, squash: -0.05, durationMs: 85 }, audio: { enabled: true, sample: 'jump.wav', gain: 0.55, pitchVariance: 0.01 } }),
    'player.bounce_back': effect(),
    'player.apex': effect({ spriteImpulse: { enabled: true, y: -1, squash: 0.03, durationMs: 80 } }),
    'player.land': effect({ particles: { enabled: true, count: 7, speed: 30, lifeMs: 190, gravity: 50, size: 1 }, camera: { enabled: true, amplitude: 1.4, durationMs: 80, impactLinked: true, impactMinScale: 0.25, impactExponent: 1.35 }, spriteImpulse: { enabled: true, squash: 0.16, bands: 4, deformationPixels: 5, degradeSprite: true, degradationPx: 1, durationMs: 110 }, audio: { enabled: true, sample: 'stick.wav', gain: 0.35, pitchVariance: 0.01 } }),
    'player.wall_hug': effect({ particles: { enabled: true, count: 3, speed: 11, lifeMs: 220, spread: 0.45, gravity: 80, size: 1 }, audio: { enabled: false, sample: 'crawl.wav', gain: 0.16, pitchVariance: 0.025 } }),
    'player.staff_hold': effect({ poseEmitter: { enabled: false, bindings: [{ id:'staff-stop-spark', event:'player.staff_hold', holdMode:'while-action', frames:2, classicFrameSource:'event', classicFrameId:11, rdxFrameSource:'event', rdxPn:0x63, rdxFrameIndex:0, emitter:{ enabled:true, anchorX:25, anchorY:7, mirrorX:true, count:2, speed:12, lifeMs:110, spread:0.9, gravity:0, size:1, tone:'spark', playbackMode:'loop', cadenceFrames:2 } }] } }),
    'weapon.fire': effect({ particles: { enabled: true, count: 2, speed: 34, lifeMs: 80, gravity: 0, size: 1 }, camera: { enabled: true, amplitude: 0.5, durationMs: 40 }, flash: { enabled: true, alpha: 1, durationMs: 28, radius: 7 }, spriteImpulse: { enabled: true, x: -2, durationMs: 55 }, audio: { enabled: true, sample: 'bullet.wav', gain: 0.45, pitchVariance: 0.01 } }),
    'bullet.wall_hit': effect({ particles: { enabled: true, count: 5, speed: 34, lifeMs: 120, gravity: 20, size: 1 }, flash: { enabled: true, alpha: 1, durationMs: 32, radius: 6 }, audio: { enabled: true, sample: 'box.wav', gain: 0.35, pitchVariance: 0.02 } }),
    'bullet.target_hit': effect({ particles: { enabled: true, count: 3, speed: 38, lifeMs: 130, gravity: 24, size: 1 }, flash: { enabled: true, alpha: 1, durationMs: 35, radius: 9 }, actorFlash: { enabled: true, color: 'white', frames: 1, alpha: 1 }, hitStop: { enabled: true, frames: 1 }, knockback: { enabled: true, distance: 3, lift: 0, frames: 2 }, audio: { enabled: false, sample: 'ent0.wav', gain: 0.4, pitchVariance: 0.01 } }),
    'enemy.stick_hit': effect({ actorFlash: { enabled: true, color: 'white', frames: 1, alpha: 1 }, audio: { enabled: false, sample: 'stick_hit.wav', gain: 0.42, pitchVariance: 0.015, panFromEvent: true } }),
    'player.projectile_hit': effect({ actorFlash: { enabled: true, color: 'red', frames: 2, alpha: 1 }, hitStop: { enabled: true, frames: 1 }, knockback: { enabled: true, distance: 4, lift: -1, frames: 3 }, camera: { enabled: true, amplitude: 1.1, durationMs: 60 }, audio: { enabled: false, sample: 'die.wav', gain: 0.4 } }),
    'projectile.near_miss': effect({ particles: { enabled: true, count: 2, speed: 16, lifeMs: 145, spread: 0.75, gravity: 55, size: 1 }, audio: { enabled: true, sample: 'ent8.wav', gain: 0.28, pitchVariance: 0.035, rate: 1.08, panFromEvent: true } }),
    'dynamite.place': effect({ particles: { enabled: true, count: 2, speed: 9, lifeMs: 90, gravity: 20, size: 1 }, audio: { enabled: true, sample: 'bombshht.wav', gain: 0.42, pitchVariance: 0.01 } }),
    'dynamite.fuse': effect({ particles: { enabled: true, count: 2, speed: 16, lifeMs: 90, gravity: -10, size: 1 }, flash: { enabled: true, alpha: 1, durationMs: 25, radius: 5 }, audio: { enabled: true, sample: 'bombshht.wav', gain: 0.18, pitchVariance: 0.03 } }),
    'dynamite.explode': effect({ particles: { enabled: true, count: 7, speed: 55, lifeMs: 210, gravity: 50, size: 1 }, foregroundDust: { enabled: true, radius: 56, blockSize: 8, density: 0.34, speed: 62, lifeMs: 290, gravity: 72, size: 2 }, camera: { enabled: true, amplitude: 2.6, durationMs: 120, impactLinked: true, impactMinScale: 0.55, impactExponent: 1.1 }, flash: { enabled: true, alpha: 1, durationMs: 45, radius: 23 }, worldFlash: { enabled: true, color: 'white', backgroundAlphaScale: 1, frames: 2, alpha: 1, radius: 72, blockSize: 8, ringWidth: 18, layerMask: [...PRESENTATION_LAYER_MASK_PRESETS.sceneryWithoutMidground], foregroundDelayFrames: 0, backgroundDelayFrames: 1 }, hitStop: { enabled: true, frames: 1 }, audio: { enabled: true, sample: 'explode.wav', gain: 0.55, pitchVariance: 0 } }),
    'ammo.explode': effect({ particles: { enabled: true, count: 5, speed: 45, lifeMs: 170, gravity: 45, size: 1 }, camera: { enabled: true, amplitude: 1.6, durationMs: 85 }, flash: { enabled: true, alpha: 1, durationMs: 40, radius: 18 }, worldFlash: { enabled: true, color: 'white', backgroundColor: 'faint-white', backgroundAlphaScale: 1, frames: 1, alpha: 1, radius: 48, blockSize: 8, ringWidth: 14, layerMask: [...PRESENTATION_LAYER_MASK_PRESETS.allGameplay], foregroundDelayFrames: 0, backgroundDelayFrames: 1 }, hitStop: { enabled: true, frames: 1 }, audio: { enabled: false, sample: 'explode.wav', gain: 0.48, pitchVariance: 0 } }),
    'dynamite.target_hit': effect({ actorFlash: { enabled: true, color: 'white', frames: 2, alpha: 1 }, knockback: { enabled: true, distance: 6, lift: -2, frames: 3 }, flash: { enabled: true, alpha: 1, durationMs: 40, radius: 12 } }),
    'player.explosion_hit': effect({ actorFlash: { enabled: true, color: 'red', frames: 2, alpha: 1 }, hitStop: { enabled: true, frames: 1 }, knockback: { enabled: true, distance: 7, lift: -2, frames: 4 }, camera: { enabled: true, amplitude: 2.3, durationMs: 100 } }),
    'player.suppressed_lethal_hit': effect({ actorFlash: { enabled: true, color: 'red', frames: 2, alpha: 1 } }),
    'player.explosion_near_miss': effect({ particles: { enabled: true, count: 3, speed: 18, lifeMs: 150, spread: 0.7, gravity: 45, size: 1 }, spriteImpulse: { enabled: true, y: -1, durationMs: 90 } }),
    'pickup.collect': effect({ particles: { enabled: true, count: 6, speed: 24, lifeMs: 190, gravity: -15, size: 1 }, flash: { enabled: true, alpha: 1, durationMs: 45, radius: 10 }, audio: { enabled: true, sample: 'bonus.wav', gain: 0.5, pitchVariance: 0.01 } }),
    'ammo.deplete': effect({ hudImpulse: { enabled: true, color: 'gray', frames: 2, alpha: 1, jitter: 1 }, audio: { enabled: false, sample: 'bullet.wav', gain: 0.25 } }),
    'ammo.collect': effect({ hudImpulse: { enabled: true, color: 'white', frames: 3, alpha: 1, jitter: 1, staggerFrames: 1 }, flash: { enabled: true, alpha: 1, durationMs: 40, radius: 8 }, audio: { enabled: true, sample: 'bonus.wav', gain: 0.42, pitchVariance: 0.01 } }),
    'points.collect': effect({ hudImpulse: { enabled: true, color: 'white', frames: 2, alpha: 1, jitter: 0 }, particles: { enabled: true, count: 3, speed: 16, lifeMs: 150, gravity: -20, size: 1 }, audio: { enabled: true, sample: 'bonus.wav', gain: 0.32, pitchVariance: 0.015 } }),
    'platform.start': effect(),
    'platform.release': effect(),
    'platform.stop': effect(),
    'platform.moving': effect(),
    'platform.running': effect(),
    'blockage.crumble': effect()
  }
});

export function cloneProfile(profile = DEFAULT_PROFILE) {
  return JSON.parse(JSON.stringify(profile));
}

function clamp(value, min, max) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
}

export function normalizeProfile(input) {
  const base = cloneProfile(DEFAULT_PROFILE);
  if (!input || typeof input !== 'object') return base;
  base.name = String(input.name || base.name).slice(0, 80);
  base.performancePreset = PERFORMANCE_PRESETS[input.performancePreset] ? input.performancePreset : base.performancePreset;
  base.adaptiveBudget = input.adaptiveBudget !== false;
  if (input.motionTrail && typeof input.motionTrail === 'object') Object.assign(base.motionTrail, input.motionTrail);
  base.motionTrail.enabled = !!base.motionTrail.enabled;
  base.motionTrail.copies = Math.round(clamp(base.motionTrail.copies, 1, 8));
  base.motionTrail.color = ['white','off-white','faint-white','gray'].includes(base.motionTrail.color) ? base.motionTrail.color : 'off-white';
  base.motionTrail.alpha = clamp(base.motionTrail.alpha, 0.05, 1);
  const transitionPresets = new Set(['checker-wipe','blitter-bars','tile-iris','copper-curtain','raster-shutters','mosaic-collapse','tunnel-iris','pixel-dissolve','scanline-squeeze']);
  for (const hook of ['mapExit','mapEntry','playerDeath']) {
    const transition = input.transitions?.[hook] || {};
    const dstTransition = base.transitions[hook];
    dstTransition.preset = transitionPresets.has(transition.preset) ? transition.preset : dstTransition.preset;
    dstTransition.durationFrames = Math.round(clamp(transition.durationFrames ?? dstTransition.durationFrames, 4, 48));
    dstTransition.direction = ['auto','left','right'].includes(transition.direction) ? transition.direction : 'auto';
    dstTransition.origin = ['rick','center','custom'].includes(transition.origin) ? transition.origin : dstTransition.origin;
    dstTransition.originX = Math.round(clamp(transition.originX ?? dstTransition.originX, 0, 319));
    dstTransition.originY = Math.round(clamp(transition.originY ?? dstTransition.originY, 8, 199));
  }
  base.entityAudio = {};
  if (input.entityAudio && typeof input.entityAudio === 'object') {
    for (const [key, raw] of Object.entries(input.entityAudio)) {
      if (!/^(entity:\d+|category:[a-z0-9-]+)$/.test(key) || !raw || typeof raw !== 'object') continue;
      const row = {
        enabled: raw.enabled !== false,
        sample: String(raw.sample || 'walk.wav').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0,48) || 'walk.wav',
        gain: clamp(raw.gain ?? 1, 0, 1.5), pitchVariance: clamp(raw.pitchVariance ?? 0, 0, 0.2),
        rate: clamp(raw.rate ?? 1, 0.5, 2), pan: clamp(raw.pan ?? 0, -1, 1), panFromEvent: !!raw.panFromEvent,
        attackMs: Math.round(clamp(raw.attackMs ?? 0, 0, 250)), releaseMs: Math.round(clamp(raw.releaseMs ?? 0, 0, 500)),
        filterType: ['none','lowpass','highpass','bandpass'].includes(raw.filterType) ? raw.filterType : 'none',
        filterHz: Math.round(clamp(raw.filterHz ?? 4200, 80, 12000)),
        layerSample: String(raw.layerSample || '').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0,48),
        layerGain: clamp(raw.layerGain ?? 0, 0, 1.5), layerRate: clamp(raw.layerRate ?? 1, 0.5, 2)
      };
      base.entityAudio[key] = row;
    }
  }
  for (const action of ACTIONS) {
    const src = input.actions?.[action.id];
    const dst = base.actions[action.id];
    if (!src || typeof src !== 'object') continue;
    dst.enabled = src.enabled !== false;
    dst.solo = !!src.solo;
    for (const key of ['particles', 'camera', 'flash', 'actorFlash', 'worldFlash', 'hitStop', 'spriteImpulse', 'foregroundDust', 'knockback', 'hudImpulse', 'heroPose', 'attachedEmitter', 'poseEmitter', 'audio']) {
      if (src[key] && typeof src[key] === 'object') Object.assign(dst[key], src[key]);
      dst[key].enabled = !!dst[key].enabled;
    }
    dst.particles.count = Math.round(clamp(dst.particles.count, 0, 64));
    dst.particles.speed = clamp(dst.particles.speed, 0, 160);
    dst.particles.lifeMs = clamp(dst.particles.lifeMs, 10, 2000);
    dst.particles.gravity = clamp(dst.particles.gravity, -200, 300);
    dst.particles.size = Math.round(clamp(dst.particles.size, 1, 16));
    dst.particles.shape = ['block','puff'].includes(dst.particles.shape) ? dst.particles.shape : 'block';
    dst.particles.spawnRadius = Math.round(clamp(dst.particles.spawnRadius ?? 0, 0, 24));
    dst.particles.emitterWidth = Math.round(clamp(dst.particles.emitterWidth ?? 1, 1, 64));
    dst.particles.emitterHeight = Math.round(clamp(dst.particles.emitterHeight ?? 1, 1, 64));
    dst.particles.shrink = !!dst.particles.shrink;
    dst.particles.tone = ['dust','smoke','spark'].includes(dst.particles.tone) ? dst.particles.tone : 'dust';
    dst.camera.amplitude = clamp(dst.camera.amplitude, 0, 12);
    dst.camera.durationMs = clamp(dst.camera.durationMs, 0, 1200);
    dst.camera.impactLinked = !!dst.camera.impactLinked;
    dst.camera.impactMinScale = clamp(dst.camera.impactMinScale ?? 0.35, 0, 1);
    dst.camera.impactExponent = clamp(dst.camera.impactExponent ?? 1, 0.25, 4);
    dst.flash.alpha = clamp(dst.flash.alpha, 0, 1);
    dst.flash.durationMs = clamp(dst.flash.durationMs, 0, 800);
    dst.flash.radius = clamp(dst.flash.radius, 1, 80);
    dst.actorFlash.color = dst.actorFlash.color === 'red' ? 'red' : 'white';
    dst.actorFlash.frames = Math.round(clamp(dst.actorFlash.frames, 0, 5));
    dst.actorFlash.alpha = clamp(dst.actorFlash.alpha, 0, 1);
    dst.flash.targetMode = ['area','foreground','background','nearby-actors','target-actor'].includes(dst.flash.targetMode) ? dst.flash.targetMode : 'area';
    dst.hudImpulse.resourceScope = ['event','bullet','dynamite','life','all'].includes(dst.hudImpulse.resourceScope) ? dst.hudImpulse.resourceScope : 'event';
    dst.worldFlash.color = dst.worldFlash.color === 'red' ? 'red' : dst.worldFlash.color === 'gray' ? 'gray' : 'white';
    dst.worldFlash.backgroundColor = ['white','off-white','faint-white','gray','red'].includes(dst.worldFlash.backgroundColor) ? dst.worldFlash.backgroundColor : 'off-white';
    dst.worldFlash.backgroundAlphaScale = clamp(dst.worldFlash.backgroundAlphaScale, 0, 1);
    dst.worldFlash.frames = Math.round(clamp(dst.worldFlash.frames, 0, 5));
    dst.worldFlash.alpha = clamp(dst.worldFlash.alpha, 0, 1);
    dst.worldFlash.radius = Math.round(clamp(dst.worldFlash.radius, 8, 160));
    dst.worldFlash.blockSize = Math.round(clamp(dst.worldFlash.blockSize, 4, 16));
    dst.worldFlash.ringWidth = Math.round(clamp(dst.worldFlash.ringWidth, 4, 64));
    const sourceWorldFlash = src.worldFlash || {};
    const legacyWorldFlashMask = sourceWorldFlash.foregroundOnly === true ? PRESENTATION_LAYER_MASK_PRESETS.inFrontOfActors : PRESENTATION_LAYER_MASK_PRESETS.allGameplay;
    const sourceWorldFlashMask = Object.prototype.hasOwnProperty.call(sourceWorldFlash,'layerMask') ? sourceWorldFlash.layerMask
      : Object.prototype.hasOwnProperty.call(sourceWorldFlash,'foregroundOnly') ? legacyWorldFlashMask : dst.worldFlash.layerMask;
    dst.worldFlash.layerMask = normalizePresentationLayerSelection(sourceWorldFlashMask, dst.worldFlash.layerMask);
    dst.worldFlash.foregroundDelayFrames = Math.round(clamp(dst.worldFlash.foregroundDelayFrames, 0, 8));
    dst.worldFlash.backgroundDelayFrames = Math.round(clamp(dst.worldFlash.backgroundDelayFrames, 0, 8));
    dst.hitStop.frames = Math.round(clamp(dst.hitStop.frames, 0, 5));
    dst.spriteImpulse.x = clamp(dst.spriteImpulse.x, -12, 12);
    dst.spriteImpulse.y = clamp(dst.spriteImpulse.y, -12, 12);
    dst.spriteImpulse.squash = clamp(dst.spriteImpulse.squash, -0.35, 0.35);
    dst.spriteImpulse.deformationMode = ['blitter-bands','translate','scale'].includes(dst.spriteImpulse.deformationMode) ? dst.spriteImpulse.deformationMode : 'blitter-bands';
    dst.spriteImpulse.bands = Math.round(clamp(dst.spriteImpulse.bands ?? 4, 2, 8));
    dst.spriteImpulse.deformationPixels = Math.round(clamp(dst.spriteImpulse.deformationPixels ?? 4, 0, 8));
    dst.spriteImpulse.degradeSprite = !!dst.spriteImpulse.degradeSprite;
    dst.spriteImpulse.degradationPx = Math.round(clamp(dst.spriteImpulse.degradationPx ?? 1, 0, 4));
    dst.spriteImpulse.durationMs = clamp(dst.spriteImpulse.durationMs, 0, 800);
    dst.foregroundDust.radius = Math.round(clamp(dst.foregroundDust.radius ?? 48, 8, 160));
    dst.foregroundDust.blockSize = Math.round(clamp(dst.foregroundDust.blockSize ?? 8, 4, 16));
    dst.foregroundDust.density = clamp(dst.foregroundDust.density ?? 0.3, 0, 1);
    dst.foregroundDust.speed = clamp(dst.foregroundDust.speed ?? 54, 0, 180);
    dst.foregroundDust.lifeMs = Math.round(clamp(dst.foregroundDust.lifeMs ?? 260, 40, 1200));
    dst.foregroundDust.gravity = clamp(dst.foregroundDust.gravity ?? 65, -100, 300);
    dst.foregroundDust.size = Math.round(clamp(dst.foregroundDust.size ?? 2, 1, 4));
    dst.foregroundDust.layerMask = normalizePresentationLayerSelection(src.foregroundDust?.layerMask ?? dst.foregroundDust.layerMask, PRESENTATION_LAYER_MASK_PRESETS.inFrontOfActors);
    dst.knockback.distance = clamp(dst.knockback.distance, 0, 16);
    dst.knockback.lift = clamp(dst.knockback.lift, -8, 8);
    dst.knockback.frames = Math.round(clamp(dst.knockback.frames, 0, 8));
    dst.hudImpulse.color = dst.hudImpulse.color === 'gray' ? 'gray' : dst.hudImpulse.color === 'red' ? 'red' : 'white';
    dst.hudImpulse.mask = dst.hudImpulse.mask === 'square' ? 'square' : 'sprite';
    dst.hudImpulse.pattern = ['tint','strobe','spark','cross','scan','hop'].includes(dst.hudImpulse.pattern) ? dst.hudImpulse.pattern : 'tint';
    dst.hudImpulse.frames = Math.round(clamp(dst.hudImpulse.frames, 0, 6));
    dst.hudImpulse.alpha = clamp(dst.hudImpulse.alpha, 0, 1);
    dst.hudImpulse.jitter = Math.round(clamp(dst.hudImpulse.jitter, 0, 3));
    dst.hudImpulse.staggerFrames = Math.round(clamp(dst.hudImpulse.staggerFrames, 0, 4));
    dst.heroPose.frame = ['event','shoot','staff','jump','crawl'].includes(dst.heroPose.frame) ? dst.heroPose.frame : 'event';
    dst.heroPose.holdMode = ['frames','while-fire','while-action'].includes(dst.heroPose.holdMode) ? dst.heroPose.holdMode : 'frames';
    dst.heroPose.frames = Math.round(clamp(dst.heroPose.frames ?? 2, 1, 12));
    const explicitPoses = Array.isArray(src.heroPose?.poses) ? src.heroPose.poses : Array.isArray(dst.heroPose.poses) ? dst.heroPose.poses : [];
    const legacyFrameIds = { shoot:10, staff:11, jump:6, crawl:7 };
    const legacyPose = { id:`legacy-${action.id}`, event:action.id, frameSource:dst.heroPose.frame === 'event' ? 'event' : 'frame', frameId:legacyFrameIds[dst.heroPose.frame] || 1, holdMode:dst.heroPose.holdMode, frames:dst.heroPose.frames };
    const poseInput = explicitPoses.length ? explicitPoses : ((src.heroPose?.enabled || dst.heroPose.enabled) ? [legacyPose] : []);
    dst.heroPose.poses = poseInput.slice(0, 12).map((raw, index) => {
      const event = ACTIONS.some(candidate => candidate.id === raw?.event) ? raw.event : action.id;
      const frameSource = raw?.frameSource === 'frame' ? 'frame' : 'event';
      const frameId = Math.round(clamp(raw?.frameId ?? legacyFrameIds[raw?.frame] ?? 1, 1, 0x1a));
      const holdMode = ['frames','while-fire','while-action'].includes(raw?.holdMode) ? raw.holdMode : 'frames';
      const frames = Math.round(clamp(raw?.frames ?? 2, 1, 12));
      return { id:String(raw?.id || `pose-${index + 1}`).replace(/[^a-zA-Z0-9_.:-]/g,'').slice(0,48) || `pose-${index + 1}`, event, frameSource, frameId, holdMode, frames };
    });
    dst.attachedEmitter.anchorX = Math.round(clamp(dst.attachedEmitter.anchorX ?? 25, 0, 31));
    dst.attachedEmitter.anchorY = Math.round(clamp(dst.attachedEmitter.anchorY ?? 9, 0, 20));
    dst.attachedEmitter.mirrorX = dst.attachedEmitter.mirrorX !== false;
    dst.attachedEmitter.emitterWidth = Math.round(clamp(dst.attachedEmitter.emitterWidth ?? 1, 1, 32));
    dst.attachedEmitter.emitterHeight = Math.round(clamp(dst.attachedEmitter.emitterHeight ?? 1, 1, 21));
    dst.attachedEmitter.count = Math.round(clamp(dst.attachedEmitter.count ?? 3, 0, 32));
    dst.attachedEmitter.speed = clamp(dst.attachedEmitter.speed ?? 18, 0, 160);
    dst.attachedEmitter.lifeMs = Math.round(clamp(dst.attachedEmitter.lifeMs ?? 260, 10, 2000));
    dst.attachedEmitter.spread = clamp(dst.attachedEmitter.spread ?? 0.35, 0, 2);
    dst.attachedEmitter.gravity = clamp(dst.attachedEmitter.gravity ?? -6, -200, 300);
    dst.attachedEmitter.size = Math.round(clamp(dst.attachedEmitter.size ?? 1, 1, 4));
    dst.attachedEmitter.tone = ['smoke','spark','dust'].includes(dst.attachedEmitter.tone) ? dst.attachedEmitter.tone : 'smoke';
    /* v2.1.86 combines the old pose-hold + standalone attached-emitter pair
     * into event-driven pose-attached generators. Legacy profiles/templates
     * migrate losslessly: the pose is used only as an anchor-authoring frame;
     * runtime never forces/holds the sprite anymore. */
    const explicitPoseEmitters = Array.isArray(src.poseEmitter?.bindings) ? src.poseEmitter.bindings : Array.isArray(dst.poseEmitter?.bindings) ? dst.poseEmitter.bindings : [];
    let poseEmitterInput = explicitPoseEmitters;
    if (!poseEmitterInput.length && (src.heroPose?.enabled || dst.heroPose.enabled || src.attachedEmitter?.enabled || dst.attachedEmitter.enabled)) {
      const legacyPoses = dst.heroPose.poses.length ? dst.heroPose.poses : [{ id:`legacy-${action.id}`, event:action.id, frameSource:'event', frameId:1, holdMode:'frames', frames:2 }];
      poseEmitterInput = legacyPoses.map((pose,index) => ({
        id:`${pose.id || `legacy-${index+1}`}-generator`, event:pose.event || action.id,
        holdMode:pose.holdMode || 'frames', frames:pose.frames || 2,
        classicFrameSource:pose.frameSource === 'frame' ? 'frame' : 'event', classicFrameId:pose.frameId || 1,
        rdxFrameSource:'event', rdxPn:0x63, rdxFrameIndex:0,
        emitter:{ ...dst.attachedEmitter, enabled:dst.attachedEmitter.enabled !== false }
      }));
    }
    dst.poseEmitter.enabled = src.poseEmitter?.enabled != null ? !!src.poseEmitter.enabled : poseEmitterInput.length > 0;
    const poseEmitterIds = new Set();
    dst.poseEmitter.bindings = poseEmitterInput.slice(0, MAX_POSE_EMITTER_BINDINGS).map((raw,index) => {
      const event = ACTIONS.some(candidate => candidate.id === raw?.event) ? raw.event : action.id;
      const holdMode = ['frames','while-fire','while-action'].includes(raw?.holdMode) ? raw.holdMode : 'frames';
      const frames = Math.round(clamp(raw?.frames ?? 2, 1, 60));
      const emitterRaw = raw?.emitter || {};
      const emitter = {
        enabled: emitterRaw.enabled !== false,
        anchorX: Math.round(clamp(emitterRaw.anchorX ?? 25, 0, 31)),
        anchorY: Math.round(clamp(emitterRaw.anchorY ?? 9, 0, 20)),
        mirrorX: emitterRaw.mirrorX !== false,
        flipH: !!emitterRaw.flipH, flipV: !!emitterRaw.flipV,
        refX: Math.round(clamp(emitterRaw.refX ?? 0, 0, 31)), refY: Math.round(clamp(emitterRaw.refY ?? 0, 0, 20)),
        refW: 32, refH: 21,
        emitterWidth: Math.round(clamp(emitterRaw.emitterWidth ?? 1, 1, 32)), emitterHeight: Math.round(clamp(emitterRaw.emitterHeight ?? 1, 1, 21)),
        count: Math.round(clamp(emitterRaw.count ?? 3, 0, 32)), speed: clamp(emitterRaw.speed ?? 18, 0, 160),
        lifeMs: Math.round(clamp(emitterRaw.lifeMs ?? 260, 10, 2000)), spread: clamp(emitterRaw.spread ?? .35, 0, 2),
        gravity: clamp(emitterRaw.gravity ?? -6, -200, 300), size: Math.round(clamp(emitterRaw.size ?? 1, 1, 4)),
        tone: ['smoke','spark','dust'].includes(emitterRaw.tone) ? emitterRaw.tone : 'smoke',
        playbackMode: emitterRaw.playbackMode === 'one-shot' ? 'one-shot' : 'loop',
        cadenceFrames: Math.round(clamp(emitterRaw.cadenceFrames ?? 3, 1, 30))
      };
      emitter.refW = Math.round(clamp(emitterRaw.refW ?? emitter.refW, 1, 32 - emitter.refX));
      emitter.refH = Math.round(clamp(emitterRaw.refH ?? emitter.refH, 1, 21 - emitter.refY));
      const rawId=String(raw?.id || `posegen-${index+1}`).replace(/[^a-zA-Z0-9_.:-]/g,'').slice(0,48) || `posegen-${index+1}`;
      let id=rawId,suffix=2;
      while(poseEmitterIds.has(id)){const tail=`-${suffix++}`;id=`${rawId.slice(0,Math.max(1,48-tail.length))}${tail}`;}
      poseEmitterIds.add(id);
      return {
        id,
        event, holdMode, frames, referenceDirection:Number(raw?.referenceDirection ?? 0) < 0 ? -1 : Number(raw?.referenceDirection ?? 0) > 0 ? 1 : 0,
        classicFrameSource:raw?.classicFrameSource === 'frame' ? 'frame' : 'event', classicFrameId:Math.round(clamp(raw?.classicFrameId ?? raw?.frameId ?? 1,1,0x1a)),
        rdxFrameSource:raw?.rdxFrameSource === 'frame' ? 'frame' : 'event', rdxPn:Math.round(clamp(raw?.rdxPn ?? 0x63,0,255)), rdxFrameIndex:Math.round(clamp(raw?.rdxFrameIndex ?? 0,0,255)),
        capturedPose:String(raw?.capturedPose || '').slice(0, 500000), emitter
      };
    });
    dst.audio.sample = String(dst.audio.sample || 'walk.wav').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 48) || 'walk.wav';
    const defaultAudioGain = Number(DEFAULT_PROFILE.actions[action.id]?.audio?.gain ?? 1);
    dst.audio.gain = clamp(dst.audio.gain == null ? defaultAudioGain : dst.audio.gain, 0, 1.5);
    dst.audio.pitchVariance = clamp(dst.audio.pitchVariance, 0, 0.2);
    dst.audio.rate = clamp(dst.audio.rate, 0.5, 2);
    dst.audio.pan = clamp(dst.audio.pan, -1, 1);
    dst.audio.panFromEvent = !!dst.audio.panFromEvent;
    dst.audio.attackMs = Math.round(clamp(dst.audio.attackMs ?? 0, 0, 250));
    dst.audio.releaseMs = Math.round(clamp(dst.audio.releaseMs ?? 0, 0, 500));
    dst.audio.filterType = ['none','lowpass','highpass','bandpass'].includes(dst.audio.filterType) ? dst.audio.filterType : 'none';
    dst.audio.filterHz = Math.round(clamp(dst.audio.filterHz ?? 4200, 80, 12000));
    dst.audio.layerSample = String(dst.audio.layerSample || '').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0,48);
    dst.audio.layerGain = clamp(dst.audio.layerGain ?? 0, 0, 1.5);
    dst.audio.layerRate = clamp(dst.audio.layerRate ?? 1, 0.5, 2);
  }
  base.schema = JUICE_SCHEMA;
  return base;
}

export function scaledValue(value, magnitude = 1, floor = 0) {
  const m = clamp(magnitude, 0, 1);
  return floor + (Number(value) - floor) * m;
}

export function estimateActionCost(actionRecipe) {
  if (!actionRecipe?.enabled) return { points: 0, grade: 'off', detail: [] };
  const detail = [];
  let points = 0;
  const add = (name, amount) => { if (amount > 0) { points += amount; detail.push({ name, points: amount }); } };
  if (actionRecipe.particles?.enabled) add('particles', EFFECT_COST.particles * Math.max(1, actionRecipe.particles.count / 4));
  if (actionRecipe.camera?.enabled) add('camera', EFFECT_COST.camera);
  if (actionRecipe.flash?.enabled) add('flash', EFFECT_COST.flash * Math.max(1, actionRecipe.flash.radius / 16));
  if (actionRecipe.actorFlash?.enabled) add('actor flash', EFFECT_COST.actorFlash * Math.max(1, actionRecipe.actorFlash.frames));
  if (actionRecipe.worldFlash?.enabled) add('foreground flash', EFFECT_COST.worldFlash * Math.max(1, actionRecipe.worldFlash.radius / 64));
  if (actionRecipe.hitStop?.enabled) add('hit-stop', EFFECT_COST.hitStop * actionRecipe.hitStop.frames);
  if (actionRecipe.spriteImpulse?.enabled) add('sprite impulse', EFFECT_COST.spriteImpulse);
  if (actionRecipe.foregroundDust?.enabled) add('foreground dust', EFFECT_COST.foregroundDust * Math.max(1, actionRecipe.foregroundDust.radius / 64));
  if (actionRecipe.knockback?.enabled) add('knockback', EFFECT_COST.knockback);
  if (actionRecipe.hudImpulse?.enabled) add('HUD impulse', EFFECT_COST.hudImpulse);
  if (actionRecipe.poseEmitter?.enabled) {
    const bindings=Array.isArray(actionRecipe.poseEmitter.bindings)?actionRecipe.poseEmitter.bindings:[];
    const active=bindings.filter(binding=>binding?.emitter?.enabled!==false);
    const particleWeight=active.reduce((sum,binding)=>sum+Math.max(1,Number(binding.emitter?.count||0)/4),0);
    if(active.length) add('pose-attached generators', EFFECT_COST.poseEmitter * particleWeight);
  }
  if (actionRecipe.audio?.enabled) add('audio', EFFECT_COST.audio);
  const grade = points < 1.5 ? 'tiny' : points < 3 ? 'low' : points < 5 ? 'medium' : points < 8 ? 'high' : 'very-high';
  return { points: Math.round(points * 100) / 100, grade, detail };
}

export function profileWorstCaseCost(profile) {
  let points = 0;
  let worst = { action: '', points: 0, grade: 'off' };
  for (const action of ACTIONS) {
    const result = estimateActionCost(profile.actions[action.id]);
    points += result.points;
    if (result.points > worst.points) worst = { action: action.id, ...result };
  }
  if (profile.motionTrail?.enabled) points += Math.min(8, Number(profile.motionTrail.copies) || 0) * 0.12;
  return { totalPoints: Math.round(points * 100) / 100, worst };
}
