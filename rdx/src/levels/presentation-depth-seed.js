import { normalizeMapTopology, topologySourceY } from '../core/map-topology.js';

/* Offline bootstrap for Plane-B presentation depth. The luminance classifier is
 * allowed to run only while extracting generated source data. Runtime/editor
 * composition consumes the resulting explicit 8x8 baseline bitset. */
const clamp = (value, min=0, max=1) => Math.max(min, Math.min(max, Number(value) || 0));
const OPEN_SCORE_THRESHOLD = 0.69;
export const PRESENTATION_DEPTH_SEED_BASELINE_SCHEMA = 'rdr.presentation_depth_seed_baseline.v1';
const baselineBytes = new WeakMap();
const normalizedBaselineCache = new WeakMap();

function tilePixelIndex(tileBytes, x, y, { hFlip=false, vFlip=false } = {}) {
  if (!tileBytes || x < 0 || y < 0 || x >= 8 || y >= 8) return 0;
  const sx = hFlip ? 7 - x : x;
  const sy = vFlip ? 7 - y : y;
  const byte = tileBytes[sy * 4 + (sx >> 1)] ?? 0;
  return (sx & 1) ? (byte & 0x0f) : (byte >> 4);
}

function tileStats(source, x0, y0, mask = null) {
  let count=0, sum=0, dark=0, bright=0, min=1, max=0;
  for (let y=y0; y<Math.min(source.height,y0+8); y++) {
    for (let x=x0; x<Math.min(source.width,x0+8); x++) {
      if (mask && !mask[(y - y0) * 8 + (x - x0)]) continue;
      const i=(y*source.width+x)*4;
      if (!source.data[i+3]) continue;
      const luma=(source.data[i]*0.2126 + source.data[i+1]*0.7152 + source.data[i+2]*0.0722)/255;
      count++; sum+=luma; if(luma<0.22)dark++; if(luma>0.72)bright++; min=Math.min(min,luma); max=Math.max(max,luma);
    }
  }
  const mean=count?sum/count:0;
  return Object.freeze({count,mean,darkRatio:count?dark/count:1,brightRatio:count?bright/count:0,contrast:count?max-min:0});
}

function bitBytesFromHex(hex, cellCount) {
  const text=String(hex||'').toLowerCase();
  const expected=Math.ceil(Number(cellCount)/8);
  if (!/^[0-9a-f]*$/.test(text) || text.length!==expected*2) throw new Error(`Presentation depth seed baseline requires ${expected} bytes of backdrop bits`);
  const bytes=new Uint8Array(expected);
  for(let i=0;i<expected;i++)bytes[i]=Number.parseInt(text.slice(i*2,i*2+2),16);
  return bytes;
}

function bytesForBaseline(baseline) {
  let bytes=baselineBytes.get(baseline);
  if(!bytes){bytes=bitBytesFromHex(baseline.backdropBits,baseline.gridWidth*baseline.gridHeight);baselineBytes.set(baseline,bytes);}
  return bytes;
}

function hexFromBytes(bytes) { return [...bytes].map(value=>Number(value).toString(16).padStart(2,'0')).join(''); }
function bitAt(bytes,index) { return !!(bytes[index>>3] & (1<<(index&7))); }
function setBit(bytes,index) { bytes[index>>3] |= 1<<(index&7); }

