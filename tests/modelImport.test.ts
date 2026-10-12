// Run with: node --test "tests/*.test.ts"
import assert from "node:assert/strict";
import { test } from "node:test";
import { importSmd } from "../src/compiler/smdImport.ts";
import { importDmx } from "../src/compiler/dmxImport.ts";
import { writeSmd } from "../src/compiler/smd.ts";
import type { ImportedModel } from "../src/compiler/fbx.ts";

const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

/** Bone "root" at the origin and "arm" 10 up from it (the game's Y-up frame), one triangle skinned half and half. */
function sample(): ImportedModel {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const up = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 10, 0, 1];
  return {
    parts: [{
      material: "hat",
      positions: new Float32Array([0, 0, 0, 5, 0, 0, 0, 5, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2]),
      boneNames: ["root", "arm"],
      skinIndices: new Uint16Array([0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0]),
      skinWeights: new Float32Array([1, 0, 0, 0, 0.5, 0.5, 0, 0, 1, 0, 0, 0]),
      winding: 1,
    }],
    skeleton: [{ name: "root", parent: null, world: identity }, { name: "arm", parent: "root", world: up }],
    materials: ["hat"], triangles: 1, vertices: 3,
    bounds: { min: [0, 0, 0], max: [5, 5, 0] },
    axes: { right: [1, 0, 0], up: [0, 1, 0], front: [0, 0, 1] },
  };
}

test("an .smd the compiler wrote is read back as the same model", () => {
  const model = sample();
  const back = importSmd(bytes(writeSmd(model, (m) => m, "root")), true);
  assert.deepEqual(back.skeleton.map((b) => [b.name, b.parent]), [["root", null], ["arm", "root"]]);
  assert.equal(back.skeleton[1].world[13], 10);
  const part = back.parts[0];
  assert.equal(part.material, "hat");
  assert.deepEqual([...part.positions], [...model.parts[0].positions]);
  assert.deepEqual([...part.uvs], [...model.parts[0].uvs]);
  // the second vertex is half on each bone
  const names = (v: number) => [0, 1, 2, 3].filter((k) => part.skinWeights[v * 4 + k] > 0).map((k) => `${part.boneNames[part.skinIndices[v * 4 + k]]}:${part.skinWeights[v * 4 + k].toFixed(2)}`);
  assert.deepEqual(names(1).sort(), ["arm:0.50", "root:0.50"]);
});

test("an .smd made with Z up is turned to the game's Y up", () => {
  const smd = ["version 1", "nodes", '  0 "root" -1', "end", "skeleton", "time 0", "  0 0 0 0 0 0 0", "end", "triangles", "mat.tga",
    "  0 0 0 10  0 0 1  0 0 1 0 1", "  0 1 0 10  0 0 1  1 0 1 0 1", "  0 0 1 10  0 0 1  0 1 1 0 1", "end", ""].join("\n");
  const m = importSmd(bytes(smd));
  assert.equal(m.parts[0].material, "mat");
  // Source's up (Z) becomes Y, and Source's left (Y) becomes -Z
  assert.deepEqual([...m.parts[0].positions].map((v) => Math.round(v)), [0, 10, -0, 1, 10, -0, 0, 10, -1].map((v) => (v === 0 ? 0 : v)));
  assert.deepEqual([...m.parts[0].normals].slice(0, 3).map((v) => Math.round(v) + 0), [0, 1, 0]);
});

// --- a binary .dmx (encoding 2), built here -----------------------------------------------------------------------------

type Attr = [name: string, type: number, value: unknown];
interface E { type: string; name: string; attrs: Attr[] }

