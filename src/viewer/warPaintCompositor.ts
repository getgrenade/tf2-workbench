import * as THREE from "three";
import { resolvePaintKit, UniformRandomStream, type PaintKitDefs, type StageNode } from "./warPaints";

/**
 * Paints a weapon's skin from a war paint, on the GPU: the texture compositor's stages (texture, combine add / lerp / multiply, select,
 * sticker) with the math of stdshaders/compositor_ps2x.fxc, on the game's own pattern and weapon mask textures. The result is the weapon's
 * base texture: its colour, and in its alpha the phong mask (the stickers' spec maps).
 *
 * Ported from the Mann-ual's war paint window (web/wpi.js).
 */

export interface WarPaint {
  /** The paint kit (proto def index). */
  kit: number;
  /** 1 (Factory New) to 5 (Battle Scarred). */
  wear: number;
  /** As the game shows it: a 64-bit number, as text. */
  seed: string;
}

/** A decoded game texture (RGBA8, its first frame). */
export interface TextureRgba {
  width: number;
  height: number;
  rgba: Uint8Array;
}

const VERTEX = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const FRAGMENT = `precision highp float;
varying vec2 vUv;
uniform sampler2D t0, t1, t2, t3;
uniform mat3 m0, m1, m2, m3;
uniform vec3 a0, a1, a2, a3;
uniform int n, mode;
uniform float sel[16];
uniform vec2 sTL, sTR, sBL;
uniform float hasSpec;
vec3 l2s(vec3 c) { return mix(12.92 * c, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
vec3 s2l(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }
// levels (black point, white point, gamma), applied in gamma space as the compositor does
vec4 adj(vec4 c, vec3 a) {
  if (a.x == 0.0 && a.y == 1.0 && a.z == 1.0) return c;
  c = vec4(l2s(c.rgb), c.a);
  float dd = a.y - a.x; if (abs(dd) < 1e-5) dd = 1e-5;
  vec4 p = clamp((c - a.x) / dd, 0.0, 1.0);
  p = pow(p, vec4(a.z));
  return clamp(vec4(s2l(p.rgb), p.a), 0.0, 1.0);
}
vec4 S(sampler2D t, mat3 m, vec3 a) { return adj(texture2D(t, (m * vec3(vUv, 1.0)).xy), a); }
void main() {
  if (mode == 3) {
    // select: the weapon mask's groups (its red channel in steps of 16) that are kept
    float g = floor(texture2D(t0, vUv).x * 255.0 / 16.0 + 0.5);
    bool any = false;
    for (int i = 0; i < 16; i++) { if (sel[i] != 0.0 && floor(sel[i] + 0.5) == g) any = true; }
    gl_FragColor = any ? vec4(1.0) : vec4(0.0);
    return;
  }
  if (mode == 6) {
    // sticker: a picture laid in the parallelogram top-left / top-right / bottom-left, its spec map into the alpha
    vec4 c0 = S(t0, m0, a0);
    vec2 e1 = sTR - sTL, e2 = sBL - sTL, d = vUv - sTL;
    float det = e1.x * e2.y - e1.y * e2.x;
    vec2 st = vec2(d.x * e2.y - d.y * e2.x, e1.x * d.y - e1.y * d.x) / det;
    vec4 c1 = vec4(0.0); float sp = 1.0;
    if (all(greaterThanEqual(st, vec2(0.0))) && all(lessThanEqual(st, vec2(1.0)))) { c1 = adj(texture2D(t1, st), a1); if (hasSpec > 0.5) sp = texture2D(t2, st).r; }
    gl_FragColor = vec4((1.0 - c1.a) * c0.rgb + c1.a * c1.rgb, (1.0 - c1.a) * c0.a + c1.a * sp);
    return;
  }
  vec4 c0 = n > 0 ? S(t0, m0, a0) : vec4(0.0), c1 = n > 1 ? S(t1, m1, a1) : vec4(0.0), c2 = n > 2 ? S(t2, m2, a2) : vec4(0.0), c3 = n > 3 ? S(t3, m3, a3) : vec4(0.0);
  if (mode == 0) { vec4 r = c0; if (n > 1) r *= c1; if (n > 2) r *= c2; if (n > 3) r *= c3; gl_FragColor = r; }
  else if (mode == 1) gl_FragColor = c0 + c1 + c2 + c3;
  else if (mode == 2) gl_FragColor = n == 3 ? mix(c0, c1, c2.xxxx) : vec4(1.0, 0.0, 0.0, 1.0);
  else gl_FragColor = c0;
}`;

interface Sample { t: THREE.Texture; m: THREE.Matrix3; a: THREE.Vector3 }
const IDENTITY = () => new THREE.Matrix3();
const NO_LEVELS = () => new THREE.Vector3(0, 1, 1);

