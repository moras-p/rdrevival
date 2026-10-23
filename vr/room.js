// Lazily loaded for both immersive VR and ordinary WebGL desktop preview.
// The packaging step copies the pinned Three.js module into ./vendor/.
import * as THREE from './vendor/three.module.js';
import { XRControllerInput } from './input.js';
import { DampedLamp, LampEventBridge } from './lamp.js';
import { selectFloorSpace, roomAnchor, floorSpaceDiagnostics } from './coordinates.js';
import { SPATIAL_MODES } from './spatial/profile.js';
import { RoomLighting } from './lighting.js';
import { createCrtMaterial, crtTexture, faceplateGeometry, updateCrt } from './crt.js';
import { RoomPhysics, splitBookRows } from './physics.js';
import { SpatialRoomAudio } from './spatial/audio.js';
import { RoomSpatialController } from './spatial/controller.js';
import { SM00_SPATIAL_REPLAY, replaySpatialMessage } from './spatial/fixture.js';
import { SOURCE_KINDS, projectReferenceSources, sideElevation, replaceObservedSource } from './spatial/preview.js';
import { xrRenderSettings, VRFrameDiagnostics } from './performance.js';
import { RoomReactions } from './reactions.js';

const box = (parent, color, size, position) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size),
    new THREE.MeshLambertMaterial({color}));
  mesh.position.set(...position);
  parent.add(mesh);
  return mesh;
};

export function describeRoomControls({ mode = 'game', left = false, right = false, mask = 0, desktop = false, spatial = 'CRT only', performanceLabel = '', floorLabel = '' } = {}) {
  if (desktop) return [
    `CONTROL: ${mode.toUpperCase()}`,
    'ARROWS OR O/K/Z/X: MOVE',
    'SPACE: FIRE',
    'MOUSE DRAG: LOOK AROUND',
    'MOUSE WHEEL: ZOOM',
    'RECENTER: RESET VIEW',
    'GAME: KEYBOARD/GAMEPAD PLAYS RICK',
    'ROOM: GAMEPLAY PAUSED',
    'SWITCH MODE / EXIT: TOP TOOLBAR',
    `INPUT: ${mask ? 'RECEIVED' : 'IDLE'}`,
    `SPATIAL: ${spatial}`
  ];
  return [
    `CONTROL: ${mode.toUpperCase()}`,
    ...(performanceLabel ? [performanceLabel] : []),
    ...(floorLabel ? [floorLabel] : []),
    `LEFT ${left ? 'CONNECTED' : 'NOT DETECTED'}  /  RIGHT ${right ? 'CONNECTED' : 'NOT DETECTED'}`,
    'LEFT STICK: MOVE   RIGHT TRIGGER: FIRE',
    'CD32: A JUMP  B DYNAMITE  X STICK',
    'SQUEEZE: GAME / ROOM (PAUSE)',
    'ROOM: TRIGGER OR SQUEEZE TO RESUME',
    'ROOM: LEFT STICK CLICK = SPATIAL PROFILE',
    'ROOM: RIGHT STICK CLICK = RECENTER',
    'ROOM: A = LIGHTS  B = TIME OF DAY  Y = TIDY ROOM',
    'EXIT: HEADSET MENU OR EXIT VR ON WEB PAGE',
    `INPUT: ${mask ? 'RECEIVED' : 'IDLE'}`,
    `SPATIAL: ${spatial}`,
    !left && !right ? 'WAKE CONTROLLERS AND CHECK QUEST HAND TRACKING SETTINGS' : ''
  ].filter(Boolean);
}

// Built by tools/vr-room/build_room.py; the box room below is the fallback
// when the GLB has not been generated (or fails to load).
const LIVING_ROOM_URL = new URL('./assets/living-room.glb', import.meta.url);
const TUBE_ASPECT = 4 / 3, GAME_ASPECT = 320 / 200;


/** In-room help panel (debug only) and a short-lived bubble that announces
 * control-mode and spatial-profile changes. */
