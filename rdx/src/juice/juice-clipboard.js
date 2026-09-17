import { DEFAULT_PROFILE, cloneProfile, normalizeProfile } from './juice-protocol.js';

export const JUICE_EFFECT_CLIPBOARD_SCHEMA = 'rick-dangerous-revival.juice-effect-clipboard.v1';
export const JUICE_ACTION_CLIPBOARD_SCHEMA = 'rick-dangerous-revival.juice-action-clipboard.v1';

export const ACTION_SCOPED_GAMEPLAY_FIELDS = Object.freeze({
  'player.explosion_near_miss': Object.freeze([
    'explosionNearBounceLift'
  ]),
  'platform.start': Object.freeze(['platformCurveMode','platformCurveX1','platformCurveY1','platformCurveX2','platformCurveY2']),
  'platform.stop': Object.freeze(['platformCurveMode','platformCurveX1','platformCurveY1','platformCurveX2','platformCurveY2']),
  'platform.moving': Object.freeze(['platformCurveMode','platformCurveX1','platformCurveY1','platformCurveX2','platformCurveY2']),
  'platform.running': Object.freeze(['platformCurveMode','platformCurveX1','platformCurveY1','platformCurveX2','platformCurveY2'])
});

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

export function parseActionClipboardText(text) {
  const json = String(text || '').trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1');
  let payload;
  try { payload = JSON.parse(json); }
  catch { throw new Error('Paste valid action JSON copied from the action Copy button.'); }
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  if (!object(payload) || payload.schema !== JUICE_ACTION_CLIPBOARD_SCHEMA) {
    throw new Error('Expected an action clipboard payload, not a whole profile or an effect payload.');
  }
  const known = DEFAULT_PROFILE.actions[payload.sourceAction];
  if (!known || !object(payload.recipe) || typeof payload.recipe.enabled !== 'boolean') {
    throw new Error('Action JSON needs a valid sourceAction and a recipe with enabled set to true or false.');
  }
  for (const [key, value] of Object.entries(payload.recipe)) {
    if (!Object.hasOwn(known, key) || (['enabled', 'solo'].includes(key) ? typeof value !== 'boolean' : !object(value))) {
      throw new Error(`Invalid action recipe field: ${key}.`);
    }
  }
  if (payload.gameplay !== undefined && !object(payload.gameplay)) throw new Error('Action gameplay settings must be an object.');
  return payload;
}

export function copyEffectClipboardPayload(sourceAction, effectKey, effect) {
  if (!sourceAction || !effectKey || !effect || typeof effect !== 'object') return null;
  return {
    schema: JUICE_EFFECT_CLIPBOARD_SCHEMA,
    sourceAction: String(sourceAction),
    effectKey: String(effectKey),
    value: cloneValue(effect)
  };
}

/* Inspector controls normalize the profile after every edit, replacing action/effect
 * objects. UI callbacks must resolve the effect from the current profile at click
 * time instead of copying the object that happened to exist when the drawer was
 * rendered. This is especially important for poseEmitter bindings where sliders
 * intentionally update without rebuilding the inspector. */
export function copyLiveEffectClipboardPayload(profile, sourceAction, effectKey) {
  const effect = profile?.actions?.[sourceAction]?.[effectKey];
  return copyEffectClipboardPayload(sourceAction, effectKey, effect);
}

export function pasteEffectClipboardPayload(profile, targetAction, payload) {
  if (!profile?.actions?.[targetAction] || !payload || payload.schema !== JUICE_EFFECT_CLIPBOARD_SCHEMA) return null;
  const effectKey = String(payload.effectKey || '');
  if (!effectKey || !profile.actions[targetAction]?.[effectKey] || !payload.value || typeof payload.value !== 'object') return null;
  const draft = cloneProfile(profile);
  draft.actions[targetAction][effectKey] = cloneValue(payload.value);
  return normalizeProfile(draft);
}

export function copyActionClipboardPayload(profile, gameplayTuning, sourceAction) {
  const recipe = profile?.actions?.[sourceAction];
  if (!recipe || typeof recipe !== 'object') return null;
  const gameplay = {};
  for (const key of ACTION_SCOPED_GAMEPLAY_FIELDS[sourceAction] || []) {
    if (Object.prototype.hasOwnProperty.call(gameplayTuning || {}, key)) gameplay[key] = gameplayTuning[key];
  }
  const actionRecipe = cloneValue(recipe);
  /* HUD inventory feedback is authored in its own tool and must not travel
   * with a world/action copy operation. */
  delete actionRecipe.hudImpulse;
  return {
    schema: JUICE_ACTION_CLIPBOARD_SCHEMA,
    sourceAction: String(sourceAction),
    recipe: actionRecipe,
    gameplay
  };
}

export function pasteActionClipboardPayload(profile, gameplayTuning, targetAction, payload) {
  if (!profile?.actions?.[targetAction] || !payload || payload.schema !== JUICE_ACTION_CLIPBOARD_SCHEMA || !payload.recipe || typeof payload.recipe !== 'object') return null;
  const draft = cloneProfile(profile);
  const hudImpulse = cloneValue(draft.actions[targetAction].hudImpulse);
  draft.actions[targetAction] = cloneValue(payload.recipe);
  draft.actions[targetAction].hudImpulse = hudImpulse;
  const nextGameplayTuning = { ...(gameplayTuning || {}) };
  const appliedGameplayFields = [];
  for (const key of ACTION_SCOPED_GAMEPLAY_FIELDS[targetAction] || []) {
    if (!Object.prototype.hasOwnProperty.call(payload.gameplay || {}, key)) continue;
    nextGameplayTuning[key] = payload.gameplay[key];
    appliedGameplayFields.push(key);
  }
  return {
    profile: normalizeProfile(draft),
    gameplayTuning: nextGameplayTuning,
    appliedGameplayFields
  };
}
