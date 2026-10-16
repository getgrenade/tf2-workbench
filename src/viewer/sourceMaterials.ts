import * as THREE from "three";
import { particleBlending } from "./particles/blending";
import { eyeFragmentShader, eyeVertexShader } from "./eyeShader";
import { parseVec, resolvePhongTint, type EyeballData, type MaterialData, type TextureData } from "./payload";
import { animationFrame, baseTextureAnimation, evaluateMaterialVars, hasTimeProxies, type FrameAnimation, type MaterialEffects, modulationColor, textureTransform, type Rgb } from "./proxies";
import { fragmentShader, vertexShader } from "./sourceShader";
import { loadTextureFrames } from "../api";

/** The frames of an animated detail texture from the bytes of `loadTextureFrames`: width, height, count (u32 little endian), then RGBA8 frames. */
export function parseTextureFrames(buffer: ArrayBuffer): TextureData[] {
  const header = new DataView(buffer);
  if (buffer.byteLength < 12) return [];
  const width = header.getUint32(0, true), height = header.getUint32(4, true), count = header.getUint32(8, true);
  const size = width * height * 4;
  if (!size || buffer.byteLength < 12 + count * size) return [];
  return Array.from({ length: count }, (_, i) => ({ width, height, rgba: new Uint8Array(buffer, 12 + i * size, size) }) as TextureData);
}

/** Uniform objects shared by every material so one update relights the whole scene. */
export type SharedUniforms = Record<string, THREE.IUniform>;

/** A material whose proxies depend on time (Sine, TextureScroll, ...): re-evaluated every frame. */
interface DynamicMaterial {
  material: THREE.ShaderMaterial;
  data: MaterialData;
  paint: Rgb | null;
  fx?: MaterialEffects;
  frames: THREE.Texture[];
  anim: FrameAnimation | null;
  /** The frames of an animated normal map ($bumpmap), which the Ubercharge material cycles. */
  bumpFrames?: THREE.Texture[];
  bumpAnim?: FrameAnimation | null;
  /** The fire layer of a burning character ($detail with blend mode 6): its texture name and animation; the frames arrive when loaded. */
  detail?: string;
  detailAnim?: FrameAnimation | null;
}

/**
 * Source-style materials and their textures: decodes VMT data into shader materials, caches textures, and keeps the
 * time driven proxies of the materials in use up to date.
 */
export class SourceMaterials {
  readonly textures = new Map<string, THREE.Texture>();
  readonly emptyCube = new THREE.CubeTexture(
    Array.from({ length: 6 }, () => makeTexture({ width: 1, height: 1, rgba: new Uint8Array([0, 0, 0, 255]) }, "linear")),
  );
  readonly white = makeTexture({ width: 1, height: 1, rgba: new Uint8Array([255, 255, 255, 255]) }, "srgb");
  wireframe = false;
  private dynamic: DynamicMaterial[] = [];
  /** Animated detail textures by name, once loaded (null: loading or unavailable). */
  private readonly detailFrames = new Map<string, THREE.Texture[] | null>();
  /** Materials shared by every mesh that uses the same VMT and paint (they hold no per-entity state). */
  private cache = new Map<string, THREE.ShaderMaterial>();

  constructor(
    private readonly maxAnisotropy: number,
    readonly shared: SharedUniforms,
  ) {}

  texture(m: MaterialData, slot: string): THREE.Texture | null {
    const data = m.textures[slot];
    if (!data) return null;
    const key = `${m.path}#${slot}`;
    let tex = this.textures.get(key);
    if (!tex) {
      tex = makeTexture(data, slot === "base" || slot.startsWith("base_f") || slot === "ao" || slot === "tex2" ? "srgb" : slot === "warp" || slot === "phongwarp" ? "warp" : "linear");
      tex.anisotropy = this.maxAnisotropy;
      this.textures.set(key, tex);
    }
    return tex;
  }

