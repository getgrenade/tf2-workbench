/**
 * War paints (paint kits): their definitions, read from the game's `scripts/protodefs/proto_defs.vpd`, and what a weapon is painted with
 * at a wear and a seed. The skin itself is composited on the GPU (warPaintCompositor.ts).
 *
 * Ported from the Mann-ual's war paint window (web/wpi.js), which follows the game: the definitions are protobuf messages
 * (tf_proto_def_messages.proto), the variables are resolved as CPaintKitDefinition::GetItemPaintKitDefinitionKV does (econ_paintkit.cpp),
 * and the random parts use the engine's CUniformRandomStream (vstdlib/random.cpp).
 */

/** The weapons a paint kit can name, in the order of CMsgPaintKit_Definition's per-weapon fields (field 6 on). */
export const PAINTKIT_WEAPON_FIELDS = [
  "paintkit_tool", "flamethrower", "grenadelauncher", "knife", "medigun", "minigun", "pistol", "revolver", "rocketlauncher", "scattergun",
  "shotgun", "smg", "sniperrifle", "stickybomb_launcher", "ubersaw", "wrench", "amputator", "atom_launcher", "back_scratcher", "battleaxe",
  "bazaar_sniper", "blackbox", "claidheamohmor", "crusaders_crossbow", "degreaser", "demo_cannon", "demo_sultan_sword", "detonator",
  "gatling_gun", "holymackerel", "jag", "lochnload", "powerjack", "quadball", "reserve_shooter", "riding_crop", "russian_riot", "scimitar",
  "scorch_shot", "shortstop", "soda_popper", "tele_shotgun", "tomislav", "trenchgun", "winger_pistol",
] as const;

/** The wears, 1 to 5 (`set_item_texture_wear` 0.2 to 1.0 in the schema). */
export const WEARS = ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle Scarred"] as const;

/** A variable of an operation or a paint kit: its name, its value, and whether a paint kit's own values may change it. */
type Variable = [name: string, value: string, overridable: boolean];
type Assignment = [name: string, value: string];

/** One node of an operation's tree (the stages of the texture compositor). */
export type StageNode =
  | ["@", number] // another operation, by id
  | ["T", Record<string, string>] // a texture lookup
  | ["add" | "lerp" | "multiply", Record<string, string>, StageNode[]]
  | ["sel", string, string[]] // select: a group mask and the groups kept
  | ["stk", Record<string, string>, Record<string, string>[], StageNode[]]; // a sticker: placed on its child, one of several picked at random

export interface PaintKit {
  id: number;
  name: string;
  vars: Variable[];
  /** The operation it paints with (a weapon's wear can name another). */
  op: number | null;
  /** By weapon (`sniperrifle`): its paint kit item definition and the variables it sets for that weapon. */
  weapons: Record<string, [itemDef: number, vars: Assignment[]]>;
  /** Whether it looks different for each team. */
  team: boolean;
}

export interface PaintKitItemDef {
  /** The item it is (`item_definition_index`: 15000 for the Night Owl Sniper Rifle). */
  itemIndex: number | null;
  vars: Variable[];
  /** By wear (1 is first): the operation it paints with (null: the paint kit's) and the variables it sets. */
  wears: [op: number | null, vars: Assignment[]][];
}

export interface PaintKitDefs {
  kits: Map<number, PaintKit>;
  itemDefs: Map<number, PaintKitItemDef>;
  ops: Map<number, { vars: Variable[]; nodes: StageNode[] }>;
}

// ---------------- protobuf ----------------

type Field = [field: number, wire: number, value: number | Uint8Array];

/** The fields of a protobuf message (varints as numbers: the ids and flags here are small). */
function fields(b: Uint8Array): Field[] {
  const out: Field[] = [];
  let o = 0;
  const varint = () => {
    let r = 0, s = 0, c: number;
    do { c = b[o++]; r += (c & 127) * 2 ** s; s += 7; } while (c >= 128 && o <= b.length);
    return r;
  };
  while (o < b.length) {
    const k = varint(), f = Math.floor(k / 8), w = k & 7;
    let v: number | Uint8Array;
    if (w === 0) v = varint();
    else if (w === 2) { const l = varint(); v = b.subarray(o, o + l); o += l; }
    else if (w === 5) { v = b.subarray(o, o + 4); o += 4; }
    else if (w === 1) { v = b.subarray(o, o + 8); o += 8; }
    else throw new Error(`proto_defs: wire type ${w}`);
    out.push([f, w, v]);
  }
  return out;
}
const all = (F: Field[], n: number) => F.filter((x) => x[0] === n).map((x) => x[2]);
function one<T extends number | Uint8Array>(F: Field[], n: number): T | undefined {
  let r: number | Uint8Array | undefined;
  for (const x of F) if (x[0] === n) r = x[2];
  return r as T | undefined;
}
const bytes = (v: unknown) => (v instanceof Uint8Array ? v : new Uint8Array(0));
const UTF8 = new TextDecoder();
const str = (v: unknown) => (v instanceof Uint8Array && v.length ? UTF8.decode(v) : "");

