export const COLLISION_SCHEMA = 'rdx.collision.v1';

export const CollisionAvailability = Object.freeze({
  UNAVAILABLE: 0,
  PARTIAL: 1,
  VERIFIED: 2,
  CONFLICT: 3
});

export const CollisionPolicy = Object.freeze({
  VERIFIED_ONLY_PAUSE: 0,
  CLASSIC_FALLBACK_WARN: 1,
  CLASSIC_ONLY: 2,
  RDX_VERIFIED: 3
});

export const CollisionPolicyName = Object.freeze({
  native_strict: CollisionPolicy.VERIFIED_ONLY_PAUSE,
  mixed_diagnostic: CollisionPolicy.CLASSIC_FALLBACK_WARN,
  classic_only: CollisionPolicy.CLASSIC_ONLY,
  native_experimental: CollisionPolicy.RDX_VERIFIED,
  /* Backward-compatible aliases for old query strings/debug scripts. */
  verified_only_pause: CollisionPolicy.VERIFIED_ONLY_PAUSE,
  classic_fallback_warn: CollisionPolicy.CLASSIC_FALLBACK_WARN,
  rdx_verified: CollisionPolicy.RDX_VERIFIED
});

export const CollisionClass = Object.freeze({
  SOLID: 1 << 0,
  CLIMB: 1 << 1,
  ONE_WAY: 1 << 2,
  LETHAL: 1 << 3,
  TRIGGER: 1 << 4
});

export const CollisionContact = Object.freeze({
  SOLID_LEFT: 1 << 0,
  SOLID_RIGHT: 1 << 1,
  SOLID_TOP: 1 << 2,
  SOLID_BOTTOM: 1 << 3,
  CLIMB: 1 << 4,
  ONE_WAY_TOP: 1 << 5,
  LETHAL: 1 << 6,
  TRIGGER: 1 << 7
});

export const ALL_COLLISION_CLASSES = Object.values(CollisionClass).reduce((a, b) => a | b, 0);

const CLASS_NAMES = Object.freeze({
  solid: CollisionClass.SOLID,
  open: CollisionClass.SOLID,
  climb: CollisionClass.CLIMB,
  oneWay: CollisionClass.ONE_WAY,
  lethal: CollisionClass.LETHAL,
  triggers: CollisionClass.TRIGGER,
  trigger: CollisionClass.TRIGGER
});

const CONTACT_NAMES = Object.freeze({
  solidLeft: CollisionContact.SOLID_LEFT,
  solidRight: CollisionContact.SOLID_RIGHT,
  solidTop: CollisionContact.SOLID_TOP,
  solidBottom: CollisionContact.SOLID_BOTTOM,
  climb: CollisionContact.CLIMB,
  oneWayTop: CollisionContact.ONE_WAY_TOP,
  lethal: CollisionContact.LETHAL,
  trigger: CollisionContact.TRIGGER
});

export function classMask(names = []) {
  let mask = 0;
  for (const name of names) {
    const bit = CLASS_NAMES[name];
    if (!bit) throw new Error(`Unknown collision class '${name}'`);
    mask |= bit;
  }
  return mask;
}

export function contactMask(names = []) {
  let mask = 0;
  for (const name of names) {
    const bit = CONTACT_NAMES[name];
    if (!bit) throw new Error(`Unknown collision contact '${name}'`);
    mask |= bit;
  }
  return mask;
}

export function availabilityValue(name) {
  const key = String(name || '').toLowerCase();
  if (key === 'unavailable') return CollisionAvailability.UNAVAILABLE;
  if (key === 'partial') return CollisionAvailability.PARTIAL;
  if (key === 'verified') return CollisionAvailability.VERIFIED;
  if (key === 'conflict') return CollisionAvailability.CONFLICT;
  throw new Error(`Unknown collision availability '${name}'`);
}

