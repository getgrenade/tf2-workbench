import * as THREE from "three";
import { loadMap, loadMapMaterial, loadMapModel } from "../api";
import { SOURCE_TO_VIEWER } from "./animator";
import { parsePayload, type ModelData } from "./payload";
import { loadSkyTexture } from "./skybox";

/**
 * A map of the game in the scene, drawn the way the game's world shaders draw it:
 * - brushes and displacements: LightmappedGeneric / WorldVertexTransition, lit by the map's lightmaps, with the three bump-basis
 *   lightmaps where a face has a normal map (or self-shadowed bump), the blend of a displacement's two textures, and the reflection of
 *   the map's nearest cubemap under the env mask;
 * - props: lit by the ambient cube of where they stand with the map's lights that reach them folded in (the game's model lighting);
 * - its 3D skybox and its tool, trigger and sky faces are left out; its 2D sky is the scene's sky.
 * It is placed so that a RED spawn point is where the characters stand, and the characters' ground shadows fall on its floors.
 */

/** The biggest side of a map texture (they are many; the view rarely comes close to a wall). */
const TEXTURE_SIZE = 1024;
/** The side of a cell of the grid of solid triangles (map units). */
const CELL = 128;
/** How many materials and models load at once. */
const PARALLEL = 6;
/**
 * The exposure, as the game's auto exposure sets it: the scale that brings the picture's average to a middle grey (a typical surface,
 * 0.35 of the light, under the map's average light), within the limits the map's tonemap controller gives (the game's own when it
 * gives none), times a scale that brings that to the brightness the game shows (matched on itemtest).
 */
const EXPOSURE_TARGET = 0.18;
const TYPICAL_ALBEDO = 0.35;
const DEFAULT_EXPOSURE: [number, number] = [0.5, 2];
const EXPOSURE_SCALE = 3;
/** The material name of the sky's faces and the start of an overlay's (see bsp.rs). */
const SKY_MATERIAL = "__sky__";
const OVERLAY_PREFIX = "overlay:";

export interface MapSpawn {
  origin: [number, number, number];
  yaw: number;
  team: number;
}

type V3 = [number, number, number];

interface MapJson {
  name: string;
  meshes: { material: string; vertexCount: number; indexCount: number; pos: number; normal: number; uv: number; lightmap: number; blend: number; tangentS: number; tangentT: number; index: number }[];
  props: { model: string; origin: V3; angles: V3; skin: number; scale: number; ambient: V3[]; sunlit: boolean }[];
  spawns: MapSpawn[];
  lightmap: { width: number; height: number; pages: number; offset: number; range: number; average: number };
  sun: { dir: V3; color: V3 } | null;
  exposureMin: number | null;
  exposureMax: number | null;
  sky: string | null;
  bounds: [number, number, number, number, number, number];
}

interface MaterialJson {
  shader: string;
  params: Record<string, string>;
  textures: { slot: string; width: number; height: number; offset: number }[];
}

/** A ground shadow of the characters, as the map's floors receive it. */
export interface WorldShadow {
  texture: THREE.Texture;
  /** Middle of its square (x, z), half its side, its strength, the floor it was made for. */
  centerX: number;
  centerZ: number;
  half: number;
  opacity: number;
  floorY: number;
}

function split(buf: ArrayBuffer) {
  const len = new DataView(buf).getUint32(0, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, len)));
  return { json, blob: (4 + len + 3) & ~3 };
}

