# Play-mode projectile implementation

Source of truth: `C:/Projects/Source SDK 2013/source-sdk-2013/src`.

## Source references

| Behavior | TF2 source relative to SDK src |
| --- | --- |
| Rocket launch speed and mini-rocket model | `game/shared/tf/tf_weaponbase_rocket.cpp` |
| Rocket model | `game/server/tf/tf_projectile_rocket.cpp` |
| Rocket `trail` model attachment, Rocket Jumper/Air Strike trail selection | `game/client/tf/c_tf_projectile_rocket.cpp` |
| Grenade upward impulse, random lateral velocity and spin; syringe spread; custom projectile model | `game/shared/tf/tf_weaponbase_gun.cpp` |
| Grenade launch speed | `game/shared/tf/tf_weapon_grenadelauncher.cpp` |
| Pipe model, team skin, origin-follow trail and two-second fuse | `game/shared/tf/tf_weapon_grenade_pipebomb.cpp` |
| VPhysics initialization, elasticity and fuse hooks | `game/shared/tf/tf_weaponbase_grenadeproj.cpp` |
| Cow Mangler muzzle and launch speed | `game/shared/tf/tf_weapon_particle_cannon.cpp` |
| Cow Mangler model/explosion, client trail | `game/server/tf/tf_projectile_energy_ball.cpp`, `game/client/tf/c_tf_projectile_energy_ball.cpp` |
| Bison muzzle/speed and trail/colour control points | `game/shared/tf/tf_weapon_raygun.cpp`, `game/shared/tf/tf_projectile_energy_ring.cpp` |
| Default energy weapon colours | `game/shared/tf/tf_weaponbase.h`, `game/shared/tf/tf_weaponbase.cpp` |
| Syringe model, speed, gravity and team trail | `game/shared/tf/tf_projectile_nail.cpp` |
| Wall vs air explosion selection | `game/client/tf/tf_fx_explosions.cpp`, `game/shared/tf/tf_weapon_parse.cpp` |

## Runtime

Weapon profiles come from mounted TF2 scripts/schema. Speed multipliers, custom projectile models, no-spin and mini-rocket hooks are read there. Models, team materials, attachments and particle definitions are loaded from the VPK on demand; no game assets are copied into the repository.

Static projectile meshes bake the MDL default sequence at frame zero, including its authored bone orientation and offset; normals, tangents and trail attachments use this same posed skeleton. Syringe entity rotation tracks velocity each tick, as TF2 ClientProjectile / FTENT_ALIGNTOMOTION does.

Source-space projectiles start at the displayed weapon muzzle and follow play-mode aim. Rockets and energy projectiles fly straight. Grenades get a 200-unit upward impulse, Â±10-unit random up/right impulses and Source angular impulse. Syringes have Â±1.5-degree spread and gravity 240. Grenade gravity uses normal VPhysics world gravity (800), rather than applying the entity's FLY gravity factor to a VPhysics trajectory.

One native process per trail system pools up to 32 independently moving Source collections. Impacts pool eight collections per floor/air system. Unused slots do not simulate; firing creates a fresh Source collection inside the existing process. This preserves child-emitter initialization without per-shot process launches. Trail origins follow projectile models, using the rocket MDL's `trail` attachment. PCF operators, sprite animation and authored emission delays remain in Source. Bison's origin-follow effect receives the colour pair in the order used by its client implementation.

When play stops, native simulations are disposed and their rendered state freezes. Original projectile model paths, team skins and world transforms accompany particle/shell snapshots in saved scenes. Restoring retrieves the models from the VPK without starting emitters. Resaving retains these paths and transforms. Starting play or resetting character particles clears them as before.

## Charged weapons and healing

