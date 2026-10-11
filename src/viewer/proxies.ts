/**
 * Evaluation of VMT material proxies, ported from the Source SDK 2013:
 *  - math proxies (game/client/mathproxy.cpp): Add, Subtract, Multiply, Divide, Clamp, Equals, Frac, Int, Abs,
 *    Sine, LinearRamp, UniformNoise, LessOrEqual, SelectFirstIfNonZero
 *  - variable access (game/client/functionproxy.cpp): result variables keep their type (float / vector), a
 *    scalar result written to a vector fills every component, `$var[n]` addresses one component, and
 *    variables that do not exist yet are created by the first write
 *  - TextureScroll (texturescrollmaterialproxy.cpp) and TextureTransform (matrixproxy.cpp)
 *  - item paints: ItemTintColor (econ_wearable.cpp), YellowLevel (c_tf_player.cpp)
 *
 * Paintable items chain the tint proxies to produce `$color2` (paint if set, else the item's `$colortint_base`);
 * the shader applies it according to `$blendtintbybasealpha` / `$blendtintcoloroverbase`. Time driven proxies
 * (Sine, LinearRamp, TextureScroll, ...) are re-evaluated every frame by the viewer. Proxies that need game
 * state (cloaking, burning, invulnerability, ...) read their idle values; animated texture frames are not
 * supported.
 */

export interface ProxyDef {
  name: string;
  params: Record<string, string>;
}

export type Rgb = [number, number, number];

/**
 * What the player state proxies of c_tf_player.cpp read from the character: YellowLevel (Jarate: (6,9,2) on RED, (7,5,1) on BLU),
 * ModelGlowColor (crit boost: (80,8,5) / (5,20,80)), BurnLevel (0..1) and InvulnLevel (1 on the uber material, 0 elsewhere).
 */
export interface MaterialEffects {
  yellow?: Rgb;
  glow?: Rgb;
  burn?: number;
  invuln?: number;
}

export interface TintContext {
  /** The character's state, for the proxies that read it. */
  fx?: MaterialEffects;
  /** Paint colour, 0..1 per channel, or null when the item is unpainted. */
  paint: Rgb | null;
  /** The engine clock in seconds (`gpGlobals->curtime`); 0 for a still evaluation. */
  time?: number;
}

type Vec = number[];

/**
 * Parses a VMT value into numbers: `{r g b}` is 0-255 (scaled to 0-1), `[a b c]` are floats, a plain
 * number is a scalar. Returns null for anything else (texture names etc.).
 */
export function parseVmtValue(value: string): Vec | null {
  const v = value.trim();
  const body = v.replace(/[[\]{}]/g, " ").trim();
  if (body === "") return null;
  const nums = body.split(/\s+/).map(Number);
  if (nums.some((n) => Number.isNaN(n))) return null;
  return v.startsWith("{") ? nums.map((n) => n / 255) : nums;
}

// ---- 2D texture transforms ---------------------------------------------------------------------------------------

/** A 2x3 affine texture matrix, row major: `u' = m0 u + m1 v + m2`, `v' = m3 u + m4 v + m5`. */
export type TexMatrix = [number, number, number, number, number, number];
export const IDENTITY_TEX: TexMatrix = [1, 0, 0, 0, 1, 0];

/** `a * b`: apply `b` first, then `a` (VMatrix multiplication). */
function mulTex(a: TexMatrix, b: TexMatrix): TexMatrix {
  return [
    a[0] * b[0] + a[1] * b[3], a[0] * b[1] + a[1] * b[4], a[0] * b[2] + a[1] * b[5] + a[2],
    a[3] * b[0] + a[4] * b[3], a[3] * b[1] + a[4] * b[4], a[3] * b[2] + a[4] * b[5] + a[5],
  ];
}
const translateTex = (x: number, y: number): TexMatrix => [1, 0, x, 0, 1, y];
const scaleTex = (x: number, y: number): TexMatrix => [x, 0, 0, 0, y, 0];
function rotateTex(degrees: number): TexMatrix {
  const r = (degrees * Math.PI) / 180;
  return [Math.cos(r), -Math.sin(r), 0, Math.sin(r), Math.cos(r), 0];
}

