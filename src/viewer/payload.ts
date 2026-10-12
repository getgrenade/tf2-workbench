/** Decodes the binary payloads produced by src-tauri/src/payload.rs. */
import type { JiggleParams } from "./jiggle";

/** Vertex deltas of one flex descriptor on one mesh (see source-formats `MeshFlex`). */
export interface MeshFlexData {
  desc: number;
  /** Weight ramp: 0 at targets[0], 1 from targets[1] to targets[2], 0 at targets[3]. */
  targets: [number, number, number, number];
  /** Indices into the mesh's vertices. */
  vertices: Uint32Array;
  /** xyz per entry. */
  deltas: Float32Array;
  normalDeltas: Float32Array;
}
export interface MeshData {
  /** Material of skin family 0 (RED). */
  material: string;
  /** Material per skin family (index 1 is BLU). */
  materials: string[];
  flexes: MeshFlexData[];
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /** xyzw per vertex; w is the bitangent sign. */
  tangents: Float32Array;
  /** 4 bone indices per vertex (widened from u8 for three.js). */
  skinIndices: Uint16Array;
  /** 4 bone weights per vertex. */
  skinWeights: Float32Array;
  indices: Uint32Array;
}
/** Eye shader constants for one eyeball (bind-pose space); see source-formats `eyeball_state`. */
export interface EyeballData {
  material: string;
  /** Bone the eyeball is attached to. */
  bone: number;
  origin: [number, number, number];
  radius: number;
  irisU: [number, number, number, number];
  irisV: [number, number, number, number];
  /** Eyeball origin and up vector in the bone's space. */
  boneOrigin: [number, number, number];
  boneUp: [number, number, number];
  /** 1 / QC pupil scale. */
  irisScale: number;
  /** tan of the QC yaw offset (opposite sign per eye): turns the eye outward from the gaze direction. */
  zoffset: number;
}
/** The "eyes" attachment (bone + attachment-to-bone 3x4 row-major) the gaze target is measured from. */
export interface EyeAttachmentData { bone: number; local: number[] }
export interface SubModelData { name: string; meshes: MeshData[]; eyeballs: EyeballData[] }
export interface BodyPartData { name: string; models: SubModelData[] }
export interface BoneData {
  name: string;
  parent: number;
  /** World -> bone bind transform, 3x4 row-major. */
  poseToBone: number[];
  /** Physics parameters when this is a jiggle bone (see jiggle.ts). */
  jiggle?: JiggleParams | null;
}
export interface FlexControllerData { name: string; min: number; max: number }
export interface FlexRuleData {
  flex: number;
  /** [op, operand] pairs (see flex.ts). */
  ops: [number, number][];
}
export interface ModelData {
  path: string;
  flexDescCount: number;
  flexControllers: FlexControllerData[];
  flexRules: FlexRuleData[];
  /** Number of skin families (team skins). */
  skinCount: number;
  eyeAttachment: EyeAttachmentData | null;
  bones: BoneData[];
  includeModels: string[];
  bodyParts: BodyPartData[];
  /** The LOD these meshes are (0: the full model) and how many the model has. */
  lod: number;
  lodCount: number;
}

interface MeshJson {
  material: string;
  materials: string[];
  flexes: { desc: number; targets: [number, number, number, number]; count: number; vertices: number; deltas: number; normalDeltas: number }[];
  vertexCount: number;
  indexCount: number;
  pos: number;
  normal: number;
  uv: number;
  tangent: number;
  skinIndex: number;
  skinWeight: number;
  index: number;
}

/** Splits `[u32 json_len][json][pad to 4][blob]`. */
function split(buf: ArrayBuffer) {
  const jsonLen = new DataView(buf).getUint32(0, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, jsonLen)));
  return { json, blobStart: (4 + jsonLen + 3) & ~3 };
}

