function samplePoint(sample) {
  const value = Array.isArray(sample?.origin) ? sample.origin : sample?.draw;
  if (!Array.isArray(value) || value.length < 2) return null;
  const x = Number(value[0]), y = Number(value[1]);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

function samePoint(a, b) {
  return !!a && !!b && Number(a[0]) === Number(b[0]) && Number(a[1]) === Number(b[1]);
}

function timelineSamples(record) {
  if (Array.isArray(record?.auditSamples) && record.auditSamples.length > 1)
    return { samples: record.auditSamples, period: Number(record.auditPeriod || 0), authority: 'native-runtime-evidence-audit' };
  if (Array.isArray(record?.samples) && record.samples.length > 1)
    return { samples: record.samples, period: Number(record.trackPeriod || 0), authority: 'native-runtime-evidence-track' };
  return null;
}

/**
 * Build a scrub model from an authority-backed source record. Records may come
 * from live native session evidence or deterministic normalized Layer-B
 * controller data; the timeline never infers a controller from screen-space
 * samples. Stationary runs become explicit stop markers.
 */
export function sourceTimelineModel(record) {
  const source = timelineSamples(record);
  if (!source) return null;
  const rows = source.samples
    .map((sample, index) => ({
      tick: Math.max(0, Number(sample.phase ?? index) | 0),
      duration: Math.max(1, Number(sample.duration || 1) | 0),
      point: samplePoint(sample)
    }))
    .filter(row => row.point);
  if (rows.length < 2) return null;
  const moved = rows.some((row, index) => index > 0 && !samePoint(row.point, rows[index - 1].point));
  if (!moved) return null;
  const inferredEnd = Math.max(...rows.map(row => row.tick + row.duration));
  const period = Math.max(1, source.period || inferredEnd);
  const loopStart = Math.max(0, Number(record?.trajectoryLoopStart) | 0);
  const loopPeriod = Math.max(0, Number(record?.trajectoryLoopPeriod) | 0);
  const stops = [];
  let start = 0;
  while (start < rows.length) {
    let end = start;
    while (end + 1 < rows.length && samePoint(rows[end + 1].point, rows[start].point)) end += 1;
    const spanStart = rows[start].tick;
    const spanEnd = rows[end].tick + rows[end].duration;
    if (spanEnd - spanStart >= 2 || start === 0) {
      stops.push(Object.freeze({ tick: spanStart, endTick: spanEnd, origin: Object.freeze(rows[start].point.slice()) }));
    }
    start = end + 1;
  }
  const points = [];
  for (const row of rows) if (!points.length || !samePoint(points[points.length - 1], row.point)) points.push(Object.freeze(row.point.slice()));
  return Object.freeze({
    period,
    maxTick: period,
    loopStart: loopPeriod > 0 && loopStart < period ? loopStart : null,
    loopPeriod: loopPeriod > 0 && loopStart < period ? loopPeriod : null,
    authority: source.authority,
    stops: Object.freeze(stops),
    points: Object.freeze(points)
  });
}

export function sourceTimelineTick(model, tick) {
  if (!model) return 0;
  const value = Math.max(0, Math.round(Number(tick || 0)));
  const max = Math.max(0, Number(model.maxTick || 0));
  if (value <= max) return value;
  const loopStart = Number(model.loopStart), loopPeriod = Number(model.loopPeriod);
  if (Number.isFinite(loopStart) && loopStart >= 0 && Number.isFinite(loopPeriod) && loopPeriod > 0)
    return loopStart + ((value - loopStart) % loopPeriod + loopPeriod) % loopPeriod;
  return max;
}
