import type { BBoneSettings } from "./bbone";

/**
 * The rig as `scripts/rig/export_rig.py` writes it: every bone with its rest pose, the constraint stacks, the drivers and the sliders. The
 * solver (`rigSolver.ts`) evaluates it the way Blender does, so a rig made there behaves the same here.
 */

export type SpaceName = "WORLD" | "POSE" | "LOCAL" | "LOCAL_WITH_PARENT" | "CUSTOM";

/** A constraint as exported: its name, type, and every plain property of it by Blender's name. */
export interface RigConstraint {
  name: string;
  type: string;
  mute: boolean;
  enabled?: boolean;
  influence: number;
  target?: string | null;
  subtarget?: string;
  pole_target?: string | null;
  pole_subtarget?: string;
  owner_space?: SpaceName;
  target_space?: SpaceName;
  head_tail?: number;
  use_bbone_shape?: boolean;
  /** The Armature constraint's targets. */
  targets?: { target: string | null; subtarget: string; weight: number }[];
  [key: string]: unknown;
}

export interface RigShapeUse {
  name: string;
  scale: number[];
  translation: number[];
  rotation: number[];
  boneSize: boolean;
  transformBone: string | null;
  wire: number;
}

export interface RigSlider {
  value: number | boolean;
  min?: number;
  max?: number;
  soft_min?: number;
  soft_max?: number;
  default?: number | boolean;
  step?: number;
}

export interface RigBone {
  name: string;
  parent: string | null;
  /** Rest matrix in armature space, 16 numbers, column major. */
  rest: number[];
  length: number;
  connect: boolean;
  inheritRotation: boolean;
  inheritScale: "FULL" | "NONE" | "FIX_SHEAR" | "ALIGNED" | "AVERAGE" | "NONE_LEGACY";
  localLocation: boolean;
  deform: boolean;
  hidden: boolean;
  collections: string[];
  rotationMode: string;
  pose: { loc: number[]; quat: number[]; euler: number[]; scale: number[] };
  lock: { loc: boolean[]; rot: boolean[]; scale: boolean[]; rotW: boolean };
  ik: { stretch: number; lock: boolean[]; limit: boolean[]; min: number[]; max: number[]; stiffness: number[] };
  bbone: BBoneSettings | { segments: number };
  shape: RigShapeUse | null;
  color: { set: string; normal: number[] | null; select: number[] | null };
  props: Record<string, RigSlider>;
  constraints: RigConstraint[];
}

export interface RigDriver {
  /** `pose.bones["X"].constraints["Y"].influence`, `...targets[1].weight` or `pose.bones["X"].hide`. */
  path: string;
  index: number;
  type: "SCRIPTED" | "SUM" | "AVERAGE" | "MIN" | "MAX";
  expression: string;
  variables: { name: string; type: string; targets: { id: string | null; path: string; bone: string; transform: string; space: string }[] }[];
}

export interface RigShape {
  verts: number[][];
  edges: number[][];
  faces: number[][];
}

export interface RigData {
  armature: string;
  blender: string;
  bones: RigBone[];
  collections: { name: string; visible: boolean; parent: string | null }[];
  drivers: RigDriver[];
  shapes: Record<string, RigShape>;
  objectProps: Record<string, unknown>;
}

export function parseRig(text: string): RigData {
  const raw = JSON.parse(text);
  if (!raw || !Array.isArray(raw.bones) || !Array.isArray(raw.drivers)) throw new Error("not a rig file");
  return raw as RigData;
}
