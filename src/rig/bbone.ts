import * as THREE from "three";

/**
 * Bendy bones, worked out the way Blender does (armature.cc: BKE_pchan_bbone_spline_params_get / _compute): a cubic curve from the head to the
 * tail of the bone, its end tangents taken from handle bones, cut into segments whose joints carry a position, a direction and a roll. A
 * constraint that copies from a bone with the bendy shape on gets the point of the curve its head/tail setting names.
 */

export interface BBoneSettings {
  segments: number;
  prevType: string;
  nextType: string;
  prev: string | null;
  next: string | null;
  easeIn: number;
  easeOut: number;
  rollIn: number;
  rollOut: number;
  scaleIn: number[];
  scaleOut: number[];
  curveInX: number;
  curveInZ: number;
  curveOutX: number;
  curveOutZ: number;
  handleScaleStart: boolean[];
  handleScaleEnd: boolean[];
  handleEaseStart: boolean;
  handleEaseEnd: boolean;
  endRollAsInRoll: boolean;
  scaleEasing: boolean;
  pose?: { easeIn: number; easeOut: number; rollIn: number; rollOut: number; scaleIn: number[]; scaleOut: number[]; curveInX: number; curveInZ: number; curveOutX: number; curveOutZ: number };
}

/** What the curve needs to know of a handle bone: its pose matrix, its rest-pose roll against the bone is taken from the matrices. */
export interface BBoneHandle {
  pose: THREE.Matrix4;
  length: number;
  /** The handle's own bendy-bone count (a handle that is a bendy bone itself joins smoothly). */
  segments: number;
  /** The handle bone's scale in its own local space (for the handle-scale options). */
  localScale?: THREE.Vector3;
  /** The roll of the handle bone's own end (for "add parent end roll"). */
  endRoll?: number;
  /** Where the handle bone was at rest (for the relative handle type): its head. */
  restHead: THREE.Vector3;
}

const MAX_SUBDIV = 32;

const interpf = (target: number, origin: number, fac: number) => fac * target + (1 - fac) * origin;

/** Blender's vec_roll_to_mat3: the matrix whose Y axis is `nor`, turned `roll` about it. */
export function vecRollToMatrix(nor: THREE.Vector3, roll: number, out = new THREE.Matrix4()): THREE.Matrix4 {
  const n = nor.clone().normalize();
  let q: THREE.Quaternion;
  if (n.y < -1 + 1e-9) q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI);
  else q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
  const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
  return out.copy(m).multiply(new THREE.Matrix4().makeRotationY(roll));
}

/** Blender's mat3_vec_to_roll: the roll of a matrix's orientation about a direction. */
export function matrixVecToRoll(mat: THREE.Matrix4, vec: THREE.Vector3): number {
  const vm = vecRollToMatrix(vec, 0);
  const rollmat = vm.clone().transpose().multiply(mat);
  const e = rollmat.elements;
  // element (row 0, column 2) and (row 2, column 2)
  return Math.atan2(e[8], e[10]);
}

function tangentFactorCircle(l: THREE.Vector3, r: THREE.Vector3): number {
  const eps = 1e-5;
  const d = l.dot(r);
  if (d > 1 - eps) return (1 / 3) * 0.75;
  if (d < -1 + eps) return 0.5;
  const angle = Math.acos(d) / 2;
  const s = Math.sin(angle);
  const c = Math.cos(angle);
  return ((1 - c) / (s * 2)) / s;
}

function evaluateBezier(c: THREE.Vector3[], t: number): { pos: THREE.Vector3; tangent: THREE.Vector3 } {
  const l1 = [c[0].clone().lerp(c[1], t), c[1].clone().lerp(c[2], t), c[2].clone().lerp(c[3], t)];
  const l2 = [l1[0].clone().lerp(l1[1], t), l1[1].clone().lerp(l1[2], t)];
  const tangent = l2[1].clone().sub(l2[0]);
  const pos = l2[0].clone().addScaledVector(tangent, t);
  return { pos, tangent };
}

function bezierPoint(c: THREE.Vector3[], t: number): THREE.Vector3 {
  const u = 1 - t;
  return c[0].clone().multiplyScalar(u * u * u).addScaledVector(c[1], 3 * u * u * t).addScaledVector(c[2], 3 * u * t * t).addScaledVector(c[3], t * t * t);
}

