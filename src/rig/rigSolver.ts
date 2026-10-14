import * as THREE from "three";
import { bboneJoints, interpMatrices, segmentIndex, type BBoneHandle, type BBoneSettings } from "./bbone";
import type { RigBone, RigConstraint, RigData } from "./rigData";

/**
 * Evaluates a rig made in Blender the way Blender does: every bone has a rest matrix and a few channels (location, rotation, scale) that
 * the user sets; the bones are worked out parents first, each one's constraint stack runs on its matrix, and drivers (the sliders of the
 * rig's panel) decide how much each constraint counts. The result is the matrix of every bone in armature space.
 */

type Euler3 = [number, number, number];

const EPS = 1e-9;
const _q = new THREE.Quaternion();

// --- Euler angles, Blender's way -----------------------------------------------------------------------------------

/** Blender's XYZ is the matrix Rz*Ry*Rx, which three.js calls ZYX: the order is the same word reversed. */
const threeOrder = (order: string) => order.split("").reverse().join("") as THREE.EulerOrder;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** The Euler angles (x y z, radians) of a rotation matrix for a Blender order: of the two solutions, the one with the smaller sum of angles. */
export function matrixToEuler(m: THREE.Matrix4, order: string, out: Euler3 = [0, 0, 0]): Euler3 {
  const o = order === "AUTO" ? "XYZ" : order;
  const e1 = new THREE.Euler().setFromRotationMatrix(m, threeOrder(o));
  const a: Euler3 = [e1.x, e1.y, e1.z];
  // the other solution: the middle angle mirrored and the outer two turned half a circle
  const mid = threeOrder(o)[1];
  const alt: Euler3 = [a[0], a[1], a[2]];
  const axes = { X: 0, Y: 1, Z: 2 } as const;
  const mi = axes[mid as "X" | "Y" | "Z"];
  for (let k = 0; k < 3; k++) alt[k] = k === mi ? wrap(Math.PI - a[k]) : wrap(a[k] + Math.PI);
  const sum = (e: Euler3) => Math.abs(e[0]) + Math.abs(e[1]) + Math.abs(e[2]);
  const pick = sum(alt) < sum(a) - 1e-6 ? alt : a;
  out[0] = pick[0]; out[1] = pick[1]; out[2] = pick[2];
  return out;
}

export function eulerToMatrix(e: Euler3, order: string, out = new THREE.Matrix4()): THREE.Matrix4 {
  const o = order === "AUTO" ? "XYZ" : order;
  return out.makeRotationFromEuler(new THREE.Euler(e[0], e[1], e[2], threeOrder(o)));
}

// --- matrix helpers -------------------------------------------------------------------------------------------------

/** The rotation of a matrix with its scale taken out (columns normalised). */
function rotationOf(m: THREE.Matrix4, out = new THREE.Matrix4()): THREE.Matrix4 {
  out.copy(m);
  const e = out.elements;
  for (let c = 0; c < 3; c++) {
    const l = Math.hypot(e[c * 4], e[c * 4 + 1], e[c * 4 + 2]) || 1;
    e[c * 4] /= l; e[c * 4 + 1] /= l; e[c * 4 + 2] /= l;
  }
  e[12] = e[13] = e[14] = 0;
  return out;
}

function scaleOf(m: THREE.Matrix4, out = new THREE.Vector3()): THREE.Vector3 {
  const e = m.elements;
  return out.set(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10]));
}

function compose(loc: THREE.Vector3, rot: THREE.Matrix4, scale: THREE.Vector3, out = new THREE.Matrix4()): THREE.Matrix4 {
  out.copy(rot);
  const e = out.elements;
  for (let c = 0; c < 3; c++) {
    const s = c === 0 ? scale.x : c === 1 ? scale.y : scale.z;
    e[c * 4] *= s; e[c * 4 + 1] *= s; e[c * 4 + 2] *= s;
  }
  e[12] = loc.x; e[13] = loc.y; e[14] = loc.z;
  return out;
}

const positionOf = (m: THREE.Matrix4, out = new THREE.Vector3()) => out.set(m.elements[12], m.elements[13], m.elements[14]);

/** `a` and `b` blended by `t` the way Blender blends a constraint's result into the matrix it started from. */
const blend = (a: THREE.Matrix4, b: THREE.Matrix4, t: number, out = new THREE.Matrix4()): THREE.Matrix4 => (t >= 1 ? out.copy(b) : t <= 0 ? out.copy(a) : out.copy(interpMatrices(a, b, t)));

/** The eigenvalues and eigenvectors (as columns) of a symmetric 3x3 matrix, by Jacobi rotations. */
function eigenSymmetric3(m: number[][]): { values: number[]; vectors: number[][] } {
  const a = m.map((r) => r.slice());
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 30; sweep++) {
    const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    if (off < 1e-30) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
      for (let k = 0; k < 3; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < 3; k++) { const vkp = v[k][p], vkq = v[k][q]; v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq; }
    }
  }
  return { values: [a[0][0], a[1][1], a[2][2]], vectors: v };
}

// --- the solver -------------------------------------------------------------------------------------------------------

interface Channels {
  loc: THREE.Vector3;
  quat: THREE.Quaternion;
  euler: Euler3;
  scale: THREE.Vector3;
}

/** A unit of work: one bone, or the bones of one IK chain (solved together). */
interface Unit {
  bones: number[];
  /** The IK constraint of a chain, and its tip. */
  ik?: { bone: number; constraint: RigConstraint };
}

export class RigSolver {
  readonly data: RigData;
  readonly names: string[];
  private readonly index = new Map<string, number>();
  private readonly bones: RigBone[];
  private readonly rest: THREE.Matrix4[];
  private readonly restInv: THREE.Matrix4[];
  private readonly offset: THREE.Matrix4[];
  private readonly parent: number[];
  private readonly channels: Channels[];
  private readonly sliders = new Map<string, number>();
  /** The matrix of every bone in armature space, as of the last `evaluate()`. */
  readonly pose: THREE.Matrix4[];
  /** The parent transform of every bone as of the last `evaluate()`: where its local space starts. */
  private readonly pt: { rs: THREE.Matrix4; loc: THREE.Matrix4 }[];
  private units: Unit[] = [];
  private solveIk = true;
  /** The joints of the bendy bones worked out this round (they are needed by more than one constraint). */
  private readonly joints = new Map<number, THREE.Matrix4[]>();
  /** Constraint influences set by drivers: `bone|constraint` -> value (and `bone|constraint|i` for an Armature target's weight). */
  private readonly driven = new Map<string, number>();
  private readonly hidden = new Map<string, boolean>();
  /** Bones that count as "in the way" of nothing: unknown constraint types are listed here once. */
  readonly unsupported = new Set<string>();

