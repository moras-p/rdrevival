export const AI_EXECUTOR_STATUS_LABELS = Object.freeze({
  0: 'idle',
  1: 'running',
  2: 'complete',
  3: 'diverged',
  4: 'watchdog'
});

export const AI_PRIMITIVE_LABELS = Object.freeze({
  0: 'none',
  1: 'walk',
  2: 'crawl',
  3: 'drop',
  4: 'jump',
  5: 'coyote-jump',
  6: 'ladder-up',
  7: 'ladder-down',
  8: 'exit',
  9: 'wait',
  10: 'dynamite',
  11: 'shoot',
  12: 'platform'
});

export const AI_GUARD_LABELS = Object.freeze({
  0:'always', 1:'x-in', 2:'y-in', 3:'dx-le', 4:'dx-ge', 5:'dy-le', 6:'dy-ge',
  7:'mode-is', 8:'support-is', 9:'ladder-is', 10:'vy-negative', 11:'vy-nonnegative',
  12:'mechanism-inactive', 13:'submap-changed', 14:'player-box-intersects',
  15:'feet-box-intersects', 16:'x-le', 17:'x-ge', 18:'room-changed', 19:'grounded',
  20:'not-climbing', 21:'bombs-le', 22:'bomb-inactive', 23:'phase-frames-ge',
  24:'actor-center-in', 25:'actor-direction-is', 26:'actor-active-is',
  27:'mechanism-active-is', 28:'actor-clear-of-box', 29:'actor-lethal-is', 30:'actor-step-is',
  31:'actor-reset-ready', 32:'actor-clear-and-receding', 33:'projectile-cycle-passed',
  34:'resettable-cycle-clear', 35:'actor-projectile-is', 36:'player-on-actor'
});

function call(bridge, name, args = [], fallback = 0) {
  try {
    const fn = bridge?.[name];
    return typeof fn === 'function' ? fn.apply(bridge, args) : fallback;
  } catch (_) {
    return fallback;
  }
}

export function aiPrimitiveLabel(kind) {
  const value = Number(kind) >>> 0;
  return AI_PRIMITIVE_LABELS[value] || `primitive-${value}`;
}

export function aiExecutorLabel(status) {
  const value = Number(status) >>> 0;
  return AI_EXECUTOR_STATUS_LABELS[value] || `status-${value}`;
}

export function decodeAiInputMask(mask) {
  const value = Number(mask) >>> 0;
  const controls = [];
  if (value & 0x01) controls.push('right');
  if (value & 0x02) controls.push('left');
  if (value & 0x04) controls.push('down');
  if (value & 0x08) controls.push('up');
  if (value & 0x10) controls.push('fire');
  return controls;
}

function phaseGuard(bridge, phase, guard) {
  const kind = call(bridge, 'aiPhaseGuardKind', [phase, guard]) >>> 0;
  return {
    kind,
    kindLabel: AI_GUARD_LABELS[kind] || `guard-${kind}`,
    a: call(bridge, 'aiPhaseGuardA', [phase, guard]) | 0,
    b: call(bridge, 'aiPhaseGuardB', [phase, guard]) | 0,
    c: call(bridge, 'aiPhaseGuardC', [phase, guard]) | 0,
    d: call(bridge, 'aiPhaseGuardD', [phase, guard]) | 0,
    id: call(bridge, 'aiPhaseGuardId', [phase, guard]) >>> 0
  };
}

export function aiPhaseRecord(bridge, index) {
  const phase = Math.max(0, Number(index) | 0);
  const inputMask = call(bridge, 'aiPhaseInput', [phase]) >>> 0;
  const guardCount = Math.min(4, call(bridge, 'aiPhaseGuardCount', [phase]) >>> 0);
  const guards = [];
  for (let guard = 0; guard < guardCount; guard += 1) guards.push(phaseGuard(bridge, phase, guard));
  return {
    index: phase,
    inputMask,
    controls: decodeAiInputMask(inputMask),
    watchdogFrames: call(bridge, 'aiPhaseWatchdog', [phase]) >>> 0,
    guards
  };
}

