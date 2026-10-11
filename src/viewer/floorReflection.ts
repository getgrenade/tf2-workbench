/**
 * A reflection of the scene in the floor: the scene is drawn again as a mirror below the floor sees it, and a plane at the floor shows
 * that picture. The reflection fades with how high the reflected thing is above the floor (a foot is clear, a head is gone), gets
 * blurrier with the height, is stronger where the floor is seen at a low angle, and fades out with the distance from the scene.
 */
import * as THREE from "three";
import type { ReflectionState } from "./look";

export class FloorReflection {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private target: THREE.WebGLRenderTarget | null = null;
  private readonly virtual = new THREE.PerspectiveCamera();
  private readonly texMatrix = new THREE.Matrix4();
  private readonly bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  private floorY = 0;

  constructor(scene: THREE.Scene) {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tReflect: { value: null as THREE.Texture | null },
        tDepth: { value: null as THREE.Texture | null },
        uTexMatrix: { value: new THREE.Matrix4() },
        uInvVP: { value: new THREE.Matrix4() },
        uFloorY: { value: 0 },
        uTint: { value: new THREE.Color(0xffffff) },
        uStrength: { value: 0.5 },
        uFadeH: { value: 50 },
        uBlur: { value: 0.3 },
        uFresnel: { value: 0.5 },
        uCenter: { value: new THREE.Vector2() },
        uFadeDist: { value: new THREE.Vector2(0, 1) },
        uTexel: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: `uniform mat4 uTexMatrix;
varying vec4 vProj;
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vProj = uTexMatrix * w;
  gl_Position = projectionMatrix * viewMatrix * w;
}`,
      fragmentShader: `uniform sampler2D tReflect;
uniform sampler2D tDepth;
uniform mat4 uInvVP;
uniform float uFloorY;
uniform vec3 uTint;
uniform float uStrength;
uniform float uFadeH;
uniform float uBlur;
uniform float uFresnel;
uniform vec2 uCenter;
uniform vec2 uFadeDist;
uniform vec2 uTexel;
varying vec4 vProj;
varying vec3 vWorld;
void main() {
  vec2 uv = vProj.xy / vProj.w;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
  float d = texture2D(tDepth, uv).r;
  // how high above the floor what is seen there is (the mirror's view of it, back in the world)
  vec4 q = uInvVP * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  float h01 = d >= 0.9999 ? 1.0 : clamp(max(q.y / q.w - uFloorY, 0.0) / uFadeH, 0.0, 1.0);
  float radius = uBlur * (0.5 + 3.0 * h01);
  vec4 col = texture2D(tReflect, uv);
  for (int i = 0; i < 8; i++) {
    float fi = float(i) + 0.5;
    float a = fi * 2.39996323;
    col += texture2D(tReflect, uv + vec2(cos(a), sin(a)) * sqrt(fi / 8.0) * radius * uTexel);
  }
  col /= 9.0;
  float fadeHeight = 1.0 - smoothstep(0.0, 1.0, h01);
  float fadeDistance = 1.0 - smoothstep(uFadeDist.x, uFadeDist.y, length(vWorld.xz - uCenter));
  float up = clamp(normalize(cameraPosition - vWorld).y, 0.0, 1.0);
  float fresnel = mix(1.0, 0.12 + 0.88 * pow(1.0 - up, 3.0), uFresnel);
  float k = uStrength * fadeHeight * fadeDistance * fresnel;
  gl_FragColor = vec4(col.rgb * uTint * k, col.a * k);
}`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.material.userData.noShadow = true; // it does not cast a shadow, on the ground or from the lights
    const geo = new THREE.PlaneGeometry(2, 2);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, this.material);
    // under the ground plane's colour's neighbours: the ground (-3), the reflection, the grid (-2) and the shadows (-1)
    this.mesh.renderOrder = -2.5;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** Sets the look of the reflection and where it is (`unit` is the height of a character, `cx` and `cz` the middle of the scene). */
  update(state: ReflectionState | null, cx: number, cz: number, floorY: number, unit: number) {
    this.floorY = floorY;
    this.mesh.visible = !!state && state.enabled && state.strength > 0;
    if (!this.mesh.visible || !state) return;
    const u = this.material.uniforms;
    const end = state.distance * unit;
    u.uStrength.value = state.strength;
    u.uFadeH.value = Math.max(0.001, state.fade * unit);
    u.uBlur.value = state.blur * 6;
    u.uFresnel.value = state.fresnel;
    u.uTint.value.set(state.color);
    u.uFloorY.value = floorY;
    u.uCenter.value.set(cx, cz);
    u.uFadeDist.value.set(end * (1 - state.softness), end);
    this.mesh.position.set(cx, floorY - 0.02, cz);
    this.mesh.scale.set(end, 1, end);
  }

