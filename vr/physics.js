import * as THREE from './vendor/three.module.js';
import { PhysicsCore, FLOATS_PER_BODY, FLOATS_PER_HIT } from './physics-core.js';

/** Light room props as rigid bodies (Rapier): every book on its own, the vitrine
 * finds, frames, the VCR and the CD32 set. Heavy furniture stays baked; the GLB's
 * Collider_<n> boxes give the props shelves, glass and a floor to land on. The
 * simulation runs in a worker; this side only applies the transforms it returns. */
const PAPER_DENSITY = 700; // kg/m³, a cloth-bound book
const HULL_POINTS = 1024;  // plenty to keep a vase round; Rapier reduces it to the hull
// What a prop is made of, from its role name (layout.json can set userData.material).
const MATERIAL_BY_NAME = [[/vase|jug|pot|amphora|bowl|skull|ceramic|figur/i, 'ceramic'],
  [/cd32|pad|joystick|vcr|cassette|tape|console/i, 'plastic'], [/lamp|metal|tin/i, 'metal']];

/** Split each React_books_* row (vertices tagged with _book) into one BatchedMesh
 * instance per book: a single draw call for every book in the room. */
export function splitBookRows(rows, material) {
  const books = [];
  for (const node of rows) {
    const row = node.isMesh ? node : node.getObjectByProperty('isMesh', true);
    row.updateWorldMatrix(true, false);
    const g = row.geometry, id = g.getAttribute('_book');
    if (!id) continue;
    const index = g.index ? g.index.array : Array.from({length: g.getAttribute('position').count}, (_, i) => i);
    const byBook = new Map();
    for (let t = 0; t < index.length; t += 3) {
      const book = Math.round(id.getX(index[t]));
      if (!byBook.has(book)) byBook.set(book, []);
      byBook.get(book).push(index[t], index[t + 1], index[t + 2]);
    }
    for (const triangles of byBook.values()) books.push(bookGeometry(g, triangles, row.matrixWorld));
  }
  const vertices = books.reduce((n, b) => n + b.geometry.getAttribute('position').count, 0);
  const indices = books.reduce((n, b) => n + b.geometry.index.count, 0);
  const mesh = new THREE.BatchedMesh(books.length, vertices, indices, material);
  mesh.name = 'Books';
  for (const book of books) {
    book.instance = mesh.addInstance(mesh.addGeometry(book.geometry));
    mesh.setMatrixAt(book.instance, new THREE.Matrix4().compose(book.position, book.quaternion, new THREE.Vector3(1, 1, 1)));
  }
  return {mesh, books};
}

function bookGeometry(source, triangles, matrix) {
  const remap = new Map(), names = ['position', 'uv', 'uv1', 'color'].filter(n => source.getAttribute(n));
  const data = Object.fromEntries(names.map(n => [n, []]));
  const index = triangles.map(v => {
    if (!remap.has(v)) {
      remap.set(v, remap.size);
      for (const n of names) {
        const a = source.getAttribute(n);
        for (let c = 0; c < a.itemSize; c++) data[n].push(a.getComponent(v, c)); // denormalised
      }
    }
    return remap.get(v);
  });
  const geometry = new THREE.BufferGeometry();
  for (const n of names) geometry.setAttribute(n, new THREE.Float32BufferAttribute(data[n], source.getAttribute(n).itemSize));
  geometry.setIndex(index);
  geometry.applyMatrix4(matrix); // room space; the book's own frame is axis-aligned like its row
  geometry.computeBoundingBox();
  const position = geometry.boundingBox.getCenter(new THREE.Vector3());
  const size = geometry.boundingBox.getSize(new THREE.Vector3());
  geometry.translate(-position.x, -position.y, -position.z);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return {geometry, position, quaternion: new THREE.Quaternion(), size,
    mass: Math.max(0.15, size.x * size.y * size.z * PAPER_DENSITY)};
}

