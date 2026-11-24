import * as THREE from "three";
import { loadMap, loadMapMaterial, loadModel } from "../api";
import { SOURCE_TO_VIEWER } from "./animator";
import { parsePayload, type ModelData } from "./payload";

/**
 * A map of the game in the scene: its brush faces and displacements lit by its own lightmaps, its static props and prop entities, placed
 * so that a spawn point is where the characters stand. Textures come in as they load (a grey face until then).
 */

/** The biggest side of a map texture (they are many; the view rarely comes close to a wall). */
const TEXTURE_SIZE = 512;
/** How many materials and models load at once. */
const PARALLEL = 6;

export interface MapSpawn {
  origin: [number, number, number];
  yaw: number;
  team: number;
}

interface MapJson {
  name: string;
  meshes: { material: string; vertexCount: number; indexCount: number; pos: number; normal: number; uv: number; lightmap: number; blend: number; index: number }[];
  props: { model: string; origin: [number, number, number]; angles: [number, number, number]; skin: number; scale: number }[];
  spawns: MapSpawn[];
  lightmap: { width: number; height: number; offset: number; range: number };
  sky: string | null;
  bounds: [number, number, number, number, number, number];
}

interface MaterialJson {
  shader: string;
  params: Record<string, string>;
  textures: { slot: string; width: number; height: number; offset: number }[];
}

function split(buf: ArrayBuffer) {
  const len = new DataView(buf).getUint32(0, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, len)));
  return { json, blob: (4 + len + 3) & ~3 };
}

const vertexShader = /* glsl */ `
  attribute vec2 lightmapUv;
  attribute float blend;
  varying vec2 vUv;
  varying vec2 vLm;
  varying float vBlend;
  varying vec3 vNormal;
  uniform mat3 uTexTransform;
  uniform mat3 uTexTransform2;
  varying vec2 vUv2;
  void main() {
    mat4 m = modelMatrix;
    #ifdef USE_INSTANCING
      m = modelMatrix * instanceMatrix;
    #endif
    vUv = (uTexTransform * vec3(uv, 1.0)).xy;
    vUv2 = (uTexTransform2 * vec3(uv, 1.0)).xy;
    vLm = lightmapUv;
    vBlend = blend;
    // (the map's axes: z is up)
    vNormal = normalize(mat3(m) * normal);
    gl_Position = projectionMatrix * viewMatrix * m * vec4(position, 1.0);
  }`;

const fragmentShader = /* glsl */ `
  uniform sampler2D tBase;
  uniform sampler2D tBase2;
  uniform sampler2D tLightmap;
  uniform bool uHasBase;
  uniform bool uHasBase2;
  uniform bool uLit;
  uniform bool uUnlit;
  uniform float uRange;
  uniform float uAlphaTest;
  uniform float uAlpha;
  uniform vec3 uColor;
  uniform vec3 uAmbient;
  uniform vec3 uUp;
  varying vec2 vUv;
  varying vec2 vUv2;
  varying vec2 vLm;
  varying float vBlend;
  varying vec3 vNormal;
  void main() {
    vec4 albedo = uHasBase ? texture2D(tBase, vUv) : vec4(0.6, 0.6, 0.6, 1.0);
    if (uHasBase2) albedo = mix(albedo, texture2D(tBase2, vUv2), clamp(vBlend, 0.0, 1.0));
    albedo.rgb *= uColor;
    if (uAlphaTest > 0.0 && albedo.a < uAlphaTest) discard;
    vec3 light;
    if (uUnlit) light = vec3(1.0);
    else if (uLit && vLm.x >= 0.0) {
      vec3 s = texture2D(tLightmap, vLm).rgb;
      light = s * s * uRange;
    } else {
      // a prop (or a face without a lightmap): the map's average light, a little brighter from above
      float up = dot(normalize(vNormal), uUp) * 0.5 + 0.5;
      light = uAmbient * (0.65 + 0.55 * up);
    }
    gl_FragColor = vec4(albedo.rgb * light, albedo.a * uAlpha);
    #include <colorspace_fragment>
  }`;

