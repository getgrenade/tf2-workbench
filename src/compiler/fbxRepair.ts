/**
 * A binary FBX can have a node (an armature's empty, say) that no connection mentions: the file has it, but it hangs on nothing. Blender and the
 * FBX SDK take it as a child of the scene; three's FBXLoader looks its connections up and fails on it ("Cannot read properties of undefined
 * (reading 'parents')"). This adds the missing connection to the scene root, for each such node, so the loader can read the file.
 *
 * Only for binary files before version 7500 (32-bit offsets); anything else is left alone (null).
 */

interface Rec { start: number; end: number; name: string; props: { type: string; value: number | string }[]; propsEnd: number; kids: Rec[] }

const MAGIC = "Kaydara FBX Binary  ";

function parseProps(b: Uint8Array, dv: DataView, at: number, count: number): { props: Rec["props"]; end: number } {
  const props: Rec["props"] = [];
  for (let i = 0; i < count; i++) {
    const t = String.fromCharCode(b[at]);
    at++;
    if ("fdilb".includes(t)) { const clen = dv.getUint32(at + 8, true); props.push({ type: t, value: 0 }); at += 12 + clen; continue; }
    switch (t) {
      case "Y": props.push({ type: t, value: dv.getInt16(at, true) }); at += 2; break;
      case "C": props.push({ type: t, value: b[at] }); at += 1; break;
      case "I": props.push({ type: t, value: dv.getInt32(at, true) }); at += 4; break;
      case "F": props.push({ type: t, value: dv.getFloat32(at, true) }); at += 4; break;
      case "D": props.push({ type: t, value: dv.getFloat64(at, true) }); at += 8; break;
      case "L": props.push({ type: t, value: Number(dv.getBigInt64(at, true)) }); at += 8; break;
      case "S": case "R": { const n = dv.getUint32(at, true); props.push({ type: t, value: t === "S" ? new TextDecoder("latin1").decode(b.subarray(at + 4, at + 4 + n)) : n }); at += 4 + n; break; }
      default: throw new Error("unknown property type");
    }
  }
  return { props, end: at };
}

function parseNode(b: Uint8Array, dv: DataView, at: number, descend: Set<string>): Rec | null {
  const end = dv.getUint32(at, true);
  if (!end) return null;
  const count = dv.getUint32(at + 4, true);
  const nameLength = b[at + 12];
  const name = new TextDecoder("latin1").decode(b.subarray(at + 13, at + 13 + nameLength));
  const { props, end: propsEnd } = parseProps(b, dv, at + 13 + nameLength, count);
  const kids: Rec[] = [];
  if (descend.has(name)) {
    for (let q = propsEnd; q < end;) {
      const kid = parseNode(b, dv, q, descend);
      if (!kid) break;
      kids.push(kid);
      q = kid.end;
    }
  }
  return { start: at, end, name, props, propsEnd, kids };
}

/** The file with the missing connections added, or null when there is nothing to add (or it is not a file this knows). */
export function connectOrphanModels(buffer: ArrayBuffer): ArrayBuffer | null {
  const b = new Uint8Array(buffer);
  if (b.length < 40 || new TextDecoder("latin1").decode(b.subarray(0, MAGIC.length)) !== MAGIC) return null;
  const dv = new DataView(buffer);
  const version = dv.getUint32(23, true);
  if (version >= 7500) return null;
  let objects: Rec | null = null, connections: Rec | null = null;
  const top: Rec[] = [];
  const descend = new Set(["Objects", "Connections"]);
  try {
    for (let at = 27; at + 13 <= b.length;) {
      const rec = parseNode(b, dv, at, descend);
      if (!rec) break;
      top.push(rec);
      if (rec.name === "Objects") objects = rec;
      if (rec.name === "Connections") connections = rec;
      at = rec.end;
    }
  } catch { return null; }
  if (!objects || !connections) return null;
  const mentioned = new Set<number>();
  for (const c of connections.kids) { mentioned.add(Number(c.props[1]?.value)); mentioned.add(Number(c.props[2]?.value)); }
  const orphans = objects.kids.filter((o) => o.name === "Model" && typeof o.props[0]?.value === "number" && !mentioned.has(o.props[0].value as number)).map((o) => o.props[0].value as number);
  if (!orphans.length) return null;

  // the new records: C "OO" <model> 0
  const record = (model: number): number[] => {
    const props = [0x53, 2, 0, 0, 0, 0x4f, 0x4f, 0x4c, ...le64(model), 0x4c, ...le64(0)]; // "OO", the model, the scene root (0)
    return [...le32(0), ...le32(3), ...le32(props.length), 1, 0x43, ...props]; // end (set below), 3 properties, their length, the name "C"
  };
  const insertAt = connections.end - 13; // before the blank record that closes Connections
  const extra: number[] = [];
  for (const model of orphans) {
    const start = insertAt + extra.length;
    const bytes = record(model);
    const end = start + bytes.length;
    bytes.splice(0, 4, ...le32(end));
    extra.push(...bytes);
  }
  const out = new Uint8Array(b.length + extra.length);
  out.set(b.subarray(0, insertAt), 0);
  out.set(extra, insertAt);
  out.set(b.subarray(insertAt), insertAt + extra.length);
  const odv = new DataView(out.buffer);
  // Connections ends later, and so does everything after it
  odv.setUint32(connections.start, connections.end + extra.length, true);
  for (const rec of top) if (rec.start >= connections.end) shiftAfter(out, odv, rec.start + extra.length, extra.length);
  return out.buffer;
}

/** Moves the offsets of a record that has already been moved to `at` (its end still says where it was), and of what is in it, by `by`. */
function shiftAfter(b: Uint8Array, dv: DataView, at: number, by: number) {
  const oldEnd = dv.getUint32(at, true);
  const propsLength = dv.getUint32(at + 8, true);
  const nameLength = b[at + 12];
  dv.setUint32(at, oldEnd + by, true);
  let q = at + 13 + nameLength + propsLength;
  const end = oldEnd + by;
  while (q + 13 <= end) {
    const childOld = dv.getUint32(q, true);
    if (!childOld) break;
    shiftAfter(b, dv, q, by);
    q = childOld + by;
  }
}

const le32 = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
const le64 = (v: number) => [...le32(v), 0, 0, 0, 0];
