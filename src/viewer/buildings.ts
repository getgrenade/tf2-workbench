/**
 * The engineer's buildings as scene objects. A building is a character whose "class" is a model under models/buildables: its
 * `cls` is the model's path below `models/` (`buildables/sentry2`), where a player class is a bare name (`soldier`).
 *
 * The game swaps the model of a building as it is built and upgraded (tf_obj_dispenser.cpp, tf_obj_sentrygun.cpp,
 * tf_obj_teleporter.cpp): the finished building of each level has one model, and the one that is being built or upgraded to
 * that level another (`GetFinishedModel` / `GetBuildingModel`).
 */

export type BuildingKind = "dispenser" | "sentry" | "teleporter";
/** Finished: the building at rest. Building: the model the game shows while it is built or upgraded to the level. */
export type BuildingStage = "finished" | "building";

/** A teleporter is an entrance or an exit: the same model, other effects (and the direction arrow). */
export type TeleporterMode = "entrance" | "exit";

export interface BuildingInfo {
  kind: BuildingKind;
  level: number;
  stage: BuildingStage;
  /** Teleporters only. */
  mode: TeleporterMode;
}

interface Level {
  finished: string;
  building: string;
}

export const BUILDINGS: Record<BuildingKind, { label: string; levels: Level[] }> = {
  dispenser: {
    label: "Dispenser",
    levels: [
      { finished: "buildables/dispenser_light", building: "buildables/dispenser" },
      { finished: "buildables/dispenser_lvl2_light", building: "buildables/dispenser_lvl2" },
      { finished: "buildables/dispenser_lvl3_light", building: "buildables/dispenser_lvl3" },
    ],
  },
  sentry: {
    label: "Sentry",
    levels: [
      { finished: "buildables/sentry1", building: "buildables/sentry1_heavy" },
      { finished: "buildables/sentry2", building: "buildables/sentry2_heavy" },
      { finished: "buildables/sentry3", building: "buildables/sentry3_heavy" },
    ],
  },
  // one model for the three levels (the level changes the effects): the level and the mode ride in the `cls` after a #
  teleporter: {
    label: "Teleporter",
    levels: Array.from({ length: 3 }, () => ({ finished: "buildables/teleporter_light", building: "buildables/teleporter" })),
  },
};

/** The `cls` of a building at a level and stage. */
export function buildingCls(kind: BuildingKind, level: number, stage: BuildingStage = "finished", mode: TeleporterMode = "entrance"): string {
  const levels = BUILDINGS[kind].levels;
  const n = Math.min(Math.max(level, 1), levels.length);
  const l = levels[n - 1];
  const model = stage === "building" ? l.building : l.finished;
  return kind === "teleporter" ? `${model}#${mode}${n}` : model;
}

/** A `cls` holding a path is a building (or another prop); a bare name is a player class. */
export const isBuildingCls = (cls: string) => cls.includes("/");

/** The model path of an entity's `cls`: a class under models/player, a building at its own path. */
export const classPath = (cls: string) => (isBuildingCls(cls) ? `models/${cls.split("#")[0]}.mdl` : `models/player/${cls}.mdl`);

/** What a `cls` is as a building; null for a class or a model that is none of the table's. */
export function buildingOf(cls: string): BuildingInfo | null {
  const [model, extra = ""] = cls.split("#");
  const tele = /^(entrance|exit)([123])$/.exec(extra);
  for (const kind of Object.keys(BUILDINGS) as BuildingKind[]) {
    const levels = BUILDINGS[kind].levels;
    for (const [i, l] of levels.entries()) {
      const stage = l.finished === model ? "finished" : l.building === model ? "building" : null;
      if (!stage) continue;
      if (kind === "teleporter") return { kind, level: tele ? Number(tele[2]) : 1, stage, mode: tele ? (tele[1] as TeleporterMode) : "entrance" };
      return { kind, level: i + 1, stage, mode: "entrance" };
    }
  }
  return null;
}

/** The sequence a building starts on: what it plays when it is running, or its build / upgrade animation. */
export function defaultBuildingSequence(cls: string): string {
  const b = buildingOf(cls);
  if (!b) return "";
  // always a sequence of the model, never the bind pose: the effects are anchored on the posed (Source space) skeleton
  if (b.stage === "building") return b.kind === "sentry" ? (b.level === 1 ? "dummy" : "upgrade") : b.kind === "dispenser" && b.level > 1 ? "upgrade" : "build";
  return b.kind === "sentry" ? "idle_off" : b.kind === "teleporter" ? "running" : "ref";
}

export function buildingLabel(info: BuildingInfo): string {
  const { label, levels } = BUILDINGS[info.kind];
  const name = info.kind === "teleporter" ? `${label} ${info.mode === "exit" ? "exit" : "entrance"}` : label;
  return levels.length > 1 ? `${name} L${info.level}` : name;
}
