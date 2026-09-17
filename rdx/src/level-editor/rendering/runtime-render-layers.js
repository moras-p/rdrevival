import { DEBUG_PRIMITIVE } from '../runtime/runtime-sample.js';
import { drawPixelBuffer, drawWorldRect } from './pixel-canvas-renderer.js';

function rdxOrigin(project) {
  const pane = project?.panes?.find(row => row.id === 'rdx');
  return pane ? { x:Number(pane.x) || 0, y:Number(pane.y) || 0 } : null;
}

function screenPoint(viewport, point, project) {
  const origin = rdxOrigin(project);
  if (!origin || !Array.isArray(point) || point.length < 2) return null;
  return viewport.worldToScreen(origin.x + Number(point[0]), origin.y + Number(point[1]));
}

function debugStyle(type) {
  if (type === DEBUG_PRIMITIVE.SUPER_PAD) return ['#55e6ff', 2, [5,2]];
  if ([DEBUG_PRIMITIVE.WALKABLE, DEBUG_PRIMITIVE.LADDER, DEBUG_PRIMITIVE.IMPENETRABLE].includes(type)) return ['#72a786', 1, [2,3]];
  if ([DEBUG_PRIMITIVE.PROJECTILE, DEBUG_PRIMITIVE.LETHAL, DEBUG_PRIMITIVE.HAZARD].includes(type)) return ['#dc7272', 2, []];
  if ([DEBUG_PRIMITIVE.PATH, DEBUG_PRIMITIVE.PATROL].includes(type)) return ['#d78ed8', 1.5, [4,3]];
  if ([DEBUG_PRIMITIVE.EMITTER, DEBUG_PRIMITIVE.ACTIVATION].includes(type)) return ['#d6b66a', 1.5, [3,2]];
  if (type === DEBUG_PRIMITIVE.PLATFORM_BODY) return ['#72b9d6', 2, []];
  return ['#b7c6d2', 1, []];
}

function descriptorState(frame, entity) {
  return entity?.sourceKey ? frame.runtime?.wholeRoomStates?.get(String(entity.sourceKey)) || null : null;
}

function liveActor(frame, entity) {
  return entity?.sourceKey ? frame.runtime?.liveActors?.get(String(entity.sourceKey)) || null : null;
}

function matchingVariant(entity, presentation) {
  if (!presentation) return null;
  const pn = Number(presentation.pn);
  const mirrorX = !!presentation.mirrorX, mirrorY = !!presentation.mirrorY;
  return (entity?.runtimeSpriteVariants || []).find(row => Number(row.pn) === pn && !!row.mirrorX === mirrorX && !!row.mirrorY === mirrorY)
    || (entity?.runtimeSpriteVariants || []).find(row => Number(row.pn) === pn)
    || null;
}

function animationFrame(entity, tick, presentation = null) {
  const variant = matchingVariant(entity, presentation);
  const animation = variant?.animation || entity?.runtimeSpriteAnimation || entity?.spriteAnimation || null;
  const frames = animation?.frames || [];
  if (!frames.length) {
    const staticSprite = variant?.frame?.pixels || entity?.runtimeSprite || entity?.sprite;
    const metadata = variant?.presentation || entity?.runtimeSpritePresentation || entity?.spritePresentation;
    return staticSprite ? { pixels:staticSprite, originX:Number(metadata?.originX)||0, originY:Number(metadata?.originY)||0 } : null;
  }
  let remaining = Math.max(0, Math.floor(Number(tick) || 0));
  const rawLoop = animation?.loopOffset;
  const loop = Number.isInteger(rawLoop) && rawLoop >= 0 && rawLoop < frames.length ? rawLoop : null;
  const duration = index => {
    const raw = Number(frames[index]?.duration) || 1;
    return raw === 0xffff ? Number.POSITIVE_INFINITY : Math.max(1, raw);
  };
  const introEnd = loop == null ? frames.length : loop;
  for (let index=0; index<introEnd; index+=1) {
    const d=duration(index); if (remaining < d) return frames[index]; remaining -= d;
  }
  if (loop == null) return frames[frames.length - 1];
  const loopDuration = frames.slice(loop).reduce((sum,row) => sum + (Number(row?.duration) === 0xffff ? 0 : Math.max(1, Number(row?.duration) || 1)), 0);
  if (loopDuration > 0) remaining %= loopDuration;
  for (let index=loop; index<frames.length; index+=1) {
    const d=duration(index); if (remaining < d) return frames[index]; remaining -= d;
  }
  return frames[frames.length - 1];
}

