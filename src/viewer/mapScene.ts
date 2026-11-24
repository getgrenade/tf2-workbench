import * as THREE from "three";
import { listSequences, loadMap, loadMapMaterial, loadMapModel, loadMapPropLight, loadModel } from "../api";
import { Playback, Rig, SOURCE_TO_VIEWER } from "./animator";
import { bakeClip } from "./animUi";
import { buildGeometry } from "./geometryCache";
import { parseAnimInfo, parsePayload, type ClipData, type ModelData } from "./payload";
import { animationFrame, baseTextureAnimation, evaluateMaterialVars, hasTimeProxies, textureTransform as proxyTransform, type FrameAnimation, type ProxyDef } from "./proxies";

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
  props: MapProp[];
  spawns: MapSpawn[];
  lightmap: { width: number; height: number; pages: number; offset: number; range: number; average: number };
  sun: { dir: V3; color: V3 } | null;
  exposureMin: number | null;
  exposureMax: number | null;
  /** How its characters cast shadows (its shadow_control): the way they fall (the map's axes), their colour, their reach. */
  shadow?: { dir: V3; color: V3; distance: number } | null;
  sky: string | null;
  bounds: [number, number, number, number, number, number];
}

interface MaterialJson {
  shader: string;
  params: Record<string, string>;
  textures: { slot: string; width: number; height: number; offset: number }[];
  proxies?: ProxyDef[];
}

/** The size of the characters' shadow map (its side, texels). */
const SHADOW_SIZE = 2048;

function split(buf: ArrayBuffer) {
  const len = new DataView(buf).getUint32(0, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, len)));
  return { json, blob: (4 + len + 3) & ~3 };
}

/** A model the map places: its static number (what its baked light is named by), model, place, turn, skin, size and light. */
export interface MapProp { index: number | null; model: string; origin: V3; angles: V3; skin: number; scale: number; ambient: V3[]; sunlit: boolean; key: { dir: V3; color: V3 } | null; animation?: string | null }

