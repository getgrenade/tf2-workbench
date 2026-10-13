import * as THREE from "three";
import type { MaterialData, MeshData, ModelData, TextureData } from "../viewer/payload";
import type { PropBuildRequest } from "../api";
import type { ImportedModel } from "./fbx";
import { importModel } from "./importModel";
import { decodeTga, type TgaImage } from "./tga";
import { writeSmd } from "./smd";
import { writeDmx } from "./dmxWrite";
import { collisionSmd, type CollisionMode } from "./collision";
import { DEFAULT_PROP_MATERIAL, extraProblem, propVmt, type PropMaterialSettings } from "./propVmt";
import { proxyProblems, sanitizeProxies } from "./proxyModel";
import { lodSiblings, materialDiffuse, textureDirsFor, textureSiblings, type TextureRole } from "./siblings";
import { computeTangents, flipWinding } from "./mesh";
import { buildPreviewMaterial } from "./preview";
import { parseKv } from "./kv";
import type { Issue, SessionIo } from "./session";

/**
 * The prop being compiled: the artist's choices, the source files they point at (read and checked as they are given), and what the viewer
 * shows of it. A prop is one model (up to three levels of detail) with its materials and, if it is to be solid, a collision model.
 */

export const PROP_NUM_LODS = 3;
export const PROP_BONE = "static_prop";
/** The textures a prop may have are bigger than an item's. */
export const PROP_TEXTURE_LIMITS = [256, 512, 1024, 2048] as const;
/** Over this many triangles the game's props are rare: a warning. */
export const PROP_TRIANGLE_WARNING = 8000;
export const PROP_TRIANGLE_LIMIT = 65000;

export interface PropMaterial {
  color: string;
  normal: string;
  phongexponent: string;
  illum: string;
  settings: PropMaterialSettings;
}

export interface PropData {
  /** Lowercase letters, digits and underscores: the name of the model file. */
  name: string;
  /** Below models/ (`props_custom`): the model and its materials go under it. */
  folder: string;
  surfaceprop: string;
  mass: number;
  staticProp: boolean;
  collision: CollisionMode;
  /** The .smd of the collision model, for the mode "file". */
  collisionFile: string;
  concave: boolean;
  /** The model files, LOD 0 to 2. */
  lods: [string, string, string];
  /** By the name of the material in the model. */
  materials: Record<string, PropMaterial>;
  maxTexture: number;
  /** How the textures of every material are stored: DXT (small, a little blocky on gradients and fine detail) or exact pixels (BGRA8888, several times the size). */
  compression: "dxt" | "none";
  /** The folder the prop is written to. */
  outDir: string;
  smartFill: boolean;
}

export const blankPropMaterial = (): PropMaterial => ({ color: "", normal: "", phongexponent: "", illum: "", settings: { ...DEFAULT_PROP_MATERIAL, customProxies: [] } });

export const blankPropData = (): PropData => ({
  name: "", folder: "props_custom", surfaceprop: "wood", mass: 50, staticProp: false, collision: "hull", collisionFile: "", concave: false,
  lods: ["", "", ""], materials: {}, maxTexture: 1024, compression: "dxt", outDir: "", smartFill: true,
});

const NAME = /^[a-z0-9_]+$/;

/** A model for a prop: it has a skeleton (one bone, `static_prop`, when the file had none) and every vertex belongs to a bone of it. */
export function propModel(model: ImportedModel): ImportedModel {
  const skeleton = model.skeleton.length ? model.skeleton : [{ name: PROP_BONE, parent: null, world: new THREE.Matrix4().toArray() }];
  const fallback = skeleton[0].name;
  return { ...model, skeleton, parts: model.parts.map((p) => ({ ...p, boneNames: p.boneNames.map((n) => n || fallback) })) };
}