export class RoomPhysics {
  /** joints: the furniture's doors and drawers (Joint_<n> nodes, origin at the hinge or
   * slide; userData joint, axis, limits, massKg). onHit({material, point, speed}) hears
   * every contact hard enough to make a sound, in room metres. worker: false runs the
   * simulation inline (tests, or browsers without module workers). */
  constructor({colliders = [], props = [], joints = [], books = null, random = Math.random, worker = true, onHit = null} = {}) {
    this.onHit = onHit;
    this.targets = [];
    const bodies = [];
    for (const node of joints) {
      const [x, y, z] = node.userData.axis, box = localBox(node); // localBox also updates the matrices
      bodies.push({mass: node.userData.massKg || 2, points: hullPoints(node), material: 'wood',
        size: plain(box.getSize(new THREE.Vector3())), offset: plain(box.getCenter(new THREE.Vector3())),
        joint: {type: node.userData.joint, axis: {x, y, z}, limits: node.userData.limits},
        position: plain(node.position), quaternion: plainQ(node.quaternion)});
      this.targets.push({node});
    }
    for (const node of props) {
      const box = localBox(node);
      bodies.push({mass: node.userData.massKg || 1, size: plain(box.getSize(new THREE.Vector3())),
        offset: plain(box.getCenter(new THREE.Vector3())), points: hullPoints(node), material: materialOf(node),
        position: plain(node.position), quaternion: plainQ(node.quaternion)});
      this.targets.push({node});
    }
    this.books = books;
    for (const book of books?.books || []) {
      bodies.push({mass: book.mass, size: plain(book.size), material: 'paper',
        position: plain(book.position), quaternion: plainQ(book.quaternion)});
      this.targets.push({book});
    }
    const scene = {colliders: colliders.map(c => ({position: plain(c.position), quaternion: plainQ(c.quaternion), size: plain(c.size)})), bodies};
    this.materials = bodies.map(body => body.material);
    this.awake = false;
    this.pending = false;
    if (worker && typeof Worker !== 'undefined') {
      this.worker = new Worker(new URL('./physics-worker.js', import.meta.url), {type: 'module'});
      // The worker queues everything until Rapier is up; `ready` settles once it is, or
      // rejects when the engine can't start (props then fall back to RoomReactions).
      this.ready = new Promise((resolve, reject) => { this.started = resolve; this.failed = reject; });
      this.worker.onmessage = ({data}) => {
        if (data.unavailable) { this.unavailable = true; this.failed(new Error(data.unavailable)); return; }
        this.started();
        this.pending = false; this.awake = data.active; this.apply(data.transforms); this.hear(data.hits);
      };
      this.worker.postMessage({type: 'init', scene});
      this.worker.postMessage({type: 'step', dt: 0}); // answered as soon as Rapier is up
    } else {
      // Inline: a hit before Rapier is up is kept and applied once it is.
      this.early = [];
      this.ready = PhysicsCore.create({...scene, random}).then(core => {
        this.core = core;
        for (const [strength, origin] of this.early) core.impulse(strength, origin);
        this.early = null;
      }, error => { this.unavailable = true; throw error; });
    }
  }

  impulse(strength = 1, origin = null) {
    origin = origin && {x: origin.x, y: origin.y, z: origin.z};
    if (this.core) this.core.impulse(strength, origin);
    else if (this.worker) this.worker.postMessage({type: 'impulse', strength, origin});
    else this.early.push([strength, origin]);
    this.awake = true;
  }

  step(dt) {
    if (!this.awake || this.unavailable) return;
    if (!this.worker) {
      if (!this.core) return;
      this.apply(this.core.step(dt)); this.hear(this.core.takeHits()); this.awake = this.core.active; return;
    }
    if (this.pending) return; // the worker is still on the last frame; never queue up
    this.pending = true;
    this.worker.postMessage({type: 'step', dt});
  }

  reset() {
    if (this.core) this.apply(this.core.reset());
    else if (this.worker) this.worker.postMessage({type: 'reset'});
    this.awake = !!this.worker;
  }

  apply(transforms) {
    const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < transforms.length; i += FLOATS_PER_BODY) {
      const target = this.targets[transforms[i]];
      position.fromArray(transforms, i + 1);
      quaternion.fromArray(transforms, i + 4);
      if (target.node) { target.node.position.copy(position); target.node.quaternion.copy(quaternion); }
      else this.books.mesh.setMatrixAt(target.book.instance, matrix.compose(position, quaternion, one));
    }
  }

  hear(hits) {
    if (!this.onHit || !hits?.length) return;
    for (let i = 0; i < hits.length; i += FLOATS_PER_HIT)
      this.onHit({material: this.materials[hits[i]], point: {x: hits[i + 1], y: hits[i + 2], z: hits[i + 3]}, speed: hits[i + 4]});
  }

  dispose() { this.worker?.terminate(); }
}

/** Bounds in the node's own frame; a multi-material prop is a group of meshes. */
function localBox(node) {
  node.updateWorldMatrix(true, true);
  const box = new THREE.Box3(), toNode = node.matrixWorld.clone().invert();
  node.traverse(mesh => {
    if (!mesh.isMesh) return;
    mesh.geometry.computeBoundingBox();
    box.union(mesh.geometry.boundingBox.clone().applyMatrix4(toNode.clone().multiply(mesh.matrixWorld)));
  });
  return box;
}

/** Mesh vertices in the node's own frame, evenly thinned to HULL_POINTS. */
function hullPoints(node) {
  const points = [], toNode = node.matrixWorld.clone().invert(), v = new THREE.Vector3();
  let total = 0;
  node.traverse(mesh => { if (mesh.isMesh) total += mesh.geometry.getAttribute('position').count; });
  const stride = Math.max(1, Math.ceil(total / HULL_POINTS));
  node.traverse(mesh => {
    if (!mesh.isMesh) return;
    const toLocal = toNode.clone().multiply(mesh.matrixWorld), position = mesh.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i += stride) points.push(...v.fromBufferAttribute(position, i).applyMatrix4(toLocal).toArray());
  });
  return points;
}

function materialOf(node) {
  if (node.userData.material) return node.userData.material;
  return MATERIAL_BY_NAME.find(([pattern]) => pattern.test(node.name))?.[1] || 'wood';
}

const plain = v => ({x: v.x, y: v.y, z: v.z});
const plainQ = q => ({x: q.x, y: q.y, z: q.z, w: q.w});
