import * as THREE from "three";
import type { RigData } from "./rigData";
import { RigSolver } from "./rigSolver";

/**
 * A rig in use on a character: the solver, the sliders, and the two-way link with the character's pose. The game's bones (the `bip_*` ones the
 * model is skinned to) are what the rig produces; the controls (`CTRL_*`, `FK_*`, `IK_*`) are what the user moves. Putting a pose onto the
 * controls (`snapFromGame`) is how a pose made some other way, or an animation frame, becomes something the rig can edit.
 */

/**
 * Blender's frame and the viewer's model space (Source space: Z up, as `Actor.boneWorlds` has it) are the same one. The model file's own frame
 * is Y up: (x, y, z) of the file is (x, -z, y) here (`FILE_TO_MODEL`). What differs from bone to bone is how the bone's own axes lie (a hip of the
 * rig and of the model may have different rolls): the viewer works that out for each bone (see `BlenderRigOverlay`).
 */
export const BLENDER_TO_MODEL = new THREE.Matrix4();
export const MODEL_TO_BLENDER = new THREE.Matrix4();
export const FILE_TO_MODEL = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1);

export type LimbId = "armL" | "armR" | "legL" | "legR";

export interface LimbInfo {
  id: LimbId;
  label: string;
  /** The slider that blends IK (1) and FK (0), on the PROPERTIES bone. */
  slider: string;
  /** The game bones (root joint, middle joint, end). */
  game: [string, string, string];
  /** The controls that move it in FK, and in IK. */
  fk: string[];
  ik: string[];
  /** The IK target (hand or foot master), and the pole, and the game bones they are read from. */
  target: string;
  pole: string;
}

const side = (s: "L" | "R") => s;
export const LIMBS: LimbInfo[] = (["L", "R"] as const).flatMap((s) => {
  const arm: LimbInfo = {
    id: `arm${s}`, label: s === "L" ? "Left arm" : "Right arm", slider: `${s} ARM IK/FK`,
    game: [`bip_upperArm_${side(s)}`, `bip_lowerArm_${side(s)}`, `bip_hand_${side(s)}`],
    fk: [`FK_UPPERARM_${s}`, `FK_LOWERARM_${s}`, `FK_HAND_${s}`], ik: [`IK_HAND_${s}`, `IK_ELBOW_${s}`], target: `IK_HAND_${s}`, pole: `IK_ELBOW_${s}`,
  };
  const leg: LimbInfo = {
    id: `leg${s}`, label: s === "L" ? "Left leg" : "Right leg", slider: `${s} LEG IK/FK`,
    game: [`bip_hip_${side(s)}`, `bip_knee_${side(s)}`, `bip_foot_${side(s)}`],
    fk: [`FK_HIP_${s}`, `FK_KNEE_${s}`, `FK_FOOT_${s}`, `FK_TOE_${s}`], ik: [`IK_FOOT_MASTER_${s}`, `IK_KNEEPOLE_${s}`, `IK_FOOTROLL_${s}`, `IK_TOE_${s}`], target: `IK_FOOT_MASTER_${s}`, pole: `IK_KNEEPOLE_${s}`,
  };
  return [arm, leg];
});

/** The FK control that moves a game bone, by the rig's naming (null when the game bone has none). */
export function fkControlFor(game: string): string | null {
  let m = /^bip_(upperArm|lowerArm|hand)_([LR])$/.exec(game);
  if (m) return `FK_${m[1].toUpperCase()}_${m[2]}`;
  m = /^bip_(hip|knee|foot|toe)_([LR])$/.exec(game);
  if (m) return `FK_${m[1].toUpperCase()}_${m[2]}`;
  m = /^bip_collar_([LR])$/.exec(game);
  if (m) return `CTRL_COLLAR_${m[1]}`;
  m = /^bip_(thumb|index|middle|ring|pinky)_([012])_([LR])$/.exec(game);
  if (m) return `CTRL_${m[1].toUpperCase()}_${m[2]}_${m[3]}`;
  if (game === "bip_neck") return "CTRL_NECK";
  if (game === "bip_head") return "CTRL_HEAD";
  if (game === "bip_pelvis") return "CTRL_HIPS";
  if (game === "bip_spine_3") return "CTRL_SPINE";
  return null;
}

