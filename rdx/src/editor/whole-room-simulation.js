import { scriptedMotionAt } from '../preview/preview-actors.js';
import { rdxDirectionalMirrorX } from '../runtime/sprite-mapping.js';

const int=(value,fallback=0)=>{const n=Number(value);return Number.isFinite(n)?Math.trunc(n):fallback;};
const point=(value,fallback=[0,0])=>Array.isArray(value)&&value.length>=2
  ? [int(value[0]),int(value[1])] : fallback.slice();

/* The legacy editor advances simulation at 25 Hz (40 ms/frame).  Reactive
 * enemies that are outside the resident native camera bank therefore use a
 * bounded 2 s walk / 2 s idle presentation cycle: 50 + 50 editor ticks.  This
 * never changes world/contact position and is replaced as soon as native xrick
 * supplies mutable state. */
export const REACTIVE_PRESENTATION_PHASE_TICKS=50;
export const REACTIVE_PRESENTATION_PERIOD_TICKS=REACTIVE_PRESENTATION_PHASE_TICKS*2;
const REACTIVE_TYPE1B_NUMBERS=Object.freeze(new Set([0x05,0x08,0x0b,0x0e]));
const REACTIVE_TYPE2_NUMBERS=Object.freeze(new Set([0x06,0x09,0x0c,0x0f]));
const CLASSIC_SOLID=0x40,CLASSIC_SPAD=0x20,CLASSIC_WAYUP=0x10,CLASSIC_VERT=0x80;
const CLASSIC_HORIZONTAL_BLOCK=CLASSIC_SOLID|CLASSIC_SPAD|CLASSIC_WAYUP|CLASSIC_VERT;

function reactiveEnemyFamily(actor){
  if(String(actor?.role||'')!=='enemy')return null;
  const entity=int(actor?.controller?.entity??actor?.source?.n??actor?.source?.entity,-1)&0x7f;
  if(REACTIVE_TYPE1B_NUMBERS.has(entity))return 'type1b';
  /* Type-2 roam/climb/pursuit depends on mutable native terrain and target
   * state. A stationary editor-only walk/flip cycle falsely looked like
   * movement while the actor stayed pinned (SM0F mark182). Without live
   * native state, keep Type-2 at its resolved snapshot instead of inventing
   * locomotion. */
  if(REACTIVE_TYPE2_NUMBERS.has(entity))return null;
  return null;
}

function stationaryType2PresentationState(actor,liveState){
  if(!liveState||liveState.wholeRoomHorizontalMotionObserved!==false||String(actor?.role||'')!=='enemy')return null;
  const entity=int(actor?.controller?.entity??actor?.source?.n??actor?.source?.entity,-1)&0x7f;
  if(!REACTIVE_TYPE2_NUMBERS.has(entity))return null;
  const simulation=actor?.simulation||{};
  const pn=Number(simulation.pn);
  const semanticOrigin=point(simulation.origin),semanticDraw=point(simulation.draw,semanticOrigin);
  const presentationAnchor=Object.freeze([
    semanticOrigin[0]-semanticDraw[0],semanticOrigin[1]-semanticDraw[1]
  ]);
  const liveOrigin=point(liveState.origin,semanticOrigin);
  const draw=Object.freeze([
    liveOrigin[0]-presentationAnchor[0],liveOrigin[1]-presentationAnchor[1]
  ]);
  /* Type-2 c2 is horizontal control intent, not a durable facing state. When
   * the native actor is blocked, xrick can negate c2 every update without
   * changing X. The native compositor has already used that transient intent
   * to choose a directional PN before the editor sees the audit, so its draw
   * coordinate carries that rejected PN's anchor as well. Holding only PN and
   * mirror leaves an impossible mixed state (reviewed PN + opposite PN draw)
   * and makes the sprite hop in place. Keep live lifecycle/origin state, but
   * project the complete reviewed Layer-E presentation anchor until native X
   * displacement proves that the intent became actual movement. */
  return Object.freeze({
    ...liveState,
    origin:Object.freeze(liveOrigin),draw,anchor:presentationAnchor,
    ...(Number.isFinite(pn)?{pn}:{}),
    direction:'neutral',
    mirrorX:!!simulation.mirrorX,
    stationaryType2Facing:true,
    presentationAuthority:'layer-e-stationary-type2-facing',
    authority:`${String(liveState.authority||'native-xrick-live-state')}+layer-e-stationary-type2-facing`
  });
}

