import { DEFAULT_PROFILE, createDefaultActionRecipe } from './juice-protocol.js';
import { PRESENTATION_LAYER_MASK_PRESETS } from './presentation-layer-mask.js';

/*
 * Original Game Juice Editor templates. The named whole-game styles are
 * inspired by broad feedback signatures of popular games; they do not copy
 * assets, code or claimed exact timings. Curated templates use the production
 * candidate vocabulary: opaque/masked pixels and sprites, palette/tile-like
 * flashes, 1:1 blitter-band displacement, bounded particles and short sample
 * playback. The editor may still author enhanced comparison settings manually;
 * those are labelled separately by the compatibility UI.
 */

function template(id, label, cost, summary, values, recommendedFor = []) {
  return Object.freeze({ id, label, cost, summary, values: Object.freeze(values), recommendedFor: Object.freeze(recommendedFor) });
}

export const EFFECT_TEMPLATES = Object.freeze({
  particles: Object.freeze([
    template('off','Off','zero','No particles.',{enabled:false,count:0}),
    template('micro-dust','Micro dust','tiny','Two short 2px flecks.',{enabled:true,count:2,speed:12,lifeMs:110,spread:.8,gravity:28,size:2},['player.step','player.jump','dynamite.place']),
    template('dust-kick','Dust kick','tiny','Four short contact pixels.',{enabled:true,count:4,speed:22,lifeMs:150,spread:1,gravity:38,size:2},['player.turn','player.land']),
    template('grounded-turn-dust','Grounded turn dust','tiny','Four short masked 4px dust puffs for a grounded direction change.',{enabled:true,count:4,speed:22,lifeMs:230,spread:1,gravity:20,size:4,shape:'puff',spawnRadius:3,shrink:false,tone:'dust'},['player.turn']),
    template('takeoff-puff','Takeoff puff','low','Six opaque 4px smoke puffs mark the foot contact and shrink away over seven frames.',{enabled:true,count:6,speed:18,lifeMs:280,spread:1.4,gravity:40,size:4,shape:'puff',spawnRadius:4,emitterWidth:10,emitterHeight:2,shrink:true,tone:'smoke'},['player.jump']),
    template('wall-dust','Wall dust trickle','tiny','Three gravity-led pixels pushed away from the wall.',{enabled:true,count:3,speed:11,lifeMs:220,spread:.45,gravity:80,size:2},['player.wall_hug']),
    template('hat-dust','Hat-edge dust','tiny','Two flecks at head height for projectile near misses.',{enabled:true,count:2,speed:16,lifeMs:145,spread:.75,gravity:55,size:2},['projectile.near_miss']),
    template('crisp-sparks','Crisp sparks','low','Four fast short-lived pixels for hard contacts.',{enabled:true,count:4,speed:44,lifeMs:115,spread:.72,gravity:18,size:2},['bullet.wall_hit','bullet.target_hit','dynamite.fuse']),
    template('impact-burst','Impact burst','low','Six compact hit pixels.',{enabled:true,count:6,speed:46,lifeMs:150,spread:1.05,gravity:30,size:2},['bullet.target_hit','enemy.stick_hit','dynamite.target_hit']),
    template('explosion-debris','Explosion debris','medium','Eight chunky blast fragments; deliberately much smaller than a modern particle cloud.',{enabled:true,count:8,speed:58,lifeMs:230,spread:1.55,gravity:58,size:3},['dynamite.explode']),
    template('pickup-smoke','Pickup smoke puff','low','Eight opaque masked 8px smoke BOBs cover the pickup transition, then disperse through fixed 8→4→1px stages.',{enabled:true,count:8,speed:8,lifeMs:250,spread:1.6,gravity:-25,size:8,shape:'puff',spawnRadius:8,shrink:true,tone:'smoke'},['pickup.collect']),
    template('platform-release-puff','Platform release puff','low','Eight masked 8px smoke puffs briefly hide the explosive release, then drift away without shrinking stages.',{enabled:true,count:8,speed:3,lifeMs:290,spread:1.2,gravity:-18,size:8,shape:'puff',spawnRadius:6,shrink:false,tone:'smoke'},['platform.release']),
    template('castle-blockage-chunks','Castle blockage chunks','low','Eight gray masonry chunks spawn across the full 32×21 blockage and fall quickly under gravity.',{enabled:true,count:8,speed:8,lifeMs:480,spread:.85,gravity:200,size:3,shape:'block',spawnRadius:0,emitterWidth:32,emitterHeight:21,shrink:false,tone:'smoke'},['blockage.crumble'])
  ]),

  camera: Object.freeze([
    template('off','Off','zero','No camera motion.',{enabled:false,amplitude:0,durationMs:0}),
    template('micro-tick','Micro tick','tiny','One-pixel short contact cue.',{enabled:true,amplitude:1,durationMs:48,frequency:19},['bullet.wall_hit']),
    template('recoil-tap','Recoil tap','tiny','Short one-pixel gun response that preserves aiming readability.',{enabled:true,amplitude:1.15,durationMs:58,frequency:17},['weapon.fire']),
    template('soft-impact','Soft impact','tiny','Readable one-pixel landing/hit response.',{enabled:true,amplitude:1.35,durationMs:76,frequency:15},['player.land','bullet.target_hit']),
    template('punchy-impact','Punchy impact','low','Brief visible shake for confirmed damage.',{enabled:true,amplitude:1.6,durationMs:82,frequency:29},['bullet.target_hit','player.projectile_hit','dynamite.target_hit']),
    template('heavy-impact','Heavy impact','low','Rare-event camera response.',{enabled:true,amplitude:2.6,durationMs:118,frequency:24},['dynamite.explode','player.explosion_hit'])
  ]),

  flash: Object.freeze([
    template('off','Off','zero','No localized contact flash.',{enabled:false,alpha:0,durationMs:0,radius:1,targetMode:'area'}),
    template('pinprick','Pinprick','tiny','Tiny opaque one-beat spark/contact square.',{enabled:true,alpha:1,durationMs:32,radius:4,targetMode:'area'},['dynamite.fuse','bullet.wall_hit']),
    template('muzzle','Muzzle flash','tiny','Compact opaque weapon flash.',{enabled:true,alpha:1,durationMs:40,radius:9,targetMode:'foreground'},['weapon.fire']),
    template('impact-mark','Impact mark','tiny','Localized opaque hit confirmation.',{enabled:true,alpha:1,durationMs:40,radius:9,targetMode:'target-actor'},['bullet.target_hit','enemy.stick_hit','dynamite.target_hit']),
    template('hard-hit','Hard hit','low','Larger opaque high-value impact square.',{enabled:true,alpha:1,durationMs:48,radius:15,targetMode:'target-actor'},['player.projectile_hit','player.explosion_hit']),
    template('explosion-core','Explosion core','low','Bright opaque local blast core.',{enabled:true,alpha:1,durationMs:55,radius:25},['dynamite.explode']),
    template('pickup-glint','Pickup glint','tiny','Small opaque positive reward flash.',{enabled:true,alpha:1,durationMs:48,radius:11},['pickup.collect'])
  ]),

  actorFlash: Object.freeze([
    template('off','Off','zero','Do not recolor the actor.',{enabled:false,color:'white',frames:0,alpha:0}),
    template('white-1f','White · 1 frame','tiny','One-frame white silhouette; ideal old-school hit feedback.',{enabled:true,color:'white',frames:1,alpha:1},['bullet.target_hit','enemy.stick_hit','dynamite.target_hit']),
    template('white-2f','White · 2 frames','tiny','Stronger two-frame white hit.',{enabled:true,color:'white',frames:2,alpha:1},['dynamite.target_hit']),
    template('red-1f','Red · 1 frame','tiny','One-frame red damage silhouette.',{enabled:true,color:'red',frames:1,alpha:1},['player.projectile_hit']),
    template('red-2f','Red · 2 frames','tiny','Two-frame opaque red hero damage flash.',{enabled:true,color:'red',frames:2,alpha:1},['player.explosion_hit'])
  ]),

  worldFlash: Object.freeze([
    template('off','Off','zero','No environment flash.',{enabled:false,frames:0,alpha:0,radius:8,blockSize:8,ringWidth:8,layerMask:[...PRESENTATION_LAYER_MASK_PRESETS.allGameplay],foregroundDelayFrames:0,backgroundDelayFrames:1,backgroundColor:'off-white',backgroundAlphaScale:1}),
    template('white-ring-1f','White block ring · 1f','tiny','Opaque foreground ring first, palette-tone background echo one frame later.',{enabled:true,color:'white',frames:1,alpha:1,radius:56,blockSize:8,ringWidth:16,layerMask:[...PRESENTATION_LAYER_MASK_PRESETS.allGameplay],foregroundDelayFrames:0,backgroundDelayFrames:1,backgroundColor:'off-white',backgroundAlphaScale:1},['dynamite.explode']),
    template('white-ripple-2f','White block ripple · 2f','tiny','Two-frame opaque 8px ripple with a one-frame background delay.',{enabled:true,color:'white',frames:2,alpha:1,radius:76,blockSize:8,ringWidth:18,layerMask:[...PRESENTATION_LAYER_MASK_PRESETS.allGameplay],foregroundDelayFrames:0,backgroundDelayFrames:1,backgroundColor:'off-white',backgroundAlphaScale:1},['dynamite.explode']),
    template('white-ripple-3f','White + gray block ripple · 3f','low','Longer opaque old-school spatial flash: white foreground decorations lead, gray backdrop tiles echo two frames later, while actors and authored midground stay untouched.',{enabled:true,color:'white',frames:3,alpha:1,radius:104,blockSize:8,ringWidth:22,layerMask:[...PRESENTATION_LAYER_MASK_PRESETS.sceneryWithoutMidground],foregroundDelayFrames:0,backgroundDelayFrames:2,backgroundColor:'gray',backgroundAlphaScale:1},['dynamite.explode']),
    template('red-ring-1f','Red block ring · 1f','tiny','Opaque damage-coloured environment accent; use sparingly.',{enabled:true,color:'red',frames:1,alpha:1,radius:48,blockSize:8,ringWidth:16,layerMask:[...PRESENTATION_LAYER_MASK_PRESETS.allGameplay],foregroundDelayFrames:0,backgroundDelayFrames:1,backgroundColor:'off-white',backgroundAlphaScale:1},['player.explosion_hit'])
  ]),

  hitStop: Object.freeze([
    template('off','Off','zero','No frame hold.',{enabled:false,frames:0}),
    template('micro-1f','Micro · 1 frame','tiny','40 ms at 25 Hz.',{enabled:true,frames:1},['bullet.target_hit','dynamite.target_hit','player.projectile_hit']),
    template('impact-2f','Impact · 2 frames','tiny','80 ms; reserve for heavy events.',{enabled:true,frames:2},['dynamite.explode','player.explosion_hit']),
    template('heavy-3f','Heavy · 3 frames','tiny','120 ms strong comparison.',{enabled:true,frames:3},['dynamite.explode']),
    template('dramatic-4f','Dramatic · 4 frames','low','160 ms; diagnostic/rare finishing impact only.',{enabled:true,frames:4},['dynamite.explode']),
    template('max-5f','Maximum · 5 frames','low','200 ms editor upper bound; deliberately excessive for comparison.',{enabled:true,frames:5},['dynamite.explode'])
  ]),

  spriteImpulse: Object.freeze([
    template('off','Off','zero','No temporary actor deformation.',{enabled:false,x:0,y:0,squash:0,durationMs:0,deformationMode:'blitter-bands'}),
    template('micro-nudge','Micro nudge','tiny','One-pixel positional response.',{enabled:true,x:-1,y:0,squash:0,durationMs:65,deformationMode:'blitter-bands'},['player.turn','dynamite.place']),
    template('gun-recoil','Gun recoil','tiny','Two-pixel opposite-facing recoil.',{enabled:true,x:-2,y:0,squash:-.02,durationMs:55,deformationMode:'blitter-bands'},['weapon.fire']),
    template('jump-stretch','Jump stretch','tiny','Small takeoff stretch.',{enabled:true,x:0,y:1,squash:-.06,durationMs:80,deformationMode:'blitter-bands'},['player.jump']),
    template('takeoff-lift','Takeoff lift','tiny','Two-pixel upward sprite nudge over three frames.',{enabled:true,x:0,y:-2,squash:0,durationMs:120,deformationMode:'translate'},['player.jump']),
    template('apex-float','Apex float','tiny','Subtle apex compression.',{enabled:true,x:0,y:-1,squash:.03,durationMs:80,deformationMode:'blitter-bands'},['player.apex']),
    template('landing-squash','Landing squash','tiny','Visible but controlled foot-anchored compression.',{enabled:true,x:0,y:0,squash:.14,durationMs:95,deformationMode:'blitter-bands'},['player.land']),
    template('landing-hard','Hard landing squash','tiny','Stronger landing deformation.',{enabled:true,x:0,y:1,squash:.22,durationMs:115,deformationMode:'blitter-bands'},['player.land'])
  ]),

  foregroundDust: Object.freeze([
    template('off','Off','zero','No foreground debris.',{enabled:false,radius:48,blockSize:8,density:0,speed:0,lifeMs:0,gravity:0,size:1,layerMask:[...PRESENTATION_LAYER_MASK_PRESETS.inFrontOfActors]}),
    template('chips','Light block chips','tiny','Sparse foreground chips from nearby effectable blocks.',{enabled:true,radius:32,blockSize:8,density:.18,speed:34,lifeMs:180,gravity:60,size:1},['bullet.wall_hit']),
    template('rubble','Rubble burst','low','Compact 8px-aware foreground debris.',{enabled:true,radius:48,blockSize:8,density:.28,speed:48,lifeMs:240,gravity:68,size:2},['dynamite.target_hit']),
    template('blast','Blast debris','low','Broader foreground fragments for explosions.',{enabled:true,radius:64,blockSize:8,density:.34,speed:62,lifeMs:290,gravity:72,size:2},['dynamite.explode']),
    template('heavy','Heavy blast debris','medium','Dense but bounded old-school foreground breakup.',{enabled:true,radius:88,blockSize:8,density:.44,speed:74,lifeMs:340,gravity:82,size:2},['dynamite.explode'])
  ]),

  knockback: Object.freeze([
    template('off','Off','zero','No actor push-back.',{enabled:false,distance:0,lift:0,frames:0}),
    template('tiny','Tiny push','tiny','Two-pixel visual push for light projectile hits.',{enabled:true,distance:2,lift:0,frames:2},['bullet.target_hit']),
    template('medium','Medium push','tiny','Four-pixel push with a one-pixel lift.',{enabled:true,distance:4,lift:-1,frames:3},['bullet.target_hit','player.projectile_hit']),
    template('blast','Blast push','tiny','Six-pixel push and small lift, suitable for dynamite.',{enabled:true,distance:6,lift:-2,frames:3},['dynamite.target_hit','player.explosion_hit']),
    template('heavy-blast','Heavy blast push','tiny','Eight-pixel upper bound for blast feedback.',{enabled:true,distance:8,lift:-3,frames:4},['player.explosion_hit'])
  ]),

  hudImpulse: Object.freeze([
    template('off','Off','zero','No HUD feedback.',{enabled:false,color:'white',frames:0,alpha:0,jitter:0,pattern:'tint',resourceScope:'event'}),
    template('white-fade','White inventory flash','tiny','Opaque two-frame inventory-token palette flash.',{enabled:true,color:'white',frames:2,alpha:1,jitter:0,pattern:'tint',resourceScope:'event'},['ammo.collect','points.collect']),
    template('gray-fade','Gray inventory flash','tiny','Opaque gray two-frame token palette flash; quieter than white.',{enabled:true,color:'gray',frames:2,alpha:1,jitter:0,pattern:'tint',resourceScope:'event'},['ammo.deplete']),
    template('white-jitter','White + 1px jitter','tiny','Opaque token flash plus one-pixel alternating offset.',{enabled:true,color:'white',frames:2,alpha:1,jitter:1,pattern:'tint',resourceScope:'event'},['ammo.deplete','ammo.collect','points.collect']),
    template('spent-cross','Spent token cross','tiny','Three-frame gray pixel X over the consumed HUD slot; readable even after the token disappears.',{enabled:true,color:'gray',frames:3,alpha:1,jitter:0,pattern:'cross',resourceScope:'event'},['ammo.deplete']),
    template('deplete-scan','Depletion scan','tiny','A short gray raster bar sweeps down the consumed 8px slot.',{enabled:true,color:'gray',frames:4,alpha:1,jitter:0,pattern:'scan',resourceScope:'event'},['ammo.deplete']),
    template('warning-strobe','Warning strobe','tiny','Alternating red token/square strobe for scarce-resource comparison.',{enabled:true,color:'red',mask:'square',frames:4,alpha:1,jitter:0,pattern:'strobe',resourceScope:'event'},['ammo.deplete']),
    template('pickup-spark','Pickup sparkle','tiny','White token flash with four tiny cardinal pixel sparks.',{enabled:true,color:'white',frames:3,alpha:1,jitter:0,pattern:'spark',resourceScope:'event'},['ammo.collect','points.collect']),
    template('token-hop','Token hop','tiny','The newly collected token makes a four-frame 1–2px masked hop, with no scaling.',{enabled:true,color:'white',frames:4,alpha:1,jitter:0,pattern:'hop',resourceScope:'event'},['ammo.collect']),
    template('refill-wave','Refill wave','tiny','Sparkle each restored token one frame apart for a compact refill cascade.',{enabled:true,color:'white',frames:3,alpha:1,jitter:0,staggerFrames:1,pattern:'spark',resourceScope:'event'},['ammo.collect']),
    template('hard-jitter','Bright + 2px jitter','tiny','Strong opaque HUD confirmation for A/B comparison.',{enabled:true,color:'white',frames:3,alpha:1,jitter:2,pattern:'tint',resourceScope:'all'},['ammo.deplete','ammo.collect','points.collect'])
  ]),

  heroPose: Object.freeze([
    template('off','Off','zero','Do not hold a hero pose.',{enabled:false,frame:'event',holdMode:'frames',frames:2}),
    template('shot-hold','Hold firing pose','tiny','Keep the captured firing frame while FIRE remains held.',{enabled:true,frame:'shoot',holdMode:'while-fire',frames:2,poses:[{id:'shoot',event:'weapon.fire',frameSource:'event',frameId:10,holdMode:'while-fire',frames:2}]},['weapon.fire']),
    template('staff-hold','Hold staff pose','tiny','Keep the Classic stop/staff pose while the action remains active.',{enabled:true,frame:'staff',holdMode:'while-action',frames:2,poses:[{id:'staff',event:'player.staff_hold',frameSource:'event',frameId:11,holdMode:'while-action',frames:2}]},['player.staff_hold']),
    template('impact-2f','Impact frame · 2f','tiny','Hold the event frame for two simulation frames.',{enabled:true,frame:'event',holdMode:'frames',frames:2})
  ]),

  attachedEmitter: Object.freeze([
    template('off','Off','zero','No sprite-attached generator.',{enabled:false,count:0}),
    template('gun-smoke','Gun muzzle smoke','tiny','Three short gray pixels from a sprite-relative muzzle anchor.',{enabled:true,anchorX:26,anchorY:9,mirrorX:true,count:3,speed:16,lifeMs:280,spread:.35,gravity:-5,size:1,tone:'smoke'},['weapon.fire']),
    template('gun-spark','Gun muzzle spark','tiny','Two fast bright pixels from the muzzle.',{enabled:true,anchorX:27,anchorY:9,mirrorX:true,count:2,speed:36,lifeMs:80,spread:.22,gravity:0,size:1,tone:'spark'},['weapon.fire']),
    template('staff-spark','Staff-tip spark','tiny','Two compact bright pixels attached to the Classic staff-tip anchor.',{enabled:true,anchorX:26,anchorY:6,mirrorX:true,count:2,speed:12,lifeMs:110,spread:.9,gravity:0,size:1,tone:'spark'},['player.staff_hold'])
  ]),

  poseEmitter: Object.freeze([
    template('off','Off','zero','No pose-attached generators.',{enabled:false,bindings:[]}),
    template('gun-smoke','Gun smoke generator','tiny','Six bounded smoke pixels burst from the authored firing-pose muzzle anchor for two 25 Hz frames.',{enabled:true,bindings:[{id:'gun-smoke',event:'weapon.fire',holdMode:'frames',frames:2,classicFrameSource:'frame',classicFrameId:22,rdxFrameSource:'frame',rdxPn:0x5b,rdxFrameIndex:0,referenceDirection:1,emitter:{enabled:true,anchorX:21,anchorY:8,mirrorX:true,flipH:false,flipV:false,refX:6,refY:0,refW:21,refH:21,count:6,speed:12,lifeMs:660,spread:.35,gravity:-30,size:3,tone:'smoke',playbackMode:'loop',cadenceFrames:3}}]},['weapon.fire']),
    template('gun-spark','Gun spark generator','tiny','Emit compact sparks from the muzzle while the firing action is held.',{enabled:true,bindings:[{id:'gun-spark',event:'weapon.fire',holdMode:'while-fire',frames:2,classicFrameSource:'frame',classicFrameId:22,rdxFrameSource:'frame',rdxPn:0x5b,rdxFrameIndex:0,referenceDirection:1,emitter:{enabled:true,anchorX:27,anchorY:9,mirrorX:true,flipH:false,flipV:false,count:2,speed:36,lifeMs:80,spread:.22,gravity:0,size:1,tone:'spark',playbackMode:'loop',cadenceFrames:2}}]},['weapon.fire']),
    template('staff-spark','Staff-tip spark generator','tiny','Emit bright pixels from the staff tip while the stop/staff action remains active.',{enabled:true,bindings:[{id:'staff-spark',event:'player.staff_hold',holdMode:'while-action',frames:2,classicFrameSource:'frame',classicFrameId:23,rdxFrameSource:'event',rdxPn:0x63,rdxFrameIndex:0,referenceDirection:1,emitter:{enabled:true,anchorX:26,anchorY:6,mirrorX:true,flipH:false,flipV:false,count:2,speed:12,lifeMs:110,spread:.9,gravity:0,size:1,tone:'spark',playbackMode:'loop',cadenceFrames:2}}]},['player.staff_hold'])
  ]),

  audio: Object.freeze([
    template('off','Off','zero','No extra editor accent. Native Amiga audio remains authoritative.',{enabled:false,gain:0}),
    template('near-miss-air','Near-miss air','tiny','Optional panned fly-by accent layered on top of native audio.',{enabled:true,sample:'ent8.wav',gain:.22,pitchVariance:.02,rate:1.05,pan:0,panFromEvent:true},['projectile.near_miss']),
    template('near-miss-crack','Near-miss snap','tiny','Sharper panned fly-by accent.',{enabled:true,sample:'ent8.wav',gain:.3,pitchVariance:.03,rate:1.12,pan:0,panFromEvent:true},['projectile.near_miss']),
    template('pickup-ping','Pickup accent','tiny','Optional extra positive confirmation.',{enabled:true,sample:'bonus.wav',gain:.28,pitchVariance:.01,rate:1,pan:0,panFromEvent:false},['pickup.collect']),
    template('impact-tick','Impact tick','tiny','Optional compact hit accent; keep off when native hit sound is sufficient.',{enabled:true,sample:'box.wav',gain:.2,pitchVariance:.015,rate:1.08,pan:0,panFromEvent:true},['bullet.target_hit']),
    template('stick-hit-thud','Stick hit thud','tiny','Optional short low contact thud retaining a trimmed Rick 1 stick transient; disabled by default.',{enabled:true,sample:'stick_hit.wav',gain:.42,pitchVariance:.015,rate:1,pan:0,panFromEvent:true},['enemy.stick_hit']),
    template('blast-tail','Blast tail','tiny','Optional quiet secondary blast accent for A/B audition only.',{enabled:true,sample:'explode.wav',gain:.16,pitchVariance:0,rate:.92,pan:0,panFromEvent:false},['dynamite.explode'])
  ])
});

