import { GAI_REPLAY_BUNDLE_SCHEMA, gaiReplayBundle, parseGaiReplayBundle } from './ai-plan-cache.js';

// Committable, static asset. This is the only file that needs staging after
// local recordings. Browsers cannot write to a checkout without user consent.
export const GAI_REPLAY_PROJECT_PATH = 'web/rdx/data/gai/room-replays.json';
const REPO_PARTS = GAI_REPLAY_PROJECT_PATH.split('/');
const MAX_REPO_BYTES = 32_000_000;

export async function fetchCommittedGaiReplays(fetcher = fetch) {
  try {
    const response = await fetcher(new URL('../../data/gai/room-replays.json', import.meta.url), {cache:'no-store'});
    if (!response.ok) return [];
    const source = await response.text();
    if (source.length > MAX_REPO_BYTES) return [];
    return parseGaiReplayBundle(JSON.parse(source));
  } catch { return []; } // Static-host deployments may not yet contain the file.
}

export function serializeGaiReplayBundle(storage, committed = []) {
  // One compact, stable row per room recording: Git reviews do not get
  // thousands of formatting-only changes for each 7-integer input frame.
  const bundle = gaiReplayBundle(storage, committed);
  bundle.entries.sort((a, b) => a.signature.localeCompare(b.signature));
  const entries = bundle.entries.map(entry => `    ${JSON.stringify(entry)}`).join(',\n');
  const output = `{\n  "schema": ${JSON.stringify(GAI_REPLAY_BUNDLE_SCHEMA)},\n  "entries": [${entries ? `\n${entries}\n  ` : ''}]\n}\n`;
  if (output.length > MAX_REPO_BYTES) throw new Error('GAI repository cache exceeds 32 MB; curate older recordings before writing.');
  return output;
}

// The supplied directory MUST be the checkout root. No implicit writes or
// arbitrary paths: Chrome's picker grants explicit access to this directory.
export async function connectGaiReplayFolder(pickDirectory = globalThis.showDirectoryPicker) {
  if (typeof pickDirectory !== 'function') throw new Error('Folder writing requires a Chromium browser with File System Access. Use Export JSON instead.');
  const root = await pickDirectory({mode:'readwrite', id:'rdr-gai-cache'});
  const pkg = JSON.parse(await (await root.getFileHandle('package.json')).getFile().then(file => file.text()));
  if (pkg.name !== 'xrick-rdx-web') throw new Error('Choose the Rick Dangerous Revival repository root (contains package.json).');
  let directory = root;
  for (const part of REPO_PARTS.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
  const handle = await directory.getFileHandle(REPO_PARTS.at(-1), {create:true});
  let existing = [];
  const file = await handle.getFile();
  if (file.size) {
    if (file.size > MAX_REPO_BYTES) throw new Error('Existing GAI repository cache is too large.');
    const parsed = JSON.parse(await file.text());
    if (parsed.schema !== GAI_REPLAY_BUNDLE_SCHEMA || !Array.isArray(parsed.entries))
      throw new Error('Existing GAI replay file has an unsupported format; refusing to overwrite.');
    existing = parseGaiReplayBundle(parsed);
    if (existing.length !== parsed.entries.length)
      throw new Error('Existing replay file contains invalid entries; refusing to discard recorded data.');
  }
  return {handle, existing};
}

export async function writeGaiReplayFolder(handle, storage, entries) {
  const text = serializeGaiReplayBundle(storage, entries);
  const writable = await handle.createWritable();
  try { await writable.write(text); await writable.close(); }
  catch (error) { await writable.abort().catch(() => {}); throw error; }
  return parseGaiReplayBundle(JSON.parse(text));
}

export function downloadGaiReplayBundle(storage, entries, doc = document) {
  const text = serializeGaiReplayBundle(storage, entries);
  const url = URL.createObjectURL(new Blob([text], {type:'application/json'}));
  try {
    const anchor = doc.createElement('a');
    anchor.href = url;
    anchor.download = 'room-replays.json';
    doc.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
