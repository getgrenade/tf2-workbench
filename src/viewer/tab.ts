import { open, save } from "@tauri-apps/plugin-dialog";
import { createCompilerUi, type PreviewApplication } from "../compiler/compilerUi";
import { MODEL_EXTENSIONS } from "../compiler/importModel";
import { createPropPanel, PROP_DRAG_TYPE } from "../props/propPanel";
import { propLabel } from "../props/propList";
import { forgetThumbnail } from "../props/propThumbs";
import { decodeTga, encodeTga, iconProblem, ICON_SAFE_ROWS } from "../compiler/tga";
import { fadeAmount, maskIcon, type IconFade } from "../compiler/iconMask";
import { importSourceDir, readItemSession, readPropSession, saveItemIcon, buildItem, buildProp, loadTextureFrames, readSourceFile, revealFile, sourceSiblings, sourceStamp } from "../api";
import { parseTextureFrames } from "./sourceMaterials";
import { getWeaponProfile, importEffectZip, removeCustomEffect, type WeaponProfile, type UnusualEffectInfo } from "../api";
import { listSequences, loadMaterial, loadModel, loadSession, prepareWorkshopTaunt, readTextFile, saveSession, rewriteModelFile, writeAdjustedModel, writeBinaryFile, writeTextFile, type WorkshopTaunt } from "../api";
import { loadItemDb } from "./itemCatalog";
import { parseScene, type SceneEntity, type SceneFile } from "./scene";
import { deletePoseFile, openPosesFolder, readPoses, refreshWorkshop as refreshWorkshopCommand, savePoseFile, workshopStamp as workshopStampCommand } from "../api";
import { applyHandFile, parsePoseFile, poseForSkeleton, toHandFile, toPoseFile, type PoseData, type PoseFile } from "./poseRig";
import * as THREE from "three";
import { createItemsUi, type Equipped, type ItemsEls } from "./itemsUi";
import { unpackRgb } from "./proxies";
import { PlayController } from "./play";
import { createNavGizmo } from "./navGizmo";
import { createBrowserSort, createBrowserView, makeTile, setTileImage } from "./browserView";
import { createCameraUi } from "./cameraUi";
import { createSceneTabs } from "./sceneTabs";
import { gizmoKey } from "./gizmos";
import { createHierarchy, type HierarchyHooks, type OutlinerNode, type Pick } from "./hierarchy";
import { editHistory } from "./editHistory";
import type { PlacementHistory } from "./placementHistory";
import type { SceneCamera } from "./cameraData";
import { combine, createBoxSelect, type BoxHits, type BoxMode } from "./boxSelect";
import { createTransformFields } from "./transformFields";
import { openMenu } from "./popMenu";
import { recordVideo, type VideoOptions } from "./videoRecorder";
import { toggleVideoPanel } from "./videoUi";
import { createPostUi } from "./postEffects";
import { createSkyUi } from "./skyUi";
import { createReflectionUi } from "./reflectionUi";
import { CUBEMAP_MATERIAL, loadCubemapTexture } from "./reflection";
import { DEFAULT_REFLECTION, type ReflectionState } from "./reflectionState";
import { createOverlayPanel } from "./overlayPanel";
import { createGroundUi } from "./groundUi";
import { DEFAULT_GROUND, type GroundState } from "./groundPlane";
import { DEFAULT_SKY, loadSkyTexture, type SkyState } from "./skybox";
import { countOf, newPostId, POST_KINDS, statesOf, type PostItem, type PostKind } from "./postStack";
import { entityHidden, isInside, newGroupName, parseGroups, withDescendants, type HierarchyGroup } from "./hierarchyTree";
import { createBodyPicker } from "./bodyPicker";
import { createTexturePreview, type PreviewItem } from "./texturePreview";
import { alphaBounds, cropImages, openPaintChart } from "./paintChart";
import { defaultBodyGroupsFor } from "./bodyGroups";
import { purgeIcons } from "./itemIcons";
import { reloadItemDb } from "./itemCatalog";
import type { PoseHud } from "./poseHud";
import { createRigControls, type RigControls } from "../rig/rigControls";
import type { LimbId } from "./poseRig";
import { PLAY_ACTIONS, PLAY_DAMAGE_ACTIONS, PLAY_SLOTS, encodeParam, setsOf, type PlaySlot } from "./playLogic";
import { itemImageFor, itemModelFor, slotForClass, weaponCategory, itemSkinFor, itemUsableBy, parseAnimInfo, parseMaterial, parsePayload, tauntPropSequence, tauntSequence, weaponIdleSequences, type ClipData, type ItemInfo, type PaintInfo, type MaterialData, type ModelData } from "./payload";
import { createWeaponsUi, type WeaponsEls } from "./weaponsUi";
import { loadSettings, onSettingsChange, settings, updateSetting } from "../settingsStore";
import { accentHex } from "../theme";
import { zombieFamily, type Actor } from "./actor";
import { DISPENSER_MAX_METAL, defaultFx, type BuildingFx } from "./buildingFx";
import { BUILDINGS, buildingCls, buildingLabel, buildingOf, classPath, defaultBuildingSequence, isBuildingCls, type BuildingKind, type BuildingStage, type TeleporterMode } from "./buildings";
import { bakeClip, createAnimUi, newAnimState, type AnimEls, type AnimState } from "./animUi";
import { createFlexUi, flexGlobalsFor, type FlexEls } from "./flexUi";
import { DEFAULT_FOV_X, DEFAULT_POINT_LIGHT, Viewer, type CosmeticSpec, type LightState, type PointLightState } from "./viewer";
import { createLightingUi } from "./lightingUi";
import { defaultLightingRig, newRigLight, parseLightingRig, type RigLight } from "./lighting";
import { blankUnusuals, parseUnusualSettings, loadUnusualCatalog as fetchUnusualCatalog, customEffectZips, type UnusualSettings } from "./particles/assets";
import { DEFAULT_SHADOW, type ShadowParams } from "./shadowMath";
import { CONDITION_CLASS, CONDITION_KEYS, CONDITION_LABELS, anyCondition, parseConditions, uberMaterialPath, type ConditionKey } from "./conditions";
import { DEFAULT_FOG, parseFog, type FogState } from "./fog";
import { DEFAULT_AO, parseAo, type AoState } from "./aoMath";
import { hotkeyMatches, redoMatches } from "../hotkeys";
import { buildPsd } from "./layerExport";
import { PART_LABEL, PART_SUFFIX, parseLightsFile, parsePostFile, partFilter, partPath, type ScenePart } from "./sceneParts";
import { LOOK_KINDS, defaultLook, parseLook, type LookKind, type LookStates } from "./look";
import { createLookEditors } from "./lookUi";
import { DEFAULT_RIM_LIGHT, parseRimLight, type RimLightState } from "./rimLight";

/** Label, model file name under models/player, and the class name items_game.txt uses. */
const CLASSES: [label: string, mdl: string, gameClass: string][] = [
  ["Soldier", "soldier", "soldier"],
  ["Scout", "scout", "scout"],
  ["Sniper", "sniper", "sniper"],
  ["Demoman", "demo", "demoman"],
  ["Medic", "medic", "medic"],
  ["Heavy", "heavy", "heavy"],
  ["Pyro", "pyro", "pyro"],
  ["Spy", "spy", "spy"],
  ["Engineer", "engineer", "engineer"],
];

interface Els {
  wrap: HTMLElement;
  /** Container the class icon buttons are built into. */
  classes: HTMLElement;
  wire: HTMLInputElement;
  jiggle: HTMLInputElement;
  fov: HTMLInputElement;
  info: HTMLElement;
  azimuth: HTMLInputElement;
  elevation: HTMLInputElement;
  intensity: HTMLInputElement;
  lightColor: HTMLInputElement;
  ambient: HTMLInputElement;
  ambientColor: HTMLInputElement;
  follow: HTMLInputElement;
  gizmo: HTMLInputElement;
  ao: {
    on: HTMLInputElement;
    strength: HTMLInputElement;
    radius: HTMLInputElement;
    power: HTMLInputElement;
    reset: HTMLButtonElement;
  };
  rimLight: {
    on: HTMLInputElement; allAround: HTMLInputElement; color: HTMLInputElement;
    strength: HTMLInputElement; width: HTMLInputElement; direction: HTMLInputElement; softness: HTMLInputElement; reset: HTMLButtonElement;
    painted: HTMLInputElement; cutoff: HTMLInputElement; edgeSoftness: HTMLInputElement;
  };
  fog: {
    on: HTMLInputElement;
    color: HTMLInputElement;
    top: HTMLInputElement;
    bottom: HTMLInputElement;
    middle: HTMLInputElement;
    softness: HTMLInputElement;
    view: HTMLInputElement;
    reset: HTMLButtonElement;
  };
  shadow: {
    on: HTMLInputElement;
    azimuth: HTMLInputElement;
    length: HTMLInputElement;
    blur: HTMLInputElement;
    opacity: HTMLInputElement;
    reset: HTMLButtonElement;
  };
  lightReset: HTMLButtonElement;
  point: {
    on: HTMLInputElement;
    azimuth: HTMLInputElement;
    elevation: HTMLInputElement;
    distance: HTMLInputElement;
    range: HTMLInputElement;
    falloff: HTMLInputElement;
    intensity: HTMLInputElement;
    color: HTMLInputElement;
    marker: HTMLInputElement;
    reset: HTMLButtonElement;
  };
  focusFace: HTMLButtonElement;
  focusBody: HTMLButtonElement;
  focusAll: HTMLButtonElement;
  unusual: { hat: HTMLSelectElement; taunt: HTMLSelectElement; hatClear: HTMLButtonElement; tauntClear: HTMLButtonElement; restart: HTMLButtonElement; status: HTMLElement; search: HTMLInputElement; catalog: HTMLElement; bar: HTMLElement; loadZip: HTMLButtonElement; custom: HTMLElement };
  anim: AnimEls;
  flex: FlexEls;
  /** RED / BLU team buttons. */
  teams: HTMLButtonElement[];
  pose: {
    /** The controls over the 3D view (toolbar, body map, hand bar). */
    hud: PoseHud;
    /** The docked Pose tab: the pose library. */
    status: HTMLElement;
    name: HTMLInputElement;
    save: HTMLButtonElement;
    saveHand: HTMLButtonElement;
    filter: HTMLElement;
    folder: HTMLButtonElement;
    library: HTMLElement;
    search: HTMLInputElement;
    foot: HTMLElement;
    count: HTMLElement;
  };
  capture: {
    shot: HTMLButtonElement;
    psd: HTMLButtonElement;
    video: HTMLButtonElement;
    status: HTMLElement;
    menu: HTMLButtonElement;
    paintChart: HTMLButtonElement;
  };
  entities: {
    list: HTMLElement;
    add: HTMLButtonElement;
    buildPanel: HTMLElement;
    spacing: HTMLInputElement;
  };
  items: ItemsEls;
  weapons: WeaponsEls;
  isIndexed: () => boolean;
  /** Brings a panel of the docks to the front (showing it when it was hidden). */
  reveal: (id: string) => void;
}

// hlmv defaults: white directional light from the front, 0.3 ambient, light fixed to the camera.
const DEFAULT_LIGHT = { azimuth: 0, elevation: 0, intensity: 1, color: "#ffffff", ambient: 0.3, ambientColor: "#ffffff", followCamera: true };

/** What a new character plays, and how, when it is not simply the class default (a copy, or a restored scene). */
interface AnimPreset {
  seq?: number;
  seqName?: string;
  encoded?: number[];
  /** The playback clock to start from, read when the animation is loaded. */
  playback?: () => { time: number; speed: number; loopAll: boolean; playing: boolean } | null;
  /** An edited pose (bones by name) to put on the character once its model and animation are loaded (a restored scene). */
  pose?: { bones: string[]; pos: Float32Array; quat: Float32Array; scale?: Float32Array; editing?: boolean };
}

/** One character in the scene and everything the panels show for it. */
interface Entity {
  unusuals: UnusualSettings;
  unusualError: string;
  /** A worn item sets the player skin override (a Voodoo-Cursed soul): the class model is drawn in its zombie skin family. */
  zombie?: boolean;
  id: number;
  actor: Actor;
  /** The name given in the hierarchy (absent: the class). */
  name?: string;
  /** The hierarchy group it is in. */
  group?: string;
  /** Hidden by its eye in the hierarchy. */
  hidden: boolean;
  /** Model name under models/player ("soldier"). */
  cls: string;
  /** Team skin family: 0 RED, 1 BLU. */
  team: number;
  /** The cosmetics browser's state (the full loadout, including items the class cannot wear right now). */
  items: { loadout: Equipped[]; activeId: number | null };
  /** The part of the loadout last applied to the character (what a team change reapplies). */
  applied: Equipped[];
  /** The picked weapon or taunt, as picked. */
  held: ItemInfo | null;
  anim: AnimState;
  /** Buildings only: what the building is doing (see buildingFx.ts). */
  fx: BuildingFx;
  /** Flex controller values by name. */
  flex: Map<string, number>;
  /** Body groups set by hand (lowercase part name -> model index); they win over what the cosmetics set. */
  bodyManual: Map<string, number>;
  /** The body groups the worn cosmetics ask for. */
  bodyItems: Record<string, number>;
  loadoutToken: number;
  showToken: number;
  /** The level of detail the character and its cosmetics are drawn at (0 is the full model). */
  lod: number;
}

