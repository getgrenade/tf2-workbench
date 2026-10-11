# TF2 Workbench

A viewer and scene composer for Team Fortress 2 models, cosmetics and weapons. It reads the models, materials and animations straight from
your own TF2 install, so what you see is what the game draws.

- **Characters, cosmetics, weapons, taunts and buildings**, with paints, styles, team colours, bodygroups and LODs. Every cosmetic and
  weapon of the game (and Workshop zips you add) can be tried on any class that can wear it.
- **Animation and posing**: sequences, taunts with their props, a pose editor with hand poses, flexes and jiggle bones, ragdolls.
- **Unusual effects and weapon effects**: the game's own particle systems, simulated and drawn in the viewer, on cosmetics, weapons,
  projectiles and conditions.
- **Play mode**: steer a character with WASD, fire weapons, throw projectiles, hit and gib other characters.
- **Scenes**: several characters, lights (directional, point, spot), shadows, fog, ambient occlusion, rim light, skyboxes, cameras with
  overlays; saved as scene files.
- **Capture**: PNG and layered PSD screenshots, MP4 / WebM / optimized GIF video and a turntable.
- **Item compiler**: turns your own model and textures into a Workshop-ready cosmetic (needs the Source SDK tools that ship with TF2).
- **A web version** without the compiler that runs in a browser (see [docs/web-build.md](docs/web-build.md)).

TF2 Workbench is a fan project. It is not affiliated with or endorsed by Valve. **No game files are included in this repository**:
the app reads them from your TF2 installation, and the web version's data is extracted from it by you with `build-webapp.bat`.

## Run it

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

Free of charge. Parts of the code follow the Valve Source 1 SDK and come under its license: see [NOTICE.md](NOTICE.md) and
[licenses/](licenses/).