export function parsePayload(buf: ArrayBuffer): ModelData {
  const { json, blobStart } = split(buf);
  const f32 = (off: number, n: number) => new Float32Array(buf, blobStart + off, n);
  const mesh = (m: MeshJson): MeshData => ({
    material: m.material,
    materials: m.materials,
    flexes: m.flexes.map((f) => ({
      desc: f.desc,
      targets: f.targets,
      vertices: new Uint32Array(buf, blobStart + f.vertices, f.count),
      deltas: f32(f.deltas, f.count * 3),
      normalDeltas: f32(f.normalDeltas, f.count * 3),
    })),
    positions: f32(m.pos, m.vertexCount * 3),
    normals: f32(m.normal, m.vertexCount * 3),
    uvs: f32(m.uv, m.vertexCount * 2),
    tangents: f32(m.tangent, m.vertexCount * 4),
    skinIndices: Uint16Array.from(new Uint8Array(buf, blobStart + m.skinIndex, m.vertexCount * 4)),
    skinWeights: f32(m.skinWeight, m.vertexCount * 4),
    indices: new Uint32Array(buf, blobStart + m.index, m.indexCount),
  });
  return {
    path: json.path,
    flexDescCount: json.flexDescCount,
    flexControllers: json.flexControllers,
    flexRules: json.flexRules,
    skinCount: json.skinCount,
    eyeAttachment: json.eyeAttachment ?? null,
    bones: json.bones,
    includeModels: json.includeModels,
    lod: json.lod ?? 0,
    lodCount: json.lodCount ?? 1,
    bodyParts: json.bodyParts.map((bp: { name: string; models: { name: string; meshes: MeshJson[]; eyeballs: EyeballData[] }[] }) => ({
      name: bp.name,
      models: bp.models.map((m) => ({ name: m.name, meshes: m.meshes.map(mesh), eyeballs: m.eyeballs })),
    })),
  };
}

export interface TextureData {
  width: number;
  height: number;
  /** VTF CLAMPS / CLAMPT flags (otherwise the sampler repeats). */
  clampS?: boolean;
  clampT?: boolean;
  /** RGBA8, top row first. */
  rgba: Uint8Array<ArrayBuffer>;
}

export interface MaterialData {
  path: string;
  shader: string;
  /** Flattened VMT parameters (lowercased keys). */
  params: Record<string, string>;
  /** Material proxies in file order (tint chain etc.); see proxies.ts. */
  proxies: { name: string; params: Record<string, string> }[];
  /** Decoded textures by slot: base, bump, warp, exponent. */
  textures: Record<string, TextureData>;
  errors: string[];
}

export function parseMaterial(buf: ArrayBuffer): MaterialData {
  const { json, blobStart } = split(buf);
  const textures: Record<string, TextureData> = {};
  for (const t of json.textures as { slot: string; width: number; height: number; clampS: boolean; clampT: boolean; offset: number }[]) {
    textures[t.slot] = {
      width: t.width,
      height: t.height,
      clampS: t.clampS,
      clampT: t.clampT,
      rgba: new Uint8Array(buf, blobStart + t.offset, t.width * t.height * 4),
    };
  }
  return { path: json.path, shader: json.shader, params: json.params, proxies: json.proxies ?? [], textures, errors: json.errors };
}

/** Parses a VMT vector like `[.3 1 8]`, `{255 128 0}` or a single number. */
export function parseVec(value: string | undefined, fallback: number[]): number[] {
  if (value === undefined) return fallback;
  const nums = value.replace(/[[\]{}]/g, " ").trim().split(/\s+/).map(Number);
  if (nums.length === 0 || nums.some((n) => Number.isNaN(n))) return fallback;
  return nums.length === 1 ? [nums[0], nums[0], nums[0]] : nums;
}

/**
 * The phong tint the shader receives (`g_SpecularTint`), resolved as skin_dx9_helper.cpp does: `$phongtint` as given, or, when it
 * is unset / all zero, [-1, 0, 0] to tint by `lerp(white, albedo, exponent.g)` (needs a phong exponent texture and
 * `$phongalbedotint 1`, which is off unless the material sets it: Hell-Bent Leather omits it and shows untinted shine in hlmv), else plain white. A negative red channel is the shader's "use the map" flag.
 */
