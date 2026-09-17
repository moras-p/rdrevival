export const AUTOTILE_CATALOG_SCHEMA = 'rdx.autotile_catalog.v1';
export const TERRAIN_COLLISION_MODES = Object.freeze(['catalog','visual-only','preserve']);
const CARDINAL = Object.freeze([[0,-1,1],[1,0,2],[0,1,4],[-1,0,8]]);
const DIAGONAL = Object.freeze([[1,-1,1],[1,1,2],[-1,1,4],[-1,-1,8]]);
const WALKABLE = new Set(['solid','one-way']);
const clone = value => JSON.parse(JSON.stringify(value));
const key = (x,y) => `${Number(x)},${Number(y)}`;
const finiteInt = value => Number.isInteger(Number(value));

export function hash32(value) {
  let h=2166136261>>>0;
  const text=String(value);
  for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}
  return h>>>0;
}

function normalizeOutput(output, set, variant){
  const sourceLayer=['A','B'].includes(String(output?.sourceLayer||variant?.sourceLayer||set.sourceLayer||'B').toUpperCase())?String(output?.sourceLayer||variant?.sourceLayer||set.sourceLayer||'B').toUpperCase():'B';
  const layer=['A','B'].includes(String(output?.layer||sourceLayer).toUpperCase())?String(output?.layer||sourceLayer).toUpperCase():sourceLayer;
  const sourceMapId=Number(output?.sourceMapId ?? variant?.sourceMapId);
  const sourceCell=Array.isArray(output?.sourceCell)
    ? output.sourceCell.slice(0,2).map(Number)
    : (Array.isArray(variant?.sourceCell) ? variant.sourceCell.slice(0,2).map(Number) : [0,0]);
  const targetOffset=Array.isArray(output?.targetOffset) ? output.targetOffset.slice(0,2).map(v=>Number(v)||0) : [0,0];
  return { sourceMapId, sourceCell, sourceLayer, layer, targetOffset, requiresCollision:output?.requiresCollision?String(output.requiresCollision):null, relationRole:output?.relationRole?String(output.relationRole):null };
}

function normalizeVariant(set, rule, variant, ri, vi){
  const base={
    sourceMapId:Number(variant?.sourceMapId),
    sourceCell:Array.isArray(variant?.sourceCell)?variant.sourceCell.slice(0,2).map(Number):[0,0],
    sourceLayer:['A','B'].includes(String(variant?.sourceLayer||set.sourceLayer).toUpperCase())?String(variant?.sourceLayer||set.sourceLayer).toUpperCase():set.sourceLayer,
    weight:Math.max(1,Number(variant?.weight||1)),
    id:String(variant?.id||`${set.id}:${ri}:${vi}`)
  };
  const outputs=(Array.isArray(variant?.outputs)&&variant.outputs.length?variant.outputs:[{}]).map(output=>normalizeOutput(output,set,base)).filter(v=>finiteInt(v.sourceMapId)&&v.sourceCell.every(finiteInt)&&v.targetOffset.every(finiteInt));
  const repeatKey=String(variant?.repeatKey||outputs.map(o=>`${o.layer}:${o.sourceLayer}:${o.sourceMapId}:${o.sourceCell.join(',')}:${o.targetOffset.join(',')}`).join('|'));
  const neighborContexts=(Array.isArray(variant?.neighborContexts)?variant.neighborContexts:[]).map(c=>({N:String(c?.N||'pass-through'),E:String(c?.E||'pass-through'),S:String(c?.S||'pass-through'),W:String(c?.W||'pass-through'),count:Math.max(1,Number(c?.count||1))}));
  const neighborVisualKeys={N:variant?.neighborVisualKeys?.N||null,E:variant?.neighborVisualKeys?.E||null,S:variant?.neighborVisualKeys?.S||null,W:variant?.neighborVisualKeys?.W||null};
  return {...base, outputs, repeatKey, neighborContexts, visualKey:variant?.visualKey?String(variant.visualKey):null, neighborVisualKeys, overlay:outputs.some(o=>o.layer==='A')};
}

function normalizePathPrototype(set, prototype, index){
  const cell=value=>Array.isArray(value)?value.slice(0,2).map(Number):[0,0];
  const middle=(Array.isArray(prototype?.middleCells)?prototype.middleCells:[]).map(cell).filter(c=>c.every(finiteInt));
  return {
    id:String(prototype?.id||`${set.id}.path.${index}`), axis:String(prototype?.axis||set.pathAxis||'vertical'),
    sourceMapId:Number(prototype?.sourceMapId),topCell:cell(prototype?.topCell),middleCells:middle,bottomCell:cell(prototype?.bottomCell),sourceCells:(Array.isArray(prototype?.sourceCells)?prototype.sourceCells:[]).map(cell).filter(c=>c.every(finiteInt)),
    sourceLength:Math.max(1,Number(prototype?.sourceLength||middle.length+2)|0),repeatPeriod:Math.max(1,Number(prototype?.repeatPeriod||middle.length||1)|0),
    visualKeys:Array.isArray(prototype?.visualKeys)?prototype.visualKeys.map(v=>v==null?null:String(v)):[],leftVisualKeys:Array.isArray(prototype?.leftVisualKeys)?prototype.leftVisualKeys.map(v=>v==null?null:String(v)):[],rightVisualKeys:Array.isArray(prototype?.rightVisualKeys)?prototype.rightVisualKeys.map(v=>v==null?null:String(v)):[],leftCollisions:Array.isArray(prototype?.leftCollisions)?prototype.leftCollisions.map(String):[],rightCollisions:Array.isArray(prototype?.rightCollisions)?prototype.rightCollisions.map(String):[],
    bottomSupport:String(prototype?.bottomSupport||'pass-through'),topAbove:String(prototype?.topAbove||'pass-through'),topLeft:String(prototype?.topLeft||'pass-through'),topRight:String(prototype?.topRight||'pass-through'),topVisualKey:prototype?.topVisualKey?String(prototype.topVisualKey):null,middleVisualKeys:Array.isArray(prototype?.middleVisualKeys)?prototype.middleVisualKeys.map(String):[],bottomVisualKey:prototype?.bottomVisualKey?String(prototype.bottomVisualKey):null,topNeighborVisualKeys:{N:prototype?.topNeighborVisualKeys?.N||null,E:prototype?.topNeighborVisualKeys?.E||null,S:prototype?.topNeighborVisualKeys?.S||null,W:prototype?.topNeighborVisualKeys?.W||null},bottomSupportVisualKey:prototype?.bottomSupportVisualKey?String(prototype.bottomSupportVisualKey):null,
    junctionOutputs:(Array.isArray(prototype?.junctionOutputs)?prototype.junctionOutputs:[]).map(o=>normalizeOutput(o,set,{sourceMapId:prototype?.sourceMapId,sourceLayer:set.sourceLayer||'B'})).filter(o=>finiteInt(o.sourceMapId)&&o.sourceCell.every(finiteInt)),
    weight:Math.max(1,Number(prototype?.weight||1)),styleKey:String(prototype?.styleKey||prototype?.id||`${set.id}.path.${index}`)
  };
}