/** `TextureTransform`'s construction: translate(translate) * translate(center) * rotate * scale * translate(-center). */
export function buildTexTransform(center: [number, number], scale: [number, number], rotate: number, translate: [number, number]): TexMatrix {
  let m = translateTex(-center[0], -center[1]);
  m = mulTex(scaleTex(scale[0], scale[1]), m);
  m = mulTex(rotateTex(rotate), m);
  m = mulTex(translateTex(center[0], center[1]), m);
  return mulTex(translateTex(translate[0], translate[1]), m);
}

/**
 * Parses a transform parameter: `center .5 .5 scale 1 1 rotate 0 translate 0 0` (any subset, any order) or a
 * 4x4 matrix literal `[ a b c d ... ]`. Returns null for anything else.
 */
export function parseTexTransform(value: string): TexMatrix | null {
  const tokens = value.trim().replace(/[[\]{}]/g, " ").split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  if (tokens.every((t) => !Number.isNaN(Number(t)))) {
    if (tokens.length !== 16) return null;
    const n = tokens.map(Number); // row major 4x4: the first two rows hold the u / v transform
    return [n[0], n[1], n[3], n[4], n[5], n[7]];
  }
  let center: [number, number] = [0.5, 0.5];
  let scale: [number, number] = [1, 1];
  let rotate = 0;
  let translate: [number, number] = [0, 0];
  for (let i = 0; i < tokens.length; i++) {
    const num = (k: number) => Number(tokens[i + k] ?? 0) || 0;
    switch (tokens[i].toLowerCase()) {
      case "center": center = [num(1), num(2)]; i += 2; break;
      case "scale": scale = [num(1), num(2)]; i += 2; break;
      case "rotate": rotate = num(1); i += 1; break;
      case "translate": translate = [num(1), num(2)]; i += 2; break;
      default: return null;
    }
  }
  return buildTexTransform(center, scale, rotate, translate);
}

const isMatrixKey = (key: string) => key.endsWith("transform");

// ---- variables ---------------------------------------------------------------------------------------------------

/** A material variable reference as proxies write it: `$name` or `$name[component]`. */
function splitRef(ref: string): { name: string; comp: number } {
  const m = /^(.*?)\s*\[\s*(\d+)\s*\]\s*$/.exec(ref.trim());
  return m ? { name: m[1].toLowerCase(), comp: Number(m[2]) } : { name: ref.trim().toLowerCase(), comp: -1 };
}

class Vars {
  /** Float and vector variables (a float is a one element array). Matrix variables are in `mats`. */
  readonly nums = new Map<string, Vec>();
  readonly mats = new Map<string, TexMatrix>();

  /** `GetFloatValue`: a vector reads its first component, a missing variable reads 0. */
  float(name: string): number {
    return this.nums.get(name)?.[0] ?? 0;
  }

  /** `GetVecValue( v, size )`: a float is broadcast to every component. */
  vec(name: string, size: number): Vec {
    const v = this.nums.get(name);
    return Array.from({ length: size }, (_, i) => (v === undefined ? 0 : v.length === 1 ? v[0] : v[i] ?? 0));
  }

  size(name: string): number {
    return this.nums.get(name)?.length ?? 0;
  }

  /** A `CFloatInput`: a literal number, or a variable (optionally one component of it). */
  input(raw: string | undefined, fallback: number): number {
    if (raw === undefined) return fallback;
    const lit = parseFloat(raw);
    if (!Number.isNaN(lit)) return lit;
    const { name, comp } = splitRef(raw);
    if (comp < 0) return this.float(name);
    const v = this.nums.get(name);
    return v === undefined ? 0 : comp >= v.length ? 0 : v[comp];
  }

