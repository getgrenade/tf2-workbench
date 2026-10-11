import * as THREE from "three";
import type { TransformControls } from "three/examples/jsm/controls/TransformControls.js";

/** Gentle, positive uniform scaling; crossing the pivot cannot collapse or invert the model. */
export function uniformScaleFactor(startRadius: number, endRadius: number): number {
  if (startRadius < 1e-6) return 1;
  return Math.exp(THREE.MathUtils.clamp((endRadius - startRadius) / startRadius, -4, 4) * .35);
}

/** Shared slower sensitivity for S-key transforms. */
export function keyboardScaleFactor(dx: number, dy: number): number {
  return Math.exp(THREE.MathUtils.clamp((dx - dy) / 600, -6, 6));
}

/** Replace Three's center XYZ cube/picker with a camera-facing annulus, retaining its axis handles. */
export function configureScaleRing(control: TransformControls) {
  const internals = control as unknown as {
    _gizmo: THREE.Object3D & { gizmo: Record<string, THREE.Group>; picker: Record<string, THREE.Group>; eye: THREE.Vector3 };
    _scaleStart: THREE.Vector3; pointStart: THREE.Vector3; pointEnd: THREE.Vector3;
  };
  const gizmo = internals._gizmo;
  const handles: THREE.Mesh[] = [];
  for (const [group, width] of [[gizmo.gizmo.scale, .012], [gizmo.picker.scale, .055]] as const) {
    const ring = group.children.find(child => child.name === "XYZ") as THREE.Mesh;
    ring.geometry.dispose();
    ring.geometry = new THREE.TorusGeometry(.85, width, 8, 96);
    handles.push(ring);
  }
  const update = gizmo.updateMatrixWorld;
  gizmo.updateMatrixWorld = function(force) {
    update.call(this, force);
    const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1), gizmo.eye.clone().normalize());
    for (const ring of handles) { ring.quaternion.copy(rotation); ring.updateMatrixWorld(true); }
  };

  // Three emits change before objectChange. Adjust its raw radial ratio before the caller applies the edit.
  let moving = false;
  const move = control.pointerMove;
  control.pointerMove = function(pointer) {
    moving = true;
    try { move.call(this, pointer); } finally { moving = false; }
  };
  control.addEventListener("change", () => {
    if (!moving || !control.dragging || control.axis !== "XYZ" || control.mode !== "scale" || !control.object) return;
    control.object.scale.copy(internals._scaleStart).multiplyScalar(uniformScaleFactor(internals.pointStart.length(), internals.pointEnd.length()));
  });
}
