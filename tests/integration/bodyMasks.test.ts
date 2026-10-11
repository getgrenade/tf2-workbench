import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test, mock } from "node:test";
import * as THREE from "three";
import { Actor, type ActorContext } from "../../src/viewer/actor";
import { GeometryCache } from "../../src/viewer/geometryCache";
import { parsePayload } from "../../src/viewer/payload";
import { bodyClass, bodyGroups, defaultBodyGroupsFor, hiddenBodyBits, materialBodyGroup, usesBodyAtlas } from "../../src/viewer/bodyGroups";
import { bodyMaskPass } from "../../src/viewer/bodyMaskPass";
import { parseScene } from "../../src/viewer/scene";

test("class identity comes from the model and every class has a single head/eyes group", () => {
  for (const cls of ["scout", "soldier", "pyro", "demo", "engineer", "heavy", "medic", "sniper", "spy"] as const) {
    assert.equal(bodyClass(`models/player/${cls}.mdl`), cls);
    assert.equal(bodyGroups(cls).filter(g => g.id === "head").length, 1);
    assert.ok(!bodyGroups(cls).some(g => g.id === "eyes"));
  }
  assert.equal(bodyClass("models/player/demoman.mdl"), "demo");
  assert.equal(bodyClass("models/weapons/w_rocket.mdl"), null);
});

