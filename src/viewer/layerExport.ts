/**
 * The layered export: a picture of the scene as a Photoshop file with the post-processing effects on layers of their own, each with the
 * blend mode that gives the effect back when the layers are put together (a vignette multiplies, bloom and light leaks screen, grain is a
 * linear light layer that adds to the picture, and so on).
 *
 * What cannot be a layer is part of the bottom "Scene" layer: everything that resamples the picture (distortion, chromatic aberration,
 * pixelate, depth of field, motion blur), the colour work (grade, duotone, posterise), and what is drawn in the 3D scene itself (the ground
 * shadows, the reflection in the floor). The fresnel rim lights are drawn in the scene too, but each gets a layer of its own, found by drawing
 * the scene again without it, so that a rim can be changed or turned off in Photoshop. Layers have the same size as the picture; the merged picture in the file is the
 * picture the app draws itself.
 *
 * The blend modes work on the colours as they are stored (sRGB), while the app mixes its light in linear space, so a layer is made to give
 * the right result there (a multiply layer holds the factor in sRGB, the grain layer holds what to add in sRGB). A merge in Photoshop is
 * close to the app's picture but not bit for bit.
 */
import { writePsd } from "ag-psd";
import type { LookStates } from "./look";

export type LayerBlend = "normal" | "multiply" | "screen" | "linear light";

/** The numbers `uLayer` has in the capture shader. 0 is the whole picture. */
export const LAYER_SHADER = { ao: 1, fog: 2, bloom: 3, vignette: 4, scanlines: 5, grain: 6, leaks: 7, dust: 8 } as const;

export interface LayerSpec {
  name: string;
  blend: LayerBlend;
  /** 0: the picture without the effects that are layers of their own (the "Scene"); otherwise a value of LAYER_SHADER. */
  shader: number;
  /** The vignette is a colour over the picture (1) instead of a multiplication (0). */
  alt?: number;
}

/** A layer as the capture hands it over: straight RGBA, top row first. */
export interface ExportLayer {
  name: string;
  blend: LayerBlend;
  data: Uint8ClampedArray;
}

const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;

/** The layers to make, from the bottom up, for the effects that are on. */
export function planLayers(look: LookStates, has: { ao: boolean; fog: boolean }): LayerSpec[] {
  const out: LayerSpec[] = [{ name: "Scene", blend: "normal", shader: 0 }];
  if (has.ao) out.push({ name: "Ambient occlusion", blend: "multiply", shader: LAYER_SHADER.ao });
  if (has.fog) out.push({ name: "Fog", blend: "normal", shader: LAYER_SHADER.fog });
  if (look.bloom?.enabled && look.bloom.intensity > 0) out.push({ name: "Bloom", blend: "screen", shader: LAYER_SHADER.bloom });
  const v = look.vignette;
  if (v?.enabled && v.strength > 0) {
    // a dark vignette multiplies; a light or coloured one is a colour that fades in over the picture
    const bright = Math.max(channel(v.color, 0), channel(v.color, 1), channel(v.color, 2)) > 0.35;
    out.push({ name: "Vignette", blend: bright ? "normal" : "multiply", shader: LAYER_SHADER.vignette, alt: bright ? 1 : 0 });
  }
  if (look.scanlines?.enabled && look.scanlines.strength > 0) out.push({ name: "Scanlines", blend: "multiply", shader: LAYER_SHADER.scanlines });
  if (look.grain?.enabled && look.grain.amount > 0) out.push({ name: "Film grain", blend: "linear light", shader: LAYER_SHADER.grain });
  if (look.leaks?.enabled && look.leaks.strength > 0) out.push({ name: "Light leaks", blend: "screen", shader: LAYER_SHADER.leaks });
  if (look.dust?.enabled && look.dust.amount > 0 && look.dust.opacity > 0) out.push({ name: "Dust", blend: "normal", shader: LAYER_SHADER.dust });
  return out;
}

/** The name of the layer of the k-th rim light (1-based) when there are `count` of them. */
export const rimLayerName = (k: number, count: number) => (count > 1 ? `Fresnel rim light ${k}` : "Fresnel rim light");

/**
 * The layer of a rim light (screen blend), from the picture without it (`under`) and with it (`over`): straight RGBA, same size, and both
 * are the stored (sRGB) values of the Scene layer. The layer holds, for every colour, the value that a screen blend needs to turn the one
 * into the other, so that the layers merge back to the picture; where the light adds nothing it is black (a screen of black changes nothing).
 * The rim is the shading of a surface, so the layer has the alpha of the picture.
 */
export function rimLayerPixels(under: Uint8ClampedArray, over: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(over.length);
  for (let i = 0; i < over.length; i += 4) {
    out[i + 3] = over[i + 3];
    for (let c = 0; c < 3; c++) {
      const u = under[i + c] / 255, o = over[i + c] / 255;
      if (o <= u) continue;
      out[i + c] = Math.round(255 * Math.min(1, Math.max(0, 1 - (1 - o) / Math.max(1 - u, 1e-3))));
    }
  }
  return out;
}

