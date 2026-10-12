// Run with: node --test "tests/*.test.ts"
import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { PropWorld } from "../src/props/propPhysics.ts";

const box = (world: PropWorld, x: number, y: number, z: number, half: [number, number, number], mass = 20, fixed = false) =>
  world.add({ center: new THREE.Vector3(x, y, z), quaternion: new THREE.Quaternion(), half: new THREE.Vector3(...half), mass, fixed });
const run = (world: PropWorld, seconds: number) => { for (let t = 0; t < seconds; t += 1 / 60) world.step(1 / 60); };
const tilt = (b: { q: THREE.Quaternion }) => new THREE.Vector3(0, 1, 0).applyQuaternion(b.q).angleTo(new THREE.Vector3(0, 1, 0));

test("a box dropped on the floor lands, stays upright and falls asleep", () => {
  const world = new PropWorld();
  const b = box(world, 0, 60, 0, [10, 15, 10]);
  run(world, 3);
  assert.ok(Math.abs(b.p.y - 15) < 0.6, `rests at ${b.p.y}`);
  assert.ok(tilt(b) < 0.05, `tilted ${tilt(b)}`);
  assert.ok(b.sleeping);
  assert.ok(Math.hypot(b.p.x, b.p.z) < 1);
});

test("a push at the top tips a tall box over; a push at the middle slides it", () => {
  const tall = new PropWorld();
  const t = box(tall, 0, 40, 0, [8, 40, 8], 30);
  run(tall, 1);
  tall.impulse(t, new THREE.Vector3(-8, 78, 0), new THREE.Vector3(900, 0, 0));
  run(tall, 3);
  assert.ok(tilt(t) > 0.6, `tilt ${tilt(t)}`);
  assert.ok(t.p.x > 5);
  const low = new PropWorld();
  const s = box(low, 0, 15, 0, [15, 15, 15], 30);
  run(low, 1);
  low.impulse(s, new THREE.Vector3(-15, 15, 0), new THREE.Vector3(3000, 0, 0));
  run(low, 3);
  assert.ok(s.p.x > 5, `slid to ${s.p.x}`);
  assert.ok(tilt(s) < 0.2);
});

test("a box lands on another and rests there", () => {
  const world = new PropWorld();
  const under = box(world, 0, 10, 0, [20, 10, 20], 40);
  const over = box(world, 2, 45, 1, [8, 8, 8], 10);
  run(world, 4);
  assert.ok(Math.abs(under.p.y - 10) < 1.5, `under ${under.p.y}`);
  assert.ok(Math.abs(over.p.y - 28) < 2.5, `over ${over.p.y}`);
  assert.ok(tilt(over) < 0.2);
});

test("an explosion throws the light things and not the fixed ones", () => {
  const world = new PropWorld();
  const light = box(world, 100, 10, 0, [10, 10, 10], 8);
  const fixed = box(world, -100, 10, 0, [10, 10, 10], 8, true);
  const far = box(world, 900, 10, 0, [10, 10, 10], 8);
  run(world, 1);
  world.blast(new THREE.Vector3(40, 2, 0), 146);
  run(world, 1.5);
  assert.ok(light.p.x > 140, `moved to ${light.p.x}`);
  assert.equal(fixed.p.x, -100);
  assert.ok(Math.abs(far.p.x - 900) < 0.5, `a far box moved to ${far.p.x}`);
});

test("a segment hits the box in front and reports where", () => {
  const world = new PropWorld();
  const near = box(world, 100, 10, 0, [10, 10, 10]);
  box(world, 200, 10, 0, [10, 10, 10]);
  const hit = world.raycast(new THREE.Vector3(0, 10, 0), new THREE.Vector3(400, 10, 0))!;
  assert.equal(hit.body, near);
  assert.ok(Math.abs(hit.point.x - 90) < 1e-3);
  assert.equal(world.raycast(new THREE.Vector3(0, 100, 0), new THREE.Vector3(400, 100, 0)), null);
  assert.equal(world.raycast(new THREE.Vector3(0, 10, 0), new THREE.Vector3(50, 10, 0)), null);
});

test("the player is pushed out of a heavy box and pushes a light one", () => {
  const world = new PropWorld();
  const heavy = box(world, 0, 20, 0, [20, 20, 20], 5000, true);
  const player = world.pushOut(new THREE.Vector3(-30, 0, 0), 22, 82, new THREE.Vector3(300, 0, 0));
  assert.ok(player.x <= -41.9, `player at ${player.x}`);
  assert.equal(heavy.p.x, 0);
  const light = new PropWorld();
  const crate = box(light, 0, 15, 0, [15, 15, 15], 6);
  const at = light.pushOut(new THREE.Vector3(-30, 0, 0), 22, 82, new THREE.Vector3(300, 0, 0));
  assert.ok(crate.p.x > 5 && crate.v.x > 0, "the crate gave way");
  assert.ok(at.x > -31 && at.x < -29, `the player hardly moved: ${at.x}`);
  // above the box nothing stops the player
  const high = world.pushOut(new THREE.Vector3(-10, 60, 0), 22, 82, new THREE.Vector3(0, 0, 0));
  assert.equal(high.x, -10);
});