test("all nine actual class models choose their own groups in a shared Heavy-first material cache", { skip: !existsSync("target/gib-fixtures/scout.player.model") }, () => {
  const loader = mock.method(THREE.TextureLoader.prototype, "load", () => new THREE.Texture());
  try {
    const base = new THREE.ShaderMaterial({ uniforms: { uBodyHideBits: { value: 0 }, tBodyMask: { value: null } } });
    base.userData.shared = true;
    const ctx: ActorContext = { scene: new THREE.Scene(), geometry: new GeometryCache(), jiggle: () => false, mats: { material: () => base } as unknown as ActorContext["mats"] };
    const actor = new Actor(1, ctx);
    const cache = new Map([["materials/models/player/hvyweapon/hvyweapon_red.vmt", null]]);
    for (const cls of ["heavy", "scout", "soldier", "pyro", "demo", "engineer", "medic", "sniper", "spy"] as const) {
      const bytes = readFileSync(`target/gib-fixtures/${cls === "demo" ? "demoman" : cls}.player.model`);
      const model = parsePayload(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
      for (const bp of model.bodyParts) for (const sub of bp.models) for (const mesh of sub.meshes) for (const path of mesh.materials) cache.set(path, null);
      actor.setModel(model, cache);
      assert.deepEqual(actor.bodyGroups, bodyGroups(cls));
      assert.equal(actor.partsHidden, false, `${cls}: class change resets incompatible group selections`);
      const shown = new Set(actor.bodyGroups.map(g => g.id)); shown.delete("head");
      actor.setVisibleRegions(shown);
      for (const mesh of actor.meshes()) {
        const path = mesh.userData.meshData.material;
        if (materialBodyGroup(path) === "head") assert.equal(mesh.visible, false, path);
        if (usesBodyAtlas(path)) assert.equal((mesh.material as THREE.ShaderMaterial).uniforms.uBodyHideBits.value, hiddenBodyBits(cls, shown));
      }
      // Old scenes may contain eyes; their head selection now controls both sheets.
      shown.add("head"); shown.add("eyes"); actor.setVisibleRegions(shown);
      assert.equal(actor.visibleRegions.has("eyes"), false);
      assert.ok(actor.meshes().filter(m => materialBodyGroup(m.userData.meshData.material) === "head").every(m => m.visible));
      actor.setVisibleRegions(new Set(["head"]));
    }
    actor.dispose();
  } finally { loader.mock.restore(); }
});

test("cosmetic inspection keeps heads for hats and isolates torso/arms for shirts", () => {
  for (const cls of ["scout", "soldier", "pyro", "demo", "engineer", "heavy", "medic", "sniper", "spy"] as const) {
    const hat = defaultBodyGroupsFor(cls, ["hat"]);
    assert.ok(hat.includes("head"));
    assert.ok(!hat.includes("legs"));
    const shirt = defaultBodyGroupsFor(cls, ["shirt"]);
    assert.ok(!shirt.includes("head") && !shirt.includes("eyes"));
    assert.ok(shirt.includes(cls === "heavy" ? "vest" : cls === "demo" ? "vest" : "body"));
    assert.ok(shirt.some(id => id.includes("arm")));
  }
  assert.deepEqual(defaultBodyGroupsFor("heavy", ["unknown"]), []);
});

test("body UV masks do not leak into independent head, eye, lens and backpack sheets", () => {
  assert.ok(usesBodyAtlas("materials/models/player/hvyweapon/hvyweapon_blue.vmt"));
  assert.ok(usesBodyAtlas("materials/models/player/pyro/pyro_red.vmt"));
  for (const [path, group] of [["medic/medic_head_red", "head"], ["medic/medic_backpack_red", "backpack"], ["sniper/sniper_lens", "glasses"], ["heavy/eyeball_l", "head"], ["engineer/engineer_mech_hand", "rightarm"]]) {
    const material = `materials/models/player/${path}.vmt`;
    assert.equal(materialBodyGroup(material), group);
    assert.equal(usesBodyAtlas(material), false);
  }
  assert.equal(hiddenBodyBits("heavy", new Set(bodyGroups("heavy").map(g => g.id))), 0);
});

test("shared render overrides upload the current mesh's mask and clear it for the next mesh", () => {
  const material = bodyMaskPass(new THREE.ShaderMaterial({ vertexShader: "void main() {}", fragmentShader: "void main() {}" }));
  const mesh = new THREE.Mesh();
  const texture = new THREE.Texture();
  mesh.userData.bodyMask = { texture, bits: 129 };
  const draw = (object: THREE.Mesh) => material.onBeforeRender({} as THREE.WebGLRenderer, new THREE.Scene(), new THREE.Camera(), mesh.geometry, object, {} as THREE.Group);
  draw(mesh);
  assert.equal(material.uniforms.uBodyHideBits.value, 129);
  assert.equal(material.uniforms.tBodyMask.value, texture);
  draw(new THREE.Mesh());
  assert.equal(material.uniforms.uBodyHideBits.value, 0);
});

test("authored group selections survive scene parsing without being confused with old regions", () => {
  const scene = { app: "tf2-workbench", version: 1, camera: { position: [0, 0, 0], target: [0, 0, 1] }, entities: [{ cls: "heavy", bodyShown: ["vest", "head"], bodyMaskVersion: 1 }] };
  const parsed = parseScene(JSON.stringify(scene));
  assert.deepEqual(parsed.entities[0].bodyShown, ["vest", "head"]);
  assert.equal(parsed.entities[0].bodyMaskVersion, 1);
  delete (scene.entities[0] as any).bodyMaskVersion;
  assert.equal(parseScene(JSON.stringify(scene)).entities[0].bodyMaskVersion, undefined);
});

test("real Heavy model isolates actor masks, preserves manual hiding and survives team/model reloads", { skip: !existsSync("target/gib-fixtures/heavy.player.model") }, () => {
  const loader = mock.method(THREE.TextureLoader.prototype, "load", () => new THREE.Texture());
  try {
    const bytes = readFileSync("target/gib-fixtures/heavy.player.model");
    const model = parsePayload(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const materials = new Map(model.bodyParts.flatMap(bp => bp.models.flatMap(sub => sub.meshes.flatMap(m => m.materials.map(path => [path, null] as const)))));
    const base = new THREE.ShaderMaterial({ uniforms: { uBodyHideBits: { value: 0 }, tBodyMask: { value: null }, uLightColor: { value: new THREE.Color() } } });
    base.userData.shared = true;
    const ctx: ActorContext = { scene: new THREE.Scene(), geometry: new GeometryCache(), jiggle: () => false, mats: { material: () => base } as unknown as ActorContext["mats"] };
    const a = new Actor(1, ctx), b = new Actor(2, ctx);
    a.setModel(model, materials); b.setModel(model, materials);
    const shown = new Set(a.bodyGroups.map(g => g.id)); shown.delete("vest"); shown.delete("head");
    a.setVisibleRegions(shown);
    const mesh = a.meshes().find(m => usesBodyAtlas((m.userData.meshData).material))!;
    const mat = mesh.material as THREE.ShaderMaterial;
    assert.notEqual(mat, base);
    assert.equal(base.uniforms.uBodyHideBits.value, 0);
    assert.equal(mat.uniforms.uLightColor, base.uniforms.uLightColor);
    assert.equal(mat.uniforms.tBodyMask.value.flipY, false);
    assert.equal(mesh.geometry.getAttribute("hideW"), undefined);
    assert.ok(a.meshes().filter(m => materialBodyGroup(m.userData.meshData.material) === "head" || materialBodyGroup(m.userData.meshData.material) === "eyes").every(m => !m.visible));
    assert.ok(b.meshes().every(m => m.visible));
    a.setHandMaskState({ [mesh.userData.maskKey]: "AQ==" });
    assert.ok(a.hasHandMask);
    a.setSkin(1);
    assert.deepEqual([...a.visibleRegions], [...shown]);
    assert.ok(a.hasHandMask);
    a.setModel(model, materials);
    assert.deepEqual([...a.visibleRegions], [...shown]);
    a.dispose(); b.dispose();
  } finally { loader.mock.restore(); }
});
