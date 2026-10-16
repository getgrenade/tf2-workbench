import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { connectOrphanModels } from "./fbxRepair";
import { importerMaterialNames } from "./fbxStrip";
import { computeNormals, windingSign } from "./mesh";

/**
 * Reads the source meshes of an item (item_import.cpp takes .fbx, .dmx and .smd). The geometry and the skin weights come from three's
 * FBXLoader; what this file adds is what the loader leaves out: the file's axis system (the importer converts to the Y-up frame the
 * game's own DMX and VVD files use), and the welding of vertices into indexed, per-material parts.
 *
 * Units are taken as they are. The importer does the same: a hat modelled 1 unit = 1 Source unit in a file that says "metres" still
 * arrives at the right size, so the artist is expected to model at the game's scale.
 */

/** Where the FBX file's right, up and front directions point, as unit vectors in the file's own coordinates. */
export interface FbxAxes {
  right: [number, number, number];
  up: [number, number, number];
  front: [number, number, number];
}

/** Maya's: X right, Y up, Z toward the viewer. */
export const MAYA_AXES: FbxAxes = { right: [1, 0, 0], up: [0, 1, 0], front: [0, 0, 1] };

const axisVector = (axis: number, sign: number): [number, number, number] => {
  const v: [number, number, number] = [0, 0, 0];
  v[axis] = sign < 0 ? -1 : 1;
  return v;
};

/** The ints of the GlobalSettings block that describe the axis system. */
interface AxisSettings { UpAxis?: number; UpAxisSign?: number; FrontAxis?: number; FrontAxisSign?: number; CoordAxis?: number; CoordAxisSign?: number }

function axesFrom(s: AxisSettings): FbxAxes {
  if (s.UpAxis === undefined) return MAYA_AXES;
  const up = axisVector(s.UpAxis, s.UpAxisSign ?? 1);
  const right = axisVector(s.CoordAxis ?? 0, s.CoordAxisSign ?? 1);
  // without a front axis, the one that makes the system right-handed (right x up = front)
  const front: [number, number, number] = s.FrontAxis !== undefined
    ? axisVector(s.FrontAxis, s.FrontAxisSign ?? 1)
    : [right[1] * up[2] - right[2] * up[1], right[2] * up[0] - right[0] * up[2], right[0] * up[1] - right[1] * up[0]];
  return { right, up, front };
}

/** The axis system an FBX file declares (binary or text), Maya's when it declares none. */
export function readFbxAxes(buffer: ArrayBuffer): FbxAxes {
  const bytes = new Uint8Array(buffer);
  const magic = "Kaydara FBX Binary";
  const isBinary = bytes.length > 27 && new TextDecoder().decode(bytes.subarray(0, magic.length)) === magic;
  const settings: AxisSettings = {};
  if (isBinary) readBinarySettings(bytes, settings);
  else {
    const text = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 1 << 20)));
    for (const key of ["UpAxis", "UpAxisSign", "FrontAxis", "FrontAxisSign", "CoordAxis", "CoordAxisSign"] as const) {
      const m = new RegExp(`P:\\s*"${key}"\\s*,\\s*"int"\\s*,\\s*"Integer"\\s*,\\s*"[^"]*"\\s*,\\s*(-?\\d+)`).exec(text);
      if (m) settings[key] = Number(m[1]);
    }
  }
  return axesFrom(settings);
}

