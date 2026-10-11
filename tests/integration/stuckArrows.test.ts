import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { HitReactions } from "../../src/viewer/hitReactions";
import { ArticulatedRagdoll } from "../../src/viewer/ragdollPhysics";
import { SOURCE_TO_VIEWER } from "../../src/viewer/animator";
import { StuckArrows, arrowSpot, boltPlacement, pinPosition, transformedBox, wallAlong, BODY_ARROW_SECONDS, MAX_STUCK } from "../../src/viewer/stuckArrows";
import { WeaponProjectiles } from "../../src/viewer/particles/projectiles";

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

test("an arrow lies 40 to 60 percent of the way through the world box of the hitbox it struck", () => {
  const min = v(0, 10, 20), max = v(10, 30, 60);
  const low = arrowSpot(min, max, () => 1), high = arrowSpot(min, max, () => 0);
  assert.ok(low.distanceTo(v(4, 18, 36)) < 1e-9);
  assert.ok(high.distanceTo(v(6, 22, 44)) < 1e-9);
  // a turned hitbox grows to the AABB of its corners (TransformAABB)
  const turned = transformedBox(new THREE.Matrix4().makeRotationZ(Math.PI / 2), v(-1, -2, 0), v(1, 2, 3));
  assert.ok(turned.min.distanceTo(v(-2, -1, 0)) < 1e-9 && turned.max.distanceTo(v(2, 1, 3)) < 1e-9);
});

test("a ragdoll is pinned only to a wall within 125 units of the arrow's path", () => {
  const world = new THREE.Box3(v(-500, -500, 0), v(500, 500, 1000));
  const near = wallAlong(v(400, 0, 60), v(1, 0, 0), world)!;
  assert.ok(near.point.distanceTo(v(500, 0, 60)) < 1e-9 && near.distance === 100 && near.normal.x === -1);
  assert.equal(wallAlong(v(300, 0, 60), v(1, 0, 0), world), null);
  // the floor is a wall too
  const down = wallAlong(v(0, 0, 50), v(0, 0, -1), world)!;
  assert.ok(down.point.z === 0 && down.normal.z === 1);
  // the first surface along the path wins
  assert.equal(wallAlong(v(450, 0, 20), v(0.8, 0, -0.6), world)!.normal.z, 1);
  assert.ok(boltPlacement(v(500, 0, 60), v(1, 0, 0)).x === 495);
  assert.ok(pinPosition(v(500, 0, 60), v(1, 0, 0), () => 0).x === 493 && pinPosition(v(500, 0, 60), v(1, 0, 0), () => 1).x === 486);
});

function actorAt(x: number, bonePosition: () => THREE.Matrix4 | null) {
  const clip = { frames: 1, fps: 1, numBones: 1, pos: new Float32Array(3), quat: new Float32Array(4) };
  const actor: any = {
    snapshotCustomPose: () => null, particleTeam: 0,
    particleModel: { path: "models/player/test.mdl", bones: [{ name: "pelvis", parent: -1, poseToBone: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0] }],
      bodyParts: [{ models: [{ meshes: [{ positions: new Float32Array([-10, -10, -20, 10, 10, 20]), skinIndices: new Uint16Array(8), skinWeights: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0]) }] }] }] },
    playback: { clip, time: 0, playing: true },
    particleRootFrame: (out = new THREE.Matrix4()) => out.copy(SOURCE_TO_VIEWER).multiply(new THREE.Matrix4().makeTranslation(x, 0, 0)),
    particleBoneFrame: bonePosition, setLive: () => {}, endLive: () => {}, setClip: () => {}, poseBones: () => {}, setReactionHidden: () => {},
  };
  return actor;
}

function setup(x = 100) {
  let bone: THREE.Matrix4 | null = new THREE.Matrix4().makeTranslation(0, 0, 40);
  const actor = actorAt(x, () => bone);
  const scene = new THREE.Scene();
  const manager = new HitReactions(scene, () => [actor], {} as any, () => ({ group: new THREE.Group(), emit: () => {}, step: () => {}, freeze: () => {}, dispose: () => {} }) as any);
  (manager as any).physics.set(actor.particleModel.path, { solids: [{ index: 0, bone: "pelvis", mass: 80 }], joints: [], collisionPairs: [], selfCollisions: false });
  (manager as any).collisionModels.set(actor.particleModel.path, { hitboxes: [{ bone: 0, min: v(-10, -10, -20), max: v(10, 10, 20) }] });
  const arrow = new THREE.Group(); arrow.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
  arrow.quaternion.identity();
  return { actor, manager, scene, arrow, moveBone: (m: THREE.Matrix4 | null) => { bone = m; } };
}

test("an arrow that kills stays in the body and follows the bone", () => {
  const f = setup(), owner = {} as any;
  const world = () => new THREE.Box3(v(-2000, -2000, 0), v(2000, 2000, 2000));
  const hit = f.manager.arrowStrike(owner, v(0, 0, 40), v(200, 0, 40), v(1, 0, 0), f.arrow, 0, world);
  assert.ok(hit && Math.abs(hit.x - 90) < 1e-6);
  assert.ok(f.manager.has(f.actor), "the victim dies");
  const stuck: StuckArrows = (f.manager as any).stuck;
  assert.equal(stuck.count, 1);
  const object = stuck.group.children[0];
  assert.notEqual(object, f.arrow, "a copy stays behind");
  // inside the hitbox (world x 90..110, z 20..60), around its middle
  const p = v(0, 0, 0).setFromMatrixPosition(object.matrix);
  assert.ok(p.x >= 100 - 10 * 0.2 - 1e-6 && p.x <= 100 + 10 * 0.2 + 1e-6, `x ${p.x}`);
  assert.ok(p.z >= 40 - 1e-6 - 20 * 0.2 && p.z <= 40 + 20 * 0.2 + 1e-6, `z ${p.z}`);
  // the bone moves (the ragdoll falls): so does the arrow, by the same amount
  f.moveBone(new THREE.Matrix4().makeTranslation(30, 0, 5));
  stuck.step(1 / 60);
  const q = v(0, 0, 0).setFromMatrixPosition(object.matrix);
  assert.ok(Math.abs(q.x - (p.x + 30)) < 1e-6 && Math.abs(q.z - (p.z - 35)) < 1e-6);
  // gone after its time, and when the victim is reset
  stuck.step(BODY_ARROW_SECONDS);
  assert.equal(stuck.count, 0);
});

