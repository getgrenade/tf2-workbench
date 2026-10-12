import { rigLightingGLSL } from "./lightingShader";
import { bodyMaskDeclarations, bodyMaskDiscard } from "./bodyMaskShader";
import { rimLightGLSL } from "./rimLight";

/**
 * Port of the Source SDK 2013 VertexLitGeneric look used by TF2 models. Two code
 * paths, as in the engine (`WantsSkinShader()` in vertexlitgeneric_dx9_helper.cpp):
 *
 *  - Skin path (phong + lightwarp / base-alpha phong mask / bump): `skin_ps20b.fxc`.
 *    Diffuse is always half-lambert, phong has fresnel ranges, optional rim light.
 *  - Generic path: `vertexlit_and_unlit_generic_bump_ps2x.fxc` (no phong), used for
 *    non-phong materials such as glass and metal items with an envmap.
 *
 * Shared pieces come from common_vertexlitgeneric_dx9.h (ambient cube, DiffuseTerm with
 * lightwarp) and common_ps_fxc.h. Lighting math is linear; output goes through three's
 * sRGB conversion. Not ported: detail textures (burn effect, inactive at rest),
 * self-illum mask texture, flashlight, fog.
 *
 * Space: the model is in bind-pose space, Y up (Source's Z up). The environment cube is
 * indexed in Source axes (x forward, y left, z up), which are (z, x, y) of this space.
 */

export const vertexShader = /* glsl */ `
attribute vec4 tangent;
attribute float hideW;
varying float vHideW;
#include <skinning_pars_vertex>
uniform mat3 uUvXf;
varying vec2 vUv;
varying vec2 vBodyUv;
varying vec3 vWorldPos;
varying vec3 vN;
varying vec4 vT;
void main() {
  vHideW = hideW;
  vBodyUv = uv;
  vUv = (uUvXf * vec3(uv, 1.0)).xy;   // $basetexturetransform after proxies (TextureScroll / TextureTransform)
  vec3 objectNormal = vec3(normal);
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  vec3 objectTangent = tangent.xyz;
  #ifdef USE_SKINNING
    objectTangent = (skinMatrix * vec4(tangent.xyz, 0.0)).xyz;
  #endif
  vec3 transformed = vec3(position);
  #include <skinning_vertex>
  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  vWorldPos = wp.xyz;
  mat3 m = mat3(modelMatrix);
  vN = m * objectNormal;
  vT = vec4(m * objectTangent, tangent.w);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const fragmentShader = /* glsl */ `
${rigLightingGLSL}
${rimLightGLSL}
uniform sampler2D tBase;
${bodyMaskDeclarations}
uniform sampler2D tBump;
uniform sampler2D tDetail;      // $detail, blend mode 6: the fire layer of a burning character
uniform bool uHasDetail;
uniform float uDetailScale;
uniform float uDetailBlend;
uniform sampler2D tWarp;
uniform sampler2D tPhongWarp;   // $phongwarptexture: a ramp of (specular, fresnel) that tints and shapes the highlight
uniform bool uHasPhongWarp;
uniform sampler2D tExp;
uniform samplerCube tCube;
uniform samplerCube tWorldCube;        // the cubemap the world setting picked ...
uniform float uWorldCube;               // ... when one is (its brightness; 0: none)
uniform bool uEnvWorld;                 // this material reflects "the cubemap of the level" ($envmap env_cubemap)
uniform bool uHasBump;
uniform bool uUnlit;                    // UnlitGeneric / UnlitTwoTexture: the picture of the texture, no lighting
uniform sampler2D tTex2;                // UnlitTwoTexture's $texture2 ...
uniform bool uHasTex2;
uniform float uMod2x;                   // ... and $mod2x (the product is doubled)
uniform bool uHasWarp;
uniform bool uHasExp;
uniform bool uHasEnv;