/** The geometry and the bones of a model in Source's frame (Z up) instead of the viewer's (Y up): what studiomdl's `$upaxis Y` makes of it. */
function toSource(v: number[]): number[] { return [v[2], v[0], v[1]]; }

/** The preview of a prop as the viewer's model data: the bind pose in Source's frame (a prop is drawn from there: see Actor.sourceBind). */
export function propPreviewData(model: ImportedModel, path: string, materialPath: (material: string) => string): ModelData {
  const m = propModel(model);
  const turn = new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1); // viewer frame -> Source frame
  const index = new Map(m.skeleton.map((b, i) => [b.name, i]));
  const bones = m.skeleton.map((b) => {
    const world = new THREE.Matrix4().multiplyMatrices(turn, new THREE.Matrix4().fromArray(b.world));
    const e = world.clone().invert().elements; // world -> bone, column-major; the data is the first three rows
    return { name: b.name, parent: b.parent ? index.get(b.parent) ?? -1 : -1, poseToBone: [e[0], e[4], e[8], e[12], e[1], e[5], e[9], e[13], e[2], e[6], e[10], e[14]] };
  });
  const meshes: MeshData[] = m.parts.map((part) => {
    const positions = new Float32Array(part.positions.length), normals = new Float32Array(part.normals.length);
    for (let i = 0; i < part.positions.length; i += 3) {
      positions.set(toSource([part.positions[i], part.positions[i + 1], part.positions[i + 2]]), i);
      normals.set(toSource([part.normals[i], part.normals[i + 1], part.normals[i + 2]]), i);
    }
    const indices = Uint32Array.from(part.indices);
    if (part.winding !== 1) flipWinding(indices);
    const skinIndices = new Uint16Array(part.skinIndices.length);
    for (let i = 0; i < skinIndices.length; i++) skinIndices[i] = part.skinWeights[i] > 0 ? index.get(part.boneNames[part.skinIndices[i]]) ?? 0 : 0;
    const material = materialPath(part.material);
    return {
      material, materials: [material], flexes: [], positions, normals, uvs: part.uvs, tangents: computeTangents({ positions, normals, uvs: part.uvs, indices }),
      skinIndices, skinWeights: part.skinWeights, indices,
    };
  });
  return {
    path, flexDescCount: 0, flexControllers: [], flexRules: [], skinCount: 1, eyeAttachment: null, bones, includeModels: [],
    bodyParts: [{ name: "prop", models: [{ name: "prop", meshes, eyeballs: [] }] }], lod: 0, lodCount: 1,
  };
}

interface Loaded { path: string; stamp: number; model: ImportedModel }
interface LoadedImage { path: string; stamp: number; image: TgaImage }

export class PropSession {
  data: PropData = blankPropData();
  /** What was wrong with each file the artist named (by path). */
  readonly failures = new Map<string, string>();
  private readonly models: (Loaded | null)[] = [null, null, null];
  private readonly images = new Map<string, LoadedImage>();
  private collisionText: { path: string; stamp: number; text: string } | null = null;
  /** Files that were filled in by the smart fill (and may be replaced by it). */
  private readonly auto = new Set<string>();
  onChange: () => void = () => {};

  constructor(private readonly io: SessionIo) {}

  // --- the files ---------------------------------------------------------------------------------------------------------------------

  /** The imported model of a LOD (null: none picked, or it could not be read). */
  model(lod: number): ImportedModel | null { return this.models[lod]?.model ? propModel(this.models[lod]!.model) : null; }

  materialNames(): string[] {
    const first = this.models[0]?.model ?? this.models.find((m) => m)?.model;
    return first ? [...new Set(first.parts.map((p) => p.material))] : [];
  }

  /** The file name of a material of the model: the prop's own name for the first, then `name_1`, `name_2`. */
  stem(material: string): string {
    const i = Math.max(0, this.materialNames().indexOf(material));
    return i === 0 ? this.data.name || "prop" : `${this.data.name || "prop"}_${i}`;
  }

