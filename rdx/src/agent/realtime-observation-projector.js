const PROJECTIONS = Object.freeze({
  'compact-v1': Object.freeze({supports:4,ladders:4,hazards:6,mechanisms:4,exits:4,navigation:false,hazardMotion:false,mechanismSemantics:false,history:false}),
  'compact-v2': Object.freeze({supports:4,ladders:4,hazards:6,mechanisms:4,exits:4,navigation:true,hazardMotion:false,mechanismSemantics:false,history:false}),
  'compact-v3': Object.freeze({supports:4,ladders:4,hazards:6,mechanisms:4,exits:4,navigation:true,hazardMotion:true,mechanismSemantics:false,history:false}),
  'compact-v4': Object.freeze({supports:4,ladders:4,hazards:6,mechanisms:4,exits:4,navigation:true,hazardMotion:true,mechanismSemantics:true,history:false}),
  'compact-v5': Object.freeze({supports:4,ladders:4,hazards:6,mechanisms:4,exits:4,navigation:true,hazardMotion:true,mechanismSemantics:true,history:true,timingContext:false}),
  'compact-v6': Object.freeze({supports:4,ladders:4,hazards:6,mechanisms:4,exits:4,navigation:true,hazardMotion:true,mechanismSemantics:true,history:true,timingContext:true,topology:false}),
  'compact-v7': Object.freeze({supports:4,ladders:4,hazards:6,mechanisms:4,exits:4,navigation:true,hazardMotion:true,mechanismSemantics:true,history:true,timingContext:true,topology:true}),
  'compact-v8': Object.freeze({supports:4,ladders:4,hazards:6,mechanisms:4,exits:4,navigation:true,hazardMotion:true,mechanismSemantics:true,history:true,timingContext:true,topology:true}),
  'compact-local-v1': Object.freeze({supports:2,ladders:2,hazards:4,mechanisms:2,exits:2,navigation:true,hazardMotion:true,mechanismSemantics:true,history:true,timingContext:true,topology:true}),
  'minimal-v1': Object.freeze({supports:2,ladders:2,hazards:4,mechanisms:2,exits:2,navigation:false,hazardMotion:false,mechanismSemantics:false,history:false})
});

export const REALTIME_PROJECTION_VERSIONS = Object.freeze(Object.keys(PROJECTIONS));

const encoder = new TextEncoder();
const px = fp => Math.trunc(Number(fp || 0) / 256);
const relRect = (bounds, originX, originY) => ({
  l:(bounds?.left || 0) - originX, t:(bounds?.top || 0) - originY,
  r:(bounds?.right || 0) - originX, b:(bounds?.bottom || 0) - originY
});
const rectDistance = (bounds, x, y) => {
  const dx = x < bounds.left ? bounds.left - x : x > bounds.right ? x - bounds.right : 0;
  const dy = y < bounds.top ? bounds.top - y : y > bounds.bottom ? y - bounds.bottom : 0;
  return dx * dx + dy * dy;
};
const stableByDistance = (items, x, y, id) => [...items].sort((a,b) =>
  rectDistance(a.bounds || {left:a.x0 ?? a.x ?? 0,right:a.x1 ?? a.x ?? 0,top:a.y ?? a.y0 ?? 0,bottom:a.y ?? a.y1 ?? 0},x,y) -
  rectDistance(b.bounds || {left:b.x0 ?? b.x ?? 0,right:b.x1 ?? b.x ?? 0,top:b.y ?? b.y0 ?? 0,bottom:b.y ?? b.y1 ?? 0},x,y) ||
  Number(id(a)) - Number(id(b))
);


function sweptAxisWindow(playerMin, playerMax, hazardMin, hazardMax, relativeVelocity) {
  if (relativeVelocity === 0) return hazardMax < playerMin || hazardMin > playerMax ? null : [-Infinity,Infinity];
  const a = (playerMin - hazardMax) / relativeVelocity;
  const b = (playerMax - hazardMin) / relativeVelocity;
  return [Math.min(a,b),Math.max(a,b)];
}
function linearContactHorizon(playerBounds, hazardBounds, relativeDx, relativeDy, maxFrames) {
  const x = sweptAxisWindow(playerBounds.left,playerBounds.right,hazardBounds.left,hazardBounds.right,relativeDx);
  const y = sweptAxisWindow(playerBounds.top,playerBounds.bottom,hazardBounds.top,hazardBounds.bottom,relativeDy);
  if (!x || !y) return null;
  const enter = Math.max(0,x[0],y[0]);
  const exit = Math.min(x[1],y[1]);
  if (!Number.isFinite(enter) || exit < enter || enter > maxFrames) return null;
  return Math.ceil(enter);
}

