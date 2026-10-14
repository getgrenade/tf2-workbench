import * as THREE from "three";
import type { ImportedModel, ImportedPart } from "./fbx";
import { turnedWorld, type BoneTurn } from "./boneAxes";

/**
 * Writes an imported model back out as a binary FBX (version 7400, Y up) laid out the way Blender's exporter lays out a model for the item
 * importer: a single mesh with a material slot for each material, and (unless it is for a LOD, which the importer skins from LOD 0) the
 * skeleton as limb nodes with a bind pose and the skin of the mesh. For a copy of the artist's model with the changes the compiler makes to it
 * (the turned axes of bones, see boneAxes.ts) already in it, or for a LOD the compiler made.
 *
 * What it does not carry: shape keys (flexes). It refuses a model that has them.
 */

type Prop =
  | { t: "I"; v: number } | { t: "L"; v: number } | { t: "D"; v: number } | { t: "C"; v: boolean }
  | { t: "S"; v: string } | { t: "R"; v: ArrayLike<number> } | { t: "d"; v: ArrayLike<number> } | { t: "i"; v: ArrayLike<number> };

interface Node { name: string; props: Prop[]; children: Node[] }

const I = (v: number): Prop => ({ t: "I", v });
const L = (v: number): Prop => ({ t: "L", v });
const D = (v: number): Prop => ({ t: "D", v });
const S = (v: string): Prop => ({ t: "S", v });
const node = (name: string, props: Prop[] = [], children: Node[] = []): Node => ({ name, props, children });

/** A `P` entry of a Properties70 block. */
const P = (name: string, type: string, label: string, flags: string, ...values: Prop[]) => node("P", [S(name), S(type), S(label), S(flags), ...values]);
const vec = (name: string, x: number, y: number, z: number) => P(name, name, "", "A", D(x), D(y), D(z));
const vector = (name: string, x: number, y: number, z: number) => P(name, "Vector3D", "Vector", "", D(x), D(y), D(z));
const flag = (name: string, on: number) => P(name, "bool", "", "", I(on));
const number = (name: string, v: number, flags = "A") => P(name, "Number", "", flags, D(v));
const color = (name: string, r: number, g: number, b: number) => P(name, "Color", "", "A", D(r), D(g), D(b));

class Bytes {
  private data = new Uint8Array(1 << 16);
  private view = new DataView(this.data.buffer);
  length = 0;
  private ensure(extra: number) {
    if (this.length + extra <= this.data.length) return;
    let size = this.data.length;
    while (size < this.length + extra) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.data);
    this.data = next;
    this.view = new DataView(next.buffer);
  }
  u8(v: number) { this.ensure(1); this.data[this.length++] = v; }
  u32(v: number) { this.ensure(4); this.view.setUint32(this.length, v, true); this.length += 4; }
  i32(v: number) { this.ensure(4); this.view.setInt32(this.length, v, true); this.length += 4; }
  i64(v: number) { this.ensure(8); this.view.setBigInt64(this.length, BigInt(Math.round(v)), true); this.length += 8; }
  f64(v: number) { this.ensure(8); this.view.setFloat64(this.length, v, true); this.length += 8; }
  bytes(b: ArrayLike<number>) { this.ensure(b.length); for (let i = 0; i < b.length; i++) this.data[this.length + i] = b[i]; this.length += b.length; }
  patch32(at: number, v: number) { this.view.setUint32(at, v, true); }
  result() { return this.data.slice(0, this.length); }
}

const text = (s: string) => new TextEncoder().encode(s);

function writeProp(out: Bytes, p: Prop) {
  switch (p.t) {
    case "I": out.u8(0x49); out.i32(p.v); break;
    case "L": out.u8(0x4c); out.i64(p.v); break;
    case "D": out.u8(0x44); out.f64(p.v); break;
    case "C": out.u8(0x43); out.u8(p.v ? 1 : 0); break;
    case "S": { const b = text(p.v); out.u8(0x53); out.u32(b.length); out.bytes(b); break; }
    case "R": out.u8(0x52); out.u32(p.v.length); out.bytes(p.v); break;
    case "d": out.u8(0x64); out.u32(p.v.length); out.u32(0); out.u32(p.v.length * 8); for (let i = 0; i < p.v.length; i++) out.f64(p.v[i]); break;
    case "i": out.u8(0x69); out.u32(p.v.length); out.u32(0); out.u32(p.v.length * 4); for (let i = 0; i < p.v.length; i++) out.i32(p.v[i]); break;
  }
}