/** Walks the node records of a binary FBX far enough to read GlobalSettings/Properties70 (everything else is skipped by its end offset). */
function readBinarySettings(b: Uint8Array, out: AxisSettings) {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const version = view.getUint32(23, true);
  const wide = version >= 7500;
  const head = wide ? 25 : 13;
  const text = new TextDecoder("latin1");
  const record = (at: number) => {
    if (at + head > b.length) return null;
    const end = wide ? Number(view.getBigUint64(at, true)) : view.getUint32(at, true);
    const props = wide ? Number(view.getBigUint64(at + 8, true)) : view.getUint32(at + 4, true);
    const propsLen = wide ? Number(view.getBigUint64(at + 16, true)) : view.getUint32(at + 8, true);
    const nameLen = b[at + head - 1];
    if (end === 0) return null;
    const name = text.decode(b.subarray(at + head, at + head + nameLen));
    return { end, props, propsLen, name, propsAt: at + head + nameLen, childrenAt: at + head + nameLen + propsLen };
  };
  /** The first property when it is a string (type 'S'), and the value of the fifth when it is an int. */
  const readP = (n: NonNullable<ReturnType<typeof record>>) => {
    let at = n.propsAt;
    const values: (string | number)[] = [];
    for (let i = 0; i < n.props && at < n.childrenAt; i++) {
      const type = String.fromCharCode(b[at++]);
      if (type === "S" || type === "R") {
        const len = view.getUint32(at, true); at += 4;
        values.push(type === "S" ? text.decode(b.subarray(at, at + len)) : ""); at += len;
      } else if (type === "I") { values.push(view.getInt32(at, true)); at += 4; }
      else if (type === "L") { values.push(Number(view.getBigInt64(at, true))); at += 8; }
      else if (type === "D") { values.push(view.getFloat64(at, true)); at += 8; }
      else if (type === "F") { values.push(view.getFloat32(at, true)); at += 4; }
      else if (type === "Y") { values.push(view.getInt16(at, true)); at += 2; }
      else if (type === "C") { values.push(b[at]); at += 1; }
      else return null; // an array: not a setting
    }
    return values;
  };
  const children = function* (parent: { childrenAt: number; end: number }) {
    let at = parent.childrenAt;
    while (at < parent.end) {
      const n = record(at);
      if (!n) return;
      yield n;
      at = n.end;
    }
  };
  let at = 27;
  while (at < b.length) {
    const n = record(at);
    if (!n) return;
    if (n.name === "GlobalSettings") {
      for (const props of children(n)) {
        if (props.name !== "Properties70") continue;
        for (const p of children(props)) {
          if (p.name !== "P") continue;
          const v = readP(p);
          const key = v?.[0];
          if (typeof key === "string" && typeof v?.[4] === "number" && ["UpAxis", "UpAxisSign", "FrontAxis", "FrontAxisSign", "CoordAxis", "CoordAxisSign"].includes(key)) {
            (out as Record<string, number>)[key] = v[4] as number;
          }
        }
      }
      return;
    }
    at = n.end;
  }
}

/** One material's worth of geometry, welded into an indexed mesh in the game's Y-up frame, skinned to named bones. */
export interface ImportedPart {
  material: string;
  positions: Float32Array;
  normals: Float32Array;
  /** Source texture coordinates (v down). */
  uvs: Float32Array;
  indices: Uint32Array;
  /** The bones the skin refers to (an empty name: the mesh was not skinned and goes to the bone the compiler picks). */
  boneNames: string[];
  /** Four indices into `boneNames` per vertex. */
  skinIndices: Uint16Array;
  /** Four weights per vertex, summing to 1. */
  skinWeights: Float32Array;
  /** See mesh.ts windingSign. */
  winding: number;
  /** Where each vertex came from in the file (a position of its mesh), for the files whose flexes are told by it. */
  sources?: Int32Array;
}

/** A flex (shape key): how far some vertices move, the vertices being those of the parts (part, then vertex in it). */
export interface ImportedFlex {
  name: string;
  part: Uint16Array;
  vertex: Uint32Array;
  /** xyz per entry. */
  delta: Float32Array;
}

/** A slider of the flexes: it drives the flexes named in `raw` (a combination of several when it names more than one). */
export interface ImportedFlexControl {
  name: string;
  raw: string[];
  stereo: boolean;
  eyelid: boolean;
  wrinkle: number[];
}

export interface ImportedBone {
  name: string;
  parent: string | null;
  /** The bone's bind transform in the world of the game's Y-up frame (a column-major 4x4, like three's Matrix4.elements). */
  world: number[];
}

export interface ImportedModel {
  parts: ImportedPart[];
  /** Every bone of the file's skeleton with its parent (bones of the same name as their parent, which the loader adds, are folded in). */
  skeleton: ImportedBone[];
  materials: string[];
  triangles: number;
  vertices: number;
  bounds: { min: [number, number, number]; max: [number, number, number] };
  axes: FbxAxes;
  /**
   * The empty nodes (an armature object of Blender, which its exporter writes as a Null) that the bones hang on. The item importer takes such a node
   * for a bone of the item, which the skeleton above does not list: it is one of the few the item may have.
   */
  armatures?: string[];
  /** The materials in the order of the material slots of the file, when that is not the order they are listed in (by name, as the importer lists them). */
  fileMaterialOrder?: string[];
  /** The shape keys of the file (from a .dmx), with the sliders that drive them. */
  flexes?: ImportedFlex[];
  flexControls?: ImportedFlexControl[];
}