  image(path: string): TgaImage | null { return this.images.get(path)?.image ?? null; }

  private async loadModel(lod: number) {
    const path = this.data.lods[lod];
    if (!path) { this.models[lod] = null; return; }
    try {
      const stamp = (await this.io.stamp(path)) ?? 0;
      this.models[lod] = { path, stamp, model: importModel(path, await this.io.read(path)) };
      this.failures.delete(path);
    } catch (error) {
      this.models[lod] = null;
      this.failures.set(path, error instanceof Error ? error.message : String(error));
    }
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

  /** Gives a LOD a model file (an empty path takes it away). LOD 0 brings the other LODs and the textures that go with it by their names. */
  async setLod(lod: number, path: string, fromName = false) {
    this.data.lods[lod] = path;
    await this.loadModel(lod);
    if (lod === 0) {
      this.syncMaterials();
      if (path && !fromName && this.data.smartFill) {
        const names = await Promise.resolve().then(() => this.io.siblings(path)).catch(() => [] as string[]);
        const found = lodSiblings(path, names);
        for (const i of [1, 2]) {
          const file = found[i - 1];
          if (file && (!this.data.lods[i] || this.auto.has(`lod${i}`))) { await this.setLod(i, file, true); this.auto.add(`lod${i}`); }
        }
        await this.fillTextures(path);
      }
    }
    this.onChange();
  }

  private syncMaterials() {
    const names = this.materialNames();
    for (const n of names) this.data.materials[n] ??= blankPropMaterial();
    for (const n of Object.keys(this.data.materials)) if (!names.includes(n) && names.length) delete this.data.materials[n];
  }

  private async fillTextures(modelPath: string) {
    const sources: string[] = [];
    const own = await Promise.resolve().then(() => this.io.siblings(modelPath)).catch(() => [] as string[]);
    const dir = modelPath.slice(0, Math.max(modelPath.lastIndexOf("/"), modelPath.lastIndexOf("\\")) + 1);
    sources.push(dir);
    for (const d of textureDirsFor(modelPath)) sources.push(d);
    for (const where of sources) {
      const files = where === dir ? own : await Promise.resolve().then(() => this.io.siblings(where + "_.tga")).catch(() => [] as string[]);
      const tgas = files.filter((f) => f.toLowerCase().endsWith(".tga"));
      if (!tgas.length) continue;
      for (const material of this.materialNames()) {
        const m = (this.data.materials[material] ??= blankPropMaterial());
        if (m.color && !this.auto.has(`${material}:color`)) continue;
        const file = materialDiffuse(material, tgas);
        if (!file) continue;
        await this.setTexture(material, "color", where + file, true);
        this.auto.add(`${material}:color`);
      }
    }
  }

  /** Gives a material one of its textures (an empty path takes it away); the others of the material come by their names. */
  async setTexture(material: string, role: TextureRole, path: string, fromName = false) {
    const m = (this.data.materials[material] ??= blankPropMaterial());
    m[role] = path;
    if (!fromName) this.auto.delete(`${material}:${role}`);
    if (path) await this.loadImage(path);
    if (path && role === "color" && this.data.smartFill) {
      const names = await Promise.resolve().then(() => this.io.siblings(path)).catch(() => [] as string[]);
      for (const [r, file] of Object.entries(textureSiblings(path, names)) as [TextureRole, string][]) {
        if (!m[r] || this.auto.has(`${material}:${r}`)) { m[r] = file; await this.loadImage(file); this.auto.add(`${material}:${r}`); }
      }
    }
    this.onChange();
  }

  async setCollisionFile(path: string) {
    this.data.collisionFile = path;
    this.collisionText = null;
    if (path) {
      try {
        const stamp = (await this.io.stamp(path)) ?? 0;
        this.collisionText = { path, stamp, text: new TextDecoder().decode(await this.io.read(path)) };
        this.failures.delete(path);
      } catch (error) { this.failures.set(path, error instanceof Error ? error.message : String(error)); }
    }
    this.onChange();
  }

  /** Reads everything the data names (after it came from a saved session). */
  async loadAll() {
    for (let i = 0; i < PROP_NUM_LODS; i++) await this.loadModel(i);
    this.syncMaterials();
    for (const m of Object.values(this.data.materials)) for (const p of [m.color, m.normal, m.phongexponent, m.illum]) if (p) await this.loadImage(p);
    if (this.data.collisionFile) await this.setCollisionFile(this.data.collisionFile);
    this.onChange();
  }

  // --- the checks ---------------------------------------------------------------------------------------------------------------------

  issues(): Issue[] {
    const d = this.data, out: Issue[] = [];
    const error = (key: string, text: string) => out.push({ key, level: "error", text });
    const warn = (key: string, text: string) => out.push({ key, level: "warning", text });
    if (!d.name) error("name", "Name the prop: the model file is made from it.");
    else if (!NAME.test(d.name)) error("name", "The name takes lowercase letters, digits and underscores.");
    if (!d.folder || d.folder.split("/").some((p) => !NAME.test(p))) error("folder", "The folder is lowercase names joined by / (props_custom).");
    if (!d.lods[0]) error("lod:0", "Pick the model (LOD 0).");
    for (let i = 0; i < PROP_NUM_LODS; i++) {
      const path = d.lods[i];
      if (!path) continue;
      const fail = this.failures.get(path);
      if (fail) { error(`lod:${i}`, `LOD ${i}: ${fail}`); continue; }
      const m = this.models[i]?.model;
      if (!m) continue;
      if (m.triangles > PROP_TRIANGLE_LIMIT) error(`lod:${i}`, `LOD ${i} has ${m.triangles} triangles; a model takes at most ${PROP_TRIANGLE_LIMIT}.`);
      else if (i === 0 && m.triangles > PROP_TRIANGLE_WARNING) warn(`lod:${i}`, `LOD 0 has ${m.triangles} triangles: heavy for a prop (add LODs).`);
      if (i > 0 && this.models[0] && m.triangles >= this.models[0].model.triangles) warn(`lod:${i}`, `LOD ${i} is not lighter than LOD 0.`);
      if (!m.parts.length) error(`lod:${i}`, `LOD ${i} has no geometry.`);
    }
    for (const name of this.materialNames()) {
      const m = d.materials[name];
      if (!m?.color) { error(`color:${name}`, `Material ${name} needs a colour texture.`); continue; }
      for (const [role, path] of [["colour", m.color], ["normal", m.normal], ["phong exponent", m.phongexponent], ["illumination", m.illum]] as const) {
        if (!path) continue;
        const fail = this.failures.get(path);
        if (fail) { error(`texture:${name}`, `${name}, ${role}: ${fail}`); continue; }
        const image = this.image(path);
        if (!image) continue;
        if (image.width > d.maxTexture || image.height > d.maxTexture) error(`texture:${name}`, `${name}, ${role} is ${image.width}x${image.height}; the limit is ${d.maxTexture}.`);
        else if ((image.width & (image.width - 1)) || (image.height & (image.height - 1))) error(`texture:${name}`, `${name}, ${role} is ${image.width}x${image.height}; both sides must be a power of two.`);
      }
      if (m.settings.alphaTest && m.settings.translucent) warn(`material:${name}`, `${name} is both cut out and translucent: pick one.`);
      { const bad = extraProblem(m.settings.extra); if (bad) error(`material:${name}:extra`, `${name}, extra lines: ${bad}`); }
      proxyProblems(m.settings.customProxies, m.settings.selfIllum).forEach((p, i) => warn(`material:${name}:proxy${i}`, `${name}: ${p}.`));
    }
    if (d.collision === "file") {
      if (!d.collisionFile) error("collision", "Pick the collision model (.smd), or let the compiler make one.");
      else if (!/\.smd$/i.test(d.collisionFile)) error("collision", "The collision model must be an .smd.");
      else if (this.failures.get(d.collisionFile)) error("collision", `Collision model: ${this.failures.get(d.collisionFile)}`);
    } else if (d.collision !== "none" && this.models[0] && !this.collisionModel()) error("collision", "The collision model could not be made from the mesh.");
    if (d.collision !== "none") {
      if (!(d.mass >= 0.1 && d.mass <= 50000)) error("mass", "The mass is between 0.1 and 50000 kg.");
      if (d.staticProp) warn("static", "A static prop does not use its collision in the game's physics: it is solid for the player and bullets only.");
    }
    if (d.concave && d.collision === "none") warn("concave", "Concave collision only matters for a prop that has collision.");
    if (!d.outDir) warn("outDir", "Choose the folder to write the prop to.");
    return out;
  }

  /** The collision model's .smd as it will be built, or null when there is none. */
  collisionModel(): string | null {
    const d = this.data;
    if (d.collision === "none") return null;
    if (d.collision === "file") return this.collisionText?.text ?? null;
    const model = this.model(0);
    return model ? collisionSmd(model, d.collision) : null;
  }

  // --- what the viewer and the native side get -----------------------------------------------------------------------------------

  /** The prop as the viewer draws it, with its materials; null until there is a model. */
  preview(path = "models/__workbench__/prop_preview.mdl"): { data: ModelData; materials: Map<string, MaterialData> } | null {
    const model = this.model(0);
    if (!model) return null;
    const materials = new Map<string, MaterialData>();
    const materialPath = (material: string) => `materials/__workbench__/prop_preview/${this.stem(material)}.vmt`;
    for (const name of this.materialNames()) {
      const m = this.data.materials[name] ?? blankPropMaterial();
      const take = (p: string): TextureData | undefined => { const image = p ? this.image(p) : null; return image ? { width: image.width, height: image.height, rgba: image.rgba } : undefined; };
      const textures = { base: take(m.color), bump: take(m.normal), exponent: take(m.phongexponent), illum: m.settings.selfIllum ? take(m.illum) : undefined };
      const text = propVmt(this.data.folder, this.stem(name), { color: !!textures.base, normal: !!textures.bump, phongexponent: !!textures.exponent, illum: !!textures.illum }, m.settings, this.data.surfaceprop);
      materials.set(materialPath(name), buildPreviewMaterial(materialPath(name), parseKv(text), textures));
    }
    return { data: propPreviewData(model, path, materialPath), materials };
  }

  /** What the native side needs to build the prop. Throws when something is missing; `issues` is what the interface shows before this. */
  request(): PropBuildRequest {
    const d = this.data;
    const lods: PropBuildRequest["lods"] = [];
    for (let i = 0; i < PROP_NUM_LODS; i++) {
      const model = this.model(i);
      if (!model) continue;
      const stem = (material: string) => this.stem(material);
      const flexed = !!model.flexes?.length;
      lods.push({
        sourcePath: d.lods[i],
        smd: flexed ? "" : writeSmd(model, stem, PROP_BONE),
        ...(flexed ? { dmx: Array.from(writeDmx(model, stem, PROP_BONE)) } : {}),
        triangles: model.triangles, vertices: model.vertices,
      });
    }
    if (!lods.length) throw new Error("The prop has no model.");
    const collision = this.collisionModel();
    if (d.collision !== "none" && !collision) throw new Error("The collision model could not be made.");
    const materials = this.materialNames().map((name): PropBuildRequest["materials"][number] => {
      const m = d.materials[name] ?? blankPropMaterial();
      const stem = this.stem(name);
      return {
        name: stem,
        vmt: propVmt(d.folder, stem, { color: !!m.color, normal: !!m.normal, phongexponent: !!m.phongexponent, illum: !!m.illum && m.settings.selfIllum }, m.settings, d.surfaceprop),
        color: m.color || null, normal: m.normal || null, phongexponent: m.phongexponent || null, illum: m.illum && m.settings.selfIllum ? m.illum : null,
        compression: d.compression,
      };
    });
    return { name: d.name, folder: d.folder, surfaceprop: d.surfaceprop, mass: d.mass, staticProp: d.staticProp, collision, concave: d.concave, lods, materials, maxTexture: d.maxTexture, compression: d.compression, qcExtra: "", outDir: d.outDir, session: this.sessionText() };
  }

  /** The text of the file that opens this prop again (written beside the models folder when it is built): the data, with its source paths. */
  sessionText(): string {
    return JSON.stringify({ app: "tf2-workbench", kind: "prop", version: 1, prop: this.toJSON() }, null, 2);
  }

  /** The prop in a session file's text; throws when the text is something else. */
  static readSession(text: string): unknown {
    let raw: { app?: unknown; kind?: unknown; prop?: unknown } | null = null;
    try { raw = JSON.parse(text); } catch { /* not JSON */ }
    if (!raw || raw.app !== "tf2-workbench" || raw.kind !== "prop" || !raw.prop || typeof raw.prop !== "object") throw new Error("This is not a prop session file (<name>.prop.txt).");
    return raw.prop;
  }

  // --- saving -------------------------------------------------------------------------------------------------------------------------

  toJSON(): PropData { return JSON.parse(JSON.stringify(this.data)); }

  /** Replaces the data with a saved one (what is malformed falls back to blanks); call `loadAll` to read its files. */
  restore(saved: unknown) {
    const blank = blankPropData();
    const s = (saved && typeof saved === "object" ? saved : {}) as Partial<PropData>;
    const str = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);
    const lods = Array.isArray(s.lods) ? s.lods : [];
    this.data = {
      name: str(s.name, ""), folder: str(s.folder, blank.folder), surfaceprop: str(s.surfaceprop, blank.surfaceprop),
      mass: typeof s.mass === "number" && Number.isFinite(s.mass) ? s.mass : blank.mass, staticProp: s.staticProp === true,
      collision: s.collision === "none" || s.collision === "box" || s.collision === "file" || s.collision === "hull" ? s.collision : blank.collision,
      collisionFile: str(s.collisionFile, ""), concave: s.concave === true, lods: [0, 1, 2].map((i) => str(lods[i], "")) as [string, string, string],
      materials: {}, maxTexture: (PROP_TEXTURE_LIMITS as readonly number[]).includes(s.maxTexture as number) ? (s.maxTexture as number) : blank.maxTexture,
      compression: s.compression === "none" || (s.compression === undefined && Object.values(s.materials ?? {}).some((m) => (m as { compression?: unknown } | null)?.compression === "none")) ? "none" : "dxt",
      outDir: str(s.outDir, ""), smartFill: s.smartFill !== false,
    };
    for (const [name, raw] of Object.entries(s.materials ?? {})) {
      const m = raw as Partial<PropMaterial> | null;
      const material = blankPropMaterial();
      if (m && typeof m === "object") {
        for (const k of ["color", "normal", "phongexponent", "illum"] as const) material[k] = str(m[k], "");
        const set = (m.settings ?? {}) as Partial<PropMaterialSettings>;
        material.settings = { ...DEFAULT_PROP_MATERIAL, ...Object.fromEntries(Object.entries(set).filter(([k, v]) => k in DEFAULT_PROP_MATERIAL && typeof v === typeof (DEFAULT_PROP_MATERIAL as Record<string, unknown>)[k])), customProxies: sanitizeProxies(set.customProxies) };
      }
      this.data.materials[name] = material;
    }
    this.models.fill(null);
    this.images.clear();
    this.collisionText = null;
    this.failures.clear();
    this.auto.clear();
    this.onChange();
  }
}
