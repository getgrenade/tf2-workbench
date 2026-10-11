import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { ViewportCamera } from "../../src/viewer/viewportCamera";
import { Viewer } from "../../src/viewer/viewer";
import { parseScene } from "../../src/viewer/scene";

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
test("orthographic projection uses parallel rays and depth-independent size; switching preserves target-plane framing", () => {
  const camera = new ViewportCamera(40, 16 / 9, .1, 1000); camera.position.z = 100; camera.updateMatrixWorld(true);
  const point = new THREE.Vector3(10, 10, 0), before = point.clone().project(camera);
  camera.setOrthographic(true, 100);
  const after = point.clone().project(camera); close(after.x, before.x); close(after.y, before.y);
  close(point.clone().setZ(-100).project(camera).x, after.x);
  const left = new THREE.Raycaster(), right = new THREE.Raycaster();
  left.setFromCamera(new THREE.Vector2(-.5, 0), camera); right.setFromCamera(new THREE.Vector2(.5, 0), camera);
  assert.deepEqual(left.ray.direction.toArray(), right.ray.direction.toArray()); assert.notEqual(left.ray.origin.x, right.ray.origin.x);
  assert.equal(camera.isPerspectiveCamera, false); assert.equal(camera.isOrthographicCamera, true);
  const clone = camera.clone(); assert.equal(clone.isOrthographicCamera, true); assert.deepEqual(clone.projectionMatrix.elements, camera.projectionMatrix.elements);
  camera.setOrthographic(false, 100); close(point.project(camera).x, before.x);
});
test("viewport toggle, orthographic zoom/pan and resize preserve an intuitive framing", () => {
  const camera = new ViewportCamera(40, 4 / 3, .1, 1000); camera.position.z = 100; camera.updateMatrixWorld(true);
  const viewer = Object.create(Viewer.prototype) as any;
  Object.assign(viewer, { camera, cameras: { active: null, prepareNavigation() {} }, controls: { target: new THREE.Vector3(), update() {} }, container: { clientHeight: 600 }, viewAnim: 0 });
  viewer.toggleProjection(); assert.equal(camera.isOrthographicCamera, true);
  const extent = camera.halfHeight; viewer.zoomBy(.5); close(camera.zoom, 2);
  viewer.panBy(30, 0); close(viewer.controls.target.x, -extent / 10 / 2);
  camera.aspect = 2; camera.updateProjectionMatrix(); close(camera.right / camera.top, 2);
  viewer.toggleProjection(); assert.equal(camera.isOrthographicCamera, false); close(camera.position.distanceTo(viewer.controls.target), 50); close(camera.zoom, 1);
});
test("scene projection state round-trips and old scenes default to perspective", () => {
  const base = { app: "tf2-workbench", version: 1, camera: { position: [0, 0, 100], target: [0, 0, 0] }, entities: [{ cls: "soldier" }] };
  const viewportProjection = { orthographic: true, halfHeight: 40, zoom: 2 };
  const parsed = parseScene(JSON.stringify({ ...base, viewportProjection })); assert.deepEqual(parsed.viewportProjection, viewportProjection);
  const viewer = Object.create(Viewer.prototype) as any; Object.assign(viewer, { camera: new ViewportCamera(), controls: { target: new THREE.Vector3() } });
  viewer.restoreProjection(parsed.viewportProjection); assert.equal(viewer.camera.isOrthographicCamera, true); close(viewer.camera.halfHeight, 40); close(viewer.camera.zoom, 2);
  viewer.restoreProjection(parseScene(JSON.stringify(base)).viewportProjection); assert.equal(viewer.camera.isOrthographicCamera, false); close(viewer.camera.zoom, 1);
});
