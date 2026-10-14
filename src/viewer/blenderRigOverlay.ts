import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Actor } from "./actor";
import { COMPACT_PROFILE, GizmoSet, gizmoKey } from "./gizmos";
import { BLENDER_TO_MODEL, FILE_TO_MODEL, LIMBS, MODEL_TO_BLENDER, type LimbId, type RigSession } from "../rig/rigSession";
import type { BlenderRigApi } from "./blenderRigApi";

/**
 * The controls of a Blender rig drawn over a posing character (desktop, personal use): each control bone with its custom shape, a click picks
 * one, the gizmo moves or turns it, and the rig (see `rig/`) works out the bones of the character, which are written into its pose.
 */

const COLORS = { left: 0x4aa8ff, right: 0xff6b5a, center: 0xffd24a, ik: 0x56d68a, tweak: 0xb9a6ff, selected: 0xffffff, hover: 0xffffa0 };
const PICK_RADIUS = 9;

/** The groups of controls the user can show. */
export interface BlenderRigGroups { fingers: boolean; misc: boolean }

interface Control {
  name: string;
  bone: number;
  /** The shape's line segments (x y z, x y z), in the control's own frame with the shape's own offset, scale and turn applied. */
  segs: Float32Array;
  obj: THREE.LineSegments;
  /** The bone the shape stands on (usually the control itself). */
  base: number;
  boneSize: number;
  side: "L" | "R" | "C";
  kind: "fk" | "ik" | "tweak" | "body";
  collections: string[];
  /** The matrix of the shape in model space, as of the last update. */
  matrix: THREE.Matrix4;
  shown: boolean;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

function distToSegment(px: number, py: number, a: THREE.Vector2, b: THREE.Vector2) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l2));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

export class BlenderRigOverlay implements BlenderRigApi {
  readonly root = new THREE.Group();
  onSelect: (name: string | null) => void = () => {};
  onEdit: () => void = () => {};
  /** The hint of a Shift + W / E transform, over the view (null when it ends). */
  onModal: (text: string | null) => void = () => {};
  groups: BlenderRigGroups = { fingers: false, misc: true };

  private _actor: Actor | null = null;
  private session: RigSession | null = null;
  private controls: Control[] = [];
  private selectedName: string | null = null;
  private hoverName: string | null = null;
  private readonly gizmos: GizmoSet;
  private readonly rotGizmo;
  private readonly viewGizmo;
  private readonly moveGizmo;
  private readonly pivot = new THREE.Object3D();
  private parts = { move: true, rotate: true, view: true };
  private localOrientation = true;
  private shown = true;
  private drag: { name: string; startModel: THREE.Matrix4; startPos: THREE.Vector3; startFrame: THREE.Quaternion } | null = null;
  private modal: Modal | null = null;
  private readonly pointer = { x: 0, y: 0, inside: false };
  private readonly materials = new Map<number, THREE.LineBasicMaterial>();
  /** Which game bone of the actor each bone of the rig is (by index of the actor's skeleton), -1 when the actor does not have it. */
  private skeleton: { names: string[]; map: Map<string, number>; fix: (THREE.Matrix4 | null)[] } | null = null;

  private readonly orbit: OrbitControls;

  constructor(private readonly camera: THREE.Camera, private readonly dom: HTMLElement, orbit: OrbitControls, scene: THREE.Scene) {
    this.orbit = orbit;
    this.root.matrixAutoUpdate = false;
    this.root.visible = false;
    this.root.add(this.pivot);
    scene.add(this.root);
    this.gizmos = new GizmoSet({ camera, dom, scene }, ["rotate", "view", "move"], { profile: COMPACT_PROFILE, pivot: this.pivot });
    this.rotGizmo = this.gizmos.controls.rotate!;
    this.viewGizmo = this.gizmos.controls.view!;
    this.moveGizmo = this.gizmos.controls.move!;
    this.gizmos.on("dragging-changed", (_role, _control, e) => {
      orbit.enabled = !e.value;
      if (e.value) this.beginDrag(); else this.endDrag();
    });
    this.gizmos.on("objectChange", (role) => this.applyDrag(role === "move"));
    this.gizmos.exclusiveDrag(() => this.applyParts());
    this.setLocal(true);
    this.applyParts();
    this.installHotkeys();
  }

