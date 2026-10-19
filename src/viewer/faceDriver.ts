/**
 * Drives a character's face from a scene every frame: the scene's flex animations and expressions over the character's own controller
 * values, then the mouth shapes of the lines its speak events say (their phonemes, from the game's phoneme data), at the time of a
 * clock (the character's animation). Keeps those lines' sounds playing in step with it.
 */
import type { Playback } from "./animator";
import { addLipSync, sceneFace, type LipSync, type PhonemeClasses, type SceneData } from "./faceScene";
import type { FlexGlobals } from "./flex";
import { stopAll, syncVoice } from "./voicePlayer";

/** A line a speak event says. */
export interface FaceLine {
  /** When it starts, in scene time (seconds). */
  start: number;
  wave: string;
  buffer: AudioBuffer | null;
  lip: LipSync | null;
}

export interface FaceSetup {
  /** Who the sounds belong to (one sound per line at a time). */
  owner: string;
  scene: SceneData;
  lines: FaceLine[];
  classes: PhonemeClasses | null;
  /** The model's controller names, lower case. */
  controllers: ReadonlySet<string>;
  /** The character's own controller values (the flex sliders). */
  base: () => FlexGlobals;
  /** Scene time in seconds. */
  clock: (pb: Playback) => number;
  /** Whether the lines are heard now (the clock runs, and it is the selected character). */
  audible: (pb: Playback) => boolean;
  /** Whether the clock runs. Paused, the face is shown on the sliders (see `show`), where it can be edited and reset. */
  running?: (pb: Playback) => boolean;
  /** Puts the face on the sliders while paused; null: the pause is over, the sliders are the character's own again. */
  show?: (values: FlexGlobals | null) => void;
}

export class FaceDriver {
  private last = NaN;
  private dirty = true;
  private wasRunning = true;
  /** The character's own values as they were when the clock stopped: what the scene goes over while it is paused. */
  private held: FlexGlobals | null = null;
  /** The sliders were edited while paused: the face is theirs, the scene does not go over them until the time moves. */
  private touched = false;
  private touchTime = NaN;
  constructor(readonly setup: FaceSetup) {}

  /** The character's own values changed: the face is worked out again on the next frame. */
  invalidate() {
    this.dirty = true;
  }

  /** A slider was edited; while paused the face is then the sliders'. */
  touch() {
    if (!this.held) return;
    this.touched = true;
    this.touchTime = this.last;
  }

  /** Whether the sliders show the scene's face (paused, and not edited since). */
  showing(): boolean {
    return !!this.held && !this.touched;
  }

  /** The face of this moment was kept on the sliders: they are the character's own now. */
  release() {
    this.held = null;
    this.touched = false;
    this.dirty = true;
  }

  /** The face at the clock's time, the lines' sounds kept in step; null when the face did not change. */
  run(pb: Playback): FlexGlobals | null {
    const s = this.setup;
    const time = s.clock(pb);
    const audible = s.audible(pb);
    s.lines.forEach((line, i) => {
      if (line.buffer) syncVoice(s.owner, String(i), line.buffer, time - line.start, audible);
    });
    const running = s.running ? s.running(pb) : true;
    if (running && !this.wasRunning) {
      this.wasRunning = true;
      if (this.held) {
        this.held = null;
        this.touched = false;
        s.show?.(null);
      }
      this.dirty = true;
    } else if (!running && this.wasRunning) {
      this.wasRunning = false;
      this.held = new Map(s.base());
      this.touched = false;
      this.dirty = true;
    }
    if (this.touched && time !== this.touchTime) this.touched = false;
    if (this.touched || (time === this.last && !this.dirty)) return null;
    this.last = time;
    this.dirty = false;
    const out = this.face(time);
    if (this.held) s.show?.(out);
    return out;
  }

  /** The face at a scene time. */
  face(time: number): FlexGlobals {
    const s = this.setup;
    const out = sceneFace(s.scene, time, this.held ?? s.base(), s.controllers);
    if (s.classes) {
      for (const line of s.lines) {
        if (!line.lip) continue;
        const t = time - line.start;
        const length = line.buffer?.duration ?? Math.max(0, ...line.lip.phonemes.map((p) => p[2]));
        if (t >= 0 && t <= length) addLipSync(out, s.classes, line.lip, t, length);
      }
    }
    return out;
  }

  /** Stops its sounds (when it is taken off the character). */
  dispose() {
    stopAll(this.setup.owner);
  }
}
