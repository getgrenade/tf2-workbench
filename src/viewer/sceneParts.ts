/**
 * Parts of a scene that are saved and loaded on their own: the lights (`name.l.json`) and the post-processing effects (`name.p.json`).
 * The suffix is what tells them apart from scenes (`name.json`) in the file dialogs, and a part carries a `kind` so that a file picked
 * for the wrong thing is told so instead of being misread. This file has no imports (but types) so that it can be tested alone.
 */
import type { LightState, PointLightState } from "./viewer";
import { isAppFile } from "../appFile";

export type ScenePart = "lights" | "post";

export const PART_SUFFIX: Record<ScenePart, string> = { lights: ".l.json", post: ".p.json" };
export const PART_LABEL: Record<ScenePart, string> = { lights: "lights", post: "post-processing" };

/** The dialog filter that shows only the files of a part (a scene filter shows every .json). */
export const partFilter = (part: ScenePart) => [{ name: part === "lights" ? "TF2 Workbench lights" : "TF2 Workbench post-processing", extensions: [PART_SUFFIX[part].slice(1)] }];

const ENDINGS = /\.(l|p)\.json$|\.json$/i;

/** The name of a file without its folder and without .json, .l.json or .p.json. */
export const sceneBaseName = (path: string) => path.replace(/^.*[\\/]/, "").replace(ENDINGS, "");

/** `path` with the suffix of the part (whatever .json ending it had is replaced), so that a part is always found by its dialog filter. */
export const partPath = (path: string, part: ScenePart) => path.replace(ENDINGS, "") + PART_SUFFIX[part];

export interface LightsFile { app: "tf2-workbench"; kind: "lights"; version: 1; light: LightState; pointLight?: PointLightState }
export interface PostFile {
  app: "tf2-workbench";
  kind: "post";
  version: 1;
  /** The effects of each kind, as many as there were (the same fields as a scene's). */
  shadows?: unknown[];
  fogs?: unknown[];
  rimLights?: unknown[];
  aos?: unknown[];
  look?: Record<string, unknown>;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const HEX = /^#[0-9a-f]{6}$/i;

function readPart(text: string, part: ScenePart): Record<string, unknown> {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error(`not a ${PART_LABEL[part]} file (invalid JSON)`); }
  if (!isObject(raw) || !isAppFile(raw.app)) throw new Error("not a TF2 Workbench file");
  if (raw.kind !== part) {
    throw new Error(raw.kind === "lights" || raw.kind === "post" ? `this is a ${PART_LABEL[raw.kind]} file, not a ${PART_LABEL[part]} file` : `this is a scene, not a ${PART_LABEL[part]} file`);
  }
  if (raw.version !== 1) throw new Error(`version ${String(raw.version)} is not supported`);
  return raw;
}

/** The lights of a lights file, with what is missing or of the wrong type put right. */
export function parseLightsFile(text: string): LightsFile {
  const raw = readPart(text, "lights");
  const l = raw.light;
  if (!isObject(l)) throw new Error("the file has no lights");
  const p = raw.pointLight;
  const light: LightState = {
    ...(isObject(l.rig) ? { rig: l.rig as unknown as LightState["rig"] } : {}),
    azimuth: isNum(l.azimuth) ? l.azimuth : 0,
    elevation: isNum(l.elevation) ? l.elevation : 20,
    intensity: isNum(l.intensity) ? l.intensity : 1,
    color: typeof l.color === "string" && HEX.test(l.color) ? l.color : "#ffffff",
    ambient: isNum(l.ambient) ? l.ambient : 0.3,
    ambientColor: typeof l.ambientColor === "string" && HEX.test(l.ambientColor) ? l.ambientColor : "#ffffff",
    followCamera: l.followCamera !== false,
  };
  return { app: "tf2-workbench", kind: "lights", version: 1, light, ...(isObject(p) && typeof p.enabled === "boolean" ? { pointLight: p as unknown as PointLightState } : {}) };
}

/** The effects of a post-processing file (each is checked when it is turned into an effect of the list). */
export function parsePostFile(text: string): PostFile {
  const raw = readPart(text, "post");
  const list = (v: unknown) => (Array.isArray(v) ? v : undefined);
  return { app: "tf2-workbench", kind: "post", version: 1, shadows: list(raw.shadows), fogs: list(raw.fogs), rimLights: list(raw.rimLights), aos: list(raw.aos), look: isObject(raw.look) ? raw.look : undefined };
}
