import * as THREE from "three";
import { vertexShader as sourceVertexShader } from "./sourceShader";

/** The layer the meshes that hold the vis dev bake are put on for the normals pass. */
const VISDEV_LAYER = 4;

/**
 * Draws the view space normals and depth of the geometry that holds the vis dev bake (visDev.ts) into a buffer, right before each render
 * of the scene (as the scene's onBeforeRender, at the size of what is being drawn), for the shader's cavity to read: each pixel compares
 * the normals a few pixels to its sides, as Blender's Workbench cavity does.
 */
export class VisDevNormalsPass {
  private readonly target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
  private readonly material = new THREE.ShaderMaterial({
    vertexShader: sourceVertexShader,
    fragmentShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vWorldPos;
      void main() {
        vec3 n = normalize((viewMatrix * vec4(normalize(vN), 0.0)).xyz);
        if (!gl_FrontFacing) n = -n;
        gl_FragColor = vec4(n, max(-(viewMatrix * vec4(vWorldPos, 1.0)).z, 1e-3));
      }`,
    uniforms: { uUvXf: { value: new THREE.Matrix3() } },
  });
  private busy = false;
  private readonly viewport = new THREE.Vector4();
  private readonly clear = new THREE.Color();

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly scene: THREE.Scene, private readonly uniforms: Record<string, THREE.IUniform>) {
    this.material.defaultAttributeValues.visDev = [0, 0];
    this.material.defaultAttributeValues.visDevPos = [0, 0, 0];
    this.material.defaultAttributeValues.hideW = [0];
    uniforms.tVisDevNormals.value = this.target.texture;
    scene.onBeforeRender = (_r, _s, camera) => this.run(camera);
  }

  private run(camera: THREE.Camera) {
    const u = this.uniforms;
    const cavity = u.uVisDevCavity.value as THREE.Vector3;
    // (not for the passes that draw everything in one material of their own: depth, shadows, picking, wireframe)
    if (this.busy || u.uVisDevOn.value < 0.5 || (cavity.x <= 0 && cavity.y <= 0) || this.scene.overrideMaterial) return;
    let any = false;
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry?.getAttribute("visDev")) { m.layers.enable(VISDEV_LAYER); any = true; }
    });
    if (!any) return;
    const r = this.renderer;
    r.getCurrentViewport(this.viewport);
    const w = Math.max(1, Math.round(this.viewport.z)), h = Math.max(1, Math.round(this.viewport.w));
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);
    const previous = { target: r.getRenderTarget(), face: r.getActiveCubeFace(), level: r.getActiveMipmapLevel(), alpha: r.getClearAlpha(), background: this.scene.background, mask: camera.layers.mask, autoClear: r.autoClear };
    r.getClearColor(this.clear);
    this.busy = true;
    try {
      this.scene.background = null;
      this.scene.overrideMaterial = this.material;
      camera.layers.set(VISDEV_LAYER);
      r.autoClear = true;
      r.setRenderTarget(this.target);
      r.setClearColor(0x000000, 0);
      r.clear();
      r.render(this.scene, camera);
    } finally {
      this.scene.overrideMaterial = null;
      this.scene.background = previous.background;
      camera.layers.mask = previous.mask;
      r.autoClear = previous.autoClear;
      r.setClearColor(this.clear, previous.alpha);
      r.setRenderTarget(previous.target, previous.face, previous.level);
      this.busy = false;
    }
    (u.uVisDevView.value as THREE.Vector4).set(this.viewport.x, this.viewport.y, w, h);
  }

  dispose() { this.target.dispose(); this.material.dispose(); }
}
