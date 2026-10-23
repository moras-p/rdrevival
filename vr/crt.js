import * as THREE from './vendor/three.module.js';

/** The picture tube: the game drawn as a 15 kHz CRT on the curved faceplate.
 * The tube's bulge is geometry (tools/vr-room/build_room.py maps UV 0..1 across the
 * raster as the beam lands on the glass), so the shader only does what the beam,
 * the phosphors and the glass do:
 *  - each source line is a Gaussian beam that widens on bright pixels,
 *  - an aperture-grille phosphor mask,
 *  - halation in the faceplate glass and slight convergence error toward the edges,
 *  - raster edge falloff, and the glass reflecting the room (Fresnel, lamp highlight).
 * Line and mask detail is filtered by screen-space derivatives so they fade out
 * smoothly instead of shimmering when a headset pixel covers several lines or triads. */
const RASTER_TRIADS = 590; // 0.68 mm dot pitch across the 19" tube's 400 mm raster

export function createCrtMaterial(texture, {gameRect = [0, 0, 1, 1], sourceSize = [320, 200], triads = RASTER_TRIADS} = {}) {
  return new THREE.ShaderMaterial({
    name: 'CRT',
    uniforms: {
      map: {value: texture},
      sourceSize: {value: new THREE.Vector2(...sourceSize)},
      gameRect: {value: new THREE.Vector4(...gameRect)},
      triads: {value: triads},
      time: {value: 0},
      glassAmbient: {value: new THREE.Color(0.02, 0.02, 0.02)},
      lampPosition: {value: new THREE.Vector3(0, 2.4, 0)},
      lampColor: {value: new THREE.Color(1.0, 0.85, 0.65)}
    },
    vertexShader: `varying vec2 vUv; varying vec3 vWorld; varying vec3 vNormal;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `uniform sampler2D map; uniform vec2 sourceSize; uniform vec4 gameRect; uniform float triads, time;
      uniform vec3 glassAmbient, lampPosition, lampColor;
      varying vec2 vUv; varying vec3 vWorld; varying vec3 vNormal;

      // One source row, sharpened horizontally (pixels hold their colour, edges stay soft).
      vec3 row(float line, float x, float offset) {
        float px = x * sourceSize.x + offset;
        float f = fract(px) - 0.5;
        px = floor(px) + 0.5 + clamp(f * 2.2, -0.5, 0.5);
        return textureLod(map, vec2(px / sourceSize.x, (line + 0.5) / sourceSize.y), 0.0).rgb;
      }

      // Gaussian beam of a source line at distance d (in lines), widened by the pixel footprint.
      vec3 beam(vec3 c, float d, float footprint) {
        vec3 sigma = mix(vec3(0.22), vec3(0.36), sqrt(c));       // bright lines bloom wider
        vec3 s = sqrt(sigma * sigma + footprint * footprint);
        return c * exp(-0.5 * d * d / (s * s)) * (sigma / s) * 1.12;
      }

      void main() {
        vec2 raster = vUv;                                      // 0..1 across the raster
        vec2 g = (raster - gameRect.xy) / gameRect.zw;          // 0..1 across the game picture
        vec2 c = raster * 2.0 - 1.0;
        vec3 color = vec3(0.0);
        if (all(greaterThan(g, vec2(-0.002))) && all(lessThan(g, vec2(1.002)))) {
          float y = g.y * sourceSize.y - 0.5;
          float footprint = clamp(fwidth(y) * 0.5, 0.0, 1.5);    // lines per headset pixel
          float l0 = floor(y), d = y - l0;
          float conv = c.x * 0.35;                              // convergence error grows to the edges (source pixels)
          vec3 a0 = vec3(row(l0, g.x, conv).r, row(l0, g.x, 0.0).g, row(l0, g.x, -conv).b);
          vec3 a1 = vec3(row(l0 + 1.0, g.x, conv).r, row(l0 + 1.0, g.x, 0.0).g, row(l0 + 1.0, g.x, -conv).b);
          color = beam(a0, d, footprint) + beam(a1, 1.0 - d, footprint);
          // Halation: light scattered inside the faceplate glass around bright areas.
          vec3 halo = textureLod(map, g, 3.0).rgb * 0.6 + textureLod(map, g, 5.0).rgb * 0.4;
          color += halo * 0.06;
          // Aperture grille: R, G, B stripes, faded out once they get smaller than a headset pixel.
          float stripe = raster.x * triads * 3.0;
          float maskVisible = 1.0 - smoothstep(0.35, 0.7, fwidth(stripe));
          vec3 mask = 0.5 + 0.5 * cos(6.2831853 * (stripe / 3.0 - vec3(0.0, 1.0, 2.0) / 3.0));
          color *= mix(vec3(1.0), 0.45 + mask * 1.1, 0.55 * maskVisible);
        }
        // The raster dims toward its edges and corners, where the beam lands at an angle.
        vec2 edge = smoothstep(vec2(1.0), vec2(0.9), abs(c));
        color *= edge.x * edge.y * (1.0 - 0.18 * dot(c, c));
        // Faceplate: grey-green glass that is never black, reflecting the room it sits in.
        vec3 view = normalize(cameraPosition - vWorld);
        vec3 n = normalize(vNormal);
        float fresnel = 0.04 + 0.96 * pow(1.0 - clamp(dot(view, n), 0.0, 1.0), 5.0);
        vec3 toLamp = normalize(lampPosition - vWorld);
        float highlight = pow(max(dot(reflect(-view, n), toLamp), 0.0), 900.0) * 2.5 +
          pow(max(dot(reflect(-view, n), toLamp), 0.0), 40.0) * 0.04;
        vec3 glass = vec3(0.004, 0.005, 0.0045) + glassAmbient * (0.12 + 1.6 * fresnel) + lampColor * highlight;
        float grain = fract(sin(dot(gl_FragCoord.xy + fract(time) * 91.7, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
        gl_FragColor = vec4(color * (1.0 + grain * 0.03) + glass, 1.0);
        #include <colorspace_fragment>
      }`,
    toneMapped: false
  });
}

/** Magnavox RR1933 faceplate, in the TVScreen node's frame (apex at the origin, +Z out of the tube). */
export const FACEPLATE = Object.freeze({width: 0.415, height: 0.31, radius: 0.6, raster: [0.4, 0.3], deflection: 0.55, forward: 0});

/** The curved glass: a spherical cap whose edges curve back into the bezel's tube wall.
 * UV 0..1 is the raster, placed where the beam lands: a glass point that curves back
 * toward the yoke by s gets the deflection tan = d / (deflection - s), so the edges and
 * corners show the picture pulled in. That is a tube's bulge, built from geometry, so it
 * changes properly with the viewing angle. build_room.py makes the same mesh for the bake. */
export function faceplateGeometry(options = {}) {
  const {width, height, radius, raster, deflection, forward} = {...FACEPLATE, ...options};
  const nx = 64, ny = 48;
  const position = [], normal = [], uv = [], index = [];
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = (i / nx - 0.5) * width, y = (j / ny - 0.5) * height;
      const sag = radius - Math.sqrt(radius * radius - x * x - y * y);
      const k = deflection / (deflection - sag);
      position.push(x, y, forward - sag);
      normal.push(x / radius, y / radius, (radius - sag) / radius);
      uv.push(0.5 + x * k / raster[0], 0.5 + y * k / raster[1]);
    }
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 2, d = a + nx + 1;
      index.push(a, b, c, a, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  return geometry;
}

/** The game canvas as a texture: mipmapped for the halation lookups. */
export function crtTexture(sourceCanvas) {
  const texture = new THREE.CanvasTexture(sourceCanvas);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Per frame: the room light the glass reflects, and the ceiling lamp's highlight. */
export function updateCrt(material, {time = 0, lampLevel = 1, ambient = null, lampPosition = null} = {}) {
  const u = material.uniforms;
  u.time.value = time;
  u.lampColor.value.setRGB(1.0, 0.85, 0.65).multiplyScalar(lampLevel);
  if (ambient) u.glassAmbient.value.copy(ambient);
  if (lampPosition) u.lampPosition.value.copy(lampPosition);
}