function assertObservation(observation) {
  if (!observation || !/^rdr\.realtime-ai\.observation\.v[12]$/.test(observation.schema))
    throw new TypeError('Expected rdr.realtime-ai.observation.v1 or v2');
}

function baseProjection(observation, kind, caps) {
  const ox = px(observation.player.xFp);
  const oy = px(observation.player.yFp);
  const footY = observation.player.bounds?.bottom ?? oy;
  const hazardsByDistance = stableByDistance(observation.hazards || [], ox, footY, item => item.id);
  const playerDx = Number(observation.player.dxFp || 0) / 256;
  const playerDy = Number(observation.player.dyFp || 0) / 256;
  const horizonFrames = Math.max(1,Math.min(60,Number(observation.timing?.gameplayTickRate || 25) | 0));
  const hazards = hazardsByDistance.slice(0,caps.hazards).map(item => {
    const hazard = {id:item.id,mark:item.mark,behavior:item.behavior,flags:item.flags,box:relRect(item.bounds,ox,oy),dx:item.dx,dy:item.dy};
    if (caps.hazardMotion) {
      hazard.relativeDx = Number(item.dx || 0) - playerDx;
      hazard.relativeDy = Number(item.dy || 0) - playerDy;
      hazard.linearContactFrames = linearContactHorizon(observation.player.bounds,item.bounds,hazard.relativeDx,hazard.relativeDy,horizonFrames);
    }
    return hazard;
  });
  const mechanisms = stableByDistance(observation.mechanisms || [], ox, footY, item => item.id)
    .slice(0,caps.mechanisms).map(item => {
      const mechanism={id:item.id,mark:item.mark,flags:item.flags,box:relRect(item.bounds,ox,oy)};
      if (caps.mechanismSemantics) mechanism.trigger={
        dynamite:!!(item.flags&1),bullet:!!(item.flags&2),contact:!!(item.flags&4),stick:!!(item.flags&8),active:!!(item.flags&16)
      };
      return mechanism;
    });
  const supports = stableByDistance(observation.terrain?.supports || [], ox, footY, item => item.type)
    .slice(0,caps.supports).map(item => ({x0:item.x0-ox,x1:item.x1-ox,y:item.y-oy,type:item.type}));
  const ladders = stableByDistance(observation.terrain?.ladders || [], ox, footY, (_item,index) => index)
    .slice(0,caps.ladders).map(item => ({x:item.x-ox,y0:item.y0-oy,y1:item.y1-oy}));
  const exitsByDistance = stableByDistance(observation.exits || [], ox, footY, item => item.connectorIndex);
  const exits = exitsByDistance
    .slice(0,caps.exits).map(item => ({connector:item.connectorIndex,direction:item.direction,targetSubmap:item.targetSubmap,box:relRect(item.bounds,ox,oy)}));

  const projected = {
    schema:`rdr.realtime-ai.projection.${kind}`,
    sourceSchema:observation.schema,
    episode:{
      map:observation.episode.map, submap:observation.episode.submap, frame:observation.episode.frameSerial,
      roomGeneration:observation.episode.roomGeneration, lifeGeneration:observation.episode.lifeGeneration,
      progress:observation.episode.progressCounter, stall:observation.episode.stallCounter
    },
    player:{
      x:ox,y:oy,dxFp:observation.player.dxFp,dyFp:observation.player.dyFp,velocityYFp:observation.player.velocityYFp,
      facing:observation.player.facing,state:observation.player.state,contacts:observation.player.contacts,
      grounded:observation.player.grounded,climbing:observation.player.climbing,crawling:observation.player.crawling,dead:observation.player.dead,
      bullets:observation.player.bullets,dynamite:observation.player.dynamite,lives:observation.player.lives,
      body:relRect(observation.player.bounds,ox,oy)
    },
    terrain:{
      supportLeft:observation.terrain.supportLeftDistance,supportRight:observation.terrain.supportRightDistance,
      wallLeft:observation.terrain.wallLeftDistance,wallRight:observation.terrain.wallRightDistance,
      ceiling:observation.terrain.ceilingDistance,gapLeft:observation.terrain.gapLeftDistance,gapRight:observation.terrain.gapRightDistance,
      supports,ladders
    },
    hazards, mechanisms, exits,
    timing:{tickRate:observation.timing.gameplayTickRate,priorLatencyMs:observation.timing.priorLatencyMs,
      priorLatencyFrames:observation.timing.priorLatencyFrames,activeActionAge:observation.timing.activeActionAge},
    recentControl:{semanticAction:observation.timing.previousSemanticAction,mask:observation.timing.currentControlMask,
      previousMask:observation.timing.previousControlMask,observationFrame:observation.timing.previousObservationFrame}
  };
  if (caps.mechanismSemantics) {
    projected.resources={
      bullets:observation.player.bullets,dynamite:observation.player.dynamite,
      canShoot:observation.player.bullets>0,canPlantDynamite:observation.player.dynamite>0
    };
  }
  if (caps.navigation) {
    const nearestSupport = stableByDistance(observation.terrain?.supports || [], ox, footY, item => item.type)[0] || null;
    const nearestLadder = stableByDistance(observation.terrain?.ladders || [], ox, footY, item => item.x)[0] || null;
    const nearestExit = exitsByDistance[0] || null;
    projected.terrain.navigation = {
      support: nearestSupport ? {
        x0:nearestSupport.x0-ox,x1:nearestSupport.x1-ox,y:nearestSupport.y-oy,type:nearestSupport.type,
        underfoot:ox>=nearestSupport.x0 && ox<=nearestSupport.x1 && nearestSupport.y>=footY
      } : null,
      ladder: nearestLadder ? {x:nearestLadder.x-ox,y0:nearestLadder.y0-oy,y1:nearestLadder.y1-oy} : null,
      exit: nearestExit ? {connector:nearestExit.connectorIndex,direction:nearestExit.direction,targetSubmap:nearestExit.targetSubmap,box:relRect(nearestExit.bounds,ox,oy)} : null
    };
  }
  if (caps.topology) {
    const terminalDistance=Number.isInteger(observation.episode?.terminalDistance)?observation.episode.terminalDistance:null;
    projected.objective={kind:terminalDistance===1?'reach-terminal-exit':'advance-toward-terminal',terminalDistance};
    projected.topology={terminalDistance,exits:exitsByDistance.slice(0,caps.exits).map(item=>({connector:item.connectorIndex,targetSubmap:item.targetSubmap,targetTerminalDistance:Number.isInteger(item.targetTerminalDistance)?item.targetTerminalDistance:null}))};
  }
  if (kind === 'minimal-v1' || kind === 'compact-local-v1') {
    delete projected.player.state;
    delete projected.player.contacts;
    delete projected.terrain.supports;
    delete projected.recentControl.previousMask;
    delete projected.recentControl.observationFrame;
  }
  return projected;
}