function normalizeEdgePrototype(set,prototype,index){
  const cell=value=>Array.isArray(value)?value.slice(0,2).map(Number):[0,0];
  const sourceCells=(Array.isArray(prototype?.sourceCells)?prototype.sourceCells:[]).map(cell).filter(c=>c.every(finiteInt));
  const length=sourceCells.length;
  const strings=(value)=>Array.isArray(value)?value.slice(0,length).map(v=>v==null?null:String(v)):[];
  const bools=(value)=>Array.isArray(value)?value.slice(0,length).map(Boolean):[];
  const nums=(value)=>Array.isArray(value)?value.slice(0,length).map(v=>Math.max(0,Math.min(15,Number(v)||0))):[];
  return {
    id:String(prototype?.id||`${set.id}.edge.${index}`),axis:String(prototype?.axis||'horizontal'),sourceMapId:Number(prototype?.sourceMapId),sourceCells,sourceLength:Math.max(1,Number(prototype?.sourceLength||length)|0),
    visualKeys:strings(prototype?.visualKeys),northVisualKeys:strings(prototype?.northVisualKeys),southVisualKeys:strings(prototype?.southVisualKeys),northCollisions:strings(prototype?.northCollisions),southCollisions:strings(prototype?.southCollisions),masks:nums(prototype?.masks),planeA:bools(prototype?.planeA),
    leftCollision:String(prototype?.leftCollision||'pass-through'),rightCollision:String(prototype?.rightCollision||'pass-through'),leftVisualKey:prototype?.leftVisualKey?String(prototype.leftVisualKey):null,rightVisualKey:prototype?.rightVisualKey?String(prototype.rightVisualKey):null,weight:Math.max(1,Number(prototype?.weight||1)),styleKey:String(prototype?.styleKey||prototype?.id||`${set.id}.edge.${index}`)
  };
}

function normalizeSupportPrototype(set,prototype,index){
  const cell=value=>Array.isArray(value)?value.slice(0,2).map(Number):[0,0];
  return {id:String(prototype?.id||`${set.id}.support.${index}`),sourceMapId:Number(prototype?.sourceMapId),platformCell:cell(prototype?.platformCell),platformVisualKey:prototype?.platformVisualKey?String(prototype.platformVisualKey):null,stemCells:(Array.isArray(prototype?.stemCells)?prototype.stemCells:[]).map(cell).filter(c=>c.every(finiteInt)),sourceLength:Math.max(2,Number(prototype?.sourceLength||2)|0),repeatPeriod:Math.max(1,Number(prototype?.repeatPeriod||1)|0),weight:Math.max(1,Number(prototype?.weight||1)),styleKey:String(prototype?.styleKey||prototype?.id||`${set.id}.support.${index}`),anchorRole:String(prototype?.anchorRole||''),terminalCollision:String(prototype?.terminalCollision||'pass-through'),leftSpan:Math.max(0,Number(prototype?.leftSpan||0)|0),rightSpan:Math.max(0,Number(prototype?.rightSpan||0)|0),neighborContext:prototype?.neighborContext?{N:String(prototype.neighborContext.N||'pass-through'),E:String(prototype.neighborContext.E||'pass-through'),S:String(prototype.neighborContext.S||'pass-through'),W:String(prototype.neighborContext.W||'pass-through')}:null};
}

export function normalizeAutotileCatalog(input) {
  const source=clone(input||{});
  if(source.schema!==AUTOTILE_CATALOG_SCHEMA) throw new Error(`Unsupported autotile catalog schema ${source.schema||'missing'}`);
  source.version=String(source.version||'');
  source.sets=(Array.isArray(source.sets)?source.sets:[]).map((set,index)=>{
    const out={
      id:String(set?.id||`terrain-${index}`), label:String(set?.label||set?.id||`Terrain ${index+1}`),
      group:String(set?.group||''), kind:['mixed','edge','path','stamp'].includes(String(set?.kind))?String(set.kind):'mixed',
      sourceLayer:['A','B'].includes(String(set?.sourceLayer||'B').toUpperCase())?String(set.sourceLayer).toUpperCase():'B',
      collision:String(set?.collision||'preserve'), nativeNeighborCollision:String(set?.nativeNeighborCollision||''),
      description:String(set?.description||''), pathAxis:String(set?.pathAxis||''), pathPrototypes:[], edgePrototypes:[], supportPrototypes:[], supportSpacing:Math.max(2,Number(set?.supportSpacing||4)|0), rules:[]
    };
    out.pathPrototypes=(Array.isArray(set?.pathPrototypes)?set.pathPrototypes:[]).map((p,i)=>normalizePathPrototype(out,p,i)).filter(p=>finiteInt(p.sourceMapId)&&p.topCell.every(finiteInt)&&p.bottomCell.every(finiteInt));
    out.edgePrototypes=(Array.isArray(set?.edgePrototypes)?set.edgePrototypes:[]).map((p,i)=>normalizeEdgePrototype(out,p,i)).filter(p=>finiteInt(p.sourceMapId)&&p.sourceCells.length>=2);
    out.supportPrototypes=(Array.isArray(set?.supportPrototypes)?set.supportPrototypes:[]).map((p,i)=>normalizeSupportPrototype(out,p,i)).filter(p=>finiteInt(p.sourceMapId)&&p.platformCell.every(finiteInt)&&p.stemCells.length);
    out.rules=(Array.isArray(set?.rules)?set.rules:[]).map((rule,ri)=>({
      mask:Math.max(0,Math.min(15,Number(rule?.mask??0)|0)),
      diagonalMask:rule?.diagonalMask==null?null:Math.max(0,Math.min(15,Number(rule.diagonalMask)|0)),
      variants:(Array.isArray(rule?.variants)?rule.variants:[])
        .map((variant,vi)=>normalizeVariant(out,rule,variant,ri,vi))
        .filter(v=>v.outputs.length)
    })).filter(rule=>rule.variants.length);
    return out;
  }).filter(set=>set.rules.length);
  return source;
}

export function terrainSetById(catalog,id){ return catalog?.sets?.find(set=>set.id===id)||null; }
export function terrainSetsForGroup(catalog,group){ return (catalog?.sets||[]).filter(set=>!set.group||set.group===group); }

export function terrainCellAt(document,x,y){
  return (document?.terrain||[]).find(cell=>Number(cell?.cell?.[0])===Number(x)&&Number(cell?.cell?.[1])===Number(y))||null;
}

export function buildTerrainIndex(document){
  const index=new Map();
  for(const cell of document?.terrain||[]) if(Array.isArray(cell?.cell)&&cell.cell.length>=2) index.set(key(cell.cell[0],cell.cell[1]),cell);
  return index;
}

function connected(index,set,x,y,nativeConnects){
  const authored=index.get(key(x,y));
  if(authored) return authored.terrainSet===set.id;
  return !!nativeConnects?.(set,Number(x),Number(y));
}

export function terrainNeighborMask(index,set,x,y,{nativeConnects=null}={}){
  let mask=0; for(const [dx,dy,bit] of CARDINAL) if(connected(index,set,x+dx,y+dy,nativeConnects)) mask|=bit; return mask;
}
export function terrainDiagonalMask(index,set,x,y,{nativeConnects=null}={}){
  let mask=0; for(const [dx,dy,bit] of DIAGONAL) if(connected(index,set,x+dx,y+dy,nativeConnects)) mask|=bit; return mask;
}

function popcount4(n){n&=15;return (n&1)+((n>>1)&1)+((n>>2)&1)+((n>>3)&1);}
export function matchTerrainRule(set,mask,diagonalMask=0){
  const exactDiagonal=set.rules.find(rule=>rule.mask===mask&&rule.diagonalMask===diagonalMask);
  if(exactDiagonal)return exactDiagonal;
  const cardinal=set.rules.find(rule=>rule.mask===mask&&rule.diagonalMask==null);
  if(cardinal)return cardinal;
  const sameMask=set.rules.find(rule=>rule.mask===mask);
  if(sameMask)return sameMask;
  let best=null,bestCost=Infinity;
  for(const rule of set.rules){const cost=popcount4(rule.mask^mask)+(rule.diagonalMask==null?0:0.25*popcount4(rule.diagonalMask^diagonalMask));if(cost<bestCost){best=rule;bestCost=cost;}}
  return best;
}

