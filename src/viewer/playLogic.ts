// The rules of play mode (steering a character like in the game) without any rendering or IPC, so they can be tested on their own.

/** The kinds of movement animation a player entity picks between (the sequence names are `<kind>_<weapon set>`). */
export type Locomotion = "stand" | "crouch" | "run" | "crouch_walk" | "jump_start" | "jump_float" | "jumpland" | "airwalk";

/** Running speed per class in Source units per second (tf_shareddefs: the classes' max speeds). */
export const CLASS_SPEED: Record<string, number> = {
  scout: 400,
  soldier: 240,
  pyro: 300,
  demoman: 280,
  heavy: 230,
  engineer: 300,
  medic: 320,
  sniper: 300,
  spy: 320,
};

/** Crouched players move at a third of their speed. */
export const CROUCH_SPEED_SCALE = 1 / 3;
/** The game's jump (CTFGameMovement::CheckJumpButton: 268.33 = sqrt(2 * 800 * 45), a 45 unit jump) under its sv_gravity of 800. */
const JUMP_SPEED = 268.3281573;
const GRAVITY = 800;
const GROUND_ACCEL = 14;
const AIR_ACCEL = 1.5;
/** Below this speed (a fraction of the limit) the character counts as standing. */
const MOVING_FRACTION = 0.08;

/** The things a player can do on top of moving (the game's gestures): attacking, reloading and the voice-command arm gestures. */
export type PlayAction = "attack" | "reload" | "go" | "help" | "cheer" | "positive";
export const PLAY_ACTIONS: { id: PlayAction; label: string; key: string }[] = [
  { id: "attack", label: "Attack", key: "LMB" },
  { id: "reload", label: "Reload", key: "R" },
  { id: "go", label: "Go", key: "3" },
  { id: "help", label: "Help", key: "4" },
  { id: "cheer", label: "Cheer", key: "5" },
  { id: "positive", label: "Positive", key: "6" },
];

export type PlayDamageAction="ragdoll"|"explode"|"resetDamage"|"toggleDamage";
export const PLAY_DAMAGE_ACTIONS:{id:PlayDamageAction;label:string;key:string}[]=[
  {id:"ragdoll",label:"Ragdoll",key:"1"},{id:"explode",label:"Explode",key:"2"},
  {id:"resetDamage",label:"Reset damage",key:"8"},{id:"toggleDamage",label:"Damage",key:"9"},
];

export const PLAY_SLOTS = ["primary", "secondary", "melee", "utility"] as const;
export type PlaySlot = (typeof PLAY_SLOTS)[number];

export function secondaryMode(gameClass: string, slot: PlaySlot | null, sets: readonly string[]): "minigun" | "scope" | null {
  if (slot !== "primary" || sets[0]?.toLowerCase() !== "primary") return null;
  return gameClass === "heavy" ? "minigun" : gameClass === "sniper" ? "scope" : null;
}

/** TF2's deployed activities use different sequence names from ordinary locomotion. */
export function findDeployedSequence(names: ReadonlyMap<string, number>, kind: Locomotion, set="primary"): number | null {
  const candidates = kind === "crouch_walk" ? ["deployed_crouch_walk_primary", "crouch_deployed_primary"]
    : kind === "crouch" ? ["crouch_deployed_primary"]
    : kind === "run" ? ["primary_deployed_movement", "stand_deployed_primary"]
    : ["stand_deployed_primary"];
  return candidates.map(name=>name.replaceAll("primary",set)).concat(kind==="crouch_walk" ? [`crouch_walk_${set}_deployed`] : []).map((name) => names.get(name)).find((seq) => seq !== undefined) ?? null;
}

/** Medi Gun keeps its prefire gesture at its final pose until healing stops. */
export function findHealingTransition(names:ReadonlyMap<string,number>,starting:boolean,crouching:boolean):number|null {
  const phase=starting ? "prefire" : "postfire";
  const candidates=[...(crouching ? [`attackcrouch_secondary_${phase}`] : []),`attackstand_secondary_${phase}`,`layer_attackstand_secondary_${phase}`];
  return candidates.map(name=>names.get(name)).find(seq=>seq!==undefined) ?? null;
}