/** CMsgVarField: its value (a string, a float, an int, a bool), else null. */
function varValue(F: Field[]): string | null {
  for (const [f, , x] of F) {
    if (f === 9) return str(x);
    if (f === 2 && x instanceof Uint8Array) return String(new DataView(x.buffer, x.byteOffset, 4).getFloat32(0, true));
    if (f >= 4 && f <= 8) return String(x);
  }
  return null;
}
// in a variable list a value wins; in an operation's node the variable it names wins (its value is only the default)
function listField(b: Uint8Array): string {
  const F = fields(b), x = varValue(F);
  if (x !== null) return x;
  const v = one<Uint8Array>(F, 1);
  return v && v.length ? `$${str(v)}` : "";
}
function nodeField(b: Uint8Array): string {
  const F = fields(b), v = one<Uint8Array>(F, 1);
  if (v && v.length) return `$${str(v)}`;
  return varValue(F) ?? "";
}
const assignments = (L: (number | Uint8Array)[]): Assignment[] => L.map((v) => [str(one(fields(bytes(v)), 1)), listField(bytes(v))]);
function header(b: Uint8Array) {
  const F = fields(b);
  return {
    id: Number(one(F, 1) ?? 0),
    prefab: !!one(F, 5),
    vars: all(F, 6).map((v): Variable => { const V = fields(bytes(v)); return [str(one(V, 1)), str(one(V, 3)), Number(one(V, 2) ?? 1) !== 0]; }),
  };
}

const TEXTURE_FIELDS = ["texture", "texture_red", "texture_blue", "adjust_black", "adjust_offset", "adjust_gamma", "rotation", "translate_u", "translate_v", "scale_uv", "flip_u", "flip_v"];
const COMBINE_FIELDS = ["adjust_black", "adjust_offset", "adjust_gamma", "rotation", "translate_u", "translate_v", "scale_uv", "flip_u", "flip_v"];
const STICKER_FIELDS = ["dest_tl", "dest_tr", "dest_bl", "adjust_black", "adjust_offset", "adjust_gamma"];

function node(b: Uint8Array): StageNode {
  const F = fields(b), ref = one<Uint8Array>(F, 2);
  if (ref) return ["@", Number(one(fields(ref), 1) ?? 0)];
  const [f, , v] = fields(bytes(one(F, 1)))[0];
  const S = fields(bytes(v)), o: Record<string, string> = {};
  if (f === 1) {
    for (const [g, , x] of S) o[TEXTURE_FIELDS[g - 1]] = nodeField(bytes(x));
    return ["T", o];
  }
  if (f >= 2 && f <= 4) {
    for (const [g, , x] of S) if (g <= 9) o[COMBINE_FIELDS[g - 1]] = nodeField(bytes(x));
    return [({ 2: "add", 3: "lerp", 4: "multiply" } as const)[f as 2 | 3 | 4], o, all(S, 11).map((x) => node(bytes(x)))];
  }
  if (f === 5) return ["sel", nodeField(bytes(one(S, 1))), all(S, 2).map((x) => nodeField(bytes(x)))];
  if (f === 6) {
    const stickers: Record<string, string>[] = [];
    for (const [g, , x] of S) {
      if (g === 1) {
        const s: Record<string, string> = {};
        for (const [h, , y] of fields(bytes(x))) s[["base", "weight", "spec"][h - 1]] = nodeField(bytes(y));
        stickers.push(s);
      } else if (g >= 2 && g <= 7) o[STICKER_FIELDS[g - 2]] = nodeField(bytes(x));
    }
    return ["stk", o, stickers, all(S, 9).map((x) => node(bytes(x)))];
  }
  throw new Error(`proto_defs: stage ${f}`);
}

/** The localized strings of a `tf_proto_obj_defs_<language>.txt` (UTF-16 with a byte order mark, or UTF-8). */
export function parseLocalization(b: Uint8Array): Map<string, string> {
  const text = new TextDecoder(b[0] === 0xff && b[1] === 0xfe ? "utf-16le" : "utf-8").decode(b);
  const out = new Map<string, string>();
  for (const m of text.matchAll(/"([^"\n]+)"\s+"([^"\n]*)"/g)) out.set(m[1], m[2]);
  return out;
}

