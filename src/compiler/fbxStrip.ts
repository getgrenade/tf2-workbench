import * as THREE from "three";

/**
 * Takes the armature node out of a binary FBX (7.4 and older, 32-bit offsets) by editing the file itself, and leaves the rest of it as it is: the mesh, the
 * skin, the materials, the shape keys, the bind pose, all that the exporter wrote. The armature object of Blender is written as an empty node ("Null")
 * that the bones hang on; the item importer takes it for a bone of the item. Its children go to the scene, with its transform in theirs, so they stay
 * where they were.
 *
 * What it does not do: a file with a layout it does not know (an armature with a scale that is not the same on all axes, a child that has pre-rotations or
 * another rotation order, a 64-bit file) is not touched: it throws, and says why.
 */

interface RawArray { t: "f" | "d" | "l" | "i" | "b"; length: number; encoding: number; bytes: Uint8Array }
type Prop = { t: "I" | "L" | "D" | "F" | "Y" | "C"; v: number | bigint } | { t: "S" | "R"; v: Uint8Array } | RawArray;
interface Node { name: string; props: Prop[]; children: Node[]; sentinel: boolean }

const MAGIC = "Kaydara FBX Binary  ";
const text = new TextDecoder("latin1");

function readProp(b: Uint8Array, dv: DataView, at: number): [Prop, number] {
  const t = String.fromCharCode(b[at]);
  at++;
  if ("fdilb".includes(t)) {
    const length = dv.getUint32(at, true), encoding = dv.getUint32(at + 4, true), clen = dv.getUint32(at + 8, true);
    return [{ t: t as RawArray["t"], length, encoding, bytes: b.slice(at + 12, at + 12 + clen) }, at + 12 + clen];
  }
  switch (t) {
    case "Y": return [{ t: "Y", v: dv.getInt16(at, true) }, at + 2];
    case "C": return [{ t: "C", v: b[at] }, at + 1];
    case "I": return [{ t: "I", v: dv.getInt32(at, true) }, at + 4];
    case "F": return [{ t: "F", v: dv.getFloat32(at, true) }, at + 4];
    case "D": return [{ t: "D", v: dv.getFloat64(at, true) }, at + 8];
    case "L": return [{ t: "L", v: dv.getBigInt64(at, true) }, at + 8];
    case "S": case "R": { const n = dv.getUint32(at, true); return [{ t: t as "S" | "R", v: b.slice(at + 4, at + 4 + n) }, at + 4 + n]; }
  }
  throw new Error("unknown property type");
}

function readNode(b: Uint8Array, dv: DataView, at: number): Node | null {
  const end = dv.getUint32(at, true);
  if (!end) return null;
  const count = dv.getUint32(at + 4, true), propsLength = dv.getUint32(at + 8, true), nameLength = b[at + 12];
  const name = text.decode(b.subarray(at + 13, at + 13 + nameLength));
  let q = at + 13 + nameLength;
  const props: Prop[] = [];
  for (let i = 0; i < count; i++) { const [p, next] = readProp(b, dv, q); props.push(p); q = next; }
  if (q !== at + 13 + nameLength + propsLength) throw new Error("a node's properties do not end where they say");
  const children: Node[] = [];
  let sentinel = false;
  while (q < end) {
    if (end - q === 13 && b.subarray(q, end).every((x) => x === 0)) { sentinel = true; break; }
    const child = readNode(b, dv, q);
    if (!child) break;
    children.push(child);
    q = dv.getUint32(q, true);
  }
  return { name, props, children, sentinel };
}

class Out {
  private data = new Uint8Array(1 << 20);
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
  bytes(b: ArrayLike<number>) { this.ensure(b.length); this.data.set(b as ArrayLike<number>, this.length); this.length += b.length; }
  patch32(at: number, v: number) { this.view.setUint32(at, v, true); }
  result() { return this.data.slice(0, this.length); }
}

