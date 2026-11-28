import * as THREE from "three";
import { evalPoses, type PoseRequest } from "../api";
import type { Actor } from "./actor";
import type { AnimState } from "./animUi";
import type { ClipData } from "./payload";
import { sampleClip } from "./poseRig";
import { capturePlayMouse, type CaptureMouse } from "./playMouse";
import type { WeaponProfile } from "../api";
import { WeaponCycle, type WeaponEvent } from "./weaponCycle";
import {
  CLASS_SPEED,
  blendPoses,
  cycleRate,
  encodeParam,
  findAction,
  findReplacedAttack,
  findSequence,
  secondaryMode,
  findDeployedSequence,
  findMinigunTransition,
  findHealingTransition,
  findScopedAttack,
  grounded,
  isMoving,
  moveParams,
  newMotion,
  nextSlot,
  bodyYawDegrees,
  stepFeet,
  speedFraction,
  stepMotion,
  PLAY_ACTIONS,PLAY_DAMAGE_ACTIONS,type PlayDamageAction,
  type Locomotion,
  type PlayAction,
  type Motion,
  type PlaySlot,
  type RawPose,
} from "./playLogic";

/** What happens while a lunchbox is used: the Scout's drink starts its effect, a Heavy takes a bite (the first is the bitten one), the food is thrown out. */
export type MealEvent = { type: "drink" } | { type: "bite"; n: number } | { type: "end" } | { type: "drop"; direction: THREE.Vector3 };

export interface PlayHost {
  actor: Actor;
  anim: AnimState;
  /** Game class name ("soldier", "demoman"): decides the running speed. */
  gameClass: string;
  /** The team of the character (0 red, 1 blue). */
  team?: () => number;
  /** The element the mouse aims on (the 3D view). */
  surface: HTMLElement;
  /** The weapon sets ("primary", "melee" ...) the held weapon idles with, best first. */
  weaponSets: () => string[];
  /** The slots the class has a weapon for, and the one held now. */
  slots: () => PlaySlot[];
  heldSlot: () => PlaySlot | null;
  /** Takes the weapon of a slot into the hands. */
  switchSlot: (slot: PlaySlot) => void;
  /** Where the character ends up when it walks into something solid: given where it is (feet, viewer space) and how fast it goes, the corrected place on the floor, or null when nothing is in the way. */
  collide?: (x: number, y: number, z: number, vx: number, vz: number) => { x: number; z: number } | null;
  /** With a map: how high its floor is under a point (view units, looked for from a step above `y` down); null: the flat floor. */
  ground?: (x: number, y: number, z: number) => number | null;
  /** Called every frame with where the character is on the floor (viewer units) and the way it faces. */
  onFrame?: (x: number, z: number, yaw: number) => void;
  /** Play mode ended by the player (Escape). */
  onExit: () => void;
  /** Suspend editor mouse controls while play mode owns the pointer. */
  onInputCapture?: (active: boolean) => void;
  onInputError?: (message: string) => void;
  captureMouse?: CaptureMouse;
  weaponProfile?: () => WeaponProfile | null;
  /** Takes the held weapon out of the hand (a thrown jar) or puts it back. */
  setHeldHidden?: (hidden: boolean) => void;
  /** Eating and drinking (a lunchbox is a taunt): the moments the app has to show something for. */
  onMeal?: (event: MealEvent, profile: WeaponProfile) => void;
  weaponReady?: () => boolean;
  isDamaged?:()=>boolean;
  onDamage?:(action:PlayDamageAction,direction:THREE.Vector3)=>void;
  onMelee?: (direction:THREE.Vector3,profile:WeaponProfile) => void;
  onShot?: (direction: THREE.Vector3, charge?:number) => void;
  onSecondary?: (direction:THREE.Vector3) => void;
  onHealing?: (direction:THREE.Vector3,attack:boolean) => boolean;
  onFiring?: (firing: boolean) => void;
  onAmmo?: (text: string) => void;
  /**
   * The taunt the character has on (null: none): its scenes' clips, baked as the Animation panel plays them (the same taunt in and out of
   * play mode), and how a moving taunt moves. It plays when its slot is taken out, or with G.
   */
  tauntPlan?: () => Promise<TauntPlan | null>;
  /**
   * Shows a taunt clip at a time, its prop at `propTime` of the taunt's own (main) clip, or ends the taunt (null: the prop is put away,
   * play mode poses again).
   */
  showTaunt?: (clip: ClipData | null, time: number, propTime?: number) => void;
}

/** One scene of a taunt: its sequence's clip, and the loop its scene makes (seconds of the clip: at `at` it goes back to `to`). */
export interface TauntPart {
  clip: ClipData;
  loop: { to: number; at: number } | null;
}

/** How a moving taunt moves (items_game's taunt move attributes): units / degrees per second, seconds to full speed, always forward. */
export interface TauntMove {
  speed: number;
  turn: number;
  moveAccel: number;
  turnAccel: number;
  forward: boolean;
}

/** A taunt: its scene, the one stopping it plays (outro) and the one the attack button plays (the Rocket Jockey's cheer), its movement. */
export interface TauntPlan {
  main: TauntPart;
  outro: TauntPart | null;
  attack: TauntPart | null;
  move: TauntMove | null;
}

/** `v` moved toward `goal` by at most `step`. */
const approach = (v: number, goal: number, step: number) => (v < goal ? Math.min(goal, v + step) : Math.max(goal, v - step));

const FADE_TIME = 0.15;
/** Seconds a taunt crossfades in from the pose the player was in, and out into play mode's again (studiomdl's default sequence fade, 0.2 s: the game's sequence transition). */
const TAUNT_FADE = 0.2;
const MOUSE_DEGREES_PER_PIXEL = 0.25;
/** How high a step the character walks up or down without jumping or falling (the game's 18 units). */
const STEP = 18;
const GROUND_KINDS: ReadonlySet<Locomotion> = new Set(["stand", "crouch", "run", "crouch_walk"]);
const ONE_SHOT: ReadonlySet<Locomotion> = new Set(["jump_start", "jumpland", "taunt"]);

