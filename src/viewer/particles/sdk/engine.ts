import { parsePcf, type DmxElement } from "../pcf";
import { parseSheet } from "../sheet";
import { Collection, SystemDef, type HitBox, type World } from "./collection";
import { UniformRandomStream } from "./random";
import type { Vec3 } from "./attrs";
import "./emitters";
import "./initializers";
import "./operators";
import "./forces";
import "./constraints";
import "./paths";

export { unknownFunctions } from "./collection";

/**
 * Valve's particle simulation, in the page. This is what the native helper does on the desktop (native/particle-probe), with the same inputs
 * and the same answers: `start` makes the system, `step` runs ticks of 1/60 s with the control point, hitboxes and the other things the
 * game gives an effect, and answers with the particles of every collection as one binary frame. The web build serves the viewer's
 * `native_particle_*` commands from here.
 */

export interface NativeNode { id: number; name: string; capacity: number; time: number; dt: number; particles: number[][] }

export interface EngineLoader {
  /** The bytes of a file the particle effects use (a PCF, a material's text, a texture). */
  load(path: string): Promise<ArrayBuffer>;
}

/** The gameplay side of the flamethrower (CTFFlameManager): points in the world that the flame's particles follow. */
class FlameManager {
  private readonly points = Array.from({ length: 30 }, () => ({ position: [0, 0, 0] as Vec3, velocity: [0, 0, 0] as Vec3, attacker: [0, 0, 0] as Vec3, age: 0, life: 0, alive: false }));
  private readonly random = new UniformRandomStream(273);
  firing = false;
  positioned = false;
  private next = 0;
  private emission = 0;
  previous: Vec3 = [0, 0, 0];

  command(action: number) {
    if (action === 2) this.firing = false;
    if (action === 1 || action === 3) { this.firing = true; this.emission = 0; this.next = 0; for (const p of this.points) p.alive = false; }
  }

  step(effect: Collection, cp: number[], config: number[], dt: number, attacker: Vec3) {
    const origin: Vec3 = [cp[9], cp[10], cp[11]], forward: Vec3 = [cp[0], cp[1], cp[2]], right: Vec3 = [cp[3], cp[4], cp[5]], up: Vec3 = [cp[6], cp[7], cp[8]];
    if (this.firing) {
      this.emission -= dt;
      if (this.emission <= 0) {
        this.emission += 0.02;
        const p = this.points[this.next];
        p.alive = true; p.age = 0; p.position = [origin[0], origin[1], origin[2]]; p.attacker = [attacker[0], attacker[1], attacker[2]];
        let x: number, y: number;
        do {
          x = (this.random.float(-1, 1) + this.random.float(-1, 1)) * 0.5;
          y = (this.random.float(-1, 1) + this.random.float(-1, 1)) * 0.5;
        } while (x * x + y * y > 1);
        const spread = (config[6] * Math.PI) / 180;
        p.velocity = [0, 1, 2].map((k) => (forward[k] + spread * (x * right[k] + y * up[k])) * config[0]) as Vec3;
        p.life = Math.max(0.01, config[1] + this.random.float(-config[2], config[2]));
        effect.targetCP = this.next + 1;
        for (const child of effect.walk()) child.targetCP = this.next + 1;
        this.next = (this.next + 1) % 30;
      }
    }
    effect.setCPRadius(0, 3); effect.setCPDensity(0, 1);
    const newest = this.points[(this.next + 29) % 30];
    effect.setCPVelocity(0, this.firing ? [newest.velocity[0] + attacker[0], newest.velocity[1] + attacker[1], newest.velocity[2] + attacker[2]] : [0, 0, 0]);
    for (let i = 0; i < 30; i++) {
      const p = this.points[i];
      if (!p.alive) { effect.setCPDensity(i + 1, 0); continue; }
      // CTFPointManager::UpdatePoint: the extra velocity moves the point, drag changes the base velocity afterwards, gravity is added back
      const vl = Math.hypot(p.velocity[0], p.velocity[1], p.velocity[2]);
      const dir: Vec3 = vl > 1e-9 ? [p.velocity[0] / vl, p.velocity[1] / vl, p.velocity[2] / vl] : [0, 0, 0];
      const along = p.attacker[0] * dir[0] + p.attacker[1] * dir[1] + p.attacker[2] * dir[2];
      const gravity: Vec3 = [0, 0, config[4] * dt];
      for (let k = 0; k < 3; k++) p.position[k] += dt * (p.velocity[k] + gravity[k] + (k === 2 ? config[5] : 0) + along * dir[k]);
      const drag = Math.max(0, Math.min(1, 1 - dt * config[3]));
      for (let k = 0; k < 3; k++) p.velocity[k] = p.velocity[k] * drag + gravity[k];
      if (config[9] !== 0) for (let k = 0; k < 3; k++) p.attacker[k] *= drag;
      p.age += dt;
      const t = Math.min(1, p.age / p.life);
      effect.setCP(i + 1, p.position);
      effect.setCPRadius(i + 1, 12 * (config[7] + (config[8] - config[7]) * t));
      effect.setCPDensity(i + 1, p.age < p.life ? 1 - 0.99 * t : 0);
      effect.setCPDuration(i + 1, p.life);
      effect.setCPVelocity(i + 1, [p.velocity[0] + p.attacker[0], p.velocity[1] + p.attacker[1], p.velocity[2] + p.attacker[2]]);
      if (p.age >= p.life) p.alive = false;
    }
  }
}

