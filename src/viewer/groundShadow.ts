import * as THREE from "three";
import { bodyMaskDeclarations, bodyMaskDiscard } from "./bodyMaskShader";
import { blurTaps, SHADOW_TEXTURE_SIZE, shadowFootprint, type ShadowParams } from "./shadowMath";

const TAPS = 17;

/**
 * A soft shadow cast onto the ground plane (no self shadowing). Every shadow-casting mesh of the scene is drawn flattened onto
 * the floor along the shadow direction into a texture (a plain silhouette), that texture is Gaussian-blurred for the
 * feathering, and a ground quad shows it as a black, semi-transparent decal. The silhouette follows the animation because
 * the flattening happens in the vertex shader after skinning.
 */
export class GroundShadow {
  /** The decal in the scene; hidden until the first render. */
  readonly quad: THREE.Mesh;
  private readonly rtA: THREE.WebGLRenderTarget;
  private readonly rtB: THREE.WebGLRenderTarget;
  private readonly casterMaterial: THREE.ShaderMaterial;
  private readonly blurMaterial: THREE.ShaderMaterial;
  private readonly blurScene = new THREE.Scene();
  private readonly blurCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 5000);
  private readonly decalMaterial: THREE.ShaderMaterial;
  private readonly renderer: THREE.WebGLRenderer;
  /** Parameters of the silhouette currently in the texture. */
  private drawnKey = "";
  private readonly scene: THREE.Scene;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    this.renderer = renderer;
    this.scene = scene;
    const opts = { type: THREE.UnsignedByteType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
    this.rtA = new THREE.WebGLRenderTarget(SHADOW_TEXTURE_SIZE, SHADOW_TEXTURE_SIZE, opts);
    this.rtB = new THREE.WebGLRenderTarget(SHADOW_TEXTURE_SIZE, SHADOW_TEXTURE_SIZE, opts);
    for (const rt of [this.rtA, this.rtB]) {
      rt.texture.wrapS = rt.texture.wrapT = THREE.ClampToEdgeWrapping;
    }

    // Flattens skinned geometry onto the floor: a point at height h moves h * length along the shadow direction.
    this.casterMaterial = new THREE.ShaderMaterial({
      uniforms: { uFloorY: { value: 0 }, uDir: { value: new THREE.Vector2(0, -1) }, uLength: { value: 1 }, tBodyMask: { value: null }, uBodyHideBits: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute float hideW;
        varying float vHideW;
        varying vec2 vBodyUv;
        #include <skinning_pars_vertex>
        uniform float uFloorY;
        uniform vec2 uDir;
        uniform float uLength;
        void main() {
          vHideW = hideW;
          vBodyUv = uv;
          #include <skinbase_vertex>
          vec3 transformed = vec3(position);
          #include <skinning_vertex>
          vec3 wp = (modelMatrix * vec4(transformed, 1.0)).xyz;
          float h = max(wp.y - uFloorY, 0.0);
          vec3 ground = vec3(wp.x + uDir.x * uLength * h, uFloorY, wp.z + uDir.y * uLength * h);
          gl_Position = projectionMatrix * viewMatrix * vec4(ground, 1.0);
        }`,
      fragmentShader: `${bodyMaskDeclarations} varying float vHideW; void main() { ${bodyMaskDiscard} if (vHideW > 0.5) discard; gl_FragColor = vec4(1.0); }`,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });

    // The override material is reused across meshes: upload each actor's own UV mask before its draw.
    this.casterMaterial.onBeforeRender = (_renderer, _scene, _camera, _geometry, object) => {
      const material = (object as THREE.Mesh).material as THREE.ShaderMaterial;
      this.casterMaterial.uniforms.tBodyMask.value = material.uniforms?.tBodyMask?.value ?? null;
      this.casterMaterial.uniforms.uBodyHideBits.value = material.uniforms?.uBodyHideBits?.value ?? 0;
      this.casterMaterial.uniformsNeedUpdate = true;
    };

    this.blurMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tSource: { value: this.rtA.texture },
        uAxis: { value: new THREE.Vector2(1, 0) },
        uOffsets: { value: new Array(TAPS).fill(0) },
        uWeights: { value: new Array(TAPS).fill(0) },
        uTexel: { value: 1 / SHADOW_TEXTURE_SIZE },
      },
      vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
      fragmentShader: /* glsl */ `
        uniform sampler2D tSource;
        uniform vec2 uAxis;
        uniform float uOffsets[${TAPS}];
        uniform float uWeights[${TAPS}];
        uniform float uTexel;
        varying vec2 vUv;
        void main() {
          float sum = 0.0;
          for (int i = 0; i < ${TAPS}; i++) sum += uWeights[i] * texture2D(tSource, vUv + uAxis * uOffsets[i] * uTexel).r;
          gl_FragColor = vec4(vec3(sum), 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    const blurQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blurMaterial);
    blurQuad.frustumCulled = false;
    this.blurScene.add(blurQuad);

    this.decalMaterial = new THREE.ShaderMaterial({
      uniforms: { tShadow: { value: this.rtA.texture }, uOpacity: { value: 0.5 } },
      vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: "uniform sampler2D tShadow; uniform float uOpacity; varying vec2 vUv; void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, texture2D(tShadow, vUv).r * uOpacity); }",
      transparent: true,
      depthWrite: false,
    });
    const geo = new THREE.PlaneGeometry(2, 2);
    geo.rotateX(-Math.PI / 2); // lies on the floor; uv.u runs along +x and uv.v toward -z, like the shadow camera
    this.quad = new THREE.Mesh(geo, this.decalMaterial);
    this.quad.renderOrder = -1; // before the model's own translucent layers
    this.quad.frustumCulled = false;
    this.quad.visible = false;
    scene.add(this.quad);
  }

  /** Meshes that must not cast a shadow (translucent / additive layers such as glass, the light gizmo). */
  private static isCaster(o: THREE.Object3D): boolean {
    const m = (o as THREE.Mesh).material as THREE.Material | undefined;
    return !!m && !m.userData?.noShadow;
  }

  /**
   * Redraws the shadow for the current pose and updates the decal. `floorY` is the height of the floor, `cx`/`cz` and `radius`
   * the model's bounds. Call once per frame before the main render; leaves the renderer on the default framebuffer.
   */
  update(p: ShadowParams, cx: number, cz: number, radius: number, floorY: number, exclude: THREE.Object3D[], redraw = true) {
    this.quad.visible = p.enabled;
    if (!p.enabled) {
      this.drawnKey = ""; // the texture goes stale while the shadow is off
      return;
    }
    const f = shadowFootprint(p, cx, cz, radius);

    // Shadow camera: straight down over the ground square; screen right = +x, screen up = -z.
    const cam = this.camera;
    cam.left = -f.half;
    cam.right = f.half;
    cam.top = f.half;
    cam.bottom = -f.half;
    cam.position.set(f.centerX, floorY + 2500, f.centerZ);
    cam.up.set(0, 0, -1);
    cam.lookAt(f.centerX, floorY, f.centerZ);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);

    // The silhouette texture only needs redrawing when something in it moved or the shadow settings changed.
    const key = `${p.azimuth}|${p.length}|${p.blur}|${f.half}|${f.centerX}|${f.centerZ}|${floorY}`;
    const needs = redraw || key !== this.drawnKey;
    this.drawnKey = key;
    if (needs) {
      const u = this.casterMaterial.uniforms;
      u.uFloorY.value = floorY;
      u.uDir.value.set(f.dirX, f.dirZ);
      u.uLength.value = p.length;

      // Draw only the casters: hide everything else, drop the background, clear to black.
      // the list holds each object once: the exclusions can hold this decal as well, and a second entry would remember it as already hidden
      const hidden: THREE.Object3D[] = [...new Set<THREE.Object3D>([this.quad, ...exclude])];
      const wasVisible = new Map<THREE.Object3D, boolean>();
      this.scene.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && !hidden.includes(o) && !GroundShadow.isCaster(o)) hidden.push(o);
      });
      for (const o of hidden) {
        wasVisible.set(o, o.visible);
        o.visible = false;
      }
      const background = this.scene.background;
      const prevTarget = this.renderer.getRenderTarget();
      const prevClear = this.renderer.getClearColor(new THREE.Color());
      const prevAlpha = this.renderer.getClearAlpha();
      const prevOverride = this.scene.overrideMaterial;

      this.scene.background = null;
      this.scene.overrideMaterial = this.casterMaterial;
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.setRenderTarget(this.rtA);
      this.renderer.clear();
      this.renderer.render(this.scene, cam);
      this.scene.overrideMaterial = prevOverride;
      this.scene.background = background;
      this.renderer.setClearColor(prevClear, prevAlpha);
      for (const [o, v] of wasVisible) o.visible = v;

      // Feather: separable Gaussian, horizontal rtA -> rtB then vertical rtB -> rtA.
      if (f.sigmaTexels > 0.05) {
        const { offsets, weights } = blurTaps(f.sigmaTexels, TAPS);
        const b = this.blurMaterial.uniforms;
        b.uOffsets.value = offsets;
        b.uWeights.value = weights;
        b.tSource.value = this.rtA.texture;
        b.uAxis.value.set(1, 0);
        this.renderer.setRenderTarget(this.rtB);
        this.renderer.render(this.blurScene, this.blurCamera);
        b.tSource.value = this.rtB.texture;
        b.uAxis.value.set(0, 1);
        this.renderer.setRenderTarget(this.rtA);
        this.renderer.render(this.blurScene, this.blurCamera);
      }
      this.renderer.setRenderTarget(prevTarget);
    }

    // The decal: the same square on the floor, a hair above it to avoid z-fighting with a ground plane.
    this.quad.position.set(f.centerX, floorY + 0.05, f.centerZ);
    this.quad.scale.set(f.half, 1, f.half);
    this.decalMaterial.uniforms.uOpacity.value = Math.min(Math.max(p.opacity, 0), 1);
  }

  dispose() {
    this.rtA.dispose();
    this.rtB.dispose();
    this.casterMaterial.dispose();
    this.blurMaterial.dispose();
    this.decalMaterial.dispose();
    this.quad.geometry.dispose();
  }
}