function fixedContactPickupPresentationState(actor,liveState){
  if(!liveState||String(actor?.trajectoryAuthority||'')!=='fixed-contact')return null;
  const entity=int(actor?.controller?.entity??actor?.source?.n??actor?.source?.entity,-1)&0x7f;
  if(entity<0x10||entity>0x17)return null;
  const simulation=actor?.simulation||{};
  if(!Array.isArray(simulation.origin)||!Array.isArray(simulation.draw))return null;
  const origin=Object.freeze(point(simulation.origin)),draw=Object.freeze(point(simulation.draw,origin));
  /* Fixed-contact pickups have a Classic entity/controller only for gameplay
   * lifecycle. Their reviewed RDX world-space contact is presentation
   * authority and must not be replaced by a camera/local native draw sample.
   * Doing so reintroduced the xrick 8px screen residual in Level Editor
   * Simulate for SM29 marks 449/453 after the native game presenter itself
   * had already been corrected. Keep native visibility/state identity, but
   * pin the whole-room visual to the resolved E/F contact. */
  return Object.freeze({
    ...liveState,origin,draw,anchor:Object.freeze([origin[0]-draw[0],origin[1]-draw[1]]),
    presentationAuthority:'resolved-fixed-contact-pickup',
    authority:`${String(liveState.authority||'native-xrick-live-state')}+resolved-fixed-contact-pickup`
  });
}

export function reactivePresentationState(actor,tick,liveState=null){
  const family=reactiveEnemyFamily(actor),simulation=actor?.simulation||{};
  if(!family||!Array.isArray(simulation.origin)||!Array.isArray(simulation.draw))return null;
  const t=Math.max(0,int(tick)),cycleTick=t%REACTIVE_PRESENTATION_PERIOD_TICKS;
  const walking=cycleTick<REACTIVE_PRESENTATION_PHASE_TICKS;
  const origin=Object.freeze(point(simulation.origin)),draw=Object.freeze(point(simulation.draw,origin));
  const live=liveState&&typeof liveState==='object'?liveState:null;
  return Object.freeze({
    sourceKey:String(actor?.sourceKey||''),phase:cycleTick,duration:1,
    /* Keep animation time finite as well as deterministic.  During the idle
     * half, hold the final walking presentation frame rather than accumulating
     * an unbounded synthetic history. */
    tick:walking?cycleTick:REACTIVE_PRESENTATION_PHASE_TICKS-1,
    presentationTick:t,origin,draw,
    anchor:Object.freeze([origin[0]-draw[0],origin[1]-draw[1]]),
    size:Object.freeze(point(actor?.size,[32,32])),pn:live?.pn??null,
    mirrorX:live?.mirrorX==null?!!simulation.mirrorX:!!live.mirrorX,
    mirrorY:live?.mirrorY==null?!!simulation.mirrorY:!!live.mirrorY,
    front:live?.front==null?!!simulation.front:!!live.front,
    visible:live?.visible==null?simulation.visible!==false:live.visible!==false,
    direction:String(live?.direction||'neutral'),presentationAudited:false,
    walking,reactivePresentation:true,controllerFamily:family,
    motionAuthority:'native-xrick-only',
    presentationAuthority:'resolved-walk-idle-inspection-cycle',
    authority:live?'layer-e-reactive-anchor+native-identity':'layer-e-reactive-presentation-only'
  });
}

function scriptedActorPath(actor,classicScriptedPaths){
  const entity=Number(actor?.controller?.entity??actor?.source?.n??actor?.source?.entity);
  const path=Number.isFinite(entity)?classicScriptedPaths?.entities?.[String(entity&0x7f)]||null:null;
  if(!path?.steps?.some(step=>Number(step?.dx||0)!==0||Number(step?.dy||0)!==0))return null;
  const explicit=String(actor?.lifecycleAuthority||'')==='classic-ent-mvstep-scripted-path';
  const movingPlatform=actor?.movingPlatform===true;
  const scriptedEnemy=String(actor?.role||'')==='enemy'&&(entity&0x7f)>=0x18;
  /* A reviewed projectile child can own immutable Classic ent_mvstep geometry
   * without making generic projectiles browser-simulated.  The semantic
   * trajectory authority is the discriminator: entity 0x39 is used by both
   * moving projectile children and fixed-contact projectile records. */
  const projectileChildTrack=String(actor?.role||'')==='projectile'&&
    String(actor?.trajectoryAuthority||'')==='projectile-child-track';
  /* Resolved trap bodies may use the same immutable ent_mvstep program as
   * their native controller.  Project only non-action-owned looping bodies;
   * ONCE/action-state lifecycles remain native-runtime owned. */
  const loopingTrap=String(actor?.role||'')==='trap'&&actor?.actionStateOwner!==true&&
    (Number(actor?.source?.flags||0)&0x01)===0;
  return explicit||movingPlatform||loopingTrap||scriptedEnemy||projectileChildTrack?path:null;
}

