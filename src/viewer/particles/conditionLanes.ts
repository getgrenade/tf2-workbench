import * as THREE from "three";
import type { Actor } from "../actor";
import { particleSystemFile } from "../../api";
import { loadDefinitions } from "./assets";
import { buildDraws } from "./effects";
import { NativeSimulation } from "./native";
import type { ParticleDraw } from "./render";
import type { ParticleRopeDraw } from "./rope";

/** What a lane follows: a character (or its weapon) and where the particles of its system start (control point 0 and the hitboxes they spread over). */
export interface LaneTarget {
  actor: Actor;
  cp: () => THREE.Matrix4;
  boxes: () => number[][];
  /** The burst emitters of the system start again every `every` seconds, the first one `phase` seconds after it is bound (a muzzle flash per shot). */
  burst?: { every: number; phase: number };
  /** Control point 1 (the end of a beam), in the space of control point 0. */
  target?: () => number[];
}

/**
 * One native particle helper for one condition system (peejar_drips, burningplayer_red, ...), built once and lent to a character for as long
 * as it is in the condition. Starting a helper costs far more than a frame (it loads the PCF and starts the engine's particle system), and
 * one per soaked character made a Jarate burst into a crowd stall; a lane is reused instead.
 */
export class ConditionLane {
  readonly group = new THREE.Group();
  target: LaneTarget | null = null;
  private releasing = false;
  private abandoned = false;
  private accumulated = 0;
  private disposed = false;
  private burstClock = 0;

  private constructor(readonly system: string, private readonly sim: NativeSimulation, private readonly draws: (ParticleDraw | ParticleRopeDraw)[]) {
    this.group.matrixAutoUpdate = false;
    this.group.name = `Condition ${system}`;
    this.group.visible = false;
    for (const draw of draws) this.group.add(draw.mesh);
  }

  static async create(system: string, onError: (error: unknown) => void = console.error): Promise<ConditionLane> {
    const file = await particleSystemFile(system);
    const definitions = await loadDefinitions(file);
    const holder: { lane: ConditionLane | null } = { lane: null };
    const sim = await NativeSimulation.create(definitions, () => holder.lane?.target?.cp() ?? new THREE.Matrix4(), onError, file, system, () => holder.lane?.target?.boxes() ?? [], 0, [], [], 1, () => [], () => holder.lane?.target?.target?.() ?? []);
    if (!sim) throw new Error(`The native particle helper is required for ${system}`);
    try {
      const lane = new ConditionLane(system, sim, await buildDraws(sim));
      holder.lane = lane;
      sim.emission(2); // idle until a character is lent
      return lane;
    } catch (error) { sim.dispose(); throw error; }
  }

  get free() { return !this.target; }
  /** No particle is alive (a released lane is free again only then, so a new character never inherits the old one's drips). */
  private get idle() { return [...this.sim.walk()].every((node) => node.particles.length === 0); }

  bind(target: LaneTarget) {
    this.target = target;
    this.releasing = this.abandoned = false;
    this.group.visible = true;
    this.burstClock = target.burst ? target.burst.every - target.burst.phase : 0;
    this.sim.emission(3);
  }

  /** The character left the condition: stop emitting and let what is in the air die out. */
  release() {
    if (!this.target || this.releasing) return;
    this.releasing = true;
    this.sim.emission(2);
  }

  /** The character is gone: no longer attached to it (its group is going away), the rest of the particles die out unseen. */
  abandon() {
    if (!this.target) return;
    this.abandoned = true;
    this.target = { actor: this.target.actor, cp: () => new THREE.Matrix4(), boxes: () => [] };
    this.group.removeFromParent();
    this.release();
  }

  step(dt: number, camera: THREE.Camera) {
    if (this.disposed || !this.target) return;
    if (!this.abandoned) this.target.actor.attachParticles(this.group);
    const burst = this.target.burst;
    if (burst && !this.releasing && !this.abandoned) {
      this.burstClock += Math.min(dt, 0.1);
      while (this.burstClock >= burst.every) { this.burstClock -= burst.every; this.sim.emission(1); }
    }
    this.accumulated += Math.min(dt, 0.1);
    while (this.accumulated >= 1 / 60) { this.sim.step(1 / 60); this.accumulated -= 1 / 60; }
    if (this.releasing && this.idle) {
      this.target = null;
      this.releasing = this.abandoned = false;
      this.group.visible = false;
      this.group.removeFromParent();
      return;
    }
    if (this.abandoned) return;
    this.group.updateWorldMatrix(true, true);
    for (const draw of this.draws) draw.update(camera);
  }