export function resolvePhongTint(params: Record<string, string>, hasExponentTexture: boolean): [number, number, number] {
  const t = parseVec(params["$phongtint"], [0, 0, 0]);
  if (t[0] !== 0 || t[1] !== 0 || t[2] !== 0) return [t[0], t[1], t[2]];
  const albedoTint = hasExponentTexture && Number(params["$phongalbedotint"] ?? 0) !== 0;
  return albedoTint ? [-1, 0, 0] : [1, 1, 1];
}

/** Parses a VMT colour: `[r g b]` floats stay as is, `{r g b}` is 0-255 and is scaled to 0-1. */
export function parseColor(value: string | undefined, fallback: number[]): number[] {
  const v = parseVec(value, fallback);
  return value !== undefined && value.includes("{") ? v.map((c) => c / 255) : v;
}

export interface SequenceInfo {
  index: number;
  name: string;
  frames: number;
  fps: number;
  looping: boolean;
  hidden: boolean;
  /** The authored activity (`ACT_MP_THROW`); empty when the sequence has none. */
  activity?: string;
}

export interface PoseParamInfo {
  name: string;
  start: number;
  end: number;
  looping: number;
  /** Engine default (encoded 0..1). */
  default: number;
}

export interface AnimInfo {
  sequences: SequenceInfo[];
  poseParams: PoseParamInfo[];
}

/** Baked animation: local bone transforms per frame (Source space, bone-local). */
export interface ClipData {
  /** Optional local bone scale for edited poses; game animations default to one. */
  scale?: Float32Array;
  fps: number;
  looping: boolean;
  frames: number;
  numBones: number;
  /** frames * numBones * 3 */
  pos: Float32Array;
  /** frames * numBones * 4 (x y z w) */
  quat: Float32Array;
}

export function parseClip(buf: ArrayBuffer): ClipData {
  const { json, blobStart } = split(buf);
  const n = json.frames * json.numBones;
  return {
    fps: json.fps,
    looping: json.looping,
    frames: json.frames,
    numBones: json.numBones,
    pos: new Float32Array(buf, blobStart, n * 3),
    quat: new Float32Array(buf, blobStart + n * 3 * 4, n * 4),
  };
}

export function parseAnimInfo(buf: ArrayBuffer): AnimInfo {
  return JSON.parse(new TextDecoder().decode(new Uint8Array(buf)));
}

/** A selectable item style: may swap the model, the team skin family, the icon and hidden bodygroups. */
export interface ItemStyleInfo {
  /** Localized name; empty when the install has no text for it. */
  name: string;
  model: string | null;
  perClass: Record<string, string>;
  skinRed: number | null;
  skinBlu: number | null;
  image: string | null;
  bodygroups: Record<string, number>;
}

export interface ItemInfo {
  /** Stock loadout weapon, read from the game's baseitem schema designation. */
  baseItem?: boolean;
  /** Pose parameters the item sets while held (`r_hand_grip: 16`), by lowercase name, in the parameter's own units. */
  poseParams: Record<string, number>;
  /** Models shown with the item: its backpack (`extra_wearable`) and attached parts. */
  extraModels: string[];
  /** `anim_slot` (uppercase): the animation set a weapon uses (`MELEE_ALLCLASS`, `ITEM1`, ...); empty = by slot. */
  animSlot: string;
  /** Per-class slot overrides (`engineer: "primary"` for the shotgun family). */
  classSlots: Record<string, string>;
  styles: ItemStyleInfo[];
  id: number;
  name: string;
  displayName: string;
  slot: string;
  /** Game class names (`demoman`); empty = unrestricted. */
  classes: string[];
  model: string | null;
  perClass: Record<string, string>;
  image: string | null;
  /** Class bodygroup name -> model index (1 hides the class's own geometry). */
  bodygroups: Record<string, number>;
  equipRegions: string[];
  paintable: boolean;
  /** Wearing the item puts the character in the zombie skin of the class model (the Voodoo-Cursed souls). */
  skinOverride: boolean;
  /** Medals and badges (thousands of tournament / community medals); hidden by default in the browser. */
  medal: boolean;
  /** Definition quality (`unique`, `vintage`, `selfmade`, ...), lowercase. */
  quality: string;
  /** Taunts only: class -> the player's taunt scene name (the sequence it plays). */
  tauntScenes: Record<string, string>;
  /** Taunts only: class -> the prop's own scene name. */
  tauntPropScenes: Record<string, string>;
  /** A cosmetic from the workshop importer's zips (tf/workshop/import_source), not from the game's own items. */
  workshop: boolean;
}