/** A gesture layer playing over the movement: the sequences it goes through (a reload has a start, a loop and an end) and where it is. */
interface Gesture {
  seqs: number[];
  at: number;
  cycle: number;
  looping?: boolean;
  hold?:boolean;
  duration?: number;
  rate?: number;
}

interface Playing {
  seq: number;
  cycle: number;
  loco: Locomotion;
}

/**
 * Steers a character like in the game: WASD walks relative to where it faces, moving the mouse over the view turns and tilts it
 * (the body_yaw / body_pitch aim), Space jumps, Ctrl crouches (C is the follow camera's static / behind), 1-4 and Q change the weapon. The camera does not follow.
 * Every frame the engine side evaluates the sequences (with their blend grids and aim layers) at the chosen cycle and parameters,
 * and a change of animation fades over a short time like the game's.
 */
export class PlayController {
  private readonly host: PlayHost;
  private readonly motion: Motion;
  private readonly keys = new Set<string>();
  private readonly seqInfo = new Map<number, { frames: number; fps: number; name: string }>();
  private readonly seqNames = new Map<string, number>();
  /** The sequences by their authored activity (upper case, `ACT_MP_THROW`). */
  private readonly seqActs = new Map<string, number[]>();
  private readonly startPose: { x: number; y: number; z: number; yaw: number };
  /** How the character was tipped before play: it plays upright, and is tipped again when play ends. */
  private readonly startTilt: { pitch: number; roll: number };
  private raf = 0;
  private last = 0;
  private running = false;
  private captureGeneration = 0;
  private wheelDelta = 0;
  private primaryDown = false;
  private secondaryDown = false;
  private scoped = false;
  private spin: "idle" | "starting" | "ready" = "idle";
  private spinTime = 0;
  private barrelVelocity = 0;
  private barrelAngle = 0;
  private readonly ammo = new Map<number, WeaponCycle>();
  private weapon: WeaponCycle | null = null;
  private meleeClock=0;
  private meleeHits:{at:number;profile:WeaponProfile}[]=[];
  private jumpQueued = false;
  /** The floor under the character (view units): where the height is measured from (a map's floor, else the start's). */
  private floorY: number | null = null;
  /** The attack / reload layer and the voice-command gesture layer: two slots like the game's, each playing one thing at a time. */
  private fight: Gesture | null = null;
  private healing=false;
  private healingCrouch=false;
  private signal: Gesture | null = null;
  private cur: Playing | null = null;
  private prev: Playing | null = null;
  private fade = 0;
  private wasGround = true;
  /** The pose requests in flight (they overlap: waiting for each before the next skipped frames, the body moving on without its pose),
   * the newest one asked and the newest one shown (an older answer arriving late is dropped). */
  private inFlight = 0;
  private poseAsked = 0;
  private poseShown = 0;
  private pitchRange = { start: -45, end: 90 };
  private readonly off: (() => void)[] = [];

  constructor(host: PlayHost) {
    this.host = host;
    const a = host.actor;
    this.startPose = { x: a.offset.x, y: a.offset.y, z: a.offset.z, yaw: a.yaw };
    this.startTilt = { pitch: a.pitch, roll: a.roll };
    a.setTilt(0, 0);
    this.motion = newMotion(0, 0, a.yaw);
    for (const s of host.anim.info?.sequences ?? []) {
      this.seqInfo.set(s.index, { frames: s.frames, fps: s.fps, name: s.name.toLowerCase() });
      this.seqNames.set(s.name.toLowerCase(), s.index);
      if (s.activity) { const act = s.activity.toUpperCase(); this.seqActs.set(act, [...(this.seqActs.get(act) ?? []), s.index]); }
    }
    const pitch = host.anim.info?.poseParams.find((p) => p.name.toLowerCase() === "body_pitch");
    if (pitch) this.pitchRange = { start: pitch.start, end: pitch.end };
  }

  get active() {
    return this.running;
  }

