import * as THREE from "three";
import { keyboardScaleFactor } from "./scaleGizmo";
import { COMPACT_PROFILE, GizmoSet, gizmoKey } from "./gizmos";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import type { Actor } from "./actor";
import { gazeAnglesForTarget, gazeTargetLocal } from "./gaze";
import { rotationBetween, solveTwoBone } from "./ik";
import { FINGER_AXIS, totalCurlRange } from "./fingers";
import { LIMBS, controlsFor, fingerBaseControls, fingerBoneControls, fingerControls, fingerTipControls, mirrorId, propControls, prpControls, rotateBoneLocal, weaponControls, type ControlDef, type LimbDef } from "./poseRig";

const COLORS = { L: 0x3a8dff, R: 0xff1414, C: 0xffc233 } as const;
/** The diamond-shaped helper controls (poles, detail, weapon and prop bones, finger joints and bases) are drawn at this fraction of their radius. */
const DIAMOND_SCALE = 0.67;
const SPINE_COLOR = 0x39d5ff;
const EYE_COLOR = 0xb6a8ff;
const HOVER = 0xffffff;
const SELECTED = 0xff8a1f;
const RING_POINTS = 40;
/** How close (in pixels) a click must be to a control to pick it. */
const PICK_RADIUS = 10;
/** The fraction of a spine bend each spine bone takes, lowest first. */
const SPINE_WEIGHTS = [0.2, 0.25, 0.3, 0.25];
const SPINE_BONES = ["bip_spine_0", "bip_spine_1", "bip_spine_2", "bip_spine_3"];
/** How far in front of the eyes the aim target is drawn: close enough to stay in front of the camera when the view is framed on the face. */
const EYE_DISTANCE = 14;

const SPINE_DEF: ControlDef = { id: "spineAll", label: "Spine", group: "spine", side: "C", kind: "spine", bone: "bip_spine_3", aim: "bip_neck", radius: 12 };
const EYE_DEF: ControlDef = { id: "eye", label: "Eye aim", group: "face", side: "C", kind: "eye", bone: "", aim: null, radius: 3 };

/** A limb in IK: where its end bone goes and which way its middle joint points. */
interface Limb {
  def: LimbDef;
  bones: [number, number, number];
  enabled: boolean;
  /** Target of the end bone, in model space (Source: x forward, y left, z up). */
  target: THREE.Vector3;
  targetQuat: THREE.Quaternion;
  pole: THREE.Vector3;
  l1: number;
  l2: number;
}

interface RigState {
  limbs: Limb[];
  eye: { on: boolean; target: THREE.Vector3 };
}

interface Control {
  def: ControlDef;
  bone: number;
  aim: number;
  limb: Limb | null;
  obj: THREE.LineSegments;
  stem: THREE.Line | null;
  /** The shape in unit space, as segment end points (three numbers each, in pairs). */
  segs: Float32Array;
  center: THREE.Vector3;
  quat: THREE.Quaternion;
  scale: number;
  /** Where the gizmo sits when the control is selected (model space). */
  anchor: THREE.Vector3;
  /** Set when the shape is drawn somewhere other than at `center` / `quat` (a foot plate under the ankle). */
  draw: { center: THREE.Vector3; quat: THREE.Quaternion } | null;
  /** Limb and spine rings: the rotation from the bone's own frame to the ring's frame, fixed when the rig attaches. */
  aimOffset?: THREE.Quaternion;
  /** Shoulder plates: the rotation from the collar bone to the plate, chosen when the rig attaches. */
  plateOffset?: THREE.Quaternion;
  /** Foot plates: where the plate's centre is, relative to the foot target and in its frame. */
  plateLocal?: THREE.Vector3;
}

// shapes (unit size)
function circleSegs(): Float32Array {
  const out: number[] = [];
  for (let i = 0; i < RING_POINTS; i++) {
    const a = (i / RING_POINTS) * Math.PI * 2;
    const b = ((i + 1) / RING_POINTS) * Math.PI * 2;
    out.push(Math.cos(a), Math.sin(a), 0, Math.cos(b), Math.sin(b), 0);
  }
  return new Float32Array(out);
}
function boxSegs(): Float32Array {
  const c = [-1, 1];
  const out: number[] = [];
  for (const x of c) for (const y of c) out.push(x, y, -1, x, y, 1);
  for (const x of c) for (const z of c) out.push(x, -1, z, x, 1, z);
  for (const y of c) for (const z of c) out.push(-1, y, z, 1, y, z);
  return new Float32Array(out);
}
function diamondSegs(): Float32Array {
  const axes: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const out: number[] = [];
  for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) if (i >> 1 !== j >> 1) out.push(...axes[i], ...axes[j]);
  return new Float32Array(out);
}
/**
 * The chest control: an oval loop around the upper torso at collar height that dips at the front, so seen from the front it is a
 * U running shoulder to shoulder under the neck and seen from the side an arch. Wider side to side than front to back, to follow
 * the contour of a chest. Local x is the body's front, z up the spine.
 */
function saddleSegs(): Float32Array {
  const out: number[] = [];
  const point = (t: number) => {
    const front = (Math.cos(t) + 1) / 2; // 1 at the front, 0 at the back
    const side = Math.sin(t) ** 2; // 1 at the shoulders
    // the sides rise and the front sags, so the front view is a deep U (the back sags less, so the top view stays a clean oval)
    return [0.8 * Math.cos(t), 1.0 * Math.sin(t), 0.55 * side - 0.28 - 0.22 * front * front];
  };
  for (let i = 0; i < RING_POINTS; i++) out.push(...point((i / RING_POINTS) * Math.PI * 2), ...point(((i + 1) / RING_POINTS) * Math.PI * 2));
  return new Float32Array(out);
}
/** A rounded rectangle lying flat in the xy plane: half length `hx` along x, half width `hy`, corner radius `r`. */
function roundedRectSegs(hx: number, hy: number, r: number): Float32Array {
  const pts: number[][] = [];
  const corner = (cx: number, cy: number, from: number) => {
    for (let i = 0; i <= 6; i++) {
      const a = from + (i / 6) * (Math.PI / 2);
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a), 0]);
    }
  };
  corner(hx - r, hy - r, 0);
  corner(-hx + r, hy - r, Math.PI / 2);
  corner(-hx + r, -hy + r, Math.PI);
  corner(hx - r, -hy + r, Math.PI * 1.5);
  const out: number[] = [];
  for (let i = 0; i < pts.length; i++) out.push(...pts[i], ...pts[(i + 1) % pts.length]);
  return new Float32Array(out);
}
/**
 * The fingertip control: the outline of a fingertip (flat at the base, straight sides, a domed end), drawn flat in the plane of the
 * plane of the finger pad / nail (its length and width), turned a quarter turn from the bending plane. Local +Y is the way the
 * finger points, the tip at y = 1.
 */
function fingertipSegs(): Float32Array {
  const pts: [number, number][] = [];
  const w = 0.7;
  pts.push([-w, -1]);
  pts.push([w, -1]);
  pts.push([w, 0.15]);
  for (let i = 1; i < 12; i++) {
    const a = (i / 12) * Math.PI;
    pts.push([w * Math.cos(a), 0.15 + 0.85 * Math.sin(a)]);
  }
  pts.push([-w, 0.15]);
  const out: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    out.push(x0, y0, 0, x1, y1, 0);
  }
  return new Float32Array(out);
}
/** The foot targets: a flat rounded rectangle, 2 long and 1.1 wide, x forward. */
const footSegs = () => roundedRectSegs(1, 0.55, 0.3);
/** The toe controls: a small flat rounded rectangle like the foot plate, x forward. */
const toeSegs = () => roundedRectSegs(1, 0.6, 0.3);
/** The shoulder controls: a flat rounded square. */
const shoulderSegs = () => roundedRectSegs(1, 1.15, 0.35);
function crossSegs(): Float32Array {
  return new Float32Array([...circleSegs(), -1.6, 0, 0, 1.6, 0, 0, 0, -1.6, 0, 0, 1.6, 0, 0, 0, -1.6, 0, 0, 1.6]);
}

const IDENTITY = new THREE.Quaternion();
/**
 * Where each tip control sits relative to the fingertip, in the control's own frame (x across the finger, y along it, z out of the
 * pad), in model units: the thumb's a little forward along the finger and down in z, the index, ring and pinky controls a little forward along the finger.
 */
const TIP_NUDGE: Record<string, [number, number, number] | undefined> = {
  thumb: [0, 0.5, -0.5],
  index: [0, 0.5, 0],
  ring: [0, 0.5, 0],
  pinky: [0, 0.5, 0],
};
const _tipQ = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
/** Turns a ring (its normal is local z) so its normal is the finger hinge (local x). */
const RING_TO_HINGE = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
const _bindQ = new THREE.Quaternion();
const _pos = new THREE.Vector3();
/** Source model space: x is the front of the body. */
const FORWARD = new THREE.Vector3(1, 0, 0);

const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)];
const UP = new THREE.Vector3(0, 0, 1);
const _pa = new THREE.Vector3();
const _pb = new THREE.Vector3();

/** How far (radians) a foot or toe plate is tipped nose-up from the line between the ankle and the toes. */
const FOOT_PLATE_TILT = (25 * Math.PI) / 180;

/**
 * The frame of a foot or toe plate: x along the foot (`dir`, ankle to toes, with whatever pitch and turn the foot has), z the bone
 * axis closest to up made square with x, so the plate lies on the sole and carries the foot's roll too.
 */
