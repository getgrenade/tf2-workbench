import type { MaterialData, ModelData, TextureData } from "../viewer/payload";
import type { ImportedModel } from "./fbx";
import { decimateModel } from "./decimate";
import { transferSkin } from "./skinTransfer";
import { applyBoneRemap, boneRemap, lodCommandLines, lodCommands } from "./lodBones";
import { writeFbx } from "./fbxWrite";
import { meshFrame, stripArmatures, turnBones } from "./fbxStrip";
import { isIdentityTurn, turnMatrix } from "./boneAxes";
import { importModel } from "./importModel";
import { decodeTga, iconProblem, textureProblem, type TextureKind, type TgaImage } from "./tga";
import { buildPreviewMaterial, buildPreviewModel, type PreviewBone, type PreviewTextures } from "./preview";
import { smdBoneNames } from "./smd";
import { buildVmt, DEFAULT_MATERIAL, vmtText, type MaterialSettings, type MaterialTexturePaths } from "./vmt";
import { proxyProblems, sanitizeProxies } from "./proxyModel";
import type { KvNode } from "./kv";
import { jiggleQcFor, readJiggle, type JiggleSetup } from "./jiggleBones";
import type { BoneTurn } from "./boneAxes";
import { classSiblings, lodSiblings, materialDiffuse, textureDirsFor, textureSiblings, type TextureRole } from "./siblings";

/**
 * The item being compiled: the artist's choices, the source files they point at (read and checked as they are given), and the preview the
 * viewer shows of them. Mirrors the in-game importer (item_import.cpp CTFFileImportDialog) where it limits what may be built.
 *
 * An item can have a model of its own for each class (the importer: more than one class with models makes it an all-class item); the
 * textures, materials and icon are shared by every class.
 */

export type Prefab = "hat" | "misc";
export const PREFABS: Prefab[] = ["hat", "misc"];

/** The equip regions an item can take (the importer reads these from the schema). */
export const EQUIP_REGIONS = [
  "hat", "whole_head", "face", "glasses", "beard", "lenses", "ears", "shirt", "pants", "feet", "grenades", "belt_misc", "backpack",
  "back", "arms", "hands", "medal", "necklace", "earbuds", "head_skin", "arms_misc", "zombie_body", "sleeves",
];

/** kBodygroupArray of the importer: the parts of the class an item may hide. */
export const BODYGROUPS = ["backpack", "dogtags", "grenades", "hands", "hat", "head", "headphones", "shoes", "shoes_socks", "bullets"];

export const NUM_LODS = 3;
/** The folder an item with a model for more than one class goes in (the importer's kClassFolderMulticlass). */
export const MULTICLASS_FOLDER = "all_class";
/** kDefaultTriangleBudget and kDefaultBoneBudget, and NUM_IMPORT_MATERIALS_PER_TEAM. */
export const TRIANGLE_BUDGET = [1400, 1000, 700] as const;
export const BONE_BUDGET = 5;
export const MAX_MATERIALS = 2;

/** What differs on the BLU skin of a team-coloured material (the importer's per-skin colour fields). */
export interface BlueTint {
  colorTintBase: [number, number, number];
  selfIllumTint: [number, number, number];
}

export interface CompilerMaterial {
  color: string;
  /** The diffuse texture of the BLU skin of a team-coloured item; empty: the RED one. The other textures are shared by both skins. */
  blueColor: string;
  /** The tints of the BLU skin; null: the same as RED. */
  blueTint: BlueTint | null;
  normal: string;
  phongexponent: string;
  illum: string;
  settings: MaterialSettings;
}

export interface CompilerData {
  /** The name of the item: files and schema tokens are made from it. */
  name: string;
  /** The name players see (the importer's tf_english_name). */
  displayName: string;
  prefab: Prefab;
  region: string;
  bodygroups: string[];
  /** The model files of each class that wears the item (by the class's model name: "sniper", "demo"): three LODs each. */
  classes: Record<string, [string, string, string]>;
  /** By the name of the material in the model of the first class (the other classes' materials are those of the same position). */
  materials: Record<string, CompilerMaterial>;
  /** A RED and a BLU skin (the importer's skin type "team colored"): each material has a second material file, with its own diffuse texture and tints. */
  teamColors: boolean;
  /** Spring physics of the bones the model brings that the class does not have, by bone name (see jiggleBones.ts). */
  jiggles: Record<string, JiggleSetup>;
  /** Other axes for those bones, by bone name: degrees about the bone's own X, Y and Z (see boneAxes.ts). */
  turns: Record<string, BoneTurn>;
  /** Picking a model or texture fills the rest from the names of the files beside it (see the interface for the rules). */
  smartFill: boolean;
  /** LOD 1 and 2 that are not given are made from LOD 0 (lighter copies that fit the budgets), to try the item in the game before the real ones exist. */
  tempLods: boolean;
  /** The models are read as the game's item importer reads them (see ImportOptions): what would go wrong in the game goes wrong here too. */
  strictImporter: boolean;
  icon: string;
  /** How the textures are stored: DXT as the importer makes them, or exact pixels (to see whether the game takes them). */
  compression: "dxt" | "none";
}

export const blankMaterial = (): CompilerMaterial => ({ color: "", blueColor: "", blueTint: null, normal: "", phongexponent: "", illum: "", settings: { ...DEFAULT_MATERIAL, customProxies: [] } });

export const blankData = (): CompilerData => ({
  name: "", displayName: "", prefab: "hat", region: "hat", bodygroups: ["hat"], classes: {}, materials: {}, teamColors: false, smartFill: true, tempLods: false, strictImporter: true, jiggles: {}, turns: {}, icon: "", compression: "dxt",
});

export interface Issue { key: string; level: "error" | "warning"; text: string }

/** How the session reaches the disk and the game (injected so it can be tested). */
export interface SessionIo {
  read(path: string): Promise<ArrayBuffer>;
  stamp(path: string): Promise<number | null>;
  /** The names of the model and texture files in the folder of a file. */
  siblings(path: string): Promise<string[]>;
  /** A texture of the game (a light warp ramp), decoded. */
  gameTexture(name: string): Promise<TextureData | null>;
  /** The six faces of a cubemap of the game (a reflection a material can have), decoded. */
  gameCubemap?(name: string): Promise<TextureData[] | null>;
}