function motionDelta(frame, entity) {
  const actor = liveActor(frame, entity);
  const origin = rdxOrigin(frame.project);
  if (actor?.worldGeometry?.position && entity?.runtimeBodyPoint && origin) {
    const x = origin.x + Number(actor.worldGeometry.position[0]);
    const y = origin.y + Number(actor.worldGeometry.position[1]);
    const dx = x - Number(entity.runtimeBodyPoint.x), dy = y - Number(entity.runtimeBodyPoint.y);
    if (Number.isFinite(dx) && Number.isFinite(dy)) return { dx, dy, actor, state:null, authority:actor.authority };
  }
  const state = descriptorState(frame, entity);
  if (!state) return null;
  const dx = Number(state.position?.[0]) - Number(state.basePosition?.[0]);
  const dy = Number(state.position?.[1]) - Number(state.basePosition?.[1]);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  return { dx, dy, actor:null, state, authority:state.authority };
}

export function runtimeEntityGeometry(frame, entity) {
  if (!frame?.runtime?.active || entity?.kind !== 'semantic-object') return null;
  const motion = motionDelta(frame, entity);
  if (!motion) return null;
  const presentation = motion.actor?.presentation || null;
  const visible = presentation ? presentation.visible !== false : entity.runtimeVisible !== false;
  const actorDepth = String(presentation?.actorDepth || entity.runtimeActorDepth || entity.actorDepth || ((presentation?.front ?? entity.runtimeFront ?? entity.front) ? 'front' : 'normal'));
  const front = actorDepth === 'front';
  const tick = presentation?.tick ?? frame.runtime.sample?.simulationTick ?? frame.runtime.tick ?? 0;
  const spriteFrame = animationFrame(entity, tick, presentation);
  const anchor = entity.runtimePresentationPoint || entity.presentationPoint;
  const point = anchor ? { x:Number(anchor.x)+motion.dx, y:Number(anchor.y)+motion.dy } : null;
  const sprite = spriteFrame?.pixels || entity.runtimeSprite || entity.sprite || null;
  const draw = point && sprite ? { x:point.x-Number(spriteFrame?.originX||0), y:point.y-Number(spriteFrame?.originY||0) }
    : (entity.spriteDraw ? { x:Number(entity.spriteDraw.x)+motion.dx, y:Number(entity.spriteDraw.y)+motion.dy } : null);
  const rect = entity.rect ? { ...entity.rect, x:Number(entity.rect.x)+motion.dx, y:Number(entity.rect.y)+motion.dy } : null;
  return Object.freeze({ ...motion, sprite, draw, rect, visible, actorDepth, front, tick, presentation });
}

function drawRuntimeActors(ctx, frame, { depth='normal' }={}) {
  if (!frame.runtime?.active) return;
  const selected = new Set((frame.selection || []).map(row => String(row.id)));
  for (const entity of frame.project?.entities || []) {
    if (entity.kind !== 'semantic-object') continue;
    const geometry = runtimeEntityGeometry(frame, entity);
    if (!geometry || geometry.actorDepth !== depth) continue;
    if (geometry.visible && geometry.sprite && geometry.draw) drawPixelBuffer(ctx, frame.viewport, geometry.sprite, geometry.draw.x, geometry.draw.y);
    if (selected.has(String(entity.id)) && geometry.rect) drawWorldRect(ctx, frame.viewport, geometry.rect, { stroke:'#f7d96a', lineWidth:2 });
  }
}

