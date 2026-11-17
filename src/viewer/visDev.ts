import * as THREE from "three";
import { rgbOf, sortedStops, type GradientStop } from "./gradientStops";

/**
 * Vis dev: a quick look at the compiler's item with the shading a texture artist bakes for a first pass (Substance's world space normal
 * gradient, a little ambient occlusion, Blender's cavity), and a fill colour or gradient, all made from the model itself instead of UVs.
 *  - the occlusion is worked out per vertex (rays against the item, as Blender's AO) and the fill's place on the item from the vertex's
 *    position in the item's bounds (bind pose, so it stays on the item as it moves): both baked into the geometry once;
 *  - the gradient (and the Normal fill) per pixel from the normal;
 *  - the cavity (ridges lighter, valleys darker) in screen space as Blender's Workbench does it: the item's normals are drawn into a
 *    buffer before the scene (visDevPass.ts), and each pixel compares the normals beside it.
 * The shader (sourceShader.ts) layers them over the base colour, on geometry that holds the bake only.
 */
export type VisDevFill = "off" | "colour" | "linear" | "radial" | "normal";
export interface VisDevSettings {
  on: boolean;
  /** Darker underneath, lighter on top (the green channel of the world space normal). */
  gradient: number;
  ao: number;
  /** How far the occlusion rays look, in units (an item is 10-30 units across). */
  aoDistance: number;
  /** The cavity: ridges lighter, valleys darker, and how many pixels apart the normals it compares are. */
  ridge: number;
  valley: number;
  cavityWidth: number;
  fill: VisDevFill;
  fillColour: string;
  stops: GradientStop[];
  softness: number;
  /** How much of the fill shows, and whether it multiplies the colour instead of replacing it. */
  fillAmount: number;
  fillMultiply: boolean;
  /** The way a Linear or Normal fill runs: tilt from straight up (0: bottom to top, 90: level) and turn about the vertical (0: toward the front). */
  tilt: number;
  turn: number;
  /** A Radial fill's centre in the item's bounds (0..1 on each axis) and size. */
  cx: number;
  cy: number;
  cz: number;
  radius: number;
}

export const VISDEV_DEFAULTS: VisDevSettings = {
  on: false, gradient: 0.4, ao: 0.6, aoDistance: 6, ridge: 0.5, valley: 0.6, cavityWidth: 1.5,
  fill: "off", fillColour: "#8a8a8a", stops: [{ at: 0, color: "#2e2219" }, { at: 1, color: "#b89a74" }], softness: 0, fillAmount: 1, fillMultiply: false,
  tilt: 0, turn: 0, cx: 0.5, cy: 0.5, cz: 0.5, radius: 0.7,
};

/** A copy of the settings (the stops are their own). */
export const copyVisDev = (s: VisDevSettings): VisDevSettings => ({ ...s, stops: s.stops.map((x) => ({ ...x })) });

const KEY = "tf2workbench.visdev";
export function loadVisDev(): VisDevSettings {
  const out = copyVisDev(VISDEV_DEFAULTS);
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<VisDevSettings>;
    for (const k of Object.keys(out) as (keyof VisDevSettings)[]) {
      if (k === "stops") continue;
      if (typeof saved[k] === typeof out[k]) (out as unknown as Record<string, unknown>)[k] = saved[k];
    }
    if (Array.isArray(saved.stops) && saved.stops.length >= 2 && saved.stops.every((s) => typeof s?.at === "number" && /^#[0-9a-f]{6}$/i.test(s?.color ?? ""))) out.stops = saved.stops.map((s) => ({ ...s }));
  } catch { /* the defaults */ }
  return out;
}
export function saveVisDev(s: VisDevSettings) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* not remembered */ } }