interface LoadedModel { path: string; stamp: number; model: ImportedModel }
interface LoadedImage { path: string; stamp: number; image: TgaImage }

/** Letters, digits and underscores, lower case: what the importer's CAssetTF::SetName accepts as the name of an asset. */
export const sanitizeName = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");

/** The file name (without extension) of a material: the item's name for the first, then `_1`, `_2`...; the BLU skin (team 1) has `_blue` after it. */
export const materialFileName = (name: string, index: number, team = 0) => (index === 0 ? name : `${name}_${index}`) + (team === 1 ? "_blue" : "");

/** The skins of the item: RED, and BLU for a team-coloured one. */
export type Team = 0 | 1;

export class CompilerSession {
  data: CompilerData = blankData();
  private readonly models = new Map<string, (LoadedModel | null)[]>();
  private readonly images = new Map<string, LoadedImage>();
  /** Why a path could not be read, by path. */
  readonly failures = new Map<string, string>();
  /** The version of a file that could not be read when it was last tried again (it is not tried again until it changes). */
  private readonly retried = new Map<string, number>();
  icon: LoadedImage | null = null;
  private readonly ramps = new Map<string, TextureData | null>();
  private readonly cubemaps = new Map<string, TextureData[] | null>();
  onChange: () => void = () => {};
  /** What was filled in from the names of the files rather than picked: it is replaced by the next fill, not by hand-picked files. */
  private readonly auto = new Set<string>();

  constructor(private readonly io: SessionIo) {}

  // --- loading ------------------------------------------------------------------------------------------------------

  /** The model files of a class: its three LOD paths (empty where there is none). */
  lods(cls: string): [string, string, string] { return this.data.classes[cls] ?? ["", "", ""]; }

  private loaded(cls: string) {
    let list = this.models.get(cls);
    if (!list) this.models.set(cls, (list = [null, null, null]));
    return list;
  }

  /** Sets (or clears, with an empty path) the model of a LOD of a class. */
  async setLod(cls: string, index: number, path: string, fromName = false) {
    const lods = (this.data.classes[cls] ??= ["", "", ""]);
    lods[index] = path;
    this.loaded(cls)[index] = null;
    const key = `${cls}:lod${index}`;
    if (fromName) this.auto.add(key); else this.auto.delete(key);
    if (path) await this.loadModel(cls, index);
    // taking LOD 0 away takes the LODs that were filled in from its name with it
    if (index === 0 && !path) for (const i of [1, 2]) if (this.auto.has(`${cls}:lod${i}`)) { lods[i] = ""; this.loaded(cls)[i] = null; this.auto.delete(`${cls}:lod${i}`); }
    // a class with no files left is no longer one the item is for
    if (lods.every((p) => !p)) { delete this.data.classes[cls]; this.models.delete(cls); }
    if (index === 0) {
      this.syncMaterials();
      // the rest is filled from the names of the files beside it
      if (path && !fromName && this.data.smartFill) await this.fillFromNames(cls, path);
    }
    this.onChange();
  }

  private async loadModel(cls: string, index: number) {
    const path = this.lods(cls)[index];
    try {
      const stamp = (await this.io.stamp(path)) ?? 0;
      const model = importModel(path, await this.io.read(path), { strict: this.data.strictImporter });
      this.loaded(cls)[index] = { path, stamp, model };
      this.failures.delete(path);
    } catch (error) {
      this.loaded(cls)[index] = null;
      this.failures.set(path, error instanceof Error ? error.message : String(error));
    }
  }

  /** Reads the models as the game's item importer does (or not), and reads them all again. */
  async setStrictImporter(on: boolean) {
    if (this.data.strictImporter === on) return;
    this.data.strictImporter = on;
    for (const cls of Object.keys(this.data.classes)) for (let i = 0; i < NUM_LODS; i++) if (this.lods(cls)[i]) await this.loadModel(cls, i);
    this.syncMaterials();
    this.onChange();
  }

  /** LOD 1 and 2 of a class are the files of the same name that say so (body_lod0 -> body_lod1, body_lod2). */
  private async fillLods(cls: string, path: string, names: string[]) {
    const found = lodSiblings(path, names);
    for (const i of [1, 2]) {
      const file = found[i - 1];
      if (file && (!this.lods(cls)[i] || this.auto.has(`${cls}:lod${i}`))) await this.setLod(cls, i, file, true);
    }
  }

  /**
   * Smart fill after a LOD 0 was picked for a class: its other LODs, the models of the other classes (sniper_hat.fbx brings heavy_hat.fbx
   * and their LODs), and the diffuse textures of the materials from the texture folder beside the mesh folder. Hand-picked files stay.
   */
  private async fillFromNames(cls: string, path: string) {
    const names = await Promise.resolve().then(() => this.io.siblings(path)).catch(() => [] as string[]);
    await this.fillLods(cls, path, names);
    for (const [other, file] of Object.entries(classSiblings(path, names, cls))) {
      if (this.lods(other)[0] && !this.auto.has(`${other}:lod0`)) continue;
      await this.setLod(other, 0, file, true);
      await this.fillLods(other, file, names);
    }
    await this.fillTextures(path);
  }

  /** A model in .../mesh/ with a .../texture/ folder beside it: each material's diffuse texture is the .tga there named after the material. */
  private async fillTextures(meshPath: string) {
    for (const dir of textureDirsFor(meshPath)) {
      const files = await Promise.resolve().then(() => this.io.siblings(dir + "_.tga")).catch(() => [] as string[]);
      const tgas = files.filter((f) => f.toLowerCase().endsWith(".tga"));
      if (!tgas.length) continue;
      for (const material of this.materialNames()) {
        const m = (this.data.materials[material] ??= blankMaterial());
        if (m.color && !this.auto.has(`${material}:color`)) continue;
        const file = materialDiffuse(material, tgas);
        if (!file) continue;
        await this.setTexture(material, "color", dir + file); // brings its normal and exponent by their names
        this.auto.add(`${material}:color`);
      }
      return;
    }
  }

