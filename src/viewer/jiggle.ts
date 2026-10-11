/**
 * Jiggle bones: a port of `CJiggleBones::BuildJiggleTransformations` (public/jigglebones.cpp, Source SDK 2013),
 * the spring physics the client runs for `STUDIO_PROC_JIGGLE` bones (tails, tassels, hanging eyeballs, ...).
 *
 * The bone points along its local Z axis; yaw swings around Y and pitch around X. Each frame the animated
 * ("goal") bone matrix drives a spring whose tip lags behind it, and the bone is re-aimed along the lagging
 * tip. Everything runs in the space the rig is posed in, with gravity along `gravity` (Source Z down).
 * hlmv itself has no jiggle bones; this is what the game client does with the same data.
 */
import * as THREE from "three";

export interface JiggleParams {
  flags: number;
  length: number;
  tipMass: number;
  yawStiffness: number;
  yawDamping: number;
  pitchStiffness: number;
  pitchDamping: number;
  alongStiffness: number;
  alongDamping: number;
  angleLimit: number;
  minYaw: number;
  maxYaw: number;
  minPitch: number;
  maxPitch: number;
  baseMass: number;
  baseStiffness: number;
  baseDamping: number;
  baseMin: [number, number, number];
  baseMax: [number, number, number];
  baseFriction: [number, number, number];
  boingImpactSpeed: number;
  boingImpactAngle: number;
  boingDampingRate: number;
  boingFrequency: number;
  boingAmplitude: number;
}

const IS_FLEXIBLE = 0x01;
const IS_RIGID = 0x02;
const HAS_YAW_CONSTRAINT = 0x04;
const HAS_PITCH_CONSTRAINT = 0x08;
const HAS_ANGLE_CONSTRAINT = 0x10;
const HAS_LENGTH_CONSTRAINT = 0x20;
const HAS_BASE_SPRING = 0x40;
const IS_BOING = 0x80;

/** `cl_jiggle_bone_framerate_cutoff`: below this frame rate the goal matrix is used instead. */
const FRAMERATE_CUTOFF = 20;

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** Per-bone simulation state (`JiggleData`). */
export class JiggleBone {
  private lastUpdate = 0;
  private basePos = V();
  private baseLastPos = V();
  private baseVel = V();
  private baseAccel = V();
  private tipPos = V();
  private tipVel = V();
  private tipAccel = V();
  private lastLeft = V();
  private lastBoingPos = V();
  private boingDir = V(0, 0, 1);
  private boingVelDir = V();
  private boingSpeed = 0;
  private boingTime = 0;
  private useGoalMatrixCount = 0;
  private useJiggleBoneCount = 16;
  private fresh = true;

  readonly params: JiggleParams;

  constructor(params: JiggleParams) {
    this.params = params;
  }

  private init(time: number, base: THREE.Vector3, tip: THREE.Vector3) {
    this.lastUpdate = time;
    this.basePos.copy(base);
    this.baseLastPos.copy(base);
    this.baseVel.set(0, 0, 0);
    this.baseAccel.set(0, 0, 0);
    this.tipPos.copy(tip);
    this.tipVel.set(0, 0, 0);
    this.tipAccel.set(0, 0, 0);
    this.lastLeft.set(0, 0, 0);
    this.lastBoingPos.copy(base);
    this.boingDir.set(0, 0, 1);
    this.boingVelDir.set(0, 0, 0);
    this.boingSpeed = 0;
    this.boingTime = 0;
  }

