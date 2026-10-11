import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { configureScaleRing } from "./scaleGizmo";
import { toolOfCode } from "../hotkeys";

/**
 * The transform gizmos of the viewer (characters, cameras, lights, the controls of a pose) are all built here: one definition of what
 * each kind looks like, one way to create it and wire it, one drag rule. The owners keep what is theirs: what a drag changes and when
 * a gizmo is shown.
 *
 *   move       the axis arrows (and the plane squares, in profiles that keep them)
 *   rotate     the axis rings
 *   scale      the scale handles
 *   view       the ring about the line of sight
 *   viewMove   the centre handle: moves in the screen plane
 */
export type GizmoRole = "move" | "rotate" | "scale" | "view" | "viewMove";

/** When pick areas overlap, the first of these that is under the pointer takes the drag. */
const PRIORITY: GizmoRole[] = ["scale", "viewMove", "move", "rotate", "view"];

const MODE = { move: "translate", viewMove: "translate", rotate: "rotate", view: "rotate", scale: "scale" } as const;

export interface GizmoProfile {
  size: Record<GizmoRole, number>;
  /** The handles taken off a gizmo: the ones that sit on top of the controls around it, or belong to another role. */
  strip: Record<GizmoRole, string[]>;
  space: Record<GizmoRole, "world" | "local">;
  /** Draws the view ring with a thicker line. */
  thickViewRing?: boolean;
}

const VIEW_MOVE_STRIP = ["X", "Y", "Z", "XY", "YZ", "XZ"];
const VIEW_STRIP = ["XYZE", "X", "Y", "Z"];

/**
 * The size of each gizmo, the same wherever it shows (a character, a camera, a light, a pose control). Sizes are fractions of the view.
 * The view ring is drawn half as large again as the axis rings at equal size (radius 0.75 against 0.5), so it is a little larger than
 * the rotate gizmo to sit outside it.
 */
export const GIZMO_SIZE: Record<GizmoRole, number> = { move: 0.55, rotate: 1.2, scale: 0.9, view: 1.0, viewMove: 0.45 };

/** Characters, cameras and lights: the gizmo around one thing in the scene. */
export const SCENE_PROFILE: GizmoProfile = {
  size: GIZMO_SIZE,
  strip: { move: [], rotate: ["XYZE", "E"], scale: [], view: VIEW_STRIP, viewMove: VIEW_MOVE_STRIP },
  space: { move: "world", rotate: "world", scale: "local", view: "world", viewMove: "world" },
  thickViewRing: true,
};

/** The controls of a pose: the same gizmos, with the handles that would sit on top of the controls around them taken off. */
export const COMPACT_PROFILE: GizmoProfile = {
  size: GIZMO_SIZE,
  strip: { move: ["XYZ", "XY", "YZ", "XZ"], rotate: ["XYZE", "E"], scale: ["XY", "YZ", "XZ"], view: VIEW_STRIP, viewMove: VIEW_MOVE_STRIP },
  space: { move: "world", rotate: "world", scale: "local", view: "world", viewMove: "world" },
  thickViewRing: true,
};

export interface GizmoContext {
  camera: THREE.Camera;
  dom: HTMLElement;
  scene: THREE.Scene;
}

type GizmoParts = { _gizmo?: { helper?: Record<string, THREE.Object3D>; gizmo?: Record<string, THREE.Object3D>; picker?: Record<string, THREE.Object3D> } };

/**
 * Removes the guide lines a transform gizmo draws while it is dragged (the white line across the whole view). The gizmo keeps them
 * in the `helper` groups of its internal `_gizmo` object; emptying those groups leaves the handles themselves untouched.
 */
export function hideGuideLines(t: TransformControls) {
  const helper = (t as unknown as GizmoParts)._gizmo?.helper;
  if (helper) for (const group of Object.values(helper)) group.clear();
}

/** Gives a rotate gizmo's ring a thicker line: its torus is replaced by one with a bigger tube (`radius` as the gizmo draws it). */
export function thickenRing(t: TransformControls, name: string, radius: number, tube: number) {
  const ring = (t as unknown as GizmoParts)._gizmo?.gizmo?.rotate?.children.find((c) => c.name === name) as THREE.Mesh | undefined;
  if (!ring) return;
  ring.geometry.dispose();
  ring.geometry = new THREE.TorusGeometry(radius, tube, 6, 96);
}

/**
 * Removes the named handles (and their pick areas) from a transform gizmo. The rotate gizmo's trackball sphere and outer view ring
 * and the move gizmo's centre box and plane squares sit right on top of the controls, so clicks meant for a control landed on the
 * gizmo; the axis handles alone leave the middle free.
 */
