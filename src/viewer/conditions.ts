import type { MaterialEffects, Rgb } from "./proxies";

/**
 * The player conditions that change how a character looks (tf_player_shared.cpp, c_tf_player.cpp). Each can be switched on by hand
 * (the Effects toggles) and some happen by themselves in Play mode: a Jarate burst soaks, a flamethrower sets alight.
 */
export const CONDITION_KEYS = ["uber", "urine", "milk", "burning", "crit", "phase"] as const;
export type ConditionKey = (typeof CONDITION_KEYS)[number];
export type Conditions = Record<ConditionKey, boolean>;

export const NO_CONDITIONS: Readonly<Conditions> = { uber: false, urine: false, milk: false, burning: false, crit: false, phase: false };
export const CONDITION_LABELS: Record<ConditionKey, string> = { uber: "Ubercharge", urine: "Jarate", milk: "Mad Milk", burning: "On fire", crit: "Crit boost", phase: "Bonk" };

/** How long the conditions that Play mode applies last: jars add TF_COND_URINE / TF_COND_MAD_MILK for 10 s (JarExplode); fire lasts TF_BURNING_FLAME_LIFE. */
export const CONDITION_SECONDS: Partial<Record<ConditionKey, number>> = { urine: 10, milk: 10, burning: 10, crit: 8, phase: 8 };

export const anyCondition = (c: Readonly<Conditions>) => CONDITION_KEYS.some((k) => c[k]);

/** A saved or typed object as conditions (unknown keys and non-booleans are dropped). */
export function parseConditions(raw: unknown): Conditions {
  const out = { ...NO_CONDITIONS };
  if (raw && typeof raw === "object") for (const k of CONDITION_KEYS) if ((raw as Record<string, unknown>)[k] === true) out[k] = true;
  return out;
}

const BLUE = 1;
/** CProxyUrineLevel: the colour that multiplies the skin ($color2 = $yellow). */
const YELLOW: Record<"red" | "blue", Rgb> = { red: [6, 9, 2], blue: [7, 5, 1] };
/** CProxyModelGlowColor: the crit boost glow of a weapon. */
const CRIT_GLOW: Record<"red" | "blue", Rgb> = { red: [80, 8, 5], blue: [5, 20, 80] };

/** What the player proxies read for a character in this state (undefined: nothing, so the ordinary shared materials are used). */
export function materialEffects(c: Readonly<Conditions>, team: number): MaterialEffects | undefined {
  const side = team === BLUE ? "blue" : "red";
  const fx: MaterialEffects = {};
  if (c.urine) fx.yellow = YELLOW[side];
  if (c.crit) fx.glow = CRIT_GLOW[side];
  if (c.burning) fx.burn = 1; // BurnLevel at its peak: the fire layer on the skin is fully in
  return Object.keys(fx).length ? fx : undefined;
}

/** The material that replaces every other on an invulnerable character (C_TFPlayer::InitInvulnerableMaterial). */
export const uberMaterialPath = (team: number) => `models/effects/invulnfx_${team === BLUE ? "blue" : "red"}`;

/** A particle system a condition runs: on the character, or on the weapon it holds. */
export interface ConditionParticle {
  system: string;
  weapon: boolean;
}

/**
 * The particle systems that run on a character in this state: Jarate and milk drip (OnAddUrine, OnAddMadMilk), fire burns
 * (OnAddBurning), and a crit boost sparks around the weapon (UpdateCritBoostEffect: critgun_weaponmodel_red/blu on the weapon).
 */
export function conditionParticles(c: Readonly<Conditions>, team: number): ConditionParticle[] {
  const systems: ConditionParticle[] = [];
  if (c.urine) systems.push({ system: "peejar_drips", weapon: false });
  if (c.milk) systems.push({ system: "peejar_drips_milk", weapon: false });
  if (c.burning) systems.push({ system: team === BLUE ? "burningplayer_blue" : "burningplayer_red", weapon: false });
  if (c.crit) systems.push({ system: team === BLUE ? "critgun_weaponmodel_blu" : "critgun_weaponmodel_red", weapon: true });
  // a Bonked Scout (TF_COND_PHASE): the warp haze while he stands still (UpdatePhaseEffects)
  if (c.phase) systems.push({ system: "warp_version", weapon: false });
  return systems;
}
