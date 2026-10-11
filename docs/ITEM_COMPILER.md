# Item compiler (2026-10-09)

The **Compiler** tab is the viewer with the item under construction where the cosmetics browser is (the weapons browser stays). It does what the game's workshop importer does (item_import.cpp, CAssetTF) and writes the same archive, but it shows the item on the selected character as soon as a file is given, and builds in about a third of a second.

## What the artist does

1. Types the name, picks Hat or Misc, the equip region and the body groups it hides.
2. Gives the FBX of LOD 0: the item appears on the selected character, skinned to the class skeleton. The LODs that go with it are found by name in the same folder (`body_lod0` brings `body_lod1` and `body_lod2`; `hat.fbx` brings `hat_lod.fbx` / `hat_lod2.fbx`) and can be changed by hand.
3. Gives a TGA per material: diffuse, optionally normal, exponent and glow mask. Each is applied at once; picking one brings the others of the material by name (`a_body_diffuse` brings `a_body_normal`, `a_body_expmask`; also `_color/_albedo`, `_nrm`, `_exp/_exponent`, `_illum/_glow`...), and textures picked by hand are never replaced. A "Material settings" fold has what the importer's material editor has (light ramp, phong, rim light, half-lambert, paintable, translucent/alpha test/additive, glow, reflection).
4. Gives the 512x512 backpack icon.
5. The list at the bottom shows what the importer would refuse (triangle budgets 1400/1000/700 per LOD, two materials at most, LOD material counts, texture sizes and power-of-two sides, the icon's size, alpha and safe zone, custom bones over 5) and what is missing. **Build** writes `tf/workshop/import_source/<name>.zip` (and `<name>.txt`, the session file the importer's Load button reads), mounts it, and the item shows up in the cosmetics browser of the Viewer tab. Building again replaces the archive and session file of that name.

Files are watched: re-export the FBX or save the TGA and the preview reloads within a second and a half. The session (paths and settings, not the files) is remembered between runs.

## How it works

