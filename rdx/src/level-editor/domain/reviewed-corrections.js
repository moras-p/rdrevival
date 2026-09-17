import { validatePresentationDepthOverrides } from '../../levels/presentation-depth.js';
export const REVIEWED_CORRECTIONS_SCHEMA = 'rdr.reviewed_room_corrections.v1';

export const REVIEWED_CORRECTION_TYPES = Object.freeze({
  'entity-type': { target: 'entity', semantic: 'gameplay' },
  'entity-source': { target: 'entity', semantic: 'gameplay' },
  'entity-position': { target: 'entity', semantic: 'gameplay' },
  'entity-patrol': { target: 'entity', semantic: 'gameplay' },
  'trigger-bounds': { target: 'entity', semantic: 'gameplay' },
  'gameplay-bounds': { target: 'entity', semantic: 'gameplay' },
  'visual-bounds': { target: 'entity', semantic: 'visual' },
  'visual-anchor': { target: 'entity', semantic: 'visual' },
  'presentation': { target: 'entity', semantic: 'visual' },
  'projectile-shooter-presentation': { target: 'entity', semantic: 'visual' },
  'projectile-emitter': { target: 'entity', semantic: 'gameplay' },
  'projectile-lane': { target: 'entity', semantic: 'gameplay' },
  'entity-suppression': { target: 'entity', semantic: 'gameplay' },
  'moving-platform-placement': { target: 'entity', semantic: 'gameplay' },
  'moving-platform-controller': { target: 'entity', semantic: 'gameplay' },
  'alignment-exception': { target: 'alignment', semantic: 'correspondence' },
  'correspondence-exception': { target: 'alignment', semantic: 'correspondence' },
  'terrain-cell': { target: 'room', semantic: 'gameplay' },
  'visual-plane': { target: 'room', semantic: 'visual' },
  'presentation-depth': { target: 'room', semantic: 'visual' }
});

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const finite = value => Number.isFinite(Number(value));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function presentationDepthTargetId(target) {
  const match = String(target || '').match(/:presentation-depth:(.+)$/);
  return match ? match[1] : '';
}

function correctionError(message, { roomId, correction, actual = undefined } = {}) {
  const details = [
    roomId ? `room=${roomId}` : null,
    correction?.id ? `correction=${correction.id}` : null,
    correction?.type ? `type=${correction.type}` : null,
    correction?.target ? `target=${correction.target}` : null,
    correction && Object.hasOwn(correction, 'expected') ? `expected=${JSON.stringify(correction.expected)}` : null,
    actual !== undefined ? `actual=${JSON.stringify(actual)}` : null
  ].filter(Boolean).join(' ');
  const error = new Error(`${message}${details ? ` (${details})` : ''}`);
  error.name = 'ReviewedCorrectionValidationError';
  error.roomId = roomId || null;
  error.correctionId = correction?.id || null;
  error.correctionType = correction?.type || null;
  error.target = correction?.target || null;
  error.expected = correction?.expected;
  error.actual = actual;
  return error;
}

function requirePoint(value, label, context) {
  if (!Array.isArray(value) || value.length !== 2 || value.some(item => !finite(item))) throw correctionError(`${label} must be [x,y]`, context);
  return value.map(Number);
}

function requireRect(value, label, context) {
  if (!Array.isArray(value) || value.length !== 4 || value.some(item => !finite(item))) throw correctionError(`${label} must be [x,y,w,h]`, context);
  return value.map(Number);
}

function aliases(object) {
  return [object?.semanticId, object?.sources?.classic?.ref, object?.sources?.rdx?.ref, object?.sourceRecordId]
    .filter(value => value != null).map(String);
}

export function findReviewedCorrectionTarget(room, target) {
  const key = String(target || '');
  const objects = room?.layers?.semanticCorpus?.objects || [];
  let object = objects.find(row => aliases(row).includes(key)) || null;
  if (!object) {
    const mark = key.match(/(?:mark[-:])([0-9]+)/i)?.[1];
    if (mark != null) object = objects.find(row => Number(row?.sources?.classic?.mark) === Number(mark)) || null;
  }
  if (object) return { kind: 'entity', value: object };
  const regionKey = key.replace(/^alignment:/, '');
  const region = (room?.layers?.alignment?.regions || []).find(row => String(row?.id || '') === regionKey) || null;
  if (region) return { kind: 'alignment', value: region };
  if (/^(?:room|terrain):/i.test(key) || key === String(room?.id || '')) return { kind: 'room', value: room };
  return null;
}

