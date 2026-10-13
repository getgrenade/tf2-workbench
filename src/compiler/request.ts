import type { ItemBuildRequest } from "../api";
import { writeSmd } from "./smd";
import { writeDmx } from "./dmxWrite";
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
      const model = session.model(cls, i);
      if (!model) continue;
      // the materials of a class's model are the item's by their position
      const slot = (material: string) => materialFileName(session.itemName, session.materialSlot(cls, material));
      const flexed = !!model.flexes?.length;
      lods.push({
        sourcePath: session.lods(cls)[i],
        smd: flexed ? "" : writeSmd(model, slot, "bip_head", d.turns),
        ...(flexed ? { dmx: Array.from(writeDmx(model, slot, "bip_head", d.turns)) } : {}),
        triangles: model.triangles,
        vertices: model.vertices,
      });
    }
    if (lods.length) classes.push({ folder: cls, lods, qcExtra: session.jiggleQc(cls) });
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
