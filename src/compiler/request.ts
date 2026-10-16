import type { ItemBuildRequest } from "../api";
import { writeSmd } from "./smd";
import { writeDmx } from "./dmxWrite";
import { transferSkin } from "./skinTransfer";
import { materialFileName, NUM_LODS, type CompilerSession } from "./session";

/**
 * What the native side needs to build the item: the model of each LOD of each class as an .smd (a .dmx for a model with flexes, which an .smd cannot carry), the finished material files, the paths
 * of the textures and icon (it reads and converts those itself), and the item's schema data. Throws when something is missing; the
 * session's own checks (`issues`) are what the interface shows before the artist gets here.
 */
export function makeBuildRequest(session: CompilerSession, current: string): ItemBuildRequest {
  const d = session.data;
  const names = session.materialNames();
  const classes: ItemBuildRequest["classes"] = [];
  for (const cls of session.classesWithModels()) {
    const lods: ItemBuildRequest["classes"][number]["lods"] = [];
    for (let i = 0; i < NUM_LODS; i++) {
      const given = session.model(cls, i);
      if (!given) continue;
      // A LOD that came without a skin (a mesh with no armature, as the exporter writes the lower LODs) is skinned like LOD 0, with its bones: written as it
      // is it would hang on one bone at its own origin, and studiomdl would put it where that bone is in the class, not where the mesh is.
      const lod0 = i > 0 ? session.model(cls, 0) : null;
      const model = lod0 ? transferSkin(lod0, given) : given;
      // the materials of a class's model are the item's by their position
      const slot = (material: string) => materialFileName(session.itemName, session.materialSlot(cls, material));
      const flexed = !!model.flexes?.length;
      lods.push({
        // a LOD the session made has no file: the name it would have next to LOD 0
        sourcePath: session.lods(cls)[i] || session.tempLodFile(cls, i) || withLodSuffix(session.lods(cls)[0], i),
        smd: flexed ? "" : writeSmd(model, slot, "bip_head", d.turns),
        ...(flexed ? { dmx: Array.from(writeDmx(model, slot, "bip_head", d.turns)) } : {}),
        triangles: model.triangles,
        vertices: model.vertices,
      });
    }
    if (lods.length) classes.push({ folder: cls, lods, qcExtra: session.jiggleQc(cls), lodCommands: session.lodQcCommands(cls) });
  }
  if (!classes.length) throw new Error("The item has no model.");
  const materials = names.map((name, i): ItemBuildRequest["materials"][number] => {
    const m = d.materials[name];
    const given = session.texturePaths(current, name, i);
    return {
      sourceName: name,
      vmt: session.vmtText(current, name, i),
      color: given.color ? m.color : null,
      normal: given.normal ? m.normal : null,
      phongexponent: given.phongexponent ? m.phongexponent : null,
      illum: given.illum ? m.illum : null,
      paintable: m.settings.paintable,
      // the BLU skin: its own material file, and its own diffuse texture when it has one (else the material points at the RED one)
      blue: d.teamColors ? { vmt: session.vmtText(current, name, i, 1), color: session.blueIsOwn(name) ? m.blueColor : null } : null,
    };
  });
  return {
    name: session.itemName,
    // the one name the artist gives is also the one players see; it is renamed when the item is uploaded
    displayName: d.name.trim(),
    prefab: d.prefab,
    equipRegion: d.region,
    bodygroups: d.bodygroups,
    paintable: names.some((n) => d.materials[n]?.settings.paintable),
    classes,
    materials,
    icon: d.icon,
    compression: d.compression,
  };
}

/** The name a LOD 1 or 2 would have next to the file of LOD 0 (`hat.fbx` -> `hat_lod1.fbx`). */
function withLodSuffix(lod0: string, index: number): string {
  const dot = lod0.lastIndexOf(".");
  const slash = Math.max(lod0.lastIndexOf("/"), lod0.lastIndexOf("\\"));
  return dot > slash ? `${lod0.slice(0, dot)}_lod${index}${lod0.slice(dot)}` : `${lod0}_lod${index}`;
}