function boundedPatrolDescriptor(actor,{classicSource=false}={}){
  const sourceController=actor?.source?.controller||null;
  const controller=classicSource?sourceController:(actor?.controller||sourceController);
  const sourcePatrol=sourceController?.patrol||null;
  const allowReviewed=!classicSource&&String(actor?.projectionThroughLayer||'F').toUpperCase()==='F';
  const reviewedPatrol=allowReviewed?controller?.reviewedPatrol||null:null;
  const patrol=reviewedPatrol||sourcePatrol;
  if(String(controller?.family||sourceController?.family||'')!=='type1a'||String(controller?.kind||sourceController?.kind||'')!=='bounded-horizontal-patrol'||!patrol)return null;
  const distance=Math.max(0,int(patrol.distancePx));
  const step=Math.max(1,Math.abs(int(patrol.stepPx,2)));
  const stepsPerLeg=Math.max(1,int(patrol.counterLimit,Math.ceil(distance/step)));
  const loopPeriod=Math.max(2,int(patrol.loopPeriodTicks,stepsPerLeg*2));
  return Object.freeze({
    patrol,distance,step,stepsPerLeg,loopPeriod,reviewed:!!reviewedPatrol,
    startupLatencyTicks:Math.max(0,int(patrol.startupLatencyTicks)),
    initialDirection:String(patrol.initialDirection||'right')==='left'?'left':'right'
  });
}

function opposite(direction){return direction==='left'?'right':'left';}

function boundedPatrolPhase(descriptor,tick){
  const t=Math.max(0,int(tick)),{distance,step,stepsPerLeg,loopPeriod,startupLatencyTicks,initialDirection}=descriptor;
  let traversed=0,direction=initialDirection;
  if(t>startupLatencyTicks&&distance>0){
    const phase=((t-startupLatencyTicks-1)%loopPeriod)+1;
    if(phase<=stepsPerLeg){
      traversed=Math.min(distance,phase*step);
      if(phase===stepsPerLeg)direction=opposite(initialDirection);
    }else{
      const returning=phase-stepsPerLeg;
      traversed=Math.max(0,distance-returning*step);
      direction=returning>=stepsPerLeg?initialDirection:opposite(initialDirection);
    }
  }
  return Object.freeze({t,traversed,direction,dx:(initialDirection==='left'?-1:1)*traversed});
}

function classicRoomFlag(room,row,col){
  const width=int(room?.widthTiles),height=int(room?.heightTiles);
  if(row<0||col<0||row>=height||col>=width||!Array.isArray(room?.flags))return 0;
  return int(room.flags[row*width+col])&0xff;
}

/* Exact static-map subset of xrick u_envtest() used by type-1A walkers.
 * This is not a browser gameplay engine: it answers only the immutable
 * Layer-B question "would the next 2px horizontal source step be blocked by
 * the Classic room tiles?". Dynamic entities, RDX collision adaptation,
 * lethality and falling remain native-runtime owned. Keeping this tiny source
 * oracle matters because trig_x is only a per-leg maximum; xrick also resets
 * that counter and reverses early when Classic terrain blocks a step. Treating
 * trig_x as a fixed start→end interval made whole-room editor patrols enter
 * walls (SM00 mark2, SM01 mark8 and the same type-1A family elsewhere). */
function classicType1aStepBlocked(room,x,y){
  if(!room||!Array.isArray(room.flags))return false;
  let rows=2;
  if(int(y)&0x04)rows+=1;
  const bodyLeft=int(x)+4,col=Math.floor(bodyLeft/8),misaligned=(bodyLeft&0x07)!==0;
  let row=Math.floor(int(y)/8),flags=0;
  for(let i=0;i<rows;i+=1,row+=1){
    if(misaligned){
      flags|=classicRoomFlag(room,row,col)&(CLASSIC_SOLID|CLASSIC_SPAD);
      flags|=classicRoomFlag(room,row,col+1)&(CLASSIC_SOLID|CLASSIC_SPAD);
      flags|=classicRoomFlag(room,row,col+2)&(CLASSIC_SOLID|CLASSIC_SPAD);
    }else{
      flags|=classicRoomFlag(room,row,col)&(CLASSIC_SOLID|CLASSIC_SPAD);
      flags|=classicRoomFlag(room,row,col+1)&(CLASSIC_SOLID|CLASSIC_SPAD);
    }
  }
  if(misaligned){
    flags|=classicRoomFlag(room,row,col)&(CLASSIC_SOLID|CLASSIC_SPAD|CLASSIC_WAYUP);
    flags|=classicRoomFlag(room,row,col+1)&CLASSIC_HORIZONTAL_BLOCK;
    flags|=classicRoomFlag(room,row,col+2)&(CLASSIC_SOLID|CLASSIC_SPAD|CLASSIC_WAYUP);
  }else{
    flags|=classicRoomFlag(room,row,col)&CLASSIC_HORIZONTAL_BLOCK;
    flags|=classicRoomFlag(room,row,col+1)&CLASSIC_HORIZONTAL_BLOCK;
  }
  return (flags&CLASSIC_HORIZONTAL_BLOCK)!==0;
}