const vertexShader = /* glsl */ `
  #ifdef PROP
    // (a prop with baked light has no ambient cube: a GPU takes only so many attributes, 16, and passes only so many values on)
    #ifndef STATIC_LIGHT
      attribute vec3 amb0; attribute vec3 amb1; attribute vec3 amb2; attribute vec3 amb3; attribute vec3 amb4; attribute vec3 amb5;
      varying vec3 vAmb0; varying vec3 vAmb1; varying vec3 vAmb2; varying vec3 vAmb3; varying vec3 vAmb4; varying vec3 vAmb5;
    #endif
    // the strongest light on it (toward it, the map's axes) and its colour; the model's tangents
    attribute vec3 keyDir; attribute vec3 keyColor; attribute vec4 propTangent;
    varying vec3 vKeyDir; varying vec3 vKeyColor; varying vec4 vTangent;
    #ifdef STATIC_LIGHT
      // the light the map baked into its vertices (gamma, half of it)
      attribute vec4 vlight;
      varying vec3 vStatic;
    #endif
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
  // the view's axes to the map's (a skinned prop is placed by its mesh's matrix, not by an instance's)
  uniform mat4 uViewToSrc;
  #include <skinning_pars_vertex>
  // the base texture's uv and the second's, together (the GPU passes only so many values on)
  varying vec4 vUvs;
  varying vec2 vBumpUv;
  // the map's axes (z up), for the ambient cube and the cubemap
  varying vec3 vSrcNormal;
  varying vec3 vSrcPos;
  varying vec3 vWorld;
  varying vec3 vWorldNormal;
  void main() {
    vec3 objectNormal = vec3(normal);
    vec3 transformed = vec3(position);
    #ifdef PROP
      vec3 objectTangent = propTangent.xyz;
    #endif
    // an animated prop: posed by its bones
    #ifdef USE_SKINNING
      #include <skinbase_vertex>
      #include <skinnormal_vertex>
      #include <skinning_vertex>
      #ifdef PROP
        objectTangent = (skinMatrix * vec4(objectTangent, 0.0)).xyz;
      #endif
    #endif
    mat4 m = modelMatrix;
    mat3 src = mat3(1.0);
    vec3 srcPos = transformed;
    #ifdef USE_INSTANCING
      m = modelMatrix * instanceMatrix;
      src = mat3(instanceMatrix);
      srcPos = (instanceMatrix * vec4(transformed, 1.0)).xyz;
    #endif
    #ifdef USE_SKINNING
      src = mat3(uViewToSrc) * mat3(modelMatrix);
      srcPos = (uViewToSrc * modelMatrix * vec4(transformed, 1.0)).xyz;
    #endif
    vUvs = vec4((uTexTransform * vec3(uv, 1.0)).xy, (uTexTransform2 * vec3(uv, 1.0)).xy);
    vBumpUv = (uBumpTransform * vec3(uv, 1.0)).xy;
    vSrcNormal = normalize(src * objectNormal);
    vSrcPos = srcPos;
    #ifdef PROP
      #ifndef STATIC_LIGHT
        vAmb0 = amb0; vAmb1 = amb1; vAmb2 = amb2; vAmb3 = amb3; vAmb4 = amb4; vAmb5 = amb5;
      #endif
      vKeyDir = keyDir; vKeyColor = keyColor;
      vTangent = vec4(normalize(src * objectTangent), propTangent.w);
      #ifdef STATIC_LIGHT
        vStatic = 2.0 * pow(vlight.rgb, vec3(2.2));
      #endif
    #else
      vLm = lightmapUv;
      vBlend = blend;
      vTs = tangentS;
      vTt = tangentT;
    #endif
    vec4 world = m * vec4(transformed, 1.0);
    vWorld = world.xyz;
    vWorldNormal = normalize(mat3(m) * objectNormal);
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
  uniform sampler2D tShadowDepth;
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
  // the characters' shadows (as the game casts them, its shadow_control: their silhouettes seen along the way the shadows fall,
  // on what lies behind them within its distance, in its colour)
  uniform bool uShadowOn;
  uniform mat4 uShadowMatrix;
  uniform float uShadowRange;
  uniform float uShadowMaxDist;
  uniform vec3 uShadowColor;
  uniform vec3 uShadowDir;
  uniform float uShadowTexel;
  uniform bool uPhong;
  uniform float uPhongExponent;
  uniform float uPhongBoost;
  uniform vec3 uPhongFresnel;
  uniform vec3 uPhongTint;
  uniform int uPhongMask;
  uniform bool uInvertPhongMask;
  uniform sampler2D tExponent;
  uniform bool uHasExponent;
  uniform bool uRim;
  uniform float uRimExponent;
  uniform float uRimBoost;
  uniform bool uRimMask;
  uniform bool uHalfLambert;
  uniform bool uSelfIllum;
  varying vec4 vUvs;
  #define vUv (vUvs.xy)
  #define vUv2 (vUvs.zw)
  varying vec2 vBumpUv;
  varying vec3 vSrcNormal;
  varying vec3 vSrcPos;
  varying vec3 vWorld;
  varying vec3 vWorldNormal;
  #ifdef PROP
    varying vec3 vKeyDir; varying vec3 vKeyColor; varying vec4 vTangent;
    #ifdef STATIC_LIGHT
      varying vec3 vStatic;
      // (its rim light takes the baked light instead of the cube)
      vec3 ambientCube(vec3 n) { return vStatic; }
    #else
      varying vec3 vAmb0; varying vec3 vAmb1; varying vec3 vAmb2; varying vec3 vAmb3; varying vec3 vAmb4; varying vec3 vAmb5;
      vec3 ambientCube(vec3 n) {
        vec3 n2 = n * n;
        return n2.x * (n.x >= 0.0 ? vAmb0 : vAmb1) + n2.y * (n.y >= 0.0 ? vAmb2 : vAmb3) + n2.z * (n.z >= 0.0 ? vAmb4 : vAmb5);
      }
    #endif
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
    // the surface's normal with its normal map
    vec3 N = srcN;
    #ifdef PROP
      if (uHasBump && !uSsbump && dot(vTangent.xyz, vTangent.xyz) > 0.0) {
        vec3 T = normalize(vTangent.xyz - srcN * dot(srcN, vTangent.xyz));
        vec3 B = cross(srcN, T) * (vTangent.w < 0.0 ? -1.0 : 1.0);
        N = normalize(tn.x * T + tn.y * B + tn.z * srcN);
      }
    #else
      if (uHasBump && !uSsbump) N = normalize(tn.x * normalize(vTs) + tn.y * normalize(vTt) + tn.z * srcN);
    #endif
    vec3 V = normalize(uSrcEye - vSrcPos);
    vec3 light;
    if (uUnlit) light = vec3(1.0 / max(uExposure, 1e-4));
    else {
      #ifdef PROP
        #ifdef STATIC_LIGHT
          // as the game draws a static prop: the light the map baked into it
          light = vStatic;
        #else
          float nl = dot(N, vKeyDir);
          nl = uHalfLambert ? pow(nl * 0.5 + 0.5, 2.0) : max(nl, 0.0);
          light = ambientCube(N) + vKeyColor * nl;
        #endif
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

    // the characters' shadows on it
    if (uShadowOn) {
      vec3 sc = (uShadowMatrix * vec4(vWorld, 1.0)).xyz;
      float facing = clamp(-dot(normalize(vWorldNormal), uShadowDir) * 4.0, 0.0, 1.0);
      if (facing > 0.0 && sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0) {
        float sum = 0.0;
        for (int i = -2; i <= 2; i++) {
          for (int j = -2; j <= 2; j++) {
            float d = texture2D(tShadowDepth, sc.xy + vec2(float(i), float(j)) * uShadowTexel).r;
            // how far behind what casts it, in units: within its distance, fading toward it
            float behind = (sc.z - d) * uShadowRange;
            sum += behind > 2.0 ? 1.0 - smoothstep(uShadowMaxDist * 0.5, uShadowMaxDist, behind) : 0.0;
          }
        }
        light *= mix(vec3(1.0), uShadowColor, sum / 25.0 * facing);
      }
    }

    if (uSelfIllum) light = mix(light, vec3(1.0 / max(uExposure, 1e-4)), albedo.a);
    vec3 color = albedo.rgb * light;

    #ifdef PROP
      vec4 expTexel = uHasExponent ? texture2D(tExponent, vUv) : vec4(0.0, 1.0, 0.0, 1.0);
      // the highlight of its strongest light (Source's phong: its exponent, boost, fresnel ranges and mask)
      if (uPhong && dot(vKeyColor, vKeyColor) > 0.0) {
        float mask = uPhongMask == 1 ? albedo.a : uPhongMask == 2 ? bumpTexel.a : 1.0;
        if (uInvertPhongMask) mask = 1.0 - mask;
        float exponent = uHasExponent ? expTexel.r * 149.0 + 1.0 : uPhongExponent;
        float f = 1.0 - clamp(dot(N, V), 0.0, 1.0);
        f = f * f - 0.5;
        float fresnel = mix(uPhongFresnel.y, f > 0.0 ? uPhongFresnel.z : uPhongFresnel.x, 2.0 * abs(f));
        vec3 R = reflect(-V, N);
        float spec = pow(clamp(dot(R, vKeyDir), 0.0, 1.0), exponent) * clamp(dot(N, vKeyDir), 0.0, 1.0);
        color += vKeyColor * spec * uPhongBoost * fresnel * mask * uPhongTint;
      }
      // the rim light: the light behind it, at its edges, from above
      if (uRim) {
        float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), uRimExponent) * uRimBoost * clamp(N.z, 0.0, 1.0);
        if (uRimMask) rim *= expTexel.a;
        color += ambientCube(V) * rim;
      }
    #endif

    // the reflection of the cubemap, under its mask
    if (uHasEnv) {
      vec3 R = reflect(-V, N);
      float mask = uEnvMask == 1 ? texture2D(tEnvMask, vUv).r : uEnvMask == 2 ? 1.0 - albedo.a : uEnvMask == 3 ? bumpTexel.a : 1.0;
      float fresnel = mix(1.0, pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0), clamp(uFresnel, 0.0, 1.0));
      color += textureCube(tCube, R).rgb * uEnvTint * mask * fresnel / max(uExposure, 1e-4);
    }

    gl_FragColor = vec4(color * uExposure, albedo.a * uAlpha);
    #include <colorspace_fragment>
  }`;