  get objects(): THREE.Object3D[] { return [this.root, ...this.gizmos.objects]; }
  get gizmoHot(): boolean { return this.gizmos.hot; }
  get actor(): Actor | null { return this._actor; }
  get active(): boolean { return this._actor !== null && this.session !== null && this.shown; }
  get rigSession(): RigSession | null { return this.session; }
  get selected(): string | null { return this.selectedName; }
  get local(): boolean { return this.localOrientation; }

  setLocal(on: boolean) {
    this.localOrientation = on;
    this.gizmos.setSpace(on ? "local" : "world");
    this.syncPivot();
  }

  setShown(on: boolean) {
    this.shown = on;
    this.root.visible = on && this._actor !== null && this.session !== null;
    this.applyParts();
  }

  setGizmoParts(parts: { move: boolean; rotate: boolean; view: boolean }) {
    this.parts = { move: parts.move, rotate: parts.rotate, view: parts.view };
    this.applyParts();
  }

  forget(_actor: Actor) { /* nothing is kept per character: the controls follow the pose they are put on */ }

  // -- the rig and the character --

  /** Uses a rig on a character. False when the character's skeleton is not the rig's. */
  setActor(actor: Actor | null, session: RigSession | null = this.session): boolean {
    this.select(null);
    this._actor = actor;
    this.session = session;
    this.skeleton = null;
    this.rebuild();
    if (!actor || !session) { this.root.visible = false; return true; }
    const names = actor.boneNames;
    // how each bone's own axes lie in the model against in the rig: (the rig's rest matrix)^-1 * (the model's bind matrix, in this frame)
    const bind = actor.bindWorlds;
    const fix = names.map((n, i) => {
      const rest = session.solver.restOf(session.gameBones.get(n.toLowerCase()) ?? n);
      return rest && bind ? rest.invert().multiply(new THREE.Matrix4().multiplyMatrices(FILE_TO_MODEL, bind[i])) : null;
    });
    this.skeleton = { names, map: new Map(names.map((n, i) => [n.toLowerCase(), i])), fix };
    let have = 0;
    for (const g of session.gameBones.values()) if (this.skeleton.map.has(g.toLowerCase())) have++;
    if (have < 30) { this._actor = null; this.root.visible = false; return false; }
    this.snap();
    this.root.visible = this.shown;
    return true;
  }

  /** Puts the character's pose on the rig's controls (after the pose changed by something else: undo, a loaded pose). */
  snap() {
    const actor = this._actor;
    const session = this.session;
    const sk = this.skeleton;
    const pose = actor?.pose;
    if (!actor || !session || !sk || !pose) return;
    // the worlds from the pose itself (the bone matrices of the last frame may still be those of the animation the pose was taken from)
    const parents = actor.parents;
    const worlds: THREE.Matrix4[] = [];
    for (let i = 0; i < sk.names.length; i++) {
      const local = new THREE.Matrix4().compose(new THREE.Vector3().fromArray(pose.pos, i * 3), new THREE.Quaternion().fromArray(pose.quat, i * 4), pose.scale ? new THREE.Vector3().fromArray(pose.scale, i * 3) : new THREE.Vector3(1, 1, 1));
      worlds.push(parents[i] >= 0 ? worlds[parents[i]].clone().multiply(local) : local);
    }
    session.snapFromGame((game) => {
      const i = sk.map.get(game.toLowerCase());
      return i === undefined ? null : sk.fix[i] ? worlds[i].clone().multiply(sk.fix[i]!.clone().invert()) : worlds[i].clone();
    });
    this.refreshVisibility();
  }

  afterExternalChange() { this.snap(); }

  /** Writes the rig's bones into the character's pose. */
  private apply() {
    const actor = this._actor;
    const session = this.session;
    const sk = this.skeleton;
    const pose = actor?.pose;
    if (!actor || !session || !sk || !pose) return;
    const parents = actor.parents;
    const world: THREE.Matrix4[] = new Array(sk.names.length);
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (let i = 0; i < sk.names.length; i++) {
      const parent = parents[i] >= 0 ? world[parents[i]] : null;
      let driven = session.gameWorld(sk.names[i]);
      if (driven && sk.fix[i]) driven = driven.multiply(sk.fix[i]!);
      if (driven && session.gameBones.has(sk.names[i].toLowerCase())) {
        const local = parent ? parent.clone().invert().multiply(driven) : driven.clone();
        local.decompose(p, q, s);
        actor.setBonePos(i, p.x, p.y, p.z);
        actor.setBoneQuat(i, q);
        actor.setBoneScale(i, s);
        world[i] = driven;
      } else {
        // a bone the rig does not move: it keeps its own local pose and follows its parent
        const local = new THREE.Matrix4().compose(new THREE.Vector3().fromArray(pose.pos, i * 3), new THREE.Quaternion().fromArray(pose.quat, i * 4), pose.scale ? new THREE.Vector3().fromArray(pose.scale, i * 3) : new THREE.Vector3(1, 1, 1));
        world[i] = parent ? parent.clone().multiply(local) : local;
      }
    }
  }

