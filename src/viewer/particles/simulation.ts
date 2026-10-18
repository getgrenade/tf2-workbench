import * as THREE from "three";
import type { DmxElement, DmxValue, ParticleDefinition } from "./pcf";

type Params = Record<string, DmxValue>;
export const number = (p: Params, key: string, fallback = 0) => typeof p[key] === "number" ? p[key] as number : fallback;
export const vector = (p: Params, key: string, fallback = [0, 0, 0]) => Array.isArray(p[key]) ? p[key] as number[] : fallback;
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ramp = (v: number, a: number, b: number) => a === b ? (v >= b ? 1 : 0) : clamp((v - a) / (b - a));
const smooth = (v: number) => v * v * (3 - 2 * v);
const radians = Math.PI / 180;
/** Valve's SinEst01SIMD, used by scalar oscillation; phase is in half-turns. */
export function sourceOscillationWave(phase: number): number {
  const wrapped = ((phase % 2) + 2) % 2;
  const t = wrapped >= 1 ? wrapped - 1 : wrapped;
  return (wrapped >= 1 ? -1 : 1) * 4 * t * (1 - t);
}
const supported = new Set([
  "emit_continuously", "emit_instantaneously", "Lifetime Random", "Radius Random", "Color Random", "Alpha Random",
  "Position Within Box Random", "Position Within Sphere Random", "Position on Model Random", "Position From Parent Particles", "Position Modify Offset Random",
  "Velocity Noise", "Remap Noise to Scalar",
  "Sequence Random", "Rotation Random", "Rotation Speed Random", "Velocity Random", "Lifespan Decay", "Movement Basic",
  "Movement Lock to Control Point", "Movement Lock to Bone", "Movement Rotate Particle Around Axis", "Oscillate Vector",
  "Oscillate Scalar", "Alpha Fade In Random", "Alpha Fade Out Random", "Alpha Fade and Decay", "Color Fade", "Radius Scale",
  "Rotation Spin Roll", "Rotation Basic", "twist around axis", "Pull towards control point", "render_animated_sprites", "render_rope",
]);
export function validateDefinitions(definitions: Map<string, ParticleDefinition>, root: string) {
  const visited = new Set<string>();
  const visit = (name: string, path: Set<string>) => {
    if (path.has(name)) throw new Error(`Cyclic particle child: ${name}`);
    const def = definitions.get(name);
    if (!def) throw new Error(`Missing particle system: ${name}`);
    if (visited.has(name)) return;
    visited.add(name);
    for (const ops of Object.values(def.functions)) for (const op of ops) {
      if (!supported.has(String(op.attributes.functionName))) throw new Error(`Unsupported particle operator: ${op.attributes.functionName} (${name})`);
    }
    const next = new Set(path).add(name);
    for (const child of def.children) visit(child.name, next);
  };
  visit(root, new Set());
  return visited;
}

export interface ModelSample { position: THREE.Vector3; bone: number; local: THREE.Vector3 }
export interface ParticleQueries {
  controlPoint: () => THREE.Matrix4;
  sampleModel: (random: () => number, scale: number, bias: THREE.Vector3) => ModelSample;
  bone: (index: number) => THREE.Matrix4 | null;
}
export interface Particle {
  position: THREE.Vector3; velocity: THREE.Vector3; initialColor: number[]; color: number[];
  born: number; life: number; alpha: number; initialAlpha: number; radius: number; initialRadius: number;
  rotation: number; rotationSpeed: number; yaw: number; sequence: number; bone: number;
  boneLocal: THREE.Vector3; previousBone: THREE.Vector3; samples: Map<DmxElement, number[]>;
}
export type RenderParticle = Pick<Particle, "position" | "color" | "born" | "life" | "alpha" | "radius" | "rotation" | "yaw" | "sequence"> & { previous?: THREE.Vector3; trailLength?: number };
/** Both Valve and compatibility simulations supply the same rendering attributes. */
export interface ParticleRenderSource {
  readonly definition: ParticleDefinition;
  readonly capacity: number;
  readonly time: number;
  readonly stepTime?: number;
  /**
   * Seconds of real time the state is behind the clock of the view (a state of the helper arrives some milliseconds after the tick it
   * describes, and ticks are 60 Hz whatever the display's rate). The draws move every particle on by its own step times this, so that it
   * moves evenly at every frame rate instead of by one tick at a time.
   */
  readonly lead?: number;
  readonly particles: RenderParticle[];
}

