import { Attrs, type Vec3 } from "./attrs";
import { UniformRandomStream } from "./random";
import type { DmxElement } from "../pcf";

/**
 * A port of Valve's particle collection (CParticleCollection, particles.cpp): one running particle system and its children. A collection owns
 * its particles (an array per attribute), its 64 control points, and the functions of its definition (emitters, initializers, operators,
 * forces, constraints); `simulate` runs one step the way the engine does: advance the clock, emit, initialize the new particles, run the
 * operators, remove the particles that were killed, then the children.
 */

export const MAX_CONTROL_POINTS = 64;
export const MAX_PARTICLES = 5000;

export interface ControlPoint {
  pos: Vec3; prev: Vec3;
  forward: Vec3; right: Vec3; up: Vec3;
  velocity: Vec3;
  radius: number; density: number; duration: number;
  /** The control point of a hitbox source (the character): the query answers about its hitboxes. */
  object: boolean;
  parent: number;
}

const newControlPoint = (): ControlPoint => ({
  pos: [0, 0, 0], prev: [0, 0, 0], forward: [1, 0, 0], right: [0, -1, 0], up: [0, 0, 1], velocity: [0, 0, 0],
  radius: 0, density: 1, duration: 0, object: false, parent: 0,
});

export interface HitBox { mins: Vec3; maxs: Vec3; /** 3x4 row-major */ transform: number[] }

/** What the particle system asks of the world around it (the game's IParticleSystemQuery): the hitboxes of the character, the floor. */
export interface World {
  boxes: HitBox[];
  floor: number | null;
}

export interface Fade { startIn: number; endIn: number; startOut: number; endOut: number; oscillate: number }

/** One function of a definition, made for a collection: it keeps its own state. Every hook is optional. */
export interface Fn {
  readonly attrs: Attrs;
  readonly fade: Fade;
  /** How much the function acts at a time: 0..1, or -1 when it does not run (before its fade in, after its fade out). */
  strength(time: number): number;
  /** Emitters: how many particles to create now. */
  emit?(c: Collection, strength: number): number;
  /** Emitters: the time the particles of a burst are born at, when it is not the current time. */
  creationTime?(c: Collection): number;
  start?(c: Collection): void;
  stop?(c: Collection): void;
  restart?(c: Collection): void;
  /** Whether the emitter may still make particles (a system is finished when it has none and nothing will). */
  mayCreateMore?(c: Collection): boolean;
  /** Initializers: set the attributes of particles [first, first + n). */
  initialize?(c: Collection, first: number, n: number): void;
  operate?(c: Collection, strength: number): void;
  /** Forces: add to the acceleration (xyz per particle) of every active particle. */
  force?(c: Collection, accel: Float32Array, strength: number): void;
  constrain?(c: Collection): boolean;
  /** A constraint that runs once after all the others. */
  final?: boolean;
  /** Called every step before the constraints run (traces, per-frame data). */
  prepare?(c: Collection): void;
}

export type FnKind = "emitters" | "initializers" | "operators" | "forces" | "constraints" | "renderers";
export type FnFactory = (attrs: Attrs, def: SystemDef) => Fn | null;

const registry = new Map<string, FnFactory>();
const normalise = (name: string) => name.toLowerCase().replace(/[\s_]+/g, " ").trim();
export function register(names: string | string[], factory: FnFactory) {
  for (const n of Array.isArray(names) ? names : [names]) registry.set(normalise(n), factory);
}
export const unknownFunctions = new Set<string>();

/** What the simulation needs to know of a system: its constants and its functions. */
export class SystemDef {
  readonly name: string;
  readonly maxParticles: number;
  readonly initialParticles: number;
  readonly radius: number;
  readonly color: [number, number, number, number];
  readonly rotation: number;
  readonly rotationSpeed: number;
  readonly sequence: number;
  readonly sequence1: number;
  readonly groupId: number;
  readonly maxTimeStep: number;
  readonly hasRenderers: boolean;
  readonly children: { def: SystemDef; delay: number; endCap: boolean }[] = [];
  private readonly sources: Record<"emitters" | "initializers" | "operators" | "forces" | "constraints", Attrs[]>;

