export function assertSoundLabManifest(manifest) {
  if (!manifest || manifest.schema !== 'soundlab.build-manifest.v1') throw new Error('Expected soundlab.build-manifest.v1');
  if (!manifest.project || !Array.isArray(manifest.bindings) || !Array.isArray(manifest.outputs)) throw new Error('SoundLab manifest is incomplete');
  return manifest;
}

export function bindingFor(manifest, id) {
  const binding = manifest.bindings.find(row => row.id === id) || manifest.bindings[0];
  if (!binding) throw new Error('SoundLab manifest has no bindings');
  return binding;
}

export function outputsFor(manifest, bindingId, profile = null) {
  return manifest.outputs.filter(row => row.binding === bindingId && (!profile || row.profile === profile)).sort((a,b) => a.variant - b.variant);
}

export function resourceOptions(manifest, kind) {
  return Object.values(manifest.previewModel?.resources?.[kind] || {}).sort((a,b) => String(a.id).localeCompare(String(b.id)));
}
export function materialOptions(manifest) { return resourceOptions(manifest,'materials'); }
export function sourceOptions(manifest) { return [...(manifest.previewModel?.sources || [])].sort((a,b)=>String(a.id).localeCompare(String(b.id))); }

export function deepMerge(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return base;
  const result={...(base||{})};
  for(const [key,value] of Object.entries(override)){
    if(value&&typeof value==='object'&&!Array.isArray(value)&&result[key]&&typeof result[key]==='object'&&!Array.isArray(result[key]))result[key]=deepMerge(result[key],value);
    else if(value===null)delete result[key];
    else result[key]=value;
  }
  return result;
}

export function resolvePreviewResources(manifest, binding, materialId = binding.surface, selections = {}) {
  const resources = manifest.previewModel?.resources || {};
  const material = deepMerge(resources.materials?.[materialId], binding.overrides?.material);
  const objectId=selections.object || binding.object, recipeId=selections.recipe || binding.recipe, styleId=selections.style || binding.style;
  const object = deepMerge(resources.objects?.[objectId], binding.overrides?.object);
  const recipe = deepMerge(resources.recipes?.[recipeId], binding.overrides?.recipe);
  const style = deepMerge(resources.styles?.[styleId], binding.overrides?.style);
  if (!material || !object || !recipe || !style) throw new Error(`Missing preview resources for ${binding.id}`);
  return { material, object, recipe, style };
}

export function telemetryTrace(project, events, metadata = {}) {
  return {
    schema:'soundlab.telemetry.v1',
    project,
    capturedFrom:'native-runtime',
    ...metadata,
    events:events.map(event => ({
      event:event.event,
      submap:event.submap,
      actor:{ slot:event.actor?.slot ?? 0xff, mark:event.actor?.mark ?? 0xffff, ...(event.actor?.family ? {family:event.actor.family} : {}) },
      tick:event.tick,
      world:[...(event.world || [0,0])],
      frameDelta:[...(event.frameDelta || [0,0])],
      normal:[...(event.normal || [0,0])],
      direction:event.direction ?? 0
    }))
  };
}
