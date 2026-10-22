import { asUint8Array } from './binary.js';

export async function sha256Hex(data) {
  const bytes = asUint8Array(data);
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  }
  if (typeof process !== 'undefined' && process.versions?.node) {
    const { createHash } = await import('node:crypto');
    return createHash('sha256').update(bytes).digest('hex');
  }
  // The Level Editor can run under an opaque offline Chromium origin, where
  // WebCrypto is unavailable. Always hash the actual input; never substitute
  // a verified ROM digest for a separate scene/source manifest.
  const { sha256Portable } = await import('./sha256-portable.js');
  return sha256Portable(bytes);
}
