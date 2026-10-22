/** Presentation-only reactions of light room props to in-game explosions.
 * The GLB marks such props as React_<role> nodes with userData.react
 * (rattle | swing | slide) and userData.massKg; heavy furniture is baked into
 * RoomStatic and never moves. Lighter props react more, nearer ones too. */
const SLIDE_LIMIT = 0.12; // metres a floor prop may drift from where it was modelled

export class RoomReactions {
  constructor(nodes = [], {random = Math.random} = {}) {
    this.random = random;
    this.props = nodes.filter(node => ['rattle','swing','slide'].includes(node.userData?.react)).map(node => ({
      node, kind: node.userData.react, mass: Math.max(0.1, node.userData.massKg || 1),
      // A wall hanging swings about the wall normal (room.js sets swingAxis 'x' or 'z').
      swingAxis: node.userData.swingAxis || 'z',
      rest: {x: node.position.x, y: node.position.y, z: node.position.z,
        rx: node.rotation.x, ry: node.rotation.y, rz: node.rotation.z},
      // tilt about X/Z (rad), hop (m) and their velocities; slide offset persists
      tx: 0, tz: 0, hop: 0, vtx: 0, vtz: 0, vhop: 0, sx: 0, sz: 0, vsx: 0, vsz: 0
    }));
  }

  /** strength ~1 for a dynamite blast; origin is an optional room-space point. */
  impulse(strength = 1, origin = null) {
    for (const p of this.props) {
      let falloff = 1;
      if (origin) {
        const dx = p.node.position.x - origin.x, dy = p.node.position.y - origin.y, dz = p.node.position.z - origin.z;
        falloff = 1 / (1 + 0.6 * (dx * dx + dy * dy + dz * dz));
      }
      const k = strength * falloff / Math.sqrt(p.mass) * (0.7 + 0.6 * this.random());
      const sign = () => (this.random() < 0.5 ? -1 : 1);
      if (p.kind === 'rattle') {
        p.vtx += sign() * 0.9 * k; p.vtz += sign() * 0.9 * k; p.vhop += 0.25 * k;
      } else if (p.kind === 'swing') {
        p.vtz += sign() * 1.6 * k;
      } else {
        p.vsx += sign() * 0.35 * k; p.vsz += sign() * 0.35 * k; p.vtz += sign() * 0.6 * k;
      }
    }
  }

  step(dt) {
    dt = Math.min(Math.max(dt, 0), 0.05);
    for (const p of this.props) {
      // Damped springs back to rest; swings ring longer than rattles.
      const [stiff, damp] = p.kind === 'swing' ? [9, 1.2] : [160, 14];
      p.vtx += (-stiff * p.tx - damp * p.vtx) * dt; p.tx += p.vtx * dt;
      p.vtz += (-stiff * p.tz - damp * p.vtz) * dt; p.tz += p.vtz * dt;
      if (p.hop > 0 || p.vhop > 0) {
        p.vhop -= 9.81 * dt; p.hop += p.vhop * dt;
        if (p.hop <= 0) { p.hop = 0; p.vhop = p.vhop < -0.5 ? -p.vhop * 0.25 : 0; }
      }
      if (p.kind === 'slide') {
        const friction = Math.exp(-6 * dt);
        p.vsx *= friction; p.vsz *= friction;
        p.sx = Math.max(-SLIDE_LIMIT, Math.min(SLIDE_LIMIT, p.sx + p.vsx * dt));
        p.sz = Math.max(-SLIDE_LIMIT, Math.min(SLIDE_LIMIT, p.sz + p.vsz * dt));
      }
      const n = p.node;
      n.position.set(p.rest.x + p.sx, p.rest.y + p.hop, p.rest.z + p.sz);
      if (p.kind === 'swing' && p.swingAxis === 'x') n.rotation.set(p.rest.rx + p.tz, p.rest.ry, p.rest.rz);
      else n.rotation.set(p.rest.rx + p.tx, p.rest.ry, p.rest.rz + p.tz);
    }
  }

  get active() {
    return this.props.some(p => Math.abs(p.vtx) + Math.abs(p.vtz) + Math.abs(p.vhop) + Math.abs(p.vsx) + Math.abs(p.vsz) > 1e-3);
  }
}
