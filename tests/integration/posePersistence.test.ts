// Bundle before running: npx esbuild tests/integration/posePersistence.test.ts --bundle --platform=node --format=esm --outfile=target/posePersistence.test.mjs
// Then: node --test target/posePersistence.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { Actor, type ActorContext } from "../../src/viewer/actor";
import { GeometryCache } from "../../src/viewer/geometryCache";
import { poseForSkeleton, poseToClip } from "../../src/viewer/poseRig";
import { parseScene } from "../../src/viewer/scene";
import type { ModelData } from "../../src/viewer/payload";

function actor() {
  const out = new Actor(1, {
    scene: new THREE.Scene(), geometry: new GeometryCache(), jiggle: () => false,
    // No meshes or materials are needed to exercise the real skeleton/pose lifecycle.
    mats: {} as ActorContext["mats"],
  });
  const model: ModelData = {
    path: "models/player/soldier.mdl", flexDescCount: 0, flexControllers: [], flexRules: [],
    skinCount: 2, eyeAttachment: null, includeModels: [], bodyParts: [],
    bones: [
      { name: "root", parent: -1, poseToBone: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0] },
      { name: "hand", parent: 0, poseToBone: [1, 0, 0, -10, 0, 1, 0, 0, 0, 0, 1, 0] },
    ],
  };
  out.setModel(model, new Map());
  return out;
}

function editedActor() {
  const out = actor();
  out.usePose(out.bindPose()!);
  out.setBonePos(1, 21, 32, 43);
  out.setBoneQuat(1, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.7));
  return out;
}

test("finished custom poses remain available for scene saving and copying", () => {
  const original = editedActor();
  const edited = original.snapshotCustomPose()!;
  original.endPose();
  assert.equal(original.isPosing, false);
  assert.equal(original.holdsPose, true);
  assert.equal(original.pose, null);
  assert.deepEqual(original.snapshotCustomPose(), edited);
});

test("copies keep both edited and finished poses without sharing mutable bone transforms", () => {
  for (const editing of [true, false]) {
    const original = editedActor();
    if (!editing) original.endPose();
    const captured = original.snapshotCustomPose()!;
    const copy = actor();
    copy.usePose(captured);
    if (!editing) copy.endPose();
    assert.deepEqual(copy.snapshotCustomPose(), original.snapshotCustomPose());
    assert.equal(copy.isPosing, editing);
    copy.beginPose();
    copy.setBonePos(1, 9, 8, 7);
    assert.deepEqual(Array.from(original.snapshotCustomPose()!.pos.slice(3)), [21, 32, 43]);
    captured.pos.fill(0);
    assert.deepEqual(Array.from(copy.snapshotCustomPose()!.pos.slice(3)), [9, 8, 7]);
  }
});

test("scene JSON preserves custom transforms and pose editing state across reopening", () => {
  for (const editing of [true, false]) {
    const original = editedActor();
    if (!editing) original.endPose();
    const captured = original.snapshotCustomPose()!;
    const pose: { bones: string[]; pos: number[]; quat: number[]; editing?: boolean } = {
      bones: original.boneNames, pos: Array.from(captured.pos), quat: Array.from(captured.quat), editing,
    };
    const scene = parseScene(JSON.stringify({
      app: "tf2-workbench", version: 1, camera: { position: [0, 1, 2], target: [0, 0, 0] },
      entities: [{ cls: "soldier", pose }],
    }));
    const saved = scene.entities[0].pose!;
    const reopened = actor();
    const restored = poseForSkeleton({
      app: "tf2-workbench", version: 1, kind: "pose", model: "soldier", ...saved,
    }, reopened.boneNames, reopened.bindPose()!).pose;
    reopened.usePose(restored);
    if (saved.editing === false) reopened.endPose();
    assert.deepEqual(reopened.snapshotCustomPose(), captured);
    assert.equal(reopened.isPosing, editing);
    delete pose.editing;
    const legacy = parseScene(JSON.stringify({
      app: "tf2-workbench", version: 1, camera: { position: [0, 1, 2], target: [0, 0, 0] },
      entities: [{ cls: "soldier", pose }],
    }));
    assert.equal(legacy.entities[0].pose!.editing, true);
  }
});

test("ordinary paused animations are not mistaken for custom poses", () => {
  const out = actor();
  out.playback.clip = poseToClip(out.bindPose()!);
  out.playback.playing = false;
  assert.equal(out.snapshotCustomPose(), null);
});
