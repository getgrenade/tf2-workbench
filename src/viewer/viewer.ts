import {HitReactions} from "./hitReactions";
import { SOURCE_TO_VIEWER } from "./animator";
import * as THREE from "three";
import { rectsOverlap, type BoxHits, type BoxRect } from "./boxSelect";
import { keyboardScaleFactor } from "./scaleGizmo";
import { PlacementHistory, type PlacementSnapshot } from "./placementHistory";
import { CameraRig } from "./cameraRig";
import { CameraOverlay } from "./cameraOverlay";
import { parseOverlay } from "./overlayData";
import { ViewportCamera } from "./viewportCamera";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { Actor, type ActorContext, type ViewSelection } from "./actor";
import { GeometryCache } from "./geometryCache";
import { FloorGrid } from "./floorGrid";
import { GroundShadow } from "./groundShadow";
import { DEFAULT_GROUND, GroundPlane, type GroundState } from "./groundPlane";
import { freeSlot, slotOffset } from "./layout";
import { RigOverlay } from "./rigOverlay";
import { GizmoSet, createGizmo, gizmoKey } from "./gizmos";
import { turnMatrix, type BoneTurn } from "../compiler/boneAxes";
import { cameraProjection } from "./cameraData";
import { buildJiggleHelper, disposeHelper } from "./jiggleHelper";
import type { JiggleSetup } from "../compiler/jiggleBones";
import type { ClipData, MaterialData, ModelData } from "./payload";
import { DEFAULT_SHADOW, type ShadowParams } from "./shadowMath";
import { SourceMaterials, type SharedUniforms } from "./sourceMaterials";
import { FOG_GLSL, MAX_FOGS, applyFogUniforms, type FogState } from "./fog";
import { DEFAULT_AO, type AoState } from "./aoMath";
import { AoPass } from "./aoPass";
import { BloomPass, LOOK_GLSL, applyLookUniforms, createLookUniforms, type LookStates } from "./look";
import { DofPass, MotionAccumulator, subframeOffsets } from "./lookPasses";
import { FloorReflection } from "./floorReflection";
import { DEFAULT_RIM_LIGHT, MAX_RIM_LIGHTS, parseRimLight, type RimLightState } from "./rimLight";
import { ActorEffects, cosmeticHitboxes, nativeHitboxes } from "./particles/effects";
import { ConditionParticles, type LaneWant } from "./particles/conditionLanes";
import { loadParticleModel } from "./particles/assets";
import { CONDITION_SECONDS, conditionParticles, type ConditionKey, type Conditions } from "./conditions";
import { DispenserScreens, buildingWants, laneWants, type BuildingFx } from "./buildingFx";
import { buildingOf } from "./buildings";
import { WeaponEffects, type ShellLoader } from "./particles/weapons";
import type { WeaponProfile } from "../api";
import type { UnusualSettings } from "./particles/assets";
import { particleCacheData, particleCacheTextures } from "./particles/assets";
import { cachedDataBytes, cachedGpuBytes, textureImages } from "./cacheMemory";
import { bodyMaskTextures } from "./bodyMasks";
import { bodyMaskPass } from "./bodyMaskPass";
import { lightDirection, parseLightingRig, rotateLightDirection, type LightingRig } from "./lighting";
import { LightingRenderer } from "./lightingRenderer";
import { LightGizmos } from "./lightGizmos";
import { hotkeyMatches, mouseButtonOf, redoMatches } from "../hotkeys";
import { LAYER_GLSL, adaptAlpha, planLayers, rimLayerName, rimLayerPixels, sceneOnlyLook, type ExportLayer } from "./layerExport";
import { resolveCaptureEmission } from "./captureAlpha";

export type { CosmeticSpec } from "./actor";

export interface LightState {
  rig?: LightingRig;
  /** Degrees around the vertical axis; 0 = from the front. */
  azimuth: number;
  /** Degrees above the horizon. */
  elevation: number;
  /** Directional light color scale (hlmv default 1.0). */
  intensity: number;
  /** Directional light colour as shown in the colour picker (`#rrggbb`, gamma space; hlmv default white). */
  color: string;
  /** Flat ambient level on all six cube faces (hlmv default 0.3). */
  ambient: number;
  /** Ambient colour as shown in the colour picker (`#rrggbb`, gamma space; default white). */
  ambientColor: string;
  /** Light stays fixed relative to the camera, like hlmv where the model rotates under the light. */
  followCamera: boolean;
}

/** An extra point light placed in the scene (world space, around the model's centre). */
export interface PointLightState {
  enabled: boolean;
  /** Degrees around the vertical axis; 0 = in front of the model. */
  azimuth: number;
  /** Degrees above the horizon. */
  elevation: number;
  /** Distance from the model centre, in model radii. */
  distance: number;
  /** Distance at which the light fades to nothing, in model radii. */
  range: number;
  /** Attenuation curve exponent: 1 is a gentle fade, larger values concentrate the light near the source. */
  falloff: number;
  intensity: number;
  /** Colour as shown in the colour picker (`#rrggbb`). */
  color: string;
}

export const DEFAULT_POINT_LIGHT: PointLightState = { enabled: false, azimuth: 45, elevation: 20, distance: 1.2, range: 2.5, falloff: 1.5, intensity: 1.5, color: "#ffffff" };

// hlmv defaults (viewersettings.cpp): white directional light, 0.3 ambient, 65 degree horizontal FOV,
// 0.25 gray background.
export const HLMV_FOV_X = 65;
/** The field of view the viewer starts with (horizontal degrees); hlmv itself starts at {@link HLMV_FOV_X}. */
export const DEFAULT_FOV_X = 30;
const HLMV_BACKGROUND = 0x404040;
/** The selection flash: its length (ms), colour (the interface's accent) and the layer the flashing character is also on. */
const FLASH_MS = 450;
/** How strong the outline starts (1 = solid). */
const FLASH_OPACITY = 0.5;
const FLASH_COLOR = 0xe08a3c;
const FLASH_LAYER = 1;
/** The outline that stays around the selected characters: the layer they are also on, and how strong it is. */
const SELECT_LAYER = 2;
const SELECT_OPACITY = 0.85;
/** Default distance between two neighbouring characters (Source units; a player hull is 49 wide). */
export const DEFAULT_SPACING = 72;

/** Three.js scene with orbit controls, an hlmv-style light rig and any number of Source-shaded characters. */
/** A display colour ("#rrggbb") in the linear light the scene is drawn in (the same 2.2 curve as the light colours use). */
function displayColor(hex: string): THREE.Vector3 {
  const c = /^#?([0-9a-f]{6})$/i.exec(hex.trim())?.[1] ?? "ffffff";
  return new THREE.Vector3(...[0, 2, 4].map((i) => Math.pow(parseInt(c.slice(i, i + 2), 16) / 255, 2.2)) as [number, number, number]);
}

/** Where a click landed: the cosmetic item under it (null: the character's own body) and the position on screen. */
export interface PickHit {
  item: number | null;
  x: number;
  y: number;
}

export class Viewer {
  readonly cameras: CameraRig;
  readonly cameraOverlay: CameraOverlay;
  onUnusualError: (actor: Actor, error: unknown) => void = () => {};
  private readonly unusualEffects = new Map<Actor, { key: string; effect: ActorEffects | null; pending: Promise<void> }>();
  /** The particles of the conditions a character is in (drips, flames), and the seconds left of the conditions Play mode applied. */
  private readonly conditionParticles = new ConditionParticles();
  /** Characters that are buildings: their particles are the building's (setBuildingFx), not those of player conditions. */
  private readonly buildingActors = new Set<Actor>();
  private readonly buildingTokens = new Map<Actor, number>();
  private readonly dispenserScreens = new Map<Actor, DispenserScreens>();
  private readonly conditionTokens = new Map<Actor, number>();
  private readonly conditionTimers = new Map<Actor, Map<ConditionKey, number>>();
  /** Told when Play mode starts a condition or a timed one ends by itself. */
  onConditionsChanged: (actor: Actor) => void = () => {};
  private readonly storedWeaponEffects=new Map<Actor,WeaponEffects[]>();
  private reactions:HitReactions|null=null;
  private hitReactionsEnabled=true;
  get damageEnabled(){return this.hitReactionsEnabled;}
  isDamaged(actor:Actor){return this.reactions?.has(actor) ?? false;}
  selfRagdoll(actor:Actor,direction:THREE.Vector3,floor:number){this.reactionSystem().ragdoll(actor,direction,floor);}
  selfExplode(actor:Actor,direction:THREE.Vector3,floor:number,load:ShellLoader){this.reactionSystem().explodeActor(actor,direction,floor,load);}
  setHitReactions(enabled:boolean){this.hitReactionsEnabled=enabled;this.reactions?.setEnabled(enabled);}
  reactionSceneState(actor:Actor){return this.reactions?.original(actor);}
  resetHitReactions(){this.reactions?.reset();}
  freezeHitReactions(){this.reactions?.freeze();}
  private reactionSystem(){if(!this.reactions){this.reactions=new HitReactions(this.scene,()=>this.actorList,this.mats);this.reactions.setEnabled(this.hitReactionsEnabled);}return this.reactions;}
  private weaponEffectList(){return [...this.weaponEffects.values()].flatMap(e=>e.effect?[e.effect]:[]).concat([...this.storedWeaponEffects.values()].flat());}
  private readonly weaponEffects = new Map<Actor, { effect: WeaponEffects | null }>();
  readonly renderer: THREE.WebGLRenderer;
  /**
   * The scene is drawn into this linear half-float target and then presented to the canvas with the sRGB conversion.
   * The engine's framebuffer is sRGB-write, so additive and translucent layers (the Jarate glass, the Festive lights, ...)
   * are blended in linear light; blending the already gamma-encoded canvas values instead adds far too much light.
   */
  private readonly sceneTarget: THREE.WebGLRenderTarget;
  private particleDepthTarget: THREE.WebGLRenderTarget | null = null;
  /** The ground shadows in the scene (each is a decal of its own and draws the casters once more); a pool that grows as shadows are added. */
  private groundShadows: GroundShadow[] = [];
  private shadowParams: ShadowParams[] = [{ ...DEFAULT_SHADOW }];
  /** The ground plane (it has a colour, so it is kept out of the passes that draw the casters, the marks and the picks, like the decals of the shadows). */
  private ground!: GroundPlane;
  private groundState: GroundState = { ...DEFAULT_GROUND };
  private shadowQuads(): THREE.Object3D[] { return [...this.groundShadows.map((s) => s.quad), this.ground.mesh, this.reflection.mesh, this.cameras.backdrop.mesh]; }
  private readonly presentScene = new THREE.Scene();
  private readonly presentCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly scene = new THREE.Scene();
  readonly camera = new ViewportCamera(50, 1, 1, 5000);
  readonly controls: OrbitControls;
  /** Called when the user drags the light in the viewport (Shift + drag). */
  onLightChange: (l: LightState) => void = () => {};
  /** The control rig shown on a character that is being posed. */
  readonly rig: RigOverlay;
  /** Called when the character being posed went back to playing an animation (the user picked a sequence). */
  onPoseEnded: () => void = () => {};
  /** Called when the user clicks a character in the view (null: the empty background). */
  /** A click on a character (or on nothing). `additive`: Shift was held, the click adds to the selection. */
  onPick: (actor: Actor | null, hit?: PickHit, additive?: boolean) => void = () => {};
  private boneRotate: { set: GizmoSet; pivot: THREE.Object3D } | null = null;
  private boneRotateSpec: { bone: string; actor: Actor; turn: () => BoneTurn; onTurn: (turn: BoneTurn) => void; onEnd: () => void } | null = null;
  private boneRotateStart: { quaternion: THREE.Quaternion; turn: THREE.Quaternion } | null = null;
  /** After a drag the gizmo stays where it was left until the preview has been rebuilt with the new axes. */
  private boneRotateHold = 0;

  /**
   * A rotation gizmo on a bone of the item being built, turning the bone's own axes (see compiler/boneAxes.ts): the rings turn about the
   * bone's own X, Y and Z, and `onTurn` gets the whole turn (degrees) as it is dragged. `turn` gives the bone's turn when a drag begins.
   * Null takes the gizmo away.
   */
  setBoneGizmo(spec: { bone: string; actor: Actor; turn: () => BoneTurn; onTurn: (turn: BoneTurn) => void; onEnd: () => void } | null) {
    this.boneRotateSpec = spec;
    if (!spec || this.boneRotate) return;
    const pivot = new THREE.Object3D();
    const set = new GizmoSet({ camera: this.camera, dom: this.renderer.domElement, scene: this.scene }, ["rotate"], { pivot, space: { rotate: "local" } });
    set.on("mouseDown", () => {
      const current = this.boneRotateSpec;
      if (!current) return;
      this.boneRotateStart = { quaternion: pivot.quaternion.clone(), turn: new THREE.Quaternion().setFromRotationMatrix(turnMatrix(current.turn())) };
    });
    set.on("dragging-changed", (_role, _control, e) => {
      this.controls.enabled = !e.value;
      if (e.value) return;
      this.boneRotateStart = null;
      this.boneRotateHold = performance.now() + 500;
      this.boneRotateSpec?.onEnd();
    });
    set.on("objectChange", () => {
      const current = this.boneRotateSpec, start = this.boneRotateStart;
      if (!current || !start) return;
      // the ring turned the bone about its own axes: the new turn is the old one followed by what the ring did
      const delta = start.quaternion.clone().invert().multiply(pivot.quaternion);
      const total = start.turn.clone().multiply(delta);
      const e = new THREE.Euler().setFromQuaternion(total, "XYZ");
      const round = (v: number) => Math.round(((v * 180) / Math.PI) * 100) / 100;
      current.onTurn([round(e.x), round(e.y), round(e.z)]);
    });
    this.boneRotate = { set, pivot };
  }

  /** Puts the bone's rotation gizmo on the bone's goal pose, each frame (and leaves it where it is while it is being dragged). */
  private updateBoneGizmo() {
    const g = this.boneRotate;
    if (!g) return;
    const spec = this.boneRotateSpec;
    const goal = spec?.actor.cosmeticBoneGoal(spec.bone);
    const parent = spec?.actor.helpers;
    if (!spec || !goal || !parent) { g.set.show("rotate", false); return; }
    if (g.pivot.parent !== parent) parent.add(g.pivot);
    if (!g.set.dragging && performance.now() > this.boneRotateHold) {
      goal.decompose(g.pivot.position, g.pivot.quaternion, g.pivot.scale);
      g.pivot.scale.set(1, 1, 1);
    }
    g.pivot.updateMatrix();
    g.set.show("rotate", true, g.pivot);
  }

  private boneHelper: { bone: string; setup: JiggleSetup | null; actor: Actor; group: THREE.Group } | null = null;
  /** Draws the axes, length and constraints of a bone of an item being built on a character (null: nothing). */
  setBoneHelper(spec: { bone: string; setup: JiggleSetup | null } | null, actor: Actor | null) {
    if (this.boneHelper) { this.boneHelper.group.removeFromParent(); disposeHelper(this.boneHelper.group); this.boneHelper = null; }
    if (!spec || !actor) return;
    const group = buildJiggleHelper(spec.setup, 6);
    group.matrixAutoUpdate = false;
    this.boneHelper = { ...spec, actor, group };
  }
  /** Puts the bone helper on the bone's goal pose, each frame. */
  private updateBoneHelper() {
    const h = this.boneHelper;
    if (!h) return;
    const goal = h.actor.cosmeticBoneGoal(h.bone);
    const parent = h.actor.helpers;
    if (!goal || !parent) { h.group.visible = false; return; }
    if (h.group.parent !== parent) parent.add(h.group);
    // while its axes are being turned by the gizmo the drawing follows the gizmo, not the preview that is about to be rebuilt
    const turning = this.boneRotate && this.boneRotateSpec?.bone === h.bone && (this.boneRotate.set.dragging || performance.now() < this.boneRotateHold);
    h.group.matrix.copy(turning ? this.boneRotate!.pivot.matrix : goal);
    h.group.matrixWorldNeedsUpdate = true;
    h.group.visible = true;
  }

  private lightIndicatorsOn = true;
  /** Whether the lights show in the view (a bulb for each light with a position, the direction marker of a simple light); they can be clicked then. */
  get lightIndicators() { return this.lightIndicatorsOn; }
  set lightIndicators(on: boolean) {
    this.lightIndicatorsOn = on;
    this.updateLight();
    this.lightGizmos?.sync();
  }
  /** A click on a camera or on a light's marker in the view: the thing the gizmo should edit from now on. */
  onPickTarget: (target: { kind: "camera" | "light"; id: string }, additive?: boolean) => void = () => {};

  /** Uniform objects shared by every material so one update relights the whole scene. */
  private readonly shared: SharedUniforms = {
    uStudioRimCount: { value: 0 },
    uStudioRimColor: { value: Array.from({ length: MAX_RIM_LIGHTS }, () => new THREE.Vector3(1, 1, 1)) },
    uStudioRimStrength: { value: new Array(MAX_RIM_LIGHTS).fill(0) },
    uStudioRimPower: { value: new Array(MAX_RIM_LIGHTS).fill(8.9) },
    uStudioRimDirection: { value: Array.from({ length: MAX_RIM_LIGHTS }, () => new THREE.Vector2(1, 0)) },
    uStudioRimSoftness: { value: new Array(MAX_RIM_LIGHTS).fill(DEFAULT_RIM_LIGHT.softness) },
    uStudioRimAllAround: { value: new Array(MAX_RIM_LIGHTS).fill(0) },
    uStudioRimPainted: { value: new Array(MAX_RIM_LIGHTS).fill(0) },
    uStudioRimLine: { value: Array.from({ length: MAX_RIM_LIGHTS }, () => new THREE.Vector2(DEFAULT_RIM_LIGHT.cutoff, DEFAULT_RIM_LIGHT.edgeSoftness)) },
    uLightDir: { value: new THREE.Vector3(0, 0, 1) },
    uLightColor: { value: new THREE.Vector3(1, 1, 1) },
    uAmbient: { value: Array.from({ length: 6 }, () => new THREE.Vector3(0.3, 0.3, 0.3)) },
    // Luminance of the ambient cube; the eye shader uses it for view-dependent iris light.
    uAverageAmbient: { value: 0.3 },
    uPointPos: { value: new THREE.Vector3() },
    uPointColor: { value: new THREE.Vector3(0, 0, 0) },
    uPointRange: { value: 100 },
    uPointFalloff: { value: 1.5 },
    // 0 shaded, 1 diffuse colour only, 2 grayscale (see the fragment shaders)
    uViewMode: { value: 0 },
  };
  /** Textures and Source materials, shared by every character. */
  readonly mats: SourceMaterials;
  private readonly lightingRenderer: LightingRenderer;
  private readonly geometry = new GeometryCache();
  private readonly context: ActorContext;

  private readonly actorList: Actor[] = [];
  /** The character the UI edits (and whose animation the scrubber shows). */
  private selectedActor: Actor | null = null;
  /** Slot (position in the row) of each character. */
  private readonly slots = new Map<Actor, number>();
  /** Characters the user placed by hand: the row spacing no longer moves them. */
  private readonly placed = new Set<Actor>();
  /** Moves / turns a character in the view while its gizmo is on. */
  private entityGizmos!: GizmoSet;
  private entityMove!: TransformControls;
  private entityRotate!: TransformControls;
  private entityScale!: TransformControls;
  private entityView!: TransformControls;
  private entityViewMove!: TransformControls;
  private entityParts = { move: true, rotate: false, scale: false, view: false };
  private entityPointer = { x: 0, y: 0, inside: false };
  private readonly entityHistory = new WeakMap<Actor, PlacementHistory>();
  private entityEdit: { actor: Actor; before: PlacementSnapshot; peers: { actor: Actor; before: PlacementSnapshot }[]; lights: Record<string, unknown>[]; cameras: Record<string, unknown>[] } | null = null;
  /** What a group edit (a drag of several characters, lights and cameras at once) changed, by the id that its history entries carry. */
  private readonly groupEdits = new Map<number, { actors: Actor[]; lights: { before: Record<string, unknown>[]; after: Record<string, unknown>[] }; cameras: { before: Record<string, unknown>[]; after: Record<string, unknown>[] } }>();
  private groupEditId = 0;
  private entityModal: { mode: "translate" | "rotate" | "scale"; axis: "x" | "y" | "z" | null; pointer: { x: number; y: number }; position: THREE.Vector3; yaw: number; scale: THREE.Vector3; plane: THREE.Plane; hit: THREE.Vector3; screen: THREE.Vector2; angle: number; placed: boolean; grouped: boolean } | null = null;
  private readonly entityPivot = new THREE.Object3D();
  private gizmoActor: Actor | null = null;
  /** Other selected characters that move with the one the gizmo is on (they keep their own turn and scale). */
  private gizmoFollowers: Actor[] = [];
  /** While a gizmo drags several characters: where the gizmo and each of them were when the drag began. */
  private groupDrag: {
    p0: THREE.Vector3;
    q0: THREE.Quaternion;
    s0: THREE.Vector3;
    members: { actor: Actor; offset: THREE.Vector3; q: THREE.Quaternion; scale: THREE.Vector3; placed: boolean }[];
    lights: { id: string; position: THREE.Vector3 | null; direction: THREE.Vector3 }[];
    cameras: { id: string; position: THREE.Vector3; q: THREE.Quaternion }[];
  } | null = null;
  /** The lights and cameras (ids) that are selected with the characters the gizmo is on, and move with them. */
  private groupLights: string[] = [];
  private groupCameras: string[] = [];
  private spacing = DEFAULT_SPACING;
  private nextId = 1;
  /** Called each frame the selected character's pose changed (for the UI scrubber). */
  onFrame: (frame: number, frames: number) => void = () => {};
  /** Called after every frame is drawn (the navigation gizmo follows the camera with it). */
  onPostRender: () => void = () => {};
  private selectionTouched = true;