export function createRuntimeRenderLayers({ runtime, runtimeView, visibility={} }={}) {
  return [
    { id:'runtime-embedded-actors', order:17, render(ctx,frame){ drawRuntimeActors(ctx,frame,{depth:'behind-midground'}); } },
    { id:'runtime-actors', order:24, render(ctx,frame){ drawRuntimeActors(ctx,frame,{depth:'normal'}); } },
    { id:'runtime-front-actors', order:28, render(ctx,frame){ drawRuntimeActors(ctx,frame,{depth:'front'}); } },
    {
      id:'native-intended-paths', order:70, visible:()=>visibility.intended?.()!==false,
      render(ctx,frame) {
        if (!rdxOrigin(frame.project)) return;
        const selectedIds=new Set((frame.selection||[]).map(row=>String(row.id)));
        const selectedSources=new Set((frame.project?.entities||[]).filter(row=>selectedIds.has(String(row.id))&&row.sourceKey).map(row=>String(row.sourceKey)));
        for (const descriptor of runtime.state.descriptors || []) {
          const path=descriptor?.world?.path || []; if (path.length < 2) continue;const active=selectedSources.has(String(descriptor.sourceKey));
          const points=path.map(point=>screenPoint(frame.viewport,point,frame.project)).filter(Boolean);if(points.length<2)continue;
          ctx.save();ctx.lineCap='round';ctx.lineJoin='round';ctx.setLineDash(active?[7,4]:[4,5]);ctx.strokeStyle=active?'rgba(4,7,9,.9)':'rgba(4,7,9,.5)';ctx.lineWidth=active?4:3;ctx.beginPath();points.forEach((p,index)=>index?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();
          ctx.strokeStyle=active?'#ffe37f':'rgba(229,189,71,.42)';ctx.lineWidth=active?2:1;ctx.stroke();ctx.setLineDash([]);
          for(const [index,p] of points.entries()){if(index!==0&&index!==points.length-1)continue;ctx.fillStyle=active?'#ffe37f':'rgba(229,189,71,.55)';ctx.beginPath();ctx.arc(p.x,p.y,active?3:2,0,Math.PI*2);ctx.fill();}
          ctx.restore();
        }
      }
    },
    {
      id:'native-debug-geometry', order:80, visible:()=>visibility.geometry?.()!==false,
      render(ctx,frame) {
        const origin=rdxOrigin(frame.project), sample=runtimeView();
        if(!origin || !sample?.debugGeometry || sample.debugGeometry.space!=='rdx-world-px') return;
        for(const primitive of sample.debugGeometry.primitives || []) {
          const type=Number(primitive.type), [stroke,width,dash]=debugStyle(type);
          const a=frame.viewport.worldToScreen(origin.x+Number(primitive.x0),origin.y+Number(primitive.y0));
          const b=frame.viewport.worldToScreen(origin.x+Number(primitive.x1),origin.y+Number(primitive.y1));
          ctx.save(); ctx.strokeStyle=stroke; ctx.lineWidth=width; ctx.setLineDash(dash);
          if([DEBUG_PRIMITIVE.PATH,DEBUG_PRIMITIVE.PATROL,DEBUG_PRIMITIVE.EMITTER].includes(type)) { ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke(); }
          else ctx.strokeRect(Math.min(a.x,b.x),Math.min(a.y,b.y),Math.max(1,Math.abs(b.x-a.x)),Math.max(1,Math.abs(b.y-a.y)));
          ctx.restore();
        }
      }
    },
    {
      id:'native-observation-traces', order:90, visible:()=>visibility.traces?.()!==false,
      render(ctx,frame) {
        if(!rdxOrigin(frame.project)) return;
        ctx.save(); ctx.strokeStyle='rgba(126,205,138,.62)'; ctx.lineWidth=1; ctx.setLineDash([2,3]);
        for(const points of runtime.timeline.traces().values()) {
          if(points.length<2)continue; ctx.beginPath();
          points.forEach((point,index)=>{const p=screenPoint(frame.viewport,point,frame.project);if(!p)return;if(index)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);}); ctx.stroke();
        }
        ctx.restore();
      }
    }
  ];
}
