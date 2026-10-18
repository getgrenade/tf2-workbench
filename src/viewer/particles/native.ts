import * as THREE from "three";
import { resetNativeParticles, startNativeParticles, stepNativeParticles, stopNativeParticles, type NativeParticleNode } from "../../api";
import type { ParticleDefinition } from "./pcf";
import type { ParticleRenderSource, RenderParticle } from "./simulation";

let documentGeneration: Promise<number> | null = null;

/** Source MatrixVectors: X = forward, -Y = right, Z = up. */
export function nativeControlPoint(matrix: THREE.Matrix4): number[] {
  const e = matrix.elements;
  // Actor placement is handled by the effect group. These are Source model-space coordinates.
  return [e[0], e[1], e[2], -e[4], -e[5], -e[6], e[8], e[9], e[10], e[12], e[13], e[14]];
}

/** One collection of a binary step frame (see decodeNativeFrame): its clock and its particles as 17 float32 each. */
export interface NativeBinaryNode { time: number; dt: number; count: number; floats: Float32Array }

/**
 * The binary frame of a step: u32 node count, then for each collection f64 time, f64 dt, u32 particle count and the particles (17 float32
 * each: x y z r g b alpha radius roll born life sequence yaw prevx prevy prevz trail). The nodes are in the order of the first frame.
 */
export function decodeNativeFrame(buffer: ArrayBuffer): NativeBinaryNode[] {
  const view = new DataView(buffer), nodes: NativeBinaryNode[] = [];
  const count = view.getUint32(0, true);
  let at = 4;
  for (let i = 0; i < count; i++) {
    const particles = view.getUint32(at + 16, true);
    const floats = new Float32Array(buffer, at + 20, particles * 17);
    nodes.push({ time: view.getFloat64(at, true), dt: view.getFloat64(at + 8, true), count: particles, floats });
    at += 20 + particles * 68;
  }
  if (at !== buffer.byteLength) throw new Error("Invalid native particle frame");
  return nodes;
}

export class NativeRenderNode implements ParticleRenderSource {
  readonly particles: RenderParticle[] = [];
  time = 0;
  stepTime = 1 / 60;
  /** See ParticleRenderSource.lead: set by whoever drives the simulation, every frame. */
  lead = 0;
  constructor(readonly definition: ParticleDefinition, readonly capacity: number) {}
  apply(frame: NativeParticleNode) {
    this.time = frame.time;
    if (frame.dt && frame.dt > 0) this.stepTime = frame.dt;
    this.resize(frame.particles.length);
    for (let i = 0; i < frame.particles.length; ++i) this.write(this.particles[i], frame.particles[i], 0);
  }
  /** The particles of a binary frame (the same numbers, straight from the helper's bytes). */
  applyBinary(frame: NativeBinaryNode) {
    this.time = frame.time;
    if (frame.dt > 0) this.stepTime = frame.dt;
    this.resize(frame.count);
    for (let i = 0; i < frame.count; ++i) this.write(this.particles[i], frame.floats, i * 17);
  }
  private resize(count: number) {
    while (this.particles.length < count) this.particles.push({
      position: new THREE.Vector3(), color: [1, 1, 1], born: 0, life: 1, alpha: 0,
      radius: 0, rotation: 0, yaw: 0, sequence: 0,
    });
    this.particles.length = count;
  }
  private write(p: RenderParticle, a: ArrayLike<number>, o: number) {
    p.position.set(a[o], a[o + 1], a[o + 2]);
    p.color[0] = a[o + 3]; p.color[1] = a[o + 4]; p.color[2] = a[o + 5];
    p.alpha = a[o + 6]; p.radius = a[o + 7]; p.rotation = a[o + 8]; p.born = a[o + 9];
    p.life = a[o + 10]; p.sequence = a[o + 11]; p.yaw = a[o + 12];
    if (a.length >= o + 17) {
      (p.previous ??= new THREE.Vector3()).set(a[o + 13], a[o + 14], a[o + 15]);
      p.trailLength = a[o + 16];
    }
  }
}

/** No JS emission or operators run for this backend. The helper owns all particle state. */
export class NativeSimulation {
  private disposed = false;
  private inFlight = false;
  private ticks = 0;
  private appliedTicks = 0;
  /** Seconds of simulation the state we have describes (every tick is 1/60). */
  get simClock(): number { return this.appliedTicks / 60; }
  private readonly commands: number[] = [];
  private failed = false;
  private constructor(private readonly handle: number, private readonly nodes: NativeRenderNode[],
    private readonly cp: () => THREE.Matrix4, private readonly boxes: () => number[][],
    private readonly onError: (error: unknown) => void, private readonly flame: number[], private readonly colors: number[], private readonly instances: () => number[][],private readonly target:()=>number[],
    private readonly floor: () => number | null) {}

