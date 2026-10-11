import * as THREE from "three";
import { aoKernel, type AoState } from "./aoMath";

/**
 * Screen-space ambient occlusion from the depth of the finished scene, as a post effect: it measures how much of the space around each
 * visible point is blocked by nearby surfaces and gives a picture of 1 (open) .. 0 (closed) that the final composite multiplies in. The
 * materials themselves are not touched. Two passes: the measurement (16 samples in a hemisphere around the surface, turned a little at
 * every pixel) and a blur that does not cross edges.
 */
const VERTEX = "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";

const VIEW_POS = /* glsl */ `
uniform mat4 uInvProj;
vec3 viewPos(vec2 uv, float d) {
  vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return v.xyz / v.w;
}
`;

const MEASURE = /* glsl */ `
uniform sampler2D tDepth;
uniform mat4 uProj;
uniform vec2 uSize;
uniform float uRadius;
uniform float uBias;
uniform vec3 uKernel[16];
varying vec2 vUv;
${VIEW_POS}
float noise(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
void main() {
  float d = texture2D(tDepth, vUv).r;
  if (d >= 0.9999) {
    gl_FragColor = vec4(1.0);
    return;
  }
  vec3 P = viewPos(vUv, d);
  vec2 px = 1.0 / uSize;
  // the surface normal from the neighbours that are nearer in depth (so edges do not smear it)
  vec2 uvL = vUv - vec2(px.x, 0.0), uvR = vUv + vec2(px.x, 0.0), uvD = vUv - vec2(0.0, px.y), uvU = vUv + vec2(0.0, px.y);
  vec3 Pl = viewPos(uvL, texture2D(tDepth, uvL).r), Pr = viewPos(uvR, texture2D(tDepth, uvR).r);
  vec3 Pd = viewPos(uvD, texture2D(tDepth, uvD).r), Pu = viewPos(uvU, texture2D(tDepth, uvU).r);
  vec3 dx = abs(Pl.z - P.z) < abs(Pr.z - P.z) ? P - Pl : Pr - P;
  vec3 dy = abs(Pd.z - P.z) < abs(Pu.z - P.z) ? P - Pd : Pu - P;
  vec3 N = normalize(cross(dx, dy));
  float angle = noise(gl_FragCoord.xy) * 6.2831853;
  vec3 rv = vec3(cos(angle), sin(angle), 0.0);
  vec3 T = normalize(rv - N * dot(rv, N));
  mat3 TBN = mat3(T, cross(N, T), N);
  float occ = 0.0;
  for (int i = 0; i < 16; i++) {
    vec3 sp = P + TBN * uKernel[i] * uRadius;
    vec4 clip = uProj * vec4(sp, 1.0);
    vec2 suv = clip.xy / clip.w * 0.5 + 0.5;
    float sd = texture2D(tDepth, suv).r;
    if (sd >= 0.9999) continue;
    float sz = viewPos(suv, sd).z;
    float range = smoothstep(0.0, 1.0, uRadius / max(abs(P.z - sz), 1e-4));
    occ += (sz >= sp.z + uBias ? 1.0 : 0.0) * range;
  }
  gl_FragColor = vec4(vec3(1.0 - occ / 16.0), 1.0);
}
`;

const BLUR = /* glsl */ `
uniform sampler2D tAo;
uniform sampler2D tDepth;
uniform vec2 uSize;
uniform float uRadius;
varying vec2 vUv;
${VIEW_POS}
void main() {
  float d0 = texture2D(tDepth, vUv).r;
  if (d0 >= 0.9999) {
    gl_FragColor = vec4(1.0);
    return;
  }
  float z0 = viewPos(vUv, d0).z;
  float sum = 0.0, weight = 0.0;
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      vec2 uv = vUv + vec2(float(x), float(y)) / uSize;
      float d = texture2D(tDepth, uv).r;
      if (d >= 0.9999) continue;
      float w = abs(viewPos(uv, d).z - z0) < uRadius * 0.5 ? 1.0 : 0.0; // not across an edge
      sum += texture2D(tAo, uv).r * w;
      weight += w;
    }
  }
  gl_FragColor = vec4(vec3(weight > 0.0 ? sum / weight : texture2D(tAo, vUv).r), 1.0);
}
`;

export class AoPass {
  private readonly raw = this.makeTarget();
  private readonly blurred = this.makeTarget();
  private readonly measure: THREE.ShaderMaterial;
  private readonly blur: THREE.ShaderMaterial;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;

  constructor() {
    const kernel = aoKernel(16).map(([x, y, z]) => new THREE.Vector3(x, y, z));
    this.measure = new THREE.ShaderMaterial({
      uniforms: {
        tDepth: { value: null },
        uProj: { value: new THREE.Matrix4() },
        uInvProj: { value: new THREE.Matrix4() },
        uSize: { value: new THREE.Vector2(1, 1) },
        uRadius: { value: 10 },
        uBias: { value: 0.1 },
        uKernel: { value: kernel },
      },
      vertexShader: VERTEX,
      fragmentShader: MEASURE,
      depthTest: false,
      depthWrite: false,
    });
    this.blur = new THREE.ShaderMaterial({
      uniforms: {
        tAo: { value: null },
        tDepth: { value: null },
        uInvProj: { value: new THREE.Matrix4() },
        uSize: { value: new THREE.Vector2(1, 1) },
        uRadius: { value: 10 },
      },
      vertexShader: VERTEX,
      fragmentShader: BLUR,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.measure);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  private makeTarget() {
    return new THREE.WebGLRenderTarget(1, 1, { type: THREE.UnsignedByteType, depthBuffer: false, colorSpace: THREE.NoColorSpace });
  }

  /**
   * Measures the occlusion of what the depth texture holds, seen through `cam`, into a picture of `width` x `height`.
   * `unit` is the size of one character in world units (the radius is a fraction of it). Returns the picture's texture.
   */
  render(renderer: THREE.WebGLRenderer, depth: THREE.Texture, cam: THREE.PerspectiveCamera, width: number, height: number, ao: AoState, unit: number): THREE.Texture {
    this.raw.setSize(width, height);
    this.blurred.setSize(width, height);
    const radius = Math.max(0.01, ao.radius * unit);
    const m = this.measure.uniforms;
    m.tDepth.value = depth;
    (m.uProj.value as THREE.Matrix4).copy(cam.projectionMatrix);
    (m.uInvProj.value as THREE.Matrix4).copy(cam.projectionMatrixInverse);
    (m.uSize.value as THREE.Vector2).set(width, height);
    m.uRadius.value = radius;
    m.uBias.value = radius * 0.05;
    const b = this.blur.uniforms;
    b.tAo.value = this.raw.texture;
    b.tDepth.value = depth;
    (b.uInvProj.value as THREE.Matrix4).copy(cam.projectionMatrixInverse);
    (b.uSize.value as THREE.Vector2).set(width, height);
    b.uRadius.value = radius;

    const previousTarget = renderer.getRenderTarget();
    this.quad.material = this.measure;
    renderer.setRenderTarget(this.raw);
    renderer.render(this.scene, this.camera);
    this.quad.material = this.blur;
    renderer.setRenderTarget(this.blurred);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(previousTarget);
    return this.blurred.texture;
  }

  dispose() {
    this.raw.dispose();
    this.blurred.dispose();
    this.measure.dispose();
    this.blur.dispose();
    this.quad.geometry.dispose();
  }
}