export function findMinigunTransition(names: ReadonlyMap<string, number>, starting: boolean, crouching: boolean): number | null {
  const phase = starting ? "spoolup" : "spooldown";
  return (crouching ? names.get(`attackcrouch_primary_${phase}`) : undefined) ?? names.get(`attackstand_primary_${phase}`) ?? null;
}

export function findScopedAttack(names: ReadonlyMap<string, number>, crouching: boolean): number[] {
  const seq = (crouching ? names.get("attackcrouch_primary_deployed") : undefined)
    ?? names.get("attackstand_primary_deployed_fire") ?? names.get("attackstand_primary_deployed");
  return seq === undefined ? [] : [seq];
}

/** The slot after (`step` 1) or before (-1) `current` among the slots that have a weapon; null when there are none. */
export function nextSlot(current: PlaySlot | null, available: readonly PlaySlot[], step = 1): PlaySlot | null {
  const order = PLAY_SLOTS.filter((s) => available.includes(s));
  if (order.length === 0) return null;
  const at = current ? order.indexOf(current) : -1;
  if (at < 0) return order[step > 0 ? 0 : order.length - 1];
  return order[(at + step + order.length) % order.length];
}

/** What to try, in order, when a model has no sequence of a kind (not every class has every weapon set). */
const FALLBACKS: Record<Locomotion, Locomotion[]> = {
  stand: ["stand"],
  crouch: ["crouch", "stand"],
  run: ["run", "stand"],
  crouch_walk: ["crouch_walk", "run", "crouch", "stand"],
  jump_start: ["jump_start", "jump_float", "airwalk"],
  jump_float: ["jump_float", "airwalk", "jump_start", "stand"],
  airwalk: ["airwalk", "jump_float", "jump_start", "stand"],
  jumpland: ["jumpland", "stand"],
};
const GENERIC_SETS = ["primary", "secondary", "melee", "melee_allclass", "secondary2", "loser"];

/**
 * The sequence for a kind of movement: the held weapon's own sets (`sets`, e.g. "primary") first, then any weapon set the model has.
 * `names` maps lowercase sequence names to their index. Null when the model has nothing usable.
 */
export function findSequence(names: ReadonlyMap<string, number>, kind: Locomotion, sets: readonly string[]): number | null {
  for (const k of FALLBACKS[kind]) {
    for (const set of [...sets, ...GENERIC_SETS]) {
      const hit = names.get(`${k}_${set}`);
      if (hit !== undefined) return hit;
    }
  }
  return null;
}

/** The weapon sets ("primary", "melee_allclass" ...) a held weapon idles with, from its `stand_*` sequence names. */
export const setsOf = (idleNames: readonly string[]): string[] => idleNames.map((n) => n.replace(/^stand_/, ""));

export interface Motion {
  /** Position on the floor in viewer units. */
  x: number;
  z: number;
  /** Facing (radians about the vertical axis; positive turns to the character's left, like {@link Actor.yaw}). */
  yaw: number;
  /** Aim up / down in degrees (positive looks up, like the body_pitch parameter). */
  pitch: number;
  /** The way the feet (the rendered body) face; the torso twists back to the facing, within {@link MAX_BODY_YAW}. */
  feetYaw: number;
  /** Where the feet are turning to. */
  goalFeetYaw: number;
  /** Seconds since the feet last turned (play time). */
  sinceTurn: number;
  vx: number;
  vz: number;
  /** Height above the floor and vertical speed. */
  h: number;
  vy: number;
  crouching: boolean;
}

export const newMotion = (x = 0, z = 0, yaw = 0): Motion => ({ x, z, yaw, pitch: 0, feetYaw: yaw, goalFeetYaw: yaw, sinceTurn: 0, vx: 0, vz: 0, h: 0, vy: 0, crouching: false });

