function entityNumber(value) { return Number(value || 0) & 0x7f; }
function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }

const TYPE1A = new Set([0x04, 0x07, 0x0a, 0x0d]);
const TYPE1B = new Set([0x05, 0x08, 0x0b, 0x0e]);
const TYPE2 = new Set([0x06, 0x09, 0x0c, 0x0f]);

/** Classify the actual xrick enemy action family. These are dispatch-table
 * semantics, not guesses from artwork or RDX PN identity. */
export function classifyClassicEnemy(entity) {
  const n = entityNumber(entity);
  if (TYPE1A.has(n)) return Object.freeze({
    id: 'type1a-bounded', family: 'type1a', label: 'bounded patrol',
    fixedBounds: false, target: 'distance-counter', canClimb: false,
    description: 'Walks horizontally; reverses at collision/map edge or after its configured step counter reaches trigX/2.'
  });
  if (TYPE1B.has(n)) return Object.freeze({
    id: 'type1b-rick-seeking', family: 'type1b', label: 'Rick-seeking',
    fixedBounds: false, target: 'rick', canClimb: false, canFall: true,
    description: 'Walks horizontally, falls when support is absent, and re-evaluates direction toward Rick at the x&0x1e == 0x10 cadence gate.'
  });
  if (TYPE2.has(n)) return Object.freeze({
    id: 'type2-roam-climb', family: 'type2', label: 'roam / climb / pursue',
    fixedBounds: false, target: 'rick+terrain+rng', canClimb: true,
    description: 'Uses terrain, ladders, Rick position and deterministic RNG turns; no static patrol box exists.'
  });
  if (n === 0x2a || n === 0x2b) return Object.freeze({
    id: 'type3-scripted-enemy', family: 'type3', label: 'scripted action path',
    fixedBounds: false, target: 'trigger+step-sequence', canClimb: false,
    description: 'Triggered type-3 enemy; follows its authoritative ent_mvstep/runtime trace rather than a patrol box.'
  });
  if (n === 0x47) return Object.freeze({
    id: 'zombie-ballistic', family: 'zombie', label: 'defeated / ballistic',
    fixedBounds: false, target: 'none', canClimb: false,
    description: 'Death-state trajectory; not an active patrol.'
  });
  return null;
}

export function traceEnvelope(points, fallback = [0, 0]) {
  const valid = (points || []).filter(point => Array.isArray(point) && point.length >= 2 && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])))
    .map(point => [Number(point[0]), Number(point[1])]);
  if (!valid.length) valid.push([Number(fallback[0] || 0), Number(fallback[1] || 0)]);
  const xs = valid.map(point => point[0]), ys = valid.map(point => point[1]);
  return Object.freeze({
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minY: Math.min(...ys), maxY: Math.max(...ys),
    width: Math.max(1, Math.max(...xs) - Math.min(...xs)),
    height: Math.max(1, Math.max(...ys) - Math.min(...ys)),
    sampleCount: valid.length
  });
}

/** Convert classic runtime fields into an overlay contract. Type-1A's range is
 * derived, not stored as an explicit min/max box: each move is 2 px, c2 counts
 * moves, and the reversal threshold is trigX >> 1, therefore one full leg is
 * trigX pixels unless terrain or the 0..0xe8 world limit turns it earlier. */