test("a victim with a wall right behind is pinned there with a fixed bolt, not carrying the arrow", () => {
  const f = setup(), owner = {} as any;
  const world = () => new THREE.Box3(v(-2000, -2000, 0), v(220, 2000, 2000));
  f.manager.arrowStrike(owner, v(0, 0, 40), v(200, 0, 40), v(1, 0, 0), f.arrow, 0, world);
  const stuck: StuckArrows = (f.manager as any).stuck;
  assert.equal(stuck.count, 1);
  const bolt = v(0, 0, 0).setFromMatrixPosition(stuck.group.children[0].matrix);
  assert.ok(Math.abs(bolt.x - 215) < 1e-6, `bolt at ${bolt.x}`);
  f.moveBone(new THREE.Matrix4().makeTranslation(300, 0, 0)); stuck.step(1 / 60);
  assert.equal(v(0, 0, 0).setFromMatrixPosition(stuck.group.children[0].matrix).x, bolt.x, "a bolt in a wall stays put");
  // resetting the scene removes every arrow
  f.manager.reset();
  assert.equal(stuck.count, 0);
});

test("a missed shot and a disabled reaction leave nothing behind", () => {
  const f = setup(), owner = {} as any, world = () => new THREE.Box3(v(-2000, -2000, 0), v(2000, 2000, 2000));
  assert.equal(f.manager.arrowStrike(owner, v(0, 50, 40), v(200, 50, 40), v(1, 0, 0), f.arrow, 0, world), null);
  f.manager.enabled = false;
  assert.ok(f.manager.arrowStrike(owner, v(0, 0, 40), v(200, 0, 40), v(1, 0, 0), f.arrow, 0, world));
  assert.equal(f.manager.has(f.actor), false);
  assert.equal((f.manager as any).stuck, null);
});

test("stuck arrows are capped and the oldest goes first", () => {
  const stuck = new StuckArrows(3), scene = new THREE.Scene(); scene.add(stuck.group);
  const objects = [0, 1, 2, 3].map(() => new THREE.Group());
  objects.forEach((o, i) => stuck.fix(o, new THREE.Matrix4().makeTranslation(i, 0, 0)));
  assert.equal(stuck.count, 3);
  assert.equal(objects[0].parent, null);
  assert.ok(MAX_STUCK >= 16);
});

test("an arrow in flight asks the arrow hook, and stops where it was struck", () => {
  const profile: any = { kind: "arrow", speed: 1800, gravity: 0, lifetime: 5, spin: false, team: 0 };
  const calls: THREE.Vector3[] = [];
  const manager = new (WeaponProjectiles as any)(profile, 0, undefined, {
    hit: () => { throw new Error("the arrow hook replaces the plain hit"); },
    arrow: (_s: THREE.Vector3, e: THREE.Vector3, d: THREE.Vector3) => { calls.push(d.clone()); return e.x >= 90 ? v(90, 0, 100) : null; },
    explosion: () => {},
  });
  const group = new THREE.Group(); group.visible = false; manager.group.add(group);
  manager.slots.push({ group, matrix: new THREE.Matrix4(), motion: { position: v(0, 0, 100), velocity: v(1800, 0, 0), rotation: new THREE.Quaternion(), angular: v(0, 0, 0), age: 0, active: true }, action: 0, stopped: -Infinity, model: "", team: 0 });
  group.visible = true;
  for (let i = 0; i < 30 && manager.slots[0].motion; i++) manager.step(1 / 60);
  assert.ok(calls.length > 0 && calls[0].x > 0, "the hook gets the flight direction");
  assert.equal(manager.slots[0].motion, null, "the arrow is spent at the hit");
});

test("a pinned ragdoll body stays where it was nailed while the rest hangs", () => {
  const bones = [{ name: "root", parent: -1, poseToBone: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0] }, { name: "arm", parent: 0, poseToBone: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0] }];
  const mesh = (z: number) => ({ positions: new Float32Array([-2, -2, z - 2, 2, 2, z + 2]), skinIndices: new Uint16Array(8), skinWeights: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0]) });
  const model = { bones, bodyParts: [{ models: [{ meshes: [mesh(0)] }] }] } as any;
  const physics: any = { solids: [{ index: 0, bone: "root", mass: 1 }], joints: [], collisionPairs: [], selfCollisions: false };
  const sim = new ArticulatedRagdoll(model, [new THREE.Matrix4().makeTranslation(0, 0, 50), new THREE.Matrix4().makeTranslation(0, 0, 50)], physics, v(0, 0, 0), 0);
  assert.ok(sim.pin(1, v(300, 0, 80)), "a bone without its own body uses the nearest one above");
  const body = sim.bodies[0];
  sim.step(1 / 120);
  const held = body.p.clone();
  for (let i = 0; i < 240; i++) sim.step(1 / 120);
  assert.ok(body.p.distanceTo(held) < 1e-6, "no gravity moves it");
  assert.ok(Math.abs(held.x - 300) < 5 && Math.abs(held.z - 80) < 5);
});
