/**
 * The animations a worn item plays of its own, as the game plays them: a sequence it runs on its own clock all the time (an autoplay or
 * real-time sequence: the Pet RoBro's radar, the Grandmaster's turning pieces, the Hat of Undeniable Wealth and Respect's blinking octopus),
 * and the one its `playback_activity` names for while its wearer taunts (the Infernal Orchestrina's drum).
 */
import type { ClipData, SequenceInfo } from "./payload";

/** The sequence a worn item runs on its own clock: of its autoplay and real-time sequences that move, the longest; null when it has none. */
export function clockSequence(sequences: readonly SequenceInfo[]): SequenceInfo | null {
  let best: SequenceInfo | null = null;
  for (const s of sequences) if (s.onClock && s.frames > 1 && (!best || s.frames > best.frames)) best = s;
  return best;
}

/** The sequence of an activity (`ACT_RUN`), as `playback_activity` names it; null when the model has none. */
export function activitySequence(sequences: readonly SequenceInfo[], activity: string): SequenceInfo | null {
  const want = activity.trim().toUpperCase();
  if (!want) return null;
  return sequences.find((s) => (s.activity ?? "").toUpperCase() === want) ?? null;
}

/** Whether any bone of a clip moves away from where it is on the first frame (a clip that only holds a pose is not worth running). */
export function clipMoves(clip: ClipData, epsilon = 1e-4): boolean {
  const n = clip.numBones;
  for (let f = 1; f < clip.frames; f++) {
    for (let i = 0; i < n * 3; i++) if (Math.abs(clip.pos[f * n * 3 + i] - clip.pos[i]) > epsilon * 100) return true;
    for (let i = 0; i < n * 4; i++) if (Math.abs(clip.quat[f * n * 4 + i] - clip.quat[i]) > epsilon) return true;
  }
  return false;
}