/**
 * Reads `proto_defs.vpd`: blocks of [type u32][count u32] then count × [size u32][message]. Type 7 is the operations, 8 the paint kit
 * item definitions, 9 the paint kits (named in `localization`, by their `loc_desctoken`). `weaponOfItem` names the weapon of a
 * paint-kit item (15000 → `sniperrifle`): the paint kits of the collections (Gun Mettle and later) list their weapons that way.
 */
export function parsePaintKits(buffer: ArrayBuffer | Uint8Array, localization: Map<string, string>, weaponOfItem: (id: number) => string | undefined): PaintKitDefs {
  const b = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const blocks = new Map<number, Uint8Array[]>();
  for (let o = 0; o + 8 <= b.length;) {
    const type = dv.getUint32(o, true), n = dv.getUint32(o + 4, true);
    o += 8;
    const list: Uint8Array[] = [];
    for (let i = 0; i < n; i++) { const s = dv.getUint32(o, true); list.push(b.subarray(o + 4, o + 4 + s)); o += 4 + s; }
    blocks.set(type, list);
  }
  const ops = new Map<number, { vars: Variable[]; nodes: StageNode[] }>();
  for (const m of blocks.get(7) ?? []) {
    const F = fields(m), h = header(bytes(one(F, 1)));
    ops.set(h.id, { vars: h.vars, nodes: all(F, 2).map((x) => node(bytes(x))) });
  }
  const itemDefs = new Map<number, PaintKitItemDef>();
  for (const m of blocks.get(8) ?? []) {
    const F = fields(m), h = header(bytes(one(F, 1)));
    const idx = one<number>(F, 2);
    itemDefs.set(h.id, {
      itemIndex: idx === undefined ? null : Number(idx),
      vars: h.vars,
      wears: all(F, 4).map((x) => {
        const X = fields(bytes(x)), op = one<Uint8Array>(X, 1);
        return [op ? Number(one(fields(op), 1) ?? 0) : null, assignments(all(X, 2))];
      }),
    });
  }
  const kits = new Map<number, PaintKit>();
  const fromItems = new Map<number, (number | Uint8Array)[]>();
  for (const m of blocks.get(9) ?? []) {
    const F = fields(m), h = header(bytes(one(F, 1)));
    if (h.prefab) continue;
    const name = localization.get(str(one(F, 2)));
    if (!name) continue;
    const weapons: PaintKit["weapons"] = {};
    const listed: (number | Uint8Array)[] = [];
    for (const [f, , v] of F) {
      if (f === 5) { listed.push(v); continue; }
      const key = f >= 6 ? PAINTKIT_WEAPON_FIELDS[f - 6] : undefined;
      if (!key || key === "paintkit_tool" || weapons[key]) continue;
      const X = fields(bytes(v)), data = one<Uint8Array>(X, 5);
      weapons[key] = [Number(one(fields(bytes(one(X, 1))), 1) ?? 0), data ? assignments(all(fields(data), 4)) : []];
    }
    const op = one<Uint8Array>(F, 3);
    kits.set(h.id, { id: h.id, name, vars: h.vars, op: op ? Number(one(fields(op), 1) ?? 0) : null, weapons, team: !!one(F, 4) });
    if (listed.length) fromItems.set(h.id, listed);
  }
  // the collections' paint kits list their weapons as items ("item", field 5), each a paint kit item definition whose item is the weapon
  // painted (15000, the Night Owl Sniper Rifle: a sniperrifle)
  for (const [id, listed] of fromItems) {
    const kit = kits.get(id)!;
    for (const v of listed) {
      const X = fields(bytes(v)), def = Number(one(fields(bytes(one(X, 1))), 1) ?? 0), data = one<Uint8Array>(X, 5);
      const itemIndex = itemDefs.get(def)?.itemIndex;
      const key = itemIndex !== null && itemIndex !== undefined ? weaponOfItem(itemIndex) : undefined;
      if (key && !kit.weapons[key]) kit.weapons[key] = [def, data ? assignments(all(fields(data), 4)) : []];
    }
  }
  for (const [id, kit] of kits) if (!Object.keys(kit.weapons).length) kits.delete(id);
  return { kits, itemDefs, ops };
}

/**
 * The operation a weapon is painted with and its variables, at a wear (1 to 5), as CPaintKitDefinition::GetItemPaintKitDefinitionKV makes
 * them: the operation's own (or the paint kit's), then what the paint kit sets for the weapon, its item definition, and its wear, each only
 * where the variable may be changed.
 */