export function aiPlanWindow(bridge, { radius = 2, maxPhases = 7 } = {}) {
  const phaseCount = call(bridge, 'aiPhaseCount') >>> 0;
  const current = Math.min(phaseCount ? phaseCount - 1 : 0, call(bridge, 'aiPhaseIndex') >>> 0);
  if (!phaseCount) return { currentIndex: 0, phaseCount: 0, phases: [] };
  const wanted = Math.max(1, Math.min(15, Number(maxPhases) | 0));
  let first = Math.max(0, current - Math.max(0, Number(radius) | 0));
  let last = Math.min(phaseCount, first + wanted);
  first = Math.max(0, last - wanted);
  const phases = [];
  for (let i = first; i < last; i += 1) phases.push(aiPhaseRecord(bridge, i));
  return { currentIndex: current, phaseCount, firstIndex: first, phases };
}

export function aiRouteMetrics(bridge) {
  return {
    routeEdges: call(bridge, 'aiRouteEdgeCount') >>> 0,
    phases: call(bridge, 'aiPhaseCount') >>> 0,
    segments: call(bridge, 'aiSegmentCount') >>> 0,
    replans: call(bridge, 'aiReplanCount') >>> 0,
    hazardFrames: call(bridge, 'aiRouteHazardContacts') >>> 0,
    deathEpisodes: call(bridge, 'aiRouteDeathEpisodes') >>> 0,
    hazardousEdges: call(bridge, 'aiHazardousRouteEdges') >>> 0,
    bombsUsed: call(bridge, 'aiRouteBombsUsed') >>> 0,
    bulletsUsed: call(bridge, 'aiRouteBulletsUsed') >>> 0,
    collectibles: call(bridge, 'aiRouteCollectibles') >>> 0,
    projectileCrawls: call(bridge, 'aiRouteProjectileCrawls') >>> 0,
    crossfireActions: call(bridge, 'aiRouteCrossfireActions') >>> 0,
    resetTriggers: call(bridge, 'aiRouteResetTriggers') >>> 0,
    timedBlockages: call(bridge, 'aiRouteTimedBlockages') >>> 0,
    remoteDemolitions: call(bridge, 'aiRouteRemoteDemolitions') >>> 0,
    prerequisiteClears: call(bridge, 'aiRoutePrerequisiteClears') >>> 0,
    mechanismActivations: call(bridge, 'aiRouteMechanismActivations') >>> 0,
    platformActivations: call(bridge, 'aiRoutePlatformActivations') >>> 0,
    implicitNeutralFrames: call(bridge, 'aiImplicitNeutralFrames') >>> 0
  };
}

/**
 * A certified partial that committed an irreversible native prerequisite is a
 * planning horizon, not an external-agent blockage. The one-call WebMCP driver
 * may recapture that exact live state and continue, but ordinary locomotion
 * partials still hand off so it never invents browser-side pathfinding.
 */
export function shouldAutoContinueAiHorizon(advance, state, autoReplans = 0, maxAutoReplans = 8) {
  const metrics = state?.planner?.routeMetrics || {};
  const committedPrerequisite = Number(metrics.prerequisiteClears || 0) > 0 ||
    Number(metrics.mechanismActivations || 0) > 0 ||
    Number(metrics.platformActivations || 0) > 0;
  return advance?.status === 'handoff_required' &&
    Number(advance?.framesAdvanced || 0) > 0 &&
    !!state?.planner?.partial &&
    state?.planner?.executor?.statusLabel === 'complete' &&
    !state?.controller?.active &&
    committedPrerequisite &&
    Number(autoReplans || 0) < Math.max(1, Number(maxAutoReplans || 0) | 0);
}

