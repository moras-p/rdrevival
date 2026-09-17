import { GAME_JUICE_PRODUCTION_PRESETS } from '../../generated/game-juice-presets.js';
import { DEFAULT_PROFILE, cloneProfile, normalizeProfile } from './juice-protocol.js';
import { applyGameStyleTemplate } from './juice-templates.js';
import { actionRecipeRevision, diffActionRecipes } from './juice-webmcp.js';

const FRAME_MS = 40;
const TONE_COLOR = Object.freeze({ dust:'tan', smoke:'gray', spark:'white' });
const PRODUCTION_TARGET = 'revival/game-juice-presets.json';
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);

function presetByKey(key) {
  return GAME_JUICE_PRODUCTION_PRESETS.presets.find(row => row.key === key) || null;
}

export function productionPresetForEditorStyle(editorStyleId) {
  return GAME_JUICE_PRODUCTION_PRESETS.presets.find(row => row.editorStyleId === editorStyleId) || null;
}

export function productionPresetDescriptor({ provenance=null, profile=null }={}) {
  const source = provenance?.source || 'default';
  const editorStyleId = provenance?.editorStyleId || null;
  const explicitKey = provenance?.productionKey || null;
  const preset = explicitKey ? presetByKey(explicitKey) : editorStyleId ? productionPresetForEditorStyle(editorStyleId) : null;
  const baseRevisions = provenance?.baseActionRevisions && typeof provenance.baseActionRevisions === 'object' ? provenance.baseActionRevisions : null;
  let dirty = null;
  if (profile && baseRevisions) {
    dirty = Object.keys(profile.actions || {}).some(actionId => baseRevisions[actionId] && baseRevisions[actionId] !== actionRecipeRevision(profile.actions[actionId]));
  }
  return {
    source,
    editorStyleId: preset?.editorStyleId || editorStyleId,
    productionKey: preset?.key || explicitKey,
    libretroValue: preset?.libretroValue || provenance?.libretroValue || null,
    label: provenance?.label || preset?.label || null,
    productionLabel: preset?.label || null,
    dirty
  };
}

export function capturePresetProvenance({ source='builtin', editorStyleId=null, productionKey=null, libretroValue=null, label=null, profile }) {
  const preset = productionKey ? presetByKey(productionKey) : editorStyleId ? productionPresetForEditorStyle(editorStyleId) : null;
  return {
    source,
    editorStyleId:preset?.editorStyleId || editorStyleId || null,
    productionKey:preset?.key || productionKey || null,
    libretroValue:preset?.libretroValue || libretroValue || null,
    label:label || preset?.label || null,
    baseActionRevisions:Object.fromEntries(Object.entries(profile?.actions || {}).map(([actionId,recipe]) => [actionId,actionRecipeRevision(recipe)]))
  };
}

export function productionEditorBaselineRecipe(presetKey, actionId) {
  const preset=presetByKey(presetKey);if(!preset)return null;
  return clone(editorBaselineForPreset(preset).actions?.[actionId] ?? null);
}

export function productionChangedActionIds(profile,presetKey) {
  const preset=presetByKey(presetKey);if(!preset)throw new Error(`Unknown production Game Juice preset '${presetKey}'`);
  const baseline=editorBaselineForPreset(preset);
  return Object.keys(profile?.actions||{}).filter(actionId=>baseline.actions?.[actionId]&&!same(profile.actions[actionId],baseline.actions[actionId]));
}

function editorBaselineForPreset(preset) {
  const scratch=cloneProfile(DEFAULT_PROFILE);
  if(!applyGameStyleTemplate(scratch,preset.editorStyleId))throw new Error(`Production preset '${preset.key}' references unknown editor style '${preset.editorStyleId}'`);
  return normalizeProfile(scratch);
}