function makeHud(world, {desktop = false, debug = false} = {}) {
  const instructions = document.createElement('canvas');
  instructions.width = 1024;
  instructions.height = 512;
  const ctx = instructions.getContext('2d');
  const infoTexture = new THREE.CanvasTexture(instructions);
  const infoMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.45, 0.725),
    new THREE.MeshBasicMaterial({map:infoTexture,side:THREE.DoubleSide,toneMapped:false}));
  infoMesh.position.set(1.5, 1.39, -1.49);
  infoMesh.rotation.y = -0.18;
  infoMesh.visible = debug;
  world.add(infoMesh);

  const label = document.createElement('canvas');
  label.width = 1024;
  label.height = 128;
  const pen = label.getContext('2d');
  const bubbleTexture = new THREE.CanvasTexture(label);
  bubbleTexture.colorSpace = THREE.SRGBColorSpace;
  const bubble = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.09),
    new THREE.MeshBasicMaterial({map:bubbleTexture,transparent:true,opacity:0,depthTest:false,depthWrite:false,toneMapped:false}));
  bubble.renderOrder = 120;
  bubble.visible = false;
  let shownAt = -Infinity;
  const showBubble = text => {
    pen.clearRect(0, 0, 1024, 128);
    pen.font = 'bold 54px monospace';
    const width = Math.min(1000, pen.measureText(text).width + 80);
    pen.fillStyle = 'rgba(16,18,24,0.86)';
    pen.beginPath(); pen.roundRect((1024 - width) / 2, 8, width, 112, 56); pen.fill();
    pen.fillStyle = '#f3d795'; pen.textAlign = 'center'; pen.textBaseline = 'middle';
    pen.fillText(text, 512, 66, 960);
    bubbleTexture.needsUpdate = true;
    shownAt = performance.now();
    bubble.visible = true;
  };
  const tick = now => {
    if (!bubble.visible) return;
    const age = now - shownAt;
    const opacity = age < 150 ? age / 150 : age < 2200 ? 1 : 1 - (age - 2200) / 400;
    bubble.material.opacity = Math.max(0, opacity);
    if (opacity <= 0) bubble.visible = false;
  };

  let lastText = '', lastMode = null, lastSpatial = null;
  const updatePanel = (status, expanded = true) => {
    const mode = status?.mode || 'game', spatial = status?.spatial?.split(' · ')[0];
    if (lastMode !== null && mode !== lastMode) showBubble(mode === 'game' ? 'GAME CONTROLS' : 'ROOM CONTROLS · GAME PAUSED');
    else if (lastSpatial && spatial && spatial !== lastSpatial) showBubble(`SPATIAL: ${spatial.toUpperCase()}`);
    lastMode = mode;
    if (spatial) lastSpatial = spatial;
    if (!debug) return;
    const lines = expanded ? describeRoomControls({...status,desktop}) : [`${mode.toUpperCase()}  /  ${desktop ? 'TOOLBAR TO SWITCH' : 'SQUEEZE TO SWITCH'}`];
    const string = lines.join('\n');
    if (lastText === string) return;
    lastText = string;
    ctx.fillStyle = '#181a21'; ctx.fillRect(0, 0, 1024, 512);
    ctx.fillStyle = '#f3d795'; ctx.font = 'bold 33px monospace';
    const lineStep = Math.min(42, 460 / Math.max(1, lines.length - 1));
    lines.forEach((line,i) => ctx.fillText(line, 23, 40 + i * lineStep, 980));
    infoTexture.needsUpdate = true;
  };
  updatePanel({});
  return {infoMesh,infoTexture,bubble,updatePanel,tick,say:showBubble};
}

function makeBoxRoom(sourceCanvas, options = {}) {
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
  const texture = crtTexture(sourceCanvas);
  const tv = new THREE.Mesh(new THREE.PlaneGeometry(1.13, 0.70625), createCrtMaterial(texture, {triads: 900}));
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
  const hud = makeHud(world, options);
  hud.bubble.position.set(0, 0.5, -1.5);
  crt.add(hud.bubble);
  return {scene,world,crt,pivot,texture,hud,fixedTv:false,screen:tv,reactions:new RoomReactions()};
}

/** Baked room: unlit materials with the Cycles lightmap, so Quest pays for no
 * real-time lights or shadows. Only the TV screen is drawn live. */
/** Per-frame glass for the tube: the room light it reflects and the ceiling lamp highlight. */
function tubeUpdater(material, lighting, lamp) {
  const ambient = new THREE.Color(), warm = new THREE.Color(1.0, 0.8, 0.6), lampPosition = new THREE.Vector3();
  return seconds => {
    const level = lighting ? lighting.lampLevel : 1;
    ambient.copy(warm).multiplyScalar(0.06 * level);
    if (lighting) ambient.add(lighting.windowColor.clone().multiplyScalar(0.03));
    if (lamp) lamp.getWorldPosition(lampPosition);
    updateCrt(material, {time: seconds, lampLevel: level, ambient, lampPosition: lamp ? lampPosition : null});
  };
}

