import type { BodyPartData, BoneData, FlexControllerData, FlexRuleData, MaterialData, MeshData, MeshFlexData, ModelData, TextureData } from "../viewer/payload";
import { computeTangents, flipWinding, windingSign } from "./mesh";
import type { ImportedModel, ImportedPart } from "./fbx";
import { flattenVmt } from "./vmt";
import type { KvNode } from "./kv";
import * as THREE from "three";
import { turnedWorld, type BoneTurn } from "./boneAxes";
import { jiggleParams, type JiggleSetup } from "./jiggleBones";

/**
 * Turns what the compiler has been given into what the viewer draws, with no compile in between: the imported meshes become a
 * cosmetic that follows the class's own skeleton (exactly what the game does with an item's bones that share the class's names), and
 * the textures and settings become the same kind of material a VMT from the game's files becomes.
 */

/** The bone a mesh with no skin of its own (or with a bone the class lacks and no ancestor to stand in) follows. */
export const FALLBACK_BONE = "bip_head";

/** A bone the item brings that the class does not have, for the jiggle bone editor. */
export interface PreviewBone {
  name: string;
  parent: string | null;
  /** The bone's bind transform with its axes as set (column-major 4x4, the Y-up frame of the item). */
  world: number[];
}

/** What the artist has set on the bones the item brings: spring physics, and other axes. */
export interface PreviewBones {
  jiggles: Record<string, JiggleSetup>;
  turns: Record<string, BoneTurn>;
}

export interface PreviewMesh {
  data: ModelData;
  /** The bones that carry weight in the item and are not the class's (what the importer limits). */
  customBones: string[];
  /** Those bones and the item's other bones above them, parents first: the item's own skeleton. They are bones of their own in the preview, as in the compiled model. */
  skeleton: PreviewBone[];
}

/** How a part's bone names resolve to bones of the class. */
export function resolveBones(names: string[], skeleton: { name: string; parent: string | null }[], classBones: BoneData[], fallback = FALLBACK_BONE, own: Map<string, number> = new Map()): number[] {
  const classIndex = new Map(classBones.map((b, i) => [b.name.toLowerCase(), i]));
  for (const [name, i] of own) classIndex.set(name, i);
  const parent = new Map(skeleton.map((b) => [b.name.toLowerCase(), b.parent?.toLowerCase() ?? null]));
  const fallbackIndex = classIndex.get(fallback) ?? 0;
  return names.map((name) => {
    let n: string | null = name.toLowerCase();
    for (let guard = 0; n && guard < 256; guard++) {
      const i = classIndex.get(n);
      if (i !== undefined) return i;
      n = parent.get(n) ?? null;
    }
    return fallbackIndex;
  });
}

/** The names of the bones that carry weight in the item and are not part of the class (what the importer limits). */
export function customBoneNames(imported: ImportedModel, classBones: BoneData[]): string[] {
  const classNames = new Set(classBones.map((b) => b.name.toLowerCase()));
  const used = new Set<string>();
  for (const part of imported.parts) {
    const seen = new Set<number>();
    for (let v = 0; v < part.skinIndices.length; v++) if (part.skinWeights[v] > 1e-5) seen.add(part.skinIndices[v]);
    for (const i of seen) {
      const name = part.boneNames[i];
      if (name && !classNames.has(name.toLowerCase())) used.add(name);
    }
  }
  return [...used];
}

/** The winding the game's own meshes of this model have, to bring an imported mesh to the same. */
export function referenceWinding(classData: ModelData): number {
  for (const part of classData.bodyParts) {
    for (const mesh of part.models[0]?.meshes ?? []) if (mesh.indices.length >= 3) return windingSign(mesh);
  }
  return 1;
}

export function buildPreviewModel(imported: ImportedModel, classData: ModelData, path: string, materialPaths: (material: string) => [string, string], set: PreviewBones = { jiggles: {}, turns: {} }): PreviewMesh {
  const reference = referenceWinding(classData);
  const customBones = customBoneNames(imported, classData.bones);
  const { skeleton, bones: ownBones, index: own } = itemSkeleton(imported, classData, customBones, set);
  const meshes: MeshData[] = imported.parts.map((part, i) => ({ ...previewMesh(part, imported, classData, materialPaths(part.material), reference, own), flexes: previewFlexes(imported, i) }));
  const flex = previewFlexRules(imported);
  const body: BodyPartData = { name: "item", models: [{ name: "item", meshes, eyeballs: [] }] };
  return {
    data: {
      path,
      flexDescCount: imported.flexes?.length ?? 0,
      flexControllers: flex.controllers,
      flexRules: flex.rules,
      skinCount: 2,
      eyeAttachment: null,
      bones: [...classData.bones, ...ownBones],
      includeModels: [],
      bodyParts: [body],
      lod: 0,
      lodCount: 1,
    },
    customBones,
    skeleton,
  };
}