export function fnv1a32(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function mdKey(id) {
  /* Static fixture filenames predate the v27 hexadecimal display convention. */
  return `MD${String(Number(id)).padStart(4, '0')}`;
}

function mdDisplayName(id) {
  return `MD${Number(id).toString(10).padStart(4, '0')}`;
}

function validateCell(cell, width, height, roomKey, errors) {
  if (!Number.isInteger(cell.x) || !Number.isInteger(cell.y) || cell.x < 0 || cell.y < 0 || cell.x >= width || cell.y >= height) {
    errors.push(`${roomKey}: invalid cell coordinate ${JSON.stringify({ x: cell.x, y: cell.y })}`);
  }
  try { classMask(cell.verifiedClasses || []); } catch (error) { errors.push(`${roomKey}: ${error.message}`); }
  try { contactMask(cell.contacts || []); } catch (error) { errors.push(`${roomKey}: ${error.message}`); }
  if (!cell.evidenceId) errors.push(`${roomKey}: cell ${cell.x},${cell.y} lacks evidenceId`);
}

function validateRun(run, width, height, roomKey, errors) {
  if (!Number.isInteger(run.x) || !Number.isInteger(run.y) || !Number.isInteger(run.length) ||
      run.x < 0 || run.y < 0 || run.length <= 0 || run.y >= height || run.x + run.length > width) {
    errors.push(`${roomKey}: invalid run ${JSON.stringify({ x: run.x, y: run.y, length: run.length })}`);
  }
  try { classMask(run.verifiedClasses || []); } catch (error) { errors.push(`${roomKey}: ${error.message}`); }
  try { contactMask(run.contacts || []); } catch (error) { errors.push(`${roomKey}: ${error.message}`); }
  if (!run.evidenceId) errors.push(`${roomKey}: run ${run.x},${run.y}+${run.length} lacks evidenceId`);
}

function gridEntries(grid) {
  return {
    cells: Array.isArray(grid.cells) ? grid.cells : [],
    runs: Array.isArray(grid.runs) ? grid.runs : []
  };
}

export class RdxCollisionDataset {
  constructor(data, options = {}) {
    this.data = data;
    this.strictRomHash = options.strictRomHash ?? true;
    this.validation = this.validate(options.romSha256);
    if (!this.validation.ok) throw new Error(this.validation.errors.join('; '));
    this.version = data.version;
    this.romSha256 = data.romSha256;
    this.datasetHash = fnv1a32(`${data.schema}\n${data.version}\n${data.romSha256}`);
    this.rooms = new Map();
    for (const [key, source] of Object.entries(data.rooms || {})) {
      this.rooms.set(key, this.#compileRoom(key, source));
    }
  }

  validate(actualRomSha256 = null) {
    const errors = [];
    const warnings = [];
    const data = this.data;
    if (!data || data.schema !== COLLISION_SCHEMA) errors.push(`Expected ${COLLISION_SCHEMA}`);
    if (!data?.version) errors.push('Collision dataset lacks version');
    if (!/^[0-9a-f]{64}$/i.test(data?.romSha256 || '')) errors.push('Collision dataset has invalid ROM SHA-256');
    if (this.strictRomHash && actualRomSha256 && data.romSha256.toLowerCase() !== actualRomSha256.toLowerCase()) {
      errors.push(`Collision dataset ROM hash ${data.romSha256} does not match ${actualRomSha256}`);
    }
    if (data?.coordinateUnitPx !== 8) errors.push(`coordinateUnitPx must be 8, got ${data?.coordinateUnitPx}`);
    for (const [key, room] of Object.entries(data?.rooms || {})) {
      if (!/^MD\d{4}$/.test(key)) errors.push(`Invalid room key ${key}`);
      const grid = room.staticGrid || {};
      if (!Number.isInteger(grid.width) || !Number.isInteger(grid.height) || grid.width <= 0 || grid.height <= 0) {
        errors.push(`${key}: invalid static grid dimensions`);
        continue;
      }
      if (room.widthPx !== grid.width * 8 || room.heightPx !== grid.height * 8) {
        errors.push(`${key}: pixel dimensions do not match 8 px grid`);
      }
      let availability;
      try { availability = availabilityValue(room.availability); } catch (error) { errors.push(`${key}: ${error.message}`); continue; }
      let verified = 0;
      let unresolved = 0;
      try { verified = classMask(room.verifiedClasses || []); } catch (error) { errors.push(`${key}: ${error.message}`); }
      try { unresolved = classMask(room.unresolvedClasses || []); } catch (error) { errors.push(`${key}: ${error.message}`); }
      if (verified & unresolved) errors.push(`${key}: class cannot be both verified and unresolved`);
      if (availability === CollisionAvailability.VERIFIED && unresolved !== 0) errors.push(`${key}: verified room has unresolved classes`);
      if (availability === CollisionAvailability.VERIFIED && verified !== ALL_COLLISION_CLASSES) errors.push(`${key}: verified room lacks required classes`);
      if (availability === CollisionAvailability.UNAVAILABLE && verified !== 0) errors.push(`${key}: unavailable room declares verified classes`);
      const seen = new Uint8Array(grid.width * grid.height);
      let populated = 0;
      const evidenceIds = new Set((room.evidence || []).map(item => String(item.id || '')));
      const validateEntry = (entry, index, label) => {
        let entryVerified = 0;
        let entryContacts = 0;
        try { entryVerified = classMask(entry.verifiedClasses || []); } catch {}
        try { entryContacts = contactMask(entry.contacts || []); } catch {}
        if (entryVerified & ~verified) errors.push(`${key}: ${label} verifies a class not verified by the room`);
        if (entry.evidenceId && !evidenceIds.has(String(entry.evidenceId))) {
          errors.push(`${key}: ${label} references missing evidence '${entry.evidenceId}'`);
        }
        const contactClassMask =
          ((entryContacts & (CollisionContact.SOLID_LEFT | CollisionContact.SOLID_RIGHT | CollisionContact.SOLID_TOP | CollisionContact.SOLID_BOTTOM)) ? CollisionClass.SOLID : 0) |
          ((entryContacts & CollisionContact.CLIMB) ? CollisionClass.CLIMB : 0) |
          ((entryContacts & CollisionContact.ONE_WAY_TOP) ? CollisionClass.ONE_WAY : 0) |
          ((entryContacts & CollisionContact.LETHAL) ? CollisionClass.LETHAL : 0) |
          ((entryContacts & CollisionContact.TRIGGER) ? CollisionClass.TRIGGER : 0);
        if (contactClassMask & ~entryVerified) errors.push(`${key}: ${label} contains a contact without class verification`);
        if (index >= 0 && index < seen.length) {
          if (seen[index]) errors.push(`${key}: duplicate cell ${index % grid.width},${Math.floor(index / grid.width)}`);
          else { seen[index] = 1; populated += 1; }
        }
      };
      const entries = gridEntries(grid);
      for (const cell of entries.cells) {
        validateCell(cell, grid.width, grid.height, key, errors);
        const index = cell.y * grid.width + cell.x;
        validateEntry(cell, index, `cell ${cell.x},${cell.y}`);
      }
      for (const run of entries.runs) {
        validateRun(run, grid.width, grid.height, key, errors);
        if (!Number.isInteger(run.x) || !Number.isInteger(run.y) || !Number.isInteger(run.length)) continue;
        for (let dx = 0; dx < run.length; dx += 1) {
          const x = run.x + dx;
          const index = run.y * grid.width + x;
          validateEntry(run, index, `run ${run.x},${run.y}+${run.length}`);
        }
      }
      if (availability === CollisionAvailability.VERIFIED && populated !== grid.width * grid.height) {
        errors.push(`${key}: verified room must provide every 8 px cell`);
      }
      if (populated === 0 && availability !== CollisionAvailability.UNAVAILABLE) {
        warnings.push(`${key}: ${room.availability} room contains no verified cells`);
      }
    }
    return { ok: errors.length === 0, errors, warnings };
  }

  #compileRoom(key, source) {
    const width = source.staticGrid.width;
    const height = source.staticGrid.height;
    const count = width * height;
    const contacts = new Uint16Array(count);
    const verified = new Uint16Array(count);
    const evidence = new Uint32Array(count);
    const entries = gridEntries(source.staticGrid);
    const setEntry = (index, entry) => {
      contacts[index] = contactMask(entry.contacts || []);
      verified[index] = classMask(entry.verifiedClasses || []);
      evidence[index] = fnv1a32(String(entry.evidenceId));
    };
    for (const cell of entries.cells) setEntry(cell.y * width + cell.x, cell);
    for (const run of entries.runs) {
      for (let dx = 0; dx < run.length; dx += 1) setEntry(run.y * width + run.x + dx, run);
    }
    return Object.freeze({
      key,
      mdId: Number(key.slice(2)),
      widthPx: source.widthPx,
      heightPx: source.heightPx,
      width,
      height,
      availability: availabilityValue(source.availability),
      availabilityName: source.availability,
      verifiedClasses: classMask(source.verifiedClasses || []),
      unresolvedClasses: classMask(source.unresolvedClasses || []),
      verifiedClassNames: [...(source.verifiedClasses || [])],
      unresolvedClassNames: [...(source.unresolvedClasses || [])],
      contacts,
      verified,
      evidence,
      evidenceId: fnv1a32((source.evidence || []).map(item => item.id || '').join('|')),
      notes: source.notes || '',
      evidenceItems: Object.freeze([...(source.evidence || [])]),
      dynamicContacts: Object.freeze([...(source.dynamicContacts || [])]),
      coverage: Object.freeze({ ...(source.coverage || {}) })
    });
  }

  roomForMap(mapId) {
    return this.rooms.get(mdKey(mapId)) || null;
  }
}

export function classNamesFromMask(mask) {
  const out = [];
  if (mask & CollisionClass.SOLID) out.push('solid/open');
  if (mask & CollisionClass.CLIMB) out.push('climb');
  if (mask & CollisionClass.ONE_WAY) out.push('one-way');
  if (mask & CollisionClass.LETHAL) out.push('lethal');
  if (mask & CollisionClass.TRIGGER) out.push('triggers');
  return out;
}

export function collisionStatusText({ enabled, policy, room, submap, mapId, datasetVersion, runtime }) {
  if (!enabled) return { visible: false, headline: '', detail: '', kind: 'neutral' };
  const sm = `SM${Number(submap).toString(16).toUpperCase().padStart(2, '0')}`;
  const md = mdDisplayName(mapId);
  const descriptor = runtime?.native || {};
  const fallbackQueries = Number(runtime?.fallbackQueries || 0);

  if (policy === CollisionPolicy.CLASSIC_ONLY) {
    return {
      visible: true,
      headline: 'CLASSIC XRICK COLLISION — RDX DESCRIPTORS DISABLED',
      detail: `${sm} → ${md} | comparison mode; Rick still uses the same xrick movement solver`,
      kind: 'warn'
    };
  }

  if (!descriptor.worldLoaded || descriptor.mapId !== mapId) {
    const strict = policy === CollisionPolicy.VERIFIED_ONLY_PAUSE;
    return {
      visible: true,
      headline: strict
        ? 'RDX DESCRIPTOR WORLD UNAVAILABLE — GAMEPLAY PAUSED'
        : 'RDX DESCRIPTOR WORLD UNAVAILABLE — CLASSIC FLAGS ACTIVE',
      detail: `${sm} → ${md} | the mapped MT/ML world is not installed in WASM`,
      kind: strict ? 'error' : 'warn'
    };
  }

  if (policy === CollisionPolicy.VERIFIED_ONLY_PAUSE && !descriptor.worldReady) {
    return {
      visible: true,
      headline: 'RDX DESCRIPTOR WORLD INCOMPLETE — GAMEPLAY PAUSED',
      detail: `${sm} → ${md} | strict mode requires all declared descriptor capabilities`,
      kind: 'error'
    };
  }

  if (policy === CollisionPolicy.VERIFIED_ONLY_PAUSE && descriptor.unsupportedContacts > 0) {
    return {
      visible: true,
      headline: 'UNRESOLVED RDX DESCRIPTOR — GAMEPLAY PAUSED',
      detail: `${sm} → ${md} | MT 0x${descriptor.lastUnsupportedMt.toString(16).padStart(2, '0')} ML 0x${descriptor.lastUnsupportedMl.toString(16).padStart(2, '0')} at logic ${descriptor.lastUnsupportedX},${descriptor.lastUnsupportedY}`,
      kind: 'error'
    };
  }

  if (policy === CollisionPolicy.CLASSIC_FALLBACK_WARN) {
    const unresolved = classNamesFromMask(runtime?.unresolvedClasses ?? room?.unresolvedClasses ?? ALL_COLLISION_CLASSES);
    return {
      visible: true,
      headline: 'RDX DESCRIPTOR FALLBACK DIAGNOSTIC',
      detail: `${sm} → ${md} | live MT/ML → xrick 8px flags; unresolved ${unresolved.join(', ') || 'callbacks'} retain Classic semantics | fallback queries ${fallbackQueries} | legacy dataset ${datasetVersion || 'none'}`,
      kind: 'warn'
    };
  }

  if (!descriptor.worldReady || descriptor.unsupportedContacts > 0 || fallbackQueries > 0) {
    return {
      visible: true,
      headline: 'RDX DESCRIPTORS + XRICK — EXPLICIT CLASSIC FALLBACK',
      detail: `${sm} → ${md} | shared 8px xrick solver; unresolved/stateful descriptor semantics retain Classic flags | fallback queries ${fallbackQueries}`,
      kind: 'warn'
    };
  }

  return {
    visible: true,
    headline: 'RDX DESCRIPTORS + XRICK — SHARED 8PX SOLVER',
    detail: `${sm} → ${md} | live MT/ML placement projected to Classic SOLID/WAYUP/CLIMB/VERT/LETHAL/SPAD semantics`,
    kind: 'ok'
  };
}