export function aiPlannerDiagnostics(bridge) {
  return {
    outcome:call(bridge, 'aiOutcome') >>> 0,
    semanticStateHash:call(bridge, 'aiSemanticStateHash') >>> 0,
    topologyEpoch:call(bridge, 'aiTopologyEpoch') >>> 0,
    unresolvedTransitions:call(bridge, 'aiUnresolvedTransitionCount') >>> 0,
    repeatedSemanticStates:call(bridge, 'aiRepeatedSemanticStateCount') >>> 0,
    replanCycles:call(bridge, 'aiReplanCycleCount') >>> 0,
    failureCacheHits:call(bridge, 'aiFailureCacheHits') >>> 0,
    avoidedProofs:call(bridge, 'aiAvoidedProofAttempts') >>> 0,
    repeatedBlockers:call(bridge, 'aiRepeatedBlockerCount') >>> 0,
    localSalvageAttempts:call(bridge, 'aiLocalSalvageAttempts') >>> 0,
    proofWorkLimitHits:call(bridge, 'aiProofWorkLimitHits') >>> 0,
    mutationCandidates:call(bridge, 'aiMutationCandidateCount') >>> 0,
    causalPrerequisites:call(bridge, 'aiCausalPrerequisiteCount') >>> 0,
    causalMutationsSelected:call(bridge, 'aiCausalMutationsSelected') >>> 0,
    topologyRecaptures:call(bridge, 'aiTopologyRecaptures') >>> 0,
    staticExitReachable:!!call(bridge, 'aiStaticExitReachable'),
    causalPrerequisiteRequired:!!call(bridge, 'aiCausalPrerequisiteRequired'),
    timingPredictableEdges:call(bridge, 'aiTimingPredictableEdgeCount') >>> 0,
    timingNarrowEdges:call(bridge, 'aiTimingNarrowEdgeCount') >>> 0,
    timingBlockedEdges:call(bridge, 'aiTimingBlockedEdgeCount') >>> 0,
    timingWaitEdges:call(bridge, 'aiTimingWaitEdgeCount') >>> 0,
    reactiveExposureEdges:call(bridge, 'aiReactiveExposureEdgeCount') >>> 0,
    reactiveExposureTotal:call(bridge, 'aiReactiveExposureTotal') >>> 0,
    mutationSelection:{
      kind:call(bridge, 'aiMutationSelectedKind') >>> 0,
      from:call(bridge, 'aiMutationSelectedFrom') >>> 0,
      to:call(bridge, 'aiMutationSelectedTo') >>> 0,
      mechanism:call(bridge, 'aiMutationSelectedMechanism') >>> 0,
      mechanismId:call(bridge, 'aiMutationSelectedMechanismId') >>> 0,
      feasibility:call(bridge, 'aiMutationFeasibility') >>> 0
    }
  };
}

function aiSupportRecord(bridge, index, supportCount) {
  const node = Number(index) >>> 0;
  if (node >= supportCount) return null;
  const x0 = call(bridge, 'aiSupportX0', [node]) | 0;
  const x1 = call(bridge, 'aiSupportX1', [node]) | 0;
  const y = call(bridge, 'aiSupportY', [node]) | 0;
  return {
    index:node,
    id:call(bridge, 'aiSupportId', [node]) >>> 0,
    x0, x1, y,
    x:Math.round((x0 + x1) / 2),
    clearance:call(bridge, 'aiSupportClearance', [node]) >>> 0,
    type:call(bridge, 'aiSupportType', [node]) >>> 0
  };
}

function routePoint(x, y, support) {
  const px = Number(x) | 0;
  const py = Number(y) | 0;
  if (support && px === 0 && py === 0 && (support.x !== 0 || support.y !== 0)) {
    return { x:support.x, y:support.y };
  }
  return { x:px, y:py };
}

/**
 * Read the exact native GAI route certificate into a renderer-neutral model.
 * Route coordinates are native RDX world pixels. Consumers may pair this with
 * the Level Editor projector without duplicating world/collision semantics.
 */