  /** Gives a material one of its textures (an empty path takes it away). */
  async setTexture(material: string, kind: TextureRole, path: string, fromName = false) {
    const m = (this.data.materials[material] ??= blankMaterial());
    m[kind] = path;
    const key = `${material}:${kind}`;
    if (fromName) this.auto.add(key); else this.auto.delete(key);
    if (path) await this.loadImage(path);
    if (path && !fromName && this.data.smartFill) {
      // the others of the material are the files of the same name that say so (a_body_diffuse -> a_body_normal, a_body_expmask)
      const names = await Promise.resolve().then(() => this.io.siblings(path)).catch(() => [] as string[]);
      const found = textureSiblings(path, names);
      for (const [role, file] of Object.entries(found) as [TextureRole, string][]) {
        if (!m[role] || this.auto.has(`${material}:${role}`)) await this.setTexture(material, role, file, true);
      }
    }
    this.onChange();
  }

  async setIcon(path: string) {
    this.data.icon = path;
    this.icon = null;
    if (path) {
      try {
        const stamp = (await this.io.stamp(path)) ?? 0;
        this.icon = { path, stamp, image: decodeTga(await this.io.read(path)) };
        this.failures.delete(path);
      } catch (error) { this.failures.set(path, error instanceof Error ? error.message : String(error)); }
    }
    this.onChange();
  }

  private async loadImage(path: string) {
    try {
      const stamp = (await this.io.stamp(path)) ?? 0;
      this.images.set(path, { path, stamp, image: decodeTga(await this.io.read(path)) });
      this.failures.delete(path);
    } catch (error) {
      this.images.delete(path);
      this.failures.set(path, error instanceof Error ? error.message : String(error));
    }
  }

  /** Loads everything the data names (after the data came from a saved session). */
  async loadAll() {
    for (const cls of Object.keys(this.data.classes)) for (let i = 0; i < NUM_LODS; i++) if (this.lods(cls)[i]) await this.loadModel(cls, i);
    this.alignMaterialNames();
    this.syncMaterials();
    const paths = new Set<string>();
    for (const m of Object.values(this.data.materials)) for (const p of [m.color, m.blueColor, m.normal, m.phongexponent, m.illum]) if (p) paths.add(p);
    for (const p of paths) await this.loadImage(p);
    if (this.data.icon) await this.setIcon(this.data.icon);
    this.onChange();
  }

  /** Reloads the files that changed on disk since they were read; true when something did. */
  async refresh(): Promise<boolean> {
    let changed = false;
    for (const cls of Object.keys(this.data.classes)) {
      for (let i = 0; i < NUM_LODS; i++) {
        const loaded = this.models.get(cls)?.[i], path = this.lods(cls)[i];
        if (!path) continue;
        const stamp = await this.io.stamp(path);
        if (stamp !== null && (!loaded || loaded.stamp !== stamp)) { await this.loadModel(cls, i); changed = true; }
      }
    }
    for (const [path, loaded] of [...this.images]) {
      const stamp = await this.io.stamp(path);
      if (stamp !== null && stamp !== loaded.stamp) { await this.loadImage(path); changed = true; }
    }
    if (this.icon) {
      const stamp = await this.io.stamp(this.icon.path);
      if (stamp !== null && stamp !== this.icon.stamp) { await this.setIcon(this.icon.path); changed = true; }
    }
    // a texture or the icon that could not be read is tried again when the file is there (and different) now
    for (const path of this.failedPaths()) {
      if (this.images.has(path) || Object.values(this.data.classes).some((files) => files.includes(path))) continue;
      const stamp = await this.io.stamp(path);
      if (stamp === null || this.retried.get(path) === stamp) continue;
      this.retried.set(path, stamp);
      if (this.data.icon === path) await this.setIcon(path); else await this.loadImage(path);
      if (!this.failures.has(path)) changed = true;
    }
    if (changed) { this.syncMaterials(); this.onChange(); }
    return changed;
  }

  // --- the adjusted copy of the models ---------------------------------------------------------------------------------

  /**
   * Writes each model file of the item as an FBX beside the original, named `adjusted_<name>.fbx`, with the turned axes of the bones in it
   * (what the item importer builds from), then makes those files the item's models and takes the turns off (they are in the files now).
   * An FBX is the artist's own file with only the turned bones edited (see turnBones): written again from the model, its skin does not come
   * through the item importer (the weights are lost, and with them the bones the item hangs on). Other files, or an FBX that cannot be edited,
   * are written from the model. Nothing changes when a file cannot be written. Returns the paths written.
   */
  async exportAdjusted(write: (path: string, bytes: Uint8Array) => Promise<void>): Promise<string[]> {
    const jobs: { cls: string; index: number; from: string; to: string; bytes: Uint8Array }[] = [];
    for (const [cls, files] of Object.entries(this.data.classes)) {
      files.forEach((from, index) => {
        const loaded = this.models.get(cls)?.[index];
        if (!from || !loaded) return;
        const slash = Math.max(from.lastIndexOf("/"), from.lastIndexOf("\\"));
        const file = from.slice(slash + 1).replace(/\.[^.]*$/, "");
        const to = `${from.slice(0, slash + 1)}${/^adjusted_/i.test(file) ? file : `adjusted_${file}`}.fbx`;
        jobs.push({ cls, index, from, to, bytes: new Uint8Array() });
      });
    }
    const turns = Object.fromEntries(Object.entries(this.data.turns).filter(([, turn]) => !isIdentityTurn(turn)).map(([name, turn]) => [name, turnMatrix(turn)]));
    for (const job of jobs) {
      const model = this.models.get(job.cls)![job.index]!.model;
      if (/.fbx$/i.test(job.from)) {
        try {
          const original = await this.io.read(job.from);
          job.bytes = turnBones(original, turns) ?? new Uint8Array(original);
          continue;
        } catch { /* a file this does not edit is written from the model */ }
      }
      job.bytes = writeFbx(model, this.data.turns);
    }
    for (const job of jobs) await write(job.to, job.bytes);
    for (const job of jobs) { this.data.classes[job.cls][job.index] = job.to; this.loaded(job.cls)[job.index] = null; this.failures.delete(job.from); }
    this.data.turns = {};
    for (const job of jobs) await this.loadModel(job.cls, job.index);
    this.syncMaterials();
    this.onChange();
    return jobs.map((j) => j.to);
  }

