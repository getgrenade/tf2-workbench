export const rigLightingGLSL = /* glsl */ `
uniform int uRigCount;
uniform vec3 uRigDirection[8];
uniform vec3 uRigPosition[8];
uniform vec3 uRigColor[8];
uniform vec4 uRigParams[8]; // type (0 directional, 1 point, 2 spot, 3 area), range, falloff, cone cosine
uniform vec3 uRigAxisU[8];   // an area light's panel: its right and up edges from the middle (their lengths are the half width and half height)
uniform vec3 uRigAxisV[8];
uniform float uRigShadow[8];
uniform mat4 uRigShadowMatrix[48];
uniform sampler2D tRigShadow;
uniform float uRigShadowSlot[8];     // the column of a light's tiles in the atlas
uniform vec2 uRigShadowGrid;         // columns, rows of the atlas
uniform float uRigShadowTile;        // the size of a tile of the atlas, in texels
uniform float uRigShadowStrength[8]; // how dark a light's shadows are (the engine's shadow attenuation, turned round)
uniform float uRigShadowFilter;      // the radius of the filter, in texels of a tile (the engine's filter size times 2)
uniform float uRigShadowJitter;      // a fraction of a turn more for the filter (pictures that are averaged each get their own, see jitter())
uniform float uRigShadowCube[8];     // 1: a point light's map is the six faces of a cube (it is among the casters), else one map aimed at them
uniform float uRigShadowSoft[8];     // how soft a light's own shadows are (times the filter)
uniform float uRigCurve[8];          // how a light falls off toward the side that turns from it (a power of its Lambert term: 1 is as it is)
// ---- Shadows as Source Filmmaker draws them (the engine's flashlight: common_flashlight_fxc.h, skin_ps20b.fxc). A light that casts shadows is a light
// of its own with a plain Lambert term (not half-Lambert, no light warp: see the materials), and the shadow darkens that light only: where a surface
// turns from the light, the light is already gone, so the steps of a low-poly surface shading itself there never show. The depth in the map carries
// the engine's bias (a constant and a big slope-scaled one: see the map's material in lightingRenderer.ts), and the map is read with 8 taps on a
// Poisson disc turned at every pixel, each tap compared between the four texels round it (the hardware's PCF). Here it is 16 taps on a Vogel disc
// of the same size (twice the engine's 8, for less grain).
float rigShadowLit[8];               // what each light's shadow lets through, for the specular after the diffuse (see sourceShader.ts)
float rigDepthOf(vec4 texel) { return min(dot(texel.rgb, vec3(1.0, 1.0 / 255.0, 1.0 / 65025.0)), 1.0); }
float rigShadowTap(vec2 uv, float depth, vec2 lo, vec2 hi) {
  vec2 size = uRigShadowGrid * uRigShadowTile;
  vec2 st = uv * size - 0.5;
  vec2 base = floor(st), f = st - base;
  vec2 a = (base + 0.5) / size, b = (base + 1.5) / size;
  float s00 = rigDepthOf(texture2D(tRigShadow, clamp(a, lo, hi))) > depth ? 1.0 : 0.0;
  float s10 = rigDepthOf(texture2D(tRigShadow, clamp(vec2(b.x, a.y), lo, hi))) > depth ? 1.0 : 0.0;
  float s01 = rigDepthOf(texture2D(tRigShadow, clamp(vec2(a.x, b.y), lo, hi))) > depth ? 1.0 : 0.0;
  float s11 = rigDepthOf(texture2D(tRigShadow, clamp(b, lo, hi))) > depth ? 1.0 : 0.0;
  return mix(mix(s00, s10, f.x), mix(s01, s11, f.x), f.y);
}
// 1 where the light reaches the point, 0 where something is in the way
float rigShadow(int index, vec3 world) {
  if (uRigShadow[index] < 0.5) return 1.0;
  int face = 0;
  if (uRigShadowCube[index] > 0.5) {
    vec3 delta = world - uRigPosition[index], a = abs(delta);
    if (a.x >= a.y && a.x >= a.z) face = delta.x >= 0.0 ? 0 : 1;
    else if (a.y >= a.z) face = delta.y >= 0.0 ? 2 : 3;
    else face = delta.z >= 0.0 ? 4 : 5;
  }
  vec4 projected = uRigShadowMatrix[index * 6 + face] * vec4(world, 1.0);
  vec3 p = projected.xyz / projected.w * 0.5 + 0.5;
  if (projected.w <= 0.0 || p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z < 0.0) return 1.0;
  float depth = min(p.z, 0.99999);
  vec2 tile = vec2(uRigShadowSlot[index], float(face));
  vec2 lo = (tile + vec2(0.001)) / uRigShadowGrid, hi = (tile + vec2(0.999)) / uRigShadowGrid;
  vec2 uv = (tile + p.xy) / uRigShadowGrid;
  // the disc, turned at every pixel (the engine reads a texture of random turns)
  float spin = 6.2831853 * (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) + uRigShadowJitter);
  mat2 turn = mat2(cos(spin), sin(spin), -sin(spin), cos(spin));
  float radius = uRigShadowFilter * uRigShadowSoft[index];
  vec2 scale = vec2(radius / uRigShadowTile) / uRigShadowGrid;
  float lit = 0.0;
  for (int k = 0; k < 16; k++) {
    float r = sqrt((float(k) + 0.5) / 16.0), a = float(k) * 2.399963;
    lit += rigShadowTap(uv + turn * (r * vec2(cos(a), sin(a))) * scale, depth, lo, hi);
  }
  return mix(1.0, lit / 16.0, uRigShadowStrength[index]);
}
// ---- The colour of what is in shadow (black by default): what a shadowed light leaves is that colour of it, so a blue tint is a shadow lit by a blue sky.
uniform vec3 uRigShadowTint;
// What a light that casts shadows gives a point: its Lambert term (to the power of its curve), darkened by the shadow, and of what is taken away the
// tint.
vec3 rigShadowedLight(int index, vec3 color, float facing, float lit) {
  float l = pow(clamp(facing, 0.0, 1.0), uRigCurve[index]) * lit;
  return color * (l + uRigShadowTint * (1.0 - l));
}
void rigLight(int index, vec3 world, out vec3 direction, out vec3 color) {
  vec4 params = uRigParams[index];
  direction = uRigDirection[index];
  float attenuation = 1.0;
  if (params.x > 2.5) {
    // an area light: the nearest point of the panel to the surface lights it, as a point light would from there, and only the side the panel faces gets light
    vec3 u = uRigAxisU[index], v = uRigAxisV[index];
    float halfU = length(u), halfV = length(v);
    vec3 un = u / max(halfU, 0.0001), vn = v / max(halfV, 0.0001);
    vec3 relative = world - uRigPosition[index];
    vec3 nearest = uRigPosition[index] + un * clamp(dot(relative, un), -halfU, halfU) + vn * clamp(dot(relative, vn), -halfV, halfV);
    vec3 delta = nearest - world;
    float distance = length(delta);
    direction = delta / max(distance, 0.0001);
    attenuation = pow(clamp(1.0 - distance * distance / (params.y * params.y), 0.0, 1.0), params.z);
    attenuation *= clamp(dot(direction, uRigDirection[index]), 0.0, 1.0);
  } else if (params.x > 0.5) {
    vec3 delta = uRigPosition[index] - world;
    float distance = length(delta);
    direction = delta / max(distance, 0.0001);
    attenuation = pow(clamp(1.0 - distance * distance / (params.y * params.y), 0.0, 1.0), params.z);
    if (params.x > 1.5) attenuation *= smoothstep(params.w, min(1.0, params.w + 0.08), dot(direction, uRigDirection[index]));
  }
  color = uRigColor[index] * attenuation;
}
`;