/** A node record: its end, how many properties and how long, its name, the properties, the children and (when it has children) the closing blank record. */
function writeNode(out: Bytes, n: Node) {
  const start = out.length;
  out.u32(0); // end offset, patched below
  out.u32(n.props.length);
  const lenAt = out.length;
  out.u32(0); // length of the properties, patched below
  const name = text(n.name);
  out.u8(name.length);
  out.bytes(name);
  const propsStart = out.length;
  for (const p of n.props) writeProp(out, p);
  out.patch32(lenAt, out.length - propsStart);
  if (n.children.length) {
    for (const c of n.children) writeNode(out, c);
    for (let i = 0; i < 13; i++) out.u8(0);
  }
  out.patch32(start, out.length);
}

/** FBX names an object `name\0\x01Class`. */
const objectName = (name: string, kind: string) => `${name}\u0000\u0001${kind}`;

/** The file id Blender writes in every file (the SDK does not check it against anything), and the time it puts there. */
const FILE_ID = [0x28, 0xb3, 0x2a, 0xeb, 0xb6, 0x24, 0xcc, 0xc2, 0xbf, 0xc8, 0xb0, 0x2a, 0xa9, 0x2b, 0xfc, 0xf1];
const CREATOR = "TF2 Workbench";

/** The defaults of a node, as the importer's SDK writes them out (what a Model of the file leaves out is these). */
const nodeTemplate = (): Node[] => [
  P("QuaternionInterpolate", "enum", "", "", I(0)), vector("RotationOffset", 0, 0, 0), vector("RotationPivot", 0, 0, 0), vector("ScalingOffset", 0, 0, 0), vector("ScalingPivot", 0, 0, 0),
  flag("TranslationActive", 0), vector("TranslationMin", 0, 0, 0), vector("TranslationMax", 0, 0, 0),
  ...["MinX", "MinY", "MinZ", "MaxX", "MaxY", "MaxZ"].map((s) => flag(`Translation${s}`, 0)),
  P("RotationOrder", "enum", "", "", I(0)), flag("RotationSpaceForLimitOnly", 0),
  ...["X", "Y", "Z"].map((s) => P(`RotationStiffness${s}`, "double", "Number", "", D(0))),
  P("AxisLen", "double", "Number", "", D(10)), vector("PreRotation", 0, 0, 0), vector("PostRotation", 0, 0, 0), flag("RotationActive", 0),
  vector("RotationMin", 0, 0, 0), vector("RotationMax", 0, 0, 0), ...["MinX", "MinY", "MinZ", "MaxX", "MaxY", "MaxZ"].map((s) => flag(`Rotation${s}`, 0)),
  P("InheritType", "enum", "", "", I(0)), flag("ScalingActive", 0), vector("ScalingMin", 0, 0, 0), vector("ScalingMax", 1, 1, 1),
  ...["MinX", "MinY", "MinZ", "MaxX", "MaxY", "MaxZ"].map((s) => flag(`Scaling${s}`, 0)),
  vector("GeometricTranslation", 0, 0, 0), vector("GeometricRotation", 0, 0, 0), vector("GeometricScaling", 1, 1, 1),
  ...["MinDampRange", "MaxDampRange", "MinDampStrength", "MaxDampStrength", "PreferedAngle"].flatMap((k) => ["X", "Y", "Z"].map((s) => P(`${k}${s}`, "double", "Number", "", D(0)))),
  P("LookAtProperty", "object", "", ""), P("UpVectorProperty", "object", "", ""), flag("Show", 1), flag("NegativePercentShapeSupport", 1),
  P("DefaultAttributeIndex", "int", "Integer", "", I(-1)), flag("Freeze", 0), flag("LODBox", 0),
  vec("Lcl Translation", 0, 0, 0), vec("Lcl Rotation", 0, 0, 0), vec("Lcl Scaling", 1, 1, 1), P("Visibility", "Visibility", "", "A", D(1)), P("Visibility Inheritance", "Visibility Inheritance", "", "", I(1)),
];

