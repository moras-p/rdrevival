const finite = value => Number.isFinite(Number(value));
const integer = value => Number.isInteger(Number(value));
const clamp = (value,min,max) => Math.max(min,Math.min(max,value));

function rect(x,y,width,height){return{x:Number(x),y:Number(y),width:Number(width),height:Number(height)}}
function intersects(a,b){return a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y}
function expand(r,amount){return rect(r.x-amount,r.y-amount,r.width+amount*2,r.height+amount*2)}
function toGridRect(bounds){return rect(Math.floor(bounds.x/8),Math.floor(bounds.y/8),Math.ceil(bounds.width/8),Math.ceil(bounds.height/8))}
function fromGridRect(bounds){return rect(bounds.x*8,bounds.y*8,bounds.width*8,bounds.height*8)}

export function smartScissorsBoundsFromPoints(start,end,{width,height}={}){
  if(!start||!end||!finite(start.x)||!finite(start.y)||!finite(end.x)||!finite(end.y))return null;
  const maxX=Math.max(8,Number(width)||8),maxY=Math.max(8,Number(height)||8);
  const x0=clamp(Math.floor(Math.min(Number(start.x),Number(end.x))/8)*8,0,maxX-8);
  const y0=clamp(Math.floor(Math.min(Number(start.y),Number(end.y))/8)*8,0,maxY-8);
  const x1=clamp(Math.floor(Math.max(Number(start.x),Number(end.x))/8)*8+8,x0+8,maxX);
  const y1=clamp(Math.floor(Math.max(Number(start.y),Number(end.y))/8)*8+8,y0+8,maxY);
  return Object.freeze(rect(x0,y0,x1-x0,y1-y0));
}

function visualForPlane(cell,plane){return plane==='A'?cell?.visual?.foreground:cell?.visual?.background}
function tileRows(bytes){
  if(!bytes||bytes.length!==32)return null;
  const rows=[];
  for(let y=0;y<8;y++){
    const row=[];
    for(let x=0;x<8;x++){
      const byte=bytes[y*4+(x>>1)]||0;
      row.push((x&1)?byte&0xf:byte>>4);
    }
    rows.push(row);
  }
  return rows;
}
function flipRows(rows,hFlip,vFlip){
  if(!rows)return null;
  let out=rows.map(row=>row.slice());
  if(hFlip)out=out.map(row=>row.slice().reverse());
  if(vFlip)out=out.slice().reverse();
  return out;
}
function descriptorKey(descriptor){
  if(!descriptor||descriptor.empty)return 'empty';
  return `${descriptor.globalTile}:${descriptor.paletteLine}:${descriptor.hFlip?1:0}:${descriptor.vFlip?1:0}`;
}
function descriptorMatches(a,b){return descriptorKey(a)===descriptorKey(b)}
function descriptorShapeKey(descriptor){return !descriptor||descriptor.empty?'0':'1'}
function cellDistance(a,b){
  if((!a||a.empty)&&(!b||b.empty))return 0;
  if(!a||!b||a.empty||b.empty)return 28;
  if(descriptorKey(a)===descriptorKey(b))return 0;
  const ar=a.rows,br=b.rows;
  if(!ar||!br)return 18;
  let diff=0;
  for(let y=0;y<8;y++)for(let x=0;x<8;x++)if(ar[y][x]!==br[y][x])diff+=1;
  if(a.paletteLine!==b.paletteLine)diff+=8;
  return diff/4;
}
function edgeValues(cell,side){
  if(!cell||cell.empty||!cell.rows)return new Array(8).fill(0);
  if(side==='left')return cell.rows.map(row=>row[0]);
  if(side==='right')return cell.rows.map(row=>row[7]);
  if(side==='top')return cell.rows[0].slice();
  return cell.rows[7].slice();
}
function edgeDistance(a,sideA,b,sideB){
  const aa=edgeValues(a,sideA),bb=edgeValues(b,sideB);let diff=0;
  for(let i=0;i<8;i++)if(aa[i]!==bb[i])diff+=1;
  return diff;
}

function semanticBoundsFromRoom(room){
  const out=[];
  const add=(bounds,kind)=>{if(Array.isArray(bounds)&&bounds.length>=4&&bounds.slice(0,4).every(finite)&&Number(bounds[2])>0&&Number(bounds[3])>0)out.push({bounds:rect(...bounds.slice(0,4).map(Number)),kind})};
  for(const object of room?.layers?.semanticCorpus?.objects||[]){
    add(object?.effective?.visualBounds,'semantic-visual');
    add(object?.effective?.gameplayBounds,'semantic-gameplay');
    add(object?.effective?.triggerBounds,'semantic-trigger');
  }
  for(const transition of room?.layers?.transitions?.rows||room?.layers?.transitions||[])add(transition?.bounds||transition?.effectiveBounds,'transition');
  return out;
}

