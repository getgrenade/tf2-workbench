import * as THREE from "three";
import type { Actor } from "../actor";
import { loadDefinitions, loadUnusualCatalog, loadParticleMaterial, loadParticleModel, particleSystemForTeam, UNUSUALS, type ParticleModelInfo, type UnusualId, type UnusualSettings } from "./assets";
import { ParticleDraw } from "./render";
import { ParticleRopeDraw } from "./rope";
import { ParticleSimulation, validateDefinitions, type ModelSample, type ParticleQueries } from "./simulation";
import { NativeSimulation } from "./native";
import { SOURCE_TO_VIEWER } from "../animator";

const TO_SOURCE = SOURCE_TO_VIEWER.clone().invert();

/** The draws of every renderer of a simulation's systems (the sprites and ropes; the rest of the renderers submit no geometry in Source). */
export async function buildDraws(sim: ParticleSimulation | NativeSimulation): Promise<(ParticleDraw | ParticleRopeDraw)[]> {
  const draws: (ParticleDraw | ParticleRopeDraw)[] = [];
  for (const node of sim.walk()) {
    for (const [rendererIndex, entry] of node.definition.functions.renderers.entries()) {
      const renderer = entry.attributes.functionName;
      if (!["render_rope", "render_animated_sprites", "render_sprite_trail", "render_screen_velocity_rotate"].includes(String(renderer)))
        throw new Error(`Unsupported particle renderer: ${renderer}`);
      // This renderer changes sprite roll; it does not submit geometry in Source.
      if (renderer === "render_screen_velocity_rotate") continue;
      const material = await loadParticleMaterial(String(node.definition.attributes.material));
      if (material.refract && renderer === "render_rope") throw new Error(`A rope cannot use the Refract material of ${node.definition.name}`);
      draws.push(renderer === "render_rope" ? new ParticleRopeDraw(node, material, rendererIndex) : new ParticleDraw(node, material, rendererIndex));
    }
  }
  return draws;
}

/** Effects stay per actor; changing selection never transfers particles to another merc. */
export class ActorEffects {
  readonly group = new THREE.Group();
  /**
   * The particles live in the world, as they do in the game: the control points and the hitboxes the simulation reads are put in world
   * space, so that a character that walks (or is dragged) leaves what it has emitted behind (the lingering steps of Electrocution, the trail
   * of a hat). The effects of the compatibility backend are simulated in the space of the character instead.
   */
  private world = true;
  /** Source space of the character (bones, attachments) into world Source space. */
  private readonly toWorld = new THREE.Matrix4();
  private readonly simulations: (ParticleSimulation | NativeSimulation)[] = [];
  nativeSilver = false;
  private readonly draws: (ParticleDraw | ParticleRopeDraw)[] = [];
  private accumulated = 0;
  /** Real time seen by the effect (what the clock of the view says, not what the helper has simulated). */
  private clock = 0;
  private disposed = false;
  private constructor(readonly actor: Actor) { this.group.matrixAutoUpdate = false; this.group.name = "Unusual effects"; }

  /** Held: the effect does not run with the clock (a picture is being taken of it as it is), though it is still drawn. */
  hold = false;

