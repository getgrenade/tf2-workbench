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
uniform float uRigShadowTile;    // the size of a tile of the atlas, in texels
uniform float uRigShadowDetail;  // the relief a body may have before it shades itself, in units
uniform float uRigShadowStrength[8]; // how dark a light's shadows are
uniform vec3 uRigShadowTint;     // the colour of what is in shadow (black: none of the light gets through)
uniform float uRigTerminator;    // how far a face that turns from the light lets go of what is above it, in units
uniform float uRigContact;       // how dark the contact shadows are (0: none)
uniform float uRigContactLength; // how far they reach, in units
uniform sampler2D tRigDepth;     // the depth of the scene from the camera (for the contact shadows)
uniform mat4 uRigViewProj;
uniform vec4 uRigViewRow;        // the distance of a point from the camera along its axis, as a row to dot with (point, 1)
uniform vec3 uRigDepthRange;     // near, far, orthographic of that camera
uniform float uRigShadowTexel[8]; // world size of a shadow texel (per unit of distance for a point or spot light)
uniform vec2 uRigShadowNearFar[8]; // the depth range of a light's shadow map
vec3 rigNormal = vec3(0.0);      // the surface normal, set by a material before it asks for its lights
// One shadow tap that is filtered between the four texels around it (the map holds packed depth, which the hardware cannot filter): a
// shadow edge goes smoothly from texel to texel instead of in steps the size of a texel.
// The depth of the map as the distance along the light's axis (the map of a spot or point light holds a depth that is far from linear: a bias in
// that depth is a few units near the light and tens of units far from it, which let go of a shadow in blocks).
float rigLinear(float z, vec4 range) {
  return range.z > 0.5 ? mix(range.x, range.y, z) : 2.0 * range.x * range.y / (range.y + range.x - (2.0 * z - 1.0) * (range.y - range.x));
}
// The surface is a plane, not a point: how its distance from the light changes across the map (per unit of the tile), and where the filter is centred.
// A tap away from the centre compares against the depth the plane has THERE (receiver plane depth bias), so that a slanted surface does not
// shadow itself where the filter reaches along it, and the bias can stay as small as a flat surface needs.
vec2 rigPlane = vec2(0.0);
vec2 rigCentre = vec2(0.0);
float rigPlaneLimit = 0.0;
float rigReceiverAt(vec2 at, float receiver) {
  return receiver + clamp(dot(rigPlane, (at - rigCentre) * uRigShadowGrid), -rigPlaneLimit, rigPlaneLimit);
}
// The map holds the depth in three channels (24 bits) and in the fourth whether what is there is the body of a model (1: a character, a prop, a
// building) or a part that is put on it or hangs on it (0: a cosmetic, the Spy's cigarette). The relief of a body (lips, nostrils, folds) is no reason
// for a shadow on itself, so it is given a bias of its own, much larger than what a part gets, which has to touch what it is on without light
// leaking in between.
float rigBodyBias = 0.0;
float rigDepthOf(vec4 texel) { return min(dot(texel.rgb, vec3(1.0, 1.0 / 255.0, 1.0 / 65025.0)), 1.0); }
float rigBiasOf(vec4 texel, vec4 range) { return texel.a > 0.5 ? max(rigBodyBias, range.w) : range.w; }
float rigLitBy(vec2 at, float receiver, vec4 range, vec2 lo, vec2 hi) {
  vec4 texel = texture2D(tRigShadow, clamp(at, lo, hi));
  return rigReceiverAt(at, receiver) - rigLinear(rigDepthOf(texel), range) <= rigBiasOf(texel, range) ? 1.0 : 0.0;
}
float rigShadowTap(vec2 uv, float receiver, vec4 range, vec2 lo, vec2 hi) {
  vec2 size = uRigShadowGrid * uRigShadowTile;
  vec2 st = uv * size - 0.5;
  vec2 base = floor(st), f = st - base;
  vec2 a = (base + 0.5) / size, b = (base + 1.5) / size;
  float s00 = rigLitBy(a, receiver, range, lo, hi);
  float s10 = rigLitBy(vec2(b.x, a.y), receiver, range, lo, hi);
  float s01 = rigLitBy(vec2(a.x, b.y), receiver, range, lo, hi);
  float s11 = rigLitBy(b, receiver, range, lo, hi);
  return mix(mix(s00, s10, f.x), mix(s01, s11, f.x), f.y);
}
float rigShadowMap(int index, vec3 world) {
  if (uRigShadow[index] < 0.5) return 1.0;
  // The faces of a smooth-shaded low-poly surface turn from the light in steps where the shading still says lit, and then shade themselves and the
  // faces next to them. A point is slid out along the smooth normal by how much the true face (from the neighbouring pixels) differs from it, so
  // what is only a little above a face that turns from the light is let go. Taken before anything returns, as it needs the neighbouring pixels.
  vec3 faceNormal = normalize(cross(dFdx(world), dFdy(world)) + vec3(1e-12));
  if (dot(rigNormal, rigNormal) > 0.0) {
    if (dot(faceNormal, rigNormal) < 0.0) faceNormal = -faceNormal;
    world += rigNormal * uRigTerminator * max(1.0 - dot(faceNormal, rigNormal), 0.0);
  }
  // normal offset: slide the point out along its normal by a texel or so, more where the surface turns from the light, so the
  // depth bias itself can stay small and a shadow still meets what casts it
  float texelWorld = uRigShadowTexel[index] * (uRigParams[index].x > 0.5 ? length(uRigPosition[index] - world) : 1.0);
  float slope = 1.0; // how much a surface slants from the light: the tangent of the angle between its normal and the light
  if (dot(rigNormal, rigNormal) > 0.0) {
    vec3 toLight = uRigParams[index].x > 0.5 ? normalize(uRigPosition[index] - world) : uRigDirection[index];
    float cosine = clamp(dot(rigNormal, toLight), 0.0, 1.0), sine = sqrt(1.0 - cosine * cosine);
    slope = min(sine / max(cosine, 0.05), 4.0);
    world += rigNormal * texelWorld * 2.0 * sine;
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
  // the depth range of the map, and how the distance from the light changes across the tile at this point (from the neighbouring pixels: this is
  // done before anything returns, as the screen derivatives need every pixel of a block to get here)
  vec2 nearFar = uRigShadowNearFar[index];
  bool ortho = uRigParams[index].x < 0.5;
  vec4 range = vec4(nearFar, ortho ? 1.0 : 0.0, 0.0);
  float receiver = rigLinear(p.z, range);
  vec3 ddx = dFdx(vec3(p.xy, receiver)), ddy = dFdy(vec3(p.xy, receiver));
  if (projected.w <= 0.0 || p.z < 0.0 || p.z > 1.0 || p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return 1.0;
  vec2 tile = vec2(uRigShadowSlot[index], float(face));
  vec2 lo = (tile + vec2(0.001)) / uRigShadowGrid, hi = (tile + vec2(0.999)) / uRigShadowGrid;
  vec2 uv = (tile + p.xy) / uRigShadowGrid;
  // The bias is made of what the map cannot tell (a texel wide of depth, more where the surface slants from the light) and a fifth of a unit more:
  // the relief of a face (lips, nostrils) is real geometry, but it is not meant to cast shadows. The setting scales it (its default is 1x), so a bigger
  // bias grows with the size of a texel where the surface is, instead of letting go of thin parts by a fixed amount.
  range.w = max(uRigShadowBias * (1.0 / 0.0015) * (texelWorld * (0.4 + 0.6 * slope) + 0.2), 0.0005);
  float det = ddx.x * ddy.y - ddx.y * ddy.x;
  rigPlane = abs(det) > 1e-12 ? vec2(ddx.z * ddy.y - ddy.z * ddx.y, ddy.z * ddx.x - ddx.z * ddy.x) / det : vec2(0.0);
  rigCentre = uv;
  // what a body may have in relief before it shades itself (a nose is some three units): the setting raises it, but lowering it (to tighten the shadows of
  // cosmetics) only goes so far
  float setting = uRigShadowBias * (1.0 / 0.0015);
  rigBodyBias = max(setting * texelWorld * (0.4 + 0.6 * slope) + uRigShadowDetail, 0.0005);
  rigPlaneLimit = rigBodyBias * 6.0;
  float maxRadius = uRigShadowSoft;
  if (maxRadius < 0.0002) {
    return rigShadowTap(uv, receiver, range, lo, hi);
  }
  // Contact hardening: a first ring of taps finds what blocks the light, and the farther the blocker is above this point the
  // wider the penumbra (up to the softness setting). A shadow is crisp where it touches its caster and fades away from it.
  // Taps lie on a Vogel disc turned differently at each pixel, so the grain is fine instead of a visible grid of steps.
  float spin = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float blockers = 0.0, blockerDepth = 0.0;
  for (int i = 0; i < 12; i++) {
    float r = sqrt((float(i) + 0.5) / 12.0) * maxRadius, a = float(i) * 2.399963 + spin;
    vec2 at = clamp(uv + vec2(cos(a), sin(a)) * r / uRigShadowGrid, lo, hi);
    vec4 texel = texture2D(tRigShadow, at);
    float depth = rigDepthOf(texel);
    if (rigReceiverAt(at, receiver) - rigLinear(depth, range) > rigBiasOf(texel, range)) { blockers += 1.0; blockerDepth += depth; }
  }
  if (blockers < 0.5) return 1.0;
  blockerDepth /= blockers;
  // the distance between blocker and receiver along the light's rays, in world units
  float blocker = rigLinear(blockerDepth, range);
  // full softness once they are a sixth of the map's depth apart (an eighth of the distance to the light for a point or spot)
  float reach = ortho ? (nearFar.y - nearFar.x) / 6.0 : blocker * 0.125;
  float radius = maxRadius * clamp((receiver - blocker) / max(reach, 0.0001), 0.12, 1.0);
  float lit = 0.0;
  for (int i = 0; i < 16; i++) {
    float r = sqrt((float(i) + 0.5) / 16.0) * radius, a = float(i) * 2.399963 + spin;
    lit += rigShadowTap(uv + vec2(cos(a), sin(a)) * r / uRigShadowGrid, receiver, range, lo, hi);
  }
  return lit / 16.0;
}
// How the depth of the scene (a value of the depth buffer) is as a distance from the camera along its axis.
float rigSceneDistance(float depth) {
  return uRigDepthRange.z > 0.5 ? mix(uRigDepthRange.x, uRigDepthRange.y, depth)
    : 2.0 * uRigDepthRange.x * uRigDepthRange.y / (uRigDepthRange.y + uRigDepthRange.x - (2.0 * depth - 1.0) * (uRigDepthRange.y - uRigDepthRange.x));
}
// Contact shadows: a short ray from the point toward the light, followed through the depth of the scene from the camera. Where the ray goes behind what
// the camera sees, by a little (not by so much that it is only passing behind something thin), the point is shadowed. 1 is lit.
float rigContactShadow(int index, vec3 world, vec3 toLight) {
  if (uRigContact <= 0.0 || uRigShadow[index] < 0.5) return 1.0;
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float length = uRigContactLength;
  float thickness = length * 0.6 + 0.5;
  vec3 start = world + (dot(rigNormal, rigNormal) > 0.0 ? rigNormal * 0.05 : vec3(0.0));
  float occluded = 0.0;
  for (int i = 0; i < 14; i++) {
    float t = length * (float(i) + 0.3 + 0.7 * jitter) / 14.0;
    vec3 q = start + toLight * t;
    vec4 clip = uRigViewProj * vec4(q, 1.0);
    if (clip.w <= 0.0) break;
    vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
    float seen = rigSceneDistance(texture2D(tRigDepth, uv).r);
    float mine = dot(uRigViewRow, vec4(q, 1.0));
    float behind = mine - seen, step = length / 14.0;
    // in front of what the camera sees by a little: a hit that comes in over a step, and goes out again over the thickness (a ray that passes far behind something is not shadowed by it)
    float hit = smoothstep(0.02 + 0.03 * t, 0.02 + 0.03 * t + 1.5 * step, behind) * (1.0 - smoothstep(0.6 * thickness, thickness, behind));
    occluded = max(occluded, hit * (1.0 - smoothstep(0.55 * length, length, t)));
  }
  return 1.0 - occluded * uRigContact;
}
float rigShadow(int index, vec3 world) {
  float lit = rigShadowMap(index, world);
  if (uRigContact > 0.0 && uRigShadow[index] > 0.5) {
    vec3 toLight = uRigParams[index].x > 0.5 ? normalize(uRigPosition[index] - world) : uRigDirection[index];
    lit = min(lit, rigContactShadow(index, world, toLight));
  }
  return lit;
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
  // what a shadow lets through: the tint, and all of the light as the strength of the light's shadows is turned down
  vec3 through = uRigShadowTint + (1.0 - uRigShadowStrength[index]) * (vec3(1.0) - uRigShadowTint);
  color = uRigColor[index] * attenuation * mix(through, vec3(1.0), rigShadow(index, world));
}
`;
