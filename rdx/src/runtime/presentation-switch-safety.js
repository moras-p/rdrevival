import { projectCollisionGrid } from '../core/map-topology.js';
import { CollisionClass, CollisionContact } from '../collision/dataset.js';

// Diagnostic only: the live switch never changes the native collision provider.
// These are the xrick pose/terrain constants from e_rick.h and maps.h.
const CELL = 8;
const RICK_SLOT = 1;
const CRAWL = 0x40;
const DEAD = 0x30;
const CLASSIC_SOLID = 0x40;
const RDX_SOLID = CollisionContact.SOLID_LEFT | CollisionContact.SOLID_RIGHT |
  CollisionContact.SOLID_TOP | CollisionContact.SOLID_BOTTOM;

const result = (state, reason, details = {}) => Object.freeze({ state, reason, ...details });

/**
 * Checks Rick's current *body*, not just his origin, in both source geometries.
 * Static solid/open evidence and the existing production-aligned shift field are
 * deliberately the only inputs. Dynamic traps and mutable geometry are not
 * proven by this indicator; this is a conservative filming aid, not a solver.
 */
export class PresentationSwitchSafety {
  constructor({ classicData, collisionDataset, shiftMap, mapping }) {
    this.shiftMap = shiftMap;
    this.rooms = new Map();
    for (const classic of classicData?.rooms || []) {
      const submap = Number(classic.submap);
      const level = mapping?.levelForSubmap(submap);
      const rdx = collisionDataset?.roomForMap(Number(level?.rdxMd));
      const shift = shiftMap?.roomForSubmap(submap);
      if (!level || !rdx || !shift) continue;
      this.rooms.set(submap, { classic, rdx: projectCollisionGrid(rdx, level.rdxTopology), shift });
    }
  }

  check(snapshot) {
    if (!snapshot?.enabled || snapshot.presentationMode)
      return result('unknown', 'Switch clearance is available only during live gameplay.');
    const room = this.rooms.get(Number(snapshot.submap));
    const rick = snapshot.entities?.find(entity => entity.slot === RICK_SLOT);
    if (!room || !rick || !snapshot.rick || !Number.isFinite(snapshot.cameraDeltaRows))
      return result('unknown', 'Rick or room correspondence is unavailable.');
    if (snapshot.rick.state & DEAD)
      return result('unknown', 'Rick is dying or restarting.');
    // Same world-sync authority as rdx_collision_player.c, which offsets
    // the signed native x coordinate and the canonical scrolling Y position.
    const classicX = (rick.x << 16 >> 16) + 11;
    const classicY = snapshot.cameraDeltaRows * CELL + rick.y - 44;
    const { classic, rdx, shift } = room;
    const x0 = classicX - 7, x1 = classicX + 7;
    // Foot support is deliberately excluded; it is not a wall penetration.
    // Crawling shortens Rick's occupied torso, but not his collision width.
    const y0 = classicY + ((snapshot.rick.state & CRAWL) ? 8 : 1);
    const y1 = classicY + 14;
    const visited = new Set();
    const detail = { submap: Number(snapshot.submap), classicX, classicY, rdxX: classicX + shift.runtimeOffset.dxPx, rdxY: classicY + shift.runtimeOffset.dyPx };
    for (let y = Math.floor(y0 / CELL); y <= Math.floor(y1 / CELL); y++) {
      for (let x = Math.floor(x0 / CELL); x <= Math.floor(x1 / CELL); x++) {
        const at = `${x},${y}`;
        if (visited.has(at)) continue;
        visited.add(at);
        if (x < 0 || y < 0 || x >= classic.widthTiles || y >= classic.heightTiles)
          return result('unknown', 'Rick is outside mapped Classic terrain.', { ...detail, cell: at });
        const flags = classic.flags?.[y * classic.widthTiles + x];
        if (!Number.isInteger(flags))
          return result('unknown', 'Classic terrain is incomplete.', { ...detail, cell: at });
        if (flags & CLASSIC_SOLID)
          return result('unsafe', 'Rick overlaps a Classic solid tile.', { ...detail, cell: at });
      }
    }
    // Sample the corresponding RDX body *as a rectangle*, including edge
    // cells. Per-cell shifts that disagree with the native runtime alignment
    // make the visual result uncertain even if the base transform matches.
    const rx0 = x0 + shift.runtimeOffset.dxPx;
    const rx1 = x1 + shift.runtimeOffset.dxPx;
    const ry0 = y0 + shift.runtimeOffset.dyPx;
    const ry1 = y1 + shift.runtimeOffset.dyPx;
    for (let y = Math.floor(ry0 / CELL); y <= Math.floor(ry1 / CELL); y++) {
      for (let x = Math.floor(rx0 / CELL); x <= Math.floor(rx1 / CELL); x++) {
        const cell = this.shiftMap.cell(detail.submap, x, y);
        if (!cell || cell.confidence < 0.7)
          return result('unknown', 'Classic↔RDX alignment is unverified at Rick’s body.', { ...detail, cell: `${x},${y}` });
        if (cell.correctionDxPx || cell.correctionDyPx)
          return result('unsafe', 'Local terrain shift differs from the live camera alignment.', { ...detail, cell: `${x},${y}`, residual: [cell.correctionDxPx, cell.correctionDyPx] });
        if (x < 0 || y < 0 || x >= shift.width || y >= shift.height)
          return result('unknown', 'Rick is outside RDX terrain.', { ...detail, cell: `${x},${y}` });
        if (x < 0 || y < 0 || x >= rdx.width || y >= rdx.height)
          return result('unknown', 'RDX topology has no matching terrain row.', { ...detail, cell: `${x},${y}` });
        const index = y * rdx.width + x;
        if (!(rdx.verified[index] & CollisionClass.SOLID))
          return result('unknown', 'RDX solid/open classification is not verified.', { ...detail, cell: `${x},${y}` });
        if (rdx.contacts[index] & RDX_SOLID)
          return result('unsafe', 'Rick overlaps an RDX solid tile.', { ...detail, cell: `${x},${y}` });
      }
    }
    return result('safe', 'Both static terrain masks clear Rick’s body; local alignment matches the live transform. Moving traps and mutable geometry are not checked.', detail);
  }
}
