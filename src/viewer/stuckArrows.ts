import * as THREE from "three";
import type { Actor } from "./actor";
import { SOURCE_TO_VIEWER } from "./animator";

/**
 * What the game does with a Huntsman arrow that strikes a player (tf_projectile_arrow.cpp, c_tf_stickybolt.cpp, tf_hud_bowcharge.cpp).
 * The arrow is placed inside the struck hitbox (PositionArrowOnBone) and, unless it killed a player with a wall close behind, is sent
 * to every client as "arrow_impact": a client-side arrow attached to the hit bone, which then moves with the body and its ragdoll.
 * A kill with a wall within PIN_RANGE along the arrow's path instead pins the ragdoll there ("TFBoltImpact": the hit bone is moved to
 * the wall and frozen, and a bolt is left sticking out of the wall).
 */
export const PIN_RANGE = 125;
/** The time a bolt stuck in a wall stays (CreateCrossbowBoltTF) and one attached to a body (C_TFProjectile_Arrow m_flLifeTime). */
export const WALL_BOLT_SECONDS = 30;
export const BODY_ARROW_SECONDS = 40;
/** Arrows kept at once; the oldest goes first. */
export const MAX_STUCK = 48;
/** CreateCrossbowBoltTF draws the bolt this far back from the wall; StickRagdollNowTF puts the bone 7 to 14 units off it. */
const BOLT_SETBACK = 5;

/** Where the arrow's position goes inside a hitbox: PositionArrowOnBone takes 0.4 to 0.6 of the way along every axis of the box's world AABB. */
export function arrowSpot(min: THREE.Vector3, max: THREE.Vector3, random = Math.random, out = new THREE.Vector3()) {
  return out.set(
    min.x + (max.x - min.x) * (0.6 - 0.2 * random()),
    min.y + (max.y - min.y) * (0.6 - 0.2 * random()),
    min.z + (max.z - min.z) * (0.6 - 0.2 * random()),
  );
}

/** The world AABB of an oriented box (TransformAABB), given the matrix that takes the box's space into the world. */
export function transformedBox(matrix: THREE.Matrix4, min: THREE.Vector3, max: THREE.Vector3, out = new THREE.Box3()) {
  out.makeEmpty();
  const corner = new THREE.Vector3();
  for (let i = 0; i < 8; i++) out.expandByPoint(corner.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z).applyMatrix4(matrix));
  return out;
}

/**
 * The first surface of the scene's world (a floor and the walls of its box, in Source space) that a ray from `origin` along the unit
 * `direction` meets within `range`; CheckRagdollPinned's UTIL_TraceLine against the map. `origin` must lie inside the box.
 */
export function wallAlong(origin: THREE.Vector3, direction: THREE.Vector3, world: THREE.Box3, range = PIN_RANGE) {
  let distance = Infinity, normal: THREE.Vector3 | null = null;
  for (const axis of ["x", "y", "z"] as const) {
    const d = direction[axis];
    if (Math.abs(d) < 1e-9) continue;
    const t = ((d > 0 ? world.max[axis] : world.min[axis]) - origin[axis]) / d;
    if (t < distance) { distance = t; normal = new THREE.Vector3(); normal[axis] = d > 0 ? -1 : 1; }
  }
  if (!normal || distance < 0 || distance > range) return null;
  return { point: origin.clone().addScaledVector(direction, distance), normal, distance };
}

/** Where a bolt sticks out of a wall that a ragdoll is pinned to. */
export function boltPlacement(wallPoint: THREE.Vector3, direction: THREE.Vector3) {
  return wallPoint.clone().addScaledVector(direction, -BOLT_SETBACK);
}
/** Where the pinned bone goes: the arrow's end point, drawn back by 7 to 14 units along its direction. */
export function pinPosition(wallPoint: THREE.Vector3, direction: THREE.Vector3, random = Math.random) {
  return wallPoint.clone().addScaledVector(direction, -(7 + 7 * random()));
}

interface Stuck {
  object: THREE.Object3D;
  life: number;
  /** The body part the arrow follows, and its matrix in that bone's space; null for a bolt fixed in the world. */
  actor: Actor | null;
  bone: number;
  local: THREE.Matrix4;
}

const TO_SOURCE = SOURCE_TO_VIEWER.clone().invert();
const root = new THREE.Matrix4(), frame = new THREE.Matrix4();

/** The arrows that stay in the world (see above); everything is in Source space under one group. */
export class StuckArrows {
  readonly group = new THREE.Group();
  private readonly items: Stuck[] = [];
  constructor(private readonly max = MAX_STUCK) {
    this.group.name = "Stuck arrows";
    this.group.matrixAutoUpdate = false;
    this.group.matrix.copy(SOURCE_TO_VIEWER);
  }

  get count() { return this.items.length; }

  /** The matrix of a bone in Source space, or null while it has none. */
  static boneMatrix(actor: Actor, bone: number, out = new THREE.Matrix4()) {
    const bones = actor.particleBoneFrame(bone);
    if (!bones) return null;
    return out.copy(TO_SOURCE).multiply(actor.particleRootFrame(root)).multiply(bones);
  }

  private push(item: Stuck) {
    if (this.items.length >= this.max) this.drop(this.items[0]);
    item.object.matrixAutoUpdate = false;
    item.object.visible = true;
    this.group.add(item.object);
    this.items.push(item);
  }

  /** An arrow that follows a bone of `actor`, at `world` (its Source-space matrix now). */
  attach(object: THREE.Object3D, actor: Actor, bone: number, world: THREE.Matrix4, life = BODY_ARROW_SECONDS) {
    const boneToWorld = StuckArrows.boneMatrix(actor, bone);
    if (!boneToWorld) return false;
    this.push({ object, life, actor, bone, local: boneToWorld.invert().multiply(world) });
    this.place(this.items[this.items.length - 1]);
    return true;
  }

  /** A bolt fixed in the world. */
  fix(object: THREE.Object3D, world: THREE.Matrix4, life = WALL_BOLT_SECONDS) {
    object.matrix.copy(world);
    this.push({ object, life, actor: null, bone: -1, local: world.clone() });
  }

  private place(item: Stuck) {
    if (!item.actor) { item.object.matrix.copy(item.local); return; }
    const bone = StuckArrows.boneMatrix(item.actor, item.bone, frame);
    item.object.visible = !!bone;
    if (bone) item.object.matrix.multiplyMatrices(bone, item.local);
  }

  private drop(item: Stuck) {
    const at = this.items.indexOf(item);
    if (at >= 0) this.items.splice(at, 1);
    item.object.removeFromParent();
  }

  /** Removes the arrows of a character (it burst, or its reaction ended). */
  clearActor(actor: Actor) {
    for (const item of this.items.filter((i) => i.actor === actor)) this.drop(item);
  }

  /** Moves every arrow with its bone and retires the old ones. */
  step(dt: number) {
    for (const item of [...this.items]) {
      item.life -= dt;
      if (item.life <= 0) { this.drop(item); continue; }
      this.place(item);
    }
  }

  clear() { for (const item of [...this.items]) this.drop(item); }

  dispose() { this.clear(); this.group.removeFromParent(); }
}
