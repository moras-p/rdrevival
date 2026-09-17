import { cloneProfile, normalizeProfile } from './juice-protocol.js';
import { platformCurveProgress } from './platform-motion-curve.js';

/* Deterministic Game Juice preview choreography.
 *
 * IMPORTANT DIRECTION CONTRACT
 * ----------------------------
 * xrick's game_dir is NOT an intuitive boolean: LEFT=1, RIGHT=0. The Classic
 * Hero sprite selector therefore uses 0x0D..0x17 while facing LEFT and
 * 0x01..0x0B while facing RIGHT. Earlier preview code labelled those two
 * halves backwards, so a sprite could visibly face left while the synthetic
 * preview moved it right. Keep all preview APIs in PHYSICAL screen direction
 * (-1 left, +1 right) and translate to Classic frame IDs only in this module.
 *
 * RDX PN labels are physical direction labels. Their decode path may mirror
 * source pixels as required by the ROM descriptor, but callers must never
 * compensate for that by swapping left/right PNs. */
const CLASSIC = Object.freeze({
  'player.step':          { left:[13,14,15,16,17], right:[1,2,3,4,5] },
  'player.turn':          { left:[13,14,15,16,17], right:[1,2,3,4,5] },
  'player.jump':          { left:[21], right:[6] },
  'player.bounce_back':   { left:[21], right:[6] },
  'player.apex':          { left:[21], right:[6] },
  'player.land':          { left:[21,17,13], right:[6,5,1] },
  'player.wall_hug':      { left:[21], right:[6] },
  'player.staff_hold':    { left:[23], right:[11] },
  'weapon.fire':          { left:[22], right:[10] },
  'enemy.stick_hit':      { left:[23], right:[11] },
  'preview.crawl':        { left:[19,20], right:[7,8] },
  'preview.stand':        { left:[23], right:[11] },
  'preview.fall':         { left:[21], right:[6] },
  'preview.death':        { left:[25,26], right:[25,26] },
  'player.projectile_hit':{ left:[25,26], right:[25,26] },
  'player.explosion_hit': { left:[25,26], right:[25,26] },
  'dynamite.target_hit':  { left:[23], right:[11] },
  'dynamite.place':       { left:[23], right:[11] },
  'dynamite.fuse':        { left:[23], right:[11] },
  'dynamite.explode':     { left:[23], right:[11] },
  'ammo.explode':         { left:[23], right:[11] },
  'player.explosion_near_miss': { left:[23], right:[11] },
  'pickup.collect':       { left:[13,14,15,16,17], right:[1,2,3,4,5] }
});

const RDX_PN = Object.freeze({
  'player.step':          { left:0x6c, right:0x6b },
  'player.turn':          { left:0x6c, right:0x6b },
  'player.jump':          { left:0x62, right:0x61 },
  'player.bounce_back':   { left:0x62, right:0x61 },
  'player.apex':          { left:0x62, right:0x61 },
  'player.land':          { left:0x62, right:0x61 },
  'player.wall_hug':      { left:0x62, right:0x61 },
  'player.staff_hold':    { left:0x64, right:0x63 },
  'weapon.fire':          { left:0x5c, right:0x5b },
  'enemy.stick_hit':      { left:0x64, right:0x63 },
  'preview.crawl':        { left:0x5f, right:0x5e },
  'preview.stand':        { left:0x64, right:0x63 },
  'preview.fall':         { left:0x62, right:0x61 },
  'preview.death':        { left:0x60, right:0x60 },
  'player.projectile_hit':{ left:0x60, right:0x60 },
  'player.explosion_hit': { left:0x60, right:0x60 },
  'dynamite.place':       { left:0x64, right:0x63 },
  'dynamite.fuse':        { left:0x64, right:0x63 },
  'dynamite.explode':     { left:0x64, right:0x63 },
  'ammo.explode':         { left:0x64, right:0x63 },
  'player.explosion_near_miss': { left:0x64, right:0x63 },
  'pickup.collect':       { left:0x6c, right:0x6b }
});


