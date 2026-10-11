import * as THREE from "three";
import { parseOverlay, type CameraOverlayData } from "./overlayData";

export const CAMERA_RATIOS = ["16:9", "1:1", "9:16", "4:3", "3:4"] as const;
export type CameraRatio = typeof CAMERA_RATIOS[number];
export interface SceneCamera {
  id: string;
  name: string;
  position: [number, number, number];
  quaternion: [number, number, number, number];
  /** Vertical field of view inside the output frame (the panels show it as the horizontal one, like the view setting). */
  fov: number;
  ratio: CameraRatio;
  height: number;
  /** Allow viewport navigation to edit the saved transform. Defaults off. */
  navigateView?: boolean;
  /** A shot of this camera includes the background (the sky or the colour) and the ground plane. Defaults off: they are left out. */
  captureBackground?: boolean;
  overlay?: CameraOverlayData;
  /** The outliner folder the camera is in. */
  group?: string;
}
export interface CameraCollection { cameras: SceneCamera[]; active: string | null }
export function cameraSizes(ratio: CameraRatio): { w: number; h: number }[] {
  if (ratio === "1:1") return [1024, 2048].map(n => ({ w: n, h: n }));
  // Landscape uses output height; portrait uses the same dimensions turned upright.
  const landscape = ratio === "16:9" || ratio === "9:16";
  const sizes = landscape ? [1080, 1440, 2560].map(h => ({ w: Math.round(h * 16 / 9), h })) : [768, 1536, 2400].map(h => ({ w: h * 4 / 3, h }));
  return ratio === "9:16" || ratio === "3:4" ? sizes.map(s => ({ w: s.h, h: s.w })) : sizes;
}
export function cameraSize(camera: SceneCamera) {
  const sizes = cameraSizes(camera.ratio);
  return sizes.find(s => s.h === camera.height) ?? sizes[0];
}
/** The range of the field of view settings (the view's and a camera's), in degrees of the horizontal one. */
export const FOV_MIN = 10, FOV_MAX = 100;
/** The horizontal field of view of a vertical one at an aspect ratio (width / height), and the way back. */
export const horizontalFov = (vertical: number, aspect: number) => THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(vertical) / 2) * aspect));
export const verticalFov = (horizontal: number, aspect: number) => THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(horizontal) / 2) / aspect));
export function cameraFrame(width: number, height: number, aspect: number) {
  const w = Math.min(width, height * aspect), h = w / aspect;
  return { x: (width - w) / 2, y: (height - h) / 2, w, h };
}
export function cameraProjection(data: SceneCamera, near = .1, far = 10000) {
  const size = cameraSize(data);
  const camera = new THREE.PerspectiveCamera(data.fov, size.w / size.h, near, far);
  camera.position.fromArray(data.position);
  camera.quaternion.fromArray(data.quaternion).normalize();
  camera.updateMatrixWorld(true);
  return camera;
}
export function parseCameras(raw: unknown): CameraCollection {
  const value = raw as Partial<CameraCollection> | null;
  const cameras: SceneCamera[] = [], ids = new Set<string>();
  const vec = (v: unknown, n: number): v is number[] => Array.isArray(v) && v.length === n && v.every(x => typeof x === "number" && Number.isFinite(x));
  for (const c of Array.isArray(value?.cameras) ? value.cameras : []) {
    if (!c || typeof c.id !== "string" || ids.has(c.id) || !vec(c.position, 3) || !vec(c.quaternion, 4) || !CAMERA_RATIOS.includes(c.ratio) || !Number.isFinite(c.fov) || c.fov <= 1 || c.fov >= 179 || c.quaternion.every(n => n === 0)) continue;
    const q = new THREE.Quaternion().fromArray(c.quaternion).normalize();
    const copy: SceneCamera = { id: c.id, name: typeof c.name === "string" ? c.name : "Camera", position: [...c.position], quaternion: q.toArray(), fov: c.fov, ratio: c.ratio, height: c.height };
    copy.height = cameraSize(copy).h;
    if (c.navigateView === true) copy.navigateView = true;
    if (c.captureBackground === true) copy.captureBackground = true;
    if (typeof c.group === "string" && c.group) copy.group = c.group.slice(0, 64);
    const overlay = parseOverlay(c.overlay); if (overlay) copy.overlay = overlay;
    cameras.push(copy); ids.add(c.id);
  }
  return { cameras, active: typeof value?.active === "string" && ids.has(value.active) ? value.active : null };
}
