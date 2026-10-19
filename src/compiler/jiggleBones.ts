import * as THREE from "three";
import { turnMatrix, turnTowards, type BoneTurn } from "./boneAxes";
import type { JiggleParams } from "../viewer/jiggle";

/**
 * Jiggle bones of an item: the bones the artist's model brings that the class does not have can be given spring physics with the QC
 * command `$jigglebone` (the compiled model then carries it, and the game's client runs it: viewer/jiggle.ts is a port of that code).
 * The setup is what that command takes; the angles are in degrees here and in the QC, in radians in the compiled model.
 *
 * The bone points along its local Z axis, yaw swings it around Y (the tip moves in the X-Z plane) and pitch around X (the Y-Z plane), so
 * how the bone's axes lie decides what every one of the numbers does: see boneAxes.ts for turning them.
 */
export interface JiggleConstraint {
  on: boolean;
  /** Degrees. */
  min: number;
  max: number;
  friction: number;
  bounce: number;
}

export interface BaseSpringAxis { min: number; max: number; friction: number }

export interface JiggleSetup {
  /** A flexible bone springs back to where its animation puts it; a rigid one only has a length (and can be a base spring's). */
  mode: "flexible" | "rigid";
  length: number;
  tipMass: number;
  yawStiffness: number;
  yawDamping: number;
  pitchStiffness: number;
  pitchDamping: number;
  /** The tip may stretch along the bone (allow_length_flex), with its own spring. */
  allowLengthFlex: boolean;
  alongStiffness: number;
  alongDamping: number;
  yaw: JiggleConstraint;
  pitch: JiggleConstraint;
  angle: { on: boolean; /** Degrees. */ limit: number };
  baseSpring: { on: boolean; mass: number; stiffness: number; damping: number; left: BaseSpringAxis; up: BaseSpringAxis; forward: BaseSpringAxis };
  boing: { on: boolean; impactSpeed: number; /** Degrees. */ impactAngle: number; dampingRate: number; frequency: number; amplitude: number };
}

const constraint = (): JiggleConstraint => ({ on: false, min: -30, max: 30, friction: 0, bounce: 0 });
const axis = (): BaseSpringAxis => ({ min: -5, max: 5, friction: 0 });

/** A flexible bone with the values a tail or a tassel usually starts from. */
export function defaultJiggle(length = 10): JiggleSetup {
  return {
    mode: "flexible", length, tipMass: 0,
    yawStiffness: 100, yawDamping: 7, pitchStiffness: 100, pitchDamping: 7,
    allowLengthFlex: false, alongStiffness: 100, alongDamping: 0,
    yaw: constraint(), pitch: constraint(), angle: { on: false, limit: 30 },
    baseSpring: { on: false, mass: 1, stiffness: 100, damping: 7, left: axis(), up: axis(), forward: axis() },
    boing: { on: false, impactSpeed: 150, impactAngle: 30, dampingRate: 0.15, frequency: 30, amplitude: 0.2 },
  };
}

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const flag = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

function readConstraint(raw: unknown, base: JiggleConstraint): JiggleConstraint {
  const v = (raw && typeof raw === "object" ? raw : {}) as Partial<JiggleConstraint>;
  return { on: flag(v.on, base.on), min: num(v.min, base.min), max: num(v.max, base.max), friction: num(v.friction, base.friction), bounce: num(v.bounce, base.bounce) };
}

function readAxis(raw: unknown, base: BaseSpringAxis): BaseSpringAxis {
  const v = (raw && typeof raw === "object" ? raw : {}) as Partial<BaseSpringAxis>;
  return { min: num(v.min, base.min), max: num(v.max, base.max), friction: num(v.friction, base.friction) };
}