/* Production pose-generator discovery scans every action recipe because event
 * generators are intentionally global to the profile. A selected-action mini
 * preview has a different contract: only that action's pose generator is
 * allowed to participate, otherwise disabling Pose-attached particles in the
 * visible action can still render a generator authored in another drawer. */
export function actionPreviewIsolatedProfile(sourceProfile, actionId) {
  const isolated=cloneProfile(sourceProfile);
  for (const [id,recipe] of Object.entries(isolated.actions||{}))
    if (id!==actionId && recipe?.poseEmitter) recipe.poseEmitter.enabled=false;
  return normalizeProfile(isolated);
}

const isLeft = direction => Number(direction) < 0;
const dir = direction => isLeft(direction) ? -1 : 1;
const fallbackClassic = direction => isLeft(direction) ? [23] : [11];
const fallbackRdx = direction => isLeft(direction) ? 0x64 : 0x63;
const mod = (value,size) => ((Number(value)||0)%size+size)%size;

export function actionPreviewClassicFrames(actionId,direction=1){
  const row=CLASSIC[actionId];
  return [...(row ? (isLeft(direction)?row.left:row.right) : fallbackClassic(direction))];
}

export function actionPreviewRdxPn(actionId,direction=1){
  const row=RDX_PN[actionId];
  return row ? (isLeft(direction)?row.left:row.right) : fallbackRdx(direction);
}

export function actionPreviewFrameMs(actionId){
  /* Five 50 Hz ticks per step frame matches the corrected RDX walk cadence and
   * keeps the Classic preview from sprinting unnaturally in the mini stage. */
  if(actionId==='player.step' || actionId==='player.turn' || actionId==='pickup.collect') return 100;
  if(actionId==='preview.crawl') return 110;
  if(actionId==='player.land') return 80;
  if(actionId==='player.projectile_hit' || actionId==='player.explosion_hit') return 110;
  return 120;
}

export function actionPreviewLoopMs(actionId){
  if(actionId==='player.turn') return 2000;
  if(actionId==='weapon.fire') return 2000;
  if(actionId==='bullet.wall_hit' || actionId==='bullet.target_hit' || actionId==='enemy.stick_hit') return 1800;
  if(actionId==='projectile.near_miss') return 1800;
  if(actionId==='dynamite.place') return 1800;
  if(actionId==='dynamite.fuse') return 3200;
  if(['dynamite.explode','ammo.explode','dynamite.target_hit','player.explosion_hit','player.explosion_near_miss'].includes(actionId)) return 2200;
  if(actionId==='pickup.collect') return 1800;
  if(['ammo.deplete','ammo.collect','points.collect'].includes(actionId)) return 1800;
  if(actionId==='player.wall_hug') return 1400;
  if(actionId==='player.step') return 1200;
  if(actionId.startsWith('platform.')) return 2000;
  if(actionId==='blockage.crumble') return 2000;
  return 1600;
}

export function actionPreviewTriggerMoments(actionId){
  if(actionId==='player.step') return [0,240,480,720,960];
  if(actionId==='player.turn') return [0,1000];
  if(actionId==='player.wall_hug') return [300,700,1100];
  if(actionId==='weapon.fire') return [0];
  if(actionId==='bullet.wall_hit' || actionId==='bullet.target_hit') return [900];
  if(actionId==='enemy.stick_hit') return [520];
  if(actionId==='player.projectile_hit') return [700];
  if(actionId==='projectile.near_miss') return [600];
  if(actionId==='dynamite.place') return [350];
  if(actionId==='dynamite.fuse') return [400,800,1200,1600,2000];
  if(['dynamite.explode','ammo.explode','dynamite.target_hit','player.explosion_hit','player.explosion_near_miss'].includes(actionId)) return [900];
  if(actionId==='pickup.collect') return [800];
  if(['ammo.deplete','ammo.collect','points.collect'].includes(actionId)) return [700];
  if(actionId==='platform.start' || actionId==='platform.release') return [400];
  if(actionId==='platform.stop') return [1400];
  if(actionId==='platform.moving') return [400,560,720,880,1040,1200,1360];
  if(actionId==='platform.running') return [400,560,720,880,1040,1200,1360];
  if(actionId==='blockage.crumble') return [900];
  return [0];
}

