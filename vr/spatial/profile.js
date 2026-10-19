import SM00 from './profiles/SM00.json' with { type: 'json' };

export const SPATIAL_MODES = Object.freeze([
  {id: 'inside', label: 'Inside the map'},
  {id: 'behind-wall', label: 'Behind TV wall'},
  {id: 'crt-only', label: 'CRT only'}
]);

const finitePair = pair => Array.isArray(pair) && pair.length === 2 && pair.every(Number.isFinite);
const finiteTriple = xyz => Array.isArray(xyz) && xyz.length === 3 && xyz.every(Number.isFinite);
export function validateSpatialProfile(data) {
  if (data?.version !== 1 || data.coordinateSpace !== 'rdx-world-px' ||
      !Number.isInteger(data.submap) || !Number.isInteger(data.mapId) ||
      data.plane !== 'B' || !finitePair(data.anchors?.upperLeft) ||
      !finitePair(data.anchors?.lowerLeft)) throw new TypeError('Invalid RDX spatial profile');
  const strip = data.upstairsTop;
  if (!strip || ![strip.xMin,strip.xMaxExclusive,strip.y,strip.tolerancePx].every(Number.isFinite) ||
      strip.xMin >= strip.xMaxExclusive || strip.tolerancePx < 0 || strip.tolerancePx > 4)
    throw new TypeError('Invalid upstairs contact strip');
  for (const mode of ['inside','behind-wall']) {
    const p = data.profiles?.[mode];
    if (!p || !finitePair(p.originPx) || !finiteTriple(p.originMetres) ||
        !finitePair(p.metresPerPixel) || p.metresPerPixel.some(v=>!v) ||
        !Number.isFinite(p.lowpassHz) || p.lowpassHz <= 0 ||
        !Number.isFinite(p.gain) || p.gain < 0 || p.gain > 1 ||
        !Number.isFinite(p.lampImpact)) throw new TypeError(`Invalid spatial calibration: ${mode}`);
  }
  return data;
}
const authoredSM00 = validateSpatialProfile(SM00);
export function selectSpatialProfile(submap, mode) {
  if (submap !== authoredSM00.submap || !['inside','behind-wall'].includes(mode))
    return {id:'default:crt-only',submap,mode:'crt-only',coordinateSpace:'none',data:null,calibration:null};
  return {id:`SM00:${mode}`,submap,mode,coordinateSpace:authoredSM00.coordinateSpace,
    data:authoredSM00,calibration:authoredSM00.profiles[mode]};
}

/** Pure projection: source positions are RDX whole-room points, not screen pixels. */
export class SpatialProjector {
  constructor(selected) { this.selected = selected; }
  project(point) {
    const c=this.selected.calibration;
    if (!c || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return null;
    return {
      x:c.originMetres[0]+(point.x-c.originPx[0])*c.metresPerPixel[0],
      y:c.originMetres[1]+(point.y-c.originPx[1])*c.metresPerPixel[1],
      z:c.originMetres[2]
    };
  }
  inverse(point) {
    const c=this.selected.calibration;
    if (!c || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return null;
    return {x:c.originPx[0]+(point.x-c.originMetres[0])/c.metresPerPixel[0],
      y:c.originPx[1]+(point.y-c.originMetres[1])/c.metresPerPixel[1]};
  }
  classify(event) {
    if (!this.selected.calibration || event?.submap!==this.selected.submap ||
        event.coordinateSpace!=='rdx-world' || !event.world) return null;
    if (event.kind==='player.footstep') {
      const strip=this.selected.data.upstairsTop;
      if (!event.supportedContact || event.world.x < strip.xMin ||
          event.world.x >= strip.xMaxExclusive ||
          Math.abs(event.world.y-strip.y) > strip.tolerancePx) return null;
      return 'footstep';
    }
    if (event.kind==='world.boulder.impact') return event.supportedContact ? 'impact' : null;
    if (event.kind==='enemy.died') return 'death';
    return null;
  }
}
