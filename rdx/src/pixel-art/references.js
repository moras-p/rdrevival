import { clone, requireArt } from './document.js';

export const REFERENCE_ROLES = Object.freeze([
  'production-source',
  'editable-source',
  'subject',
  'style',
  'pose',
  'layout',
  'environment',
  'state',
  'moodboard',
  /* Retained only so older portable projects open deterministically. New
   * references are never created with this ambiguous role. */
  'reference-only',
]);

export const REFERENCE_POLICIES = Object.freeze([
  'inspect-only',
  'sample-summary',
  'exact-copy-allowed',
]);

/** Roles that may be assigned by the generic "attach reference" workflow.
 * Copy-authoritative roles are intentionally omitted: those are granted only
 * by an owning editable import or a trusted, locally registered asset plugin.
 */
export const ATTACHABLE_REFERENCE_ROLES = Object.freeze([
  'subject',
  'style',
  'pose',
  'layout',
  'environment',
  'state',
  'moodboard',
]);

const DEFAULT_POLICY = Object.freeze({
  'production-source': 'exact-copy-allowed',
  'editable-source': 'exact-copy-allowed',
  subject: 'sample-summary',
  style: 'inspect-only',
  pose: 'inspect-only',
  layout: 'inspect-only',
  environment: 'inspect-only',
  state: 'inspect-only',
  moodboard: 'inspect-only',
  'reference-only': 'inspect-only',
});

export function defaultReferencePolicy(role) {
  return DEFAULT_POLICY[role] ?? 'inspect-only';
}

export function normalizeAttachedReferenceMetadata(reference, { role, notes } = {}) {
  const safeRole = role ?? reference?.role ?? 'style';
  requireArt(
    ATTACHABLE_REFERENCE_ROLES.includes(safeRole),
    'REFERENCE_POLICY',
    'Attached references are inspiration-only; exact-copy authority comes from an editable import or registered asset plugin',
  );
  return normalizeReferenceMetadata(reference, {
    role: safeRole,
    policy: defaultReferencePolicy(safeRole),
    notes,
  });
}

export function normalizeReferenceMetadata(reference, { role, policy, notes } = {}) {
  const next = clone(reference);
  next.role = role ?? next.role ?? 'style';
  next.policy = policy ?? next.policy ?? defaultReferencePolicy(next.role);
  if (notes !== undefined) next.notes = String(notes);
  else if (next.notes === undefined) next.notes = '';
  return next;
}

export function validateReferenceMetadata(reference) {
  requireArt(REFERENCE_ROLES.includes(reference.role), 'REFERENCE', `Unknown reference role: ${reference.role ?? '(missing)'}`);
  requireArt(REFERENCE_POLICIES.includes(reference.policy), 'REFERENCE', `Unknown reference policy: ${reference.policy ?? '(missing)'}`);
  requireArt(typeof reference.notes === 'string' && reference.notes.length <= 4000, 'REFERENCE', 'Reference notes must be bounded text');
  requireArt(
    reference.policy !== 'exact-copy-allowed' || ['production-source', 'editable-source'].includes(reference.role),
    'REFERENCE_POLICY',
    'Exact-copy permission is reserved for an explicit production/editable source reference',
  );
  return reference;
}

export function exactCopyAllowed(reference) {
  return reference?.policy === 'exact-copy-allowed' && ['production-source', 'editable-source'].includes(reference?.role);
}

export function referenceSummaryAllowed(reference) {
  return reference?.policy === 'sample-summary' || exactCopyAllowed(reference);
}

export function publicReference(reference) {
  const { rgba, ...metadata } = reference;
  return metadata;
}
