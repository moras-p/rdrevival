import { requireArt } from './document.js';

export const PIXEL_ART_BENCHMARK_TASKS = Object.freeze([
  { id: 'novel-prop', title: 'Novel gameplay prop', inputs: ['text', 'production-family', 'moodboard'], acceptance: ['native-scale readability', 'RDR family fit', 'no inspiration exact-copy'] },
  { id: 'character-pose', title: 'New character action pose', inputs: ['text', 'character-source', 'pose-reference'], acceptance: ['identity', 'action silhouette', 'anchor/contact stability'] },
  { id: 'short-effect', title: 'Economical effect animation', inputs: ['text', 'production-effect-family', 'moodboard'], acceptance: ['timing readability', 'bounded frame count', 'frame-to-frame stability'] },
  { id: 'tile-variant', title: 'Connected environment tile', inputs: ['text', 'neighboring-production-tiles'], acceptance: ['edge connectivity', 'palette/material grammar', 'repeatability'] },
  { id: 'sprite-repair', title: 'Constrained production sprite repair', inputs: ['text', 'editable-production-source'], acceptance: ['requested correction only', 'protected-region integrity', 'production-context fit'] },
  { id: 'feature-shift', title: 'Semantic feature shift', inputs: ['text', 'indexed-sprite'], acceptance: ['single feature moved', 'outside region unchanged'] },
  { id: 'multi-frame-cleanup', title: 'Multi-frame palette cleanup', inputs: ['text', 'animation'], acceptance: ['target-set consistency', 'palette contract'] },
  { id: 'animation-construction', title: 'Animation construction', inputs: ['text', 'source-pose'], acceptance: ['frame lifecycle', 'clip timing', 'anchor stability'] },
  { id: 'palette-shading', title: 'Palette ramp shading', inputs: ['text', 'style-profile'], acceptance: ['declared ramp only', 'fixed palette contract'] },
  { id: 'candidate-exploration', title: 'Candidate exploration', inputs: ['text', 'candidate-pair'], acceptance: ['mechanical comparison', 'selective region transfer'] },
  { id: 'production-repair', title: 'Production plugin repair', inputs: ['text', 'asset-plugin'], acceptance: ['fixed palette/source guards', 'native preview', 'production export'] },
]);

export function benchmarkDefinition(id) {
  const task = PIXEL_ART_BENCHMARK_TASKS.find(row => row.id === id);
  requireArt(task, 'BENCHMARK', `Unknown benchmark task: ${id ?? '(missing)'}`);
  return task;
}

export function benchmarkReport(doc, analysis, { taskId, review = null } = {}) {
  const task = benchmarkDefinition(taskId);
  return {
    schema: 'rdr.pixel-art-benchmark-result.v1',
    task,
    document: { id: doc.id, revision: doc.revision, width: doc.width, height: doc.height, frames: doc.frames.length },
    sessionMetrics: analysis.session ?? null,
    diagnostics: { errors: analysis.errors ?? [], warnings: analysis.warnings ?? [], frameMetrics: analysis.metrics?.frames ?? [] },
    provenance: analysis.provenance ?? null,
    humanReview: review && typeof review === 'object' ? review : null,
    scoring: 'Human visual review at native scale and production context is authoritative; automated diagnostics are advisory.',
  };
}
