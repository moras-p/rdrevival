import { PixelBuffer } from '../render/pixel-buffer.js';

export const REVIVAL_MISSILE_PRESENTATION_PN = 0xfd;
export const REVIVAL_MISSILE_WIDTH = 32;
export const REVIVAL_MISSILE_HEIGHT = 21;

/* Dedicated Revival hazard art for MD0047 mark 438. This is deliberately not
 * RDX PN61/PN62, which are associated with Missile Base collectible placements. */
const ROWS = Object.freeze([
  '............5...................',
  '...........362..................',
  '..........15642.................',
  '.........0466530................',
  '.........0466520................',
  '.........0356420................',
  '.........0356420................',
  '.........0356420................',
  '.........0466520................',
  '.........0356420................',
  '.........0356420................',
  '.........0356420................',
  '.........0356420................',
  '........003453200...............',
  '.......01345432120..............',
  '......0132134212320.............',
  '......02320rgr02320.............',
  '......02310ogo01320.............',
  '.......0210ror0120..............',
  '........010rgr010...............',
  '.........010o010................'
]);

const COLORS = Object.freeze({
  '0':[0x00,0x00,0x00,0xff],
  '1':[0x24,0x24,0x24,0xff],
  '2':[0x49,0x49,0x6d,0xff],
  '3':[0x6d,0x6d,0x6d,0xff],
  '4':[0x92,0x92,0x92,0xff],
  '5':[0xdb,0xdb,0xdb,0xff],
  '6':[0xff,0xff,0xff,0xff],
  o:[0xff,0x6d,0x00,0xff],
  g:[0xff,0xb6,0x24,0xff],
  r:[0xb6,0x49,0x00,0xff]
});

let cached = null;
export function revivalMissileFrame() {
  if (cached) return cached;
  const pixels = new PixelBuffer(REVIVAL_MISSILE_WIDTH, REVIVAL_MISSILE_HEIGHT, [0,0,0,0]);
  for (let y = 0; y < REVIVAL_MISSILE_HEIGHT; y += 1) {
    const row = ROWS[y];
    for (let x = 0; x < REVIVAL_MISSILE_WIDTH; x += 1) {
      const color = COLORS[row[x]];
      if (color) pixels.setPixel(x, y, color);
    }
  }
  cached = Object.freeze({
    pixels,
    originX:0,
    originY:20,
    footAnchorX:0,
    footAnchorY:20,
    pn:Object.freeze({ index:REVIVAL_MISSILE_PRESENTATION_PN, source:'revival-md0047-mark438-missile' }),
    frameIndex:0,
    pfIndex:0xffff
  });
  return cached;
}