/** The most stops a fill gradient has (as the backdrop's). */
const STOPS = 16;
/** The uniforms the vis dev look reads (shared by every material: only geometry with the visDev attribute shows it). */
export function visDevUniforms(): Record<string, THREE.IUniform> {
  return {
    uVisDevOn: { value: 0 },
    uVisDevA: { value: new THREE.Vector4() },
    uVisDevCavity: { value: new THREE.Vector3() },
    tVisDevNormals: { value: null as THREE.Texture | null },
    uVisDevView: { value: new THREE.Vector4(0, 0, 1, 1) },
    uVisDevFill: { value: new THREE.Vector4() },
    uVisDevDir: { value: new THREE.Vector3(0, 1, 0) },
    uVisDevCentre: { value: new THREE.Vector4(0.5, 0.5, 0.5, 0.7) },
    // the gradient as uniforms, not a texture: the materials use all the texture units a GPU has but one, which the cavity takes
    uVisDevStops: { value: Array.from({ length: STOPS }, () => new THREE.Vector4()) },
    uVisDevMids: { value: new Array(STOPS).fill(0.5) },
    uVisDevStopInfo: { value: new THREE.Vector2(2, 0) },
  };
}
const FILL_MODES: Record<VisDevFill, number> = { off: 0, colour: 1, linear: 2, radial: 3, normal: 4 };
export function setVisDevUniforms(u: Record<string, THREE.IUniform>, s: VisDevSettings) {
  u.uVisDevOn.value = s.on ? 1 : 0;
  (u.uVisDevA.value as THREE.Vector4).set(s.gradient, s.ao, 0, 0);
  (u.uVisDevCavity.value as THREE.Vector3).set(s.ridge, s.valley, s.cavityWidth);
  (u.uVisDevFill.value as THREE.Vector4).set(FILL_MODES[s.fill] ?? 0, s.fillAmount, s.fillMultiply ? 1 : 0, 0);
  const tilt = (s.tilt * Math.PI) / 180, turn = (s.turn * Math.PI) / 180;
  // the model's space: Y up, Z toward the front, X to the side
  (u.uVisDevDir.value as THREE.Vector3).set(Math.sin(tilt) * Math.sin(turn), Math.cos(tilt), Math.sin(tilt) * Math.cos(turn));
  (u.uVisDevCentre.value as THREE.Vector4).set(s.cx, s.cy, s.cz, s.radius);
  // (blended in sRGB as the backdrop's gradient is; the shader makes the result linear)
  const stops = (s.fill === "colour" ? [{ at: 0, color: s.fillColour }, { at: 1, color: s.fillColour }] : sortedStops(s.stops)).slice(0, STOPS);
  const out = u.uVisDevStops.value as THREE.Vector4[], mids = u.uVisDevMids.value as number[];
  stops.forEach((x, i) => { const [r, g, b] = rgbOf(x.color); out[i].set(r / 255, g / 255, b / 255, x.at); mids[i] = x.mid ?? 0.5; });
  (u.uVisDevStopInfo.value as THREE.Vector2).set(stops.length, s.softness);
}

