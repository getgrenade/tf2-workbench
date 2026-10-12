import * as THREE from "three";
import { Builder, MAYA_AXES, weldFlexes, type ImportedBone, type ImportedFlexControl, type ImportedModel } from "./fbx";
import { readDmx, type DmxElement, type DmxValue } from "./dmxFormat";

/**
 * Reads the model of a Datamodel file (.dmx, what Source's own tools, Blender Source Tools and the 3ds Max and Maya exporters write)
 * into the same form as an FBX: welded parts with their skin, and the skeleton in the Y-up frame of the game.
 *
 * The file is a tree of DmeDag nodes (DmeJoint is a bone) with a transform each; a DmeDag with a shape holds a mesh whose vertices are in
 * the node's own space. The shape keys of a mesh are its `deltaStates` (a list of vertex deltas by position), and the sliders that drive them
 * are the controls of the file's `combinationOperator`. A mesh's vertex data keeps positions, normals and texture coordinates in arrays of their own with an index list
 * for each, the faces list vertices (a polygon ends at -1), and the skin (`jointWeights`, `jointIndices`) goes with the positions.
 */

const el = (v: DmxValue | undefined): DmxElement | null => (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Uint8Array) ? (v as DmxElement) : null);
const list = (v: DmxValue | undefined): DmxValue[] => (Array.isArray(v) ? (v as DmxValue[]) : []);
const elements = (v: DmxValue | undefined): DmxElement[] => list(v).map(el).filter((e): e is DmxElement => !!e);
const numbers = (v: DmxValue | undefined): number[] => (Array.isArray(v) ? (v as number[]) : []);
const vectors = (v: DmxValue | undefined): number[][] => (Array.isArray(v) ? (v as number[][]) : []);

/** The matrix of a DmeTransform (position, orientation as a quaternion x y z w). */
function transformMatrix(t: DmxElement | null): THREE.Matrix4 {
  const position = numbers(t?.attrs.get("position"));
  const q = numbers(t?.attrs.get("orientation"));
  const quaternion = q.length === 4 ? new THREE.Quaternion(q[0], q[1], q[2], q[3]).normalize() : new THREE.Quaternion();
  return new THREE.Matrix4().compose(new THREE.Vector3(position[0] ?? 0, position[1] ?? 0, position[2] ?? 0), quaternion, new THREE.Vector3(1, 1, 1));
}

interface Dag { element: DmxElement; parent: Dag | null; world: THREE.Matrix4 }