export function smartScissorsSemanticBounds(resolvedRooms=[]){
  const result=new Map();
  for(const room of resolvedRooms||[])result.set(Number(room.mapId),semanticBoundsFromRoom(room));
  return result;
}

export class SmartScissorsMatcher{
  constructor({mapDecoder,rooms=[],resolvedRooms=[]}={}){
    if(!mapDecoder?.inspectGridCell||!mapDecoder?.resolveGlobalTile||!mapDecoder?.dimensions)throw new Error('Smart scissors requires an RDX map decoder');
    this.mapDecoder=mapDecoder;
    this.rooms=Array.isArray(rooms)?rooms:[];
    this.semanticByMap=smartScissorsSemanticBounds(resolvedRooms);
    this.cellCache=new Map();
    this.frequencyCache=new Map();
  }
  roomForMap(mapId){return this.rooms.find(row=>Number(row.mapId)===Number(mapId))||null}
  groupRooms(group){return this.rooms.filter(row=>String(row.group||'')===String(group||''))}
  cell(mapId,gx,gy,plane){
    const key=`${Number(mapId)}:${gx}:${gy}:${plane}`;if(this.cellCache.has(key))return this.cellCache.get(key);
    const dim=this.mapDecoder.dimensions(Number(mapId)),gridW=Math.ceil(dim.width/8),gridH=Math.ceil(dim.height/8);
    if(gx<0||gy<0||gx>=gridW||gy>=gridH){const empty=Object.freeze({empty:true,rows:null});this.cellCache.set(key,empty);return empty;}
    const cell=this.mapDecoder.inspectGridCell(Number(mapId),Number(gx),Number(gy),0),visual=visualForPlane(cell,plane);
    if(!visual?.allowed||visual.transparent||visual?.resolution?.globalTile==null){const empty=Object.freeze({empty:true,rows:null});this.cellCache.set(key,empty);return empty;}
    const globalTile=Number(visual.resolution.globalTile),resolved=this.mapDecoder.resolveGlobalTile(globalTile),rows=flipRows(tileRows(resolved?.tileBytes),!!visual.hFlip,!!visual.vFlip);
    const descriptor=Object.freeze({empty:false,globalTile,paletteLine:Number(visual.paletteLine||0),hFlip:!!visual.hFlip,vFlip:!!visual.vFlip,rows});
    this.cellCache.set(key,descriptor);return descriptor;
  }
  candidatePenalty(mapId,boundsPx){
    const rows=this.semanticByMap.get(Number(mapId))||[];
    let penalty=0,hits=[];
    for(const row of rows){if(intersects(boundsPx,row.bounds)){penalty+=45;hits.push(row.kind)}}
    return {penalty,hits};
  }
  normalizedTargetOverrides(rows=[]){
    if(rows instanceof Map)return rows;
    const out=new Map();
    for(const row of Array.isArray(rows)?rows:[]){
      const target=Array.isArray(row?.target)?row.target.map(Number):null,source=Array.isArray(row?.source)?row.source.map(Number):null,planes=Array.isArray(row?.planes)?row.planes:['B','A'];
      if(!target||target.length<2||!target.every(integer)||!source||source.length<2||!source.every(integer)||!integer(row?.sourceMapId))continue;
      for(const plane of planes.map(value=>String(value||'').toUpperCase()).filter(value=>value==='A'||value==='B'))out.set(`${target[0]}:${target[1]}:${plane}`,Object.freeze({sourceMapId:Number(row.sourceMapId),source:Object.freeze(source.slice(0,2))}));
    }
    return out;
  }
  targetCell(targetMapId,gx,gy,plane,targetOverrides=null){
    const override=targetOverrides?.get?.(`${gx}:${gy}:${plane}`);
    return override?this.cell(override.sourceMapId,override.source[0],override.source[1],plane):this.cell(targetMapId,gx,gy,plane);
  }
  frequencyStats(group,plane){
    const key=`${String(group||'')}:${plane}`;if(this.frequencyCache.has(key))return this.frequencyCache.get(key);
    const counts=new Map();let total=0;
    for(const room of this.groupRooms(group)){
      const mapId=Number(room.mapId),dim=this.mapDecoder.dimensions(mapId),gridW=Math.ceil(dim.width/8),gridH=Math.ceil(dim.height/8);
      for(let gy=0;gy<gridH;gy++)for(let gx=0;gx<gridW;gx++){const token=descriptorKey(this.cell(mapId,gx,gy,plane));counts.set(token,(counts.get(token)||0)+1);total++}
    }
    const stats=Object.freeze({counts,total});this.frequencyCache.set(key,stats);return stats;
  }
  rarityWeight(group,plane,descriptor){
    if(!group)return 1;
    const stats=this.frequencyStats(group,plane),count=stats.counts.get(descriptorKey(descriptor))||1;
    if(!stats.total||count<=0)return 1;
    return 1+Math.min(2.5,Math.max(0,Math.log2((stats.total+1)/(count+1))/5));
  }
  outcomeFingerprint(mapId,candidateGrid){
    const parts=[];for(const plane of ['B','A'])for(let y=0;y<candidateGrid.height;y++)for(let x=0;x<candidateGrid.width;x++)parts.push(`${plane}:${descriptorKey(this.cell(mapId,candidateGrid.x+x,candidateGrid.y+y,plane))}`);return parts.join('|');
  }
  foregroundShapeFingerprint(mapId,candidateGrid){
    const parts=[];for(let y=0;y<candidateGrid.height;y++)for(let x=0;x<candidateGrid.width;x++)parts.push(descriptorShapeKey(this.cell(mapId,candidateGrid.x+x,candidateGrid.y+y,'A')));return parts.join('');
  }
  scoreCandidate({targetMapId,targetGrid,candidateMapId,candidateGrid,targetOverrides=null,fixedCells=[]}){
    const width=targetGrid.width,height=targetGrid.height;
    let contextScore=0,seamScore=0,interiorScore=0,foregroundCells=0;
    for(const plane of ['B','A']){
      for(let x=-1;x<=width;x++)for(const y of [-1,height]){
        const t=this.targetCell(targetMapId,targetGrid.x+x,targetGrid.y+y,plane,targetOverrides),c=this.cell(candidateMapId,candidateGrid.x+x,candidateGrid.y+y,plane);
        contextScore+=cellDistance(t,c);
      }
      for(let y=0;y<height;y++)for(const x of [-1,width]){
        const t=this.targetCell(targetMapId,targetGrid.x+x,targetGrid.y+y,plane,targetOverrides),c=this.cell(candidateMapId,candidateGrid.x+x,candidateGrid.y+y,plane);
        contextScore+=cellDistance(t,c);
      }
      for(let y=0;y<height;y++){
        seamScore+=edgeDistance(this.targetCell(targetMapId,targetGrid.x-1,targetGrid.y+y,plane,targetOverrides),'right',this.cell(candidateMapId,candidateGrid.x,candidateGrid.y+y,plane),'left');
        seamScore+=edgeDistance(this.cell(candidateMapId,candidateGrid.x+width-1,candidateGrid.y+y,plane),'right',this.targetCell(targetMapId,targetGrid.x+width,targetGrid.y+y,plane,targetOverrides),'left');
      }
      for(let x=0;x<width;x++){
        seamScore+=edgeDistance(this.targetCell(targetMapId,targetGrid.x+x,targetGrid.y-1,plane,targetOverrides),'bottom',this.cell(candidateMapId,candidateGrid.x+x,candidateGrid.y,plane),'top');
        seamScore+=edgeDistance(this.cell(candidateMapId,candidateGrid.x+x,candidateGrid.y+height-1,plane),'bottom',this.targetCell(targetMapId,targetGrid.x+x,targetGrid.y+height,plane,targetOverrides),'top');
      }
      for(const cell of fixedCells||[]){
        const gx=Number(cell?.[0]),gy=Number(cell?.[1]);if(!integer(gx)||!integer(gy)||gx<targetGrid.x||gy<targetGrid.y||gx>=targetGrid.x+width||gy>=targetGrid.y+height)continue;
        interiorScore+=cellDistance(this.targetCell(targetMapId,gx,gy,plane,targetOverrides),this.cell(candidateMapId,candidateGrid.x+(gx-targetGrid.x),candidateGrid.y+(gy-targetGrid.y),plane));
      }
      if(plane==='A')for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(!this.cell(candidateMapId,candidateGrid.x+x,candidateGrid.y+y,'A').empty)foregroundCells+=1;
    }
    const boundsPx=fromGridRect(candidateGrid),special=this.candidatePenalty(candidateMapId,boundsPx),sameMap=Number(targetMapId)===Number(candidateMapId);
    const score=contextScore+seamScore*2+interiorScore*5+foregroundCells*4+special.penalty+(sameMap?-4:0);
    return {score,contextScore,seamScore,interiorScore,foregroundCells,specialPenalty:special.penalty,specialHits:special.hits};
  }
  scoreVoidCandidate({targetMapId,targetGrid,candidateMapId,candidateGrid,targetOverrides=null,group=null,moveVector=[0,0],contextRadius=4}){
    const width=targetGrid.width,height=targetGrid.height,dx=Number(moveVector?.[0]||0),dy=Number(moveVector?.[1]||0),horizontal=Math.abs(dx)>Math.abs(dy),vertical=Math.abs(dy)>Math.abs(dx);
    let contextScore=0,seamScore=0,foregroundCells=0,rareFeatureScore=0;
    const radius=Math.max(1,Math.min(4,Number(contextRadius)||4)),weights=[0,4,2.5,1.5,.75];
    const contextDistance=(plane,tx,ty,cx,cy,weight,axisWeight)=>{
      const target=this.targetCell(targetMapId,tx,ty,plane,targetOverrides),candidate=this.cell(candidateMapId,cx,cy,plane),rarity=this.rarityWeight(group,plane,target),distance=cellDistance(target,candidate),weighted=distance*weight*axisWeight*rarity;
      contextScore+=weighted;rareFeatureScore+=distance*weight*axisWeight*Math.max(0,rarity-1);
    };
    for(const plane of ['B','A']){
      for(let distance=1;distance<=radius;distance++){
        const weight=weights[distance]||1,leftRightWeight=horizontal?1.6:(vertical?.8:1),topBottomWeight=vertical?1.6:(horizontal?.8:1);
        for(let y=0;y<height;y++){
          contextDistance(plane,targetGrid.x-distance,targetGrid.y+y,candidateGrid.x-distance,candidateGrid.y+y,weight,leftRightWeight);
          contextDistance(plane,targetGrid.x+width-1+distance,targetGrid.y+y,candidateGrid.x+width-1+distance,candidateGrid.y+y,weight,leftRightWeight);
        }
        for(let x=0;x<width;x++){
          contextDistance(plane,targetGrid.x+x,targetGrid.y-distance,candidateGrid.x+x,candidateGrid.y-distance,weight,topBottomWeight);
          contextDistance(plane,targetGrid.x+x,targetGrid.y+height-1+distance,candidateGrid.x+x,candidateGrid.y+height-1+distance,weight,topBottomWeight);
        }
      }
      for(let y=0;y<height;y++){
        seamScore+=edgeDistance(this.targetCell(targetMapId,targetGrid.x-1,targetGrid.y+y,plane,targetOverrides),'right',this.cell(candidateMapId,candidateGrid.x,candidateGrid.y+y,plane),'left');
        seamScore+=edgeDistance(this.cell(candidateMapId,candidateGrid.x+width-1,candidateGrid.y+y,plane),'right',this.targetCell(targetMapId,targetGrid.x+width,targetGrid.y+y,plane,targetOverrides),'left');
      }
      for(let x=0;x<width;x++){
        seamScore+=edgeDistance(this.targetCell(targetMapId,targetGrid.x+x,targetGrid.y-1,plane,targetOverrides),'bottom',this.cell(candidateMapId,candidateGrid.x+x,candidateGrid.y,plane),'top');
        seamScore+=edgeDistance(this.cell(candidateMapId,candidateGrid.x+x,candidateGrid.y+height-1,plane),'bottom',this.targetCell(targetMapId,targetGrid.x+x,targetGrid.y+height,plane,targetOverrides),'top');
      }
      if(plane==='A')for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(!this.cell(candidateMapId,candidateGrid.x+x,candidateGrid.y+y,'A').empty)foregroundCells++;
    }
    const boundsPx=fromGridRect(candidateGrid),special=this.candidatePenalty(candidateMapId,boundsPx),sameMap=Number(targetMapId)===Number(candidateMapId),introducedForegroundPenalty=foregroundCells*14;
    const score=contextScore+seamScore*2.5+introducedForegroundPenalty+special.penalty+(sameMap?-4:0);
    return {score,contextScore,seamScore,interiorScore:0,foregroundCells,introducedForegroundPenalty,rareFeatureScore,specialPenalty:special.penalty,specialHits:special.hits};
  }
  rank({targetMapId,targetBounds,group=null,maxCandidates=8,excludeMarginCells=1,seed=null,targetOverrides=null,fixedCells=[]}={}){
    if(!targetBounds||!integer(targetBounds.x/8)||!integer(targetBounds.y/8)||!integer(targetBounds.width/8)||!integer(targetBounds.height/8))throw new Error('Smart scissors target bounds must be 8px aligned');
    const targetRoom=this.roomForMap(targetMapId),levelGroup=group??targetRoom?.group;
    if(!levelGroup)throw new Error(`Smart scissors could not determine level group for map ${targetMapId}`);
    const targetGrid=toGridRect(targetBounds),exclude=expand(targetGrid,Math.max(0,Number(excludeMarginCells)||0)),out=[],overrideMap=this.normalizedTargetOverrides(targetOverrides);
    let seedSpec=null;
    if(seed){
      const target=Array.isArray(seed.target)?seed.target.map(Number):null,source=Array.isArray(seed.source)?seed.source.map(Number):null,plane=String(seed.plane||'').toUpperCase();
      if(target?.length>=2&&target.every(integer)&&source?.length>=2&&source.every(integer)&&integer(seed.sourceMapId)&&(plane==='A'||plane==='B')){
        const rel=[target[0]-targetGrid.x,target[1]-targetGrid.y];
        if(rel[0]>=0&&rel[1]>=0&&rel[0]<targetGrid.width&&rel[1]<targetGrid.height)seedSpec={target,source,sourceMapId:Number(seed.sourceMapId),plane,rel,descriptor:this.cell(Number(seed.sourceMapId),source[0],source[1],plane)};
      }
    }
    for(const room of this.groupRooms(levelGroup)){
      const mapId=Number(room.mapId),dim=this.mapDecoder.dimensions(mapId),gridW=Math.ceil(dim.width/8),gridH=Math.ceil(dim.height/8);
      for(let gy=1;gy+targetGrid.height<gridH-1;gy++)for(let gx=1;gx+targetGrid.width<gridW-1;gx++){
        const candidateGrid=rect(gx,gy,targetGrid.width,targetGrid.height);
        if(mapId===Number(targetMapId)&&intersects(candidateGrid,exclude))continue;
        if(seedSpec&&!descriptorMatches(seedSpec.descriptor,this.cell(mapId,gx+seedSpec.rel[0],gy+seedSpec.rel[1],seedSpec.plane)))continue;
        const scored=this.scoreCandidate({targetMapId:Number(targetMapId),targetGrid,candidateMapId:mapId,candidateGrid,targetOverrides:overrideMap,fixedCells});
        out.push(Object.freeze({
          mapId,submap:Number(room.submap),group:String(room.group||''),sameMap:mapId===Number(targetMapId),
          targetBounds:Object.freeze([targetBounds.x,targetBounds.y,targetBounds.width,targetBounds.height]),
          sourceBounds:Object.freeze([gx*8,gy*8,targetBounds.width,targetBounds.height]),
          sourceG8:Object.freeze([gx,gy,targetGrid.width,targetGrid.height]),
          ...(seedSpec?{seed:Object.freeze({plane:seedSpec.plane,target:Object.freeze(seedSpec.target.slice()),sourceMapId:seedSpec.sourceMapId,source:Object.freeze(seedSpec.source.slice())})}:{}),
          ...scored
        }));
      }
    }
    out.sort((a,b)=>a.score-b.score||Number(!a.sameMap)-Number(!b.sameMap)||a.mapId-b.mapId||a.sourceG8[1]-b.sourceG8[1]||a.sourceG8[0]-b.sourceG8[0]);
    return Object.freeze(out.slice(0,Math.max(1,Number(maxCandidates)||8)));
  }
  rankVoid({targetMapId,targetBounds,group=null,maxCandidates=8,excludeBounds=[],excludeMarginCells=1,targetOverrides=null,moveVector=[0,0],contextRadius=4}={}){
    if(!targetBounds||!integer(targetBounds.x/8)||!integer(targetBounds.y/8)||!integer(targetBounds.width/8)||!integer(targetBounds.height/8))throw new Error('Smart scissors void bounds must be 8px aligned');
    const targetRoom=this.roomForMap(targetMapId),levelGroup=group??targetRoom?.group;if(!levelGroup)throw new Error(`Smart scissors could not determine level group for map ${targetMapId}`);
    const targetGrid=toGridRect(targetBounds),overrideMap=this.normalizedTargetOverrides(targetOverrides),margin=Math.max(0,Number(excludeMarginCells)||0),exclusions=(excludeBounds||[]).filter(Boolean).map(row=>expand(toGridRect(row),margin)),raw=[];
    for(const room of this.groupRooms(levelGroup)){
      const mapId=Number(room.mapId),dim=this.mapDecoder.dimensions(mapId),gridW=Math.ceil(dim.width/8),gridH=Math.ceil(dim.height/8);
      for(let gy=1;gy+targetGrid.height<gridH-1;gy++)for(let gx=1;gx+targetGrid.width<gridW-1;gx++){
        const candidateGrid=rect(gx,gy,targetGrid.width,targetGrid.height);if(mapId===Number(targetMapId)&&exclusions.some(row=>intersects(candidateGrid,row)))continue;
        const scored=this.scoreVoidCandidate({targetMapId:Number(targetMapId),targetGrid,candidateMapId:mapId,candidateGrid,targetOverrides:overrideMap,group:levelGroup,moveVector,contextRadius}),fingerprint=this.outcomeFingerprint(mapId,candidateGrid),foregroundShape=this.foregroundShapeFingerprint(mapId,candidateGrid);
        raw.push({mapId,submap:Number(room.submap),group:String(room.group||''),sameMap:mapId===Number(targetMapId),targetBounds:Object.freeze([targetBounds.x,targetBounds.y,targetBounds.width,targetBounds.height]),sourceBounds:Object.freeze([gx*8,gy*8,targetBounds.width,targetBounds.height]),sourceG8:Object.freeze([gx,gy,targetGrid.width,targetGrid.height]),fingerprint,foregroundShape,...scored});
      }
    }
    raw.sort((a,b)=>a.score-b.score||Number(!a.sameMap)-Number(!b.sameMap)||a.mapId-b.mapId||a.sourceG8[1]-b.sourceG8[1]||a.sourceG8[0]-b.sourceG8[0]);
    const exact=new Map();for(const row of raw){const entry=exact.get(row.fingerprint);if(entry)entry.supportCount++;else exact.set(row.fingerprint,{best:row,supportCount:1})}
    const unique=[...exact.values()].map(({best,supportCount})=>{const consensusBonus=Math.min(10,Math.log2(supportCount+1)*2);return Object.freeze({...best,rawScore:best.score,consensusBonus,supportCount,score:best.score-consensusBonus})});
    unique.sort((a,b)=>a.score-b.score||Number(!a.sameMap)-Number(!b.sameMap)||a.mapId-b.mapId||a.sourceG8[1]-b.sourceG8[1]||a.sourceG8[0]-b.sourceG8[0]);
    const limit=Math.max(1,Number(maxCandidates)||8),selected=[],families=new Set(),fingerprints=new Set();
    for(const row of unique){if(families.has(row.foregroundShape))continue;selected.push(row);families.add(row.foregroundShape);fingerprints.add(row.fingerprint);if(selected.length>=limit)return Object.freeze(selected)}
    for(const row of unique){if(fingerprints.has(row.fingerprint))continue;selected.push(row);fingerprints.add(row.fingerprint);if(selected.length>=limit)break}
    return Object.freeze(selected);
  }
  rankMove({targetMapId,sourceBounds,destinationBounds,voidRects=null,group=null,maxCandidates=8,excludeMarginCells=1,targetOverrides=null,contextRadius=4}={}){
    if(!sourceBounds||!destinationBounds)throw new Error('Smart scissors Cut + Move requires source and destination bounds');
    const voids=(voidRects||smartScissorsVoidRects(sourceBounds,destinationBounds)).filter(Boolean);if(!voids.length)return Object.freeze([]);
    const moveVector=[(destinationBounds.x-sourceBounds.x)/8,(destinationBounds.y-sourceBounds.y)/8],perVoid=voids.map(bounds=>this.rankVoid({targetMapId,targetBounds:bounds,group,maxCandidates:Math.max(8,Number(maxCandidates)||8),excludeBounds:[sourceBounds,destinationBounds],excludeMarginCells,targetOverrides,moveVector,contextRadius}));
    let beam=[{repairs:[],score:0,contextScore:0,seamScore:0,foregroundCells:0,introducedForegroundPenalty:0,rareFeatureScore:0,specialPenalty:0,supportCount:null,foregroundShape:'',fingerprint:''}];
    for(const rows of perVoid){const next=[];for(const state of beam)for(const row of rows)next.push({repairs:[...state.repairs,row],score:state.score+row.score,contextScore:state.contextScore+row.contextScore,seamScore:state.seamScore+row.seamScore,foregroundCells:state.foregroundCells+row.foregroundCells,introducedForegroundPenalty:state.introducedForegroundPenalty+row.introducedForegroundPenalty,rareFeatureScore:state.rareFeatureScore+row.rareFeatureScore,specialPenalty:state.specialPenalty+row.specialPenalty,supportCount:state.supportCount==null?row.supportCount:Math.min(state.supportCount,row.supportCount),foregroundShape:`${state.foregroundShape}/${row.foregroundShape}`,fingerprint:`${state.fingerprint}/${row.fingerprint}`});next.sort((a,b)=>a.score-b.score);beam=next.slice(0,Math.max(32,(Number(maxCandidates)||8)*4))}
    const limit=Math.max(1,Number(maxCandidates)||8),selected=[],families=new Set(),fingerprints=new Set();for(const state of beam){if(families.has(state.foregroundShape))continue;selected.push(state);families.add(state.foregroundShape);fingerprints.add(state.fingerprint);if(selected.length>=limit)break}if(selected.length<limit)for(const state of beam){if(fingerprints.has(state.fingerprint))continue;selected.push(state);fingerprints.add(state.fingerprint);if(selected.length>=limit)break}
    return Object.freeze(selected.map(state=>{const first=state.repairs[0],sameMap=state.repairs.every(row=>row.sameMap),multiDonor=state.repairs.some(row=>row.mapId!==first.mapId||row.sourceG8[0]!==first.sourceG8[0]||row.sourceG8[1]!==first.sourceG8[1]);return Object.freeze({...state,repairs:Object.freeze(state.repairs),mapId:first.mapId,submap:first.submap,group:first.group,sameMap,multiDonor,sourceBounds:first.sourceBounds,sourceG8:first.sourceG8,targetBounds:Object.freeze([sourceBounds.x,sourceBounds.y,sourceBounds.width,sourceBounds.height]),interiorScore:0})}));
  }
}

