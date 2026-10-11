/**
 * Finds the files that belong with a file the artist picked, by the names they gave them: `body_lod0.fbx` brings `body_lod1.fbx` and
 * `body_lod2.fbx`; `a_body_diffuse.tga` brings `a_body_normal.tga` and `a_body_expmask.tga`.
 */

const SEPARATORS = ["_", "-", ".", " ", ""];

/** The folder of a path (with its trailing separator, in the path's own style) and the file name. */
export function splitPath(path: string): { dir: string; name: string } {
  const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return { dir: path.slice(0, at + 1), name: path.slice(at + 1) };
}

const stemOf = (name: string) => name.replace(/\.[^.]*$/, "");
const extOf = (name: string) => (/\.[^.]*$/.exec(name)?.[0] ?? "").toLowerCase();

/** The files of the folder by lowercase stem, for the files of one extension. */
function byStem(files: string[], ext: string) {
  const map = new Map<string, string>();
  for (const f of files) if (extOf(f) === ext) map.set(stemOf(f).toLowerCase(), f);
  return map;
}

/**
 * The LOD 1 and LOD 2 files that go with a LOD 0 file in the same folder: the same name with `lod1` / `lod2` where it has `lod0`, or
 * after the name when it has no LOD in it (`hat.fbx`: `hat_lod1.fbx`, `hat_lod.fbx`). Full paths, or null where there is none.
 */
export function lodSiblings(path: string, files: string[]): [string | null, string | null] {
  const { dir, name } = splitPath(path);
  const ext = extOf(name);
  const stem = stemOf(name);
  const m = /^(.*?)([_\-. ]?)lod(\d*)$/i.exec(stem);
  if (m && m[3] !== "" && Number(m[3]) !== 0) return [null, null]; // a lower LOD was picked as the first
  const base = m ? m[1] : stem;
  const preferred = m ? m[2] : "_";
  const lookup = byStem(files, ext);
  const find = (n: number): string | null => {
    const separators = [preferred, ...SEPARATORS.filter((s) => s !== preferred)];
    for (const sep of separators) {
      const names = [`${base}${sep}lod${n}`, ...(n === 1 ? [`${base}${sep}lod`] : [])];
      for (const candidate of names) {
        const hit = lookup.get(candidate.toLowerCase());
        if (hit && hit.toLowerCase() !== name.toLowerCase()) return dir + hit;
      }
    }
    return null;
  };
  return [find(1), find(2)];
}

export type TextureRole = "color" | "normal" | "phongexponent" | "illum";

/** How artists name the textures of a material (the words after the name). */
const ROLE_WORDS: Record<TextureRole, string[]> = {
  color: ["diffuse", "color", "colour", "albedo", "basecolor", "base_color", "base", "diff", "col", "d"],
  normal: ["normalmap", "normal", "norm", "nrm", "nm", "n"],
  phongexponent: ["phongexponent", "phongexp", "expmask", "exponent", "expmap", "exp"],
  illum: ["selfillum", "illummask", "illum", "emissive", "emission", "glow"],
};

/** The role a file name says it has and the name without it (`a_body_diffuse`: color, `a_body`), or null. */
export function textureRole(name: string): { role: TextureRole; prefix: string; separator: string } | null {
  const stem = stemOf(name).toLowerCase();
  let best: { role: TextureRole; word: string; separator: string } | null = null;
  for (const [role, words] of Object.entries(ROLE_WORDS) as [TextureRole, string[]][]) {
    for (const word of words) {
      if (!stem.endsWith(word)) continue;
      const before = stem.slice(0, stem.length - word.length);
      const separator = before === "" ? "" : before.slice(-1);
      if (before !== "" && !["_", "-", ".", " "].includes(separator)) continue;
      if (!best || word.length > best.word.length) best = { role, word, separator };
    }
  }
  if (!best) return null;
  const cut = stemOf(name).length - best.word.length - (best.separator ? 1 : 0);
  return { role: best.role, prefix: stemOf(name).slice(0, cut), separator: best.separator };
}

/** The other textures of the material of a picked texture, from the same folder: full paths by role (not the picked one's). */
export function textureSiblings(path: string, files: string[]): Partial<Record<TextureRole, string>> {
  const { dir, name } = splitPath(path);
  const found = textureRole(name);
  if (!found) return {};
  const lookup = byStem(files, extOf(name));
  const out: Partial<Record<TextureRole, string>> = {};
  for (const [role, words] of Object.entries(ROLE_WORDS) as [TextureRole, string[]][]) {
    if (role === found.role) continue;
    for (const word of words) {
      const hit = lookup.get(`${found.prefix}${found.separator}${word}`.toLowerCase());
      if (hit) { out[role] = dir + hit; break; }
    }
  }
  return out;
}

/** The words artists put before a model's name for a class (the folder name of the class, and what else it is called). */
export const CLASS_NAMES: Record<string, string[]> = {
  scout: ["scout"], soldier: ["soldier"], pyro: ["pyro"], demo: ["demo", "demoman"], heavy: ["heavy", "heavyweapons"],
  engineer: ["engineer", "engie"], medic: ["medic"], sniper: ["sniper"], spy: ["spy"],
};

/**
 * The files of the other classes that go with a model named for a class (`sniper_hat.fbx`): the same name after another class's name
 * (`heavy_hat.fbx`, `spy_hat.fbx`), in the same folder. By class folder name, full paths; `except` (the class the file is for) is left out.
 */
export function classSiblings(path: string, files: string[], except: string): Record<string, string> {
  const { dir, name } = splitPath(path);
  const stem = stemOf(name);
  const lower = stem.toLowerCase();
  let rest: string | null = null, separator = "";
  for (const words of Object.values(CLASS_NAMES)) {
    for (const word of words) {
      if (lower.startsWith(word) && ["_", "-", ".", " "].includes(lower[word.length] ?? "") && lower.length > word.length + 1) {
        rest = stem.slice(word.length + 1);
        separator = lower[word.length];
      }
    }
  }
  if (rest === null) return {};
  const lookup = byStem(files, extOf(name));
  const out: Record<string, string> = {};
  for (const [folder, words] of Object.entries(CLASS_NAMES)) {
    if (folder === except) continue;
    for (const word of words) {
      const hit = lookup.get(`${word}${separator}${rest}`.toLowerCase());
      if (hit) { out[folder] = dir + hit; break; }
    }
  }
  return out;
}

/** The texture folders beside a model that sits in a folder called `mesh` (`texture`, `textures`), with their trailing separator; none for another folder. */
export function textureDirsFor(path: string): string[] {
  const { dir } = splitPath(path);
  const mesh = splitPath(dir.replace(/[\\/]+$/, ""));
  if (!/^(mesh|meshes)$/i.test(mesh.name)) return [];
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return ["texture", "textures"].map((n) => `${mesh.dir}${n}${sep}`);
}

/** The diffuse texture of a material among the .tga files of a folder: named after the material (with a diffuse word after it, or nothing). */
export function materialDiffuse(material: string, files: string[]): string | null {
  const wanted = material.toLowerCase();
  const named = files.filter((f) => extOf(f) === ".tga" && stemOf(f).toLowerCase().includes(wanted));
  if (!named.length) return null;
  const byRole = named.find((f) => textureRole(f)?.role === "color");
  if (byRole) return byRole;
  return named.find((f) => stemOf(f).toLowerCase() === wanted) ?? null;
}