/** The item's own bones (those the class lacks that carry weight, and what is above them up to a class bone), parents first, as bones of the preview. */
function itemSkeleton(imported: ImportedModel, classData: ModelData, weighted: string[], set: PreviewBones) {
  const classNames = new Set(classData.bones.map((b) => b.name.toLowerCase()));
  const byName = new Map(imported.skeleton.map((b) => [b.name.toLowerCase(), b]));
  const keep = new Set<string>();
  for (const name of weighted) {
    for (let n: string | null = name.toLowerCase(); n && byName.has(n) && !classNames.has(n) && !keep.has(n); n = byName.get(n)!.parent?.toLowerCase() ?? null) keep.add(n);
  }
  const ordered: string[] = [];
  const visit = (name: string) => {
    if (ordered.includes(name)) return;
    const parent = byName.get(name)?.parent?.toLowerCase();
    if (parent && keep.has(parent)) visit(parent);
    ordered.push(name);
  };
  for (const b of imported.skeleton) if (keep.has(b.name.toLowerCase())) visit(b.name.toLowerCase());
  const index = new Map<string, number>(classData.bones.map((b, i) => [b.name.toLowerCase(), i]));
  const skeleton: PreviewBone[] = [];
  const bones: BoneData[] = [];
  const m = new THREE.Matrix4(), inverse = new THREE.Matrix4();
  for (const lower of ordered) {
    const b = byName.get(lower)!;
    const parent = b.parent ? index.get(b.parent.toLowerCase()) ?? -1 : -1;
    turnedWorld(m.fromArray(b.world), set.turns[b.name], m);
    inverse.copy(m).invert();
    const e = inverse.elements;
    const poseToBone: number[] = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) poseToBone.push(e[c * 4 + r]);
    const setup = set.jiggles[b.name];
    index.set(lower, classData.bones.length + bones.length);
    bones.push({ name: b.name, parent, poseToBone, jiggle: setup ? jiggleParams(setup) : null });
    skeleton.push({ name: b.name, parent: b.parent, world: m.toArray() });
  }
  return { skeleton, bones, index: new Map([...index].filter(([name]) => !classNames.has(name))) };
}

/** The shape keys of one part as the viewer applies them: one flex descriptor for each (a weight of 1 moves the vertices by the whole delta). */
function previewFlexes(imported: ImportedModel, partIndex: number): MeshFlexData[] {
  const out: MeshFlexData[] = [];
  (imported.flexes ?? []).forEach((flex, desc) => {
    const at: number[] = [];
    flex.part.forEach((p, i) => { if (p === partIndex) at.push(i); });
    if (!at.length) return;
    const vertices = Uint32Array.from(at.map((i) => flex.vertex[i]));
    const deltas = new Float32Array(at.length * 3);
    at.forEach((i, k) => { deltas[k * 3] = flex.delta[i * 3]; deltas[k * 3 + 1] = flex.delta[i * 3 + 1]; deltas[k * 3 + 2] = flex.delta[i * 3 + 2]; });
    out.push({ desc, targets: [0, 1, 1, 2], vertices, deltas, normalDeltas: new Float32Array(at.length * 3) });
  });
  return out;
}

/**
 * The sliders of an item's shape keys and what they do: the slider that names a shape key drives it. The viewer reads sliders by name from the
 * class's face (a slider the class lacks stays at 0), which is how the game's items follow the faces of the classes. A shape key that a
 * combination of sliders drives (studiomdl's combination rules) is not followed in the preview.
 */
function previewFlexRules(imported: ImportedModel): { controllers: FlexControllerData[]; rules: FlexRuleData[] } {
  const controls = imported.flexControls ?? [];
  const FETCH1 = 2;
  const controllers = controls.map((c) => ({ name: c.name, min: 0, max: 1 }));
  const rules: FlexRuleData[] = [];
  (imported.flexes ?? []).forEach((flex, desc) => {
    const c = controls.findIndex((control) => control.raw.length === 1 && control.raw[0] === flex.name);
    if (c >= 0) rules.push({ flex: desc, ops: [[FETCH1, c]] });
  });
  return { controllers, rules };
}

function previewMesh(part: ImportedPart, imported: ImportedModel, classData: ModelData, [red, blue]: [string, string], reference: number, own: Map<string, number>): MeshData {
  const map = resolveBones(part.boneNames, imported.skeleton, classData.bones, FALLBACK_BONE, own);
  const skinIndices = new Uint16Array(part.skinIndices.length);
  for (let i = 0; i < skinIndices.length; i++) skinIndices[i] = part.skinWeights[i] > 0 ? map[part.skinIndices[i]] ?? 0 : 0;
  const indices = Uint32Array.from(part.indices);
  if (part.winding !== reference) flipWinding(indices);
  const arrays = { positions: part.positions, normals: part.normals, uvs: part.uvs, indices };
  return {
    material: red,
    materials: [red, blue],
    flexes: [],
    positions: part.positions,
    normals: part.normals,
    uvs: part.uvs,
    tangents: computeTangents(arrays),
    skinIndices,
    skinWeights: part.skinWeights,
    indices,
  };
}

/** The textures a preview material has, from the artist's files (RGBA, top row first) and the game's light ramp. */
export interface PreviewTextures {
  base?: TextureData;
  bump?: TextureData;
  exponent?: TextureData;
  illum?: TextureData;
  warp?: TextureData;
  /** The six faces of the cubemap the material reflects. */
  env?: TextureData[];
}

export function buildPreviewMaterial(path: string, vmt: KvNode[], textures: PreviewTextures): MaterialData {
  const { shader, params, proxies } = flattenVmt(vmt);
  const slots: Record<string, TextureData> = {};
  for (const [slot, texture] of Object.entries(textures)) if (texture && !Array.isArray(texture)) slots[slot] = texture;
  textures.env?.forEach((face, i) => { slots[`env${i}`] = face; });
  return { path, shader, params, proxies, textures: slots, errors: [] };
}