export function readGaiRoutePlan(bridge, { submap = null, room = '' } = {}) {
  const supportCount = Math.min(512, call(bridge, 'aiSupportCount') >>> 0);
  const supportCache = new Map();
  const support = index => {
    const node = Number(index) >>> 0;
    if (!supportCache.has(node)) supportCache.set(node, aiSupportRecord(bridge, node, supportCount));
    return supportCache.get(node);
  };
  const count = Math.min(512, call(bridge, 'aiRouteDebugCount') >>> 0);
  const certifiedEdges = [];
  for (let index = 0; index < count; index += 1) {
    const from = call(bridge, 'aiRouteDebugFrom', [index]) >>> 0;
    const to = call(bridge, 'aiRouteDebugTo', [index]) >>> 0;
    const kind = call(bridge, 'aiRouteDebugKind', [index]) >>> 0;
    const sourceSupport = support(from);
    const targetSupport = support(to);
    const source = routePoint(
      call(bridge, 'aiRouteDebugProvedLaunchX', [index]),
      call(bridge, 'aiRouteDebugSourceY', [index]),
      sourceSupport
    );
    const sourceContact = routePoint(
      call(bridge, 'aiRouteDebugSourceContactX', [index]),
      call(bridge, 'aiRouteDebugSourceContactY', [index]),
      null
    );
    const destinationEntry = routePoint(
      call(bridge, 'aiRouteDebugDestinationEntryX', [index]),
      call(bridge, 'aiRouteDebugDestinationEntryY', [index]),
      null
    );
    /* EXIT is a source-room edge. Its line terminates at the native ML20
     * contact geometry; the post-transition landing is destination metadata
     * only and must never be projected back into the source room. */
    const target = kind === 8 ? sourceContact : routePoint(
      call(bridge, 'aiRouteDebugProvedLandingX', [index]),
      call(bridge, 'aiRouteDebugTargetY', [index]),
      targetSupport
    );
    certifiedEdges.push({
      index, certified:true, from, to, kind, kindLabel:aiPrimitiveLabel(kind),
      sourceId:call(bridge, 'aiRouteDebugSourceId', [index]) >>> 0,
      targetId:call(bridge, 'aiRouteDebugTargetId', [index]) >>> 0,
      source, target, sourceSupport, targetSupport,
      sourceContact:kind === 8 ? sourceContact : null,
      destinationEntry:kind === 8 ? destinationEntry : null,
      destinationSubmap:kind === 8 ? call(bridge, 'aiRouteDebugDestinationSubmap', [index]) >>> 0 : null,
      launchRange:[
        call(bridge, 'aiRouteDebugLaunchX0', [index]) | 0,
        call(bridge, 'aiRouteDebugLaunchX1', [index]) | 0
      ],
      frames:call(bridge, 'aiRouteDebugFrames', [index]) >>> 0,
      hazardContacts:call(bridge, 'aiRouteDebugHazardContacts', [index]) >>> 0,
      deathEpisodes:call(bridge, 'aiRouteDebugDeathEpisodes', [index]) >>> 0,
      safeWaitFrames:call(bridge, 'aiRouteDebugSafeWaitFrames', [index]) >>> 0,
      timingCalculatedWait:call(bridge, 'aiRouteDebugTimingCalculatedWait', [index]) >>> 0,
      timingStableWait:call(bridge, 'aiRouteDebugTimingStableWait', [index]) >>> 0,
      timingSafeWindowFrames:call(bridge, 'aiRouteDebugTimingSafeWindowFrames', [index]) >>> 0,
      activationWaitFrames:call(bridge, 'aiRouteDebugActivationWaitFrames', [index]) >>> 0,
      activationStartDelayFrames:call(bridge, 'aiRouteDebugActivationStartDelayFrames', [index]) >>> 0,
      safeWaitX:call(bridge, 'aiRouteDebugSafeWaitX', [index]) | 0,
      activationWaitX:call(bridge, 'aiRouteDebugActivationWaitX', [index]) | 0,
      safeWaitInputMask:call(bridge, 'aiRouteDebugSafeWaitInputMask', [index]) >>> 0,
      activationWaitInputMask:call(bridge, 'aiRouteDebugActivationWaitInputMask', [index]) >>> 0,
      timingPredictableHazard:!!call(bridge, 'aiRouteDebugTimingPredictableHazard', [index]),
      timingWindowFound:!!call(bridge, 'aiRouteDebugTimingWindowFound', [index]),
      timingHoldAttempts:call(bridge, 'aiRouteDebugTimingHoldAttempts', [index]) >>> 0,
      fallSegmentCount:call(bridge, 'aiRouteDebugFallSegmentCount', [index]) >>> 0,
      demolitionOnly:!!call(bridge, 'aiRouteDebugDemolitionOnly', [index]),
      observedActivationPlatform:!!call(bridge, 'aiRouteDebugObservedActivationPlatform', [index]),
      observedActivationActorId:call(bridge, 'aiRouteDebugObservedActivationActorId', [index]) >>> 0,
      speculative:{
        enemyRisk:call(bridge, 'aiRouteDebugSpeculativeEnemyRisk', [index]) >>> 0,
        reactiveExposure:call(bridge, 'aiRouteDebugReactiveExposure', [index]) >>> 0,
        predictedWaitFrames:call(bridge, 'aiRouteDebugPredictedWaitFrames', [index]) >>> 0,
        safeWindowFrames:call(bridge, 'aiRouteDebugPredictedSafeWindowFrames', [index]) >>> 0,
        timingState:call(bridge, 'aiRouteDebugSpeculativeTimingState', [index]) >>> 0
      },
      mutation:{
        effectClass:call(bridge, 'aiRouteDebugMutationEffectClass', [index]) >>> 0,
        evidence:call(bridge, 'aiRouteDebugMutationEvidence', [index]) >>> 0,
        priority:call(bridge, 'aiRouteDebugMutationPriority', [index]) >>> 0,
        causalPrerequisite:!!call(bridge, 'aiRouteDebugCausalPrerequisite', [index])
      },
      exactProofSafe:!!call(bridge, 'aiRouteDebugExactProofSafe', [index]),
      bombs:call(bridge, 'aiRouteDebugBombs', [index]) >>> 0,
      bullets:call(bridge, 'aiRouteDebugBullets', [index]) >>> 0
    });
  }

  const blockingKind = call(bridge, 'aiBlockingKind') >>> 0;
  let blocker = null;
  if (blockingKind) {
    const from = call(bridge, 'aiBlockingFrom') >>> 0;
    const to = call(bridge, 'aiBlockingTo') >>> 0;
    const last = certifiedEdges.at(-1);
    const sourceSupport = support(from);
    const targetSupport = support(to);
    const lastProofMatches = (call(bridge, 'aiLastProofKind') >>> 0) === blockingKind &&
      (call(bridge, 'aiLastProofFrom') >>> 0) === from &&
      (call(bridge, 'aiLastProofTo') >>> 0) === to;
    const source = last?.to === from ? last.target : routePoint(
      lastProofMatches ? call(bridge, 'aiLastProofPlayerX') : sourceSupport?.x,
      lastProofMatches ? call(bridge, 'aiLastProofPlayerY') : sourceSupport?.y,
      sourceSupport
    );
    const target = routePoint(
      targetSupport?.x ?? (lastProofMatches ? call(bridge, 'aiLastProofLandingX') : source.x),
      targetSupport?.y ?? source.y,
      targetSupport
    );
    blocker = {
      index:certifiedEdges.length, certified:false, blocked:true,
      from, to, kind:blockingKind, kindLabel:aiPrimitiveLabel(blockingKind),
      source, target, sourceSupport, targetSupport,
      targetId:lastProofMatches ? call(bridge, 'aiLastProofTargetId') >>> 0 : 0,
      proofStage:lastProofMatches ? call(bridge, 'aiLastProofFailureStage') >>> 0 : 0,
      launchX:lastProofMatches ? call(bridge, 'aiLastProofLaunchX') | 0 : source.x,
      landingX:lastProofMatches ? call(bridge, 'aiLastProofLandingX') | 0 : target.x,
      hazardContacts:lastProofMatches ? call(bridge, 'aiLastProofHazardContacts') >>> 0 : 0,
      deathEpisodes:lastProofMatches ? call(bridge, 'aiLastProofDeathEpisodes') >>> 0 : 0
    };
  }

  const edges = blocker ? [...certifiedEdges, blocker] : certifiedEdges;
  const steps = [];
  if (edges.length) {
    const first = edges[0];
    steps.push({ index:0, nodeId:first.from, point:first.source, support:first.sourceSupport, incoming:null, blocked:false });
    for (const edge of edges) {
      const previous = steps.at(-1);
      if (previous?.nodeId !== edge.from) {
        steps.push({ index:steps.length, nodeId:edge.from, point:edge.source, support:edge.sourceSupport, incoming:null, blocked:!edge.certified });
      }
      steps.push({
        index:steps.length, nodeId:edge.to, point:edge.target, support:edge.targetSupport,
        incoming:edge, blocked:!edge.certified
      });
    }
  }

  const complete = !!call(bridge, 'aiCompletePlan');
  const partial = !!call(bridge, 'aiPartialPlan');
  return {
    schema:'rdr.gai.route-inspector.v1',
    submap:submap == null ? null : Number(submap) >>> 0,
    room:String(room || ''),
    complete, partial,
    status:complete ? 'complete' : partial ? 'partial' : blocker ? 'blocked' : count ? 'certified-prefix' : 'empty',
    supportCount,
    certifiedEdgeCount:certifiedEdges.length,
    routeEdgeCount:call(bridge, 'aiRouteEdgeCount') >>> 0,
    phaseCount:call(bridge, 'aiPhaseCount') >>> 0,
    startNode:call(bridge, 'aiStartNode') >>> 0,
    goalNode:call(bridge, 'aiGoalNode') >>> 0,
    layoutHash:call(bridge, 'aiLayoutHash') >>> 0,
    blocker, edges, steps,
    metrics:aiRouteMetrics(bridge),
    planner:aiPlannerDiagnostics(bridge),
    capturedPlayer:{
      x:call(bridge, 'aiPlayerX') | 0,
      y:call(bridge, 'aiPlayerY') | 0,
      supportId:call(bridge, 'aiPlayerSupportId') >>> 0
    }
  };
}