function actionTemplate(id, label, summary, parts) {
  return Object.freeze({ id, label, summary, parts: Object.freeze(parts) });
}

export const ACTION_TEMPLATES = Object.freeze({
  'player.step': Object.freeze([
    actionTemplate('raw','Raw','No editor layer.',{}),
    actionTemplate('minimal','Micro dust','Two pixels only.',{particles:'micro-dust'}),
    actionTemplate('tactile','Tactile step','Micro dust plus one-pixel actor nudge.',{particles:'micro-dust',spriteImpulse:'micro-nudge'})
  ]),
  'player.turn': Object.freeze([
    actionTemplate('raw','Raw','No editor layer.',{}),
    actionTemplate('skid','Skid','Small dust + nudge.',{particles:'dust-kick',spriteImpulse:'micro-nudge'}),
    actionTemplate('grounded-skid','Grounded skid','Masked 4px dust puffs + nudge for grounded direction changes.',{particles:'grounded-turn-dust',spriteImpulse:'micro-nudge'}),
    actionTemplate('nudge','Nudge only','One-pixel direction-change response without particles.',{spriteImpulse:'micro-nudge'})
  ]),
  'player.jump': Object.freeze([
    actionTemplate('raw','Raw','No editor layer.',{}),
    actionTemplate('classic','Classic takeoff','Sprite stretch only.',{spriteImpulse:'jump-stretch'}),
    actionTemplate('cd32-puff','CD32 takeoff puff','Compact gray foot puffs + a three-frame upward sprite nudge.',{particles:'takeoff-puff',spriteImpulse:'takeoff-lift'}),
    actionTemplate('grounded','Grounded takeoff','Tiny dust + stretch.',{particles:'micro-dust',spriteImpulse:'jump-stretch'})
  ]),
  'player.bounce_back': Object.freeze([
    actionTemplate('raw','Raw','No extra rebound feedback.',{})
  ]),
  'player.apex': Object.freeze([
    actionTemplate('pure','Pure','No apex cue.',{}),
    actionTemplate('float','Apex float','Very small sprite response.',{spriteImpulse:'apex-float'}),
    actionTemplate('dustless','Dustless accent','Apex compression plus micro camera tick.',{spriteImpulse:'apex-float',camera:'micro-tick'})
  ]),
  'player.land': Object.freeze([
    actionTemplate('soft','Soft','Landing squash only.',{spriteImpulse:'landing-squash'}),
    actionTemplate('responsive','Responsive','Dust + squash, no hit-stop.',{particles:'dust-kick',spriteImpulse:'landing-squash'}),
    actionTemplate('hard','Hard','Hard squash + soft camera.',{particles:'dust-kick',camera:'soft-impact',spriteImpulse:'landing-hard'})
  ]),
  'player.wall_hug': Object.freeze([
    actionTemplate('quiet','Quiet','No continuous wall effect.',{}),
    actionTemplate('dust','Dust trickle','Three falling wall flecks.',{particles:'wall-dust'}),
    actionTemplate('scrape','Tactile scrape','Wall dust plus tiny body nudge; no continuous emitter.',{particles:'wall-dust',spriteImpulse:'micro-nudge'})
  ]),
  'player.staff_hold': Object.freeze([
    actionTemplate('raw','Raw staff pose','No extra feedback.',{}),
    actionTemplate('spark','Staff-tip spark','Attach a tiny repeating spark generator to the staff pose.',{poseEmitter:'staff-spark'})
  ]),
  'weapon.fire': Object.freeze([
    actionTemplate('classic','Classic shot','Muzzle flash and recoil.',{flash:'muzzle',spriteImpulse:'gun-recoil'}),
    actionTemplate('crisp','Crisp shot','Compact muzzle flash + recoil.',{flash:'muzzle',spriteImpulse:'gun-recoil'}),
    actionTemplate('retro','Retro punch','Muzzle flash and one-pixel recoil.',{flash:'muzzle',spriteImpulse:'gun-recoil'}),
    actionTemplate('retro-smoke','Retro punch + pose smoke','Amiga/CD32 shot feedback plus the bounded firing-pose smoke generator.',{flash:'muzzle',spriteImpulse:'gun-recoil',poseEmitter:'gun-smoke'}),
    actionTemplate('punchy','Punchy shot','Adds a very small camera tick to muzzle flash and recoil.',{camera:'recoil-tap',flash:'muzzle',spriteImpulse:'gun-recoil'}),
    actionTemplate('smoke-hold','Smoke while firing','Attach a repeating muzzle-smoke generator to the firing pose while FIRE is held.',{flash:'muzzle',spriteImpulse:'gun-recoil',poseEmitter:'gun-smoke'})
  ]),
  'bullet.wall_hit': Object.freeze([
    actionTemplate('chip','Chip','Pinprick only.',{flash:'pinprick'}),
    actionTemplate('spark','Spark','Four sparks + pinprick.',{particles:'crisp-sparks',flash:'pinprick'}),
    actionTemplate('tick','Tick','Flash + micro camera.',{camera:'micro-tick',flash:'pinprick'})
  ]),
  'bullet.target_hit': Object.freeze([
    actionTemplate('clean','Clean white hit','White 1f + tiny push; no particles.',{actorFlash:'white-1f',knockback:'tiny'}),
    actionTemplate('freeze','Freeze + white','White 1f, 1f stop and medium push.',{actorFlash:'white-1f',hitStop:'micro-1f',knockback:'medium'}),
    actionTemplate('punchy','Punchy confirmed hit','White flash, stop, push, small contact square and camera.',{camera:'soft-impact',flash:'impact-mark',actorFlash:'white-1f',hitStop:'micro-1f',knockback:'medium'}),
    actionTemplate('sparks','Spark hit','Add six bounded impact pixels.',{particles:'impact-burst',flash:'impact-mark',actorFlash:'white-1f',knockback:'medium'}),
    actionTemplate('white-heavy','White heavy','Two-frame white silhouette + 2f stop + medium push.',{actorFlash:'white-2f',hitStop:'impact-2f',knockback:'medium'}),
    actionTemplate('red-damage','Red enemy damage','One-frame red silhouette + medium push for an alternate damage language.',{actorFlash:'red-1f',knockback:'medium'})
  ]),
  'enemy.stick_hit': Object.freeze([
    actionTemplate('quiet','Quiet stop','Classic stick stun with no added feedback.',{}),
    actionTemplate('flash','White stop','One-frame white enemy silhouette.',{actorFlash:'white-1f'}),
    actionTemplate('cd32','CD32 white stop','One-frame white enemy silhouette; no added sound by default.',{actorFlash:'white-1f'}),
    actionTemplate('stick-thud','White + low thud','One-frame white enemy silhouette plus the optional immediate low contact thud.',{actorFlash:'white-1f',audio:'stick-hit-thud'})
  ]),
  'player.projectile_hit': Object.freeze([
    actionTemplate('red','Red damage','Red 1f + medium push.',{actorFlash:'red-1f',knockback:'medium'}),
    actionTemplate('freeze','Damage freeze','Red flash, one-frame stop and push.',{actorFlash:'red-1f',hitStop:'micro-1f',knockback:'medium'}),
    actionTemplate('impact','Heavy damage','Red flash, stop, hard local flash and camera.',{camera:'punchy-impact',flash:'hard-hit',actorFlash:'red-2f',hitStop:'micro-1f',knockback:'medium'})
  ]),
  'projectile.near_miss': Object.freeze([
    actionTemplate('quiet','Silent near miss','Projectile alone is the warning.',{}),
    actionTemplate('hat-dust','Hat dust','Two pixels from Rick’s hat.',{particles:'hat-dust'}),
    actionTemplate('stereo','Stereo fly-by','Panned optional accent.',{audio:'near-miss-air'}),
    actionTemplate('snap','Dust + stereo','Two pixels + panned snap.',{particles:'hat-dust',audio:'near-miss-crack'})
  ]),
  'dynamite.place': Object.freeze([
    actionTemplate('raw','Raw','Native placement only.',{}),
    actionTemplate('ui','Clean placement','Native placement only; HUD consumption is authored in the HUD inventory tool.',{}),
    actionTemplate('tactile','Tactile','Micro dust and a one-pixel body nudge.',{particles:'micro-dust',spriteImpulse:'micro-nudge'})
  ]),
  'dynamite.fuse': Object.freeze([
    actionTemplate('minimal','Minimal spark','Pinprick only.',{flash:'pinprick'}),
    actionTemplate('spark','Spark spit','Four tiny sparks + pinprick.',{particles:'crisp-sparks',flash:'pinprick'}),
    actionTemplate('flash','Flash only','Single compact fuse flash; zero particles.',{flash:'muzzle'})
  ]),
  'dynamite.explode': Object.freeze([
    actionTemplate('palette','Palette blast','Local core + one-frame block ring; zero particles.',{flash:'explosion-core',worldFlash:'white-ring-1f',hitStop:'micro-1f'}),
    actionTemplate('ripple','Block ripple','Two-frame foreground ripple, local core and camera.',{camera:'punchy-impact',flash:'explosion-core',worldFlash:'white-ripple-2f',hitStop:'micro-1f'}),
    actionTemplate('retro-heavy','Retro heavy blast','Three-frame opaque white/gray tile ripple and two-frame stop; no alpha core or particle cloud.',{camera:'heavy-impact',worldFlash:'white-ripple-3f',hitStop:'impact-2f'}),
    actionTemplate('debris','Debris blast','Adds bounded chunks plus real foreground debris.',{particles:'explosion-debris',foregroundDust:'blast',camera:'punchy-impact',flash:'explosion-core',worldFlash:'white-ring-1f',hitStop:'micro-1f'})
  ]),
  'ammo.explode': Object.freeze([
    actionTemplate('palette','Crate palette pop','Compact one-frame block flash and local core.',{flash:'explosion-core',worldFlash:'white-ring-1f',hitStop:'micro-1f'}),
    actionTemplate('ripple','Crate ripple','Small old-school ripple and camera tap.',{camera:'soft-impact',flash:'explosion-core',worldFlash:'white-ripple-2f',hitStop:'micro-1f'}),
    actionTemplate('debris','Crate debris','A few chunky fragments plus compact blast flash.',{particles:'impact-burst',flash:'explosion-core',worldFlash:'white-ring-1f',hitStop:'micro-1f'})
  ]),
  'dynamite.target_hit': Object.freeze([
    actionTemplate('white','White blast hit','Two-frame white enemy flash + blast push.',{actorFlash:'white-2f',knockback:'blast'}),
    actionTemplate('freeze','Blast freeze','White flash, one-frame stop, blast push.',{flash:'impact-mark',actorFlash:'white-2f',hitStop:'micro-1f',knockback:'blast'}),
    actionTemplate('spark','Blast debris hit','Adds six bounded impact pixels.',{particles:'impact-burst',actorFlash:'white-2f',knockback:'blast'})
  ]),
  'player.explosion_hit': Object.freeze([
    actionTemplate('red','Red blast damage','Two-frame red hero flash + blast push.',{actorFlash:'red-2f',knockback:'blast'}),
    actionTemplate('freeze','Blast damage freeze','Red hero flash, stop and heavy push.',{actorFlash:'red-2f',hitStop:'micro-1f',knockback:'heavy-blast'}),
    actionTemplate('shock','Shock ring damage','Adds brief red world ring and camera.',{camera:'heavy-impact',actorFlash:'red-2f',worldFlash:'red-ring-1f',hitStop:'micro-1f',knockback:'heavy-blast'})
  ]),
  'player.explosion_near_miss': Object.freeze([
    actionTemplate('bounce','Shockwave bounce','Gameplay bounce plus a tiny dust/nudge cue.',{particles:'micro-dust',spriteImpulse:'jump-stretch'}),
    actionTemplate('clean','Clean bounce','Gameplay bounce only; no extra visual layer.',{}),
    actionTemplate('punch','Visible shockwave','Adds a micro camera tick and compact flash.',{camera:'micro-tick',flash:'pinprick',spriteImpulse:'jump-stretch'})
  ]),
  'pickup.collect': Object.freeze([
    actionTemplate('clean','Clean pickup','Local glint only.',{flash:'pickup-glint'}),
    actionTemplate('accent','Pickup accent','Glint + optional accent sample.',{flash:'pickup-glint',audio:'pickup-ping'}),
    actionTemplate('sparkle','Small sparkle','Glint + bounded rise particles.',{particles:'micro-dust',flash:'pickup-glint'}),
    actionTemplate('puff','Smoke puff','Opaque smoke BOBs conceal the collectible at pickup time, then shrink away in three discrete stages.',{particles:'pickup-smoke'})
  ]),
  'platform.release': Object.freeze([
    actionTemplate('raw','Raw release','No extra feedback beyond the platform motion.',{}),
    actionTemplate('puff','Release puff','Eight masked smoke puffs mark the dynamite-triggered break-away.',{particles:'platform-release-puff'})
  ]),
  'blockage.crumble': Object.freeze([
    actionTemplate('raw','Raw crumble','Classic crumble animation only.',{}),
    actionTemplate('chunks','Falling masonry','Full-block gray chunks fall with gravity while the three Classic crumble cels play.',{particles:'castle-blockage-chunks'})
  ]),
  'ammo.deplete': Object.freeze([
    actionTemplate('quiet','Quiet depletion','Let the inventory icon disappear without an extra accent.',{}),
    actionTemplate('fade','Quiet resource event','No world feedback; HUD depletion is authored in the HUD inventory tool.',{}),
    actionTemplate('jitter','Quiet resource event','No world feedback; HUD depletion is authored in the HUD inventory tool.',{})
  ]),
  'ammo.collect': Object.freeze([
    actionTemplate('clean','Clean ammo pickup','No extra world effect; HUD refill is authored in the HUD inventory tool.',{}),
    actionTemplate('accent','Ammo pickup accent','Optional pickup sample; HUD refill is authored separately.',{audio:'pickup-ping'}),
    actionTemplate('pop','Ammo pickup pop','Compact pickup glint; HUD refill is authored separately.',{flash:'pickup-glint'})
  ]),
  'points.collect': Object.freeze([
    actionTemplate('clean','Clean score gain','No extra world effect; score HUD feedback is authored separately.',{}),
    actionTemplate('accent','Score accent','Optional pickup sample; score HUD feedback is authored separately.',{audio:'pickup-ping'}),
    actionTemplate('sparkle','Score sparkle','Three bounded pixels and a compact glint; HUD feedback is authored separately.',{particles:'micro-dust',flash:'pickup-glint'})
  ])
});

