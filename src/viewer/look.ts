/**
 * The "look" effects of the post-processing panel: vignette, chromatic aberration, film grain, colour grading and bloom. They are laid
 * over the finished picture in one pass (the live view and screenshots share the code below), in this order: the lens (aberration)
 * is part of reading the picture, then bloom is added, the colour grade is applied, and the vignette and the grain go on top.
 */
import * as THREE from "three";
import { LOOK_KINDS, type LookKind } from "./postStack";

export { LOOK_KINDS, type LookKind };

export interface VignetteState { enabled: boolean; strength: number; size: number; softness: number; roundness: number; color: string }
export interface AberrationState { enabled: boolean; strength: number }
export interface GrainState { enabled: boolean; amount: number; size: number; shadows: number; colored: boolean }
export interface GradeState { enabled: boolean; exposure: number; contrast: number; saturation: number; temperature: number; tint: number }
export interface BloomState { enabled: boolean; intensity: number; threshold: number; radius: number }
export interface DistortionState { enabled: boolean; amount: number }
export interface PixelateState { enabled: boolean; size: number }
export interface ScanlinesState { enabled: boolean; strength: number; lines: number }
export interface PosteriseState { enabled: boolean; levels: number }
export interface DuotoneState { enabled: boolean; shadows: string; highlights: string; amount: number }
export interface LeaksState { enabled: boolean; strength: number; size: number; position: number; color: string }
export interface DustState { enabled: boolean; amount: number; size: number; opacity: number; color: string; seed: number }
export interface ReflectionState { enabled: boolean; strength: number; fade: number; blur: number; fresnel: number; distance: number; softness: number; color: string }
export interface DitherState { enabled: boolean; strength: number }
export interface DofState { enabled: boolean; selected: boolean; focus: number; range: number; aperture: number; tilt: boolean; tiltPosition: number; tiltWidth: number }
export interface MotionBlurState { enabled: boolean; samples: number; shutter: number; preview: boolean }

export interface LookStates {
  vignette?: VignetteState;
  aberration?: AberrationState;
  grain?: GrainState;
  grade?: GradeState;
  bloom?: BloomState;
  distortion?: DistortionState;
  pixelate?: PixelateState;
  scanlines?: ScanlinesState;
  posterise?: PosteriseState;
  duotone?: DuotoneState;
  leaks?: LeaksState;
  dust?: DustState;
  reflection?: ReflectionState;
  dither?: DitherState;
  dof?: DofState;
  motionBlur?: MotionBlurState;
}

/** One control of an effect in the properties panel. */
export type LookControl = { key: string; label: string; title: string } & (
  | { type: "range"; min: number; max: number; step: number; digits: number; unit?: string }
  | { type: "color" }
  | { type: "check" }
  /** A whole number that decides the random pattern of an effect, with a button that picks another one. */
  | { type: "seed" }
);

interface LookDef { title: string; defaults: { enabled: boolean; [key: string]: unknown }; controls: LookControl[] }