function forceNativeFrame(bridge) {
  const before = Number(bridge.snapshot()?.frameSerial || 0) >>> 0;
  if (bridge.debugForceBrowserFrame) bridge.debugForceBrowserFrame();
  else bridge.forceBrowserFrame();
  const after = Number(bridge.snapshot()?.frameSerial || 0) >>> 0;
  return after !== before;
}

export async function waitForAiTransitionReady({
  yieldForPaint,
  beginAudioHold,
  yieldForAudioQuiesce,
  cancelled = () => false
} = {}) {
  if (typeof yieldForPaint === 'function') await yieldForPaint();
  if (cancelled()) return { ready:false, cancelled:true, audioHeld:false };
  if (typeof beginAudioHold === 'function') beginAudioHold();
  if (typeof yieldForAudioQuiesce === 'function') await yieldForAudioQuiesce();
  if (cancelled()) return { ready:false, cancelled:true, audioHeld:true };
  return { ready:true, cancelled:false, audioHeld:true };
}

export function settleAiDestinationEntry({
  snapshot,
  forceNeutralFrame,
  cancelled = () => false,
  expectedSubmap = null,
  maxFrames = 96
} = {}) {
  const limit = Math.max(1, Math.min(240, Number(maxFrames) | 0));
  let current = typeof snapshot === 'function' ? snapshot() : null;
  let frames = 0;
  for (; frames <= limit; frames += 1) {
    if (cancelled()) return { ready:false, cancelled:true, frames, reason:'cancelled', snapshot:current };
    const submap = Number(current?.submap ?? -1) >>> 0;
    const native = current?.collision?.native || {};
    if (expectedSubmap != null && submap !== (Number(expectedSubmap) >>> 0))
      return { ready:false, cancelled:false, frames, reason:'room-changed', snapshot:current };
    if (native.playerActive && native.playerSpawnValid && native.playerGrounded)
      return { ready:true, cancelled:false, frames, reason:'grounded', snapshot:current };
    if (frames === limit || typeof forceNeutralFrame !== 'function') break;
    const before = Number(current?.frameSerial || 0) >>> 0;
    forceNeutralFrame();
    current = typeof snapshot === 'function' ? snapshot() : null;
    if ((Number(current?.frameSerial || 0) >>> 0) === before)
      return { ready:false, cancelled:false, frames, reason:'simulation-not-advancing', snapshot:current };
  }
  return { ready:false, cancelled:false, frames, reason:'entry-not-grounded', snapshot:current };
}