/** A shape key's moves by the place in the file they are for (see ImportedPart.sources). */
export type FlexMoves = Map<string, { tag: number; d: [number, number, number] }[]>;

/** The shape keys on the welded vertices of the parts (a place of the file can be several vertices: one for each way it is shaded). */
export function weldFlexes(parts: ImportedPart[], moves: FlexMoves): ImportedFlex[] {
  const where = new Map<number, [number, number][]>();
  parts.forEach((part, pi) => part.sources?.forEach((tag, v) => { if (tag >= 0) { const list = where.get(tag); if (list) list.push([pi, v]); else where.set(tag, [[pi, v]]); } }));
  return [...moves].map(([name, entries]) => {
    const part: number[] = [], vertex: number[] = [], delta: number[] = [];
    for (const { tag, d } of entries) for (const [pi, v] of where.get(tag) ?? []) { part.push(pi); vertex.push(v); delta.push(...d); }
    return { name, part: Uint16Array.from(part), vertex: Uint32Array.from(vertex), delta: Float32Array.from(delta) };
  });
}

/** A 1x1 image for every texture the file names: the loader would otherwise try to fetch them. */
const BLANK_IMAGE = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

export function importFbx(buffer: ArrayBuffer): ImportedModel {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(() => BLANK_IMAGE);
  const load = (data: ArrayBuffer) => importScene(new FBXLoader(manager).parse(data, ""), readFbxAxes(data), importerMaterialNames(buffer));
  try {
    return load(buffer);
  } catch (error) {
    // a node that no connection mentions (an armature's empty in some exports) trips the loader: it is put under the scene, and the file read again
    if (error instanceof TypeError && /parents/.test(error.message)) {
      const repaired = connectOrphanModels(buffer);
      if (repaired) return load(repaired);
    }
    throw error;
  }
}