export function chooseTerrainVariant(rule,seedMaterial){
  if(!rule?.variants?.length)return null;
  const total=rule.variants.reduce((sum,v)=>sum+Math.max(1,Number(v.weight||1)),0);
  let pick=hash32(seedMaterial)%total;
  for(const variant of rule.variants){pick-=Math.max(1,Number(variant.weight||1));if(pick<0)return variant;}
  return rule.variants[rule.variants.length-1];
}

function resolveRule(document,catalog,cell,index,{nativeConnects=null}={}){
  const set=terrainSetById(catalog,cell?.terrainSet); if(!set)return null;
  const [x,y]=(cell.cell||[]).map(Number);
  const mask=terrainNeighborMask(index,set,x,y,{nativeConnects});
  const diagonalMask=terrainDiagonalMask(index,set,x,y,{nativeConnects});
  const rule=matchTerrainRule(set,mask,diagonalMask); if(!rule)return null;
  const seed=Number.isInteger(Number(cell.seed))?Number(cell.seed):hash32(`${document?.id||'level'}:${set.id}:${x}:${y}`);
  return {cell,set,mask,diagonalMask,rule,seed};
}

function candidateOrder(rule,seedMaterial){
  return (rule?.variants||[]).slice().sort((a,b)=>{
    const ah=hash32(`${seedMaterial}:${a.id}`), bh=hash32(`${seedMaterial}:${b.id}`);
    if(ah!==bh)return ah-bh;
    if(a.weight!==b.weight)return Number(b.weight||1)-Number(a.weight||1);
    return String(a.id).localeCompare(String(b.id));
  });
}

function chooseVariantWithPlan(rule,seedMaterial,neighborChoices=[],attachmentContext=null,visualContext=null){
  const ordered=candidateOrder(rule,seedMaterial);
  if(!ordered.length)return null;
  let best=ordered[0], bestPenalty=Infinity, bestRank=Infinity;
  for(let i=0;i<ordered.length;i++){
    const variant=ordered[i];
    let penalty=0;
    for(const [slot,neighbor] of neighborChoices.entries()){
      if(!neighbor)continue;
      if(variant.repeatKey===neighbor.repeatKey) penalty+=[6,5,2,2][slot]||1;
      if(variant.id===neighbor.id) penalty+=1;
    }
    penalty+=variantAttachmentPenalty(variant,attachmentContext);
    penalty+=variantVisualContextPenalty(variant,visualContext);
    const west=neighborChoices[0],north=neighborChoices[1];
    if(west)penalty+=visualPairPenalty(west,variant,'E','W');
    if(north)penalty+=visualPairPenalty(north,variant,'S','N');
    penalty-=Math.min(0.49,Math.log2(Math.max(1,Number(variant.weight||1)))*0.12);
    if(penalty<bestPenalty||(penalty===bestPenalty&&i<bestRank)){best=variant;bestPenalty=penalty;bestRank=i;}
  }
  return best;
}