function initialClassicBoundedPatrolState(descriptor,sourceStart){
  const step=Math.max(1,int(descriptor.step,2));
  return {
    t:0,x:int(sourceStart[0]),y:int(sourceStart[1]),
    velocity:descriptor.initialDirection==='left'?-step:step,
    stepCount:0,latency:Math.max(0,int(descriptor.startupLatencyTicks))
  };
}

function advanceClassicBoundedPatrolState(state,descriptor,classicRoom){
  state.t+=1;
  if(state.latency>0){state.latency-=1;return state;}
  const target=state.x+state.velocity;
  if(target<0||target>0xe8||classicType1aStepBlocked(classicRoom,target,state.y)){
    state.stepCount=0;state.velocity=-state.velocity;return state;
  }
  state.x=target;state.stepCount+=1;
  if(state.stepCount>=descriptor.stepsPerLeg){state.stepCount=0;state.velocity=-state.velocity;}
  return state;
}

function frozenClassicPatrolPhase(state,sourceStart){
  return Object.freeze({
    t:state.t,x:state.x,y:state.y,dx:state.x-int(sourceStart[0]),
    direction:state.velocity<0?'left':'right',stepCount:state.stepCount,latency:state.latency
  });
}

function classicBoundedPatrolPhase(descriptor,tick,classicRoom,sourceStart){
  if(!classicRoom||!Array.isArray(classicRoom.flags)||!Array.isArray(sourceStart))return null;
  const targetTick=Math.max(0,int(tick)),state=initialClassicBoundedPatrolState(descriptor,sourceStart);
  while(state.t<targetTick)advanceClassicBoundedPatrolState(state,descriptor,classicRoom);
  return frozenClassicPatrolPhase(state,sourceStart);
}

/* Type-1A's counter is Classic-owned, but the same controller must reverse
 * early when the corresponding RDX support no longer extends as far as the
 * Classic route.  `auditPatrol` is a proven MT support run in presentation-
 * contact coordinates, not a replacement gameplay solver.  We therefore
 * preserve xrick's step/counter/latency rules and add only the immutable RDX
 * support edge as an additional horizontal blocker. */
function supportBoundedPatrolPhase(descriptor,tick,supportPatrol,startX){
  if(!supportPatrol?.mobile||!Number.isFinite(Number(supportPatrol.minX))||
      !Number.isFinite(Number(supportPatrol.maxX))||!Number.isFinite(Number(startX)))return null;
  const minX=int(supportPatrol.minX),maxX=int(supportPatrol.maxX);
  /* A short local MT run is not enough evidence to replace a longer Classic
   * patrol (SM01 mark9's ladder-side route is the canonical control).  Use RDX
   * support only when the proven run can accommodate at least one configured
   * xrick leg; then it can legitimately shorten that leg because the actor is
   * offset toward one edge, as in SM03 mark25. */
  if(maxX<=minX||maxX-minX<descriptor.distance)return null;
  const step=Math.max(1,int(descriptor.step,2)),state={
    t:0,x:int(startX),velocity:descriptor.initialDirection==='left'?-step:step,
    stepCount:0,latency:Math.max(0,int(descriptor.startupLatencyTicks))
  };
  const targetTick=Math.max(0,int(tick));
  while(state.t<targetTick){
    state.t+=1;
    if(state.latency>0){state.latency-=1;continue;}
    const target=state.x+state.velocity;
    if(target<minX||target>maxX){state.stepCount=0;state.velocity=-state.velocity;continue;}
    state.x=target;state.stepCount+=1;
    if(state.stepCount>=descriptor.stepsPerLeg){state.stepCount=0;state.velocity=-state.velocity;}
  }
  return Object.freeze({t:state.t,x:state.x,dx:state.x-int(startX),
    direction:state.velocity<0?'left':'right',stepCount:state.stepCount,latency:state.latency});
}