const vertexShader = /* glsl */ `
  #ifdef PROP
    attribute vec3 amb0; attribute vec3 amb1; attribute vec3 amb2; attribute vec3 amb3; attribute vec3 amb4; attribute vec3 amb5;
    varying vec3 vAmb0; varying vec3 vAmb1; varying vec3 vAmb2; varying vec3 vAmb3; varying vec3 vAmb4; varying vec3 vAmb5;
  #else
    attribute vec2 lightmapUv;
    attribute float blend;
    attribute vec3 tangentS;
    attribute vec3 tangentT;
    varying vec2 vLm;
    varying float vBlend;
    varying vec3 vTs;
    varying vec3 vTt;
  #endif
  uniform mat3 uTexTransform;
  uniform mat3 uTexTransform2;
  uniform mat3 uBumpTransform;
  varying vec2 vUv;
  varying vec2 vUv2;
  varying vec2 vBumpUv;
  // the map's axes (z up), for the ambient cube and the cubemap
  varying vec3 vSrcNormal;
  varying vec3 vSrcPos;
  varying vec3 vWorld;
  varying vec3 vWorldNormal;
  void main() {
    mat4 m = modelMatrix;
    mat3 src = mat3(1.0);
    vec3 srcPos = position;
    #ifdef USE_INSTANCING
      m = modelMatrix * instanceMatrix;
      src = mat3(instanceMatrix);
      srcPos = (instanceMatrix * vec4(position, 1.0)).xyz;
    #endif
    vUv = (uTexTransform * vec3(uv, 1.0)).xy;
    vUv2 = (uTexTransform2 * vec3(uv, 1.0)).xy;
    vBumpUv = (uBumpTransform * vec3(uv, 1.0)).xy;
    vSrcNormal = normalize(src * normal);
    vSrcPos = srcPos;
    #ifdef PROP
      vAmb0 = amb0; vAmb1 = amb1; vAmb2 = amb2; vAmb3 = amb3; vAmb4 = amb4; vAmb5 = amb5;
    #else
      vLm = lightmapUv;
      vBlend = blend;
      vTs = tangentS;
      vTt = tangentT;
    #endif
    vec4 world = m * vec4(position, 1.0);
    vWorld = world.xyz;
    vWorldNormal = normalize(mat3(m) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const fragmentShader = /* glsl */ `
  uniform sampler2D tBase;
  uniform sampler2D tBase2;
  uniform sampler2D tBump;
  uniform sampler2D tBump2;
  uniform sampler2D tEnvMask;
  uniform sampler2D tDetail;
  uniform bool uHasDetail;
  uniform vec2 uDetailScale;
  uniform float uDetailFactor;
  uniform int uDetailMode;
  uniform samplerCube tCube;
  uniform sampler2D tLightmap;
  uniform sampler2D tShadow;
  uniform bool uHasBase;
  uniform bool uHasBase2;
  uniform bool uHasBump;
  uniform bool uHasBump2;
  uniform bool uSsbump;
  uniform bool uHasEnv;
  uniform int uEnvMask;
  uniform vec3 uEnvTint;
  uniform float uFresnel;
  uniform bool uUnlit;
  uniform float uRange;
  uniform float uPages;
  uniform float uExposure;
  uniform float uAlphaTest;
  uniform float uAlpha;
  uniform vec3 uColor;
  uniform vec3 uSrcEye;
  uniform vec4 uShadow;
  uniform float uShadowFloor;
  uniform bool uShadowOn;
  varying vec2 vUv;
  varying vec2 vUv2;
  varying vec2 vBumpUv;
  varying vec3 vSrcNormal;
  varying vec3 vSrcPos;
  varying vec3 vWorld;
  varying vec3 vWorldNormal;
  #ifdef PROP
    varying vec3 vAmb0; varying vec3 vAmb1; varying vec3 vAmb2; varying vec3 vAmb3; varying vec3 vAmb4; varying vec3 vAmb5;
  #else
    varying vec2 vLm;
    varying float vBlend;
    varying vec3 vTs;
    varying vec3 vTt;
  #endif

  vec3 lightmapPage(float page) {
    #ifdef PROP
      return vec3(0.0);
    #else
      vec3 s = texture2D(tLightmap, vec2(vLm.x, (vLm.y + page) / uPages)).rgb;
      return s * s * uRange;
    #endif
  }

  void main() {
    float b = 0.0;
    #ifndef PROP
      b = clamp(vBlend, 0.0, 1.0);
    #endif
    vec4 albedo = uHasBase ? texture2D(tBase, vUv) : vec4(0.6, 0.6, 0.6, 1.0);
    if (uHasBase2) albedo = mix(albedo, texture2D(tBase2, vUv2), b);
    albedo.rgb *= uColor;
    // the detail texture: modulate 2x (mode 0), or added (1)
    if (uHasDetail) {
      vec3 detail = texture2D(tDetail, vUv * uDetailScale).rgb;
      if (uDetailMode == 1) albedo.rgb += detail * uDetailFactor;
      else albedo.rgb *= mix(vec3(1.0), detail * 2.0, uDetailFactor);
    }
    if (uAlphaTest > 0.0 && albedo.a < uAlphaTest) discard;

    // the normal map (tangent space; for a self-shadowed bump, the light of the three basis directions instead)
    vec4 bumpTexel = vec4(0.5, 0.5, 1.0, 1.0);
    if (uHasBump) bumpTexel = texture2D(tBump, vBumpUv);
    if (uHasBump2) bumpTexel = mix(bumpTexel, texture2D(tBump2, vBumpUv), b);
    vec3 tn = uSsbump ? vec3(0.0, 0.0, 1.0) : normalize(bumpTexel.xyz * 2.0 - 1.0);

    vec3 srcN = normalize(vSrcNormal);
    vec3 light;
    if (uUnlit) light = vec3(1.0 / max(uExposure, 1e-4));
    else {
      #ifdef PROP
        vec3 n2 = srcN * srcN;
        light = n2.x * (srcN.x >= 0.0 ? vAmb0 : vAmb1) + n2.y * (srcN.y >= 0.0 ? vAmb2 : vAmb3) + n2.z * (srcN.z >= 0.0 ? vAmb4 : vAmb5);
      #else
        if (vLm.x < 0.0) light = vec3(1.0);
        else if (!uHasBump && !uHasBump2) light = lightmapPage(0.0);
        else {
          // the bump basis (the game's): the light of each of its directions, weighed by how much the normal faces it
          vec3 l1 = lightmapPage(1.0), l2 = lightmapPage(2.0), l3 = lightmapPage(3.0);
          vec3 dp;
          if (uSsbump) dp = bumpTexel.xyz;
          else {
            dp.x = clamp(dot(tn, vec3(0.81649658, 0.0, 0.57735027)), 0.0, 1.0);
            dp.y = clamp(dot(tn, vec3(-0.40824829, 0.70710678, 0.57735027)), 0.0, 1.0);
            dp.z = clamp(dot(tn, vec3(-0.40824829, -0.70710678, 0.57735027)), 0.0, 1.0);
            dp *= dp;
          }
          float sum = dot(dp, vec3(1.0));
          light = sum > 1e-4 ? (dp.x * l1 + dp.y * l2 + dp.z * l3) / (uSsbump ? 1.0 : sum) : lightmapPage(0.0);
        }
      #endif
    }

    // the characters' shadow on the floor under them
    if (uShadowOn && vWorldNormal.y > 0.3) {
      vec2 suv = vec2((vWorld.x - uShadow.x) / (2.0 * uShadow.z) + 0.5, 0.5 - (vWorld.z - uShadow.y) / (2.0 * uShadow.z));
      if (suv.x > 0.0 && suv.x < 1.0 && suv.y > 0.0 && suv.y < 1.0) {
        float near = 1.0 - smoothstep(24.0, 120.0, abs(vWorld.y - uShadowFloor));
        light *= 1.0 - texture2D(tShadow, suv).r * uShadow.w * near;
      }
    }

    vec3 color = albedo.rgb * light;

    // the reflection of the cubemap, under its mask
    if (uHasEnv) {
      vec3 N = srcN;
      #ifndef PROP
        if (uHasBump && !uSsbump) N = normalize(tn.x * normalize(vTs) + tn.y * normalize(vTt) + tn.z * srcN);
      #endif
      vec3 V = normalize(uSrcEye - vSrcPos);
      vec3 R = reflect(-V, N);
      float mask = uEnvMask == 1 ? texture2D(tEnvMask, vUv).r : uEnvMask == 2 ? 1.0 - albedo.a : uEnvMask == 3 ? bumpTexel.a : 1.0;
      float fresnel = mix(1.0, pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0), clamp(uFresnel, 0.0, 1.0));
      color += textureCube(tCube, R).rgb * uEnvTint * mask * fresnel / max(uExposure, 1e-4);
    }

    gl_FragColor = vec4(color * uExposure, albedo.a * uAlpha);
    #include <colorspace_fragment>
  }`;

/** `center .5 .5 scale 2 2 rotate 0 translate 0 0` as a 3x3 uv matrix. */
function textureTransform(value: string | undefined): THREE.Matrix3 {
  const m = new THREE.Matrix3();
  if (!value) return m;
  const at = value.toLowerCase().split(/\s+/);
  const num = (key: string, n: number, fallback: number[]) => {
    const i = at.indexOf(key);
    if (i < 0) return fallback;
    return Array.from({ length: n }, (_, k) => Number(at[i + 1 + k]) || 0);
  };
  const [cx, cy] = num("center", 2, [0.5, 0.5]);
  const [sx, sy] = num("scale", 2, [1, 1]);
  const [r] = num("rotate", 1, [0]);
  const [tx, ty] = num("translate", 2, [0, 0]);
  m.setUvTransform(tx, ty, sx || 1, sy || 1, (r * Math.PI) / 180, cx, cy);
  return m;
}

/** A VMT colour (`[1 .5 .5]`, `{255 128 128}`, `2`). */
function vmtColor(value: string | undefined, fallback: V3): V3 {
  if (!value) return fallback;
  const c = value.replace(/[[\]{}]/g, " ").trim().split(/\s+/).map(Number);
  if (c.length === 1 && Number.isFinite(c[0])) return [c[0], c[0], c[0]];
  if (c.length < 3 || c.some((x) => !Number.isFinite(x))) return fallback;
  return value.includes("{") ? [c[0] / 255, c[1] / 255, c[2] / 255] : [c[0], c[1], c[2]];
}

/** The rotation of a set of game angles (pitch, yaw, roll in degrees), as AngleMatrix makes it. */
function angleMatrix([p, y, r]: V3): THREE.Matrix4 {
  const rad = Math.PI / 180;
  const [sp, cp, sy, cy, sr, cr] = [Math.sin(p * rad), Math.cos(p * rad), Math.sin(y * rad), Math.cos(y * rad), Math.sin(r * rad), Math.cos(r * rad)];
  return new THREE.Matrix4().set(
    cp * cy, sr * sp * cy - cr * sy, cr * sp * cy + sr * sy, 0,
    cp * sy, sr * sp * sy + cr * cy, cr * sp * sy - sr * cy, 0,
    -sp, sr * cp, cr * cp, 0,
    0, 0, 0, 1,
  );
}

/** Runs `work` over `items`, `limit` at a time. */
async function pool<T>(items: T[], limit: number, work: (item: T) => Promise<void>, stopped: () => boolean) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length && !stopped()) await work(items[next++]).catch(() => undefined);
    }),
  );
}

const emptyCube = new THREE.CubeTexture();

export class MapScene {
  /** In the viewer's axes, moved so the spawn point is at the origin. */
  readonly group = new THREE.Group();
  readonly name: string;
  spawns: MapSpawn[] = [];
  sky: string | null = null;
  /** The size of the map (its diagonal, in units). */
  extent = 0;
  /** How much brighter the map's light is drawn (the game's auto exposure: the average light of its lit faces to a middle grey). */
  exposure = 1;
  private lightmap: THREE.DataTexture | null = null;
  private readonly materials = new Map<string, THREE.ShaderMaterial>();
  private readonly textures: THREE.Texture[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private disposed = false;
  private readonly world = new THREE.Group();
  /** Shared by every material: the exposure, the lightmap, the eye, the characters' shadow. */
  private readonly shared = {
    uExposure: { value: 1 },
    uRange: { value: 4 },
    uPages: { value: 4 },
    tLightmap: { value: null as THREE.Texture | null },
    uSrcEye: { value: new THREE.Vector3() },
    tShadow: { value: null as THREE.Texture | null },
    uShadow: { value: new THREE.Vector4(0, 0, 1, 0) },
    uShadowFloor: { value: 0 },
    uShadowOn: { value: false },
  };
  private readonly inverse = new THREE.Matrix4();
  /** The meshes of each material (their draw order follows the material's). */
  private readonly meshesOf = new Map<string, THREE.Object3D[]>();
  /**
   * The sky's faces show the sky, as the game draws its sky brushes: the map's sky picture in the direction looked at (the same picture
   * and turn as the scene's sky, so the two meet).
   */
  private readonly skyMaterial = new THREE.ShaderMaterial({
    uniforms: { tSky: { value: null as THREE.CubeTexture | null }, uHasSky: { value: false } },
    vertexShader: "varying vec3 vWorld; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }",
    fragmentShader: /* glsl */ `
      uniform samplerCube tSky; uniform bool uHasSky; varying vec3 vWorld;
      void main() {
        vec3 d = normalize(vWorld - cameraPosition);
        gl_FragColor = uHasSky ? vec4(textureCube(tSky, vec3(-d.x, d.y, d.z)).rgb, 1.0) : vec4(0.0, 0.0, 0.0, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide,
  });
  constructor(name: string) {
    this.name = name;
    this.group.name = `map:${name}`;
    this.group.matrixAutoUpdate = false;
    this.group.add(this.world);
    this.world.matrixAutoUpdate = false;
  }

  /** Before the map is drawn: where the eye is, in the map's axes (for the reflections). */
  setEye(camera: THREE.Camera) {
    this.shared.uSrcEye.value.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(this.inverse);
  }

  /** A point of the view in the map's own units and axes (z up). */
  toMap(p: THREE.Vector3): THREE.Vector3 {
    return p.clone().applyMatrix4(this.inverse);
  }

  /** A direction of the map's axes in the view's. */
  static toView(v: V3): THREE.Vector3 {
    return new THREE.Vector3(v[1], v[2], v[0]);
  }

  /** The characters' ground shadow, cast on the map's floors (null: none). */
  setShadow(s: WorldShadow | null) {
    const u = this.shared;
    u.uShadowOn.value = !!s;
    if (!s) return;
    u.tShadow.value = s.texture;
    u.uShadow.value.set(s.centerX, s.centerZ, s.half, s.opacity);
    u.uShadowFloor.value = s.floorY;
  }

  /** Loads the map: its geometry first (shown at once, grey), then its textures and props (`progress` says how far). */
  async load(progress: (text: string) => void = () => undefined) {
    progress(`Reading ${this.name}…`);
    const buf = await loadMap(this.name);
    if (this.disposed) return;
    const { json, blob } = split(buf) as { json: MapJson; blob: number };
    this.spawns = json.spawns;
    this.sky = json.sky;
    const b = json.bounds;
    this.extent = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]);
    const lm = json.lightmap;
    const [lo, hi] = [json.exposureMin ?? DEFAULT_EXPOSURE[0], json.exposureMax ?? DEFAULT_EXPOSURE[1]];
    const auto = lm.average > 0 ? EXPOSURE_TARGET / (TYPICAL_ALBEDO * lm.average) : 1;
    this.exposure = EXPOSURE_SCALE * Math.min(Math.max(auto, Math.min(lo, hi)), Math.max(lo, hi));
    this.shared.uExposure.value = this.exposure;
    this.shared.uRange.value = lm.range;
    this.shared.uPages.value = lm.pages;
    // the characters stand at the origin: put a RED spawn point there (else any, else the middle of the map's floor)
    const spawn = json.spawns.find((s) => s.team === 2) ?? json.spawns[0];
    const anchor = spawn ? new THREE.Vector3(...spawn.origin) : new THREE.Vector3((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, b[2]);
    this.group.matrix.copy(SOURCE_TO_VIEWER).multiply(new THREE.Matrix4().makeTranslation(-anchor.x, -anchor.y, -anchor.z));
    this.group.matrixWorldNeedsUpdate = true;
    this.inverse.copy(this.group.matrix).invert();

    const data = new Uint8Array(buf, blob + lm.offset, lm.width * lm.height * lm.pages * 4).slice();
    this.lightmap = new THREE.DataTexture(data, lm.width, lm.height * lm.pages, THREE.RGBAFormat);
    this.lightmap.colorSpace = THREE.NoColorSpace;
    this.lightmap.magFilter = THREE.LinearFilter;
    this.lightmap.minFilter = THREE.LinearFilter;
    this.lightmap.generateMipmaps = false;
    this.lightmap.needsUpdate = true;
    this.shared.tLightmap.value = this.lightmap;

    for (const m of json.meshes) {
      const geo = new THREE.BufferGeometry();
      const f32 = (off: number, count: number) => new Float32Array(buf.slice(blob + off, blob + off + count * 4));
      geo.setAttribute("position", new THREE.BufferAttribute(f32(m.pos, m.vertexCount * 3), 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(f32(m.normal, m.vertexCount * 3), 3));
      geo.setAttribute("uv", new THREE.BufferAttribute(f32(m.uv, m.vertexCount * 2), 2));
      geo.setAttribute("lightmapUv", new THREE.BufferAttribute(f32(m.lightmap, m.vertexCount * 2), 2));
      geo.setAttribute("blend", new THREE.BufferAttribute(f32(m.blend, m.vertexCount), 1));
      geo.setAttribute("tangentS", new THREE.BufferAttribute(f32(m.tangentS, m.vertexCount * 3), 3));
      geo.setAttribute("tangentT", new THREE.BufferAttribute(f32(m.tangentT, m.vertexCount * 3), 3));
      geo.setIndex(new THREE.BufferAttribute(new Uint32Array(buf.slice(blob + m.index, blob + m.index + m.indexCount * 4)), 1));
      geo.computeBoundingSphere();
      this.geometries.push(geo);
      const sky = m.material === SKY_MATERIAL;
      const mesh = new THREE.Mesh(geo, sky ? this.skyMaterial : this.material(m.material, false));
      mesh.name = m.material;
      if (!sky) this.meshesOf.set(`w:${m.material}`, [...(this.meshesOf.get(`w:${m.material}`) ?? []), mesh]);
      if (!sky && !m.material.startsWith(OVERLAY_PREFIX)) this.colliders.push({ geo, matrices: null, key: `w:${m.material}` });
      mesh.matrixAutoUpdate = false;
      this.world.add(mesh);
    }
    this.world.updateMatrixWorld(true);

    this.skyMaterial.userData.noShadow = true;
    if (json.sky) {
      void loadSkyTexture(json.sky).then((cube) => {
        if (this.disposed) { cube.dispose(); return; }
        this.textures.push(cube);
        this.skyMaterial.uniforms.tSky.value = cube;
        this.skyMaterial.uniforms.uHasSky.value = true;
      }).catch(() => undefined);
    }
    // the textures, then the props
    const keys = [...this.materials.keys()];
    let done = 0;
    await pool(keys, PARALLEL, async (key) => {
      await this.fill(key);
      progress(`${this.name}: textures ${++done}/${keys.length}`);
    }, () => this.disposed);
    this.buildColliders();
    await this.loadProps(json.props, progress);
    progress("");
  }

  /** The material of a map (or prop) material name, made grey at first and filled when its textures come. */
  private material(name: string, prop: boolean): THREE.ShaderMaterial {
    const key = `${prop ? "p" : "w"}:${name}`;
    let m = this.materials.get(key);
    if (m) return m;
    m = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      defines: prop ? { PROP: 1 } : {},
      uniforms: {
        ...this.shared,
        tBase: { value: null },
        tBase2: { value: null },
        tBump: { value: null },
        tBump2: { value: null },
        tEnvMask: { value: null },
        tDetail: { value: null },
        uHasDetail: { value: false },
        uDetailScale: { value: new THREE.Vector2(4, 4) },
        uDetailFactor: { value: 1 },
        uDetailMode: { value: 0 },
        tCube: { value: emptyCube },
        uHasBase: { value: false },
        uHasBase2: { value: false },
        uHasBump: { value: false },
        uHasBump2: { value: false },
        uSsbump: { value: false },
        uHasEnv: { value: false },
        uEnvMask: { value: 0 },
        uEnvTint: { value: new THREE.Vector3(1, 1, 1) },
        uFresnel: { value: 0 },
        uUnlit: { value: false },
        uAlphaTest: { value: 0 },
        uAlpha: { value: 1 },
        uColor: { value: new THREE.Color(1, 1, 1) },
        uTexTransform: { value: new THREE.Matrix3() },
        uTexTransform2: { value: new THREE.Matrix3() },
        uBumpTransform: { value: new THREE.Matrix3() },
      },
    });
    // (the map is no character: it casts no ground shadow and no light shadow)
    m.userData.noShadow = true;
    m.userData.mapMaterial = name;
    this.materials.set(key, m);
    return m;
  }

  private dataTexture(buf: ArrayBuffer, offset: number, w: number, h: number, srgb: boolean) {
    const tex = new THREE.DataTexture(new Uint8Array(buf, offset, w * h * 4).slice(), w, h, THREE.RGBAFormat);
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    this.textures.push(tex);
    return tex;
  }

  private async fill(key: string) {
    const m = this.materials.get(key);
    if (!m) return;
    if (key.slice(2) === SKY_MATERIAL) return;
    const overlay = key.slice(2).startsWith(OVERLAY_PREFIX);
    const name = key.slice(2).replace(OVERLAY_PREFIX, "");
    const buf = await loadMapMaterial(name, TEXTURE_SIZE);
    if (this.disposed) return;
    const { json, blob } = split(buf) as { json: MaterialJson; blob: number };
    const p = json.params;
    const flag = (k: string) => Number(p[k] ?? 0) !== 0;
    const u = m.uniforms;
    const faces: THREE.DataTexture[] = [];
    for (const t of json.textures) {
      const env = /^env(\d)$/.exec(t.slot);
      if (env) {
        const tex = new THREE.DataTexture(new Uint8Array(buf, blob + t.offset, t.width * t.height * 4).slice(), t.width, t.height, THREE.RGBAFormat);
        tex.colorSpace = THREE.SRGBColorSpace;
        faces[Number(env[1])] = tex;
        continue;
      }
      const tex = this.dataTexture(buf, blob + t.offset, t.width, t.height, t.slot === "base" || t.slot === "base2");
      if (t.slot === "base") { u.tBase.value = tex; u.uHasBase.value = true; }
      if (t.slot === "base2") { u.tBase2.value = tex; u.uHasBase2.value = true; }
      if (t.slot === "bump") { u.tBump.value = tex; u.uHasBump.value = true; }
      if (t.slot === "bump2") { u.tBump2.value = tex; u.uHasBump2.value = true; }
      if (t.slot === "envmask") { u.tEnvMask.value = tex; u.uEnvMask.value = 1; }
      if (t.slot === "detail") {
        const mode = Number(p["$detailblendmode"] ?? 0);
        if (mode === 0 || mode === 1) {
          u.tDetail.value = tex;
          u.uHasDetail.value = true;
          u.uDetailMode.value = mode;
          const scale = vmtColor(p["$detailscale"], [4, 4, 4]);
          (u.uDetailScale.value as THREE.Vector2).set(scale[0], scale[1]);
          u.uDetailFactor.value = Number(p["$detailblendfactor"] ?? 1);
        }
      }
    }
    if (faces.length === 6 && faces.every(Boolean)) {
      const cube = new THREE.CubeTexture(faces);
      cube.colorSpace = THREE.SRGBColorSpace;
      cube.flipY = false;
      cube.generateMipmaps = true;
      cube.minFilter = THREE.LinearMipmapLinearFilter;
      cube.magFilter = THREE.LinearFilter;
      cube.needsUpdate = true;
      this.textures.push(cube);
      u.tCube.value = cube;
      u.uHasEnv.value = true;
      (u.uEnvTint.value as THREE.Vector3).set(...vmtColor(p["$envmaptint"], [1, 1, 1]));
      if (!u.uEnvMask.value) u.uEnvMask.value = flag("$basealphaenvmapmask") ? 2 : flag("$normalmapalphaenvmapmask") && u.uHasBump.value ? 3 : 0;
      u.uFresnel.value = p["$fresnelreflection"] !== undefined ? 1 - Number(p["$fresnelreflection"]) : 0;
    }
    u.uSsbump.value = flag("$ssbump");
    u.uTexTransform.value = textureTransform(p["$basetexturetransform"]);
    u.uTexTransform2.value = textureTransform(p["$basetexturetransform2"] ?? p["$basetexturetransform"]);
    u.uBumpTransform.value = textureTransform(p["$bumptransform"] ?? p["$basetexturetransform"]);
    (u.uColor.value as THREE.Color).setRGB(...vmtColor(p["$color"] ?? p["$color2"], [1, 1, 1]));
    const shader = json.shader.toLowerCase();
    u.uUnlit.value = shader === "unlitgeneric" || shader === "sprite" || shader === "unlittwotexture";
    if (shader === "water") {
      // water: its fog colour, see-through, with the reflection of its cubemap
      (u.uColor.value as THREE.Color).setRGB(...vmtColor(p["$fogcolor"], [0.35, 0.43, 0.47]));
      u.uHasBase.value = false;
      u.uAlpha.value = 0.75;
      m.transparent = true;
      m.depthWrite = false;
    }
    if (flag("$alphatest")) u.uAlphaTest.value = Number(p["$alphatestreference"] ?? 0.5) || 0.5;
    if (flag("$translucent") || flag("$additive")) {
      m.transparent = true;
      m.depthWrite = false;
      if (flag("$additive")) m.blending = THREE.AdditiveBlending;
    }
    if (p["$alpha"] !== undefined && Number(p["$alpha"]) < 1) {
      u.uAlpha.value = Number(p["$alpha"]);
      m.transparent = true;
    }
    if (flag("$nocull")) m.side = THREE.DoubleSide;
    // the see-through ones are drawn after the solid ones: the water first, then what is over it (rails, glass, decals)
    if (shader === "water") m.userData.renderOrder = 1;
    else if (m.transparent) m.userData.renderOrder = 2;
    if (overlay) {
      // an overlay lies on its surface: drawn over it, blended by its alpha
      m.transparent = true;
      m.depthWrite = false;
      m.polygonOffset = true;
      m.polygonOffsetFactor = -2;
      m.polygonOffsetUnits = -2;
      m.userData.renderOrder = 0.5;
    }
    for (const mesh of this.meshesOf.get(key) ?? []) mesh.renderOrder = m.userData.renderOrder ?? 0;
    m.needsUpdate = true;
  }

  /** The props: each model once, drawn as many times as the map places it, each lit by the light where it stands. */
  private async loadProps(props: MapJson["props"], progress: (text: string) => void) {
    const byModel = new Map<string, MapJson["props"]>();
    for (const p of props) {
      const list = byModel.get(p.model) ?? [];
      list.push(p);
      byModel.set(p.model, list);
    }
    const models = [...byModel.keys()];
    let done = 0;
    await pool(models, PARALLEL, async (path) => {
      let data: ModelData;
      try {
        data = parsePayload(await loadMapModel(path));
      } finally {
        progress(`${this.name}: props ${++done}/${models.length}`);
      }
      if (this.disposed) return;
      const list = byModel.get(path)!;
      const bySkin = new Map<number, MapJson["props"]>();
      for (const p of list) {
        const skin = p.skin >= 0 && p.skin < Math.max(1, data.skinCount) ? p.skin : 0;
        bySkin.set(skin, [...(bySkin.get(skin) ?? []), p]);
      }
      const meshes = data.bodyParts.flatMap((part) => part.models[0]?.meshes ?? []);
      const fills: Promise<void>[] = [];
      for (const md of meshes) {
        for (const [skin, placed] of bySkin) {
          const geo = new THREE.InstancedBufferGeometry();
          geo.setAttribute("position", new THREE.BufferAttribute(md.positions, 3));
          geo.setAttribute("normal", new THREE.BufferAttribute(md.normals, 3));
          geo.setAttribute("uv", new THREE.BufferAttribute(md.uvs, 2));
          geo.setIndex(new THREE.BufferAttribute(md.indices, 1));
          // the light of each one: its ambient cube, one attribute per face
          for (let face = 0; face < 6; face++) {
            const a = new Float32Array(placed.length * 3);
            placed.forEach((p, i) => a.set(p.ambient[face] ?? [0.3, 0.3, 0.3], i * 3));
            geo.setAttribute(`amb${face}`, new THREE.InstancedBufferAttribute(a, 3));
          }
          geo.instanceCount = placed.length;
          geo.computeBoundingSphere();
          this.geometries.push(geo);
          const name = (md.materials[skin] ?? md.material).replace(/^materials\//, "").replace(/\.vmt$/, "");
          const key = `p:${name}`;
          const fresh = !this.materials.has(key);
          const material = this.material(name, true);
          if (fresh) fills.push(this.fill(key).catch(() => undefined));
          const inst = new THREE.InstancedMesh(geo, material, placed.length);
          placed.forEach((p, i) => {
            const at = new THREE.Matrix4().makeTranslation(p.origin[0], p.origin[1], p.origin[2]).multiply(angleMatrix(p.angles)).multiply(new THREE.Matrix4().makeScale(p.scale, p.scale, p.scale));
            inst.setMatrixAt(i, at);
          });
          inst.instanceMatrix.needsUpdate = true;
          inst.computeBoundingSphere();
          inst.name = path;
          inst.matrixAutoUpdate = false;
          this.world.add(inst);
          this.meshesOf.set(key, [...(this.meshesOf.get(key) ?? []), inst]);
          this.colliders.push({ geo, matrices: placed.map((_, i) => { const mm = new THREE.Matrix4(); inst.getMatrixAt(i, mm); return mm; }), key });
        }
      }
      this.world.updateMatrixWorld(true);
      await Promise.all(fills);
    }, () => this.disposed);
    this.buildColliders();
  }

  // --- what is solid: a grid of the map's triangles, to find what a ray meets (the floor under a point, a wall ahead) ---------------

  private readonly colliders: { geo: THREE.BufferGeometry; matrices: THREE.Matrix4[] | null; key: string }[] = [];
  /** The solid triangles, 9 floats each (map units), and per grid cell (CELL units square, in x and y) the triangles over it. */
  private tris = new Float32Array(0);
  private cells = new Map<number, number[]>();
  private stamp = new Uint32Array(0);
  private stampId = 0;

  private static cellKey(ix: number, iy: number) {
    return (ix + 32768) * 65536 + (iy + 32768);
  }

  /** Puts the solid triangles into the grid (the see-through ones, water and glass, are not solid). */
  private buildColliders() {
    const out: number[] = [];
    const v = new THREE.Vector3();
    for (const c of this.colliders) {
      const m = this.materials.get(c.key);
      if (m && (m.transparent || m.userData.renderOrder === 1)) continue;
      const pos = c.geo.getAttribute("position") as THREE.BufferAttribute;
      const index = c.geo.getIndex();
      if (!index) continue;
      for (const mat of c.matrices ?? [null]) {
        for (let i = 0; i < index.count; i++) {
          v.fromBufferAttribute(pos, index.getX(i));
          if (mat) v.applyMatrix4(mat);
          out.push(v.x, v.y, v.z);
        }
      }
    }
    this.tris = new Float32Array(out);
    const count = this.tris.length / 9;
    this.stamp = new Uint32Array(count);
    this.cells = new Map();
    for (let t = 0; t < count; t++) {
      const o = t * 9;
      const x0 = Math.floor(Math.min(this.tris[o], this.tris[o + 3], this.tris[o + 6]) / CELL);
      const x1 = Math.floor(Math.max(this.tris[o], this.tris[o + 3], this.tris[o + 6]) / CELL);
      const y0 = Math.floor(Math.min(this.tris[o + 1], this.tris[o + 4], this.tris[o + 7]) / CELL);
      const y1 = Math.floor(Math.max(this.tris[o + 1], this.tris[o + 4], this.tris[o + 7]) / CELL);
      for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) {
        const k = MapScene.cellKey(ix, iy);
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(t);
      }
    }
  }

  /**
   * The first solid surface along a ray of the view (from `origin`, toward `dir`, up to `max`): where it is met (view units), its normal
   * and how far; null when nothing is met (or the map is hidden).
   */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, max = 1e5): { point: THREE.Vector3; normal: THREE.Vector3; distance: number } | null {
    if (!this.group.visible || !this.tris.length) return null;
    const o = origin.clone().applyMatrix4(this.inverse);
    const d = dir.clone().transformDirection(this.inverse).normalize();
    const id = ++this.stampId;
    let best = max, bestTri = -1;
    const tris = this.tris;
    const test = (list: number[] | undefined) => {
      if (!list) return;
      for (const t of list) {
        if (this.stamp[t] === id) continue;
        this.stamp[t] = id;
        const k = t * 9;
        const e1x = tris[k + 3] - tris[k], e1y = tris[k + 4] - tris[k + 1], e1z = tris[k + 5] - tris[k + 2];
        const e2x = tris[k + 6] - tris[k], e2y = tris[k + 7] - tris[k + 1], e2z = tris[k + 8] - tris[k + 2];
        const px = d.y * e2z - d.z * e2y, py = d.z * e2x - d.x * e2z, pz = d.x * e2y - d.y * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-9) continue;
        const inv = 1 / det;
        const sx = o.x - tris[k], sy = o.y - tris[k + 1], sz = o.z - tris[k + 2];
        const u = (sx * px + sy * py + sz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
        const w = (d.x * qx + d.y * qy + d.z * qz) * inv;
        if (w < 0 || u + w > 1) continue;
        const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (dist > 1e-4 && dist < best) { best = dist; bestTri = t; }
      }
    };
    // walk the cells the ray crosses (seen from above), nearest first, until a hit nearer than the next cell
    let ix = Math.floor(o.x / CELL), iy = Math.floor(o.y / CELL);
    const stepX = d.x > 0 ? 1 : -1, stepY = d.y > 0 ? 1 : -1;
    const tDx = Math.abs(d.x) > 1e-9 ? CELL / Math.abs(d.x) : Infinity;
    const tDy = Math.abs(d.y) > 1e-9 ? CELL / Math.abs(d.y) : Infinity;
    let tMx = Math.abs(d.x) > 1e-9 ? ((d.x > 0 ? (ix + 1) * CELL - o.x : o.x - ix * CELL) / Math.abs(d.x)) : Infinity;
    let tMy = Math.abs(d.y) > 1e-9 ? ((d.y > 0 ? (iy + 1) * CELL - o.y : o.y - iy * CELL) / Math.abs(d.y)) : Infinity;
    for (let steps = 0; steps < 4096; steps++) {
      test(this.cells.get(MapScene.cellKey(ix, iy)));
      const exit = Math.min(tMx, tMy);
      if (best <= exit || exit > max || exit === Infinity) break;
      if (tMx < tMy) { ix += stepX; tMx += tDx; } else { iy += stepY; tMy += tDy; }
    }
    if (bestTri < 0) return null;
    const k = bestTri * 9;
    const a = new THREE.Vector3(tris[k], tris[k + 1], tris[k + 2]);
    const n = new THREE.Vector3(tris[k + 3], tris[k + 4], tris[k + 5]).sub(a).cross(new THREE.Vector3(tris[k + 6], tris[k + 7], tris[k + 8]).sub(a)).normalize();
    if (n.dot(d) > 0) n.negate();
    const point = o.addScaledVector(d, best).applyMatrix4(this.group.matrix);
    return { point, normal: n.transformDirection(this.group.matrix), distance: best };
  }

  dispose() {
    this.disposed = true;
    this.group.removeFromParent();
    for (const g of this.geometries) g.dispose();
    for (const t of this.textures) t.dispose();
    for (const m of this.materials.values()) m.dispose();
    this.lightmap?.dispose();
    this.skyMaterial.dispose();
    this.materials.clear();
  }
}