  /** `CResultProxy::SetFloatResult`. */
  setFloat(ref: string, value: number) {
    const { name, comp } = splitRef(ref);
    const cur = this.nums.get(name);
    if (cur && cur.length > 1) {
      if (comp >= 0) cur[comp] = value;
      else cur.fill(value);
    } else {
      this.nums.set(name, [value]);
    }
  }

  /** Writes a vector result, keeping the result's existing size when it has one. */
  setVec(ref: string, value: Vec) {
    const { name } = splitRef(ref);
    this.nums.set(name, [...value]);
  }
}

/** `ComputeResultType`: what a function proxy produces, given the result variable and its sources. */
function resultShape(vars: Vars, resultRef: string, ...sources: (string | undefined)[]): { vec: boolean; size: number } {
  const { name, comp } = splitRef(resultRef);
  const size = vars.size(name);
  if (size > 1) return comp >= 0 ? { vec: false, size: 1 } : { vec: true, size };
  if (size === 1) return { vec: false, size: 1 };
  // undefined result: take the type of the first source that exists
  for (const s of sources) {
    if (s === undefined) continue;
    const n = vars.size(splitRef(s).name);
    if (n > 1) return { vec: true, size: n };
    if (n === 1) return { vec: false, size: 1 };
  }
  return { vec: false, size: 1 };
}

/** The proxies that make a material change with time; everything else only needs evaluating once. */
const TIME_PROXIES = new Set(["sine", "linearramp", "uniformnoise", "texturescroll"]);

/** How a material animates the frames of its base texture (`AnimatedTexture` with `animatedtexturevar $basetexture`). */
export interface FrameAnimation {
  /** Frames per second (`animatedtextureframerate`, default 15). */
  rate: number;
  /** `animationnowrap`: stop on the last frame instead of looping. */
  noWrap: boolean;
}

/** The animation of a material's base texture (or of the texture in another slot, like $bumpmap), or null when it has none. */
export function baseTextureAnimation(proxies: ProxyDef[], variable = "$basetexture"): FrameAnimation | null {
  const p = proxies.find((x) => x.name === "animatedtexture" && x.params["animatedtexturevar"]?.toLowerCase() === variable);
  if (!p) return null;
  const rate = parseFloat(p.params["animatedtextureframerate"] ?? "");
  return { rate: Number.isNaN(rate) ? 15 : rate, noWrap: Number(p.params["animationnowrap"] ?? 0) !== 0 };
}

/** The frame to show at `time` seconds (`CBaseAnimatedTextureProxy::OnBind`: `(int)(rate * time) % frames`). */
export function animationFrame(anim: FrameAnimation, time: number, frames: number): number {
  if (frames <= 1) return 0;
  const f = Math.floor(Math.max(time, 0) * anim.rate);
  return anim.noWrap ? Math.min(f, frames - 1) : f % frames;
}

/** Whether any proxy of the material depends on the clock (so the viewer must re-evaluate it each frame). */
export function hasTimeProxies(proxies: ProxyDef[]): boolean {
  return proxies.some((p) => TIME_PROXIES.has(p.name));
}

/**
 * Runs the proxies of a material in file order (the engine runs them every frame) and returns the resulting
 * material variables, keyed by lowercase name including the `$`. Transform variables (`$basetexturetransform`
 * and friends) hold their six matrix coefficients (see {@link TexMatrix}).
 */
export function evaluateMaterialVars(params: Record<string, string>, proxies: ProxyDef[], ctx: TintContext): Record<string, Vec> {
  const vars = new Vars();
  for (const [k, v] of Object.entries(params)) {
    if (!k.startsWith("$")) continue;
    const key = k.toLowerCase();
    if (isMatrixKey(key)) {
      const m = parseTexTransform(v);
      if (m) vars.mats.set(key, m);
      continue;
    }
    const parsed = parseVmtValue(v);
    if (parsed) vars.nums.set(key, parsed);
  }
  if (!vars.nums.has("$color")) vars.nums.set("$color", [1, 1, 1]);
  if (!vars.nums.has("$color2")) vars.nums.set("$color2", [1, 1, 1]);
  const time = ctx.time ?? 0;

  for (const proxy of proxies) runProxy(vars, proxy, ctx, time);

  const out: Record<string, Vec> = Object.fromEntries(vars.nums);
  for (const [k, m] of vars.mats) out[k] = [...m];
  return out;
}

