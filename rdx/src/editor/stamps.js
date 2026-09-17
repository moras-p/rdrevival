export const STAMP_CATALOG_SCHEMA='rdx.stamp_catalog.v1';
const clone=v=>JSON.parse(JSON.stringify(v));
const finiteInt=v=>Number.isInteger(Number(v));
const key=(x,y)=>`${Number(x)},${Number(y)}`;

function normalizeContext(rows){return (Array.isArray(rows)?rows:[]).map(row=>({offset:Array.isArray(row?.offset)?row.offset.slice(0,2).map(Number):[0,0],collision:String(row?.collision||'pass-through'),visualB:String(row?.visualB||'')})).filter(row=>row.offset.every(finiteInt));}

export function normalizeStampCatalog(input){
  const source=clone(input||{});
  if(source.schema!==STAMP_CATALOG_SCHEMA)throw new Error(`Unsupported stamp catalog schema ${source.schema||'missing'}`);
  source.version=String(source.version||'');
  source.elements=(Array.isArray(source.elements)?source.elements:[]).map((element,index)=>{
    const normalizeOutput=output=>{const sourceLayer=String(output?.sourceLayer||output?.plane||output?.layer||'B').toUpperCase(),layer=String(output?.layer||output?.plane||sourceLayer).toUpperCase();return {sourceMapId:Number(output?.sourceMapId),sourceCell:Array.isArray(output?.sourceCell)?output.sourceCell.slice(0,2).map(Number):[0,0],sourceLayer,layer,globalTile:Number(output?.globalTile),paletteLine:Number(output?.paletteLine||0),hFlip:!!output?.hFlip,vFlip:!!output?.vFlip};};
    const legacy=normalizeOutput(element),outputs=(Array.isArray(element?.outputs)&&element.outputs.length?element.outputs.map(normalizeOutput):[legacy]).filter(output=>finiteInt(output.sourceMapId)&&output.sourceCell.every(finiteInt)&&['A','B'].includes(output.sourceLayer)&&['A','B'].includes(output.layer));
    const primary=outputs.find(output=>output.layer==='A')||outputs[0]||legacy;
    return {
      id:String(element?.id||`stamp-element-${index}`),label:String(element?.label||element?.id||`Tile ${index+1}`),group:String(element?.group||''),category:String(element?.category||'tile'),description:String(element?.description||''),
      ...primary,outputs,repeatCount:Math.max(1,Number(element?.repeatCount||1)|0)
    };
  }).filter(element=>element.outputs.length&&finiteInt(element.sourceMapId)&&element.sourceCell.every(finiteInt)&&['A','B'].includes(element.sourceLayer)&&['A','B'].includes(element.layer));
  source.stamps=(Array.isArray(source.stamps)?source.stamps:[]).map((stamp,index)=>({
    id:String(stamp?.id||`stamp-${index}`),label:String(stamp?.label||stamp?.id||`Stamp ${index+1}`),group:String(stamp?.group||''),category:String(stamp?.category||'decor'),familyId:String(stamp?.familyId||''),description:String(stamp?.description||''),
    sourceMapId:Number(stamp?.sourceMapId),originCell:Array.isArray(stamp?.originCell)?stamp.originCell.slice(0,2).map(Number):[0,0],sizeCells:Array.isArray(stamp?.sizeCells)?stamp.sizeCells.slice(0,2).map(Number):[1,1],
    planes:(Array.isArray(stamp?.planes)?stamp.planes:['A']).map(p=>String(p).toUpperCase()).filter(p=>p==='A'||p==='B'),
    repeatCount:Math.max(1,Number(stamp?.repeatCount||1)|0),mapCount:Math.max(1,Number(stamp?.mapCount||1)|0),sampling:String(stamp?.sampling||'component'),
    terrainFootprint:(Array.isArray(stamp?.terrainFootprint)?stamp.terrainFootprint:[]).map(row=>({offset:Array.isArray(row?.offset)?row.offset.slice(0,2).map(Number):[0,0],terrainSet:String(row?.terrainSet||'')})).filter(row=>row.terrainSet&&row.offset.every(finiteInt)),
    occurrences:(Array.isArray(stamp?.occurrences)?stamp.occurrences:[]).slice(0,24).map(row=>({sourceMapId:Number(row?.sourceMapId),originCell:Array.isArray(row?.originCell)?row.originCell.slice(0,2).map(Number):[0,0]})).filter(row=>finiteInt(row.sourceMapId)&&row.originCell.every(finiteInt)),
    context:normalizeContext(stamp?.context), mirrorable: stamp?.mirrorable!==false
  })).filter(stamp=>finiteInt(stamp.sourceMapId)&&stamp.originCell.every(finiteInt)&&stamp.sizeCells.every(v=>finiteInt(v)&&Number(v)>0)&&stamp.planes.length);
  const byStamp=new Map(source.stamps.map(s=>[s.id,s]));
  source.families=(Array.isArray(source.families)?source.families:[]).map((family,index)=>{
    const variantIds=(Array.isArray(family?.variantIds)?family.variantIds:[]).map(String).filter(id=>byStamp.has(id));
    const variants=variantIds.map(id=>byStamp.get(id));
    const sorted=variants.slice().sort((a,b)=>a.sizeCells[0]*a.sizeCells[1]-b.sizeCells[0]*b.sizeCells[1]||b.repeatCount-a.repeatCount||a.id.localeCompare(b.id));
    return {
      id:String(family?.id||`stamp-family-${index}`),label:String(family?.label||family?.id||`Stamp family ${index+1}`),group:String(family?.group||variants[0]?.group||''),category:String(family?.category||variants[0]?.category||'decor'),description:String(family?.description||''),
      variantPolicy:family?.variantPolicy==='weighted-common'?'weighted-common':'context-ranked',
      variantIds,defaultVariantId:String(family?.defaultVariantId&&byStamp.has(family.defaultVariantId)?family.defaultVariantId:(sorted[Math.floor(sorted.length/2)]?.id||variantIds[0]||'')),
      stageVariantIds:(Array.isArray(family?.stageVariantIds)?family.stageVariantIds.map(String).filter(id=>byStamp.has(id)):sorted.map(s=>s.id)),
      minSize:sorted[0]?.sizeCells?.slice()||[1,1],maxSize:sorted[sorted.length-1]?.sizeCells?.slice()||[1,1]
    };
  }).filter(f=>f.variantIds.length);
  if(!source.families.length){
    const groups=new Map();
    for(const stamp of source.stamps){const id=stamp.familyId||`${stamp.group}.${stamp.category}`;let f=groups.get(id);if(!f){f={id,label:stamp.category,group:stamp.group,category:stamp.category,description:'',variantIds:[]};groups.set(id,f)}f.variantIds.push(stamp.id);}
    source.families=[...groups.values()].map(f=>({...f,defaultVariantId:f.variantIds[0],stageVariantIds:f.variantIds.slice()}));
  }
  const familyMap=new Map(source.families.map(f=>[f.id,f]));
  for(const stamp of source.stamps){if(!stamp.familyId){const f=source.families.find(v=>v.variantIds.includes(stamp.id));stamp.familyId=f?.id||'';} }
  source._familyMap=familyMap;
  return source;
}
export function stampElementById(catalog,id){return catalog?.elements?.find(element=>element.id===id)||null;}
export function stampElementsForGroup(catalog,group){return (catalog?.elements||[]).filter(element=>!element.group||element.group===group);}
export function stampById(catalog,id){return catalog?.stamps?.find(s=>s.id===id)||null;}
export function stampsForGroup(catalog,group){return (catalog?.stamps||[]).filter(s=>!s.group||s.group===group);}
export function stampFamilyById(catalog,id){return catalog?.families?.find(f=>f.id===id)||null;}
export function stampFamiliesForGroup(catalog,group){return (catalog?.families||[]).filter(f=>!f.group||f.group===group);}
export function familyForStamp(catalog,stampId){const stamp=stampById(catalog,stampId);return stamp?stampFamilyById(catalog,stamp.familyId)||catalog?.families?.find(f=>f.variantIds.includes(stamp.id))||null:null;}
export function variantsForFamily(catalog,family){const f=typeof family==='string'?stampFamilyById(catalog,family):family;return (f?.variantIds||[]).map(id=>stampById(catalog,id)).filter(Boolean);}

