# Levels of detail (2026-10-09)

Under **Bodygroups** the selected character has a **Level of detail** row (LOD 0, 1, 2 ... as many as its class has: six for the classes of TF2, the shadow LOD left out). The class and everything it wears or holds switch together; an item with fewer LODs than the one asked for is drawn at its own last (what the game does). In the Compiler tab the item being built shows its own LOD files (a LOD it was not given falls back to the nearest lower one). The choice is saved in scenes.

## How it follows the engine

The QC's `$lod` blocks are compiled into the model files, and the LOD is read from them rather than imitated:
- The viewer draws a LOD with the strip groups of that LOD (`.vtx`) over the whole vertex pool (`.vvd`), which is how the engine draws one (`model::load_lod`).
- `replacemodel` gave the LOD meshes of its own; `bonetreecollapse` and `replacebone` moved the weights of the collapsed bones onto their parents, so the vertices of a lower LOD name fewer bones (Sniper: 57 bones in use at LOD 0, 37 at LOD 1, 25 at LOD 2, 23 from LOD 3). Every bone still animates; the skin simply no longer uses the collapsed ones.
- `nofacial` leaves the flexes off the strip groups of the LOD, so a mesh keeps its flexes only while its strip groups are still flagged as flexed: the face moves at LOD 0 and 1 and is still from LOD 2 on (checked by `tests/model.rs::class_lods_follow_the_qc_rules`).
- A negative switch point marks the shadow LOD (`$shadowlod`), which is never offered.

`load_model` takes the LOD; models are cached per LOD (`path@lod` in the viewer). `Actor.setClassLod` swaps the class's meshes, and cosmetics are rebuilt from the models read at the same LOD.
