import { drawPixelBuffer, drawWorldRect, worldToScreen } from './pixel-canvas-renderer.js';

const ENTITY_STROKE = Object.freeze({
  enemy:'#e67676', 'moving-platform':'#76b5e6', platform:'#76b5e6', trap:'#e6a676', mechanism:'#c989e8',
  shooter:'#e6cf76', 'projectile-emitter':'#e6cf76', collectible:'#86d58e', trigger:'#e9a2cf', blockage:'#c7a46e', source:'#8fa2b2'
});
const BOUNDS_STROKE = Object.freeze({ visual:'#d885d3', gameplay:'#e5d66c', trigger:'#e68ab7', support:'#74c5de' });
const COLLISION_FILL = Object.freeze({ solid:'rgb(230 91 91 / 24%)', 'one-way':'rgb(237 201 80 / 25%)', ladder:'rgb(83 191 130 / 24%)', lethal:'rgb(236 83 170 / 28%)', open:'rgb(93 174 229 / 18%)', exit:'rgb(255 255 255 / 18%)' });

function selectedIds(frame) { return new Set((frame.selection || []).map(row => String(row.id))); }
function screenPoint(viewport, point) { return worldToScreen(viewport, point); }
function strokeLine(context, viewport, from, to, stroke, width = 1, dash = []) {
  const a = screenPoint(viewport, from), b = screenPoint(viewport, to);
  context.save(); context.strokeStyle = stroke; context.lineWidth = width; context.setLineDash(dash); context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke(); context.restore();
}
function pane(frame, id) { return frame.project?.panes?.find(row => row.id === id); }
function animatedByRuntime(frame, entity) {
  if (!frame.runtime?.active || !entity?.sourceKey || !(entity.runtimeSprite || entity.sprite)) return false;
  const key=String(entity.sourceKey), live=frame.runtime.liveActors?.get(key) || null;
  if (live?.worldGeometry?.position && entity.runtimeBodyPoint) return true;
  return frame.runtime.wholeRoomStates?.has(key) || false;
}