/** A saved setup, with what is missing or malformed taken from the defaults. */
export function readJiggle(raw: unknown): JiggleSetup {
  const base = defaultJiggle();
  const v = (raw && typeof raw === "object" ? raw : {}) as Partial<JiggleSetup>;
  const spring = (v.baseSpring && typeof v.baseSpring === "object" ? v.baseSpring : {}) as Partial<JiggleSetup["baseSpring"]>;
  const boing = (v.boing && typeof v.boing === "object" ? v.boing : {}) as Partial<JiggleSetup["boing"]>;
  const angle = (v.angle && typeof v.angle === "object" ? v.angle : {}) as Partial<JiggleSetup["angle"]>;
  return {
    mode: v.mode === "rigid" ? "rigid" : "flexible",
    length: num(v.length, base.length), tipMass: num(v.tipMass, base.tipMass),
    yawStiffness: num(v.yawStiffness, base.yawStiffness), yawDamping: num(v.yawDamping, base.yawDamping),
    pitchStiffness: num(v.pitchStiffness, base.pitchStiffness), pitchDamping: num(v.pitchDamping, base.pitchDamping),
    allowLengthFlex: flag(v.allowLengthFlex, base.allowLengthFlex), alongStiffness: num(v.alongStiffness, base.alongStiffness), alongDamping: num(v.alongDamping, base.alongDamping),
    yaw: readConstraint(v.yaw, base.yaw), pitch: readConstraint(v.pitch, base.pitch), angle: { on: flag(angle.on, false), limit: num(angle.limit, base.angle.limit) },
    baseSpring: {
      on: flag(spring.on, false), mass: num(spring.mass, base.baseSpring.mass), stiffness: num(spring.stiffness, base.baseSpring.stiffness), damping: num(spring.damping, base.baseSpring.damping),
      left: readAxis(spring.left, base.baseSpring.left), up: readAxis(spring.up, base.baseSpring.up), forward: readAxis(spring.forward, base.baseSpring.forward),
    },
    boing: { on: flag(boing.on, false), impactSpeed: num(boing.impactSpeed, base.boing.impactSpeed), impactAngle: num(boing.impactAngle, base.boing.impactAngle), dampingRate: num(boing.dampingRate, base.boing.dampingRate), frequency: num(boing.frequency, base.boing.frequency), amplitude: num(boing.amplitude, base.boing.amplitude) },
  };
}

/** A number as the QC writes it: no trailing zeros. */
const n = (v: number) => String(Math.round(v * 1e6) / 1e6);

/** The `$jigglebone` block of a bone, as studiomdl takes it (what the game's own QC files and the TFMV editor write). */
export function jiggleQc(bone: string, s: JiggleSetup): string {
  const out: string[] = [`$jigglebone "${bone}"`, "{"];
  const constraints = () => {
    if (s.pitch.on) out.push(`\t\tpitch_constraint ${n(s.pitch.min)} ${n(s.pitch.max)}`, `\t\tpitch_friction ${n(s.pitch.friction)}`, `\t\tpitch_bounce ${n(s.pitch.bounce)}`);
    if (s.yaw.on) out.push(`\t\tyaw_constraint ${n(s.yaw.min)} ${n(s.yaw.max)}`, `\t\tyaw_friction ${n(s.yaw.friction)}`, `\t\tyaw_bounce ${n(s.yaw.bounce)}`);
    if (s.angle.on) out.push(`\t\tangle_constraint ${n(s.angle.limit)}`);
  };
  if (s.mode === "flexible") {
    out.push("\tis_flexible", "\t{", `\t\tlength ${n(s.length)}`, `\t\ttip_mass ${n(s.tipMass)}`,
      `\t\tpitch_stiffness ${n(s.pitchStiffness)}`, `\t\tpitch_damping ${n(s.pitchDamping)}`, `\t\tyaw_stiffness ${n(s.yawStiffness)}`, `\t\tyaw_damping ${n(s.yawDamping)}`);
    if (s.allowLengthFlex) out.push("\t\tallow_length_flex");
    out.push(`\t\talong_stiffness ${n(s.alongStiffness)}`, `\t\talong_damping ${n(s.alongDamping)}`);
    constraints();
    out.push("\t}");
  } else {
    out.push("\tis_rigid", "\t{", `\t\tlength ${n(s.length)}`, `\t\ttip_mass ${n(s.tipMass)}`);
    constraints();
    out.push("\t}");
  }
  if (s.baseSpring.on) {
    const b = s.baseSpring;
    out.push("\thas_base_spring", "\t{", `\t\tbase_mass ${n(b.mass)}`, `\t\tstiffness ${n(b.stiffness)}`, `\t\tdamping ${n(b.damping)}`,
      `\t\tleft_constraint ${n(b.left.min)} ${n(b.left.max)}`, `\t\tleft_friction ${n(b.left.friction)}`,
      `\t\tup_constraint ${n(b.up.min)} ${n(b.up.max)}`, `\t\tup_friction ${n(b.up.friction)}`,
      `\t\tforward_constraint ${n(b.forward.min)} ${n(b.forward.max)}`, `\t\tforward_friction ${n(b.forward.friction)}`, "\t}");
  }
  if (s.boing.on) {
    const b = s.boing;
    out.push("\tis_boing", "\t{", `\t\timpact_speed ${n(b.impactSpeed)}`, `\t\timpact_angle ${n(b.impactAngle)}`, `\t\tdamping_rate ${n(b.dampingRate)}`, `\t\tfrequency ${n(b.frequency)}`, `\t\tamplitude ${n(b.amplitude)}`, "\t}");
  }
  out.push("}");
  return out.join("\n") + "\n";
}