function runProxy(vars: Vars, proxy: ProxyDef, ctx: TintContext, time: number) {
  const p = proxy.params;
  const result = p["resultvar"];
  const src1 = p["srcvar1"];
  const src2 = p["srcvar2"];
  const f = (ref: string | undefined) => (ref === undefined ? 0 : vars.float(splitRef(ref).name));

  /** Applies `op` to a pair of sources, component-wise when the result is a vector. */
  const binary = (op: (a: number, b: number) => number) => {
    if (result === undefined || src1 === undefined || src2 === undefined) return;
    const shape = resultShape(vars, result, src1, src2);
    if (shape.vec) {
      const a = vars.vec(splitRef(src1).name, shape.size);
      const b = vars.vec(splitRef(src2).name, shape.size);
      vars.setVec(result, a.map((x, i) => op(x, b[i])));
    } else {
      vars.setFloat(result, op(f(src1), f(src2)));
    }
  };
  /** Applies `op` to one source. */
  const unary = (op: (a: number) => number) => {
    if (result === undefined || src1 === undefined) return;
    const shape = resultShape(vars, result, src1);
    if (shape.vec) vars.setVec(result, vars.vec(splitRef(src1).name, shape.size).map(op));
    else vars.setFloat(result, op(f(src1)));
  };

  switch (proxy.name) {
    // --- item state ---
    case "itemtintcolor":
      if (result) vars.setVec(result, ctx.paint ? [...ctx.paint] : [0, 0, 0]);
      break;
    case "yellowlevel":
      if (result) vars.setVec(result, ctx.fx?.yellow ? [...ctx.fx.yellow] : [1, 1, 1]);
      break;
    case "modelglowcolor":
      if (result) vars.setVec(result, ctx.fx?.glow ? [...ctx.fx.glow] : [1, 1, 1]);
      break;
    case "burnlevel":
      if (result) vars.setFloat(result, ctx.fx?.burn ?? 0);
      break;
    case "invulnlevel":
      if (result) vars.setFloat(result, ctx.fx?.invuln ?? 0);
      break;
    // State proxies read their idle values: not burning, not invulnerable, no gifter, ...
    case "benefactorlevel":
    case "communityweapon":
      if (result) vars.setFloat(result, 0);
      break;
    case "heartbeatscale":
      if (result) vars.setFloat(result, 1);
      break;

    // --- math ---
    case "selectfirstifnonzero":
      if (result && src1 !== undefined) {
        const a = vars.nums.get(splitRef(src1).name) ?? [0];
        const pick = a.some((x) => x !== 0) ? src1 : src2;
        const shape = resultShape(vars, result, pick);
        if (pick !== undefined) {
          if (shape.vec) vars.setVec(result, vars.vec(splitRef(pick).name, shape.size));
          else vars.setFloat(result, f(pick));
        }
      }
      break;
    case "equals":
      unary((a) => a);
      break;
    case "add":
      binary((a, b) => a + b);
      break;
    case "subtract":
      binary((a, b) => a - b);
      break;
    case "multiply":
      binary((a, b) => a * b);
      break;
    case "divide":
      binary((a, b) => (b === 0 ? 0 : a / b));
      break;
    case "abs":
      unary(Math.abs);
      break;
    case "frac":
      unary((a) => a - Math.floor(a));
      break;
    case "int":
      unary(Math.trunc);
      break;
    case "clamp": {
      let lo = vars.input(p["min"], 0);
      let hi = vars.input(p["max"], 1);
      if (lo > hi) [lo, hi] = [hi, lo];
      unary((a) => Math.min(Math.max(a, lo), hi));
      break;
    }
    case "lessorequal": {
      if (result === undefined || src1 === undefined || src2 === undefined) break;
      const pick = f(src1) <= f(src2) ? p["lessequalvar"] : p["greatervar"];
      if (pick === undefined) break;
      const shape = resultShape(vars, result, pick);
      if (shape.vec) vars.setVec(result, vars.vec(splitRef(pick).name, shape.size));
      else vars.setFloat(result, f(pick));
      break;
    }
    case "sine": {
      if (!result) break;
      const period = vars.input(p["sineperiod"], 1) || 1;
      const max = vars.input(p["sinemax"], 1);
      const min = vars.input(p["sinemin"], 0);
      const offset = vars.input(p["timeoffset"], 0);
      const unit = Math.sin((2 * Math.PI * (time - offset)) / period) * 0.5 + 0.5;
      vars.setFloat(result, (max - min) * unit + min);
      break;
    }
    case "linearramp":
      if (result) vars.setFloat(result, vars.input(p["rate"], 1) * time + vars.input(p["initialvalue"], 0));
      break;
    case "uniformnoise": {
      if (!result) break;
      const lo = vars.input(p["minval"], 0);
      const hi = vars.input(p["maxval"], 1);
      vars.setFloat(result, lo + Math.random() * (hi - lo));
      break;
    }

    // --- texture coordinates ---
    case "texturescroll": {
      const target = splitRef(p["texturescrollvar"] ?? "").name;
      if (!target) break;
      const rate = vars.input(p["texturescrollrate"], 1);
      const angle = vars.input(p["texturescrollangle"], 0);
      const scale = vars.input(p["texturescale"], 1);
      const wrap = (v: number) => {
        if (v < 0) v += 1 + -Math.trunc(v);
        return v - Math.trunc(v);
      };
      const s = wrap(time * Math.cos((angle * Math.PI) / 180) * rate);
      const t = wrap(time * Math.sin((angle * Math.PI) / 180) * rate);
      if (isMatrixKey(target)) vars.mats.set(target, [scale, 0, s, 0, scale, t]);
      else vars.nums.set(target, [s, t, 0]);
      break;
    }
    case "texturetransform": {
      const target = splitRef(result ?? "").name;
      if (!target) break;
      const pair = (ref: string | undefined, dflt: [number, number]): [number, number] => {
        if (!ref) return dflt;
        const v = vars.vec(splitRef(ref).name, 2);
        return [v[0], v[1]];
      };
      const rotate = p["rotatevar"] ? vars.float(splitRef(p["rotatevar"]).name) : 0;
      vars.mats.set(target, buildTexTransform(pair(p["centervar"], [0.5, 0.5]), pair(p["scalevar"], [1, 1]), rotate, pair(p["translatevar"], [0, 0])));
      break;
    }
    default:
      break; // animated texture frames, cloak / glow state, decals: nothing a still viewer can show
  }
}

