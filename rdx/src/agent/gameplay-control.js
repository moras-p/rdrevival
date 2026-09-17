let gameplayFrameObserver = null;

export function setGameplayFrameObserver(observer = null) {
  if (observer != null && (typeof observer.beforeFrame !== 'function' || typeof observer.afterFrame !== 'function'))
    throw new TypeError('gameplay frame observer requires beforeFrame and afterFrame callbacks');
  const previous = gameplayFrameObserver;
  gameplayFrameObserver = observer;
  return previous;
}

function requireBridge(bridge) {
  if (!bridge || typeof bridge.snapshot !== 'function' ||
      typeof bridge.nativeCollisionSnapshot !== 'function') {
    throw new Error('xrick runtime is not ready');
  }
  return bridge;
}

function heroMotion(nativePlayer) {
  if (!nativePlayer.playerActive) return 'inactive';
  if (nativePlayer.playerClimbing) return 'climbing';
  if (nativePlayer.playerGrounded) return 'grounded';
  if (nativePlayer.playerVelocityY < 0) return 'rising';
  if (nativePlayer.playerVelocityY > 0) return 'falling';
  return 'airborne';
}

export function gameplayAgentState(bridge) {
  requireBridge(bridge);
  const snapshot = bridge.snapshot();
  const nativePlayer = bridge.nativeCollisionSnapshot();
  const sfxEventSerial = typeof bridge.soundSfxEventSerial === 'function' ?
    bridge.soundSfxEventSerial() >>> 0 : 0;
  return {
    presentation: bridge.classicAssets() ? 'classic' : 'revival',
    frameSerial: snapshot.frameSerial >>> 0,
    map: snapshot.map >>> 0,
    submap: snapshot.submap >>> 0,
    hero: {
      active: !!nativePlayer.playerActive,
      motion: heroMotion(nativePlayer),
      worldX: nativePlayer.playerWorldX | 0,
      worldY: nativePlayer.playerWorldY | 0,
      screenX: nativePlayer.playerScreenX | 0,
      screenY: nativePlayer.playerScreenY | 0,
      velocityY: nativePlayer.playerVelocityY | 0,
      grounded: !!nativePlayer.playerGrounded,
      climbing: !!nativePlayer.playerClimbing,
      crawling: !!nativePlayer.playerCrawling,
      state: snapshot.rick?.state >>> 0,
      direction: snapshot.rick?.direction >>> 0,
      controlMask: snapshot.rick?.control >>> 0
    },
    camera: {
      mapFrow: snapshot.mapFrow >>> 0,
      visibleTopRow: snapshot.visibleTopRow >>> 0,
      offsetY: snapshot.cameraOffsetPx | 0
    },
    inventory: snapshot.inventory,
    score: snapshot.score >>> 0,
    debug: snapshot.debug,
    audio: {
      activeSfx: typeof bridge.soundActiveSfxCount === 'function' ?
        bridge.soundActiveSfxCount() >>> 0 : 0,
      sfxEventSerial,
      recentSfx: typeof bridge.soundSfxEventsSince === 'function' ?
        bridge.soundSfxEventsSince(Math.max(0, sfxEventSerial - 32), 32) : [],
      muted: typeof bridge.soundMuted === 'function' ? !!bridge.soundMuted() : false
    },
    browser: {
      frontendPaused: typeof bridge.frontendPaused === 'function' ? !!bridge.frontendPaused() : false,
      transitionEffect: String(snapshot.runtimeOptions?.transition_preset || bridge.runtimeOption?.('transition_preset') || 'random')
    }
  };
}


export function withGameplayFrontendFreeze(bridge, freeze, callback) {
  const canPause = typeof bridge?.frontendPaused === 'function' && typeof bridge?.setFrontendPaused === 'function';
  const wasPaused = canPause ? !!bridge.frontendPaused() : false;
  const ownsHold = !!freeze && canPause && !wasPaused;
  if (ownsHold) bridge.setFrontendPaused(true);
  try { return callback({ wasPaused, canPause, ownsHold }); }
  finally { if (ownsHold) bridge.setFrontendPaused(false); }
}

