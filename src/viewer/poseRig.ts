import * as THREE from "three";
import type { Finger } from "./fingers";
import type { ClipData } from "./payload";
import { isAppFile } from "../appFile";

/** Which side of the body a control belongs to (its colour and mirror partner). */
export type Side = "L" | "R" | "C";

/**
 * What a control does: turn one bone (fk), bend the whole spine (spine), move and turn the whole body by its pelvis (pelvis), place an
 * IK target or pole, or aim the eyes.
 */
export type ControlKind = "fk" | "spine" | "pelvis" | "ik" | "pole" | "eye" | "finger" | "tip";

export type LimbId = "armL" | "armR" | "legL" | "legR";

/** A limb that can be solved with IK: root joint, middle joint and end bone, with the controls that go with it. */
export interface LimbDef {
  id: LimbId;
  label: string;
  side: "L" | "R";
  /** Upper arm / thigh, forearm / shin, hand / foot. */
  bones: [string, string, string];
  /** The FK rings that are hidden while the limb is in IK. */
  rings: string[];
  /** Which way the middle joint points when the limb is straight (the elbow back, the knee forward), in model space (x forward, y left, z up). */
  bend: [number, number, number];
}

export const LIMBS: LimbDef[] = [
  { id: "armL", label: "Left arm", side: "L", bones: ["bip_upperArm_L", "bip_lowerArm_L", "bip_hand_L"], rings: ["upperArmL", "lowerArmL", "handL"], bend: [-1, 0, 0] },
  { id: "armR", label: "Right arm", side: "R", bones: ["bip_upperArm_R", "bip_lowerArm_R", "bip_hand_R"], rings: ["upperArmR", "lowerArmR", "handR"], bend: [-1, 0, 0] },
  { id: "legL", label: "Left leg", side: "L", bones: ["bip_hip_L", "bip_knee_L", "bip_foot_L"], rings: ["hipL", "kneeL", "footL"], bend: [1, 0, 0] },
  { id: "legR", label: "Right leg", side: "R", bones: ["bip_hip_R", "bip_knee_R", "bip_foot_R"], rings: ["hipR", "kneeR", "footR"], bend: [1, 0, 0] },
];

export const limbOfRing = (ringId: string): LimbDef | undefined => LIMBS.find((l) => l.rings.includes(ringId));

/** One control of the rig. Data only; `rigOverlay.ts` draws and picks them. */
export interface ControlDef {
  id: string;
  label: string;
  /**
   * `spine` is the body core (head, neck, spine, pelvis); `spinebones` the individual spine bones and the chest, hidden by default
   * in favour of the one spine control; `detail` the secondary `prp_` bones (pouches, grenades, coat and collar pieces); `weapon`
   * the `weapon_` bones the held weapon is attached to; `prop` the `prop_` bones that taunt props are attached to.
   */
  group: "spine" | "spinebones" | "detail" | "weapon" | "prop" | "fingers" | "fingerbones" | "arm" | "leg" | "face";
  side: Side;
  kind: ControlKind;
  /** The bone it rotates. */
  bone: string;
  /** The bone its ring points toward (the ring stands across the segment between the two). */
  aim: string | null;
  /** Ring radius in Source units. */
  radius: number;
  /** The control can also be moved (it has a move gizmo, and G), not only turned: the secondary `prp_` bones. */
  movable?: boolean;
  /** The control's gizmo takes the bone's own rotation exactly (every joint of a finger, the secondary bones). */
  boneFrame?: boolean;
  /** A finger control (kind "finger"): which finger of which hand it curls. */
  finger?: { side: "L" | "R"; name: Finger };
}

/**
 * The FK controls for the `bip_*` body skeleton all nine classes share: pelvis, spine, neck, head, collars, arms, legs and feet.
 * Fingers and the secondary `prp_*` bones are left to the animation for now.
 */
