import { cloneKv, findKv, parseKv, printKv, removeKv, setKv, type KvNode } from "./kv";
import { proxyNodes, type CustomProxy } from "./proxyModel";

/**
 * The material the item importer writes for a cosmetic (item_import.cpp CTFImportMaterialEditDialog and CTFFileImportDialog): a
 * VertexLitGeneric with everything TF2 expects of an item (cloak, burn, Jarate, optionally paint), filled in from a few settings and
 * then stripped of the parameters those settings do not use (RemoveUnnecessaryParametersFromVMT).
 */

/** The importer's starting material: its VMT template text, as the session files of the in-game tool carry it. */
const TEMPLATE = `"VertexLitGeneric"
{
	"$basetexture"		""
	"$bumpmap"		""
	"$lightwarptexture"		"models/player/pyro/pyro_lightwarp"
	"$phongexponenttexture"		""
	"$phong"		"1"
	"$phongexponent"		"25"
	"$phongboost"		"0.100000"
	"$phongfresnelranges"		"[.25 .5 1]"
	"$basemapalphaphongmask"		"0"
	"$rimlight"		"1"
	"$rimlightexponent"		"4"
	"$rimlightboost"		"2"
	"$rimmask"		"0"
	"$halflambert"		"0"
	"$blendtintbybasealpha"		"1"
	"$blendtintcoloroverbase"		"0"
	"$colortint_base"		"{ 255 255 255 }"
	"$color2"		"{ 255 255 255 }"
	"$colortint_tmp"		"[0 0 0]"
	"$bumpmapalphaphongmask"		"1"
	"$additive"		"0"
	"$translucent"		"0"
	"$alphatest"		"0"
	"$envmap"		""
	"$basealphaenvmapmask"		"0"
	"$normalmapalphaenvmapmask"		"0"
	"$envmaptint"		"[1 1 1]"
	"$cloakPassEnabled"		"1"
	"$detail"		"effects/tiledfire/fireLayeredSlowTiled512"
	"$detailscale"		"5"
	"$detailblendfactor"		"0"
	"$detailblendmode"		"6"
	"$yellow"		"0"
	">=DX90"
	{
		"$selfillum"		"0"
	}
	"$selfillumtint"		"[1 1 1]"
	"$selfillummask"		""
	"proxies"
	{
		"invis"
		{
		}
		"AnimatedTexture"
		{
			"animatedtexturevar"		"$detail"
			"animatedtextureframenumvar"		"$detailframe"
			"animatedtextureframerate"		"30"
		}
		"BurnLevel"
		{
			"resultVar"		"$detailblendfactor"
		}
		"ItemTintColor"
		{
			"resultVar"		"$colortint_tmp"
		}
		"SelectFirstIfNonZero"
		{
			"srcVar1"		"$colortint_tmp"
			"srcVar2"		"$colortint_base"
			"resultVar"		"$color2"
		}
		"YellowLevel"
		{
			"resultVar"		"$yellow"
		}
		"Equals"
		{
			"srcVar1"		"$yellow"
			"resultVar"		"$color2"
		}
		"Multiply"
		{
			"srcVar1"		"$color2"
			"srcVar2"		"$yellow"
			"resultVar"		"$color2"
		}
	}
}
`;

/** kLightwarps of the importer: the ramps a cosmetic can choose from. */
export const LIGHTWARPS: { name: string; path: string }[] = [
  { name: "pyro", path: "models/player/pyro/pyro_lightwarp" },
  { name: "weapon", path: "models/lightwarps/weapon_lightwarp" },
  { name: "robot", path: "models/lightwarps/robot_lightwarp" },
  { name: "sentry1", path: "models/buildables/sentry1/sentry1_lightwarp" },
  { name: "sentry2", path: "models/buildables/sentry2/sentry2_lightwarp" },
  { name: "sentry3", path: "models/buildables/sentry3/sentry3_lightwarp" },
  { name: "ambassador", path: "models/weapons/c_items/c_ambassador_lightwarp" },
  { name: "jarate", path: "models/lightwarps/jarate_lightwarp" },
];

/** kEnvmaps */
export const ENVMAPS: { name: string; path: string }[] = [
  { name: "none", path: "" },
  { name: "world cube map", path: "env_cubemap" },
  { name: "saxxy gold", path: "effects/saxxy/saxxy_gold" },
  { name: "pyro land goggles", path: "effects/pyrocube" },
];

export type EnvmapMask = "" | "$basealphaenvmapmask" | "$normalmapalphaenvmapmask";