function collisionAtSemantic(index,catalog,x,y,collisionAt){
  const authored=index.get(key(x,y));
  if(authored){const set=terrainSetById(catalog,authored.terrainSet);if(set?.collision&&set.collision!=='preserve')return set.collision;}
  return String(collisionAt?.(Number(x),Number(y))||'pass-through');
}
function contextBucket(value){return WALKABLE.has(String(value))?'walkable':String(value)==='climb-through'?'path':String(value)==='outside'?'outside':'open';}
function semanticNeighborContext(index,catalog,x,y,collisionAt){return {N:collisionAtSemantic(index,catalog,x,y-1,collisionAt),E:collisionAtSemantic(index,catalog,x+1,y,collisionAt),S:collisionAtSemantic(index,catalog,x,y+1,collisionAt),W:collisionAtSemantic(index,catalog,x-1,y,collisionAt)};}
function attachmentMismatch(expected,actual){
  if(String(expected)===String(actual))return 0;
  const eb=contextBucket(expected),ab=contextBucket(actual);if(eb===ab)return 0.75;
  if(eb==='path'||ab==='path')return 8;
  if(eb==='walkable'||ab==='walkable')return 4;
  return 1.5;
}
function variantAttachmentPenalty(variant,context){
  if(!variant?.neighborContexts?.length||!context)return 0;
  let best=Infinity;
  for(const learned of variant.neighborContexts){let cost=0;for(const dir of ['N','E','S','W'])cost+=attachmentMismatch(learned[dir],context[dir]);cost-=Math.min(.4,Math.log2(Math.max(1,learned.count||1))*.08);best=Math.min(best,cost);}
  return Number.isFinite(best)?best:0;
}
function visualPairPenalty(a,b,aDir,bDir){
  if(!a||!b)return 0;let score=0;const av=a.neighborVisualKeys?.[aDir],bv=b.neighborVisualKeys?.[bDir];
  if(av&&b.visualKey)score+=av===b.visualKey?-3.2:.35;
  if(bv&&a.visualKey)score+=bv===a.visualKey?-3.2:.35;
  if(a.visualKey&&b.visualKey&&a.visualKey===b.visualKey&&av!==b.visualKey&&bv!==a.visualKey)score+=.65;
  return score;
}
function variantVisualContextPenalty(variant,context){
  if(!variant||!context)return 0;let score=0;for(const dir of ['N','E','S','W']){const expected=variant.neighborVisualKeys?.[dir],actual=context[dir];if(expected&&actual)score+=expected===actual?-2.4:.18;}return score;
}
function nativeVisualContext(index,x,y,visualAt){
  if(!visualAt)return null;const out={};for(const [dir,dx,dy] of [['N',0,-1],['E',1,0],['S',0,1],['W',-1,0]])if(!index.has(key(x+dx,y+dy)))out[dir]=visualAt(x+dx,y+dy,'B')||null;return out;
}
function pathRole(mask,belowCollision,leftCollision,rightCollision){
  const vertical=mask&5;
  if(vertical===1)return'bottom';
  if(vertical===4)return'top';
  if(vertical===5)return'middle';
  if(vertical===0&&WALKABLE.has(String(belowCollision)))return'bottom';
  if(vertical===0&&(WALKABLE.has(String(leftCollision))||WALKABLE.has(String(rightCollision))))return'top';
  return'isolated';
}
function pathComponents(rows,set){
  const axis=set.pathAxis||'vertical',byPos=new Map(rows.map(row=>[key(row.cell.cell[0],row.cell.cell[1]),row])),seen=new Set(),out=[];
  const deltas=axis==='vertical'?[[0,-1],[0,1]]:axis==='horizontal'?[[-1,0],[1,0]]:[[0,-1],[1,0],[0,1],[-1,0]];
  for(const row of rows){if(seen.has(row.cell))continue;const component=[],queue=[row];seen.add(row.cell);while(queue.length){const cur=queue.shift();component.push(cur);const [x,y]=cur.cell.cell;for(const [dx,dy] of deltas){const next=byPos.get(key(x+dx,y+dy));if(next&&!seen.has(next.cell)){seen.add(next.cell);queue.push(next);}}}out.push(component);}
  return out;
}
function pathTopConnectorCost(prototype,context){
  let score=0;score+=attachmentMismatch(prototype.topAbove,context.topAbove)*2.8;score+=attachmentMismatch(prototype.topLeft,context.topLeft)*3.2;score+=attachmentMismatch(prototype.topRight,context.topRight)*3.2;score-=Math.min(1,Math.log2(Math.max(1,prototype.weight||1))*.18);return score;
}
function derivePathConnectorCells(document,catalog,baseIndex,{collisionAt=null}={}){
  const derived=new Map();
  for(const set of catalog?.sets||[]){
    if(set.kind!=='path'||set.pathAxis!=='vertical'||!set.pathPrototypes?.length)continue;
    const authored=(document?.terrain||[]).filter(cell=>cell.terrainSet===set.id).map(cell=>({cell,set}));
    for(const component of pathComponents(authored,set)){
      if(!component.length||!component.every(row=>Number(row.cell.cell[0])===Number(component[0].cell.cell[0])))continue;
      const top=component.slice().sort((a,b)=>a.cell.cell[1]-b.cell.cell[1])[0],[x,y]=top.cell.cell,cx=x,cy=y-1;
      if(baseIndex.get(key(cx,cy))?.terrainSet===set.id)continue;
      const target=collisionAtSemantic(baseIndex,catalog,cx,cy,collisionAt);if(!WALKABLE.has(String(target)))continue;
      const context={topAbove:collisionAtSemantic(baseIndex,catalog,cx,cy-1,collisionAt),topLeft:collisionAtSemantic(baseIndex,catalog,cx-1,cy,collisionAt),topRight:collisionAtSemantic(baseIndex,catalog,cx+1,cy,collisionAt)};
      const horizontal=[context.topLeft,context.topRight].filter(v=>WALKABLE.has(String(v))).length;if(!horizontal)continue;
      const compatible=set.pathPrototypes.slice().sort((a,b)=>pathTopConnectorCost(a,context)-pathTopConnectorCost(b,context));if(!compatible.length||pathTopConnectorCost(compatible[0],context)>9.5)continue;
      const replaced=baseIndex.get(key(cx,cy))||null;
      const pseudo={id:`derived-${set.id}-${cx}-${cy}`,cell:[cx,cy],terrainSet:set.id,seed:hash32(`${document?.id||'level'}:${set.id}:connector:${cx},${cy}`),collisionMode:top.cell.collisionMode||'catalog',derivedConnector:'path-through-walkable',connectorFrom:[x,y],replacesCell:replaced};
      derived.set(key(cx,cy),pseudo);
    }
  }
  // If an edge/platform stroke is painted over an existing native climb-through path, preserve the path intersection instead of destroying it.
  for(const cell of document?.terrain||[]){
    const edgeSet=terrainSetById(catalog,cell.terrainSet);if(edgeSet?.kind!=='edge')continue;const [x,y]=cell.cell;if(String(collisionAt?.(x,y))!=='climb-through')continue;
    const pathSet=(catalog?.sets||[]).find(set=>set.group===edgeSet.group&&set.kind==='path'&&set.collision==='climb-through');if(!pathSet)continue;
    const left=collisionAtSemantic(baseIndex,catalog,x-1,y,collisionAt),right=collisionAtSemantic(baseIndex,catalog,x+1,y,collisionAt);if(!WALKABLE.has(String(left))&&!WALKABLE.has(String(right)))continue;
    const pseudo={id:`derived-${pathSet.id}-${x}-${y}`,cell:[x,y],terrainSet:pathSet.id,seed:hash32(`${document?.id||'level'}:${pathSet.id}:native-path-junction:${x},${y}`),collisionMode:cell.collisionMode||'catalog',derivedConnector:'preserve-native-path-junction',connectorFrom:[x,y],replacesCell:cell};
    derived.set(key(x,y),pseudo);
  }
  return derived;
}
function prototypeScore(prototype,document,set,anchorMaterial,context,visualContext=null){
  let score=0;
  score+=attachmentMismatch(prototype.bottomSupport,context.bottomSupport)*2.5;
  score+=attachmentMismatch(prototype.topLeft,context.topLeft)*2.5;
  score+=attachmentMismatch(prototype.topRight,context.topRight)*2.5;
  score+=attachmentMismatch(prototype.topAbove,context.topAbove)*2.8;
  if(String(prototype.bottomSupport)===String(context.bottomSupport))score-=0.5;
  const exactTop=[['topLeft','topLeft'],['topRight','topRight'],['topAbove','topAbove']].filter(([a,b])=>String(prototype[a])===String(context[b])).length;score-=exactTop*0.55;
  if(visualContext){for(const dir of ['N','E','W']){const expected=prototype.topNeighborVisualKeys?.[dir],actual=visualContext.top?.[dir];if(expected&&actual)score+=expected===actual?-3.4:.2;}if(prototype.bottomSupportVisualKey&&visualContext.bottom)score+=prototype.bottomSupportVisualKey===visualContext.bottom?-2.6:.15;if(String(visualContext.nativeTopCollision)===String(set.collision)&&prototype.topVisualKey&&visualContext.topSelf)score+=prototype.topVisualKey===visualContext.topSelf?-7.5:.2;if(String(visualContext.nativeBottomCollision)===String(set.collision)&&prototype.bottomVisualKey&&visualContext.bottomSelf)score+=prototype.bottomVisualKey===visualContext.bottomSelf?-6.5:.15;}
  if(Number(prototype.sourceMapId)===Number(document?.base?.mapId))score-=0.15;
  score-=Math.min(1.8,Math.log2(Math.max(1,Number(prototype.weight||1)))*0.32);
  score+=(hash32(`${anchorMaterial}:${prototype.id}`)/0xffffffff)*0.025;
  return score;
}

function pathPrototypeSourceIndex(targetIndex,targetLength,prototype){
  const sourceLength=prototype.sourceCells?.length||prototype.sourceLength||0;
  if(sourceLength&&targetLength===sourceLength)return Math.max(0,Math.min(sourceLength-1,targetIndex));
  if(targetIndex<=0)return 0;
  if(targetIndex>=targetLength-1)return Math.max(0,sourceLength-1);
  if(sourceLength>2)return 1+((targetIndex-1)%Math.max(1,sourceLength-2));
  return 0;
}
function pathSequenceScore(prototype,component,index,catalog,collisionAt,visualAt){
  const ordered=component.slice().sort((a,b)=>a.cell.cell[1]-b.cell.cell[1]||a.cell.cell[0]-b.cell.cell[0]),n=ordered.length;
  let score=Math.abs((prototype.sourceLength||prototype.sourceCells?.length||n)-n)*.45;
  if(n===prototype.sourceLength)score-=1.2;
  for(let i=0;i<n;i++){
    const [x,y]=ordered[i].cell.cell,si=pathPrototypeSourceIndex(i,n,prototype);
    const left=collisionAtSemantic(index,catalog,x-1,y,collisionAt),right=collisionAtSemantic(index,catalog,x+1,y,collisionAt);
    if(prototype.leftCollisions?.[si])score+=attachmentMismatch(prototype.leftCollisions[si],left)*1.15;
    if(prototype.rightCollisions?.[si])score+=attachmentMismatch(prototype.rightCollisions[si],right)*1.15;
    const lv=visualAt?.(x-1,y,'B'),rv=visualAt?.(x+1,y,'B');
    if(lv&&prototype.leftVisualKeys?.[si])score+=lv===prototype.leftVisualKeys[si]?-.95:.07;
    if(rv&&prototype.rightVisualKeys?.[si])score+=rv===prototype.rightVisualKeys[si]?-.95:.07;
  }
  return score;
}

