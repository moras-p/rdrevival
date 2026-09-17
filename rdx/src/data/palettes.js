export const MAP_GROUPS = [
  { key: 'south_america', label: 'South America / Jungle', min: 1, max: 11, palette: 'game:south_america', gameplay: true },
  { key: 'egypt_transition', label: 'Egypt transition', min: 12, max: 12, palette: 'game:egypt_transition_md12', gameplay: false },
  { key: 'egypt', label: 'Egypt', min: 13, max: 23, palette: 'game:egypt', gameplay: true },
  { key: 'castle_transition', label: 'Castle transition', min: 24, max: 24, palette: 'game:castle_transition_md24', gameplay: false },
  { key: 'castle', label: 'Castle / Schwarzendumpf', min: 25, max: 44, palette: 'game:castle_md25_live', gameplay: true, provisional: true },
  { key: 'missile_transition', label: 'Missile transition', min: 45, max: 45, palette: 'game:missile_transition_md45', gameplay: false },
  { key: 'missile_base', label: 'Missile Base', min: 46, max: 54, palette: 'game:missile_base', gameplay: true }
];

export function mapGroup(mapId) {
  return MAP_GROUPS.find(group => mapId >= group.min && mapId <= group.max) || {
    key: 'unclassified', label: 'Unclassified', palette: 'debug', gameplay: false, provisional: true
  };
}

export function rgb9ToRgb(word) {
  return [
    Math.round((word & 7) * 255 / 7),
    Math.round(((word >> 3) & 7) * 255 / 7),
    Math.round(((word >> 6) & 7) * 255 / 7),
    255
  ];
}

export function debugPalette() {
  const words = [];
  for (let line = 0; line < 4; line += 1) {
    for (let i = 0; i < 16; i += 1) words.push(i | (i << 3) | (i << 6));
  }
  return words;
}

export class PaletteRegistry {
  constructor(entries = {}) {
    this.entries = new Map(Object.entries(entries));
  }

  words(key) {
    const words = this.entries.get(key);
    return Array.isArray(words) && words.length >= 64 ? words.slice(0, 64) : debugPalette();
  }

  rgba(key) {
    return this.words(key).map(rgb9ToRgb);
  }

  forMap(mapId) {
    const group = mapGroup(mapId);
    return { ...group, words: this.words(group.palette), rgba: this.rgba(group.palette) };
  }
}