  constructor(readonly element: DmxElement, graph: DmxElement[], definitions: Map<DmxElement, SystemDef>) {
    definitions.set(element, this);
    const a = new Attrs(element);
    this.name = element.name;
    this.maxParticles = Math.max(1, Math.min(MAX_PARTICLES, a.int("max_particles", 1000)));
    this.initialParticles = Math.max(0, a.int("initial_particles", 0));
    this.radius = a.num("radius", 5);
    this.color = a.color("color", [255, 255, 255, 255]);
    this.rotation = a.num("rotation", 0);
    this.rotationSpeed = a.num("rotation_speed", 0);
    this.sequence = a.num("sequence_number", 0);
    this.sequence1 = a.num("sequence_number 1", 0);
    this.groupId = a.int("group id", 0);
    this.maxTimeStep = a.num("maximum time step", 0.1) || 0.1;
    const refs = (key: string): DmxElement[] => {
      const v = element.attributes[key];
      const list = Array.isArray(v) ? v : [v];
      return list.flatMap((r) => (r && typeof r === "object" && !Array.isArray(r) && "element" in r ? [graph[r.element]] : [])).filter(Boolean);
    };
    this.sources = {
      emitters: refs("emitters").map((e) => new Attrs(e)), initializers: refs("initializers").map((e) => new Attrs(e)),
      operators: refs("operators").map((e) => new Attrs(e)), forces: refs("forces").map((e) => new Attrs(e)),
      constraints: refs("constraints").map((e) => new Attrs(e)),
    };
    this.hasRenderers = refs("renderers").length > 0;
    for (const childLink of refs("children")) {
      const ref = childLink.attributes.child;
      if (!ref || typeof ref !== "object" || Array.isArray(ref) || !("element" in ref)) continue;
      const target = graph[ref.element];
      if (!target) continue;
      const def = definitions.get(target) ?? new SystemDef(target, graph, definitions);
      this.children.push({ def, delay: Number(childLink.attributes.delay ?? 0), endCap: childLink.attributes["end cap effect"] === true });
    }
  }

  /** The functions of this definition, made for one collection. */
  make(kind: keyof SystemDef["sources"]): Fn[] {
    const out: Fn[] = [];
    for (const attrs of this.sources[kind]) {
      const name = normalise(attrs.functionName);
      const factory = registry.get(name);
      if (!factory) { unknownFunctions.add(`${kind}/${attrs.functionName}`); continue; }
      const fn = factory(attrs, this);
      if (fn) out.push(fn);
    }
    return out;
  }
}

export function fadeOf(a: Attrs): Fade {
  return { startIn: a.num("operator start fadein"), endIn: a.num("operator end fadein"), startOut: a.num("operator start fadeout"), endOut: a.num("operator end fadeout"), oscillate: a.num("operator fade oscillate") };
}

/** CheckIfOperatorShouldRun: a function may begin late, fade in, fade out and end; -1 is "does not run". */
export function strengthAt(f: Fade, t: number): number {
  if (t < f.startIn) return -1;
  if (f.endOut > 0 && t > f.endOut) return -1;
  let s: number;
  if (t >= f.endIn) {
    if (f.startOut === 0 || t <= f.startOut) s = 1;
    else s = 1 - (t - f.startOut) / (f.endOut - f.startOut);
  } else s = (t - f.startIn) / (f.endIn - f.startIn);
  if (f.oscillate > 0) s *= 0.5 + 0.5 * Math.sin((2 * Math.PI * t) / f.oscillate);
  return Math.max(0, Math.min(1, s));
}

/** A function from its parameters and what it does. */
export function fn(attrs: Attrs, hooks: Partial<Omit<Fn, "attrs" | "fade" | "strength">>): Fn {
  const fade = fadeOf(attrs);
  return { attrs, fade, strength: (t) => strengthAt(fade, t), ...hooks };
}