function collisionMismatch(a,b){if(a===b)return 0;if((a==='solid'||a==='one-way'||a==='climb-through')&&(b==='solid'||b==='one-way'||b==='climb-through'))return 2.2;return 1;}
function visualMismatch(a,b){if(!a||!b)return 0;if(a===b)return -0.45;return 0.15;}
export function rankStampVariants(document,catalog,family,cell,{collisionAt=null,visualAt=null,targetSize=null,currentMapId=document?.base?.mapId}={}){
  const f=typeof family==='string'?stampFamilyById(catalog,family):family;if(!f)return[];const [cx,cy]=(cell||[]).map(Number),target=Array.isArray(targetSize)?targetSize.map(Number):null;
  const rows=[];
  for(const stamp of variantsForFamily(catalog,f)){
    let score=0;
    if(target){const [tw,th]=target,[w,h]=stamp.sizeCells;score+=Math.abs(w-tw)*1.15+Math.abs(h-th)*1.15+Math.abs(w*h-tw*th)*0.18;}
    for(const ctx of stamp.context||[]){const dx=cx+ctx.offset[0],dy=cy+ctx.offset[1];if(collisionAt)score+=collisionMismatch(String(ctx.collision||'pass-through'),String(collisionAt(dx,dy)||'pass-through'))*1.8;if(visualAt)score+=visualMismatch(ctx.visualB,visualAt(dx,dy,'B'));}
    if(Number(stamp.sourceMapId)===Number(currentMapId))score-=0.55;
    score-=Math.min(1.25,Math.log2(Math.max(1,stamp.repeatCount))*0.18+Math.log2(Math.max(1,stamp.mapCount))*0.24);
    const area=stamp.sizeCells[0]*stamp.sizeCells[1];score+=area*0.002;
    rows.push({stamp,score});
  }
  rows.sort((a,b)=>a.score-b.score||b.stamp.mapCount-a.stamp.mapCount||b.stamp.repeatCount-a.stamp.repeatCount||a.stamp.id.localeCompare(b.stamp.id));return rows;
}