function quantizedFrames(ms, {minimum=1,maximum=8}={}) {
  const frames=Math.round(Number(ms || 0)/FRAME_MS);
  return Math.max(minimum,Math.min(maximum,frames));
}
function requireRange(value,min,max,path,blockers,{integer=false}={}) {
  const n=Number(value);
  if(!Number.isFinite(n) || n<min || n>max || (integer && !Number.isInteger(n))) {
    blockers.push({path,value:clone(value),reason:`production requires ${integer?'integer ':''}${min}..${max}`});
    return null;
  }
  return n;
}
function blockerIfChanged(current,baseline,path,blockers,reason='not representable by production presets') {
  if(!same(current,baseline))blockers.push({path,value:clone(current),reason});
}
function omitEmptyObject(target,key,value){if(value&&Object.keys(value).length)target[key]=value;}

function translateParticles(current,baseline,blockers) {
  if(!current?.enabled)return null;
  const count=requireRange(current.count,0,8,'particles.count',blockers,{integer:true});
  const speed=requireRange(current.speed,0,160,'particles.speed',blockers,{integer:true});
  const lifeMs=requireRange(current.lifeMs,0,2000,'particles.lifeMs',blockers);
  const spread=requireRange(current.spread,0,2,'particles.spread',blockers);
  const gravity=requireRange(current.gravity,-200,300,'particles.gravity',blockers);
  const size=requireRange(current.size,1,16,'particles.size',blockers,{integer:true});
  const spawnRadius=requireRange(current.spawnRadius,0,24,'particles.spawnRadius',blockers,{integer:true});
  const emitterWidth=requireRange(current.emitterWidth,1,64,'particles.emitterWidth',blockers,{integer:true});
  const emitterHeight=requireRange(current.emitterHeight,1,64,'particles.emitterHeight',blockers,{integer:true});
  const color=TONE_COLOR[current.tone];if(!color)blockers.push({path:'particles.tone',value:current.tone,reason:'production supports dust/smoke/spark tones only'});
  if(!['block','puff'].includes(current.shape))blockers.push({path:'particles.shape',value:current.shape,reason:'production supports block/puff particle shapes only'});
  if([count,speed,lifeMs,spread,gravity,size,spawnRadius,emitterWidth,emitterHeight].some(value=>value===null))return null;
  return {count,speed,gravity,size,color:color||'gray',shape:current.shape,spawnRadius,emitterWidth,emitterHeight,shrink:!!current.shrink,lifeMs,spread};
}
function translateCamera(current,baseline,blockers,warnings) {
  if(!current?.enabled)return null;
  for(const key of ['frequency','impactLinked','impactMinScale','impactExponent'])blockerIfChanged(current?.[key],baseline?.[key],`camera.${key}`,blockers);
  const amplitude=Number(current.amplitude),frames=quantizedFrames(current.durationMs,{maximum:8});
  if(amplitude<0||amplitude>4)blockers.push({path:'camera.amplitude',value:amplitude,reason:'production camera amplitude is limited to 0..4 px'});
  const rounded=Math.round(amplitude);
  if(rounded!==amplitude)warnings.push({path:'camera.amplitude',requested:amplitude,value:rounded,reason:'production stores integer camera pixels'});
  if(Math.round(Number(current.durationMs||0)/FRAME_MS)!==frames || frames*FRAME_MS!==Number(current.durationMs))warnings.push({path:'camera.durationMs',requested:Number(current.durationMs),value:frames,reason:'production stores 40 ms native frames'});
  return {amplitude:rounded,frames};
}
function translateFlash(current,baseline,blockers,warnings) {
  if(!current?.enabled)return null;
  blockerIfChanged(current?.alpha,baseline?.alpha,'flash.alpha',blockers,'production flashes are opaque');
  blockerIfChanged(current?.targetMode,baseline?.targetMode,'flash.targetMode',blockers);
  const rawRadius=Number(current.radius),radius=requireRange(Math.round(rawRadius),0,64,'flash.radius',blockers,{integer:true});
  if(Math.round(rawRadius)!==rawRadius)warnings.push({path:'flash.radius',requested:rawRadius,value:Math.round(rawRadius),reason:'production stores integer flash pixels'});
  const frames=quantizedFrames(current.durationMs,{maximum:4});
  if(frames*FRAME_MS!==Number(current.durationMs))warnings.push({path:'flash.durationMs',requested:Number(current.durationMs),value:frames,reason:'production stores 40 ms native frames'});
  return radius===null?null:{radius,frames};
}
function translateActorFlash(current,baseline,blockers) {
  if(!current?.enabled)return null;
  blockerIfChanged(current?.alpha,baseline?.alpha,'actorFlash.alpha',blockers,'production actor flashes are opaque');
  const frames=requireRange(current.frames,0,3,'actorFlash.frames',blockers,{integer:true});
  return frames===null?null:{frames,color:current.color};
}
function translateWorldFlash(current,baseline,blockers) {
  if(!current?.enabled)return null;
  blockerIfChanged(current?.alpha,baseline?.alpha,'worldFlash.alpha',blockers,'production world flashes are opaque');
  blockerIfChanged(current?.backgroundAlphaScale,baseline?.backgroundAlphaScale,'worldFlash.backgroundAlphaScale',blockers,'production background palette flashes are opaque');
  const numeric=[['radius',0,128],['blockSize',1,16],['ringWidth',1,32],['frames',0,6],['foregroundDelayFrames',0,6],['backgroundDelayFrames',0,6]];
  const values={};for(const [key,min,max] of numeric)values[key]=requireRange(current[key],min,max,`worldFlash.${key}`,blockers,{integer:true});
  const colors=new Set(['none','white','gray','orange','red','tan','off-white','warm-white']);
  if(!colors.has(current.color))blockers.push({path:'worldFlash.color',value:current.color,reason:'color is not available in production'});
  if(!colors.has(current.backgroundColor))blockers.push({path:'worldFlash.backgroundColor',value:current.backgroundColor,reason:'color is not available in production'});
  if(Object.values(values).some(value=>value===null))return null;
  return {...values,color:current.color,layerMask:clone(current.layerMask),backgroundColor:current.backgroundColor};
}
function translateSpriteImpulse(current,baseline,blockers,warnings) {
  if(!current?.enabled)return null;
  const x=requireRange(current.x,-4,4,'spriteImpulse.x',blockers,{integer:true});
  const y=requireRange(current.y,-4,4,'spriteImpulse.y',blockers,{integer:true});
  const frames=quantizedFrames(current.durationMs,{maximum:3});
  if(frames*FRAME_MS!==Number(current.durationMs))warnings.push({path:'spriteImpulse.durationMs',requested:Number(current.durationMs),value:frames,reason:'production stores 40 ms native frames'});
  for(const key of ['squash','deformationMode','bands','deformationPixels','degradeSprite','degradationPx'])blockerIfChanged(current?.[key],baseline?.[key],`spriteImpulse.${key}`,blockers);
  return x===null||y===null?null:{x,y,frames};
}
function translateHud(current,baseline,blockers) {
  if(!current?.enabled)return null;
  blockerIfChanged(current?.alpha,baseline?.alpha,'hudImpulse.alpha',blockers,'production HUD feedback is opaque');
  const frames=requireRange(current.frames,0,4,'hudImpulse.frames',blockers,{integer:true});
  const jitter=requireRange(current.jitter,0,2,'hudImpulse.jitter',blockers,{integer:true});
  for(const key of ['mask','pattern','resourceScope','staggerFrames'])blockerIfChanged(current?.[key],baseline?.[key],`hudImpulse.${key}`,blockers);
  return frames===null||jitter===null?null:{frames,jitter,color:current.color};
}
function translatePoseEmitters(current,baseline,blockers) {
  if(!current?.enabled)return [];
  const bindings=(current.bindings||[]).filter(binding=>binding?.emitter?.enabled),baselineBindings=baseline?.bindings||[];
  if(bindings.length>4)blockers.push({path:'poseEmitter.bindings',value:bindings.length,reason:'production supports at most 4 pose emitters per event'});
  return bindings.slice(0,4).map((binding,index)=>{
    const e=binding.emitter||{},prefix=`poseEmitter.bindings[${index}]`,baselineBinding=baselineBindings.find(row=>row.id===binding.id)||baselineBindings[index]||{},baselineEmitter=baselineBinding.emitter||{};
    if(binding.holdMode!=='frames')blockers.push({path:`${prefix}.holdMode`,value:binding.holdMode,reason:'production pose emitters require fixed-frame holds'});
    for(const key of ['event','classicFrameSource','classicFrameId','rdxFrameSource','rdxPn','rdxFrameIndex','capturedPose'])blockerIfChanged(binding?.[key],baselineBinding?.[key],`${prefix}.${key}`,blockers);
    const checks=[
      ['frames',binding.frames,1,60,true],['referenceDirection',binding.referenceDirection,-1,1,true],
      ['anchorX',e.anchorX,0,31,true],['anchorY',e.anchorY,0,20,true],['refX',e.refX,0,31,true],['refY',e.refY,0,20,true],
      ['emitterWidth',e.emitterWidth,1,32,true],['emitterHeight',e.emitterHeight,1,21,true],['count',e.count,0,8,true],['speed',e.speed,0,160,false],
      ['lifeMs',e.lifeMs,10,2000,false],['spread',e.spread,0,2,false],['gravity',e.gravity,-200,300,false],['size',e.size,1,4,true],['cadenceFrames',e.cadenceFrames,1,30,true]
    ];
    const values={};for(const [key,value,min,max,integer] of checks)values[key]=requireRange(value,min,max,`${prefix}.${key}`,blockers,{integer});
    const maxRefW=32-Number(e.refX),maxRefH=21-Number(e.refY);values.refW=requireRange(e.refW,1,maxRefW,`${prefix}.refW`,blockers,{integer:true});values.refH=requireRange(e.refH,1,maxRefH,`${prefix}.refH`,blockers,{integer:true});
    if(!['smoke','spark','dust'].includes(e.tone))blockers.push({path:`${prefix}.tone`,value:e.tone,reason:'production supports smoke/spark/dust tones only'});
    if(!['loop','one-shot'].includes(e.playbackMode))blockers.push({path:`${prefix}.playbackMode`,value:e.playbackMode,reason:'production supports loop/one-shot playback only'});
    if(Object.values(values).some(value=>value===null))return null;
    return {id:binding.id,holdMode:'frames',frames:values.frames,referenceDirection:values.referenceDirection,anchorX:values.anchorX,anchorY:values.anchorY,mirrorX:!!e.mirrorX,flipH:!!e.flipH,flipV:!!e.flipV,refX:values.refX,refY:values.refY,refW:values.refW,refH:values.refH,emitterWidth:values.emitterWidth,emitterHeight:values.emitterHeight,count:values.count,speed:values.speed,lifeMs:values.lifeMs,spread:values.spread,gravity:values.gravity,size:values.size,tone:e.tone,playbackMode:e.playbackMode,cadenceFrames:values.cadenceFrames};
  }).filter(Boolean);
}

