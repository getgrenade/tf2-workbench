import * as THREE from "three";
import { Playback, Rig, SOURCE_TO_VIEWER } from "./animator";
import { eyeFragmentShader } from "./eyeShader";
import { applyMeshFlexes, runFlexRules, type FlexGlobals } from "./flex";
import { GeometryCache, buildGeometry } from "./geometryCache";
import { gazeTargetLocal } from "./gaze";
import { JiggleBone } from "./jiggle";
import type { ClipData, EyeballData, MaterialData, MeshData, ModelData } from "./payload";
import { FINGERS, FINGER_AXIS, MAX_CURL, MIN_CURL, SPREAD_AXIS, boneNameOf, curlAngle, curlFromAngle, type Finger } from "./fingers";
import type { ScreenShape } from "./screenShapes";
import { packMask, unpackMask } from "./bodyRegions";
import { bodyClass, bodyGroups, hiddenBodyBits, legacyBodyGroups, materialBodyGroup, usesBodyAtlas, type BodyClass } from "./bodyGroups";
import { bodyMaskTexture } from "./bodyMasks";
import { PoseHistory, clonePose, poseToClip, sampleClip, type PoseData } from "./poseRig";
import type { Rgb } from "./proxies";
import { NO_CONDITIONS, anyCondition, materialEffects, type Conditions } from "./conditions";
import type { SourceMaterials } from "./sourceMaterials";

/** A mesh whose vertices follow the flex weights of the model it belongs to. */
interface FlexMesh {
  data: MeshData;
  owner: ModelData;
  position: THREE.BufferAttribute;
  normal: THREE.BufferAttribute;
}

/** A bonemerged model: its materials' paint and team skin, and optionally its own animation for the bones the class lacks. */
/** Flat translucent colours for the selection tint: red (would hide) and green (would come back), skinned like the meshes, drawn over everything. */
const tintMaterials = new Map<boolean, THREE.ShaderMaterial>();
function tintMaterial(show: boolean): THREE.ShaderMaterial {
  let material = tintMaterials.get(show);
  if (!material) {
    material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: show ? new THREE.Vector3(0.1, 0.9, 0.3) : new THREE.Vector3(1.0, 0.15, 0.2) } },
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
      fragmentShader: "uniform vec3 uColor; varying float vHideW; void main() { if (vHideW > 0.5) discard; gl_FragColor = vec4(uColor, 0.55); }",
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    material.userData.shared = true;
    tintMaterials.set(show, material);
  }
  return material;
}

/** A selection over the character's body in progress: a box, a lasso or a brush stroke (see {@link Actor.beginSelect}). */
export interface ViewSelection {
  /** Tints what the shape would hide red, or with `show` what it would bring back green (null: nothing). */
  preview(shape: ScreenShape | null, show?: boolean): void;
  /** Hides (or brings back) the triangles the shape touches, at once. */
  apply(shape: ScreenShape, hide: boolean): void;
  /** Takes the tint away. */
  clear(): void;
}

export interface CosmeticSpec {
  data: ModelData;
  paint: Rgb | null;
  skin: number;
  clip?: ClipData | null;
  /** The item this model belongs to (what a click on it picks). */
  itemId?: number;
  /** The weapon the character holds. */
  weapon?: boolean;
}

/** What an entity needs from the viewer it lives in. */
export interface ActorContext {
  scene: THREE.Scene;
  mats: SourceMaterials;
  geometry: GeometryCache;
  /** Whether jiggle bone physics runs (off: jiggle bones sit on their animated goal). */
  jiggle: () => boolean;
}

const _lp = new THREE.Vector3();
const _lq = new THREE.Quaternion();
const _lq2 = new THREE.Quaternion();
const _one = new THREE.Vector3(1, 1, 1);

/** Local transform of bone `b` at fractional frame `f` of a baked clip (positions lerped, rotations slerped). */
function ownLocal(clip: ClipData, f: number, b: number, out: THREE.Matrix4): THREE.Matrix4 {
  const nb = clip.numBones;
  const last = clip.frames - 1;
  const i0 = Math.min(Math.max(Math.floor(f), 0), last);
  const i1 = Math.min(i0 + 1, last);
  const s = f - i0;
  const a = (i0 * nb + b) * 3;
  const c = (i1 * nb + b) * 3;
  _lp.set(
    clip.pos[a] + (clip.pos[c] - clip.pos[a]) * s,
    clip.pos[a + 1] + (clip.pos[c + 1] - clip.pos[a + 1]) * s,
    clip.pos[a + 2] + (clip.pos[c + 2] - clip.pos[a + 2]) * s,
  );
  const qa = (i0 * nb + b) * 4;
  const qc = (i1 * nb + b) * 4;
  _lq.set(clip.quat[qa], clip.quat[qa + 1], clip.quat[qa + 2], clip.quat[qa + 3]);
  if (s > 0 && i1 !== i0) {
    _lq2.set(clip.quat[qc], clip.quat[qc + 1], clip.quat[qc + 2], clip.quat[qc + 3]);
    _lq.slerp(_lq2, s);
  }
  if (clip.scale) _one.set(clip.scale[a] + (clip.scale[c] - clip.scale[a]) * s, clip.scale[a+1] + (clip.scale[c+1] - clip.scale[a+1]) * s, clip.scale[a+2] + (clip.scale[c+2] - clip.scale[a+2]) * s);
  else _one.set(1,1,1);
  return out.compose(_lp, _lq, _one);
}

/**
 * The skin family of the zombie look (the Voodoo-Cursed souls) for a team. Every class model ends its skin table with the zombie
 * families (RED, BLU) and the zombie invulnerable ones (RED, BLU): the Soldier has 8 families (zombie at 4 and 5), the Spy 26
 * (his disguise skins come before them: zombie at 22 and 23). A model without them has no zombie look.
 */
export function zombieFamily(familyCount: number, team: number): number | null {
  return familyCount >= 6 ? familyCount - 4 + team : null;
}

// Scratch objects for the per-frame eye update.
const _eyeLocal = new THREE.Matrix4();
const _eyeAtt = new THREE.Matrix4();
const _eyeTarget = new THREE.Vector3();
const _eyeOrigin = new THREE.Vector3();
const _eyeUp = new THREE.Vector3();
const _eyeFwd = new THREE.Vector3();
const _eyeLeft = new THREE.Vector3();
const _lockCorrection = new THREE.Matrix4(), _lockInverse = new THREE.Matrix4();
const _cosLocal = new THREE.Matrix4();
const _rootRot = new THREE.Matrix4();
const _tilt = new THREE.Euler();
const _rootMove = new THREE.Matrix4();

/**
 * One character in the scene: a class model with its bonemerged cosmetics and weapon, an optional animated taunt prop, its own
 * pose, flexes and team skin. Several of them can live in one viewer, side by side; they share textures, materials of the same
 * VMT and paint, and the vertex buffers of the same model.
 */
export class Actor {
  readonly playback = new Playback();
  /** Placement of the character in the scene (viewer space). */
  readonly offset = new THREE.Vector3();
  /** Rotation about the vertical axis, in radians. */
  yaw = 0;
  /** The turn about the sideways axis and about the facing axis (radians), applied after the yaw: a rotation gizmo can tip a character over. Zero for an upright one. */
  pitch = 0;
  roll = 0;
  readonly scale = new THREE.Vector3(1, 1, 1);

  setScale(scale: THREE.Vector3) {
    this.scale.copy(scale).clampScalar(.01, 100);
    this.posedTime = NaN;
    this.poseBones();
    this.changed = true;
  }
  /** Set whenever something that shows in the picture changed; the viewer clears it (it decides when the shadow is redrawn). */
  changed = true;

  private modelGroup: THREE.Group | null = null;
  private classGroup: THREE.Group | null = null;
  private cosmeticGroup: THREE.Group | null = null;
  /** Where editor drawings that belong to the character's own space go (the compiler's jiggle bone helper); not part of any picture. */
  private helperGroup: THREE.Group | null = null;
  private classData: ModelData | null = null;
  private materials = new Map<string, MaterialData | null>();
  private bodygroups: Record<string, number> = {};
  /** The class model at a LOD other than 0 (see setClassLod). */
  private lodClass: ModelData | null = null;
  /** Player conditions that change the look (Jarate, Ubercharge, crit glow, fire); see conditions.ts. */
  conditions: Conditions = { ...NO_CONDITIONS };
  /** The invulnerability material of each team (RED, BLU), which replaces every material while the character is uber. */
  private uberData: [MaterialData | null, MaterialData | null] = [null, null];
  /** Team skin family: 0 RED, 1 BLU. Models without that family fall back to family 0. */
  private skin = 0;
  private cosmeticList: CosmeticSpec[] = [];
  private flexGlobals: FlexGlobals = new Map();
  private flexClass: FlexMesh[] = [];
  private flexCosmetic: FlexMesh[] = [];
  private cosmetics: { rig: Rig; bones: THREE.Bone[]; bindLocal: THREE.Matrix4[]; map: number[]; jiggles: (JiggleBone | null)[]; own: Playback | null }[] = [];
  private weaponBarrelAngle: number | null = null;
  /** A taunt prop with its own skeleton and animation (not bonemerged); it follows the class animation's clock. */
  private prop: { rig: Rig; bones: THREE.Bone[]; group: THREE.Group; playback: Playback } | null = null;
  /** Eye materials with their bind-pose constants; updated every frame from the posed bones. */
  private eyes: { material: THREE.ShaderMaterial; data: EyeballData }[] = [];
  private rig: Rig | null = null;
  private bones: THREE.Bone[] = [];
  private skeleton: THREE.Skeleton | null = null;
  private bindBounds = new THREE.Box3();
  /** The class's own meshes are hidden, leaving the cosmetics and the held weapon (their bones still follow the class's pose). */
  private inspectOnlyOn = false;
  /** Whether the gradient fog covers this character (off: it stays clear of it, in front of the fog). */
  fogged = true;
  /** The parts of the character that are shown (see bodyRegions.ts); the class meshes are not drawn at all when none is. */
  private shownRegions = new Set<string>(["*"]);
  private maskClass: BodyClass | null = null;
  private legacyRegions = false;
  /** Triangles hidden by hand, per class mesh (key: body part / model / mesh; one byte per triangle); text while still packed as loaded from a scene. */
  private handMask = new Map<string, Uint8Array | string>();
  private readonly gravitySource = new THREE.Vector3(0, 0, -1);
  private readonly gravityBind = new THREE.Vector3(0, -1, 0);
  /** The clip and time the bones were last posed for: a paused entity is not re-posed every frame. */
  private posedClip: ClipData | null = null;
  private posedTime = NaN;
  /** The editable one-frame pose while posing (the clip the character plays then); null otherwise. */
  private poseClip: ClipData | null = null;
  /** The pose posing started from (what "reset" goes back to). */
  private poseBase: PoseData | null = null;
  /** The one-frame clip a controller rewrites every frame in play mode; null otherwise. */
  private liveClip: ClipData | null = null;
  /** The pose left on the character when pose mode ended. */
  private heldClip: ClipData | null = null;
  private readonly poseHistory = new PoseHistory();