export const BODY_CONTROLS: ControlDef[] = [
  { id: "pelvis", label: "Pelvis", group: "spine", side: "C", kind: "pelvis", bone: "bip_pelvis", aim: "bip_spine_0", radius: 13 },
  { id: "spine0", label: "Spine 1", group: "spinebones", side: "C", kind: "fk", bone: "bip_spine_0", aim: "bip_spine_1", radius: 8 },
  { id: "spine1", label: "Spine 2", group: "spinebones", side: "C", kind: "fk", bone: "bip_spine_1", aim: "bip_spine_2", radius: 9 },
  { id: "spine2", label: "Spine 3", group: "spinebones", side: "C", kind: "fk", bone: "bip_spine_2", aim: "bip_spine_3", radius: 10 },
  { id: "spine3", label: "Chest", group: "spinebones", side: "C", kind: "fk", bone: "bip_spine_3", aim: "bip_neck", radius: 11 },
  { id: "neck", label: "Neck", group: "spine", side: "C", kind: "fk", bone: "bip_neck", aim: "bip_head", radius: 4.5 },
  { id: "head", label: "Head", group: "spine", side: "C", kind: "fk", bone: "bip_head", aim: null, radius: 7 },
  { id: "collarL", label: "Collar", group: "arm", side: "L", kind: "fk", bone: "bip_collar_L", aim: "bip_upperArm_L", radius: 3.5 },
  { id: "collarR", label: "Collar", group: "arm", side: "R", kind: "fk", bone: "bip_collar_R", aim: "bip_upperArm_R", radius: 3.5 },
  { id: "upperArmL", label: "Upper arm", group: "arm", side: "L", kind: "fk", bone: "bip_upperArm_L", aim: "bip_lowerArm_L", radius: 4.5 },
  { id: "upperArmR", label: "Upper arm", group: "arm", side: "R", kind: "fk", bone: "bip_upperArm_R", aim: "bip_lowerArm_R", radius: 4.5 },
  { id: "lowerArmL", label: "Forearm", group: "arm", side: "L", kind: "fk", bone: "bip_lowerArm_L", aim: "bip_hand_L", radius: 4 },
  { id: "lowerArmR", label: "Forearm", group: "arm", side: "R", kind: "fk", bone: "bip_lowerArm_R", aim: "bip_hand_R", radius: 4 },
  { id: "handL", label: "Hand", group: "arm", side: "L", kind: "fk", bone: "bip_hand_L", aim: "bip_middle_0_L", radius: 3.5 },
  { id: "handR", label: "Hand", group: "arm", side: "R", kind: "fk", bone: "bip_hand_R", aim: "bip_middle_0_R", radius: 3.5 },
  { id: "hipL", label: "Thigh", group: "leg", side: "L", kind: "fk", bone: "bip_hip_L", aim: "bip_knee_L", radius: 6 },
  { id: "hipR", label: "Thigh", group: "leg", side: "R", kind: "fk", bone: "bip_hip_R", aim: "bip_knee_R", radius: 6 },
  { id: "kneeL", label: "Shin", group: "leg", side: "L", kind: "fk", bone: "bip_knee_L", aim: "bip_foot_L", radius: 5 },
  { id: "kneeR", label: "Shin", group: "leg", side: "R", kind: "fk", bone: "bip_knee_R", aim: "bip_foot_R", radius: 5 },
  { id: "footL", label: "Foot", group: "leg", side: "L", kind: "fk", bone: "bip_foot_L", aim: "bip_toe_L", radius: 4 },
  { id: "footR", label: "Foot", group: "leg", side: "R", kind: "fk", bone: "bip_foot_R", aim: "bip_toe_R", radius: 4 },
  { id: "toeL", label: "Toes", group: "leg", side: "L", kind: "fk", bone: "bip_toe_L", aim: null, radius: 2.6 },
  { id: "toeR", label: "Toes", group: "leg", side: "R", kind: "fk", bone: "bip_toe_R", aim: null, radius: 2.6 },
];

/** "prp_coat_front_1_L" -> "Coat front 1 L" ("prp_" is dropped; `keepPrefix` keeps "weapon_bone_L" as "Weapon bone L"). */
export function prettyBoneName(name: string, keepPrefix = false): string {
  const words = (keepPrefix ? name : name.replace(/^prp_/i, "")).split("_").filter(Boolean);
  const side = words.length && /^[LR]$/i.test(words[words.length - 1]) ? words.pop()!.toUpperCase() : "";
  const text = words.join(" ");
  return ((text.charAt(0).toUpperCase() + text.slice(1)) + (side ? " " + side : "")).trim();
}

/**
 * Movable FK controls for a family of secondary bones: those whose name matches `pattern`, placed in `group`. `parents` is the
 * skeleton's parent index per bone. The ring of each stands across the segment to its first child in the family, when it has one.
 */
