import { GAMEPLAY_MASK } from '../collision/descriptor-semantics.js';

const hex = (value, width = 2) => Number.isFinite(Number(value))
  ? `0x${(Number(value) >>> 0).toString(16).padStart(width, '0')}`
  : '—';

function semanticDivergence(cell) {
  const p = cell?.provenance;
  const classic = p?.classicComparison;
  if (!classic?.inBounds || cell?.visualSource !== 'rdx') return '';
  const rdxFlags = Number(cell.flags || 0) & GAMEPLAY_MASK;
  const classicFlags = Number(classic.flags || 0) & GAMEPLAY_MASK;
  if (rdxFlags === classicFlags) return '';
  return `DIVERGENCE: RDX ${cell.kindName || cell.kind || 'open'} (${hex(rdxFlags)}) vs Classic ${classic.kindName || classic.kind || 'open'} (${hex(classicFlags)}).`;
}

function assetText(source) {
  if (!source) return 'source unavailable';
  const romStart = Number.isFinite(Number(source.romOffset)) ? hex(source.romOffset, 6) : '—';
  const payload = source.payloadIndex == null ? 'payload start' : `decoded[${source.payloadIndex}]`;
  if (source.flags === 0x0002) return `${source.name} dir#${source.ordinal} ZX0 · ROM ${romStart}+${source.storedLength} -> ${payload}`;
  if (source.flags === 0) {
    const byte = source.absoluteRomOffset == null ? `ROM ${romStart}` : `ROM ${hex(source.absoluteRomOffset, 6)}`;
    return `${source.name} dir#${source.ordinal} raw · ${byte}`;
  }
  return `${source.name} dir#${source.ordinal} flags=${hex(source.flags, 4)} · ROM ${romStart} -> ${payload}`;
}

function layerText(layer) {
  if (!layer) return 'unavailable';
  if (layer.allowed === false) return `disabled (${layer.reason || 'overlay rule'})`;
  const word = hex(layer.word, 4);
  if (layer.transparent && Number(layer.word || 0) === 0) return `${assetText(layer.asset)} · record ${layer.recordIndex} q${layer.quadrant} word=${word} · transparent`;
  const resolution = layer.resolution
    ? `${layer.resolution.kind}${layer.resolution.globalTile != null ? ` globalTile=${layer.resolution.globalTile}` : ''}${layer.resolution.localIndex != null ? ` localIndex=${layer.resolution.localIndex}` : ''}${layer.resolution.recordIndex != null ? ` MI#${layer.resolution.recordIndex}/frame${layer.resolution.frameIndex}` : ''}`
    : 'unresolved pattern';
  const sources = [
    layer.indexSource ? `index ${assetText(layer.indexSource)}` : '',
    layer.patternSource ? `pattern ${assetText(layer.patternSource)}` : '',
    layer.graphicsSource ? `graphics ${assetText(layer.graphicsSource)}` : ''
  ].filter(Boolean).join(' · ');
  return `${assetText(layer.asset)} · record ${layer.recordIndex} q${layer.quadrant} word=${word} tile=${Number(layer.rawIndex ?? 0)} pal=${Number(layer.paletteLine ?? 0)} hflip=${!!layer.hFlip} vflip=${!!layer.vFlip} · ${resolution}${sources ? ` · ${sources}` : ''}`;
}

