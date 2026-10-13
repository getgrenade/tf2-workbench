/**
 * Files dropped on the window from the file explorer. The window's drop handler reports where and which (the page itself gets no path for a
 * file dropped on it); this finds the element under the pointer that takes files (one with `data-file-drop`), marks it while the files are over
 * it and gives it the paths in a `workbench:filedrop` event when they are dropped.
 */
import { getCurrentWebview } from "@tauri-apps/api/webview";

export const FILE_DROP_EVENT = "workbench:filedrop";

export interface FileDropDetail { paths: string[] }

export async function installFileDrop() {
  let over: HTMLElement | null = null;
  const mark = (next: HTMLElement | null) => {
    if (next === over) return;
    over?.classList.remove("fileDropOver");
    over = next;
    over?.classList.add("fileDropOver");
  };
  await getCurrentWebview().onDragDropEvent((event) => {
    const p = event.payload;
    if (p.type === "leave") { mark(null); return; }
    // the position is in the window's pixels; the page's are those over the pixel ratio (which has the zoom of the interface in it)
    const ratio = window.devicePixelRatio || 1;
    const target = document.elementFromPoint(p.position.x / ratio, p.position.y / ratio)?.closest<HTMLElement>("[data-file-drop]") ?? null;
    mark(target);
    if (p.type === "drop") {
      const dropped = over;
      mark(null);
      dropped?.dispatchEvent(new CustomEvent<FileDropDetail>(FILE_DROP_EVENT, { detail: { paths: p.paths } }));
    }
  });
}