function patrolValue(object) {
  return clone(object?.controller?.reviewedPatrol || object?.sourceEvidence?.classic?.controller?.patrol || null);
}
function patrolAnchorValue(object) {
  const patrol = patrolValue(object);
  if (Array.isArray(patrol?.start) && patrol.start.length >= 2) return patrol.start.slice(0,2).map(Number);
  const classic=object?.sourceEvidence?.classic || null;
  const x=Number(classic?.x), y=Number(classic?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? [x,y] : null;
}

function translatePoint(value, dx, dy) {
  return Array.isArray(value) && value.length >= 2 ? [Number(value[0])+Number(dx),Number(value[1])+Number(dy)] : value;
}

function entityTypeValue(object) {
  return { class: String(object?.class || ''), controllerEntity: object?.controller?.entity == null ? null : Number(object.controller.entity) };
}

function presentationValue(object) {
  return clone(object?.presentation || null);
}

function currentValue(room, correction, target) {
  const object = target?.kind === 'entity' ? target.value : null;
  switch (correction.type) {
    case 'entity-type': return entityTypeValue(object);
    case 'entity-source': return clone(object?.sources || null);
    case 'entity-position':
    case 'moving-platform-placement': return clone(object?.effective?.position || object?.alignedBaseline?.origin || null);
    case 'entity-patrol': return patrolValue(object);
    case 'trigger-bounds': return clone(object?.effective?.triggerBounds || null);
    case 'gameplay-bounds': return clone(object?.effective?.gameplayBounds || null);
    case 'visual-bounds': return clone(object?.effective?.visualBounds || null);
    case 'visual-anchor': return clone(object?.effective?.visualAnchor || null);
    case 'presentation': return presentationValue(object);
    case 'projectile-shooter-presentation': {
      const shooter=object?.projectileTopologyResolved?.shooter;
      return shooter ? clone({ actorId:shooter.actorId, pn:shooter.pn, origin:shooter.origin }) : null;
    }
    case 'projectile-emitter': return clone(object?.projectileTopologyResolved?.emitter ? { origin:object.projectileTopologyResolved.emitter.origin } : null);
    case 'projectile-lane': return clone(object?.projectileTopologyResolved?.lane ? { direction:object.projectileTopologyResolved.lane.direction } : null);
    case 'entity-suppression': return String(object?.implementationDisposition || '').startsWith('suppressed');
    case 'moving-platform-controller': return clone(object?.controller?.reviewedParameters || null);
    case 'alignment-exception':
    case 'correspondence-exception': return clone(target?.value || null);
    case 'terrain-cell': {
      const bounds = correction?.value?.g8Bounds;
      const operation = (room?.layers?.structuralCorrections?.operations || []).find(row =>
        row?.type === 'gameplay-cell-override' && equal(row?.g8Bounds, bounds));
      return operation ? { action:String(operation.action), g8Bounds:clone(operation.g8Bounds) } : null;
    }
    case 'presentation-depth': {
      const overrideId = presentationDepthTargetId(correction?.target);
      const row = (room?.layers?.presentationDepth?.overrides || []).find(item => String(item?.id || '') === overrideId);
      return row ? { plane:String(row.plane), band:String(row.band), bounds:clone(row.bounds) } : null;
    }
    case 'visual-plane': {
      const operation = (room?.layers?.structuralCorrections?.operations || []).find(row =>
        row?.type === 'visual-plane-patch' && String(row?.id || '') === String(correction?.id || ''));
      if (!operation) return null;
      const { id: _id, type: _type, authority: _authority, provenance: _provenance, sourceKey: _sourceKey, ...value } = operation;
      return clone(value);
    }
    default: return undefined;
  }
}

export function reviewedCorrectionCurrentValue(room, type, target, value = undefined) {
  const correction = { type:String(type || ''), target:String(target || ''), ...(value === undefined ? {} : { value:clone(value) }) };
  const resolved = findReviewedCorrectionTarget(room, correction.target);
  return clone(currentValue(room, correction, resolved));
}

function validateValue(correction, context) {
  const value = correction.value;
  switch (correction.type) {
    case 'entity-type':
      if (!value || typeof value !== 'object' || (!String(value.class || '').trim() && value.controllerEntity == null)) throw correctionError('entity-type requires class and/or controllerEntity', context);
      if (value.controllerEntity != null && (!Number.isInteger(Number(value.controllerEntity)) || Number(value.controllerEntity) < 0 || Number(value.controllerEntity) > 127)) throw correctionError('entity-type controllerEntity must be 0..127', context);
      break;
    case 'entity-source':
      if (!value || typeof value !== 'object') throw correctionError('entity-source requires an object value', context);
      break;
    case 'entity-position':
    case 'moving-platform-placement':
      requirePoint(value?.position, `${correction.type}.position`, context);
      if (correction.type === 'moving-platform-placement' && value?.supportBounds != null) requireRect(value.supportBounds, 'moving-platform-placement.supportBounds', context);
      break;
    case 'entity-patrol': {
      const start = requirePoint(value?.start, 'entity-patrol.start', context);
      const end = requirePoint(value?.end, 'entity-patrol.end', context);
      if (start[1] !== end[1]) throw correctionError('entity-patrol must remain a bounded horizontal xrick patrol', context);
      const distancePx = Math.abs(end[0] - start[0]);
      if (!Number.isInteger(distancePx) || distancePx <= 0 || (distancePx & 1)) throw correctionError('entity-patrol span must be a positive even pixel distance', context);
      if (value.distancePx != null && Number(value.distancePx) !== distancePx) throw correctionError('entity-patrol.distancePx must match start/end span', context);
      if (value.stepPx != null && Number(value.stepPx) !== 2) throw correctionError('entity-patrol.stepPx must remain the native xrick 2px step', context);
      const direction = value.initialDirection ?? value.direction;
      if (direction != null && !['right','left',1,-1,'1','-1'].includes(direction)) throw correctionError('entity-patrol direction must be right|left|1|-1', context);
      const latency = value.startupLatencyTicks ?? value.startupLatency;
      if (latency != null && (!Number.isInteger(Number(latency)) || Number(latency) < 0 || Number(latency) > 255)) throw correctionError('entity-patrol startup latency must be 0..255 ticks', context);
      break;
    }
    case 'trigger-bounds':
    case 'gameplay-bounds':
    case 'visual-bounds': requireRect(value?.bounds, `${correction.type}.bounds`, context); break;
    case 'visual-anchor': requirePoint(value?.anchor, 'visual-anchor.anchor', context); break;
    case 'projectile-shooter-presentation':
      if (!value || typeof value !== 'object') throw correctionError('projectile-shooter-presentation requires an object value', context);
      requirePoint(value?.origin, 'projectile-shooter-presentation.origin', context);
      if (!Number.isInteger(Number(value.actorId)) || Number(value.actorId) < 0 || Number(value.actorId) > 255) throw correctionError('projectile-shooter-presentation.actorId must be 0..255', context);
      if (!Number.isInteger(Number(value.pn)) || Number(value.pn) < 0 || Number(value.pn) > 254) throw correctionError('projectile-shooter-presentation.pn must be 0..254', context);
      break;
    case 'projectile-emitter':
      requirePoint(value?.origin, 'projectile-emitter.origin', context);
      break;
    case 'projectile-lane':
      if (!value || !['left','right'].includes(String(value.direction || '').toLowerCase())) throw correctionError('projectile-lane.direction must be left or right', context);
      break;
    case 'presentation':
      if (!value || typeof value !== 'object') throw correctionError('presentation requires an object value', context);
      if (value.pn != null && (!Number.isInteger(Number(value.pn)) || Number(value.pn) < 0 || Number(value.pn) > 254)) throw correctionError('presentation.pn must be 0..254', context);
      if (value.layer != null && !['behind-midground','normal','front'].includes(String(value.layer))) throw correctionError('presentation.layer must be behind-midground, normal, or front', context);
      if (value.registration != null && !['origin','draw'].includes(String(value.registration))) throw correctionError('presentation.registration must be origin or draw', context);
      if (value.preserveClassicContact != null && typeof value.preserveClassicContact !== 'boolean') throw correctionError('presentation.preserveClassicContact must be boolean', context);
      if (value.stateVisualOffsetsByPn != null) {
        if (!value.stateVisualOffsetsByPn || typeof value.stateVisualOffsetsByPn !== 'object' || Array.isArray(value.stateVisualOffsetsByPn)) throw correctionError('presentation.stateVisualOffsetsByPn must be an object', context);
        for (const [pn,offset] of Object.entries(value.stateVisualOffsetsByPn)) {
          if (!Number.isInteger(Number(pn)) || Number(pn) < 0 || Number(pn) > 254) throw correctionError('presentation.stateVisualOffsetsByPn keys must be PN 0..254', context);
          requirePoint(offset, `presentation.stateVisualOffsetsByPn.${pn}`, context);
        }
      }
      if (value.statePresentations != null) {
        if (!Array.isArray(value.statePresentations)) throw correctionError('presentation.statePresentations must be an array', context);
        const identities=new Set();
        for (const row of value.statePresentations) {
          if (!row || typeof row !== 'object' || !String(row.sourceKey || '') || !String(row.stateKey || '')) throw correctionError('presentation.statePresentations entries require sourceKey and stateKey', context);
          const sourcePn=Number(row.sourcePn),pn=Number(row.pn ?? sourcePn);
          if (!Number.isInteger(sourcePn) || sourcePn < 0 || sourcePn > 254 || !Number.isInteger(pn) || pn < 0 || pn > 254) throw correctionError('presentation.statePresentations PN values must be 0..254', context);
          if (row.offset != null) requirePoint(row.offset, `presentation.statePresentations.${row.sourceKey}.${row.stateKey}.offset`, context);
          const identity=`${row.sourceKey}|${row.stateKey}`;if(identities.has(identity))throw correctionError(`presentation.statePresentations duplicates ${identity}`, context);identities.add(identity);
        }
      }
      break;
    case 'entity-suppression':
      if (typeof value?.suppressed !== 'boolean') throw correctionError('entity-suppression requires boolean suppressed', context);
      if (value.activatorBounds != null) requireRect(value.activatorBounds, 'entity-suppression.activatorBounds', context);
      break;
    case 'moving-platform-controller':
      if (!value || typeof value !== 'object' || !value.parameters || typeof value.parameters !== 'object') throw correctionError('moving-platform-controller requires parameters', context);
      if (value.parameters.direction != null && !['left','right'].includes(String(value.parameters.direction).toLowerCase())) throw correctionError('moving-platform-controller.parameters.direction must be left or right when provided', context);
      break;
    case 'alignment-exception':
      if (!value || typeof value !== 'object' || !value.transform || !['translate', 'scale-translate'].includes(String(value.transform.type || ''))) throw correctionError('alignment-exception requires a supported transform', context);
      break;
    case 'correspondence-exception':
      if (!value || typeof value !== 'object') throw correctionError('correspondence-exception requires an object value', context);
      break;
    case 'terrain-cell':
      if (!value || !['open', 'one-way', 'climb-through', 'lethal'].includes(String(value.action || ''))) throw correctionError('terrain-cell requires action open|one-way|climb-through|lethal', context);
      requireRect(value.g8Bounds, 'terrain-cell.g8Bounds', context);
      break;
    case 'presentation-depth': {
      const plane=String(value?.plane || 'A').toUpperCase(), band=String(value?.band || '');
      if (!['A','B'].includes(plane)) throw correctionError('presentation-depth requires Plane A|B', context);
      const allowed=plane === 'A' ? ['midground','foreground'] : ['backdrop','midground'];
      if (!allowed.includes(band)) throw correctionError(`presentation-depth Plane ${plane} requires band ${allowed.join('|')}`, context);
      requireRect(value?.bounds, 'presentation-depth.bounds', context);
      if (Number(value.bounds[2]) <= 0 || Number(value.bounds[3]) <= 0) throw correctionError('presentation-depth.bounds must have positive width/height', context);
      break;
    }
    case 'visual-plane': {
      const action = String(value?.action || '');
      if (!['suppress', 'copy', 'overlay-tiles'].includes(action)) throw correctionError('visual-plane requires action suppress|copy|overlay-tiles', context);
      requireRect(value?.bounds, 'visual-plane.bounds', context);
      const layer = String(value?.layer || value?.clearLayer || '').toUpperCase();
      if (!['A', 'B'].includes(layer)) throw correctionError('visual-plane requires layer/clearLayer A|B', context);
      if (action === 'copy') requireRect(value?.sourceBounds, 'visual-plane.sourceBounds', context);
      if (action === 'overlay-tiles') {
        if (!Array.isArray(value?.tiles) || !value.tiles.length) throw correctionError('visual-plane overlay-tiles requires at least one tile', context);
        for (const tile of value.tiles) {
          const hasGlobalTile = Number.isInteger(Number(tile?.globalTile)) && Number(tile.globalTile) >= 0;
          const hasAssetId = !!String(tile?.assetId || '').trim();
          if (!hasGlobalTile && !hasAssetId) throw correctionError('visual-plane tile requires globalTile or assetId', context);
          requirePoint(tile?.offset, 'visual-plane tile offset', context);
          if (!['A', 'B'].includes(String(tile?.plane || '').toUpperCase())) throw correctionError('visual-plane tile plane must be A|B', context);
          if (tile?.paletteLine != null && (!Number.isInteger(Number(tile.paletteLine)) || Number(tile.paletteLine) < 0 || Number(tile.paletteLine) > 3)) throw correctionError('visual-plane tile paletteLine must be 0..3', context);
        }
      }
      break;
    }
    default: throw correctionError(`Unsupported correction type '${correction.type}'`, context);
  }
}

export function validateReviewedCorrection(correction, { room = null, roomId = room?.id || null } = {}) {
  if (!correction || typeof correction !== 'object') throw correctionError('Correction must be an object', { roomId, correction });
  if (!String(correction.id || '').trim()) throw correctionError('Correction requires a stable id', { roomId, correction });
  if (!String(correction.target || '').trim()) throw correctionError('Correction requires a stable target', { roomId, correction });
  const spec = REVIEWED_CORRECTION_TYPES[correction.type];
  if (!spec) throw correctionError(`Unsupported correction type '${correction.type || ''}'`, { roomId, correction });
  if (!correction.provenance || !String(correction.provenance.reason || '').trim()) throw correctionError('Correction requires provenance.reason', { roomId, correction });
  validateValue(correction, { roomId, correction });
  if (room) {
    const target = findReviewedCorrectionTarget(room, correction.target);
    if (!target) throw correctionError('Correction target does not exist', { roomId, correction });
    if (spec.target !== target.kind && !(spec.target === 'room' && target.kind === 'room')) throw correctionError(`Correction target kind is ${target.kind}, expected ${spec.target}`, { roomId, correction });
  }
  return correction;
}

export function validateReviewedCorrectionLedger(ledger, { room = null, roomId = room?.id || null, submap = room?.submap, mapId = room?.mapId } = {}) {
  if (!ledger || typeof ledger !== 'object') throw correctionError('Reviewed correction ledger must be an object', { roomId });
  if (ledger.schema !== REVIEWED_CORRECTIONS_SCHEMA) throw correctionError(`Expected ${REVIEWED_CORRECTIONS_SCHEMA}, received ${ledger.schema || 'missing schema'}`, { roomId });
  if (submap != null && Number(ledger?.room?.submap) !== Number(submap)) throw correctionError('Correction ledger submap does not match room', { roomId });
  if (mapId != null && Number(ledger?.room?.mapId) !== Number(mapId)) throw correctionError('Correction ledger mapId does not match room', { roomId });
  const seen = new Set();
  for (const correction of ledger.corrections || []) {
    validateReviewedCorrection(correction, { room, roomId });
    if (seen.has(correction.id)) throw correctionError('Duplicate correction id', { roomId, correction });
    seen.add(correction.id);
  }
  return ledger;
}

function applyEntityCorrection(object, correction) {
  const value = clone(correction.value);
  object.reviewed ||= {};
  switch (correction.type) {
    case 'entity-type':
      if (String(value.class || '').trim()) object.class = String(value.class);
      if (value.controllerEntity != null) object.controller = { ...(object.controller || {}), authority: 'reviewed-correction', entity: Number(value.controllerEntity) };
      break;
    case 'entity-source': object.sources = { ...(object.sources || {}), ...value }; break;
    case 'entity-position':
    case 'moving-platform-placement': {
      const previous = Array.isArray(object?.effective?.position)
        ? object.effective.position.map(Number) : value.position.map(Number);
      const next = value.position.map(Number);
      const dx = next[0] - previous[0], dy = next[1] - previous[1];
      /* Layer-F gameplay corrections deliberately do not move independently
       * reviewed fixed-contact art. A Level Editor entity-position review is
       * different: its native draft moves both the source controller and its
       * fixed visual registration, so persist that newly reviewed delta into
       * the resolved presentation record as well. */
      const linkedRelative = object?.staticReplacement && object?.spatial?.trajectoryAuthority === 'classic-c-relative';
      if ((object?.spatial?.trajectoryAuthority === 'fixed-contact' || linkedRelative) && (dx || dy)) {
        const shift = point => Array.isArray(point) && point.length >= 2
          ? [Number(point[0]) + dx, Number(point[1]) + dy] : point;
        object.spatial = { ...object.spatial,
          baseOrigin:shift(object.spatial.baseOrigin), baseDraw:shift(object.spatial.baseDraw) };
        for (const state of Object.values(object.states || {})) {
          if (!state || typeof state !== 'object') continue;
          state.origin = shift(state.origin);
          state.draw = shift(state.draw);
        }
        object.effective ||= {};
        object.effective.presentationOrigin = shift(object.effective.presentationOrigin);
        object.effective.visualAnchor = shift(object.effective.visualAnchor);
      }
      object.effective ||= {}; object.effective.position = next; object.reviewed.position = next;
      if (correction.type === 'moving-platform-placement' && value.supportBounds) object.effective.supportBounds = value.supportBounds.map(Number);
      break;
    }
    case 'entity-patrol': {
      const previous = patrolValue(object) || {};
      const previousAnchor = patrolAnchorValue(object);
      const start = value.start.map(Number), end = value.end.map(Number);
      const distancePx = Math.abs(end[0] - start[0]);
      const direction = value.initialDirection ?? value.direction ?? previous.initialDirection ?? (end[0] >= start[0] ? 'right' : 'left');
      const startupLatencyTicks = Number(value.startupLatencyTicks ?? value.startupLatency ?? previous.startupLatencyTicks ?? 0);
      const reviewedPatrol = {
        ...previous, ...value, start, end, distancePx, counterLimit:distancePx / 2,
        stepPx:2, initialDirection:direction === -1 || direction === '-1' || direction === 'left' ? 'left' : 'right',
        startupLatencyTicks, loopPeriodTicks:distancePx
      };
      delete reviewedPatrol.direction;
      delete reviewedPatrol.startupLatency;
      object.controller = { ...(object.controller || {}), reviewedPatrol };
      object.reviewed.patrol = clone(reviewedPatrol);
      if (previousAnchor) {
        const dx=Number(start[0])-Number(previousAnchor[0]), dy=Number(start[1])-Number(previousAnchor[1]);
        if (dx || dy) object.reviewed.patrolAnchorDelta=[dx,dy];
      }
      break;
    }
    case 'trigger-bounds': object.effective ||= {}; object.effective.triggerBounds = value.bounds.map(Number); break;
    case 'gameplay-bounds': object.effective ||= {}; object.effective.gameplayBounds = value.bounds.map(Number); break;
    case 'visual-bounds': object.effective ||= {}; object.effective.visualBounds = value.bounds.map(Number); break;
    case 'visual-anchor': object.effective ||= {}; object.effective.visualAnchor = value.anchor.map(Number); object.reviewed.visualAnchor = value.anchor.map(Number); break;
    case 'projectile-shooter-presentation': {
      if (!object.projectileTopologyResolved?.shooter) break;
      const shooter={ ...object.projectileTopologyResolved.shooter, ...value, origin:value.origin.map(Number), actorId:Number(value.actorId), pn:Number(value.pn), authority:'reviewed-projectile-shooter-presentation' };
      object.projectileTopologyResolved={ ...object.projectileTopologyResolved, shooter };
      object.reviewed.projectileShooterPresentation=clone(shooter);
      break;
    }
    case 'projectile-emitter': {
      const topology=object.projectileTopologyResolved; if(!topology?.emitter) break;
      const origin=value.origin.map(Number), offset=(topology.emitter.muzzleOffset||[0,0]).map(Number);
      const emitter={ ...topology.emitter, origin, mouth:[origin[0]+offset[0],origin[1]+offset[1]], authority:'reviewed-projectile-emitter-origin' };
      object.projectileTopologyResolved={ ...topology, emitter };
      object.projectileEmitterResolved=emitter;
      object.reviewed.projectileEmitter=clone({origin});
      break;
    }
    case 'projectile-lane': {
      const topology=object.projectileTopologyResolved; if(!topology?.lane) break;
      const direction=String(value.direction).toLowerCase();
      const lane={ ...topology.lane, direction, authority:'reviewed-projectile-lane' };
      const emitter={ ...topology.emitter, direction };
      object.projectileTopologyResolved={ ...topology, emitter, lane };
      object.projectileEmitterResolved=emitter;
      object.reviewed.projectileLane=clone({direction});
      break;
    }
    case 'presentation': {
      const next = { ...(object.presentation || {}), ...value, authoredOverride: true, provenance: correction.provenance.reason };
      if (value.pn != null) {
        next.pnByState = { ...(next.pnByState || {}), snapshot: Number(value.pn), simulated: Number(value.pn) };
        /* A reviewed PN assignment replaces only presentation ownership. The
         * Classic/xrick entity remains the gameplay/controller source, but the
         * resolved RDX projection must stop treating its pixels as a Classic
         * fallback after the reviewed sprite has been assigned. */
        if (String(next.owner || '') === 'classic-fallback') next.owner = 'rdx';
      }
      if (value.stateVisualOffsetsByPn) next.stateVisualOffsetsByPn = { ...(object.presentation?.stateVisualOffsetsByPn || {}), ...clone(value.stateVisualOffsetsByPn) };
      if (value.statePresentations) next.statePresentations = clone(value.statePresentations);
      if (value.layer != null) {
        const front = String(value.layer) === 'front';
        for (const state of Object.values(object.states || {})) if (state && typeof state === 'object') state.front=front;
        for (const component of Object.values(object.componentStateCycles || {})) if (component?.snapshot) component.snapshot.front=front;
      }
      delete next.pn;
      object.presentation = next;
      break;
    }
    case 'entity-suppression':
      object.implementationDisposition = value.suppressed ? 'suppressed-by-reviewed-room-correction' : 'reviewed-active';
      object.suppression = { ...(object.suppression || {}), ...(value.activatorBounds ? { activatorBounds:value.activatorBounds.map(Number) } : {}), reason:correction.provenance.reason };
      break;
    case 'moving-platform-controller': object.controller = { ...(object.controller || {}), reviewedParameters: value.parameters }; break;
    default: break;
  }
  const applied = { id:correction.id, type:correction.type, provenance:clone(correction.provenance) };
  object.reviewedCorrectionsApplied = [...(object.reviewedCorrectionsApplied || []), applied];
}

export function applyReviewedCorrections(room, ledger) {
  const next = clone(room);
  validateReviewedCorrectionLedger(ledger, { room: next, roomId: next.id, submap: next.submap, mapId: next.mapId });
  const applications = [], patrolAnchorTargets = new Set();
  for (const correction of ledger.corrections || []) {
    const target = findReviewedCorrectionTarget(next, correction.target);
    const before = currentValue(next, correction, target);
    if (Object.hasOwn(correction, 'expected') && !equal(before, correction.expected)) throw correctionError('Correction is stale', { roomId:next.id, correction, actual:before });
    if (target.kind === 'entity') {
      applyEntityCorrection(target.value, correction);
      if (correction.type === 'entity-patrol') patrolAnchorTargets.add(String(correction.target));
    }
    else if (target.kind === 'alignment') {
      if (correction.type === 'alignment-exception') Object.assign(target.value, clone(correction.value));
      else target.value.correspondenceException = clone(correction.value);
    } else if (correction.type === 'terrain-cell') {
      next.layers.structuralCorrections ||= { schema:'rdr.structural_corrections_resolved.v1', operations:[] };
      next.layers.structuralCorrections.operations ||= [];
      const g8Bounds = correction.value.g8Bounds.map(Number);
      const replacement = {
        id:correction.id, type:'gameplay-cell-override', action:String(correction.value.action), g8Bounds,
        sourceKey:String(correction.target), authority:String(correction.provenance.authority || 'reviewed-room-correction'), provenance:correction.provenance.reason
      };
      const index = next.layers.structuralCorrections.operations.findIndex(row =>
        row?.type === 'gameplay-cell-override' && equal(row?.g8Bounds, g8Bounds));
      if (index >= 0) next.layers.structuralCorrections.operations[index] = replacement;
      else next.layers.structuralCorrections.operations.push(replacement);
    } else if (correction.type === 'presentation-depth') {
      next.layers.presentationDepth ||= { schema:'rdr.presentation_depth_resolved.v2', version:2, planeDefaults:{A:'foreground',B:'midground'}, classes:[], overrides:[] };
      next.layers.presentationDepth.overrides ||= [];
      const overrideId = presentationDepthTargetId(correction.target) || String(correction.id);
      const replacement = { id:overrideId, plane:String(correction.value.plane || 'A').toUpperCase(), band:String(correction.value.band), bounds:correction.value.bounds.map(Number), source:'reviewed-room', provenance:clone(correction.provenance) };
      const index = next.layers.presentationDepth.overrides.findIndex(row => String(row?.id || '') === overrideId);
      if (index >= 0) next.layers.presentationDepth.overrides[index] = replacement; else next.layers.presentationDepth.overrides.push(replacement);
      validatePresentationDepthOverrides(next.layers.presentationDepth.overrides);
    } else if (correction.type === 'visual-plane') {
      next.layers.structuralCorrections ||= { schema:'rdr.structural_corrections_resolved.v1', operations:[] };
      next.layers.structuralCorrections.operations ||= [];
      const replacement = {
        ...clone(correction.value), id:correction.id, type:'visual-plane-patch', sourceKey:String(correction.target),
        authority:String(correction.provenance.authority || 'reviewed-room-correction'), provenance:correction.provenance.reason
      };
      const index = next.layers.structuralCorrections.operations.findIndex(row => String(row?.id || '') === String(correction.id));
      if (index >= 0) next.layers.structuralCorrections.operations[index] = replacement;
      else next.layers.structuralCorrections.operations.push(replacement);
    }
    const afterTarget = findReviewedCorrectionTarget(next, correction.target);
    const after = currentValue(next, correction, afterTarget);
    applications.push({
      id:correction.id, type:correction.type, target:correction.target, semantic:REVIEWED_CORRECTION_TYPES[correction.type].semantic,
      before:clone(before), after:clone(after), provenance:clone(correction.provenance)
    });
  }
  /* Patrol start is a gameplay source translation, so compose it after all
   * sibling corrections have passed their stale guards. This keeps every
   * `expected` value relative to the same canonical room while making patrol
   * anchor movement additive with explicit position / visual-anchor fixes,
   * matching the native generated source-position delta. */
  for (const targetId of patrolAnchorTargets) {
    const target=findReviewedCorrectionTarget(next,targetId);
    const delta=target?.kind==='entity' ? target.value?.reviewed?.patrolAnchorDelta : null;
    if (!Array.isArray(delta) || delta.length < 2) continue;
    const dx=Number(delta[0]||0),dy=Number(delta[1]||0); if(!dx&&!dy)continue;
    target.value.effective ||= {};
    target.value.effective.position=translatePoint(target.value.effective.position,dx,dy);
    target.value.effective.presentationOrigin=translatePoint(target.value.effective.presentationOrigin,dx,dy);
    target.value.effective.visualAnchor=translatePoint(target.value.effective.visualAnchor,dx,dy);
  }
  next.layers.reviewedCorrections = clone(ledger);
  next.provenance ||= {};
  next.provenance.reviewedCorrections = applications;
  next.provenance.migrationStatus = applications.length ? 'canonical-layered+reviewed-overlay' : next.provenance.migrationStatus;
  return next;
}

export function inspectReviewedCorrectionState(room, correction) {
  validateReviewedCorrection(correction, { room, roomId:room?.id || null });
  const target = findReviewedCorrectionTarget(room, correction.target);
  const source = target?.kind === 'entity' ? clone(target.value?.sourceEvidence?.classic || target.value?.sources || null) : clone(target?.value || null);
  const effective = currentValue(room, correction, target);
  try {
    const reviewedRoom = applyReviewedCorrections(room, { schema:REVIEWED_CORRECTIONS_SCHEMA, room:{ submap:Number(room.submap), mapId:Number(room.mapId) }, corrections:[correction] });
    const reviewedTarget = findReviewedCorrectionTarget(reviewedRoom, correction.target);
    return Object.freeze({
      source, effective:clone(effective), reviewed:currentValue(reviewedRoom, correction, reviewedTarget), authoredCorrectionPreview:clone(correction),
      validation:'valid', stale:false, provenance:clone(correction.provenance), semantic:REVIEWED_CORRECTION_TYPES[correction.type].semantic
    });
  } catch (error) {
    if (error?.name !== 'ReviewedCorrectionValidationError') throw error;
    return Object.freeze({ source, effective:clone(effective), reviewed:null, authoredCorrectionPreview:clone(correction), validation:error.message, stale:/stale/i.test(error.message), provenance:clone(correction.provenance), semantic:REVIEWED_CORRECTION_TYPES[correction.type].semantic });
  }
}

export function correctionImpact(correction) {
  const spec = REVIEWED_CORRECTION_TYPES[correction?.type];
  return spec ? Object.freeze({ type:correction.type, target:correction.target, semantic:spec.semantic, visualOnly:spec.semantic === 'visual' }) : null;
}
