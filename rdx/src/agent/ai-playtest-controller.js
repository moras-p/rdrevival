import { CollisionPolicyName } from '../collision/dataset.js';
import { forceGameplayDebugFrame, gameplayAgentState } from './gameplay-control.js';
import { advanceAiAutoplayVisible, aiExecutorLabel, aiPlanWindow, aiPrimitiveLabel, aiRouteMetrics, decodeAiInputMask, readGaiRoutePlan, settleAiDestinationEntry, shouldAutoContinueAiHorizon, waitForAiTransitionReady } from './ai-coach.js';
import { GaiRouteInspector } from './gai-route-inspector.js';

export function aiHorizonLoopDecision({
  advance, state, framesAdvanced = 0, maxFrames = 0, autoReplans = 0
} = {}) {
  if (!shouldAutoContinueAiHorizon(advance, state, autoReplans)) return 'handoff';
  return Number(framesAdvanced || 0) >= Number(maxFrames || 0)
    ? 'limit_reached' : 'replan';
}

export function createAiPlaytestController({ runtime, elements = {}, resourcesProvider = () => null, appVersion = 'unknown' } = {}) {
  if (!runtime) throw new Error('GAI browser controller requires a live runtime dependency object');
  const submapAssetName = submap => `SM${Number(submap).toString(16).toUpperCase().padStart(2, '0')}`;
  const { aiModeSelect, aiContinueToggle, aiRestartRunButton, aiRunButton, aiStopButton, aiStatus, aiCopyDebugButton,
    collisionPolicySelect, invulnerableToggle, gaiRouteInspectorRoot } = elements;
  const gaiRouteInspector = gaiRouteInspectorRoot ? new GaiRouteInspector({ root:gaiRouteInspectorRoot, resourcesProvider }) : null;

  const AI_EXECUTOR_IDLE = 0;
  const AI_EXECUTOR_RUNNING = 1;
  const AI_EXECUTOR_COMPLETE = 2;
  const AI_EXECUTOR_DIVERGED = 3;
  const AI_EXECUTOR_WATCHDOG = 4;
  const AI_INPUT_MASK = 0x1f;
  const AI_ROUTE_BASELINE_SLOT = 4;
  const AI_ROUTE_LIVE_SLOT = 5;
  const AI_BROWSER_RESTART_VALIDATION_BUDGET = 64;
  const aiAutoplay = {
    active:false, planning:false, scenario:2, deterministicRestart:true, fullRoomPlanning:true, continueRooms:true,
    planSubmap:-1, lastInputMask:0, completedAtSerial:-1, nextPlanToken:0, lastStatusSerial:-1, lastStop:null, coachControlled:false,
    autoReplans:0, planStartedAtSerial:0
  };
  let aiCoachSequence = 0;
  let aiCoachSession = null;
  let aiRouteSequence = 0;
  let aiRouteArtifact = null;

function speedModeLabel(mode) {
  return ({ 1: '1×', 2: '1.5×', 3: '2×' })[Number(mode)] || '1×';
}

function setAiPlayStatus(text, kind = 'neutral') {
  if (!aiStatus) return;
  aiStatus.textContent = String(text || 'AI idle');
  aiStatus.title = String(text || 'AI idle');
  if (kind === 'neutral') delete aiStatus.dataset.kind;
  else aiStatus.dataset.kind = kind;
}

function updateAiPlayButtons() {
  if (aiRestartRunButton) {
    aiRestartRunButton.disabled = !runtime.bridge || !runtime.renderer || aiAutoplay.planning || aiAutoplay.active;
    aiRestartRunButton.setAttribute('aria-pressed', aiAutoplay.active && aiAutoplay.deterministicRestart ? 'true' : 'false');
    aiRestartRunButton.textContent = aiAutoplay.planning && aiAutoplay.deterministicRestart ? 'Precomputing…' : '↻ Restart + AI play';
  }
  if (aiRunButton) {
    aiRunButton.disabled = !runtime.bridge || !runtime.renderer || aiAutoplay.planning || aiAutoplay.active;
    aiRunButton.setAttribute('aria-pressed', aiAutoplay.active && !aiAutoplay.deterministicRestart ? 'true' : 'false');
    aiRunButton.textContent = aiAutoplay.planning && !aiAutoplay.deterministicRestart ? 'Planning…' : '▶ AI live state';
  }
  if (aiStopButton) aiStopButton.disabled = !aiAutoplay.active && !aiAutoplay.planning;
  if (aiCopyDebugButton) aiCopyDebugButton.disabled = !runtime.bridge;
  if (aiModeSelect) aiModeSelect.disabled = aiAutoplay.active || aiAutoplay.planning;
}

function clearAiControl() {
  aiAutoplay.lastInputMask = 0;
  if (runtime.bridge) runtime.bridge.setDebugControl(0);
}

const AI_FAILURE_STAGE_LABELS = Object.freeze({
  0:'none', 1:'backend-unavailable', 2:'world-capture', 3:'full-entry-state',
  4:'runtime-protect', 5:'objective-begin', 6:'planner-alloc',
  7:'workspace-protect', 8:'graph-protect', 9:'start-support',
  10:'state-backend', 11:'state-alloc', 12:'state-save',
  13:'partial-state-protect', 14:'edge-state-protect', 15:'shortest-route',
  16:'no-certificate', 17:'final-compile', 18:'executor-start',
  19:'validation-budget'
});

const AI_PROOF_FAILURE_LABELS = {
  0:'none', 1:'primitive-synthesis', 2:'capture-before', 3:'compile',
  4:'executor-start', 5:'capture-during', 6:'executor-abort',
  7:'watchdog-budget', 8:'capture-after', 9:'endpoint-mismatch',
  10:'mortal-safety', 11:'rollback-state'
};

const AI_DROP_SEARCH_RESULT_LABELS = {
  0:'none', 1:'invalid-argument', 2:'target-not-lower',
  3:'no-walk-off-direction', 4:'state-save-failed', 5:'search-exhausted',
  6:'proved'
};

const AI_DROP_ATTEMPT_OUTCOME_LABELS = {
  0:'none', 1:'invalid-sequence', 2:'approach-failed', 3:'landed-target',
  4:'room-changed', 5:'intermediate-landing', 6:'frame-cap'
};

function aiFailureDetailLabel(stage, detail) {
  if (stage === 2 && detail === 1) return 'world-capture-failed';
  if (stage === 2 && detail === 2) return 'native-rdx-world-unavailable';
  if (stage === 3 && detail === 1) return 'state-size-zero';
  if (stage === 3 && detail === 2) return 'entry-state-allocation';
  if (stage === 3 && detail === 3) return 'entry-state-save';
  if (stage === 9 && detail === 1) return 'player-support-not-found';
  if (stage === 15 && detail === 1) return 'no-topology-route';
  if (stage === 16 && detail === 1) return 'proof-search-exhausted';
  return detail ? `detail-${detail}` : 'none';
}

function aiOptionalCall(name, fallback = 0) {
  try {
    const fn = runtime.bridge?.[name];
    return typeof fn === 'function' ? fn.call(runtime.bridge) : fallback;
  } catch (_) {
    return fallback;
  }
}

function aiOptionalIndexedCall(name, index, fallback = 0) {
  try {
    const fn = runtime.bridge?.[name];
    return typeof fn === 'function' ? fn.call(runtime.bridge, index) : fallback;
  } catch (_) {
    return fallback;
  }
}

function aiOptionalDoubleIndexedCall(name, first, second, fallback = 0) {
  try {
    const fn = runtime.bridge?.[name];
    return typeof fn === 'function' ? fn.call(runtime.bridge, first, second) : fallback;
  } catch (_) {
    return fallback;
  }
}

function aiPlannerDebugRecord(reason = '') {
  if (!runtime.bridge) return { reason, bridge:false };
  let snapshot = null;
  try { snapshot = runtime.bridge.snapshot(); } catch (_) {}
  const candidates = runtime.bridge.aiCandidateCounts?.() || {};
  const rejectionHistory = [];
  const rejectionCount = Math.min(32, aiOptionalCall('aiRejectionHistoryCount')>>>0);
  for (let i=0;i<rejectionCount;i+=1) {
    const stage = aiOptionalIndexedCall('aiRejectionProofStage', i)>>>0;
    rejectionHistory.push({
      index:i,
      kind:aiOptionalIndexedCall('aiRejectionKind', i)>>>0,
      kindLabel:aiPrimitiveLabel(aiOptionalIndexedCall('aiRejectionKind', i)>>>0),
      from:aiOptionalIndexedCall('aiRejectionFrom', i)>>>0,
      to:aiOptionalIndexedCall('aiRejectionTo', i)>>>0,
      proofStage:stage,
      proofStageLabel:AI_PROOF_FAILURE_LABELS[stage] || 'unknown',
      executorStatus:aiOptionalIndexedCall('aiRejectionExecutorStatus', i)>>>0,
      inputMask:aiOptionalIndexedCall('aiRejectionInputMask', i)>>>0,
      controls:decodeAiInputMask(aiOptionalIndexedCall('aiRejectionInputMask', i)>>>0),
      frame:aiOptionalIndexedCall('aiRejectionFrame', i)>>>0,
      phase:aiOptionalIndexedCall('aiRejectionPhase', i)>>>0,
      playerX:aiOptionalIndexedCall('aiRejectionPlayerX', i)|0,
      playerY:aiOptionalIndexedCall('aiRejectionPlayerY', i)|0,
      playerSupportId:aiOptionalIndexedCall('aiRejectionPlayerSupportId', i)>>>0,
      launchX:aiOptionalIndexedCall('aiRejectionLaunchX', i)|0,
      landingX:aiOptionalIndexedCall('aiRejectionLandingX', i)|0
    });
  }
  const dropAttemptCount = Math.min(128, aiOptionalCall('aiDropSearchAttemptCount')>>>0);
  const dropSearchResult = aiOptionalCall('aiDropSearchResult')>>>0;
  const dropAttempts = [];
  for (let i=0;i<dropAttemptCount;i+=1) {
    const segmentCount = Math.min(4, aiOptionalIndexedCall('aiDropAttemptSegmentCount', i)>>>0);
    const controlSegments = [];
    for (let segment=0;segment<segmentCount;segment+=1) {
      const inputMask = aiOptionalDoubleIndexedCall('aiDropAttemptInputMask', i, segment)>>>0;
      controlSegments.push({
        inputMask,
        controls:decodeAiInputMask(inputMask),
        frames:aiOptionalDoubleIndexedCall('aiDropAttemptInputFrames', i, segment)>>>0,
        continuous:segment + 1 === segmentCount &&
          !(aiOptionalDoubleIndexedCall('aiDropAttemptInputFrames', i, segment)>>>0)
      });
    }
    const outcome = aiOptionalIndexedCall('aiDropAttemptOutcome', i)>>>0;
    dropAttempts.push({
      index:i,
      outcome,
      outcomeLabel:AI_DROP_ATTEMPT_OUTCOME_LABELS[outcome] || 'unknown',
      forceCrawl:!!aiOptionalIndexedCall('aiDropAttemptForceCrawl', i),
      requestedLaunchX:aiOptionalIndexedCall('aiDropAttemptRequestedLaunchX', i)|0,
      actualLaunchX:aiOptionalIndexedCall('aiDropAttemptActualLaunchX', i)|0,
      framesSimulated:aiOptionalIndexedCall('aiDropAttemptFramesSimulated', i)>>>0,
      endX:aiOptionalIndexedCall('aiDropAttemptEndX', i)|0,
      endY:aiOptionalIndexedCall('aiDropAttemptEndY', i)|0,
      endSupportId:aiOptionalIndexedCall('aiDropAttemptEndSupportId', i)>>>0,
      authoritativeHazards:aiOptionalIndexedCall('aiDropAttemptHazardContacts', i)>>>0,
      deathEpisodes:aiOptionalIndexedCall('aiDropAttemptDeathEpisodes', i)>>>0,
      controlSegments
    });
  }
  const dropSearch = (dropSearchResult || dropAttempts.length) ? {
    result:dropSearchResult,
    resultLabel:AI_DROP_SEARCH_RESULT_LABELS[dropSearchResult] || 'unknown',
    preferSafe:!!aiOptionalCall('aiDropSearchPreferSafe'),
    landingHintUsed:!!aiOptionalCall('aiDropSearchLandingHintUsed'),
    attemptsTruncated:!!aiOptionalCall('aiDropSearchAttemptsTruncated'),
    source:{
      id:aiOptionalCall('aiDropSearchSourceId')>>>0,
      x0:aiOptionalCall('aiDropSearchSourceX0')|0,
      x1:aiOptionalCall('aiDropSearchSourceX1')|0,
      y:aiOptionalCall('aiDropSearchSourceY')|0
    },
    target:{
      id:aiOptionalCall('aiDropSearchTargetId')>>>0,
      x0:aiOptionalCall('aiDropSearchTargetX0')|0,
      x1:aiOptionalCall('aiDropSearchTargetX1')|0,
      y:aiOptionalCall('aiDropSearchTargetY')|0
    },
    preferredLandingX:aiOptionalCall('aiDropSearchPreferredLandingX')|0,
    attempts:dropAttempts
  } : null;
  return {
    schema:'rdr.gai.browser_debug.v1',
    appVersion,
    reason:String(reason || ''),
    room:submapAssetName(runtime.bridge.submap()),
    submap:runtime.bridge.submap() >>> 0,
    scenario:aiAutoplay.scenario >>> 0,
    deterministicRestart:!!aiAutoplay.deterministicRestart,
    preferSafe:!!runtime.bridge.aiPreferSafe(),
    backend:{ available:!!runtime.bridge.aiBackendAvailable(), kind:runtime.bridge.aiBackendKind()>>>0 },
    gameplayTuning:{
      walkSpeed:runtime.bridge.walkSpeed?.() ?? null,
      coyoteFrames:runtime.bridge.coyoteFrames?.() ?? null,
      jumpBufferFrames:runtime.bridge.jumpBufferFrames?.() ?? null,
      jumpTakeoff:runtime.bridge.jumpTakeoff?.() ?? null,
      gravity:runtime.bridge.gravity?.() ?? null,
      apexGravityPercent:runtime.bridge.apexGravityPercent?.() ?? null,
      jumpReleasePercent:runtime.bridge.jumpReleasePercent?.() ?? null,
      maxFall:runtime.bridge.maxFall?.() ?? null,
      ceilingCorrection:runtime.bridge.ceilingCorrection?.() ?? null,
      groundSnap:runtime.bridge.groundSnap?.() ?? null,
      fallBounceMinHeight:runtime.bridge.fallBounceMinHeight?.() ?? null
    },
    planner:{
      failureStage:runtime.bridge.aiFailureStage()>>>0,
      failureStageLabel:AI_FAILURE_STAGE_LABELS[runtime.bridge.aiFailureStage()>>>0] || 'unknown',
      failureDetail:runtime.bridge.aiFailureDetail()>>>0,
      failureDetailLabel:aiFailureDetailLabel(runtime.bridge.aiFailureStage()>>>0, runtime.bridge.aiFailureDetail()>>>0),
      nodes:runtime.bridge.aiNodeCount()>>>0,
      edges:runtime.bridge.aiEdgeCount()>>>0,
      startNode:runtime.bridge.aiStartNode()>>>0,
      goalNode:runtime.bridge.aiGoalNode()>>>0,
      validationAttempts:runtime.bridge.aiValidationAttempts()>>>0,
      validationBudget:aiOptionalCall('aiValidationBudget')>>>0,
      budgetExhausted:!!aiOptionalCall('aiBudgetExhausted'),
      bestGoalDistance:aiOptionalCall('aiBestGoalDistance')>>>0,
      bestPrefixUpdates:aiOptionalCall('aiBestPrefixUpdates')>>>0,
      dominatedRouteCandidates:aiOptionalCall('aiDominatedRouteCandidates')>>>0,
      provedEdges:runtime.bridge.aiProvedEdgeCount()>>>0,
      rejectedEdges:runtime.bridge.aiRejectedEdgeCount()>>>0,
      candidates,
      blocker:{
        kind:runtime.bridge.aiBlockingKind()>>>0,
        kindLabel:aiPrimitiveLabel(runtime.bridge.aiBlockingKind()>>>0),
        from:runtime.bridge.aiBlockingFrom()>>>0,
        to:runtime.bridge.aiBlockingTo()>>>0
      },
      complete:!!runtime.bridge.aiCompletePlan(), partial:!!runtime.bridge.aiPartialPlan(),
      phases:runtime.bridge.aiPhaseCount()>>>0, routeEdges:runtime.bridge.aiRouteEdgeCount()>>>0,
      segments:runtime.bridge.aiSegmentCount()>>>0, replans:runtime.bridge.aiReplanCount()>>>0,
      routeMetrics:aiRouteMetrics(runtime.bridge),
      executor:{
        status:runtime.bridge.aiStatus()>>>0,
        statusLabel:aiExecutorLabel(runtime.bridge.aiStatus()>>>0),
        phaseIndex:runtime.bridge.aiPhaseIndex()>>>0,
        planWindow:aiPlanWindow(runtime.bridge, { radius:1, maxPhases:5 })
      },
      lastProof:{
        stage:aiOptionalCall('aiLastProofFailureStage')>>>0,
        stageLabel:AI_PROOF_FAILURE_LABELS[aiOptionalCall('aiLastProofFailureStage')>>>0] || 'unknown',
        kind:aiOptionalCall('aiLastProofKind')>>>0,
        kindLabel:aiPrimitiveLabel(aiOptionalCall('aiLastProofKind')>>>0),
        from:aiOptionalCall('aiLastProofFrom')>>>0, to:aiOptionalCall('aiLastProofTo')>>>0,
        frame:aiOptionalCall('aiLastProofFrame')>>>0, phase:aiOptionalCall('aiLastProofPhase')>>>0,
        executorStatus:aiOptionalCall('aiLastProofExecutorStatus')>>>0,
        inputMask:aiOptionalCall('aiLastProofInputMask')>>>0,
        controls:decodeAiInputMask(aiOptionalCall('aiLastProofInputMask')>>>0),
        playerX:aiOptionalCall('aiLastProofPlayerX')|0, playerY:aiOptionalCall('aiLastProofPlayerY')|0,
        playerSupportId:aiOptionalCall('aiLastProofPlayerSupportId')>>>0,
        targetId:aiOptionalCall('aiLastProofTargetId')>>>0,
        launchX:aiOptionalCall('aiLastProofLaunchX')|0, landingX:aiOptionalCall('aiLastProofLandingX')|0,
        authoritativeHazards:aiOptionalCall('aiLastProofHazardContacts')>>>0,
        deathEpisodes:aiOptionalCall('aiLastProofDeathEpisodes')>>>0
      },
      dropSearch,
      rejectionHistory
    },
    capturedWorld:{
      nativeRdx:!!runtime.bridge.aiWorldNativeRdx(),
      playerX:runtime.bridge.aiPlayerX()|0,
      playerY:runtime.bridge.aiPlayerY()|0,
      playerSupportId:runtime.bridge.aiPlayerSupportId()>>>0,
      supports:runtime.bridge.aiSupportCount()>>>0,
      exits:runtime.bridge.aiExitCount()>>>0,
      actors:runtime.bridge.aiActorCount()>>>0,
      mechanisms:runtime.bridge.aiMechanismCount()>>>0,
      frameSerial:runtime.bridge.aiWorldFrameSerial()>>>0,
      layoutHash:runtime.bridge.aiLayoutHash()>>>0
    },
    live:{
      frameSerial:Number(snapshot?.frameSerial || 0)>>>0,
      gameState:Number(snapshot?.gameState || 0)>>>0,
      submap:Number(snapshot?.submap ?? runtime.bridge.submap())>>>0,
      map:Number(snapshot?.map || 0)>>>0,
      expectedMappedMd:runtime.bridge.mappedMdForSubmap(snapshot?.submap ?? runtime.bridge.submap())>>>0,
      collisionMapId:Number(snapshot?.collision?.mapId ?? 0xffff)>>>0,
      collisionAvailability:Number(snapshot?.collision?.availability || 0)>>>0,
      collisionDatasetHash:Number(snapshot?.collision?.datasetHash || 0)>>>0,
      nativeWorldLoaded:!!snapshot?.collision?.native?.worldLoaded,
      nativeWorldReady:!!snapshot?.collision?.native?.worldReady,
      nativeWorldMapId:Number(snapshot?.collision?.native?.mapId ?? 0xffff)>>>0,
      nativeWorldCapabilities:Number(snapshot?.collision?.native?.capabilities || 0)>>>0,
      nativeWorldGeneration:Number(snapshot?.collision?.native?.worldGeneration || 0)>>>0,
      nativeWorldMutations:Number(snapshot?.collision?.native?.mutationCount || 0)>>>0,
      nativeWorldUnsupportedContacts:Number(snapshot?.collision?.native?.unsupportedContacts || 0)>>>0,
      nativeWorldInvalidSpawn:!!snapshot?.collision?.native?.invalidSpawn,
      nativePlayerActive:!!snapshot?.collision?.native?.playerActive,
      nativePlayerGrounded:!!snapshot?.collision?.native?.playerGrounded,
      nativePlayerSpawnValid:!!snapshot?.collision?.native?.playerSpawnValid,
      collisionPolicy:Number(snapshot?.collision?.policy || 0)>>>0,
      collisionRuntimeActiveKey:String(runtime.collisionRuntime?.activeKey || '')
    }
  };
}

function beginAiCoachSession(configuration = {}) {
  const gameplay = gameplayAgentState(runtime.bridge);
  aiCoachSession = {
    schema:'rdr.gai.coach_session.v1',
    id:`coach-${++aiCoachSequence}`,
    configuration:{ ...configuration },
    start:{
      submap:gameplay.submap,
      frameSerial:gameplay.frameSerial,
      hero:{ worldX:gameplay.hero.worldX, worldY:gameplay.hero.worldY, motion:gameplay.hero.motion }
    },
    events:[],
    nextEventIndex:0,
    counters:{
      plannerRuns:0,
      planningMs:0,
      aiFrames:0,
      manualInterventions:0,
      manualFrames:0,
      roomTransitions:0,
      handoffs:0
    }
  };
  return aiCoachSession;
}

function ensureAiCoachSession(configuration = {}) {
  return aiCoachSession || beginAiCoachSession(configuration);
}

function recordAiCoachEvent(type, data = {}) {
  if (!aiCoachSession) return null;
  const gameplay = runtime.bridge ? gameplayAgentState(runtime.bridge) : null;
  const event = {
    index:aiCoachSession.nextEventIndex++,
    type:String(type || 'event'),
    submap:gameplay?.submap ?? null,
    frameSerial:gameplay?.frameSerial ?? null,
    ...data
  };
  aiCoachSession.events.push(event);
  if (aiCoachSession.events.length > 96) aiCoachSession.events.splice(0, aiCoachSession.events.length - 96);
  return event;
}

function recordAiCoachPlan({ reason, fullRoom, restart, planned, elapsedMs }) {
  if (!aiCoachSession || !runtime.bridge) return;
  aiCoachSession.counters.plannerRuns += 1;
  aiCoachSession.counters.planningMs += Math.max(0, Number(elapsedMs || 0));
  const debug = aiPlannerDebugRecord(reason || 'coach-plan');
  recordAiCoachEvent('plan', {
    reason:String(reason || ''),
    fullRoom:!!fullRoom,
    restart:!!restart,
    planned:!!planned,
    complete:!!debug.planner?.complete,
    partial:!!debug.planner?.partial,
    validationAttempts:Number(debug.planner?.validationAttempts || 0),
    validationBudget:Number(debug.planner?.validationBudget || 0),
    budgetExhausted:!!debug.planner?.budgetExhausted,
    provedEdges:Number(debug.planner?.provedEdges || 0),
    rejectedEdges:Number(debug.planner?.rejectedEdges || 0),
    bestGoalDistance:Number(debug.planner?.bestGoalDistance || 0),
    blocker:debug.planner?.blocker || null,
    lastProof:debug.planner?.lastProof || null,
    routeMetrics:debug.planner?.routeMetrics || null,
    elapsedMs:Math.round(Math.max(0, Number(elapsedMs || 0)) * 100) / 100
  });
}

function recordAiCoachAdvance(result) {
  if (!aiCoachSession || !result) return;
  const frames = Math.max(0, Number(result.framesAdvanced || 0));
  aiCoachSession.counters.aiFrames += frames;
  if (result.status === 'room_transition') aiCoachSession.counters.roomTransitions += 1;
  if (result.status === 'handoff_required' && frames > 0) aiCoachSession.counters.handoffs += 1;
  recordAiCoachEvent('ai-advance', {
    status:result.status,
    framesAdvanced:frames,
    phaseChanges:Number(result.phaseChanges || 0),
    start:result.start,
    end:result.end
  });
}

function recordAiCoachIntervention(kind, request, result) {
  if (!aiCoachSession || !result) return;
  aiCoachSession.counters.manualInterventions += 1;
  aiCoachSession.counters.manualFrames += Math.max(0, Number(result.framesAdvanced || 0));
  recordAiCoachEvent('agent-intervention', {
    kind:String(kind || 'manual-control'),
    request,
    status:result.status,
    stopReason:result.stopReason || null,
    framesAdvanced:Number(result.framesAdvanced || 0),
    handoff:aiAutoplay.lastStop,
    blocker:runtime.bridge ? {
      kind:runtime.bridge.aiBlockingKind() >>> 0,
      kindLabel:aiPrimitiveLabel(runtime.bridge.aiBlockingKind() >>> 0),
      from:runtime.bridge.aiBlockingFrom() >>> 0,
      to:runtime.bridge.aiBlockingTo() >>> 0
    } : null,
    start:{
      submap:result.start?.submap ?? null,
      hero:result.start?.hero ? { worldX:result.start.hero.worldX, worldY:result.start.hero.worldY, motion:result.start.hero.motion } : null
    },
    end:{
      submap:result.end?.submap ?? null,
      hero:result.end?.hero ? { worldX:result.end.hero.worldX, worldY:result.end.hero.worldY, motion:result.end.hero.motion } : null
    }
  });
}

function aiCoachGuidance(debug) {
  if (aiAutoplay.planning) return 'GAI is planning. Inspect again after the synchronous planner transaction completes.';
  if (aiAutoplay.active) return 'Call rdr.ai.advance to let the native AI execute its certified plan. Do not use manual gameplay controls while GAI is active.';
  const blocker = debug?.planner?.blocker;
  const executor = debug?.planner?.executor?.statusLabel;
  if (debug?.planner?.partial || Number(blocker?.kind || 0) !== 0) {
    return `GAI handed off at ${blocker?.kindLabel || 'a certified blocker'}. Inspect lastProof/rejectionHistory and the current plan window, use deterministic rdr.gameplay controls only as needed to pass the blocker, then call rdr.ai.replan from the resulting live state.`;
  }
  if (executor === 'diverged' || executor === 'watchdog') {
    return `GAI stopped with executor status '${executor}'. Inspect the current/nearby phases and proof diagnostics, move Rick to a recoverable live state if necessary, then call rdr.ai.replan.`;
  }
  if (debug?.planner?.failureStage && debug.planner.failureStage !== 0) {
    return `Planning stopped at '${debug.planner.failureStageLabel}'. Inspect rejectionHistory and lastProof; either increase the validation budget or use a small deterministic gameplay intervention before replanning.`;
  }
  return 'Start a coached run with rdr.ai.start, or call rdr.ai.replan to ask GAI to solve from the current live state.';
}

function aiCoachSessionSummary() {
  if (!aiCoachSession) return null;
  const plans = aiCoachSession.events.filter(event => event.type === 'plan');
  const interventions = aiCoachSession.events.filter(event => event.type === 'agent-intervention');
  const blockers = plans.filter(event => Number(event.blocker?.kind || 0) !== 0).map(event => ({
    submap:event.submap,
    kind:event.blocker.kind,
    kindLabel:event.blocker.kindLabel,
    from:event.blocker.from,
    to:event.blocker.to,
    lastProofStage:event.lastProof?.stageLabel || 'none'
  }));
  const current = runtime.bridge ? gameplayAgentState(runtime.bridge) : null;
  return {
    id:aiCoachSession.id,
    configuration:aiCoachSession.configuration,
    start:aiCoachSession.start,
    current:current ? {
      submap:current.submap,
      frameSerial:current.frameSerial,
      hero:{ worldX:current.hero.worldX, worldY:current.hero.worldY, motion:current.hero.motion }
    } : null,
    counters:{ ...aiCoachSession.counters },
    plannerOutcomes:{
      complete:plans.filter(event => event.complete).length,
      partial:plans.filter(event => event.partial && !event.complete).length,
      failed:plans.filter(event => !event.planned).length,
      validationAttempts:plans.reduce((sum, event) => sum + Number(event.validationAttempts || 0), 0),
      rejectedEdges:plans.reduce((sum, event) => sum + Number(event.rejectedEdges || 0), 0),
      provedEdges:plans.reduce((sum, event) => sum + Number(event.provedEdges || 0), 0)
    },
    interventionShare:aiCoachSession.counters.aiFrames + aiCoachSession.counters.manualFrames > 0
      ? aiCoachSession.counters.manualFrames / (aiCoachSession.counters.aiFrames + aiCoachSession.counters.manualFrames)
      : 0,
    blockers,
    interventions:interventions.map(event => ({
      submap:event.submap,
      kind:event.kind,
      framesAdvanced:event.framesAdvanced,
      start:event.start,
      end:event.end
    }))
  };
}

function compactAiPlannerState(planner = {}) {
  const rejections = Array.isArray(planner.rejectionHistory) ? planner.rejectionHistory : [];
  return {
    failureStage:planner.failureStage,
    failureStageLabel:planner.failureStageLabel,
    failureDetail:planner.failureDetail,
    failureDetailLabel:planner.failureDetailLabel,
    nodes:planner.nodes,
    edges:planner.edges,
    startNode:planner.startNode,
    goalNode:planner.goalNode,
    validationAttempts:planner.validationAttempts,
    validationBudget:planner.validationBudget,
    budgetExhausted:planner.budgetExhausted,
    bestGoalDistance:planner.bestGoalDistance,
    provedEdges:planner.provedEdges,
    rejectedEdges:planner.rejectedEdges,
    blocker:planner.blocker,
    complete:planner.complete,
    partial:planner.partial,
    routeMetrics:planner.routeMetrics,
    executor:planner.executor,
    lastProof:planner.lastProof,
    recentRejections:rejections.slice(-6)
  };
}

function aiAgentState({ includeHistory = false, diagnostic = false } = {}) {
  if (!runtime.bridge) throw new Error('xrick runtime is not ready');
  const debug = aiPlannerDebugRecord('webmcp-agent-state');
  const state = {
    schema:'rdr.gai.agent_state.v1',
    gameplay:gameplayAgentState(runtime.bridge),
    controller:{
      active:!!aiAutoplay.active,
      planning:!!aiAutoplay.planning,
      scenario:aiAutoplay.scenario >>> 0,
      deterministicRestart:!!aiAutoplay.deterministicRestart,
      fullRoomPlanning:!!aiAutoplay.fullRoomPlanning,
      continueRooms:!!aiAutoplay.continueRooms,
      planSubmap:aiAutoplay.planSubmap,
      lastInputMask:aiAutoplay.lastInputMask >>> 0,
      lastInputControls:decodeAiInputMask(aiAutoplay.lastInputMask),
      lastStop:aiAutoplay.lastStop,
      coachControlled:!!aiAutoplay.coachControlled,
      frontendPaused:!!runtime.bridge.frontendPaused?.()
    },
    planner:diagnostic ? debug.planner : compactAiPlannerState(debug.planner),
    capturedWorld:debug.capturedWorld,
    session:aiCoachSessionSummary(),
    guidance:aiCoachGuidance(debug)
  };
  if (includeHistory && aiCoachSession) state.sessionEvents = aiCoachSession.events.slice();
  return state;
}

function runAiCoachGameplayIntervention(kind, request, action) {
  if (!runtime.bridge) throw new Error('xrick runtime is not ready');
  if (typeof action !== 'function') throw new Error('gameplay intervention action is required');
  if (aiAutoplay.active || aiAutoplay.planning)
    stopAiAutoplay('GAI handed control to the external agent for a deterministic intervention.', 'warn');
  /* Deterministic gameplay tools use the native debug-step transaction, which
   * can advance requested frames while frontendPaused remains asserted. Never
   * release a coaching-owned hold here, even transiently. */
  const result = action();
  recordAiCoachIntervention(kind, request, result);
  return result;
}

function currentAiCoachConfiguration() {
  if (!runtime.bridge) throw new Error('xrick runtime is not ready');
  return {
    mode:aiInvulnerableRouteEnabled() ? 'invulnerable_reachability' : 'mortal',
    validationBudget:runtime.bridge.aiValidationBudget() >>> 0,
    continueRooms:aiContinueToggle?.checked !== false
  };
}

function configureAiCoach({ mode = null, validationBudget = null, continueRooms = null } = {}) {
  if (!runtime.bridge) throw new Error('xrick runtime is not ready');
  if (aiAutoplay.active || aiAutoplay.planning)
    throw new Error('Stop GAI before changing its coaching configuration.');

  if (mode != null) {
    const invulnerable = mode === 'invulnerable_reachability';
    if (invulnerableToggle && invulnerableToggle.checked !== invulnerable) {
      invulnerableToggle.checked = invulnerable;
      invulnerableToggle.dispatchEvent(new Event('change'));
    } else {
      runtime.bridge.setDebugInvincible(invulnerable);
    }
    if (aiModeSelect) aiModeSelect.value = invulnerable ? '1' : '2';
  }
  if (validationBudget != null) {
    const budget = Math.max(0, Math.min(1000000, Number(validationBudget) >>> 0));
    runtime.bridge.aiSetValidationBudget(budget);
  }
  if (continueRooms != null && aiContinueToggle) aiContinueToggle.checked = !!continueRooms;

  const configuration = currentAiCoachConfiguration();
  if (aiCoachSession) {
    aiCoachSession.configuration = { ...configuration };
    recordAiCoachEvent('configuration', configuration);
  }
  return {
    schema:'rdr.gai.coach_configuration.v1',
    ...configuration,
    guidance:'Use rdr.ai.start for a canonical measured run, or rdr.ai.replan to certify the current live state.'
  };
}

function aiRouteComparableState(state) {
  return {
    frameSerial:state.frameSerial >>> 0,
    map:state.map >>> 0,
    submap:state.submap >>> 0,
    hero:{
      active:!!state.hero.active,
      motion:state.hero.motion,
      worldX:state.hero.worldX | 0,
      worldY:state.hero.worldY | 0,
      velocityY:state.hero.velocityY | 0,
      grounded:!!state.hero.grounded,
      climbing:!!state.hero.climbing,
      crawling:!!state.hero.crawling,
      state:state.hero.state >>> 0,
      direction:state.hero.direction >>> 0,
      controlMask:state.hero.controlMask >>> 0
    },
    camera:{
      mapFrow:state.camera.mapFrow >>> 0,
      visibleTopRow:state.camera.visibleTopRow >>> 0,
      offsetY:state.camera.offsetY | 0
    },
    inventory:state.inventory,
    score:state.score >>> 0,
    debug:state.debug
  };
}

function publicAiRouteArtifact(route) {
  if (!route) return null;
  return {
    routeId:route.id,
    submap:route.submap,
    room:route.room,
    mode:route.mode,
    mortalityPolicy:route.mode === 'mortal' ? 'certified-safe' : 'invulnerable-reachability',
    from:route.from,
    requestedTo:route.requestedTo,
    resolvedTo:route.resolvedTo,
    tolerance:route.tolerance,
    validationBudget:route.validationBudget,
    inputFrames:route.inputMasks.length,
    phases:route.phases,
    routeEdges:route.routeEdges,
    routeMetrics:route.routeMetrics,
    planner:route.planner,
    replays:route.replays,
    lastReplay:route.lastReplay
  };
}

function requireReusableAiRoute(routeId = null) {
  if (!aiRouteArtifact || (routeId && routeId !== aiRouteArtifact.id))
    throw new Error(`Unknown GAI route '${routeId || ''}'. Plan one with rdr.ai.plan_route first.`);
  return aiRouteArtifact;
}

function reusableAiRouteState(routeId = null) {
  if (!aiRouteArtifact) {
    return {
      schema:'rdr.gai.route.v1', active:false, route:null,
      guidance:'Use rdr.ai.plan_route to retain a native A-to-B certificate and replay baseline.'
    };
  }
  const route = requireReusableAiRoute(routeId);
  return {
    schema:'rdr.gai.route.v1', active:true, route:publicAiRouteArtifact(route),
    guidance:'Use rdr.ai.replay_route repeatedly; every replay restores the same native A baseline before applying the retained exact input tape.'
  };
}

function planReusableAiRoute({
  from = null, to = null, mode = 'mortal', tolerance = 4, validationBudget = 0
} = {}) {
  if (!runtime.bridge) throw new Error('xrick runtime is not ready');
  if (!to || !Number.isFinite(Number(to.x)) || !Number.isFinite(Number(to.y)))
    throw new Error('rdr.ai.plan_route requires to.x and to.y world coordinates.');
  if (from && (!Number.isFinite(Number(from.x)) || !Number.isFinite(Number(from.y))))
    throw new Error('rdr.ai.plan_route from requires both x and y world coordinates.');
  if (mode !== 'mortal' && mode !== 'immortal')
    throw new Error("rdr.ai.plan_route mode must be 'mortal' or 'immortal'.");
  if (aiAutoplay.active || aiAutoplay.planning)
    throw new Error('Stop active GAI coaching/playback before planning a reusable route.');
  if (runtime.gameplayDebugController?.status()?.active)
    throw new Error('Stop the active rdr.debug recording before planning a reusable GAI route.');
  if (!runtime.bridge.aiBackendAvailable())
    throw new Error('WASM rollback backend is unavailable. Rebuild xrick.js/.wasm with GAI enabled.');

  const endpointTolerance = Math.max(0, Math.min(32, Number(tolerance) >>> 0));
  const budget = Math.max(0, Math.min(1000000, Number(validationBudget) >>> 0));
  const scenario = mode === 'immortal' ? 1 : 2;
  let candidate = null;
  let response = null;
  let restoreError = null;

  aiRouteArtifact = null;
  runtime.bridge.debugCheckpointDiscard(AI_ROUTE_BASELINE_SLOT);
  runtime.bridge.debugCheckpointDiscard(AI_ROUTE_LIVE_SLOT);
  if (!runtime.bridge.debugCheckpointSave(AI_ROUTE_LIVE_SLOT))
    throw new Error('Could not save live state before GAI route planning.');
  try {
    ensureAiDescriptorCollision();
    runtime.bridge.setFrontendPaused(true);
    runtime.bridge.setDebugInvincible(mode === 'immortal');
    runtime.bridge.aiSetPreferSafe(mode === 'mortal');
    runtime.bridge.aiSetValidationBudget(budget);
    runtime.bridge.aiReset();

    if (from && !runtime.bridge.debugTeleportWorld(Number(from.x) | 0, Number(from.y) | 0, !!from.crawling))
      throw new Error(`Could not establish route start A at (${Number(from.x) | 0}, ${Number(from.y) | 0}).`);

    const start = gameplayAgentState(runtime.bridge);
    const started = performance.now();
    const planned = runtime.bridge.aiPlanFullToPoint(
      scenario, Number(to.x) | 0, Number(to.y) | 0, endpointTolerance);
    const elapsedMs = Math.max(0, performance.now() - started);
    const plannerDebug = aiPlannerDebugRecord('webmcp-point-route-plan');
    const planner = compactAiPlannerState(plannerDebug.planner);

    if (!planned || !runtime.bridge.aiCompletePlan() || runtime.bridge.aiPartialPlan() || !runtime.bridge.aiPhaseCount()) {
      response = {
        schema:'rdr.gai.route_plan.v1', planned:false, retained:false,
        mode, from:{ x:start.hero.worldX, y:start.hero.worldY, crawling:start.hero.crawling },
        requestedTo:{ x:Number(to.x) | 0, y:Number(to.y) | 0 }, tolerance:endpointTolerance,
        elapsedMs, planner,
        guidance:'No complete native point-to-point certificate was produced. Inspect planner.blocker/recentRejections with rdr.ai.get_state(detail=diagnostic), adjust A/B or fix the native planner; no browser-side route was substituted.'
      };
    } else {
      const inputMasks = [];
      const referenceFrames = [];
      let stalled = 0;
      let materializationError = null;
      for (let frame = 0; frame < 12000; frame += 1) {
        const input = runtime.bridge.aiTick() & AI_INPUT_MASK;
        const status = runtime.bridge.aiStatus() >>> 0;
        if (status !== AI_EXECUTOR_RUNNING) break;
        const beforeSerial = runtime.bridge.snapshot().frameSerial >>> 0;
        runtime.bridge.setDebugControl(input);
        forceGameplayDebugFrame(runtime.bridge);
        const after = gameplayAgentState(runtime.bridge);
        if ((after.frameSerial >>> 0) === beforeSerial) {
          stalled += 1;
          if (stalled >= 3) {
            materializationError = 'native simulation did not advance while materializing the certificate';
            break;
          }
          continue;
        }
        stalled = 0;
        inputMasks.push(input);
        referenceFrames.push(aiRouteComparableState(after));
      }
      runtime.bridge.setDebugControl(0);
      /* One final tick lets the executor consume a terminal guard reached by
       * the last replayed production frame without advancing gameplay. */
      if (runtime.bridge.aiStatus() === AI_EXECUTOR_RUNNING) runtime.bridge.aiTick();
      const executorStatus = runtime.bridge.aiStatus() >>> 0;
      const end = gameplayAgentState(runtime.bridge);
      if (materializationError || executorStatus !== AI_EXECUTOR_COMPLETE) {
        response = {
          schema:'rdr.gai.route_plan.v1', planned:false, retained:false,
          mode, from:{ x:start.hero.worldX, y:start.hero.worldY, crawling:start.hero.crawling },
          requestedTo:{ x:Number(to.x) | 0, y:Number(to.y) | 0 }, tolerance:endpointTolerance,
          elapsedMs, planner, executorStatus, executorStatusLabel:aiExecutorLabel(executorStatus),
          error:materializationError,
          guidance:'GAI planned a certificate but it could not be materialized into a reusable deterministic input tape; inspect the held planner diagnostics.'
        };
      } else {
        candidate = {
          id:`route-${++aiRouteSequence}`,
          submap:start.submap >>> 0,
          room:submapAssetName(start.submap),
          mode,
          from:{ x:start.hero.worldX, y:start.hero.worldY, crawling:start.hero.crawling },
          fromOverride:from ? { x:Number(from.x) | 0, y:Number(from.y) | 0, crawling:!!from.crawling } : null,
          requestedTo:{ x:Number(to.x) | 0, y:Number(to.y) | 0 },
          resolvedTo:{ x:end.hero.worldX, y:end.hero.worldY, grounded:end.hero.grounded, crawling:end.hero.crawling },
          tolerance:endpointTolerance,
          validationBudget:budget,
          inputMasks,
          referenceFrames,
          phases:runtime.bridge.aiPhaseCount() >>> 0,
          routeEdges:runtime.bridge.aiRouteEdgeCount() >>> 0,
          routeMetrics:aiRouteMetrics(runtime.bridge),
          planner,
          replays:0,
          lastReplay:null
        };
        response = {
          schema:'rdr.gai.route_plan.v1', planned:true, retained:true,
          elapsedMs, route:publicAiRouteArtifact(candidate),
          guidance:'The route is retained with its exact native A checkpoint and input tape. Call rdr.ai.replay_route with this routeId as many times as needed; each replay starts from the same baseline.'
        };
      }
    }
  } finally {
    runtime.bridge.setDebugControl(0);
    if (!runtime.bridge.debugCheckpointLoad(AI_ROUTE_LIVE_SLOT))
      restoreError = new Error('Could not restore live state after GAI route planning.');
    runtime.bridge.debugCheckpointDiscard(AI_ROUTE_LIVE_SLOT);
    /* The route baseline must be saved after the live rollback. A checkpoint
     * created before that rollback belongs to the discarded heap epoch and
     * cannot be restored later by replay_route. */
    if (!restoreError && candidate && !runtime.bridge.debugCheckpointSave(AI_ROUTE_BASELINE_SLOT))
      restoreError = new Error('Could not save reusable GAI route baseline.');
    if (!candidate || restoreError) runtime.bridge.debugCheckpointDiscard(AI_ROUTE_BASELINE_SLOT);
  }
  if (restoreError) {
    runtime.bridge.debugCheckpointDiscard(AI_ROUTE_BASELINE_SLOT);
    throw restoreError;
  }
  if (candidate) aiRouteArtifact = candidate;
  return response;
}

async function replayReusableAiRoute(routeId = null, { freeze = true } = {}) {
  if (!runtime.bridge) throw new Error('xrick runtime is not ready');
  if (aiAutoplay.active || aiAutoplay.planning)
    throw new Error('Stop active GAI coaching/playback before replaying a reusable route.');
  if (runtime.gameplayDebugController?.status()?.active)
    throw new Error('Stop the active rdr.debug recording before replaying a reusable GAI route.');
  const route = requireReusableAiRoute(routeId);
  if (!runtime.bridge.debugCheckpointLoad(AI_ROUTE_BASELINE_SLOT))
    throw new Error(`Could not restore native baseline for ${route.id}.`);
  runtime.bridge.setFrontendPaused(true);
  let firstMismatch = null;
  let replayed = 0;
  try {
    runtime.bridge.setDebugInvincible(route.mode === 'immortal');
    if (route.fromOverride && !runtime.bridge.debugTeleportWorld(
      route.fromOverride.x, route.fromOverride.y, route.fromOverride.crawling))
      throw new Error(`Could not restore explicit route start A for ${route.id}.`);
    for (let index = 0; index < route.inputMasks.length; index += 1) {
      const input = route.inputMasks[index] & AI_INPUT_MASK;
      let state = null;
      let advanced = false;
      /* A debug frame still observes the production frame deadline. Yield one
       * browser paint before retrying a transient no-advance so a retained
       * neutral landing frame is not mistaken for a tape divergence. */
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const beforeSerial = runtime.bridge.snapshot().frameSerial >>> 0;
        runtime.bridge.setDebugControl(input);
        forceGameplayDebugFrame(runtime.bridge);
        state = gameplayAgentState(runtime.bridge);
        if ((state.frameSerial >>> 0) !== beforeSerial) {
          advanced = true;
          break;
        }
        if (attempt < 2) await yieldForGameplayPaint();
      }
      const actual = aiRouteComparableState(state);
      replayed += 1;
      if (!advanced) {
        firstMismatch = { frame:index, reason:'simulation_not_advancing', inputMask:input };
        break;
      }
      const expected = route.referenceFrames[index];
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        firstMismatch = { frame:index, reason:'state_diverged', inputMask:input, expected, actual };
        break;
      }
    }
  } finally {
    runtime.bridge.setDebugControl(0);
    if (!freeze) runtime.bridge.setFrontendPaused(false);
  }
  const end = gameplayAgentState(runtime.bridge);
  route.replays += 1;
  route.lastReplay = {
    replay:route.replays,
    matchedReference:!firstMismatch && replayed === route.inputMasks.length,
    framesReplayed:replayed,
    firstMismatch:firstMismatch ? { frame:firstMismatch.frame, reason:firstMismatch.reason, inputMask:firstMismatch.inputMask } : null,
    end:{ x:end.hero.worldX, y:end.hero.worldY, motion:end.hero.motion, submap:end.submap },
    frozen:!!freeze
  };
  return {
    schema:'rdr.gai.route_replay.v1',
    route:publicAiRouteArtifact(route),
    matchedReference:route.lastReplay.matchedReference,
    framesReplayed:replayed,
    firstMismatch,
    end,
    guidance:firstMismatch
      ? 'Replay stopped at the first state divergence. The game is held at that frame by default; use rdr.gameplay.explain_action/capture_snapshot to inspect the native blocker, then replay this same route again to reproduce it.'
      : 'Replay matched the materialized native certificate exactly. Call rdr.ai.replay_route again to restart from A, or inspect/capture the held endpoint.'
  };
}