export const visDevVertexGLSL = /* glsl */ `
attribute vec2 visDev;
attribute vec3 visDevPos;
varying vec2 vVisDev;
varying vec3 vVisDevPos;
`;
export const visDevFragmentGLSL = /* glsl */ `
uniform float uVisDevOn;
uniform vec4 uVisDevA;        // gradient, occlusion
uniform vec3 uVisDevCavity;   // ridge, valley, width (px)
uniform sampler2D tVisDevNormals;  // the item's view space normals (rgb) and depth (a; 0: nothing there), drawn before the scene
uniform vec4 uVisDevView;     // the viewport they were drawn for (x, y, width, height in pixels)
uniform vec4 uVisDevFill;     // mode (0 off, 1 colour, 2 linear, 3 radial, 4 normal), amount, multiply
uniform vec3 uVisDevDir;
uniform vec4 uVisDevCentre;   // xyz, size
uniform vec4 uVisDevStops[16];   // sRGB colour, place
uniform float uVisDevMids[16];   // where each blend is half way
uniform vec2 uVisDevStopInfo;    // how many stops, softness
varying vec2 vVisDev;         // occlusion (1 open), 1 where it was baked
varying vec3 vVisDevPos;      // the place in the item's bounds, 0..1
/** The fill gradient at t, as gradientStops.ts colourAt (blended in sRGB), made linear. */
vec3 visDevRamp(float t) {
  int n = int(uVisDevStopInfo.x);
  vec3 c = uVisDevStops[n - 1].rgb;
  if (t <= uVisDevStops[0].w) c = uVisDevStops[0].rgb;
  else for (int i = 0; i < 15; i++) {
    if (i >= n - 1) break;
    vec4 a = uVisDevStops[i], b = uVisDevStops[i + 1];
    if (t < b.w) {
      float u = b.w > a.w ? clamp((t - a.w) / (b.w - a.w), 0.0, 1.0) : 1.0;
      float f = pow(u, log(0.5) / log(clamp(uVisDevMids[i], 0.02, 0.98)));
      f += (f * f * (3.0 - 2.0 * f) - f) * clamp(uVisDevStopInfo.y, 0.0, 1.0);
      c = mix(a.rgb, b.rgb, f);
      break;
    }
  }
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
vec3 visDevNormalAt(vec2 uv, vec4 centre) {
  vec4 s = texture2D(tVisDevNormals, uv);
  // nothing drawn there, or another surface (a jump in depth): no bend
  return (s.a <= 0.0 || abs(s.a - centre.a) > centre.a * 0.04 + 0.2) ? centre.xyz : s.xyz;
}
/** Blender's cavity (screen space curvature): + on ridges, - in valleys. */
float visDevCavity() {
  if (uVisDevCavity.x <= 0.0 && uVisDevCavity.y <= 0.0) return 0.0;
  vec2 px = 1.0 / uVisDevView.zw;
  vec2 uv = (gl_FragCoord.xy - uVisDevView.xy) * px;
  vec4 c = texture2D(tVisDevNormals, uv);
  if (c.a <= 0.0) return 0.0;
  vec2 o = uVisDevCavity.z * px;
  vec3 l = visDevNormalAt(uv - vec2(o.x, 0.0), c), r = visDevNormalAt(uv + vec2(o.x, 0.0), c);
  vec3 d = visDevNormalAt(uv - vec2(0.0, o.y), c), u = visDevNormalAt(uv + vec2(0.0, o.y), c);
  return (r.x - l.x) + (u.y - d.y);
}
vec3 visDevAlbedo(vec3 albedo, vec3 n) {
  if (uVisDevOn < 0.5 || vVisDev.y < 0.5) return albedo;
  // the fill: a colour, or a gradient placed by the geometry
  if (uVisDevFill.x > 0.5) {
    float t = 0.0;
    if (uVisDevFill.x > 1.5 && uVisDevFill.x < 2.5) {
      vec3 d = uVisDevDir;
      t = dot(vVisDevPos - 0.5, d) / max(0.5 * (abs(d.x) + abs(d.y) + abs(d.z)), 1e-4) * 0.5 + 0.5;
    } else if (uVisDevFill.x > 2.5 && uVisDevFill.x < 3.5) t = length(vVisDevPos - uVisDevCentre.xyz) / max(uVisDevCentre.w, 1e-3);
    else if (uVisDevFill.x > 3.5) t = dot(n, uVisDevDir) * 0.5 + 0.5;
    vec3 fill = visDevRamp(clamp(t, 0.0, 1.0));
    albedo = mix(albedo, uVisDevFill.z > 0.5 ? albedo * fill : fill, uVisDevFill.y);
  }
  float up = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
  albedo *= mix(1.0 - 0.75 * uVisDevA.x, 1.0 + 0.35 * uVisDevA.x, up);
  albedo *= mix(1.0, clamp(vVisDev.x, 0.0, 1.0), uVisDevA.y);
  float cav = visDevCavity();
  albedo = mix(albedo, min(albedo * 1.8 + 0.05, vec3(1.0)), clamp(cav, 0.0, 1.0) * uVisDevCavity.x);
  albedo *= 1.0 - clamp(-cav, 0.0, 1.0) * uVisDevCavity.y;
  return albedo;
}
`;

// --- the bake ---

interface Part { positions: ArrayLike<number>; normals: ArrayLike<number>; indices: ArrayLike<number> }

