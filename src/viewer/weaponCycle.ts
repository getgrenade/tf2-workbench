import type { WeaponProfile } from "../api";

export type ReloadPhase = "start" | "insert" | "end" | "magazine";
export interface WeaponEvent { type: "shot" | "reload"; phase?: ReloadPhase; duration?: number; charge?:number }

/** Weapon time is independent of rendering/gesture duration. Ammo belongs to the equipped item. */
export class WeaponCycle {
  clip: number;
  reserve: number;
  private cooldown = 0;
  chargeTime:number|null=null;
  private releasedCharge=0;
  private chargeCanceled=false;
  cancelCharge(){this.chargeTime=null;this.chargeCanceled=true;}
  private remaining = 0;
  private reloadQueued = false;
  /** Seconds until the fire animation's ammo event (see WeaponProfile.ammoEvent), while one is pending. */
  private ammoTimer = 0;
  private ammoPending = false;
  private ammoRemainder = 0;
  phase: ReloadPhase | null = null;
  private readonly events: WeaponEvent[] = [];
  readonly profile: WeaponProfile;
  /**
   * With `infinite` the reserve never runs down: a magazine still empties and has to be reloaded (the same reload times), but a reload
   * always finds ammunition, and a weapon that fires from its reserve alone (the flamethrower) never runs dry.
   */
  private readonly infinite: boolean;
  constructor(profile: WeaponProfile, infinite = false) { this.profile=profile; this.infinite=infinite; this.clip = Math.max(0, profile.clipSize); this.reserve = profile.reserve; }
  /** Seconds until a thrown weapon (see WeaponProfile.throwable) is back in the hand. */
  rechargeLeft = 0;
  get hasAmmo() { if (this.profile.throwable) return this.rechargeLeft <= 0; return this.profile.clipSize >= 0 ? this.clip >= this.profile.ammoPerShot : this.profile.reserve <= 0 || this.reserve >= this.profile.ammoPerShot; }
  /** What is worth telling the player of the weapon besides its ammunition: the seconds until a thrown one is back. */
  get statusText() { return this.profile.throwable && this.rechargeLeft > 0 ? `${Math.ceil(this.rechargeLeft)}s` : ""; }
  get ammoText() { if (this.profile.throwable) return this.rechargeLeft > 0 ? `${Math.ceil(this.rechargeLeft)}s` : "1"; return this.profile.clipSize >= 0 ? `${this.clip} / ${this.reserve}` : this.profile.reserve > 0 ? `${this.reserve}` : ""; }
  cancel() { this.phase = null; this.reloadQueued = false; this.events.length = 0;this.cancelCharge();this.incrementAmmo(); }
  /** The animation event that loads the next round (a weapon without a reload, like the bow); switching away completes it so the weapon is never stuck empty. */
  private incrementAmmo() {
    if (!this.ammoPending) return;
    this.ammoPending = false;
    if (this.clip < this.profile.clipSize && this.reserve > 0) { this.clip++; if (!this.infinite) this.reserve--; }
  }
  reload() {
    const p = this.profile;
    if (p.ammoEvent != null) return; // no reload: the fire animation loads the next round
    if (this.phase || p.clipSize <= 0 || this.clip >= p.clipSize || this.reserve <= 0) return;
    if (this.cooldown>0) {this.reloadQueued=true; return;}
    this.reloadQueued=false;
    this.begin(p.reloadSingly ? "start" : "magazine", p.reloadSingly ? p.reloadStart : p.reloadTime);
  }
  private begin(phase: ReloadPhase, duration: number) {
    this.phase = phase; this.remaining = Math.max(duration, 1 / 60);
    this.events.push({ type: "reload", phase, duration: this.remaining });
  }
  private insert() { const n = Math.min(this.profile.clipSize-this.clip, this.reserve, this.profile.reloadSingly ? 1 : Infinity); this.clip += n; if (!this.infinite) this.reserve -= n; }
  step(dt: number, attack: boolean): WeaponEvent[] {
    const p = this.profile;
    this.cooldown = Math.max(-dt,this.cooldown-dt);
    if (this.rechargeLeft > 0) this.rechargeLeft = Math.max(0, this.rechargeLeft - dt);
    if (this.ammoPending && (this.ammoTimer -= dt) <= 0) this.incrementAmmo();
    if (this.reloadQueued && this.cooldown<=0 && !attack) this.reload();
    if(p.charge) {
      const held=attack;
      if(!held) this.chargeCanceled=false;
      if(held && !this.chargeCanceled && this.chargeTime===null && this.cooldown<=0 && !this.phase && this.hasAmmo) this.chargeTime=0;
      if(this.chargeTime!==null) {
        this.chargeTime+=dt;
        attack=!held || (p.charge.autoRelease && this.chargeTime>=p.charge.seconds);
        if(attack) {this.releasedCharge=Math.min(this.chargeTime,p.charge.seconds);this.chargeTime=null;}
      } else attack=false;
      if(!this.hasAmmo && !this.phase) this.reload();
    }
    // A loaded shell can interrupt a singly reload; magazine changes complete before firing.
    if (attack && this.phase && p.reloadSingly && this.hasAmmo && this.cooldown <= 0) this.phase = null;
    if (this.phase) {
      this.remaining -= dt;
      if (this.remaining <= 0) {
        if (this.phase === "start") this.begin("insert",p.reloadTime);
        else if (this.phase === "insert") { this.insert(); this.begin(this.clip < p.clipSize && this.reserve > 0 ? "insert" : "end", this.clip < p.clipSize && this.reserve > 0 ? p.reloadTime : p.reloadEnd); }
        else { if (this.phase === "magazine") this.insert(); this.phase = null; }
      }
    }
    if (attack && !this.phase && this.cooldown <= 0) {
      if (this.hasAmmo) {
        if (p.throwable) this.rechargeLeft = p.throwable.recharge;
        else if (p.clipSize >= 0) this.clip -= p.ammoPerShot;
        else if (p.reserve > 0) {
          // Flamethrower consumes fractional ammo per damage tick, accumulating
          // whole rounds exactly like CTFFlameThrower::PrimaryAttack.
          this.ammoRemainder += p.ammoPerShot;
          const spent = Math.floor(this.ammoRemainder + 1e-9);
          if (!this.infinite) this.reserve = Math.max(0, this.reserve - spent);
          this.ammoRemainder -= spent;
        }
        this.cooldown += Math.max(p.fireDelay,1/60);
        this.events.push({ type: "shot", ...(p.charge ? {charge:this.releasedCharge} : {}) });
        if (p.ammoEvent != null) { this.ammoTimer = Math.max(0, p.ammoEvent); this.ammoPending = true; }
      } else { this.reload(); this.cooldown = Math.max(0.2,this.cooldown); }
    }
    return this.events.splice(0);
  }
}