  /**
   * Advances the simulation to `time` (seconds) and returns the bone's world matrix. `goal` is the animated bone
   * matrix, `gravity` a unit vector pointing down in the same space.
   */
  update(time: number, goal: THREE.Matrix4, gravity: THREE.Vector3): THREE.Matrix4 {
    const info = this.params;
    const goalBase = V().setFromMatrixPosition(goal);
    const goalLeft = V().setFromMatrixColumn(goal, 0);
    const goalUp = V().setFromMatrixColumn(goal, 1);
    const goalForward = V().setFromMatrixColumn(goal, 2);
    const goalTip = goalBase.clone().addScaledVector(goalForward, info.length);

    if (this.fresh) {
      this.init(time, goalBase, goalTip);
      this.fresh = false;
    }
    // Frames were skipped since the last update (disabled and re-enabled): start over.
    if (time - this.lastUpdate > 0.5) this.init(time, goalBase, goalTip);
    if (this.lastLeft.lengthSq() === 0) this.lastLeft.copy(goalLeft);

    let dt = time - this.lastUpdate;
    const tooShort = dt < 0.001;
    let useGoal = FRAMERATE_CUTOFF <= 0 || dt > 1 / FRAMERATE_CUTOFF;
    if (useGoal) {
      this.useGoalMatrixCount = 32;
    } else if (this.useGoalMatrixCount > 0) {
      useGoal = true;
      this.useGoalMatrixCount--;
    } else {
      this.useJiggleBoneCount = 32;
    }
    if (this.useJiggleBoneCount > 0) {
      this.useJiggleBoneCount--;
      this.useGoalMatrixCount = 0;
      useGoal = false;
    }
    if (tooShort) dt = 0.001;
    else if (useGoal) return goal.clone();
    this.lastUpdate = time;

    // Everything below writes into `out`, starting from the goal orientation.
    const out = goal.clone();
    const flex = (info.flags & (IS_FLEXIBLE | IS_RIGID)) !== 0;

    // ---- bone tip flex ----
    if (flex) {
      // gravity (the SDK subtracts tipMass from the world Z acceleration)
      this.tipAccel.addScaledVector(gravity, info.tipMass);

      if (info.flags & IS_FLEXIBLE) {
        const error = goalTip.clone().sub(this.tipPos);
        const localError = V(error.dot(goalLeft), error.dot(goalUp), error.dot(goalForward));
        const localVel = V(this.tipVel.dot(goalLeft), this.tipVel.dot(goalUp), 0);
        const yawAccel = info.yawStiffness * localError.x - info.yawDamping * localVel.x;
        const pitchAccel = info.pitchStiffness * localError.y - info.pitchDamping * localVel.y;
        if (info.flags & HAS_LENGTH_CONSTRAINT) {
          this.tipAccel.addScaledVector(goalLeft, yawAccel).addScaledVector(goalUp, pitchAccel);
        } else {
          localVel.z = this.tipVel.dot(goalForward);
          const alongAccel = info.alongStiffness * localError.z - info.alongDamping * localVel.z;
          this.tipAccel.addScaledVector(goalLeft, yawAccel).addScaledVector(goalUp, pitchAccel).addScaledVector(goalForward, alongAccel);
        }
      }

      // simple Euler integration
      this.tipVel.addScaledVector(this.tipAccel, dt);
      this.tipPos.addScaledVector(this.tipVel, dt);
      this.tipAccel.set(0, 0, 0);

      // ---- optional constraints ----
      if (info.flags & (HAS_YAW_CONSTRAINT | HAS_PITCH_CONSTRAINT)) {
        let along = this.tipPos.clone().sub(goalBase);
        let localAlong = V(along.dot(goalLeft), along.dot(goalUp), along.dot(goalForward));

        if (info.flags & HAS_YAW_CONSTRAINT) {
          const yawError = Math.atan2(localAlong.x, localAlong.z);
          let yaw: number | null = null;
          if (yawError < info.minYaw) yaw = info.minYaw;
          else if (yawError > info.maxYaw) yaw = info.maxYaw;
          if (yaw !== null) {
            const [sy, cy] = [Math.sin(yaw), Math.cos(yaw)];
            const limitLeft = goalLeft.clone().multiplyScalar(cy).addScaledVector(goalForward, -sy);
            const limitForward = goalLeft.clone().multiplyScalar(sy).addScaledVector(goalForward, cy);
            const limitUp = goalUp;
            const la = V(limitLeft.dot(along), limitUp.dot(along), limitForward.dot(along));
            // clip to the limit plane
            this.tipPos.copy(goalBase).addScaledVector(limitUp, la.y).addScaledVector(limitForward, la.z);
            this.tipVel.set(0, 0, 0);
            along = this.tipPos.clone().sub(goalBase);
            localAlong = V(along.dot(goalLeft), along.dot(goalUp), along.dot(goalForward));
          }
        }

        if (info.flags & HAS_PITCH_CONSTRAINT) {
          const pitchError = Math.atan2(localAlong.y, localAlong.z);
          let pitch: number | null = null;
          if (pitchError < info.minPitch) pitch = info.minPitch;
          else if (pitchError > info.maxPitch) pitch = info.maxPitch;
          if (pitch !== null) {
            const [sp, cp] = [Math.sin(pitch), Math.cos(pitch)];
            const limitLeft = goalLeft;
            const limitUp = goalUp.clone().multiplyScalar(cp).addScaledVector(goalForward, -sp);
            const limitForward = goalUp.clone().multiplyScalar(sp).addScaledVector(goalForward, cp);
            const la = V(limitLeft.dot(along), limitUp.dot(along), limitForward.dot(along));
            this.tipPos.copy(goalBase).addScaledVector(limitLeft, la.x).addScaledVector(limitForward, la.z);
            this.tipVel.set(0, 0, 0);
          }
        }
      }

      const forward = this.tipPos.clone().sub(goalBase).normalize();

      if (info.flags & HAS_ANGLE_CONSTRAINT) {
        const dot = forward.dot(goalForward);
        let angleBetween = Math.acos(Math.min(Math.max(dot, -1), 1));
        if (dot < 0) angleBetween = 2 * Math.PI - angleBetween;
        if (angleBetween > info.angleLimit) {
          const maxBetween = info.length * Math.sin(info.angleLimit);
          const delta = goalTip.clone().sub(this.tipPos).normalize();
          this.tipPos.copy(goalTip).addScaledVector(delta, -maxBetween);
          forward.copy(this.tipPos).sub(goalBase).normalize();
        }
      }

      if (info.flags & HAS_LENGTH_CONSTRAINT) {
        this.tipPos.copy(goalBase).addScaledVector(forward, info.length);
        this.tipVel.addScaledVector(forward, -this.tipVel.dot(forward));
      }

      // bone matrix aligned along the current tip direction
      const left = V().crossVectors(goalUp, forward).normalize();
      const up = V().crossVectors(forward, left);
      out.makeBasis(left, up, forward).setPosition(goalBase);
    }

    // ---- bone base flex ----
    if (info.flags & HAS_BASE_SPRING) {
      this.baseAccel.addScaledVector(gravity, info.baseMass);
      const error = goalBase.clone().sub(this.basePos);
      this.baseAccel.addScaledVector(error, info.baseStiffness).addScaledVector(this.baseVel, -info.baseDamping);
      this.baseVel.addScaledVector(this.baseAccel, dt);
      this.basePos.addScaledVector(this.baseVel, dt);
      this.baseAccel.set(0, 0, 0);

      const e = this.basePos.clone().sub(goalBase);
      const le = V(e.dot(goalLeft), e.dot(goalUp), e.dot(goalForward));
      const lv = V(this.baseVel.dot(goalLeft), this.baseVel.dot(goalUp), this.baseVel.dot(goalForward));
      const axes = [goalLeft, goalUp, goalForward];
      const comps: ("x" | "y" | "z")[] = ["x", "y", "z"];
      for (let k = 0; k < 3; k++) {
        const c = comps[k];
        const clamped = le[c] < info.baseMin[k] ? info.baseMin[k] : le[c] > info.baseMax[k] ? info.baseMax[k] : null;
        if (clamped === null) continue;
        le[c] = clamped;
        // friction against the two other axes
        for (let o = 0; o < 3; o++) {
          if (o !== k) this.baseAccel.addScaledVector(axes[o], -info.baseFriction[k] * lv[comps[o]]);
        }
      }
      this.basePos.copy(goalBase).addScaledVector(goalLeft, le.x).addScaledVector(goalUp, le.y).addScaledVector(goalForward, le.z);

      this.baseVel.copy(this.basePos).sub(this.baseLastPos).divideScalar(dt);
      this.baseLastPos.copy(this.basePos);

      if (!flex) out.copy(goal);
      out.setPosition(this.basePos);
    } else if (info.flags & IS_BOING) {
      this.boing(out, goal, goalBase, goalLeft, goalUp, goalForward, dt);
    } else if (!flex) {
      out.copy(goal);
    }
    return out;
  }

