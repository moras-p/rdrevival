function sourceKeyForMark(mark) { return `mark:${Number(mark)}`; }

export function canonicalActorPatch(row) {
  if (!row || !Number.isFinite(Number(row.mark))) return null;
  const behavior = String(row.behavior || 'follow-classic-always-visible');
  return Object.freeze({
    action:'actor-pn',
    sourceKey:sourceKeyForMark(row.mark),
    mark:Number(row.mark),
    pn:Number(row.pn),
    actorId:Number(row.actorId || 0),
    origin:[Number(row.rdxX),Number(row.rdxY)],
    behavior,
    mirrorX:!!row.mirrorX,
    mirrorY:!!row.mirrorY,
    front:!!row.front,
    quarterTurns:Number(row.quarterTurns || 0) & 3,
    visible:behavior !== 'suppress',
    authority:'runtime-presentation-override'
  });
}

export function productionActorPatchMap(productionOverrides, reviewedMapVisualPatches, submap, mapId) {
  const result = new Map();
  const canonical = productionOverrides?.tables?.markActorOverrides || [];
  for (const row of canonical) {
    if (Number(row.submap) !== Number(submap) || Number(row.mapId) !== Number(mapId)) continue;
    const patch = canonicalActorPatch(row);
    if (patch) result.set(patch.sourceKey, patch);
  }
  /* Explicit reviewed visual patches carry richer role/contact metadata and
   * therefore win when they target the same canonical source. */
  const reviewed = Array.isArray(reviewedMapVisualPatches?.patches)
    ? reviewedMapVisualPatches.patches
    : (Array.isArray(reviewedMapVisualPatches) ? reviewedMapVisualPatches : []);
  for (const row of reviewed) {
    if (row.action !== 'actor-pn' || Number(row.submap) !== Number(submap) || Number(row.mapId) !== Number(mapId)) continue;
    result.set(String(row.sourceKey || sourceKeyForMark(row.mark)), row);
  }
  return result;
}

function point(value) {
  return Array.isArray(value) && value.length >= 2 ? [Number(value[0]),Number(value[1])] : null;
}

function emitterAuthority(productionOverrides, submap, mapId) {
  const tables = productionOverrides?.tables || {};
  const muzzles = new Map((tables.emitterMuzzles || []).map(row => [
    `${Number(row.actorId)}:${String(row.direction || '').toLowerCase()}`, row
  ]));
  const links = new Map();
  for (const row of tables.projectileEmitterLinks || []) {
    if (Number(row.submap) !== Number(submap) || Number(row.mapId) !== Number(mapId)) continue;
    links.set(sourceKeyForMark(row.mark), row);
  }
  return { muzzles, links };
}

function effectiveEmitterContact(origin, actorId, direction, muzzles) {
  const muzzle = muzzles.get(`${Number(actorId)}:${String(direction || '').toLowerCase()}`);
  const base = point(origin);
  if (!muzzle || !base) return null;
  return {
    muzzle,
    contact:[base[0] + Number(muzzle.muzzleX), base[1] + Number(muzzle.muzzleY)]
  };
}

function rebaseProjectileSequence(sequence, contact, direction) {
  if (!Array.isArray(sequence)) return sequence;
  const sign = String(direction).toLowerCase() === 'left' ? -1 : 1;
  let ordinal = 0;
  return sequence.map(raw => {
    const sample = { ...raw, direction:String(direction).toLowerCase(), emitterAligned:true };
    delete sample.draw; delete sample.anchor;
    if (sample.visible === false) sample.origin = [...contact];
    else {
      const c2 = Number(sample.c2 || 0);
      const step = c2 > 0 ? c2 : ordinal + 1;
      sample.origin = [contact[0] + sign * 8 * step, contact[1]];
      ordinal += 1;
    }
    return sample;
  });
}

/** Rebase immutable production-capture emitter records onto current compact authority.
 *
 * The large trace remains observational evidence. Reviewed emitter offsets and
 * source links are small authored tables, so Preview/Level Editor must project
 * the captured cadence/trajectory from those current contacts instead of
 * requiring a trace refresh for a one-pixel/two-pixel muzzle correction.
 */
