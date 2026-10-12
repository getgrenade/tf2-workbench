import { rigLightingGLSL } from "./lightingShader";
import { rimLightGLSL } from "./rimLight";
/**
 * Port of the Source SDK 2013 `EyeRefract` shader (eye_refract_vs20.fxc +
 * eye_refract_ps2x.fxc, ps30 path, no raytraced sphere, no flashlight).
 *
 * The eye origin and iris projection planes are supplied by the caller; Valve's
 * StudioRender computes them from the MDL eyeball data and that code is not in the
 * SDK, so source-formats reconstructs them (see `eyeball_state`).
 *
 * Space: bind-pose space, Y up. The environment cube is indexed in Source axes
 * (x forward, y left, z up), which are (z, x, y) of this space.
 */

export const eyeVertexShader = /* glsl */ `
uniform vec3 uEyeOrigin;
uniform vec4 uIrisU;
uniform vec4 uIrisV;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uAmbient[6];
uniform bool uHalfLambert;
uniform bool uHasWarp;
#include <skinning_pars_vertex>

varying vec2 vAoUv;
varying vec3 vVertexLight;
varying float vLightCos;
varying vec3 vTangentView;
varying vec3 vWorldPos;
varying vec3 vN;
varying vec3 vT;
varying vec3 vB;

vec3 ambientCube(vec3 n) {
  vec3 nsq = n * n;
  return nsq.x * (n.x >= 0.0 ? uAmbient[0] : uAmbient[1])
       + nsq.y * (n.y >= 0.0 ? uAmbient[2] : uAmbient[3])
       + nsq.z * (n.z >= 0.0 ? uAmbient[4] : uAmbient[5]);
}

// CosineTermInternal(): half-lambert here is squared, unlike DiffuseTerm().
float cosineTerm(vec3 n, vec3 l) {
  float ndl = dot(n, l);
  if (!uHalfLambert) return max(0.0, ndl);
  ndl = ndl * 0.5 + 0.5;
  return ndl * ndl;
}

attribute float hideW;
varying float vHideW;
void main() {
  vHideW = hideW;
  vAoUv = uv;
  vec3 transformed = vec3(position);
  #include <skinbase_vertex>
  #include <skinning_vertex>
  vec3 world = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vWorldPos = world;

  vec3 N = normalize(world - uEyeOrigin);       // sphere normal
  vec3 socketUp = normalize(-uIrisV.xyz);
  vec3 socketLeft = normalize(-uIrisU.xyz);
  vec3 T = normalize(cross(socketUp, N));
  vec3 B = normalize(cross(N, T));
  vN = N; vT = T; vB = B;

  vec3 view = normalize(world - cameraPosition);
  vTangentView = normalize(vec3(dot(view, T), dot(view, B), dot(view, N)));

  // "Bent" normal makes the eyeball less round left/right for nicer vertex lighting.
  float nDotSide = -dot(N, socketLeft) * 0.5;
  vec3 bent = normalize(nDotSide * socketLeft + N);

  if (uHasWarp) {
    vVertexLight = ambientCube(bent);           // only ambient is interpolated; lights are warped per pixel
  } else {
    vVertexLight = ambientCube(bent) + uLightColor * cosineTerm(bent, uLightDir);
  }
  vLightCos = cosineTerm(N, uLightDir);

  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

export const eyeFragmentShader = /* glsl */ `
${rigLightingGLSL}
${rimLightGLSL}
uniform bool uHalfLambert;
uniform sampler2D tCornea;
uniform sampler2D tIris;
uniform sampler2D tAO;
uniform sampler2D tWarp;
uniform samplerCube tCube;
uniform samplerCube tWorldCube;
uniform float uWorldCube;
uniform bool uEnvWorld;
uniform bool uHasWarp;
uniform bool uHasCube;

uniform vec3 uEyeOrigin;
uniform vec4 uIrisU;
uniform vec4 uIrisV;
uniform vec3 uLightDir;
uniform vec3 uLightColor;

uniform float uDilation;
uniform float uGlossiness;
uniform float uAverageAmbient;
uniform float uCorneaBumpStrength;
uniform vec3 uAmbientOcclColor;
uniform float uParallaxStrength;
uniform float uViewMode;

varying vec2 vAoUv;
varying vec3 vVertexLight;
varying float vLightCos;
varying vec3 vTangentView;
varying vec3 vWorldPos;
varying vec3 vN;
varying vec3 vT;
varying vec3 vB;

