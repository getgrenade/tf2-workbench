/**
 * The material file of a prop: a plain VertexLitGeneric (what nearly every prop of the game is) with the textures the artist gave and a few
 * switches. The cosmetic compiler's material (light ramps, rim lights, paint) is made for items on a character and has no business on a crate.
 */
import { parseKv, printKv, removeKv, type KvNode } from "./kv";
import { proxyNodes, type CustomProxy } from "./proxyModel";

export interface PropMaterialSettings {
  translucent: boolean;
  alphaTest: boolean;
  twoSided: boolean;
  phong: boolean;
  phongExponent: number;
  phongBoost: number;
  /** A glow along the edges (needs phong). */
  rimLight: boolean;
  rimExponent: number;
  rimBoost: number;
  selfIllum: boolean;
  /** `env_cubemap` (the cubemap of the map) or a cubemap of the game; empty: no reflection. */
  envmap: string;
  /** The proxies the artist adds (a pulsing glow, a flicker), written after the material's own keys. */
  customProxies: CustomProxy[];
  /** Material lines written by hand (`$detail`, a variable a proxy writes to...), in the material's own text: a key that is already there is replaced. */
  extra: string;
}

export const DEFAULT_PROP_MATERIAL: Readonly<PropMaterialSettings> = {
  translucent: false, alphaTest: false, twoSided: false, phong: false, phongExponent: 20, phongBoost: 1, rimLight: false, rimExponent: 4, rimBoost: 1, selfIllum: false, envmap: "", customProxies: [], extra: "",
};

/** What a prop's reflection can be: the map's cubemap, or one of the game's. */
export const PROP_ENVMAPS: { name: string; path: string }[] = [
  { name: "none", path: "" },
  { name: "the map's cubemap", path: "env_cubemap" },
  { name: "metal (shapes)", path: "cubemaps/cubemap_shapes002" },
  { name: "sheen", path: "cubemaps/cubemap_sheen001" },
  { name: "gold", path: "cubemaps/cubemap_gold001" },
];

export interface PropTextures { color: boolean; normal: boolean; phongexponent: boolean; illum: boolean }

const num = (v: number) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 1e4) / 1e4));

/** What is wrong with the extra lines of a material (empty: nothing). */
export function extraProblem(text: string): string {
  if (text.trim() === "") return "";
  try { parseKv(text); return ""; } catch (e) { return e instanceof Error ? e.message : String(e); }
}

/** The text of a prop's material file. `folder` is below models/ (`props_custom/crates`), `stem` the file name of the material. */
export function propVmt(folder: string, stem: string, textures: PropTextures, s: Readonly<PropMaterialSettings>, surfaceprop: string): string {
  const path = `models/${folder}/${stem}`;
  const lines: [string, string][] = [["$basetexture", `${path}_color`]];
  if (textures.normal) lines.push(["$bumpmap", `${path}_normal`]);
  lines.push(["$surfaceprop", surfaceprop]);
  if (s.phong) {
    lines.push(["$phong", "1"]);
    if (textures.phongexponent) lines.push(["$phongexponenttexture", `${path}_phongexponent`]);
    else lines.push(["$phongexponent", num(s.phongExponent)]);
    lines.push(["$phongboost", num(s.phongBoost)], ["$phongfresnelranges", "[0.3 1 8]"]);
    if (s.rimLight) lines.push(["$rimlight", "1"], ["$rimlightexponent", num(s.rimExponent)], ["$rimlightboost", num(s.rimBoost)]);
  }
  if (s.selfIllum) {
    lines.push(["$selfillum", "1"]);
    if (textures.illum) lines.push(["$selfillummask", `${path}_illum`]);
  }
  if (s.envmap) lines.push(["$envmap", s.envmap], ["$envmaptint", "[0.5 0.5 0.5]"]);
  if (s.translucent) lines.push(["$translucent", "1"]);
  if (s.alphaTest) lines.push(["$alphatest", "1"]);
  if (s.twoSided) lines.push(["$nocull", "1"]);
  const tree: KvNode[] = lines.map(([key, value]) => ({ key, value }));
  const proxies = proxyNodes(s.customProxies ?? []);
  // the lines written by hand: a key of the material is replaced, the proxies join the ones of the editor (theirs first, as they were written)
  let written: KvNode[] = [];
  try { written = s.extra.trim() ? parseKv(s.extra) : []; } catch { /* the check says what is wrong with it */ }
  const first: KvNode[] = [];
  for (const node of written) {
    if (node.key.toLowerCase() === "proxies" && node.children) first.push(...node.children);
    else { removeKv(tree, node.key); tree.push(node); }
  }
  if (first.length || proxies.length) tree.push({ key: "Proxies", children: [...first, ...proxies] });
  return `"VertexLitGeneric"
{
${printKv(tree, 1)}}
`;
}
