import * as THREE from "three";

/**
 * Turning the axes of a bone. A jiggle bone's numbers are all relative to its own axes (it points along Z, yaw swings it around Y,
 * pitch around X), and an artist's model has whatever axes its exporter gave the bone. The rest pose is the only pose an item has, so a
 * bone's axes can be turned without moving anything: the bone is turned and its children's offsets are made up for it, while the
 * vertices stay where they are (they are in the world of the rest pose). The turn is given in degrees about the bone's own X, Y and Z.
 */
export type BoneTurn = [number, number, number];

const euler = new THREE.Euler();

/** The matrix of a turn (degrees, about X, then Y, then Z of the bone's own axes). */
export function turnMatrix(turn: BoneTurn, out = new THREE.Matrix4()): THREE.Matrix4 {
  return out.makeRotationFromEuler(euler.set((turn[0] * Math.PI) / 180, (turn[1] * Math.PI) / 180, (turn[2] * Math.PI) / 180, "XYZ"));
}

export const isIdentityTurn = (turn: BoneTurn | undefined) => !turn || (turn[0] === 0 && turn[1] === 0 && turn[2] === 0);

/** A bone's bind transform (world) with its axes turned: the same place, another orientation. */
export function turnedWorld(world: THREE.Matrix4, turn: BoneTurn | undefined, out = new THREE.Matrix4()): THREE.Matrix4 {
  if (isIdentityTurn(turn)) return out.copy(world);
  return out.copy(world).multiply(turnMatrix(turn!));
}

/**
 * The turn that points a bone's Z axis at a point, the smallest one (a rotation about the axis between where Z points now and where it
 * should): what "aim at the child" does. \`world\` is the bone's bind transform, \`target\` a point in the same space.
 */
export function aimTurn(world: THREE.Matrix4, target: THREE.Vector3): BoneTurn {
  const position = new THREE.Vector3().setFromMatrixPosition(world);
  const direction = target.clone().sub(position);
  if (direction.lengthSq() < 1e-12) return [0, 0, 0];
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(world);
  // the wanted direction in the bone's own frame
  return turnTowards(direction.applyQuaternion(quaternion.clone().invert()));
}

const _towardsQ = new THREE.Quaternion();
const _towardsE = new THREE.Euler();
const _towardsD = new THREE.Vector3();
const _Z = new THREE.Vector3(0, 0, 1);

/** The turn (degrees, to 0.01, no roll) that points a bone's +Z along `local`, a direction in the bone's own frame. */
export function turnTowards(local: THREE.Vector3): BoneTurn {
  const d = _towardsD.copy(local);
  if (d.lengthSq() < 1e-12) return [0, 0, 0];
  _towardsQ.setFromUnitVectors(_Z, d.normalize());
  _towardsE.setFromQuaternion(_towardsQ, "XYZ");
  const round = (v: number) => Math.round(((v * 180) / Math.PI) * 100) / 100;
  return [round(_towardsE.x), round(_towardsE.y), round(_towardsE.z)];
}