const meshTemplate = (): Node[] => [
  P("Color", "ColorRGB", "Color", "", D(0.8), D(0.8), D(0.8)), vector("BBoxMin", 0, 0, 0), vector("BBoxMax", 0, 0, 0),
  flag("Primary Visibility", 1), flag("Casts Shadows", 1), flag("Receive Shadows", 1),
];

const materialTemplate = (): Node[] => [
  P("ShadingModel", "KString", "", "", S("Phong")), flag("MultiLayer", 0),
  color("EmissiveColor", 0, 0, 0), number("EmissiveFactor", 1), color("AmbientColor", 0.2, 0.2, 0.2), number("AmbientFactor", 1), color("DiffuseColor", 0.8, 0.8, 0.8), number("DiffuseFactor", 1),
  color("TransparentColor", 0, 0, 0), number("TransparencyFactor", 0), number("Opacity", 1), vector("NormalMap", 0, 0, 0), vector("Bump", 0, 0, 0),
  P("BumpFactor", "double", "Number", "", D(1)), P("DisplacementColor", "ColorRGB", "Color", "", D(0), D(0), D(0)), P("DisplacementFactor", "double", "Number", "", D(1)),
  P("VectorDisplacementColor", "ColorRGB", "Color", "", D(0), D(0), D(0)), P("VectorDisplacementFactor", "double", "Number", "", D(1)),
  color("SpecularColor", 0.2, 0.2, 0.2), number("SpecularFactor", 1), number("Shininess", 20), number("ShininessExponent", 20), color("ReflectionColor", 0, 0, 0), number("ReflectionFactor", 1),
];

export interface FbxOptions {
  /** The skeleton, its bind pose and the skin of the mesh (true), or the mesh alone, as a LOD is (false). */
  skeleton?: boolean;
}

