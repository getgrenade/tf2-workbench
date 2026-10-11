import * as THREE from "three";
import { particleBlending } from "./blending";
import type { ParticleMaterial, SheetSequence } from "./assets";
import { leadOffset, number, type ParticleRenderSource } from "./simulation";
import type { ParticleDefinition } from "./pcf";

export function sheetUv(sequence: SheetSequence | undefined, time: number): number[] {
  return sheetSample(sequence, time).uv;
}

/** Source samples a normalized animation cycle; FPS mode instead advances sheet time. */
export function spriteSheetTime(sequence: SheetSequence | undefined, age: number, life: number, renderer: ParticleDefinition["attributes"]): number {
  const duration = sequence?.duration ?? 1;
  if (renderer.animation_fit_lifetime) return age / life * duration;
  const rate = number(renderer, "animation rate", 1);
  return age * rate * (renderer["use animation rate as FPS"] ? 1 : duration);
}

/** C_OP_RenderScreenVelocityRotate writes roll, rather than drawing another sprite. */
export function screenVelocityRoll(viewMotion: THREE.Vector3, forwardAngle: number): number {
  return Math.atan2(viewMotion.y, viewMotion.x) + THREE.MathUtils.degToRad(forwardAngle);
}

/** C_OP_RenderSpritesTrail: the radius field is a full width, capped by trail length. */
export function trailHalfWidth(radius: number, length: number): number {
  return Math.max(0, Math.min(radius, length)) * 0.5;
}

/** Source RenderSpriteCard offsets toward the eye; a negative bias pushes behind geometry. */
export function particleDepthPosition(position: THREE.Vector3, eye: THREE.Vector3, bias: number, out: THREE.Vector3): THREE.Vector3 {
  if (bias === 0) return out.copy(position);
  out.copy(eye).sub(position);
  const distance = out.length();
  return out.multiplyScalar(distance > 1e-10 ? bias / distance : 0).add(position);
}
export function sheetSample(sequence: SheetSequence | undefined, time: number): { uv: number[]; next: number[]; blend: number } {
  if (!sequence?.frames.length) return { uv: [0, 0, 1, 1], next: [0, 0, 1, 1], blend: 0 };
  return sampleSheet(sequence, time, { uv: UNIT_RECT, next: UNIT_RECT, blend: 0 });
}
const UNIT_RECT: number[] = [0, 0, 1, 1];
/** The frame (and the next one, and how far between them) of a sheet sequence that has frames, written into `out` (no allocation). */
function sampleSheet(sequence: SheetSequence, time: number, out: { uv: number[]; next: number[]; blend: number }) {
  let at = sequence.clamp ? Math.min(Math.max(time, 0), Math.max(0, sequence.duration - 1e-6)) : ((time % sequence.duration) + sequence.duration) % sequence.duration;
  if (!Number.isFinite(at)) at = 0;
  for (let i = 0; i < sequence.frames.length; i++) {
    const frame = sequence.frames[i];
    if (at < frame.duration) {
      out.uv = frame.uv;
      out.next = sequence.frames[sequence.clamp ? Math.min(i + 1, sequence.frames.length - 1) : (i + 1) % sequence.frames.length].uv;
      out.blend = frame.duration > 0 ? at / frame.duration : 0;
      return out;
    }
    at -= frame.duration;
  }
  const last = sequence.frames[sequence.frames.length - 1].uv;
  out.uv = last;
  out.next = last;
  out.blend = 0;
  return out;
}