export function importDmx(buffer: ArrayBuffer): ImportedModel {
  const { root } = readDmx(buffer);
  const model = el(root.attrs.get("skeleton")) ?? el(root.attrs.get("model"));
  if (!model) throw new Error("the .dmx has no model");
  // a file that says its up axis is Z (the exporters of Z-up programs write it) is turned into the game's Y-up frame
  const axis = el(root.attrs.get("axisSystem"));
  const zUp = axis?.attrs.get("upAxis") === 3;
  const toGame = zUp ? new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1) : new THREE.Matrix4();

  const dags: Dag[] = [];
  const byTransform = new Map<DmxElement, Dag>();
  const visit = (element: DmxElement, parent: Dag | null) => {
    const transform = el(element.attrs.get("transform"));
    const dag: Dag = { element, parent, world: new THREE.Matrix4().multiplyMatrices(parent?.world ?? toGame, transformMatrix(transform)) };
    dags.push(dag);
    if (transform) byTransform.set(transform, dag);
    for (const child of elements(element.attrs.get("children"))) visit(child, dag);
  };
  visit(model, null);

  // the bones: the joints, each under its nearest joint
  const isJoint = (d: Dag) => d.element.type === "DmeJoint";
  const boneParent = (d: Dag): string | null => { for (let p = d.parent; p; p = p.parent) if (isJoint(p)) return p.element.name; return null; };
  const skeleton: ImportedBone[] = dags.filter(isJoint).map((d) => ({ name: d.element.name, parent: boneParent(d), world: d.world.toArray() }));
  // the joints the skin counts by (the list of transforms), by name
  const jointNames = elements(model.attrs.get("jointTransforms")).map((t) => byTransform.get(t)?.element.name ?? "");

  const accumulate = new Map<string, Builder>();
  const bounds = new THREE.Box3();
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  // the shape keys by name: where each one moves which positions (a position of a mesh is its tag; the meshes count on from each other)
  const deltas = new Map<string, { tag: number; d: [number, number, number] }[]>();
  let tagBase = 0;
  for (const dag of dags) {
    const mesh = el(dag.element.attrs.get("shape"));
    if (!mesh) continue;
    const data = el(mesh.attrs.get("currentState")) ?? el(list(mesh.attrs.get("baseStates"))[0]);
    if (!data) continue;
    const positions = vectors(data.attrs.get("positions")), positionIndex = numbers(data.attrs.get("positionsIndices"));
    const normals = vectors(data.attrs.get("normals")), normalIndex = numbers(data.attrs.get("normalsIndices"));
    const uvs = vectors(data.attrs.get("textureCoordinates")), uvIndex = numbers(data.attrs.get("textureCoordinatesIndices"));
    const weights = numbers(data.attrs.get("jointWeights")), joints = numbers(data.attrs.get("jointIndices"));
    const jointCount = Number(data.attrs.get("jointCount") ?? 0) || (positions.length ? Math.round(weights.length / positions.length) : 0);
    const flip = data.attrs.get("flipVCoordinates") === true;
    const world = dag.world;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(world);
    const states = elements(mesh.attrs.get("deltaStates"));
    const flexed = states.length > 0;
    const meshTag = tagBase;
    tagBase += positions.length;
    const linear = new THREE.Matrix3().setFromMatrix4(world);
    const d = new THREE.Vector3();
    for (const state of states) {
      const moves = vectors(state.attrs.get("positions")), at = numbers(state.attrs.get("positionsIndices"));
      const entries = deltas.get(state.name) ?? [];
      deltas.set(state.name, entries);
      at.forEach((pi, i) => {
        const m = moves[i];
        if (!m || (m[0] === 0 && m[1] === 0 && m[2] === 0)) return;
        d.set(m[0], m[1], m[2]).applyMatrix3(linear);
        entries.push({ tag: meshTag + pi, d: [d.x, d.y, d.z] });
      });
    }
    // an unskinned mesh follows the joint it hangs from
    let holder = "";
    for (let d: Dag | null = dag; d; d = d.parent) if (isJoint(d)) { holder = d.element.name; break; }
    for (const set of elements(mesh.attrs.get("faceSets"))) {
      const material = (el(set.attrs.get("material"))?.attrs.get("mtlName") as string | undefined) ?? set.name ?? "material";
      const name = material.replace(/^.*[\\/]/, "").replace(/\.(vmt|tga|png|bmp)$/i, "") || "material";
      let builder = accumulate.get(name);
      if (!builder) accumulate.set(name, (builder = new Builder(name)));
      const faces = numbers(set.attrs.get("faces"));
      let polygon: number[] = [];
      const corner = (vertex: number) => {
        const pi = positionIndex.length ? positionIndex[vertex] : vertex;
        const ni = normalIndex.length ? normalIndex[vertex] : vertex;
        const ti = uvIndex.length ? uvIndex[vertex] : vertex;
        const position = positions[pi];
        if (!position) return;
        p.set(position[0], position[1], position[2]).applyMatrix4(world);
        const normal = normals[ni];
        if (normal) n.set(normal[0], normal[1], normal[2]).applyMatrix3(normalMatrix).normalize();
        bounds.expandByPoint(p);
        const skin: [number, number][] = [];
        for (let k = 0; k < jointCount; k++) {
          const w = weights[pi * jointCount + k] ?? 0;
          const j = joints[pi * jointCount + k] ?? -1;
          if (w > 1e-5 && j >= 0) skin.push([builder!.bone(jointNames[j] ?? ""), w]);
        }
        if (!skin.length) skin.push([builder!.bone(holder), 1]);
        const uv = uvs[ti] ?? [0, 0];
        builder!.vertex(p.x, p.y, p.z, normal ? n.x : NaN, n.y, n.z, uv[0], flip ? 1 - uv[1] : uv[1], skin, flexed ? meshTag + pi : -1);
      };
      for (const f of faces) {
        if (f >= 0) { polygon.push(f); continue; }
        // a polygon is cut into a fan of triangles
        for (let i = 1; i + 1 < polygon.length; i++) { corner(polygon[0]); corner(polygon[i]); corner(polygon[i + 1]); }
        polygon = [];
      }
    }
  }

  const parts = [...accumulate.values()].map((b) => b.finish());
  const flexes = weldFlexes(parts, deltas);
  // the sliders: the file's, else one for each shape key
  const operator = el(root.attrs.get("combinationOperator"));
  let flexControls: ImportedFlexControl[] = elements(operator?.attrs.get("controls")).map((c) => ({
    name: c.name,
    raw: list(c.attrs.get("rawControlNames")).map(String),
    stereo: c.attrs.get("stereo") === true,
    eyelid: c.attrs.get("eyelid") === true,
    wrinkle: numbers(c.attrs.get("wrinkleScales")),
  }));
  if (!flexControls.length) flexControls = flexes.map((f) => ({ name: f.name, raw: [f.name], stereo: false, eyelid: false, wrinkle: [0] }));
  const empty = bounds.isEmpty();
  return {
    parts,
    skeleton,
    ...(flexes.length ? { flexes, flexControls } : {}),
    materials: parts.map((part) => part.material),
    triangles: parts.reduce((t, part) => t + part.indices.length / 3, 0),
    vertices: parts.reduce((t, part) => t + part.positions.length / 3, 0),
    bounds: { min: empty ? [0, 0, 0] : bounds.min.toArray(), max: empty ? [0, 0, 0] : bounds.max.toArray() },
    axes: MAYA_AXES,
  };
}