export function chooseStampStage(catalog,family,targetSize){const f=typeof family==='string'?stampFamilyById(catalog,family):family;if(!f)return null;const ids=f.stageVariantIds?.length?f.stageVariantIds:f.variantIds;const variants=ids.map(id=>stampById(catalog,id)).filter(Boolean);if(!variants.length)return null;const [tw,th]=targetSize||[1,1];return variants.slice().sort((a,b)=>{const da=Math.abs(a.sizeCells[0]-tw)+Math.abs(a.sizeCells[1]-th)+Math.abs(a.sizeCells[0]*a.sizeCells[1]-tw*th)*0.15,db=Math.abs(b.sizeCells[0]-tw)+Math.abs(b.sizeCells[1]-th)+Math.abs(b.sizeCells[0]*b.sizeCells[1]-tw*th)*0.15;return da-db||a.sizeCells[0]*a.sizeCells[1]-b.sizeCells[0]*b.sizeCells[1];})[0];}

function stablePlacementHash(value){let h=2166136261>>>0;for(const c of String(value)){h^=c.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return h>>>0;}
export function chooseStampVariantForPlacement(catalog,family,ranked,cell,{currentMapId=null}={}){
  const f=typeof family==='string'?stampFamilyById(catalog,family):family,rows=(Array.isArray(ranked)?ranked:[]).filter(row=>row?.stamp);if(!f||!rows.length)return null;
  if(f.variantPolicy!=='weighted-common')return rows[0].stamp;
  const maxFrequency=Math.max(...rows.map(row=>Math.max(1,Number(row.stamp.repeatCount)||1))),threshold=Math.max(2,maxFrequency*.35),common=rows.filter(row=>Math.max(1,Number(row.stamp.repeatCount)||1)>=threshold).slice(0,8),pool=common.length?common:rows.slice(0,8);
  const weights=pool.map(row=>Math.max(1,Number(row.stamp.repeatCount)||1)*Math.max(1,Math.sqrt(Number(row.stamp.mapCount)||1))),total=weights.reduce((sum,value)=>sum+value,0),[cx,cy]=(cell||[0,0]).map(Number);let pick=(stablePlacementHash(`${f.id}:${Number(currentMapId)||0}:${cx}:${cy}`)/0x100000000)*total;
  for(let i=0;i<pool.length;i++){pick-=weights[i];if(pick<0)return pool[i].stamp;}return pool[pool.length-1].stamp;
}

export function resolveStampVisualOverrides(document,catalog,{submap=document?.base?.submap,mapId=document?.base?.mapId}={}){
  const out=[];
  for(const placement of document?.stamps||[]){
    const stamp=stampById(catalog,placement?.variantId||placement?.stampId);if(!stamp)continue;
    const mirrorX=!!placement?.mirrorX;
    const [tx,ty]=(placement.cell||[]).map(Number),[sx,sy]=stamp.originCell,[w,h]=stamp.sizeCells;
    if(!finiteInt(tx)||!finiteInt(ty))continue;
    for(const layer of stamp.planes){
      for(let cy=0;cy<h;cy++)for(let cx=0;cx<w;cx++)for(let qy=0;qy<2;qy++)for(let qx=0;qx<2;qx++){
        const localGx=cx*2+qx, sourceLocalGx=mirrorX?(w*2-1-localGx):localGx;
        out.push({
          submap:Number(submap),mapId:Number(mapId),target:[(tx+cx)*2+qx,(ty+cy)*2+qy],source:[sx*2+sourceLocalGx,sy*2+cy*2+qy],sourceMapId:Number(stamp.sourceMapId),layer,sourceLayer:layer,operation:'copy',authority:'stamp',stampId:stamp.id,stampFamilyId:placement.familyId||stamp.familyId||'',stampPlacementId:placement.id,stampCell:[tx,ty],mirrorX
        });
      }
    }
  }
  return out;
}

export function terrainFootprintForPlacement(stamp,cell,{mirrorX=false}={}){
  const [x,y]=(cell||[]).map(Number);
  const w=Array.isArray(stamp?.sizeCells)?Number(stamp.sizeCells[0]||1):1;
  return (stamp?.terrainFootprint||[]).map(row=>({cell:[x+(mirrorX?(w-1-row.offset[0]):row.offset[0]),y+row.offset[1]],terrainSet:row.terrainSet}));
}
