import { findKv, getKv, parseKv, type KvNode } from "./kv";
import { parseJiggleQc } from "./jiggleBones";
import { BODYGROUPS, PREFABS, blankData, blankMaterial, sanitizeName, type BlueTint, type CompilerData, type CompilerMaterial, type Prefab } from "./session";
import { DEFAULT_MATERIAL, builtinVmt, flattenVmt, type EnvmapMask, type MaterialSettings } from "./vmt";
import { customProxiesFromVmt } from "./proxyModel";

/**
 * Reads the session file the item importer writes next to its archive (\`import_source/<name>.txt\`, also what this tool writes beside the
 * zip it builds): the item's type, region, hidden body groups, the model files of each class, the materials with their textures and
 * material text, and the icon. The files it names are the artist's own source files; what is gone from disk shows up as a failure to
 * read when the session loads.
 */
export class ImportSessionError extends Error {}

const truthy = (v: string | undefined) => v !== undefined && v !== "" && v !== "0" && Number(v) !== 0 && v.toLowerCase() !== "false";
const num = (v: string | undefined, fallback: number) => { const n = Number(v); return v !== undefined && v !== "" && Number.isFinite(n) ? n : fallback; };

/** "{ 255 128 0 }" or "[1 0.5 0]" (a 0-1 colour when \`unit\`) as 0-255 numbers, or the fallback. */
function colour(v: string | undefined, unit: boolean, fallback: [number, number, number]): [number, number, number] {
  const parts = (v ?? "").replace(/[{}\[\]]/g, " ").trim().split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p))) return [...fallback];
  return parts.map((p) => Math.min(255, Math.max(0, Math.round(unit ? p * 255 : p)))) as [number, number, number];
}

/** The settings a material text gives (what the compiler's controls show for it); parameters it does not have keep their defaults. */
export function settingsFromVmt(root: KvNode[]): MaterialSettings {
  const { params: p } = flattenVmt(root);
  const d = DEFAULT_MATERIAL;
  const envmapMask: EnvmapMask = truthy(p["$basealphaenvmapmask"]) ? "$basealphaenvmapmask" : truthy(p["$normalmapalphaenvmapmask"]) ? "$normalmapalphaenvmapmask" : "";
  return {
    lightwarp: p["$lightwarptexture"] ?? d.lightwarp,
    phongExponent: num(p["$phongexponent"], d.phongExponent),
    phongBoost: num(p["$phongboost"], d.phongBoost),
    rimLight: p["$rimlight"] === undefined ? d.rimLight : truthy(p["$rimlight"]),
    rimExponent: num(p["$rimlightexponent"], d.rimExponent),
    rimBoost: num(p["$rimlightboost"], d.rimBoost),
    rimMask: truthy(p["$rimmask"]),
    halfLambert: truthy(p["$halflambert"]),
    baseAlphaPhongMask: truthy(p["$basemapalphaphongmask"]),
    // the importer keeps the paint switch in the session, not in the text: a text with paint colours is taken as paintable until it is told
    paintable: p["$colortint_base"] !== undefined,
    blendTintColorOverBase: num(p["$blendtintcoloroverbase"], d.blendTintColorOverBase),
    colorTintBase: colour(p["$colortint_base"], false, d.colorTintBase),
    translucent: truthy(p["$translucent"]),
    alphaTest: truthy(p["$alphatest"]),
    additive: truthy(p["$additive"]),
    selfIllum: truthy(p["$selfillum"]),
    selfIllumTint: colour(p["$selfillumtint"], true, d.selfIllumTint),
    envmap: p["$envmap"] ?? "",
    envmapMask,
    envmapTint: colour(p["$envmaptint"], true, d.envmapTint),
    // what the artist added to the proxies of the text (the importer keeps the text as it was edited): kept, to be shown, edited and written back
    customProxies: customProxiesFromVmt(root, builtinVmt()),
  };
}

const eq = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** The item an importer session file describes, as the compiler's data (the files are read when it is loaded). Throws ImportSessionError. */
export function parseImportSession(text: string): CompilerData {
  let root: KvNode[];
  try { root = parseKv(text); } catch (error) { throw new ImportSessionError(`Not a session file: ${error instanceof Error ? error.message : String(error)}`); }
  const session = findKv(root, "data/ImportSession") ?? findKv(root, "asset/ImportSession");
  if (!session?.children) throw new ImportSessionError("Not an item importer session file (no ImportSession in it).");
  const nodes = session.children;
  const out = blankData();
  const rawName = getKv(nodes, "name");
  out.name = rawName ? sanitizeName(rawName) || rawName : "";
  const prefab = getKv(nodes, "prefab") as Prefab;
  out.prefab = PREFABS.includes(prefab) ? prefab : out.prefab;
  const region = getKv(nodes, "equip_region");
  out.region = region || out.region;
  out.bodygroups = (findKv(nodes, "bodygroup")?.children ?? []).map((n) => n.key).filter((b) => BODYGROUPS.includes(b));
  out.icon = getKv(nodes, "icon");
  out.teamColors = getKv(nodes, "skin_type") === "1";

  // the models: LOD0.. of each class that has a first LOD
  for (const cls of findKv(nodes, "classes")?.children ?? []) {
    const lods: [string, string, string] = ["", "", ""];
    for (let i = 0; i < 3; i++) lods[i] = getKv(cls.children ?? [], `LOD${i}/file`);
    if (lods[0]) out.classes[cls.key] = lods;
    // the importer keeps the QC the artist edited with the class, and the `$jigglebone` blocks are in it
    for (const [bone, setup] of Object.entries(parseJiggleQc(getKv(cls.children ?? [], "QC")))) out.jiggles[bone] ??= setup;
  }

  // the materials: named by the source model's names, each with the RED skin's textures and text, and the BLU skin's own where it differs
  const materialsNode = findKv(nodes, "Materials")?.children ?? [];
  const names = [0, 1].map((i) => getKv(materialsNode, `Material${i}`)).filter((n) => n !== "");
  const skin = (which: string, index: number) => findKv(materialsNode, `Skins/${which}/Material${index}`)?.children ?? [];
  names.forEach((name, i) => {
    const red = skin("Red", i), blue = skin("blue", i);
    const m: CompilerMaterial = blankMaterial();
    const redText = getKv(red, "vmt");
    if (redText) {
      try { m.settings = settingsFromVmt(parseKv(redText)); } catch { /* the defaults */ }
    }
    const paintable = getKv(nodes, `paintable${i}`);
    if (paintable !== "") m.settings.paintable = truthy(paintable);
    m.color = getKv(red, "base_texture_file");
    m.normal = getKv(red, "normal_texture_file");
    m.phongexponent = getKv(red, "phongexponent_texture_file");
    m.illum = getKv(red, "selfillum_texture_file");
    if (out.teamColors) {
      const blueBase = getKv(blue, "base_texture_file");
      m.blueColor = blueBase && blueBase !== m.color ? blueBase : "";
      const blueText = getKv(blue, "vmt");
      if (blueText) {
        try {
          const b = settingsFromVmt(parseKv(blueText));
          const tint: BlueTint = { colorTintBase: b.colorTintBase, selfIllumTint: b.selfIllumTint };
          if (!eq(tint.colorTintBase, m.settings.colorTintBase) || !eq(tint.selfIllumTint, m.settings.selfIllumTint)) m.blueTint = tint;
        } catch { /* BLU follows RED */ }
      }
    }
    out.materials[name] = m;
  });
  const schema = findKv(nodes, "ItemSchema")?.children ?? [];
  out.displayName = getKv(schema, "name");
  return out;
}