export function effectiveProductionRoom(room, productionOverrides) {
  if (!room) return room;
  const { muzzles, links } = emitterAuthority(productionOverrides, room.submap, room.mapId);
  if (!muzzles.size) return room;

  let changed = false;
  const actors = (room.actors || []).map(record => {
    const actorId = Number(record.actorId);
    const direction = String(record.emitter?.direction || '').toLowerCase() ||
      (muzzles.has(`${actorId}:left`) ? 'left' : (muzzles.has(`${actorId}:right`) ? 'right' : ''));
    const resolved = effectiveEmitterContact(record.origin, actorId, direction, muzzles);
    if (!resolved) return record;
    const existing = point(record.emitter?.contact);
    if (existing && existing[0] === resolved.contact[0] && existing[1] === resolved.contact[1]) return record;
    changed = true;
    return {
      ...record,
      emitter:{ ...(record.emitter || {}), contact:resolved.contact, direction,
        actorId, authority:'runtime-presentation-override+reviewed-emitter-muzzle' }
    };
  });

  const children = (room.children || []).map(record => {
    if (record.role !== 'projectile') return record;
    const sourceKey = String(record.sourceKey || '');
    const link = links.get(sourceKey);
    if (!link) return record;
    const direction = String(link.direction || '').toLowerCase();
    const resolved = effectiveEmitterContact([link.rdxX, link.rdxY], link.actorId, direction, muzzles);
    if (!resolved) return record;
    const old = point(record.emitterContact);
    if (old && old[0] === resolved.contact[0] && old[1] === resolved.contact[1] &&
        Number(record.emitterMuzzleOffset?.[0]) === Number(resolved.muzzle.muzzleX) &&
        Number(record.emitterMuzzleOffset?.[1]) === Number(resolved.muzzle.muzzleY)) return record;
    changed = true;
    const cadencePeriod = Number(record.trackPeriod || record.auditPeriod || record.emitterCadence?.capturedTrackPeriod || 0);
    return {
      ...record,
      origin:[...resolved.contact], direction,
      emitterAligned:true, emitterContact:[...resolved.contact], emitterDirection:direction,
      emitterActorId:Number(link.actorId), emitterSpawnIndex:Number(link.spawnIndex),
      emitterOrigin:[Number(link.rdxX),Number(link.rdxY)],
      emitterMuzzleOffset:[Number(resolved.muzzle.muzzleX),Number(resolved.muzzle.muzzleY)],
      emitterCadence:{ ...(record.emitterCadence || {}), capturedTrackPeriod:cadencePeriod,
        speedPxPerUpdate:8, authority:'native-xrick-projectile-state' },
      emitterCorrections:[
        'explicit-emitter-link','emitter-mouth-offset',
        'presentation-only-projectile-projection','native-displacement-preserved'
      ],
      nativeDisplacementPreserved:true,
      samples:rebaseProjectileSequence(record.samples, resolved.contact, direction),
      auditSamples:rebaseProjectileSequence(record.auditSamples, resolved.contact, direction),
      presentationOverrideAuthority:'runtime-presentation-override+reviewed-emitter-muzzle'
    };
  });
  return changed ? { ...room, actors, children } : room;
}

function shiftedSample(sample, dx, dy, pn) {
  const out = { ...sample };
  const origin = point(sample?.origin), draw = point(sample?.draw);
  if (origin) out.origin = [origin[0] + dx, origin[1] + dy];
  if (draw) out.draw = [draw[0] + dx, draw[1] + dy];
  if (Number.isFinite(pn)) out.pn = pn;
  return out;
}

/** Resolve one captured production actor against current compact authority.
 *
 * The capture's record-level origin may pre-date a reviewed correction while
 * its motion samples still contain the useful controller trajectory.  Rebase
 * the trajectory onto the authoritative reviewed origin instead of requiring
 * a multi-megabyte trace regeneration.
 */
export function effectiveProductionRecord(record, patch) {
  if (!record || !patch) return record;
  if (patch.visible === false || patch.behavior === 'suppress') return null;
  const target = point(patch.origin);
  if (!target) return record;
  const audit = Array.isArray(record.auditSamples) ? record.auditSamples : [];
  const samples = Array.isArray(record.samples) ? record.samples : [];
  const reference = [...audit, ...samples].find(sample => sample?.visible !== false && point(sample?.origin));
  const sourceBase = point(reference?.origin) || point(record.origin) || target;
  const dx = target[0] - sourceBase[0], dy = target[1] - sourceBase[1];
  const pn = Number.isFinite(Number(patch.pn)) ? Number(patch.pn) : Number(record.pn);
  const out = { ...record, origin:target, pn };
  const anchor = point(record.anchor);
  if (anchor) out.draw = [target[0] - anchor[0], target[1] - anchor[1]];
  else if (point(record.draw)) out.draw = [record.draw[0] + dx, record.draw[1] + dy];
  if (samples.length) out.samples = samples.map(sample => shiftedSample(sample, dx, dy, pn));
  if (audit.length) out.auditSamples = audit.map(sample => shiftedSample(sample, dx, dy, pn));
  out.presentationOverrideAuthority = String(patch.authority || 'runtime-presentation-override');
  return out;
}
