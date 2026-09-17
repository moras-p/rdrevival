import { clone, requireArt } from './document.js';

export const PIXEL_ART_RECIPES = Object.freeze([
  { id: 'constrained-repair', required: ['frameId','layerId','selector','ops'] },
  { id: 'create-pose-from-frame', required: ['sourceFrameId','id'] },
  { id: 'shift-feature', required: ['frameId','layerId','selector','dx','dy'] },
  { id: 'shade-material', required: ['frameId','layerId','selector','step'] },
  { id: 'outline-selection', required: ['frameId','layerId','selector','color'] },
  { id: 'create-effect-variant', required: ['sourceFrameId','id'] },
  { id: 'candidate-region', required: ['sourceCandidate','selector'] },
]);

export function compileRecipe(doc, recipe) {
  requireArt(recipe && typeof recipe.id === 'string', 'RECIPE', 'Recipe id is required');
  const def = PIXEL_ART_RECIPES.find(row => row.id === recipe.id);
  requireArt(def, 'RECIPE', `Unknown recipe: ${recipe.id}`);
  for (const key of def.required) requireArt(recipe[key] !== undefined, 'RECIPE', `${recipe.id} requires ${key}`);
  switch (recipe.id) {
    case 'constrained-repair':
      requireArt(Array.isArray(recipe.ops) && recipe.ops.length > 0, 'RECIPE', 'constrained-repair requires ops');
      return { ops: clone(recipe.ops), assertions: { ...(recipe.assertions ?? {}), unchanged: [...(recipe.assertions?.unchanged ?? []), ...(recipe.preserve ?? [])] } };
    case 'create-pose-from-frame':
      return { ops: [{ type: 'duplicate_frames', frameIds: [recipe.sourceFrameId], ids: [recipe.id], ...(recipe.beforeFrameId ? { beforeFrameId: recipe.beforeFrameId } : {}), ...(recipe.afterFrameId ? { afterFrameId: recipe.afterFrameId } : {}), addToClips: recipe.addToClips ?? true }] };
    case 'shift-feature':
      return { ops: [{ type: 'transform_selection', action: recipe.copy ? 'copy-translate' : 'translate', frameId: recipe.frameId, layerId: recipe.layerId, selector: clone(recipe.selector), dx: recipe.dx, dy: recipe.dy, collision: recipe.collision ?? 'reject', clipping: recipe.clipping ?? 'reject', anchorPolicy: recipe.anchorPolicy ?? 'preserve' }] };
    case 'shade-material':
      return { ops: [{ type: 'shade_step', frameId: recipe.frameId, layerId: recipe.layerId, selector: clone(recipe.selector), step: recipe.step, ...(recipe.ramp ? { ramp: recipe.ramp } : {}), fallback: recipe.fallback ?? 'reject', ...(recipe.targets ? { targets: clone(recipe.targets) } : {}) }] };
    case 'outline-selection':
      return { ops: [{ type: 'transform_selection', action: 'contour', frameId: recipe.frameId, layerId: recipe.layerId, selector: clone(recipe.selector), contour: recipe.contour ?? 'outer', color: recipe.color, collision: recipe.collision ?? 'overwrite-transparent-only' }] };
    case 'create-effect-variant':
      return { ops: [{ type: 'duplicate_frames', frameIds: [recipe.sourceFrameId], ids: [recipe.id], afterFrameId: recipe.afterFrameId ?? recipe.sourceFrameId, addToClips: recipe.addToClips ?? true }] };
    case 'candidate-region':
      return { candidateTransfer: clone(recipe) };
    default:
      requireArt(false, 'RECIPE', `Unknown recipe: ${recipe.id}`);
  }
}
