export const DEFAULT_CONTINUATION_LIMITS = Object.freeze({
  hardLeaseFrames:32,
  conservativeLeaseFrames:6,
  safetyMarginFrames:3,
  horizontalPixelsPerFrame:2,
  ladderPixelsPerFrame:2,
  noProgressFrames:6
});

const CONTINUOUS = new Set(['walk_left','walk_right','crawl_left','crawl_right','ladder_up','ladder_down']);
const clampFrame = value => Math.max(0, Math.trunc(Number(value) || 0));
const finiteNonNegative = value => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;

function sweptAxisWindow(playerMin, playerMax, hazardMin, hazardMax, relativeVelocity) {
  if (relativeVelocity === 0) return hazardMax < playerMin || hazardMin > playerMax ? null : [-Infinity,Infinity];
  const a=(playerMin-hazardMax)/relativeVelocity, b=(playerMax-hazardMin)/relativeVelocity;
  return [Math.min(a,b),Math.max(a,b)];
}

export function linearHazardContactFrames(observation,{maxFrames=60}={}) {
  const player=observation?.player;
  if(!player?.bounds) return null;
  const playerDx=Number(player.dxFp||0)/256, playerDy=Number(player.dyFp||0)/256;
  let nearest=null;
  for(const hazard of observation.hazards||[]){
    if(!hazard?.bounds) continue;
    const x=sweptAxisWindow(player.bounds.left,player.bounds.right,hazard.bounds.left,hazard.bounds.right,Number(hazard.dx||0)-playerDx);
    const y=sweptAxisWindow(player.bounds.top,player.bounds.bottom,hazard.bounds.top,hazard.bounds.bottom,Number(hazard.dy||0)-playerDy);
    if(!x||!y) continue;
    const enter=Math.max(0,x[0],y[0]), exit=Math.min(x[1],y[1]);
    if(!Number.isFinite(enter)||exit<enter||enter>maxFrames) continue;
    const frames=Math.ceil(enter);
    nearest=nearest==null?frames:Math.min(nearest,frames);
  }
  return nearest;
}

function travelDeadline(frameSerial,distance,speed,margin) {
  const d=finiteNonNegative(distance);
  if(d==null) return null;
  const frames=Math.floor(d/Math.max(1,speed));
  return clampFrame(frameSerial+Math.max(0,frames-margin));
}

function ladderDeadline(action,observation,frameSerial,limits) {
  const x=Math.trunc(Number(observation?.player?.xFp||0)/256);
  const foot=Number(observation?.player?.bounds?.bottom ?? Math.trunc(Number(observation?.player?.yFp||0)/256));
  const candidates=(observation?.terrain?.ladders||[]).filter(l=>Math.abs(Number(l.x)-x)<=8 && foot>=Number(l.y0)-8 && foot<=Number(l.y1)+8);
  if(!candidates.length) return frameSerial+limits.conservativeLeaseFrames;
  const ladder=candidates.sort((a,b)=>Math.abs(Number(a.x)-x)-Math.abs(Number(b.x)-x))[0];
  const distance=action==='ladder_up'?Math.max(0,foot-Number(ladder.y0)):Math.max(0,Number(ladder.y1)-foot);
  return travelDeadline(frameSerial,distance,limits.ladderPixelsPerFrame,limits.safetyMarginFrames);
}


export function evaluateRealtimeContinuationProgress(intent,status,limits=DEFAULT_CONTINUATION_LIMITS) {
  const frame=clampFrame(status?.frameSerial),axis=intent?.name==='ladder_up'||intent?.name==='ladder_down'?'y':'x';
  const position=Number(axis==='x'?status?.playerXfp:status?.playerYfp),previous=Number(axis==='x'?intent?.lastProgressXfp:intent?.lastProgressYfp);
  let lastProgressXfp=Number(intent?.lastProgressXfp)||0,lastProgressYfp=Number(intent?.lastProgressYfp)||0,lastProgressFrame=clampFrame(intent?.lastProgressFrame);
  if(Number.isFinite(position)&&Number.isFinite(previous)&&Math.abs(position-previous)>=128){
    if(axis==='x')lastProgressXfp=position;else lastProgressYfp=position;lastProgressFrame=frame;
    return Object.freeze({urgent:false,reason:null,lastProgressXfp,lastProgressYfp,lastProgressFrame});
  }
  if(frame-lastProgressFrame>=Math.max(1,Number(limits?.noProgressFrames)||DEFAULT_CONTINUATION_LIMITS.noProgressFrames)){
    return Object.freeze({urgent:true,reason:'no-progress',lastProgressXfp,lastProgressYfp,lastProgressFrame:frame});
  }
  return Object.freeze({urgent:false,reason:null,lastProgressXfp,lastProgressYfp,lastProgressFrame});
}

