export const REALTIME_OBSERVATION_SCHEMA_VERSION = 2;
export const REALTIME_OBSERVATION_ABI_SIZE = 1112;
export const REALTIME_OBSERVATION_LEGACY_ABI_SIZES = Object.freeze({1:1092,2:1112});

const COUNTS = Object.freeze({ supports: 8, ladders: 6, hazards: 8, mechanisms: 6, exits: 4 });

function makeReader(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Realtime observation bytes must be a Uint8Array');
  if (!Object.values(REALTIME_OBSERVATION_LEGACY_ABI_SIZES).includes(bytes.byteLength)) {
    throw new Error(`Unsupported realtime observation ABI size ${bytes.byteLength}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  return {
    u32() { const value = view.getUint32(offset, true); offset += 4; return value >>> 0; },
    s32() { const value = view.getInt32(offset, true); offset += 4; return value | 0; },
    finish() { if (offset !== bytes.byteLength) throw new Error(`Realtime observation decoder consumed ${offset} of ${bytes.byteLength} bytes`); }
  };
}

export function decodeRealtimeObservation(bytes) {
  const r = makeReader(bytes);
  const schemaVersion = r.u32();
  const structSize = r.u32();
  const expectedSize = REALTIME_OBSERVATION_LEGACY_ABI_SIZES[schemaVersion];
  if (!expectedSize) throw new Error(`Unsupported realtime observation schema ${schemaVersion}`);
  if (structSize !== expectedSize || bytes.byteLength !== expectedSize) {
    throw new Error(`Realtime observation struct size mismatch: ${structSize}/${bytes.byteLength} != ${expectedSize}`);
  }
  const episode = {
    frameSerial: r.u32(), map: r.u32(), submap: r.u32(), worldGeneration: r.u32(),
    roomGeneration: r.u32(), lifeGeneration: r.u32(), progressCounter: r.u32(), stallCounter: r.u32()
  };
  if (schemaVersion >= 2) episode.terminalDistance = r.u32();
  const observation = {
    schema: `rdr.realtime-ai.observation.v${schemaVersion}`,
    schemaVersion, structSize, episode,
    player: {
      xFp: r.s32(), yFp: r.s32(), dxFp: r.s32(), dyFp: r.s32(), velocityYFp: r.s32(),
      bounds: { left: r.s32(), top: r.s32(), right: r.s32(), bottom: r.s32() },
      state: r.u32(), facing: r.u32(), contacts: r.u32(), grounded: !!r.u32(), climbing: !!r.u32(),
      crawling: !!r.u32(), dead: !!r.u32(), bullets: r.u32(), dynamite: r.u32(), lives: r.u32()
    },
    timing: {
      gameplayTickRate: r.u32(), currentControlMask: r.u32(), previousControlMask: r.u32(),
      previousSemanticAction: r.u32(), activeActionAge: r.u32(), priorLatencyMs: r.u32(),
      priorLatencyFrames: r.u32(), previousObservationFrame: r.u32()
    },
    terrain: {
      supportLeftDistance: r.s32(), supportRightDistance: r.s32(), wallLeftDistance: r.s32(),
      wallRightDistance: r.s32(), ceilingDistance: r.s32(), gapLeftDistance: r.s32(), gapRightDistance: r.s32(),
      supports: [], ladders: []
    },
    hazards: [], mechanisms: [], exits: []
  };
  const counts = { supports: r.u32(), ladders: r.u32(), hazards: r.u32(), mechanisms: r.u32(), exits: r.u32() };
  for (const [key, maximum] of Object.entries(COUNTS)) if (counts[key] > maximum) throw new Error(`Realtime observation ${key} count ${counts[key]} exceeds ABI cap ${maximum}`);
  for (let i = 0; i < COUNTS.supports; ++i) {
    const item = { x0: r.s32(), x1: r.s32(), y: r.s32(), type: r.u32() }; if (i < counts.supports) observation.terrain.supports.push(item);
  }
  for (let i = 0; i < COUNTS.ladders; ++i) {
    const item = { x: r.s32(), y0: r.s32(), y1: r.s32() }; r.u32(); if (i < counts.ladders) observation.terrain.ladders.push(item);
  }
  for (let i = 0; i < COUNTS.hazards; ++i) {
    const item = { id: r.u32(), entitySlot: r.u32(), mark: r.u32(), behavior: r.u32(), flags: r.u32(), bounds: { left: r.s32(), top: r.s32(), right: r.s32(), bottom: r.s32() }, dx: r.s32(), dy: r.s32() };
    if (i < counts.hazards) observation.hazards.push(item);
  }
  for (let i = 0; i < COUNTS.mechanisms; ++i) {
    const item = { id: r.u32(), entitySlot: r.u32(), mark: r.u32(), flags: r.u32(), bounds: { left: r.s32(), top: r.s32(), right: r.s32(), bottom: r.s32() } };
    if (i < counts.mechanisms) observation.mechanisms.push(item);
  }
  for (let i = 0; i < COUNTS.exits; ++i) {
    const connectorIndex=r.u32(), direction=r.u32(), targetSubmap=r.u32();
    const targetTerminalDistance=schemaVersion>=2?r.u32():null;
    const item = { connectorIndex, direction, targetSubmap, contactRow: r.u32(), targetTerminalDistance,
      bounds: { left: r.s32(), top: r.s32(), right: r.s32(), bottom: r.s32() } };
    if (i < counts.exits) observation.exits.push(item);
  }
  r.finish(); return Object.freeze(observation);
}