function dmx(elements: E[]): ArrayBuffer {
  const strings: string[] = [];
  const index = (s: string) => { let i = strings.indexOf(s); if (i < 0) { i = strings.length; strings.push(s); } return i; };
  const body: number[] = [];
  const u8 = (v: number) => body.push(v & 255);
  const i16 = (v: number) => { u8(v); u8(v >> 8); };
  const i32 = (v: number) => { i16(v); i16(v >> 16); };
  const f32 = (v: number) => { const b = new Uint8Array(new Float32Array([v]).buffer); body.push(...b); };
  const cstr = (s: string) => { body.push(...new TextEncoder().encode(s), 0); };
  i32(elements.length);
  for (const e of elements) { i16(index(e.type)); cstr(e.name); for (let i = 0; i < 16; i++) u8(0); }
  const scalar = (type: number, v: unknown) => {
    if (type === 1) i32(elements.indexOf(v as E));
    else if (type === 2) i32(v as number);
    else if (type === 3) f32(v as number);
    else if (type === 4) u8(v ? 1 : 0);
    else if (type === 5) cstr(v as string);
    else for (const x of v as number[]) f32(x);
  };
  for (const e of elements) {
    i32(e.attrs.length);
    for (const [name, type, value] of e.attrs) {
      i16(index(name)); u8(type);
      if (type > 14) { const list = value as unknown[]; i32(list.length); for (const x of list) scalar(type - 14, x); } else scalar(type, value);
    }
  }
  const head = new TextEncoder().encode("<!-- dmx encoding binary 2 format model 1 -->\n\0");
  const table: number[] = [];
  table.push(strings.length & 255, strings.length >> 8);
  for (const s of strings) table.push(...new TextEncoder().encode(s), 0);
  const out = new Uint8Array(head.length + table.length + body.length);
  out.set(head); out.set(table, head.length); out.set(body, head.length + table.length);
  return out.buffer;
}

test("a binary .dmx with a joint and a skinned triangle is read", () => {
  const T = { element: 1, int: 2, float: 3, bool: 4, string: 5, vec3: 10, quat: 13 };
  const A = 14; // arrays are the type + 14
  const root: E = { type: "DmElement", name: "root", attrs: [] };
  const model: E = { type: "DmeModel", name: "m", attrs: [] };
  const transform = (name: string, position: number[]): E => ({ type: "DmeTransform", name, attrs: [["position", T.vec3, position], ["orientation", T.quat, [0, 0, 0, 1]]] });
  const boneT = transform("bone", [0, 10, 0]), meshT = transform("mesh", [0, 0, 0]);
  const bone: E = { type: "DmeJoint", name: "bone", attrs: [["transform", T.element, boneT], ["children", T.element + A, []]] };
  const state: E = { type: "DmeVertexData", name: "bind", attrs: [
    ["flipVCoordinates", T.bool, true], ["jointCount", T.int, 1],
    ["positions", T.vec3 + A, [[0, 0, 0], [5, 0, 0], [0, 5, 0]]], ["positionsIndices", T.int + A, [0, 1, 2]],
    ["normals", T.vec3 + A, [[0, 0, 1]]], ["normalsIndices", T.int + A, [0, 0, 0]],
    ["textureCoordinates", 9 + A, [[0, 0], [1, 0], [0, 1]]], ["textureCoordinatesIndices", T.int + A, [0, 1, 2]],
    ["jointWeights", T.float + A, [1, 1, 1]], ["jointIndices", T.int + A, [0, 0, 0]],
  ] };
  const material: E = { type: "DmeMaterial", name: "m", attrs: [["mtlName", T.string, "models/x/hat"]] };
  const set: E = { type: "DmeFaceSet", name: "set", attrs: [["faces", T.int + A, [0, 1, 2, -1]], ["material", T.element, material]] };
  const mesh: E = { type: "DmeMesh", name: "mesh", attrs: [["currentState", T.element, state], ["faceSets", T.element + A, [set]]] };
  const dag: E = { type: "DmeDag", name: "mesh", attrs: [["transform", T.element, meshT], ["shape", T.element, mesh], ["children", T.element + A, []]] };
  model.attrs.push(["transform", T.element, transform("model", [0, 0, 0])], ["children", T.element + A, [bone, dag]], ["jointTransforms", T.element + A, [boneT]]);
  root.attrs.push(["skeleton", T.element, model]);
  const m = importDmx(dmx([root, model, boneT, meshT, bone, state, material, set, mesh, dag, transform("model", [0, 0, 0])].reduce<E[]>((all, e) => (all.includes(e) ? all : [...all, e]), [])));
  assert.equal(m.triangles, 1);
  assert.deepEqual(m.skeleton.map((b) => [b.name, b.parent, b.world[13]]), [["bone", null, 10]]);
  const part = m.parts[0];
  assert.equal(part.material, "hat");
  assert.deepEqual([...part.positions], [0, 0, 0, 5, 0, 0, 0, 5, 0]);
  assert.equal(part.boneNames[part.skinIndices[0]], "bone");
  // flipVCoordinates: the file's bottom-up v becomes ours (top-down)
  assert.deepEqual([...part.uvs], [0, 1, 1, 1, 0, 0]);
});

