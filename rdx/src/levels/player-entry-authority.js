export function playerEntryPhaseZeroUsable(entry) {
  return !!entry && (String(entry.sourceAgreement || '') === 'exact' || entry.phaseZeroAuthority === true);
}

export function resolvedPlayerEntryContact(entry) {
  if (!playerEntryPhaseZeroUsable(entry)) return null;
  const point = entry?.worldContact;
  if (!Array.isArray(point) || point.length < 2) return null;
  const x = Number(point[0]), y = Number(point[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return Object.freeze([x, y]);
}