function advanceGuidance(status) {
  switch (status) {
    case 'handoff_required':
      return 'Inspect the AI report/blocker. If the native AI cannot extend the route, use rdr.gameplay.step_controls or rdr.gameplay.walk_until to move Rick through the blocker, then call rdr.ai.replan from that exact live state.';
    case 'room_transition':
      return 'The destination room must render before GAI continuation planning. Let the page render, then call rdr.ai.get_state or rdr.ai.advance again; do not manually advance the destination before that handoff completes.';
    case 'room_transition_pending_render':
      return 'Do not force another gameplay frame yet. The browser must render the destination entry state so the existing continuation planner can capture it exactly.';
    case 'simulation_not_advancing':
      return 'Do not fall back to keyboard input. Check for a paused/modal/title state, inspect gameplay state, then resume or replan as appropriate.';
    case 'planning':
      return 'AI planning owns the runtime. Wait for the synchronous/current planning transaction to finish, then inspect state before intervening.';
    case 'limit_reached':
      return 'The AI is still running. Call rdr.ai.advance again to continue, or inspect the current phase if you want to analyze its behavior before advancing farther.';
    default:
      return 'Inspect the returned executor/phase state and choose the next AI or gameplay site tool from that evidence.';
  }
}

/**
 * Deterministically execute the browser GAI controller without depending on
 * canvas focus, keyboard delivery, or requestAnimationFrame cadence.
 *
 * `tick(snapshot)` is the existing integration-owned AI controller step. It
 * selects the exact native AI input and handles executor terminal states. This
 * helper only supplies synchronous production-frame advancement around it.
 */
