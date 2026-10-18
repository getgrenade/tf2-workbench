# Native unusual effect preview

This helper runs the original PCF through Valve's SDK `particles.lib`. The viewer receives its positions, colors, alpha, radii, rotations, lifetimes and sprite sequences. Three.js still draws the result. This is native **simulation**, not the complete TF2 renderer; exact visual parity is not yet established.

Any installed hat/taunt PCF system can be requested. The query adapter receives posed hitboxes and implements Source hitbox sampling, normalized relative coordinates, hitbox transforms and containment. It supplies white lighting, unobstructed world traces and full visibility. These environment queries and exact mesh-inside tests still differ from the game. Arctic Delight retains its visually approved compatibility backend.

## Build and use

Requires Visual Studio C++ x64 tools, the local Source SDK 2013 checkout and installed 64-bit TF2 runtime DLLs. No downloads or changes to the SDK/game installation are required.

```powershell
& ./native/particle-probe/build.ps1
# If the SDK checkout moved:
& ./native/particle-probe/build.ps1 -SdkRoot 'C:\Projects\Source SDK 2013\source-sdk-2013\src'
# Compile an investigation build while the live helper is locked:
& ./native/particle-probe/build.ps1 -ExecutableName particle-probe-test
```

The script builds SDK mathlib/tier1 sources and links Valve's particle/DMX libraries. Outputs/logs stay under ignored `target/particle-probe`. SDK dependencies are cached; changing the build script rebuilds them. Changes to SDK sources require removing the two cached `.lib` files before rebuilding. Disable active native effects before replacing the default helper, since Windows can lock a running executable. Alternate executable names are for standalone investigation only; the viewer still uses `particle-probe.exe`.