export function resolvePaintKit(d: PaintKitDefs, kitId: number, weapon: string, wear: number): { op: number; vars: Record<string, string> } | null {
  const kit = d.kits.get(kitId);
  const entry = kit?.weapons[weapon];
  if (!kit || !entry) return null;
  const [defId, forWeapon] = entry;
  const def = d.itemDefs.get(defId);
  let op = kit.op;
  let base = kit.vars;
  const wearDef = def?.wears[Math.max(0, Math.min(wear - 1, def.wears.length - 1))];
  if (wearDef && wearDef[0] !== null) {
    op = wearDef[0];
    base = d.ops.get(op)?.vars ?? base;
  }
  if (op === null || !d.ops.has(op)) return null;
  const V = new Map(base.map(([n, v, c]) => [n, { v, c }]));
  const set = (n: string, v: string) => { const e = V.get(n); if (e && e.c) e.v = v; };
  for (const [n, v] of forWeapon) set(n, v);
  for (const [n, v] of def?.vars ?? []) set(n, v);
  for (const [n, v] of wearDef?.[1] ?? []) set(n, v);
  return { op, vars: Object.fromEntries([...V].map(([n, e]) => [n, e.v])) };
}

/**
 * The engine's CUniformRandomStream (vstdlib/random.cpp: Numerical Recipes' ran1), which the texture compositor draws its random
 * placements from: the same seed gives the same skin.
 */
export class UniformRandomStream {
  private idum: number;
  private iy = 0;
  private readonly iv = new Array<number>(32).fill(0);
  constructor(seed: number) {
    this.idum = seed < 0 ? seed : -seed;
  }
  private generate(): number {
    const NTAB = 32, IA = 16807, IM = 2147483647, IQ = 127773, IR = 2836, NDIV = 1 + Math.floor((IM - 1) / NTAB);
    let j: number, k: number;
    if (this.idum <= 0 || !this.iy) {
      if (-this.idum < 1) this.idum = 1;
      else this.idum = -this.idum;
      for (j = NTAB + 7; j >= 0; j--) {
        k = Math.floor(this.idum / IQ);
        this.idum = IA * (this.idum - k * IQ) - IR * k;
        if (this.idum < 0) this.idum += IM;
        if (j < NTAB) this.iv[j] = this.idum;
      }
      this.iy = this.iv[0];
    }
    k = Math.floor(this.idum / IQ);
    this.idum = IA * (this.idum - k * IQ) - IR * k;
    if (this.idum < 0) this.idum += IM;
    j = Math.floor(this.iy / NDIV);
    if (j >= NTAB || j < 0) j = ((j % NTAB) + NTAB) % NTAB;
    this.iy = this.iv[j];
    this.iv[j] = this.idum;
    return this.iy;
  }
  /** RandomFloat(lo, hi). */
  float(lo: number, hi: number): number {
    const AM = 1 / 2147483647, RNMX = 1 - 1.2e-7;
    let f = AM * this.generate();
    if (f > RNMX) f = RNMX;
    return f * (hi - lo) + lo;
  }
}

/**
 * The compositor's seed from a war paint's seed as the game shows it (a 64-bit number: `custom_paintkit_seed_hi` << 32 | `_lo`), folded
 * into the 32 bits the random stream takes as the Mann-ual does (low ^ high).
 */
export function seedOf(text: string): number {
  try {
    const b = BigInt(String(text || "0").replace(/\D/g, "") || "0") & 0xffffffffffffffffn;
    return Number(b & 0xffffffffn) ^ Number(b >> 32n) | 0;
  } catch {
    return 0;
  }
}

/** A random seed as the game would give one (two random 31-bit halves). */
export function randomSeed(): string {
  const half = () => BigInt(Math.floor(Math.random() * 0x7fffffff));
  return ((half() << 32n) | half()).toString();
}

/** A weapon item's war paint key (`sniperrifle`), by its model (`c_sniperrifle.mdl`): null when no paint kit names it. */
export function warPaintWeaponOf(item: { model: string | null; displayName: string }): string | null {
  const base = (item.model ?? "").replace(/\\/g, "/").split("/").pop()?.replace(/\.mdl$/i, "").toLowerCase() ?? "";
  if (!base.startsWith("c_")) return null;
  // the festive and Botkiller copies, the Golden Wrench and the Kritzkrieg share the model but can't be painted in game
  if (/^(festive|silver botkiller|gold botkiller|rust botkiller|blood botkiller|carbonado botkiller|diamond botkiller)\b|^golden wrench$|^kritzkrieg$|^deflector$/i.test(item.displayName)) return null;
  const key = base.slice(2);
  return (PAINTKIT_WEAPON_FIELDS as readonly string[]).includes(key) && key !== "paintkit_tool" ? key : null;
}
