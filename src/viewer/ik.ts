import * as THREE from "three";

export interface TwoBoneResult {
  /** Where the middle joint (elbow, knee) goes. */
  mid: THREE.Vector3;
  /** Where the end of the chain (wrist, ankle) ends up: the target, or the nearest reachable point toward it. */
  end: THREE.Vector3;
  reachable: boolean;
}

const EPS = 1e-4;

/**
 * Analytic two-bone IK. The chain is `a` (root joint) - middle - end with fixed segment lengths `l1` and `l2`. The end is brought to
 * `target` (or as close as the chain reaches) and the middle joint is placed in the plane through `a`, the target and `pole`, on the
 * pole's side. `currentMid` only decides the bend direction when the pole lies on the line to the target.
 */
export function solveTwoBone(a: THREE.Vector3, currentMid: THREE.Vector3, target: THREE.Vector3, pole: THREE.Vector3, l1: number, l2: number): TwoBoneResult {
  const toTarget = new THREE.Vector3().subVectors(target, a);
  const rawDist = toTarget.length();
  const maxReach = l1 + l2 - EPS;
  const minReach = Math.abs(l1 - l2) + EPS;
  const dist = Math.min(Math.max(rawDist, minReach), maxReach);
  const u = rawDist > EPS ? toTarget.clone().divideScalar(rawDist) : new THREE.Vector3(1, 0, 0);

  // the bend direction: the pole's component perpendicular to the line to the target
  const perp = (p: THREE.Vector3) => {
    const v = new THREE.Vector3().subVectors(p, a);
    return v.addScaledVector(u, -v.dot(u));
  };
  let bend = perp(pole);
  if (bend.lengthSq() < 1e-8) bend = perp(currentMid);
  if (bend.lengthSq() < 1e-8) {
    // any direction perpendicular to u
    bend = Math.abs(u.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    bend.addScaledVector(u, -bend.dot(u));
  }
  bend.normalize();

  const cosA = Math.min(1, Math.max(-1, (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)));
  const sinA = Math.sqrt(1 - cosA * cosA);
  const mid = a.clone().addScaledVector(u, l1 * cosA).addScaledVector(bend, l1 * sinA);
  const end = a.clone().addScaledVector(u, dist);
  return { mid, end, reachable: rawDist <= maxReach && rawDist >= minReach };
}

/** The smallest rotation taking direction `from` to direction `to` (both need not be unit length). */
export function rotationBetween(from: THREE.Vector3, to: THREE.Vector3, out = new THREE.Quaternion()): THREE.Quaternion {
  const f = from.clone().normalize();
  const t = to.clone().normalize();
  if (f.lengthSq() < 0.5 || t.lengthSq() < 0.5) return out.identity();
  return out.setFromUnitVectors(f, t);
}
