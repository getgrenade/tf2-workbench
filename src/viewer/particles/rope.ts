import * as THREE from "three";
import { particleBlending } from "./blending";
import type { ParticleMaterial } from "./assets";
import { leadOffset, number, type ParticleRenderSource } from "./simulation";

/** A single joined, subdivided strip: adjacent segments share their edges and interpolated attributes. */
export class ParticleRopeDraw {
  readonly mesh: THREE.Mesh;
  readonly geometry = new THREE.BufferGeometry();
  private readonly positions: THREE.BufferAttribute;
  private readonly colors: THREE.BufferAttribute;
  private readonly uvs: THREE.BufferAttribute;
  private readonly points: THREE.Vector3[];
  /** The positions of the particles as they are drawn (the state, and the way it was going since). */
  private readonly drawn: THREE.Vector3[];
  private readonly ahead = new THREE.Vector3();
  private readonly steps: number;
  private readonly cameraPosition = new THREE.Vector3();
  private readonly tangent = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly view = new THREE.Vector3();
  private readonly inverse = new THREE.Matrix4();
  private readonly texture: THREE.Texture;

  constructor(readonly simulation: ParticleRenderSource, source: ParticleMaterial, readonly rendererIndex = 0) {
    const renderer = simulation.definition.functions.renderers[rendererIndex].attributes;
    // C_OP_RenderRope uses subdivision_count intervals per pair (zero is clamped to one).
    this.steps = Math.max(1, Math.min(33, Math.floor(number(renderer, "subdivision_count", 1))));
    const max = (simulation.capacity - 1) * this.steps + 1;
    this.points = Array.from({ length: max }, () => new THREE.Vector3());
    this.drawn = Array.from({ length: simulation.capacity }, () => new THREE.Vector3());
    const attribute = (key: string, size: number) => {
      const a = new THREE.BufferAttribute(new Float32Array(max * 2 * size), size).setUsage(THREE.DynamicDrawUsage);
      this.geometry.setAttribute(key, a); return a;
    };
    this.positions = attribute("position", 3); this.colors = attribute("ribbonColor", 4); this.uvs = attribute("uv", 2);
    const indices = new Uint32Array(Math.max(0, max - 1) * 6);
    for (let i = 0; i < max - 1; i++) indices.set([2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 2, 2 * i + 1, 2 * i + 3], i * 6);
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1)); this.geometry.setDrawRange(0, 0);
    // Repeat along the rope, clamp across its width; never mutate the shared sprite texture.
    this.texture = source.texture.clone(); this.texture.wrapT = THREE.RepeatWrapping; this.texture.needsUpdate = true;
    const material = new THREE.ShaderMaterial({
      uniforms: { map: { value: this.texture }, overbright: { value: source.overbright ?? 1 },
        vertexColor: { value: source.vertexColor === false ? 0 : 1 }, vertexAlpha: { value: source.vertexAlpha === false ? 0 : 1 } },
      vertexShader: `attribute vec4 ribbonColor; varying vec4 vColor; varying vec2 vUv;
        void main() { vColor = ribbonColor; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
      fragmentShader: `uniform sampler2D map; uniform float overbright; uniform float vertexColor; uniform float vertexAlpha;
        varying vec4 vColor; varying vec2 vUv;
        void main() { vec4 pixel = texture2D(map, vUv);
          gl_FragColor = vec4(pixel.rgb * overbright * mix(vec3(1.), vColor.rgb, vertexColor), pixel.a * mix(1., vColor.a, vertexAlpha));
          if (gl_FragColor.a < .001) discard; }`,
      transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, toneMapped: false,
      ...particleBlending(source.additive),
      userData: { noShadow: true },
    });
    this.mesh = new THREE.Mesh(this.geometry, material); this.mesh.frustumCulled = false; this.mesh.renderOrder = 1;
  }

  update(camera: THREE.Camera) {
    const particles = this.simulation.particles, n = particles.length;
    if (n < 2) { this.geometry.setDrawRange(0, 0); this.mesh.visible = false; return; }
    this.mesh.visible = true;
    const count = (n - 1) * this.steps + 1;
    const lead = this.simulation.lead ?? 0, step = this.simulation.stepTime ?? 1 / 60;
    for (let i = 0; i < n; i++) this.drawn[i].copy(particles[i].position).add(leadOffset(particles[i], lead, step, this.ahead));
    // Uniform Catmull-Rom, as used by Source rope subdivision. Extrapolate endpoint neighbors.
    for (let i = 0; i < count; i++) {
      const segment = Math.min(n - 2, Math.floor(i / this.steps)), t = (i - segment * this.steps) / this.steps;
      const b = this.drawn[segment], c = this.drawn[segment + 1];
      const a = segment > 0 ? this.drawn[segment - 1] : this.tangent.copy(b).multiplyScalar(2).sub(c);
      const d = segment + 2 < n ? this.drawn[segment + 2] : this.view.copy(c).multiplyScalar(2).sub(b);
      const t2 = t * t, t3 = t2 * t;
      this.points[i].copy(b).multiplyScalar(2).addScaledVector(a, -t + 2 * t2 - t3)
        .addScaledVector(b, -5 * t2 + 3 * t3).addScaledVector(c, t + 4 * t2 - 3 * t3)
        .addScaledVector(d, -t2 + t3).multiplyScalar(0.5);
    }
    this.cameraPosition.copy(camera.getWorldPosition(this.view)).applyMatrix4(this.inverse.copy(this.mesh.matrixWorld).invert());
    const renderer = this.simulation.definition.functions.renderers[this.rendererIndex].attributes;
    const texelSize = Math.max(1e-6, number(renderer, "texel_size", 1));
    const height = this.texture.image.height || 1;
    const scrollRate = number(renderer, "texture_scroll_rate"), gamma = this.texture.colorSpace === THREE.NoColorSpace ? 1 : 2.2;
    let distance = 0;
    for (let i = 0; i < count; i++) {
      const point = this.points[i];
      if (i) distance += point.distanceTo(this.points[i - 1]);
      this.tangent.copy(this.points[Math.min(count - 1, i + 1)]).sub(this.points[Math.max(0, i - 1)]);
      this.view.copy(this.cameraPosition).sub(point);
      this.side.crossVectors(this.tangent, this.view);
      if (this.side.lengthSq() < 1e-12) this.side.set(1, 0, 0);
      else this.side.normalize();
      const segment = Math.min(n - 2, Math.floor(i / this.steps)), t = (i - segment * this.steps) / this.steps;
      const a = particles[segment], b = particles[segment + 1];
      const radius = THREE.MathUtils.lerp(a.radius, b.radius, t), alpha = THREE.MathUtils.lerp(a.alpha, b.alpha, t);
      // Source C_OP_RenderRope scales distance and scroll together by 1 / (texel_size * mapping height).
      // The authored scroll rate is world units per second, not texture repeats per second.
      const v = (distance + (this.simulation.time + lead) * scrollRate) / (texelSize * height);
      const red = Math.pow(Math.max(0, THREE.MathUtils.lerp(a.color[0], b.color[0], t)), gamma), green = Math.pow(Math.max(0, THREE.MathUtils.lerp(a.color[1], b.color[1], t)), gamma), blue = Math.pow(Math.max(0, THREE.MathUtils.lerp(a.color[2], b.color[2], t)), gamma);
      for (let edge = 0; edge < 2; edge++) {
        // C_OP_RenderRope passes radius as BeamSeg_t::m_flWidth; CBeamSegDraw uses +/- width/2.
        const vertex = i * 2 + edge, width = radius * 0.5 * (edge ? 1 : -1);
        this.positions.setXYZ(vertex, point.x + this.side.x * width, point.y + this.side.y * width, point.z + this.side.z * width);
        this.colors.setXYZW(vertex, red, green, blue, alpha);
        this.uvs.setXY(vertex, edge, v);
      }
    }
    this.geometry.setDrawRange(0, (count - 1) * 6);
    // two vertices per point: only the points of the rope go to the card
    for (const a of [this.positions, this.colors, this.uvs]) { a.clearUpdateRanges(); a.addUpdateRange(0, count * 2 * a.itemSize); a.needsUpdate = true; }
  }

  dispose() { this.mesh.removeFromParent(); this.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); this.texture.dispose(); }
}
