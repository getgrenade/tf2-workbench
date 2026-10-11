/**
 * Eye aiming, ported from hlmv `StudioModel::SetViewTarget` (hlmv/studio_render.cpp).
 *
 * The gaze target is a point 32 units in front of the model's "eyes" attachment, deflected by the
 * `eyes_updown` / `eyes_rightleft` flex controllers (degrees) and clamped to a 30 degree cone. Each
 * eyeball then looks at that one point, so the two eyes converge slightly (about 2 degrees) like hlmv's.
 * Attachment space is Source's: +x forward, +y left, +z up.
 */

/** Distance of the default gaze target in front of the eyes attachment (hlmv: `Vector( 32, 0, 0 )`). */
export const GAZE_DISTANCE = 32;

const COS_CONE = 0.866; // cos(30 degrees)

/** The gaze target in attachment space for the given eye controller values (degrees). */
export function gazeTargetLocal(eyesUpDown: number, eyesRightLeft: number): [number, number, number] {
  const rad = Math.PI / 180;
  const pitch = eyesUpDown * rad;
  const yaw = eyesRightLeft * rad;
  // AngleVectors( QAngle( pitch, yaw, 0 ) ) with the forward component dropped (eyeDeflect.x = 0).
  // The straight-ahead gaze has local.x == 1, so the deflection is not scaled down.
  let x = 1;
  let y = Math.cos(pitch) * Math.sin(yaw);
  let z = -Math.sin(pitch);
  const len = Math.hypot(x, y, z);
  x /= len;
  y /= len;
  z /= len;
  if (x < COS_CONE) {
    // Outside the 30 degree cone: keep the direction of the deflection but pin the angle to 30 degrees.
    const d = Math.hypot(y, z);
    if (d > 0) {
      const k = Math.sqrt((1 - COS_CONE * COS_CONE) / (d * d));
      [x, y, z] = [COS_CONE, y * k, z * k];
    } else {
      x = 1;
    }
  }
  return [x * GAZE_DISTANCE, y * GAZE_DISTANCE, z * GAZE_DISTANCE];
}

/**
 * The inverse of {@link gazeTargetLocal}: the eye controller values (degrees, up/down then right/left) that make the eyes look at a
 * point given in attachment space. Only the direction matters; a point behind the face gives no usable direction and keeps the
 * eyes straight ahead.
 */
export function gazeAnglesForTarget(x: number, y: number, z: number): { upDown: number; rightLeft: number } {
  if (x <= 1e-6) return { upDown: 0, rightLeft: 0 };
  const sinPitch = Math.max(-1, Math.min(1, -z / x));
  const pitch = Math.asin(sinPitch);
  const cosPitch = Math.cos(pitch);
  const sinYaw = cosPitch > 1e-6 ? Math.max(-1, Math.min(1, y / x / cosPitch)) : 0;
  const yaw = Math.asin(sinYaw);
  const deg = 180 / Math.PI;
  return { upDown: pitch * deg, rightLeft: yaw * deg };
}
