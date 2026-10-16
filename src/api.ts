import { invoke } from "@tauri-apps/api/core";

export interface Archive { name: string; files: number; bytes: number }
export interface IndexInfo {
  tfDir: string;
  totalFiles: number;
  totalBytes: number;
  millis: number;
  archives: Archive[];
}
export interface DirListing { dirs: string[]; files: { name: string; size: number }[] }
export interface Preview { size: number; head: number[] }

/** App settings stored in the app's config folder (see settings.rs). */
export interface Settings {
  /** Turn off the web view's colour management to match hlmv.exe's raw colours (needs a restart). */
  matchHlmvColors: boolean;
  /** Picking a weapon switches the animation to the matching stand_* sequence. */
  autoWeaponAnimation: boolean;
  /** Smooth camera movement and navigation-axis transitions. */
  cameraSmoothing: boolean;
  /** Leaving a camera's view puts the viewport back where it was before entering it. */
  restoreViewportOnCameraExit: boolean;
  playHitReactions:boolean;
  /** Mouse-wheel zoom multiplier, 0.1–10; 1 retains the original strength. */
  scrollStrength: number;
  /** Start with the scene of the last session. */
  restoreLastScene: boolean;
  confirmCloseScene: boolean;
  /** Equipping a cosmetic does not replace the ones that share its equip region. */
  allowOverlappingCosmetics: boolean;
  /** Interface colours of the 3D view ("#rrggbb" display colours and opacities 0..1): the wireframe overlay and the floor grid. */
  /** The base tone of the interface and its highlight ("#rrggbb"). */
  uiBase: string;
  /** The size of the interface: 0 fits it to the screen (80 % on a 1080p screen, laid out for 1440p), otherwise a factor (0.5–2). */
  uiScale: number;
  uiAccent: string;
  wireColor: string;
  wireOpacity: number;
  gridColor: string;
  gridOpacity: number;
  /** The glow around a clicked character or cosmetic. */
  flashColor: string;
  /** How strong the outline around what is selected is, 0..1 (the glow of a click is in proportion to it). */
  selectionOpacity: number;
  /** Screenshots: size relative to the view (1, 2 or 4) and whether the background is left out. */
  screenshotScale: number;
  screenshotTransparent: boolean;
  /** The bindings the user changed, by action id (see hotkeys.ts); the others have their default. */
  hotkeys: Record<string, string>;
}
export const getSettings = () => invoke<Settings>("get_settings");
export const clearTauntCache = () => invoke<{ removed: number; deferred: number; bytes: number }>("clear_taunt_cache");
export const tauntCachePath = () => invoke<string>("taunt_cache_path");
export const setSettings = (settings: Settings) => invoke<void>("set_settings", { settings });

export const findTf2 = () => invoke<string | null>("find_tf2");
export const indexTf2 = (tfDir: string) => invoke<IndexInfo>("index_tf2", { tfDir });
export const listDir = (dir: string) => invoke<DirListing>("list_dir", { dir });
export const searchPaths = (query: string, limit: number) =>
  invoke<string[]>("search_paths", { query, limit });
export const filePreview = (path: string, max: number) =>
  invoke<Preview>("file_preview", { path, max });

/** Binary model payload; decode with `parsePayload` in viewer/payload.ts. */
export const loadModel = (path: string, lod = 0) => invoke<ArrayBuffer>("load_model", { path, lod });

/** Binary material payload (flags + RGBA pixels); decode with `parseMaterial`. */
export const loadMaterial = (path: string) => invoke<ArrayBuffer>("load_material", { path });
/** Every frame of an animated texture: width, height and frame count (u32 little endian), then the RGBA8 pixels of each frame. */
export const loadTextureFrames = (path: string, maxFrames = 128) => invoke<ArrayBuffer>("load_texture_frames", { path, maxFrames });

/** Original PCF, model attachment/hitbox, and texture sheet data for particle previews. */
export const loadParticleAsset = (path: string) => invoke<ArrayBuffer>("load_particle_asset", { path });
/** The names of the cubemaps in the cubemaps folder (the `.vtf` files of it, without the extension). */
export const listUserCubemaps = () => invoke<string[]>("list_cubemaps");
/** The path of the cubemaps folder. */
export const cubemapsDir = () => invoke<string>("cubemaps_dir");
export const loadOverlayFont = (path: string) => invoke<ArrayBuffer>("load_overlay_font", { path });
export interface UnusualEffectInfo { id: number; name: string; system: string; kind: "hat" | "taunt"; file: string | null; attachment: string; root_bone: boolean; refire: number;
  /** A custom effect: the zip it came from, and when it was imported (ms). */
  custom?: string; added?: number }
