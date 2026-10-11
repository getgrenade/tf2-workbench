# Play-mode weapon effects (2026-10-07)

The authority is the local Source SDK 2013 TF2 code, plus the user's installed game. Assets are read from VPKs; no copied game textures/models/PCFs are shipped.

## Data and logic

- `crates/source-formats/src/weapon.rs` reads plaintext scripts or TF2's Thin-ICE-encrypted `.ctx` scripts with the SDK encryption key. The algorithm is adapted from Matthew Kwan's public-domain implementation in SDK `mathlib/IceKey.cpp`.
- `get_weapon_profile` resolves item prefabs, class-specific shotgun/pistol entity names, class AmmoMax, script fire delay/clip/ammo-per-shot, muzzle and brass overrides, and clip/fire/reload attribute classes. Reload durations come from the class hand-model activities where available; scripts supply fallback timings. Shell events come from authored firing sequences, including delayed pump ejection.
- `WeaponCycle` owns ammo/cooldown/reload state. Hold LMB for repeated shots at weapon cadence. R (and legacy key 2) reloads. Single-shell weapons load one missing round per cycle and can be interrupted by firing; magazine reloads complete together. Empty clips reload when attempting to fire. Reserves are finite. Switching cancels reload but keeps ammo; a new Play session resets ammo.
- `PlayController` drives shot callbacks independently of gesture clip duration. Minigun effects require a ready spool and actual firing; right-click-only spin and empty ammo cannot emit.

## Rendering

- `WeaponEffects` loads the original `muzzle` particle graph and follows the equipped weapon's bonemerged `muzzle` attachment. Missing named attachments are skipped rather than placing effects at the player origin.
- TF2's `CTFMinigun::StartMuzzleEffect` uses **muzzle_minigun_constant**, not the script's single-shot muzzle_minigun. It and **eject_minigunbrass** use reusable native collections: start when firing, stop emission on release, let existing particles expire.
- Other guns restart their burst collection per shot. The helper's optional emission command preserves compatibility with unusual-effect requests. A helper is reused, not launched per bullet.
- Ordinary shells are legacy temp models in TF2, not PCFs. The viewer reads the original shell MDL/materials, uses the SDK launch speeds, gravity factor, Euler angular velocities, ten-second lifetime and two-second fade, and approximates collisions against the preview floor. Shells are bounded to 96 active instances. The geometry loader now accepts the compatible MDL 45–48 static layouts used by these older shell models; animation parsing still requires its supported version.
- Weapon emitters simulate in world Source space. Smoke/shells remain at their emitted positions when the character moves. Their parent still follows actor visibility/isolation. Draws participate in the same scene-depth pass as unusual effects.
- Sprite trails follow the SDK library's `C_OP_RenderSpritesTrail::RenderSpriteTrail`: full width is capped to the clamped trail length, then halved for either side of the ribbon. This prevents minigun's 400-unit raw radius from producing oversized cards. This behavior was verified in the shipped SDK `particles.lib` renderer, whose implementation source is not included in this SDK checkout.
- Third-person reload gestures retain their authored playback rate (modified by reload attributes). Ammo timers from viewmodel activities replace the current gesture at each start/insert/end event, as `CMultiPlayerAnimState::DoAnimationEvent` does; they never squeeze a full third-person gesture into a short start phase.
- Flamethrowers select the SDK `new_flame` graph, schema team overrides, or Phlog/Rainblower mode graph. The helper supplies the 30 moving flame control points used by `Assign target CP` / `Movement Follow CP`, including radius, density, velocity, duration, and active point index, following `CTFFlameManager` / `CTFPointManager`. Speed, lifetime, spread, drag, gravity, rise and size come from schema attributes. Player velocity is estimated from muzzle movement; world/map collision and reflection are not simulated. Firing consumes fractional ticks accumulated into whole ammo at the SDK's 14 rounds/second; releasing stops emission and lets flames expire.
- Leaving Play freezes the last render state and disposes native helpers. Native node clocks/attributes (including sprite sequence, roll/yaw, previous position and trail length) and shell transforms/fade age are serialized per character in optional `weaponParticles`. Scene tabs and saved files restore these using original PCF/material/model assets, without simulation or emission. Frozen particles remain in world space and still billboard/depth-test correctly as the camera moves. Each character row has a reset button; starting Play or resuming an animation clears its snapshot. Save during Play first settles the character and particles. Unusual effects are independent.

## Verification

```
node --test tests/weaponCycle.test.ts tests/play.test.ts
npx --no-install esbuild tests/integration/playPointer.test.ts --bundle --platform=node --format=esm --outfile=target/playPointer.test.mjs
node --test target/playPointer.test.mjs
npx --no-install esbuild tests/integration/weaponSnapshot.test.ts --bundle --platform=node --format=esm --outfile=target/weaponSnapshot.test.mjs
node --test target/weaponSnapshot.test.mjs
cargo test -p tf2-workbench --offline installed_weapon -- --include-ignored
npm run build
```

The installed tests require TF2 and the built native helper. They verify encrypted stock profiles, class-specific ammo, animation-derived reload timings, Force-A-Nature clip rounding/reload mode, legacy shell geometry, and idle/fire/stop/restart behavior of pistol, shotgun and minigun graphs. Controller tests verify spin-only suppression and finite-ammo effect shutdown. Visual parity for every unlock/class combination has not been audited.

This is a firing/reload preview, not combat simulation: projectile travel, damage, sounds, charge mechanics, conditional gameplay buffs, weapon-specific deployment logic, and collisions against character/map geometry are not implemented here. Shells require a usable world-model `eject_brass` attachment; viewmodel-only attachment fallback is not invented. The portable output must be rebuilt with `build.bat` to include this checkpoint.

The broader `npm test` run currently encounters a pre-existing Node extensionless-import resolution error in `scene.ts` through `proxies.test.ts`. Its remaining 50 tests passed; bundling `tests/proxies.test.ts` with esbuild and running that bundle passed all 40 proxy/scene/pose tests. The focused weapon/controller tests and installed native tests passed. Silver's existing native lifecycle test also passed with the extended protocol.