export function advanceAiAutoplay({ bridge, autoplay, tick, maxFrames = 1200 } = {}) {
  if (!bridge || typeof bridge.snapshot !== 'function' || typeof bridge.forceBrowserFrame !== 'function') {
    throw new Error('xrick runtime is not ready for AI advancement');
  }
  if (!autoplay || typeof tick !== 'function') throw new Error('AI autoplay controller is not ready');

  const limit = Math.max(1, Math.min(4000, Number(maxFrames) | 0));
  const start = bridge.snapshot();
  const startSubmap = Number(start?.submap || 0) >>> 0;
  const startSerial = Number(start?.frameSerial || 0) >>> 0;
  const startPhase = call(bridge, 'aiPhaseIndex') >>> 0;
  const startExecutorStatus = call(bridge, 'aiStatus') >>> 0;
  let framesAdvanced = 0;
  let forceCalls = 0;
  let phaseChanges = 0;
  let previousPhase = startPhase;
  let status = 'limit_reached';

  if (autoplay.planning) {
    status = 'planning';
  } else if (!autoplay.active) {
    status = 'handoff_required';
  } else if (autoplay.planSubmap >= 0 && startSubmap !== (Number(autoplay.planSubmap) >>> 0)) {
    status = 'room_transition_pending_render';
  } else {
    while (framesAdvanced < limit) {
      const before = bridge.snapshot();
      const beforeSubmap = Number(before?.submap || 0) >>> 0;
      if (autoplay.planSubmap >= 0 && beforeSubmap !== (Number(autoplay.planSubmap) >>> 0)) {
        status = 'room_transition_pending_render';
        break;
      }

      tick(before);
      if (autoplay.planning) {
        status = 'planning';
        break;
      }
      if (!autoplay.active) {
        status = 'handoff_required';
        break;
      }

      let advanced = false;
      for (let attempt = 0; attempt < 3 && !advanced; attempt += 1) {
        forceCalls += 1;
        advanced = forceNativeFrame(bridge);
      }
      if (!advanced) {
        status = 'simulation_not_advancing';
        break;
      }

      framesAdvanced += 1;
      const after = bridge.snapshot();
      if ((Number(after?.submap || 0) >>> 0) !== beforeSubmap) {
        status = 'room_transition';
        break;
      }
      const phase = call(bridge, 'aiPhaseIndex') >>> 0;
      if (phase !== previousPhase) {
        phaseChanges += 1;
        previousPhase = phase;
      }
    }

    if (framesAdvanced >= limit && autoplay.active && !autoplay.planning && (call(bridge, 'aiStatus') >>> 0) !== 1) {
      tick(bridge.snapshot());
      if (!autoplay.active) status = 'handoff_required';
      else if (autoplay.planning) status = 'planning';
    }
  }

  try { bridge.setDebugControl?.(0); } catch (_) {}
  const end = bridge.snapshot();
  const executorStatus = call(bridge, 'aiStatus') >>> 0;
  return {
    status,
    maxFrames: limit,
    framesAdvanced,
    forceCalls,
    phaseChanges,
    start: {
      submap: startSubmap,
      frameSerial: startSerial,
      phaseIndex: startPhase,
      executorStatus: startExecutorStatus,
      executorStatusLabel: aiExecutorLabel(startExecutorStatus)
    },
    end: {
      submap: Number(end?.submap || 0) >>> 0,
      frameSerial: Number(end?.frameSerial || 0) >>> 0,
      phaseIndex: call(bridge, 'aiPhaseIndex') >>> 0,
      executorStatus,
      executorStatusLabel: aiExecutorLabel(executorStatus),
      completePlan: !!call(bridge, 'aiCompletePlan'),
      partialPlan: !!call(bridge, 'aiPartialPlan')
    },
    guidance: advanceGuidance(status)
  };
}