export function writeFbx(model: ImportedModel, turns: Record<string, BoneTurn> = {}, options: FbxOptions = {}): Uint8Array {
  if (model.flexes?.length) throw new Error("The model has shape keys, which a copy does not carry.");
  const withSkeleton = options.skeleton !== false;
  let nextId = 100000;
  const id = () => (nextId += 7919);
  const connections: Node[] = [];
  const connect = (child: number, parent: number) => connections.push(node("C", [S("OO"), L(child), L(parent)]));
  const objects: Node[] = [];
  const counts = { Geometry: 0, Model: 0, Material: 0, NodeAttribute: 0, Pose: 0, Deformer: 0 };

  // --- the skeleton: a limb node per bone, local to its parent ---
  const worlds = new Map<string, THREE.Matrix4>();
  const boneId = new Map<string, number>();
  if (withSkeleton) {
    for (const b of model.skeleton) { worlds.set(b.name, turnedWorld(new THREE.Matrix4().fromArray(b.world), turns[b.name])); boneId.set(b.name, id()); }
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), euler = new THREE.Euler();
    for (const b of model.skeleton) {
      const world = worlds.get(b.name)!;
      const parentWorld = b.parent ? worlds.get(b.parent) : null;
      const local = parentWorld ? parentWorld.clone().invert().multiply(world) : world.clone();
      local.decompose(p, q, s);
      euler.setFromQuaternion(q, "ZYX");
      const deg = (r: number) => (r * 180) / Math.PI;
      const bid = boneId.get(b.name)!;
      const attribute = id();
      objects.push(node("NodeAttribute", [L(attribute), S(objectName(b.name, "NodeAttribute")), S("LimbNode")], [node("TypeFlags", [S("Skeleton")])]));
      counts.NodeAttribute++;
      connect(attribute, bid);
      objects.push(node("Model", [L(bid), S(objectName(b.name, "Model")), S("LimbNode")], [
        node("Version", [I(232)]),
        node("Properties70", [], [
          P("InheritType", "enum", "", "", I(1)),
          vec("Lcl Translation", p.x, p.y, p.z), vec("Lcl Rotation", deg(euler.x), deg(euler.y), deg(euler.z)), vec("Lcl Scaling", s.x, s.y, s.z),
        ]),
        node("Shading", [{ t: "C", v: true }]),
        node("Culling", [S("CullingOff")]),
      ]));
      counts.Model++;
      connect(bid, b.parent && boneId.has(b.parent) ? boneId.get(b.parent)! : 0);
    }
  }

  // --- one mesh for the whole model: a material slot for each material ---
  const parts = model.parts.filter((part) => part.indices.length);
  const meshId = id();
  const geometryId = id();
  objects.push(node("Model", [L(meshId), S(objectName("mesh", "Model")), S("Mesh")], [
    node("Version", [I(232)]),
    node("Properties70", [], [P("DefaultAttributeIndex", "int", "Integer", "", I(0)), P("InheritType", "enum", "", "", I(1))]),
    node("MultiLayer", [I(0)]),
    node("MultiTake", [I(0)]),
    node("Shading", [{ t: "C", v: true }]),
    node("Culling", [S("CullingOff")]),
  ]));
  counts.Model++;
  connect(meshId, 0);
  const merged = mergeParts(parts);
  objects.push(geometryNode(geometryId, merged));
  counts.Geometry++;
  connect(geometryId, meshId);
  for (const material of merged.materials) {
    const material_ = id();
    objects.push(node("Material", [L(material_), S(objectName(material, "Material")), S("")], [
      node("Version", [I(102)]),
      node("ShadingModel", [S("Phong")]),
      node("MultiLayer", [I(0)]),
      node("Properties70", [], [
        color("DiffuseColor", 0.8, 0.8, 0.8), color("EmissiveColor", 1, 1, 1), number("EmissiveFactor", 0), color("AmbientColor", 1, 1, 1), number("AmbientFactor", 0),
        color("SpecularColor", 0.8, 0.8, 0.8), number("SpecularFactor", 0.25), number("Shininess", 15), number("ShininessExponent", 15), color("ReflectionColor", 0.8, 0.8, 0.8), number("ReflectionFactor", 0),
      ]),
    ]));
    counts.Material++;
    connect(material_, meshId);
  }
  if (withSkeleton) skinNodes(merged, geometryId, boneId, worlds, objects, connect, id, counts);
  if (withSkeleton && boneId.size) {
    // the bind pose: the mesh and each bone where they were
    const poseNodes = [[meshId, new THREE.Matrix4().elements], ...[...boneId].map(([name, bid]) => [bid, worlds.get(name)!.elements] as [number, ArrayLike<number>])];
    objects.push(node("Pose", [L(id()), S(objectName("mesh", "Pose")), S("BindPose")], [
      node("Type", [S("BindPose")]),
      node("Version", [I(100)]),
      node("NbPoseNodes", [I(poseNodes.length)]),
      ...poseNodes.map(([target, matrix]) => node("PoseNode", [], [node("Node", [L(target as number)]), node("Matrix", [{ t: "d", v: matrix as ArrayLike<number> }])])),
    ]));
    counts.Pose++;
  }

  const objectTypes: Node[] = [node("ObjectType", [S("GlobalSettings")], [node("Count", [I(1)])])];
  const typeEntry = (kind: keyof typeof counts, template?: [string, Node[]]) => {
    if (!counts[kind]) return;
    objectTypes.push(node("ObjectType", [S(kind)], [node("Count", [I(counts[kind])]), ...(template ? [node("PropertyTemplate", [S(template[0])], [node("Properties70", [], template[1])])] : [])]));
  };
  typeEntry("NodeAttribute");
  typeEntry("Geometry", ["FbxMesh", meshTemplate()]);
  typeEntry("Model", ["FbxNode", nodeTemplate()]);
  typeEntry("Pose");
  typeEntry("Deformer");
  typeEntry("Material", ["FbxSurfacePhong", materialTemplate()]);

  const stamp = (key: string) => P(key, "KString", "", "", S(CREATOR));
  const root: Node[] = [
    node("FBXHeaderExtension", [], [
      node("FBXHeaderVersion", [I(1003)]),
      node("FBXVersion", [I(7400)]),
      node("EncryptionType", [I(0)]),
      node("CreationTimeStamp", [], [node("Version", [I(1000)]), node("Year", [I(2026)]), node("Month", [I(1)]), node("Day", [I(1)]), node("Hour", [I(0)]), node("Minute", [I(0)]), node("Second", [I(0)]), node("Millisecond", [I(0)])]),
      node("Creator", [S(CREATOR)]),
      node("SceneInfo", [S(objectName("GlobalInfo", "SceneInfo")), S("UserData")], [
        node("Type", [S("UserData")]),
        node("Version", [I(100)]),
        node("MetaData", [], [node("Version", [I(100)]), node("Title", [S("")]), node("Subject", [S("")]), node("Author", [S("")]), node("Keywords", [S("")]), node("Revision", [S("")]), node("Comment", [S("")])]),
        node("Properties70", [], [
          P("DocumentUrl", "KString", "Url", "", S("/model.fbx")), P("SrcDocumentUrl", "KString", "Url", "", S("/model.fbx")), P("Original", "Compound", "", ""),
          stamp("Original|ApplicationVendor"), stamp("Original|ApplicationName"), P("Original|ApplicationVersion", "KString", "", "", S("1")),
          P("Original|DateTime_GMT", "DateTime", "", "", S("01/01/1970 00:00:00.000")), P("Original|FileName", "KString", "", "", S("/model.fbx")),
        ]),
      ]),
    ]),
    node("FileId", [{ t: "R", v: FILE_ID }]),
    node("CreationTime", [S("1970-01-01 10:00:00:000")]),
    node("Creator", [S(CREATOR)]),
    node("GlobalSettings", [], [
      node("Version", [I(1000)]),
      node("Properties70", [], [
        P("UpAxis", "int", "Integer", "", I(1)), P("UpAxisSign", "int", "Integer", "", I(1)),
        P("FrontAxis", "int", "Integer", "", I(2)), P("FrontAxisSign", "int", "Integer", "", I(1)),
        P("CoordAxis", "int", "Integer", "", I(0)), P("CoordAxisSign", "int", "Integer", "", I(1)),
        P("OriginalUpAxis", "int", "Integer", "", I(-1)), P("OriginalUpAxisSign", "int", "Integer", "", I(1)),
        P("UnitScaleFactor", "double", "Number", "", D(100)), P("OriginalUnitScaleFactor", "double", "Number", "", D(100)),
        P("AmbientColor", "ColorRGB", "Color", "", D(0), D(0), D(0)),
        P("DefaultCamera", "KString", "", "", S("Producer Perspective")),
        P("TimeMode", "enum", "", "", I(11)), P("TimeSpanStart", "KTime", "Time", "", L(0)), P("TimeSpanStop", "KTime", "Time", "", L(46186158000)), P("CustomFrameRate", "double", "Number", "", D(24)),
      ]),
    ]),
    node("Documents", [], [
      node("Count", [I(1)]),
      node("Document", [L(314190304), S("model"), S("model")], [node("Properties70", [], [P("SourceObject", "object", "", "")]), node("RootNode", [L(0)])]),
    ]),
    node("References"),
    node("Definitions", [], [
      node("Version", [I(100)]),
      node("Count", [I(1 + Object.values(counts).reduce((a, b) => a + b, 0))]),
      ...objectTypes,
    ]),
    node("Objects", [], objects),
    node("Connections", [], connections),
    node("Takes", [], [node("Current", [S("")])]),
  ];

  const out = new Bytes();
  out.bytes(text("Kaydara FBX Binary  "));
  out.u8(0);
  out.u8(0x1a);
  out.u8(0);
  out.u32(7400);
  for (const n of root) writeNode(out, n);
  for (let i = 0; i < 13; i++) out.u8(0);
  // the footer the format has: a fixed id, padding to a multiple of 16, the version, and a fixed tail
  out.bytes([0xfa, 0xbc, 0xab, 0x09, 0xd0, 0xc8, 0xd4, 0x66, 0xb1, 0x76, 0xfb, 0x83, 0x1c, 0xf7, 0x26, 0x7e]);
  for (let i = 0; i < 4; i++) out.u8(0);
  const pad = ((out.length + 15) & ~15) - out.length;
  for (let i = 0; i < (pad === 0 ? 16 : pad); i++) out.u8(0);
  out.u32(7400);
  for (let i = 0; i < 120; i++) out.u8(0);
  out.bytes([0xf8, 0x5a, 0x8c, 0x6a, 0xde, 0xf5, 0xd9, 0x7e, 0xec, 0xe9, 0x0c, 0xe3, 0x75, 0x8f, 0x29, 0x0b]);
  return out.result();
}

