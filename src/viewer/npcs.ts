/**
 * The game's NPCs as scene objects.
 *
 * Mann vs. Machine robots are characters: a robot plays its class's animations, holds its class's weapons and wears its cosmetics, so
 * its `cls` is a bare key (`bot_soldier`, `bot_soldier_boss`) that stands for a model under models/bots and the class it is
 * (g_szBotModels / g_szBotBossModels in tf_player.cpp). A giant is drawn at the miniboss scale (tf_mvm_miniboss_scale).
 *
 * The bosses are props (a `cls` of a path, like any other model): the Horseless Headless Horsemann, MONOCULUS, Merasmus, the
 * skeletons, the Sentry Buster and the Tank, each with the models the game attaches to it (FollowEntity, a bonemerge) and the
 * animation it stands in.
 */

export interface Robot {
  label: string;
  /** The model's path below models/. */
  model: string;
  /** The class name items_game.txt uses. */
  gameClass: string;
  giant: boolean;
}

/** tf_mvm_miniboss_scale. */
export const GIANT_SCALE = 1.75;

const CLASS_NAMES: [dir: string, label: string, gameClass: string][] = [
  ["scout", "Scout", "scout"],
  ["soldier", "Soldier", "soldier"],
  ["pyro", "Pyro", "pyro"],
  ["demo", "Demoman", "demoman"],
  ["heavy", "Heavy", "heavy"],
  ["engineer", "Engineer", "engineer"],
  ["medic", "Medic", "medic"],
  ["sniper", "Sniper", "sniper"],
  ["spy", "Spy", "spy"],
];
/** The classes with a giant model of their own (g_szBotBossModels); a giant Medic is the robot Medic made bigger. */
const BOSS_MODELS = new Set(["scout", "soldier", "pyro", "demo", "heavy"]);
const GIANTS = ["scout", "soldier", "pyro", "demo", "heavy", "medic"];

export const ROBOTS: Record<string, Robot> = Object.fromEntries([
  ...CLASS_NAMES.map(([dir, label, gameClass]) => [`bot_${dir}`, { label: `Robot ${label}`, model: `bots/${dir}/bot_${dir}`, gameClass, giant: false }]),
  ...CLASS_NAMES.filter(([dir]) => GIANTS.includes(dir)).map(([dir, label, gameClass]) => [
    `bot_${dir}_giant`,
    { label: `Giant ${label}`, model: BOSS_MODELS.has(dir) ? `bots/${dir}_boss/bot_${dir}_boss` : `bots/${dir}/bot_${dir}`, gameClass, giant: true },
  ]),
]);

export const robotOf = (cls: string): Robot | null => ROBOTS[cls] ?? null;

export interface Boss {
  label: string;
  /** The model's path below models/ (the boss's `cls`). */
  model: string;
  /** The sequence it stands in (the idle activity its behaviour starts). */
  sequence?: string;
  scale?: number;
  /** The skin it spawns in (a skeleton spawned by a spell is on the Halloween team: its third skin). */
  skin?: number;
  /** Models the game attaches to it, and the sequence one plays over and over (the tank's tracks). */
  attached?: { model: string; loop?: string }[];
  /** The map (in tf/maps) whose packed files have the model: the game's archives do not. */
  map?: string;
  /** It floats where it is put (MONOCULUS) rather than standing on its origin, which the game keeps on the ground. */
  floats?: boolean;
  /**
   * What it says, for the voice lines: the sound script entries whose names start with `sounds` (less those with `skip` in them), and the
   * sound files under `folders` (from sound/; a map's packed files too).
   */
  voice?: { sounds?: string[]; skip?: string[]; folders?: string[] };
}

