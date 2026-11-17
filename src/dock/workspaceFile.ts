/**
 * A workspace file: the layout of the docks (where every panel is, which ones are put away), saved as JSON to load again on this or another
 * computer. The file says what it is, so a scene or any other JSON is not taken for one.
 */
export const WORKSPACE_KIND = "tf2workbench-workspace";

export interface WorkspaceFile {
  kind: typeof WORKSPACE_KIND;
  version: 1;
  /** The layout as the docks keep it (`snapshot`); the docks check it again when it is put on. */
  layout: unknown;
}

export function encodeWorkspace(layout: unknown): string {
  const file: WorkspaceFile = { kind: WORKSPACE_KIND, version: 1, layout };
  return JSON.stringify(file, null, 2);
}

/** The layout of a workspace file; throws when the text is not one. */
export function decodeWorkspace(text: string): unknown {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error("The file is not a workspace (it is not JSON)"); }
  const file = parsed as Partial<WorkspaceFile> | null;
  if (!file || typeof file !== "object" || file.kind !== WORKSPACE_KIND || !file.layout || typeof file.layout !== "object") {
    throw new Error("The file is not a TF2 Workbench workspace");
  }
  return file.layout;
}