function choosePathPrototype(document,set,component,index,catalog,collisionAt,visualAt=null){
  if(!set.pathPrototypes?.length)return null;
  const ordered=component.slice().sort((a,b)=>a.cell.cell[1]-b.cell.cell[1]||a.cell.cell[0]-b.cell.cell[0]),top=ordered[0],bottom=ordered[ordered.length-1],[tx,ty]=top.cell.cell,[bx,by]=bottom.cell.cell;
  const context={bottomSupport:collisionAtSemantic(index,catalog,bx,by+1,collisionAt),topAbove:collisionAtSemantic(index,catalog,tx,ty-1,collisionAt),topLeft:collisionAtSemantic(index,catalog,tx-1,ty,collisionAt),topRight:collisionAtSemantic(index,catalog,tx+1,ty,collisionAt)};
  const visualContext=visualAt?{top:{N:visualAt(tx,ty-1,'B'),E:visualAt(tx+1,ty,'B'),W:visualAt(tx-1,ty,'B')},topSelf:visualAt(tx,ty,'B'),bottomSelf:visualAt(bx,by,'B'),bottom:visualAt(bx,by+1,'B'),nativeTopCollision:collisionAt?.(tx,ty),nativeBottomCollision:collisionAt?.(bx,by)}:null;
  const anchored=WALKABLE.has(context.bottomSupport),anchor=anchored?[bx,by]:[tx,ty],anchorMaterial=`${document?.id||'level'}:${set.id}:${anchor.join(',')}`;
  let candidates=set.pathPrototypes;
  if(anchored){const grounded=candidates.filter(p=>WALKABLE.has(p.bottomSupport));if(grounded.length)candidates=grounded;}
  return candidates.slice().sort((a,b)=>(prototypeScore(a,document,set,anchorMaterial,context,visualContext)+pathSequenceScore(a,ordered,index,catalog,collisionAt,visualAt))-(prototypeScore(b,document,set,anchorMaterial,context,visualContext)+pathSequenceScore(b,ordered,index,catalog,collisionAt,visualAt)))[0]||null;
}
function prototypeVariant(set,prototype,sourceCell,role,phase,junctionOutputs=[]){
  const cell=sourceCell.slice(0,2);
  return {
    id:`${prototype.id}.${role}.${phase}`,
    sourceMapId:Number(prototype.sourceMapId),sourceCell:cell,sourceLayer:set.sourceLayer||'B',weight:Math.max(1,prototype.weight||1),
    outputs:[{sourceMapId:Number(prototype.sourceMapId),sourceCell:cell,sourceLayer:set.sourceLayer||'B',layer:set.sourceLayer||'B',targetOffset:[0,0],relationRole:'path'},...junctionOutputs],
    repeatKey:`${set.id}:${prototype.styleKey}`,overlay:junctionOutputs.some(o=>o.layer==='A'),pathPrototypeId:prototype.id,pathRole:role,pathPhase:phase
  };
}
function resolveVerticalPathComponent(document,catalog,set,component,index,{collisionAt=null,visualAt=null}={}){
  const prototype=choosePathPrototype(document,set,component,index,catalog,collisionAt,visualAt);if(!prototype)return[];
  const sorted=component.slice().sort((a,b)=>a.cell.cell[1]-b.cell.cell[1]||a.cell.cell[0]-b.cell.cell[0]);
  const bottomY=Math.max(...sorted.map(r=>Number(r.cell.cell[1]))),mids=prototype.middleCells?.length?prototype.middleCells:[prototype.topCell];
  return sorted.map(row=>{
    const [x,y]=row.cell.cell,below=collisionAtSemantic(index,catalog,x,y+1,collisionAt),left=collisionAtSemantic(index,catalog,x-1,y,collisionAt),right=collisionAtSemantic(index,catalog,x+1,y,collisionAt),role=pathRole(row.mask,below,left,right);
    let sourceCell=prototype.topCell,phase=0;
    const targetIndex=sorted.indexOf(row),directIndex=prototype.sourceCells?.length===sorted.length?targetIndex:-1;
    if(directIndex>=0){sourceCell=prototype.sourceCells[directIndex]||sourceCell;phase=directIndex;}
    else if(role==='bottom'){sourceCell=prototype.bottomCell;phase=0;}
    else if(role==='middle'){
      const distance=Math.max(1,bottomY-y),fromBottom=(distance-1)%mids.length,idx=mids.length-1-fromBottom;sourceCell=mids[idx]||mids[0];phase=idx;
    } else if(role==='top'){sourceCell=prototype.topCell;phase=0;}
    else if(WALKABLE.has(below)){sourceCell=prototype.bottomCell;phase=0;}
    const junctionOutputs=role==='top'?(prototype.junctionOutputs||[]).filter(output=>{const [ox,oy]=output.targetOffset||[0,0];const actual=collisionAtSemantic(index,catalog,x+ox,y+oy,collisionAt);return !output.requiresCollision||attachmentMismatch(output.requiresCollision,actual)<=0.75;}).map(o=>({...o,relationRole:o.relationRole||'junction'})):[];
    const variant=prototypeVariant(set,prototype,sourceCell,role,phase,junctionOutputs),attachmentContext=semanticNeighborContext(index,catalog,x,y,collisionAt);
    return {...row,variant,pathPrototypeId:prototype.id,pathRole:role,pathPhase:phase,attachmentContext,junctionOutputCount:junctionOutputs.length};
  });
}