/** A bounding volume tree over triangles, for "does anything lie within this distance along this ray". */
class Bvh {
  private readonly tri: Float32Array; // 9 floats a triangle
  private readonly order: Uint32Array;
  private readonly nodes: number[] = []; // per node: min xyz, max xyz, left/first, right/count (leaf when count > 0 marked by negative)
  constructor(tri: Float32Array) {
    this.tri = tri;
    const n = tri.length / 9;
    this.order = new Uint32Array(n).map((_, i) => i);
    const cent = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) cent[i * 3 + a] = (tri[i * 9 + a] + tri[i * 9 + 3 + a] + tri[i * 9 + 6 + a]) / 3;
    this.build(cent, 0, n);
  }
  private build(cent: Float32Array, start: number, end: number): number {
    const at = this.nodes.length / 8;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    const clo = [Infinity, Infinity, Infinity], chi = [-Infinity, -Infinity, -Infinity];
    for (let i = start; i < end; i++) {
      const t = this.order[i];
      for (let v = 0; v < 3; v++) for (let a = 0; a < 3; a++) { const x = this.tri[t * 9 + v * 3 + a]; if (x < lo[a]) lo[a] = x; if (x > hi[a]) hi[a] = x; }
      for (let a = 0; a < 3; a++) { const c = cent[t * 3 + a]; if (c < clo[a]) clo[a] = c; if (c > chi[a]) chi[a] = c; }
    }
    this.nodes.push(lo[0], lo[1], lo[2], hi[0], hi[1], hi[2], 0, 0);
    if (end - start <= 4) { this.nodes[at * 8 + 6] = start; this.nodes[at * 8 + 7] = -(end - start); return at; }
    const axis = chi[0] - clo[0] >= chi[1] - clo[1] && chi[0] - clo[0] >= chi[2] - clo[2] ? 0 : chi[1] - clo[1] >= chi[2] - clo[2] ? 1 : 2;
    const mid = (clo[axis] + chi[axis]) / 2;
    let i = start, j = end - 1;
    while (i <= j) {
      if (cent[this.order[i] * 3 + axis] < mid) i++;
      else { const s = this.order[i]; this.order[i] = this.order[j]; this.order[j] = s; j--; }
    }
    if (i === start || i === end) i = (start + end) >> 1;
    const left = this.build(cent, start, i);
    const right = this.build(cent, i, end);
    this.nodes[at * 8 + 6] = left;
    this.nodes[at * 8 + 7] = right;
    return at;
  }
  private readonly stack = new Int32Array(128);
  /** Whether a triangle lies along the ray between tMin and tMax. */
  occluded(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, tMin: number, tMax: number): boolean {
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
    const nodes = this.nodes, tri = this.tri, stack = this.stack;
    let sp = 0;
    stack[sp++] = 0;
    while (sp > 0) {
      const n = stack[--sp] * 8;
      let t0 = tMin, t1 = tMax;
      let a = (nodes[n] - ox) * ix, b = (nodes[n + 3] - ox) * ix;
      if (a > b) { const s = a; a = b; b = s; }
      if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) continue;
      a = (nodes[n + 1] - oy) * iy; b = (nodes[n + 4] - oy) * iy;
      if (a > b) { const s = a; a = b; b = s; }
      if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) continue;
      a = (nodes[n + 2] - oz) * iz; b = (nodes[n + 5] - oz) * iz;
      if (a > b) { const s = a; a = b; b = s; }
      if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) continue;
      const count = nodes[n + 7];
      if (count <= 0) {
        for (let k = nodes[n + 6], e = k - count; k < e; k++) {
          const t = this.order[k] * 9;
          const e1x = tri[t + 3] - tri[t], e1y = tri[t + 4] - tri[t + 1], e1z = tri[t + 5] - tri[t + 2];
          const e2x = tri[t + 6] - tri[t], e2y = tri[t + 7] - tri[t + 1], e2z = tri[t + 8] - tri[t + 2];
          const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
          const det = e1x * px + e1y * py + e1z * pz;
          if (det > -1e-9 && det < 1e-9) continue;
          const inv = 1 / det;
          const sx = ox - tri[t], sy = oy - tri[t + 1], sz = oz - tri[t + 2];
          const u = (sx * px + sy * py + sz * pz) * inv;
          if (u < 0 || u > 1) continue;
          const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
          const v = (dx * qx + dy * qy + dz * qz) * inv;
          if (v < 0 || u + v > 1) continue;
          const hit = (e2x * qx + e2y * qy + e2z * qz) * inv;
          if (hit > tMin && hit < tMax) return true;
        }
      } else {
        stack[sp++] = nodes[n + 6];
        stack[sp++] = count;
      }
    }
    return false;
  }
}

/** Directions spread evenly over the sphere. */
function sphereDirections(count: number): Float32Array {
  const out = new Float32Array(count * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (2 * (i + 0.5)) / count;
    const r = Math.sqrt(1 - y * y);
    out[i * 3] = Math.cos(golden * i) * r; out[i * 3 + 1] = y; out[i * 3 + 2] = Math.sin(golden * i) * r;
  }
  return out;
}

