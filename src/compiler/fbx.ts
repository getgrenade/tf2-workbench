import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
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
}

/** A 1x1 image for every texture the file names: the loader would otherwise try to fetch them. */
const BLANK_IMAGE = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

export function importFbx(buffer: ArrayBuffer): ImportedModel {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(() => BLANK_IMAGE);
  const root = new FBXLoader(manager).parse(buffer, "");
  root.updateMatrixWorld(true);
  const axes = readFbxAxes(buffer);
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

  const accumulate = new Map<string, Builder>();
  const bounds = new THREE.Box3();
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
    for (const group of groups) {
      const material = materials[group.materialIndex ?? 0]?.name || "material";
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
        builder.vertex(p.x, p.y, p.z, normal ? n.x : NaN, n.y, n.z, uv ? uv.getX(v) : 0, uv ? 1 - uv.getY(v) : 0, skin);
      }
    }
  });

  const parts = [...accumulate.values()].map((b) => b.finish());
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
  };
}

/** The closest bone above an unskinned mesh in the file. */
function nearestBoneName(o: THREE.Object3D): string | null {
  for (let p = o.parent; p; p = p.parent) if ((p as THREE.Bone).isBone) return p.name;
  return null;
}

/** Collects the corners of a material's triangles and welds the ones that are the same vertex. */
class Builder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly uvs: number[] = [];
  private readonly skin: number[] = [];
  private readonly weights: number[] = [];
  private readonly indices: number[] = [];
  private readonly lookup = new Map<string, number>();
  private readonly boneNames: string[] = [];
  private readonly boneIndex = new Map<string, number>();
  private pending: number[] = [];
  private missingNormals = false;
  constructor(readonly material: string) {}

  bone(name: string): number {
    let i = this.boneIndex.get(name);
    if (i === undefined) { i = this.boneNames.length; this.boneNames.push(name); this.boneIndex.set(name, i); }
    return i;
  }

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, skin: [number, number][]) {
    if (Number.isNaN(nx)) { this.missingNormals = true; nx = ny = nz = 0; }
    // the strongest four influences, normalised
    const top = [...skin].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const total = top.reduce((t, s) => t + s[1], 0) || 1;
    const ids = [0, 0, 0, 0], ws = [0, 0, 0, 0];
    top.forEach(([bone, weight], i) => { ids[i] = bone; ws[i] = weight / total; });
    const q = (a: number) => Math.round(a * 1e4);
    const key = `${q(x)},${q(y)},${q(z)},${q(nx)},${q(ny)},${q(nz)},${q(u)},${q(v)},${ids.join()},${ws.map(q).join()}`;
    let index = this.lookup.get(key);
    if (index === undefined) {
      index = this.positions.length / 3;
      this.lookup.set(key, index);
      this.positions.push(x, y, z); this.normals.push(nx, ny, nz); this.uvs.push(u, v);
      this.skin.push(...ids); this.weights.push(...ws);
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
    };
  }
}