  constructor(data: RigData) {
    this.data = data;
    this.bones = data.bones;
    this.names = data.bones.map((b) => b.name);
    this.names.forEach((n, i) => this.index.set(n, i));
    this.parent = data.bones.map((b) => (b.parent ? this.index.get(b.parent) ?? -1 : -1));
    this.rest = data.bones.map((b) => new THREE.Matrix4().fromArray(b.rest));
    this.restInv = this.rest.map((m) => m.clone().invert());
    this.offset = this.rest.map((m, i) => (this.parent[i] >= 0 ? this.restInv[this.parent[i]].clone().multiply(m) : m.clone()));
    this.channels = data.bones.map((b) => ({
      loc: new THREE.Vector3(...(b.pose.loc as [number, number, number])),
      quat: new THREE.Quaternion(b.pose.quat[1], b.pose.quat[2], b.pose.quat[3], b.pose.quat[0]),
      euler: [b.pose.euler[0], b.pose.euler[1], b.pose.euler[2]],
      scale: new THREE.Vector3(...(b.pose.scale as [number, number, number])),
    }));
    this.pose = data.bones.map((_, i) => this.rest[i].clone());
    this.pt = data.bones.map(() => ({ rs: new THREE.Matrix4(), loc: new THREE.Matrix4() }));
    for (const b of data.bones) for (const [key, slider] of Object.entries(b.props)) this.sliders.set(`${b.name}|${key}`, typeof slider.value === "boolean" ? Number(slider.value) : slider.value);
    this.units = this.plan();
  }

  /** The bones in the order they are worked out. */
  evaluationOrder(): string[] { return this.units.flatMap((u) => u.bones.map((b) => this.names[b])); }

  has(name: string) { return this.index.has(name); }
  indexOf(name: string) { return this.index.get(name) ?? -1; }

  // -- inputs --

  setSlider(bone: string, prop: string, value: number) { this.sliders.set(`${bone}|${prop}`, value); }
  slider(bone: string, prop: string) { return this.sliders.get(`${bone}|${prop}`); }

  /** Sets a bone's channels: location, rotation (a quaternion w x y z for quaternion bones, else euler angles) and scale. */
  setChannels(bone: string, ch: { loc?: number[]; rot?: number[]; scale?: number[] }) {
    const i = this.index.get(bone);
    if (i === undefined) return;
    const c = this.channels[i];
    if (ch.loc) c.loc.set(ch.loc[0], ch.loc[1], ch.loc[2]);
    if (ch.rot) {
      if (this.bones[i].rotationMode === "QUATERNION") c.quat.set(ch.rot[1], ch.rot[2], ch.rot[3], ch.rot[0]);
      else c.euler = [ch.rot[0], ch.rot[1], ch.rot[2]];
    }
    if (ch.scale) c.scale.set(ch.scale[0], ch.scale[1], ch.scale[2]);
  }

  resetChannels() {
    this.bones.forEach((_b, i) => {
      const c = this.channels[i];
      c.loc.set(0, 0, 0); c.quat.identity(); c.euler = [0, 0, 0]; c.scale.set(1, 1, 1);
    });
  }

  /** The exported data of a bone. */
  boneData(name: string): RigBone | undefined { const i = this.index.get(name); return i === undefined ? undefined : this.bones[i]; }

  /** The rest matrix of a bone in armature space. */
  restOf(name: string): THREE.Matrix4 | null { const i = this.index.get(name); return i === undefined ? null : this.rest[i].clone(); }

  /** The current channels of a bone. */
  channelsOf(name: string): { loc: THREE.Vector3; quat: THREE.Quaternion; euler: Euler3; scale: THREE.Vector3 } | null {
    const i = this.index.get(name);
    if (i === undefined) return null;
    const c = this.channels[i];
    return { loc: c.loc.clone(), quat: c.quat.clone(), euler: [...c.euler] as Euler3, scale: c.scale.clone() };
  }

  /**
   * Sets the channels of a bone so that its matrix (before its constraints) is `world`, given where its parent is now (the parent has to be
   * worked out: call `evaluate()` first). Locked channels are left alone. Meant for bones the user moves, which have no constraints.
   */
  setPoseWorld(name: string, world: THREE.Matrix4) {
    const i = this.index.get(name);
    if (i === undefined) return;
    const bone = this.bones[i];
    this.parentTransform(i);
    const local = this.toLocal(i, world);
    const c = this.channels[i];
    if (!bone.connect) {
      const p = positionOf(local);
      if (!bone.lock.loc[0]) c.loc.x = p.x;
      if (!bone.lock.loc[1]) c.loc.y = p.y;
      if (!bone.lock.loc[2]) c.loc.z = p.z;
    }
    const rot = rotationOf(local);
    if (bone.rotationMode === "QUATERNION") c.quat.setFromRotationMatrix(rot).normalize();
    else {
      // euler channels can be locked one by one (a hinge turns about one axis only)
      const e = matrixToEuler(rot, bone.rotationMode);
      for (let k = 0; k < 3; k++) if (!bone.lock.rot[k]) c.euler[k] = e[k];
    }
    if (!bone.lock.scale.some(Boolean)) c.scale.copy(scaleOf(local));
  }

  isHidden(bone: string): boolean | undefined { return this.hidden.get(bone); }

  // -- planning: which bones go together and in what order --

  private constraintBone(c: RigConstraint, key: "subtarget" | "pole_subtarget" = "subtarget"): number {
    const name = c[key];
    return typeof name === "string" && name ? this.index.get(name) ?? -1 : -1;
  }

  /** The bones a bone needs finished before it can be worked out (its parent and the targets of its constraints). */
  private needs(i: number): number[] {
    const out: number[] = [];
    if (this.parent[i] >= 0) out.push(this.parent[i]);
    for (const c of this.bones[i].constraints) {
      const t = this.constraintBone(c);
      if (t >= 0) { out.push(t); for (const h of this.handlesOf(t)) if (h >= 0) out.push(h); }
      const p = this.constraintBone(c, "pole_subtarget");
      if (p >= 0) out.push(p);
      for (const x of c.targets ?? []) if (x.subtarget && this.index.has(x.subtarget)) out.push(this.index.get(x.subtarget)!);
    }
    return out;
  }