  /**
   * `seed` tells the particles' chances apart: two effects made with the same seed and run the same time look the same (the fallback
   * simulator's; the native one has chances of its own).
   */
  static async create(actor: Actor, settings: UnusualSettings, onError: (error: unknown) => void = console.error, floor: () => number | null = () => null, seed = 0): Promise<ActorEffects> {
    const effect = new ActorEffects(actor);
    try {
      const data = actor.particleModel;
      if (!data) throw new Error("Character is still loading");
      const model = await loadParticleModel(data.path);
      const own = settings.items ?? [];
      const catalog = settings.hatEffect || settings.tauntEffect || own.length ? await loadUnusualCatalog() : [];
      effect.world = !(settings.arctic && !settings.tauntEffect);
      effect.updateFrame();
      // what plays: the hat effect (on the hat picked), the taunt effect, and the effect each worn item always shows (on that item)
      const lanes: { kind: "hat" | "taunt"; item: number | null; selected: number | undefined; system?: string; attachment?: string; preset: UnusualId | null; chosen: boolean }[] = [
        { kind: "hat", item: settings.hatItem, selected: settings.hatEffect, preset: settings.silver ? "silver" : null, chosen: true },
        { kind: "taunt", item: null, selected: settings.tauntEffect, preset: settings.arctic ? "arctic" : null, chosen: true },
        ...own.map((x) => ({ kind: "hat" as const, item: x.item, selected: x.effect, system: x.system, attachment: x.attachment, preset: null, chosen: false })),
      ];
      for (const lane of lanes) {
        const { kind, selected } = lane;
        const id = lane.preset;
        if (!id && !selected && !lane.system) continue;
        const hat = kind === "hat" ? actor.particleCosmetic(lane.item) : null;
        const hatModel = hat ? await loadParticleModel(hat.path) : null;
        // a chosen effect is of its kind's list; an item's own effect is found by its id alone (some are filed among the taunt effects),
        // or by the name of its system
        const config = selected ? catalog.find((e) => e.id === selected && (!lane.chosen || e.kind === kind))
          : lane.system ? catalog.find((e) => e.system === lane.system) : UNUSUALS[id!];
        if (!config?.file) throw new Error(`Particle definition not installed for ${kind} effect ${selected !== undefined ? `#${selected}` : lane.system ?? id}`);
        const attachmentName = lane.attachment ?? ("attachment" in config ? config.attachment : "unusual");
        // an effect an item always shows plays at an attachment of its model: a style whose model has none (the cigarette left out) shows no effect,
        // not one from the middle of the head
        if (!lane.chosen && kind === "hat" && lane.item !== null && hatModel && !hatModel.attachments.some((x) => x.name.toLowerCase() === attachmentName.toLowerCase())) continue;
        const rootBoneFallback = "root_bone" in config ? config.root_bone : true;
        const root = particleSystemForTeam(config.system, actor.particleTeam);
        const file = catalog.find((e) => e.system === root)?.file ?? config.file;
        const definitions = await loadDefinitions(file);
        if (!definitions.has(root)) throw new Error(`Particle definition missing: ${root}`);
        const cp = new THREE.Matrix4();
        const queries: ParticleQueries = {
          controlPoint: () => {
            cp.identity();
            if (kind === "hat") {
              if (lane.item === null && lane.attachment) bodyControlPoint(actor, model, lane.attachment, cp);
              else hatControlPoint(actor, lane.item, hat, hatModel, attachmentName, rootBoneFallback, cp);
            }
            return effect.world ? effect.inWorld(cp) : cp;
          },
          bone: (index) => actor.particleBoneFrame(index),
          sampleModel: (random, scale, bias) => sampleHitbox(actor, model, random, scale, bias),
        };
        // Keep the visually confirmed Arctic backend; new effects use Valve's complete operator set.
        const native = !(settings.arctic && !selected && kind === "taunt")
          ? await NativeSimulation.create(definitions, queries.controlPoint, onError, file, root, () => nativeHitboxes(actor, model, effect.world ? effect.toWorld : undefined), "refire" in config ? config.refire : 0, [], [], 1, () => [], () => [], () => (effect.world ? floor() : null), (273 + seed) >>> 0) : null;
        if (native && id === "silver") effect.nativeSilver = true;
        if (!native) validateDefinitions(definitions, root);
        const sim = native ?? new ParticleSimulation(definitions.get(root)!, definitions, queries, ((selected ?? ("id" in config ? config.id : id === "silver" ? 273 : 3141)) + seed) >>> 0);
        effect.simulations.push(sim);
        await effect.addDraws(sim);
      }
      effect.attach();
      return effect;
    } catch (err) { effect.dispose(); throw err; }
  }

  private async addDraws(sim: ParticleSimulation | NativeSimulation) {
    for (const draw of await buildDraws(sim)) { this.draws.push(draw); this.group.add(draw.mesh); }
  }
  /** A matrix in the space of the character, in the space the simulation runs in (the world's, without the character's scale in its axes). */
  private inWorld(local: THREE.Matrix4): THREE.Matrix4 {
    const out = this.worldFrame.multiplyMatrices(this.toWorld, local), e = out.elements;
    for (const column of [0, 4, 8]) {
      const length = Math.hypot(e[column], e[column + 1], e[column + 2]);
      if (length > 1e-8) { e[column] /= length; e[column + 1] /= length; e[column + 2] /= length; }
    }
    return out;
  }
  private readonly worldFrame = new THREE.Matrix4();
  private updateFrame() { this.toWorld.multiplyMatrices(TO_SOURCE, this.actor.particleRootFrame()); }
  private attach() { if (this.world) this.actor.attachWorldParticles(this.group); else this.actor.attachParticles(this.group); }
  /** Runs the effect `seconds` ahead at once (every simulation of it), as if that much time had passed. */
  async advance(seconds: number): Promise<void> {
    if (this.disposed || seconds <= 0) return;
    this.updateFrame();
    this.attach();
    this.clock += seconds;
    for (const sim of this.simulations) {
      if (sim instanceof NativeSimulation) await sim.advance(seconds);
      else sim.advance(seconds);
    }
  }
  step(dt: number, camera: THREE.Camera) {
    if (this.disposed) return;
    this.updateFrame();
    this.attach();
    if (!this.hold) {
      this.accumulated += Math.min(dt, 0.1);
      this.clock += Math.min(dt, 0.1);
      while (this.accumulated >= 1 / 60) { for (const sim of this.simulations) sim.step(1 / 60); this.accumulated -= 1 / 60; }
    }
    // the state of a simulation is behind the clock by the ticks that are on their way: the draws go on by that much (but not by more than three ticks)
    for (const sim of this.simulations) if (sim instanceof NativeSimulation) {
      const lead = THREE.MathUtils.clamp(this.clock - sim.simClock, 0, 3 / 60);
      for (const node of sim.walk()) node.lead = lead;
    }
    this.group.updateWorldMatrix(true, true);
    for (const draw of this.draws) draw.update(camera);
  }
  get needsSceneDepth(): boolean { return this.draws.some((draw) => draw instanceof ParticleDraw && draw.needsSceneDepth); }
  get needsSceneColor(): boolean { return this.draws.some((draw) => draw instanceof ParticleDraw && draw.needsSceneColor); }
  setSceneDepth(texture: THREE.Texture | null, camera: THREE.Camera, width: number, height: number, color: THREE.Texture | null = null) {
    for (const draw of this.draws) if (draw instanceof ParticleDraw) draw.setSceneDepth(texture, camera, width, height, color);
  }
  dispose() {
    this.disposed = true;
    for (const sim of this.simulations) if (sim instanceof NativeSimulation) sim.dispose();
    for (const draw of this.draws) draw.dispose();
    this.draws.length = 0; this.simulations.length = 0;
    this.group.removeFromParent();
  }
}

/** Hat preview routing: preserve authored attachments, then use the wearable's unusual anchor.
 * Older schemas omit attachment or name weapon-only "muzzle". Literal root-bone fallback
 * places effects at the pelvis on modern hats retaining a complete parent chain.
 * Head fallback uses the bone order supported by TF's particle_effect_use_head_origin override.
 */
/** An attachment of the character's own model (the Spy's `cig_smoke`), else the head. */
export function bodyControlPoint(actor: Actor, model: ParticleModelInfo, attachmentName: string, out = new THREE.Matrix4()): THREE.Matrix4 {
  out.identity();
  const named = model.attachments.find((a) => a.name.toLowerCase() === attachmentName.toLowerCase());
  const bone = named ? actor.particleBoneFrame(named.bone) : null;
  if (named && bone) return out.copy(bone).multiply(named.local);
  const headIndex = actor.boneNames.findIndex((name) => /^(bip_head|head)$/i.test(name));
  const head = actor.particleBoneFrame(headIndex);
  return head ? out.copy(head) : out;
}

export function hatControlPoint(actor: Actor, itemId: number | null, hat: Actor["particleModel"], model: ParticleModelInfo | null,
  attachmentName: string, rootBoneFallback: boolean, out = new THREE.Matrix4()): THREE.Matrix4 {
  out.identity();
  if (hat && model) {
    const named = model.attachments.find((a) => a.name.toLowerCase() === attachmentName.toLowerCase());
    const unusual = model.attachments.find((a) => a.name.toLowerCase() === "unusual");
    for (const attachment of [named, unusual]) {
      if (!attachment) continue;
      const bone = actor.particleCosmeticBoneFrame(itemId, hat.path, attachment.bone);
      if (bone) return out.copy(bone).multiply(attachment.local);
    }
    for (const name of ["bip_head", "prp_helmet", "prp_hat", "head"]) {
      const index = hat.bones.findIndex((b) => b.name.toLowerCase() === name);
      const bone = index >= 0 ? actor.particleCosmeticBoneFrame(itemId, hat.path, index) : null;
      if (bone) return out.copy(bone);
    }
    if (rootBoneFallback) {
      const root = actor.particleCosmeticRootFrame(itemId, hat.path);
      if (root) return out.copy(root);
    }
  }
  const headIndex = actor.boneNames.findIndex((name) => /^(bip_head|head)$/i.test(name));
  const head = actor.particleBoneFrame(headIndex);
  if (head) {
    // Bare-head previews use world-up, rather than the head bone's neck-facing axes.
    const position = new THREE.Vector3().setFromMatrixPosition(head);
    position.z += 8;
    out.setPosition(position);
  }
  return out;
}

/** Source hitbox bounds followed by the posed bone's row-major 3x4 transform. */
export function nativeHitboxes(actor: Actor, model: ParticleModelInfo, toWorld?: THREE.Matrix4): number[][] {
  const world = new THREE.Matrix4();
  return model.hitboxes.map((box) => {
    const bone = actor.particleBoneFrame(box.bone);
    if (!bone) throw new Error(`Particle hitbox bone missing: ${box.bone}`);
    const matrix = toWorld ? world.multiplyMatrices(toWorld, bone) : bone;
    const e = matrix.elements;
    return [...box.min.toArray(), ...box.max.toArray(), e[0], e[4], e[8], e[12], e[1], e[5], e[9], e[13], e[2], e[6], e[10], e[14]];
  });
}

/**
 * The hitboxes a weapon's particles spread over (Position on Model Random on its control point), in the format of {@link nativeHitboxes}.
 * A weapon model without hitboxes gets one box around its meshes.
 */
export function cosmeticHitboxes(actor: Actor, itemId: number, path: string, model: ParticleModelInfo): () => number[][] {
  let boxes = model.hitboxes;
  if (!boxes.length) {
    const bounds = new THREE.Box3(), p = new THREE.Vector3();
    for (const part of actor.particleCosmetic(itemId)?.bodyParts ?? [])
      for (const mesh of part.models[0]?.meshes ?? [])
        for (let i = 0; i + 2 < mesh.positions.length; i += 3) bounds.expandByPoint(p.set(mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]));
    boxes = bounds.isEmpty() ? [] : [{ bone: 0, min: bounds.min.clone(), max: bounds.max.clone() }];
  }
  return () => boxes.flatMap((box) => {
    const matrix = actor.particleCosmeticBoneFrame(itemId, path, box.bone);
    if (!matrix) return [];
    const e = matrix.elements;
    return [[...box.min.toArray(), ...box.max.toArray(), e[0], e[4], e[8], e[12], e[1], e[5], e[9], e[13], e[2], e[6], e[10], e[14]]];
  });
}