export const LOOK_DEFS: Record<LookKind, LookDef> = {
  vignette: {
    title: "Darkens (or tints) the edges of the picture",
    defaults: { enabled: true, strength: 0.55, size: 0.5, softness: 0.55, roundness: 1, color: "#000000" } satisfies VignetteState,
    controls: [
      { key: "strength", label: "Strength", title: "How much the edges are darkened", type: "range", min: 0, max: 1, step: 0.01, digits: 2 },
      { key: "size", label: "Size", title: "How far from the middle the darkening starts: a large one only touches the corners", type: "range", min: 0, max: 1, step: 0.01, digits: 2 },
      { key: "softness", label: "Softness", title: "How gradual the change from the clear middle to the dark edge is", type: "range", min: 0, max: 1, step: 0.01, digits: 2 },
      { key: "roundness", label: "Roundness", title: "A circle (1), or an ellipse that has the shape of the picture (0)", type: "range", min: 0, max: 1, step: 0.01, digits: 2 },
      { key: "color", label: "Colour", title: "The colour of the edges (black is the usual one)", type: "color" },
    ],
  },
  aberration: {
    title: "Splits the colours towards the edges of the picture, like a cheap lens",
    defaults: { enabled: true, strength: 0.35 } satisfies AberrationState,
    controls: [
      { key: "strength", label: "Strength", title: "How far the red and blue are pushed apart at the edge of the picture", type: "range", min: 0, max: 1, step: 0.01, digits: 2 },
    ],
  },
  grain: {
    title: "Noise over the picture, like film",
    defaults: { enabled: true, amount: 0.18, size: 1, shadows: 0.5, colored: false } satisfies GrainState,
    controls: [
      { key: "amount", label: "Amount", title: "How strong the noise is", type: "range", min: 0, max: 1, step: 0.01, digits: 2 },
      { key: "size", label: "Size", title: "The size of a grain, relative to the picture (a screenshot has the same grain as the view)", type: "range", min: 0.5, max: 4, step: 0.05, digits: 2 },
      { key: "shadows", label: "In shadows", title: "How much more the dark parts have of it than the bright ones", type: "range", min: 0, max: 1, step: 0.01, digits: 2 },
      { key: "colored", label: "Colour noise", title: "Every colour has its own noise (off: one grey noise)", type: "check" },
    ],
  },
  grade: {
    title: "Exposure, contrast, saturation and the colour of the light",
    defaults: { enabled: true, exposure: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0 } satisfies GradeState,
    controls: [
      { key: "exposure", label: "Exposure", title: "Brighter or darker, in stops (every stop doubles or halves the light)", type: "range", min: -3, max: 3, step: 0.05, digits: 2 },
      { key: "contrast", label: "Contrast", title: "Pushes the dark and the bright parts apart (negative: flatter)", type: "range", min: -1, max: 1, step: 0.01, digits: 2 },
      { key: "saturation", label: "Saturation", title: "How strong the colours are (-1 is grey)", type: "range", min: -1, max: 1, step: 0.01, digits: 2 },
      { key: "temperature", label: "Temperature", title: "Warmer (orange) or cooler (blue)", type: "range", min: -1, max: 1, step: 0.01, digits: 2 },
      { key: "tint", label: "Tint", title: "Towards magenta (positive) or green (negative)", type: "range", min: -1, max: 1, step: 0.01, digits: 2 },
    ],
  },
  bloom: {
    title: "A soft glow round the bright parts",
    defaults: { enabled: true, intensity: 0.6, threshold: 0.8, radius: 0.5 } satisfies BloomState,
    controls: [
      { key: "intensity", label: "Intensity", title: "How strong the glow is", type: "range", min: 0, max: 2, step: 0.01, digits: 2 },
      { key: "threshold", label: "Threshold", title: "How bright something must be to glow", type: "range", min: 0, max: 3, step: 0.01, digits: 2 },
      { key: "radius", label: "Radius", title: "How far the glow spreads", type: "range", min: 0, max: 1, step: 0.01, digits: 2 },
    ],
  },
  distortion: {
    title: "Barrel or pincushion distortion of the picture, like a wide or a long lens",
    defaults: { enabled: true, amount: 0.25 } satisfies DistortionState,
    controls: [
      { key: "amount", label: "Amount", title: "Positive: barrel (the middle bulges, the corners stay in the picture); negative: pincushion", type: "range", min: -1, max: 1, step: 0.01, digits: 2 },
    ],
  },
  pixelate: {
    title: "Big square pixels, like an old game",
    defaults: { enabled: true, size: 8 } satisfies PixelateState,
    controls: [
      { key: "size", label: "Pixel size", title: "The size of a pixel, relative to the picture (a screenshot looks like the view)", type: "range", min: 2, max: 48, step: 1, digits: 0 },
    ],
  },
  scanlines: {
    title: "Dark lines across the picture, like a screen",
    defaults: { enabled: true, strength: 0.35, lines: 300 } satisfies ScanlinesState,
    controls: [
      { key: "strength", label: "Strength", title: "How dark the lines are", type: "range", min: 0, max: 1, step: 0.01, digits: 2 },
      { key: "lines", label: "Lines", title: "How many lines the height of the picture has", type: "range", min: 60, max: 800, step: 10, digits: 0 },
    ],
  },
  posterise: {
    title: "Fewer steps of every colour, like a poster",
    defaults: { enabled: true, levels: 5 } satisfies PosteriseState,
    controls: [
      { key: "levels", label: "Levels", title: "How many steps of brightness every colour has", type: "range", min: 2, max: 16, step: 1, digits: 0 },
    ],
  },
  duotone: {
    title: "The picture in two colours: one for the dark parts, one for the bright ones",
    defaults: { enabled: true, shadows: "#1a1a40", highlights: "#ffd9a8", amount: 1 } satisfies DuotoneState,
    controls: [
      { key: "shadows", label: "Shadows", title: "The colour of the darkest parts", type: "color" },
      { key: "highlights", label: "Highlights", title: "The colour of the brightest parts", type: "color" },
      { key: "amount", label: "Amount", title: "How much of the picture's own colour is replaced", type: "range", min: 0, max: 1, step: 0.01, digits: 2 },
    ],
  },
  leaks: {
    title: "Soft coloured light that leaks in from the edge of the frame, like a film camera",
    defaults: { enabled: true, strength: 0.5, size: 0.5, position: 0.12, color: "#ff7a30" } satisfies LeaksState,
    controls: [
      { key: "strength", label: "Strength", title: "How bright the leak is", type: "range", min: 0, max: 1, step: 0.01, digits: 2 },
      { key: "size", label: "Size", title: "How far it reaches into the picture", type: "range", min: 0.1, max: 1, step: 0.01, digits: 2 },
      { key: "position", label: "Position", title: "Where it comes in, once round the frame", type: "range", min: 0, max: 1, step: 0.01, digits: 2 },
      { key: "color", label: "Colour", title: "The colour of the light", type: "color" },
    ],
  },
  dust: {
    title: "Specks of dust on the film or the lens",
    defaults: { enabled: true, amount: 0.4, size: 1, opacity: 0.85, color: "#ffffff", seed: 1 } satisfies DustState,
    controls: [
      { key: "amount", label: "Amount", title: "How many specks there are", type: "range", min: 0, max: 1, step: 0.01, digits: 2 },
      { key: "size", label: "Size", title: "The size of the specks, relative to the picture", type: "range", min: 0.5, max: 3, step: 0.05, digits: 2 },
      { key: "opacity", label: "Opacity", title: "How strong the specks are", type: "range", min: 0, max: 1, step: 0.01, digits: 2 },
      { key: "color", label: "Colour", title: "The colour of the specks (white for dust on film, dark for dust on the lens)", type: "color" },
      { key: "seed", label: "Seed", title: "The number that decides where every speck is: another number is another pattern", type: "seed" },
    ],
  },
  reflection: {
    title: "The scene reflected in the floor, fading with height and distance",
    defaults: { enabled: true, strength: 0.5, fade: 0.9, blur: 0.3, fresnel: 0.5, distance: 6, softness: 0.6, color: "#ffffff" } satisfies ReflectionState,
    controls: [
      { key: "strength", label: "Strength", title: "How clear the reflection is", type: "range", min: 0, max: 1, step: 0.01, digits: 2 },
      { key: "fade", label: "Fade with height", title: "How high above the floor (in character heights) a reflected thing has faded out: a foot is clear, a head is gone", type: "range", min: 0.1, max: 3, step: 0.05, digits: 2 },
      { key: "blur", label: "Blur", title: "How soft the reflection is (more with the height)", type: "range", min: 0, max: 1, step: 0.01, digits: 2 },
      { key: "fresnel", label: "Glancing angle", title: "How much stronger the reflection is where the floor is seen at a low angle, like on a real floor", type: "range", min: 0, max: 1, step: 0.01, digits: 2 },
      { key: "distance", label: "Distance", title: "How far from the middle of the scene the reflection reaches, in character heights", type: "range", min: 1, max: 20, step: 0.5, digits: 1 },
      { key: "softness", label: "Edge softness", title: "How much of that distance the fade takes", type: "range", min: 0.05, max: 1, step: 0.01, digits: 2 },
      { key: "color", label: "Tint", title: "A colour that the reflection is multiplied with", type: "color" },
    ],
  },
  dither: {
    title: "A little noise that hides bands in smooth gradients (dark fog and vignettes)",
    defaults: { enabled: true, strength: 1 } satisfies DitherState,
    controls: [
      { key: "strength", label: "Strength", title: "The size of the noise, in steps of brightness", type: "range", min: 0, max: 2, step: 0.05, digits: 2 },
    ],
  },
  dof: {
    title: "Blurs what is nearer or further than the focus, like a camera lens (or a band of the picture, like a tilt-shift lens)",
    defaults: { enabled: true, selected: true, focus: 3, range: 0.35, aperture: 0.4, tilt: false, tiltPosition: 0.5, tiltWidth: 0.3 } satisfies DofState,
    controls: [
      { key: "selected", label: "Focus on the selected character", title: "The focus follows the selected character (or the middle of the view when none is)", type: "check" },
      { key: "focus", label: "Focus distance", title: "How far from the camera the focus is, in character heights (when it does not follow the selected character)", type: "range", min: 0.5, max: 20, step: 0.1, digits: 1 },
      { key: "range", label: "In focus", title: "How deep the sharp zone is round the focus, in character heights", type: "range", min: 0, max: 3, step: 0.05, digits: 2 },
      { key: "aperture", label: "Blur", title: "How strong the blur is out of focus", type: "range", min: 0, max: 1, step: 0.01, digits: 2 },
      { key: "tilt", label: "Tilt-shift", title: "Blur a band of the picture (like a miniature) instead of by distance", type: "check" },
      { key: "tiltPosition", label: "Band position", title: "Where the sharp band is, from the bottom to the top of the picture", type: "range", min: 0, max: 1, step: 0.01, digits: 2 },
      { key: "tiltWidth", label: "Band width", title: "How wide the sharp band is", type: "range", min: 0, max: 1, step: 0.01, digits: 2 },
    ],
  },
  motionBlur: {
    title: "Blurs what moves in an animation, as a camera does: several moments of it are drawn and averaged (screenshots, and the view when asked)",
    defaults: { enabled: true, samples: 12, shutter: 0.12, preview: false } satisfies MotionBlurState,
    controls: [
      { key: "shutter", label: "Shutter", title: "How much animation time the exposure covers, in seconds (the pose at the time shown is in the middle of it)", type: "range", min: 0.01, max: 0.5, step: 0.01, digits: 2 },
      { key: "samples", label: "Samples", title: "How many moments are drawn: more is smoother and slower", type: "range", min: 4, max: 32, step: 1, digits: 0 },
      { key: "preview", label: "Preview in the view", title: "Show the blur in the view too (it draws the scene several times for every frame, so the view gets slower)", type: "check" },
    ],
  },
};