/** What the material editor of the importer lets an artist change. */
export interface MaterialSettings {
  lightwarp: string;
  phongExponent: number;
  phongBoost: number;
  rimLight: boolean;
  rimExponent: number;
  rimBoost: number;
  rimMask: boolean;
  halfLambert: boolean;
  baseAlphaPhongMask: boolean;
  /** Takes the paint of the item (Team Spirit...): blends it over the texture where the base alpha says so. */
  paintable: boolean;
  blendTintColorOverBase: number;
  /** The colour of the item before it is painted, 0-255. */
  colorTintBase: [number, number, number];
  translucent: boolean;
  alphaTest: boolean;
  additive: boolean;
  selfIllum: boolean;
  /** 0-255 per channel. */
  selfIllumTint: [number, number, number];
  envmap: string;
  envmapMask: EnvmapMask;
  envmapTint: [number, number, number];
  /** Proxies the artist added by hand (a pulsing glow, a scrolling texture), written after the importer's own. */
  customProxies: CustomProxy[];
}

export const DEFAULT_MATERIAL: Readonly<MaterialSettings> = {
  lightwarp: LIGHTWARPS[0].path, phongExponent: 25, phongBoost: 0.1, rimLight: true, rimExponent: 4, rimBoost: 2, rimMask: false,
  halfLambert: false, baseAlphaPhongMask: false, paintable: false, blendTintColorOverBase: 0, colorTintBase: [255, 255, 255],
  translucent: false, alphaTest: false, additive: false, selfIllum: false, selfIllumTint: [255, 255, 255],
  envmap: "", envmapMask: "", envmapTint: [255, 255, 255], customProxies: [],
};

/** The importer's own material (its template), to tell what in a material text is the artist's addition. */
export const builtinVmt = (): KvNode[] => parseKv(TEMPLATE);

/** The game paths (without folder, extension or the skin suffix) of the textures a material takes; a missing one is left out of the VMT. */
export interface MaterialTexturePaths {
  color?: string;
  normal?: string;
  phongexponent?: string;
  illum?: string;
}

const truthy = (v: string) => v !== "" && v !== "0" && Number(v) !== 0 && v.toLowerCase() !== "false";
const flag = (b: boolean) => (b ? "1" : "0");
/** KeyValues::SetFloat writes six decimals. */
const float = (v: number) => v.toFixed(6);
const color255 = (c: readonly number[]) => `{ ${c.map((v) => Math.min(255, Math.max(0, Math.round(v)))).join(" ")} }`;
const color01 = (c: readonly number[]) => `[${c.map((v) => float(Math.min(255, Math.max(0, v)) / 255)).join(" ")}]`;

/** Sets a key only when the value is not the template's own (so an untouched material prints exactly like the importer's). */
function set(kv: KvNode[], key: string, value: string) { setKv(kv, key, value); }

/** The material for a set of settings and textures, as the tree that prints into the .vmt file. */
export function buildVmt(settings: Readonly<MaterialSettings>, textures: Readonly<MaterialTexturePaths>): KvNode[] {
  const root = parseKv(TEMPLATE);
  const kv = root[0].children!;
  const s = settings, d = DEFAULT_MATERIAL;

  set(kv, "$lightwarptexture", s.lightwarp);
  if (s.phongExponent !== d.phongExponent) set(kv, "$phongexponent", float(s.phongExponent));
  if (s.phongBoost !== d.phongBoost) set(kv, "$phongboost", float(s.phongBoost));
  set(kv, "$rimlight", flag(s.rimLight));
  if (s.rimExponent !== d.rimExponent) set(kv, "$rimlightexponent", float(s.rimExponent));
  if (s.rimBoost !== d.rimBoost) set(kv, "$rimlightboost", float(s.rimBoost));
  set(kv, "$rimmask", flag(s.rimMask));
  set(kv, "$halflambert", flag(s.halfLambert));
  set(kv, "$basemapalphaphongmask", flag(s.baseAlphaPhongMask));
  if (s.blendTintColorOverBase !== 0) set(kv, "$blendtintcoloroverbase", float(Math.min(1, Math.max(0, s.blendTintColorOverBase))));
  if (s.colorTintBase.some((v, i) => v !== d.colorTintBase[i])) set(kv, "$colortint_base", color255(s.colorTintBase));
  set(kv, "$translucent", flag(s.translucent));
  set(kv, "$alphatest", flag(s.alphaTest));
  set(kv, "$additive", flag(s.additive));
  const dx9 = findKv(kv, ">=DX90")!.children!;
  set(dx9, "$selfillum", flag(s.selfIllum));
  if (s.selfIllumTint.some((v, i) => v !== d.selfIllumTint[i])) set(kv, "$selfillumtint", color01(s.selfIllumTint));
  set(kv, "$envmap", s.envmap);
  set(kv, "$basealphaenvmapmask", flag(s.envmapMask === "$basealphaenvmapmask"));
  set(kv, "$normalmapalphaenvmapmask", flag(s.envmapMask === "$normalmapalphaenvmapmask"));
  if (s.envmapTint.some((v, i) => v !== d.envmapTint[i])) set(kv, "$envmaptint", color01(s.envmapTint));

  // the textures
  set(kv, "$basetexture", textures.color ?? "");
  set(kv, "$bumpmap", textures.normal ?? "");
  set(kv, "$phongexponenttexture", textures.phongexponent ?? "");
  set(kv, "$selfillummask", textures.illum ?? "");

  removeUnnecessary(kv, s.paintable, !!textures.phongexponent);
  // the artist's own proxies run after the importer's
  const extra = proxyNodes(s.customProxies ?? []);
  if (extra.length) {
    let proxies = findKv(kv, "proxies");
    if (!proxies) { proxies = { key: "proxies", children: [] }; kv.push(proxies); }
    proxies.children!.push(...extra);
  }
  return root;
}