interface Instance {
  /** One collection tree per slot (a projectile effect has a slot for each projectile in flight). */
  slots: Collection[];
  started: boolean[];
  world: World;
  defs: Map<DmxElement, SystemDef>;
  root: SystemDef;
  refire: number;
  elapsed: number;
  nextRefire: number;
  flame: FlameManager;
  generation: number;
  seeds: number[];
}

const instances = new Map<number, Instance>();
let nextHandle = 1;
let generation = 0;

export function resetEngine(): number {
  instances.clear();
  return ++generation;
}

const pcfCache = new Map<string, Promise<DmxElement[]>>();
const sheetCache = new Map<string, Promise<(seq: number) => number>>();

async function sheetOf(loader: EngineLoader, material: string): Promise<(seq: number) => number> {
  const key = material.toLowerCase();
  let hit = sheetCache.get(key);
  if (!hit) {
    hit = (async () => {
      try {
        const name = key.replace(/\\/g, "/").replace(/^materials\//, "");
        const text = new TextDecoder().decode(await loader.load(`materials/${name}`));
        const base = /"\$basetexture"\s+"([^"]+)"/i.exec(text)?.[1];
        if (!base) return () => 0;
        const sheet = parseSheet(await loader.load(`materials/${base.replace(/\\/g, "/").replace(/\.vtf$/i, "")}.vtf`));
        return (seq: number) => sheet.get(seq)?.frames.length ?? 0;
      } catch { return () => 0; }
    })();
    sheetCache.set(key, hit);
  }
  return hit;
}

function* tree(c: Collection): Generator<Collection> { yield* c.walk(); }

function frameNodes(slots: Collection[]): NativeNode[] {
  const out: NativeNode[] = [];
  for (const slot of slots) for (const c of tree(slot)) out.push({ id: out.length, name: c.def.name, capacity: c.capacity, time: c.time, dt: c.dt, particles: [] });
  return out;
}

export async function startEngine(loader: EngineLoader, cp: number[], gen: number, file: string, system: string, boxes: number[][], refire: number, slots: number):
  Promise<{ handle: number; nodes: NativeNode[] } | null> {
  if (gen !== generation) throw new Error("Particle preview was reloaded");
  let graph = pcfCache.get(file);
  if (!graph) { graph = loader.load(file).then(parsePcf); pcfCache.set(file, graph); graph.catch(() => pcfCache.delete(file)); }
  const elements = await graph;
  const rootElement = elements.find((e) => e.type === "DmeParticleSystemDefinition" && e.name.toLowerCase() === system.toLowerCase());
  if (!rootElement) throw new Error(`Native particle system missing from PCF: ${system}`);
  const defs = new Map<DmxElement, SystemDef>();
  const root = new SystemDef(rootElement, elements, defs);
  // the sprite sheets of every system of the tree (Lifetime From Sequence needs their frame counts)
  const sheets = new Map<SystemDef, (seq: number) => number>();
  await Promise.all([...defs.values()].map(async (d) => { const material = d.element.attributes.material; if (typeof material === "string" && material) sheets.set(d, await sheetOf(loader, material)); }));
  const world: World = { boxes: [], floor: null };
  const seeds = Array.from({ length: slots }, (_, i) => 273 + i);
  const made = seeds.map((seed) => {
    const c = new Collection(root, 0, seed, world);
    for (const part of c.walk()) part.sheet = sheets.get(part.def) ?? null;
    c.setCP(0, [cp[9], cp[10], cp[11]]);
    c.setCPOrientation(0, [cp[0], cp[1], cp[2]], [cp[3], cp[4], cp[5]], [cp[6], cp[7], cp[8]]);
    c.setCPObject(0, true);
    return c;
  });
  void boxes;
  if (slots > 1) for (const c of made) c.stopEmission(false);
  const handle = nextHandle++;
  instances.set(handle, { slots: made, started: made.map(() => slots === 1), world, defs, root, refire, elapsed: 0, nextRefire: refire, flame: new FlameManager(), generation: gen, seeds });
  return { handle, nodes: frameNodes(made) };
}

export function stopEngine(handle: number) { instances.delete(handle); }

