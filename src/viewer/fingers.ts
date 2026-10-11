import * as THREE from "three";

export const FINGERS = ["thumb", "index", "middle", "ring", "pinky"] as const;
export type Finger = (typeof FINGERS)[number];

/**
 * Finger poses are absolute and class independent: every finger joint closes about its own local +X axis (the same on all nine
 * classes), by an angle measured from the model's bind pose. Scanning every animation of the Soldier, Scout and Heavy gave the same
 * range on each: a joint goes from about -50 degrees (a stretched finger) to about +90..+120 (a tight fist). The bind pose sits in
 * between (a relaxed hand), at about 0.35 on the curl scale below. Joint 0 is the knuckle, 2 the tip.
 *
 * The thumb differs: its base joint (0) turns about an axis that is different on every class, so it has no curl of its own and is
 * posed by turning it directly; the curl moves its two outer joints.
 */
export interface JointRange {
  /** Degrees from the bind pose at a curl of 0 (an open, stretched finger). */
  open: number;
  /** Degrees from the bind pose at a curl of 1 (a tight fist). */
  fist: number;
}

const J = (open: number, fist: number): JointRange => ({ open, fist });
export const CURL_RANGE: Record<Finger, [JointRange, JointRange, JointRange]> = {
  thumb: [J(0, 0), J(-40, 70), J(-40, 95)],
  index: [J(-50, 88), J(-50, 100), J(-45, 112)],
  middle: [J(-50, 88), J(-50, 100), J(-45, 112)],
  ring: [J(-50, 88), J(-50, 100), J(-45, 112)],
  pinky: [J(-50, 88), J(-50, 100), J(-45, 112)],
};

/** How far past the two ends the curl may be taken (a slight over-stretch and over-clench). */
export const MIN_CURL = -0.1;
export const MAX_CURL = 1.1;

/** The angle (degrees about the hinge, from the bind pose) of a finger joint for a curl; the curl is clamped. */
export function curlAngle(finger: Finger, joint: number, curl: number): number {
  const r = CURL_RANGE[finger][joint];
  const c = Math.max(MIN_CURL, Math.min(MAX_CURL, curl));
  return r.open + c * (r.fist - r.open);
}

/** The curl at which a joint (read from its angle) sits; the inverse of {@link curlAngle} for one joint. */
export function curlFromAngle(finger: Finger, joint: number, degrees: number): number {
  const r = CURL_RANGE[finger][joint];
  return r.fist === r.open ? 0 : (degrees - r.open) / (r.fist - r.open);
}

/**
 * How many degrees the fingertip's frame turns for one unit of curl: every joint of a finger turns about parallel axes, so the
 * tip bone's rotation is the sum of the joints'. A control that follows the tip bone divides a mouse turn by this to stay in step.
 */
export function totalCurlRange(finger: Finger): number {
  return CURL_RANGE[finger].reduce((sum, r) => sum + (r.fist - r.open), 0);
}

/** The local axis the finger joints close about. */
export const FINGER_AXIS = new THREE.Vector3(1, 0, 0);
/** The local axis a knuckle spreads its finger about (across the finger's bending plane and its length, which is local Y). */
export const SPREAD_AXIS = new THREE.Vector3(0, 0, 1);

export interface HandPreset {
  name: string;
  /** Curl of thumb, index, middle, ring, pinky: 0 open (stretched), 1 a tight fist. */
  curls: [number, number, number, number, number];
}

export const HAND_PRESETS: HandPreset[] = [
  { name: "Open", curls: [0, 0, 0, 0, 0] },
  { name: "Relaxed", curls: [0.3, 0.35, 0.4, 0.45, 0.5] },
  { name: "Fist", curls: [1, 1, 1, 1, 1] },
  { name: "Point", curls: [0.6, 0, 1, 1, 1] },
  { name: "Thumbs up", curls: [0, 1, 1, 1, 1] },
];

export const boneNameOf = (finger: Finger, joint: number, side: "L" | "R") => `bip_${finger}_${joint}_${side}`;