export function translateEditorRecipeToProduction(recipe,{baselineRecipe=null}={}) {
  const baseline=baselineRecipe||{};const blockers=[],warnings=[];const production={};
  if(recipe?.enabled===false)return {recipe:{},blockers,warnings};
  if(recipe?.solo)blockers.push({path:'solo',value:true,reason:'solo is an editor-only authoring state'});
  omitEmptyObject(production,'particles',translateParticles(recipe?.particles,baseline?.particles,blockers));
  omitEmptyObject(production,'camera',translateCamera(recipe?.camera,baseline?.camera,blockers,warnings));
  omitEmptyObject(production,'flash',translateFlash(recipe?.flash,baseline?.flash,blockers,warnings));
  omitEmptyObject(production,'actorFlash',translateActorFlash(recipe?.actorFlash,baseline?.actorFlash,blockers));
  omitEmptyObject(production,'worldFlash',translateWorldFlash(recipe?.worldFlash,baseline?.worldFlash,blockers));
  if(recipe?.hitStop?.enabled){const frames=requireRange(recipe.hitStop.frames,0,3,'hitStop.frames',blockers,{integer:true});if(frames!==null)production.hitStop=frames;}
  omitEmptyObject(production,'spriteImpulse',translateSpriteImpulse(recipe?.spriteImpulse,baseline?.spriteImpulse,blockers,warnings));
  omitEmptyObject(production,'hud',translateHud(recipe?.hudImpulse,baseline?.hudImpulse,blockers));
  const poseEmitters=translatePoseEmitters(recipe?.poseEmitter,baseline?.poseEmitter,blockers);if(poseEmitters.length)production.poseEmitters=poseEmitters;
  for(const key of ['foregroundDust','knockback','heroPose','attachedEmitter','audio'])blockerIfChanged(recipe?.[key],baseline?.[key],key,blockers);
  return {recipe:production,blockers,warnings};
}


