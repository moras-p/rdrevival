import { ACTIONS, MAX_POSE_EMITTER_BINDINGS, cloneProfile, estimateActionCost, normalizeProfile } from './juice-protocol.js';
import { actionCompatibility } from './juice-compatibility.js';
import { PRESENTATION_LAYERS } from './presentation-layer-mask.js';

const actionIds = Object.freeze(ACTIONS.map(action => action.id));
const layers = Object.freeze([...PRESENTATION_LAYERS]);
const bool = description => ({ type:'boolean', description });
const str = (values, description, extra={}) => ({ type:'string', ...(values ? {enum:values} : {}), description, ...extra });
const num = (minimum, maximum, unit, description, extra={}) => ({ type:'number', minimum, maximum, description:`${description} Range ${minimum}–${maximum}${unit ? ` ${unit}` : ''}.`, ...extra });
const integer = (minimum, maximum, unit, description, extra={}) => ({ type:'integer', minimum, maximum, description:`${description} Range ${minimum}–${maximum}${unit ? ` ${unit}` : ''}.`, ...extra });
const object = (properties, description='') => ({ type:'object', properties, additionalProperties:false, ...(description ? {description} : {}) });
const layerMask = description => ({
  type:'array', minItems:1, uniqueItems:true,
  items:{type:'string',enum:layers},
  description:`${description} Valid presentation layers: ${layers.join(', ')}.`
});
const effectEnabled = description => bool(`${description} Disabled effects have zero action cost and no compatibility impact.`);

const emitterProperties = Object.freeze({
  enabled:effectEnabled('Enable this particle emitter.'),
  anchorX:integer(0,31,'px','Horizontal anchor inside the 32×21 reference sprite.'),
  anchorY:integer(0,20,'px','Vertical anchor inside the 32×21 reference sprite.'),
  mirrorX:bool('Mirror the anchor with actor facing direction.'),
  flipH:bool('Flip the authored reference horizontally.'),
  flipV:bool('Flip the authored reference vertically.'),
  refX:integer(0,31,'px','Reference crop X inside the 32×21 pose.'),
  refY:integer(0,20,'px','Reference crop Y inside the 32×21 pose.'),
  refW:integer(1,32,'px','Reference crop width; normalization also constrains it to remain inside the 32 px pose width.'),
  refH:integer(1,21,'px','Reference crop height; normalization also constrains it to remain inside the 21 px pose height.'),
  emitterWidth:integer(1,32,'px','Particle emitter width.'),
  emitterHeight:integer(1,21,'px','Particle emitter height.'),
  count:integer(0,32,'particles','Particles emitted per burst.'),
  speed:num(0,160,'px/s','Initial particle speed.'),
  lifeMs:integer(10,2000,'ms','Particle lifetime.'),
  spread:num(0,2,'rad','Angular spread.'),
  gravity:num(-200,300,'px/s²','Particle gravity.'),
  size:integer(1,4,'px','Particle block size.'),
  tone:str(['smoke','spark','dust'],'Authored retro particle tone.'),
  playbackMode:str(['loop','one-shot'],'Generator playback behavior.'),
  cadenceFrames:integer(1,30,'native frames','Frames between repeated bursts.')
});

const heroPoseItem = object({
  id:str(null,'Stable pose binding id.',{maxLength:48,pattern:'^[A-Za-z0-9_.:-]+$'}),
  event:str(actionIds,'Game Juice event that owns this pose.'),
  frameSource:str(['event','frame'],'Use the event pose or a specific classic frame.'),
  frameId:integer(1,0x1a,'classic frame id','Classic Rick frame id.'),
  holdMode:str(['frames','while-fire','while-action'],'Pose hold policy.'),
  frames:integer(1,12,'native frames','Fixed hold duration when holdMode=frames.')
});