export interface MoveInput {
  /** W (+1) and S (-1). */
  forward: number;
  /** D (+1) and A (-1). */
  right: number;
  crouch: boolean;
  /** A jump was requested (held counts; the character jumps again once it lands, like bunny hopping). */
  jump: boolean;
}

export const grounded = (m: Motion) => m.h <= 0 && m.vy <= 0;

/** Advances the motion by `dt` seconds: steering, a scripted jump arc, crouching, and staying inside the circle of `radius` around the origin. */
export function stepMotion(m: Motion, input: MoveInput, dt: number, runSpeed: number, unitsPerSource = 1): void {
  const onGround = grounded(m);
  if (onGround) m.crouching = input.crouch;
  const limit = runSpeed * (m.crouching ? CROUCH_SPEED_SCALE : 1) * unitsPerSource;

  // wish direction in the floor plane: forward is (sin yaw, cos yaw), the character's left is (cos yaw, -sin yaw)
  const fx = Math.sin(m.yaw);
  const fz = Math.cos(m.yaw);
  let wx = fx * input.forward - fz * input.right;
  let wz = fz * input.forward + fx * input.right;
  const wl = Math.hypot(wx, wz);
  if (wl > 1) {
    wx /= wl;
    wz /= wl;
  }
  const accel = (onGround ? GROUND_ACCEL : AIR_ACCEL) * Math.min(dt, 0.1);
  const k = Math.min(accel, 1);
  if (onGround) {
    m.vx += (wx * limit - m.vx) * k;
    m.vz += (wz * limit - m.vz) * k;
  } else {
    // little air control: the speed from the take-off stays
    m.vx += (wx * limit - m.vx) * k * 0.5;
    m.vz += (wz * limit - m.vz) * k * 0.5;
  }

  if (onGround && input.jump && !m.crouching) {
    m.vy = JUMP_SPEED * unitsPerSource;
    m.h = 1e-3;
  }
  if (!onGround || m.vy > 0) {
    m.vy -= GRAVITY * unitsPerSource * dt;
    m.h += m.vy * dt;
    if (m.h <= 0) {
      m.h = 0;
      m.vy = 0;
    }
  }

  m.x += m.vx * dt;
  m.z += m.vz * dt;
}

/** The speed on the floor, as a fraction of the speed the current stance allows (about 0..1). */
export function speedFraction(m: Motion, runSpeed: number, unitsPerSource = 1): number {
  const limit = runSpeed * (m.crouching ? CROUCH_SPEED_SCALE : 1) * unitsPerSource;
  return limit > 0 ? Math.hypot(m.vx, m.vz) / limit : 0;
}

export const isMoving = (m: Motion, runSpeed: number, unitsPerSource = 1) => speedFraction(m, runSpeed, unitsPerSource) > MOVING_FRACTION;

/**
 * The 9-way blend parameters of the move animations (the engine's `move_x` is forward, `move_y` is to the right), each -1..1:
 * the velocity in the character's own frame, in units of the speed the stance allows.
 */
export function moveParams(m: Motion, runSpeed: number, unitsPerSource = 1): { moveX: number; moveY: number } {
  const limit = runSpeed * (m.crouching ? CROUCH_SPEED_SCALE : 1) * unitsPerSource;
  if (limit <= 0) return { moveX: 0, moveY: 0 };
  const fx = Math.sin(m.yaw);
  const fz = Math.cos(m.yaw);
  const forward = m.vx * fx + m.vz * fz;
  const right = m.vz * fx - m.vx * fz;
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  return { moveX: clamp(forward / limit), moveY: clamp(right / limit) };
}

/** Value of a pose parameter (in its own range) as the 0..1 number the animation code takes. */
export const encodeParam = (value: number, start: number, end: number) => Math.min(Math.max((value - start) / (end - start || 1), 0), 1);

