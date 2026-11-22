/**
 * Killstreak weapons: the sheen of a Specialized Killstreak (`killstreak idleeffect`, 1..7) and the eye effect of a Professional one
 * (`killstreak effect`, 2002..2008), as C_TFPlayer draws them (c_tf_player.cpp: g_KillStreakEffectsBase, CProxyAnimatedWeaponSheen,
 * UpdateKillStreakEffects).
 */
import type { ModelData } from "./payload";
import type { Rgb } from "./proxies";

/** What a weapon of a character has: its sheen (0: none), its killstreaker (0: none), and whether the streak is high (10 kills and up). */
export interface Killstreak {
  sheen: number;
  effect: number;
  high: boolean;
  /** How fast the sheen sweeps, against the game's 25 frames a second (1, absent: as in game). */
  speed?: number;
}

/** The range of the sheen's speed. */
export const SHEEN_SPEED = { min: 0.25, max: 4 };

interface SheenColors { sheen: Rgb; eye1: Rgb; eye2: Rgb }
const c = (r: number, g: number, b: number): Rgb => [r / 255, g / 255, b / 255];

/** The sheens by `killstreak idleeffect`: their name, and the sheen's colour and the eye effect's two colours (RED, then BLU where it differs). */
export const SHEENS: { id: number; name: string; red: SheenColors; blu?: SheenColors }[] = [
  { id: 1, name: "Team Shine", red: { sheen: c(200, 20, 15), eye1: c(255, 118, 118), eye2: c(255, 35, 28) }, blu: { sheen: c(40, 98, 200), eye1: c(0, 92, 255), eye2: c(134, 203, 243) } },
  { id: 2, name: "Deadly Daffodil", red: { sheen: c(242, 172, 10), eye1: c(255, 237, 138), eye2: c(255, 213, 65) } },
  { id: 3, name: "Manndarin", red: { sheen: c(255, 75, 5), eye1: c(255, 111, 5), eye2: c(255, 137, 31) } },
  { id: 4, name: "Mean Green", red: { sheen: c(100, 255, 10), eye1: c(230, 255, 60), eye2: c(193, 255, 61) } },
  { id: 5, name: "Agonizing Emerald", red: { sheen: c(40, 255, 70), eye1: c(103, 255, 121), eye2: c(165, 255, 193) } },
  { id: 6, name: "Villainous Violet", red: { sheen: c(105, 20, 255), eye1: c(105, 20, 255), eye2: c(185, 145, 255) } },
  { id: 7, name: "Hot Rod", red: { sheen: c(255, 30, 255), eye1: c(255, 120, 255), eye2: c(255, 176, 217) } },
];

/** The killstreakers by `killstreak effect`: their name and the eye effect's particle system (lvl2 from 10 kills, tf_killstreakeyes_maxkills). */
export const KILLSTREAKERS: { id: number; name: string; system: string }[] = [
  { id: 2002, name: "Fire Horns", system: "killstreak_t1" },
  { id: 2003, name: "Cerebral Discharge", system: "killstreak_t2" },
  { id: 2004, name: "Tornado", system: "killstreak_t3" },
  { id: 2005, name: "Flames", system: "killstreak_t4" },
  { id: 2006, name: "Singularity", system: "killstreak_t5" },
  { id: 2007, name: "Incinerator", system: "killstreak_t6" },
  { id: 2008, name: "Hypno-Beam", system: "killstreak_t7" },
];

export const NO_KILLSTREAK: Readonly<Killstreak> = { sheen: 0, effect: 0, high: false };
export const hasKillstreak = (k: Readonly<Killstreak> | undefined) => !!k && (k.sheen > 0 || k.effect > 0);

/** A saved killstreak, checked (unknown sheens and killstreakers are dropped; a killstreaker needs a sheen, as in game). */
export function parseKillstreak(raw: unknown): Killstreak | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const sheen = SHEENS.some((s) => s.id === r.sheen) ? (r.sheen as number) : 0;
  const effect = sheen && KILLSTREAKERS.some((k) => k.id === r.effect) ? (r.effect as number) : 0;
  const speed = typeof r.speed === "number" && Number.isFinite(r.speed) && r.speed !== 1 ? Math.min(SHEEN_SPEED.max, Math.max(SHEEN_SPEED.min, r.speed)) : undefined;
  return sheen ? { sheen, effect, high: r.high === true, ...(speed !== undefined ? { speed } : {}) } : null;
}

function colorsOf(sheen: number, team: number): SheenColors | null {
  const s = SHEENS.find((x) => x.id === sheen);
  return s ? (team === 1 && s.blu ? s.blu : s.red) : null;
}

/** The sheen's colour for the team ($sheenmaptint), or null without a sheen. */
export const sheenTint = (sheen: number, team: number): Rgb | null => colorsOf(sheen, team)?.sheen ?? null;

/**
 * Where the sheen's mask lies on a weapon (CProxyAnimatedWeaponSheen::InitParams): along the longest side of its bounds, from the
 * smallest coordinate over that side's length (`dir` 0 along x, 1 along y, 2 along z), the other side as the second axis.
 */
export function sheenFrame(data: ModelData): { dir: 0 | 1 | 2; scale: [number, number]; offset: [number, number] } {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const bp of data.bodyParts) for (const m of bp.models[0]?.meshes ?? []) {
    for (let i = 0; i < m.positions.length; i += 3) for (let a = 0; a < 3; a++) {
      const v = m.positions[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  if (!Number.isFinite(min[0])) return { dir: 0, scale: [1, 1], offset: [0, 0] };
  const size = (a: number) => Math.max(1e-3, max[a] - min[a]);
  let out: { dir: 0 | 1 | 2; scale: [number, number]; offset: [number, number] } = { dir: 0, scale: [size(0), size(2)], offset: [min[0], min[2]] };
  if (size(1) > out.scale[0]) out = { dir: 1, scale: [size(1), size(0)], offset: [min[1], min[0]] };
  if (size(2) > out.scale[0]) out = { dir: 2, scale: [size(2), size(1)], offset: [min[2], min[1]] };
  return out;
}

/**
 * How long the sheen waits between its sweeps (GetTimeBetweenAnims): five seconds without a streak, none from five kills, so a high
 * streak sweeps without a pause.
 */
export const sheenWait = (k: Readonly<Killstreak>) => (k.high ? 0 : 5);

/**
 * The eye effect of a killstreaker, on each eye (eyeglow_R, and eyeglow_L but on the Demoman: that one is the Eyelander's), coloured by
 * the sheen (CUSTOM_COLOR_CP1, the colours go in as control points 9 and 10). Nothing without a killstreaker; it shows once the
 * streak has begun (tf_killstreakeyes_minkills), at lvl1, and at lvl2 from 10 kills.
 */
export function killstreakEyes(k: Readonly<Killstreak> | undefined, team: number, gameClass: string): { item: null; system: string; attachment: string; colors: number[] }[] {
  if (!k || !k.effect) return [];
  const effect = KILLSTREAKERS.find((x) => x.id === k.effect);
  const colors = colorsOf(k.sheen, team);
  if (!effect || !colors) return [];
  const system = `${effect.system}_lvl${k.high ? 2 : 1}`;
  const rgb = [...colors.eye1, ...colors.eye2];
  return ["eyeglow_R", ...(gameClass === "demoman" ? [] : ["eyeglow_L"])].map((attachment) => ({ item: null, system, attachment, colors: rgb }));
}