export interface CustomEffectInfo { name: string; added: number; bytes: number; pcfs: { file: string; systems: string[] }[] }
/** The custom effect zips that are mounted. */
export const listCustomEffects = () => invoke<CustomEffectInfo[]>("list_custom_effects");
/** Adds a custom effect zip (a game-like folder with particles/*.pcf and its materials) and mounts it. */
export const importEffectZip = (path: string) => invoke<CustomEffectInfo[]>("import_effect_zip", { path });
export const removeCustomEffect = (name: string) => invoke<CustomEffectInfo[]>("remove_custom_effect", { name });
export const listUnusualEffects = () => invoke<UnusualEffectInfo[]>("list_unusual_effects");

export interface NativeParticleNode {
  id: number; name: string; capacity: number; time: number; dt?: number; particles: number[][];
}
export const resetNativeParticles = () => invoke<number>("native_particle_reset");
export const startNativeParticles = (cp: number[], generation: number, file: string, system: string, boxes: number[][] = [], refire = 0, slots = 1) =>
  invoke<{ handle: number; nodes: NativeParticleNode[] } | null>("native_particle_start", { cp, generation, file, system, boxes, refire, slots });
export const stepNativeParticles = (handle: number, ticks: number, cp: number[], boxes: number[][] = [], action = 0, flame: number[] = [], colors: number[] = [], instances: number[][] = [], target: number[] = [], floor: number | null = null) =>
  invoke<ArrayBuffer>("native_particle_step", { handle, ticks, cp, boxes, action, flame, colors, instances, target, floor });
export interface ProjectileProfile {
  kind: "rocket" | "grenade" | "energy" | "syringe" | "sticky" | "cannon" | "arrow" | "jar" | "cleaver" | "plate";
  model: string; trail: string; speed: number; gravity: number; lifetime: number; spin: boolean; team: number;
  impact?: string; impactAir?: string; damageRadius?:number; speedMax?: number; gravityMin?: number; /** A factor on the model's size (the healing bolt is the syringe, three times as big). */ scale?: number; armTime?: number; maxActive?: number; detonateMode?: number; spriteTrail?: string;
}
export interface WeaponProfile {
  itemId: number; weaponClass: string; melee?:{range:number;hull:number;delay:number}|null; hitscan?:boolean;range?:number; clipSize: number; reserve: number; ammoPerShot: number; fireDelay: number;
  reloadSingly: boolean; reloadStart: number; reloadTime: number; reloadEnd: number;
  reloadPlaybackRate?: number;
  /** Seconds after a shot at which the fire animation puts the next round in the clip (the Huntsman has no reload). */
  ammoEvent?: number | null;
  flame?: number[];
  colors?: number[];
  charge?: {seconds:number;autoRelease:boolean;cook:boolean} | null;
  /** A weapon that is thrown once and comes back after `recharge` seconds (Jarate, Mad Milk, the cleaver); the projectile leaves `delay` seconds into the throw. */
  throwable?: {recharge:number;delay:number} | null;
  healing?: {system:string;range:number} | null;
  /** The item's third-person activity replacements (`ACT_MP_ATTACK_STAND_MELEE_SECONDARY` -> `ACT_MP_ATTACK_STAND_ITEM1_SECONDARY`), upper case. */
  animReplacement?: Record<string,string>;
  /** The particle system of a hitscan weapon's tracer (`bullet_pistol_tracer01_red`), empty for none. */
  tracer?: string;
  /**
   * A lunchbox: the Heavy's food (the primary fire is the eating taunt, the secondary throws it out as a health kit) or the Scout's drink (the taunt, then the buff).
   * `recharge` seconds until it is back; the food that `stays` (a Sandvich at full health) is never used up.
   */
  consumable?: { kind: "food" | "drink"; type: number; recharge: number; heal?: number; firstBiteBuff?: string; buffSeconds: number; keepsMelee?: boolean; stays?: boolean; drinkAt?: number; buff?: string; splash?: string } | null;
  projectile?: ProjectileProfile | null;
  muzzle: string; brass: string; ejectTimes: number[]; continuous: boolean;
}
export const getWeaponProfile = (itemId: number, className: string, team: number) =>
  invoke<WeaponProfile>("get_weapon_profile", { itemId, class: className, team });
export const particleSystemFile = (system: string) => invoke<string>("particle_system_file", { system });
export const stopNativeParticles = (handle: number) => invoke<void>("native_particle_stop", { handle });

/** Sequence list and pose parameters (JSON bytes); decode with `parseAnimInfo`. */
export const listSequences = (path: string) => invoke<ArrayBuffer>("list_sequences", { path });

/** Bakes a sequence with encoded (0..1) pose parameters; decode with `parseClip`. */
export const bakeSequence = (path: string, sequence: number, params: number[], targetPath?: string, blend = true) =>
  invoke<ArrayBuffer>("bake_sequence", { path, sequence, params, targetPath, blend });