function familyControls(boneNames: string[], parents: number[], pattern: RegExp, group: ControlDef["group"], keepPrefix: boolean): ControlDef[] {
  const out: ControlDef[] = [];
  boneNames.forEach((name, i) => {
    if (!pattern.test(name)) return;
    const side: Side = /_L$/i.test(name) ? "L" : /_R$/i.test(name) ? "R" : "C";
    const child = boneNames.findIndex((_, c) => parents[c] === i && pattern.test(boneNames[c]));
    out.push({ id: `${group}:${name}`, label: prettyBoneName(name, keepPrefix), group, side, kind: "fk", bone: name, aim: child >= 0 ? boneNames[child] : null, radius: 2.2, movable: true });
  });
  return out;
}

/** Controls for the `prp_` bones (pouches, grenades, parts of the coat and collar; what exists depends on the class). */
export const prpControls = (names: string[], parents: number[]) => familyControls(names, parents, /^prp_/i, "detail", false);
/** Controls for the `weapon_` bones the held weapon rides on. */
export const weaponControls = (names: string[], parents: number[]) => familyControls(names, parents, /^weapon_/i, "weapon", true);
/** Controls for the `prop_` bones that taunt props are attached to. */
export const propControls = (names: string[], parents: number[]) => familyControls(names, parents, /^prop_/i, "prop", true);

/**
 * One curl control per finger of each hand that has the finger bones: a small ring across the finger's middle joint; turning it
 * about the finger's hinge curls the whole finger (every joint of it, by its share of the full curl).
 */
export function fingerControls(boneNames: string[]): ControlDef[] {
  const FINGERS: readonly Finger[] = ["thumb", "index", "middle", "ring", "pinky"];
  const boneNameOf = (finger: Finger, joint: number, side: "L" | "R") => `bip_${finger}_${joint}_${side}`;
  const have = new Set(boneNames.map((n) => n.toLowerCase()));
  const out: ControlDef[] = [];
  for (const side of ["L", "R"] as const) {
    for (const name of FINGERS) {
      const mid = boneNameOf(name, 1, side);
      const tip = boneNameOf(name, 2, side);
      if (!have.has(mid.toLowerCase()) || !have.has(tip.toLowerCase())) continue;
      out.push({
        id: `finger:${name}_${side}`,
        label: `${name[0].toUpperCase() + name.slice(1)} ${side}`,
        group: "fingers",
        side,
        kind: "finger",
        bone: mid,
        aim: tip,
        radius: 0.9,
        finger: { side, name },
      });
    }
  }
  return out;
}

/**
 * One base (knuckle) control per finger: it turns the first bone of the finger, which carries the whole finger with it (spread it,
 * twist it, tilt it at the hand). Its gizmo takes the bone's own rotation, like the joint controls.
 */
export function fingerBaseControls(boneNames: string[]): ControlDef[] {
  const have = new Set(boneNames.map((n) => n.toLowerCase()));
  const out: ControlDef[] = [];
  for (const side of ["L", "R"] as const) {
    for (const name of ["thumb", "index", "middle", "ring", "pinky"] as const) {
      const base = `bip_${name}_0_${side}`;
      const next = `bip_${name}_1_${side}`;
      if (!have.has(base.toLowerCase()) || !have.has(next.toLowerCase())) continue;
      out.push({
        id: `base:${name}_${side}`,
        label: `${name[0].toUpperCase() + name.slice(1)} base ${side}`,
        group: "fingers",
        side,
        kind: "fk",
        bone: base,
        aim: next,
        radius: 0.8,
        boneFrame: true,
      });
    }
  }
  return out;
}

/**
 * One tip control per finger: a small diamond on the fingertip. Moving it moves the tip, and the finger follows (its joints curl and
 * the knuckle spreads it sideways, see Actor.solveFingerTip).
 */
export function fingerTipControls(boneNames: string[]): ControlDef[] {
  const have = new Set(boneNames.map((n) => n.toLowerCase()));
  const out: ControlDef[] = [];
  for (const side of ["L", "R"] as const) {
    for (const name of ["thumb", "index", "middle", "ring", "pinky"] as const) {
      const tip = `bip_${name}_2_${side}`;
      if (!have.has(tip.toLowerCase()) || !have.has(`bip_${name}_1_${side}`.toLowerCase()) || !have.has(`bip_${name}_0_${side}`.toLowerCase())) continue;
      out.push({
        id: `tip:${name}_${side}`,
        label: `${name[0].toUpperCase() + name.slice(1)} tip ${side}`,
        group: "fingers",
        side,
        kind: "tip",
        bone: tip,
        aim: null,
        radius: 0.9,
        finger: { side, name },
      });
    }
  }
  return out;
}

