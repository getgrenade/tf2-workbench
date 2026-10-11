import * as T from "three";
import {particleSystemFile} from "../../api";
import {SOURCE_TO_VIEWER} from "../animator";
import {loadDefinitions,loadParticleMaterial} from "./assets";
import {NativeSimulation,nativeControlPoint} from "./native";
import {ParticleDraw} from "./render";
import {ParticleRopeDraw} from "./rope";
const TO_SOURCE=SOURCE_TO_VIEWER.clone().invert();
function frame(origin:T.Vector3,forward:T.Vector3){
  const x=forward.clone().normalize();if(!x.lengthSq())x.set(1,0,0);
  const y=new T.Vector3(0,0,1).cross(x);if(y.lengthSq()<1e-8)y.set(0,1,0);else y.normalize();
  return new T.Matrix4().makeBasis(x,y,x.clone().cross(y).normalize()).setPosition(origin);
}
/** tf_fx_blood.cpp: impact faces -normal; spray faces normal, with camera-relative lateral bias and 400-unit LOD. */
export function bloodPlan(origin:T.Vector3,normal:T.Vector3,camera?:T.Camera,random=Math.random){
  const spray=normal.clone(),impact=frame(origin,spray.clone().negate());let distance=0;
  if(camera){camera.updateWorldMatrix(true,false);const eye=new T.Vector3().setFromMatrixPosition(camera.matrixWorld).applyMatrix4(TO_SOURCE);distance=eye.distanceTo(origin);
    const forward=camera.getWorldDirection(new T.Vector3()).transformDirection(TO_SOURCE),right=new T.Vector3().setFromMatrixColumn(camera.matrixWorld,0).transformDirection(TO_SOURCE);
    if(Math.abs(spray.dot(forward))>.5){const push=.5+random()+.25*(distance/512),dot=spray.dot(right);spray.addScaledVector(right,(distance>=512?dot>0:random()>.5)?push:-push);}
  }
  return [{system:"blood_impact_red_01",matrix:impact},{system:distance<400?"blood_spray_red_01":"blood_spray_red_01_far",matrix:frame(origin,spray)}];
}
const systems=["blood_impact_red_01","blood_spray_red_01","blood_spray_red_01_far"];
const assets=new Map<string,Promise<{file:string;definitions:Awaited<ReturnType<typeof loadDefinitions>>}>>();
function asset(system:string){let pending=assets.get(system);if(!pending){pending=particleSystemFile(system).then(async file=>({file,definitions:await loadDefinitions(file)}));assets.set(system,pending);pending.catch(()=>assets.delete(system));}return pending;}
export async function prepareBlood(){await Promise.all(systems.map(async system=>{
  const {definitions}=await asset(system),visited=new Set<string>();
  const visit=async(name:string):Promise<void>=>{if(visited.has(name))return;visited.add(name);const node=definitions.get(name);if(!node)throw Error(`Missing blood definition: ${name}`);if(node.attributes.material)await loadParticleMaterial(String(node.attributes.material));await Promise.all(node.children.map(child=>visit(child.name)));};
  await visit(system);
}));}
/** Concurrent collections one blood system keeps; the oldest is restarted when more bursts than this overlap. */
const SLOTS = 16;
/** A system that has not emitted for this long (or whose particles are all gone) stops being stepped. */
const LIFETIME = 10;

/**
 * One blood particle system (impact, spray or far spray) simulated by a single helper with SLOTS independent collections, each restarted
 * for a new hit by its action flag, like the projectile impact pools. A hit therefore costs no new process.
 */
class BloodSystem {
  readonly group = new T.Group();
  private sim: NativeSimulation | null = null;
  private draws: (ParticleDraw | ParticleRopeDraw)[] = [];
  private readonly slots = Array.from({ length: SLOTS }, () => ({ matrix: new T.Matrix4(), action: 0 }));
  private next = 0;
  private accumulated = 0;
  /** Seconds since the last hit; Infinity while nothing is alive. */
  private age = Infinity;