function startAiCoach(options = {}) {
  if (!runtime.bridge) throw new Error('xrick runtime is not ready');
  if (aiAutoplay.active || aiAutoplay.planning)
    stopAiAutoplay('Restarting GAI under a new external-agent coaching session.', 'warn');
  aiCoachSession = null;
  const currentConfiguration = currentAiCoachConfiguration();
  configureAiCoach({
    mode:options.mode ?? currentConfiguration.mode,
    validationBudget:options.validationBudget ?? currentConfiguration.validationBudget,
    continueRooms:options.continueRooms ?? currentConfiguration.continueRooms
  });
  const configuration = currentAiCoachConfiguration();
  beginAiCoachSession(configuration);
  aiAutoplay.coachControlled = true;
  recordAiCoachEvent('session-start', { configuration:{ ...configuration } });
  const planned = runDeterministicAiPlan(`External-agent coaching: restarting ${submapAssetName(runtime.bridge.submap())} and certifying the native full-room route…`);
  runtime.bridge.setFrontendPaused(true);
  return {
    schema:'rdr.gai.coach_start.v1',
    planned:!!planned,
    state:aiAgentState()
  };
}

function yieldForGameplayPaint() {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame !== 'function' || document.hidden) {
      setTimeout(resolve, 0);
      return;
    }
    let settled = false;
    let fallbackTimer = 0;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      resolve();
    };
    /* rAF callbacks run before paint. Queue the continuation as a later task so
     * Chromium gets the paint opportunity after the normal gameplay frame()
     * callback has redrawn the held native C surface. The timeout fallback
     * prevents a throttled/occluded browser from hanging the WebMCP tool. */
    fallbackTimer = setTimeout(finish, 100);
    requestAnimationFrame(() => setTimeout(finish, 0));
  });
}

