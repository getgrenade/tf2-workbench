import { importFbx, type ImportedModel } from "./fbx";
import { importDmx } from "./dmxImport";
import { importSmd } from "./smdImport";

/** The model formats the compiler reads (item_import.cpp takes the same three). */
export const MODEL_EXTENSIONS = ["fbx", "smd", "dmx"] as const;

/** Reads a source model by the extension of its file. */
export function importModel(path: string, buffer: ArrayBuffer): ImportedModel {
  const ext = /\.([^.\\/]*)$/.exec(path)?.[1]?.toLowerCase();
  if (ext === "smd") return importSmd(buffer);
  if (ext === "dmx") return importDmx(buffer);
  return importFbx(buffer);
}