function writeProp(out: Out, p: Prop) {
  switch (p.t) {
    case "I": out.u8(0x49); out.u32(Number(p.v) >>> 0); break;
    case "Y": out.u8(0x59); out.u8(Number(p.v) & 255); out.u8((Number(p.v) >> 8) & 255); break;
    case "C": out.u8(0x43); out.u8(Number(p.v)); break;
    case "F": { out.u8(0x46); const d = new DataView(new ArrayBuffer(4)); d.setFloat32(0, Number(p.v), true); out.bytes(new Uint8Array(d.buffer)); break; }
    case "D": { out.u8(0x44); const d = new DataView(new ArrayBuffer(8)); d.setFloat64(0, Number(p.v), true); out.bytes(new Uint8Array(d.buffer)); break; }
    case "L": { out.u8(0x4c); const d = new DataView(new ArrayBuffer(8)); d.setBigInt64(0, BigInt(p.v), true); out.bytes(new Uint8Array(d.buffer)); break; }
    case "S": case "R": out.u8(p.t === "S" ? 0x53 : 0x52); out.u32(p.v.length); out.bytes(p.v); break;
    default: out.u8(p.t.charCodeAt(0)); out.u32(p.length); out.u32(p.encoding); out.u32(p.bytes.length); out.bytes(p.bytes);
  }
}

function writeNode(out: Out, n: Node) {
  const start = out.length;
  out.u32(0);
  out.u32(n.props.length);
  const lengthAt = out.length;
  out.u32(0);
  const name = new TextEncoder().encode(n.name);
  out.u8(name.length);
  out.bytes(name);
  const propsStart = out.length;
  for (const p of n.props) writeProp(out, p);
  out.patch32(lengthAt, out.length - propsStart);
  for (const c of n.children) writeNode(out, c);
  if (n.sentinel || n.children.length) for (let i = 0; i < 13; i++) out.u8(0);
  out.patch32(start, out.length);
}

const str = (p: Prop | undefined) => (p && (p.t === "S" || p.t === "R") ? text.decode(p.v) : "");
const num = (p: Prop | undefined) => (p && (p.t === "I" || p.t === "L" || p.t === "D" || p.t === "F" || p.t === "Y" || p.t === "C") ? Number(p.v) : NaN);
/** The name of an object: what is before the separator. */
const objectName = (p: Prop | undefined) => str(p).split("\u0000")[0];

/** One property of a node's Properties70 (undefined when it is not there). */
const property = (model: Node, name: string) => model.children.find((c) => c.name === "Properties70")?.children.find((c) => c.name === "P" && str(c.props[0]) === name);

function vector(model: Node, name: string, fallback: [number, number, number]): [number, number, number] {
  const p = property(model, name);
  return p ? [num(p.props[4]), num(p.props[5]), num(p.props[6])] : fallback;
}

function setVector(model: Node, name: string, value: [number, number, number]) {
  let list = model.children.find((c) => c.name === "Properties70");
  if (!list) { list = { name: "Properties70", props: [], children: [], sentinel: true }; model.children.splice(Math.max(0, model.children.findIndex((c) => c.name === "Version") + 1), 0, list); }
  const bytes = (s: string) => new TextEncoder().encode(s);
  const entry: Node = { name: "P", props: [{ t: "S", v: bytes(name) }, { t: "S", v: bytes(name) }, { t: "S", v: bytes("") }, { t: "S", v: bytes("A") }, ...value.map((v): Prop => ({ t: "D", v }))], children: [], sentinel: false };
  const at = list.children.findIndex((c) => c.name === "P" && str(c.props[0]) === name);
  if (at >= 0) list.children[at] = entry; else list.children.push(entry);
}

/** The pieces that make a node unsafe to move without a full look at it. */
function checkSimple(model: Node, what: string) {
  for (const key of ["PreRotation", "PostRotation", "RotationOffset", "RotationPivot", "ScalingOffset", "ScalingPivot", "GeometricTranslation", "GeometricRotation"]) {
    const p = property(model, key);
    if (p && [4, 5, 6].some((i) => Math.abs(num(p.props[i])) > 1e-9)) throw new Error(`${what} has ${key}`);
  }
  const order = property(model, "RotationOrder");
  if (order && num(order.props[4]) !== 0) throw new Error(`${what} has a rotation order other than XYZ`);
}

/**
 * The names the item importer gives the materials of a binary FBX: a material that has a diffuse texture goes by the file name of the texture
 * (`Z_hair_diffuse`), one that has none by its own name. By material name; empty when the file is not one this reads.
 */