  // --- the armature node of an FBX ------------------------------------------------------------------------------------

  /** The model files of the item that have an armature node (an extra bone for the importer), with the names of the nodes. */
  armatureFiles(): { path: string; names: string[] }[] {
    const out: { path: string; names: string[] }[] = [];
    for (const cls of Object.keys(this.data.classes)) {
      for (const loaded of this.loaded(cls)) {
        if (loaded?.model.armatures?.length && /\.fbx$/i.test(loaded.path) && !out.some((o) => o.path === loaded.path)) out.push({ path: loaded.path, names: loaded.model.armatures });
      }
    }
    return out;
  }

  /**
   * Takes the armature node out of the files that have one: the file itself is edited (see fbxStrip.ts: the rest of it stays as the exporter wrote it)
   * and written again in place. Returns the paths written, and why the others were not.
   */
  async removeArmatures(write: (path: string, bytes: Uint8Array) => Promise<void>): Promise<{ written: string[]; skipped: { path: string; reason: string }[] }> {
    const written: string[] = [], skipped: { path: string; reason: string }[] = [];
    for (const { path } of this.armatureFiles()) {
      try {
        const stripped = stripArmatures(await this.io.read(path));
        if (!stripped) continue;
        await write(path, stripped.bytes);
        written.push(path);
      } catch (error) {
        skipped.push({ path, reason: error instanceof Error ? error.message : String(error) });
      }
    }
    for (const path of written) {
      this.failures.delete(path);
      for (const cls of Object.keys(this.data.classes)) this.lods(cls).forEach((p, index) => { if (p === path) this.loaded(cls)[index] = null; });
    }
    for (const path of written) for (const cls of Object.keys(this.data.classes)) { const index = this.lods(cls).indexOf(path); if (index >= 0) await this.loadModel(cls, index); }
    if (written.length) { this.syncMaterials(); this.onChange(); }
    return { written, skipped };
  }

  // --- the temporary LODs as files ------------------------------------------------------------------------------------

  /** Where the temporary LODs of each class were written (`sniper:1` -> the path), so that the session file names real files. */
  private readonly tempFiles = new Map<string, string>();
  tempLodFile(cls: string, index: number): string { return this.tempFiles.get(`${cls}:${index}`) ?? ""; }

  /**
   * Writes the temporary LODs (see `tempLods`) as FBX files in the folder of the class's LOD 0, named `temp_<name of LOD 0>_lod1.fbx`, so that
   * what the item's session file names exists on disk and the item opens again from it. They are the lighter copies as they are made (the
   * turned axes are not in them: they are in LOD 0 when it is the adjusted copy). They have no skin (the item importer gives a LOD the skin of
   * LOD 0) and are written in the frame of LOD 0's file (its axes and its mesh node, see meshFrame), as the artist's own LODs are: the importer
   * matches a LOD to LOD 0 by the vertices as the files store them, and a LOD in another frame came out turned. A file is written again each time.
   */
  async writeTempLods(write: (path: string, bytes: Uint8Array) => Promise<void>): Promise<string[]> {
    const written: string[] = [];
    for (const cls of Object.keys(this.data.classes)) {
      const from = this.lods(cls)[0];
      if (!from) continue;
      const slash = Math.max(from.lastIndexOf("/"), from.lastIndexOf("\\"));
      const base = from.slice(slash + 1).replace(/\.[^.]*$/, "").replace(/^temp_/i, "").replace(/[_. -]?lod0$/i, ""); // hat_lod0 -> hat_lod1: the name without its LOD number
      let frame: ReturnType<typeof meshFrame> = null;
      if (/\.fbx$/i.test(from) && [1, 2].some((i) => this.isTemp(cls, i))) {
        try { frame = meshFrame(await this.io.read(from)); } catch { /* the LODs are written in their own frame */ }
      }
      for (let i = 1; i < NUM_LODS; i++) {
        if (!this.isTemp(cls, i)) { this.tempFiles.delete(`${cls}:${i}`); continue; }
        const model = this.model(cls, i);
        if (!model || model.flexes?.length) continue; // (a lighter copy of a model with shape keys does not keep them)
        const to = `${from.slice(0, slash + 1)}temp_${base}_lod${i}.fbx`;
        await write(to, writeFbx(model, {}, { skeleton: false, ...(frame ? { frame } : {}) }));
        this.tempFiles.set(`${cls}:${i}`, to);
        written.push(to);
      }
    }
    return written;
  }

  // --- files that could not be read ---------------------------------------------------------------------------------

  /** Every file the item names now: the models, the textures, the icon. */
  referencedPaths(): Set<string> {
    const out = new Set<string>();
    for (const files of Object.values(this.data.classes)) for (const p of files) if (p) out.add(p);
    for (const m of Object.values(this.data.materials)) for (const p of [m.color, m.blueColor, m.normal, m.phongexponent, m.illum]) if (p) out.add(p);
    if (this.data.icon) out.add(this.data.icon);
    return out;
  }

  /** The files the item names that could not be read (gone, or not a model / texture). A file that was swapped for another is not one of them. */
  failedPaths(): string[] {
    const named = this.referencedPaths();
    return [...this.failures.keys()].filter((p) => named.has(p));
  }

