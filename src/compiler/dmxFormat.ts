/**
 * Reads the container of a Valve Datamodel file (.dmx): a graph of named elements with typed attributes. The binary encodings
 * (1 to 5, the ones Source's tools and the Blender and 3ds Max exporters write) are read; the text one (keyvalues2) is not. What the
 * elements mean (a model, its skeleton, its meshes) is dmxImport.ts's business.
 */

export type DmxValue = number | boolean | string | DmxElement | null | number[] | Uint8Array | DmxValue[];

export interface DmxElement {
  type: string;
  name: string;
  attrs: Map<string, DmxValue>;
}

/** The attribute types of the binary encoding; the arrays of each are `type + 14`. */
const T = { element: 1, int: 2, float: 3, bool: 4, string: 5, binary: 6, time: 7, color: 8, vec2: 9, vec3: 10, vec4: 11, angle: 12, quat: 13, matrix: 14 } as const;
const VECTOR_SIZE: Record<number, number> = { [T.vec2]: 2, [T.vec3]: 3, [T.vec4]: 4, [T.angle]: 3, [T.quat]: 4, [T.matrix]: 16 };

class Reader {
  at = 0;
  readonly view: DataView;
  constructor(readonly bytes: Uint8Array) { this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
  u8() { return this.bytes[this.at++]; }
  i16() { const v = this.view.getInt16(this.at, true); this.at += 2; return v; }
  i32() { const v = this.view.getInt32(this.at, true); this.at += 4; return v; }
  f32() { const v = this.view.getFloat32(this.at, true); this.at += 4; return v; }
  cstring() {
    let end = this.at;
    while (end < this.bytes.length && this.bytes[end] !== 0) end++;
    const s = new TextDecoder("utf-8").decode(this.bytes.subarray(this.at, end));
    this.at = end + 1;
    return s;
  }
  floats(n: number) { const out: number[] = []; for (let i = 0; i < n; i++) out.push(this.f32()); return out; }
}

/** The text of the first line of a file: `<!-- dmx encoding binary 2 format model 1 -->`. */
function header(bytes: Uint8Array) {
  let end = 0;
  while (end < Math.min(bytes.length, 200) && bytes[end] !== 10) end++;
  const line = new TextDecoder("latin1").decode(bytes.subarray(0, end));
  const m = /^<!--\s*dmx\s+encoding\s+(\w+)\s+(\d+)\s+format\s+(\S+)\s+(\d+)\s*-->/i.exec(line);
  if (!m) throw new Error("not a Datamodel (.dmx) file");
  return { encoding: m[1].toLowerCase(), version: Number(m[2]), format: m[3], formatVersion: Number(m[4]), end: end + 1 };
}

export interface DmxFile { root: DmxElement; format: string }

export function readDmx(buffer: ArrayBuffer): DmxFile {
  const bytes = new Uint8Array(buffer);
  const head = header(bytes);
  if (head.encoding === "binary") return { root: readBinary(bytes, head.end, head.version), format: head.format };
  throw new Error(head.encoding === "keyvalues2" ? "this is a text (keyvalues2) .dmx: export it as binary" : `unsupported Datamodel encoding: ${head.encoding}`);
}

function readBinary(bytes: Uint8Array, start: number, version: number): DmxElement {
  const r = new Reader(bytes);
  // the header line ends with a newline and a zero byte
  r.at = start + (bytes[start] === 0 ? 1 : 0);
  // an encoding from 2 on keeps its names in a table (short indexes up to 4, int from 5)
  const wide = version >= 5;
  const strings: string[] = [];
  if (version >= 2) {
    const count = wide ? r.i32() : r.i16();
    for (let i = 0; i < count; i++) strings.push(r.cstring());
  }
  const name = () => (version >= 2 ? strings[wide ? r.i32() : r.i16()] ?? "" : r.cstring());
  const elementCount = r.i32();
  const elements: DmxElement[] = [];
  for (let i = 0; i < elementCount; i++) {
    const type = name();
    // from encoding 4 the name of an element is in the table too
    const elementName = version >= 4 ? name() : r.cstring();
    r.at += 16; // the id
    elements.push({ type, name: elementName, attrs: new Map() });
  }
  const element = (index: number): DmxElement | null => (index >= 0 ? elements[index] ?? null : null);
  const scalar = (type: number): DmxValue => {
    switch (type) {
      case T.element: { const index = r.i32(); if (index === -2) { r.cstring(); return null; } return element(index); }
      case T.int: return r.i32();
      case T.float: return r.f32();
      case T.bool: return r.u8() !== 0;
      case T.string: return version >= 4 ? (strings[wide ? r.i32() : r.i16()] ?? "") : r.cstring();
      case T.binary: { const n = r.i32(); const v = bytes.slice(r.at, r.at + n); r.at += n; return v; }
      case T.time: return r.i32() / 10000;
      case T.color: { const v = [r.u8(), r.u8(), r.u8(), r.u8()]; return v; }
      default: return r.floats(VECTOR_SIZE[type]);
    }
  };
  for (const e of elements) {
    const attributes = r.i32();
    for (let k = 0; k < attributes; k++) {
      const key = name();
      const type = r.u8();
      if (type > 14) {
        const base = type - 14;
        const n = r.i32();
        const list: DmxValue[] = [];
        // an array of strings keeps them inline in every encoding below 5 (and in the table from there)
        for (let i = 0; i < n; i++) list.push(base === T.string ? (version >= 5 ? (strings[r.i32()] ?? "") : r.cstring()) : scalar(base));
        e.attrs.set(key, list);
      } else e.attrs.set(key, scalar(type));
    }
  }
  if (!elements.length) throw new Error("the Datamodel file has no elements");
  return elements[0];
}