export function createStaticRenderLayers() {
  return [
    {
      id:'room-backing', order:0,
      render(context, frame) {
        for (const item of frame.project?.panes || []) {
          const point=screenPoint(frame.viewport,{x:item.x,y:item.y}), width=Math.max(1,item.width*frame.viewport.zoom), height=Math.max(1,item.height*frame.viewport.zoom);
          context.save();context.shadowColor='rgba(0,0,0,.72)';context.shadowBlur=28;context.shadowOffsetY=12;context.fillStyle='#020406';context.fillRect(point.x,point.y,width,height);context.restore();
          context.save();context.strokeStyle='rgba(105,128,145,.58)';context.lineWidth=1;context.strokeRect(Math.round(point.x)+.5,Math.round(point.y)+.5,Math.max(1,Math.round(width)-1),Math.max(1,Math.round(height)-1));context.restore();
        }
      }
    },
    {
      id:'static-background', order:10,
      render(context, frame) {
        for (const item of frame.project?.panes || []) {
          const buffer = item.id === 'rdx' ? (item.backdrop || item.background) : item.pixels;
          drawPixelBuffer(context, frame.viewport, buffer, item.x, item.y);
        }
      }
    },
    {
      id:'grid', order:15,
      render(context, frame) {
        if (frame.viewport.zoom < 2) return;
        context.save(); context.strokeStyle = 'rgb(255 255 255 / 9%)'; context.lineWidth = 1; context.beginPath();
        for (const item of frame.project?.panes || []) {
          for (let x = 0; x <= item.width; x += 8) { const a=screenPoint(frame.viewport,{x:item.x+x,y:item.y}), b=screenPoint(frame.viewport,{x:item.x+x,y:item.y+item.height}); context.moveTo(Math.round(a.x)+.5,a.y); context.lineTo(Math.round(b.x)+.5,b.y); }
          for (let y = 0; y <= item.height; y += 8) { const a=screenPoint(frame.viewport,{x:item.x,y:item.y+y}), b=screenPoint(frame.viewport,{x:item.x+item.width,y:item.y+y}); context.moveTo(a.x,Math.round(a.y)+.5); context.lineTo(b.x,Math.round(b.y)+.5); }
        }
        context.stroke(); context.restore();
      }
    },
    {
      id:'embedded-entities', order:17,
      render(context, frame) {
        for (const entity of frame.project?.entities || []) {
          if (animatedByRuntime(frame, entity)) continue;
          const depth=String(entity.actorDepth || (entity.front ? 'front' : 'normal'));
          if (entity.visible !== false && depth === 'behind-midground' && entity.sprite && entity.spriteDraw)
            drawPixelBuffer(context, frame.viewport, entity.sprite, entity.spriteDraw.x, entity.spriteDraw.y);
        }
      }
    },
    {
      id:'static-foreground-behind-actors', order:18,
      render(context, frame) {
        const item = pane(frame, 'rdx');
        const midground=item?.midground || item?.foregroundBehindActors;
        if (midground) drawPixelBuffer(context, frame.viewport, midground, item.x, item.y);
      }
    },
    {
      id:'entities', order:20,
      render(context, frame) {
        const selected = selectedIds(frame);
        for (const entity of frame.project?.entities || []) {
          if (animatedByRuntime(frame, entity)) continue;
          if (entity.visible !== false && String(entity.actorDepth || (entity.front ? 'front' : 'normal')) === 'normal' && entity.sprite && entity.spriteDraw) drawPixelBuffer(context, frame.viewport, entity.sprite, entity.spriteDraw.x, entity.spriteDraw.y);
          const isSelected=selected.has(entity.id),hasPresentation=entity.visible !== false && !!entity.sprite;
          if(isSelected || !hasPresentation){const stroke=isSelected?'#ffe37f':(ENTITY_STROKE[entity.class] || ENTITY_STROKE[entity.kind] || '#7fb0cf');drawWorldRect(context,frame.viewport,entity.rect,{stroke,lineWidth:isSelected?2:1});}
        }
      }
    },
    {
      id:'static-foreground', order:25,
      render(context, frame) {
        const item = pane(frame, 'rdx');
        if (item?.foreground) drawPixelBuffer(context, frame.viewport, item.foreground, item.x, item.y);
      }
    },
    {
      id:'front-entities', order:27,
      render(context, frame) {
        for (const entity of frame.project?.entities || []) if (!animatedByRuntime(frame, entity) && entity.visible !== false && String(entity.actorDepth || (entity.front ? 'front' : 'normal')) === 'front' && entity.sprite && entity.spriteDraw) drawPixelBuffer(context, frame.viewport, entity.sprite, entity.spriteDraw.x, entity.spriteDraw.y);
      }
    },
    {
      id:'collision', order:30,
      render(context, frame) {
        for (const cell of frame.project?.collision || []) {
          const changed = cell.rawKind !== cell.effectiveKind;
          drawWorldRect(context, frame.viewport, cell.rect, { fill:COLLISION_FILL[cell.effectiveKind] || 'rgb(255 255 255 / 12%)', stroke:changed ? '#ffffff' : null, lineWidth:changed ? 1 : 0 });
          if (cell.exitAnchor && cell.exitBounds) {
            const op=cell.override || {}, direction=String(op.direction || 'right').toLowerCase();
            const midY=cell.exitBounds.y + cell.exitBounds.height/2;
            const left=cell.exitBounds.x + 2, right=cell.exitBounds.x + cell.exitBounds.width - 2;
            const from=direction === 'left' ? {x:right,y:midY} : {x:left,y:midY};
            const to=direction === 'left' ? {x:left,y:midY} : {x:right,y:midY};
            strokeLine(context,frame.viewport,from,to,'#ffffff',2);
            const tip=screenPoint(frame.viewport,to), angle=direction === 'left' ? Math.PI : 0;
            context.save();context.fillStyle='#ffffff';context.translate(tip.x,tip.y);context.rotate(angle);context.beginPath();context.moveTo(0,0);context.lineTo(-6,-3);context.lineTo(-6,3);context.closePath();context.fill();context.restore();
            const labelAt=screenPoint(frame.viewport,{x:cell.exitBounds.x-2,y:cell.exitBounds.y-3});
            const target=Number(op.targetSubmap), rowOut=Number(op.contactRow), rowIn=Number(op.rowIn);
            const sm=Number.isInteger(target) ? `SM${target.toString(16).toUpperCase().padStart(2,'0')}` : 'exit';
            context.save();context.fillStyle='#ffffff';context.font='10px monospace';context.textAlign='right';context.textBaseline='bottom';
            context.fillText(`${sm} ${rowOut.toString(16).padStart(2,'0')}→${rowIn.toString(16).padStart(2,'0')}`,labelAt.x,labelAt.y);context.restore();
          }
        }
      }
    },
    {
      id:'correspondence', order:31,
      render(context, frame) {
        for (const cell of frame.project?.correspondence || []) {
          if (!cell.mapped) { drawWorldRect(context, frame.viewport, cell.rect, { fill:'rgb(125 125 125 / 22%)', stroke:'rgb(210 210 210 / 40%)', dash:[2,2] }); continue; }
          const dx = Number(cell.dxPx ?? cell.dx ?? cell.shiftX ?? 0), dy = Number(cell.dyPx ?? cell.dy ?? cell.shiftY ?? 0);
          const shifted = dx !== 0 || dy !== 0;
          drawWorldRect(context, frame.viewport, cell.rect, { fill:shifted ? 'rgb(103 145 224 / 18%)' : 'rgb(95 193 153 / 10%)', stroke:shifted ? 'rgb(139 175 235 / 55%)' : null });
        }
      }
    },
    {
      id:'provenance', order:32,
      render(context, frame) {
        for (const region of frame.project?.provenanceRegions || []) drawWorldRect(context, frame.viewport, region.rect, { fill:region.layer === 'D' ? 'rgb(233 137 80 / 16%)' : 'rgb(176 112 222 / 16%)', stroke:region.layer === 'D' ? '#dd8b5d' : '#b17ad3', dash:[4,2] });
      }
    },
    {
      id:'relationships', order:34,
      render(context, frame) {
        for (const relation of frame.project?.relationships || []) {
          strokeLine(context, frame.viewport, relation.fromPoint, relation.toPoint, '#e7c96f', 1, [4,3]);
          const to=screenPoint(frame.viewport, relation.toPoint), from=screenPoint(frame.viewport, relation.fromPoint), angle=Math.atan2(to.y-from.y,to.x-from.x);
          context.save(); context.fillStyle='#e7c96f'; context.translate(to.x,to.y); context.rotate(angle); context.beginPath(); context.moveTo(0,0); context.lineTo(-6,-3); context.lineTo(-6,3); context.closePath(); context.fill(); context.restore();
        }
      }
    },
    {
      id:'bounds', order:40,
      render(context, frame) {
        for (const row of frame.project?.boundsOverlay || []) drawWorldRect(context, frame.viewport, row.rect, { stroke:BOUNDS_STROKE[row.kind] || '#ffffff', lineWidth:1, dash:row.kind === 'visual' ? [3,2] : null });
      }
    },
    {
      id:'selection', order:50,
      render(context, frame) {
        const selected = selectedIds(frame);
        for (const group of [frame.project?.entities, frame.project?.correspondence, frame.project?.collision, frame.project?.provenanceRegions]) for (const item of group || []) if (selected.has(item.id) && item.rect) {
          drawWorldRect(context, frame.viewport, item.rect, { stroke:'rgba(4,7,9,.92)', lineWidth:4 });
          drawWorldRect(context, frame.viewport, item.rect, { stroke:'#ffe37f', lineWidth:2 });
        }
      }
    },
    {
      id:'pane-labels', order:60,
      render(context, frame) {
        context.save();context.font='600 10px ui-monospace, SFMono-Regular, Menlo, monospace';context.textBaseline='middle';
        for (const item of frame.project?.panes || []) {
          const point=screenPoint(frame.viewport,{x:item.x,y:item.y}),label=item.id==='rdx'?`RDX  ·  ${frame.project.sourceView}`:'CLASSIC  ·  LAYER B',metrics=context.measureText(label),width=Math.ceil(metrics.width)+14;
          const y=point.y-23;context.fillStyle='rgba(6,10,14,.94)';context.strokeStyle='rgba(71,91,106,.8)';context.lineWidth=1;context.beginPath();context.roundRect?.(point.x,y,width,19,4);if(context.roundRect){context.fill();context.stroke();}else{context.fillRect(point.x,y,width,19);context.strokeRect(point.x+.5,y+.5,width-1,18);}
          context.fillStyle=item.id==='rdx'?'#f1d165':'#a9bac8';context.fillText(label,point.x+7,y+10);
        }
        context.restore();
      }
    }
  ];
}