const poseEmitterItem = object({
  id:str(null,'Stable generator binding id.',{maxLength:48,pattern:'^[A-Za-z0-9_.:-]+$'}),
  event:str(actionIds,'Game Juice event that owns this generator.'),
  holdMode:str(['frames','while-fire','while-action'],'Reference-pose lifetime policy.'),
  frames:integer(1,60,'native frames','Reference-pose lifetime.'),
  referenceDirection:integer(-1,1,'direction','Reference facing: -1 left, 0 event/default, +1 right.'),
  classicFrameSource:str(['event','frame'],'Classic reference frame source.'),
  classicFrameId:integer(1,0x1a,'classic frame id','Classic reference frame id.'),
  rdxFrameSource:str(['event','frame'],'RDX reference frame source.'),
  rdxPn:integer(0,255,'PN','RDX sprite PN.'),
  rdxFrameIndex:integer(0,255,'frame index','RDX sprite frame index.'),
  capturedPose:str(null,'Optional captured reference-pose payload.',{maxLength:500000}),
  emitter:object(emitterProperties,'Pose-attached particle generator. Particle output should stay small, opaque/masked and CD32-plausible.')
});

export const ACTION_RECIPE_PATCH_SCHEMA = Object.freeze(object({
  enabled:bool('Master enable for this action recipe.'),
  solo:bool('Solo this action while authoring.'),
  particles:object({
    enabled:effectEnabled('Enable free particles.'),
    count:integer(0,64,'particles','Particles emitted per event.'),
    speed:num(0,160,'px/s','Initial particle speed.'),
    lifeMs:num(10,2000,'ms','Particle lifetime.'),
    spread:num(0,2,'rad','Angular spread.'),
    gravity:num(-200,300,'px/s²','Particle gravity.'),
    size:integer(1,16,'px','Particle block size.'),
    shape:str(['block','puff'],'Particle shape. Prefer opaque/masked pixel constructions for CD32-plausible output.'),
    spawnRadius:integer(0,24,'px','Random spawn radius around the event.'),
    emitterWidth:integer(1,64,'px','Emitter width.'),
    emitterHeight:integer(1,64,'px','Emitter height.'),
    shrink:bool('Shrink particles over their lifetime.'),
    tone:str(['dust','smoke','spark'],'Retro particle palette/tone.')
  },'Small sprite/block particles; keep counts and blending visually restrained.'),
  camera:object({
    enabled:effectEnabled('Enable camera impulse.'),
    amplitude:num(0,12,'px','Maximum camera displacement.'),
    durationMs:num(0,1200,'ms','Impulse duration.'),
    frequency:num(1,80,'Hz','Impulse oscillation frequency.'),
    impactLinked:bool('Scale impulse from event impact magnitude.'),
    impactMinScale:num(0,1,'ratio','Minimum impact-linked scale.'),
    impactExponent:num(0.25,4,'exponent','Impact response exponent.')
  },'Camera impulses are CD32-plausible because they do not increase sprite/render complexity.'),
  flash:object({
    enabled:effectEnabled('Enable contact flash.'),
    alpha:num(0,1,'opacity','Flash opacity. CD32-compatible authoring requires 1.0 (opaque/masked), not alpha blending.'),
    durationMs:num(0,800,'ms','Flash duration.'),
    radius:num(1,80,'px','Flash radius.'),
    targetMode:str(['area','foreground','background','nearby-actors','target-actor'],'Flash target selection.')
  }),
  actorFlash:object({
    enabled:effectEnabled('Enable actor flash.'),
    color:str(['white','red'],'Actor flash palette color.'),
    frames:integer(0,5,'native frames','Flash duration.'),
    alpha:num(0,1,'opacity','Actor flash opacity. CD32-compatible authoring requires 1.0.')
  }),
  worldFlash:object({
    enabled:effectEnabled('Enable world/layer flash.'),
    color:str(['white','gray','red'],'Foreground/world flash palette color.'),
    backgroundColor:str(['white','off-white','faint-white','gray','red'],'Behind-actor flash palette color.'),
    backgroundAlphaScale:num(0,1,'opacity scale','Behind-actor strength. CD32-compatible authoring requires 1.0 whenever backdrop, midground or actors are selected.'),
    frames:integer(0,5,'native frames','Flash duration.'),
    alpha:num(0,1,'opacity','World flash opacity. CD32-compatible authoring requires 1.0.'),
    radius:integer(8,160,'px','Flash radius.'),
    blockSize:integer(4,16,'px','Quantized block size.'),
    ringWidth:integer(4,64,'px','Flash ring width.'),
    layerMask:layerMask('Layers affected by this flash.'),
    foregroundDelayFrames:integer(0,8,'native frames','Delay for in-front layers.'),
    backgroundDelayFrames:integer(0,8,'native frames','Delay for behind-actor layers.')
  },'Layer-aware palette/block flash. Use opaque values for CD32-compatible output.'),
  hitStop:object({ enabled:effectEnabled('Enable hit stop.'), frames:integer(0,5,'native frames','Stop duration.') }),
  spriteImpulse:object({
    enabled:effectEnabled('Enable actor sprite impulse.'),
    x:num(-12,12,'px','Horizontal displacement.'), y:num(-12,12,'px','Vertical displacement.'),
    squash:num(-0.35,0.35,'ratio','Visual squash amount.'),
    deformationMode:str(['blitter-bands','translate','scale'],'Deformation method. scale is enhanced-only because it relies on real-time sprite scaling; blitter-bands/translate remain within the CD32-plausible vocabulary.'),
    bands:integer(2,8,'bands','Number of blitter-style deformation bands.'),
    deformationPixels:integer(0,8,'px','Band deformation extent.'),
    degradeSprite:bool('Apply coarse sprite degradation during the impulse.'),
    degradationPx:integer(0,4,'px','Sprite degradation extent.'),
    durationMs:num(0,800,'ms','Impulse duration.')
  }),
  foregroundDust:object({
    enabled:effectEnabled('Enable quantized foreground dust.'), radius:integer(8,160,'px','Dust radius.'), blockSize:integer(4,16,'px','Dust grid block size.'),
    density:num(0,1,'ratio','Dust occupancy.'), speed:num(0,180,'px/s','Particle speed.'), lifeMs:integer(40,1200,'ms','Particle lifetime.'),
    gravity:num(-100,300,'px/s²','Particle gravity.'), size:integer(1,4,'px','Particle size.'), layerMask:layerMask('Layers receiving foreground dust.')
  }),
  knockback:object({ enabled:effectEnabled('Enable authored knockback feedback.'), distance:num(0,16,'px','Horizontal distance.'), lift:num(-8,8,'px','Vertical lift.'), frames:integer(0,8,'native frames','Duration.') }),
  hudImpulse:object({
    enabled:effectEnabled('Enable HUD impulse.'), color:str(['white','gray','red'],'HUD palette color.'), mask:str(['sprite','square'],'HUD mask construction.'),
    pattern:str(['tint','strobe','spark','cross','scan','hop'],'HUD feedback pattern.'), resourceScope:str(['event','bullet','dynamite','life','all'],'HUD resource scope.'),
    frames:integer(0,6,'native frames','Duration.'), alpha:num(0,1,'opacity','HUD flash opacity. CD32-compatible authoring requires 1.0.'), jitter:integer(0,3,'px','HUD jitter.'), staggerFrames:integer(0,4,'native frames','Per-element stagger.')
  }),
  heroPose:object({
    enabled:effectEnabled('Legacy pose binding enable.'), frame:str(['event','shoot','staff','jump','crawl'],'Legacy pose source.'), holdMode:str(['frames','while-fire','while-action'],'Legacy hold policy.'),
    frames:integer(1,12,'native frames','Legacy hold duration.'), poses:{type:'array',maxItems:12,items:heroPoseItem,description:'Legacy authored pose bindings.'}
  }),
  attachedEmitter:object({
    enabled:effectEnabled('Legacy attached emitter enable.'), anchorX:integer(0,31,'px','Horizontal anchor.'), anchorY:integer(0,20,'px','Vertical anchor.'), mirrorX:bool('Mirror with facing direction.'),
    emitterWidth:integer(1,32,'px','Emitter width.'), emitterHeight:integer(1,21,'px','Emitter height.'), count:integer(0,32,'particles','Particles per burst.'), speed:num(0,160,'px/s','Initial particle speed.'),
    lifeMs:integer(10,2000,'ms','Particle lifetime.'), spread:num(0,2,'rad','Angular spread.'), gravity:num(-200,300,'px/s²','Particle gravity.'), size:integer(1,4,'px','Particle size.'), tone:str(['smoke','spark','dust'],'Particle tone.')
  }),
  poseEmitter:object({
    enabled:effectEnabled('Enable pose-attached particle generators.'),
    bindings:{type:'array',maxItems:MAX_POSE_EMITTER_BINDINGS,items:poseEmitterItem,description:`Pose-attached generator bindings; maximum ${MAX_POSE_EMITTER_BINDINGS}.`}
  }),
  audio:object({
    enabled:effectEnabled('Enable authored sound replacement/accent.'), sample:str(null,'Primary sample file name.',{maxLength:48,pattern:'^[A-Za-z0-9_.-]*$'}),
    gain:num(0,1.5,'linear gain','Primary sample gain.'), pitchVariance:num(0,0.2,'ratio','Random pitch variance.'), rate:num(0.5,2,'playback rate','Primary playback rate.'), pan:num(-1,1,'stereo pan','Static pan.'), panFromEvent:bool('Derive pan from event position.'),
    attackMs:integer(0,250,'ms','Envelope attack.'), releaseMs:integer(0,500,'ms','Envelope release.'), filterType:str(['none','lowpass','highpass','bandpass'],'Optional simple filter.'), filterHz:integer(80,12000,'Hz','Filter cutoff/center frequency.'),
    layerSample:str(null,'Optional layered sample file name.',{maxLength:48,pattern:'^[A-Za-z0-9_.-]*$'}), layerGain:num(0,1.5,'linear gain','Layer sample gain.'), layerRate:num(0.5,2,'playback rate','Layer playback rate.')
  })
},'Strict partial patch for one Game Juice action. Unknown fields are rejected. Numeric values outside the documented range are clamped and reported.'));

function isPlainObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function same(a,b) { return JSON.stringify(a) === JSON.stringify(b); }
function setPath(target, path, value) {
  const parts=path.split('.'); let cursor=target;
  for(let i=0;i<parts.length-1;i+=1) cursor=cursor[parts[i]] ||= {};
  cursor[parts.at(-1)] = value;
}
function getPath(target, path) { return path.split('.').reduce((value,key)=>value == null ? undefined : value[key],target); }
function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }

function sanitizeValue(schema, value, path, reports) {
  if (!schema) { reports.rejected.push({path,requested:clone(value),reason:'unknown field'}); return {accepted:false}; }
  if (schema.type === 'object') {
    if (!isPlainObject(value)) { reports.rejected.push({path,requested:clone(value),reason:'expected object'}); return {accepted:false}; }
    const out={};
    for(const [key,child] of Object.entries(value)) {
      const childPath=path ? `${path}.${key}` : key;
      const result=sanitizeValue(schema.properties?.[key],child,childPath,reports);
      if(result.accepted) out[key]=result.value;
    }
    return {accepted:true,value:out};
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) { reports.rejected.push({path,requested:clone(value),reason:'expected array'}); return {accepted:false}; }
    const max=Number.isFinite(schema.maxItems)?schema.maxItems:value.length;
    const limited=value.slice(0,max);
    if(value.length>max) reports.clamped.push({path,requested:value.length,value:max,reason:`maximum ${max} items`});
    const out=[];
    for(let i=0;i<limited.length;i+=1) {
      const itemPath=`${path}[${i}]`;
      const result=sanitizeValue(schema.items,limited[i],itemPath,reports);
      if(!result.accepted)continue;
      if(schema.uniqueItems && out.some(item=>same(item,result.value))) {
        reports.rejected.push({path:itemPath,requested:clone(limited[i]),reason:'duplicate item'});
        continue;
      }
      out.push(result.value);
    }
    if(Number.isFinite(schema.minItems) && out.length<schema.minItems){reports.rejected.push({path,requested:clone(value),reason:`requires at least ${schema.minItems} valid item(s)`});return {accepted:false};}
    return {accepted:true,value:out};
  }
  if (schema.type === 'boolean') {
    if(typeof value!=='boolean'){reports.rejected.push({path,requested:clone(value),reason:'expected boolean'});return {accepted:false};}
    return {accepted:true,value};
  }
  if (schema.type === 'string') {
    if(typeof value!=='string'){reports.rejected.push({path,requested:clone(value),reason:'expected string'});return {accepted:false};}
    if(schema.enum && !schema.enum.includes(value)){reports.rejected.push({path,requested:value,reason:`expected one of: ${schema.enum.join(', ')}`});return {accepted:false};}
    if(schema.pattern && !(new RegExp(schema.pattern)).test(value)){reports.rejected.push({path,requested:value,reason:`does not match ${schema.pattern}`});return {accepted:false};}
    let normalized=value;
    if(Number.isFinite(schema.maxLength) && normalized.length>schema.maxLength){normalized=normalized.slice(0,schema.maxLength);reports.clamped.push({path,requested:value,value:normalized,reason:`maximum length ${schema.maxLength}`});}
    return {accepted:true,value:normalized};
  }
  if (schema.type === 'number' || schema.type === 'integer') {
    if(typeof value!=='number' || !Number.isFinite(value)){reports.rejected.push({path,requested:clone(value),reason:`expected ${schema.type}`});return {accepted:false};}
    let normalized=schema.type==='integer'?Math.round(value):value;
    if(schema.type==='integer' && normalized!==value) reports.clamped.push({path,requested:value,value:normalized,reason:'rounded to integer'});
    const before=normalized;
    if(Number.isFinite(schema.minimum))normalized=Math.max(schema.minimum,normalized);
    if(Number.isFinite(schema.maximum))normalized=Math.min(schema.maximum,normalized);
    if(normalized!==before)reports.clamped.push({path,requested:value,value:normalized,reason:`range ${schema.minimum ?? '-∞'}–${schema.maximum ?? '∞'}`});
    return {accepted:true,value:normalized};
  }
  reports.rejected.push({path,requested:clone(value),reason:'unsupported schema type'});
  return {accepted:false};
}

