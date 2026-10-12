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
}

export const DEFAULT_FOG: FogState = { enabled: false, color: "#bdbdbd", top: 0, bottom: 0.28, middle: 0, softness: 0.76, view: false };

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
  };
}

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
float fogFree(vec2 uv) {
  return uFogMaskOn > 0.5 ? texture2D(tFogMask, uv).r : 0.0;
}
float fogLayers(vec2 uv, out vec3 over) {
  over = vec3(0.0);
  if (uFogCount == 0) return 0.0;
  float d = texture2D(tDepth, uv).r;
  vec2 ndc = uv * 2.0 - 1.0;
  float y;
  if (d >= 0.9999) {
    vec4 far = uInvViewProj * vec4(ndc, 1.0, 1.0);
    vec3 dir = normalize(far.xyz / far.w - uCamPos);
    y = uCamPos.y + dir.y * uBackDist / max(dot(dir, uCamForward), 0.05);
  } else {
    vec4 p = uInvViewProj * vec4(ndc, d * 2.0 - 1.0, 1.0);
    y = p.y / p.w;
  }
  float h = (y - uFogBase) / max(uFogHeight, 0.001);
  // a fog of the view: the picture's height from 0 (bottom edge) to 2 (top edge), the range of the Height setting
  float hv = (uv.y - uFogFrame.y) / uFogFrame.w * 2.0;
  float clear = 1.0;
  for (int i = 0; i < ${MAX_FOGS}; i++) {
    if (i >= uFogCount) break;
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
  });
}