async function advanceAiCoach(maxFrames = 1200, framesPerPaint = 2) {
  if (!runtime.bridge) throw new Error('xrick runtime is not ready');
  if (!aiCoachSession && !aiAutoplay.active && !aiAutoplay.planning)
    throw new Error('No GAI run is active. Call rdr.ai.start or rdr.ai.replan first.');
  ensureAiCoachSession(currentAiCoachConfiguration());
  aiAutoplay.coachControlled = true;
  const result = await advanceAiAutoplayVisible({
    bridge:runtime.bridge,
    autoplay:aiAutoplay,
    tick:tickAiAutoplay,
    maxFrames,
    framesPerPaint,
    beforeChunk:() => runtime.bridge.setFrontendPaused(true),
    afterChunk:() => runtime.bridge.setFrontendPaused(true),
    yieldForPaint:yieldForGameplayPaint
  });
  runtime.bridge.setFrontendPaused(true);
  recordAiCoachAdvance(result);
  return {
    schema:'rdr.gai.coach_advance.v1',
    ...result,
    state:aiAgentState()
  };
}

function replanAiCoach({ fullRoom = true } = {}) {
  if (!runtime.bridge) throw new Error('xrick runtime is not ready');
  ensureAiCoachSession(currentAiCoachConfiguration());
  aiAutoplay.coachControlled = true;
  runtime.bridge.setFrontendPaused(true);
  if (aiAutoplay.active || aiAutoplay.planning)
    stopAiAutoplay('External agent requested a GAI replan from the exact current live state.', 'warn');
  recordAiCoachEvent('replan-request', { fullRoom:!!fullRoom });
  const planned = runImmediateAiLivePlan('External-agent coaching: certifying from the current live state…', { fullRoom:!!fullRoom });
  return {
    schema:'rdr.gai.coach_replan.v1',
    planned:!!planned,
    state:aiAgentState()
  };
}

