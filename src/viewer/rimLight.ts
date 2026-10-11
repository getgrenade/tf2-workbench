export interface RimLightState {
  enabled: boolean;
  color: string;
  strength: number;
  width: number;
  direction: number;
  softness: number;
  allAround: boolean;
  painted: boolean;
  cutoff: number;
  edgeSoftness: number;
}
export const DEFAULT_RIM_LIGHT: RimLightState = {
  enabled: false, color: "#ffffff", strength: 3, width: .3,
  direction: 0, softness: .65, allAround: false,
  painted: false, cutoff: .25, edgeSoftness: 0,
};
export function parseRimLight(raw: unknown): RimLightState {
  const value = raw as Partial<RimLightState> | null;
  const n = (key: "strength" | "width" | "direction" | "softness" | "cutoff" | "edgeSoftness", min: number, max: number) => {
    const v = value?.[key]; return typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : DEFAULT_RIM_LIGHT[key];
  };
  return {
    enabled: value?.enabled === true,
    color: typeof value?.color === "string" && /^#[\da-f]{6}$/i.test(value.color) ? value.color : DEFAULT_RIM_LIGHT.color,
    strength: n("strength", 0, 8), width: n("width", .02, 1), direction: n("direction", -180, 180), softness: n("softness", 0, 1), allAround: value?.allAround === true,
    painted: value?.painted === true, cutoff: n("cutoff", .01, .99), edgeSoftness: n("edgeSoftness", 0, .5),
  };
}

/** How many rim lights can shine at once (the shader sums them). */
export const MAX_RIM_LIGHTS = 4;

/** Additive, camera-relative rim shading, one term for each of the rim lights that are on; alpha/depth and particle materials are untouched. */
export const rimLightGLSL = /* glsl */ `
uniform int uStudioRimCount;
uniform vec3 uStudioRimColor[${MAX_RIM_LIGHTS}];
uniform float uStudioRimStrength[${MAX_RIM_LIGHTS}];
uniform float uStudioRimPower[${MAX_RIM_LIGHTS}];
uniform vec2 uStudioRimDirection[${MAX_RIM_LIGHTS}];
uniform float uStudioRimSoftness[${MAX_RIM_LIGHTS}];
uniform float uStudioRimAllAround[${MAX_RIM_LIGHTS}];
uniform float uStudioRimPainted[${MAX_RIM_LIGHTS}];
uniform vec2 uStudioRimLine[${MAX_RIM_LIGHTS}]; // cutoff, edge softness
vec3 studioRimLight(vec3 normal, vec3 world) {
  if (uStudioRimCount == 0) return vec3(0.0);
  vec3 N = normalize(normal);
  vec3 V = isOrthographic ? normalize(vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2])) : normalize(cameraPosition - world);
  float base = clamp(1.0 - abs(dot(N, V)), 0.0, 1.0);
  vec3 cameraNormal = normalize(mat3(viewMatrix) * N);
  vec3 total = vec3(0.0);
  for (int i = 0; i < ${MAX_RIM_LIGHTS}; i++) {
    if (i >= uStudioRimCount) break;
    float rim = pow(base, uStudioRimPower[i]);
    if (uStudioRimAllAround[i] < 0.5) {
      float facing = max(dot(cameraNormal.xy, uStudioRimDirection[i]), 0.0);
      rim *= pow(facing, mix(8.0, .25, uStudioRimSoftness[i]));
    }
    if (uStudioRimPainted[i] > 0.5) {
      // Threshold the complete rim, including direction, so its interior has
      // uniform brightness. A pixel-sized transition prevents jagged edges.
      float edge = max(fwidth(rim) * .75, .00001) + uStudioRimLine[i].y;
      rim = smoothstep(uStudioRimLine[i].x - edge, uStudioRimLine[i].x + edge, rim);
    }
    total += uStudioRimColor[i] * (rim * uStudioRimStrength[i]);
  }
  return total;
}
`;
