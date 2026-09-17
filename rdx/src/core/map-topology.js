function integer(value) { return Number.isInteger(Number(value)); }

export function normalizeMapTopology(topology) {
  if (!topology) return null;
  const raw = Array.isArray(topology.rawVisualSize) ? topology.rawVisualSize.map(Number) : [];
  const effective = Array.isArray(topology.effectiveVisualSize) ? topology.effectiveVisualSize.map(Number) : [];
  const slices = (topology.slices || []).map(row => Object.freeze({
    id:String(row.id || ''), sourceY:Number(row.sourceY), targetY:Number(row.targetY), height:Number(row.height)
  })).sort((a,b)=>a.targetY-b.targetY || a.sourceY-b.sourceY);
  if (raw.length !== 2 || effective.length !== 2 || [...raw,...effective].some(value => !integer(value) || value <= 0))
    throw new Error('RDX map topology requires positive integer raw/effective visual sizes');
  if (raw[0] !== effective[0]) throw new Error('RDX map topology may not change room width');
  let cursor=0;
  for (const row of slices) {
    if (![row.sourceY,row.targetY,row.height].every(integer) || row.sourceY < 0 || row.targetY !== cursor || row.height <= 0 || row.sourceY + row.height > raw[1])
      throw new Error(`Invalid RDX map topology slice ${row.id || '<unnamed>'}`);
    cursor += row.height;
  }
  if (!slices.length || cursor !== effective[1]) throw new Error(`RDX map topology covers ${cursor}px, expected ${effective[1]}px`);
  return Object.freeze({
    id:String(topology.id || ''), rawVisualSize:Object.freeze(raw), effectiveVisualSize:Object.freeze(effective),
    granularityPx:Number(topology.granularityPx || 8), collisionPolicy:String(topology.collisionPolicy || 'copy-source-descriptors'), slices:Object.freeze(slices)
  });
}

export function topologySourceY(topologyValue, targetYValue) {
  const topology=normalizeMapTopology(topologyValue);
  const targetY=Number(targetYValue);
  if (!topology) return targetY;
  for (const row of topology.slices) if (targetY >= row.targetY && targetY < row.targetY + row.height)
    return row.sourceY + targetY - row.targetY;
  return null;
}

export function topologyTargetYs(topologyValue, sourceYValue) {
  const topology=normalizeMapTopology(topologyValue);
  const sourceY=Number(sourceYValue);
  if (!topology) return Object.freeze([sourceY]);
  const out=[];
  for (const row of topology.slices) if (sourceY >= row.sourceY && sourceY < row.sourceY + row.height)
    out.push(row.targetY + sourceY - row.sourceY);
  return Object.freeze(out);
}

export function effectiveMapDimensions(rawDimensions, topologyValue) {
  const topology=normalizeMapTopology(topologyValue);
  if (!topology) return { ...rawDimensions };
  if (Number(rawDimensions?.width) !== topology.rawVisualSize[0] || Number(rawDimensions?.height) !== topology.rawVisualSize[1])
    throw new Error(`RDX topology raw dimensions ${topology.rawVisualSize.join('x')} disagree with decoder ${rawDimensions?.width}x${rawDimensions?.height}`);
  return {
    ...rawDimensions,
    cellWidth:topology.effectiveVisualSize[0] / 16,
    cellHeight:topology.effectiveVisualSize[1] / 16,
    width:topology.effectiveVisualSize[0], height:topology.effectiveVisualSize[1],
    source:`${rawDimensions?.source || 'RDX'} + reviewed topology splice`
  };
}

export function projectDescriptorRoom({ dimensions, logic, mt, ml }, topologyValue) {
  const topology=normalizeMapTopology(topologyValue);
  if (!topology) return { dimensions:{...dimensions}, logic:{...logic}, mt:new Uint8Array(mt), ml:new Uint8Array(ml) };
  const effective=effectiveMapDimensions(dimensions, topology);
  const rawLogicWidth=Number(logic?.width), rawLogicHeight=Number(logic?.height);
  if (!integer(rawLogicWidth) || !integer(rawLogicHeight) || rawLogicWidth <= 0 || rawLogicHeight <= 1 || mt.length !== rawLogicWidth*rawLogicHeight || ml.length !== mt.length)
    throw new Error('Invalid raw RDX descriptor room for topology projection');
  const effectiveCellHeight=effective.height / 16;
  const logicHeight=effectiveCellHeight + 2;
  const outMt=new Uint8Array(rawLogicWidth * logicHeight), outMl=new Uint8Array(rawLogicWidth * logicHeight);
  const copyRow=(dst,src,projectVisualRow=false) => {
    outMt.set(mt.subarray(src*rawLogicWidth,(src+1)*rawLogicWidth),dst*rawLogicWidth);
    outMl.set(ml.subarray(src*rawLogicWidth,(src+1)*rawLogicWidth),dst*rawLogicWidth);
    if (projectVisualRow && topology.collisionPolicy === 'copy-source-descriptors-except-exits') {
      for (let x=0;x<rawLogicWidth;x+=1) {
        const index=dst*rawLogicWidth+x;
        if ((outMt[index] & 0x80) && outMl[index] === 0x14) { outMt[index]=0; outMl[index]=0; }
      }
    }
  };
  copyRow(0,0);
  for (let targetCellY=0; targetCellY<effectiveCellHeight; targetCellY+=1) {
    const sourceY=topologySourceY(topology,targetCellY*16);
    if (sourceY == null || sourceY % 16) throw new Error(`Topology target row ${targetCellY} does not map to a 16px descriptor row`);
    const sourceCellY=sourceY/16;
    if (sourceCellY < 0 || sourceCellY >= Number(dimensions.cellHeight)) throw new Error(`Topology source row ${sourceCellY} outside raw visual room`);
    copyRow(targetCellY+1,sourceCellY+1,true);
  }
  copyRow(logicHeight-1,rawLogicHeight-1);
  return { dimensions:effective, logic:{width:rawLogicWidth,height:logicHeight}, mt:outMt, ml:outMl };
}

export function projectCollisionGrid(room, topologyValue) {
  const topology=normalizeMapTopology(topologyValue);
  if (!topology || !room) return room;
  const width=Number(room.width), rawHeight=Number(room.height), effectiveHeight=topology.effectiveVisualSize[1]/8;
  if (width*8 !== topology.rawVisualSize[0] || rawHeight*8 !== topology.rawVisualSize[1])
    throw new Error(`Collision grid ${width}x${rawHeight} disagrees with topology ${topology.rawVisualSize.join('x')}`);
  const contacts=new Uint16Array(width*effectiveHeight), verified=new Uint16Array(width*effectiveHeight);
  const hasEvidence=room.evidence instanceof Uint32Array;
  const evidence=hasEvidence ? new Uint32Array(width*effectiveHeight) : room.evidence;
  for (let ty=0;ty<effectiveHeight;ty+=1) {
    const sy=topologySourceY(topology,ty*8);
    if (sy == null || sy%8) throw new Error(`Topology collision row ${ty} is not 8px aligned`);
    const sourceRow=sy/8;
    contacts.set(room.contacts.subarray(sourceRow*width,(sourceRow+1)*width),ty*width);
    verified.set(room.verified.subarray(sourceRow*width,(sourceRow+1)*width),ty*width);
    if (hasEvidence) evidence.set(room.evidence.subarray(sourceRow*width,(sourceRow+1)*width),ty*width);
  }
  return Object.freeze({
    ...room,width,height:effectiveHeight,widthPx:width*8,heightPx:effectiveHeight*8,contacts,verified,evidence
  });
}
