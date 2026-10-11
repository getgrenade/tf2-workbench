import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type CaptureMouse = (surface: HTMLElement, motion: (x: number, y: number) => void, released: () => void, wheel: (delta: number) => void, buttons: (flags: number) => void) => Promise<() => void>;

/** Use native raw motion: WebView2 pointer lock always displays its own localhost banner. */
export const capturePlayMouse: CaptureMouse = async (surface, motion, released, wheel, buttons) => {
  const id = crypto.randomUUID();
  const offMotion = await listen<[string, [number, number]]>("play-mouse-motion", ({ payload }) => {
    if (payload[0] === id) motion(...payload[1]);
  });
  let offRelease: (() => void) | undefined;
  let offWheel: (() => void) | undefined;
  let offButtons: (() => void) | undefined;
  try {
    offRelease = await listen<string>("play-mouse-released", ({ payload }) => { if (payload === id) released(); });
    offWheel = await listen<[string, number]>("play-mouse-wheel", ({ payload }) => { if (payload[0] === id) wheel(payload[1]); });
    offButtons = await listen<[string, number]>("play-mouse-buttons", ({ payload }) => { if (payload[0] === id) buttons(payload[1]); });
    const rect = surface.getBoundingClientRect();
    await invoke("play_mouse_start", { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, id });
  } catch (error) {
    offMotion(); offRelease?.(); offWheel?.(); offButtons?.();
    throw error;
  }
  return () => {
    offMotion(); offRelease?.(); offWheel?.(); offButtons?.();
    void invoke("play_mouse_stop", { id }).catch(console.error);
  };
};