/** The UV transform of a texture variable (`$basetexturetransform`) after proxies, or null for identity. */
export function textureTransform(vars: Record<string, Vec>, key = "$basetexturetransform"): TexMatrix | null {
  const m = vars[key];
  return m && m.length === 6 ? (m as TexMatrix) : null;
}

/**
 * The diffuse modulation colour the shader receives (`g_DiffuseModulation.rgb`): `$color * $color2`
 * converted from gamma to linear (values above 1 are left alone), as
 * `SetModulationPixelShaderDynamicState_LinearColorSpace` does.
 */
export function modulationColor(vars: Record<string, Vec>): Rgb {
  const c1 = vars["$color"] ?? [1, 1, 1];
  const c2 = vars["$color2"] ?? [1, 1, 1];
  const ch = (i: number) => {
    const c = (c1[i] ?? c1[0] ?? 1) * (c2[i] ?? c2[0] ?? 1);
    return c > 1 ? c : Math.pow(c, 2.2);
  };
  return [ch(0), ch(1), ch(2)];
}

/** Packed 0xRRGGBB (the `set item tint RGB` attribute) to 0..1 channels. */
export function unpackRgb(packed: number): Rgb {
  return [((packed >> 16) & 255) / 255, ((packed >> 8) & 255) / 255, (packed & 255) / 255];
}