The viewer passes `-seed <n>` (the collections' random seed, 273 when absent): the same seed, control points and ticks give the same particles every time, which is how a promo shot comes out the same each time it is taken.

Development builds automatically find `target/particle-probe/particle-probe.exe`. Enable Silver; the panel says **Silver Serenade: native simulation**. Without the executable the existing compatibility preview remains available and is labeled accordingly. A present helper that fails produces an error instead of silently replacing its motion.

`build.bat` compiles a separate `particle-probe-package.exe` (so the development helper can stay running), then copies it as `native/particle-probe.exe` beside both the release viewer and the portable viewer in `share/TF2Workbench`. The ZIP contains the entire portable folder; keep its `native` folder beside the viewer. Existing portable poses are preserved when rebuilding. Run `build.bat --no-pause` for unattended validation. Build prerequisites include the Visual Studio C++ tools and Source SDK checkout above. Runtime prerequisites remain installed 64-bit TF2 and WebView2; game DLLs/assets are read from the local install, not bundled. Redistribution of SDK-linked code still requires reviewing Valve's applicable license before publishing a distribution.

## Verify

```powershell
cargo test -p tf2-workbench native_particles --offline -- --include-ignored
```

The Silver lifecycle test loads all 36 instances, advances 720 fixed ticks, checks five active ropes and finite/bounded attributes, verifies identical restart, updates an attachment and checks independent helpers. The catalog test scans every installed unusual system and simulates three seconds with model query data. A repeating-taunt test verifies fresh births after the schema interval. Frontend tests check query transforms, saved IDs, team remapping, trails, atlas blending and native render attributes.

The standalone probe can load an extracted PCF:

```powershell
$env:PATH = 'C:\Program Files (x86)\Steam\steamapps\common\Team Fortress 2\bin\x64;' + $env:PATH
& ./target/particle-probe/particle-probe.exe ./target/smissmas2022_unusuals.pcf unusual_sheetmusic_silver_parent -game 'C:\Program Files (x86)\Steam\steamapps\common\Team Fortress 2\tf'
```

## Bridge and lifecycle

`-stdio` reads the PCF through Source's mounted GAME filesystem. Each selected effect gets a hidden helper process. Each stdin line is `ticks forwardXYZ rightXYZ upXYZ positionXYZ boxCount [minsXYZ maxesXYZ matrix3x4 ...]` followed by the optional fields (action, flame, colours, instances, target) and, last, `floorCount [z] binaryFlag`: with binary flag 1 the answer is a binary frame, `BIN <bytes>` and then the bytes (u32 collection count; per collection f64 time, f64 dt, u32 particle count and 17 float32 per particle: x y z r g b alpha radius roll born life sequence yaw prevXYZ trail; the collections are in the order of the first, text, frame), which skips formatting and parsing 45000 numbers per frame of Electric Impulse (about 10 ms to 2 ms). With `floorCount [z]`: with `1 z` the helper's world trace is a plane at that height, which is what "Collision via traces" lands on (the footprints of Electrocution fall under 500000 gravity and rest on it); without it nothing is solid, with 0–6 ticks at 1/60 second and up to 128 hitboxes. Matrices are row-major in Source actor space. Responses begin `FRAME ` followed by JSON; startup console output is ignored. Each collection exports timestep plus 17 particle values: position, RGB, alpha, radius, roll, creation time, lifespan, sequence, yaw, previous position and trail length. Each recursive collection has its own instance ID, including repeated children. Rebuild the helper when changing the protocol; old binaries are incompatible. `-refire seconds` restarts emitters at a schema interval without discarding existing particles.

The frontend sends Source model-space attachment frames. `mathlib_base.cpp::MatrixVectors` requires negating the matrix's Y column for the right vector. Actor placement is applied once by the effect group. Requests do not overlap per actor; queued ticks are capped at six. Under sustained IPC overload the preview slows instead of accumulating unlimited work. Multi-actor performance has not been benchmarked.

Collections without renderers export their identity/timing/capacity and an empty particle array. Their simulation and child control-point/emission behavior remain entirely native. Electric Impulse has 97 instances, including dense invisible rope drivers; exporting those unused particles previously delayed visible state updates independently of viewport FPS. A local 180-tick helper round-trip benchmark (including JSON parsing, excluding Tauri/webview transport) dropped from 12.0 ms average / 22.2 ms p95 to 3.8 ms / 10.2 ms, with average payload reduced from 486 KB to 151 KB. A before/after comparison found identical visible attributes in all 181 snapshots. The installed transport regression checks that driver payloads are empty while their electric-ray children remain active. These timings are local measurements, not general performance guarantees.

Rust validates/bounds frames, applies timeouts and kills/reaps removed or failed helpers. A document generation reset removes helpers after webview reloads and rejects stale loads. Closing the parent closes stdin; EOF exits the helper. SDK globals stay outside Rust.

Startup connects console-variable, filesystem and material systems, mounts installed misc/texture VPKs, initializes `shaderapiempty`, sets both material-system aliases and the global particle manager, registers built-in operators and precaches materials before constructing collections. The empty shader API supports simulation/material metadata; it does not produce TF2-rendered images.

Headless texture objects do not reliably expose animation-sheet resources. At startup a temporary graph precaches reachable materials. A texture adapter reads each distinct texture's original VTF sheet resource from the mounted filesystem and passes it to Valve's sheet loader/cache. The graph is then recreated with the same seed before ticking. This restores operators such as Lifetime From Sequence without replacing their authored behavior. File bytes are allocated locally and read through Open/Read/Close to avoid freeing buffers allocated by a different runtime DLL. The installed splash regression checks all four Sulfuric Acid splash variants and their 14-frame / 30-FPS lifetimes.

## Remaining fidelity work

An audit after visual feedback found two semantic bugs that earlier finite-state/restart tests missed: `SEQUENCE_NUMBER` is a Source float attribute (reading integer bits made sequence 1 become 1065353216 and fall back to sheet 0), and `C_OP_RenderRope` passes particle radius as the full beam width (`CBeamSegDraw` offsets edges by half that width). Both are corrected. Native tests now assert the actual PCF's leading sequence 1 and distinct authored note variants; the ribbon test asserts edge-to-edge width equals radius. Invalid native Silver sequence indices are rejected rather than silently rendered with the fallback symbol.

Compare output against the game at matched times, camera and attachments. WebGL shaders, ribbon edges, sprite orientation/sheet interpolation, depth fades, lighting, HDR/bloom and final composition can still differ. The SDK archive is authoritative for this backend's operators but does not prove every current live-game operator is identical. Expand effects only after their engine queries and material paths are verified.
