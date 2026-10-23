import * as CANNON from './vendor/cannon-es.js';

/** The rigid-body side of the room's prop physics, free of Three.js so it can run
 * in a worker (physics-worker.js) and keep box-box contacts off the render thread.
 * Bodies sleep until an explosion wakes them, so a quiet room costs nothing. */
const STEP = 1 / 90;
const MAX_SPEED = 2.5; // m/s; with thick shelves this keeps fast books from tunnelling
const MIN_BOARD = 0.05; // shelves are 2 cm boards: collide as 5 cm, same top surface
export const FLOATS_PER_BODY = 8; // index, position xyz, quaternion xyzw

export class PhysicsCore {
  /** colliders: [{position, quaternion, size}]; bodies: [{mass, size, offset?, position, quaternion}] */
  constructor({colliders = [], bodies = [], random = Math.random} = {}) {
    this.random = random;
    this.world = new CANNON.World({gravity: new CANNON.Vec3(0, -9.81, 0), allowSleep: true});
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.solver.iterations = 6;
    this.world.defaultContactMaterial.friction = 0.45;
    this.world.defaultContactMaterial.restitution = 0.08;
    for (const c of colliders) {
      // No continuous collision detection in cannon: thin horizontal boards grow downward.
      const thin = c.size.y < MIN_BOARD && c.size.x > MIN_BOARD && c.size.z > MIN_BOARD;
      const height = thin ? MIN_BOARD : c.size.y;
      const body = new CANNON.Body({type: CANNON.Body.STATIC,
        shape: new CANNON.Box(new CANNON.Vec3(c.size.x / 2, height / 2, c.size.z / 2))});
      body.position.copy(c.position);
      body.position.y -= (height - c.size.y) / 2;
      body.quaternion.copy(c.quaternion);
      body.updateAABB(); // SAP sorts on the AABB, which static bodies never refresh themselves
      this.world.addBody(body);
    }
    this.bodies = bodies.map(spec => {
      // A hair smaller than the mesh: neighbours never start in contact.
      const half = new CANNON.Vec3(...['x', 'y', 'z'].map(a => Math.max(0.004, spec.size[a] / 2 - 0.0007)));
      const body = new CANNON.Body({mass: spec.mass, linearDamping: 0.05, angularDamping: 0.12,
        sleepSpeedLimit: 0.04, sleepTimeLimit: 0.4});
      body.addShape(new CANNON.Box(half), spec.offset ? new CANNON.Vec3(spec.offset.x, spec.offset.y, spec.offset.z) : undefined);
      body.position.copy(spec.position);
      body.quaternion.copy(spec.quaternion);
      this.world.addBody(body);
      body.sleep(); // stay exactly as baked until the first explosion
      return {body, moved: false, rest: {p: body.position.clone(), q: body.quaternion.clone()}};
    });
  }

  /** strength ~1 for dynamite, ~2.7 for a boulder landing in the room; origin in room metres. */
  impulse(strength = 1, origin = null) {
    const r = () => this.random() * 2 - 1;
    for (const {body} of this.bodies) {
      let falloff = 1;
      if (origin) falloff = 1 / (1 + 0.3 * body.position.distanceTo(new CANNON.Vec3(origin.x, origin.y, origin.z)) ** 2);
      // Lighter things jump more; each prop gets its own random kick, so nothing moves in unison.
      const k = strength * falloff * Math.min(1.6, 1 / Math.sqrt(body.mass)) * (0.5 + this.random());
      body.wakeUp();
      body.velocity.x += r() * 0.22 * k;
      body.velocity.z += (r() * 0.18 + 0.12) * k; // shelves push things out toward the room
      body.velocity.y += (0.25 + 0.35 * this.random()) * k;
      body.angularVelocity.x += r() * 4 * k;
      body.angularVelocity.y += r() * 1.5 * k;
      body.angularVelocity.z += r() * 4 * k;
    }
  }

  /** Advance and return the transforms of the bodies that moved (FLOATS_PER_BODY each). */
  step(dt) {
    if (!this.active) return new Float32Array(0);
    for (const {body} of this.bodies) {
      const speed = body.velocity.length();
      if (speed > MAX_SPEED) body.velocity.scale(MAX_SPEED / speed, body.velocity);
    }
    this.world.step(STEP, Math.min(Math.max(dt, 0), 0.1), 3);
    const out = [];
    this.bodies.forEach((entry, index) => {
      const {body} = entry;
      if (body.sleepState === CANNON.Body.SLEEPING && !entry.moved) return;
      if (body.position.y < -1) { body.position.copy(entry.rest.p); body.velocity.setZero(); } // fell through
      entry.moved = body.sleepState !== CANNON.Body.SLEEPING;
      const {position: p, quaternion: q} = body;
      out.push(index, p.x, p.y, p.z, q.x, q.y, q.z, q.w);
    });
    return new Float32Array(out);
  }

  get active() { return this.bodies.some(e => e.body.sleepState !== CANNON.Body.SLEEPING || e.moved); }

  /** Put every prop back where it was baked. */
  reset() {
    for (const entry of this.bodies) {
      entry.body.position.copy(entry.rest.p);
      entry.body.quaternion.copy(entry.rest.q);
      entry.body.velocity.setZero();
      entry.body.angularVelocity.setZero();
      entry.body.sleep();
      entry.moved = true;
    }
    return this.step(0);
  }
}