/** One draw per child system, rather than one Object3D per particle. */
export class ParticleDraw {
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly position: THREE.InstancedBufferAttribute;
  private readonly appearance: THREE.InstancedBufferAttribute;
  private readonly colors: THREE.InstancedBufferAttribute;
  private readonly rect: THREE.InstancedBufferAttribute;
  private readonly motion: THREE.InstancedBufferAttribute;
  private readonly nextRect: THREE.InstancedBufferAttribute;
  constructor(readonly simulation: ParticleRenderSource, readonly source: ParticleMaterial, readonly rendererIndex = 0) {
    const max = simulation.capacity;
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]), 3));
    this.geometry.setIndex([0, 1, 2, 2, 1, 3]);
    const attribute = (key: string, size: number) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(max * size), size); a.setUsage(THREE.DynamicDrawUsage); this.geometry.setAttribute(key, a); return a;
    };
    this.position = attribute("particlePosition", 3); this.appearance = attribute("appearance", 3);
    this.colors = attribute("particleColor", 4); this.rect = attribute("sheetRect", 4);
    this.motion = attribute("particleMotion", 4);
    this.nextRect = attribute("nextSheetRect", 4);
    const renderer = simulation.definition.functions.renderers[rendererIndex]?.attributes ?? {};
    const material = new THREE.ShaderMaterial({
      // C_OP_RenderSprites sets $orientation from orientation_type before binding the material.
      uniforms: { map: { value: source.texture }, overbright: { value: source.overbright ?? 1 }, orientation: { value: number(renderer, "orientation_type") },
        vertexColor: { value: source.vertexColor === false ? 0 : 1 }, vertexAlpha: { value: source.vertexAlpha === false ? 0 : 1 },
        addSelf: { value: source.addSelf ?? 0 }, sceneDepth: { value: null }, depthEnabled: { value: 0 },
        depthScale: { value: source.depthBlendScale ?? 50 }, depthSize: { value: new THREE.Vector2(1, 1) }, inverseProjection: { value: new THREE.Matrix4() },
        cameraLocal: { value: new THREE.Vector3() }, rendererType: { value: renderer.functionName === "render_sprite_trail" ? 1 : 0 },
        // a Refract material draws the picture behind it again, moved by its normal map (the `map` is that normal map)
        sceneColor: { value: null }, colorEnabled: { value: 0 }, isRefract: { value: source.refract ? 1 : 0 },
        refractAmount: { value: source.refract?.amount ?? 0 }, refractTint: { value: new THREE.Vector3(...(source.refract?.tint ?? [1, 1, 1])) } },
      vertexShader: `
        attribute vec3 particlePosition; attribute vec3 appearance; attribute vec4 particleColor;
        attribute vec4 sheetRect; attribute vec4 nextSheetRect;
        attribute vec4 particleMotion;
        uniform float orientation; uniform float rendererType; uniform vec3 cameraLocal;
        varying vec2 vUv; varying vec2 vNextUv; varying float vBlend; varying vec4 vColor;
        void main() {
          vec2 uv = position.xy * .5 + .5;
          vUv = mix(sheetRect.xy, sheetRect.zw, vec2(uv.x, 1. - uv.y));
          vNextUv = mix(nextSheetRect.xy, nextSheetRect.zw, vec2(uv.x, 1. - uv.y));
          vBlend = particleMotion.w;
          vColor = particleColor;
          vec4 center = modelViewMatrix * vec4(particlePosition, 1.0);
          float c = cos(appearance.y), s = sin(appearance.y);
          vec2 offset = mat2(c, s, -s, c) * position.xy * appearance.x;
          vec3 viewMotion = (modelViewMatrix * vec4(particleMotion.xyz, 0.)).xyz;
          if (rendererType == 1.) {
            vec2 side = length(viewMotion.xy) > .00001 ? normalize(vec2(-viewMotion.y, viewMotion.x)) : vec2(1., 0.);
            center.xy += side * position.x * appearance.x;
            center.xyz -= viewMotion * (position.y * .5 + .5);
          }
          else if (orientation == 1.) {
            vec3 toParticle = particlePosition - cameraLocal;
            vec3 right = vec3(-toParticle.y, toParticle.x, 0.);
            right = length(right) > .00001 ? normalize(right) : vec3(1., 0., 0.);
            float cy = cos(appearance.z), sy = sin(appearance.z);
            right.xy = vec2(right.x * cy + right.y * sy, right.y * cy - right.x * sy);
            center += modelViewMatrix * vec4(right * offset.x + vec3(0., 0., offset.y), 0.);
          }
          else if (orientation == 2.) center += modelViewMatrix * vec4(offset.y, offset.x, 0., 0.);
          else {
            // Source spritecard_vsxx.fxc rotates the rolled billboard about view Y.
            // Keep the depth displacement: yaw makes the flat card turn edge-on.
            float cy = cos(appearance.z), sy = sin(appearance.z);
            center.xyz += vec3(offset.x * cy, offset.y, -offset.x * sy);
          }
          gl_Position = projectionMatrix * center;
        }`,
      fragmentShader: `uniform sampler2D map; uniform float overbright; uniform float addSelf; uniform float vertexColor; uniform float vertexAlpha;
        uniform sampler2D sceneDepth; uniform float depthEnabled; uniform float depthScale;
        uniform vec2 depthSize; uniform mat4 inverseProjection;
        uniform sampler2D sceneColor; uniform float colorEnabled; uniform float isRefract; uniform float refractAmount; uniform vec3 refractTint;
        varying vec2 vUv; varying vec2 vNextUv; varying float vBlend; varying vec4 vColor;
        float viewDepth(vec2 uv, float depth) {
          vec4 view = inverseProjection * vec4(uv * 2. - 1., depth * 2. - 1., 1.);
          return -view.z / view.w;
        }
        void main() {
          vec4 pixel = mix(texture2D(map, vUv), texture2D(map, vNextUv), vBlend);
          float particleAlpha = mix(1., vColor.a, vertexAlpha);
          if (isRefract > .5) {
            // refract_ps2x.fxc: the picture is read at the place of the pixel, moved by normal.xy * (normal.a * $refractamount * the alpha of the
            // particle), times the tint and the colour of the particle; it is drawn with the alpha of the particle times the alpha of the normal map
            if (colorEnabled < .5) discard;
            vec2 screen = gl_FragCoord.xy / depthSize;
            vec3 normal = pixel.rgb * 2. - 1.;
            vec2 moved = screen + vec2(normal.x, -normal.y) * (pixel.a * refractAmount * particleAlpha);
            vec3 behind = texture2D(sceneColor, clamp(moved, 0., 1.)).rgb * refractTint * mix(vec3(1.), vColor.rgb, vertexColor);
            float a = pixel.a * particleAlpha;
            if (a < .001) discard;
            gl_FragColor = vec4(behind * a, a);
            return;
          }
          if (depthEnabled > .5) {
            vec2 uv = gl_FragCoord.xy / depthSize;
            float depth = texture2D(sceneDepth, uv).r;
            if (depth < 1.) particleAlpha *= clamp((viewDepth(uv, depth) - viewDepth(uv, gl_FragCoord.z)) / depthScale, 0., 1.);
          }
          float alpha = pixel.a * particleAlpha;
          // Source SpriteCard uses premultiplied ONE:INV_SRC_ALPHA and ADDSELF emission.
          vec3 rgb = pixel.rgb * overbright * alpha;
          rgb *= 1. + overbright * addSelf * particleAlpha;
          gl_FragColor = vec4(rgb * mix(vec3(1.), vColor.rgb, vertexColor), alpha);
          if (alpha < .001) discard;
        }`,
      transparent: true, depthWrite: false, depthTest: true,
      ...particleBlending(source.additive, true),
      userData: { noShadow: true },
      premultipliedAlpha: true,
      side: THREE.DoubleSide, toneMapped: false,
    });
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.geometry.instanceCount = 0;
  }
  setSceneDepth(texture: THREE.Texture | null, camera: THREE.Camera, width: number, height: number, color: THREE.Texture | null = null) {
    const uniforms = (this.mesh.material as THREE.ShaderMaterial).uniforms;
    uniforms.sceneDepth.value = texture;
    uniforms.sceneColor.value = color;
    uniforms.colorEnabled.value = this.source.refract && color ? 1 : 0;
    uniforms.depthEnabled.value = this.source.depthBlend && texture ? 1 : 0;
    uniforms.depthSize.value.set(width, height);
    uniforms.inverseProjection.value.copy(camera.projectionMatrixInverse);
  }
  /** Whether the last update left anything to draw (an idle emitter draws nothing and needs no scene depth). */
  get hasParticles() { return this.geometry.instanceCount > 0; }
  /** Whether it needs the picture behind it (a Refract material) as well as, for soft particles, the depth. */
  get needsSceneColor() { return !!this.source.refract && this.hasParticles; }
  get needsSceneDepth() { return (!!this.source.depthBlend || !!this.source.refract) && this.hasParticles; }
  // reused by every update
  private readonly modelView = new THREE.Matrix4();
  private readonly inverseWorld = new THREE.Matrix4();
  private readonly viewMotion = new THREE.Vector3();
  private readonly renderPosition = new THREE.Vector3();
  private readonly ahead = new THREE.Vector3();
  private readonly displacement = new THREE.Vector3();
  private readonly localCamera = new THREE.Vector3();
  private readonly sample = { uv: UNIT_RECT, next: UNIT_RECT, blend: 0 };
  update(camera: THREE.Camera) {
    // an idle system (most of the children of a big effect are, most of the time) costs nothing: no matrices, no upload of its buffers
    // (an object that is not visible costs the renderer nothing: 760 empty draws of six Electric Impulses were 1 to 2 ms of a frame)
    if (!this.simulation.particles.length) { this.geometry.instanceCount = 0; this.mesh.visible = false; return; }
    this.mesh.visible = true;
    const sim = this.simulation, renderer = sim.definition.functions.renderers[this.rendererIndex]?.attributes ?? {};
    const rotate = sim.definition.functions.renderers.find((op) => op.attributes.functionName === "render_screen_velocity_rotate")?.attributes;
    camera.updateWorldMatrix(true, false);
    const modelView = this.modelView.multiplyMatrices(camera.matrixWorldInverse, this.mesh.matrixWorld);
    const viewMotion = this.viewMotion, displacement = this.displacement, renderPosition = this.renderPosition;
    const material = this.mesh.material as THREE.ShaderMaterial;
    this.inverseWorld.copy(this.mesh.matrixWorld).invert();
    const cameraLocal = material.uniforms.cameraLocal.value as THREE.Vector3;
    cameraLocal.copy(camera.getWorldPosition(this.localCamera)).applyMatrix4(this.inverseWorld);
    const depthBias = number(renderer, "Visibility Camera Depth Bias");
    const dt = sim.stepTime ?? 1 / 60; // PREV_XYZ is one simulation tick, not one IPC frame.
    const lead = sim.lead ?? 0;
    // the particles are copied only to be sorted
    let particles = sim.particles;
    if (sim.definition.attributes["Sort particles"] && !this.source.additive) {
      const localCamera = camera.getWorldPosition(this.localCamera).applyMatrix4(this.inverseWorld);
      particles = particles.slice().sort((a, b) => b.position.distanceToSquared(localCamera) - a.position.distanceToSquared(localCamera));
    }
    const trail = renderer.functionName === "render_sprite_trail";
    const maxLength = trail ? number(renderer, "max length") : 0, fadeIn = trail ? number(renderer, "length fade in time") : 0, minLength = trail ? number(renderer, "min length") : 0;
    const forwardAngle = rotate ? number(rotate, "forward_angle") : 0;
    const gamma = this.source.srgb === false ? 1 : 2.2;
    const blendFrames = !!this.source.blendFrames;
    const sample = this.sample, e = modelView.elements;
    const count = particles.length;
    for (let i = 0; i < count; i++) {
      const p = particles[i], age = sim.time + lead - p.born;
      // drawn where it is by now: its state, and the way it was going for as long as the state is behind the clock of the view
      leadOffset(p, lead, dt, this.ahead).add(p.position);
      particleDepthPosition(this.ahead, cameraLocal, depthBias, renderPosition);
      this.position.setXYZ(i, renderPosition.x, renderPosition.y, renderPosition.z);
      if (p.previous) displacement.copy(p.position).sub(p.previous); else displacement.set(0, 0, 0);
      let roll = p.rotation;
      if (rotate && p.previous) {
        const d = displacement;
        viewMotion.set(e[0] * d.x + e[4] * d.y + e[8] * d.z,
          e[1] * d.x + e[5] * d.y + e[9] * d.z, e[2] * d.x + e[6] * d.y + e[10] * d.z);
        roll = screenVelocityRoll(viewMotion, forwardAngle);
      }
      let radius = p.radius;
      if (trail) {
        const distance = displacement.length();
        const length = THREE.MathUtils.clamp(distance / dt * (p.trailLength ?? 1) * (fadeIn > 0 ? Math.min(1, age / fadeIn) : 1),
          minLength, maxLength > 0 ? maxLength : Infinity);
        if (distance) displacement.multiplyScalar(length / distance);
        radius = trailHalfWidth(p.radius, distance > 0 ? length : 0);
      }
      this.appearance.setXYZ(i, radius, roll, p.yaw);
      this.motion.setXYZW(i, displacement.x, displacement.y, displacement.z, 0);
      this.colors.setXYZW(i, Math.pow(Math.max(0, p.color[0]), gamma), Math.pow(Math.max(0, p.color[1]), gamma), Math.pow(Math.max(0, p.color[2]), gamma), p.alpha);
      const sequence = this.source.sheet.get(p.sequence) ?? this.source.sheet.get(0);
      const time = spriteSheetTime(sequence, age, p.life, renderer);
      let uv = UNIT_RECT, next = UNIT_RECT, blend = 0;
      if (sequence?.frames.length) {
        sampleSheet(sequence, time, sample);
        uv = sample.uv; next = sample.next; blend = sample.blend;
      }
      this.rect.setXYZW(i, uv[0], uv[1], uv[2], uv[3]);
      this.nextRect.setXYZW(i, next[0], next[1], next[2], next[3]);
      this.motion.setW(i, blendFrames ? blend : 0);
    }
    this.geometry.instanceCount = count;
    // only what is drawn goes to the card: the buffers are as big as the most particles the system may have
    for (const a of [this.position, this.appearance, this.colors, this.rect, this.nextRect, this.motion]) {
      a.clearUpdateRanges(); a.addUpdateRange(0, count * a.itemSize); a.needsUpdate = true;
    }
  }
  dispose() { this.mesh.removeFromParent(); this.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}
