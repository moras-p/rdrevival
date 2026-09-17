import { RdxRom } from '../core/rom.js';
import { RdxSpriteDecoder } from '../core/sprite.js';
import { mapGroup, rgb9ToRgb } from '../data/palettes.js';
import { createDocument, requireArt, validate } from './document.js';

export function mapPalette(entries, mapId, bank = null) {
  requireArt(Number.isInteger(mapId) && mapId >= 1 && mapId <= 54, 'ASSET', 'Choose a map from 1 to 54');
  const group = mapGroup(mapId), words = entries[group.palette];
  requireArt(Array.isArray(words) && words.length === 64 && words.every(v => Number.isInteger(v) && v >= 0 && v <= 511), 'PALETTE', 'Authoritative map palette unavailable; no debug fallback');
  requireArt(bank === null || Number.isInteger(bank) && bank >= 0 && bank <= 3, 'PALETTE', 'Palette bank must be 0–3 or null');
  const palette = words.map(rgb9ToRgb);
  palette[0] = [0, 0, 0, 0];
  const allowedIndices = [0, ...palette.flatMap((_, i) => i % 16 !== 0 && (bank === null || Math.floor(i / 16) === bank) ? [i] : [])];
  return { palette, policy: { name: `${group.label}${bank === null ? '' : ` · bank ${bank}`}`, source: `web/rdx/data/palettes.json#${group.palette}`, colors: palette, allowedIndices, maxColors: bank === null ? 60 : 15 } };
}

// Decode with unique marker colors to retain the source index even when two
// palette slots have identical RGB. This reuses the maintained sprite renderer.
export async function importRdxSprite(bytes, { mapId, pn, paletteEntries }) {
  requireArt(Number.isInteger(pn) && pn >= 0 && pn <= 255, 'ASSET', 'Explicit PN index required');
  const rom = await RdxRom.from(bytes, { strictHash: true });
  const decoder = new RdxSpriteDecoder(rom);
  const markers = Array.from({ length: 64 }, (_, i) => [i, 0, 0, 255]);
  const animation = decoder.framesForPn(pn, markers);
  requireArt(animation.frames.length > 0 && animation.frames.length <= 128, 'ASSET', 'No supported frames for this PN');
  const { palette, policy } = mapPalette(paletteEntries, mapId);
  const frames = animation.frames;
  const width = Math.max(...frames.map(f => f.pixels.width));
  const height = Math.max(...frames.map(f => f.pixels.height));
  const banks = [...new Set(frames.flatMap(f => f.pieces.map(p => (p.attr >> 13) & 3)))].sort();
  policy.allowedIndices = policy.allowedIndices.filter(i => i === 0 || banks.includes(Math.floor(i / 16)));
  policy.maxColors = banks.length * 15;
  const doc = createDocument({ id: `rdx-map-${mapId}-pn-${pn}`, width, height, frameCount: frames.length, columns: Math.min(frames.length, 6), palette, palettePolicy: policy });
  frames.forEach((f, n) => {
    const target = doc.frames[n];
    target.anchor = [f.originX, f.originY];
    for (let y = 0; y < f.pixels.height; y++) for (let x = 0; x < f.pixels.width; x++) {
      const offset = (y * f.pixels.width + x) * 4;
      target.cels.ink[y * width + x] = f.pixels.data[offset + 3] ? f.pixels.data[offset] : 0;
    }
  });
  doc.clips[0].durations = frames.map(f => Math.max(1, f.pf.duration) * 1000 / 60).map(Math.round);
  doc.paletteLocks = palette.map((_, i) => i);
  doc.artDirection = { target: `Revival map ${mapId}, PN ${pn}`, intent: '', preserve: 'Exact map palette, source registration and animation identity. Padded canvas retains original frame coordinates.', referenceNotes: 'ROM pixels are the editable source. Mood boards provide inspiration only.', acceptance: 'Inspect native-size readability and the complete animation; native gameplay preview is required before integration.' };
  doc.provenance.asset = {
    kind: 'rdx-sprite', sourceHash: rom.hash, mapId, pn, paletteBanks: banks,
    nativeFrames: frames.map(f => ({ pf: f.pf, width: f.pixels.width, height: f.pixels.height, origin: [f.originX, f.originY], presentationAnchor: [f.enemyAnchorX ?? f.footAnchorX, f.enemyAnchorY ?? f.footAnchorY] })),
    loopOffset: animation.pn.loopOffset ?? null,
    timing: 'Rounded 60 Hz source preview; native presentation cadence remains authoritative',
    integration: 'Editable draft only; no ROM writeback adapter',
  };
  return validate(doc);
}