async function runAiUntilBlocked({ restart = false, validationBudget = 24, maxFrames = 4000 } = {}) {
  if (restart && (aiAutoplay.active || aiAutoplay.planning)) stopAiCoach('Restarting run-until-blocked.');
  if (!aiAutoplay.active && !aiAutoplay.planning) configureAiCoach({validationBudget,continueRooms:false});
  let result;
  let framesAdvanced = 0;
  let autoReplans = 0;
  try {
    if (restart) result = startAiCoach({validationBudget,continueRooms:false});
    else if (!aiAutoplay.active && !aiAutoplay.planning) result = replanAiCoach({fullRoom:true});
    while (aiAutoplay.active && framesAdvanced < maxFrames) {
      const advance = await advanceAiCoach(maxFrames - framesAdvanced,32);
      framesAdvanced += Number(advance.framesAdvanced || 0);
      result = advance;
      const decision = aiHorizonLoopDecision({
        advance, state:advance.state, framesAdvanced, maxFrames, autoReplans
      });
      if (decision !== 'replan') {
        if (decision === 'limit_reached') result = { ...advance, status:'limit_reached' };
        break;
      }
      autoReplans += 1;
      result = replanAiCoach({fullRoom:true});
      if (!result.planned || !aiAutoplay.active) break;
    }
    const state = aiAgentState();
    const diagnostics = aiPlannerDebugRecord('run-until-blocked').planner;
    const scheduling = ['limit_reached','planning','room_transition_pending_render'].includes(result?.status);
    const roomChanged = result?.status === 'room_transition';
    const kind = (state.gameplay.hero.state & 0x30) ? 'hero_dead' :
      result?.status === 'simulation_not_advancing' ? 'simulation_stalled' :
      state.planner.budgetExhausted ? 'search_limit' :
      (state.planner.failureStage > 0 && state.planner.failureStage < 15) ? 'startup_or_state' : 'native_proof_or_execution';
    return {schema:'rdr.gai.run_until_blocked.v1', status:roomChanged ? 'room_completed' : scheduling ? result.status : state.planner.budgetExhausted ? 'search_budget_exhausted' : 'blocked',
      framesAdvanced, autoReplans, state,
      blockage:roomChanged || scheduling ? null : {kind,
        stage:state.planner.failureStage ? state.planner.failureStageLabel : state.planner.lastProof?.stageLabel, detail:state.planner.failureDetailLabel,
        edge:state.planner.blocker, proof:state.planner.lastProof, rejections:state.planner.recentRejections, dropSearch:diagnostics.dropSearch,
        controller:state.controller},
      guidance:'State is held. Apply native gameplay actions, then call run_until_blocked again without restart. Search/frame limits may need a larger budget.'};
  } finally { runtime.bridge.setDebugControl(0); runtime.bridge.setFrontendPaused(true); }
}

