import { gameplayAgentState, forceGameplayDebugFrame } from './gameplay-control.js';
import { readGameplayTrace } from './debug-tools.js';
import { XRICK_GAMEPLAY_CONTROL_BY_NAME as bits } from '../runtime/controls.js';

export const ACTION_CONDITIONS = ['x_at_least','x_at_most','y_at_least','y_at_most','falling','landed','climbing','submap_changed'];
const SLOT = 6;
const MAX_FRAMES = 12000;

export function validateHeroActions(actions) {
  if (!Array.isArray(actions) || !actions.length || actions.length > 256) throw new Error('actions must contain 1–256 actions');
  let total = 0;
  const result = actions.map((action, index) => {
    if (!action || typeof action !== 'object' || Object.keys(action).some(k => !['controls','frames','until','target','maxFrames'].includes(k))) throw new Error(`Invalid action ${index}`);
    if (!Array.isArray(action.controls) || action.controls.some(c => !Object.hasOwn(bits,c)) || new Set(action.controls).size !== action.controls.length) throw new Error(`Invalid controls at action ${index}`);
    if (action.controls.includes('left') && action.controls.includes('right') || action.controls.includes('up') && action.controls.includes('down')) throw new Error(`Conflicting controls at action ${index}`);
    const conditional = action.until !== undefined;
    if (conditional ? !ACTION_CONDITIONS.includes(action.until) || action.frames !== undefined : action.maxFrames !== undefined || action.target !== undefined) throw new Error(`Invalid condition at action ${index}`);
    if (conditional && /^[xy]_/.test(action.until) && !Number.isInteger(action.target)) throw new Error(`Coordinate target required at action ${index}`);
    const limit = conditional ? action.maxFrames : action.frames;
    if (!Number.isInteger(limit) || limit < 1 || limit > 4000) throw new Error(`Action ${index} needs a frame bound of 1–4000`);
    total += limit;
    return {...action, limit, mask:action.controls.reduce((mask,c) => mask | bits[c],0)};
  });
  if (total > MAX_FRAMES) throw new Error(`Action bounds exceed ${MAX_FRAMES} frames`);
  return result;
}

function matched(action, state, start) {
  switch(action.until) {
    case 'x_at_least': return state.hero.worldX >= action.target;
    case 'x_at_most': return state.hero.worldX <= action.target;
    case 'y_at_least': return state.hero.worldY >= action.target;
    case 'y_at_most': return state.hero.worldY <= action.target;
    case 'falling': return state.hero.motion === 'falling';
    case 'landed': return state.hero.grounded;
    case 'climbing': return state.hero.climbing;
    case 'submap_changed': return state.submap !== start.submap;
    default: return false;
  }
}