/** A copy of the default settings of an effect. */
export const defaultLook = <K extends LookKind>(kind: K) => ({ ...LOOK_DEFS[kind].defaults }) as unknown as NonNullable<LookStates[K]>;

/** The settings of an effect from a scene file: anything missing or out of range is replaced by the default (undefined when there is none). */
export function parseLook<K extends LookKind>(kind: K, raw: unknown): NonNullable<LookStates[K]> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const out: Record<string, unknown> = { enabled: value.enabled === true };
  for (const c of LOOK_DEFS[kind].controls) {
    const fallback = LOOK_DEFS[kind].defaults[c.key];
    const v = value[c.key];
    if (c.type === "range") out[c.key] = typeof v === "number" && Number.isFinite(v) ? Math.min(c.max, Math.max(c.min, v)) : fallback;
    else if (c.type === "color") out[c.key] = typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;
    else if (c.type === "seed") out[c.key] = typeof v === "number" && Number.isFinite(v) ? Math.min(9999, Math.max(0, Math.round(v))) : fallback;
    else out[c.key] = v === true;
  }
  return out as unknown as NonNullable<LookStates[K]>;
}

/** The uniforms of the look effects, shared by the live picture and the screenshots (the picture size and the bloom texture are theirs). */
export function createLookUniforms() {
  return {
    uAberr: { value: 0 },
    uVig: { value: new THREE.Vector4() },
    uVigColor: { value: new THREE.Color(0x000000) },
    uGrain: { value: new THREE.Vector4() },
    uGradeOn: { value: 0 },
    uGrade: { value: new THREE.Vector4() },
    uGradeWB: { value: new THREE.Vector3(1, 1, 1) },
    uBloomK: { value: 0 },
    uDist: { value: 0 },
    uPixel: { value: 0 },
    uScan: { value: new THREE.Vector2() },
    uPoster: { value: 0 },
    uDuo: { value: new THREE.Vector4(0, 0, 0, 0) },
    uDuoShadow: { value: new THREE.Color(0x000000) },
    uDuoLight: { value: new THREE.Color(0xffffff) },
    uLeak: { value: new THREE.Vector4() },
    uLeakColor: { value: new THREE.Color(0xff7a30) },
    uDust: { value: new THREE.Vector4() },
    uDustColor: { value: new THREE.Color(0xffffff) },
    uDither: { value: 0 },
    // where the picture of a camera is on the screen (x, y, width, height as fractions of the view): the effects belong to the picture, not to the view around it
    uLookFrame: { value: new THREE.Vector4(0, 0, 1, 1) },
  };
}
export type LookUniforms = ReturnType<typeof createLookUniforms>;