export interface WorkshopTaunt { animation: string; sequence: string; prop: string | null }
export const prepareWorkshopTaunt = (itemId: number, className: string) =>
  invoke<WorkshopTaunt>("prepare_workshop_taunt", { itemId, class: className });

/** The cosmetics catalog (JSON bytes); decode with `parseItems`. */
export const listItems = () => invoke<ArrayBuffer>("list_items");

/** Writes a text file (scene) the user picked with the save dialog. */
export const writeTextFile = (path: string, contents: string) => invoke<void>("write_text_file", { path, contents });
export const readTextFile = (path: string) => invoke<string>("read_text_file", { path });
/** A source model (.fbx, .smd, .dmx) or texture (.tga) from the artist's folders, for the item compiler. */
export const readSourceFile = (path: string) => invoke<ArrayBuffer>("read_source_file", { path });
/** The names of the model (.fbx, .smd, .dmx) and .tga files in the folder of a source file. */
export const sourceSiblings = (path: string) => invoke<string[]>("source_siblings", { path });
/** What the compiler sends to build an item; see src-tauri commands.rs ItemBuildRequest. */
export interface ItemBuildRequest {
  name: string; displayName: string; prefab: string; equipRegion: string; bodygroups: string[]; paintable: boolean;
  /** The classes with a model of their own (one: that class's folder; several: an all-class item), each with its LODs. */
  classes: { folder: string; /** QC commands added to the class's QC (the `$jigglebone` blocks). */ qcExtra: string; /** The commands inside its LOD 1 and LOD 2 blocks (bone commands, `nofacial`). */ lodCommands?: string[][]; lods: { sourcePath: string; smd: string; /** The model as a binary .dmx (bytes) when it has flexes: the smd is empty then. */ dmx?: number[]; triangles: number; vertices: number }[] }[];
  materials: { sourceName: string; vmt: string; color: string | null; normal: string | null; phongexponent: string | null; illum: string | null; /** The material takes paint: the session text says so for the importer. */ paintable?: boolean; blue: { vmt: string; color: string | null } | null }[];
  icon: string;
  /** How the model textures are stored: DXT (the importer's), or exact pixels. */
  compression?: "dxt" | "none";
}
export const buildItem = (request: ItemBuildRequest) => invoke<{ zip: string; session: string; log: string[]; millis: number }>("build_item", { request });
/** What the compiler sends to build a prop; see src-tauri commands.rs PropBuildRequest. */
export interface PropBuildRequest {
  name: string; folder: string; surfaceprop: string; mass: number; staticProp: boolean; collision: string | null; concave: boolean;
  lods: { sourcePath: string; smd: string; dmx?: number[]; triangles: number; vertices: number }[];
  materials: { name: string; vmt: string; color: string | null; normal: string | null; phongexponent: string | null; illum: string | null; /** How its textures are stored: DXT (small) or exact pixels. */ compression?: "dxt" | "none" }[];
  maxTexture: number; qcExtra: string;
  /** How every material's textures are stored. */
  compression?: "dxt" | "none";
  /** The text of the file that opens the prop again in the compiler (written beside the models folder). */
  session?: string;
  /** The folder the files are written to. */
  outDir: string;
}
export const buildProp = (request: PropBuildRequest) => invoke<{ folder: string; files: string[]; log: string[]; millis: number }>("build_prop", { request });
/** The models of the game's archives, each with the game it comes from (`tf2`, `hl2`...): the prop browser's list. */
export const listModels = () => invoke<{ path: string; game: string }[]>("list_models");
/** A picture the program kept on disk of a file of the game (`icon`: an item's inventory icon by its .vmt path; `prop`: a prop's thumbnail by its model path), or null. */
export const thumbCacheGet = async (kind: "icon" | "prop", key: string): Promise<ArrayBuffer | null> => {
  const bytes = await invoke<ArrayBuffer>("thumb_cache_get", { kind, key });
  return bytes && bytes.byteLength ? bytes : null;
};
export const thumbCachePut = (kind: "icon" | "prop", key: string, bytes: Uint8Array) =>
  invoke<void>("thumb_cache_put", bytes, { headers: { kind: encodeURIComponent(kind), key: encodeURIComponent(key) } });