/** The parts of the model as one mesh: the vertices one after the other, the triangles with the material slot of each. */
interface Merged {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  /** The material slot of each triangle. */
  slots: Uint16Array;
  materials: string[];
  /** The bones of each vertex: names, indices into them and weights, four a vertex. */
  skin: { boneNames: string[]; indices: Uint16Array; weights: Float32Array }[];
  /** Where each part's vertices start. */
  starts: number[];
}

function mergeParts(parts: ImportedPart[]): Merged {
  const vertices = parts.reduce((n, p) => n + p.positions.length / 3, 0);
  const triangles = parts.reduce((n, p) => n + p.indices.length / 3, 0);
  const positions = new Float32Array(vertices * 3), normals = new Float32Array(vertices * 3), uvs = new Float32Array(vertices * 2);
  const indices = new Uint32Array(triangles * 3), slots = new Uint16Array(triangles);
  const materials: string[] = [];
  const starts: number[] = [];
  let v = 0, t = 0;
  for (const part of parts) {
    let slot = materials.indexOf(part.material);
    if (slot < 0) { slot = materials.length; materials.push(part.material); }
    starts.push(v);
    positions.set(part.positions, v * 3);
    normals.set(part.normals, v * 3);
    uvs.set(part.uvs, v * 2);
    for (let i = 0; i < part.indices.length; i++) indices[t * 3 + i] = part.indices[i] + v;
    slots.fill(slot, t, t + part.indices.length / 3);
    v += part.positions.length / 3;
    t += part.indices.length / 3;
  }
  return { positions, normals, uvs, indices, slots, materials, skin: parts.map((p) => ({ boneNames: p.boneNames, indices: p.skinIndices, weights: p.skinWeights })), starts };
}