export class WarPaintCompositor {
  private readonly textures = new Map<string, Promise<THREE.Texture | null>>();
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly white: THREE.DataTexture;
  private readonly black: THREE.DataTexture;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly defs: PaintKitDefs,
    /** Reads a game texture (`patterns/...`, without `materials/` or `.vtf`), or null when it is missing. */
    private readonly readTexture: (path: string) => Promise<TextureRgba | null>,
  ) {
    const u: Record<string, THREE.IUniform> = { n: { value: 0 }, mode: { value: 0 }, sel: { value: new Array(16).fill(0) }, sTL: { value: new THREE.Vector2() }, sTR: { value: new THREE.Vector2() }, sBL: { value: new THREE.Vector2() }, hasSpec: { value: 0 } };
    for (let i = 0; i < 4; i++) { u[`t${i}`] = { value: null }; u[`m${i}`] = { value: IDENTITY() }; u[`a${i}`] = { value: NO_LEVELS() }; }
    this.uniforms = u;
    const material = new THREE.ShaderMaterial({ uniforms: u, vertexShader: VERTEX, fragmentShader: FRAGMENT, depthTest: false, depthWrite: false });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    quad.frustumCulled = false;
    this.scene.add(quad);
    this.white = pixel([255, 255, 255, 255]);
    this.black = pixel([0, 0, 0, 0]);
  }

  /** A game texture as the compositor samples it: a picture repeats and is read in sRGB; a weapon's group mask is read as it is stored. */
  private texture(path: string, raw = false): Promise<THREE.Texture | null> {
    const key = `${path.toLowerCase().replace(/\\/g, "/").replace(/\.(tga|vtf|psd)$/, "")}${raw ? "#raw" : ""}`;
    let p = this.textures.get(key);
    if (!p) {
      p = this.readTexture(key.replace(/#raw$/, "")).then((img) => {
        if (!img) return null;
        const t = new THREE.DataTexture(img.rgba as Uint8Array<ArrayBuffer>, img.width, img.height, THREE.RGBAFormat);
        t.flipY = false;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        if (raw) {
          t.minFilter = t.magFilter = THREE.NearestFilter;
          t.generateMipmaps = false;
        } else {
          t.colorSpace = THREE.SRGBColorSpace;
          t.anisotropy = 8;
          t.magFilter = THREE.LinearFilter;
          t.minFilter = THREE.LinearMipmapLinearFilter;
          t.generateMipmaps = true;
        }
        t.needsUpdate = true;
        return t;
      }).catch(() => null);
      this.textures.set(key, p);
    }
    return p;
  }

  /**
   * The weapon's skin for a war paint, at its wear, for a team, from a seed: a texture of `size` × `size` (the caller disposes of it), or
   * null when the paint kit has nothing for this weapon.
   */
  async composite(weapon: string, paint: WarPaint, team: "RED" | "BLU", seed: number, size = 1024): Promise<THREE.Texture | null> {
    const resolved = resolvePaintKit(this.defs, paint.kit, weapon, paint.wear);
    if (!resolved) return null;
    const { op, vars } = resolved;
    const rng = new UniformRandomStream(seed);
    const targets: THREE.WebGLRenderTarget[] = [];
    // a value: a variable's (followed through the ones it names) or itself
    const value = (s: string | undefined): string => {
      let x = s ?? "";
      for (let g = 0; x.startsWith("$") && g < 8; g++) x = vars[x.slice(1)] ?? "";
      return x;
    };
    // a number, or a random one in "lo hi" (ParseRangeFromKV)
    const range = (s: string | undefined): number | null => {
      const a = value(s).trim().split(/\s+/).map(Number).filter((x) => !Number.isNaN(x));
      if (!a.length) return null;
      return a.length > 1 ? rng.float(a[0], a[1]) : a[0];
    };
    const params = (f: Record<string, string>): { m: THREE.Matrix3; a: THREE.Vector3 } => {
      const b = f.adjust_black !== undefined ? range(f.adjust_black) : null;
      const w = f.adjust_offset !== undefined ? range(f.adjust_offset) : null;
      const g = f.adjust_gamma !== undefined ? range(f.adjust_gamma) : null;
      // adjust_offset is the white point's distance from adjust_black (Photoshop's levels: in-black, in-black + offset)
      const bb = b ?? 0, ww = w ?? 255 - bb;
      const a = new THREE.Vector3(bb / 255, (bb + ww) / 255, g === null || g === 0 ? 1 : 1 / g);
      const rot = f.rotation !== undefined ? range(f.rotation) ?? 0 : 0;
      const tu = f.translate_u !== undefined ? range(f.translate_u) ?? 0 : 0;
      const tv = f.translate_v !== undefined ? range(f.translate_v) ?? 0 : 0;
      const sc = (f.scale_uv !== undefined ? range(f.scale_uv) : 1) || 1;
      const fu = f.flip_u !== undefined && /^(1|true)$/i.test(value(f.flip_u));
      const fv = f.flip_v !== undefined && /^(1|true)$/i.test(value(f.flip_v));
      const c = Math.cos((rot * Math.PI) / 180), s = Math.sin((rot * Math.PI) / 180);
      // uv' = R(rot) · (uv · scale) + translate; the flips mirror it
      const m = new THREE.Matrix3().set(c * sc * (fu ? -1 : 1), -s * sc * (fu ? -1 : 1), tu, s * sc * (fv ? -1 : 1), c * sc * (fv ? -1 : 1), tv, 0, 0, 1);
      return { m, a };
    };
    const pass = (mode: number, inputs: Sample[], extra?: (u: Record<string, THREE.IUniform>) => void): THREE.Texture => {
      const u = this.uniforms;
      u.mode.value = mode;
      u.n.value = inputs.length;
      for (let i = 0; i < 4; i++) {
        const s = inputs[i];
        u[`t${i}`].value = s?.t ?? this.white;
        u[`m${i}`].value = s?.m ?? IDENTITY();
        u[`a${i}`].value = s?.a ?? NO_LEVELS();
      }
      extra?.(u);
      const rt = new THREE.WebGLRenderTarget(size, size, { type: THREE.HalfFloatType, depthBuffer: false, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
      targets.push(rt);
      const before = this.renderer.getRenderTarget();
      this.renderer.setRenderTarget(rt);
      this.renderer.render(this.scene, this.camera);
      this.renderer.setRenderTarget(before);
      return rt.texture;
    };
    const plain = (t: THREE.Texture): Sample => ({ t, m: IDENTITY(), a: NO_LEVELS() });
    const evaluate = async (node: StageNode): Promise<Sample> => {
      if (node[0] === "@") return evaluate(this.defs.ops.get(node[1])!.nodes[0]);
      if (node[0] === "T") {
        const f = node[1];
        let path = f.texture;
        if (team === "BLU" && f.texture_blue) path = f.texture_blue;
        else if (f.texture_red && (!f.texture || team === "RED")) path = f.texture_red;
        const p = params(f);
        return { t: (await this.texture(value(path))) ?? this.white, m: p.m, a: p.a };
      }
      if (node[0] === "sel") {
        const groups = await this.texture(value(node[1]), true);
        const kept = new Array(16).fill(0);
        node[2].forEach((s, i) => { if (i < 16) kept[i] = (Number(value(s)) || 0) / 16; });
        return plain(pass(3, [plain(groups ?? this.black)], (u) => { u.sel.value = kept; }));
      }
      if (node[0] === "stk") {
        const p = params(node[1]);
        const base = await evaluate(node[3][0]);
        // one sticker of the list, picked by weight
        let total = 0;
        const weights = node[2].map((s) => { const w = Number(value(s.weight ?? "1")) || 1; total += w; return w; });
        let pick = rng.float(0, total), si = 0;
        for (; si < weights.length - 1; si++) { if (pick < weights[si]) break; pick -= weights[si]; }
        const s = node[2][si] ?? {};
        const basePath = value(s.base);
        const sticker = await this.texture(basePath);
        const spec = s.spec ? await this.texture(value(s.spec)) : await this.texture(basePath.replace(/(\.[a-z]+)?$/i, "_spec"));
        const v2 = (x: string) => { const a = value(x).split(/\s+/).map(Number); return new THREE.Vector2(a[0] || 0, a[1] || 0); };
        const t = pass(6, [base, plain(sticker ?? this.black), plain(spec ?? this.white)], (u) => {
          u.sTL.value = v2(node[1].dest_tl ?? "0 0");
          u.sTR.value = v2(node[1].dest_tr ?? "1 0");
          u.sBL.value = v2(node[1].dest_bl ?? "0 1");
          u.hasSpec.value = spec ? 1 : 0;
        });
        return { t, m: p.m, a: p.a };
      }
      // combine_add / combine_lerp / combine_multiply
      const p = params(node[1]);
      const kids: Sample[] = [];
      for (const c of node[2]) kids.push(await evaluate(c));
      const mode = ({ add: 1, lerp: 2, multiply: 0 } as const)[node[0]];
      let t: THREE.Texture;
      if (mode === 2 || kids.length <= 4) t = pass(mode, kids.slice(0, mode === 2 ? 3 : 4));
      else {
        t = pass(mode, kids.slice(0, 4));
        for (let i = 4; i < kids.length; i += 3) t = pass(mode, [plain(t), ...kids.slice(i, i + 3)]);
      }
      return { t, m: p.m, a: p.a };
    };
    let result: THREE.Texture;
    try {
      const root = await evaluate(this.defs.ops.get(op)!.nodes[0]);
      result = pass(9, [root]);
    } catch (err) {
      for (const rt of targets) rt.dispose();
      throw err;
    }
    // every pass but the last is let go; the last becomes the weapon's base texture (sampled with mipmaps, repeating like the original)
    const keep = targets.find((rt) => rt.texture === result)!;
    for (const rt of targets) if (rt !== keep) rt.dispose();
    const out = keep.texture;
    out.userData.dispose = () => keep.dispose();
    return out;
  }

  /** Lets go of the game textures read so far. */
  dispose() {
    for (const p of this.textures.values()) void p.then((t) => t?.dispose());
    this.textures.clear();
    this.white.dispose();
    this.black.dispose();
  }
}

function pixel(c: number[]): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array(c), 1, 1);
  t.needsUpdate = true;
  return t;
}
