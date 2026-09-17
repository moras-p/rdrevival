const HEX_NIBBLE = /^[0-9a-f]$/i;

function assert(condition, message) {
  if (!condition) throw new Error(`Authored visual asset: ${message}`);
}

function sourcePlaneVisual(cell, plane) {
  return String(plane || '').toUpperCase() === 'A' ? cell?.visual?.foreground : cell?.visual?.background;
}

function editNibble(bytes, x, y, value) {
  const byteIndex = y * 4 + (x >> 1);
  const current = bytes[byteIndex] ?? 0;
  bytes[byteIndex] = (x & 1)
    ? ((current & 0xf0) | value)
    : ((current & 0x0f) | (value << 4));
}

export function tileNibbleRows(tileBytes) {
  assert(tileBytes && tileBytes.length === 32, '8x8 tile data must be exactly 32 bytes');
  const rows = [];
  for (let y = 0; y < 8; y += 1) {
    let row = '';
    for (let x = 0; x < 8; x += 1) {
      const byte = tileBytes[y * 4 + (x >> 1)] ?? 0;
      row += ((x & 1) ? (byte & 0x0f) : (byte >> 4)).toString(16);
    }
    rows.push(row);
  }
  return rows;
}

export function applyTilePixelEdits(tileBytes, pixelEdits) {
  assert(tileBytes && tileBytes.length === 32, 'source tile data must be exactly 32 bytes');
  assert(Array.isArray(pixelEdits) && pixelEdits.length === 8, 'pixelEdits must contain eight rows');
  const output = new Uint8Array(tileBytes);
  for (let y = 0; y < 8; y += 1) {
    const row = String(pixelEdits[y] || '');
    assert(row.length === 8, `pixelEdits row ${y} must contain eight characters`);
    for (let x = 0; x < 8; x += 1) {
      const code = row[x];
      if (code === '.') continue;
      assert(HEX_NIBBLE.test(code), `pixelEdits (${x},${y}) must be '.' or one hexadecimal nibble`);
      editNibble(output, x, y, Number.parseInt(code, 16));
    }
  }
  return output;
}

export function normalizeAuthoredVisualAssets(data) {
  assert(data?.schema === 'rdr.authored_visual_assets.v1', 'expected rdr.authored_visual_assets.v1 registry');
  const ids = new Set();
  const assets = (data.assets || []).map((asset, index) => {
    const id = String(asset?.id || '');
    assert(id, `asset ${index} requires an id`);
    assert(!ids.has(id), `duplicate asset id ${id}`);
    ids.add(id);
    assert(asset.kind === 'rdx-tile8-pixel-edit', `${id} has unsupported kind ${asset.kind}`);
    assert(JSON.stringify(asset.size) === '[8,8]', `${id} must be an 8x8 tile`);
    const source = asset.source || {};
    assert(Number.isInteger(Number(source.mapId)) && Number(source.mapId) > 0, `${id} requires source.mapId`);
    assert(Array.isArray(source.g8) && source.g8.length === 2 && source.g8.every(value => Number.isInteger(Number(value))), `${id} requires integer source.g8`);
    assert(['A','B'].includes(String(source.plane || '').toUpperCase()), `${id} requires source.plane A|B`);
    applyTilePixelEdits(new Uint8Array(32), asset.pixelEdits);
    return Object.freeze({ ...asset, source:Object.freeze({ ...source, plane:String(source.plane).toUpperCase() }) });
  });
  return Object.freeze({ schema:data.schema, version:Number(data.version || 1), assets:Object.freeze(assets) });
}

export function authoredVisualAssetById(registry, id) {
  const normalized = normalizeAuthoredVisualAssets(registry);
  return normalized.assets.find(asset => String(asset.id) === String(id)) || null;
}

export function resolveAuthoredVisualAsset(asset, mapDecoder) {
  assert(asset?.kind === 'rdx-tile8-pixel-edit', 'resolve requires an rdx-tile8-pixel-edit asset');
  assert(mapDecoder?.inspectGridCell && mapDecoder?.resolveGlobalTile, `${asset.id} requires an RDX map decoder`);
  const source = asset.source || {};
  const [gx, gy] = source.g8.map(Number);
  const phase = Number(source.phase || 0);
  const cell = mapDecoder.inspectGridCell(Number(source.mapId), gx, gy, phase);
  assert(cell, `${asset.id} source MD${String(source.mapId).padStart(4, '0')} g8:${gx}:${gy} is outside the decoded map`);
  const visual = sourcePlaneVisual(cell, source.plane);
  assert(visual?.resolution?.globalTile != null, `${asset.id} source plane does not resolve to a stable global tile`);
  const globalTile = Number(visual.resolution.globalTile);
  const paletteLine = Number(visual.paletteLine);
  if (source.expectedGlobalTile != null)
    assert(globalTile === Number(source.expectedGlobalTile), `${asset.id} source global tile drifted: expected ${source.expectedGlobalTile}, got ${globalTile}`);
  if (source.expectedPaletteLine != null)
    assert(paletteLine === Number(source.expectedPaletteLine), `${asset.id} source palette line drifted: expected ${source.expectedPaletteLine}, got ${paletteLine}`);
  if (source.expectedHFlip != null)
    assert(Boolean(visual.hFlip) === Boolean(source.expectedHFlip), `${asset.id} source horizontal flip drifted`);
  if (source.expectedVFlip != null)
    assert(Boolean(visual.vFlip) === Boolean(source.expectedVFlip), `${asset.id} source vertical flip drifted`);
  assert(!visual.hFlip && !visual.vFlip, `${asset.id} pixel edits currently require an unflipped source tile`);
  const resolved = mapDecoder.resolveGlobalTile(globalTile);
  assert(resolved?.tileBytes?.length === 32, `${asset.id} source global tile ${globalTile} did not resolve to 32 bytes`);
  const sourceTileBytes = new Uint8Array(resolved.tileBytes);
  const tileBytes = applyTilePixelEdits(sourceTileBytes, asset.pixelEdits);
  return Object.freeze({
    id:String(asset.id), kind:String(asset.kind), plane:String(source.plane).toUpperCase(), paletteLine,
    source:Object.freeze({ mapId:Number(source.mapId), g8:Object.freeze([gx, gy]), phase, globalTile }),
    sourceTileBytes, tileBytes
  });
}