  get needsSceneDepth(): boolean { return !!this.target && !this.abandoned && this.draws.some((draw) => "source" in draw && (draw as ParticleDraw).needsSceneDepth); }
  get needsSceneColor(): boolean { return !!this.target && !this.abandoned && this.draws.some((draw) => "source" in draw && (draw as ParticleDraw).needsSceneColor); }
  setSceneDepth(texture: THREE.Texture | null, camera: THREE.Camera, width: number, height: number, color: THREE.Texture | null = null) {
    for (const draw of this.draws) if ("setSceneDepth" in draw) (draw as ParticleDraw).setSceneDepth(texture, camera, width, height, color);
  }

  dispose() {
    this.disposed = true;
    this.sim.dispose();
    for (const draw of this.draws) draw.dispose();
    this.group.removeFromParent();
  }
}

/** What a character wants running on it: a system, the lane target to start it with, and a key that says when the target changed (another weapon). */
export interface LaneWant {
  system: string;
  /** Tells two wants of the same system apart (one on each arm); the system when absent. */
  id?: string;
  key: string;
  target: () => LaneTarget;
}

/** The lanes of every condition system, and which character has which. */
export class ConditionParticles {
  /** Most helpers per system; a character that finds them all busy goes without particles (its look still changes). */
  static readonly MAX_LANES = 5;
  private readonly lanes = new Map<string, ConditionLane[]>();
  private readonly creating = new Map<string, number>();
  private readonly leases = new Map<Actor, Map<string, { lane: ConditionLane | null; key: string }>>();

  constructor(private readonly make: (system: string) => Promise<ConditionLane> = (system) => ConditionLane.create(system), private readonly onError: (error: unknown) => void = console.error) {}

  get all(): ConditionLane[] { return [...this.lanes.values()].flat(); }
  /** How many characters have particles right now. */
  get busy() { return this.all.filter((lane) => !lane.free).length; }

  private count(system: string) { return (this.lanes.get(system)?.length ?? 0) + (this.creating.get(system) ?? 0); }

  private build(system: string): Promise<ConditionLane> | null {
    if (this.count(system) >= ConditionParticles.MAX_LANES) return null;
    this.creating.set(system, (this.creating.get(system) ?? 0) + 1);
    return this.make(system).then((lane) => {
      this.creating.set(system, (this.creating.get(system) ?? 1) - 1);
      const list = this.lanes.get(system) ?? [];
      list.push(lane);
      this.lanes.set(system, list);
      return lane;
    }, (error) => {
      this.creating.set(system, (this.creating.get(system) ?? 1) - 1);
      throw error;
    });
  }

  /** Builds lanes ahead of the first burst (a throw is no time to start helpers). */
  warm(system: string, count: number) {
    for (let i = 0; i < count; i++) this.build(system)?.catch(this.onError);
  }

  /** Makes the character's particles what it `wants`: starts the ones it lacks, releases the ones it no longer is in. */
  sync(actor: Actor, wants: LaneWant[]) {
    let leases = this.leases.get(actor);
    if (!leases) this.leases.set(actor, (leases = new Map()));
    const mine = leases;
    const wanted = new Map(wants.map((w) => [w.id ?? w.system, w]));
    for (const [id, lease] of [...mine]) {
      if (wanted.get(id)?.key === lease.key) continue;
      mine.delete(id);
      lease.lane?.release();
    }
    for (const want of wants) {
      const id = want.id ?? want.system;
      if (mine.has(id)) continue;
      const lane = this.lanes.get(want.system)?.find((l) => l.free);
      if (lane) { lane.bind(want.target()); mine.set(id, { lane, key: want.key }); continue; }
      const pending = this.build(want.system);
      if (!pending) continue; // every lane of the system is busy
      const lease = { lane: null as ConditionLane | null, key: want.key };
      mine.set(id, lease);
      pending.then((made) => {
        if (this.leases.get(actor)?.get(id) === lease) { lease.lane = made; made.bind(want.target()); }
      }).catch((error) => {
        if (this.leases.get(actor)?.get(id) === lease) mine.delete(id);
        this.onError(error);
      });
    }
  }

  /** The character is leaving the scene. */
  forget(actor: Actor) {
    for (const lease of this.leases.get(actor)?.values() ?? []) lease.lane?.abandon();
    this.leases.delete(actor);
  }

  step(dt: number, camera: THREE.Camera) {
    for (const lane of this.all) lane.step(dt, camera);
  }

  dispose() {
    for (const lane of this.all) lane.dispose();
    this.lanes.clear();
    this.leases.clear();
  }
}
