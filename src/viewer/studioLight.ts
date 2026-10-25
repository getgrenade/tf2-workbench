/**
 * The studio light of a promo thumbnail: three-point lighting (https://en.wikipedia.org/wiki/Three-point_lighting). A key light, the main
 * one, to one side and above; a fill on the other side, low and soft, that lifts the key's shadows; a rim from behind, that draws the
 * outline off the backdrop. Each is a direction from the subject as seen from the camera; the pivot turns all three about the subject at
 * once (round it, and over it), so the rig keeps its shape as it is aimed. With it, ambient occlusion, which a close shot shows off.
 */
import * as THREE from "three";
import { DEFAULT_AO, type AoState } from "./aoMath";
import { lightDirection, rotateLightDirection, type RigLight } from "./lighting";

export const STUDIO_ROLES = ["key", "fill", "rim"] as const;
export type StudioRole = (typeof STUDIO_ROLES)[number];
export const STUDIO_LABELS: Record<StudioRole, string> = { key: "Key", fill: "Fill", rim: "Rim" };

/** One light of the rig: where it is (degrees: round from the camera, positive to its right; and up), how bright, its colour. */
export interface StudioLamp {
  on: boolean;
  azimuth: number;
  elevation: number;
  intensity: number;
  color: string;
}

export interface StudioLight {
  on: boolean;
  /** The pivot: how far the whole rig is turned round the subject (degrees, positive to the right) and over it (positive up). */
  yaw: number;
  pitch: number;
  /** All three lights at once (a share of their own intensities). */
  brightness: number;
  /** The light from everywhere under the rig (low: the rig shapes the subject; the scene's own lights are not in the shot). */
  ambient: number;
  key: StudioLamp;
  fill: StudioLamp;
  rim: StudioLamp;
  ao: boolean;
  /** How much the occlusion darkens, 0..1. */
  aoStrength: number;
}

/** The classic rig: a warm key high on the right, a cool fill low on the left at about a third of it, a bright rim behind on the fill's side. */
export const DEFAULT_STUDIO: StudioLight = {
  on: true, yaw: 0, pitch: 0, brightness: 1, ambient: 0.12,
  key: { on: true, azimuth: 40, elevation: 35, intensity: 1.3, color: "#fff1e0" },
  fill: { on: true, azimuth: -60, elevation: 10, intensity: 0.4, color: "#dde8ff" },
  rim: { on: true, azimuth: -145, elevation: 35, intensity: 2.6, color: "#ffffff" },
  ao: true, aoStrength: 0.8,
};

const num = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
const hex = (v: unknown, fallback: string) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback);

/** A studio light read back (from a saved board), with what is missing or wrong as the default has it. */
export function parseStudio(raw: unknown): StudioLight {
  const s = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof StudioLight, unknown>>;
  const d = DEFAULT_STUDIO;
  const lamp = (v: unknown, f: StudioLamp): StudioLamp => {
    const l = (v && typeof v === "object" ? v : {}) as Partial<Record<keyof StudioLamp, unknown>>;
    return { on: typeof l.on === "boolean" ? l.on : f.on, azimuth: num(l.azimuth, -360, 360, f.azimuth), elevation: num(l.elevation, -90, 90, f.elevation), intensity: num(l.intensity, 0, 4, f.intensity), color: hex(l.color, f.color) };
  };
  return {
    on: typeof s.on === "boolean" ? s.on : d.on,
    yaw: num(s.yaw, -180, 180, d.yaw), pitch: num(s.pitch, -90, 90, d.pitch),
    brightness: num(s.brightness, 0, 3, d.brightness), ambient: num(s.ambient, 0, 1, d.ambient),
    key: lamp(s.key, d.key), fill: lamp(s.fill, d.fill), rim: lamp(s.rim, d.rim),
    ao: typeof s.ao === "boolean" ? s.ao : d.ao, aoStrength: num(s.aoStrength, 0, 1, d.aoStrength),
  };
}

/** Where a light of the rig is, as seen from the camera, with the pivot's turn: [azimuth, elevation] in degrees. */
export function studioAngles(s: StudioLight, role: StudioRole): [number, number] {
  const l = s[role];
  return rotateLightDirection(l.azimuth, l.elevation, s.yaw, s.pitch);
}

/** The light-local angles that put a light where it is seen at [azimuth, elevation] (from the camera, the pivot's turn taken back off). */
export function lampAnglesFor(s: StudioLight, azimuth: number, elevation: number): [number, number] {
  // (the pivot turns about X by its pitch, then about Y by its yaw: undone in the other order)
  const r = Math.PI / 180;
  const d = lightDirection(azimuth, elevation).applyAxisAngle(new THREE.Vector3(0, 1, 0), -s.yaw * r).applyAxisAngle(new THREE.Vector3(1, 0, 0), s.pitch * r);
  const az = Math.atan2(d.x, d.z) / r;
  return [Math.round(az * 10) / 10, Math.round((Math.asin(Math.max(-1, Math.min(1, d.y))) / r) * 10) / 10];
}

/**
 * The rig as the renderer's lights: three directional lights. With `camera` (the shot's camera turn) they are fixed in the world where
 * the camera sees them; without, they turn with the view (as in the 3D view, where the view is the shot's camera while it is edited).
 * The key casts the shadows.
 */