  start() {
    if (this.running) return;
    this.running = true;
    const generation = ++this.captureGeneration;
    this.wheelDelta = 0;
    this.resetWeaponInput();
    // The character runs around the spot it stands on.
    this.motion.x = 0;
    this.motion.z = 0;
    this.last = performance.now();
    const on = <K extends keyof WindowEventMap>(target: Window, type: K, fn: (ev: WindowEventMap[K]) => void) => {
      target.addEventListener(type, fn);
      this.off.push(() => target.removeEventListener(type, fn));
    };
    on(window, "keydown", (ev) => this.onKey(ev, true));
    on(window, "keyup", (ev) => this.onKey(ev, false));
    on(window, "blur", () => {
      this.keys.clear();
      this.host.onExit();
    });
    const failed = () => {
      if (!this.running || generation !== this.captureGeneration) return;
      this.host.onExit();
      this.host.onInputError?.("Could not capture the mouse for Play mode. Click Play mode again to retry.");
    };
    // Locked clicks must not select characters, drag lights, orbit, or open editor menus.
    const block = (ev: Event) => {
      ev.stopImmediatePropagation();
      ev.preventDefault();
    };
    for (const type of ["pointerdown", "pointerup", "click", "dblclick", "contextmenu", "wheel"]) {
      window.addEventListener(type, block, { capture: true, passive: false });
      this.off.push(() => window.removeEventListener(type, block, true));
    }
    this.host.onInputCapture?.(true);
    this.host.surface.focus({ preventScroll: true });
    document.documentElement.classList.add("playMouseCaptured");
    this.off.push(() => document.documentElement.classList.remove("playMouseCaptured"));
    try {
      void (this.host.captureMouse ?? capturePlayMouse)(this.host.surface, (x, y) => {
        if (generation === this.captureGeneration) this.onPointerMove(x, y);
      }, () => {
        if (this.running && generation === this.captureGeneration) this.host.onExit();
      }, (delta) => {
        if (!this.running || generation !== this.captureGeneration) return;
        // Windows reports 120 units per notch; accumulate high-resolution wheel fractions.
        this.wheelDelta -= delta / 120;
        const steps = Math.trunc(this.wheelDelta);
        this.wheelDelta -= steps;
        for (let i = 0; i < Math.abs(steps); i++) this.cycleWeapon(Math.sign(steps));
      }, (flags) => {
        if (this.running && generation === this.captureGeneration) this.onMouseButtons(flags);
      }).then((release) => {
        if (!this.running || generation !== this.captureGeneration) release();
        else this.off.push(release);
      }, failed);
    } catch { failed(); }
    if (!this.running) return;
    const loop = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min((now - this.last) / 1000, 0.05);
      this.last = now;
      this.frame(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** Ends play mode: the character stays where it stopped. The caller puts an animation back. */
  stop() {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.raf);
    for (const f of this.off.splice(0)) f();
    this.host.onInputCapture?.(false);
    this.keys.clear();
    this.resetWeaponInput();
    if(!this.host.isDamaged?.())this.host.actor.endLive();
    this.host.actor.setTilt(this.startTilt.pitch, this.startTilt.roll);
    this.host.setHeldHidden?.(false);
    this.host.actor.setHandLock(null);
    this.meal = null;
    this.taunting = null;
    this.tauntFade = null;
    this.tauntToken++;
    this.host.actor.setHeldBodyState(0);
  }

  /** The place the character stood at when play started. */
  get origin() {
    return this.startPose;
  }

  private onKey(ev: KeyboardEvent, down: boolean) {
    const t = ev.target as HTMLElement | null;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (document.getElementById("view")?.hidden) return;
    const code = ev.code;
    const mine = /^(Key[WASDQERG]|Space|Control(Left|Right)|Arrow(Up|Down|Left|Right)|Digit[1-689]|Escape)$/.test(code);
    if (!mine || ev.altKey || ev.metaKey) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    if (!down) {
      this.keys.delete(code);
      return;
    }
    if (ev.repeat) return;
    this.keys.add(code);
    if (code === "Space") this.jumpQueued = true;
    else if (code === "Escape") this.host.onExit();
    else if (code === "KeyQ") this.cycleWeapon(1);
    else if (code === "KeyE") this.cycleWeapon(-1);
    else if (code === "KeyR") this.trigger("reload");
    else if (code === "KeyG") { if (this.taunting) this.stopTaunt(); else void this.startTaunt(true); }
    else if (code.startsWith("Digit")) {
      const damage=PLAY_DAMAGE_ACTIONS.find(a=>a.key===code.slice(5));if(damage){this.damage(damage.id);return;}
      const action = PLAY_ACTIONS.find(a=>a.key===code.slice(5));
      if (action) this.trigger(action.id);
    }
  }

  damage(action:PlayDamageAction){
    if(!this.running)return;
    if(action==="ragdoll" || action==="explode")this.resetWeaponInput();
    this.host.onDamage?.(action,this.aimDirection());
  }
  private cycleWeapon(step: number) {
    if(this.host.isDamaged?.())return;
    const next = nextSlot(this.host.heldSlot(), this.host.slots(), step);
    if (next && next !== this.host.heldSlot()) {
      if (next === "taunt") this.slotBeforeTaunt = this.host.heldSlot();
      this.resetWeaponInput();
      this.fight = null;
      this.endTaunt();
      this.host.switchSlot(next);
      // the taunt's slot plays it: standing in it with its prop and the weapon's stand is not a state the game has
      if (next === "taunt") void this.startTaunt(false);
    }
  }

  private resetWeaponInput() {
    this.meleeHits=[];
    this.weapon?.cancel(); this.weapon = null;
    this.host.onFiring?.(false);this.host.onHealing?.(this.aimDirection(),false);
    this.primaryDown = this.secondaryDown = this.scoped = false;
    this.spin = "idle"; this.spinTime = 0;this.healing=false;
    this.barrelVelocity = this.barrelAngle = 0;
    this.host.actor.setWeaponBarrel?.(null);
  }

  private weaponMode() { return this.host.weaponProfile?.()?.weaponClass==="tf_weapon_compound_bow" ? null : secondaryMode(this.host.gameClass, this.host.heldSlot(), this.host.weaponSets()); }

  private onMouseButtons(flags: number) {
    // the taunt's slot: the attack plays the taunt (again: stops it)
    if (this.host.heldSlot() === "taunt") {
      if (flags & 1) {
        const tg = this.taunting;
        // (a taunt with an attack scene plays it: the Rocket Jockey cheers; else the attack stops the taunt, as playing it again would)
        if (tg?.plan.attack && tg.kind === "main") this.playTauntPart("attack");
        else if (tg) { if (tg.kind !== "attack") this.stopTaunt(); }
        else void this.startTaunt(false);
      }
      return;
    }
    if (flags & 1) { this.primaryDown = true; if (this.weaponMode() !== "minigun") {
      if (this.host.weaponProfile?.()) this.updateFiring(0); else this.animate("attack");
    } }
    if (flags & 2) { this.primaryDown = false; this.host.onFiring?.(false); }
    if (flags & 4) {
      if (!this.secondaryDown && this.weaponMode() === "scope") { this.scoped = !this.scoped; this.fight = null; }
      if(!this.secondaryDown) {if(this.weapon?.profile.weaponClass==="tf_weapon_compound_bow") this.weapon.cancelCharge();this.host.onSecondary?.(this.aimDirection());this.dropMeal();}
      this.secondaryDown = true;
    }
    if (flags & 8) this.secondaryDown = false;
  }

  private updateWeaponInput(dt: number) {
    if (this.weaponMode() !== "minigun") return;
    const held = this.primaryDown || this.secondaryDown;
    const transition = (starting: boolean) => {
      const seq = findMinigunTransition(this.seqNames, starting, this.motion.crouching);
      this.fight = seq === null ? null : { seqs: [seq], at: 0, cycle: 0 };
    };
    if (held && this.spin === "idle") { this.spin = "starting"; this.spinTime = 0; transition(true); }
    if (!held && this.spin !== "idle") { this.spin = "idle"; transition(false); }
    if (this.spin === "starting") {
      this.spinTime += dt;
      if (this.spinTime >= 0.75) { this.spin = "ready"; this.fight = null; }
    }
    if (this.spin === "ready") {
      const attackSeq = findAction(this.seqNames, "attack", this.host.weaponSets(), this.motion.crouching, !grounded(this.motion))[0];
      if (this.primaryDown && (!this.fight || (this.fight.looping && this.fight.seqs[0] !== attackSeq))) {
        this.trigger("attack");
        const attack = this.fight as Gesture | null;
        if (attack) attack.looping = true;
      } else if (!this.primaryDown && this.fight?.looping) this.fight = null;
    }
    // CTFMinigun::UpdateBarrelMovement: target 20 rad/s, approach by 0.1 per rendered frame.
    const target = this.spin === "idle" ? 0 : 20;
    this.barrelVelocity += Math.max(-0.1, Math.min(0.1, target - this.barrelVelocity));
    this.barrelAngle = (this.barrelAngle + this.barrelVelocity * dt) % (Math.PI * 2);
    this.host.actor.setWeaponBarrel?.(this.barrelAngle);
  }

  private aimDirection() {const pitch=this.motion.pitch*Math.PI/180,yaw=this.motion.yaw;return new THREE.Vector3(Math.cos(yaw)*Math.cos(pitch),Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch));}