  /** The squash and stretch "boing" (a decaying sinusoid along the impact direction). */
  private boing(out: THREE.Matrix4, goal: THREE.Matrix4, goalBase: THREE.Vector3, goalLeft: THREE.Vector3, goalUp: THREE.Vector3, goalForward: THREE.Vector3, dt: number) {
    const info = this.params;
    const vel = goalBase.clone().sub(this.lastBoingPos);
    this.lastBoingPos.copy(goalBase);
    let speed = vel.length();
    if (speed < 0.00001) {
      vel.set(0, 0, 1);
      speed = 0;
    } else {
      vel.normalize();
      speed /= dt;
    }
    this.boingTime += dt;

    const minSpeed = 5;
    const minReBoingTime = 0.5;
    if ((speed > minSpeed || this.boingSpeed > minSpeed) && this.boingTime > minReBoingTime) {
      if (Math.abs(this.boingSpeed - speed) > info.boingImpactSpeed || vel.dot(this.boingVelDir) < info.boingImpactAngle) {
        this.boingTime = 0;
        this.boingDir.copy(vel).negate();
      }
    }
    this.boingVelDir.copy(vel);
    this.boingSpeed = speed;

    let damping = 1 - info.boingDampingRate * this.boingTime;
    if (damping < 0.01) {
      out.copy(goal);
      return;
    }
    damping *= damping;
    damping *= damping;
    const flex = info.boingAmplitude * Math.cos(info.boingFrequency * this.boingTime) * damping;
    const squash = 1 + flex;
    const stretch = 1 - flex;

    // "boing space": Z along the primary boing axis
    const side = Math.abs(this.boingDir.x) < 0.9 ? V().crossVectors(this.boingDir, V(1, 0, 0)) : V().crossVectors(this.boingDir, V(0, 0, 1));
    side.normalize();
    const other = V().crossVectors(this.boingDir, side);
    // rows of the "to boing" basis are side, other, boingDir; the scale is diag(squash, squash, stretch)
    const toBoing = new THREE.Matrix3().set(side.x, side.y, side.z, other.x, other.y, other.z, this.boingDir.x, this.boingDir.y, this.boingDir.z);
    const scale = new THREE.Matrix3().set(squash, 0, 0, 0, squash, 0, 0, 0, stretch);
    const fromBoing = toBoing.clone().transpose();
    // The SDK multiplies `to * scale * from` and applies it to the goal basis from the right (kept as is).
    const m = new THREE.Matrix3().multiplyMatrices(toBoing, scale).multiply(fromBoing);
    const basis = new THREE.Matrix3().set(
      goalLeft.x, goalUp.x, goalForward.x,
      goalLeft.y, goalUp.y, goalForward.y,
      goalLeft.z, goalUp.z, goalForward.z,
    ).multiply(m);
    const e = basis.elements;
    out.makeBasis(V(e[0], e[1], e[2]), V(e[3], e[4], e[5]), V(e[6], e[7], e[8])).setPosition(goalBase);
  }
}