const EFFECT_FIELD_MAP = Object.freeze({
  particles:Object.freeze({count:'count',speed:'speed',lifeMs:'lifeMs',spread:'spread',gravity:'gravity',size:'size',shape:'shape',spawnRadius:'spawnRadius',emitterWidth:'emitterWidth',emitterHeight:'emitterHeight',shrink:'shrink',tone:'color'}),
  camera:Object.freeze({amplitude:'amplitude',durationMs:'frames'}),
  flash:Object.freeze({durationMs:'frames',radius:'radius'}),
  actorFlash:Object.freeze({color:'color',frames:'frames'}),
  worldFlash:Object.freeze({color:'color',backgroundColor:'backgroundColor',frames:'frames',radius:'radius',blockSize:'blockSize',ringWidth:'ringWidth',layerMask:'layerMask',foregroundDelayFrames:'foregroundDelayFrames',backgroundDelayFrames:'backgroundDelayFrames'}),
  spriteImpulse:Object.freeze({x:'x',y:'y',durationMs:'frames'}),
  hudImpulse:Object.freeze({color:'color',frames:'frames',jitter:'jitter'})
});
const EFFECT_PRODUCTION_KEYS = Object.freeze({particles:'particles',camera:'camera',flash:'flash',actorFlash:'actorFlash',worldFlash:'worldFlash',spriteImpulse:'spriteImpulse',hudImpulse:'hud'});

