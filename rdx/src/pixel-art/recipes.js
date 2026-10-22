import { clone, requireArt } from './document.js';

export const PIXEL_ART_RECIPES = Object.freeze([
  { id: 'constrained-repair', required: ['frameId','layerId','selector','ops'] },
  { id: 'create-pose-from-frame', required: ['sourceFrameId','id'] },
  { id: 'shift-feature', required: ['frameId','layerId','selector','dx','dy'] },
  { id: 'shade-material', required: ['frameId','layerId','selector','step'] },
  { id: 'outline-selection', required: ['frameId','layerId','selector','color'] },
  { id: 'create-effect-variant', required: ['sourceFrameId','id'] },
  { id: 'candidate-region', required: ['sourceCandidate','selector'] },
  { id: 'author-actor-animation-from-references-v1', required: ['target','poseReferenceId','identityReferenceId','expectedSourceHash','ops'] },
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
    case 'author-actor-animation-from-references-v1': {
      requireArt(Array.isArray(recipe.ops) && recipe.ops.length > 0, 'RECIPE', 'Animation authoring requires explicit guarded editing operations');
      requireArt(doc.frames.length === 2 && doc.width === 32 && doc.height === 21 &&
        doc.frames[0].anchor.every((v, n) => v === doc.frames[1].anchor[n]),
        'RECIPE', 'Animation authoring requires two consistently registered 32×21 cels');
      const pose = doc.references.find(row => row.id === recipe.poseReferenceId);
      const identity = doc.references.find(row => row.id === recipe.identityReferenceId);
      requireArt(pose?.role === 'pose' && identity?.role === 'subject' && pose.sequence && identity.sequence,
        'RECIPE', 'Animation authoring needs two named immutable pose and identity sequences');
      requireArt(identity.provenance?.sourceKind === 'rom-pn' && identity.provenance?.sourceHash === recipe.expectedSourceHash,
        'RECIPE', 'Identity ROM provenance must match the expected source hash');
      const target = recipe.target;
      requireArt(target && target.room === 'SM27' && target.submap === 39 && target.mapId === 47 &&
        target.mark === 433 && JSON.stringify(target.pnFamily) === '[59,60]' &&
        identity.provenance.mapId === target.mapId && target.pnFamily.includes(identity.provenance.pn),
        'RECIPE', 'M433 authoring target must preserve its native actor and PN ownership');
      return {
        ops: clone(recipe.ops),
        assertions: { paletteUnchanged: true, anchorsUnchanged: true, clipsUnchanged: true, ...(recipe.assertions ?? {}) },
        workflow: {
          schema: 'rdr.pixel_art.agent_animation_workflow.v1',
          binding: clone(target), referenceIds: [pose.id, identity.id], frameIds: doc.frames.map(f => f.id),
          exportOptions: { assetId: 'm433-mechanic-climb', owner: clone(target),
            poseReferenceId: pose.id, identityReferenceId: identity.id,
            expectedSourceHash: recipe.expectedSourceHash },
          nativePreviewOptions: { submap: target.submap, mark: target.mark, ladderReview: true, maxFrames: 240 },
          gates: ['observe-1x-and-8x', 'review-frame-a', 'review-frame-b', 'verify-native-phase-a-and-b',
            'stage-with-expected-head-and-rom', 'recompile-and-verify-installed-native', 'produce-verified-git-am'],
          productionVerified: false,
        },
      };
    }
    default:
      requireArt(false, 'RECIPE', `Unknown recipe: ${recipe.id}`);
  }
}
