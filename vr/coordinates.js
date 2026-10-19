/** WebXR floor tracking is never interchangeable with an eye-relative 'local' space. */
export async function selectFloorSpace(session) {
  for (const type of ['bounded-floor', 'local-floor']) {
    try {
      const space = await session.requestReferenceSpace(type);
      if (space) return { type, space };
    } catch { /* A stationary boundary may reject bounded-floor; try local-floor. */ }
  }
  throw new Error('Floor tracking is unavailable. Set up a Quest floor boundary, then re-enter VR.');
}

/** A stationary room anchor: head Y is used for CRT height, not world/floor position. */
export function roomAnchor(head, forward, { distance = 1.5 } = {}) {
  const yaw = Math.atan2(-forward.x, -forward.z) || 0;
  return {
    x: head.x, z: head.z, yaw,
    eyeHeight: head.y,
    crtHeight: Math.max(0.78, head.y - 0.08),
    distance
  };
}

export function floorSpaceDiagnostics(type, head, anchor) {
  return { referenceSpace: type, eyeHeight: head.y, roomOrigin: [anchor.x, 0, anchor.z],
    manualHeadHeightOffset: 0 };
}