export function buildEnemyBehaviorDiagnostic({ sourceKey, source, current, points, configuredStart = null, pathAuthority = null, contactSweep = null, hero, width, height }) {
  const policy = classifyClassicEnemy(source?.n);
  if (!policy) return null;
  const x = Number(current?.[0] ?? source?.x ?? 0), y = Number(current?.[1] ?? source?.y ?? 0);
  const direction = Number(source?.c1 || 0) < 0 ? 'left' : 'right';
  const envelope = traceEnvelope(points, [x, y]);
  const result = {
    sourceKey: String(sourceKey || ''), entity: entityNumber(source?.n), policy,
    current: Object.freeze([x, y]), direction,
    envelope,
    hero: hero ? Object.freeze([Number(hero[0]), Number(hero[1])]) : null,
    configured: null,
    pathPoints: Object.freeze((points || []).filter(point => Array.isArray(point) && point.length >= 2
      && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])))
      .map(point => Object.freeze([Number(point[0]), Number(point[1])]))),
    notes: []
  };
  if (policy.family === 'type1a') {
    const controller = source?.controller || null;
    const patrol = String(controller?.kind || '') === 'bounded-horizontal-patrol' ? controller?.patrol || null : null;
    const configuredDistance = Math.max(0, Number(patrol?.distancePx ?? source?.trigX ?? 0));
    const configuredDirection = String(patrol?.initialDirection || direction) === 'left' ? 'left' : 'right';
    const sign = configuredDirection === 'left' ? -1 : 1;
    const firstPoint = result.pathPoints[0] || [x, y];
    /* The visible/effective patrol may be shifted onto a nearby RDX support
     * surface. Keep the Layer-B configured controller start in its own
     * coordinate leg instead of deriving it back from that adjusted path. */
    const configuredPoint = Array.isArray(configuredStart) && configuredStart.length >= 2
      ? [Number(configuredStart[0]), Number(configuredStart[1])] : firstPoint;
    const initialCounter = Math.max(0, Math.abs(Number(source?.c2 || 0)));
    const stepPx = Math.max(1, Math.abs(Number(patrol?.stepPx || 2)));
    const derivedStartX = Number(configuredPoint[0]) - sign * initialCounter * stepPx;
    const derivedTargetX = clamp(derivedStartX + sign * configuredDistance, 0, Math.max(0, Number(width || 0) - 1));
    if (patrol) {
      const configuredPath = Object.freeze([
        Object.freeze([derivedStartX, Number(configuredPoint[1])]),
        Object.freeze([derivedTargetX, Number(configuredPoint[1])])
      ]);
      const hasEffectiveLeg = result.pathPoints.length >= 2 && result.envelope.width >= 2;
      const actualDistance = hasEffectiveLeg ? result.envelope.width : null;
      result.configured = Object.freeze({
        distancePx: configuredDistance,
        configuredDistancePx: configuredDistance,
        counterLimit: Math.max(0, Number(patrol.counterLimit ?? Math.floor(configuredDistance / stepPx))),
        start: configuredPath[0], target: configuredPath[1],
        stepPx,
        startupLatencyTicks: Math.max(0, Number(patrol.startupLatencyTicks || 0)),
        loopPeriodTicks: Math.max(0, Number(patrol.loopPeriodTicks || 0)),
        authority: String(controller?.authority || 'layer-b-xrick-type1a-patrol'),
        drawConfiguredLine: !hasEffectiveLeg,
        actualDistancePx: actualDistance,
        interruptedByTerrain: actualDistance != null && actualDistance < configuredDistance
      });
      result.notes.push(pathAuthority === 'layer-b-classic-static-envtest-projected'
        ? 'Displayed patrol is the Layer-B xrick type-1A distance counter constrained by the immutable Classic static terrain probes; trigX remains the per-leg maximum.'
        : pathAuthority === 'layer-b-configured-patrol-projected'
        ? 'Displayed patrol is the normalized Layer-B configured interval projected into this view; support scanning does not shorten an unchanged source patrol.'
        : hasEffectiveLeg
          ? 'Displayed patrol is the effective support/observed envelope; Layer-B keeps the configured maximum distance separately.'
          : 'No effective support/observed leg is available; displaying the Layer-B configured maximum distance.');
      if (!hasEffectiveLeg) {
        result.pathPoints = configuredPath;
        result.envelope = traceEnvelope(configuredPath, [x, y]);
      }
    } else {
      const hasCapturedLeg = envelope.sampleCount > 2 && envelope.width >= 2;
      const startX = hasCapturedLeg ? envelope.minX : Math.min(derivedStartX, derivedTargetX);
      const targetX = hasCapturedLeg ? envelope.maxX : Math.max(derivedStartX, derivedTargetX);
      result.configured = Object.freeze({
        distancePx: hasCapturedLeg ? envelope.width : configuredDistance,
        configuredDistancePx: configuredDistance,
        counterLimit: Math.floor(configuredDistance / stepPx),
        start: Object.freeze([startX, Number(firstPoint[1])]),
        target: Object.freeze([targetX, Number(firstPoint[1])]),
        authority: hasCapturedLeg ? 'captured-runtime-envelope' : 'classic-distance-counter-derived',
        drawConfiguredLine: !hasCapturedLeg,
        actualDistancePx: hasCapturedLeg ? envelope.width : null,
        interruptedByTerrain: hasCapturedLeg && envelope.width < configuredDistance
      });
      result.notes.push(hasCapturedLeg
        ? 'Displayed patrol leg is the captured C-runtime envelope; trigX remains the configured maximum distance.'
        : 'No explicit normalized patrol descriptor is available; range falls back to Classic counter fields.');
    }
    /* Guard geometry is the swept native enemy contact body over the actual
     * reachable leg. It is deliberately not expanded into a rectangle of
     * possible Rick origins: that made the green overlay enter terrain the
     * enemy can never occupy and visually mislabeled selection space as
     * gameplay collision. Native xrick boxes are inclusive; editor rectangles
     * are half-open, hence +1 on contact maxima. */
    const enemyW = Math.max(1, Number(source?.w || 24));
    const enemyH = Math.max(1, Number(source?.h || 21));
    const dangerPath = result.envelope;
    const nativeContact = contactSweep && ['minX','maxX','minY','maxY'].every(key=>Number.isFinite(Number(contactSweep[key])))
      ? contactSweep : null;
    const fallbackEnemyTop = Number(dangerPath.minY) - enemyH;
    const actorMinX = nativeContact ? Number(nativeContact.minX) : Number(dangerPath.minX);
    const actorMaxX = nativeContact ? Number(nativeContact.maxX) : Number(dangerPath.maxX) + enemyW - 1;
    const actorMinY = nativeContact ? Number(nativeContact.minY) : fallbackEnemyTop;
    const actorMaxY = nativeContact ? Number(nativeContact.maxY) : Number(dangerPath.maxY) - 1;
    result.dangerEnvelope = Object.freeze({
      minX:actorMinX,maxX:actorMaxX+1,minY:actorMinY,maxY:actorMaxY+1,
      width:Math.max(1,actorMaxX-actorMinX+1),height:Math.max(1,actorMaxY-actorMinY+1),
      sampleCount:Math.max(1, Number(dangerPath.sampleCount || result.pathPoints.length || 1)),
      authority:nativeContact ? 'xrick-centred-visual-contact-body-sweep' : 'xrick-contact-body-sweep'
    });
    result.geometrySemantic='guard sweep';
    result.notes.push(`Green guard sweep is the enemy's actual gameplay contact body over the reachable patrol leg${nativeContact ? ' from the native centred frame union' : ''}; it is not a controller maximum or Rick-origin envelope.`);
  } else if (policy.family === 'type1b') {
    result.notes.push('No fixed patrol bounds: horizontal movement, terrain-supported falling, and periodic Rick-seeking direction changes remain native xrick authority.');
  } else if (policy.family === 'type2') {
    result.notes.push('Envelope is observed/runtime-derived, not a guaranteed patrol box.');
  } else if (policy.family === 'type3') {
    result.notes.push('Envelope is the captured scripted action path; activation is trigger-owned.');
  }
  result.canvasBounds = Object.freeze({ width: Number(width || 0), height: Number(height || 0) });
  return Object.freeze(result);
}