/**
 * Cooperatively execute GAI in small deterministic chunks so the browser
 * gets a real paint opportunity between chunks. The caller owns frontend
 * pause semantics through beforeChunk/afterChunk; native AI semantics remain
 * in advanceAiAutoplay().
 */
export async function advanceAiAutoplayVisible({
  bridge, autoplay, tick, maxFrames = 1200, framesPerPaint = 2,
  beforeChunk = null, afterChunk = null, yieldForPaint = null
} = {}) {
  const limit = Math.max(1, Math.min(4000, Number(maxFrames) | 0));
  const chunkSize = Math.max(1, Math.min(60, Number(framesPerPaint) | 0));
  let framesAdvanced = 0;
  let forceCalls = 0;
  let phaseChanges = 0;
  let paintYields = 0;
  let status = 'limit_reached';
  let start = null;
  let end = null;
  let guidance = '';

  while (framesAdvanced < limit) {
    const remaining = limit - framesAdvanced;
    let chunk = null;
    if (typeof beforeChunk === 'function') beforeChunk();
    try {
      chunk = advanceAiAutoplay({
        bridge, autoplay, tick,
        maxFrames: Math.min(chunkSize, remaining)
      });
    } finally {
      if (typeof afterChunk === 'function') afterChunk();
    }

    if (!start) start = chunk.start;
    end = chunk.end;
    guidance = chunk.guidance;
    framesAdvanced += Number(chunk.framesAdvanced || 0);
    forceCalls += Number(chunk.forceCalls || 0);
    phaseChanges += Number(chunk.phaseChanges || 0);
    status = chunk.status;

    /* Freeze first, then yield. That lets the normal requestAnimationFrame
     * renderer present the just-advanced authoritative C frame without an
     * uncontrolled Emscripten tick occurring during the paint opportunity. */
    if ((chunk.framesAdvanced > 0 || status !== 'limit_reached') && typeof yieldForPaint === 'function') {
      paintYields += 1;
      await yieldForPaint(chunk);
    }

    if (status !== 'limit_reached') break;
    if (chunk.framesAdvanced <= 0) {
      status = 'simulation_not_advancing';
      guidance = advanceGuidance(status);
      break;
    }
  }

  return {
    status,
    maxFrames: limit,
    framesPerPaint: chunkSize,
    framesAdvanced,
    forceCalls,
    phaseChanges,
    paintYields,
    start: start || {
      submap: Number(bridge?.snapshot?.()?.submap || 0) >>> 0,
      frameSerial: Number(bridge?.snapshot?.()?.frameSerial || 0) >>> 0,
      phaseIndex: call(bridge, 'aiPhaseIndex') >>> 0,
      executorStatus: call(bridge, 'aiStatus') >>> 0,
      executorStatusLabel: aiExecutorLabel(call(bridge, 'aiStatus') >>> 0)
    },
    end: end || {
      submap: Number(bridge?.snapshot?.()?.submap || 0) >>> 0,
      frameSerial: Number(bridge?.snapshot?.()?.frameSerial || 0) >>> 0,
      phaseIndex: call(bridge, 'aiPhaseIndex') >>> 0,
      executorStatus: call(bridge, 'aiStatus') >>> 0,
      executorStatusLabel: aiExecutorLabel(call(bridge, 'aiStatus') >>> 0),
      completePlan: !!call(bridge, 'aiCompletePlan'),
      partialPlan: !!call(bridge, 'aiPartialPlan')
    },
    guidance: guidance || advanceGuidance(status)
  };
}
