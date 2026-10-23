import { PhysicsCore } from './physics-core.js';

/** Runs the room's prop physics off the render thread (see physics.js). Messages that
 * arrive while Rapier's WebAssembly starts up wait for it, in order. */
let core = null, starting = null;
const handle = data => {
  let transforms;
  if (data.type === 'impulse') { core.impulse(data.strength, data.origin); return; }
  if (data.type === 'reset') transforms = core.reset();
  else if (data.type === 'step') transforms = core.step(data.dt);
  else return;
  const hits = core.takeHits();
  self.postMessage({transforms, hits, active: core.active}, [transforms.buffer, hits.buffer]);
};
self.onmessage = ({data}) => {
  if (data.type === 'init') {
    starting = PhysicsCore.create(data.scene).then(created => { core = created; },
      error => console.warn('Room physics unavailable:', error.message));
    return;
  }
  if (core) handle(data);
  else starting?.then(() => core && handle(data));
};