uniform vec3 uLightDir;      // unit vector pointing toward the light
uniform vec3 uLightColor;    // linear
uniform vec3 uAmbient[6];    // +X -X +Y -Y +Z -Z, linear
uniform vec3 uPointPos;      // extra point light: world position
uniform vec3 uPointColor;    // linear, already scaled by intensity (zero = off)
uniform float uPointRange;   // distance at which the light reaches zero
uniform float uPointFalloff; // attenuation curve exponent

uniform bool uHalfLambert;
uniform bool uSkinPath;      // routed to the Skin shader: half-lambert is forced on
uniform bool uPhong;
uniform float uPhongExponent;
uniform float uPhongBoost;
uniform vec3 uFresnel;       // ((mid-min)*2, mid, (max-mid)*2)
uniform vec3 uSpecTint;      // $phongtint (negative r = tint from the exponent map)
uniform bool uBaseAlphaPhongMask;
uniform bool uInvertPhongMask;
uniform bool uRim;
uniform float uRimExponent;
uniform float uRimBoost;
uniform bool uRimMask;

uniform vec3 uModulation;    // $color * $color2 in linear space
uniform bool uBlendTint;     // $blendtintbybasealpha
uniform float uTintReplace;  // $tintreplacesbasecolor

uniform sampler2D tIllumMask;          // $selfillummask
uniform sampler2D tEnvMask;            // $envmapmask
uniform bool uHasIllumMask;
uniform bool uHasEnvMask;
uniform bool uSelfIllumEnvMaskAlpha;   // $selfillum_envmapmask_alpha: the env mask's alpha drives the glow
uniform bool uSelfIllum;
uniform vec3 uSelfIllumTint;
uniform bool uSelfIllumFresnel;
uniform vec4 uSelfIllumFresnelParams;  // scale, bias, exponent, brightness

uniform vec3 uEnvTint;
uniform float uEnvFresnel;
uniform bool uEnvMaskNormalAlpha;      // $normalmapalphaenvmapmask
uniform bool uEnvMaskBaseAlpha;        // $basealphaenvmapmask
uniform float uEnvContrast;
uniform float uEnvSaturation;
uniform float uEnvScale;               // ENV_MAP_SCALE (cLightScale.z), assumed 1

uniform float uAlphaTest;    // <= 0 disables
uniform float uOpacity;
// view mode: 0 the lit material, 1 just the diffuse colour (the base texture with its tint, unlit), 2 the lit result without colour
uniform float uViewMode;
uniform bool uUseBaseAlpha;  // translucent / alphatest materials read alpha from the base texture

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vN;
varying vec4 vT;

vec3 ambientCube(vec3 n) {
  vec3 nsq = n * n;
  return nsq.x * (n.x >= 0.0 ? uAmbient[0] : uAmbient[1])
       + nsq.y * (n.y >= 0.0 ? uAmbient[2] : uAmbient[3])
       + nsq.z * (n.z >= 0.0 ? uAmbient[4] : uAmbient[5]);
}

// DiffuseTerm() from common_vertexlitgeneric_dx9.h
vec3 diffuseTerm(vec3 n, vec3 l) {
  float ndl = dot(n, l);
  float f;
  if (uHalfLambert || uSkinPath) {
    f = clamp(ndl * 0.5 + 0.5, 0.0, 1.0);
    if (!uHasWarp) f *= f;
  } else {
    f = clamp(ndl, 0.0, 1.0);
  }
  if (uHasWarp) return 2.0 * texture2D(tWarp, vec2(f, 0.5)).rgb;
  return vec3(f);
}

// pow() as Direct3D evaluates it: pow(0, 0) is 1 and pow(0, y>0) is 0. GLSL leaves both undefined, and materials that set
// $rimlightexponent / $phongexponent to 0 would otherwise produce NaN (flickering speckles) wherever the base is 0.
float safePow(float x, float e) {
  if (x <= 0.0) return e == 0.0 ? 1.0 : 0.0;
  return pow(x, e);
}