/** The model of a loaded scene (the part of the import that the file format has no say in). */
export function importScene(root: THREE.Object3D, axes: FbxAxes, materialNames = new Map<string, string>()): ImportedModel {
  root.updateMatrixWorld(true);
  // p -> (p . right, p . up, p . front): the file's frame to the Y-up frame
  const toGame = new THREE.Matrix4().set(
    axes.right[0], axes.right[1], axes.right[2], 0,
    axes.up[0], axes.up[1], axes.up[2], 0,
    axes.front[0], axes.front[1], axes.front[2], 0,
    0, 0, 0, 1,
  );

  const skeletonOf = new Map<string, { parent: string | null; world: number[] }>();
  root.traverse((o) => {
    if (!(o as THREE.Bone).isBone || !o.name) return;
    let parent = o.parent;
    while (parent && !((parent as THREE.Bone).isBone && parent.name !== o.name)) parent = parent.parent;
    if (!skeletonOf.has(o.name)) skeletonOf.set(o.name, { parent: parent && parent.name ? parent.name : null, world: new THREE.Matrix4().multiplyMatrices(toGame, o.matrixWorld).toArray() });
  });

  const armatures: string[] = [];
  root.traverse((o) => {
    if (o === root || (o as THREE.Bone).isBone || (o as THREE.Mesh).isMesh || !o.name) return;
    if (o.children.some((c) => (c as THREE.Bone).isBone) && !armatures.includes(o.name)) armatures.push(o.name);
  });

  const accumulate = new Map<string, Builder>();
  const slotOrder: string[] = [];
  const bounds = new THREE.Box3();
  // the blend shapes of the meshes (shape keys): by name, where each moves which vertices; the meshes number their vertices on from each other
  const moves: FlexMoves = new Map();
  let tagBase = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry.getAttribute("position")) return;
    const skinned = o as THREE.SkinnedMesh;
    const geo = mesh.geometry;
    const world = new THREE.Matrix4().multiplyMatrices(toGame, skinned.isSkinnedMesh ? skinned.bindMatrix : mesh.matrixWorld);
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(world);
    const position = geo.getAttribute("position"), normal = geo.getAttribute("normal"), uv = geo.getAttribute("uv");
    const skinIndex = geo.getAttribute("skinIndex"), skinWeight = geo.getAttribute("skinWeight");
    const bones = skinned.isSkinnedMesh ? skinned.skeleton.bones.map((bone) => bone.name) : [""];
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const groups = geo.groups.length ? geo.groups : [{ start: 0, count: geo.index ? geo.index.count : position.count, materialIndex: 0 }];
    const p = new THREE.Vector3(), n = new THREE.Vector3();
    const targets = geo.morphAttributes.position ?? [];
    const meshTag = tagBase;
    tagBase += position.count;
    if (targets.length) {
      const names = Object.entries(mesh.morphTargetDictionary ?? {}).sort((x, y) => x[1] - y[1]).map(([name]) => name);
      const linear = new THREE.Matrix3().setFromMatrix4(world);
      const d = new THREE.Vector3();
      targets.forEach((target, k) => {
        // the loader gives the blend shapes as moves from the mesh (or, when it says not, as places)
        const name = (names[k] ?? `shape_${k + 1}`).replace(/^blendshape\d*\./i, "") || `shape_${k + 1}`;
        const entries = moves.get(name) ?? [];
        moves.set(name, entries);
        for (let v = 0; v < position.count; v++) {
          d.set(target.getX(v), target.getY(v), target.getZ(v));
          if (!geo.morphTargetsRelative) d.sub(p.fromBufferAttribute(position, v));
          if (d.lengthSq() < 1e-14) continue;
          d.applyMatrix3(linear);
          entries.push({ tag: meshTag + v, d: [d.x, d.y, d.z] });
        }
      });
    }
    // (two materials that would go by the same name keep their own)
    const nameOf = (own: string) => { const named = materialNames.get(own); return named && ![...materialNames].some(([other, n]) => other !== own && n === named) ? named : own; };
    // the slots of the mesh, in their order (not the order the triangles use them in)
    for (const slot of materials) { const n = nameOf(slot?.name || "material"); if (!slotOrder.includes(n)) slotOrder.push(n); }
    for (const group of groups) {
      const material = nameOf(materials[group.materialIndex ?? 0]?.name || "material");
      let builder = accumulate.get(material);
      if (!builder) accumulate.set(material, (builder = new Builder(material)));
      for (let k = 0; k < group.count; k++) {
        const v = geo.index ? geo.index.getX(group.start + k) : group.start + k;
        p.fromBufferAttribute(position, v).applyMatrix4(world);
        if (normal) n.fromBufferAttribute(normal, v).applyMatrix3(normalMatrix).normalize(); else n.set(0, 1, 0);
        bounds.expandByPoint(p);
        const skin: [number, number][] = [];
        if (skinIndex && skinWeight) {
          for (let i = 0; i < 4; i++) {
            const w = [skinWeight.getX, skinWeight.getY, skinWeight.getZ, skinWeight.getW][i].call(skinWeight, v);
            const b = [skinIndex.getX, skinIndex.getY, skinIndex.getZ, skinIndex.getW][i].call(skinIndex, v);
            if (w > 1e-5) skin.push([builder.bone(bones[b] ?? ""), w]);
          }
        }
        if (!skin.length) skin.push([builder.bone(skinned.isSkinnedMesh ? "" : (nearestBoneName(o) ?? "")), 1]);
        builder.vertex(p.x, p.y, p.z, normal ? n.x : NaN, n.y, n.z, uv ? uv.getX(v) : 0, uv ? 1 - uv.getY(v) : 0, skin, targets.length ? meshTag + v : -1);
      }
    }
  });

  // The importer lists the materials of a model by name (A_hat before z_glass, whatever the order the file has them in): so does the item, whose
  // material files are numbered by that order.
  const inFile = [...accumulate.values()].map((b) => b.finish());
  const parts = [...inFile].sort((x, y) => (x.material.toLowerCase() < y.material.toLowerCase() ? -1 : x.material.toLowerCase() > y.material.toLowerCase() ? 1 : 0));
  const flexes = weldFlexes(parts, moves);
  const triangles = parts.reduce((t, part) => t + part.indices.length / 3, 0);
  const vertices = parts.reduce((t, part) => t + part.positions.length / 3, 0);
  const empty = bounds.isEmpty();
  return {
    parts,
    skeleton: [...skeletonOf].map(([name, bone]) => ({ name, parent: bone.parent, world: bone.world })),
    materials: parts.map((part) => part.material),
    triangles,
    vertices,
    bounds: { min: empty ? [0, 0, 0] : bounds.min.toArray(), max: empty ? [0, 0, 0] : bounds.max.toArray() },
    axes,
    ...(armatures.length ? { armatures } : {}),
    ...(slotOrderOf(slotOrder, parts.map((p) => p.material)) ? { fileMaterialOrder: slotOrderOf(slotOrder, parts.map((p) => p.material)) } : {}),
    ...(flexes.length ? { flexes, flexControls: flexes.map((f) => ({ name: f.name, raw: [f.name], stereo: false, eyelid: false, wrinkle: [0] })) } : {}),
  };
}