function mergePatch(base, patch) {
  if (!isPlainObject(patch)) return clone(patch);
  const out=isPlainObject(base)?clone(base):{};
  for(const [key,value] of Object.entries(patch))out[key]=isPlainObject(value)?mergePatch(out[key],value):clone(value);
  return out;
}

function collectChanges(before, after, patch, prefix='', out=[]) {
  if(!isPlainObject(patch))return out;
  for(const [key,value] of Object.entries(patch)) {
    const path=prefix?`${prefix}.${key}`:key;
    if(isPlainObject(value))collectChanges(before?.[key],after?.[key],value,path,out);
    else if(!same(before?.[key],after?.[key]))out.push({path,before:clone(before?.[key]),value:clone(after?.[key])});
  }
  return out;
}

function collectPostNormalizationAdjustments(requested, normalized, path, reports) {
  if(isPlainObject(requested)) {
    for(const [key,value] of Object.entries(requested))collectPostNormalizationAdjustments(value,normalized?.[key],path?`${path}.${key}`:key,reports);
    return;
  }
  if(Array.isArray(requested)) {
    for(let i=0;i<requested.length;i+=1)collectPostNormalizationAdjustments(requested[i],normalized?.[i],`${path}[${i}]`,reports);
    return;
  }
  if(same(requested,normalized) || reports.clamped.some(row=>row.path===path))return;
  reports.clamped.push({path,requested:clone(requested),value:clone(normalized),reason:'profile normalization'});
}

