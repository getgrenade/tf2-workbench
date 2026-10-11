import { cloneKv, findKv, parseKv, type KvNode } from "./kv";

/**
 * The proxies an artist adds to a material by hand in the importer's session text (the `proxies` block of the material): a Sine that makes the
 * glow pulse, a TextureScroll that moves the texture. They are kept as an ordered list of blocks (the order is the order they run in), each
 * with its keys in the case and order it was written in, and are written after the proxies the importer itself puts in a material.
 */
export interface CustomProxy {
  name: string;
  params: { key: string; value: string }[];
  /** Only for the editor: the card is folded. It is not part of the material. */
  folded?: boolean;
}

export type ProxyParamKind = "var" | "number" | "text";
export interface ProxyParam {
  key: string;
  label: string;
  kind: ProxyParamKind;
  /** What a new proxy starts with (empty: the key is left out until it is filled in). */
  value: string;
  hint?: string;
}
export interface ProxyType {
  name: string;
  hint: string;
  params: ProxyParam[];
}

const result = (value: string, hint = "The material variable the proxy writes to"): ProxyParam => ({ key: "resultVar", label: "Writes to", kind: "var", value, hint });
const source = (key: string, label: string, hint = "A material variable to read (or a number)"): ProxyParam => ({ key, label, kind: "var", value: "", hint });
const number = (key: string, label: string, value: string, hint?: string): ProxyParam => ({ key, label, kind: "number", value, hint });

/** The proxies the editor knows how to lay out (the viewer runs all of these); anything else is edited as plain keys and values. */
export const PROXY_TYPES: ProxyType[] = [
  { name: "Sine", hint: "A value that swings between a minimum and a maximum, over and over (a pulsing glow)",
    params: [result("$selfillumtint"), number("sinePeriod", "Period (s)", "2", "Seconds for one full swing"), number("sineMin", "Minimum", "0.1"), number("sineMax", "Maximum", "1.8"), number("timeOffset", "Time offset (s)", "", "Shifts the swing in time")] },
  { name: "LinearRamp", hint: "A value that grows (or shrinks) steadily with time",
    params: [result("$alpha"), number("rate", "Rate per second", "1"), number("initialValue", "Start", "0")] },
  { name: "UniformNoise", hint: "A new random value between a minimum and a maximum every frame (a flicker)",
    params: [result("$selfillumtint"), number("minVal", "Minimum", "0.5"), number("maxVal", "Maximum", "1.5")] },
  { name: "TextureScroll", hint: "Slides the texture across the surface",
    params: [{ key: "textureScrollVar", label: "Texture transform", kind: "var", value: "$basetexturetransform", hint: "The transform variable of the texture to move" },
      number("textureScrollRate", "Rate", "1", "Texture widths per second"), number("textureScrollAngle", "Angle (°)", "0", "0 moves along U (right), 90 along V (down)"), number("textureScale", "Scale", "", "Scale of the texture (1 when empty)")] },
  { name: "TextureTransform", hint: "Builds a texture transform from variables (move, scale and turn a texture)",
    params: [result("$basetexturetransform"), source("translateVar", "Translate", "A variable that holds two numbers"), source("scaleVar", "Scale", "A variable that holds two numbers"), source("rotateVar", "Rotate", "A variable that holds an angle in degrees"), source("centerVar", "Center", "A variable that holds two numbers (0.5 0.5 when empty)")] },
  { name: "Add", hint: "Source 1 plus source 2", params: [source("srcVar1", "Source 1"), source("srcVar2", "Source 2"), result("")] },
  { name: "Subtract", hint: "Source 1 minus source 2", params: [source("srcVar1", "Source 1"), source("srcVar2", "Source 2"), result("")] },
  { name: "Multiply", hint: "Source 1 times source 2", params: [source("srcVar1", "Source 1"), source("srcVar2", "Source 2"), result("")] },
  { name: "Divide", hint: "Source 1 divided by source 2", params: [source("srcVar1", "Source 1"), source("srcVar2", "Source 2"), result("")] },
  { name: "Equals", hint: "Copies a variable into another", params: [source("srcVar1", "Source"), result("")] },
  { name: "Abs", hint: "The absolute value of a variable", params: [source("srcVar1", "Source"), result("")] },
  { name: "Frac", hint: "The fractional part of a variable", params: [source("srcVar1", "Source"), result("")] },
  { name: "Int", hint: "The whole part of a variable", params: [source("srcVar1", "Source"), result("")] },
  { name: "Clamp", hint: "Keeps a variable between a minimum and a maximum", params: [source("srcVar1", "Source"), number("min", "Minimum", "0"), number("max", "Maximum", "1"), result("")] },
  { name: "LessOrEqual", hint: "Picks one of two variables by comparing source 1 with source 2",
    params: [source("srcVar1", "Source 1"), source("srcVar2", "Source 2"), source("lessEqualVar", "If less or equal"), source("greaterVar", "If greater"), result("")] },
];

/** Variables that proxies usually write to, for the suggestions of a "Writes to" box. */
export const COMMON_TARGETS = ["$selfillumtint", "$color2", "$basetexturetransform", "$bumptransform", "$detailblendfactor", "$phongboost", "$phongexponent", "$rimlightboost", "$envmaptint", "$alpha", "$frame", "$detailscale"];

/** Ready-made proxies for the two things artists add most. */
export const PROXY_PRESETS: { label: string; hint: string; proxy: () => CustomProxy }[] = [
  { label: "Pulsing glow", hint: "A Sine on $selfillumtint (turn Self-illumination on to see it)", proxy: () => newProxy("Sine") },
  { label: "Scrolling texture", hint: "A TextureScroll on $basetexturetransform", proxy: () => newProxy("TextureScroll") },
];

