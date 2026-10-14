# Posing with a Blender rig

Desktop only. The workbench ships no rig: you point it at a `.blend` file of a rig for the game's skeleton (the `bip_` bones) and, while posing a
character of that class, the rig's controls take the place of the built-in ones.

## Setting it up

1. **Settings → Rigs.** The app needs a copy of Blender (4.1 or newer) to read the files; it looks for one by itself (**Find**), or **Browse…** to it.
2. **Add rig (.blend)…** and pick the file. The class it is for is taken from the file's name (change it in the list; "All classes" is the
   fallback). The first read takes a little while: Blender is started in the background and the rig is kept by the app, so the same file is
   read only once. **Read again** after the file changed.
3. Pose a character of that class. The pose panel (left of the view) shows the rig's controls in place of the body map; the **Blender rig**
   button in its head switches between them and the built-in controls.

## Using it

- Click a control to select it; the gizmo (the toolbar toggles move / rotate) edits it. Undo works as it does for the built-in controls.
- **FK / IK** for each limb switches it (an IK limb that was not moved goes back to FK exactly as it was). **Fingers** and **Misc** (bullet belt,
  pack...) show those controls. **Sliders** are the rig's own (IK parent, pins, follow...).
- **Shift + W / Shift + E** grab / rotate the selected control with the mouse (X / Y / Z picks an axis, a click or Enter keeps it, Esc cancels).
- The pose a character already has is put on the rig's FK controls when the rig is switched on. A hinge elbow cannot make every pose a ball
  joint made, so the forearm lands within a unit or two of the original.

## How it works

`scripts/rig/export_rig.py` runs inside Blender and writes the armature (rest pose, constraints, drivers, sliders, bendy-bone settings, the
control shapes) as JSON. `src/rig/` solves that the way Blender does: parents with the inherit flags, the constraints rigs are made of, bendy
bones, drivers, and Blender's IK with pole targets and stretch. `src/viewer/blenderRigOverlay.ts` draws the controls and writes the bones the rig
produces into the character's pose.

## Testing the solver against Blender

```
blender -b rig.blend --python scripts/rig/export_rig.py -- auto rigs/heavy.rig.json
blender -b rig.blend --python scripts/rig/oracle.py -- <armature name> rigs/heavy.oracle.json 12 7
npm test -- rigSolver
npm test -- rigSession
```

`oracle.py` poses the rig in Blender and records every bone's matrix; the tests compare the solver (and the pose snapping) with it. Without
the two files in `rigs/` (ignored by git) the tests do nothing.

## Licence note

Blender is GPL, and the solver follows Blender's algorithms (how it works out parents, constraints, bendy bones and IK) closely: the project is
GPL-3.0-or-later for that reason (see NOTICE.md). Blender itself is not included.