export function studioRigLights(s: StudioLight, camera?: THREE.Quaternion): RigLight[] {
  return STUDIO_ROLES.map((role) => {
    const lamp = s[role];
    let [azimuth, elevation] = studioAngles(s, role);
    if (camera) {
      const d = lightDirection(azimuth, elevation).applyQuaternion(camera);
      azimuth = (Math.atan2(d.x, d.z) * 180) / Math.PI;
      elevation = (Math.asin(Math.max(-1, Math.min(1, d.y))) * 180) / Math.PI;
    }
    // The key casts the shadows. The rim takes the same plain Lambert path (a light that casts shadows does: the others are wrapped round the
    // model as Source's half-Lambert does, which would wash a light from behind over the whole front), with no shadow of its own and a sharper
    // falloff, so it only catches the edges turned toward it. The fill keeps the wrap: soft, everywhere.
    return {
      id: `studio-${role}`, name: `${STUDIO_LABELS[role]} light`, type: "directional", enabled: lamp.on && lamp.intensity > 0,
      azimuth, elevation, intensity: lamp.intensity * s.brightness, color: lamp.color, followCamera: !camera,
      position: [0, 0, 0], range: 250, falloff: 1.5, cone: 45,
      shadows: role !== "fill", shadowSoftness: 1.5, ...(role === "rim" ? { shadowStrength: 0, curve: 2 } : {}),
    };
  });
}

/** The rig mirrored left to right: each light, and the pivot, to the other side (the same height, brightness and colour). */
export const flipStudio = (s: StudioLight): StudioLight => ({
  ...s, yaw: s.yaw === 0 ? 0 : -s.yaw,
  key: { ...s.key, azimuth: -s.key.azimuth }, fill: { ...s.fill, azimuth: -s.fill.azimuth }, rim: { ...s.rim, azimuth: -s.rim.azimuth },
});

/** A colour from its hue (degrees), saturation and lightness (0..1), as `#rrggbb`. */
function hsl(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return "#" + [f(0), f(8), f(4)].map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, "0")).join("");
}

/**
 * The colour schemes a random setup is made in: the light's colour temperatures, as a photographer pairs them (each gives the key, the
 * fill and the rim from a few random draws, so no two are quite the same).
 */
const SCHEMES: ((r: (a: number, b: number) => number) => [string, string, string])[] = [
  // warm key, cool fill: daylight against the sky, the classic
  (r) => [hsl(r(25, 45), r(0.5, 0.9), r(0.9, 0.95)), hsl(r(200, 225), r(0.5, 0.9), r(0.86, 0.92)), hsl(r(190, 220), r(0, 0.4), r(0.93, 0.97))],
  // moonlight: a cool key and fill, a warm rim
  (r) => [hsl(r(205, 225), r(0.4, 0.8), r(0.88, 0.93)), hsl(r(228, 250), r(0.5, 0.9), r(0.8, 0.88)), hsl(r(25, 40), r(0.7, 1), r(0.75, 0.85))],
  // a near white key and fill, an accent colour in the rim
  (r) => [hsl(r(30, 45), r(0, 0.3), r(0.94, 0.97)), hsl(r(200, 230), r(0, 0.3), r(0.92, 0.96)), hsl([190, 285, 28, 168, 335][Math.floor(r(0, 5))], r(0.7, 1), r(0.68, 0.78))],
  // sunset: an orange key, a violet fill, a pink rim
  (r) => [hsl(r(18, 32), r(0.7, 1), r(0.84, 0.9)), hsl(r(255, 280), r(0.5, 0.8), r(0.8, 0.86)), hsl(r(330, 350), r(0.6, 0.9), r(0.8, 0.86))],
];

/**
 * A random three-point setup that keeps the rules of one: the key on one side and above (25 to 60° round, 20 to 50° up); the fill on the
 * other side and lower, at a key-to-fill ratio from 2:1 (soft) to 8:1 (dramatic); the rim behind (125 to 165° round), mostly on the fill's
 * side, where it outlines the side in shadow; the colours in one of a few schemes of colour temperature; a low ambient. The pivot is back at
 * the front, and the occlusion as the default has it.
 */
export function randomStudio(rand: () => number = Math.random): StudioLight {
  const r = (a: number, b: number) => a + (b - a) * rand();
  const round1 = (x: number) => Math.round(x * 10) / 10, round2 = (x: number) => Math.round(x * 100) / 100;
  const side = rand() < 0.5 ? 1 : -1;
  const [keyColor, fillColor, rimColor] = SCHEMES[Math.floor(rand() * SCHEMES.length)](r);
  const keyEl = r(20, 50), key = r(1.1, 1.6), ratio = r(2, 8);
  const rimSide = rand() < 0.7 ? -side : side;
  return {
    ...DEFAULT_STUDIO, yaw: 0, pitch: 0, brightness: 1, ambient: round2(r(0.05, 0.15)),
    key: { on: true, azimuth: round1(side * r(25, 60)), elevation: round1(keyEl), intensity: round2(key), color: keyColor },
    fill: { on: true, azimuth: round1(-side * r(35, 75)), elevation: round1(r(-5, Math.min(20, keyEl - 10))), intensity: round2(key / ratio), color: fillColor },
    rim: { on: true, azimuth: round1(rimSide * r(125, 165)), elevation: round1(r(15, 45)), intensity: round2(r(1.6, 3.2)), color: rimColor },
  };
}

/** The thumbnail's ambient occlusion (the scene's settings otherwise: its reach, its contrast). */
export const studioAo = (s: StudioLight): AoState => ({ ...DEFAULT_AO, enabled: s.on && s.ao, strength: s.aoStrength });