function edgePrototypeSourceIndex(targetIndex,targetLength,sourceLength){
  if(sourceLength<=1)return 0;
  if(targetLength===sourceLength)return Math.max(0,Math.min(sourceLength-1,targetIndex));
  if(targetIndex<=0)return 0;
  if(targetIndex>=targetLength-1)return sourceLength-1;
  const interior=Math.max(1,sourceLength-2);
  return 1+((targetIndex-1)%interior);
}
function edgePrototypeScore(prototype,document,set,component,index,catalog,collisionAt,visualAt){
  const sorted=component.slice().sort((a,b)=>a.cell.cell[0]-b.cell.cell[0]),n=sorted.length;if(!n)return Infinity;
  const [x0,y]=sorted[0].cell.cell,[x1]=sorted[n-1].cell.cell;
  let score=Math.abs(Number(prototype.sourceLength||prototype.sourceCells.length)-n)*.75;
  score+=attachmentMismatch(prototype.leftCollision,collisionAtSemantic(index,catalog,x0-1,y,collisionAt))*3.4;
  score+=attachmentMismatch(prototype.rightCollision,collisionAtSemantic(index,catalog,x1+1,y,collisionAt))*3.4;
  const leftVisual=visualAt?.(x0-1,y,'B'),rightVisual=visualAt?.(x1+1,y,'B');
  if(leftVisual&&prototype.leftVisualKey)score+=leftVisual===prototype.leftVisualKey?-4.2:.22;
  if(rightVisual&&prototype.rightVisualKey)score+=rightVisual===prototype.rightVisualKey?-4.2:.22;
  for(let i=0;i<n;i++){
    const row=sorted[i],[x,cy]=row.cell.cell,si=edgePrototypeSourceIndex(i,n,prototype.sourceCells.length);
    const expectedMask=prototype.masks?.[si];if(expectedMask!=null)score+=expectedMask===row.mask?-.55:1.3*popcount4(expectedMask^row.mask);
    const north=collisionAtSemantic(index,catalog,x,cy-1,collisionAt),south=collisionAtSemantic(index,catalog,x,cy+1,collisionAt);
    if(prototype.northCollisions?.[si])score+=attachmentMismatch(prototype.northCollisions[si],north)*1.2;
    if(prototype.southCollisions?.[si])score+=attachmentMismatch(prototype.southCollisions[si],south)*1.2;
    const northVisual=visualAt?.(x,cy-1,'B'),southVisual=visualAt?.(x,cy+1,'B');
    if(northVisual&&prototype.northVisualKeys?.[si])score+=northVisual===prototype.northVisualKeys[si]?-.85:.06;
    if(southVisual&&prototype.southVisualKeys?.[si])score+=southVisual===prototype.southVisualKeys[si]?-.85:.06;
  }
  if(n===prototype.sourceLength)score-=1.4;
  if(Number(prototype.sourceMapId)===Number(document?.base?.mapId))score-=.25;
  score-=Math.min(.5,Math.log2(Math.max(1,prototype.weight||1))*.08);
  score+=(hash32(`${document?.id||'level'}:${set.id}:${x0},${y}:${prototype.id}`)/0xffffffff)*.01;
  return score;
}
function edgePrototypeVariant(set,prototype,sourceIndex,rowIndex,targetLength){
  const sourceCell=prototype.sourceCells[sourceIndex]||prototype.sourceCells[0],visualKey=prototype.visualKeys?.[sourceIndex]||null;
  const outputs=[{sourceMapId:Number(prototype.sourceMapId),sourceCell:sourceCell.slice(0,2),sourceLayer:set.sourceLayer||'B',layer:'B',targetOffset:[0,0],relationRole:'edge-prototype'}];
  if(prototype.planeA?.[sourceIndex])outputs.push({sourceMapId:Number(prototype.sourceMapId),sourceCell:sourceCell.slice(0,2),sourceLayer:'A',layer:'A',targetOffset:[0,0],relationRole:'edge-prototype-overlay'});
  const neighborVisualKeys={N:prototype.northVisualKeys?.[sourceIndex]||null,S:prototype.southVisualKeys?.[sourceIndex]||null,E:sourceIndex+1<prototype.visualKeys.length?prototype.visualKeys[sourceIndex+1]:prototype.rightVisualKey||null,W:sourceIndex>0?prototype.visualKeys[sourceIndex-1]:prototype.leftVisualKey||null};
  return {id:`${prototype.id}.cell.${sourceIndex}`,sourceMapId:Number(prototype.sourceMapId),sourceCell:sourceCell.slice(0,2),sourceLayer:set.sourceLayer||'B',weight:Math.max(1,prototype.weight||1),outputs,repeatKey:`${set.id}:edge:${prototype.styleKey}:${sourceIndex}`,visualKey,neighborVisualKeys,neighborContexts:[],overlay:outputs.some(o=>o.layer==='A'),edgePrototypeId:prototype.id,edgeRole:rowIndex===0?'start':rowIndex===targetLength-1?'end':'middle',edgePhase:sourceIndex};
}
function resolveHorizontalEdgePrototype(document,catalog,set,component,index,{collisionAt=null,visualAt=null}={}){
  if(!set.edgePrototypes?.length)return null;
  const sorted=component.slice().sort((a,b)=>a.cell.cell[0]-b.cell.cell[0]);
  const prototype=set.edgePrototypes.slice().sort((a,b)=>edgePrototypeScore(a,document,set,sorted,index,catalog,collisionAt,visualAt)-edgePrototypeScore(b,document,set,sorted,index,catalog,collisionAt,visualAt))[0];
  if(!prototype)return null;
  return sorted.map((row,i)=>{const si=edgePrototypeSourceIndex(i,sorted.length,prototype.sourceCells.length),variant=edgePrototypeVariant(set,prototype,si,i,sorted.length),[x,y]=row.cell.cell;return {...row,variant,edgePrototypeId:prototype.id,edgeRole:variant.edgeRole,edgePhase:si,attachmentContext:semanticNeighborContext(index,catalog,x,y,collisionAt)};});
}

function resolveHorizontalEdgeComponent(document,catalog,set,component,index,{collisionAt=null,visualAt=null}={}){
  const prototypeResolved=resolveHorizontalEdgePrototype(document,catalog,set,component,index,{collisionAt,visualAt});if(prototypeResolved?.length)return prototypeResolved;
  const sorted=component.slice().sort((a,b)=>a.cell.cell[0]-b.cell.cell[0]);if(!sorted.length)return[];
  const candidateLists=sorted.map(row=>row.rule?.variants?.length?row.rule.variants:[]);if(candidateLists.some(list=>!list.length))return[];
  const dp=[],back=[];
  for(let i=0;i<sorted.length;i++){
    const row=sorted[i],[x,y]=row.cell.cell,attachment=semanticNeighborContext(index,catalog,x,y,collisionAt),visual=nativeVisualContext(index,x,y,visualAt),list=candidateLists[i];dp[i]=new Array(list.length).fill(Infinity);back[i]=new Array(list.length).fill(-1);
    for(let j=0;j<list.length;j++){const v=list[j],nativeSelf=collisionAt?.(x,y),nativeVisual=visualAt?.(x,y,'B');let unary=variantAttachmentPenalty(v,attachment)+variantVisualContextPenalty(v,visual)-Math.min(.75,Math.log2(Math.max(1,v.weight||1))*.12)+(hash32(`${document?.id||'level'}:${set.id}:${x},${y}:${v.id}`)/0xffffffff)*.02;if(String(nativeSelf)===String(set.collision)&&nativeVisual&&v.visualKey)unary+=nativeVisual===v.visualKey?-7.5:.15;
      if(i===0){dp[i][j]=unary;continue;}
      for(let k=0;k<candidateLists[i-1].length;k++){const prev=candidateLists[i-1][k],cost=dp[i-1][k]+unary+visualPairPenalty(prev,v,'E','W');if(cost<dp[i][j]){dp[i][j]=cost;back[i][j]=k;}}
    }
  }
  let idx=dp.at(-1).reduce((best,v,i,a)=>v<a[best]?i:best,0),chosen=new Array(sorted.length);for(let i=sorted.length-1;i>=0;i--){chosen[i]=candidateLists[i][idx];idx=back[i][idx];if(i>0&&idx<0)idx=0;}
  return sorted.map((row,i)=>{const [x,y]=row.cell.cell;return {...row,variant:chosen[i],attachmentContext:semanticNeighborContext(index,catalog,x,y,collisionAt)};});
}

