import { PixelBuffer } from '../render/pixel-buffer.js';

const WIDTH = 24, HEIGHT = 23;
const ROWS = Object.freeze([
  '........................',
  '........o.....o.........',
  '.......nync.cnyn........',
  '.......nwnononwn........',
  '....ch.nowpnpwon.hc.....',
  '...ncwonchonohcnowcn....',
  '...noupqdybnbydqpuon....',
  '.nnncowycdhuhdcywocnnn..',
  'ndyqndpopwuhuwpopdnqydn.',
  'noupqpbqoyhphyoqbpqpuon.',
  '.nbwobqencpupcneqbowbn..',
  '.ndbdbelenphpnelebdbdn..',
  'nwpdpubobyhhhybobupdpwn.',
  'nchbbyhhycdbdcyhhybbhcn.',
  'ndocyyccqqoooqqccyycodn.',
  '.nndwckkkkpupkkkkcwdnn..',
  'nyycwckkkkkkkkkkkcwcyyn.',
  'ncodwckkkopdpokkkcwdocn.',
  '.dodwbkkkyydyykkkbwdod..',
  '.nnbyubdcywowycdbuybnn..',
  'knndoyuycyuouycyuyodnnk.',
  'nohybopddopwpoddpobyhon.',
  '........................'
]);
const COLORS = Object.freeze({
  k:[0x00,0x00,0x00,0xff], n:[0x23,0x25,0x21,0xff], q:[0x39,0x21,0x0b,0xff],
  d:[0x4d,0x23,0x01,0xff], c:[0x83,0x3d,0x04,0xff], b:[0xa1,0x55,0x04,0xff],
  o:[0xae,0x5e,0x06,0xff], p:[0xd4,0x82,0x0f,0xff], y:[0xeb,0x93,0x14,0xff],
  h:[0xfd,0xc1,0x56,0xff], w:[0xfd,0xd4,0x6f,0xff], u:[0xf2,0xe9,0xa6,0xff],
  e:[0x2f,0x4c,0x04,0xff], l:[0x65,0x90,0x0e,0xff]
});

let frameCache = null;

export function revivalIdolFrame() {
  if (frameCache) return frameCache;
  const pixels = new PixelBuffer(WIDTH, HEIGHT, [0,0,0,0]);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const code = ROWS[y][x];
      const color = COLORS[code];
      if (color) pixels.setPixel(x, y, color);
    }
  }
  frameCache = Object.freeze({
    pixels,
    originX: 0,
    originY: 0,
    footAnchorX: 11,
    footAnchorY: 22,
    pn: Object.freeze({ index: 27, source: 'revival-idol' }),
    frameIndex: 0,
    pfIndex: 0xffff
  });
  return frameCache;
}