/** Per particle attributes: name, components. */
const LAYOUT = {
  xyz: 3, prev: 3, life: 1, radius: 1, rotation: 1, rotSpeed: 1, rgb: 3, alpha: 1, creation: 1, seq: 1, trail: 1, id: 1, yaw: 1, seq1: 1,
  hitbox: 1, hitRel: 3, alpha2: 1, traceP0: 3, traceP1: 3, traceHit: 1, traceNormal: 3, cpIndex: 1,
} as const;
type AttrName = keyof typeof LAYOUT;
/** The attributes whose value at birth operators may ask for. */
const INITIAL: AttrName[] = ["xyz", "life", "radius", "rotation", "rotSpeed", "rgb", "alpha", "creation", "seq", "trail", "yaw", "alpha2"];

export class Collection {
  readonly def: SystemDef;
  readonly parent: Collection | null;
  readonly children: Collection[] = [];
  readonly delay: number;
  /** The clock's value at the first moment (negative for a child that starts late). */
  readonly startTime: number;
  readonly capacity: number;
  readonly cps: ControlPoint[] = Array.from({ length: MAX_CONTROL_POINTS }, newControlPoint);
  highestCP = 0;
  time = 0;
  dt = 0;
  prevDt = 0;
  n = 0;
  readonly rng: UniformRandomStream;
  readonly world: World;
  readonly seed: number;
  uniqueId = 0;
  emissionStopped = false;
  /** The control point that was just set for the particles about to be made (SetControlPointIndex: the flame manager sets one per new point). */
  targetCP = 0;
  /** The number of frames of a sequence of the sprite sheet of the system's material (Lifetime From Sequence asks), when it has a sheet. */
  sheet: ((sequence: number) => number) | null = null;
  private firstStep = true;

  readonly xyz!: Float32Array; readonly prev!: Float32Array; readonly life!: Float32Array; readonly radius!: Float32Array;
  readonly rotation!: Float32Array; readonly rotSpeed!: Float32Array; readonly rgb!: Float32Array; readonly alpha!: Float32Array;
  readonly creation!: Float32Array; readonly seq!: Float32Array; readonly trail!: Float32Array; readonly id!: Float32Array;
  readonly yaw!: Float32Array; readonly seq1!: Float32Array; readonly hitbox!: Float32Array; readonly hitRel!: Float32Array;
  readonly alpha2!: Float32Array; readonly traceP0!: Float32Array; readonly traceP1!: Float32Array; readonly traceHit!: Float32Array;
  readonly traceNormal!: Float32Array; readonly cpIndex!: Float32Array;
  readonly initial = {} as Record<AttrName, Float32Array>;
  private readonly all: [Float32Array, number][] = [];

  readonly emitters: Fn[]; readonly initializers: Fn[]; readonly operators: Fn[]; readonly forces: Fn[]; readonly constraints: Fn[];
  private readonly killList: number[] = [];
  private readonly accel: Float32Array;
  /** Operators that write to the particles' initial values after the fact (Remap with "output is scalar of initial random range") need them. */

  constructor(def: SystemDef, delay: number, seed: number, world: World, parent: Collection | null = null) {
    this.def = def; this.parent = parent; this.delay = delay; this.seed = seed; this.world = world;
    // a child's clock starts before zero by its delay (and by its parent's): it only runs once the parent has run that long
    this.startTime = (parent?.startTime ?? 0) - delay;
    this.capacity = def.maxParticles;
    this.rng = new UniformRandomStream(seed);
    for (const name of Object.keys(LAYOUT) as AttrName[]) {
      const array = new Float32Array(this.capacity * LAYOUT[name]);
      (this as unknown as Record<string, Float32Array>)[name] = array;
      this.all.push([array, LAYOUT[name]]);
    }
    for (const name of INITIAL) {
      const array = new Float32Array(this.capacity * LAYOUT[name]);
      this.initial[name] = array;
      this.all.push([array, LAYOUT[name]]);
    }
    this.accel = new Float32Array(this.capacity * 3);
    this.emitters = def.make("emitters"); this.initializers = def.make("initializers"); this.operators = def.make("operators");
    this.forces = def.make("forces"); this.constraints = def.make("constraints");
    for (const child of def.children) this.children.push(new Collection(child.def, child.delay, seed, world, this));
    this.restartState(true);
  }

