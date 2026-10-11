# Notices

TF2 Workbench is a fan project, free of charge (see [LICENSE](LICENSE)). It is not affiliated with or endorsed by Valve Corporation. Team Fortress 2, Source and the
Source engine are trademarks and property of Valve Corporation. No game files are included in this repository.

## Valve Source 1 SDK

Parts of this project are written after, or port, code of the Source 1 SDK (Source SDK 2013), Copyright (c) Valve Corporation. All rights
reserved. They are distributed free of charge under the terms of the SOURCE 1 SDK LICENSE, which is included as
[licenses/SOURCE1-SDK-LICENSE.txt](licenses/SOURCE1-SDK-LICENSE.txt), together with Valve's
[third party legal notices](licenses/thirdpartylegalnotices.txt).

These are the files and folders that follow the SDK:

| | what |
|---|---|
| `src/viewer/particles/sdk/` | the particle system: the random number stream (`vstdlib/random.cpp`), the operators, emitters, initializers, forces and constraints as the engine runs them |
| `crates/source-formats/src/mdl.rs`, `anim.rs` | the studio model and animation formats (`studio.h`, `studio.cpp`) |
| `src/viewer/jiggle.ts`, `flex.ts`, `gaze.ts` | jiggle bones, flex controllers and eye gaze after the engine's code |
| `src/viewer/proxies.ts`, `sourceShader.ts`, `eyeShader.ts` | material proxies and the shaders that imitate the engine's |
| `native/particle-probe/` | a small program that links Valve's particle libraries; it is built on your machine against your own copy of the SDK, which is not included here |

Redistribution of this project, or of substantial portions of it, must stay free of charge and must keep the license file, the notices
and the copyright notice above with it.
