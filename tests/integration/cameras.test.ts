import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { CAMERA_RATIOS, cameraFrame, cameraProjection, cameraSize, cameraSizes, parseCameras, type SceneCamera } from "../../src/viewer/cameraData";
import { CameraRig } from "../../src/viewer/cameraRig";
import { Viewer } from "../../src/viewer/viewer";
import { parseScene } from "../../src/viewer/scene";

const data = (): SceneCamera => ({ id: "one", name: "Shot", position: [0, 20, 100], quaternion: [0, 0, 0, 1], fov: 40, ratio: "1:1", height: 2048 });
class Dom {
  style: Record<string, string> = {};
  clientWidth = 800; clientHeight = 600; hidden = false;
  listeners = new Map<string, ((event: any) => void)[]>();
  addEventListener(name: string, fn: (event: any) => void) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]); }
  removeEventListener(name: string, fn: (event: any) => void) { this.listeners.set(name, (this.listeners.get(name) ?? []).filter(callback => callback !== fn)); }
  append() {} remove() {}
  emit(name: string, props: Record<string, unknown> = {}) {
    const event = { key: "", button: 0, pointerId: 1, clientX: 400, clientY: 300, target: { tagName: "CANVAS" }, preventDefault() {}, stopImmediatePropagation() {}, ...props };
    for (const fn of this.listeners.get(name) ?? []) fn(event);
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
}
function fixture() {
  (globalThis as any).document = { createElement: () => new Dom() };
  (globalThis as any).window = new Dom();
  const dom = new Dom(), scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 4 / 3, .1, 10000);
  camera.position.set(0, 20, 100); camera.updateMatrixWorld(true);
  const orbit = Object.assign(new THREE.EventDispatcher<{ change: {} }>(), { target: new THREE.Vector3(0, 20, 0), enabled: true, enableDamping: true, update() {} });
  return { rig: new CameraRig(scene, camera, orbit as any, dom as any, dom as any), dom, camera, orbit, scene };
}
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test("output presets preserve orientation and include all requested sizes", () => {
  assert.deepEqual(cameraSizes("1:1"), [{ w: 1024, h: 1024 }, { w: 2048, h: 2048 }]);
  assert.deepEqual(cameraSizes("16:9").map(s => s.h), [1080, 1440, 2560]);
  for (const ratio of CAMERA_RATIOS) {
    const [x, y] = ratio.split(":").map(Number);
    for (const size of cameraSizes(ratio)) assert.ok(Math.abs(size.w - size.h * x / y) <= 1);
  }
});

test("camera-frame crop and screenshot projection match across all ratios and viewport sizes", () => {
  for (const ratio of CAMERA_RATIOS) for (const [width, height] of [[800, 600], [1400, 500], [500, 1000]]) {
    const { rig, dom, camera } = fixture(); dom.clientWidth = width; dom.clientHeight = height;
    const saved = data(); saved.ratio = ratio; saved.height = cameraSizes(ratio)[0].h;
    saved.quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(.2, .3, .4)).toArray();
    rig.restore({ cameras: [saved], active: saved.id });
    const shot = rig.captureCamera()!, rect = cameraFrame(width, height, shot.size.w / shot.size.h);
    for (const point of [new THREE.Vector3(0, 0, -50), new THREE.Vector3(10, 15, -80)]) {
      point.applyQuaternion(shot.camera.quaternion).add(shot.camera.position);
      const live = point.clone().project(camera), exported = point.clone().project(shot.camera);
      close(((live.x + 1) * width / 2 - rect.x) / rect.w, (exported.x + 1) / 2);
      close(((1 - live.y) * height / 2 - rect.y) / rect.h, (1 - exported.y) / 2);
    }
    assert.equal(rig.objects[0].visible, false); assert.equal((rig as any).frame.hidden, false);
    rig.dispose();
  }
});

test("camera from view preserves the framed composition; leaving restores the editor and adapts to resize", () => {
  const { rig, dom, camera, orbit } = fixture(), position = camera.position.clone(), fov = camera.fov;
  const shot = rig.fromView(); assert.equal(rig.active, shot.id); assert.equal(orbit.enabled, false);
  close(camera.fov, fov);
  camera.position.set(99, 99, 99); rig.update(); assert.deepEqual(camera.position.toArray(), position.toArray());
  dom.clientWidth = 1200; rig.update(); rig.leave();
  assert.deepEqual(camera.position.toArray(), position.toArray()); close(camera.aspect, 2);
  close(Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect, Math.tan(THREE.MathUtils.degToRad(fov) / 2) * 4 / 3);
  assert.equal(orbit.enabled, true); rig.dispose();
});

