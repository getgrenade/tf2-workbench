import type { DmxElement, DmxValue } from "../pcf";

export type Vec3 = [number, number, number];

/** The parameters of one function of a particle system (an element of the PCF), read by name the way Valve's unpacker does (case does not matter). */
export class Attrs {
  private readonly map = new Map<string, DmxValue>();
  readonly functionName: string;
  constructor(readonly element: DmxElement) {
    for (const [k, v] of Object.entries(element.attributes)) this.map.set(k.toLowerCase(), v);
    this.functionName = String(element.attributes.functionName ?? element.name);
  }
  has(key: string): boolean { return this.map.has(key.toLowerCase()); }
  raw(key: string): DmxValue | undefined { return this.map.get(key.toLowerCase()); }
  num(key: string, fallback = 0): number {
    const v = this.map.get(key.toLowerCase());
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    return fallback;
  }
  int(key: string, fallback = 0): number { return Math.trunc(this.num(key, fallback)); }
  bool(key: string, fallback = false): boolean {
    const v = this.map.get(key.toLowerCase());
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    return fallback;
  }
  str(key: string, fallback = ""): string {
    const v = this.map.get(key.toLowerCase());
    return typeof v === "string" ? v : fallback;
  }
  vec(key: string, fallback: Vec3 = [0, 0, 0]): Vec3 {
    const v = this.map.get(key.toLowerCase());
    if (Array.isArray(v) && v.length >= 3 && v.every((x) => typeof x === "number")) return [v[0] as number, v[1] as number, v[2] as number];
    return [fallback[0], fallback[1], fallback[2]];
  }
  /** A colour (0..255 per channel, as the file stores it). */
  color(key: string, fallback: [number, number, number, number] = [255, 255, 255, 255]): [number, number, number, number] {
    const v = this.map.get(key.toLowerCase());
    if (Array.isArray(v) && v.length >= 3 && v.every((x) => typeof x === "number")) return [v[0] as number, v[1] as number, v[2] as number, (v[3] as number | undefined) ?? 255];
    return [...fallback];
  }
}
