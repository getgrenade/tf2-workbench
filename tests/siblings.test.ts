import test from "node:test";
import assert from "node:assert/strict";
import { classSiblings, lodSiblings, materialDiffuse, splitPath, textureDirsFor, textureRole, textureSiblings } from "../src/compiler/siblings.ts";

const files = ["body_lod0.fbx", "body_lod1.fbx", "body_lod2.fbx", "hat.fbx", "hat_lod.fbx", "cover.fbx", "cover_lod2.fbx", "a_body_diffuse.tga", "a_body_normal.tga", "a_body_expmask.tga", "a_body_illum.tga", "b_Color.tga", "b_NRM.tga", "b_exp.tga", "solo.tga", "notes.txt"];
const W = String.raw; // paths as Windows writes them

test("a LOD 0 file brings the LOD files of the same name", () => {
  assert.deepEqual(lodSiblings(W`C:\mesh\body_lod0.fbx`, files), [W`C:\mesh\body_lod1.fbx`, W`C:\mesh\body_lod2.fbx`]);
  assert.deepEqual(lodSiblings("D:/art/BODY_LOD0.FBX", files), ["D:/art/body_lod1.fbx", "D:/art/body_lod2.fbx"]);
  // a file with no LOD in its name: the ones with _lod after it (and a bare _lod is LOD 1)
  assert.deepEqual(lodSiblings(W`C:\mesh\hat.fbx`, files), [W`C:\mesh\hat_lod.fbx`, null]);
  assert.deepEqual(lodSiblings(W`C:\mesh\cover.fbx`, files), [null, W`C:\mesh\cover_lod2.fbx`]);
  assert.deepEqual(lodSiblings(W`C:\mesh\hat_lod.fbx`, files), [null, null], "a lower LOD picked first brings nothing");
  assert.deepEqual(lodSiblings(W`C:\mesh\body_lod1.fbx`, files), [null, null]);
  assert.deepEqual(lodSiblings(W`C:\mesh\alone.fbx`, files), [null, null]);
});

test("a texture file says which texture of the material it is", () => {
  assert.deepEqual(textureRole("a_body_diffuse.tga"), { role: "color", prefix: "a_body", separator: "_" });
  assert.equal(textureRole("a_body_expmask.tga")!.role, "phongexponent");
  assert.equal(textureRole("B_NRM.tga")!.role, "normal");
  assert.deepEqual(textureRole("diffuse.tga"), { role: "color", prefix: "", separator: "" });
  assert.equal(textureRole("solo.tga"), null);
  assert.equal(textureRole("wood.tga"), null, "a word has to stand on its own after the name");
});

test("a picked texture brings the others of its material", () => {
  assert.deepEqual(textureSiblings(W`C:\tex\a_body_diffuse.tga`, files), { normal: W`C:\tex\a_body_normal.tga`, phongexponent: W`C:\tex\a_body_expmask.tga`, illum: W`C:\tex\a_body_illum.tga` });
  assert.deepEqual(textureSiblings("/tex/b_Color.tga", files), { normal: "/tex/b_NRM.tga", phongexponent: "/tex/b_exp.tga" });
  // picking the normal brings the diffuse too
  assert.equal(textureSiblings(W`C:\tex\a_body_normal.tga`, files).color, W`C:\tex\a_body_diffuse.tga`);
  assert.deepEqual(textureSiblings(W`C:\tex\solo.tga`, files), {});
  assert.deepEqual(splitPath(W`C:\a\b.tga`), { dir: "C:\\a\\", name: "b.tga" });
  assert.deepEqual(splitPath("b.tga"), { dir: "", name: "b.tga" });
});

test("a model named for a class brings the other classes' models of the same name", () => {
  const files = ["sniper_hat.fbx", "heavy_hat.fbx", "spy_hat.fbx", "demoman_hat.fbx", "engie_hat.fbx", "scout_cap.fbx", "hat.fbx", "heavy_hat.tga"];
  const found = classSiblings("C:/m/mesh/sniper_hat.fbx", files, "sniper");
  assert.deepEqual(found, { heavy: "C:/m/mesh/heavy_hat.fbx", spy: "C:/m/mesh/spy_hat.fbx", demo: "C:/m/mesh/demoman_hat.fbx", engineer: "C:/m/mesh/engie_hat.fbx" });
  assert.deepEqual(classSiblings("C:/m/mesh/hat.fbx", files, "sniper"), {}, "no class in the name, nothing to bring");
  assert.deepEqual(classSiblings("C:/m/mesh/Sniper-hat_lod0.fbx", ["Spy-hat_lod0.fbx"], "sniper"), { spy: "C:/m/mesh/Spy-hat_lod0.fbx" }, "any case, the same separator");
});

test("the texture folder beside a mesh folder, and the diffuse texture named after a material", () => {
  assert.deepEqual(textureDirsFor("C:/work/hat/mesh/sniper_hat.fbx"), ["C:/work/hat/texture/", "C:/work/hat/textures/"]);
  assert.deepEqual(textureDirsFor(W`C:\work\hat\Mesh\x.fbx`), [W`C:\work\hat\texture` + "\\", W`C:\work\hat\textures` + "\\"]);
  assert.deepEqual(textureDirsFor("C:/work/hat/models/x.fbx"), [], "only a folder called mesh");
  const files = ["body_diffuse.tga", "body_normal.tga", "cloth.tga", "cloth_expmask.tga", "readme.txt"];
  assert.equal(materialDiffuse("body", files), "body_diffuse.tga");
  assert.equal(materialDiffuse("Cloth", files), "cloth.tga", "a file named just like the material");
  assert.equal(materialDiffuse("hat", files), null);
});