function gameStyle(id, label, inspiration, summary, actions, hud = null) {
  return Object.freeze({
    id, label, inspiration, summary,
    actions: Object.freeze(actions),
    hud: Object.freeze(hud || { 'ammo.deplete':'gray-fade', 'ammo.collect':'white-fade', 'points.collect':'white-fade' })
  });
}

/* These are original style studies, not measurements of the named games. */
export const GAME_STYLE_TEMPLATES = Object.freeze([
  Object.freeze({ id:'reset-all', label:'Reset all · JUICE OFF', summary:'Disable every authored Action & Feedback effect. Movement Feel is left unchanged.', resetAll:true, actions:Object.freeze({}) }),
  gameStyle('spelunky-readable','Spelunky-style · Readable danger','Spelunky','Quiet traversal, clear hazards, compact impact feedback and no unnecessary particle fog.',{
    'player.step':'raw','player.turn':'skid','player.jump':'grounded','player.bounce_back':'raw','player.apex':'pure','player.land':'soft','player.wall_hug':'dust','player.staff_hold':'raw',
    'weapon.fire':'classic','bullet.wall_hit':'chip','bullet.target_hit':'clean','enemy.stick_hit':'quiet','player.projectile_hit':'red','projectile.near_miss':'stereo',
    'dynamite.place':'ui','dynamite.fuse':'minimal','dynamite.explode':'palette','ammo.explode':'palette','dynamite.target_hit':'white','player.explosion_hit':'red','player.explosion_near_miss':'bounce','pickup.collect':'clean','ammo.deplete':'fade','ammo.collect':'clean','points.collect':'clean'
  }),
  gameStyle('celeste-crisp','Celeste-style · Crisp movement','Celeste','Movement-first visual deformation and tiny dust, with restrained combat interruption. Does not change Movement Feel.',{
    'player.step':'minimal','player.turn':'skid','player.jump':'grounded','player.bounce_back':'raw','player.apex':'float','player.land':'responsive','player.wall_hug':'dust','player.staff_hold':'raw',
    'weapon.fire':'crisp','bullet.wall_hit':'chip','bullet.target_hit':'clean','enemy.stick_hit':'quiet','player.projectile_hit':'freeze','projectile.near_miss':'hat-dust',
    'dynamite.place':'tactile','dynamite.fuse':'minimal','dynamite.explode':'ripple','ammo.explode':'ripple','dynamite.target_hit':'white','player.explosion_hit':'freeze','player.explosion_near_miss':'bounce','pickup.collect':'clean','ammo.deplete':'fade','ammo.collect':'clean','points.collect':'clean'
  }),
  gameStyle('dead-cells-impact','Dead Cells-style · Impact priority','Dead Cells','Traversal stays clean; confirmed damage gets flash, freeze and displacement.',{
    'player.step':'raw','player.turn':'skid','player.jump':'classic','player.bounce_back':'raw','player.apex':'pure','player.land':'responsive','player.wall_hug':'dust','player.staff_hold':'raw',
    'weapon.fire':'punchy','bullet.wall_hit':'spark','bullet.target_hit':'punchy','enemy.stick_hit':'quiet','player.projectile_hit':'impact','projectile.near_miss':'snap',
    'dynamite.place':'tactile','dynamite.fuse':'spark','dynamite.explode':'debris','ammo.explode':'debris','dynamite.target_hit':'freeze','player.explosion_hit':'shock','player.explosion_near_miss':'bounce','pickup.collect':'accent','ammo.deplete':'fade','ammo.collect':'accent','points.collect':'accent'
  },{ 'ammo.deplete':'gray-fade', 'ammo.collect':'white-jitter', 'points.collect':'white-jitter' }),
  gameStyle('shovel-knight-retro','Shovel Knight-style · Retro punch','Shovel Knight','Pixel-forward flashes, tiny sprite offsets and short one-frame accents.',{
    'player.step':'minimal','player.turn':'skid','player.jump':'classic','player.bounce_back':'raw','player.apex':'pure','player.land':'soft','player.wall_hug':'dust','player.staff_hold':'raw',
    'weapon.fire':'retro','bullet.wall_hit':'chip','bullet.target_hit':'freeze','enemy.stick_hit':'quiet','player.projectile_hit':'red','projectile.near_miss':'stereo',
    'dynamite.place':'ui','dynamite.fuse':'minimal','dynamite.explode':'ripple','ammo.explode':'ripple','dynamite.target_hit':'white','player.explosion_hit':'freeze','player.explosion_near_miss':'bounce','pickup.collect':'clean','ammo.deplete':'fade','ammo.collect':'clean','points.collect':'clean'
  }),
  gameStyle('amiga-palette-punch','Amiga/CD32 · Palette punch','16/32-bit action games','Recommended old-school baseline: almost no ambient particles; bounded takeoff/pickup/platform puffs and gravity-led Castle rubble plus opaque palette/tile flashes, 1:1 sprite displacement, HUD feedback and sampled audio do the work.',{
    'player.step':'raw','player.turn':'grounded-skid','player.jump':'cd32-puff','player.bounce_back':'raw','player.apex':'pure','player.land':'soft','player.wall_hug':'quiet','player.staff_hold':'raw',
    'weapon.fire':'retro-smoke','bullet.wall_hit':'chip','bullet.target_hit':'freeze','enemy.stick_hit':'cd32','player.projectile_hit':'freeze','projectile.near_miss':'stereo',
    'dynamite.place':'ui','dynamite.fuse':'minimal','dynamite.explode':'retro-heavy','ammo.explode':'palette','dynamite.target_hit':'freeze','player.explosion_hit':'freeze','player.explosion_near_miss':'bounce','pickup.collect':'puff','platform.release':'puff','blockage.crumble':'chunks','ammo.deplete':'fade','ammo.collect':'clean','points.collect':'clean'
  })
]);