/**
 * Puts the alpha of a normal layer (straight RGBA, changed in place) where it makes a normal blend of the layer over `under` give `over`
 * (all three the stored sRGB values). The app mixes a surface with what is behind it in linear light, a blend in the file mixes the stored
 * values, so the plain alpha of the picture would give a different colour wherever the layer is partly see-through (the soft edges, the
 * shadows, a ground plane that is not opaque). One alpha serves the three colours, weighted by how far the layer's colour is from what is
 * under it in each. Where the colour is nearly what is under it the alpha cannot be told, and it stays.
 */
export function adaptAlpha(layer: Uint8ClampedArray, under: Uint8ClampedArray, over: Uint8ClampedArray): void {
  for (let i = 0; i < layer.length; i += 4) {
    if (layer[i + 3] === 0) continue;
    let den = 0, got = 0;
    for (let c = 0; c < 3; c++) {
      const d = layer[i + c] - under[i + c];
      den += Math.abs(d);
      got += (over[i + c] - under[i + c]) * Math.sign(d);
    }
    if (den < 24) continue;
    layer[i + 3] = Math.round(255 * Math.min(1, Math.max(0, got / den)));
  }
}

/** The effects that stay in the Scene layer: the ones that read the picture differently or change its colours. */
export function sceneOnlyLook(look: LookStates): LookStates {
  return { aberration: look.aberration, distortion: look.distortion, pixelate: look.pixelate, grade: look.grade, duotone: look.duotone, posterise: look.posterise };
}

/**
 * The part of the capture shader that draws one layer, in linear light (the render target stores sRGB). `scene` is the picture as the lens
 * sees it, `su` where what lies over the picture (the occlusion and the fog) is read, `uv` the place in the picture. A layer is straight
 * colour with an alpha that is where the effect is: the effects do not draw over what is empty in a picture with a transparent background.
 */
