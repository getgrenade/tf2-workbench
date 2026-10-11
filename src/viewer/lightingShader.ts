export const rigLightingGLSL = /* glsl */ `
#include <packing>
uniform int uRigCount;
uniform vec3 uRigDirection[8];
uniform vec3 uRigPosition[8];
uniform vec3 uRigColor[8];
uniform vec4 uRigParams[8]; // type, range, falloff, cone cosine
uniform float uRigShadow[8];
uniform mat4 uRigShadowMatrix[48];
uniform sampler2D tRigShadow;
uniform float uRigShadowSlot[8]; // the column of a light's tiles in the atlas
uniform vec2 uRigShadowGrid;     // columns, rows of the atlas
uniform float uRigShadowBias;
uniform float uRigShadowSoft;    // the radius of the filter, in tile widths
float rigShadow(int index, vec3 world) {
  if (uRigShadow[index] < 0.5) return 1.0;
  int face = 0;
  if (uRigParams[index].x > 0.5 && uRigParams[index].x < 1.5) {
    vec3 delta = world - uRigPosition[index], a = abs(delta);
    if (a.x >= a.y && a.x >= a.z) face = delta.x >= 0.0 ? 0 : 1;
    else if (a.y >= a.z) face = delta.y >= 0.0 ? 2 : 3;
    else face = delta.z >= 0.0 ? 4 : 5;
  }
  vec4 projected = uRigShadowMatrix[index * 6 + face] * vec4(world, 1.0);
  vec3 p = projected.xyz / projected.w * 0.5 + 0.5;
  if (projected.w <= 0.0 || p.z < 0.0 || p.z > 1.0 || p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return 1.0;
  vec2 tile = vec2(uRigShadowSlot[index], float(face));
  vec2 lo = (tile + vec2(0.001)) / uRigShadowGrid, hi = (tile + vec2(0.999)) / uRigShadowGrid;
  vec2 uv = (tile + p.xy) / uRigShadowGrid;
  if (uRigShadowSoft < 0.0002) {
    return p.z - uRigShadowBias <= unpackRGBAToDepth(texture2D(tRigShadow, clamp(uv, lo, hi))) ? 1.0 : 0.0;
  }
  // a square of taps: the edge is as soft as the radius says whatever the size of the map
  vec2 step = vec2(uRigShadowSoft * 0.5) / uRigShadowGrid;
  float result = 0.0;
  for (int x = -2; x <= 2; x++) for (int y = -2; y <= 2; y++) {
    float depth = unpackRGBAToDepth(texture2D(tRigShadow, clamp(uv + vec2(float(x), float(y)) * step, lo, hi)));
    result += p.z - uRigShadowBias <= depth ? 1.0 : 0.0;
  }
  result /= 25.0;
  return result;
}
void rigLight(int index, vec3 world, out vec3 direction, out vec3 color) {
  vec4 params = uRigParams[index];
  direction = uRigDirection[index];
  float attenuation = 1.0;
  if (params.x > 0.5) {
    vec3 delta = uRigPosition[index] - world;
    float distance = length(delta);
    direction = delta / max(distance, 0.0001);
    attenuation = pow(clamp(1.0 - distance * distance / (params.y * params.y), 0.0, 1.0), params.z);
    if (params.x > 1.5) attenuation *= smoothstep(params.w, min(1.0, params.w + 0.08), dot(direction, uRigDirection[index]));
  }
  color = uRigColor[index] * attenuation * rigShadow(index, world);
}
`;
