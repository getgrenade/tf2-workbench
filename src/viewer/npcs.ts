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
  /** A Half-Life 2 character (from the HL2 content that comes with TF2: hl2/hl2_*.vpk), and which part of the HL2 menu it is in. */
  hl2?: "characters" | "combine" | "citizens" | "creatures";
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
  // ghost.cpp: the Halloween ghost floats where it haunts, moaning and booing (without the hat too; the "red" model is the same one)
  ghost: { label: "Ghost", model: "props_halloween/ghost", sequence: "idle", floats: true, voice: { sounds: ["Halloween.GhostMoan", "Halloween.GhostBoo", "Halloween.Haunted"] } },
  ghostNoHat: { label: "Ghost (no hat)", model: "props_halloween/ghost_no_hat", sequence: "idle", floats: true, voice: { sounds: ["Halloween.GhostMoan", "Halloween.GhostBoo", "Halloween.Haunted"] } },
  // Salmann, the gillman of koth_slime, which packs his model and his gurgles and spews
  salmann: { label: "Salmann", model: "props_brine/salmann", sequence: "stand_MELEE", map: "koth_slime", voice: { folders: ["slime/salmann_"] } },
  // the Toastmaster of koth_synthetic_event (in its own skin), which packs his model and spawn lines
  toastmaster: { label: "Toastmaster", model: "bots/hwn_botler/hwn_botler_boss", sequence: "stand_MELEE", skin: 3, map: "koth_synthetic_event", voice: { folders: ["synthetic_event/toastmaster_"] } },
  // the Botler of pl_embargo, the little robot butler, which packs its model and its lines (the one with a medkit too)
  botler: { label: "Botler", model: "bots/bot_worker/robot_butler_worker", sequence: "idle", map: "pl_embargo", voice: { folders: ["mvm/botler/"] } },
  botlerMedkit: { label: "Botler (medkit)", model: "bots/bot_worker/robot_butler_worker3", sequence: "idle", map: "pl_embargo", voice: { folders: ["mvm/botler/"] } },
  // the seals of pd_selbyen, which packs their model and barks (napping, the small one too)
  seal: { label: "Selbyen seal", model: "props_selbyen/seal", sequence: "idlesleepy", map: "pd_selbyen", voice: { folders: ["selbyen/"] } },
  sealSmall: { label: "Selbyen seal (small)", model: "props_selbyen/seal_small", sequence: "idlesleepy", map: "pd_selbyen", voice: { folders: ["selbyen/"] } },
  // the farm's chickens of ctf_applejack, which packs their model (standing, sitting, pecking, walking and running; five feathers)
  chicken: { label: "Chicken", model: "applejack/applejack_chicken", sequence: "stand_a", map: "ctf_applejack" },
};

/**
 * The Half-Life 2 characters that come with TF2 (its hl2 folder, which the game mounts): each standing in its idle, saying its own lines
 * (from HL2's sounds, which come with it too). The flying and hanging ones float where they are put.
 */