varying float vHideW;
void main() {
  if (vHideW > 0.5) discard; // a part of the character that is hidden
  vec3 N = normalize(vN);
  vec3 T = vT;
  vec3 B = vB;
  vec3 vertexLight = vVertexLight;
  vec3 worldView = normalize(vWorldPos - cameraPosition);

  // TF NPR lighting: warp the (interpolated) cosine term per pixel.
  if (uHasWarp) {
    vec3 warped = 2.0 * texture2D(tWarp, vec2(clamp(vLightCos, 0.0, 1.0), 0.5)).rgb;
    vertexLight += uLightColor * warped;
  }

  // Sphere and cornea UVs
  vec4 p = vec4(vWorldPos, 1.0);
  vec2 corneaUv = vec2(dot(uIrisU, p), dot(uIrisV, p));
  vec2 sphereUv = corneaUv * 0.5 + 0.25;

  // Hacked parallax on the iris
  float irisOffset = texture2D(tCornea, corneaUv).b;
  vec2 parallax = (vTangentView.xy * irisOffset * uParallaxStrength) / (1.0 - vTangentView.z);
  parallax.x = -parallax.x;
  vec2 irisUv = sphereUv - parallax;

  // Cornea noise lives in the iris alpha
  float corneaNoise = texture2D(tIris, sphereUv + parallax * 0.5).a;

  // Cornea normal
  vec4 corneaSample = texture2D(tCornea, corneaUv);
  vec3 corneaTN = vec3(corneaSample.rg - 0.5, 1.0);
  corneaTN.xy *= uCorneaBumpStrength;
  corneaTN.xy += corneaNoise * 0.1;
  corneaTN = normalize(corneaTN);
  vec3 corneaWorldNormal = normalize(corneaTN.x * T + corneaTN.y * B + corneaTN.z * N);

  // Dilate pupil
  irisUv -= 0.5;
  float pupilCenterToBorder = clamp(length(irisUv) / 0.2, 0.0, 1.0);
  irisUv *= mix(1.0, pupilCenterToBorder, clamp(uDilation, 0.0, 1.0) * 2.5 - 1.25);
  irisUv += 0.5;

  vec4 irisColor = texture2D(tIris, irisUv);

  // Iris lighting highlights
  float highlightMask = texture2D(tCornea, corneaUv).a;
  vec3 irisTN = corneaTN;
  irisTN.xy *= -2.5;

  vec3 L = normalize(uLightDir);
  vec3 tangentLight = vec3(dot(L, T), dot(L, B), dot(L, N));
  vec3 tmpv = -tangentLight;
  tmpv.xy *= -0.5;
  tmpv.z = max(tmpv.z, 0.5);
  tmpv = normalize(tmpv);
  float irisFacing = pow(abs(dot(irisTN, tmpv)), 6.0) * 0.5;
  float coneOfDarkness = pow(1.0 - clamp((-tangentLight.z - 0.25) / 0.75, 0.0, 1.0), 4.0);
  vec3 irisLighting = vec3(irisFacing * highlightMask * coneOfDarkness) * uLightColor;
  irisLighting += clamp(dot(irisTN, -vTangentView), 0.0, 1.0) * uAverageAmbient * highlightMask * 0.5;

  // Ambient occlusion from the artist-authored UVs
  vec3 aoTex = texture2D(tAO, vAoUv).rgb;
  vertexLight *= mix(uAmbientOcclColor, vec3(1.0), aoTex);

  // Reflection from the cube map (Source axes: x forward, y left, z up)
  vec3 reflection = vec3(0.0);
  vec3 corneaReflect = reflect(worldView, corneaWorldNormal);
  if (uHasCube) {
    vec3 cubeDir = vec3(corneaReflect.z, corneaReflect.x, corneaReflect.y);
    reflection = uGlossiness * (uEnvWorld && uWorldCube > 0.0 ? textureCube(tWorldCube, cubeDir).rgb * uWorldCube : textureCube(tCube, cubeDir).rgb);
  }

  // Glint specular from the local light
  vec3 glint = pow(clamp(dot(corneaReflect, L), 0.0, 1.0), 128.0) * uLightColor;

  rigNormal = N;
  for (int i = 0; i < 8; i++) {
    if (i >= uRigCount) break;
    vec3 direction, color; rigLight(i, vWorldPos, direction, color);
    float cosine = dot(N, direction);
    cosine = uHalfLambert ? pow(cosine * 0.5 + 0.5, 2.0) : max(cosine, 0.0);
    vertexLight += color * (uHasWarp ? 2.0 * texture2D(tWarp, vec2(cosine, 0.5)).rgb : vec3(cosine)) * mix(uAmbientOcclColor, vec3(1.0), aoTex);
    vec3 tangentLightExtra = vec3(dot(direction, T), dot(direction, B), dot(direction, N));
    vec3 irisVector = -tangentLightExtra; irisVector.xy *= -0.5; irisVector.z = max(irisVector.z, 0.5);
    float irisFacingExtra = pow(abs(dot(irisTN, normalize(irisVector))), 6.0) * 0.5;
    float coneExtra = pow(1.0 - clamp((-tangentLightExtra.z - 0.25) / 0.75, 0.0, 1.0), 4.0);
    irisLighting += irisFacingExtra * highlightMask * coneExtra * color;
    glint += pow(clamp(dot(corneaReflect, direction), 0.0, 1.0), 128.0) * color;
  }
  vec3 result = irisColor.rgb;
  result += corneaNoise * 0.1;
  result *= vertexLight + irisLighting;
  result += reflection * vertexLight;
  result += glint;

  if (uViewMode > 0.5 && uViewMode < 1.5) result = irisColor.rgb;
  else if (uViewMode > 1.5) result = vec3(dot(result, vec3(0.2126, 0.7152, 0.0722)));
  result += studioRimLight(N, vWorldPos);

  gl_FragColor = vec4(result, 1.0);
  #include <colorspace_fragment>
}
`;
