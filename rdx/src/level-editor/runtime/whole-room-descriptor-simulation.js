function int(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function point(value, fallback = [0, 0]) {
  return Array.isArray(value) && value.length >= 2
    ? Object.freeze([int(value[0]), int(value[1])])
    : Object.freeze([int(fallback[0]), int(fallback[1])]);
}

function opposite(direction) { return direction === 'left' ? 'right' : 'left'; }

export const REACTIVE_PRESENTATION_PHASE_TICKS = 50;
export const REACTIVE_PRESENTATION_PERIOD_TICKS = REACTIVE_PRESENTATION_PHASE_TICKS * 2;

function boundedState(descriptor, tick) {
  const path = descriptor?.world?.path || [];
  if (path.length < 2) return null;
  const start = point(path[0]), end = point(path[1]);
  const timing = descriptor.timing || {};
  const distance = Math.max(0, Math.abs(end[0] - start[0]));
  const step = Math.max(1, Math.abs(int(timing.stepPx, 2)));
  const stepsPerLeg = Math.max(1, int(timing.counterLimit, Math.ceil(distance / step)));
  const loopPeriod = Math.max(2, int(timing.loopPeriodTicks, stepsPerLeg * 2));
  const latency = Math.max(0, int(timing.startupLatencyTicks));
  const initialDirection = String(timing.initialDirection || (end[0] < start[0] ? 'left' : 'right')) === 'left' ? 'left' : 'right';
  const phaseTick = Math.max(0, int(tick));
  let traversed = 0, direction = initialDirection;
  if (phaseTick > latency && distance > 0) {
    const phase = ((phaseTick - latency - 1) % loopPeriod) + 1;
    if (phase <= stepsPerLeg) {
      traversed = Math.min(distance, phase * step);
      if (phase === stepsPerLeg) direction = opposite(initialDirection);
    } else {
      const returning = phase - stepsPerLeg;
      traversed = Math.max(0, distance - returning * step);
      direction = returning >= stepsPerLeg ? initialDirection : opposite(initialDirection);
    }
  }
  const sign = initialDirection === 'left' ? -1 : 1;
  return Object.freeze({
    sourceKey:String(descriptor.sourceKey || ''), kind:descriptor.kind, authority:descriptor.authority,
    position:Object.freeze([start[0] + sign * traversed, start[1]]),
    basePosition:start, direction, tick:phaseTick, phase:phaseTick,
    loopPeriod, startupLatencyTicks:latency
  });
}

function scriptedState(descriptor, tick) {
  const path = descriptor?.world?.path || [];
  const steps = descriptor?.timing?.steps || [];
  const totalTicks = Math.max(0, int(descriptor?.timing?.totalTicks));
  if (!path.length || !steps.length || totalTicks <= 0) return null;
  const origin = point(path[0]);
  let remaining = ((Math.max(0, int(tick)) % totalTicks) + totalTicks) % totalTicks;
  let x = origin[0], y = origin[1], direction = 'right';
  for (const step of steps) {
    const count = Math.max(0, int(step?.count));
    const used = Math.min(remaining, count);
    const dx = int(step?.dx), dy = int(step?.dy);
    x += used * dx; y += used * dy;
    if (used > 0 && dx !== 0) direction = dx < 0 ? 'left' : 'right';
    if (remaining < count) break;
    remaining -= count;
  }
  return Object.freeze({
    sourceKey:String(descriptor.sourceKey || ''), kind:descriptor.kind, authority:descriptor.authority,
    position:Object.freeze([x, y]), basePosition:origin, direction,
    tick:Math.max(0, int(tick)), phase:Math.max(0, int(tick)) % totalTicks, loopPeriod:totalTicks
  });
}


function nativeReactiveState(descriptor, tick) {
  const start = point(descriptor?.world?.path?.[0]);
  const presentationTick = Math.max(0, int(tick));
  const phase = presentationTick % REACTIVE_PRESENTATION_PERIOD_TICKS;
  const walking = phase < REACTIVE_PRESENTATION_PHASE_TICKS;
  return Object.freeze({
    sourceKey:String(descriptor.sourceKey || ''), kind:descriptor.kind, authority:descriptor.authority,
    position:start, basePosition:start, direction:'neutral',
    tick:walking ? phase : REACTIVE_PRESENTATION_PHASE_TICKS - 1,
    phase, presentationTick, walking,
    motionAuthority:'native-xrick-only', presentationAuthority:'resolved-walk-idle-inspection-cycle', reactive:true
  });
}

export function descriptorStateAt(descriptor, tick = 0) {
  if (!descriptor) return null;
  if (descriptor.kind === 'bounded-horizontal-patrol') return boundedState(descriptor, tick);
  if (descriptor.kind === 'ent-mvstep-scripted-path') return scriptedState(descriptor, tick);
  if (descriptor.kind === 'native-reactive-controller') return nativeReactiveState(descriptor, tick);
  return null;
}

export function projectWholeRoomDescriptorStates(descriptors = [], tick = 0) {
  const states = new Map();
  for (const descriptor of descriptors || []) {
    const state = descriptorStateAt(descriptor, tick);
    if (state?.sourceKey) states.set(state.sourceKey, state);
  }
  return states;
}