export function importerMaterialNames(buffer: ArrayBuffer): Map<string, string> {
  const out = new Map<string, string>();
  try {
    const b = new Uint8Array(buffer);
    if (b.length < 40 || text.decode(b.subarray(0, MAGIC.length)) !== MAGIC) return out;
    const dv = new DataView(buffer);
    if (dv.getUint32(23, true) >= 7500) return out;
    let objects: Node | undefined, connections: Node | undefined;
    for (let at = 27; at + 13 <= b.length;) {
      const node = readNode(b, dv, at);
      if (!node) break;
      if (node.name === "Objects") objects = node;
      if (node.name === "Connections") connections = node;
      at = dv.getUint32(at, true);
    }
    if (!objects || !connections) return out;
    const id = (n: Node) => num(n.props[0]);
    const materials = new Map(objects.children.filter((n) => n.name === "Material").map((n) => [id(n), objectName(n.props[1])]));
    const files = new Map(objects.children.filter((n) => n.name === "Texture").map((n) => [id(n), str(n.children.find((c) => c.name === "FileName")?.props[0]) || str(n.children.find((c) => c.name === "RelativeFilename")?.props[0])]));
    for (const c of connections.children) {
      if (c.name !== "C" || str(c.props[0]) !== "OP" || str(c.props[3]) !== "DiffuseColor") continue;
      const name = materials.get(num(c.props[2])), file = files.get(num(c.props[1]));
      if (!name || !file) continue;
      const base = file.slice(Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\")) + 1).replace(/\.[^.]*$/, "");
      if (base) out.set(name, base);
    }
  } catch { /* a file this does not read goes by the names of its materials */ }
  return out;
}

const DEG = Math.PI / 180;

/**
 * The file without its armature nodes, or null when it has none. Throws (with the reason in the message) for a file this does not know how to edit.
 */
export function stripArmatures(buffer: ArrayBuffer): { bytes: Uint8Array; removed: string[] } | null {
  const b = new Uint8Array(buffer);
  if (b.length < 40 || text.decode(b.subarray(0, MAGIC.length)) !== MAGIC) throw new Error("not a binary FBX");
  const dv = new DataView(buffer);
  const version = dv.getUint32(23, true);
  if (version >= 7500) throw new Error("a 64-bit FBX (version 7.5 or newer) is not edited");
  const top: Node[] = [];
  let at = 27;
  for (;;) {
    if (at + 13 > b.length) throw new Error("the file ends inside its nodes");
    const node = readNode(b, dv, at);
    if (!node) break;
    top.push(node);
    at = dv.getUint32(at, true);
  }
  const objects = top.find((n) => n.name === "Objects"), connections = top.find((n) => n.name === "Connections");
  if (!objects || !connections) return null;

  const idOf = (n: Node) => num(n.props[0]);
  const models = objects.children.filter((n) => n.name === "Model");
  const byId = new Map(models.map((m) => [idOf(m), m]));
  const links = connections.children.filter((c) => c.name === "C" && str(c.props[0]) === "OO").map((c) => ({ child: num(c.props[1]), parent: num(c.props[2]), node: c }));
  const childrenOf = (id: number) => links.filter((l) => l.parent === id).map((l) => l.child);
  const parentOf = (id: number) => links.find((l) => l.child === id && (byId.has(l.parent) || l.parent === 0))?.parent ?? 0;
  const armatures = models.filter((m) => str(m.props[2]) === "Null" && childrenOf(idOf(m)).some((c) => str(byId.get(c)?.props[2]) === "LimbNode"));
  if (!armatures.length) return null;

  const removed: string[] = [];
  const dropped = new Set<number>();
  for (const armature of armatures) {
    const id = idOf(armature), name = objectName(armature.props[1]);
    checkSimple(armature, `the armature node ${name}`);
    const up = parentOf(id);
    if (up !== 0) throw new Error(`the armature node ${name} is not at the top of the scene`);
    const [tx, ty, tz] = vector(armature, "Lcl Translation", [0, 0, 0]), [rx, ry, rz] = vector(armature, "Lcl Rotation", [0, 0, 0]), [sx, sy, sz] = vector(armature, "Lcl Scaling", [1, 1, 1]);
    if (Math.abs(sx - sy) > 1e-6 || Math.abs(sy - sz) > 1e-6) throw new Error(`the armature node ${name} is scaled by different amounts on different axes`);
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx * DEG, ry * DEG, rz * DEG, "ZYX"));
    const translation = new THREE.Vector3(tx, ty, tz);
    for (const child of childrenOf(id)) {
      const model = byId.get(child);
      if (!model) continue;
      checkSimple(model, `${objectName(model.props[1])}, on the armature node,`);
      const [cx, cy, cz] = vector(model, "Lcl Translation", [0, 0, 0]), [crx, cry, crz] = vector(model, "Lcl Rotation", [0, 0, 0]), [csx, csy, csz] = vector(model, "Lcl Scaling", [1, 1, 1]);
      const turn = new THREE.Quaternion().setFromEuler(new THREE.Euler(crx * DEG, cry * DEG, crz * DEG, "ZYX"));
      const place = new THREE.Vector3(cx, cy, cz).multiplyScalar(sx).applyQuaternion(rotation).add(translation);
      const euler = new THREE.Euler().setFromQuaternion(rotation.clone().multiply(turn), "ZYX");
      setVector(model, "Lcl Translation", [place.x, place.y, place.z]);
      setVector(model, "Lcl Rotation", [euler.x / DEG, euler.y / DEG, euler.z / DEG]);
      setVector(model, "Lcl Scaling", [csx * sx, csy * sx, csz * sx]);
      // it hangs on the scene now
      for (const l of links) if (l.child === child && l.parent === id) l.node.props[2] = { t: "L", v: 0 };
    }
    dropped.add(id);
    removed.push(name);
  }

  // the armature nodes go, with what hangs on them that is not a model (their attributes) and every connection that names them
  const attributes = new Set<number>();
  for (const l of links) if (dropped.has(l.parent) && !byId.has(l.child)) attributes.add(l.child);
  const gone = new Set<number>([...dropped, ...attributes]);
  const removedByType = new Map<string, number>();
  objects.children = objects.children.filter((n) => {
    if (!gone.has(idOf(n))) return true;
    removedByType.set(n.name, (removedByType.get(n.name) ?? 0) + 1);
    return false;
  });
  connections.children = connections.children.filter((c) => !(c.name === "C" && (gone.has(num(c.props[1])) || gone.has(num(c.props[2])))));
  // the bind pose names its nodes
  for (const pose of objects.children.filter((n) => n.name === "Pose")) {
    const before = pose.children.length;
    pose.children = pose.children.filter((n) => !(n.name === "PoseNode" && gone.has(num(n.children.find((c) => c.name === "Node")?.props[0]))));
    const count = pose.children.find((c) => c.name === "NbPoseNodes");
    if (count && pose.children.length !== before) count.props[0] = { t: "I", v: pose.children.filter((n) => n.name === "PoseNode").length };
  }
  // the counts of the definitions
  const definitions = top.find((n) => n.name === "Definitions");
  if (definitions) {
    let total = 0;
    for (const type of definitions.children.filter((n) => n.name === "ObjectType")) {
      const count = type.children.find((c) => c.name === "Count");
      const less = removedByType.get(str(type.props[0]));
      if (count && less) count.props[0] = { t: "I", v: Math.max(0, num(count.props[0]) - less) };
      total += count ? num(count.props[0]) : 0;
    }
    const all = definitions.children.find((c) => c.name === "Count");
    if (all) all.props[0] = { t: "I", v: total };
  }

  const out = new Out();
  out.bytes(b.subarray(0, 27));
  for (const n of top) writeNode(out, n);
  for (let i = 0; i < 13; i++) out.u8(0);
  // the footer: what the original has after its last node, with the padding made again for the new length
  const footerAt = at + 13;
  out.bytes(b.subarray(footerAt, footerAt + 16));
  for (let i = 0; i < 4; i++) out.u8(0);
  const pad = ((out.length + 15) & ~15) - out.length;
  for (let i = 0; i < (pad === 0 ? 16 : pad); i++) out.u8(0);
  out.u32(version);
  for (let i = 0; i < 120; i++) out.u8(0);
  out.bytes(b.subarray(b.length - 16));
  return { bytes: out.result(), removed };
}