/** The `$jigglebone` blocks of the bones of a model that has them, in the model's bone order. */
export function jiggleQcFor(bones: string[], setups: Record<string, JiggleSetup>): string {
  return bones.filter((b) => setups[b]).map((b) => jiggleQc(b, setups[b])).join("\n");
}

const FLEXIBLE = 0x01, RIGID = 0x02, YAW = 0x04, PITCH = 0x08, ANGLE = 0x10, LENGTH = 0x20, BASE = 0x40, BOING = 0x80;
const rad = (degrees: number) => (degrees * Math.PI) / 180;

/** What the compiled model holds for a setup (and what the viewer's simulation runs on): flags, with the angles in radians. */
export function jiggleParams(s: JiggleSetup): JiggleParams {
  let flags = s.mode === "flexible" ? FLEXIBLE : RIGID;
  if (s.yaw.on) flags |= YAW;
  if (s.pitch.on) flags |= PITCH;
  if (s.angle.on) flags |= ANGLE;
  if (s.mode === "flexible" && !s.allowLengthFlex) flags |= LENGTH;
  if (s.baseSpring.on) flags |= BASE;
  if (s.boing.on) flags |= BOING;
  const b = s.baseSpring;
  return {
    flags, length: s.length, tipMass: s.tipMass,
    yawStiffness: s.yawStiffness, yawDamping: s.yawDamping, pitchStiffness: s.pitchStiffness, pitchDamping: s.pitchDamping,
    alongStiffness: s.alongStiffness, alongDamping: s.alongDamping, angleLimit: rad(s.angle.limit),
    minYaw: rad(s.yaw.min), maxYaw: rad(s.yaw.max), minPitch: rad(s.pitch.min), maxPitch: rad(s.pitch.max),
    baseMass: b.mass, baseStiffness: b.stiffness, baseDamping: b.damping,
    baseMin: [b.left.min, b.up.min, b.forward.min], baseMax: [b.left.max, b.up.max, b.forward.max], baseFriction: [b.left.friction, b.up.friction, b.forward.friction],
    // the model keeps the cosine of the angle (a boing starts when the direction of the movement turns by more than it)
    boingImpactSpeed: s.boing.impactSpeed, boingImpactAngle: Math.cos(rad(s.boing.impactAngle)), boingDampingRate: s.boing.dampingRate, boingFrequency: s.boing.frequency, boingAmplitude: s.boing.amplitude,
  };
}

/** Degrees from radians, as a setup stores its angles. */
const deg = (radians: number) => (radians * 180) / Math.PI;

const _clampM = new THREE.Matrix4();
const _clampDir = new THREE.Vector3();
const _clampQ = new THREE.Quaternion();
const _clampQ2 = new THREE.Quaternion();
const _Z = new THREE.Vector3(0, 0, 1);