export function actionPreviewPoseEmitterBurstMoments(actionId,binding={}){
  const loopMs=actionPreviewLoopMs(actionId);
  const triggers=actionPreviewTriggerMoments(actionId).filter(ms=>ms>=0&&ms<loopMs);
  const activeMs=Math.max(1,Math.round(Number(binding?.frames)||2))*40;
  const cadenceMs=Math.max(1,Math.round(Number(binding?.emitter?.cadenceFrames)||3))*40;
  const looping=binding?.emitter?.playbackMode!=='one-shot';
  const bursts=[];let triggerIndex=0,activeUntil=-1,nextBurst=Number.POSITIVE_INFINITY;
  while(triggerIndex<triggers.length || nextBurst<Math.min(activeUntil,loopMs)){
    const trigger=triggerIndex<triggers.length?triggers[triggerIndex]:Number.POSITIVE_INFINITY;
    if(trigger<=nextBurst){
      if(trigger>=activeUntil){
        bursts.push(trigger);
        activeUntil=trigger+activeMs;
        nextBurst=looping?trigger+cadenceMs:Number.POSITIVE_INFINITY;
      }else{
        activeUntil=Math.max(activeUntil,trigger+activeMs);
      }
      triggerIndex+=1;
      continue;
    }
    if(nextBurst<activeUntil && nextBurst<loopMs){bursts.push(nextBurst);nextBurst+=cadenceMs;}
    else nextBurst=Number.POSITIVE_INFINITY;
  }
  return bursts;
}

/* Preview storyboard state is intentionally data-only so tests can lock the
 * choreography independently of canvas rendering. Coordinates are logical
 * mini-stage offsets; renderer owns final scale/placement. */
