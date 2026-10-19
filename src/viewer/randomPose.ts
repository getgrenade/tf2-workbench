/**
 * The rules of the random poses and faces, shared by every roll that poses a character (the Random loadout window and the promo maker):
 * what is picked is plain data in and out, and the callers dress and pose the character with it.
 */
import { itemUsableBy, slotForClass, type ItemInfo, type PoseParamInfo, type SequenceInfo } from "./payload";
import { isJunkSequence } from "./sequenceFilter";

/** Animations a random pose does not pick: overlays and aim matrices (half a pose on their own), and the reference pose. */
// (also what leaves the floor or the hands, or is a death: in the air, a jump, a stun, the blends into and out of a taunt)
export const NOT_A_POSE = /^(layer_|gesture|a_|g_)|_layer$|^ref$|aimmatrix|crouch|stun|airwalk|jump|inblend|outblend|death|dieviolent/i;

/** Taunts a random roll never picks (by the name of their scene): the Yeti's (the Yeti Punch and Yeti Smash). */
export const NOT_ROLLED_TAUNT = /yeti/i;

/**
 * The pose parameters a random animation rolls. `spread`: how far from the middle of the range (1: all of it); `min` / `max`: real
 * values (degrees). The run's forward / back speed is rolled over the whole range, the sideways run and the body's yaw within a quarter
 * of it, and the body's pitch from 12° down to 4° up, so the poses are not extreme.
 */
export const ROLL: Record<string, { spread: number } | { min: number; max: number }> = { move_x: { spread: 1 }, move_y: { spread: 0.25 }, body_pitch: { min: -12, max: 4 }, body_yaw: { spread: 0.25 } };

/** What a random roll poses a character with: a taunt (held, it plays its own animation) or a weapon animation with a weapon of it. */
export type PoseChoice =
  | { kind: "taunt"; id: string; taunt: ItemInfo }
  | { kind: "anim"; id: string; seq: SequenceInfo; weapon: ItemInfo; params: Record<string, number> };

export interface PoseSource {
  /** The game class (`demoman`). */
  game: string;
  taunts: readonly ItemInfo[];
  weapons: readonly ItemInfo[];
  /** The class model's sequences and pose parameters (empty before it is loaded: only a taunt can be chosen). */
  sequences: readonly SequenceInfo[];
  poseParams: readonly PoseParamInfo[];
  /** A taunt with a prop of its own may be chosen (the promo maker leaves them out: the prop would be missing from the picture). */
  props: boolean;
}

/** The ids `avoid` is made of: `t<item id>` for a taunt, `s<sequence name>` for an animation. */
export const tauntId = (taunt: ItemInfo) => `t${taunt.id}`;
export const sequenceId = (name: string) => `s${name}`;

const pickOne = <T,>(list: readonly T[], rand: () => number): T | undefined => list[Math.floor(rand() * list.length)];
const fresh = <T,>(list: readonly T[], id: (x: T) => string, avoid: ReadonlySet<string>, rand: () => number) => pickOne(list.filter((x) => !avoid.has(id(x))), rand) ?? pickOne(list, rand);

/** The animation set a weapon plays: its `anim_slot`, else its loadout slot. */
const animKey = (w: ItemInfo, game: string) => { const a = w.animSlot.toLowerCase(); return a && a !== "force_not_used" ? a : slotForClass(w, game).toLowerCase(); };

/** The taunts a random roll may pick for the class. */
export function rollableTaunts(src: Pick<PoseSource, "game" | "taunts" | "props">): ItemInfo[] {
  return src.taunts.filter((t) => !t.workshop && itemUsableBy(t, src.game) && t.tauntScenes[src.game] !== undefined && (src.props || !t.tauntPropScenes[src.game]) && !NOT_ROLLED_TAUNT.test(t.tauntScenes[src.game]));
}

/** The weapon animations (standing or running with one) a random roll may pick, each with the weapons of its animation set. */
export function rollableAnimations(src: PoseSource): { seq: SequenceInfo; weapons: ItemInfo[] }[] {
  const armed = src.weapons.filter((w) => !w.workshop && w.slot !== "taunt" && itemUsableBy(w, src.game));
  return src.sequences
    .filter((q) => q.frames > 1 && !NOT_A_POSE.test(q.name) && !isJunkSequence(q.name))
    .flatMap((seq) => {
      const set = /^(?:stand|run)_(.+)$/i.exec(seq.name)?.[1].toLowerCase();
      const weapons = set ? armed.filter((w) => animKey(w, src.game) === set) : [];
      return weapons.length ? [{ seq, weapons }] : [];
    });
}

