/**
 * The web build's stand-in for `@tauri-apps/plugin-dialog`. A path is a token here: "download:<file name>" is a file the browser will
 * download when something is written to it (the save dialog does not ask for a place, the browser does when it downloads), and
 * "upload:<n>:<file name>" is a file the user picked from their computer.
 */
interface Filter { name: string; extensions: string[] }
interface DialogOptions { title?: string; defaultPath?: string; filters?: Filter[]; multiple?: boolean; directory?: boolean }

const uploads = new Map<string, File>();
let counter = 0;

export function downloadBlob(token: string, blob: Blob) {
  const name = token.replace(/^download:/, "") || "download";
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function readUpload(token: string): File {
  const file = uploads.get(token);
  if (!file) throw new Error("that file is not available any more: pick it again");
  return file;
}

/** The file name the browser will offer: the suggested one, with the extension of the first filter when it has none. */
export async function save(options: DialogOptions = {}): Promise<string | null> {
  let name = (options.defaultPath ?? "file").split(/[\/]/).pop() || "file";
  const ext = options.filters?.[0]?.extensions[0];
  if (ext && !/\.[A-Za-z0-9]+$/.test(name)) name += `.${ext}`;
  return `download:${name}`;
}

/** The browser's file picker (folders cannot be picked: the web build has no folder to read). */
export function open(options: DialogOptions = {}): Promise<string | null> {
  if (options.directory) return Promise.resolve(null);
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    const extensions = (options.filters ?? []).flatMap((f) => f.extensions.map((e) => `.${e}`));
    if (extensions.length) input.accept = extensions.join(",");
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      const token = `upload:${++counter}:${file.name}`;
      uploads.set(token, file);
      resolve(token);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}
