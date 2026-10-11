import type { CaptureMouse } from "../viewer/playMouse";

/**
 * Play mode's mouse in a browser: the pointer lock (the desktop build reads raw motion from the system instead and reports the same things:
 * motion in pixels, a wheel in notches of 120, and the buttons as 1 / 2 for left down / up and 4 / 8 for right down / up).
 */
let wheelHandler: ((delta: number) => void) | null = null;
// Play mode stops the page's own wheel events before anything else sees them (it is on the window first): this one is on the window earlier
window.addEventListener("wheel", (e) => { if (wheelHandler) wheelHandler(-Math.sign(e.deltaY) * 120); }, { capture: true, passive: true });

export const capturePlayMouse: CaptureMouse = async (surface, motion, released, wheel, buttons) => {
  const locked = () => document.pointerLockElement === surface;
  const onMove = (e: MouseEvent) => { if (locked()) motion(e.movementX, e.movementY); };
  const onDown = (e: MouseEvent) => { if (locked() && (e.button === 0 || e.button === 2)) buttons(e.button === 0 ? 1 : 4); };
  const onUp = (e: MouseEvent) => { if (locked() && (e.button === 0 || e.button === 2)) buttons(e.button === 0 ? 2 : 8); };
  const onLock = () => { if (!locked()) { cleanup(); released(); } };
  const cleanup = () => {
    wheelHandler = null;
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mousedown", onDown, true);
    document.removeEventListener("mouseup", onUp, true);
    document.removeEventListener("pointerlockchange", onLock);
  };
  wheelHandler = (delta) => { if (locked()) wheel(delta); };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mousedown", onDown, true);
  document.addEventListener("mouseup", onUp, true);
  document.addEventListener("pointerlockchange", onLock);
  try { await surface.requestPointerLock(); } catch (error) { cleanup(); throw error; }
  return () => { cleanup(); if (locked()) document.exitPointerLock(); };
};
