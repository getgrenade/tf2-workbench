import * as THREE from "three";
import type { ImportedModel } from "./fbx";
import { turnedWorld, type BoneTurn } from "./boneAxes";
import { usedBones } from "./smd";

/**
 * Writes an imported model as a binary Datamodel file (.dmx, encoding 2, the one the game's own exporter writes). An .smd cannot carry the
 * shape keys of a model, a .dmx can: the compiler writes the model this way when it has flexes. The structure is the one Valve's
 * `dmfbxserializer` writes for a flexed item (a_2matflexedmonkey): a skeleton of DmeJoint under one DmeDag, one DmeMesh with a DmeFaceSet for
 * each material, a DmeVertexDeltaData for each shape key and a DmeCombinationOperator with the sliders that drive them, which is how
 * studiomdl makes the model's flex controllers without a word of QC.
 */

/** The attribute types of the binary encoding (arrays are `type + 14`). */
const T = { element: 1, int: 2, float: 3, bool: 4, string: 5, vec2: 9, vec3: 10, quat: 13 } as const;
const ARRAY = 14;

interface Attr { name: string; type: number; value: unknown }
interface Elem { type: string; name: string; attrs: Attr[] }

const el = (type: string, name: string, attrs: Attr[] = []): Elem => ({ type, name, attrs });
const a = (name: string, type: number, value: unknown): Attr => ({ name, type, value });
const refs = (name: string, list: Elem[]) => a(name, T.element + ARRAY, list);

/** The bytes of a Datamodel graph: `elements[0]` is the root. */
export function encodeDmx(elements: Elem[]): Uint8Array {
  const strings: string[] = [];
  const known = new Map<string, number>();
  const index = (s: string) => { let i = known.get(s); if (i === undefined) { i = strings.length; known.set(s, i); strings.push(s); } return i; };
  const body: number[] = [];
  const u8 = (v: number) => { body.push(v & 255); };
  const i16 = (v: number) => { u8(v); u8(v >> 8); };
  const i32 = (v: number) => { i16(v); i16(v >> 16); };
  const f32 = (v: number) => { body.push(...new Uint8Array(new Float32Array([v]).buffer)); };
  const encoder = new TextEncoder();
  const cstr = (s: string) => { body.push(...encoder.encode(s), 0); };
  const slot = new Map(elements.map((e, i) => [e, i]));
  i32(elements.length);
  elements.forEach((e, n) => {
    i16(index(e.type));
    cstr(e.name);
    // an id of its own for every element (a counter spread over the 16 bytes)
    for (let k = 0; k < 16; k++) u8(k < 4 ? (n + 1) >> (8 * k) : 0x5a ^ k);
  });
  const scalar = (type: number, v: unknown) => {
    switch (type) {
      case T.element: i32(v ? slot.get(v as Elem) ?? -1 : -1); break;
      case T.int: i32(v as number); break;
      case T.float: f32(v as number); break;
      case T.bool: u8(v ? 1 : 0); break;
      case T.string: cstr(v as string); break;
      default: for (const x of v as number[]) f32(x);
    }
  };
  for (const e of elements) {
    i32(e.attrs.length);
    for (const at of e.attrs) {
      i16(index(at.name));
      u8(at.type);
      if (at.type > ARRAY) {
        const list = at.value as unknown[];
        i32(list.length);
        for (const x of list) scalar(at.type - ARRAY, x);
      } else scalar(at.type, at.value);
    }
  }
  const head = encoder.encode("<!-- dmx encoding binary 2 format model 1 -->\n\0");
  const table: number[] = [strings.length & 255, strings.length >> 8];
  for (const s of strings) table.push(...encoder.encode(s), 0);
  const out = new Uint8Array(head.length + table.length + body.length);
  out.set(head);
  out.set(table, head.length);
  out.set(body, head.length + table.length);
  return out;
}

/** A DmeTransform with the position and orientation of a matrix. */
function transformOf(name: string, m: THREE.Matrix4): Elem {
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  m.decompose(p, q, s);
  return el("DmeTransform", name, [a("position", T.vec3, [p.x, p.y, p.z]), a("orientation", T.quat, [q.x, q.y, q.z, q.w])]);
}

/** Keeps the three strongest of a vertex's bones, as studiomdl does, and renormalises them. */
function strongest(weights: Float32Array, indices: Uint16Array, v: number): [number, number][] {
  const list: [number, number][] = [];
  for (let k = 0; k < 4; k++) if (weights[v * 4 + k] > 1e-5) list.push([indices[v * 4 + k], weights[v * 4 + k]]);
  list.sort((x, y) => y[1] - x[1]);
  const top = list.slice(0, 3);
  const total = top.reduce((t, s) => t + s[1], 0) || 1;
  return top.map(([b, w]) => [b, w / total]);
}