export const LAYER_GLSL = /* glsl */ `
uniform int uLayer;
uniform float uLayerAlt;
vec3 layerLinear(vec3 g) { return mix(g / 12.92, pow((g + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), g)); }
vec3 layerGamma(vec3 c) { c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
// The blend modes of a layered file work on the stored (sRGB) values and the picture is mixed in linear light, so every layer is made for
// the picture under it: the value of a multiply layer that takes \`under\` to \`result\` ...
// (where under is black nothing can be told from the two, so there the layer has the factor it was made with, k: no black holes)
vec3 layerMultiply(vec3 under, vec3 result, vec3 k) {
  vec3 gu = layerGamma(under);
  return clamp(mix(layerGamma(k), layerGamma(result) / max(gu, vec3(1e-3)), smoothstep(vec3(0.0), vec3(0.05), gu)), 0.0, 1.0);
}
// ... the value of a screen layer that takes \`under\` to \`result\` (which is not darker) ...
vec3 layerScreen(vec3 under, vec3 result) { return clamp(1.0 - (1.0 - layerGamma(result)) / max(1.0 - layerGamma(under), vec3(1e-3)), 0.0, 1.0); }
// ... and the alpha of a normal layer of colour \`col\` that takes \`under\` to \`result\` (one alpha for the three channels, weighted by how far
// the colour is from what is under it in each).
float layerAlpha(vec3 under, vec3 col, vec3 result) {
  vec3 gu = layerGamma(under);
  vec3 d = layerGamma(col) - gu;
  float den = dot(abs(d), vec3(1.0));
  return den < 1e-3 ? 0.0 : clamp(dot((layerGamma(result) - gu) * sign(d), vec3(1.0)) / den, 0.0, 1.0);
}
vec4 lookLayer(vec4 scene, vec2 su, vec2 uv) {
  float a0 = uTransparent ? clamp(scene.a, 0.0, 1.0) : 1.0;
  float sceneCover = uTransparent ? clamp(max(a0, max(scene.r, max(scene.g, scene.b))), 0.0, 1.0) : 1.0;
  vec3 fogOver;
  float ff = fogFree(su);
  float fRaw = fogLayers(su, fogOver);
  float f = fRaw * (1.0 - ff);
  float cover = uTransparent ? clamp(f + sceneCover * (1.0 - f), 0.0, 1.0) : 1.0;
  // the picture as it is built up, layer by layer: the occlusion, the fog, bloom (and then the colour work, which is part of the Scene layer
  // but works on all of that), the vignette, the scanlines, the grain and the light leaks
  vec3 u0 = aoApply(scene.rgb, su);
  vec3 aoK = u0 / max(scene.rgb, vec3(0.0001)); // (as a multiplication: what the occlusion layer shows)
  vec3 u1 = fogOver * (1.0 - ff) + u0 * (1.0 - f);
  vec3 bloom = uBloomK > 0.0 ? clamp(texture2D(tBloom, uv).rgb * uBloomK, 0.0, 1.0) : vec3(0.0);
  vec3 u2 = u1 + bloom;
  vec3 t0 = lookTone(scene.rgb, sceneCover), t1 = lookTone(u0, cover), t2 = lookTone(u1, cover), t3 = lookTone(u2, cover);
  vec2 p = uv - 0.5;
  p.x *= mix(1.0, uLookRes.x / uLookRes.y, uVig.w);
  float vig = smoothstep(uVig.y, uVig.z, length(p) * 2.0) * uVig.x * cover;
  vec3 u3 = mix(t3, uVigColor, vig);
  float line = 0.5 + 0.5 * cos(uv.y * uScan.y * 6.2831853);
  vec3 u4 = u3 * (1.0 - uScan.x * 0.9 * pow(line, 1.5) * cover);
  vec2 cell = floor(uv * uLookRes / (uGrain.y * max(uLookRes.y, 1.0) / 1080.0));
  vec3 n = vec3(lookHash(cell + 17.0), lookHash(cell + 53.0), lookHash(cell + 91.0));
  n = (uGrain.w > 0.5 ? n : vec3(n.x)) * 2.0 - 1.0;
  float gw = mix(1.0, 1.0 - dot(pow(max(u4, 0.0), vec3(1.0 / 2.2)), vec3(0.2126, 0.7152, 0.0722)), uGrain.z);
  vec3 grain = n * (uGrain.x * 0.25 * gw * cover);
  vec3 u5 = pow(max(pow(max(u4, 0.0), vec3(1.0 / 2.2)) + grain, 0.0), vec3(2.2));
  float asp = uLookRes.x / uLookRes.y;
  float ang = uLeak.z * 6.2831853;
  vec2 dir = vec2(cos(ang), sin(ang));
  vec2 q = (uv - (0.5 + dir * 0.6)) * vec2(asp, 1.0);
  vec2 q2 = (uv - (0.5 + vec2(-dir.y, dir.x) * 0.65)) * vec2(asp, 1.0);
  float s2 = uLeak.y * uLeak.y * 0.5 + 1e-3;
  vec3 leak = clamp((uLeakColor * exp(-dot(q, q) / s2) + uLeakColor.gbr * 0.5 * exp(-dot(q2, q2) / (s2 * 0.6))) * uLeak.x, 0.0, 1.0);
  vec3 u6 = (1.0 - (1.0 - clamp(u5, 0.0, 1.0)) * (1.0 - leak)) * cover + u5 * (1.0 - cover);
  float dustMix = uDust.x > 0.0 ? lookDustMarks(uv) * uDust.w * cover : 0.0;

  vec3 fogColor = lookTone(clamp(fogOver / max(fRaw, 1e-4), 0.0, 1.0), cover);
  if (uLayer == ${LAYER_SHADER.ao}) return vec4(layerLinear(layerMultiply(t0, t1, aoK)), sceneCover);
  if (uLayer == ${LAYER_SHADER.fog}) return vec4(fogColor, mix(f, layerAlpha(t1, fogColor, t2), sceneCover));
  if (uLayer == ${LAYER_SHADER.bloom}) return vec4(layerLinear(layerScreen(t2, t3)), uTransparent ? max(bloom.r, max(bloom.g, bloom.b)) : 1.0);
  if (uLayer == ${LAYER_SHADER.vignette}) return uLayerAlt > 0.5 ? vec4(uVigColor, layerAlpha(t3, uVigColor, u3)) : vec4(layerLinear(layerMultiply(t3, u3, mix(vec3(1.0), uVigColor, vig))), cover);
  if (uLayer == ${LAYER_SHADER.scanlines}) return vec4(layerLinear(layerMultiply(u3, u4, vec3(1.0 - uScan.x * 0.9 * pow(line, 1.5) * cover))), cover);
  // a linear light layer adds twice what it is over a half: so half, and half of what the grain adds
  if (uLayer == ${LAYER_SHADER.grain}) return vec4(layerLinear(clamp(0.5 + grain * 0.5, 0.0, 1.0)), cover);
  if (uLayer == ${LAYER_SHADER.leaks}) return vec4(layerLinear(layerScreen(u5, u6)), cover);
  if (uLayer == ${LAYER_SHADER.dust}) return vec4(uDustColor, layerAlpha(u6, uDustColor, mix(u6, uDustColor, dustMix)));
  return vec4(0.0);
}
`;

/** The PSD of a picture: the merged picture, and the layers (from the bottom up). `merged` and the layers are straight RGBA, top row first. */
export function buildPsd(width: number, height: number, merged: Uint8ClampedArray, layers: ExportLayer[]): ArrayBuffer {
  return writePsd({
    width,
    height,
    imageData: { width, height, data: merged },
    children: layers.map((l) => ({ name: l.name, blendMode: l.blend, opacity: 1, top: 0, left: 0, imageData: { width, height, data: l.data } })),
  }, { noBackground: true, generateThumbnail: false });
}