export function removeHandles(t: TransformControls, mode: "rotate" | "translate" | "scale", names: string[]) {
  const g = (t as unknown as GizmoParts)._gizmo;
  for (const group of [g?.gizmo?.[mode], g?.picker?.[mode]]) {
    if (!group) continue;
    for (const child of [...group.children]) if (names.includes(child.name)) group.remove(child);
  }
}

/** One pointer drag must belong to one transform, even where picking areas overlap. */
export function exclusiveGizmoDrag(dom: HTMLElement, controls: () => TransformControls[], restore: () => void) {
  dom.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const all = controls();
    const picked = all.find((control) => control.enabled && control.axis !== null);
    if (!picked) return;
    for (const control of all) if (control !== picked) control.enabled = false;
    const finish = () => {
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("pointercancel", finish, true);
      queueMicrotask(restore);
    };
    window.addEventListener("pointerup", finish, true);
    window.addEventListener("pointercancel", finish, true);
  }, true);
}

/**
 * The keys of the gizmos, as in Unity, Unreal, Maya and most other 3D tools: W move, E rotate, R scale (they can be changed in the
 * Settings). The key alone picks the tool;
 * Shift + the key starts the same edit by mouse alone (axes with X / Y / Z, click or Enter to confirm, Esc to cancel) and Alt + the
 * key puts the selection's position, rotation or scale back. Keyed by `event.code`, so the keys stay where they are on other layouts.
 */
export type GizmoTool = "move" | "rotate" | "scale";
export function gizmoKey(event: { code: string }): GizmoTool | null {
  return toolOfCode(event.code);
}

export interface GizmoOptions {
  profile?: GizmoProfile;
  /** Sizes that differ from the profile's. */
  size?: Partial<Record<GizmoRole, number>>;
  /** Spaces that differ from the profile's. */
  space?: Partial<Record<GizmoRole, "world" | "local">>;
  /** The object every gizmo is attached to from the start (otherwise the owner attaches when it shows one). */
  pivot?: THREE.Object3D;
  /** The scale gizmo follows the orientation too: along the scene's axes it works on the pivot's scale through a stand-in (see ScaleProxy). */
  worldScale?: boolean;
}

/** Makes one gizmo of a role: hidden and disabled, its helper already in the scene. */
export function createGizmo(ctx: GizmoContext, role: GizmoRole, options: GizmoOptions = {}): TransformControls {
  const profile = options.profile ?? SCENE_PROFILE;
  const t = new TransformControls(ctx.camera, ctx.dom);
  hideGuideLines(t);
  t.setMode(MODE[role]);
  t.setSpace(options.space?.[role] ?? profile.space[role]);
  t.setSize(options.size?.[role] ?? profile.size[role]);
  removeHandles(t, MODE[role], profile.strip[role]);
  if (role === "scale") configureScaleRing(t);
  if (role === "view" && profile.thickViewRing) thickenRing(t, "E", 0.75, 0.032);
  if (options.pivot) t.attach(options.pivot);
  t.getHelper().visible = false;
  t.enabled = false;
  ctx.scene.add(t.getHelper());
  return t;
}

/**
 * What a scale gizmo is attached to while the orientation is "world". TransformControls scales an object along its own axes whatever
 * the space, so for the scene's axes the gizmo is attached to this stand-in instead: it sits where the pivot is, unturned, and starts
 * every drag at a scale of 1. `GizmoSet` turns its scale into the pivot's.
 */
class ScaleProxy extends THREE.Object3D {
  constructor(private readonly source: () => THREE.Object3D | null, private readonly busy: () => boolean) { super(); }
  override updateMatrixWorld(force?: boolean) {
    const pivot = this.source();
    if (pivot && !this.busy()) {
      pivot.updateWorldMatrix(true, false);
      pivot.getWorldPosition(this.position);
      this.quaternion.identity();
      this.scale.set(1, 1, 1);
    }
    super.updateMatrixWorld(force);
  }
}

export type GizmoEvent = "mouseDown" | "mouseUp" | "dragging-changed" | "objectChange";

/** The gizmos one owner needs (some of the five roles), made the same way. */
export class GizmoSet {
  readonly controls: Partial<Record<GizmoRole, TransformControls>> = {};
  private readonly roles: GizmoRole[];
  private readonly scaleProxy: ScaleProxy | null = null;
  private pivot: THREE.Object3D | null;
  private space: "local" | "world";

