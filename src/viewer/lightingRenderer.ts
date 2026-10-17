import * as THREE from "three";
import { bodyMaskPass } from "./bodyMaskPass";
import { lightColor, worldDirection, lightDirection, DEFAULT_SHADOW_QUALITY, MAX_LIGHTS, type LightingRig, type RigLight, type ShadowQuality } from "./lighting";
import type { SharedUniforms } from "./sourceMaterials";
/** The most pixels the shadow atlas may have (it is a texture of four bytes a pixel, so this is a few hundred megabytes at most). */
const MAX_ATLAS_PIXELS = 48e6;
const CUBE_DIRECTIONS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const CUBE_UP = [[0, -1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0], [0, -1, 0]];
/**
 * The lights of the rig, and their shadows as Source Filmmaker draws them (the engine's flashlight: see rigShadow in lightingShader.ts): a depth map
 * for each light that casts shadows, in one atlas, drawn with the engine's depth bias.
 */
export class LightingRenderer {
  private target: THREE.WebGLRenderTarget | null = null;
  private key = "";
  /** The shadow casters (and their transforms) the shadow maps were last drawn for, compared without building strings every frame. */
  private casters: THREE.Mesh[] = [];
  private scratch: THREE.Mesh[] = [];
  private transforms = new Float64Array(0);
  private active: RigLight[] = [];
  private quality: ShadowQuality = DEFAULT_SHADOW_QUALITY;
  /** The atlas holds a column of tiles for each light that casts a shadow (six rows when one of them is a point light, else one). */
  private columns = 1;
  private rows = 1;
  /**
   * The material the maps are drawn with: the depth (packed in 24 bits), carrying the engine's depth bias, a constant and a slope-scaled one (the
   * steeper the surface is to the light, the further it is pushed back), as Direct3D's depth bias does. Both faces are drawn, as the engine does.
   */
  private depth = bodyMaskPass(new THREE.ShaderMaterial({
    vertexShader: `#include <skinning_pars_vertex>
varying vec2 vUv;
void main() { vUv = uv; vec3 transformed = position;
#include <skinbase_vertex>
#include <skinning_vertex>
gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0); }`,
    fragmentShader: `uniform sampler2D tBase; uniform float uAlphaTest; uniform mat3 uUvXf; uniform vec2 uDepthBias; varying vec2 vUv;
void main() { if (uAlphaTest > 0.0 && texture2D(tBase, (uUvXf * vec3(vUv, 1.0)).xy).a < uAlphaTest) discard;
float z = gl_FragCoord.z;
z = min(z + uDepthBias.x + uDepthBias.y * max(abs(dFdx(z)), abs(dFdy(z))), 1.0);
vec3 enc = fract(z * vec3(1.0, 255.0, 65025.0)); enc -= enc.yzz * vec3(1.0 / 255.0, 1.0 / 255.0, 0.0);
gl_FragColor = vec4(enc, 1.0); }`,
    uniforms: { tBase: { value: null }, uAlphaTest: { value: 0 }, uUvXf: { value: new THREE.Matrix3() }, uDepthBias: { value: new THREE.Vector2() } }, side: THREE.DoubleSide,
  }));
  constructor(private shared: SharedUniforms) {
    Object.assign(shared, {
      uRigCount: { value: 0 }, uRigDirection: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector3(0, 0, 1)) },
      uRigPosition: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector3()) }, uRigColor: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector3()) },
      uRigParams: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector4(0, 1, 1, 0)) }, uRigShadow: { value: new Array(MAX_LIGHTS).fill(0) },
      uRigShadowMatrix: { value: Array.from({ length: MAX_LIGHTS * 6 }, () => new THREE.Matrix4()) },
      tRigShadow: { value: null }, uRigShadowSlot: { value: new Array(MAX_LIGHTS).fill(0) }, uRigShadowGrid: { value: new THREE.Vector2(1, 1) }, uRigShadowTile: { value: 1024 },
      uRigShadowStrength: { value: new Array(MAX_LIGHTS).fill(1) }, uRigShadowFilter: { value: 6 }, uRigShadowCube: { value: new Array(MAX_LIGHTS).fill(0) }, uRigShadowJitter: { value: 0 }, uRigShadowTint: { value: new THREE.Vector3() },
      uRigShadowSoft: { value: new Array(MAX_LIGHTS).fill(1) },
      uRigCurve: { value: new Array(MAX_LIGHTS).fill(1) },
    });
    const uploadMask = this.depth.onBeforeRender.bind(this.depth);
    this.depth.onBeforeRender = (...args) => {
      uploadMask(...args);
      const own = ((args[4] as THREE.Mesh).material as THREE.ShaderMaterial).uniforms;
      this.depth.uniforms.tBase.value = own?.tBase?.value ?? null;
      this.depth.uniforms.uAlphaTest.value = own?.uAlphaTest?.value ?? 0;
      this.depth.uniforms.uUvXf.value = own?.uUvXf?.value ?? new THREE.Matrix3();
      this.depth.uniformsNeedUpdate = true;
    };
  }
  update(rig: LightingRig | undefined, camera: THREE.Camera) {
    this.active = rig ? rig.lights : [];
    this.shared.uRigCount.value = this.active.length;
    this.quality = rig?.shadow ?? DEFAULT_SHADOW_QUALITY;
    this.depth.uniforms.uDepthBias.value.set(this.quality.depthBias, this.quality.slopeBias);
    // (the engine scales its filter by two: vShadowTweaks.x * 2 in DoShadowPoisson16Sample)
    this.shared.uRigShadowFilter.value = this.quality.filter * 2;
    this.shared.uRigShadowTint.value.copy(lightColor(this.quality.tint, 1));
    let slot = 0;
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const light = this.active[i];
      const casts = !!light && light.enabled && light.shadows;
      this.shared.uRigShadowSlot.value[i] = casts ? slot++ : 0;
    }
    this.columns = Math.max(1, slot);
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const light = this.active[i];
      this.shared.uRigColor.value[i].copy(light ? lightColor(light.color, light.enabled ? light.intensity : 0) : new THREE.Vector3());
      this.shared.uRigShadow.value[i] = light?.enabled && light.shadows ? 1 : 0;
      this.shared.uRigShadowStrength.value[i] = light?.shadowStrength ?? 1;
      this.shared.uRigShadowSoft.value[i] = light?.shadowSoftness ?? 1;
      this.shared.uRigCurve.value[i] = light?.curve ?? 1;
      if (!light)
        continue;
      this.shared.uRigDirection.value[i].copy(worldDirection(light, camera.quaternion));
      this.shared.uRigPosition.value[i].fromArray(light.position);
      this.shared.uRigParams.value[i].set(light.type === "directional" ? 0 : light.type === "point" ? 1 : 2, light.range, light.falloff, Math.cos(light.cone * Math.PI / 180));
    }
  }
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, center: THREE.Vector3, radius: number, exclude: THREE.Object3D[], moved: boolean) {
    if (!this.active.some(l => l.enabled && l.shadows)) {
      this.disposeMap();
      this.key = "";
      this.casters = [];
      return;
    }
    // Rigid props/projectiles/gibs can move without changing a character's pose flag.
    scene.updateMatrixWorld(true);
    const excluded = new Set(exclude);
    const list = this.scratch;
    list.length = 0;
    scene.traverseVisible(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || Array.isArray(mesh.material) || mesh.material.userData.noShadow || mesh.userData.preview) return;
      for (let parent: THREE.Object3D | null = object; parent; parent = parent.parent) if (excluded.has(parent)) return;
      list.push(mesh);
    });
    // Where the casters are: a ball round them (and round the characters, as the view measured them), so each light's map covers only that and its
    // texels are spent on what is in the picture. A point light outside the ball needs one map aimed at it, not the six faces of a cube.
    const ball = this.casterBall(list, center, radius);
    let cube = false;
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const light = this.active[i];
      const among = light?.type === "point" && ball.distanceToPoint(new THREE.Vector3().fromArray(light.position)) <= ball.radius * .1;
      this.shared.uRigShadowCube.value[i] = among ? 1 : 0;
      if (among && light.enabled && light.shadows) cube = true;
    }
    this.rows = cube ? 6 : 1;
    this.shared.uRigShadowGrid.value.set(this.columns, this.rows);
    // the size of a tile: what is asked for, as far as the graphics card and the memory allow
    const tile = Math.max(64, Math.min(this.quality.resolution, Math.floor(renderer.capabilities.maxTextureSize / Math.max(this.columns, this.rows)), Math.floor(Math.sqrt(MAX_ATLAS_PIXELS / (this.columns * this.rows)))));
    this.shared.uRigShadowTile.value = tile;
    const width = this.columns * tile, height = this.rows * tile;
    if (this.target && (this.target.width !== width || this.target.height !== height)) this.disposeMap();
    const key = JSON.stringify(this.active) + ball.center.toArray().join(",") + ball.radius + "|" + tile + "|" + JSON.stringify(this.quality);
    // unchanged: the same lights, the same casters in the same order, none of them moved
    let same = !moved && !!this.target && this.key === key && list.length === this.casters.length;
    for (let i = 0; same && i < list.length; i++) {
      if (list[i] !== this.casters[i]) same = false;
      else {
        const e = list[i].matrixWorld.elements;
        for (let k = 0; k < 16; k++) if (e[k] !== this.transforms[i * 16 + k]) { same = false; break; }
      }
    }
    if (same) return;
    this.key = key;
    this.casters = list.slice();
    if (this.transforms.length < list.length * 16) this.transforms = new Float64Array(list.length * 16);
    for (let i = 0; i < list.length; i++) this.transforms.set(list[i].matrixWorld.elements, i * 16);
    this.target ??= new THREE.WebGLRenderTarget(width, height, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.shared.tRigShadow.value = this.target.texture;
    const hidden = new Map<THREE.Object3D, boolean>();
    const hide = (o: THREE.Object3D) => { if (!hidden.has(o)) {
      hidden.set(o, o.visible);
      o.visible = false;
    } };
    for (const o of exclude)
      hide(o);
    scene.traverse(o => { const mesh = o as THREE.Mesh; if (mesh.isMesh && (Array.isArray(mesh.material) || mesh.material.userData.noShadow || mesh.userData.preview))
      hide(o); });
    const previous = { target: renderer.getRenderTarget(), color: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(), background: scene.background, override: scene.overrideMaterial, scissor: renderer.getScissor(new THREE.Vector4()), viewport: renderer.getViewport(new THREE.Vector4()), test: renderer.getScissorTest() };
    try {
      scene.background = null;
      scene.overrideMaterial = this.depth;
      this.target.viewport.set(0, 0, width, height);
      this.target.scissorTest = false;
      renderer.setRenderTarget(this.target);
      renderer.setScissorTest(false);
      renderer.setClearColor(0xffffff, 1);
      renderer.clear();
      for (const [index, light] of this.active.entries()) {
        if (!light.enabled || !light.shadows)
          continue;
        const direction = lightDirection(light.azimuth, light.elevation);
        const count = this.shared.uRigShadowCube.value[index] ? 6 : 1;
        for (let face = 0; face < count; face++) {
          let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
          if (light.type === "directional") {
            // just round the ball (the depth range a little deeper than it, so the bias stays small in units)
            const span = Math.max(4, ball.radius * 1.05), depth = Math.max(20, ball.radius * 1.4);
            camera = new THREE.OrthographicCamera(-span, span, span, -span, depth * .5, depth * 3.5);
            camera.position.copy(ball.center).addScaledVector(direction, depth * 2);
            camera.lookAt(ball.center);
          }
          else if (count === 6) {
            camera = new THREE.PerspectiveCamera(90, 1, .5, light.range);
            camera.position.fromArray(light.position);
            camera.up.fromArray(CUBE_UP[face]);
            camera.lookAt(camera.position.clone().add(new THREE.Vector3().fromArray(CUBE_DIRECTIONS[face])));
          }
          else {
            // aimed at the ball, as narrow as it is seen from the light (a spot light's cone, when that is narrower)
            camera = new THREE.PerspectiveCamera(90, 1, .5, light.range);
            camera.position.fromArray(light.position);
            const distance = ball.center.distanceTo(camera.position);
            const fit = 2 * Math.asin(Math.min(1, ball.radius / Math.max(distance, 1e-3))) * 180 / Math.PI * 1.04;
            if (light.type === "spot" && light.cone * 2 < fit) {
              camera.fov = light.cone * 2;
              camera.lookAt(camera.position.clone().sub(direction));
            } else {
              camera.fov = Math.min(fit, 170);
              camera.lookAt(ball.center);
            }
            camera.updateProjectionMatrix();
          }
          camera.updateMatrixWorld(true);
          this.shared.uRigShadowMatrix.value[index * 6 + face].multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
          // Render-target rectangles are physical pixels, independent of the viewport's device pixel ratio.
          this.target.viewport.set(this.shared.uRigShadowSlot.value[index] * tile, face * tile, tile, tile);
          this.target.scissor.copy(this.target.viewport);
          this.target.scissorTest = true;
          renderer.setRenderTarget(this.target);
          renderer.render(scene, camera);
        }
      }
    }
    finally {
      scene.background = previous.background;
      scene.overrideMaterial = previous.override;
      for (const [o, visible] of hidden)
        o.visible = visible;
      renderer.setRenderTarget(previous.target);
      renderer.setViewport(previous.viewport);
      renderer.setScissor(previous.scissor);
      renderer.setScissorTest(previous.test);
      renderer.setClearColor(previous.color, previous.alpha);
    }
  }
  /** A ball round the casters (their bounds as drawn, with room for a pose) and the characters as the view measured them. */
  private casterBall(list: THREE.Mesh[], center: THREE.Vector3, radius: number): THREE.Sphere {
    const box = new THREE.Box3().setFromCenterAndSize(center, new THREE.Vector3().setScalar(radius * 2));
    const sphere = new THREE.Sphere();
    for (const mesh of list) {
      const geometry = mesh.geometry;
      if (!geometry.boundingSphere) geometry.computeBoundingSphere();
      if (!geometry.boundingSphere) continue;
      sphere.copy(geometry.boundingSphere).applyMatrix4(mesh.matrixWorld);
      // (a skinned mesh's bounds are those of its bind pose: some room for where the pose takes it)
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) sphere.radius *= 1.25;
      box.expandByPoint(sphere.center.clone().addScalar(sphere.radius)).expandByPoint(sphere.center.clone().addScalar(-sphere.radius));
    }
    return box.getBoundingSphere(new THREE.Sphere());
  }
  private disposeMap() {
    this.target?.dispose();
    this.target = null;
    this.shared.tRigShadow.value = null;
  }
  dispose() { this.disposeMap(); this.depth.dispose(); }
  invalidate() { this.key = ""; this.casters = []; }
  /** Whether a light casts shadows. */
  get casting() { return this.active.some(l => l.enabled && l.shadows); }
  /** Turns the shadows' filter by a fraction of a turn (see rigShadow): pictures drawn with different turns average to smooth soft edges. */
  jitter(fraction: number) { this.shared.uRigShadowJitter.value = fraction; }
}