function footPlateFrame(bone: THREE.Quaternion, dir: THREE.Vector3): THREE.Quaternion {
  const x = dir.clone().normalize();
  let z = UP.clone();
  let best = -1;
  for (const axis of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]) {
    const a = axis.applyQuaternion(bone);
    const d = a.dot(UP);
    if (Math.abs(d) > best) {
      best = Math.abs(d);
      z = a.multiplyScalar(d < 0 ? -1 : 1);
    }
  }
  z.addScaledVector(x, -z.dot(x));
  if (z.lengthSq() < 1e-8) z.copy(UP).addScaledVector(x, -UP.dot(x));
  z.normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  const frame = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  // the line from the ankle to the toes slopes down, but the sole lies flatter: tip the plate's nose up by a fixed angle
  return frame.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -FOOT_PLATE_TILT));
}

/**
 * The rotation to apply to a bone's own frame (given by its world rotation `bone`) to get a plate frame that is as close as the
 * bone's axes allow to lying flat with its length toward the front of the body: the bone axis closest to up becomes the plate's z,
 * and among the axes across it the one closest to forward becomes its x.
 */
function plateOffsetFor(bone: THREE.Quaternion, up = UP, forward = FORWARD): THREE.Quaternion {
  let n = AXES[0];
  let best = -2;
  for (const a of AXES) {
    const d = _pa.copy(a).applyQuaternion(bone).dot(up);
    if (d > best) {
      best = d;
      n = a;
    }
  }
  let f = AXES[0];
  best = -2;
  for (const a of AXES) {
    if (Math.abs(a.dot(n)) > 0.5) continue; // along the normal's axis
    const d = _pb.copy(a).applyQuaternion(bone).dot(forward);
    if (d > best) {
      best = d;
      f = a;
    }
  }
  const y = new THREE.Vector3().crossVectors(n, f);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(f, y, n));
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();

/** The mirror image (across the body's left-right plane, y in model space) of a rotation: x and z flip. */
const mirrorQuat = (q: THREE.Quaternion) => new THREE.Quaternion(-q.x, q.y, -q.z, q.w);
const mirrorVec = (v: THREE.Vector3) => new THREE.Vector3(v.x, -v.y, v.z);

/**
 * The control rig drawn over a posing character: FK rings (the pelvis moves and turns the whole body), a spine control, IK targets and poles for the limbs in
 * IK, and an eye aim target. Clicking a control selects it and puts the right gizmo on it; turning or moving the gizmo edits the
 * pose (see {@link rotateBoneLocal}). With `mirror` on, an edit on one side is repeated on the other.
 */
export class RigOverlay {
  /** Scene object holding the controls; its matrix follows the character's. */
  readonly root = new THREE.Group();
  /** Called when the selected control changes (null: none). */
  onSelect: (id: string | null) => void = () => {};
  /** Called after an edit changed the pose or the rig state. */
  onEdit: () => void = () => {};
  /** Called with the eye controller values (degrees) the eye aim target asks for. */
  onEyeAim: (upDown: number, rightLeft: number) => void = () => {};
  /** The current eye controller values (degrees), read when eye aim is switched on. */
  eyeAngles: () => { upDown: number; rightLeft: number } = () => ({ upDown: 0, rightLeft: 0 });
  /** Repeat edits on the other side of the body. */
  mirror = false;
  /** Orient the gizmo with the selected control (its ring or target) instead of the scene's axes. */
  private localOrientation = true;

  private _actor: Actor | null = null;
  private state: RigState | null = null;
  private readonly states = new WeakMap<Actor, RigState>();
  private controls: Control[] = [];
  private selectedId: string | null = null;
  private hoverId: string | null = null;
  private readonly gizmos: GizmoSet;
  private readonly rotGizmo: TransformControls;
  /** The outer ring of the rotate gizmo: it turns about the line of sight, whichever way the control faces. */
  private readonly viewGizmo: TransformControls;
  private readonly moveGizmo: TransformControls;
  private readonly scaleGizmo: TransformControls;
  /** Which gizmos the user wants shown (they can all be on, or only the rotation). */
  private parts = { move: false, rotate: false, scale: false, view: true };
  private readonly pivot = new THREE.Object3D();
  private readonly materials = new Map<number, THREE.LineBasicMaterial>();
  private readonly shapes = { circle: circleSegs(), box: boxSegs(), diamond: diamondSegs(), cross: crossSegs(), saddle: saddleSegs(), foot: footSegs(), shoulder: shoulderSegs(), toe: toeSegs(), fingertip: fingertipSegs() };
  private readonly geometries = new Map<Float32Array, THREE.BufferGeometry>();
  private groupsOn = new Set<string>(["spine", "arm", "leg", "face", "fingers"]);
  private shown = true;
  private drag: DragState | null = null;
  /** A Shift + W / E / R transform in progress: mouse edits, axes constrain, click confirms, Esc cancels. */
  private modal: ModalState | null = null;
  /** While a tip control is being moved: where it was asked to go. Like an IK target it is drawn there (the gizmo sits on it), even when the finger cannot quite reach. */
  private tipTarget: { id: string; pos: THREE.Vector3 } | null = null;
  /** Called with a hint while a transform runs, and with null when it ends. */
  onModal: (text: string | null) => void = () => {};
  private pointer = { x: 0, y: 0, inside: false };
  private readonly orbit: OrbitControls;
  private lastEye: { upDown: number; rightLeft: number } | null = null;

  constructor(
    private readonly camera: THREE.Camera,
    private readonly dom: HTMLElement,
    orbit: OrbitControls,
    scene: THREE.Scene,
  ) {
    this.orbit = orbit;
    this.root.matrixAutoUpdate = false;
    this.root.visible = false;
    this.root.add(this.pivot);
    this.pivot.add(this.centerDot);
    scene.add(this.root);
    // small gizmos, so they do not cover the controls around them; the rotation rings are still a little larger than the arrows
    this.gizmos = new GizmoSet({ camera, dom, scene }, ["rotate", "view", "move", "scale"], { profile: COMPACT_PROFILE, pivot: this.pivot });
    this.rotGizmo = this.gizmos.controls.rotate!;
    this.viewGizmo = this.gizmos.controls.view!;
    this.moveGizmo = this.gizmos.controls.move!;
    this.scaleGizmo = this.gizmos.controls.scale!;
    this.gizmos.on("dragging-changed", (_role, _control, e) => {
      orbit.enabled = !e.value;
      if (e.value) this.beginDrag();
      else this.endDrag();
    });
    this.gizmos.on("objectChange", (role) => this.applyDrag(role === "move" ? "translate" : role === "scale" ? "scale" : "rotate"));
    this.gizmos.exclusiveDrag(() => this.applyParts());
    this.setLocal(this.localOrientation);
    this.installHotkeys();
  }

  /** Everything this overlay adds to the scene, for the places that must skip it. */
  get objects(): THREE.Object3D[] {
    return [this.root, ...this.gizmos.objects];
  }

  /** The character wearing the rig, or null. */
  get actor(): Actor | null {
    return this._actor;
  }

  /** Whether the mouse is over a handle of a gizmo. */
  get gizmoHot(): boolean {
    return this.gizmos.hot;
  }

  get active(): boolean {
    return this._actor !== null && this.shown;
  }

  /** Whether the gizmo follows the selected control's own orientation (Blender's "Normal"/"Local") instead of the scene's axes. */
  get local(): boolean {
    return this.localOrientation;
  }

  setLocal(on: boolean) {
    this.localOrientation = on;
    this.applySpace();
    if (!this.drag) this.syncPivot();
  }

  /** The gizmos' space: the chosen orientation, except a finger control always uses its own frame (its X ring is the hinge). */
  private applySpace() {
    const finger = this.selectedKind === "finger";
    const space = this.localOrientation || finger ? "local" : "world";
    this.rotGizmo.setSpace(space);
    this.viewGizmo.setSpace(space);
    this.moveGizmo.setSpace(space);
    this.scaleGizmo.setSpace("local");
  }

  /** Puts the pivot where the selected control is, turned to match it in local orientation. */
  private syncPivot() {
    const sel = this.controls.find((c) => c.def.id === this.selectedId);
    if (!sel) return;
    this.pivot.position.copy(sel.anchor);
    this.pivot.scale.set(1, 1, 1);
    this.pivot.quaternion.copy(this.localOrientation || sel.def.kind === "finger" ? sel.quat : IDENTITY);
    this.pivot.updateMatrixWorld(true);
  }

  get selected(): string | null {
    return this.selectedId;
  }

  /** The controls currently shown (with their kind, for the lists in the interface). */
  get defs(): ControlDef[] {
    return this.controls.filter((c) => this.isVisible(c)).map((c) => c.def);
  }

  /** The bone index the selected control turns, or -1. */
  get selectedBone(): number {
    const c = this.controls.find((x) => x.def.id === this.selectedId);
    return c && (c.def.kind === "fk" || c.def.kind === "pelvis") ? c.bone : -1;
  }

  /** Whether the selected control can be reset (it turns bones). */
  get selectedKind(): string | null {
    return this.controls.find((c) => c.def.id === this.selectedId)?.def.kind ?? null;
  }

  limbs(): { id: string; label: string; enabled: boolean }[] {
    return (this.state?.limbs ?? []).map((l) => ({ id: l.def.id, label: l.def.label, enabled: l.enabled }));
  }