  constructor(
    readonly id: number,
    private readonly ctx: ActorContext,
  ) {}

  get hasModel(): boolean {
    return this.classData !== null;
  }

  /** The eyes' materials (focus target of the "Focus face" button). */
  get eyeMaterials(): THREE.ShaderMaterial[] {
    return this.eyes.map((e) => e.material);
  }

  /** Height of the bind pose, in viewer space (what the fog measures its heights in). */
  get bindHeight(): number {
    return this.bindBounds.isEmpty() ? 0 : (this.bindBounds.max.y - this.bindBounds.min.y) * this.scale.y;
  }

  /**
   * The bind pose of the models of the player (and their cosmetics) is stored in the viewer's own Y-up frame; that of a prop is in Source's, Z up, like
   * what an animation gives. A prop is turned into the viewer's frame whatever it is doing (see props/propList.ts).
   */
  sourceBind = false;

  /** The path of the model that was last shown (what a prop's collision is looked up by). */
  modelPath = "";

  /** The bounds of the shown model in its own frame, scaled: the box a prop's physics body has. */
  get modelBox(): THREE.Box3 {
    const box = this.bindBounds.clone();
    if (box.isEmpty()) return box;
    box.min.multiply(this.scale);
    box.max.multiply(this.scale);
    // a negative scale swaps the corners
    return new THREE.Box3(box.min.clone().min(box.max), box.min.clone().max(box.max));
  }

  /** Lowest point of the bind pose, in viewer space (the floor for the ground shadow). A prop does not set the floor: it stands on it. */
  get floorY(): number {
    if (this.sourceBind) return Infinity;
    return this.bindBounds.isEmpty() ? 0 : this.bindBounds.min.y * this.scale.y;
  }

  /** Lowest point of the model in its own frame (what puts a prop on the floor), 0 before there is a model. */
  get bindMinY(): number {
    return this.bindBounds.isEmpty() ? 0 : this.bindBounds.min.y * this.scale.y;
  }

  /** Places the character: position in viewer space and rotation about the vertical axis. */
  setPlacement(x: number, y: number, z: number, yaw: number) {
    this.offset.set(x, y, z);
    this.yaw = yaw;
    this.posedTime = NaN; // the root matrix changes
    this.poseBones();
    this.changed = true;
  }

  /** Tips the character: pitch about its sideways axis, roll about its facing axis (the rotation is yaw, then pitch, then roll: three's "YXZ"). */
  setTilt(pitch: number, roll: number) {
    this.pitch = pitch;
    this.roll = roll;
    this.posedTime = NaN; // the root matrix changes
    this.poseBones();
    this.changed = true;
  }

  /** The root matrix: the placement, and for animated poses (Source space, z up) the conversion to viewer space. */
  private rootMatrix(out: THREE.Matrix4, animated: boolean): THREE.Matrix4 {
    if (animated) out.copy(SOURCE_TO_VIEWER);
    else out.identity();
    out.premultiply(_rootRot.makeScale(this.scale.x, this.scale.y, this.scale.z));
    if (this.yaw !== 0 || this.pitch !== 0 || this.roll !== 0) out.premultiply(_rootRot.makeRotationFromEuler(_tilt.set(this.pitch, this.yaw, this.roll, "YXZ")));
    out.premultiply(_rootMove.makeTranslation(this.offset.x, this.offset.y, this.offset.z));
    return out;
  }

  /**
   * Shows the default bodygroup (model 0 of every body part). `materials` maps
   * material path to its loaded data; missing/failed ones render flat gray.
   */
  setModel(data: ModelData, materials: Map<string, MaterialData | null>) {
    const allShown = !this.partsHidden;
    const previousClass = this.maskClass;
    this.modelPath = data.path;
    this.clear();
    // Skeleton: bone matrices are written every frame from the rig (Source space); the inverse bind
    // matrices are the MDL poseToBone matrices, so skinning is exactly boneToWorld * poseToBone.
    this.classData = data;
    this.lodClass = null; // a LOD belongs to the model it was read from; the viewer asks for it again
    this.materials = materials;
    // Materials are a viewer-wide cache containing every class loaded so far.
    this.maskClass = bodyClass(data.path);
    if (this.maskClass) {
      if (allShown || (previousClass && previousClass !== this.maskClass)) this.shownRegions = new Set(bodyGroups(this.maskClass).map(g => g.id));
      else if (this.legacyRegions) this.shownRegions = new Set(legacyBodyGroups(this.maskClass, this.shownRegions));
      else this.shownRegions = new Set([...this.shownRegions].filter(id => this.bodyGroups.some(g => g.id === id)));
      this.legacyRegions = false;
    }
    this.bodygroups = {};
    this.cosmetics = [];
    this.cosmeticList = [];
    this.flexCosmetic = [];
    this.rig = new Rig(data.bones);
    // A clip belongs to one skeleton; drop the previous model's until the new one is baked.
    this.playback.clip = null;
    this.playback.time = 0;
    this.bones = data.bones.map(() => {
      const b = new THREE.Bone();
      b.matrixAutoUpdate = false;
      b.matrixWorldAutoUpdate = false;
      return b;
    });
    this.skeleton = new THREE.Skeleton(this.bones, this.rig.poseToBone);

    this.modelGroup = new THREE.Group();
    this.modelGroup.matrixAutoUpdate = false;
    this.classGroup = new THREE.Group();
    this.cosmeticGroup = new THREE.Group();
    this.helperGroup = new THREE.Group();
    this.modelGroup.add(this.classGroup, this.cosmeticGroup, this.helperGroup);
    this.ctx.scene.add(this.modelGroup);
    this.modelGroup.visible = !(this.reactionHidden || this.listHidden);
    this.bindBounds.makeEmpty();
    this.buildClassMeshes();
    this.posedTime = NaN;
    this.poseBones();
    this.changed = true;
  }

  get inspectOnly(): boolean {
    return this.inspectOnlyOn;
  }

  /** Marks a character that is an item shown alone (the camera frames the item, the reference pose is kept); which parts of the character show is separate. */
  setInspectOnly(on: boolean) {
    this.inspectOnlyOn = on;
  }

  /** The parts of the character that are shown. */
  get visibleRegions(): ReadonlySet<string> {
    return this.shownRegions;
  }

  /** Whether some part of the character is hidden. */
  get partsHidden(): boolean {
    return !this.shownRegions.has("*") && (!this.maskClass || this.bodyGroups.some(g => !this.shownRegions.has(g.id)));
  }

  get bodyGroups() { return this.maskClass ? bodyGroups(this.maskClass) : []; }

  setVisibleRegions(parts: Iterable<string>, legacy = false) {
    // Older authored selections may still contain the retired standalone eyes group.
    this.shownRegions = new Set([...parts].filter(id => id !== "eyes"));
    this.legacyRegions = legacy;
    if (legacy && this.maskClass) {
      this.shownRegions = new Set(legacyBodyGroups(this.maskClass, this.shownRegions));
      this.legacyRegions = false;
    }
    this.buildClassMeshes();
  }

  /** The by-hand mask of a mesh (unpacked on first use), or null when it has none (`create` makes an empty one). */
  private maskFor(key: string, count: number, create: boolean): Uint8Array | null {
    let mask = this.handMask.get(key);
    if (typeof mask === "string") {
      mask = unpackMask(mask, count);
      this.handMask.set(key, mask);
    }
    if (!mask && create) {
      mask = new Uint8Array(count);
      this.handMask.set(key, mask);
    }
    return mask ?? null;
  }

  /** Manual hiding still operates on triangles; authored groups are masked in the material's UV space. */
  private maskMesh(mesh: THREE.SkinnedMesh) {
    this.refreshHand(mesh);
  }

  /**
   * Leaves out the triangles hidden by hand, so what is hidden follows the model's own triangles exactly. The mesh draws through an index
   * of its own, rewritten in place (with a shorter draw range) when the mask changes.
   */
  private refreshHand(mesh: THREE.SkinnedMesh) {
    const m = mesh.userData.meshData as MeshData | undefined;
    const key = mesh.userData.maskKey as string | undefined;
    if (!m || !key) return;
    const src = m.indices;
    const mask = this.maskFor(key, src.length / 3, false);
    let index = mesh.userData.handIndex as THREE.BufferAttribute | undefined;
    if (!index) {
      if (!mask || !mask.some((x) => x)) return;
      index = new THREE.BufferAttribute(Uint32Array.from(src), 1);
      this.ownGeometry(mesh).setIndex(index);
      mesh.userData.handIndex = index;
    }
    const out = index.array as Uint32Array;
    let n = 0;
    for (let t = 0; t < src.length / 3; t++) {
      if (mask && mask[t]) continue;
      out[n++] = src[t * 3];
      out[n++] = src[t * 3 + 1];
      out[n++] = src[t * 3 + 2];
    }
    this.ownGeometry(mesh).setDrawRange(0, n);
    index.needsUpdate = true;
    this.changed = true;
  }

  /** The mesh's geometry, made its own first when it is shared with other characters (so that it can carry attributes of its own). */
  private ownGeometry(mesh: THREE.SkinnedMesh): THREE.BufferGeometry {
    if (mesh.userData.sharedMesh && !mesh.userData.ownGeometry) {
      const own = new THREE.BufferGeometry();
      for (const [name, attribute] of Object.entries(mesh.geometry.attributes)) own.setAttribute(name, attribute);
      own.setIndex(mesh.geometry.index);
      mesh.geometry = own;
      mesh.userData.ownGeometry = true;
    }
    return mesh.geometry;
  }

  /** Whether any triangle is hidden by hand. */
  get hasHandMask(): boolean {
    return [...this.handMask.values()].some((v) => typeof v === "string" || v.some((x) => x));
  }

