import * as THREE from "three";
import { Builder, MAYA_AXES, type ImportedBone, type ImportedModel } from "./fbx";

/**
 * Reads a Studiomdl Data file (.smd): the bones with their pose at the first frame, and the triangles with their skin. The file is in Source's
 * own frame (X forward, Y left, Z up) unless the artist's QC said `$upaxis Y`; the model is turned into the game's Y-up frame the way
 * `$upaxis Z` (the default of studiomdl) does it, which is how nearly every .smd is made. The writer in smd.ts is the other way round.
 *
 * `yUp` reads a file made in Y-up as it is.
 */
export function importSmd(buffer: ArrayBuffer, yUp = false): ImportedModel {
  const lines = new TextDecoder("utf-8").decode(buffer).split(/\r?\n/);
  const toGame = yUp ? new THREE.Matrix4() : new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(toGame);

  const nodes: { name: string; parent: number }[] = [];
  const pose = new Map<number, THREE.Matrix4>();
  let section = "";
  let poseTime: number | null = null;
  const triangles: { material: string; corners: string[] }[] = [];
  let pending: { material: string; corners: string[] } | null = null;
  for (let raw of lines) {
    raw = raw.trim();
    if (!raw || raw.startsWith("//") || raw.startsWith("#")) continue;
    if (raw === "end") { section = ""; pending = null; continue; }
    if (!section) {
      if (raw === "nodes" || raw === "skeleton" || raw === "triangles" || raw === "vertexanimation") section = raw;
      continue;
    }
    if (section === "nodes") {
      const m = /^(\d+)\s+"([^"]*)"\s+(-?\d+)/.exec(raw);
      if (m) nodes[Number(m[1])] = { name: m[2], parent: Number(m[3]) };
    } else if (section === "skeleton") {
      if (raw.startsWith("time")) { poseTime ??= Number(raw.split(/\s+/)[1]); if (Number(raw.split(/\s+/)[1]) !== poseTime) section = "skip"; continue; }
      const f = raw.split(/\s+/).map(Number);
      if (f.length >= 7 && !pose.has(f[0])) {
        // Source's Euler angles: roll about X, pitch about Y, yaw about Z, composed Rz * Ry * Rx
        pose.set(f[0], new THREE.Matrix4().compose(new THREE.Vector3(f[1], f[2], f[3]), new THREE.Quaternion().setFromEuler(new THREE.Euler(f[4], f[5], f[6], "ZYX")), new THREE.Vector3(1, 1, 1)));
      }
    } else if (section === "triangles") {
      if (!pending) { pending = { material: raw, corners: [] }; continue; }
      pending.corners.push(raw);
      if (pending.corners.length === 3) { triangles.push(pending); pending = null; }
    }
  }
  if (!nodes.length) throw new Error("not a Studiomdl Data (.smd) file: it has no bones");

  // the bones in the world of the game, parents before children
  const worlds: THREE.Matrix4[] = [];
  const worldOf = (i: number): THREE.Matrix4 => {
    if (worlds[i]) return worlds[i];
    const local = pose.get(i) ?? new THREE.Matrix4();
    const parent = nodes[i]?.parent ?? -1;
    return (worlds[i] = parent >= 0 && parent < nodes.length && parent !== i ? new THREE.Matrix4().multiplyMatrices(worldOf(parent), local) : local.clone());
  };
  const skeleton: ImportedBone[] = nodes.map((node, i) => ({
    name: node.name,
    parent: node.parent >= 0 && nodes[node.parent] ? nodes[node.parent].name : null,
    world: new THREE.Matrix4().multiplyMatrices(toGame, worldOf(i)).toArray(),
  }));

  const accumulate = new Map<string, Builder>();
  const bounds = new THREE.Box3();
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  for (const tri of triangles) {
    const name = tri.material.replace(/^.*[\\/]/, "").replace(/\.(vmt|tga|png|bmp|vtf)$/i, "") || "material";
    let builder = accumulate.get(name);
    if (!builder) accumulate.set(name, (builder = new Builder(name)));
    for (const corner of tri.corners) {
      const f = corner.split(/\s+/).map(Number);
      if (f.length < 9) continue;
      p.set(f[1], f[2], f[3]).applyMatrix4(toGame);
      n.set(f[4], f[5], f[6]).applyMatrix3(normalMatrix).normalize();
      bounds.expandByPoint(p);
      const skin: [number, number][] = [];
      const links = f[9] ?? 0;
      for (let k = 0; k < links; k++) {
        const bone = f[10 + k * 2], weight = f[11 + k * 2];
        if (weight > 1e-5 && nodes[bone]) skin.push([builder.bone(nodes[bone].name), weight]);
      }
      // a vertex with no links belongs to the bone it names
      if (!skin.length && nodes[f[0]]) skin.push([builder.bone(nodes[f[0]].name), 1]);
      // SMD texture coordinates run up from the bottom; ours run down from the top
      builder.vertex(p.x, p.y, p.z, n.x, n.y, n.z, f[7], 1 - f[8], skin);
    }
  }

  const parts = [...accumulate.values()].map((b) => b.finish());
  const empty = bounds.isEmpty();
  return {
    parts,
    skeleton,
    materials: parts.map((part) => part.material),
    triangles: parts.reduce((t, part) => t + part.indices.length / 3, 0),
    vertices: parts.reduce((t, part) => t + part.positions.length / 3, 0),
    bounds: { min: empty ? [0, 0, 0] : bounds.min.toArray(), max: empty ? [0, 0, 0] : bounds.max.toArray() },
    axes: MAYA_AXES,
  };
}