  /** Takes the files that could not be read out of the item (a model, a texture or the icon that is gone), and forgets what was said about them. */
  dropFailed() {
    const failed = new Set(this.failedPaths());
    for (const [cls, files] of Object.entries(this.data.classes)) {
      files.forEach((p, i) => { if (failed.has(p)) { files[i] = ""; this.loaded(cls)[i] = null; this.auto.delete(`${cls}:lod${i}`); } });
      if (files.every((p) => !p)) { delete this.data.classes[cls]; this.models.delete(cls); }
    }
    for (const [name, m] of Object.entries(this.data.materials)) {
      for (const role of ["color", "blueColor", "normal", "phongexponent", "illum"] as const) if (failed.has(m[role])) { m[role] = ""; this.auto.delete(`${name}:${role}`); }
    }
    if (failed.has(this.data.icon)) { this.data.icon = ""; this.icon = null; }
    for (const p of [...this.failures.keys()]) this.failures.delete(p);
    this.syncMaterials();
    this.onChange();
  }

  // --- what was read ------------------------------------------------------------------------------------------------

  model(cls: string, index: number): ImportedModel | null { return this.loadedLods(cls)[index]?.model ?? null; }

  /** The LODs of a class as the item has them: the files that were read, and the temporary ones for the LODs after the first that have none (when that is on). */
  private loadedLods(cls: string): (LoadedModel | null)[] {
    const real = this.models.get(cls) ?? [null, null, null];
    if (!this.data.tempLods || !real[0]) return real;
    return real.map((m, i) => m ?? (i > 0 ? { path: "", stamp: 0, model: this.tempLod(real[0]!.model, i) } : null));
  }

  private readonly temps = new WeakMap<ImportedModel, Map<number, ImportedModel>>();

  private tempLod(lod0: ImportedModel, index: number): ImportedModel {
    let made = this.temps.get(lod0);
    if (!made) this.temps.set(lod0, (made = new Map()));
    let model = made.get(index);
    if (!model) {
      // each one lighter than the one before, and never over its budget
      model = decimateModel(lod0, Math.min(TRIANGLE_BUDGET[index], Math.floor(lod0.triangles * (index === 1 ? 0.6 : 0.3))));
      made.set(index, model);
    }
    return model;
  }

  private readonly skinned = new WeakMap<ImportedModel, Map<ImportedModel, ImportedModel>>();

  /** A LOD for the preview: with the skin of LOD 0 where it has none. */
  private skinnedLike(lod0: ImportedModel, lod: ImportedModel): ImportedModel {
    let byLod0 = this.skinned.get(lod);
    if (!byLod0) this.skinned.set(lod, (byLod0 = new Map()));
    let made = byLod0.get(lod0);
    if (!made) byLod0.set(lod0, (made = transferSkin(lod0, lod)));
    return made;
  }

  /** Whether a LOD is one the session made (it has no file). */
  isTemp(cls: string, index: number): boolean { return this.data.tempLods && index > 0 && !!this.models.get(cls)?.[0] && !this.models.get(cls)?.[index]; }
  image(path: string): TgaImage | null { return this.images.get(path)?.image ?? null; }

  /** The classes the item has models for, in the order they were given. */
  classesWithModels(): string[] { return Object.keys(this.data.classes); }

  /** More than one class: the item goes in the all-class folder and every class has a model of its own. */
  isMulticlass() { return this.classesWithModels().length > 1; }

  /** The class whose model names the materials: the first one with a LOD 0 that has been read. */
  primaryClass(): string | null { return this.classesWithModels().find((c) => this.model(c, 0)) ?? null; }

  /** The materials of the item: those of the first class's first LOD, in its order, at most {@link MAX_MATERIALS}. */
  materialNames(): string[] {
    const primary = this.primaryClass();
    if (primary) return this.model(primary, 0)!.materials.slice(0, MAX_MATERIALS);
    // no model has been read (a session opened with its model missing, or one the compiler cannot read): the materials the session has, so
    // their settings can still be seen and edited
    return Object.keys(this.data.materials).slice(0, MAX_MATERIALS);
  }

  /** Which of the item's materials a material of a class's model is: by its position among that model's (the importer does the same). */
  materialSlot(cls: string, material: string): number {
    const own = this.model(cls, 0)?.materials ?? [];
    return Math.min(MAX_MATERIALS - 1, Math.max(0, own.indexOf(material)));
  }

  /**
   * The importer names the materials of a session by its own list, which need not be the names in the model (it may say A_poncho_diffuse for
   * the model's A_poncho). Materials that match no name of the model take the model's names that have none, in order.
   */
  private alignMaterialNames() {
    const names = this.materialNames();
    const unmatched = Object.keys(this.data.materials).filter((k) => !names.includes(k));
    const missing = names.filter((n) => !(n in this.data.materials));
    unmatched.forEach((key, i) => {
      const target = missing[i];
      if (!target) return;
      this.data.materials[target] = this.data.materials[key];
      delete this.data.materials[key];
    });
  }

  /** Gives each material of the model its settings (keeping the ones it already had). */
  private syncMaterials() {
    for (const name of this.materialNames()) this.data.materials[name] ??= blankMaterial();
  }

  // --- the paths and names a build uses -------------------------------------------------------------------------------

  get itemName() { return sanitizeName(this.data.name); }

  /** The class folder the item goes in: its class, or all_class when more than one has a model (`cls` is where it goes before it has any). */
  folder(cls: string) {
    const classes = this.classesWithModels();
    return classes.length > 1 ? MULTICLASS_FOLDER : classes[0] ?? cls;
  }

  /** Folder of the item in the game, under models/ and materials/models/: `workshop/player/items/<class folder>/<name>`. */
  itemFolder(cls: string) { return `workshop/player/items/${this.folder(cls)}/${this.itemName}`; }

  /** The name of a class's model file (without extension): the item's name, with the class after it when there are several. */
  modelFile(cls: string) { return this.isMulticlass() ? `${this.itemName}_${cls}` : this.itemName; }

  /** Game paths (no extension) of a material's textures; only those the artist gave. */
  texturePaths(cls: string, material: string, index: number, team: Team = 0): MaterialTexturePaths {
    const m = this.data.materials[material];
    const base = `models/${this.itemFolder(cls)}/${materialFileName(this.itemName, index)}`;
    const has = (path: string | undefined) => !!path && !!this.images.get(path);
    const illum = m?.settings.selfIllum && has(m.illum);
    // the BLU diffuse texture is a file of its own when it is another one than the RED; else the BLU material points at the RED file
    const color = team === 1 && this.blueIsOwn(material) ? `${base}_blue_color` : has(m?.color) ? `${base}_color` : undefined;
    return {
      color,
      normal: has(m?.normal) && m?.settings.envmapMask !== "$basealphaenvmapmask" ? `${base}_normal` : undefined,
      phongexponent: has(m?.phongexponent) ? `${base}_phongexponent` : undefined,
      illum: illum ? `${base}_illum` : undefined,
    };
  }