/** The slot order of the materials (only the ones the model uses), when it differs from the listed order; undefined when it is the same. */
function slotOrderOf(slots: string[], listed: string[]): string[] | undefined {
  const order = slots.filter((n) => listed.includes(n));
  return order.some((n, i) => n !== listed[i]) ? order : undefined;
}

/** The closest bone above an unskinned mesh in the file. */
function nearestBoneName(o: THREE.Object3D): string | null {
  for (let p = o.parent; p; p = p.parent) if ((p as THREE.Bone).isBone) return p.name;
  return null;
}

/** Collects the corners of a material's triangles and welds the ones that are the same vertex. */
export class Builder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly uvs: number[] = [];
  private readonly skin: number[] = [];
  private readonly weights: number[] = [];
  private readonly indices: number[] = [];
  private readonly lookup = new Map<string, number>();
  private readonly boneNames: string[] = [];
  private readonly boneIndex = new Map<string, number>();
  private readonly tags: number[] = [];
  private pending: number[] = [];
  private missingNormals = false;
  constructor(readonly material: string) {}

  bone(name: string): number {
    let i = this.boneIndex.get(name);
    if (i === undefined) { i = this.boneNames.length; this.boneNames.push(name); this.boneIndex.set(name, i); }
    return i;
  }

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, skin: [number, number][], tag = -1) {
    if (Number.isNaN(nx)) { this.missingNormals = true; nx = ny = nz = 0; }
    // the strongest four influences, normalised
    const top = [...skin].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const total = top.reduce((t, s) => t + s[1], 0) || 1;
    const ids = [0, 0, 0, 0], ws = [0, 0, 0, 0];
    top.forEach(([bone, weight], i) => { ids[i] = bone; ws[i] = weight / total; });
    const q = (a: number) => Math.round(a * 1e4);
    const key = `${q(x)},${q(y)},${q(z)},${q(nx)},${q(ny)},${q(nz)},${q(u)},${q(v)},${ids.join()},${ws.map(q).join()},${tag}`;
    let index = this.lookup.get(key);
    if (index === undefined) {
      index = this.positions.length / 3;
      this.lookup.set(key, index);
      this.positions.push(x, y, z); this.normals.push(nx, ny, nz); this.uvs.push(u, v);
      this.skin.push(...ids); this.weights.push(...ws);
      this.tags.push(tag);
    }
    this.pending.push(index);
    if (this.pending.length === 3) {
      const [a, b, c] = this.pending;
      if (a !== b && b !== c && a !== c) this.indices.push(a, b, c);
      this.pending = [];
    }
  }

  finish(): ImportedPart {
    const positions = new Float32Array(this.positions), indices = new Uint32Array(this.indices);
    const normals = this.missingNormals ? computeNormals(positions, indices) : new Float32Array(this.normals);
    return {
      material: this.material, positions, normals, uvs: new Float32Array(this.uvs), indices,
      boneNames: this.boneNames, skinIndices: new Uint16Array(this.skin), skinWeights: new Float32Array(this.weights),
      winding: windingSign({ positions, normals, indices }),
      ...(this.tags.some((t) => t >= 0) ? { sources: Int32Array.from(this.tags) } : {}),
    };
  }
}