/** Parameter values that make the segments about equally long (with the segment scales as weights). */
function equalize(c: THREE.Vector3[], temp: number, final: number, scales: number[]): number[] {
  const coords: THREE.Vector3[] = [];
  for (let i = 0; i <= temp; i++) coords.push(bezierPoint(c, i / temp));
  const pdist = [0];
  for (let i = 0; i < temp; i++) pdist.push(pdist[i] + coords[i].distanceTo(coords[i + 1]));
  let step = pdist[temp];
  let sum = 0;
  for (let i = 0; i < final; i++) sum += scales[i];
  step /= sum;
  const out = [0];
  let dist = 0;
  let nr = 1;
  for (let i = 1; i <= final; i++) {
    dist += scales[i - 1] * step;
    while (nr < temp && dist >= pdist[nr]) nr++;
    const fac = (pdist[nr] - dist) / (pdist[nr] - pdist[nr - 1]);
    out.push((nr - fac) / temp);
  }
  out[final] = 1;
  return out;
}

function easeHandleAxis(d1: THREE.Vector3, d2: THREE.Vector3): THREE.Vector3 {
  const gap = 0.1;
  const axis = d1.clone();
  const len2 = d2.lengthSq();
  if (len2 === 0) return axis;
  const ratio = d1.lengthSq() / len2;
  if (ratio < gap * gap) axis.addScaledVector(d2, gap - Math.sqrt(ratio));
  return axis;
}

const posOf = (m: THREE.Matrix4) => new THREE.Vector3(m.elements[12], m.elements[13], m.elements[14]);

function normalizedMatrix(m: THREE.Matrix4): THREE.Matrix4 {
  const out = m.clone();
  const e = out.elements;
  for (let c = 0; c < 3; c++) {
    const l = Math.hypot(e[c * 4], e[c * 4 + 1], e[c * 4 + 2]) || 1;
    e[c * 4] /= l; e[c * 4 + 1] /= l; e[c * 4 + 2] /= l;
  }
  return out;
}

/**
 * The joints of a bendy bone (segments + 1 matrices, in the bone's own space, as `PoseBone.bbone_segment_matrix(i)` gives them).
 * `pose`: the bone's pose matrix; `length`: its rest length; `prev` / `next`: its handle bones (or null).
 */
