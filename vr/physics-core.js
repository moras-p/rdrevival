
/** The rigid-body side of the room's prop physics (Rapier), free of Three.js so it can
 * run in a worker (physics-worker.js) off the render thread. Props are convex hulls of
 * their meshes and books are boxes, each with a surface material; continuous collision
 * detection keeps fast books out of the 2 cm shelves. Gravity, bouncing, friction,
 * stacking, rolling and tipping are the engine's. Bodies sleep until a hit wakes them,
 * so a quiet room costs nothing. */
const STEP = 1 / 90;
const MAX_STEPS = 3;
// Who collides with whom: (membership << 16) | filter. Doors and drawers touch only the
// props (their joints hold them to the furniture, whose boards they overlap at the edges).
const STATIC = (1 << 16) | 0xffff, PROP = (2 << 16) | 0x7, MOVING = (4 << 16) | 0x2;
// A closed door or drawer is held by a magnetic catch (a stiff spring toward closed) until
// a hit throws it past CATCH; open, it only feels its hinge's or runners' friction.
const JOINTS = Object.freeze({
  hinge: {catch: 0.04, stiffness: 100, damping: 4, friction: 0.25},
  slide: {catch: 0.008, stiffness: 150, damping: 5, friction: 2.2}
});
const MAX_SPEED = 4; // m/s; nothing in a living room flies faster from a hit next door
export const FLOATS_PER_BODY = 8; // index, position xyz, quaternion xyzw
export const FLOATS_PER_HIT = 5;  // index, position xyz, impact speed (m/s)
const AUDIBLE = 0.25;  // m/s: slower contacts make no sound
const HIT_GAP = 0.09;  // s between two sounds from one body

/** Surfaces the props are made of (Rapier averages the pair's friction and restitution). */
export const MATERIALS = Object.freeze({
  paper: {friction: 0.62, restitution: 0.04},
  wood: {friction: 0.5, restitution: 0.12},
  ceramic: {friction: 0.42, restitution: 0.18},
  plastic: {friction: 0.38, restitution: 0.22},
  metal: {friction: 0.3, restitution: 0.15},
  board: {friction: 0.55, restitution: 0.1}
});

// Loaded on first use, not imported: if the vendored engine is missing (vendor_three.mjs
// not run after npm ci), the room still opens, just without moving props.
let RAPIER = null, ready = null;

/** How much of a hit reaches a prop d metres away (d2 = d²). The building carries every
 * blast in the map: a far one still rattles the room at half strength, a near one at full. */
export const shockFalloff = d2 => 0.5 + 0.5 / (1 + 0.15 * d2);
const init = () => (ready ??= import('./vendor/rapier.mjs').then(async module => {
  await module.default.init();
  RAPIER = module.default;
}));

export class PhysicsCore {
  /** Rapier's WebAssembly has to be instantiated first, once per thread. */
  static async create(scene) { await init(); return new PhysicsCore(scene); }

