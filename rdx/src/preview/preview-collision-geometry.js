import { opaqueDrawBounds } from './preview-render-primitives.js';

export function controllerBodyCollisionBounds({ placement, source, currentPresentationOrigin = null,
  phaseZeroPresentationOrigin = null, liveControllerOrigin = null } = {}) {
  const width = Number(source?.w || 0), height = Number(source?.h || 0);
  const phaseZero = placement?.phaseZeroControllerOrigin || placement?.effectiveControllerOrigin || placement?.alignedOrigin || null;
  if (width <= 0 || height <= 0 || !Array.isArray(phaseZero)) return null;
  let x = Number(phaseZero[0]), y = Number(phaseZero[1]);
  if (Array.isArray(liveControllerOrigin) && liveControllerOrigin.length >= 2) {
    x = Number(liveControllerOrigin[0]); y = Number(liveControllerOrigin[1]);
  } else if (Array.isArray(currentPresentationOrigin) && Array.isArray(placement?.presentationOriginOffset)) {
    /* Layer-E snapshots can represent a later patrol phase than the resolved
     * phase-zero controller. Reconstruct the controller owning the pixels that
     * are currently displayed from the same presentation residual used by
     * whole-room Simulate. SM0E mark:173 is captured 36 px left of phase zero;
     * keeping its hazard at phase zero made the box appear beside the enemy. */
    x = Number(currentPresentationOrigin[0]) - Number(placement.presentationOriginOffset[0]);
    y = Number(currentPresentationOrigin[1]) - Number(placement.presentationOriginOffset[1]);
  } else if (Array.isArray(currentPresentationOrigin) && Array.isArray(phaseZeroPresentationOrigin)) {
    x += Number(currentPresentationOrigin[0]) - Number(phaseZeroPresentationOrigin[0]);
    y += Number(currentPresentationOrigin[1]) - Number(phaseZeroPresentationOrigin[1]);
  }
  if (![x,y,width,height].every(Number.isFinite)) return null;
  return Object.freeze({ x:Math.round(x), y:Math.round(y), width:Math.round(width), height:Math.round(height) });
}

export function fittedClassicCollisionBounds(opaque, source) {
  const width = Number(source?.w || 0), height = Number(source?.h || 0);
  if (!opaque || width <= 0 || height <= 0) return opaque || null;
  const centerTwice = opaque.x * 2 + opaque.width - 1;
  const left = Math.floor((centerTwice - (width - 1)) / 2);
  const bottom = opaque.y + opaque.height - 1;
  return Object.freeze({ x:left, y:bottom - height + 1, width, height });
}

export function classicSpriteOpaqueExtents(classicData, sprite) {
  const pixels = classicData?.sprites?.[Number(sprite)];
  const width = Number(classicData?.spriteWidth || 32), height = Number(classicData?.spriteHeight || 21);
  if (!Array.isArray(pixels) || pixels.length < width * height) return null;
  let minX=width,minY=height,maxX=-1,maxY=-1;
  for(let y=0;y<height;y+=1)for(let x=0;x<width;x+=1){
    if(!Number(pixels[y*width+x]||0))continue;
    minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);
  }
  return maxX<minX?null:Object.freeze({minX,minY,maxX,maxY});
}

export function classicProjectileCollisionCenter(classicData, classic, draw) {
  const source=classic?.source||{};
  const activeSprite=Number(source?.spriteSequence?.active?.[0] ?? classic?.sprite ?? source?.sprite);
  const extents=classicSpriteOpaqueExtents(classicData,activeSprite);
  const x=Number(draw?.[0]||0),y=Number(draw?.[1]||0);
  if(!extents)return Object.freeze([x+12,y+5]);
  const centerTwice=x*2+extents.minX+extents.maxX;
  const left=Math.trunc((centerTwice-4)/2);
  return Object.freeze([left+2,y+extents.maxY-1]);
}

export function classicType1aContactSweep(classicData, source, points) {
  const path=(points||[]).filter(point=>Array.isArray(point)&&point.length>=2&&Number.isFinite(Number(point[0]))&&Number.isFinite(Number(point[1])));
  const entityWidth=Math.max(1,Number(source?.w||0)), entityHeight=Math.max(1,Number(source?.h||0));
  const sprbase=Number(source?.sprbase ?? source?.sprite);
  if(!path.length||!Number.isFinite(sprbase))return null;
  const frames=[];
  for(let offset=0;offset<6;offset+=1){
    const extents=classicSpriteOpaqueExtents(classicData,sprbase+offset);
    if(extents)frames.push(extents);
  }
  if(!frames.length)return null;
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const point of path){
    const entityX=Number(point[0]), entityY=Number(point[1])-entityHeight;
    for(const frame of frames){
      const centerTwice=entityX*2+frame.minX+frame.maxX;
      /* Match C integer division for the positive whole-room coordinates used
       * by the editor patrol corpus. */
      const left=Math.trunc((centerTwice-(entityWidth-1))/2);
      const right=left+entityWidth-1;
      const bottom=entityY+frame.maxY;
      const top=bottom-entityHeight+1;
      minX=Math.min(minX,left);maxX=Math.max(maxX,right);minY=Math.min(minY,top);maxY=Math.max(maxY,bottom);
    }
  }
  return Number.isFinite(minX)?Object.freeze({minX,maxX,minY,maxY,authority:'xrick-centered-visual-box-type1a-frame-union'}):null;
}

export function minimalProjectileCollisionBounds(opaque) {
  if (!opaque) return null;
  const cx = Math.floor((opaque.x * 2 + opaque.width - 1) / 2);
  const cy = Math.floor((opaque.y * 2 + opaque.height - 1) / 2);
  return Object.freeze({ x:cx - 2, y:cy - 1, width:5, height:3 });
}

export function emitterAlignedProjectileGeometry(frame, origin, child) {
  if (!frame?.pixels || !Array.isArray(origin) || !child?.emitterAligned ||
      !Array.isArray(child?.emitterContact)) return null;
  const opaque = opaqueDrawBounds(frame.pixels, 0, 0);
  if (!opaque) return null;
  const direction = String(child.emitterDirection || child.direction || '').toLowerCase();
  if (direction !== 'left' && direction !== 'right') return null;
  const localTipX = direction === 'left' ? opaque.x : opaque.x + opaque.width - 1;
  const localCenterY = Math.floor((opaque.y * 2 + opaque.height) / 2);
  const drawX = Math.round(Number(origin[0]) - localTipX);
  const drawY = Math.round(Number(origin[1]) - localCenterY);
  const muzzleX = Number(child.emitterContact[0]);
  const clip = { top:0, bottom:0, left:0, right:0 };
  if (direction === 'right')
    clip.left = Math.max(0, Math.min(frame.pixels.width, Math.round(muzzleX + 1 - drawX)));
  else
    clip.right = Math.max(0, Math.min(frame.pixels.width, Math.round(drawX + frame.pixels.width - muzzleX)));
  return Object.freeze({ drawX, drawY, clip:Object.freeze(clip) });
}