  static async create(definitions: Map<string, ParticleDefinition>, cp: () => THREE.Matrix4,
    onError: (error: unknown) => void, file = "particles/smissmas2022_unusuals.pcf", system = "unusual_sheetmusic_silver_parent",
    boxes: () => number[][] = () => [], refire = 0, flame: number[] = [], colors: number[] = [], slots = 1, instances: () => number[][] = () => [],target:()=>number[]=()=>[],
    /** The height of the floor in the space of the control points: what the world traces of the effect (Collision via traces) hit. */
    floor: () => number | null = () => null,
    /** The random seed of the collections: the same seed, control points and ticks give the same particles every time. */
    seed = 273): Promise<NativeSimulation | null> {
    // A webview reload has no reliable async unload callback. Reap its helpers before starting new ones.
    documentGeneration ??= resetNativeParticles().catch((error) => { documentGeneration = null; throw error; });
    const generation = await documentGeneration;
    const start = await startNativeParticles(nativeControlPoint(cp()), generation, file, system, boxes(), refire, slots, seed);
    if (!start) return null;
    try {
      const nodes = start.nodes.map((frame) => {
        const definition = definitions.get(frame.name);
        if (!definition) throw new Error(`Native particle system missing from PCF: ${frame.name}`);
        const node = new NativeRenderNode(definition, frame.capacity); node.apply(frame); return node;
      });
      return new NativeSimulation(start.handle, nodes, cp, boxes, onError, flame, colors, instances,target,floor);
    } catch (error) { await stopNativeParticles(start.handle); throw error; }
  }

  *walk() { yield* this.nodes; }
  /** Restart burst emitters without allocating another helper; stopping leaves existing particles alive. */
  emission(action: 1 | 2 | 3) { this.commands.push(action); this.step(0); }
  step(dt: number) {
    if (this.disposed || this.failed) return;
    this.ticks = Math.min(6, this.ticks + Math.round(dt * 60));
    if (this.inFlight || (!this.ticks && !this.commands.length)) return;
    const action = this.commands.shift() ?? 0;
    const ticks = this.ticks; this.ticks = 0; this.inFlight = true;
    void stepNativeParticles(this.handle, ticks, nativeControlPoint(this.cp()), this.boxes(), action, this.flame, this.colors, this.instances(),this.target(),this.floor()).then((buffer) => {
      if (this.disposed) return;
      const frames = decodeNativeFrame(buffer);
      if (frames.length !== this.nodes.length) throw new Error("Native particle graph changed unexpectedly");
      for (let i = 0; i < frames.length; ++i) this.nodes[i].applyBinary(frames[i]);
      this.appliedTicks += ticks;
    }).catch((error) => {
      if (this.disposed) return;
      this.failed = true;
      for (const node of this.nodes) node.particles.length = 0;
      this.onError(error);
      void stopNativeParticles(this.handle).catch(console.error);
    }).finally(() => { this.inFlight = false; if (this.commands.length || this.ticks) this.step(0); }); // the ticks that came while it ran go at once
  }
  /** Runs the simulation `seconds` ahead, in the helper's own steps, and waits for it (a picture taken at a set moment of the effect). */
  async advance(seconds: number): Promise<void> {
    let ticks = Math.round(seconds * 60);
    while (ticks > 0 && !this.disposed && !this.failed) {
      while (this.inFlight) await new Promise((r) => setTimeout(r, 4));
      const n = Math.min(6, ticks);
      ticks -= n;
      this.inFlight = true;
      try {
        const frames = decodeNativeFrame(await stepNativeParticles(this.handle, n, nativeControlPoint(this.cp()), this.boxes(), 0, this.flame, this.colors, this.instances(), this.target(), this.floor()));
        if (this.disposed) return;
        if (frames.length !== this.nodes.length) throw new Error("Native particle graph changed unexpectedly");
        for (let i = 0; i < frames.length; ++i) this.nodes[i].applyBinary(frames[i]);
        this.appliedTicks += n;
      } catch (error) {
        if (this.disposed) return;
        this.failed = true;
        for (const node of this.nodes) node.particles.length = 0;
        this.onError(error);
        void stopNativeParticles(this.handle).catch(console.error);
      } finally {
        this.inFlight = false;
      }
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    void stopNativeParticles(this.handle).catch(console.error);
  }
}
