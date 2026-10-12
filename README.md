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
- **Item compiler**: real time preview for your workshop cosmetics with an option to compile it into /import_source/ folder same as in-game importer would. Real time jiggle bone editor. Custom proxies support.
- **A web version** without the compiler that runs in a browser (see [docs/web-build.md](docs/web-build.md)).

TF2 Workbench is a fan project. It is not affiliated with or endorsed by Valve. **No game files are included in this repository**:
the app reads them from your TF2 installation, and the web version's data is extracted from it by you with `build-webapp.bat`.

## Build your own version

Do this only if you want to create your own version of this app.
Needs Windows 10/11, [Team Fortress 2](https://store.steampowered.com/app/440/), [Node.js](https://nodejs.org/) and
[Rust](https://rustup.rs/).

```
start.bat
```

installs the packages on the first run, then starts the app in development mode (compiles on the first run, reloads as the code changes).
On first launch it finds TF2 through Steam.

`build.bat` makes a compact portable build in `share/`. `build-webapp.bat` builds the web version into `dist-web/`.

## Develop

| | |
|---|---|
| `src/` | the interface (TypeScript, Three.js, Vite) |
| `src-tauri/` | the desktop shell (Tauri 2) |
| `crates/source-formats` | readers for the Source formats: VPK, MDL/VVD/VTX, VTF/VMT, PCF, KeyValues, animations |
| `crates/workbench-core` | the app's backend commands, shared by the desktop app and the web build |
| `crates/workbench-wasm`, `crates/webbake` | the web build: the backend as WebAssembly and the extraction of the game files |
| `native/particle-probe` | optional native particle helper built from the Source SDK |
| `docs/` | notes on how individual features work |

```
npm test          the frontend tests
cargo test        the Rust tests (several need TF2 installed and are skipped or ignored without it)
npm run build     type check and production build
```

Settings, the last session, poses and custom effects are kept in `%APPDATA%\dev.tf2workbench.app`.

## License and notices

Free of charge, all rights reserved except as the [LICENSE](LICENSE) says. Parts of the code follow the Valve Source 1 SDK and come under its
license: see [NOTICE.md](NOTICE.md) and [licenses/](licenses/).