  private plan(): Unit[] {
    const n = this.bones.length;
    // the IK chains: the tip, and its parents up the chain
    const owner = new Array<number>(n).fill(-1); // the unit a bone belongs to
    const units: Unit[] = [];
    for (let i = 0; i < n; i++) {
      const ik = this.bones[i].constraints.find((c) => c.type === "IK" && !c.mute && c.target && typeof c.subtarget === "string" && c.subtarget && this.index.has(c.subtarget));
      if (!ik) continue;
      const count = Math.max(1, Number(ik.chain_count) || 1);
      const chain: number[] = [];
      for (let b = i, k = 0; b >= 0 && k < count; b = this.parent[b], k++) chain.unshift(b);
      if (chain.some((b) => owner[b] >= 0)) continue;
      const unit: Unit = { bones: chain, ik: { bone: i, constraint: ik } };
      chain.forEach((b) => (owner[b] = units.length));
      units.push(unit);
    }
    for (let i = 0; i < n; i++) if (owner[i] < 0) { owner[i] = units.length; units.push({ bones: [i] }); }
    // dependencies between units, then a stable topological order
    const deps = units.map((u, ui) => {
      const set = new Set<number>();
      for (const b of u.bones) {
        const list = this.needs(b);
        if (u.ik && b === u.ik.bone) {
          const t = this.constraintBone(u.ik.constraint);
          if (t >= 0) list.push(t);
          const p = this.constraintBone(u.ik.constraint, "pole_subtarget");
          if (p >= 0) list.push(p);
        }
        for (const d of list) if (owner[d] !== ui) set.add(owner[d]);
      }
      return set;
    });
    const done = new Array<boolean>(units.length).fill(false);
    const order: Unit[] = [];
    const visit = (u: number, stack: Set<number>) => {
      if (done[u]) return;
      if (stack.has(u)) return; // a loop in the rig: the bone is worked out with what is there
      stack.add(u);
      for (const d of deps[u]) visit(d, stack);
      stack.delete(u);
      if (!done[u]) { done[u] = true; order.push(units[u]); }
    };
    for (let u = 0; u < units.length; u++) visit(u, new Set());
    return order;
  }

  // -- evaluation --

  /** Works out every bone. `ik: false` leaves the IK chains at their channels (quick: for when the IK is not looked at). */
  evaluate(options: { ik?: boolean } = {}) {
    this.joints.clear();
    this.applyDrivers();
    this.solveIk = options.ik !== false;
    for (const unit of this.units) {
      if (unit.ik) this.evaluateChain(unit);
      else for (const b of unit.bones) this.evaluateBone(b);
    }
  }

  /** The matrices a bone's local space is built on: its parent's pose with the rest offset, as Blender's inherit flags allow. */
  private parentTransform(i: number) {
    const bone = this.bones[i];
    const out = this.pt[i];
    const p = this.parent[i];
    const offs = this.offset[i];
    const noLocalLocation = bone.localLocation === false;
    if (p < 0) {
      out.rs.copy(offs);
      if (noLocalLocation) out.loc.identity().setPosition(positionOf(offs)); else out.loc.copy(offs);
      return out;
    }
    const parentPose = this.pose[p];
    const useRotation = bone.inheritRotation;
    const full = useRotation && bone.inheritScale === "FULL";
    // the rotation and scale part
    if (full) out.rs.multiplyMatrices(parentPose, offs);
    else {
      let tmat: THREE.Matrix4;
      if (useRotation) tmat = bone.inheritScale === "FULL" || bone.inheritScale === "FIX_SHEAR" ? parentPose.clone() : rotationOf(parentPose).setPosition(positionOf(parentPose));
      else {
        // no parent rotation: the parent's rest orientation (with its pose scale when the scale is inherited)
        tmat = this.rest[p].clone();
        if (bone.inheritScale === "FULL" || bone.inheritScale === "FIX_SHEAR") {
          const s = scaleOf(parentPose);
          const e = tmat.elements;
          for (let c = 0; c < 3; c++) { const k = c === 0 ? s.x : c === 1 ? s.y : s.z; e[c * 4] *= k; e[c * 4 + 1] *= k; e[c * 4 + 2] *= k; }
        }
      }
      out.rs.multiplyMatrices(tmat, offs);
    }
    // the location part
    if (noLocalLocation) {
      // the location is read in the parent's pose orientation, not the bone's own
      const t = positionOf(offs).applyMatrix4(parentPose);
      out.loc.copy(parentPose);
      out.loc.setPosition(t);
    } else if (!full) out.loc.multiplyMatrices(parentPose, offs);
    else out.loc.copy(out.rs);
    return out;
  }

  private basis(i: number, out = new THREE.Matrix4()): THREE.Matrix4 {
    const b = this.bones[i];
    const c = this.channels[i];
    const rot = new THREE.Matrix4();
    if (b.rotationMode === "QUATERNION") rot.makeRotationFromQuaternion(_q.copy(c.quat).normalize());
    else eulerToMatrix(c.euler, b.rotationMode, rot);
    // a connected bone keeps its head on its parent's tail: its location channel does nothing
    return compose(b.connect ? new THREE.Vector3() : c.loc, rot, c.scale, out);
  }

  /** The pose matrix a bone has from its channels alone, given the parent transform. */
  private fromChannels(i: number, pt = this.parentTransform(i)): THREE.Matrix4 {
    const basis = this.basis(i);
    const out = new THREE.Matrix4();
    // the 3x3 comes from the rotation/scale part, the location from the location part
    const rs = new THREE.Matrix4().multiplyMatrices(pt.rs, basis);
    const loc = positionOf(basis).applyMatrix4(pt.loc);
    out.copy(rs);
    out.elements[12] = loc.x; out.elements[13] = loc.y; out.elements[14] = loc.z;
    return out;
  }

  private evaluateBone(i: number) {
    const pt = this.parentTransform(i);
    this.pose[i].copy(this.fromChannels(i, pt));
    this.runConstraints(i);
  }

  // -- spaces --

