/* Opt-in input tapes for independently seeded native room baselines. No
 * carried-entry state or predecessor route is ever serialized/restored. */
export const GAI_REPLAY_CACHE_KEY = 'rdr.gai.completed-room-replays.v2';
export const GAI_REPLAY_CACHE_SCHEMA = 'rdr.gai.completed-room-replay.v2';
export const GAI_REPLAY_BUNDLE_SCHEMA = 'rdr.gai.completed-room-replays.v2';
export const GAI_REPLAY_BASELINE = 'native-independent-map-v1';
export const GAI_REPLAY_MAX_FRAMES = 30000;
const MAX_DISK_CHARS = 3_000_000;

export function gaiReplayInventory(snapshot) {
  const {lives, bullets, dynamite} = snapshot?.inventory || {};
  return Number.isInteger(lives) && lives >= 1 && lives <= 255 &&
    Number.isInteger(bullets) && bullets >= 0 && bullets <= 255 &&
    Number.isInteger(dynamite) && dynamite >= 0 && dynamite <= 255
    ? {lives, bullets, dynamite} : null;
}

export function gaiReplayFrame(snapshot) {
  const native = snapshot?.collision?.native;
  if (!native?.playerActive || !Number.isInteger(native.playerWorldX) || !Number.isInteger(native.playerWorldY)) return null;
  return [native.playerWorldX, native.playerWorldY, snapshot.rick.state,
    snapshot.inventory.bullets, snapshot.inventory.dynamite, snapshot.inventory.lives].map(Number);
}

export function gaiReplaySignature({ snapshot, appVersion, romSha256, bridgeContract, scenario,
  collisionPolicy, walkSpeed, coyoteFrames, jumpBufferFrames } = {}) {
  const start = gaiReplayFrame(snapshot);
  if (!start || !gaiReplayInventory(snapshot) || !romSha256 || !Number.isInteger(scenario) || !snapshot?.collision?.native?.worldLoaded) return null;
  return JSON.stringify({ schema:GAI_REPLAY_CACHE_SCHEMA, baseline:GAI_REPLAY_BASELINE,
    appVersion, romSha256, bridgeContract, scenario, submap:snapshot.submap, map:snapshot.map,
    md:snapshot.collision.native.mapId, collisionPolicy, start, speedMultiplier:snapshot.speedMultiplier,
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
  if (!entry || entry.schema !== GAI_REPLAY_CACHE_SCHEMA ||
      entry.baseline !== GAI_REPLAY_BASELINE || entry.entryRoute !== undefined ||
      entry.entryKind !== undefined || typeof entry.signature !== 'string' ||
      !Number.isInteger(entry.destinationSubmap) || entry.destinationSubmap < 0 || entry.destinationSubmap > 0xffff ||
      !Array.isArray(entry.frames) || !entry.frames.length || entry.frames.length > GAI_REPLAY_MAX_FRAMES ||
      !entry.frames.every(frame => Array.isArray(frame) && frame.length === 7 &&
        frame.every(Number.isInteger) && frame[0] >= 0 && frame[0] <= 0x1f)) return false;
  try {
    const signature = JSON.parse(entry.signature);
    const inventory = gaiReplayInventory({inventory:entry.initialInventory});
    return signature.schema === GAI_REPLAY_CACHE_SCHEMA && signature.baseline === GAI_REPLAY_BASELINE &&
      Number.isInteger(signature.submap) && Array.isArray(signature.start) && signature.start.length === 6 &&
      inventory !== null && signature.start[3] === inventory.bullets &&
      signature.start[4] === inventory.dynamite && signature.start[5] === inventory.lives &&
      entry.frames[0].slice(1).every((v,i) => v === signature.start[i]);
  } catch { return false; }
}

export function parseGaiReplayBundle(data) {
  if (!data || data.schema !== GAI_REPLAY_BUNDLE_SCHEMA || !Array.isArray(data.entries)) return [];
  return data.entries.filter(validEntry);
}

export function gaiReplayBundle(storage, checkedIn = []) {
  const entries = new Map();
  for (const entry of [...checkedIn, ...readEntries(storage)])
    if (validEntry(entry)) entries.set(entry.signature, entry);
  return {schema:GAI_REPLAY_BUNDLE_SCHEMA, entries:[...entries.values()]};
}

export function loadGaiReplay(storage, signature, checkedIn = []) {
  if (!signature) return null;
  return gaiReplayBundle(storage, checkedIn).entries.find(item => item.signature === signature) || null;
}

// Candidate selection compares the *map and runtime provenance*, but deliberately
// not its mutable inventory. Controller applies the saved inventory using the
// native setter, then requires an exact signature match before playing a tape.
export function findGaiReplayForRoom(storage, signature, checkedIn = [], rejected = new Set()) {
  if (!signature) return null;
  let wanted;
  try { wanted = JSON.parse(signature); } catch { return null; }
  if (wanted.schema !== GAI_REPLAY_CACHE_SCHEMA || wanted.baseline !== GAI_REPLAY_BASELINE) return null;
  const equivalent = value => {
    const {start, ...metadata} = value;
    return JSON.stringify({...metadata, startPose:start?.slice(0,3)});
  };
  return gaiReplayBundle(storage, checkedIn).entries.find(entry =>
    !rejected.has(entry.signature) && equivalent(JSON.parse(entry.signature)) === equivalent(wanted)) || null;
}

export function removeGaiReplay(storage, signature) {
  if (!signature) return;
  try { storage?.setItem(GAI_REPLAY_CACHE_KEY, JSON.stringify(readEntries(storage).filter(item => item.signature !== signature))); }
  catch { /* Blocked storage: fail closed. */ }
}

export function saveGaiReplay(storage, signature, frames, destinationSubmap, initialInventory) {
  const entry = {schema:GAI_REPLAY_CACHE_SCHEMA, baseline:GAI_REPLAY_BASELINE,
    signature, initialInventory, frames, destinationSubmap};
  if (!validEntry(entry)) return false;
  try {
    const entries = readEntries(storage).filter(item => item.signature !== signature);
    entries.push(entry);
    while (entries.length && JSON.stringify(entries).length > MAX_DISK_CHARS) entries.shift();
    if (!entries.length) return false;
    storage?.setItem(GAI_REPLAY_CACHE_KEY, JSON.stringify(entries));
    return !!storage;
  } catch { return false; }
}