export function actionRecipeRevision(recipe) {
  const text=JSON.stringify(recipe || null); let hash=0x811c9dc5;
  for(let i=0;i<text.length;i+=1){hash^=text.charCodeAt(i);hash=Math.imul(hash,0x01000193)>>>0;}
  return `r-${hash.toString(16).padStart(8,'0')}`;
}

export function actionRecipeSummary(recipe) {
  return { recipeRevision:actionRecipeRevision(recipe), compatibility:actionCompatibility(recipe), cost:estimateActionCost(recipe) };
}

export function normalizeActionWebMcpPatch(sourceProfile, actionId, patch) {
  if(!actionIds.includes(actionId))throw new Error(`Unknown Game Juice action '${actionId}'`);
  if(!isPlainObject(patch) || !Object.keys(patch).length)throw new Error('Game Juice action patch must contain at least one field');
  const reports={rejected:[],clamped:[]};
  const sanitized=sanitizeValue(ACTION_RECIPE_PATCH_SCHEMA,patch,'',reports).value || {};
  const before=clone(sourceProfile.actions[actionId]);
  const candidate=cloneProfile(sourceProfile);
  candidate.actions[actionId]=mergePatch(candidate.actions[actionId],sanitized);
  const normalizedProfile=normalizeProfile(candidate);
  const after=clone(normalizedProfile.actions[actionId]);
  collectPostNormalizationAdjustments(sanitized,after,'',reports);
  const changes=collectChanges(before,after,sanitized);
  const changed={}; for(const change of changes)setPath(changed,change.path,clone(change.value));
  return { profile:normalizedProfile, recipe:after, changed, changes, clamped:reports.clamped, rejected:reports.rejected, ...actionRecipeSummary(after) };
}