export function actionPreviewStoryboard(actionId,elapsedMs=0,selectedDirection=1,gameplayTuning={},previewTuning={}){
  const loopMs=actionPreviewLoopMs(actionId),t=mod(elapsedMs,loopMs),d=dir(selectedDirection);
  const state={actionId,loopMs,t,direction:d,heroAction:actionId,heroVisible:true,heroX:0,heroY:0,bullet:null,dynamite:null,collectible:null,blockage:null,hud:null,wall:false};
  if(actionId==='player.step'){
    state.heroX=d*((t/loopMs)*72-36);
  } else if(actionId==='player.turn'){
    const first=t<1000,leg=first?t:t-1000;state.direction=first?d:-d;state.heroAction='player.step';state.heroX=d*(first?(-30+60*leg/1000):(30-60*leg/1000));
  } else if(actionId==='player.wall_hug'){
    state.heroAction='preview.fall';state.heroY=-16+(t/loopMs)*24;state.wall=true;
  } else if(actionId==='weapon.fire'){
    /* A weapon.fire preview is a complete shot, not only the held Hero pose.
     * The gameplay event itself fires at t=0; the prop below visualizes the
     * projectile leaving the muzzle while Rick remains in the shoot pose for
     * the rest of the ~2 s hold window before the loop fires again. */
    state.heroAction='weapon.fire';
    const flightMs=720,p=Math.min(1,t/flightMs);
    state.bullet={visible:t<flightMs,x:d*(27+p*92),y:-9,direction:d,impact:false};
  } else if(actionId==='bullet.wall_hit'){
    state.heroAction='weapon.fire';state.wall=true;const p=Math.min(1,t/900);state.bullet={visible:t<900,x:d*(27+p*85),y:-9,direction:d,progress:p,impact:t>=900&&t<1100,target:'wall'};
  } else if(actionId==='bullet.target_hit'){
    state.heroAction='weapon.fire';const p=Math.min(1,t/900);state.bullet={visible:t<900,x:d*(27+p*38),y:-9,direction:d,progress:p,impact:t>=900&&t<1120,target:'enemy'};state.target={visible:true,kind:'enemy',x:d*58,y:0,hit:t>=900&&t<1220};
  } else if(actionId==='enemy.stick_hit'){
    state.heroAction='player.staff_hold';state.target={visible:true,kind:'enemy',x:d*35,y:0,hit:t>=520&&t<800};
  } else if(actionId==='player.projectile_hit'){
    const p=Math.min(1,t/700);state.heroAction=t<700?'preview.stand':'player.projectile_hit';state.bullet={visible:t<700,x:d*(-72+p*72),y:-10,direction:d,progress:p,impact:t>=700&&t<980,target:'hero'};
  } else if(actionId==='projectile.near_miss'){
    const anchor=previewTuning?.projectileNearMissAnchor||{},ax=Math.max(0,Math.min(31,Number(anchor.x??16))),ay=Math.max(0,Math.min(20,Number(anchor.y??8)));
    state.heroAction='preview.crawl';const p=Math.min(1,t/1200);state.bullet={visible:t<1280,x:d*(-72+p*144)+(ax-16),y:ay-20,direction:d,impact:false,target:'near-miss',anchorX:ax,anchorY:ay};
  } else if(actionId==='dynamite.place'){
    state.heroAction='dynamite.place';state.dynamite={visible:t>=280,phase:t<550?'plant':'fuse',progress:Math.max(0,Math.min(1,(t-550)/1000)),x:d*36};
  } else if(actionId==='dynamite.fuse'){
    state.heroAction=t<420?'dynamite.place':'preview.stand';state.dynamite={visible:t>=260,phase:t<420?'plant':t<2400?'fuse':'explode',progress:t<420?0: t<2400?Math.max(0,(t-420)/(2400-420)):Math.min(1,(t-2400)/600),x:d*42};
  } else if(['dynamite.explode','ammo.explode','player.explosion_hit'].includes(actionId)){
    state.heroAction=actionId==='player.explosion_hit'&&t>=900?'preview.death':'preview.stand';state.dynamite={visible:true,phase:t<900?'fuse':'explode',progress:t<900?t/900:Math.min(1,(t-900)/550),x:d*52};
  } else if(actionId==='dynamite.target_hit'){
    state.heroAction='preview.stand';state.dynamite={visible:true,phase:t<900?'fuse':'explode',progress:t<900?t/900:Math.min(1,(t-900)/550),x:d*48};state.target={visible:true,kind:'enemy',x:d*58,y:0,hit:t>=900&&t<1240};
  } else if(actionId==='player.explosion_near_miss'){
    /* Production reach is owned by the runtime option and the native signed-
     * distance test. This synthetic Juice preview varies only the authored
     * lift; use a fixed representative shockwave-only separation. */
    const range=16,lift=Math.max(.25,Math.min(5,Number(gameplayTuning?.explosionNearBounceLift??1.5)));
    const bounceHeight=Math.max(0,Math.min(52,lift*27));
    const bouncing=t>=900&&t<1450;state.heroAction=bouncing?'player.jump':'preview.stand';state.heroY=bouncing?-Math.sin(Math.PI*Math.min(1,(t-900)/550))*bounceHeight:0;
    state.dynamite={visible:true,phase:t<900?'fuse':'explode',progress:t<900?t/900:Math.min(1,(t-900)/550),x:d*(52+range),distancePx:range,strengthPercent:100,bounceLift:lift};
  } else if(actionId==='pickup.collect'){
    state.heroAction='player.step';const p=Math.min(1,t/800);state.heroX=d*(-45+p*45);state.collectible={visible:t<880,x:d*34,y:0};
  } else if(actionId==='ammo.deplete'){
    state.heroVisible=false;state.hud={kind:'ammo-deplete',progress:Math.min(1,t/700)};
  } else if(actionId==='ammo.collect'){
    state.heroVisible=false;state.hud={kind:'ammo-collect',progress:Math.min(1,t/1200)};
  } else if(actionId==='points.collect'){
    state.heroVisible=false;state.hud={kind:'points',progress:Math.min(1,t/900)};
  } else if(actionId==='blockage.crumble'){
    state.heroVisible=false;
    const elapsed=t-900;
    const stage=elapsed<0?null:elapsed<120?0:elapsed<240?1:elapsed<320?2:null;
    state.blockage={visible:t<1220,crumbling:stage!==null,stage:stage??0,x:18,y:0};
    state.dynamite={visible:t<1450,phase:t<900?'fuse':'explode',progress:t<900?t/900:Math.min(1,(t-900)/550),x:-5};
  } else if(actionId.startsWith('platform.')){
    state.heroVisible=false;
    const start=400,stop=1400,active=Math.max(0,Math.min(1,(t-start)/(stop-start)));
    const eased=platformCurveProgress(active,gameplayTuning);
    const running=actionId==='platform.running' || actionId==='platform.release';
    let x=-56+112*eased;
    if(running)x=-52+104*active;
    if((actionId==='platform.start'||actionId==='platform.release')&&t<start)x=-56;
    if(actionId==='platform.stop'&&t>=stop)x=56;
    state.platform={visible:true,x,y:0,running,moving:t>=start&&t<stop};
  } else if(actionId==='player.jump'){
    const p=t/loopMs;state.heroX=d*((p-.5)*30);state.heroY=-Math.sin(Math.PI*p)*30;
  } else if(actionId==='player.bounce_back'){
    const p=t/loopMs;state.heroAction='player.jump';state.heroX=d*((p-.5)*10);state.heroY=-Math.sin(Math.PI*p)*12;
  } else if(actionId==='player.apex'){
    const p=t/loopMs;state.heroX=d*((p-.5)*18);state.heroY=-27+Math.abs(p-.5)*5;
  } else if(actionId==='player.land'){
    const p=t/loopMs;state.heroX=d*((p-.5)*12);state.heroY=-Math.sin(Math.PI*Math.min(1,p*1.8))*9;
  }
  return state;
}

