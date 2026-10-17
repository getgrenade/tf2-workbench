import * as THREE from "three";
export const MAX_LIGHTS = 8;
export interface RigLight {
  id: string;
  name: string;
  type: "directional" | "point" | "spot";
  enabled: boolean;
  azimuth: number;
  elevation: number;
  /** Spotlight orientation: local +Z is the emitted beam, including roll. */
  rotation?: [number, number, number, number];
  intensity: number;
  color: string;
  /** Directional lights only: where their gizmo sits when it is not in the middle of the scene (it does not change the light). */
  pivot?: [number, number, number];
  /** Directional lights only: the direction is relative to the camera (it turns with the view) instead of the world. */
  followCamera?: boolean;
  /** The outliner folder the light is in. */
  group?: string;
  position: [
    number,
    number,
    number
  ];
  range: number;
  falloff: number;
  cone: number;
  shadows: boolean;
  /** How dark its shadows are, 0..1 (absent: 1). */
  shadowStrength?: number;
  /** How soft its shadows are, times the rig's softness (absent: 1). */
  shadowSoftness?: number;
  /** How it falls off toward the side that turns from it: a power of its Lambert term (absent: 1; higher falls off sooner). */
  curve?: number;
}
/**
 * How the shadows of the lights are made, as Source Filmmaker makes them (the engine's flashlight: see rigShadow in lightingShader.ts): the size of
 * each light's shadow map, the size of the filter in texels (softness), and the engine's depth bias, a constant and a slope-scaled one (its defaults
 * are 3, 0.0005 and 16), the colour of what is in shadow (tint: black is the plain dark shadow; the light that the shadow lets through is that
 * colour, so a blue tint is a shadow lit by a blue sky).
 */