  private jiggleEnabled = true;
  private raf = 0;
  private light: LightState = { azimuth: 0, elevation: 0, intensity: 1, color: "#ffffff", ambient: 0.3, ambientColor: "#ffffff", followCamera: true };
  private readonly gizmo = new THREE.Group();
  private readonly pointGizmo = new THREE.Group();
  private pointLight: PointLightState = { ...DEFAULT_POINT_LIGHT };
  private pointMarker = false;
  /** Moves the point light in 3D while its marker is shown. */
  private pointMove!: TransformControls;
  private readonly pointPivot = new THREE.Object3D();
  readonly lightGizmos: LightGizmos;
  /** Called when the user drags the point light in the viewport (Ctrl + drag). */
  onPointLightChange: (l: PointLightState) => void = () => {};
  /** Centre and radius of the whole group of characters. */
  private center = new THREE.Vector3();
  private radius = 40;
  private wireOverlay = false;
  /** The fog over the final picture; the same uniform objects serve the live view and screenshots. */
  /** Which pixels belong to a character the fog leaves alone (red), as seen from the camera; only drawn when some character is exempt. */
  private readonly fogMaskTarget = new THREE.WebGLRenderTarget(1, 1, { colorSpace: THREE.NoColorSpace, samples: 4 });
  private fogFreeMaterial: THREE.ShaderMaterial | null = null;
  private fogHeldMaterial: THREE.ShaderMaterial | null = null;
  private readonly fogUniforms = {
    tFogMask: { value: this.fogMaskTarget.texture },
    uFogMaskOn: { value: 0 },
    uFogBase: { value: 0 },
    uFogHeight: { value: 80 },
    uFogCount: { value: 0 },
    uFogColor: { value: Array.from({ length: MAX_FOGS }, () => new THREE.Color()) },
    uFogDensity: { value: Array.from({ length: MAX_FOGS }, () => new THREE.Vector2()) },
    uFogShape: { value: Array.from({ length: MAX_FOGS }, () => new THREE.Vector2()) },
  };
  /** Some fog is on (what the passes that need the depth and the fog mask ask). */
  private fogOn = false;
  /** Ambient occlusion over the finished picture (post effect), measured from the depth of the scene. */
  private ao: AoState = { ...DEFAULT_AO };
  private aoPass: AoPass | null = null;
  private readonly aoUniforms = { tAo: { value: null as THREE.Texture | null }, uAoOn: { value: 0 }, uAoStrength: { value: 0.8 }, uAoPower: { value: 1.5 } };
  /** The look effects (vignette, chromatic aberration, grain, colour grading, bloom) over the finished picture. */
  private look: LookStates = {};
  private readonly lookUniforms = createLookUniforms();
  private readonly lookRes = new THREE.Vector2(1, 1);
  private bloomPass: BloomPass | null = null;
  private dofPass: DofPass | null = null;
  private readonly reflection: FloorReflection;
  private motionAcc: MotionAccumulator | null = null;
  /** The picture of the moments of motion blur of this frame (null: there is no motion blur in the view). */
  private motionTexture: THREE.Texture | null = null;
  /** Height of a character in world units (the fog and the occlusion measure in it). */
  private charHeight = 80;
  // Lines are not moved by polygon offset, so a line lying on a surface flickered against it. This material pulls its lines a hair towards
  // the camera in clip space instead (and skins like the meshes do).
  private readonly wireMaterial = new THREE.ShaderMaterial({
    wireframe: true,
    transparent: true,
    depthWrite: false,
    vertexShader: `attribute float hideW;
varying float vHideW;
#include <skinning_pars_vertex>
void main() {
  vHideW = hideW;
  #include <skinbase_vertex>
  vec3 transformed = vec3(position);
  #include <skinning_vertex>
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(transformed, 1.0);
  gl_Position.z -= 8e-6 * gl_Position.w;
}`,
    uniforms: { uColor: { value: new THREE.Vector3(0.25, 0.27, 0.32) }, uOpacity: { value: 0.5 } },
    fragmentShader: "uniform vec3 uColor; uniform float uOpacity; varying float vHideW; void main() { if (vHideW > 0.5) discard; gl_FragColor = vec4(uColor, uOpacity); }",
  });
  private readonly floorGrid: FloorGrid;
  private readonly facingMarker: THREE.Group;
  /** Re-frame the camera on the first animated pose after the first model loads. */
  private frameAfterClip = false;
  /** Once the camera has been placed it stays put across class switches; only the Full body / Focus buttons move it. */
  private cameraPlaced = false;
  /** Horizontal field of view in degrees (hlmv specifies it horizontally). */
  private fovX = DEFAULT_FOV_X;
  private lastTime = performance.now();
  private readonly fpsCounter = document.createElement("div");
  private readonly cacheCounter = document.createElement("span");
  private readonly fpsLabel = document.createElement("span");
  private readonly tmpBox = new THREE.Box3();

