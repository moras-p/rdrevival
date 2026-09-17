import { PixelBuffer } from '../render/pixel-buffer.js';

export const REVIVAL_BULLET_FRAME_COUNT = 3;
export const REVIVAL_BULLET_WIDTH = 18;
export const REVIVAL_BULLET_HEIGHT = 9;

/* Keep this authored browser preview in lockstep with
 * revival/rev/src/rdx_revival_bullet.c. It is the Revival player-bullet art;
 * production/tooling must not decode RDX PN013/PN014 as a weapon source. */
const RIGHT_FRAME_ROWS = Object.freeze([
  Object.freeze([
    '..................',
    '.......00000001...',
    '.....012444444230.',
    '.....0g5666665g500',
    '.32..013333333440.',
    '.....01222222210..',
    '......0111111110..',
    '.......00000000...',
    '..................'
  ]),
  Object.freeze([
    '..................',
    '.......00000001...',
    '.....012444444230.',
    '.43..0g5666665g500',
    '...2.013333333440.',
    '.....01222222210..',
    '......0111111110..',
    '.......00000000...',
    '..................'
  ]),
  Object.freeze([
    '..................',
    '.......00000001...',
    '.....012444444230.',
    '.....0g5666665g500',
    '3.42.013333333440.',
    '..1..01222222210..',
    '......0111111110..',
    '.......00000000...',
    '..................'
  ])
]);

const COLORS = Object.freeze({
  '0':[0x00,0x00,0x00,0xff],
  '1':[0x24,0x24,0x24,0xff],
  '2':[0x4a,0x4a,0x4a,0xff],
  '3':[0x6d,0x6d,0x6d,0xff],
  '4':[0x92,0x92,0x92,0xff],
  '5':[0xdb,0xdb,0xdb,0xff],
  '6':[0xff,0xff,0xff,0xff],
  g:[0xff,0xd2,0x69,0xff]
});
const CACHE = new Map();

export function revivalBulletFrame(tick = 0, left = false) {
  const phase = ((Math.floor(Number(tick) || 0) % REVIVAL_BULLET_FRAME_COUNT) + REVIVAL_BULLET_FRAME_COUNT) % REVIVAL_BULLET_FRAME_COUNT;
  const key = `${left ? 1 : 0}:${phase}`;
  if (CACHE.has(key)) return CACHE.get(key);
  const pixels = new PixelBuffer(REVIVAL_BULLET_WIDTH, REVIVAL_BULLET_HEIGHT, [0,0,0,0]);
  for (let y = 0; y < REVIVAL_BULLET_HEIGHT; y += 1) {
    const row = RIGHT_FRAME_ROWS[phase][y];
    for (let x = 0; x < REVIVAL_BULLET_WIDTH; x += 1) {
      const sourceX = left ? REVIVAL_BULLET_WIDTH - 1 - x : x;
      const color = COLORS[row[sourceX]];
      if (color) pixels.setPixel(x, y, color);
    }
  }
  const originX = left ? 7 : 11;
  const frame = Object.freeze({
    pixels,
    originX,
    originY:4,
    footAnchorX:originX,
    footAnchorY:4,
    pn:Object.freeze({ index:0xff, source:'revival-player-bullet' }),
    frameIndex:phase,
    pfIndex:0xffff,
    mirroredX:!!left
  });
  CACHE.set(key, frame);
  return frame;
}