  /** The hand-hidden triangles as text per mesh, for a scene file (undefined when there are none). */
  get handMaskState(): Record<string, string> | undefined {
    const out: Record<string, string> = {};
    for (const [key, v] of this.handMask) {
      if (typeof v === "string") out[key] = v;
      else if (v.some((x) => x)) out[key] = packMask(v);
    }
    return Object.keys(out).length ? out : undefined;
  }

  setHandMaskState(state: Record<string, string> | undefined) {
    this.handMask = new Map(Object.entries(state ?? {}));
    this.buildClassMeshes();
  }

  /**
   * Starts a selection over the view: where every vertex of the class meshes is on screen right now (`toScreen` gives the client
   * pixels of a vertex in viewer space, false when it is out of view), kept for the whole stroke so that what the tint shows is exactly
   * what is hidden afterwards. A shape picks the triangles it touches that face the camera (all of them for a two-sided material); the
   * tint is drawn over everything, cosmetics included, red for the triangles that would be hidden and green for the ones that would return.
   */
  beginSelect(toScreen: (p: THREE.Vector3, out: { x: number; y: number }) => boolean): ViewSelection | null {
    if (!this.classData || !this.classGroup || !this.skeleton) return null;
    this.modelGroup?.updateMatrixWorld(true);
    this.skeleton.update();
    const p = new THREE.Vector3();
    const at = { x: 0, y: 0 };
    interface Part {
      mesh: THREE.SkinnedMesh;
      m: MeshData;
      key: string;
      tris: number;
      xy: Float32Array;
      /** 1 for a triangle that faces the camera (or whose material is drawn on both sides). */
      front: Uint8Array;
      picked: Uint8Array;
      preview: { mesh: THREE.SkinnedMesh; index: THREE.BufferAttribute; sign: number } | null;
    }
    const parts: Part[] = [];
    const meshes: THREE.SkinnedMesh[] = [];
    this.classGroup.traverse((o) => {
      if (o instanceof THREE.SkinnedMesh && !o.userData.preview) meshes.push(o);
    });
    for (const o of meshes) {
      const m = o.userData.meshData as MeshData | undefined;
      const key = o.userData.maskKey as string | undefined;
      if (!m || !key) continue;
      const n = m.positions.length / 3;
      const xy = new Float32Array(n * 2).fill(NaN);
      for (let i = 0; i < n; i++) {
        o.getVertexPosition(i, p).applyMatrix4(o.matrixWorld);
        if (toScreen(p, at)) {
          xy[i * 2] = at.x;
          xy[i * 2 + 1] = at.y;
        }
      }
      // which triangles the graphics card would draw: counter-clockwise on screen (clockwise for a mirrored model), per the material's side
      const side = (o.material as THREE.Material).side;
      const mirrored = o.matrixWorld.determinant() < 0;
      const tris = m.indices.length / 3;
      const front = new Uint8Array(tris);
      for (let t = 0; t < tris; t++) {
        const i = m.indices[t * 3], j = m.indices[t * 3 + 1], k = m.indices[t * 3 + 2];
        const area = (xy[j * 2] - xy[i * 2]) * (xy[k * 2 + 1] - xy[i * 2 + 1]) - (xy[j * 2 + 1] - xy[i * 2 + 1]) * (xy[k * 2] - xy[i * 2]);
        if (side === THREE.DoubleSide) front[t] = 1;
        else {
          const ccwOnScreen = area < 0; // client pixels run downwards
          front[t] = (side === THREE.BackSide ? !ccwOnScreen : ccwOnScreen) !== mirrored ? 1 : 0;
        }
      }
      parts.push({ mesh: o, m, key, tris, xy, front, picked: new Uint8Array(tris), preview: null });
    }
    /** Marks the triangles of every mesh that the shape touches. */
    const pick = (shape: ScreenShape) => {
      for (const part of parts) {
        const idx = part.m.indices, xy = part.xy;
        for (let t = 0; t < part.tris; t++) {
          const i = idx[t * 3] * 2, j = idx[t * 3 + 1] * 2, k = idx[t * 3 + 2] * 2;
          part.picked[t] = part.front[t] && xy[i] === xy[i] && xy[j] === xy[j] && xy[k] === xy[k] && shape.hits(xy[i], xy[i + 1], xy[j], xy[j + 1], xy[k], xy[k + 1]) ? 1 : 0;
        }
      }
    };
    const previewOf = (part: Part) => {
      if (part.preview) return part.preview;
      const geometry = new THREE.BufferGeometry();
      for (const [name, attribute] of Object.entries(part.mesh.geometry.attributes)) geometry.setAttribute(name, attribute);
      const index = new THREE.BufferAttribute(new Uint32Array(part.m.indices.length), 1);
      geometry.setIndex(index);
      const mesh = new THREE.SkinnedMesh(geometry, tintMaterial(false));
      mesh.userData.preview = true;
      mesh.bindMode = THREE.DetachedBindMode;
      mesh.bind(this.skeleton!, new THREE.Matrix4());
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = 100;
      this.classGroup?.add(mesh);
      part.preview = { mesh, index, sign: 1 };
      return part.preview;
    };
    const removePreviews = () => {
      for (const part of parts) {
        if (!part.preview) continue;
        this.classGroup?.remove(part.preview.mesh);
        part.preview.mesh.geometry.dispose();
        part.preview = null;
      }
      this.changed = true;
    };
    const setPreview = (shape: ScreenShape | null, show = false) => {
      if (!shape) {
        removePreviews();
        return;
      }
      pick(shape);
      for (const part of parts) {
        const mask = this.maskFor(part.key, part.tris, false);
        const pv = previewOf(part);
        const out = pv.index.array as Uint32Array;
        const src = part.m.indices;
        let n = 0;
        for (let t = 0; t < part.tris; t++) {
          // red: picked and visible; green: picked and hidden by hand (drawn although it is hidden)
          if (!part.picked[t] || (mask && mask[t] === 1) !== show) continue;
          out[n++] = src[t * 3];
          out[n++] = src[t * 3 + 1];
          out[n++] = src[t * 3 + 2];
        }
        pv.mesh.geometry.setDrawRange(0, n);
        pv.index.needsUpdate = true;
        if ((pv.sign > 0) === show) {
          pv.mesh.material = tintMaterial(show);
          pv.sign = show ? -1 : 1;
        }
      }
      this.changed = true;
    };
    return {
      preview: setPreview,
      clear: removePreviews,
      apply: (shape, hide) => {
        pick(shape);
        const value = hide ? 1 : 0;
        for (const part of parts) {
          const mask = this.maskFor(part.key, part.tris, true)!;
          let changed = false;
          for (let t = 0; t < part.tris; t++) {
            if (part.picked[t] && mask[t] !== value) {
              mask[t] = value;
              changed = true;
            }
          }
          if (changed) this.refreshHand(part.mesh);
        }
      },
    };
  }

  /** Removes the entity's objects from the scene and frees what only it used. */
  clear() {
    if (this.modelGroup) {
      this.ctx.scene.remove(this.modelGroup);
      this.disposeObject(this.modelGroup);
      this.modelGroup = this.classGroup = this.cosmeticGroup = this.helperGroup = null;
    }
    if (this.prop) {
      this.ctx.scene.remove(this.prop.group);
      this.disposeObject(this.prop.group);
      this.prop = null;
    }
    this.classData = null;
    this.rig = null;
    this.eyes = [];
    this.flexClass = [];
    this.flexCosmetic = [];
    this.cosmetics = [];
    this.changed = true;
  }

  dispose() {
    this.clear();
  }

