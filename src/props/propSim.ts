import * as THREE from "three";
import { modelPhysics } from "../api";
import type { Actor } from "../viewer/actor";
import { PropWorld, type PropBody } from "./propPhysics";

/**
 * The props of a scene in play mode: each prop that has collision (a .phy file) becomes a box of the physics world, and the box's motion is
 * written back to the prop's model. A prop without collision (a tree, a sign: most of what the game draws as scenery) does not take part. When
 * play mode ends the props go back where the artist put them.
 */

/** Above this many kilograms a prop stays where it is (a dumpster is not pushed about by bullets and walkers). */
const IMMOVABLE_MASS = 2000;

interface Entry {
  actor: Actor;
  /** The middle of the box in the model's own frame (scaled), so that the model's origin can be found from the box's. */
  local: THREE.Vector3;
  origin: { offset: THREE.Vector3; yaw: number; pitch: number; roll: number };
}

const euler = new THREE.Euler(0, 0, 0, "YXZ");
const turned = new THREE.Vector3();

export class PropSim {
  readonly world = new PropWorld();
  private readonly entries = new Map<PropBody, Entry>();

  /** The world for the props among `actors` (those that have collision). */
  static async start(actors: Actor[], floor: number): Promise<PropSim> {
    const sim = new PropSim();
    sim.world.floor = floor;
    const cache = new Map<string, Promise<number>>();
    const massOf = (path: string) => {
      let m = cache.get(path);
      if (!m) {
        m = modelPhysics(path).then((p) => p.solids.reduce((t, s) => t + Math.max(0, s.mass), 0)).catch(() => 0);
        cache.set(path, m);
      }
      return m;
    };
    for (const actor of actors) {
      if (!actor.sourceBind || !actor.modelPath) continue;
      const mass = await massOf(actor.modelPath);
      const box = actor.modelBox;
      if (mass <= 0 || box.isEmpty()) continue;
      const local = box.getCenter(new THREE.Vector3());
      const q = new THREE.Quaternion().setFromEuler(euler.set(actor.pitch, actor.yaw, actor.roll, "YXZ"));
      const center = local.clone().applyQuaternion(q).add(actor.offset);
      const body = sim.world.add({ center, quaternion: q, half: box.getSize(new THREE.Vector3()).multiplyScalar(0.5), mass: Math.min(mass, 5000), fixed: mass > IMMOVABLE_MASS, data: actor });
      sim.entries.set(body, { actor, local, origin: { offset: actor.offset.clone(), yaw: actor.yaw, pitch: actor.pitch, roll: actor.roll } });
    }
    return sim;
  }

  get size() { return this.entries.size; }

  /** Advances the world and moves the models of the bodies that moved. */
  step(dt: number) {
    this.world.step(dt);
    for (const body of this.world.consumeMoved()) {
      const entry = this.entries.get(body);
      if (!entry) continue;
      euler.setFromQuaternion(body.q, "YXZ");
      turned.copy(entry.local).applyQuaternion(body.q);
      entry.actor.setPlacement(body.p.x - turned.x, body.p.y - turned.y, body.p.z - turned.z, euler.y);
      entry.actor.setTilt(euler.x, euler.z);
    }
  }

  /** Puts every prop back where the artist put it. */
  restore() {
    for (const { actor, origin } of this.entries.values()) {
      actor.setPlacement(origin.offset.x, origin.offset.y, origin.offset.z, origin.yaw);
      actor.setTilt(origin.pitch, origin.roll);
    }
  }
}
