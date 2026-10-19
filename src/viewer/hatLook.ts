/**
 * The lighting of a hat's promo pictures: a small studio set (a soft purple fill, a main spotlight and two rim lights behind), a fresnel-style
 * rim light, ambient occlusion and a low ambient, tuned on a Demoman's head. The lights are kept as offsets from the head bone (bip_head), so
 * they stand at the head of whichever class wears the hat, and are turned about the head with the camera so that they keep their place
 * relative to it.
 */
import type { LightState } from "./viewer";
import type { RigLight } from "./lighting";
import type { RimLightState } from "./rimLight";
import type { AoState } from "./aoMath";

/** The yaw (degrees) of the camera the set was made with: the lights keep their place relative to a camera at this yaw. */
export const HAT_LOOK_CAMERA_YAW = -26.1;

type Vec3 = [number, number, number];

/** The lights' places as offsets from the head bone (viewer units), and the rest of what makes the light. */
const HAT_LIGHTS: (Omit<RigLight, "position"> & { offset: Vec3 })[] = [
  { id: "hat-fill", name: "point_fill", type: "point", enabled: true, azimuth: 0, elevation: 20, intensity: 1.85, color: "#441d9f", offset: [6.8, 0.9, 5.76], range: 240, falloff: 2.8, cone: 45, shadows: false, shadowSoftness: 0.1 },
  { id: "hat-main", name: "spot_main", type: "spot", enabled: true, azimuth: 300.95, elevation: 32.53, intensity: 2.6, color: "#f8ddf2", offset: [-17.12, 19.28, 8.5], range: 172, falloff: 1.5, cone: 40, shadows: true, rotation: [0.780403175813919, 0.32833280251408203, 0.27046553086290936, 0.45827595462542337] },
  { id: "hat-rim1", name: "point_rim1", type: "point", enabled: true, azimuth: 0, elevation: 20, intensity: 6, color: "#3c305a", offset: [-8.23, 5.15, -18.43], range: 240, falloff: 0.2, cone: 45, shadows: false, shadowSoftness: 0.1 },
  { id: "hat-rim2", name: "point_rim2", type: "point", enabled: true, azimuth: 0, elevation: 20, intensity: 6, color: "#3c305a", offset: [14.34, 7.05, -18.43], range: 240, falloff: 0.2, cone: 45, shadows: false, shadowSoftness: 0.1 },
];

export const HAT_RIM: RimLightState = { enabled: true, allAround: false, color: "#364c53", strength: 3, width: 0.61, direction: 33, softness: 0.68, painted: true, cutoff: 0.17, edgeSoftness: 0.13 };
export const HAT_AO: AoState = { enabled: true, strength: 0.78, radius: 0.19, power: 4 };

/**
 * The lights of the set standing about `head` (the head bone's place in the scene), turned about the vertical there to suit a camera at
 * `cameraYaw` degrees (as the shot's aim has it). `base` is the light the scene has (its shadow quality is kept).
 */
export function hatLight(base: LightState, head: Vec3, cameraYaw: number): LightState {
  const turn = ((cameraYaw - HAT_LOOK_CAMERA_YAW) * Math.PI) / 180, c = Math.cos(turn), s = Math.sin(turn);
  const lights: RigLight[] = HAT_LIGHTS.map(({ offset, rotation, ...light }) => {
    const [x, y, z] = offset;
    const out: RigLight = { ...light, position: [head[0] + x * c + z * s, head[1] + y, head[2] - x * s + z * c] };
    if (rotation) {
      // the beam turns with the position: the quaternion of a turn about the vertical, times the light's own
      const h = turn / 2, qw = Math.cos(h), qy = Math.sin(h), [ax, ay, az, aw] = rotation;
      out.rotation = [qw * ax + qy * az, qw * ay + qy * aw, qw * az - qy * ax, qw * aw - qy * ay];
    }
    return out;
  });
  const rig = { shadow: base.rig?.shadow ?? { resolution: 2048, filter: 3, depthBias: 0.0005, slopeBias: 16, tint: "#000000" }, lights, selected: null, marker: false };
  return { ...base, rig, intensity: 0, ambient: 0.1, ambientColor: "#ffffff", followCamera: true };
}