function boundedPatrolEnvelope(actor,classicRoom,{maxTicks=2048,classicSource=false}={}){
  const descriptor=boundedPatrolDescriptor(actor,{classicSource}),placement=actor?.controllerPlacement||null;
  const sourceStart=Array.isArray(descriptor?.patrol?.start)?point(descriptor.patrol.start)
    :(Array.isArray(placement?.sourceOrigin)?point(placement.sourceOrigin):null);
  if(!descriptor||!sourceStart)return null;
  if(!classicRoom||!Array.isArray(classicRoom.flags)){
    const fallback=boundedPatrolPhase(descriptor,descriptor.startupLatencyTicks+descriptor.stepsPerLeg);
    const end=[sourceStart[0]+fallback.dx,sourceStart[1]];
    return Object.freeze({minX:Math.min(sourceStart[0],end[0]),maxX:Math.max(sourceStart[0],end[0]),y:sourceStart[1],source:descriptor.reviewed?'layer-f-reviewed-distance-counter-maximum':'layer-b-distance-counter-maximum'});
  }
  let minX=sourceStart[0],maxX=sourceStart[0];
  const seen=new Map();
  const state=initialClassicBoundedPatrolState(descriptor,sourceStart);
  const horizon=Math.max(1,int(maxTicks,2048));
  for(let t=0;t<=horizon;t+=1){
    minX=Math.min(minX,state.x);maxX=Math.max(maxX,state.x);
    if(t>=descriptor.startupLatencyTicks){
      const key=`${state.x}:${state.velocity<0?'left':'right'}:${state.stepCount}:${state.latency}`;
      if(seen.has(key)){
        return Object.freeze({minX,maxX,y:sourceStart[1],loopStart:seen.get(key),loopPeriod:t-seen.get(key),source:descriptor.reviewed?'layer-f-reviewed-patrol+classic-static-envtest':'layer-b-classic-static-envtest'});
      }
      seen.set(key,t);
    }
    if(t<horizon)advanceClassicBoundedPatrolState(state,descriptor,classicRoom);
  }
  return Object.freeze({minX,maxX,y:sourceStart[1],loopStart:descriptor.startupLatencyTicks,loopPeriod:null,source:descriptor.reviewed?'layer-f-reviewed-patrol+classic-static-envtest-bounded-horizon':'layer-b-classic-static-envtest-bounded-horizon'});
}

export function classicBoundedPatrolEnvelope(actor,classicRoom,{maxTicks=2048}={}){
  return boundedPatrolEnvelope(actor,classicRoom,{maxTicks,classicSource:true});
}

function controllerPlacement(actor,simulation){
  const placement=actor?.controllerPlacement||null;
  if(!Array.isArray(placement?.alignedOrigin))return null;
  const aligned=point(placement.alignedOrigin),effective=Array.isArray(placement.effectiveControllerOrigin)
    ?point(placement.effectiveControllerOrigin):aligned;
  const phaseZero=Array.isArray(placement.phaseZeroControllerOrigin)
    ?point(placement.phaseZeroControllerOrigin):effective;
  const semanticOrigin=point(simulation.origin),semanticDraw=point(simulation.draw,semanticOrigin);
  return Object.freeze({
    aligned,effective,phaseZero,
    sourceOrigin:Array.isArray(placement.sourceOrigin)?point(placement.sourceOrigin):null,
    originOffset:point(placement.presentationOriginOffset,[semanticOrigin[0]-phaseZero[0],semanticOrigin[1]-phaseZero[1]]),
    drawOffset:point(placement.presentationDrawOffset,[semanticDraw[0]-phaseZero[0],semanticDraw[1]-phaseZero[1]])
  });
}

function presentationFromController(controllerPoint,placement,simulation){
  if(!placement){
    const semanticOrigin=point(simulation.origin),semanticDraw=point(simulation.draw,semanticOrigin);
    return Object.freeze({origin:semanticOrigin,draw:semanticDraw});
  }
  return Object.freeze({
    origin:Object.freeze([controllerPoint[0]+placement.originOffset[0],controllerPoint[1]+placement.originOffset[1]]),
    draw:Object.freeze([controllerPoint[0]+placement.drawOffset[0],controllerPoint[1]+placement.drawOffset[1]])
  });
}