  cubemap(m: MaterialData): THREE.CubeTexture | null {
    const key = `${m.path}#cube`;
    let cube = this.textures.get(key) as THREE.CubeTexture | undefined;
    if (!cube) {
      const faces = [0, 1, 2, 3, 4, 5].map((i) => m.textures[`env${i}`]);
      if (faces.some((f) => !f)) return null;
      // Face images keep their file order (+X -X +Y -Y +Z -Z in Source axes); D3D and GL share face orientation.
      cube = new THREE.CubeTexture(faces.map((f) => makeTexture(f, "srgb")));
      cube.colorSpace = THREE.SRGBColorSpace;
      cube.generateMipmaps = true;
      cube.minFilter = THREE.LinearMipmapLinearFilter;
      cube.magFilter = THREE.LinearFilter;
      cube.flipY = false;
      cube.needsUpdate = true;
      this.textures.set(key, cube);
    }
    return cube;
  }

  /** EyeRefract material; `eye` carries the origin and iris projection from the MDL eyeball. */
  makeEyeMaterial(m: MaterialData, eye: EyeballData): THREE.ShaderMaterial {
    const p = m.params;
    const num = (k: string, d: number) => (p[k] !== undefined && !Number.isNaN(Number(p[k])) ? Number(p[k]) : d);
    const black = this.white;
    const cornea = this.texture(m, "cornea");
    const iris = this.texture(m, "base");
    const ao = this.texture(m, "ao");
    const warp = this.texture(m, "warp");
    const cube = this.cubemap(m);
    const [aoR, aoG, aoB] = parseVec(p["$ambientocclcolor"], [0.33, 0.33, 0.33]);
    return new THREE.ShaderMaterial({
      vertexShader: eyeVertexShader,
      fragmentShader: eyeFragmentShader,
      wireframe: this.wireframe,
      uniforms: {
        ...this.shared,
        tCornea: { value: cornea ?? black },
        tIris: { value: iris ?? black },
        tAO: { value: ao ?? black },
        tWarp: { value: warp ?? black },
        tCube: { value: cube ?? this.emptyCube },
        uHasWarp: { value: !!warp },
        uHasCube: { value: !!cube },
        uEnvWorld: { value: (p["$envmap"] ?? "").toLowerCase() === "env_cubemap" },
        uHalfLambert: { value: Number(p["$halflambert"] ?? 0) !== 0 },
        uEyeOrigin: { value: new THREE.Vector3(...eye.origin) },
        uIrisU: { value: new THREE.Vector4(...eye.irisU) },
        uIrisV: { value: new THREE.Vector4(...eye.irisV) },
        uDilation: { value: num("$dilation", 0.5) },
        uGlossiness: { value: num("$glossiness", 1) },
        uCorneaBumpStrength: { value: num("$corneabumpstrength", 1) },
        uParallaxStrength: { value: num("$parallaxstrength", 0.25) },
        uAmbientOcclColor: { value: new THREE.Vector3(aoR, aoG, aoB) },
      },
    });
  }

  /**
   * The material for a mesh: shared between entities for the same VMT and paint, except eye materials, which carry
   * the eyeball's own constants. Shared materials are never disposed (their textures are cached anyway).
   */
  material(m: MaterialData | null, eye?: EyeballData, paint: Rgb | null = null, fx?: MaterialEffects): THREE.ShaderMaterial {
    if (m && eye && m.shader === "eyerefract") return this.makeMaterial(m, eye, paint);
    const key = `${m?.path ?? ""}|${paint ? paint.join(",") : ""}${fx ? `|${JSON.stringify(fx)}` : ""}`;
    let mat = this.cache.get(key);
    if (!mat) {
      mat = this.makeMaterial(m, undefined, paint, fx);
      mat.userData.shared = true;
      this.cache.set(key, mat);
    }
    return mat;
  }

  /** Starts loading the frames of a detail texture (once); materials that use it pick them up on their next update. */
  private loadDetail(name: string) {
    if (this.detailFrames.has(name)) return;
    this.detailFrames.set(name, null);
    Promise.resolve().then(() => loadTextureFrames(name)).then((buffer) => {
      const frames = parseTextureFrames(buffer).map((frame) => makeTexture(frame, "srgb"));
      this.detailFrames.set(name, frames.length ? frames : null);
    }).catch((error) => console.error(`Detail texture ${name} unavailable`, error));
  }