function gridContains(bounds,gx,gy){return gx>=bounds.x&&gy>=bounds.y&&gx<bounds.x+bounds.width&&gy<bounds.y+bounds.height}

export function smartScissorsVoidRects(sourceBounds,destinationBounds){
  if(!sourceBounds||!destinationBounds)return Object.freeze([]);
  const source=toGridRect(sourceBounds),destination=toGridRect(destinationBounds),open=new Set();
  for(let gy=source.y;gy<source.y+source.height;gy++)for(let gx=source.x;gx<source.x+source.width;gx++)if(!gridContains(destination,gx,gy))open.add(`${gx}:${gy}`);
  const rectangles=[];
  while(open.size){
    const first=[...open].map(key=>key.split(':').map(Number)).sort((a,b)=>a[1]-b[1]||a[0]-b[0])[0],[x0,y0]=first;
    let width=1;while(open.has(`${x0+width}:${y0}`))width++;
    let height=1,expandable=true;while(expandable){const y=y0+height;for(let x=x0;x<x0+width;x++)if(!open.has(`${x}:${y}`)){expandable=false;break}if(expandable)height++;}
    for(let y=y0;y<y0+height;y++)for(let x=x0;x<x0+width;x++)open.delete(`${x}:${y}`);
    rectangles.push(fromGridRect(rect(x0,y0,width,height)));
  }
  return Object.freeze(rectangles.map(row=>Object.freeze(row)));
}