async function loadLivingRoom(sourceCanvas, options = {}) {
  const {GLTFLoader} = await import('./vendor/addons/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().loadAsync(LIVING_ROOM_URL.href);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050506);
  const world = new THREE.Group();
  world.add(gltf.scene);
  scene.add(world);
  const roomStatic = gltf.scene.getObjectByName('RoomStatic');
  const screen = gltf.scene.getObjectByName('TVScreen');
  if (!roomStatic || !screen?.isMesh) throw new Error('living-room.glb is missing RoomStatic or TVScreen');
  const {lightmap, lightmapScale = 1, ambientMap, windowScale, tvScale} = roomStatic.userData;
  const loadMap = async name => {
    if (!name) return null;
    const map = await new THREE.TextureLoader().loadAsync(new URL(name, LIVING_ROOM_URL).href);
    map.flipY = false; // glTF UV convention
    map.channel = 1;
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;
    return map;
  };
  const [lightMap, ambient] = await Promise.all([loadMap(lightmap), loadMap(ambientMap)]);
  const lighting = lightMap && ambient ? new RoomLighting({ambientMap:ambient,lampScale:lightmapScale,windowScale,tvScale}) : null;
  gltf.scene.traverse(object => {
    if (!object.isMesh || object === screen) return;
    const source = object.material;
    // Lamp glass, LEDs and the sky outside glow by themselves; everything else is lightmapped.
    const glow = source.emissive && Math.max(source.emissive.r, source.emissive.g, source.emissive.b) > 0;
    // Clear glass bakes to black (the lightmap only holds diffuse light), so draw it as a faint unlit tint.
    const glass = !glow && !source.transparent && (source.transmission > 0 || /glass|crystal/i.test(source.name));
    if (glass) {
      object.material = new THREE.MeshBasicMaterial({name: source.name, color: 0xdfe8ee, transparent: true,
        opacity: 0.12, depthWrite: false, side: source.side});
      source.dispose();
      return;
    }
    const map = glow ? source.emissiveMap : source.map;
    if (map) map.anisotropy = 8; // floors and walls seen at grazing angles stay sharp
    // Closed opaque surfaces are front-faced only: no hidden back faces to z-fight or overdraw.
    const thin = source.transparent || source.alphaTest > 0 || /leaf|leaves|plant|ficus|lace|curtain|paper/i.test(source.name);
    const lit = !glow && lightMap && object.geometry.attributes.uv1;
    object.material = new THREE.MeshBasicMaterial({
      name: source.name, map, vertexColors: source.vertexColors,
      color: glow ? source.emissive.clone().multiplyScalar(Math.min(1, source.emissiveIntensity)) : source.color,
      lightMap: lit ? lightMap : null,
      lightMapIntensity: lightmapScale * Math.PI,
      transparent: source.transparent, opacity: source.opacity, depthWrite: !source.transparent,
      alphaTest: source.alphaTest, side: thin ? THREE.DoubleSide : THREE.FrontSide
    });
    if (lit) lighting?.patch(object.material);
    else if (glow) lighting?.register(object.material);
    source.dispose();
  });
  const texture = crtTexture(sourceCanvas);
  const gameHeight = TUBE_ASPECT / GAME_ASPECT;
  screen.material.dispose();
  screen.material = createCrtMaterial(texture, {gameRect: [0, (1 - gameHeight) / 2, 1, gameHeight]});
  // The glass is rebuilt here from the build's faceplate parameters, so its curve can change
  // without a new lighting bake. A GLB from before they were exported has its node 32 mm deeper.
  screen.geometry.dispose();
  screen.geometry = faceplateGeometry(screen.userData.faceplate || {forward: 0.032});
  const swinging = [], props = [], bookRows = [], colliders = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(object => {
    if (object.name.startsWith('Collider_')) {
      colliders.push({position:object.position.clone(),quaternion:object.quaternion.clone(),size:object.scale.clone()});
      return;
    }
    const kind = object.userData?.react;
    if (!kind) return;
    if (kind === 'swing') {
      const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
      object.userData.swingAxis = size.x < size.z ? 'x' : 'z';
      swinging.push(object);
    } else if (kind === 'books') bookRows.push(object);
    else props.push(object);
  });
  let books = null;
  if (bookRows.length) {
    const rowMesh = row => row.isMesh ? row : row.getObjectByProperty('isMesh', true);
    books = splitBookRows(bookRows, rowMesh(bookRows[0]).material);
    for (const row of bookRows) { row.removeFromParent(); rowMesh(row).geometry.dispose(); }
    gltf.scene.add(books.mesh);
  }
  const physics = new RoomPhysics({colliders, props, books,
    worker: !new URLSearchParams(location.search).has('vr-physics-inline')});
  const hud = makeHud(world, options);
  const anchor = gltf.scene.getObjectByName('InfoPanelAnchor');
  if (anchor) { anchor.updateWorldMatrix(true, false); anchor.getWorldPosition(hud.infoMesh.position); }
  screen.geometry.computeBoundingBox();
  const top = screen.geometry.boundingBox.max.y;
  screen.updateWorldMatrix(true, false);
  hud.bubble.position.copy(screen.localToWorld(new THREE.Vector3(0, top + 0.1, 0.12)));
  world.add(hud.bubble);
  // The lamp feedback pendulum is not part of the living room; keep an
  // unattached pivot so the event bridge stays harmless.
  return {scene,world,crt:screen,pivot:new THREE.Group(),texture,hud,fixedTv:true,screen,
    reactions:new RoomReactions(swinging),physics,lighting,gameRect:[0,(1 - gameHeight) / 2,1,gameHeight],
    updateTube:tubeUpdater(screen.material,lighting,gltf.scene.getObjectByName('LampAnchor'))};
}

export async function makeRoom(sourceCanvas, options) {
  if (new URLSearchParams(location.search).has('vr-box-room')) return makeBoxRoom(sourceCanvas, options);
  try { return await loadLivingRoom(sourceCanvas, options); }
  catch (error) {
    console.warn('VR living room unavailable; using the box room.', error);
    return makeBoxRoom(sourceCanvas, options);
  }
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
    <button type="button" data-action="lights">Lights off</button>
    <button type="button" data-action="time">Time of day</button>
    <button type="button" data-action="tidy">Tidy room</button>
    <label>Spatial <select data-action="spatial">
      <option value="inside">Inside the map</option>
      <option value="behind-wall">Behind TV wall</option>
      <option value="crt-only">CRT only</option>
    </select></label>
    <label>Room effects <input data-action="effects" type="range" min="0" max="100" value="50"></label>
    <button type="button" data-action="audio">Enable room audio</button>
    <button type="button" data-action="exit">Exit room</button>
    <small data-role="spatial-status" aria-live="polite"></small>
    <small data-role="hint">${immersive ? 'Squeeze: GAME / ROOM' : 'Drag: look around · Wheel: distance · GAME: arrows/Space'}</small>`;
  document.body.append(overlay);
  const sourcePanel = !immersive ? document.createElement('aside') : null;
  if (sourcePanel) {
    sourcePanel.className='rdr-room-sources';
    sourcePanel.setAttribute('aria-label','Spatial sound sources');
    sourcePanel.innerHTML=`<header><strong>Sound origins</strong><small data-role="source-profile">SM00</small></header>
      <p>Side elevation · room metres, independent of camera and scrolling.</p>
      <div class="rdr-room-source-plot" data-role="source-plot" role="img"
        aria-label="Side elevation of sound origins relative to the CRT"></div>
      <div class="rdr-room-source-list" data-role="source-list"></div>
      <button type="button" data-action="source-tour">Play traced sequence</button>
      <small data-role="source-status" aria-live="polite">Reference positions from a native SM00 trace. Select a cue to audition with headphones.</small>`;
    document.body.append(sourcePanel);
  }
  const abort = new AbortController();
  const lamp = new DampedLamp();
  let reactions = null, physics = null; // set once the room has loaded
  // Explosions that swing the lamp also shake the living room's light props.
  const eventBridge = new LampEventBridge({
    impulse:(strength,origin) => {
      lamp.impulse(strength);
      reactions?.impulse(Math.abs(strength ?? 1));
      physics?.impulse(Math.abs(strength ?? 1),origin);
    },
    reset:() => lamp.reset()
  },{preserveMotion:true});
  const audio = new SpatialRoomAudio();
  let spatial, worldAnchor, sourceMarkers=[], sourceDebugText='';
  let previewSources=[], previewBeacons=new Map(), cueOrigin='live';
  const cueStatus=sourcePanel?.querySelector('[data-role="source-status"]');
  let debugOutline=null, debugTopEdge=null, debugEnemy=null, replayTimers=[], replayToken=0;
  let replaySerial=1000000;
  const cancelReplay=()=>{replayToken++;for (const timer of replayTimers) clearTimeout(timer); replayTimers=[];};
  const audioInRoom = {
    clear:()=>audio.clear(),
    play:(kind,point,calibration)=>{
      if (!worldAnchor) return false;
      const transformed=worldAnchor.localToWorld(new THREE.Vector3(point.x,point.y,point.z));
      return audio.play(kind,transformed,calibration);
    }
  };
  let renderer, adapter, unsubscribe, ending = false, ownsPresentation = false;
  let lastRevision = -1, frameCount = 0, uploadCount = 0, startAt = null;
  const timing = new VRFrameDiagnostics();
  const xrSettings = immersive ? xrRenderSettings(location.search) : null;
  let lastMeasuredUploadRevision = -1, wasPausedForVisibility = false;
  let floorInfo = null, anchored = false, initialCrtHeight = null;
  let panelExpanded = true, status = {mode:'game'};
  let yaw = 0, pitch = 0, distance = 1.1, dragging = null;
  const debug = new URLSearchParams(location.search).has('input-trace') ||
    new URLSearchParams(location.search).has('vr-debug');
  const stop = async () => {
    if (ending) return;
    ending = true;
    cancelReplay();
    abort.abort();
    renderer?.setAnimationLoop(null);
    adapter?.detach();
    unsubscribe?.();
    /* Relinquish the native XR clock before any asynchronous teardown; the
     * ordinary browser clock must resume even when audio cleanup is slow. */
    if (ownsPresentation) { presentation.leave(); ownsPresentation = false; }
    await audio.dispose();
    for (const group of previewBeacons.values()) group.traverse(object=>{
      object.geometry?.dispose();
      if (object.material) {
        object.material.map?.dispose();
        object.material.dispose();
      }
    });
    if (gameSession.state === 'paused') gameSession.resume();
    gameSession.inputRouter?.clear();
    window.xrickFocusGame?.();
    gameSession.input.setOwner('game');
    try { if (xrSession && xrSession.visibilityState !== 'ended') await xrSession.end(); } catch {}
    physics?.dispose();
    renderer?.dispose();
    renderer?.forceContextLoss();
    canvas.remove(); overlay.remove(); sourcePanel?.remove();
    onEnd?.({mode:gameSession.mode,frames:frameCount,uploads:uploadCount,
      durationMs:startAt === null ? 0 : performance.now()-startAt,
      referenceSpace:floorInfo?.type || 'desktop'});
  };
  try {
    // MSAA also applies to the XR layer (multisampled render-to-texture on Quest).
    renderer = new THREE.WebGLRenderer({canvas,antialias:immersive ? xrSettings.antialias : true,alpha:false,powerPreference:'high-performance'});
    // The desktop mirror's DPR must not allocate a multi-megapixel backbuffer
    // on Quest. Immersive resolution is independently controlled by WebXR.
    renderer.setPixelRatio(immersive ? 1 : Math.min(devicePixelRatio || 1, 2));
    if (immersive) {
      renderer.xr.setFramebufferScaleFactor(xrSettings.scale);
      renderer.xr.setFoveation(xrSettings.foveation);
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.xr.enabled = immersive;
    const room = await makeRoom(document.getElementById('xrick-layer'),{desktop:!immersive,debug});
    const {scene,world,crt,pivot,texture,hud,fixedTv,screen,lighting,gameRect,updateTube} = room;
    reactions = room.reactions;
    physics = room.physics || null;
    const toggleLights = () => {
      if (!lighting) return;
      hud.say(lighting.toggleLights() ? 'LIGHTS ON' : 'LIGHTS OFF');
      overlay.querySelector('[data-action="lights"]').textContent = lighting.lightsOn ? 'Lights off' : 'Lights on';
    };
    const cycleTime = () => { if (lighting) hud.say(lighting.cycleTimeOfDay().toUpperCase()); };
    const tidyRoom = () => { if (physics) { physics.reset(); hud.say('ROOM TIDIED'); } };
    if (!lighting) for (const action of ['lights','time']) overlay.querySelector(`[data-action="${action}"]`).hidden = true;
    if (!physics) overlay.querySelector('[data-action="tidy"]').hidden = true;
    const {updatePanel} = hud;
    if (!debug) overlay.querySelector('[data-action="help"]').hidden = true;
    worldAnchor=world;
    const activeSubmap = () => gameSession.bridge.submap();
    const spatialStatus=overlay.querySelector('[data-role="spatial-status"]');
    // These are read-only desktop beacons sharing the exact same projected
    // room positions as WebAudio panners. Show through the wall for inspection.
    if (sourcePanel) for (const config of SOURCE_KINDS) {
      const group=new THREE.Group(),fill=new THREE.MeshBasicMaterial({color:config.color,
        transparent:true,opacity:0.26,depthTest:false,depthWrite:false});
      const outline=new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(config.volume.x,config.volume.y,config.volume.z)),
        new THREE.LineBasicMaterial({color:config.color,depthTest:false,transparent:true,opacity:0.92}));
      const solid=new THREE.Mesh(new THREE.BoxGeometry(config.volume.x,config.volume.y,config.volume.z),fill);
      const base=new THREE.Line(new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-config.volume.x*0.4,-config.volume.y*0.55,0),
        new THREE.Vector3(config.volume.x*0.4,-config.volume.y*0.55,0)
      ]),new THREE.LineBasicMaterial({color:config.color,depthTest:false,transparent:true,opacity:0.9}));
      group.add(solid);group.add(outline);group.add(base);
      const legend=document.createElement('canvas');legend.width=256;legend.height=64;
      const pen=legend.getContext('2d');pen.fillStyle='#151c23';pen.fillRect(0,0,256,64);
      pen.strokeStyle=`#${config.color.toString(16).padStart(6,'0')}`;
      pen.strokeRect(1,1,254,62);pen.font='bold 29px system-ui';
      pen.fillStyle='#fff';pen.fillText(config.short,13,42);
      const label=new THREE.Sprite(new THREE.SpriteMaterial({
        map:new THREE.CanvasTexture(legend),depthTest:false,depthWrite:false,transparent:true}));
      label.position.set(config.volume.x*0.7,config.volume.y*0.8,0);label.scale.set(0.85,0.22,1);
      group.add(label);group.visible=false;
      group.traverse(obj=>{obj.renderOrder=110;});
      world.add(group);previewBeacons.set(config.kind,group);
    }
    const refreshSources=()=>{
      if (!sourcePanel) return;
      const map=sourcePanel.querySelector('[data-role="source-plot"]');
      const list=sourcePanel.querySelector('[data-role="source-list"]');
      sourcePanel.querySelector('[data-role="source-profile"]').textContent=
        spatial.selection.calibration ? `${spatial.mode === 'inside' ? 'Inside map' : 'Behind wall'} · SM00` : 'CRT only';
      sourcePanel.querySelector('[data-action="source-tour"]').disabled=!previewSources.length;
      for (const [kind,group] of previewBeacons) {
        const item=previewSources.find(source=>source.kind===kind);
        group.visible=!!item;
        if (item) group.position.set(item.room.x,item.room.y,item.room.z);
      }
      map.replaceChildren();list.replaceChildren();
      if (!previewSources.length) {
        map.textContent='No external sources in this profile';
        cueStatus.textContent='CRT only: select an SM00 spatial profile to see and hear room origins.';
        return;
      }
      const schematic=sideElevation(previewSources);
      const crt=document.createElement('span');crt.className='rdr-room-source-crt';
      crt.textContent='CRT';crt.style.left=`${schematic.crt.left}%`;
      crt.style.top=`${schematic.crt.top}%`;map.append(crt);
      for (const item of schematic.sources) {
        const dot=document.createElement('span');dot.className='rdr-room-source-volume';
        dot.dataset.kind=item.kind;dot.style.left=`${item.plot.left}%`;
        dot.style.top=`${item.plot.top}%`;
        dot.style.width=`${item.plot.width}px`;
        dot.style.height=`${item.plot.height}px`;
        dot.title=`${item.name}: x ${item.room.x.toFixed(2)}, y ${item.room.y.toFixed(2)}, z ${item.room.z.toFixed(2)} m · box ${item.volume.x.toFixed(2)}×${item.volume.y.toFixed(2)}×${item.volume.z.toFixed(2)} m`;
        map.append(dot);
        const row=document.createElement('button');row.type='button';
        row.dataset.action='source-cue';row.dataset.kind=item.kind;
        row.innerHTML=`<span class="rdr-room-source-key" data-kind="${item.kind}"></span><span></span><small></small>`;
        row.querySelector('span:nth-child(2)').textContent=item.name;
        row.querySelector('small').textContent=`x ${item.room.x.toFixed(1)} · y ${item.room.y.toFixed(1)} · z ${item.room.z.toFixed(1)} m · ${item.volume.x.toFixed(1)}×${item.volume.y.toFixed(1)}×${item.volume.z.toFixed(1)} m box`;
        list.append(row);
      }
    };
    const resetSources=()=>{
      previewSources=projectReferenceSources(spatial.projector);
      refreshSources();
    };
    const updateSpatialLabel=()=>{
      const d=spatial.diagnostics();
      const name=SPATIAL_MODES.find(m=>m.id===d.id.split(':').at(-1))?.label || 'CRT only';
      status={...status,spatial:`${name} · SM${d.submap.toString(16).toUpperCase().padStart(2,'0')}`};
      spatialStatus.textContent=`${d.id} · MD${d.mapId ?? '—'} · ${d.coordinateSpace} · ${d.calibration ?
        `${d.calibration.transmission} ${d.calibration.gain} gain / ${d.calibration.lowpassHz} Hz` : 'unmapped: TV only'}`;
      updatePanel(status,panelExpanded);
    };
    spatial=new RoomSpatialController({audio:audioInRoom,lampBridge:eventBridge,
      onEvent:observation=>{
        if (sourcePanel) {
          previewSources=replaceObservedSource(previewSources,observation,cueOrigin);
          refreshSources();
          const item=previewSources.find(source=>source.kind===observation.kind);
          if (item) {
            previewBeacons.get(item.kind).userData.pulseAt=performance.now();
            cueStatus.textContent=`${cueOrigin === 'trace' ? 'RECORDED TRACE' : 'LIVE NATIVE'} · ${item.name} · RDX (${item.rdx.x}, ${item.rdx.y}) → (${item.room.x.toFixed(2)}, ${item.room.y.toFixed(2)}, ${item.room.z.toFixed(2)}) m`;
          }
        }
        if (!debug) return;
        sourceDebugText=`${observation.kind} mark ${observation.source?.mark ?? '—'} RDX (${observation.rdx.x},${observation.rdx.y}) → room (${Object.values(observation.room).map(v=>v.toFixed(2)).join(', ')})`;
        if (sourceMarkers.length) {
          const marker=sourceMarkers.shift();
          marker.userData.rdx=observation.rdx;
          marker.position.set(observation.room.x,observation.room.y,observation.room.z);
          marker.visible=true;sourceMarkers.push(marker);
        }
        spatialStatus.textContent=sourceDebugText;
      }});
    spatial.setLocation(activeSubmap());updateSpatialLabel();resetSources();
    if (debug) {
      const markerGeometry=new THREE.SphereGeometry(0.07,8,6);
      const markerMaterial=new THREE.MeshBasicMaterial({color:0x66e4d3,depthTest:false});
      for (let i=0;i<8;i++) { const marker=new THREE.Mesh(markerGeometry,markerMaterial);
        marker.visible=false;world.add(marker);sourceMarkers.push(marker); }
      // Debug-only projected room outline and native evidence reference source.
      debugOutline=new THREE.LineLoop(new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({color:0x83e3cc,depthTest:false}));
      debugTopEdge=new THREE.Line(new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({color:0xffc785,depthTest:false}));
      debugEnemy=new THREE.Mesh(markerGeometry,
        new THREE.MeshBasicMaterial({color:0xee5c68,depthTest:false}));
      for (const mesh of [debugOutline,debugTopEdge,debugEnemy]) {
        mesh.renderOrder=100;world.add(mesh);
      }
      const replayButton=document.createElement('button');
      replayButton.type='button';replayButton.dataset.action='replay';
      replayButton.textContent='Replay traced SM00 cues (debug)';
      overlay.append(replayButton);
    }
    const updateDebugProjection=()=>{
      if (!debug) return;
      const projector=spatial.projector;
      const points=[{x:160,y:224},{x:256,y:224},{x:256,y:296},{x:160,y:296}]
        .map(p=>projector.project(p));
      const present=points.every(Boolean);
      for (const obj of [debugOutline,debugTopEdge,debugEnemy]) obj.visible=present;
      if (present) {
        const vertex=({x,y,z})=>new THREE.Vector3(x,y,z);
        debugOutline.geometry.dispose();
        debugOutline.geometry=new THREE.BufferGeometry().setFromPoints(points.map(vertex));
        debugTopEdge.geometry.dispose();
        debugTopEdge.geometry=new THREE.BufferGeometry().setFromPoints(points.slice(0,2).map(vertex));
        // Source is not estimated from sprite art: see SM00 native fixture.
        const enemy=projector.project({x:52,y:373});
        debugEnemy.position.set(enemy.x,enemy.y,enemy.z);
      }
      for (const marker of sourceMarkers) {
        const point=projector.project(marker.userData.rdx);
        marker.visible=!!point;
        if (point) marker.position.set(point.x,point.y,point.z);
      }
    };
    updateDebugProjection();
    const switchSpatial=mode=>{
      cancelReplay();
      if (spatial.setLocation(activeSubmap(),mode)) {audio.clear();updateSpatialLabel();}
      updateDebugProjection();resetSources();
      overlay.querySelector('[data-action="spatial"]').value=mode;
    };
    const cycleSpatial=()=>{
      const index=SPATIAL_MODES.findIndex(m=>m.id===spatial.mode);
      switchSpatial(SPATIAL_MODES[(index+1)%SPATIAL_MODES.length].id);
      void audio.unlock();
    };
    const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 40);
    const desktopEyeHeight = 1.4;
    if (!immersive && !fixedTv) crt.position.y = desktopEyeHeight; // XR uses tracked eye height on first pose.
    const center = new THREE.Vector3(0, desktopEyeHeight, -1.6);
    if (fixedTv) { screen.updateWorldMatrix(true, false); screen.getWorldPosition(center); }
    const updateDesktopCamera = () => {
      const radial = 1.4 + distance;
      camera.position.set(center.x + Math.sin(yaw) * radial * Math.cos(pitch),
        center.y + Math.sin(pitch) * radial, center.z + Math.cos(yaw) * radial * Math.cos(pitch));
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
      audio.clear(); // prevent an old world-space voice from lingering across recenter
      world.position.set(anchor.x, 0, anchor.z);
      world.rotation.y = anchor.yaw;
      if (initialCrtHeight === null) initialCrtHeight = anchor.crtHeight;
      if (!fixedTv) crt.position.y = initialCrtHeight; // the living room's TV stands on its cabinet
      floorInfo.diagnostics = floorSpaceDiagnostics(floorInfo.type, head, anchor);
      // The virtual floor is the reference space's Y=0, i.e. the floor Quest reports.
      status = {...status,floorLabel:`EYE ${head.y.toFixed(2)} M ABOVE ${floorInfo.type.toUpperCase()}`};
      updatePanel(status,panelExpanded);
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
    const playTrace=items=>{
      cancelReplay();
      const token=replayToken;
      if (spatial.submap !== 0 || !spatial.selection.calibration) {
        if (cueStatus) cueStatus.textContent='Select an SM00 spatial profile first.';
        return;
      }
      // An explicit desktop click auditions recorded native evidence, not live
      // gameplay; do not inject these messages into the native event ring.
      void audio.unlock().then(ok=>{
        if (ending || token!==replayToken) return;
        if (!ok && cueStatus) cueStatus.textContent='Visual preview only: room audio is unavailable.';
        for (const item of items) {
          replayTimers.push(setTimeout(()=>{
            if (ending || token!==replayToken || spatial.submap !== 0 || !spatial.selection.calibration) return;
            cueOrigin='trace';
            try {spatial.receive(replaySpatialMessage(item,++replaySerial));}
            finally {cueOrigin='live';}
          },item.atMs-items[0].atMs));
        }
      });
    };
    sourcePanel?.addEventListener('click',event=>{
      const button=event.target?.closest('button[data-action]');
      if (!button) return;
      if (button.dataset.action==='source-tour') playTrace(SM00_SPATIAL_REPLAY);
      if (button.dataset.action==='source-cue') {
        const name={'player.footstep':'footstep','world.boulder.impact':'impact','enemy.died':'death'};
        const item=SM00_SPATIAL_REPLAY.find(item=>name[item.kind]===button.dataset.kind);
        if (item) playTrace([item]);
      }
    },{signal:abort.signal});
    overlay.addEventListener('click', event => {
      const action = event.target?.dataset?.action;
      if (action === 'exit') void stop();
      if (action === 'replay' && debug) {
        cancelReplay();
        if (spatial.submap !== 0 || !spatial.selection.calibration) {
          spatialStatus.textContent='SM00 spatial profile required for debug replay';
        } else {
          void audio.unlock().then(()=>{
            if (ending) return;
            // Deliberate development replay: never send synthetic input to C.
            SM00_SPATIAL_REPLAY.forEach((item,index)=>{
              replayTimers.push(setTimeout(()=>{
                if (!ending && spatial.submap === 0 && spatial.selection.calibration)
                  spatial.receive(replaySpatialMessage(item,index+1));
              },item.atMs));
            });
            spatialStatus.textContent='DEBUG REPLAY — not live native gameplay';
          });
        }
      }
      if (action === 'lights') toggleLights();
      if (action === 'time') cycleTime();
      if (action === 'tidy') tidyRoom();
      if (action === 'audio') void audio.unlock().then(ok=>{event.target.textContent=ok?'Room audio enabled':'TV audio only';});
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
    overlay.addEventListener('change',event=>{
      if (event.target?.dataset?.action==='spatial') switchSpatial(event.target.value);
    },{signal:abort.signal});
    overlay.addEventListener('input',event=>{
      if (event.target?.dataset?.action==='effects') audio.setLevel(Number(event.target.value)/100);
    },{signal:abort.signal});
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
      // Quest resets the space after a system recenter or a new floor/boundary
      // setup; re-anchor on the next pose so the room follows the updated floor.
      floorInfo.space.addEventListener?.('reset',() => {anchored=false;},{signal:abort.signal});
      xrSession.addEventListener('end',stop,{signal:abort.signal});
      xrSession.addEventListener('visibilitychange',() => {
        if (xrSession.visibilityState !== 'visible') {
          adapter?.suspend();audio.clear();
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
        onHelp:cycleSpatial,
        onLights:toggleLights,
        onTimeOfDay:cycleTime,
        onTidy:tidyRoom
      });
    }
    window.addEventListener('pagehide',() => {void stop();},{signal:abort.signal});
    if (!presentation.enter({ immersive })) throw new Error('The game canvas is already owned by another room.');
    ownsPresentation = true; // the page canvas RAF is now exclusively ours
    unsubscribe = gameSession.events.subscribe(message => spatial.receive(message));
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
    const listenerPosition=new THREE.Vector3(),listenerForward=new THREE.Vector3();
    let lastReactionAt=null;
    renderer.setAnimationLoop((_time,frame) => {
      if (ending) return;
      // ROOM is paused, so native pre-actor polling is stopped. Only room UI
      // buttons are sampled in XR RAF; gameplay is still exclusively native-boundary.
      if (immersive && adapter?.mode === 'room') adapter.sample();
      if (immersive && !anchored && frame) {
        const pose = frame.getViewerPose(renderer.xr.getReferenceSpace());
        if (pose) recenter(pose);
      }
      const presentationStart = performance.now();
      const revision = presentation.present();
      const presentationMs = performance.now() - presentationStart;
      if (revision !== lastRevision) {texture.needsUpdate=true;lastRevision=revision;uploadCount++;}
      if (activeSubmap() !== spatial.submap) {
        cancelReplay();spatial.setLocation(activeSubmap());updateSpatialLabel();
        updateDebugProjection();resetSources();
      }
      gameSession.events.poll(64);
      // The room's pendulum has wall-clock physics even when native GAME is paused.
      pivot.rotation.z = lamp.step(performance.now()/1000);
      hud.tick(performance.now());
      const now = performance.now();
      const dt = lastReactionAt === null ? 0 : (now - lastReactionAt) / 1000;
      reactions.step(dt);
      physics?.step(dt);
      lighting?.update(renderer,texture,gameRect,dt);
      updateTube?.(now/1000);
      lastReactionAt = now;
      if (audio.context?.state === 'running') {
        const tracked=immersive ? renderer.xr.getCamera(camera) : camera;
        tracked.updateMatrixWorld();
        tracked.getWorldPosition(listenerPosition);
        tracked.getWorldDirection(listenerForward);
        audio.setListener(listenerPosition,listenerForward);
      }
      if (sourcePanel) {
        const now=performance.now();
        for (const group of previewBeacons.values()) {
          const age=now-(group.userData.pulseAt ?? -Infinity);
          group.scale.setScalar(age>=0 && age<550 ? 1+0.75*(1-age/550) : 1);
        }
      }
      const renderStart = performance.now();
      renderer.render(scene,camera);
      const renderCpuMs = performance.now() - renderStart;
      const report = timing.record(performance.now(), presentationMs, renderCpuMs,
        debug ? presentation.frameSerial : null, debug ? revision : null);
      if (report && debug) {
        const performanceLabel = `XR ${report.fps.toFixed(1)} / GAME ${report.nativeFps.toFixed(1)} / TV ${report.canvasFps.toFixed(1)} FPS / C ${report.presentationMs.toFixed(1)}ms / GL CPU ${report.renderCpuMs.toFixed(1)}ms`;
        status = {...status,performanceLabel};
        updatePanel(status,panelExpanded);
        onStatus(`${performanceLabel} · XR scale ${xrSettings?.scale ?? 'desktop'}`);
      }
      if (gameSession.inputRouter?.trace) {
        if (revision !== lastMeasuredUploadRevision) {
          gameSession.inputRouter.noteTextureSubmission(revision,presentation.frameSerial);
          lastMeasuredUploadRevision=revision;
        }
        if (immersive) gameSession.inputRouter.noteXRSubmission(revision);
      }
      frameCount++;
      if (startAt === null) startAt=performance.now();
      // FPS/CPU timings are reported by wall clock, including when only one XR
      // frame is delivered each second; a 120-frame diagnostic can take minutes.
    });
    return {end:stop,getStats:() => ({mode:gameSession.mode,frames:frameCount,uploads:uploadCount,
      referenceSpace:floorInfo?.type || 'desktop',floorDiagnostics:floorInfo?.diagnostics || null,
      spatial:spatial.diagnostics(),roomEffectsLevel:audio.level,
      xrSettings,frameTimings:timing.latest})};
  } catch(error) { await stop(); throw error; }
}