/** How far ahead of its state a particle is drawn: its step of the last tick, in proportion to `lead` (not for one that jumped). */
export function leadOffset(p: RenderParticle, lead: number, stepTime: number, out: THREE.Vector3): THREE.Vector3 {
  if (!(lead > 0) || !p.previous || !(stepTime > 0)) return out.set(0, 0, 0);
  out.copy(p.position).sub(p.previous);
  // a step of more than a few thousand units a second was a placement (a birth, a teleport), not a motion
  return out.lengthSq() > (stepTime * 3000) ** 2 ? out.set(0, 0, 0) : out.multiplyScalar(lead / stepTime);
}
const scratch = new THREE.Vector3(), center = new THREE.Vector3(), axis = new THREE.Vector3(), acceleration = new THREE.Vector3();

/** CPU preview of the operators used by the two initial reference effects. Fixed steps make restart repeatable. */
export class ParticleSimulation {
  readonly particles: Particle[] = [];
  readonly children: ParticleSimulation[];
  readonly capacity: number;
  private readonly pool: Particle[] = [];
  private readonly emission = new Map<DmxElement, number>();
  private readonly bursts = new Set<DmxElement>();
  private readonly previousCp = new THREE.Vector3();
  private readonly deltaCp = new THREE.Vector3();
  private readonly cp = new THREE.Matrix4();
  private clock = 0;
  private seed: number;
  private id = 0;
  constructor(readonly definition: ParticleDefinition, definitions: Map<string, ParticleDefinition>, readonly queries: ParticleQueries,
    seed = 1, readonly parent: ParticleSimulation | null = null, readonly delay = 0) {
    this.seed = seed >>> 0;
    this.capacity = Math.max(1, Math.min(5000, number(definition.attributes, "max_particles", 1000)));
    this.cp.copy(queries.controlPoint()); this.previousCp.setFromMatrixPosition(this.cp);
    this.children = definition.children.map((child, i) => new ParticleSimulation(definitions.get(child.name)!, definitions, queries, seed + i * 701 + 1, this, child.delay));
    for (let i = 0; i < Math.min(this.capacity, number(definition.attributes, "initial_particles")); i++) this.spawn();
  }
  readonly random = () => {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  };
  get time() { return this.clock - this.delay; }
  private range(p: Params, min: string, max: string, fallback = 0, exponent = "") {
    return lerp(number(p, min, fallback), number(p, max, number(p, min, fallback)), Math.pow(this.random(), exponent ? number(p, exponent, 1) : 1));
  }
  private randomVector(p: Params, min: string, max: string): THREE.Vector3 {
    const a = vector(p, min), b = vector(p, max, a);
    return new THREE.Vector3(...a.map((v, i) => lerp(v, b[i], this.random())) as [number, number, number]);
  }
  private spawn() {
    if (this.particles.length >= this.capacity) return;
    const p = this.pool.pop() ?? {
      position: new THREE.Vector3(), velocity: new THREE.Vector3(), initialColor: [1, 1, 1], color: [1, 1, 1],
      born: 0, life: 1, alpha: 1, initialAlpha: 1, radius: 1, initialRadius: 1, rotation: 0, rotationSpeed: 0, yaw: 0,
      sequence: 0, bone: -1, boneLocal: new THREE.Vector3(), previousBone: new THREE.Vector3(), samples: new Map(),
    };
    p.position.setFromMatrixPosition(this.cp); p.velocity.set(0, 0, 0); p.samples.clear();
    p.born = this.time; p.life = 1; p.alpha = p.initialAlpha = 1; p.radius = p.initialRadius = number(this.definition.attributes, "radius", 1);
    p.rotation = number(this.definition.attributes, "rotation") * radians; p.rotationSpeed = number(this.definition.attributes, "rotation_speed") * radians;
    p.yaw = 0; p.bone = -1; p.sequence = number(this.definition.attributes, "sequence_number");
    const initial = vector(this.definition.attributes, "color", [255, 255, 255]);
    p.initialColor = initial.slice(0, 3).map((v) => v / 255); p.color = p.initialColor.slice();
    for (const op of this.definition.functions.initializers) {
      const a = op.attributes;
      switch (a.functionName) {
        case "Lifetime Random": p.life = Math.max(1e-3, this.range(a, "lifetime_min", "lifetime_max", 1, "lifetime_random_exponent")); break;
        case "Radius Random": p.radius = this.range(a, "radius_min", "radius_max", 1, "radius_random_exponent"); break;
        case "Alpha Random": p.alpha = this.range(a, "alpha_min", "alpha_max", 255, "alpha_random_exponent") / 255; break;
        case "Color Random": { const x = vector(a, "color1", [255, 255, 255]), y = vector(a, "color2", x), t = this.random(); p.initialColor = x.slice(0, 3).map((v, i) => lerp(v, y[i], t) / 255); break; }
        case "Position Within Box Random": {
          p.position.copy(this.randomVector(a, "min", "max"));
          // Box offsets are world aligned unless local space is explicitly requested.
          // Applying a hat's head-bone rotation here sends Silver's staff into the neck.
          if (a["use local space"]) p.position.applyMatrix4(this.cp);
          else p.position.add(scratch.setFromMatrixPosition(this.cp));
          break;
        }
        case "Position on Model Random": {
          const sample = this.queries.sampleModel(this.random, number(a, "hitbox scale", 1), new THREE.Vector3(...vector(a, "direction bias") as [number, number, number]));
          p.position.copy(sample.position); p.bone = sample.bone; p.boneLocal.copy(sample.local); p.previousBone.copy(p.position); break;
        }
        case "Position From Parent Particles": {
          const parents = this.parent?.particles;
          if (parents?.length) { const source = parents[a["Random Parent Particle Distribution"] ? Math.floor(this.random() * parents.length) : this.id % parents.length]; p.position.copy(source.position); p.velocity.copy(source.velocity).multiplyScalar(number(a, "Inherited Velocity Scale")); }
          break;
        }
        case "Position Modify Offset Random": { const offset = this.randomVector(a, "offset min", "offset max"); if (a["offset proportional to radius 0/1"]) offset.multiplyScalar(p.radius); if (a["offset in local space 0/1"]) offset.applyMatrix3(new THREE.Matrix3().setFromMatrix4(this.cp)); p.position.add(offset); break; }
        case "Sequence Random": p.sequence = Math.floor(this.range(a, "sequence_min", "sequence_max") + 0.5); break;
        case "Rotation Random": p.rotation = (number(a, "rotation_initial") + this.range(a, "rotation_offset_min", "rotation_offset_max", 0, "rotation_random_exponent")) * radians; break;
        case "Rotation Speed Random": p.rotationSpeed = (number(a, "rotation_speed_constant") + this.range(a, "rotation_speed_random_min", "rotation_speed_random_max", 0, "rotation_speed_random_exponent")) * radians * (a.randomly_flip_direction && this.random() < 0.5 ? -1 : 1); break;
        case "Position Within Sphere Random": {
          // a point at a random distance from the control point in a random direction (biased by axis), moving away at a random speed, plus a
          // speed in the control point's own frame
          const dir = scratch.set(this.random() * 2 - 1, this.random() * 2 - 1, this.random() * 2 - 1);
          const bias = vector(a, "distance_bias", [1, 1, 1]);
          dir.multiply(new THREE.Vector3(...bias as [number, number, number]));
          if (dir.lengthSq() < 1e-12) dir.set(0, 0, 1); else dir.normalize();
          if (a["bias in local system"]) dir.applyMatrix3(new THREE.Matrix3().setFromMatrix4(this.cp)).normalize();
          const distance = this.range(a, "distance_min", "distance_max");
          p.position.setFromMatrixPosition(this.cp).addScaledVector(dir, distance);
          p.velocity.addScaledVector(dir, this.range(a, "speed_min", "speed_max", 0, "speed_random_exponent"));
          p.velocity.add(this.randomVector(a, "speed_in_local_coordinate_system_min", "speed_in_local_coordinate_system_max").applyMatrix3(new THREE.Matrix3().setFromMatrix4(this.cp)));
          break;
        }
        case "Velocity Noise": {
          // (the noise field is stood in for by a draw per particle: what it gives a particle, not how it varies over space and time)
          const v = this.randomVector(a, "output minimum", "output maximum");
          if (a["Apply Velocity in Local Space (0/1)"]) v.applyMatrix3(new THREE.Matrix3().setFromMatrix4(this.cp));
          p.velocity.add(v);
          break;
        }
        case "Remap Noise to Scalar": {
          const value = this.range(a, "output minimum", "output maximum");
          switch (number(a, "output field")) {
            case 1: p.life = Math.max(1e-3, value); break;
            case 3: p.radius = value; break;
            case 4: p.rotation = value * radians; break;
            case 5: p.rotationSpeed = value * radians; break;
            case 7: p.alpha = value; break;
            case 12: p.yaw = value; break;
          }
          break;
        }
        case "Velocity Random": {
          p.velocity.add(this.randomVector(a, "speed_in_local_coordinate_system_min", "speed_in_local_coordinate_system_max").applyMatrix3(new THREE.Matrix3().setFromMatrix4(this.cp)));
          const speed = this.range(a, "random_speed_min", "random_speed_max");
          if (speed) { scratch.set(this.random() * 2 - 1, this.random() * 2 - 1, this.random() * 2 - 1).normalize(); p.velocity.addScaledVector(scratch, speed); }
          break;
        }
      }
    }
    p.initialAlpha = p.alpha; p.initialRadius = p.radius; p.color = p.initialColor.slice();
    this.id++; this.particles.push(p);
  }
  /** Runs the simulation `seconds` ahead in its own steps (a picture taken at a set moment of the effect). */
  advance(seconds: number) {
    for (let i = 0, n = Math.round(seconds * 60); i < n; i++) this.step(1 / 60);
  }
  step(dt: number) {
    const before = this.time;
    this.clock += dt;
    if (this.time < 0) return;
    this.cp.copy(this.queries.controlPoint()); center.setFromMatrixPosition(this.cp);
    this.deltaCp.copy(center).sub(this.previousCp); this.previousCp.copy(center);
    for (const op of this.definition.functions.emitters) {
      const a = op.attributes, start = number(a, "emission_start_time"), end = number(a, "emission_duration");
      if (this.time < start) continue;
      if (a.functionName === "emit_instantaneously") {
        if (!this.bursts.has(op)) { this.bursts.add(op); for (let i = 0; i < Math.min(this.capacity, number(a, "num_to_emit", 1)); i++) this.spawn(); }
      } else {
        const duration = Math.max(0, Math.min(this.time, end > 0 ? start + end : this.time) - Math.max(before, start, 0));
        let amount = (this.emission.get(op) ?? 0) + duration * Math.max(0, number(a, "emission_rate"));
        const n = Math.min(this.capacity, Math.floor(amount)); amount -= Math.floor(amount); this.emission.set(op, amount);
        for (let i = 0; i < n; i++) this.spawn();
      }
    }
    const decay = this.definition.functions.operators.some((op) => ["Lifespan Decay", "Alpha Fade and Decay"].includes(String(op.attributes.functionName)));
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i], age = this.time - p.born, life = age / p.life;
      if (decay && age >= p.life) { this.pool.push(p); this.particles.splice(i, 1); continue; }
      p.alpha = p.initialAlpha; p.radius = p.initialRadius; p.color = p.initialColor.slice();
      for (const op of this.definition.functions.operators) this.operate(op, p, age, life, dt);
      p.alpha = clamp(p.alpha); p.radius = Math.max(0, p.radius);
    }
    // A definition can have several instances (e.g. Silver Serenade's five staff ropes).
    for (const child of this.children) child.step(dt);
  }
  private samples(op: DmxElement, p: Particle): number[] {
    let values = p.samples.get(op);
    if (!values) {
      const a = op.attributes;
      if (a.functionName === "Oscillate Vector") {
        const rate = this.randomVector(a, "oscillation rate min", "oscillation rate max"), freq = this.randomVector(a, "oscillation frequency min", "oscillation frequency max");
        values = [...rate.toArray(), ...freq.toArray()];
      } else if (a.functionName === "Oscillate Scalar") values = [this.range(a, "oscillation rate min", "oscillation rate max"), this.range(a, "oscillation frequency min", "oscillation frequency max")];
      else if (a.functionName === "Alpha Fade In Random") values = [this.range(a, "fade in time min", "fade in time max", 0, "fade in time exponent")];
      else if (a.functionName === "Alpha Fade Out Random") values = [this.range(a, "fade out time min", "fade out time max", 0, "fade out time exponent")];
      else values = [];
      p.samples.set(op, values);
    }
    return values;
  }
  private operate(op: DmxElement, p: Particle, age: number, life: number, dt: number) {
    const a = op.attributes;
    switch (a.functionName) {
      case "Movement Basic": {
        acceleration.fromArray(vector(a, "gravity"));
        for (const force of this.definition.functions.forces) {
          const f = force.attributes;
          if (f.functionName === "twist around axis") {
            center.setFromMatrixPosition(this.cp);
            axis.fromArray(vector(f, "twist axis", [0, 0, 1])).normalize();
            scratch.copy(p.position).sub(center).crossVectors(axis, scratch).normalize();
            acceleration.addScaledVector(scratch, number(f, "amount of force"));
          } else if (f.functionName === "Pull towards control point") {
            // Valve's AttractToControlPoint: a force toward the control point, its strength the distance to a power (0: the same everywhere)
            center.setFromMatrixPosition(this.cp);
            scratch.copy(center).sub(p.position);
            const distance = scratch.length();
            if (distance > 1e-6) acceleration.addScaledVector(scratch, (number(f, "amount of force") * Math.pow(distance, number(f, "falloff power", -2))) / distance);
          }
        }
        // Valve BasicMovement: damp the previous displacement at a 30 Hz reference
        // rate, then add acceleration * dt². Forces themselves are not damped.
        const damping = Math.pow(Math.max(0, 1 - Math.max(0, number(a, "drag"))), dt * 30);
        p.velocity.multiplyScalar(damping).addScaledVector(acceleration, dt);
        p.position.addScaledVector(p.velocity, dt);
        break;
      }
      case "Movement Lock to Control Point": p.position.add(this.deltaCp); break;
      case "Movement Lock to Bone": {
        const bone = this.queries.bone(p.bone);
        if (bone) { scratch.copy(p.boneLocal).applyMatrix4(bone); const strength = 1 - ramp(life, number(a, "lifetime fade start"), number(a, "lifetime fade end", 1)); p.position.addScaledVector(center.copy(scratch).sub(p.previousBone), strength); p.previousBone.copy(scratch); }
        break;
      }
      case "Movement Rotate Particle Around Axis": axis.fromArray(vector(a, "Rotation Axis", [0, 0, 1])).normalize(); center.setFromMatrixPosition(this.cp); p.position.sub(center).applyAxisAngle(axis, number(a, "Rotation Rate") * radians * dt).add(center); break;
      case "Alpha Fade In Random": { const duration = this.samples(op, p)[0] * (a["proportional 0/1"] ? p.life : 1); p.alpha = Math.min(p.alpha, p.initialAlpha * ramp(age, 0, duration)); break; }
      case "Alpha Fade Out Random": { const duration = this.samples(op, p)[0] * (a["proportional 0/1"] ? p.life : 1); let amount = ramp(age, p.life - duration, p.life); if (a["ease in and out"]) amount = smooth(amount); p.alpha = Math.min(p.alpha, p.initialAlpha * (1 - amount)); break; }
      case "Alpha Fade and Decay": {
        const fi = ramp(life, number(a, "start_fade_in_time"), number(a, "end_fade_in_time"));
        const fo = ramp(life, number(a, "start_fade_out_time", 1), number(a, "end_fade_out_time", 1));
        p.alpha = p.initialAlpha * lerp(number(a, "start_alpha"), 1, fi) * lerp(1, number(a, "end_alpha"), fo); break;
      }
      case "Color Fade": { let amount = ramp(life, number(a, "fade_start_time"), number(a, "fade_end_time", 1)); if (a.ease_in_and_out) amount = smooth(amount); const to = vector(a, "color_fade", [255, 255, 255]); p.color = p.initialColor.map((v, i) => lerp(v, to[i] / 255, amount)); break; }
      case "Radius Scale": { let amount = ramp(life, number(a, "start_time"), number(a, "end_time", 1)); if (a.ease_in_and_out) amount = smooth(amount); p.radius = p.initialRadius * lerp(number(a, "radius_start_scale", 1), number(a, "radius_end_scale", 1), amount); break; }
      case "Rotation Spin Roll": p.rotation += number(a, "spin_rate_degrees") * radians * dt; break;
      case "Rotation Basic": p.rotation += p.rotationSpeed * dt; break;
      case "Oscillate Vector": case "Oscillate Scalar": {
        const t = a["proportional 0/1"] ? life : age;
        const limits = a["start/end proportional"] ? life : age;
        if (limits < number(a, "start time min") || limits > number(a, "end time max", 1)) break;
        const s = this.samples(op, p), field = number(a, "oscillation field");
        const phase = number(a, "oscillation start phase", 0.5), mult = number(a, "oscillation multiplier", 2);
        if (a.functionName === "Oscillate Vector") {
          const changes = s.slice(0, 3).map((rate, i) => rate * Math.sin((t * s[i + 3] * mult + phase) * Math.PI) * dt);
          if (field === 0) p.position.add(scratch.fromArray(changes));
          else if (field === 4) p.rotation += changes[0] * radians;
        } else {
          const change = s[0] * sourceOscillationWave(t * s[1] * mult + phase) * dt;
          if (field === 7) p.alpha += change;
          // Oscillate Scalar writes the attribute directly; yaw is already radians.
          else if (field === 12) p.yaw += change;
        }
        break;
      }
    }
  }
  walk(): ParticleSimulation[] { return [this, ...this.children.flatMap((child) => child.walk())]; }
}