  /** Forgets the materials and textures of the VMT paths `match` accepts, so they are read again (their files changed). */
  purge(match: (path: string) => boolean) {
    for (const [k, tex] of [...this.textures]) {
      if (!match(k.split("#")[0])) continue;
      tex.dispose();
      this.textures.delete(k);
    }
    for (const k of [...this.cache.keys()]) if (match(k.split("|")[0])) this.cache.delete(k);
  }

  setWireframe(on: boolean) {
    this.wireframe = on;
    for (const mat of this.cache.values()) mat.wireframe = on;
  }

  /** Builds the Source-style material for a VMT (or a flat gray fallback). */
  makeMaterial(m: MaterialData | null, eye?: EyeballData, paint: Rgb | null = null, fx?: MaterialEffects): THREE.ShaderMaterial {
    if (m && eye && m.shader === "eyerefract") return this.makeEyeMaterial(m, eye);
    const p = m?.params ?? {};
    const flag = (k: string) => Number(p[k] ?? 0) !== 0;
    const num = (k: string, d: number) => (p[k] !== undefined && !Number.isNaN(Number(p[k])) ? Number(p[k]) : d);

    const base = m ? this.texture(m, "base") : null;
    // a self-shadowing bump map ($ssbump) holds the weights of three lighting directions, not a normal: read as one it would only darken
    const bump = m && !flag("$ssbump") ? this.texture(m, "bump") : null;
    const warp = m ? this.texture(m, "warp") : null;
    const phongWarp = m ? this.texture(m, "phongwarp") : null;
    const exp = m ? this.texture(m, "exponent") : null;
    const tex2 = m ? this.texture(m, "tex2") : null;
    // DecalModulate (a bullet hole modelled as a quad): the picture multiplies what is behind it (2 * src * dst), so mid grey leaves it unchanged
    const decalModulate = m?.shader === "decalmodulate";
    const unlit = m?.shader === "unlitgeneric" || m?.shader === "unlittwotexture" || decalModulate;
    const envMask = m ? this.texture(m, "envmask") : null;
    const illumMask = m ? this.texture(m, "illum") : null;
    // a detail layer that colours the base (the burn's mode 6 is a layer of its own)
    const detailMode = num("$detailblendmode", 0);
    const detailMat = m && [0, 1, 8].includes(detailMode) && p["$detail"] ? this.texture(m, "detail") : null;
    const [fMin, fMid, fMax] = parseVec(p["$phongfresnelranges"], [0, 0.5, 1]);
    const eyes = m?.shader === "eyerefract"; // eyerefract without eyeball data falls back to this shader
    // Refract bends what is behind it; there is no picture of that to bend here, so it is drawn as the clear, tinted glass it stands for
    const refract = m?.shader === "refract";
    const translucent = flag("$translucent") || refract;
    const alphaTest = flag("$alphatest");
    const grayFallback = !base;
    const envCube = m ? this.cubemap(m) : null;
    // The proxies (ItemTintColor -> SelectFirstIfNonZero -> ... -> $color2) decide the tint: an item's paint,
    // else its $colortint_base. The shader gets $color * $color2 in linear space.
    const now = performance.now() / 1000;
    const vars = evaluateMaterialVars(p, m?.proxies ?? [], { paint, time: now, fx });
    const modulation = modulationColor(vars);
    if (refract && p["$refracttint"]) {
      const t = parseVec(p["$refracttint"], [1, 1, 1]);
      for (let i = 0; i < 3; i++) modulation[i] *= Math.pow(Math.min(Math.max(t[i] ?? t[0], 0), 1), 2.2);
    }
    const xf = textureTransform(vars);
    const detailXf = textureTransform(vars, "$detailtexturetransform");
    const selfIllum = flag("$selfillum");
    // The shaders do not have a combination of $blendtintbybasealpha with $selfillum (both read the base alpha): the glowing layer of an item
    // that has both (the ghost trail of the Haunted Henchman) is tinted as a whole, the way HLMV draws it, not by its alpha.
    const blendTint = flag("$blendtintbybasealpha") && !selfIllum;
    const [siMin, siMax, siExp] = parseVec(p["$selfillumfresnelminmaxexp"], [0, 1, 1]);
    const siBias = siMax !== 0 ? siMin / siMax : 0;
    // proxies may drive the tint (Sine on $selfillumtint pulses the glow)
    const siTintVar = vars["$selfillumtint"];
    const siTint = siTintVar ? [siTintVar[0] ?? 1, siTintVar[1] ?? siTintVar[0] ?? 1, siTintVar[2] ?? siTintVar[0] ?? 1] : parseVec(p["$selfillumtint"], [1, 1, 1]);
    const additive = flag("$additive");
    const envTint = parseVec(p["$envmaptint"], [1, 1, 1]);
    const phong = flag("$phong") && !eyes;
    // WantsSkinShader() in vertexlitgeneric_dx9_helper.cpp: phong materials with a lightwarp (or
    // base-alpha phong mask, or a bump map) are drawn by the Skin shader, which forces half-lambert.
    const skinPath = phong && (!!warp || flag("$basemapalphaphongmask") || !!bump);
    // a phong tint the proxies make (the paint chain: $color2 * $yellow ...) is the tint the material has
    const proxiedTint = (m?.proxies ?? []).some((x) => Object.entries(x.params).some(([k, v]) => k.toLowerCase() === "resultvar" && v.toLowerCase() === "$phongtint")) ? vars["$phongtint"] : undefined;
    const tint = resolvePhongTint(proxiedTint ? { ...p, "$phongtint": proxiedTint.join(" ") } : p, !!exp);

    const material = new THREE.ShaderMaterial({
      // translucent and additive layers (glass, glows) do not cast a ground shadow
      userData: { noShadow: translucent || additive || decalModulate },
      vertexShader,
      fragmentShader,
      wireframe: this.wireframe,
      side: flag("$nocull") ? THREE.DoubleSide : THREE.FrontSide,
      transparent: translucent || additive,
      // $additive adds the colour to the frame without writing depth. The engine blends it as SRC_ALPHA, ONE when the base
      // texture has alpha (BT_BLENDADD: the Jarate liquid is added at ~40%), and the shader multiplies the output alpha by the
      // base alpha (except with self-illum / blend-tint). Textures without alpha have alpha 1, which makes that a plain add.
      ...(additive ? { ...particleBlending(true), depthWrite: false } : {}),
      ...(decalModulate ? { transparent: true, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.SrcColorFactor, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 } : {}),
      uniforms: {
        ...this.shared,
        tBase: { value: base ?? this.white },
        tBodyMask: { value: this.white },
        uBodyHideBits: { value: 0 },
        tBump: { value: bump ?? this.white },
        tWarp: { value: warp ?? this.white },
        tPhongWarp: { value: phongWarp ?? this.white },
        uHasPhongWarp: { value: !!phongWarp },
        tExp: { value: exp ?? this.white },
        uHasBump: { value: !!bump },
        uUnlit: { value: unlit },
        uDecalModulate: { value: decalModulate },
        tTex2: { value: tex2 ?? this.white },
        uHasTex2: { value: !!tex2 && m?.shader === "unlittwotexture" },
        uMod2x: { value: flag("$mod2x") ? 1 : 0 },
        tDetail: { value: this.white },
        uHasDetail: { value: false },
        uDetailScale: { value: num("$detailscale", 1) },
        uDetailBlend: { value: 0 },
        tDetailMat: { value: detailMat ?? this.white },
        uDetailMode: { value: detailMat ? detailMode : -1 },
        uDetailXf: { value: new THREE.Matrix3().set(detailXf?.[0] ?? 1, detailXf?.[1] ?? 0, detailXf?.[2] ?? 0, detailXf?.[3] ?? 0, detailXf?.[4] ?? 1, detailXf?.[5] ?? 0, 0, 0, 1) },
        uDetailAmount: { value: vars["$detailblendfactor"]?.[0] ?? 1 },
        uHasWarp: { value: !!warp },
        uHasExp: { value: !!exp },
        tEnvMask: { value: envMask ?? this.white },
        tIllumMask: { value: illumMask ?? this.white },
        uHasEnvMask: { value: !!envMask },
        uHasIllumMask: { value: !!illumMask },
        uSelfIllumEnvMaskAlpha: { value: flag("$selfillum_envmapmask_alpha") && !!envMask },
        uHalfLambert: { value: flag("$halflambert") },
        uPhong: { value: phong },
        uSkinPath: { value: skinPath },
        uSpecTint: { value: new THREE.Vector3(tint[0], tint[1], tint[2]) },
        uPhongExponent: { value: num("$phongexponent", 5) },
        uPhongBoost: { value: num("$phongboost", 1) },
        uFresnel: { value: new THREE.Vector3((fMid - fMin) * 2, fMid, (fMax - fMid) * 2) },
        uBaseAlphaPhongMask: { value: flag("$basemapalphaphongmask") },
        uRim: { value: flag("$rimlight") },
        // The engine keeps the rim power at 1 or more (`max( power, 1.0f )` in skin_dx9_helper.cpp).
        uRimExponent: { value: Math.max(num("$rimlightexponent", 4), 1) },
        uRimBoost: { value: num("$rimlightboost", 1) },
        uRimMask: { value: flag("$rimmask") },
        uTint: { value: grayFallback ? new THREE.Vector3(0.72, 0.74, 0.77) : new THREE.Vector3(1, 1, 1) },
        uAlphaTest: { value: alphaTest ? num("$alphatestreference", 0.7) : 0 },
        uOpacity: { value: refract ? 0.3 : num("$alpha", 1) },
        // With self-illum or blend-tint the base alpha is a mask, not opacity.
        uUseBaseAlpha: { value: (translucent || alphaTest || additive) && !selfIllum && !blendTint },
        tCube: { value: envCube ?? this.emptyCube },
        uHasEnv: { value: !!envCube },
        uEnvWorld: { value: (p["$envmap"] ?? "").toLowerCase() === "env_cubemap" },
        uEnvTint: { value: new THREE.Vector3(envTint[0], envTint[1], envTint[2]) },
        uEnvFresnel: { value: num("$envmapfresnel", 0) },
        uEnvMaskNormalAlpha: { value: flag("$normalmapalphaenvmapmask") },
        uEnvMaskBaseAlpha: { value: flag("$basealphaenvmapmask") || flag("$basemapalphaenvmapmask") },
        uEnvContrast: { value: num("$envmapcontrast", 0) },
        uEnvSaturation: { value: num("$envmapsaturation", 1) },
        uEnvScale: { value: 1 },
        uInvertPhongMask: { value: flag("$invertphongmask") },
        uModulation: { value: new THREE.Vector3(modulation[0], modulation[1], modulation[2]) },
        uUvXf: { value: new THREE.Matrix3().set(xf?.[0] ?? 1, xf?.[1] ?? 0, xf?.[2] ?? 0, xf?.[3] ?? 0, xf?.[4] ?? 1, xf?.[5] ?? 0, 0, 0, 1) },
        uBlendTint: { value: blendTint },
        uTintReplace: { value: num("$blendtintcoloroverbase", 0) },
        uSelfIllum: { value: selfIllum },
        uSelfIllumTint: { value: new THREE.Vector3(siTint[0], siTint[1], siTint[2]) },
        uSelfIllumFresnel: { value: flag("$selfillumfresnel") },
        uSelfIllumFresnelParams: { value: new THREE.Vector4(1 - siBias, siBias, siExp, siMax) },
      },
    });
    // Animated base textures (the Festive lights): frame 0 is `base`, the others `base_f1`, `base_f2`, ...
    const anim = m ? baseTextureAnimation(m.proxies) : null;
    const frames: THREE.Texture[] = [];
    if (m && anim) {
      for (let i = 0; ; i++) {
        const t = this.texture(m, i === 0 ? "base" : `base_f${i}`);
        if (!t) break;
        frames.push(t);
      }
    }
    // The burn: $detail (an animated fire texture) added after lighting, its strength driven by BurnLevel (blend mode 6). The
    // frames are read only for a character that is on fire; everyone else's materials do not carry them.
    const detail = m && fx?.burn && num("$detailblendmode", 0) === 6 && p["$detail"] ? p["$detail"] : undefined;
    if (detail) {
      this.loadDetail(detail);
      material.uniforms.uDetailBlend.value = vars["$detailblendfactor"]?.[0] ?? 0;
    }
    const bumpAnim = m ? baseTextureAnimation(m.proxies, "$bumpmap") : null;
    const bumpFrames: THREE.Texture[] = [];
    if (m && bumpAnim) {
      for (let i = 0; ; i++) {
        const t = this.texture(m, i === 0 ? "bump" : `bump_f${i}`);
        if (!t) break;
        bumpFrames.push(t);
      }
    }
    if (m && (hasTimeProxies(m.proxies) || frames.length > 1 || bumpFrames.length > 1 || detail)) {
      this.dynamic.push({ material, data: m, paint, fx, frames, anim, bumpFrames, bumpAnim, detail, detailAnim: detail ? baseTextureAnimation(m.proxies, "$detail") : null });
    }
    return material;
  }