function stopAiCoach(reason = 'External agent stopped GAI coaching.') {
  if (!runtime.bridge) throw new Error('xrick runtime is not ready');
  ensureAiCoachSession(currentAiCoachConfiguration());
  stopAiAutoplay(String(reason || 'External agent stopped GAI coaching.'), 'neutral');
  aiAutoplay.coachControlled = false;
  runtime.bridge.setFrontendPaused(true);
  return {
    schema:'rdr.gai.coach_stop.v1',
    state:aiAgentState()
  };
}

function aiCoachSessionReport(eventLimit = 24) {
  if (!runtime.bridge) throw new Error('xrick runtime is not ready');
  const limit = Math.max(0, Math.min(96, Number(eventLimit) | 0));
  const state = aiAgentState({ diagnostic:true });
  return {
    schema:'rdr.gai.coach_report.v1',
    session:state.session,
    current:{
      gameplay:state.gameplay,
      controller:state.controller,
      planner:state.planner,
      capturedWorld:state.capturedWorld,
      guidance:state.guidance
    },
    recentEvents:aiCoachSession && limit ? aiCoachSession.events.slice(-limit) : []
  };
}

function aiPlannerFailureSummary() {
  if (!runtime.bridge) return '';
  const stage = runtime.bridge.aiFailureStage() >>> 0;
  const label = AI_FAILURE_STAGE_LABELS[stage] || `stage-${stage}`;
  const c = runtime.bridge.aiCandidateCounts?.() || {};
  const detail = runtime.bridge.aiFailureDetail() >>> 0;
  return ` · stage ${label}/${aiFailureDetailLabel(stage, detail)} · graph ${runtime.bridge.aiNodeCount()}n/${runtime.bridge.aiEdgeCount()}e` +
    ` · candidates w${c.walk||0} c${c.crawl||0} d${c.drop||0} j${c.jump||0} l${c.ladder||0} x${c.exit||0} b${c.dynamite||0}` +
    ` · start ${runtime.bridge.aiStartNode()} support ${runtime.bridge.aiPlayerSupportId()} @ ${runtime.bridge.aiPlayerX()},${runtime.bridge.aiPlayerY()}` +
    ` · world native=${runtime.bridge.aiWorldNativeRdx()?1:0} actors=${runtime.bridge.aiActorCount()} mechs=${runtime.bridge.aiMechanismCount()} frame=${runtime.bridge.aiWorldFrameSerial()}`;
}