/** How the animation clock advances: cycles per second for a sequence of `frames` at `fps` played at `rate`. */
export const cycleRate = (frames: number, fps: number, rate: number) => (frames > 1 ? (fps / (frames - 1)) * rate : 0);

export interface RawPose {
  pos: Float32Array;
  quat: Float32Array;
}

/** `a` blended towards `b` by `t` (0..1): positions lerped, rotations normalized-lerped (shortest way round). */
export function blendPoses(a: RawPose, b: RawPose, t: number, out: RawPose): RawPose {
  for (let i = 0; i < a.pos.length; i++) out.pos[i] = a.pos[i] + (b.pos[i] - a.pos[i]) * t;
  for (let i = 0; i < a.quat.length; i += 4) {
    const dot = a.quat[i] * b.quat[i] + a.quat[i + 1] * b.quat[i + 1] + a.quat[i + 2] * b.quat[i + 2] + a.quat[i + 3] * b.quat[i + 3];
    const s = dot < 0 ? -1 : 1;
    let l = 0;
    for (let k = 0; k < 4; k++) {
      const v = a.quat[i + k] + (s * b.quat[i + k] - a.quat[i + k]) * t;
      out.quat[i + k] = v;
      l += v * v;
    }
    l = 1 / (Math.sqrt(l) || 1);
    for (let k = 0; k < 4; k++) out.quat[i + k] *= l;
  }
  return out;
}

const TAU = Math.PI * 2;
/** An angle in radians brought into -PI..PI. */
export const normalizeAngle = (a: number) => {
  const r = a % TAU;
  return r > Math.PI ? r - TAU : r < -Math.PI ? r + TAU : r;
};

/** How far the torso may twist against the feet (the body_yaw range of the player models). */
export const MAX_BODY_YAW = (45 * Math.PI) / 180;
/** The game's mp_feetyawrate (degrees per second), mp_facefronttime and the angle below which a turn slows down. */
const FEET_YAW_RATE = (720 * Math.PI) / 180;
const FACE_FRONT_TIME = 3;
const FADE_TURN = (60 * Math.PI) / 180;

/**
 * The feet follow the aim like in the game (CBasePlayerAnimState::ComputePoseParam_BodyYaw): while moving they point where the
 * player looks; standing still the torso twists up to {@link MAX_BODY_YAW} against the feet, and the feet turn under it when the
 * aim goes further than that, or after the player stood still for a few seconds.
 */
export function stepFeet(m: Motion, moving: boolean, dt: number): void {
  if (moving) m.goalFeetYaw = m.yaw;
  else if (m.sinceTurn > FACE_FRONT_TIME) m.goalFeetYaw = m.yaw;
  else {
    const diff = normalizeAngle(m.goalFeetYaw - m.yaw);
    if (Math.abs(diff) > MAX_BODY_YAW) m.goalFeetYaw = m.yaw + Math.sign(diff) * MAX_BODY_YAW;
  }
  m.goalFeetYaw = normalizeAngle(m.goalFeetYaw);

  m.sinceTurn += dt;
  if (m.feetYaw !== m.goalFeetYaw) {
    const diff = normalizeAngle(m.goalFeetYaw - m.feetYaw);
    const abs = Math.abs(diff);
    const scale = abs <= FADE_TURN ? Math.min(Math.max(abs / FADE_TURN, 0.01), 1) : 1;
    let move = FEET_YAW_RATE * dt * scale;
    if (abs > MAX_BODY_YAW) move = abs - MAX_BODY_YAW; // too far behind: catch up at once
    m.feetYaw = abs < move ? m.goalFeetYaw : normalizeAngle(m.feetYaw + Math.sign(diff) * move);
    m.sinceTurn = 0;
  }
}

/** The torso's twist against the feet in degrees: the body_yaw parameter. */
export const bodyYawDegrees = (m: Motion) => (Math.max(-MAX_BODY_YAW, Math.min(MAX_BODY_YAW, normalizeAngle(m.yaw - m.feetYaw))) * 180) / Math.PI;

