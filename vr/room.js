// Lazily loaded for both immersive VR and ordinary WebGL desktop preview.
// The packaging step copies the pinned Three.js module into ./vendor/.
import * as THREE from './vendor/three.module.js';
import { XRControllerInput } from './input.js';
import { DampedLamp, LampEventBridge } from './lamp.js';
import { selectFloorSpace, roomAnchor, floorSpaceDiagnostics } from './coordinates.js';

const box = (parent, color, size, position) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size),
    new THREE.MeshLambertMaterial({color}));
  mesh.position.set(...position);
  parent.add(mesh);
  return mesh;
};

export function describeRoomControls({ mode = 'game', left = false, right = false, mask = 0 } = {}) {
  return [
    `CONTROL: ${mode.toUpperCase()}`,
    `LEFT ${left ? 'CONNECTED' : 'NOT DETECTED'}  /  RIGHT ${right ? 'CONNECTED' : 'NOT DETECTED'}`,
    'LEFT STICK: MOVE   RIGHT TRIGGER: FIRE',
    'CD32: A JUMP  B DYNAMITE  X STICK',
    'SQUEEZE: GAME / ROOM (PAUSE)',
    'ROOM: TRIGGER OR SQUEEZE TO RESUME',
    'ROOM: LEFT STICK CLICK = HELP TOGGLE',
    'ROOM: RIGHT STICK CLICK = RECENTER',
    'EXIT: HEADSET MENU OR EXIT VR ON WEB PAGE',
    `INPUT: ${mask ? 'RECEIVED' : 'IDLE'}`,
    !left && !right ? 'WAKE CONTROLLERS AND CHECK QUEST HAND TRACKING SETTINGS' : ''
  ].filter(Boolean);
}

function makeRoom(sourceCanvas) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x211b1b);
  scene.add(new THREE.AmbientLight(0x9b8d79, 2));
  const world = new THREE.Group();
  scene.add(world);
  const ceilingLamp = new THREE.PointLight(0xffd094, 15, 4);
  ceilingLamp.position.set(0.7, 2, -1.1);
  world.add(ceilingLamp);
  box(world, 0x3d3532, [6, 0.12, 6], [0, -0.06, -1.5]); // upper surface: Y = 0
  box(world, 0x665246, [6, 3.6, 0.1], [0, 1.75, -2.5]);
  const crt = new THREE.Group();
  world.add(crt);
  box(crt, 0x2d2929, [1.38, 1.04, 0.17], [0, 0, -1.7]);
  box(crt, 0x161719, [1.23, 0.83, 0.024], [0, 0.05, -1.596]);
  const texture = new THREE.CanvasTexture(sourceCanvas);
  texture.magFilter = texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  const tv = new THREE.Mesh(new THREE.PlaneGeometry(1.13, 0.70625),
    new THREE.MeshBasicMaterial({map:texture,toneMapped:false,side:THREE.FrontSide}));
  tv.position.set(0, 0.06, -1.573);
  crt.add(tv);
  box(crt, 0x57412c, [1.52, 0.13, 0.44], [0, -0.46, -1.69]);
  box(world, 0x6b6254, [0.48, 0.035, 0.48], [-1.35, 0.06, -1.1]);
  box(world, 0x433a39, [0.48, 0.26, 0.4], [1.35, 0.14, -1.05]);
  const pivot = new THREE.Group();
  pivot.position.set(0.7, 2.38, -1.35);
  world.add(pivot);
  box(pivot, 0x807367, [0.025, 0.42, 0.025], [0, -0.21, 0]);
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.22, 8),
    new THREE.MeshLambertMaterial({color:0xc7a16d}));
  shade.rotation.z = Math.PI;
  shade.position.y = -0.5;
  pivot.add(shade);

  const instructions = document.createElement('canvas');
  instructions.width = 1024;
  instructions.height = 512;
  const ctx = instructions.getContext('2d');
  const infoTexture = new THREE.CanvasTexture(instructions);
  const infoMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 0.575),
    new THREE.MeshBasicMaterial({map:infoTexture,side:THREE.DoubleSide,toneMapped:false}));
  infoMesh.position.set(1.22, 1.39, -1.49);
  infoMesh.rotation.y = -0.18;
  world.add(infoMesh);
  let lastText = '';
  const updatePanel = (status, expanded = true) => {
    const lines = expanded ? describeRoomControls(status) : [`${(status?.mode || 'game').toUpperCase()}  /  SQUEEZE TO SWITCH`];
    const string = lines.join('\n');
    if (lastText === string) return;
    lastText = string;
    ctx.fillStyle = '#181a21'; ctx.fillRect(0, 0, 1024, 512);
    ctx.fillStyle = '#f3d795'; ctx.font = 'bold 33px monospace';
    lines.forEach((line,i) => ctx.fillText(line, 23, 52 + i * 48, 980));
    infoTexture.needsUpdate = true;
  };
  updatePanel({});
  return {scene,world,crt,pivot,texture,infoTexture,updatePanel};
}