async function copyAiPlannerDebug() {
  const text = JSON.stringify(aiPlannerDebugRecord('manual-copy'), null, 2);
  try {
    await navigator.clipboard.writeText(text);
    setAiPlayStatus('AI debug JSON copied to clipboard.', 'ok');
  } catch (_) {
    console.info('[rdx/ai/debug-copy]', text);
    setAiPlayStatus('Clipboard unavailable; AI debug JSON written to browser console.', 'warn');
  }
}

function aiBlockerSummary() {
  if (!runtime.bridge) return '';
  const kind = runtime.bridge.aiBlockingKind();
  if (!kind) return '';
  return ` · blocker ${kind} ${runtime.bridge.aiBlockingFrom()}→${runtime.bridge.aiBlockingTo()}`;
}

function aiExecutionSummary(snapshot = null) {
  if (!runtime.bridge) return 'AI unavailable';
  const room = snapshot ? submapAssetName(snapshot.submap) : submapAssetName(runtime.bridge.submap());
  const phaseCount = runtime.bridge.aiPhaseCount();
  const phaseIndex = Math.min(phaseCount, runtime.bridge.aiPhaseIndex() + (phaseCount ? 1 : 0));
  const hazardFrames = runtime.bridge.aiRouteHazardContacts();
  const deaths = runtime.bridge.aiRouteDeathEpisodes();
  const ammo = `${runtime.bridge.aiRouteBombsUsed()} dyn / ${runtime.bridge.aiRouteBulletsUsed()} bullets`;
  return `${room} · phase ${phaseIndex}/${phaseCount} · ${runtime.bridge.aiRouteEdgeCount()} edges · ` +
    `${runtime.bridge.aiSegmentCount()} seg / ${runtime.bridge.aiReplanCount()} replans · ${deaths} death episodes / ${hazardFrames} hazard frames · ${ammo}`;
}

function refreshGaiRouteInspectorPlan() {
  if (!runtime.bridge || !gaiRouteInspector) return;
  const submap = runtime.bridge.submap() >>> 0;
  const plan = readGaiRoutePlan(runtime.bridge, { submap, room:submapAssetName(submap) });
  void gaiRouteInspector.updatePlan(plan, { statusText:aiStatus?.textContent || '' }).catch(error => {
    console.error('[rdx/gai-route-inspector] update failed', error);
  });
}

function refreshGaiRouteInspectorProgress(snapshot = null) {
  if (!runtime.bridge || !gaiRouteInspector) return;
  const currentSnapshot = snapshot || runtime.bridge.snapshot();
  const nativePlayer = currentSnapshot?.collision?.native;
  gaiRouteInspector.updateProgress({
    submap:currentSnapshot?.submap ?? runtime.bridge.submap(),
    x:nativePlayer?.playerActive ? nativePlayer.playerWorldX : runtime.bridge.aiPlayerX(),
    y:nativePlayer?.playerActive ? nativePlayer.playerWorldY : runtime.bridge.aiPlayerY(),
    statusText:aiStatus?.textContent || ''
  });
}

function stopAiAutoplay(message = 'AI stopped.', kind = 'neutral', { resetRuntime = false } = {}) {
  aiAutoplay.nextPlanToken += 1;
  aiAutoplay.active = false;
  aiAutoplay.planning = false;
  aiAutoplay.planSubmap = -1;
  aiAutoplay.completedAtSerial = -1;
  aiAutoplay.lastStatusSerial = -1;
  runtime.bridge?.setAiAudioHold?.(false);
  runtime.bridge?.setAiTransitionHold?.(false);
  clearAiControl();
  if (resetRuntime && runtime.bridge) {
    runtime.bridge.aiReset();
    gaiRouteInspector?.clear();
  }
  aiAutoplay.lastStop = {
    message:String(message || 'AI stopped.'),
    kind:String(kind || 'neutral'),
    submap:runtime.bridge ? (runtime.bridge.submap() >>> 0) : null,
    frameSerial:runtime.bridge ? (runtime.bridge.snapshot()?.frameSerial >>> 0) : null,
    executorStatus:runtime.bridge ? (runtime.bridge.aiStatus() >>> 0) : null,
    executorStatusLabel:runtime.bridge ? aiExecutorLabel(runtime.bridge.aiStatus() >>> 0) : null
  };
  if (aiCoachSession) recordAiCoachEvent('ai-stop', aiAutoplay.lastStop);
  updateAiPlayButtons();
  setAiPlayStatus(message, kind);
  refreshGaiRouteInspectorProgress();
}

function ensureAiDescriptorCollision() {
  if (!runtime.bridge || !runtime.collisionRuntime || !runtime.renderer || !runtime.bridge.presentationReady()) {
    throw new Error('Load the verified RDX ROM before starting AI play.');
  }
  if (collisionPolicySelect?.value === 'classic_only') {
    const policy = CollisionPolicyName.native_experimental;
    collisionPolicySelect.value = 'native_experimental';
    runtime.bridge.setCollisionPolicy(policy);
    runtime.collisionRuntime.setPolicy(policy);
    runtime.bridge.unpause();
  }

  runtime.bridge.unpause();
  let snapshot = runtime.bridge.snapshot();
  const expectedMd = runtime.bridge.mappedMdForSubmap(snapshot.submap) >>> 0;

  const descriptorMatches = current => {
    const descriptor = current?.collision?.native;
    return !!descriptor?.worldLoaded &&
      (Number(descriptor.mapId) >>> 0) === expectedMd;
  };

  runtime.collisionRuntime.activate(snapshot);
  snapshot = runtime.bridge.snapshot();
  if (!descriptorMatches(snapshot)) {
    /* The JavaScript collision runtime caches the room key. A synchronous
     * C-side reset can invalidate the descriptor world without changing that
     * key. Force one cache-bypassing reinstall and verify the actual WASM
     * descriptor map rather than trusting activeKey. */
    runtime.collisionRuntime.activeKey = '';
    runtime.collisionRuntime.activeRoom = null;
    runtime.collisionRuntime.activate(snapshot);
    snapshot = runtime.bridge.snapshot();
  }

  if (!descriptorMatches(snapshot)) {
    const descriptor = snapshot?.collision?.native || {};
    throw new Error(
      `RDX descriptor world is not loaded for ${submapAssetName(snapshot?.submap ?? runtime.bridge.submap())}: ` +
      `expected MD${String(expectedMd).padStart(4, '0')}, ` +
      `loaded=${descriptor.worldLoaded ? 1 : 0}, complete=${descriptor.worldReady ? 1 : 0}, ` +
      `actual=MD${String(Number(descriptor.mapId ?? 0xffff) >>> 0).padStart(4, '0')}`
    );
  }
  return snapshot;
}

