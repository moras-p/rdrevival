function int(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function semanticObjects(room) { return room?.layers?.semanticCorpus?.objects || []; }

const TYPE1A = new Set([0x04, 0x07, 0x0a, 0x0d]);
const TYPE1B = new Set([0x05, 0x08, 0x0b, 0x0e]);
const TYPE2 = new Set([0x06, 0x09, 0x0c, 0x0f]);

function controllerFamily(entity) {
  const value = int(entity, -1) & 0x7f;
  if (TYPE1A.has(value)) return 'type1a';
  if (TYPE1B.has(value)) return 'type1b';
  if (TYPE2.has(value)) return 'type2';
  if (value >= 0x18) return 'type3-or-action-state';
  return 'classic-action-state';
}

function alignmentRegion(room, object) {
  const regions = room?.layers?.alignment?.regions || [];
  const authority = String(object?.alignedBaseline?.authority || '');
  return regions.find(region => region?.id === authority) || (regions.length === 1 ? regions[0] : null);
}

function alignmentTranslation(room, object) {
  const region = alignmentRegion(room, object);
  const transform = region?.transform || {};
  if (transform.type !== 'translate') return Object.freeze({ dx: 0, dy: 0, authority: region?.id || null, supported: false });
  return Object.freeze({ dx: int(transform.dxPx), dy: int(transform.dyPx), authority: region.id, supported: true });
}

function translatePoint(point, translation) {
  return Object.freeze([int(point?.[0]) + translation.dx, int(point?.[1]) + translation.dy]);
}

function sourceKey(object) {
  return String(object?.sources?.rdx?.sourceKey || (object?.sources?.classic?.mark != null ? `mark:${int(object.sources.classic.mark)}` : object?.semanticId || ''));
}

function boundedPatrolDescriptor(room, object, controller) {
  const patrol = controller?.patrol;
  if (!Array.isArray(patrol?.start) || !Array.isArray(patrol?.end)) return null;
  const translation = alignmentTranslation(room, object);
  const sourcePath = Object.freeze([Object.freeze(patrol.start.map(value => int(value))), Object.freeze(patrol.end.map(value => int(value)))]);
  const worldPath = Object.freeze(sourcePath.map(point => translatePoint(point, translation)));
  return Object.freeze({
    sourceKey: sourceKey(object), semanticId: object.semanticId, mark: int(object?.sources?.classic?.mark, -1), entity: int(object?.sources?.classic?.entity, -1),
    class: object.class, family: object.family, kind: 'bounded-horizontal-patrol', authority: String(controller.authority || 'xrick-map-mark-type1a'),
    source: Object.freeze({ space: 'classic-source-world-px', path: sourcePath }),
    world: Object.freeze({ space: 'rdx-world-px', path: worldPath, transform: translation }),
    timing: Object.freeze({ startupLatencyTicks: int(patrol.startupLatencyTicks), loopPeriodTicks: int(patrol.loopPeriodTicks), counterLimit: int(patrol.counterLimit), stepPx: int(patrol.stepPx), initialDirection: String(patrol.initialDirection || '') })
  });
}


function nativeStateDescriptor(room, object, controller) {
  const entity = int(object?.sources?.classic?.entity, int(controller?.entity, -1));
  if (entity < 0 || object?.presentation?.owner !== 'rdx') return null;
  const simulated = object?.states?.simulated || object?.states?.snapshot || null;
  if (!Number.isFinite(Number(simulated?.pn))) return null;
  const translation = alignmentTranslation(room, object);
  const sourceEvidence = object?.sourceEvidence?.classic || null;
  const sourcePoint = sourceEvidence && Number.isFinite(Number(sourceEvidence.x)) && Number.isFinite(Number(sourceEvidence.y))
    ? Object.freeze([int(sourceEvidence.x), int(sourceEvidence.y)]) : null;
  const aligned = Array.isArray(object?.alignedBaseline?.origin) ? Object.freeze(object.alignedBaseline.origin.map(value => int(value)))
    : (Array.isArray(object?.effective?.position) ? Object.freeze(object.effective.position.map(value => int(value)))
      : (sourcePoint ? translatePoint(sourcePoint, translation) : null));
  if (!aligned) return null;
  const source = sourcePoint || Object.freeze([aligned[0] - translation.dx, aligned[1] - translation.dy]);
  return Object.freeze({
    sourceKey: sourceKey(object), semanticId: object.semanticId, mark: int(object?.sources?.classic?.mark, -1), entity,
    class: object.class, family: object.family, kind: 'native-reactive-controller', authority: String(controller?.authority || 'classic-xrick-live-controller'),
    controllerFamily: controllerFamily(entity),
    source: Object.freeze({ space:'classic-source-world-px', path:Object.freeze([source]) }),
    world: Object.freeze({ space:'rdx-world-px', path:Object.freeze([aligned]), transform:translation }),
    timing: Object.freeze({ motionAuthority:'native-xrick-only', presentationAuthority:'resolved-pn-animation' }),
    notes: Object.freeze(['Whole-room presentation may animate from the resolved PN descriptor; mutable movement remains native xrick authority.'])
  });
}

function scriptedPathDescriptor(room, object, paths) {
  const entity = int(object?.sources?.classic?.entity, -1);
  const program = entity >= 0 ? paths?.entities?.[String(entity)] : null;
  if (!program || !Array.isArray(program.polyline)) return null;
  const baseline = object?.sourceEvidence?.classic?.position || object?.sourceEvidence?.classic?.origin || null;
  let anchor = Array.isArray(baseline) ? baseline : null;
  if (!anchor && Array.isArray(object?.alignedBaseline?.origin)) {
    const t = alignmentTranslation(room, object);
    anchor = [int(object.alignedBaseline.origin[0]) - t.dx, int(object.alignedBaseline.origin[1]) - t.dy];
  }
  if (!anchor) return null;
  const translation = alignmentTranslation(room, object);
  const sourcePath = Object.freeze(program.polyline.map(point => Object.freeze([int(anchor[0]) + int(point?.[0]), int(anchor[1]) + int(point?.[1])])));
  const worldPath = Object.freeze(sourcePath.map(point => translatePoint(point, translation)));
  return Object.freeze({
    sourceKey: sourceKey(object), semanticId: object.semanticId, mark: int(object?.sources?.classic?.mark, -1), entity,
    class: object.class, family: object.family, kind: 'ent-mvstep-scripted-path', authority: String(paths?.source?.authority || 'xrick-ent-mvstep-program'),
    source: Object.freeze({ space: 'classic-source-world-px', path: sourcePath, relativePolyline: Object.freeze(program.polyline.map(point => Object.freeze(point.map(value => int(value))))) }),
    world: Object.freeze({ space: 'rdx-world-px', path: worldPath, transform: translation }),
    timing: Object.freeze({ totalTicks: int(program.totalTicks), stepStart: int(program.stepStart), steps: Object.freeze([...(program.steps || [])]) })
  });
}

export function projectAuthoritativeControllerDescriptors(room, scriptedPaths = null) {
  const descriptors = [];
  for (const object of semanticObjects(room)) {
    const controller = object?.sourceEvidence?.classic?.controller || object?.controller || null;
    const bounded = controller?.kind === 'bounded-horizontal-patrol' ? boundedPatrolDescriptor(room, object, controller) : null;
    if (bounded) { descriptors.push(bounded); continue; }
    const scripted = scriptedPathDescriptor(room, object, scriptedPaths);
    if (scripted) { descriptors.push(scripted); continue; }
    const nativeState = nativeStateDescriptor(room, object, controller);
    if (nativeState) descriptors.push(nativeState);
  }
  return Object.freeze(descriptors);
}

export function descriptorForSource(descriptors, key) { return (descriptors || []).find(row => row.sourceKey === String(key)) || null; }
export { alignmentTranslation, translatePoint };