export function configuredBoundedPatrolState(actor,tick,liveState=null,classicRoom=null,supportPatrol=null){
  const descriptor=boundedPatrolDescriptor(actor),simulation=actor?.simulation||{};
  if(!descriptor||!Array.isArray(simulation.origin)||!Array.isArray(simulation.draw))return null;
  const placement=controllerPlacement(actor,simulation);
  const sourceStart=Array.isArray(descriptor.patrol?.start)
    ?point(descriptor.patrol.start)
    :(placement?.sourceOrigin||null);
  const environmentPhase=classicBoundedPatrolPhase(descriptor,tick,classicRoom,sourceStart);
  const phase=environmentPhase||boundedPatrolPhase(descriptor,tick);
  const supportPhase=supportBoundedPatrolPhase(descriptor,tick,supportPatrol,simulation.origin[0]);
  const t=phase.t,direction=supportPhase?.direction||phase.direction,dx=phase.dx;
  const semanticOrigin=point(simulation.origin),semanticDraw=point(simulation.draw,semanticOrigin);
  let controllerPoint=null,origin=null,draw=null;
  const patrolBase=placement?(descriptor.reviewed?placement.phaseZero:placement.aligned):null;
  if(supportPhase&&placement){
    origin=Object.freeze([supportPhase.x,semanticOrigin[1]]);
    controllerPoint=Object.freeze([origin[0]-placement.originOffset[0],patrolBase[1]]);
    draw=Object.freeze([controllerPoint[0]+placement.drawOffset[0],controllerPoint[1]+placement.drawOffset[1]]);
  }else{
    controllerPoint=patrolBase?Object.freeze([patrolBase[0]+dx,patrolBase[1]]):null;
    const visual=controllerPoint?presentationFromController(controllerPoint,placement,simulation):null;
    origin=visual?.origin||Object.freeze([semanticOrigin[0]+dx,semanticOrigin[1]]);
    draw=visual?.draw||Object.freeze([semanticDraw[0]+dx,semanticDraw[1]]);
  }
  /* Classic remains source truth even when Layer F reviews the Revival patrol.
   * Keep the Classic source-leg sample on the unmodified Layer-B descriptor. */
  const classicDescriptor=boundedPatrolDescriptor(actor,{classicSource:true});
  const classicSourceStart=Array.isArray(classicDescriptor?.patrol?.start)
    ?point(classicDescriptor.patrol.start):(placement?.sourceOrigin||null);
  const classicPhase=classicDescriptor&&classicSourceStart
    ?(classicBoundedPatrolPhase(classicDescriptor,tick,classicRoom,classicSourceStart)||boundedPatrolPhase(classicDescriptor,tick))
    :null;
  const classicDraw=classicPhase&&classicSourceStart
    ?Object.freeze([classicSourceStart[0]+classicPhase.dx,classicSourceStart[1]])
    :(liveState?.classicDraw||null);
  const supportConstrained=!!supportPhase;
  return Object.freeze({
    ...(liveState||{}),sourceKey:String(actor?.sourceKey||''),phase:t,duration:1,tick:t,
    origin,draw,anchor:Object.freeze([origin[0]-draw[0],origin[1]-draw[1]]),
    ...(classicDraw?{classicDraw}:{}),
    size:Object.freeze(point(actor?.size,[32,32])),pn:null,
    mirrorX:rdxDirectionalMirrorX(direction),mirrorY:!!simulation.mirrorY,front:!!simulation.front,
    visible:simulation.visible!==false,direction,presentationAudited:false,
    controllerPosition:controllerPoint,supportConstrained,
    authority:supportConstrained
      ?(liveState?(descriptor.reviewed?'layer-f-reviewed-bounded-patrol+rdx-mt-support+native-xrick-live-state':'layer-b-bounded-patrol+rdx-mt-support+native-xrick-live-state')
        :(descriptor.reviewed?'layer-f-reviewed-bounded-patrol+rdx-mt-support+layer-e-presentation':'layer-b-bounded-patrol+rdx-mt-support+layer-e-presentation'))
      :(liveState?(descriptor.reviewed?'layer-f-reviewed-bounded-patrol+native-xrick-live-state':'layer-b-bounded-patrol+native-xrick-live-state')
        :(descriptor.reviewed?'layer-f-reviewed-bounded-patrol+layer-e-presentation':'layer-b-bounded-patrol+layer-e-presentation'))
  });
}