export function normalizePresentationDepthSeedBaseline(input) {
  if(!input)return null;
  if(baselineBytes.has(input))return input;
  if(typeof input==='object'&&normalizedBaselineCache.has(input))return normalizedBaselineCache.get(input);
  if(input.schema!==PRESENTATION_DEPTH_SEED_BASELINE_SCHEMA)throw new Error(`Expected ${PRESENTATION_DEPTH_SEED_BASELINE_SCHEMA}`);
  const gridWidth=Number(input.gridWidth),gridHeight=Number(input.gridHeight),openCellCount=Number(input.openCellCount);
  if(!Number.isInteger(gridWidth)||gridWidth<=0||!Number.isInteger(gridHeight)||gridHeight<=0)throw new Error('Presentation depth seed baseline requires positive integer grid dimensions');
  const bytes=bitBytesFromHex(input.backdropBits,gridWidth*gridHeight);
  let counted=0;for(let i=0;i<gridWidth*gridHeight;i++)if(bitAt(bytes,i))counted++;
  if(Number.isInteger(openCellCount)&&openCellCount!==counted)throw new Error(`Presentation depth seed baseline openCellCount ${openCellCount} disagrees with bitset ${counted}`);
  const normalized=Object.freeze({
    schema:PRESENTATION_DEPTH_SEED_BASELINE_SCHEMA,version:1,sourcePlane:'B',gridWidth,gridHeight,
    openCellCount:counted,backdropBits:String(input.backdropBits).toLowerCase(),
    authority:String(input.authority||'generated-open-close-seed-v2')
  });
  baselineBytes.set(normalized,bytes);
  if(typeof input==='object')normalizedBaselineCache.set(input,normalized);
  return normalized;
}

export function createPresentationDepthSeedBaseline(seed,{width=null,height=null}={}) {
  const gridWidth=Number(width ?? Math.max(0,...(seed?.cells||[]).map(row=>Number(row.gx)+1)));
  const gridHeight=Number(height ?? Math.max(0,...(seed?.cells||[]).map(row=>Number(row.gy)+1)));
  if(!Number.isInteger(gridWidth)||gridWidth<=0||!Number.isInteger(gridHeight)||gridHeight<=0)throw new Error('Presentation depth seed baseline requires positive integer dimensions');
  const bytes=new Uint8Array(Math.ceil(gridWidth*gridHeight/8));let openCellCount=0;
  for(const row of seed?.cells||[]){const gx=Number(row.gx),gy=Number(row.gy);if(!Number.isInteger(gx)||!Number.isInteger(gy)||gx<0||gy<0||gx>=gridWidth||gy>=gridHeight)continue;if(row.classification==='open'){setBit(bytes,gy*gridWidth+gx);openCellCount++;}}
  return normalizePresentationDepthSeedBaseline({schema:PRESENTATION_DEPTH_SEED_BASELINE_SCHEMA,version:1,sourcePlane:'B',gridWidth,gridHeight,openCellCount,backdropBits:hexFromBytes(bytes),authority:'generated-open-close-seed-v2'});
}

export function presentationDepthSeedBaselineAt(input,{x=null,y=null,gx=null,gy=null}={}) {
  const baseline=normalizePresentationDepthSeedBaseline(input);if(!baseline)return null;
  const targetGx=gx!==null&&gx!==undefined&&Number.isInteger(Number(gx))?Number(gx):Math.floor(Number(x)/8),targetGy=gy!==null&&gy!==undefined&&Number.isInteger(Number(gy))?Number(gy):Math.floor(Number(y)/8);
  if(!Number.isInteger(targetGx)||!Number.isInteger(targetGy)||targetGx<0||targetGy<0||targetGx>=baseline.gridWidth||targetGy>=baseline.gridHeight)return null;
  const open=bitAt(bytesForBaseline(baseline),targetGy*baseline.gridWidth+targetGx);
  return Object.freeze({gx:targetGx,gy:targetGy,classification:open?'open':'close',band:open?'backdrop':'midground'});
}