export function smartScissorsMoveTargetOverrides(sourceBounds,destinationBounds,{mapId}={}){
  if(!sourceBounds||!destinationBounds||!integer(mapId))return Object.freeze([]);
  const source=toGridRect(sourceBounds),destination=toGridRect(destinationBounds),rows=[];
  if(source.width!==destination.width||source.height!==destination.height)throw new Error('Smart scissors move source and destination must have the same size');
  for(let qy=0;qy<source.height;qy++)for(let qx=0;qx<source.width;qx++)rows.push(Object.freeze({target:Object.freeze([destination.x+qx,destination.y+qy]),sourceMapId:Number(mapId),source:Object.freeze([source.x+qx,source.y+qy]),planes:Object.freeze(['B','A'])}));
  return Object.freeze(rows);
}

function normalizedTransferPlanes(planes){
  const requested=(Array.isArray(planes)?planes:['B','A']).map(plane=>String(plane||'').toUpperCase()).filter(plane=>plane==='A'||plane==='B');
  return [...new Set(requested.length?requested:['B','A'])];
}

export function smartScissorsTransferPlanesForPresentation(mode){
  const value=String(mode||'full').toLowerCase();
  if(value==='foreground')return Object.freeze(['A']);
  if(value==='backdrop'||value==='midground'||value==='behind')return Object.freeze(['B']);
  return Object.freeze(['B','A']);
}

