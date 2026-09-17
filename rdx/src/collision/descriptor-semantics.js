/* Shared RDX MT/ML -> xrick 8 px collision projection for browser developer
 * tools. Keep this in lock-step with revival/rev/src/rdx_collision.c and
 * tools/collision/rdx_descriptor_8x8.py. Presentation graphics and historical
 * visual geometry patches are deliberately not inputs. Explicit runtime
 * collision patches generated from config/rdx-collision-patches.json are a
 * separate gameplay authority and are applied after descriptor projection. */

export const MAP_EFLG = Object.freeze({
  AUX01:0x01,
  CLIMB:0x02,
  LETHAL:0x04,
  FGND:0x08,
  WAYUP:0x10,
  SPAD:0x20,
  SOLID:0x40,
  VERT:0x80
});

export const GAMEPLAY_MASK = MAP_EFLG.CLIMB | MAP_EFLG.LETHAL |
  MAP_EFLG.WAYUP | MAP_EFLG.SPAD | MAP_EFLG.SOLID | MAP_EFLG.VERT;

const LETHAL_SPECIAL = new Set([0x07,0x1b,0x1c,0x1d]);

/* Keep the browser-side eligibility rule identical to the research corpus
 * generator. This is only a classifier for an already aligned Classic 2x2
 * gameplay mask; it never searches nearby cells or consults graphics. */
export function classicCorrespondenceStatus(mlValue, maskValue, options = {}) {
  const ml = Number(mlValue) & 0xff;
  const terrainCandidate = LETHAL_SPECIAL.has(ml) || ml === 0x11 || ml === 0x12 || ml === 0x13;
  const matchedActivator = !!options?.matchedActivator && ml !== 0x14 && !terrainCandidate;
  if (!terrainCandidate && !matchedActivator) return 'not-applicable';
  if (!Array.isArray(maskValue) || maskValue.length !== 4) return 'out-of-bounds';
  const values = maskValue.map(value => Number(value) & GAMEPLAY_MASK);
  if (matchedActivator) return 'confident';
  const nonzero = values.some(Boolean);
  if (LETHAL_SPECIAL.has(ml)) {
    if (values.some(value => value & MAP_EFLG.LETHAL)) return 'confident';
    return nonzero ? 'ambiguous' : 'unmatched';
  }
  if (ml === 0x12) {
    /* A one-column Classic overlap can be caused by an 8px room-local phase
     * difference. It must never narrow the live 16px RDX ladder descriptor. */
    if (values.every(value => value & MAP_EFLG.CLIMB)) return 'confident';
    return nonzero ? 'ambiguous' : 'unmatched';
  }
  if (ml === 0x13) {
    const fullHead = values[0] & MAP_EFLG.VERT && values[1] & MAP_EFLG.VERT &&
      values[2] & MAP_EFLG.CLIMB && values[3] & MAP_EFLG.CLIMB;
    if (fullHead) return 'confident';
    return nonzero ? 'ambiguous' : 'unmatched';
  }
  if (ml === 0x11) {
    const solidQuadrants = values.filter(value => value & (MAP_EFLG.SOLID | MAP_EFLG.SPAD)).length;
    if (solidQuadrants === 4) return 'confident';
    return nonzero ? 'ambiguous' : 'unmatched';
  }
  return 'not-applicable';
}

export function projectRuntimeCollisionPatch(actionValue, classicFlagsValue = 0) {
  const action = String(actionValue || '');
  const classicFlags = Number(classicFlagsValue) & 0xff;
  let flags = classicFlags & (MAP_EFLG.FGND | MAP_EFLG.AUX01);
  if (action === 'open') return Object.freeze({ flags, known:true, source:'reviewed-collision-patch' });
  if (action === 'one-way') return Object.freeze({ flags:flags | MAP_EFLG.WAYUP, known:true, source:'reviewed-collision-patch' });
  if (action === 'climb-through') return Object.freeze({ flags:flags | MAP_EFLG.CLIMB, known:true, source:'reviewed-collision-patch' });
  if (action === 'lethal') return Object.freeze({ flags:flags | MAP_EFLG.LETHAL, known:true, source:'reviewed-collision-patch' });
  throw new Error(`Unsupported runtime collision patch action: ${action || '<empty>'}`);
}