vec3 sampleEnv(vec3 v) {
  // Source axes: x forward, y left, z up
  vec3 d = vec3(v.z, v.x, v.y);
  return uEnvWorld && uWorldCube > 0.0 ? textureCube(tWorldCube, d).rgb * uWorldCube : textureCube(tCube, d).rgb;
}

varying float vHideW;
void main() {
${bodyMaskDiscard}
  if (vHideW > 0.5) discard; // a part of the character that is hidden // a part of the character that is hidden
  vec4 baseTex = texture2D(tBase, vUv);          // sRGB -> linear by the sampler
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 Nv = normalize(vN);

  // Tangent space normal (Vec3TangentToWorld)
  vec4 normalTexel = vec4(0.5, 0.5, 1.0, 1.0);
  if (uHasBump) normalTexel = texture2D(tBump, vUv);
  vec3 tn = normalTexel.xyz * 2.0 - 1.0;
  if (uBaseAlphaPhongMask) tn = vec3(0.0, 0.0, 1.0);   // lerp(normal, flat, g_fBaseMapAlphaPhongMask)
  // Some vertices have a zero tangent (e.g. 24 on the Dead of Night skirt). normalize() of that is NaN, which shows
  // as pure black; the engine's tangent frame is zero there, so only the vertex normal survives. Do the same.
  vec3 Tp = vT.xyz - Nv * dot(Nv, vT.xyz);
  bool hasTangent = dot(Tp, Tp) > 1e-8;
  vec3 T = hasTangent ? normalize(Tp) : vec3(0.0);
  vec3 B = cross(Nv, T) * vT.w;
  vec3 N = hasTangent ? normalize(tn.x * T + tn.y * B + tn.z * Nv) : Nv;

  vec3 L = normalize(uLightDir);
  float ndv = dot(N, V);
  float f = clamp(1.0 - ndv, 0.0, 1.0);
  float fresRanges = uFresnel.y + (f * f - 0.5 >= 0.0 ? uFresnel.z : uFresnel.x) * (f * f - 0.5);

  // Diffuse: ambient cube + directional light (optionally warped)
  vec3 diffuseLighting = ambientCube(N) + uLightColor * diffuseTerm(N, L);
  // Extra point light: smooth window (1 - (d/range)^2)^falloff, same diffuse term as the directional light.
  vec3 toPoint = uPointPos - vWorldPos;
  float pointDist = length(toPoint);
  vec3 Lp = toPoint / max(pointDist, 1e-4);
  float pointWin = clamp(1.0 - (pointDist * pointDist) / (uPointRange * uPointRange), 0.0, 1.0);
  vec3 pointLight = uPointColor * safePow(pointWin, uPointFalloff);
  diffuseLighting += pointLight * diffuseTerm(N, Lp);
  rigNormal = Nv; // the vertex normal: a bump map must not roughen the shadow's offset
  for (int i = 0; i < 8; i++) {
    if (i >= uRigCount) break;
    vec3 direction, color; rigLight(i, vWorldPos, direction, color);
    diffuseLighting += color * diffuseTerm(N, direction);
  }

  // Albedo with $color/$color2 modulation (g_DiffuseModulation)
  vec3 albedo = baseTex.rgb;
  if (uBlendTint) {
    vec3 tinted = albedo * uModulation;
    tinted = mix(tinted, uModulation, uTintReplace);
    albedo = mix(albedo, tinted, baseTex.a);
  } else {
    albedo = albedo * uModulation;
  }
  if (uHasTex2) {
    vec4 second = texture2D(tTex2, vUv);
    albedo *= second.rgb * (uMod2x > 0.5 ? 2.0 : 1.0);
    baseTex.a *= second.a;
  }
  vec3 diffuseComponent = uUnlit ? albedo : albedo * diffuseLighting;

  // Environment mask texture (non-skin paths): scales the reflection per channel
  vec4 envMaskTexel = vec4(1.0);
  if (uHasEnvMask) envMaskTexel = texture2D(tEnvMask, vUv);

  // Self illumination (vertexlit_and_unlit_generic_ps2x.fxc): the mask is the base alpha, or the
  // $selfillummask texture (per channel) when there is one; $selfillum_envmapmask_alpha uses the env mask alpha.
  if (uSelfIllumEnvMaskAlpha) {
    // 0 - 0.125: lerp(diffuse, selfillum, alpha * 8); above that the glow over-brightens
    float adj = 8.0 * envMaskTexel.a;
    diffuseComponent = max(0.0, 1.0 - adj) * diffuseComponent + adj * (uSelfIllumTint * albedo);
  } else if (uSelfIllum) {
    vec3 illumMask = uHasIllumMask ? texture2D(tIllumMask, vUv).rgb : vec3(baseTex.a);
    if (uSelfIllumFresnel) {
      float fr = safePow(clamp(dot(Nv, V), 0.0, 1.0), uSelfIllumFresnelParams.z) * uSelfIllumFresnelParams.x + uSelfIllumFresnelParams.y;
      diffuseComponent = mix(diffuseComponent, uSelfIllumTint * albedo * uSelfIllumFresnelParams.w, illumMask * clamp(fr, 0.0, 1.0));
    } else {
      diffuseComponent = mix(diffuseComponent, uSelfIllumTint * albedo, illumMask);
    }
    diffuseComponent = max(vec3(0.0), diffuseComponent);
  }

  // TCOMBINE_RGB_ADDITIVE_SELFILLUM_THRESHOLD_FADE (common_ps_fxc.h): the detail colour is added after lighting through a band that
  // widens with the blend factor, so the fire layer grows out of the skin instead of fading in as a whole.
  if (uHasDetail && uDetailBlend > 0.0) {
    vec3 detailColor = texture2D(tDetail, vUv * uDetailScale).rgb;
    float fMult = uDetailBlend >= 0.5 ? 1.0 / uDetailBlend : 4.0 * uDetailBlend;
    float fAdd = uDetailBlend >= 0.5 ? 1.0 - fMult : -0.5 * fMult;
    diffuseComponent += clamp(fMult * detailColor + fAdd, 0.0, 1.0);
  }

  // Phong + rim (Skin path)
  vec3 specular = vec3(0.0);
  float specMaskRaw = uBaseAlphaPhongMask ? baseTex.a : (uHasBump ? normalTexel.a : 1.0);
  if (uPhong) {
    float rimFresnel = safePow(f, 4.0);
    vec3 R = 2.0 * N * ndv - V;
    float LdotR = clamp(dot(R, L), 0.0, 1.0);
    float NdotL = clamp(dot(N, L), 0.0, 1.0);

    float exponent = uPhongExponent;
    vec3 specTint = uSpecTint;
    float rimMask = 1.0;
    // $phongexponent 0 reads the exponent from the map's red channel; without a map the engine binds white (exponent 150).
    if (uPhongExponent <= 0.0) exponent = 1.0 + 149.0 * texture2D(tExp, vUv).r;
    if (uHasExp) {
      vec4 e = texture2D(tExp, vUv);
      if (uSpecTint.r < 0.0) specTint = mix(vec3(1.0), baseTex.rgb, e.g);
      if (uRimMask) rimMask = e.a;
    } else if (uSpecTint.r < 0.0) {
      specTint = vec3(1.0);
    }
    exponent = max(exponent, 1.0);

    specular = vec3(safePow(LdotR, exponent)) * NdotL * uLightColor;
    // PixelShaderDoSpecularLighting: the highlight is looked up in the phong warp at { (N.H)^k, fresnel } before the mask and boost
    if (uHasPhongWarp) specular *= texture2D(tPhongWarp, vec2(clamp(specular.r, 0.0, 1.0), f * f)).rgb;
    specular *= specMaskRaw * fresRanges * uPhongBoost;

    if (uRim) {
      vec3 rim = vec3(safePow(LdotR, uRimExponent)) * NdotL * uLightColor;
      float rimMultiply = rimMask * rimFresnel;
      rim *= rimMultiply;
      specular = max(specular, rim);
      // view-ray lookup from the ambient cube; world up is +Y here
      specular += ambientCube(V) * uRimBoost * clamp(rimMultiply * N.y, 0.0, 1.0);
    }
    // the point light adds its own highlight with the same exponent / mask
    float LdotRp = clamp(dot(R, Lp), 0.0, 1.0);
    float NdotLp = clamp(dot(N, Lp), 0.0, 1.0);
    vec3 pointSpec = vec3(safePow(LdotRp, exponent)) * NdotLp * pointLight;
    if (uHasPhongWarp) pointSpec *= texture2D(tPhongWarp, vec2(clamp(pointSpec.r, 0.0, 1.0), f * f)).rgb;
    specular += pointSpec * specMaskRaw * fresRanges * uPhongBoost;
    for (int i = 0; i < 8; i++) {
      if (i >= uRigCount) break;
      vec3 direction, color; rigLight(i, vWorldPos, direction, color);
      float facing = clamp(dot(N, direction), 0.0, 1.0);
      float reflected = clamp(dot(R, direction), 0.0, 1.0);
      vec3 highlight = vec3(safePow(reflected, exponent)) * facing * color;
      if (uHasPhongWarp) highlight *= texture2D(tPhongWarp, vec2(clamp(highlight.r, 0.0, 1.0), f*f)).rgb;
      highlight *= specMaskRaw * fresRanges * uPhongBoost;
      if (uRim) highlight = max(highlight, vec3(safePow(reflected, uRimExponent)) * facing * color * rimMask * rimFresnel);
      specular += highlight;
    }
    specular *= specTint;
  }

  // Environment map
  vec3 envColor = vec3(0.0);
  if (uHasEnv) {
    if (uSkinPath) {
      // skin_ps20b.fxc: mask is the base alpha, or the spec mask when $normalmapalphaenvmapmask
      float envMask = mix(baseTex.a, specMaskRaw, uEnvMaskNormalAlpha ? 1.0 : 0.0);
      envMask = uInvertPhongMask ? 1.0 - envMask : envMask;
      vec3 Rv = 2.0 * N * ndv - V;
      envColor = uEnvScale * mix(1.0, fresRanges, uEnvFresnel) * envMask * sampleEnv(Rv) * uEnvTint;
    } else {
      // vertexlit_and_unlit_generic_bump: CalcReflectionVectorUnnormalized + contrast/saturation
      vec3 Rv = 2.0 * N * ndv - dot(N, N) * V;
      float factor = uEnvMaskNormalAlpha ? normalTexel.a : (uEnvMaskBaseAlpha ? 1.0 - baseTex.a : 1.0);
      envColor = uEnvScale * sampleEnv(Rv) * factor * envMaskTexel.rgb * uEnvTint;
      envColor = mix(envColor, envColor * envColor, uEnvContrast);
      float grey = dot(envColor, vec3(0.299, 0.587, 0.114));
      envColor = mix(vec3(grey), envColor, uEnvSaturation);
    }
  }

  vec3 result = diffuseComponent + specular + envColor;
  float alpha = uOpacity * (uUseBaseAlpha ? baseTex.a : 1.0);
  if (uAlphaTest > 0.0 && alpha < uAlphaTest) discard;

  if (uViewMode > 0.5 && uViewMode < 1.5) result = albedo;
  else if (uViewMode > 1.5) result = vec3(dot(result, vec3(0.2126, 0.7152, 0.0722)));
  if (!uUnlit) result += studioRimLight(Nv, vWorldPos);

  gl_FragColor = vec4(result, alpha);
  #include <colorspace_fragment>
}
`;