/** One step of an effect (the arguments are the ones of the desktop command; see native_particles.rs). */
export function stepEngine(handle: number, ticks: number, cp: number[], boxes: number[][], action: number, flame: number[], colors: number[], rows: number[][], target: number[], floor: number | null): ArrayBuffer {
  const inst = instances.get(handle);
  if (!inst) throw new Error("Unknown native particle helper");
  const { slots } = inst;
  inst.world.boxes = boxes.map((b): HitBox => ({ mins: [b[0], b[1], b[2]], maxs: [b[3], b[4], b[5]], transform: b.slice(6, 18) }));
  inst.world.floor = floor;
  let first = slots[0];
  const place = (c: Collection, m: number[]) => {
    c.setCP(0, [m[9], m[10], m[11]]);
    c.setCPOrientation(0, [m[0], m[1], m[2]], [m[3], m[4], m[5]], [m[6], m[7], m[8]]);
  };
  place(first, cp);
  if (colors.length) for (const c of slots) { c.setCP(9, [colors[0], colors[1], colors[2]]); c.setCP(10, [colors[3], colors[4], colors[5]]); }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i], command = row[12];
    let c = slots[i];
    // a projectile makes a new effect in the game: a restart alone could keep the state of a child that stopped
    if (command === 1 && slots.length > 1) {
      const fresh = new Collection(inst.root, 0, inst.seeds[i], inst.world);
      for (const [from, to] of zip(c.walk(), fresh.walk())) to.sheet = from.sheet;
      fresh.setCPObject(0, true);
      slots[i] = c = fresh;
      if (i === 0) first = fresh;
      if (colors.length) { c.setCP(9, [colors[0], colors[1], colors[2]]); c.setCP(10, [colors[3], colors[4], colors[5]]); }
    }
    place(c, row);
    if (command === 1 || command === 3) { inst.started[i] = true; if (command === 3 || slots.length === 1) c.restart(); c.startEmission(); }
    if (command === 2) c.stopEmission(false);
  }
  if (target.length) for (const c of slots) c.setCP(1, [target[0], target[1], target[2]]);
  if (flame.length) inst.flame.command(action);
  if (action === 1 || action === 3) { first.restart(); first.startEmission(); }
  if (action === 2) first.stopEmission(false);
  const origin: Vec3 = [cp[9], cp[10], cp[11]];
  const attacker: Vec3 = inst.flame.positioned && ticks > 0
    ? [(origin[0] - inst.flame.previous[0]) / (ticks / 60), (origin[1] - inst.flame.previous[1]) / (ticks / 60), (origin[2] - inst.flame.previous[2]) / (ticks / 60)]
    : [0, 0, 0];
  if (ticks > 0) { inst.flame.previous = origin; inst.flame.positioned = true; }
  const dt = 1 / 60;
  for (let tick = 0; tick < ticks; tick++) {
    if (flame.length) inst.flame.step(first, cp, flame, dt, attacker);
    if (inst.refire > 0 && inst.elapsed >= inst.nextRefire) { first.restart(); inst.nextRefire = inst.elapsed + inst.refire; }
    for (let i = 0; i < slots.length; i++) if (inst.started[i]) slots[i].simulate(dt);
    inst.elapsed += dt;
  }
  return encodeFrame(slots);
}

function* zip<A, B>(a: Iterable<A>, b: Iterable<B>): Generator<[A, B]> {
  const ia = a[Symbol.iterator](), ib = b[Symbol.iterator]();
  for (;;) { const x = ia.next(), y = ib.next(); if (x.done || y.done) return; yield [x.value, y.value]; }
}

/** The binary frame of the native helper: u32 collections, then per collection f64 time, f64 dt, u32 count and 17 float32 per particle. */
function encodeFrame(slots: Collection[]): ArrayBuffer {
  const all: Collection[] = [];
  for (const slot of slots) for (const c of tree(slot)) all.push(c);
  let size = 4;
  for (const c of all) size += 20 + (c.def.hasRenderers ? c.n : 0) * 68;
  const buffer = new ArrayBuffer(size);
  const view = new DataView(buffer);
  view.setUint32(0, all.length, true);
  let at = 4;
  for (const c of all) {
    view.setFloat64(at, c.time, true); view.setFloat64(at + 8, c.dt, true);
    const countAt = at + 16;
    at += 20;
    let written = 0;
    if (c.def.hasRenderers) for (let i = 0; i < c.n; i++) {
      const values = [
        c.xyz[i * 3], c.xyz[i * 3 + 1], c.xyz[i * 3 + 2], c.rgb[i * 3], c.rgb[i * 3 + 1], c.rgb[i * 3 + 2], c.alpha[i], c.radius[i], c.rotation[i],
        c.creation[i], c.life[i], Math.trunc(c.seq[i]), c.yaw[i], c.prev[i * 3], c.prev[i * 3 + 1], c.prev[i * 3 + 2], c.trail[i],
      ];
      if (!values.every(Number.isFinite)) continue;
      for (const v of values) { view.setFloat32(at, v, true); at += 4; }
      written++;
    }
    view.setUint32(countAt, written, true);
  }
  return buffer.slice(0, at);
}

/** The frame as the helper's first (text) answer has it: the collections with their clocks and no particles. */
export { encodeFrame };