/**
 * Per vertex of each part (which share one space: the meshes of one model): occlusion (1 open, 0 shut in) with a 1 that says it is
 * baked, and the vertex's place in the bounds of all of them (0..1 on each axis). Vertices at one position count as one (hard edges).
 * Runs in slices and yields between them; `cancelled` stops it (null is returned).
 */
export async function bakeVisDev(parts: Part[], aoDistance: number, cancelled: () => boolean = () => false): Promise<{ occlusion: Float32Array; place: Float32Array }[] | null> {
  // weld: one point per position
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) for (let i = 0; i < p.positions.length; i += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p.positions[i + a]); hi[a] = Math.max(hi[a], p.positions[i + a]); }
  const diag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
  const q = diag * 1e-5;
  const ids = new Map<string, number>();
  const pos: number[] = [], nrm: number[] = [];
  const remap = parts.map((p) => {
    const out = new Uint32Array(p.positions.length / 3);
    for (let v = 0; v < out.length; v++) {
      const x = p.positions[v * 3], y = p.positions[v * 3 + 1], z = p.positions[v * 3 + 2];
      const key = `${Math.round(x / q)},${Math.round(y / q)},${Math.round(z / q)}`;
      let id = ids.get(key);
      if (id === undefined) { id = pos.length / 3; ids.set(key, id); pos.push(x, y, z); nrm.push(0, 0, 0); }
      nrm[id * 3] += p.normals[v * 3]; nrm[id * 3 + 1] += p.normals[v * 3 + 1]; nrm[id * 3 + 2] += p.normals[v * 3 + 2];
      out[v] = id;
    }
    return out;
  });
  const count = pos.length / 3;
  for (let i = 0; i < count; i++) {
    const l = Math.hypot(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]) || 1;
    nrm[i * 3] /= l; nrm[i * 3 + 1] /= l; nrm[i * 3 + 2] /= l;
  }
  // the triangles for the rays
  let triCount = 0;
  for (const p of parts) triCount += Math.floor(p.indices.length / 3);
  const tri = new Float32Array(triCount * 9);
  let t = 0;
  parts.forEach((p, pi) => {
    for (let i = 0; i + 2 < p.indices.length; i += 3) {
      const a = remap[pi][p.indices[i]], b = remap[pi][p.indices[i + 1]], c = remap[pi][p.indices[i + 2]];
      for (const [k, id] of [a, b, c].entries()) for (let x = 0; x < 3; x++) tri[t * 9 + k * 3 + x] = pos[id * 3 + x];
      t++;
    }
  });
  // occlusion: cosine weighted rays over the hemisphere of each vertex
  const bvh = new Bvh(tri);
  const dirs = sphereDirections(96);
  const ao = new Float32Array(count);
  const bias = diag * 2e-3;
  let slice = performance.now();
  for (let i = 0; i < count; i++) {
    if (performance.now() - slice > 12) {
      await new Promise((r) => setTimeout(r, 0));
      if (cancelled()) return null;
      slice = performance.now();
    }
    const nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2];
    const ox = pos[i * 3] + nx * bias, oy = pos[i * 3 + 1] + ny * bias, oz = pos[i * 3 + 2] + nz * bias;
    let open = 0, total = 0;
    for (let d = 0; d < dirs.length; d += 3) {
      const w = dirs[d] * nx + dirs[d + 1] * ny + dirs[d + 2] * nz;
      if (w <= 0.05) continue;
      total += w;
      if (!bvh.occluded(ox, oy, oz, dirs[d], dirs[d + 1], dirs[d + 2], bias, aoDistance)) open += w;
    }
    ao[i] = total ? open / total : 1;
  }
  // the fill's place on the item: where each vertex is in the item's bounds
  const size = [hi[0] - lo[0] || 1, hi[1] - lo[1] || 1, hi[2] - lo[2] || 1];
  return parts.map((p, pi) => {
    const ids = remap[pi];
    const occlusion = new Float32Array(ids.length * 2), place = new Float32Array(ids.length * 3);
    for (let v = 0; v < ids.length; v++) {
      occlusion[v * 2] = ao[ids[v]]; occlusion[v * 2 + 1] = 1;
      for (let a = 0; a < 3; a++) place[v * 3 + a] = (p.positions[v * 3 + a] - lo[a]) / size[a];
    }
    return { occlusion, place };
  });
}
