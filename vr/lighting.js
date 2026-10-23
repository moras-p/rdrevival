import * as THREE from './vendor/three.module.js';

/** Live mix of the room's three baked light groups (see tools/vr-room/build_room.py):
 * the room lamps (colour lightmap), and the window and the CRT (grey, packed as the
 * R and G channels of a second map). Switching the lamps, changing the time of day
 * and the TV picture all re-light the room without any real-time lights. */
export const TIMES_OF_DAY = Object.freeze(['evening', 'night', 'day']);
const WINDOW = {
  day: {light: [1.0, 0.96, 0.9], level: 3.2, sky: [0.75, 0.85, 1.0]},
  evening: {light: [0.55, 0.65, 1.0], level: 1.0, sky: [0.12, 0.17, 0.35]},
  night: {light: [0.3, 0.4, 0.75], level: 0.05, sky: [0.008, 0.012, 0.03]}
};
const LAMP_GLOW = /^(BowlGlass|LampShade|Halogen)/;
const SKY = /^EveningSky/;
// The baked CRT light is a dim 6 W panel and the picture averages dark; ?vr-tv-gain= overrides.
const TV_GAIN = Number(globalThis.location?.search.match(/vr-tv-gain=([\d.]+)/)?.[1]) || 30;
const FADE = 7; // 1/s; a bulb takes ~150 ms to come up

export class RoomLighting {
  constructor({ambientMap, lampScale = 1, windowScale = 1, tvScale = 1}) {
    this.scales = {lamps: lampScale, window: windowScale, tv: tvScale};
    this.lightsOn = true;
    this.time = 'evening';
    this.lampLevel = 1;
    this.windowColor = new THREE.Color();
    this.targetWindow = new THREE.Color();
    this.glow = [];
    this.uniforms = {
      roomAmbientMap: {value: ambientMap},
      roomTvMap: {value: null},
      roomLamps: {value: lampScale},
      roomWindow: {value: new THREE.Color()},
      roomTv: {value: tvScale * TV_GAIN}
    };
    // The TV's light colour is the picture averaged on the GPU into a 1x1 target,
    // blended over time (phosphor persistence) and read by every room material.
    this.tvTarget = new THREE.WebGLRenderTarget(1, 1, {depthBuffer: false, generateMipmaps: false});
    this.uniforms.roomTvMap.value = this.tvTarget.texture;
    this.tvMaterial = new THREE.ShaderMaterial({
      uniforms: {picture: {value: null}, rect: {value: new THREE.Vector4(0, 0, 1, 1)}},
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform sampler2D picture; uniform vec4 rect;
        void main() {
          vec3 sum = vec3(0.0);
          for (int y = 0; y < 6; y++) for (int x = 0; x < 8; x++)
            sum += texture2D(picture, rect.xy + rect.zw * vec2((float(x) + 0.5) / 8.0, (float(y) + 0.5) / 6.0)).rgb;
          gl_FragColor = vec4(sum / 48.0, 0.18);
        }`,
      transparent: true, depthTest: false, depthWrite: false
    });
    this.tvScene = new THREE.Scene();
    this.tvScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.tvMaterial));
    this.tvCamera = new THREE.Camera();
    this.setTimeOfDay(this.time, true);
  }

  /** Make a lightmapped MeshBasicMaterial use the live light mix. */
  patch(material) {
    material.lightMapIntensity = Math.PI; // the bake scales live in the uniforms
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.fragmentShader = 'uniform sampler2D roomAmbientMap, roomTvMap;\nuniform float roomLamps, roomTv;\nuniform vec3 roomWindow;\n' +
        shader.fragmentShader.replace(
          'reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;',
          `vec2 roomAmbient = texture2D( roomAmbientMap, vLightMapUv ).rg;
          vec3 roomTvColor = texture2D( roomTvMap, vec2( 0.5 ) ).rgb;
          reflectedLight.indirectDiffuse += ( lightMapTexel.rgb * roomLamps + roomAmbient.r * roomWindow +
            roomAmbient.g * roomTv * roomTvColor ) * lightMapIntensity * RECIPROCAL_PI;`);
    };
    material.customProgramCacheKey = () => 'room-lighting';
    material.needsUpdate = true;
  }

  /** Lamp glass and the sky outside are unlit glow; follow the switch and the time. */
  register(material) {
    if (LAMP_GLOW.test(material.name)) this.glow.push({material, kind: 'lamp', color: material.color.clone()});
    else if (SKY.test(material.name)) this.glow.push({material, kind: 'sky', color: material.color.clone()});
  }

  toggleLights() { this.lightsOn = !this.lightsOn; return this.lightsOn; }
  cycleTimeOfDay() {
    return this.setTimeOfDay(TIMES_OF_DAY[(TIMES_OF_DAY.indexOf(this.time) + 1) % TIMES_OF_DAY.length]);
  }
  setTimeOfDay(time, immediate = false) {
    this.time = time;
    const w = WINDOW[time];
    this.targetWindow.setRGB(...w.light).multiplyScalar(w.level * this.scales.window);
    if (immediate) this.windowColor.copy(this.targetWindow);
    return time;
  }

  /** Per frame, before the room renders: fades, and the TV colour pass. */
  update(renderer, picture, gameRect, dt) {
    const k = 1 - Math.exp(-FADE * Math.min(Math.max(dt, 0), 0.1));
    this.lampLevel += ((this.lightsOn ? 1 : 0) - this.lampLevel) * k;
    this.windowColor.lerp(this.targetWindow, k * 0.5);
    this.uniforms.roomLamps.value = this.lampLevel * this.scales.lamps;
    this.uniforms.roomWindow.value.copy(this.windowColor);
    const sky = WINDOW[this.time].sky;
    for (const g of this.glow) {
      if (g.kind === 'lamp') g.material.color.copy(g.color).multiplyScalar(0.05 + 0.95 * this.lampLevel);
      else g.material.color.lerp(new THREE.Color(...sky), k * 0.5);
    }
    if (!picture) return;
    this.tvMaterial.uniforms.picture.value = picture;
    this.tvMaterial.uniforms.rect.value.set(...gameRect);
    const xr = renderer.xr.enabled, target = renderer.getRenderTarget(), autoClear = renderer.autoClear;
    renderer.xr.enabled = false;
    renderer.autoClear = false; // blend into last frame's colour: a short phosphor-like lag
    renderer.setRenderTarget(this.tvTarget);
    renderer.render(this.tvScene, this.tvCamera);
    renderer.setRenderTarget(target);
    renderer.autoClear = autoClear;
    renderer.xr.enabled = xr;
  }

  dispose() { this.tvTarget.dispose(); this.tvMaterial.dispose(); }
}