- Air Strike resolves its own weapon class, mini-rocket model and native trail.
- Loose Cannon holds LMB to cook its one-second fuse, releases to launch at schema speed (1440), and automatically fires at the cook limit. Native sparks follow `cannon_fuse`; buildup smoke follows `muzzle`.
- Demoman sticky launchers hold LMB to charge, release to launch (900–2400 speed), and fire automatically at full charge. Stickies attach to the floor/walls/ceiling, show their native arm pulse, and detonate on RMB after arming. Scottish Resistance uses 14 bombs, its own model, 1.6-second arm time and aim-cone/underfoot selection. Quickiebomb uses its custom model, 1.2-second charge and 0.6-second arm time. Sticky Jumper uses schema limits. Shields have no projectiles.
- Huntsman/Festive bow hold LMB to charge and release arrows. Speed is 1800–2600; gravity 400–80. RMB lowers a drawn bow without firing. Charged locomotion selects ITEM2 deployed animations. The Source CSpriteTrail material is loaded from the VPK on demand, with a 0.3-second history, three-unit width and 1/96 texture resolution. Trail emission stops after three seconds. Arrows follow velocity and stick in scene boundaries; trail history freezes/saves alongside the model.
- Medi Gun holds LMB while aimed at another friendly character. Acquisition range comes from the weapon script (450), retention is 1.2 times that range, and other character bounds block acquisition/retention. Looking away retains the patient. Native CP0 follows weapon muzzle; CP1 follows the patient origin plus Source Z50. Starting/stopping healing uses Medic's dedicated prefire/postfire layers, holding the prefire end pose while connected; it does not repeatedly restart gunfire gestures. Held Medic secondary weapon-only bones receive the model's authored idle clip.

All fired effects across equipped weapons freeze and save on play exit; per-shell model paths support snapshots containing different casing models. Starting play resets them.

## Practical limits

- The viewer has a floor plus an invisible scene collision box, extending 2048 Source units beyond the character bounds. Wall/ceiling impacts work; grenade bounces approximate VPhysics. Map collision, drag and precise rigid-body contact are not replicated. Character impacts now use posed Source hitboxes; see HIT_REACTIONS.md. Healing targeting uses posed character bounds rather than Source hitboxes.
- Launch uses the displayed muzzle, rather than the server eye offset and map trace correction. Normal firing is supported; charged Cow Mangler shots, critical-hit variants, damage, blast jumping and underwater effects are separate work.
- Rockets/energy shots are removed after eight seconds and syringes after three to bound preview lifetime; these are viewer limits, not game entity timers. Grenades use the SDK's two-second fuse.
- Weapon switching retains launched projectiles, placed stickies, particles and casings. Repeated shots reuse finite pools; sufficiently many concurrent shots recycle the oldest slot.
- Native/profile and automated motion/persistence checks passed. Full in-game vs viewport visual comparison and regenerated portable distribution remain pending. The native helper and backend both changed: restart the development client, and use `build.bat` when packaging a release.

Validation: 37 focused JS tests cover motion, charge/cancellation, sticky selection, healing targeting, animation selection and snapshot persistence. Installed profile tests verify models/attachments and schema values. Native tests verify pooled trails/impacts, sticky pulses, cannon charge particles and moving healing CP1. Frontend and dev backend builds pass. A live comparison of the Medic grip still needs user review; damage/health/ÜberCharge, bow overcharge misfires, full bowstring/viewmodel animation and Air Strike blast-jump modifiers are not simulated.

## Huntsman: no reload, stuck arrows, pinning (2026-10-09)

**No reload.** CTFCompoundBow has no reload: its fire sequence (VM_PRIMARYATTACK) carries AE_WPN_INCREMENTAMMO (about 1.03 s in), which moves the next arrow from the reserve into the clip. `get_weapon_profile` reads that event time (scaled by `mult_postfiredelay` and `fast_reload`, as LaunchGrenade scales the animation) into `ammoEvent`; `WeaponCycle` loads the arrow when the timer expires and never plays the rifle reload gesture for a weapon that has an `ammoEvent`. Switching away completes the event so the bow is never stuck empty.