  private updateFiring(dt: number) {
    if(this.host.isDamaged?.())return;
    const profile = this.host.weaponProfile?.();
    this.meleeClock+=dt;
    const due=this.meleeHits.filter(hit=>hit.at<=this.meleeClock);this.meleeHits=this.meleeHits.filter(hit=>hit.at>this.meleeClock);
    for(const hit of due)if(profile?.itemId===hit.profile.itemId && this.host.weaponReady?.()!==false)this.host.onMelee?.(this.aimDirection(),hit.profile);
    if (!profile || this.host.weaponReady?.() === false) { this.host.onFiring?.(false); return; }
    if (this.weapon?.profile.itemId !== profile.itemId) {
      this.weapon = this.ammo.get(profile.itemId) ?? new WeaponCycle(profile, true); // reloads keep their rules, the reserve never ends
      this.ammo.set(profile.itemId,this.weapon);
    }
    if (profile.consumable) { this.updateMeal(profile, dt); return; }
    const attack = this.primaryDown && (this.weaponMode() !== "minigun" || this.spin === "ready");
    if(profile.healing) {
      const healing=this.host.onHealing?.(this.aimDirection(),attack) ?? false;
      if(healing!==this.healing || (healing && this.motion.crouching!==this.healingCrouch)) {
        const seq=findHealingTransition(this.seqNames,healing,this.motion.crouching);
        this.fight=seq===null ? null : {seqs:[seq],at:0,cycle:0,hold:healing};
        this.healing=healing;this.healingCrouch=this.motion.crouching;
      }
      this.host.onAmmo?.(healing ? "Healing" : "");return;
    }
    const events=this.weapon.step(dt,attack);
    for (const event of events) this.weaponEvent(event);
    this.host.onFiring?.((profile.charge ? this.weapon.chargeTime!==null : attack) && !this.weapon.phase && (this.weapon.hasAmmo || events.some(event=>event.type==="shot")));
    this.host.onAmmo?.(this.weapon.chargeTime!==null ? `Charge ${Math.min(100,Math.round(this.weapon.chargeTime/(profile.charge?.seconds ?? 1)*100))}%` : this.weapon.statusText);
    if (profile.continuous && (!attack || !this.weapon.hasAmmo) && this.fight?.looping) this.fight=null;
  }

  private weaponEvent(event: WeaponEvent) {
    if (event.type === "shot") {
      if (this.weapon?.profile.throwable) this.thrownAt = performance.now();
      if (!this.weapon?.profile.continuous || !this.fight?.looping) {
        this.animate("attack");
        if (this.weapon?.profile.continuous && this.fight) this.fight.looping=true;
      }
      const profile=this.weapon?.profile;
      if(profile?.melee)this.meleeHits.push({at:this.meleeClock+profile.melee.delay,profile});
      else this.host.onShot?.(this.aimDirection(),event.charge);
      return;
    }
    const seqs = findAction(this.seqNames,"reload",this.host.weaponSets(),this.motion.crouching,!grounded(this.motion));
    const index = event.phase === "insert" ? Math.min(1,seqs.length-1) : event.phase === "end" ? seqs.length-1 : 0;
    // Source reload events replace the current third-person gesture at its authored
    // rate. Viewmodel phase timers must never compress the full body gesture.
    this.fight = seqs.length ? {seqs:[seqs[index]],at:0,cycle:0,rate:this.weapon?.profile.reloadPlaybackRate ?? 1} : null;
  }

  // --- the taunt the character has on -------------------------------------------------------------------------------------------------
  /**
   * The taunt playing: its plan, the scene of it playing (the taunt's own, its attack's or its outro) with the seconds it has run, the time of
   * the prop (it follows the taunt's own scene, looping with it), and a moving taunt's speed (units / s) and turning (degrees / s). While it
   * plays its clip is the pose (the aim and the gestures wait); a moving taunt moves the player with the movement keys, the game's way.
   */
  private taunting: { plan: TauntPlan; kind: "main" | "attack" | "outro"; part: TauntPart; t: number; propT: number; speed: number; turn: number } | null = null;
  private tauntToken = 0;
  /** The slot out before the taunt's: a taunt that is over puts its weapon back in the hand (the game's player is in his weapon again). */
  private slotBeforeTaunt: PlaySlot | null = null;
  /** The pose a taunt crossfades from (into it, between its scenes, or out of it into play mode's pose), with the seconds of the fade left. */
  private tauntFade: { pose: RawPose; left: number } | null = null;

  /**
   * Plays the taunt (G takes its slot out first). `from`: a moment to start at (seconds); `continuing`: the taunt is already showing (play mode
   * started in it), so it goes on as it is instead of blending in.
   */
  async startTaunt(fromKey: boolean, from = 0, continuing = false) {
    if (this.taunting || this.meal || this.host.isDamaged?.() || !grounded(this.motion)) return;
    if (fromKey && this.host.heldSlot() !== "taunt" && this.host.slots().includes("taunt")) { this.slotBeforeTaunt = this.host.heldSlot(); this.resetWeaponInput(); this.host.switchSlot("taunt"); }
    const token = ++this.tauntToken;
    const plan = (await this.host.tauntPlan?.()) ?? null;
    const clip = plan?.main.clip;
    if (!plan || !clip || clip.fps <= 0 || clip.frames < 2 || token !== this.tauntToken || !this.running || this.taunting) return;
    this.fight = this.signal = null;
    this.motion.crouching = false;
    this.motion.vx = this.motion.vz = 0;
    const t = Math.min(Math.max(0, from), (clip.frames - 1) / clip.fps);
    this.taunting = { plan, kind: "main", part: plan.main, t, propT: t, speed: 0, turn: 0 };
    const snap = continuing ? null : this.host.actor.snapshotPose();
    this.tauntFade = snap ? { pose: snap, left: TAUNT_FADE } : null;
    this.showTauntFrame();
  }

