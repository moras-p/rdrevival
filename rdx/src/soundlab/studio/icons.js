/* Inline SVG icons for the Studio (stroke icons, currentColor). */

const PATHS = {
  play: '<path d="M7 5l12 7-12 7z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor" stroke="none"/>',
  context: '<path d="M3 12h3M18 12h3"/><path d="M8 8v8M16 8v8"/><path d="M11 6l4 6-4 6z" fill="currentColor" stroke="none"/>',
  variants: '<path d="M4 7h3l2 10h2"/><path d="M13 7h2l2 10h3"/><circle cx="5" cy="17" r="1.4"/><circle cx="19" cy="7" r="1.4"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 16V5M7 10l5-5 5 5M5 20h14"/>',
  mute: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l4 6M21 9l-4 6"/>',
  solo: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 8.5a5 5 0 010 7M19.5 6a8.5 8.5 0 010 12"/>',
  prev: '<path d="M15 5l-7 7 7 7"/>',
  next: '<path d="M9 5l7 7-7 7"/>',
  loop: '<path d="M4 12a6 6 0 016-6h8M15 3l3 3-3 3M20 12a6 6 0 01-6 6H6M9 21l-3-3 3-3"/>',
  volume: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 9.5a3.5 3.5 0 010 5"/>',
  pin: '<path d="M12 21s-6-5.5-6-11a6 6 0 0112 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>'
};

export const ICON_NAMES = Object.freeze(Object.keys(PATHS));

export function icon(name, { size = 16, title = '' } = {}) {
  const body = PATHS[name];
  if (!body) throw new Error(`Unknown icon ${name}`);
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="${title ? 'false' : 'true'}"${title ? ` role="img"><title>${title}</title` : ''}>${body}</svg>`;
}