/**
 * The .dmx of a model. `materialName` is the name of a part's material (without a folder: the QC's $cdmaterials says where, as for an .smd); `fallbackBone` is the
 * bone a mesh with no skin follows; `turns` gives bones other axes (see boneAxes.ts), as writeSmd takes them.
 */
export function writeDmx(model: ImportedModel, materialName: (material: string) => string, fallbackBone = "bip_head", turns: Record<string, BoneTurn> = {}): Uint8Array {
  const { ordered, byName } = usedBones(model, model.parts);
  const names = ordered.length ? ordered : [fallbackBone];
  const world = new Map(names.map((n) => [n, turnedWorld(new THREE.Matrix4().fromArray(byName.get(n)?.world ?? new THREE.Matrix4().toArray()), turns[n])]));
  const parentOf = (n: string) => { const p = byName.get(n)?.parent; return p && world.has(p) ? p : null; };

  const transforms: Elem[] = [];
  const bind: Elem[] = [];
  const dagTransform = (name: string, m: THREE.Matrix4) => { const t = transformOf(name, m); transforms.push(t); bind.push(transformOf(name, m)); return t; };
  const identity = new THREE.Matrix4();
  const armature = el("DmeDag", "root");
  armature.attrs.push(a("transform", T.element, dagTransform("root", identity)), a("shape", T.element, null), a("visible", T.bool, true));
  const joints = new Map<string, Elem>();
  const jointIndex = new Map<string, number>();
  for (const name of names) {
    const parent = parentOf(name);
    const local = parent ? new THREE.Matrix4().copy(world.get(parent)!).invert().multiply(world.get(name)!) : world.get(name)!;
    const joint = el("DmeJoint", name);
    jointIndex.set(name, transforms.length);
    joint.attrs.push(a("transform", T.element, dagTransform(name, local)), a("shape", T.element, null), a("visible", T.bool, true), refs("children", []));
    joints.set(name, joint);
  }
  const childrenOf = (parent: Elem | null, parentName: string | null) => {
    const kids = names.filter((n) => parentOf(n) === parentName).map((n) => joints.get(n)!);
    (parent ?? armature).attrs.push(...(parent ? [] : [refs("children", kids)]));
    if (parent) parent.attrs.find((x) => x.name === "children")!.value = kids;
    return kids;
  };
  childrenOf(null, null);
  for (const name of names) childrenOf(joints.get(name)!, name);

  // one mesh: the vertices of every part one after the other, a face set for each part
  const fallback = jointIndex.get(fallbackBone) ?? 1;
  const positions: number[][] = [], normals: number[][] = [], uvs: number[][] = [], weights: number[] = [], joint: number[] = [];
  const sets: Elem[] = [];
  const base: number[] = [];
  for (const part of model.parts) {
    const start = positions.length;
    base.push(start);
    const count = part.positions.length / 3;
    for (let v = 0; v < count; v++) {
      positions.push([part.positions[v * 3], part.positions[v * 3 + 1], part.positions[v * 3 + 2]]);
      normals.push([part.normals[v * 3], part.normals[v * 3 + 1], part.normals[v * 3 + 2]]);
      // the file's texture coordinates run up from the bottom, as an .smd's do
      uvs.push([part.uvs[v * 2], 1 - part.uvs[v * 2 + 1]]);
      const skin = strongest(part.skinWeights, part.skinIndices, v).map(([b, w]): [number, number] => [jointIndex.get(part.boneNames[b] ?? "") ?? fallback, w]);
      if (!skin.length) skin.push([fallback, 1]);
      for (let k = 0; k < 3; k++) { weights.push(skin[k]?.[1] ?? 0); joint.push(skin[k]?.[0] ?? -1); }
    }
    const faces: number[] = [];
    for (let t = 0; t < part.indices.length; t += 3) faces.push(start + part.indices[t], start + part.indices[t + 1], start + part.indices[t + 2], -1);
    const material = el("DmeMaterial", part.material, [a("mtlName", T.string, materialName(part.material))]);
    sets.push(el("DmeFaceSet", part.material, [a("faces", T.int + ARRAY, faces), a("material", T.element, material)]));
  }
  const identityIndices = positions.map((_, i) => i);
  const data = el("DmeVertexData", "bind", [
    a("vertexFormat", T.string + ARRAY, ["positions", "textureCoordinates", "normals", "jointWeights", "jointIndices"]),
    a("jointCount", T.int, 3), a("flipVCoordinates", T.bool, true),
    a("positions", T.vec3 + ARRAY, positions), a("positionsIndices", T.int + ARRAY, identityIndices),
    a("textureCoordinates", T.vec2 + ARRAY, uvs), a("textureCoordinatesIndices", T.int + ARRAY, identityIndices),
    a("normals", T.vec3 + ARRAY, normals), a("normalsIndices", T.int + ARRAY, identityIndices),
    a("jointWeights", T.float + ARRAY, weights), a("jointIndices", T.int + ARRAY, joint),
  ]);
  // a shape key moves vertices of the parts; the mesh has them numbered one after the other
  const flexes = model.flexes ?? [];
  const deltaStates = flexes.map((flex) => {
    const at: number[] = [], moves: number[][] = [];
    flex.vertex.forEach((v, i) => { at.push(base[flex.part[i]] + v); moves.push([flex.delta[i * 3], flex.delta[i * 3 + 1], flex.delta[i * 3 + 2]]); });
    // a state with no moves still lists one (a zero one), as the game's exporter does
    if (!at.length) { at.push(0); moves.push([0, 0, 0]); }
    return el("DmeVertexDeltaData", flex.name, [
      a("vertexFormat", T.string + ARRAY, ["positions"]), a("jointCount", T.int, 0), a("flipVCoordinates", T.bool, true), a("corrected", T.bool, true),
      a("positions", T.vec3 + ARRAY, moves), a("positionsIndices", T.int + ARRAY, at),
    ]);
  });
  const mesh = el("DmeMesh", "mesh", [
    a("visible", T.bool, true), a("bindState", T.element, null), a("currentState", T.element, data), refs("baseStates", [data]),
    refs("deltaStates", deltaStates), refs("faceSets", sets),
    a("deltaStateWeights", T.vec2 + ARRAY, deltaStates.map(() => [0, 0])), a("deltaStateWeightsLagged", T.vec2 + ARRAY, deltaStates.map(() => [0, 0])),
  ]);
  const meshDag = el("DmeDag", "mesh", [a("transform", T.element, dagTransform("mesh", identity)), a("shape", T.element, mesh), a("visible", T.bool, true), refs("children", [])]);

  const modelTransform = transformOf("model", identity);
  const modelEl = el("DmeModel", "model", [
    a("transform", T.element, modelTransform), a("shape", T.element, null), a("visible", T.bool, true),
    refs("children", [armature, meshDag]), refs("jointTransforms", transforms), refs("baseStates", [el("DmeTransformList", "bind", [refs("transforms", bind)])]),
  ]);
  const root = el("DmElement", "root", [a("skeleton", T.element, modelEl), a("model", T.element, modelEl)]);

  const all: Elem[] = [root, modelEl, modelTransform, armature, ...joints.values(), meshDag, mesh, data, ...sets, ...deltaStates];
  // the sliders of the shape keys
  if (flexes.length) {
    const controls = (model.flexControls?.length ? model.flexControls : flexes.map((f) => ({ name: f.name, raw: [f.name], stereo: false, eyelid: false, wrinkle: [0] }))).map((c) =>
      el("DmeCombinationInputControl", c.name, [a("rawControlNames", T.string + ARRAY, c.raw), a("stereo", T.bool, c.stereo), a("eyelid", T.bool, c.eyelid), a("wrinkleScales", T.float + ARRAY, c.wrinkle.length ? c.wrinkle : c.raw.map(() => 0))]));
    const operator = el("DmeCombinationOperator", "combinationOperator", [
      refs("controls", controls), a("controlValues", T.vec3 + ARRAY, controls.map(() => [0, 0.5, 0.5])), a("controlValuesLagged", T.vec3 + ARRAY, controls.map(() => [0, 0.5, 0.5])),
      a("usesLaggedValues", T.bool, false), refs("dominators", []), refs("targets", [mesh]),
    ]);
    root.attrs.push(a("combinationOperator", T.element, operator));
    all.push(operator, ...controls);
  }
  // every element the graph refers to, once
  const seen = new Set<Elem>();
  const reach = (e: Elem) => {
    if (seen.has(e)) return;
    seen.add(e);
    for (const at of e.attrs) {
      if (at.type === T.element && at.value) reach(at.value as Elem);
      else if (at.type === T.element + ARRAY) for (const x of at.value as Elem[]) reach(x);
    }
  };
  reach(root);
  return encodeDmx([...seen, ...all.filter((e) => !seen.has(e))].filter((e, i, list) => list.indexOf(e) === i));
}
