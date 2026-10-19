import type { LightState, PointLightState } from "./viewer";
import type { ShadowParams } from "./shadowMath";
import type { FogState } from "./fog";
import { parseSky, type SkyState } from "./skyState";
import { parseReflection, type ReflectionState } from "./reflectionState";
import { parseGround, type GroundState } from "./groundPlane";
import type { AoState } from "./aoMath";
import { parseRimLight, type RimLightState } from "./rimLight";
import { parseUnusualSettings, type UnusualSettings } from "./particles/assets";
import { parseWeaponSnapshot, type WeaponParticleSnapshot } from "./particles/weaponSnapshot";
import { parseConditions, type Conditions } from "./conditions";
import { parseCameras, type CameraCollection } from "./cameraData";
import { readFx, type BuildingFx } from "./buildingFx";
import { parseGroups, type HierarchyGroup } from "./hierarchyTree";
import { isAppFile } from "../appFile";

/** One character of a saved scene. Items, paints and weapons are stored by their schema id. */
export interface SceneEntity {
  /** Model name under models/player (`soldier`, `demo`, ...). */
  cls: string;
  /** Team skin family: 0 RED, 1 BLU. */
  team: number;
  /** The name given in the hierarchy (absent: the class). */
  name?: string;
  /** The hierarchy group the character is in. */
  group?: string;
  /** Hidden by its eye in the hierarchy. */
  hidden?: boolean;
  placement: { x: number; y: number; z: number; yaw: number; /** Tip of a character that is not upright (radians). */ pitch?: number; roll?: number; scale?: [number, number, number]; /** Placed by hand (the spacing slider leaves it alone). */ placed: boolean };
  loadout: { item: number; paint: number | null; style: number; /** Hidden with its eye: in the loadout, not worn. */ hidden?: boolean }[];
  /** The cosmetic the paint palette edits. */
  activeItem: number | null;
  /** The held weapon or taunt. */
  held: number | null;
  /** Flex controller values by name. */
  flex: Record<string, number>;
  anim: { sequence: string | null; encoded: number[] };
  /** An edited or held custom pose (bones by name, local transforms). */
  pose?: { bones: string[]; pos: number[]; quat: number[]; scale?: number[]; editing?: boolean };
  unusuals?: UnusualSettings;
  weaponParticles?: WeaponParticleSnapshot;
  playback: { time: number; speed: number; loopAll: boolean; playing: boolean };
  /** Only the cosmetics and the weapon are shown, not the character (an item opened for inspection). */
  inspectOnly?: boolean;
  /** Body groups set by hand, by body part name: which of its models shows. */
  bodygroups?: Record<string, number>;
  /** The level of detail the character is drawn at (absent: the full model). */
  lod?: number;
  /** Player conditions switched on (Ubercharge, Jarate, ...); see conditions.ts. */
  conditions?: Conditions;
  /** Drawn in plain 50% grey (the GRAY switch of the properties). */
  gray?: boolean;
  /** Authored visibility group ids; scenes without bodyMaskVersion use the older anatomical regions. */
  bodyShown?: string[];
  bodyMaskVersion?: 1;
  /** False when the gradient fog does not cover this character. */
  fogged?: boolean;
  /** The eyes look at the camera. */
  eyesFollowCamera?: boolean;
  /** Triangles hidden by hand with the view tools: bit-packed base64 per mesh. */
  bodyTris?: Record<string, string>;
  /** Buildings only: what the building is doing (damage, metal, firing ...); see buildingFx.ts. */
  building?: BuildingFx;
}