export async function openTestRoom({ xrSession = null, gameSession, presentation, onStatus, onEnd }) {
  const immersive = !!xrSession;
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-label', 'Rick Dangerous 3D room preview');
  canvas.className = 'rdr-room-canvas';
  document.body.append(canvas);
  const overlay = document.createElement('div');
  overlay.className = 'rdr-room-toolbar';
  overlay.innerHTML = `<strong>${immersive ? 'VR controls' : 'Desktop VR room preview'}</strong>
    <button type="button" data-action="focus">GAME controls</button>
    <button type="button" data-action="recenter">Recenter</button>
    <button type="button" data-action="help">Hide help</button>
    <button type="button" data-action="exit">Exit room</button>
    <small data-role="hint">${immersive ? 'Squeeze: GAME / ROOM' : 'Drag: look around · Wheel: distance · GAME: arrows/Space'}</small>`;
  document.body.append(overlay);
  const abort = new AbortController();
  const lamp = new DampedLamp();
  const eventBridge = new LampEventBridge(lamp);
  let renderer, adapter, unsubscribe, ending = false, ownsPresentation = false;
  let lastRevision = -1, frameCount = 0, uploadCount = 0, startAt = null;
  let lastMeasuredUploadRevision = -1, wasPausedForVisibility = false;
  let floorInfo = null, anchored = false, initialCrtHeight = null;
  let panelExpanded = true, status = {mode:'game'};
  let yaw = 0, pitch = 0, distance = 1.1, dragging = null;
  const debug = new URLSearchParams(location.search).has('input-trace') ||
    new URLSearchParams(location.search).has('vr-debug');
  const stop = async () => {
    if (ending) return;
    ending = true;
    abort.abort();
    renderer?.setAnimationLoop(null);
    adapter?.detach();
    unsubscribe?.();
    if (ownsPresentation) presentation.leave();
    if (gameSession.state === 'paused') gameSession.resume();
    gameSession.inputRouter?.clear();
    window.xrickFocusGame?.();
    gameSession.input.setOwner('game');
    try { if (xrSession && xrSession.visibilityState !== 'ended') await xrSession.end(); } catch {}
    renderer?.dispose();
    renderer?.forceContextLoss();
    canvas.remove(); overlay.remove();
    onEnd?.({mode:gameSession.mode,frames:frameCount,uploads:uploadCount,
      durationMs:startAt === null ? 0 : performance.now()-startAt,
      referenceSpace:floorInfo?.type || 'desktop'});
  };
  try {
    renderer = new THREE.WebGLRenderer({canvas,antialias:false,alpha:false,powerPreference:'high-performance'});
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.xr.enabled = immersive;
    const {scene,world,crt,pivot,texture,infoTexture,updatePanel} =
      makeRoom(document.getElementById('xrick-layer'));
    const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 40);
    const center = new THREE.Vector3(0, 1.4, -1.6);
    const updateDesktopCamera = () => {
      const radial = 1.4 + distance;
      camera.position.set(Math.sin(yaw) * radial * Math.cos(pitch),
        1.4 + Math.sin(pitch) * radial, -1.6 + Math.cos(yaw) * radial * Math.cos(pitch));
      camera.lookAt(center);
    };
    const resize = () => {
      if (immersive) { renderer.setSize(1024, 768, false); return; }
      renderer.setSize(window.innerWidth, window.innerHeight, false);
      camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
      camera.updateProjectionMatrix();
    };
    resize(); updateDesktopCamera();
    const recenter = (pose = null) => {
      if (!immersive) { yaw = pitch = 0; distance = 1.1; updateDesktopCamera(); return; }
      if (!pose) return;
      const head = pose.transform.position;
      const orientation = pose.transform.orientation;
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
        new THREE.Quaternion(orientation.x,orientation.y,orientation.z,orientation.w));
      const anchor = roomAnchor(head, forward);
      world.position.set(anchor.x, 0, anchor.z);
      world.rotation.y = anchor.yaw;
      if (initialCrtHeight === null) initialCrtHeight = anchor.crtHeight;
      crt.position.y = initialCrtHeight;
      floorInfo.diagnostics = floorSpaceDiagnostics(floorInfo.type, head, anchor);
      anchored = true;
    };
    const setRoomState = mode => {
      status = {...status,mode};
      updatePanel(status,panelExpanded);
      overlay.querySelector('[data-action="focus"]').textContent = `${mode.toUpperCase()} controls`;
      if (mode === 'room') {
        gameSession.input.setOwner('interaction');
        if (gameSession.state === 'playing') gameSession.pause();
      } else {
        if (gameSession.state === 'paused') gameSession.resume();
        gameSession.input.setOwner('game');
        if (!immersive) window.xrickFocusGame?.();
      }
      onStatus(mode === 'game' ? 'GAME controls active' : 'ROOM controls active · gameplay paused');
    };
    overlay.addEventListener('click', event => {
      const action = event.target?.dataset?.action;
      if (action === 'exit') void stop();
      if (action === 'help') {
        panelExpanded = !panelExpanded;
        updatePanel(status,panelExpanded);
        event.target.textContent = panelExpanded ? 'Hide help' : 'Show help';
      }
      if (action === 'focus') {
        if (adapter) adapter.setMode(adapter.mode === 'game' ? 'room' : 'game');
        else setRoomState(status.mode === 'game' ? 'room' : 'game');
      }
      if (!immersive && status.mode === 'game' && action && action !== 'exit')
        window.xrickFocusGame?.();
      if (action === 'recenter') {
        if (immersive) anchored = false; // next tracked pose recenters horizontally
        else recenter();
      }
    }, {signal:abort.signal});
    if (!immersive) {
      canvas.addEventListener('pointerdown', e => {
        if (status.mode === 'game') window.xrickFocusGame?.();
        dragging = [e.clientX,e.clientY]; canvas.setPointerCapture(e.pointerId); },{signal:abort.signal});
      canvas.addEventListener('pointermove', e => {
        if (!dragging) return;
        yaw += (e.clientX - dragging[0]) * 0.005;
        pitch = Math.max(-0.9,Math.min(0.9,pitch + (e.clientY - dragging[1])*0.005));
        dragging=[e.clientX,e.clientY]; updateDesktopCamera();
      },{signal:abort.signal});
      canvas.addEventListener('pointerup', () => { dragging=null; },{signal:abort.signal});
      canvas.addEventListener('wheel', e => { e.preventDefault(); distance=Math.max(0.25,Math.min(4,distance+e.deltaY*0.002)); updateDesktopCamera(); },{signal:abort.signal,passive:false});
      window.addEventListener('resize',resize,{signal:abort.signal});
      window.addEventListener('blur',() => setRoomState('room'),{signal:abort.signal});
    } else {
      floorInfo = await selectFloorSpace(xrSession);
      renderer.xr.setReferenceSpaceType(floorInfo.type);
      xrSession.addEventListener('end',stop,{signal:abort.signal});
      xrSession.addEventListener('visibilitychange',() => {
        if (xrSession.visibilityState !== 'visible') {
          adapter?.suspend();
          if (gameSession.state === 'playing') wasPausedForVisibility = gameSession.pause();
        } else if (wasPausedForVisibility) {
          wasPausedForVisibility=false;
          adapter?.suspend();
          onStatus('Headset restored · squeeze to resume GAME controls');
        }
      },{signal:abort.signal});
      adapter = new XRControllerInput(gameSession.inputRouter,{
        onRoomAction:setRoomState,
        onStatus:next => {status={...status,...next};updatePanel(status,panelExpanded);},
        onRecenter:() => {anchored=false;},
        onHelp:() => {panelExpanded = !panelExpanded;updatePanel(status,panelExpanded);}
      });
    }
    window.addEventListener('pagehide',() => {void stop();},{signal:abort.signal});
    if (!presentation.enter()) throw new Error('The game canvas is already owned by another room.');
    ownsPresentation = true; // the page canvas RAF is now exclusively ours
    unsubscribe = gameSession.events.subscribe(message => eventBridge.receive(message));
    gameSession.events.poll(0);
    if (immersive) {
      await renderer.xr.setSession(xrSession);
      renderer.xr.setReferenceSpace(floorInfo.space);
      adapter.attach(xrSession);
      onStatus(`Floor tracking: ${floorInfo.type} · wake both controllers and squeeze to pause`);
    } else {
      gameSession.inputRouter?.clear();
      gameSession.input.setOwner('game');
      window.xrickFocusGame?.();
      onStatus('Desktop room: mouse drag to look, wheel to zoom, arrows and Space to play');
    }
    renderer.setAnimationLoop((_time,frame) => {
      if (ending) return;
      // ROOM is paused, so native pre-actor polling is stopped. Only room UI
      // buttons are sampled in XR RAF; gameplay is still exclusively native-boundary.
      if (immersive && adapter?.mode === 'room') adapter.sample();
      if (immersive && !anchored && frame) {
        const pose = frame.getViewerPose(renderer.xr.getReferenceSpace());
        if (pose) recenter(pose);
      }
      const revision = presentation.present();
      if (revision !== lastRevision) {texture.needsUpdate=true;lastRevision=revision;uploadCount++;}
      gameSession.events.poll(64);
      pivot.rotation.z = lamp.step(performance.now()/1000,gameSession.state === 'playing');
      renderer.render(scene,camera);
      if (gameSession.inputRouter?.trace) {
        if (revision !== lastMeasuredUploadRevision) {
          gameSession.inputRouter.noteTextureSubmission(revision,presentation.frameSerial);
          lastMeasuredUploadRevision=revision;
        }
        if (immersive) gameSession.inputRouter.noteXRSubmission(revision);
      }
      frameCount++;
      if (startAt === null) startAt=performance.now();
      if (debug && frameCount%120===0)
        onStatus(`${immersive?'VR':'Preview'} frames ${frameCount} · canvas rev ${revision} · uploads ${uploadCount} · native frame ${presentation.frameSerial}`);
    });
    return {end:stop,getStats:() => ({mode:gameSession.mode,frames:frameCount,uploads:uploadCount,
      referenceSpace:floorInfo?.type || 'desktop',floorDiagnostics:floorInfo?.diagnostics || null})};
  } catch(error) { await stop(); throw error; }
}