function projectionReason(cell) {
  const p = cell?.provenance;
  const projection = p?.projection;
  if (!projection) return '';
  const mt = Number(p?.descriptor?.mt ?? 0) & 0xff;
  const ml = Number(p?.descriptor?.ml ?? 0) & 0xff;
  const qx = Number(p?.coordinate?.quadrant?.x ?? 0) & 1;
  const qy = Number(p?.coordinate?.quadrant?.y ?? 0) & 1;
  switch (projection.source) {
    case 'classic-correspondence': {
      const mask = Array.isArray(projection.correspondenceMask) ? projection.correspondenceMask : [];
      const quadrant = qy * 2 + qx;
      const maskText = mask.length === 4 ? `[${mask.map(value => hex(Number(value) & GAMEPLAY_MASK)).join(', ')}]` : 'unavailable';
      return `RDX MT/ML still owns feature identity and live state; the exact aligned Classic 2×2 mask ${maskText} is high-confidence correspondence evidence; qx=${qx}, qy=${qy} selects quadrant ${quadrant} (${hex(mask[quadrant])}).`;
    }
    case 'ml-lethal':
      return `MT bit7 selects ML special semantics; ML=${hex(ml)} is lethal; qy=${qy} ${qy ? 'adds LETHAL' : 'keeps the upper half open'}; qx=${qx} is not consulted, so both horizontal 8px halves inherit the same result.`;
    case 'mt-one-way':
      return `MT mode=3 is one-way; qy=${qy} ${qy ? 'keeps the lower half open' : 'adds WAYUP'}; qx=${qx} is not consulted.`;
    case 'ml19-ladder-head':
      return `ML=${hex(ml)} is a ladder head; qy=${qy} selects ${qy ? 'CLIMB' : 'VERT'}; qx=${qx} is not consulted.`;
    case 'fallback-mode2':
    case 'fallback-special':
      return `RDX descriptor is unresolved by the shared projection; final gameplay flags come from the mapped Classic cell (${hex(p?.classicComparison?.flags)}).`;
    default:
      return `Projection ${projection.source}; MT=${hex(mt)} ML=${hex(ml)} qy=${qy}; qx=${qx} does not participate in current descriptor semantics.`;
  }
}

function semanticLabel(kind, flags) {
  return `${String(kind || 'open').toUpperCase()} ${hex(flags & GAMEPLAY_MASK)}`;
}

function sourceNode(label, source, value = '') {
  return {
    label,
    value:value || source?.name || 'unavailable',
    detail:source ? assetText(source) : 'source unavailable'
  };
}