/**
 * One FK control for every finger bone of each hand (three joints per finger), for fine tuning beyond the curl control. Each is a
 * small diamond sitting on its joint; its gizmo takes the joint's own frame, so the X ring is the usual hinge.
 */
export function fingerBoneControls(boneNames: string[]): ControlDef[] {
  const have = new Set(boneNames.map((n) => n.toLowerCase()));
  const out: ControlDef[] = [];
  for (const side of ["L", "R"] as const) {
    for (const finger of ["thumb", "index", "middle", "ring", "pinky"]) {
      for (let joint = 0; joint < 3; joint++) {
        const bone = `bip_${finger}_${joint}_${side}`;
        if (!have.has(bone.toLowerCase())) continue;
        const next = `bip_${finger}_${joint + 1}_${side}`;
        out.push({
          id: `fb:${bone}`,
          label: `${finger[0].toUpperCase() + finger.slice(1)} ${joint + 1} ${side}`,
          group: "fingerbones",
          side,
          kind: "fk",
          bone,
          aim: have.has(next.toLowerCase()) ? next : null,
          radius: 0.8,
          boneFrame: true,
        });
      }
    }
  }
  return out;
}

/** The controls whose bone (and aim bone, when it has one) exist in a skeleton. */
export function controlsFor(boneNames: string[]): ControlDef[] {
  const have = new Set(boneNames.map((n) => n.toLowerCase()));
  return BODY_CONTROLS.filter((c) => have.has(c.bone.toLowerCase()) && (!c.aim || have.has(c.aim.toLowerCase())));
}

/** The control on the other side of the body (`upperArmL` <-> `upperArmR`), or null for central ones. */
export function mirrorId(id: string): string | null {
  if (/L$/.test(id)) return id.slice(0, -1) + "R";
  if (/R$/.test(id)) return id.slice(0, -1) + "L";
  return null;
}

/** The pose of every bone: local positions (x y z) and rotations (x y z w), in the order of the skeleton. */
export interface PoseData {
  scale?: Float32Array;
  pos: Float32Array;
  quat: Float32Array;
}

export function clonePose(p: PoseData): PoseData {
  return { pos: p.pos.slice(), quat: p.quat.slice(), ...(p.scale ? { scale: p.scale.slice() } : {}) };
}

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();

/** The local pose of every bone at a (fractional) frame of a clip: positions lerped, rotations slerped, like playback. */
export function sampleClip(clip: ClipData, frame: number): PoseData {
  const nb = clip.numBones;
  const last = clip.frames - 1;
  const f = Math.min(Math.max(frame, 0), last);
  const i0 = Math.floor(f);
  const i1 = Math.min(i0 + 1, last);
  const s = f - i0;
  const pos = new Float32Array(nb * 3);
  const quat = new Float32Array(nb * 4);
  for (let b = 0; b < nb; b++) {
    for (let k = 0; k < 3; k++) {
      const a = clip.pos[(i0 * nb + b) * 3 + k];
      const c = clip.pos[(i1 * nb + b) * 3 + k];
      pos[b * 3 + k] = a + (c - a) * s;
    }
    const qa = (i0 * nb + b) * 4;
    const qc = (i1 * nb + b) * 4;
    _qa.set(clip.quat[qa], clip.quat[qa + 1], clip.quat[qa + 2], clip.quat[qa + 3]);
    if (s > 0 && i1 !== i0) {
      _qb.set(clip.quat[qc], clip.quat[qc + 1], clip.quat[qc + 2], clip.quat[qc + 3]);
      _qa.slerp(_qb, s);
    }
    quat.set([_qa.x, _qa.y, _qa.z, _qa.w], b * 4);
  }
  const scale = clip.scale ? new Float32Array(nb * 3) : undefined;
  if (scale && clip.scale) for (let k = 0; k < scale.length; k++) {
    const a = clip.scale[i0 * nb * 3 + k], b = clip.scale[i1 * nb * 3 + k];
    scale[k] = a + (b - a) * s;
  }
  return { pos, quat, ...(scale?.some(value => value !== 1) ? { scale } : {}) };
}