export function configuredClassicBoundedPatrolState(actor,tick,classicRoom=null){
  const descriptor=boundedPatrolDescriptor(actor,{classicSource:true});
  if(!descriptor)return null;
  const placement=actor?.controllerPlacement||null;
  const sourceStart=Array.isArray(descriptor.patrol?.start)
    ? point(descriptor.patrol.start)
    : (Array.isArray(placement?.sourceOrigin)?point(placement.sourceOrigin):null);
  if(!sourceStart)return null;
  const phase=classicBoundedPatrolPhase(descriptor,tick,classicRoom,sourceStart)||boundedPatrolPhase(descriptor,tick);
  return Object.freeze({
    sourceKey:String(actor?.sourceKey||''),tick:phase.t,
    draw:Object.freeze([sourceStart[0]+phase.dx,sourceStart[1]]),
    direction:phase.direction,visible:actor?.simulation?.visible!==false,
    authority:'layer-b-classic-type1a-controller'
  });
}

export function configuredBoundedPatrolRecord(actor,classicRoom=null){
  const descriptor=boundedPatrolDescriptor(actor);
  if(!descriptor)return null;
  const envelope=boundedPatrolEnvelope(actor,classicRoom);
  const loopStart=Math.max(0,int(envelope?.loopStart,descriptor.startupLatencyTicks));
  const loopPeriod=Math.max(2,int(envelope?.loopPeriod,descriptor.loopPeriod));
  const horizon=loopStart+loopPeriod;
  const samples=[];
  for(let phase=0;phase<horizon;phase+=1){
    const sample=configuredBoundedPatrolState(actor,phase,null,classicRoom);
    if(sample)samples.push(sample);
  }
  return samples.length>1?Object.freeze({
    sourceKey:String(actor?.sourceKey||''),samples,trackPeriod:horizon,
    trajectoryCaptureHorizon:horizon,trajectoryLoopStart:loopStart,
    trajectoryLoopPeriod:loopPeriod,
    trajectoryLoopAuthority:descriptor.reviewed
      ?(classicRoom?'reviewed-patrol+xrick-classic-static-envtest+type1a-motion-state':'reviewed-patrol+xrick-type1a-motion-state')
      :(classicRoom?'xrick-classic-static-envtest+type1a-motion-state':'xrick-map-mark-type1a-controller'),
    trajectoryKind:descriptor.reviewed?'reviewed-type1a-bounded-patrol':'classic-type1a-bounded-patrol',
    authority:descriptor.reviewed
      ?(classicRoom?'layer-f-reviewed-patrol+classic-static-envtest+type1a-controller':'layer-f-reviewed-type1a-controller')
      :(classicRoom?'layer-b-classic-static-envtest+type1a-controller':'layer-b-classic-type1a-controller')
  }):null;
}

export function scriptedLifecycleState(actor,classicScriptedPaths,tick,liveState=null){
  const path=scriptedActorPath(actor,classicScriptedPaths);
  const simulation=actor?.simulation||{};
  if(!path||!Array.isArray(simulation.origin)||!Array.isArray(simulation.draw))return null;
  const placement=controllerPlacement(actor,simulation);
  /* Some native type-3 carriers enter the reviewed visible state only after
   * e_them_t3_action2() has already consumed one movement update. Preserve
   * that source-authored activation phase instead of replaying an artificial
   * dormant path sample in front of the live/native lifecycle. */
  const trajectoryTick=Math.max(0,int(tick)+int(actor?.trajectoryPhaseOffsetTicks));
  const motion=scriptedMotionAt(path,trajectoryTick,placement?.phaseZero||simulation.origin);
  if(!motion)return null;
  const visual=placement?presentationFromController(motion.origin,placement,simulation):null;
  const dx=motion.origin[0]-Number(simulation.origin[0]),dy=motion.origin[1]-Number(simulation.origin[1]);
  const origin=visual?.origin||Object.freeze([Number(simulation.origin[0])+dx,Number(simulation.origin[1])+dy]);
  const draw=visual?.draw||Object.freeze([Number(simulation.draw[0])+dx,Number(simulation.draw[1])+dy]);
  const directionalBody=String(actor?.role||'')==='enemy'||String(actor?.role||'')==='player';
  const mirrorX=directionalBody&&(motion.direction==='left'||motion.direction==='right')
    ?rdxDirectionalMirrorX(motion.direction):(liveState?.mirrorX??!!simulation.mirrorX);
  const classicDraw=placement?.sourceOrigin
    ?Object.freeze([
      placement.sourceOrigin[0]+Number(motion.origin[0])-placement.phaseZero[0],
      placement.sourceOrigin[1]+Number(motion.origin[1])-placement.phaseZero[1]
    ])
    :(liveState?.classicDraw||null);
  return Object.freeze({
    ...(liveState||{}),sourceKey:String(actor.sourceKey||''),phase:Math.max(0,int(tick)),duration:1,
    tick:Math.max(0,int(tick)),origin,draw,anchor:Object.freeze([origin[0]-draw[0],origin[1]-draw[1]]),
    ...(classicDraw?{classicDraw}:{}),
    size:Object.freeze(point(actor?.size,[32,32])),pn:liveState?.pn??null,
    mirrorX,mirrorY:liveState?.mirrorY??!!simulation.mirrorY,
    front:liveState?.front??!!simulation.front,visible:liveState?.visible==null?simulation.visible!==false:liveState.visible!==false,direction:motion.direction,
    presentationAudited:!!liveState?.presentationAudited,
    controllerPosition:placement?motion.origin:null,
    authority:liveState?'layer-b-scripted-path+native-xrick-live-state':'layer-b-scripted-path+layer-e-presentation'
  });
}