  /** colliders: [{position, quaternion, size}];
   * bodies: [{mass, size, offset?, points?, material?, position, quaternion}] */
  constructor({colliders = [], bodies = [], random = Math.random} = {}) {
    this.random = random;
    this.world = new RAPIER.World({x: 0, y: -9.81, z: 0});
    this.world.timestep = STEP;
    this.accumulator = 0;
    this.events = new RAPIER.EventQueue(true);
    this.byCollider = new Map(); this.hits = []; this.time = 0;
    for (const c of colliders) {
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(c.size.x / 2, c.size.y / 2, c.size.z / 2)
        .setTranslation(c.position.x, c.position.y, c.position.z).setRotation(c.quaternion)
        .setFriction(MATERIALS.board.friction).setRestitution(MATERIALS.board.restitution)
        .setCollisionGroups(STATIC));
    }
    const furniture = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.bodies = bodies.map(spec => {
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spec.position.x, spec.position.y, spec.position.z).setRotation(spec.quaternion)
        .setLinearDamping(0.05).setAngularDamping(0.12).setCcdEnabled(true));
      const material = MATERIALS[spec.material] || MATERIALS.wood;
      // Contacts hard enough to hear are reported (see step()).
      const collider = this.world.createCollider(shape(spec).setMass(spec.mass)
        .setFriction(material.friction).setRestitution(material.restitution)
        .setCollisionGroups(spec.joint ? MOVING : PROP)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(spec.mass * AUDIBLE / STEP), body);
      this.byCollider.set(collider.handle, this.byCollider.size);
      const p = body.translation(), q = body.rotation();
      const entry = {body, moved: false, heardAt: -1, rest: {p: {x: p.x, y: p.y, z: p.z}, q: {x: q.x, y: q.y, z: q.z, w: q.w}}};
      if (spec.joint) entry.joint = this.#attach(furniture, body, spec.joint);
      return entry;
    });
    this.#rest();
  }

  /** A door hinged, or a drawer sliding, at the node's origin (glTF frame axis; limits
   * in radians about it or metres along it, 0 = closed). */
  #attach(furniture, body, {type, axis, limits}) {
    const p = body.translation(), origin = {x: 0, y: 0, z: 0};
    const data = type === 'slide' ? RAPIER.JointData.prismatic(p, origin, axis) : RAPIER.JointData.revolute(p, origin, axis);
    const joint = this.world.createImpulseJoint(data, furniture, body, true);
    joint.setLimits(limits[0], limits[1]);
    return {joint, type, axis, limits, settings: JOINTS[type] || JOINTS.hinge, latched: null};
  }

  /** A door or drawer only takes the part of a hit its joint lets it move with: a door
   * swings open (or rattles against its stop), a drawer slides out on its runners. */
  #jolt(entry, k) {
    const {body, joint: {type, axis}} = entry;
    const [lo, hi] = entry.joint.limits;
    const open = type === 'slide' ? 1 : (Math.abs(lo) > Math.abs(hi) ? -1 : 1);
    const kick = k * (this.random() * 1.4 - 0.2) * open;
    if (type === 'slide') {
      const v = body.linvel();
      body.setLinvel({x: v.x + axis.x * kick * 0.35, y: v.y + axis.y * kick * 0.35, z: v.z + axis.z * kick * 0.35}, true);
    } else {
      const w = body.angvel();
      body.setAngvel({x: w.x + axis.x * kick, y: w.y + axis.y * kick, z: w.z + axis.z * kick}, true);
    }
  }

  /** How fast a door's free edge or a drawer front is moving. */
  #closingSpeed({body, joint: {type, axis}}) {
    if (type === 'slide') { const v = body.linvel(); return Math.abs(v.x * axis.x + v.y * axis.y + v.z * axis.z); }
    const w = body.angvel();
    return Math.abs(w.x * axis.x + w.y * axis.y + w.z * axis.z) * 0.35;
  }

  #heard(entry, speed) {
    if (speed < AUDIBLE || this.time - entry.heardAt < HIT_GAP) return;
    entry.heardAt = this.time;
    const p = entry.body.translation();
    this.hits.push(this.bodies.indexOf(entry), p.x, p.y, p.z, speed);
  }

  /** How far open a door (radians) or drawer (metres) is. */
  #opening(entry) {
    const {body, rest, joint: {type, axis}} = entry;
    if (type === 'slide') {
      const p = body.translation();
      return (p.x - rest.p.x) * axis.x + (p.y - rest.p.y) * axis.y + (p.z - rest.p.z) * axis.z;
    }
    const q = body.rotation(); // rest rotation is the identity for exported joints
    return 2 * Math.atan2(q.x * axis.x + q.y * axis.y + q.z * axis.z, q.w);
  }

  #motors() {
    for (const entry of this.bodies) {
      if (!entry.joint || entry.body.isSleeping()) continue;
      const {joint, settings} = entry.joint;
      const latched = Math.abs(this.#opening(entry)) < settings.catch;
      if (latched === entry.joint.latched) continue;
      if (latched && entry.joint.latched === false) this.#heard(entry, this.#closingSpeed(entry)); // clack
      entry.joint.latched = latched;
      if (latched) joint.configureMotorPosition(0, settings.stiffness, settings.damping);
      else joint.configureMotorVelocity(0, settings.friction);
    }
  }

  /** Every prop back where it was baked, asleep until the next hit. One step first, so
   * Rapier has found the contacts with the shelves: a body that is put to sleep before
   * it has any sinks into its shelf when it wakes. */
  #rest() {
    this.world.step();
    for (const entry of this.bodies) {
      const {body} = entry;
      if (entry.joint) entry.joint.latched = null;
      body.setTranslation(entry.rest.p, false);
      body.setRotation(entry.rest.q, false);
      body.setLinvel({x: 0, y: 0, z: 0}, false);
      body.setAngvel({x: 0, y: 0, z: 0}, false);
      body.sleep();
    }
    this.accumulator = 0;
  }

  /** A hit transmitted through the building: strength ~1 for dynamite, ~2.7 for a boulder
   * landing on the ceiling; origin in room metres. The floor and shelves jump, so props
   * hop and are thrown away from where it hit, the nearer the harder. */
  impulse(strength = 1, origin = null) {
    const r = () => this.random() * 2 - 1;
    for (const entry of this.bodies) {
      const {body} = entry, p = body.translation();
      let falloff = 1, ax = 0, az = 0;
      if (origin) {
        const dx = p.x - origin.x, dy = p.y - origin.y, dz = p.z - origin.z;
        falloff = shockFalloff(dx * dx + dy * dy + dz * dz);
        const flat = Math.hypot(dx, dz) || 1;
        ax = dx / flat; az = dz / flat;
      }
      // Lighter things jump more; each prop gets its own random kick, so nothing moves in unison.
      const k = strength * falloff * Math.min(1.6, 1 / Math.sqrt(body.mass())) * (0.5 + this.random());
      if (entry.joint) { this.#jolt(entry, k); continue; }
      const v = body.linvel(), w = body.angvel();
      body.setLinvel({
        x: v.x + (r() * 0.22 + ax * 0.12) * k,
        y: v.y + (0.25 + 0.35 * this.random()) * k,
        z: v.z + (r() * 0.18 + az * 0.12 + 0.08) * k // shelves push things out toward the room
      }, true);
      body.setAngvel({x: w.x + r() * 4 * k, y: w.y + r() * 1.5 * k, z: w.z + r() * 4 * k}, true);
    }
  }

  /** Advance and return the transforms of the bodies that moved (FLOATS_PER_BODY each). */
  step(dt) {
    if (!this.active) return new Float32Array(0);
    this.accumulator = Math.min(this.accumulator + Math.min(Math.max(dt, 0), 0.1), MAX_STEPS * STEP);
    while (this.accumulator >= STEP) {
      for (const {body} of this.bodies) {
        if (body.isSleeping()) continue;
        const v = body.linvel(), speed = Math.hypot(v.x, v.y, v.z);
        if (speed > MAX_SPEED) body.setLinvel({x: v.x * MAX_SPEED / speed, y: v.y * MAX_SPEED / speed, z: v.z * MAX_SPEED / speed}, true);
      }
      this.#motors();
      this.world.step(this.events);
      this.time += STEP;
      this.events.drainContactForceEvents(event => {
        // A hit's impulse over this step, per kilogram: the speed it was stopped from.
        for (const handle of [event.collider1(), event.collider2()]) {
          const index = this.byCollider.get(handle);
          if (index === undefined) continue;
          const entry = this.bodies[index];
          this.#heard(entry, event.totalForceMagnitude() * STEP / entry.body.mass());
        }
      });
      this.accumulator -= STEP;
    }
    const out = [];
    this.bodies.forEach((entry, index) => {
      const {body} = entry;
      if (body.isSleeping() && !entry.moved) return;
      if (body.translation().y < -1) { // left the room somehow: put it back
        body.setTranslation(entry.rest.p, true); body.setLinvel({x: 0, y: 0, z: 0}, true);
      }
      entry.moved = !body.isSleeping();
      const p = body.translation(), q = body.rotation();
      out.push(index, p.x, p.y, p.z, q.x, q.y, q.z, q.w);
    });
    return new Float32Array(out);
  }

  /** The audible contacts since the last call (FLOATS_PER_HIT each). */
  takeHits() { const hits = new Float32Array(this.hits); this.hits = []; return hits; }

  get active() { return this.bodies.some(e => !e.body.isSleeping() || e.moved); }

  /** Put every prop back where it was baked. */
  reset() {
    this.#rest();
    for (const entry of this.bodies) entry.moved = true;
    return this.step(0);
  }
}

/** The prop's convex hull when its mesh gave one, else its bounding box. */
function shape(spec) {
  const hull = spec.points?.length >= 12 ? RAPIER.ColliderDesc.convexHull(new Float32Array(spec.points)) : null;
  if (hull) return hull;
  // A hair smaller than the mesh: neighbours never start in contact.
  const half = ['x', 'y', 'z'].map(a => Math.max(0.004, spec.size[a] / 2 - 0.0007));
  const box = RAPIER.ColliderDesc.cuboid(...half);
  return spec.offset ? box.setTranslation(spec.offset.x, spec.offset.y, spec.offset.z) : box;
}