export function bboneJoints(settings: BBoneSettings, pose: THREE.Matrix4, length: number, prev: BBoneHandle | null, next: BBoneHandle | null, restHead: THREE.Vector3, restTail: THREE.Vector3): THREE.Matrix4[] {
  const e = pose.elements;
  const scale = new THREE.Vector3(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10]));
  const doScale = Math.abs(scale.x - scale.y) > 1e-6 || Math.abs(scale.y - scale.z) > 1e-6;
  const base = doScale ? normalizedMatrix(pose) : pose;
  const imat = base.clone().invert();
  const poseHead = posOf(pose);
  const poseTail = new THREE.Vector3(0, length, 0).applyMatrix4(pose);
  const p = settings.pose;

  // handle positions in this bone's space
  let prevH: THREE.Vector3 | null = null;
  let prevMat: THREE.Matrix4 | null = null;
  let prevBBone = false;
  const prevScale = new THREE.Vector3(1, 1, 1);
  if (prev) {
    const prevHead = posOf(prev.pose);
    const prevTail = new THREE.Vector3(0, prev.length, 0).applyMatrix4(prev.pose);
    let h1: THREE.Vector3;
    let done = false;
    if (settings.prevType === "RELATIVE") {
      prevH = new THREE.Vector3();
      done = true;
      // (delta from the rest pose; zero only when the handle has not moved)
      const delta = prevHead.clone().sub(prev.restHead);
      h1 = poseHead.clone().sub(delta);
      prevH = h1.applyMatrix4(imat);
      done = true;
    } else if (settings.prevType === "TANGENT") {
      const delta = prevTail.clone().sub(prevHead);
      h1 = poseHead.clone().sub(delta);
    } else {
      prevBBone = prev.segments > 1;
      h1 = prevHead.clone();
    }
    if (!done) prevH = h1.applyMatrix4(imat);
    if (!prevBBone) {
      prevMat = imat.clone().multiply(prev.pose);
      if (settings.handleScaleStart.some(Boolean) && prev.localScale) prevScale.copy(prev.localScale);
    }
  }
  let nextH: THREE.Vector3 | null = null;
  let nextMat: THREE.Matrix4 | null = null;
  let nextBBone = false;
  const nextScale = new THREE.Vector3(1, 1, 1);
  if (next) {
    const nextHead = posOf(next.pose);
    const nextTail = new THREE.Vector3(0, next.length, 0).applyMatrix4(next.pose);
    let h2: THREE.Vector3;
    if (settings.nextType === "RELATIVE") {
      const delta = nextHead.clone().sub(next.restHead);
      h2 = poseTail.clone().add(delta);
    } else if (settings.nextType === "TANGENT") {
      const delta = nextTail.clone().sub(nextHead);
      h2 = poseTail.clone().add(delta);
    } else {
      nextBBone = next.segments > 1;
      h2 = nextTail.clone();
    }
    nextH = h2.applyMatrix4(imat);
    nextMat = imat.clone().multiply(next.pose);
    if (settings.handleScaleEnd.some(Boolean) && next.localScale) nextScale.copy(next.localScale);
  }

  // the extra properties on top
  let ease1 = settings.easeIn + (p ? p.easeIn : 0);
  let ease2 = settings.easeOut + (p ? p.easeOut : 0);
  let roll1p = settings.rollIn + (p ? p.rollIn : 0);
  let roll2p = settings.rollOut + (p ? p.rollOut : 0);
  if (settings.endRollAsInRoll && prev) roll1p += (prev.endRoll ?? 0);
  const scaleIn = settings.scaleIn.slice();
  const scaleOut = settings.scaleOut.slice();
  if (p) for (let k = 0; k < 3; k++) { scaleIn[k] *= p.scaleIn[k]; scaleOut[k] *= p.scaleOut[k]; }
  let curveInX = settings.curveInX + (p ? p.curveInX : 0);
  let curveInZ = settings.curveInZ + (p ? p.curveInZ : 0);
  let curveOutX = settings.curveOutX + (p ? p.curveOutX : 0);
  let curveOutZ = settings.curveOutZ + (p ? p.curveOutZ : 0);
  if (settings.scaleEasing) {
    ease1 *= scaleIn[1]; curveInX *= scaleIn[1]; curveInZ *= scaleIn[1];
    ease2 *= scaleOut[1]; curveOutX *= scaleOut[1]; curveOutZ *= scaleOut[1];
  }
  if (settings.handleScaleStart[0]) scaleIn[0] *= prevScale.x;
  if (settings.handleScaleStart[1]) scaleIn[1] *= prevScale.y;
  if (settings.handleScaleStart[2]) scaleIn[2] *= prevScale.z;
  if (settings.handleEaseStart) { ease1 *= prevScale.y; curveInX *= prevScale.y; curveInZ *= prevScale.y; }
  if (settings.handleScaleEnd[0]) scaleOut[0] *= nextScale.x;
  if (settings.handleScaleEnd[1]) scaleOut[1] *= nextScale.y;
  if (settings.handleScaleEnd[2]) scaleOut[2] *= nextScale.z;
  if (settings.handleEaseEnd) { ease2 *= nextScale.y; curveOutX *= nextScale.y; curveOutZ *= nextScale.y; }

  // the handles (BKE_pchan_bbone_handles_compute)
  let len = length;
  if (doScale) len *= scale.y;
  const epsilon = 1e-5 * len;
  let roll1 = 0, roll2 = 0;
  const h1 = new THREE.Vector3();
  const h2 = new THREE.Vector3();
  if (prevH) {
    h1.copy(prevH);
    if (prevBBone) h1.y -= len;
    if (h1.length() < epsilon) h1.set(0, -1, 0); else h1.normalize();
    h1.negate();
    if (!prevBBone && prevMat) roll1 = matrixVecToRoll(prevMat, h1);
  } else h1.set(0, 1, 0);
  if (nextH) {
    h2.copy(nextH);
    if (!nextBBone) h2.y -= len;
    if (h2.length() < epsilon) h2.set(0, 1, 0); else h2.normalize();
    if (nextMat) roll2 = matrixVecToRoll(nextMat, h2);
  } else h2.set(0, 1, 0);
  const circle = len * (tangentFactorCircle(h1, h2) / 0.75);
  h1.multiplyScalar(ease1 * circle);
  h2.multiplyScalar(-(ease2 * circle));
  roll1 += roll1p;
  roll2 += roll2p;
  const xs = doScale ? scale.x : 1;
  const zs = doScale ? scale.z : 1;
  h1.x += curveInX * xs; h1.z += curveInZ * zs;
  h2.x += curveOutX * xs; h2.z += curveOutZ * zs;

  const segments = Math.min(settings.segments, MAX_SUBDIV);
  const controls = [new THREE.Vector3(), h1.clone(), new THREE.Vector3(0, len, 0).add(h2), new THREE.Vector3(0, len, 0)];
  const lin = Math.max(scaleIn[1], 0.0001);
  const lout = Math.max(scaleOut[1], 0.0001);
  const logIn = Math.log(lin);
  const logOut = Math.log(lout);
  const segScales: number[] = [];
  for (let i = 0; i < segments; i++) {
    const fac = segments > 1 ? i / (segments - 1) : 0;
    segScales.push(Math.exp(interpf(logOut, logIn, fac)));
  }
  const ts = equalize(controls, MAX_SUBDIV, segments, segScales);

  const s1 = doScale ? new THREE.Matrix4().makeScale(scale.x, scale.y, scale.z) : null;
  const s0 = s1 ? s1.clone().invert() : null;
  const make = (pos: THREE.Vector3, axis: THREE.Vector3, roll: number, sx: number, sz: number) => {
    const m = vecRollToMatrix(axis, roll);
    m.setPosition(pos);
    let r = m;
    if (s0 && s1) r = new THREE.Matrix4().multiplyMatrices(s0, m).multiply(s1);
    const el = r.elements;
    el[0] *= sx; el[1] *= sx; el[2] *= sx;
    el[8] *= sz; el[9] *= sz; el[10] *= sz;
    return r;
  };
  const d1 = [0, 1, 2].map((i) => controls[i + 1].clone().sub(controls[i]));
  const d2 = [0, 1].map((i) => d1[i + 1].clone().sub(d1[i]));
  const out: THREE.Matrix4[] = [];
  out.push(make(controls[0], easeHandleAxis(d1[0], d2[0]), roll1, scaleIn[0], scaleIn[2]));
  for (let a = 1; a < segments; a++) {
    const { pos, tangent } = evaluateBezier(controls, ts[a]);
    const fac = a / segments;
    out.push(make(pos, tangent, interpf(roll2, roll1, fac), interpf(scaleOut[0], scaleIn[0], fac), interpf(scaleOut[2], scaleIn[2], fac)));
  }
  const d2end = d2[1].clone().negate();
  out.push(make(controls[3], easeHandleAxis(d1[2], d2end), roll2, scaleOut[0], scaleOut[2]));
  // `restHead` and `restTail` are only needed for handles of a relative kind; kept for callers that compare rest and pose
  void restHead; void restTail;
  return out;
}

