import { PhysicsCore } from './physics-core.js';

/** Runs the room's prop physics off the render thread (see physics.js). */
let core = null;
self.onmessage = ({data}) => {
  if (data.type === 'init') { core = new PhysicsCore(data.scene); return; }
  if (!core) return;
  let transforms;
  if (data.type === 'impulse') { core.impulse(data.strength, data.origin); return; }
  if (data.type === 'reset') transforms = core.reset();
  else if (data.type === 'step') transforms = core.step(data.dt);
  else return;
  self.postMessage({transforms, active: core.active}, [transforms.buffer]);
};