function changedFields(current,baseline) {
  return new Set([...new Set([...Object.keys(current||{}),...Object.keys(baseline||{})])].filter(key=>!same(current?.[key],baseline?.[key])));
}
function mergeTranslatedEffect(out,effect,current,baseline,translated) {
  const changed=changedFields(current,baseline);if(!changed.size)return;
  const productionKey=EFFECT_PRODUCTION_KEYS[effect],fieldMap=EFFECT_FIELD_MAP[effect];
  if(changed.has('enabled')&&!current?.enabled){delete out[productionKey];return;}
  if(!current?.enabled)return;
  const target=clone(out[productionKey]||{});
  const fields=changed.has('enabled')?new Set(Object.keys(fieldMap)):changed;
  for(const field of fields){const mapped=fieldMap[field];if(!mapped)continue;if(translated&&Object.prototype.hasOwnProperty.call(translated,mapped))target[mapped]=clone(translated[mapped]);}
  out[productionKey]=target;
}

function translateEditorDeltaToProduction(recipe,baselineRecipe,baseProductionRecipe) {
  if(recipe?.enabled===false)return {recipe:{},blockers:recipe?.solo?[{path:'solo',value:true,reason:'solo is an editor-only authoring state'}]:[],warnings:[]};
  const full=translateEditorRecipeToProduction(recipe,{baselineRecipe}),out=clone(baseProductionRecipe||{}),masterEnabledChanged=!same(recipe?.enabled,baselineRecipe?.enabled);
  const changedEffects=new Set(Object.keys(EFFECT_PRODUCTION_KEYS).filter(key=>!same(recipe?.[key],baselineRecipe?.[key])));
  const hitStopChanged=masterEnabledChanged||!same(recipe?.hitStop,baselineRecipe?.hitStop),poseChanged=masterEnabledChanged||!same(recipe?.poseEmitter,baselineRecipe?.poseEmitter);
  const reportsForChanged=rows=>rows.filter(row=>{
    const root=String(row.path||'').split('.')[0];return masterEnabledChanged||changedEffects.has(root)||(root==='hitStop'&&hitStopChanged)||(root==='poseEmitter'&&poseChanged)||['solo','foregroundDust','knockback','heroPose','attachedEmitter','audio'].includes(root);
  });
  for(const effect of changedEffects)mergeTranslatedEffect(out,effect,recipe?.[effect],baselineRecipe?.[effect],full.recipe[EFFECT_PRODUCTION_KEYS[effect]]);
  if(masterEnabledChanged&&recipe?.enabled){
    for(const effect of Object.keys(EFFECT_PRODUCTION_KEYS))if(recipe?.[effect]?.enabled)mergeTranslatedEffect(out,effect,{...recipe[effect],enabled:true},{...baselineRecipe?.[effect],enabled:false},full.recipe[EFFECT_PRODUCTION_KEYS[effect]]);
  }
  if(hitStopChanged){if(recipe?.hitStop?.enabled)out.hitStop=full.recipe.hitStop??0;else delete out.hitStop;}
  if(poseChanged){if(recipe?.poseEmitter?.enabled&&full.recipe.poseEmitters?.length)out.poseEmitters=clone(full.recipe.poseEmitters);else delete out.poseEmitters;}
  return {recipe:out,blockers:reportsForChanged(full.blockers),warnings:reportsForChanged(full.warnings)};
}

