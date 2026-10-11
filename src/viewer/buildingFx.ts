import * as THREE from "three";
import { loadMaterial } from "../api";
import { parseMaterial, type TextureData } from "./payload";
import type { Actor } from "./actor";
import type { BuildingInfo } from "./buildings";
import type { ParticleModelInfo } from "./particles/assets";
import type { LaneWant } from "./particles/conditionLanes";

/**
 * What a building is doing, as its effects show it (the state the game keeps in the entity and its client class: C_ObjectSentrygun,
 * C_ObjectDispenser, C_ObjectTeleporter).
 */
export interface BuildingFx {
  /** Damage smoke and sparks: 0 none, 1 light ... 4 critical (`BUILDING_DAMAGE_LEVEL_*`). */
  damage: number;
  /** Dispenser: the metal in it (the arrow of its screen), out of {@link DISPENSER_MAX_METAL}. */
  metal: number;
  /** Dispenser: the healing beam to the nearest character. */
  healing: boolean;
  /** Sentry: the gun is firing (the fire animation, a muzzle flash per shot). */
  firing: boolean;
  /** Sentry: the Wrangler's shield. */
  shield: boolean;
  /** Teleporter: it is charged and connected, so it spins, glows and shows its direction (`TELEPORTER_STATE_READY`); off it is idle. */
  active: boolean;
}

export const DISPENSER_MAX_METAL = 400;

export const defaultFx = (): BuildingFx => ({ damage: 0, metal: 100, healing: false, firing: false, shield: false, active: true });

/** Reads a saved effect state: what is missing or malformed takes its default. */
export function readFx(value: unknown): BuildingFx {
  const v = (value ?? {}) as Partial<BuildingFx>;
  const d = defaultFx();
  return {
    damage: Number.isInteger(v.damage) && v.damage! >= 0 && v.damage! <= 4 ? v.damage! : d.damage,
    metal: Number.isFinite(v.metal) ? Math.min(Math.max(v.metal!, 0), DISPENSER_MAX_METAL) : d.metal,
    healing: v.healing === true,
    firing: v.firing === true,
    shield: v.shield === true,
    active: v.active !== false,
  };
}

/** A particle system a building wants running, and where it is anchored: the entity's origin, or a named attachment of its model. */
export interface BuildingWant {
  system: string;
  id: string;
  /** "origin" or an attachment name. */
  anchor: string;
  /** Moves the anchor (Source units, in the space of the building). */
  offset?: [number, number, number];
  burst?: { every: number; phase: number };
  beam?: boolean;
}

/** The systems a building runs for its state (the names and anchors are those of the SDK's client classes). */
export function buildingWants(info: BuildingInfo, fx: BuildingFx, team: number): BuildingWant[] {
  const t = team === 1 ? "blue" : "red";
  const wants: BuildingWant[] = [];
  const level = info.level;
  if (info.stage === "building") return wants;
  switch (info.kind) {
    case "teleporter":
      if (fx.damage > 0) wants.push({ system: `tpdamage_${fx.damage}`, id: "damage", anchor: "origin" });
      if (fx.active) {
        wants.push({ system: `teleporter_${t}_charged_level${level}`, id: "charged", anchor: "origin" });
        wants.push({ system: `teleporter_${t}_${info.mode}_level${level}`, id: "direction", anchor: "origin" });
        wants.push({ system: `teleporter_arms_circle_${t}`, id: "armL", anchor: "arm_attach_L" });
        wants.push({ system: `teleporter_arms_circle_${t}`, id: "armR", anchor: "arm_attach_R" });
      }
      break;
    case "dispenser":
      if (fx.damage > 0) wants.push({ system: `dispenserdamage_${fx.damage}`, id: "damage", anchor: "origin" });
      if (fx.healing) wants.push({ system: `dispenser_heal_${t}`, id: "heal", anchor: "heal_origin", beam: true });
      break;
    case "sentry":
      // the damage smoke comes out of the build point of the first two levels and of its own attachment on the third
      if (fx.damage > 0) wants.push({ system: `sentrydamage_${fx.damage}`, id: "damage", anchor: level === 3 ? "sentrydamage" : "build_point_0" });
      if (fx.shield) wants.push({ system: "turret_shield", id: "shield", anchor: "origin", offset: [0, 0, 30] });
      if (fx.firing) {
        // level 1 fires every 0.2 s from its muzzle; levels 2 and 3 every 0.1 s, alternating between two muzzles
        if (level === 1) wants.push({ system: "muzzle_sentry", id: "muzzle", anchor: "muzzle", burst: { every: 0.2, phase: 0 } });
        else {
          wants.push({ system: "muzzle_sentry2", id: "muzzleL", anchor: "muzzle_l", burst: { every: 0.2, phase: 0 } });
          wants.push({ system: "muzzle_sentry2", id: "muzzleR", anchor: "muzzle_r", burst: { every: 0.2, phase: 0.1 } });
        }
      }
      break;
  }
  return wants;
}

