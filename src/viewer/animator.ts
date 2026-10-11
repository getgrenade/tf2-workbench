import * as THREE from "three";
import type { BoneData, ClipData } from "./payload";

/** Source space (x forward, y left, z up) to viewer space (x left, y up, z forward). */
export const SOURCE_TO_VIEWER = new THREE.Matrix4().set(
  0, 1, 0, 0,
  0, 0, 1, 0,
  1, 0, 0, 0,
  0, 0, 0, 1,
);

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _one = new THREE.Vector3(1, 1, 1);
const _local = new THREE.Matrix4();

/** Bone hierarchy with bind matrices; computes bone-to-world matrices (Source space) from poses. */
export class Rig {
  readonly parents: number[];
  /** World -> bone at bind time (the skeleton's inverse bind matrices). */
  readonly poseToBone: THREE.Matrix4[];
  /** Bone -> world in the bind pose (inverse of `poseToBone`). */
  readonly bindWorld: THREE.Matrix4[];
  /** Current bone -> world. */
  readonly boneWorld: THREE.Matrix4[];

  constructor(bones: BoneData[]) {
    this.parents = bones.map((b) => b.parent);
    this.poseToBone = bones.map((b) => {
      const m = b.poseToBone;
      return new THREE.Matrix4().set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[9], m[10], m[11], 0, 0, 0, 1);
    });
    this.bindWorld = this.poseToBone.map((m) => m.clone().invert());
    this.boneWorld = this.bindWorld.map((m) => m.clone());
  }

  setBindPose() {
    this.boneWorld.forEach((m, i) => m.copy(this.bindWorld[i]));
  }

  /**
   * Poses the rig from a clip at fractional `frame`, interpolating positions linearly and
   * orientations spherically (the engine interpolates between frames the same way).
   */
  poseFromClip(clip: ClipData, frame: number) {
    const last = clip.frames - 1;
    const f = Math.min(Math.max(frame, 0), last);
    const i0 = Math.floor(f);
    const i1 = Math.min(i0 + 1, last);
    const s = f - i0;
    const nb = clip.numBones;
    if (nb !== this.boneWorld.length) return; // clip was baked for a different skeleton
    for (let b = 0; b < nb; b++) {
      const a = (i0 * nb + b) * 3;
      const c = (i1 * nb + b) * 3;
      _p.set(
        clip.pos[a] + (clip.pos[c] - clip.pos[a]) * s,
        clip.pos[a + 1] + (clip.pos[c + 1] - clip.pos[a + 1]) * s,
        clip.pos[a + 2] + (clip.pos[c + 2] - clip.pos[a + 2]) * s,
      );
      const qa = (i0 * nb + b) * 4;
      const qc = (i1 * nb + b) * 4;
      _q.set(clip.quat[qa], clip.quat[qa + 1], clip.quat[qa + 2], clip.quat[qa + 3]);
      if (s > 0 && i1 !== i0) {
        _qb.set(clip.quat[qc], clip.quat[qc + 1], clip.quat[qc + 2], clip.quat[qc + 3]);
        _q.slerp(_qb, s);
      }
      if (clip.scale) _one.set(clip.scale[a] + (clip.scale[c] - clip.scale[a]) * s, clip.scale[a+1] + (clip.scale[c+1] - clip.scale[a+1]) * s, clip.scale[a+2] + (clip.scale[c+2] - clip.scale[a+2]) * s);
      else _one.set(1, 1, 1);
      _local.compose(_p, _q, _one);
      const parent = this.parents[b];
      if (parent < 0) this.boneWorld[b].copy(_local);
      else this.boneWorld[b].multiplyMatrices(this.boneWorld[parent], _local);
    }
  }
}

/** Playback state for a baked clip. */
export class Playback {
  clip: ClipData | null = null;
  /** Seconds since the start of the clip (before speed scaling). */
  time = 0;
  playing = true;
  speed = 1;
  /** Restart non-looping sequences when they finish. */
  loopAll = true;

  /** Current frame (fractional). */
  frame(): number {
    const c = this.clip;
    if (!c || c.frames <= 1) return 0;
    const span = c.frames - 1;
    const f = this.time * c.fps;
    if (c.looping || this.loopAll) return ((f % span) + span) % span;
    return Math.min(Math.max(f, 0), span);
  }

  setFrame(frame: number) {
    if (this.clip) this.time = frame / this.clip.fps;
  }

  advance(dt: number) {
    if (this.clip && this.playing) this.time += dt * this.speed;
  }
}