/**
 * Clamps a hand aim (a turn about the bone's own axes) to the bone's jiggle limits, so an override pose can never point the bone past its
 * yaw, pitch or angle constraint. Mirrors the solver's checks: yaw swings about Y (the X-Z plane), pitch about X (the Y-Z plane), and the
 * angle is the deviation from the bone's own +Z. Returns the clamped turn in degrees (no roll: a turn is only an aim here).
 */
export function clampAimToLimits(params: JiggleParams, turn: BoneTurn): BoneTurn {
  const d = _clampDir.setFromMatrixColumn(turnMatrix(turn, _clampM), 2).normalize(); // where this turn points the bone's +Z
  const f = params.flags;
  if (f & YAW) {
    const yaw = Math.atan2(d.x, d.z);
    const c = Math.min(Math.max(yaw, params.minYaw), params.maxYaw);
    if (c !== yaw) { const r = Math.hypot(d.x, d.z); d.x = r * Math.sin(c); d.z = r * Math.cos(c); }
  }
  if (f & PITCH) {
    const pitch = Math.atan2(d.y, d.z);
    const c = Math.min(Math.max(pitch, params.minPitch), params.maxPitch);
    if (c !== pitch) { const r = Math.hypot(d.y, d.z); d.y = r * Math.sin(c); d.z = r * Math.cos(c); }
  }
  d.normalize();
  if (f & ANGLE) {
    const angle = Math.acos(Math.min(1, Math.max(-1, d.z)));
    if (angle > params.angleLimit + 1e-9 && angle > 1e-6) {
      // bring the deviation from +Z back to the limit, along the same great circle
      _clampQ.setFromUnitVectors(_Z, d);
      _clampQ2.identity().slerp(_clampQ, params.angleLimit / angle);
      d.copy(_Z).applyQuaternion(_clampQ2);
    }
  }
  return turnTowards(d);
}

/**
 * The inverse of `jiggleParams`: a `JiggleSetup` from what a compiled model carries, for the READ-ONLY inspector. Angles come back to
 * degrees and the flags become the on/off switches. The yaw/pitch constraint friction and bounce are not used by the simulation (the
 * solver zeroes the tip velocity at the limit); they are shown only because the model stores them, and are 0 when a source omits them.
 */
export function paramsToSetup(p: JiggleParams): JiggleSetup {
  const flexible = (p.flags & FLEXIBLE) !== 0;
  return {
    mode: flexible ? "flexible" : "rigid",
    length: p.length, tipMass: p.tipMass,
    yawStiffness: p.yawStiffness, yawDamping: p.yawDamping, pitchStiffness: p.pitchStiffness, pitchDamping: p.pitchDamping,
    allowLengthFlex: flexible && (p.flags & LENGTH) === 0, alongStiffness: p.alongStiffness, alongDamping: p.alongDamping,
    yaw: { on: (p.flags & YAW) !== 0, min: deg(p.minYaw), max: deg(p.maxYaw), friction: p.yawFriction ?? 0, bounce: p.yawBounce ?? 0 },
    pitch: { on: (p.flags & PITCH) !== 0, min: deg(p.minPitch), max: deg(p.maxPitch), friction: p.pitchFriction ?? 0, bounce: p.pitchBounce ?? 0 },
    angle: { on: (p.flags & ANGLE) !== 0, limit: deg(p.angleLimit) },
    baseSpring: {
      on: (p.flags & BASE) !== 0, mass: p.baseMass, stiffness: p.baseStiffness, damping: p.baseDamping,
      left: { min: p.baseMin[0], max: p.baseMax[0], friction: p.baseFriction[0] },
      up: { min: p.baseMin[1], max: p.baseMax[1], friction: p.baseFriction[1] },
      forward: { min: p.baseMin[2], max: p.baseMax[2], friction: p.baseFriction[2] },
    },
    boing: {
      on: (p.flags & BOING) !== 0, impactSpeed: p.boingImpactSpeed,
      // the model keeps the cosine of the impact angle; the setup keeps the angle in degrees
      impactAngle: deg(Math.acos(Math.min(1, Math.max(-1, p.boingImpactAngle)))),
      dampingRate: p.boingDampingRate, frequency: p.boingFrequency, amplitude: p.boingAmplitude,
    },
  };
}

