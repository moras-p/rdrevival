import { PixelBuffer } from '../render/pixel-buffer.js';

const WIDTH = 30, HEIGHT = 22;
const ART_X = 3, ART_Y = 1;
const DYNAMITE = 0, BULLETS = 1;

/* Browser/editor mirror of revival/rev/src/rdx_revival_ammo_box.c. Keep this
 * pixel-authored frame identical to native production so the Level Editor
 * previews the default Revival presentation instead of the underlying RDX
 * PN67/PN68 source art. */
const ROWS = Object.freeze([
  Object.freeze([
    '........................',
    '......k.......k.........',
    '.k...kmk....kksk....k...',
    'kskkkskmkk.pvRkk.k.ksk..',
    'mkmRpk.kRpkbFRk.pRkmkmk.',
    'kkRFbkkRFbRqbpkqbFRk.k..',
    '.kpbpRkpbpRpqk.Rpbpk....',
    'kkkqRpRkqRFbRkbpRqkkkkkk',
    'hypbqqqqqqqqqqqqqqqhypbk',
    'hpbqdpbpppypppbpppqobbqk',
    'pqoqbbbbdqqqbbdbbbopqbqk',
    'pbbdbbqpbdbbbbbbhpqdbqqk',
    'pqbdqqqqqqqqqqhybbdpqbqk',
    'pqbqpppppypbhpbbqdqpqbqk',
    'pqbqbqbqdbypbbqbqqdpqbqk',
    'pbbqdbbbypbqbbqqbbqdbpqk',
    'pqbqqqypbqbbdqqqqqqpqbqk',
    'pbbqpdbbbbqqbbppppqpbbqk',
    'pqbqbdbbqqbqqbbdqbqpbqqk',
    'pbdqbbqqqbpbbbdqbbqqbbqk',
    'bbbqdqqqqqdqqqqqqdqbbbqk'
  ]),
  Object.freeze([
    '.......kgmck............',
    '.......kscmmk..kkmc.....',
    '.......ksgmk..ksmsgk....',
    '.......kkkkk..kmscsmk...',
    '......kkscmk..kscsmk....',
    '..kk..kgsgmk.kscsmk.....',
    '.ksmkkkskmmkkscsmkk.....',
    'kkmgmmcsgkmksgsmkmkkkkkk',
    'hpypqkmmkqqqqqqqqqqhypbk',
    'pbbmcsgmppyhypppppqpbbqk',
    'hobqkmkbdbqbbqdqbbqoqbqk',
    'hpbmcsgmbbdbbbbbhpqpbbqk',
    'pqbdkmkqqqqqqqhybbdpqbqk',
    'hpbmcsgmpypbhpbbbdqpqbqk',
    'pqbqkmkbdbhybbqbqqdpbbqk',
    'pbbdcsgmppoqbbqqbbqdqbqk',
    'pbbqkmkobbbbdqqqqqqpbbqk',
    'hpbmcsgmbdqqbbppppqpqbqk',
    'pbbqbdbbqqbqqbbdqbqpbbqk',
    'pqdqbbqqqbbbbbdbbbqqbbqk',
    'bbbqdqqqqqdqqqqqqdqbbbqk'
  ])
]);

const COLORS = Object.freeze({
  k:[0x00,0x00,0x00,0xff], q:[0x36,0x1d,0x09,0xff], d:[0x55,0x2a,0x08,0xff],
  b:[0x74,0x36,0x06,0xff], o:[0xa1,0x4b,0x05,0xff], p:[0xd4,0x6b,0x08,0xff],
  y:[0xee,0x91,0x18,0xff], h:[0xff,0xb9,0x3c,0xff], m:[0x31,0x37,0x34,0xff],
  s:[0x59,0x64,0x5e,0xff], g:[0x86,0x93,0x8b,0xff], c:[0xc3,0xcd,0xc4,0xff],
  l:[0xb0,0x71,0x0b,0xff], v:[0xf0,0xb5,0x35,0xff], R:[0xd8,0x45,0x18,0xff],
  F:[0xff,0x78,0x20,0xff]
});

const cache = new Map();

export function revivalAmmoBoxVariant(entityN) {
  const family = Number(entityN) & 0x7f;
  if (family === 0x10) return DYNAMITE;
  if (family === 0x11) return BULLETS;
  return -1;
}

export function revivalAmmoBoxFrame(entityN) {
  const variant = revivalAmmoBoxVariant(entityN);
  if (variant < 0) return null;
  if (cache.has(variant)) return cache.get(variant);
  const pixels = new PixelBuffer(WIDTH, HEIGHT, [0,0,0,0]);
  for (let y = 0; y < ROWS[variant].length; y += 1) {
    for (let x = 0; x < ROWS[variant][y].length; x += 1) {
      const color = COLORS[ROWS[variant][y][x]];
      if (color) pixels.setPixel(ART_X + x, ART_Y + y, color);
    }
  }
  const frame = Object.freeze({
    pixels,
    originX:0,
    originY:0,
    footAnchorX:13.584,
    footAnchorY:22,
    pn:Object.freeze({ index:0xff, source:'revival-ammo-box' }),
    frameIndex:0,
    pfIndex:0xffff
  });
  cache.set(variant, frame);
  return frame;
}