  get eyeAim(): boolean {
    return this.state?.eye.on ?? false;
  }

  /** Forgets the rig state (IK targets, eye aim) of a character, e.g. when it leaves pose mode. */
  forget(actor: Actor) {
    this.states.delete(actor);
  }

  /** Puts the rig on a character (null: off). */
  setActor(actor: Actor | null) {
    this.select(null);
    for (const c of this.controls) {
      this.root.remove(c.obj);
      if (c.stem) {
        this.root.remove(c.stem);
        c.stem.geometry.dispose();
      }
    }
    this.controls = [];
    this._actor = actor;
    this.hoverId = null;
    this.state = null;
    this.lastEye = null;
    if (!actor) {
      this.root.visible = false;
      return;
    }
    const names = actor.boneNames.map((n) => n.toLowerCase());
    const idx = (n: string | null) => (n ? names.indexOf(n.toLowerCase()) : -1);

    let state = this.states.get(actor);
    if (!state) {
      state = {
        limbs: LIMBS.filter((l) => l.bones.every((b) => idx(b) >= 0)).map((def) => ({
          def,
          bones: def.bones.map((b) => idx(b)) as [number, number, number],
          enabled: false,
          target: new THREE.Vector3(),
          targetQuat: new THREE.Quaternion(),
          pole: new THREE.Vector3(),
          l1: 1,
          l2: 1,
        })),
        eye: { on: false, target: new THREE.Vector3() },
      };
      this.states.set(actor, state);
      this.state = state;
      // every limb starts in IK (from the pose it has now, so nothing moves); switch a limb to FK to turn its bones instead
      for (const l of state.limbs) {
        this.snapLimb(l);
        l.enabled = true;
      }
    }
    this.state = state;
    // A rig state kept from an earlier pose still holds that pose's targets, poles and bone lengths. Solving to them would throw
    // every limb toward the old targets at the first edit, so limbs in IK are re-read from the pose the character has now.
    for (const l of state.limbs) if (l.enabled) this.snapLimb(l);
    state.eye.on = false;

    const add = (def: ControlDef, shape: Float32Array, limb: Limb | null, stem: boolean) => {
      const geo = this.geometryOf(shape);
      const obj = new THREE.LineSegments(geo, this.material(this.baseColor(def)));
      obj.renderOrder = 1000;
      obj.frustumCulled = false;
      let stemLine: THREE.Line | null = null;
      if (stem) {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(6), 3));
        stemLine = new THREE.Line(g, this.material(this.baseColor(def)));
        stemLine.renderOrder = 1000;
        stemLine.frustumCulled = false;
        this.root.add(stemLine);
      }
      this.root.add(obj);
      this.controls.push({
        def,
        bone: idx(def.bone),
        aim: idx(def.aim),
        limb,
        obj,
        stem: stemLine,
        segs: shape,
        center: new THREE.Vector3(),
        quat: new THREE.Quaternion(),
        scale: shape === this.shapes.diamond ? def.radius * DIAMOND_SCALE : def.radius,
        anchor: new THREE.Vector3(),
        draw: null,
      });
    };

    for (const def of controlsFor(actor.boneNames)) {
      const limb = state.limbs.find((l) => l.def.rings.includes(def.id)) ?? null;
      const plate = def.id.startsWith("collar") ? this.shapes.shoulder : def.id.startsWith("toe") ? this.shapes.toe : null;
      add(def, plate ?? this.shapes.circle, limb, !plate);
    }
    // the secondary prp_ bones of this class, shown with the Detail toggle
    for (const def of prpControls(actor.boneNames, actor.parents)) add(def, this.shapes.diamond, null, false);
    // one curl control per finger, shown with the Fingers toggle
    for (const def of fingerControls(actor.boneNames)) add(def, this.shapes.circle, null, false);
    // a base (knuckle) control per finger: turns the whole finger at the hand
    for (const def of fingerBaseControls(actor.boneNames)) add(def, this.shapes.diamond, null, false);
    // a tip control per finger: move it and the finger follows
    for (const def of fingerTipControls(actor.boneNames)) add(def, this.shapes.fingertip, null, false);
    // every finger bone, for fine tuning, shown with the Joints toggle
    for (const def of fingerBoneControls(actor.boneNames)) add(def, this.shapes.diamond, null, false);
    // the weapon_ bones (the held weapon) and the prop_ bones (taunt props), shown with their own toggles
    for (const def of [...weaponControls(actor.boneNames, actor.parents), ...propControls(actor.boneNames, actor.parents)]) add(def, this.shapes.diamond, null, false);
    if (SPINE_BONES.every((b) => idx(b) >= 0)) add(SPINE_DEF, this.shapes.saddle, null, false);
    for (const limb of state.limbs) {
      const arm = limb.def.id.startsWith("arm");
      const cap = limb.def.id[0].toUpperCase() + limb.def.id.slice(1);
      const group = arm ? "arm" : "leg";
      const base = { group, side: limb.def.side, bone: limb.def.bones[2], aim: null } as const;
      // a foot target is a flat plate under the foot, drawn from the ankle toward the toes
      const toe = arm ? null : `bip_toe_${limb.def.side}`;
      add({ ...base, aim: toe, id: `ik${cap}`, label: `${limb.def.label} IK target`, kind: "ik", radius: arm ? 3.25 : 8 }, arm ? this.shapes.circle : this.shapes.foot, limb, false);
      add({ ...base, id: `pole${cap}`, label: `${limb.def.label} pole`, kind: "pole", radius: 2.5 }, this.shapes.diamond, limb, true);
    }
    if (actor.eyeFrame()) add(EYE_DEF, this.shapes.cross, null, true);

    this.root.visible = this.shown;
    this.applyVisibility();
    this.update();
  }

  private geometryOf(segs: Float32Array): THREE.BufferGeometry {
    let g = this.geometries.get(segs);
    if (!g) {
      g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(segs, 3));
      this.geometries.set(segs, g);
    }
    return g;
  }

  private baseColor(def: ControlDef): number {
    if (def.kind === "spine") return SPINE_COLOR;
    if (def.kind === "eye") return EYE_COLOR;
    return COLORS[def.side];
  }

  private isVisible(c: Control): boolean {
    if (!this.groupsOn.has(c.def.group)) return false;
    switch (c.def.kind) {
      case "fk":
        return !(c.limb?.enabled ?? false);
      case "ik":
      case "pole":
        return c.limb?.enabled ?? false;
      case "eye":
        return this.state?.eye.on ?? false;
      default:
        return true;
    }
  }

  private applyVisibility() {
    for (const c of this.controls) {
      const on = this.isVisible(c);
      c.obj.visible = on;
      if (c.stem) c.stem.visible = on;
    }
    if (this.selectedId && !this.controls.some((c) => c.def.id === this.selectedId && this.isVisible(c))) this.select(null);
  }

  /** Shows or hides all the controls (and the gizmos). */
  setShown(on: boolean) {
    this.shown = on;
    this.root.visible = on && this._actor !== null;
    if (!on) this.select(null);
  }

  /** Shows only the controls of the given groups (`spine`, `arm`, `leg`, `face`). */
  setGroups(groups: Iterable<string>) {
    this.groupsOn = new Set(groups);
    this.applyVisibility();
  }

  private material(color: number): THREE.LineBasicMaterial {
    let m = this.materials.get(color);
    if (!m) {
      m = new THREE.LineBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true, opacity: 0.95, toneMapped: false });
      this.materials.set(color, m);
    }
    return m;
  }

  private colorOf(c: Control): number {
    if (c.def.id === this.selectedId) return SELECTED;
    if (c.def.id === this.hoverId) return HOVER;
    return this.baseColor(c.def);
  }

  // --- limbs and eye aim --------------------------------------------------------------------------------------

  private worldPos(b: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.setFromMatrixPosition(this._actor!.boneWorlds![b]);
  }

  private worldQuat(b: number, out = new THREE.Quaternion()): THREE.Quaternion {
    this._actor!.boneWorlds![b].decompose(_a, out, _s);
    return out;
  }

  /** Reads a limb's current pose into its IK target, pole and lengths (so switching to IK changes nothing). */
  private snapLimb(l: Limb) {
    const [u, m, e] = l.bones;
    const A = this.worldPos(u);
    const B = this.worldPos(m);
    const C = this.worldPos(e);
    l.l1 = A.distanceTo(B);
    l.l2 = B.distanceTo(C);
    l.target.copy(C);
    this.worldQuat(e, l.targetQuat);
    const mid = A.clone().add(C).multiplyScalar(0.5);
    const out = B.clone().sub(mid);
    if (out.length() < 0.5) out.set(...l.def.bend);
    l.pole.copy(B).addScaledVector(out.normalize(), 20);
  }

  /** Turns a bone by a rotation in model space, on top of the world rotation it had at `startWorld`. */
  private turnBone(bone: number, startWorld: THREE.Quaternion, delta: THREE.Quaternion) {
    const actor = this._actor!;
    const p = actor.parents[bone];
    const parent = p >= 0 ? this.worldQuat(p) : new THREE.Quaternion();
    actor.setBoneQuat(bone, rotateBoneLocal(parent, startWorld, delta));
  }

  /** The inverse of a bone's parent's model-space matrix (the identity for a root bone). */
  private parentInverse(bone: number): THREE.Matrix4 {
    const p = this._actor!.parents[bone];
    return p >= 0 ? this._actor!.boneWorlds![p].clone().invert() : new THREE.Matrix4();
  }

  private setWorldQuat(bone: number, world: THREE.Quaternion) {
    const actor = this._actor!;
    const p = actor.parents[bone];
    const parent = p >= 0 ? this.worldQuat(p) : new THREE.Quaternion();
    actor.setBoneQuat(bone, parent.invert().multiply(world).normalize());
  }

  /** Brings a limb in IK to its target: the root joint and middle joint are turned, then the end bone takes the target's rotation. */
  private solveLimb(l: Limb) {
    const [u, m, e] = l.bones;
    const A = this.worldPos(u);
    const B = this.worldPos(m);
    const res = solveTwoBone(A, B, l.target, l.pole, l.l1, l.l2);
    // The limbs do not stretch (they do not in the game either): a target beyond reach is pulled back to the end the limb can reach, so the
    // control always stands where the hand or foot is. While dragging, the control follows the mouse again as soon as it is back in reach.
    if (!res.reachable) l.target.copy(res.end);
    this.turnBone(u, this.worldQuat(u), rotationBetween(_b.subVectors(B, A), _c.subVectors(res.mid, A)));
    const B2 = this.worldPos(m);
    const C2 = this.worldPos(e);
    this.turnBone(m, this.worldQuat(m), rotationBetween(_b.subVectors(C2, B2), _c.subVectors(res.end, B2)));
    this.setWorldQuat(e, l.targetQuat.clone());
  }

  /** Re-solves everything that follows a target: the limbs in IK (so planted hands and feet stay put) and the eye aim. */
  private solveAll() {
    const st = this.state;
    if (!st || !this._actor) return;
    for (const l of st.limbs) if (l.enabled) this.solveLimb(l);
    this.solveEye();
  }

  /** Call after the pose changed by something other than the rig (undo, reset, a loaded pose): the IK targets follow the pose. */
  afterExternalChange() {
    const st = this.state;
    if (!st || !this._actor) return;
    for (const l of st.limbs) if (l.enabled) this.snapLimb(l);
    this.solveEye();
  }

  /** Re-applies the rig's solvers (after something moved a bone the rig does not own, such as a finger or a loaded pose). */
  refresh() {
    this.solveAll();
  }

  setLimbIk(id: string, on: boolean) {
    const l = this.state?.limbs.find((x) => x.def.id === id);
    if (!l || l.enabled === on || !this._actor) return;
    if (on) this.snapLimb(l);
    l.enabled = on;
    this.applyVisibility();
    this.onEdit();
  }

  setEyeAim(on: boolean) {
    const st = this.state;
    const actor = this._actor;
    if (!st || !actor || st.eye.on === on) return;
    if (on) {
      const frame = actor.eyeFrame(_m);
      if (!frame) return;
      const a = this.eyeAngles();
      const [x, y, z] = gazeTargetLocal(a.upDown, a.rightLeft);
      st.eye.target.set((x * EYE_DISTANCE) / 32, (y * EYE_DISTANCE) / 32, (z * EYE_DISTANCE) / 32).applyMatrix4(frame);
    }
    st.eye.on = on;
    this.applyVisibility();
    this.onEdit();
  }

  /** Turns the eyes toward the eye aim target (the head may have moved since). */
  private solveEye() {
    const st = this.state;
    const actor = this._actor;
    if (!st?.eye.on || !actor) return;
    const frame = actor.eyeFrame(_m);
    if (!frame) return;
    _a.copy(st.eye.target).applyMatrix4(_m.copy(frame).invert());
    const g = gazeAnglesForTarget(_a.x, _a.y, _a.z);
    const last = this.lastEye;
    if (last && Math.abs(last.upDown - g.upDown) < 0.01 && Math.abs(last.rightLeft - g.rightLeft) < 0.01) return;
    this.lastEye = g;
    this.onEyeAim(g.upDown, g.rightLeft);
  }

  // --- drawing and picking ------------------------------------------------------------------------------------

  /** Follows the character: call every frame while the overlay is on. */
  update() {
    const actor = this._actor;
    const worlds = actor?.boneWorlds;
    const model = actor?.modelMatrix;
    if (!actor || !worlds || !model || !this.root.visible) return;
    this.root.matrix.copy(model);
    this.root.matrixWorldNeedsUpdate = true;
    const parents = actor.parents;
    for (const c of this.controls) {
      if (!c.obj.visible) continue;
      switch (c.def.kind) {
        case "fk":
        case "finger":
        case "pelvis": {
          if (c.def.id.startsWith("collar")) c.draw ??= { center: new THREE.Vector3(), quat: new THREE.Quaternion() };
          this.worldPos(c.bone, _a);
          c.anchor.copy(_a);
          if (c.aim >= 0) {
            this.worldPos(c.aim, _b);
            _dir.subVectors(_b, _a);
            c.center.copy(_a).addScaledVector(_dir, 0.5);
          } else {
            const p = parents[c.bone];
            if (p >= 0) this.worldPos(p, _b);
            else _b.copy(_a).sub(_z);
            _dir.subVectors(_a, _b);
            c.center.copy(_a).addScaledVector(_dir.clone().normalize(), c.def.radius * 0.8);
          }
          if (_dir.lengthSq() < 1e-8) _dir.set(0, 0, 1);
          c.quat.setFromUnitVectors(_z, _dir.normalize());
          if (c.def.kind === "fk" && c.aim >= 0 && !c.def.boneFrame) {
            // The ring and its (local) gizmo are tied to the bone's own frame: the ring's frame is the shortest turn from the bone's axis when
            // the rig attaches, and from then on it turns with the bone. Recomputing that shortest turn every frame swung the gizmo's
            // roll around as the bone moved (a little or a lot, depending on how the bone was turned).
            worlds[c.bone].decompose(_pos, _bindQ, _s);
            if (!c.aimOffset) {
              // The frame at the start: z along the bone and x across it, about the body's side-to-side axis (the way a knee, elbow or
              // spine bends), or the vertical when the bone itself lies along that axis (an arm held out to the side), so the gizmo's X ring
              // is the bend, Y the sway and Z the twist, whatever the pose the rig attaches to.
              const z = _dir.clone();
              const side = new THREE.Vector3(0, 1, 0);
              let across = Math.abs(z.dot(side)) > 0.85 ? UP.clone() : side;
              // A bent limb tells where its hinge really is: the normal of the plane its joints lie in (a knee or elbow does not bend about
              // the body's side axis in every pose, a stance with the legs turned out is a good example). All of the limb's rings share it.
              if (c.limb) {
                const [u, m, e] = c.limb.bones;
                const p0 = this.worldPos(u, new THREE.Vector3());
                const p1 = this.worldPos(m, new THREE.Vector3());
                const p2 = this.worldPos(e, new THREE.Vector3());
                const upper = p1.clone().sub(p0);
                const lower = p2.clone().sub(p1);
                const hinge = new THREE.Vector3().crossVectors(upper, lower);
                if (hinge.length() > 0.2 * upper.length() * lower.length()) {
                  if (hinge.dot(side) < 0) hinge.negate();
                  across = hinge;
                }
              }
              across.addScaledVector(z, -across.dot(z));
              if (across.lengthSq() < 1e-6) across.copy(Math.abs(z.dot(side)) > 0.85 ? UP : side).addScaledVector(z, -(Math.abs(z.dot(side)) > 0.85 ? UP : side).dot(z));
              const x = across.normalize();
              const y = new THREE.Vector3().crossVectors(z, x);
              c.quat.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
              c.aimOffset = _bindQ.clone().invert().multiply(c.quat);
            }
            c.quat.copy(_bindQ).multiply(c.aimOffset);
          }
          if (c.def.kind === "finger" && c.aim >= 0) {
            // The curl ring wraps the finger at its middle joint. Its gizmo follows the fingertip bone: every joint of a finger turns
            // about parallel axes, so the tip bone's rotation is the sum of the joints' and the X ring turns in step with the curl
            // (a gizmo on the middle joint would only follow part of it). The ring is drawn with its normal along the hinge.
            c.draw ??= { center: new THREE.Vector3(), quat: new THREE.Quaternion() };
            worlds[c.aim].decompose(_pos, c.quat, _s);
            c.draw.center.copy(_a);
            c.draw.quat.copy(c.quat).multiply(RING_TO_HINGE);
          }
          if (c.def.id.startsWith("toe")) {
            // The toe plate is aligned with the toe as the pose has it when the rig attaches, and then follows the
            // toe bone's own frame, so it turns with itself (the same as the foot plate). The gizmo takes the plate's frame.
            c.draw ??= { center: new THREE.Vector3(), quat: new THREE.Quaternion() };
            worlds[c.bone].decompose(_pos, _bindQ, _s);
            if (!c.plateOffset) {
              const par = parents[c.bone];
              if (par >= 0) this.worldPos(par, _b);
              else _b.copy(_a).sub(FORWARD);
              const along = new THREE.Vector3().subVectors(_a, _b);
              if (along.lengthSq() < 1e-6) along.set(1, 0, 0);
              const frame = footPlateFrame(_bindQ, along);
              c.plateOffset = _bindQ.clone().invert().multiply(frame);
              const toLocal = _bindQ.clone().invert();
              // a little way on from the toe joint along the foot, a touch below it (in the plate's own frame)
              const slide = along.clone().normalize().multiplyScalar(c.def.radius * 0.9).addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(frame), -0.3);
              c.plateLocal = slide.applyQuaternion(toLocal);
            }
            c.draw.quat.copy(_bindQ).multiply(c.plateOffset);
            c.draw.center.copy(c.plateLocal!).applyQuaternion(_bindQ).add(_pos);
            c.quat.copy(c.draw.quat);
          }
          if (c.def.boneFrame && !c.def.movable) {
            // a finger joint: a diamond on the joint, with the gizmo in the joint's own frame
            c.center.copy(_a);
            worlds[c.bone].decompose(_pos, c.quat, _s);
          }
          if (c.def.movable) {
            // A detail / weapon / prop control is a small diamond sitting on its bone, and its (local) gizmo takes the bone's own
            // rotation exactly. Taking the direction to a neighbouring bone instead leaves a leaf bone's gizmo unchanged when the
            // bone turns in place, so it only caught up late.
            c.center.copy(_a);
            worlds[c.bone].decompose(_pos, c.quat, _s);
          }
          if (c.def.id === "head" || c.def.id === "neck") {
            // Tied to the bone's own frame, like the chest and the shoulders: the ring (and the gizmo's local axes) carry the bone's
            // rotation, so a turned head or neck takes its ring with it. Its offset to the bone is fixed when the rig attaches.
            worlds[c.bone].decompose(_pos, _bindQ, _s);
            if (!c.plateOffset) {
              c.plateOffset = plateOffsetFor(_bindQ, _dir.clone().normalize());
              c.plateLocal = c.center.clone().sub(_a).applyQuaternion(_bindQ.clone().invert());
            }
            c.quat.copy(_bindQ).multiply(c.plateOffset);
            c.center.copy(c.plateLocal!).applyQuaternion(_bindQ).add(_pos);
          }
          this.setStem(c, _a, c.center);
          if (c.draw && c.def.id.startsWith("collar")) {
            // The shoulder plate is aligned with the collar bone's own axes, so it carries the shoulder's rotation in the pose and keeps
            // turning with the bone. Which of the bone's axes is the plate's normal (and which way it points) is chosen once, when the
            // rig attaches: the ones closest to up and to the front, so the plate reads as the shoulder plane.
            c.draw.center.copy(c.center);
            c.draw.center.z += c.def.radius * 0.9;
            worlds[c.bone].decompose(_a, _bindQ, _s);
            c.plateOffset ??= plateOffsetFor(_bindQ);
            c.draw.quat.copy(_bindQ).multiply(c.plateOffset);
            // the gizmo takes the plate's frame, like the arm rings share theirs with their gizmo
            c.quat.copy(c.draw.quat);
          }
          break;
        }
        case "spine": {
          // sits at collar height, between the top spine bone and the neck, turned so its local x is the body's front
          this.worldPos(c.bone, _a);
          this.worldPos(c.aim, _b);
          _dir.subVectors(_b, _a);
          c.center.copy(_a).addScaledVector(_dir, 0.55);
          c.anchor.copy(c.center);
          // aligned with the top spine bone's own axes (so it carries the chest's twist in the pose), the axis along the spine up
          worlds[c.bone].decompose(_a, _bindQ, _s);
          c.plateOffset ??= plateOffsetFor(_bindQ, _dir.clone().normalize());
          c.quat.copy(_bindQ).multiply(c.plateOffset);
          break;
        }
        case "tip": {
          // The fingertip: where the pose has it, or, while it is being moved, where it was dragged to (as an IK target works, so the
          // gizmo and the diamond never disagree). Its frame is the tip bone's own rotation, read fresh every frame.
          const f = c.def.finger!;
          if (c.bone >= 0) worlds[c.bone].decompose(_pos, c.quat, _s);
          // the outline sits on the finger with its dome at the tip, pointing the way the finger points
          c.draw ??= { center: new THREE.Vector3(), quat: new THREE.Quaternion() };
          const dirLocal = actor.fingerTipDirection(f.side, f.name);
          c.draw.quat.copy(c.quat).multiply(_tipQ.setFromUnitVectors(_up, dirLocal));
          if (this.tipTarget?.id === c.def.id) c.center.copy(this.tipTarget.pos);
          else actor.fingerTip(f.side, f.name, c.center);
          // the control is placed a little off the real fingertip (in its own frame: x across, y along the finger, z out of the pad)
          const nudge = TIP_NUDGE[f.name];
          if (nudge) c.center.add(_dir.set(nudge[0], nudge[1], nudge[2]).applyQuaternion(c.draw.quat));
          c.anchor.copy(c.center);
          c.draw.center.copy(c.center).addScaledVector(_dir.copy(dirLocal).applyQuaternion(c.quat), -c.def.radius);
          break;
        }
        case "ik":
          c.center.copy(c.limb!.target);
          c.anchor.copy(c.center);
          c.quat.copy(c.limb!.targetQuat);
          if (c.limb!.def.id.startsWith("arm")) {
            // The hand target is a bracelet: a ring around the forearm just above the wrist, its normal along the forearm. The forearm's
            // direction is fixed in the target's own frame when the rig attaches (like the head and neck rings are tied to their bones'
            // frames), so the ring follows the target when it is moved or turned, and its gizmo shares its frame.
            c.draw ??= { center: new THREE.Vector3(), quat: new THREE.Quaternion() };
            if (!c.plateLocal) {
              this.worldPos(c.limb!.bones[2], _a);
              this.worldPos(c.limb!.bones[1], _b);
              // a copy: the scratch vector _a is reused by every other control, and would overwrite the direction
              c.plateLocal = _a.clone().sub(_b).normalize().applyQuaternion(_bindQ.copy(c.limb!.targetQuat).invert());
            }
            c.draw.quat.copy(c.limb!.targetQuat).multiply(_tipQ.setFromUnitVectors(_z, c.plateLocal));
            // a little way back up the forearm from the wrist joint
            c.draw.center.copy(c.center).addScaledVector(_dir.copy(c.plateLocal).applyQuaternion(c.limb!.targetQuat), -c.def.radius * 0.5);
          }
          if (c.aim >= 0) {
            // The foot plate lies under the foot (ankle to toes), aligned with the foot's own orientation when the rig attaches; from then
            // on it is tied to the foot target's own frame, so it turns and moves with the target.
            c.draw ??= { center: new THREE.Vector3(), quat: new THREE.Quaternion() };
            if (!c.plateOffset) {
              this.worldPos(c.bone, _a);
              this.worldPos(c.aim, _b);
              worlds[c.bone].decompose(_c, _bindQ, _s);
              _dir.subVectors(_b, _a);
              if (_dir.lengthSq() < 1e-6) _dir.set(1, 0, 0);
              // aligned with the foot as the pose has it (its pitch, turn and roll), like the shoulder plates are with the collar bones
              const frame = footPlateFrame(_bindQ, _dir);
              c.plateOffset = _bindQ.clone().invert().multiply(frame);
              const mid = _a.clone().add(_b).multiplyScalar(0.5).addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(frame), -0.3);
              c.plateLocal = mid.sub(_a).applyQuaternion(_bindQ.clone().invert());
            }
            c.draw.quat.copy(c.limb!.targetQuat).multiply(c.plateOffset);
            c.draw.center.copy(c.plateLocal!).applyQuaternion(c.limb!.targetQuat).add(c.center);
            // the gizmo takes the plate's frame, not the ankle bone's own one
            c.quat.copy(c.draw.quat);
          }
          break;
        case "pole":
          c.center.copy(c.limb!.pole);
          c.anchor.copy(c.center);
          c.quat.identity();
          this.setStem(c, this.worldPos(c.limb!.bones[1], _a), c.center);
          break;
        case "eye": {
          const st = this.state!;
          c.center.copy(st.eye.target);
          c.anchor.copy(c.center);
          c.quat.identity();
          const frame = actor.eyeFrame(_m);
          if (frame) this.setStem(c, _a.setFromMatrixPosition(frame), c.center);
          break;
        }
      }
      c.obj.position.copy(c.draw ? c.draw.center : c.center);
      c.obj.quaternion.copy(c.draw ? c.draw.quat : c.quat);
      c.obj.scale.setScalar(c.scale);
      const mat = this.material(this.colorOf(c));
      c.obj.material = mat;
      if (c.stem) c.stem.material = mat;
    }
    if (this.selectedId) {
      if (!this.drag) this.syncPivot();
      else if ((this.rotGizmo as unknown as { dragging: boolean }).dragging || (this.viewGizmo as unknown as { dragging: boolean }).dragging || this.modal?.mode === "rotate") {
        // while turning a control, its gizmo stays on the control as the control moves (a chest or shoulder turns about its bones,
        // so its centre drifts), instead of staying where the drag began
        const sel = this.controls.find((c) => c.def.id === this.selectedId);
        if (sel) this.pivot.position.copy(sel.anchor);
      }
    }
  }

  private setStem(c: Control, from: THREE.Vector3, to: THREE.Vector3) {
    if (!c.stem) return;
    const attr = c.stem.geometry.getAttribute("position") as THREE.BufferAttribute;
    attr.setXYZ(0, from.x, from.y, from.z);
    attr.setXYZ(1, to.x, to.y, to.z);
    attr.needsUpdate = true;
  }

  /** The control whose shape is closest to a client position, within a few pixels; null otherwise. */
  pick(clientX: number, clientY: number): string | null {
    const actor = this._actor;
    const model = actor?.modelMatrix;
    if (!actor || !model || !this.active) return null;
    const rect = this.dom.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    let best: string | null = null;
    let bestDist = PICK_RADIUS;
    const p0 = new THREE.Vector2();
    const p1 = new THREE.Vector2();
    const project = (v: THREE.Vector3, out: THREE.Vector2) => {
      v.applyMatrix4(model).project(this.camera);
      if (v.z > 1) return false;
      out.set(((v.x + 1) / 2) * rect.width, ((1 - v.y) / 2) * rect.height);
      return true;
    };
    for (const c of this.controls) {
      if (!c.obj.visible) continue;
      const n = c.segs.length / 6;
      _m.compose(c.obj.position, c.obj.quaternion, _s.setScalar(c.scale));
      for (let i = 0; i < n; i++) {
        _a.set(c.segs[i * 6], c.segs[i * 6 + 1], c.segs[i * 6 + 2]).applyMatrix4(_m);
        _b.set(c.segs[i * 6 + 3], c.segs[i * 6 + 4], c.segs[i * 6 + 5]).applyMatrix4(_m);
        if (!project(_a, p0) || !project(_b, p1)) continue;
        const d = distToSegment(px, py, p0, p1);
        if (d < bestDist) {
          bestDist = d;
          best = c.def.id;
        }
      }
    }
    return best;
  }

  /** Highlights the control under the cursor (null: none). Returns whether it changed. */
  hover(id: string | null): boolean {
    if (id === this.hoverId) return false;
    this.hoverId = id;
    return true;
  }

  select(id: string | null) {
    if (id === this.selectedId) return;
    this.selectedId = id;
    const c = id ? this.controls.find((x) => x.def.id === id && this.isVisible(x)) : null;
    const kind = c?.def.kind;
    if (c) this.syncPivot();
    const rotate = kind === "fk" || kind === "spine" || kind === "ik" || kind === "pelvis" || kind === "finger" || kind === "tip";
    // the curl control has only its hinge ring (X): it does nothing but curl the finger
    this.rotGizmo.showY = kind !== "finger";
    this.rotGizmo.showZ = kind !== "finger";
    this.applySpace();
    if (c) this.syncPivot();
    const move = kind === "pelvis" || kind === "ik" || kind === "pole" || kind === "eye" || kind === "tip" || (kind === "fk" && !!c?.def.movable);
    this.selectionCan = { rotate, view: rotate, move };
    this.applyParts();
    this.onSelect(c ? c.def.id : null);
  }

  /** The dot in the middle of the view ring: grab it to move the control in the view plane. */
  private readonly centerDot = (() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3));
    // a filled circle (a point is a square unless it has a round picture to show)
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff";
    g.beginPath();
    g.arc(32, 32, 30, 0, Math.PI * 2);
    g.fill();
    const mat = new THREE.PointsMaterial({ color: 0xffe14a, size: 26, sizeAttenuation: false, map: new THREE.CanvasTexture(c), alphaTest: 0.5, depthTest: false, depthWrite: false, transparent: true, toneMapped: false });
    const dot = new THREE.Points(geo, mat);
    dot.renderOrder = 1002;
    dot.frustumCulled = false;
    dot.visible = false;
    return dot;
  })();

  /** Whether the dot is shown: the view ring is on for a control that can move. */
  private centerShown(): boolean {
    return this.centerDot.visible;
  }

  /** Whether a screen position is on the dot. */
  private overCenter(clientX: number, clientY: number): boolean {
    const p = this.toScreen(this.pivot.getWorldPosition(new THREE.Vector3()));
    return Math.hypot(clientX - p.x, clientY - p.y) <= 15;
  }

  private updateCenterHover(clientX: number, clientY: number, pressed: boolean) {
    if (!this.centerShown() || pressed) return;
    const over = this.overCenter(clientX, clientY);
    (this.centerDot.material as THREE.PointsMaterial).color.set(over ? 0xffffff : 0xffe14a);
    this.dom.style.cursor = over ? "move" : "";
  }

  /** What the selected control allows (before the user's choice of gizmos). */
  private selectionCan = { rotate: false, view: false, move: false };

  /** Shows the gizmos the selected control allows and the user wants: the move arrows, the rotation rings, the ring about the line of sight. */
  private applyParts() {
    const can = this.selectionCan;
    const rotate = can.rotate && this.parts.rotate;
    const view = can.view && this.parts.view;
    const move = can.move && this.parts.move;
    this.rotGizmo.getHelper().visible = rotate;
    this.rotGizmo.enabled = rotate;
    this.viewGizmo.getHelper().visible = view;
    this.viewGizmo.enabled = view;
    this.moveGizmo.getHelper().visible = move;
    this.moveGizmo.enabled = move;
    const scale = this.parts.scale && this.active && this.controls.some((c) => c.def.id === this.selectedId && c.bone >= 0 && c.def.kind !== "pole" && c.def.kind !== "eye");
    this.scaleGizmo.getHelper().visible = scale;
    this.scaleGizmo.enabled = scale;
    // the dot only needs the control to be movable (a pole helper has no rotation, so it gets the dot without the ring)
    this.centerDot.visible = this.parts.view && can.move;
    if (!this.centerDot.visible) this.dom.style.cursor = "";
  }

  /** Chooses which gizmos show on the selected control (and on the ones selected later). */
  setGizmoParts(parts: { move: boolean; rotate: boolean; scale?: boolean; view: boolean }) {
    this.parts = { ...parts, scale: parts.scale === true };
    this.applyParts();
  }

  // --- gizmo edits ---------------------------------------------------------------------------------------------

  private beginDrag() {
    const actor = this._actor;
    const st = this.state;
    const c = this.controls.find((x) => x.def.id === this.selectedId);
    if (!actor || !st || !c || this.drag) return;
    actor.recordUndo();
    const startFrame = this.localOrientation || c.def.kind === "finger" ? c.quat.clone() : new THREE.Quaternion();
    this.pivot.quaternion.copy(startFrame);
    const partnerId = this.mirror ? mirrorId(c.def.id) : null;
    const partner = partnerId ? this.controls.find((x) => x.def.id === partnerId) ?? null : null;
    const d: DragState = { startFrame, control: c, partner, startPivot: this.pivot.position.clone(), startWorld: new THREE.Quaternion(), partnerStartWorld: new THREE.Quaternion() };
    d.startScale = c.bone >= 0 ? new THREE.Vector3().fromArray(actor.pose!.scale!, c.bone * 3) : undefined;
    d.partnerScale = partner && partner.bone >= 0 ? new THREE.Vector3().fromArray(actor.pose!.scale!, partner.bone * 3) : undefined;
    if ((c.def.kind === "fk" || c.def.kind === "pelvis") && c.bone >= 0) this.worldQuat(c.bone, d.startWorld);
    if (partner && partner.def.kind === "fk" && partner.bone >= 0) this.worldQuat(partner.bone, d.partnerStartWorld);
    if (c.def.kind === "spine") {
      const names = actor.boneNames.map((n) => n.toLowerCase());
      d.spine = SPINE_BONES.map((n) => names.indexOf(n));
      d.spineLocal = d.spine.map((b) => new THREE.Quaternion().fromArray(actor.pose!.quat, b * 4));
    }
    if (c.def.kind === "finger" && c.def.finger) {
      d.startWorld.copy(c.quat); // the gizmo frame: the fingertip bone's rotation
      d.hinge = FINGER_AXIS.clone().applyQuaternion(d.startWorld);
      d.curlStart = actor.getFingerCurl(c.def.finger.side, c.def.finger.name);
      if (partner?.def.finger) d.partnerCurlStart = actor.getFingerCurl(partner.def.finger.side, partner.def.finger.name);
    }
    if (c.def.kind === "tip" && c.def.finger) {
      d.tipStart = actor.fingerTip(c.def.finger.side, c.def.finger.name)?.clone();
      this.worldQuat(c.bone, d.startWorld);
      d.tipExtra = actor.tipExtra(c.def.finger.side, c.def.finger.name);
      if (partner?.def.finger) {
        d.partnerTipStart = actor.fingerTip(partner.def.finger.side, partner.def.finger.name)?.clone();
        this.worldQuat(partner.bone, d.partnerStartWorld);
        d.partnerTipExtra = actor.tipExtra(partner.def.finger.side, partner.def.finger.name);
      }
    }
    if (c.def.kind === "pelvis") d.startLocalPos = new THREE.Vector3().fromArray(actor.pose!.pos, c.bone * 3);
    if (c.def.kind === "fk" && c.def.movable && c.bone >= 0) {
      d.startBoneWorld = this.worldPos(c.bone);
      d.parentInv = this.parentInverse(c.bone);
      if (partner && partner.def.movable && partner.bone >= 0) {
        d.partnerStartBoneWorld = this.worldPos(partner.bone);
        d.partnerParentInv = this.parentInverse(partner.bone);
      }
    }
    if (c.limb) {
      d.startTarget = c.limb.target.clone();
      d.startQuat = c.limb.targetQuat.clone();
      d.startPole = c.limb.pole.clone();
      const pl = partner?.limb;
      if (pl) {
        d.partnerLimb = pl;
        d.partnerTarget = pl.target.clone();
        d.partnerQuat = pl.targetQuat.clone();
        d.partnerPole = pl.pole.clone();
      }
    }
    if (c.def.kind === "eye") d.startTarget = st.eye.target.clone();
    this.drag = d;
  }

  private applyDrag(mode: "rotate" | "translate" | "scale") {
    const d = this.drag;
    const actor = this._actor;
    const st = this.state;
    if (!d || !actor || !st) return;
    const c = d.control;
    if (mode === "scale") {
      if (d.startScale) actor.setBoneScale(c.bone, d.startScale.clone().multiply(this.pivot.scale));
      if (d.partnerScale && d.partner) actor.setBoneScale(d.partner.bone, d.partnerScale.clone().multiply(this.pivot.scale));
      this.solveAll(); this.onEdit(); return;
    }
    // the turn since the drag began, as a rotation in model space (the gizmo may be turned to the control's own frame)
    const dq = this.pivot.quaternion.clone().multiply(d.startFrame.clone().invert());
    const dp = this.pivot.position.clone().sub(d.startPivot);
    switch (c.def.kind) {
      case "fk":
        if (mode === "translate") {
          // move a detail bone: its model-space position follows the gizmo, converted into its parent's frame
          if (!c.def.movable || !d.startBoneWorld || !d.parentInv) break;
          const local = d.startBoneWorld.clone().add(dp).applyMatrix4(d.parentInv);
          actor.setBonePos(c.bone, local.x, local.y, local.z);
          if (d.partner?.def.movable && d.partnerStartBoneWorld && d.partnerParentInv) {
            const pl = d.partnerStartBoneWorld.clone().add(mirrorVec(dp)).applyMatrix4(d.partnerParentInv);
            actor.setBonePos(d.partner.bone, pl.x, pl.y, pl.z);
          }
          break;
        }
        this.turnBone(c.bone, d.startWorld, dq);
        if (d.partner && d.partner.bone >= 0 && d.partner.def.kind === "fk") this.turnBone(d.partner.bone, d.partnerStartWorld, mirrorQuat(dq));
        break;
      case "finger": {
        if (mode !== "rotate" || !c.def.finger || !d.hinge || d.curlStart === undefined) break;
        // the turn about the finger's hinge becomes a change of curl; the ring follows the fingertip, which turns by the sum of the
        // joints' angles, so the mouse turn is divided by the total range of the finger and the ring stays in step with the mouse
        let angle = 2 * Math.atan2(dq.x * d.hinge.x + dq.y * d.hinge.y + dq.z * d.hinge.z, dq.w);
        if (angle > Math.PI) angle -= 2 * Math.PI;
        if (angle < -Math.PI) angle += 2 * Math.PI;
        const delta = ((angle * 180) / Math.PI) / totalCurlRange(c.def.finger.name);
        actor.setFingerCurl(c.def.finger.side, c.def.finger.name, d.curlStart + delta, true);
        const pf = d.partner?.def.finger && d.partnerCurlStart !== undefined ? d.partner.def.finger : null;
        if (pf) actor.setFingerCurl(pf.side, pf.name, d.partnerCurlStart! + delta, true);
        break;
      }
      case "tip": {
        if (!c.def.finger || !d.tipStart) break;
        const pf = d.partner?.def.finger;
        if (mode === "translate") {
          const target = d.tipStart.clone().add(dp);
          this.tipTarget = { id: c.def.id, pos: target };
          actor.solveFingerTip(c.def.finger.side, c.def.finger.name, target);
          if (pf && d.partnerTipStart) actor.solveFingerTip(pf.side, pf.name, d.partnerTipStart.clone().add(mirrorVec(dp)));
        } else if (d.tipExtra) {
          // turn the tip joint: the model-space turn, expressed in the joint's own frame, goes on top of the turn it had
          const local = d.startWorld.clone().invert().multiply(dq).multiply(d.startWorld);
          actor.setTipExtra(c.def.finger.side, c.def.finger.name, d.tipExtra.clone().multiply(local));
          if (pf && d.partnerTipExtra) {
            const pl = d.partnerStartWorld.clone().invert().multiply(mirrorQuat(dq)).multiply(d.partnerStartWorld);
            actor.setTipExtra(pf.side, pf.name, d.partnerTipExtra.clone().multiply(pl));
          }
        }
        break;
      }
      case "spine": {
        if (mode !== "rotate" || !d.spine || !d.spineLocal) break;
        d.spine.forEach((b, i) => b >= 0 && actor.setBoneQuat(b, d.spineLocal![i]));
        const id = new THREE.Quaternion();
        d.spine.forEach((b, i) => {
          if (b < 0) return;
          const part = id.clone().slerp(dq, SPINE_WEIGHTS[i]);
          this.turnBone(b, this.worldQuat(b), part);
        });
        break;
      }
      case "pelvis": {
        if (!d.startLocalPos) break;
        if (mode === "translate") actor.setBonePos(c.bone, d.startLocalPos.x + dp.x, d.startLocalPos.y + dp.y, d.startLocalPos.z + dp.z);
        else this.turnBone(c.bone, d.startWorld, dq);
        break;
      }
      case "ik": {
        const l = c.limb!;
        if (mode === "translate") {
          l.target.copy(d.startTarget!).add(dp);
          if (d.partnerLimb) d.partnerLimb.target.copy(d.partnerTarget!).add(mirrorVec(dp));
        } else {
          l.targetQuat.copy(dq).multiply(d.startQuat!);
          if (d.partnerLimb) d.partnerLimb.targetQuat.copy(mirrorQuat(dq)).multiply(d.partnerQuat!);
        }
        break;
      }
      case "pole": {
        const l = c.limb!;
        l.pole.copy(d.startPole!).add(dp);
        if (d.partnerLimb) d.partnerLimb.pole.copy(d.partnerPole!).add(mirrorVec(dp));
        break;
      }
      case "eye":
        if (mode !== "translate") break;
        st.eye.target.copy(d.startTarget!).add(dp);
        break;
    }
    this.solveAll();
    this.onEdit();
  }

  // --- hotkeys: Shift + W / E / R edit by mouse, Alt + W / E / R reset ---------------------------------------------

  private installHotkeys() {
    const dom = this.dom;
    dom.addEventListener("pointermove", (e) => {
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
      if (this.modal) this.updateModal();
      else this.updateCenterHover(e.clientX, e.clientY, e.buttons !== 0);
    });
    dom.addEventListener("pointerenter", () => (this.pointer.inside = true));
    dom.addEventListener("pointerleave", () => (this.pointer.inside = false));
    // while a transform runs, a click confirms (right click cancels) and nothing else sees the click
    dom.addEventListener(
      "pointerdown",
      (e) => {
        if (!this.modal) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        this.endModal(e.button !== 2);
      },
      true,
    );
    // Dragging the dot in the middle of the view ring moves the control in the plane facing the camera: the transform of the G key, held
    // for as long as the button is down. The ring itself rotates about the line of sight.
    dom.addEventListener(
      "pointerdown",
      (e) => {
        if (this.modal || e.button !== 0 || (this.scaleGizmo.enabled && this.scaleGizmo.axis !== null) || !this.centerShown() || !this.overCenter(e.clientX, e.clientY)) return;
        this.pointer.x = e.clientX;
        this.pointer.y = e.clientY;
        e.stopImmediatePropagation();
        e.preventDefault();
        if (!this.startModal("translate")) return;
        const done = () => {
          window.removeEventListener("pointerup", done, true);
          window.removeEventListener("pointercancel", done, true);
          if (this.modal) this.endModal(true);
        };
        window.addEventListener("pointerup", done, true);
        window.addEventListener("pointercancel", done, true);
      },
      true,
    );
    dom.addEventListener("contextmenu", (e) => {
      if (this.modal) e.preventDefault();
    });
    window.addEventListener("keydown", (e) => {
      const t = e.target as HTMLElement | null;
      if (e.repeat || t?.isContentEditable || (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      // Alt + W puts the selected control back to its position at the start of posing, Alt + E to its rotation, Alt + R to its scale
      if (e.altKey && !e.ctrlKey && !e.metaKey && gizmoKey(e) && this.active && this.pointer.inside && this.selectedId && !this.drag && !this.modal) {
        if (this.resetSelected(gizmoKey(e) === "move" ? "position" : gizmoKey(e) === "scale" ? "scale" : "rotation")) e.preventDefault();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (this.modal) {
        if (key === "escape") this.endModal(false);
        else if (key === "enter") this.endModal(true);
        else if (key === "x" || key === "y" || key === "z") {
          // pressing the same axis again goes back to free movement
          const axis = key as "x" | "y" | "z";
          this.modal.axis = this.modal.axis === axis ? null : axis;
          this.updateModal();
        } else return;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const tool = e.shiftKey ? gizmoKey(e) : null;
      if (tool && this.active && this.pointer.inside && this.selectedId && !this.drag) {
        if (this.startModal(tool === "move" ? "translate" : tool)) e.preventDefault();
      }
    });
  }

  /**
   * Puts the selected control back to where it was when posing started: its position (a moved pelvis or detail bone; for a hand or foot
   * target the arm or leg is put back, which is where the target stands) or its rotation (the bone, or the hand / foot of a target).
   * False when the control has nothing to reset that way.
   */
  resetSelected(what: "position" | "rotation" | "scale"): boolean {
    const c = this.controls.find((x) => x.def.id === this.selectedId && this.isVisible(x));
    const actor = this._actor;
    if (!c || !actor) return false;
    if (what === "scale") {
      if (c.bone < 0 || c.def.kind === "pole" || c.def.kind === "eye") return false;
      actor.recordUndo();
      actor.setBoneScale(c.bone, new THREE.Vector3(1,1,1));
      const partnerId = this.mirror ? mirrorId(c.def.id) : null;
      const partner = partnerId ? this.controls.find(control => control.def.id === partnerId) : null;
      if (partner && partner.bone >= 0) actor.setBoneScale(partner.bone, new THREE.Vector3(1,1,1));
      this.afterExternalChange(); this.onEdit(); return true;
    }
    let bones: number[] = [];
    let position = false;
    let rotation = false;
    const kind = c.def.kind;
    if (kind === "ik" && c.limb) {
      const [u, m, end] = c.limb.bones;
      if (what === "position") {
        bones = [u, m];
        rotation = true; // an IK target stands where the limb's joints put it
      } else {
        bones = [end];
        rotation = true;
      }
    } else if (what === "position") {
      if (kind === "pelvis" || (kind === "fk" && c.def.movable)) {
        bones = [c.bone];
        position = true;
      }
    } else if (kind === "fk" || kind === "spine" || kind === "pelvis" || kind === "finger" || kind === "tip") {
      bones = [c.bone];
      rotation = true;
    }
    if (bones.length === 0 || bones.some((b) => b < 0)) return false;
    actor.resetBones(bones, position, rotation);
    this.afterExternalChange();
    this.onEdit();
    return true;
  }

  /** Starts a G (translate) or R (rotate) transform on the selected control; false when the control cannot do that. */
  private startModal(mode: "translate" | "rotate" | "scale"): boolean {
    const c = this.controls.find((x) => x.def.id === this.selectedId && this.isVisible(x));
    if (!c || !this._actor) return false;
    const kind = c.def.kind;
    const canMove = kind === "pelvis" || kind === "ik" || kind === "pole" || kind === "eye" || kind === "tip" || (kind === "fk" && !!c.def.movable);
    const canTurn = kind === "fk" || kind === "spine" || kind === "ik" || kind === "pelvis" || kind === "finger" || kind === "tip";
    if (mode === "scale" ? c.bone < 0 || kind === "pole" || kind === "eye" : mode === "translate" ? !canMove : !canTurn) return false;
    this.beginDrag();
    const d = this.drag;
    if (!d) return false;
    this.orbit.enabled = false;
    const cam = this.camera;
    const model = this.root.matrix;
    const pivotWorld = d.startPivot.clone().applyMatrix4(model);
    const normal = cam.getWorldDirection(new THREE.Vector3());
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, pivotWorld);
    const start = { x: this.pointer.x, y: this.pointer.y };
    const hit = this.rayOnPlane(start.x, start.y, plane);
    const screen = this.toScreen(pivotWorld);
    this.modal = { mode, axis: null, start, plane, startHit: hit ?? pivotWorld, pivotScreen: screen, startAngle: Math.atan2(start.y - screen.y, start.x - screen.x), inverse: model.clone().invert() };
    this.updateModal();
    return true;
  }

  private rayOnPlane(clientX: number, clientY: number, plane: THREE.Plane): THREE.Vector3 | null {
    const rect = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    return ray.ray.intersectPlane(plane, new THREE.Vector3());
  }

  private toScreen(world: THREE.Vector3): { x: number; y: number } {
    const rect = this.dom.getBoundingClientRect();
    const p = world.clone().project(this.camera);
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
  }

  /** Applies the mouse movement since the transform started, like the gizmo would have. */
  private updateModal() {
    const m = this.modal;
    const d = this.drag;
    if (!m || !d) return;
    // X / Y / Z are the axes of the gizmo: the control's own frame when the gizmo is local (the default; a finger always), else the
    // character's axes. The frame is the one the gizmo had when the transform started.
    const axisVec = m.axis ? new THREE.Vector3(m.axis === "x" ? 1 : 0, m.axis === "y" ? 1 : 0, m.axis === "z" ? 1 : 0).applyQuaternion(d.startFrame) : null;
    let info: string;
    if (m.mode === "scale") {
      const factor = keyboardScaleFactor(this.pointer.x - m.start.x, this.pointer.y - m.start.y);
      this.pivot.scale.set(m.axis && m.axis !== "x" ? 1 : factor, m.axis && m.axis !== "y" ? 1 : factor, m.axis && m.axis !== "z" ? 1 : factor);
      this.applyDrag("scale");
      info = `Scale ${m.axis ? m.axis.toUpperCase() + " axis" : "uniform"}: ${factor.toFixed(2)}×`;
    } else if (m.mode === "translate") {
      const hit = this.rayOnPlane(this.pointer.x, this.pointer.y, m.plane);
      const delta = hit ? hit.clone().applyMatrix4(m.inverse).sub(m.startHit.clone().applyMatrix4(m.inverse)) : new THREE.Vector3();
      if (axisVec) {
        // only the part of the movement along the axis (the dot product has to be taken before the vector is overwritten)
        const along = delta.dot(axisVec);
        delta.copy(axisVec).multiplyScalar(along);
      }
      this.pivot.position.copy(d.startPivot).add(delta);
      this.applyDrag("translate");
      info = `Grab ${m.axis ? m.axis.toUpperCase() + " axis" : "free"}: ${delta.length().toFixed(1)} units`;
    } else {
      const angle = Math.atan2(this.pointer.y - m.pivotScreen.y, this.pointer.x - m.pivotScreen.x) - m.startAngle;
      // about the view direction (clockwise on screen is positive), or about the chosen model axis, turned the way the view sees it
      const view = this.camera.getWorldDirection(new THREE.Vector3()).transformDirection(m.inverse).normalize();
      const axis = axisVec ?? view;
      const turn = axisVec && axisVec.dot(view) < 0 ? -angle : angle;
      const dq = new THREE.Quaternion().setFromAxisAngle(axis, turn);
      this.pivot.quaternion.copy(dq).multiply(d.startFrame);
      this.applyDrag("rotate");
      info = `Rotate ${m.axis ? m.axis.toUpperCase() + " axis" : "view"}: ${(((turn * 180) / Math.PI + 540) % 360 - 180).toFixed(1)}°`;
    }
    this.onModal(`${info}. X / Y / Z picks an axis, click or Enter confirms, Esc cancels.`);
  }

  /** Ends the G / R transform: keeps it, or puts everything back. */
  private endModal(confirm: boolean) {
    const m = this.modal;
    const d = this.drag;
    this.modal = null;
    this.orbit.enabled = true;
    if (d && !confirm) {
      this.pivot.position.copy(d.startPivot);
      this.pivot.quaternion.copy(d.startFrame);
      this.pivot.scale.set(1, 1, 1);
      this.drag = d;
      if (m?.mode === "scale") this.applyDrag("scale");
      else { this.applyDrag("translate"); this.applyDrag("rotate"); }
      this._actor?.discardUndo();
    }
    this.drag = null;
    this.tipTarget = null;
    this.syncPivot();
    if (m) this.onModal(null);
    this.onEdit();
  }

  private endDrag() {
    this.drag = null;
    this.tipTarget = null;
    this.syncPivot();
  }

  dispose() {
    this.setActor(null);
    this.gizmos.dispose();
    for (const g of this.geometries.values()) g.dispose();
    for (const m of this.materials.values()) m.dispose();
  }
}

interface ModalState {
  mode: "translate" | "rotate" | "scale";
  /** The model axis the movement is limited to, or free. */
  axis: "x" | "y" | "z" | null;
  start: { x: number; y: number };
  plane: THREE.Plane;
  startHit: THREE.Vector3;
  pivotScreen: { x: number; y: number };
  startAngle: number;
  /** Scene to model space. */
  inverse: THREE.Matrix4;
}

interface DragState {
  startScale?: THREE.Vector3;
  partnerScale?: THREE.Vector3;
  /** The orientation the pivot had when the drag began (identity in global orientation). */
  startFrame: THREE.Quaternion;
  control: Control;
  partner: Control | null;
  startPivot: THREE.Vector3;
  startWorld: THREE.Quaternion;
  partnerStartWorld: THREE.Quaternion;
  spine?: number[];
  spineLocal?: THREE.Quaternion[];
  startLocalPos?: THREE.Vector3;
  /** Finger controls: the hinge axis (model space), and the curl of the finger (and its mirror partner) when the drag began. */
  hinge?: THREE.Vector3;
  curlStart?: number;
  partnerCurlStart?: number;
  /** Tip controls: where the fingertip (and its mirror partner's) was when the drag began. */
  tipStart?: THREE.Vector3;
  partnerTipStart?: THREE.Vector3;
  /** The turn of the tip joint (and the partner's) beyond its curl when the drag began. */
  tipExtra?: THREE.Quaternion;
  partnerTipExtra?: THREE.Quaternion;
  /** Detail controls: the bone's model-space position when the drag began, and its parent's inverse matrix. */
  startBoneWorld?: THREE.Vector3;
  parentInv?: THREE.Matrix4;
  partnerStartBoneWorld?: THREE.Vector3;
  partnerParentInv?: THREE.Matrix4;
  startTarget?: THREE.Vector3;
  startQuat?: THREE.Quaternion;
  startPole?: THREE.Vector3;
  partnerLimb?: Limb;
  partnerTarget?: THREE.Vector3;
  partnerQuat?: THREE.Quaternion;
  partnerPole?: THREE.Vector3;
}

function distToSegment(px: number, py: number, a: THREE.Vector2, b: THREE.Vector2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - a.x) * dx + (py - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}