/** Puts the effects that are on in the uniforms (the ones that are off, or missing, are switched off). */
export function applyLookUniforms(u: LookUniforms, s: LookStates) {
  const v = s.vignette;
  if (v?.enabled && v.strength > 0) {
    // the clear middle ends at `inner` and the edge is fully dark at `outer`, in half-heights from the middle (a corner is about 1.4 to 2.1 away)
    const inner = 0.15 + v.size * 1.5, outer = inner + 0.05 + v.softness * 1.1;
    u.uVig.value.set(v.strength, inner, outer, v.roundness);
    u.uVigColor.value.set(v.color);
  } else u.uVig.value.set(0, 0, 1, 1);
  u.uAberr.value = s.aberration?.enabled ? s.aberration.strength * 0.05 : 0;
  const g = s.grain;
  if (g?.enabled && g.amount > 0) u.uGrain.value.set(g.amount, g.size, g.shadows, g.colored ? 1 : 0); else u.uGrain.value.set(0, 1, 0, 0);
  const c = s.grade;
  if (c?.enabled) {
    u.uGradeOn.value = 1;
    u.uGrade.value.set(c.exposure, c.contrast, c.saturation, 0);
    // warm: more red and less blue; magenta: less green
    u.uGradeWB.value.set(1 + 0.3 * c.temperature + 0.1 * c.tint, 1 - 0.2 * c.tint, 1 - 0.3 * c.temperature + 0.1 * c.tint);
  } else u.uGradeOn.value = 0;
  u.uBloomK.value = s.bloom?.enabled ? s.bloom.intensity : 0;
  u.uDist.value = s.distortion?.enabled ? s.distortion.amount : 0;
  u.uPixel.value = s.pixelate?.enabled ? s.pixelate.size : 0;
  if (s.scanlines?.enabled && s.scanlines.strength > 0) u.uScan.value.set(s.scanlines.strength, s.scanlines.lines); else u.uScan.value.set(0, 1);
  u.uPoster.value = s.posterise?.enabled ? Math.round(s.posterise.levels) : 0;
  const d = s.duotone;
  if (d?.enabled && d.amount > 0) {
    u.uDuo.value.set(1, d.amount, 0, 0);
    u.uDuoShadow.value.set(d.shadows);
    u.uDuoLight.value.set(d.highlights);
  } else u.uDuo.value.set(0, 0, 0, 0);
  const l = s.leaks;
  if (l?.enabled && l.strength > 0) { u.uLeak.value.set(l.strength, l.size, l.position, 0); u.uLeakColor.value.set(l.color); } else u.uLeak.value.set(0, 1, 0, 0);
  const t = s.dust;
  if (t?.enabled && t.amount > 0 && t.opacity > 0) {
    u.uDust.value.set(t.amount, t.size, t.seed, t.opacity);
    u.uDustColor.value.set(t.color);
  } else u.uDust.value.set(0, 1, 0, 0);
  u.uDither.value = s.dither?.enabled ? s.dither.strength : 0;
}