const HL2: Record<string, Boss> = {
  alyx: { label: "Alyx Vance", model: "alyx", sequence: "Idle_subtle", hl2: "characters", voice: { folders: ["vo/npc/alyx/", "vo/citadel/al_"] } },
  barney: { label: "Barney Calhoun", model: "barney", sequence: "idle_subtle", hl2: "characters", voice: { folders: ["vo/npc/barney/"] } },
  breen: { label: "Dr. Breen", model: "breen", sequence: "idle_subtle", hl2: "characters", voice: { folders: ["vo/breencast/", "vo/citadel/br_"] } },
  eli: { label: "Eli Vance", model: "eli", sequence: "idle_subtle", hl2: "characters", voice: { folders: ["vo/eli_lab/eli_"] } },
  gman: { label: "G-Man", model: "gman", sequence: "idle_subtle", hl2: "characters", voice: { folders: ["vo/gman_misc/"] } },
  kleiner: { label: "Dr. Kleiner", model: "kleiner", sequence: "idle_subtle", hl2: "characters", voice: { folders: ["vo/k_lab/kl_", "vo/k_lab2/kl_"] } },
  mossman: { label: "Dr. Mossman", model: "mossman", sequence: "m_idle01", hl2: "characters", voice: { folders: ["vo/eli_lab/mo_", "vo/novaprospekt/mo_"] } },
  odessa: { label: "Odessa Cubbage", model: "odessa", sequence: "idle_subtle", hl2: "characters", voice: { folders: ["vo/coast/odessa/"] } },
  grigori: { label: "Father Grigori", model: "monk", sequence: "Idle01", hl2: "characters", voice: { folders: ["vo/ravenholm/monk_"] } },
  dog: { label: "Dog", model: "dog", sequence: "idle01", hl2: "characters", voice: { folders: ["npc/dog/"] } },
  lamarr: { label: "Lamarr", model: "lamarr", sequence: "Idle01", hl2: "characters", voice: { folders: ["npc/headcrab/"] } },
  vortigaunt: { label: "Vortigaunt", model: "vortigaunt", sequence: "Idle01", hl2: "characters", voice: { folders: ["vo/npc/vortigaunt/"] } },
  combineSoldier: { label: "Combine Soldier", model: "combine_soldier", sequence: "Idle1", hl2: "combine", voice: { folders: ["npc/combine_soldier/vo/"] } },
  combineGuard: { label: "Combine Prison Guard", model: "combine_soldier_prisonguard", sequence: "Idle1", hl2: "combine", voice: { folders: ["npc/combine_soldier/vo/"] } },
  combineElite: { label: "Combine Elite", model: "combine_super_soldier", sequence: "Idle1", hl2: "combine", voice: { folders: ["npc/combine_soldier/vo/"] } },
  metrocop: { label: "Metrocop", model: "police", sequence: "batonidle1", hl2: "combine", voice: { folders: ["npc/metropolice/vo/"] } },
  stalker: { label: "Stalker", model: "stalker", sequence: "idle1", hl2: "combine", voice: { folders: ["npc/stalker/"] } },
  advisor: { label: "Advisor", model: "advisor", sequence: "Idle01", floats: true, hl2: "combine" },
  scanner: { label: "City Scanner", model: "combine_scanner", sequence: "idle", floats: true, hl2: "combine", voice: { folders: ["npc/scanner/"] } },
  clawScanner: { label: "Claw Scanner", model: "shield_scanner", sequence: "Hover1", floats: true, hl2: "combine", voice: { folders: ["npc/scanner/"] } },
  manhack: { label: "Manhack", model: "manhack", sequence: "fly", floats: true, hl2: "combine", voice: { folders: ["npc/manhack/"] } },
  turret: { label: "Floor Turret", model: "combine_turrets/floor_turret", sequence: "idlealert", hl2: "combine", voice: { folders: ["npc/turret_floor/"] } },
  strider: { label: "Strider", model: "combine_strider", sequence: "Idle01", hl2: "combine", voice: { folders: ["npc/strider/"] } },
  gunship: { label: "Gunship", model: "gunship", sequence: "prop_turn", floats: true, hl2: "combine", voice: { folders: ["npc/combine_gunship/"] } },
  helicopter: { label: "Hunter-Chopper", model: "combine_helicopter", sequence: "idle", floats: true, hl2: "combine", voice: { folders: ["npc/attack_helicopter/"] } },
  dropship: { label: "Dropship", model: "combine_dropship", sequence: "idle", floats: true, hl2: "combine" },
  zombie: { label: "Zombie", model: "zombie/classic", sequence: "Idle01", hl2: "creatures", voice: { folders: ["npc/zombie/"] } },
  fastZombie: { label: "Fast Zombie", model: "zombie/fast", sequence: "idle", hl2: "creatures", voice: { folders: ["npc/fast_zombie/"] } },
  poisonZombie: { label: "Poison Zombie", model: "zombie/poison", sequence: "Idle01", hl2: "creatures", voice: { folders: ["npc/zombie_poison/"] } },
  headcrab: { label: "Headcrab", model: "headcrabclassic", sequence: "Idle01", hl2: "creatures", voice: { folders: ["npc/headcrab/"] } },
  fastHeadcrab: { label: "Fast Headcrab", model: "headcrab", sequence: "Idle01", hl2: "creatures", voice: { folders: ["npc/headcrab_fast/"] } },
  poisonHeadcrab: { label: "Poison Headcrab", model: "headcrabblack", sequence: "Idle01", hl2: "creatures", voice: { folders: ["npc/headcrab_poison/"] } },
  antlion: { label: "Antlion", model: "antlion", sequence: "Idle", hl2: "creatures", voice: { folders: ["npc/antlion/"] } },
  antlionGuard: { label: "Antlion Guard", model: "antlion_guard", sequence: "idle", hl2: "creatures", voice: { folders: ["npc/antlion_guard/"] } },
  barnacle: { label: "Barnacle", model: "barnacle", sequence: "idle01", floats: true, hl2: "creatures", voice: { folders: ["npc/barnacle/"] } },
  ichthyosaur: { label: "Ichthyosaur", model: "ichthyosaur", sequence: "swimslow", floats: true, hl2: "creatures", voice: { folders: ["npc/ichthyosaur/"] } },
  crow: { label: "Crow", model: "crow", sequence: "Idle01", hl2: "creatures", voice: { folders: ["npc/crow/"] } },
  pigeon: { label: "Pigeon", model: "pigeon", sequence: "Idle01", hl2: "creatures", voice: { folders: ["ambient/creatures/pigeon"] } },
  seagull: { label: "Seagull", model: "seagull", sequence: "Idle01", hl2: "creatures", voice: { folders: ["ambient/creatures/seagull"] } },
};
/** The citizens of HL2: the townspeople (group01), the refugees (02), the rebels (03, some bloody) and the medics (03m), men and women. */
export const HL2_CITIZEN_GROUPS: { group: string; label: string; bloody?: boolean }[] = [
  { group: "group01", label: "Citizens" },
  { group: "group02", label: "Refugees" },
  { group: "group03", label: "Rebels", bloody: true },
  { group: "group03m", label: "Medics" },
];
const CITIZEN_FACES = [...["01", "02", "03", "04", "06", "07"].map((n) => `female_${n}`), ...["01", "02", "03", "04", "05", "06", "07", "08", "09"].map((n) => `male_${n}`)];
for (const { group, label, bloody } of HL2_CITIZEN_GROUPS) {
  for (const face of CITIZEN_FACES) {
    for (const blood of bloody ? ["", "_bloody"] : [""]) {
      const female = face.startsWith("female");
      HL2[`${group}_${face}${blood}`] = {
        label: `${label.replace(/s$/, "")} ${female ? "woman" : "man"} ${face.slice(-2)}${blood ? " (bloody)" : ""}`,
        model: `humans/${group}/${face}${blood}`,
        sequence: "idle_subtle",
        hl2: "citizens",
        voice: { folders: [female ? "vo/npc/female01/" : "vo/npc/male01/"] },
      };
    }
  }
}
Object.assign(BOSSES, HL2);
/** The HL2 characters of a part of the HL2 menu, by key. */
export const hl2Keys = (part: NonNullable<Boss["hl2"]>, group?: string) =>
  Object.keys(BOSSES).filter((k) => BOSSES[k].hl2 === part && (!group || BOSSES[k].model.startsWith(`humans/${group}/`)));

/** The boss a prop's `cls` is, if it is one. */
export const bossOf = (cls: string): Boss | null => Object.values(BOSSES).find((b) => b.model === cls.split("#")[0].toLowerCase()) ?? null;