  constructor(private container: HTMLElement, private readonly cachedAssets: () => Iterable<unknown> = () => []) {
    bodyMaskPass(this.wireMaterial);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.lightingRenderer = new LightingRenderer(this.shared);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);
    this.fpsCounter.className = "fpsCounter";
    this.fpsLabel.textContent = "— FPS";
    this.cacheCounter.className = "cacheCounter";
    this.cacheCounter.textContent = "Viewer cache (RAM) ~0 MiB";
    this.cacheCounter.title = "Estimated viewer asset caches: retained model/material/particle data + GPU textures/static geometry. Shared RAM buffers counted once. Excludes native Rust caches, particle helper memory, live animations, render targets and allocator overhead. Updates every 2 seconds.";
    this.fpsCounter.append(this.fpsLabel, this.cacheCounter);
    document.getElementById("viewerStats")?.appendChild(this.fpsCounter);
    this.mats = new SourceMaterials(this.renderer.capabilities.getMaxAnisotropy(), this.shared);
    this.context = { scene: this.scene, mats: this.mats, geometry: this.geometry, jiggle: () => this.jiggleEnabled };
    // its depth texture (read by the fog and the occlusion) is only attached while one of them is on: resolving a multisampled depth every frame is not free
    this.sceneTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.presentMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: this.sceneTarget.texture },
        tDepth: { value: null },
        uInvViewProj: { value: new THREE.Matrix4() },
        uCamPos: { value: new THREE.Vector3() },
        uCamForward: { value: new THREE.Vector3(0, 0, -1) },
        uBackDist: { value: 100 },
        ...this.aoUniforms,
        tMask: { value: this.flashTarget.texture },
        tSel: { value: this.selectTarget.texture },
        uSelOutline: { value: 0 },
        uOutline: { value: 0 },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uOutlineColor: { value: new THREE.Color(FLASH_COLOR) },
        ...this.fogUniforms,
        ...this.lookUniforms,
        uLookRes: { value: this.lookRes },
        tBloom: { value: null },
      },
      vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
      // While a character is flashing, a ring around its silhouette (taken from the mask target) is mixed over the picture.
      fragmentShader: `uniform sampler2D tScene;
uniform sampler2D tMask;
uniform sampler2D tSel;
uniform float uSelOutline;
uniform float uOutline;
uniform vec2 uTexel;
uniform vec3 uOutlineColor;
uniform sampler2D tAo;
uniform float uAoOn;
uniform float uAoStrength;
uniform float uAoPower;
${FOG_GLSL}
${LOOK_GLSL}
varying vec2 vUv;
void main() {
  vec2 su = lookDistort(vUv);
  vec3 c = lookScene(tScene, vUv).rgb;
  if (uAoOn > 0.5) c *= mix(1.0, pow(texture2D(tAo, su).r, uAoPower), uAoStrength);
  vec3 fogOver;
  float fogA = fogLayers(su, fogOver) * (1.0 - fogFree(su));
  c = c * (1.0 - fogA) + fogOver * (1.0 - fogFree(su));
  c = lookColor(c, vUv, 1.0);
  if (uOutline > 0.0) {
    float m = texture2D(tMask, su).a;
    float n = 0.0;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.785398;
      n = max(n, texture2D(tMask, su + vec2(cos(a), sin(a)) * uTexel * 2.5).a);
    }
    float edge = n * (1.0 - m);
    c = mix(c, uOutlineColor, clamp(edge * uOutline, 0.0, 1.0));
    c += uOutlineColor * m * uOutline * 0.1;
  }
  if (uSelOutline > 0.0) {
    float m = texture2D(tSel, su).a;
    float n = 0.0;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.785398;
      n = max(n, texture2D(tSel, su + vec2(cos(a), sin(a)) * uTexel * 2.0).a);
    }
    c = mix(c, uOutlineColor, clamp(n * (1.0 - m) * uSelOutline, 0.0, 1.0));
  }
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
  gl_FragColor.rgb += lookDither(vUv);
}`,
      depthTest: false,
      depthWrite: false,
    });
    const present = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.presentMaterial);
    present.frustumCulled = false;
    this.presentScene.add(present);
    this.scene.background = new THREE.Color(HLMV_BACKGROUND);
    this.buildGizmo();
    this.buildPointGizmo();
    this.buildEntityGizmo();
    this.floorGrid = new FloorGrid(this.scene);
    this.ground = new GroundPlane(this.scene);
    this.reflection = new FloorReflection(this.scene);
    this.floorGrid.visible = false;
    this.facingMarker = this.buildFacingMarker();

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    // grabbing the view yourself ends a running snap to an axis
    this.controls.addEventListener("start", () => this.viewAnim++);
    this.rig = new RigOverlay(this.camera, this.renderer.domElement, this.controls, this.scene);
    this.cameras = new CameraRig(this.scene, this.camera, this.controls, container, this.renderer.domElement);
    this.cameraOverlay = new CameraOverlay(this.cameras, container);
    this.cameras.onEnter = () => { this.viewAnim++; this.setActorGizmo(null); this.rig.setActor(null); };
    this.lightGizmos = new LightGizmos(this.scene, this.camera, this.controls, this.renderer.domElement,
      () => this.light.rig?.lights.find(l => l.id === this.light.rig?.selected) ?? null,
      () => !!this.light.rig?.marker && !this.cameras.editing && !this.rig.active && !this.gizmoActor && !this.selectedActor?.isLive,
      () => { this.updateLight(); this.updatePointLight(); this.onLightChange(this.getLight()); },
      () => this.light.rig?.lights ?? [],
      () => this.lightIndicatorsOn && !this.rig.active && !this.selectedActor?.isLive);
    // a directional light reaches the whole scene, so its gizmo is in the middle of it (not at whichever character is selected)
    this.lightGizmos.anchor = () => this.center;
    this.lightGizmos.reach = () => this.radius * 1.4;
    this.installLightDrag();
    this.installPicking();

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    let fpsStart = performance.now(), fpsFrames = 0, cacheUpdated = 0;
    const frame = (now: number, dt: number) => {
      this.cameras.update();
      this.lightGizmos.poll();
      this.updateBoneGizmo();
      this.updateBoneHelper();
      this.cameraOverlay.update();
      let moved = false;
      for (const a of this.actorList) {
        const stepped = a.step(dt);
        if (stepped && a === this.selectedActor) this.reportFrame();
        if (stepped || a.changed) {
          a.changed = false;
          moved = true;
        }
      }
      if (!moved && this.reactions?.animating) moved = true;
      for (const entry of this.unusualEffects.values()) entry.effect?.step(dt, this.camera);
      this.conditionParticles.step(dt, this.camera);
      for (const screens of this.dispenserScreens.values()) screens.step(dt);
      if (this.conditionTimers.size) this.stepConditions(dt);
      for (const effect of this.weaponEffectList()) effect.step(dt,this.camera);
      this.reactions?.step(dt,this.camera);
      if (this.selectionTouched) {
        this.selectionTouched = false;
        this.reportFrame();
      }
      if (this.rig.actor && !this.rig.actor.isPosing) {
        this.rig.forget(this.rig.actor);
        this.rig.setActor(null);
        this.onPoseEnded();
      }
      if (this.rig.active) this.rig.update();
      this.mats.updateDynamic(now / 1000);
      if (!this.cameras.active) this.controls.update();
      this.updateLight();
      this.updatePointLight();
      const floor = this.actorList.reduce((y, a) => Math.min(y, a.floorY), Infinity);
      const floorY = Number.isFinite(floor) ? floor : 0;
      if (this.floorGrid.visible) this.floorGrid.update(this.center.x, this.center.z, floorY, this.radius);
      this.facingMarker.position.y = floorY + 0.14;
      this.ground.update(this.groundState, this.center.x, this.center.z, floorY, Math.max(1, this.actorList.reduce((h, a) => Math.max(h, a.bindHeight), 0)));
      this.updateShadows(floorY, moved);
      this.updateReflection(floorY);
      this.renderLightShadows(moved);
      this.ensureSceneDepth(this.fogOn || this.ao.enabled || this.look.dof?.enabled === true);
      this.updateParticleDepth(this.camera, this.sceneTarget.width, this.sceneTarget.height);
      this.sortEditorAfterFloor();
      this.renderer.setRenderTarget(this.sceneTarget);
      this.motionTexture = this.renderLiveScene();
      this.renderer.setRenderTarget(this.sceneTarget);
      if (this.wireOverlay) this.renderWireOverlay();
      this.renderer.setRenderTarget(null);
      this.updateFlash(now);
      this.updateSelectionOutline();
      this.updateFogMask();
      this.updateFogWorld(floorY);
      this.updateAo();
      this.onPostRender();
      this.updateLook();
      this.renderer.render(this.presentScene, this.presentCamera);
    };
    this.stepFrame = frame;
    const tick = () => {
      this.raf = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = Math.min((now - this.lastTime) / 1000, 0.1);
      this.lastTime = now;
      // (a video is being rendered: it steps the scene itself, by the time between its frames)
      if (this.offline) { fpsStart = now; fpsFrames = 0; return; }
      frame(now, dt);
      const frameEnd = performance.now();
      if (document.hidden) {
        fpsStart = frameEnd;
        fpsFrames = 0;
        this.fpsLabel.textContent = "— FPS";
      } else {
        fpsFrames++;
        if (frameEnd - fpsStart >= 500) {
          this.fpsLabel.textContent = `${Math.round(fpsFrames * 1000 / (frameEnd - fpsStart))} FPS`;
          if (frameEnd - cacheUpdated >= 2000) {
            const textures = [...this.mats.textures.values(), ...particleCacheTextures(), ...bodyMaskTextures()];
            const bytes = cachedDataBytes([...this.cachedAssets(), ...particleCacheData(), ...textures.flatMap(textureImages)])
              + cachedGpuBytes(textures, this.geometry.cachedGeometries());
            this.cacheCounter.textContent = `Viewer cache (RAM) ~${(bytes / 1048576).toFixed(1)} MiB`;
            cacheUpdated = frameEnd;
          }
          fpsStart = frameEnd;
          fpsFrames = 0;
        }
      }
    };
    tick();
  }

  // --- characters ---------------------------------------------------------------------------------------------

  /** True while a video is rendered: the live loop stands still and {@link stepFrame} moves the scene by the time between two frames. */
  offline = false;
  /** Moves the whole scene on by `dt` seconds (`now` is the clock in ms that the animated materials read) and draws the view. */
  stepFrame: (now: number, dt: number) => void = () => {};

  /** The size of a picture of the view at full size: the active camera's picture, or the view itself. */
  captureBaseSize(): { w: number; h: number } {
    const shot = this.cameras.captureCamera();
    if (shot) return { w: shot.size.w, h: shot.size.h };
    const buf = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    return { w: buf.x, h: buf.y };
  }

  /** The point a turntable turns around: the target of the free view, or the middle of the selected character when a camera of the scene is in use. */
  turntableCenter(): THREE.Vector3 {
    if (!this.cameras.activeCamera) return this.controls.target.clone();
    const a = this.selectedActor;
    if (a?.hasModel) return a.computeBounds(new THREE.Box3()).getCenter(new THREE.Vector3());
    const box = new THREE.Box3();
    for (const actor of this.actorList) if (actor.hasModel) box.union(actor.computeBounds(this.tmpBox));
    return box.isEmpty() ? this.center.clone() : box.getCenter(new THREE.Vector3());
  }

  private readonly depthUsers: { group: THREE.Object3D; needsSceneDepth: boolean; needsSceneColor: boolean; setSceneDepth(texture: THREE.Texture | null, camera: THREE.Camera, width: number, height: number, color?: THREE.Texture | null): void }[] = [];
  /** Separate opaque depth avoids sampling a texture attached to the current framebuffer. */
  private updateParticleDepth(camera: THREE.Camera, width: number, height: number) {
    const effects = this.depthUsers;
    effects.length = 0;
    for (const entry of this.unusualEffects.values()) if (entry.effect) effects.push(entry.effect);
    for (const lane of this.conditionParticles.all) effects.push(lane);
    for (const entry of this.weaponEffects.values()) if (entry.effect) effects.push(entry.effect);
    for (const list of this.storedWeaponEffects.values()) for (const effect of list) effects.push(effect);
    let wantDepth = false, wantColor = false;
    for (const effect of effects) {
      if (!effect.group.visible) continue;
      wantDepth ||= effect.needsSceneDepth;
      // a Refract material (heat haze, a warp, the water of Deep Dive) draws the picture behind it again: then the pass keeps its colours too
      wantColor ||= effect.needsSceneColor;
    }
    if (!wantDepth) return;
    const r = this.renderer, previousTarget = r.getRenderTarget();
    this.particleDepthTarget ??= new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(1, 1) });
    const target = this.particleDepthTarget;
    if (target.width !== width || target.height !== height) target.setSize(width, height);
    const hidden = [...effects.map(effect => effect.group), ...this.cameras.objects, ...this.lightGizmos.objects];
    const visible = hidden.map(object => object.visible);
    const writes = new Map<THREE.Material, boolean>();
    if (!wantColor) this.scene.traverse((object) => {
      const material = (object as THREE.Mesh).material;
      if (!material) return;
      for (const mat of Array.isArray(material) ? material : [material]) {
        if (!writes.has(mat)) { writes.set(mat, mat.colorWrite); mat.colorWrite = false; }
      }
    });
    try {
      hidden.forEach(object => { object.visible = false; });
      r.setRenderTarget(target);
      r.render(this.scene, camera);
    } finally {
      for (const [mat, write] of writes) mat.colorWrite = write;
      hidden.forEach((object, i) => { object.visible = visible[i]; });
      r.setRenderTarget(previousTarget);
    }
    for (const effect of effects) effect.setSceneDepth(target.depthTexture, camera, width, height, wantColor ? target.texture : null);
  }

  /** Half the size of the group of characters: about how far a character can walk and stay in the picture. */
  get frameRadius(): number {
    return this.radius;
  }

  /** The chevron on the floor in front of the character in play mode, pointing the way it faces (about unit size, +z forward). */
  private buildFacingMarker(): THREE.Group {
    const group = new THREE.Group();
    // a plain chevron "^" lying on the floor, its tip forward (+z)
    const shape = new THREE.BufferGeometry();
    const pts: [number, number][] = [[0, 0.5], [0.6, -0.1], [0.45, -0.28], [0, 0.12], [-0.45, -0.28], [-0.6, -0.1]]; // x, z
    const tri = [[0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 5]];
    const p: number[] = [];
    for (const t of tri) for (const k of t) p.push(pts[k][0], 0, pts[k][1]);
    shape.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    const mesh = new THREE.Mesh(shape, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
    mesh.renderOrder = -0.4;
    mesh.frustumCulled = false;
    group.add(mesh);
    group.visible = false;
    this.scene.add(group);
    return group;
  }

  /** Shows the facing arrow at a place on the floor, turned to `yaw` and `size` units long, or hides it with null. */
  setFacingMarker(marker: { x: number; z: number; yaw: number; size: number } | null) {
    this.facingMarker.visible = marker !== null;
    if (marker) {
      this.facingMarker.position.x = marker.x;
      this.facingMarker.position.z = marker.z;
      this.facingMarker.rotation.y = marker.yaw;
      this.facingMarker.scale.setScalar(marker.size);
    }
  }

  /** Whether the floor grid is shown (it is not part of screenshots). */
  get gridVisible(): boolean {
    return this.floorGrid.visible;
  }

  set gridVisible(v: boolean) {
    this.floorGrid.visible = v;
  }

  get actors(): readonly Actor[] {
    return this.actorList;
  }

  get selected(): Actor | null {
    return this.selectedActor;
  }

  /** Adds a character next to the existing ones (in the first free slot of the row) and makes it the selected one. */
  addActor(): Actor {
    const actor = new Actor(this.nextId++, this.context);
    const slot = freeSlot(this.slots.values());
    this.slots.set(actor, slot);
    this.actorList.push(actor);
    actor.setPlacement(this.slotX(slot), 0, 0, 0);
    this.select(actor);
    return actor;
  }

  /** Removes a character from the scene. */
  removeActor(actor: Actor) {
    const i = this.actorList.indexOf(actor);
    if (i < 0) return;
    this.reactions?.remove(actor);
    this.actorList.splice(i, 1);
    this.clearUnusuals(actor);
    this.conditionParticles.forget(actor);
    this.conditionTokens.delete(actor);
    this.conditionTimers.delete(actor);
    this.buildingActors.delete(actor);
    this.buildingTokens.delete(actor);
    this.clearBuildingScreens(actor);
    this.clearWeaponEffects(actor);
    this.slots.delete(actor);
    this.placed.delete(actor);
    if (this.gizmoActor === actor) this.setActorGizmo(null);
    actor.dispose();
    if (this.selectedActor === actor) this.select(this.actorList[Math.min(i, this.actorList.length - 1)] ?? null);
    this.frame(false);
  }

  select(actor: Actor | null) {
    this.selectedActor = actor;
    this.selectionTouched = true;
  }

  /** Switches a character's conditions (Jarate, Ubercharge, ...) by hand: the look and the particles that go with them. */
  setConditions(actor: Actor, conditions: Conditions) {
    const timers = this.conditionTimers.get(actor);
    if (timers) for (const key of [...timers.keys()]) if (!conditions[key]) timers.delete(key);
    actor.setConditions(conditions);
    this.syncConditionParticles(actor);
  }

  /** Puts a character in a condition for a while (a Jarate burst, a flame); the time restarts if it already is. */
  addTimedCondition(actor: Actor, key: ConditionKey, seconds = CONDITION_SECONDS[key] ?? 10) {
    let timers = this.conditionTimers.get(actor);
    if (actor.conditions[key] && !timers?.has(key)) return; // switched on by hand: it stays
    if (!timers) this.conditionTimers.set(actor, (timers = new Map()));
    timers.set(key, seconds);
    if (!actor.conditions[key]) { actor.setConditions({ ...actor.conditions, [key]: true }); this.syncConditionParticles(actor); this.onConditionsChanged(actor); }
  }

  /** A jar burst (JarExplode): every living character within the radius is drenched for 10 s, unless it is invulnerable. */
  private soak(owner: Actor, position: THREE.Vector3, radius: number, key: ConditionKey) {
    const reactions = this.reactionSystem();
    for (const target of this.actorList) {
      if (target === owner || reactions.has(target) || target.conditions.uber) continue;
      if (reactions.blastHull(target).distanceToPoint(position) <= radius) this.addTimedCondition(target, key);
    }
  }

  private stepConditions(dt: number) {
    for (const [actor, timers] of [...this.conditionTimers]) {
      let ended = false;
      for (const [key, left] of [...timers]) {
        if (left - dt > 0) { timers.set(key, left - dt); continue; }
        timers.delete(key);
        actor.setConditions({ ...actor.conditions, [key]: false });
        ended = true;
      }
      if (!timers.size) this.conditionTimers.delete(actor);
      if (ended) { this.syncConditionParticles(actor); this.onConditionsChanged(actor); }
    }
  }

  /**
   * Starts, moves or stops the particle systems for the character's current conditions (also after its model, weapon or team changed).
   * The systems run on lanes lent by a shared pool (see ConditionLane), so a burst that soaks a crowd starts no process.
   */
  syncConditionParticles(actor: Actor) {
    if (this.buildingActors.has(actor)) return;
    const token = (this.conditionTokens.get(actor) ?? 0) + 1;
    this.conditionTokens.set(actor, token);
    this.conditionWants(actor).then((wants) => {
      if (this.conditionTokens.get(actor) === token && this.actorList.includes(actor) && !this.buildingActors.has(actor)) this.conditionParticles.sync(actor, wants);
    }).catch((error) => console.error("Condition effects unavailable", error));
  }

  private clearBuildingScreens(actor: Actor) {
    this.dispenserScreens.get(actor)?.dispose();
    this.dispenserScreens.delete(actor);
  }

  /** The nearest other character (a building heals nobody), where a dispenser's beam ends: in the building's own Source space, 50 units up. */
  private beamTarget(actor: Actor): number[] {
    let nearest: Actor | null = null, best = Infinity;
    for (const other of this.actorList) {
      if (other === actor || this.buildingActors.has(other) || !other.hasModel) continue;
      const d = other.offset.distanceToSquared(actor.offset);
      if (d < best) { best = d; nearest = other; }
    }
    if (!nearest) return [];
    const world = new THREE.Vector3().setFromMatrixPosition(nearest.particleRootFrame());
    world.add(new THREE.Vector3(0, 0, 50).applyMatrix4(SOURCE_TO_VIEWER)); // 50 units up in the Source space
    return world.applyMatrix4(actor.particleRootFrame().invert()).toArray();
  }

  /**
   * What a building shows of its state: damage smoke, muzzle flashes, the teleporter's glow, a dispenser's healing beam (particle systems on
   * the pool the conditions use, anchored on the building's attachments) and the dispenser's screens. `cls` null: the character is no
   * building (any more) and gets its condition particles back.
   */
  setBuildingFx(actor: Actor, cls: string | null, fx: BuildingFx, team = actor.particleTeam) {
    const info = cls ? buildingOf(cls) : null;
    const token = (this.buildingTokens.get(actor) ?? 0) + 1;
    this.buildingTokens.set(actor, token);
    if (!info) {
      if (this.buildingActors.delete(actor)) this.syncConditionParticles(actor);
      this.clearBuildingScreens(actor);
      return;
    }
    this.buildingActors.add(actor);
    const path = actor.particleModel?.path;
    if (!path) return;
    void loadParticleModel(path).then(async (model) => {
      if (this.buildingTokens.get(actor) !== token || !this.actorList.includes(actor)) return;
      this.conditionParticles.sync(actor, laneWants(actor, model, buildingWants(info, fx, team), () => this.beamTarget(actor)));
      const wantsScreens = info.kind === "dispenser" && info.stage === "finished" && model.attachments.some((a) => a.name.toLowerCase() === "controlpanel0_ll");
      let screens = this.dispenserScreens.get(actor);
      if (!wantsScreens) { this.clearBuildingScreens(actor); return; }
      if (!screens) {
        screens = new DispenserScreens(actor, model);
        this.dispenserScreens.set(actor, screens);
        screens.setMetal(fx.metal);
        screens.snap();
        await screens.load(team);
      } else {
        screens.setMetal(fx.metal);
        if (screens.team !== team) await screens.load(team);
      }
    }).catch((error) => console.error("Building effects unavailable", error));
  }

  private async conditionWants(actor: Actor): Promise<LaneWant[]> {
    const specs = conditionParticles(actor.conditions, actor.particleTeam);
    const wants: LaneWant[] = [];
    if (!specs.length) return wants;
    const path = actor.particleModel?.path;
    const model = path ? await loadParticleModel(path) : null;
    const held = specs.some((s) => s.weapon) ? actor.heldWeapon : null;
    const weaponModel = held ? await loadParticleModel(held.path) : null;
    for (const spec of specs) {
      if (!spec.weapon) {
        if (model) wants.push({ system: spec.system, key: path!, target: () => ({ actor, cp: () => new THREE.Matrix4(), boxes: () => nativeHitboxes(actor, model) }) });
      } else if (held && weaponModel) {
        const boxes = cosmeticHitboxes(actor, held.itemId, held.path, weaponModel);
        wants.push({ system: spec.system, key: held.path, target: () => ({ actor, cp: () => actor.particleCosmeticRootFrame(held.itemId, held.path) ?? new THREE.Matrix4(), boxes }) });
      }
    }
    return wants;
  }

  private clearUnusuals(actor: Actor) {
    this.unusualEffects.get(actor)?.effect?.dispose();
    this.unusualEffects.delete(actor);
  }

  async setUnusuals(actor: Actor, settings: UnusualSettings, restart = false): Promise<void> {
    if (!settings.silver && !settings.arctic && !settings.hatEffect && !settings.tauntEffect) { this.clearUnusuals(actor); return; }
    const key = JSON.stringify([actor.particleModel?.path, actor.particleTeam, actor.particleCosmetic(settings.hatItem)?.path, settings]);
    const previous = this.unusualEffects.get(actor);
    if (previous?.key === key && !restart) return previous.pending;
    this.clearUnusuals(actor);
    const entry = { key, effect: null as ActorEffects | null, pending: Promise.resolve() };
    this.unusualEffects.set(actor, entry);
    entry.pending = ActorEffects.create(actor, { ...settings }, (error) => {
      if (this.unusualEffects.get(actor) === entry) this.onUnusualError(actor, error);
    }, () => this.floorLevel()).then((effect) => {
      if (this.unusualEffects.get(actor) !== entry) effect.dispose();
      else entry.effect = effect;
    }).catch((err) => {
      if (this.unusualEffects.get(actor) === entry) this.unusualEffects.delete(actor);
      throw err;
    });
    return entry.pending;
  }

  /** The floor of the scene (the lowest of the characters'), which is also z in Source space. */
  private floorLevel(): number {
    const floor = this.actorList.reduce((y, a) => Math.min(y, a.floorY), Infinity);
    return Number.isFinite(floor) ? floor : 0;
  }

  unusualUsesNativeSilver(actor: Actor) { return this.unusualEffects.get(actor)?.effect?.nativeSilver ?? false; }

  clearWeaponEffects(actor: Actor) {
    this.weaponEffects.get(actor)?.effect?.dispose(); this.weaponEffects.delete(actor);
    for(const effect of this.storedWeaponEffects.get(actor) ?? []) effect.dispose();this.storedWeaponEffects.delete(actor);this.healingTargets.delete(actor);
  }
  freezeWeaponEffects(actor:Actor) {
    for(const effect of [this.weaponEffects.get(actor)?.effect,...(this.storedWeaponEffects.get(actor) ?? [])]) effect?.freeze();
    if(!this.snapshotWeaponEffects(actor)) this.clearWeaponEffects(actor);
  }
  hasFrozenWeaponEffects(actor:Actor) {return this.weaponEffects.get(actor)?.effect?.isFrozen === true || this.storedWeaponEffects.get(actor)?.some(e=>e.isFrozen) === true;}
  snapshotWeaponEffects(actor:Actor) {
    const snapshots=[this.weaponEffects.get(actor)?.effect,...(this.storedWeaponEffects.get(actor) ?? [])].flatMap(e=>{const s=e?.snapshot();return s?[s]:[];});
    if(!snapshots.length) return;
    return {nodes:snapshots.flatMap(s=>s.nodes),shellModel:snapshots.find(s=>s.shells.length)?.shellModel ?? "",shells:snapshots.flatMap(s=>s.shells.map(shell=>({...shell,model:shell.model ?? s.shellModel}))),projectiles:snapshots.flatMap(s=>s.projectiles ?? [])};
  }
  retireWeaponEffects(actor:Actor) {
    const effect=this.weaponEffects.get(actor)?.effect;effect?.setFiring(false);
    if(effect) this.storedWeaponEffects.set(actor,[...(this.storedWeaponEffects.get(actor) ?? []),effect]);this.weaponEffects.delete(actor);this.healingTargets.delete(actor);
  }
  async restoreWeaponEffects(actor:Actor,snapshot:Parameters<typeof WeaponEffects.restore>[1],loadShell:ShellLoader) {
    if(!this.actorList.includes(actor)) return;
    this.clearWeaponEffects(actor);
    const entry={effect:null as WeaponEffects|null};this.weaponEffects.set(actor,entry);
    try {
      const effect=await WeaponEffects.restore(actor,snapshot,loadShell,this.mats);
      if(this.weaponEffects.get(actor)!==entry) effect.dispose();else entry.effect=effect;
    } catch(error) {if(this.weaponEffects.get(actor)===entry) this.clearWeaponEffects(actor);throw error;}
  }
  async prepareWeaponEffects(actor: Actor, profile: WeaponProfile, loadShell: ShellLoader, floor: number) {
    this.retireWeaponEffects(actor);
    const stored=this.storedWeaponEffects.get(actor),index=stored?.findIndex(e=>e.profile?.itemId===profile.itemId) ?? -1;
    if(stored && index>=0) {this.weaponEffects.set(actor,{effect:stored.splice(index,1)[0]});return;}
    const entry = {effect:null as WeaponEffects|null}; this.weaponEffects.set(actor,entry);
    await this.reactionSystem().prepare(loadShell);
    this.warmConditionParticles(profile);
    if(this.weaponEffects.get(actor)!==entry || !actor.particleCosmetic(profile.itemId))return;
    const effect = await WeaponEffects.create(actor,profile,loadShell,this.mats,floor,this.projectileBounds(floor),{
      hit:(start,end)=>{
        const hit=this.reactionSystem().trace(actor,start,end);
        // the cleaver hurts what it hits (jars do no damage, only wet)
        if(hit && profile.projectile?.kind==="cleaver" && this.hitReactionsEnabled)this.reactionSystem().ragdoll(hit.actor,end.clone().sub(start).normalize(),floor,hit.point);
        return hit?.point ?? null;
      },
      arrow:(start,end,direction,model)=>this.reactionSystem().arrowStrike(actor,start,end,direction,model,floor,()=>this.projectileBounds(floor)),
      explosion:(position,radius)=>this.reactionSystem().explosion(actor,position,radius,floor,loadShell),
      splash:(position,radius)=>this.soak(actor,position,radius,profile.weaponClass==="tf_weapon_jar_milk" ? "milk" : "urine"),
    });
    if (this.weaponEffects.get(actor)!==entry) effect.dispose(); else entry.effect=effect;
  }
  /** Starts the particle helpers of the conditions a weapon causes before it first does, so a burst or a flame never waits for them. */
  private warmConditionParticles(profile:WeaponProfile) {
    if(profile.projectile?.kind==="jar") this.conditionParticles.warm(profile.weaponClass==="tf_weapon_jar_milk" ? "peejar_drips_milk" : "peejar_drips",2);
    else if(profile.weaponClass==="tf_weapon_flamethrower") for(const system of ["burningplayer_red","burningplayer_blue"]) this.conditionParticles.warm(system,1);
  }
  fireWeapon(actor: Actor,direction?:THREE.Vector3,charge=0) {
    const effect=this.weaponEffects.get(actor)?.effect;effect?.shot(direction,charge);
    if(effect?.profile?.weaponClass==="tf_weapon_flamethrower" && direction)this.igniteAlong(actor,effect.muzzlePosition,direction);
    if(effect?.profile?.hitscan && direction && this.hitReactionsEnabled){
      const start=effect.muzzlePosition;if(!start)return;
      const hit=this.reactionSystem().trace(actor,start,start.clone().addScaledVector(direction,effect.profile.range ?? 8192));
      if(hit)this.reactionSystem().ragdoll(hit.actor,direction,0,hit.point);
    }
  }
  /**
   * What a flamethrower sets alight: the flame manager traces a box of tf_flamethrower_boxsize (12) along the stream out to
   * tf_flamethrower_maxdamagedist (350). Burning lasts the initial afterburn (3 s) after the last touch; a Pyro shows it for a
   * moment only, because Pyros do not burn persistently (CTFPlayerShared::Burn).
   */
  private readonly flameVictims:Actor[]=[];
  private igniteAlong(owner:Actor,start:THREE.Vector3|null,direction:THREE.Vector3){
    // burning is damage: with Damage off nothing burns (like the bullets and the blades)
    if(!start || !this.hitReactionsEnabled)return;
    // the flame does not stop at the first character: everyone along the stream is set alight (the flame manager hits every player its box touches)
    for(const actor of this.reactionSystem().traceAll(owner,start,start.clone().addScaledVector(direction,350),12,this.flameVictims)){
      if(actor.conditions.uber)continue;
      this.addTimedCondition(actor,"burning",/pyro/i.test(actor.particleModel?.path ?? "") ? 0.25 : 3);
    }
  }
  meleeWeapon(actor:Actor,direction:THREE.Vector3,profile:WeaponProfile){
    if(!profile.melee || !this.hitReactionsEnabled)return;
    const root=SOURCE_TO_VIEWER.clone().invert().multiply(actor.particleRootFrame());
    const eye=actor.eyeFrame() ?? new THREE.Matrix4().makeTranslation(0,0,68);
    const start=new THREE.Vector3().setFromMatrixPosition(root.clone().multiply(eye));
    const scale=Math.max(1,new THREE.Vector3().setFromMatrixScale(root).length()/Math.sqrt(3));
    const end=start.clone().addScaledVector(direction,profile.melee.range*scale),reactions=this.reactionSystem();
    const hit=reactions.trace(actor,start,end) ?? reactions.trace(actor,start,end,profile.melee.hull*scale);
    if(hit)reactions.ragdoll(hit.actor,direction,0,hit.point);
  }
  private readonly healingTargets=new Map<Actor,Actor>();
  healWeapon(actor:Actor,direction:THREE.Vector3,attack:boolean) {
    const effect=this.weaponEffects.get(actor)?.effect,profile=effect?.profile?.healing;
    if(!effect || !profile || !attack) {effect?.setHealingTarget(null);this.healingTargets.delete(actor);return false;}
    const source=effect.muzzlePosition;if(!source) return false;
    const origin=source.clone().applyMatrix4(SOURCE_TO_VIEWER),aim=direction.clone().transformDirection(SOURCE_TO_VIEWER);
    const boxes=new Map<Actor,THREE.Box3>();
    const box=(other:Actor)=>{let value=boxes.get(other);if(!value){value=other.computeBounds(new THREE.Box3());boxes.set(other,value);}return value;};
    const visible=(other:Actor) => {
      const center=box(other).getCenter(new THREE.Vector3());
      const ray=new THREE.Ray(origin,center.clone().sub(origin).normalize()),distance=center.distanceTo(origin);
      return !this.actorList.some(blocker=>blocker!==actor && blocker!==other && (()=>{
        const hit=ray.intersectBox(box(blocker),new THREE.Vector3());
        return !!hit && hit.distanceTo(origin)<distance;
      })());
    };
    let target=this.healingTargets.get(actor);
    if(target && this.reactions?.has(target))target=undefined;
    if(target && (!this.actorList.includes(target) || target.particleTeam!==actor.particleTeam || box(target).distanceToPoint(origin)>profile.range*1.2 || !visible(target))) target=undefined;
    if(!target) {
      const ray=new THREE.Ray(origin,aim);let nearest=profile.range;
      for(const other of this.actorList) {
        if(other===actor || this.reactions?.has(other)) continue;
        const point=ray.intersectBox(box(other),new THREE.Vector3());
        if(point && point.distanceTo(origin)<nearest) {target=other.particleTeam===actor.particleTeam ? other : undefined;nearest=point.distanceTo(origin);}
      }
    }
    if(target) {this.healingTargets.set(actor,target);const position=new THREE.Vector3().setFromMatrixPosition(target.particleRootFrame()).applyMatrix4(SOURCE_TO_VIEWER.clone().invert());position.z+=50;effect.setHealingTarget(position);return true;}
    effect.setHealingTarget(null);this.healingTargets.delete(actor);return false;
  }
  detonateWeapon(actor:Actor,direction:THREE.Vector3) {for(const effect of [this.weaponEffects.get(actor)?.effect,...(this.storedWeaponEffects.get(actor) ?? [])]) effect?.detonate(direction);}
  private projectileBounds(floor:number) {
    const bounds=new THREE.Box3();for(const a of this.actorList) bounds.union(a.computeBounds(new THREE.Box3()));
    bounds.applyMatrix4(SOURCE_TO_VIEWER.clone().invert()).expandByScalar(2048);bounds.min.z=floor;return bounds;
  }
  setWeaponFiring(actor: Actor, firing: boolean) {this.weaponEffects.get(actor)?.effect?.setFiring(firing);}

  /** Distance between neighbouring characters; repositions all of them. */
  setSpacing(units: number) {
    this.spacing = units;
    for (const [actor, slot] of this.slots) if (!this.placed.has(actor)) actor.setPlacement(this.slotX(slot), 0, 0, actor.yaw);
    this.frame(false);
  }

  /** The character gizmo is a move gizmo with a rotation ring (about the vertical axis) around the same pivot. */
  private buildEntityGizmo() {
    this.scene.add(this.entityPivot);
    const set = new GizmoSet({ camera: this.camera, dom: this.renderer.domElement, scene: this.scene }, ["move", "rotate", "scale", "view", "viewMove"], { pivot: this.entityPivot, worldScale: true });
    this.entityGizmos = set;
    this.entityMove = set.controls.move!;
    this.entityRotate = set.controls.rotate!;
    this.entityScale = set.controls.scale!;
    this.entityView = set.controls.view!;
    this.entityViewMove = set.controls.viewMove!;
    set.on("dragging-changed", (_role, _control, e) => {
      this.controls.enabled = !e.value;
      if (e.value && this.gizmoActor) {
        this.beginEntityEdit(this.gizmoActor);
        this.beginGroupDrag();
      } else if (!e.value) { this.groupDrag = null; this.finishEntityEdit(true); this.frame(false); }
    });
    set.on("objectChange", () => {
      const a = this.gizmoActor;
      if (!a) return;
      // whatever the gizmos did to the pivot (move, any of the three rings, the ring about the line of sight, scale) is the character's placement
      if (this.groupDrag) { this.applyGroupDrag(this.groupDrag); return; }
      const turn = new THREE.Euler().setFromQuaternion(this.entityPivot.quaternion, "YXZ");
      a.setScale(this.entityPivot.scale);
      a.setPlacement(this.entityPivot.position.x, this.entityPivot.position.y, this.entityPivot.position.z, turn.y);
      a.setTilt(turn.x, turn.z);
      this.placed.add(a);
    });
    set.exclusiveDrag(() => this.applyEntityParts());
    this.installEntityHotkeys();
  }

  /** The other selected characters, lights and cameras that the gizmo moves, turns and scales with the character it is on; the gizmo sits at their average. */
  /** True while the pointer is over a gizmo handle (of a character, a light, a camera or the pose rig): a press there belongs to the gizmo. */
  get gizmoHot(): boolean {
    return [this.pointMove, this.entityMove, this.entityRotate, this.entityScale, this.entityView, this.entityViewMove].some((t) => t.enabled && t.axis !== null) || this.lightGizmos.hot || this.rig.gizmoHot || this.cameras.hot;
  }

  /** True while a mouse transform (Shift + W / E / R) of a character, a light or a camera is in progress: the next click confirms it. */
  get modalActive(): boolean {
    return this.entityModal !== null || this.cameras.inModal || this.lightGizmos.inModal;
  }

  setGizmoGroup(actors: Actor[], lights: string[], cameras: string[]) {
    const same = actors.length === this.gizmoFollowers.length && actors.every((a, i) => a === this.gizmoFollowers[i]) && lights.join() === this.groupLights.join() && cameras.join() === this.groupCameras.join();
    const hadGroup = this.gizmoFollowers.length > 0 || this.groupLights.length > 0 || this.groupCameras.length > 0;
    this.gizmoFollowers = actors;
    this.groupLights = lights;
    this.groupCameras = cameras;
    const lead = this.gizmoActor;
    if (!lead || this.entityDragging() || this.entityModal) return;
    const places = [...[lead, ...actors].map((a) => a.offset.clone()), ...this.groupLightPlaces().map((l) => l.position).filter((p): p is THREE.Vector3 => !!p), ...this.groupCameraList().map((c) => new THREE.Vector3(...c.position))];
    if (actors.length || lights.length || cameras.length) {
      // the gizmo of a group: at the average of the group, upright and unscaled
      const centre = new THREE.Vector3();
      for (const p of places) centre.add(p);
      this.entityPivot.position.copy(centre.divideScalar(places.length));
      this.entityPivot.rotation.set(0, 0, 0);
      this.entityPivot.scale.set(1, 1, 1);
      this.entityPivot.updateMatrixWorld(true);
    } else if (hadGroup && !same) {
      this.entityPivot.position.copy(lead.offset);
      this.entityPivot.rotation.set(lead.pitch, lead.yaw, lead.roll, "YXZ");
      this.entityPivot.scale.copy(lead.scale);
      this.entityPivot.updateMatrixWorld(true);
    }
  }

  private entityDragging(): boolean {
    return [this.entityMove, this.entityRotate, this.entityScale, this.entityView, this.entityViewMove].some((t) => t?.dragging);
  }

  /** Remembers the gizmo and the characters it carries at the start of a drag (only when it carries several). */
  private beginGroupDrag() {
    const lead = this.gizmoActor;
    if (!lead || !(this.gizmoFollowers.length || this.groupLights.length || this.groupCameras.length)) { this.groupDrag = null; return; }
    this.groupDrag = {
      p0: this.entityPivot.position.clone(),
      q0: this.entityPivot.quaternion.clone(),
      s0: this.entityPivot.scale.clone(),
      members: [lead, ...this.gizmoFollowers].map((actor) => ({
        actor,
        offset: actor.offset.clone(),
        q: new THREE.Quaternion().setFromEuler(new THREE.Euler(actor.pitch, actor.yaw, actor.roll, "YXZ")),
        scale: actor.scale.clone(),
        placed: this.placed.has(actor),
      })),
      lights: this.groupLightPlaces(),
      cameras: this.groupCameraList().map((c) => ({ id: c.id, position: new THREE.Vector3(...c.position), q: new THREE.Quaternion().fromArray(c.quaternion) })),
    };
  }

  /** The selected lights the gizmo carries: where they are (none for a light without a place) and which way they point. */
  private groupLightPlaces(): { id: string; position: THREE.Vector3 | null; direction: THREE.Vector3 }[] {
    const rig = this.light.rig;
    if (!rig) return [];
    return rig.lights.filter((l) => this.groupLights.includes(l.id) && l.type !== "directional").map((l) => ({ id: l.id, position: new THREE.Vector3(...l.position), direction: lightDirection(l.azimuth, l.elevation) }));
  }

  private groupCameraList() {
    return this.cameras.cameras.filter((c) => this.groupCameras.includes(c.id));
  }

  /** What the gizmo did since the drag began (it moved, turned, scaled) is done to every character of the group about the gizmo. */
  private applyGroupDrag(g: NonNullable<Viewer["groupDrag"]>) {
    // read the gizmo once: the updates below call back into the panels, which can move it
    const pivot = this.entityPivot.position.clone();
    const dq = this.entityPivot.quaternion.clone().multiply(g.q0.clone().invert());
    const ds = new THREE.Vector3(this.entityPivot.scale.x / (g.s0.x || 1), this.entityPivot.scale.y / (g.s0.y || 1), this.entityPivot.scale.z / (g.s0.z || 1));
    for (const m of g.members) {
      const at = m.offset.clone().sub(g.p0).multiply(ds).applyQuaternion(dq).add(pivot);
      const turn = new THREE.Euler().setFromQuaternion(dq.clone().multiply(m.q), "YXZ");
      m.actor.setScale(m.scale.clone().multiply(ds));
      m.actor.setPlacement(at.x, at.y, at.z, turn.y);
      m.actor.setTilt(turn.x, turn.z);
      this.placed.add(m.actor);
    }
    const rig = this.light.rig;
    if (g.lights.length && rig) {
      for (const start of g.lights) {
        const l = rig.lights.find((x) => x.id === start.id);
        if (!l) continue;
        if (start.position) {
          const at = start.position.clone().sub(g.p0).multiply(ds).applyQuaternion(dq).add(pivot);
          l.position = [at.x, at.y, at.z];
        }
        const d = start.direction.clone().applyQuaternion(dq).normalize();
        l.azimuth = (Math.atan2(d.x, d.z) * 180 / Math.PI + 360) % 360;
        l.elevation = Math.asin(Math.max(-1, Math.min(1, d.y))) * 180 / Math.PI;
        delete l.rotation;
      }
      this.updateLight();
      this.updatePointLight();
      this.onLightChange(this.getLight());
    }
    if (g.cameras.length) {
      for (const start of g.cameras) {
        const c = this.cameras.cameras.find((x) => x.id === start.id);
        if (!c) continue;
        const at = start.position.clone().sub(g.p0).multiply(ds).applyQuaternion(dq).add(pivot);
        c.position = [at.x, at.y, at.z];
        c.quaternion = dq.clone().multiply(start.q).normalize().toArray();
      }
      this.cameras.refresh();
    }
  }

  /** Shows the move + rotate gizmo on a character, or hides it with null. */
  setActorGizmo(actor: Actor | null) {
    if (actor) this.cameras?.stopEditing();
    if (actor === this.gizmoActor) return;
    this.finishEntityModal(false);
    this.gizmoActor = actor;
    this.applyEntityParts();
    if (actor) {
      this.entityPivot.position.copy(actor.offset);
      this.entityPivot.rotation.set(actor.pitch, actor.yaw, actor.roll, "YXZ");
      this.entityPivot.scale.copy(actor.scale);
      this.entityPivot.updateMatrixWorld(true);
    }
  }

  setEntityGizmoParts(parts: { move: boolean; rotate: boolean; scale: boolean; view: boolean }) {
    this.entityParts = { ...parts }; this.applyEntityParts();
  }

  private entitySnapshot(actor: Actor): PlacementSnapshot {
    return { position: actor.offset.toArray() as [number,number,number], yaw: actor.yaw, pitch: actor.pitch, roll: actor.roll, scale: actor.scale.toArray() as [number,number,number], placed: this.placed.has(actor) };
  }

  /** Copies of the selected lights and cameras that the gizmo carries (what an edit of the group changes besides the characters). */
  private groupLightCopies(): Record<string, unknown>[] {
    return (this.light.rig?.lights ?? []).filter((l) => this.groupLights.includes(l.id)).map((l) => structuredClone({ ...l }) as unknown as Record<string, unknown>);
  }
  private groupCameraCopies(): Record<string, unknown>[] {
    return this.groupCameraList().map((c) => structuredClone({ ...c }) as unknown as Record<string, unknown>);
  }

  private beginEntityEdit(actor: Actor) {
    if (this.entityEdit) return;
    this.entityEdit = {
      actor, before: this.entitySnapshot(actor),
      peers: this.gizmoFollowers.filter((a) => a !== actor).map((a) => ({ actor: a, before: this.entitySnapshot(a) })),
      lights: this.groupLightCopies(), cameras: this.groupCameraCopies(),
    };
  }

  private historyOf(actor: Actor): PlacementHistory {
    let history = this.entityHistory.get(actor);
    if (!history) { history = new PlacementHistory(); this.entityHistory.set(actor, history); }
    return history;
  }

  private finishEntityEdit(confirm: boolean) {
    const edit = this.entityEdit;
    this.entityEdit = null;
    if (!edit || !confirm) return;
    // an edit of several things at once is one step of the history: every character of it carries the same group id
    const grouped = edit.peers.length > 0 || edit.lights.length > 0 || edit.cameras.length > 0;
    if (!grouped) { this.historyOf(edit.actor).commit(edit.before, this.entitySnapshot(edit.actor)); return; }
    const id = ++this.groupEditId;
    this.groupEdits.set(id, {
      actors: [edit.actor, ...edit.peers.map((p) => p.actor)],
      lights: { before: edit.lights, after: this.groupLightCopies() },
      cameras: { before: edit.cameras, after: this.groupCameraCopies() },
    });
    this.historyOf(edit.actor).commit(edit.before, this.entitySnapshot(edit.actor), id);
    for (const p of edit.peers) this.historyOf(p.actor).commit(p.before, this.entitySnapshot(p.actor), id);
  }

  /** Puts a character back to a snapshot of its placement. */
  private applyPlacement(actor: Actor, state: PlacementSnapshot) {
    actor.setScale(new THREE.Vector3(...state.scale));
    actor.setPlacement(...state.position, state.yaw);
    actor.setTilt(state.pitch ?? 0, state.roll ?? 0);
    if (state.placed) this.placed.add(actor); else this.placed.delete(actor);
  }

  /** Puts lights and cameras back to the copies taken before or after a group edit. */
  private restoreGroupThings(copies: { lights: Record<string, unknown>[]; cameras: Record<string, unknown>[] }) {
    const rig = this.light.rig;
    if (rig && copies.lights.length) {
      for (const copy of copies.lights) {
        const l = rig.lights.find((x) => x.id === copy.id) as unknown as Record<string, unknown> | undefined;
        if (!l) continue;
        for (const key of Object.keys(l)) delete l[key];
        Object.assign(l, structuredClone(copy));
      }
      this.updateLight();
      this.updatePointLight();
      this.onLightChange(this.getLight());
    }
    if (copies.cameras.length) {
      for (const copy of copies.cameras) {
        const c = this.cameras.cameras.find((x) => x.id === copy.id) as unknown as Record<string, unknown> | undefined;
        if (!c) continue;
        Object.assign(c, structuredClone(copy));
      }
      this.cameras.refresh();
    }
  }

  private stepEntityHistory(redo: boolean): boolean {
    const actor = this.gizmoActor ?? this.selectedActor;
    if (!actor || this.entityEdit) return false;
    const history = this.entityHistory.get(actor);
    const group = redo ? history?.redoGroup() : history?.undoGroup();
    const state = redo ? history?.redo(this.entitySnapshot(actor)) : history?.undo(this.entitySnapshot(actor));
    if (!state) return false;
    this.applyPlacement(actor, state);
    // the step of a group edit takes the others of that group (characters, lights, cameras) back or forward with it
    const edit = group !== undefined ? this.groupEdits.get(group) : undefined;
    if (edit) {
      for (const other of edit.actors) {
        if (other === actor) continue;
        const peer = this.entityHistory.get(other);
        if ((redo ? peer?.redoGroup() : peer?.undoGroup()) !== group) continue;
        const snap = redo ? peer!.redo(this.entitySnapshot(other)) : peer!.undo(this.entitySnapshot(other));
        if (snap) this.applyPlacement(other, snap);
      }
      this.restoreGroupThings(redo ? { lights: edit.lights.after, cameras: edit.cameras.after } : { lights: edit.lights.before, cameras: edit.cameras.before });
    }
    const lead = this.gizmoActor ?? actor;
    this.entityPivot.position.copy(lead.offset);
    this.entityPivot.rotation.set(lead.pitch, lead.yaw, lead.roll, "YXZ");
    this.entityPivot.scale.copy(lead.scale);
    this.entityPivot.updateMatrixWorld(true);
    this.frame(false);
    return true;
  }

  private applyEntityParts() {
    for (const [part, role] of [["move","move"],["rotate","rotate"],["scale","scale"],["view","view"],["view","viewMove"]] as const) this.entityGizmos.show(role, !!this.gizmoActor && this.entityParts[part]);
  }

  private installEntityHotkeys() {
    const dom = this.renderer.domElement;
    dom.addEventListener("pointerenter", () => {this.entityPointer.inside=true;});
    dom.addEventListener("pointerleave", () => {this.entityPointer.inside=false;});
    dom.addEventListener("pointermove", event => {
      this.entityPointer.x=event.clientX;this.entityPointer.y=event.clientY;
      if(this.entityModal) this.updateEntityModal();
    });
    dom.addEventListener("pointerdown", event => {
      if(!this.entityModal) return;
      event.preventDefault();event.stopImmediatePropagation();this.finishEntityModal(event.button!==2);
    },true);
    window.addEventListener("keydown", event => {
      const target=event.target as HTMLElement|null;
      if(this.cameras?.editing||target?.isContentEditable||(target&&/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      const key=event.key.toLowerCase();
      const undo=hotkeyMatches("edit.undo",event),redo=!undo&&redoMatches(event);
      if(undo||redo) {
        const actor=this.gizmoActor??this.selectedActor;
        if(!actor||actor.isPosing||actor.isLive||this.rig.active||this.entityModal||[this.entityMove,this.entityRotate,this.entityScale,this.entityView,this.entityViewMove].some(t=>t.dragging)) return;
        this.stepEntityHistory(redo);
        event.preventDefault();event.stopImmediatePropagation();
        return;
      }
      if(event.ctrlKey||event.metaKey) return;
      if(event.altKey) {
        if(gizmoKey(event)&&!event.repeat&&!this.entityModal&&this.gizmoActor&&!this.rig.active&&this.entityPointer.inside&&![this.entityMove,this.entityRotate,this.entityScale,this.entityView,this.entityViewMove].some(t=>t.dragging)) {
          const actor=this.gizmoActor;
          this.beginEntityEdit(actor);
          const tool=gizmoKey(event);
          for(const a of [actor,...this.gizmoFollowers]) {
            if(tool==="scale") a.setScale(new THREE.Vector3(1,1,1));
            else if(tool==="rotate") {a.setPlacement(a.offset.x,a.offset.y,a.offset.z,0);a.setTilt(0,0);}
            else {
              a.setPlacement(this.slotX(this.slots.get(a)??0),0,0,a.yaw);
              this.placed.delete(a);
            }
          }
          this.entityPivot.position.copy(actor.offset);
          this.entityPivot.rotation.set(actor.pitch, actor.yaw, actor.roll, "YXZ");
          this.entityPivot.scale.copy(actor.scale);
          this.setGizmoGroup(this.gizmoFollowers,this.groupLights,this.groupCameras);
          this.finishEntityEdit(true);this.frame(false);event.preventDefault();
        }
        return;
      }
      if(this.entityModal) {
        if(key==="escape"||key==="enter") this.finishEntityModal(key==="enter");
        else if(key==="x"||key==="y"||key==="z") {if(this.entityModal.mode==="rotate"&&key!=="y") return;this.entityModal.axis=this.entityModal.axis===key?null:key;this.updateEntityModal();}
        else return;
        event.preventDefault();event.stopImmediatePropagation();return;
      }
      if(!this.gizmoActor||this.rig.active||!this.entityPointer.inside||event.repeat||[this.entityMove,this.entityRotate,this.entityScale,this.entityView,this.entityViewMove].some(t=>t.dragging)) return;
      const tool=event.shiftKey?gizmoKey(event):null;
      if(!tool) return;
      const actor=this.gizmoActor;
      const grouped=this.gizmoFollowers.length>0||this.groupLights.length>0||this.groupCameras.length>0;
      if(grouped) this.beginGroupDrag();
      const position=grouped&&this.groupDrag?this.groupDrag.p0.clone():actor.offset.clone();
      const plane=new THREE.Plane().setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(new THREE.Vector3()),position);
      const screen=position.clone().project(this.camera),rect=dom.getBoundingClientRect();
      const point=new THREE.Vector2(rect.left+(screen.x+1)*rect.width/2,rect.top+(1-screen.y)*rect.height/2);
      this.entityModal={mode:tool==="move"?"translate":tool,axis:null,pointer:{x:this.entityPointer.x,y:this.entityPointer.y},position,yaw:actor.yaw,scale:actor.scale.clone(),plane,hit:this.entityRayHit(plane)??position.clone(),screen:point,angle:Math.atan2(this.entityPointer.y-point.y,this.entityPointer.x-point.x),placed:this.placed.has(actor),grouped};
      this.beginEntityEdit(actor);
      this.controls.enabled=false;event.preventDefault();
    });
  }

  private entityRayHit(plane: THREE.Plane) {
    const rect=this.renderer.domElement.getBoundingClientRect(),ray=new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((this.entityPointer.x-rect.left)/rect.width*2-1,1-(this.entityPointer.y-rect.top)/rect.height*2),this.camera);
    return ray.ray.intersectPlane(plane,new THREE.Vector3());
  }

  private updateEntityModal() {
    const m=this.entityModal,a=this.gizmoActor;if(!m||!a) return;
    const g=m.grouped?this.groupDrag:null;
    if(g) {
      // the gizmo is moved, turned or scaled, and everything it carries follows (the same as dragging it)
      if(m.mode==="translate") {
        const delta=(this.entityRayHit(m.plane)??m.hit).clone().sub(m.hit);
        if(m.axis) for(const key of ["x","y","z"] as const) if(key!==m.axis) delta[key]=0;
        this.entityPivot.position.copy(g.p0).add(delta);
      } else if(m.mode==="rotate") {
        const angle=Math.atan2(this.entityPointer.y-m.screen.y,this.entityPointer.x-m.screen.x)-m.angle;
        this.entityPivot.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),angle).multiply(g.q0);
      } else {
        const factor=keyboardScaleFactor(this.entityPointer.x-m.pointer.x,this.entityPointer.y-m.pointer.y);
        const scale=g.s0.clone();for(const key of ["x","y","z"] as const) if(!m.axis||m.axis===key) scale[key]*=factor;
        this.entityPivot.scale.copy(scale);
      }
      this.entityPivot.updateMatrixWorld(true);
      this.applyGroupDrag(g);
      this.frame(false);
      return;
    }
    if(m.mode==="translate") {
      const delta=(this.entityRayHit(m.plane)??m.hit).clone().sub(m.hit);
      if(m.axis) for(const key of ["x","y","z"] as const) if(key!==m.axis) delta[key]=0;
      const p=m.position.clone().add(delta);a.setPlacement(p.x,p.y,p.z,m.yaw);
    } else if(m.mode==="rotate") {
      const angle=Math.atan2(this.entityPointer.y-m.screen.y,this.entityPointer.x-m.screen.x)-m.angle;
      a.setPlacement(m.position.x,m.position.y,m.position.z,m.yaw+angle);
    } else {
      const factor=keyboardScaleFactor(this.entityPointer.x-m.pointer.x,this.entityPointer.y-m.pointer.y);
      const scale=m.scale.clone();for(const key of ["x","y","z"] as const) if(!m.axis||m.axis===key) scale[key]*=factor;
      a.setScale(scale);
    }
    this.placed.add(a);this.entityPivot.position.copy(a.offset);this.entityPivot.rotation.set(a.pitch, a.yaw, a.roll, "YXZ");this.entityPivot.scale.copy(a.scale);this.frame(false);
  }

  private finishEntityModal(confirm: boolean) {
    const m=this.entityModal,a=this.gizmoActor;if(!m) return;
    this.entityModal=null;this.controls.enabled=true;
    const g=m.grouped?this.groupDrag:null;
    if(g) {
      if(!confirm) {
        // back to how everything was when the edit began
        this.entityPivot.position.copy(g.p0);this.entityPivot.quaternion.copy(g.q0);this.entityPivot.scale.copy(g.s0);this.entityPivot.updateMatrixWorld(true);
        this.applyGroupDrag(g);
        for(const member of g.members) if(!member.placed) this.placed.delete(member.actor);
      }
      this.groupDrag=null;
      if(a) {this.entityPivot.position.copy(a.offset);this.entityPivot.rotation.set(a.pitch, a.yaw, a.roll, "YXZ");this.entityPivot.scale.copy(a.scale);}
      this.setGizmoGroup(this.gizmoFollowers,this.groupLights,this.groupCameras);
      this.finishEntityEdit(confirm);
      this.frame(false);
      return;
    }
    if(a&&!confirm) {a.setScale(m.scale);a.setPlacement(m.position.x,m.position.y,m.position.z,m.yaw);if(!m.placed) this.placed.delete(a);}
    if(a) {this.entityPivot.position.copy(a.offset);this.entityPivot.rotation.set(a.pitch, a.yaw, a.roll, "YXZ");this.entityPivot.scale.copy(a.scale);}
    this.finishEntityEdit(confirm);
    this.frame(false);
  }

  private slotX(slot: number): number {
    return slotOffset(slot, this.spacing);
  }

  private reportFrame() {
    const pb = this.selectedActor?.playback;
    if (pb?.clip) this.onFrame(pb.frame(), pb.clip.frames);
  }

  /** Loads the class model into a character. The camera is placed on the first one. */
  setModel(actor: Actor, data: ModelData, materials: Map<string, MaterialData | null>) {
    this.clearUnusuals(actor);
    this.conditionParticles.forget(actor);
    this.clearBuildingScreens(actor);
    actor.setModel(data, materials);
    this.frameAfterClip = !this.cameraPlaced; // only the very first model is framed on its animated pose
    this.frame(!this.cameraPlaced);
  }

  /** Plays a baked clip on a character, or shows the bind pose when `clip` is null. */
  setClip(actor: Actor, clip: ClipData | null, keepTime = false) {
    actor.setClip(clip, keepTime);
    if (clip && this.frameAfterClip) {
      this.frameAfterClip = false;
      this.frame(true);
    }
    if (actor === this.selectedActor) this.selectionTouched = true;
  }

  /** Turns jiggle bone physics on or off (off: jiggle bones sit on their animated goal). */
  setJiggle(on: boolean) {
    this.jiggleEnabled = on;
    for (const a of this.actorList) a.updateCosmetics();
  }

  /** The wireframe is drawn over whatever the view shows (not instead of it): a second pass draws every mesh's edges, depth tested. */
  setWireframe(on: boolean) {
    this.wireOverlay = on;
  }

  /** Colour ("#rrggbb", as shown on screen) and opacity of the wireframe overlay. */
  setWireStyle(color: string, opacity: number) {
    this.wireMaterial.uniforms.uColor.value.copy(displayColor(color));
    this.wireMaterial.uniforms.uOpacity.value = opacity;
  }

  /** Colour ("#rrggbb", as shown on screen) and opacity of the floor grid. */
  setGridStyle(color: string, opacity: number) {
    this.floorGrid.setStyle(displayColor(color), opacity);
  }

  /** How the surfaces are shown: the lit material, just the diffuse colour (the base texture), or the lit result without colour. */
  setShading(mode: "shaded" | "diffuse" | "gray") {
    this.shared.uViewMode.value = mode === "diffuse" ? 1 : mode === "gray" ? 2 : 0;
  }

  /** Draws the edges of every mesh over the picture just rendered into the scene target. */
  private renderWireOverlay() {
    const hidden = [...this.shadowQuads(), this.floorGrid.mesh, this.facingMarker, ...this.editorObjects];
    const was = hidden.map((o) => o.visible);
    hidden.forEach((o) => (o.visible = false));
    const background = this.scene.background;
    this.scene.background = null;
    this.scene.overrideMaterial = this.wireMaterial;
    const r = this.renderer;
    r.autoClear = false;
    r.render(this.scene, this.camera);
    r.autoClear = true;
    this.scene.overrideMaterial = null;
    this.scene.background = background;
    hidden.forEach((o, i) => (o.visible = was[i]));
  }

  private buildPointGizmo() {
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    bulb.name = "pbulb";
    const reach = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.035, depthWrite: false }),
    );
    reach.name = "preach";
    this.pointGizmo.add(bulb, reach);
    this.pointGizmo.visible = false;
    this.scene.add(this.pointGizmo, this.pointPivot);
    this.pointMove = createGizmo({ camera: this.camera, dom: this.renderer.domElement, scene: this.scene }, "move", { pivot: this.pointPivot });
    this.pointMove.addEventListener("dragging-changed", (e) => {
      this.controls.enabled = !e.value;
    });
    // The pivot's position back to the light's spherical placement around the model centre.
    this.pointMove.addEventListener("objectChange", () => {
      const advanced = this.light.rig?.lights.find(l => l.id === this.light.rig?.selected);
      if (advanced) {
        advanced.position = this.pointPivot.position.toArray() as [number, number, number];
        this.onLightChange(this.getLight());
        return;
      }
      const off = this.pointPivot.position.clone().sub(this.center);
      const d = Math.max(off.length(), 1e-4);
      const distance = Math.min(4, Math.max(0.2, d / this.radius));
      this.setPointLight({
        ...this.pointLight,
        azimuth: (((Math.atan2(off.x, off.z) * 180) / Math.PI) % 360 + 360) % 360,
        elevation: Math.max(-89, Math.min(89, (Math.asin(Math.max(-1, Math.min(1, off.y / d))) * 180) / Math.PI)),
        distance,
      });
      this.onPointLightChange(this.getPointLight());
    });
  }

  /** Everything drawn over the scene that is not part of it (gizmos, markers, camera and light symbols): left out of captures and of the shadow and lighting passes. */
  private get editorObjects(): THREE.Object3D[] {
    return [this.gizmo, this.pointGizmo, this.pointMove.getHelper(), ...this.lightGizmos.objects, ...this.entityGizmos.objects, ...this.rig.objects, ...this.cameras.objects, ...(this.boneHelper ? [this.boneHelper.group] : []), ...(this.boneRotate ? this.boneRotate.set.objects : [])];
  }

  private buildGizmo() {
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffd36b }),
    );
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.5 }),
    );
    bulb.name = "bulb";
    line.name = "ray";
    this.gizmo.add(bulb, line);
    this.scene.add(this.gizmo);
  }

  getPointLight(): PointLightState {
    return { ...this.pointLight };
  }

  setPointLight(l: PointLightState) {
    this.pointLight = { ...l };
    this.updatePointLight();
  }

  /** Shows the point light's marker and range sphere (always shown while dragging). */
  setPointLightMarkerVisible(v: boolean) {
    this.pointMarker = v;
    this.updatePointLight();
  }

  private updatePointLight() {
    const p = this.pointLight;
    const az = (p.azimuth * Math.PI) / 180;
    const el = (p.elevation * Math.PI) / 180;
    const pos = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(p.distance * this.radius).add(this.center);
    const [r, g, b] = [1, 3, 5].map((i) => Math.pow(parseInt(p.color.slice(i, i + 2), 16) / 255, 2.2) * p.intensity);
    this.shared.uPointPos.value.copy(pos);
    this.shared.uPointColor.value.set(p.enabled ? r : 0, p.enabled ? g : 0, p.enabled ? b : 0);
    this.shared.uPointRange.value = Math.max(p.range * this.radius, 1e-3);
    this.shared.uPointFalloff.value = p.falloff;
    this.pointGizmo.visible = p.enabled && this.pointMarker;
    const pointControls = p.enabled && this.pointMarker && !this.cameras?.editing;
    this.pointMove.getHelper().visible = pointControls;
    this.pointMove.enabled = pointControls;
    this.pointPivot.position.copy(pos);
    const bulb = this.pointGizmo.getObjectByName("pbulb") as THREE.Mesh;
    const reach = this.pointGizmo.getObjectByName("preach") as THREE.Mesh;
    (bulb.material as THREE.MeshBasicMaterial).color.set(p.color);
    (reach.material as THREE.MeshBasicMaterial).color.set(p.color);
    bulb.position.copy(pos);
    bulb.scale.setScalar(this.radius * 0.04);
    reach.position.copy(pos);
    reach.scale.setScalar(this.shared.uPointRange.value);
    if (this.light.rig) {
      this.shared.uPointColor.value.set(0,0,0);
      const rig = this.light.rig;
      const light = rig.lights.find(l => l.id === rig.selected);
      this.pointGizmo.visible = false;
      this.pointMove.getHelper().visible = false;
      this.pointMove.enabled = false;
      if (light) {
        this.pointPivot.position.fromArray(light.position);bulb.position.copy(this.pointPivot.position);reach.position.copy(this.pointPivot.position);
        reach.scale.setScalar(light.range);
        (bulb.material as THREE.MeshBasicMaterial).color.set(light.color);(reach.material as THREE.MeshBasicMaterial).color.set(light.color);
      }
    }
    this.lightGizmos?.sync();
  }

  /**
   * Clicking a character selects it. The scene is drawn once with every character in a flat colour of its own (its id) into a
   * small target and the pixel under the cursor tells which one it is.
   */
  private installPicking() {
    const el = this.renderer.domElement;
    let down: { x: number; y: number; t: number; shift: boolean } | null = null;
    el.addEventListener("pointerdown", (e) => {
      const onGizmo = this.gizmoHot;
      down = e.button === 0 && !e.ctrlKey && !e.altKey && !onGizmo ? { x: e.clientX, y: e.clientY, t: performance.now(), shift: e.shiftKey } : null;
    });
    el.addEventListener("pointerup", (e) => {
      const d = down;
      down = null;
      if (!d || e.button !== 0) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4 || performance.now() - d.t > 600) return; // a drag orbits the camera
      if (this.rig.active) {
        // while posing, a click on a control ring selects it; elsewhere it clears the selection. Characters and cosmetics cannot be clicked
        // then (no glow, no selection change, no paint chart): the clicks belong to the rig.
        const id = this.rig.pick(e.clientX, e.clientY);
        this.rig.select(id ?? null);
        return;
      }
      const marker = this.pickMarker(e.clientX, e.clientY);
      if (marker) { this.onPickTarget(marker, d.shift); return; }
      const hit = this.pickAt(e.clientX, e.clientY);
      this.onPick(hit?.actor ?? null, hit ? { item: hit.item, x: e.clientX, y: e.clientY } : undefined, d.shift);
    });
    el.addEventListener("pointermove", (e) => {
      if (!this.rig.active || e.buttons !== 0) return;
      const id = this.rig.pick(e.clientX, e.clientY);
      if (this.rig.hover(id)) el.style.cursor = id ? "pointer" : "";
    });
  }

  /** What lies inside a box of the view (client coordinates): characters whose outline touches it, lights and cameras whose place is in it. */
  boxHits(box: BoxRect): BoxHits<Actor> {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const toScreen = (world: THREE.Vector3) => {
      const p = world.clone().project(this.camera);
      return p.z > 1 ? null : { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2 };
    };
    const inside = (p: { x: number; y: number } | null) => !!p && p.x >= box.x0 && p.x <= box.x1 && p.y >= box.y0 && p.y <= box.y1;
    const actors: Actor[] = [];
    const bounds = new THREE.Box3();
    for (const actor of this.actorList) {
      if (!actor.hasModel || actor.hiddenInList) continue;
      actor.computeBounds(bounds);
      if (bounds.isEmpty()) continue;
      const corners = [0, 1].flatMap((x) => [0, 1].flatMap((y) => [0, 1].map((z) => new THREE.Vector3(x ? bounds.max.x : bounds.min.x, y ? bounds.max.y : bounds.min.y, z ? bounds.max.z : bounds.min.z))));
      const shown = corners.map(toScreen).filter((p): p is { x: number; y: number } => !!p);
      if (!shown.length) continue;
      const outline = { x0: Math.min(...shown.map((p) => p.x)), y0: Math.min(...shown.map((p) => p.y)), x1: Math.max(...shown.map((p) => p.x)), y1: Math.max(...shown.map((p) => p.y)) };
      if (rectsOverlap(box, outline)) actors.push(actor);
    }
    const rig = this.light.rig;
    const lights = rig ? rig.lights.filter((l) => l.enabled && l.type !== "directional" && inside(toScreen(new THREE.Vector3(...l.position)))).map((l) => l.id) : [];
    const cameras = this.cameras.active ? [] : this.cameras.cameras.filter((c) => inside(toScreen(new THREE.Vector3(...c.position)))).map((c) => c.id);
    return { actors, lights, cameras };
  }

  /** What is under a click, for the box select tool: a camera or light marker first, else the character. */
  pointHits(clientX: number, clientY: number): BoxHits<Actor> {
    const marker = this.pickMarker(clientX, clientY);
    if (marker) return { actors: [], lights: marker.kind === "light" ? [marker.id] : [], cameras: marker.kind === "camera" ? [marker.id] : [] };
    const hit = this.pickAt(clientX, clientY);
    return { actors: hit ? [hit.actor] : [], lights: [], cameras: [] };
  }

  /** The camera or light marker under a client position, or null. */
  private pickMarker(clientX: number, clientY: number): { kind: "camera" | "light"; id: string } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const screen = (world: THREE.Vector3) => {
      const p = world.clone().project(this.camera);
      return p.z > 1 ? null : { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2 };
    };
    let best: { kind: "camera" | "light"; id: string } | null = null, bestDistance = Infinity;
    if (!this.cameras.active) {
      // a camera is hit anywhere on the frustum drawn for it (its edges), or near its position, with a generous margin
      const reach = 22;
      for (const data of this.cameras.cameras) {
        const frustum = cameraProjection(data, 2, 28);
        const corner = (x: number, y: number, z: number) => screen(new THREE.Vector3(x, y, z).unproject(frustum));
        const near = [corner(-1, -1, -1), corner(1, -1, -1), corner(1, 1, -1), corner(-1, 1, -1)];
        const far = [corner(-1, -1, 1), corner(1, -1, 1), corner(1, 1, 1), corner(-1, 1, 1)];
        const segments: [typeof near[number], typeof near[number]][] = [];
        for (let i = 0; i < 4; i++) segments.push([near[i], near[(i + 1) % 4]], [far[i], far[(i + 1) % 4]], [near[i], far[i]]);
        const origin = screen(new THREE.Vector3().fromArray(data.position));
        let distance = origin ? Math.hypot(origin.x - clientX, origin.y - clientY) : Infinity;
        for (const [p, q] of segments) if (p && q) distance = Math.min(distance, distanceToSegment(clientX, clientY, p, q));
        if (distance < reach && distance < bestDistance) { bestDistance = distance; best = { kind: "camera", id: data.id }; }
      }
    }
    if (!best) {
      const id = this.lightGizmos.pick(clientX, clientY);
      if (id) best = { kind: "light", id };
    }
    return best;
  }

  /** Makes a light the one the gizmo edits (its marker on); false when it is not one that has a position. */
  selectLight(id: string): boolean {
    const rig = this.light.rig;
    if (!rig || !rig.lights.some((l) => l.id === id)) return false;
    rig.selected = id; rig.marker = true;
    this.updateLight(); this.onLightChange(this.getLight());
    return true;
  }

  /** Takes the light gizmo away (the marker off), for when another kind of thing takes the gizmo. */
  hideLightMarker() {
    const rig = this.light.rig;
    if (!rig?.marker) return;
    rig.marker = false;
    this.updateLight(); this.onLightChange(this.getLight());
  }

  /** The orientation of every gizmo: "local" turns them with what they edit, "world" keeps the scene's axes. The pose rig has its own rules on top (a finger always uses its own frame). */
  setGizmoSpace(local: boolean) {
    const space = local ? "local" : "world";
    this.entityGizmos.setSpace(space); this.cameras.setSpace(space); this.lightGizmos.setSpace(space);
    this.rig.setLocal(local);
  }

  private pickMaterials = new Map<number, THREE.ShaderMaterial>();
  private readonly presentMaterial: THREE.ShaderMaterial;
  /** Silhouette of the flashing character (alpha); only drawn while a flash runs. */
  private readonly flashTarget = new THREE.WebGLRenderTarget(1, 1);
  /** Silhouette of the selected characters (alpha); drawn every frame while the selection outline is on. */
  private readonly selectTarget = new THREE.WebGLRenderTarget(1, 1);
  private outlineOn = true;
  private outlined: Actor[] = [];
  private outlinedLights: string[] = [];
  private outlinedCameras: string[] = [];
  private flashActors: Actor[] = [];
  /** The cosmetic item the flash is limited to (null: the whole character). */
  private flashItem: number | null = null;
  private flashStart = 0;
  private flashMaterial: THREE.ShaderMaterial | null = null;
  private pickTarget: THREE.WebGLRenderTarget | null = null;

  /** The character under a client position (and the cosmetic item of the mesh hit, if it is one), or null. */
  private pickAt(clientX: number, clientY: number): { actor: Actor; item: number | null } | null {
    if (this.actorList.length === 0) return null;
    const el = this.renderer.domElement;
    const rect = el.getBoundingClientRect();
    const buf = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const px = Math.floor(((clientX - rect.left) / rect.width) * buf.x);
    const py = buf.y - 1 - Math.floor(((clientY - rect.top) / rect.height) * buf.y);
    if (px < 0 || py < 0 || px >= buf.x || py >= buf.y) return null;
    if (!this.pickTarget) this.pickTarget = new THREE.WebGLRenderTarget(1, 1, { colorSpace: THREE.NoColorSpace });
    this.pickTarget.setSize(buf.x, buf.y);

    const swapped: [THREE.Mesh, THREE.Material | THREE.Material[]][] = [];
    for (const a of this.actorList) {
      for (const m of a.meshes()) {
        const slot = (m.userData.cosmeticSlot as number | undefined) ?? 0;
        const key = a.id * 256 + slot;
        let mat = this.pickMaterials.get(key);
        if (!mat) {
          mat = makePickMaterial(a.id, slot);
          this.pickMaterials.set(key, mat);
        }
        swapped.push([m, m.material]);
        m.material = mat;
      }
    }
    const hidden: THREE.Object3D[] = [...this.shadowQuads(), ...this.editorObjects];
    const wasVisible = hidden.map((o) => o.visible);
    hidden.forEach((o) => (o.visible = false));
    const background = this.scene.background;
    this.scene.background = null;
    const prevClear = this.renderer.getClearColor(new THREE.Color());
    const prevAlpha = this.renderer.getClearAlpha();
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setRenderTarget(this.pickTarget);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    const pixel = new Uint8Array(4);
    this.renderer.readRenderTargetPixels(this.pickTarget, px, py, 1, 1, pixel);
    this.renderer.setRenderTarget(null);
    this.renderer.setClearColor(prevClear, prevAlpha);
    this.scene.background = background;
    hidden.forEach((o, i) => (o.visible = wasVisible[i]));
    for (const [m, mat] of swapped) m.material = mat;

    if (pixel[3] === 0) return null;
    const actor = this.actorList.find((a) => a.id === pixel[0]);
    return actor ? { actor, item: pixel[1] > 0 ? actor.cosmeticItemAt(pixel[1]) : null } : null;
  }

  /** Whether Ctrl + left-drag turns a light: set by the panel while a light is the thing selected in the outliner. */
  lightDragEnabled = false;

  /** Puts orbit, zoom and pan on the mouse buttons the user chose (Settings, Hotkeys); a button with none of them does nothing in the view. */
  setNavButtons() {
    const buttons = { LEFT: -1, MIDDLE: -1, RIGHT: -1 };
    const slot = (n: number) => (n === 0 ? "LEFT" : n === 1 ? "MIDDLE" : "RIGHT") as keyof typeof buttons;
    for (const [id, action] of [["nav.orbit", THREE.MOUSE.ROTATE], ["nav.zoom", THREE.MOUSE.DOLLY], ["nav.pan", THREE.MOUSE.PAN]] as const) {
      const b = mouseButtonOf(id);
      if (b >= 0) buttons[slot(b)] = action;
    }
    this.controls.mouseButtons = buttons as unknown as typeof this.controls.mouseButtons;
  }

  /** Ctrl + left-drag turns the selected light, but only a directional one (the others have their gizmo for it). */
  private installLightDrag() {
    const el = this.renderer.domElement;
    let last: { x: number; y: number } | null = null;
    el.addEventListener(
      "pointerdown",
      (e) => {
        if (e.button !== 0 || !e.ctrlKey || this.lightGizmos.hot || !this.lightDragEnabled) return;
        const rig = this.light.rig;
        const selected = rig ? rig.lights.find(l => l.id === rig.selected) : null;
        if (rig && selected?.type !== "directional") return;
        e.stopImmediatePropagation(); // keep OrbitControls out of it
        last = { x: e.clientX, y: e.clientY };
        el.setPointerCapture(e.pointerId);
      },
      true,
    );
    el.addEventListener("pointermove", (e) => {
      if (!last) return;
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
      if (this.light.rig) {
        const rig = this.light.rig;
        const light = rig.lights.find(l => l.id === rig.selected);
        if (light) {
          [light.azimuth, light.elevation] = rotateLightDirection(light.azimuth, light.elevation, -dx * .5, dy * .5);
          this.updateLight(); this.onLightChange(this.getLight());
        }
        return;
      }
      const [azimuth, elevation] = rotateLightDirection(this.light.azimuth, this.light.elevation, dx * .5, -dy * .5);
      this.setLight({
        ...this.light,
        azimuth, elevation,
      });
      this.onLightChange(this.getLight());
    });
    const end = () => (last = null);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  }

  getLight(): LightState {
    return { ...this.light, rig: this.light.rig ? structuredClone(this.light.rig) : undefined };
  }

  setLight(l: LightState) {
    this.light = { ...l, rig: l.rig ? parseLightingRig(l.rig, l) : undefined };
    this.updateLight();
    this.updatePointLight();
  }

  /** Makes the outline of a character (or of several) blink for a moment (feedback for a click or a box that selected them). */
  flash(actors: Actor | Actor[], item: number | null = null) {
    this.endFlash();
    this.flashActors = Array.isArray(actors) ? [...actors] : [actors];
    this.flashItem = this.flashActors.length === 1 ? item : null;
    this.flashStart = performance.now();
  }

  /** The same blink for lights and cameras, which have no silhouette: a ring that opens and fades where each one is. */
  flashMarkers(items: { kind: "light" | "camera"; id: string }[]) {
    const host = this.renderer.domElement.parentElement;
    if (!host) return;
    const canvas = this.renderer.domElement.getBoundingClientRect();
    const frame = host.getBoundingClientRect();
    const rig = this.light.rig;
    for (const item of items) {
      let place: THREE.Vector3 | null = null;
      if (item.kind === "camera") {
        const data = this.cameras.cameras.find((c) => c.id === item.id);
        if (data && !this.cameras.active) place = new THREE.Vector3(...data.position);
      } else {
        const l = rig?.lights.find((x) => x.id === item.id);
        if (l && l.type !== "directional") place = new THREE.Vector3(...l.position);
      }
      if (!place) continue;
      const p = place.project(this.camera);
      if (p.z > 1) continue;
      const ring = document.createElement("div");
      ring.className = "markerFlash";
      ring.style.left = `${canvas.left - frame.left + (p.x + 1) * canvas.width / 2}px`;
      ring.style.top = `${canvas.top - frame.top + (1 - p.y) * canvas.height / 2}px`;
      ring.style.animationDuration = `${FLASH_MS}ms`;
      ring.onanimationend = () => ring.remove();
      host.append(ring);
    }
  }

  /** What flashes: the character's meshes, or only the meshes of the clicked cosmetic. */
  private flashMeshes(a: Actor): THREE.Mesh[] {
    const all = a.meshes();
    if (this.flashItem === null) return all;
    const own = all.filter((m) => a.cosmeticItemAt((m.userData.cosmeticSlot as number | undefined) ?? 0) === this.flashItem);
    return own.length > 0 ? own : all;
  }

  private selectionStrength = SELECT_OPACITY;
  /** How strong the outline that stays around what is selected is (0..1); the glow of a click is as strong in proportion. */
  setSelectionOpacity(value: number) {
    this.selectionStrength = Math.max(0, Math.min(1, value));
    this.applyHighlights();
  }

  /** Colour ("#rrggbb", as shown on screen) of the glow around a clicked character or cosmetic. */
  setFlashColor(color: string) {
    this.presentMaterial.uniforms.uOutlineColor.value.set(/^#[0-9a-f]{6}$/i.test(color.trim()) ? color.trim() : "#e08a3c");
    this.applyHighlights();
  }

  /** The outline that stays around what is selected: the characters (drawn around their silhouette), the lights and the cameras (their markers). */
  setSelectionHighlight(actors: Actor[], lights: string[], cameras: string[]) {
    this.outlined = actors;
    this.outlinedLights = lights;
    this.outlinedCameras = cameras;
    this.applyHighlights();
  }

  /** Turns the selection outline on or off. */
  setSelectionOutline(on: boolean) {
    this.outlineOn = on;
    this.applyHighlights();
  }

  private applyHighlights() {
    const colour = this.presentMaterial.uniforms.uOutlineColor.value as THREE.Color;
    this.lightGizmos.setHighlight(this.outlineOn ? this.outlinedLights : [], colour);
    this.cameras.setHighlight(this.outlineOn ? this.outlinedCameras : [], colour);
    if (!this.outlineOn || !this.outlined.length) this.presentMaterial.uniforms.uSelOutline.value = 0;
  }

  /** Draws the selected characters flat into the selection target (one extra, flat draw of them per frame) and shows the outline. */
  private updateSelectionOutline() {
    const actors = this.outlineOn ? this.outlined.filter((a) => this.actorList.includes(a) && a.hasModel) : [];
    const u = this.presentMaterial.uniforms;
    if (!actors.length) {
      u.uSelOutline.value = 0;
      return;
    }
    const r = this.renderer;
    const buf = r.getDrawingBufferSize(new THREE.Vector2());
    if (this.selectTarget.width !== buf.x || this.selectTarget.height !== buf.y) this.selectTarget.setSize(buf.x, buf.y);
    this.flashMaterial ??= makePickMaterial(255, 0);
    const meshes = actors.flatMap((a) => a.meshes());
    for (const m of meshes) m.layers.enable(SELECT_LAYER);
    const background = this.scene.background;
    const hidden = [...this.shadowQuads()];
    const wasVisible = hidden.map((o) => o.visible);
    hidden.forEach((o) => (o.visible = false));
    const prevClear = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    this.scene.background = null;
    this.scene.overrideMaterial = this.flashMaterial;
    this.camera.layers.set(SELECT_LAYER);
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.selectTarget);
    r.render(this.scene, this.camera);
    r.setRenderTarget(null);
    this.camera.layers.set(0);
    this.scene.overrideMaterial = null;
    this.scene.background = background;
    r.setClearColor(prevClear, prevAlpha);
    hidden.forEach((o, i) => (o.visible = wasVisible[i]));
    for (const m of meshes) m.layers.disable(SELECT_LAYER);
    u.uSelOutline.value = this.selectionStrength;
    u.uTexel.value.set(1 / buf.x, 1 / buf.y);
  }

  private endFlash() {
    for (const a of this.flashActors) for (const m of a.meshes()) m.layers.disable(FLASH_LAYER);
    this.flashActors = [];
    this.presentMaterial.uniforms.uOutline.value = 0;
  }

  /**
   * While a flash runs: draws the character alone (layer 1, flat) into the mask target and sets how strong the outline is. It costs
   * one extra, flat draw of that character per frame for under a second, and nothing otherwise.
   */
  private updateFlash(now: number) {
    const flashing = this.flashActors.filter((a) => this.actorList.includes(a));
    if (!flashing.length) { if (this.flashActors.length) this.endFlash(); return; }
    const t = (now - this.flashStart) / FLASH_MS;
    if (t >= 1) {
      this.endFlash();
      return;
    }
    const r = this.renderer;
    const buf = r.getDrawingBufferSize(new THREE.Vector2());
    if (this.flashTarget.width !== buf.x || this.flashTarget.height !== buf.y) this.flashTarget.setSize(buf.x, buf.y);
    this.flashMaterial ??= makePickMaterial(255, 0);
    for (const a of flashing) for (const m of this.flashMeshes(a)) m.layers.enable(FLASH_LAYER);
    const background = this.scene.background;
    const hidden = [...this.shadowQuads()];
    const wasVisible = hidden.map((o) => o.visible);
    hidden.forEach((o) => (o.visible = false));
    const prevClear = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    this.scene.background = null;
    this.scene.overrideMaterial = this.flashMaterial;
    this.camera.layers.set(FLASH_LAYER);
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.flashTarget);
    r.render(this.scene, this.camera);
    r.setRenderTarget(null);
    this.camera.layers.set(0);
    this.scene.overrideMaterial = null;
    this.scene.background = background;
    r.setClearColor(prevClear, prevAlpha);
    hidden.forEach((o, i) => (o.visible = wasVisible[i]));
    // starts at its strongest and eases out (a smoothstep, so it neither pops off nor lingers at the end)
    const fade = 1 - t * t * (3 - 2 * t);
    const u = this.presentMaterial.uniforms;
    u.uOutline.value = this.selectionStrength * (FLASH_OPACITY / SELECT_OPACITY) * fade;
    u.uTexel.value.set(1 / buf.x, 1 / buf.y);
  }

  /** Shows or hides the ground shadow and sets its direction, length, blur and strength. */
  setShadow(p: ShadowParams) {
    this.setShadows([p]);
  }

  /** The ground shadows of the scene, one decal for each. */
  setShadows(list: readonly ShadowParams[]) {
    this.shadowParams = list.map((p) => ({ ...p }));
  }

  /** Draws every shadow of the list (the ones that went off the list are hidden, their decals kept for later). */
  private updateShadows(floorY: number, moved: boolean) {
    while (this.groundShadows.length < this.shadowParams.length) this.groundShadows.push(new GroundShadow(this.renderer, this.scene));
    const off = { ...DEFAULT_SHADOW, enabled: false };
    const quads = this.shadowQuads();
    this.groundShadows.forEach((s, i) => s.update(this.shadowParams[i] ?? off, this.center.x, this.center.z, this.radius, floorY, [this.floorGrid.mesh, this.facingMarker, ...this.editorObjects, ...quads], moved));
  }

  /** Draws the characters flat into `target`: red for the ones the fog leaves alone, black for the others, nearest in front. */
  private renderFogMask(target: THREE.WebGLRenderTarget, cam: THREE.Camera) {
    const r = this.renderer;
    this.fogFreeMaterial ??= makePickMaterial(255, 0);
    this.fogHeldMaterial ??= makePickMaterial(0, 0);
    const swapped: [THREE.Mesh, THREE.Material | THREE.Material[]][] = [];
    const hidden: THREE.Object3D[] = [this.floorGrid.mesh, this.facingMarker, ...this.shadowQuads()];
    // the editor's own things (the gizmos, the light and camera markers) are drawn in red too: the fog does not lie over them
    const editorSwapped: [THREE.Object3D, THREE.Material | THREE.Material[]][] = [];
    for (const root of this.editorObjects) {
      root.traverseVisible((o) => {
        const material = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (!material) return;
        editorSwapped.push([o, material]);
        (o as THREE.Mesh).material = Array.isArray(material) ? material.map((m) => this.fogRedMaterial(m)) : this.fogRedMaterial(material);
      });
    }
    for (const a of this.actorList) {
      for (const m of a.meshes()) {
        if (m.userData.preview) {
          hidden.push(m); // the tint of a selection in progress is not a character
          continue;
        }
        swapped.push([m, m.material]);
        m.material = a.fogged ? this.fogHeldMaterial : this.fogFreeMaterial;
      }
    }
    const wasVisible = hidden.map((o) => o.visible);
    hidden.forEach((o) => (o.visible = false));
    const background = this.scene.background;
    this.scene.background = null;
    const prevClear = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(target);
    r.clear();
    r.render(this.scene, cam);
    r.setRenderTarget(null);
    r.setClearColor(prevClear, prevAlpha);
    this.scene.background = background;
    hidden.forEach((o, i) => (o.visible = wasVisible[i]));
    for (const [m, mat] of swapped) m.material = mat;
    for (const [o, mat] of editorSwapped) (o as THREE.Mesh).material = mat;
  }

  private readonly fogRedMaterials = new WeakMap<THREE.Material, THREE.Material>();
  /** A red copy of a material of the editor (lines, points, sprites or meshes) that keeps what decides where it shows: its depth test, its size and its opacity. */
  private fogRedMaterial(original: THREE.Material): THREE.Material {
    let red = this.fogRedMaterials.get(original);
    if (!red) {
      const o = original as THREE.Material & { map?: THREE.Texture | null; size?: number; sizeAttenuation?: boolean };
      if (original instanceof THREE.LineBasicMaterial) red = new THREE.LineBasicMaterial({ color: 0xff0000 });
      else if (original instanceof THREE.PointsMaterial) red = new THREE.PointsMaterial({ color: 0xff0000, size: o.size, sizeAttenuation: o.sizeAttenuation, map: o.map ?? null, alphaTest: o.map ? 0.5 : 0 });
      else if (original instanceof THREE.SpriteMaterial) red = new THREE.SpriteMaterial({ color: 0xff0000, map: o.map ?? null, alphaTest: o.map ? 0.5 : 0 });
      else red = new THREE.MeshBasicMaterial({ color: 0xff0000, side: original.side });
      this.fogRedMaterials.set(original, red);
    }
    red.depthTest = original.depthTest;
    red.depthWrite = false;
    red.transparent = original.transparent;
    red.opacity = original.opacity;
    return red;
  }

  /** Attaches the depth texture to the scene target while the fog or the occlusion needs it, and takes it off again afterwards. */
  private ensureSceneDepth(needed: boolean) {
    const target = this.sceneTarget;
    if (needed === !!target.depthTexture) return;
    if (needed) target.depthTexture = new THREE.DepthTexture(target.width, target.height);
    else {target.depthTexture?.dispose(); target.depthTexture = null;}
    target.dispose(); // its framebuffer is built again with or without the texture
    this.presentMaterial.uniforms.tDepth.value = target.depthTexture;
  }

  /** While ambient occlusion is on: measures it from this frame's depth. */
  private updateAo() {
    this.aoUniforms.uAoOn.value = this.ao.enabled ? 1 : 0;
    if (!this.ao.enabled || !this.sceneTarget.depthTexture) return;
    this.aoPass ??= new AoPass();
    const buf = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.camera.updateMatrixWorld();
    this.aoUniforms.tAo.value = this.aoPass.render(this.renderer, this.sceneTarget.depthTexture, this.camera, buf.x, buf.y, this.ao, this.charHeight);
  }

  /** The size of the picture for the effects, and the glow of bloom while it is on. */
  private updateLook() {
    const buf = this.renderer.getDrawingBufferSize(this.lookRes);
    // the picture the final pass reads: the scene (or the average of its moments), blurred by the depth of field when that is on
    let source: THREE.Texture = this.motionTexture ?? this.sceneTarget.texture;
    const dof = this.look.dof;
    if (dof?.enabled && this.sceneTarget.depthTexture) {
      this.dofPass ??= new DofPass();
      source = this.dofPass.render(this.renderer, source, this.sceneTarget.depthTexture, this.camera, buf.x, buf.y, dof, this.dofFocusDistance(this.camera), this.charHeight);
    } else if (this.dofPass) {
      this.dofPass.dispose();
      this.dofPass = null;
    }
    if (!this.motionTexture && this.motionAcc) { this.motionAcc.dispose(); this.motionAcc = null; }
    this.presentMaterial.uniforms.tScene.value = source;
    const bloom = this.look.bloom;
    if (bloom?.enabled && bloom.intensity > 0) {
      this.bloomPass ??= new BloomPass();
      this.presentMaterial.uniforms.tBloom.value = this.bloomPass.render(this.renderer, source, buf.x, buf.y, bloom);
    } else if (this.bloomPass) {
      this.bloomPass.dispose();
      this.bloomPass = null;
      this.presentMaterial.uniforms.tBloom.value = null;
    }
  }

  /** The reflection in the floor: where the plane is, and the picture of the scene that it shows. */
  private updateReflection(floorY: number) {
    const unit = Math.max(1, this.actorList.reduce((h, a) => Math.max(h, a.bindHeight), 0));
    this.reflection.update(this.look.reflection ?? null, this.center.x, this.center.z, floorY, unit);
    if (!this.reflection.mesh.visible) return;
    const buf = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.reflection.render(this.renderer, this.scene, this.camera, buf.x, buf.y, this.reflectionHidden());
  }

  /** What is not part of the world in the picture of the mirror: the floor and its shadows, the grid and the gizmos. */
  private reflectionHidden(): THREE.Object3D[] {
    return [...this.shadowQuads(), this.floorGrid.mesh, this.facingMarker, ...this.editorObjects];
  }

  /** The distance (along the way the camera looks) from `cam` to the middle of the selected character, or of what the view looks at. */
  private dofFocusDistance(cam: THREE.Camera): number {
    const actor = this.selectedActor;
    const centre = actor ? actor.offset.clone().add(new THREE.Vector3(0, actor.bindHeight * 0.5, 0)) : this.controls.target.clone();
    const forward = cam.getWorldDirection(new THREE.Vector3());
    return Math.max(0.1, centre.sub(cam.getWorldPosition(new THREE.Vector3())).dot(forward));
  }

  /**
   * The floor (the ground plane, the reflection, the grid and the shadows) is made of see-through things that are drawn in order, after
   * everything solid: a marker of the editor that is solid (the bulb of a light, the lines of its cone) would be drawn before them and
   * covered by them. So the markers are see-through things too, drawn after the floor.
   */
  private sortEditorAfterFloor() {
    for (const root of this.editorObjects) {
      root.traverse((o) => {
        const material = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (!material) return;
        for (const m of Array.isArray(material) ? material : [material]) if (!m.transparent) m.transparent = true;
        if (o.renderOrder < 0) o.renderOrder = 0;
      });
    }
  }

  /** The scene of this frame into the scene target: with motion blur in the view when it is asked for, the average of a few moments of it. */
  private renderLiveScene(): THREE.Texture | null {
    const mb = this.look.motionBlur;
    if (!(mb?.enabled && mb.preview && mb.shutter > 0)) {
      this.renderScene(this.renderer, this.camera);
      return null;
    }
    this.motionAcc ??= new MotionAccumulator();
    return this.renderSubframes(() => { this.renderer.setRenderTarget(this.sceneTarget); this.renderScene(this.renderer, this.camera); }, this.sceneTarget.texture, Math.min(mb.samples, 8), mb.shutter, this.sceneTarget.width, this.sceneTarget.height, this.motionAcc);
  }

  /**
   * Motion blur: the characters are posed at a few moments of their animations around the time they show (the moments of an exposure),
   * `renderOne` draws the scene for each into `source`, and the pictures are averaged. The moment closest to the middle is drawn last, so
   * that its depth is the picture's. The characters are put back at their own time at the end.
   */
  private renderSubframes(renderOne: () => void, source: THREE.Texture, samples: number, shutter: number, w: number, h: number, acc: MotionAccumulator): THREE.Texture {
    const moving = this.actorList.filter((a) => a.playback.clip && a.playback.clip.frames > 1);
    const base = moving.map((a) => a.playback.time);
    const offsets = subframeOffsets(samples, shutter);
    acc.begin(this.renderer, w, h);
    for (const dt of offsets) {
      moving.forEach((a, i) => { a.playback.time = base[i] + dt * a.playback.speed; a.poseBones(); });
      renderOne();
      acc.add(source, 1 / offsets.length);
    }
    moving.forEach((a, i) => { a.playback.time = base[i]; a.poseBones(); });
    return acc.texture;
  }

  /** Sets the look effects (the ones that are on go over the picture, in the live view and in screenshots). */
  setLook(states: LookStates) {
    this.look = states;
    applyLookUniforms(this.lookUniforms, states);
  }

  /** Sets the ambient occlusion over the picture. */
  setAo(a: AoState) {
    this.ao = { ...a };
    this.aoUniforms.uAoStrength.value = a.strength;
    this.aoUniforms.uAoPower.value = a.power;
  }

  getAo(): AoState {
    return { ...this.ao };
  }

  /** The rim lights (the first MAX_RIM_LIGHTS that are on shine). */
  setRimLights(list: readonly RimLightState[]) {
    const on = list.map(parseRimLight).filter((r) => r.enabled).slice(0, MAX_RIM_LIGHTS);
    const u = this.shared;
    u.uStudioRimCount.value = on.length;
    on.forEach((rim, i) => {
      const radians = rim.direction * Math.PI / 180;
      u.uStudioRimColor.value[i].copy(displayColor(rim.color));
      u.uStudioRimStrength.value[i] = rim.strength;
      u.uStudioRimPower.value[i] = .5 + (1 - rim.width) * 12;
      u.uStudioRimDirection.value[i].set(Math.cos(radians), Math.sin(radians));
      u.uStudioRimSoftness.value[i] = rim.softness;
      u.uStudioRimAllAround.value[i] = rim.allAround ? 1 : 0;
      u.uStudioRimPainted.value[i] = rim.painted ? 1 : 0;
      u.uStudioRimLine.value[i].set(rim.cutoff, rim.edgeSoftness);
    });
  }

  /** Gives the final picture's shader what it needs to place the fog in the world: the camera, the floor and the height of a character. */
  private updateFogWorld(floorY: number) {
    this.charHeight = Math.max(1, this.actorList.reduce((h, a) => Math.max(h, a.bindHeight), 0));
    if (!this.fogOn) return;
    const u = this.presentMaterial.uniforms;
    this.camera.updateMatrixWorld();
    (u.uInvViewProj.value as THREE.Matrix4).copy(this.camera.matrixWorld).multiply(this.camera.projectionMatrixInverse);
    this.camera.getWorldPosition(u.uCamPos.value as THREE.Vector3);
    this.camera.getWorldDirection(u.uCamForward.value as THREE.Vector3);
    u.uBackDist.value = Math.max(1, this.camera.position.distanceTo(this.controls.target));
    this.fogUniforms.uFogBase.value = floorY;
    this.fogUniforms.uFogHeight.value = this.charHeight;
  }

  /** While the fog is on and some character is exempt from it: marks the pixels of those characters, one flat extra draw per frame. */
  private updateFogMask() {
    const needed = this.fogOn && (this.actorList.some((a) => !a.fogged) || this.editorObjects.some((o) => o.visible));
    this.fogUniforms.uFogMaskOn.value = needed ? 1 : 0;
    if (!needed) return;
    const buf = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    if (this.fogMaskTarget.width !== buf.x || this.fogMaskTarget.height !== buf.y) this.fogMaskTarget.setSize(buf.x, buf.y);
    this.renderFogMask(this.fogMaskTarget, this.camera);
  }

  /** Sets the gradient fogs over the picture (the ones that are on are laid over it in the order of the list). */
  setFogs(list: readonly FogState[]) {
    this.fogOn = list.some((f) => f.enabled);
    applyFogUniforms(this.fogUniforms, list);
  }

  setLightGizmoVisible(v: boolean) {
    this.gizmo.visible = v;
  }

  private updateLight() {
    const rig = this.light.rig;
    const { azimuth, elevation, intensity, color, ambient, ambientColor, followCamera } = { ...this.light, ...(rig ? { intensity: 0 } : {}) };
    const az = (azimuth * Math.PI) / 180;
    const el = (elevation * Math.PI) / 180;
    // +Z points toward the viewer (camera space) or toward the model's front (world space).
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    if (followCamera) dir.applyQuaternion(this.camera.quaternion);
    this.shared.uLightDir.value.copy(dir);
    // The picker colour is a display (gamma) colour, converted to linear like the material tints.
    const [r, g, b] = [1, 3, 5].map((i) => Math.pow(parseInt(color.slice(i, i + 2), 16) / 255, 2.2) * intensity);
    this.shared.uLightColor.value.set(r, g, b);
    // Same conversion as the light colour: the picker value is a display colour, converted to linear, times the level.
    const [ar, ag, ab] = [1, 3, 5].map((i) => Math.pow(parseInt(ambientColor.slice(i, i + 2), 16) / 255, 2.2) * ambient);
    for (const a of this.shared.uAmbient.value) a.set(ar, ag, ab);
    this.shared.uAverageAmbient.value = Math.max(0, Math.min(0.2126 * ar + 0.7152 * ag + 0.0722 * ab, 1));

    const bulb = this.gizmo.getObjectByName("bulb") as THREE.Mesh;
    const ray = this.gizmo.getObjectByName("ray") as THREE.Line;
    bulb.position.copy(this.center).addScaledVector(dir, this.radius * 1.9);
    bulb.scale.setScalar(this.radius * 0.03);
    ray.geometry.setFromPoints([bulb.position, this.center]);
    this.lightingRenderer.update(rig, this.camera);
    if (rig) {
      this.gizmo.visible = false;
    }
  }

  private lightAnchor(): THREE.Vector3 { return this.selectedActor ? this.selectedActor.offset.clone().add(new THREE.Vector3(0,this.selectedActor.bindHeight*.5,0)) : this.center.clone(); }
  lightSpawnPosition(): [number, number, number] { const radius=this.selectedActor?.bindHeight ? this.selectedActor.bindHeight*.65 : this.radius;return this.lightAnchor().add(new THREE.Vector3(radius,radius,radius*1.5)).toArray() as [number, number, number]; }
  legacyPointPosition(): [number, number, number] { return this.shared.uPointPos.value.toArray(); }
  get sceneRadius(): number { return this.radius; }

  private renderLightShadows(moved: boolean) {
    this.lightingRenderer.render(this.renderer,this.scene,this.center,this.radius,[...this.shadowQuads(),this.floorGrid.mesh,this.facingMarker,...this.editorObjects],moved);
  }

  private fixedVerticalFov: number | null = null;
  /** A colour that was asked for behind everything (the studio of the icons); the sky is not shown while there is one. */
  private backgroundColor: number | null = null;
  /** The colour of the scene itself, behind everything when there is no sky and the studio does not ask for another. */
  private backdropColor = HLMV_BACKGROUND;
  private sky: THREE.CubeTexture | null = null;
  private skyRotation = 0;
  private skyBrightness = 1;
  /** Gives the view a vertical field of view of its own (degrees), whatever its shape; null: the horizontal one of the view setting. */
  setFixedVerticalFov(degrees: number | null) {
    this.fixedVerticalFov = degrees;
    this.resize();
  }

  /** The colour of the scene behind everything when there is no sky ("#rrggbb"). */
  setBackdropColor(hex: string) {
    this.backdropColor = parseInt(hex.slice(1), 16);
    this.applyBackground();
  }

  /** The colour behind everything (null: the usual grey, or the sky when there is one). */
  setBackground(color: number | null) {
    this.backgroundColor = color;
    this.applyBackground();
  }

  /** The plane at the floor (see groundPlane.ts). */
  setGround(state: GroundState) {
    this.groundState = { ...state };
  }

  /** The sky behind everything (null: none); it turns by `rotation` degrees around the vertical axis and is `brightness` times as bright. */
  setSky(texture: THREE.CubeTexture | null, rotation = 0, brightness = 1) {
    this.sky = texture;
    this.skyRotation = rotation;
    this.skyBrightness = brightness;
    this.applyBackground();
  }

  private skyScene: THREE.Scene | null = null;
  private skyQuad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> | null = null;

  /**
   * Draws the scene into the current target. Three draws a sky (a cube texture) as a box of one unit around the camera, seen with the
   * camera's own projection: in a parallel projection that box is a dot, so the sky was missing in orthographic views. There the sky is drawn
   * first by a pass of its own, as a perspective picture of the sky (the field of view of the camera, its direction), and the scene over it.
   */
  private renderScene(r: THREE.WebGLRenderer, cam: THREE.Camera) {
    const scene = this.scene, sky = this.sky;
    if (!(cam as THREE.PerspectiveCamera & { isOrthographicCamera?: boolean }).isOrthographicCamera || !sky || scene.background !== sky) { r.render(scene, cam); return; }
    if (!this.skyQuad) {
      this.skyQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
        uniforms: { tCube: { value: null }, uCamera: { value: new THREE.Matrix3() }, uSky: { value: new THREE.Matrix3() }, uTan: { value: new THREE.Vector2(1, 1) }, uIntensity: { value: 1 } },
        vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); }",
        fragmentShader: `uniform samplerCube tCube; uniform mat3 uCamera; uniform mat3 uSky; uniform vec2 uTan; uniform float uIntensity;
varying vec2 vUv;
void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 d = uSky * (uCamera * normalize(vec3(ndc.x * uTan.x, ndc.y * uTan.y, -1.0)));
  gl_FragColor = vec4(textureCube(tCube, vec3(-d.x, d.y, d.z)).rgb * uIntensity, 1.0);
}`,
        depthTest: false, depthWrite: false,
      }));
      this.skyQuad.frustumCulled = false;
      this.skyScene = new THREE.Scene();
      this.skyScene.add(this.skyQuad);
    }
    const u = this.skyQuad.material.uniforms;
    const view = cam as THREE.PerspectiveCamera;
    view.updateMatrixWorld();
    const tan = Math.tan(THREE.MathUtils.degToRad(view.fov) / 2);
    u.tCube.value = sky;
    (u.uCamera.value as THREE.Matrix3).setFromMatrix4(view.matrixWorld);
    (u.uSky.value as THREE.Matrix3).setFromMatrix4(new THREE.Matrix4().makeRotationFromEuler(scene.backgroundRotation));
    (u.uTan.value as THREE.Vector2).set(tan * view.aspect, tan);
    u.uIntensity.value = scene.backgroundIntensity;
    const target = r.getRenderTarget(), autoClear = r.autoClear;
    scene.background = null;
    r.autoClear = false;
    try {
      r.setRenderTarget(target);
      r.clear();
      r.render(this.skyScene!, this.presentCamera);
      r.clearDepth();
      r.render(scene, cam);
    } finally {
      scene.background = sky;
      r.autoClear = autoClear;
    }
  }

  private applyBackground() {
    const scene = this.scene;
    if (this.backgroundColor === null && this.sky) {
      scene.background = this.sky;
      scene.backgroundRotation.set(0, this.skyRotation * Math.PI / 180, 0);
      scene.backgroundIntensity = this.skyBrightness;
    } else scene.background = new THREE.Color(this.backgroundColor ?? this.backdropColor);
  }

  private resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    const buffer = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.sceneTarget.setSize(buffer.x, buffer.y);
    this.camera.aspect = w / h;
    // hlmv specifies a horizontal FOV; three wants vertical.
    this.camera.fov = this.fixedVerticalFov ?? (2 * Math.atan(Math.tan((this.fovX * Math.PI) / 360) / this.camera.aspect) * 180) / Math.PI;
    this.camera.updateProjectionMatrix();
  }

  /** Sets the horizontal field of view in degrees; the camera position is unchanged. */
  setFov(degrees: number) {
    this.fovX = degrees;
    this.resize();
  }

  /** Camera on the selected character's eyes, about 11 units of head height in view (for checking eye shading). */
  focusFace() {
    if (this.cameras.active) this.cameras.leave();
    const eyes = this.selectedActor?.eyeMaterials ?? [];
    if (eyes.length === 0) return;
    const c = new THREE.Vector3();
    for (const e of eyes) c.add(e.uniforms.uEyeOrigin.value);
    c.divideScalar(eyes.length);
    const dist = 5.5 / Math.tan((this.camera.fov * Math.PI) / 360);
    this.camera.near = 0.5;
    if (this.camera.isOrthographicCamera) { this.camera.halfHeight = 5.5; this.camera.zoom = 1; }
    this.camera.updateProjectionMatrix();
    this.glideTo(c.clone().add(new THREE.Vector3(0, 0, dist)), c);
  }

  /** The camera as saved in a scene. */
  getCamera(): { position: [number, number, number]; target: [number, number, number] } {
    return this.cameras.editorView();
  }

  /** Puts the camera where a scene had it; the camera then counts as placed (it is not re-framed on the next model). */
  restoreCamera(position: [number, number, number], target: [number, number, number]) {
    this.camera.position.fromArray(position);
    this.controls.target.fromArray(target);
    const dist = this.camera.position.distanceTo(this.controls.target);
    this.camera.near = Math.max(0.1, dist / 100);
    this.camera.far = Math.max(dist * 20, 5000);
    this.camera.updateProjectionMatrix();
    this.cameraPlaced = true;
    this.frameAfterClip = false;
    this.controls.update();
  }

  /**
   * Freezes the current frame of a character's animation into an editable pose and shows the control rig on it. False when there
   * is no animation to take the pose from.
   */
  startPose(actor: Actor): boolean {
    this.cameras.stopEditing();
    if (!actor.beginPose()) return false;
    this.rig.setActor(actor);
    return true;
  }

  /** Puts a saved pose on a character (it starts posing if it was not) and shows the rig. */
  usePose(actor: Actor, pose: { pos: Float32Array; quat: Float32Array }) {
    actor.usePose(pose);
    if (this.rig.actor !== actor) this.rig.setActor(actor);
  }

  /** Hides the control rig (the character itself has to be given an animation again by the caller). */
  stopPose() {
    if (this.rig.actor) this.rig.forget(this.rig.actor);
    this.rig.setActor(null);
  }

  /** Whether a character was placed by hand (and so ignores the row spacing). */
  isPlaced(actor: Actor): boolean {
    return this.placed.has(actor);
  }

  /** Places a character by hand. */
  placeActor(actor: Actor, x: number, y: number, z: number, yaw: number) {
    actor.setPlacement(x, y, z, yaw);
    this.placed.add(actor);
    this.frame(false);
  }

  getSpacing(): number {
    return this.spacing;
  }

  private viewAnim = 0;

  setCameraSmoothing(enabled: boolean) {
    if (this.controls.enableDamping === enabled) return;
    this.controls.enableDamping = enabled;
    // Finish pending orbit deltas once, then stop accumulating inertia.
    this.controls.update();
  }

  setScrollStrength(strength: number) {
    this.controls.zoomSpeed = Number.isFinite(strength) ? Math.max(.1, Math.min(10, strength)) : 1;
  }

  /** Center the actual posed surface under the pointer and orbit around that point. */
  focusAtPointer(): boolean {
    if (!this.entityPointer.inside || this.entityModal || this.cameras.hot || this.rig.gizmoHot) return false;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const { x, y } = this.entityPointer;
    if (!rect.width || !rect.height || x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return false;
    this.camera.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((x - rect.left) / rect.width * 2 - 1, 1 - (y - rect.top) / rect.height * 2), this.camera);
    const meshes = this.actorList.flatMap(actor => actor.meshes()).filter(mesh => {
      for (let parent: THREE.Object3D | null = mesh; parent; parent = parent.parent) if (!parent.visible) return false;
      return !mesh.userData.preview && (Array.isArray(mesh.material) ? mesh.material.some(material => material.visible) : mesh.material.visible);
    });
    for (const mesh of meshes) {
      mesh.updateWorldMatrix(true, false);
      if (mesh instanceof THREE.SkinnedMesh) {
        // Bind-pose bounds cannot reject a hit on an animated or edited pose.
        for (const bone of mesh.skeleton.bones) bone.updateWorldMatrix(true, false);
        mesh.computeBoundingSphere();
        if (mesh.boundingBox) mesh.computeBoundingBox();
      }
    }
    const hit = ray.intersectObjects(meshes, false)[0];
    if (!hit) return false;
    const direction = this.camera.getWorldDirection(new THREE.Vector3());
    const distance = this.camera.isOrthographicCamera ? this.camera.position.distanceTo(this.controls.target) : hit.point.distanceTo(this.camera.position);
    this.cameras.prepareNavigation();
    const point = hit.point.clone();
    // the ping shows where the view arrived, when it has
    this.glideTo(point.clone().addScaledVector(direction, -Math.max(distance, this.controls.minDistance)), point, () => this.ping(point));
    return true;
  }

  /**
   * Moves the camera and what it looks at to a new place: eased over a moment when camera smoothing is on, at once when it is
   * off (the same as the navigation gizmo's clicks). Any movement by the user (or another view change) stops it.
   */
  private glideTo(position: THREE.Vector3, target: THREE.Vector3, done?: () => void) {
    const token = ++this.viewAnim;
    // finish the inertia of a drag before the view is moved by hand, so it does not carry on from the new place
    const smooth = this.controls.enableDamping;
    this.controls.enableDamping = false;
    try { this.controls.update(); } finally { this.controls.enableDamping = smooth; }
    const finish = () => {
      this.camera.position.copy(position);
      this.controls.target.copy(target);
      this.controls.update();
      this.camera.updateMatrixWorld(true);
      done?.();
    };
    if (!smooth) {
      finish();
      return;
    }
    const fromPosition = this.camera.position.clone(), fromTarget = this.controls.target.clone();
    const start = performance.now();
    const step = (now: number) => {
      if (token !== this.viewAnim) return;
      // camera smoothing can be switched off while it glides: it then ends at once
      const t = this.controls.enableDamping ? Math.min((now - start) / 240, 1) : 1;
      if (t >= 1) { finish(); return; }
      const e = t * t * (3 - 2 * t);
      this.camera.position.lerpVectors(fromPosition, position, e);
      this.controls.target.lerpVectors(fromTarget, target, e);
      this.controls.update();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /** Whether the pointer is over the view (the keys that act on the view only work then). */
  get pointerInside(): boolean {
    return this.entityPointer.inside;
  }

  /** A ping where the view focused: two rings that open from the point and fade, like a radar blip. */
  private ping(point: THREE.Vector3) {
    const host = this.renderer.domElement.parentElement;
    if (!host) return;
    const canvas = this.renderer.domElement.getBoundingClientRect();
    const frame = host.getBoundingClientRect();
    const p = point.clone().project(this.camera);
    if (p.z > 1) return;
    const x = canvas.left - frame.left + (p.x + 1) * canvas.width / 2;
    const y = canvas.top - frame.top + (1 - p.y) * canvas.height / 2;
    for (const delay of [0, 140]) {
      const ring = document.createElement("div");
      ring.className = "focusPing";
      ring.style.left = `${x}px`;
      ring.style.top = `${y}px`;
      ring.style.animationDelay = `${delay}ms`;
      ring.onanimationend = () => ring.remove();
      host.append(ring);
    }
    const dot = document.createElement("div");
    dot.className = "focusDot";
    dot.style.left = `${x}px`;
    dot.style.top = `${y}px`;
    dot.onanimationend = () => dot.remove();
    host.append(dot);
  }

  toggleProjection() {
    if (this.cameras.active) this.cameras.leave(true);
    this.viewAnim++;
    const camera = this.camera, target = this.controls.target;
    const offset = camera.position.clone().sub(target);
    if (camera.isOrthographicCamera) {
      const distance = camera.halfHeight / camera.zoom / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      camera.position.copy(target).addScaledVector(offset.normalize(), distance);
      camera.zoom = 1; camera.setOrthographic(false, distance);
    } else camera.setOrthographic(true, offset.length());
    this.controls.update();
  }

  restoreProjection(state?: { orthographic: boolean; halfHeight: number; zoom: number }) {
    this.camera.setOrthographic(state?.orthographic === true, this.camera.position.distanceTo(this.controls.target));
    this.camera.halfHeight = state?.halfHeight ?? 1; this.camera.zoom = state?.zoom ?? 1;
    this.camera.updateProjectionMatrix();
  }

  /** Turns the camera about what it looks at by a mouse movement in pixels: a drag on the navigation gizmo, like Alt + drag in Blender. */
  orbitBy(dx: number, dy: number) {
    if (this.cameras.overlayEditing || this.cameras.locked) return;
    this.cameras.prepareNavigation();
    this.viewAnim++;
    const target = this.controls.target;
    const offset = this.camera.position.clone().sub(target);
    const sph = new THREE.Spherical().setFromVector3(offset);
    const speed = (2 * Math.PI) / Math.max(1, this.container.clientHeight);
    sph.theta -= dx * speed;
    sph.phi = Math.min(Math.max(sph.phi - dy * speed, 0.001), Math.PI - 0.001);
    this.camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(sph));
    this.controls.update();
  }

  /** The unit direction from what the camera looks at to the camera. */
  viewDir(): THREE.Vector3 {
    return this.camera.position.clone().sub(this.controls.target).normalize();
  }

  /** Turns the camera (about what it looks at) to the `dir` side, smoothly: a click on an axis of the navigation gizmo. */
  snapView(dir: THREE.Vector3) {
    if (this.cameras.overlayEditing) return;
    this.cameras.prepareNavigation();
    const token = ++this.viewAnim;
    const target = this.controls.target;
    const offset = this.camera.position.clone().sub(target);
    const dist = Math.max(offset.length(), 1e-3);
    const from = offset.clone().normalize();
    const to = dir.clone().normalize();
    // straight above or below the orbit controls have no up direction: lean a hair to one side
    if (Math.abs(to.y) > 0.999) to.set(0, Math.sign(to.y) * 0.9999, 0.0141).normalize();
    if (!this.controls.enableDamping) {
      this.camera.position.copy(target).addScaledVector(to, dist);
      this.controls.update();
      return;
    }
    const turn = new THREE.Quaternion().setFromUnitVectors(from, to);
    const start = performance.now();
    const step = (now: number) => {
      if (token !== this.viewAnim) return;
      const t = this.controls.enableDamping ? Math.min((now - start) / 220, 1) : 1;
      const e = t * t * (3 - 2 * t);
      const q = new THREE.Quaternion().slerp(turn, e);
      this.camera.position.copy(target).addScaledVector(from.clone().applyQuaternion(q), dist);
      this.controls.update();
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /** Moves the camera closer (`factor` below 1) or further away from what it looks at. */
  zoomBy(factor: number) {
    if (this.cameras.overlayEditing) return;
    if (this.cameras.locked) { this.cameras.zoomView(factor); return; } // a fixed camera: only the view zooms
    this.cameras.prepareNavigation();
    this.viewAnim++;
    if (this.camera.isOrthographicCamera) {
      this.camera.zoom = Math.max(.001, Math.min(1000, this.camera.zoom / factor));
      this.camera.updateProjectionMatrix(); this.controls.update(); return;
    }
    const target = this.controls.target;
    const offset = this.camera.position.clone().sub(target);
    const dist = Math.min(Math.max(offset.length() * factor, this.controls.minDistance), this.controls.maxDistance);
    this.camera.position.copy(target).addScaledVector(offset.normalize(), dist);
    this.controls.update();
  }

  /** Moves the view sideways and up / down by a mouse movement in pixels (what the right mouse button does, too). */
  panBy(dx: number, dy: number) {
    if (this.cameras.overlayEditing) return;
    if (this.cameras.locked) { this.cameras.panView(dx, dy); return; } // a fixed camera: the view slides over the screen
    this.cameras.prepareNavigation();
    this.viewAnim++;
    const cam = this.camera;
    const dist = cam.position.distanceTo(this.controls.target);
    const span = cam.isOrthographicCamera ? 2 * cam.halfHeight / cam.zoom : 2 * dist * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const perPixel = span / Math.max(1, this.container.clientHeight);
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 1);
    const move = right.multiplyScalar(-dx * perPixel).addScaledVector(up, dy * perPixel);
    cam.position.add(move);
    this.controls.target.add(move);
    this.controls.update();
  }

  /** Camera on the selected character's full body, from where it looks now. */
  focusBody() {
    if (this.cameras.active) this.cameras.leave();
    const actor = this.selectedActor;
    if (!actor?.hasModel) return;
    this.frameCamera(actor.computeBounds(new THREE.Box3()), true, undefined, true);
  }

  /** Camera back on all the characters, from where it looks now. */
  focusAll() {
    if (this.cameras.active) this.cameras.leave();
    if (this.actorList.length === 0) return;
    this.frame(true, true, undefined, true);
  }

  /** Starts a selection (box, lasso or brush) over a character's body, as the view looks now. */
  beginSelect(actor: Actor): ViewSelection | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.camera.updateMatrixWorld();
    const ndc = new THREE.Vector3();
    return actor.beginSelect((p, out) => {
      ndc.copy(p).project(this.camera);
      if (ndc.z < -1 || ndc.z > 1) return false;
      out.x = rect.left + (ndc.x * 0.5 + 0.5) * rect.width;
      out.y = rect.top + (0.5 - ndc.y * 0.5) * rect.height;
      return true;
    });
  }

  /** Camera on everything shown, from the front and a little to the side and above, as for looking over a single item. */
  focusInspect() {
    if (this.actorList.length === 0) return;
    this.frame(true, false, new THREE.Vector3(0.45, 0.3, 1));
  }

  /**
   * Measures the group of characters (light gizmo size, shadow footprint, focus targets) and, when `placeCamera`, aims the camera
   * at it: from the front for the very first placement, else from the current direction (`keepDirection`).
   */
  frame(placeCamera: boolean, keepDirection = false, direction?: THREE.Vector3, glide = false) {
    const box = new THREE.Box3();
    for (const a of this.actorList) {
      if (a.hasModel) box.union(a.computeBounds(this.tmpBox));
    }
    if (box.isEmpty()) return;
    box.getCenter(this.center);
    const size = box.getSize(new THREE.Vector3());
    this.radius = Math.max(size.x, size.y, size.z) * 0.5;
    if (!placeCamera) return;
    this.frameCamera(box, keepDirection, direction, glide);
  }

  /** Frames bounds without changing the whole scene's light and shadow measurements. */
  private frameCamera(box: THREE.Box3, keepDirection: boolean, direction?: THREE.Vector3, glide = false) {
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) * 0.5;
    this.cameraPlaced = true;
    const dist = (radius / Math.tan((this.camera.fov * Math.PI) / 360)) * 1.15;
    const dir = direction ? direction.clone().normalize() : keepDirection ? this.camera.position.clone().sub(this.controls.target).normalize() : new THREE.Vector3(0, 0, 1);
    if (!Number.isFinite(dir.x) || dir.lengthSq() < 0.5) dir.set(0, 0, 1);
    const place = center.clone().addScaledVector(dir, dist);
    if (this.camera.isOrthographicCamera) { this.camera.halfHeight = radius * 1.15 / Math.min(1, this.camera.aspect); this.camera.zoom = 1; }
    this.camera.near = Math.max(0.1, dist / 100);
    this.camera.far = dist * 20;
    this.camera.updateProjectionMatrix();
    if (glide) { this.glideTo(place, center); return; }
    this.controls.target.copy(center);
    this.camera.position.copy(place);
    this.controls.update();
  }

  /**
   * Renders the scene at `scale` times the size of the view into a PNG, with the gizmos hidden. With `transparent` the background
   * is left out (the ground shadow keeps its soft alpha). Large sizes are capped by the GPU's texture size and a pixel budget.
   */
  async capture(
    scale: number,
    transparent: boolean,
    opts?: { size?: { w: number; h: number }; camera?: THREE.PerspectiveCamera; only?: Actor; fullScene?: boolean; layers?: boolean;
      /** Turns the camera by this many radians about the vertical axis through `center` (a turntable frame). */
      orbit?: { angle: number; center: THREE.Vector3 };
      /** Returns the picture as a canvas, not as a PNG (a frame of a video). */
      canvas?: boolean;
      /** Makes both sizes even (what video codecs ask for). */
      even?: boolean;
      /** Scales the size of a camera's picture (a camera has a size of its own, which `scale` does not touch). */
      scaleSize?: number },
  ): Promise<{ blob: Blob; width: number; height: number; layers?: ExportLayer[]; merged?: Uint8ClampedArray; canvas?: HTMLCanvasElement }> {
    const r = this.renderer;
    const shot = !opts?.camera && !opts?.only ? this.cameras.captureCamera() : null;
    const overlay = shot ? parseOverlay(this.cameras.activeCamera?.overlay) : undefined;
    if (shot) opts = { ...opts, camera: shot.camera, size: shot.size, fullScene: true };
    // a shot of a camera has the background (the sky or the colour) and the ground plane when the camera says so; any other shot, when the setting does not ask for a transparent one
    if (shot) transparent = this.cameras.activeCamera?.captureBackground !== true;
    const buf = r.getDrawingBufferSize(new THREE.Vector2());
    const cam = opts?.camera ?? this.camera;
    const camPosition = cam.position.clone(), camQuaternion = cam.quaternion.clone();
    if (opts?.orbit) {
      const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), opts.orbit.angle);
      cam.position.sub(opts.orbit.center).applyQuaternion(turn).add(opts.orbit.center);
      cam.quaternion.premultiply(turn);
      cam.updateMatrixWorld(true);
    }
    let w = opts?.size ? Math.round(opts.size.w * (opts.scaleSize ?? 1)) : Math.round(buf.x * scale);
    let h = opts?.size ? Math.round(opts.size.h * (opts.scaleSize ?? 1)) : Math.round(buf.y * scale);
    const k = Math.min(1, r.capabilities.maxTextureSize / w, r.capabilities.maxTextureSize / h, Math.sqrt((opts?.layers ? 8e6 : 24e6) / (w * h)));
    w = Math.max(1, Math.floor(w * k));
    h = Math.max(1, Math.floor(h * k));
    if (opts?.even) { w = Math.max(2, w & ~1); h = Math.max(2, h & ~1); }
    const pixels = w * h;
    const sceneRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: pixels <= 6e6 ? 4 : pixels <= 12e6 ? 2 : 0, depthTexture: new THREE.DepthTexture(w, h) });
    const outRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, colorSpace: THREE.SRGBColorSpace });
    // characters that stay clear of the fog are marked in a target of their own, as seen from the capture camera
    const shown = opts?.only ? [opts.only] : this.actorList;
    const maskRT = this.fogOn && shown.some((a) => !a.fogged) ? new THREE.WebGLRenderTarget(w, h, { colorSpace: THREE.NoColorSpace, samples: pixels <= 6e6 ? 4 : 0 }) : null;
    const hidden: THREE.Object3D[] = [this.floorGrid.mesh, this.facingMarker, ...this.editorObjects, ...(transparent ? [this.ground.mesh] : [])];
    const reflectionWas = this.reflection.mesh.visible;
    // a single character (a pose thumbnail): the others and the ground shadow stay out of the picture
    if (opts?.only) hidden.push(...this.shadowQuads(), ...this.actorList.filter((a) => a !== opts.only).flatMap((a) => a.meshes()));
    const wasVisible = hidden.map((o) => o.visible);
    hidden.forEach((o) => (o.visible = false));
    const background = this.scene.background;
    const prevClear = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    if (transparent) {
      this.scene.background = null;
      r.setClearColor(0x000000, 0);
    }
    let aoTexture: THREE.Texture | null = null;
    // the look effects are part of a picture of the scene (not of a thumbnail of one character, or of a backpack icon)
    const withLook = (!opts?.camera || opts.fullScene) && !opts?.only;
    let captureBloom: BloomPass | null = null;
    let captureDof: DofPass | null = null;
    let captureMotion: MotionAccumulator | null = null;
    const material = new THREE.ShaderMaterial({
      uniforms: { tScene: { value: sceneRT.texture }, tDepth: { value: sceneRT.depthTexture }, uInvViewProj: { value: cam.matrixWorld.clone().multiply(cam.projectionMatrixInverse) }, uCamPos: { value: cam.getWorldPosition(new THREE.Vector3()) }, uCamForward: { value: cam.getWorldDirection(new THREE.Vector3()) }, uBackDist: { value: Math.max(1, this.camera.position.distanceTo(this.controls.target)) }, uTransparent: { value: transparent }, ...this.fogUniforms, ...(withLook ? this.lookUniforms : createLookUniforms()), uLookRes: { value: new THREE.Vector2(w, h) }, tBloom: { value: null }, uFogCount: { value: opts?.camera && !opts.fullScene ? 0 : this.fogUniforms.uFogCount.value }, tAo: { value: aoTexture }, uAoOn: { value: aoTexture ? 1 : 0 }, uAoStrength: { value: this.ao.strength }, uAoPower: { value: this.ao.power }, tFogMask: { value: maskRT?.texture ?? this.fogMaskTarget.texture }, uFogMaskOn: { value: maskRT ? 1 : 0 }, uLayer: { value: 0 }, uLayerAlt: { value: 0 } },
      vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
      // Preserve all light, including emission at zero alpha. Resolve PNG coverage after readback.
      fragmentShader: `uniform sampler2D tScene;
uniform bool uTransparent;
uniform sampler2D tAo;
uniform float uAoOn;
uniform float uAoStrength;
uniform float uAoPower;
${FOG_GLSL}
${LOOK_GLSL}
${LAYER_GLSL}
varying vec2 vUv;
void main() {
  vec2 su = lookDistort(vUv);
  vec4 c = lookScene(tScene, vUv);
  if (uLayer > 0) { gl_FragColor = lookLayer(c, su, vUv); return; }
  vec3 rgb = c.rgb;
  float a = uTransparent ? clamp(c.a, 0.0, 1.0) : 1.0;
  if (uAoOn > 0.5) rgb *= mix(1.0, pow(texture2D(tAo, su).r, uAoPower), uAoStrength);
  // the fog lies over the picture: over a transparent background it becomes part of the picture's coverage
  vec3 fogOver;
  float f = fogLayers(su, fogOver) * (1.0 - fogFree(su));
  float outA = f + a * (1.0 - f);
  // Output colour over black; ordinary-alpha PNG coverage is resolved in display space.
  rgb = fogOver * (1.0 - fogFree(su)) + rgb * (1.0 - f);
  a = outA;
  // (the coverage is 0..1: a light that is brighter than white, a rim light or a glow, does not make the effects stronger)
  rgb = lookColor(rgb, vUv, clamp(max(a, max(rgb.r, max(rgb.g, rgb.b))), 0.0, 1.0));
  gl_FragColor = vec4(rgb, a);
  #include <colorspace_fragment>
  gl_FragColor.rgb += lookDither(vUv) * step(0.004, max(a, max(rgb.r, max(rgb.g, rgb.b))));
}`,
      depthTest: false,
      depthWrite: false,
      transparent: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    quad.frustumCulled = false;
    const quadScene = new THREE.Scene();
    quadScene.add(quad);
    const pixelsOut = new Uint8Array(w * h * 4);
    let capturePass: AoPass | null = null;
    let restoreVisibility: (() => void) | null = null;
    const rimCountWas = this.shared.uStudioRimCount.value as number;
    const exportLayers: ExportLayer[] = [];
    // WebGL rows run bottom to top
    const flipRows = (px: Uint8Array, width: number, height: number) => {
      const out = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y++) out.set(px.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4);
      return out;
    };
    try {
      this.renderLightShadows(true);
      this.updateParticleDepth(cam, w, h);
      // the picture behind the scene is the camera's own: it is in a shot of the camera, over the whole of it, and in no other picture
      this.cameras.backdrop.beginCapture(!!shot, w / h);
      // the reflection in the floor is part of a picture of the scene (not of a thumbnail or an icon), seen from the camera of the picture
      if (withLook && reflectionWas) this.reflection.render(r, this.scene, cam, w, h, this.reflectionHidden());
      else this.reflection.mesh.visible = false;
      // the picture the final pass reads: the scene, or the average of its moments (motion blur), blurred by the depth of field
      const mb = this.look.motionBlur;
      const drawPicture = (withMask: boolean): THREE.Texture => {
        r.setRenderTarget(sceneRT);
        let tex: THREE.Texture = sceneRT.texture;
        if (withLook && mb?.enabled && mb.shutter > 0 && mb.samples > 1) {
          captureMotion ??= new MotionAccumulator();
          tex = this.renderSubframes(() => { r.setRenderTarget(sceneRT); this.renderScene(r, cam); }, sceneRT.texture, mb.samples, mb.shutter, w, h, captureMotion);
        } else this.renderScene(r, cam);
        if (withMask && maskRT) this.renderFogMask(maskRT, cam);
        if (withLook && this.look.dof?.enabled && sceneRT.depthTexture) {
          captureDof ??= new DofPass();
          tex = captureDof.render(r, tex, sceneRT.depthTexture, cam, w, h, this.look.dof, this.dofFocusDistance(cam), this.charHeight);
        }
        return tex;
      };
      const sceneTex = drawPicture(true);
      material.uniforms.tScene.value = sceneTex;
      if (withLook && this.look.bloom?.enabled && this.look.bloom.intensity > 0) {
        captureBloom = new BloomPass();
        material.uniforms.tBloom.value = captureBloom.render(r, sceneTex, w, h, this.look.bloom);
      }
      if (this.ao.enabled && (!opts?.camera || opts.fullScene) && sceneRT.depthTexture) {
        capturePass = new AoPass();
        aoTexture = capturePass.render(r, sceneRT.depthTexture, cam as THREE.PerspectiveCamera, w, h, this.ao, this.charHeight);
        material.uniforms.tAo.value = aoTexture;
        material.uniforms.uAoOn.value = 1;
      }
      r.setRenderTarget(outRT);
      r.render(quadScene, this.presentCamera);
      r.readRenderTargetPixels(outRT, 0, 0, w, h, pixelsOut);
      if (opts?.layers && withLook) {
        // the layered export: the picture again, one layer at a time (the effects get uniforms of their own so that the live view keeps its)
        const own = createLookUniforms();
        Object.assign(material.uniforms, own);
        material.uniformsNeedUpdate = true;
        const aoWas = material.uniforms.uAoOn.value as number, fogWas = material.uniforms.uFogCount.value as number;
        for (const spec of planLayers(this.look, { ao: aoWas > 0.5, fog: fogWas > 0 })) {
          const scene = spec.shader === 0;
          applyLookUniforms(own, scene ? sceneOnlyLook(this.look) : this.look);
          material.uniforms.uLayer.value = spec.shader;
          material.uniforms.uLayerAlt.value = spec.alt ?? 0;
          material.uniforms.uAoOn.value = scene ? 0 : aoWas;
          material.uniforms.uFogCount.value = scene ? 0 : fogWas;
          r.setRenderTarget(outRT);
          r.render(quadScene, this.presentCamera);
          const px = new Uint8Array(w * h * 4);
          r.readRenderTargetPixels(outRT, 0, 0, w, h, px);
          if (scene && transparent) resolveCaptureEmission(px);
          exportLayers.push({ name: spec.name, blend: spec.blend, data: flipRows(px, w, h) });
        }
        if (rimCountWas > 0 && exportLayers.length) {
          // the fresnel rim lights are shading in the scene: each one is found as the difference between the picture with it and without it,
          // so the Scene layer becomes the picture with none of them and every light is a screen layer over it
          applyLookUniforms(own, sceneOnlyLook(this.look));
          material.uniforms.uLayer.value = 0;
          material.uniforms.uAoOn.value = 0;
          material.uniforms.uFogCount.value = 0;
          const stages: Uint8ClampedArray[] = [];
          for (let lights = 0; lights < rimCountWas; lights++) {
            this.shared.uStudioRimCount.value = lights;
            material.uniforms.tScene.value = drawPicture(false);
            r.setRenderTarget(outRT);
            r.render(quadScene, this.presentCamera);
            const px = new Uint8Array(w * h * 4);
            r.readRenderTargetPixels(outRT, 0, 0, w, h, px);
            if (transparent) resolveCaptureEmission(px);
            stages.push(flipRows(px, w, h));
          }
          stages.push(exportLayers[0].data);
          const rims = stages.slice(1).map((over, k): ExportLayer => ({ name: rimLayerName(k + 1, rimCountWas), blend: "screen", data: rimLayerPixels(stages[k], over) }));
          exportLayers[0].data = stages[0];
          exportLayers.splice(1, 0, ...rims);
        }
        if (!transparent && exportLayers.length) {
          // a picture with a background: the Scene layer is split into the background (the sky, the colour or the camera's picture), the ground
          // plane and the rest (the characters, their shadows and the reflection), each drawn on its own, so that they can be changed or left
          // out in Photoshop. The rim lights are left out of the last one: their layers are over it.
          applyLookUniforms(own, sceneOnlyLook(this.look));
          material.uniforms.uLayer.value = 0;
          material.uniforms.uAoOn.value = 0;
          material.uniforms.uFogCount.value = 0;
          this.shared.uStudioRimCount.value = 0;
          const backdrop = this.cameras.backdrop.mesh, ground = this.ground.mesh;
          const groundShows = ground.visible;
          /** Hides what is in the scene and not `keep` (the lights stay: the number of them is part of how the materials are made). */
          const only = (keep: (o: THREE.Object3D) => boolean) => {
            const was = this.scene.children.map((o) => [o, o.visible] as const);
            for (const o of this.scene.children) if (!(o as THREE.Light).isLight && !keep(o)) o.visible = false;
            restoreVisibility = () => { was.forEach(([o, visible]) => (o.visible = visible)); restoreVisibility = null; };
            return restoreVisibility;
          };
          const drawLayer = (empty: boolean): Uint8ClampedArray => {
            material.uniforms.tScene.value = drawPicture(false);
            material.uniforms.uTransparent.value = empty;
            r.setRenderTarget(outRT);
            r.render(quadScene, this.presentCamera);
            const px = new Uint8Array(w * h * 4);
            r.readRenderTargetPixels(outRT, 0, 0, w, h, px);
            if (empty) resolveCaptureEmission(px);
            return flipRows(px, w, h);
          };
          const full = exportLayers[0].data;
          const split: ExportLayer[] = [];
          // the pictures with a background: of the background alone, and with the ground plane over it
          let restore = only((o) => o === backdrop);
          const backPixels = drawLayer(false);
          restore();
          let under = backPixels;
          if (groundShows) {
            restore = only((o) => o === backdrop || o === ground);
            under = drawLayer(false);
            restore();
          }
          // and the layers over it, on a clear background: each with the alpha that gives the picture with it (see adaptAlpha)
          this.scene.background = null;
          r.setClearColor(0x000000, 0);
          split.push({ name: "Background", blend: "normal", data: backPixels });
          if (groundShows) {
            restore = only((o) => o === ground);
            const layer = drawLayer(true);
            restore();
            adaptAlpha(layer, backPixels, under);
            split.push({ name: "Ground plane", blend: "normal", data: layer });
          }
          restore = only((o) => o !== ground && o !== backdrop);
          const charPixels = drawLayer(true);
          restore();
          adaptAlpha(charPixels, under, full);
          split.push({ name: "Scene", blend: "normal", data: charPixels });
          this.scene.background = background;
          r.setClearColor(prevClear, prevAlpha);
          material.uniforms.uTransparent.value = false;
          exportLayers.splice(0, 1, ...split);
        }
      }
    } finally {
      if (opts?.orbit) { cam.position.copy(camPosition); cam.quaternion.copy(camQuaternion); cam.updateMatrixWorld(true); }
      (restoreVisibility as (() => void) | null)?.();
      this.shared.uStudioRimCount.value = rimCountWas;
      this.cameras.backdrop.endCapture();
      r.setRenderTarget(null);
      r.setClearColor(prevClear, prevAlpha);
      this.scene.background = background;
      hidden.forEach((o, i) => (o.visible = wasVisible[i]));
      this.lightingRenderer.invalidate();
      capturePass?.dispose();
      this.reflection.mesh.visible = reflectionWas;
      captureBloom?.dispose();
      // (both are made inside drawPicture, which the compiler does not follow)
      (captureDof as DofPass | null)?.dispose();
      (captureMotion as MotionAccumulator | null)?.dispose();
      sceneRT.dispose();
      sceneRT.depthTexture?.dispose();
      outRT.dispose();
      maskRT?.dispose();
      material.dispose();
      quad.geometry.dispose();
    }
    if (transparent) resolveCaptureEmission(pixelsOut);
    const flipped = flipRows(pixelsOut, w, h);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.putImageData(new ImageData(flipped, w, h), 0, 0);
    if (overlay) await this.cameraOverlay.composite(canvas.getContext("2d")!, overlay, w, h);
    if (opts?.canvas) return { blob: new Blob([]), width: w, height: h, canvas };
    if (opts?.layers) {
      // the layered export wants the merged picture and the pixels, not a PNG; what is drawn over the picture (the frame, the text, the images) is a layer too
      if (overlay) {
        const over = document.createElement("canvas");
        over.width = w;
        over.height = h;
        await this.cameraOverlay.composite(over.getContext("2d")!, overlay, w, h);
        exportLayers.push({ name: "Camera overlay", blend: "normal", data: over.getContext("2d")!.getImageData(0, 0, w, h).data });
      }
      return { blob: new Blob([]), width: w, height: h, layers: exportLayers, merged: canvas.getContext("2d")!.getImageData(0, 0, w, h).data };
    }
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encoding failed"))), "image/png"));
    return { blob, width: w, height: h };
  }

  /**
   * The backpack icon of what a character wears, 512x512 RGBA (top row first): seen from where the view is, with the view's own vertical
   * field of view (so it is the square the view's full height shows). The colours come from a picture over a black background, the alpha
   * from the coverage of a transparent picture of the same view.
   */
  async captureIcon(actor: Actor): Promise<Uint8Array> {
    const size = { w: 512, h: 512 };
    this.camera.updateMatrixWorld(true);
    const camera = new THREE.PerspectiveCamera(this.camera.fov, 1, this.camera.near, this.camera.far);
    camera.position.copy(this.camera.position);
    camera.quaternion.copy(this.camera.quaternion);
    camera.updateMatrixWorld(true);
    const color = await this.capture(1, false, { size, camera, only: actor });
    const mask = await this.capture(1, true, { size, camera, only: actor });
    const read = async (blob: Blob) => {
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 512;
      const g = canvas.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(bitmap, 0, 0);
      bitmap.close();
      return g.getImageData(0, 0, 512, 512).data;
    };
    const rgb = await read(color.blob), alpha = await read(mask.blob);
    const out = new Uint8Array(512 * 512 * 4);
    for (let i = 0; i < out.length; i += 4) {
      out[i] = rgb[i]; out[i + 1] = rgb[i + 1]; out[i + 2] = rgb[i + 2];
      out[i + 3] = alpha[i + 3];
    }
    return out;
  }

  /**
   * A small picture of one character as a WebP data URL (transparent background), for the pose library. `focus` frames a spot (a hand)
   * instead of the whole body; the view direction is the camera's own.
   */
  async thumbnail(actor: Actor, focus: { center: THREE.Vector3; radius: number } | null, width: number, height: number): Promise<string> {
    const cam = new THREE.PerspectiveCamera(this.camera.fov, width / height, 0.1, 5000);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const tan = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    let center: THREE.Vector3;
    let dist: number;
    if (focus) {
      center = focus.center;
      dist = (focus.radius / (tan * Math.min(1, cam.aspect))) * 1.1;
    } else {
      const box = actor.computeBounds(new THREE.Box3());
      const size = box.getSize(new THREE.Vector3());
      center = box.getCenter(new THREE.Vector3());
      const half = Math.max(size.x, size.z) / 2;
      dist = Math.max(size.y / 2 / tan, half / (tan * cam.aspect)) * 1.08 + half;
    }
    cam.position.copy(center).addScaledVector(dir, dist);
    cam.lookAt(center);
    cam.near = Math.max(0.1, dist / 100);
    cam.far = dist * 20;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    // drawn at twice the size and scaled down, which smooths the edges
    const { blob } = await this.capture(1, true, { size: { w: width * 2, h: height * 2 }, camera: cam, only: actor });
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext("2d")!;
    g.imageSmoothingQuality = "high";
    g.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    return canvas.toDataURL("image/webp", 0.72);
  }

  dispose() {
    this.lightGizmos.dispose();
    this.cameraOverlay.dispose();
    this.cameras.dispose();
    this.finishEntityModal(false);
    for (const control of [this.entityMove,this.entityRotate,this.entityScale,this.entityView,this.entityViewMove]) control.dispose();
    this.fpsCounter.remove();
    cancelAnimationFrame(this.raf);
    for (const actor of this.unusualEffects.keys()) this.clearUnusuals(actor);
    this.conditionParticles.dispose();
    for (const actor of [...this.dispenserScreens.keys()]) this.clearBuildingScreens(actor);
    for (const actor of new Set([...this.weaponEffects.keys(),...this.storedWeaponEffects.keys()])) this.clearWeaponEffects(actor);
    this.reactions?.reset();
    for (const a of this.actorList) a.dispose();
    for (const s of this.groundShadows) s.dispose();
    this.ground.dispose();
    this.lightingRenderer.dispose();
    this.reactions?.dispose();
    this.sceneTarget.dispose();
    this.particleDepthTarget?.depthTexture?.dispose();
    this.particleDepthTarget?.dispose();
    this.renderer.dispose();
  }
}

/** A flat colour that encodes a character's id (the red channel), for picking; skinned like the real materials. */
function makePickMaterial(id: number, slot: number): THREE.ShaderMaterial {
  return bodyMaskPass(new THREE.ShaderMaterial({
    uniforms: { uId: { value: id / 255 }, uSlot: { value: slot / 255 } },
    vertexShader: /* glsl */ `
      attribute float hideW;
      varying float vHideW;
      #include <skinning_pars_vertex>
      void main() {
        vHideW = hideW;
        #include <skinbase_vertex>
        vec3 transformed = vec3(position);
        #include <skinning_vertex>
        gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
      }`,
    fragmentShader: "uniform float uId; uniform float uSlot; varying float vHideW; void main() { if (vHideW > 0.5) discard; gl_FragColor = vec4(uId, uSlot, 0.0, 1.0); }",
    side: THREE.DoubleSide,
    blending: THREE.NoBlending,
  }));
}

/** The distance in pixels from a point to a segment. */
function distanceToSegment(px: number, py: number, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / length2));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}