  // --- random numbers (the collection's own stream) ---
  rand(low = 0, high = 1): number { return this.rng.float(low, high); }
  randExp(low: number, high: number, exponent: number): number { return this.rng.floatExp(low, high, exponent); }
  randInt(low: number, high: number): number { return this.rng.int(low, high); }
  randVec(min: Vec3, max: Vec3, out: Vec3 = [0, 0, 0]): Vec3 {
    out[0] = this.rng.float(min[0], max[0]); out[1] = this.rng.float(min[1], max[1]); out[2] = this.rng.float(min[2], max[2]);
    return out;
  }
  /** A random point of the unit ball (rejection sampling, as the engine does); returns its squared length. */
  randInUnitSphere(out: Vec3): number {
    let l: number;
    do {
      out[0] = this.rng.float(-1, 1); out[1] = this.rng.float(-1, 1); out[2] = this.rng.float(-1, 1);
      l = out[0] * out[0] + out[1] * out[1] + out[2] * out[2];
    } while (l > 1);
    return l;
  }

  // --- control points; a setter reaches the children too, as in the engine ---
  setCP(i: number, v: Vec3) { this.highestCP = Math.max(this.highestCP, i); const cp = this.cps[i]; cp.pos[0] = v[0]; cp.pos[1] = v[1]; cp.pos[2] = v[2]; for (const c of this.children) c.setCP(i, v); }
  setCPOrientation(i: number, forward: Vec3, right: Vec3, up: Vec3) {
    const cp = this.cps[i];
    cp.forward = [forward[0], forward[1], forward[2]]; cp.right = [right[0], right[1], right[2]]; cp.up = [up[0], up[1], up[2]];
    for (const c of this.children) c.setCPOrientation(i, forward, right, up);
  }
  setCPVelocity(i: number, v: Vec3) { this.cps[i].velocity = [v[0], v[1], v[2]]; for (const c of this.children) c.setCPVelocity(i, v); }
  setCPRadius(i: number, r: number) { this.cps[i].radius = r; for (const c of this.children) c.setCPRadius(i, r); }
  setCPDensity(i: number, d: number) { this.cps[i].density = d; for (const c of this.children) c.setCPDensity(i, d); }
  setCPDuration(i: number, d: number) { this.cps[i].duration = d; for (const c of this.children) c.setCPDuration(i, d); }
  setCPParent(i: number, p: number) { this.cps[i].parent = p; for (const c of this.children) c.setCPParent(i, p); }
  setCPObject(i: number, on: boolean) { this.cps[i].object = on; for (const c of this.children) c.setCPObject(i, on); }
  /** The control point's place at the current time (the part of the engine's hierarchy that matters: the parent's frame carries it). */
  cpPos(i: number): Vec3 { return this.cps[i].pos; }
  /** A point given in the frame of a control point, in world space: origin + x * forward + z * up - y * right. */
  cpTransform(i: number, p: Vec3, out: Vec3 = [0, 0, 0]): Vec3 {
    const cp = this.cps[i];
    out[0] = cp.pos[0] + p[0] * cp.forward[0] + p[2] * cp.up[0] - p[1] * cp.right[0];
    out[1] = cp.pos[1] + p[0] * cp.forward[1] + p[2] * cp.up[1] - p[1] * cp.right[1];
    out[2] = cp.pos[2] + p[0] * cp.forward[2] + p[2] * cp.up[2] - p[1] * cp.right[2];
    return out;
  }
  /** A direction given in the frame of a control point, in world space. */
  cpRotate(i: number, p: Vec3, out: Vec3 = [0, 0, 0]): Vec3 {
    const cp = this.cps[i];
    out[0] = p[0] * cp.forward[0] + p[2] * cp.up[0] - p[1] * cp.right[0];
    out[1] = p[0] * cp.forward[1] + p[2] * cp.up[1] - p[1] * cp.right[1];
    out[2] = p[0] * cp.forward[2] + p[2] * cp.up[2] - p[1] * cp.right[2];
    return out;
  }
  /** A world direction in the frame of a control point. */
  cpUnrotate(i: number, p: Vec3, out: Vec3 = [0, 0, 0]): Vec3 {
    const cp = this.cps[i];
    out[0] = p[0] * cp.forward[0] + p[1] * cp.forward[1] + p[2] * cp.forward[2];
    out[1] = -(p[0] * cp.right[0] + p[1] * cp.right[1] + p[2] * cp.right[2]);
    out[2] = p[0] * cp.up[0] + p[1] * cp.up[1] + p[2] * cp.up[2];
    return out;
  }