  /** A matrix in armature space into a bone's local space (relative to its parent transform), or back. */
  private toLocal(i: number, m: THREE.Matrix4, out = new THREE.Matrix4()): THREE.Matrix4 {
    const pt = this.pt[i];
    const rsInv = pt.rs.clone().invert();
    const locInv = pt.loc.clone().invert();
    out.multiplyMatrices(rsInv, m);
    const l = positionOf(m).applyMatrix4(locInv);
    out.elements[12] = l.x; out.elements[13] = l.y; out.elements[14] = l.z;
    return out;
  }

  private fromLocal(i: number, m: THREE.Matrix4, out = new THREE.Matrix4()): THREE.Matrix4 {
    const pt = this.pt[i];
    out.multiplyMatrices(pt.rs, m);
    const l = positionOf(m).applyMatrix4(pt.loc);
    out.elements[12] = l.x; out.elements[13] = l.y; out.elements[14] = l.z;
    return out;
  }

  private convert(i: number, m: THREE.Matrix4, from: string | undefined, to: string | undefined): THREE.Matrix4 {
    const f = from === "LOCAL" ? "LOCAL" : "WORLD";
    const t = to === "LOCAL" ? "LOCAL" : "WORLD";
    if (f === t) return m.clone();
    return f === "WORLD" ? this.toLocal(i, m) : this.fromLocal(i, m);
  }

  // -- drivers --