/**
 * Rolls the pose parameters of a weapon animation: the weapon's own (arm and grip), the aim (body pitch and yaw) and, for a run, its
 * direction. A standing character does not move: the run's direction goes back to its default.
 */
export function rollPoseParams(seq: SequenceInfo, weapon: ItemInfo, params: readonly PoseParamInfo[], rand: () => number = Math.random): Record<string, number> {
  const out: Record<string, number> = { r_arm: 0, r_hand_grip: 0, ...weapon.poseParams };
  for (const p of params) {
    const roll = ROLL[p.name.toLowerCase()];
    if (!roll) continue;
    const standing = /^move_/i.test(p.name) && !/^run_/i.test(seq.name);
    out[p.name.toLowerCase()] = standing ? p.start + p.default * (p.end - p.start)
      : "spread" in roll ? p.start + (0.5 + ((rand() * 2 - 1) * roll.spread) / 2) * (p.end - p.start)
      : Math.min(Math.max(roll.min + rand() * (roll.max - roll.min), p.start), p.end);
  }
  return out;
}

/** Picks a taunt, or an animation with a weapon and its parameters rolled; null when there is none to pick. `avoid`: what the others of a scene have. */
export function choosePose(kind: "taunt" | "anim", src: PoseSource, avoid: ReadonlySet<string> = new Set(), rand: () => number = Math.random): PoseChoice | null {
  if (kind === "taunt") {
    const taunt = fresh(rollableTaunts(src), tauntId, avoid, rand);
    return taunt ? { kind, id: tauntId(taunt), taunt } : null;
  }
  const pick = fresh(rollableAnimations(src), (a) => sequenceId(a.seq.name), avoid, rand);
  const weapon = pick ? pickOne(pick.weapons, rand) : undefined;
  return pick && weapon ? { kind, id: sequenceId(pick.seq.name), seq: pick.seq, weapon, params: rollPoseParams(pick.seq, weapon, src.poseParams, rand) } : null;
}

/** An emotion controller of the class models (the lower face; `...Upper` is its brows and lids, set with it). */
export const EMOTION = /^(happy|mad|pain|scared|upset|angry|sad|evil|screaming|yelling|cocky|squint|aggress|skeptical|smile)/i;
/** An upper flex (brows, lids) a random roll sets goes no higher than this. */
export const UPPER_MAX = 0.15;

const isUpper = (name: string) => name.startsWith("upper") || name.endsWith("upper");

/**
 * A random face: one mouth shape (of `shapes`: the controllers and weights of the phonemes of the class), and one or two emotions at random
 * strengths. The face stays natural: an upper flex at most {@link UPPER_MAX}, and all the flexes add up to at most 1 (what is over is
 * taken off the others in proportion: three flexes at 1 become 0.4, 0.4, 0.2 or the like). `have`: the model's controllers, lower case.
 */
export function rollFace(have: ReadonlySet<string>, shapes: readonly (readonly (readonly [string, number])[])[], rand: () => number = Math.random): Map<string, number> {
  const values = new Map<string, number>();
  if (have.size < 4) return values; // a model with no face (the Pyro's mask)
  const put = (name: string, value: number) => values.set(name.toLowerCase(), Math.max(values.get(name.toLowerCase()) ?? 0, Math.min(1, value)));
  const shape = pickOne(shapes.filter((list) => list.some(([c, w]) => w > 0 && have.has(c.toLowerCase()))), rand);
  const strength = 0.6 + rand() * 0.4;
  for (const [c, w] of shape ?? []) if (w > 0 && have.has(c.toLowerCase())) put(c, w * strength);
  const names = [...have];
  const emotions = names.filter((n) => EMOTION.test(n) && !n.endsWith("upper"));
  for (const emotion of [pickOne(emotions, rand), rand() < 0.5 ? pickOne(emotions, rand) : undefined]) {
    if (!emotion) continue;
    const amount = 0.35 + rand() * 0.65;
    put(emotion, amount);
    // its upper face (brows, lids) goes with it
    const upper = names.find((n) => n === `${emotion}upper` || n === `upper${emotion}`);
    if (upper) put(upper, amount);
  }
  let upperTotal = 0, rest = 0;
  for (const [name, value] of values) {
    if (isUpper(name)) { const v = Math.min(value, UPPER_MAX); values.set(name, v); upperTotal += v; } else rest += value;
  }
  const room = Math.max(0, 1 - upperTotal);
  if (rest > room) for (const [name, value] of values) if (!isUpper(name)) values.set(name, (value * room) / rest);
  return values;
}
