import { decodeAiInputMask, describeAiPhaseGuard } from './ai-coach.js';

const clone = value => value == null ? null : JSON.parse(JSON.stringify(value));

export const WALKTHROUGH_SAMPLE_FIELDS = Object.freeze([
  'frameSerial', 'submap', 'worldX', 'worldY', 'control', 'rickState',
  'bullets', 'dynamite', 'lives', 'wouldDieCount', 'cameraY'
]);

function sample(snapshot) {
  const player = snapshot.collision?.native;
  return [snapshot.frameSerial, snapshot.submap,
    player?.playerActive ? player.playerWorldX : null,
    player?.playerActive ? player.playerWorldY : null,
    snapshot.rick?.control ?? null, snapshot.rick?.state ?? null,
    snapshot.inventory?.bullets ?? null, snapshot.inventory?.dynamite ?? null,
    snapshot.inventory?.lives ?? null, snapshot.debug?.wouldDieCount ?? null,
    snapshot.cameraY ?? null];
}

function settings(snapshot) {
  return clone({ debug:snapshot.debug, collisionPolicy:snapshot.collision?.policy,
    presentationMode:snapshot.presentationMode, speedMultiplier:snapshot.speedMultiplier });
}

function snapshotSummary(snapshot) {
  if (!snapshot) return null;
  const native = snapshot.collision?.native;
  return { frameSerial:snapshot.frameSerial, submap:snapshot.submap,
    position:native?.playerActive ? [native.playerWorldX, native.playerWorldY] : null,
    inventory:snapshot.inventory, rickState:snapshot.rick?.state,
    invincible:snapshot.debug?.invincible, wouldDieCount:snapshot.debug?.wouldDieCount,
    collisionPolicy:snapshot.collision?.policy };
}

/** Reduce legacy/full evidence without inferring a native path or input tape. */
export function compactWalkthroughEvidence(report) {
  const manual = report.manual;
  const rows = manual?.samples || [];
  const fields = manual?.sampleFields || WALKTHROUGH_SAMPLE_FIELDS;
  const column = name => fields.indexOf(name);
  const value = (row, name) => row?.[column(name)];
  const position = row => [value(row, 'worldX'), value(row, 'worldY')];
  const inputRuns = [];
  const trail = [];
  const trailPoint = row => [value(row, 'frameSerial'), value(row, 'submap'), ...position(row)];
  const appendTrail = row => {
    if (row && trail.at(-1)?.[0] !== value(row, 'frameSerial')) trail.push(trailPoint(row));
  };
  let previous = null;
  let previousDirection = null;
  for (const row of rows) {
    const frame = value(row, 'frameSerial');
    const submap = value(row, 'submap');
    const input = value(row, 'control');
    const lastRun = inputRuns.at(-1);
    const contiguous = previous && frame === value(previous, 'frameSerial') + 1 && submap === value(previous, 'submap');
    if (lastRun && contiguous && lastRun.inputMask === input) {
      lastRun.lastFrame = frame;
      lastRun.observations += 1;
      lastRun.to = position(row);
    } else {
      inputRuns.push({ firstFrame:frame, lastFrame:frame, observations:1,
        submap, inputMask:input, controls:input == null ? [] : decodeAiInputMask(input),
        from:position(row), to:position(row) });
    }
    const direction = previous ? position(row).map((p, i) => p == null || position(previous)[i] == null
      ? null : Math.sign(p - position(previous)[i])) : null;
    const importantChange = !contiguous || input !== value(previous, 'control') ||
      ['rickState', 'bullets', 'dynamite', 'lives', 'wouldDieCount'].some(key => value(row, key) !== value(previous, key)) ||
      JSON.stringify(direction) !== JSON.stringify(previousDirection);
    if (!previous || importantChange) { appendTrail(previous); appendTrail(row); }
    previous = row;
    previousDirection = direction;
  }
  appendTrail(previous);
  const gai = report.gai;
  const plan = gai?.plan || {};
  const debug = gai?.diagnostics || {};
  const drop = debug.planner?.dropSearch;
  const outcomes = {};
  for (const attempt of drop?.attempts || []) {
    const key = attempt.outcomeLabel || String(attempt.outcome);
    outcomes[key] = (outcomes[key] || 0) + 1;
  }
  return clone({ schema:'rdr.gai.walkthrough-summary.v1', createdAt:report.createdAt,
    metadata:report.metadata,
    comparison:{ positionUnits:'native world pixels', controlEncoding:'native input mask; controls are decoded names',
      manualInputRuns:'manual.inputRuns', plannedInputRuns:'gai.certificateProgram.phases',
      plannedStopCondition:'guards; watchdogFrames is a limit, not a duration',
      manualSupportTransitions:'unavailable in this capture; establish by native replay',
      plannedSupportTransitions:'gai.proofTransitions; independent proofs, not an executed path' },
    manual:manual ? { startedAt:manual.startedAt, stoppedAt:manual.stoppedAt,
      active:manual.active, stopReason:manual.stopReason, metadata:manual.metadata,
      completion:'not-asserted', captureKind:'observed-native-controls', replayable:false,
      observations:rows.length, skippedFrames:manual.skippedFrames, discontinuities:manual.discontinuities,
      baseline:snapshotSummary(manual.baseline), endpoint:snapshotSummary(manual.endpoint),
      inputRuns, trailFields:['frameSerial', 'submap', 'worldX', 'worldY'], positionTrail:trail,
      trailKind:'input/state/resource changes and motion-direction boundaries; intermediate positions omitted',
      settingsChanges:manual.settingsChanges } : null,
    gai:gai ? { capturedAt:gai.capturedAt, metadata:gai.metadata,
      submap:plan.submap, complete:plan.complete, partial:plan.partial,
      phaseCount:plan.phaseCount, routeEdgeCount:plan.routeEdgeCount,
      routeDebugEdgeCount:plan.certifiedEdgeCount,
      initialState:debug.capturedWorld, policy:{ scenario:debug.scenario, preferSafe:debug.preferSafe },
      nodeTraversal:plan.proofRecords ? undefined : (plan.steps || []).map(step => step.nodeId),
      proofTransitions:plan.proofRecords?.map(record => ({ from:record.from, to:record.to,
        kind:record.kindLabel, source:record.source, target:record.target,
        fromSupportId:record.sourceSupport?.id ?? null, toSupportId:record.targetSupport?.id ?? null,
        occurrences:record.occurrences })),
      nodes:[...new Map((plan.steps || []).map(step => [step.nodeId,
        { id:step.nodeId, position:[step.point?.x, step.point?.y], support:step.support }])).values()],
      traversalKind:plan.inspectionKind || 'retained route-debug history; not an executed traversal or a substitute for the certificate program',
      certificateProgram:debug.certificateProgram ? { ...debug.certificateProgram,
        phases:debug.certificateProgram.phases.map(phase => ({ ...phase,
          stopCondition:(phase.guards || []).map(guard => describeAiPhaseGuard(guard,
            (plan.steps || []).map(step => step.support))).join(' and ') })) } : null,
      blocker:plan.blocker ? { kind:plan.blocker.kindLabel, from:plan.blocker.from, to:plan.blocker.to,
        source:plan.blocker.source, target:plan.blocker.target, proofStage:plan.blocker.proofStage } : null,
      planningWork:debug.planningWork,
      dropSearch:drop ? { result:drop.resultLabel, source:drop.source, target:drop.target,
        attemptCount:drop.attempts?.length || 0, attemptsTruncated:drop.attemptsTruncated, outcomes } : null } : null,
    guidance:'Input runs group consecutive observed native controls. Gaps remain explicit; these are not a replay tape. Position trails omit intermediate samples. A planned input run is a certificate phase: its guards specify when to stop. Proof transitions identify support pairs but do not establish route continuity. Manual support transitions require native replay.' });
}