const SAFE_IK_DISTANCE = 20;

export class RigSession {
  readonly data: RigData;
  readonly solver: RigSolver;
  /** The names of the game bones, by lowercase name. */
  readonly gameBones = new Map<string, string>();
  /** The FK controls of a limb as they were when it went to IK, with the state of the IK controls then: going back with the IK untouched puts them back as they were. */
  private readonly fkKept = new Map<LimbId, { fk: Map<string, ReturnType<RigSolver["channelsOf"]>>; ik: string }>();

  constructor(data: RigData) {
    this.data = data;
    this.solver = new RigSolver(data);
    for (const b of data.bones) if (b.collections.includes("GAME RIG") || b.name.startsWith("bip_")) this.gameBones.set(b.name.toLowerCase(), b.name);
    this.solver.evaluate();
  }

  /** The game bone's matrix in the viewer's model space after the last evaluation (null: the rig has no such bone). */
  gameWorld(name: string): THREE.Matrix4 | null {
    const real = this.gameBones.get(name.toLowerCase()) ?? name;
    const i = this.solver.indexOf(real);
    return i < 0 ? null : new THREE.Matrix4().multiplyMatrices(BLENDER_TO_MODEL, this.solver.pose[i]);
  }

  /** The matrix of any bone of the rig in model space. */
  boneWorld(name: string): THREE.Matrix4 | null {
    const i = this.solver.indexOf(name);
    return i < 0 ? null : new THREE.Matrix4().multiplyMatrices(BLENDER_TO_MODEL, this.solver.pose[i]);
  }

  slider(name: string): number { return this.solver.slider("PROPERTIES", name) ?? 0; }
  setSlider(name: string, value: number) { this.solver.setSlider("PROPERTIES", name, value); }

  ik(limb: LimbId): boolean { return this.slider(LIMBS.find((l) => l.id === limb)!.slider) >= 0.5; }

  /**
   * Puts the controls where they must be for the rig to give the pose the game bones have (`read` gives each game bone's matrix in model
   * space). The limbs go to FK; the body, head, collars and fingers are matched bone by bone, each control taking the movement of its game bone.
   */
  snapFromGame(read: (game: string) => THREE.Matrix4 | null) {
    const solver = this.solver;
    solver.resetChannels();
    this.fkKept.clear();
    for (const l of LIMBS) this.setSlider(l.slider, 0);
    solver.evaluate({ ik: false });
    // the controls in the order the solver works them out (parents first), so each one is placed once its parent is where it will be
    const order = solver.evaluationOrder();
    const rank = new Map(order.map((n, i) => [n, i]));
    const pairs: { game: string; control: string }[] = [];
    for (const game of this.gameBones.values()) {
      const control = fkControlFor(game);
      if (control && solver.has(control)) pairs.push({ game, control });
    }
    pairs.sort((a, b) => (rank.get(a.control) ?? 0) - (rank.get(b.control) ?? 0));
    const blender = (game: string) => { const w = read(game); return w ? new THREE.Matrix4().multiplyMatrices(MODEL_TO_BLENDER, w) : null; };
    for (const { game, control } of pairs) {
      if (/^FK_LOWERARM_/.test(control)) continue; // set together with the upper arm
      if (/^FK_UPPERARM_/.test(control)) {
        const s = control.endsWith("L") ? "L" : "R";
        this.fitHinge([`bip_upperArm_${s}`, `bip_lowerArm_${s}`, `bip_hand_${s}`].map((g) => this.realName(g)), [`FK_UPPERARM_${s}`, `FK_LOWERARM_${s}`], blender);
        continue;
      }
      const world = read(game);
      const restGame = solver.restOf(game);
      const restControl = solver.restOf(control);
      if (!world || !restGame || !restControl) continue;
      // the movement of the game bone since the rest pose, applied to the control's own rest pose
      const worldBlender = new THREE.Matrix4().multiplyMatrices(MODEL_TO_BLENDER, world);
      const move = worldBlender.multiply(restGame.invert());
      solver.setPoseWorld(control, move.multiply(restControl));
      solver.evaluate({ ik: false });
    }
    solver.evaluate();
  }

