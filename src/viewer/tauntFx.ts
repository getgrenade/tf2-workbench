/**
 * The sounds and particle effects of what a character plays, on the character's clock. The game makes them in three ways, all read here:
 * - the animation events of the sequence (`C_BaseAnimating::FireEvent`): `AE_CL_PLAYSOUND` plays a sound script entry, `AE_CL_CREATE_PARTICLE_EFFECT`
 *   starts a system at the origin or an attachment (`<system> <attach type> [attachment]`), which runs until the taunt is over;
 * - the taunt item's attributes: `taunt success sound` (and its `loop`, played over and over), each with its offset, and the `taunt attack`
 *   the game's code makes (the Shred Alert's riff and lightning, `CTFPlayer::DoTauntAttack`);
 * - a worn cosmetic's `cosmetic taunt sound`, played while its wearer taunts (the Boombox, the Infernal Orchestrina).
 */
import type { AnimEvent, SoundEntry } from "../api";
import type { Playback } from "./animator";
import type { ItemInfo } from "./payload";
import { stopAll, syncVoice } from "./voicePlayer";

/** A sound of the plan: a sound script entry (its waves) from `start` seconds into the sequence. */
export interface TauntSound {
  start: number;
  name: string;
  waves: string[];
  /** Played over and over until the taunt is over (a taunt's success sound loop). */
  looping: boolean;
}

/** A particle system of the plan, started `start` seconds into the sequence and kept running until it is over. */
export interface TauntParticle {
  start: number;
  system: string;
  /** The attachment of the class model it is at; null: the character's origin. */
  attachment: string | null;
  /** It follows what it is at (`follow_*`), or stays where it started (`start_at_*`). */
  follow: boolean;
}

export interface TauntFxPlan {
  sounds: TauntSound[];
  particles: TauntParticle[];
}

/** What the game's code does for a taunt attack, where it is no more than a sound and a particle system (`CTFPlayer::DoTauntAttack`). */
const TAUNT_ATTACKS: Record<string, { sound?: string; particle?: Omit<TauntParticle, "start"> }> = {
  // the riff and its lightning, at the player's feet where the taunt started
  TAUNTATK_ALLCLASS_GUITAR_RIFF: { sound: "Taunt.GuitarRiff", particle: { system: "bl_killtaunt", attachment: null, follow: false } },
};

/** The sound script entries a taunt item and the worn items name (to be looked up before planning). */
export function tauntSoundNames(taunt: ItemInfo | null, worn: readonly ItemInfo[]): string[] {
  const names = new Set<string>();
  const attack = taunt?.tauntAttack ? TAUNT_ATTACKS[taunt.tauntAttack] : undefined;
  if (attack?.sound) names.add(attack.sound);
  for (const s of taunt?.tauntSounds ?? []) names.add(s.name);
  for (const item of worn) for (const s of item.tauntSounds ?? []) names.add(s.name);
  return [...names];
}

/** `GetAttachTypeFromString`, the attach types an event can name: at the origin or an attachment, following it or left where it started. */
function attachType(type: string): { origin: boolean; follow: boolean } | null {
  switch (type.toLowerCase()) {
    case "start_at_origin": return { origin: true, follow: false };
    case "follow_origin": return { origin: true, follow: true };
    case "start_at_attachment": return { origin: false, follow: false };
    case "follow_attachment": return { origin: false, follow: true };
    case "follow_rootbone": return { origin: true, follow: true };
    default: return null;
  }
}

/** A particle event's options (`taunt_yeti_fistslam start_at_attachment effect_hand_R`); null when the game would refuse them too. */
export function parseParticleEvent(options: string, start: number): TauntParticle | null {
  const [system, type, attachment] = options.trim().split(/\s+/);
  if (!system || !type) return null;
  const how = attachType(type);
  if (!how) return null;
  if (how.origin) return { start, system, attachment: null, follow: how.follow };
  if (!attachment || /^\d+$/.test(attachment)) return null; // (a numbered attachment: the class models name theirs)
  return { start, system, attachment, follow: how.follow };
}