  // -- the controls --

  private material(color: number) {
    let m = this.materials.get(color);
    if (!m) {
      m = new THREE.LineBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true, opacity: 0.95, toneMapped: false });
      this.materials.set(color, m);
    }
    return m;
  }

  private rebuild() {
    for (const c of this.controls) { this.root.remove(c.obj); c.obj.geometry.dispose(); }
    this.controls = [];
    const session = this.session;
    if (!session) return;
    const solver = session.solver;
    for (const bone of session.data.bones) {
      const shape = bone.shape && session.data.shapes[bone.shape.name];
      if (!bone.shape || !shape || bone.shape.name === "") continue;
      if (!bone.collections.some((c) => ["TORSO", "MISC BONES", "L ARM FK", "R ARM FK", "L ARM IK", "R ARM IK", "L LEG FK", "R LEG FK", "L LEG IK", "R LEG IK", "L FINGERS", "R FINGERS"].includes(c))) continue;
      const s = bone.shape;
      // the shape's own offset, turn and scale
      const local = new THREE.Matrix4().compose(
        new THREE.Vector3(...(s.translation as [number, number, number])),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(s.rotation[0], s.rotation[1], s.rotation[2], "ZYX")), // Blender XYZ
        new THREE.Vector3(...(s.scale as [number, number, number])).multiplyScalar(s.boneSize ? bone.length : 1), // the bone length scales the shape, not its offset
      );
      const segs = new Float32Array(shape.edges.length * 6);
      shape.edges.forEach((edge, k) => {
        for (let e = 0; e < 2; e++) {
          const v = new THREE.Vector3(...(shape.verts[edge[e]] as [number, number, number])).applyMatrix4(local);
          segs.set([v.x, v.y, v.z], k * 6 + e * 3);
        }
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(segs, 3));
      const obj = new THREE.LineSegments(geo, this.material(COLORS.center));
      obj.matrixAutoUpdate = false;
      obj.renderOrder = 1000;
      obj.frustumCulled = false;
      obj.visible = false;
      this.root.add(obj);
      const side: "L" | "R" | "C" = /_L$|\.L$/.test(bone.name) ? "L" : /_R$|\.R$/.test(bone.name) ? "R" : "C";
      const kind = /^TWEAK_|^PIN_/.test(bone.name) ? "tweak" : /^IK_|^TRGT_/.test(bone.name) ? "ik" : /^FK_/.test(bone.name) ? "fk" : "body";
      this.controls.push({
        name: bone.name, bone: solver.indexOf(bone.name), segs, obj, base: s.transformBone ? solver.indexOf(s.transformBone) : solver.indexOf(bone.name),
        boneSize: s.boneSize ? bone.length : 1, side, kind, collections: bone.collections, matrix: new THREE.Matrix4(), shown: false,
      });
    }
  }

  private colorOf(c: Control) {
    if (c.name === this.selectedName) return COLORS.selected;
    if (c.name === this.hoverName) return COLORS.hover;
    if (c.kind === "tweak") return COLORS.tweak;
    if (c.kind === "ik" && c.side === "C") return COLORS.ik;
    return c.side === "L" ? COLORS.left : c.side === "R" ? COLORS.right : COLORS.center;
  }

  /** Which controls show: the torso, the FK controls of a limb in FK and its IK controls in IK, the fingers when asked for, the extras unless hidden. */
  refreshVisibility() {
    const session = this.session;
    if (!session) return;
    const ikOf = (c: Control) => {
      const limb = LIMBS.find((l) => c.collections.some((x) => x.startsWith(l.id.startsWith("arm") ? `${l.id.endsWith("L") ? "L" : "R"} ARM` : `${l.id.endsWith("L") ? "L" : "R"} LEG`)));
      return limb ? session.ik(limb.id) : null;
    };
    for (const c of this.controls) {
      const hidden = session.solver.isHidden(c.name) ?? session.data.bones.find((b) => b.name === c.name)?.hidden ?? false;
      let shown = !hidden;
      if (shown) {
        const cols = c.collections;
        if (cols.some((x) => x.endsWith("FINGERS"))) shown = this.groups.fingers;
        else if (cols.includes("MISC BONES")) shown = this.groups.misc;
        else if (cols.includes("TORSO")) shown = true;
        else {
          const ik = ikOf(c);
          const inFk = cols.some((x) => x.endsWith(" FK")), inIk = cols.some((x) => x.endsWith(" IK"));
          shown = ik === null ? false : (inFk && inIk) || (ik ? inIk : inFk);
        }
      }
      c.shown = shown;
      c.obj.visible = shown;
    }
    if (this.selectedName && !this.controls.some((c) => c.name === this.selectedName && c.shown)) this.select(null);
  }

  /** Redraws the controls where the rig has put them. */
  update() {
    const actor = this._actor;
    const session = this.session;
    const model = actor?.modelMatrix;
    if (!actor || !session || !model || !this.root.visible) return;
    this.root.matrix.copy(model);
    this.root.matrixWorldNeedsUpdate = true;
    const pose = session.solver.pose;
    for (const c of this.controls) {
      if (!c.obj.visible) continue;
      // the shape stands on its bone's matrix with the scale taken out (a stretched bone does not stretch its shape)
      const base = pose[c.base].clone();
      const e = base.elements;
      for (let k = 0; k < 3; k++) {
        const l = Math.hypot(e[k * 4], e[k * 4 + 1], e[k * 4 + 2]) || 1;
        e[k * 4] /= l; e[k * 4 + 1] /= l; e[k * 4 + 2] /= l;
      }
      c.matrix.multiplyMatrices(BLENDER_TO_MODEL, base);
      c.obj.matrix.copy(c.matrix);
      c.obj.matrixWorldNeedsUpdate = true;
      const mat = this.material(this.colorOf(c));
      if (c.obj.material !== mat) c.obj.material = mat;
    }
    if (this.selectedName && !this.drag) this.syncPivot();
  }

  // -- picking and selecting --

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
      for (let i = 0; i < n; i++) {
        _a.set(c.segs[i * 6], c.segs[i * 6 + 1], c.segs[i * 6 + 2]).applyMatrix4(c.matrix);
        _b.set(c.segs[i * 6 + 3], c.segs[i * 6 + 4], c.segs[i * 6 + 5]).applyMatrix4(c.matrix);
        if (!project(_a, p0) || !project(_b, p1)) continue;
        const d = distToSegment(px, py, p0, p1);
        if (d < bestDist) { bestDist = d; best = c.name; }
      }
    }
    return best;
  }

  hover(name: string | null): boolean {
    if (name === this.hoverName) return false;
    this.hoverName = name;
    return true;
  }

  select(name: string | null) {
    if (name === this.selectedName) return;
    this.selectedName = name;
    this.syncPivot();
    this.applyParts();
    this.onSelect(name);
  }

  private selectedBone() {
    return this.session && this.selectedName ? this.session.data.bones.find((b) => b.name === this.selectedName) ?? null : null;
  }

  private syncPivot() {
    const session = this.session;
    const bone = this.selectedBone();
    if (!session || !bone) return;
    const world = new THREE.Matrix4().multiplyMatrices(BLENDER_TO_MODEL, session.solver.pose[session.solver.indexOf(bone.name)]);
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    world.decompose(p, q, new THREE.Vector3());
    this.pivot.position.copy(p);
    this.pivot.quaternion.copy(this.localOrientation ? q : new THREE.Quaternion());
    this.pivot.updateMatrixWorld(true);
  }

  private canMove(): boolean {
    const bone = this.selectedBone();
    return !!bone && this.active && !bone.connect && !bone.lock.loc.every(Boolean);
  }

  /** A quaternion channel always turns; euler channels can be locked axis by axis. */
  private canTurn(): boolean {
    const bone = this.selectedBone();
    return !!bone && this.active && (bone.rotationMode === "QUATERNION" || !bone.lock.rot.every(Boolean));
  }

  private applyParts() {
    const canMove = this.canMove();
    const canTurn = this.canTurn();
    const rotate = canTurn && this.parts.rotate;
    const view = canTurn && this.parts.view;
    const move = canMove && this.parts.move;
    this.rotGizmo.getHelper().visible = rotate; this.rotGizmo.enabled = rotate;
    this.viewGizmo.getHelper().visible = view; this.viewGizmo.enabled = view;
    this.moveGizmo.getHelper().visible = move; this.moveGizmo.enabled = move;
  }

  // -- editing --

  private beginDrag() {
    const actor = this._actor;
    const session = this.session;
    const bone = this.selectedBone();
    if (!actor || !session || !bone || this.drag) return;
    actor.recordUndo();
    const startModel = new THREE.Matrix4().multiplyMatrices(BLENDER_TO_MODEL, session.solver.pose[session.solver.indexOf(bone.name)]);
    this.drag = { name: bone.name, startModel, startPos: this.pivot.position.clone(), startFrame: this.pivot.quaternion.clone() };
  }

  private applyDrag(_translate: boolean) {
    const d = this.drag;
    const session = this.session;
    if (!d || !session) return;
    const dq = this.pivot.quaternion.clone().multiply(d.startFrame.clone().invert());
    const dp = this.pivot.position.clone().sub(d.startPos);
    // the turn about where the control was, then the move
    const turned = new THREE.Matrix4().makeTranslation(d.startPos.x + dp.x, d.startPos.y + dp.y, d.startPos.z + dp.z)
      .multiply(new THREE.Matrix4().makeRotationFromQuaternion(dq))
      .multiply(new THREE.Matrix4().makeTranslation(-d.startPos.x, -d.startPos.y, -d.startPos.z))
      .multiply(d.startModel);
    // (a rotation in a world frame with a local gizmo is already a world rotation: the gizmo reports the pivot's own orientation, so dq is the turn)
    session.solver.setPoseWorld(d.name, new THREE.Matrix4().multiplyMatrices(MODEL_TO_BLENDER, turned));
    session.solver.evaluate();
    this.apply();
    this.refreshVisibility();
    this.onEdit();
  }

  private endDrag() {
    this.drag = null;
    this.syncPivot();
  }

  // -- Shift + W (grab) / E (rotate): the selected control follows the mouse; X / Y / Z picks an axis, a click or Enter keeps it, Esc cancels --

  private installHotkeys() {
    const dom = this.dom;
    dom.addEventListener("pointermove", (e) => {
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
      if (this.modal) this.updateModal();
    });
    dom.addEventListener("pointerenter", () => (this.pointer.inside = true));
    dom.addEventListener("pointerleave", () => (this.pointer.inside = false));
    // while a transform runs, a click keeps it (right click cancels) and nothing else sees the click
    dom.addEventListener("pointerdown", (e) => {
      if (!this.modal) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      this.endModal(e.button !== 2);
    }, true);
    dom.addEventListener("contextmenu", (e) => { if (this.modal) e.preventDefault(); });
    window.addEventListener("keydown", (e) => {
      const t = e.target as HTMLElement | null;
      if (e.repeat || t?.isContentEditable || (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (this.modal) {
        if (key === "escape") this.endModal(false);
        else if (key === "enter") this.endModal(true);
        else if (key === "x" || key === "y" || key === "z") {
          this.modal.axis = this.modal.axis === key ? null : key;
          this.updateModal();
        } else return;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const tool = e.shiftKey ? gizmoKey(e) : null;
      if ((tool === "move" || tool === "rotate") && this.active && this.pointer.inside && this.selectedName && !this.drag) {
        if (this.startModal(tool === "move" ? "translate" : "rotate")) e.preventDefault();
      }
    });
  }

  private startModal(mode: "translate" | "rotate"): boolean {
    if (!(mode === "translate" ? this.canMove() : this.canTurn())) return false;
    this.beginDrag();
    const d = this.drag;
    if (!d) return false;
    this.orbit.enabled = false;
    const model = this.root.matrix;
    const pivotWorld = d.startPos.clone().applyMatrix4(model);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(new THREE.Vector3()), pivotWorld);
    const start = { x: this.pointer.x, y: this.pointer.y };
    const screen = this.toScreen(pivotWorld);
    this.modal = { mode, axis: null, start, plane, startHit: this.rayOnPlane(start.x, start.y, plane) ?? pivotWorld, pivotScreen: screen, startAngle: Math.atan2(start.y - screen.y, start.x - screen.x), inverse: model.clone().invert() };
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

  private updateModal() {
    const m = this.modal;
    const d = this.drag;
    if (!m || !d) return;
    // X / Y / Z: the control's own axes when the gizmo is local (the default), else the character's
    const axisVec = m.axis ? new THREE.Vector3(m.axis === "x" ? 1 : 0, m.axis === "y" ? 1 : 0, m.axis === "z" ? 1 : 0).applyQuaternion(d.startFrame) : null;
    let info: string;
    if (m.mode === "translate") {
      const hit = this.rayOnPlane(this.pointer.x, this.pointer.y, m.plane);
      const delta = hit ? hit.clone().applyMatrix4(m.inverse).sub(m.startHit.clone().applyMatrix4(m.inverse)) : new THREE.Vector3();
      if (axisVec) delta.copy(axisVec).multiplyScalar(delta.dot(axisVec));
      this.pivot.position.copy(d.startPos).add(delta);
      info = `Grab ${m.axis ? m.axis.toUpperCase() + " axis" : "free"}: ${delta.length().toFixed(1)} units`;
    } else {
      const angle = Math.atan2(this.pointer.y - m.pivotScreen.y, this.pointer.x - m.pivotScreen.x) - m.startAngle;
      const view = this.camera.getWorldDirection(new THREE.Vector3()).transformDirection(m.inverse).normalize();
      const axis = axisVec ?? view;
      const turn = axisVec && axisVec.dot(view) < 0 ? -angle : angle;
      this.pivot.quaternion.setFromAxisAngle(axis, turn).multiply(d.startFrame);
      info = `Rotate ${m.axis ? m.axis.toUpperCase() + " axis" : "view"}: ${(((turn * 180) / Math.PI + 540) % 360 - 180).toFixed(1)}°`;
    }
    this.applyDrag(m.mode === "translate");
    this.onModal(`${info}. X / Y / Z picks an axis, click or Enter confirms, Esc cancels.`);
  }

  private endModal(confirm: boolean) {
    const d = this.drag;
    const had = this.modal !== null;
    this.modal = null;
    this.orbit.enabled = true;
    if (d && !confirm) {
      this.pivot.position.copy(d.startPos);
      this.pivot.quaternion.copy(d.startFrame);
      this.applyDrag(true);
      this._actor?.discardUndo();
    }
    this.drag = null;
    this.syncPivot();
    if (had) this.onModal(null);
    this.onEdit();
  }

  // -- the sliders and limbs --

  setIk(limb: LimbId, on: boolean) {
    const session = this.session;
    if (!session || session.ik(limb) === on) return;
    this._actor?.recordUndo();
    session.setIk(limb, on);
    this.apply();
    this.refreshVisibility();
    this.onEdit();
  }

  setSlider(name: string, value: number) {
    const session = this.session;
    if (!session) return;
    this._actor?.recordUndo();
    session.setSlider(name, value);
    session.solver.evaluate();
    this.apply();
    this.refreshVisibility();
    this.onEdit();
  }

  /** The sliders of the rig's panel, with their ranges. */
  sliders(): { name: string; value: number; min: number; max: number; step: number }[] {
    const session = this.session;
    const props = session?.data.bones.find((b) => b.name === "PROPERTIES")?.props;
    if (!props || !session) return [];
    const out: { name: string; value: number; min: number; max: number; step: number }[] = [];
    for (const [name, p] of Object.entries(props)) {
      if (typeof p.value !== "number" || p.max === undefined) continue;
      const min = p.min ?? 0;
      out.push({ name, value: session.slider(name), min, max: p.max, step: p.max - min > 1 ? 1 : 0.05 });
    }
    return out;
  }

  setFingers(on: boolean) {
    this.groups.fingers = on;
    this.refreshVisibility();
  }

  /** The rig's extra controls (the belt of bullets, the pack...). */
  setMisc(on: boolean) {
    this.groups.misc = on;
    this.refreshVisibility();
  }

  dispose() {
    this.gizmos.dispose();
    for (const c of this.controls) c.obj.geometry.dispose();
    this.root.removeFromParent();
  }
}

interface Modal {
  mode: "translate" | "rotate";
  /** The axis the movement is limited to, or free. */
  axis: "x" | "y" | "z" | null;
  start: { x: number; y: number };
  plane: THREE.Plane;
  startHit: THREE.Vector3;
  pivotScreen: { x: number; y: number };
  startAngle: number;
  /** Scene to model space. */
  inverse: THREE.Matrix4;
}
