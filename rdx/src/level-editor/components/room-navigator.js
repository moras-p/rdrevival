import { pixelBufferCanvas } from '../rendering/pixel-canvas-renderer.js';

function pane(project){return project?.panes?.find(row=>row.id==='rdx')||project?.panes?.[0]||null;}

export class RoomNavigator {
  constructor({canvas,host=null,viewport,onNavigate=null}={}){
    if(!canvas||!viewport)throw new TypeError('RoomNavigator requires canvas and viewport');
    this.canvas=canvas;this.host=host;this.viewport=viewport;this.onNavigate=onNavigate;this.context=canvas.getContext('2d');this.context.imageSmoothingEnabled=false;this.project=null;
    this.pointerHandler=event=>this.centerAt(event);canvas.addEventListener('pointerdown',this.pointerHandler);
  }
  setProject(project){this.project=project;this.render();}
  layout(){const item=pane(this.project);if(!item)return null;const width=this.canvas.width,height=this.canvas.height,pad=4,scale=Math.min((width-pad*2)/Math.max(1,item.width),(height-pad*2)/Math.max(1,item.height)),drawWidth=item.width*scale,drawHeight=item.height*scale;return {item,scale,x:(width-drawWidth)/2,y:(height-drawHeight)/2};}
  render(){const ctx=this.context,layout=this.layout();ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,this.canvas.width,this.canvas.height);ctx.fillStyle='#030507';ctx.fillRect(0,0,this.canvas.width,this.canvas.height);if(!layout){if(this.host)this.host.hidden=true;return;}if(this.host)this.host.hidden=false;const {item,scale,x,y}=layout,background=item.id==='rdx'?(item.backdrop||item.background):item.pixels;if(background)ctx.drawImage(pixelBufferCanvas(background),Math.round(x),Math.round(y),Math.max(1,Math.round(item.width*scale)),Math.max(1,Math.round(item.height*scale)));if(item.id==='rdx'&&(item.midground||item.foregroundBehindActors))ctx.drawImage(pixelBufferCanvas(item.midground||item.foregroundBehindActors),Math.round(x),Math.round(y),Math.max(1,Math.round(item.width*scale)),Math.max(1,Math.round(item.height*scale)));if(item.id==='rdx'&&item.foreground)ctx.drawImage(pixelBufferCanvas(item.foreground),Math.round(x),Math.round(y),Math.max(1,Math.round(item.width*scale)),Math.max(1,Math.round(item.height*scale)));const topLeft=this.viewport.screenToWorld(0,0),bottomRight=this.viewport.screenToWorld(this.viewport.cssWidth,this.viewport.cssHeight),vx=x+(topLeft.x-item.x)*scale,vy=y+(topLeft.y-item.y)*scale,vw=(bottomRight.x-topLeft.x)*scale,vh=(bottomRight.y-topLeft.y)*scale;ctx.save();ctx.strokeStyle='#ffe37f';ctx.fillStyle='rgba(229,189,71,.09)';ctx.lineWidth=1;ctx.fillRect(vx,vy,vw,vh);ctx.strokeRect(Math.round(vx)+.5,Math.round(vy)+.5,Math.round(vw),Math.round(vh));ctx.restore();}
  centerAt(event){const layout=this.layout();if(!layout)return;const rect=this.canvas.getBoundingClientRect(),sx=this.canvas.width/Math.max(1,rect.width),sy=this.canvas.height/Math.max(1,rect.height),x=(event.clientX-rect.left)*sx,y=(event.clientY-rect.top)*sy;this.viewport.centerOn(layout.item.x+(x-layout.x)/layout.scale,layout.item.y+(y-layout.y)/layout.scale);this.onNavigate?.();this.render();}
  dispose(){this.canvas.removeEventListener('pointerdown',this.pointerHandler);}
}
