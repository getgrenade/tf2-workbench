// Bundle with esbuild for the PlayController's browser imports.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PlayController, type PlayHost } from "../../src/viewer/play";
import { Actor } from "../../src/viewer/actor";
import * as THREE from "three";
import { trailHalfWidth } from "../../src/viewer/particles/render";

test("Source trails constrain full width to length and do not change ordinary sprite size",()=>{
  assert.equal(trailHalfWidth(400,50),25,"Minigun core is capped to its 50-unit trail length");
  assert.equal(trailHalfWidth(2,4),1,"Small spark radius field is a full trail width");
  assert.equal(trailHalfWidth(400,0),0,"Stationary trails do not make huge cards");
});

test("minigun barrel rotates around its local axis and returns to bind pose on release", () => {
  const actor = Object.create(Actor.prototype) as Actor;
  const barrel = new THREE.Bone(); barrel.name = "barrel";
  const parent = new THREE.Matrix4().makeTranslation(10, 0, 0);
  const local = new THREE.Matrix4().makeTranslation(0, 2, 0);
  const world = [parent.clone(), new THREE.Matrix4()];
  Object.assign(actor, { ctx: { jiggle: () => false }, rig: { boneWorld: [parent] }, boneAims: new Map(), boneOverride: new Set(), cosmetics: [{
    rig: { boneWorld: world, parents: [-1, 0], bindWorld: [parent, parent.clone().multiply(local)] },
    bones: [new THREE.Bone(), barrel], bindLocal: [parent, local], map: [0, -1], jiggles: [null, null], own: null,
  }] });
  actor.setWeaponBarrel(Math.PI / 2);
  const transformed = new THREE.Vector3(1, 0, 0).applyMatrix4(barrel.matrixWorld);
  assert.ok(transformed.distanceTo(new THREE.Vector3(10, 3, 0)) < 1e-6);
  actor.setWeaponBarrel(null);
  assert.ok(barrel.matrixWorld.equals(parent.clone().multiply(local)));
});