  /** Goes on to another scene of the taunt playing (its attack's, its outro), from its start, blending into it. */
  private playTauntPart(kind: "attack" | "outro") {
    const tg = this.taunting;
    const part = tg?.plan[kind];
    if (!tg || !part || part.clip.frames < 2) return;
    const snap = this.host.actor.snapshotPose();
    this.tauntFade = snap ? { pose: snap, left: TAUNT_FADE } : null;
    tg.kind = kind;
    tg.part = part;
    tg.t = 0;
    this.showTauntFrame();
  }

  /** Stops the taunt the way the game does: its outro plays when it has one (then it ends), else it ends now. */
  private stopTaunt() {
    const tg = this.taunting;
    if (!tg || tg.kind === "outro") return;
    if (tg.plan.outro) this.playTauntPart("outro");
    else this.endTaunt(true);
  }

  /** Advances the taunt: its scene's loop, its end (the attack's goes back to the taunt's loop, the rest end it), its prop. */
  private advanceTaunt(dt: number) {
    const tg = this.taunting;
    if (!tg) return;
    tg.t += dt;
    tg.propT += dt;
    const main = tg.plan.main;
    if (main.loop && tg.propT >= main.loop.at) tg.propT -= main.loop.at - main.loop.to;
    const loop = tg.part.loop;
    if (loop && tg.t >= loop.at) tg.t -= loop.at - loop.to;
    if (tg.t < (tg.part.clip.frames - 1) / tg.part.clip.fps) return;
    if (tg.kind === "attack" && main.loop) {
      const snap = this.host.actor.snapshotPose();
      this.tauntFade = snap ? { pose: snap, left: TAUNT_FADE } : null;
      tg.kind = "main"; tg.part = main; tg.t = tg.propT = main.loop.to;
    } else this.endTaunt(true);
  }

  /**
   * A moving taunt's step (CTFGameMovement while taunting): forward (or always, `forward`) and back at its speed, the strafe keys turn the
   * player at its turn speed, each reached over its acceleration time. Its outro holds him where he is.
   */
  private moveTaunt(dt: number, forward: number, right: number) {
    const tg = this.taunting, mv = tg?.plan.move, m = this.motion;
    if (!tg || !mv || tg.kind === "outro") {
      if (tg) tg.speed = tg.turn = 0;
      m.vx = m.vz = 0;
      return;
    }
    const want = mv.forward ? 1 : forward;
    tg.speed = approach(tg.speed, want * mv.speed, mv.moveAccel > 0 ? (mv.speed / mv.moveAccel) * dt : Infinity);
    tg.turn = approach(tg.turn, -right * mv.turn, mv.turnAccel > 0 ? (mv.turn / mv.turnAccel) * dt : Infinity);
    m.yaw += THREE.MathUtils.degToRad(tg.turn) * dt;
    m.feetYaw = m.goalFeetYaw = m.yaw;
    m.vx = Math.sin(m.yaw) * tg.speed;
    m.vz = Math.cos(m.yaw) * tg.speed;
    m.x += m.vx * dt;
    m.z += m.vz * dt;
  }

  /** The taunt's frame on the character, mixed with the pose it fades in from while the fade lasts. */
  private showTauntFrame() {
    const tg = this.taunting;
    if (!tg) return;
    const clip = tg.part.clip;
    const fade = this.tauntFade;
    if (!fade || fade.left <= 0) { this.host.showTaunt?.(clip, tg.t, tg.propT); return; }
    const target = sampleClip(clip, tg.t * clip.fps);
    if (target.pos.length !== fade.pose.pos.length) { this.tauntFade = null; this.host.showTaunt?.(clip, tg.t, tg.propT); return; }
    const a = this.host.actor;
    a.setLive(blendPoses(fade.pose, target, 1 - fade.left / TAUNT_FADE, { pos: new Float32Array(target.pos.length), quat: new Float32Array(target.quat.length) }));
    a.setPropTime(tg.propT);
  }

  /** Ends the taunt; `over`: it finished (or was stopped) in its slot, which gives the hand back to the weapon out before it. */
  private endTaunt(over = false) {
    this.tauntToken++;
    if (!this.taunting) return;
    // (play mode's pose takes over from the taunt's last frame over a fade)
    const snap = this.host.actor.snapshotPose();
    this.tauntFade = snap ? { pose: snap, left: TAUNT_FADE } : null;
    this.taunting = null;
    this.motion.vx = this.motion.vz = 0;
    this.cur = this.prev = null; // (play mode poses from the stand again, not from before the taunt)
    this.host.showTaunt?.(null, 0);
    if (over && this.host.heldSlot() === "taunt") {
      const slots = this.host.slots();
      const back = this.slotBeforeTaunt && this.slotBeforeTaunt !== "taunt" && slots.includes(this.slotBeforeTaunt) ? this.slotBeforeTaunt : slots.find((x) => x !== "taunt");
      if (back) { this.resetWeaponInput(); this.host.switchSlot(back); }
    }
  }

  // --- lunchboxes ------------------------------------------------------------------------------------------------------------------
  /** The eating or drinking taunt that is playing, with the seconds it has run. */
  private meal: { t: number; length: number; seq: number; drank: boolean; bites: number } | null = null;
  /** Seconds until a lunchbox is back (by item): the Heavy's item meter and the Scout's effect bar. */
  private readonly mealMeter = new Map<number, number>();
  /** The food that was bitten and stays in the hand (a Sandvich at full health is never used up). */
  private bittenItem: number | null = null;