/**
 * The sequences an action plays, in order (empty when the model has none). The attack and the gestures are one sequence each
 * (`AttackStand_PRIMARY`, `gesture_primary_go`); a reload is its start sequence and, for weapons that load one round at a time, the
 * loop and end ones after it. Sequence names are matched without case, in the held weapon's sets first.
 */
export function findAction(names: ReadonlyMap<string, number>, action: PlayAction, sets: readonly string[], crouching: boolean, airborne: boolean): number[] {
  const all = [...sets, ...GENERIC_SETS];
  const first = (build: (set: string) => string[]): number | null => {
    for (const set of all) {
      for (const n of build(set)) {
        const hit = names.get(n.toLowerCase());
        if (hit !== undefined) return hit;
      }
    }
    return null;
  };
  if (action === "attack") {
    // TF2's activities have several authored naming forms across the nine class MDLs.
    // In particular, most melee attacks are <set>_Swing, Soldier inserts an underscore,
    // and Heavy uses separate left/right punches. Never substitute a gun attack for a swing.
    const melee = sets.some((set) => set.toLowerCase().startsWith("melee"));
    const attackSets = [...new Set([...sets, ...(melee ? ["melee", "melee_allclass"] : GENERIC_SETS)])];
    const stances = airborne ? ["Airwalk", "Stand"] : crouching ? ["Crouch", "Stand"] : ["Stand"];
    for (const set of attackSets) {
      for (const stance of stances) {
        const attack = [`Attack${stance}_${set}`, `Attack_${stance}_${set}`];
        const swing = stance === "Stand" ? `${set}_swing` : `${set}_${stance}_swing`;
        // the Huntsman's ACT_MP_ATTACK_*_ITEM2 sequences (ITEM2_fire, ITEM2_crouch_fire) are named for the set, not for the stance
        const fire = stance === "Stand" ? `${set}_fire` : `${set}_${stance}_fire`;
        for (const name of [...attack, swing, fire, ...attack.flatMap((n) => [`${n}_L`, `${n}_R`])]) {
          const hit = names.get(name.toLowerCase());
          if (hit !== undefined) return [hit];
        }
      }
    }
    return [];
  }
  if (action === "reload") {
    const stance = airborne ? "Airwalk" : crouching ? "Crouch" : "Stand";
    for (const set of all) {
      const prefix = set.toLowerCase();
      const modern = stance === "Crouch" ? [`${prefix}_crouch_reload`] : stance === "Airwalk" ? [`${prefix}_reload_airwalk`,`${prefix}_swim_reload`] : [`${prefix}_reload`];
      for (const stem of [...modern,`${prefix}_reload`]) {
        const start=names.get(`${stem}_start`) ?? names.get(stem);
        if (start===undefined) continue;
        const loop=names.get(`${stem}_loop`) ?? names.get(`a_${stem}_loop`);
        const end=names.get(`${stem}_end`) ?? names.get(`a_${stem}_end`);
        return loop!==undefined && end!==undefined ? [start,loop,end] : [start];
      }
      let base = `Reload${stance}_${set}`.toLowerCase();
      let start = names.get(base);
      if (start === undefined && stance !== "Stand") {
        base = `ReloadStand_${set}`.toLowerCase();
        start = names.get(base);
      }
      if (start === undefined) continue;
      const out = [start];
      const loop = names.get(`${base}_loop`);
      const end = names.get(`${base}_end`);
      const bodyLoop = loop ?? names.get(`${prefix}_reload_loop`) ?? names.get(`a_${prefix}_reload_loop`);
      const bodyEnd = end ?? names.get(`${prefix}_reload_end`) ?? names.get(`a_${prefix}_reload_end`);
      if (bodyLoop !== undefined && bodyEnd !== undefined) out.push(bodyLoop, bodyEnd);
      return out;
    }
    return [];
  }
  const s = first((set) => [`gesture_${set}_${action}`]);
  return s === null ? [] : [s];
}
