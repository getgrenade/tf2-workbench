import type { LightState } from "./viewer";
import { parseLightingRig } from "./lighting";
import { isLightSetupKind } from "../appFile";

export interface LightSetup {
  kind: "tf2-workbench-light-setup";
  version: 1;
  favorite: boolean;
  light: LightState;
}

/** Explicitly whitelist lighting data: never serialize the scene or viewer. */
export function captureLightSetup(value: LightState, favorite = false): LightSetup {
  const rig = parseLightingRig(value.rig, value), primary = rig.lights.find(l => l.type === "directional") ?? { azimuth: value.azimuth, elevation: value.elevation, intensity: value.intensity, color: value.color };
  rig.marker = false;
  return {
    kind: "tf2-workbench-light-setup", version: 1, favorite,
    light: {
      azimuth: primary.azimuth, elevation: primary.elevation, intensity: primary.intensity,
      color: primary.color, ambient: value.ambient, ambientColor: value.ambientColor,
      followCamera: true, rig,
    },
  };
}

export function parseLightSetup(contents: string): LightSetup {
  const raw = JSON.parse(contents);
  if (!raw || !isLightSetupKind(raw.kind) || raw.version !== 1 || !raw.light
      || typeof raw.light !== "object" || !raw.light.rig || typeof raw.light.rig !== "object"
      || !Number.isFinite(raw.light.ambient) || raw.light.ambient < 0 || raw.light.ambient > 1
      || typeof raw.light.ambientColor !== "string" || !/^#[\da-f]{6}$/i.test(raw.light.ambientColor)) {
    throw new Error("Not a supported lighting setup");
  }
  return captureLightSetup(raw.light, raw.favorite === true);
}

/** Replaces the entire rig; each application gets independent arrays and objects. */
export function lightSetupState(setup: LightSetup): LightState {
  return structuredClone(setup.light);
}