export interface ShadowQuality {
  resolution: number;
  filter: number;
  depthBias: number;
  slopeBias: number;
  tint: string;
}
export const SHADOW_RESOLUTIONS = [512, 1024, 2048, 4096];
export const DEFAULT_SHADOW_QUALITY: ShadowQuality = { resolution: 2048, filter: 3, depthBias: .0005, slopeBias: 16, tint: "#000000" };
export function parseShadowQuality(raw: unknown): ShadowQuality {
  const v = raw as Partial<ShadowQuality> | null;
  const d = DEFAULT_SHADOW_QUALITY;
  const n = (x: unknown, fallback: number, lo: number, hi: number) => typeof x === "number" && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fallback;
  const wanted = typeof v?.resolution === "number" ? v.resolution : d.resolution;
  const resolution = SHADOW_RESOLUTIONS.reduce((best, r) => Math.abs(r - wanted) < Math.abs(best - wanted) ? r : best, d.resolution);
  return { resolution, filter: n(v?.filter, d.filter, 0, 12), depthBias: n(v?.depthBias, d.depthBias, 0, .01), slopeBias: n(v?.slopeBias, d.slopeBias, 0, 64), tint: typeof v?.tint === "string" && /^#[\da-f]{6}$/i.test(v.tint) ? v.tint.toLowerCase() : d.tint };
}
export interface LightingRig {
  shadow: ShadowQuality;
  lights: RigLight[];
  selected: string | null;
  marker: boolean;
}
/** How far a new light reaches: a point light starts small (a fifth of a spot's reach) so it lights what is near it. */
export const defaultLightRange = (type: RigLight["type"]) => type === "point" ? 50 : 250;
export function newRigLight(id: string, type: RigLight["type"] = "point", position: [
  number,
  number,
  number
] = [60, 100, 100]): RigLight {
  // a directional light turns with the camera unless it is told not to, as in hlmv
  return { id, name: `${type[0].toUpperCase() + type.slice(1)} light`, type, enabled: true, azimuth: 0, elevation: 20, intensity: 1, color: "#ffffff", position: [...position], range: defaultLightRange(type), falloff: 1.5, cone: 45, shadows: false, ...(type === "directional" ? { followCamera: true } : {}) };
}
export function defaultLightingRig(primary?: {
  azimuth: number;
  elevation: number;
  intensity: number;
  color: string;
}): LightingRig {
  // Callers also pass full LightState objects. Never spread them into a light:
  // their rig would recursively embed the previous rig on every refresh.
  return { marker: false, selected: "light-0", shadow: { ...DEFAULT_SHADOW_QUALITY }, lights: [headlight(0, primary)] };
}
/** The light a scene starts with: one directional light that turns with the camera. */
function headlight(slot: number, primary?: { azimuth: number; elevation: number; intensity: number; color: string }): RigLight {
  return { ...newRigLight(`light-${slot}`, "directional"), ...(slot === 0 && primary ? { intensity: primary.intensity, color: primary.color } : {}), name: `Light ${slot + 1}`, followCamera: true, azimuth: slot === 0 ? primary?.azimuth ?? 0 : slot === 1 ? 120 : 240, elevation: slot === 0 ? primary?.elevation ?? 0 : 25 };
}
const number = (v: unknown, fallback: number, lo: number, hi: number) => typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
export function parseLightingRig(value: unknown, primary?: Parameters<typeof defaultLightingRig>[0]): LightingRig {
  const base = defaultLightingRig(primary), raw = value as (Partial<LightingRig> & { mode?: string }) | null;
  if (!raw || typeof raw !== "object")
    return base;
  const light = (value: Partial<RigLight>, fallback: RigLight): RigLight => {
    const parsed: RigLight = {
    ...fallback, id: typeof value.id === "string" ? value.id : fallback.id,
    name: typeof value.name === "string" ? value.name.slice(0, 80) : fallback.name,
    type: value.type === "point" || value.type === "spot" ? value.type : "directional",
    enabled: typeof value.enabled === "boolean" ? value.enabled : fallback.enabled, shadows: value.shadows === true,
    color: typeof value.color === "string" && /^#[\da-f]{6}$/i.test(value.color) ? value.color : fallback.color,
    azimuth: (number(value.azimuth, fallback.azimuth, -360, 360) % 360 + 360) % 360, elevation: number(value.elevation, fallback.elevation, -90, 90),
    intensity: number(value.intensity, fallback.intensity, 0, 10), range: number(value.range, fallback.range, 1, 5000),
    falloff: number(value.falloff, fallback.falloff, .2, 6), cone: number(value.cone, fallback.cone, 5, 85),
    position: Array.isArray(value.position) && value.position.length === 3 ? value.position.map((v, i) => number(v, fallback.position[i], -10000, 10000)) as [
      number,
      number,
      number
    ] : [...fallback.position],
    };
    if (typeof value.group === "string" && value.group) parsed.group = value.group.slice(0, 64);
    if (typeof value.shadowStrength === "number" && value.shadowStrength < 1) parsed.shadowStrength = number(value.shadowStrength, 1, 0, 1);
    if (typeof value.shadowSoftness === "number" && value.shadowSoftness !== 1) parsed.shadowSoftness = number(value.shadowSoftness, 1, 0, 4);
    if (typeof value.curve === "number" && value.curve !== 1) parsed.curve = number(value.curve, 1, .25, 4);
    if (parsed.type === "directional" && Array.isArray(value.pivot) && value.pivot.length === 3 && value.pivot.every(n => typeof n === "number" && Number.isFinite(n))) parsed.pivot = value.pivot.map(n => Math.min(10000, Math.max(-10000, n))) as [number, number, number];
    if (parsed.type === "spot" && Array.isArray(value.rotation) && value.rotation.length === 4 && value.rotation.every(n => typeof n === "number" && Number.isFinite(n))) {
      const q = new THREE.Quaternion().fromArray(value.rotation);
      if (q.lengthSq() > 1e-12) {
        q.normalize();
        if (new THREE.Vector3(0, 0, 1).applyQuaternion(q).dot(lightDirection(parsed.azimuth, parsed.elevation)) < -.999999) parsed.rotation = q.toArray();
      }
    }
    return parsed;
  };
  // scenes of the old Simple mode: its enabled lights (always turning with the camera) become the lights of the rig
  const legacy = raw.mode !== "advanced" && Array.isArray((raw as { simple?: unknown }).simple);
  const lights: RigLight[] = [];
  let selected: string | null = null;
  if (legacy) {
    const slots = (raw as unknown as { simple: Partial<RigLight>[] }).simple;
    for (let slot = 0; slot < 3; slot++) {
      const v = slots[slot];
      if (!v || typeof v !== "object" || v.enabled !== true) continue;
      const parsed = light(v, headlight(slot, slot === 0 ? primary : undefined));
      lights.push({ ...parsed, id: `light-${lights.length}`, type: "directional", shadows: false, followCamera: true });
      if (v.id === raw.selected) selected = lights[lights.length - 1].id;
    }
  } else if (Array.isArray(raw.lights)) {
    raw.lights.filter(l => l && typeof l === "object").slice(0, MAX_LIGHTS).forEach((l, i) => {
      const parsed = { ...light(l, newRigLight(`light-${i}`)), id: `light-${i}` } as RigLight;
      // (a light that does not follow the camera has no such key: the default must not bring it back)
      if (parsed.type === "directional") { if (l.followCamera === true) parsed.followCamera = true; else delete parsed.followCamera; }
      lights.push(parsed);
      if (l.id === raw.selected) selected = parsed.id;
    });
  }
  return { lights, shadow: parseShadowQuality(raw.shadow), marker: raw.marker === true, selected: selected ?? lights[0]?.id ?? null };
}
export function removeRigLight(rig: LightingRig, id: string): void {
  rig.lights = rig.lights.filter(l => l.id !== id);
  if (rig.selected === id) rig.selected = rig.lights[0]?.id ?? null;
}
/** The direction a directional light shines from, in the world (the camera's turn is applied to the ones that follow it). */
export function worldDirection(light: RigLight, camera?: THREE.Quaternion): THREE.Vector3 {
  return lightDirection(light.azimuth, light.elevation, light.followCamera ? camera : undefined);
}
export function lightDirection(azimuth: number, elevation: number, camera?: THREE.Quaternion): THREE.Vector3 {
  const az = azimuth * Math.PI / 180, el = elevation * Math.PI / 180;
  const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  return camera ? dir.applyQuaternion(camera) : dir;
}
export function spotLightRotation(light: RigLight): THREE.Quaternion {
  const emitted = lightDirection(light.azimuth, light.elevation).negate();
  if (light.rotation) {
    const rotation = new THREE.Quaternion().fromArray(light.rotation).normalize();
    if (new THREE.Vector3(0, 0, 1).applyQuaternion(rotation).dot(emitted) > .999999) return rotation;
  }
  return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), emitted);
}
/** Rotate in preview space, allowing the direction to pass over either pole. */
export function rotateLightDirection(azimuth: number, elevation: number, yaw: number, pitch: number): [number, number] {
  const radians = Math.PI / 180;
  const direction = lightDirection(azimuth, elevation)
    .applyAxisAngle(new THREE.Vector3(1, 0, 0), -pitch * radians)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw * radians).normalize();
  const az = Math.hypot(direction.x, direction.z) < 1e-10 ? azimuth : Math.atan2(direction.x, direction.z) / radians;
  return [(az % 360 + 360) % 360, Math.asin(Math.max(-1, Math.min(1, direction.y))) / radians];
}
export function lightColor(color: string, intensity: number): THREE.Vector3 {
  return new THREE.Vector3(...[1, 3, 5].map(i => Math.pow(parseInt(color.slice(i, i + 2), 16) / 255, 2.2) * intensity) as [
    number,
    number,
    number
  ]);
}