export function smartScissorsPastePlan(sourceBounds,destinationBounds,{mapId,group='',mapDecoder,planes=null}={}){
  if(!sourceBounds||!destinationBounds||!integer(mapId))throw new Error('Smart scissors Cut + Paste requires source, destination, and map id');
  const source=[Number(sourceBounds.x),Number(sourceBounds.y),Number(sourceBounds.width),Number(sourceBounds.height)],destination=[Number(destinationBounds.x),Number(destinationBounds.y),Number(destinationBounds.width),Number(destinationBounds.height)];
  if(source[2]!==destination[2]||source[3]!==destination[3])throw new Error('Smart scissors paste source and destination must have the same size');
  const candidate={mapId:Number(mapId),group:String(group||''),sourceBounds:source,targetBounds:destination,sourceG8:[source[0]/8,source[1]/8,source[2]/8,source[3]/8],score:0};
  return smartScissorsTilePlan(candidate,{mapDecoder,planes});
}

export function smartScissorsMoveFixedCells(sourceBounds,destinationBounds){
  if(!sourceBounds||!destinationBounds)return Object.freeze([]);
  const source=toGridRect(sourceBounds),destination=toGridRect(destinationBounds),rows=[];
  for(let gy=source.y;gy<source.y+source.height;gy++)for(let gx=source.x;gx<source.x+source.width;gx++)if(gridContains(destination,gx,gy))rows.push(Object.freeze([gx,gy]));
  return Object.freeze(rows);
}