function geometryNode(geometry: number, mesh: Merged): Node {
  const corners = mesh.indices.length;
  const polygons = new Int32Array(corners);
  for (let t = 0; t + 2 < corners; t += 3) {
    polygons[t] = mesh.indices[t];
    polygons[t + 1] = mesh.indices[t + 1];
    polygons[t + 2] = -mesh.indices[t + 2] - 1;
  }
  // texture coordinates run down from the top in the model, up from the bottom in the file
  const vertices = mesh.positions.length / 3;
  const uvs = new Float64Array(vertices * 2);
  for (let v = 0; v < vertices; v++) { uvs[v * 2] = mesh.uvs[v * 2]; uvs[v * 2 + 1] = 1 - mesh.uvs[v * 2 + 1]; }
  // the normals and texture coordinates are of the vertices, indexed by the corners
  const cornerVertex = Int32Array.from(mesh.indices);
  const single = mesh.materials.length <= 1;
  return node("Geometry", [L(geometry), S(objectName("mesh", "Geometry")), S("Mesh")], [
    node("Properties70"),
    node("GeometryVersion", [I(124)]),
    node("Vertices", [{ t: "d", v: mesh.positions }]),
    node("PolygonVertexIndex", [{ t: "i", v: polygons }]),
    node("LayerElementNormal", [I(0)], [
      node("Version", [I(101)]), node("Name", [S("")]), node("MappingInformationType", [S("ByPolygonVertex")]), node("ReferenceInformationType", [S("IndexToDirect")]),
      node("Normals", [{ t: "d", v: mesh.normals }]), node("NormalsIndex", [{ t: "i", v: cornerVertex }]),
    ]),
    node("LayerElementUV", [I(0)], [
      node("Version", [I(101)]), node("Name", [S("UVMap")]), node("MappingInformationType", [S("ByPolygonVertex")]), node("ReferenceInformationType", [S("IndexToDirect")]),
      node("UV", [{ t: "d", v: uvs }]), node("UVIndex", [{ t: "i", v: cornerVertex }]),
    ]),
    node("LayerElementMaterial", [I(0)], [
      node("Version", [I(101)]), node("Name", [S("")]), node("MappingInformationType", [S(single ? "AllSame" : "ByPolygon")]), node("ReferenceInformationType", [S("IndexToDirect")]),
      node("Materials", [{ t: "i", v: single ? [0] : mesh.slots }]),
    ]),
    node("Layer", [I(0)], [
      node("Version", [I(100)]),
      node("LayerElement", [], [node("Type", [S("LayerElementNormal")]), node("TypedIndex", [I(0)])]),
      node("LayerElement", [], [node("Type", [S("LayerElementUV")]), node("TypedIndex", [I(0)])]),
      node("LayerElement", [], [node("Type", [S("LayerElementMaterial")]), node("TypedIndex", [I(0)])]),
    ]),
  ]);
}