test("a file that is no Datamodel, and a text one, say so", () => {
  assert.throws(() => importDmx(bytes("hello")), /not a Datamodel/);
  assert.throws(() => importDmx(bytes("<!-- dmx encoding keyvalues2 1 format model 1 -->\n")), /text/);
});

test("shape keys survive a .dmx written by the compiler and read back", async () => {
  const { writeDmx } = await import("../src/compiler/dmxWrite.ts");
  const model = sample();
  model.flexes = [
    { name: "AU_1", part: Uint16Array.from([0, 0]), vertex: Uint32Array.from([0, 2]), delta: Float32Array.from([0, 1, 0, 0, 2, 0]) },
    { name: "WQ", part: Uint16Array.from([0]), vertex: Uint32Array.from([1]), delta: Float32Array.from([3, 0, 0]) },
  ];
  model.flexControls = [{ name: "AU_1", raw: ["AU_1"], stereo: false, eyelid: false, wrinkle: [0] }, { name: "WQ", raw: ["WQ"], stereo: true, eyelid: false, wrinkle: [0] }];
  const bytes = writeDmx(model, (m) => m, "root");
  const back = importDmx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  assert.equal(back.triangles, 1);
  assert.deepEqual([...back.parts[0].positions], [...model.parts[0].positions]);
  assert.deepEqual(back.flexes?.map((f) => f.name), ["AU_1", "WQ"]);
  assert.deepEqual([...back.flexes![0].vertex].sort(), [0, 2]);
  assert.deepEqual([...back.flexes![1].delta], [3, 0, 0]);
  assert.deepEqual(back.flexControls?.map((c) => [c.name, c.stereo]), [["AU_1", false], ["WQ", true]]);
  // a model without shape keys has none
  const plain = writeDmx(sample(), (m) => m, "root");
  assert.equal(importDmx(plain.buffer.slice(plain.byteOffset, plain.byteOffset + plain.byteLength) as ArrayBuffer).flexes, undefined);
});

test("the blend shapes of an FBX mesh become shape keys on its vertices", async () => {
  const THREE = await import("three");
  const { importScene, MAYA_AXES } = await import("../src/compiler/fbx.ts");
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 5, 0, 0, 0, 5, 0], 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  // the loader's way: moves from the mesh, in the order of the dictionary
  geometry.morphTargetsRelative = true;
  geometry.morphAttributes.position = [new THREE.Float32BufferAttribute([0, 0, 0, 0, 2, 0, 0, 0, 0], 3), new THREE.Float32BufferAttribute([1, 0, 0, 0, 0, 0, 0, 0, 0], 3)];
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ name: "hat" }));
  mesh.morphTargetDictionary = { WQ: 0, "blendShape1.AU_1": 1 };
  mesh.morphTargetInfluences = [0, 0];
  const group = new THREE.Group();
  group.add(mesh);
  const model = importScene(group, MAYA_AXES);
  assert.deepEqual(model.flexes?.map((f) => f.name), ["WQ", "AU_1"]);
  const wq = model.flexes![0];
  assert.deepEqual([...wq.vertex], [1]);
  assert.deepEqual([...wq.delta], [0, 2, 0]);
  assert.deepEqual([...model.flexes![1].delta], [1, 0, 0]);
  assert.deepEqual(model.flexControls?.map((c) => c.name), ["WQ", "AU_1"]);
  // and a mesh without any has none
  const plain = new THREE.Group();
  plain.add(new THREE.Mesh(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3)), new THREE.MeshBasicMaterial()));
  assert.equal(importScene(plain, MAYA_AXES).flexes, undefined);
});