  /** Whether the BLU skin of a material has a diffuse texture of its own (a team-coloured item, another file than the RED one, read). */
  blueIsOwn(material: string): boolean {
    const m = this.data.materials[material];
    return this.data.teamColors && !!m && !!m.blueColor && m.blueColor !== m.color && !!this.images.get(m.blueColor);
  }

  /** The material file of one of the item's materials as the compiler would write it (team 1: its BLU skin). */
  vmt(cls: string, material: string, index: number, team: Team = 0): KvNode[] {
    const m = this.data.materials[material];
    const settings = m?.settings ?? DEFAULT_MATERIAL;
    const tinted = team === 1 && m?.blueTint ? { ...settings, colorTintBase: m.blueTint.colorTintBase, selfIllumTint: m.blueTint.selfIllumTint } : settings;
    return buildVmt(tinted, this.texturePaths(cls, material, index, team));
  }

  vmtText(cls: string, material: string, index: number, team: Team = 0) { return vmtText(this.vmt(cls, material, index, team)); }

  /** Turns the BLU skin on or off. */
  setTeamColors(on: boolean) {
    this.data.teamColors = on;
    this.onChange();
  }

  /** Gives the BLU skin of a material its own diffuse texture (an empty path takes it away: BLU uses the RED one). */
  async setBlueColor(material: string, path: string) {
    const m = (this.data.materials[material] ??= blankMaterial());
    m.blueColor = path;
    if (path) await this.loadImage(path);
    this.onChange();
  }

  // --- checks (the importer's limits) -----------------------------------------------------------------------------------

  /** What the importer would refuse, per class for the models (`lod0:sniper`) and for the item as a whole; `customBones` are the shown class's. */
  issues(customBones: string[] = []): Issue[] {
    const out: Issue[] = [];
    const error = (key: string, text: string) => out.push({ key, level: "error", text });
    const warn = (key: string, text: string) => out.push({ key, level: "warning", text });
    // only the files the item names now: one that was swapped for another says nothing any more
    const named = this.referencedPaths();
    for (const [path, message] of this.failures) if (named.has(path)) error(`file:${path}`, `${fileName(path)}: ${message}`);
    if (!this.itemName) error("name", "The item needs a name.");
    else if (this.itemName !== this.data.name.trim()) warn("name", `Files will be named "${this.itemName}".`);
    const classes = this.classesWithModels();
    if (!classes.length) error("lod0", "Add the model of the item (LOD 0).");
    const counts: { cls: string; lods: number; materials: number }[] = [];
    for (const cls of classes) {
      const where = classes.length > 1 ? ` of ${cls}` : "";
      const models = this.loadedLods(cls);
      if (!models[0]) error(`lod0:${cls}`, `Add the model${where} (LOD 0).`);
      let previous = models[0]?.model.materials.length ?? 0;
      for (let i = 0; i < NUM_LODS; i++) {
        const loaded = models[i];
        if (!loaded) continue;
        const triangles = loaded.model.triangles;
        if (triangles > TRIANGLE_BUDGET[i]) error(`lod${i}:${cls}`, `LOD ${i}${where} has ${triangles} triangles; the limit is ${TRIANGLE_BUDGET[i]}.`);
        if (loaded.model.materials.length > MAX_MATERIALS) error(`lod${i}:${cls}`, `LOD ${i}${where} has ${loaded.model.materials.length} materials; the limit is ${MAX_MATERIALS}.`);
        if (i > 0 && loaded.model.materials.length > previous) error(`lod${i}:${cls}`, `LOD ${i}${where} has more materials than LOD ${i - 1}.`);
        previous = loaded.model.materials.length;
      }
      // the last LOD given has to be small enough, or the item needs another
      const lastIndex = models.map((m) => !!m).lastIndexOf(true);
      const last = lastIndex >= 0 ? models[lastIndex] : null;
      if (last && lastIndex < NUM_LODS - 1 && last.model.triangles > TRIANGLE_BUDGET[NUM_LODS - 1]) {
        error(`lod${lastIndex + 1}:${cls}`, `Add LOD ${lastIndex + 1}${where}: LOD ${lastIndex} has ${last.model.triangles} triangles and the lowest LOD may have ${TRIANGLE_BUDGET[NUM_LODS - 1]}.`);
      }
      counts.push({ cls, lods: models.filter((m) => m).length, materials: models[0]?.model.materials.length ?? 0 });
      // the game's QC links an attachment to bip_head (for unusual effects): a skeleton that has none cannot be compiled
      const skeleton = models[0]?.model.skeleton ?? [];
      if (skeleton.length && !skeleton.some((b) => b.name === "bip_head")) error(`head:${cls}`, `The skeleton of the model${where} has no bip_head: the game's build links an attachment to it. Keep the class's bones in the armature, even those nothing is skinned to.`);
      if (models[0]?.model.parts.some((p) => p.boneNames.length === 1 && p.boneNames[0] === "")) warn(`skin:${cls}`, `Part of the model${where} has no skin weights; it follows the head.`);
    }
    // every class needs the same number of LODs and of materials (AreClassesLODCountMatch, AreClassesMaterialCountMatch)
    if (counts.some((c) => c.lods !== counts[0].lods)) error("lodcount", `Every class needs the same number of LODs (${counts.map((c) => `${c.cls} ${c.lods}`).join(", ")}).`);
    if (counts.some((c) => c.materials !== counts[0].materials)) error("materialcount", `Every class needs the same number of materials (${counts.map((c) => `${c.cls} ${c.materials}`).join(", ")}).`);
    // a jiggle bone has to be in the model of a class to be a jiggle bone there
    for (const bone of Object.keys(this.data.jiggles)) {
      const without = classes.filter((cls) => { const model = this.model(cls, 0); return model && !smdBoneNames(model).includes(bone); });
      if (without.length === classes.length && classes.length) warn(`jiggle:${bone}`, `${bone} has jiggle physics but is not in the model; it has none.`);
      else if (without.length) warn(`jiggle:${bone}`, `${bone} is not in the model of ${without.join(", ")}: it has no jiggle there.`);
    }
    // the importer pairs the materials of the session with those of the FBX by their place in a sorted list: a file that has them in another order can come out swapped
    for (const cls of classes) {
      this.loadedLods(cls).forEach((loaded, i) => {
        const order = loaded?.model.fileMaterialOrder;
        if (order) warn(`matorder:${cls}:${i}`, `${fileName(loaded!.path)}: material slots are not in A–Z order (${order.join(", ")}); the importer may swap them.`);
      });
    }
    for (const { path, names } of this.armatureFiles()) {
      warn(`armature:${path}`, `${fileName(path)}: extra bone ${names.join(", ")} (counts as one of the item's bones).`);
    }
    if (customBones.length > BONE_BUDGET) error("bones", `The item has ${customBones.length} bones of its own (${customBones.join(", ")}); the limit is ${BONE_BUDGET}.`);
    for (const name of this.materialNames()) {
      const m = this.data.materials[name];
      if (!m?.color) error(`material:${name}`, `Material ${name} needs a diffuse texture.`);
      for (const [kind, label] of [["color", "diffuse"], ["normal", "normal"], ["phongexponent", "exponent"], ["illum", "glow"]] as const) {
        const image = m && m[kind] ? this.image(m[kind]) : null;
        if (!image) continue;
        const problem = textureProblem(image, kind as TextureKind);
        if (problem) error(`material:${name}:${kind}`, `The ${label} texture of ${name} ${problem}.`);
      }
      if (this.data.teamColors && m?.blueColor) {
        const image = this.image(m.blueColor);
        const problem = image ? textureProblem(image, "color" as TextureKind) : null;
        if (problem) error(`material:${name}:blueColor`, `The BLU diffuse texture of ${name} ${problem}.`);
      }
      if (m?.settings.selfIllum && !m.illum) warn(`material:${name}`, `${name} glows but has no self-illumination mask; it glows everywhere.`);
      proxyProblems(m?.settings.customProxies ?? [], !!m?.settings.selfIllum).forEach((p, i) => warn(`material:${name}:proxy${i}`, `${name}: ${p}.`));
    }
    if (!this.data.icon) error("icon", "Add the backpack icon.");
    else if (this.icon) { const p = iconProblem(this.icon.image); if (p) error("icon", `The icon ${p}.`); }
    if (!this.data.region) error("region", "Pick an equip region.");
    return out;
  }