function finishAiPlanning(before, fullRoom, planned, elapsed) {
  aiAutoplay.planning = false;
  const inspectablePrefix = fullRoom && runtime.bridge.aiPartialPlan() && runtime.bridge.aiPhaseCount() > 0;
  if (!planned || runtime.bridge.aiPhaseCount() === 0 || (fullRoom && !runtime.bridge.aiCompletePlan() && !inspectablePrefix)) {
    const rejected = runtime.bridge.aiRejectedEdgeCount();
    const attempts = runtime.bridge.aiValidationAttempts();
    const prefix = fullRoom ? 'No deterministic route or certified prefix' : 'No certified route';
    const topology = ` · ${runtime.bridge.aiSupportCount()} supports / ${runtime.bridge.aiExitCount()} exits`;
    const debug = aiPlannerDebugRecord(prefix);
    console.warn('[rdx/ai/debug]', debug);
    refreshGaiRouteInspectorPlan();
    stopAiAutoplay(`${prefix} from ${submapAssetName(before?.submap ?? runtime.bridge.submap())}${aiBlockerSummary()} · ${rejected}/${attempts} proofs rejected${topology}${aiPlannerFailureSummary()} · use “Copy AI debug”`, 'warn');
    return false;
  }
  aiAutoplay.planSubmap = Number(before?.submap ?? runtime.bridge.submap()) >>> 0;
  aiAutoplay.planStartedAtSerial = Number(before?.frameSerial || 0) >>> 0;
  aiAutoplay.completedAtSerial = -1;
  aiAutoplay.lastStatusSerial = -1;
  updateAiPlayButtons();
  const planKind = fullRoom
    ? (runtime.bridge.aiCompletePlan() ? 'full room precomputed' : 'longest certified prefix; stops at blocker')
    : 'live route planned';
  setAiPlayStatus(`${aiExecutionSummary(before)} · ${planKind} ${(elapsed / 1000).toFixed(2)}s`, 'running');
  refreshGaiRouteInspectorPlan();
  return true;
}

function aiInvulnerableRouteEnabled() {
  if (!runtime.bridge) return !!invulnerableToggle?.checked;
  if (invulnerableToggle?.checked) return true;
  return !!runtime.bridge.snapshot()?.debug?.invincible;
}

function aiPlanningScenario({ fullRoom = false } = {}) {
  if (aiInvulnerableRouteEnabled()) return 1;
  if (fullRoom) return 2;
  return (Number(aiModeSelect?.value || 2) >>> 0) === 1 ? 1 : 2;
}

function configureAiPlanningMode({ fullRoom = false } = {}) {
  const invulnerable = aiInvulnerableRouteEnabled();
  const scenario = aiPlanningScenario({ fullRoom });
  /* Invulnerability is a route-testing contract, not just a rendering/debug
   * flag.  Keep native rollback and visible replay in the same mode: when it
   * is enabled the planner deliberately ignores lethal-contact cost and Rick
   * cannot die to enemies, projectiles or explosions during the run. */
  runtime.bridge.setDebugInvincible(invulnerable);
  runtime.bridge.aiSetPreferSafe(!invulnerable && scenario === 2);
  aiAutoplay.scenario = scenario;
  return scenario;
}

function runDeterministicAiPlan(reason = 'Restarting and precomputing complete deterministic route…') {
  if (!runtime.bridge) return false;
  ++aiAutoplay.nextPlanToken;
  aiAutoplay.active = true;
  aiAutoplay.planning = true;
  aiAutoplay.deterministicRestart = true;
  aiAutoplay.fullRoomPlanning = true;
  aiAutoplay.continueRooms = aiContinueToggle?.checked !== false;
  aiAutoplay.lastStop = null;
  clearAiControl();
  updateAiPlayButtons();
  setAiPlayStatus(reason, 'running');
  try {
    /* This is intentionally one synchronous WASM transaction. Do not yield to
     * requestAnimationFrame between restart/prime and plan_full(): a browser
     * game frame in that gap destroys the canonical deterministic start. */
    ensureAiDescriptorCollision();
    const scenario = configureAiPlanningMode({ fullRoom:true });
    const started = performance.now();
    const planned = runtime.bridge.aiRestartPlanFull(scenario);
    const elapsed = Math.max(0, performance.now() - started);
    const before = runtime.bridge.snapshot();
    const finished = finishAiPlanning(before, true, planned, elapsed);
    recordAiCoachPlan({ reason, fullRoom:true, restart:true, planned, elapsedMs:elapsed });
    return finished;
  } catch (error) {
    console.error('[rdx/ai] deterministic planning failed', error, aiPlannerDebugRecord('exception'));
    stopAiAutoplay(`AI deterministic planning failed: ${error?.message || error} · use “Copy AI debug”`, 'error');
    return false;
  }
}

function runImmediateAiLivePlan(reason = 'Planning from coached live state…', { fullRoom = true } = {}) {
  if (!runtime.bridge) return false;
  ++aiAutoplay.nextPlanToken;
  aiAutoplay.active = true;
  aiAutoplay.planning = true;
  aiAutoplay.deterministicRestart = false;
  aiAutoplay.fullRoomPlanning = !!fullRoom;
  aiAutoplay.continueRooms = aiContinueToggle?.checked !== false;
  aiAutoplay.lastStop = null;
  clearAiControl();
  updateAiPlayButtons();
  setAiPlayStatus(reason, 'running');
  try {
    const before = ensureAiDescriptorCollision();
    if (!runtime.bridge.aiBackendAvailable()) throw new Error('WASM rollback backend is unavailable. Rebuild xrick.js/.wasm with GAI enabled.');
    const scenario = configureAiPlanningMode({ fullRoom:!!fullRoom });
    const started = performance.now();
    const planned = fullRoom ? runtime.bridge.aiPlanFull(scenario) : runtime.bridge.aiPlan(scenario);
    const elapsed = Math.max(0, performance.now() - started);
    const finished = finishAiPlanning(before, !!fullRoom, planned, elapsed);
    recordAiCoachPlan({ reason, fullRoom:!!fullRoom, restart:false, planned, elapsedMs:elapsed });
    return finished;
  } catch (error) {
    console.error('[rdx/ai] coached live planning failed', error, aiPlannerDebugRecord('coached-live-planning-exception'));
    stopAiAutoplay(`AI coached live planning failed: ${error?.message || error} · inspect AI state`, 'error');
    return false;
  }
}

function scheduleAiPlan(reason = 'Planning certified route…', { fullRoom = false } = {}) {
  if (!runtime.bridge) return;
  const token = ++aiAutoplay.nextPlanToken;
  aiAutoplay.active = true;
  aiAutoplay.planning = true;
  aiAutoplay.fullRoomPlanning = !!fullRoom;
  aiAutoplay.lastStop = null;
  clearAiControl();
  updateAiPlayButtons();
  setAiPlayStatus(reason, 'running');

  /* Let the status paint before the synchronous rollback planner runs. The
   * planner intentionally stays on the main thread for now because it shares
   * the live Emscripten state/rollback backend with gameplay. */
  requestAnimationFrame(() => setTimeout(() => {
    if (token !== aiAutoplay.nextPlanToken || !aiAutoplay.active || !runtime.bridge) return;
    try {
      const before = ensureAiDescriptorCollision();
      const scenario = configureAiPlanningMode({ fullRoom });
      aiAutoplay.continueRooms = aiContinueToggle?.checked !== false;
      const started = performance.now();
      const planned = fullRoom ? runtime.bridge.aiPlanFull(scenario) : runtime.bridge.aiPlan(scenario);
      const elapsed = Math.max(0, performance.now() - started);
      if (token !== aiAutoplay.nextPlanToken || !aiAutoplay.active) return;
      finishAiPlanning(before, fullRoom, planned, elapsed);
      recordAiCoachPlan({ reason, fullRoom, restart:false, planned, elapsedMs:elapsed });
    } catch (error) {
      console.error('[rdx/ai] planning failed', error, aiPlannerDebugRecord('overlay-start-or-planning-exception'));
      stopAiAutoplay(`AI planning failed: ${error?.message || error} · use “Copy AI debug”`, 'error');
    }
  }, 0));
}

function startAiAutoplay() {
  if (!runtime.bridge || aiAutoplay.active || aiAutoplay.planning) return;
  aiAutoplay.coachControlled = false;
  runtime.bridge.setFrontendPaused(false);
  if (runtime.previewWorkspaceMode === 'editor' || runtime.mapEditorPlaytestActive) {
    setAiPlayStatus('AI Play controls drive the standard Playtest. Leave Map Editor playtest first.', 'warn');
    return;
  }
  try {
    ensureAiDescriptorCollision();
    if (!runtime.bridge.aiBackendAvailable()) throw new Error('WASM rollback backend is unavailable. Rebuild xrick.js/.wasm with GAI enabled.');
    aiAutoplay.deterministicRestart = false;
    aiAutoplay.autoReplans = 0;
    globalThis.xrickFocusPage?.();
    scheduleAiPlan(`Planning ${submapAssetName(runtime.bridge.submap())} from the current live state…`, { fullRoom:false });
  } catch (error) {
    stopAiAutoplay(`AI cannot start: ${error?.message || error}`, 'error');
  }
}