  /** Whether the CP has moved since the last step (the engine's HasMoved looks at control point 0 and the ones read). */
  cpMoved(i: number): boolean { const cp = this.cps[i]; return cp.pos[0] !== cp.prev[0] || cp.pos[1] !== cp.prev[1] || cp.pos[2] !== cp.prev[2]; }

  // --- the particles ---
  get age() { return this.time; }
  ageOf(i: number): number { return this.time - this.creation[i]; }
  killParticle(i: number) { this.killList.push(i); }

  /** Moves particle `from` onto `to` (every attribute). */
  private copyParticle(from: number, to: number) {
    for (const [array, size] of this.all) for (let k = 0; k < size; k++) array[to * size + k] = array[from * size + k];
  }

  private applyKillList() {
    if (!this.killList.length) return;
    this.killList.sort((a, b) => b - a);
    let last = -1;
    for (const i of this.killList) {
      if (i === last || i >= this.n) continue;
      last = i;
      this.n--;
      if (i !== this.n) this.copyParticle(this.n, i);
    }
    this.killList.length = 0;
  }

  /** Fills the new particles [first, first + count) with the system's constants, then lets the initializers set them. */
  private initializeNew(first: number, count: number, born: [number, number, number][]) {
    const d = this.def;
    for (let i = first; i < first + count; i++) {
      this.xyz[i * 3] = this.xyz[i * 3 + 1] = this.xyz[i * 3 + 2] = 0;
      this.life[i] = 1;
      this.radius[i] = d.radius;
      this.rotation[i] = (d.rotation * Math.PI) / 180;
      this.rotSpeed[i] = (d.rotationSpeed * Math.PI) / 180;
      this.rgb[i * 3] = d.color[0] / 255; this.rgb[i * 3 + 1] = d.color[1] / 255; this.rgb[i * 3 + 2] = d.color[2] / 255;
      this.alpha[i] = d.color[3] / 255;
      this.creation[i] = this.time;
      this.seq[i] = d.sequence; this.seq1[i] = d.sequence1;
      this.trail[i] = 0.1;
      this.id[i] = this.uniqueId++;
      this.yaw[i] = 0;
      this.hitbox[i] = -1; this.hitRel[i * 3] = this.hitRel[i * 3 + 1] = this.hitRel[i * 3 + 2] = 0;
      this.alpha2[i] = 1;
      this.cpIndex[i] = 0;
    }
    for (const [from, n, time] of born) for (let i = from; i < from + n; i++) this.creation[i] = time;
    const now = this.time;
    for (const fn of this.initializers) {
      if (!fn.initialize) continue;
      if (fn.strength(now) < 0) continue;
      fn.initialize(this, first, count);
    }
    for (let i = first; i < first + count; i++) {
      for (let k = 0; k < 3; k++) this.prev[i * 3 + k] = this.xyz[i * 3 + k];
      for (const name of INITIAL) { const size = LAYOUT[name]; for (let k = 0; k < size; k++) this.initial[name][i * size + k] = (this[name] as Float32Array)[i * size + k]; }
    }
  }