export function projectPresentationDepthSeedBaseline(input,topologyValue=null) {
  const baseline=normalizePresentationDepthSeedBaseline(input);if(!baseline)return null;
  const topology=normalizeMapTopology(topologyValue);if(!topology)return baseline;
  if(topology.rawVisualSize[0]!==baseline.gridWidth*8||topology.rawVisualSize[1]!==baseline.gridHeight*8)throw new Error(`Presentation depth seed baseline ${baseline.gridWidth*8}x${baseline.gridHeight*8} disagrees with topology ${topology.rawVisualSize.join('x')}`);
  const gridWidth=topology.effectiveVisualSize[0]/8,gridHeight=topology.effectiveVisualSize[1]/8;
  if(!Number.isInteger(gridWidth)||!Number.isInteger(gridHeight))throw new Error('Presentation depth topology must remain 8px aligned');
  const sourceBytes=bytesForBaseline(baseline),bytes=new Uint8Array(Math.ceil(gridWidth*gridHeight/8));let openCellCount=0;
  for(let gy=0;gy<gridHeight;gy++){
    const sourceY=topologySourceY(topology,gy*8);if(sourceY==null||sourceY%8)throw new Error(`Presentation depth topology row ${gy} is not 8px aligned`);const sourceGy=sourceY/8;
    for(let gx=0;gx<gridWidth;gx++)if(bitAt(sourceBytes,sourceGy*baseline.gridWidth+gx)){setBit(bytes,gy*gridWidth+gx);openCellCount++;}
  }
  return normalizePresentationDepthSeedBaseline({schema:PRESENTATION_DEPTH_SEED_BASELINE_SCHEMA,version:1,sourcePlane:'B',gridWidth,gridHeight,openCellCount,backdropBits:hexFromBytes(bytes),authority:`${baseline.authority}+${topology.id||'topology'}`});
}

export function presentationVisualIdentity(cell, plane='B') {
  const normalized=String(plane||'B').toUpperCase();
  const visual=normalized==='A' ? cell?.visual?.foreground : cell?.visual?.background;
  const globalTile=Number(visual?.resolution?.globalTile);
  const paletteLine=Number(visual?.paletteLine ?? visual?.resolution?.paletteLine);
  const patternIndex=Number(visual?.patternIndex ?? visual?.resolution?.patternIndex);
  if (Number.isInteger(globalTile)) return `${normalized}:g${globalTile}:p${Number.isInteger(paletteLine)?paletteLine:'?'}`;
  if (Number.isInteger(patternIndex)) return `${normalized}:pattern${patternIndex}:p${Number.isInteger(paletteLine)?paletteLine:'?'}`;
  return `${normalized}:unknown`;
}

export const planeBVisualIdentity = cell => presentationVisualIdentity(cell,'B');

export function planeBVisiblePixelMaskAt({ mapDecoder=null, mapId=0, gx=0, gy=0, phase=0, topology=null } = {}) {
  if (!mapDecoder?.inspectGridCell || !mapDecoder?.resolvePattern) return null;
  const cell = mapDecoder.inspectGridCell(Number(mapId), Number(gx), Number(gy), Number(phase), { topology }) || null;
  const background = cell?.visual?.background;
  if (!background?.allowed || background?.transparent || !Number.isInteger(Number(background?.rawIndex))) {
    return Object.freeze({ cell, mask:new Uint8Array(64), count:0 });
  }
  const backResolved = mapDecoder.resolvePattern(Number(mapId), Number(background.rawIndex), Number(phase)) || null;
  const foreground = cell?.visual?.foreground?.allowed ? cell.visual.foreground : null;
  const frontResolved = foreground && !foreground.transparent && Number.isInteger(Number(foreground.rawIndex))
    ? (mapDecoder.resolvePattern(Number(mapId), Number(foreground.rawIndex), Number(phase)) || null)
    : null;
  const mask = new Uint8Array(64);
  let count = 0;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const backIndex = tilePixelIndex(backResolved?.tileBytes || null, x, y, background);
      if (!backIndex) continue;
      const occluded = frontResolved && tilePixelIndex(frontResolved.tileBytes || null, x, y, foreground);
      if (occluded) continue;
      mask[y * 8 + x] = 1;
      count += 1;
    }
  }
  return Object.freeze({ cell, mask, count });
}

