/** Source PCF files use the binary DMX element graph (TF2 assets: binary 2, PCF 1). */
export interface DmxRef { element: number }
export type DmxValue = number | boolean | string | DmxRef | null | DmxValue[];
export interface DmxElement { type: string; name: string; attributes: Record<string, DmxValue> }

export function parsePcf(buffer: ArrayBuffer): DmxElement[] {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let at = 0;
  const take = (n: number) => {
    if (!Number.isSafeInteger(n) || n < 0 || at + n > bytes.length) throw new Error(`Truncated PCF at ${at}`);
    const start = at; at += n; return start;
  };
  const u8 = () => view.getUint8(take(1));
  const u16 = () => view.getUint16(take(2), true);
  const i32 = () => view.getInt32(take(4), true);
  const f32 = () => { const n = view.getFloat32(take(4), true); if (!Number.isFinite(n)) throw new Error("Non-finite PCF value"); return n; };
  const text = () => {
    const start = at;
    while (at < bytes.length && bytes[at] !== 0) at++;
    take(1);
    return new TextDecoder().decode(bytes.subarray(start, at - 1));
  };
  const header = text().trim();
  if (header !== "<!-- dmx encoding binary 2 format pcf 1 -->") throw new Error(`Unsupported PCF format: ${header}`);
  const count = (n: number, max: number) => { if (n < 0 || n > max) throw new Error(`Invalid PCF count ${n}`); return n; };
  const strings = Array.from({ length: count(u16(), 65535) }, text);
  const indexed = () => { const s = strings[u16()]; if (s === undefined) throw new Error("Invalid PCF string index"); return s; };
  const elements = Array.from({ length: count(i32(), 50000) }, () => {
    const type = indexed(), name = text(); take(16); // element UUID
    return { type, name, attributes: {} as Record<string, DmxValue> };
  });
  const value = (type: number): DmxValue => {
    if (type >= 15 && type <= 28) return Array.from({ length: count(i32(), 100000) }, () => value(type - 14));
    switch (type) {
      case 1: { const index = i32(); if (index === -1) return null; if (index < 0 || index >= elements.length) throw new Error("Invalid PCF element reference"); return { element: index }; }
      case 2: return i32();
      case 3: return f32();
      case 4: return u8() !== 0;
      case 5: return text();
      case 6: { const n = count(i32(), bytes.length); const start = take(n); return Array.from(bytes.subarray(start, at)); }
      case 7: return Array.from(bytes.subarray(take(16), at));
      case 8: return [u8(), u8(), u8(), u8()];
      case 9: return [f32(), f32()];
      case 10: case 12: return [f32(), f32(), f32()];
      case 11: case 13: return [f32(), f32(), f32(), f32()];
      case 14: return Array.from({ length: 16 }, f32);
      default: throw new Error(`Unsupported DMX attribute type ${type}`);
    }
  };
  for (const e of elements) {
    const n = count(i32(), 10000);
    for (let i = 0; i < n; i++) { const key = indexed(); e.attributes[key] = value(u8()); }
  }
  if (at !== bytes.length) throw new Error(`Unexpected PCF trailing data (${bytes.length - at} bytes)`);
  return elements;
}

export function referenced(graph: DmxElement[], value: DmxValue | undefined): DmxElement[] {
  const refs = Array.isArray(value) ? value : [value];
  return refs.flatMap((v) => v && typeof v === "object" && !Array.isArray(v) && "element" in v ? [graph[v.element]] : []).filter(Boolean);
}

export interface ParticleDefinition { name: string; attributes: Record<string, DmxValue>; functions: Record<string, DmxElement[]>; children: { name: string; delay: number }[] }
export function particleDefinitions(graph: DmxElement[]): Map<string, ParticleDefinition> {
  return new Map(graph.filter((e) => e.type === "DmeParticleSystemDefinition").map((e) => [e.name, {
    name: e.name, attributes: e.attributes,
    functions: Object.fromEntries(["emitters", "initializers", "operators", "renderers", "forces", "constraints"].map((k) => [k, referenced(graph, e.attributes[k])])),
    children: referenced(graph, e.attributes.children).flatMap((child) => referenced(graph, child.attributes.child).map((def) => ({ name: def.name, delay: Number(child.attributes.delay ?? 0) }))),
  }]));
}