/** The GLSL of the effects. \`tBloom\` and \`uLookRes\` (the size of the picture in pixels) come from whoever draws the picture. */
export const LOOK_GLSL = /* glsl */ `
uniform vec2 uLookRes;   // the size of the picture (a camera's frame when one is looked through) in pixels
uniform vec4 uLookFrame; // where that picture is in the view
vec2 lookLocal(vec2 uv) { return (uv - uLookFrame.xy) / uLookFrame.zw; }
vec2 lookGlobal(vec2 uv) { return uLookFrame.xy + uv * uLookFrame.zw; }
uniform sampler2D tBloom;
uniform float uBloomK;
uniform float uAberr;
uniform vec4 uVig;       // strength, where the clear middle ends, where it is fully dark, roundness
uniform vec3 uVigColor;
uniform vec4 uGrain;     // amount, grain size (relative), more in the shadows, coloured
uniform float uGradeOn;
uniform vec4 uGrade;     // exposure (stops), contrast, saturation
uniform vec3 uGradeWB;   // the colour of the light (temperature and tint)
uniform float uDist;     // lens distortion (positive: barrel)
uniform float uPixel;    // pixel size (0: off)
uniform vec2 uScan;      // strength, lines
uniform float uPoster;   // levels (0: off)
uniform vec4 uDuo;       // on, amount
uniform vec3 uDuoShadow;
uniform vec3 uDuoLight;
uniform vec4 uLeak;      // strength, size, position
uniform vec3 uLeakColor;
uniform vec4 uDust;      // amount, speck size, seed, opacity
uniform vec3 uDustColor;
uniform float uDither;
float lookHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// where the picture is read for a pixel: through the lens distortion (what is drawn over the picture, like the fog and the outline of what is
// selected, is read there too, so that it keeps its place) ...
vec2 lookDistort(vec2 uv) {
  if (uDist == 0.0) return uv;
  float asp = uLookRes.x / uLookRes.y;
  uv = lookLocal(uv);
  vec2 p = (uv - 0.5) * vec2(asp, 1.0) / (0.5 * length(vec2(asp, 1.0)));
  float r2 = dot(p, p);
  return lookGlobal(0.5 + (uv - 0.5) * (1.0 + uDist * r2) / max(1.0, 1.0 + uDist));
}
// ... and the big pixels
vec2 lookUv(vec2 uv) {
  uv = lookDistort(uv);
  if (uPixel > 0.0) {
    vec2 cell = vec2(max(uPixel * uLookRes.y / 1080.0, 1.0));
    uv = lookGlobal((floor(lookLocal(uv) * uLookRes / cell) + 0.5) * cell / uLookRes);
  }
  return uv;
}
// the picture, read as the lens sees it: the red and the blue are a little bigger and a little smaller than the green
vec4 lookScene(sampler2D s, vec2 uv) {
  uv = lookUv(uv);
  vec4 g = texture2D(s, uv);
  if (uAberr <= 0.0) return g;
  vec2 d = (lookLocal(uv) - 0.5) * uAberr * uLookFrame.zw;
  return vec4(texture2D(s, uv + d).r, g.g, texture2D(s, uv - d).b, g.a);
}
// the triangular noise that is added to the finished colours (in steps of 1/255)
vec3 lookDither(vec2 uv) {
  if (uDither <= 0.0) return vec3(0.0);
  vec2 p = floor(uv * uLookRes);
  return (vec3(lookHash(p + 3.7), lookHash(p + 9.1), lookHash(p + 21.3)) + vec3(lookHash(p + 41.9), lookHash(p + 57.3), lookHash(p + 77.1)) - 1.0) * (uDither / 255.0);
}
// the specks of dust at a place of the picture (0..1): a speck in some of the cells of three sizes, where the seed decides which
float lookDustMarks(vec2 uv) {
  vec2 q = vec2(uv.x * uLookRes.x / uLookRes.y, uv.y); // the height of the picture is 1
  float seed = uDust.z * 17.13;
  float v = 0.0;
  for (int k = 0; k < 3; k++) {
    float cell = 0.035 * uDust.y * pow(1.9, float(k));
    vec2 id = floor(q / cell) + float(k) * 37.0 + seed;
    if (lookHash(id) < uDust.x * 0.12) {
      vec2 ctr = vec2(lookHash(id + 11.0), lookHash(id + 23.0));
      float r = 0.02 + 0.04 * lookHash(id + 5.0);
      v += smoothstep(r, r * 0.35, length(fract(q / cell) - ctr)) * (0.5 + 0.5 * lookHash(id + 41.0));
    }
  }
  return clamp(v, 0.0, 1.0);
}
// \`cover\` is how much of the pixel is picture (1 in the live view; in a screenshot with a transparent background it is the coverage
// plus the light over black), so that the effects do not draw over what is empty
// the colour grade, the duotone and the posterise
vec3 lookTone(vec3 c, float cover) {
  if (uGradeOn > 0.5) {
    vec3 g = c * exp2(uGrade.x) * uGradeWB;
    vec3 s = pow(max(g, 0.0), vec3(1.0 / 2.2));
    s = (s - 0.5) * (1.0 + uGrade.y) + 0.5;
    float l = dot(s, vec3(0.2126, 0.7152, 0.0722));
    s = mix(vec3(l), s, 1.0 + uGrade.z);
    c = mix(c, pow(max(s, 0.0), vec3(2.2)), cover);
  }
  if (uDuo.x > 0.5) {
    vec3 s = pow(max(c, 0.0), vec3(1.0 / 2.2));
    float l = clamp(dot(s, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
    vec3 duo = pow(mix(pow(uDuoShadow, vec3(1.0 / 2.2)), pow(uDuoLight, vec3(1.0 / 2.2)), l), vec3(2.2));
    c = mix(c, duo, uDuo.y * cover);
  }
  if (uPoster > 0.5) {
    vec3 s = pow(max(c, 0.0), vec3(1.0 / 2.2));
    float steps = max(uPoster - 1.0, 1.0);
    c = mix(c, pow(floor(s * steps + 0.5) / steps, vec3(2.2)), cover);
  }
  return c;
}
vec3 lookColor(vec3 c, vec2 uv, float cover) {
  if (uBloomK > 0.0) c += texture2D(tBloom, uv).rgb * uBloomK;
  uv = lookLocal(uv); // from here on the picture is the frame
  c = lookTone(c, cover);
  if (uVig.x > 0.0) {
    vec2 p = uv - 0.5;
    p.x *= mix(1.0, uLookRes.x / uLookRes.y, uVig.w);
    float v = smoothstep(uVig.y, uVig.z, length(p) * 2.0) * uVig.x;
    c = mix(c, uVigColor, v * cover);
  }
  if (uScan.x > 0.0) {
    float line = 0.5 + 0.5 * cos(uv.y * uScan.y * 6.2831853);
    c *= mix(1.0, 1.0 - uScan.x * 0.9, pow(line, 1.5) * cover) ;
  }
  if (uGrain.x > 0.0) {
    vec2 cell = floor(uv * uLookRes / (uGrain.y * max(uLookRes.y, 1.0) / 1080.0));
    vec3 n = vec3(lookHash(cell + 17.0), lookHash(cell + 53.0), lookHash(cell + 91.0));
    n = (uGrain.w > 0.5 ? n : vec3(n.x)) * 2.0 - 1.0;
    vec3 s = pow(max(c, 0.0), vec3(1.0 / 2.2));
    float w = mix(1.0, 1.0 - dot(s, vec3(0.2126, 0.7152, 0.0722)), uGrain.z);
    s += n * (uGrain.x * 0.25 * w * cover);
    c = pow(max(s, 0.0), vec3(2.2));
  }
  if (uLeak.x > 0.0) {
    float asp = uLookRes.x / uLookRes.y;
    float ang = uLeak.z * 6.2831853;
    vec2 dir = vec2(cos(ang), sin(ang));
    vec2 q = (uv - (0.5 + dir * 0.6)) * vec2(asp, 1.0);
    vec2 q2 = (uv - (0.5 + vec2(-dir.y, dir.x) * 0.65)) * vec2(asp, 1.0);
    float s2 = uLeak.y * uLeak.y * 0.5 + 1e-3;
    vec3 leak = uLeakColor * exp(-dot(q, q) / s2) + uLeakColor.gbr * 0.5 * exp(-dot(q2, q2) / (s2 * 0.6));
    leak *= uLeak.x;
    c = (1.0 - (1.0 - clamp(c, 0.0, 1.0)) * (1.0 - clamp(leak, 0.0, 1.0)) * 1.0) * cover + c * (1.0 - cover);
  }
  if (uDust.x > 0.0) c = mix(c, uDustColor, lookDustMarks(uv) * uDust.w * cover);
  return c;
}
`;