/** A paint can: packed 0xRRGGBB colours (the `set item tint RGB` attributes). */
export interface PaintInfo {
  id: number;
  name: string;
  displayName: string;
  rgb: number;
  /** BLU colour of team-colour paints. */
  rgb2: number | null;
}

export interface ItemDb {
  items: ItemInfo[];
  /** Hand-held weapons (primary / secondary / melee). */
  weapons: ItemInfo[];
  /** Taunts that come with a prop model; the prop is the item's per-class model. */
  taunts: ItemInfo[];
  paints: PaintInfo[];
  equipConflicts: Record<string, string[]>;
}

export function parseItems(buf: ArrayBuffer): ItemDb {
  return JSON.parse(new TextDecoder().decode(new Uint8Array(buf)));
}

/**
 * The model an item (in the given style) shows for a class: the style's per-class model, else the style's model,
 * else the item's own (`CEconItemView::GetPlayerDisplayModel`).
 */
export function itemModelFor(item: ItemInfo, gameClass: string, style = 0): string | null {
  const s = item.styles[style];
  return s?.perClass[gameClass] ?? s?.model ?? item.perClass[gameClass] ?? item.model;
}

/** The skin family a style uses for the team (0 RED, 1 BLU); null keeps the team's own family. */
export function itemSkinFor(item: ItemInfo, team: number, style = 0): number | null {
  const s = item.styles[style];
  return (team === 1 ? s?.skinBlu : s?.skinRed) ?? null;
}

/** The inventory icon of an item in the given style. */
export function itemImageFor(item: ItemInfo, style = 0): string | null {
  return item.styles[style]?.image ?? item.image;
}

/** The browser category of a loadout slot: PDAs, sappers, toolboxes and the disguise kit are all "utility". */
export type WeaponCategory = "primary" | "secondary" | "melee" | "utility";
export function weaponCategory(slot: string): WeaponCategory {
  return slot === "pda" || slot === "pda2" || slot === "building" ? "utility" : (slot as WeaponCategory);
}

/** The loadout slot of an item for a class (`primary`, `secondary`, `melee`, ...): the per-class override, else its own. */
export function slotForClass(item: ItemInfo, gameClass: string): string {
  return item.classSlots?.[gameClass] ?? item.slot;
}

/**
 * Sequence names (lowercase) that show a held weapon's idle pose, best first: the weapon's `anim_slot` set, then
 * the set of its loadout slot (`stand_primary` ...). The engine builds the same names from the animation slot.
 */
export function weaponIdleSequences(item: ItemInfo, gameClass: string): string[] {
  const names: string[] = [];
  const anim = item.animSlot.toLowerCase();
  if (anim && anim !== "force_not_used") names.push(`stand_${anim}`);
  const slot = slotForClass(item, gameClass);
  names.push(`stand_${slot}`);
  // The Spy's sapper is a `building` item that idles with stand_SAPPER; the Engineer's destruction PDA uses stand_PDA.
  if (slot === "building") names.push("stand_sapper");
  if (slot === "pda2") names.push("stand_pda");
  return names;
}

/** "Style 2" style label: the localized name when the install has one. */
export function styleLabel(item: ItemInfo, style: number): string {
  return item.styles[style]?.name || `Style ${style + 1}`;
}

export function itemUsableBy(item: ItemInfo, gameClass: string): boolean {
  // The only stock melee with no world model is Heavy's fists (the hands are on the player).
  if (item.baseItem && item.slot === "melee" && item.model === null && Object.keys(item.perClass).length === 0) return item.classes.includes(gameClass);
  // a taunt without a prop is only an animation: it needs no model, just a scene for the class
  if (item.slot === "taunt" && itemModelFor(item, gameClass) === null) return item.tauntScenes[gameClass] !== undefined && (item.classes.length === 0 || item.classes.includes(gameClass));
  if (item.classes.length === 0) return itemModelFor(item, gameClass) !== null;
  return item.classes.includes(gameClass) && itemModelFor(item, gameClass) !== null;
}

