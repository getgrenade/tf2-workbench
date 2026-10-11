# Gizmos

All transform gizmos are made by `src/viewer/gizmos.ts`.

## Roles and profiles

A gizmo has one of five roles: `move` (axis arrows, and plane squares where a profile keeps them), `rotate` (axis rings), `scale`, `view` (the ring about the line of sight) and `viewMove` (the centre handle, which moves in the screen plane). A **profile** says how each role looks: its size, the handles taken off it so they do not cover the controls around it, its space, and whether the view ring is drawn thick.

- `GIZMO_SIZE`: the size of each role, one table for every gizmo wherever it shows (move 0.55, rotate 1.2, scale 0.9, view ring 1.0, centre handle 0.45; fractions of the view). Tune the look here.
- `SCENE_PROFILE`: characters, cameras and lights. `COMPACT_PROFILE`: the controls of a pose, with the handles that would sit on top of the controls around them taken off. Both use `GIZMO_SIZE`.

`createGizmo(ctx, role, options)` makes one (hidden, disabled, its helper already in the scene); `GizmoSet` makes the set an owner needs and gives it `all`, `objects` (the helpers, for what a capture must hide), `hot`, `dragging`, `on(event, handler)` (every gizmo, told which role it came from), `show(role, on, pivot?)`, `exclusiveDrag(restore)` (one drag belongs to one gizmo; where pick areas overlap the order is scale, view move, move, rotate, view) and `dispose()`.

Owners keep what is theirs: what a drag changes and when a gizmo shows.

| Owner | Roles | File |
| --- | --- | --- |
| Characters | move, rotate, scale, view, viewMove | `viewer.ts` (`buildEntityGizmo`) |
| Cameras | move, rotate, view, viewMove | `cameraRig.ts` |
| Advanced lights | move, rotate, scale, view | `lightGizmos.ts` |
| Pose controls | rotate, view, move, scale (compact) | `rigOverlay.ts` |
| The point light | move | `viewer.ts` (`buildPointGizmo`) |

`Viewer.editorObjects` lists everything drawn over the scene (gizmos, markers, camera and light symbols); the capture, shadow and lighting passes leave it out. A new gizmo set only needs to put its `objects` there.

## Keys

W move, E rotate, R scale, as in Unity, Unreal and Maya (`gizmoKey`, by key position so other layouts keep them).

- **W / E / R**: on a character, the key brings up the selected character's gizmo as the move, rotate or scale gizmo (there is no gizmo button in the character list), and the same key again puts it away; when a camera, a light or a pose control is being edited, the key picks that gizmo (same as the buttons in the 3D view; scale is not offered for cameras, rotate only for spot lights). Active while the focus is not in a text field (`tab.ts`, `selectGizmoTool`). Clicking another character in the view moves a shown character gizmo to it.
- **Shift + W / E / R**: the same edit by mouse alone, with the pointer in the view: X / Y / Z pick an axis, click or Enter confirms, Esc or right click cancels (this was G / R / S).
- **Alt + W / E / R**: puts the selection's position, rotation or scale back (this was Alt + G / R / S).
- Ctrl + Z / Y: undo / redo of character placement, unchanged.

In play mode W / E / R are not gizmo keys (E / R cycle weapons and reload there).

## Choosing what the gizmo edits

One gizmo target at a time: a character, a camera, a light or (while posing) a pose control. A click in the view moves it: on a character, on a camera (its position or the middle of its frustum's far end, within 14px) or on a light's marker (advanced lights that have a position). The click that picks a camera or light does not move the viewport. `Viewer.onPickTarget` reports the click, `tab.ts` hands the gizmo over.

## Orientation

The last button of the gizmo row sets the orientation of every gizmo (remembered): local turns the move and rotate gizmos with what they edit, global keeps the scene's axes (`Viewer.setGizmoSpace` -> `GizmoSet.setSpace`). The view ring and the view move handle take none. Posing keeps its own rules on top: the rig uses the same setting for its controls, and a finger control always uses its own frame.

Scale follows the orientation on characters and lights (`worldScale`). TransformControls scales along an object's own axes whatever its space, so in the scene's axes the scale gizmo is attached to an unturned stand-in at the pivot, and `GizmoSet` turns the stand-in's scale into the pivot's: each local axis takes the scale of the world axes it lies along, weighted by how much (exact for quarter turns, smooth between). Pose controls keep the stock behaviour.

## Light indicators

The light bulb button beside the floor grid button (remembered, on by default) shows or hides the indicators of the lights: a bulb for every enabled light that has a position (the selected one also shows its reach, or its cone for a spot), and the direction marker of a simple light. While they show, a click on one gives that light the gizmo; picking a light in the lighting list does the same. There is no per-light gizmo button. A click on a character or a camera takes the gizmo away from the light. Indicators are hidden while posing and during live play.

## Rules that keep it clean

- Whether a gizmo shows is decided in one place, `GizmoSet.show` (enabled and helper visible together). TransformControls' own `attach` makes the gizmo visible and `detach` hides it, so nothing outside `GizmoSet` calls them; `GizmoSet` re-attaches through `place`, which keeps the visibility it had.
- Only one target has gizmos showing at a time (character, camera, light or a pose control). `LightGizmos.poll()` runs every frame and re-syncs the light gizmos when something elsewhere changed what is available (a character or camera took the gizmo, posing started).

## Character rotation

A character has a full rotation: `yaw` (about the vertical axis, as before) plus `pitch` and `roll` (`Actor.setTilt`, applied after the yaw in three's YXZ order), so all three rings of the rotate gizmo and the ring about the line of sight work. The tilt is saved in scene files (optional `pitch` / `roll`), is part of undo/redo, and Alt + E puts it back to upright. Play mode plays upright and tips the character again when it ends. The mouse-only rotate (Shift + E) still turns about the vertical axis.