/** The text of a prop session file (`<name>.prop.txt`). */
export const readPropSession = (path: string) => invoke<string>("read_prop_session", { path });
/** The folders of loose files that are mounted (the game's `tf/custom` addons, and the ones the user added). */
export interface CustomContent { name: string; root: string; auto: boolean; files: number; models: number }
export const listCustomContent = () => invoke<CustomContent[]>("list_custom_content");
/** Mounts a folder of loose files (or a folder of such folders); the mounts it made. */
export const addCustomContent = (path: string) => invoke<CustomContent[]>("add_custom_content", { path });
export const removeCustomContent = (root: string) => invoke<void>("remove_custom_content", { root });
export const revealFile = (path: string) => invoke<void>("reveal_file", { path });
/** When a source file last changed (ms since the epoch), or null while it is missing. */
export const sourceStamp = (path: string) => invoke<number | null>("source_stamp", { path });
/** Writes raw bytes (a PNG screenshot) to a path the user picked. */
/** Saves a backpack icon (a 512x512 TGA) as `<name>_icon.tga` in the tool's `icons` folder; the path it was saved at. */
export const saveItemIcon = (name: string, bytes: Uint8Array) =>
  invoke<string>("save_item_icon", bytes, { headers: { name: encodeURIComponent(name) } });
/** The importer's session folder, and the text of one of its session files (a .txt). */
export const importSourceDir = () => invoke<string>("import_source_dir");
export const readItemSession = (path: string) => invoke<string>("read_item_session", { path });
export const writeBinaryFile = (path: string, bytes: Uint8Array) =>
  invoke<void>("write_binary_file", bytes, { headers: { path: encodeURIComponent(path) } });
/** Writes a copy of a model (an `adjusted_*.fbx` or `temp_*.fbx` file) beside the original. */
export const writeAdjustedModel = (path: string, bytes: Uint8Array) =>
  invoke<void>("write_adjusted_model", bytes, { headers: { path: encodeURIComponent(path) } });
/** Writes a model file (an existing .fbx) again where it is. */
export const rewriteModelFile = (path: string, bytes: Uint8Array) =>
  invoke<void>("rewrite_model_file", bytes, { headers: { path: encodeURIComponent(path) } });
/** The scene of the last session (JSON text) and its autosave. */
export const loadSession = () => invoke<string | null>("load_session");
export const saveSession = (contents: string) => invoke<void>("save_session", { contents });

/** The pose library (files in the app's config folder): names newest first, save, load and delete. */
/** Rescans the workshop importer's zips (tf/workshop/import_source) without reindexing the game. */
export const refreshWorkshop = () => invoke<void>("refresh_workshop");
/** A value that changes when those zips do. */
export const workshopStamp = () => invoke<string>("workshop_stamp");
export const listPoses = () => invoke<string[]>("list_poses");
/** Every saved pose as [name, file text], newest first. */
export const readPoses = () => invoke<[string, string][]>("read_poses");
/** Opens the poses folder in the file explorer; resolves to its path. */
export const openPosesFolder = () => invoke<string>("open_poses_folder");
export const savePoseFile = (name: string, contents: string) => invoke<void>("save_pose", { name, contents });
export const loadPoseFile = (name: string) => invoke<string>("load_pose", { name });
export const deletePoseFile = (name: string) => invoke<void>("delete_pose", { name });

/** Portable lighting presets, stored separately from scenes and poses. */
export const readLightSetups = () => invoke<[string, string][]>("read_light_setups");
export const saveLightSetup = (name: string, contents: string) => invoke<void>("save_light_setup", { name, contents });
export const deleteLightSetup = (name: string) => invoke<void>("delete_light_setup", { name });
export const openLightSetupsFolder = () => invoke<string>("open_light_setups_folder");

/**
 * Poses evaluated live (play mode): each request is [sequence, cycle, layers, base layers], the layers being [sequence, cycle, weight]
 * triples of additive sequences played over it (the first `base layers` of them are part of the movement, like the landing), and an arm base sequence (or -1) whose pose the left arm is taken from, and `params` the encoded pose parameters. Returns, per request, the local bone positions (bones
 * * 3 floats) then rotations (bones * 4 floats). `pinParams`: the feet stay planted where they stand under those parameters.
 */
export type PoseRequest = [number, number, [number, number, number][], number, number];
export const evalPoses = (path: string, requests: PoseRequest[], params: number[], pinParams: number[] | null) =>
  invoke<ArrayBuffer>("eval_poses", { path, requests, params, pinParams });

export interface GibDefinition {model:string;bone:string;attachment:string;offset:number[];velocity:number[];burst:number;fadeTime:number}
export const playerGibs=(path:string)=>invoke<GibDefinition[]>("player_gibs",{path});

export interface ModelPhysics {solids:{index:number;bone:string;mass:number}[];joints:{parent:number;child:number;min:number[];max:number[];friction:number[]}[];collisionPairs:number[][];collisionRules?:boolean;selfCollisions?:boolean}
export const modelPhysics=(path:string)=>invoke<ModelPhysics>("model_physics",{path});

/** Blender executables found on this machine, newest first (desktop). */
export const findBlender = () => invoke<string[]>("find_blender");
/** The rig of a .blend file as JSON, read with Blender in the background (`blender`: the executable, empty for the newest found). */
export const exportBlendRig = (blend: string, blender: string) => invoke<string>("export_blend_rig", { blend, blender });