  /** Re-runs the time driven proxies and pushes their results into the shader uniforms. */
  updateDynamic(time: number) {
    this.dynamic = this.dynamic.filter((d) => !d.material.userData.disposed);
    for (const { material, data, paint, fx, frames, anim, bumpFrames, bumpAnim, detail, detailAnim } of this.dynamic) {
      if (anim && frames.length > 1) material.uniforms.tBase.value = frames[animationFrame(anim, time, frames.length)];
      if (bumpAnim && bumpFrames && bumpFrames.length > 1) material.uniforms.tBump.value = bumpFrames[animationFrame(bumpAnim, time, bumpFrames.length)];
      const vars = evaluateMaterialVars(data.params, data.proxies, { paint, time, fx });
      const u = material.uniforms;
      const mod = modulationColor(vars);
      u.uModulation.value.set(mod[0], mod[1], mod[2]);
      const xf = textureTransform(vars);
      u.uUvXf.value.set(xf?.[0] ?? 1, xf?.[1] ?? 0, xf?.[2] ?? 0, xf?.[3] ?? 0, xf?.[4] ?? 1, xf?.[5] ?? 0, 0, 0, 1);
      const dxf = textureTransform(vars, "$detailtexturetransform");
      u.uDetailXf.value.set(dxf?.[0] ?? 1, dxf?.[1] ?? 0, dxf?.[2] ?? 0, dxf?.[3] ?? 0, dxf?.[4] ?? 1, dxf?.[5] ?? 0, 0, 0, 1);
      const alpha = vars["$alpha"]?.[0];
      if (alpha !== undefined) u.uOpacity.value = alpha;
      const tint = vars["$selfillumtint"];
      if (tint) u.uSelfIllumTint.value.set(tint[0] ?? 1, tint[1] ?? tint[0] ?? 1, tint[2] ?? tint[0] ?? 1);
      const env = vars["$envmaptint"];
      if (env) u.uEnvTint.value.set(env[0] ?? 1, env[1] ?? env[0] ?? 1, env[2] ?? env[0] ?? 1);
      const fres = vars["$selfillumfresnelminmaxexp"];
      if (fres && fres.length >= 3) {
        const bias = fres[1] !== 0 ? fres[0] / fres[1] : 0;
        u.uSelfIllumFresnelParams.value.set(1 - bias, bias, fres[2], fres[1]);
      }
      const boost = vars["$phongboost"]?.[0];
      if (boost !== undefined) u.uPhongBoost.value = boost;
      if (detail) {
        const layer = this.detailFrames.get(detail);
        if (layer?.length) {
          u.uHasDetail.value = true;
          u.tDetail.value = layer[detailAnim ? animationFrame(detailAnim, time, layer.length) : 0];
        }
        u.uDetailBlend.value = vars["$detailblendfactor"]?.[0] ?? 0;
      }
    }
  }

}

function makeTexture(data: TextureData, kind: "srgb" | "linear" | "warp"): THREE.DataTexture {
  const tex = new THREE.DataTexture(data.rgba, data.width, data.height, THREE.RGBAFormat);
  tex.flipY = false; // Source UVs have v = 0 at the top, like the pixel data
  tex.colorSpace = kind === "srgb" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.magFilter = THREE.LinearFilter;
  if (kind === "warp") {
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
  } else {
    // Source honours the VTF CLAMPS/CLAMPT flags; otherwise samplers repeat.
    tex.wrapS = data.clampS ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    tex.wrapT = data.clampT ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
  }
  tex.needsUpdate = true;
  return tex;
}
