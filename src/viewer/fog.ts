/**
 * A gradient fog that lies in the world (the live view and screenshots): by default dense near the floor and clear above the characters,
 * measured in character heights, so it keeps its place when the camera orbits or zooms. Pixels of the background take the height of a
 * backdrop plane through what the camera looks at.
 */

export interface FogState {
  enabled: boolean;
  /** Display colour (`#rrggbb`). */
  color: string;
  /** How much the fog covers at the top and at the bottom of the picture, 0..1. */
  top: number;
  bottom: number;
  /** Where the change from the bottom density to the top density is centred and how wide it is, in character heights above the floor. */
  middle: number;
  softness: number;
  /** The gradient lies over the picture (bottom edge to top edge, a screenshot's frame when looking through a camera) instead of in the world. */
  view: boolean;
  /**
   * "gradient": the fog is its gradient alone. "mist": the same gradient says where the fog lies (its density at each height), and a drifting 3D
   * noise says how thick it is there: it is marched through along every view ray, so it has depth, banks and clear gaps, and it glows toward the light.
   */
  style: "gradient" | "mist";
  /** Mist: the size of its banks, in character heights. */
  scale: number;
  /** Mist: how fast it drifts (banks per second, about) and where to (degrees about the vertical). */
  speed: number;
  wind: number;
  /** Mist: how many layers of finer noise ride on the banks, 1..4. */
  detail: number;
  /** Mist: how much of the noise is fog (0: little, in knots; 1: nearly all). */
  coverage: number;
  /** Mist: how strongly it glows toward the light (the main directional light), as shafts of haze. */
  shafts: number;
  /** Mist: its thickness in this many flat steps (a cel-shaded fog); 0 is smooth. */
  bands: number;
}

export const DEFAULT_FOG: FogState = {
  enabled: false, color: "#bdbdbd", top: 0, bottom: 0.28, middle: 0, softness: 0.76, view: false,
  style: "gradient", scale: 2.5, speed: 0.12, wind: 40, detail: 3, coverage: 0.45, shafts: 0.5, bands: 0,
};

/** What switching a fog to the mist style starts from (the colour and the shape of the gradient that suit it). */
export const MIST_PRESET: Partial<FogState> = { style: "mist", color: "#c4b9b0", top: 0, bottom: 0.03, middle: 0.38, softness: 0.4, scale: 0.95, speed: 1, wind: 360, detail: 4, coverage: 0.8, shafts: 0, bands: 0 };

const unit = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback);

/** The fog of a scene file, with anything missing or out of range replaced by the default; undefined when there is none. */
export function parseFog(raw: any): FogState | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  return {
    enabled: raw.enabled === true,
    color: typeof raw.color === "string" && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : DEFAULT_FOG.color,
    top: unit(raw.top, DEFAULT_FOG.top),
    bottom: unit(raw.bottom, DEFAULT_FOG.bottom),
    middle: typeof raw.middle === "number" && Number.isFinite(raw.middle) ? Math.min(2, Math.max(0, raw.middle)) : DEFAULT_FOG.middle,
    softness: Math.max(0.02, unit(raw.softness, DEFAULT_FOG.softness)),
    view: raw.view === true,
    style: raw.style === "mist" ? "mist" : "gradient",
    scale: range(raw.scale, DEFAULT_FOG.scale, 0.2, 6),
    speed: range(raw.speed, DEFAULT_FOG.speed, 0, 2),
    wind: range(raw.wind, DEFAULT_FOG.wind, 0, 360),
    detail: range(raw.detail, DEFAULT_FOG.detail, 1, 4),
    coverage: unit(raw.coverage, DEFAULT_FOG.coverage),
    shafts: unit(raw.shafts, DEFAULT_FOG.shafts),
    bands: Math.round(range(raw.bands, DEFAULT_FOG.bands, 0, 8)),
  };
}

const range = (v: unknown, fallback: number, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);

/** How many fogs can lie over the picture at once (they are layered in the order of the list). */
export const MAX_FOGS = 3;

/**
 * The fog in the shaders of the final picture: `fogLayers(uv, over)` is how much fog covers the pixel at `uv` and `over` the colour that the
 * fog puts over it (premultiplied), so that `picture * (1 - amount) + over` is the picture with every fog laid over it. The height of what is
 * drawn there comes from the depth texture or, for the empty background, from the backdrop plane through the camera's target.
 */