  /**
   * Switches a limb between FK and IK. Going to IK puts the target on the hand or foot where it is, and the pole beside the elbow or knee, so
   * nothing moves; going to FK takes the pose the IK gives and puts it on the FK controls.
   */
  /** The state of a limb's IK controls, to tell whether they were touched. */
  private ikState(info: LimbInfo): string {
    const side = info.id.endsWith("L") ? "L" : "R";
    const names = [...info.ik, info.id.startsWith("arm") ? `IK_UPPERARM_${side}` : `IK_HIP_${side}`];
    return JSON.stringify(names.map((n) => this.solver.channelsOf(n)));
  }

  setIk(limb: LimbId, on: boolean) {
    const info = LIMBS.find((l) => l.id === limb);
    if (!info || this.ik(limb) === on) return;
    const solver = this.solver;
    if (!on) {
      const kept = this.fkKept.get(limb);
      if (kept && kept.ik === this.ikState(info)) {
        // the IK was not moved: the FK controls go back to what they were, so the limb does not shift
        for (const [name, ch] of kept.fk) if (ch) solver.setChannels(name, { loc: ch.loc.toArray(), rot: solver.has(name) && solver.boneData(name)?.rotationMode === "QUATERNION" ? [ch.quat.w, ch.quat.x, ch.quat.y, ch.quat.z] : ch.euler, scale: ch.scale.toArray() });
        this.setSlider(info.slider, 0);
        solver.evaluate();
        return;
      }
    }
    if (on) {
      const keptFk = new Map(info.fk.map((n) => [n, solver.channelsOf(n)] as const));
      const [a, b, c] = info.game.map((g) => this.worldBlenderOf(g));
      if (!a || !b || !c) return;
      // the end: the target takes the end bone's movement since the rest pose
      const endRest = solver.restOf(this.realName(info.game[2]))!;
      const move = c.clone().multiply(endRest.invert());
      const targetRest = solver.restOf(info.target)!;
      solver.evaluate({ ik: false });
      solver.setPoseWorld(info.target, move.multiply(targetRest));
      solver.evaluate({ ik: false });
      // the pole: out from the middle of the limb through the middle joint
      const mid = new THREE.Vector3().setFromMatrixPosition(a).add(new THREE.Vector3().setFromMatrixPosition(c)).multiplyScalar(0.5);
      const joint = new THREE.Vector3().setFromMatrixPosition(b);
      const out = joint.clone().sub(mid);
      if (out.length() < 0.5) out.set(0, limb.startsWith("leg") ? -1 : 1, 0);
      const jointStart = joint.clone();
      const chord = new THREE.Vector3().setFromMatrixPosition(c).sub(new THREE.Vector3().setFromMatrixPosition(a)).normalize();
      const start = out.normalize().multiplyScalar(SAFE_IK_DISTANCE);
      const poleRest = solver.restOf(info.pole)!;
      this.setSlider(info.slider, 1);
      this.fkKept.delete(limb);
      // The pole turns the limb about the line from root to end; the joint has to come out where it was (it is a hinge, and the pole's own
      // angle in the rig is an offset), so the angle is found by looking for the one that puts it back
      const place = (angle: number) => {
        const p = mid.clone().add(start.clone().applyAxisAngle(chord, angle));
        solver.setPoseWorld(info.pole, poleRest.clone().setPosition(p));
        solver.evaluate();
        return this.worldBlenderOf(info.game[1])!.elements.slice(12, 15).reduce((s, v, k) => s + (v - jointStart.getComponent(k)) ** 2, 0);
      };
      let best = 0, bestErr = place(0);
      for (let k = 1; k < 24; k++) {
        const angle = ((k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI) / 12;
        const e = place(angle);
        if (e < bestErr) { bestErr = e; best = angle; }
      }
      let lo = best - Math.PI / 12, hi = best + Math.PI / 12;
      for (let k = 0; k < 16; k++) {
        const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
        if (place(m1) < place(m2)) hi = m2; else lo = m1;
      }
      const refined = (lo + hi) / 2;
      place(place(refined) <= bestErr ? refined : best);
      this.fkKept.set(limb, { fk: keptFk, ik: this.ikState(info) });
    } else {
      // FK: each FK control takes the movement of the game bone it shapes, read from the pose the IK gives
      const games = [...info.game, ...(limb.startsWith("leg") ? [`bip_toe_${limb.endsWith("L") ? "L" : "R"}`] : [])];
      const targets = games.map((g) => this.worldBlenderOf(g));
      this.setSlider(info.slider, 0);
      solver.evaluate({ ik: false });
      const setControl = (g: string, k: number) => {
        const control = fkControlFor(this.realName(g));
        const restGame = solver.restOf(this.realName(g));
        const restControl = control ? solver.restOf(control) : null;
        if (!control || !targets[k] || !restGame || !restControl) return;
        solver.setPoseWorld(control, targets[k]!.clone().multiply(restGame.invert()).multiply(restControl));
        solver.evaluate({ ik: false });
      };
      if (limb.startsWith("arm")) {
        // a hinge elbow cannot take the game bones' turns as they are: the arm is fitted so that the elbow and wrist stay where they are
        const side = limb.endsWith("L") ? "L" : "R";
        this.fitHinge(info.game.map((g) => this.realName(g)), [`FK_UPPERARM_${side}`, `FK_LOWERARM_${side}`], (g) => targets[games.findIndex((x) => x.toLowerCase() === g.toLowerCase())] ?? null);
        setControl(games[2], 2);
      } else games.forEach((g, k) => setControl(g, k));
      solver.evaluate();
    }
  }

  /**
   * Puts an arm with a hinge elbow (the forearm turns about one axis) on the pose a ball joint made. The hinge angle follows from how far the
   * wrist is from the shoulder (the forearm's Y axis sweeps a cone about the hinge); the upper arm is then turned so that the wrist is where it
   * is, with the least twist from what the game bone's own turn would give. The elbow lands where it was.
   */
  private fitHinge(game: string[], controls: string[], target: (game: string) => THREE.Matrix4 | null) {
    const solver = this.solver;
    const [wu, wl, we] = game.map((g) => target(g));
    const [upperC, lowerC] = controls;
    if (!wu || !wl || !we || !solver.has(upperC) || !solver.has(lowerC)) return;
    const pos = (m: THREE.Matrix4) => new THREE.Vector3().setFromMatrixPosition(m);
    const A = pos(wu), B = pos(wl), C = pos(we);
    // the lengths of the rig's own bones (an IK pose may have stretched them a little; the FK arm cannot)
    const restPos = (g: string) => { const m = solver.restOf(g); return m ? pos(m) : null; };
    const rA = restPos(game[0]), rB = restPos(game[1]), rC = restPos(game[2]);
    const l1 = rA && rB ? rA.distanceTo(rB) : A.distanceTo(B), l2 = rB && rC ? rB.distanceTo(rC) : B.distanceTo(C);
    const toWrist = C.clone().sub(A);
    const dist = toWrist.length();
    const u = toWrist.clone().divideScalar(dist || 1);
    const restGameU = solver.restOf(game[0])!;
    const restU = solver.restOf(upperC)!;
    const restL = solver.restOf(lowerC)!;
    // the game bone's own turn applied to the control: the reference for the twist and for the choice of hinge angle
    const baseRot = new THREE.Matrix4().extractRotation(wu.clone().multiply(restGameU.invert()).multiply(restU));
    const rel = new THREE.Matrix4().extractRotation(restU).transpose().multiply(new THREE.Matrix4().extractRotation(restL));
    const c0 = new THREE.Vector3(rel.elements[0], rel.elements[1], rel.elements[2]);
    const c1 = new THREE.Vector3(rel.elements[4], rel.elements[5], rel.elements[6]);
    const R = Math.hypot(c0.y, c1.y);
    const delta = Math.atan2(c0.y, c1.y);
    const wanted = Math.min(1, Math.max(-1, (dist * dist - l1 * l1 - l2 * l2) / (2 * l1 * l2)));
    const ratio = R > 1e-9 ? Math.min(1, Math.max(-1, wanted / R)) : 1;
    const turn = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));
    const candidates = [turn(-delta + Math.acos(ratio)), turn(-delta - Math.acos(ratio))].map((theta) => {
      const w = c1.clone().multiplyScalar(Math.cos(theta)).addScaledVector(c0, -Math.sin(theta));
      const q = new THREE.Vector3(0, l1, 0).addScaledVector(w, l2).normalize();
      const align = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(q, u));
      // the twist about the line to the wrist that keeps the control nearest the game bone's turn
      const across = (v: THREE.Vector3) => v.clone().addScaledVector(u, -v.dot(u));
      const mine = across(new THREE.Vector3(1, 0, 0).applyMatrix4(align));
      const wantX = across(new THREE.Vector3(1, 0, 0).applyMatrix4(baseRot));
      let rot = align;
      if (mine.lengthSq() > 1e-12 && wantX.lengthSq() > 1e-12) {
        mine.normalize(); wantX.normalize();
        const omega = Math.atan2(new THREE.Vector3().crossVectors(mine, wantX).dot(u), mine.dot(wantX));
        rot = new THREE.Matrix4().makeRotationAxis(u, omega).multiply(align);
      }
      const x = new THREE.Matrix4().multiplyMatrices(baseRot.clone().transpose(), rot);
      return { rot, trace: x.elements[0] + x.elements[5] + x.elements[10] };
    });
    const best = candidates[0].trace >= candidates[1].trace ? candidates[0] : candidates[1];
    if ((globalThis as { RIG_FIT_DEBUG?: boolean }).RIG_FIT_DEBUG) console.log(`fit ${upperC}: turn from base ${(Math.acos(Math.min(1, Math.max(-1, (best.trace - 1) / 2))) * 57.3).toFixed(1)} deg`);
    solver.setPoseWorld(upperC, best.rot.clone().setPosition(A));
    solver.evaluate({ ik: false });
    // the forearm: the hinge angle about the axis it has now that points its Y axis at the wrist
    const current = solver.pose[solver.indexOf(lowerC)].clone();
    const cr = new THREE.Matrix4().extractRotation(current);
    const col = (m: THREE.Matrix4, k: number) => new THREE.Vector3(m.elements[k * 4], m.elements[k * 4 + 1], m.elements[k * 4 + 2]).normalize();
    const hinge = col(cr, 2);
    const across2 = (v: THREE.Vector3) => v.clone().addScaledVector(hinge, -v.dot(hinge)).normalize();
    const from = across2(col(cr, 1));
    const want = across2(C.clone().sub(B));
    const theta = Math.atan2(new THREE.Vector3().crossVectors(from, want).dot(hinge), from.dot(want));
    solver.setPoseWorld(lowerC, new THREE.Matrix4().makeRotationAxis(hinge, theta).multiply(cr).setPosition(B));
    solver.evaluate({ ik: false });
  }

  private realName(game: string) { return this.gameBones.get(game.toLowerCase()) ?? game; }
  private worldBlenderOf(game: string): THREE.Matrix4 | null {
    const i = this.solver.indexOf(this.realName(game));
    return i < 0 ? null : this.solver.pose[i].clone();
  }
}