export const proxyType = (name: string) => PROXY_TYPES.find((t) => t.name.toLowerCase() === name.toLowerCase());

/** A new proxy of a known type with its usual values (a key without a value is left out). */
export function newProxy(name: string): CustomProxy {
  const type = proxyType(name);
  if (!type) return { name, params: [{ key: "resultVar", value: "" }] };
  return { name: type.name, params: type.params.filter((p) => p.value !== "").map((p) => ({ key: p.key, value: p.value })) };
}

export const cloneProxies = (list: readonly CustomProxy[]): CustomProxy[] => list.map((p) => ({ name: p.name, params: p.params.map((a) => ({ ...a })), ...(p.folded ? { folded: true } : {}) }));

/** The proxy as the tree that prints into the VMT: a block named for the proxy, its keys in order, empty values left out when it prints. */
export function proxyNodes(list: readonly CustomProxy[]): KvNode[] {
  return list.filter((p) => p.name.trim() !== "").map((p) => ({ key: p.name.trim(), children: p.params.filter((a) => a.key.trim() !== "").map((a) => ({ key: a.key.trim(), value: a.value.trim() })) }));
}

/** The proxy blocks of a tree, as the editor's list. */
export function proxiesFromNodes(nodes: readonly KvNode[]): CustomProxy[] {
  return nodes.filter((n) => n.children).map((n) => ({ name: n.key, params: (n.children ?? []).filter((a) => a.value !== undefined).map((a) => ({ key: a.key, value: a.value ?? "" })) }));
}

/** The proxies a pasted text holds: just the blocks, or inside a `proxies` block, or in a whole material. Text copied out of a session file (with its \" escapes) works too. */
export function proxiesFromText(text: string): CustomProxy[] {
  const clean = text.replace(/\\"/g, '"').replace(/\\t/g, "\t").replace(/\\n/g, "\n").trim();
  if (clean === "") return [];
  const tree = parseKv(clean);
  const wrapper = findKv(tree, "proxies") ?? findKv(tree.flatMap((n) => n.children ?? []), "proxies");
  const blocks = wrapper?.children ?? tree;
  const found = proxiesFromNodes(blocks);
  if (!found.length && blocks.length) throw new Error("There is no proxy block in the text");
  return found;
}

/** The proxies as text, the way they sit in the VMT (to copy out and edit). */
export function proxiesToText(list: readonly CustomProxy[]): string {
  const quote = (s: string) => `"${s.replace(/"/g, '\\"')}"`;
  return proxyNodes(list).map((n) => `${quote(n.key)}\n{\n${(n.children ?? []).filter((a) => a.value !== "").map((a) => `\t${quote(a.key)}\t\t${quote(a.value ?? "")}\n`).join("")}}\n`).join("");
}

const signature = (name: string, params: readonly { key: string; value: string }[]) =>
  `${name.toLowerCase()}|${params.map((a) => `${a.key.toLowerCase()}=${a.value.toLowerCase()}`).sort().join(",")}`;

/**
 * The proxies of a material tree that the importer did not put there itself: `builtin` is the importer's own material (its template), whose
 * proxies are not the artist's. A proxy that differs from the importer's in any value counts as the artist's.
 */
export function customProxiesFromVmt(root: KvNode[], builtin: KvNode[]): CustomProxy[] {
  const proxiesOf = (tree: KvNode[]) => proxiesFromNodes(findKv(tree[0]?.children ?? [], "proxies")?.children ?? []);
  const own = new Set(proxiesOf(builtin).map((p) => signature(p.name, p.params)));
  const mine = proxiesOf(root);
  return mine.filter((p) => !own.has(signature(p.name, p.params)));
}

/** What is wrong with the proxies, in words for the artist (an empty list: nothing). */
export function proxyProblems(list: readonly CustomProxy[], selfIllum: boolean): string[] {
  const out: string[] = [];
  list.forEach((p, i) => {
    const label = `${p.name || "Proxy"} #${i + 1}`;
    if (!p.name.trim()) { out.push(`Proxy #${i + 1} has no name`); return; }
    const value = (key: string) => p.params.find((a) => a.key.toLowerCase() === key.toLowerCase())?.value.trim() ?? "";
    const type = proxyType(p.name);
    if (type) {
      for (const param of type.params) {
        if (param.key === "resultVar" && value("resultVar") === "" && p.name.toLowerCase() !== "texturescroll") out.push(`${label} has nowhere to write: fill in "Writes to"`);
      }
      if (p.name.toLowerCase() === "texturescroll" && value("textureScrollVar") === "") out.push(`${label} has no texture transform to move`);
    }
    for (const a of p.params) {
      if (/var\d*$/i.test(a.key) && a.value.trim() !== "" && !/^(\$|[-+]?[\d.])/.test(a.value.trim())) out.push(`${label}: ${a.key} "${a.value}" is not a variable (variables start with $)`);
    }
    if (/^\$selfillumtint$/i.test(value("resultVar")) && !selfIllum) out.push(`${label} drives the glow, but Self-illumination is off`);
  });
  return out;
}

export { cloneKv };

/** The proxies of stored data (a saved session), keeping only what has the right shape. */
export function sanitizeProxies(raw: unknown): CustomProxy[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((p): CustomProxy[] => {
    if (!p || typeof p !== "object" || typeof (p as CustomProxy).name !== "string" || !Array.isArray((p as CustomProxy).params)) return [];
    const params = (p as CustomProxy).params.filter((a) => a && typeof a.key === "string" && typeof a.value === "string").map((a) => ({ key: a.key, value: a.value }));
    return [{ name: (p as CustomProxy).name, params, ...((p as CustomProxy).folded === true ? { folded: true } : {}) }];
  });
}