export function findGameStyleTemplate(id) {
  return GAME_STYLE_TEMPLATES.find(item => item.id === id) || null;
}

export function findEffectTemplate(piece, id) {
  return EFFECT_TEMPLATES[piece]?.find(item => item.id === id) || null;
}

export function applyEffectTemplate(recipe, piece, templateId) {
  const selected = findEffectTemplate(piece, templateId);
  if (!recipe?.[piece] || !selected) return false;
  const baseline = createDefaultActionRecipe()[piece];
  if (!baseline) return false;
  for (const key of Object.keys(recipe[piece])) delete recipe[piece][key];
  Object.assign(recipe[piece], baseline, selected.values);
  return true;
}

export function findActionTemplate(actionId, templateId) {
  return ACTION_TEMPLATES[actionId]?.find(item => item.id === templateId) || null;
}

export function applyActionTemplate(recipe, actionId, templateId) {
  const selected = findActionTemplate(actionId, templateId);
  if (!recipe || !selected) return false;
  recipe.enabled = true;
  /* Recipes are complete states: clear every piece first so applying a quiet
   * recipe after a loud one cannot leave a hidden residual channel enabled. */
  for (const piece of Object.keys(EFFECT_TEMPLATES)) {
    if (piece !== 'hudImpulse') applyEffectTemplate(recipe, piece, 'off');
  }
  for (const [piece, pieceTemplateId] of Object.entries(selected.parts)) {
    if (piece !== 'hudImpulse') applyEffectTemplate(recipe, piece, pieceTemplateId);
  }
  return true;
}

