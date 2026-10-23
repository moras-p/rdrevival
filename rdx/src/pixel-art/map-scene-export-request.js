/** Parse the Level Editor's map-scene dialog without browser prompt()/confirm(). */
export function parseMapSceneExportRequest({ target, pn = '91', mirror = '', tick = '0' } = {}) {
  const value = String(target ?? '').trim();
  const mark = /^mark:(\d+)$/i.exec(value);
  const fields = value.split(',').map(part => part.trim());
  let location;
  if (mark) {
    location = { stableEntityId: `mark:${Number(mark[1])}`, margin: 16 };
  } else if (fields.length === 4 && fields.every(part => /^-?\d+$/.test(part))) {
    const rect = fields.map(Number);
    if (rect.some(n => !Number.isSafeInteger(n)) || rect[2] <= 0 || rect[3] <= 0 || rect[2] > 128 || rect[3] > 128) {
      throw new Error('Crop width and height must be 1–128 pixels.');
    }
    location = { worldRect: rect };
  } else {
    throw new Error('Enter mark:43 or a world rectangle x,y,width,height.');
  }
  const pnText = String(pn ?? '').trim().toLowerCase();
  const mirrorText = String(mirror ?? '').trim().toLowerCase();
  const tickText = String(tick ?? '').trim();
  if (pnText !== 'none' && !/^\d{1,3}$/.test(pnText)) throw new Error('Test PN must be 0–255 or none.');
  const testPn = pnText === 'none' ? null : Number(pnText);
  if (testPn !== null && testPn > 255) throw new Error('Test PN must be 0–255 or none.');
  if (!['', 'x', 'y', 'xy'].includes(mirrorText)) throw new Error('Mirror must be none, x, y or xy.');
  if (!/^\d{1,4}$/.test(tickText) || Number(tickText) > 1024) throw new Error('Source tick must be 0–1024.');
  if (testPn === null && (mirrorText || Number(tickText) !== 0)) throw new Error('Mirror and source tick require a test PN.');
  return {
    ...location,
    testPn,
    testSourceTick: Number(tickText),
    testMirrorX: mirrorText.includes('x'),
    testMirrorY: mirrorText.includes('y')
  };
}