function resolveTerrainPlan(document,catalog,{nativeConnects=null,collisionAt=null,visualAt=null}={}){
  const baseIndex=buildTerrainIndex(document),derived=derivePathConnectorCells(document,catalog,baseIndex,{collisionAt}),index=new Map(baseIndex);for(const [k,cell] of derived)index.set(k,cell);
  const effectiveCells=(document?.terrain||[]).filter(cell=>!derived.has(key(cell.cell[0],cell.cell[1])));effectiveCells.push(...derived.values());
  const rows=effectiveCells.map(cell=>resolveRule(document,catalog,cell,index,{nativeConnects})).filter(Boolean);
  const plan=new Map(),byCell=new Map(),handled=new Set();

  for(const set of catalog?.sets||[]){
    if(set.kind!=='path'||!set.pathPrototypes?.length)continue;
    const setRows=rows.filter(row=>row.set.id===set.id);
    for(const component of pathComponents(setRows,set)){
      if(set.pathAxis==='vertical'&&component.every(row=>Number(row.cell.cell[0])===Number(component[0].cell.cell[0]))){
        for(const resolved of resolveVerticalPathComponent(document,catalog,set,component,index,{collisionAt,visualAt})){
          const [x,y]=resolved.cell.cell;plan.set(key(x,y),resolved);byCell.set(resolved.cell,resolved);if(resolved.cell.replacesCell)byCell.set(resolved.cell.replacesCell,resolved);handled.add(resolved.cell);
        }
      }
    }
  }

  for(const set of catalog?.sets||[]){
    if(set.kind!=='edge')continue;const setRows=rows.filter(row=>row.set.id===set.id&&!handled.has(row.cell));
    for(const component of horizontalComponents(setRows)){
      for(const resolved of resolveHorizontalEdgeComponent(document,catalog,set,component,index,{collisionAt,visualAt})){const [x,y]=resolved.cell.cell;plan.set(key(x,y),resolved);byCell.set(resolved.cell,resolved);if(resolved.cell.replacesCell)byCell.set(resolved.cell.replacesCell,resolved);handled.add(resolved.cell);}
    }
  }

  // Generic mixed/solid terrain deliberately stays on the 2D local resolver.
  // Running ordinary mass rows through the horizontal edge solver makes large fills
  // look strip-like and suppresses the deterministic jitter/vertical context matching.
  const genericRows=rows.filter(row=>!handled.has(row.cell)).sort((a,b)=>Number(a.cell.cell?.[1]||0)-Number(b.cell.cell?.[1]||0)||Number(a.cell.cell?.[0]||0)-Number(b.cell.cell?.[0]||0));
  for(const row of genericRows){
    const [x,y]=row.cell.cell.map(Number);
    const seedMaterial=`${row.seed}:${row.set.id}:${x}:${y}:${row.mask}:${row.diagonalMask}`;
    const west=plan.get(key(x-1,y))?.variant||null;
    const north=plan.get(key(x,y-1))?.variant||null;
    const northwest=plan.get(key(x-1,y-1))?.variant||null;
    const northeast=plan.get(key(x+1,y-1))?.variant||null;
    const attachmentContext=semanticNeighborContext(index,catalog,x,y,collisionAt),visualContext=nativeVisualContext(index,x,y,visualAt);
    const variant=chooseVariantWithPlan(row.rule,seedMaterial,[west,north,northwest,northeast],attachmentContext,visualContext)||chooseTerrainVariant(row.rule,seedMaterial);
    if(!variant)continue;
    const resolved={...row,variant,attachmentContext};
    plan.set(key(x,y),resolved);byCell.set(row.cell,resolved);if(row.cell.replacesCell)byCell.set(row.cell.replacesCell,resolved);
  }
  return {index,rows:[...plan.values()],byCell};
}

function resolveTerrainCellFromIndex(document,catalog,cell,index,{nativeConnects=null}={}){
  const set=terrainSetById(catalog,cell?.terrainSet); if(!set)return null;
  const [x,y]=(cell.cell||[]).map(Number);
  const mask=terrainNeighborMask(index,set,x,y,{nativeConnects});
  const diagonalMask=terrainDiagonalMask(index,set,x,y,{nativeConnects});
  const rule=matchTerrainRule(set,mask,diagonalMask); if(!rule)return null;
  const seed=Number.isInteger(Number(cell.seed))?Number(cell.seed):hash32(`${document?.id||'level'}:${set.id}:${x}:${y}`);
  const variant=chooseVariantWithPlan(rule,`${seed}:${set.id}:${x}:${y}:${mask}:${diagonalMask}`) || chooseTerrainVariant(rule,`${seed}:${set.id}:${x}:${y}:${mask}:${diagonalMask}`); if(!variant)return null;
  return {cell,set,mask,diagonalMask,rule,variant};
}
export function resolveTerrainCell(document,catalog,cell,{nativeConnects=null,collisionAt=null,visualAt=null}={}){
  return resolveTerrainPlan(document,catalog,{nativeConnects,collisionAt,visualAt}).byCell.get(cell)||resolveTerrainCellFromIndex(document,catalog,cell,buildTerrainIndex(document),{nativeConnects})||null;
}