function startAiRestartAutoplay() {
  if (!runtime.bridge || aiAutoplay.active || aiAutoplay.planning) return;
  aiAutoplay.coachControlled = false;
  runtime.bridge.setFrontendPaused(false);
  if (runtime.previewWorkspaceMode === 'editor' || runtime.mapEditorPlaytestActive) {
    setAiPlayStatus('AI Play controls drive the standard Playtest. Leave Map Editor playtest first.', 'warn');
    return;
  }
  try {
    ensureAiDescriptorCollision();
    if (!runtime.bridge.aiBackendAvailable()) throw new Error('WASM rollback backend is unavailable. Rebuild xrick.js/.wasm with GAI enabled.');
    /* The visible button must return an anytime certificate instead of
     * monopolizing the browser main thread with an unlimited room search.
     * Preserve an explicit finite budget, but turn the ABI's default 0
     * (unlimited) into the reviewed interactive slice.  The value survives
     * native GAI reset and therefore also bounds destination-room replanning. */
    if (!runtime.bridge.aiValidationBudget())
      runtime.bridge.aiSetValidationBudget(AI_BROWSER_RESTART_VALIDATION_BUDGET);
    aiAutoplay.autoReplans = 0;
    globalThis.xrickFocusPage?.();
    runDeterministicAiPlan(`Restarting ${submapAssetName(runtime.bridge.submap())} and precomputing the complete deterministic route…`);
  } catch (error) {
    stopAiAutoplay(`AI cannot restart: ${error?.message || error} · use “Copy AI debug”`, 'error');
  }
}

const AI_TRANSITION_AUDIO_QUIESCE_MS = 120;

/* Destination-room continuation first exposes the native neutral entry frame,
 * then explicitly ends room-local SFX and pauses the SDL device. The extra
 * browser task lets that clean audio boundary take effect before synchronous
 * main-thread planning; relying on callback-driven sample completion can
 * deadlock when Chromium has suspended or starved the callback. */
function planRenderedDestinationRoom(previous, renderedSnapshot) {
  if (!runtime.bridge || !renderedSnapshot) return false;
  const token = ++aiAutoplay.nextPlanToken;
  aiAutoplay.active = true;
  aiAutoplay.planning = true;
  runtime.bridge.setAiTransitionHold(true);
  clearAiControl();
  updateAiPlayButtons();
  const fullRoom = !!aiAutoplay.fullRoomPlanning;
  const reason = `Completed ${submapAssetName(previous)} → ${submapAssetName(renderedSnapshot.submap)}. ` +
    'Establishing the painted entry and clean audio boundary…';
  setAiPlayStatus(reason, 'running');
  void (async () => {
    try {
      const ready = await waitForAiTransitionReady({
        yieldForPaint:yieldForGameplayPaint,
        beginAudioHold:() => runtime.bridge?.setAiAudioHold?.(true),
        yieldForAudioQuiesce:() => new Promise(resolve => setTimeout(resolve, AI_TRANSITION_AUDIO_QUIESCE_MS)),
        cancelled:() => token !== aiAutoplay.nextPlanToken || !aiAutoplay.active || !runtime.bridge
      });
      if (!ready.ready || token !== aiAutoplay.nextPlanToken || !aiAutoplay.active || !runtime.bridge) return;

      const settled = settleAiDestinationEntry({
        snapshot:() => runtime.bridge?.snapshot(),
        forceNeutralFrame:() => forceGameplayDebugFrame(runtime.bridge),
        expectedSubmap:renderedSnapshot.submap,
        cancelled:() => token !== aiAutoplay.nextPlanToken || !aiAutoplay.active || !runtime.bridge
      });
      if (settled.cancelled) return;
      if (!settled.ready)
        throw new Error(`destination entry did not settle (${settled.reason}, ${settled.frames} neutral frames)`);
      if (settled.frames) await yieldForGameplayPaint();
      if (token !== aiAutoplay.nextPlanToken || !aiAutoplay.active || !runtime.bridge) return;

      const planningReason = `Completed ${submapAssetName(previous)} → ${submapAssetName(renderedSnapshot.submap)}. ` +
        (fullRoom ? 'Planning full route from settled entry state…' : 'Planning from settled entry state…');
      setAiPlayStatus(planningReason, 'running');
      const before = ensureAiDescriptorCollision();
      if ((Number(before?.submap) >>> 0) !== (Number(renderedSnapshot.submap) >>> 0))
        throw new Error('destination room changed before AI continuation planning');
      const scenario = configureAiPlanningMode({ fullRoom });
      const started = performance.now();
      const planned = fullRoom ? runtime.bridge.aiPlanFull(scenario) : runtime.bridge.aiPlan(scenario);
      const elapsed = Math.max(0, performance.now() - started);
      finishAiPlanning(before, fullRoom, planned, elapsed);
      recordAiCoachPlan({ reason:planningReason, fullRoom, restart:false, planned, elapsedMs:elapsed });
    } catch (error) {
      console.error('[rdx/ai] destination-entry planning failed', error, aiPlannerDebugRecord('rendered-room-entry-planning-exception'));
      stopAiAutoplay(`AI destination planning failed: ${error?.message || error} · use “Copy AI debug”`, 'error');
    } finally {
      if (runtime.bridge && token === aiAutoplay.nextPlanToken) {
        runtime.bridge.setAiAudioHold(false);
        runtime.bridge.setAiTransitionHold(false);
      }
    }
  })();
  return true;
}

function tickAiAutoplay(snapshot) {
  if (!runtime.bridge || !aiAutoplay.active || aiAutoplay.planning || !snapshot) return;
  refreshGaiRouteInspectorProgress(snapshot);
  if (runtime.mapEditorPlaytestActive) {
    stopAiAutoplay('AI stopped because another playtest took control.', 'warn');
    return;
  }

  if (aiAutoplay.planSubmap >= 0 && snapshot.submap !== aiAutoplay.planSubmap) {
    clearAiControl();
    const previous = aiAutoplay.planSubmap;
    if (aiAutoplay.continueRooms) {
      planRenderedDestinationRoom(previous, snapshot);
    } else {
      stopAiAutoplay(`AI completed ${submapAssetName(previous)} and reached ${submapAssetName(snapshot.submap)}.`, 'ok');
    }
    return;
  }

  const input = runtime.bridge.aiTick() & AI_INPUT_MASK;
  const executorStatus = runtime.bridge.aiStatus();
  aiAutoplay.lastInputMask = input;
  runtime.bridge.setDebugControl(input);

  if (executorStatus === AI_EXECUTOR_RUNNING) {
    aiAutoplay.completedAtSerial = -1;
    if (snapshot.frameSerial !== aiAutoplay.lastStatusSerial) {
      aiAutoplay.lastStatusSerial = snapshot.frameSerial;
      setAiPlayStatus(aiExecutionSummary(snapshot), 'running');
    }
    return;
  }

  clearAiControl();
  if (executorStatus === AI_EXECUTOR_COMPLETE) {
    if (runtime.bridge.aiPartialPlan() && !runtime.bridge.aiCompletePlan()) {
      const executedFrames = (snapshot.frameSerial >>> 0) -
        (aiAutoplay.planStartedAtSerial >>> 0);
      const continuationState = {
        controller:{active:false},
        planner:{
          partial:true,
          executor:{statusLabel:'complete'},
          routeMetrics:aiRouteMetrics(runtime.bridge)
        }
      };
      if (!aiAutoplay.coachControlled && shouldAutoContinueAiHorizon(
        {status:'handoff_required',framesAdvanced:executedFrames},
        continuationState, aiAutoplay.autoReplans)) {
        aiAutoplay.autoReplans += 1;
        runImmediateAiLivePlan(
          `GAI committed an irreversible native prerequisite; recapturing exact live state (${aiAutoplay.autoReplans}/8)…`,
          {fullRoom:aiAutoplay.fullRoomPlanning});
        return;
      }
      stopAiAutoplay(`AI reached a safe certified prefix but cannot extend it${aiBlockerSummary()} · ${aiExecutionSummary(snapshot)}`, 'warn');
      return;
    }
    if (runtime.bridge.aiCompletePlan()) {
      if (aiAutoplay.completedAtSerial < 0) aiAutoplay.completedAtSerial = snapshot.frameSerial;
      const age = (snapshot.frameSerial >>> 0) - (aiAutoplay.completedAtSerial >>> 0);
      setAiPlayStatus(`${aiExecutionSummary(snapshot)} · certificate complete, waiting for room transition`, 'ok');
      if (age > 75) {
        stopAiAutoplay(`AI certificate completed but ${submapAssetName(snapshot.submap)} did not transition.`, 'warn');
      }
      return;
    }
    stopAiAutoplay(`AI executor completed without a complete/partial plan flag${aiBlockerSummary()}.`, 'warn');
    return;
  }

  if (executorStatus === AI_EXECUTOR_DIVERGED) {
    stopAiAutoplay(`AI diverged from the certified route${aiBlockerSummary()} · ${aiExecutionSummary(snapshot)}`, 'error');
    return;
  }
  if (executorStatus === AI_EXECUTOR_WATCHDOG) {
    stopAiAutoplay(`AI phase watchdog expired${aiBlockerSummary()} · ${aiExecutionSummary(snapshot)}`, 'error');
    return;
  }
  if (executorStatus === AI_EXECUTOR_IDLE) {
    stopAiAutoplay('AI executor returned to idle before completing the room.', 'warn');
  }
}

  function busy() { return !!(aiAutoplay.active || aiAutoplay.planning); }
  function setCoachControlled(value) { aiAutoplay.coachControlled = !!value; return aiAutoplay.coachControlled; }
  function tickFrame(snapshot) {
    if (!snapshot) return;
    const coachNeedsRenderedTransitionPlan = aiAutoplay.coachControlled && aiAutoplay.active && !aiAutoplay.planning &&
      aiAutoplay.planSubmap >= 0 && snapshot.submap !== aiAutoplay.planSubmap;
    if (!aiAutoplay.coachControlled || coachNeedsRenderedTransitionPlan) tickAiAutoplay(snapshot);
  }
  function state() { return Object.freeze({ ...aiAutoplay }); }

  return Object.freeze({
    speedModeLabel, setPlayStatus:setAiPlayStatus, updateButtons:updateAiPlayButtons, agentState:aiAgentState,
    recordActionRun:result => recordAiCoachIntervention('action-list', {baselineId:result.baselineId}, {framesAdvanced:result.frames,status:result.reason,start:result.start,end:result.end.state}),
    runCoachGameplayIntervention:runAiCoachGameplayIntervention, configureCoach:configureAiCoach,
    reusableRouteState:reusableAiRouteState, planReusableRoute:planReusableAiRoute, replayReusableRoute:replayReusableAiRoute,
    runUntilBlocked:runAiUntilBlocked, startCoach:startAiCoach, advanceCoach:advanceAiCoach, replanCoach:replanAiCoach, stopCoach:stopAiCoach,
    coachSessionReport:aiCoachSessionReport, copyPlannerDebug:copyAiPlannerDebug, stopAutoplay:stopAiAutoplay,
    startAutoplay:startAiAutoplay, startRestartAutoplay:startAiRestartAutoplay, tickAutoplay:tickAiAutoplay,
    tickFrame, busy, setCoachControlled, state
  });
}