export function applyGameStyleTemplate(profile, templateId) {
  const selected = findGameStyleTemplate(templateId);
  if (!profile?.actions || !selected) return false;
  /* Whole-game styles must not inherit a global enhanced trail from the
   * previously edited profile. Styles currently author action feedback only,
   * so their neutral global trail state is always the protocol default. */
  if (profile.motionTrail) Object.assign(profile.motionTrail, DEFAULT_PROFILE.motionTrail);
  if (selected.resetAll) {
    for (const recipe of Object.values(profile.actions)) {
      recipe.enabled = true;
      for (const piece of Object.keys(EFFECT_TEMPLATES)) applyEffectTemplate(recipe, piece, 'off');
    }
    if (profile.motionTrail) profile.motionTrail.enabled = false;
    profile.name = 'JUICE OFF reset';
    return true;
  }
  for (const [actionId, actionTemplateId] of Object.entries(selected.actions)) {
    const recipe = profile.actions[actionId];
    if (!recipe || !applyActionTemplate(recipe, actionId, actionTemplateId)) return false;
  }
  /* HUD inventory feedback is a separate authoring channel. Whole-game styles
   * may set that channel explicitly, but action bundles never own it. */
  for (const [actionId, hudTemplateId] of Object.entries(selected.hud || {})) {
    const recipe = profile.actions[actionId];
    if (!recipe || !applyEffectTemplate(recipe, 'hudImpulse', hudTemplateId)) return false;
  }
  profile.name = `${selected.label} draft`;
  return true;
}
