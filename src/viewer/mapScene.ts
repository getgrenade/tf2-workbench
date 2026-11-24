import * as THREE from "three";
import { loadMap, loadMapMaterial, loadModel } from "../api";
import { SOURCE_TO_VIEWER } from "./animator";
import { parsePayload, type ModelData } from "./payload";

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
const TEXTURE_SIZE = 512;
/** How many materials and models load at once. */
const PARALLEL = 6;
/** The average light the exposure brings the map's lit faces to (the game's auto exposure does much the same), and its limits. */
const EXPOSURE_TARGET = 0.16;
const EXPOSURE_RANGE: [number, number] = [1, 12];

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
    this.exposure = lm.average > 0 ? Math.min(EXPOSURE_RANGE[1], Math.max(EXPOSURE_RANGE[0], EXPOSURE_TARGET / lm.average)) : 1;
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
      const mesh = new THREE.Mesh(geo, this.material(m.material, false));
      mesh.name = m.material;
      mesh.matrixAutoUpdate = false;
      this.world.add(mesh);
    }
    this.world.updateMatrixWorld(true);

    // the textures, then the props
    const keys = [...this.materials.keys()];
    let done = 0;
    await pool(keys, PARALLEL, async (key) => {
      await this.fill(key);
      progress(`${this.name}: textures ${++done}/${keys.length}`);
    }, () => this.disposed);
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
    const name = key.slice(2);
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
        data = parsePayload(await loadModel(path));
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
        }
      }
      this.world.updateMatrixWorld(true);
      await Promise.all(fills);
    }, () => this.disposed);
  }

  dispose() {
    this.disposed = true;
    this.group.removeFromParent();
    for (const g of this.geometries) g.dispose();
    for (const t of this.textures) t.dispose();
    for (const m of this.materials.values()) m.dispose();
    this.lightmap?.dispose();
    this.materials.clear();
  }
}