export const FOG_GLSL = /* glsl */ `
uniform int uFogCount;
uniform vec3 uFogColor[${MAX_FOGS}];
uniform vec2 uFogDensity[${MAX_FOGS}]; // top, bottom
uniform vec2 uFogShape[${MAX_FOGS}];   // middle, softness (in character heights)
uniform sampler2D tFogMask; // red where a pixel belongs to a character the fog leaves alone
uniform float uFogMaskOn;
uniform sampler2D tDepth;
uniform mat4 uInvViewProj;
uniform vec3 uCamPos;
uniform vec3 uCamForward;
uniform float uBackDist;   // distance of the backdrop plane (camera to target)
uniform float uFogBase;    // world height of the floor
uniform float uFogHeight;  // world height of a character
uniform float uFogView[${MAX_FOGS}]; // 1 where a fog lies over the picture instead of in the world
uniform vec4 uFogFrame;    // where the picture is in the view (x, y, width, height), for the fogs that follow the view
uniform float uFogStyle[${MAX_FOGS}]; // 1 for a mist (see FogState.style)
uniform vec4 uFogMistA[${MAX_FOGS}];  // scale, speed, wind (radians), the noise level above which it is fog
uniform vec4 uFogMistB[${MAX_FOGS}];  // detail, shafts, bands
uniform float uFogTime;    // seconds
uniform vec3 uFogSun;      // toward the main light
uniform vec3 uFogSunColor;

// a drifting 3D value noise, in a few octaves
float fogHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float fogNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(fogHash(i + vec3(0.0, 0.0, 0.0)), fogHash(i + vec3(1.0, 0.0, 0.0)), f.x),
                 mix(fogHash(i + vec3(0.0, 1.0, 0.0)), fogHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(fogHash(i + vec3(0.0, 0.0, 1.0)), fogHash(i + vec3(1.0, 0.0, 1.0)), f.x),
                 mix(fogHash(i + vec3(0.0, 1.0, 1.0)), fogHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
float fogFbm(vec3 p, float octaves) {
  float sum = 0.0, amp = 0.5, norm = 0.0;
  for (int o = 0; o < 4; o++) {
    float w = clamp(octaves - float(o), 0.0, 1.0);
    sum += amp * w * fogNoise(p);
    norm += amp * w;
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    amp *= 0.5;
  }
  return sum / max(norm, 1e-4);
}

// A mist: marched from the camera to what the pixel shows, thickened by the noise where the gradient (the fog's height profile) lets fog lie.
// Returns the light the mist puts over the pixel (premultiplied) and, in w, how much of the pixel it covers.
vec4 fogMist(int i, vec3 P, vec2 uv) {
  vec3 ray = P - uCamPos;
  float len = length(ray);
  if (len < 1e-3) return vec4(0.0);
  vec3 dir = ray / len;
  vec4 A = uFogMistA[i];
  vec4 B = uFogMistB[i];
  float H = max(uFogHeight, 0.001);
  float w = max(uFogShape[i].y * 0.5, 0.001);
  const int STEPS = 16;
  float stepLen = len / float(STEPS);
  // a different offset for each pixel: the steps do not show as bands
  float jitter = fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453);
  vec2 wind = vec2(cos(A.z), sin(A.z));
  // the haze glows toward the light
  float toward = pow(max(dot(dir, normalize(uFogSun)), 0.0), 5.0);
  vec3 sun = min(uFogSunColor, vec3(1.5));
  vec3 lit = uFogColor[i] * (0.6 + B.y * 1.6 * toward * sun);
  float transmit = 1.0;
  vec3 scatter = vec3(0.0);
  for (int k = 0; k < STEPS; k++) {
    vec3 pos = uCamPos + dir * (float(k) + jitter) * stepLen;
    float hh = (pos.y - uFogBase) / H;
    float profile = mix(uFogDensity[i].y, uFogDensity[i].x, smoothstep(uFogShape[i].x - w, uFogShape[i].x + w, hh));
    if (profile < 0.002) continue;
    vec3 q = pos / (H * A.x) + vec3(wind.x, 0.1, wind.y) * (uFogTime * A.y);
    // (the noise has most of its values near the middle: stretched, so that banks and clear air differ)
    float n = (fogFbm(q, B.x) - 0.5) * 2.4 + 0.5;
    float fog = smoothstep(A.w - 0.1, A.w + 0.1, n);
    float extinction = 1.0 - exp(-profile * fog * (stepLen / H) * 2.0);
    scatter += transmit * extinction * lit;
    transmit *= 1.0 - extinction;
  }
  float cover = 1.0 - transmit;
  if (B.z > 0.5) {
    // a cel-shaded mist: its thickness in flat steps
    float snapped = floor(cover * B.z + 0.5) / B.z;
    scatter *= snapped / max(cover, 1e-4);
    cover = snapped;
  }
  return vec4(scatter, cover);
}
float fogFree(vec2 uv) {
  return uFogMaskOn > 0.5 ? texture2D(tFogMask, uv).r : 0.0;
}
float fogLayers(vec2 uv, out vec3 over) {
  over = vec3(0.0);
  if (uFogCount == 0) return 0.0;
  float d = texture2D(tDepth, uv).r;
  vec2 ndc = uv * 2.0 - 1.0;
  float y;
  vec3 P;
  if (d >= 0.9999) {
    vec4 far = uInvViewProj * vec4(ndc, 1.0, 1.0);
    vec3 dir = normalize(far.xyz / far.w - uCamPos);
    P = uCamPos + dir * (uBackDist / max(dot(dir, uCamForward), 0.05));
    y = P.y;
  } else {
    vec4 p = uInvViewProj * vec4(ndc, d * 2.0 - 1.0, 1.0);
    P = p.xyz / p.w;
    y = P.y;
  }
  float h = (y - uFogBase) / max(uFogHeight, 0.001);
  // a fog of the view: the picture's height from 0 (bottom edge) to 2 (top edge), the range of the Height setting
  float hv = (uv.y - uFogFrame.y) / uFogFrame.w * 2.0;
  float clear = 1.0;
  for (int i = 0; i < ${MAX_FOGS}; i++) {
    if (i >= uFogCount) break;
    if (uFogStyle[i] > 0.5) {
      vec4 m = fogMist(i, P, uv);
      over = over * (1.0 - m.w) + m.rgb;
      clear *= 1.0 - m.w;
      continue;
    }
    float w = max(uFogShape[i].y * 0.5, 0.001);
    float a = mix(uFogDensity[i].y, uFogDensity[i].x, smoothstep(uFogShape[i].x - w, uFogShape[i].x + w, uFogView[i] > 0.5 ? hv : h));
    over = over * (1.0 - a) + uFogColor[i] * a;
    clear *= 1.0 - a;
  }
  return 1.0 - clear;
}
`;