/** RemoveUnnecessaryParametersFromVMT: light, paint, translucent, cubemap and self-illumination parameters that are switched off. */
function removeUnnecessary(kv: KvNode[], paintable: boolean, hasPhongExponentTexture: boolean) {
  // light
  for (const key of ["$basemapalphaphongmask", "$halflambert"]) if (!truthy(findKv(kv, key)?.value ?? "")) removeKv(kv, key);
  if (!hasPhongExponentTexture) removeKv(kv, "$rimmask");
  // paint
  const proxies = findKv(kv, "proxies")?.children;
  if (paintable) {
    if (proxies) removeKv(proxies, "Equals");
  } else {
    for (const key of ["$blendtintbybasealpha", "$blendtintcoloroverbase", "$colortint_base", "$colortint_tmp"]) removeKv(kv, key);
    if (proxies) for (const key of ["ItemTintColor", "SelectFirstIfNonZero", "Multiply"]) removeKv(proxies, key);
  }
  // translucent
  if (!truthy(findKv(kv, "$additive")?.value ?? "")) removeKv(kv, "$additive");
  if (!truthy(findKv(kv, "$translucent")?.value ?? "")) {
    removeKv(kv, "$translucent");
    removeKv(kv, "$alphatest");
  }
  // cube map
  if ((findKv(kv, "$envmap")?.value ?? "") === "") for (const key of ["$envmap", "$basealphaenvmapmask", "$normalmapalphaenvmapmask", "$envmaptint"]) removeKv(kv, key);
  // self-illumination
  if (!truthy(findKv(kv, ">=DX90/$selfillum")?.value ?? "")) for (const key of ["$selfillum", "$selfillumtint", "$selfillummask"]) removeKv(kv, key);
}

export function vmtText(kv: KvNode[]): string { return printKv(kv); }

/**
 * The parameters and proxies a VMT tree gives the renderer, in the shape the game's materials arrive in (lowercased keys, the
 * `>=DX90` block folded in): what a preview material is built from.
 */
export function flattenVmt(root: KvNode[]): { shader: string; params: Record<string, string>; proxies: { name: string; params: Record<string, string> }[] } {
  const top = root[0];
  const params: Record<string, string> = {};
  const proxies: { name: string; params: Record<string, string> }[] = [];
  const read = (nodes: KvNode[]) => {
    for (const n of nodes) {
      if (n.value !== undefined) { if (n.value !== "") params[n.key.toLowerCase()] = n.value; continue; }
      if (n.key.toLowerCase() === "proxies") {
        for (const p of n.children ?? []) {
          const args: Record<string, string> = {};
          for (const a of p.children ?? []) if (a.value !== undefined) args[a.key.toLowerCase()] = a.value;
          proxies.push({ name: p.key.toLowerCase(), params: args });
        }
      } else if (/^[<>]=?dx\d+$/i.test(n.key) || /^dx\d+$/i.test(n.key)) read(n.children ?? []);
    }
  };
  read(top?.children ?? []);
  return { shader: (top?.key ?? "VertexLitGeneric").toLowerCase(), params, proxies };
}

export { cloneKv };
