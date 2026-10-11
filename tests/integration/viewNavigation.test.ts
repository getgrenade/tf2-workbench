import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { Viewer } from "../../src/viewer/viewer";
import { ViewportCamera } from "../../src/viewer/viewportCamera";

function fixture(meshes: THREE.Mesh[]) {
  const viewer = Object.create(Viewer.prototype) as any;
  const camera = new ViewportCamera(40, 1, .1, 1000); camera.position.z = 100;
  const controls = { target: new THREE.Vector3(), minDistance: 1, enableDamping: true, zoomSpeed: 1, update() { camera.lookAt(this.target); camera.updateMatrixWorld(true); } };
  Object.assign(viewer, { camera, controls, actorList: [{ meshes: () => meshes }], entityPointer: { inside: true, x: 200, y: 200 }, entityModal: null,
    cameras: { hot: false, prepareNavigation() {} }, rig: { gizmoHot: false }, viewAnim: 0,
    renderer: { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400 }) } } });
  return viewer;
}
const box = (x = 0, z = 0) => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshBasicMaterial()); mesh.position.set(x, 0, z); return mesh; };

test("orthographic pointer focus keeps the projection span and scroll strength clamps invalid settings", () => {
  const viewer = fixture([box(20)]); viewer.camera.setOrthographic(true, 100);
  const span = viewer.camera.halfHeight, zoom = viewer.camera.zoom;
  viewer.camera.updateMatrixWorld(true);
  const ndc = new THREE.Vector3(20, 0, 5).project(viewer.camera); viewer.entityPointer.x = (ndc.x + 1) * 200;
  assert.equal(viewer.focusAtPointer(), true);
  assert.equal(viewer.camera.halfHeight, span); assert.equal(viewer.camera.zoom, zoom);
  for (const [input, expected] of [[3, 3], [0, .1], [100, 10], [NaN, 1]]) {
    viewer.setScrollStrength(input); assert.equal(viewer.controls.zoomSpeed, expected);
  }
});