/**
 * The `$jigglebone` blocks of a QC text, by bone name (what `jiggleQc` writes, and what artists write in the importer's QC editor). A
 * command it does not know is skipped; a block's own commands switch its parts on (constraints, base spring, boing, length flex).
 */
export function parseJiggleQc(text: string): Record<string, JiggleSetup> {
  const tokens = text.replace(/\/\/[^\n]*/g, "").match(/"[^"]*"|\{|\}|[^\s{}"]+/g) ?? [];
  const unquote = (t: string) => (t.startsWith('"') ? t.slice(1, -1) : t);
  const out: Record<string, JiggleSetup> = {};
  let at = 0;
  const number = () => { const v = Number(unquote(tokens[at++] ?? "")); return Number.isFinite(v) ? v : 0; };
  /** The commands of a { } block, as [name, handler] arguments by count. */
  const block = (commands: Record<string, () => void>) => {
    if (tokens[at] !== "{") return;
    at++;
    while (at < tokens.length && tokens[at] !== "}") {
      const name = unquote(tokens[at++]).toLowerCase();
      commands[name]?.();
    }
    at++;
  };
  while (at < tokens.length) {
    if (tokens[at++].toLowerCase() !== "$jigglebone") continue;
    const bone = unquote(tokens[at++] ?? "");
    const s = defaultJiggle(10);
    const common = (): Record<string, () => void> => ({
      length: () => { s.length = number(); },
      tip_mass: () => { s.tipMass = number(); },
      pitch_stiffness: () => { s.pitchStiffness = number(); },
      pitch_damping: () => { s.pitchDamping = number(); },
      yaw_stiffness: () => { s.yawStiffness = number(); },
      yaw_damping: () => { s.yawDamping = number(); },
      allow_length_flex: () => { s.allowLengthFlex = true; },
      along_stiffness: () => { s.alongStiffness = number(); },
      along_damping: () => { s.alongDamping = number(); },
      pitch_constraint: () => { s.pitch.on = true; s.pitch.min = number(); s.pitch.max = number(); },
      pitch_friction: () => { s.pitch.friction = number(); },
      pitch_bounce: () => { s.pitch.bounce = number(); },
      yaw_constraint: () => { s.yaw.on = true; s.yaw.min = number(); s.yaw.max = number(); },
      yaw_friction: () => { s.yaw.friction = number(); },
      yaw_bounce: () => { s.yaw.bounce = number(); },
      angle_constraint: () => { s.angle.on = true; s.angle.limit = number(); },
    });
    block({
      is_flexible: () => { s.mode = "flexible"; block(common()); },
      is_rigid: () => { s.mode = "rigid"; block(common()); },
      has_base_spring: () => {
        s.baseSpring.on = true;
        const b = s.baseSpring;
        block({
          base_mass: () => { b.mass = number(); },
          stiffness: () => { b.stiffness = number(); },
          damping: () => { b.damping = number(); },
          left_constraint: () => { b.left.min = number(); b.left.max = number(); },
          left_friction: () => { b.left.friction = number(); },
          up_constraint: () => { b.up.min = number(); b.up.max = number(); },
          up_friction: () => { b.up.friction = number(); },
          forward_constraint: () => { b.forward.min = number(); b.forward.max = number(); },
          forward_friction: () => { b.forward.friction = number(); },
        });
      },
      is_boing: () => {
        s.boing.on = true;
        const b = s.boing;
        block({
          impact_speed: () => { b.impactSpeed = number(); },
          impact_angle: () => { b.impactAngle = number(); },
          damping_rate: () => { b.dampingRate = number(); },
          frequency: () => { b.frequency = number(); },
          amplitude: () => { b.amplitude = number(); },
        });
      },
    });
    if (bone) out[bone] = s;
  }
  return out;
}