export const BOSSES: Record<string, Boss> = {
  // headless_hatman.cpp: the axe follows the Horsemann (the mallet in the Doomsday scenario); headless_hatman_attack.cpp stands in ITEM1
  hatman: { label: "Horseless Headless Horsemann", model: "bots/headless_hatman", sequence: "stand_item1", attached: [{ model: "weapons/c_models/c_bigaxe/c_bigaxe" }], voice: { sounds: ["Halloween.HeadlessBossAlert", "Halloween.HeadlessBossAttack", "Halloween.HeadlessBossBoo", "Halloween.HeadlessBossDeath", "Halloween.HeadlessBossDying", "Halloween.HeadlessBossLaugh", "Halloween.HeadlessBossPain", "Halloween.HeadlessBossSpawn"] } },
  monoculus: { label: "MONOCULUS", model: "props_halloween/halloween_demoeye", sequence: "general_noise", floats: true, voice: { sounds: ["Halloween.EyeballBoss", "Halloween.MonoculusBoss"] } },
  merasmus: { label: "Merasmus", model: "bots/merasmus/merasmus", sequence: "stand_melee", voice: { sounds: ["Halloween.Merasmus", "Merasmus.RoundBegins"], skip: ["merasmus_", "merasmusloop"] } },
  // zombie.cpp: a skeleton on no team wears the third skin; the king is the boss model at twice the size, with a crown on bip_head
  skeleton: { label: "Skeleton", model: "bots/skeleton_sniper/skeleton_sniper", sequence: "stand_melee", skin: 2, voice: { sounds: ["Halloween.skeleton_laugh_small", "Halloween.skeleton_laugh_medium"] } },
  skeletonKing: { label: "Skeleton King", model: "bots/skeleton_sniper_boss/skeleton_sniper_boss", sequence: "stand_melee", skin: 2, scale: 2, attached: [{ model: "player/items/demo/crown" }], voice: { sounds: ["Halloween.skeleton_laugh_giant"] } },
  buster: { label: "Sentry Buster", model: "bots/demo/bot_sentry_buster", sequence: "stand_item1", voice: { sounds: ["MVM.SentryBuster"] } },
  // tf_tank_boss.cpp: the tracks (playing "forward") and the bomb follow the tank, which plays "movement"
  tank: {
    label: "Tank",
    model: "bots/boss_bot/boss_tank",
    sequence: "movement",
    voice: { sounds: ["MVM.TankStart", "MVM.TankDeploy", "MVM.TankPing", "MVM.TankSmash", "MVM.TankExplodes", "MVM.TankEnd", "MVM.TankEngineLoop"] },
    attached: [{ model: "bots/boss_bot/tank_track_l", loop: "forward" }, { model: "bots/boss_bot/tank_track_r", loop: "forward" }, { model: "bots/boss_bot/bomb_mechanism" }],
  },
  // Versus Saxton Hale: the VScript game mode gives its Hale a model the maps pack (with its animations), not the game's archives; the
  // holiday maps have their own Hales
  saxton: { label: "Saxton Hale", model: "vsh/player/saxton_hale", sequence: "stand_MELEE", map: "vsh_nucleus", voice: { folders: ["mvm/saxton_hale_ns_2025_1/"] } },
  santaHale: { label: "Santa Hale", model: "vsh/player/santa_hale", sequence: "stand_MELEE", map: "vsh_maul", voice: { folders: ["mvm/saxton_hale_ml_2025_1/"] } },
  hellHale: { label: "Hellfire Hale", model: "vsh/player/hell_hale", sequence: "stand_MELEE", map: "vsh_outburst", voice: { folders: ["mvm/hellfire_hale_ob_2025_1/", "mvm/hellfire_hale_new_ob_2025_1/"] } },
  // the Smissmas boss of koth_krampus, which packs his model
  krampus: { label: "Krampus", model: "bots/krampus", sequence: "krampus_idle", map: "koth_krampus", voice: { folders: ["mvm/krampus"] } },
};

/** The boss a prop's `cls` is, if it is one. */
export const bossOf = (cls: string): Boss | null => Object.values(BOSSES).find((b) => b.model === cls.split("#")[0].toLowerCase()) ?? null;