/** Turns wants into lane wants for the particle pool: each one follows its anchor on the posed building. */
export function laneWants(actor: Actor, model: ParticleModelInfo, wants: BuildingWant[], beamTarget: () => number[]): LaneWant[] {
  const out: LaneWant[] = [];
  for (const want of wants) {
    const attachment = want.anchor === "origin" ? null : model.attachments.find((a) => a.name.toLowerCase() === want.anchor);
    if (want.anchor !== "origin" && !attachment) continue; // a model without that attachment has nothing to attach it to
    const offset = want.offset ? new THREE.Matrix4().makeTranslation(...want.offset) : null;
    const frame = new THREE.Matrix4();
    out.push({
      system: want.system,
      id: want.id,
      key: JSON.stringify([want.system, want.anchor, want.offset, want.burst, model.attachments.length]),
      target: () => ({
        actor,
        cp: () => {
          frame.identity();
          if (attachment) {
            const bone = actor.particleBoneFrame(attachment.bone);
            if (bone) frame.copy(bone).multiply(attachment.local);
          }
          if (offset) frame.premultiply(offset);
          return frame.clone();
        },
        boxes: () => [],
        ...(want.burst ? { burst: want.burst } : {}),
        ...(want.beam ? { target: beamTarget } : {}),
      }),
    });
  }
  return out;
}

// --- the dispenser's screens -----------------------------------------------------------------------------------

const SCREEN_WIDE = 480;
const SCREEN_TALL = 240;

/** `scripts/screens/obj_dispenser_*.res`: the meter's arrow turns between these angles; the image is drawn in this box around this pivot. */
const ARROW = { start: -85, end: 85, speed: 80, x: 215, y: 40, wide: 50, tall: 200, pivotX: 0.5, pivotY: 0.90625 };

async function vguiImage(name: string): Promise<TextureData | null> {
  const data = parseMaterial(await loadMaterial(`materials/vgui/${name}.vmt`));
  return data.textures.base ?? null;
}

function imageCanvas(image: TextureData): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(image.rgba.buffer.slice(image.rgba.byteOffset, image.rgba.byteOffset + image.rgba.byteLength)), image.width, image.height), 0, 0);
  return canvas;
}

/**
 * The two control screens of a dispenser (`screen_obj_dispenser_red` / `_blue` in scripts/vgui_screens.txt: 480x240 pixels, a meter and
 * an arrow that turns with the metal in the dispenser, at 80 degrees a second). The game places a screen with its lower left corner on
 * the model's `controlpanelN_ll` attachment and its upper right on `controlpanelN_ur` (CBaseObject::SpawnControlPanels): the panel is the
 * rectangle in the X-Y plane of the first attachment that reaches the second.
 */
export class DispenserScreens {
  readonly group = new THREE.Group();
  private readonly canvas = document.createElement("canvas");
  private readonly texture: THREE.CanvasTexture;
  private readonly panels: { mesh: THREE.Mesh; ll: ParticleModelInfo["attachments"][number]; ur: ParticleModelInfo["attachments"][number] }[] = [];
  private background: HTMLCanvasElement | null = null;
  private arrow: HTMLCanvasElement | null = null;
  private angle = THREE.MathUtils.degToRad(ARROW.start);
  private target = 0;
  private drawn = NaN;
  private disposed = false;
  /** The team whose screen is drawn (-1: none yet). */
  team = -1;
  private readonly frame = new THREE.Matrix4();
  private readonly lower = new THREE.Matrix4();
  private readonly upper = new THREE.Vector3();