/** `center .5 .5 scale 2 2 rotate 0 translate 0 0` as a 3x3 uv matrix. */
function textureTransform(value: string | undefined): THREE.Matrix3 {
  const m = new THREE.Matrix3();
  if (!value) return m;
  const num = (key: string, n: number, fallback: number[]) => {
    const at = value.toLowerCase().split(/\s+/);
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

/** The rotation of a set of game angles (pitch, yaw, roll in degrees), as AngleMatrix makes it. */
function angleMatrix([p, y, r]: [number, number, number]): THREE.Matrix4 {
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

export class MapScene {
  /** In the viewer's axes, moved so the spawn point is at the origin. */
  readonly group = new THREE.Group();
  readonly name: string;
  spawns: MapSpawn[] = [];
  sky: string | null = null;
  /** The size of the map (its diagonal, in units). */
  extent = 0;
  private lightmap: THREE.DataTexture | null = null;
  private readonly materials = new Map<string, THREE.ShaderMaterial>();
  private readonly textures: THREE.Texture[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private disposed = false;
  private ambient = new THREE.Vector3(0.6, 0.6, 0.6);
  private readonly world = new THREE.Group();

  constructor(name: string) {
    this.name = name;
    this.group.name = `map:${name}`;
    this.group.matrixAutoUpdate = false;
    this.group.add(this.world);
    this.world.matrixAutoUpdate = false;
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
    // the characters stand at the origin: put a RED spawn point there (else any, else the middle of the map's floor)
    const spawn = json.spawns.find((s) => s.team === 2) ?? json.spawns[0];
    const anchor = spawn ? new THREE.Vector3(...spawn.origin) : new THREE.Vector3((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, b[2]);
    this.group.matrix.copy(SOURCE_TO_VIEWER).multiply(new THREE.Matrix4().makeTranslation(-anchor.x, -anchor.y, -anchor.z));
    this.group.matrixWorldNeedsUpdate = true;

    const lm = json.lightmap;
    const data = new Uint8Array(buf, blob + lm.offset, lm.width * lm.height * 4).slice();
    this.lightmap = new THREE.DataTexture(data, lm.width, lm.height, THREE.RGBAFormat);
    this.lightmap.colorSpace = THREE.NoColorSpace;
    this.lightmap.magFilter = THREE.LinearFilter;
    this.lightmap.minFilter = THREE.LinearFilter;
    this.lightmap.generateMipmaps = false;
    this.lightmap.needsUpdate = true;
    // the average light (props are lit by it)
    let sum = [0, 0, 0], n = 0;
    for (let i = 0; i < data.length; i += 64) {
      if (data[i] + data[i + 1] + data[i + 2] === 0) continue;
      for (let c = 0; c < 3; c++) sum[c] += (data[i + c] / 255) ** 2 * lm.range;
      n++;
    }
    if (n) this.ambient.set(sum[0] / n, sum[1] / n, sum[2] / n).multiplyScalar(1.2);

    for (const m of json.meshes) {
      const geo = new THREE.BufferGeometry();
      const f32 = (off: number, count: number) => new Float32Array(buf.slice(blob + off, blob + off + count * 4));
      geo.setAttribute("position", new THREE.BufferAttribute(f32(m.pos, m.vertexCount * 3), 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(f32(m.normal, m.vertexCount * 3), 3));
      geo.setAttribute("uv", new THREE.BufferAttribute(f32(m.uv, m.vertexCount * 2), 2));
      geo.setAttribute("lightmapUv", new THREE.BufferAttribute(f32(m.lightmap, m.vertexCount * 2), 2));
      geo.setAttribute("blend", new THREE.BufferAttribute(f32(m.blend, m.vertexCount), 1));
      geo.setIndex(new THREE.BufferAttribute(new Uint32Array(buf.slice(blob + m.index, blob + m.index + m.indexCount * 4)), 1));
      geo.computeBoundingSphere();
      this.geometries.push(geo);
      const mesh = new THREE.Mesh(geo, this.material(m.material, true));
      mesh.name = m.material;
      mesh.matrixAutoUpdate = false;
      this.world.add(mesh);
    }
    this.world.updateMatrixWorld(true);

    // the textures, then the props
    const names = [...this.materials.keys()];
    let done = 0;
    await pool(names, PARALLEL, async (name) => {
      await this.fill(name);
      progress(`${this.name}: textures ${++done}/${names.length}`);
    }, () => this.disposed);
    await this.loadProps(json.props, progress);
    progress("");
  }

  /** The material of a map (or prop) material name, made grey at first and filled when its textures come. */
  private material(name: string, lit: boolean): THREE.ShaderMaterial {
    const key = `${lit ? "w" : "p"}:${name}`;
    let m = this.materials.get(key);
    if (m) return m;
    m = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        tBase: { value: null },
        tBase2: { value: null },
        tLightmap: { value: this.lightmap },
        uHasBase: { value: false },
        uHasBase2: { value: false },
        uLit: { value: lit },
        uUnlit: { value: false },
        uRange: { value: 4 },
        uAlphaTest: { value: 0 },
        uAlpha: { value: 1 },
        uColor: { value: new THREE.Color(1, 1, 1) },
        uAmbient: { value: this.ambient },
        uUp: { value: new THREE.Vector3(0, 0, 1) },
        uTexTransform: { value: new THREE.Matrix3() },
        uTexTransform2: { value: new THREE.Matrix3() },
      },
    });
    m.userData.mapMaterial = name;
    this.materials.set(key, m);
    return m;
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
    for (const t of json.textures) {
      const tex = new THREE.DataTexture(new Uint8Array(buf, blob + t.offset, t.width * t.height * 4).slice(), t.width, t.height, THREE.RGBAFormat);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      tex.anisotropy = 8;
      tex.needsUpdate = true;
      this.textures.push(tex);
      if (t.slot === "base") { u.tBase.value = tex; u.uHasBase.value = true; }
      if (t.slot === "base2") { u.tBase2.value = tex; u.uHasBase2.value = true; }
    }
    u.uTexTransform.value = textureTransform(p["$basetexturetransform"]);
    u.uTexTransform2.value = textureTransform(p["$basetexturetransform2"] ?? p["$basetexturetransform"]);
    const color = (p["$color"] ?? p["$color2"])?.replace(/[[\]{}]/g, " ").trim().split(/\s+/).map(Number);
    if (color?.length === 3 && color.every((c) => Number.isFinite(c))) {
      const s = color.some((c) => c > 1) ? 1 / 255 : 1;
      (u.uColor.value as THREE.Color).setRGB(color[0] * s, color[1] * s, color[2] * s);
    }
    const shader = json.shader.toLowerCase();
    u.uUnlit.value = shader === "unlitgeneric" || shader === "sprite";
    if (shader === "water") {
      // water: its fog colour, see-through
      const fog = (p["$fogcolor"] ?? "{90 110 120}").replace(/[[\]{}]/g, " ").trim().split(/\s+/).map(Number);
      const s = fog.some((c) => c > 1) ? 1 / 255 : 1;
      (u.uColor.value as THREE.Color).setRGB((fog[0] ?? 90) * s, (fog[1] ?? 110) * s, (fog[2] ?? 120) * s);
      u.uHasBase.value = false;
      u.uAlpha.value = 0.7;
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

  /** The props: each model once, drawn as many times as the map places it. */
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
      const bySkin = new Map<number, THREE.Matrix4[]>();
      for (const p of list) {
        const skin = p.skin >= 0 && p.skin < Math.max(1, data.skinCount) ? p.skin : 0;
        const at = new THREE.Matrix4().makeTranslation(p.origin[0], p.origin[1], p.origin[2]).multiply(angleMatrix(p.angles)).multiply(new THREE.Matrix4().makeScale(p.scale, p.scale, p.scale));
        const mats = bySkin.get(skin) ?? [];
        mats.push(at);
        bySkin.set(skin, mats);
      }
      const meshes = data.bodyParts.flatMap((part) => part.models[0]?.meshes ?? []);
      const fills: Promise<void>[] = [];
      for (const md of meshes) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(md.positions, 3));
        geo.setAttribute("normal", new THREE.BufferAttribute(md.normals, 3));
        geo.setAttribute("uv", new THREE.BufferAttribute(md.uvs, 2));
        geo.setAttribute("lightmapUv", new THREE.BufferAttribute(new Float32Array((md.positions.length / 3) * 2).fill(-1), 2));
        geo.setAttribute("blend", new THREE.BufferAttribute(new Float32Array(md.positions.length / 3), 1));
        geo.setIndex(new THREE.BufferAttribute(md.indices, 1));
        geo.computeBoundingSphere();
        this.geometries.push(geo);
        for (const [skin, mats] of bySkin) {
          const name = (md.materials[skin] ?? md.material).replace(/^materials\//, "").replace(/\.vmt$/, "");
          const key = `p:${name}`;
          const fresh = !this.materials.has(key);
          const material = this.material(name, false);
          if (fresh) fills.push(this.fill(key).catch(() => undefined));
          const inst = new THREE.InstancedMesh(geo, material, mats.length);
          mats.forEach((m, i) => inst.setMatrixAt(i, m));
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