/** A one-frame clip holding a pose, so it plays through the same path as any animation. */
export function poseToClip(p: PoseData): ClipData {
  return { fps: 30, looping: false, frames: 1, numBones: p.pos.length / 3, pos: p.pos, quat: p.quat, ...(p.scale ? { scale: p.scale } : {}) };
}

/**
 * The new local rotation of a bone after turning it by `delta` (a rotation in the frame the bone's parent is expressed in, which
 * is the model's Source space for a character): the bone's world rotation is `delta` applied on top, then taken back into the
 * parent's frame.
 */
export function rotateBoneLocal(parentWorld: THREE.Quaternion, startWorld: THREE.Quaternion, delta: THREE.Quaternion, out = new THREE.Quaternion()): THREE.Quaternion {
  out.copy(delta).multiply(startWorld); // new world rotation
  return out.premultiply(_qa.copy(parentWorld).invert()).normalize();
}

/** Undo and redo of pose edits, as snapshots of the whole pose (a skeleton is only a few hundred numbers). */
export class PoseHistory {
  private undoStack: PoseData[] = [];
  private redoStack: PoseData[] = [];

  private readonly limit: number;

  constructor(limit = 100) {
    this.limit = limit;
  }

  /** Call with the pose as it is before an edit. */
  record(before: PoseData) {
    this.undoStack.push(clonePose(before));
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** The pose to go back to (given the current one, which becomes the redo step), or null. */
  undo(current: PoseData): PoseData | null {
    const p = this.undoStack.pop();
    if (!p) return null;
    this.redoStack.push(clonePose(current));
    return p;
  }

  redo(current: PoseData): PoseData | null {
    const p = this.redoStack.pop();
    if (!p) return null;
    this.undoStack.push(clonePose(current));
    return p;
  }

