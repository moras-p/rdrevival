import { element } from './dom.js';

function thumbnail(frame) {
  const canvas = element('canvas', { className:'pn-thumb', attrs:{ width:48, height:48 } });
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  if (!frame?.pixels) return canvas;
  const source = document.createElement('canvas');
  source.width = frame.pixels.width; source.height = frame.pixels.height;
  const sourceCtx = source.getContext('2d');
  sourceCtx.putImageData(new ImageData(new Uint8ClampedArray(frame.pixels.data), frame.pixels.width, frame.pixels.height), 0, 0);
  const scale=Math.max(1,Math.min(4,Math.floor(Math.min(44/frame.pixels.width,44/frame.pixels.height))));
  const width=frame.pixels.width*scale,height=frame.pixels.height*scale;
  ctx.drawImage(source,Math.floor((48-width)/2),Math.floor((48-height)/2),width,height);
  return canvas;
}

export function createPnPicker({ assets, mapId, currentPn = null, onSelect = () => {} } = {}) {
  const wrapper=element('div',{className:'pn-picker'});
  if (!assets?.spriteDecoder) return wrapper;
  const search=element('input',{className:'pn-search',attrs:{type:'search',placeholder:'Filter PN…','aria-label':'Filter presentation sprites'}});
  const grid=element('div',{className:'pn-grid'});
  const palette=assets.palettes.forMap(Number(mapId)).rgba;
  const catalog=assets.spriteDecoder.parsePnCatalog().filter(row=>row?.start!=null && row.count>0);
  const render=()=>{
    grid.replaceChildren(); const query=search.value.trim().toLowerCase();
    for (const row of catalog) {
      if (query && !String(row.index).includes(query) && !String(row.direction||'').toLowerCase().includes(query)) continue;
      let frame=null; try{frame=assets.spriteDecoder.frameForPn(row.index,0,palette);}catch{}
      if (!frame?.pixels) continue;
      const button=element('button',{className:'pn-option',attrs:{type:'button','aria-pressed':String(Number(currentPn)===Number(row.index)),title:`PN ${row.index} · ${row.count} frame${row.count===1?'':'s'} · ${row.direction||'neutral'}`}});
      button.append(thumbnail(frame),element('span',{text:`PN ${row.index}`}));
      button.addEventListener('click',()=>onSelect(Number(row.index)));
      grid.append(button);
    }
    if (!grid.childElementCount) grid.append(element('div',{className:'muted',text:'No matching PN frames.'}));
  };
  search.addEventListener('input',render); render(); wrapper.append(search,grid); return wrapper;
}