export function geometryProvenanceViewModel(cell) {
  if (!cell) return null;
  const p = cell.provenance || {};
  const c = p.coordinate || {};
  const projection = p.projection || null;
  const classic = p.classicComparison || null;
  const descriptor = p.descriptor || {};
  const visual = p.visual || null;
  const rdxFlags = Number(cell.flags || 0) & GAMEPLAY_MASK;
  const classicFlags = Number(classic?.flags || 0) & GAMEPLAY_MASK;
  const divergent = cell.visualSource === 'rdx' && !!classic?.inBounds && rdxFlags !== classicFlags;
  const projectionWhy = projectionReason(cell);

  if (cell.visualSource === 'classic') {
    const classicSource = p.classic || {};
    return {
      id:cell.id,
      source:'classic',
      divergent:false,
      headline:{ badge:'CLASSIC', title:semanticLabel(cell.kindName || cell.kind, rdxFlags), detail:'Classic generated 8×8 gameplay flags are authoritative for this view.' },
      collision:[
        { label:'Classic 8×8 cell', value:`g8 ${c.grid8?.x ?? '—'},${c.grid8?.y ?? '—'}`, detail:`center ${c.pixelCenter?.x ?? '—'},${c.pixelCenter?.y ?? '—'}` },
        { label:'Generated room flags', value:`flags[${classicSource.index ?? '—'}] = ${hex(classicSource.flags)}`, detail:classicSource.kindName || cell.kindName || 'open', tone:'result' }
      ],
      classic:[], visual:null, raw:formatGeometryProvenance(cell)
    };
  }

  const v = c.visual16 || {};
  const q = c.quadrant || {};
  const logic = c.romLogic || {};
  const classicOffset = classic?.pixelOffset || { dxPx:0, dyPx:0 };
  const projectionValue = projection
    ? `${projection.source} → ${semanticLabel(projection.kindName || cell.kindName || cell.kind, projection.flags || 0)}`
    : 'projection unavailable';
  const divergenceTitle = divergent
    ? `RDX ${semanticLabel(cell.kindName || cell.kind, rdxFlags)} ≠ Classic ${semanticLabel(classic?.kindName || classic?.kind, classicFlags)}`
    : classic?.inBounds
      ? `RDX and Classic agree: ${semanticLabel(cell.kindName || cell.kind, rdxFlags)}`
      : semanticLabel(cell.kindName || cell.kind, rdxFlags);
  const suspect = divergent && projectionWhy ? projectionWhy : '';

  const collision = [
    { label:'Selected RDX cell', value:`g8 ${c.grid8?.x ?? '—'},${c.grid8?.y ?? '—'}`, detail:`pixel center ${c.pixelCenter?.x ?? '—'},${c.pixelCenter?.y ?? '—'}` },
    { label:'16×16 descriptor owner', value:`cell ${v.x ?? '—'},${v.y ?? '—'} · ${q.label || `q${q.index ?? '—'}`}`, detail:`cell #${v.index ?? '—'} · qx=${q.x ?? '—'} qy=${q.y ?? '—'} · owns g8 x={${Number(v.x ?? 0)*2},${Number(v.x ?? 0)*2+1}} y={${Number(v.y ?? 0)*2},${Number(v.y ?? 0)*2+1}}` },
    { label:'Bordered ROM logic', value:`${logic.x ?? '—'},${logic.y ?? '—'} · #${logic.index ?? '—'}`, detail:`visual +1,+1 border · ${logic.width ?? '—'}×${logic.height ?? '—'} logic grid` },
    { label:'MT / ML descriptor', value:`MT ${hex(descriptor.mt)} · ML ${hex(descriptor.ml)}`, detail:`${descriptor.mtSource?.name || 'MT source unavailable'} · ${descriptor.mlSource?.name || 'ML source unavailable'}`, sources:[sourceNode('MT source', descriptor.mtSource), sourceNode('ML source', descriptor.mlSource)] },
    { label:'Shared semantic projection', value:projectionValue, detail:projectionWhy, tone:divergent ? 'suspect' : 'transform' },
    { label:'RDX gameplay result', value:semanticLabel(cell.kindName || cell.kind, rdxFlags), detail:`MAP_EFLG=${hex(rdxFlags)}`, tone:'result' }
  ];

  const classicPath = classic ? [
    { label:'Coordinate mapping', value:`offset ${classicOffset.dxPx ?? 0},${classicOffset.dyPx ?? 0}`, detail:`RDX center ${classic.rdxCenter?.x ?? c.pixelCenter?.x ?? '—'},${classic.rdxCenter?.y ?? c.pixelCenter?.y ?? '—'} → ${classic.mappedPixel?.x ?? '—'},${classic.mappedPixel?.y ?? '—'}` },
    { label:'Classic 8×8 cell', value:classic.inBounds ? `g8 ${classic.grid?.x ?? '—'},${classic.grid?.y ?? '—'}` : 'outside Classic room', detail:classic.inBounds ? 'mapped comparison cell' : 'mapping leaves room bounds' },
    { label:'Classic gameplay result', value:semanticLabel(classic.kindName || classic.kind, classicFlags), detail:`MAP_EFLG=${hex(classicFlags)}`, tone:divergent ? 'compare' : 'result' }
  ] : [];

  const visualTree = visual ? {
    summary:`${visual.mdSource?.name || 'MD source'} cell #${visual.cellIndex ?? '—'} → NT base record ${visual.baseRecord ?? '—'}`,
    note:'Reference only — visual tiles do not define collision semantics.',
    nodes:[
      sourceNode('MD map source', visual.mdSource, `${visual.mdSource?.name || 'MD'} · cell #${visual.cellIndex ?? '—'} · phase ${visual.phase ?? 0}`),
      { label:'Plane B', value:visual.background?.transparent ? 'transparent' : `${visual.background?.asset?.name || 'NT'} record ${visual.background?.recordIndex ?? '—'} · q${visual.background?.quadrant ?? '—'} · tile ${visual.background?.rawIndex ?? '—'}`, detail:layerText(visual.background) },
      { label:'Plane A', value:visual.overlayAllowed ? (visual.foreground?.transparent ? 'transparent overlay' : `${visual.foreground?.asset?.name || 'NT'} record ${visual.foreground?.recordIndex ?? '—'} · q${visual.foreground?.quadrant ?? '—'} · tile ${visual.foreground?.rawIndex ?? '—'}`) : 'overlay disabled', detail:visual.overlayAllowed ? layerText(visual.foreground) : 'disabled by MT bit 0x20' }
    ]
  } : null;

  return {
    id:cell.id,
    source:'rdx',
    divergent,
    headline:{
      badge:divergent ? 'DIVERGENCE' : 'MATCH',
      title:divergenceTitle,
      detail:divergent ? 'Collision semantics disagree at the mapped Classic comparison cell.' : 'No RDX/Classic gameplay-semantic discrepancy at this mapped cell.',
      suspect
    },
    collision,
    classic:classicPath,
    visual:visualTree,
    editorOverride:p.editorOverride || null,
    raw:formatGeometryProvenance(cell)
  };
}