function horizontalComponents(rows){
  const byPos=new Map(rows.map(r=>[key(r.cell.cell[0],r.cell.cell[1]),r])),seen=new Set(),components=[];
  for(const row of rows){if(seen.has(row.cell))continue;const q=[row],component=[];seen.add(row.cell);while(q.length){const cur=q.shift();component.push(cur);const [x,y]=cur.cell.cell;for(const dx of [-1,1]){const n=byPos.get(key(x+dx,y));if(n&&!seen.has(n.cell)){seen.add(n.cell);q.push(n);}}}components.push(component.sort((a,b)=>a.cell.cell[0]-b.cell.cell[0]));}return components;
}
function supportAnchorRole(context){
  const w=String(context?.W||'pass-through')==='one-way',e=String(context?.E||'pass-through')==='one-way';
  if(w&&e)return'interior';if(w)return'right-end';if(e)return'left-end';return'isolated';
}
export function rankSupportPrototypes(document,catalog,relation,{collisionAt=null,visualAt=null,index=null}={}){
  const set=terrainSetById(catalog,relation?.terrainSet);if(!set?.supportPrototypes?.length)return[];
  const [x,y]=(relation.anchor||[]).map(Number),endY=Number(relation.end?.[1]??y),desiredLength=Math.max(1,endY-y),terrainIndex=index||buildTerrainIndex(document),context=semanticNeighborContext(terrainIndex,catalog,x,y,collisionAt),role=supportAnchorRole(context),nativeVisual=visualAt?.(x,y,'B')||null,terminal=contextBucket(collisionAtSemantic(terrainIndex,catalog,x,endY,collisionAt)),seed=`${relation.seed??0}:${document?.id||'level'}:${set.id}:support:${x},${y}:${desiredLength}`;
  return set.supportPrototypes.map(prototype=>{
    let score=0;
    if(prototype.neighborContext)for(const dir of ['N','E','S','W'])score+=attachmentMismatch(prototype.neighborContext[dir],context[dir]);
    const prototypeRole=supportAnchorRole(prototype.neighborContext);if(prototypeRole!==role)score+=prototypeRole==='interior'||role==='interior'?1.8:.7;
    if(prototype.terminalCollision&&terminal!=='open')score+=contextBucket(prototype.terminalCollision)===terminal?-1.25:.55;
    if(nativeVisual&&prototype.platformVisualKey)score+=nativeVisual===prototype.platformVisualKey?-7.5:.35;
    score+=Math.min(2.4,Math.abs(Number(prototype.sourceLength||desiredLength)-desiredLength)*.16);
    if(Number(prototype.sourceMapId)===Number(document?.base?.mapId))score-=.35;
    score-=Math.log2(Math.max(1,prototype.weight||1))*.3;
    score+=(hash32(`${seed}:${prototype.id}`)/0xffffffff)*.025;
    return {prototype,score,context,role,desiredLength,nativeVisual};
  }).sort((a,b)=>a.score-b.score||String(a.prototype.id).localeCompare(String(b.prototype.id)));
}
function emitSupportStem(out,prototype,set,x,y,length,{submap,mapId,relationId,index,catalog,collisionAt=null,relationPrefix='explicit-support'}={}){
  const pattern=prototype.stemCells||[],maxDepth=Math.max(1,Math.min(64,Number(length||0)|0));let emittedCells=0;
  for(let dy=1;dy<=maxDepth;dy++){
    if(contextBucket(collisionAtSemantic(index,catalog,x,y+dy,collisionAt))!=='open')break;
    const src=pattern[(dy-1)%pattern.length];if(!src)break;
    for(let qy=0;qy<2;qy++)for(let qx=0;qx<2;qx++)out.push({submap:Number(submap),mapId:Number(mapId),target:[x*2+qx,(y+dy)*2+qy],source:[src[0]*2+qx,src[1]*2+qy],sourceMapId:Number(prototype.sourceMapId),layer:'A',sourceLayer:'A',operation:'copy',authority:'autotile-relation',terrainSet:set.id,terrainCell:[x,y],relationRole:'support-stem',supportMode:relationPrefix,supportPrototypeId:prototype.id,terrainRelationId:relationId});
    emittedCells++;
  }
  return emittedCells;
}
function resolvePlatformSupportOverrides(document,catalog,plan,{collisionAt=null,visualAt=null,submap=document?.base?.submap,mapId=document?.base?.mapId}={}){
  const out=[];
  for(const relation of document?.terrainRelations||[]){
    if(relation?.type!=='support'||relation.direction!=='down')continue;
    const set=terrainSetById(catalog,relation.terrainSet);if(!set||set.kind!=='edge'||!set.supportPrototypes?.length)continue;
    const [x,y]=(relation.anchor||[]).map(Number),endY=Number(relation.end?.[1]??y),length=endY-y;if(!finiteInt(x)||!finiteInt(y)||length<1)continue;
    const authored=plan.index.get(key(x,y)),anchorCollision=authored?terrainSetById(catalog,authored.terrainSet)?.collision:collisionAt?.(x,y);
    if(String(anchorCollision)!==String(set.collision))continue;
    const ranked=rankSupportPrototypes(document,catalog,relation,{collisionAt,visualAt,index:plan.index});
    const forced=relation.prototypeId?set.supportPrototypes.find(p=>p.id===relation.prototypeId):null,prototype=forced||ranked[0]?.prototype;if(!prototype)continue;
    // A support relation is explicit authoring intent. Only then may the solver replace the cap and grow a pole downward.
    for(const layer of ['B','A'])for(let qy=0;qy<2;qy++)for(let qx=0;qx<2;qx++)out.push({submap:Number(submap),mapId:Number(mapId),target:[x*2+qx,y*2+qy],source:[prototype.platformCell[0]*2+qx,prototype.platformCell[1]*2+qy],sourceMapId:Number(prototype.sourceMapId),layer,sourceLayer:layer,operation:'copy',authority:'autotile-relation',terrainSet:set.id,terrainCell:[x,y],relationRole:'support-anchor',supportMode:'explicit-support',supportPrototypeId:prototype.id,terrainRelationId:relation.id});
    emitSupportStem(out,prototype,set,x,y,length,{submap,mapId,relationId:relation.id,index:plan.index,catalog,collisionAt,relationPrefix:'explicit-support'});
  }
  return out;
}
export function resolveTerrainVisualOverrides(document,catalog,{nativeConnects=null,collisionAt=null,visualAt=null,submap=document?.base?.submap,mapId=document?.base?.mapId}={}){
  const out=[];
  const plan=resolveTerrainPlan(document,catalog,{nativeConnects,collisionAt,visualAt});
  for(const resolved of plan.rows){
    const [x,y]=resolved.cell.cell.map(Number);
    for(const output of resolved.variant.outputs||[]){
      const [sx,sy]=output.sourceCell,[ox,oy]=output.targetOffset||[0,0];
      for(let qy=0;qy<2;qy++)for(let qx=0;qx<2;qx++) out.push({
        submap:Number(submap),mapId:Number(mapId),target:[(x+ox)*2+qx,(y+oy)*2+qy],source:[sx*2+qx,sy*2+qy],sourceMapId:Number(output.sourceMapId),
        layer:output.layer||'B',sourceLayer:output.sourceLayer||resolved.set.sourceLayer||'B',operation:'copy',authority:'autotile',terrainSet:resolved.set.id,terrainCell:[x,y],mask:resolved.mask,diagonalMask:resolved.diagonalMask,variantId:resolved.variant.id,repeatKey:resolved.variant.repeatKey,
        ...(resolved.pathPrototypeId?{pathPrototypeId:resolved.pathPrototypeId,pathRole:resolved.pathRole,pathPhase:resolved.pathPhase}: {}),...(resolved.edgePrototypeId?{edgePrototypeId:resolved.edgePrototypeId,edgeRole:resolved.edgeRole,edgePhase:resolved.edgePhase}: {}),...(output.relationRole?{relationRole:output.relationRole}:{}),...(resolved.cell.derivedConnector?{derivedConnector:resolved.cell.derivedConnector}:{})
      });
    }
  }
  out.push(...resolvePlatformSupportOverrides(document,catalog,plan,{collisionAt,visualAt,submap,mapId}));
  return out;
}

export function resolveTerrainCollisionOverrides(document,catalog,{nativeConnects=null,collisionAt=null,visualAt=null,submap=document?.base?.submap,mapId=document?.base?.mapId}={}){
  const out=[],plan=resolveTerrainPlan(document,catalog,{nativeConnects,collisionAt,visualAt});
  for(const resolved of plan.rows){
    const cell=resolved.cell,set=resolved.set;if(!set)continue;
    const mode=TERRAIN_COLLISION_MODES.includes(String(cell?.collisionMode))?String(cell.collisionMode):'catalog';
    if(mode!=='catalog'||!set.collision||set.collision==='preserve')continue;
    const [x,y]=(cell.cell||[]).map(Number);if(!finiteInt(x)||!finiteInt(y))continue;
    out.push({submap:Number(submap),mapId:Number(mapId),logic:[x+1,y+1],collision:set.collision,authority:cell.derivedConnector?'autotile-relation':'autotile',terrainSet:set.id,terrainCell:[x,y],...(cell.derivedConnector?{derivedConnector:cell.derivedConnector}:{})});
  }
  return out;
}

export function autotileDebugRows(document,catalog,{nativeConnects=null,collisionAt=null,visualAt=null}={}){
  return resolveTerrainPlan(document,catalog,{nativeConnects,collisionAt,visualAt}).rows.map(r=>({
    terrainSet:r.set.id,cell:r.cell.cell.slice(0,2),mask:r.mask,diagonalMask:r.diagonalMask,variantId:r.variant.id,sourceMapId:r.variant.outputs?.[0]?.sourceMapId ?? r.variant.sourceMapId,sourceCell:(r.variant.outputs?.[0]?.sourceCell||r.variant.sourceCell).slice(0,2),collision:r.cell.collisionMode==='catalog'?r.set.collision:'preserve',outputs:(r.variant.outputs||[]).map(o=>({layer:o.layer,sourceLayer:o.sourceLayer,sourceMapId:o.sourceMapId,sourceCell:o.sourceCell.slice(0,2)})),
    attachmentContext:r.attachmentContext||null,junctionOutputCount:Number(r.junctionOutputCount||0),...(r.pathPrototypeId?{pathPrototypeId:r.pathPrototypeId,pathRole:r.pathRole,pathPhase:r.pathPhase}: {}),...(r.edgePrototypeId?{edgePrototypeId:r.edgePrototypeId,edgeRole:r.edgeRole,edgePhase:r.edgePhase}: {}),...(r.cell.derivedConnector?{derivedConnector:r.cell.derivedConnector}:{})
  }));
}