  /**
   * CTFLunchBox::PrimaryAttack is a taunt (the class's taunt04): the player stands still while it plays. A Scout's drink starts its effect 0.9 s in, a Heavy
   * takes a bite every second from the first; when it is over the item is used up and its meter runs (a Sandvich at full health, which is what a character
   * here always is, can be eaten again at once). The status line shows what is happening or the seconds left.
   */
  private updateMeal(profile: WeaponProfile, dt: number) {
    const c = profile.consumable!;
    const left = this.mealMeter.get(profile.itemId) ?? 0;
    if (!this.meal && left <= 0 && this.primaryDown) this.startMeal();
    const meal = this.meal;
    if (meal) {
      meal.t += dt;
      if (c.kind === "drink" && !meal.drank && meal.t >= (c.drinkAt ?? 0.9)) { meal.drank = true; this.host.onMeal?.({ type: "drink" }, profile); }
      if (c.kind === "food") while (meal.t >= meal.bites + 1) { meal.bites++; this.bittenItem = profile.itemId; this.host.onMeal?.({ type: "bite", n: meal.bites }, profile); }
      if (meal.t >= meal.length) this.finishMeal(profile);
    }
    this.host.onFiring?.(false);
    this.host.onAmmo?.(this.meal ? (c.kind === "drink" ? "Drinking" : "Eating") : left > 0 ? `${Math.ceil(left)}s` : "");
  }

  private startMeal() {
    const seq = this.seqNames.get("taunt04");
    const info = seq === undefined ? null : this.seqInfo.get(seq);
    if (seq === undefined || !info || info.fps <= 0) return;
    this.fight = this.signal = null;
    this.meal = { t: 0, length: Math.max(0.2, (info.frames - 1) / info.fps), seq, drank: false, bites: 0 };
  }

  private finishMeal(profile: WeaponProfile) {
    const c = profile.consumable!;
    this.meal = null;
    this.host.onMeal?.({ type: "end" }, profile);
    this.useUp(profile, !!c.stays && c.kind === "food");
  }

  /** The item is spent: its meter starts and the player goes back to another weapon (the Heavy to his melee after a steak, which keeps him there). */
  private useUp(profile: WeaponProfile, keeps: boolean) {
    const c = profile.consumable!;
    if (keeps) return;
    this.mealMeter.set(profile.itemId, c.recharge);
    this.bittenItem = null;
    const slots = this.host.slots();
    const next: PlaySlot | undefined = c.keepsMelee && slots.includes("melee") ? "melee" : slots.includes("primary") ? "primary" : slots.find((x) => x !== this.host.heldSlot());
    if (next) this.host.switchSlot(next);
  }

  /** The secondary fire of food throws it out as a health kit (CTFLunchBox::SecondaryAttack), which uses it up. */
  private dropMeal() {
    const profile = this.host.weaponProfile?.();
    const c = profile?.consumable;
    if (!profile || !c || c.kind !== "food" || this.meal || (this.mealMeter.get(profile.itemId) ?? 0) > 0) return;
    this.host.onMeal?.({ type: "drop", direction: this.aimDirection() }, profile);
    this.useUp(profile, false);
  }

  /** The Huntsman's bow is carried in the left hand by a bone of the right: it is kept in the hand through every blend of animations. */
  private updateHandLock() {
    const bow = this.weapon?.profile.weaponClass === "tf_weapon_compound_bow";
    this.host.actor.setHandLock(bow ? { hand: "bip_hand_L", root: "weapon_bone", follow: ["weapon_bone", "weapon_bone_1", "weapon_bone_2"] } : null);
  }

  /** A thrown weapon (jar, cleaver) is out of the hand from the moment it leaves until it is back (the effect bar is full again). */
  private thrownAt = -1;
  private updateHeldVisibility() {
    const throwable = this.weapon?.profile.throwable;
    let out = !!throwable && this.weapon!.rechargeLeft > 0 && this.thrownAt >= 0 && performance.now() - this.thrownAt >= throwable.delay * 1000;
    if (!throwable || this.weapon!.rechargeLeft <= 0) this.thrownAt = -1;
    // a lunchbox that was used is not in the hand until its meter is full again
    const used = this.host.weaponProfile?.();
    if (used?.consumable && !this.meal && (this.mealMeter.get(used.itemId) ?? 0) > 0) out = true;
    // food that was bitten shows the bitten model (CTFLunchBox::SwitchBodyGroups)
    if (this.bittenItem !== null && used?.itemId !== this.bittenItem) this.bittenItem = null;
    this.host.actor.setHeldBodyState(used?.consumable && this.bittenItem === used.itemId ? 1 : 0);
    this.host.setHeldHidden?.(out);
  }

  /** Plays an attack, reload or gesture over the movement (a new one replaces the one playing in its slot, like the game's gesture slots). */
  trigger(action: PlayAction) {
    if (!this.running || this.host.isDamaged?.()) return;
    if (action === "reload" && this.host.weaponProfile?.()) {
      this.updateFiring(0); this.weapon?.reload(); this.updateFiring(0); return;
    }
    if (action === "attack" && this.host.weaponProfile?.() && this.weaponMode() !== "minigun") {
      const held=this.primaryDown; this.primaryDown=true; this.updateFiring(0); this.primaryDown=held; return;
    }
    this.animate(action);
  }

  private animate(action: PlayAction) {
    const m = this.motion;
    // an item that rewrites the player's attack activity (a banner's bugle call, a jar's throw) plays the sequence that stands for the new one
    const replaced = action === "attack" && !this.scoped ? findReplacedAttack(this.seqActs, this.seqNames, this.host.weaponProfile?.()?.animReplacement, this.host.weaponSets(), m.crouching, !grounded(m), this.host.team?.() ?? 0) : null;
    const seqs = replaced !== null ? [replaced] : action === "attack" && this.scoped ? findScopedAttack(this.seqNames, m.crouching)
      : findAction(this.seqNames, action, this.host.weaponSets(), m.crouching, !grounded(m));
    if (seqs.length === 0) return;
    const gesture: Gesture = { seqs, at: 0, cycle: 0 };
    if (action === "attack" || action === "reload") this.fight = gesture;
    else this.signal = gesture;
  }