/* Kept as a small compatibility helper for external tests/tools. */
export function actionPreviewMotionOffset(actionId,direction=1,phase=0){
  const state=actionPreviewStoryboard(actionId,(Number(phase)||0)*actionPreviewLoopMs(actionId),direction,{});
  return {x:Math.round(state.heroX||0),y:Math.round(state.heroY||0)};
}

/* Event-origin fallback. Story-specific object positions are resolved by the
 * editor renderer; this remains useful for generic actions. */
export function actionPreviewEventOffset(actionId,direction=1){
  const d=isLeft(direction)?-1:1;
  if(actionId==='player.step') return {x:0,y:18};
  if(actionId==='player.land') return {x:0,y:18};
  if(actionId==='player.wall_hug') return {x:d*13,y:5};
  if(actionId==='player.staff_hold') return {x:d*18,y:-1};
  if(actionId==='weapon.fire') return {x:d*27,y:-2};
  if(actionId==='bullet.wall_hit' || actionId==='bullet.target_hit') return {x:d*58,y:0};
  if(actionId==='enemy.stick_hit') return {x:d*35,y:0};
  if(actionId==='projectile.near_miss') return {x:d*38,y:-4};
  if(actionId==='dynamite.place' || actionId==='dynamite.fuse') return {x:d*13,y:18};
  if(actionId==='dynamite.explode' || actionId==='ammo.explode' || actionId==='dynamite.target_hit' || actionId==='player.explosion_hit' || actionId==='player.explosion_near_miss') return {x:d*52,y:14};
  if(actionId==='pickup.collect' || actionId==='ammo.collect' || actionId==='points.collect' || actionId==='ammo.deplete') return {x:d*22,y:4};
  if(actionId.startsWith('platform.')) return {x:0,y:0};
  if(actionId==='blockage.crumble') return {x:18,y:-10};
  return {x:0,y:0};
}

/* Legacy name retained for downstream callers. */
export function actionPreviewTriggerMs(actionId){
  const moments=actionPreviewTriggerMoments(actionId);return moments.length>1?moments[1]-moments[0]:(moments[0]||actionPreviewLoopMs(actionId));
}