/** The skin of the mesh: a cluster for each bone it uses (the vertices and weights), with the bone's bind matrix. */
function skinNodes(
  mesh: Merged, geometry: number, boneId: Map<string, number>, worlds: Map<string, THREE.Matrix4>, objects: Node[],
  connect: (child: number, parent: number) => void, id: () => number, counts: Record<string, number>,
) {
  const byBone = new Map<string, { indexes: number[]; weights: number[] }>();
  mesh.skin.forEach((skin, partIndex) => {
    const base = mesh.starts[partIndex];
    const next = mesh.starts[partIndex + 1] ?? mesh.positions.length / 3;
    for (let v = 0; v < next - base; v++) {
      for (let k = 0; k < 4; k++) {
        const w = skin.weights[v * 4 + k];
        if (w <= 1e-5) continue;
        const name = skin.boneNames[skin.indices[v * 4 + k]];
        if (!name || !boneId.has(name)) continue;
        let entry = byBone.get(name);
        if (!entry) byBone.set(name, (entry = { indexes: [], weights: [] }));
        entry.indexes.push(base + v);
        entry.weights.push(w);
      }
    }
  });
  if (!byBone.size) return;
  const skin = id();
  objects.push(node("Deformer", [L(skin), S(objectName("skin", "Deformer")), S("Skin")], [node("Version", [I(101)]), node("Link_DeformAcuracy", [D(50)]), node("SkinningType", [S("Linear")])]));
  counts.Deformer++;
  connect(skin, geometry);
  const identity = new THREE.Matrix4().elements;
  for (const [name, entry] of byBone) {
    const cluster = id();
    objects.push(node("Deformer", [L(cluster), S(objectName(name, "SubDeformer")), S("Cluster")], [
      node("Version", [I(100)]),
      node("UserData", [S(""), S("")]),
      node("Indexes", [{ t: "i", v: entry.indexes }]),
      node("Weights", [{ t: "d", v: entry.weights }]),
      node("Transform", [{ t: "d", v: identity }]),
      node("TransformLink", [{ t: "d", v: worlds.get(name)!.elements }]),
    ]));
    counts.Deformer++;
    connect(cluster, skin);
    connect(boneId.get(name)!, cluster);
  }
}
