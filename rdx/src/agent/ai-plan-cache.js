/* Explicitly opt-in browser-disk replay of a previously *executed* GAI room
 * certificate. This is an input tape, not a serialized native proof. Never use
 * it for a fresh GAI correctness/regression run. */
export const GAI_REPLAY_CACHE_KEY = 'rdr.gai.completed-room-replays.v1';
export const GAI_REPLAY_CACHE_SCHEMA = 'rdr.gai.completed-room-replay.v1';
export const GAI_REPLAY_MAX_FRAMES = 30000;
export const GAI_REPLAY_BUNDLE_SCHEMA = 'rdr.gai.completed-room-replays.v1';
const MAX_DISK_CHARS = 3_000_000;

export function gaiReplayFrame(snapshot) {
  const native = snapshot?.collision?.native;
  if (!native?.playerActive || !Number.isInteger(native.playerWorldX) || !Number.isInteger(native.playerWorldY)) return null;
  return [native.playerWorldX, native.playerWorldY, snapshot.rick.state,
    snapshot.inventory.bullets, snapshot.inventory.dynamite, snapshot.inventory.lives].map(Number);
}

export function gaiReplaySignature({ snapshot, appVersion, romSha256, bridgeContract, scenario,
  collisionPolicy, walkSpeed, coyoteFrames, jumpBufferFrames } = {}) {
  const start = gaiReplayFrame(snapshot);
  if (!start || !romSha256 || !Number.isInteger(scenario) || !snapshot?.collision?.native?.worldLoaded) return null;
  // The canonical restart is essential: this is NOT sufficient to recognize
  // an arbitrary live game state with private actor timers or mutable terrain.
  return JSON.stringify({ schema:GAI_REPLAY_CACHE_SCHEMA, appVersion, romSha256, bridgeContract,
    scenario, submap:snapshot.submap, map:snapshot.map, md:snapshot.collision.native.mapId,
    collisionPolicy, start, speedMultiplier:snapshot.speedMultiplier,
    debugInvincible:snapshot.debug?.invincible, infiniteResources:snapshot.debug?.infiniteResources,
    ignoreExplodableCollision:snapshot.debug?.ignoreExplodableCollision,
    walkSpeed, coyoteFrames, jumpBufferFrames, runtimeOptions:snapshot.runtimeOptions });
}

function readEntries(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(GAI_REPLAY_CACHE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function validEntry(entry) {
  if (entry?.schema !== GAI_REPLAY_CACHE_SCHEMA || typeof entry.signature !== 'string' ||
      !entry.signature.startsWith('{') || !Number.isInteger(entry.destinationSubmap) ||
      entry.destinationSubmap < 0 || entry.destinationSubmap > 0xffff ||
      !Array.isArray(entry.frames) || !entry.frames.length || entry.frames.length > GAI_REPLAY_MAX_FRAMES ||
      !entry.frames.every(frame => Array.isArray(frame) && frame.length === 7 &&
        frame.every(Number.isInteger) && frame[0] >= 0 && frame[0] <= 0x1f)) return false;
  try { return JSON.parse(entry.signature)?.schema === GAI_REPLAY_CACHE_SCHEMA; }
  catch { return false; }
}

// A checked-in bundle is purely data: browsers on new devices fetch it through
// the normal static web assets path. Reject incompatible/malformed files.
export function parseGaiReplayBundle(data) {
  if (!data || data.schema !== GAI_REPLAY_BUNDLE_SCHEMA || !Array.isArray(data.entries)) return [];
  return data.entries.filter(validEntry);
}

// Local, newly recorded runs override earlier committed versions of the same key.
export function gaiReplayBundle(storage, checkedIn = []) {
  const entries = new Map();
  for (const entry of [...checkedIn, ...readEntries(storage)])
    if (validEntry(entry)) entries.set(entry.signature, entry);
  return { schema:GAI_REPLAY_BUNDLE_SCHEMA, entries:[...entries.values()] };
}

export function loadGaiReplay(storage, signature, checkedIn = []) {
  if (!signature) return null;
  const entry = gaiReplayBundle(storage, checkedIn).entries.find(item => item.signature === signature);
  return entry ? {frames:entry.frames, destinationSubmap:entry.destinationSubmap} : null;
}

export function removeGaiReplay(storage, signature) {
  if (!signature) return;
  try { storage?.setItem(GAI_REPLAY_CACHE_KEY, JSON.stringify(readEntries(storage).filter(item => item.signature !== signature))); }
  catch { /* Storage blocked: fail closed to fresh planning next time. */ }
}

export function saveGaiReplay(storage, signature, frames, destinationSubmap) {
  if (!signature || !Number.isInteger(destinationSubmap) || destinationSubmap < 0 || !Array.isArray(frames) || !frames.length || frames.length > GAI_REPLAY_MAX_FRAMES ||
      !frames.every(frame => Array.isArray(frame) && frame.length === 7 &&
        frame.every(Number.isInteger) && frame[0] >= 0 && frame[0] <= 0x1f)) return false;
  try {
    const entry = {schema:GAI_REPLAY_CACHE_SCHEMA, signature, frames, destinationSubmap};
    const entries = readEntries(storage).filter(item => item?.signature !== signature);
    entries.push(entry);
    while (entries.length && JSON.stringify(entries).length > MAX_DISK_CHARS) entries.shift();
    if (!entries.length) return false;
    storage?.setItem(GAI_REPLAY_CACHE_KEY, JSON.stringify(entries));
    return !!storage;
  } catch { return false; }
}