/** Mirrors particlesystemquery.cpp: random hitbox/local coordinates with optional direction-biased attempts. */
export function sampleHitbox(actor: Actor, model: ParticleModelInfo, random: () => number, scale: number, bias: THREE.Vector3): ModelSample {
  if (!model.hitboxes.length) throw new Error("Character has no particle hitboxes");
  let best = -Infinity;
  const result: ModelSample = { position: new THREE.Vector3(), local: new THREE.Vector3(), bone: -1 };
  const attempts = bias.lengthSq() > 1e-8 ? 6 : 1;
  for (let i = 0; i < attempts; i++) {
    const box = model.hitboxes[Math.min(model.hitboxes.length - 1, Math.floor(random() * model.hitboxes.length))];
    const bone = actor.particleBoneFrame(box.bone);
    if (!bone) continue;
    const coord = () => THREE.MathUtils.lerp(1 - scale, scale, random());
    const local = new THREE.Vector3(THREE.MathUtils.lerp(box.min.x, box.max.x, coord()), THREE.MathUtils.lerp(box.min.y, box.max.y, coord()), THREE.MathUtils.lerp(box.min.z, box.max.z, coord()));
    const position = local.clone().applyMatrix4(bone), goodness = random() * 72 + position.dot(bias);
    if (goodness > best) { best = goodness; result.position.copy(position); result.local.copy(local); result.bone = box.bone; }
  }
  return result;
}
