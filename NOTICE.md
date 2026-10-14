# Notices

TF2 Workbench is a fan project. Copyright (c) 2026 getgrenade. Its own code is free software under the GNU General Public License, version 3 or
(at your option) any later version (see [LICENSE](LICENSE)), except the files listed under "Valve Source 1 SDK" below, which stay under Valve's
license. It is not affiliated with or endorsed by Valve Corporation. Team Fortress 2, Source and the Source engine are trademarks and property of
Valve Corporation. No game files are included in this repository.

## Blender

The rig solver (`src/rig/`) follows Blender's own algorithms for parents, constraints, bendy bones and IK, and Blender is GPL: it is one of the
reasons the code is GPL. Blender itself is not included: the program runs the copy of it the user has installed.

## Valve Source 1 SDK

Parts of this project are written after, or port, code of the Source 1 SDK (Source SDK 2013), Copyright (c) Valve Corporation. All rights
reserved. Those files are **not** relicensed under the GPL: they stay under the terms of the SOURCE 1 SDK LICENSE (which asks, among other
things, that distributions are free of charge), which is included as
[licenses/SOURCE1-SDK-LICENSE.txt](licenses/SOURCE1-SDK-LICENSE.txt), together with Valve's
[third party legal notices](licenses/thirdpartylegalnotices.txt).

These are the files and folders that follow the SDK:

| | what |
|---|---|
| `src/viewer/particles/sdk/` | the particle system: the random number stream (`vstdlib/random.cpp`), the operators, emitters, initializers, forces and constraints as the engine runs them |
| `crates/source-formats/src/mdl.rs`, `anim.rs` | the studio model and animation formats (`studio.h`, `studio.cpp`) |
| `src/viewer/jiggle.ts`, `flex.ts`, `gaze.ts` | jiggle bones, flex controllers and eye gaze after the engine's code |
| `src/viewer/proxies.ts`, `sourceShader.ts`, `eyeShader.ts` | material proxies and the shaders that imitate the engine's |
| `src/compiler/classLods.ts` | the bone commands of the first two `$lod` blocks of the player classes (`modelsrc/player/<class>/scripts/<class>.qci` of the SDK content): bone names only |
| `native/particle-probe/` | a small program that links Valve's particle libraries; it is built on your machine against your own copy of the SDK, which is not included here |

Whoever redistributes the files above (alone or as part of this project) has to follow Valve's license for them: keep the license file, the notices
and the copyright notice, and keep them free of charge. The rest of the project is GPL-3.0-or-later.