/** Observation evidence, deliberately not a native checkpoint or replay tape. */
export class WalkthroughEvidence {
  constructor({ maxSamples = 18000 } = {}) {
    this.maxSamples = maxSamples;
    this.manual = null;
    this.gai = null;
  }

  start(snapshot, metadata = {}) {
    if (!snapshot) throw new Error('Gameplay is not ready to record.');
    this.manual = { startedAt:new Date().toISOString(), active:true,
      complete:false, stopReason:null, metadata:clone(metadata),
      baseline:clone(snapshot), endpoint:clone(snapshot), samples:[],
      settingsChanges:[], skippedFrames:0, discontinuities:0 };
    this.observe(snapshot);
  }

  observe(snapshot) {
    const run = this.manual;
    if (!run?.active || !snapshot) return false;
    const previous = run.samples.at(-1);
    if (previous?.[0] === snapshot.frameSerial && previous?.[1] === snapshot.submap) return false;
    if (previous) {
      const delta = snapshot.frameSerial - previous[0];
      if (delta <= 0) run.discontinuities += 1;
      else run.skippedFrames += Math.max(0, delta - 1);
    }
    const currentSettings = settings(snapshot);
    if (JSON.stringify(run.settingsChanges.at(-1)?.settings) !== JSON.stringify(currentSettings))
      run.settingsChanges.push({ sample:run.samples.length, settings:currentSettings });
    run.samples.push(sample(snapshot));
    // Only the endpoint is retained in full; intermediate observations are compact.
    run.endpoint = clone(snapshot);
    if (run.samples.length >= this.maxSamples) this.stop('sample-limit');
    return true;
  }

  stop(reason = 'user-stopped') {
    if (!this.manual?.active) return;
    this.manual.active = false;
    this.manual.stopReason = reason;
    this.manual.stoppedAt = new Date().toISOString();
  }

  retainPlan(plan, diagnostics, metadata = {}) {
    this.gai = { capturedAt:new Date().toISOString(), metadata:clone(metadata),
      plan:clone(plan), diagnostics:clone(diagnostics) };
  }

  export(metadata = {}) {
    return clone({ schema:'rdr.gai.walkthrough-evidence.v1',
      createdAt:new Date().toISOString(), metadata,
      manual:this.manual ? { ...this.manual, sampleFields:WALKTHROUGH_SAMPLE_FIELDS,
        captureKind:'observed-native-snapshots', replayable:false,
        completion:'not-asserted' } : null,
      gai:this.gai,
      guidance:'Partial manual observations and a separately retained GAI plan. Controls are sampled observations, not an exact input tape. Compare baseline, policy and frame gaps before drawing conclusions.' });
  }

  exportCompact(metadata = {}) { return compactWalkthroughEvidence(this.export(metadata)); }
}

export function downloadWalkthroughEvidence(value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value)], { type:'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `gai-walkthrough-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