export function filterActionRecipe(recipe, fields = []) {
  if(!Array.isArray(fields) || !fields.length)return clone(recipe);
  const out={};
  for(const raw of fields) {
    const path=String(raw||'').trim(); if(!path)continue;
    const value=getPath(recipe,path);
    if(value!==undefined)setPath(out,path,clone(value));
  }
  return out;
}

function flatten(value,prefix='',out={}) {
  if(isPlainObject(value)){for(const [key,child] of Object.entries(value))flatten(child,prefix?`${prefix}.${key}`:key,out);}
  else out[prefix]=clone(value);
  return out;
}

export function diffActionRecipes(base, target) {
  const a=flatten(base),b=flatten(target),keys=[...new Set([...Object.keys(a),...Object.keys(b)])].sort();
  return keys.filter(key=>!same(a[key],b[key])).map(path=>({path,before:clone(a[path]),value:clone(b[path])}));
}


export const GAME_JUICE_EFFECT_KEYS = Object.freeze(Object.keys(ACTION_RECIPE_PATCH_SCHEMA.properties).filter(key => !['enabled','solo'].includes(key)));

export function actionEffectSchemas(effects = GAME_JUICE_EFFECT_KEYS) {
  const names=[...new Set((Array.isArray(effects)?effects:[effects]).map(String))];
  const properties={};
  for(const name of names){
    if(!GAME_JUICE_EFFECT_KEYS.includes(name))throw new Error(`Unknown Game Juice effect '${name}'`);
    properties[name]=clone(ACTION_RECIPE_PATCH_SCHEMA.properties[name]);
  }
  return {type:'object',properties,additionalProperties:false};
}

export function compactActionRecipeDelta(recipe, baselineRecipe = {}, effects = []) {
  const requested=[...new Set((Array.isArray(effects)?effects:[]).map(String))];
  if(requested.length){
    const out={};
    for(const effect of requested){
      if(!GAME_JUICE_EFFECT_KEYS.includes(effect))throw new Error(`Unknown Game Juice effect '${effect}'`);
      if(recipe?.[effect]!==undefined)out[effect]=clone(recipe[effect]);
    }
    return out;
  }
  const out={};
  for(const change of diffActionRecipes(baselineRecipe,recipe))setPath(out,change.path,clone(change.value));
  return out;
}

export const GAME_JUICE_ACTION_IDS = actionIds;
export const GAME_JUICE_PRESENTATION_LAYERS = layers;
