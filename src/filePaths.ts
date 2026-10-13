/** Picking among the files dropped on a row: no DOM, no window, so that it can be tested. */

/** The paths among those dropped that a kind of file row takes (`model`: .fbx, .smd, .dmx; `tga`; `smd`), the first one when there are several. */
export function acceptedPath(kind: "fbx" | "tga" | "smd" | "txt" | "folder", paths: readonly string[]): string | null {
  const ext = (p: string) => /\.([^.\/]+)$/.exec(p)?.[1]?.toLowerCase() ?? "";
  const ok = kind === "fbx" ? ["fbx", "smd", "dmx"] : kind === "tga" ? ["tga"] : kind === "smd" ? ["smd"] : kind === "txt" ? ["txt"] : null;
  return paths.find((p) => (ok ? ok.includes(ext(p)) : ext(p) === "")) ?? null;
}