- `src/compiler/fbx.ts` reads the FBX with three's FBXLoader and adds what it lacks: the file's axis system (GlobalSettings, binary or text) and a welded, per-material, skinned form in the game's Y-up frame (the frame of the game's own VVD files). Units are taken as they are, as the importer does. Checked against `a_cowboyhat`: the bounds equal those of the model the importer compiled.
- `src/compiler/preview.ts`: the item becomes a cosmetic with the class's own skeleton (bones of the item that the class lacks follow their nearest class ancestor, as in the game's bonemerge), wound the way the class's meshes are, with tangents computed. The material is built from the VMT like any other (`buildPreviewMaterial`), with the light ramp read from the game.
- `src/compiler/vmt.ts` and `kv.ts`: the importer's material template and its RemoveUnnecessaryParameters rules. The default prints byte for byte what the importer wrote for `a_cowboyhat`.
- `src/compiler/tga.ts` (and `tga.rs`): TGA reading and the importer's size and icon checks. A 32 bit TGA keeps its alpha whatever the descriptor says (the importer's own writer leaves the bits at 0).
- `src/compiler/smd.ts`: the model as a Studiomdl Data text in the Y-up frame, bind pose and skin included. (The importer feeds studiomdl a .dmx made from the FBX; an .smd of the same geometry compiles to the same model: same bounds, UVs, triangle count and winding as the importer's, with fewer vertices.)
- `crates/source-formats/src/itemcompile.rs` (Rust): fills the game's own QC template (`scripts/itemtest_qc_template_*.txt`), runs the game's `studiomdl.exe` in a private game folder, converts the textures natively (`vtf_write.rs`: DXT1/DXT5, full mip chain, thumbnail, the importer's flags and sizes; a flat colour such as a phong exponent map comes back exactly), and packs the archive (`zipw.rs`: stored entries, backslash paths, comment `XZP1 0`, like the importer's) with a manifest in the importer's format. Texture conversion takes about 10 ms per texture (vtex is started per texture by the importer).

## Differences from the importer

- The sources in `content\` are `.smd`, not `.dmx`; the importer's Load button reads either.
- The compiled model has no `hat_rig` root bone (it comes from a null node of the FBX); the bones are the class's own, with the same bind pose.
- No taunts or animations, and no workshop upload.
- `polyCount` in the manifest is the triangle count (the importer counts the artist's polygons).
- Custom bones (cloth, jiggle) are listed and counted but the preview does not simulate them.

## All-class items

The class buttons above the LOD rows pick the class whose models are edited (they also switch the viewer's character). Models are per class; the textures, icon and material settings are shared. A class with a dot has models. With models for one class the item goes in that class's folder; with two or more it is built the importer's way: folder `all_class`, one model per class named `<name>_<class>`, schema `model_player_per_class`. Every class needs the same number of LODs and the same material count (materials are matched by position). Each class is compiled by its own studiomdl run, in parallel.

## Checks

Tests: `tests/integration/{fbxImport,compilerPreview,compilerSession,vmt}.test.ts`, `tests/tga.test.ts` and, in Rust, the unit tests of the compiler modules plus `crates/source-formats/tests/itemcompile.rs`, which builds a tile with the installed studiomdl and reads the archive back.

## Team colours

The **Team colours** switch in the item block gives the item a RED and a BLU skin (the importer's skin type "team colored", `skin_type 1`). Each material then has a **Diffuse BLU** texture (optional: empty means BLU uses the RED one, and no second texture is written) and, in the material settings, its own **Colour before paint** and **Glow colour** for BLU (they follow RED until changed). Normal, exponent and glow textures and every other setting are shared by both skins, as in the importer's material editor.

What is written: a second material file per material (`<name>_blue.vmt`, `<name>_1_blue.vmt`), `<name>_blue_color.vtf` (and the .tga in `content`) for a BLU texture of its own, two skin families in the QC (`{ RED materials } { BLU materials }`), `skin_type 1` and a filled `blue` skin in the manifest. The preview shows the skin that matches the character's team.

## The Compiler tab

The compiler takes the left panel, at the width it has in the Viewer (so the 3D view and its camera do not move when you switch), in place of the characters / bodygroups / effects / textures controls; the cosmetics and weapons browsers stay on the right as in the Viewer, so other items can be put on the character to see the item with them. Under **Model**, the class picker is followed by **Show on** RED / BLU (the team of the character, so the item's skin) and **LOD** 0 / 1 / 2 (the level of detail of the character and the item), so the preview needs no trip to the other panels.

**Materials flyout.** The materials (textures per skin, material settings) are in a panel of their own that slides out of the left panel over the 3D view (480px, remembered open or closed with the handle on its edge). The 3D view underneath keeps its size, so the camera does not move; the view buttons at its left shift out from under the panel. The left panel keeps the item itself (name, type, region, hides, icon, models, checks, Build).

In the materials panel the two materials are two columns side by side, each with its textures and then its settings (always shown). Texture rows show only what is wrong with a file. The numbers (phong exponent and boost, rim exponent and boost, paint blend) are sliders with a box to type in (a typed value may go past the slider's end); the mouse wheel over a slider moves it (a notch is a step, Shift ten steps).

## Generate icon

The **Generate icon** button under the icon slot opens the item alone in a scene of its own (a new scene tab, like inspecting an item): the character shows the parts the body parts system picks for the item's equip region (the head for a hat), as Inspect does, with the item's Hides chips applied and the parts picker to hide more; the view is framed square with the vertical field of view at 22° (so the view's full height is the 512x512 picture), black behind, the lights at their defaults, no fog, ambient occlusion, rim light or ground shadow, and no grid or light markers. An overlay shows the square and two dashed lines at rows 91 and 420 of 512 (`ICON_SAFE_ROWS` in `src/compiler/tga.ts`, the importer's rule for where the picture may be); orbit and zoom to keep the item between them. The compiler's live preview stays on, so texture and settings changes show.

**Create backpack icon** (at the top of the view) renders the view twice at 512x512 with a camera at the view's place: once over black for the colours, once transparent for the coverage, which becomes the alpha channel. It saves a 32 bit TGA as `<name>_icon.tga` in the tool's `icons` folder (next to the program, or in the app's config folder when that cannot be written to; `save_item_icon`, `Viewer.captureIcon`, `encodeTga`), puts it in the icon slot and closes the studio, back to the scene the item is built in. If the importer's icon check (`iconProblem`) finds a problem, such as pixels outside the safe rows, the studio stays open and says so. Opening another scene tab ends the studio and puts the viewer's background, field of view, grid and markers back.

## Smart fill

The **Smart fill** switch (on by default, saved with the session; its tooltip lists these rules) fills what a picked file comes with, from the names of the files beside it (`src/compiler/siblings.ts`, `CompilerSession.fillFromNames`):

- **LODs:** `hat.fbx` brings `hat_lod1.fbx` and `hat_lod2.fbx` (or `lod0` / `lod1` / `lod2` in the names).
- **Classes:** a model named for a class (`sniper_hat.fbx`; `scout`, `soldier`, `demo` / `demoman`, `medic`, `heavy` / `heavyweapons`, `pyro`, `spy`, `engineer` / `engie`) brings the same name for the other classes in the folder (`heavy_hat.fbx`, `spy_hat.fbx`...) with their LODs, which makes the item an all-class item.
- **Textures:** a diffuse texture (`hat_diffuse.tga`) brings the normal (`hat_normal.tga`) and the exponent (`hat_expmask.tga`). A model in a folder called `mesh` with a folder called `texture` (or `textures`) beside it also gets each material's diffuse texture: the .tga there whose name has the material's name in it.

Files picked by hand are never replaced; ones filled by a smart fill are replaced by the next fill. With the switch off nothing is filled.

The studio cuts the picture to the safe rows: what is above the upper line or below the lower one is dimmed in the frame and is cut away from the icon (`maskIcon` in `src/compiler/iconMask.ts`), so the icon always passes the importer's check. To soften the cut at the bottom, the panel at the left of the view has **Fade the bottom** with a **Height** (rows of the 512, up from the lower line) and a **Curve** (1 is a straight ramp; more keeps the picture solid longer and drops faster at the end), each a slider with a box to type in. A gradient band in the frame shows where and how the picture eases out, and the switch and shape are remembered. The fade scales colour and alpha together, as the colours are over black.

## Open

**Open** (next to New, at the top of the item block) opens the importer's session file of an item (`tf/workshop/import_source/<name>.txt`: the one the game's importer writes, or this tool beside the zip it builds; the dialog starts in that folder). It fills in the name, type, region, hidden body groups, the model files of each class with their LODs, the icon, the materials with their textures and material settings (paint, tints, phong, rim, glow, reflection), and the BLU skin of a team-coloured item (`parseImportSession` in `src/compiler/importSession.ts`), then reads the files like files picked by hand. The importer names its materials by its own list, not always the model's: materials that match no name in the model take the model's names in order. A file it names that is no longer on disk shows up in the checks as one that cannot be read. The jiggle bones come from the `$jigglebone` blocks of the per-class QC the importer keeps in the session (`parseJiggleQc` in `src/compiler/jiggleBones.ts`), so their boxes are ticked in the Jiggle bones menu with their numbers; a bone takes the setup of the first class that defines it. Other edits in that QC (bonetreecollapse, attachments) are not carried over: this tool writes its own QC.

## Jiggle bones

The bones the model brings that the class does not have (a tail, a tassel, a cloth strip: the **Bones** section of the materials panel lists them as a tree) can be given spring physics. The model already carries the weights, so only the physics is set here; the editor follows the TFMV one (`TFMV/UserControls/Jigglebone_Editor`) and the game's client code (`public/jigglebones.cpp`, ported in `src/viewer/jiggle.ts`).

- **Physics** (`src/compiler/jiggleBones.ts`): tick a bone in the list to give it a setup (its length starts as the distance to its child) and click it to edit: flexible or rigid, length, tip mass, yaw and pitch stiffness and damping, allow length flex with its along spring, yaw, pitch and angle constraints (min, max, friction, bounce), a base spring (mass, stiffness, damping and the left, up and forward limits) and boing. Each number is a slider with a box to type in. The setups are written as `$jigglebone` blocks at the end of each class's QC (`jiggleQc`; only the bones that class's model has) and compile into the model: the compiler's own tests read the physics back from a compiled model.
- **Axes:** every number is relative to the bone's own axes: it points along Z, yaw swings it around Y and pitch around X. The bone's axes are whatever the exporter gave it, so each bone's axes can be turned (degrees about its own axes) with a rotation gizmo, or aimed at its child with **Aim Z at the child**. Turning the axes changes nothing visible: the item has only its rest pose, so the bone keeps its place, its children keep theirs, and only the offsets written for them differ (`writeSmd`, `src/compiler/boneAxes.ts`). The turn applies to the preview, the SMD and the physics together.
- **In the view:** the selected bone is drawn on the character with its axes (X red, Y green, Z blue), the spring's length (white, with the tip as a ball), the yaw range as a green arc, the pitch range as a red arc and the angle limit as a yellow cone. The item's own bones are bones of the preview (the item's bones are no longer folded into the nearest class bone), and the bones with physics run the viewer's simulation: play an animation in the Animation tab (with Jiggle bones on) to see them move; the bind pose alone does not move them.
- Saved with the session (`jiggles`, `turns`). A bone that a class's model does not have gets no jiggle there, with a warning.

Right-click a bone in the list for **Copy jiggle**, **Paste jiggle** (on another bone: everything but its length, which stays the bone's own span), **Copy to the other N jiggle bones** and **Remove jiggle**. The bone helper is drawn on the character only while the Jiggle bones menu is open.

The axes are turned with a **rotation gizmo** on the selected bone in the view (there are no sliders for it): its three rings turn the bone about its own X, Y and Z (`Viewer.setBoneGizmo`). The drawing of the axes follows the gizmo as it is dragged, and the preview is rebuilt once the drag pauses. The gizmo follows the bone while the character animates and is there whenever the Jiggle bones menu has a bone selected. **Aim Z at the child** and **Reset axes** are beside it.