export function serializeProjectedState(projectedState) {
  return JSON.stringify(projectedState);
}

export function projectedStateByteLength(projectedState) {
  return encoder.encode(serializeProjectedState(projectedState)).byteLength;
}

export function projectRealtimeObservation(observation, {
  projection='compact-v1', maxBytes=8192, history=null, timingContext=null
} = {}) {
  assertObservation(observation);
  const caps = PROJECTIONS[projection];
  if (!caps) throw new Error(`Unsupported realtime observation projection '${projection}'`);
  const budget = Math.max(256, Number(maxBytes) | 0);
  const projectedState = baseProjection(observation,projection,caps);
  if (caps.history) {
    const recent=Array.isArray(history?.recentOutcomes)?history.recentOutcomes.slice(-4):[];
    const suppressed=Array.isArray(history?.suppressedActions)?history.suppressedActions.slice(0,8):[];
    projectedState.history={recentOutcomes:recent,suppressedActions:suppressed};
  }
  if (caps.timingContext && timingContext) {
    projectedState.timing.configuredCadenceFrames=Math.max(1,Number(timingContext.configuredCadenceFrames)||1);
    projectedState.timing.effectiveCadenceFrames=Math.max(projectedState.timing.configuredCadenceFrames,Number(timingContext.effectiveCadenceFrames)||projectedState.timing.configuredCadenceFrames);
    projectedState.timing.priorLatencyMs=Math.max(0,Number(timingContext.priorLatencyMs)||0);
    projectedState.timing.priorLatencyFrames=Math.max(0,Number(timingContext.priorLatencyFrames)||0);
  }
  const serialized = serializeProjectedState(projectedState);
  const serializedBytes = encoder.encode(serialized).byteLength;
  if (serializedBytes > budget) {
    throw new RangeError(`Realtime projection ${projection} is ${serializedBytes} bytes, exceeding ${budget}-byte state budget`);
  }
  return Object.freeze({projection,version:1,projectedState,serialized,serializedBytes,maxBytes:budget});
}