export function intersectingReviewedVisualPatches(patches,{submap,mapId,bounds}={}){
  if(!Array.isArray(bounds)||bounds.length<4)return [];
  const target=rect(...bounds.slice(0,4).map(Number));
  return (Array.isArray(patches)?patches:[]).filter(row=>{
    if(Number(row?.submap)!==Number(submap)||Number(row?.mapId)!==Number(mapId))return false;
    if(!['copy','suppress','overlay-tiles'].includes(String(row?.action||'')))return false;
    const b=Array.isArray(row?.bounds)&&row.bounds.length>=4?rect(...row.bounds.slice(0,4).map(Number)):null;
    return b&&intersects(target,b);
  });
}

export function smartScissorsTilePlan(candidate,{targetBounds=null,mapDecoder,planes=null}={}){
  if(!candidate||!mapDecoder?.inspectGridCell)throw new Error('Smart scissors tile plan requires a candidate and RDX map decoder');
  const target=(targetBounds||candidate.targetBounds||[]).map(Number),source=(candidate.sourceBounds||[]).map(Number);
  if(target.length<4||source.length<4)throw new Error('Smart scissors candidate is missing target/source bounds');
  const [tx,ty,width,height]=target,[sx,sy]=source,gridW=width/8,gridH=height/8;
  if(![tx,ty,width,height,sx,sy].every(integer)||width<=0||height<=0||width%8||height%8||sx%8||sy%8)throw new Error('Smart scissors candidate bounds must be 8px aligned');
  const batchId=`smart-scissors:${candidate.mapId}:${sx}:${sy}:${tx}:${ty}:${width}:${height}`;
  const rows=[];
  for(const plane of normalizedTransferPlanes(planes))for(let qy=0;qy<gridH;qy++)for(let qx=0;qx<gridW;qx++){
    const sourceGx=sx/8+qx,sourceGy=sy/8+qy,targetGx=tx/8+qx,targetGy=ty/8+qy,cell=mapDecoder.inspectGridCell(Number(candidate.mapId),sourceGx,sourceGy,0),visual=visualForPlane(cell,plane),empty=!visual?.allowed||visual.transparent||visual?.resolution?.globalTile==null;
    rows.push(Object.freeze({
      target:Object.freeze([targetGx,targetGy]),layer:plane,operation:empty?'clear':'copy',
      source:empty?null:Object.freeze([sourceGx,sourceGy]),sourceMapId:Number(candidate.mapId),sourceLayer:plane,
      smartScissors:Object.freeze({batchId,sourceMapId:Number(candidate.mapId),sourceBounds:Object.freeze(source.slice(0,4)),targetBounds:Object.freeze(target.slice(0,4)),score:Number(candidate.score||0),group:String(candidate.group||'')})
    }));
  }
  return Object.freeze({batchId,rows:Object.freeze(rows)});
}

export function smartScissorsRetainUnaffectedTileRows(tiles,affectedBounds,transferRows){
  const affected=(Array.isArray(affectedBounds)?affectedBounds:[]).filter(Boolean).map(toGridRect),planes=new Set((Array.isArray(transferRows)?transferRows:[]).map(row=>String(row?.layer||'').toUpperCase()).filter(plane=>plane==='A'||plane==='B'));
  return (Array.isArray(tiles)?tiles:[]).filter(row=>{
    const [gx,gy]=(row?.target||[]).map(Number),layer=String(row?.layer||'').toUpperCase();
    if(!planes.has(layer)||!integer(gx)||!integer(gy))return true;
    return !affected.some(bounds=>gridContains(bounds,gx,gy));
  });
}