export function projectRdxDescriptor(mtValue, mlValue, qyValue, classicFlagsValue = 0, options = {}) {
  const mt = Number(mtValue) & 0xff;
  const ml = Number(mlValue) & 0xff;
  const qy = Number(qyValue) & 1;
  const qx = Number(options?.qx ?? 0) & 1;
  const classicFlags = Number(classicFlagsValue) & 0xff;
  let flags = classicFlags & (MAP_EFLG.FGND | MAP_EFLG.AUX01);

  if (!(mt & 0x80)) {
    const mode = mt & 0x03;
    if (mode === 0) return Object.freeze({ flags, known:true, source:'mt-open' });
    if (mode === 1) {
      if (options?.squareHoleClearance && qx === 1 && qy === 1 && !(classicFlags & GAMEPLAY_MASK))
        return Object.freeze({ flags, known:true, source:'classic-square-hole-clearance' });
      flags |= MAP_EFLG.SOLID;
      if (classicFlags & MAP_EFLG.SPAD) flags |= MAP_EFLG.SPAD;
      return Object.freeze({ flags, known:true, source:'mt-solid' });
    }
    if (mode === 3) {
      if (qy === 0) flags |= MAP_EFLG.WAYUP;
      return Object.freeze({ flags, known:true, source:'mt-one-way' });
    }
    return Object.freeze({ flags:classicFlags, known:false, source:'fallback-mode2' });
  }

  const correspondenceMask = Array.isArray(options?.correspondenceMask) && options.correspondenceMask.length === 4
    ? options.correspondenceMask.map(value => Number(value) & GAMEPLAY_MASK)
    : null;
  const matchedActivator = !!options?.matchedActivator;
  if (correspondenceMask && classicCorrespondenceStatus(ml, correspondenceMask, { matchedActivator }) === 'confident') {
    flags |= correspondenceMask[qy * 2 + qx];
    if (ml === 0x13 && qy === 0) flags |= MAP_EFLG.WAYUP;
    return Object.freeze({
      flags, known:true, source:'classic-correspondence',
      correspondenceMask:Object.freeze([...correspondenceMask]), matchedActivator, qx, qy
    });
  }

  if (ml === 0x11) {
    flags |= MAP_EFLG.SOLID;
    if (classicFlags & MAP_EFLG.SPAD) flags |= MAP_EFLG.SPAD;
    return Object.freeze({ flags, known:true, source:'ml17-solid' });
  }
  if (ml === 0x12) return Object.freeze({ flags:flags | MAP_EFLG.CLIMB, known:true, source:'ml18-ladder' });
  if (ml === 0x13) return Object.freeze({ flags:flags | (qy === 0 ? (MAP_EFLG.VERT | MAP_EFLG.WAYUP) : MAP_EFLG.CLIMB), known:true, source:'ml19-ladder-head' });
  if (LETHAL_SPECIAL.has(ml)) return Object.freeze({ flags:flags | (qy === 1 ? MAP_EFLG.LETHAL : 0), known:true, source:'ml-lethal' });
  if (ml === 0x14) return Object.freeze({ flags, known:true, source:'ml20-exit' });
  return Object.freeze({ flags:classicFlags, known:false, source:'fallback-special' });
}

export const COLLISION_PRESETS = Object.freeze({
  original:null,
  'pass-through':Object.freeze({ mt:0x00, ml:0x00 }),
  solid:Object.freeze({ mt:0x01, ml:0x00 }),
  'one-way':Object.freeze({ mt:0x03, ml:0x00 }),
  'climb-through':Object.freeze({ mt:0x80, ml:0x12 }),
  lethal:Object.freeze({ mt:0x80, ml:0x07 }),
  exit:Object.freeze({ mt:0x80, ml:0x14 })
});

export function descriptorForCollisionPreset(name) {
  return COLLISION_PRESETS[String(name || '')] || null;
}

export function projectCollisionPreset(name, qy, classicFlags = 0) {
  const descriptor = descriptorForCollisionPreset(name);
  return descriptor ? projectRdxDescriptor(descriptor.mt, descriptor.ml, qy, classicFlags) : null;
}

export function collisionSemantic(flagsValue) {
  const flags = Number(flagsValue) & 0xff;
  if (flags & MAP_EFLG.LETHAL) return 'lethal';
  if (flags & MAP_EFLG.SPAD) return 'super-pad';
  if (flags & MAP_EFLG.SOLID) return 'solid';
  if (flags & MAP_EFLG.WAYUP) return 'one-way-support';
  if (flags & (MAP_EFLG.CLIMB | MAP_EFLG.VERT)) return 'climb-through';
  return 'open';
}

export function collisionSemanticName(flagsValue) {
  const flags = Number(flagsValue) & 0xff;
  const names = [];
  if (flags & MAP_EFLG.SOLID) names.push('full solid');
  if (flags & MAP_EFLG.SPAD) names.push('super pad / rebound support');
  if (flags & MAP_EFLG.WAYUP) names.push('one-way support');
  if (flags & MAP_EFLG.LETHAL) names.push('lethal');
  if (flags & MAP_EFLG.CLIMB) names.push('climb-through');
  if (flags & MAP_EFLG.VERT) names.push('vertical/climb entry');
  return names.length ? names.join(' + ') : 'open';
}