  static async create(system: string) {
    const result = new BloodSystem();
    result.group.matrixAutoUpdate = false;
    result.group.matrix.copy(SOURCE_TO_VIEWER);
    try {
      const { file, definitions } = await asset(system);
      const sim = await NativeSimulation.create(definitions, () => new T.Matrix4(), console.error, file, system, () => [], 0, [], [], SLOTS,
        () => result.slots.map((slot) => {const row = [...nativeControlPoint(slot.matrix), slot.action]; slot.action = 0; return row;}));
      if (!sim) throw Error("Source particle helper unavailable for blood");
      result.sim = sim;
      for (const node of sim.walk()) for (const [index, renderer] of node.definition.functions.renderers.entries()) {
        const name = String(renderer.attributes.functionName);
        if (name === "render_screen_velocity_rotate") continue;
        if (!["render_rope", "render_animated_sprites", "render_sprite_trail"].includes(name)) throw Error(`Unsupported blood renderer: ${name}`);
        const material = await loadParticleMaterial(String(node.definition.attributes.material));
        const draw = name === "render_rope" ? new ParticleRopeDraw(node, material, index) : new ParticleDraw(node, material, index);
        result.draws.push(draw);
        result.group.add(draw.mesh);
      }
      return result;
    } catch (error) { result.dispose(); throw error; }
  }

  emit(matrix: T.Matrix4) {
    const slot = this.slots[this.next++ % SLOTS];
    slot.matrix.copy(matrix);
    slot.action = 1;
    this.age = 0;
    // the slot restarts on the next step, which sends its action with the control points
  }

  /** Steps while something is alive; hits are not simulated afterwards (draws keep following the camera). */
  step(dt: number, camera?: T.Camera, frozen = false) {
    if (frozen) this.freeze();
    if (this.sim && this.age !== Infinity) {
      this.age += dt;
      this.accumulated += Math.min(0.1, dt);
      while (this.accumulated >= 1 / 60) {this.sim.step(1 / 60); this.accumulated -= 1 / 60;}
      if (this.age >= LIFETIME || (this.age > 1 && [...this.sim.walk()].every((node) => node.time > 1 && !node.particles.length))) this.age = Infinity;
    }
    if (camera && this.draws.length) {this.group.updateWorldMatrix(true, true); for (const draw of this.draws) draw.update(camera);}
  }

  freeze() {this.sim?.dispose(); this.sim = null;}

  dispose() {
    this.freeze();
    for (const draw of this.draws) draw.dispose();
    this.draws = [];
    this.group.removeFromParent();
    this.group.clear();
  }
}

/** What the hit reactions need from a blood effect (the real one below, or a stand-in in tests). */
export interface BloodSink {
  readonly group: T.Group;
  emit(origin: T.Vector3, normal: T.Vector3, camera?: T.Camera): void;
  step(dt: number, camera?: T.Camera, frozen?: boolean): void;
  freeze(): void;
  dispose(): void;
}

/**
 * Damage blood for the whole scene: three pooled systems, created on first use, shared by every victim. Ten characters hit by one rocket
 * add ten collections to helpers that already run instead of starting twenty processes.
 */
export class BloodPool implements BloodSink {
  readonly group = new T.Group();
  private readonly systems = new Map<string, Promise<BloodSystem>>();
  private disposed = false;
  private frozen = false;

  private system(name: string) {
    let pending = this.systems.get(name);
    if (!pending) {
      pending = BloodSystem.create(name).then((system) => {
        if (this.disposed) {system.dispose(); throw Error("Blood pool was disposed");}
        if (this.frozen) system.freeze();
        this.group.add(system.group);
        return system;
      });
      this.systems.set(name, pending);
      pending.catch(() => this.systems.delete(name));
    }
    return pending;
  }

  emit(origin: T.Vector3, normal: T.Vector3, camera?: T.Camera) {
    if (this.disposed || this.frozen) return;
    for (const plan of bloodPlan(origin, normal, camera)) {
      void this.system(plan.system).then((system) => {if (!this.disposed && !this.frozen) system.emit(plan.matrix);}).catch((error) => {if (!this.disposed) console.error("Could not create hit blood", error);});
    }
  }

  step(dt: number, camera?: T.Camera, frozen = false) {
    if (this.disposed) return;
    if (frozen) this.frozen = true;
    for (const pending of this.systems.values()) void pending.then((system) => system.step(dt, camera, this.frozen), () => {});
  }

  freeze() {
    this.frozen = true;
    for (const pending of this.systems.values()) void pending.then((system) => system.freeze(), () => {});
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const pending of this.systems.values()) void pending.then((system) => system.dispose(), () => {});
    this.systems.clear();
    this.group.removeFromParent();
    this.group.clear();
  }
}