function stableRecipeName(presetKey,actionId,recipe) {
  const text=JSON.stringify(recipe);let hash=0x811c9dc5;for(let i=0;i<text.length;i+=1){hash^=text.charCodeAt(i);hash=Math.imul(hash,0x01000193)>>>0;}
  return `${presetKey}_${actionId.replace(/[^a-z0-9]+/gi,'_').replace(/^_|_$/g,'').toLowerCase()}_${hash.toString(16).padStart(8,'0')}`;
}
function existingRecipeName(manifest,recipe) { return Object.entries(manifest.recipes).find(([,value])=>same(value,recipe))?.[0] || null; }

function diffLines(beforeText,afterText) {
  const a=beforeText.replace(/\n$/,'').split('\n'),b=afterText.replace(/\n$/,'').split('\n');
  const n=a.length,m=b.length,dp=Array.from({length:n+1},()=>new Uint16Array(m+1));
  for(let i=n-1;i>=0;i-=1)for(let j=m-1;j>=0;j-=1)dp[i][j]=a[i]===b[j]?dp[i+1][j+1]+1:Math.max(dp[i+1][j],dp[i][j+1]);
  const ops=[];let i=0,j=0;while(i<n||j<m){if(i<n&&j<m&&a[i]===b[j]){ops.push({type:' ',line:a[i],a:i+1,b:j+1});i++;j++;}else if(j<m&&(i===n||dp[i][j+1]>dp[i+1][j])){ops.push({type:'+',line:b[j],a:i+1,b:j+1});j++;}else{ops.push({type:'-',line:a[i],a:i+1,b:j+1});i++;}}
  const changed=ops.map((op,index)=>op.type===' '?-1:index).filter(index=>index>=0);if(!changed.length)return '';
  const groups=[];for(const idx of changed){const start=Math.max(0,idx-3),end=Math.min(ops.length-1,idx+3);const last=groups.at(-1);if(last&&start<=last.end+1)last.end=Math.max(last.end,end);else groups.push({start,end});}
  const lines=[`--- a/${PRODUCTION_TARGET}`,`+++ b/${PRODUCTION_TARGET}`];
  for(const group of groups){const slice=ops.slice(group.start,group.end+1);const first=slice[0];const aStart=first.a,bStart=first.b;const aCount=slice.filter(op=>op.type!=='+').length,bCount=slice.filter(op=>op.type!=='-').length;lines.push(`@@ -${aStart},${aCount} +${bStart},${bCount} @@`);for(const op of slice)lines.push(`${op.type}${op.line}`);}
  return `${lines.join('\n')}\n`;
}

