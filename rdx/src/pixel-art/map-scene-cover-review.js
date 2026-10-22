/** Deterministic, review-only normal-actor cover alternatives. No plan is
 * accepted artwork: source ownership and native acceptance remain independent.
 * Candidate masks only hide *currently visible, opaque* source-actor pixels
 * within a supplied review region and next to existing foreground artwork. */
import { validateMapScene } from './map-scene.js';
import { createSceneDraft, applySceneCoverPixels, sceneDraftPlan } from './map-scene-edit.js';
import { newSceneProbe, renderSceneProbe } from './map-scene-probe.js';
import { requireArt } from './document.js';

const inside = (x,y,r) => x>=r[0] && y>=r[1] && x<r[0]+r[2] && y<r[1]+r[3];

export function prepareSceneCoverReview(scene,{actorId,reviewRect,variants=[
  {id:'edge',label:'Edge trim',radius:1},
  {id:'feather',label:'Feather overlap',radius:2},
  {id:'deep',label:'Deeper root concealment',radius:3}
]}={}) {
  validateMapScene(scene);
  requireArt(Array.isArray(reviewRect)&&reviewRect.length===4&&reviewRect.every(Number.isInteger)&&
    reviewRect[2]>0&&reviewRect[3]>0&&reviewRect[2]<=128&&reviewRect[3]<=128,
  'REVIEW_SCOPE','Expected a bounded integer review rectangle');
  const [ox,oy,w,h]=scene.cropWorld;
  requireArt(inside(reviewRect[0],reviewRect[1],scene.cropWorld) &&
    inside(reviewRect[0]+reviewRect[2]-1,reviewRect[1]+reviewRect[3]-1,scene.cropWorld),
  'REVIEW_SCOPE','Review rectangle must fit the canonical scene crop');
  const probe=newSceneProbe(scene,actorId);
  const source=probe.source.sourceRgba;
  requireArt(probe.source.kind!=='test-pn' && source && probe.source.band==='actors' &&
    source.worldRect.every(Number.isInteger) && Array.isArray(scene.coverMasks?.normal),
  'REVIEW_ACTOR','A uniquely verified full-source normal actor is required');
  const baseline=renderSceneProbe(scene,{probe});
  requireArt(baseline.pixels.every((n,i)=>n===scene.bands.composite[i]),
  'REVIEW_PARITY','Original decoded actor does not reproduce the canonical image');
  requireArt(Array.isArray(variants)&&variants.length>0&&variants.length<=4&&
    new Set(variants.map(v=>v.id)).size===variants.length &&
    variants.every(v=>/^[a-z][a-z0-9-]{0,23}$/.test(v?.id)&&typeof v.label==='string'&&v.label.length<=64&&
      Number.isInteger(v.radius)&&v.radius>=1&&v.radius<=3),
  'REVIEW_VARIANTS','Expected distinct variants with foreground distance 1..3');

  const draft=createSceneDraft(scene);
  const [sx,sy,sw,sh]=source.worldRect;
  const candidates=[];
  for(const variant of variants) {
    const points=[];
    for(let y=reviewRect[1];y<reviewRect[1]+reviewRect[3];y++)for(let x=reviewRect[0];x<reviewRect[0]+reviewRect[2];x++) {
      if(!inside(x,y,source.worldRect))continue;
      const idx=(y-oy)*w+x-ox;
      if(!source.rgba[((y-sy)*sw+x-sx)*4+3] || scene.coverMasks.normal[idx] ||
        scene.bands.foreground[idx*4+3] || scene.bands.frontActors[idx*4+3])continue;
      const entry=draft.coverCells.get(`A:${Math.floor(x/8)}:${Math.floor(y/8)}`);
      if(!entry || entry.scope?.sourceKey!==actorId ||
        ((Number.parseInt(entry.editableRows[y&7],16) >>> (x&7))&1)===0)continue;
      let adjacent=false;
      for(let dy=-variant.radius;dy<=variant.radius&&!adjacent;dy++)for(let dx=-variant.radius;dx<=variant.radius;dx++) {
        if(Math.abs(dx)+Math.abs(dy)>variant.radius)continue;
        const tx=x+dx,ty=y+dy;
        if(tx<ox||ty<oy||tx>=ox+w||ty>=oy+h)continue;
        if(scene.bands.foreground[((ty-oy)*w+tx-ox)*4+3]) { adjacent=true; break; }
      }
      if(adjacent)points.push({worldX:x,worldY:y,cover:1});
    }
    requireArt(points.length>0,'REVIEW_EMPTY',`${variant.id} does not affect an authorized visible actor pixel`);
    const local=createSceneDraft(scene);
    applySceneCoverPixels(local,{points,expectedRevision:0});
    const plan=sceneDraftPlan(local);
    requireArt(plan.assets.length===0 && plan.changedCoverPixels===points.length,
      'REVIEW_PLAN','Review plan must modify only the selected actor-cover bits');
    const preview=renderSceneProbe(scene,{draft:local,probe});
    const changed=[];
    for(let i=0;i<w*h;i++) {
      const k=i*4;
      if(baseline.pixels.slice(k,k+4).some((n,c)=>n!==preview.pixels[k+c]))changed.push([ox+i%w,oy+Math.floor(i/w)]);
    }
    requireArt(changed.length>0 && changed.every(([x,y])=>points.some(p=>p.worldX===x&&p.worldY===y)),
      'REVIEW_PARITY','Preview changed pixels outside the approved actor mask');
    candidates.push({id:variant.id,label:variant.label,radius:variant.radius,plan,points:points.map(p=>[p.worldX,p.worldY]),
      changedWorldPixels:changed,preview:preview.pixels});
  }
  return {sourceFingerprint:scene.sourceFingerprint,room:scene.room,actorId,reviewRect,
    baseline:baseline.pixels,candidates,
    warning:'Review alternatives only: normal cover also masks Rick and other normal actors; use native parity and human aesthetic acceptance before promotion.'};
}
