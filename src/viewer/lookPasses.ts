/**
 * The look effects that need passes of their own: depth of field (a blur that depends on how far each pixel is from the focus) and
 * motion blur (several moments of an animation drawn and averaged). Bloom is in look.ts.
 */
import * as THREE from "three";
import type { DofState } from "./look";

const VERTEX = "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";

/** The moments an exposure is made of, in seconds from the time shown (the one closest to the middle comes last: its depth is the picture's). */
export function subframeOffsets(samples: number, shutter: number): number[] {
  const n = Math.max(1, Math.round(samples));
  return Array.from({ length: n }, (_, i) => ((i + 0.5) / n - 0.5) * shutter).sort((a, b) => Math.abs(b) - Math.abs(a));
}

/** Adds pictures together (each with a weight) in a target of its own: the average of the moments of motion blur. */
export class MotionAccumulator {
  private target: THREE.WebGLRenderTarget | null = null;
  private first = true;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: null as THREE.Texture | null }, uWeight: { value: 1 } },
    vertexShader: VERTEX,
    fragmentShader: "uniform sampler2D tSrc; uniform float uWeight; varying vec2 vUv; void main() { gl_FragColor = texture2D(tSrc, vUv) * uWeight; }",
    depthTest: false, depthWrite: false, transparent: true,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
  });
  private readonly quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);

  constructor() {
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  private renderer: THREE.WebGLRenderer | null = null;

  /** Starts a new sum of pictures that are `w` x `h` pixels, drawn by `r`. */
  begin(r: THREE.WebGLRenderer, w: number, h: number) {
    this.renderer = r;
    if (!this.target || this.target.width !== w || this.target.height !== h) {
      this.target?.dispose();
      this.target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, colorSpace: THREE.NoColorSpace });
    }
    this.first = true;
  }

  add(source: THREE.Texture, weight: number) {
    const r = this.renderer;
    if (!r || !this.target) return;
    const prevTarget = r.getRenderTarget(), prevAuto = r.autoClear;
    this.material.uniforms.tSrc.value = source;
    this.material.uniforms.uWeight.value = weight;
    r.setRenderTarget(this.target);
    r.autoClear = this.first;
    r.render(this.scene, this.camera);
    this.first = false;
    r.setRenderTarget(prevTarget);
    r.autoClear = prevAuto;
  }

  get texture(): THREE.Texture { return this.target!.texture; }

  dispose() {
    this.target?.dispose();
    this.target = null;
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}

/**
 * Depth of field: every pixel is blurred by how far it is from the focus (the depth of the picture decides, or a band of the picture
 * for the tilt-shift look), with a disc of taps that only takes in what is blurred as far as the pixel it is for (so a sharp
 * character does not bleed into the blur behind it).
 */
export class DofPass {
  private target: THREE.WebGLRenderTarget | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material = new THREE.ShaderMaterial({
    uniforms: {
      tColor: { value: null as THREE.Texture | null },
      tDepth: { value: null as THREE.Texture | null },
      uRes: { value: new THREE.Vector2(1, 1) },
      uNear: { value: 0.1 },
      uFar: { value: 1000 },
      uOrtho: { value: 0 },
      uFocus: { value: 100 },
      uRange: { value: 0 },
      uMaxPx: { value: 20 },
      uTilt: { value: new THREE.Vector4() },
    },
    vertexShader: VERTEX,
    fragmentShader: /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uRes;
uniform float uNear;
uniform float uFar;
uniform float uOrtho;
uniform float uFocus;   // world units
uniform float uRange;   // world units
uniform float uMaxPx;   // the biggest blur, in pixels
uniform vec4 uTilt;     // on, band position, band width
varying vec2 vUv;
float linearZ(float d) {
  return uOrtho > 0.5 ? uNear + d * (uFar - uNear) : 2.0 * uNear * uFar / (uFar + uNear - (2.0 * d - 1.0) * (uFar - uNear));
}
// how blurred a pixel is, 0..1
float coc(vec2 uv) {
  if (uTilt.x > 0.5) return smoothstep(0.0, 0.35, max(0.0, abs(uv.y - uTilt.y) - 0.5 * uTilt.z));
  float z = linearZ(texture2D(tDepth, uv).r);
  return clamp(max(0.0, abs(z - uFocus) - uRange) / max(z, 1e-3) * 2.0, 0.0, 1.0);
}
void main() {
  vec4 c0 = texture2D(tColor, vUv);
  float radius = coc(vUv) * uMaxPx;
  if (radius < 0.6) { gl_FragColor = c0; return; }
  vec4 sum = c0;
  float wsum = 1.0;
  float rot = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  for (int i = 0; i < 40; i++) {
    float fi = float(i) + 0.5;
    float a = fi * 2.39996323 + rot;
    vec2 off = vec2(cos(a), sin(a)) * sqrt(fi / 40.0) * radius;
    vec2 uv = vUv + off / uRes;
    float reach = coc(uv) * uMaxPx;
    float w = clamp(reach - length(off) + 1.0, 0.0, 1.0);
    sum += texture2D(tColor, uv) * w;
    wsum += w;
  }
  gl_FragColor = sum / wsum;
}`,
    depthTest: false, depthWrite: false,
  });
  private readonly quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);

  constructor() {
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  /**
   * Blurs `color` (a picture \`w\` x \`h\` pixels, drawn by \`cam\`, with its \`depth\`) and returns the texture. \`focus\` is the distance in
   * world units that is sharp when the focus follows the character; \`unit\` is the height of a character in world units.
   */
  render(r: THREE.WebGLRenderer, color: THREE.Texture, depth: THREE.Texture, cam: THREE.Camera, w: number, h: number, s: DofState, focus: number, unit: number): THREE.Texture {
    if (!this.target || this.target.width !== w || this.target.height !== h) {
      this.target?.dispose();
      this.target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, colorSpace: THREE.NoColorSpace });
    }
    const u = this.material.uniforms;
    const perspective = cam as THREE.PerspectiveCamera & { isOrthographicCamera?: boolean };
    u.tColor.value = color;
    u.tDepth.value = depth;
    (u.uRes.value as THREE.Vector2).set(w, h);
    u.uNear.value = perspective.near;
    u.uFar.value = perspective.far;
    u.uOrtho.value = perspective.isOrthographicCamera ? 1 : 0;
    u.uFocus.value = s.selected ? focus : s.focus * unit;
    u.uRange.value = s.range * unit;
    u.uMaxPx.value = s.aperture * 40 * h / 1080;
    (u.uTilt.value as THREE.Vector4).set(s.tilt ? 1 : 0, s.tiltPosition, s.tiltWidth, 0);
    const prevTarget = r.getRenderTarget(), prevAuto = r.autoClear;
    r.setRenderTarget(this.target);
    r.autoClear = true;
    r.render(this.scene, this.camera);
    r.setRenderTarget(prevTarget);
    r.autoClear = prevAuto;
    return this.target.texture;
  }

  dispose() {
    this.target?.dispose();
    this.target = null;
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
