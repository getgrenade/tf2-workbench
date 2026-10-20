import { shadowLayer, shadowOf, solidOf, type ShotEffects } from "./promo";
import { picturePsd } from "./promoPsd";
import { open, save } from "@tauri-apps/plugin-dialog";
import { createCompilerUi, type PreviewApplication } from "../compiler/compilerUi";
import { MODEL_EXTENSIONS } from "../compiler/importModel";
import { createPropPanel, PROP_DRAG_TYPE } from "../props/propPanel";
import { propLabel } from "../props/propList";
import { forgetThumbnail } from "../props/propThumbs";
import { decodeTga, encodeTga, iconProblem, ICON_SAFE_ROWS } from "../compiler/tga";
import { fadeAmount, maskIcon, type IconFade } from "../compiler/iconMask";
import { importSourceDir, readItemSession, readPropSession, saveItemIcon, buildItem, buildProp, loadTextureFrames, readSourceFile, revealFile, sourceSiblings, sourceStamp, mountItemZips } from "../api";
import { FILE_DROP_EVENT, type FileDropDetail } from "../fileDrop";
import { parseTextureFrames } from "./sourceMaterials";
import { getWeaponProfile, importEffectZip, removeCustomEffect, type WeaponProfile, type UnusualEffectInfo } from "../api";
import { lipSync, loadScene, phonemeClasses, scenePlaying, voiceLines, type VoiceLine } from "../api";
import { closeVoiceLines, openVoiceLines } from "./voiceLinesUi";
import { FaceDriver, type FaceLine } from "./faceDriver";
import type { FlexGlobals } from "./flex";
import type { LipSync, PhonemeClasses, SceneData } from "./faceScene";
import { loadVoice, setVoiceMuted, stopAll as stopVoices, voiceMuted } from "./voicePlayer";
import { listSequences, loadMaterial, loadModel, loadSession, prepareWorkshopTaunt, readTextFile, saveSession, rewriteModelFile, writeAdjustedModel, writeBinaryFile, writeTextFile, type WorkshopTaunt } from "../api";
import { loadItemDb, workshopItemsAsZipped } from "./itemCatalog";
import { openWorkshopStyles } from "./workshopStyles";
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
import { closePaintChart, openPaintChart, type ChartCell } from "./paintChart";
import { openRandomLoadout, regionLabel, rollLoadout, type LoadoutRule, type RollSettings } from "./randomLoadout";
import { choosePose, NOT_A_POSE, NOT_ROLLED_TAUNT, rollFace, type PoseChoice, type PoseSource } from "./randomPose";
import { layoutChart } from "./chartLayout";
import { bodyMasksLoaded } from "./bodyMasks";
import { DEFAULT_CHART, DEFAULT_TEXT, aimDirection, layer, measureContent, openPromo, textLayer, type ChartCellRect, pictureBlob, type ChartSpec, type PromoLayer, type PromoPicture, type PromoText, type ShotSpec } from "./promo";
import { showBoard, type BoardHost } from "./promoBoard";
import { forgetBoard, loadBoards, saveBoard, type Written } from "./promoStore";
import type { PaintChartOpts } from "./viewer";
import { isJunkSequence } from "./sequenceFilter";
import { paramsToSetup } from "../compiler/jiggleBones";
import { turnTowards } from "../compiler/boneAxes";
import type { JiggleParams } from "./jiggle";
import { defaultBodyGroupsFor, type BodyGroup } from "./bodyGroups";
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
import { bakeClip, blendingTaunts, createAnimUi, newAnimState, type AnimEls, type AnimState } from "./animUi";
import { createFlexUi, flexGlobalsFor, type FlexEls } from "./flexUi";
import { DEFAULT_FOV_X, DEFAULT_POINT_LIGHT, Viewer, type CosmeticSpec, type LightState, type PointLightState } from "./viewer";
import { createLightingUi } from "./lightingUi";
import { defaultLightingRig, newRigLight, parseLightingRig, type RigLight } from "./lighting";
import { blankUnusuals, parseUnusualSettings, loadUnusualCatalog as fetchUnusualCatalog, customEffectZips, type UnusualSettings } from "./particles/assets";
import { DEFAULT_SHADOW, type ShadowParams } from "./shadowMath";
import { CONDITION_CLASS, CONDITION_KEYS, CONDITION_LABELS, anyCondition, parseConditions, uberMaterialPath, type ConditionKey, cigaretteEffects } from "./conditions";
import { DEFAULT_FOG, MIST_PRESET, parseFog, type FogState } from "./fog";
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
    style: HTMLSelectElement;
    scale: HTMLInputElement;
    coverage: HTMLInputElement;
    detail: HTMLInputElement;
    speed: HTMLInputElement;
    wind: HTMLInputElement;
    shafts: HTMLInputElement;
    bands: HTMLInputElement;
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
  face: { scene: HTMLInputElement; mute: HTMLButtonElement; pick: HTMLSelectElement; keep: HTMLButtonElement; lines: HTMLButtonElement; info: HTMLElement };
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
    promo: HTMLButtonElement;
    randomLoadout: HTMLButtonElement;
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
  /** What drives the face now (the scene of the animation, a taunt's); see faceDriver.ts. */
  face?: FaceDriver | null;
  faceToken?: number;
  /** The look-up of the scene face of the animation now playing (settled when the face is on or known to be none). */
  facePending?: Promise<void>;
  /** The sliders' values from before a paused scene face was shown on them. */
  heldFlex?: Map<string, number>;
  /** The game class the character was last shown as (the Spy's cigarette is lit when it becomes a Spy). */
  classSeen?: string;
  /** The flex sliders hold a face a random roll put there. */
  rolledFlex?: boolean;
  /** The sounds the face's scene says (for the choice of line where a sound has several). */
  faceSounds?: { name: string; waves: string[] }[];
  /** The line picked for a sound of several (lower-case sound name -> index into its waves). */
  voicePicks?: Map<string, number>;
  /** A voice line the browser put on the face (its name); the animation's scene waits until it is let go. */
  faceVoiceLine?: string;
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
    pickFolder: async (current) => {
      const picked = await open({ multiple: false, directory: true, defaultPath: current || undefined });
      return typeof picked === "string" ? picked : null;
    },
    setPropPreview: (preview) => void showCompilerProp(preview),
    openPropSession: async (path) => {
      const file = path ?? (await open({ multiple: false, directory: false, filters: [{ name: "Prop session", extensions: ["txt"] }] }));
      return typeof file === "string" ? readPropSession(file) : null;
    },
    buildProp: async (request) => {
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
  /** The promo character being edited in 3D: the only one the view and the list show (the others are in other shots). */
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
  const flex = createFlexUi(els.flex, (globals) => {
    selected?.actor.setFlexControllers(globals);
    selected?.face?.touch(); // paused, the sliders are the face; it is theirs now
    selected?.face?.invalidate(); // a scene face goes over the sliders
  });
  const eyesFollow = document.getElementById("flexEyesFollow") as HTMLInputElement | null;
  if (eyesFollow) eyesFollow.onchange = () => { selected?.actor.setEyesFollowCamera(eyesFollow.checked); };
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
    const e: Entity = {
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
    // a new animation: the face of its scene (and its lines)
    actor.onClip = () => void refreshFace(e);
    return e;
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
    // the effects the worn items always show (a halo, a pipe's smoke) play with the ones chosen, each on its own item
    const own: NonNullable<UnusualSettings["items"]> = [...e.applied.flatMap((x) => (x.item.particles ?? []).map((p) => ({ item: x.item.id, ...p }))), ...cigaretteEffects(e.actor.conditions)];
    const chosen = e.unusuals;
    const settings: UnusualSettings = { ...chosen, ...(own.length ? { items: own } : {}) };
    e.unusualError = "";
    try { await viewer.setUnusuals(e.actor, settings, restart); }
    catch (err) {
      if (e.unusuals === chosen) e.unusualError = `Could not preview effects: ${String(err)}`;
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
    loadout = loadout.filter((x) => !x.hidden); // an item hidden with its eye stays in the loadout but is not worn
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
      // a worn item's bones the class lacks are posed by the item's own idle animation, as the game does (the old all-class hats are one
      // model for every class, fitted to each by that animation)
      if (!weaponClip && it !== weapon) weaponClip = await cosmeticIdleClip(path, cls);
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
    if (e === selected) renderJiggles();
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

  /** The first frame of a worn item's own first sequence, for the item's bones that the class does not have (null when it has none). */
  const idleClips = new Map<string, Promise<ClipData | null>>();
  async function cosmeticIdleClip(path: string, cls: string): Promise<ClipData | null> {
    const classBones = new Set((models.get(classPath(cls))?.bones ?? []).map((b) => b.name.toLowerCase()));
    if (classBones.size === 0) return null;
    const key = `${cls}|${path}`;
    let clip = idleClips.get(key);
    if (!clip) {
      clip = (async () => {
        let data = models.get(path);
        if (!data) {
          data = parsePayload(await loadModel(path));
          models.set(path, data);
        }
        if (!data.bones.some((b) => !classBones.has(b.name.toLowerCase()))) return null;
        const info = parseAnimInfo(await listSequences(path));
        if (!info.sequences.length) return null;
        return await bakeClip(path, info.sequences[0].index, info.poseParams.map((p) => p.default));
      })().catch(() => null);
      idleClips.set(key, clip);
    }
    return clip;
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
          return { ...w, ...("paint" in change ? { paint: change.paint ?? null } : {}), ...(change.style !== undefined ? { style: change.style } : {}), ...(change.hidden !== undefined ? { hidden: change.hidden } : {}) };
        });
        if (!touched) continue;
        e.items = { ...e.items, loadout };
        const cls = gameClassOf(e.cls);
        void applyLoadout(e, loadout.filter((w) => itemUsableBy(w.item, cls)));
      }
    },
    locked: () => (promoEditing && selected && promoEditing.ents.includes(selected) ? promoEditing.locked : []),
    refused: (item, because) => {
      const note = promoEditing?.bar.querySelector(".promoEditNote");
      if (!note) return;
      note.textContent = because
        ? `${item.displayName} was not put on: it would take off ${because.displayName}, the item being promoted (they share an equip region).`
        : `${item.displayName} stays on: it is the item being promoted.`;
      note.classList.add("warn");
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
    workshopStyles: (item) => openWorkshopStyles(workshopStylesHost, item.name),
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
  let refreshRun: Promise<void> | null = null;

  /** Rescans tf/workshop/import_source and reloads whatever came from it: the catalog, the models, materials and icons, and every character that wears one. */
  /**
   * Reloads the workshop cosmetics. One reload runs at a time: a call made while one runs waits for it and then reloads again, since
   * a zip may have been mounted after that one read the list (dropping a zip focuses the window, which starts a reload of its own).
   */
  function refreshWorkshopItems(quiet = false): Promise<void> {
    const before = refreshRun;
    const run = (async () => {
      await before;
      await reloadWorkshopItems(quiet);
    })();
    refreshRun = run;
    void run.finally(() => { if (refreshRun === run) refreshRun = null; });
    return run;
  }

  async function reloadWorkshopItems(quiet: boolean) {
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
      els.items.refresh.disabled = false;
    }
  }
  els.items.refresh.onclick = () => void refreshWorkshopItems();
  // which workshop items are styles of another: by their names, and linked by hand here; a change reads the catalog again
  const workshopStylesHost = {
    items: async () => { await loadItemDb(); return workshopItemsAsZipped(); },
    changed: () => refreshWorkshopItems(true),
  };
  els.items.workshopStyles.onclick = () => openWorkshopStyles(workshopStylesHost);
  // drop a workshop item .zip anywhere on the app to mount it in place (read-only, this session) and show it under the Workshop filter
  // (the places that take a file of their own, the compiler's file rows say, keep theirs: the nearest one under the pointer gets it)
  const dropZone = document.getElementById("view");
  const busyHost = document.getElementById("canvasWrap");
  if (dropZone && busyHost) {
    dropZone.setAttribute("data-file-drop", "");
    dropZone.classList.add("appDrop");
    dropZone.addEventListener(FILE_DROP_EVENT, (ev) => {
      const zips = (ev as CustomEvent<FileDropDetail>).detail.paths.filter((p) => p.toLowerCase().endsWith(".zip"));
      if (!zips.length) return;
      // shown at once over the view, so the drop is seen to be taken while the zip mounts and the catalog reloads
      const names = zips.map((z) => z.replace(/\\/g, "/").split("/").pop()!);
      const busy = document.createElement("div");
      busy.className = "dropBusy";
      busy.setAttribute("role", "status");
      busy.innerHTML = '<div class="dropBusyCard"><span class="dropBusySpin"></span><span></span></div>';
      const busyText = (text: string) => ((busy.querySelector(".dropBusyCard > span:last-child") as HTMLElement).textContent = text);
      busyText(`Loading ${names.length === 1 ? names[0] : `${names.length} zips`}…`);
      busyHost.appendChild(busy);
      const done = () => busy.remove();
      void (async () => {
        const say = (text: string) => { els.items.count.textContent = text; window.setTimeout(() => { if (els.items.count.textContent === text) els.items.count.textContent = ""; }, 8000); };
        const tell = (message: string) => {
          done();
          const back = document.createElement("div");
          back.className = "sceneDialogBack";
          back.innerHTML = '<div class="sceneDialog" role="dialog" aria-modal="true"><p></p><div class="btns"><button class="primary">OK</button></div></div>';
          (back.querySelector("p") as HTMLElement).textContent = message;
          (back.querySelector("button") as HTMLButtonElement).onclick = () => back.remove();
          document.body.appendChild(back);
        };
        try {
          els.items.count.textContent = `Mounting ${zips.length} zip${zips.length === 1 ? "" : "s"}…`;
          const before = await loadItemDb();
          const had = new Set([...before.items, ...before.taunts].filter((i) => i.workshop).map((i) => i.id));
          await mountItemZips(zips); // (the refresh that follows mounts them, once for all)
          await refreshWorkshopItems(true);
          const db = await loadItemDb();
          const added = [...db.items, ...db.taunts].filter((i) => i.workshop && !had.has(i.id));
          let item = added[0] as ItemInfo | undefined;
          let already = false;
          if (!item) {
            // the zip was already mounted (e.g. it is already in import_source): find its item by the zip's base name in the model path
            const stems = zips.map((z) => z.replace(/\\/g, "/").split("/").pop()!.replace(/\.zip$/i, "").toLowerCase()).filter(Boolean);
            const hits = (i: ItemInfo) => [i.model ?? "", ...Object.values(i.perClass)].some((p) => stems.some((s) => p.toLowerCase().includes(`/${s}/`)));
            item = [...db.items, ...db.taunts].find((i) => i.workshop && hits(i));
            already = !!item;
          }
          if (!item) { tell("Mounted the zip, but no workshop cosmetic matched it. Does it have a manifest and the usual models/materials layout?"); return; }
          const found = item;
          const more = added.length > 1 ? ` (and ${added.length - 1} more)` : "";
          const verb = already ? "Already in your workshop:" : "Mounted";
          const game = selected ? gameClassOf(selected.cls) : null;
          const canHere = !!game && itemUsableBy(found, game); // the loaded class can already wear it (an all-class item): no switch needed
          const targetCls = CLASSES.find((c) => itemUsableBy(found, c[2]))?.[1];
          const scope = () => document.querySelector<HTMLButtonElement>('#itemScopes [data-scope="workshop"]')?.click();
          const equipHere = async () => { // the loaded class can wear it: put it on the character that is loaded
            const e = selected; if (!e) return;
            const g = gameClassOf(e.cls);
            e.items = itemsUi.toggleFor(e.items, found, true, g);
            e.applied = e.items.loadout.filter((x) => itemUsableBy(x.item, g));
            await applyLoadout(e, e.applied);
            itemsUi.load(e.items);
            scope();
          };
          // switch this scene to the item's class and put it on, alone: the tab starts over, so what the old class wore goes (all-class items too)
          const switchAndEquip = async (mdl: string) => {
            const e = selected; if (!e) return;
            stopPlay();
            if (compilerOn) { showCompilerItem(null); compiler.selectionChanged(); }
            const g = gameClassOf(mdl);
            e.items = itemsUi.toggleFor({ loadout: [], activeId: null }, found, true, g);
            const wear = e.items.loadout.filter((x) => itemUsableBy(x.item, g));
            // the item panel re-applies its own list when the class changes: give it the new one first, or it puts the old loadout back
            itemsUi.load(e.items);
            await show(e, mdl); // loads the new class model (so the cosmetic has a skeleton to bind to) before applying
            await applyLoadout(e, wear);
            restoreUi(e);
            renderEntities();
            scope();
          };
          // "set up" = a scene with work worth keeping (cosmetics on, or several characters); a fresh single character is not
          const setUp = !!selected && !selected.actor.inspectOnly && (selected.items.loadout.length > 0 || entities.length > 1);
          if (canHere) { busyText(`Putting on “${found.displayName}”…`); await equipHere(); tell(`Equipped “${found.displayName}”${more} on the loaded character.`); return; }
          if (!targetCls) { scope(); tell(`${verb} “${found.displayName}”${more}, now under the Workshop filter.`); return; }
          if (!setUp) { busyText(`Switching class for “${found.displayName}”…`); await switchAndEquip(targetCls); tell(`Switched class and equipped “${found.displayName}”${more}.`); return; }
          // the scene is set up and the item is for another class: putting it on would switch this scene, so ask first
          const back = document.createElement("div");
          back.className = "sceneDialogBack";
          back.innerHTML = '<div class="sceneDialog" role="dialog" aria-modal="true"><p></p><div class="btns"><button>Cancel</button><button>Replace this tab</button><button class="primary">Open in a new tab</button></div></div>';
          (back.querySelector("p") as HTMLElement).textContent = `“${found.displayName}”${more} is for a different class, so putting it on would switch this scene. What would you like to do?`;
          const [cancel, replace, newTab] = Array.from(back.querySelectorAll("button")) as HTMLButtonElement[];
          const close = () => back.remove();
          cancel.onclick = () => { close(); scope(); say(`${verb} “${found.displayName}”${more}, under the Workshop filter.`); };
          replace.onclick = () => { close(); busyText(`Switching class for “${found.displayName}”…`); busyHost.appendChild(busy); void (async () => { await switchAndEquip(targetCls!); tell(`Switched class and equipped “${found.displayName}”${more}.`); })(); };
          newTab.onclick = () => { close(); void inspectItem(found, false); say(`${verb} “${found.displayName}”${more}, opened in a new tab.`); };
          done();
          document.body.appendChild(back);
        } catch (err) {
          tell(`Could not mount the zip: ${String(err)}`);
        } finally {
          done(); // a choice that still has loading to do (Replace this tab) puts the card back up
        }
      })();
    });
  }
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

  // The sound button next to the view modes: the voice lines' mute, which is remembered. Lit while muted, so a silent view is no surprise.
  const hudMute = document.getElementById("hudMute") as HTMLButtonElement | null;
  const SPEAKER = '<svg viewBox="0 0 24 24" style="fill:none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor"/>';
  const syncMuteButton = () => {
    const muted = voiceMuted();
    if (hudMute) {
      hudMute.innerHTML = SPEAKER + (muted ? '<path d="m16 9 5 6M21 9l-5 6"/>' : '<path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.500a9 9 0 0 1 0 13"/>') + "</svg>";
      hudMute.classList.toggle("on", muted);
      hudMute.setAttribute("aria-pressed", String(muted));
      hudMute.title = muted ? "Sound is off: click to hear the voice lines" : "Sound is on: click to mute the voice lines";
    }
  };
  syncMuteButton();
  if (hudMute) hudMute.onclick = () => { setVoiceMuted(!voiceMuted()); syncMuteButton(); renderFaceUi(); };

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
    // the Spy smokes by default: a character that becomes a Spy lights the cigarette (once for the class: it can be put out in the effects)
    const game = gameClassOf(cls);
    const becameSpy = game === "spy" && e.classSeen !== "spy";
    e.classSeen = game;
    if (becameSpy && !e.actor.conditions.cig) {
      ensureViewer().setConditions(e.actor, { ...e.actor.conditions, cig: true });
      void syncConditions(e);
      void applyUnusuals(e);
    }
    // an effect of one class (the Spy's cigarette) ends when the character becomes another
    const left = CONDITION_KEYS.filter((k) => e.actor.conditions[k] && CONDITION_CLASS[k] && CONDITION_CLASS[k] !== gameClassOf(cls));
    if (left.length && viewer) {
      viewer.setConditions(e.actor, { ...e.actor.conditions, ...Object.fromEntries(left.map((k) => [k, false])) });
      void syncConditions(e);
      if (left.includes("cig")) void applyUnusuals(e);
    }
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
    e.flex = e.face?.showing() && e.heldFlex ? e.heldFlex : flex.state();
  }

  // --- body groups: which model each part of the character shows ---------------------------------------------------

  const bodyBox = document.getElementById("bodyGroups") as HTMLElement | null;
  const bodyReset = document.getElementById("bodyReset") as HTMLButtonElement | null;
  const bodyAll = document.getElementById("bodyAll") as HTMLButtonElement | null;
  const bodyNone = document.getElementById("bodyNone") as HTMLButtonElement | null;

  /** One drop-down per body part that has more than one model, showing what is set (by hand, else by a cosmetic, else the default). */
  /**
   * The character's parts, one list: each part that can be drawn or not (a checkbox), with the model's own switch beside it when the
   * part is one of the model's bodygroups (the stepper: which of its models shows). The model's bodygroups are the left column, in bold,
   * and the parts that are only drawn or not (the hide groups) the right one.
   */
  function renderBodygroups() {
    if (!bodyBox) return;
    bodyBox.replaceChildren();
    const e = selected;
    const data = e ? models.get(classPath(e.cls)) : null;
    const parts = new Map((data?.bodyParts ?? []).filter((bp) => bp.models.length > 1).map((bp) => [bp.name.toLowerCase(), bp] as const));
    const groups = e?.actor.bodyGroups ?? [];
    if (bodyReset) bodyReset.disabled = !e || e.bodyManual.size === 0;
    for (const b of [bodyAll, bodyNone]) if (b) b.disabled = !e || groups.length === 0;
    if (!e || !data || (parts.size === 0 && groups.length === 0)) {
      const none = document.createElement("div");
      none.className = "dim hint";
      none.textContent = data ? "This model has no bodygroups." : "";
      bodyBox.appendChild(none);
      return;
    }
    const column = (title: string) => {
      const col = document.createElement("div");
      col.className = "bgCol";
      col.title = title;
      return col;
    };
    const left = column("The model's own bodygroups: which of their models shows (the arrows), and whether they are drawn"), right = column("The parts of the body that can be hidden");
    const shown = e.actor.visibleRegions;
    const all = () => new Set(shown.has("*") ? groups.map((g) => g.id) : shown);
    const row = (into: HTMLElement, text: string, title: string, group: BodyGroup | null, bp: { name: string; models: unknown[] } | null, bold: boolean) => {
      const label = document.createElement("label");
      label.className = "bgRow" + (bold ? " valve" : "");
      label.title = title;
      if (group) {
        const check = document.createElement("input");
        check.type = "checkbox";
        check.checked = shown.has("*") || shown.has(group.id);
        check.onchange = () => {
          const next = all();
          if (check.checked) next.add(group.id); else next.delete(group.id);
          e.actor.setVisibleRegions(next);
          renderBodygroups();
        };
        label.appendChild(check);
      } else {
        const pad = document.createElement("span");
        pad.className = "bgPad";
        label.appendChild(pad);
      }
      label.append(text);
      const cell = document.createElement("div");
      if (bp) {
        const key = bp.name.toLowerCase();
        const count = bp.models.length;
        const manual = e.bodyManual.get(key);
        const current = Math.min(Math.max(0, manual ?? e.bodyItems[key] ?? e.bodyItems[bp.name] ?? 0), count - 1);
        cell.className = "stepper" + (manual !== undefined ? " manual" : "");
        cell.title = `Which of its ${count} models shows: ${manual !== undefined ? "set by hand" : key in e.bodyItems ? "set by a cosmetic" : "the default"}`;
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
        cell.append(arrow("‹", -1), value, arrow("›", 1));
      }
      into.append(label, cell);
    };
    // the model's own bodygroups first (the parts of the same name, then the switches that are no part), then a line, then the rest
    const valve = groups.filter((g) => parts.has(g.id));
    for (const g of valve) row(left, g.label, g.id, g, parts.get(g.id)!, true);
    for (const bp of parts.values()) if (!valve.some((g) => g.id === bp.name.toLowerCase())) row(left, bp.name.replace(/_/g, " "), bp.name, null, bp, true);
    const rest = groups.filter((g) => !parts.has(g.id));
    for (const g of rest) row(right, g.label, g.id, g, null, false);
    // a model with only one kind has the one column, the whole width
    bodyBox.classList.toggle("twoCols", parts.size > 0 && rest.length > 0);
    if (parts.size) bodyBox.appendChild(left);
    if (rest.length) bodyBox.appendChild(right);
  }

  async function applyBodygroups(e: Entity) {
    const merged = { ...e.bodyItems, ...Object.fromEntries(e.bodyManual) };
    await ensureGroupMaterials(e, merged); // the model a group switches on may bring materials that are not loaded yet
    e.actor.setBodygroups(merged);
  }
  if (bodyAll) bodyAll.onclick = () => { const e = selected; if (!e) return; e.actor.setVisibleRegions(new Set(e.actor.bodyGroups.map((g) => g.id))); e.actor.setHandMaskState(undefined); renderBodygroups(); };
  if (bodyNone) bodyNone.onclick = () => { const e = selected; if (!e) return; e.actor.setVisibleRegions(new Set()); renderBodygroups(); };
  if (bodyReset) {
    bodyReset.onclick = () => {
      const e = selected;
      if (!e) return;
      e.bodyManual.clear();
      applyBodygroups(e);
      renderBodygroups();
    };
  }

  // --- jiggle bones: a read-only look at the spring physics of a loaded model's jiggle bones, for studying -----------------------

  const jiggleBlock = document.getElementById("jiggleBlock") as HTMLElement | null;
  const jiggleList = document.getElementById("jiggleList") as HTMLElement | null;
  /** The jiggle bone whose visualizers and parameters are shown (by name, as the worn cosmetics name it); null when none is open. */
  let selectedJiggle: string | null = null;

  function clearJiggleDrawing() {
    viewer?.setBoneHelper(null, null);
    viewer?.setBoneAimHandle(null);
    viewer?.setBoneGizmo(null);
  }

  const degStr = (radians: number) => `${Math.round((radians * 180 / Math.PI) * 100) / 100}°`;
  const numStr = (v: number) => String(Math.round(v * 1000) / 1000);

  /** The read-only parameter readout under an open jiggle bone. Angles are shown in degrees; the solver-ignored fields are fenced off. */
  function jiggleDetails(params: JiggleParams): HTMLElement {
    const s = paramsToSetup(params);
    const wrap = document.createElement("div");
    wrap.className = "jiggleDetails";
    const row = (label: string, value: string, title?: string) => {
      const r = document.createElement("div");
      r.className = "cosRow";
      const a = document.createElement("span");
      a.textContent = label;
      const b = document.createElement("span");
      b.textContent = value;
      if (title) b.title = title;
      r.append(a, b);
      wrap.appendChild(r);
    };
    const head = (t: string) => {
      const h = document.createElement("div");
      h.className = "jiggleSub";
      h.textContent = t;
      wrap.appendChild(h);
    };
    row("Type", s.mode === "flexible" ? "Flexible" : "Rigid");
    row("Length", numStr(s.length));
    row("Tip mass", numStr(s.tipMass));
    if (s.mode === "flexible") {
      head("Flex");
      row("Yaw stiffness / damping", `${numStr(s.yawStiffness)} / ${numStr(s.yawDamping)}`);
      row("Pitch stiffness / damping", `${numStr(s.pitchStiffness)} / ${numStr(s.pitchDamping)}`);
      row("Length", s.allowLengthFlex ? `flex (along ${numStr(s.alongStiffness)} / ${numStr(s.alongDamping)})` : "fixed");
    }
    if (s.yaw.on || s.pitch.on || s.angle.on) {
      head("Constraints");
      if (s.yaw.on) row("Yaw range", `${degStr(params.minYaw)} … ${degStr(params.maxYaw)}`);
      if (s.pitch.on) row("Pitch range", `${degStr(params.minPitch)} … ${degStr(params.maxPitch)}`);
      if (s.angle.on) row("Angle limit", degStr(params.angleLimit));
    }
    if (s.baseSpring.on) {
      const b = s.baseSpring;
      head("Base spring");
      row("Mass / stiffness / damping", `${numStr(b.mass)} / ${numStr(b.stiffness)} / ${numStr(b.damping)}`);
      row("Left min / max", `${numStr(b.left.min)} … ${numStr(b.left.max)}`);
      row("Up min / max", `${numStr(b.up.min)} … ${numStr(b.up.max)}`);
      row("Forward min / max", `${numStr(b.forward.min)} … ${numStr(b.forward.max)}`);
    }
    if (s.boing.on) {
      const b = s.boing;
      head("Boing");
      row("Impact speed / angle", `${numStr(b.impactSpeed)} / ${numStr(b.impactAngle)}°`);
      row("Damping / frequency / amplitude", `${numStr(b.dampingRate)} / ${numStr(b.frequency)} / ${numStr(b.amplitude)}`);
    }
    // the four the Source solver never reads (the original MDL reader skipped them): kept apart so they don't read as live physics
    if (s.yaw.on || s.pitch.on) {
      head("Stored, not simulated");
      if (s.yaw.on) row("Yaw friction / bounce", `${numStr(s.yaw.friction)} / ${numStr(s.yaw.bounce)}`, "Carried in the model but ignored by the jiggle solver");
      if (s.pitch.on) row("Pitch friction / bounce", `${numStr(s.pitch.friction)} / ${numStr(s.pitch.bounce)}`, "Carried in the model but ignored by the jiggle solver");
    }
    return wrap;
  }

  /** Lists the selected character's jiggle bones and draws the open one's axes, spring and constraints (no editing gizmo). */
  function renderJiggles() {
    if (!jiggleBlock || !jiggleList) return;
    // the compiler drives the viewer's bone helper itself; stay out of its way while it is open
    if (compilerOn) return;
    const e = selected;
    const bones = e && propsKind === "character" && !isBuildingCls(e.cls) ? e.actor.simulatedJiggleBones() : [];
    if (selectedJiggle && !bones.some((b) => b.name === selectedJiggle)) selectedJiggle = null;
    jiggleBlock.hidden = bones.length === 0;
    jiggleList.replaceChildren();
    const open = bones.find((b) => b.name === selectedJiggle);
    if (open && e) {
      // the white-tip handle shows only while the bone is overridden (posed by hand); dragging it aims the bone, clamped to its limits, so
      // the handle stops at the cone. The helper (axes/limits) stays on the fixed goal as the reference, and drops its own rest tip so the
      // draggable handle is the only white sphere.
      const overridden = e.actor.boneOverridden(open.name);
      viewer?.setBoneHelper({ bone: open.name, setup: paramsToSetup(open.params), hideTip: overridden }, e.actor);
      viewer?.setBoneAimHandle(overridden ? {
        bone: open.name, actor: e.actor, length: paramsToSetup(open.params).length,
        onAim: (dir) => e.actor.setBoneAim(open.name, turnTowards(dir)),
      } : null);
    } else clearJiggleDrawing();
    if (bones.length) {
      const hint = document.createElement("div");
      hint.className = "dim hint";
      hint.textContent = "Select a bone to see its spring and limits. Tick “Override rotation (pose)” to pose it by hand: drag the white handle at the tip, and the aim stays within the bone’s limits. Play an animation to watch it jiggle and hit those limits on its own.";
      jiggleList.appendChild(hint);
    }
    for (const bone of bones) {
      const row = document.createElement("button");
      row.className = "jiggleRow" + (bone.name === selectedJiggle ? " on" : "");
      row.textContent = bone.name;
      row.title = bone.name;
      row.onclick = () => {
        selectedJiggle = selectedJiggle === bone.name ? null : bone.name;
        renderJiggles();
      };
      jiggleList.appendChild(row);
      if (bone.name === selectedJiggle) {
        jiggleList.appendChild(jiggleDetails(bone.params));
        const overridden = !!e && e.actor.boneOverridden(bone.name);
        const label = document.createElement("label");
        label.className = "jiggleOverride";
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = overridden;
        box.onchange = () => {
          if (!e) return;
          e.actor.setBoneOverride(bone.name, box.checked);
          renderJiggles();
        };
        label.append(box, document.createTextNode(" Override rotation (pose)"));
        jiggleList.appendChild(label);
        if (overridden) {
          const reset = document.createElement("button");
          reset.className = "jiggleReset";
          reset.textContent = "Reset aim";
          reset.title = "Return the bone to its rest orientation (still overridden)";
          reset.onclick = () => { e?.actor.setBoneAim(bone.name, null); renderJiggles(); };
          jiggleList.appendChild(reset);
        }
      }
    }
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
    if (key === "cig") void applyUnusuals(e); // the cigarette plays with the effects of what he wears
    if (e === selected) renderConditions();
  }
  if (condReset) {
    condReset.onclick = () => {
      const e = selected;
      if (!e) return;
      ensureViewer().setConditions(e.actor, parseConditions(null));
      void applyUnusuals(e);
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
    title.textContent = "LOD";
    title.title = "Level of detail";
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
      }, false)
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
    renderJiggles();
    bodyPicker?.sync();
    itemsUi.load(e.items);
    weapons.load(e.held);
    flex.restore(e.flex, models.get(classPath(e.cls)) ?? null);
    e.heldFlex = undefined;
    e.face?.invalidate(); // a paused scene face is shown on the sliders again
    if (eyesFollow) eyesFollow.checked = e.actor.followsCamera;
    renderBuildingPanel();
    anim.show(e.anim, e.actor);
    renderFaceUi();
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
    // a different character: forget the open jiggle bone so its drawing does not carry over
    selectedJiggle = null;
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
    clearFace(e);
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
  rigControls = createRigControls({ slot: H.rigSlot, button: H.rigButton, setMode: (on) => H.setRigMode(on), viewer: () => viewer, actor: () => selected?.actor ?? null, cls: () => selected?.cls ?? "", changed: () => { els.pose.hud.undo.disabled = !selected?.actor.canUndo; els.pose.hud.redo.disabled = !selected?.actor.canRedo; } });
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
      collide: (x, y, z, vx, vz) => {
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
    const base = `${options.source === "turntable" ? "turntable" : "loadout"}-${stamp}`;
    // a PNG sequence goes into a folder, as <base>_0001.png, <base>_0002.png, …
    const sequence = options.format === "png";
    const picked = sequence
      ? await open({ directory: true, title: "Folder for the PNG frames" })
      : await save({ defaultPath: `${base}.${options.format}`, filters: [{ name: options.format.toUpperCase(), extensions: [options.format] }] });
    const path = typeof picked === "string" ? picked : null;
    if (!path) { report(""); return; }
    const sep = path.includes("\\") ? "\\" : "/";
    const framePath = (i: number) => `${path.replace(/[\\/]+$/, "")}${sep}${base}_${String(i + 1).padStart(4, "0")}.png`;
    const buttons = [els.capture.shot, els.capture.psd];
    buttons.forEach((b) => (b.disabled = true));
    const started = performance.now();
    try {
      const result = await recordVideo(v, options, (p) => {
        const seconds = (performance.now() - started) / 1000;
        report(p.phase === "rendering" ? `Rendering frame ${p.done} of ${p.total}… ${seconds.toFixed(0)} s` : options.format === "gif" ? "Optimizing the GIF…" : "Finishing the file…");
      }, signal, sequence ? (i, png) => writeBinaryFile(framePath(i), png) : undefined);
      if (sequence) {
        report(`Saved ${result.frames} frames, ${result.width}×${result.height}: ${framePath(0)} …`);
        return;
      }
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

  // --- the paint chart: the inspected cosmetic in every paint, drawn live from the view's camera into an editor window ----------------

  /**
   * Opens the paint chart editor for the selected character's paintable cosmetic (the active one, else the first; an Inspect scene's
   * item). Every picture is the item as the view's camera sees it, so
   * orbiting, panning or zooming the view moves them all at once; the editor lays them out and saves the PNG.
   */
  /**
   * The pictures of a paint chart of an item a character wears: unpainted first (when asked), then every paint; a team paint once per
   * team in that team's skin (or only in the character's team).
   */
  async function paintCells(e: Entity, worn: Equipped, unpainted: boolean | "both", teams: "both" | "own"): Promise<ChartCell[]> {
    const db = await loadItemDb();
    const skinOf = (team: number) => itemSkinFor(worn.item, team, worn.style) ?? team;
    // both skins' materials, so a BLU picture is drawn in the BLU skin
    for (const path of [itemModelFor(worn.item, gameClassOf(e.cls), worn.style), ...(worn.item.extraModels ?? [])]) {
      const data = path ? models.get(path) : undefined;
      if (data) for (const t of [0, 1]) await ensureMaterials(data, skinOf(t));
    }
    const own = skinOf(e.team);
    const out: ChartCell[] = [];
    if (unpainted === "both") out.push({ label: "Unpainted (RED)", paint: null, skin: skinOf(0) }, { label: "Unpainted (BLU)", paint: null, skin: skinOf(1) });
    else if (unpainted) out.push({ label: "Unpainted", paint: null, skin: own });
    for (const p of db.paints as PaintInfo[]) {
      if (p.rgb2 !== null && p.rgb2 !== p.rgb) {
        if (teams === "both") out.push({ label: `${p.displayName} (RED)`, paint: unpackRgb(p.rgb), skin: skinOf(0) }, { label: `${p.displayName} (BLU)`, paint: unpackRgb(p.rgb2), skin: skinOf(1) });
        else out.push({ label: p.displayName, paint: unpackRgb(e.team === 1 ? p.rgb2 : p.rgb), skin: own });
      } else out.push({ label: p.displayName, paint: unpackRgb(p.rgb), skin: own });
    }
    return out;
  }

  function makePaintChart() {
    const v = viewer, e = selected;
    const status = els.capture.status;
    const paintable = e?.items.loadout.filter((x) => x.item.paintable) ?? [];
    const worn = paintable.find((x) => x.item.id === e?.items.activeId) ?? paintable[0];
    if (!v || !e || !worn) {
      status.textContent = "Paint chart: the selected character wears nothing paintable. Put on a paintable cosmetic (or Inspect one) first.";
      return;
    }
    // the head can be shown with the item while the chart is open (an inspected hat often shows no character at all); the scene's
    // own parts come back when it closes
    const regions = [...e.actor.visibleRegions];
    const headIds = e.actor.bodyGroups.filter((g) => g.category === "head").map((g) => g.id);
    const headHidden = !regions.includes("*") && headIds.some((id) => !regions.includes(id));
    let headAdded = false;
    const showHead = (on: boolean) => {
      if (on === headAdded) return;
      headAdded = on;
      e.actor.setVisibleRegions(on ? [...new Set([...regions, ...headIds])] : regions);
    };
    openPaintChart({
      title: `${worn.item.displayName}: paint chart`,
      team: e.team === 1 ? "BLU" : "RED",
      cells: ({ unpainted, teams }) => paintCells(e, worn, unpainted, teams),
      render: (cells, o, w, h) => v.renderPaintChart(e.actor, cells, o, w, h, worn.item.id),
      viewStamp: () => v.cameraStamp(),
      showHead: headHidden ? showHead : undefined,
      save: async (blob) => {
        const path = await save({ defaultPath: `${worn.item.displayName.replace(/[^\w\- ]+/g, "")} paints.png`, filters: [{ name: "PNG image", extensions: ["png"] }] });
        if (!path) return;
        await writeBinaryFile(path, new Uint8Array(await blob.arrayBuffer()));
        status.textContent = `Saved paint chart: ${path}`;
      },
      closed: () => { showHead(false); v.releasePaintChart(); },
    });
  }

  // --- random loadouts: cosmetics (and poses) rolled by the rules of the Random loadout window, for one character or a row of them ------

  /** The characters the last roll added beside the selected one (by id); a roll with fewer characters takes them out again. */
  let rolledExtras: number[] = [];
  /** A random pose is stopped on a frame where the character is this much taller than wide on screen (or as near to it as it gets). */
  const COMFORT_SHAPE: [number, number] = [1.4, 2.8];
  /** A pose's pelvis-to-head line is at most this far from upright (cos 37°): sitting and a bow are poses, falling over is not. */
  const UPRIGHT_MIN = 0.8;
  /** A frame whose limbs and spine are on average less than this many degrees from the reference pose is that pose (or a blend into it). */
  const BIND_MIN_DEGREES = 14;
  /** A held weapon whose bone is farther than this from both hands (model units) is not held in that frame: the animation let go of it. */
  const WEAPON_LET_GO = 12;

  const pickOne = <T,>(list: readonly T[]): T | undefined => list[Math.floor(Math.random() * list.length)];

  /**
   * Stops the character's animation on a frame where it keeps a comfortable shape on screen (a random one of those, for variety), and
   * stands upright. False when no frame tried stands (it then stops on the best shaped of them).
   */
  function settlePose(e: Entity): { stands: boolean; dropped: boolean } {
    const v = viewer, pb = e.actor.playback, clip = pb.clip;
    if (!v || !clip || clip.frames <= 1) return { stands: true, dropped: false };
    const span = (clip.frames - 1) / clip.fps;
    // a taunt is only itself outside the blends over the weapon's stand pose at its start and end: a frame in them is not a pose
    const window = e.anim.info?.sequences.find((q) => q.index === e.anim.seq)?.window;
    const [from, to] = window && blendingTaunts() ? [span * window[0], span * window[1]] : [0, span];
    const tries = 14;
    const scored: { t: number; off: number; dropped: boolean }[] = [];
    for (let i = 0; i < tries; i++) {
      const t = from + ((to - from) * (i + Math.random())) / tries;
      pb.time = t;
      e.actor.poseBones();
      // a frame that tips the character over is not a pose, nor one still (mostly) in the skeleton's raw reference pose (some taunts
      // start in it and blend out of it, and the reference pose is turned to lie along the floor)
      const up = e.actor.uprightness(), fromBind = e.actor.distanceFromBind();
      const lying = (up !== null && up < UPRIGHT_MIN) || (fromBind !== null && fromBind < BIND_MIN_DEGREES);
      // a weapon held, but not in the hands in this frame (dropped by the feet): a frame where it is in them is better
      const reach = e.held ? e.actor.weaponReach() : null;
      const dropped = reach !== null && reach > WEAPON_LET_GO;
      const shape = v.screenShape(e.actor);
      if (shape === null) continue;
      const [lo, hi] = COMFORT_SHAPE;
      scored.push({ t, dropped, off: (lying ? 100 : 0) + (dropped ? 10 : 0) + (shape < lo ? Math.log(lo / shape) : shape > hi ? Math.log(shape / hi) : 0) });
    }
    if (!scored.length) return { stands: true, dropped: false };
    const best = Math.min(...scored.map((s) => s.off));
    const pick = pickOne(scored.filter((s) => s.off <= best + 1e-6))!;
    pb.time = pick.t;
    pb.playing = false;
    e.actor.poseBones();
    return { stands: best < 100, dropped: pick.dropped };
  }

  /**
   * A random face on the flex sliders (see rollFace). Replaces what the sliders held.
   */
  async function rollFlexes(e: Entity) {
    const shapes = Object.values((await mouthShapesOf(e))?.normal ?? {});
    setRolledFlexes(e, rollFace(controllersOf(e), shapes));
  }

  /** What a random roll does to the face once the pose is settled: a face of the animation's own (a taunt's scene) stays, the rest gets a random one. */
  async function randomFace(e: Entity) {
    await e.facePending;
    if (!e.face) await rollFlexes(e);
    else if (e.rolledFlex) clearRolledFlexes(e); // the face of the scene is not over the last roll's
  }

  /** The face the character shows now as flex values (the scene's at the paused moment, else the sliders'), for a shot to keep. */
  function currentFace(e: Entity): Record<string, number> | undefined {
    const values = e.face ? new Map(e.face.face(e.face.setup.clock(e.actor.playback))) : e.flex;
    const out = Object.fromEntries([...values].filter(([, v]) => Math.abs(v) > 0.001));
    return Object.keys(out).length ? out : undefined;
  }

  /** What a random roll picks its poses from, for the class of `e` (the class model's animations once it is loaded). */
  async function poseSource(e: Entity, props: boolean): Promise<PoseSource> {
    const db = await loadItemDb();
    return { game: gameClassOf(e.cls), taunts: db.taunts, weapons: db.weapons, sequences: e.anim.info?.sequences ?? [], poseParams: e.anim.info?.poseParams ?? [], props };
  }

  function setRolledFlexes(e: Entity, values: Map<string, number>) {
    e.flex = values;
    e.heldFlex = undefined;
    e.rolledFlex = values.size > 0;
    if (e === selected) flex.restore(values, models.get(classPath(e.cls)) ?? null);
    e.actor.setFlexControllers(flexBase(e));
    e.face?.invalidate();
  }
  const clearRolledFlexes = (e: Entity) => setRolledFlexes(e, new Map());

  /** Rolls the scene: the selected character and the ones beside it, each with its own loadout (and pose). Resolves to a report. */
  async function rollScene(s: RollSettings): Promise<string> {
    const v = viewer, base = selected;
    if (!v || !base || isBuildingCls(base.cls)) return "Select a character first.";
    if (play?.active) stopPlay();
    const db = await loadItemDb();
    const conflicts = (a: ItemInfo, b: ItemInfo) => a.equipRegions.some((ra) => b.equipRegions.some((rb) => ra === rb || db.equipConflicts[ra]?.includes(rb) || db.equipConflicts[rb]?.includes(ra)));
    const named = s.rules.filter((r) => r.mode === "include" && r.kind === "item").map((r) => db.items.find((i) => String(i.id) === r.value)).filter((i): i is ItemInfo => !!i);
    const wears = (item: ItemInfo, game: string) => itemUsableBy(item, game) && itemModelFor(item, game) !== null;
    const fitsClass = (game: string) => named.every((item) => wears(item, game));
    const label = (mdl: string) => CLASSES.find((c) => c[1] === mdl)?.[0] ?? mdl;
    const classes = CLASSES.filter((c) => fitsClass(c[2]));
    if (s.classes === "same" && !fitsClass(gameClassOf(base.cls))) return `${named.find((i) => !wears(i, gameClassOf(base.cls)))?.displayName} is not for the ${label(base.cls)}. Switch class, or roll a random class each.`;
    if (!classes.length) return "No class can wear every item the rules name.";
    saveUi(base);
    // the cast: the selected character, the ones the last roll added (still in the scene), and new ones up to the number asked for
    const extras = rolledExtras.map((id) => entities.find((e) => e.id === id)).filter((e): e is Entity => !!e && e !== base);
    while (extras.length > s.copies - 1) removeEntity(extras.pop()!);
    while (extras.length < s.copies - 1) {
      const e = newEntity(v.addActor(), base.cls, base.team);
      e.group = base.group;
      e.actor.setScale(base.actor.scale);
      e.held = base.held;
      entities.push(e);
      extras.push(e);
    }
    rolledExtras = extras.map((e) => e.id);
    v.select(base.actor); // adding a character selects it in the view; the selected one stays selected
    renderEntities();
    const cast = [base, ...extras];
    const used = new Set<string>();
    let worn = "";
    for (const e of cast) {
      // a new character has no model yet: it gets its class below whatever the roll says
      const fresh = !e.actor.hasModel;
      const mdl = s.classes === "same" ? base.cls : pickOne(classes)![1];
      const game = gameClassOf(mdl);
      const pool = db.items.filter((i) => i.slot !== "taunt" && wears(i, game));
      const rolled = rollLoadout(pool, db.paints, conflicts, s.rules, s);
      if ("failed" in rolled) {
        const r = rolled.failed;
        const what = r.kind === "medal" ? "a medal" : r.kind === "item" ? db.items.find((i) => String(i.id) === r.value)?.displayName ?? "that item" : regionLabel(r.value).toLowerCase();
        return `Nothing the ${label(mdl)} can wear meets “must include ${what}” with the other rules.`;
      }
      const loadout: Equipped[] = rolled.items.map((x) => ({ item: x.item, paint: x.paint, style: x.style }));
      // the pose: a taunt is held (it plays its own animation); an animation drops a held taunt
      const free = !e.actor.isPosing && !e.actor.holdsPose;
      const kind = !free ? "keep" : s.pose === "mix" ? (Math.random() < 0.5 ? "taunt" : "anim") : s.pose;
      let taunt: ItemInfo | null = null;
      if (kind === "taunt") {
        const chosen = choosePose("taunt", { game, taunts: db.taunts, weapons: [], sequences: [], poseParams: [], props: true }, used);
        if (chosen?.kind === "taunt") { taunt = chosen.taunt; used.add(chosen.id); e.held = taunt; }
      } else if (kind === "anim" && e.held?.slot === "taunt") e.held = null;
      e.items = { loadout, activeId: loadout.at(-1)?.item.id ?? null };
      e.applied = loadout;
      if (e === selected) {
        // the panels re-apply their own lists when the class changes: they get the new ones first
        itemsUi.load(e.items);
        weapons.load(e.held);
      }
      if (fresh || e.cls !== mdl) await show(e, mdl); // loads the class (the loadout goes on with it)
      else await applyLoadout(e, loadout);
      if (kind === "taunt" && taunt) playWeaponAnimation(e, taunt);
      else if (kind === "anim" && e.anim.info) {
        // a weapon animation (standing or running with one), with a weapon of that animation in the hands and its pose parameters rolled
        const chosen = choosePose("anim", { ...(await poseSource(e, true)), game }, used);
        if (chosen?.kind === "anim") {
          used.add(chosen.id);
          e.held = chosen.weapon;
          if (e === selected) weapons.load(e.held);
          await applyLoadout(e, loadout);
          anim.applyHeld(e.actor, e.anim, [chosen.seq.name], chosen.params);
        }
      }
      if (kind !== "keep") {
        await e.anim.pending;
        settlePose(e);
        if (s.flex) await randomFace(e);
      }
      if (e === base) worn = loadout.map((x) => x.item.displayName).join(", ") || "nothing";
    }
    if (selected) restoreUi(selected);
    renderEntities();
    v.focusAll();
    return cast.length > 1 ? `Rolled ${cast.length} characters. The selected one wears: ${worn}.` : `Wearing: ${worn}.`;
  }

  els.capture.randomLoadout.onclick = () =>
    openRandomLoadout({
      className: () => CLASSES.find((c) => c[1] === selected?.cls)?.[0] ?? "",
      catalog: async () => {
        const db = await loadItemDb();
        const pool = db.items.filter((i) => i.slot !== "taunt");
        const regions = [...new Set(pool.flatMap((i) => i.equipRegions))].sort();
        return { regions, items: [...pool].sort((a, b) => a.displayName.localeCompare(b.displayName)) };
      },
      roll: rollScene,
    });

  // --- scene faces: the scene that goes with an animation (a taunt's) drives the face (its expressions, and the mouth of what it says) ---

  const SCENE_FACES_KEY = "tf2workbench.sceneFaces";
  let sceneFaces = (() => { try { return localStorage.getItem(SCENE_FACES_KEY) !== "0"; } catch { return true; } })();
  const sceneCache = new Map<string, Promise<SceneData | null>>();
  const loadSceneCached = (path: string) => {
    const key = path.toLowerCase();
    let p = sceneCache.get(key);
    if (!p) sceneCache.set(key, (p = loadScene(key).catch(() => null)));
    return p;
  };
  /** Which taunt scene plays a sequence, by class and sequence name (null: none does). */
  const playingCache = new Map<string, Promise<string | null>>();
  const lipCache = new Map<string, Promise<LipSync | null>>();
  const lipOf = (wave: string) => {
    let p = lipCache.get(wave);
    if (!p) lipCache.set(wave, (p = lipSync(wave).catch(() => null)));
    return p;
  };
  const phonemeCache = new Map<string, Promise<Partial<Record<"plain" | "hwm", PhonemeClasses>> | null>>();
  /** The character's own controller values (the sliders). */
  const flexBase = (e: Entity) => flexGlobalsFor(models.get(classPath(e.cls)) ?? null, e === selected ? flex.state() : e.flex);
  const controllersOf = (e: Entity) => new Set((models.get(classPath(e.cls))?.flexControllers ?? []).map((c) => c.name.toLowerCase()));
  /** The mouth shapes for a character: of the class's two sets, the one that drives the controllers its model has. */
  async function mouthShapesOf(e: Entity): Promise<PhonemeClasses | null> {
    const game = gameClassOf(e.cls);
    let p = phonemeCache.get(game);
    if (!p) phonemeCache.set(game, (p = phonemeClasses(game).catch(() => null)));
    const have = controllersOf(e);
    const fit = (set: PhonemeClasses) => new Set(Object.values(set.normal ?? {}).flat().map(([c]) => c.toLowerCase()).filter((c) => have.has(c))).size;
    return Object.values((await p) ?? {}).sort((a, b) => fit(b) - fit(a)).find((set) => fit(set) > 0) ?? null;
  }
  /**
   * The line a sound plays for a character: the one picked for it, else the first of the sound's pool. The game picks one at random each
   * time; a scene here stays the same every time it plays.
   */
  const waveFor = (e: Entity, sound: { name: string; waves: string[] }) => sound.waves[Math.min(e.voicePicks?.get(sound.name.toLowerCase()) ?? 0, sound.waves.length - 1)];

  /** Paused, the sliders show the face the scene gives (so it can be edited and reset); null puts the character's own values back. */
  function showFace(e: Entity, values: FlexGlobals | null) {
    const data = models.get(classPath(e.cls)) ?? null;
    if (!values) {
      if (e === selected && e.heldFlex) flex.restore(e.heldFlex, data);
      e.heldFlex = undefined;
      return;
    }
    if (e !== selected) return;
    e.heldFlex ??= flex.state();
    flex.restore(values, data);
  }

  function clearFace(e: Entity) {
    e.faceToken = (e.faceToken ?? 0) + 1;
    if (!e.face) return;
    showFace(e, null); // a face shown on the sliders while paused gives them back
    e.face.dispose();
    e.face = null;
    e.actor.faceDriver = null;
    e.actor.setFlexControllers(flexBase(e));
    if (e === selected) renderFaceUi();
  }

  /**
   * Looks up the scene of what the character plays and puts it on the face, in step with the animation: its expressions and flex
   * animations, and the lines its speak events say (heard, for the selected character, with their mouth shapes from the game's phoneme
   * data). The scene is the held taunt item's own (items_game names it), else the class's scene of the sequence's name
   * (`scenes/player/heavy/low/taunt05.vcd`, how the stock weapon taunts' scenes are filed), else the scene of whichever taunt item plays
   * this sequence (a taunt's animation picked from the list); in each case only one that plays this very sequence.
   */
  function refreshFace(e: Entity): Promise<void> {
    return (e.facePending = refreshFaceNow(e));
  }
  async function refreshFaceNow(e: Entity) {
    if (e.faceVoiceLine) return;
    const token = (e.faceToken = (e.faceToken ?? 0) + 1);
    const game = gameClassOf(e.cls);
    const seqName = e.anim.seqName;
    if (!sceneFaces || isBuildingCls(e.cls) || !seqName || e.anim.seq < 0) { clearFace(e); return; }
    const plays = (s: SceneData | null) => !!s?.events.some((ev) => ev.kind === "sequence" && ev.params.toLowerCase() === seqName.toLowerCase());
    const own = e.held?.slot === "taunt" ? e.held.tauntScenePaths?.[game] : undefined;
    let scene = own ? await loadSceneCached(own) : null;
    if (!plays(scene)) scene = await loadSceneCached(`scenes/player/${game}/low/${seqName}.vcd`);
    if (!plays(scene)) {
      const db = await loadItemDb();
      const paths = [...new Set(db.taunts.map((t) => t.tauntScenePaths?.[game]).filter((p): p is string => !!p))];
      // (asked once per class and sequence: the answer reads every taunt scene of the class, and most sequences are not a taunt's)
      const key = `${game}|${seqName.toLowerCase()}`;
      let lookup = playingCache.get(key);
      if (!lookup) playingCache.set(key, (lookup = paths.length ? scenePlaying(paths, seqName).catch(() => null) : Promise.resolve(null)));
      const path = await lookup;
      scene = path ? await loadSceneCached(path) : null;
    }
    if (token !== e.faceToken) return;
    if (!scene || !plays(scene) || !scene.events.some((ev) => ["expression", "flexanimation", "speak"].includes(ev.kind))) { clearFace(e); return; }
    const sc = scene;
    // the scene's time where the sequence starts in it (the face lines up with the body)
    const at = sc.events.find((ev) => ev.kind === "sequence" && ev.params.toLowerCase() === seqName.toLowerCase())?.start ?? 0;
    const speaks = sc.events.filter((ev) => ev.kind === "speak").map((ev) => ({ start: ev.start, sound: sc.sounds[ev.params.toLowerCase()] })).filter((s) => s.sound?.waves.length);
    const [classes, lines] = await Promise.all([
      mouthShapesOf(e),
      Promise.all(speaks.map(async (s) => {
        const wave = waveFor(e, s.sound);
        const [buffer, lip] = await Promise.all([loadVoice(wave), lipOf(wave)]);
        return { start: s.start, wave, buffer, lip } satisfies FaceLine;
      })),
    ]);
    if (token !== e.faceToken) return;
    e.face?.dispose();
    const driver = new FaceDriver({
      owner: `face${e.id}`,
      scene: sc,
      lines,
      classes,
      controllers: controllersOf(e),
      base: () => flexBase(e),
      clock: (pb) => (pb.clip ? pb.frame() / pb.clip.fps : 0) + at,
      audible: (pb) => pb.playing && !!pb.clip && e === selected && !e.hidden,
      running: (pb) => pb.playing,
      show: (values) => showFace(e, values),
    });
    e.face = driver;
    e.faceSounds = speaks.map((s) => s.sound);
    e.actor.faceDriver = (pb) => driver.run(pb);
    if (e === selected) renderFaceUi();
  }

  /** The face row under the animation controls: the scene face switch, the sound switch, the choice of line and the keep button. */
  function renderFaceUi() {
    const f = els.face;
    const e = selected;
    f.scene.checked = sceneFaces;
    f.mute.textContent = voiceMuted() ? "🔇 Sound off" : "🔊 Sound on";
    f.mute.setAttribute("aria-pressed", String(!voiceMuted()));
    syncMuteButton();
    f.keep.disabled = !e?.face;
    // a sound of several lines: which one this character says
    const pools = (e?.face ? e.faceSounds ?? [] : []).filter((s, i, all) => s.waves.length > 1 && all.findIndex((x) => x.name === s.name) === i);
    f.pick.hidden = !pools.length;
    f.pick.innerHTML = "";
    for (const s of pools) {
      const group = document.createElement("optgroup");
      group.label = s.name;
      s.waves.forEach((w, i) => {
        const o = new Option(w.split("/").pop()!.replace(/\.(mp3|wav)$/i, ""), `${s.name.toLowerCase()}|${i}`);
        o.selected = (e?.voicePicks?.get(s.name.toLowerCase()) ?? 0) === i;
        group.appendChild(o);
      });
      f.pick.appendChild(group);
    }
    f.info.textContent = e?.faceVoiceLine ? `Voice line: ${e.faceVoiceLine}` : e?.face ? "Face from the taunt's scene" : "";
  }

  els.face.scene.onchange = () => {
    sceneFaces = els.face.scene.checked;
    try { localStorage.setItem(SCENE_FACES_KEY, sceneFaces ? "1" : "0"); } catch { /* not kept */ }
    for (const e of entities) void refreshFace(e);
  };
  els.face.mute.onclick = () => { setVoiceMuted(!voiceMuted()); renderFaceUi(); };
  els.face.pick.onchange = () => {
    const e = selected;
    if (!e) return;
    const [name, index] = els.face.pick.value.split("|");
    (e.voicePicks ??= new Map()).set(name, Number(index));
    void refreshFace(e);
  };
  // the face of this moment goes onto the flex sliders, where it stays when the animation changes
  els.face.keep.onclick = () => {
    const e = selected;
    if (!e?.face) return;
    const values = new Map(e.face.face(e.face.setup.clock(e.actor.playback)));
    e.flex = values;
    e.heldFlex = undefined;
    e.face.release();
    flex.restore(values, models.get(classPath(e.cls)) ?? null);
  };


  // the voice line browser: a line on the selected character's face, on a timeline of its own
  let voiceEntity: Entity | null = null;
  let voiceClock = { time: 0, playing: false, since: 0 };
  const voiceTime = () => (voiceClock.playing ? voiceClock.time + (performance.now() - voiceClock.since) / 1000 : voiceClock.time);

  /** Counts the lines put on: a line still loading when another is picked is dropped. */
  let voicePick = 0;

  async function playVoiceLine(line: VoiceLine | null): Promise<number> {
    const token = ++voicePick;
    const prev = voiceEntity;
    voiceEntity = null;
    if (prev) {
      prev.faceVoiceLine = undefined;
      clearFace(prev);
      void refreshFace(prev);
    }
    const e = selected;
    if (!line || !e || isBuildingCls(e.cls)) return 0;
    const scene = await loadSceneCached(line.scene);
    if (!scene) return 0;
    const speaks = scene.events.filter((ev) => ev.kind === "speak").map((ev) => ({ start: ev.start, sound: scene.sounds[ev.params.toLowerCase()] })).filter((s) => s.sound?.waves.length);
    const [classes, lines] = await Promise.all([
      mouthShapesOf(e),
      Promise.all(speaks.map(async (s) => {
        const wave = waveFor(e, s.sound);
        const [buffer, lip] = await Promise.all([loadVoice(wave), lipOf(wave)]);
        return { start: s.start, wave, buffer, lip } satisfies FaceLine;
      })),
    ]);
    if (selected !== e || token !== voicePick) return 0;
    clearFace(e); // also drops a scene face still loading
    e.faceVoiceLine = line.sound.waves[0]?.split("/").pop()?.replace(/\.(mp3|wav)$/i, "") ?? line.sound.name;
    voiceEntity = e;
    voiceClock = { time: 0, playing: false, since: performance.now() };
    const driver = new FaceDriver({
      owner: `voice${e.id}`,
      scene,
      lines,
      classes,
      controllers: controllersOf(e),
      base: () => flexBase(e),
      clock: () => voiceTime(),
      audible: () => voiceClock.playing,
      running: () => voiceClock.playing,
      show: (values) => showFace(e, values),
    });
    e.face = driver;
    e.faceSounds = speaks.map((s) => s.sound);
    e.actor.faceDriver = (pb) => driver.run(pb);
    renderFaceUi();
    const soundEnd = Math.max(0, ...lines.map((l) => l.start + (l.buffer?.duration ?? 0)));
    return Math.max(line.duration, soundEnd);
  }

  els.face.lines.onclick = () =>
    openVoiceLines({
      character: () => (selected && !isBuildingCls(selected.cls) ? { label: classLabelOf(selected.cls), game: gameClassOf(selected.cls) } : null),
      lines: (game) => voiceLines(game),
      play: playVoiceLine,
      seek: (time, playing) => {
        voiceClock = { time, playing, since: performance.now() };
        voiceEntity?.face?.invalidate();
      },
      position: () => ({ time: voiceTime(), playing: voiceClock.playing }),
      keepFace: () => {
        const e = voiceEntity;
        if (!e?.face) return;
        const values = new Map(e.face.face(voiceTime()));
        e.flex = values;
        e.heldFlex = undefined;
        e.face.release();
        if (e === selected) flex.restore(values, models.get(classPath(e.cls)) ?? null);
      },
    });

  // --- promo images: a set of cosmetics, pictured in a scene tab of its own (see promo.ts) ------------------------------------------

  const nextFrames = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

  /** A picture of one character, alone, transparent: framed from `dir` by a camera of its own (the view's light follows it there). */
  /**
   * Moves a framing camera so that what is seen of the characters (their silhouette in a small picture through it) is centred in the frame and
   * fills `fill` of it, in its tighter direction: a few rounds, each measuring the silhouette and correcting for it.
   */
  async function fitSilhouette(v: Viewer, cam: THREE.PerspectiveCamera, actors: Actor[], fill: number, aspect: number, fov: number, rounds: number, mx: number, my: number) {
    // seen with the margin round the slot too, so what reaches past the slot is measured whole (a silhouette cut off at the slot would look smaller than it is)
    const wideAspect = (aspect * (1 + 2 * mx)) / (1 + 2 * my);
    const wideFov = (2 * Math.atan(Math.tan((fov * Math.PI) / 360) * (1 + 2 * my)) * 180) / Math.PI;
    const SW = 384, SH = Math.max(32, Math.round(SW / wideAspect));
    const target = cam.userData.target as THREE.Vector3;
    cam.fov = wideFov;
    cam.aspect = wideAspect;
    cam.updateProjectionMatrix();
    try {
      for (let k = 0; k < rounds; k++) {
        const small = (await v.capture(1, true, { camera: cam, only: actors, size: { w: SW, h: SH }, canvas: true })).canvas!;
        const { width, height } = small;
        const data = small.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, width, height).data;
        let x0 = width, y0 = height, x1 = -1, y1 = -1;
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          if (data[(y * width + x) * 4 + 3] > 12) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        }
        if (x1 < 0) return;
        const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
        // the silhouette's middle, off the frame's, in the frame's own units (-1..1): the camera slides that way (in its own plane)
        const nx = ((x0 + x1 + 1) / 2 - width / 2) / (width / 2), ny = ((y0 + y1 + 1) / 2 - height / 2) / (height / 2);
        const dist = cam.position.distanceTo(target);
        const halfH = dist * Math.tan((wideFov * Math.PI) / 360), halfW = halfH * wideAspect;
        const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
        const shift = right.multiplyScalar(nx * halfW).addScaledVector(up, -ny * halfH);
        const back = cam.position.clone().sub(target).normalize();
        target.add(shift);
        // as near as the slot's tighter direction allows (the slot is the middle of what is seen)
        const slotW = width / (1 + 2 * mx), slotH = height / (1 + 2 * my);
        const scale = Math.min((fill * slotW) / cw, (fill * slotH) / ch);
        cam.position.copy(target).addScaledVector(back, dist / scale);
        cam.near = Math.max(0.1, dist / scale / 100);
        cam.far = (dist / scale) * 20;
        cam.lookAt(target);
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld(true);
      }
    } finally {
      cam.fov = fov;
      cam.aspect = aspect;
      cam.updateProjectionMatrix();
    }
  }

  /**
   * A picture of one character, alone, transparent: framed for a slot of w × h from `dir` (the view's light follows it there), and taken
   * with {@link PROMO_MARGIN} more room round the slot, so what reaches past the character (a long weapon) is not cut off at the slot's
   * edge but spills over it (see {@link marginBox}).
   */
  async function promoShot(who: Entity | Entity[], dir: THREE.Vector3, w: number, h: number, fill: number, scaleDistance?: number, pan?: { fov?: number; panX?: number; panY?: number; light?: { azimuth: number; elevation: number }; particles?: { seed: number; time: number } }, margin = true, effects?: ShotEffects, bounds?: THREE.Box3, quick = false): Promise<HTMLCanvasElement> {
    const v = ensureViewer();
    const actors = (Array.isArray(who) ? who : [who]).map((x) => x.actor);
    const fov = pan?.fov ?? PROMO_FOV;
    await bodyMasksLoaded(); // the parts an item shown alone hides are hidden by a mask texture (before the character is looked at to fit it)
    const cam = v.framingCamera(actors, dir, w / h, fill, fov, scaleDistance !== undefined ? scaleDistance / fill : undefined, bounds);
    // a shot of its own scale and of the characters (not one sharing its scale with others, nor a framed item) is fitted to what is seen of them,
    // not to their bounding box (which is always roomier than they are)
    if (scaleDistance === undefined && !bounds) await fitSilhouette(v, cam, actors, fill, w / h, fov, quick ? 1 : 2, PROMO_MARGIN.x, PROMO_MARGIN.y);
    const target = slideCamera(cam, w / h, fov, pan);
    v.restoreCamera(cam.position.toArray() as [number, number, number], target.toArray() as [number, number, number]);
    // the same camera, seeing the margin round the slot too: a taller view (the slot keeps its size in it) and a wider one
    const mx = margin ? PROMO_MARGIN.x : 0, my = margin ? PROMO_MARGIN.y : 0;
    const W = Math.round(w * (1 + 2 * mx)), H = Math.round(h * (1 + 2 * my));
    cam.fov = (2 * Math.atan(Math.tan((fov * Math.PI) / 360) * (1 + 2 * my)) * 180) / Math.PI;
    cam.aspect = W / H;
    cam.updateProjectionMatrix();
    // (a live look, drawn again as it is dragged, does not wait two frames each time: it is taken at once)
    if (!quick) await nextFrames();
    const shadow = effects?.shadow.on ? { enabled: true, azimuth: effects.shadow.azimuth, length: effects.shadow.length, blur: effects.shadow.blur, opacity: effects.shadow.opacity } : undefined;
    const look = !!effects?.look;
    // the particle effects at a set moment of theirs (the shot is the same each time it is taken), held still while it is taken
    if (pan?.particles) for (const a of actors) await v.restartEffects(a, pan.particles.seed, pan.particles.time);
    try {
      return await withShotLight(pan?.light, async () => {
        const shot = await v.capture(1, true, { camera: cam, only: actors, size: { w: W, h: H }, canvas: true, groundShadow: shadow, look });
        // with effects, the shot again without them: the character alone, for its bounds and clicks
        if (shadow || look) {
          const plain = await v.capture(1, true, { camera: cam, only: actors, size: { w: W, h: H }, canvas: true });
          solidOf.set(shot.canvas!, plain.canvas!);
          // the shadow on its own (with the look's glow and bloom it cannot be told from them: that shot keeps its shadow in its pixels)
          if (shadow && !look) shadowOf.set(shot.canvas!, shadowLayer(shot.canvas!, plain.canvas!));
        }
        return shot.canvas!;
      });
    } finally {
      if (pan?.particles) for (const a of actors) v.holdEffects(a, false);
    }
  }

  /** Where the view's directional light comes from (degrees): the selected one when it is directional, else the first, else the plain light. */
  function viewLightDirection(): { azimuth: number; elevation: number } {
    const l = ensureViewer().getLight();
    const d = l.rig ? (l.rig.lights.find((x) => x.id === l.rig!.selected && x.type === "directional") ?? l.rig.lights.find((x) => x.type === "directional")) : null;
    return d ? { azimuth: d.azimuth, elevation: d.elevation } : { azimuth: l.azimuth, elevation: l.elevation };
  }

  /** Runs `job` with the directional light turned to where a shot wants it (a light of its own), the view's light put back after. */
  async function withShotLight<T>(light: { azimuth: number; elevation: number } | undefined, job: () => Promise<T>): Promise<T> {
    if (!light) return job();
    const v = ensureViewer();
    const was = v.getLight();
    const l = v.getLight();
    const d = l.rig ? (l.rig.lights.find((x) => x.id === l.rig!.selected && x.type === "directional") ?? l.rig.lights.find((x) => x.type === "directional")) : null;
    if (d) { d.azimuth = light.azimuth; d.elevation = light.elevation; }
    else if (!l.rig) { l.azimuth = light.azimuth; l.elevation = light.elevation; }
    v.setLight(l);
    try {
      return await job();
    } finally {
      v.setLight(was);
    }
  }

  /**
   * Slides a framing camera sideways and up by its aim's pan (shares of half its frame), the camera and the point it looks at together;
   * returns that point.
   */
  function slideCamera(cam: THREE.PerspectiveCamera, aspect: number, fov: number, pan?: { panX?: number; panY?: number }): THREE.Vector3 {
    const target = (cam.userData.target as THREE.Vector3).clone();
    const px = pan?.panX ?? 0, py = pan?.panY ?? 0;
    if (!px && !py) return target;
    const half = Math.tan((fov * Math.PI) / 360) * cam.position.distanceTo(target);
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    // the frame moves the other way to the subject: a pan to the right slides the camera left of it
    const shift = right.multiplyScalar(-px * half * aspect).addScaledVector(up, -py * half);
    cam.position.add(shift);
    target.add(shift);
    cam.lookAt(target);
    cam.updateMatrixWorld(true);
    return target;
  }

  /** The room a promo shot is taken with round its slot, as a share of the slot's width and height on each side. */
  const PROMO_MARGIN = { x: 0.4, y: 0.12 };
  /** The box a shot taken with the margin is drawn into, for a slot (the slot sits in the middle of it, as in the shot). */
  const marginBox = (x: number, y: number, w: number, h: number): [number, number, number, number] =>
    [x - w * PROMO_MARGIN.x, y - h * PROMO_MARGIN.y, w * (1 + 2 * PROMO_MARGIN.x), h * (1 + 2 * PROMO_MARGIN.y)];

  /** Dresses a character of the promo scene and poses it: a weapon's idle (holding it), or the reference pose. */
  async function promoDress(e: Entity, loadout: Equipped[], weapon: ItemInfo | null, regions: string[] | null, team = 0) {
    const game = gameClassOf(e.cls);
    if (e.team !== team) {
      // the team: the class's own skin now, the cosmetics' with the loadout below
      e.team = team;
      markTeams();
      const data = models.get(classPath(e.cls));
      if (data) await ensureClassMaterials(e, data);
    }
    e.items = { loadout, activeId: loadout.at(-1)?.item.id ?? null };
    e.applied = loadout.filter((x) => itemUsableBy(x.item, game));
    e.held = weapon;
    e.actor.setInspectOnly(regions !== null);
    // a whole character shows every part of its body (the parts by name: a "show all" would leave the head's own materials out)
    const all = e.actor.bodyGroups.map((g) => g.id);
    e.actor.setVisibleRegions(regions ?? (all.length ? all : ["*"]));
    if (e === selected && !promoQuiet) { itemsUi.load(e.items); weapons.load(e.held); }
    else if (e === selected) uiStale = true;
    await applyLoadout(e, e.applied);
    const idle = weapon ? weaponIdleSequences(weapon, game) : [];
    if (!(idle.length && anim.selectByName(e.actor, e.anim, idle))) anim.selectByName(e.actor, e.anim, ["ref"]);
    await e.anim.pending;
    e.actor.playback.playing = false;
    e.actor.playback.time = 0;
    e.actor.poseBones();
  }

  /** The field of view of every promo shot and chart (degrees, vertical). */
  const PROMO_FOV = 30;
  /** How many characters a promo's loadout picture lines up (each in its own loadout with the item). */
  const PROMO_LINEUP = 4;
  /** A promo's styles picture shows at most this many styles side by side (and makes a paint chart of each). */
  const MAX_PROMO_STYLES = 4;
  /** The paints that show styles that differ only in their textures: a grey, Mann Co. Orange or A Deep Commitment to Purple. */
  const STYLE_PAINTS = [0x7e7e7e, 0xcf7336, 0x7d4071];
  const stylePaint = (paints: PaintInfo[]): PaintInfo | null => {
    const choices = paints.filter((p) => STYLE_PAINTS.includes(p.rgb));
    return choices[Math.floor(Math.random() * choices.length)] ?? null;
  };

  /**
   * The promo's scene tabs, one per role (RED, BLU, the item alone, each character of the line-up): a shot's character is alone in a
   * scene of its own, which is kept to take the shot again. A role's scene is made when it is first needed, and again if its tab was
   * closed.
   */
  interface PromoSession {
    /** The board's folder among the kept boards (see promoStore.ts). */
    id: string;
    /** The set's items as named (the board's title). */
    title: string;
    /** The items of the set (they stay on a shot edited in 3D). */
    ids: Set<number>;
    /** The class of the promo (a model path): what a role's scene is made with. */
    cls: string;
    /** The role scenes, by role. */
    roles: Map<number, SceneTab>;
    /** What each role was last dressed in (its character is built anew each time its scene comes to the front, as the scene saved it). */
    dressed: Map<number, string>;
    /** What a composition's characters were last laid out for (by role). */
    laidOut: Map<number, string>;
    /** The board tab, once the pictures are taken. */
    board: SceneTab | null;
    /** The pictures, as the board has them (written to the board's folder when they change). */
    pictures: PromoPicture[];
    /** The images written to the folder so far. */
    written: Written;
    saveTimer: number;
    saving: Promise<void>;
  }
  const newSession = (title: string, ids: Iterable<number>, cls: string, id = `b${Date.now().toString(36)}`): PromoSession =>
    ({ id, title, ids: new Set(ids), cls, roles: new Map(), dressed: new Map(), laidOut: new Map(), board: null, pictures: [], written: new Map(), saveTimer: 0, saving: Promise.resolve() });

  /** Writes a board a moment after it changed (one write at a time; a change during a write writes again after it). */
  function scheduleSave(s: PromoSession) {
    window.clearTimeout(s.saveTimer);
    s.saveTimer = window.setTimeout(() => {
      s.saving = s.saving.then(async () => {
        if (!s.board || !sessions.has(s)) return;
        try {
          await saveBoard(s.id, { name: s.board.name, title: s.title, set: [...s.ids], cls: s.cls, pictures: s.pictures }, s.written);
        } catch (err) {
          console.warn("could not keep the promo board:", err);
        }
      });
    }, 1500);
  }

  /** Puts a board of pictures in the strip as a tab (shown when `show`). */
  function openBoard(mine: PromoSession, name: string, pictures: PromoPicture[], show: boolean): SceneTab | null {
    const page = document.getElementById("promoPage");
    if (!page) return null;
    const root = document.createElement("div");
    root.className = "promoBoardRoot";
    root.hidden = !show;
    page.appendChild(root);
    mine.pictures = pictures;
    const dispose = showBoard(root, mine.title, pictures, hostFor(mine));
    const tab: SceneTab = { id: nextTabId++, name, scene: null, base: "", dirty: false, board: { root, session: mine, dispose } };
    mine.board = tab;
    tabs.push(tab);
    if (show) showBoardTab(tab);
    else renderTabs();
    const thumb = root.querySelector<HTMLCanvasElement>(".promoThumb canvas");
    if (thumb) tab.preview = thumb.toDataURL("image/jpeg", 0.8);
    return tab;
  }

  /** The boards kept from before come back into the strip (not in front), with their promos to take shots again. */
  async function restoreBoards() {
    let boards: Awaited<ReturnType<typeof loadBoards>> = [];
    try {
      boards = await loadBoards();
    } catch (err) {
      console.warn("could not read the kept promo boards:", err);
    }
    for (const b of boards) {
      const mine = newSession(b.saved.title, b.saved.set, b.saved.cls, b.id);
      mine.written = b.written;
      sessions.add(mine);
      openBoard(mine, b.saved.name, b.pictures, false);
    }
  }
  const sessions = new Set<PromoSession>();
  /** The promo being worked on: set by the board whose shot is taken (again), or the set being generated. */
  let session: PromoSession | null = null;
  const promo = () => {
    if (!session) throw new Error("no promo is being made: generate a set first");
    return session;
  };
  /** The tab to go back to when the Viewer shows (the scene that was open before a shot was taken again). */
  let promoHome: SceneTab | null = null;
  /**
   * While shots are taken the view is not looked at: a switch between promo scenes then leaves the panels (the items, the outliner,
   * the sliders) as they were, which is most of a switch's cost; they are brought up to date once a scene is shown.
   */
  let promoQuiet = false;
  let uiStale = false;
  function syncStaleUi() {
    if (!uiStale) return;
    uiStale = false;
    if (selected) restoreUi(selected);
    renderEntities();
  }
  const PROMO_ROLE_NAMES = ["RED", "BLU", "Item alone"];
  /** The role of a composition's scene (the characters of a line-up in one): its characters' own roles only key what they wear. */
  const GROUP_ROLE = 100;
  const roleName = (role: number) => (role === GROUP_ROLE ? "Line-up" : PROMO_ROLE_NAMES[role] ?? `Line-up ${role - PROMO_ROLE_NAMES.length + 1}`);
  const isPromoTab = (t: SceneTab | null) => !!t && [...sessions].some((s) => [...s.roles.values()].includes(t));

  /**
   * Makes a role's scene the open one and gives its character (the one character of that scene). Only a scene that is not a promo one
   * is remembered as home, to come back to. Throws when the view is busy with something else and the switch cannot be made.
   */
  async function enterRole(role: number, count = 1): Promise<Entity> {
    const mdl = promo().cls;
    let tab = promo().roles.get(role);
    if (!tab || !(tab.parked || tab === activeTab)) {
      if (!isPromoTab(activeTab)) promoHome = activeTab;
      const before = activeTab;
      await openTab(null, `Promo · ${roleName(role)}`, undefined, async () => {
        const v = ensureViewer();
        v.cameras.restore(null);
        for (const e of [...entities]) v.removeActor(e.actor);
        entities.length = 0;
        groups = [];
        gizmoEntity = null;
        v.setActorGizmo(null);
        for (let i = 0; i < count; i++) {
          const e = newEntity(v.addActor(), mdl, role === 1 ? 1 : 0);
          e.name = count > 1 ? `${roleName(role)} ${i + 1}` : roleName(role);
          entities.push(e);
          selected = e;
          v.select(e.actor);
          e.applied = [];
          if (!promoQuiet) {
            itemsUi.load(e.items);
            weapons.load(e.held);
          }
          await show(e, mdl, { seqName: "ref" });
          if (promoQuiet) uiStale = true;
          else {
            restoreUi(e);
            renderEntities();
          }
        }
      });
      tab = activeTab ?? undefined;
      if (!tab || tab === before) throw new Error("could not open the character's scene (the view is busy)");
      promo().roles.set(role, tab);
      promo().dressed.delete(role);
      promo().laidOut.delete(role);
      hidePromoTab(tab);
    } else if (activeTab !== tab) {
      if (!isPromoTab(activeTab)) promoHome = activeTab;
      await switchTab(tab);
      if (activeTab !== tab) throw new Error("could not switch to the character's scene (the view is busy)");
    }
    const e = entities[0];
    if (!e) throw new Error("the character's scene is empty");
    return e;
  }

  /**
   * A promo scene is a workspace, not a scene of yours: it is not in the tab strip, except while a shot is edited in it in 3D. (It is
   * still the open scene while a shot is taken, but the view is not looked at then.)
   */
  function showPromoTab(tab: SceneTab) {
    if (!tabs.includes(tab)) tabs.push(tab);
    renderTabs();
  }
  function hidePromoTab(tab: SceneTab | undefined) {
    const at = tab ? tabs.indexOf(tab) : -1;
    if (at >= 0) tabs.splice(at, 1);
    renderTabs();
  }
  /** A promo scene closed from the strip (while it showed) is gone: its role's scene is made again when next needed. */
  function forgetPromoTab(tab: SceneTab) {
    for (const s of sessions) for (const [role, t] of s.roles) if (t === tab) { s.roles.delete(role); s.laidOut.delete(role); }
  }

  /** The scene that was open before a shot was taken again comes back (the Viewer is shown again, not to edit a promo shot in it). */
  async function leavePromoScene() {
    if (promoEditing) return;
    const home = promoHome;
    promoHome = null;
    if (home && isPromoTab(activeTab) && tabs.includes(home)) await switchTab(home);
  }

  /** Lets a promo go (its board was closed): its role scenes are closed and disposed of; a scene of yours stays open, or a fresh one. */
  async function disposeSession(s: PromoSession) {
    await leavePromoScene();
    if (activeTab && [...s.roles.values()].includes(activeTab)) {
      const other = tabs.find((t) => !isPromoTab(t) && !t.board);
      if (other) await switchTab(other);
      else await openTab(null);
    }
    for (const t of s.roles.values()) {
      const at = tabs.indexOf(t);
      if (at >= 0) tabs.splice(at, 1);
      if (t !== activeTab) disposeParked(t);
    }
    s.roles.clear();
    sessions.delete(s);
    if (session === s) session = null;
    renderTabs();
  }

  // --- the boards: a promo's pictures as a tab of the strip, shown in the view's place while it is the tab in front -------------
  /** The board that shows in place of the 3D view, or none. */
  let activeBoard: SceneTab | null = null;
  function showBoardTab(tab: SceneTab) {
    if (!tab.board) return;
    activeBoard = tab;
    for (const t of tabs) if (t.board) t.board.root.hidden = t !== tab;
    const page = document.getElementById("promoPage"), view = document.getElementById("view");
    if (page) page.hidden = false;
    if (view) view.hidden = true;
    renderTabs();
  }
  /** The 3D view again (the scene in front is the one whose characters are loaded). */
  function hideBoardTab() {
    activeBoard = null;
    const page = document.getElementById("promoPage"), view = document.getElementById("view");
    if (page) page.hidden = true;
    if (view) view.hidden = false;
    renderTabs();
  }
  async function closeBoardTab(tab: SceneTab) {
    const b = tab.board;
    if (!b || tabBusy) return;
    if (settings().confirmCloseScene) {
      const { choice, stopAsking } = await askClose(tab);
      if (stopAsking) void updateSetting("confirmCloseScene", false);
      if (choice === "cancel") return;
    }
    const at = tabs.indexOf(tab);
    if (at >= 0) tabs.splice(at, 1);
    if (activeBoard === tab) hideBoardTab();
    b.dispose();
    b.root.remove();
    tab.board = undefined;
    window.clearTimeout(b.session.saveTimer);
    await disposeSession(b.session);
    void b.session.saving.then(() => forgetBoard(b.session.id)).catch((err) => console.warn("could not forget the promo board:", err));
    renderTabs();
  }

  /** Dresses a shot's character as its spec says (unless it already is). */
  async function dressForShot(spec: ShotSpec): Promise<Entity> {
    return dressEntity(await enterRole(spec.role), spec);
  }

  /** Dresses a character as a shot's spec says (it is built anew only when the spec's key changes): what it wears and holds, and how it stands. */
  async function dressEntity(e: Entity, spec: ShotSpec): Promise<Entity> {
    const db = await loadItemDb();
    const byId = new Map([...db.items, ...db.weapons, ...db.taunts].map((i) => [i.id, i] as const));
    const paints = new Map(db.paints.map((p) => [p.id, p] as const));
    const loadout: Equipped[] = spec.loadout.flatMap((x) => {
      const item = byId.get(x.item);
      return item ? [{ item, paint: x.paint !== null ? paints.get(x.paint) ?? null : null, style: x.style }] : [];
    });
    const dress = dressKey(spec);
    if (promo().dressed.get(spec.role) !== dress) {
      // the bodygroups set by hand in this shot, over what its cosmetics set (as the Bodygroups of the character's properties)
      e.bodyManual = new Map(Object.entries(spec.bodygroups ?? {}));
      await promoDress(e, loadout, spec.weapon !== null ? byId.get(spec.weapon) ?? null : null, spec.regions, teamOf(spec));
      // the pose it holds, when it is not the weapon's idle
      if (spec.pose) {
        e.actor.usePose({ pos: Float32Array.from(spec.pose.pos), quat: Float32Array.from(spec.pose.quat), scale: spec.pose.scale ? Float32Array.from(spec.pose.scale) : undefined });
        e.actor.endPose(true);
        e.actor.poseBones();
      }
      // the face it makes (the sliders hold it: a scene face of the animation is gone with the animation)
      e.flex = new Map(Object.entries(spec.flex ?? {}));
      e.heldFlex = undefined;
      e.rolledFlex = false;
      if (e === selected) flex.restore(e.flex, models.get(classPath(e.cls)) ?? null);
      e.actor.setFlexControllers(flexBase(e));
      promo().dressed.set(spec.role, dress);
    }
    return e;
  }

  /** The characters of a composition in its scene (made when first needed), one for each of its specs. */
  async function enterGroup(spec: ShotSpec): Promise<Entity[]> {
    const count = spec.group!.length;
    await enterRole(spec.role, count);
    if (entities.length < count) throw new Error("the line-up's scene has fewer characters than it needs");
    return entities.slice(0, count);
  }

  /**
   * A composition as its spec says: every character dressed and posed, and standing in a row (each turned by its `turn`, side by side with a
   * gap between what each takes up, the whole row centred on the middle).
   */
  async function dressGroup(spec: ShotSpec): Promise<Entity[]> {
    const ents = await enterGroup(spec);
    for (const [i, child] of spec.group!.entries()) await dressEntity(ents[i], child);
    // laid out again only when what stands there changed (a look drawn again as the camera is dragged changes nothing of it)
    const key = JSON.stringify(spec.group!.map((c) => [dressKey(c), c.place ?? null, c.turn ?? 0]));
    if (promo().laidOut.get(spec.role) !== key) {
      layoutGroup(spec, ents);
      promo().laidOut.set(spec.role, key);
    }
    return ents;
  }

  function layoutGroup(spec: ShotSpec, ents: Entity[]) {
    const v = ensureViewer();
    // every character placed by hand in 3D: they stand where they were put
    if (spec.group!.every((c) => c.place)) {
      ents.forEach((e, i) => { const p = spec.group![i].place!; v.placeActor(e.actor, p.x, p.y, p.z, p.yaw); });
      return;
    }
    // side by side, the same distance from each other, the row centred on the middle; the first stands at the left of the picture (the view's
    // x runs to the left)
    ents.forEach((e, i) => v.placeActor(e.actor, ((ents.length - 1) / 2 - i) * LINEUP_SPACING, 0, LINEUP_DEPTH[i] ?? 0, ((spec.group![i].turn ?? 0) * Math.PI) / 180));
  }
  /** How far apart the characters of a line-up stand (from middle to middle). */
  const LINEUP_SPACING = 37;
  /** The four of a line-up stand in a shallow arc: the outer two a little back (z) and turned in (the turn, in degrees about Y: the Rotation Y of the properties). */
  const LINEUP_DEPTH = [-4, 0, 0, -4];
  const LINEUP_TURN = [14, 5, -5, -14];

  /** A shot's team: its own, else by its role (the BLU role is BLU). */
  const teamOf = (spec: ShotSpec) => spec.team ?? (spec.role === 1 ? 1 : 0);
  /** What a shot's character wears, holds, its team and how it stands, as a key (the character is dressed again only when it changes). */
  const dressKey = (spec: ShotSpec) =>
    JSON.stringify([spec.loadout.map((x) => [x.item, x.paint, x.style]), spec.weapon, spec.regions, spec.bodygroups ?? null, teamOf(spec), spec.pose ? spec.pose.quat.slice(0, 64).map((q) => Math.round(q * 1e4)) : null, spec.flex ?? null]);

  /**
   * Gives a shot a random pose, as the random loadouts do: a taunt (held) or an animation, half the time each, stopped on a frame where
   * the character keeps a comfortable shape on screen. `avoid` keeps the others of a line-up from doing the same.
   */
  /** The taunts (that play on the character alone: a prop of their own would be left out of the picture) and animations a shot's character can be posed from. */
  async function shotPoses(spec: ShotSpec) {
    const db = await loadItemDb();
    const e = await enterRole(spec.role);
    const game = gameClassOf(e.cls);
    const taunts = db.taunts.filter((t) => !t.workshop && itemUsableBy(t, game) && t.tauntScenes[game] !== undefined && !t.tauntPropScenes[game] && !NOT_ROLLED_TAUNT.test(t.tauntScenes[game]));
    const sequences = (e?.anim.info?.sequences ?? []).filter((q) => q.frames > 1 && !NOT_A_POSE.test(q.name) && !isJunkSequence(q.name));
    return { taunts, sequences };
  }

  /** A random taunt or animation for a shot (`avoid`: ones the shots beside it already have), stopped on a frame that frames well, with a random face. */
  async function rollShotPose(spec: ShotSpec, avoid: Set<string> = new Set(), tries = 3, on?: Entity): Promise<void> {
    if (spec.group) return rollGroupPoses(spec);
    const e = on ?? await enterRole(spec.role);
    // (the taunts that play on the character alone: a prop of their own would be left out of the picture)
    const source = await poseSource(e, false);
    const first = Math.random() < 0.5 ? "taunt" : "anim";
    const choice = choosePose(first, source, avoid) ?? choosePose(first === "taunt" ? "anim" : "taunt", source, avoid);
    if (!choice) return;
    avoid.add(choice.id);
    // one that never stands up (a lying taunt, or one whose frames are all the raw reference pose): another, a few times
    if (!(await poseShot(spec, choice.id, -1, choice, e)) && tries > 0) await rollShotPose(spec, avoid, tries - 1, e);
  }

  /** New random poses for the characters of a composition (each its own, none the same as another). */
  async function rollGroupPoses(spec: ShotSpec) {
    const ents = await enterGroup(spec);
    const avoid = new Set<string>();
    for (const [i, child] of spec.group!.entries()) {
      delete child.place; // other poses take up other room: the row is laid out again
      await rollShotPose(child, avoid, 3, ents[i]);
    }
    spec.randomPose = true;
  }

  /** Poses a shot's character from a taunt ("t<id>") or an animation ("s<name>") at `at` (0..1; below 0: a frame that frames well). */
  async function poseShot(spec: ShotSpec, id: string, at: number, choice?: PoseChoice, on?: Entity): Promise<boolean> {
    const db = await loadItemDb();
    const e = on ? await dressEntity(on, { ...spec, pose: undefined }) : await dressForShot({ ...spec, pose: undefined });
    const game = gameClassOf(e.cls);
    if (id.startsWith("t")) {
      const taunt = db.taunts.find((t) => String(t.id) === id.slice(1));
      if (!taunt) return false;
      if (e.held?.id !== taunt.id) await promoDress(e, e.items.loadout, taunt, spec.regions, teamOf(spec));
      playWeaponAnimation(e, taunt);
      spec.weapon = taunt.id;
    } else {
      const seq = e.anim.info?.sequences.find((q) => q.name === id.slice(1));
      if (!seq) return false;
      // what the animation is played holding: the weapon a roll picked for it (or the shot already holds, played again at another moment),
      // else the class's stock weapon of the slot its name says (stand_MELEE, run_PRIMARY), or nothing when it names none (the class's own
      // idles, taunts, menus)
      const again = !choice && spec.poseOf?.id === id ? spec.weapon : null;
      const slot = /primary|secondary|melee|pda|building/i.exec(seq.name)?.[0].toLowerCase();
      const held = choice?.kind === "anim" ? choice.weapon
        : (again !== null ? db.weapons.find((w) => w.id === again) : null) ?? (slot ? db.weapons.find((w) => w.baseItem && itemUsableBy(w, game) && slotForClass(w, game) === slot) ?? null : null);
      if ((held?.id ?? null) !== (e.held?.id ?? null)) await promoDress(e, e.items.loadout, held, spec.regions, teamOf(spec));
      spec.weapon = held?.id ?? null;
      const params = choice?.kind === "anim" ? choice.params : !choice && spec.poseOf?.id === id ? spec.poseOf.params : undefined;
      if (params) {
        anim.applyHeld(e.actor, e.anim, [seq.name], params);
        spec.poseOf = { id, at: spec.poseOf?.at ?? 0, params };
      } else anim.select(e.actor, e.anim, seq.index);
    }
    await e.anim.pending;
    const pb = e.actor.playback, clip = pb.clip;
    const span = clip && clip.frames > 1 ? (clip.frames - 1) / clip.fps : 0;
    let stands = true, dropped = false;
    if (at < 0) ({ stands, dropped } = settlePose(e));
    // a frame on the timeline that has let go of the weapon too
    else if (e.held) dropped = (e.actor.weaponReach() ?? 0) > WEAPON_LET_GO;
    else if (clip) {
      pb.time = span * Math.max(0, Math.min(1, at));
      pb.playing = false;
      e.actor.poseBones();
    }
    spec.poseOf = { id, at: span > 0 ? Math.max(0, Math.min(1, pb.time / span)) : 0, params: choice?.kind === "anim" || (!choice && spec.poseOf?.id === id) ? spec.poseOf?.params : undefined };
    // a random roll gives the face too (a taunt's own scene face stays), kept with the shot
    if (choice) {
      await randomFace(e);
      spec.flex = currentFace(e);
    }
    const pose = e.actor.snapshotPose();
    spec.pose = pose ? { pos: Array.from(pose.pos), quat: Array.from(pose.quat), scale: pose.scale ? Array.from(pose.scale) : undefined } : undefined;
    spec.randomPose = true;
    // a weapon the pose is not holding (every frame tried let go of it) is not in the picture: it would hang by the feet
    if (dropped && !id.startsWith("t")) spec.weapon = null;
    promo().dressed.delete(spec.role); // dressed again from the spec, the pose held
    return stands;
  }

  /** The promo shot being edited in the 3D view, and what to do when the board is shown again. */
  let promoEditing: { spec: ShotSpec; /** the characters edited: the shot's one, or a composition's all */ ents: Entity[]; done: (set: boolean) => void; bar: HTMLElement; locked: number[] } | null = null;

  /**
   * Puts the view's camera where the shot's is: the view has the picture's lens (as tall a view as the picture's, whatever the shape of the
   * view) and stands where the picture's frame, whole, fits in it: as far as the picture's camera, or farther when the view is narrower than
   * the picture.
   */
  function frameEditView(spec: ShotSpec, ents: Entity[]) {
    const v = ensureViewer();
    const aspect = Math.max(0.1, v.camera.aspect);
    const lens = spec.fov ?? PROMO_FOV;
    v.setFov((2 * Math.atan(Math.tan((lens * Math.PI) / 360) * aspect) * 180) / Math.PI);
    const cam = v.framingCamera(ents.map((x) => x.actor), new THREE.Vector3(...aimDirection(spec)), spec.w / spec.h, spec.fill, lens, spec.scaleDistance !== undefined ? spec.scaleDistance / spec.fill : undefined);
    const target = slideCamera(cam, spec.w / spec.h, lens, spec);
    const away = cam.position.clone().sub(target).multiplyScalar(Math.max(1, spec.w / spec.h / aspect));
    v.restoreCamera(target.clone().add(away).toArray() as [number, number, number], target.toArray() as [number, number, number]);
  }

  /** Opens a shot's character in the 3D view as the shot has it (see BoardHost.editIn3D). */
  function editShotIn3D(spec: ShotSpec): Promise<boolean> {
    return inPromoScene(async () => {
      const ents = spec.group ? await dressGroup(spec) : [await dressForShot(spec)];
      const e = ents[0];
      // the slider of the row's spacing shows how far apart they stand
      if (spec.group && ents.length > 1) {
        const gap = Math.round(Math.min(+els.entities.spacing.max, Math.max(+els.entities.spacing.min, Math.abs(ents[1].actor.offset.x - ents[0].actor.offset.x))));
        els.entities.spacing.value = String(gap);
        const out = els.entities.spacing.parentElement?.querySelector("output");
        if (out) out.textContent = String(gap);
        ensureViewer().setSpacing(gap);
      }
      if (activeTab) showPromoTab(activeTab); // its scene is in the strip while it is edited
      syncStaleUi(); // the panels show this character before anything reads them back
      const v = ensureViewer();
      selectEntity(e);
      v.select(e.actor);
      restoreUi(e);
      renderEntities();
      return ents;
    }).then((ents) => new Promise<boolean>((resolve) => {
      const bar = document.createElement("div");
      bar.className = "promoEditBar";
      bar.innerHTML = `<span class="promoEditNote">${spec.group ? "Editing a line-up: click a character to change anything about it (weapon, pose, cosmetics, where it stands). The picture's camera stays as it is. The promoted item stays on." : "Editing a promo shot: change anything about this character (weapon, pose, cosmetics), and the angle of the view. The promoted item stays on."}</span><button class="promoEditCancel">Cancel</button><button class="primary promoEditDone">Back to the promo board</button>`;
      document.getElementById("canvasWrap")?.appendChild(bar);
      // the promoted items it wears stay on (a line-up's one, a main picture's set)
      const locked = spec.loadout.map((x) => x.item).filter((id) => promo().ids.has(id) || id === spec.reroll?.item);
      promoEditing = { spec, ents, done: resolve, bar, locked };
      (bar.querySelector(".promoEditDone") as HTMLButtonElement).onclick = () => finishShotEdit(true);
      (bar.querySelector(".promoEditCancel") as HTMLButtonElement).onclick = () => finishShotEdit(false);
      hideBoardTab(); // the role's scene shows, in the board's place
      // the view looks at it as the shot does, once the view shows (its shape is its own then)
      void nextFrames().then(() => frameEditView(spec, ents));
    }));
  }

  /**
   * Ends editing a promo shot in 3D: with `set`, the shot takes the character as it is now and the view's angle; then the board
   * (`backToBoard` false: the scene is being left for another, the view stays).
   */
  function finishShotEdit(set: boolean, backToBoard = true) {
    const ed = promoEditing;
    if (!ed) return;
    promoEditing = null;
    ed.bar.remove();
    viewer?.setFov(+els.fov.value); // the view's own lens again
    hidePromoTab(promo().roles.get(ed.spec.role));
    const { spec, ents } = ed;
    if (set && ents.every((e) => entities.includes(e))) {
      if (selected && ents.includes(selected)) saveUi(selected);
      // a composition takes each of its characters, a shot its one
      for (const [i, e] of ents.entries()) {
        const part = spec.group ? spec.group[i] : spec;
        const game = gameClassOf(e.cls);
        part.loadout = e.items.loadout.filter((x) => itemUsableBy(x.item, game)).map((x) => ({ item: x.item.id, name: x.item.displayName, paintable: x.item.paintable, paint: x.paint?.id ?? null, style: x.style }));
        part.weapon = e.held?.id ?? null;
        part.team = e.team;
        part.bodygroups = e.bodyManual.size ? Object.fromEntries(e.bodyManual) : undefined;
        // the pose it shows now: a custom one, or the frame of what it plays
        if (e.actor.isPosing) e.actor.endPose(true);
        const pose = e.actor.snapshotCustomPose() ?? e.actor.snapshotPose();
        part.pose = pose ? { pos: Array.from(pose.pos), quat: Array.from(pose.quat), scale: pose.scale ? Array.from(pose.scale) : undefined } : undefined;
        part.flex = currentFace(e);
        if (spec.group) {
          promo().dressed.set(part.role, dressKey(part));
          part.place = { x: e.actor.offset.x, y: e.actor.offset.y, z: e.actor.offset.z, yaw: e.actor.yaw };
        }
      }
      // the angle the view looks from (a line-up's camera is the picture's own: moving about it in the view only looks)
      if (!spec.group) {
        const v = ensureViewer();
        const cam = v.getCamera();
        const d = new THREE.Vector3(...cam.position).sub(new THREE.Vector3(...cam.target)).normalize();
        spec.yaw = Math.round((Math.atan2(d.x, d.z) * 180) / Math.PI);
        spec.pitch = Math.round((Math.asin(Math.max(-1, Math.min(1, d.y))) * 180) / Math.PI);
      }
      promo().dressed.set(spec.role, dressKey(spec)); // it already is as the spec says
    } else {
      // what was changed in the view is not the shot: it is dressed (and, in a composition, stands) again from its spec
      for (const part of spec.group ?? [spec]) promo().dressed.delete(part.role);
      promo().laidOut.delete(spec.role);
    }
    if (backToBoard && session?.board) showBoardTab(session.board);
    ed.done(set);
  }

  /** Takes a shot as its spec says, on its character of the open promo scene. */
  async function takeShot(spec: ShotSpec): Promise<HTMLCanvasElement> {
    const e = spec.group ? await dressGroup(spec) : await dressForShot(spec);
    // its particle effects at a moment of their own (a shot made before this had none: it gets one now)
    spec.particles ??= { seed: Math.floor(Math.random() * 0x7fffffff), time: 2 };
    // a larger rendering of the same framing (the same aspect and camera): the layer draws it at the same size, sharper
    const res = spec.resolution ?? 1;
    // (an item shown alone casts no shadow: it would float over one)
    const effects = spec.effects && spec.regions ? { ...spec.effects, shadow: { ...spec.effects.shadow, on: false } } : spec.effects;
    return promoShot(e, new THREE.Vector3(...aimDirection(spec)), Math.round(spec.w * res), Math.round(spec.h * res), spec.fill, spec.scaleDistance, spec, true, effects);
  }

  /**
   * Gives shots one scale: each is measured (how far its camera stands to frame it), and all take the farthest, so every character is
   * as large as the others and none is cut off.
   */
  async function sameScale(specs: ShotSpec[], byHeight = false) {
    for (const spec of specs) await measureShot(spec, byHeight);
    shareScale(specs);
  }

  /** How far each shot's camera stood to frame its character when it was measured (see {@link measureShot}). */
  const measured = new WeakMap<ShotSpec, number>();

  /**
   * Measures a shot: how far its camera stands to frame its character as the spec dresses and poses it (`byHeight`: only the height
   * counts, so a wide pose does not make the others small: it reaches past its slot instead). Done in the character's scene while it is
   * open for something else, so that {@link shareScale} needs no visit of its own.
   */
  async function measureShot(spec: ShotSpec, byHeight = false) {
    const e = spec.group ? await dressGroup(spec) : [await dressForShot(spec)];
    const v = ensureViewer();
    const aspect = (spec.w / spec.h) * (byHeight ? 6 : 1);
    const cam = v.framingCamera(e.map((x) => x.actor), new THREE.Vector3(...aimDirection(spec)), aspect, spec.fill);
    measured.set(spec, (cam.userData.distance as number) * spec.fill);
  }

  /** Gives measured shots one scale: all take the farthest camera, so every character is as large as the others and none is cut off. */
  function shareScale(specs: ShotSpec[]) {
    const far = Math.max(0, ...specs.map((s) => measured.get(s) ?? 0));
    for (const spec of specs) spec.scaleDistance = far;
  }

  /** Takes a paint chart as its spec says (1920 × 1080, transparent), the view's camera framing the item for the chart's square pictures. */
  async function takeChart(spec: ChartSpec): Promise<{ canvas: HTMLCanvasElement; cells: ChartCellRect[] }> {
    const db = await loadItemDb();
    const item = db.items.find((i) => i.id === spec.item);
    if (!item) throw new Error("the promo has no such item");
    const e = await enterRole(spec.role);
    const o = (spec.options ??= structuredClone(DEFAULT_CHART)); // (a board made before the chart had settings)
    const worn: Equipped = { item, paint: null, style: spec.style };
    await dressForChart(spec);
    const v = ensureViewer();
    // framed on the item, not the character wearing it: turned, it stays in its cells (a chart of before starts over at the default zoom)
    if (spec.framed !== "item") { spec.framed = "item"; spec.fill = 0.9; spec.panX = 0; spec.panY = 0; }
    // the chart is drawn through the view's camera: it gets the promo's own field of view for the time, so it is the same every time it
    // is taken (the view's is the scene's, which the promo scene brings back when it is opened again)
    const aspect = o.cellAspect;
    const cam = v.framingCamera([e.actor], new THREE.Vector3(...aimDirection(spec)), aspect, spec.fill, PROMO_FOV, undefined, chartBounds(e, spec));
    const target = slideCamera(cam, aspect, PROMO_FOV, spec);
    v.restoreCamera(cam.position.toArray() as [number, number, number], target.toArray() as [number, number, number]);
    await bodyMasksLoaded();
    await nextFrames();
    const W = 1920, H = 1080;
    const unpainted = o.unpainted === "both" ? "both" : o.unpainted === true || o.unpainted === "red";
    const cells = (await paintCells(e, worn, unpainted, o.teams)).filter((c) => !o.removed.includes(c.label));
    const opts: PaintChartOpts = { cols: o.cols, gapX: o.gapX, gapY: o.gapY, padding: o.padding, align: o.align, background: null, width: W, height: H, cellAspect: o.cellAspect, cosmeticOnly: o.cosmeticOnly };
    // laid out at the picture's size, rendered at `resolution` times it (the layer draws it at the same size, sharper)
    const res = spec.resolution ?? 1;
    const RW = Math.round(W * res), RH = Math.round(H * res);
    const fov = v.camera.fov;
    v.camera.fov = PROMO_FOV;
    v.camera.updateProjectionMatrix();
    let image: ImageData;
    try {
      image = await withShotLight(spec.light, async () => v.renderPaintChart(e.actor, cells, opts, RW, RH, item.id));
    } finally {
      v.camera.fov = fov;
      v.camera.updateProjectionMatrix();
      v.releasePaintChart();
    }
    const chart = document.createElement("canvas");
    chart.width = RW;
    chart.height = RH;
    chart.getContext("2d")!.putImageData(image, 0, 0);
    // where each paint is, for the board to point at (to take one out)
    const layout = layoutChart(cells.length, o.cellAspect, { width: W, height: H, gapX: o.gapX, gapY: o.gapY, padding: o.padding, cols: o.cols, align: o.align });
    return { canvas: chart, cells: cells.map((c, i) => ({ label: c.label, x: layout.rects[i].x / W, y: layout.rects[i].y / H, w: layout.rects[i].w / W, h: layout.rects[i].h / H })) };
  }

  /** What a chart frames: its item (the whole character when it shows none of it, or for a chart made before). */
  function chartBounds(e: Entity, spec: ChartSpec): THREE.Box3 | undefined {
    if (spec.framed !== "item") return undefined;
    const box = ensureViewer().itemBounds(e.actor, spec.item);
    return box.isEmpty() ? undefined : box;
  }

  /** Dresses the promo scene's character of a chart in its item (unless it already is); the character. */
  async function dressForChart(spec: ChartSpec): Promise<Entity> {
    const db = await loadItemDb();
    const item = db.items.find((i) => i.id === spec.item);
    if (!item) throw new Error("the promo has no such item");
    const e = await enterRole(spec.role);
    const regions = defaultBodyGroupsFor(e.cls, item.equipRegions);
    const dress = JSON.stringify([[[item.id, null, spec.style]], null, regions]);
    if (promo().dressed.get(spec.role) !== dress) {
      await promoDress(e, [{ item, paint: null, style: spec.style }], null, regions, 0); // a chart is of RED (its cells say which team)
      promo().dressed.set(spec.role, dress);
    }
    return e;
  }

  /** One thing at a time in the promo scene (a shot taken, a look through a camera): they dress its characters and move the view. */
  let promoBusy: Promise<unknown> = Promise.resolve();
  function inPromoScene<T>(job: () => Promise<T>): Promise<T> {
    const mine = session; // the promo the caller works on (its board set it), kept for when the job runs
    const run = promoBusy.then(async () => {
      session = mine;
      promoQuiet = true;
      try {
        return await job();
      } finally {
        promoQuiet = false;
      }
    });
    promoBusy = run.catch(() => {});
    return run;
  }

  /** A new random loadout for a line-up shot: its item kept, two others it can be worn with, unpainted. */
  async function rerollShot(spec: ShotSpec, on?: Entity) {
    if (spec.group) {
      const ents = await enterGroup(spec);
      for (const [i, child] of spec.group.entries()) {
        delete child.place;
        await rerollShot(child, ents[i]);
      }
      return;
    }
    if (!spec.reroll) return;
    const db = await loadItemDb();
    const e = on ?? await enterRole(spec.role);
    const game = gameClassOf(e.cls);
    const conflicts = (a: ItemInfo, b: ItemInfo) => a.equipRegions.some((ra) => b.equipRegions.some((rb) => ra === rb || db.equipConflicts[ra]?.includes(rb) || db.equipConflicts[rb]?.includes(ra)));
    // the others are the game's own cosmetics; the item kept is in it too, a workshop one included (the set being promoted often is)
    const pool = db.items.filter((i) => i.slot !== "taunt" && (!i.workshop || i.id === spec.reroll!.item) && itemUsableBy(i, game) && itemModelFor(i, game) !== null);
    const rules: LoadoutRule[] = [{ mode: "include", kind: "item", value: String(spec.reroll.item) }, { mode: "exclude", kind: "medal", value: "" }];
    const rolled = rollLoadout(pool, db.paints, conflicts, rules, { count: 3, paintChance: 0, styles: false, workshop: false });
    if ("items" in rolled) spec.loadout = rolled.items.map((x) => ({ item: x.item.id, name: x.item.displayName, paintable: x.item.paintable, paint: null, style: 0 }));
  }

  async function generatePromo(set: ItemInfo[], game: string, say: (text: string) => void, only?: "lineup"): Promise<string> {
    const mdl = CLASSES.find((c) => c[2] === game)?.[1];
    if (!mdl) return "No such class.";
    const db = await loadItemDb();
    // the class's stock weapon, held in its idle: the first of primary, secondary, melee it has
    const stock = db.weapons.filter((w) => w.baseItem && itemUsableBy(w, game));
    const weapon = ["primary", "secondary", "melee"].map((slot) => stock.find((w) => slotForClass(w, game) === slot)).find((w) => !!w) ?? null;
    say("Setting up the promo scenes…");
    // the pictures are taken in scene tabs of their own, one per character (made as the shots need them), kept to take shots again;
    // the scene you had comes back. The view is covered meanwhile: the scenes coming and going are not a thing to watch.
    const busy = document.createElement("div");
    busy.className = "dropBusy promoBusy";
    busy.setAttribute("role", "status");
    busy.innerHTML = '<div class="dropBusyCard"><span class="dropBusySpin"></span><span></span></div>';
    const busyText = busy.querySelector(".dropBusyCard > span:last-child") as HTMLElement;
    const tell = (text: string) => { busyText.textContent = `Generating the promo pictures… ${text}`; say(text); };
    document.body.appendChild(busy);
    let pictures: PromoPicture[] = [];
    const mine = newSession(set.map((i) => i.displayName).join(" · "), set.map((i) => i.id), mdl);
    sessions.add(mine);
    session = mine;
    let made = false;
    try {
      const home = activeTab;
      promoQuiet = true;
      try {
        pictures = await takePromo(set, mdl, game, tell, weapon, db, only);
      } finally {
        promoQuiet = false;
        promoHome = null;
        if (home && tabs.includes(home)) await switchTab(home);
        syncStaleUi();
      }
      // the board: a tab of the strip beside the scenes, shown in the view's place, and kept between runs
      if (!openBoard(mine, `Promo: ${set.map((i) => i.displayName).join(", ")}`, pictures, true)) return "There is nowhere to show the board.";
      made = true;
      scheduleSave(mine);
      return `${pictures.length} pictures are on the board.`;
    } finally {
      busy.remove();
      if (!made) void disposeSession(mine);
    }
  }

  /** Writing a board's pictures, and taking its shots again: each call is for the board's own promo. */
  const hostFor = (mine: PromoSession): BoardHost => {
    const h = promoBoardHost;
    const bound = {} as Record<string, unknown>;
    for (const k of Object.keys(h) as (keyof BoardHost)[]) bound[k] = (...args: unknown[]) => { session = mine; return (h[k] as (...a: unknown[]) => unknown)(...args); };
    return bound as unknown as BoardHost;
  };
  const promoBoardHost: BoardHost = {
    async exportAll(pictures, look, format = "png") {
      const picked = await open({ directory: true, title: format === "psd" ? "Folder for the promo Photoshop files" : "Folder for the promo pictures" });
      const dir = typeof picked === "string" ? picked : null;
      if (!dir) return "Cancelled.";
      const sep = dir.includes("\\") ? "\\" : "/";
      for (const p of pictures) {
        const bytes = format === "psd" ? await picturePsd(p, look) : new Uint8Array(await (await pictureBlob(p, look)).arrayBuffer());
        await writeBinaryFile(`${dir}${sep}${p.name}.${format}`, bytes);
      }
      // the board's settings beside them (no pixels): how each picture was made and changed, to make it again or learn from
      const board = {
        look,
        pictures: pictures.map((p) => ({
          item: p.item, name: p.name, kind: p.kind, w: p.w, h: p.h, backdrop: p.backdrop, strokeAt: p.strokeAt,
          layers: p.layers.map((l) => ({ name: l.name, box: l.box, scale: l.scale, dx: l.dx, dy: l.dy, rotation: l.rotation ?? 0, hidden: l.hidden, shared: l.shared, link: l.link, shot: l.shot ? { ...l.shot, pose: l.shot.pose ? "(bones)" : undefined } : undefined, chart: l.chart, text: l.text })),
        })),
      };
      await writeBinaryFile(`${dir}${sep}promo-board.json`, new TextEncoder().encode(JSON.stringify(board, null, 1)));
      void revealFile(dir).catch(() => {}); // the folder, to look at what was made
      return `Saved ${pictures.length} ${format === "psd" ? "Photoshop files" : "pictures"} to ${dir}.`;
    },
    retake: (l) => inPromoScene(async () => {
      if (l.shot) l.image = await takeShot(l.shot);
      else if (l.chart) {
        const taken = await takeChart(l.chart);
        l.image = taken.canvas;
        l.cells = taken.cells;
      }
    }),
    // a quick look through a layer's camera, small: the shot's slot, or one picture of a chart
    cameraView: (l, w, h) => inPromoScene(async () => {
      if (l.shot) {
        const e = l.shot.group ? await dressGroup(l.shot) : await dressForShot(l.shot);
        return promoShot(e, new THREE.Vector3(...aimDirection(l.shot)), w, h, l.shot.fill, l.shot.scaleDistance, l.shot, false, undefined, undefined, true);
      }
      const spec = l.chart!;
      const e = await dressForChart(spec);
      return promoShot(e, new THREE.Vector3(...aimDirection(spec)), w, h, spec.fill, undefined, spec, false, undefined, chartBounds(e, spec));
    }),
    reroll: (spec) => inPromoScene(() => rerollShot(spec)),
    repose: (spec) => inPromoScene(() => rollShotPose(spec)),
    poses: (spec) => inPromoScene(async () => {
      const { taunts, sequences } = await shotPoses(spec);
      return { taunts: taunts.map((t) => ({ id: `t${t.id}`, label: t.displayName })).sort((a, b) => a.label.localeCompare(b.label)), sequences: sequences.map((q) => ({ id: `s${q.name}`, label: q.name })) };
    }),
    setPose: (spec, id, at) => inPromoScene(async () => { await poseShot(spec, id, at); }),
    bodygroups: (spec) => inPromoScene(async () => {
      const e = await dressForShot(spec);
      const parts = models.get(classPath(e.cls))?.bodyParts.filter((bp) => bp.models.length > 1) ?? [];
      return parts.map((bp) => {
        const key = bp.name.toLowerCase();
        const byItems = e.bodyItems[key] ?? e.bodyItems[bp.name];
        return { name: key, count: bp.models.length, byItems: byItems === undefined ? null : byItems };
      });
    }),
    editIn3D: (l) => (l.shot ? editShotIn3D(l.shot) : Promise.resolve(false)),
    paints: async () => (await loadItemDb()).paints.map((p) => ({ id: p.id, name: p.displayName })),
    lightDirection: viewLightDirection,
    changed: () => { if (session) scheduleSave(session); },
    newSet: () => els.capture.promo.click(),
  };

  /** The pictures of a promo set, taken in the promo scene that is open (its characters by role: RED, BLU, the item alone, the line-up). */
  async function takePromo(set: ItemInfo[], mdl: string, game: string, say: (text: string) => void, weapon: ItemInfo | null, db: Awaited<ReturnType<typeof loadItemDb>>, only?: "lineup"): Promise<PromoPicture[]> {
    const RED = 0, BLU = 1, SOLO = 2, LINEUP = 3;
    /** Only the line-ups (a test of them: the rest of the pictures are skipped). */
    const full = only !== "lineup";
    const W = 1920, H = 1080;
    const slug = (s: string) => s.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_") || "item";
    const out: PromoPicture[] = [];
    const picture = (item: ItemInfo, name: string, kind: string, w: number, h: number, layers: PromoLayer[], texts: PromoText[] = []) => out.push({ item: item.displayName, name, kind, w, h, layers, texts, backdrop: null });
    const worn = (item: ItemInfo, paint: PaintInfo | null = null, style = 0) => ({ item: item.id, name: item.displayName, paintable: item.paintable, paint: paint?.id ?? null, style });
    // a shot's layer: its slot, grown by the margin it was taken with (aligned in the middle: the slot is where the shot puts it)
    const shot = async (name: string, spec: ShotSpec, x: number, y: number, w: number, h: number, centre = false) => {
      const l: PromoLayer = { ...layer(name, await takeShot(spec), ...marginBox(x, y, w, h)), shot: spec, centre };
      measureContent(l);
      return l;
    };
    const FRONT = { yaw: 24, pitch: 13 };

    // Each character has a scene of its own, and every visit to one is a scene switch: the work is ordered by character, not by item.
    // RED and BLU, then every item's own pictures (all of the one character wearing it alone), then the line-ups, their characters
    // dressed, posed and measured for every item in one visit each, and pictured for every item in another.
    say("Picturing the set…");
    const setWorn = set.map((i) => worn(i));
    const redSpec: ShotSpec = { role: RED, loadout: setWorn, weapon: weapon?.id ?? null, regions: null, yaw: 22, pitch: 4, fill: 1, w: 700, h: 1064 };
    const bluSpec: ShotSpec = { ...redSpec, role: BLU, loadout: set.map((i) => worn(i)), yaw: -37 };
    // one scale by their heights, as the line-ups: they stand as tall as the picture, a long weapon reaching past its slot
    if (full) await sameScale([redSpec, bluSpec], true);
    const redImage = full ? await takeShot(redSpec) : document.createElement("canvas"), bluImage = full ? await takeShot(bluSpec) : document.createElement("canvas");

    /** A line-up to picture: the item's, and its composition (the characters in one scene). */
    interface Lineup { item: ItemInfo; name: string; spec: ShotSpec }
    const lineups: Lineup[] = [];
    for (const item of set) {
      const name = slug(item.displayName);
      const regions = defaultBodyGroupsFor(mdl, item.equipRegions);
      // a line-up: each character wears the item and two random others it can be worn with, unpainted; all of them stand in one scene and are
      // pictured together (each turned a little, the camera in front of the row)
      const characters = Array.from({ length: PROMO_LINEUP }, (_, i): ShotSpec => ({ role: LINEUP + i, loadout: [worn(item)], weapon: weapon?.id ?? null, regions: null, yaw: 0, pitch: 0, fill: 1, w: 1, h: 1, turn: LINEUP_TURN[i] ?? 0, reroll: { item: item.id } }));
      const spec: ShotSpec = { role: GROUP_ROLE, loadout: [], weapon: null, regions: null, yaw: 0, pitch: 0, fov: 25, fill: 1, w: W - 20, h: H - 16, group: characters, reroll: { item: item.id }, randomPose: true };
      lineups.push({ item, name, spec });
      if (!full) continue;
      const aloneSpec = (w: number, h: number, fill: number, extra: Partial<ShotSpec> = {}): ShotSpec => ({ role: SOLO, loadout: [worn(item)], weapon: null, regions, ...FRONT, fill, w, h, ...extra });

      say(`${item.displayName}: main picture…`);
      // RED and BLU are one shot each, shared by every main picture
      picture(item, `${name}_main`, "Main", W, H, [
        // (BLU first: RED is drawn over it)
        { ...layer("BLU", bluImage, ...marginBox(400, 8, 700, 1064)), shot: bluSpec, link: "blu", shared: true },
        { ...layer("RED", redImage, ...marginBox(10, 8, 700, 1064)), shot: redSpec, link: "red", shared: true },
        await shot(item.displayName, aloneSpec(760, 980, 1, { fov: 20 }), 1140, 50, 760, 980, true), // (a longer lens: it deforms the item less)
      ]);

      say(`${item.displayName}: thumbnail…`);
      picture(item, `${name}_thumb`, "Thumbnail", 512, 512, [await shot(item.displayName, aloneSpec(512, 512, 0.92), 0, 0, 512, 512, true)]);

      // the styles side by side, and a paint chart of each (of the item itself when it has one look)
      const styles = item.styles.length > 1 ? item.styles.slice(0, MAX_PROMO_STYLES) : [];
      const styleName = (i: number) => item.styles[i]?.name || `Style ${i + 1}`;
      if (styles.length) {
        say(`${item.displayName}: styles…`);
        // styles of one model and the same parts differ in their textures only, which unpainted can look alike: they are shown painted
        const shapes = new Set(styles.map((st, i) => `${itemModelFor(item, game, i)}|${JSON.stringify(st.bodygroups ?? {})}`));
        const paint = shapes.size === 1 && item.paintable ? stylePaint(db.paints) : null;
        const cellW = Math.floor((W - 80) / styles.length);
        const layers: PromoLayer[] = [], names: PromoLayer[] = [];
        const specs = styles.map((_, i) => aloneSpec(cellW, 920, 0.95, { loadout: [worn(item, paint, i)] }));
        await sameScale(specs);
        for (let i = 0; i < styles.length; i++) {
          const x = 40 + i * cellW;
          layers.push(await shot(styleName(i), specs[i], x, 40, cellW, 920, true));
          names.push(await textLayer(styleName(i), { ...DEFAULT_TEXT, text: styleName(i), font: "resource/tf2build.ttf", weight: 400, size: 64, shadow: true, color: "#ffffff" }, x + cellW / 2, 1010));
        }
        picture(item, `${name}_styles`, "Styles", W, H, [...layers, ...names]);
      }
      if (item.paintable) {
        for (let i = 0; i < Math.max(1, styles.length); i++) {
          say(`${item.displayName}: paint chart${styles.length ? ` (${styleName(i)})` : ""}…`);
          const spec: ChartSpec = { role: SOLO, item: item.id, style: i, ...FRONT, fill: 0.9, options: structuredClone(DEFAULT_CHART) };
          const taken = await takeChart(spec);
          picture(item, styles.length ? `${name}_paints_${slug(styleName(i))}` : `${name}_paints`, styles.length ? `Paint chart: ${styleName(i)}` : "Paint chart", W, H, [{ ...layer("Paints", taken.canvas, 0, 0, W, H), chart: spec, cells: taken.cells }]);
        }
      }

    }

    // the line-ups: each item's four characters are dressed and posed in the one scene, and pictured together
    for (const lu of lineups) {
      say(`${lu.item.displayName}: loadouts…`);
      await rerollShot(lu.spec);
      await rollShotPose(lu.spec);
      picture(lu.item, `${lu.name}_loadout`, "Loadouts", W, H, [await shot("Line-up", lu.spec, 10, 8, W - 20, H - 16)]);
    }
    return out;
  }

  // dev builds: makes a promo from code (a test of it need not click through the window): `__promoDev.generate(["Bill's Hat"], "lineup")`
  if (import.meta.env.DEV) {
    (window as unknown as { __promoDev: unknown }).__promoDev = {
      /** How much of its slot each shot of the open promo fills: the silhouette's width and height, as shares of the slot's (a test of the framing). */
      fill: () => (session?.pictures ?? []).flatMap((p) => p.layers.filter((l) => l.shot).map((l) => {
        const solid = solidOf.get(l.image) ?? l.image;
        const { width, height } = solid;
        const data = solid.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, width, height).data;
        let x0 = width, y0 = height, x1 = -1, y1 = -1;
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] > 12) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        const slotW = width / (1 + 2 * PROMO_MARGIN.x), slotH = height / (1 + 2 * PROMO_MARGIN.y);
        return { picture: p.kind, layer: l.name, widthShare: +((x1 - x0 + 1) / slotW).toFixed(2), heightShare: +((y1 - y0 + 1) / slotH).toFixed(2) };
      })),
      generate: async (names: string[], only?: "lineup") => {
        const db = await loadItemDb();
        const set = names.map((n) => db.items.find((i) => i.displayName === n)).filter((i): i is ItemInfo => !!i);
        return generatePromo(set, selected ? gameClassOf(selected.cls) : "scout", () => {}, only);
      },
    };
  }

  els.capture.promo.onclick = () =>
    openPromo({
      catalog: async () => {
        const db = await loadItemDb();
        return db.items.filter((i) => i.slot !== "taunt").sort((a, b) => a.displayName.localeCompare(b.displayName));
      },
      preferredClass: () => (selected && !isBuildingCls(selected.cls) ? gameClassOf(selected.cls) : null),
      currentSet: () => {
        const e = selected;
        if (!e || isBuildingCls(e.cls)) return [];
        if (e === selected) saveUi(e);
        const game = gameClassOf(e.cls);
        return e.items.loadout.filter((x) => x.item.slot !== "taunt" && itemUsableBy(x.item, game)).map((x) => x.item.id);
      },
      classesFor: (set) => CLASSES.filter((c) => set.every((i) => itemUsableBy(i, c[2]) && itemModelFor(i, c[2]) !== null)).map((c) => ({ label: c[0], game: c[2] })),
      generate: generatePromo,
    });

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
        loadout: e.items.loadout.map((l) => ({ item: l.item.id, paint: l.paint?.id ?? null, style: l.style, ...(l.hidden ? { hidden: true } : {}) })),
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
        gray: e.actor.gray || undefined,
        bodyShown: e.actor.partsHidden ? [...e.actor.visibleRegions] : undefined,
        bodyMaskVersion: 1,
        bodyTris: e.actor.handMaskState,
        fogged: e.actor.fogged ? undefined : false,
        eyesFollowCamera: e.actor.followsCamera || undefined,
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
      e.actor.setEyesFollowCamera(s.eyesFollowCamera === true);
      if (s.bodyShown) e.actor.setVisibleRegions(s.bodyShown, s.bodyMaskVersion !== 1);
      else if (s.inspectOnly) e.actor.setVisibleRegions([]); // scenes saved before the parts picker showed no body
      if (s.conditions) e.actor.setConditions(s.conditions); // the materials follow when the model shows; syncConditions starts the rest
      if (s.gray) e.actor.setGray(true);
      e.lod = s.lod ?? 0;
      e.bodyManual = new Map(Object.entries(s.bodygroups ?? {}));
      e.actor.setBodygroups(Object.fromEntries(e.bodyManual));
      const loadout: Equipped[] = s.loadout.flatMap((l) => {
        const item = byId.get(l.item);
        return item ? [{ item, paint: l.paint !== null ? paints.get(l.paint) ?? null : null, style: l.style, ...(l.hidden ? { hidden: true } : {}) }] : [];
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
    uiStale = false;
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
    /** A small picture of the view as the tab was left, shown when the pointer rests on the tab (none until it has been in front). */
    preview?: string;
    /**
     * A promo scene in the background keeps its character as it is (parked, out of the view) instead of being built again from its
     * saved scene when it comes back: a switch to it is then a moment's work. Such a scene shares the lights and look of the scene that
     * is open.
     */
    parked?: { entities: Entity[]; groups: HierarchyGroup[]; selected: Entity | null };
    /** A promo board (a set's pictures) in place of a scene: shown in the view's place while it is the tab in front. */
    board?: { root: HTMLElement; session: PromoSession; dispose: () => void };
  }
  const tabs: SceneTab[] = [];
  let activeTab: SceneTab | null = null;
  let nextTabId = 1;
  let tabBusy = false;
  const fingerprint = (scene: SceneFile) => JSON.stringify({ ...scene, camera: null });
  const tabStrip = document.getElementById("sceneTabs");
  const strip = tabStrip
    ? createSceneTabs(tabStrip, {
        select: (id) => {
          const t = tabs.find((x) => x.id === id);
          if (!t) return;
          if (t.board) showBoardTab(t);
          else {
            if (activeBoard) hideBoardTab();
            void switchTab(t);
          }
        },
        close: (id) => {
          const t = tabs.find((x) => x.id === id);
          if (t?.board) void closeBoardTab(t);
          else void closeTab(t);
        },
        add: () => void openTab(null),
        rename: (id, name) => {
          const t = tabs.find((x) => x.id === id);
          if (t) t.name = name;
          if (t?.board) scheduleSave(t.board.session);
          renderTabs();
        },
      })
    : null;
  function renderTabs() {
    strip?.render(tabs.map((t) => ({ id: t.id, name: t.name, dirty: t.dirty, preview: t.preview })), (activeBoard ?? activeTab)?.id ?? -1);
    syncIconMode();
  }

  /** Parks the open promo scene's characters: out of the view, kept as they are, to be put back when the scene comes to the front. */
  function parkActive() {
    const t = activeTab;
    const v = ensureViewer();
    if (!t) return;
    for (const e of entities) v.detachActor(e.actor);
    t.parked = { entities: [...entities], groups, selected };
    entities.length = 0;
    groups = [];
    selected = null;
    gizmoEntity = null;
    v.setActorGizmo(null);
  }

  /** Puts a parked scene's characters back in the view, in place of what is there (which is taken out and disposed of). */
  function unpark(tab: SceneTab) {
    const p = tab.parked;
    if (!p) return;
    tab.parked = undefined;
    const v = ensureViewer();
    editHistory.clear();
    for (const e of [...entities]) v.removeActor(e.actor);
    entities.length = 0;
    gizmoEntity = null;
    v.setActorGizmo(null);
    for (const e of p.entities) {
      v.attachActor(e.actor);
      entities.push(e);
      void applyUnusuals(e);
    }
    groups = p.groups;
    selected = p.selected && entities.includes(p.selected) ? p.selected : entities[0] ?? null;
    if (selected) v.select(selected.actor);
    if (promoQuiet) uiStale = true;
    else {
      if (selected) restoreUi(selected);
      renderEntities();
    }
  }

  /** Disposes of a closed tab's parked characters. */
  function disposeParked(tab: SceneTab) {
    const p = tab.parked;
    if (!p) return;
    tab.parked = undefined;
    for (const e of p.entities) e.actor.dispose();
  }

  /** Stores the open tab's live scene into it. */
  function captureActive() {
    if (!activeTab) return;
    const scene = serializeScene();
    if (!scene) return;
    activeTab.scene = scene;
    activeTab.dirty = fingerprint(scene) !== activeTab.base;
  }

  /** Keeps a picture of the view in the open tab before another scene takes its place. */
  function snapshotActive() {
    if (activeTab && viewer) activeTab.preview = viewer.viewSnapshot() ?? activeTab.preview;
  }

  /** Play and pose modes do not carry over between scenes: a pose in progress is held as a custom pose before the scene is stored. */
  function settleForSwitch() {
    if (promoEditing) finishShotEdit(false, false); // a promo shot edited in 3D is of this scene: the edit is dropped (the board stays as it was)
    closePaintChart(); // the chart is of a cosmetic of this scene
    rolledExtras = []; // the characters a roll added are this scene's
    stopVoices();
    closeVoiceLines(); // its line is on a character of this scene
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
      if (isPromoTab(activeTab)) parkActive();
      else snapshotActive();
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
      // a promo scene is parked, not rebuilt: its character waits out of the view, and comes back as it was in a moment
      if (isPromoTab(activeTab)) parkActive();
      else snapshotActive();
      activeTab = tab;
      renderTabs();
      if (tab.parked) unpark(tab);
      else await applyScene(tab.scene);
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
    forgetPromoTab(tab);
    if (tab !== activeTab) {
      tabs.splice(at, 1);
      disposeParked(tab);
      renderTabs();
      return;
    }
    tabBusy = true;
    try {
      settleForSwitch();
      tabs.splice(at, 1);
      const next = tabs.slice(at).find((t) => !t.board) ?? tabs.slice(0, at).reverse().find((t) => !t.board);
      if (next?.scene) {
        activeTab = next;
        renderTabs();
        if (next.parked) unpark(next);
        else await applyScene(next.scene);
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

  els.capture.paintChart.onclick = () => makePaintChart();
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
  let previewDue = false;
  function startAutosave() {
    if (autosave) return;
    autosave = window.setInterval(() => {
      if (tabBusy) return;
      const before = activeTab?.dirty;
      captureActive();
      if (activeTab?.dirty !== before) renderTabs();
      const scenes = tabs.filter((t) => !t.board); // (a promo board is not kept between sessions)
      if (!scenes.length || scenes.some((t) => !t.scene)) return;
      const session = {
        app: "tf2-workbench",
        tabs: scenes.map((t) => ({ name: t.name, path: t.path ?? null, base: t.base, scene: t.scene })),
        active: Math.max(0, activeTab ? scenes.indexOf(activeTab) : 0),
      };
      // compared without the pictures; the open tab's picture is taken a tick after the scene last changed (what is loading has had time to show)
      const text = JSON.stringify(session);
      if (text === lastSession) {
        if (!previewDue) return;
        previewDue = false;
        snapshotActive();
      } else {
        lastSession = text;
        previewDue = true;
      }
      const withPreviews = { ...session, tabs: session.tabs.map((s, i) => ({ ...s, preview: scenes[i].preview ?? null })) };
      void saveSession(JSON.stringify(withPreviews)).catch(() => {});
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
        if (typeof r.preview === "string" && r.preview.startsWith("data:image/")) tab.preview = r.preview;
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
    await restoreBoards();
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
    area: "M2 3.500h14v4H2zM4 7.500 2.500 15.500M9 7.500v8M14 7.500l1.500 8",
    folder: "M2 5h5l2-2h7v12H2zM2 7h14",
  };
  const propsRoot = document.getElementById("propsPane");
  if (propsRoot) createPropPanel(propsRoot, { add: (path, at) => void addProp(path, at) });
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
      { label: "Prop…", icon: ICON.buildable, hint: "opens the prop browser", run: () => document.dispatchEvent(new CustomEvent("workbench:reveal-panel", { detail: "props" })) },
      {
        label: "Light",
        icon: ICON.light,
        separator: true,
        children: [
          { label: "Directional", icon: ICON.sun, run: () => addLightFromMenu("directional") },
          { label: "Point", icon: ICON.point, run: () => addLightFromMenu("point") },
          { label: "Spot", icon: ICON.spot, run: () => addLightFromMenu("spot") },
          { label: "Area", icon: ICON.area, run: () => addLightFromMenu("area") },
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
  function addLightFromMenu(type: "directional" | "point" | "spot" | "area") {
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
    // a line-up being edited in 3D: the characters stand this far from each other, in their order (they are placed by hand, so the view's own
    // row spacing leaves them alone)
    if (promoEditing?.spec.group && viewer) {
      const ents = promoEditing.ents, gap = +els.entities.spacing.value;
      ents.forEach((e, i) => viewer!.placeActor(e.actor, ((ents.length - 1) / 2 - i) * gap, e.actor.offset.y, e.actor.offset.z, e.actor.yaw));
    }
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
    editedPost("fog", {
      enabled: f.on.checked, color: f.color.value, top: +f.top.value, bottom: +f.bottom.value, middle: +f.middle.value, softness: +f.softness.value, view: f.view.checked,
      style: f.style.value === "mist" ? "mist" : "gradient", scale: +f.scale.value, speed: +f.speed.value, wind: +f.wind.value, detail: +f.detail.value,
      coverage: +f.coverage.value, shafts: +f.shafts.value, bands: +f.bands.value,
    });
    const mistBox = document.getElementById("fogMistBox");
    if (mistBox) mistBox.hidden = f.style.value !== "mist";
    const label = (el: HTMLInputElement, text: string) => {
      const out = el.parentElement?.querySelector("output");
      if (out) out.textContent = text;
    };
    label(f.top, (+f.top.value).toFixed(2));
    label(f.bottom, (+f.bottom.value).toFixed(2));
    label(f.middle, (+f.middle.value).toFixed(2));
    label(f.softness, (+f.softness.value).toFixed(2));
    label(f.scale, (+f.scale.value).toFixed(2));
    label(f.coverage, (+f.coverage.value).toFixed(2));
    label(f.detail, f.detail.value);
    label(f.speed, (+f.speed.value).toFixed(2));
    label(f.wind, `${f.wind.value}°`);
    label(f.shafts, (+f.shafts.value).toFixed(2));
    label(f.bands, +f.bands.value === 0 ? "smooth" : f.bands.value);
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
    e.style.value = f.style;
    e.scale.value = String(f.scale);
    e.coverage.value = String(f.coverage);
    e.detail.value = String(f.detail);
    e.speed.value = String(f.speed);
    e.wind.value = String(f.wind);
    e.shafts.value = String(f.shafts);
    e.bands.value = String(f.bands);
    applyFog();
  }
  for (const el of [els.fog.on, els.fog.color, els.fog.top, els.fog.bottom, els.fog.middle, els.fog.softness, els.fog.view, els.fog.scale, els.fog.coverage, els.fog.detail, els.fog.speed, els.fog.wind, els.fog.shafts, els.fog.bands]) el.oninput = applyFog;
  // the mist starts from the colour and the gradient that suit it
  els.fog.style.onchange = () => {
    const mist = els.fog.style.value === "mist";
    showFog({ ...DEFAULT_FOG, ...(mist ? MIST_PRESET : {}), enabled: els.fog.on.checked, view: false });
  };
  els.fog.reset.onclick = () => showFog({ ...DEFAULT_FOG, ...(els.fog.style.value === "mist" ? MIST_PRESET : {}), enabled: els.fog.on.checked });
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
  const grayButton = document.getElementById("teamGray") as HTMLButtonElement | null;
  function markTeams() {
    els.teams.forEach((b, i) => b.classList.toggle("on", i === (selected?.team ?? 0)));
    const gray = !!selected?.actor.gray;
    grayButton?.classList.toggle("on", gray);
    grayButton?.setAttribute("aria-pressed", String(gray));
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
  if (grayButton) grayButton.onclick = () => {
    const e = selected;
    if (!e) return;
    e.actor.setGray(!e.actor.gray);
    markTeams();
  };
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
      if (on) {
        // the compiler drives the viewer's bone helper itself: close the read-only inspector's drawing first
        selectedJiggle = null;
        clearJiggleDrawing();
        void compiler.show();
      } else {
        compiler.hide();
        renderJiggles();
      }
    },
    async onShown() {
      // the board in front, if any, stays in the view's place
      if (activeBoard) showBoardTab(activeBoard);
      else { const page = document.getElementById("promoPage"); if (page) page.hidden = true; }
      if (!els.isIndexed()) { els.info.textContent = "TF2 not indexed yet."; return; }
      await leavePromoScene(); // a shot was taken again in the promo scene: the scene you had comes back
      syncStaleUi(); // a promo scene that stays open (a shot edited in 3D) shows its panels
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