/** The rotation U and the stretch P of a 3x3 matrix, M = U * P (the polar decomposition, as Blender interpolates matrices with it). */
function polarDecompose(m: THREE.Matrix3): { u: THREE.Matrix3; p: THREE.Matrix3 } {
  let u = m.clone();
  for (let i = 0; i < 40; i++) {
    const inv = u.clone().invert().transpose();
    const next = new THREE.Matrix3();
    for (let k = 0; k < 9; k++) next.elements[k] = 0.5 * (u.elements[k] + inv.elements[k]);
    let diff = 0;
    for (let k = 0; k < 9; k++) diff += Math.abs(next.elements[k] - u.elements[k]);
    u = next;
    if (diff < 1e-12) break;
  }
  const p = u.clone().transpose().multiply(m);
  return { u, p };
}

/** Blender's interp_m4_m4m4: location linearly, rotation along the arc, the stretch part linearly. */
export function interpMatrices(a: THREE.Matrix4, b: THREE.Matrix4, t: number): THREE.Matrix4 {
  const split = (m: THREE.Matrix4) => {
    const m3 = new THREE.Matrix3().setFromMatrix4(m);
    let { u, p } = polarDecompose(m3);
    if (u.determinant() < 0) { u = u.multiplyScalar(-1); p = p.multiplyScalar(-1); }
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().setFromMatrix3(u));
    return { q, p };
  };
  const A = split(a);
  const B = split(b);
  const q = A.q.clone().slerp(B.q, t);
  const rot = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q));
  const p = new THREE.Matrix3();
  for (let k = 0; k < 9; k++) p.elements[k] = A.p.elements[k] * (1 - t) + B.p.elements[k] * t;
  const m3 = rot.multiply(p);
  const out = new THREE.Matrix4().setFromMatrix3(m3);
  const la = new THREE.Vector3().setFromMatrixPosition(a);
  const lb = new THREE.Vector3().setFromMatrixPosition(b);
  out.setPosition(la.lerp(lb, t));
  return out;
}

/** The segment a head/tail fraction falls in and how far into it (BKE_pchan_bbone_deform_clamp_segment_index). */
export function segmentIndex(segments: number, headTail: number): { index: number; fac: number } {
  const t = Math.min(Math.max(headTail, 0), 1);
  const pre = t * segments;
  let index = Math.floor(pre);
  let fac = pre - index;
  index = Math.min(Math.max(index, 0), segments - 1);
  fac = Math.min(Math.max(fac, 0), 1);
  return { index, fac };
}
