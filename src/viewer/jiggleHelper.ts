import * as THREE from "three";
import type { JiggleSetup } from "../compiler/jiggleBones";

/**
 * What the viewport draws on a bone being set up for jiggle: its axes (X red, Y green, Z blue: the bone points along Z), the length of the
 * spring along Z, and the constraints: the yaw range as an arc in the X-Z plane, the pitch range as an arc in the Y-Z plane, and the angle
 * limit as a cone around Z. The group is in the bone's own space; the caller puts it where the bone's animated (goal) pose is.
 */
const ARC_STEPS = 32;

function material(color: number, opacity = 1) {
  return new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false });
}

function line(points: THREE.Vector3[], color: number, opacity = 1, strip = true): THREE.Object3D {
  const object = strip ? new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material(color, opacity)) : new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), material(color, opacity));
  object.renderOrder = 1000;
  return object;
}

const rad = (degrees: number) => (degrees * Math.PI) / 180;

/** An arc of the tip's path, with the two lines out to its ends. `point` gives the tip at an angle (radians). */
function arc(point: (angle: number) => THREE.Vector3, min: number, max: number, color: number): THREE.Object3D[] {
  const from = Math.min(min, max), to = Math.max(min, max);
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= ARC_STEPS; i++) points.push(point(from + ((to - from) * i) / ARC_STEPS));
  return [line(points, color), line([new THREE.Vector3(), points[0], new THREE.Vector3(), points[points.length - 1]], color, 0.7, false)];
}

export function buildJiggleHelper(setup: JiggleSetup | null, axisLength = 6): THREE.Group {
  const group = new THREE.Group();
  const length = setup?.length ?? axisLength;
  const o = new THREE.Vector3();
  const reach = Math.max(axisLength, 3);
  group.add(
    line([o, new THREE.Vector3(reach, 0, 0)], 0xff4444),
    line([o, new THREE.Vector3(0, reach, 0)], 0x44dd44),
    line([o, new THREE.Vector3(0, 0, reach)], 0x5588ff),
  );
  if (!setup) return group;
  // the spring: from the bone along Z to where its tip rests
  group.add(line([o, new THREE.Vector3(0, 0, length)], 0xffffff, 0.9));
  const tip = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.4, length * 0.05), 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.9 }));
  tip.position.set(0, 0, length);
  tip.renderOrder = 1000;
  group.add(tip);
  if (setup.yaw.on) group.add(...arc((a) => new THREE.Vector3(Math.sin(a) * length, 0, Math.cos(a) * length), rad(setup.yaw.min), rad(setup.yaw.max), 0x44dd88));
  if (setup.pitch.on) group.add(...arc((a) => new THREE.Vector3(0, Math.sin(a) * length, Math.cos(a) * length), rad(setup.pitch.min), rad(setup.pitch.max), 0xff7744));
  if (setup.angle.on) {
    const theta = rad(setup.angle.limit);
    const ring: THREE.Vector3[] = [];
    for (let i = 0; i <= ARC_STEPS; i++) {
      const phi = (Math.PI * 2 * i) / ARC_STEPS;
      ring.push(new THREE.Vector3(Math.sin(theta) * Math.cos(phi) * length, Math.sin(theta) * Math.sin(phi) * length, Math.cos(theta) * length));
    }
    group.add(line(ring, 0xffd34d));
    const spokes: THREE.Vector3[] = [];
    for (let i = 0; i < 8; i++) spokes.push(o, ring[(i * ARC_STEPS) / 8]);
    group.add(line(spokes, 0xffd34d, 0.45, false));
  }
  return group;
}

/** Frees what a helper group holds. */
export function disposeHelper(group: THREE.Object3D) {
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const material = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) material.forEach((x) => x.dispose()); else material?.dispose();
  });
}
