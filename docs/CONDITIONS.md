# Character conditions (2026-10-09)

The Effects row under Bodygroups switches the conditions that change how a character looks. Each is a flag on `Actor.conditions` (`src/viewer/conditions.ts`), saved in scenes (`SceneEntity.conditions`), and some start by themselves in Play mode.

| Condition | Look | Source |
|---|---|---|
| Ubercharge | every mesh gets `models/effects/invulnfx_red/blue` (a self-illuminated fresnel envmap material) | `ForcedMaterialOverride` of `C_TFPlayerPreviewEffect` / `C_TFPlayer::InitInvulnerableMaterial`; the proxy `InvulnLevel` is 1 on that material |
| Jarate | skin and cosmetics multiplied by (6,9,2) RED / (7,5,1) BLU through the materials' `YellowLevel -> $yellow -> $color2` proxies; `peejar_drips` particles | `CProxyUrineLevel`, `OnAddUrine` |
| Mad Milk | `peejar_drips_milk` particles (no tint) | `OnAddMadMilk` |
| On fire | `burningplayer_red/blue` particles on the hitboxes, and the fire layer on the skin: the material's animated `$detail` (`fireLayeredSlowTiled512`, 121 frames at 30 fps, scale 5) added after lighting through `TCOMBINE_RGB_ADDITIVE_SELFILLUM_THRESHOLD_FADE` with `BurnLevel` as the blend factor | `OnAddBurning`, `CProxyBurnLevel`, `TextureCombinePostLighting` |
| Crit boost | weapons with a `ModelGlowColor` proxy glow (80,8,5) RED / (5,20,80) BLU (tint and self-illumination), and `critgun_weaponmodel_red/blu` sparks spread over the weapon model | `CProxyModelGlowColor`, `UpdateCritBoostEffect` |

How it works: `proxies.ts` reads a `MaterialEffects` (`yellow`, `glow`, `burn`, `invuln`) from the evaluation context; `SourceMaterials.material(data, eye, paint, fx)` caches one material per state; `Actor.applyConditions` swaps the material of every class and cosmetic mesh (`mesh.userData.source` remembers what it is made from; eyes and body-masked meshes keep their own). `Viewer` runs the particles (`ActorEffects.createSystems`, attached to the character like the unusual effects) and the timers of conditions Play mode applied.

Play mode: a Jarate or Mad Milk burst soaks every character within 200 units of it for 10 s (`Viewer.soak`, unless it is Ubercharged); a flamethrower sets alight whoever its 12-unit box meets within 350 units of the muzzle (`Viewer.igniteAlong`) for the initial afterburn of 3 s (0.25 s on a Pyro, who does not burn persistently, `CTFPlayerShared::Burn`). A condition switched on by hand stays until switched off.

Not done: the burn level's ramp (it is at its peak, 1, while the character burns; the game fades it in over 0.3 s and out over the flame's life), the bleed overlay, the screen overlays of the local player, and the burning damage. The Ubercharge material is built by the ordinary VMT path (phong, rim light, fresnel self-illumination and envmap); how closely it matches the game's has not been compared by eye.

## Animation and cost

- **Ubercharge shimmer.** The invulnfx material animates by cycling the frames of its water normal map (`AnimatedTexture` on `$bumpmap`, 70 fps); its `Sine` proxies are constant while the charge is full (they only pulse when it wears off). `material.rs` keeps the frames as `bump_f<N>`, `SourceMaterials` cycles them with the other time-driven proxies.
- **Particle lanes.** Each condition system runs on a pooled native helper (`ConditionLane`, `ConditionParticles` in `particles/conditionLanes.ts`) that is lent to a character while it is in the condition and taken back once the last particle has died. At most 5 lanes exist per system, built ahead of time when a jar or flamethrower is prepared; a character that finds them all busy still changes look but has no particles. Before this a helper was started per character per system, which made a Jarate burst into a group stall (the same cost as the early rocket-into-a-crowd problem). A weapon's crit sparks use the weapon's own hitboxes (a box around its meshes when it has none).

- **Fire layer.** Only a burning character's skin materials carry the detail: `load_texture_frames` reads the 121 frames of the fire texture when the first one needs them (they are shared by every material), and only `$detailblendmode 6` materials use them.