  private onPointerMove(x: number, y: number) {
    if (!this.running || !document.hasFocus() || document.getElementById("view")?.hidden) return;
    if (this.taunting) return; // (a taunt holds the player as he stands: the mouse does not turn him)
    const m = this.motion;
    m.yaw -= x * MOUSE_DEGREES_PER_PIXEL * (Math.PI / 180);
    m.pitch = Math.min(Math.max(m.pitch - y * MOUSE_DEGREES_PER_PIXEL, this.pitchRange.start), this.pitchRange.end);
  }

  private frame(dt: number) {
    if(this.host.isDamaged?.())return;
    const k = this.keys;
    const key = (...codes: string[]) => codes.some((c) => k.has(c));
    const m = this.motion;
    this.updateWeaponInput(dt);
    for (const [item, left] of this.mealMeter) this.mealMeter.set(item, Math.max(0, left - dt));
    if (this.taunting) {
      if (this.tauntFade) this.tauntFade.left -= dt;
      this.advanceTaunt(dt);
      this.showTauntFrame();
    } else if (this.tauntFade && (this.tauntFade.left -= dt) <= 0) this.tauntFade = null;
    const still = !!this.meal || !!this.taunting;
    this.updateFiring(dt);
    this.updateHeldVisibility();
    this.updateHandLock();
    const aiming = this.scoped || this.spin !== "idle" || this.weapon?.chargeTime!==null && this.weapon?.chargeTime!==undefined;
    const run = aiming ? (this.weaponMode() === "minigun" ? 110 : 80) : CLASS_SPEED[this.host.gameClass] ?? 300;
    const moving = this.taunting?.plan.move;
    if (moving) this.moveTaunt(dt, (key("KeyW", "ArrowUp") ? 1 : 0) - (key("KeyS", "ArrowDown") ? 1 : 0), (key("KeyD", "ArrowRight") ? 1 : 0) - (key("KeyA", "ArrowLeft") ? 1 : 0));
    else stepMotion(
      m,
      {
        // (a taunt holds the player where he stands)
        forward: still ? 0 : (key("KeyW", "ArrowUp") ? 1 : 0) - (key("KeyS", "ArrowDown") ? 1 : 0),
        right: still ? 0 : (key("KeyD", "ArrowRight") ? 1 : 0) - (key("KeyA", "ArrowLeft") ? 1 : 0),
        crouch: !still && key("ControlLeft", "ControlRight"),
        jump: !still && (this.jumpQueued || key("Space")),
      },
      dt,
      run,
    );
    this.jumpQueued = false;
    // TF2 cancels rifle zoom when the player jumps.
    if (this.scoped && !grounded(m)) this.scoped = false;
    if (!moving) stepFeet(m, isMoving(m, run), dt);
    const o = this.startPose;
    // the height is over the floor under the feet: the start's, or a map's where the character is
    this.floorY ??= o.y;
    let y = this.floorY + m.h;
    const blocked = this.host.collide?.(o.x + m.x, y, o.z + m.z, m.vx, m.vz);
    if (blocked) { m.x = blocked.x - o.x; m.z = blocked.z - o.z; }
    const ground = this.host.ground?.(o.x + m.x, y, o.z + m.z);
    if (ground !== undefined && ground !== null) {
      const onGround = grounded(m);
      if (ground >= y) {
        // a step up (or a landing): onto it
        y = ground;
        if (m.vy < 0) m.vy = 0;
      } else if (onGround && ground >= y - STEP) {
        // down a step or a slope: the feet follow the floor
        y = ground;
      }
      // (more than a step below: off a ledge, falling from where it is)
      this.floorY = ground;
      m.h = Math.max(0, y - ground);
      if (m.h > 0 && m.vy === 0 && onGround) m.vy = -1e-3;
    }
    this.host.actor.setPlacement(o.x + m.x, this.floorY + m.h, o.z + m.z, m.feetYaw);
    this.host.onFrame?.(o.x + m.x, o.z + m.z, m.yaw);

    if (this.taunting) return; // (the taunt's clip is the pose)
    this.chooseAnimation(run);
    this.advance(dt, run);
    void this.pose(run);
  }

  /** Picks the movement animation for the state of the motion (the game's jump / land / crouch / run activities). */
  private chooseAnimation(run: number) {
    if (this.meal) {
      if (this.cur?.loco !== "taunt") { this.prev = this.cur; this.fade = FADE_TIME; }
      this.cur = { seq: this.meal.seq, cycle: Math.min(1, this.meal.t / this.meal.length), loco: "taunt" };
      return;
    }
    const m = this.motion;
    const ground = grounded(m);
    const moving = isMoving(m, run);
    const cur = this.cur?.loco;
    let want: Locomotion = cur ?? "stand";
    if (!ground) {
      if (this.wasGround) want = "jump_start";
      else if (cur === "jump_start" && (this.cur?.cycle ?? 0) >= 1) want = "jump_float";
      else if (cur !== "jump_start" && cur !== "jump_float" && cur !== "airwalk") want = "jump_float";
    } else {
      const base: Locomotion = moving ? (m.crouching ? "crouch_walk" : "run") : m.crouching ? "crouch" : "stand";
      if (!this.wasGround) want = moving ? base : "jumpland";
      else if (cur === "jumpland" && (this.cur?.cycle ?? 0) < 1 && !moving && !m.crouching) want = "jumpland";
      else want = base;
    }
    this.wasGround = ground;
    // the sequence is looked up again every frame: a new weapon has its own set of animations
    const bowCharging=this.weapon?.profile.weaponClass==="tf_weapon_compound_bow" && this.weapon.chargeTime!==null;
    const deployed = this.scoped || this.spin !== "idle" || bowCharging;
    const seq = (deployed ? findDeployedSequence(this.seqNames, want,bowCharging ? "item2" : "primary") : null) ?? findSequence(this.seqNames, want, this.host.weaponSets());
    if (seq === null) return;
    if (this.cur && this.cur.loco === want && this.cur.seq === seq) return;
    if (this.cur) {
      this.prev = this.cur;
      this.fade = FADE_TIME;
    }
    // ground animations carry their phase over to the next so a run does not restart its stride
    const keep = this.cur && (this.cur.loco === want || (GROUND_KINDS.has(this.cur.loco) && GROUND_KINDS.has(want))) ? this.cur.cycle : 0;
    this.cur = { seq, cycle: keep, loco: want };
  }