/** Lowercase, without the filler words and underscores: `taunt_the_Skating_scorcher` and `tauntskating_scorcher` compare equal. */
function sequenceKey(name: string): string {
  return name
    .toLowerCase()
    .split("_")
    .filter((w) => w !== "the" && w !== "layer")
    .join("")
    .replaceAll("taunt", "");
}

/**
 * The class sequence a taunt scene plays. The scene file (`taunt_flying_colors.vcd`) is not readable here, but its name follows
 * the sequence's: usually equal, sometimes with the class appended (`taunt_cheers_soldier`) or a filler word / underscore
 * different. Plain sequences win over `layer_` ones; among prefix matches (`taunt_vehicle_tank` -> `..._start`, `..._honk`, `..._end`) the first in the model wins.
 */
export function tauntSequence(scene: string, gameClass: string, sequences: string[], propModel?: string): string | null {
  const plain = sequences.filter((s) => !/^layer_|_layer$/i.test(s));
  const keyed = plain.map((s) => [s, sequenceKey(s)] as const);
  const cls = sequenceKey(gameClass === "demoman" ? "demo" : gameClass);
  const find = (name: string) => {
    const want = sequenceKey(name);
    if (!want) return null;
    const exact = keyed.find(([, k]) => k === want) ?? keyed.find(([, k]) => k === want + cls);
    if (exact) return exact[0];
    // the first one in the model's order: a taunt's opening comes before its loop / outro variants
    const prefix = keyed.find(([, k]) => k.startsWith(want));
    return prefix?.[0] ?? null;
  };
  // Some scenes are named after the item, not the animation (taunt_flying_colors plays taunt_flag_<class>): the prop's file
  // name (taunt_flag.mdl) is the next best clue.
  const propName = propModel?.split("/").pop()?.replace(/.mdl$/i, "");
  return find(scene) ?? (propName ? find(propName) : null);
}

/**
 * The sequence a taunt prop plays: the one named like its prop scene, else, for a prop with exactly one real
 * animation, that one. Props without their own animation (`ref` only) are static.
 */
export function tauntPropSequence(propScene: string | undefined, gameClass: string, sequences: string[]): string | null {
  const real = sequences.filter((s) => s.toLowerCase() !== "ref" && !s.toLowerCase().startsWith("layer_"));
  if (real.length === 0) return null;
  if (propScene) {
    const strip = (k: string) => k.replaceAll("prop", "").replaceAll("intro", "");
    const want = strip(sequenceKey(propScene));
    const cls = sequenceKey(gameClass === "demoman" ? "demo" : gameClass);
    const keyed = real.map((s) => [s, strip(sequenceKey(s))] as const);
    const hit =
      keyed.find(([, k]) => k === want) ??
      keyed.find(([, k]) => k === want + cls) ??
      keyed.filter(([, k]) => k.length > 0 && (k.startsWith(want) || want.startsWith(k))).sort((a, b) => b[1].length - a[1].length)[0] ??
      // an intro scene whose animation is named after the prop part (engys_new_chair_intro -> chair_intro_qcistyle)
      (propScene.toLowerCase().includes("intro") ? real.map((s) => [s, s] as const).find(([s]) => s.toLowerCase().includes("intro")) : undefined);
    if (hit) return hit[0];
    // a prop shared by every class holds one animation per class (taunt_killer_joke_heavy, spy_break ...): take this class's, the one
    // sharing the most with the scene name
    const common = (a: string, b: string) => {
      let n = 0;
      while (n < a.length && n < b.length && a[n] === b[n]) n++;
      return n;
    };
    const mine = keyed.filter(([, k]) => k.includes(cls)).sort((a, b) => common(b[1], want) - common(a[1], want))[0];
    if (mine) return mine[0];
  }
  return real.length === 1 ? real[0] : null;
}