/** Whether a clip moves (some bone is elsewhere in some frame than in its first). */
function clipMoves(c: ClipData): boolean {
  if (c.frames < 2) return false;
  const per = c.numBones;
  for (let f = 1; f < c.frames; f++) {
    for (let k = 0; k < per * 3; k++) if (Math.abs(c.pos[f * per * 3 + k] - c.pos[k]) > 0.01) return true;
    for (let k = 0; k < per * 4; k++) if (Math.abs(c.quat[f * per * 4 + k] - c.quat[k]) > 1e-4) return true;
  }
  return false;
}

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
    uShadowOn: { value: false },
    tShadowDepth: { value: null as THREE.Texture | null },
    uShadowMatrix: { value: new THREE.Matrix4() },
    uShadowRange: { value: 1 },
    uShadowMaxDist: { value: 75 },
    uShadowColor: { value: new THREE.Vector3(0.25, 0.25, 0.25) },
    uShadowDir: { value: new THREE.Vector3(0, -1, 0) },
    uShadowTexel: { value: 1 / SHADOW_SIZE },
    uViewToSrc: { value: new THREE.Matrix4() },
  };
  private readonly inverse = new THREE.Matrix4();
  /** The meshes of each material (their draw order follows the material's). */
  private readonly meshesOf = new Map<string, THREE.Object3D[]>();
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

  /** How the characters cast shadows on it (its shadow_control, in the view's axes); null: they cast none. */
  private shadowStyle: { dir: THREE.Vector3; color: THREE.Vector3; distance: number } | null = null;
  private shadowTarget: THREE.WebGLRenderTarget | null = null;
  private readonly shadowCamera = new THREE.OrthographicCamera();

  /**
   * The characters' shadows on the map, as the game casts them: their silhouettes seen along the way the map's shadows fall (a depth
   * picture fitted around `bounds`, where they are), which the map's surfaces behind them, within its distance, take in its colour.
   * `draw` draws them (only them) with that camera into that target. Null bounds (no character), or off: no shadows.
   */
  renderShadow(bounds: THREE.Sphere | null, draw: (camera: THREE.Camera, target: THREE.WebGLRenderTarget) => void) {
    const u = this.shared;
    const style = this.shadowStyle;
    if (!style || !bounds || bounds.radius <= 0) { u.uShadowOn.value = false; return; }
    if (!this.shadowTarget) {
      this.shadowTarget = new THREE.WebGLRenderTarget(SHADOW_SIZE, SHADOW_SIZE, { depthBuffer: true, depthTexture: new THREE.DepthTexture(SHADOW_SIZE, SHADOW_SIZE) });
      u.tShadowDepth.value = this.shadowTarget.depthTexture;
    }
    const r = bounds.radius + 8;
    const back = r + 32;
    const cam = this.shadowCamera;
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
    cam.near = 0;
    cam.far = back + r + style.distance + 32;
    cam.position.copy(bounds.center).addScaledVector(style.dir, -back);
    cam.up.set(0, 1, 0);
    if (Math.abs(style.dir.y) > 0.99) cam.up.set(1, 0, 0);
    cam.lookAt(bounds.center);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    draw(cam, this.shadowTarget);
    // the view's positions to the depth picture (0..1)
    u.uShadowMatrix.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
    u.uShadowRange.value = cam.far - cam.near;
    u.uShadowMaxDist.value = style.distance;
    u.uShadowColor.value.copy(style.color);
    u.uShadowDir.value.copy(style.dir);
    // the blur: about two of the game's shadow texels (its shadows are soft), at least one of the picture's
    u.uShadowTexel.value = Math.max(1 / SHADOW_SIZE, 0.6 / (2 * r));
    u.uShadowOn.value = true;
  }

  /** Every frame: its animated textures and scrolling ones, and its animated props (`now`: ms). */
  tick(now: number) {
    const t = now / 1000;
    const dt = this.lastTick ? Math.min(0.1, t - this.lastTick) : 0;
    this.lastTick = t;
    for (const d of this.dynamicMaterials) {
      const u = d.material.uniforms;
      if (d.anim && d.frames.length > 1) u.tBase.value = d.frames[animationFrame(d.anim, t, d.frames.length)];
      if (d.bumpAnim && d.bumpFrames.length > 1) u.tBump.value = d.bumpFrames[animationFrame(d.bumpAnim, t, d.bumpFrames.length)];
      if (d.timed) {
        const vars = evaluateMaterialVars(d.params, d.proxies, { paint: null, time: t });
        const set = (key: string, uniform: string) => {
          const m = proxyTransform(vars, key);
          if (m) (u[uniform].value as THREE.Matrix3).set(m[0], m[1], m[2], m[3], m[4], m[5], 0, 0, 1);
        };
        set("$basetexturetransform", "uTexTransform");
        set("$bumptransform", "uBumpTransform");
      }
    }
    for (const a of this.animated) {
      a.playback.advance(dt);
      a.rig.poseFromClip(a.clip, a.playback.frame());
      a.rig.boneWorld.forEach((m, i) => a.bones[i].matrixWorld.copy(m));
    }
  }
  private lastTick = 0;
  /** The materials that change with the clock: their frames, their proxies. */
  private readonly dynamicMaterials: { material: THREE.ShaderMaterial; frames: THREE.Texture[]; anim: FrameAnimation | null; bumpFrames: THREE.Texture[]; bumpAnim: FrameAnimation | null; timed: boolean; params: Record<string, string>; proxies: ProxyDef[] }[] = [];
  /** The props that play an animation (prop entities whose sequence moves): their bones and clip. */
  private readonly animated: { rig: Rig; bones: THREE.Bone[]; clip: ClipData; playback: Playback }[] = [];

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
    this.shadowStyle = json.shadow ? { dir: MapScene.toView(json.shadow.dir).normalize(), color: new THREE.Vector3(...json.shadow.color), distance: json.shadow.distance } : null;
    this.shared.uRange.value = lm.range;
    this.shared.uPages.value = lm.pages;
    // the characters stand at the origin: put a RED spawn point there (else any, else the middle of the map's floor)
    const spawn = json.spawns.find((s) => s.team === 2) ?? json.spawns[0];
    const anchor = spawn ? new THREE.Vector3(...spawn.origin) : new THREE.Vector3((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, b[2]);
    this.group.matrix.copy(SOURCE_TO_VIEWER).multiply(new THREE.Matrix4().makeTranslation(-anchor.x, -anchor.y, -anchor.z));
    this.group.matrixWorldNeedsUpdate = true;
    this.inverse.copy(this.group.matrix).invert();
    this.shared.uViewToSrc.value.copy(this.inverse);

    const data = new Uint8Array(buf, blob + lm.offset, lm.width * lm.height * lm.pages * 4).slice();
    this.lightmap = new THREE.DataTexture(data, lm.width, lm.height * lm.pages, THREE.RGBAFormat);
    this.lightmap.colorSpace = THREE.NoColorSpace;
    this.lightmap.magFilter = THREE.LinearFilter;
    this.lightmap.minFilter = THREE.LinearFilter;
    this.lightmap.generateMipmaps = false;
    this.lightmap.needsUpdate = true;
    this.shared.tLightmap.value = this.lightmap;

    for (const m of json.meshes) {
      // the sky's faces are not drawn: the scene's sky (the World settings', made the map's) shows through them
      if (m.material === SKY_MATERIAL) continue;
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
      const mesh = new THREE.Mesh(geo, this.material(m.material, "w"));
      mesh.name = m.material;
      this.meshesOf.set(`w:${m.material}`, [...(this.meshesOf.get(`w:${m.material}`) ?? []), mesh]);
      if (!m.material.startsWith(OVERLAY_PREFIX)) this.colliders.push({ geo, matrices: null, key: `w:${m.material}` });
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
    this.buildColliders();
    await this.loadProps(json.props, progress);
    progress("");
  }

  /** The material of a map (or prop) material name, made grey at first and filled when its textures come. */
  private material(name: string, kind: "w" | "p" | "s"): THREE.ShaderMaterial {
    const key = `${kind}:${name}`;
    let m = this.materials.get(key);
    if (m) return m;
    m = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      defines: kind === "s" ? { PROP: 1, STATIC_LIGHT: 1 } : kind === "p" ? { PROP: 1 } : {},
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
        uPhong: { value: false },
        uPhongExponent: { value: 5 },
        uPhongBoost: { value: 1 },
        uPhongFresnel: { value: new THREE.Vector3(0, 0.5, 1) },
        uPhongTint: { value: new THREE.Vector3(1, 1, 1) },
        uPhongMask: { value: 0 },
        uInvertPhongMask: { value: false },
        tExponent: { value: null },
        uHasExponent: { value: false },
        uRim: { value: false },
        uRimExponent: { value: 4 },
        uRimBoost: { value: 1 },
        uRimMask: { value: false },
        uHalfLambert: { value: false },
        uSelfIllum: { value: false },
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
    const frames: THREE.Texture[] = [], bumpFrames: THREE.Texture[] = [];
    for (const t of json.textures) {
      // an animated texture's other frames
      const frame = /^(base|bump)_f(\d+)$/.exec(t.slot);
      if (frame) {
        const tex = this.dataTexture(buf, blob + t.offset, t.width, t.height, frame[1] === "base");
        (frame[1] === "base" ? frames : bumpFrames)[Number(frame[2])] = tex;
        continue;
      }
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
      if (t.slot === "exponent") { u.tExponent.value = tex; u.uHasExponent.value = true; }
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
    // a model's phong, rim light and self-illumination
    u.uPhong.value = flag("$phong");
    u.uPhongExponent.value = Number(p["$phongexponent"] ?? 5) || 5;
    u.uPhongBoost.value = Number(p["$phongboost"] ?? 1);
    (u.uPhongFresnel.value as THREE.Vector3).set(...vmtColor(p["$phongfresnelranges"], [0, 0.5, 1]));
    (u.uPhongTint.value as THREE.Vector3).set(...vmtColor(p["$phongtint"], [1, 1, 1]));
    u.uPhongMask.value = flag("$basemapalphaphongmask") ? 1 : u.uHasBump.value ? 2 : 0;
    u.uInvertPhongMask.value = flag("$invertphongmask");
    u.uRim.value = flag("$rimlight");
    u.uRimExponent.value = Number(p["$rimlightexponent"] ?? 4) || 4;
    u.uRimBoost.value = Number(p["$rimlightboost"] ?? 1);
    u.uRimMask.value = flag("$rimmask");
    u.uHalfLambert.value = flag("$halflambert");
    u.uSelfIllum.value = flag("$selfillum");
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
    // its animated textures and scrolling ones run on the clock (see tick)
    const proxies = json.proxies ?? [];
    const anim = baseTextureAnimation(proxies), bumpAnim = baseTextureAnimation(proxies, "$bumpmap");
    if (u.tBase.value) frames[0] = u.tBase.value as THREE.Texture;
    if (u.tBump.value) bumpFrames[0] = u.tBump.value as THREE.Texture;
    const timed = hasTimeProxies(proxies);
    if ((anim && frames.filter(Boolean).length > 1) || (bumpAnim && bumpFrames.filter(Boolean).length > 1) || timed) {
      this.dynamicMaterials.push({ material: m, frames: frames.filter(Boolean), anim, bumpFrames: bumpFrames.filter(Boolean), bumpAnim, timed, params: p, proxies });
    }
    m.needsUpdate = true;
  }

  /** The map's props, by their number in `props`: what draws them (a mesh and its instance per part), and which are hidden. */
  private props: MapProp[] = [];
  private readonly propParts = new Map<number, { inst: THREE.InstancedMesh | null; mesh?: THREE.Object3D; i: number; collider: { matrices: THREE.Matrix4[] | null } | null }[]>();
  private readonly hiddenProps = new Set<number>();

  /**
   * The props: each model once. A static prop the map baked light into is drawn on its own, by that light (as the game draws it);
   * the others, of a model and skin, are drawn together, each lit by the light where it stands.
   */
  private async loadProps(props: MapJson["props"], progress: (text: string) => void) {
    this.props = props;
    const byModel = new Map<string, number[]>();
    props.forEach((p, n) => byModel.set(p.model, [...(byModel.get(p.model) ?? []), n]));
    const models = [...byModel.keys()];
    let done = 0;
    await pool(models, PARALLEL, async (path) => {
      let data: ModelData;
      const list = byModel.get(path)!;
      const statics = list.filter((n) => props[n].index !== null);
      let baked: Uint8Array | null = null;
      try {
        data = parsePayload(await loadMapModel(path));
        if (statics.length && !this.disposed) baked = new Uint8Array(await loadMapPropLight(this.name, path, statics.map((n) => props[n].index!)).catch(() => new ArrayBuffer(0)));
      } finally {
        progress(`${this.name}: props ${++done}/${models.length}`);
      }
      if (this.disposed) return;
      // the prop entities whose sequence moves (a swaying lantern, a flag): drawn posed by their bones, playing it (static props stay)
      const moving = await this.loadAnimated(path, list.filter((n) => props[n].index === null));
      const meshes = data.bodyParts.flatMap((part) => part.models[0]?.meshes ?? []);
      const vertexStart: number[] = [];
      let per = 0;
      for (const md of meshes) { vertexStart.push(per); per += md.positions.length / 3; }
      // a static prop's baked light (null when the map baked none for it)
      const lightOf = new Map<number, Uint8Array>();
      if (baked && baked.length === statics.length * per * 4) {
        statics.forEach((n, k) => {
          const block = baked!.subarray(k * per * 4, (k + 1) * per * 4);
          if (block.length && block[3] === 255) lightOf.set(n, block);
        });
      }
      const skinOf = (n: number) => (props[n].skin >= 0 && props[n].skin < Math.max(1, data.skinCount) ? props[n].skin : 0);
      // the batches: each baked prop alone, the others by skin
      const batches: { skin: number; placed: number[]; light: Uint8Array | null }[] = [];
      const bySkin = new Map<number, number[]>();
      for (const n of list) {
        if (moving.has(n)) continue;
        const light = lightOf.get(n);
        if (light) batches.push({ skin: skinOf(n), placed: [n], light });
        else bySkin.set(skinOf(n), [...(bySkin.get(skinOf(n)) ?? []), n]);
      }
      for (const [skin, placed] of bySkin) batches.push({ skin, placed, light: null });
      const fills: Promise<void>[] = [];
      meshes.forEach((md, mi) => {
        const position = new THREE.BufferAttribute(md.positions, 3);
        const normal = new THREE.BufferAttribute(md.normals, 3);
        const uv = new THREE.BufferAttribute(md.uvs, 2);
        const tangent = new THREE.BufferAttribute(md.tangents.length ? md.tangents : new Float32Array(md.positions.length / 3 * 4), 4);
        const index = new THREE.BufferAttribute(md.indices, 1);
        const count = md.positions.length / 3;
        for (const { skin, placed, light } of batches) {
          const geo = new THREE.InstancedBufferGeometry();
          geo.setAttribute("position", position);
          geo.setAttribute("normal", normal);
          geo.setAttribute("uv", uv);
          geo.setAttribute("propTangent", tangent);
          geo.setIndex(index);
          if (light) geo.setAttribute("vlight", new THREE.BufferAttribute(light.slice(vertexStart[mi] * 4, (vertexStart[mi] + count) * 4), 4, true));
          // the light of each one: its ambient cube (an attribute per face; not for baked light) and its strongest light
          if (!light) for (let face = 0; face < 6; face++) {
            const a = new Float32Array(placed.length * 3);
            placed.forEach((n, i) => a.set(props[n].ambient[face] ?? [0.3, 0.3, 0.3], i * 3));
            geo.setAttribute(`amb${face}`, new THREE.InstancedBufferAttribute(a, 3));
          }
          const keyDir = new Float32Array(placed.length * 3);
          const keyColor = new Float32Array(placed.length * 3);
          placed.forEach((n, i) => {
            const key = props[n].key;
            if (!key) return;
            keyDir.set(key.dir, i * 3);
            keyColor.set(key.color, i * 3);
          });
          geo.setAttribute("keyDir", new THREE.InstancedBufferAttribute(keyDir, 3));
          geo.setAttribute("keyColor", new THREE.InstancedBufferAttribute(keyColor, 3));
          geo.instanceCount = placed.length;
          geo.computeBoundingSphere();
          this.geometries.push(geo);
          const name = (md.materials[skin] ?? md.material).replace(/^materials\//, "").replace(/\.vmt$/, "");
          const kind = light ? "s" : "p";
          const key = `${kind}:${name}`;
          const fresh = !this.materials.has(key);
          const material = this.material(name, kind);
          if (fresh) fills.push(this.fill(key).catch(() => undefined));
          const inst = new THREE.InstancedMesh(geo, material, placed.length);
          placed.forEach((n, i) => inst.setMatrixAt(i, MapScene.propMatrix(props[n])));
          inst.instanceMatrix.needsUpdate = true;
          inst.computeBoundingSphere();
          inst.name = path;
          inst.matrixAutoUpdate = false;
          inst.userData.props = placed;
          this.world.add(inst);
          this.meshesOf.set(key, [...(this.meshesOf.get(key) ?? []), inst]);
          const collider = { geo, matrices: placed.map((n) => MapScene.propMatrix(props[n])), key };
          this.colliders.push(collider);
          placed.forEach((n, i) => this.propParts.set(n, [...(this.propParts.get(n) ?? []), { inst, i, collider }]));
        }
      });
      this.world.updateMatrixWorld(true);
      await Promise.all(fills);
    }, () => this.disposed);
    this.world.updateMatrixWorld(true);
    this.buildColliders();
  }

  /**
   * The props of `list` (prop entities of the model at `path`) whose sequence moves (their DefaultAnim, else their first, as the game
   * plays them): each drawn by its bones, posed every frame (see tick). Returns which they are.
   */
  private async loadAnimated(path: string, list: number[]): Promise<Set<number>> {
    const out = new Set<number>();
    if (!list.length) return out;
    let info: ReturnType<typeof parseAnimInfo>;
    try {
      info = parseAnimInfo(await listSequences(path));
    } catch {
      return out;
    }
    const defaults = info.poseParams.map((p) => p.default);
    const clips = new Map<number, ClipData | null>();
    const clipOf = async (n: number) => {
      const want = this.props[n].animation?.toLowerCase();
      const seq = want ? info.sequences.find((q) => q.name.toLowerCase() === want) : info.sequences[0];
      if (!seq) return null;
      if (!clips.has(seq.index)) clips.set(seq.index, await bakeClip(path, seq.index, defaults).then((c) => (clipMoves(c) ? c : null)).catch(() => null));
      return clips.get(seq.index) ?? null;
    };
    const playing: { n: number; clip: ClipData }[] = [];
    for (const n of list) {
      const clip = await clipOf(n);
      if (clip) playing.push({ n, clip });
    }
    if (!playing.length || this.disposed) return out;
    let data: ModelData;
    try {
      data = parsePayload(await loadModel(path));
    } catch {
      return out;
    }
    if (this.disposed) return out;
    const fills: Promise<void>[] = [];
    for (const { n, clip } of playing) {
      const p = this.props[n];
      const rig = new Rig(data.bones);
      if (clip.numBones !== data.bones.length) continue;
      const bones = data.bones.map((b) => {
        const bone = new THREE.Bone();
        bone.name = b.name;
        bone.matrixAutoUpdate = false;
        bone.matrixWorldAutoUpdate = false;
        return bone;
      });
      const skeleton = new THREE.Skeleton(bones, rig.poseToBone);
      const skin = p.skin >= 0 && p.skin < Math.max(1, data.skinCount) ? p.skin : 0;
      const meshes: THREE.SkinnedMesh[] = [];
      for (const md of data.bodyParts.flatMap((part) => part.models[0]?.meshes ?? [])) {
        if (!md.indices.length) continue;
        const { geo } = buildGeometry(md, false);
        const count = md.positions.length / 3;
        geo.setAttribute("propTangent", geo.getAttribute("tangent"));
        // its light where it stands, the same at every vertex
        const fill = (v: V3) => { const a = new Float32Array(count * 3); for (let i = 0; i < count; i++) a.set(v, i * 3); return new THREE.BufferAttribute(a, 3); };
        for (let face = 0; face < 6; face++) geo.setAttribute(`amb${face}`, fill(p.ambient[face] ?? [0.3, 0.3, 0.3]));
        geo.setAttribute("keyDir", fill(p.key?.dir ?? [0, 0, 0]));
        geo.setAttribute("keyColor", fill(p.key?.color ?? [0, 0, 0]));
        this.geometries.push(geo);
        const name = (md.materials[skin] ?? md.material).replace(/^materials\//, "").replace(/\.vmt$/, "");
        const key = `p:${name}`;
        const fresh = !this.materials.has(key);
        const material = this.material(name, "p");
        if (fresh) fills.push(this.fill(key).catch(() => undefined));
        const mesh = new THREE.SkinnedMesh(geo, material);
        // (skinned in the model's own space, as a character's: its matrix places it in the map)
        mesh.bindMode = THREE.DetachedBindMode;
        mesh.bind(skeleton, new THREE.Matrix4());
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(MapScene.propMatrix(p));
        mesh.name = path;
        mesh.userData.props = [n];
        this.world.add(mesh);
        this.meshesOf.set(key, [...(this.meshesOf.get(key) ?? []), mesh]);
        meshes.push(mesh);
      }
      if (!meshes.length) continue;
      const playback = new Playback();
      playback.clip = clip;
      this.animated.push({ rig, bones, clip, playback });
      rig.poseFromClip(clip, 0);
      rig.boneWorld.forEach((m, i) => bones[i].matrixWorld.copy(m));
      this.propParts.set(n, meshes.map((mesh) => ({ mesh, inst: null, i: 0, collider: null })));
      out.add(n);
    }
    await Promise.all(fills);
    return out;
  }

  /** Where a prop is in the map: its place, turn and size (map units). */
  private static propMatrix(p: MapProp): THREE.Matrix4 {
    return new THREE.Matrix4().makeTranslation(p.origin[0], p.origin[1], p.origin[2]).multiply(angleMatrix(p.angles)).multiply(new THREE.Matrix4().makeScale(p.scale, p.scale, p.scale));
  }

  /** The prop under a ray of the view (its number), when it is the first thing of the map the ray meets. */
  propAt(ray: THREE.Raycaster): number | null {
    if (!this.group.visible) return null;
    const hits = ray.intersectObject(this.world, true);
    for (const hit of hits) {
      const placed = hit.object.userData.props as number[] | undefined;
      if (!placed) {
        // a see-through surface (water, glass, a decal) is looked through
        const m = (hit.object as THREE.Mesh).material as THREE.Material;
        if (m?.transparent) continue;
        return null;
      }
      const n = placed[hit.instanceId ?? 0];
      if (n !== undefined && !this.hiddenProps.has(n)) return n;
    }
    return null;
  }

  /** A prop: its model and skin, and where it is in the view (place, rotation as three's "YXZ" Euler: pitch, yaw, roll; size). */
  propPlacement(n: number): { model: string; skin: number; position: THREE.Vector3; pitch: number; yaw: number; roll: number; scale: number } | null {
    const p = this.props[n];
    if (!p) return null;
    // the view's matrix of the model (its vertices are in the map's axes): the actor's root is place * turn * size * SOURCE_TO_VIEWER
    const world = this.group.matrix.clone().multiply(MapScene.propMatrix(p)).multiply(SOURCE_TO_VIEWER.clone().invert());
    const position = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    world.decompose(position, q, s);
    const e = new THREE.Euler().setFromQuaternion(q, "YXZ");
    return { model: p.model, skin: p.skin, position, pitch: e.x, yaw: e.y, roll: e.z, scale: p.scale };
  }

  /** Hides a prop of the map (or shows it again): a movable copy of it takes its place. */
  setPropHidden(n: number, hidden: boolean) {
    if (hidden === this.hiddenProps.has(n) || !this.props[n]) return;
    if (hidden) this.hiddenProps.add(n);
    else this.hiddenProps.delete(n);
    const m = hidden ? new THREE.Matrix4().makeScale(0, 0, 0) : MapScene.propMatrix(this.props[n]);
    for (const part of this.propParts.get(n) ?? []) {
      if (part.mesh) part.mesh.visible = !hidden;
      if (!part.inst) continue;
      part.inst.setMatrixAt(part.i, m);
      part.inst.instanceMatrix.needsUpdate = true;
      part.inst.computeBoundingSphere();
      if (part.collider?.matrices) part.collider.matrices[part.i] = m.clone();
    }
    this.buildColliders();
  }

  /** The props hidden (made movable). */
  get hiddenPropList(): number[] {
    return [...this.hiddenProps];
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
        if (mat && mat.determinant() === 0) continue;
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
    this.shadowTarget?.dispose();
    this.materials.clear();
  }
}