interface FogUniforms {
  uFogCount: { value: number };
  uFogColor: { value: { set(c: string): unknown }[] };
  uFogDensity: { value: { set(a: number, b: number): unknown }[] };
  uFogShape: { value: { set(a: number, b: number): unknown }[] };
  uFogView: { value: number[] };
  uFogStyle: { value: number[] };
  uFogMistA: { value: { set(a: number, b: number, c: number, d: number): unknown }[] };
  uFogMistB: { value: { set(a: number, b: number, c: number, d: number): unknown }[] };
}

/** The uniform values for the fogs that are on (the others do not take part), at most MAX_FOGS of them. */
export function applyFogUniforms(u: FogUniforms, fogs: readonly FogState[]) {
  const on = fogs.filter((f) => f.enabled).slice(0, MAX_FOGS);
  u.uFogCount.value = on.length;
  on.forEach((f, i) => {
    u.uFogColor.value[i].set(f.color);
    u.uFogDensity.value[i].set(f.top, f.bottom);
    u.uFogShape.value[i].set(f.middle, f.softness);
    u.uFogView.value[i] = f.view ? 1 : 0;
    u.uFogStyle.value[i] = f.style === "mist" ? 1 : 0;
    // (the noise level above which it is fog: more coverage lowers it)
    u.uFogMistA.value[i].set(f.scale, f.speed, (f.wind * Math.PI) / 180, 0.88 - f.coverage * 0.7);
    u.uFogMistB.value[i].set(f.detail, f.shafts, f.bands, 0);
  });
}