  /**
   * Draws the scene as the mirror sees it (from \`camera\`, in a target half the size of the picture \`w\` x \`h\`). \`hide\` are the things
   * that are not part of the picture of the world: the floor and its shadows, the grid, the gizmos.
   */
  render(r: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, w: number, h: number, hide: THREE.Object3D[]) {
    const cameraPosition = camera.getWorldPosition(new THREE.Vector3());
    // a camera below the floor does not see its top
    if (cameraPosition.y <= this.floorY + 0.01) { this.mesh.visible = false; return; }
    const rw = Math.max(1, w), rh = Math.max(1, h);
    if (!this.target || this.target.width !== rw || this.target.height !== rh) {
      this.target?.depthTexture?.dispose();
      this.target?.dispose();
      this.target = new THREE.WebGLRenderTarget(rw, rh, { type: THREE.HalfFloatType, samples: 4, depthTexture: new THREE.DepthTexture(rw, rh) });
    }
    // the camera of the mirror (the camera mirrored in the floor, turned the same way as the mirror image of where it looks)
    const normal = new THREE.Vector3(0, 1, 0), onFloor = new THREE.Vector3(0, this.floorY, 0);
    const position = onFloor.clone().sub(cameraPosition).reflect(normal).negate().add(onFloor);
    const rotation = new THREE.Matrix4().extractRotation(camera.matrixWorld);
    const lookAt = new THREE.Vector3(0, 0, -1).applyMatrix4(rotation).add(cameraPosition);
    const target = onFloor.clone().sub(lookAt).reflect(normal).negate().add(onFloor);
    const v = this.virtual;
    v.position.copy(position);
    v.up.set(0, 1, 0).applyMatrix4(rotation).reflect(normal);
    v.lookAt(target);
    v.near = (camera as THREE.PerspectiveCamera).near;
    v.far = (camera as THREE.PerspectiveCamera).far;
    v.updateMatrixWorld();
    v.projectionMatrix.copy(camera.projectionMatrix);
    v.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    this.texMatrix.copy(this.bias).multiply(v.projectionMatrix).multiply(v.matrixWorldInverse);
    const u = this.material.uniforms;
    (u.uTexMatrix.value as THREE.Matrix4).copy(this.texMatrix);
    (u.uInvVP.value as THREE.Matrix4).copy(v.projectionMatrix).multiply(v.matrixWorldInverse).invert();
    (u.uTexel.value as THREE.Vector2).set(1 / rw, 1 / rh);
    // draw
    const prevTarget = r.getRenderTarget(), prevBackground = scene.background, prevClear = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha();
    const was = hide.map((o) => o.visible);
    const meshWas = this.mesh.visible;
    hide.forEach((o) => (o.visible = false));
    this.mesh.visible = false;
    scene.background = null;
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.target);
    r.clear();
    r.render(scene, v);
    r.setRenderTarget(prevTarget);
    r.setClearColor(prevClear, prevAlpha);
    scene.background = prevBackground;
    hide.forEach((o, i) => (o.visible = was[i]));
    this.mesh.visible = meshWas;
    u.tReflect.value = this.target.texture;
    u.tDepth.value = this.target.depthTexture;
  }

  dispose() {
    this.target?.depthTexture?.dispose();
    this.target?.dispose();
    this.target = null;
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