  /** Drops the newest undo step without making it redoable (an edit that was cancelled). */
  discard() {
    this.undoStack.pop();
  }

  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}

/** A pose as saved: bone names make it reusable on any skeleton that has them. */
/** A saved pose is either the whole skeleton ("pose") or just the fingers of one hand ("hand"). */
export type PoseKind = "pose" | "hand";

export interface PoseFile {
  scale?: number[];
  app: "tf2-workbench";
  kind: PoseKind;
  version: 1;
  /** Model the pose was made on (`soldier`). */
  model: string;
  bones: string[];
  /** Local positions (3 per bone); empty for a hand pose, which holds rotations only. */
  pos: number[];
  quat: number[];
  /** The hand a hand pose was captured from. */
  hand?: "L" | "R";
  /** A small image of the pose (a WebP data URL) for the library. */
  thumb?: string;
  /** Where it started, for reference. */
  source?: { sequence: string | null; frame: number };
  /** The weapon the character held (an item id), or null for none; absent in poses saved before this (those leave the weapon alone). */
  weapon?: number | null;
}

/** Five decimals are plenty for a rotation or a position and keep the files small. */
const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

export function toPoseFile(model: string, bones: string[], p: PoseData, source?: PoseFile["source"], thumb?: string, weapon?: number | null): PoseFile {
  return { app: "tf2-workbench", kind: "pose", version: 1, model, bones, pos: Array.from(p.pos, round5), quat: Array.from(p.quat, round5), ...(p.scale ? { scale: Array.from(p.scale, round5) } : {}), source, thumb, weapon };
}

/** The finger bones (three joints of five fingers) of a hand. */
const FINGER_BONE = /^bip_(thumb|index|middle|ring|pinky)_[0-2]_(l|r)$/i;
export const isFingerBone = (name: string, side?: "L" | "R") => {
  const m = FINGER_BONE.exec(name);
  return !!m && (!side || m[2].toUpperCase() === side);
};

/** A hand pose: the rotation of every finger bone of one hand. */
export function toHandFile(model: string, bones: string[], p: PoseData, side: "L" | "R", thumb?: string): PoseFile {
  const names: string[] = [];
  const quat: number[] = [];
  const scale: number[] = [];
  bones.forEach((name, b) => {
    if (!isFingerBone(name, side)) return;
    names.push(name);
    quat.push(...Array.from(p.quat.subarray(b * 4, b * 4 + 4), round5));
    if (p.scale) scale.push(...Array.from(p.scale.subarray(b * 3, b * 3 + 3), round5));
  });
  return { app: "tf2-workbench", kind: "hand", version: 1, model, bones: names, pos: [], quat, ...(p.scale ? { scale } : {}), hand: side, thumb };
}

/**
 * Puts a hand pose on the fingers of one hand of a pose, by bone name (the hand it was captured from does not matter: left and right finger
 * bones have the same local rotations in their bind pose, as the rig mirrors the hands through the bones' parents, so a rotation read from
 * one hand is its mirror image on the other). Nothing but the fingers of that hand changes. Returns the new pose and the bones changed.
 */
export function applyHandFile(file: PoseFile, boneNames: string[], base: PoseData, side: "L" | "R"): { pose: PoseData; changed: number } {
  const pose = clonePose(base);
  const index = new Map(boneNames.map((n, i) => [n.toLowerCase(), i]));
  let changed = 0;
  file.bones.forEach((name, i) => {
    const target = index.get(name.slice(0, -1).toLowerCase() + side.toLowerCase());
    if (target === undefined) return;
    for (let k = 0; k < 4; k++) pose.quat[target * 4 + k] = file.quat[i * 4 + k];
    if (file.scale) {
      pose.scale ??= new Float32Array(pose.pos.length).fill(1);
      for (let k = 0; k < 3; k++) pose.scale[target * 3 + k] = file.scale[i * 3 + k];
    }
    changed++;
  });
  return { pose, changed };
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Parses and checks the text of a pose file; throws with a short reason when it is not a valid pose. */
export function parsePoseFile(text: string): PoseFile {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("not a pose file (invalid JSON)");
  }
  if (!raw || !isAppFile(raw.app) || (raw.kind !== "pose" && raw.kind !== "hand")) throw new Error("not a TF2 Workbench pose");
  if (raw.version !== 1) throw new Error(`pose version ${String(raw.version)} is not supported`);
  const n = Array.isArray(raw.bones) ? raw.bones.length : 0;
  if (n === 0 || !raw.bones.every((b: unknown) => typeof b === "string")) throw new Error("the pose has no bones");
  const hand = raw.kind === "hand";
  if (!Array.isArray(raw.pos) || raw.pos.length !== (hand ? 0 : n * 3) || !raw.pos.every(isNum)) throw new Error("the pose has bad positions");
  if (!Array.isArray(raw.quat) || raw.quat.length !== n * 4 || !raw.quat.every(isNum)) throw new Error("the pose has bad rotations");
  if (raw.scale !== undefined && (!Array.isArray(raw.scale) || raw.scale.length !== n * 3 || !raw.scale.every((v: unknown) => isNum(v) && v >= .009999 && v <= 100))) throw new Error("the pose has bad scales");
  return {
    app: "tf2-workbench",
    kind: raw.kind,
    version: 1,
    model: typeof raw.model === "string" ? raw.model : "",
    hand: raw.hand === "L" || raw.hand === "R" ? raw.hand : undefined,
    thumb: typeof raw.thumb === "string" && raw.thumb.startsWith("data:image/") ? raw.thumb : undefined,
    bones: raw.bones,
    pos: raw.pos,
    quat: raw.quat,
    ...(raw.scale ? { scale: raw.scale } : {}),
    weapon: raw.weapon === null ? null : isNum(raw.weapon) ? raw.weapon : undefined,
    source: raw.source && typeof raw.source === "object" ? { sequence: typeof raw.source.sequence === "string" ? raw.source.sequence : null, frame: isNum(raw.source.frame) ? raw.source.frame : 0 } : undefined,
  };
}

/**
 * The pose of a skeleton from a pose file, matching bones by name; bones the file lacks keep their value in `fallback`. Returns the
 * pose and how many of the skeleton's bones were found in the file.
 */
export function poseForSkeleton(file: PoseFile, boneNames: string[], fallback: PoseData): { pose: PoseData; matched: number } {
  const index = new Map(file.bones.map((n, i) => [n.toLowerCase(), i]));
  const pose = clonePose(fallback);
  let matched = 0;
  boneNames.forEach((name, b) => {
    const i = index.get(name.toLowerCase());
    if (i === undefined) return;
    matched++;
    for (let k = 0; k < 3; k++) pose.pos[b * 3 + k] = file.pos[i * 3 + k];
    for (let k = 0; k < 4; k++) pose.quat[b * 4 + k] = file.quat[i * 4 + k];
    if (file.scale || pose.scale) {
      pose.scale ??= new Float32Array(pose.pos.length).fill(1);
      for (let k = 0; k < 3; k++) pose.scale[b * 3 + k] = file.scale?.[i * 3 + k] ?? 1;
    }
  });
  return { pose, matched };
}
