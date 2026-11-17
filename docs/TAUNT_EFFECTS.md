# Taunt sounds, taunt particles and animated cosmetics

## Cosmetics that move on their own (`src/viewer/itemAnimations.ts`)

Some worn items move all the time, whatever their wearer does. Their models run a sequence on the game's own clock:

| Item | Sequence | Flag |
|---|---|---|
| RoBro 3000 (`pet_robro`) | `idle`: the radar turns | `STUDIO_AUTOPLAY` |
| Grandmaster (`chess_<class>_<team>`) | `ref`: the pieces turn on the `spin` bone | `STUDIO_AUTOPLAY` |
| Hat of Undeniable Wealth and Respect (`treasure_hat_oct`) | `blink`, an auto layer of `ref`: the octopus blinks and waves its tentacle | `STUDIO_REALTIME` |

The engine plays an autoplay sequence under every other (`CalcAutoplaySequences`) and a real-time one at `realtime * Studio_CPS`
(`CalcPoseSingle`), not at the cycle the model is asked for. `AnimSet::evaluate` holds both at the start of the clock, so baking these
sequences gave a still pose. `AnimSet::evaluate_at` takes the clock in seconds, and `AnimSet::bake_on_clock` samples one loop of such a
sequence with the clock running (`bake_sequence` with `onClock`). The sequence list marks these sequences `onClock`; a worn item with one
that moves (`clockSequence`, `clipMoves`) plays it on a loop of its own, in place of the old table of item ids.

An item's `visuals/playback_activity` `start_taunting` names the activity its model plays while its wearer taunts (the Infernal Orchestrina's
`ACT_RUN`, `started`: the drum and key turn). While the character holds a taunt, that sequence plays on the character's clock.

## Taunt sounds and particles (`src/viewer/tauntFx.ts`)

The game makes a taunt's sounds and particles in three ways, and the workbench now reads all three:

1. **The sequence's animation events** (`C_BaseAnimating::FireEvent`). `AE_CL_PLAYSOUND` plays a sound script entry. The old numbered events
   (5004, `CL_EVENT_SOUND`) are the same, and their names are now read from the number. `AE_CL_CREATE_PARTICLE_EFFECT` starts
   `<system> <attach type> [attachment]`. `AnimSet::events_with_options` reads the options of `mstudioevent_t`, and the `sequence_events`
   command returns them with the sound entries resolved.
2. **The taunt item's attributes.** `taunt success sound` and `taunt success sound loop` play with their offsets; the loop repeats (the
   Conga's music). `taunt attack name` is what the game's code does at `taunt attack time` (`CTFPlayer::DoTauntAttack`). The Shred Alert's
   `TAUNTATK_ALLCLASS_GUITAR_RIFF` plays `Taunt.GuitarRiff` and starts `bl_killtaunt` at the player's origin, where it stays.
3. **A worn cosmetic's `cosmetic taunt sound`**, played while its wearer taunts (the Infernal Orchestrina's `pyro.music_backpack`, the
   Boston Boom-Bringer's `scout.boombox`).

`planTauntFx` turns these into a plan when the clip changes or the loadout does. `TauntFxDriver` runs it every frame on the character's clock
(`Actor.fxDriver`):

- Sounds are kept in step with the animation through `syncVoice`. They are heard for the selected character while it plays, like its lines.
- Particles run from their event until the sequence is over. They start again each time it starts over.
- The particles run on lanes of their own (`Viewer.setTauntParticles`, the pool the conditions use) at the class model's attachment, following
  it (`follow_*`) or left where they started (`start_at_*`).

## Not done

- The events of a separate taunt prop's own sequence.
- Taunt attacks other than the Shred Alert's. They are mostly damage, and the partner taunts' particles depend on the partner.
- `AE_CL_STOPSOUND` and `AE_CL_REMOVE_PARTICLE_EFFECT`.
- The sounds' position and level.
- A playback activity for a taunt picked from the sequence list rather than held.