export function createHeroActionRunner(bridge, {beforeRun = () => {}, afterRun = () => {}, yieldFrame = () => new Promise(resolve => setTimeout(resolve,0))} = {}) {
  let baseline = null, nextId = 1, running = false, cancelled = false, artifact = null;
  const observe = () => {
    const state = gameplayAgentState(bridge);
    const snapshot = bridge.snapshot();
    return {state, entities:snapshot.entities || [], runtimeOptions:snapshot.runtimeOptions};
  };
  const dead = state => !state.hero.active || !!(state.hero.state & 0x30);
  const fingerprint = value => JSON.stringify(value);
  function checkAvailable() {
    if (running) throw new Error('Hero action run is already active');
    for (const method of ['debugCheckpointSave','debugCheckpointLoad','setFrontendPaused','setDebugControl','debugTraceBegin','debugTraceFinish','debugTraceEvents'])
      if (typeof bridge?.[method] !== 'function') throw new Error(`Native action backend unavailable: ${method}`);
  }
  async function execute({actions, baselineId, replay = false} = {}) {
    const validated = replay ? null : validateHeroActions(actions);
    checkAvailable();
    if ((baselineId || replay) && (!baseline || (baselineId && baseline.id !== baselineId))) throw new Error('Missing or stale baselineId; create a new run from current state');
    if (replay && !artifact) throw new Error('No action tape to replay');
    beforeRun();
    bridge.setFrontendPaused(true);
    bridge.setDebugControl(0);
    if (baselineId || replay) {
      if (!bridge.debugCheckpointLoad(SLOT)) throw new Error('Native baseline is no longer available');
      bridge.setFrontendPaused(true);
    } else {
      if (!bridge.debugCheckpointSave(SLOT)) throw new Error('Could not save native baseline');
      artifact = null;
      baseline = {id:`actions-${nextId++}`, observation:observe()};
    }
    if (fingerprint(observe()) !== fingerprint(baseline.observation)) throw new Error('Baseline restore diverged; create a new run');
    running = true; cancelled = false;
    const reference = artifact;
    const tape = [], history = [], completed = [];
    let reason = 'actions_completed', failure = null, index = 0;
    const step = async (mask, actionIndex) => {
      const before = observe();
      if (dead(before.state)) return {reason:'hero_dead', before};
      bridge.debugTraceBegin(mask);
      bridge.setDebugControl(mask);
      forceGameplayDebugFrame(bridge);
      bridge.debugTraceFinish();
      const after = observe();
      const record = {mask, actionIndex, observation:after};
      tape.push(record);
      history.push({frame:tape.length,actionIndex,controls:mask,before:before.state.hero,after:after.state.hero});
      if (history.length > 8) history.shift();
      let problem = null;
      if (after.state.frameSerial === before.state.frameSerial) problem = 'simulation_stalled';
      else if (dead(after.state) || after.state.inventory?.lives < before.state.inventory?.lives) problem = 'hero_dead';
      if (problem) {
        const trace = readGameplayTrace(bridge);
        return {reason:problem,before,after,cause:trace.deaths?.find(event => event.cause !== 'unattributed_native_death') || trace.deaths?.[0] || null,trace};
      }
      if (tape.length % 32 === 0) { bridge.setDebugControl(0); await yieldFrame(); }
      return null;
    };
    try {
      if (replay) {
        for (index = 0; index < reference.tape.length; ++index) {
          if (cancelled) { reason = 'cancelled'; break; }
          const expected = reference.tape[index];
          failure = await step(expected.mask,expected.actionIndex);
          if (fingerprint(tape[index]) !== fingerprint(expected)) { reason = 'replay_diverged'; failure = {frame:index + 1,expected,actual:tape[index],trace:readGameplayTrace(bridge)}; break; }
          if (failure) { reason = failure.reason; break; }
        }
        if (!failure && !cancelled) reason = reference.reason;
      } else {
        outer: for (index = 0; index < validated.length; ++index) {
          const action = validated[index], start = observe().state;
          let frames = 0;
          if (dead(start)) { reason = 'hero_dead'; failure = {actual:start}; break; }
          while (frames < action.limit && !(action.until && matched(action,observe().state,start))) {
            if (cancelled) { reason = 'cancelled'; break outer; }
            failure = await step(action.mask,index); frames++;
            if (failure) { reason = failure.reason; break outer; }
            const current = observe().state;
            if (current.submap !== start.submap && action.until !== 'submap_changed') { reason = 'unexpected_room_transition'; failure = {expected:action,actual:current}; break outer; }
          }
          if (action.until && !matched(action,observe().state,start)) { reason = 'condition_timeout'; failure = {expected:action,actual:observe(),trace:readGameplayTrace(bridge)}; break; }
          completed.push({actionIndex:index,frames});
        }
      }
    } catch (error) {
      reason = 'runtime_error'; failure = {message:String(error?.message || error)};
    } finally {
      bridge.setDebugControl(0); bridge.debugTraceFinish(); bridge.setFrontendPaused(true); running = false;
    }
    if (!replay) artifact = {tape,reason};
    const result = {schema:'rdr.gameplay.actions.v1',baselineId:baseline.id,start:baseline.observation.state,reason,frames:tape.length,completed,
      matchedReplay:replay ? reason === reference.reason && tape.length === reference.tape.length : undefined,
      failure:failure ? {actionIndex:replay ? reference.tape[index]?.actionIndex : index,frame:tape.length,...failure} : null,
      recentInputs:history,end:observe(),held:true};
    afterRun(result);
    return result;
  }
  return {run:execute,replay:options => execute({...options,replay:true}),busy:() => running,
    cancel:() => { cancelled = true; return {cancellationRequested:running}; },
    state:() => ({baselineId:baseline?.id,running,frames:artifact?.tape.length || 0,observation:observe()})};
}
