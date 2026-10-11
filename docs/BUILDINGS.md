# Buildings

The **+ Buildable** button in the Characters list (before **+ Add**) opens a row with Dispenser, Sentry and Teleporter. A building is a scene character whose "class" is a model under `models/buildables`: it can be moved, rotated, scaled, lit, saved with the scene, copied (Ctrl + Add) and given a team like a mercenary, and its animation and pose parameters are those of the Animation tab.

## Models (`src/viewer/buildings.ts`)

A building's `cls` is the model path below `models/` (`buildables/sentry2`); a class stays a bare name. The game swaps the model as a building is built and upgraded (`GetFinishedModel` / `GetBuildingModel` in `tf_obj_dispenser.cpp`, `tf_obj_sentrygun.cpp`, `tf_obj_teleporter.cpp`), and the panel under the list has the same two choices:

| | finished | building / upgrading |
|---|---|---|
| Dispenser L1 / L2 / L3 | `dispenser_light`, `dispenser_lvl2_light`, `dispenser_lvl3_light` | `dispenser` (`build`), `dispenser_lvl2`, `dispenser_lvl3` (`upgrade`) |
| Sentry L1 / L2 / L3 | `sentry1`, `sentry2`, `sentry3` | `sentry1_heavy`, `sentry2_heavy`, `sentry3_heavy` |
| Teleporter | `teleporter_light` (spin, direction arrow) | `teleporter` (`build`) |

The three teleporter levels share one model; the level and the entrance / exit mode ride in the `cls` after a `#` (`buildables/teleporter_light#exit2`) and only change the effects. Each model starts on a sequence of its own (`defaultBuildingSequence`), never the bind pose: the effects are anchored on the posed Source space skeleton.

## Animation

- A sentry's `fire` (and `fire_empty`, `fire_rocket`) is an additive sequence, the recoil of the gun, which the game plays as a gesture over the running sentry. `AnimSet::delta_base` bakes such a sequence over `idle_off` (or `running`) instead of over the bind pose, where it would be a pile of deltas.
- The teleporter spins with `running`; the blur and direction arrow are body groups (`teleporter_blur`, `teleporter_direction`) that follow the Charged switch, as `CObjectTeleporter` sets them.
- The sentry aims with the `aim_pitch` and `aim_yaw` pose parameters.

## Effects (`src/viewer/buildingFx.ts`)

The panel's switches are kept per building (`BuildingFx`, saved with the scene):

- **Damage 0-4**: `sentrydamage_N` (at `build_point_0`, at `sentrydamage` on level 3), `dispenserdamage_N`, `tpdamage_N`.
- **Sentry**: Firing plays `fire` and flashes `muzzle_sentry` (level 1, every 0.2 s) or `muzzle_sentry2` (levels 2 and 3, the two muzzles in turn, every 0.2 s each); Wrangler shield is `turret_shield` 30 units up.
- **Teleporter**: Charged runs `teleporter_<team>_charged_levelN`, `teleporter_<team>_<entrance|exit>_levelN` and `teleporter_arms_circle_<team>` on the arm attachments.
- **Dispenser**: Healing beam is `dispenser_heal_<team>` from `heal_origin` to the nearest character.

They run on the lanes the player conditions use (`ConditionParticles`), anchored on the posed attachments; `LaneWant.id` tells two systems of one name apart (the two arms) and `LaneTarget.burst` restarts the burst emitters of a muzzle flash every shot.

## The dispenser's screens

`DispenserScreens` draws what the game's `screen_obj_dispenser_red` / `_blue` show (`scripts/vgui_screens.txt`, `scripts/screens/obj_dispenser_*.res`): a 480x240 meter (`vgui/dispenser_meter_bg_*`) and an arrow (`vgui/dispenser_meter_arrow`) that turns from -85 to 85 degrees with the metal (out of 400), approaching its angle at 80 degrees a second like the `RotatingProgressBar`. The panel is placed as `CBaseObject::SpawnControlPanels` does: its lower left corner on the model's `controlpanelN_ll` attachment, its size from the `controlpanelN_ur` attachment in the space of the first. The Metal slider sets the arrow.

## Not done

Mini-sentries (scale 0.75, skins 2 and 3), the sentry's idle scan, its laser and siren, the rocket launch, building gibs and the teleporter's use effects (`teleported_*`) are not in.