**Arrow strikes a player** (tf_projectile_arrow.cpp, c_tf_stickybolt.cpp, tf_hud_bowcharge.cpp). The arrow is moved inside the hitbox it struck (PositionArrowOnBone: 40 to 60 percent along each axis of the box's world AABB). The victim takes damage; in the app every hit in damage mode kills, as for hitscan. Then:
- If a world surface lies within 125 units of the arrow along its direction (CheckRagdollPinned), the ragdoll is pinned: the struck bone is moved to the wall (7 to 14 units off it) and frozen, the rest hangs from it, and a bolt is left in the wall (5 units drawn back; 30 s).
- Otherwise the "arrow_impact" event makes a client arrow attached to the hit bone (position and angles in the bone's space), so it follows the body and its ragdoll (40 s).

Implemented in `src/viewer/stuckArrows.ts` (geometry, StuckArrows layer), `HitReactions.arrowStrike`, `ArticulatedRagdoll.pin`, and the `arrow` hook of `ProjectileInteractions`. "World" is the viewer's floor and invisible scene box, so a body with its back to the floor or to the box edge pins like against a map wall. Not done: the impact sound, the blood mesh decal trace, headshot-only effects (the achievement), pinning for the skeleton fallback ragdoll (characters without PHY data just carry the arrow), and arrows in gibbed characters (they vanish with the body).

## Jarate, Mad Milk and the cleaver (2026-10-09)

tf_weapon_jar, tf_weapon_jar_milk and tf_weapon_cleaver (tf_weapon_jar.cpp) had no profile projectile, so the app only played the throw gesture, endlessly. Now:
- **One at a time.** A throw empties the hand until the effect bar refills (20.1 s for the jars, 5.1 s for the cleaver; `WeaponProfile.throwable.recharge`, `WeaponCycle.rechargeLeft`; the HUD text counts the seconds down).
- **The throw.** The projectile leaves 0.1 s into the animation (TossJarThink), from the eye 16 units ahead, 8 right and 6 down (`WeaponEffects.throwOrigin`; the jar models have no muzzle attachment). A jar is a pipebomb body: 1000 units/s forward plus 200 up with +-10 of random, gravity 800, rolling at 300 deg/s about its own axis. The cleaver goes `normalize(forward * 10 + up) * 3000` and tumbles end over end at 500 deg/s. Models: urinejar, the festive jar (`override_projectile_type` 22), the bread monster variants (24, 25) and c_madmilk; trails `peejar_trail_red/blu` (`_glow` for the cleaver).
- **Burst.** A jar bursts on the first surface or character it touches (or after its 2 s fuse) with `peejar_impact` / `peejar_impact_milk`, radius 200; `ProjectileInteractions.splash` is called there. A cleaver that hits a character removes itself and, in damage mode, ragdolls the victim; one that lands in the world stays 4 s.

Not done: making enemies wet. In the game a burst drenches every living enemy within 200 units that no wall hides (TF_COND_URINE / TF_COND_MAD_MILK for 10 s): their skin turns yellow (the `YellowLevel` proxy returns (6,9,2) red and (7,5,1) blue; the app's proxy returns 1 and its shader has no `$yellow`), `peejar_drips` / `peejar_drips_milk` run on them, and the thrower's jar is not drawn in the hand while it recharges. Also the cleaver's bleed (5 s) and its cooldown refund, and the Mad Milk heal, are missing.

## Thrown items, lunchboxes, tracers, animation replacements

- **Activity replacement.** An item's `animation_replacement` also rewrites the player's own activities (`ACT_MP_*`). `get_weapon_profile` passes them as `animReplacement`,
  the class model's sequences carry their authored `activity`, and `findReplacedAttack` (playLogic.ts) plays the sequence of the replaced attack: the Buff Banner family's
  bugle call (`item1_buglecall_red` / `_blue`), the Self-Aware Beauty Mark's `ACT_MP_THROW`.
- **Thrown items leave the hand.** Jars, Mad Milk and the cleaver are out of the hand from the moment the projectile leaves until the effect bar is full again.
- **Healing bolt.** The Crusader's Crossbow shoots an arrow-type projectile: the syringe model at 3x, 2400 units/s, gravity 160, trail `healshot_trail_red/blue`. The model has no
  muzzle, so the bolt starts at the eye (23.5 forward, 8 right, 3 down).
- **Tracers.** A hitscan weapon's tracer is `<TracerEffect or the item's tracer_effect>_red|blue`; rifles with "sniper fires tracer" draw `dxhr_sniper_rail_*` and the Classic
  `tfc_sniper_distortion_trail`. The system runs from the muzzle to where the shot ended (control point 1).
- **Lunchboxes** (CTFLunchBox, tf_player.cpp taunt attacks). The primary fire is the class's `taunt04` (the player stands still). A Scout's drink starts its effect 0.9 s in
  (Bonk: phase, `warp_version`; Crit-a-Cola: the minicrit glow; 8 s), a Heavy bites every second from the first (the first shows the bitten model, the Steak's first bite starts its
  16 s minicrits). When it is over the item is used up and its meter runs (Sandvich and drinks 30 s, bars and the banana 10 s) while the player goes back to another weapon; a
  Sandvich at full health (always, here) is not used up. The secondary fire throws the food out (500 units/s, ten degrees up) as its plate model.
- **Huntsman.** The bow hangs on a bone of the right hand and the animations carry it into the left; the root and limbs are kept at the offset from the left hand that they have
  once the idle has settled, so the blend between two animations cannot slide the bow off the hand.
