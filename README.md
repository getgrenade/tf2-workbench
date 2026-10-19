# Download https://github.com/getgrenade/tf2-workbench/releases 

# TF2 Workbench

A viewer and scene composer for Team Fortress 2 models. Reads everything from game files in real time. 


- **Player models, cosmetics, weapons, taunts**: Use unlimited amount of player models in a single scene. Instantly equip & switch between cosmetics, taunts and weapons with browser system.
- **Lighting, Cameras & Overlays**: Single directional light emulating hlmv.exe by default. Add any amount of custom lights, real time shadows, post processing layers. Camera system with preset resolutions and overlays to add custom images, text and borders.
- **Animation and posing**: sequences, taunts, pose editor with rig controls and pose library.
- **Unusual effects**: emulation of game's particle systems. can preview any in game effect or import your own.
- **Play mode**: control player models with in game controls, shoot, gesture & killbind if you want.
- **Scenes & Save**: Supports multiple scenes in a single session with save/load support.
- **Capture**: PNG and layered PSD screenshots, MP4 / WebM / optimized* GIF video and a turntable.
- **Item compiler**: real time preview for your workshop cosmetics with an option to compile it into /import_source/ folder same as in-game importer would. Real time jiggle bone editor. Custom proxies support. Reads .fbx, .smd and .dmx models, shape keys (face flexes) included.
- **Props**: browse the game's prop models (and any folder of loose models and materials you add: an addon, `tf/custom`, what you compiled), drag them into the scene, and shoot, push and blow them about in play mode. The compiler's Prop side builds a model for a map (collision, materials, LODs) into a folder of your choice.

TF2 Workbench is a fan project. It is not affiliated with or endorsed by Valve. **No game files are included in this repository**:
the app reads them from your TF2 installation.

## Build your own version

Do this only if you want to create your own version of this app.
Needs Windows 10/11, [Team Fortress 2](https://store.steampowered.com/app/440/), [Node.js](https://nodejs.org/) and
[Rust](https://rustup.rs/).

```
start.bat
```

installs the packages on the first run, then starts the app in development mode (compiles on the first run, reloads as the code changes).
On first launch it finds TF2 through Steam.

`build.bat` makes a compact portable build in `share/`.

## Develop

| | |
|---|---|
| `src/` | the interface (TypeScript, Three.js, Vite) |
| `src-tauri/` | the desktop shell (Tauri 2) |
| `crates/source-formats` | readers for the Source formats: VPK, MDL/VVD/VTX, VTF/VMT, PCF, KeyValues, animations |
| `crates/workbench-core` | the app's backend without Tauri: reads the game's files and answers the viewer |
| `native/particle-probe` | optional native particle helper built from the Source SDK |
| `docs/` | notes on how individual features work |

```
npm test          the frontend tests
cargo test        the Rust tests (several need TF2 installed and are skipped or ignored without it)
npm run build     type check and production build
```

Settings, the last session, poses and custom effects are kept in `%APPDATA%\dev.tf2workbench.app`.

## License and notices

GPL-3.0-or-later (see [LICENSE](LICENSE)). Parts of the code follow the Valve Source 1 SDK and stay under its license: see
[NOTICE.md](NOTICE.md) and [licenses/](licenses/).