  constructor(private readonly actor: Actor, model: ParticleModelInfo) {
    this.group.matrixAutoUpdate = false;
    this.group.name = "Dispenser screens";
    this.canvas.width = SCREEN_WIDE;
    this.canvas.height = SCREEN_TALL;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    const geometry = new THREE.BufferGeometry();
    // a unit rectangle in the plane of the lower left attachment: x to the right, y up, the picture facing +z
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    for (let n = 0; ; n++) {
      const ll = model.attachments.find((a) => a.name.toLowerCase() === `controlpanel${n}_ll`);
      const ur = model.attachments.find((a) => a.name.toLowerCase() === `controlpanel${n}_ur`);
      if (!ll || !ur) break;
      const material = new THREE.MeshBasicMaterial({ map: this.texture, side: THREE.DoubleSide, transparent: true, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      mesh.visible = false;
      this.group.add(mesh);
      this.panels.push({ mesh, ll, ur });
    }
  }

  get count() { return this.panels.length; }

  /** Loads the pictures of the team's screen and draws it. */
  async load(team: number) {
    const [bg, arrow] = await Promise.all([vguiImage(`dispenser_meter_bg_${team === 1 ? "blue" : "red"}`), vguiImage("dispenser_meter_arrow")]);
    if (this.disposed) return;
    this.team = team;
    this.background = bg ? imageCanvas(bg) : null;
    this.arrow = arrow ? imageCanvas(arrow) : null;
    this.drawn = NaN;
    this.draw();
  }

  /** The metal in the dispenser; the arrow approaches it at its own speed. */
  setMetal(metal: number) {
    const progress = Math.min(Math.max(metal / DISPENSER_MAX_METAL, 0), 1);
    this.target = THREE.MathUtils.degToRad(ARROW.start + (ARROW.end - ARROW.start) * progress);
  }

  /** Jumps the arrow to where the metal puts it (a freshly shown building). */
  snap() {
    this.angle = this.target;
  }

  private draw() {
    const ctx = this.canvas.getContext("2d")!;
    ctx.clearRect(0, 0, SCREEN_WIDE, SCREEN_TALL);
    if (this.background) ctx.drawImage(this.background, 0, 0, SCREEN_WIDE, SCREEN_TALL);
    if (this.arrow) {
      const mx = ARROW.x + ARROW.pivotX * ARROW.wide;
      const my = ARROW.y + ARROW.pivotY * ARROW.tall;
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(this.angle);
      ctx.drawImage(this.arrow, ARROW.x - mx, ARROW.y - my, ARROW.wide, ARROW.tall);
      ctx.restore();
    }
    this.texture.needsUpdate = true;
    this.drawn = this.angle;
  }

  step(dt: number) {
    if (this.disposed) return;
    this.actor.attachParticles(this.group);
    // RotatingProgressBar::OnTick: the arrow approaches its angle by a fixed step per tick
    const maxStep = THREE.MathUtils.degToRad(ARROW.speed) * dt;
    const delta = this.target - this.angle;
    this.angle = Math.abs(delta) <= maxStep ? this.target : this.angle + Math.sign(delta) * maxStep;
    if (this.angle !== this.drawn && (this.background || this.arrow)) this.draw();
    for (const { mesh, ll, ur } of this.panels) {
      const first = this.actor.particleBoneFrame(ll.bone);
      const second = this.actor.particleBoneFrame(ur.bone);
      if (!first || !second) { mesh.visible = false; continue; }
      this.lower.copy(first).multiply(ll.local);
      // the size of the screen: the upper right attachment in the space of the lower left one
      this.upper.setFromMatrixPosition(this.frame.copy(second).multiply(ur.local)).applyMatrix4(this.frame.copy(this.lower).invert());
      const wide = this.upper.x, tall = this.upper.y;
      if (!(wide > 0 && tall > 0)) { mesh.visible = false; continue; }
      mesh.matrix.copy(this.lower).multiply(this.frame.makeScale(wide, tall, 1));
      mesh.matrixWorldNeedsUpdate = true;
      mesh.visible = true;
    }
    this.group.updateWorldMatrix(true, true);
  }

  dispose() {
    this.disposed = true;
    this.texture.dispose();
    for (const { mesh } of this.panels) (mesh.material as THREE.Material).dispose();
    this.panels[0]?.mesh.geometry.dispose();
    this.group.removeFromParent();
  }
}