test("invalid cameras are dropped, output size normalized, and legacy scenes have no cameras", () => {
  assert.deepEqual(parseCameras(undefined), { cameras: [], active: null });
  const invalid = { ...data(), quaternion: [0, 0, 0, 0] };
  assert.deepEqual(parseCameras({ cameras: [invalid], active: "one" }), { cameras: [], active: null });
  const parsed = parseCameras({ cameras: [{ ...data(), height: -1 }, data()], active: "missing" });
  assert.equal(parsed.cameras.length, 1); assert.equal(cameraSize(parsed.cameras[0]).h, 1024); assert.equal(parsed.active, null);
  const legacy = parseScene(JSON.stringify({ app: "tf2-workbench", version: 1, camera: { position: [0, 0, 1], target: [0, 0, 0] }, entities: [{ cls: "soldier" }] }));
  assert.deepEqual(legacy.cameras, { cameras: [], active: null });
  close(cameraProjection(data()).aspect, 1);
});

test("numeric transforms synchronize the editing gizmo and active shot, preserve other transforms, and save", () => {
  const { rig, camera } = fixture(); rig.restore({ cameras: [data()], active: null });
  rig.edit("one", "translate");
  const rotation = rig.cameras[0].quaternion.slice();
  rig.setTransform("one", { position: [12.5, -30, 99] });
  assert.deepEqual(rig.cameras[0].quaternion, rotation);
  assert.deepEqual((rig as any).pivot.position.toArray(), [12.5, -30, 99]);
  rig.setTransform("one", { rotation: [64, 0, -40.4] });
  const expected = new THREE.Quaternion().setFromEuler(new THREE.Euler(...[64, 0, -40.4].map(THREE.MathUtils.degToRad) as [number, number, number], "XYZ"));
  close((rig as any).pivot.quaternion.angleTo(expected), 0);
  rig.view("one"); rig.setTransform("one", { position: [1, 2, 3], rotation: [10, 20, 30] });
  assert.deepEqual(camera.position.toArray(), [1, 2, 3]);
  const before = rig.snapshot(); rig.setTransform("one", { position: [NaN, 2, 3] }); assert.deepEqual(rig.snapshot(), before);
  rig.restore(JSON.parse(JSON.stringify(before))); assert.deepEqual(rig.snapshot(), before);
  rig.dispose();
});

test("camera navigation advances damping before rendering and defaults off in old scenes", () => {
  const { rig, camera, orbit } = fixture(); rig.restore({ cameras: [data()], active: "one" });
  assert.equal(rig.navigatingView, false);
  rig.setNavigateView("one", true);
  orbit.update = () => { camera.position.x += 1; orbit.dispatchEvent({ type: "change" }); };
  rig.update(); rig.update();
  assert.equal(camera.position.x, 2); assert.equal(rig.cameras[0].position[0], 2);
  const parsed = parseScene(JSON.stringify({ app: "tf2-workbench", version: 1, camera: rig.editorView(), cameras: rig.snapshot(), entities: [{ cls: "soldier" }] }));
  assert.equal(parsed.cameras!.cameras[0].navigateView, true);
  rig.dispose();
});

test("overlay edit mode owns viewport input and independent camera overlays persist across scene restore", () => {
  const { rig, orbit } = fixture();
  rig.restore({ cameras: [data(), { ...data(), id: "two" }], active: "one" });
  rig.setNavigateView("one", true); rig.editOverlay("one");
  assert.equal(rig.overlayEditing, "one"); assert.equal(orbit.enabled, false); assert.equal(rig.hot, true);
  rig.update(); rig.prepareNavigation(); assert.equal(rig.active, "one"); assert.equal(orbit.enabled, false);
  rig.cameras[0].overlay = { border: { color: "#ff0000", width: .01, inset: .02, radius: 0, opacity: .7 }, elements: [{ id: "title", kind: "text", text: "Loadout", x: .5, y: .1, size: .04, opacity: 1, color: "#ffffff", bold: true }] };
  const snapshot = rig.snapshot(); snapshot.cameras[0].overlay!.elements[0].x = .2;
  assert.equal(rig.cameras[0].overlay!.elements[0].x, .5);
  const scene = parseScene(JSON.stringify({ app: "tf2-workbench", version: 1, camera: rig.editorView(), cameras: rig.snapshot(), entities: [{ cls: "soldier" }] }));
  rig.restore(scene.cameras); assert.equal(rig.overlayEditing, null);
  assert.equal(rig.cameras[0].overlay!.elements[0].x, .5); assert.equal(rig.cameras[1].overlay, undefined);
  rig.editOverlay("one"); rig.edit("two"); assert.equal(rig.overlayEditing, null); assert.equal(rig.editing, "two");
  rig.view("one"); rig.editOverlay("one"); rig.editOverlay("one");
  assert.equal(rig.overlayEditing, null); assert.equal(orbit.enabled, true);
  rig.remove("one"); assert.equal(rig.active, null); rig.dispose();
});