/**
 * What a character playing a sequence hears and shows: the sequence's own events, then, when it is a taunt, the taunt item's sounds and
 * attack and the worn items' taunt sounds. `entries` are the sound script entries by lower case name.
 */
export function planTauntFx(events: readonly AnimEvent[], entries: Readonly<Record<string, SoundEntry>>, taunt: ItemInfo | null, worn: readonly ItemInfo[], taunting: boolean): TauntFxPlan {
  const plan: TauntFxPlan = { sounds: [], particles: [] };
  const sound = (name: string, start: number, looping = false) => {
    const waves = entries[name.toLowerCase()]?.waves ?? [];
    if (waves.length) plan.sounds.push({ start, name, waves, looping });
  };
  for (const e of events) {
    if (e.name === "AE_CL_PLAYSOUND" && e.options) sound(e.options, e.time);
    else if (e.name === "AE_CL_CREATE_PARTICLE_EFFECT") {
      const particle = parseParticleEvent(e.options, e.time);
      if (particle) plan.particles.push(particle);
    }
  }
  if (!taunting) return plan;
  if (taunt) {
    const attack = taunt.tauntAttack ? TAUNT_ATTACKS[taunt.tauntAttack] : undefined;
    const at = taunt.tauntAttackTime ?? 0;
    if (attack?.sound) sound(attack.sound, at);
    if (attack?.particle) plan.particles.push({ start: at, ...attack.particle });
    for (const s of taunt.tauntSounds ?? []) sound(s.name, s.offset, s.looping);
  }
  for (const item of worn) for (const s of item.tauntSounds ?? []) sound(s.name, s.offset, s.looping);
  return plan;
}

/** A particle system of the plan that runs now; `key` changes each time the sequence starts over, so the system starts again with it. */
export interface RunningParticle extends TauntParticle {
  id: string;
  key: string;
}

/** Where the character's clock is in its sequence: seconds into it, and how many times it started over. */
export function sequenceClock(pb: Playback): { time: number; pass: number } {
  const clip = pb.clip;
  if (!clip || clip.frames <= 1 || clip.fps <= 0) return { time: 0, pass: 0 };
  const span = clip.frames - 1;
  const frames = pb.time * clip.fps;
  const loops = clip.looping || pb.loopAll;
  return { time: pb.frame() / clip.fps, pass: loops ? Math.floor(frames / span) : 0 };
}

/** The particle systems of the plan that run at a moment of the sequence: those started by then, until it is over. */
export function runningParticles(plan: TauntFxPlan, time: number, pass: number): RunningParticle[] {
  return plan.particles
    .map((p, i) => ({ ...p, id: `${i}:${p.system}`, key: `${pass}` }))
    .filter((p) => time >= p.start);
}

/**
 * Runs a plan on a character's clock every frame: keeps its sounds playing in step (heard while `audible`) and tells `particles` which systems
 * run whenever that changes.
 */
export class TauntFxDriver {
  private lastParticles = "";
  constructor(
    readonly owner: string,
    readonly plan: TauntFxPlan,
    private readonly buffers: (AudioBuffer | null)[],
    private readonly audible: (pb: Playback) => boolean,
    private readonly particles: (running: RunningParticle[]) => void,
  ) {}

  run(pb: Playback) {
    const { time, pass } = sequenceClock(pb);
    const audible = this.audible(pb);
    this.plan.sounds.forEach((s, i) => {
      const buffer = this.buffers[i];
      if (!buffer) return;
      let offset = time - s.start;
      if (s.looping && offset >= 0) offset %= buffer.duration;
      syncVoice(this.owner, String(i), buffer, offset, audible);
    });
    const running = runningParticles(this.plan, time, pass);
    const signature = running.map((p) => `${p.id}@${p.key}`).join("|");
    if (signature === this.lastParticles) return;
    this.lastParticles = signature;
    this.particles(running);
  }

  dispose() {
    stopAll(this.owner);
    if (this.lastParticles) this.particles([]);
    this.lastParticles = "";
  }
}
