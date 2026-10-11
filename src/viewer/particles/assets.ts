import * as THREE from "three";
import { loadMaterial, loadParticleAsset, listUnusualEffects, listCustomEffects, type CustomEffectInfo, type UnusualEffectInfo } from "../../api";
import { parseMaterial, type MaterialData, type TextureData } from "../payload";
import { parsePcf, particleDefinitions, type ParticleDefinition } from "./pcf";

export const UNUSUALS = {
  silver: { label: "Silver Serenade", file: "particles/smissmas2022_unusuals.pcf", system: "unusual_sheetmusic_silver_parent" },
  arctic: { label: "Arctic Delight", file: "particles/smissmas2023_unusuals.pcf", system: "utaunt_innerblizzard_purple_parent" },
} as const;
export type UnusualId = keyof typeof UNUSUALS;
export interface UnusualSettings { silver: boolean; arctic: boolean; hatItem: number | null; hatEffect?: number; tauntEffect?: number }
export const blankUnusuals = (): UnusualSettings => ({ silver: false, arctic: false, hatItem: null });
export function parseUnusualSettings(value: unknown): UnusualSettings {
  const v = value as Partial<UnusualSettings> | null;
  return { silver: v?.silver === true, arctic: v?.arctic === true, hatItem: Number.isInteger(v?.hatItem) ? v!.hatItem! : null,
    ...(Number.isInteger(v?.hatEffect) && v!.hatEffect! > 0 ? { hatEffect: v!.hatEffect } : {}),
    ...(Number.isInteger(v?.tauntEffect) && v!.tauntEffect! > 0 ? { tauntEffect: v!.tauntEffect } : {}) };
}
let catalog: Promise<UnusualEffectInfo[]> | null = null;
let customZips: CustomEffectInfo[] = [];
/** The custom effect zips the catalog was last made from. */
export const customEffectZips = () => customZips;
/** An id for a custom effect that stays the same between runs (and cannot meet the game's own ids, which are small). */
export function customEffectId(zip: string, system: string): number {
  let h = 0x811c9dc5;
  for (const c of `${zip.toLowerCase()}/${system.toLowerCase()}`) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
  return 0x40000000 + (h % 0x3fffffff);
}
/** "unusual_spellbook_parent" -> "Unusual spellbook". */
export function customEffectName(system: string): string {
  const words = system.replace(/_(parent|teamcolor_red|teamcolor_blue)$/i, "").replace(/[_-]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : system;
}
/** The effects of the custom zips: the particle systems no other system of their file has as a child, offered as hat and as taunt effects. */
async function customCatalog(zips: CustomEffectInfo[]): Promise<UnusualEffectInfo[]> {
  const out: UnusualEffectInfo[] = [];
  for (const zip of zips) {
    for (const pcf of zip.pcfs) {
      let definitions: Map<string, ParticleDefinition>;
      try { definitions = await loadDefinitions(pcf.file); } catch (e) { console.error(`Custom effect ${zip.name}: ${pcf.file}`, e); continue; }
      const children = new Set<string>();
      for (const d of definitions.values()) for (const c of d.children ?? []) children.add(c.name);
      for (const system of pcf.systems) {
        if (children.has(system) || !definitions.has(system)) continue;
        for (const kind of ["hat", "taunt"] as const)
          out.push({ id: customEffectId(zip.name, system), name: customEffectName(system), system, kind, file: pcf.file, attachment: "", root_bone: false, refire: 0, custom: zip.name, added: zip.added });
      }
    }
  }
  return out;
}
const cachedDefinitions = new Map<string, Map<string, ParticleDefinition>>();
const cachedMaterials = new Map<string, ParticleMaterial>();
const cachedModels = new Map<string, ParticleModelInfo>();
export function particleCacheData(): unknown[] {
  return [cachedDefinitions, cachedModels, ...[...cachedMaterials.values()].map((material) => ({ sheet: material.sheet, image: material.texture.image }))];
}
export function particleCacheTextures(): THREE.Texture[] { return [...cachedMaterials.values()].map((material) => material.texture); }
export function loadUnusualCatalog(refresh = false) {
  if (refresh) { catalog = null; definitions.clear(); materials.clear(); models.clear(); cachedDefinitions.clear(); cachedMaterials.clear(); cachedModels.clear(); }
  return catalog ??= (async () => {
    const [official, zips] = await Promise.all([listUnusualEffects(), listCustomEffects().catch(() => [] as CustomEffectInfo[])]);
    customZips = zips;
    return [...await customCatalog(zips), ...official];
  })().catch((e) => { catalog = null; throw e; });
}
export function particleSystemForTeam(system: string, team: number): string {
  return team === 1 ? system.replace("_teamcolor_red", "_teamcolor_blue") : system.replace("_teamcolor_blue", "_teamcolor_red");
}
const definitions = new Map<string, Promise<Map<string, ParticleDefinition>>>();
export function loadDefinitions(id: UnusualId | string) {
  const path = id in UNUSUALS ? UNUSUALS[id as UnusualId].file : id;
  let promise = definitions.get(path);
  if (!promise) {
    promise = loadParticleAsset(path).then(parsePcf).then(particleDefinitions).catch((e) => { definitions.delete(path); throw e; });
    definitions.set(path, promise);
    void promise.then((data) => { if (definitions.get(path) === promise) cachedDefinitions.set(path, data); }, () => {});
  }
  return promise;
}

import { parseSheet, type SheetFrame, type SheetSequence } from "./sheet";
export { parseSheet };
export type { SheetFrame, SheetSequence };

/** A Refract material: what is behind the particle is drawn again, moved by a normal map (`texture` is that normal map). */
export interface ParticleRefraction { amount: number; tint: [number, number, number]; }
export interface ParticleMaterial { texture: THREE.DataTexture; sheet: Map<number, SheetSequence>; additive: boolean; refract?: ParticleRefraction; orientation?: number; blendFrames?: boolean; overbright?: number; addSelf?: number; depthBlend?: boolean; depthBlendScale?: number; srgb?: boolean; vertexColor?: boolean; vertexAlpha?: boolean }

/** UnlitGeneric binds Source's standard white texture when no base texture or envmap is authored. */
export function particleBaseImage(data: MaterialData): TextureData {
  if (data.textures.base) return data.textures.base;
  if (data.shader.toLowerCase() === "refract" && data.textures.bump) return data.textures.bump;
  if (data.shader.toLowerCase() === "unlitgeneric" && !data.params["$basetexture"] && !data.params["$envmap"] && !data.errors.length)
    return { width: 1, height: 1, rgba: new Uint8Array([255, 255, 255, 255]) };
  throw new Error(`Particle material ${data.path}: ${data.errors.join(", ") || "missing texture"}`);
}
/** The preview uses Source's DX9 sRGB path, including its conditional material parameters. */
export function particleMaterialSettings(shader: string, input: Record<string, string>) {
  const params = { ...input };
  for (const [key, value] of Object.entries(input)) if (key.startsWith("srgb?")) params[key.slice(5)] = value;
  const spriteCard = shader.toLowerCase().startsWith("spritecard");
  const sprite = /^sprite(?:_dx[689])?$/.test(shader.toLowerCase());
  const refract = shader.toLowerCase() === "refract";
  // Sprite_DX9 defaults NOSRGB to 1. The SDK's sprite_dx9.cpp also defaults IGNOREVERTEXCOLORS to 1, which would leave the additive beams
  // (the chains of Cursed Confinement, the arcs of the electric taunts) white, but the game tints them with the colour of the particle: vertex
  // colour and alpha are used unless a material asks to ignore them.
  const vertexColor = !sprite || Number(params["$ignorevertexcolors"] ?? 0) === 0;
  const tint = parseTint(params["$refracttint"]);
  return { additive: particleAdditive(params), blendFrames: (spriteCard || refract) && params["$blendframes"] !== "0",
    ...(refract ? { refract: { amount: Number(params["$refractamount"] ?? 2) || 0, tint } } : {}),
    srgb: sprite ? Number(params["$nosrgb"] ?? 1) === 0 : !refract, vertexColor, vertexAlpha: vertexColor,
    overbright: sprite ? Number(params["$hdrcolorscale"] ?? 1) : Number(params["$overbrightfactor"] ?? 1), addSelf: spriteCard ? Number(params["$addself"] ?? 0) : 0,
    depthBlend: spriteCard && Number(params["$depthblend"] ?? 1) !== 0,
    depthBlendScale: Math.max(.001, Number(params["$depthblendscale"] ?? 50)) };
}
/** A VMT colour as three 0..1 numbers: "{205 225 255}" is 0..255, "[1 .5 0]" is 0..1, missing is white. */
function parseTint(value: string | undefined): [number, number, number] {
  const nums = (value ?? "").replace(/[[\]{}]/g, " ").trim().split(/\s+/).map(Number);
  if (nums.length < 3 || nums.slice(0, 3).some((n) => !Number.isFinite(n))) return [1, 1, 1];
  const scale = (value ?? "").includes("{") ? 255 : 1;
  return [nums[0] / scale, nums[1] / scale, nums[2] / scale];
}
/** Sprite materials select blending by RenderMode_t, not only by $additive. */
export function particleAdditive(params: Record<string, string>): boolean {
  const mode = Number(params["$spriterendermode"] ?? 0);
  return Number(params["$additive"] ?? 0) !== 0 || mode === 3 || mode === 5 || mode === 9;
}
const materials = new Map<string, Promise<ParticleMaterial>>();
export function loadParticleMaterial(path: string): Promise<ParticleMaterial> {
  path = path.replace(/\\/g, "/").toLowerCase().replace(/^materials\//, "").replace(/\.vmt$/, "");
  let pending = materials.get(path);
  if (!pending) {
    const key = path;
    pending = (async () => {
      const data = parseMaterial(await loadMaterial(`materials/${key}.vmt`));
      const base = particleBaseImage(data);
      const settings = particleMaterialSettings(data.shader, data.params);
      const texture = new THREE.DataTexture(base.rgba, base.width, base.height, THREE.RGBAFormat);
      // Source particle tint is applied in the shader; texture reads decode sRGB into linear light.
      texture.colorSpace = settings.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearFilter;
      texture.wrapS = THREE.ClampToEdgeWrapping; texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.needsUpdate = true;
      const texturePath = (data.params["$basetexture"] ?? (data.shader.toLowerCase() === "refract" ? data.params["$normalmap"] : undefined))?.replace(/\\/g, "/").replace(/\.vtf$/i, "");
      try {
        const sheet = texturePath ? parseSheet(await loadParticleAsset(`materials/${texturePath}.vtf`)) : new Map<number, SheetSequence>();
        return { texture, sheet, orientation: Number(data.params["$orientation"] ?? 0), ...settings };
      } catch (err) { texture.dispose(); throw err; }
    })().catch((e) => { materials.delete(key); throw e; });
    materials.set(path, pending);
    void pending.then((data) => { if (materials.get(path) === pending) cachedMaterials.set(path, data); }, () => {});
  }
  return pending;
}

export interface ParticleModelInfo {
  attachments: { name: string; bone: number; local: THREE.Matrix4 }[];
  hitboxes: { bone: number; min: THREE.Vector3; max: THREE.Vector3 }[];
  /** The model's keyvalues ask for a blood decal where it touches the world (`world_interactions { onworldimpact bloodsplat }`). */
  bloodSplat?: boolean;
}
/** Whether the bytes contain an ASCII word (the keyvalues of an MDL are plain text inside the file). */
export function containsAscii(bytes: Uint8Array, word: string): boolean {
  const first = word.charCodeAt(0);
  for (let i = bytes.indexOf(first); i >= 0 && i + word.length <= bytes.length; i = bytes.indexOf(first, i + 1)) {
    let k = 1;
    while (k < word.length && bytes[i + k] === word.charCodeAt(k)) k++;
    if (k === word.length) return true;
  }
  return false;
}
export function parseParticleModel(buffer: ArrayBuffer): ParticleModelInfo {
  const v = new DataView(buffer), bytes = new Uint8Array(buffer);
  const i32 = (at: number) => v.getInt32(at, true);
  const vec = (at: number) => new THREE.Vector3(v.getFloat32(at, true), v.getFloat32(at + 4, true), v.getFloat32(at + 8, true));
  if (v.byteLength < 248 || i32(0) !== 0x54534449 || (i32(4) < 44 || i32(4) > 48)) throw new Error("Unsupported particle attachment model");
  const count = (n: number) => { if (n < 0 || n > 1024) throw new Error("Invalid MDL particle metadata count"); return n; };
  const attachments = Array.from({ length: count(i32(240)) }, (_, i) => {
    const at = i32(244) + i * 92, nameAt = at + i32(at), end = bytes.indexOf(0, nameAt);
    if (nameAt < 0 || end < nameAt) throw new Error("Invalid MDL attachment name");
    const f = (index: number) => v.getFloat32(at + 12 + index * 4, true);
    return { name: new TextDecoder().decode(bytes.subarray(nameAt, end)), bone: i32(at + 8), local: new THREE.Matrix4().set(f(0), f(1), f(2), f(3), f(4), f(5), f(6), f(7), f(8), f(9), f(10), f(11), 0, 0, 0, 1) };
  });
  const hitboxes: ParticleModelInfo["hitboxes"] = [];
  // The game uses the active hitbox set; normal character previews use set 0.
  if (count(i32(172)) > 0) {
    const set = i32(176), num = count(i32(set + 4)), start = set + i32(set + 8);
    for (let i = 0; i < num; i++) { const at = start + i * 68; hitboxes.push({ bone: i32(at), min: vec(at + 8), max: vec(at + 20) }); }
  }
  return { attachments, hitboxes, bloodSplat: containsAscii(bytes, "bloodsplat") };
}
const models = new Map<string, Promise<ParticleModelInfo>>();
export function loadParticleModel(path: string) {
  let pending = models.get(path);
  if (!pending) {
    pending = loadParticleAsset(path).then(parseParticleModel).catch((e) => { models.delete(path); throw e; }); models.set(path, pending);
    void pending.then((data) => { if (models.get(path) === pending) cachedModels.set(path, data); }, () => {});
  }
  return pending;
}
