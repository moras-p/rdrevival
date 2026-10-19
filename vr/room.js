// Only imported after explicit immersive-vr user action. Locked release for this
// experimental slice; deployment should vendor this exact dependency offline.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';
import { XRControllerInput } from './input.js';
import { DampedLamp, LampEventBridge } from './lamp.js';

const box = (scene, color, size, position) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size),
    new THREE.MeshLambertMaterial({ color }));
  mesh.position.set(...position);
  scene.add(mesh);
  return mesh;
};

export async function openTestRoom({ xrSession, gameSession, presentation, onStatus, onEnd }) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;pointer-events:none;opacity:0';
  document.body.append(canvas);
  let renderer;
  let ending = false;
  let inXR = false;
  let adapter;
  let unsubscribe;
  let lastRevision = -1;
  let frameCount = 0, uploadCount = 0, startAt = null;
  let lastMeasuredUploadRevision = -1;
  let wasPausedForVisibility = false;
  let stats;
  const debug = new URLSearchParams(location.search).has('input-trace') ||
    new URLSearchParams(location.search).has('vr-debug');
  const lamp = new DampedLamp();
  const eventBridge = new LampEventBridge(lamp);
  const abort = new AbortController();
  const stop = async () => {
    if (ending) return;
    ending = true;
    abort.abort();
    if (renderer) renderer.setAnimationLoop(null);
    adapter?.detach();
    unsubscribe?.();
    presentation.leave();
    if (gameSession.state === 'paused') gameSession.resume();
    window.xrickFocusGame?.();
    gameSession.input.setOwner('game');
    try { if (xrSession && xrSession.visibilityState !== 'ended') await xrSession.end(); } catch {}
    if (renderer) { renderer.dispose(); renderer.forceContextLoss(); }
    canvas.remove();
    onEnd?.(stats ? { mode: stats.mode, frames: frameCount, uploads: uploadCount,
      durationMs: startAt === null ? 0 : performance.now() - startAt } : null);
  };
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(1);
    renderer.setSize(1024, 768, false);
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local');
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x211b1b);
    const world = new THREE.Group();
    scene.add(world);
    const camera = new THREE.PerspectiveCamera(72, 4 / 3, 0.05, 40);
    camera.position.y = 1.5;
    scene.add(new THREE.AmbientLight(0x9b8d79, 2.0));
    const ceilingLamp = new THREE.PointLight(0xffd094, 15, 4);
    ceilingLamp.position.set(0.7, 2.0, -1.1);
    world.add(ceilingLamp);
    box(world, 0x3d3532, [6, 0.12, 6], [0, -0.08, -1.5]);
    box(world, 0x665246, [6, 3.6, 0.1], [0, 1.75, -2.5]);
    box(world, 0x2d2929, [1.38, 1.04, 0.17], [0, 1.35, -1.7]);
    box(world, 0x161719, [1.23, 0.83, 0.024], [0, 1.40, -1.596]);
    const texture = new THREE.CanvasTexture(document.getElementById('xrick-layer'));
    texture.magFilter = texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    const tv = new THREE.Mesh(new THREE.PlaneGeometry(1.13, 0.70625),
      new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, side: THREE.FrontSide }));
    tv.position.set(0, 1.41, -1.573);
    world.add(tv);
    box(world, 0x57412c, [1.52, 0.13, 0.44], [0, 0.89, -1.69]);
    box(world, 0x6b6254, [0.48, 0.035, 0.48], [-1.35, 0.06, -1.1]); // disc
    box(world, 0x433a39, [0.48, 0.26, 0.4], [1.35, 0.14, -1.05]); // console

    const pivot = new THREE.Group();
    pivot.position.set(0.7, 2.38, -1.35);
    world.add(pivot);
    box(pivot, 0x807367, [0.025, 0.42, 0.025], [0, -0.21, 0]);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.22, 8),
      new THREE.MeshLambertMaterial({ color: 0xc7a16d }));
    shade.rotation.z = Math.PI;
    shade.position.y = -0.5;
    pivot.add(shade);

    const recenter = () => {
      const xrCamera = renderer.xr.getCamera(camera);
      // Reposition only room props, never fake or shake the tracked headset.
      const head = new THREE.Vector3();
      const facing = new THREE.Vector3(0, 0, -1);
      xrCamera.getWorldPosition(head);
      xrCamera.getWorldDirection(facing);
      const yaw = Math.atan2(-facing.x, -facing.z);
      world.rotation.y = -yaw;
      world.position.set(head.x, 0, head.z);
    };
    adapter = new XRControllerInput(gameSession.inputRouter, {
      onRoomAction(mode) {
        if (mode === 'interaction') {
          gameSession.pause();
          onStatus('Room controls: squeeze or select to resume; headset system menu exits VR.');
        } else {
          if (gameSession.state === 'paused') gameSession.resume();
          gameSession.input.setOwner('game');
          recenter();
          onStatus('Playing in VR · squeeze to pause / room controls.');
        }
      }
    });
    xrSession.addEventListener('end', stop, { signal: abort.signal });
    xrSession.addEventListener('visibilitychange', () => {
      if (xrSession.visibilityState !== 'visible') {
        gameSession.input.clear();
        if (gameSession.state === 'playing') {
          wasPausedForVisibility = gameSession.pause();
        }
      } else if (wasPausedForVisibility) {
        // Never reassert a held key or auto-run behind a suspended headset.
        wasPausedForVisibility = false;
        adapter.mode = 'interaction';
        onStatus('Headset restored · select or squeeze to resume.');
      }
    }, { signal: abort.signal });
    window.addEventListener('pagehide', () => { void stop(); }, { signal: abort.signal });
    renderer.setAnimationLoop((_time, _frame) => {
      if (!inXR) return;
      const revision = presentation.present();
      if (revision !== lastRevision) {
        texture.needsUpdate = true;
        lastRevision = revision;
        uploadCount++;
      }
      gameSession.events.poll(64);
      pivot.rotation.z = lamp.step(performance.now() / 1000, gameSession.state === 'playing');
      renderer.render(scene, camera);
      if (gameSession.inputRouter?.trace) {
        if (revision !== lastMeasuredUploadRevision) {
          gameSession.inputRouter.noteTextureSubmission(revision, presentation.frameSerial);
          lastMeasuredUploadRevision = revision;
        }
        gameSession.inputRouter.noteXRSubmission(revision);
      }
      frameCount++;
      if (startAt === null) startAt = performance.now();
      if (debug && frameCount % 120 === 0) {
        onStatus(`VR frames ${frameCount} · canvas rev ${revision} · uploads ${uploadCount} · native frame ${presentation.frameSerial}`);
      }
    });
    // XR frame ownership is transferred before the first stereo submission.
    presentation.enter();
    inXR = true;
    unsubscribe = gameSession.events.subscribe(message => eventBridge.receive(message));
    gameSession.events.poll(0); // attach live without replaying old explosions
    await renderer.xr.setSession(xrSession);
    adapter.attach(xrSession);
    stats = { mode: gameSession.mode, browser: navigator.userAgent, startedAt: new Date().toISOString() };
    onStatus('Playing in VR · squeeze to pause / room controls.');
    return { end: stop, getStats: () => ({ mode: stats.mode, browser: stats.browser,
      startedAt: stats.startedAt, frames: frameCount, uploads: uploadCount,
      durationMs: startAt === null ? 0 : performance.now() - startAt }) };
  } catch (error) {
    await stop();
    throw error;
  }
}