  constructor(private readonly ctx: GizmoContext, roles: GizmoRole[], options: GizmoOptions = {}) {
    this.roles = roles;
    this.pivot = options.pivot ?? null;
    this.space = options.space?.move ?? (options.profile ?? SCENE_PROFILE).space.move;
    // the scale gizmo is attached by this set (to the pivot, or to its stand-in), not by createGizmo
    for (const role of roles) this.controls[role] = createGizmo(ctx, role, { ...options, pivot: role === "scale" ? undefined : options.pivot });
    const scale = this.controls.scale;
    if (scale && options.worldScale) {
      const proxy = this.scaleProxy = new ScaleProxy(() => this.pivot, () => scale.dragging);
      ctx.scene.add(proxy); // TransformControls wants what it edits to be in the scene (it is empty: nothing is drawn)
      let start = new THREE.Vector3();
      const listen = (type: string, handler: () => void) => (scale as unknown as { addEventListener(type: string, listener: () => void): void }).addEventListener(type, handler);
      listen("mouseDown", () => { if (scale.object === proxy && this.pivot) start = this.pivot.scale.clone(); });
      listen("objectChange", () => {
        const pivot = this.pivot;
        if (scale.object !== proxy || !pivot) return;
        // a local axis takes the scale of the world axes it lies along, in proportion to how much it lies along each (exact for turns about the vertical axis by quarter turns, smooth between)
        const turn = new THREE.Matrix4().makeRotationFromQuaternion(pivot.quaternion);
        const factor = (i: number) => { const a = new THREE.Vector3().setFromMatrixColumn(turn, i); return a.x * a.x * proxy.scale.x + a.y * a.y * proxy.scale.y + a.z * a.z * proxy.scale.z; };
        pivot.scale.set(start.x * factor(0), start.y * factor(1), start.z * factor(2));
      });
    }
    if (scale && this.pivot) this.place(scale, this.scaleTarget(this.pivot));
  }

  /**
   * Attaches a gizmo to an object without touching whether it shows: TransformControls.attach also makes the gizmo visible (and detach
   * hides it), which must never override what `show` decided. Whether a gizmo shows is set in one place, `show`.
   */
  private place(control: TransformControls, target: THREE.Object3D) {
    const helper = control.getHelper(), shown = helper.visible;
    control.attach(target);
    helper.visible = shown;
  }

  /** What the scale gizmo is attached to: the pivot, or in the scene's axes its stand-in. */
  private scaleTarget(pivot: THREE.Object3D): THREE.Object3D {
    return this.scaleProxy && this.space === "world" ? this.scaleProxy : pivot;
  }

  /** The gizmos, in the order the roles were given. */
  get all(): TransformControls[] { return this.roles.map((role) => this.controls[role]!); }
  /** Their helper objects, for what must be hidden while the scene is captured. */
  get objects(): THREE.Object3D[] { return this.all.map((control) => control.getHelper()); }
  /** A gizmo is shown and the pointer is on one of its handles. */
  get hot() { return this.all.some((control) => control.enabled && control.axis !== null); }
  get dragging() { return this.all.some((control) => control.dragging); }

  /** Listens to every gizmo of the set; the handler is told which role it came from. */
  on(event: GizmoEvent, handler: (role: GizmoRole, control: TransformControls, e: { value?: unknown }) => void) {
    for (const role of this.roles) {
      const control = this.controls[role]!;
      // the event map of TransformControls types each event's payload; one handler serves them all here
      (control as unknown as { addEventListener(type: string, listener: (e: { value?: unknown }) => void): void }).addEventListener(event, (e) => handler(role, control, e));
    }
  }

  /** Shows or hides a role's gizmo (attaching it to `pivot` when shown, detaching when not, if a pivot is given). */
  show(role: GizmoRole, on: boolean, pivot?: THREE.Object3D) {
    const control = this.controls[role];
    if (!control) return;
    if (pivot) {
      this.pivot = pivot;
      const target = role === "scale" ? this.scaleTarget(pivot) : pivot;
      if (on && control.object !== target) this.place(control, target);
      if (!on && control.object) control.detach();
    }
    control.enabled = on;
    control.getHelper().visible = on;
  }

  /** The orientation of the move and rotate gizmos: their own thing's axes ("local") or the scene's ("world"). The view ring and the view move handle do not take one; scale does where the set was made with `worldScale`. */
  setSpace(space: "local" | "world") {
    this.space = space;
    for (const role of ["move", "rotate"] as const) this.controls[role]?.setSpace(space);
    const scale = this.controls.scale;
    if (scale?.object && this.pivot && !scale.dragging) {
      const target = this.scaleTarget(this.pivot);
      if (scale.object !== target) this.place(scale, target);
    }
  }

  /** One pointer drag belongs to one gizmo of the set. `restore` puts the shown ones back when the drag ends. */
  exclusiveDrag(restore: () => void) {
    exclusiveGizmoDrag(this.ctx.dom, () => PRIORITY.filter((role) => this.controls[role]).map((role) => this.controls[role]!), restore);
  }

  dispose() {
    if (this.scaleProxy) this.ctx.scene.remove(this.scaleProxy);
    for (const control of this.all) { this.ctx.scene.remove(control.getHelper()); control.dispose(); }
  }
}
