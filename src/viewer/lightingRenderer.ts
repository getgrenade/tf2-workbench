import * as THREE from "three";
import { bodyMaskPass } from "./bodyMaskPass";
import { lightColor, worldDirection, lightDirection, DEFAULT_SHADOW_QUALITY, MAX_LIGHTS, type LightingRig, type RigLight, type ShadowQuality } from "./lighting";
import type { SharedUniforms } from "./sourceMaterials";
/** The most pixels the shadow atlas may have (it is a texture of four bytes a pixel, so this is a few hundred megabytes at most). */
const MAX_ATLAS_PIXELS = 48e6;
const CUBE_DIRECTIONS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const CUBE_UP = [[0, -1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0], [0, -1, 0]];
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
  private depth = bodyMaskPass(new THREE.ShaderMaterial({
    vertexShader: `#include <skinning_pars_vertex>
attribute float aDetached; varying float vDetached;
varying vec2 vUv;
void main() { vUv = uv; vDetached = aDetached; vec3 transformed = position;
#include <skinbase_vertex>
#include <skinning_vertex>
gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0); }`,
    fragmentShader: `#include <packing>
uniform sampler2D tBase; uniform float uAlphaTest; uniform mat3 uUvXf; uniform float uModel; varying vec2 vUv; varying float vDetached;
void main() { if (uAlphaTest > 0.0 && texture2D(tBase, (uUvXf * vec3(vUv, 1.0)).xy).a < uAlphaTest) discard;
// the depth in 24 bits, and in the fourth channel whether this is the body of a model (1) or a part that is put on it, or hangs on it (0): see rigLitBy
vec3 enc = fract(gl_FragCoord.z * vec3(1.0, 255.0, 65025.0)); enc -= enc.yzz * vec3(1.0 / 255.0, 1.0 / 255.0, 0.0);
gl_FragColor = vec4(enc, vDetached > 0.5 ? 0.0 : uModel); }`,
    uniforms: { tBase: { value: null }, uAlphaTest: { value: 0 }, uUvXf: { value: new THREE.Matrix3() }, uModel: { value: 1 } }, side: THREE.DoubleSide,
  }));
  constructor(private shared: SharedUniforms) {
    Object.assign(shared, {
      uRigCount: { value: 0 }, uRigDirection: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector3(0, 0, 1)) },
      uRigPosition: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector3()) }, uRigColor: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector3()) },
      uRigParams: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector4(0, 1, 1, 0)) }, uRigShadow: { value: new Array(MAX_LIGHTS).fill(0) },
      uRigShadowMatrix: { value: Array.from({ length: MAX_LIGHTS * 6 }, () => new THREE.Matrix4()) },
      tRigShadow: { value: null }, uRigShadowSlot: { value: new Array(MAX_LIGHTS).fill(0) }, uRigShadowGrid: { value: new THREE.Vector2(1, 1) },
      uRigShadowBias: { value: DEFAULT_SHADOW_QUALITY.bias }, uRigShadowSoft: { value: 0 }, uRigShadowTile: { value: 1024 }, uRigShadowDetail: { value: DEFAULT_SHADOW_QUALITY.detail },
      uRigShadowStrength: { value: new Array(MAX_LIGHTS).fill(1) }, uRigTerminator: { value: 0 }, uRigShadowTint: { value: new THREE.Vector3() }, uRigContact: { value: 0 }, uRigContactLength: { value: 3 },
      tRigDepth: { value: null }, uRigViewProj: { value: new THREE.Matrix4() }, uRigViewRow: { value: new THREE.Vector4() }, uRigDepthRange: { value: new THREE.Vector3(.1, 1000, 0) }, uRigShadowTexel: { value: new Array(MAX_LIGHTS).fill(0) },
      uRigShadowNearFar: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector2(.1, 1)) },
    });
    const uploadMask = this.depth.onBeforeRender.bind(this.depth);
    this.depth.onBeforeRender = (...args) => {
      uploadMask(...args);
      const material = (args[4] as THREE.Mesh).material as THREE.ShaderMaterial;
      this.depth.uniforms.tBase.value = material.uniforms?.tBase?.value ?? null;
      this.depth.uniforms.uAlphaTest.value = material.uniforms?.uAlphaTest?.value ?? 0;
      this.depth.uniforms.uUvXf.value = material.uniforms?.uUvXf?.value ?? new THREE.Matrix3();
      // a part that is put on a model (a cosmetic) is told from the model itself (see rigLitBy in the lighting shader)
      this.depth.uniforms.uModel.value = (args[4] as THREE.Object3D).userData.cosmeticSlot ? 0 : 1;
      this.depth.uniformsNeedUpdate = true;
    };
  }
  update(rig: LightingRig | undefined, camera: THREE.Camera) {
    this.active = rig ? rig.lights : [];
    this.shared.uRigCount.value = this.active.length;
    this.quality = rig?.shadow ?? DEFAULT_SHADOW_QUALITY;
    this.shared.uRigShadowBias.value = this.quality.bias;
    this.shared.uRigShadowSoft.value = this.quality.softness * .012;
    this.shared.uRigShadowDetail.value = this.quality.detail;
    this.shared.uRigTerminator.value = this.quality.terminator;
    this.shared.uRigShadowTint.value.copy(lightColor(this.quality.tint, 1));
    this.shared.uRigContactLength.value = this.quality.contactLength;
    let slot = 0, point = false;
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const light = this.active[i];
      const casts = !!light && light.enabled && light.shadows;
      this.shared.uRigShadowSlot.value[i] = casts ? slot++ : 0;
      if (casts && light.type === "point") point = true;
    }
    this.columns = Math.max(1, slot);
    this.rows = point ? 6 : 1;
    this.shared.uRigShadowGrid.value.set(this.columns, this.rows);
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const light = this.active[i];
      this.shared.uRigColor.value[i].copy(light ? lightColor(light.color, light.enabled ? light.intensity : 0) : new THREE.Vector3());
      this.shared.uRigShadow.value[i] = light?.enabled && light.shadows ? 1 : 0;
      this.shared.uRigShadowStrength.value[i] = light?.shadowStrength ?? 1;
      if (!light)
        continue;
      this.shared.uRigDirection.value[i].copy(worldDirection(light, camera.quaternion));
      this.shared.uRigPosition.value[i].fromArray(light.position);
      this.shared.uRigParams.value[i].set(light.type === "directional" ? 0 : light.type === "point" ? 1 : 2, light.range, light.falloff, Math.cos(light.cone * Math.PI / 180));
    }
  }
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, center: THREE.Vector3, radius: number, exclude: THREE.Object3D[], moved: boolean) {
    if (!this.active.some(l => l.enabled && l.shadows)) {
      this.target?.dispose();
      this.target = null;
      this.shared.tRigShadow.value = null;
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
    // the size of a tile: what is asked for, as far as the graphics card and the memory allow
    const tile = Math.max(64, Math.min(this.quality.resolution, Math.floor(renderer.capabilities.maxTextureSize / Math.max(this.columns, this.rows)), Math.floor(Math.sqrt(MAX_ATLAS_PIXELS / (this.columns * this.rows)))));
    this.shared.uRigShadowTile.value = tile;
    const width = this.columns * tile, height = this.rows * tile;
    if (this.target && (this.target.width !== width || this.target.height !== height)) { this.target.dispose(); this.target = null; }
    const key = JSON.stringify(this.active) + center.toArray().join(",") + radius + "|" + tile + "|" + this.quality.bias;
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
      renderer.setScissorTest(true);
      for (const [index, light] of this.active.entries()) {
        if (!light.enabled || !light.shadows)
          continue;
        const direction = lightDirection(light.azimuth, light.elevation);
        const count = light.type === "point" ? 6 : 1;
        for (let face = 0; face < count; face++) {
          let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
          if (light.type === "directional") {
            // a tight depth range keeps the bias (a fraction of it) small in world units: a deep range makes a contact shadow let go of its caster
            const span = Math.max(20, radius * 1.4);
            camera = new THREE.OrthographicCamera(-span, span, span, -span, span * .5, span * 3.5);
            camera.position.copy(center).addScaledVector(direction, span * 2);
            camera.lookAt(center);
            this.shared.uRigShadowTexel.value[index] = 2 * span / tile;
            this.shared.uRigShadowNearFar.value[index].set(span * .5, span * 3.5);
          }
          else {
            const fov = light.type === "point" ? 90 : light.cone * 2;
            camera = new THREE.PerspectiveCamera(fov, 1, .5, light.range);
            // world size of a texel per unit of distance from the light
            this.shared.uRigShadowTexel.value[index] = 2 * Math.tan(fov * Math.PI / 360) / tile;
            this.shared.uRigShadowNearFar.value[index].set(.5, light.range);
            camera.position.fromArray(light.position);
            if (light.type === "point") {
              camera.up.fromArray(CUBE_UP[face]);
              camera.lookAt(camera.position.clone().add(new THREE.Vector3().fromArray(CUBE_DIRECTIONS[face])));
            }
            else
              camera.lookAt(camera.position.clone().sub(direction));
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
  private contactTarget: THREE.WebGLRenderTarget | null = null;
  /** Whether a light casts shadows that the contact shadows would add to. */
  private get contactWanted() { return this.quality.contact > 0 && this.active.some(l => l.enabled && l.shadows); }
  /**
   * Contact shadows: the scene is drawn once more (depth only, with the light's cheap shadow material), from the camera of the picture, and the
   * lighting shader follows a short ray from every pixel toward each light through that depth: what stands in front of the ray, a little, shadows
   * the pixel. It adds the small shadows where things touch that the shadow map's bias lets go of.
   */
  renderContact(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, width: number, height: number, exclude: THREE.Object3D[]) {
    if (!this.contactWanted) {
      this.shared.uRigContact.value = 0;
      this.shared.tRigDepth.value = null;
      if (this.contactTarget) { this.contactTarget.depthTexture?.dispose(); this.contactTarget.dispose(); this.contactTarget = null; }
      return;
    }
    width = Math.max(1, Math.round(width)); height = Math.max(1, Math.round(height));
    if (this.contactTarget && (this.contactTarget.width !== width || this.contactTarget.height !== height)) { this.contactTarget.depthTexture?.dispose(); this.contactTarget.dispose(); this.contactTarget = null; }
    this.contactTarget ??= new THREE.WebGLRenderTarget(width, height, { depthTexture: new THREE.DepthTexture(width, height), minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    const hidden = new Map<THREE.Object3D, boolean>();
    const hide = (o: THREE.Object3D) => { if (!hidden.has(o)) { hidden.set(o, o.visible); o.visible = false; } };
    for (const o of exclude) hide(o);
    scene.traverse(o => { const mesh = o as THREE.Mesh; if (mesh.isMesh && (Array.isArray(mesh.material) || mesh.material.userData.noShadow || mesh.userData.preview)) hide(o); });
    const previous = { target: renderer.getRenderTarget(), color: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(), background: scene.background, override: scene.overrideMaterial, scissor: renderer.getScissorTest(), };
    try {
      camera.updateMatrixWorld(true);
      scene.background = null;
      scene.overrideMaterial = this.depth;
      this.depth.uniforms.uModel.value = 1;
      renderer.setRenderTarget(this.contactTarget);
      renderer.setScissorTest(false);
      renderer.setClearColor(0xffffff, 1);
      renderer.clear();
      renderer.render(scene, camera);
    } finally {
      scene.background = previous.background;
      scene.overrideMaterial = previous.override;
      for (const [o, visible] of hidden) o.visible = visible;
      renderer.setRenderTarget(previous.target);
      renderer.setScissorTest(previous.scissor);
      renderer.setClearColor(previous.color, previous.alpha);
    }
    const view = camera.matrixWorldInverse.elements;
    const perspective = camera as THREE.PerspectiveCamera, ortho = (camera as THREE.OrthographicCamera).isOrthographicCamera === true;
    this.shared.uRigViewProj.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    // the distance of a point along the view axis is minus the z of the point in the view
    this.shared.uRigViewRow.value.set(-view[2], -view[6], -view[10], -view[14]);
    this.shared.uRigDepthRange.value.set(perspective.near, perspective.far, ortho ? 1 : 0);
    this.shared.tRigDepth.value = this.contactTarget.depthTexture;
    this.shared.uRigContact.value = this.quality.contact;
  }
  dispose() { this.target?.dispose(); this.contactTarget?.depthTexture?.dispose(); this.contactTarget?.dispose(); this.depth.dispose(); }
  invalidate() { this.key = ""; this.casters = []; }
}