  private advance(dt: number, run: number) {
    const m = this.motion;
    const rate = (p: Playing) => (p.loco === "run" || p.loco === "crouch_walk" ? Math.max(speedFraction(m, run), 0.25) : 1);
    for (const p of [this.cur, this.prev]) {
      if (!p) continue;
      const info = this.seqInfo.get(p.seq);
      if (!info) continue;
      p.cycle += dt * cycleRate(info.frames, info.fps, rate(p));
      if (ONE_SHOT.has(p.loco)) p.cycle = Math.min(p.cycle, 1);
      else p.cycle -= Math.floor(p.cycle);
    }
    for (const slot of ["fight", "signal"] as const) {
      const g = this[slot];
      if (!g) continue;
      const info = this.seqInfo.get(g.seqs[g.at]);
      g.cycle += g.duration ? dt / g.duration : info ? dt * cycleRate(info.frames, info.fps, g.rate ?? 1) : 1;
      if (g.cycle >= 1) {
        if(g.hold) {g.cycle=1;continue;}
        if (g.looping) { g.cycle %= 1; continue; }
        g.at++;
        g.cycle = 0;
        if (g.at >= g.seqs.length) this[slot] = null;
      }
    }
    if (this.meal && this.cur?.loco === "taunt") this.cur.cycle = Math.min(1, this.meal.t / this.meal.length);
    if (this.fade > 0) {
      this.fade -= dt;
      if (this.fade <= 0) this.prev = null;
    }
  }

  /** The pose parameters (encoded 0..1) for this frame: the animation panel's values with the movement and aim on top. */
  private params(run: number, level = false): number[] {
    const { info, encoded } = this.host.anim;
    const out = encoded.slice();
    const info2 = info?.poseParams ?? [];
    const { moveX, moveY } = moveParams(this.motion, run);
    const set = (name: string, value: number) => {
      const i = info2.findIndex((p) => p.name.toLowerCase() === name);
      if (i >= 0) out[i] = encodeParam(value, info2[i].start, info2[i].end);
    };
    set("move_x", moveX);
    set("move_y", moveY);
    set("body_pitch", level ? 0 : this.motion.pitch);
    // the model's body_yaw turns the torso the other way round to the way the feet are measured against the aim
    set("body_yaw", level ? 0 : -bodyYawDegrees(this.motion));
    return out;
  }

  /**
   * What to evaluate for a playing animation: the animation itself and the additive layers over it. The landing is an additive
   * (delta) sequence, played over the standing pose and fading in and out instead of on its own (which would show the bind pose);
   * attacks, reloads and gestures are additive too and lie over whatever the legs are doing.
   */
  private request(p: Playing): PoseRequest {
    const layers: [number, number, number][] = [];
    let seq = p.seq;
    let cycle = p.cycle;
    // A taunt is authored to lie over the player's stand pose (its first and last frames hold nothing: alone they lay the body flat in the bind pose), and the game
    // plays it as a layer over the weapon's stand animation: so the stand pose is the base and the taunt the layer, which blends in and out by itself.
    if (p.loco === "taunt") {
      const stand = findSequence(this.seqNames, "stand", this.host.weaponSets());
      if (stand !== null) return [stand, 0, [[p.seq, p.cycle, 1]], 0, -1];
    }
    if (p.loco === "jumpland" && this.seqInfo.get(p.seq)?.name.startsWith("jumpland")) {
      const base = findSequence(this.seqNames, "stand", this.host.weaponSets());
      if (base !== null) {
        layers.push([p.seq, p.cycle, Math.max(0, Math.min(1, p.cycle / 0.12, (1 - p.cycle) / 0.3))]);
        seq = base;
        cycle = 0;
      }
    }
    const base = layers.length; // the landing belongs to the movement: the feet are planted by the pose without what follows
    for (const g of [this.fight, this.signal]) if (g) layers.push([g.seqs[g.at], g.cycle, 1]);
    // A gesture's arm is authored over the standing pose: while crouching its arm is played over the standing pose and taken over,
    // so it points ahead instead of following the crouched shoulder down to the floor.
    let armBase = -1;
    if (this.signal && !this.fight && (p.loco === "crouch" || p.loco === "crouch_walk")) armBase = findSequence(this.seqNames, "stand", this.host.weaponSets()) ?? -1;
    return [seq, cycle, layers, base, armBase];
  }

  private async pose(run: number) {
    if (this.inFlight >= 3 || !this.cur) return;
    const a = this.host.actor;
    const path = this.host.anim.modelPath;
    if (!path) return;
    this.inFlight++;
    const ticket = ++this.poseAsked;
    try {
      const cur = this.cur;
      const prev = this.prev;
      const fade = prev ? Math.max(this.fade, 0) / FADE_TIME : 0;
      const requests: PoseRequest[] = [this.request(cur)];
      if (prev && fade > 0) requests.push(this.request(prev));
      const buf = await evalPoses(path, requests, this.params(run), this.params(run, true));
      if (!this.running || this.host.isDamaged?.() || this.taunting || ticket < this.poseShown) return;
      this.poseShown = ticket;
      const f = new Float32Array(buf);
      const nb = f.length / (7 * requests.length);
      const at = (i: number): RawPose => ({ pos: f.subarray(i * nb * 7, i * nb * 7 + nb * 3), quat: f.subarray(i * nb * 7 + nb * 3, (i + 1) * nb * 7) });
      let pose = at(0);
      if (requests.length > 1) pose = blendPoses(at(1), at(0), 1 - fade, { pos: new Float32Array(nb * 3), quat: new Float32Array(nb * 4) });
      const out = this.tauntFade;
      if (out && out.left > 0 && out.pose.pos.length === pose.pos.length) pose = blendPoses(out.pose, pose, 1 - out.left / TAUNT_FADE, { pos: new Float32Array(nb * 3), quat: new Float32Array(nb * 4) });
      a.setLive({ pos: pose.pos.slice(), quat: pose.quat.slice() });
    } catch (err) {
      console.error(err);
      this.host.onExit();
    } finally {
      this.inFlight--;
    }
  }
}