  /** Brings the collection back to its first moment: no particles, the clock at zero, the emitters ready. */
  private restartState(initial = false) {
    this.n = 0; this.time = this.startTime; this.dt = 0; this.prevDt = 0; this.uniqueId = 0; this.firstStep = true; this.emissionStopped = false;
    this.killList.length = 0;
    if (!initial) this.rng.setSeed(this.seed);
    for (const fn of [...this.emitters, ...this.initializers, ...this.operators, ...this.forces, ...this.constraints]) fn.restart?.(this);
  }

  restart() { this.restartState(); for (const c of this.children) c.restart(); }
  startEmission() { this.emissionStopped = false; for (const fn of this.emitters) fn.start?.(this); for (const c of this.children) c.startEmission(); }
  stopEmission(removeAll = false) {
    this.emissionStopped = true;
    for (const fn of this.emitters) fn.stop?.(this);
    if (removeAll) this.n = 0;
    for (const c of this.children) c.stopEmission(removeAll);
  }

  // --- one step ---
  simulate(dt: number) {
    if (dt <= 0) return;
    // a long step is made in steps of at most the definition's maximum
    let remaining = dt;
    while (remaining > 1e-9) {
      const step = Math.min(remaining, this.def.maxTimeStep);
      this.step(step);
      remaining -= step;
    }
  }

  private step(dt: number) {
    // a child that has not started yet only lets its clock run (its own children wait too)
    if (this.time + dt <= 0 && this.startTime < 0) { this.time += dt; this.dt = 0; return; }
    this.dt = dt;
    this.time += dt;
    // emit
    const before = this.n;
    const born: [number, number, number][] = [];
    let cursor = this.n;
    const add = (n: number, time: number) => {
      n = Math.max(0, Math.min(n, this.capacity - cursor));
      if (n > 0) { born.push([cursor, n, time]); cursor += n; }
    };
    if (this.firstStep) { add(this.def.initialParticles, this.time); this.firstStep = false; }
    for (const fn of this.emitters) {
      if (!fn.emit) continue;
      const s = fn.strength(this.time);
      if (s < 0) continue;
      add(fn.emit(this, s), fn.creationTime ? fn.creationTime(this) : this.time);
    }
    if (cursor > before) { this.n = cursor; this.initializeNew(before, cursor - before, born); }
    // forces are accumulated for the movement operator
    this.accel.fill(0, 0, this.n * 3);
    for (const fn of this.forces) {
      if (!fn.force) continue;
      const s = fn.strength(this.time);
      if (s < 0) continue;
      fn.force(this, this.accel, s);
    }
    for (const fn of this.constraints) fn.prepare?.(this);
    for (const fn of this.operators) {
      if (!fn.operate) continue;
      const s = fn.strength(this.time);
      if (s < 0) continue;
      fn.operate(this, s);
    }
    this.applyKillList();
    // the control points of this step become the previous ones
    for (let i = 0; i <= this.highestCP; i++) { const cp = this.cps[i]; cp.prev[0] = cp.pos[0]; cp.prev[1] = cp.pos[1]; cp.prev[2] = cp.pos[2]; }
    this.prevDt = dt;
    for (const child of this.children) child.simulate(dt);
  }

  /** The accumulated force on each particle this step (xyz per particle), for the movement operator. */
  get forceField(): Float32Array { return this.accel; }
  /** The constraints, run by the movement operator after it moved the particles. */
  runConstraints(passes: number) {
    if (!this.constraints.length) return;
    for (let pass = 0; pass < passes; pass++) {
      let any = false;
      for (const fn of this.constraints) {
        if (!fn.constrain || fn.final) continue;
        const s = fn.strength(this.time);
        if (s < 0) continue;
        any = fn.constrain(this) || any;
      }
      if (!any) break;
    }
    for (const fn of this.constraints) if (fn.constrain && fn.final && fn.strength(this.time) >= 0) fn.constrain(this);
  }

  /** Every collection of the tree, parent first, children in order (the order of the frames). */
  *walk(): Generator<Collection> {
    yield this;
    for (const c of this.children) yield* c.walk();
  }
}