export function forceGameplayDebugFrame(bridge) {
  if (typeof bridge?.debugForceBrowserFrame === 'function') {
    bridge.debugForceBrowserFrame();
    return;
  }
  /* Compatibility fallback for non-WASM/unit bridges. Production WebMCP uses
   * xrick_rdx_debug_force_browser_frame so a frontend hold is never released. */
  bridge.forceBrowserFrame();
}

function movementDelta(start, end) {
  return {
    worldX: end.hero.worldX - start.hero.worldX,
    worldY: end.hero.worldY - start.hero.worldY,
    frameSerial: (end.frameSerial - start.frameSerial) | 0
  };
}

function forceOneSimulationFrame(bridge, controlMask = 0) {
  const before = bridge.snapshot().frameSerial >>> 0;
  const observer = gameplayFrameObserver;
  const token = observer?.beforeFrame?.({ bridge, controlMask: Number(controlMask) & 0xff, frameSerial: before });
  let after = before;
  let error = null;
  try {
    forceGameplayDebugFrame(bridge);
    after = bridge.snapshot().frameSerial >>> 0;
    return after !== before;
  } catch (caught) {
    error = caught;
    throw caught;
  } finally {
    observer?.afterFrame?.({
      bridge, controlMask: Number(controlMask) & 0xff, beforeFrameSerial: before,
      afterFrameSerial: after, advanced: after !== before, token, error
    });
  }
}

export function stepGameplayControls(bridge, mask, frames = 1) {
  requireBridge(bridge);
  if (typeof bridge.setDebugControl !== 'function' || typeof bridge.forceBrowserFrame !== 'function') {
    throw new Error('Gameplay debug control bridge is not ready');
  }
  const requestedFrames = Math.max(1, Math.min(600, Number(frames) | 0));
  const start = gameplayAgentState(bridge);
  let stepCalls = 0;
  let advancingSteps = 0;
  let stalledSteps = 0;
  bridge.setDebugControl(Number(mask) & 0xff);
  try {
    while (advancingSteps < requestedFrames && stalledSteps < 3) {
      stepCalls += 1;
      if (forceOneSimulationFrame(bridge, mask)) {
        advancingSteps += 1;
        stalledSteps = 0;
      } else {
        stalledSteps += 1;
      }
    }
  } finally {
    bridge.setDebugControl(0);
  }
  const end = gameplayAgentState(bridge);
  const completed = advancingSteps === requestedFrames;
  return {
    status: completed ? 'completed' : 'simulation_not_advancing',
    requestedFrames,
    stepCalls,
    framesAdvanced: advancingSteps,
    advancingSteps,
    controlsReleased: true,
    start,
    end,
    delta: movementDelta(start, end),
    summary: completed
      ? `Advanced ${advancingSteps} native frame(s); Rick is ${end.hero.motion} at (${end.hero.worldX}, ${end.hero.worldY}).`
      : `Stopped because the native simulation did not advance for ${stalledSteps} consecutive forced frame(s).`,
    guidance: completed
      ? 'Inspect end.hero and issue the next site-tool action; do not use canvas focus or synthetic keyboard input.'
      : 'Do not retry with keyboard input. Check that gameplay is running rather than on a modal/title screen, then inspect state again.'
  };
}

function validateWalkCondition(until, targetX) {
  const supported = new Set(['falling', 'airborne', 'blocked', 'x_at_least', 'x_at_most', 'inactive', 'submap_changed', 'landed']);
  if (!supported.has(until)) throw new Error(`Unsupported walk stop condition '${until}'`);
  if ((until === 'x_at_least' || until === 'x_at_most') && !Number.isFinite(Number(targetX))) {
    throw new Error(`walk_until '${until}' requires targetX`);
  }
}

function conditionReached({ until, state, start, targetX, blockedFrames, wasAirborne }) {
  switch (until) {
    case 'falling': return state.hero.motion === 'falling';
    case 'airborne': return state.hero.active && !state.hero.grounded && !state.hero.climbing;
    case 'blocked': return blockedFrames > 0;
    case 'x_at_least': return state.hero.worldX >= Number(targetX);
    case 'x_at_most': return state.hero.worldX <= Number(targetX);
    case 'inactive': return !state.hero.active;
    case 'submap_changed': return state.submap !== start.submap;
    case 'landed': return wasAirborne && state.hero.grounded;
    default: return false;
  }
}