  // --- the preview ----------------------------------------------------------------------------------------------------

  /**
   * The commands the QC of a class's model gets inside its LOD 1 and LOD 2 blocks: the bones the class gives up there that the item's skin uses
   * (`bonetreecollapse`, `replacebone`; see lodBones.ts), and `nofacial` at LOD 2 for an item with shape keys.
   */
  lodQcCommands(cls: string): [string[], string[]] {
    const loaded = this.loadedLods(cls);
    const lod0 = loaded[0]?.model;
    if (!lod0) return [[], []];
    const lines = ([1, 2] as const).map((lod) => lodCommandLines(lodCommands(cls, lod, [lod0, ...(loaded[lod] ? [loaded[lod]!.model] : [])])));
    if (lod0.flexes?.length) lines[1].push("nofacial");
    return [lines[0], lines[1]];
  }

  /** The `$jigglebone` blocks of a class's model: the bones of the model that have a setup (a bone another class's model lacks is left out of that class). */
  jiggleQc(cls: string): string {
    const model = this.model(cls, 0);
    return model ? jiggleQcFor(smdBoneNames(model), this.data.jiggles) : "";
  }

  /** The cosmetic the viewer shows for the item on a class, with the materials it needs; null while that class has no model. */
  async preview(classData: ModelData, cls: string, lod = 0): Promise<{ data: ModelData; materials: Map<string, MaterialData>; customBones: string[]; skeleton: PreviewBone[]; bodygroups: Record<string, number> } | null> {
    const lod0 = this.loadedLods(cls)[0];
    if (!lod0) return null;
    // the LOD the viewer is at: the item's own file for it, or the nearest lower one it was given (as the game falls back)
    let shown = lod0;
    for (let i = Math.min(lod, NUM_LODS - 1); i > 0; i--) { const given = this.loadedLods(cls)[i]; if (given) { shown = given; break; } }
    const names = this.materialNames();
    const name = this.itemName || "item";
    const materialPath = (index: number, team: Team = 0) => `materials/models/${this.itemFolder(cls)}/${materialFileName(name, index, team)}.vmt`;
    const own = lod0.model.materials;
    // a LOD that came without a skin (the game's importer gives it LOD 0's) is shown with LOD 0's, and gives up the bones the class gives up there
    let shownModel = shown === lod0 ? lod0.model : this.skinnedLike(lod0.model, shown.model);
    if (shown !== lod0) {
      const at = this.loadedLods(cls).indexOf(shown);
      if (at === 1 || at === 2) {
        const skeleton = lod0.model.skeleton.length ? lod0.model.skeleton : shown.model.skeleton;
        shownModel = applyBoneRemap(shownModel, boneRemap(lodCommands(cls, at, [lod0.model, shown.model]), skeleton));
      }
    }
    const result = buildPreviewModel(shownModel, classData, `models/${this.itemFolder(cls)}/${this.modelFile(cls) || "item"}.mdl`, (material) => {
      const index = Math.min(MAX_MATERIALS - 1, Math.max(0, own.indexOf(material)));
      // RED, then BLU: the same material without team colours
      return [materialPath(index), materialPath(index, this.data.teamColors ? 1 : 0)];
    }, { jiggles: this.data.jiggles, turns: this.data.turns });
    const materials = new Map<string, MaterialData>();
    for (const [i, material] of names.entries()) {
      const settings = this.data.materials[material]?.settings ?? DEFAULT_MATERIAL;
      const take = (path: string | undefined): TextureData | undefined => {
        const image = path ? this.image(path) : null;
        return image ? { width: image.width, height: image.height, rgba: image.rgba } : undefined;
      };
      const m = this.data.materials[material];
      if (!this.ramps.has(settings.lightwarp)) this.ramps.set(settings.lightwarp, await this.io.gameTexture(settings.lightwarp).catch(() => null));
      // the reflection: the preview has no level, so "the cubemap of the level" is the viewer's own (the world setting can replace it)
      const cubemap = settings.envmap === "env_cubemap" ? "hlmv/cubemap" : settings.envmap;
      if (cubemap && this.io.gameCubemap && !this.cubemaps.has(cubemap)) this.cubemaps.set(cubemap, await this.io.gameCubemap(cubemap).catch(() => null));
      for (const team of (this.data.teamColors ? [0, 1] : [0]) as Team[]) {
        const textures: PreviewTextures = {};
        textures.env = cubemap ? this.cubemaps.get(cubemap) ?? undefined : undefined;
        textures.base = take(team === 1 && this.blueIsOwn(material) ? m?.blueColor : m?.color);
        textures.bump = take(m?.normal);
        textures.exponent = take(m?.phongexponent);
        textures.illum = settings.selfIllum ? take(m?.illum) : undefined;
        textures.warp = this.ramps.get(settings.lightwarp) ?? undefined;
        materials.set(materialPath(i, team), buildPreviewMaterial(materialPath(i, team), this.vmt(cls, material, i, team), textures));
      }
    }
    // the parts of the class the item hides, as a cosmetic's player_bodygroups do (the viewer turns those models off)
    const bodygroups = Object.fromEntries(this.data.bodygroups.map((b) => [b, 1]));
    return { data: result.data, materials, customBones: result.customBones, skeleton: result.skeleton, bodygroups };
  }

