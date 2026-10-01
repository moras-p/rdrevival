export const REALTIME_ACTION_ABI_VERSION = 1;
export const REALTIME_EXECUTION_ABI_VERSION = 1;
export const REALTIME_CONTINUATION_STATUS_ABI_VERSION = 1;
export const REALTIME_EXECUTION_KIND = Object.freeze({ atomic:0, continuous:1, hybrid:2 });
export const REALTIME_EXECUTION_KIND_NAME = Object.freeze(['atomic','continuous','hybrid']);

export const REALTIME_ACTIONS = Object.freeze([
  'wait',
  'walk_left',
  'walk_right',
  'jump',
  'jump_left',
  'jump_right',
  'crawl_left',
  'crawl_right',
  'ladder_up',
  'ladder_down',
  'ladder_exit_left',
  'ladder_exit_right',
  'shoot',
  'shoot_left',
  'shoot_right',
  'plant_dynamite',
  'plant_dynamite_retreat_left',
  'plant_dynamite_retreat_right',
  'stick_stop'
]);

const ACTION_TO_ID = new Map(REALTIME_ACTIONS.map((name, id) => [name, id]));

export function realtimeActionId(action) {
  if (Number.isInteger(action)) {
    if (action < 0 || action >= REALTIME_ACTIONS.length) throw new RangeError(`Unknown realtime action id ${action}`);
    return action;
  }
  const id = ACTION_TO_ID.get(String(action));
  if (id == null) throw new RangeError(`Unknown realtime action ${action}`);
  return id;
}

export function realtimeActionName(action) {
  return REALTIME_ACTIONS[realtimeActionId(action)];
}

export function legalRealtimeActions(mask) {
  const bits = Number(mask) >>> 0;
  return REALTIME_ACTIONS.flatMap((name, id) => (bits & (1 << id)) ? [{ id, name }] : []);
}