export function walkGameplayUntil(bridge, {
  direction,
  directionMask,
  until = 'falling',
  targetX = null,
  maxFrames = 600,
  blockedWindow = 12
} = {}) {
  requireBridge(bridge);
  if (direction !== 'left' && direction !== 'right') throw new Error("walk_until direction must be 'left' or 'right'");
  validateWalkCondition(until, targetX);
  const limit = Math.max(1, Math.min(1200, Number(maxFrames) | 0));
  const blockedLimit = Math.max(2, Math.min(120, Number(blockedWindow) | 0));
  const start = gameplayAgentState(bridge);
  let state = start;
  let previousX = state.hero.worldX;
  let unchangedX = 0;
  let wasAirborne = !state.hero.grounded && !state.hero.climbing;
  let advancingSteps = 0;
  let stalledSteps = 0;
  let stepCalls = 0;

  if (conditionReached({ until, state, start, targetX, blockedFrames: 0, wasAirborne })) {
    return {
      status: 'condition_reached', matched: true, stopReason: until,
      direction, framesAdvanced: 0, controlsReleased: true,
      start, end: state, delta: movementDelta(start, state),
      summary: `Rick already satisfies '${until}' at (${state.hero.worldX}, ${state.hero.worldY}).`,
      guidance: 'The requested stop condition is already true; do not issue additional movement unless the task requires it.'
    };
  }

  bridge.setDebugControl(Number(directionMask) & 0xff);
  try {
    while (advancingSteps < limit && stalledSteps < 3) {
      stepCalls += 1;
      const advanced = forceOneSimulationFrame(bridge, directionMask);
      if (advanced) {
        advancingSteps += 1;
        stalledSteps = 0;
      } else {
        stalledSteps += 1;
      }
      state = gameplayAgentState(bridge);
      if (!advanced) continue;

      if (state.hero.worldX === previousX) unchangedX += 1;
      else unchangedX = 0;
      previousX = state.hero.worldX;
      wasAirborne = wasAirborne || (!state.hero.grounded && !state.hero.climbing);

      const blockedFrames = until === 'blocked' && state.hero.grounded && unchangedX >= blockedLimit
        ? unchangedX : 0;
      if (conditionReached({ until, state, start, targetX, blockedFrames, wasAirborne })) break;
    }
  } finally {
    bridge.setDebugControl(0);
  }

  const matched = conditionReached({
    until,
    state,
    start,
    targetX,
    blockedFrames: until === 'blocked' && state.hero.grounded && unchangedX >= blockedLimit ? unchangedX : 0,
    wasAirborne
  });
  const simulationStalled = stalledSteps >= 3;
  const stopReason = matched ? until : simulationStalled ? 'simulation_not_advancing' : 'max_frames';
  return {
    status: matched ? 'condition_reached' : simulationStalled ? 'simulation_not_advancing' : 'limit_reached',
    matched,
    stopReason,
    direction,
    requestedCondition: until,
    targetX: targetX == null ? null : Number(targetX),
    maxFrames: limit,
    framesAdvanced: advancingSteps,
    stepCalls,
    controlsReleased: true,
    start,
    end: state,
    delta: movementDelta(start, state),
    summary: matched
      ? `Stopped after ${advancingSteps} frame(s): '${until}' reached; Rick is ${state.hero.motion} at (${state.hero.worldX}, ${state.hero.worldY}).`
      : simulationStalled
        ? `Stopped because the native simulation did not advance; Rick remains ${state.hero.motion} at (${state.hero.worldX}, ${state.hero.worldY}).`
        : `Reached the ${limit}-frame safety limit before '${until}'; Rick is ${state.hero.motion} at (${state.hero.worldX}, ${state.hero.worldY}).`,
    guidance: matched
      ? 'Stop movement now: the requested semantic condition was reached. Use get_state only if more detail is needed.'
      : simulationStalled
        ? 'Do not fall back to canvas clicks or keyboard events. Check whether gameplay is paused/modal, then inspect state.'
        : 'Inspect end.hero. If the requested condition is still appropriate, call walk_until again rather than using synthetic keyboard input.'
  };
}