  // --- saving --------------------------------------------------------------------------------------------------------

  toJSON(): CompilerData { return JSON.parse(JSON.stringify(this.data)); }

  /**
   * Replaces the data with a saved one (unknown or malformed parts fall back to blanks); call {@link loadAll} to read its files. A
   * session saved before items could have several classes had one list of LODs: it belongs to `fallbackClass`.
   */
  restore(saved: unknown, fallbackClass = "sniper") {
    this.auto.clear();
    const blank = blankData();
    const s = (saved && typeof saved === "object" ? saved : {}) as Partial<CompilerData> & { lods?: unknown };
    const str = (v: unknown, d: string) => (typeof v === "string" ? v : d);
    const lodList = (v: unknown): [string, string, string] => [0, 1, 2].map((i) => str((v as string[] | undefined)?.[i], "")) as [string, string, string];
    const classes: CompilerData["classes"] = {};
    if (s.classes && typeof s.classes === "object") {
      for (const [cls, lods] of Object.entries(s.classes)) { const list = lodList(lods); if (list.some((p) => p)) classes[cls] = list; }
    } else if (Array.isArray(s.lods)) {
      const list = lodList(s.lods);
      if (list.some((p) => p)) classes[fallbackClass] = list;
    }
    this.data = {
      name: str(s.name, ""), displayName: str(s.displayName, ""),
      prefab: PREFABS.includes(s.prefab as Prefab) ? (s.prefab as Prefab) : blank.prefab,
      region: str(s.region, blank.region),
      bodygroups: Array.isArray(s.bodygroups) ? s.bodygroups.filter((b): b is string => BODYGROUPS.includes(b as string)) : blank.bodygroups,
      classes, materials: {}, teamColors: s.teamColors === true, smartFill: s.smartFill !== false, tempLods: s.tempLods === true, strictImporter: s.strictImporter !== false, icon: str(s.icon, ""), compression: s.compression === "none" ? "none" : "dxt",
      jiggles: Object.fromEntries(Object.entries(s.jiggles && typeof s.jiggles === "object" ? s.jiggles : {}).map(([bone, setup]) => [bone, readJiggle(setup)])),
      turns: Object.fromEntries(Object.entries(s.turns && typeof s.turns === "object" ? s.turns : {}).flatMap(([bone, turn]): [string, BoneTurn][] => (Array.isArray(turn) && turn.length === 3 && turn.every((v) => typeof v === "number" && Number.isFinite(v)) ? [[bone, [turn[0], turn[1], turn[2]]]] : []))),
    };
    for (const [name, raw] of Object.entries(s.materials ?? {})) {
      const m = raw as Partial<CompilerMaterial> | null;
      const base = blankMaterial();
      this.data.materials[name] = {
        color: str(m?.color, ""), blueColor: str(m?.blueColor, ""), blueTint: parseBlueTint(m?.blueTint), normal: str(m?.normal, ""), phongexponent: str(m?.phongexponent, ""), illum: str(m?.illum, ""),
        settings: { ...base.settings, ...(m?.settings && typeof m.settings === "object" ? m.settings : {}), customProxies: sanitizeProxies((m?.settings as Partial<MaterialSettings> | undefined)?.customProxies) },
      };
    }
    this.models.clear();
    this.images.clear();
    this.icon = null;
  }
}

export const fileName = (path: string) => path.replace(/\\/g, "/").split("/").pop() ?? path;

const rgb255 = (v: unknown): [number, number, number] | null => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && Number.isFinite(x)) ? [v[0], v[1], v[2]].map((x) => Math.min(255, Math.max(0, Math.round(x))) as number) as [number, number, number] : null;

/** The BLU tints of a saved material, or null (the same as RED) when they are missing or malformed. */
function parseBlueTint(value: unknown): BlueTint | null {
  const v = value as Partial<BlueTint> | null;
  const colorTintBase = rgb255(v?.colorTintBase), selfIllumTint = rgb255(v?.selfIllumTint);
  return colorTintBase && selfIllumTint ? { colorTintBase, selfIllumTint } : null;
}
