export const DIRECTION_FIELDS = ['target', 'intent', 'preserve', 'referenceNotes', 'acceptance'];

export const AGENT_WORKFLOW = [
  'Inspect source provenance, palette policy, frames, anchors and timing with detailed state.',
  'Set art_direction: target, intent, preserve, referenceNotes, acceptance. Optional generated mood boards guide original clusters; do not trace or quantize them by default.',
  'Checkpoint, then protect unchanged regions and scope edits. Every history operation returns a new revision.',
  'Use inspect with exact semantic selectors to identify the target at the current revision; keep read_region for exact span reads only.',
  'Dry-run nontrivial edits with simulate_ops and preservation assertions, then submit the same coherent transaction with apply_ops. Prefer selector transforms, target sets and named ramp operations over literal pixel spans.',
  'Use transparent recipes for common repairs/pose variants and candidate compare + guarded region transfer for alternatives; inspect the resolved ordinary operations.',
  'Maintain bounded handoff goal/baseline/accepted regions/unresolved notes so a human can intervene through the same command store and the next agent can resume from structured state.',
  'Prepare review with a checkpoint and capture #art-observation using host image tools. Judge native-scale readability and animation separately from validation.',
  'Analyze the checkpoint delta, iterate or restore. Save/export with documentId, expectedRevision and a fresh requestId.',
  'Production-export only for a supported adapter. Check the source hash before repository application, run the owning generator/sync checks and inspect native output.',
];
