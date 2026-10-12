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
uniform float uRigShadowTexel[8]; // world size of a shadow texel (per unit of distance for a point or spot light)
uniform vec2 uRigShadowNearFar[8]; // the depth range of a light's shadow map
vec3 rigNormal = vec3(0.0);      // the surface normal, set by a material before it asks for its lights
float rigShadow(int index, vec3 world) {
  if (uRigShadow[index] < 0.5) return 1.0;
  // normal offset: slide the point out along its normal by a texel or so, more where the surface turns from the light, so the
  // depth bias itself can stay small and a shadow still meets what casts it
  if (dot(rigNormal, rigNormal) > 0.0) {
    vec3 toLight = uRigParams[index].x > 0.5 ? normalize(uRigPosition[index] - world) : uRigDirection[index];
    float texel = uRigShadowTexel[index] * (uRigParams[index].x > 0.5 ? length(uRigPosition[index] - world) : 1.0);
    world += rigNormal * texel * 1.5 * (1.0 - clamp(dot(rigNormal, toLight), 0.0, 1.0));
  }
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
  // Contact hardening: a first ring of taps finds what blocks the light, and the farther the blocker is above this point the
  // wider the penumbra (up to the softness setting). A shadow is crisp where it touches its caster and fades away from it.
  // Taps lie on a Vogel disc turned differently at each pixel, so the grain is fine instead of a visible grid of steps.
  float spin = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float maxRadius = uRigShadowSoft;
  float blockers = 0.0, blockerDepth = 0.0;
  for (int i = 0; i < 12; i++) {
    float r = sqrt((float(i) + 0.5) / 12.0) * maxRadius, a = float(i) * 2.399963 + spin;
    float depth = unpackRGBAToDepth(texture2D(tRigShadow, clamp(uv + vec2(cos(a), sin(a)) * r / uRigShadowGrid, lo, hi)));
    if (depth < p.z - uRigShadowBias) { blockers += 1.0; blockerDepth += depth; }
  }
  if (blockers < 0.5) return 1.0;
  blockerDepth /= blockers;
  // the distance between blocker and receiver along the light's rays, in world units
  vec2 nearFar = uRigShadowNearFar[index];
  bool ortho = uRigParams[index].x < 0.5;
  float receiver = ortho ? mix(nearFar.x, nearFar.y, p.z) : 2.0 * nearFar.x * nearFar.y / (nearFar.y + nearFar.x - (2.0 * p.z - 1.0) * (nearFar.y - nearFar.x));
  float blocker = ortho ? mix(nearFar.x, nearFar.y, blockerDepth) : 2.0 * nearFar.x * nearFar.y / (nearFar.y + nearFar.x - (2.0 * blockerDepth - 1.0) * (nearFar.y - nearFar.x));
  // full softness once they are a sixth of the map's depth apart (an eighth of the distance to the light for a point or spot)
  float reach = ortho ? (nearFar.y - nearFar.x) / 6.0 : blocker * 0.125;
  float radius = maxRadius * clamp((receiver - blocker) / max(reach, 0.0001), 0.12, 1.0);
  float lit = 0.0;
  for (int i = 0; i < 20; i++) {
    float r = sqrt((float(i) + 0.5) / 20.0) * radius, a = float(i) * 2.399963 + spin;
    float depth = unpackRGBAToDepth(texture2D(tRigShadow, clamp(uv + vec2(cos(a), sin(a)) * r / uRigShadowGrid, lo, hi)));
    lit += p.z - uRigShadowBias <= depth ? 1.0 : 0.0;
  }
  return lit / 20.0;
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