  private disposeObject(root: THREE.Object3D) {
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const shared = o.userData.sharedMesh as MeshData | undefined;
      if (shared) this.ctx.geometry.release(shared);
      if (!shared || o.userData.ownGeometry) o.geometry.dispose();
      const mat = o.material as THREE.Material;
      if (!mat.userData.shared) {
        mat.dispose(); // textures stay cached
        mat.userData.disposed = true;
      }
    });
  }

  /** A skinned mesh for one MDL mesh, skinned by `skeleton` in Source space (the group matrix converts to the viewer). */
  private makeSkinnedMesh(m: MeshData, material: THREE.ShaderMaterial, skeleton: THREE.Skeleton, owner: ModelData, flexList: FlexMesh[]): THREE.SkinnedMesh {
    let geo: THREE.BufferGeometry;
    const flexed = m.flexes.length > 0;
    if (flexed) {
      // Flexed meshes get their own writable copies; the payload arrays stay the bind pose.
      const built = buildGeometry(m, true);
      geo = built.geo;
      flexList.push({ data: m, owner, position: built.position, normal: built.normal });
    } else {
      geo = this.ctx.geometry.acquire(m);
    }
    markDetachedParts(geo, m, owner.bones.map((b) => b.name));
    const mesh = new THREE.SkinnedMesh(geo, material);
    if (!flexed) mesh.userData.sharedMesh = m;
    // Detached: skinning stays in bone-world (Source) space and the group matrix converts it to the
    // viewer; the default "attached" mode would cancel the group transform.
    mesh.bindMode = THREE.DetachedBindMode;
    mesh.bind(skeleton, new THREE.Matrix4());
    mesh.frustumCulled = false; // the bind-pose bounds do not follow the animation
    mesh.matrixAutoUpdate = false; // always the identity: the group carries the transform
    return mesh;
  }

  /** Model index to show for a body part: the loadout's bodygroup override, else the default (0). */
  private bodygroupIndex(name: string, count: number): number {
    const v = this.bodygroups[name.toLowerCase()];
    return v !== undefined && v >= 0 && v < count ? v : 0;
  }

  /** The material path of a mesh in the current team skin (families a model lacks fall back to RED). */
  private skinMaterial(m: MeshData): string {
    const family = this.zombie ? zombieFamily(m.materials.length, this.skin) ?? this.skin : this.skin;
    return m.materials[family] ?? m.materials[this.skin] ?? m.material;
  }

  /**
   * Shows the class at one of its LODs: `lod` is the same model read at that LOD (its own meshes, the bones collapsed onto their
   * parents and the facial flexes dropped as the QC's `$lod` blocks say), or null for the full model. Bones, flex rules and the
   * rest stay those of the model itself.
   */
  setClassLod(lod: ModelData | null) {
    this.lodClass = lod;
    this.buildClassMeshes();
  }

  /** (Re)builds the class meshes for the current bodygroup selection. */
  private buildClassMeshes() {
    const data = this.classData;
    if (!data || !this.classGroup || !this.skeleton) return;
    const source = this.lodClass && this.lodClass.bodyParts.length === data.bodyParts.length ? this.lodClass : data;
    for (const child of [...this.classGroup.children]) {
      this.classGroup.remove(child);
      this.disposeObject(child);
    }
    this.eyes = [];
    this.flexClass = [];
    const p = new THREE.Vector3();
    for (const bp of source.bodyParts) {
      const modelIndex = this.bodygroupIndex(bp.name, bp.models.length);
      const sub = bp.models[modelIndex];
      if (!sub) continue;
      for (const [meshIndex, m] of sub.meshes.entries()) {
        if (m.indices.length === 0) continue;
        for (let i = 0; i < m.positions.length; i += 3) {
          p.set(m.positions[i], m.positions[i + 1], m.positions[i + 2]);
          if (this.sourceBind) p.applyMatrix4(SOURCE_TO_VIEWER);
          this.bindBounds.expandByPoint(p);
        }
        const eye = sub.eyeballs.find((e) => e.material === m.material);
        const path = this.skinMaterial(m);
        let material = this.ctx.mats.material(this.materials.get(path) ?? null, eye);
        if (this.maskClass && usesBodyAtlas(path)) {
          const bits = hiddenBodyBits(this.maskClass, this.shownRegions);
          if (bits) {
            const base = material;
            material = base.clone();
            // Keep lighting and animated material proxies shared, but visibility belongs to this actor.
            material.uniforms = { ...base.uniforms, tBodyMask: { value: bodyMaskTexture(this.maskClass) }, uBodyHideBits: { value: bits } };
            material.userData.shared = false;
          }
        }
        if (eye && material.fragmentShader === eyeFragmentShader) this.eyes.push({ material, data: eye });
        const mesh = this.makeSkinnedMesh(m, material, this.skeleton, data, this.flexClass);
        // what the condition materials are made from (a body mask or an eyeball has a material of its own, which they leave alone)
        if (!eye && material.userData.shared) mesh.userData.source = { data: this.materials.get(path) ?? null, paint: null };
        if (material.uniforms.uBodyHideBits?.value) mesh.userData.bodyMask = { texture: material.uniforms.tBodyMask.value, bits: material.uniforms.uBodyHideBits.value };
        const group = materialBodyGroup(path);
        if (group) mesh.visible = this.shownRegions.has(group);
        mesh.userData.meshData = m;
        mesh.userData.maskKey = `${bp.name}/${modelIndex}/${meshIndex}`;
        this.maskMesh(mesh);
        this.classGroup.add(mesh);
      }
    }
    this.classGroup.visible = this.shownRegions.size > 0;
    this.updateFlexes();
    this.updateEyes();
    if (anyCondition(this.conditions)) this.applyConditions();
    this.changed = true;
  }

  /** Switches the conditions that change the character's look: the Jarate yellow, the crit glow, and the Ubercharge material over everything. */
  setConditions(next: Readonly<Conditions>) {
    if (Object.keys(next).every((k) => next[k as keyof Conditions] === this.conditions[k as keyof Conditions])) return;
    this.conditions = { ...next };
    this.applyConditions();
  }

  /** Whether the Ubercharge material of the current team is still to be loaded (see {@link setUberMaterials}). */
  get needsUberMaterial(): boolean {
    return this.conditions.uber && !this.uberData[this.skin === 1 ? 1 : 0];
  }

  setUberMaterials(red: MaterialData | null, blue: MaterialData | null) {
    this.uberData = [red, blue];
    this.applyConditions();
  }

  /** Gives every mesh the material for the current conditions: its own with the player proxies' values, or the Ubercharge one. */
  private applyConditions() {
    const fx = materialEffects(this.conditions, this.skin);
    const uberData = this.conditions.uber ? this.uberData[this.skin === 1 ? 1 : 0] : null;
    const uber = uberData ? this.ctx.mats.material(uberData, undefined, null, { invuln: 1 }) : null;
    for (const group of [this.classGroup, this.cosmeticGroup]) {
      group?.traverse((o) => {
        if (!(o instanceof THREE.SkinnedMesh)) return;
        const source = o.userData.source as { data: MaterialData | null; paint: Rgb | null } | undefined;
        if (!source) return;
        const next = uber ?? this.ctx.mats.material(source.data, undefined, source.paint, fx);
        if (o.material !== next) o.material = next;
      });
    }
    this.changed = true;
  }

  /**
   * Sets which model each class body part shows, by body part name (e.g. `{ hat: 1 }` hides the
   * Soldier's helmet). Unlisted body parts show their default model.
   */
  setBodygroups(groups: Record<string, number>) {
    const next = Object.fromEntries(Object.entries(groups).map(([k, v]) => [k.toLowerCase(), v]));
    // A loadout reapplied unchanged would rebuild every class mesh for nothing.
    const a = JSON.stringify(Object.entries(this.bodygroups).sort());
    const b = JSON.stringify(Object.entries(next).sort());
    this.bodygroups = next;
    if (a !== b) this.buildClassMeshes();
  }

  /** The weapon in the character's hand (its item and model path), or null. */
  get heldWeapon(): { itemId: number; path: string } | null {
    const held = this.cosmeticList.find((c) => c.weapon && c.itemId !== undefined);
    return held ? { itemId: held.itemId!, path: held.data.path } : null;
  }

  /**
   * Bonemerges cosmetics onto the class skeleton: every cosmetic bone with the name of a class bone
   * follows that bone's current transform; extra bones follow their parent with their bind offset.
   */
  /**
   * A weapon that hangs on one hand's bone but is carried in the other (the bow's `weapon_bone` is a child of the right hand, and the animations
   * place it in the left): the bones named in `follow` stay where they were relative to `hand` when the lock began. The blend between two animations
   * (and between a gesture and the movement) mixes the two hands' own transforms separately, which would let the bow slide off the hand for a moment.
   */
  private handLock: { key: string; hand: number; root: number; follow: Set<number>; offset: THREE.Matrix4 | null; since: number } | null = null;
  setHandLock(lock: { hand: string; root: string; follow: string[] } | null) {
    if (!lock) { this.handLock = null; return; }
    const key = `${lock.hand}|${lock.root}|${lock.follow.join(",")}`;
    if (this.handLock?.key === key) return;
    const names = this.boneNames.map((n) => n.toLowerCase());
    const hand = names.indexOf(lock.hand.toLowerCase()), root = names.indexOf(lock.root.toLowerCase());
    if (hand < 0 || root < 0) { this.handLock = null; return; }
    this.handLock = { key, hand, root, follow: new Set(lock.follow.map((n) => names.indexOf(n.toLowerCase())).filter((i) => i >= 0)), offset: null, since: performance.now() };
  }

  /** A thrown or eaten weapon is not in the hand until it is back: the held weapon's meshes are hidden (and come back with false). */
  private heldHidden = false;
  /** Which model of the held weapon's first body group is drawn (a Sandvich's bites: 1 is the bitten one, CTFLunchBox::SwitchBodyGroups). */
  private heldBodyState = 0;
  setHeldBodyState(state: number) {
    if (this.heldBodyState === state) return;
    this.heldBodyState = state;
    if (this.cosmeticList.some((c) => c.weapon)) this.setCosmetics(this.cosmeticList);
  }
  setHeldHidden(hidden: boolean) {
    if (this.heldHidden === hidden) return;
    this.heldHidden = hidden;
    this.applyHeldHidden();
    this.changed = true;
  }
  private applyHeldHidden() {
    if (!this.cosmeticGroup) return;
    for (const child of this.cosmeticGroup.children) {
      const slot = child.userData.cosmeticSlot as number | undefined;
      if (slot && this.cosmeticList[slot - 1]?.weapon) child.visible = !this.heldHidden;
    }
  }

  setCosmetics(list: CosmeticSpec[]) {
    if (!this.cosmeticGroup || !this.classData) return;
    for (const child of [...this.cosmeticGroup.children]) {
      this.cosmeticGroup.remove(child);
      this.disposeObject(child);
    }
    this.cosmetics = [];
    this.flexCosmetic = [];
    this.cosmeticList = list;
    const classIndex = new Map(this.classData.bones.map((b, i) => [b.name.toLowerCase(), i]));
    for (const [index, { data, paint, skin, clip }] of list.entries()) {
      const rig = new Rig(data.bones);
      const bones = data.bones.map((info) => {
        const b = new THREE.Bone();
        b.name = info.name;
        b.matrixAutoUpdate = false;
        b.matrixWorldAutoUpdate = false;
        return b;
      });
      const skeleton = new THREE.Skeleton(bones, rig.poseToBone);
      const bindLocal = rig.bindWorld.map((w, i) => {
        const p = rig.parents[i];
        return p < 0 ? w.clone() : rig.bindWorld[p].clone().invert().multiply(w);
      });
      const map = data.bones.map((b) => classIndex.get(b.name.toLowerCase()) ?? -1);
      // Jiggle bones that are not merged into the class skeleton are simulated; merged ones follow the class bone.
      const jiggles = data.bones.map((b, i) => (b.jiggle && map[i] < 0 ? new JiggleBone(b.jiggle) : null));
      let own: Playback | null = null;
      if (clip) {
        own = new Playback();
        own.clip = clip;
      }
      this.cosmetics.push({ rig, bones, bindLocal, map, jiggles, own });
      for (const [partIndex, bp] of data.bodyParts.entries()) {
        const sub = (list[index].weapon && partIndex === 0 ? bp.models[this.heldBodyState] : null) ?? bp.models[0];
        if (!sub) continue;
        for (const m of sub.meshes) {
          if (m.indices.length === 0) continue;
          const material = this.ctx.mats.material(this.materials.get(m.materials[skin] ?? m.material) ?? null, undefined, paint);
          const mesh = this.makeSkinnedMesh(m, material, skeleton, data, this.flexCosmetic);
          mesh.userData.source = { data: this.materials.get(m.materials[skin] ?? m.material) ?? null, paint };
          mesh.userData.cosmeticSlot = index + 1; // 1.. in the order of the list; 0 / unset is the class's own mesh
          this.cosmeticGroup.add(mesh);
        }
      }
    }
    this.updateFlexes();
    this.posedTime = NaN;
    this.updateCosmetics();
    if (this.heldHidden) this.applyHeldHidden();
    if (anyCondition(this.conditions)) this.applyConditions();
    this.changed = true;
  }

  /**
   * Shows a taunt prop as its own animated entity at the origin (the engine spawns it as a separate `tf_taunt_prop`), or removes
   * it with null. `clip` is the prop's baked animation; without one the prop stays in its bind pose. The prop's clock is the class
   * animation's, so both start and loop together.
   */
  setProp(prop: { data: ModelData; skin: number; clip: ClipData | null } | null) {
    if (this.prop) {
      this.ctx.scene.remove(this.prop.group);
      this.disposeObject(this.prop.group);
      this.prop = null;
    }
    if (!prop) {
      this.changed = true;
      return;
    }
    const { data, skin, clip } = prop;
    const rig = new Rig(data.bones);
    const bones = data.bones.map(() => {
      const b = new THREE.Bone();
      b.matrixAutoUpdate = false;
      b.matrixWorldAutoUpdate = false;
      return b;
    });
    const skeleton = new THREE.Skeleton(bones, rig.poseToBone);
    const group = new THREE.Group();
    group.matrixAutoUpdate = false;
    for (const bp of data.bodyParts) {
      const sub = bp.models[0];
      if (!sub) continue;
      for (const m of sub.meshes) {
        if (m.indices.length === 0) continue;
        const material = this.ctx.mats.material(this.materials.get(m.materials[skin] ?? m.material) ?? null, undefined, null);
        group.add(this.makeSkinnedMesh(m, material, skeleton, data, []));
      }
    }
    this.ctx.scene.add(group);
    const playback = new Playback();
    playback.clip = clip;
    this.prop = { rig, bones, group, playback };
    group.visible = !(this.reactionHidden || this.listHidden);
    this.poseProp();
    this.changed = true;
  }

  /** Poses the prop for the class animation's current time. */
  private poseProp() {
    const p = this.prop;
    if (!p) return;
    const pb = this.playback;
    p.playback.time = pb.time;
    p.playback.loopAll = pb.loopAll;
    if (p.playback.clip) {
      p.rig.poseFromClip(p.playback.clip, p.playback.frame());
      this.rootMatrix(p.group.matrix, true);
    } else {
      p.rig.setBindPose();
      this.rootMatrix(p.group.matrix, false); // the bind pose is already in viewer space
    }
    p.group.matrixWorldNeedsUpdate = true;
    const world = p.rig.boneWorld;
    for (let i = 0; i < world.length; i++) p.bones[i].matrixWorld.copy(world[i]);
  }

  /** Whether the class model is drawn in its zombie skin family (the Voodoo-Cursed souls): the team's family + 4. */
  private zombie = false;

  /**
   * The Voodoo-Cursed souls set the player's skin override: the class model is drawn with the zombie families of its skin table
   * (see zombieFamily). The materials of the family must already be in the material map.
   */
  setZombieSkin(on: boolean) {
    if (on === this.zombie) return;
    this.zombie = on;
    this.buildClassMeshes();
  }

  /** Switches the team skin (0 RED, 1 BLU). The materials for it must already be in the material map. */
  setSkin(skin: number) {
    if (skin === this.skin) return;
    this.skin = skin;
    this.buildClassMeshes();
    if (this.cosmeticList.length) this.setCosmetics(this.cosmeticList);
  }

  /**
   * Sets the flex controllers by name (real values, case-insensitive keys) and re-poses every flexed mesh.
   * Cosmetics read the controllers that share a name with the class model's, like the engine's bonemerged items.
   */
  setFlexControllers(globals: FlexGlobals) {
    this.flexGlobals = globals;
    this.updateFlexes();
    this.updateEyes();
    this.changed = true;
  }

  private updateFlexes() {
    if (this.flexClass.length === 0 && this.flexCosmetic.length === 0) return;
    const weights = new Map<ModelData, Float32Array>();
    for (const fm of [...this.flexClass, ...this.flexCosmetic]) {
      let w = weights.get(fm.owner);
      if (!w) {
        w = runFlexRules(fm.owner, this.flexGlobals);
        weights.set(fm.owner, w);
      }
      applyMeshFlexes(fm.data, w, fm.position.array as Float32Array, fm.normal.array as Float32Array);
      fm.position.needsUpdate = true;
      fm.normal.needsUpdate = true;
    }
  }

  // --- posing ---------------------------------------------------------------------------------------------

  /** Whether the character holds an editable pose (and not an animation). */
  get isPosing(): boolean {
    return this.poseClip !== null && this.playback.clip === this.poseClip;
  }

  /** Names of the class skeleton's bones, in order. */
  get boneNames(): string[] {
    return this.classData?.bones.map((b) => b.name) ?? [];
  }

  /** Bone-to-model matrices of the current pose (Source space). */
  get boneWorlds(): THREE.Matrix4[] | null {
    return this.rig?.boneWorld ?? null;
  }

  /** The matrix that takes Source space into the scene (conversion and placement); null before a model is loaded. */
  get modelMatrix(): THREE.Matrix4 | null {
    return this.modelGroup?.matrix ?? null;
  }

  /** Particle queries use Source-space bones, even when the visible model is in its bind pose. */
  particleBoneFrame(bone: number): THREE.Matrix4 | null {
    return this.rig?.boneWorld[bone] ?? null;
  }

  particleRootFrame(out = new THREE.Matrix4()): THREE.Matrix4 {
    return this.rootMatrix(out, true);
  }

  get particleModel(): ModelData | null { return this.classData; }
  get particleTeam(): number { return this.skin; }

  particleCosmetic(itemId: number | null): ModelData | null {
    return this.cosmeticList.find((item) => item.itemId === itemId)?.data ?? null;
  }

  /** Attachment bones can be cosmetic-only (including jiggle bones); query the rendered bonemerged rig. */
  particleCosmeticBoneFrame(itemId: number | null, modelPath: string, bone: number): THREE.Matrix4 | null {
    const slot = this.cosmeticList.findIndex((item) => item.itemId === itemId && item.data.path === modelPath);
    return this.cosmetics[slot]?.rig.boneWorld[bone] ?? null;
  }

  /** CBoneMergeCache::GetRootBone follows the first merged bone, rather than the player's origin. */
  particleCosmeticRootFrame(itemId: number | null, modelPath: string): THREE.Matrix4 | null {
    const slot = this.cosmeticList.findIndex((item) => item.itemId === itemId && item.data.path === modelPath);
    const cosmetic = this.cosmetics[slot];
    if (!cosmetic) return null;
    const merged = cosmetic.map.find((bone) => bone >= 0);
    return merged === undefined ? cosmetic.rig.boneWorld[0] ?? null : this.particleBoneFrame(merged);
  }

  /** Parenting previews to the actor makes scene isolation and screenshot visibility apply to effects too. */
  attachParticles(group: THREE.Group) {
    if (!this.modelGroup) return;
    if (group.parent !== this.modelGroup) this.modelGroup.add(group);
    group.matrix.copy(this.modelGroup.matrix).invert().multiply(this.particleRootFrame());
    group.matrixWorldNeedsUpdate = true;
  }

  /** World-space emitters leave smoke and shells where they were emitted as the character moves. */
  attachWorldParticles(group: THREE.Group) {
    if (!this.modelGroup) return;
    if (group.parent !== this.modelGroup) this.modelGroup.add(group);
    this.modelGroup.updateWorldMatrix(true, false);
    group.matrix.copy(this.modelGroup.matrixWorld).invert().multiply(SOURCE_TO_VIEWER);
    group.matrixWorldNeedsUpdate = true;
  }

  get parents(): number[] {
    return this.rig?.parents ?? [];
  }

  /** Bind-pose bone-to-model matrices. */
  get bindWorlds(): THREE.Matrix4[] | null {
    return this.rig?.bindWorld ?? null;
  }

  /** The eyes' attachment frame in the current pose (Source space: x forward, y left, z up), or null when the model has none. */
  eyeFrame(out = new THREE.Matrix4()): THREE.Matrix4 | null {
    const att = this.classData?.eyeAttachment;
    const world = att ? this.rig?.boneWorld[att.bone] : undefined;
    if (!att || !world) return null;
    const l = att.local;
    const local = new THREE.Matrix4().set(l[0], l[1], l[2], l[3], l[4], l[5], l[6], l[7], l[8], l[9], l[10], l[11], 0, 0, 0, 1);
    return out.multiplyMatrices(world, local);
  }

  private bindLocalQuats: THREE.Quaternion[] | null = null;

  /** The local rotation of every bone in the model's bind pose. */
  private bindLocal(): THREE.Quaternion[] {
    if (this.bindLocalQuats) return this.bindLocalQuats;
    const rig = this.rig!;
    const wq = rig.bindWorld.map((m) => {
      const q = new THREE.Quaternion();
      m.decompose(new THREE.Vector3(), q, new THREE.Vector3());
      return q;
    });
    this.bindLocalQuats = wq.map((q, i) => {
      const p = rig.parents[i];
      return p < 0 ? q.clone() : wq[p].clone().invert().multiply(q);
    });
    return this.bindLocalQuats;
  }

  /** The three bones of a finger (knuckle, middle, tip), -1 where missing. */
  private fingerBones(side: "L" | "R", finger: Finger): number[] {
    const names = this.boneNames.map((n) => n.toLowerCase());
    return [0, 1, 2].map((j) => names.indexOf(boneNameOf(finger, j, side).toLowerCase()));
  }

  private localQuat(bone: number): THREE.Quaternion {
    const cur = this.pose!;
    return new THREE.Quaternion(cur.quat[bone * 4], cur.quat[bone * 4 + 1], cur.quat[bone * 4 + 2], cur.quat[bone * 4 + 3]);
  }

  /** The rotation of a finger joint's hinge for a curl. */
  private hingeQuat(finger: Finger, joint: number, curl: number): THREE.Quaternion {
    return new THREE.Quaternion().setFromAxisAngle(FINGER_AXIS, (curlAngle(finger, joint, curl) * Math.PI) / 180);
  }

  /**
   * The turn of a finger's knuckle beyond its curl (a spread sideways, a twist, the thumb's swing), in the knuckle's own frame, worked
   * out from the current pose: its rotation from the bind pose with the hinge part of the current curl taken off.
   */
  private knuckleSwing(side: "L" | "R", finger: Finger): THREE.Quaternion {
    const bones = this.fingerBones(side, finger);
    if (bones[0] < 0 || !this.pose) return new THREE.Quaternion();
    const bind = this.bindLocal()[bones[0]];
    const hinge = this.hingeQuat(finger, 0, this.getFingerCurl(side, finger));
    return bind.clone().invert().multiply(this.localQuat(bones[0])).multiply(hinge.invert());
  }

  /**
   * The turn of a finger's tip joint beyond its curl, in the joint's own frame (the tip joint's rotation from the bind pose with the
   * hinge part of the current curl taken off): what the tip control's rotation sets.
   */
  tipExtra(side: "L" | "R", finger: Finger): THREE.Quaternion {
    const bone = this.fingerBones(side, finger)[2];
    if (bone < 0 || !this.pose) return new THREE.Quaternion();
    const base = this.bindLocal()[bone].clone().multiply(this.hingeQuat(finger, 2, this.getFingerCurl(side, finger)));
    return base.invert().multiply(this.localQuat(bone));
  }

  /** Sets the turn of a finger's tip joint beyond its curl (see {@link tipExtra}), keeping the rest of the finger as it is. */
  setTipExtra(side: "L" | "R", finger: Finger, extra: THREE.Quaternion) {
    if (!this.pose || !this.rig) return;
    this.writeFinger(side, finger, this.getFingerCurl(side, finger), this.knuckleSwing(side, finger), extra);
    this.refreshPose();
  }

  /** Writes a finger's joint rotations for a curl, a knuckle swing (in the knuckle's frame) and a turn of the tip joint (in its frame). */
  private writeFinger(side: "L" | "R", finger: Finger, curl: number, swing: THREE.Quaternion, extra = new THREE.Quaternion()) {
    const cur = this.pose;
    if (!cur) return;
    const bind = this.bindLocal();
    this.fingerBones(side, finger).forEach((bone, joint) => {
      if (bone < 0) return;
      const q = bind[bone].clone().multiply(joint === 0 ? swing : new THREE.Quaternion()).multiply(this.hingeQuat(finger, joint, curl)).multiply(joint === 2 ? extra : new THREE.Quaternion()).normalize();
      cur.quat.set([q.x, q.y, q.z, q.w], bone * 4);
    });
  }

  /**
   * Sets one finger to a curl (0 open, 1 a tight fist). The result does not depend on the pose the finger was in before: every
   * joint is set to the bind rotation closed about its hinge by that curl. With `keepSwing` the knuckle keeps the turn it has beyond
   * its curl (a spread or twist), and only the curl changes.
   */
  setFingerCurl(side: "L" | "R", finger: Finger, curl: number, keepSwing = false) {
    if (!this.pose || !this.rig) return;
    this.writeFinger(side, finger, curl, keepSwing ? this.knuckleSwing(side, finger) : new THREE.Quaternion(), keepSwing ? this.tipExtra(side, finger) : new THREE.Quaternion());
    this.refreshPose();
  }

  /**
   * The curl (0 open, 1 a tight fist) a finger has in the current pose, read from its middle joint. It is the inverse of
   * {@link setFingerCurl}, so a finger set to a curl reads back as that curl.
   */
  getFingerCurl(side: "L" | "R", finger: Finger): number {
    const bone = this.fingerBones(side, finger)[1];
    if (bone < 0 || !this.pose || !this.rig) return 0;
    const rel = this.bindLocal()[bone].clone().invert().multiply(this.localQuat(bone));
    let angle = 2 * Math.atan2(rel.x * FINGER_AXIS.x + rel.y * FINGER_AXIS.y + rel.z * FINGER_AXIS.z, rel.w);
    if (angle > Math.PI) angle -= 2 * Math.PI;
    if (angle < -Math.PI) angle += 2 * Math.PI;
    return curlFromAngle(finger, 1, (angle * 180) / Math.PI);
  }

  private tipOffsets = new Map<string, THREE.Vector3>();

  /** The fingertip's offset from the tip bone, in the tip bone's own frame (the bone's direction, a bit longer than the last segment). */
  private tipOffset(side: "L" | "R", finger: Finger): THREE.Vector3 {
    const key = `${side}${finger}`;
    let off = this.tipOffsets.get(key);
    if (!off) {
      const bones = this.fingerBones(side, finger);
      off = new THREE.Vector3(0, 1, 0);
      const bind = this.rig?.bindWorld;
      if (bind && bones[1] >= 0 && bones[2] >= 0) {
        const p1 = new THREE.Vector3().setFromMatrixPosition(bind[bones[1]]);
        const p2 = new THREE.Vector3().setFromMatrixPosition(bind[bones[2]]);
        const q2 = new THREE.Quaternion();
        bind[bones[2]].decompose(new THREE.Vector3(), q2, new THREE.Vector3());
        const d = p2.sub(p1);
        off = d.clone().multiplyScalar(0.8).applyQuaternion(q2.invert());
      }
      this.tipOffsets.set(key, off);
    }
    return off;
  }

  /** The direction the fingertip points in the tip bone's own frame (unit length): the way the last segment runs. */
  fingerTipDirection(side: "L" | "R", finger: Finger): THREE.Vector3 {
    return this.tipOffset(side, finger).clone().normalize();
  }

  /** Where a finger's tip is in the current pose (model space), or null without the bones. */
  fingerTip(side: "L" | "R", finger: Finger, out = new THREE.Vector3()): THREE.Vector3 | null {
    const bone = this.fingerBones(side, finger)[2];
    const worlds = this.rig?.boneWorld;
    if (bone < 0 || !worlds) return null;
    return out.copy(this.tipOffset(side, finger)).applyMatrix4(worlds[bone]);
  }

  /** The frame of a finger's parent (the hand): where the finger is attached. */
  fingerHandFrame(side: "L" | "R", finger: Finger): THREE.Matrix4 | null {
    const base = this.fingerBones(side, finger)[0];
    const parent = base >= 0 ? this.rig?.parents[base] ?? -1 : -1;
    return parent >= 0 ? this.rig!.boneWorld[parent] : null;
  }

  /** The tip position (model space) of a finger for a curl and a knuckle swing, by walking the chain from the hand. */
  private tipFor(side: "L" | "R", finger: Finger, curl: number, swing: THREE.Quaternion, hand: THREE.Matrix4, extra: THREE.Quaternion): THREE.Vector3 {
    const bones = this.fingerBones(side, finger);
    const cur = this.pose!;
    const bind = this.bindLocal();
    const m = hand.clone();
    const local = new THREE.Matrix4();
    const one = new THREE.Vector3(1, 1, 1);
    bones.forEach((bone, joint) => {
      const q = bind[bone].clone().multiply(joint === 0 ? swing : new THREE.Quaternion()).multiply(this.hingeQuat(finger, joint, curl)).multiply(joint === 2 ? extra : new THREE.Quaternion());
      local.compose(new THREE.Vector3(cur.pos[bone * 3], cur.pos[bone * 3 + 1], cur.pos[bone * 3 + 2]), q, cur.scale ? new THREE.Vector3().fromArray(cur.scale,bone*3) : one);
      m.multiply(local);
    });
    return this.tipOffset(side, finger).clone().applyMatrix4(m);
  }

  /**
   * Moves a finger so its tip reaches `target` (model space), or comes as close as the finger can. A finger is a flat chain: its
   * joints bend together (the curl, with the fixed relation between the joints the measured ranges give) and the knuckle can spread it
   * sideways. Both are searched for the closest tip, within the ranges the game's animations use.
   */
  solveFingerTip(side: "L" | "R", finger: Finger, target: THREE.Vector3) {
    const bones = this.fingerBones(side, finger);
    const hand = this.fingerHandFrame(side, finger);
    if (!this.pose || !this.rig || !hand || bones.some((b) => b < 0)) return;
    const base = this.knuckleSwing(side, finger);
    const extra = this.tipExtra(side, finger);
    const spreadQ = new THREE.Quaternion();
    const baseSpread = (2 * Math.atan2(base.x * SPREAD_AXIS.x + base.y * SPREAD_AXIS.y + base.z * SPREAD_AXIS.z, base.w) * 180) / Math.PI;
    const wrap = (d: number) => (d > 180 ? d - 360 : d < -180 ? d + 360 : d);
    const maxSpread = finger === "thumb" ? 60 : 35;
    const rad = Math.PI / 180;
    const cost = (curl: number, spread: number) => {
      spreadQ.copy(base).multiply(new THREE.Quaternion().setFromAxisAngle(SPREAD_AXIS, spread * rad));
      return this.tipFor(side, finger, curl, spreadQ, hand, extra).distanceToSquared(target);
    };
    let best = { c: this.getFingerCurl(side, finger), s: 0, d: Infinity };
    const search = (c0: number, c1: number, cStep: number, s0: number, s1: number, sStep: number) => {
      for (let s = s0; s <= s1 + 1e-9; s += sStep) {
        if (Math.abs(wrap(baseSpread) + s) > maxSpread) continue;
        for (let c = c0; c <= c1 + 1e-9; c += cStep) {
          const d = cost(c, s);
          if (d < best.d) best = { c, s, d };
        }
      }
    };
    search(MIN_CURL, MAX_CURL, 0.05, -maxSpread - 20, maxSpread + 20, 5);
    search(Math.max(MIN_CURL, best.c - 0.06), Math.min(MAX_CURL, best.c + 0.06), 0.01, best.s - 6, best.s + 6, 1);
    spreadQ.copy(base).multiply(new THREE.Quaternion().setFromAxisAngle(SPREAD_AXIS, best.s * rad));
    this.writeFinger(side, finger, best.c, spreadQ, extra);
    this.refreshPose();
  }

  /** Puts a hand's fingers (both hands without `side`) back to the pose posing started from (undoable). */
  resetFingers(side?: "L" | "R") {
    const cur = this.pose;
    const base = this.poseBase;
    if (!cur || !base) return;
    this.poseHistory.record(cur);
    const names = this.boneNames.map((n) => n.toLowerCase());
    for (const sd of side ? [side] : (["L", "R"] as const)) {
      for (const finger of FINGERS) {
        for (let joint = 0; joint < 3; joint++) {
          const bone = names.indexOf(boneNameOf(finger, joint, sd).toLowerCase());
          if (bone < 0) continue;
          cur.quat.set(base.quat.subarray(bone * 4, bone * 4 + 4), bone * 4);
        }
      }
    }
    this.refreshPose();
  }

  /** The index of a finger's first (knuckle) bone, or -1. */
  fingerBase(side: "L" | "R", finger: Finger): number {
    return this.boneNames.map((n) => n.toLowerCase()).indexOf(boneNameOf(finger, 0, side).toLowerCase());
  }

  /** Whether the skeleton has the finger bones (they are what the hand controls drive). */
  hasFingers(side: "L" | "R"): boolean {
    const names = new Set(this.boneNames.map((n) => n.toLowerCase()));
    return FINGERS.every((f) => names.has(boneNameOf(f, 1, side).toLowerCase()));
  }

  /** The pose being edited (live arrays), or null. */
  get pose(): PoseData | null {
    if (!this.isPosing || !this.poseClip) return null;
    this.poseClip.scale ??= new Float32Array(this.poseClip.pos.length).fill(1);
    return { pos: this.poseClip.pos, quat: this.poseClip.quat, scale: this.poseClip.scale };
  }

  /** A detached copy of an edited or held custom pose for scene saving and duplication. */
  snapshotCustomPose(): PoseData | null {
    return this.isPosing || this.holdsPose ? this.snapshotPose() : null;
  }

  /** The local pose of every bone at the current frame of what the character plays (null without an animation). */
  snapshotPose(): PoseData | null {
    const clip = this.playback.clip;
    if (!clip || !this.rig || clip.numBones !== this.rig.boneWorld.length) return null;
    return sampleClip(clip, this.playback.frame());
  }

  /** Freezes the current frame of the playing animation into an editable pose. False when there is no animation to take it from. */
  beginPose(): boolean {
    const clip = this.playback.clip;
    if (!this.rig) return false;
    if (clip && clip.numBones === this.rig.boneWorld.length) {
      this.startPose(sampleClip(clip, this.playback.frame()));
      return true;
    }
    // no animation (the bind pose is showing): the pose starts from the bind pose
    const bind = this.bindPose();
    if (!bind) return false;
    this.startPose(bind);
    return true;
  }

  /** The local pose of every bone in the model's bind (reference) pose. */
  bindPose(): PoseData | null {
    const rig = this.rig;
    if (!rig) return null;
    const n = rig.bindWorld.length;
    const out: PoseData = { pos: new Float32Array(n * 3), quat: new Float32Array(n * 4) };
    const local = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const parent = rig.parents[i];
      if (parent < 0) local.copy(rig.bindWorld[i]);
      else local.copy(rig.bindWorld[parent]).invert().multiply(rig.bindWorld[i]);
      local.decompose(p, q, sc);
      out.pos.set([p.x, p.y, p.z], i * 3);
      out.quat.set([q.x, q.y, q.z, q.w], i * 4);
    }
    return out;
  }

  /** Puts a pose on the character: it becomes the editable pose (as an undoable edit when already posing). */
  usePose(p: PoseData) {
    if (!this.rig || p.pos.length !== this.rig.boneWorld.length * 3) return;
    const cur = this.pose;
    if (!cur) {
      this.startPose(clonePose(p));
      return;
    }
    this.poseHistory.record(cur);
    cur.pos.set(p.pos);
    cur.quat.set(p.quat);
    cur.scale!.set(p.scale ?? new Float32Array(cur.pos.length).fill(1));
    this.refreshPose();
  }

  private startPose(p: PoseData) {
    this.poseBase = clonePose(p);
    this.poseHistory.clear();
    this.poseClip = poseToClip(clonePose(p));
    this.playback.clip = this.poseClip;
    this.playback.time = 0;
    this.playback.playing = false;
    this.refreshPose();
  }

  /**
   * Leaves pose mode. The character keeps showing the pose, paused, until the caller puts an animation back ({@link holdsPose}).
   * `keep` false forgets the pose (the caller is about to play something else).
   */
  endPose(keep = true) {
    this.heldClip = keep ? this.poseClip : null;
    this.poseClip = null;
    this.poseBase = null;
    this.poseHistory.clear();
  }

  /** True while a custom pose that is no longer being edited is what the character shows. */
  get holdsPose(): boolean {
    return !this.isPosing && this.heldClip !== null && this.playback.clip === this.heldClip;
  }

  private reactionHidden = false;
  private listHidden = false;
  private syncHidden() {
    const hidden = this.reactionHidden || this.listHidden;
    if (this.modelGroup) this.modelGroup.visible = !hidden;
    if (this.prop) this.prop.group.visible = !hidden;
    this.changed = true;
  }
  setReactionHidden(hidden: boolean) { this.reactionHidden = hidden; this.syncHidden(); }
  /** Hidden from the scene list (the eye of the hierarchy): not drawn, not cast as a shadow, not clickable. */
  setListHidden(hidden: boolean) { this.listHidden = hidden; this.syncHidden(); }
  get hiddenInList(): boolean { return this.listHidden; }

  /** True while a controller (play mode) feeds the character a new pose every frame. */
  get isLive(): boolean {
    return this.liveClip !== null && this.playback.clip === this.liveClip;
  }

  /** Shows a pose computed by a controller; unlike {@link usePose} it is not an edit (no undo history). */
  setLive(p: PoseData) {
    if (!this.rig || p.pos.length !== this.rig.boneWorld.length * 3) return;
    if (!this.liveClip || this.liveClip.numBones !== p.pos.length / 3 || this.playback.clip !== this.liveClip) {
      this.liveClip = poseToClip(clonePose(p));
      this.playback.clip = this.liveClip;
      this.playback.time = 0;
      this.playback.playing = false;
    } else {
      (this.liveClip.pos as Float32Array).set(p.pos);
      (this.liveClip.quat as Float32Array).set(p.quat);
    }
    this.posedTime = NaN;
    this.poseBones();
    this.changed = true;
  }

  /** Stops the live pose; the caller puts an animation back. */
  endLive() {
    this.liveClip = null;
  }

  /** Call before an edit (a drag, a reset) so it can be undone. */
  recordUndo() {
    const cur = this.pose;
    if (cur) this.poseHistory.record(cur);
  }

  /** Drops the undo step recorded for an edit that was cancelled. */
  discardUndo() {
    this.poseHistory.discard();
  }

  get canUndo(): boolean {
    return this.isPosing && this.poseHistory.canUndo;
  }

  get canRedo(): boolean {
    return this.isPosing && this.poseHistory.canRedo;
  }

  undoPose(): boolean {
    return this.stepHistory((cur) => this.poseHistory.undo(cur));
  }

  redoPose(): boolean {
    return this.stepHistory((cur) => this.poseHistory.redo(cur));
  }

  private stepHistory(step: (cur: PoseData) => PoseData | null): boolean {
    const cur = this.pose;
    if (!cur) return false;
    const p = step(clonePose(cur));
    if (!p) return false;
    cur.pos.set(p.pos);
    cur.quat.set(p.quat);
    cur.scale!.set(p.scale ?? new Float32Array(cur.pos.length).fill(1));
    this.refreshPose();
    return true;
  }

  /** Turns a bone: sets its local rotation. */
  setBoneQuat(bone: number, q: THREE.Quaternion) {
    const cur = this.pose;
    if (!cur) return;
    cur.quat.set([q.x, q.y, q.z, q.w], bone * 4);
    this.refreshPose();
  }

  /** Moves a bone: sets its local position. */
  setBoneScale(bone: number, scale: THREE.Vector3) {
    const cur = this.pose;
    if (!cur || bone < 0 || bone >= cur.pos.length / 3) return;
    cur.scale!.set(scale.clone().clampScalar(.01, 100).toArray(), bone * 3);
    this.refreshPose();
  }

  setBonePos(bone: number, x: number, y: number, z: number) {
    const cur = this.pose;
    if (!cur) return;
    cur.pos.set([x, y, z], bone * 3);
    this.refreshPose();
  }

  /** Puts one bone back to the pose posing started from (undoable). */
  resetBone(bone: number) {
    const cur = this.pose;
    const base = this.poseBase;
    if (!cur || !base) return;
    this.poseHistory.record(cur);
    cur.pos.set(base.pos.subarray(bone * 3, bone * 3 + 3), bone * 3);
    cur.quat.set(base.quat.subarray(bone * 4, bone * 4 + 4), bone * 4);
    cur.scale!.set(base.scale?.subarray(bone * 3, bone * 3 + 3) ?? [1, 1, 1], bone * 3);
    this.refreshPose();
  }

  /** Puts the position and / or the rotation of some bones back to the pose posing started from, as one undoable edit. */
  resetBones(bones: number[], position: boolean, rotation: boolean) {
    const cur = this.pose;
    const base = this.poseBase;
    if (!cur || !base || bones.length === 0) return;
    this.poseHistory.record(cur);
    for (const bone of bones) {
      if (position) cur.pos.set(base.pos.subarray(bone * 3, bone * 3 + 3), bone * 3);
      if (rotation) cur.quat.set(base.quat.subarray(bone * 4, bone * 4 + 4), bone * 4);
    }
    this.refreshPose();
  }

  /** Puts the whole pose back to where posing started (undoable). */
  resetPose() {
    const cur = this.pose;
    const base = this.poseBase;
    if (!cur || !base) return;
    this.poseHistory.record(cur);
    cur.pos.set(base.pos);
    cur.quat.set(base.quat);
    cur.scale!.set(base.scale ?? new Float32Array(cur.pos.length).fill(1));
    this.refreshPose();
  }

  /** Re-poses the bones from the edited arrays. */
  private refreshPose() {
    this.posedTime = NaN;
    this.poseBones();
    this.changed = true;
  }

  /** The item a cosmetic slot number (see `meshes()`' userData) belongs to. */
  cosmeticItemAt(slot: number): number | null {
    return this.cosmeticList[slot - 1]?.itemId ?? null;
  }

  /** Every mesh of the character (class, cosmetics and a separate prop). */
  meshes(): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    if (this.listHidden) return out;
    const add = (root: THREE.Object3D | null | undefined) =>
      root?.traverse((o) => {
        if (o instanceof THREE.Mesh) out.push(o);
      });
    add(this.modelGroup);
    add(this.prop?.group);
    return out;
  }

  setWireframe(on: boolean) {
    const apply = (root: THREE.Object3D | null | undefined) =>
      root?.traverse((o) => {
        if (o instanceof THREE.Mesh) (o.material as THREE.ShaderMaterial).wireframe = on;
      });
    apply(this.modelGroup);
    apply(this.prop?.group);
  }

  /** Jiggle bones that are simulated (not merged into the class skeleton) keep moving even in a still pose. */
  private get hasJiggle(): boolean {
    return this.ctx.jiggle() && this.cosmetics.some((c) => c.jiggles.some(Boolean));
  }

  /** The group for drawings in the character's own space (null until it has a model). */
  get helpers(): THREE.Group | null {
    return this.helperGroup;
  }

  /**
   * Where an extra bone of a cosmetic (one the class lacks) is meant to be: its parent's current pose with its bind offset, the pose a jiggle
   * bone's physics is driven from. In the character's own space; null when there is no such bone.
   */
  cosmeticBoneGoal(name: string, out = new THREE.Matrix4()): THREE.Matrix4 | null {
    const lower = name.toLowerCase();
    for (const c of this.cosmetics) {
      const i = c.bones.findIndex((b, k) => b.name.toLowerCase() === lower && c.map[k] < 0);
      if (i < 0) continue;
      const parent = c.rig.parents[i];
      return parent >= 0 ? out.multiplyMatrices(c.rig.boneWorld[parent], c.bindLocal[i]) : out.copy(c.rig.bindWorld[i]);
    }
    return null;
  }

  /** Writes each cosmetic's bone transforms from the class skeleton (bonemerge). */
  /** Source's minigun rotates its weapon-only barrel bone procedurally around local Z. */
  setWeaponBarrel(angle: number | null) {
    this.weaponBarrelAngle = angle;
    this.updateCosmetics();
    this.changed = true;
  }

  updateCosmetics() {
    if (!this.rig) return;
    const classWorld = this.rig.boneWorld;
    const jiggleOn = this.ctx.jiggle();
    const now = performance.now() / 1000;
    let correction: THREE.Matrix4 | null = null;
    const lock = this.handLock;
    if (lock && classWorld[lock.hand] && classWorld[lock.root]) {
      // the offset of the weapon's root from the hand is taken once the animations have settled after the lock began (the crossfade into the idle is over)
      if (!lock.offset) { if (performance.now() - lock.since > 500) lock.offset = new THREE.Matrix4().copy(classWorld[lock.hand]).invert().multiply(classWorld[lock.root]); }
      else correction = _lockCorrection.multiplyMatrices(classWorld[lock.hand], lock.offset).multiply(_lockInverse.copy(classWorld[lock.root]).invert());
    }
    for (const c of this.cosmetics) {
      const world = c.rig.boneWorld;
      for (let i = 0; i < world.length; i++) {
        const j = c.map[i];
        if (this.weaponBarrelAngle !== null && c.bones[i].name.toLowerCase() === "barrel" && j < 0) {
          const bind = c.bindLocal[i].elements;
          _cosLocal.makeRotationZ(this.weaponBarrelAngle).setPosition(bind[12], bind[13], bind[14]);
          if (c.rig.parents[i] >= 0) world[i].multiplyMatrices(world[c.rig.parents[i]], _cosLocal);
          else world[i].copy(_cosLocal);
        } else if (j >= 0 && j < classWorld.length) {
          world[i].copy(classWorld[j]); // merged bone: identical transform
          if (correction && lock!.follow.has(j)) world[i].premultiply(correction);
        } else if (c.own && this.playback.clip) {
          // extra bone of a model with its own animation (the tank's tracks): the clip's local transform under the parent
          const p = c.own;
          p.time = this.playback.time;
          p.loopAll = this.playback.loopAll;
          const local = ownLocal(p.clip!, p.frame(), i, _cosLocal);
          if (c.rig.parents[i] >= 0) world[i].multiplyMatrices(world[c.rig.parents[i]], local);
          else world[i].copy(local);
        } else if (c.rig.parents[i] >= 0) {
          world[i].multiplyMatrices(world[c.rig.parents[i]], c.bindLocal[i]); // extra bone: follow the parent
          const jiggle = jiggleOn ? c.jiggles[i] : null;
          if (jiggle) {
            // The animated matrix is the goal; the spring simulation decides where the bone actually is.
            world[i].copy(jiggle.update(now, world[i], this.playback.clip ? this.gravitySource : this.gravityBind));
          }
        } else {
          world[i].copy(c.rig.bindWorld[i]);
        }
        c.bones[i].matrixWorld.copy(world[i]);
      }
    }
  }

  /** Plays a baked clip, or shows the bind pose when `clip` is null. Returns true when the camera should frame the pose. */
  setClip(clip: ClipData | null, keepTime = false) {
    this.playback.clip = clip;
    if (!keepTime) this.playback.time = 0;
    this.posedTime = NaN;
    this.poseBones();
    this.changed = true;
  }

  /**
   * Advances the clip and poses the skeleton. Returns whether the picture changed: a paused character is not re-posed (unless
   * a jiggle bone is still settling or the time was moved).
   */
  step(dt: number): boolean {
    if (!this.rig || !this.modelGroup) return false;
    const pb = this.playback;
    if (!pb.clip) {
      // Jiggle bones keep settling in the bind pose too.
      if (this.hasJiggle) {
        this.updateCosmetics();
        return true;
      }
      return false;
    }
    pb.advance(dt);
    if (pb.time === this.posedTime && pb.clip === this.posedClip && !this.hasJiggle) return false;
    this.poseBones();
    return true;
  }

  /** Writes the current pose into the bones, the root transform and the eye constants. */
  poseBones() {
    if (!this.rig || !this.modelGroup) return;
    const clip = this.playback.clip;
    if (clip) {
      this.rig.poseFromClip(clip, this.playback.frame());
      this.rootMatrix(this.modelGroup.matrix, true);
    } else {
      this.rig.setBindPose();
      this.rootMatrix(this.modelGroup.matrix, this.sourceBind);
    }
    this.posedClip = clip;
    this.posedTime = this.playback.time;
    this.modelGroup.matrixWorldNeedsUpdate = true;
    const world = this.rig.boneWorld;
    for (let i = 0; i < world.length; i++) this.bones[i].matrixWorld.copy(world[i]);
    this.updateCosmetics();
    this.updateEyes();
    this.poseProp();
  }

  /**
   * Aims every eyeball at the gaze target and rebuilds its iris projection (hlmv `SetViewTarget`): the
   * target is 32 units in front of the "eyes" attachment, deflected by the eyes_updown / eyes_rightleft
   * controllers. Each eye looks at that single point, so the pair converges slightly like hlmv's.
   */
  private updateEyes() {
    if (!this.rig || !this.classData || this.eyes.length === 0) return;
    const root = this.modelGroup?.matrix;
    if (!root) return;
    const att = this.classData.eyeAttachment;
    let haveTarget = false;
    if (att && this.rig.boneWorld[att.bone]) {
      const l = att.local;
      _eyeLocal.set(l[0], l[1], l[2], l[3], l[4], l[5], l[6], l[7], l[8], l[9], l[10], l[11], 0, 0, 0, 1);
      _eyeAtt.multiplyMatrices(this.rig.boneWorld[att.bone], _eyeLocal);
      const [x, y, z] = gazeTargetLocal(this.flexGlobals.get("eyes_updown") ?? 0, this.flexGlobals.get("eyes_rightleft") ?? 0);
      _eyeTarget.set(x, y, z).applyMatrix4(_eyeAtt).applyMatrix4(root);
      haveTarget = true;
    }
    for (const { material, data } of this.eyes) {
      const bone = this.rig.boneWorld[data.bone];
      if (!bone || !haveTarget) continue;
      _eyeOrigin.set(...data.boneOrigin).applyMatrix4(bone).applyMatrix4(root);
      _eyeUp.set(...data.boneUp).transformDirection(bone).transformDirection(root);
      _eyeFwd.subVectors(_eyeTarget, _eyeOrigin).normalize();
      _eyeLeft.crossVectors(_eyeUp, _eyeFwd).normalize();
      // The QC yaw offset (zoffset) turns each eye outward from the gaze direction, which cancels most of the
      // convergence on the 32 unit target. Applied the other way round the eyes come out cross-eyed.
      _eyeFwd.addScaledVector(_eyeLeft, -data.zoffset).normalize();
      _eyeLeft.crossVectors(_eyeUp, _eyeFwd).normalize();
      _eyeUp.crossVectors(_eyeFwd, _eyeLeft); // re-orthogonalised up
      const u = _eyeLeft.multiplyScalar(data.irisScale);
      const v = _eyeUp.multiplyScalar(-data.irisScale);
      const uniforms = material.uniforms;
      uniforms.uEyeOrigin.value.copy(_eyeOrigin);
      uniforms.uIrisU.value.set(u.x, u.y, u.z, 0.5 - u.dot(_eyeOrigin));
      uniforms.uIrisV.value.set(v.x, v.y, v.z, 0.5 - v.dot(_eyeOrigin));
    }
  }

  /**
   * The posed bounds in viewer space (class meshes and cosmetics, with the placement), falling back to the bind pose.
   * `target` receives the box.
   */
  computeBounds(target: THREE.Box3): THREE.Box3 {
    target.makeEmpty();
    if (this.modelGroup && this.skeleton) {
      this.modelGroup.updateMatrixWorld(true);
      this.skeleton.update();
      const box = new THREE.Box3();
      (this.inspectOnlyOn ? this.cosmeticGroup : this.classGroup)?.traverse((o) => {
        if (o instanceof THREE.SkinnedMesh && (this.inspectOnlyOn || o.skeleton === this.skeleton)) {
          o.computeBoundingBox();
          if (o.boundingBox) target.union(box.copy(o.boundingBox).applyMatrix4(o.matrixWorld));
        }
      });
    }
    if (target.isEmpty()) target.copy(this.bindBounds).applyMatrix4(this.rootMatrix(new THREE.Matrix4(), false));
    return target;
  }
}

/**
 * Marks the vertices of a mesh that hang on a prop bone (`prp_cig`: the Spy's cigarette, the props some models hold) in a vertex attribute for the
 * shadow pass. Such a part is a thing of its own that touches the body, not relief of it: its shadows are to start right at what it touches, while
 * the relief of the body itself (lips, nostrils) is not to shadow the body (see rigLitBy in the lighting shader).
 */
function markDetachedParts(geo: THREE.BufferGeometry, m: MeshData, boneNames: string[]) {
  if (geo.getAttribute("aDetached")) return;
  const detachedBone = boneNames.map((name) => /^prp_/i.test(name));
  if (!detachedBone.some(Boolean)) return;
  const count = m.skinIndices.length / 4;
  const flag = new Float32Array(count);
  let any = false;
  for (let i = 0; i < count; i++) {
    let weight = 0;
    for (let k = 0; k < 4; k++) if (detachedBone[m.skinIndices[i * 4 + k]]) weight += m.skinWeights[i * 4 + k];
    if (weight > 0.5) { flag[i] = 1; any = true; }
  }
  if (any) geo.setAttribute("aDetached", new THREE.BufferAttribute(flag, 1));
}