  private applyDrivers() {
    for (const d of this.data.drivers) {
      const values = d.variables.map((v) => {
        const t = v.targets[0];
        const m = t && /pose\.bones\["([^"]*)"\]\["([^"]*)"\]/.exec(t.path);
        return m ? this.sliders.get(`${m[1]}|${m[2]}`) ?? 0 : 0;
      });
      let value = 0;
      if (d.type === "SUM") value = values.reduce((a, b) => a + b, 0);
      else if (d.type === "AVERAGE") value = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
      else if (d.type === "MIN") value = Math.min(...values);
      else if (d.type === "MAX") value = Math.max(...values);
      else {
        try {
          // the variables get plain names (a variable may be called `var`, which is a word of the language)
          let expression = d.expression.replace(/\bTrue\b/g, "true").replace(/\bFalse\b/g, "false");
          d.variables.forEach((v, k) => { expression = expression.replace(new RegExp(`\\b${v.name.replace(/[^A-Za-z0-9_]/g, "")}\\b`, "g"), `__v${k}`); });
          // eslint-disable-next-line no-new-func
          const result = new Function(...d.variables.map((_, k) => `__v${k}`), `return (${expression});`)(...values);
          value = Number(result);
        } catch { value = 0; }
      }
      const path = d.path;
      let m = /^pose\.bones\["([^"]*)"\]\.constraints\["([^"]*)"\]\.influence$/.exec(path);
      if (m) { this.driven.set(`${m[1]}|${m[2]}`, value); continue; }
      m = /^pose\.bones\["([^"]*)"\]\.constraints\["([^"]*)"\]\.targets\[(\d+)\]\.weight$/.exec(path);
      if (m) { this.driven.set(`${m[1]}|${m[2]}|${m[3]}`, value); continue; }
      m = /^pose\.bones\["([^"]*)"\]\.hide$/.exec(path);
      if (m) this.hidden.set(m[1], !!value);
    }
  }

  private influence(bone: RigBone, c: RigConstraint): number {
    const v = this.driven.get(`${bone.name}|${c.name}`);
    return v === undefined ? c.influence : v;
  }

  // -- constraints --

  private runConstraints(i: number, skipIk = true) {
    const bone = this.bones[i];
    const head = positionOf(this.pose[i]);
    for (const c of bone.constraints) {
      if (c.mute || c.enabled === false) continue;
      if (c.type === "IK" && skipIk) continue;
      const influence = this.influence(bone, c);
      if (influence <= 0) continue;
      const before = this.pose[i].clone();
      const ownerSpace = c.owner_space;
      const owner = this.convert(i, before, "WORLD", ownerSpace);
      const result = this.applyConstraint(i, c, owner);
      if (!result) continue;
      let world = this.convert(i, result, ownerSpace, "WORLD");
      if (influence < 1) world = blend(before, world, influence);
      this.pose[i].copy(world);
    }
    // constraints cannot pull a connected bone off its parent
    if (bone.connect && bone.constraints.length) { const e = this.pose[i].elements; e[12] = head.x; e[13] = head.y; e[14] = head.z; }
  }

  /** The handle bones (previous, next) of a bendy bone, as indices (-1: none). */
  private handlesOf(i: number): [number, number] {
    const bb = this.bones[i].bbone as BBoneSettings;
    if (!(bb.segments > 1)) return [-1, -1];
    const bone = this.bones[i];
    const byName = (n: string | null) => (n ? this.index.get(n) ?? -1 : -1);
    let prev = -1;
    let next = -1;
    if (bb.prevType === "AUTO") prev = bone.connect ? this.parent[i] : -1;
    else prev = byName(bb.prev);
    if (bb.nextType === "AUTO") {
      for (let k = 0; k < this.bones.length; k++) if (this.parent[k] === i && this.bones[k].connect) next = k;
    } else next = byName(bb.next);
    return [prev, next];
  }

  private handle(h: number): BBoneHandle | null {
    if (h < 0) return null;
    const b = this.bones[h];
    return { pose: this.pose[h], length: b.length, segments: b.bbone.segments, restHead: positionOf(this.rest[h]) };
  }

  /** The joints of a bendy bone by name (after `evaluate()`), as Blender's `bbone_segment_matrix` gives them. */
  jointsOfBone(name: string): THREE.Matrix4[] | null {
    const i = this.index.get(name);
    return i !== undefined && this.bones[i].bbone.segments > 1 ? this.bboneJointsOf(i) : null;
  }

  /** The joints of a bendy bone in its own space (Blender's bbone_pose_mats). */
  private bboneJointsOf(i: number): THREE.Matrix4[] {
    let joints = this.joints.get(i);
    if (!joints) {
      const bone = this.bones[i];
      const [prev, next] = this.handlesOf(i);
      joints = bboneJoints(bone.bbone as BBoneSettings, this.pose[i], bone.length, this.handle(prev), this.handle(next), positionOf(this.rest[i]), new THREE.Vector3(0, bone.length, 0).applyMatrix4(this.rest[i]));
      this.joints.set(i, joints);
    }
    return joints;
  }

  /** The matrix of the target of a constraint, in the space the constraint asks for (constraint_target_to_mat4). */
  private targetMatrix(_i: number, c: RigConstraint, key: "subtarget" | "pole_subtarget" = "subtarget"): THREE.Matrix4 | null {
    const t = this.constraintBone(c, key);
    if (t < 0) return null;
    const pose = this.pose[t];
    const ht = Number(c.head_tail) || 0;
    const bendy = this.bones[t].bbone.segments > 1 && !!c.use_bbone_shape;
    const full = c.type === "COPY_TRANSFORMS";
    let m: THREE.Matrix4;
    if (ht < 0.000001 && !(bendy && full)) m = pose.clone();
    else if (bendy) {
      const joints = this.bboneJointsOf(t);
      const { index, fac } = segmentIndex(this.bones[t].bbone.segments, ht);
      if (full) m = pose.clone().multiply(interpMatrices(joints[index], joints[index + 1], fac));
      else {
        const loc = positionOf(joints[index]).lerp(positionOf(joints[index + 1]), fac).applyMatrix4(pose);
        m = pose.clone();
        m.elements[12] = loc.x; m.elements[13] = loc.y; m.elements[14] = loc.z;
      }
    } else {
      const head = positionOf(pose);
      const tail = new THREE.Vector3(0, this.bones[t].length, 0).applyMatrix4(pose);
      head.lerp(tail, ht);
      m = pose.clone();
      m.elements[12] = head.x; m.elements[13] = head.y; m.elements[14] = head.z;
    }
    return this.convert(t, m, "WORLD", c.target_space);
  }

  private applyConstraint(i: number, c: RigConstraint, owner: THREE.Matrix4): THREE.Matrix4 | null {
    switch (c.type) {
      case "COPY_LOCATION": return this.copyLocation(i, c, owner);
      case "COPY_ROTATION": return this.copyRotation(i, c, owner);
      case "COPY_TRANSFORMS": { const t = this.targetMatrix(i, c); return t; }
      case "DAMPED_TRACK": return this.dampedTrack(i, c, owner);
      case "STRETCH_TO": return this.stretchTo(i, c, owner);
      case "TRANSFORM": return this.transform(i, c, owner);
      case "LIMIT_ROTATION": return this.limitRotation(c, owner);
      case "ARMATURE": return this.armature(i, c, owner);
      default:
        this.unsupported.add(c.type);
        return null;
    }
  }

  private copyLocation(i: number, c: RigConstraint, owner: THREE.Matrix4): THREE.Matrix4 | null {
    const target = this.targetMatrix(i, c);
    if (!target) return null;
    const loc = positionOf(owner);
    const tl = positionOf(target);
    const axes: ("x" | "y" | "z")[] = ["x", "y", "z"];
    for (const a of axes) {
      if (!c[`use_${a}`]) continue;
      let v = tl[a];
      if (c[`invert_${a}`]) v = -v;
      loc[a] = c.use_offset ? loc[a] + v : v;
    }
    const out = owner.clone();
    out.elements[12] = loc.x; out.elements[13] = loc.y; out.elements[14] = loc.z;
    return out;
  }

  private copyRotation(i: number, c: RigConstraint, owner: THREE.Matrix4): THREE.Matrix4 | null {
    const target = this.targetMatrix(i, c);
    if (!target) return null;
    const order = String(c.euler_order ?? "AUTO");
    const loc = positionOf(owner);
    const size = scaleOf(owner);
    const oldRot = rotationOf(owner);
    const oe = matrixToEuler(oldRot, order);
    const te = matrixToEuler(rotationOf(target), order);
    const eul: Euler3 = [oe[0], oe[1], oe[2]];
    const mix = String(c.mix_mode ?? "REPLACE");
    const use = [!!c.use_x, !!c.use_y, !!c.use_z];
    const inv = [!!c.invert_x, !!c.invert_y, !!c.invert_z];
    const sel: Euler3 = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const v = inv[k] ? -te[k] : te[k];
      sel[k] = v;
      if (!use[k]) continue;
      eul[k] = mix === "ADD" ? oe[k] + v : v;
    }
    let rot: THREE.Matrix4;
    if (mix === "BEFORE" || mix === "AFTER" || mix === "OFFSET") {
      // the copied rotation (the chosen axes of the target's) is combined with the owner's whole
      const picked: Euler3 = [use[0] ? sel[0] : 0, use[1] ? sel[1] : 0, use[2] ? sel[2] : 0];
      const copy = eulerToMatrix(picked, order);
      rot = mix === "BEFORE" || mix === "OFFSET" ? new THREE.Matrix4().multiplyMatrices(oldRot, copy) : new THREE.Matrix4().multiplyMatrices(copy, oldRot);
    } else rot = eulerToMatrix(eul, order);
    return compose(loc, rot, size);
  }

  private dampedTrack(i: number, c: RigConstraint, owner: THREE.Matrix4): THREE.Matrix4 | null {
    const target = this.targetMatrix(i, c);
    if (!target) return null;
    const loc = positionOf(owner);
    const vec = positionOf(target).sub(loc);
    if (vec.lengthSq() < EPS) return null;
    vec.normalize();
    const axisName = String(c.track_axis ?? "TRACK_Y");
    const sign = axisName.startsWith("TRACK_NEGATIVE") ? -1 : 1;
    const letter = axisName.replace("TRACK_NEGATIVE_", "").replace("TRACK_", "");
    const col = letter === "X" ? 0 : letter === "Y" ? 1 : 2;
    const e = owner.elements;
    const cur = new THREE.Vector3(e[col * 4], e[col * 4 + 1], e[col * 4 + 2]).normalize().multiplyScalar(sign);
    const q = new THREE.Quaternion().setFromUnitVectors(cur, vec);
    const out = new THREE.Matrix4().makeRotationFromQuaternion(q).multiply(owner);
    out.elements[12] = loc.x; out.elements[13] = loc.y; out.elements[14] = loc.z;
    return out;
  }

  private stretchTo(i: number, c: RigConstraint, owner: THREE.Matrix4): THREE.Matrix4 | null {
    const target = this.targetMatrix(i, c);
    if (!target) return null;
    const loc = positionOf(owner);
    const size = scaleOf(owner);
    const vec = positionOf(target).sub(loc);
    const dist = vec.length();
    if (dist < EPS) return null;
    vec.divideScalar(dist);
    const rest = Number(c.rest_length) || this.bones[i].length;
    const sy = dist / rest;
    // the other two axes keep the volume: the bulge is (rest / distance) to the power of the bulge setting
    let bulge = Math.pow(rest / dist, Number(c.bulge) || 1);
    if (c.use_bulge_min) bulge = Math.max(bulge, Number(c.bulge_min));
    if (c.use_bulge_max) bulge = Math.min(bulge, Number(c.bulge_max));
    const volume = String(c.volume ?? "VOLUME_XZX");
    // both axes share the change (the square root keeps the volume); one axis alone takes all of it
    const sx = volume === "VOLUME_XZX" ? Math.sqrt(bulge) : volume === "VOLUME_X" ? bulge : 1;
    const sz = volume === "VOLUME_XZX" ? Math.sqrt(bulge) : volume === "VOLUME_Z" ? bulge : 1;
    const e = owner.elements;
    const xx = new THREE.Vector3(e[0], e[1], e[2]).normalize();
    const zz = new THREE.Vector3(e[8], e[9], e[10]).normalize();
    const keepAxis = String(c.keep_axis ?? "PLANE_X");
    let rot: THREE.Matrix4;
    if (keepAxis === "SWING_Y") {
      const y = new THREE.Vector3(e[4], e[5], e[6]).normalize();
      rot = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(y, vec)).multiply(rotationOf(owner));
    } else if (keepAxis === "PLANE_Z") {
      const x2 = new THREE.Vector3().crossVectors(vec, zz).normalize();
      rot = new THREE.Matrix4().makeBasis(x2, vec, new THREE.Vector3().crossVectors(x2, vec).normalize());
    } else {
      const z2 = new THREE.Vector3().crossVectors(xx, vec).normalize();
      rot = new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(vec, z2).normalize(), vec, z2);
    }
    void size;
    return compose(loc, rot, new THREE.Vector3(sx, sy, sz));
  }

  private transform(i: number, c: RigConstraint, owner: THREE.Matrix4): THREE.Matrix4 | null {
    const target = this.targetMatrix(i, c);
    if (!target) return null;
    const from = String(c.map_from ?? "LOCATION");
    const to = String(c.map_to ?? "LOCATION");
    const mix = (to === "LOCATION" ? c.mix_mode : to === "ROTATION" ? c.mix_mode_rot : c.mix_mode_scale) as string | undefined;
    const sfx = from === "LOCATION" ? "" : from === "ROTATION" ? "_rot" : "_scale";
    const dfx = to === "LOCATION" ? "" : to === "ROTATION" ? "_rot" : "_scale";
    let src: number[];
    if (from === "LOCATION") src = positionOf(target).toArray();
    else if (from === "ROTATION") src = matrixToEuler(rotationOf(target), String(c.from_rotation_mode ?? "AUTO"));
    else src = scaleOf(target).toArray();
    const letters = ["x", "y", "z"];
    const dest = to === "LOCATION" ? positionOf(owner).toArray() : to === "ROTATION" ? matrixToEuler(rotationOf(owner), String(c.to_euler_order ?? "AUTO")) : scaleOf(owner).toArray();
    const result = [...dest];
    for (let k = 0; k < 3; k++) {
      const axis = String(c[`map_to_${letters[k]}_from`] ?? "XYZ"[k]);
      const a = axis === "X" ? 0 : axis === "Y" ? 1 : 2;
      let v = src[a];
      const fmin = Number(c[`from_min_${letters[a]}${sfx}`]) || 0;
      const fmax = Number(c[`from_max_${letters[a]}${sfx}`]) || 0;
      const tmin = Number(c[`to_min_${letters[k]}${dfx}`]) || 0;
      const tmax = Number(c[`to_max_${letters[k]}${dfx}`]) || 0;
      if (!c.use_motion_extrapolate) v = Math.min(Math.max(v, Math.min(fmin, fmax)), Math.max(fmin, fmax));
      const range = fmax - fmin;
      const t = range !== 0 ? (v - fmin) / range : 0;
      const mapped = tmin + t * (tmax - tmin);
      result[k] = mix === "REPLACE" ? mapped : mix === "MULTIPLY" ? dest[k] * mapped : dest[k] + mapped;
    }
    const loc = positionOf(owner);
    const rot = rotationOf(owner);
    const size = scaleOf(owner);
    if (to === "LOCATION") return compose(new THREE.Vector3(result[0], result[1], result[2]), rot, size);
    if (to === "ROTATION") return compose(loc, eulerToMatrix([result[0], result[1], result[2]], String(c.to_euler_order ?? "AUTO")), size);
    return compose(loc, rot, new THREE.Vector3(result[0], result[1], result[2]));
  }

  private limitRotation(c: RigConstraint, owner: THREE.Matrix4): THREE.Matrix4 {
    const order = String(c.euler_order ?? "AUTO");
    const loc = positionOf(owner);
    const size = scaleOf(owner);
    const e = matrixToEuler(rotationOf(owner), order);
    const letters = ["x", "y", "z"];
    for (let k = 0; k < 3; k++) {
      if (!c[`use_limit_${letters[k]}`]) continue;
      const lo = Number(c[`min_${letters[k]}`]) || 0;
      const hi = Number(c[`max_${letters[k]}`]) || 0;
      e[k] = Math.min(Math.max(e[k], lo), hi);
    }
    return compose(loc, eulerToMatrix(e, order), size);
  }

  private armature(i: number, c: RigConstraint, owner: THREE.Matrix4): THREE.Matrix4 | null {
    const targets = c.targets ?? [];
    const sum = new THREE.Matrix4().set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    let total = 0;
    targets.forEach((t, k) => {
      const w = this.driven.get(`${this.bones[i].name}|${c.name}|${k}`) ?? t.weight;
      const b = t.subtarget ? this.index.get(t.subtarget) : undefined;
      if (b === undefined || w === 0) return;
      const deform = new THREE.Matrix4().multiplyMatrices(this.pose[b], this.restInv[b]);
      for (let e = 0; e < 16; e++) sum.elements[e] += deform.elements[e] * w;
      total += w;
    });
    if (total === 0) return null;
    return new THREE.Matrix4().multiplyMatrices(sum, owner);
  }

  // -- IK --

  private evaluateChain(unit: Unit) {
    const { bone: tip, constraint } = unit.ik!;
    const chain = unit.bones;
    // the chain from its channels (the solver decides the rotations; the roots keep their place under the parent)
    for (const b of chain) this.pose[b].copy(this.fromChannels(b, this.parentTransform(b)));
    const influence = this.influence(this.bones[tip], constraint);
    if (influence > 0 && this.solveIk) this.solveChain(chain, constraint, influence);
    for (const b of chain) this.runConstraints(b, true);
  }

  /**
   * Inverse kinematics for a chain of bones, as Blender's solver works it out. Each bone can turn about the local axes the IK leaves free and
   * stretch along its length (stiffly: a stretch of 0.01 gives the length a weight of 0.01 against 1 for the angles). A pole target first
   * turns the whole chain about its root, so that the pole vector (the root's X axis turned toward its Z by the pole angle) faces the pole and
   * the end faces the goal; then weighted least-squares steps (the smallest change of angles and lengths that moves the end toward the goal)
   * are repeated until the end is there.
   */
  private solveChain(chain: number[], c: RigConstraint, influence: number) {
    const target = this.targetMatrix(chain[0], { ...c, target_space: "WORLD", head_tail: 0 } as RigConstraint);
    if (!target) return;
    const goal = positionOf(target);
    const n = chain.length;
    const useTail = c.use_tail !== false;
    const stretchOn = c.use_stretch !== false;
    const parentIdx = this.parent[chain[0]];
    const parentRot = parentIdx >= 0 ? rotationOf(this.pose[parentIdx]) : new THREE.Matrix4();
    const parentRotInv = parentRot.clone().transpose();
    const fkRot = chain.map((b) => rotationOf(this.pose[b]));
    const fkHead = chain.map((b) => positionOf(this.pose[b]));
    const initialScale = chain.map((b) => scaleOf(this.pose[b]));
    const len = chain.map((b, k) => this.bones[b].length * initialScale[k].y);
    const yAxis = new THREE.Vector3(0, 1, 0);
    // where each bone starts, as its parent in the chain sees it
    const startLocal: THREE.Vector3[] = chain.map((_, k) => {
      if (k === 0) return new THREE.Vector3();
      const tailPrev = fkHead[k - 1].clone().addScaledVector(yAxis.clone().applyMatrix4(fkRot[k - 1]), len[k - 1]);
      return fkHead[k].clone().sub(tailPrev).applyMatrix4(fkRot[k - 1].clone().transpose());
    });
    const rootHead = fkHead[0];

    // the turn each bone has from its channels, and what the IK keeps of it: a bone that can turn about one axis only keeps that one turn
    const channelRot = chain.map((b) => rotationOf(this.basis(b)));
    const freeAxes = chain.map((b) => [0, 1, 2].filter((ax) => !this.bones[b].ik.lock[ax]));
    const turnAbout = (m: THREE.Matrix4, axis: number) => {
      const e = m.elements;
      const out = new THREE.Matrix4();
      if (axis === 0) return out.makeRotationX(Math.atan2(e[6], e[5]));
      if (axis === 1) return out.makeRotationY(Math.atan2(e[8], e[0]));
      return out.makeRotationZ(Math.atan2(e[1], e[0]));
    };
    const startBasis = chain.map((_, k) => (freeAxes[k].length === 1 ? turnAbout(channelRot[k], freeAxes[k][0]) : channelRot[k].clone()));
    // each bone's rotation against its parent in the chain with the channel turn taken out
    const restRel = chain.map((_, k) => (k === 0 ? parentRotInv.clone().multiply(fkRot[0]) : fkRot[k - 1].clone().transpose().multiply(fkRot[k])).multiply(channelRot[k].clone().transpose()));
    // the chain as it starts: the rotation of each bone, and where the end is
    const startRots: THREE.Matrix4[] = [];
    let startTail = rootHead.clone();
    {
      let prev = parentRot;
      const tails: THREE.Vector3[] = [];
      chain.forEach((_, k) => {
        const rot = prev.clone().multiply(restRel[k]).multiply(startBasis[k]);
        const head = k === 0 ? rootHead.clone() : tails[k - 1].clone().add(startLocal[k].clone().applyMatrix4(startRots[k - 1]));
        tails.push(head.clone().addScaledVector(yAxis.clone().applyMatrix4(rot), len[k]));
        startRots.push(rot);
        prev = rot;
      });
      startTail = tails[n - 1];
    }

    // the pole: turn everything about the root so the pole vector and the end face where they should
    let rootTurn = new THREE.Matrix4();
    const pole = this.constraintBone(c, "pole_subtarget");
    if (pole >= 0) {
      const polePos = positionOf(this.pose[pole]);
      const dir = startTail.clone().sub(rootHead).normalize();
      const rx = new THREE.Vector3(startRots[0].elements[0], startRots[0].elements[1], startRots[0].elements[2]);
      const rz = new THREE.Vector3(startRots[0].elements[8], startRots[0].elements[9], startRots[0].elements[10]);
      const angle = Number(c.pole_angle) || 0;
      const up = rx.multiplyScalar(Math.cos(angle)).addScaledVector(rz, Math.sin(angle));
      const poleDir = goal.clone().sub(rootHead).normalize();
      const poleUp = polePos.clone().sub(rootHead).normalize();
      const r0 = new THREE.Vector3().crossVectors(dir, up).normalize();
      const r1 = new THREE.Vector3().crossVectors(r0, dir);
      const s0 = new THREE.Vector3().crossVectors(poleDir, poleUp).normalize();
      const s1 = new THREE.Vector3().crossVectors(s0, poleDir);
      if (r0.lengthSq() > 0.5 && s0.lengthSq() > 0.5) {
        // the rotation taking (r0, r1, -dir) to (s0, s1, -poleDir)
        const from = new THREE.Matrix4().makeBasis(r0, r1, dir.clone().negate());
        const to = new THREE.Matrix4().makeBasis(s0, s1, poleDir.clone().negate());
        rootTurn = to.multiply(from.transpose());
      }
    }
    const localRest = chain.map((_, k) => (k === 0 ? parentRotInv.clone().multiply(rootTurn).multiply(parentRot).multiply(restRel[0]) : restRel[k].clone()));

    // the degrees of freedom: the axes each bone may turn about, and its stretch
    const dof: { bone: number; kind: "rot" | "stretch"; axis: number; weight: number }[] = [];
    chain.forEach((b, k) => {
      const lock = this.bones[b].ik.lock;
      const stiff = this.bones[b].ik.stiffness;
      for (let ax = 0; ax < 3; ax++) if (!lock[ax]) dof.push({ bone: k, kind: "rot", axis: ax, weight: 1 - Math.min(Math.max(stiff[ax], 0), 0.99) });
      const stretch = this.bones[b].ik.stretch;
      if (stretchOn && stretch > 0) dof.push({ bone: k, kind: "stretch", axis: 1, weight: Math.max(stretch * stretch, 0.01) });
    });
    if (!dof.length) return;

    // The solver works in a frame where the chain is one unit long and the root head is the origin (as Blender's does, which the step sizes and
    // the stopping rule are made for).
    const reach = len.reduce((p, q) => p + q, 0);
    const unit = reach > 0 ? 1 / reach : 1;
    const sLen = len.map((v) => v * unit);
    const sStart = startLocal.map((v) => v.clone().multiplyScalar(unit));
    const sGoal = goal.clone().sub(rootHead).multiplyScalar(unit);
    const basisChange = startBasis.map((m) => m.clone());
    const grown = chain.map(() => 0);
    const rg: THREE.Matrix4[] = chain.map(() => new THREE.Matrix4());
    const heads: THREE.Vector3[] = chain.map(() => new THREE.Vector3());
    const tails: THREE.Vector3[] = chain.map(() => new THREE.Vector3());
    const forward = () => {
      let prevRot = parentRot;
      for (let k = 0; k < n; k++) {
        rg[k].copy(prevRot).multiply(localRest[k]).multiply(basisChange[k]);
        if (k === 0) heads[k].set(0, 0, 0);
        else heads[k].copy(tails[k - 1]).add(sStart[k].clone().applyMatrix4(rg[k - 1]));
        tails[k].copy(heads[k]).addScaledVector(yAxis.clone().applyMatrix4(rg[k]), sLen[k] + grown[k]);
        prevRot = rg[k];
      }
      return useTail ? tails[n - 1].clone() : heads[n - 1].clone();
    };
    // the clamp on one step toward the goal: half the average reach of a segment
    const clampLength = chain.reduce((p, _, k) => p + sStart[k].length() + sLen[k], 0) / (2 * n);
    const maxAngleChange = Math.PI / 4;
    const maxIterations = Math.max(1, Number(c.iterations) || 500);
    const weight = dof.map((d) => d.weight);
    const sqrtWeight = weight.map(Math.sqrt);
    const normWeight = dof.map((d) => (d.kind === "stretch" ? 1e2 : 1));

    for (let iter = 0; iter < maxIterations; iter++) {
      const end = forward();
      let beta = sGoal.clone().sub(end);
      const dist = beta.length();
      if (dist > clampLength) beta = beta.multiplyScalar(clampLength / dist);
      // the Jacobian of the end position, its columns scaled by the square roots of the weights
      const cols = dof.map((d, i) => {
        const axis = new THREE.Vector3(rg[d.bone].elements[d.axis * 4], rg[d.bone].elements[d.axis * 4 + 1], rg[d.bone].elements[d.axis * 4 + 2]);
        const column = d.kind === "stretch" ? axis : new THREE.Vector3().crossVectors(heads[d.bone].clone().sub(end), axis);
        return column.multiplyScalar(sqrtWeight[i]);
      });
      // its singular value decomposition, from the eigenvectors of J J^T (3 x 3)
      const jjt = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (const col of cols) for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) jjt[r][q] += col.getComponent(r) * col.getComponent(q);
      const { values, vectors } = eigenSymmetric3(jjt);
      const norm = cols.map((col) => col.length());
      const dTheta = dof.map(() => 0);
      for (let s = 0; s < 3; s++) {
        const sigma = Math.sqrt(Math.max(values[s], 0));
        if (sigma <= 1e-10) continue;
        const u = new THREE.Vector3(vectors[0][s], vectors[1][s], vectors[2][s]);
        const alpha = u.dot(beta) / sigma;
        const v = cols.map((col) => col.dot(u) / sigma);
        let m = 0;
        let maxDtheta = 0;
        const tmp = v.map((vj, j) => {
          m += Math.abs(vj) * norm[j];
          const t = vj * alpha;
          maxDtheta = Math.max(maxDtheta, Math.abs(t) * sqrtWeight[j]);
          return t;
        });
        m /= sigma;
        let gamma = maxAngleChange;
        if (1 < m) gamma *= 1 / m;
        const damp = gamma < maxDtheta ? gamma / maxDtheta : 1;
        for (let j = 0; j < dTheta.length; j++) dTheta[j] += 0.8 * Math.min(damp / weight[j], 1) * tmp[j];
      }
      let maxAngle = 0;
      for (let j = 0; j < dTheta.length; j++) { dTheta[j] *= weight[j]; maxAngle = Math.max(maxAngle, Math.abs(dTheta[j])); }
      if (maxAngle > maxAngleChange) { const damp = maxAngleChange / (maxAngleChange + maxAngle); for (let j = 0; j < dTheta.length; j++) dTheta[j] *= damp; }
      // apply: the turns about each bone's own axes, the stretches
      const turn = chain.map(() => new THREE.Vector3());
      dof.forEach((d, j) => { if (d.kind === "rot") turn[d.bone].setComponent(d.axis, dTheta[j]); else grown[d.bone] += dTheta[j]; });
      turn.forEach((q, k) => {
        const angle = q.length();
        if (angle > 1e-12) basisChange[k].multiply(new THREE.Matrix4().makeRotationAxis(q.clone().divideScalar(angle), angle));
      });
      let change = 0;
      for (let j = 0; j < dTheta.length; j++) change = Math.max(change, Math.abs(dTheta[j] * normWeight[j]));
      if (change < 1e-3 && iter > 10) break;
    }
    forward();
    // back to the real size
    for (let k = 0; k < n; k++) { heads[k].multiplyScalar(reach).add(rootHead); tails[k].multiplyScalar(reach).add(rootHead); grown[k] *= reach; }
    // the result: each bone with its new orientation and length (stretch scales all three axes alike)
    chain.forEach((b, k) => {
      const ratio = len[k] > 0 ? (len[k] + grown[k]) / len[k] : 1;
      const after = compose(heads[k], rotationOf(rg[k]), initialScale[k].clone().multiplyScalar(ratio));
      this.pose[b].copy(influence < 1 ? blend(this.pose[b], after, influence) : after);
    });
  }
}