/** The "Viewer" tab: class picker, light controls and the 3D view. */
export function createViewTab(els: Els) {
  let viewer: Viewer | null = null;
  let pendingLight: LightState = { ...DEFAULT_LIGHT, rig: defaultLightingRig(DEFAULT_LIGHT) };
  let lightingUi: ReturnType<typeof createLightingUi> | null = null;
  // the skybox behind the scene (its pictures are made when it is picked and kept while it is shown)
  let sky: SkyState = { ...DEFAULT_SKY };
  let skyUi: ReturnType<typeof createSkyUi> | null = null;
  let skyShown: { name: string; texture: import("three").CubeTexture } | null = null;
  let skyToken = 0;
  // the cubemap the shiny materials reflect (null: their own)
  let reflection: ReflectionState = { ...DEFAULT_REFLECTION };
  let reflectionUi: ReturnType<typeof createReflectionUi> | null = null;
  let reflectionToken = 0;
  // the plane at the floor
  const DEFAULT_BACKGROUND = "#404040";
  const bgInput = document.getElementById("bgColor") as HTMLInputElement;
  /** Sets the colour behind the scene (it shows when there is no skybox). */
  function setBackgroundColor(hex: string) {
    bgInput.value = hex;
    viewer?.setBackdropColor(hex);
  }
  bgInput.oninput = () => { viewer?.setBackdropColor(bgInput.value); };
  bgInput.ondblclick = () => { setBackgroundColor(DEFAULT_BACKGROUND); };
  let ground: GroundState = { ...DEFAULT_GROUND };
  let groundUi: ReturnType<typeof createGroundUi> | null = null;
  function setGroundState(next: GroundState) {
    ground = { ...next };
    groundUi?.sync();
    viewer?.setGround(ground);
  }
  /** Shows the sky of `sky` in the view. */
  async function applySky() {
    const v = viewer;
    if (!v) return;
    const token = ++skyToken;
    if (!sky.name) {
      v.setSky(null);
      skyShown?.texture.dispose();
      skyShown = null;
      return;
    }
    let texture = skyShown?.name === sky.name ? skyShown.texture : null;
    if (!texture) {
      texture = await loadSkyTexture(sky.name);
      if (token !== skyToken) { texture.dispose(); return; }
    }
    v.setSky(texture, sky.rotation, sky.brightness);
    if (skyShown && skyShown.texture !== texture) skyShown.texture.dispose();
    skyShown = { name: sky.name, texture };
  }
  /** Shows the reflections of `reflection` in the view. */
  async function applyReflection() {
    const v = viewer;
    if (!v) return;
    const token = ++reflectionToken;
    if (!reflection.cubemap) { v.setWorldCube(null); return; }
    const texture = await loadCubemapTexture(v.mats, reflection.cubemap);
    if (token !== reflectionToken) return;
    v.setWorldCube(texture, reflection.brightness);
  }
  /** Makes `next` the reflections of the scene (a scene was opened or started, or the panel changed it). */
  async function setReflectionState(next: ReflectionState) {
    reflection = { ...next };
    reflectionUi?.sync();
    await applyReflection();
  }
  /** Makes `next` the sky of the scene (a scene was opened or started, or the panel changed it). */
  async function setSkyState(next: SkyState) {
    sky = { ...next };
    skyUi?.sync();
    await applySky();
  }
  // Caches: switching class/skin is instant after the first load.
  const models = new Map<string, ModelData>();
  const materials = new Map<string, MaterialData | null>();
  const materialErrors = new Map<string, string>();
  const importedTaunts = new Map<string, Promise<WorkshopTaunt>>();

  function prepareTaunt(item: ItemInfo, cls: string) {
    const key = `${item.id}/${cls}`;
    let pending = importedTaunts.get(key);
    if (!pending) {
      pending = prepareWorkshopTaunt(item.id, cls).catch((err) => { importedTaunts.delete(key); throw err; });
      importedTaunts.set(key, pending);
    }
    return pending;
  }

  /** The selected character: the panels (class, team, cosmetics, weapons, animation, flex) edit this one. */
  let selected: Entity | null = null;
  // --- the compiler: the item under construction, shown on the selected character ---
  let compilerPreview: PreviewApplication | null = null;
  let compilerTarget: Entity | null = null;
  let compilerOn = false;
  /** The bone of the item being built that is drawn with its axes and constraints (see the jiggle bone editor). */
  let boneGizmoSpec: { bone: string; turn: () => import("../compiler/boneAxes").BoneTurn; onTurn: (turn: import("../compiler/boneAxes").BoneTurn) => void; onEnd: () => void } | null = null;
  let boneHelperSpec: { bone: string; setup: import("../compiler/jiggleBones").JiggleSetup | null } | null = null;
  /** The scene tab that is the backpack icon studio (the compiler's item alone, framed square), while it is the open one. */
  let iconTab: SceneTab | null = null;
  /** The scene the studio was opened from: it comes back when the studio closes. */
  let iconOrigin: SceneTab | null = null;
  let iconSaved = { grid: false, indicators: true };
  /** The vertical field of view icons are taken with (degrees). */
  const ICON_FOV = 22;
  /** The prop being compiled, shown in the scene (the compiler's Prop side). */
  let propPreview: Entity | null = null;
  const PROP_PREVIEW_CLS = "__workbench__/prop_preview";
  /** Shows the prop of the compiler in the scene as a prop of its own, or takes it away. It is a prop of the game in every way but where its model comes from. */
  async function showCompilerProp(preview: { data: ModelData; materials: Map<string, MaterialData> } | null) {
    if (__WEB__) return;
    if (propPreview && !entities.includes(propPreview)) propPreview = null;
    if (!preview) {
      if (propPreview) { const gone = propPreview; propPreview = null; removeEntity(gone); }
      return;
    }
    const v = ensureViewer();
    const path = classPath(PROP_PREVIEW_CLS);
    // the model and materials are put where the viewer looks for what it loaded from the game
    models.set(path, preview.data);
    viewer?.mats.purge((p) => p.includes("__workbench__/prop_preview"));
    for (const [p, m] of preview.materials) materials.set(p, m);
    let first = false;
    if (!propPreview) {
      first = true;
      const e = newEntity(v.addActor(), PROP_PREVIEW_CLS, 0);
      e.name = "Prop (compiler)";
      const at = v.floorInFront();
      v.placeActorAt(e.actor, at.x, 0, at.z);
      entities.push(e);
      propPreview = e;
      renderEntities();
    }
    const e = propPreview;
    await show(e, e.cls);
    // it stands on the floor, whatever the origin of the model
    if (first && entities.includes(e)) v.placeActorAt(e.actor, e.actor.offset.x, -e.actor.bindMinY, e.actor.offset.z);
  }

  /** Puts the item (or nothing) on the selected character and takes it off the one that wore it. */
  function showCompilerItem(preview: PreviewApplication | null) {
    // the materials of the item keep their paths while their textures change: the shared material and texture caches go by path
    const stale = new Set([...(compilerPreview?.materials.keys() ?? []), ...(preview?.materials.keys() ?? [])]);
    if (stale.size) viewer?.mats.purge((path) => stale.has(path));
    compilerPreview = preview;
    const previous = compilerTarget;
    compilerTarget = preview ? selected : null;
    if (previous && previous !== compilerTarget && entities.includes(previous)) void applyLoadout(previous, previous.applied);
    itemsUi?.refreshEquipped();
    viewer?.setBoneHelper(boneHelperSpec, compilerTarget?.actor ?? null);
    viewer?.setBoneGizmo(boneGizmoSpec && compilerTarget ? { ...boneGizmoSpec, actor: compilerTarget.actor } : null);
    if (compilerTarget) void applyLoadout(compilerTarget, compilerTarget.applied);
    else if (previous && entities.includes(previous)) void applyLoadout(previous, previous.applied);
  }
  const compiler = createCompilerUi({
    root: document.getElementById("compilerPane")!,
    flyout: document.getElementById("compilerFlyout")!,
    io: {
      read: readSourceFile,
      stamp: sourceStamp,
      siblings: sourceSiblings,
      gameTexture: async (name) => parseTextureFrames(await loadTextureFrames(name, 1))[0] ?? null,
      gameCubemap: async (name) => {
        const m = parseMaterial(await loadMaterial(CUBEMAP_MATERIAL(name)));
        const faces = [0, 1, 2, 3, 4, 5].map((i) => m.textures[`env${i}`]);
        return faces.every(Boolean) ? faces : null;
      },
    },
    selection: () => {
      const e = selected;
      return e ? { cls: e.cls, team: e.team, lod: e.lod, model: models.get(classPath(e.cls)) ?? null } : null;
    },
    classes: () => CLASSES.map(([label, mdl]) => ({ id: mdl, label, icon: buttons.get(mdl)?.querySelector("img")?.src ?? "" })),
    selectClass: (cls) => pick(cls),
    setTeam: (team) => { if (selected) void setTeam(selected, team); },
    setLod: (lod) => { if (selected) void setEntityLod(selected, lod); },
    openIconStudio: () => void openIconStudio(),
    setBoneGizmo: (gizmo) => { boneGizmoSpec = gizmo; viewer?.setBoneGizmo(gizmo && compilerTarget ? { ...gizmo, actor: compilerTarget.actor } : null); },
    setBoneHelper: (helper) => { boneHelperSpec = helper; viewer?.setBoneHelper(helper, compilerTarget?.actor ?? null); },
    openSession: async () => {
      const folder = await importSourceDir().catch(() => "");
      const picked = await open({ multiple: false, directory: false, defaultPath: folder || undefined, filters: [{ name: "Importer session", extensions: ["txt"] }] });
      return typeof picked === "string" ? readItemSession(picked) : null;
    },
    setPreview: showCompilerItem,
    pick: async (kind, current) => {
      const picked = await open({ multiple: false, directory: false, defaultPath: current || undefined, filters: [{ name: kind === "fbx" ? "Model" : kind === "smd" ? "Collision model" : "Texture", extensions: kind === "fbx" ? [...MODEL_EXTENSIONS] : [kind] }] });
      return typeof picked === "string" ? picked : null;
    },
    pickFolder: __WEB__ ? undefined : async (current) => {
      const picked = await open({ multiple: false, directory: true, defaultPath: current || undefined });
      return typeof picked === "string" ? picked : null;
    },
    setPropPreview: __WEB__ ? undefined : (preview) => void showCompilerProp(preview),
    openPropSession: __WEB__ ? undefined : async (path) => {
      const file = path ?? (await open({ multiple: false, directory: false, filters: [{ name: "Prop session", extensions: ["txt"] }] }));
      return typeof file === "string" ? readPropSession(file) : null;
    },
    buildProp: __WEB__ ? undefined : async (request) => {
      const built = await buildProp(request);
      // the folder it went to is mounted: the prop is in the browser (and the one of the same name that was loaded is read again)
      const model = `models/${request.folder}/${request.name}.mdl`;
      models.delete(model);
      forgetThumbnail(model);
      document.dispatchEvent(new CustomEvent("workbench:custom-content-changed", { detail: { name: built.folder.replace(/[\/]+$/, "").split(/[\/]/).pop() } }));
      const warnings = built.log.filter((l) => /warning/i.test(l));
      return { ok: true, path: built.folder, message: `Built ${request.name}: ${built.files.length} files in ${built.millis} ms${warnings.length ? ` (${warnings.length} warning${warnings.length === 1 ? "" : "s"})` : ""}.` };
    },
    build: async (request) => {
      const built = await buildItem(request);
      // the zip is in the importer's folder, where the weapon and taunt lists look: let them see it
      void refreshWorkshopItems(true);
      const warnings = built.log.filter((l) => /warning/i.test(l));
      return { ok: true, path: built.zip, message: `Built ${request.name}.zip in ${built.millis} ms${warnings.length ? ` (${warnings.length} warning${warnings.length === 1 ? "" : "s"})` : ""}.` };
    },
    reveal: (path) => void revealFile(path),
    writeModel: (path, bytes) => writeAdjustedModel(path, bytes),
    rewriteModel: (path, bytes) => rewriteModelFile(path, bytes),
  });
  const entities: Entity[] = [];
  /** The groups of the hierarchy. */
  let groups: HierarchyGroup[] = [];
  let nextEntity = 1;
  /** The character whose move / rotate gizmo is on. */
  let gizmoEntity: Entity | null = null;

  const anim = createAnimUi(els.anim, () => viewer, () => selected?.actor ?? null, () => entities.map((e) => e.actor), () => {
    // every character takes the new setting: a Workshop taunt's prop clip is baked with the loadout, the rest are baked again
    for (const e of entities) {
      if (e.held?.workshop && e.held.slot === "taunt") void applyLoadout(e, e.applied);
      else anim.rebake(e.actor, e.anim);
    }
  });
  const flex = createFlexUi(els.flex, (globals) => selected?.actor.setFlexControllers(globals));
  const gameClassOf = (mdl: string) => CLASSES.find(([, m]) => m === mdl)?.[2] ?? mdl;
  const classLabelOf = (mdl: string) => {
    const building = buildingOf(mdl);
    if (building) return buildingLabel(building);
    // any other model of a path is a prop: it goes by its model's name
    return CLASSES.find(([, m]) => m === mdl)?.[0] ?? (isBuildingCls(mdl) ? propLabel(mdl.split("#")[0]) : "…");
  };

  function newEntity(actor: Actor, cls: string, team: number, id?: number): Entity {
    // a model of a path that is not a building is a prop: its geometry is in Source's frame
    actor.sourceBind = isBuildingCls(cls) && !buildingOf(cls);
    return {
      id: id ?? nextEntity++,
      hidden: false,
      lod: 0,
      unusuals: blankUnusuals(),
      unusualError: "",
      actor,
      cls,
      team,
      items: { loadout: [], activeId: null },
      applied: [],
      held: null,
      anim: newAnimState(),
      fx: defaultFx(),
      flex: new Map(),
      bodyManual: new Map(),
      bodyItems: {},
      loadoutToken: 0,
      showToken: 0,
    };
  }

  function syncUnusuals() {
    const e = selected;
    if (unusualCatalog.length) filterUnusualCatalog();
    els.unusual.hat.value = e?.unusuals.hatEffect ? `effect:${e.unusuals.hatEffect}` : e?.unusuals.silver ? "silver" : "";
    els.unusual.taunt.value = e?.unusuals.tauntEffect ? `effect:${e.unusuals.tauntEffect}` : e?.unusuals.arctic ? "arctic" : "";
    els.unusual.hat.disabled = els.unusual.taunt.disabled = !e;
    els.unusual.hatClear.disabled = !e || !els.unusual.hat.value;
    els.unusual.tauntClear.disabled = !e || !els.unusual.taunt.value;
    els.unusual.restart.disabled = !e || !(e.unusuals.silver || e.unusuals.arctic || e.unusuals.hatEffect || e.unusuals.tauntEffect);
    els.unusual.status.textContent = e?.unusualError || (e?.unusuals.silver
      ? viewer?.unusualUsesNativeSilver(e.actor) ? "Silver Serenade: native simulation" : "Silver Serenade: compatibility preview"
      : e?.unusuals.hatEffect || e?.unusuals.tauntEffect ? "Native Source simulation · preview rendering" : "");
  }

  let unusualCatalog: UnusualEffectInfo[] = [];
  let catalogLoading: Promise<void> | null = null;
  /** Newest first: the custom effects by the day they were loaded, the game's by their number (they are numbered as they were added). */
  const EFFECT_SORTS = {
    newest: (a: UnusualEffectInfo, b: UnusualEffectInfo) => (b.added ?? 0) - (a.added ?? 0) || b.id - a.id || a.name.localeCompare(b.name),
    alpha: (a: UnusualEffectInfo, b: UnusualEffectInfo) => a.name.localeCompare(b.name) || a.id - b.id,
  };
  const effectSort = createBrowserSort(els.unusual.bar, "effects", "newest", () => filterUnusualCatalog());
  function filterUnusualCatalog() {
    const query = els.unusual.search.value.trim().toLowerCase();
    for (const kind of ["hat", "taunt"] as const) {
      const picker = els.unusual[kind], selectedValue = kind === "hat"
        ? selected?.unusuals.hatEffect ? `effect:${selected.unusuals.hatEffect}` : selected?.unusuals.silver ? "silver" : ""
        : selected?.unusuals.tauntEffect ? `effect:${selected.unusuals.tauntEffect}` : selected?.unusuals.arctic ? "arctic" : "";
      picker.replaceChildren(new Option("None", ""));
      const custom = document.createElement("optgroup");
      custom.label = "Custom effects";
      for (const effect of unusualCatalog.filter((e) => e.kind === kind).sort(EFFECT_SORTS[effectSort.order()])) {
        const key = effect.system === "unusual_sheetmusic_silver_parent" ? "silver"
          : effect.system === "utaunt_innerblizzard_purple_parent" ? "arctic" : `effect:${effect.id}`;
        if (query && key !== selectedValue && !`${effect.name} ${effect.id} ${effect.system}`.toLowerCase().includes(query)) continue;
        const available = !!effect.file;
        const option = new Option(effect.custom ? `${effect.name} (${effect.custom})` : `${effect.name} (#${effect.id})${available ? "" : " — definition not installed"}`, key);
        option.disabled = !available;
        if (effect.custom) custom.append(option); else picker.add(option);
      }
      if (custom.children.length) picker.insertBefore(custom, picker.children[1] ?? null);
      picker.value = selectedValue;
    }
  }
  function loadUnusualCatalog() {
    if (catalogLoading) return catalogLoading;
    catalogLoading = fetchUnusualCatalog(true).then((effects) => {
      unusualCatalog = effects; filterUnusualCatalog(); syncUnusuals();
      const own = effects.filter((e) => e.custom && e.kind === "hat").length;
      els.unusual.catalog.textContent = `${effects.filter((e) => e.kind === "hat" && !e.custom).length} hat effects · ${effects.filter((e) => e.kind === "taunt" && !e.custom).length} taunt effects from installed TF2${own ? ` · ${own} custom` : ""}`;
      renderCustomEffects();
    }).catch((error) => { els.unusual.catalog.textContent = `Could not read unusual catalog: ${String(error)}`; })
      .finally(() => { catalogLoading = null; });
    return catalogLoading;
  }
  els.unusual.search.oninput = filterUnusualCatalog;

  /** The imported effect zips, each with a button that removes it. */
  function renderCustomEffects() {
    els.unusual.custom.replaceChildren(...customEffectZips().map((zip) => {
      const row = document.createElement("div");
      row.className = "particleCustomRow";
      const name = document.createElement("span");
      const systems = zip.pcfs.reduce((n, p) => n + p.systems.length, 0);
      name.textContent = zip.name;
      name.title = `${zip.name}.zip: ${zip.pcfs.length} particle file${zip.pcfs.length === 1 ? "" : "s"}, ${systems} systems, ${(zip.bytes / 1048576).toFixed(1)} MB`;
      const remove = document.createElement("button");
      remove.className = "iconBtn";
      remove.textContent = "×";
      remove.title = `Remove ${zip.name} from the custom effects`;
      remove.setAttribute("aria-label", remove.title);
      remove.onclick = async () => {
        remove.disabled = true;
        try {
          await removeCustomEffect(zip.name);
          // characters that use one of its effects lose it
          const gone = new Set(unusualCatalog.filter((e) => e.custom === zip.name).map((e) => e.id));
          for (const e of entities) {
            if ((e.unusuals.hatEffect && gone.has(e.unusuals.hatEffect)) || (e.unusuals.tauntEffect && gone.has(e.unusuals.tauntEffect))) {
              const { hatEffect, tauntEffect, ...rest } = e.unusuals;
              e.unusuals = { ...rest, ...(hatEffect && !gone.has(hatEffect) ? { hatEffect } : {}), ...(tauntEffect && !gone.has(tauntEffect) ? { tauntEffect } : {}) };
              void applyUnusuals(e);
            }
          }
          await loadUnusualCatalog();
        } catch (err) { els.unusual.status.textContent = `Could not remove it: ${String(err)}`; remove.disabled = false; }
      };
      row.append(name, remove);
      return row;
    }));
  }
  els.unusual.loadZip.onclick = async () => {
    const picked = await open({ multiple: false, filters: [{ name: "Effect zip", extensions: ["zip"] }] });
    if (typeof picked !== "string") return;
    els.unusual.loadZip.disabled = true;
    els.unusual.status.textContent = "Loading the custom effect…";
    try {
      const zips = await importEffectZip(picked);
      await loadUnusualCatalog();
      const name = picked.split(/[\\/]/).pop()?.replace(/\.zip$/i, "");
      const zip = zips.find((z) => z.name === name);
      const found = unusualCatalog.filter((e) => e.custom === zip?.name && e.kind === "hat").length;
      els.unusual.status.textContent = found ? `Loaded ${zip!.name}: ${found} effect${found === 1 ? "" : "s"}, listed under Custom effects in both pickers.` : "Loaded, but no effect could be read from it (see the console).";
    } catch (err) {
      els.unusual.status.textContent = `Could not load the effect zip: ${String(err)}`;
    } finally { els.unusual.loadZip.disabled = false; }
  };

  async function applyUnusuals(e: Entity, restart = false) {
    if (!viewer || !e.actor.hasModel || !entities.includes(e)) return;
    if ((e.unusuals.silver || e.unusuals.hatEffect) && !e.applied.some((x) => x.item.id === e.unusuals.hatItem)) {
      const hat = e.applied.find((x) => x.item.equipRegions.some((r) => r === "hat" || r === "whole_head"));
      e.unusuals = { ...e.unusuals, hatItem: hat?.item.id ?? null };
    }
    const settings = e.unusuals;
    e.unusualError = "";
    try { await viewer.setUnusuals(e.actor, settings, restart); }
    catch (err) {
      if (e.unusuals === settings) e.unusualError = `Could not preview effects: ${String(err)}`;
      console.error("Unusual effect preview", err);
    }
    if (e === selected) syncUnusuals();
  }

  const changeUnusuals = () => {
    const e = selected;
    if (!e) return;
    e.unusuals = {
      silver: els.unusual.hat.value === "silver", arctic: els.unusual.taunt.value === "arctic",
      hatItem: els.unusual.hat.value ? e.unusuals.hatItem : null,
      ...(els.unusual.hat.value.startsWith("effect:") ? { hatEffect: Number(els.unusual.hat.value.slice(7)) } : {}),
      ...(els.unusual.taunt.value.startsWith("effect:") ? { tauntEffect: Number(els.unusual.taunt.value.slice(7)) } : {}),
    };
    syncUnusuals();
    els.unusual.status.textContent = "Loading effects…";
    void applyUnusuals(e);
  };
  els.unusual.hat.onchange = els.unusual.taunt.onchange = changeUnusuals;
  for (const kind of ["hat", "taunt"] as const) {
    els.unusual[`${kind}Clear`].onclick = () => {
      els.unusual[kind].value = "";
      changeUnusuals();
    };
  }
  els.unusual.restart.onclick = () => { if (selected) void applyUnusuals(selected, true); };

  /**
   * The animated prop of a taunt: its model, team skin and baked animation, or null when the prop has no animation of its own
   * (the caller then bonemerges it).
   */
  async function loadProp(path: string, taunt: ItemInfo, cls: string, separate: boolean, team: number) {
    let seqs: { name: string; index: number }[];
    let defaults: number[];
    try {
      const info = parseAnimInfo(await listSequences(path));
      seqs = info.sequences;
      defaults = info.poseParams.map((p) => p.default);
    } catch {
      return null;
    }
    const real = seqs.filter((s) => s.name.toLowerCase() !== "ref");
    if (real.length === 0) return null;
    let data = models.get(path);
    if (!data) {
      data = parsePayload(await loadModel(path));
      models.set(path, data);
    }
    await ensureMaterials(data, team);
    const name = tauntPropSequence(separate ? taunt.tauntPropScenes[cls] : undefined, cls, seqs.map((s) => s.name));
    const seq = seqs.find((s) => s.name === name);
    const clip = seq ? await bakeClip(path, seq.index, defaults) : null;
    return { data, skin: team, clip };
  }

  /** Loads the equipped cosmetics for a character's class and bonemerges them onto its skeleton. */
  async function applyLoadout(e: Entity, loadout: Equipped[]) {
    const token = ++e.loadoutToken;
    if (isBuildingCls(e.cls)) {
      // a building wears nothing: its team is its skin
      e.actor.setSkin(e.team);
      applyBuildingFx(e);
      return;
    }
    e.applied = loadout;
    const team = e.team;
    const cls = gameClassOf(e.cls);
    const list: CosmeticSpec[] = [];
    const groups: Record<string, number> = {};
    // The held weapon rides along with the cosmetics: it is bonemerged onto the class's weapon bones the same way.
    const weapon = e.held && itemUsableBy(e.held, cls) ? e.held : null;
    let imported: WorkshopTaunt | null = null;
    let importedPropClip: ClipData | null = null;
    // Cancel any old animation bake before a different loadout can complete.
    if (e.anim.targetPath || (weapon?.workshop && weapon.slot === "taunt")) e.anim.token++;
    if (weapon?.workshop && weapon.slot === "taunt") {
      if (e === selected) els.anim.frameLabel.textContent = `Preparing ${weapon.displayName}…`;
      try {
        imported = await prepareTaunt(weapon, cls);
        if (token !== e.loadoutToken || !entities.includes(e)) return;
        if (imported.prop) {
          const info = parseAnimInfo(await listSequences(imported.animation));
          const seq = info.sequences.find((s) => s.name === imported!.sequence);
          if (!seq) throw new Error("Imported taunt sequence is missing");
          importedPropClip = await bakeClip(imported.animation, seq.index, info.poseParams.map((p) => p.default), imported.prop);
        }
      } catch (err) {
        if (token === e.loadoutToken && e === selected) els.anim.frameLabel.textContent = `Cannot load Workshop taunt: ${String(err)}`;
        return;
      }
    }
    const everything: Equipped[] = weapon ? [...loadout, { item: weapon, paint: null, style: 0 }] : loadout;
    /** Loads a model (cached) and its materials for a skin family, then adds it to the bonemerged list. */
    const add = async (path: string, rgb: number | null, skin: number, clip: ClipData | null = null, itemId?: number) => {
      let data = models.get(path);
      if (!data) {
        try {
          data = parsePayload(await loadModel(path));
          models.set(path, data);
        } catch (err) {
          els.items.count.textContent = `failed to load ${path}: ${String(err)}`;
          return;
        }
      }
      // at a lower LOD every item is drawn at that LOD too (one with fewer LODs at its own last)
      if (e.lod > 0) data = await modelAtLod(path, e.lod).catch(() => data!);
      await ensureMaterials(data!, skin);
      list.push({ data: data!, paint: rgb === null ? null : unpackRgb(rgb), skin, clip, itemId });
    };
    let prop: { data: ModelData; skin: number; clip: ClipData | null } | null = null;
    for (const { item: it, paint, style } of everything) {
      if (imported && it === weapon) {
        if (imported.prop) await add(imported.prop, null, team, importedPropClip, it.id);
        continue;
      }
      const path = itemModelFor(it, cls, style);
      if (!path) continue;
      if (it.slot === "taunt") {
        // A prop with its own intro scene is a separate entity (tf_taunt_prop). One without replaces the weapon's world model,
        // which the engine bonemerges: it follows the class's prop bones and plays its own animation on the bones the class lacks.
        const separate = !!it.tauntPropScenes[cls];
        const loaded = await loadProp(path, it, cls, separate, team).catch((err) => {
          els.items.count.textContent = `taunt prop ${path}: ${String(err)}`;
          return null;
        });
        if (loaded && separate) {
          prop = loaded;
          continue;
        }
        await add(path, null, team, loaded?.clip ?? null, it.id);
        continue;
      }
      // A style can pick its own skin family (skin_red / skin_blu); otherwise the team decides.
      const skin = itemSkinFor(it, team, style) ?? team;
      // Team paints carry a second colour for BLU; ordinary paints use their one colour on both teams.
      const rgb = paint ? (team === 1 ? paint.rgb2 ?? paint.rgb : paint.rgb) : null;
      let weaponClip:ClipData|null=null;
      if(weapon?.id===it.id && (slotForClass(it,cls)==="secondary" && cls==="medic")) {
        const info=parseAnimInfo(await listSequences(path));
        if(info.sequences.length) weaponClip=await bakeClip(path,0,info.poseParams.map(p=>p.default));
      }
      await add(path, rgb, skin, weaponClip, it.id);
      if (it === weapon && list.length) list[list.length - 1].weapon = true;
      // Models that travel with the item (a weapon's backpack, an attached part) share its paint and skin.
      for (const extra of it.extraModels ?? []) await add(extra, rgb, skin, null, it.id);
      Object.assign(groups, it.bodygroups, it.styles[style]?.bodygroups);
    }
    // the item being built hides what its Hides chips say, as an item of the game does
    if (compilerPreview && e === compilerTarget && compilerPreview.cls === e.cls) Object.assign(groups, compilerPreview.bodygroups);
    const merged = { ...groups, ...Object.fromEntries(e.bodyManual) };
    // a Voodoo-Cursed soul puts the class model in its zombie skin: its materials load before the skin changes
    e.zombie = everything.some(({ item }) => item.skinOverride);
    const classData = models.get(classPath(cls));
    if (classData) await ensureClassMaterials(e, classData);
    await ensureGroupMaterials(e, merged);
    if (token !== e.loadoutToken || !entities.includes(e)) return; // a newer loadout or class superseded this one
    e.actor.setSkin(team);
    e.actor.setZombieSkin(!!e.zombie);
    e.bodyItems = groups;
    e.actor.setBodygroups(merged);
    if (e === selected) renderBodygroups();
    // the item being built in the compiler is worn like any other cosmetic, by the character it is shown on
    if (compilerPreview && e === compilerTarget && compilerPreview.cls === e.cls) {
      for (const [path, material] of compilerPreview.materials) materials.set(path, material);
      list.push({ data: compilerPreview.data, paint: null, skin: team, clip: null });
    }
    e.actor.setCosmetics(list);
    e.actor.setProp(prop);
    void syncConditions(e);
    if (e === selected) refreshTextures();
    if (imported) {
      const target = classPath(e.cls);
      if (e.anim.modelPath !== imported.animation || e.anim.targetPath !== target) {
        await anim.attach(e.actor, e.anim, imported.animation, { seqName: imported.sequence }, target);
      }
      if (token === e.loadoutToken && e === selected) anim.show(e.anim, e.actor);
    } else if (e.anim.targetPath) {
      await anim.attach(e.actor, e.anim, classPath(e.cls));
      if (token === e.loadoutToken) playWeaponAnimation(e, weapon);
    }
    if (token === e.loadoutToken) await applyUnusuals(e);
  }

  /**
   * Poses a character for the held weapon. The hand grip and arm pose parameters start at 0 as they do on a game entity
   * (not at the engine default, the middle of their range, which leaves the hand half open) unless the weapon sets its
   * own (`player_poseparam`). The idle sequence (stand_primary / stand_secondary / stand_melee ...) is switched to as
   * well when that setting is on.
   */
  function playWeaponAnimation(e: Entity, weapon: ItemInfo | null) {
    const cls = gameClassOf(e.cls);
    if (!weapon || !itemUsableBy(weapon, cls)) return;
    if ((weapon.workshop && weapon.slot === "taunt") || e.anim.targetPath) return;
    // A taunt plays its own animation (always, it is the point of picking one) instead of a weapon idle.
    const taunt = weapon.slot === "taunt" ? tauntSequence(weapon.tauntScenes[cls] ?? "", cls, anim.sequenceNames(e.anim), itemModelFor(weapon, cls) ?? undefined) : null;
    const names = taunt ? [taunt] : settings().autoWeaponAnimation ? weaponIdleSequences(weapon, cls) : null;
    anim.applyHeld(e.actor, e.anim, names, { r_arm: 0, r_hand_grip: 0, ...weapon.poseParams });
  }
  const weapons = createWeaponsUi(els.weapons, {
    gameClass: () => gameClassOf(selected?.cls ?? ""),
    inspect: (weapon) => void inspectItem(weapon, true),
    changed: (weapon, picked) => {
      const e = selected;
      if (!picked || !e) return; // class switches reapply the loadout through the cosmetics browser
      e.held = weapons.getHeld();
      void applyLoadout(e, e.applied);
      // in pose mode (or on a held pose) the weapon changes in the hands without touching the pose: no idle sequence is switched to
      if (!e.actor.isPosing && !e.actor.holdsPose) playWeaponAnimation(e, weapon);
    },
  });
  /** The characters a cosmetic pick goes to: the selected ones (never a building: it wears nothing). */
  const cosmeticTargets = () => {
    const chosen = propsKind === "character" ? entities.filter((e) => multi.has(e.id)) : selected ? [selected] : [];
    return chosen.filter((e) => !isBuildingCls(e.cls));
  };
  const itemsUi = createItemsUi(els.items, {
    gameClass: () => gameClassOf(selected?.cls ?? ""),
    classes: () => {
      const classes = [...new Set(cosmeticTargets().map((e) => gameClassOf(e.cls)))];
      return classes.length ? classes : [gameClassOf(selected?.cls ?? "")];
    },
    restyled: (changes) => {
      for (const e of cosmeticTargets()) {
        if (e === selected) continue;
        let touched = false;
        const loadout = e.items.loadout.map((w) => {
          const change = changes.find((c) => c.item === w.item.id);
          if (!change) return w;
          touched = true;
          return { ...w, ...("paint" in change ? { paint: change.paint ?? null } : {}), ...(change.style !== undefined ? { style: change.style } : {}) };
        });
        if (!touched) continue;
        e.items = { ...e.items, loadout };
        const cls = gameClassOf(e.cls);
        void applyLoadout(e, loadout.filter((w) => itemUsableBy(w.item, cls)));
      }
    },
    cleared: () => {
      for (const e of cosmeticTargets()) {
        if (e === selected) continue;
        e.items = { loadout: [], activeId: null };
        void applyLoadout(e, []);
      }
    },
    toggled: (item, equip) => {
      for (const e of cosmeticTargets()) {
        if (e === selected) continue;
        const cls = gameClassOf(e.cls);
        e.items = itemsUi.toggleFor(e.items, item, equip, cls);
        void applyLoadout(e, e.items.loadout.filter((x) => itemUsableBy(x.item, cls)));
      }
    },
    apply: (loadout) => (selected ? applyLoadout(selected, loadout) : Promise.resolve()),
    inspect: (item) => void inspectItem(item, false),
    allowOverlap: () => settings().allowOverlappingCosmetics,
    temporary: () => (compilerPreview && selected && selected === compilerTarget && compilerPreview.cls === selected.cls ? { name: compilerPreview.name } : null),
    removeTemporary: () => showCompilerItem(null),
  });

  const buttons = new Map<string, HTMLButtonElement>();
  for (const [label, mdl] of CLASSES) {
    const b = document.createElement("button");
    b.className = "classBtn";
    b.title = label;
    b.setAttribute("aria-label", label);
    b.onclick = () => pick(mdl);
    els.classes.appendChild(b);
    buttons.set(mdl, b);
  }

  function markSelected() {
    for (const [mdl, b] of buttons) b.classList.toggle("on", mdl === selected?.cls);
  }

  function pick(mdl: string) {
    const e = selected;
    if (!e) return;
    stopPlay();
    e.cls = mdl;
    // the item under construction is per class: the last class's model comes off before this one loads
    if (compilerOn && e === selected) { showCompilerItem(null); compiler.selectionChanged(); }
    markSelected();
    renderEntities();
    renderBuildingPanel();
    viewer?.setBuildingFx(e.actor, null, e.fx);
    void show(e, mdl);
  }

  /** The scoreboard class icons of the install (materials/hud/leaderboard_class_*), drawn once the TF2 folder is indexed. */
  let iconsLoaded = false;
  async function loadIcons() {
    if (iconsLoaded) return;
    iconsLoaded = true;
    await Promise.all(
      CLASSES.map(async ([, mdl]) => {
        try {
          const tex = parseMaterial(await loadMaterial(`materials/hud/leaderboard_class_${mdl}.vmt`)).textures.base;
          if (!tex) return;
          const canvas = document.createElement("canvas");
          canvas.width = tex.width;
          canvas.height = tex.height;
          canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(tex.rgba), tex.width, tex.height), 0, 0);
          const img = new Image();
          img.src = canvas.toDataURL();
          img.draggable = false;
          const b = buttons.get(mdl)!;
          b.replaceChildren(img);
        } catch {
          buttons.get(mdl)!.textContent = mdl.slice(0, 3); // icon missing: fall back to a short label
        }
      }),
    );
  }

  /** Loads the materials of a class model in the team's skin, and in the zombie family of it when the character wears a soul. */
  async function ensureClassMaterials(e: Entity, data: ModelData) {
    await ensureMaterials(data, e.team);
    const zombie = e.zombie ? zombieFamily(data.skinCount, e.team) : null;
    if (zombie !== null) await ensureMaterials(data, zombie);
  }

  /** Loads the materials the model uses in the given team skin (families a model lacks fall back to RED). */
  async function ensureMaterials(data: ModelData, skin: number) {
    const wanted = new Set<string>();
    for (const bp of data.bodyParts)
      for (const m of bp.models[0]?.meshes ?? []) if (m.indices.length) wanted.add(m.materials[skin] ?? m.material);
    await loadMaterials(wanted);
    return wanted;
  }

  async function loadMaterials(paths: Iterable<string>) {
    await Promise.all(
      [...paths]
        .filter((p) => !materials.has(p))
        .map(async (p) => {
          try {
            materials.set(p, parseMaterial(await loadMaterial(p)));
          } catch (err) {
            materials.set(p, null);
            materialErrors.set(p, String(err));
          }
        }),
    );
  }

  /** Loads the materials of the class models that body groups switch on (a character loads those of the default models only). */
  async function ensureGroupMaterials(e: Entity, groups: Record<string, number>) {
    const data = models.get(classPath(e.cls));
    if (!data) return;
    const wanted = new Set<string>();
    for (const bp of data.bodyParts) {
      const index = groups[bp.name.toLowerCase()] ?? 0;
      if (index === 0) continue;
      for (const m of bp.models[index]?.meshes ?? []) if (m.indices.length) wanted.add(m.materials[(e.zombie ? zombieFamily(m.materials.length, e.team) : null) ?? e.team] ?? m.materials[e.team] ?? m.material);
    }
    await loadMaterials(wanted);
  }

  // --- the workshop importer's zips: reloaded without a restart ---------------------------------------------------------

  let workshopStamp: string | null = null;
  let refreshing = false;

  /** Rescans tf/workshop/import_source and reloads whatever came from it: the catalog, the models, materials and icons, and every character that wears one. */
  async function refreshWorkshopItems(quiet = false) {
    if (refreshing) return;
    refreshing = true;
    els.items.refresh.disabled = true;
    try {
      await refreshWorkshopCommand();
      importedTaunts.clear();
      workshopStamp = await workshopStampCommand().catch(() => workshopStamp);
      const isWorkshop = (p: string) => p.toLowerCase().includes("workshop");
      for (const k of [...models.keys()]) if (isWorkshop(k)) models.delete(k);
      for (const k of [...materials.keys()]) if (isWorkshop(k)) materials.delete(k);
      for (const k of [...materialErrors.keys()]) if (isWorkshop(k)) materialErrors.delete(k);
      viewer?.mats.purge(isWorkshop);
      purgeIcons(isWorkshop);
      const db = await reloadItemDb();
      const fresh = new Map([...db.items, ...db.taunts].filter((i) => i.workshop).map((i) => [i.id, i]));
      // every character's loadout: workshop items are swapped for their reloaded definitions, and dropped when their zip is gone
      const remap = (list: Equipped[]) => list.filter((x) => !x.item.workshop || fresh.has(x.item.id)).map((x) => (x.item.workshop ? { ...x, item: fresh.get(x.item.id)! } : x));
      if (selected) saveUi(selected);
      for (const e of entities) {
        e.items = { loadout: remap(e.items.loadout), activeId: e.items.activeId };
        e.applied = remap(e.applied);
        if (e.held?.workshop) e.held = fresh.get(e.held.id) ?? null;
      }
      weapons.reloadCatalog(db);
      await itemsUi.reloadCatalog();
      if (selected) restoreUi(selected);
      for (const e of entities) void applyLoadout(e, e.applied);
      if (!quiet) {
        els.items.count.textContent = `Workshop items reloaded: ${fresh.size}.`;
        window.setTimeout(() => (els.items.count.textContent = ""), 4000);
      }
    } catch (err) {
      els.items.count.textContent = `Could not reload the workshop cosmetics: ${String(err)}`;
    } finally {
      refreshing = false;
      els.items.refresh.disabled = false;
    }
  }
  els.items.refresh.onclick = () => void refreshWorkshopItems();
  // coming back to the window (from the game, say, after recompiling an item): reload when the zips changed
  window.addEventListener("focus", () => {
    if (document.getElementById("view")?.hidden) return;
    void workshopStampCommand().then(
      (stamp) => {
        if (workshopStamp === null) workshopStamp = stamp;
        else if (stamp !== workshopStamp) void refreshWorkshopItems(true);
      },
      () => {},
    );
  });
  void workshopStampCommand().then((s) => (workshopStamp ??= s), () => {});

  /** Creates the 3D view (once) with the current light, shadow and field of view settings. */
  // The view mode buttons in the top left corner of the 3D view: how the surfaces are shown (shaded / diffuse / grayscale, one of
  // them) and the wireframe drawn over them. The shading choice is remembered.
  const modeButtons = {
    shaded: document.getElementById("modeShaded") as HTMLButtonElement,
    diffuse: document.getElementById("modeDiffuse") as HTMLButtonElement,
    gray: document.getElementById("modeGray") as HTMLButtonElement,
  };
  const modeWire = document.getElementById("modeWire") as HTMLButtonElement;
  modeButtons.shaded.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm-2.5 3.2a6 6 0 0 1 3.6-.4 6 6 0 0 0-5.7 8.6A6 6 0 0 1 9.5 6.200z" opacity=".95"/><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
  modeButtons.diffuse.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 4h8v8H4zM12 12h8v8h-8z"/><path d="M12 4h8v8h-8zM4 12h8v8H4z" opacity=".35"/></svg>';
  modeButtons.gray.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 3.8a8.200 8.200 0 0 1 0 16.400z"/></svg>';
  modeWire.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 3 20 7.500v9L12 21l-8-4.500v-9zM12 3v18M4 7.500l16 9M20 7.500l-16 9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  let shading: "shaded" | "diffuse" | "gray" = "shaded";
  try {
    const saved = localStorage.getItem("tf2workbench.shading");
    if (saved === "diffuse" || saved === "gray") shading = saved;
  } catch {
    // storage unavailable: start shaded
  }
  function applyShading(mode: "shaded" | "diffuse" | "gray") {
    shading = mode;
    viewer?.setShading(mode);
    for (const [k, b] of Object.entries(modeButtons)) b.classList.toggle("on", k === mode);
    try {
      localStorage.setItem("tf2workbench.shading", mode);
    } catch {
      // not remembered
    }
  }
  for (const [k, b] of Object.entries(modeButtons)) b.onclick = () => applyShading(k as "shaded" | "diffuse" | "gray");
  modeWire.onclick = () => {
    els.wire.checked = !els.wire.checked;
    els.wire.onchange?.(new Event("change"));
  };
  const syncWireButton = () => modeWire.classList.toggle("on", els.wire.checked);
  for (const [k, b] of Object.entries(modeButtons)) b.classList.toggle("on", k === shading);

  // The gizmo buttons in the top right corner of the 3D view while posing: the move arrows, the rotation rings and the ring about the
  // line of sight can each be shown or hidden (all of them, or just the rotation). The choice is remembered.
  const gizmoBox = document.getElementById("gizmoParts") as HTMLElement;
  // a click on the tools or the header buttons of the view does not keep the keyboard: W, E, R, Q and the other keys go on working
  for (const id of ["viewToolbar", "viewHeader"]) document.getElementById(id)?.addEventListener("click", () => (document.activeElement as HTMLElement | null)?.blur());
  const gizmoButtons = {
    move: document.getElementById("gizMove") as HTMLButtonElement,
    rotate: document.getElementById("gizRotate") as HTMLButtonElement,
    scale: document.getElementById("gizScale") as HTMLButtonElement,
    view: document.getElementById("gizView") as HTMLButtonElement,
  };
  gizmoButtons.move.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/></svg>';
  // a ring with an arrow on each side, turning
  gizmoButtons.rotate.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7.500"/><path d="M10 2l3 2.500-3 2.500M14 17l-3 2.500 3 2.500"/></svg>';
  // a circle with a dot in it
  gizmoButtons.view.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.600" fill="currentColor" stroke="none"/></svg>';
  // by default only the view ring (with its dot) shows
  gizmoButtons.scale.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="13" width="7" height="7"/><path d="M13 4h7v7M20 4l-8 8"/></svg>';
  // the orientation of every gizmo ("Normal" in Blender): the button after the four tools, remembered
  const orientButton = document.getElementById("gizOrient") as HTMLButtonElement;
  orientButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 19V5M5 19h14M5 19l8-8"/></svg>';
  let gizmoLocal = true;
  try {
    gizmoLocal = localStorage.getItem("tf2workbench.gizmoLocal") !== "0";
  } catch {
    // storage unavailable: gizmos turn with what they edit
  }
  function applyGizmoOrientation() {
    orientButton.classList.toggle("on", gizmoLocal);
    orientButton.title = gizmoLocal ? "Gizmo orientation: local, the gizmos turn with what they edit (click for the scene's axes)" : "Gizmo orientation: the scene's axes (click for local, turning with what they edit)";
    viewer?.setGizmoSpace(gizmoLocal);
  }
  orientButton.onclick = () => {
    gizmoLocal = !gizmoLocal;
    try {
      localStorage.setItem("tf2workbench.gizmoLocal", gizmoLocal ? "1" : "0");
    } catch {
      // not remembered
    }
    applyGizmoOrientation();
  };
  applyGizmoOrientation();
  let gizmoParts = { move: false, rotate: false, scale: false, view: true };
  let characterGizmoParts = { move: true, rotate: false, scale: false, view: false };
  /** The tools of a gizmo that a click on empty space took away: they come back with the next thing that is selected. */
  let armedParts: typeof characterGizmoParts | null = null;
  try {
    const saved = JSON.parse(localStorage.getItem("tf2workbench.gizmoParts2") ?? "null");
    if (saved && typeof saved === "object") gizmoParts = { move: saved.move === true, rotate: saved.rotate === true, scale: saved.scale === true, view: saved.view !== false };
  } catch {
    // storage unavailable: the defaults
  }
  function applyGizmoParts() {
    const cameraEditing = !!viewer?.cameras.editing;
    const lightEditing = !cameraEditing && !!viewer?.lightGizmos.active;
    const parts = cameraEditing ? viewer!.cameras.parts : lightEditing ? viewer!.lightGizmos.parts : gizmoEntity && !selected?.actor.isPosing ? characterGizmoParts : gizmoParts;
    // with nothing being edited by a gizmo, no tool is lit (the buttons bring a gizmo up)
    const active = cameraEditing || lightEditing || (!!gizmoEntity && !selected?.actor.isPosing) || !!selected?.actor.isPosing;
    // after a click on empty space the tools stay lit: the gizmo comes back with the next selection
    const shown = !active && armedParts ? armedParts : parts;
    for (const [k, b] of Object.entries(gizmoButtons)) b.classList.toggle("on", (active || !!armedParts) && shown[k as keyof typeof shown]);
    gizmoButtons.scale.disabled = cameraEditing;
    gizmoButtons.rotate.disabled = lightEditing && !viewer!.lightGizmos.rotatable;
    gizmoButtons.view.disabled = lightEditing && !viewer!.lightGizmos.rotatable;
    viewer?.rig.setGizmoParts(gizmoParts);
    viewer?.blenderRig.setGizmoParts(gizmoParts);
    viewer?.setEntityGizmoParts(characterGizmoParts);
    try {
      localStorage.setItem("tf2workbench.gizmoParts2", JSON.stringify(gizmoParts));
    } catch {
      // not remembered
    }
  }
  for (const [k, b] of Object.entries(gizmoButtons)) {
    b.onclick = () => {
      const key = k as keyof typeof gizmoParts;
      if (viewer?.cameras.editing) {
        if (key === "scale") return;
        const parts = viewer.cameras.parts;
        viewer.cameras.setParts({ ...parts, [key]: !parts[key] });
      } else if (viewer?.lightGizmos.active) {
        if ((key === "rotate" || key === "view") && !viewer.lightGizmos.rotatable) return;
        viewer.lightGizmos.setParts({ ...viewer.lightGizmos.parts, [key]: !viewer.lightGizmos.parts[key] });
      } else if (gizmoEntity && !selected?.actor.isPosing) characterGizmoParts = { ...characterGizmoParts, [key]: !characterGizmoParts[key] };
      else if (!selected?.actor.isPosing) {
        // no gizmo is up: a tool button brings up the gizmo of the selected character with that tool, as the W, E and R keys do
        const e = selected;
        if (!e || key === "view") return;
        if (gizmoEntity !== e) toggleGizmo(e);
        selectGizmoTool(key);
        return;
      } else gizmoParts = { ...gizmoParts, [key]: !gizmoParts[key] };
      applyGizmoParts();
    };
    b.classList.toggle("on", gizmoParts[k as keyof typeof gizmoParts]);
  }

  /** W / E / R: the gizmo of the thing being edited (a character, a camera, a light, a pose control) becomes the move, rotate or scale gizmo. */
  function selectGizmoTool(tool: "move" | "rotate" | "scale") {
    const only = <T extends { move: boolean; rotate: boolean; scale: boolean }>(p: T): T => ({ ...p, move: tool === "move", rotate: tool === "rotate", scale: tool === "scale" });
    if (viewer?.cameras.editing) {
      if (tool === "scale") return;
      viewer.cameras.setParts(only(viewer.cameras.parts));
    } else if (viewer?.lightGizmos.active) {
      if (tool === "rotate" && !viewer.lightGizmos.rotatable) return;
      viewer.lightGizmos.setParts(only(viewer.lightGizmos.parts));
    } else if (gizmoEntity && !selected?.actor.isPosing) characterGizmoParts = only(characterGizmoParts);
    else gizmoParts = only(gizmoParts);
    applyGizmoParts();
  }
  window.addEventListener("keydown", (ev) => {
    const tool = gizmoKey(ev);
    const target = ev.target as HTMLElement | null;
    if (!tool || ev.repeat || ev.defaultPrevented || ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey || target?.isContentEditable || (target && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName))) return;
    if (document.getElementById("view")?.hidden || play?.active) return;
    if (viewer?.cameras.editing || viewer?.lightGizmos.active || selected?.actor.isPosing) {
      if (gizmoBox.hidden) return;
      selectGizmoTool(tool);
    } else {
      // on a character: the key brings its gizmo up (the selected character's), and the same key again puts it away
      const e = selected;
      if (!e) return;
      const others = (["move", "rotate", "scale"] as const).some((k) => k !== tool && characterGizmoParts[k]);
      if (gizmoEntity === e && characterGizmoParts[tool] && !others) toggleGizmo(e);
      else {
        if (gizmoEntity !== e) toggleGizmo(e);
        selectGizmoTool(tool);
      }
    }
    ev.preventDefault();
  });

  // The floor grid button in the corner of the 3D view; the choice is remembered.
  const hudGrid = document.getElementById("hudGrid") as HTMLButtonElement;
  const ICON_GRID = '<svg viewBox="0 0 24 24"><path d="M8.2 4 6.4 20H4.4l1.8-16zM16 4l1.8 16h-2L14 4zM2.5 9h19v1.8h-19zM1.5 15h21v1.8h-21z"/></svg>';
  let gridOn = false;
  try {
    gridOn = localStorage.getItem("tf2workbench.grid") === "1";
  } catch {
    // storage unavailable: the grid starts hidden
  }
  hudGrid.innerHTML = ICON_GRID;
  hudGrid.classList.toggle("on", gridOn);
  hudGrid.onclick = () => {
    gridOn = !gridOn;
    if (viewer) viewer.gridVisible = gridOn;
    hudGrid.classList.toggle("on", gridOn);
    try {
      localStorage.setItem("tf2workbench.grid", gridOn ? "1" : "0");
    } catch {
      // not remembered
    }
  };

  // The selection outline button beside the floor grid: an outline around the selected characters, lights and cameras; remembered, on by default.
  const hudOutline = document.getElementById("hudOutline") as HTMLButtonElement;
  hudOutline.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><g transform="translate(-3.6 -2.9) scale(1.3)" stroke-width="1.4"><circle cx="12" cy="8.2" r="2.2"/><path d="M7 18l.5-4.3c.2-1.7 1.8-2.9 4.5-2.9s4.3 1.2 4.5 2.9L17 18h-2.5v-3.5L14 18h-4l-.5-3.5V18z"/></g></svg>';
  let outlineOn = false;
  try {
    outlineOn = localStorage.getItem("tf2workbench.selectionOutline") === "1";
  } catch {
    // storage unavailable: the outline stays hidden
  }
  hudOutline.classList.toggle("on", outlineOn);
  hudOutline.setAttribute("aria-pressed", String(outlineOn));
  hudOutline.onclick = () => {
    outlineOn = !outlineOn;
    viewer?.setSelectionOutline(outlineOn);
    hudOutline.classList.toggle("on", outlineOn);
    hudOutline.setAttribute("aria-pressed", String(outlineOn));
    try {
      localStorage.setItem("tf2workbench.selectionOutline", outlineOn ? "1" : "0");
    } catch {
      // not remembered
    }
  };

  // The light indicators button beside the floor grid: whether the lights show in the view (and can be clicked); remembered, on by default.
  const hudLights = document.getElementById("hudLights") as HTMLButtonElement;
  hudLights.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 0-4 12.700V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.300A7 7 0 0 0 12 2zM9.500 20h5v1.500a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1z"/></svg>';
  let lightsOn = true;
  try {
    lightsOn = localStorage.getItem("tf2workbench.lightIndicators") !== "0";
  } catch {
    // storage unavailable: the indicators show
  }
  hudLights.classList.toggle("on", lightsOn);
  hudLights.onclick = () => {
    lightsOn = !lightsOn;
    if (viewer) viewer.lightIndicators = lightsOn;
    hudLights.classList.toggle("on", lightsOn);
    try {
      localStorage.setItem("tf2workbench.lightIndicators", lightsOn ? "1" : "0");
    } catch {
      // not remembered
    }
  };

  let pendingDamage:boolean|null=null,damageGeneration=0;let damageSave=Promise.resolve();
  /** Apply viewer preferences initially and whenever settings change. */
  function applyViewSettings(v: Viewer) {
    const s = settings();
    v.setWireStyle(s.wireColor, s.wireOpacity);
    v.setGridStyle(s.gridColor, s.gridOpacity);
    // the default glow colour is the highlight of the interface, so it follows the theme; a colour chosen in Settings stays
    v.setFlashColor(s.flashColor.toLowerCase() === "#e08a3c" ? accentHex() : s.flashColor);
    v.setSelectionOpacity(s.selectionOpacity);
    v.setCameraSmoothing(s.cameraSmoothing);
    v.cameras.restoreViewOnExit = s.restoreViewportOnCameraExit;
    v.setScrollStrength(s.scrollStrength);
    v.setNavButtons();
    v.setHitReactions(pendingDamage ?? s.playHitReactions);
  }
  onSettingsChange(() => {
    if (viewer) applyViewSettings(viewer);
  });

  /** Called before a camera is viewed or edited: whatever else holds the pointer lets go. */
  function prepareCamera() {
    if (play?.active) stopPlay();
    if (selected?.actor.isPosing) exitPosing();
    gizmoEntity = null;
    viewer?.setActorGizmo(null);
  }
  const renderCameraUi = createCameraUi(document.getElementById("camerasPane")!, () => ensureViewer().cameras, prepareCamera);

  function ensureViewer(): Viewer {
    if (!viewer) {
      viewer = new Viewer(els.wrap, () => [models, materials]);
      viewer.setSelectionOutline(document.getElementById("hudOutline")?.classList.contains("on") ?? true);
      if (!__WEB__) {
        // a prop dragged out of the browser and dropped on the view is put where it is dropped
        els.wrap.addEventListener("dragover", (ev) => {
          if (!ev.dataTransfer?.types.includes(PROP_DRAG_TYPE)) return;
          ev.preventDefault();
          ev.dataTransfer.dropEffect = "copy";
        });
        els.wrap.addEventListener("drop", (ev) => {
          const path = ev.dataTransfer?.getData(PROP_DRAG_TYPE);
          if (!path) return;
          ev.preventDefault();
          void addProp(path, { clientX: ev.clientX, clientY: ev.clientY });
        });
      }
      const boxButton = document.getElementById("boxSelect") as HTMLButtonElement;
      boxButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h3M10 4h4M17 4h3M20 7v3M20 14v3M4 7v3M4 14v3M4 20h3M10 20h2" stroke-dasharray="0"/><path d="M14 13l7 3-3 1.600L16 21z" fill="currentColor"/></svg>';
      boxTool = createBoxSelect<Actor>({
        canvas: viewer.renderer.domElement,
        wrap: els.wrap,
        button: boxButton,
        inBox: (box) => viewer!.boxHits(box),
        atPoint: (x, y) => viewer!.pointHits(x, y),
        apply: applyBox,
        allowed: () => !play?.active && !viewer?.rig.active && !viewer?.cameras.active && !viewer?.modalActive && !viewer?.gizmoHot,
      });
      // dev builds: a handle for inspecting the scene from the console
      if (import.meta.env.DEV) (window as unknown as { __workbench: unknown }).__workbench = { viewer, entities, models };
      viewer.onConditionsChanged = (actor) => { if (selected?.actor === actor) renderConditions(); };
      viewer.cameraOverlay.attachProperties(propsEl("overlayProps"));
      viewer.cameraOverlay.onChange(() => { overlayPanel.refresh(); syncOverlayMode(); });
      viewer.cameraOverlay.items = () => entities.flatMap(entity => {
        const items = entity.applied.map(equipped => ({ item: equipped.item, style: equipped.style }));
        if (entity.held?.slot === "taunt") items.push({ item: entity.held, style: 0 });
        return items.flatMap(({ item, style }) => { const image = itemImageFor(item, style); return image ? [{ image, label: item.displayName }] : []; });
      });
      viewer.cameras.onChange = () => {
        renderCameraUi();
        renderEntities();
        applyGizmoParts();
      };
      void loadUnusualCatalog();
      viewer.onUnusualError = (actor, error) => {
        const entity = entities.find((e) => e.actor === actor);
        if (!entity) return;
        entity.unusualError = `Could not preview effects: ${String(error)}. Try Restart effects.`;
        if (entity === selected) syncUnusuals();
        console.error("Native unusual effect", error);
      };
      viewer.gridVisible = gridOn;
      viewer.lightIndicators = lightsOn;
      const nav = createNavGizmo(els.wrap, {
        camera: viewer.camera,
        viewDir: () => viewer?.viewDir() ?? new THREE.Vector3(0, 0, 1),
        snapTo: (dir) => viewer?.snapView(dir),
        orbitBy: (dx, dy) => viewer?.orbitBy(dx, dy),
        zoomBy: (f) => viewer?.zoomBy(f),
        panBy: (dx, dy) => viewer?.panBy(dx, dy),
        toggleProjection: () => viewer?.toggleProjection(),
        isOrthographic: () => viewer?.camera.isOrthographicCamera ?? false,
        cameraCount: () => viewer?.cameras.cameras.length ?? 0,
        cameraActive: () => !!viewer?.cameras.active,

        toggleCamera: () => {
          const rig = viewer?.cameras;
          if (rig?.active) lookThroughCamera(rig.active, false);
          else { const id = lastCamera(); if (id) lookThroughCamera(id, false); }
        },
      });
      viewer.onPostRender = nav.update;
      viewer.rig.setGizmoParts(gizmoParts);
      viewer.blenderRig.setGizmoParts(gizmoParts);
      viewer.setEntityGizmoParts(characterGizmoParts);
      viewer.setGizmoSpace(gizmoLocal);
      viewer.setShading(shading);
      applyViewSettings(viewer);
      viewer.onLightChange = l => { syncSliders(l); applyGizmoParts(); };
      viewer.onPointLightChange = (l) => {
        setPointControls(l);
        applyPoint();
      };
      viewer.onFrame = anim.onFrame;
      viewer.onPoseEnded = syncPoseUi;
      viewer.rig.onSelect = () => syncPoseUi();
      viewer.rig.onEdit = () => {
        els.pose.hud.undo.disabled = !selected?.actor.canUndo;
        els.pose.hud.redo.disabled = !selected?.actor.canRedo;
      };
      viewer.blenderRig.onSelect = () => syncPoseUi();
      viewer.blenderRig.onEdit = () => {
        els.pose.hud.undo.disabled = !selected?.actor.canUndo;
        els.pose.hud.redo.disabled = !selected?.actor.canRedo;
        rigControls?.refresh();
      };
      viewer.blenderRig.onModal = (text) => {
        els.pose.hud.status.textContent = text ?? "";
        if (text === null) syncPoseUi();
      };
      viewer.rig.onModal = (text) => {
        // the G / R transform's hint, over the view (nothing when it ends)
        els.pose.hud.status.textContent = text ?? "";
        if (text === null) syncPoseUi();
      };
      viewer.rig.eyeAngles = () => ({ upDown: flex.get("eyes_updown"), rightLeft: flex.get("eyes_rightleft") });
      viewer.rig.onEyeAim = (upDown, rightLeft) => {
        flex.set("eyes_updown", upDown);
        flex.set("eyes_rightleft", rightLeft);
      };
      // a click on a camera or a light in the view: the gizmo goes to it
      viewer.onPickTarget = ({ kind, id }, additive) => {
        nothingSelected = false;
        if (additive) { shiftPick({ kind, id }); return; }
        multi = new Set();
        selLights = new Set(kind === "light" ? [id] : []);
        selCameras = new Set(kind === "camera" ? [id] : []);
        propsKind = kind;
        if (kind === "camera") {
          propsCamera = id;
          renderCameraUi.select(id);
        }
        gizmoToTarget(kind, id);
        renderEntities();
      };
      viewer.onPick = (actor, hit, additive) => {
        const e = entities.find((x) => x.actor === actor);
        if (additive) {
          if (e) shiftPick({ kind: "character", id: String(e.id) });
          return;
        }
        if (!e) {
          deselectAll();
          return;
        }
        if (e) {
          selectEntity(e);
          // the gizmo goes to the character that was clicked, from the character, camera or light that had it (nothing shows if nothing had it)
          if (gizmoWanted()) {
            gizmoOnCharacter(e);
            restoreArmed();
            renderEntities();
          }
          viewer?.flash(e.actor, hit?.item ?? null); // show which one was hit (a cosmetic on its own when that is what was clicked)
          // a click on a cosmetic opens its paint chart there
          if (hit?.item != null) itemsUi.openPaint(hit.item, hit.x + 10, hit.y + 10);
        }
      };
      applySliders();
      applyPoint();
      viewer.setFov(+els.fov.value);
      pushPost();
      void applySky().catch(() => {});
      void applyReflection().catch(() => {});
      viewer.setGround(ground);
      viewer.setBackdropColor(bgInput.value);
      viewer.setSpacing(+els.entities.spacing.value);
      viewer.setWireframe(els.wire.checked);
      viewer.setJiggle(els.jiggle.checked);
      renderCameraUi();
    }
    return viewer;
  }

  /** Loads a character's class model and starts its default animation. */
  async function show(e: Entity, cls: string, preset?: AnimPreset) {
    e.cls = cls;
    if (e === selected) renderConditions(); // some effects are the toggles of one class
    if (isBuildingCls(cls)) preset = { ...preset, seqName: preset?.seqName ?? defaultBuildingSequence(cls) };
    if (!preset && e.actor.inspectOnly) preset = { seqName: "ref" }; // an item opened alone stays in the reference pose on every class
    const token = ++e.showToken;
    const path = classPath(cls);
    let data = models.get(path);
    if (!data) {
      if (e === selected) els.info.textContent = `Loading ${path}…`;
      try {
        data = parsePayload(await loadModel(path));
      } catch (err) {
        if (e === selected) els.info.textContent = `Failed to load ${path}:\n${String(err)}`;
        return;
      }
      models.set(path, data);
    }
    await ensureClassMaterials(e, data);
    await ensureGroupMaterials(e, { ...e.bodyItems, ...Object.fromEntries(e.bodyManual) }); // the models body groups switch on, from a restored scene
    if (token !== e.showToken || !entities.includes(e)) return; // a newer selection superseded this one
    const v = ensureViewer();
    try {
      e.actor.setSkin(e.team);
      v.setModel(e.actor, data, materials);
      void applyClassLod(e);
      void syncConditions(e);
      if (e === selected) flex.attach(data);
      else e.actor.setFlexControllers(flexGlobalsFor(data, e.flex));
    } catch (err) {
      console.error(err);
      els.anim.frameLabel.textContent = `render error: ${err instanceof Error ? err.stack ?? err.message : String(err)}`;
      return;
    }
    // a prop that has several skins says which it wears in the outliner (known now that the model is)
    if (skinsOf(e) > 1) renderEntities();
    if (e === selected) {
      els.info.textContent = "";
      syncSkins();
      renderBodygroups();
      bodyPicker?.sync();
      refreshTextures();
    }
    // the item being built is shown on the model that is now there
    if (compilerOn && e === selected) compiler.selectionChanged();
    // A fresh class starts on its default sequence; a held weapon then picks its own.
    await anim.attach(e.actor, e.anim, path, preset ? { seq: preset.seq, seqName: preset.seqName, encoded: preset.encoded } : undefined);
    if (token !== e.showToken || !entities.includes(e)) return;
    if (isBuildingCls(e.cls)) {
      // no loadout, weapon or unusuals; a restored scene resumes its clock
      const from = preset?.playback?.();
      if (from) Object.assign(e.actor.playback, { time: from.time, speed: from.speed, loopAll: from.loopAll, playing: from.playing });
      applyBuildingFx(e, !preset?.playback);
      if (e === selected) {
        anim.show(e.anim, e.actor);
        renderBuildingPanel();
      }
      return;
    }
    // Loadouts can attach a Workshop taunt animation. Restore custom poses only
    // after that work finishes, so a later bake cannot replace the saved pose.
    if (e === selected) {
      await itemsUi.onClassChanged();
      if (token !== e.showToken || !entities.includes(e)) return;
      if (e === selected) await weapons.onClassChanged();
    } else {
      await applyLoadout(e, e.applied);
    }
    if (token !== e.showToken || !entities.includes(e)) return;
    if (!preset) {
      playWeaponAnimation(e, e.held);
      await applyUnusuals(e);
      return;
    }
    // a copy runs in step with the original; a restored scene resumes its clock
    const from = preset.playback?.();
    if (from) {
      const to = e.actor.playback;
      to.time = from.time;
      to.speed = from.speed;
      to.loopAll = from.loopAll;
      to.playing = from.playing;
    }
    if (e.actor.inspectOnly && !from) e.actor.playback.playing = false; // an item opened alone starts paused
    const posed = preset.pose ? posedFromScene(e, preset.pose) : undefined;
    if (posed) {
      // Background actors keep their pose without taking over the visible rig.
      if (preset.pose?.editing !== false && e === selected) v.usePose(e.actor, posed);
      else {
        e.actor.usePose(posed);
        if (preset.pose?.editing === false) e.actor.endPose();
      }
    }
    if (e === selected) {
      anim.show(e.anim, e.actor);
      syncPoseUi();
    }
    await applyUnusuals(e);
  }

  // --- the list of characters ----------------------------------------------------------------------------------

  /** Saves what the panels show into the character they were editing. */
  function saveUi(e: Entity) {
    e.items = itemsUi.getState();
    e.held = weapons.getHeld();
    e.flex = flex.state();
  }

  // --- body groups: which model each part of the character shows ---------------------------------------------------

  const bodyBox = document.getElementById("bodyGroups") as HTMLElement | null;
  const bodyReset = document.getElementById("bodyReset") as HTMLButtonElement | null;

  /** One drop-down per body part that has more than one model, showing what is set (by hand, else by a cosmetic, else the default). */
  function renderBodygroups() {
    if (!bodyBox) return;
    bodyBox.replaceChildren();
    const e = selected;
    const data = e ? models.get(classPath(e.cls)) : null;
    const parts = data?.bodyParts.filter((bp) => bp.models.length > 1) ?? [];
    if (bodyReset) bodyReset.disabled = !e || e.bodyManual.size === 0;
    if (!e || !data || parts.length === 0) {
      const none = document.createElement("div");
      none.className = "dim hint";
      none.textContent = data ? "This model has no body groups." : "";
      bodyBox.appendChild(none);
      return;
    }
    for (const bp of parts) {
      const key = bp.name.toLowerCase();
      const label = document.createElement("label");
      label.textContent = bp.name.replace(/_/g, " ");
      label.title = bp.name;
      const count = bp.models.length;
      const manual = e.bodyManual.get(key);
      const current = Math.min(Math.max(0, manual ?? e.bodyItems[key] ?? e.bodyItems[bp.name] ?? 0), count - 1);
      const stepper = document.createElement("div");
      stepper.className = "stepper" + (manual !== undefined ? " manual" : "");
      stepper.title = manual !== undefined ? "Set by hand" : key in e.bodyItems ? "Set by a cosmetic" : "Default";
      const step = (by: number) => {
        e.bodyManual.set(key, (current + by + count) % count);
        applyBodygroups(e);
        renderBodygroups();
      };
      const arrow = (text: string, by: number) => {
        const b = document.createElement("button");
        b.textContent = text;
        b.onclick = () => step(by);
        return b;
      };
      const value = document.createElement("span");
      value.textContent = String(current);
      stepper.append(arrow("‹", -1), value, arrow("›", 1));
      bodyBox.append(label, stepper);
    }
  }

  async function applyBodygroups(e: Entity) {
    const merged = { ...e.bodyItems, ...Object.fromEntries(e.bodyManual) };
    await ensureGroupMaterials(e, merged); // the model a group switches on may bring materials that are not loaded yet
    e.actor.setBodygroups(merged);
  }
  if (bodyReset) {
    bodyReset.onclick = () => {
      const e = selected;
      if (!e) return;
      e.bodyManual.clear();
      applyBodygroups(e);
      renderBodygroups();
    };
  }

  // --- effects: the conditions that change how a character looks (Jarate, Ubercharge, fire, ...) -------------------------------

  const condBox = document.getElementById("conditions") as HTMLElement | null;
  const condReset = document.getElementById("condReset") as HTMLButtonElement | null;

  /** One toggle per condition for the selected character; what the character is in right now (by hand or by Play mode) is what shows. */
  function renderConditions() {
    if (!condBox) return;
    condBox.replaceChildren();
    const e = selected;
    if (condReset) condReset.disabled = !e || !anyCondition(e.actor.conditions);
    if (!e) return;
    for (const key of CONDITION_KEYS) {
      const only = CONDITION_CLASS[key];
      if (only && gameClassOf(e.cls) !== only && !e.actor.conditions[key]) continue;
      const b = document.createElement("button");
      b.textContent = CONDITION_LABELS[key];
      b.classList.toggle("on", e.actor.conditions[key]);
      b.setAttribute("aria-pressed", String(e.actor.conditions[key]));
      b.onclick = () => setCondition(e, key, !e.actor.conditions[key]);
      condBox.appendChild(b);
    }
  }

  /** Loads the Ubercharge materials when a character needs them, and starts or stops the particles of its conditions. */
  async function syncConditions(e: Entity) {
    const v = viewer;
    if (!v) return;
    if (e.actor.conditions.uber) {
      const paths = [0, 1].map((team) => `materials/${uberMaterialPath(team)}.vmt`);
      await loadMaterials(paths);
      if (!entities.includes(e)) return;
      e.actor.setUberMaterials(materials.get(paths[0]) ?? null, materials.get(paths[1]) ?? null);
    }
    v.syncConditionParticles(e.actor);
  }

  function setCondition(e: Entity, key: ConditionKey, on: boolean) {
    const v = ensureViewer();
    v.setConditions(e.actor, { ...e.actor.conditions, [key]: on });
    void syncConditions(e);
    if (e === selected) renderConditions();
  }
  if (condReset) {
    condReset.onclick = () => {
      const e = selected;
      if (!e) return;
      ensureViewer().setConditions(e.actor, parseConditions(null));
      renderConditions();
    };
  }

  // --- level of detail: the selected character and everything it wears, at LOD 0, 1, 2 ... ---------------------------------------------

  const lodBox = document.getElementById("lodBar") as HTMLElement | null;
  /** Models read at a LOD other than 0, by path and LOD (the model at its own last LOD when it has fewer). */
  async function modelAtLod(path: string, lod: number): Promise<ModelData> {
    if (lod <= 0) { const base = models.get(path); if (base) return base; }
    const key = `${path}@${lod}`;
    let data = models.get(key);
    if (!data) {
      data = parsePayload(await loadModel(path, lod));
      models.set(key, data);
    }
    return data;
  }

  /** Draws the class of a character at its LOD (the cosmetics follow through applyLoadout). */
  async function applyClassLod(e: Entity) {
    const path = classPath(e.cls);
    const lod = e.lod;
    if (lod <= 0) { e.actor.setClassLod(null); if (e === selected) renderLod(); return; }
    try {
      const data = await modelAtLod(path, lod);
      await ensureClassMaterials(e, data);
      await ensureGroupMaterials(e, { ...e.bodyItems, ...Object.fromEntries(e.bodyManual) });
      if (e.lod === lod && entities.includes(e)) e.actor.setClassLod(data);
    } catch (err) {
      console.error("Could not read the LOD of", path, err);
    }
    if (e === selected) renderLod();
  }

  async function setEntityLod(e: Entity, lod: number) {
    if (e.lod === lod) return;
    e.lod = lod;
    renderLod();
    await applyClassLod(e);
    // the item being built shows its own LOD too
    if (compilerOn && e === selected) compiler.selectionChanged();
    await applyLoadout(e, e.applied);
  }

  /** The LOD buttons: as many as the selected class has (an item being built has three). */
  function renderLod() {
    if (!lodBox) return;
    lodBox.replaceChildren();
    const e = selected;
    const base = e ? models.get(classPath(e.cls)) : null;
    if (!e || !base) { lodBox.hidden = true; return; }
    const count = Math.max(base.lodCount, compilerOn ? 3 : 1);
    lodBox.hidden = count < 2;
    if (count < 2) return;
    const title = document.createElement("div");
    title.className = "lodTitle";
    title.textContent = "Level of detail";
    const buttons = document.createElement("div");
    buttons.className = "lodButtons";
    for (let i = 0; i < count; i++) {
      const b = document.createElement("button");
      b.textContent = String(i);
      b.classList.toggle("on", Math.min(e.lod, count - 1) === i);
      b.title = i === 0 ? "The full model" : `LOD ${i}: what the game draws at a distance; the cosmetics follow`;
      b.onclick = () => void setEntityLod(e, i);
      buttons.appendChild(b);
    }
    lodBox.append(title, buttons);
  }

  // The character parts picker: which parts of the selected character are drawn.
  const bodyTools = document.getElementById("viewTools");
  const bodyPicker = bodyTools
    ? createBodyPicker(bodyTools, {
        get: () => selected?.actor.visibleRegions ?? new Set<string>(),
        groups: () => selected?.actor.bodyGroups ?? [],
        set: (parts) => selected?.actor.setVisibleRegions(parts),
        beginSelect: () => (selected && viewer ? viewer.beginSelect(selected.actor) : null),
        viewStamp: () => (viewer ? viewer.camera.matrixWorld.elements.join(",") + "," + viewer.camera.fov + "," + viewer.camera.aspect : ""),
        hasBoxMask: () => selected?.actor.hasHandMask ?? false,
        clearBoxMask: () => selected?.actor.setHandMaskState(undefined),
      })
    : null;

  // --- the textures of the worn cosmetics (diffuse, normal, exponent mask) under the body groups ---
  const texHost = document.getElementById("texView");
  const texPreview = texHost ? createTexturePreview(texHost) : null;

  function refreshTextures() {
    if (!texPreview) return;
    const e = selected;
    const items: PreviewItem[] = [];
    const counts: { name: string; tris: number; verts: number }[] = [];
    if (e) {
      const cls = gameClassOf(e.cls);
      for (const { item, style } of e.applied) {
        const path = itemModelFor(item, cls, style);
        const data = path ? models.get(path) : undefined;
        if (!data) continue;
        let tris = 0, verts = 0;
        for (const bp of data.bodyParts) for (const m of bp.models[0]?.meshes ?? []) {
          tris += m.indices.length / 3;
          verts += m.positions.length / 3;
        }
        counts.push({ name: item.displayName, tris, verts });
        const skin = itemSkinFor(item, e.team, style) ?? e.team;
        const seen = new Set<string>();
        const list: PreviewItem["materials"] = [];
        for (const bp of data.bodyParts) {
          for (const m of bp.models[0]?.meshes ?? []) {
            const p = m.materials[skin] ?? m.material;
            if (!m.indices.length) continue;
            const mat = materials.get(p);
            if (!mat) continue;
            let entry = seen.has(p) ? list.find((x) => x.path === p) : undefined;
            if (!entry) {
              seen.add(p);
              entry = { path: p, textures: { base: mat.textures.base, bump: mat.textures.bump, exponent: mat.textures.exponent }, meshes: [] };
              list.push(entry);
            }
            entry.meshes.push({ uvs: m.uvs, indices: m.indices });
          }
        }
        if (list.length) items.push({ label: item.displayName, materials: list });
      }
    }
    texPreview.show(items);
    showCosmeticStats(counts);
  }

  /** The triangle and vertex counts of the worn cosmetics (the first model of each of their body parts), one line each and a total. */
  function showCosmeticStats(counts: { name: string; tris: number; verts: number }[]) {
    const box = document.getElementById("cosmeticStats");
    if (!box) return;
    box.replaceChildren();
    if (counts.length === 0) return;
    const head = document.createElement("h3");
    head.textContent = "Cosmetics";
    box.appendChild(head);
    const n = (v: number) => Math.round(v).toLocaleString();
    for (const c of counts) {
      const row = document.createElement("div");
      row.className = "cosRow";
      const name = document.createElement("span");
      name.textContent = c.name;
      name.title = c.name;
      const value = document.createElement("span");
      value.textContent = `${n(c.tris)} tris`;
      value.title = `${n(c.verts)} vertices`;
      row.append(name, value);
      box.appendChild(row);
    }
    if (counts.length > 1) {
      const row = document.createElement("div");
      row.className = "cosRow total";
      const name = document.createElement("span");
      name.textContent = "Total";
      const value = document.createElement("span");
      value.textContent = `${n(counts.reduce((t, c) => t + c.tris, 0))} tris`;
      value.title = `${n(counts.reduce((t, c) => t + c.verts, 0))} vertices`;
      row.append(name, value);
      box.appendChild(row);
    }
  }

  /** Makes the panels show a character. */
  function restoreUi(e: Entity) {
    if (compilerOn) compiler.selectionChanged();
    syncUnusuals();
    renderBodygroups();
    renderLod();
    renderConditions();
    bodyPicker?.sync();
    itemsUi.load(e.items);
    weapons.load(e.held);
    flex.restore(e.flex, models.get(classPath(e.cls)) ?? null);
    renderBuildingPanel();
    anim.show(e.anim, e.actor);
    syncPoseUi();
    markSelected();
    markTeams();
    refreshTextures();
  }

  /** A character that was just added is the whole selection (not added to what was selected). */
  function soleSelection(e: Entity) {
    nothingSelected = false;
    propsKind = "character";
    multi = new Set([e.id]);
    selLights = new Set();
    selCameras = new Set();
  }

  function selectEntity(e: Entity, keepMulti = false) {
    nothingSelected = false;
    if (propsKind !== "character") propsKind = "character";
    if (!keepMulti) {
      multi = new Set([e.id]);
      selLights = new Set();
      selCameras = new Set();
    }
    if (selected === e) {
      renderEntities();
      return;
    }
    stopPlay();
    if (selected) saveUi(selected);
    selected = e;
    viewer?.select(e.actor);
    restoreUi(e);
    renderEntities();
  }

  const entityById = (id: number) => entities.find((e) => e.id === id);
  const entityLabel = (e: Entity) => e.name || `${entities.indexOf(e) + 1}  ${classLabelOf(e.cls)}`;

  // --- properties: the panel under the outliner shows what the selected character, light or camera has ---------------------------

  type PropsKind = "character" | "light" | "camera" | "effect" | "overlay";
  let propsKind: PropsKind = "character";
  /** Who the cosmetic picks go to, and their classes, as last shown by the browser. */
  let lastTargetKey = "";
  /** The ids of the selected characters (several with Shift or Ctrl in the outliner); always holds the selected one. */
  let multi = new Set<number>();
  /** Nothing is selected (a click on empty space): no outline, no highlight, no gizmo. The last character stays the one the other panels (animation, cosmetics) work on. */
  let nothingSelected = false;
  /** The selected lights and cameras (they can be selected together with characters). */
  let selLights = new Set<string>();
  let selCameras = new Set<string>();
  /** The camera whose settings the panel shows. */
  let propsCamera = "";
  /** The id of the post-processing effect whose settings the panel shows. */
  let propsEffect = "";
  /** The post-processing effects of the scene (a new scene has the ground shadow). */
  let postItems: PostItem[] = [{ id: "post-1", kind: "shadow", state: { ...DEFAULT_SHADOW } }];
  const propsEl = (id: string) => document.getElementById(id)!;
  const RAD = Math.PI / 180;
  const LIGHT_UNIT_RANGE = 250;
  const characterTransform = createTransformFields({
    position: ([x, y, z]) => {
      const e = selected;
      if (e) ensureViewer().placeActor(e.actor, x, y, z, e.actor.yaw);
    },
    rotation: ([pitch, yaw, roll]) => {
      const e = selected;
      if (!e) return;
      const a = e.actor;
      ensureViewer().placeActor(a, a.offset.x, a.offset.y, a.offset.z, yaw * RAD);
      a.setTilt(pitch * RAD, roll * RAD);
    },
    scale: ([x, y, z]) => {
      const e = selected;
      if (!e) return;
      const a = e.actor;
      a.setScale(new THREE.Vector3(x, y, z));
      ensureViewer().placeActor(a, a.offset.x, a.offset.y, a.offset.z, a.yaw); // the gizmo takes the new size
    },
  });
  const lightTransform = createTransformFields({
    position: (value) => lightingUi?.edit((l) => { l.position = value; }),
    rotation: ([elevation, azimuth]) => lightingUi?.edit((l) => {
      l.elevation = Math.max(-90, Math.min(90, elevation));
      l.azimuth = ((azimuth % 360) + 360) % 360;
    }),
    // the size of a point or spot light is its radius: 1 is the radius a new light has
    scale: (value) => lightingUi?.edit((l) => {
      if (l.type === "directional") return;
      const now = l.range / LIGHT_UNIT_RANGE;
      const next = value.find((v) => Math.abs(v - now) > 1e-6) ?? value[0];
      l.range = Math.min(5000, Math.max(1, next * LIGHT_UNIT_RANGE));
    }),
  });
  let cameraTransformEl: HTMLElement | null = null;

  // --- the overlay of the camera that is looked through: its list is a panel, its settings are in the properties ---------------------
  const overlayPanel = createOverlayPanel({
    list: propsEl("overlayList"),
    add: propsEl("overlayAdd") as HTMLButtonElement,
    edit: propsEl("overlayEdit") as HTMLButtonElement,
    hint: propsEl("overlayHint"),
    grid: propsEl("overlayGrid"),
    overlay: () => viewer?.cameraOverlay ?? null,
    cameraActive: () => !!viewer?.cameras.active,
    toggle: () => {
      const rig = viewer?.cameras;
      if (!rig?.active) return;
      if (rig.overlayEditing) rig.stopOverlayEditing();
      else { prepareCamera(); rig.editOverlay(rig.active); }
    },
  });
  /** The overlay editing started or ended: the properties show its settings (and go back to the camera's when it ends), and the panels come forward. */
  function syncOverlayMode() {
    const editing = !!viewer?.cameraOverlay.isEditing;
    if (editing && propsKind !== "overlay") {
      propsKind = "overlay";
      nothingSelected = false;
      els.reveal("properties");
      renderEntities();
    } else if (!editing && propsKind === "overlay") {
      propsKind = "camera";
      renderEntities();
    }
  }

  /** Looks through a camera (making it the picked one), or comes back out when the view already is through it. */
  /** Looks through a camera, or leaves its view; with `select` the camera is also selected (the outliner button), without it the selection stays as it is (the camera button of the view). */
  function lookThroughCamera(id: string, select = true) {
    const rig = ensureViewer().cameras;
    if (select) {
      nothingSelected = false;
      propsKind = "camera";
      propsCamera = id;
      renderCameraUi.select(id);
      selCameras = new Set([...selCameras, id]);
    }
    if (rig.active === id) rig.exit();
    else {
      prepareCamera();
      rig.view(id);
    }
    renderEntities();
  }

  /** The camera that the camera button of the view goes to: the last one that was picked, else the last one there is. */
  function lastCamera(): string | null {
    const cameras = viewer?.cameras.cameras ?? [];
    return cameras.find((c) => c.id === propsCamera)?.id ?? cameras.at(-1)?.id ?? null;
  }

  /** Puts the values of the selected thing into the location and rotation fields. */
  function syncTransform() {
    if (propsKind === "character") {
      const a = selected?.actor;
      characterTransform.set(a ? { position: [a.offset.x, a.offset.y, a.offset.z], rotation: [a.pitch / RAD, a.yaw / RAD, a.roll / RAD], scale: a.scale.toArray() } : { position: null, rotation: null });
    } else if (propsKind === "light") {
      const l = lightingUi?.selected();
      lightTransform.set(l
        ? { position: l.type === "directional" ? null : [...l.position], rotation: l.type === "point" ? null : [l.elevation, l.azimuth, 0], rotationAxes: [true, true, false], scale: l.type === "directional" ? null : [l.range / LIGHT_UNIT_RANGE, l.range / LIGHT_UNIT_RANGE, l.range / LIGHT_UNIT_RANGE] }
        : { position: null, rotation: null });
    }
  }

  /** Shows the part of the panel for what is selected. */
  function applyProps() {
    if (viewer) viewer.lightDragEnabled = propsKind === "light";
    const building = !!selected && isBuildingCls(selected.cls);
    propsEl("propChar").hidden = nothingSelected || propsKind !== "character";
    propsEl("propLight").hidden = nothingSelected || propsKind !== "light";
    propsEl("propCamera").hidden = nothingSelected || propsKind !== "camera";
    propsEl("propEffect").hidden = propsKind !== "effect";
    propsEl("overlayProps").hidden = propsKind !== "overlay";
    const effectKind = postItems.find((i) => i.id === propsEffect)?.kind;
    for (const section of propsEl("propEffect").querySelectorAll<HTMLElement>("[data-effect]")) section.hidden = section.dataset.effect !== effectKind;
    propsEl("propEmpty").hidden = !nothingSelected || propsKind === "effect" || propsKind === "overlay";
    characterTransform.el.hidden = nothingSelected || propsKind !== "character";
    lightTransform.el.hidden = nothingSelected || propsKind !== "light";
    if (cameraTransformEl) cameraTransformEl.hidden = nothingSelected || propsKind !== "camera";
    // a building has no class, bodygroups, level of detail or effects
    for (const id of ["classBlock", "bodyBlock", "effectsBlock"]) propsEl(id).hidden = building;
    els.focusFace.hidden = building;
    syncTransform();
  }

  function setPropsKind(kind: PropsKind) {
    propsKind = kind;
    renderEntities();
  }

  setInterval(() => {
    if (!propsEl("view").hidden) syncTransform();
  }, 200);

  {
    // the camera settings and transform live in the properties panel; the list that came with them is the outliner now
    const root = document.getElementById("camerasPane")!;
    cameraTransformEl = root.querySelector<HTMLElement>(".cameraTransforms")!;
    propsEl("propTransform").append(characterTransform.el, lightTransform.el, cameraTransformEl);
    propsEl("propCamera").append(root.querySelector(".cameraSettings")!, ...root.querySelectorAll(".cameraNavigation"), root.querySelector("[data-status]")!);
  }

  /** Moves whatever gizmo is showing (a character's, a light's, a camera's) to this light or camera. */
  function gizmoToTarget(kind: "light" | "camera", id: string) {
    gizmoEntity = null;
    viewer?.setActorGizmo(null);
    if (kind === "camera") {
      viewer?.hideLightMarker();
      // (editing a camera with its gizmo leaves the view: while the view is through a camera, picking one only selects it)
      if (viewer?.cameras.active) viewer.cameras.stopEditing();
      else viewer?.cameras.edit(id, viewer.cameras.parts.rotate && !viewer.cameras.parts.move ? "rotate" : "translate", false);
    } else {
      viewer?.cameras.stopEditing();
      viewer?.selectLight(id);
    }
    applyGizmoParts();
  }

  /** Makes these characters, lights and cameras the selection; `primary` is the one the properties show. */
  function selectPicks(picks: Pick[], primary: Pick, blink: Pick[] = []) {
    nothingSelected = false;
    const before = new Set(currentPicks().map(pickKey));
    const beforePrimary = currentPrimary();
    const gizmoHad = gizmoWanted();
    const chars = picks.filter((p) => p.kind === "character").map((p) => Number(p.id)).filter((id) => entityById(id));
    multi = new Set(chars);
    selLights = new Set(picks.filter((p) => p.kind === "light").map((p) => p.id));
    selCameras = new Set(picks.filter((p) => p.kind === "camera").map((p) => p.id));
    if (primary.kind === "character") {
      const e = entityById(Number(primary.id));
      if (!e) return;
      selectEntity(e, true);
      multi.add(e.id);
    } else if (primary.kind === "light") {
      propsKind = "light";
      lightingUi?.select(primary.id);
    } else {
      propsKind = "camera";
      propsCamera = primary.id;
      renderCameraUi.select(primary.id);
    }
    // A gizmo that was showing goes to the selection, and selecting a light brings its gizmo up. With a character in the selection the
    // gizmo is that character's, and it carries the lights and cameras that are selected too (otherwise a light selected along with
    // characters would have a gizmo of its own that moves only the light).
    if (gizmoHad || primary.kind === "light") {
      const lead = primary.kind === "character" ? entityById(Number(primary.id)) : entities.find((e) => multi.has(e.id));
      if (lead) gizmoOnCharacter(lead);
      else if (primary.kind !== "character") gizmoToTarget(primary.kind, primary.id);
      restoreArmed();
    }
    renderEntities();
    // what was newly selected (and the thing that became the primary) blinks; a box asks for all it covered to blink
    const fresh = [...picks.filter((p) => !before.has(pickKey(p))), ...(!beforePrimary || pickKey(beforePrimary) !== pickKey(primary) ? [primary] : []), ...blink];
    const seen = new Set<string>();
    const blinking = fresh.filter((p) => !seen.has(pickKey(p)) && seen.add(pickKey(p)));
    const actors = blinking.flatMap((p) => { const e = p.kind === "character" ? entityById(Number(p.id)) : undefined; return e ? [e.actor] : []; });
    if (actors.length) viewer?.flash(actors);
    const markers = blinking.filter((p) => p.kind !== "character").map((p) => ({ kind: p.kind as "light" | "camera", id: p.id }));
    if (markers.length) viewer?.flashMarkers(markers);
  }

  /** What Ctrl + C (or Copy in the outliner) took: characters, lights and cameras, pasted as copies. */
  let clipboard: Pick[] = [];
  let pasting = false;
  /** Adds a copy of everything on the clipboard, and selects the copies. */
  async function pasteClipboard() {
    if (pasting || !clipboard.length) return;
    pasting = true;
    try {
      const v = ensureViewer();
      const made: Pick[] = [];
      for (const p of clipboard) {
        if (p.kind === "character") {
          const e = entityById(Number(p.id));
          if (!e) continue;
          selectEntity(e);
          const before = new Set(entities.map((x) => x.id));
          await addEntity(true, false);
          const fresh = entities.find((x) => !before.has(x.id));
          if (fresh) made.push({ kind: "character", id: String(fresh.id) });
        } else if (p.kind === "light") {
          for (const id of lightingUi?.duplicate([p.id]) ?? []) made.push({ kind: "light", id });
        } else if (p.kind === "camera") {
          const copy = v.cameras.duplicate(p.id);
          if (copy) made.push({ kind: "camera", id: copy.id });
        }
      }
      if (made.length) selectPicks(made, made[made.length - 1]);
      renderEntities();
      recordAdd("Paste", made);
    } finally { pasting = false; }
  }
  window.addEventListener("keydown", (ev) => {
    if (ev.defaultPrevented) return;
    const copy = hotkeyMatches("edit.copy", ev);
    if (!copy && !hotkeyMatches("edit.paste", ev)) return;
    const target = ev.target as HTMLElement | null;
    if (target?.isContentEditable || (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    // text that is selected somewhere is the browser's to copy
    if (copy && (window.getSelection()?.toString().length ?? 0) > 0) return;
    if (document.getElementById("view")?.hidden || play?.active || viewer?.cameras.overlayEditing || viewer?.cameras.editing || selected?.actor.isPosing) return;
    ev.preventDefault();
    if (copy) { if (!nothingSelected) clipboard = currentPicks().map((p) => ({ ...p })); }
    else void pasteClipboard();
  });

  // --- undo of what the scene is made of -------------------------------------------------------------------

  /** A thing taken out of the scene, with all it takes to put it back. */
  type Captured =
    | { kind: "character"; id: number; index: number; data: SceneEntity; history: PlacementHistory | null }
    | { kind: "light"; id: string; index: number; light: RigLight }
    | { kind: "camera"; id: string; index: number; camera: SceneCamera };

  function capturePick(p: Pick): Captured | null {
    if (p.kind === "character") {
      const e = entityById(Number(p.id));
      if (!e) return null;
      return { kind: "character", id: e.id, index: entities.indexOf(e), data: serializeEntity(e), history: ensureViewer().takePlacementHistory(e.actor) };
    }
    if (p.kind === "light") {
      const c = lightingUi?.capture(p.id);
      return c ? { kind: "light", id: p.id, index: c.index, light: c.light } : null;
    }
    const c = ensureViewer().cameras.capture(p.id);
    return c ? { kind: "camera", id: p.id, index: c.index, camera: c.camera } : null;
  }
  const stillThere = (c: Captured) =>
    c.kind === "character" ? !!entityById(c.id) : c.kind === "light" ? currentLights().lights.some((l) => l.id === c.id) : !!viewer?.cameras.cameras.some((x) => x.id === c.id);
  const capturePicks = (picks: Pick[]) => picks.flatMap((p) => { const c = capturePick(p); return c ? [c] : []; });

  /** Takes things out again (the redo of a deletion; undo of an addition). */
  function removeCaptured(caps: Captured[]) {
    for (const c of caps) if (c.kind === "character") { const e = entityById(c.id); if (e) removeEntity(e); }
    for (const c of caps.filter((x) => x.kind === "light").reverse()) lightingUi?.remove(c.id);
    for (const c of caps) if (c.kind === "camera") ensureViewer().cameras.remove(c.id);
    renderEntities();
  }

  /** Puts things back where they were: characters get their model, pose and place again (and the history of their placement). */
  async function reinstate(caps: Captured[]) {
    const v = ensureViewer();
    const chars = caps.filter((c): c is Extract<Captured, { kind: "character" }> => c.kind === "character").sort((a, b) => a.index - b.index);
    if (chars.length) {
      const { byId, paints } = await itemLookups();
      for (const c of chars) {
        if (entityById(c.id)) continue;
        const e = buildEntity(c.data, byId, paints, c.id);
        entities.splice(Math.min(c.index, entities.length), 0, e);
        nextEntity = Math.max(nextEntity, e.id + 1);
        renderEntities();
        await showSaved(e, c.data);
        if (c.history) v.givePlacementHistory(e.actor, c.history);
      }
    }
    for (const c of caps) if (c.kind === "light") lightingUi?.insert(c.light, c.index);
    for (const c of caps) if (c.kind === "camera") v.cameras.insert(c.camera, c.index);
    const picks = caps.filter((c) => stillThere(c)).map((c): Pick => ({ kind: c.kind, id: String(c.id) }));
    renderEntities();
    if (picks.length) selectPicks(picks, picks[picks.length - 1]);
    v.focusAll();
  }

  /** What the outliner shows of the things in it, that edits of the outliner change (the folders, the order, the names ...). */
  interface Structure {
    groups: HierarchyGroup[];
    order: number[];
    chars: Map<number, { name?: string; hidden: boolean; group?: string }>;
    lights: Map<string, { name: string; enabled: boolean; group?: string }>;
    cameras: Map<string, { name: string; group?: string }>;
  }
  function structure(): Structure {
    return {
      groups: groups.map((g) => ({ ...g })),
      order: entities.map((e) => e.id),
      chars: new Map(entities.map((e) => [e.id, { name: e.name, hidden: !!e.hidden, group: e.group }])),
      lights: new Map(currentLights().lights.map((l) => [l.id, { name: l.name, enabled: l.enabled !== false, group: l.group }])),
      cameras: new Map((viewer?.cameras.cameras ?? []).map((c) => [c.id, { name: c.name, group: c.group }])),
    };
  }
  /** Puts what is still in the scene the way a snapshot has it. */
  function applyStructure(s: Structure) {
    groups = s.groups.map((g) => ({ ...g }));
    for (const e of entities) {
      const was = s.chars.get(e.id);
      if (was) { e.name = was.name; e.hidden = was.hidden; e.group = was.group; }
    }
    const rank = new Map(s.order.map((id, i) => [id, i]));
    entities.sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9));
    for (const l of currentLights().lights) {
      const was = s.lights.get(l.id);
      if (!was) continue;
      if (l.name !== was.name) lightingUi?.rename(l.id, was.name);
      if ((l.enabled !== false) !== was.enabled) lightingUi?.setEnabled(l.id, was.enabled);
      if (l.group !== was.group) lightingUi?.setGroup([l.id], was.group);
    }
    const rig = viewer?.cameras;
    if (rig) {
      for (const c of rig.cameras) {
        const was = s.cameras.get(c.id);
        if (!was) continue;
        c.name = was.name;
        if (was.group) c.group = was.group; else delete c.group;
      }
      rig.refresh();
    }
    renderEntities();
  }

  /** Records an edit that something else did: its undo puts the snapshot back, its redo puts the snapshot of after back. */
  function recordStructure(label: string, before: Structure) {
    const after = structure();
    editHistory.push({ label, undo: () => applyStructure(before), redo: () => applyStructure(after) });
  }

  /** Records what was added (the undo takes it out again, the redo puts it back as it was). */
  function recordAdd(label: string, picks: Pick[]) {
    if (!picks.length) return;
    let caps: Captured[] = []; // taken when it is undone: by then the model is loaded
    editHistory.push({
      label,
      undo: () => { caps = capturePicks(picks); removeCaptured(caps); },
      redo: () => reinstate(caps),
    });
  }

  /** The hooks of the outliner, with every edit they make recorded for undo. */
  function withUndo(raw: HierarchyHooks): HierarchyHooks {
    const edit = <A extends unknown[]>(label: string | ((...a: A) => string), fn: (...a: A) => void) => (...a: A) => {
      const before = structure();
      fn(...a);
      recordStructure(typeof label === "string" ? label : label(...a), before);
    };
    /** A deletion: what goes is captured, the undo puts it back and then the folders as they were; the redo deletes it again. */
    const deletion = (label: string, picks: Pick[], run: () => void) => {
      const before = structure();
      const caps = capturePicks(picks);
      run();
      const gone = caps.filter((c) => !stillThere(c));
      if (!gone.length && JSON.stringify(before.groups) === JSON.stringify(groups)) return;
      const after = structure();
      editHistory.push({
        label,
        undo: async () => { await reinstate(gone); applyStructure(before); },
        redo: () => { run(); applyStructure(after); },
      });
    };
    const named = (picks: Pick[]) => (picks.length === 1 ? { character: "model", light: "light", camera: "camera" }[picks[0].kind] : "items");
    return {
      ...raw,
      rename: edit((p) => `Rename ${p.kind}`, raw.rename),
      setOff: edit((picks, off) => (off ? "Hide" : "Show") + " " + named(picks), raw.setOff),
      move: edit("Move", raw.move),
      renameGroup: edit("Rename folder", raw.renameGroup),
      toggleGroupHidden: edit("Hide folder", raw.toggleGroupHidden),
      nestGroup: edit("Move folder", raw.nestGroup),
      newGroup: (parent) => {
        const before = structure();
        const id = raw.newGroup(parent);
        recordStructure("Add folder", before);
        return id;
      },
      remove: (picks) => deletion("Delete " + named(picks), picks, () => raw.remove(picks)),
      removeGroup: (id, withContents) => {
        const inside = withDescendants(groups, id);
        const picks: Pick[] = withContents
          ? [
              ...entities.filter((e) => e.group && inside.has(e.group)).map((e): Pick => ({ kind: "character", id: String(e.id) })),
              ...currentLights().lights.filter((l) => l.group && inside.has(l.group)).map((l): Pick => ({ kind: "light", id: l.id })),
              ...(viewer?.cameras.cameras ?? []).filter((c) => c.group && inside.has(c.group)).map((c): Pick => ({ kind: "camera", id: c.id })),
            ]
          : [];
        deletion("Delete folder", picks, () => raw.removeGroup(id, withContents));
      },
    };
  }

  let hierarchyView: ReturnType<typeof createHierarchy> | null = null;
  let outlinerHooks: HierarchyHooks | null = null;
  const hierarchy = () => (hierarchyView ??= createHierarchy(els.entities.list, (outlinerHooks = withUndo({
    select: selectPicks,
    rename: (pick, name) => {
      if (pick.kind === "character") {
        const e = entityById(Number(pick.id));
        if (e) e.name = name || undefined;
        renderEntities();
      } else if (!name) return;
      else if (pick.kind === "light") lightingUi?.rename(pick.id, name);
      else {
        const rig = ensureViewer().cameras;
        const camera = rig.cameras.find((c) => c.id === pick.id);
        if (camera) camera.name = name;
        rig.refresh();
      }
    },
    setOff: (picks, off) => {
      let changed = false;
      for (const p of picks) {
        if (p.kind !== "character") continue;
        const e = entityById(Number(p.id));
        if (e) { e.hidden = off; changed = true; }
      }
      for (const p of picks) if (p.kind === "light") lightingUi?.setEnabled(p.id, !off);
      if (changed) renderEntities();
    },
    toggleFog: (id) => {
      const e = entityById(id);
      if (e) e.actor.fogged = !e.actor.fogged;
      renderEntities();
    },
    clearParticles: (id) => {
      const e = entityById(id);
      if (e) viewer?.clearWeaponEffects(e.actor);
      renderEntities();
    },
    lookThrough: (id) => lookThroughCamera(id),
    remove: (picks) => {
      for (const p of picks) {
        if (p.kind !== "character") continue;
        const e = entityById(Number(p.id));
        if (e) removeEntity(e);
      }
      // lights are numbered by their place in the list: the last ones go first, so the numbers of the others stay
      const lightIds = picks.filter((p) => p.kind === "light").map((p) => p.id).sort((a, b) => Number(b.replace(/\D/g, "")) - Number(a.replace(/\D/g, "")));
      for (const id of lightIds) lightingUi?.remove(id);
      for (const p of picks) if (p.kind === "camera") ensureViewer().cameras.remove(p.id);
    },
    copy: (picks) => { clipboard = picks.map((p) => ({ ...p })); },
    paste: () => void pasteClipboard(),
    canPaste: () => clipboard.length > 0,
    frame: (id) => {
      const e = entityById(id);
      if (!e) return;
      selectEntity(e);
      viewer?.focusBody(true);
    },
    move: (picks, group, anchor) => {
      const ids = picks.filter((p) => p.kind === "character").map((p) => Number(p.id));
      const moved = entities.filter((e) => ids.includes(e.id));
      for (const e of moved) e.group = group;
      const target = anchor ? entityById(anchor.id) : undefined;
      if (target && !moved.includes(target)) {
        // in the list the moved characters keep their order and sit right before (or after) the one they were dropped on
        const rest = entities.filter((e) => !moved.includes(e));
        rest.splice(rest.indexOf(target) + (anchor!.after ? 1 : 0), 0, ...moved);
        entities.splice(0, entities.length, ...rest);
      }
      const lightIds = picks.filter((p) => p.kind === "light").map((p) => p.id);
      if (lightIds.length) lightingUi?.setGroup(lightIds, group);
      const cameraIds = picks.filter((p) => p.kind === "camera").map((p) => p.id);
      if (cameraIds.length) {
        const rig = ensureViewer().cameras;
        for (const c of rig.cameras) if (cameraIds.includes(c.id)) { if (group) c.group = group; else delete c.group; }
        rig.refresh();
      }
      renderEntities();
    },
    newGroup: (parent) => {
      const id = crypto.randomUUID();
      groups = [...groups, { id, name: newGroupName(groups), ...(parent ? { parent } : {}) }];
      renderEntities();
      return id;
    },
    renameGroup: (id, name) => {
      groups = groups.map((g) => (g.id === id ? { ...g, name } : g));
      renderEntities();
    },
    toggleGroupHidden: (id) => {
      const now = !groups.find((g) => g.id === id)?.hidden;
      groups = groups.map((g) => (g.id === id ? { ...g, hidden: now } : g));
      // hiding a folder also turns the lights in it (and in the folders inside it) off; showing it turns them on
      const inside = withDescendants(groups, id);
      for (const l of currentLights().lights) if (l.group && inside.has(l.group)) lightingUi?.setEnabled(l.id, !now);
      renderEntities();
    },
    removeGroup: (id, withContents) => {
      const gone = groups.find((g) => g.id === id);
      if (!gone) return;
      const inside = withDescendants(groups, id);
      const lights = currentLights().lights;
      const cameras = viewer?.cameras;
      if (withContents) {
        for (const e of [...entities]) if (e.group && inside.has(e.group)) removeEntity(e);
        // lights are numbered by their place in the list: the last ones go first, so the numbers of the others stay
        for (const l of lights.filter((x) => x.group && inside.has(x.group)).sort((a, b) => Number(b.id.replace(/\D/g, "")) - Number(a.id.replace(/\D/g, "")))) lightingUi?.remove(l.id);
        if (cameras) for (const c of [...cameras.cameras]) if (c.group && inside.has(c.group)) cameras.remove(c.id);
        groups = groups.filter((g) => !inside.has(g.id));
        // a character that could not be removed (the last one) stays, out of the folder
        for (const e of entities) if (e.group && inside.has(e.group)) e.group = gone.parent;
      } else {
        groups = groups.filter((g) => g.id !== id).map((g) => {
          if (g.parent !== id) return g;
          const { parent: _gone, ...rest } = g;
          return gone.parent ? { ...rest, parent: gone.parent } : rest;
        });
        for (const e of entities) if (e.group === id) e.group = gone.parent;
        const loose = lights.filter((l) => l.group === id).map((l) => l.id);
        if (loose.length) lightingUi?.setGroup(loose, gone.parent);
        if (cameras) {
          for (const c of cameras.cameras) if (c.group === id) { if (gone.parent) c.group = gone.parent; else delete c.group; }
          cameras.refresh();
        }
      }
      renderEntities();
    },
    nestGroup: (id, parent, before) => {
      if (isInside(groups, parent, id)) return;
      const moved = groups.find((g) => g.id === id);
      if (!moved) return;
      const rest = groups.filter((g) => g.id !== id);
      const at = before ? rest.findIndex((g) => g.id === before) : -1;
      const placed = { ...moved, parent };
      if (!parent) delete placed.parent;
      rest.splice(at < 0 ? rest.length : at, 0, placed);
      groups = rest;
      renderEntities();
    },
  }))));

  // Delete in the viewport takes out what is selected, as it does in the outliner (which handles its own key when it has the focus)
  window.addEventListener("keydown", (ev) => {
    if (ev.defaultPrevented || !hotkeyMatches("outliner.delete", ev)) return;
    const target = ev.target as HTMLElement | null;
    if (target?.isContentEditable || (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    if (document.getElementById("view")?.hidden || play?.active || viewer?.cameras.overlayEditing || viewer?.cameras.editing || viewer?.modalActive || selected?.actor.isPosing || nothingSelected) return;
    const picks = currentPicks();
    if (!picks.length) return;
    ev.preventDefault();
    hierarchy();
    outlinerHooks?.remove(picks);
  });

  const pickKey = (p: Pick) => `${p.kind}:${p.id}`;
  /** Everything that is selected now. */
  function currentPicks(): Pick[] {
    return [
      ...entities.filter((e) => multi.has(e.id)).map((e): Pick => ({ kind: "character", id: String(e.id) })),
      ...[...selLights].map((id): Pick => ({ kind: "light", id })),
      ...[...selCameras].map((id): Pick => ({ kind: "camera", id })),
    ];
  }
  /** The selected thing that the properties show. */
  function currentPrimary(): Pick | null {
    if (propsKind === "character") return selected ? { kind: "character", id: String(selected.id) } : null;
    if (propsKind === "light") return { kind: "light", id: currentLights().rig.selected ?? "" };
    if (propsKind === "effect") return null;
    return { kind: "camera", id: propsCamera };
  }
  /** What a box (or a click) of the box select tool covers becomes the selection, is added to it, or is taken from it. */
  function applyBox(hits: BoxHits<Actor>, mode: BoxMode) {
    const hitPicks: Pick[] = [
      ...hits.actors.flatMap((a) => { const e = entities.find((x) => x.actor === a); return e ? [{ kind: "character", id: String(e.id) } as Pick] : []; }),
      ...hits.lights.map((id): Pick => ({ kind: "light", id })),
      ...hits.cameras.map((id): Pick => ({ kind: "camera", id })),
    ];
    const next = combine(currentPicks(), hitPicks, mode, pickKey);
    if (!next.length) {
      // a box (or a click) over nothing clears the selection; taking away everything that was selected leaves it as it is
      if (mode === "replace") deselectAll();
      return;
    }
    const was = currentPrimary();
    const primary = (was && next.find((p) => pickKey(p) === pickKey(was))) || next[next.length - 1];
    selectPicks(next, primary, mode === "subtract" ? [] : hitPicks);
  }
  /** A click on empty space: nothing stays selected (the gizmo goes too). */
  function deselectAll() {
    if (viewer?.cameras.active || viewer?.rig.active || play?.active) return;
    // the gizmo goes with the selection, but its tools stay: they come back with the next thing that is selected
    const camEdit = !!viewer?.cameras.editing, lightEdit = !camEdit && !!viewer?.lightGizmos.active;
    if (camEdit) armedParts = { ...viewer!.cameras.parts };
    else if (lightEdit) armedParts = { ...viewer!.lightGizmos.parts };
    else if (gizmoEntity && !selected?.actor.isPosing) armedParts = { ...characterGizmoParts };
    nothingSelected = true;
    multi = new Set();
    selLights = new Set();
    selCameras = new Set();
    gizmoEntity = null;
    viewer?.setActorGizmo(null);
    viewer?.cameras.stopEditing();
    viewer?.hideLightMarker();
    applyGizmoParts();
    renderEntities();
  }

  /** Shift + click in the view: the thing clicked joins the selection (or leaves it when it was in, as long as something stays selected). */
  function shiftPick(pick: Pick) {
    const current = currentPicks();
    const has = current.some((p) => pickKey(p) === pickKey(pick));
    const next = has ? current.filter((p) => pickKey(p) !== pickKey(pick)) : [...current, pick];
    if (!next.length) return;
    const was = currentPrimary();
    const primary = has ? (was && next.find((p) => pickKey(p) === pickKey(was))) || next[next.length - 1] : pick;
    selectPicks(next, primary, has ? [] : [pick]);
  }
  let boxTool: ReturnType<typeof createBoxSelect<Actor>> | null = null;
  window.addEventListener("keydown", (ev) => {
    if (!hotkeyMatches("select.box", ev) || ev.repeat || ev.defaultPrevented) return;
    const target = ev.target as HTMLElement | null;
    if (target?.isContentEditable || (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    if (document.getElementById("view")?.hidden || play?.active) return;
    boxTool?.quick();
    ev.preventDefault();
  });

  /** Whether a gizmo is showing, on a character, a light or a camera. */
  const gizmoShowing = () => !!gizmoEntity || !!viewer?.cameras.editing || !!viewer?.lightGizmos.active;
  /** Whether a gizmo is up, or was taken away by a click on empty space (it comes back with the next selection). */
  const gizmoWanted = () => gizmoShowing() || !!armedParts;
  /** The gizmo is back on something: it has the tools it had before the click on empty space. */
  function restoreArmed() {
    if (!armedParts) return;
    if (gizmoEntity && !selected?.actor.isPosing) characterGizmoParts = { ...armedParts };
    armedParts = null;
    applyGizmoParts();
  }

  /** Puts the gizmo on this character (from another character, a light or a camera, or from nowhere). */
  function gizmoOnCharacter(e: Entity) {
    if (gizmoEntity === e || e.actor.isPosing) return;
    const cameraHadIt = !!viewer?.cameras.editing, lightHadIt = !!viewer?.lightGizmos.active;
    if (cameraHadIt) viewer?.cameras.stopEditing();
    if (lightHadIt) viewer?.hideLightMarker();
    // a gizmo that comes from a light, a camera or nowhere starts with the move arrows; one that comes from another character keeps its tools
    if (cameraHadIt || lightHadIt || !gizmoEntity) characterGizmoParts = { move: true, rotate: false, scale: false, view: false };
    gizmoEntity = e;
    viewer?.setActorGizmo(e.actor);
    applyGizmoParts();
  }

  /** Shows or hides each character in the view, as its eye and its groups say. */
  function applyListVisibility() {
    for (const e of entities) e.actor.setListHidden(entityHidden(groups, { group: e.group, hidden: e.hidden }));
  }

  /** The lights as the lighting tab lists them (the fixed ones in Simple mode, the added ones in Advanced). */
  function currentLights() {
    const value = viewer?.getLight() ?? pendingLight;
    const rig = parseLightingRig(value.rig, value);
    return { rig, lights: rig.lights };
  }

  function renderEntities() {
    const { rig: lightRig, lights } = currentLights();
    const cameraRig = viewer?.cameras;
    multi = new Set([...multi].filter((id) => entityById(id)));
    selLights = new Set([...selLights].filter((id) => lights.some((l) => l.id === id)));
    selCameras = new Set([...selCameras].filter((id) => cameraRig?.cameras.some((c) => c.id === id)));
    // the character or camera the properties show is selected. A light is not added here from the light list's own idea of its selected
    // light: while a pick is being made that can still be the previous one, which then stayed selected as well. Whatever selects a light
    // puts it in selLights itself.
    if (!nothingSelected) {
      if (propsKind === "character" && selected) multi.add(selected.id);
      if (propsKind === "camera" && cameraRig?.cameras.some((c) => c.id === propsCamera)) selCameras.add(propsCamera);
    }
    const targetKey = cosmeticTargets().map((e) => `${e.id}:${gameClassOf(e.cls)}`).join();
    if (targetKey !== lastTargetKey) {
      lastTargetKey = targetKey;
      itemsUi.targetsChanged();
    }
    viewer?.setSelectionHighlight(entities.filter((e) => multi.has(e.id)).map((e) => e.actor), [...selLights], [...selCameras]);
    const group = !!gizmoEntity && multi.has(gizmoEntity.id);
    viewer?.setGizmoGroup(group ? entities.filter((e) => multi.has(e.id) && e !== gizmoEntity).map((e) => e.actor) : [], group ? [...selLights] : [], group ? [...selCameras] : []);
    applyListVisibility();
    applyProps();
    const nodes: OutlinerNode[] = [
      ...entities.map((e): OutlinerNode => ({
        kind: "character",
        id: String(e.id),
        label: entityLabel(e),
        keywords: [classLabelOf(e.cls), e.held?.displayName].filter(Boolean).join(" · "),
        group: e.group,
        selected: multi.has(e.id),
        off: e.hidden,
        removable: entities.length > 1,
        // a prop is on no team: it wears a skin, and says so only when it has more than one
        ...(skinsOf(e) === 0 ? { team: e.team } : skinsOf(e) > 1 ? { skin: e.team } : {}),
        icon: buttons.get(e.cls)?.querySelector("img")?.src ?? "",
        fogged: e.actor.fogged,
        canClearParticles: !!viewer?.hasFrozenWeaponEffects(e.actor),
      })),
      ...lights.map((l): OutlinerNode => ({ kind: "light", id: l.id, label: l.name, sub: l.type, keywords: l.type, group: l.group, selected: selLights.has(l.id), off: !l.enabled, removable: true })),
      ...(cameraRig?.cameras ?? []).map((c): OutlinerNode => ({ kind: "camera", id: c.id, label: c.name, sub: c.ratio, keywords: c.ratio, group: c.group, selected: selCameras.has(c.id), off: false, removable: true, viewing: cameraRig?.active === c.id })),
    ];
    const primary: Pick | null = nothingSelected || propsKind === "effect" ? null : propsKind === "character" ? (selected ? { kind: "character", id: String(selected.id) } : null) : propsKind === "light" ? { kind: "light", id: lightRig.selected ?? "" } : { kind: "camera", id: propsCamera };
    hierarchy().render(nodes, groups, primary);
  }

  /** Turns a character's gizmo on, or off when it is already on; only one gizmo shows at a time. */
  function toggleGizmo(e: Entity) {
    armedParts = null;
    if (selected?.actor.isPosing) exitPosing();
    gizmoEntity = gizmoEntity === e ? null : e;
    if (gizmoEntity) characterGizmoParts = { move: true, rotate: false, scale: false, view: false };
    applyGizmoParts();
    viewer?.setActorGizmo(gizmoEntity?.actor ?? null);
    renderEntities();
  }

  /** Adds a character next to the others, of the selected one's class and team, and selects it. */
  async function addEntity(copy = false, record = true) {
    const v = ensureViewer();
    const base = selected;
    if (base) saveUi(base);
    const copiedPose = copy && base ? base.actor.snapshotCustomPose() : null;
    const pose = copiedPose && base ? { ...copiedPose, bones: base.actor.boneNames, editing: base.actor.isPosing } : undefined;
    const e = newEntity(v.addActor(), base?.cls ?? CLASSES[0][1], base?.team ?? 0);
    e.group = hierarchy().activeGroup() ?? (copy ? base?.group : undefined);
    if (copy && base) e.actor.setScale(base.actor.scale);
    // Ctrl + Add: a copy with the same cosmetics, paints, styles, weapon, expression and animation
    const source = copy && base ? base : undefined;
    if (source) {
      e.unusuals = { ...source.unusuals };
      e.items = { loadout: source.items.loadout.map((x) => ({ ...x })), activeId: source.items.activeId };
      e.held = source.held;
      e.flex = new Map(source.flex);
      e.fx = { ...source.fx };
    }
    entities.push(e);
    selected = e;
    soleSelection(e);
    v.select(e.actor);
    restoreUi(e);
    renderEntities();
    if (record) recordAdd(copy ? "Copy model" : "Add model", [{ kind: "character", id: String(e.id) }]);
    await show(e, e.cls, source ? { seq: source.anim.seq, seqName: source.anim.seqName, encoded: source.anim.encoded.slice(), playback: () => source.actor.playback, pose } : undefined);
    v.focusAll(); // fit everyone in view
  }

  function removeEntity(e: Entity) {
    if (entities.length <= 1) return;
    const i = entities.indexOf(e);
    entities.splice(i, 1);
    if (gizmoEntity === e) {
      gizmoEntity = null;
    }
    viewer?.removeActor(e.actor);
    if (selected === e) {
      selected = entities[Math.min(i, entities.length - 1)];
      viewer?.select(selected.actor);
      restoreUi(selected);
    }
    renderEntities();
    viewer?.focusAll();
  }
  // --- posing ------------------------------------------------------------------------------------------------

  const P = els.pose;
  const H = P.hud;
  /** The panel of a Blender rig (desktop, personal use). */
  let rigControls: RigControls | null = null;
  if (!__WEB__) rigControls = createRigControls({ slot: H.rigSlot, button: H.rigButton, setMode: (on) => H.setRigMode(on), viewer: () => viewer, actor: () => selected?.actor ?? null, cls: () => selected?.cls ?? "", changed: () => { els.pose.hud.undo.disabled = !selected?.actor.canUndo; els.pose.hud.redo.disabled = !selected?.actor.canRedo; } });
  /** The class whose poses the library shows now (it follows the selected character). */
  let libraryClass = "";

  /** Brings the pose controls over the view and the rig in line with the selected character. */
  function syncPoseUi() {
    const v = viewer;
    const e = selected;
    if (!v || !e) return;
    const posing = e.actor.isPosing;
    if (posing && v.rig.actor !== e.actor) v.rig.setActor(e.actor);
    if (!posing && v.rig.actor) v.rig.setActor(null);
    if (posing) v.rig.setGroups(activeGroups());
    H.root.hidden = !posing;
    rigControls?.sync(posing);
    v.setActorGizmo(posing ? null : gizmoEntity?.actor ?? null);
    applyGizmoParts();
    if (posing) H.keepMapInside();
    H.undo.disabled = !posing || !e.actor.canUndo;
    H.redo.disabled = !posing || !e.actor.canRedo;
    H.resetBone.disabled = !posing || !v.rig.selected;
    H.resetAll.disabled = !posing;
    H.mirror.disabled = !posing;
    H.eye.disabled = !posing || !v.rig.defs.length;
    H.eye.checked = posing && v.rig.eyeAim;
    renderMap();
    if (!posing) P.status.textContent = "";
    if (libraryClass !== e.cls) {
      libraryClass = e.cls;
      renderLibrary();
    }
    syncHandPoseUi();
  }

  // --- the body map: which control a part of the figure selects ---

  const ARM_PARTS = ["shoulder", "upperArm", "forearm", "hand"];
  const groupOfRegion = (key: string) => {
    if (key === "head" || key === "neck" || key === "pelvis" || key === "chest") return "spine";
    if (key.startsWith("spine")) return activeGroups().includes("spinebones") ? "spinebones" : "spine";
    if (key.startsWith("poleArm") || ARM_PARTS.some((p) => key.startsWith(p))) return "arm";
    return "leg";
  };

  /** The rig control a map region stands for. A limb in IK has one target for its upper part, forearm and hand (and a pole dot). */
  function controlFor(key: string): string | null {
    if (key === "head" || key === "neck" || key === "pelvis") return key;
    // the spine bands: each is its own bone while the spine bones are shown, else any of them picks the one Spine control
    if (key.startsWith("spine")) return activeGroups().includes("spinebones") ? key : "spineAll";
    if (key.startsWith("pole")) return key;
    const side = key.slice(-1);
    const part = key.slice(0, -1);
    if (part === "shoulder") return `collar${side}`;
    const limbId = `${ARM_PARTS.includes(part) ? "arm" : "leg"}${side}`;
    if (viewer?.rig.limbs().find((l) => l.id === limbId)?.enabled) return `ik${limbId[0].toUpperCase()}${limbId.slice(1)}`;
    const fk: Record<string, string> = { upperArm: "upperArm", forearm: "lowerArm", hand: "hand", thigh: "hip", shin: "knee", foot: "foot" };
    return fk[part] ? `${fk[part]}${side}` : null;
  }

  function pickRegion(key: string) {
    const v = viewer;
    const id = controlFor(key);
    if (!v || !id || !selected?.actor.isPosing) return;
    // a part whose controls are hidden turns its group on first
    const group = groupButtons.find((b) => b.dataset.group === groupOfRegion(key));
    if (group && !group.classList.contains("on")) {
      group.classList.add("on");
      v.rig.setGroups(activeGroups());
    }
    v.rig.select(v.rig.selected === id ? null : id);
  }

  function renderMap() {
    const v = viewer;
    const posing = !!selected?.actor.isPosing;
    const limbs = new Map<string, boolean>((v?.rig.limbs() ?? []).map((l) => [l.id, l.enabled]));
    for (const [limb, g] of H.limbSwitch) {
      const exists = limbs.has(limb);
      const ik = limbs.get(limb) ?? false;
      g.style.display = posing && exists ? "" : "none";
      g.classList.toggle("on", ik);
      const text = g.querySelector("text");
      if (text) text.textContent = ik ? "IK" : "FK";
      g.querySelector("title")?.remove();
      const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
      title.textContent = ik ? "In IK: a target and a pole drive this limb (click to switch back to FK, the bones keep their pose)" : "In FK: you turn its bones (click to switch to IK)";
      g.appendChild(title);
      const pole = H.poleDot.get(limb);
      if (pole) pole.style.display = posing && ik ? "" : "none";
    }
    const sel = v?.rig.selected ?? null;
    for (const [key, el] of H.regions) el.classList.toggle("sel", !!sel && controlFor(key) === sel);
  }
  for (const [key, el] of H.regions) el.onclick = () => pickRegion(key);
  // while the spine bones are hidden the four bands are one control: hovering one lights them all
  for (const [key, el] of H.regions) {
    if (!key.startsWith("spine")) continue;
    el.onpointerenter = () => {
      if (activeGroups().includes("spinebones")) return;
      for (const [k, other] of H.regions) if (k.startsWith("spine")) other.classList.add("hov");
    };
    el.onpointerleave = () => {
      for (const [k, other] of H.regions) if (k.startsWith("spine")) other.classList.remove("hov");
    };
  }
  for (const [limb, g] of H.limbSwitch) {
    g.onclick = () => {
      const v = viewer;
      const now = v?.rig.limbs().find((l) => l.id === limb)?.enabled ?? false;
      v?.rig.setLimbIk(limb as LimbId, !now);
      syncPoseUi();
    };
  }

  /** The side of the hand the selected control belongs to (an arm control, an arm's IK target or pole, or a finger control). */
  function handSideOfSelection(): "L" | "R" | null {
    const sel = viewer?.rig.selected;
    if (!sel) return null;
    const m = /^(collar|upperArm|lowerArm|hand|ikArm|poleArm)(L|R)$/.exec(sel);
    if (m) return m[2] as "L" | "R";
    return viewer?.rig.defs.find((d) => d.id === sel)?.finger?.side ?? null;
  }

  const controlLabel = (id: string) => {
    const d = viewer?.rig.defs.find((x) => x.id === id);
    return d ? `${d.side === "C" ? "" : d.side + " "}${d.label}` : id;
  };
  void controlLabel;

  const groupButtons = [...H.groups.querySelectorAll<HTMLButtonElement>("button")];
  const activeGroups = () => groupButtons.filter((b) => b.classList.contains("on")).map((b) => b.dataset.group!);

  function startPosing() {
    const v = viewer;
    const e = selected;
    if (!v || !e) return;
    stopPlay();
    if (!v.startPose(e.actor)) {
      P.status.textContent = "This character has no model to pose yet.";
      return;
    }
    syncPoseUi();
  }

  function exitPosing() {
    const v = viewer;
    const e = selected;
    if (!v || !e) return;
    v.stopPose();
    v.rig.forget(e.actor);
    e.actor.endPose(); // the pose stays on the character (paused) until the play button brings a sequence back
    syncPoseUi();
  }

  /** The play button on a custom pose: drops the pose and plays the selected sequence again. */
  function resumeSequence() {
    const e = selected;
    if (!e) return;
    viewer?.clearWeaponEffects(e.actor);renderEntities();
    if (e.actor.isPosing) {
      viewer?.stopPose();
      viewer?.rig.forget(e.actor);
      e.actor.endPose(false);
      syncPoseUi();
    }
    // a pose left in mid-air by play mode: the character comes back down to the floor it jumped from
    const air = leftAirborne.get(e.actor);
    if (air && Math.abs(e.actor.offset.y - air.y) < 1e-3) {
      const o = e.actor.offset;
      if (viewer?.isPlaced(e.actor)) viewer.placeActor(e.actor, o.x, air.ground, o.z, e.actor.yaw);
      else e.actor.setPlacement(o.x, air.ground, o.z, e.actor.yaw);
    }
    leftAirborne.delete(e.actor);
    anim.refresh(e.actor, e.anim);
    e.actor.playback.playing = true;
  }

  // --- play mode: steering the character like in the game ---------------------------------------------------------

  let play: PlayController | null = null;
  let playActor: Actor | null = null;
  /** The weapon last taken for each slot while playing (else the class's stock one). */
  const playPicks = new Map<PlaySlot, ItemInfo>();
  // Play actions and damage controls at the bottom left of the viewport.
  const actionBar = document.getElementById("viewActions") as HTMLElement;
  const playHint = document.getElementById("viewPlayHint") as HTMLElement;
  let damageLabel:HTMLSpanElement|null=null;
  function addDamageAction(a:typeof PLAY_DAMAGE_ACTIONS[number]){
    const b=document.createElement("button"),label=document.createElement("span");b.innerHTML=`<kbd>${a.key}</kbd>`;label.textContent=a.label;b.appendChild(label);
    b.title=`${a.label} (${a.key})`;b.onclick=()=>{play?.damage(a.id);b.blur();};actionBar.appendChild(b);
    if(a.id==="toggleDamage")damageLabel=label;
  }
  PLAY_DAMAGE_ACTIONS.slice(0,2).forEach(addDamageAction);
  for (const a of PLAY_ACTIONS) {
    const b = document.createElement("button");
    b.innerHTML = `<kbd>${a.key}</kbd>${a.label}`;
    b.title = `${a.label} (${a.key})`;
    b.onclick = () => {
      play?.trigger(a.id);
      b.blur(); // so Space (jump) does not press the button again
    };
    actionBar.appendChild(b);
  }

  PLAY_DAMAGE_ACTIONS.slice(2).forEach(addDamageAction);

  /** A character left in mid-air by play mode: where it hangs, and the floor it jumped from. */
  const leftAirborne = new WeakMap<Actor, { y: number; ground: number }>();

  const heldSlotOf = (e: Entity): PlaySlot | null => {
    const w = e.held;
    const cls = gameClassOf(e.cls);
    if (!w || w.slot === "taunt" || !itemUsableBy(w, cls)) return null;
    return weaponCategory(slotForClass(w, cls));
  };

  const weaponProfiles = new Map<string,Promise<WeaponProfile>>();
  // what the weapon in the hand is doing besides shooting (a charge, a heal, the seconds until a thrown one is back); ammunition is not shown, it never runs out
  const ammoLabel = document.createElement("span");
  ammoLabel.className = "playStatus"; actionBar.appendChild(ammoLabel);
  const loadWeaponShell = async (path:string) => {
    let model=models.get(path);
    if(!model) {model=parsePayload(await loadModel(path));models.set(path,model);}
    await ensureMaterials(model,0);await ensureMaterials(model,1);return {model,materials};
  };

  async function startPlay() {
    const v = viewer;
    v?.setConditionsPaused(false);
    const e = selected;
    if (!v || !e || play?.active || !e.anim.info) return;
    v.cameras.stopEditing(); v.cameras.leave();
    v.resetHitReactions();v.clearWeaponEffects(e.actor);renderEntities();
    if (e.actor.isPosing) exitPosing();
    const db = await loadItemDb();
    if (selected !== e || play?.active) return;
    const cls = gameClassOf(e.cls);
    const bySlot = new Map<PlaySlot, ItemInfo[]>();
    for (const w of db.weapons) {
      if (!itemUsableBy(w, cls)) continue;
      const slot = weaponCategory(slotForClass(w, cls));
      bySlot.set(slot, [...(bySlot.get(slot) ?? []), w]);
    }
    const defaults = new Map<PlaySlot, ItemInfo>();
    for (const slot of PLAY_SLOTS) {
      const stock = bySlot.get(slot)?.filter((w) => w.baseItem);
      if (stock?.length) {
        // The utility category combines several game slots: prefer the class's main PDA.
        const rank = (w: ItemInfo) => slot === "utility" ? ["pda", "pda2", "building"].indexOf(slotForClass(w, cls)) : 0;
        defaults.set(slot, stock.sort((a, b) => rank(a) - rank(b) || a.id - b.id)[0]);
      }
    }
    const available = PLAY_SLOTS.filter((s) => defaults.has(s));
    playPicks.clear();
    const held = heldSlotOf(e);
    if (held && e.held) playPicks.set(held, e.held);
    const profiles = new Map<number,WeaponProfile>();
    await Promise.all([...new Map([...defaults.values(),...playPicks.values()].map(w=>[w.id,w])).values()].map(async w=> {
      const key=`${w.id}:${cls}:${e.team}`;
      let promise=weaponProfiles.get(key);
      if (!promise) {promise=getWeaponProfile(w.id,cls,e.team).catch(error=>{weaponProfiles.delete(key);throw error;});weaponProfiles.set(key,promise);}
      try {profiles.set(w.id,await promise);} catch(error) {console.error(error);}
    }));
    if (selected!==e || play?.active) return;
    let weaponReady=false, weaponGeneration=0;
    let floor=e.actor.offset.y;
    const takeWeapon = (slot: PlaySlot) => {
      const w = playPicks.get(slot) ?? defaults.get(slot);
      if (!w) return;
      playPicks.set(slot, w);
      const generation=++weaponGeneration; weaponReady=false; v.retireWeaponEffects(e.actor);
      ammoLabel.textContent="";
      e.held = w;
      weapons.load(w);
      // the hand grip and arm parameters of the weapon go into the animation parameters the player mode builds on
      const { info, encoded } = e.anim;
      const values: Record<string, number> = { r_arm: 0, r_hand_grip: 0, ...w.poseParams };
      info?.poseParams.forEach((p, i) => {
        const val = values[p.name.toLowerCase()];
        if (val !== undefined) encoded[i] = encodeParam(val, p.start, p.end);
      });
      void applyLoadout(e, e.applied).then(async()=> {
        if (generation!==weaponGeneration || !play?.active) return;
        const profile=profiles.get(w.id);
        if (profile) await v.prepareWeaponEffects(e.actor,profile,loadWeaponShell,floor);
        if (generation===weaponGeneration && play?.active) weaponReady=true;
      }).catch(error=> {
        if (generation!==weaponGeneration || !play?.active) return;
        weaponReady=true; els.info.textContent=`Weapon effects: ${String(error)}`; console.error(error);
      });
    };
    // starting again from a pose left in mid-air: the floor is where the jump began, not where the character hangs
    const air = leftAirborne.get(e.actor);
    if (air && Math.abs(e.actor.offset.y - air.y) < 1e-3) e.actor.setPlacement(e.actor.offset.x, air.ground, e.actor.offset.z, e.actor.yaw);
    leftAirborne.delete(e.actor);
    floor=e.actor.offset.y;
    const controlsEnabled = v.controls.enabled;
    play = new PlayController({
      actor: e.actor,
      anim: e.anim,
      gameClass: cls,
      team: () => e.team,
      collide: __WEB__ ? undefined : (x, y, z, vx, vz) => {
        const at = v.collidePlayer(new THREE.Vector3(x, y, z), new THREE.Vector3(vx, 0, vz));
        return at ? { x: at.x, z: at.z } : null;
      },
      setHeldHidden: (hidden) => e.actor.setHeldHidden(hidden),
      onMeal: (event, profile) => {
        const c = profile.consumable;
        if (event.type === "drink") { v.drinkSplash(e.actor); if (c?.buff) v.addTimedCondition(e.actor, c.buff as ConditionKey, c.buffSeconds); }
        else if (event.type === "bite" && event.n === 1 && c?.firstBiteBuff) v.addTimedCondition(e.actor, c.firstBiteBuff as ConditionKey, c.buffSeconds);
        else if (event.type === "drop") v.fireWeapon(e.actor, event.direction);
      },
      surface: v.renderer.domElement,
      weaponSets: () => (e.held && e.held.slot !== "taunt" ? setsOf(weaponIdleSequences(e.held, cls)) : []),
      slots: () => available,
      heldSlot: () => heldSlotOf(e),
      switchSlot: takeWeapon,
      weaponProfile: () => e.held ? profiles.get(e.held.id) ?? null : null,
      weaponReady: () => weaponReady,
      isDamaged:()=>v.isDamaged(e.actor),
      onDamage:(action,direction)=>{
        if(action==="ragdoll")v.selfRagdoll(e.actor,direction,floor);
        else if(action==="explode")v.selfExplode(e.actor,direction,floor,loadWeaponShell);
        else if(action==="resetDamage")v.resetHitReactions();
        else {
          const enabled=!v.damageEnabled,generation=++damageGeneration;pendingDamage=enabled;v.setHitReactions(enabled);
          damageSave=damageSave.catch(()=>{}).then(()=>updateSetting("playHitReactions",enabled)).then(()=>{if(generation===damageGeneration)pendingDamage=null;}).catch(error=>{els.info.textContent=`Could not save damage setting: ${String(error)}`;});
        }
        syncHud();
      },
      onMelee: (direction,profile) => v.meleeWeapon(e.actor,direction,profile),
      onShot: (direction,charge) => v.fireWeapon(e.actor,direction,charge),
      onHealing: (direction,attack)=>v.healWeapon(e.actor,direction,attack),
      onSecondary: direction => {if(cls==="demoman") v.detonateWeapon(e.actor,direction);},
      onFiring: firing => v.setWeaponFiring(e.actor,firing),
      onAmmo: text => {ammoLabel.textContent=text;},
      // the arrow on the floor in front of the character shows which way it faces
      onFrame: (x, z, yaw) => {
        const reach = v.frameRadius;
        v.setFacingMarker({ x: x + Math.sin(yaw) * reach * 0.95, z: z + Math.cos(yaw) * reach * 0.95, yaw, size: reach * 0.32 });
      },
      onExit: stopPlay,
      onInputCapture: (active) => { v.controls.enabled = active ? false : controlsEnabled; },
      onInputError: (message) => { els.info.textContent = message; },
    });
    playActor = e.actor;
    if (!held && available.length > 0) takeWeapon(available[0]);
    else if (e.held) takeWeapon(held!);
    play.start();
    void v.startProps(); // the props with collision fall, are shoved and push back until play mode ends
    syncHud();
  }

  /** Leaves play mode: the character stays where it stands and keeps its pose (held, like after leaving pose mode). */
  function stopPlay() {
    const p = play;
    const e = entities.find((x) => x.actor === playActor) ?? null;
    if (!p) return;
    play = null;
    playActor = null;
    viewer?.stopProps();
    viewer?.setFacingMarker(null);viewer?.freezeHitReactions();viewer?.setConditionsPaused(true);
    const pose = e?.actor.snapshotPose() ?? null;
    if(e) viewer?.freezeWeaponEffects(e.actor);
    p.stop();
    ammoLabel.textContent="";
    if (e && viewer) {
      const a = e.actor;
      viewer.placeActor(a, a.offset.x, a.offset.y, a.offset.z, a.yaw);
      if (a.offset.y > p.origin.y + 1e-3) leftAirborne.set(a, { y: a.offset.y, ground: p.origin.y });
      if (pose) {
        a.usePose(pose);
        a.endPose(); // held as a custom pose (no rig): the play button brings a sequence back
        syncPoseUi();
      } else {
        anim.refresh(e.actor, e.anim);
        playWeaponAnimation(e, e.held);
      }
    }
    syncHud();
    renderEntities();
  }

  // The buttons in the corner of the 3D view: play / pause and pose mode on / off for the selected character.
  const hudPlay = document.getElementById("hudPlay") as HTMLButtonElement;
  const hudPose = document.getElementById("hudPose") as HTMLButtonElement;
  const hudGame = document.getElementById("hudGame") as HTMLButtonElement;
  // a gamepad: play mode
  const ICON_GAME = '<svg viewBox="0 0 24 24"><path d="M7.5 6h9A5.5 5.5 0 0 1 22 11.5v1A4.5 4.5 0 0 1 17.5 17a4 4 0 0 1-3-1.4L13.4 14.5h-2.8l-1.1 1.1a4 4 0 0 1-3 1.4A4.5 4.5 0 0 1 2 12.500v-1A5.500 5.500 0 0 1 7.500 6zM7 8.500v1.500H5.500v1.500H7V13h1.500v-1.500H10V10H8.500V8.500zM16 9.200a1.100 1.100 0 1 0 0 2.200 1.100 1.100 0 0 0 0-2.200zm2.500 2.300a1.100 1.100 0 1 0 0 2.200 1.100 1.100 0 0 0 0-2.200z"/></svg>';
  const ICON_PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
  // a standing figure with its arms out: the pose icon
  const ICON_POSE = '<svg viewBox="0 0 24 24"><circle cx="12" cy="4.5" r="2.4"/><path d="M4 8.5l8 1.6 8-1.6.6 2.2-6.1 1.6v3.2l2.1 6.2-2.2.8L12 16.2 9.6 22.5l-2.2-.8 2.1-6.2v-3.2L3.4 10.7z"/></svg>';
  let hudState = "";
  function syncHud() {
    let clearedParticles=false;
    for(const e of entities) if(viewer?.hasFrozenWeaponEffects(e.actor) && e.actor.playback.playing && !e.actor.holdsPose && !e.actor.isPosing) {
      viewer.clearWeaponEffects(e.actor);clearedParticles=true;
    }
    if(clearedParticles) renderEntities();
    const actor = selected?.actor;
    const posing = !!actor?.isPosing;
    const playing = !!actor?.playback.playing && !posing;
    if (play && play.active && actor !== playActor) stopPlay();
    // whatever ended the held mid-air pose (a sequence picked from the list, a new class ...): back down to the floor
    const air = actor ? leftAirborne.get(actor) : undefined;
    if (actor && air && !play?.active && !actor.holdsPose && !actor.isPosing) {
      if (Math.abs(actor.offset.y - air.y) < 1e-3) {
        const o = actor.offset;
        if (viewer?.isPlaced(actor)) viewer.placeActor(actor, o.x, air.ground, o.z, actor.yaw);
        else actor.setPlacement(o.x, air.ground, o.z, actor.yaw);
      }
      leftAirborne.delete(actor);
    }
    if(damageLabel)damageLabel.textContent=`Damage ${viewer?.damageEnabled ?? settings().playHitReactions ? "on" : "off"}`;
    const gaming = !!play?.active;
    viewer?.setActorGizmo(gaming || posing ? null : gizmoEntity?.actor ?? null);
    gizmoBox.hidden = gaming;
    actionBar.hidden = !gaming;
    playHint.hidden = !gaming;
    els.wrap.classList.toggle("playMode", gaming);
    const state = `${playing}|${posing}|${!!actor?.playback.clip}|${gaming}|${!!actor?.holdsPose}`;
    if (state === hudState) return;
    hudState = state;
    hudPlay.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
    hudPlay.title = playing ? "Pause the animation (Space)" : posing || actor?.holdsPose ? "Drop the custom pose and play the sequence (Space)" : "Play the animation (Space). Ctrl+click plays or pauses every character at once";
    hudPlay.disabled = !actor || gaming || !actor.playback.clip;
    hudPose.innerHTML = ICON_POSE;
    hudPose.classList.toggle("on", posing);
    hudPose.title = posing ? "Exit pose mode: the pose stays until you press play" : "Enter pose mode: freezes the current frame into an editable pose";
    hudPose.disabled = !actor || gaming || (!posing && !actor.hasModel);
    hudGame.innerHTML = ICON_GAME;
    hudGame.classList.toggle("on", gaming);
    hudGame.title = gaming
      ? "Leave play mode (Esc)"
      : "Play mode: hold LMB to fire, RMB holds minigun rev / toggles sniper scope, R reloads, Esc exits, WASD moves, Space jumps, Ctrl crouches, 1 ragdoll, 2 explode, 3-6 gestures, 8 reset damage, 9 damage on/off, mouse wheel or Q / E switch weapons";
    hudGame.disabled = !actor || posing || !actor.playback.clip;
  }
  hudGame.onclick = () => {
    if (play?.active) stopPlay();
    else void startPlay();
    syncHud();
  };
  hudPlay.onclick = (event) => {
    if (event.ctrlKey || event.metaKey) {
      // Ctrl+click: every character plays or pauses together (the Animation tab's button does it)
      els.anim.play.dispatchEvent(new MouseEvent("click", { ctrlKey: event.ctrlKey, metaKey: event.metaKey }));
      syncHud();
      return;
    }
    if (selected?.actor.isPosing || selected?.actor.holdsPose) {
      resumeSequence();
      syncHud();
      return;
    }
    els.anim.play.click(); // the same button as the Animation tab: it also keeps its label in step
    syncHud();
  };
  const animationPlay=els.anim.play.onclick;
  els.anim.play.onclick=ev=> {
    if(ev.ctrlKey || ev.metaKey) animationPlay?.call(els.anim.play,ev);
    else if(selected?.actor.isPosing || selected?.actor.holdsPose) resumeSequence();
    else animationPlay?.call(els.anim.play,ev);
    if(selected?.actor.playback.playing) {viewer?.clearWeaponEffects(selected.actor);renderEntities();}
    syncHud();
  };
  hudPose.onclick = () => {
    if (selected?.actor.isPosing) exitPosing();
    else startPosing();
    syncHud();
  };
  window.setInterval(syncHud, 120);
  window.addEventListener("keydown", ev => {
    const target = ev.target as HTMLElement | null;
    if (!hotkeyMatches("view.focus", ev) || ev.repeat || ev.defaultPrevented || target?.isContentEditable || (target && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName))) return;
    if (document.getElementById("view")?.hidden || play?.active) return;
    if (viewer?.focusAtPointer()) ev.preventDefault();
  });
  // A: the camera back on all the characters (when the pointer is over the view)
  window.addEventListener("keydown", ev => {
    const target = ev.target as HTMLElement | null;
    if (!hotkeyMatches("view.focusAll", ev) || ev.repeat || ev.defaultPrevented || target?.isContentEditable || (target && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName))) return;
    if (document.getElementById("view")?.hidden || play?.active || !viewer?.pointerInside) return;
    viewer.focusAll(true);
    ev.preventDefault();
  });
  window.addEventListener("keydown", (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!hotkeyMatches("play.toggle", ev) || (target && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName))) return;
    if (document.getElementById("view")?.hidden) return;
    if (play?.active || hudPlay.disabled) return;
    ev.preventDefault();
    hudPlay.click();
  });
  syncHud();

  /** After the pose was changed by something other than the rig's own controls. */
  function poseChangedElsewhere() {
    viewer?.rig.afterExternalChange();
    if (viewer?.blenderRig.active) viewer.blenderRig.afterExternalChange();
    syncPoseUi();
  }
  H.undo.onclick = () => {
    selected?.actor.undoPose();
    poseChangedElsewhere();
  };
  H.redo.onclick = () => {
    selected?.actor.redoPose();
    poseChangedElsewhere();
  };
  H.resetBone.onclick = () => {
    const bone = viewer?.rig.selectedBone ?? -1;
    if (bone >= 0) selected?.actor.resetBone(bone);
    else viewer?.rig.resetSelected("rotation");
    poseChangedElsewhere();
  };
  H.resetAll.onclick = () => {
    selected?.actor.resetPose();
    poseChangedElsewhere();
  };
  H.show.onchange = () => viewer?.rig.setShown(H.show.checked);
  H.mirror.onchange = () => {
    if (viewer) viewer.rig.mirror = H.mirror.checked;
  };
  H.eye.onchange = () => {
    viewer?.rig.setEyeAim(H.eye.checked);
    syncPoseUi();
  };
  for (const b of groupButtons) {
    b.onclick = () => {
      b.classList.toggle("on");
      viewer?.rig.setGroups(activeGroups());
      syncPoseUi();
    };
  }
  window.addEventListener("keydown", (ev) => {
    const t = ev.target as HTMLElement | null;
    if (!selected?.actor.isPosing || (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (hotkeyMatches("edit.undo", ev)) {
      selected.actor.undoPose();
    } else if (redoMatches(ev)) {
      selected.actor.redoPose();
    } else {
      return;
    }
    ev.preventDefault();
    poseChangedElsewhere();
  });

  // The pose library: files in the app's config folder, outside the game's.
  // --- the pose library: a browser of thumbnails, whole poses and hand poses --------------------------------------------------

  interface LibraryEntry {
    name: string;
    file: PoseFile;
  }
  let library: LibraryEntry[] = [];
  let libraryFilter: "" | "pose" | "hand" = "";
  /** A capture is being saved: the buttons stay off until it is. */
  let capturing = false;

  async function refreshLibrary() {
    let raw: [string, string][] = [];
    try {
      raw = await readPoses();
    } catch (err) {
      P.library.textContent = `Could not read the pose library: ${String(err)}`;
      return;
    }
    library = [];
    for (const [name, text] of raw) {
      try {
        library.push({ name, file: parsePoseFile(text) });
      } catch {
        // not a pose file of ours (something else in the folder): left out
      }
    }
    renderLibrary();
  }

  // a pose without a picture shows a figure (a hand pose a hand), drawn in the colour of the tiles' own empty state
  const figure = (paths: string, stroke = false) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${stroke ? 'fill="none" stroke="#5b6475" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"' : 'fill="#5b6475"'}>${paths}</svg>`)}`;
  const PLACEHOLDER_THUMB = figure('<circle cx="12" cy="4.5" r="2.4"/><path d="M4 8.5l8 1.6 8-1.6.6 2.2-6.1 1.6v3.2l2.1 6.2-2.2.8L12 16.2 9.6 22.5l-2.2-.8 2.1-6.2v-3.2L3.4 10.7z"/>');
  const HAND_PLACEHOLDER = figure('<path d="M8 13V5.500a1.500 1.500 0 0 1 3 0V11M11 10V4.500a1.500 1.500 0 0 1 3 0V11M14 10.500V6a1.500 1.500 0 0 1 3 0v8c0 4-2 7-6 7-3 0-4.500-1.500-6-4l-1.500-3a1.500 1.500 0 0 1 2.500-1.500L8 14"/>', true);
  /** The look (thumbnails or list, and their size) is the one of the other browsers, kept for this one. */
  createBrowserView(P.foot, P.library, "poses");

  function renderLibrary() {
    P.library.innerHTML = "";
    // A pose fits the skeleton it was made on (a Medic pose does not suit a Soldier, and hands differ from class to class), so the library
    // shows what was made for the selected character's class.
    const cls = selected?.cls ?? "";
    const mine = library.filter((e) => !e.file.model || e.file.model === cls);
    const query = P.search.value.trim().toLowerCase();
    const shown = mine.filter((e) => (!libraryFilter || e.file.kind === libraryFilter) && (!query || e.name.toLowerCase().includes(query)));
    P.count.textContent = `${shown.length} of ${mine.length} ${mine.length === 1 ? "pose" : "poses"}`;
    if (shown.length === 0) {
      const who = classLabelOf(cls);
      P.library.innerHTML = '<div class="dim hint">' + (mine.length === 0 ? `No saved poses for the ${who} yet. Capture one with the buttons above.` : "Nothing like that.") + "</div>";
      return;
    }
    for (const { name, file } of shown) {
      const hand = file.kind === "hand";
      const tile = makeTile({
        title: hand ? `${name}\nHand pose (captured from the ${file.hand === "L" ? "left" : "right"} hand): click to put it on the hand whose arm or fingers are selected` : `${name}\nClick to put this pose on the selected character`,
        quality: hand ? "#d4a64a" : "#7d8696",
        on: false,
        name,
        sub: hand ? `${file.hand ?? "R"} hand` : "Pose",
      });
      tile.classList.add("poseTile");
      if (hand) tile.dataset.hand = "1";
      setTileImage(tile, file.thumb || (hand ? HAND_PLACEHOLDER : PLACEHOLDER_THUMB));
      if (!file.thumb) tile.classList.add("none");
      const del = document.createElement("button");
      del.className = "poseDel";
      del.textContent = "✕";
      del.title = "Delete this pose";
      del.onclick = async (ev) => {
        ev.stopPropagation();
        await deletePoseFile(name).catch(() => {});
        void refreshLibrary();
      };
      tile.appendChild(del);
      tile.onclick = () => void applySavedPose(name, file);
      P.library.appendChild(tile);
    }
    syncHandPoseUi();
  }
  P.search.oninput = renderLibrary;

  /**
   * Hand poses belong to a hand, and the hand is the one whose arm control (or finger) is selected in pose mode: capturing reads it, and a
   * hand pose goes onto it. With none selected the capture button is off and the hand poses in the library are dimmed.
   */
  function syncHandPoseUi() {
    const e = selected;
    const side = e?.actor.isPosing ? handSideOfSelection() : null;
    const usable = !!side && !!e?.actor.hasFingers(side);
    P.saveHand.disabled = capturing || !usable;
    P.saveHand.title = usable
      ? `Save the fingers of the ${side === "L" ? "left" : "right"} hand as they are now, with a thumbnail`
      : "Select a hand in pose mode (any control of an arm, or a finger) to save its fingers: the hand poses go onto the hand that is selected";
    for (const tile of P.library.querySelectorAll<HTMLElement>(".poseTile[data-hand]")) tile.classList.toggle("unavailable", !usable);
  }

  const uniqueName = (base: string) => {
    const taken = new Set(library.map((e) => e.name.toLowerCase()));
    for (let i = 1; ; i++) if (!taken.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
  };

  /** Saves the selected character's whole pose (or just the fingers of a hand) with a thumbnail. */
  async function capturePose(kind: "pose" | "hand") {
    const v = viewer;
    const e = selected;
    if (!v || !e) return;
    const pose = e.actor.pose ?? e.actor.snapshotPose();
    if (!pose) {
      P.status.textContent = "This character has no animation to take a pose from: pick a sequence first.";
      return;
    }
    const side = handSideOfSelection();
    if (kind === "hand") {
      if (!side) { P.status.textContent = "Select a hand first (any control of an arm, or a finger): its fingers are what is saved."; return; }
      if (!e.actor.hasFingers(side)) { P.status.textContent = `This character has no ${side === "L" ? "left" : "right"} fingers to capture.`; return; }
    }
    const name = P.name.value.trim() || uniqueName(kind === "hand" ? "Hand" : `${classLabelOf(e.cls)} pose`);
    if (library.some((x) => x.name.toLowerCase() === name.toLowerCase())) {
      P.status.textContent = `There is already a pose called '${name}'.`;
      return;
    }
    capturing = true;
    P.save.disabled = true; syncHandPoseUi();
    try {
      let focus: { center: THREE.Vector3; radius: number } | null = null;
      if (kind === "hand" && side) {
        const i = e.actor.boneNames.findIndex((n) => n.toLowerCase() === `bip_hand_${side.toLowerCase()}`);
        const worlds = e.actor.boneWorlds;
        const model = e.actor.modelMatrix;
        if (i >= 0 && worlds && model) focus = { center: new THREE.Vector3().setFromMatrixPosition(worlds[i]).applyMatrix4(model), radius: 11 };
      }
      const thumb = await v.thumbnail(e.actor, focus, 144, kind === "hand" ? 144 : 180);
      const seq = e.anim.info?.sequences.find((q) => q.index === e.anim.seq)?.name ?? null;
      const file = kind === "hand" && side ? toHandFile(e.cls, e.actor.boneNames, pose, side, thumb) : toPoseFile(e.cls, e.actor.boneNames, pose, { sequence: seq, frame: 0 }, thumb, e.held && itemUsableBy(e.held, gameClassOf(e.cls)) ? e.held.id : null);
      await savePoseFile(name, JSON.stringify(file));
      P.status.textContent = `Saved '${name}' (${Math.max(1, Math.round(JSON.stringify(file).length / 1024))} KB).`;
      P.name.value = "";
      await refreshLibrary();
    } catch (err) {
      P.status.textContent = `Could not save the pose: ${String(err)}`;
    } finally {
      capturing = false;
      P.save.disabled = false; syncHandPoseUi();
    }
  }

  async function applySavedPose(name: string, file: PoseFile) {
    const v = viewer;
    const e = selected;
    if (!v || !e) return;
    try {
      let weaponNote = "";
      const names = e.actor.boneNames;
      const base = e.actor.pose ?? e.actor.snapshotPose();
      if (!base) {
        P.status.textContent = "This character has no animation to start from: pick a sequence first.";
        return;
      }
      if (file.kind === "hand") {
        const side = handSideOfSelection();
        if (!side || !e.actor.isPosing) {
          P.status.textContent = "Select a hand first (any control of an arm, or a finger): the hand pose goes onto that hand.";
          return;
        }
        const { pose, changed } = applyHandFile(file, names, base, side);
        if (changed === 0) {
          P.status.textContent = "This character has no finger bones that fit that hand pose.";
          return;
        }
        v.usePose(e.actor, pose);
      } else {
        const { pose, matched } = poseForSkeleton(file, names, base);
        if (matched < names.length / 2) {
          P.status.textContent = `'${name}' was made for a different skeleton (only ${matched} of ${names.length} bones match).`;
          return;
        }
        v.usePose(e.actor, pose);
        // a pose saved with its weapon brings it back, or puts the hands empty when it was saved without one
        if (file.weapon !== undefined) {
          const db = await loadItemDb();
          const wanted = file.weapon === null ? null : [...db.weapons, ...db.taunts, ...db.items].find((it) => it.id === file.weapon) ?? null;
          if (file.weapon === null || (wanted && itemUsableBy(wanted, gameClassOf(e.cls)))) {
            e.held = wanted;
            weapons.load(wanted);
            await applyLoadout(e, e.applied);
            weaponNote = wanted ? ` with ${wanted.displayName}` : " without a weapon";
          }
        }
      }
      poseChangedElsewhere();
      P.status.textContent = `Applied '${name}'${weaponNote}.`;
    } catch (err) {
      P.status.textContent = `Could not apply the pose: ${String(err)}`;
    }
  }
  P.save.onclick = () => void capturePose("pose");
  P.saveHand.onclick = () => void capturePose("hand");
  for (const b of P.filter.querySelectorAll<HTMLButtonElement>("button")) {
    b.onclick = () => {
      libraryFilter = (b.dataset.f ?? "") as "" | "pose" | "hand";
      P.filter.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      renderLibrary();
    };
  }
  P.folder.onclick = () => {
    openPosesFolder().then(
      (path) => (P.status.textContent = `Poses are files in ${path}: copy them in or out to share them.`),
      (err) => (P.status.textContent = `Could not open the folder: ${String(err)}`),
    );
  };

  void refreshLibrary();

  // --- screenshots ---------------------------------------------------------------------------------------------

  async function takeScreenshot() {
    const v = viewer;
    if (!v) return;
    const status = els.capture.status;
    els.capture.shot.disabled = true;
    status.textContent = "Rendering…";
    try {
      const { blob, width, height } = await v.capture(settings().screenshotScale, settings().screenshotTransparent);
      const d = new Date();
      const p2 = (n: number) => String(n).padStart(2, "0");
      const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
      const path = await save({ defaultPath: `loadout-${stamp}.png`, filters: [{ name: "PNG image", extensions: ["png"] }] });
      if (!path) {
        status.textContent = "";
        return;
      }
      await writeBinaryFile(path, new Uint8Array(await blob.arrayBuffer()));
      status.textContent = `Saved ${width}×${height}: ${path}`;
    } catch (err) {
      status.textContent = `Screenshot failed: ${String(err)}`;
    } finally {
      els.capture.shot.disabled = false;
    }
  }
  els.capture.shot.onclick = () => void takeScreenshot();

  /** A Photoshop file of the view (or of the active camera's picture), with the effects of the post-processing stack on layers of their own. */
  async function exportLayeredPsd() {
    const v = viewer;
    if (!v) return;
    const status = els.capture.status;
    els.capture.psd.disabled = els.capture.shot.disabled = true;
    status.textContent = "Rendering the layers…";
    try {
      const shot = await v.capture(settings().screenshotScale, settings().screenshotTransparent, { layers: true });
      if (!shot.layers?.length || !shot.merged) throw new Error("nothing was rendered");
      status.textContent = "Writing the PSD…";
      const bytes = new Uint8Array(buildPsd(shot.width, shot.height, shot.merged, shot.layers));
      const d = new Date();
      const p2 = (n: number) => String(n).padStart(2, "0");
      const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
      const path = await save({ defaultPath: `loadout-${stamp}.psd`, filters: [{ name: "Photoshop document", extensions: ["psd"] }] });
      if (!path) { status.textContent = ""; return; }
      await writeBinaryFile(path, bytes);
      status.textContent = `Saved ${shot.width}×${shot.height}, ${shot.layers.length} layers: ${path}`;
    } catch (err) {
      status.textContent = `Layered export failed: ${String(err)}`;
    } finally {
      els.capture.psd.disabled = els.capture.shot.disabled = false;
    }
  }
  els.capture.psd.onclick = () => void exportLayeredPsd();

  // --- videos ---------------------------------------------------------------------------------------------------

  /** Renders a video of the view (or a turntable) and writes it where the user says. The file is asked for first, so no time is lost on a render that has nowhere to go. */
  async function recordVideoToFile(options: VideoOptions, signal: AbortSignal, report: (text: string) => void) {
    const v = viewer;
    if (!v) throw new Error("There is no view to record");
    const d = new Date();
    const p2 = (n: number) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
    const path = await save({ defaultPath: `${options.source === "turntable" ? "turntable" : "loadout"}-${stamp}.${options.format}`, filters: [{ name: options.format.toUpperCase(), extensions: [options.format] }] });
    if (!path) { report(""); return; }
    const buttons = [els.capture.shot, els.capture.psd];
    buttons.forEach((b) => (b.disabled = true));
    const started = performance.now();
    try {
      const result = await recordVideo(v, options, (p) => {
        const seconds = (performance.now() - started) / 1000;
        report(p.phase === "rendering" ? `Rendering frame ${p.done} of ${p.total}… ${seconds.toFixed(0)} s` : options.format === "gif" ? "Optimizing the GIF…" : "Finishing the file…");
      }, signal);
      await writeBinaryFile(path, result.bytes);
      const mb = result.bytes.length / 1048576;
      report(`Saved ${result.width}×${result.height}, ${result.frames} frames, ${mb >= 1 ? mb.toFixed(1) + " MB" : Math.round(result.bytes.length / 1024) + " KB"}: ${path}`);
    } finally {
      buttons.forEach((b) => (b.disabled = false));
    }
  }
  els.capture.video.onclick = () => toggleVideoPanel(els.capture.video, {
    baseSize: () => viewer?.captureBaseSize() ?? { w: 1280, h: 720 },
    record: recordVideoToFile,
  });

  // --- the paint chart: one picture of an inspected cosmetic per paint, laid out in an editor ----------------------

  let chartRunning = false;

  /**
   * Renders the cosmetic of the open Inspect scene in every paint (team paints once per team), as the view frames it now, and opens the
   * chart editor with the pictures cut to the same rectangle.
   */
  async function makePaintChart() {
    const v = viewer;
    const e = selected;
    const status = els.capture.status;
    const worn = e?.items.loadout[0];
    if (!v || !e || !worn || !e.actor.inspectOnly || e.items.loadout.length !== 1 || !worn.item.paintable) {
      status.textContent = "Paint chart: open a paintable cosmetic with Inspect first, and frame it the way you want the pictures.";
      return;
    }
    if (chartRunning) return;
    chartRunning = true;
    const db = await loadItemDb();
    interface Job {
      label: string;
      paint: PaintInfo;
      team: number;
    }
    const jobs: Job[] = [];
    for (const p of db.paints) {
      if (p.rgb2 !== null && p.rgb2 !== p.rgb) jobs.push({ label: `${p.displayName} (RED)`, paint: p, team: 0 }, { label: `${p.displayName} (BLU)`, paint: p, team: 1 });
      else jobs.push({ label: p.displayName, paint: p, team: e.team });
    }

    const back = document.createElement("div");
    back.className = "sceneDialogBack";
    back.innerHTML = '<div class="sceneDialog" role="dialog" aria-modal="true"><p></p><div class="btns"><button>Cancel</button></div></div>';
    const text = back.querySelector("p") as HTMLElement;
    let cancelled = false;
    (back.querySelector("button") as HTMLButtonElement).onclick = () => (cancelled = true);
    document.body.appendChild(back);

    const original = { team: e.team, entry: worn };
    const blobs: Blob[] = [];
    const labels: string[] = [];
    type Bounds = { x0: number; y0: number; x1: number; y1: number; width: number; height: number };
    let union = null as Bounds | null;
    try {
      for (const [i, job] of jobs.entries()) {
        if (cancelled || !entities.includes(e)) break;
        text.textContent = `Rendering ${i + 1} of ${jobs.length}: ${job.label}`;
        e.team = job.team;
        e.items.loadout[0] = { ...worn, paint: job.paint };
        e.applied = [e.items.loadout[0]];
        const data = models.get(classPath(e.cls));
        if (data) await ensureClassMaterials(e, data);
        await applyLoadout(e, e.applied);
        await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
        const shot = await v.capture(settings().screenshotScale, true, { only: e.actor });
        const b = await alphaBounds(shot.blob);
        if (!b) continue;
        const u: Bounds | null = union;
        union = u ? { ...u, x0: Math.min(u.x0, b.x0), y0: Math.min(u.y0, b.y0), x1: Math.max(u.x1, b.x1), y1: Math.max(u.y1, b.y1) } : b;
        blobs.push(shot.blob);
        labels.push(job.label);
      }
    } catch (err) {
      status.textContent = `Paint chart failed: ${String(err)}`;
    } finally {
      e.team = original.team;
      e.items.loadout[0] = original.entry;
      e.applied = [original.entry];
      const data = models.get(classPath(e.cls));
      if (data) await ensureClassMaterials(e, data);
      await applyLoadout(e, e.applied);
      itemsUi.load(e.items);
      markTeams();
      renderEntities();
      back.remove();
      chartRunning = false;
    }
    if (cancelled || !union || blobs.length === 0) {
      if (!cancelled) status.textContent = "Paint chart: nothing was rendered (is the cosmetic in view?).";
      return;
    }
    const margin = Math.round(Math.max(union.x1 - union.x0, union.y1 - union.y0) * 0.03);
    const rect = {
      x0: Math.max(0, union.x0 - margin),
      y0: Math.max(0, union.y0 - margin),
      x1: Math.min(union.width, union.x1 + margin),
      y1: Math.min(union.height, union.y1 + margin),
    };
    const images = await cropImages(blobs, rect, 1024);
    openPaintChart(
      images.map((image, i) => ({ label: labels[i], image })),
      `${worn.item.displayName}: paint chart`,
      async (blob) => {
        const path = await save({ defaultPath: `${worn.item.displayName.replace(/[^\w\- ]+/g, "")} paints.png`, filters: [{ name: "PNG image", extensions: ["png"] }] });
        if (!path) return;
        await writeBinaryFile(path, new Uint8Array(await blob.arrayBuffer()));
        status.textContent = `Saved paint chart: ${path}`;
      },
    );
  }

  // --- scenes --------------------------------------------------------------------------------------------------

  /** Everything needed to rebuild the scene: the characters and the view. Null before there is a viewer. */
  function serializeScene(): SceneFile | null {
    const v = viewer;
    if (!v || !selected || entities.length === 0) return null;
    saveUi(selected);
    // the prop being compiled is shown in the scene but is not part of it
    const savable = entities.filter((e) => e !== propPreview);
    return {
      app: "tf2-workbench",
      version: 1,
      spacing: v.getSpacing(),
      fov: +els.fov.value,
      camera: v.getCamera(),
      cameras: v.cameras.snapshot(),
      viewportProjection: v.cameras.editorProjection(),
      light: v.getLight(),
      pointLight: v.getPointLight(),
      ...capturePost(),
      sky: { ...sky },
      reflection: { ...reflection },
      ground: { ...ground },
      background: bgInput.value,
      wireframe: els.wire.checked,
      jiggle: els.jiggle.checked,
      selected: Math.max(0, savable.indexOf(selected)),
      ...(groups.length ? { groups: groups.map((g) => ({ ...g })) } : {}),
      entities: savable.map(serializeEntity),
    };
  }

  /** A character (or prop, or building) as the scene file keeps it. */
  function serializeEntity(e: Entity): SceneEntity {
    const v = ensureViewer();
      const pb = e.actor.playback;
      const reaction=v.reactionSceneState(e.actor);
      const pose = reaction ? reaction.pose : e.actor.snapshotCustomPose();
      return {
        cls: e.cls,
        team: e.team,
        ...(e.name ? { name: e.name } : {}),
        ...(e.group ? { group: e.group } : {}),
        ...(e.hidden ? { hidden: true } : {}),
        placement: { x: e.actor.offset.x, y: e.actor.offset.y, z: e.actor.offset.z, yaw: e.actor.yaw, ...(e.actor.pitch !== 0 ? { pitch: e.actor.pitch } : {}), ...(e.actor.roll !== 0 ? { roll: e.actor.roll } : {}), scale: e.actor.scale.toArray() as [number, number, number], placed: v.isPlaced(e.actor) },
        loadout: e.items.loadout.map((l) => ({ item: l.item.id, paint: l.paint?.id ?? null, style: l.style })),
        activeItem: e.items.activeId,
        held: e.held?.id ?? null,
        ...(isBuildingCls(e.cls) ? { building: { ...e.fx } } : {}),
        flex: Object.fromEntries(e.flex),
        anim: { sequence: e.anim.info?.sequences.find((q) => q.index === e.anim.seq)?.name ?? null, encoded: e.anim.encoded },
        pose: pose ? { bones: e.actor.boneNames, pos: Array.from(pose.pos), quat: Array.from(pose.quat), ...(pose.scale ? { scale: Array.from(pose.scale) } : {}), editing: e.actor.isPosing } : undefined,
        unusuals: { ...e.unusuals },
        weaponParticles: v.snapshotWeaponEffects(e.actor),
        playback: { time: reaction?.time ?? pb.time, speed: pb.speed, loopAll: pb.loopAll, playing: reaction?.playing ?? pb.playing },
        inspectOnly: e.actor.inspectOnly || undefined,
        bodygroups: e.bodyManual.size ? Object.fromEntries(e.bodyManual) : undefined,
        lod: e.lod > 0 ? e.lod : undefined,
        conditions: anyCondition(e.actor.conditions) ? { ...e.actor.conditions } : undefined,
        bodyShown: e.actor.partsHidden ? [...e.actor.visibleRegions] : undefined,
        bodyMaskVersion: 1,
        bodyTris: e.actor.handMaskState,
        fogged: e.actor.fogged ? undefined : false,
      };
  }

  /** Puts these lights in the scene, in place of the ones it has. */
  function applyLights(light: LightState | undefined, pointLight: PointLightState | undefined) {
    const v = ensureViewer();
    if (light) {
      syncSliders(light);
      applySliders();
    }
    if (pointLight) {
      setPointControls(pointLight);
      applyPoint();
      if (pointLight.enabled && !light?.rig) {
        const p=pointLight;
        const rig=pendingLight.rig!;
        const main=rig.lights[0]??{...newRigLight("light-0","directional"),azimuth:pendingLight.azimuth,elevation:pendingLight.elevation,intensity:pendingLight.intensity,color:pendingLight.color};
        if(pendingLight.followCamera)main.followCamera=true;else delete main.followCamera;
        const point={...newRigLight("light-1","point",v.legacyPointPosition()),enabled:p.enabled,range:p.range*v.sceneRadius,falloff:p.falloff,intensity:p.intensity,color:p.color};
        rig.lights=[main,point];rig.selected=point.id;
        v.setLight(pendingLight);lightingUi?.sync();
      }
    }
  }

  /** The items and paints of the game by id: what a saved character is made from. */
  async function itemLookups() {
    const db = await loadItemDb();
    const byId = new Map<number, ItemInfo>();
    for (const it of [...db.items, ...db.weapons, ...db.taunts]) byId.set(it.id, it);
    return { byId, paints: new Map(db.paints.map((p) => [p.id, p])) };
  }

  /** A character, prop or building as a saved scene has it (its model is shown by `showSaved`). */
  function buildEntity(s: SceneEntity, byId: Map<number, ItemInfo>, paints: Map<number, PaintInfo>, id?: number): Entity {
    const v = ensureViewer();
    const e = newEntity(v.addActor(), s.cls, s.team, id);
      e.name = s.name;
      e.group = s.group;
      e.hidden = s.hidden === true;
      e.unusuals = parseUnusualSettings(s.unusuals);
      e.actor.setInspectOnly(s.inspectOnly === true);
      e.actor.setHandMaskState(s.bodyTris);
      e.actor.fogged = s.fogged !== false;
      if (s.bodyShown) e.actor.setVisibleRegions(s.bodyShown, s.bodyMaskVersion !== 1);
      else if (s.inspectOnly) e.actor.setVisibleRegions([]); // scenes saved before the parts picker showed no body
      if (s.conditions) e.actor.setConditions(s.conditions); // the materials follow when the model shows; syncConditions starts the rest
      e.lod = s.lod ?? 0;
      e.bodyManual = new Map(Object.entries(s.bodygroups ?? {}));
      e.actor.setBodygroups(Object.fromEntries(e.bodyManual));
      const loadout: Equipped[] = s.loadout.flatMap((l) => {
        const item = byId.get(l.item);
        return item ? [{ item, paint: l.paint !== null ? paints.get(l.paint) ?? null : null, style: l.style }] : [];
      });
      e.items = { loadout, activeId: loadout.some((x) => x.item.id === s.activeItem) ? s.activeItem : loadout.at(-1)?.item.id ?? null };
      e.held = s.held !== null ? byId.get(s.held) ?? null : null;
      if (s.building) e.fx = { ...s.building };
      e.flex = new Map(Object.entries(s.flex));
      const cls = gameClassOf(e.cls);
      e.applied = loadout.filter((x) => itemUsableBy(x.item, cls));
      if (s.placement.placed) v.placeActor(e.actor, s.placement.x, s.placement.y, s.placement.z, s.placement.yaw);
      e.actor.setTilt(s.placement.pitch ?? 0, s.placement.roll ?? 0);
      e.actor.setScale(new THREE.Vector3(...(s.placement.scale ?? [1, 1, 1])));
    return e;
  }

  /** Shows the model of a character built from a saved one, with the animation, pose and effects it had. */
  function showSaved(e: Entity, s: SceneEntity): Promise<void> {
    const v = ensureViewer();
    const pose = s.pose ? { pos: Float32Array.from(s.pose.pos), quat: Float32Array.from(s.pose.quat), ...(s.pose.scale ? { scale: Float32Array.from(s.pose.scale) } : {}), bones: s.pose.bones, editing: s.pose.editing } : undefined;
    return show(e, e.cls, {
      seqName: s.anim.sequence ?? undefined,
      encoded: s.anim.encoded,
      playback: () => s.playback,
      pose,
    }).then(async () => {
      if (s.weaponParticles) await v.restoreWeaponEffects(e.actor, s.weaponParticles, loadWeaponShell);
    });
  }

  /** Replaces the scene with a saved one. */
  async function applyScene(scene: SceneFile) {
    editHistory.clear(); // what was done to the scene that is replaced cannot be undone in the new one
    const v = ensureViewer();
    v.cameras.restore(null);
    const { byId, paints } = await itemLookups();

    for (const e of [...entities]) v.removeActor(e.actor);
    entities.length = 0;
    groups = parseGroups(scene.groups);
    selected = null;
    gizmoEntity = null;
    v.setActorGizmo(null);

    els.entities.spacing.value = String(scene.spacing);
    els.entities.spacing.oninput?.(new Event("input"));
    els.fov.value = String(scene.fov);
    els.fov.oninput?.(new Event("input"));
    applyLights(scene.light, scene.pointLight);
    setPostItems(postItemsOf(scene));
    void setSkyState(scene.sky ?? DEFAULT_SKY).catch(() => {});
    void setReflectionState(scene.reflection ?? DEFAULT_REFLECTION).catch(() => {});
    setGroundState(scene.ground ?? DEFAULT_GROUND);
    setBackgroundColor(scene.background ?? DEFAULT_BACKGROUND);
    els.wire.checked = scene.wireframe;
    v.setWireframe(scene.wireframe);
    syncWireButton();
    els.jiggle.checked = scene.jiggle;
    v.setJiggle(scene.jiggle);

    for (const s of scene.entities) entities.push(buildEntity(s, byId, paints));
    selected = entities[scene.selected] ?? entities[0];
    v.select(selected.actor);
    restoreUi(selected);
    renderEntities();
    v.restoreCamera(scene.camera.position, scene.camera.target);
    v.restoreProjection(scene.viewportProjection);
    v.cameras.restore(scene.cameras);
    await Promise.all(entities.map((e, i) => showSaved(e, scene.entities[i])));
    renderEntities();
  }

  /** A scene's saved pose as a pose of this character's skeleton (bones matched by name). */
  function posedFromScene(e: Entity, p: { bones: string[]; pos: Float32Array; quat: Float32Array; scale?: Float32Array }): PoseData | undefined {
    const data = models.get(classPath(e.cls));
    if (!data) return undefined;
    const names = data.bones.map((b) => b.name);
    const blank = e.actor.snapshotPose() ?? e.actor.bindPose();
    if (!blank) return undefined;
    return poseForSkeleton({ app: "tf2-workbench", kind: "pose", version: 1, model: e.cls, bones: p.bones, pos: Array.from(p.pos), quat: Array.from(p.quat), ...(p.scale ? { scale: Array.from(p.scale) } : {}) }, names, blank).pose;
  }

  const sceneFilters = [{ name: "TF2 Workbench scene", extensions: ["json"] }];

  // --- scene tabs: several open scenes share the one viewer; the ones in the background are kept as saved scenes ------------

  interface SceneTab {
    id: number;
    name: string;
    /** The scene as left when the tab was last in front (the open tab's live state is read from the viewer instead). */
    scene: SceneFile | null;
    /** The scene (without the camera) as it was opened or saved, to tell when it has been modified. */
    base: string;
    dirty: boolean;
    path?: string;
  }
  const tabs: SceneTab[] = [];
  let activeTab: SceneTab | null = null;
  let nextTabId = 1;
  let tabBusy = false;
  const fingerprint = (scene: SceneFile) => JSON.stringify({ ...scene, camera: null });
  const tabStrip = document.getElementById("sceneTabs");
  const strip = tabStrip
    ? createSceneTabs(tabStrip, {
        select: (id) => void switchTab(tabs.find((t) => t.id === id)),
        close: (id) => void closeTab(tabs.find((t) => t.id === id)),
        add: () => void openTab(null),
        rename: (id, name) => {
          const t = tabs.find((x) => x.id === id);
          if (t) t.name = name;
          renderTabs();
        },
      })
    : null;
  function renderTabs() {
    strip?.render(tabs.map((t) => ({ id: t.id, name: t.name, dirty: t.dirty })), activeTab?.id ?? -1);
    syncIconMode();
  }

  /** Stores the open tab's live scene into it. */
  function captureActive() {
    if (!activeTab) return;
    const scene = serializeScene();
    if (!scene) return;
    activeTab.scene = scene;
    activeTab.dirty = fingerprint(scene) !== activeTab.base;
  }

  /** Play and pose modes do not carry over between scenes: a pose in progress is held as a custom pose before the scene is stored. */
  function settleForSwitch() {
    if (play?.active) stopPlay();
    for (const e of entities) if (e.actor.isPosing) e.actor.endPose();
    syncPoseUi();
  }

  /** Replaces the scene by a fresh one with a Soldier (the viewer settings stay as they are). */
  async function applyBlank() {
    const v = ensureViewer();
    v.cameras.restore(null);
    setPostItems([{ id: "post-1", kind: "shadow", state: { ...DEFAULT_SHADOW } }]); // a new scene starts with the ground shadow and without fog
    void setSkyState(DEFAULT_SKY);
    void setReflectionState(DEFAULT_REFLECTION).catch(() => {});
    setGroundState(DEFAULT_GROUND);
    for (const e of [...entities]) v.removeActor(e.actor);
    entities.length = 0;
    groups = [];
    selected = null;
    gizmoEntity = null;
    v.setActorGizmo(null);
    const e = newEntity(v.addActor(), CLASSES[0][1], 0);
    entities.push(e);
    selected = e;
    v.select(e.actor);
    restoreUi(e);
    renderEntities();
    await show(e, e.cls);
    v.focusBody();
  }

  /** The world settings of a new scene: the lights, the background, the field of view, the spacing and the view switches at their defaults (the scene itself is made by applyBlank). */
  function resetWorldToDefaults() {
    pendingLight = { ...DEFAULT_LIGHT, rig: defaultLightingRig(DEFAULT_LIGHT) };
    syncSliders(pendingLight);
    applySliders();
    lightingUi?.sync();
    setPointControls(DEFAULT_POINT_LIGHT);
    applyPoint();
    setBackgroundColor(DEFAULT_BACKGROUND);
    for (const input of [els.fov, els.entities.spacing]) {
      input.value = input.defaultValue;
      input.oninput?.(new Event("input"));
    }
    els.jiggle.checked = els.jiggle.defaultChecked;
    els.jiggle.onchange?.(new Event("change"));
    els.wire.checked = false;
    viewer?.setWireframe(false);
    syncWireButton();
  }

  /** A new tab with a copy of the scene that is open. */
  async function newSceneCopy() {
    if (!activeTab) return;
    captureActive();
    const scene = serializeScene();
    if (!scene) return;
    await openTab(parseScene(JSON.stringify(scene)), `${activeTab.name} copy`);
  }

  /** A new tab with the default scene: a Soldier, the default lights, background, sky, ground and post-processing, no cameras. */
  async function newSceneDefault() {
    await openTab(null, undefined, undefined, async () => {
      await applyBlank();
      resetWorldToDefaults();
    });
  }

  /** "Scene N" with the lowest N no open tab uses. */
  function defaultName() {
    let n = 1;
    while (tabs.some((t) => t.name === `Scene ${n}`)) n++;
    return `Scene ${n}`;
  }

  function freshTab(name?: string): SceneTab {
    const id = nextTabId++;
    return { id, name: name ?? defaultName(), scene: null, base: "", dirty: false };
  }

  /** Stores the live scene as the open tab's scene and its unmodified state. */
  function markClean(tab: SceneTab) {
    const now = serializeScene();
    if (!now) return;
    tab.scene = now;
    tab.base = fingerprint(now);
    tab.dirty = false;
  }

  /** A new scene with just this cosmetic or weapon (on the class that can use it, the current one when possible), framed in the view. */
  async function inspectItem(item: ItemInfo, weapon: boolean) {
    const current = selected;
    const usable = (cls: string) => itemUsableBy(item, gameClassOf(cls));
    const cls = current && usable(current.cls) ? current.cls : CLASSES.find((c) => itemUsableBy(item, c[2]))?.[1] ?? current?.cls ?? CLASSES[0][1];
    const team = current?.team ?? 0;
    await openTab(null, item.displayName, undefined, async () => {
      const v = ensureViewer();
      v.cameras.restore(null);
      for (const e of [...entities]) v.removeActor(e.actor);
      entities.length = 0;
      groups = [];
      selected = null;
      gizmoEntity = null;
      v.setActorGizmo(null);
      const e = newEntity(v.addActor(), cls, team);
      e.actor.setVisibleRegions(weapon ? [] : defaultBodyGroupsFor(cls, item.equipRegions));
      e.actor.setInspectOnly(true);
      const equipped: Equipped[] = weapon ? [] : [{ item, paint: null, style: 0 }];
      e.items = { loadout: equipped, activeId: weapon ? null : item.id };
      e.held = weapon ? item : null;
      e.applied = equipped;
      entities.push(e);
      selected = e;
      v.select(e.actor);
      restoreUi(e);
      renderEntities();
      await show(e, cls, { seqName: "ref" }); // the reference pose
      await applyLoadout(e, e.applied); // the cosmetics are in before the camera frames them
      v.focusInspect();
    });
  }

  // --- the backpack icon studio ---------------------------------------------------------------------------------------------

  const iconFrame = document.getElementById("iconFrame") as HTMLElement;
  const iconBar = document.getElementById("iconBar") as HTMLElement;
  const iconStatus = document.getElementById("iconStatus") as HTMLElement;
  const iconFadePanel = document.getElementById("iconFade") as HTMLElement;

  // The fade of the bottom of the picture: its switch and shape, remembered, with the band in the frame that shows where and how it eases out.
  const FADE_KEY = "tf2workbench.iconFade";
  let iconFade = { on: true, height: 60, curve: 1.5 };
  try {
    const saved = JSON.parse(localStorage.getItem(FADE_KEY) ?? "null");
    if (saved && typeof saved === "object") iconFade = { on: saved.on !== false, height: Number.isFinite(saved.height) ? saved.height : 60, curve: Number.isFinite(saved.curve) ? saved.curve : 1.5 };
  } catch {
    // storage unavailable: the defaults
  }
  const fadeOn = document.getElementById("iconFadeOn") as HTMLInputElement;
  const fadeInputs = {
    height: [document.getElementById("iconFadeHeight"), document.getElementById("iconFadeHeightNumber")] as HTMLInputElement[],
    curve: [document.getElementById("iconFadeCurve"), document.getElementById("iconFadeCurveNumber")] as HTMLInputElement[],
  };
  /** The fade to apply to the picture (null: none). */
  const currentFade = (): IconFade | null => (iconFade.on && iconFade.height > 0 ? { height: iconFade.height, curve: iconFade.curve } : null);
  function showIconFade() {
    fadeOn.checked = iconFade.on;
    for (const input of fadeInputs.height) input.value = String(iconFade.height);
    for (const input of fadeInputs.curve) input.value = String(iconFade.curve);
    for (const input of [...fadeInputs.height, ...fadeInputs.curve]) input.disabled = !iconFade.on;
    // the band: how much of the picture is left at each row of the fade, as darkness over the black behind it
    const band = document.getElementById("iconFadeBand") as HTMLElement;
    const fade = currentFade();
    const rows = Math.min(iconFade.height, ICON_SAFE_ROWS.end - ICON_SAFE_ROWS.start);
    band.hidden = !fade;
    if (!fade) return;
    band.style.top = `${((ICON_SAFE_ROWS.end - rows) / 512) * 100}%`;
    band.style.height = `${(rows / 512) * 100}%`;
    const stops = Array.from({ length: 9 }, (_, i) => `rgba(0,0,0,${(1 - fadeAmount(ICON_SAFE_ROWS.end - rows + (rows * i) / 8, fade)).toFixed(3)}) ${(i / 8) * 100}%`);
    band.style.background = `linear-gradient(to bottom, ${stops.join(", ")})`;
  }
  function saveIconFade() {
    showIconFade();
    try {
      localStorage.setItem(FADE_KEY, JSON.stringify(iconFade));
    } catch {
      // not remembered
    }
  }
  fadeOn.onchange = () => { iconFade.on = fadeOn.checked; saveIconFade(); };
  for (const key of ["height", "curve"] as const) {
    for (const input of fadeInputs[key]) {
      input.oninput = () => {
        const v = Number(input.value);
        if (!Number.isFinite(v)) return;
        iconFade[key] = key === "height" ? Math.max(0, Math.min(ICON_SAFE_ROWS.end - ICON_SAFE_ROWS.start, v)) : Math.max(0.1, Math.min(8, v));
        // the slider and the number box follow each other (not the one being typed in)
        for (const other of fadeInputs[key]) if (other !== input) other.value = String(iconFade[key]);
        saveIconFade();
      };
    }
  }
  function setIconStatus(text: string, bad = false) {
    iconStatus.textContent = text;
    iconStatus.classList.toggle("err", bad);
    iconStatus.title = text;
  }

  /** The studio's view: black behind, a 22 degree vertical field of view (the square the view's full height shows), no grid or markers. */
  function enterIconMode(v: Viewer) {
    iconSaved = { grid: gridOn, indicators: lightsOn };
    v.setBackground(0x000000);
    v.setFixedVerticalFov(ICON_FOV);
    v.gridVisible = false;
    v.lightIndicators = false;
    els.wrap.classList.add("iconStudio");
    iconFrame.hidden = false;
    iconBar.hidden = false;
    iconFadePanel.hidden = false;
    showIconFade();
    setIconStatus("");
  }

  function exitIconMode() {
    iconTab = null;
    const v = viewer;
    if (v) {
      v.setBackground(null);
      v.setFixedVerticalFov(null);
      v.gridVisible = iconSaved.grid;
      v.lightIndicators = iconSaved.indicators;
    }
    els.wrap.classList.remove("iconStudio");
    iconFrame.hidden = true;
    iconBar.hidden = true;
    iconFadePanel.hidden = true;
    if (compilerOn) compiler.selectionChanged();
  }

  /** The studio ends when another scene is open. */
  function syncIconMode() {
    if (iconTab && activeTab !== iconTab) exitIconMode();
  }

  /**
   * Opens the compiler's item alone in a scene of its own (like inspecting an item), with the studio's view: a square frame of 512x512
   * with the rows the picture must stay between, 22 degrees of field of view, black behind, the lights at their defaults and no
   * post-processing.
   */
  async function openIconStudio() {
    if (iconTab && activeTab === iconTab) return;
    const current = selected;
    if (!current || !compilerPreview) return;
    const { cls, team } = current;
    iconOrigin = activeTab;
    await openTab(null, `${compiler.session.data.name.trim() || "item"} icon`, undefined, async () => {
      iconTab = activeTab;
      const v = ensureViewer();
      v.cameras.restore(null);
      for (const e of [...entities]) v.removeActor(e.actor);
      entities.length = 0;
      groups = [];
      selected = null;
      gizmoEntity = null;
      v.setActorGizmo(null);
      pendingLight = { ...DEFAULT_LIGHT, rig: defaultLightingRig(DEFAULT_LIGHT) };
      syncSliders(pendingLight);
      applySliders();
      lightingUi?.sync();
      setPointControls(DEFAULT_POINT_LIGHT);
      applyPoint();
      setPostItems([]);
      void setSkyState(DEFAULT_SKY);
      void setReflectionState(DEFAULT_REFLECTION).catch(() => {});
    setGroundState(DEFAULT_GROUND);
      els.wire.checked = false;
      v.setWireframe(false);
      syncWireButton();
      const e = newEntity(v.addActor(), cls, team);
      // the parts of the character the body parts system shows for the item's equip region (the head for a hat), as when an item is inspected; the
      // item's Hides chips still apply and the parts picker hides the rest
      e.actor.setVisibleRegions(defaultBodyGroupsFor(cls, [compiler.session.data.region]));
      e.actor.setInspectOnly(true);
      e.items = { loadout: [], activeId: null };
      e.held = null;
      e.applied = [];
      entities.push(e);
      selected = e;
      v.select(e.actor);
      restoreUi(e);
      renderEntities();
      showCompilerItem(compilerPreview); // the item goes onto this character
      await show(e, cls, { seqName: "ref" });
      await compiler.updatePreviewNow();
      await applyLoadout(e, e.applied); // the item is in before the camera frames it
      v.focusInspect();
      enterIconMode(v);
    });
  }

  /** Closes the studio and goes back to the scene it was opened from (no questions: nothing in it is worth saving). */
  async function closeIconStudio() {
    const tab = iconTab;
    if (!tab || tabBusy || activeTab !== tab) return;
    tabBusy = true;
    try {
      settleForSwitch();
      const at = tabs.indexOf(tab);
      tabs.splice(at, 1);
      const next = iconOrigin && tabs.includes(iconOrigin) && iconOrigin.scene ? iconOrigin : tabs[at - 1] ?? tabs[at];
      if (next?.scene) {
        activeTab = next;
        renderTabs(); // the studio's view settings are put back here
        await applyScene(next.scene);
        syncPoseUi();
      } else {
        const fresh = freshTab();
        tabs.push(fresh);
        activeTab = fresh;
        await applyBlank();
        syncPoseUi();
        markClean(fresh);
      }
    } finally {
      tabBusy = false;
      renderTabs();
    }
  }

  /** Renders the icon, saves it as <name>_icon.tga and puts it in the compiler's icon slot. */
  async function createIcon() {
    const v = viewer, e = selected;
    if (!v || !e || !iconTab) return;
    const name = compiler.session.itemName;
    if (!name) { setIconStatus("Name the item first: the icon is saved as <name>_icon.tga.", true); return; }
    setIconStatus("Rendering…");
    try {
      const rgba = await v.captureIcon(e.actor);
      // what is outside the safe rows is cut away; the bottom eases out when the fade is on
      maskIcon(rgba, currentFade());
      const bytes = encodeTga(rgba, 512, 512);
      const problem = iconProblem(decodeTga(bytes));
      const path = await saveItemIcon(name, bytes);
      await compiler.session.setIcon(path);
      compiler.render();
      const file = path.replace(/\\/g, "/").split("/").pop();
      if (problem) { setIconStatus(`Saved ${file}, but it ${problem}. Reframe and try again.`, true); return; }
      // the icon is made and in its slot: back to the scene the item is being built in
      await closeIconStudio();
    } catch (error) {
      setIconStatus(String(error), true);
    }
  }
  (document.getElementById("iconCreate") as HTMLButtonElement).onclick = () => void createIcon();

  async function openTab(scene: SceneFile | null, name?: string, path?: string, build?: () => Promise<void>) {
    if (tabBusy) return;
    tabBusy = true;
    try {
      settleForSwitch();
      captureActive();
      const tab = freshTab(name);
      tab.path = path;
      tabs.push(tab);
      activeTab = tab;
      if (scene) await applyScene(scene);
      else if (build) await build();
      else await applyBlank();
      syncPoseUi();
      markClean(tab);
    } finally {
      tabBusy = false;
      renderTabs();
    }
  }

  async function switchTab(tab: SceneTab | undefined) {
    if (!tab || tab === activeTab || tabBusy || !tab.scene) return;
    tabBusy = true;
    try {
      settleForSwitch();
      captureActive();
      activeTab = tab;
      renderTabs();
      await applyScene(tab.scene);
      syncPoseUi();
    } finally {
      tabBusy = false;
      renderTabs();
    }
  }

  /** Asks what to do with a scene that is being closed; resolves to the choice and whether to stop asking. */
  function askClose(tab: SceneTab): Promise<{ choice: "save" | "discard" | "cancel"; stopAsking: boolean }> {
    return new Promise((resolve) => {
      const back = document.createElement("div");
      back.className = "sceneDialogBack";
      back.innerHTML = `<div class="sceneDialog" role="dialog" aria-modal="true"><p></p>
        <label class="ask"><input type="checkbox" /> Do not ask again (can be changed in Settings)</label>
        <div class="btns"><button data-c="cancel">Cancel</button><button data-c="discard">${tab.dirty ? "Do not save" : "Close"}</button>${tab.dirty ? '<button data-c="save" class="primary">Save…</button>' : ""}</div></div>`;
      const text = back.querySelector("p") as HTMLElement;
      text.textContent = tab.dirty ? `"${tab.name}" has changes that are not saved to a file. Close it?` : `Close "${tab.name}"?`;
      const box = back.querySelector("input") as HTMLInputElement;
      const done = (choice: "save" | "discard" | "cancel") => {
        document.removeEventListener("keydown", onKey, true);
        back.remove();
        resolve({ choice, stopAsking: box.checked && choice !== "cancel" });
      };
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key === "Escape") {
          ev.stopPropagation();
          done("cancel");
        }
      };
      document.addEventListener("keydown", onKey, true);
      back.onclick = (ev) => {
        const c = (ev.target as HTMLElement).closest<HTMLElement>("button")?.dataset.c;
        if (c) done(c as "save" | "discard" | "cancel");
        else if (ev.target === back) done("cancel");
      };
      document.body.appendChild(back);
      (back.querySelector("button[data-c=cancel]") as HTMLElement).focus();
    });
  }

  async function closeTab(tab: SceneTab | undefined) {
    if (!tab || tabBusy) return;
    if (tab === activeTab) captureActive();
    if (settings().confirmCloseScene) {
      const { choice, stopAsking } = await askClose(tab);
      if (stopAsking) void updateSetting("confirmCloseScene", false);
      if (choice === "cancel") return;
      if (choice === "save") {
        if (tab !== activeTab) await switchTab(tab);
        await saveSceneToFile();
        if (tab.dirty) return; // the save was cancelled or failed
      }
    }
    const at = tabs.indexOf(tab);
    if (tab !== activeTab) {
      tabs.splice(at, 1);
      renderTabs();
      return;
    }
    tabBusy = true;
    try {
      settleForSwitch();
      tabs.splice(at, 1);
      const next = tabs[at] ?? tabs[at - 1];
      if (next?.scene) {
        activeTab = next;
        renderTabs();
        await applyScene(next.scene);
        syncPoseUi();
      } else {
        // closing the only scene leaves a fresh one
        const fresh = freshTab();
        tabs.push(fresh);
        activeTab = fresh;
        await applyBlank();
        syncPoseUi();
        markClean(fresh);
      }
    } finally {
      tabBusy = false;
      renderTabs();
    }
  }

  const baseName = (path: string) => path.replace(/^.*[\\/]/, "").replace(/\.json$/i, "");

  async function saveSceneToFile() {
    settleForSwitch();
    const scene = serializeScene();
    if (!scene) return;
    try {
      const path = await save({ defaultPath: `${activeTab?.name ?? "scene"}.json`, filters: sceneFilters });
      if (!path) return;
      await writeTextFile(path, JSON.stringify(scene, null, 2));
      if (activeTab) {
        activeTab.path = path;
        activeTab.name = baseName(path);
        activeTab.scene = scene;
        activeTab.base = fingerprint(scene);
        activeTab.dirty = false;
        renderTabs();
      }
      els.capture.status.textContent = `Saved scene: ${path}`;
    } catch (err) {
      els.capture.status.textContent = `Could not save the scene: ${String(err)}`;
    }
  }

  /** A scene file opens in a tab of its own. */
  async function loadSceneFromFile() {
    try {
      const path = await open({ multiple: false, filters: sceneFilters });
      if (typeof path !== "string") return;
      const scene = parseScene(await readTextFile(path));
      await openTab(scene, baseName(path), path);
      els.capture.status.textContent = `Loaded scene: ${path}`;
    } catch (err) {
      els.capture.status.textContent = `Could not load the scene: ${String(err)}`;
    }
  }
  /** The lights, or the post-processing effects, of the scene in a file of their own (name.l.json, name.p.json). */
  async function saveScenePart(part: ScenePart) {
    settleForSwitch();
    if (!viewer || !entities.length) return;
    const head = { app: "tf2-workbench", kind: part, version: 1 } as const;
    const post = capturePost();
    const file = part === "lights"
      ? { ...head, light: viewer.getLight(), pointLight: viewer.getPointLight() }
      : { ...head, shadows: post.shadows, fogs: post.fogs, rimLights: post.rimLights, aos: post.aos, look: post.look };
    try {
      const picked = await save({ defaultPath: `${activeTab?.name ?? "scene"}${PART_SUFFIX[part]}`, filters: partFilter(part) });
      if (!picked) return;
      const path = partPath(picked, part);
      await writeTextFile(path, JSON.stringify(file, null, 2));
      els.capture.status.textContent = `Saved ${PART_LABEL[part]}: ${path}`;
    } catch (err) {
      els.capture.status.textContent = `Could not save the ${PART_LABEL[part]}: ${String(err)}`;
    }
  }

  /** The lights, or the post-processing effects, of a file take the place of the ones the scene has. */
  async function loadScenePart(part: ScenePart) {
    if (!viewer || !entities.length) { els.capture.status.textContent = `Open a scene before loading ${PART_LABEL[part]}.`; return; }
    try {
      const path = await open({ multiple: false, filters: partFilter(part) });
      if (typeof path !== "string") return;
      const text = await readTextFile(path);
      if (part === "lights") {
        const lights = parseLightsFile(text);
        applyLights(lights.light, lights.pointLight);
      } else setPostItems(postItemsOf(parsePostFile(text) as PostSource));
      els.capture.status.textContent = `Loaded ${PART_LABEL[part]}: ${path}`;
    } catch (err) {
      els.capture.status.textContent = `Could not load the ${PART_LABEL[part]}: ${String(err)}`;
    }
  }
  if (import.meta.env.DEV) (window as unknown as { __workbenchScene: unknown }).__workbenchScene = { serializeScene, applyScene, applyLights, postItemsOf, setPostItems, capturePost, saveScenePart, loadScenePart, loadShell: (path: string) => loadWeaponShell(path), recordVideo: (o: VideoOptions) => recordVideo(viewer!, o, () => {}, new AbortController().signal) };

  els.capture.paintChart.onclick = () => void makePaintChart();
  els.capture.menu.onclick = () => openMenu(els.capture.menu, [
    { label: "New scene", children: [
      { label: "Copy", hint: "of this scene", run: () => void newSceneCopy() },
      { label: "Default", hint: "a fresh scene", run: () => void newSceneDefault() },
    ] },
    { label: "Save scene", children: [
      { label: "All", hint: ".json", run: () => void saveSceneToFile() },
      { label: "Lights", hint: PART_SUFFIX.lights, run: () => void saveScenePart("lights") },
      { label: "Post-processing", hint: PART_SUFFIX.post, run: () => void saveScenePart("post") },
    ] },
    { label: "Load scene", children: [
      { label: "All", hint: ".json", run: () => void loadSceneFromFile() },
      { label: "Lights", hint: PART_SUFFIX.lights, run: () => void loadScenePart("lights") },
      { label: "Post-processing", hint: PART_SUFFIX.post, run: () => void loadScenePart("post") },
    ] },
  ]);

  /** All open scenes are stored as the session shortly after they change, to come back at the next start. */
  let lastSession = "";
  let autosave = 0;
  function startAutosave() {
    if (autosave) return;
    autosave = window.setInterval(() => {
      if (tabBusy) return;
      const before = activeTab?.dirty;
      captureActive();
      if (activeTab?.dirty !== before) renderTabs();
      if (!tabs.length || tabs.some((t) => !t.scene)) return;
      const text = JSON.stringify({
        app: "tf2-workbench",
        tabs: tabs.map((t) => ({ name: t.name, path: t.path ?? null, base: t.base, scene: t.scene })),
        active: Math.max(0, activeTab ? tabs.indexOf(activeTab) : 0),
      });
      if (text === lastSession) return;
      lastSession = text;
      void saveSession(text).catch(() => {});
    }, 2000);
  }

  /** The tabs as the last session left them (or its single scene, from before there were tabs). */
  async function restoreSession(text: string) {
    const raw = JSON.parse(text);
    if (!Array.isArray(raw.tabs)) {
      const t = freshTab();
      tabs.push(t);
      activeTab = t;
      await applyScene(parseScene(text));
      markClean(t);
      return;
    }
    const restored: { tab: SceneTab; scene: SceneFile }[] = [];
    for (const r of raw.tabs) {
      try {
        const scene = parseScene(JSON.stringify(r.scene));
        const tab = freshTab(typeof r.name === "string" ? r.name : undefined);
        tab.scene = scene;
        // the baseline it was saved with is kept, so the modified mark survives a restart
        tab.base = typeof r.base === "string" ? r.base : fingerprint(scene);
        tab.dirty = fingerprint(scene) !== tab.base;
        if (typeof r.path === "string") tab.path = r.path;
        restored.push({ tab, scene });
      } catch (err) {
        console.warn("skipped a stored scene:", err);
      }
    }
    if (!restored.length) return;
    const front = restored[Math.min(Math.max(0, Number(raw.active) || 0), restored.length - 1)];
    for (const r of restored) tabs.push(r.tab);
    activeTab = front.tab;
    await applyScene(front.scene);
  }

  /** The scene starts as the last session left it, or with one Soldier. */
  async function startFirstEntity() {
    const v = ensureViewer();
    await loadSettings();
    if (settings().restoreLastScene) {
      try {
        const text = await loadSession();
        if (text) await restoreSession(text);
      } catch (err) {
        console.warn("could not restore the last scene:", err);
      }
    }
    if (entities.length === 0) {
      const e = newEntity(v.addActor(), CLASSES[0][1], 0);
      entities.push(e);
      selected = e;
      restoreUi(e);
      renderEntities();
      await show(e, e.cls);
    }
    if (!activeTab) {
      activeTab = freshTab();
      tabs.length = 0;
      tabs.push(activeTab);
      markClean(activeTab);
    }
    renderTabs();
    startAutosave();
  }

  // The Add menu of the outliner: a character, a buildable, a light or a camera
  const ICON = {
    character: "M9 3.500a2.500 2.500 0 1 0 0 5 2.500 2.500 0 0 0 0-5zM4 15v-1.500A3.500 3.500 0 0 1 7.500 10h3a3.500 3.500 0 0 1 3.500 3.500V15z",
    buildable: "M2 6.500 9 3l7 3.500v6L9 16l-7-3.500zM2 6.500l7 3.500 7-3.500M9 10v6",
    light: "M9 2.500a4.500 4.500 0 0 0-2.500 8.200V12.500h5v-1.800A4.500 4.500 0 0 0 9 2.500zM7 14.500h4M7.800 16.500h2.400",
    camera: "M2 5.500h3l1.200-2h5.600l1.200 2h3v9H2zM9 12.500a2.500 2.500 0 1 0 0-5 2.500 2.500 0 0 0 0 5z",
    sun: "M9 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM9 1.500v2M9 14.500v2M1.500 9h2M14.500 9h2M3.700 3.700l1.400 1.400M12.900 12.900l1.400 1.400M3.700 14.300l1.400-1.400M12.900 5.100l1.400-1.400",
    point: "M9 2.500a6.500 6.500 0 1 0 0 13 6.500 6.500 0 0 0 0-13zM9 7.500a1.500 1.500 0 1 0 0 3 1.500 1.500 0 0 0 0-3z",
    spot: "M7 2.500h4v3H7zM8 5.500 3.500 15.500M10 5.500l4.500 10M3.500 15.500h11",
    folder: "M2 5h5l2-2h7v12H2zM2 7h14",
  };
  if (!__WEB__) {
    const propsRoot = document.getElementById("propsPane");
    if (propsRoot) createPropPanel(propsRoot, { add: (path, at) => void addProp(path, at) });
  }
  els.entities.add.onclick = () => {
    openMenu(els.entities.add, [
      { label: "Character", icon: ICON.character, hint: "Ctrl: copy of the selected", run: ({ ctrl }) => void addEntity(ctrl) },
      {
        label: "Buildable",
        icon: ICON.buildable,
        children: [
          { label: "Dispenser", run: () => void addBuilding("dispenser") },
          { label: "Sentry", run: () => void addBuilding("sentry") },
          { label: "Teleporter", run: () => void addBuilding("teleporter") },
        ],
      },
      ...(__WEB__ ? [] : [{ label: "Prop…", icon: ICON.buildable, hint: "opens the prop browser", run: () => document.dispatchEvent(new CustomEvent("workbench:reveal-panel", { detail: "props" })) }]),
      {
        label: "Light",
        icon: ICON.light,
        separator: true,
        children: [
          { label: "Directional", icon: ICON.sun, run: () => addLightFromMenu("directional") },
          { label: "Point", icon: ICON.point, run: () => addLightFromMenu("point") },
          { label: "Spot", icon: ICON.spot, run: () => addLightFromMenu("spot") },
        ],
      },
      { label: "Camera", icon: ICON.camera, run: () => addCameraFromView() },
      { label: "Folder", icon: ICON.folder, run: () => hierarchy().newFolder() },
    ]);
  };

  /** Adds a camera from the current view and makes it the selection. */
  function addCameraFromView() {
    nothingSelected = false;
    prepareCamera();
    const made = ensureViewer().cameras.fromView();
    propsKind = "camera";
    propsCamera = made.id;
    multi = new Set();
    selLights = new Set();
    selCameras = new Set([made.id]);
    renderCameraUi.select(made.id);
    const folder = hierarchy().activeGroup();
    if (folder) made.group = folder;
    renderEntities();
    recordAdd("Add camera", [{ kind: "camera", id: made.id }]);
  }

  /** Adds a light of a type and makes it the selection. */
  function addLightFromMenu(type: "directional" | "point" | "spot") {
    ensureViewer();
    lightingUi?.add(type);
    const made = currentLights().lights.at(-1);
    const folder = hierarchy().activeGroup();
    if (made && folder) lightingUi?.setGroup([made.id], folder);
    if (made) {
      selectPicks([{ kind: "light", id: made.id }], { kind: "light", id: made.id });
      recordAdd("Add light", [{ kind: "light", id: made.id }]);
    }
  }

  /**
   * Puts a prop model (`models/props_c17/barrel001.mdl`) in the scene, on the floor where it was dropped (a position of the view) or, with
   * none, in front of the camera. It is a character whose "class" is the model's path, as a building is, and the camera stays where it is.
   */
  async function addProp(path: string, at?: { clientX: number; clientY: number }) {
    if (__WEB__) return;
    const v = ensureViewer();
    const base = selected;
    if (base) saveUi(base);
    const cls = path.replace(/^models\//i, "").replace(/\.mdl$/i, "");
    const e = newEntity(v.addActor(), cls, 0);
    e.group = hierarchy().activeGroup();
    const place = (at ? v.floorPointAt(at.clientX, at.clientY) : null) ?? v.floorInFront();
    v.placeActorAt(e.actor, place.x, 0, place.z);
    entities.push(e);
    selected = e;
    soleSelection(e);
    v.select(e.actor);
    restoreUi(e);
    renderEntities();
    recordAdd("Add prop", [{ kind: "character", id: String(e.id) }]);
    await show(e, e.cls);
    // it stands on the floor, wherever the model keeps its origin
    v.placeActorAt(e.actor, place.x, -e.actor.bindMinY, place.z);
  }

  async function addBuilding(kind: BuildingKind) {
    const v = ensureViewer();
    const base = selected;
    if (base) saveUi(base);
    const e = newEntity(v.addActor(), buildingCls(kind, 1), base?.team ?? 0);
    entities.push(e);
    selected = e;
    soleSelection(e);
    v.select(e.actor);
    restoreUi(e);
    renderEntities();
    recordAdd("Add building", [{ kind: "character", id: String(e.id) }]);
    await show(e, e.cls);
    v.focusAll();
  }

  /** Swaps a building's model for another level or stage, keeping its place, team and animation clock. */
  function setBuilding(e: Entity, level: number, stage: BuildingStage, mode?: TeleporterMode) {
    const info = buildingOf(e.cls);
    if (!info) return;
    const cls = buildingCls(info.kind, level, stage, mode ?? info.mode);
    if (cls === e.cls) return;
    const sameModel = classPath(cls) === classPath(e.cls);
    e.cls = cls;
    renderEntities();
    // another level of the same model changes the effects only; a new model starts on its own animation
    if (sameModel) {
      renderBuildingPanel();
      return;
    }
    void show(e, cls, { seqName: defaultBuildingSequence(cls), playback: () => e.actor.playback });
  }

  /** Puts the building's effects (particles, the dispenser's screens, the teleporter's spin and arrow) in line with its state. */
  function applyBuildingFx(e: Entity, settle = false) {
    const info = buildingOf(e.cls);
    if (!viewer) return;
    viewer.setBuildingFx(e.actor, info ? e.cls : null, e.fx, e.team);
    if (!info) return;
    if (info.kind === "teleporter" && info.stage === "finished") {
      // the arrow shows and the blades blur at full speed only while it is charged and connected; idle it stands still
      e.bodyManual.set("teleporter_direction", e.fx.active ? 1 : 0);
      e.bodyManual.set("teleporter_blur", e.fx.active ? 1 : 0);
      void applyBodygroups(e);
      if (settle) e.actor.playback.playing = e.fx.active;
      if (e === selected) renderBodygroups();
    }
    if (info.kind === "sentry" && info.stage === "finished" && settle && e.fx.firing) anim.selectByName(e.actor, e.anim, ["fire"]);
  }

  function setFx(e: Entity, change: Partial<BuildingFx>) {
    const before = e.fx;
    e.fx = { ...e.fx, ...change };
    const info = buildingOf(e.cls);
    applyBuildingFx(e);
    if (info?.kind === "sentry" && "firing" in change && change.firing !== before.firing) {
      // the gun's recoil plays over the running sentry while it fires
      anim.selectByName(e.actor, e.anim, change.firing ? ["fire"] : ["idle_off"]);
    }
    if (info?.kind === "teleporter" && "active" in change) {
      e.actor.playback.playing = e.fx.active;
      anim.show(e.anim, e.actor);
    }
    if (e === selected) renderBuildingPanel();
  }

  /** Level and stage buttons of the selected building. */
  function renderBuildingPanel() {
    const box = els.entities.buildPanel;
    const e = selected;
    const info = e ? buildingOf(e.cls) : null;
    box.hidden = !e || !info;
    box.replaceChildren();
    if (!e || !info) return;
    const levels = BUILDINGS[info.kind].levels.length;
    const row = (label: string, buttons: [string, boolean, () => void][]) => {
      const line = document.createElement("div");
      line.className = "buildRow";
      const name = document.createElement("span");
      name.className = "dim";
      name.textContent = label;
      const group = document.createElement("div");
      group.className = "seg";
      for (const [text, on, click] of buttons) {
        const b = document.createElement("button");
        b.textContent = text;
        b.className = on ? "on" : "";
        b.onclick = click;
        group.appendChild(b);
      }
      line.append(name, group);
      box.appendChild(line);
    };
    if (info.kind === "teleporter") {
      row("Mode", [
        ["Entrance", info.mode === "entrance", () => setBuilding(e, info.level, info.stage, "entrance")],
        ["Exit", info.mode === "exit", () => setBuilding(e, info.level, info.stage, "exit")],
      ]);
    }
    row("Level", Array.from({ length: levels }, (_, i): [string, boolean, () => void] => [String(i + 1), info.level === i + 1, () => setBuilding(e, i + 1, info.stage)]));
    row("Model", [
      ["Finished", info.stage === "finished", () => setBuilding(e, info.level, "finished")],
      ["Building", info.stage === "building", () => setBuilding(e, info.level, "building")],
    ]);
    if (info.stage === "building") return; // nothing runs on a building that is being built
    row("Damage", [0, 1, 2, 3, 4].map((n): [string, boolean, () => void] => [String(n), e.fx.damage === n, () => setFx(e, { damage: n })]));
    const toggle = (label: string, title: string, on: boolean, change: (on: boolean) => void) => {
      const line = document.createElement("label");
      line.className = "buildToggle";
      line.title = title;
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = on;
      input.onchange = () => change(input.checked);
      line.append(input, document.createTextNode(` ${label}`));
      box.appendChild(line);
    };
    if (info.kind === "sentry") {
      toggle("Firing", "The gun fires: its recoil plays over the running sentry and a muzzle flash comes out at every shot", e.fx.firing, (on) => setFx(e, { firing: on }));
      toggle("Wrangler shield", "The shield the Wrangler puts around the sentry", e.fx.shield, (on) => setFx(e, { shield: on }));
    } else if (info.kind === "teleporter") {
      toggle("Charged", "Charged and connected: the teleporter spins, glows and shows its direction", e.fx.active, (on) => setFx(e, { active: on }));
    } else if (info.kind === "dispenser") {
      const line = document.createElement("label");
      line.className = "buildRow";
      line.title = "The metal in the dispenser: the arrow of its screens turns to it (the game turns it at 80 degrees a second)";
      const name = document.createElement("span");
      name.className = "dim";
      name.textContent = "Metal";
      const range = document.createElement("input");
      range.type = "range";
      range.min = "0";
      range.max = String(DISPENSER_MAX_METAL);
      range.step = "1";
      range.value = String(e.fx.metal);
      const value = document.createElement("output");
      value.textContent = String(e.fx.metal);
      range.oninput = () => {
        value.textContent = range.value;
        e.fx = { ...e.fx, metal: Number(range.value) };
        applyBuildingFx(e);
      };
      line.append(name, range, value);
      box.appendChild(line);
      toggle("Healing beam", "A beam to the nearest character", e.fx.healing, (on) => setFx(e, { healing: on }));
    }
  }
  els.entities.spacing.oninput = () => {
    const out = els.entities.spacing.parentElement?.querySelector("output");
    if (out) out.textContent = els.entities.spacing.value;
    viewer?.setSpacing(+els.entities.spacing.value);
  };
  els.entities.spacing.oninput(new Event("input"));

  // --- the post-processing effects: a list of items, each with its own settings; the controls of the properties panel edit the picked one ---
  /** The settings that a new effect of a kind starts with; the copies after the first look different, so that they can be told apart. */
  function newPostState(kind: PostKind, existing: number): PostItem["state"] {
    if (kind === "shadow") return { ...DEFAULT_SHADOW, azimuth: (DEFAULT_SHADOW.azimuth + 120 * existing) % 360 };
    if (kind === "fog") return { ...DEFAULT_FOG, enabled: true };
    if (kind === "ao") return { ...DEFAULT_AO, enabled: true };
    if (isLookKind(kind)) return defaultLook(kind) as unknown as PostItem["state"];
    return { ...DEFAULT_RIM_LIGHT, enabled: true, direction: existing % 2 ? 180 : 0 };
  }
  const isLookKind = (kind: PostKind): kind is LookKind => (LOOK_KINDS as readonly string[]).includes(kind);
  /** The look effects of the list, the first of each kind (they are one of a kind at most). */
  const looksOf = (items: readonly PostItem[]): LookStates => Object.fromEntries(LOOK_KINDS.flatMap((k) => { const s = statesOf<unknown>(items, k)[0]; return s ? [[k, s]] : []; })) as LookStates;
  /** The item that the controls of a kind are showing (the picked one), or null. */
  const editingItem = (kind: PostKind) => { const i = propsKind === "effect" ? postItems.find((p) => p.id === propsEffect) : undefined; return i?.kind === kind ? i : null; };
  /** Hands the effects to the view. */
  function pushPost() {
    const v = viewer;
    if (!v) return;
    v.setShadows(statesOf<ShadowParams>(postItems, "shadow"));
    v.setFogs(statesOf<FogState>(postItems, "fog"));
    v.setRimLights(statesOf<RimLightState>(postItems, "rim"));
    v.setAo(statesOf<AoState>(postItems, "ao")[0] ?? { ...DEFAULT_AO, enabled: false });
    v.setLook(looksOf(postItems));
  }
  /** Puts the settings of the picked effect on the controls. */
  function loadPostEditor() {
    const item = postItems.find((i) => i.id === propsEffect);
    if (!item) return;
    if (item.kind === "shadow") showShadow(item.state as unknown as ShadowParams);
    else if (item.kind === "fog") showFog(item.state as unknown as FogState);
    else if (item.kind === "ao") showAo(item.state as unknown as AoState);
    else if (isLookKind(item.kind)) lookEditors.show(item.kind, item.state);
    else showRimLight(item.state as unknown as RimLightState);
  }
  function selectPostItem(id: string) {
    propsEffect = id;
    propsKind = "effect";
    loadPostEditor();
    renderEntities();
  }
  /** What a scene file has of the effects (the single ones of older files count when they are on). */
  // (a plain object type: "Pick" is the name of something else in this file)
  type PostSource = { [K in "shadows" | "fogs" | "rimLights" | "aos" | "shadow" | "fog" | "rimLight" | "ao" | "look"]?: SceneFile[K] };
  function postItemsOf(scene: PostSource): PostItem[] {
    const items: PostItem[] = [];
    const add = (kind: PostKind, state: object | undefined) => { if (state) items.push({ id: newPostId(items), kind, state: state as PostItem["state"] }); };
    const shadow = (raw: any): ShadowParams => ({ ...DEFAULT_SHADOW, ...(raw && typeof raw === "object" ? raw : {}) });
    if (scene.shadows) scene.shadows.slice(0, POST_KINDS.shadow.max).forEach((s) => add("shadow", shadow(s)));
    else if (scene.shadow?.enabled) add("shadow", shadow(scene.shadow));
    if (scene.fogs) scene.fogs.slice(0, POST_KINDS.fog.max).forEach((f) => add("fog", parseFog(f)));
    else if (parseFog(scene.fog)?.enabled) add("fog", parseFog(scene.fog));
    if (scene.rimLights) scene.rimLights.slice(0, POST_KINDS.rim.max).forEach((r) => add("rim", parseRimLight(r)));
    else if (scene.rimLight?.enabled) add("rim", parseRimLight(scene.rimLight));
    if (scene.aos) scene.aos.slice(0, POST_KINDS.ao.max).forEach((a) => add("ao", parseAo(a)));
    else if (parseAo(scene.ao)?.enabled) add("ao", parseAo(scene.ao));
    for (const k of LOOK_KINDS) add(k, parseLook(k, scene.look?.[k]));
    return items;
  }
  /** Replaces the effects (a scene was opened or a new one started) and shows them. */
  function setPostItems(items: PostItem[]) {
    postItems = items;
    if (propsKind === "effect" && !postItems.some((i) => i.id === propsEffect)) { propsKind = "character"; renderEntities(); }
    else if (propsKind === "effect") loadPostEditor();
    pushPost();
    postUi.refresh(true);
  }

  /** The effects for a scene file: each list, and the first of each kind in the single fields that older versions read. */
  function capturePost() {
    const first = <S,>(kind: PostKind, fallback: S): S => statesOf<S>(postItems, kind)[0] ?? fallback;
    return {
      shadows: statesOf<ShadowParams>(postItems, "shadow"),
      fogs: statesOf<FogState>(postItems, "fog"),
      rimLights: statesOf<RimLightState>(postItems, "rim"),
      shadow: first<ShadowParams>("shadow", { ...DEFAULT_SHADOW, enabled: false }),
      fog: first<FogState>("fog", { ...DEFAULT_FOG, enabled: false }),
      rimLight: first<RimLightState>("rim", { ...DEFAULT_RIM_LIGHT }),
      ao: first<AoState>("ao", { ...DEFAULT_AO }),
      aos: statesOf<AoState>(postItems, "ao"),
      look: looksOf(postItems) as Record<string, unknown>,
    };
  }

  /** The controls of the picked effect were changed: its settings are what the controls say. */
  function editedPost(kind: PostKind, state: PostItem["state"]) {
    const item = editingItem(kind);
    if (item) item.state = state;
    pushPost();
  }

  /** The settings of the look effects in the properties panel (built from the list in look.ts). */
  const lookEditors = createLookEditors(propsEl("propEffect"), (kind, state) => editedPost(kind, state));

  function applyShadow() {
    const s = els.shadow;
    editedPost("shadow", { enabled: s.on.checked, azimuth: +s.azimuth.value, length: +s.length.value, blur: +s.blur.value, opacity: +s.opacity.value });
    const label = (el: HTMLInputElement, text: string) => {
      const out = el.parentElement?.querySelector("output");
      if (out) out.textContent = text;
    };
    label(s.azimuth, `${s.azimuth.value}°`);
    label(s.length, (+s.length.value).toFixed(2));
    label(s.blur, (+s.blur.value).toFixed(1));
    label(s.opacity, (+s.opacity.value).toFixed(2));
  }
  function showShadow(p: ShadowParams) {
    const s = els.shadow;
    s.on.checked = p.enabled;
    s.azimuth.value = String(p.azimuth);
    s.length.value = String(p.length);
    s.blur.value = String(p.blur);
    s.opacity.value = String(p.opacity);
    applyShadow();
  }
  for (const el of [els.shadow.on, els.shadow.azimuth, els.shadow.length, els.shadow.blur, els.shadow.opacity]) el.oninput = applyShadow;
  els.shadow.reset.onclick = () => {
    const d = DEFAULT_SHADOW;
    els.shadow.azimuth.value = String(d.azimuth);
    els.shadow.length.value = String(d.length);
    els.shadow.blur.value = String(d.blur);
    els.shadow.opacity.value = String(d.opacity);
    applyShadow();
  };
  applyShadow();

  // --- ambient occlusion ---
  function applyAo() {
    const a = els.ao;
    editedPost("ao", { enabled: a.on.checked, strength: +a.strength.value, radius: +a.radius.value, power: +a.power.value });
    const label = (el: HTMLInputElement, text: string) => {
      const out = el.parentElement?.querySelector("output");
      if (out) out.textContent = text;
    };
    label(a.strength, (+a.strength.value).toFixed(2));
    label(a.radius, (+a.radius.value).toFixed(2));
    label(a.power, (+a.power.value).toFixed(2));
  }
  function showAo(a: AoState) {
    const e = els.ao;
    e.on.checked = a.enabled;
    e.strength.value = String(a.strength);
    e.radius.value = String(a.radius);
    e.power.value = String(a.power);
    applyAo();
  }
  for (const el of [els.ao.on, els.ao.strength, els.ao.radius, els.ao.power]) el.oninput = applyAo;
  els.ao.reset.onclick = () => showAo({ ...DEFAULT_AO, enabled: els.ao.on.checked });
  applyAo();

  // --- camera-relative Fresnel rim light ---
  function applyRimLight() {
    const r = els.rimLight;
    editedPost("rim", { enabled: r.on.checked, allAround: r.allAround.checked, color: r.color.value,
      strength: +r.strength.value, width: +r.width.value, direction: +r.direction.value, softness: +r.softness.value,
      painted: r.painted.checked, cutoff: +r.cutoff.value, edgeSoftness: +r.edgeSoftness.value });
    for (const key of ["strength", "width", "direction", "softness", "cutoff", "edgeSoftness"] as const) {
      const input = r[key]; input.parentElement!.querySelector("output")!.textContent = key === "direction" ? `${input.value}°` : (+input.value).toFixed(2);
    }
    r.direction.disabled = r.softness.disabled = r.allAround.checked;
    r.cutoff.parentElement!.hidden = r.edgeSoftness.parentElement!.hidden = !r.painted.checked;
  }
  function showRimLight(value: RimLightState) {
    const r = els.rimLight;
    r.on.checked = value.enabled; r.allAround.checked = value.allAround; r.color.value = value.color;
    r.painted.checked = value.painted;
    for (const key of ["strength", "width", "direction", "softness", "cutoff", "edgeSoftness"] as const) r[key].value = String(value[key]);
    applyRimLight();
  }
  for (const input of [els.rimLight.on, els.rimLight.allAround, els.rimLight.color, els.rimLight.strength, els.rimLight.width, els.rimLight.direction, els.rimLight.softness, els.rimLight.painted, els.rimLight.cutoff, els.rimLight.edgeSoftness]) input.oninput = applyRimLight;
  els.rimLight.reset.onclick = () => showRimLight({ ...DEFAULT_RIM_LIGHT, enabled: els.rimLight.on.checked });
  applyRimLight();

  // --- fog ---
  function applyFog() {
    const f = els.fog;
    editedPost("fog", { enabled: f.on.checked, color: f.color.value, top: +f.top.value, bottom: +f.bottom.value, middle: +f.middle.value, softness: +f.softness.value, view: f.view.checked });
    const label = (el: HTMLInputElement, text: string) => {
      const out = el.parentElement?.querySelector("output");
      if (out) out.textContent = text;
    };
    label(f.top, (+f.top.value).toFixed(2));
    label(f.bottom, (+f.bottom.value).toFixed(2));
    label(f.middle, (+f.middle.value).toFixed(2));
    label(f.softness, (+f.softness.value).toFixed(2));
  }
  /** Puts a fog on the controls (and the view). */
  function showFog(f: FogState) {
    const e = els.fog;
    e.on.checked = f.enabled;
    e.color.value = f.color;
    e.top.value = String(f.top);
    e.bottom.value = String(f.bottom);
    e.middle.value = String(f.middle);
    e.softness.value = String(f.softness);
    e.view.checked = f.view === true;
    applyFog();
  }
  for (const el of [els.fog.on, els.fog.color, els.fog.top, els.fog.bottom, els.fog.middle, els.fog.softness, els.fog.view]) el.oninput = applyFog;
  els.fog.reset.onclick = () => showFog({ ...DEFAULT_FOG, enabled: els.fog.on.checked });
  applyFog();

  function applyPoint() {
    const p = els.point;
    viewer?.setPointLight({
      enabled: p.on.checked,
      azimuth: +p.azimuth.value,
      elevation: +p.elevation.value,
      distance: +p.distance.value,
      range: +p.range.value,
      falloff: +p.falloff.value,
      intensity: +p.intensity.value,
      color: p.color.value,
    });
    viewer?.setPointLightMarkerVisible(p.marker.checked);
    const label = (el: HTMLInputElement, text: string) => {
      const out = el.parentElement?.querySelector("output");
      if (out) out.textContent = text;
    };
    label(p.azimuth, `${p.azimuth.value}°`);
    label(p.elevation, `${p.elevation.value}°`);
    label(p.distance, (+p.distance.value).toFixed(2));
    label(p.range, (+p.range.value).toFixed(2));
    label(p.falloff, (+p.falloff.value).toFixed(1));
    label(p.intensity, (+p.intensity.value).toFixed(2));
  }
  function setPointControls(l: typeof DEFAULT_POINT_LIGHT) {
    const p = els.point;
    p.on.checked = l.enabled;
    p.azimuth.value = String(Math.round(l.azimuth));
    p.elevation.value = String(Math.round(l.elevation));
    p.distance.value = String(l.distance);
    p.range.value = String(l.range);
    p.falloff.value = String(l.falloff);
    p.intensity.value = String(l.intensity);
    p.color.value = l.color;
  }
  for (const el of Object.values(els.point)) if (el instanceof HTMLInputElement) el.oninput = applyPoint;
  els.point.reset.onclick = () => {
    setPointControls(DEFAULT_POINT_LIGHT);
    applyPoint();
  };
  applyPoint();

  function applySliders() {
    viewer?.setLight({
      rig: pendingLight.rig,
      azimuth: +els.azimuth.value,
      elevation: +els.elevation.value,
      intensity: +els.intensity.value,
      color: els.lightColor.value,
      ambient: +els.ambient.value,
      ambientColor: els.ambientColor.value,
      followCamera: els.follow.checked,
    });
    if (!pendingLight.rig) viewer?.setLightGizmoVisible(els.gizmo.checked);
    updateLabels();
    lightingUi?.sync();
  }

  function syncSliders(l: LightState, refreshUi = true) {
    pendingLight = { ...l, rig: parseLightingRig(l.rig, l) };
    els.azimuth.value = String(Math.round(l.azimuth));
    els.elevation.value = String(Math.round(l.elevation));
    els.intensity.value = String(l.intensity);
    els.lightColor.value = l.color;
    els.ambient.value = String(l.ambient);
    els.ambientColor.value = l.ambientColor;
    els.follow.checked = l.followCamera;
    updateLabels();
    if (refreshUi) lightingUi?.sync();
    renderEntities();
  }

  function updateLabels() {
    const set = (el: HTMLInputElement, text: string) => {
      const out = el.parentElement?.querySelector("output");
      if (out) out.textContent = text;
    };
    set(els.azimuth, `${els.azimuth.value}°`);
    set(els.elevation, `${els.elevation.value}°`);
    set(els.intensity, (+els.intensity.value).toFixed(2));
    set(els.ambient, (+els.ambient.value).toFixed(2));
  }

  function syncFov() {
    const out = els.fov.parentElement?.querySelector("output");
    if (out) out.textContent = `${els.fov.value}°`;
  }
  syncFov();
  /** How many skins a prop has (the skin families of its model); 0 for what is not a prop (a character or a building: they have a team). */
  function skinsOf(e: Entity): number {
    if (!e.actor.sourceBind) return 0;
    return models.get(classPath(e.cls))?.skinCount ?? 1;
  }
  /** The team buttons of a character, or the skin buttons of a prop that has several skins (a prop with one has neither). */
  function syncSkins() {
    const skins = selected ? skinsOf(selected) : 0;
    const teamBox = els.teams[0].parentElement!;
    const skinBox = document.getElementById("propSkins")!;
    teamBox.hidden = skins > 0;
    skinBox.hidden = skins < 2;
    if (skins < 2) { skinBox.replaceChildren(); return; }
    if (skinBox.children.length !== skins) {
      skinBox.replaceChildren(...Array.from({ length: skins }, (_, i) => {
        const b = document.createElement("button");
        b.className = "team skin";
        b.textContent = `Skin ${i + 1}`;
        b.onclick = () => { if (selected) void setTeam(selected, i); };
        return b;
      }));
    }
    [...skinBox.children].forEach((b, i) => b.classList.toggle("on", i === (selected?.team ?? 0)));
  }
  function markTeams() {
    els.teams.forEach((b, i) => b.classList.toggle("on", i === (selected?.team ?? 0)));
    syncSkins();
  }
  /** Puts a character on a team (0 RED, 1 BLU). */
  async function setTeam(e: Entity, team: number) {
    if (e.team === team) return;
    e.team = team;
    markTeams();
    renderEntities();
    if (compilerOn && e === selected) compiler.selectionChanged();
    const data = models.get(classPath(e.cls));
    if (!data || !viewer) return;
    await ensureClassMaterials(e, data);
    await applyLoadout(e, e.applied); // loads the cosmetics' team materials and switches every skin together
  }
  els.teams.forEach((b, i) => {
    b.onclick = () => { if (selected) void setTeam(selected, i); };
  });
  markTeams();
  els.focusFace.onclick = () => viewer?.focusFace(true);
  els.focusBody.onclick = () => viewer?.focusBody(true);
  els.focusAll.onclick = () => viewer?.focusAll(true);
  els.fov.oninput = () => {
    viewer?.setFov(+els.fov.value);
    syncFov();
  };
  els.fov.ondblclick = () => {
    els.fov.value = String(DEFAULT_FOV_X); // double-click resets to the default
    els.fov.oninput?.(new Event("input"));
  };
  els.jiggle.onchange = () => viewer?.setJiggle(els.jiggle.checked);
  els.wire.onchange = () => {
    viewer?.setWireframe(els.wire.checked);
    syncWireButton();
  };
  for (const s of [els.azimuth, els.elevation, els.intensity, els.lightColor, els.ambient, els.ambientColor, els.follow, els.gizmo]) s.oninput = applySliders;
  els.lightReset.onclick = () => {
    syncSliders(DEFAULT_LIGHT);
    applySliders();
  };
  syncSliders(DEFAULT_LIGHT);
  lightingUi = createLightingUi(document.getElementById("lightPane")!, {
    get: () => viewer?.getLight() ?? pendingLight,
    set: value => {
      syncSliders(value,false);
      if (value.rig?.marker) { gizmoEntity = null; viewer?.setActorGizmo(null); viewer?.cameras.stopEditing(); }
      viewer?.setLight(pendingLight);
      applyGizmoParts();
      renderEntities();
    },
    picked: () => {
      nothingSelected = false;
      multi = new Set();
      const chosen = currentLights().rig.selected;
      selLights = new Set(chosen ? [chosen] : []);
      selCameras = new Set();
      setPropsKind("light");
    },
    spawn: () => viewer?.lightSpawnPosition() ?? [60,100,100],
    cameraRotation: () => viewer?.camera.quaternion.clone() ?? new THREE.Quaternion(),
  });
  // the effects of the post-processing panel: the one that is picked has its settings in the properties panel
  const postUi = createPostUi({
    list: propsEl("postList"),
    add: propsEl("postAdd") as HTMLButtonElement,
    items: () => postItems,
    selected: () => (propsKind === "effect" ? propsEffect : null),
    select: (id) => selectPostItem(id),
    toggle: (id, on) => {
      const item = postItems.find((i) => i.id === id);
      if (!item) return;
      item.state.enabled = on;
      if (propsEffect === id) loadPostEditor();
      pushPost();
    },
    remove: (id) => {
      postItems = postItems.filter((i) => i.id !== id);
      if (propsKind === "effect" && propsEffect === id) { propsKind = "character"; renderEntities(); }
      pushPost();
    },
    addKind: (kind) => {
      const item: PostItem = { id: newPostId(postItems), kind, state: newPostState(kind, countOf(postItems, kind)) };
      postItems = [...postItems, item];
      pushPost();
      selectPostItem(item.id);
    },
  });
  setInterval(() => postUi.refresh(), 400);
  // the view settings (field of view, jiggle bones) lead the World panel
  document.querySelector("#lightPane .worldSky")!.before(document.getElementById("worldView")!);
  skyUi = createSkyUi(document.querySelector<HTMLElement>("#lightPane .worldSky")!, {
    get: () => sky,
    set: async (next) => { await setSkyState(next); },
  });
  reflectionUi = createReflectionUi(document.querySelector<HTMLElement>("#lightPane .worldReflection")!, {
    get: () => reflection,
    set: async (next) => { await setReflectionState(next); },
  });
  groundUi = createGroundUi(document.querySelector<HTMLElement>("#lightPane .worldGround")!, {
    get: () => ground,
    set: (next) => setGroundState(next),
  });
  // the controls of the selected light live in the properties panel
  propsEl("propLight").append(document.getElementById("lightPane")!.querySelector(".lightingControls")!);

  return {
    /** The Compiler tab was opened or left: the item under construction comes onto the selected character, or off it. */
    setCompiler(on: boolean) {
      if (on === compilerOn) return;
      compilerOn = on;
      if (on) void compiler.show(); else compiler.hide();
    },
    async onShown() {
      if (!els.isIndexed()) { els.info.textContent = "TF2 not indexed yet."; return; }
      void loadIcons();
      if (!viewer) await startFirstEntity();
    },
    async onIndexed() {
      void loadUnusualCatalog();
      void loadIcons();
      if (selected) await show(selected, selected.cls);
      else await startFirstEntity();
    },
  };
}
