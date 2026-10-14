import type * as THREE from "three";
import type { Actor } from "./actor";
import type { LimbId, RigSession } from "../rig/rigSession";

/** What the viewer and the panel use of a Blender rig's controls. The web build gets `BlenderRigNone`, which does nothing (the rig code is not part of it). */
export interface BlenderRigApi {
  onSelect: (name: string | null) => void;
  onEdit: () => void;
  onModal: (text: string | null) => void;
  groups: { fingers: boolean; misc: boolean };
  readonly objects: THREE.Object3D[];
  readonly gizmoHot: boolean;
  readonly actor: Actor | null;
  readonly active: boolean;
  readonly rigSession: RigSession | null;
  readonly selected: string | null;
  setLocal(on: boolean): void;
  setShown(on: boolean): void;
  setGizmoParts(parts: { move: boolean; rotate: boolean; view: boolean }): void;
  setActor(actor: Actor | null, session?: RigSession | null): boolean;
  snap(): void;
  afterExternalChange(): void;
  update(): void;
  pick(clientX: number, clientY: number): string | null;
  hover(name: string | null): boolean;
  select(name: string | null): void;
  setIk(limb: LimbId, on: boolean): void;
  setSlider(name: string, value: number): void;
  sliders(): { name: string; value: number; min: number; max: number; step: number }[];
  setFingers(on: boolean): void;
  setMisc(on: boolean): void;
}

export class BlenderRigNone implements BlenderRigApi {
  onSelect: (name: string | null) => void = () => {};
  onEdit: () => void = () => {};
  onModal: (text: string | null) => void = () => {};
  groups = { fingers: false, misc: true };
  readonly objects: THREE.Object3D[] = [];
  readonly gizmoHot = false;
  readonly actor = null;
  readonly active = false;
  readonly rigSession = null;
  readonly selected = null;
  setLocal() {}
  setShown() {}
  setGizmoParts() {}
  setActor() { return false; }
  snap() {}
  afterExternalChange() {}
  update() {}
  pick() { return null; }
  hover() { return false; }
  select() {}
  setIk() {}
  setSlider() {}
  sliders() { return []; }
  setFingers() {}
  setMisc() {}
}
