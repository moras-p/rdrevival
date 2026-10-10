import { PixelBuffer } from '../../render/pixel-buffer.js';
import { drawPixelBuffer } from './pixel-canvas-renderer.js';

/* Normal actors retain source order. Only the pixels that survive later
 * normal actors can be lifted above authored static Foreground. This matches
 * the native compositing owner's last-writer rule without moving the guard. */
export function overScenerySurvivingSprite(entity, laterActors) {
  const { sprite, draw } = entity;
  const result = new PixelBuffer(sprite.width, sprite.height);
  result.data.set(sprite.data);
  for (const other of laterActors) {
    if (!other.visible || !other.sprite || !other.draw ||
        !['normal', 'over-scenery'].includes(other.depth)) continue;
    const left = Math.max(0, Math.round(other.draw.x - draw.x));
    const top = Math.max(0, Math.round(other.draw.y - draw.y));
    const right = Math.min(sprite.width, Math.round(other.draw.x - draw.x) + other.sprite.width);
    const bottom = Math.min(sprite.height, Math.round(other.draw.y - draw.y) + other.sprite.height);
    for (let y = top; y < bottom; ++y) for (let x = left; x < right; ++x) {
      const sx = x + Math.round(draw.x - other.draw.x);
      const sy = y + Math.round(draw.y - other.draw.y);
      if (other.sprite.data[(sy * other.sprite.width + sx) * 4 + 3])
        result.data[(y * sprite.width + x) * 4 + 3] = 0;
    }
  }
  return result;
}

export function drawOverSceneryActors(ctx, viewport, entities) {
  for (let i = 0; i < entities.length; ++i) {
    const entity = entities[i];
    if (!entity.visible || entity.depth !== 'over-scenery' || !entity.sprite || !entity.draw) continue;
    const sprite = overScenerySurvivingSprite(entity, entities.slice(i+1));
    drawPixelBuffer(ctx, viewport, sprite, entity.draw.x, entity.draw.y);
  }
}