/** A whole scene: the characters and everything about the view. Saved as JSON. */
export interface SceneFile {
  app: "tf2-workbench";
  version: 1;
  spacing: number;
  fov: number;
  camera: { position: [number, number, number]; target: [number, number, number] };
  cameras?: CameraCollection;
  viewportProjection?: { orthographic: boolean; halfHeight: number; zoom: number };
  light: LightState;
  pointLight: PointLightState;
  shadow: ShadowParams;
  /** The gradient fog over the picture (checked with parseFog when it is applied; scenes saved before it existed have none). */
  fog?: FogState;
  /** The ambient occlusion over the picture (checked with parseAo when it is applied). */
  ao?: AoState;
  rimLight?: RimLightState;
  /** The post-processing effects, each as many times as the scene has them (the single fields above hold the first of each, for older versions). */
  shadows?: ShadowParams[];
  fogs?: FogState[];
  rimLights?: RimLightState[];
  /** The occlusions, as many as the scene has (older files have the single `ao`, and only when it was on). */
  aos?: AoState[];
  /** The look effects (vignette, chromatic aberration, grain, colour grading, bloom), by name; read with `parseLook`. */
  look?: Record<string, unknown>;
  /** The skybox behind the scene. */
  sky?: SkyState;
  /** The cubemap the shiny materials reflect. */
  reflection?: ReflectionState;
  /** The plane at the floor. */
  ground?: GroundState;
  /** The colour behind everything when there is no skybox ("#rrggbb"; the usual grey when missing). */
  background?: string;
  wireframe: boolean;
  jiggle: boolean;
  /** Index of the selected character. */
  selected: number;
  /** The groups of the characters hierarchy. */
  groups?: HierarchyGroup[];
  entities: SceneEntity[];
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isVec3 = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every(isNum);

function parseScenePose(p: any): SceneEntity["pose"] {
  if (!p || !Array.isArray(p.bones) || p.bones.length === 0 || !p.bones.every((b: unknown) => typeof b === "string")) return undefined;
  const n = p.bones.length;
  if (!Array.isArray(p.pos) || p.pos.length !== n * 3 || !p.pos.every(isNum)) return undefined;
  if (!Array.isArray(p.quat) || p.quat.length !== n * 4 || !p.quat.every(isNum)) return undefined;
  // Older scene files only captured actively edited poses.
  const scale = Array.isArray(p.scale) && p.scale.length === n * 3 && p.scale.every((v: unknown) => isNum(v) && v >= .009999 && v <= 100) ? p.scale : undefined;
  return { bones: p.bones, pos: p.pos, quat: p.quat, ...(scale ? { scale } : {}), editing: p.editing !== false };
}

/**
 * Parses and checks the text of a scene file. Throws with a short reason when it is not a scene of this version; fields that are
 * missing or of the wrong type in an otherwise valid scene are replaced by neutral defaults where that is safe.
 */
export function parseScene(text: string): SceneFile {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("not a scene file (invalid JSON)");
  }
  if (!raw || !isAppFile(raw.app)) throw new Error("not a TF2 Workbench scene");
  if (raw.kind === "lights" || raw.kind === "post") throw new Error(`this is a ${raw.kind === "lights" ? "lights" : "post-processing"} file, not a scene (load it from Load scene > ${raw.kind === "lights" ? "Lights" : "Post-processing"})`);
  if (raw.version !== 1) throw new Error(`scene version ${String(raw.version)} is not supported`);
  if (!Array.isArray(raw.entities) || raw.entities.length === 0) throw new Error("the scene has no characters");
  if (!raw.camera || !isVec3(raw.camera.position) || !isVec3(raw.camera.target)) throw new Error("the scene has no camera");
  const entities: SceneEntity[] = raw.entities.map((e: any, i: number) => {
    if (!e || typeof e.cls !== "string") throw new Error(`character ${i + 1} has no class`);
    const p = e.placement ?? {};
    return {
      cls: e.cls,
      team: e.team === 1 ? 1 : 0,
      name: typeof e.name === "string" && e.name.trim() ? e.name.trim().slice(0, 80) : undefined,
      group: typeof e.group === "string" ? e.group : undefined,
      hidden: e.hidden === true ? true : undefined,
      placement: { x: isNum(p.x) ? p.x : 0, y: isNum(p.y) ? p.y : 0, z: isNum(p.z) ? p.z : 0, yaw: isNum(p.yaw) ? p.yaw : 0, ...(isNum(p.pitch) && p.pitch !== 0 ? { pitch: p.pitch } : {}), ...(isNum(p.roll) && p.roll !== 0 ? { roll: p.roll } : {}), ...(isVec3(p.scale) && p.scale.every((v: number) => v >= .01 && v <= 100) ? { scale: p.scale } : {}), placed: p.placed === true },
      loadout: Array.isArray(e.loadout)
        ? e.loadout.filter((l: any) => l && isNum(l.item)).map((l: any) => ({ item: l.item, paint: isNum(l.paint) ? l.paint : null, style: isNum(l.style) ? l.style : 0 }))
        : [],
      activeItem: isNum(e.activeItem) ? e.activeItem : null,
      held: isNum(e.held) ? e.held : null,
      inspectOnly: e.inspectOnly === true ? true : undefined,
      bodyTris: e.bodyTris && typeof e.bodyTris === "object" ? Object.fromEntries(Object.entries(e.bodyTris).filter(([, v]) => typeof v === "string")) : undefined,
      fogged: e.fogged === false ? false : undefined,
      eyesFollowCamera: e.eyesFollowCamera === true ? true : undefined,
      building: e.building && typeof e.building === "object" ? readFx(e.building) : undefined,
      bodyShown: Array.isArray(e.bodyShown) ? e.bodyShown.filter((k: unknown) => typeof k === "string") : undefined,
      bodyMaskVersion: e.bodyMaskVersion === 1 ? 1 : undefined,
      conditions: e.conditions && typeof e.conditions === "object" ? parseConditions(e.conditions) : undefined,
      lod: isNum(e.lod) && e.lod >= 1 && e.lod <= 7 ? Math.floor(e.lod) : undefined,
      bodygroups: e.bodygroups && typeof e.bodygroups === "object" ? Object.fromEntries(Object.entries(e.bodygroups).filter(([, v]) => isNum(v))) : undefined,
      flex: e.flex && typeof e.flex === "object" ? Object.fromEntries(Object.entries(e.flex).filter(([, v]) => isNum(v))) : {},
      anim: { sequence: typeof e.anim?.sequence === "string" ? e.anim.sequence : null, encoded: Array.isArray(e.anim?.encoded) ? e.anim.encoded.filter(isNum) : [] },
      pose: parseScenePose(e.pose),
      unusuals: parseUnusualSettings(e.unusuals),
      weaponParticles: parseWeaponSnapshot(e.weaponParticles),
      playback: {
        time: isNum(e.playback?.time) ? e.playback.time : 0,
        speed: isNum(e.playback?.speed) ? e.playback.speed : 1,
        loopAll: e.playback?.loopAll !== false,
        playing: e.playback?.playing !== false,
      },
    };
  });
  return {
    app: "tf2-workbench",
    version: 1,
    spacing: isNum(raw.spacing) ? raw.spacing : 72,
    fov: isNum(raw.fov) ? raw.fov : 30,
    camera: raw.camera,
    cameras: parseCameras(raw.cameras),
    viewportProjection: raw.viewportProjection && isNum(raw.viewportProjection.halfHeight) && raw.viewportProjection.halfHeight > 0 && isNum(raw.viewportProjection.zoom) && raw.viewportProjection.zoom > 0 ? { orthographic: raw.viewportProjection.orthographic === true, halfHeight: raw.viewportProjection.halfHeight, zoom: raw.viewportProjection.zoom } : undefined,
    light: raw.light,
    pointLight: raw.pointLight,
    shadow: raw.shadow,
    fog: raw.fog,
    ao: raw.ao,
    rimLight: parseRimLight(raw.rimLight),
    shadows: Array.isArray(raw.shadows) ? raw.shadows : undefined,
    fogs: Array.isArray(raw.fogs) ? raw.fogs : undefined,
    rimLights: Array.isArray(raw.rimLights) ? raw.rimLights : undefined,
    aos: Array.isArray(raw.aos) ? raw.aos : undefined,
    look: raw.look && typeof raw.look === "object" && !Array.isArray(raw.look) ? raw.look : undefined,
    sky: parseSky(raw.sky),
    reflection: parseReflection(raw.reflection),
    ground: parseGround(raw.ground),
    background: typeof raw.background === "string" && /^#[0-9a-f]{6}$/i.test(raw.background) ? raw.background.toLowerCase() : undefined,
    wireframe: raw.wireframe === true,
    jiggle: raw.jiggle !== false,
    selected: isNum(raw.selected) ? Math.min(Math.max(Math.floor(raw.selected), 0), entities.length - 1) : 0,
    groups: parseGroups(raw.groups),
    entities,
  };
}