/**
 * The glow of bloom: the bright parts of a picture (above a threshold) are shrunk through a chain of smaller and smaller targets and
 * added back up, which gives a glow that is wide and smooth for little work. The result is the texture of the biggest target (half the
 * size of the picture), which the final pass adds to the picture.
 */
export class BloomPass {
  private targets: THREE.WebGLRenderTarget[] = [];
  private key = "";
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;
  private readonly prefilter: THREE.ShaderMaterial;
  private readonly down: THREE.ShaderMaterial;
  private readonly up: THREE.ShaderMaterial;
  private static readonly LEVELS = 5;

  constructor() {
    const vertexShader = "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";
    const make = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>, additive = false) => new THREE.ShaderMaterial({
      uniforms, vertexShader, fragmentShader, depthTest: false, depthWrite: false,
      ...(additive ? { transparent: true, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor } : {}),
    });
    this.prefilter = make(`uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold;
varying vec2 vUv;
vec3 knee(vec3 c) {
  float br = max(c.r, max(c.g, c.b));
  float k = 0.5 * max(uThreshold, 0.05);
  float soft = clamp(br - uThreshold + k, 0.0, 2.0 * k);
  soft = soft * soft / (4.0 * k + 1e-4);
  return c * (max(soft, br - uThreshold) / max(br, 1e-4));
}
void main() {
  vec3 c = knee(texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb) + knee(texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb)
         + knee(texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb) + knee(texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb);
  gl_FragColor = vec4(c * 0.25, 1.0);
}`, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 0.8 } });
    this.down = make(`uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
  c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  gl_FragColor = vec4(c / 8.0, 1.0);
}`, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.up = make(`uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uWeight; varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-1.0, 0.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 0.0)).rgb
         + texture2D(tSrc, vUv + uTexel * vec2(0.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(0.0, 1.0)).rgb;
  c += 2.0 * (texture2D(tSrc, vUv + uTexel * vec2(-0.5, 0.5)).rgb + texture2D(tSrc, vUv + uTexel * vec2(0.5, 0.5)).rgb
            + texture2D(tSrc, vUv + uTexel * vec2(0.5, -0.5)).rgb + texture2D(tSrc, vUv + uTexel * vec2(-0.5, -0.5)).rgb);
  gl_FragColor = vec4(c / 12.0 * uWeight, 1.0);
}`, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uWeight: { value: 0.7 } }, true);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.prefilter);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  private ensure(w: number, h: number) {
    const key = `${w}x${h}`;
    if (key === this.key) return;
    this.key = key;
    this.targets.forEach((t) => t.dispose());
    this.targets = Array.from({ length: BloomPass.LEVELS }, (_, i) => new THREE.WebGLRenderTarget(
      Math.max(1, Math.ceil(w / 2 ** (i + 1))), Math.max(1, Math.ceil(h / 2 ** (i + 1))),
      { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, colorSpace: THREE.NoColorSpace },
    ));
  }

  private pass(r: THREE.WebGLRenderer, material: THREE.ShaderMaterial, source: THREE.Texture, texel: THREE.Vector2, target: THREE.WebGLRenderTarget, clear: boolean) {
    this.quad.material = material;
    material.uniforms.tSrc.value = source;
    (material.uniforms.uTexel.value as THREE.Vector2).copy(texel);
    r.setRenderTarget(target);
    r.autoClear = clear;
    r.render(this.scene, this.camera);
  }

  /** The glow of `source` (a picture `w` x `h` pixels): returns the texture to add to the picture, scaled by the intensity of the effect. */
  render(r: THREE.WebGLRenderer, source: THREE.Texture, w: number, h: number, s: BloomState): THREE.Texture {
    this.ensure(w, h);
    const t = this.targets;
    const prevTarget = r.getRenderTarget(), prevAuto = r.autoClear;
    const texel = new THREE.Vector2();
    this.prefilter.uniforms.uThreshold.value = s.threshold;
    this.pass(r, this.prefilter, source, texel.set(0.5 / w, 0.5 / h), t[0], true);
    for (let i = 1; i < t.length; i++) this.pass(r, this.down, t[i - 1].texture, texel.set(0.5 / t[i].width, 0.5 / t[i].height), t[i], true);
    // the further the glow should spread, the more of every smaller level is added back
    this.up.uniforms.uWeight.value = 0.35 + 0.6 * s.radius;
    for (let i = t.length - 2; i >= 0; i--) this.pass(r, this.up, t[i + 1].texture, texel.set(0.5 / t[i + 1].width, 0.5 / t[i + 1].height), t[i], false);
    r.setRenderTarget(prevTarget);
    r.autoClear = prevAuto;
    return t[0].texture;
  }

  dispose() {
    this.targets.forEach((t) => t.dispose());
    this.targets = [];
    this.prefilter.dispose();
    this.down.dispose();
    this.up.dispose();
    this.quad.geometry.dispose();
  }
}