export function scriptedLifecycleRecord(actor,classicScriptedPaths){
  const path=scriptedActorPath(actor,classicScriptedPaths);
  const period=Math.max(0,int(path?.totalTicks));
  if(!path||period<2)return null;
  const samples=[];
  for(let phase=0;phase<period;phase+=1){
    const sample=scriptedLifecycleState(actor,classicScriptedPaths,phase,null);
    if(sample)samples.push(sample);
  }
  return samples.length>1?Object.freeze({
    sourceKey:String(actor?.sourceKey||''),samples,trackPeriod:period,
    trajectoryCaptureHorizon:period,trajectoryLoopStart:0,trajectoryLoopPeriod:period,
    trajectoryLoopAuthority:'classic-ent-mvstep-program',trajectoryKind:'classic-ent-mvstep-scripted-path',
    authority:'layer-b-classic-ent-mvstep'
  }):null;
}

export function composeWholeRoomSimulationStates({
  resolvedActors=[],classicScriptedPaths=null,primaryStates=new Map(),tick=0,classicRoom=null,supportPatrolBySource=null
}={}){
  const states=new Map(primaryStates||[]);
  for(const actor of resolvedActors||[]){
    const sourceKey=String(actor?.sourceKey||'');
    if(!sourceKey)continue;
    const live=states.get(sourceKey)||null;
    /* Immutable ent_mvstep geometry is the whole-room path authority even
     * when a camera-resident native sample exists. The native sample still
     * owns mutable presentation/lifecycle fields (PN, visibility, generation,
     * etc.); scriptedLifecycleState layers only the normalized Layer-B motion
     * through the actor's C/E/F registration. Treating any resident audit as
     * position authority froze SM03's bat and shifted SM00's ball onto a
     * camera/presentation trajectory that disagreed with its controller path. */
    const scripted=scriptedLifecycleState(actor,classicScriptedPaths,tick,live);
    if(scripted){states.set(sourceKey,scripted);continue;}

    /* A genuinely moving camera-resident type-1A slot owns mutable controller
     * phase. Some whole-room banks, however, expose only a stationary native
     * presentation sample for an otherwise valid bounded patrol (SM01 mark 9).
     * map-editor tags that case after observing the native session timeline;
     * only then do we layer the immutable Layer-B patrol over the native
     * presentation/lifecycle fields. This preserves native authority whenever
     * native xrick actually supplies movement and avoids reconstructing a path
     * from camera-local coordinates. */
    if(live && live.wholeRoomHorizontalMotionObserved===false && !actor?.positionAdjusted){
      const configuredPatrol=configuredBoundedPatrolState(actor,tick,live,classicRoom,supportPatrolBySource?.get?.(sourceKey)||null);
      if(configuredPatrol){states.set(sourceKey,configuredPatrol);continue;}
    }
    const fixedContactPickup=fixedContactPickupPresentationState(actor,live);
    if(fixedContactPickup){states.set(sourceKey,fixedContactPickup);continue;}
    const reactive=reactivePresentationState(actor,tick,live);
    if(reactive){states.set(sourceKey,reactive);continue;}
    const stationaryType2=stationaryType2PresentationState(actor,live);
    if(stationaryType2){states.set(sourceKey,stationaryType2);continue;}
    if(live)continue;
    const configuredPatrol=!actor?.positionAdjusted?configuredBoundedPatrolState(actor,tick,null,classicRoom,supportPatrolBySource?.get?.(sourceKey)||null):null;
    if(configuredPatrol){states.set(sourceKey,configuredPatrol);continue;}
  }
  return states;
}