export function generatePresentationDepthSeed({source,mapDecoder=null,mapId=0,phase=0,topology=null,viewport={x:0,y:0},classificationBaseline=null}={}) {
  if (!source?.data) throw new Error('Presentation depth seed requires a rendered Plane-B source buffer');
  const baseline=classificationBaseline?normalizePresentationDepthSeedBaseline(classificationBaseline):null;
  const vx=Number(viewport?.x||0), vy=Number(viewport?.y||0);
  const gx0=Math.floor(vx/8), gy0=Math.floor(vy/8);
  const gx1=Math.ceil((vx+source.width)/8), gy1=Math.ceil((vy+source.height)/8);
  const drafts=[],rawOpen=new Set();
  for (let gy=gy0; gy<gy1; gy++) for (let gx=gx0; gx<gx1; gx++) {
    const sx=gx*8-vx, sy=gy*8-vy;
    if (sx<0 || sy<0 || sx>=source.width || sy>=source.height) continue;
    const visibility=planeBVisiblePixelMaskAt({ mapDecoder, mapId, gx, gy, phase, topology });
    const stats=tileStats(source,sx,sy,visibility?.mask || null);
    const openScore=stats.count ? clamp(stats.darkRatio*.58 + (1-stats.mean)*.32 + (1-stats.brightRatio)*.10) : 0;
    const baselineCell=baseline?presentationDepthSeedBaselineAt(baseline,{gx,gy}):null;
    const rawClassification=baselineCell?.classification || (openScore>=OPEN_SCORE_THRESHOLD?'open':'close');
    const confidence=clamp(Math.abs(openScore-OPEN_SCORE_THRESHOLD)/(1-OPEN_SCORE_THRESHOLD));
    if(rawClassification==='open')rawOpen.add(`${gx},${gy}`);
    const cell=visibility?.cell || mapDecoder?.inspectGridCell?.(Number(mapId),gx,gy,phase,{topology}) || null;
    drafts.push({gx,gy,stats,rawClassification,confidence,visualIdentity:presentationVisualIdentity(cell,'B')});
  }
  const cells=[],motifs=new Map();
  for(const draft of drafts){
    let classification=draft.rawClassification;
    if(!baseline&&classification==='open'){
      let neighborOpen=false;
      for(let dy=-1;dy<=1&&!neighborOpen;dy++)for(let dx=-1;dx<=1;dx++){
        if((dx||dy)&&rawOpen.has(`${draft.gx+dx},${draft.gy+dy}`)){neighborOpen=true;break;}
      }
      if(!neighborOpen)classification='close';
    }
    const row=Object.freeze({gx:draft.gx,gy:draft.gy,bounds:Object.freeze([draft.gx*8,draft.gy*8,8,8]),classification,suggestedBand:classification==='open'?'backdrop':'midground',confidence:draft.confidence,visualIdentity:draft.visualIdentity,stats:draft.stats});
    cells.push(row);
    const motif=motifs.get(draft.visualIdentity)||{visualIdentity:draft.visualIdentity,count:0,open:0,close:0,maxConfidence:0};
    motif.count++; motif[classification]++; motif.maxConfidence=Math.max(motif.maxConfidence,draft.confidence); motifs.set(draft.visualIdentity,motif);
  }
  return Object.freeze({schema:'rdr.presentation_depth_seed.v1',version:1,sourcePlane:'B',cells:Object.freeze(cells),motifs:Object.freeze([...motifs.values()].map(row=>Object.freeze(row))) });
}

export function presentationDepthSeedAt(seed,{x=null,y=null,gx=null,gy=null}={}) {
  const targetGx=gx!==null&&gx!==undefined&&Number.isInteger(Number(gx))?Number(gx):Math.floor(Number(x)/8);
  const targetGy=gy!==null&&gy!==undefined&&Number.isInteger(Number(gy))?Number(gy):Math.floor(Number(y)/8);
  return seed?.cells?.find(row=>row.gx===targetGx&&row.gy===targetGy) || null;
}