export function formatGeometryProvenance(cell) {
  if (!cell) return '';
  const p = cell.provenance || {};
  const c = p.coordinate || {};
  const lines = [`${cell.id}  [${String(cell.kindName || cell.kind || 'open').toUpperCase()}] flags=${hex(cell.flags)}`];
  if (p.authority) lines.push(`Authority: ${p.authority}`);

  if (cell.visualSource === 'classic') {
    const classic = p.classic || {};
    if (c.grid8) lines.push(`Coordinate: Classic g8 (${c.grid8.x},${c.grid8.y}) · center (${c.pixelCenter?.x},${c.pixelCenter?.y})`);
    if (classic.index != null) lines.push(`Source: generated Classic room flags[${classic.index}] = ${hex(classic.flags)} (${classic.kindName || 'open'})`);
    return lines.join('\n');
  }

  if (c.grid8) {
    const v = c.visual16 || {};
    const q = c.quadrant || {};
    const logic = c.romLogic || {};
    lines.push(`Coordinates: RDX g8 (${c.grid8.x},${c.grid8.y}) · center (${c.pixelCenter?.x},${c.pixelCenter?.y})`);
    lines.push(`  -> visual 16×16 cell (${v.x},${v.y}) #${v.index} · quadrant ${q.label || q.index} (qx=${q.x}, qy=${q.y})`);
    if (Number.isFinite(Number(v.x)) && Number.isFinite(Number(v.y))) {
      lines.push(`  -> 8px fan-out g8 x={${Number(v.x) * 2},${Number(v.x) * 2 + 1}} y={${Number(v.y) * 2},${Number(v.y) * 2 + 1}} before 8px microgeometry selection`);
    }
    lines.push(`  -> bordered ROM logic cell (${logic.x},${logic.y}) #${logic.index} of ${logic.width}×${logic.height} (visual cell +1,+1 border)`);
  }

  const descriptor = p.descriptor || {};
  if (descriptor.mtSource || descriptor.mlSource) {
    lines.push(`Collision source: MT=${hex(descriptor.mt)} · ${assetText(descriptor.mtSource)}`);
    lines.push(`                  ML=${hex(descriptor.ml)} · ${assetText(descriptor.mlSource)}`);
  }
  if (p.projection) {
    lines.push(`Projection: ${p.projection.source} · known=${!!p.projection.known} -> MAP_EFLG=${hex(p.projection.flags)} (${p.projection.kindName || cell.kindName || 'open'})`);
    const why = projectionReason(cell); if (why) lines.push(`  ${why}`);
  }

  const classic = p.classicComparison;
  if (classic) {
    const offset = classic.pixelOffset || { dxPx:0, dyPx:0 };
    if (classic.inBounds) {
      lines.push(`Classic comparison: RDX center - mapping offset (${offset.dxPx},${offset.dyPx}) -> Classic g8 (${classic.grid.x},${classic.grid.y}) = ${hex(classic.flags)} (${classic.kindName || 'open'})`);
    } else {
      lines.push(`Classic comparison: mapped point is outside the Classic room after offset (${offset.dxPx},${offset.dyPx}); fallback flags=${hex(classic.flags)}.`);
    }
    const divergence = semanticDivergence(cell); if (divergence) lines.push(divergence);
  }

  const visual = p.visual;
  if (visual) {
    lines.push(`Visual source: ${assetText(visual.mdSource)} · cell #${visual.cellIndex} -> NT base record ${visual.baseRecord} · phase ${visual.phase ?? 0}`);
    lines.push(`  Plane B: ${layerText(visual.background)}`);
    lines.push(`  Plane A: ${visual.overlayAllowed ? `enabled by MT bit 0x20; ${layerText(visual.foreground)}` : 'disabled by MT bit 0x20'}`);
  }

  if (p.editorOverride) lines.push(`Map Editor draft override: ${JSON.stringify(p.editorOverride)}`);
  return lines.join('\n');
}

export function geometryProvenanceClipboard(cells, context = {}) {
  return JSON.stringify({
    schema:'rdx.geometry_provenance.v1',
    room:{ ...context },
    cells:(cells || []).map(cell => ({
      id:cell.id,
      visualSource:cell.visualSource,
      flags:Number(cell.flags || 0) & 0xff,
      kind:cell.kind,
      kindName:cell.kindName,
      provenance:cell.provenance || null
    }))
  }, null, 2);
}
