const PATHS = {
  pencil: '<path d="M4 14l1-4L12.5 2.5a1.8 1.8 0 012.5 2.5L7.5 12.5 4 14z"/><path d="M10.8 4.2l2.9 2.9"/>',
  eraser: '<path d="M5 12l-2-2 6.8-6.8a1.5 1.5 0 012.1 0l2 2a1.5 1.5 0 010 2.1L9.2 12H5z"/><path d="M7.5 12h6.5"/>',
  fill: '<path d="M4 8l5-5 5 5-5 5-5-5z"/><path d="M3 14h10"/><path d="M12.5 10.5c1.7 1.7 1.7 2.8 0 4.5-1.7-1.7-1.7-2.8 0-4.5z"/>',
  eyedropper: '<path d="M10.5 2.5l3 3-7 7H4v-2.5l6.5-6.5z"/><path d="M9 4l3 3"/><path d="M3 14h4"/>',
  line: '<path d="M3 13L13 3"/>',
  rectangle: '<rect x="3" y="4" width="10" height="8" rx="1"/>',
  ellipse: '<ellipse cx="8" cy="8" rx="5" ry="4"/>',
  selection: '<rect x="3" y="3" width="10" height="10" rx="1" stroke-dasharray="2 2"/>',
  wand: '<path d="M5 11l6-6"/><path d="M10.5 2.5v-1M13.5 5.5h1M12.5 3.5l.8-.8M4 5H2.5M5 3.5l-.8-.8"/><path d="M4 12l2 2"/>',
  move: '<path d="M8 2v12M2 8h12"/><path d="M8 2L6 4M8 2l2 2M14 8l-2-2M14 8l-2 2M8 14l-2-2M8 14l2-2M2 8l2-2M2 8l2 2"/>',
  hand: '<path d="M5 8V4.5a1 1 0 012 0V7M7 7V3.5a1 1 0 012 0V7M9 7V4a1 1 0 012 0v4M11 8V5.5a1 1 0 012 0V10c0 2.7-1.8 4-4.5 4H6c-1.4 0-2.2-.7-2.8-1.8L2 10.1a1 1 0 011.7-1L5 11V8z"/>',
  color: '<circle cx="8" cy="8" r="5"/><path d="M8 3a5 5 0 000 10z"/>',
  layers: '<path d="M8 2l6 3-6 3-6-3 6-3zM2 8l6 3 6-3M2 11l6 3 6-3"/>',
  animation: '<rect x="2" y="4" width="12" height="8" rx="1"/><path d="M5 4v8M11 4v8M2 7h3M11 7h3"/>',
  properties: '<path d="M3 4h10M3 8h10M3 12h10"/><circle cx="6" cy="4" r="1.3"/><circle cx="10" cy="8" r="1.3"/><circle cx="7" cy="12" r="1.3"/>',
  review: '<path d="M8 2l1.6 3.5 3.9.4-2.9 2.6.8 3.8L8 10.4l-3.4 1.9.8-3.8L2.5 5.9l3.9-.4L8 2z"/>',
  output: '<path d="M8 2v8M5 7l3 3 3-3"/><path d="M3 11v3h10v-3"/>',
  undo: '<path d="M6 4L3 7l3 3"/><path d="M3 7h6a4 4 0 010 8"/>',
  redo: '<path d="M10 4l3 3-3 3"/><path d="M13 7H7a4 4 0 000 8"/>',
  history: '<circle cx="8" cy="8" r="5"/><path d="M8 5v3l2 1"/>',
  close: '<path d="M4 4l8 8M12 4l-8 8"/>',
  chevron: '<path d="M5 6l3 3 3-3"/>',
  more: '<circle cx="3" cy="8" r=".8" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r=".8" fill="currentColor" stroke="none"/><circle cx="13" cy="8" r=".8" fill="currentColor" stroke="none"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  minus: '<path d="M3 8h10"/>',
  duplicate: '<rect x="5" y="3" width="8" height="8" rx="1"/><path d="M3 5v8h8"/>',
  delete: '<path d="M3 5h10M6 5V3h4v2M5 5l1 9h4l1-9"/>',
  swap: '<path d="M3 5h9M10 3l2 2-2 2M13 11H4M6 9l-2 2 2 2"/>',
  fit: '<path d="M3 6V3h3M10 3h3v3M13 10v3h-3M6 13H3v-3"/>',
  grid: '<path d="M3 3h10v10H3zM3 8h10M8 3v10"/>',
  play: '<path d="M5 3l8 5-8 5V3z"/>',
  expand: '<path d="M3 6V3h3M10 3h3v3M13 10v3h-3M6 13H3v-3"/>',
  collapse: '<path d="M6 3v3H3M10 3v3h3M13 10h-3v3M3 10h3v3"/>',
};

export function icon(name, { size = 16, label = null } = {}) {
  const path = PATHS[name] ?? PATHS.more;
  const aria = label ? ` role="img" aria-label="${label}"` : ' aria-hidden="true"';
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"${aria}>${path}</svg>`;
}
