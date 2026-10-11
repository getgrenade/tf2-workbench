# Authored character visibility

Character visibility uses the supplied black-hide UV masks from TFMV Neo, copied into `assets/bodygroup_masks`. The accompanying `bodygroups.txt` supplies class/group names and separate-material exceptions. These are visibility groups, independent of the MDL's selectable bodygroup models.

`scripts/build_body_masks.py` compiles the originals into one lossless RGB bit atlas per class in `src/assets/bodyMasks` and generates `src/viewer/bodyGroupData.ts`. Run it with Python, Pillow and numpy after changing the originals. Black pixels below 128 set the group's bit. Unassigned texels belong to the core body/shirt/vest group so item inspection does not leave stray geometry.

Runtime masks sample the untransformed Source UVs with `flipY=false`, nearest filtering and no colour conversion. Only the class's body-sheet materials use the atlas. Head, eye, Medic backpack, Sniper lens, Engineer mechanical-hand and accessory materials are controlled separately. Pyro's head uses its authored body-sheet mask. Hiding a head also hides its separate eyeballs.

Class identity comes from each actor's model path, never the viewer-wide material cache. Head and eyes share one Head visibility group for every class. Changing classes resets incompatible visibility selections and refreshes the checklist when the new model loads.

Actors retain independent mask uniforms while sharing textures, lighting/proxy uniforms and geometry. The atlases load lazily and are included in the viewer's cache estimate. Main rendering, ground shadows, wireframe and picking use the same mask interpretation. Box/Lasso/Brush retain their independent triangle masks.

Scenes save authored ids with `bodyMaskVersion: 1`; older anatomical selections migrate to the corresponding group categories. Cosmetic inspection keeps head groups for hats and torso/arm groups for shirts.

Validation: production build; focused group/material/scene/actor/render-pass regressions; all 85 original masks compared pixel-for-pixel with the compiled atlas bits; projected actual Heavy/Pyro mesh UVs checked against authored groups. In-app visual review remains useful for fine mask boundaries.