export function createRealtimeContinuationPolicy(options={}) {
  const limits=Object.freeze({...DEFAULT_CONTINUATION_LIMITS,...options});
  return Object.freeze({
    limits,
    lease(action,observation,frameSerial=observation?.episode?.frameSerial||0){
      const frame=clampFrame(frameSerial);
      if(!CONTINUOUS.has(action)) return Object.freeze({safeUntilFrame:frame,hardExpiryFrame:frame,evidence:'atomic'});
      const hardExpiryFrame=frame+Math.max(1,limits.hardLeaseFrames|0);
      let safeUntilFrame=hardExpiryFrame, evidence='hard-expiry';
      if(action.startsWith('walk_')||action.startsWith('crawl_')){
        const right=action.endsWith('_right');
        const gap=right?observation?.terrain?.gapRightDistance:observation?.terrain?.gapLeftDistance;
        const support=right?observation?.terrain?.supportRightDistance:observation?.terrain?.supportLeftDistance;
        const geometryDistance=finiteNonNegative(gap) ?? finiteNonNegative(support);
        if(geometryDistance==null){safeUntilFrame=Math.min(safeUntilFrame,frame+limits.conservativeLeaseFrames);evidence='conservative-no-edge';}
        else {const deadline=travelDeadline(frame,geometryDistance,limits.horizontalPixelsPerFrame,limits.safetyMarginFrames);safeUntilFrame=Math.min(safeUntilFrame,deadline);evidence='support-edge';}
      } else if(action==='ladder_up'||action==='ladder_down') {
        safeUntilFrame=Math.min(safeUntilFrame,ladderDeadline(action,observation,frame,limits)); evidence='ladder-extent';
      }
      const hazard=linearHazardContactFrames(observation,{maxFrames:Math.max(limits.hardLeaseFrames,60)});
      if(hazard!=null){safeUntilFrame=Math.min(safeUntilFrame,frame+Math.max(0,hazard-limits.safetyMarginFrames));evidence=`${evidence}+hazard`;}
      return Object.freeze({safeUntilFrame:Math.max(frame,safeUntilFrame|0),hardExpiryFrame,evidence});
    },
    continuation(intent,status){
      if(!intent) return Object.freeze({allowed:false,reason:'no-intent',urgent:false});
      const frame=clampFrame(status?.frameSerial);
      if(status?.dead) return Object.freeze({allowed:false,reason:'dead',urgent:true});
      if(status?.roomGeneration!==intent.roomGeneration) return Object.freeze({allowed:false,reason:'room-transition',urgent:true});
      if(status?.lifeGeneration!==intent.lifeGeneration) return Object.freeze({allowed:false,reason:'life-transition',urgent:true});
      if(!(Number(status?.legalMask||0)&(1<<intent.id))) return Object.freeze({allowed:false,reason:'became-illegal',urgent:true});
      if(frame>=intent.hardExpiryFrame) return Object.freeze({allowed:false,reason:'hard-expiry',urgent:true});
      if(frame>=intent.safeUntilFrame) return Object.freeze({allowed:false,reason:'safety-expiry',urgent:true});
      const postureChanged=(intent.startedGrounded!==!!status?.grounded)||(intent.startedClimbing!==!!status?.climbing);
      return Object.freeze({allowed:true,reason:null,urgent:postureChanged,urgentReason:postureChanged?'posture-change':null});
    }
  });
}