export function buildProductionPresetPatch({profile,actionIds,presetKey}) {
  const preset=presetByKey(presetKey);if(!preset)throw new Error(`Unknown production Game Juice preset '${presetKey}'`);
  const ids=[...new Set((actionIds||[]).map(String))];if(!ids.length)throw new Error('Production export needs at least one action id');
  const baseline=editorBaselineForPreset(preset),before=clone(GAME_JUICE_PRODUCTION_PRESETS),after=clone(before),operations=[],blockers=[],warnings=[],actions=[];
  const targetPresetIndex=after.presets.findIndex(row=>row.key===preset.key),targetPreset=after.presets[targetPresetIndex];
  const pointerToken=value=>String(value).replaceAll('~','~0').replaceAll('/','~1');
  for(const actionId of ids){if(!profile?.actions?.[actionId])throw new Error(`Unknown Game Juice action '${actionId}'`);
    const hadActionMapping=Object.prototype.hasOwnProperty.call(targetPreset.actions||{},actionId);
    const oldRecipeName=targetPreset.actions?.[actionId]||'raw',oldRecipe=before.recipes[oldRecipeName]||{},translated=translateEditorDeltaToProduction(profile.actions[actionId],baseline.actions[actionId],oldRecipe);
    blockers.push(...translated.blockers.map(row=>({actionId,...row})));warnings.push(...translated.warnings.map(row=>({actionId,...row})));
    let recipeName=existingRecipeName(after,translated.recipe);
    if(!recipeName){recipeName=stableRecipeName(preset.key,actionId,translated.recipe);after.recipes[recipeName]=translated.recipe;operations.push({op:'add',path:`/recipes/${pointerToken(recipeName)}`,value:clone(translated.recipe)});}
    if(recipeName!==oldRecipeName){targetPreset.actions ||= {};targetPreset.actions[actionId]=recipeName;operations.push({op:hadActionMapping?'replace':'add',path:`/presets/${targetPresetIndex}/actions/${pointerToken(actionId)}`,previous:hadActionMapping?oldRecipeName:null,value:recipeName});}
    actions.push({actionId,recipeRevision:actionRecipeRevision(profile.actions[actionId]),fromRecipe:oldRecipeName,toRecipe:recipeName,productionChanged:!same(oldRecipe,translated.recipe),recipe:clone(translated.recipe)});
  }
  const beforeText=`${JSON.stringify(before,null,2)}\n`,afterText=`${JSON.stringify(after,null,2)}\n`;
  return {target:PRODUCTION_TARGET,preset:{key:preset.key,label:preset.label,libretroValue:preset.libretroValue,editorStyleId:preset.editorStyleId},actions,blockers,warnings,operations,unifiedDiff:blockers.length?'':diffLines(beforeText,afterText),reviewable:!blockers.length,verification:['node tools/build/generate_game_juice_presets.mjs','node tools/build/generate_game_juice_presets.mjs --check','npm run sync:check:core']};
}
